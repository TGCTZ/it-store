"""People, assets and immutable lending history for the IT office."""

from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone


class UserManager(BaseUserManager):
    """Create the one email-based IT Store account."""

    use_in_migrations = True

    def create_user(self, email, password=None, **fields):
        if not email:
            raise ValueError("An email address is required")
        if self.model.objects.exists():
            raise ValueError("The IT Store supports only one login account")
        fields.update(singleton_key=1, is_staff=True, is_superuser=True)
        user = self.model(email=self.normalize_email(email), **fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **fields):
        return self.create_user(email, password, **fields)


class User(AbstractUser):
    """The single login account; recipients are contacts without login access."""

    username = None
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=160)
    singleton_key = models.PositiveSmallIntegerField(default=1, unique=True, editable=False)
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]
    objects = UserManager()

    def __str__(self):
        return self.name or self.email


class Recipient(models.Model):
    """Reusable contact details for anyone who borrows IT equipment."""

    class Type(models.TextChoices):
        EMPLOYEE = "employee", "Employee"
        STUDENT = "student", "Student"
        GUEST = "guest", "Guest"

    first_name = models.CharField(max_length=160)
    last_name = models.CharField(max_length=160)
    phone = models.CharField(max_length=40)
    recipient_type = models.CharField(max_length=12, choices=Type.choices, default=Type.EMPLOYEE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["first_name", "last_name", "id"]

    def __str__(self):
        return self.first_name


class AssetSequence(models.Model):
    """Single locked counter used for generated asset labels."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    next_number = models.PositiveIntegerField(default=1)


class AccessoryOption(models.Model):
    """Reusable accessory labels shown as checkboxes for every asset type."""

    name = models.CharField(max_length=100)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="unique_accessory_name_ci"),
        ]

    def __str__(self):
        return self.name


class Asset(models.Model):
    """A physical device or tool with one permanent, unique identifier."""

    class Status(models.TextChoices):
        AVAILABLE = "available", "Available"
        CHECKED_OUT = "checked_out", "Checked out"
        NEEDS_REPAIR = "needs_repair", "Needs repair"
        LOST = "lost", "Lost"
        MISSING_ACCESSORIES = "missing_accessories", "Missing accessories"
        RETIRED = "retired", "Retired"

    asset_id = models.CharField(max_length=80, unique=True)
    name = models.CharField(max_length=160)
    category = models.CharField(max_length=100, blank=True)
    serial_number = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)
    accessories = models.ManyToManyField(AccessoryOption, related_name="assets", blank=True)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.AVAILABLE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="unique_asset_name_ci"),
        ]

    def save(self, *args, **kwargs):
        self.asset_id = self.asset_id.strip().upper()
        self.name = self.name.strip()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Checkout(models.Model):
    """One handover of one asset to a recipient."""

    recipient = models.ForeignKey(Recipient, on_delete=models.PROTECT, related_name="checkouts")
    recipient_first_name = models.CharField(max_length=160)
    recipient_last_name = models.CharField(max_length=160)
    recipient_phone = models.CharField(max_length=40)
    issued_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="issued_checkouts")
    issued_at = models.DateTimeField(default=timezone.now)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-issued_at", "-id"]

    def __str__(self):
        return f"Checkout #{self.pk}"


class CheckoutItem(models.Model):
    """The single asset outcome for one checkout."""

    class Status(models.TextChoices):
        CHECKED_OUT = "checked_out", "Checked out"
        RETURNED = "returned", "Returned"
        PARTIALLY_RETURNED = "partially_returned", "Partially returned"
        RETURNED_DAMAGED = "returned_damaged", "Returned damaged"
        LOST = "lost", "Lost"

    checkout = models.ForeignKey(Checkout, on_delete=models.PROTECT, related_name="items")
    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="checkout_items")
    asset_label = models.CharField(max_length=80)
    asset_name = models.CharField(max_length=160)
    accessory_snapshot = models.JSONField(default=list)
    missing_accessories = models.JSONField(default=list)
    status = models.CharField(max_length=18, choices=Status.choices, default=Status.CHECKED_OUT)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(User, on_delete=models.PROTECT, null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["checkout"], name="unique_item_per_checkout"),
            models.UniqueConstraint(
                fields=["asset"], condition=Q(status="checked_out"), name="unique_checked_out_asset"
            )
        ]


class Event(models.Model):
    """Automatic record of material changes to a checkout or asset."""

    actor = models.ForeignKey(User, on_delete=models.PROTECT)
    checkout = models.ForeignKey(
        Checkout, on_delete=models.PROTECT, null=True, blank=True, related_name="events"
    )
    asset = models.ForeignKey(
        Asset, on_delete=models.PROTECT, null=True, blank=True, related_name="events"
    )
    kind = models.CharField(max_length=40)
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
