"""Input validation and stable JSON shapes for the office UI."""

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from .models import (
    AccessoryOption,
    Asset,
    AssetSequence,
    Borrower,
    Checkout,
    CheckoutItem,
    Event,
    User,
)


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=8)

    class Meta:
        model = User
        fields = ("id", "email", "name", "role", "is_active", "password")

    def validate(self, attrs):
        if not self.instance and not attrs.get("password"):
            raise serializers.ValidationError({"password": "An initial password is required."})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        return User.objects.create_user(password=password, **validated_data)

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for name, value in validated_data.items():
            setattr(instance, name, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class BorrowerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Borrower
        fields = ("id", "name", "phone", "borrower_type", "notes", "created_at")
        read_only_fields = ("id", "created_at")

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Name is required.")
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
        fields = ("id", "name", "is_active")
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

    def validate_accessory_ids(self, value):
        selected = {option.pk for option in value}
        active = set(AccessoryOption.objects.filter(is_active=True).values_list("pk", flat=True))
        existing = (
            set(self.instance.accessories.values_list("pk", flat=True)) if self.instance else set()
        )
        if selected - active - existing:
            raise serializers.ValidationError("Inactive accessories cannot be added to an asset.")
        return value

    def validate(self, attrs):
        if self.instance and self.instance.status == Asset.Status.ON_LOAN:
            new_status = attrs.get("status", self.instance.status)
            if new_status != Asset.Status.ON_LOAN:
                raise serializers.ValidationError(
                    {"status": "An item on loan cannot be changed here."}
                )
        if self.instance and attrs.get("status") == Asset.Status.ON_LOAN:
            if self.instance.status != Asset.Status.ON_LOAN:
                raise serializers.ValidationError(
                    {"status": "Only a checkout may put an asset on loan."}
                )
        if (
            self.instance
            and self.instance.status == Asset.Status.INCOMPLETE
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
    borrower = serializers.PrimaryKeyRelatedField(queryset=Borrower.objects.all(), required=False)
    borrower_data = BorrowerSerializer(required=False, write_only=True)
    asset_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        write_only=True,
        required=True,
        allow_empty=False,
    )
    items = CheckoutItemSerializer(many=True, read_only=True)
    events = EventSerializer(many=True, read_only=True)
    issued_by_name = serializers.CharField(source="issued_by.name", read_only=True)
    status = serializers.SerializerMethodField()

    class Meta:
        model = Checkout
        fields = (
            "id",
            "borrower",
            "borrower_data",
            "borrower_name",
            "borrower_phone",
            "asset_ids",
            "items",
            "events",
            "issued_at",
            "issued_by_name",
            "due_date",
            "notes",
            "status",
        )
        read_only_fields = (
            "id",
            "borrower_name",
            "borrower_phone",
            "items",
            "events",
            "issued_at",
            "issued_by_name",
            "status",
        )

    def get_status(self, obj):
        if not any(item.status == CheckoutItem.Status.OUT for item in obj.items.all()):
            return "closed"
        if obj.due_date < timezone.localdate():
            return "overdue"
        return "active"

    def validate_asset_ids(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Each asset may appear only once.")
        return value

    def validate(self, attrs):
        if self.instance is not None:
            return attrs
        has_borrower = attrs.get("borrower") is not None
        has_new_borrower = bool(attrs.get("borrower_data"))
        if has_borrower == has_new_borrower:
            raise serializers.ValidationError(
                {"borrower": "Select an existing borrower or enter a new borrower, not both."}
            )
        return attrs

    def validate_due_date(self, value):
        if not self.instance and value < timezone.localdate():
            raise serializers.ValidationError("The due date cannot be in the past.")
        return value

    @transaction.atomic
    def create(self, validated_data):
        asset_ids = validated_data.pop("asset_ids")
        borrower_data = validated_data.pop("borrower_data", None)
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
        borrower = validated_data.pop("borrower", None)
        if borrower_data:
            borrower = Borrower.objects.create(**borrower_data)
        checkout = Checkout.objects.create(
            **validated_data,
            borrower=borrower,
            borrower_name=borrower.name,
            borrower_phone=borrower.phone,
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
                            asset.accessories.all(),
                            key=lambda option: (option.name.lower(), option.id),
                        )
                    ],
                )
                for asset in assets
            ]
        )
        Asset.objects.filter(pk__in=asset_ids).update(status=Asset.Status.ON_LOAN)
        Event.objects.create(
            actor=checkout.issued_by,
            checkout=checkout,
            kind="checkout_created",
            details={"asset_names": [asset.name for asset in assets]},
        )
        return checkout

    @transaction.atomic
    def update(self, instance, validated_data):
        if "asset_ids" in validated_data or "borrower" in validated_data:
            raise serializers.ValidationError("Only the due date and notes may change.")
        if (
            "due_date" in validated_data
            and not instance.items.filter(status=CheckoutItem.Status.OUT).exists()
        ):
            raise serializers.ValidationError(
                {"due_date": "A closed checkout has no active due date."}
            )
        old_due_date = instance.due_date
        instance = super().update(instance, validated_data)
        if instance.due_date != old_due_date:
            Event.objects.create(
                actor=self.context["request"].user,
                checkout=instance,
                kind="due_date_changed",
                details={"from": old_due_date.isoformat(), "to": instance.due_date.isoformat()},
            )
        return instance


class ResolveSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=["returned", "damaged", "lost"])
    notes = serializers.CharField(required=False, allow_blank=True)
    missing_accessory_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, allow_empty=True
    )

    def validate_missing_accessory_ids(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Each missing accessory may be selected only once.")
        return value
