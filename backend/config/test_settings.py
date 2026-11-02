"""Isolated SQLite settings for the automated test suite."""

import os

os.environ["SECRET_KEY"] = "test-only-secret-with-at-least-32-bytes"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from .settings import *  # noqa: E402,F403

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
