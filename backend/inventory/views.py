"""Authenticated office workflows for the single IT Store account."""

from django.contrib.auth import authenticate
from django.db import transaction
from django.db.models import Prefetch, Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AccessoryOption, Asset, Checkout, CheckoutItem, Event, Recipient
from .serializers import (
    AccessoriesReceivedSerializer,
    AccessoryOptionSerializer,
    AssetSerializer,
    CheckoutSerializer,
    RecipientSerializer,
    ResolveSerializer,
    UserSerializer,
)


class IsSuperuser(permissions.BasePermission):
    """Require the single account for administrative operations."""

    def has_permission(self, request, view):
        return bool(
            request.user.is_authenticated
            and request.user.is_superuser
        )


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        user = authenticate(
            request,
            username=request.data.get("email", ""),
            password=request.data.get("password", ""),
        )
        if not user:
            raise ValidationError({"detail": "Invalid email or password."})
        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": UserSerializer(user).data,
            }
        )


class LogoutView(APIView):
    def post(self, request):
        refresh = request.data.get("refresh")
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except Exception:
                pass  # An expired token still leaves the client logged out.
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class ChangePasswordView(APIView):
    def post(self, request):
        old = request.data.get("current_password", "")
        new = request.data.get("new_password", "")
        if not request.user.check_password(old):
            raise ValidationError({"current_password": "The current password is incorrect."})
        if len(new) < 8:
            raise ValidationError({"new_password": "Use at least eight characters."})
        request.user.set_password(new)
        request.user.save(update_fields=["password"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class AssetViewSet(viewsets.ModelViewSet):
    serializer_class = AssetSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        if self.action in ("create", "partial_update", "destroy"):
            return [IsSuperuser()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        partial_items = CheckoutItem.objects.filter(
            status__in=[
                CheckoutItem.Status.PARTIALLY_RETURNED,
                CheckoutItem.Status.RETURNED_DAMAGED,
            ]
        )
        qs = Asset.objects.prefetch_related(
            "accessories",
            Prefetch("checkout_items", queryset=partial_items, to_attr="partial_checkout_items"),
        )
        q = self.request.query_params.get("q", "").strip()
        if q:
            qs = qs.filter(name__icontains=q)
        asset_status = self.request.query_params.get("status")
        if asset_status:
            qs = qs.filter(status=asset_status)
        return qs.order_by("name", "pk")

    def destroy(self, request, *args, **kwargs):
        asset = self.get_object()
        if asset.checkout_items.exists() or asset.events.exists():
            return Response(
                {"detail": "This asset has checkout history. Retire it to preserve its records."},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


class AccessoryOptionViewSet(viewsets.ModelViewSet):
    serializer_class = AccessoryOptionSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        if self.action in ("create", "partial_update", "destroy"):
            return [IsSuperuser()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        return AccessoryOption.objects.all().order_by("name", "pk")

    def destroy(self, request, *args, **kwargs):
        option = self.get_object()
        if option.assets.exists():
            return Response(
                {"detail": "This option is assigned to assets. Remove it from those assets first."},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


class PeopleViewSet(viewsets.ModelViewSet):
    serializer_class = RecipientSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        if self.action in ("create", "partial_update", "destroy"):
            return [IsSuperuser()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        qs = Recipient.objects.all()
        q = self.request.query_params.get("q", "").strip()
        if q:
            name_query = Q()
            for word in q.split():
                name_query &= Q(first_name__icontains=word) | Q(last_name__icontains=word)
            qs = qs.filter(name_query | Q(phone__icontains=q))
        return qs

    def destroy(self, request, *args, **kwargs):
        person = self.get_object()
        if person.checkouts.exists():
            return Response(
                {"detail": "This person has checkout history and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


class CheckoutViewSet(viewsets.ModelViewSet):
    serializer_class = CheckoutSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update"):
            return [IsSuperuser()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        qs = Checkout.objects.select_related("recipient", "issued_by").prefetch_related(
            "items__asset", "items__closed_by", "events__actor"
        )
        q = self.request.query_params.get("q", "").strip()
        if q:
            recipient_query = Q()
            for word in q.split():
                recipient_query &= (
                    Q(recipient_first_name__icontains=word)
                    | Q(recipient_last_name__icontains=word)
                )
            qs = qs.filter(
                recipient_query
                | Q(recipient_phone__icontains=q)
                | Q(items__asset_name__icontains=q)
            ).distinct()
        item_status = self.request.query_params.get("status")
        if item_status in CheckoutItem.Status.values:
            qs = qs.filter(items__status=item_status).distinct()
        return qs.distinct().order_by("-issued_at", "-pk")

    def update(self, request, *args, **kwargs):
        if not kwargs.get("partial", False):
            return Response({"detail": "Use PATCH to update checkout notes."}, status=405)
        allowed = {"notes"}
        if set(request.data) - allowed:
            raise ValidationError({"detail": "Only checkout notes may be changed."})
        return super().update(request, *args, **kwargs)


class ResolveItemView(APIView):
    permission_classes = [IsSuperuser]

    @transaction.atomic
    def post(self, request, pk):
        serializer = ResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = (
            CheckoutItem.objects.select_for_update().select_related("asset").filter(pk=pk).first()
        )
        if not item:
            return Response({"detail": "Item not found."}, status=404)
        if item.status != CheckoutItem.Status.CHECKED_OUT:
            raise ValidationError({"detail": "This item was already resolved."})
        asset = Asset.objects.select_for_update().get(pk=item.asset_id)
        outcome = serializer.validated_data["outcome"]
        if (
            outcome != "lost"
            and item.accessory_snapshot
            and "missing_accessory_ids" not in serializer.validated_data
        ):
            raise ValidationError(
                {"missing_accessory_ids": "Confirm whether each included accessory came back."}
            )
        missing_ids = serializer.validated_data.get("missing_accessory_ids", [])
        accessory_snapshot = item.accessory_snapshot
        snapshot_by_id = {entry["id"]: entry for entry in accessory_snapshot}
        if outcome == "lost" and missing_ids:
            raise ValidationError(
                {"missing_accessory_ids": "Accessories cannot be confirmed for a lost asset."}
            )
        if set(missing_ids) - snapshot_by_id.keys():
            raise ValidationError(
                {"missing_accessory_ids": "Select only accessories recorded for this asset."}
            )
        missing_accessories = [snapshot_by_id[pk] for pk in missing_ids]
        item.status = (
            CheckoutItem.Status.PARTIALLY_RETURNED
            if outcome == "returned" and missing_accessories
            else outcome
        )
        item.closed_at = timezone.now()
        item.closed_by = request.user
        item.notes = serializer.validated_data.get("notes", "")
        item.missing_accessories = missing_accessories
        item.save(
            update_fields=[
                "status",
                "closed_at",
                "closed_by",
                "notes",
                "missing_accessories",
            ]
        )
        if outcome == "lost":
            asset.status = Asset.Status.LOST
        elif outcome == "returned_damaged":
            asset.status = Asset.Status.NEEDS_REPAIR
        else:
            asset.status = Asset.Status.AVAILABLE
        asset.save(update_fields=["status"])
        Event.objects.create(
            actor=request.user,
            checkout=item.checkout,
            asset=asset,
            kind="item_resolved",
            details={
                "outcome": outcome,
                "notes": item.notes,
                "missing_accessories": missing_accessories,
            },
        )
        return Response({"id": item.pk, "status": item.status, "asset_status": asset.status})


class AccessoriesReceivedView(APIView):
    permission_classes = [IsSuperuser]

    @transaction.atomic
    def post(self, request, pk):
        serializer = AccessoriesReceivedSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = (
            CheckoutItem.objects.select_for_update()
            .select_related("asset", "checkout")
            .filter(pk=pk)
            .first()
        )
        if not item:
            return Response({"detail": "Item not found."}, status=404)
        if item.status not in {
            CheckoutItem.Status.PARTIALLY_RETURNED,
            CheckoutItem.Status.RETURNED_DAMAGED,
        } or not item.missing_accessories:
            raise ValidationError({"detail": "This item has no missing accessories to record."})

        snapshot_by_id = {entry["id"]: entry for entry in item.missing_accessories}
        received_ids = set(serializer.validated_data["received_accessory_ids"])
        if received_ids - snapshot_by_id.keys():
            raise ValidationError(
                {"received_accessory_ids": "Select only accessories currently marked missing."}
            )
        received = [entry for entry in item.missing_accessories if entry["id"] in received_ids]
        remaining = [entry for entry in item.missing_accessories if entry["id"] not in received_ids]
        previous_status = item.status
        item.missing_accessories = remaining
        if previous_status == CheckoutItem.Status.PARTIALLY_RETURNED and not remaining:
            item.status = CheckoutItem.Status.RETURNED
        item.save(update_fields=["missing_accessories", "status"])

        asset = Asset.objects.select_for_update().get(pk=item.asset_id)
        has_checked_out_item = CheckoutItem.objects.filter(
            asset=asset, status=CheckoutItem.Status.CHECKED_OUT
        ).exists()
        if has_checked_out_item:
            asset.status = Asset.Status.CHECKED_OUT
        elif asset.status == Asset.Status.NEEDS_REPAIR:
            pass
        else:
            asset.status = Asset.Status.AVAILABLE
        asset.save(update_fields=["status"])
        Event.objects.create(
            actor=request.user,
            checkout=item.checkout,
            asset=asset,
            kind="accessories_received",
            details={
                "received_accessories": received,
                "remaining_missing_accessories": remaining,
            },
        )
        return Response(
            {
                "id": item.pk,
                "status": item.status,
                "missing_accessories": remaining,
                "asset_status": asset.status,
            }
        )


