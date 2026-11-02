"""Inventory application configuration."""

from django.apps import AppConfig


class InventoryConfig(AppConfig):
    """Registers inventory models and API behavior."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "inventory"
