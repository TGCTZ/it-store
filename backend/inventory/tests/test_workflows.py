"""End-to-end API checks for the office lending rules."""

from datetime import datetime, time, timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from inventory.models import AccessoryOption, Asset, Checkout, Recipient, User


class LendingTests(APITestCase):
    def setUp(self):
        self.superadmin = User.objects.create_superuser(
            email="admin@example.test", name="Admin", password="password123"
        )
        self.recipient = Recipient.objects.create(
            first_name="Asha", last_name="Mashauri", phone="+255700000001"
        )
        self.a = Asset.objects.create(asset_id="it-1", name="Laptop")
        self.b = Asset.objects.create(asset_id="it-2", name="Meter")
        self.client.force_authenticate(self.superadmin)

    def checkout(self, asset_id=None):
        return self.client.post(
            "/api/v1/checkouts/",
            {
                "recipient": self.recipient.pk,
                "asset_id": asset_id or self.a.pk,
            },
            format="json",
        )

    def test_superadmins_can_create_manual_and_generated_labels(self):
        self.assertEqual(self.a.asset_id, "IT-1")
        generated = self.client.post("/api/v1/assets/", {"name": "Probe"})
        self.assertEqual(generated.status_code, 201)
        self.assertEqual(generated.data["asset_id"], "TGC-IT-000001")
        self.assertEqual(generated.data["name"], "PROBE")
        duplicate = self.client.post("/api/v1/assets/", {"asset_id": " it-1 ", "name": "Another"})
        self.assertEqual(duplicate.status_code, 400)

    def test_asset_names_are_normalized_to_uppercase(self):
        created = self.client.post("/api/v1/assets/", {"name": "new probe"}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["name"], "NEW PROBE")
        self.assertEqual(Asset.objects.get(pk=created.data["id"]).name, "NEW PROBE")

    def test_duplicate_lookup_requires_every_person_field_to_match(self):
        saved_person = Recipient.objects.get(pk=self.recipient.pk)
        self.assertEqual((saved_person.first_name, saved_person.last_name), ("ASHA", "MASHAURI"))
        self.assertEqual(
            Recipient.objects.filter(
                first_name__iexact="asha",
                last_name__iexact="mashauri",
                recipient_type="employee",
            ).count(),
            1,
        )
        base = "/api/v1/people/?duplicate_check=1&first_name=asha&last_name=mashauri&phone=%2B255%20700%20000%20001"
        exact = self.client.get(f"{base}&recipient_type=employee")
        different_last_name = self.client.get(
            f"{base.replace('last_name=mashauri', 'last_name=other')}&recipient_type=employee"
        )
        different_phone = self.client.get(
            f"{base.replace('0001', '0002')}&recipient_type=employee"
        )
        different_type = self.client.get(f"{base}&recipient_type=student")

        self.assertEqual(exact.data["count"], 1)
        self.assertEqual(different_last_name.data["count"], 0)
        self.assertEqual(different_phone.data["count"], 0)
        self.assertEqual(different_type.data["count"], 0)

    def test_resource_lists_accept_a_custom_page_size(self):
        response = self.client.get("/api/v1/assets/?page=1&page_size=1")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(response.data["count"], 2)
        self.assertEqual(len(response.data["results"]), 1)

    def test_checkout_list_can_be_filtered_by_inclusive_issued_date_range(self):
        recent = self.checkout(self.a.pk)
        older = self.checkout(self.b.pk)
        today = timezone.localdate()
        older_day = today - timedelta(days=3)
        recent_time = timezone.make_aware(datetime.combine(today, time(12)), timezone.get_current_timezone())
        older_time = timezone.make_aware(datetime.combine(older_day, time(12)), timezone.get_current_timezone())
        Checkout.objects.filter(pk=recent.data["id"]).update(issued_at=recent_time)
        Checkout.objects.filter(pk=older.data["id"]).update(issued_at=older_time)

        response = self.client.get(
            f"/api/v1/checkouts/?date_from={today.isoformat()}&date_to={today.isoformat()}"
        )
        invalid_range = self.client.get(
            f"/api/v1/checkouts/?date_from={today.isoformat()}&date_to={older_day.isoformat()}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], recent.data["id"])
        self.assertEqual(invalid_range.status_code, 400)

    def test_one_asset_per_checkout_and_no_double_loan(self):
        invalid_multi_asset = self.client.post(
            "/api/v1/checkouts/",
            {"recipient": self.recipient.pk, "asset_id": [self.a.pk, self.b.pk]},
            format="json",
        )
        self.assertEqual(invalid_multi_asset.status_code, 400)

        created = self.checkout(self.a.pk)
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(len(created.data["items"]), 1)
        self.assertEqual(Asset.objects.get(pk=self.a.pk).status, Asset.Status.CHECKED_OUT)
        self.assertEqual(self.checkout(self.a.pk).status_code, 400)
        separate_checkout = self.checkout(self.b.pk)
        self.assertEqual(separate_checkout.status_code, 201)
        self.assertNotEqual(separate_checkout.data["id"], created.data["id"])
        self.assertEqual(len(separate_checkout.data["items"]), 1)
        first_item = created.data["items"][0]
        resolved = self.client.post(
            f"/api/v1/checkout-items/{first_item['id']}/resolve/",
            {"outcome": "returned"},
            format="json",
        )
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(Asset.objects.get(pk=first_item["asset"]).status, Asset.Status.AVAILABLE)
        checkout_detail = self.client.get(f"/api/v1/checkouts/{created.data['id']}/").data
        self.assertNotIn("status", checkout_detail)
        self.assertEqual(checkout_detail["items"][0]["status"], "returned")
        self.assertEqual(self.checkout(first_item["asset"]).status_code, 201)

    def test_active_checkout_can_change_asset_and_accessories(self):
        power = AccessoryOption.objects.create(name="Test power cable")
        remote = AccessoryOption.objects.create(name="Test remote control")
        self.a.accessories.add(power)
        self.b.accessories.add(remote)
        created = self.checkout(self.a.pk)
        checkout_id = created.data["id"]

        updated = self.client.patch(
            f"/api/v1/checkouts/{checkout_id}/",
            {"asset_id": self.b.pk, "accessory_ids": [remote.pk]},
            format="json",
        )

        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(Asset.objects.get(pk=self.a.pk).status, Asset.Status.AVAILABLE)
        self.assertEqual(Asset.objects.get(pk=self.b.pk).status, Asset.Status.CHECKED_OUT)
        self.assertEqual(updated.data["items"][0]["asset"], self.b.pk)
        self.assertEqual(updated.data["items"][0]["accessory_snapshot"], [{"id": remote.pk, "name": "Test remote control"}])
        self.assertTrue(Checkout.objects.get(pk=checkout_id).events.filter(kind="checkout_updated").exists())

        self.assertEqual(self.checkout(self.b.pk).status_code, 400)

    def test_damaged_and_lost_items_need_superadmin_to_restore(self):
        created = [self.checkout(self.a.pk), self.checkout(self.b.pk)]
        for checkout_response, outcome, asset_status in zip(
            created,
            ("returned_damaged", "lost"),
            (Asset.Status.NEEDS_REPAIR, Asset.Status.LOST),
            strict=True,
        ):
            item = checkout_response.data["items"][0]
            response = self.client.post(
                f"/api/v1/checkout-items/{item['id']}/resolve/",
                {"outcome": outcome, "notes": "Checked by IT"},
                format="json",
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(Asset.objects.get(pk=item["asset"]).status, asset_status)
            self.assertEqual(self.checkout(item["asset"]).status_code, 400)
            self.assertEqual(
                self.client.patch(
                    f"/api/v1/assets/{item['asset']}/", {"status": "available"}, format="json"
                ).status_code,
                403,
            )
        self.client.force_authenticate(self.superadmin)
        self.assertEqual(
            self.client.patch(
                f"/api/v1/assets/{self.a.pk}/", {"status": "available"}, format="json"
            ).status_code,
            200,
        )

    def test_recipient_reused_and_permissions_enforced(self):
        self.assertEqual(self.checkout().status_code, 201)
        self.assertEqual(self.checkout(self.b.pk).status_code, 201)
        self.assertEqual(Recipient.objects.count(), 1)
        self.assertEqual(Checkout.objects.filter(recipient=self.recipient).count(), 2)
        self.assertEqual(self.client.get("/api/v1/users/").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/people/?q=+255700").data["count"], 1)

    def test_historical_item_label_survives_asset_rename(self):
        created = self.checkout()
        self.client.force_authenticate(self.superadmin)
        edited = self.client.patch(
            f"/api/v1/assets/{self.a.pk}/",
            {"asset_id": "NEW-ID", "name": "Renamed laptop"},
            format="json",
        )
        self.assertEqual(edited.status_code, 200)
        item = self.client.get(f"/api/v1/checkouts/{created.data['id']}/").data["items"][0]
        self.assertEqual(item["asset_label"], "IT-1")
        self.assertEqual(item["asset_name"], "LAPTOP")

    def test_checkout_can_register_recipient_inline_atomically(self):
        payload = {
            "recipient_data": {
                "first_name": "juma",
                "last_name": "guest",
                "phone": "+255700000002",
                "recipient_type": "guest",
            },
            "asset_id": self.a.pk,
        }
        created = self.client.post("/api/v1/checkouts/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["recipient_first_name"], "JUMA")
        self.assertEqual(created.data["recipient_last_name"], "GUEST")
        self.assertEqual(Recipient.objects.count(), 2)
        self.assertEqual(
            Checkout.objects.get(pk=created.data["id"]).recipient.phone, "+255700000002"
        )

        invalid = {
            **payload,
            "recipient_data": {**payload["recipient_data"], "first_name": "Another"},
        }
        self.assertEqual(
            self.client.post("/api/v1/checkouts/", invalid, format="json").status_code, 400
        )
        self.assertEqual(Recipient.objects.count(), 2)

    def test_checkout_requires_exactly_one_recipient_path(self):
        payload = {
            "asset_id": self.a.pk,
        }
        neither = self.client.post("/api/v1/checkouts/", payload, format="json")
        self.assertEqual(neither.status_code, 400)
        both = self.client.post(
            "/api/v1/checkouts/",
            {
                **payload,
                "recipient": self.recipient.pk,
                "recipient_data": {
                    "first_name": "New",
                    "last_name": "Person",
                    "phone": "123",
                },
            },
            format="json",
        )
        self.assertEqual(both.status_code, 400)
        self.assertEqual(Recipient.objects.count(), 1)

    def test_login_and_single_account_limit(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get("/api/v1/assets/").status_code, 401)
        login = self.client.post(
            "/api/v1/auth/login/", {"email": "admin@example.test", "password": "password123"}
        )
        self.assertEqual(login.status_code, 200)
        self.assertIn("access", login.data)
        with self.assertRaisesMessage(ValueError, "only one login account"):
            User.objects.create_superuser(
                email="second@example.test", name="Second", password="password123"
            )
        self.assertEqual(User.objects.count(), 1)
