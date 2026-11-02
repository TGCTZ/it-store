"""Admin access for inspecting data and restoring staff accounts."""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import AccessoryOption, Asset, Borrower, Checkout, CheckoutItem, Event, User


@admin.register(User)
class StaffAdmin(UserAdmin):
    list_display = ("email", "name", "role", "is_active")
    ordering = ("email",)
    search_fields = ("email", "name")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Staff", {"fields": ("name", "role", "is_active", "is_staff", "is_superuser")}),
    )
    add_fieldsets = ((None, {"fields": ("email", "name", "role", "password1", "password2")}),)


class HistoryAdmin(admin.ModelAdmin):
    """Keep domain history visible without bypassing the audited API workflows."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


for model in (AccessoryOption, Asset, Borrower, Checkout, CheckoutItem, Event):
    admin.site.register(model, HistoryAdmin)
