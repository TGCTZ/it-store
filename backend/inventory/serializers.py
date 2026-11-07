"""Input validation and stable JSON shapes for the office UI."""

from django.db import transaction
from rest_framework import serializers

from .models import (
    AccessoryOption,
    Asset,
    AssetSequence,
    Checkout,
    CheckoutItem,
    Event,
    Recipient,
    User,
)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "name", "is_active")
        read_only_fields = fields


class RecipientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Recipient
        fields = ("id", "first_name", "last_name", "phone", "recipient_type", "created_at")
        read_only_fields = ("id", "created_at")

    def validate_first_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("First name is required.")
        return value

    def validate_last_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Last name is required.")
        return value

    def validate_phone(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Phone number is required.")
        return value


def next_asset_id():
    """Allocate a label under a row lock, skipping any matching manual labels."""
    counter, _ = AssetSequence.objects.select_for_update().get_or_create(pk=1)
    while True:
        label = f"TGC-IT-{counter.next_number:06d}"
        counter.next_number += 1
        counter.save(update_fields=["next_number"])
        if not Asset.objects.filter(asset_id=label).exists():
            return label


class AccessoryOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccessoryOption
        fields = ("id", "name")
        read_only_fields = ("id",)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Accessory name is required.")
        query = AccessoryOption.objects.filter(name__iexact=value)
        if self.instance:
            query = query.exclude(pk=self.instance.pk)
        if query.exists():
            raise serializers.ValidationError("An accessory with this name already exists.")
        return value


class AssetSerializer(serializers.ModelSerializer):
    asset_id = serializers.CharField(required=False, allow_blank=True, max_length=80)
    accessory_ids = serializers.PrimaryKeyRelatedField(
        source="accessories",
        many=True,
        queryset=AccessoryOption.objects.all(),
        required=False,
    )
    accessory_items = AccessoryOptionSerializer(source="accessories", many=True, read_only=True)
    missing_accessory_ids = serializers.SerializerMethodField()

    class Meta:
        model = Asset
        fields = (
            "id",
            "asset_id",
            "name",
            "accessory_ids",
            "accessory_items",
            "missing_accessory_ids",
            "status",
            "created_at",
        )
        read_only_fields = ("id", "created_at", "missing_accessory_ids")

    def get_missing_accessory_ids(self, obj):
        partial_items = getattr(obj, "partial_checkout_items", None)
        if partial_items is None:
            partial_items = obj.checkout_items.filter(
                status__in=[
                    CheckoutItem.Status.PARTIALLY_RETURNED,
                    CheckoutItem.Status.RETURNED_DAMAGED,
                ]
            )
        return sorted(
            {
                accessory["id"]
                for item in partial_items
                for accessory in item.missing_accessories
            }
        )

    def validate_asset_id(self, value):
        value = value.strip().upper()
        if self.instance and not value:
            raise serializers.ValidationError("An existing asset ID cannot be blank.")
        if value:
            query = Asset.objects.filter(asset_id__iexact=value)
            if self.instance:
                query = query.exclude(pk=self.instance.pk)
            if query.exists():
                raise serializers.ValidationError("This asset ID is already in use.")
        return value

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Name is required.")
        query = Asset.objects.filter(name__iexact=value)
        if self.instance:
            query = query.exclude(pk=self.instance.pk)
        if query.exists():
            raise serializers.ValidationError("An asset with this name already exists.")
        return value

    def validate(self, attrs):
        if self.instance and self.instance.status == Asset.Status.CHECKED_OUT:
            new_status = attrs.get("status", self.instance.status)
            if new_status != Asset.Status.CHECKED_OUT:
                raise serializers.ValidationError(
                    {"status": "A checked-out item cannot be changed here."}
                )
        if self.instance and attrs.get("status") == Asset.Status.CHECKED_OUT:
            if self.instance.status != Asset.Status.CHECKED_OUT:
                raise serializers.ValidationError(
                    {"status": "Only a checkout may mark an asset checked out."}
                )
        if (
            self.instance
            and self.instance.status == Asset.Status.MISSING_ACCESSORIES
            and attrs.get("status") == Asset.Status.AVAILABLE
            and "accessories" not in attrs
        ):
            raise serializers.ValidationError(
                {"accessory_ids": "Review the accessory list before making this asset available."}
            )
        if (
            not self.instance
            and attrs.get("status", Asset.Status.AVAILABLE) != Asset.Status.AVAILABLE
        ):
            raise serializers.ValidationError({"status": "New assets must start available."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        if not validated_data.get("asset_id"):
            validated_data["asset_id"] = next_asset_id()
        return super().create(validated_data)

    @transaction.atomic
    def update(self, instance, validated_data):
        old_status = instance.status
        updated = super().update(instance, validated_data)
        if updated.status != old_status:
            Event.objects.create(
                actor=self.context["request"].user,
                asset=updated,
                kind="asset_status_changed",
                details={"from": old_status, "to": updated.status},
            )
        return updated


class EventSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.name", read_only=True)

    class Meta:
        model = Event
        fields = ("id", "kind", "actor_name", "details", "created_at")


class CheckoutItemSerializer(serializers.ModelSerializer):
    closed_by_name = serializers.CharField(source="closed_by.name", read_only=True)

    class Meta:
        model = CheckoutItem
        fields = (
            "id",
            "asset",
            "asset_label",
            "asset_name",
            "accessory_snapshot",
            "missing_accessories",
            "status",
            "closed_at",
            "closed_by_name",
            "notes",
        )


class CheckoutSerializer(serializers.ModelSerializer):
    recipient = serializers.PrimaryKeyRelatedField(queryset=Recipient.objects.all(), required=False)
    recipient_data = RecipientSerializer(required=False, write_only=True)
    asset_id = serializers.IntegerField(min_value=1, write_only=True)
    accessory_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        write_only=True,
    )
    items = serializers.SerializerMethodField()
    events = EventSerializer(many=True, read_only=True)
    issued_by_name = serializers.CharField(source="issued_by.name", read_only=True)

    class Meta:
        model = Checkout
        fields = (
            "id",
            "recipient",
            "recipient_data",
            "recipient_first_name",
            "recipient_last_name",
            "recipient_phone",
            "asset_id",
            "accessory_ids",
            "items",
            "events",
            "issued_at",
            "issued_by_name",
        )
        read_only_fields = (
            "id",
            "recipient_first_name",
            "recipient_last_name",
            "recipient_phone",
            "items",
            "events",
            "issued_at",
            "issued_by_name",
        )

    def get_items(self, obj):
        items = list(obj.items.all())
        request = self.context.get("request")
        item_status = request.query_params.get("status") if request else None
        if item_status in CheckoutItem.Status.values:
            items = [item for item in items if item.status == item_status]
        return CheckoutItemSerializer(items, many=True, context=self.context).data

    def validate_accessory_ids(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Each accessory may be selected only once.")
        return value

    def validate(self, attrs):
        if self.instance is not None:
            return attrs
        has_recipient = attrs.get("recipient") is not None
        has_new_recipient = bool(attrs.get("recipient_data"))
        if has_recipient == has_new_recipient:
            raise serializers.ValidationError(
                {"recipient": "Select an existing person or enter a new recipient, not both."}
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        asset_id = validated_data.pop("asset_id")
        accessory_ids = validated_data.pop("accessory_ids", None)
        recipient_data = validated_data.pop("recipient_data", None)
        asset = (
            Asset.objects.select_for_update()
            .prefetch_related("accessories")
            .filter(pk=asset_id)
            .first()
        )
        if asset is None:
            raise serializers.ValidationError({"asset_id": "This asset does not exist."})
        if asset.status != Asset.Status.AVAILABLE:
            raise serializers.ValidationError({"asset_id": "This asset is not available."})
        configured_accessories = list(asset.accessories.all())
        configured_ids = {accessory.pk for accessory in configured_accessories}
        pending_items = asset.checkout_items.filter(
            status__in=[
                CheckoutItem.Status.PARTIALLY_RETURNED,
                CheckoutItem.Status.RETURNED_DAMAGED,
            ]
        )
        missing_accessory_ids = {
            accessory["id"]
            for item in pending_items
            for accessory in item.missing_accessories
        }
        selectable_ids = configured_ids - missing_accessory_ids
        selected_accessory_ids = set(accessory_ids) if accessory_ids is not None else selectable_ids
        if selected_accessory_ids - configured_ids:
            raise serializers.ValidationError(
                {"accessory_ids": f"An accessory is not assigned to {asset.name}."}
            )
        if selected_accessory_ids & missing_accessory_ids:
            raise serializers.ValidationError(
                {"accessory_ids": "Accessories still marked missing cannot be checked out."}
            )
        recipient = validated_data.pop("recipient", None)
        if recipient_data:
            recipient = Recipient.objects.create(**recipient_data)
        checkout = Checkout.objects.create(
            **validated_data,
            recipient=recipient,
            recipient_first_name=recipient.first_name,
            recipient_last_name=recipient.last_name,
            recipient_phone=recipient.phone,
            issued_by=self.context["request"].user,
        )
        CheckoutItem.objects.create(
            checkout=checkout,
            asset=asset,
            asset_label=asset.asset_id,
            asset_name=asset.name,
            accessory_snapshot=[
                {"id": accessory.id, "name": accessory.name}
                for accessory in sorted(
                    (
                        option
                        for option in configured_accessories
                        if option.pk in selected_accessory_ids
                    ),
                    key=lambda option: (option.name.lower(), option.id),
                )
            ],
        )
        asset.status = Asset.Status.CHECKED_OUT
        asset.save(update_fields=["status"])
        Event.objects.create(
            actor=checkout.issued_by,
            checkout=checkout,
            kind="checkout_created",
            details={"asset_names": [asset.name]},
        )
        return checkout

    @transaction.atomic
    def update(self, instance, validated_data):
        asset_id = validated_data.pop("asset_id", None)
        accessory_ids = validated_data.pop("accessory_ids", None)
        if validated_data:
            raise serializers.ValidationError("Only the checked-out asset and its accessories may be changed.")

        item = CheckoutItem.objects.select_for_update().select_related("asset").get(checkout=instance)
        if item.status != CheckoutItem.Status.CHECKED_OUT:
            raise serializers.ValidationError({"detail": "Only an active checkout can be edited."})

        next_asset = item.asset
        if asset_id is not None:
            next_asset = Asset.objects.select_for_update().prefetch_related("accessories").filter(pk=asset_id).first()
            if next_asset is None:
                raise serializers.ValidationError({"asset_id": "This asset does not exist."})
            if next_asset.pk != item.asset_id and next_asset.status != Asset.Status.AVAILABLE:
                raise serializers.ValidationError({"asset_id": "This asset is not available."})
        else:
            next_asset = Asset.objects.select_for_update().prefetch_related("accessories").get(pk=item.asset_id)

        configured = list(next_asset.accessories.all())
        configured_ids = {option.pk for option in configured}
        pending_items = next_asset.checkout_items.filter(
            status__in=[CheckoutItem.Status.PARTIALLY_RETURNED, CheckoutItem.Status.RETURNED_DAMAGED]
        )
        missing_ids = {
            accessory["id"]
            for prior_item in pending_items
            for accessory in prior_item.missing_accessories
        }
        selected_ids = set(accessory_ids) if accessory_ids is not None else (
            {entry["id"] for entry in item.accessory_snapshot} if next_asset.pk == item.asset_id else configured_ids
        )
        if selected_ids - configured_ids:
            raise serializers.ValidationError({"accessory_ids": f"An accessory is not assigned to {next_asset.name}."})
        if selected_ids & missing_ids:
            raise serializers.ValidationError({"accessory_ids": "Accessories still marked missing cannot be checked out."})

        old_asset = item.asset
        old_snapshot = item.accessory_snapshot
        new_snapshot = [
            {"id": option.id, "name": option.name}
            for option in sorted((option for option in configured if option.pk in selected_ids), key=lambda option: (option.name.lower(), option.id))
        ]
        if next_asset.pk != old_asset.pk:
            old_asset.status = Asset.Status.AVAILABLE
            old_asset.save(update_fields=["status"])
            next_asset.status = Asset.Status.CHECKED_OUT
            next_asset.save(update_fields=["status"])
            item.asset = next_asset
            item.asset_label = next_asset.asset_id
            item.asset_name = next_asset.name
        item.accessory_snapshot = new_snapshot
        item.save(update_fields=["asset", "asset_label", "asset_name", "accessory_snapshot"])

        if next_asset.pk != old_asset.pk or new_snapshot != old_snapshot:
            Event.objects.create(
                actor=self.context["request"].user,
                checkout=instance,
                asset=next_asset,
                kind="checkout_updated",
                details={
                    "previous_asset_name": old_asset.name,
                    "asset_name": next_asset.name,
                    "previous_accessories": old_snapshot,
                    "accessories": new_snapshot,
                },
            )
        instance._prefetched_objects_cache = {}
        return instance


class ResolveSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=["returned", "returned_damaged", "lost"])
    notes = serializers.CharField(required=False, allow_blank=True)
    missing_accessory_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, allow_empty=True
    )

    def validate_missing_accessory_ids(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Each missing accessory may be selected only once.")
        return value


class AccessoriesReceivedSerializer(serializers.Serializer):
    received_accessory_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), allow_empty=False
    )

    def validate_received_accessory_ids(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Each accessory may be selected only once.")
        return value
