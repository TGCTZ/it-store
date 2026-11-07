# TGC IT Store backend

The backend is a Django REST Framework API for the IT office equipment checkout workflow. PostgreSQL stores production data. Recipients are contacts; the system has one Superadmin login account.

See the [project README](../README.md) for the full workflow and deployment status.
See [API contract](../docs/api.md) for complete request examples and filter parameters, and [workflow rules](../docs/workflow.md) for status transitions.

## Set up locally

For a standalone Windows PC, use the project-level `Setup IT Store.bat`; it creates a local PostgreSQL database named `itstore` using the `postgres` account and writes a private `.env` if no configuration exists. For a manual setup, create `.env` from `.env.example` and set `DATABASE_URL`, a long random `SECRET_KEY`, `ALLOWED_HOSTS`, and `CORS_ALLOWED_ORIGINS`. Keep `.env` out of version control. `TIME_ZONE` defaults to `Africa/Dar_es_Salaam` for timestamps.

```powershell
Copy-Item .env.example .env
uv sync
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver 127.0.0.1:334
```

Drop and recreate an old development database before applying the consolidated initial migration. Then `createsuperuser` initializes the one login account. The app, API, and Django admin provide no account creation or management. The account can change its own password. The development server is for local use; select a production WSGI host when the office server operating system is known.

## Code map

- `config/settings.py` loads environment settings and configures Django, REST Framework, CORS, and JWT authentication.
- `inventory/models.py` defines the single login account, recipients, assets, shared accessory options, checkouts, individual checkout items, and change events.
- `inventory/serializers.py` validates input and performs atomic checkout and return workflows.
- `inventory/views.py` protects administrative actions and handles returns and loss.
- `inventory/tests/test_workflows.py` covers the main API rules.

The database enforces one login account. Use a fresh development database with this clean initial migration set; then create the account once with `createsuperuser`. The initial migration seeds nine shared accessory options and three projector assets. The account can add or rename options and delete an option only after removing it from assets that use it. Every asset has a unique name and a generated internal ID that the interface does not display. Each checkout is for exactly one asset; issuing another asset creates a separate checkout, including for the same person. Each `CheckoutItem` snapshots the asset name and only the accessories selected at issue time, so later edits do not rewrite history. The database allows only one item per checkout and prevents more than one open item for an asset.

Asset states are `available`, `checked_out`, `missing_accessories`, `needs_repair`, `lost`, and `retired`. Checkout-item states are `checked_out`, `returned`, `partially_returned`, `returned_damaged`, and `lost`. If accessories are missing when an asset is returned, its item becomes `partially_returned` while the physical asset becomes `available` for another checkout. The API exposes the outstanding accessory IDs; they cannot be selected for a new checkout until the Superadmin records them received. This preserves the missing-accessory history without blocking reuse of the asset. Damaged assets remain `needs_repair` after accessories are received. Events record checkout creation, item outcomes, accessory recovery, and asset status changes.

## API contract

All routes have the `/api/v1/` prefix. Login and token refresh are public; other routes require an active Superadmin token.

| Route | Purpose |
| --- | --- |
| `POST auth/login/`, `POST auth/refresh/`, `POST auth/logout/` | Superadmin JWT session |
| `GET auth/me/`, `POST auth/password/` | Current account and password change |
| `GET/POST assets/`, `GET/PATCH assets/{id}/` | Search assets; Superadmins can create or edit |
| `GET/POST accessories/`, `GET/PATCH accessories/{id}/` | Shared checkbox options; Superadmins can add, rename, or delete |
| `GET/POST people/`, `GET/PATCH people/{id}/` | Reusable recipient contacts |
| `GET/POST checkouts/`, `GET/PATCH checkouts/{id}/` | Create checkouts and edit an active checkout's asset or issued accessories |
| `POST checkout-items/{id}/resolve/` | Record `returned`, `returned_damaged`, or `lost`, returned accessories, and optional notes. A returned item with missing accessories receives `partially_returned` status. |
| `POST checkout-items/{id}/accessories-received/` | Superadmin records which previously missing accessories have now been received. |
To create a checkout for someone already on file, send a recipient database ID, one asset database ID, and optional accessory IDs:

```json
{"recipient": 4, "asset_id": 12, "accessory_ids": [3, 7]}
```

To register a recipient within the checkout, send `recipient_data` instead of `recipient`:

```json
{"recipient_data": {"first_name": "Juma", "last_name": "Guest", "phone": "+255700000002", "recipient_type": "guest"}, "asset_id": 12}
```

The new contact and checkout are saved in one transaction; a failed checkout leaves no new recipient behind. Send exactly one of `recipient` and `recipient_data`.

Optionally include `accessory_ids` to specify the configured accessories going out with the one selected asset. IDs must belong to that asset and cannot include accessories still marked missing on a prior return. When omitted, the API snapshots all configured accessories except those still missing. The API returns `400` if the asset does not exist, is unavailable, or the accessory selection is invalid. Search assets, people, and checkouts with `?q=`; filter assets and checkout items with `?status=`; filter checkouts by issue date with `date_from` and `date_to` in `YYYY-MM-DD` format. A filtered checkout response includes only matching items while preserving each separate checkout record. The UI requests 10 records per page; API clients default to 25 and can request up to 100 with `page_size`. Use `PATCH` for changes. Deletion is blocked when it would remove checkout history or an accessory option assigned to an asset; checkout deletion is not exposed.

## Checks

The test settings use isolated in-memory SQLite so the suite does not touch the office database. Run from this directory:

```powershell
uv run python manage.py test --settings=config.test_settings
uv run python manage.py makemigrations --check --dry-run --settings=config.test_settings
uv run ruff check .
```

The SQLite suite checks API behavior and constraints. Before office deployment, run migrations and a checkout/return smoke test against the chosen PostgreSQL server as well.
