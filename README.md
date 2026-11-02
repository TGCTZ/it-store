# TGC IT Store

A small office-network app for lending individually identified IT devices and tools. IT staff record checkouts and returns; borrowers do not need accounts. The frontend uses the TGC logo and palette from the `service` project, and the backend follows its Django REST API and JWT sign-in approach. Domain-specific gem, billing, payment, and certificate code was not carried over.

For component-specific setup and maintenance details, see the [backend README](backend/README.md) and [frontend README](frontend/README.md).

## Requirements

- Python 3.13 or newer, [uv](https://docs.astral.sh/uv/), Node.js 24 or newer, and pnpm
- PostgreSQL for normal operation

## Local setup

1. Create an empty PostgreSQL database and a user with access to it.
2. In `backend`, copy `.env.example` to `.env`. Set `SECRET_KEY`, `DATABASE_URL`, `ALLOWED_HOSTS`, and `CORS_ALLOWED_ORIGINS` for your computer. Never commit `.env`.
3. Run `uv sync`, then `uv run python manage.py migrate` and `uv run python manage.py createsuperuser`. The superuser is the first IT Store admin.
4. Start the API with `uv run python manage.py runserver 0.0.0.0:8000`.
5. In `frontend`, run `pnpm install` and `pnpm dev`. Open the address printed by Vite and sign in with the admin account. The development server proxies `/api` to `localhost:8000`.

For an office-network deployment, configure a production WSGI server and static web server after the host operating system is selected. Use `DEBUG=False`, a strong secret key, appropriate host and origin lists, HTTPS where possible, and regular PostgreSQL backups. The Django development server and Vite development server are for development only.

## Daily workflow

1. An admin registers each physical asset with a unique name, such as `Projector 1`. The app generates and keeps its internal ID out of the staff interface.
2. Admins maintain a shared accessory checklist, seeded with power cables, chargers, common cables, remotes, cases, and batteries. When registering an asset, an admin checks the accessories included with it; the same options can be used for any asset type.
3. Staff create a checkout by finding an existing borrower or registering a new one in the same form. New contacts require a name and phone number and can be reused.
4. Staff select one or more available assets and set a due date before creating the checkout.
5. On return, staff confirm each asset’s listed accessories and record the outcome. Missing accessories make the asset incomplete and unavailable until an admin resolves it; damaged and lost assets also remain unavailable until an admin changes their status.
6. The dashboard and checkout filter show overdue items. Dates use `Africa/Dar_es_Salaam` unless `TIME_ZONE` is changed.

Admins can manage assets, shared accessory options, and staff accounts. Staff can view assets and manage borrowers, checkouts, returns, and due dates. Asset names are unique; the internal asset ID is generated automatically and is not shown in the interface. All API endpoints require authentication except login and token refresh. There is no borrower login, automatic message, receipt, signature, or import process.

## API

The API is under `/api/v1/`. Main resources are `assets/`, `accessories/`, `borrowers/`, `checkouts/`, and admin-only `users/`. Staff can use `checkout-items/{id}/resolve/` to record an outcome and missing accessories, and `PATCH checkouts/{id}/` to change a due date. `dashboard/` returns summary counts, including incomplete assets. Authentication endpoints are `auth/login/`, `auth/refresh/`, `auth/logout/`, `auth/me/`, and `auth/password/`.

Search assets, borrowers, and checkouts with `?q=`, and filter assets or checkouts with `?status=`. List responses use 25-item pages. Checkout history records the issuing staff member, borrower details, asset names and accessories as they were at issue time, due-date changes, item outcomes, and any accessories reported missing.

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
