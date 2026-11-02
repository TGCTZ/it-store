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

    class Meta:
        model = Asset
        fields = (
            "id",
            "asset_id",
            "name",
            "notes",
            "accessory_ids",
            "accessory_items",
            "status",
            "created_at",
        )
        read_only_fields = ("id", "created_at")

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


class AssetAccessorySelectionSerializer(serializers.Serializer):
    asset = serializers.IntegerField(min_value=1)
    accessory_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), allow_empty=True
    )


class CheckoutSerializer(serializers.ModelSerializer):
    recipient = serializers.PrimaryKeyRelatedField(queryset=Recipient.objects.all(), required=False)
    recipient_data = RecipientSerializer(required=False, write_only=True)
    asset_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        write_only=True,
        required=True,
        allow_empty=False,
    )
    asset_accessories = AssetAccessorySelectionSerializer(
        many=True, required=False, write_only=True
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
            "asset_ids",
            "asset_accessories",
            "items",
            "events",
            "issued_at",
            "issued_by_name",
            "notes",
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

    def validate_asset_ids(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Each asset may appear only once.")
        return value

    def validate(self, attrs):
        if self.instance is not None:
            return attrs
        selections = attrs.get("asset_accessories")
        if selections is not None:
            selected_assets = set(attrs["asset_ids"])
            selection_asset_ids = [selection["asset"] for selection in selections]
            if len(selection_asset_ids) != len(set(selection_asset_ids)):
                raise serializers.ValidationError(
                    {"asset_accessories": "Each asset may have one accessory selection."}
                )
            if set(selection_asset_ids) != selected_assets:
                raise serializers.ValidationError(
                    {"asset_accessories": "Provide accessory selections for every selected asset."}
                )
            if any(
                len(selection["accessory_ids"]) != len(set(selection["accessory_ids"]))
                for selection in selections
            ):
                raise serializers.ValidationError(
                    {"asset_accessories": "Each accessory may be selected only once per asset."}
                )
        has_recipient = attrs.get("recipient") is not None
        has_new_recipient = bool(attrs.get("recipient_data"))
        if has_recipient == has_new_recipient:
            raise serializers.ValidationError(
                {"recipient": "Select an existing person or enter a new recipient, not both."}
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        asset_ids = validated_data.pop("asset_ids")
        accessory_selections = validated_data.pop("asset_accessories", None)
        recipient_data = validated_data.pop("recipient_data", None)
        assets = list(
            Asset.objects.select_for_update()
            .prefetch_related("accessories")
            .filter(pk__in=asset_ids)
            .order_by("pk")
        )
        if len(assets) != len(asset_ids):
            raise serializers.ValidationError({"asset_ids": "One or more assets do not exist."})
        if any(asset.status != Asset.Status.AVAILABLE for asset in assets):
            raise serializers.ValidationError({"asset_ids": "All assets must be available."})
        selection_map = (
            {selection["asset"]: set(selection["accessory_ids"]) for selection in accessory_selections}
            if accessory_selections is not None
            else None
        )
        for asset in assets:
            if selection_map is not None:
                configured_ids = set(asset.accessories.values_list("pk", flat=True))
                if selection_map[asset.pk] - configured_ids:
                    raise serializers.ValidationError(
                        {"asset_accessories": f"An accessory is not assigned to {asset.name}."}
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
        CheckoutItem.objects.bulk_create(
            [
                CheckoutItem(
                    checkout=checkout,
                    asset=asset,
                    asset_label=asset.asset_id,
                    asset_name=asset.name,
                    accessory_snapshot=[
                        {"id": accessory.id, "name": accessory.name}
                        for accessory in sorted(
                            asset.accessories.filter(
                                pk__in=selection_map[asset.pk]
                                if selection_map is not None
                                else asset.accessories.values_list("pk", flat=True)
                            ),
                            key=lambda option: (option.name.lower(), option.id),
                        )
                    ],
                )
                for asset in assets
            ]
        )
        Asset.objects.filter(pk__in=asset_ids).update(status=Asset.Status.CHECKED_OUT)
        Event.objects.create(
            actor=checkout.issued_by,
            checkout=checkout,
            kind="checkout_created",
            details={"asset_names": [asset.name for asset in assets]},
        )
        return checkout

    @transaction.atomic
    def update(self, instance, validated_data):
        if set(validated_data) - {"notes"}:
            raise serializers.ValidationError("Only checkout notes may be changed.")
        return super().update(instance, validated_data)


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
