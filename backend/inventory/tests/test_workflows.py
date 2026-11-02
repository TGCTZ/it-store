"""End-to-end API checks for the office lending rules."""

from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone
from rest_framework.test import APITestCase

from inventory.models import Asset, Borrower, Checkout, Event, User


class LendingTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@example.test", name="Admin", password="password123", role=User.Role.ADMIN
        )
        self.staff = User.objects.create_user(
            email="staff@example.test", name="Staff", password="password123"
        )
        self.borrower = Borrower.objects.create(name="Asha", phone="+255700000001")
        self.a = Asset.objects.create(asset_id="it-1", name="Laptop")
        self.b = Asset.objects.create(asset_id="it-2", name="Meter")
        self.client.force_authenticate(self.staff)

    def checkout(self, asset_ids=None, due_date=None):
        return self.client.post(
            "/api/v1/checkouts/",
            {
                "borrower": self.borrower.pk,
                "asset_ids": asset_ids or [self.a.pk],
                "due_date": str(due_date or timezone.localdate() + timedelta(days=2)),
            },
            format="json",
        )

    def test_admin_can_create_manual_and_generated_labels_but_staff_cannot(self):
        self.assertEqual(self.a.asset_id, "IT-1")
        denied = self.client.post("/api/v1/assets/", {"name": "Probe"})
        self.assertEqual(denied.status_code, 403)
        self.client.force_authenticate(self.admin)
        generated = self.client.post("/api/v1/assets/", {"name": "Probe"})
        self.assertEqual(generated.status_code, 201)
        self.assertEqual(generated.data["asset_id"], "TGC-IT-000001")
        duplicate = self.client.post("/api/v1/assets/", {"asset_id": " it-1 ", "name": "Another"})
        self.assertEqual(duplicate.status_code, 400)

    def test_multi_item_checkout_partial_return_and_no_double_loan(self):
        created = self.checkout([self.a.pk, self.b.pk])
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(len(created.data["items"]), 2)
        self.assertEqual(Asset.objects.get(pk=self.a.pk).status, Asset.Status.ON_LOAN)
        self.assertEqual(self.checkout([self.a.pk]).status_code, 400)
        first_item = created.data["items"][0]
        resolved = self.client.post(
            f"/api/v1/checkout-items/{first_item['id']}/resolve/",
            {"outcome": "returned"},
            format="json",
        )
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(Asset.objects.get(pk=first_item["asset"]).status, Asset.Status.AVAILABLE)
        self.assertEqual(
            self.client.get(f"/api/v1/checkouts/{created.data['id']}/").data["status"], "active"
        )
        self.assertEqual(self.checkout([first_item["asset"]]).status_code, 201)

    def test_overdue_uses_local_date_and_due_date_change_is_logged(self):
        created = self.checkout(due_date=timezone.localdate())
        checkout_id = created.data["id"]
        with (
            patch(
                "inventory.views.timezone.localdate",
                return_value=timezone.localdate() + timedelta(days=1),
            ),
            patch(
                "inventory.serializers.timezone.localdate",
                return_value=timezone.localdate() + timedelta(days=1),
            ),
        ):
            listed = self.client.get("/api/v1/checkouts/?status=overdue")
            self.assertEqual(listed.data["count"], 1)
            self.assertEqual(self.client.get("/api/v1/dashboard/").data["overdue"], 1)
        changed = self.client.patch(
            f"/api/v1/checkouts/{checkout_id}/",
            {"due_date": str(timezone.localdate() + timedelta(days=7))},
            format="json",
        )
        self.assertEqual(changed.status_code, 200)
        self.assertTrue(
            Event.objects.filter(checkout_id=checkout_id, kind="due_date_changed").exists()
        )

    def test_damaged_and_lost_items_need_admin_to_restore(self):
        created = self.checkout([self.a.pk, self.b.pk])
        for item, outcome in zip(created.data["items"], ("damaged", "lost"), strict=True):
            response = self.client.post(
                f"/api/v1/checkout-items/{item['id']}/resolve/",
                {"outcome": outcome, "notes": "Checked by IT"},
                format="json",
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(Asset.objects.get(pk=item["asset"]).status, outcome)
            self.assertEqual(self.checkout([item["asset"]]).status_code, 400)
            self.assertEqual(
                self.client.patch(
                    f"/api/v1/assets/{item['asset']}/", {"status": "available"}, format="json"
                ).status_code,
                403,
            )
        self.client.force_authenticate(self.admin)
        self.assertEqual(
            self.client.patch(
                f"/api/v1/assets/{self.a.pk}/", {"status": "available"}, format="json"
            ).status_code,
            200,
        )

    def test_borrower_reused_and_permissions_enforced(self):
        self.assertEqual(self.checkout().status_code, 201)
        self.assertEqual(self.checkout([self.b.pk]).status_code, 201)
        self.assertEqual(Borrower.objects.count(), 1)
        self.assertEqual(Checkout.objects.filter(borrower=self.borrower).count(), 2)
        self.assertEqual(self.client.get("/api/v1/users/").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/borrowers/?q=+255700").data["count"], 1)

    def test_historical_item_label_survives_asset_rename(self):
        created = self.checkout()
        self.client.force_authenticate(self.admin)
        edited = self.client.patch(
            f"/api/v1/assets/{self.a.pk}/",
            {"asset_id": "NEW-ID", "name": "Renamed laptop"},
            format="json",
        )
        self.assertEqual(edited.status_code, 200)
        item = self.client.get(f"/api/v1/checkouts/{created.data['id']}/").data["items"][0]
        self.assertEqual(item["asset_label"], "IT-1")
        self.assertEqual(item["asset_name"], "Laptop")

    def test_checkout_can_register_borrower_inline_atomically(self):
        payload = {
            "borrower_data": {
                "name": "Juma Guest",
                "phone": "+255700000002",
                "borrower_type": "guest",
            },
            "asset_ids": [self.a.pk],
            "due_date": str(timezone.localdate() + timedelta(days=2)),
        }
        created = self.client.post("/api/v1/checkouts/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["borrower_name"], "Juma Guest")
        self.assertEqual(Borrower.objects.count(), 2)
        self.assertEqual(
            Checkout.objects.get(pk=created.data["id"]).borrower.phone, "+255700000002"
        )

        invalid = {**payload, "borrower_data": {**payload["borrower_data"], "name": "Another"}}
        self.assertEqual(
            self.client.post("/api/v1/checkouts/", invalid, format="json").status_code, 400
        )
        self.assertEqual(Borrower.objects.count(), 2)

    def test_checkout_requires_exactly_one_borrower_path(self):
        payload = {
            "asset_ids": [self.a.pk],
            "due_date": str(timezone.localdate() + timedelta(days=2)),
        }
        neither = self.client.post("/api/v1/checkouts/", payload, format="json")
        self.assertEqual(neither.status_code, 400)
        both = self.client.post(
            "/api/v1/checkouts/",
            {
                **payload,
                "borrower": self.borrower.pk,
                "borrower_data": {"name": "New", "phone": "123"},
            },
            format="json",
        )
        self.assertEqual(both.status_code, 400)
        self.assertEqual(Borrower.objects.count(), 1)

    def test_login_and_staff_account_management(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get("/api/v1/assets/").status_code, 401)
        login = self.client.post(
            "/api/v1/auth/login/", {"email": "staff@example.test", "password": "password123"}
        )
        self.assertEqual(login.status_code, 200)
        self.assertIn("access", login.data)
        self.client.force_authenticate(self.admin)
        new_user = self.client.post(
            "/api/v1/users/",
            {
                "email": "second@example.test",
                "name": "Second",
                "role": "staff",
                "password": "password123",
            },
        )
        self.assertEqual(new_user.status_code, 201, new_user.data)
