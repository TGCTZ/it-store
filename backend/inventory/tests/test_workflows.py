"""End-to-end API checks for the office lending rules."""

from rest_framework.test import APITestCase

from inventory.models import Asset, Checkout, Recipient, User


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

    def checkout(self, asset_ids=None):
        return self.client.post(
            "/api/v1/checkouts/",
            {
                "recipient": self.recipient.pk,
                "asset_ids": asset_ids or [self.a.pk],
            },
            format="json",
        )

    def test_superadmins_can_create_manual_and_generated_labels(self):
        self.assertEqual(self.a.asset_id, "IT-1")
        generated = self.client.post("/api/v1/assets/", {"name": "Probe"})
        self.assertEqual(generated.status_code, 201)
        self.assertEqual(generated.data["asset_id"], "TGC-IT-000001")
        duplicate = self.client.post("/api/v1/assets/", {"asset_id": " it-1 ", "name": "Another"})
        self.assertEqual(duplicate.status_code, 400)

    def test_multi_item_checkout_partial_return_and_no_double_loan(self):
        created = self.checkout([self.a.pk, self.b.pk])
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(len(created.data["items"]), 2)
        self.assertEqual(Asset.objects.get(pk=self.a.pk).status, Asset.Status.CHECKED_OUT)
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
            self.client.get(f"/api/v1/checkouts/{created.data['id']}/").data["status"], "partially_returned"
        )
        self.assertEqual(self.checkout([first_item["asset"]]).status_code, 201)

    def test_damaged_and_lost_items_need_superadmin_to_restore(self):
        created = self.checkout([self.a.pk, self.b.pk])
        for item, outcome, asset_status in zip(
            created.data["items"],
            ("returned_damaged", "lost"),
            (Asset.Status.NEEDS_REPAIR, Asset.Status.LOST),
            strict=True,
        ):
            response = self.client.post(
                f"/api/v1/checkout-items/{item['id']}/resolve/",
                {"outcome": outcome, "notes": "Checked by IT"},
                format="json",
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(Asset.objects.get(pk=item["asset"]).status, asset_status)
            self.assertEqual(self.checkout([item["asset"]]).status_code, 400)
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
        self.assertEqual(self.checkout([self.b.pk]).status_code, 201)
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
        self.assertEqual(item["asset_name"], "Laptop")

    def test_checkout_can_register_recipient_inline_atomically(self):
        payload = {
            "recipient_data": {
                "first_name": "Juma",
                "last_name": "Guest",
                "phone": "+255700000002",
                "recipient_type": "guest",
            },
            "asset_ids": [self.a.pk],
        }
        created = self.client.post("/api/v1/checkouts/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["recipient_first_name"], "Juma")
        self.assertEqual(created.data["recipient_last_name"], "Guest")
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
            "asset_ids": [self.a.pk],
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
