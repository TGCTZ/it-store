"""API routes for authentication and lending."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    AccessoryOptionViewSet,
    AssetViewSet,
    BorrowerViewSet,
    ChangePasswordView,
    CheckoutViewSet,
    LoginView,
    LogoutView,
    MeView,
    ResolveItemView,
    UserViewSet,
    dashboard,
)

router = DefaultRouter()
router.register("assets", AssetViewSet, basename="asset")
router.register("accessories", AccessoryOptionViewSet, basename="accessory")
router.register("borrowers", BorrowerViewSet, basename="borrower")
router.register("checkouts", CheckoutViewSet, basename="checkout")
router.register("users", UserViewSet, basename="user")

urlpatterns = [
    path("auth/login/", LoginView.as_view()),
    path("auth/refresh/", TokenRefreshView.as_view()),
    path("auth/logout/", LogoutView.as_view()),
    path("auth/me/", MeView.as_view()),
    path("auth/password/", ChangePasswordView.as_view()),
    path("dashboard/", dashboard),
    path("checkout-items/<int:pk>/resolve/", ResolveItemView.as_view()),
    path("", include(router.urls)),
]
