# TGC IT Store

A small office-network app for lending individually identified IT devices and tools. Superadmins record checkouts and returns; people receiving equipment do not need accounts. The frontend uses the TGC logo and palette from the `service` project, and the backend follows its Django REST API and JWT sign-in approach. Domain-specific gem, billing, payment, and certificate code was not carried over.

For component-specific setup and maintenance details, see the [backend README](backend/README.md) and [frontend README](frontend/README.md).

## Requirements

- Python 3.13 or newer, [uv](https://docs.astral.sh/uv/), Node.js 24 or newer, and pnpm
- PostgreSQL for normal operation

## Local setup

1. Create an empty PostgreSQL database and a user with access to it. Since this project now uses one clean initial migration, drop and recreate any older development database before applying it.
2. In `backend`, copy `.env.example` to `.env`. Set `SECRET_KEY`, `DATABASE_URL`, `ALLOWED_HOSTS`, and `CORS_ALLOWED_ORIGINS` for your computer. Never commit `.env`.
3. Use a fresh development database, then run `uv sync`, `uv run python manage.py migrate`, and `uv run python manage.py createsuperuser` to create the one login account. Recreate the existing superuser with the same email if desired; its old database row is removed by the reset.
4. Start the API with `uv run python manage.py runserver 0.0.0.0:8000`.
5. In `frontend`, run `pnpm install` and `pnpm dev`. Open the address printed by Vite and sign in with the Superadmin account. The development server proxies `/api` to `localhost:8000`.

For an office-network deployment, configure a production WSGI server and static web server after the host operating system is selected. Use `DEBUG=False`, a strong secret key, appropriate host and origin lists, HTTPS where possible, and regular PostgreSQL backups. The Django development server and Vite development server are for development only.

## Daily workflow

1. The clean initial migration seeds `Projector 1`, `Projector 2`, and `Projector 3` as available assets. A Superadmin can add more physical assets with unique names; the app generates and keeps each internal ID out of the interface.
2. Superadmins maintain a shared accessory checklist, seeded with power cables, chargers, common cables, remotes, cases, and batteries. When registering an asset, a Superadmin checks the accessories included with it; the same options can be used for any asset type.
3. A Superadmin creates a checkout by finding an existing person or registering a new recipient in the same form. New contacts require a name and phone number and can be reused.
4. The Superadmin selects one or more available assets before creating the checkout. Each selected asset shows its configured accessories as checked boxes; accessories staying in the office can be unchecked. Only checked accessories are recorded as going out and confirmed on return.
5. On return, a Superadmin confirms each asset’s listed accessories and records the outcome. Asset statuses are Available, Checked out, Missing accessories, Needs repair, Lost, or Retired. Checkout statuses are Active, Partially returned, Closed, or Cancelled. Missing accessories or damage keep an asset unavailable until a Superadmin resolves it; lost assets also remain unavailable until restored.
The system has one Superadmin login. Account creation and management are not available in the app, API, or Django admin; initialize the account with `createsuperuser`. The Superadmin can change their own password. Asset names are unique; the internal asset ID is generated automatically and is not shown in the interface. All API endpoints require authentication except login and token refresh. Recipients do not sign in; there are no automatic messages, receipts, signatures, or import process.

## API

The API is under `/api/v1/`. Main resources are `assets/`, `accessories/`, `people/`, and `checkouts/`. Checkouts use `recipient` or `recipient_data`; the Superadmin uses `checkout-items/{id}/resolve/` to record an outcome and missing accessories.

Search assets, people, and checkouts with `?q=`, and filter assets or checkouts with `?status=`. List responses use 25-item pages. Checkout history records the issuing Superadmin, recipient details, asset names and accessories as they were at issue time, due-date changes, item outcomes, and any accessories reported missing.

## Verification

Run backend checks from `backend`:

```powershell
uv run python manage.py test --settings=config.test_settings
uv run python manage.py makemigrations --check --dry-run --settings=config.test_settings
uv run ruff check .
```

Run frontend checks from `frontend`:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

During initial implementation, backend API tests passed using the template's existing Python environment and isolated SQLite test settings. Frontend unit tests, typecheck, lint, and production build passed using the template's existing installed packages because the package registry was unavailable. Reinstall dependencies in this project and rerun all commands in its target environment before deployment. PostgreSQL deployment tests remain to be run on the office server.
