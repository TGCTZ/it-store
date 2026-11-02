"""Authenticated office workflows and admin-only management endpoints."""

from django.contrib.auth import authenticate
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AccessoryOption, Asset, Borrower, Checkout, CheckoutItem, Event, User
from .serializers import (
    AccessoryOptionSerializer,
    AssetSerializer,
    BorrowerSerializer,
    CheckoutSerializer,
    ResolveSerializer,
    UserSerializer,
)


class IsAdmin(permissions.BasePermission):
    """Only authenticated IT administrators may change stock or accounts."""

    def has_permission(self, request, view):
        return bool(
            request.user.is_authenticated
            and (request.user.role == User.Role.ADMIN or request.user.is_superuser)
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


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.order_by("name")
    serializer_class = UserSerializer
    permission_classes = [IsAdmin]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def perform_update(self, serializer):
        user = self.get_object()
        if user == self.request.user:
            if serializer.validated_data.get("is_active") is False:
                raise ValidationError({"is_active": "You cannot deactivate your own account."})
            if serializer.validated_data.get("role") == User.Role.STAFF:
                raise ValidationError({"role": "You cannot remove your own admin role."})
        serializer.save()


class AssetViewSet(viewsets.ModelViewSet):
    serializer_class = AssetSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action in ("create", "partial_update"):
            return [IsAdmin()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        qs = Asset.objects.prefetch_related("accessories")
        q = self.request.query_params.get("q", "").strip()
        if q:
            qs = qs.filter(name__icontains=q)
        asset_status = self.request.query_params.get("status")
        if asset_status:
            qs = qs.filter(status=asset_status)
        return qs.order_by("name", "pk")


class AccessoryOptionViewSet(viewsets.ModelViewSet):
    serializer_class = AccessoryOptionSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action in ("create", "partial_update"):
            return [IsAdmin()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        queryset = AccessoryOption.objects.all()
        if not (self.request.user.role == User.Role.ADMIN or self.request.user.is_superuser):
            queryset = queryset.filter(is_active=True)
        return queryset.order_by("name", "pk")


class BorrowerViewSet(viewsets.ModelViewSet):
    serializer_class = BorrowerSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = Borrower.objects.all()
        q = self.request.query_params.get("q", "").strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(phone__icontains=q))
        return qs


class CheckoutViewSet(viewsets.ModelViewSet):
    serializer_class = CheckoutSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = Checkout.objects.select_related("borrower", "issued_by").prefetch_related(
            "items__asset", "items__closed_by", "events__actor"
        )
        q = self.request.query_params.get("q", "").strip()
        if q:
            qs = qs.filter(
                Q(borrower_name__icontains=q)
                | Q(borrower_phone__icontains=q)
                | Q(items__asset_name__icontains=q)
            ).distinct()
        checkout_status = self.request.query_params.get("status")
        if checkout_status == "overdue":
            qs = qs.filter(due_date__lt=timezone.localdate(), items__status=CheckoutItem.Status.OUT)
        elif checkout_status == "active":
            qs = qs.filter(
                due_date__gte=timezone.localdate(), items__status=CheckoutItem.Status.OUT
            )
        elif checkout_status == "closed":
            qs = qs.exclude(items__status=CheckoutItem.Status.OUT)
        return qs.distinct().order_by("-issued_at", "-pk")

    def update(self, request, *args, **kwargs):
        if not kwargs.get("partial", False):
            return Response({"detail": "Use PATCH to change a due date."}, status=405)
        allowed = {"due_date", "notes"}
        if set(request.data) - allowed:
            raise ValidationError({"detail": "Only due_date and notes may be changed."})
        return super().update(request, *args, **kwargs)


class ResolveItemView(APIView):
    @transaction.atomic
    def post(self, request, pk):
        serializer = ResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = (
            CheckoutItem.objects.select_for_update().select_related("asset").filter(pk=pk).first()
        )
        if not item:
            return Response({"detail": "Item not found."}, status=404)
        if item.status != CheckoutItem.Status.OUT:
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
        item.status = outcome
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
        elif missing_accessories:
            asset.status = Asset.Status.INCOMPLETE
        elif outcome == "damaged":
            asset.status = Asset.Status.DAMAGED
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


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def dashboard(request):
    """Provide a small summary without a reporting subsystem."""
    counts = {key: Asset.objects.filter(status=key).count() for key, _ in Asset.Status.choices}
    counts["overdue"] = CheckoutItem.objects.filter(
        status=CheckoutItem.Status.OUT, checkout__due_date__lt=timezone.localdate()
    ).count()
    return Response(counts)
