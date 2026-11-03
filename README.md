# TGC IT Store

A small office-network app for lending individually identified IT devices and tools. Superadmins record checkouts and returns; people receiving equipment do not need accounts. The frontend uses the TGC logo and palette from the `service` project, and the backend follows its Django REST API and JWT sign-in approach. Domain-specific gem, billing, payment, and certificate code was not carried over.

For component-specific setup and maintenance details, see the [backend README](backend/README.md) and [frontend README](frontend/README.md).

## Windows PC setup

Install Python 3.13 or newer, [uv](https://docs.astral.sh/uv/), Node.js 24 or newer, and pnpm on the PC. Copy this project folder onto that PC, then double-click `Setup IT Store.bat` once. It installs project packages, creates a local SQLite database and a private `.env` when none exists, applies migrations, prompts you to create that PC's Superadmin account, and adds IT Store to the Windows Startup folder. IT Store starts in the background and opens in a browser after you sign in to Windows. The API and frontend bind to `127.0.0.1` and are available only on that PC.

Each separate installation has its own database, people, assets, and checkout history. Changes made on one PC do not appear on other PCs. This per-PC setup is for standalone use; a shared office database requires a separately configured central host.

The setup script preserves an existing `backend/.env`. For a PostgreSQL install, configure that file and ensure PostgreSQL is installed and running before running the setup. `.env` files and SQLite databases are private local data and must not be copied into source control.

## Local setup

For manual development, set `backend/.env`, then run `uv sync`, `uv run python manage.py migrate`, and `uv run python manage.py createsuperuser` from `backend`. In `frontend`, run `pnpm install` and `pnpm dev`. The frontend proxies `/api` to the local API.

The setup script installs automatic startup for the current Windows account. Windows opens the browser after you sign in; it cannot display the app before login. To remove automatic startup, run `scripts/Uninstall-AutoStart.ps1` on that PC. Startup logs are saved in `%LOCALAPPDATA%\TGC\ITStore\logs`.

For an office-network deployment, configure a production WSGI server and static web server after the host operating system is selected. Use `DEBUG=False`, a strong secret key, appropriate host and origin lists, HTTPS where possible, and regular PostgreSQL backups. The Django development server and Vite development server are for development only.

## Daily workflow

1. The clean initial migration seeds `Projector 1`, `Projector 2`, and `Projector 3` as available assets. A Superadmin can add more physical assets with unique names; the app generates and keeps each internal ID out of the interface.
2. Superadmins maintain a shared accessory checklist, seeded with power cables, chargers, common cables, remotes, cases, and batteries. When registering an asset, a Superadmin checks the accessories included with it; the same options can be used for any asset type.
3. A Superadmin creates a checkout by finding an existing person or registering a new recipient in the same form. New contacts require a name and phone number and can be reused.
4. The Superadmin selects one available asset per checkout. Its configured accessories appear as checkboxes; accessories staying in the office can be unchecked. Only checked accessories are recorded as going out and confirmed on return. To issue another asset, create a separate checkout, even for the same person.
5. On return, a Superadmin confirms each asset’s listed accessories and records the outcome. Asset statuses are Available, Checked out, Missing accessories, Needs repair, Lost, or Retired. Each checkout item has its own status: Checked out, Returned, Partially returned, Returned damaged, or Lost. An item is Partially returned when the asset comes back but one or more accessories are missing. The physical asset is available for another checkout; missing accessories remain excluded from its next checkout until a Superadmin records them received. Damage keeps an asset unavailable until resolved; lost assets also remain unavailable until restored. Each issuance remains a separate checkout record, including repeat checkouts by the same person.
The system has one Superadmin login. Account creation and management are not available in the app, API, or Django admin; initialize the account with `createsuperuser`. The Superadmin can change their own password. Asset names are unique; the internal asset ID is generated automatically and is not shown in the interface. All API endpoints require authentication except login and token refresh. Recipients do not sign in; there are no automatic messages, receipts, signatures, or import process.

## API

The API is under `/api/v1/`. Main resources are `assets/`, `accessories/`, `people/`, and `checkouts/`. Each checkout uses one `asset_id` plus optional `accessory_ids`, and uses `recipient` or `recipient_data`. The Superadmin uses `checkout-items/{id}/resolve/` to record an item outcome and `checkout-items/{id}/accessories-received/` to record accessories returned later.

Search assets, people, and checkouts with `?q=`. Filter assets by asset status and checkouts by item status using `?status=`. When an item status is selected, checkout responses include only matching items while retaining each checkout’s separate issue record. List responses use 25-item pages. Checkout history records the issuing Superadmin, recipient details, asset names and accessories as they were at issue time, item outcomes, and any accessories reported missing.

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
