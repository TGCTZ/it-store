# TGC IT Store backend

The backend is a Django REST Framework API for the IT office lending workflow. PostgreSQL stores production data. Borrowers are contacts, while only IT staff have login accounts.

See the [project README](../README.md) for the full workflow and deployment status.

## Set up locally

From this directory, create `.env` from `.env.example` and set a PostgreSQL `DATABASE_URL`, a long random `SECRET_KEY`, `ALLOWED_HOSTS`, and `CORS_ALLOWED_ORIGINS`. Keep `.env` out of version control. `TIME_ZONE` defaults to `Africa/Dar_es_Salaam`; it determines when a due date becomes overdue.

```powershell
Copy-Item .env.example .env
uv sync
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver 0.0.0.0:8000
```

The superuser becomes the first IT Store admin. Further Admin and Staff accounts can be created from the app. The development server is for local use; select a production WSGI host when the office server operating system is known.

## Code map

- `config/settings.py` loads environment settings and configures Django, REST Framework, CORS, and JWT authentication.
- `inventory/models.py` defines staff accounts, borrowers, assets, shared accessory options, checkouts, individual checkout items, and change events.
- `inventory/serializers.py` validates input and performs the atomic checkout and due-date workflows.
- `inventory/views.py` enforces role access, handles returns and loss, and serves dashboard counts.
- `inventory/tests/test_workflows.py` covers the main API rules.

Every asset has a unique name and a generated internal ID that the interface does not display. The first migration seeds nine shared accessory options (power cables, common cables, chargers, remotes, cases, and batteries); admins can later rename, disable, or add options. A checkout can contain several assets; each `CheckoutItem` snapshots the asset name and accessories as they were at issue time, so later edits do not rewrite history. The database prevents more than one open item for an asset, and checkout creation locks the selected asset rows before changing their status.

The asset states are `available`, `on_loan`, `incomplete`, `damaged`, `lost`, and `retired`. A checkout puts available assets `on_loan`. On return, staff confirm included accessories; missing items are recorded on the checkout item and put the asset in `incomplete`. Only an admin can resolve an incomplete, damaged, or lost asset. Overdue status is calculated from the due date and open items; it is not stored as a separate state. Events record checkout creation, due-date changes, item outcomes, missing accessories, and admin asset status changes.

## API contract

All routes have the `/api/v1/` prefix. Login and token refresh are public; other routes require a staff token.

| Route | Purpose |
| --- | --- |
| `POST auth/login/`, `POST auth/refresh/`, `POST auth/logout/` | Staff JWT session |
| `GET auth/me/`, `POST auth/password/` | Current account and password change |
| `GET/POST assets/`, `GET/PATCH assets/{id}/` | Search assets; only admins can create or edit |
| `GET/POST accessories/`, `GET/PATCH accessories/{id}/` | Shared checkbox options; only admins can add, rename, or disable |
| `GET/POST borrowers/`, `GET/PATCH borrowers/{id}/` | Reusable borrower contacts |
| `GET/POST checkouts/`, `GET/PATCH checkouts/{id}/` | Issue assets and change due date or notes |
| `POST checkout-items/{id}/resolve/` | Record `returned`, `damaged`, or `lost`, returned accessories, and optional notes |
| `GET dashboard/` | Asset and overdue-item counts |
| `GET/POST users/`, `GET/PATCH users/{id}/` | Admin-only staff accounts |

To create a checkout for someone already on file, send a borrower database ID, a nonempty list of asset database IDs, and a due date:

```json
{"borrower": 4, "asset_ids": [12, 18], "due_date": "2026-11-10", "notes": "For workshop"}
```

To register a borrower within the checkout, send `borrower_data` instead of `borrower`:

```json
{"borrower_data": {"name": "Juma Guest", "phone": "+255700000002", "borrower_type": "guest"}, "asset_ids": [12], "due_date": "2026-11-10"}
```

The new contact and checkout are saved in one transaction; a failed checkout leaves no new borrower behind. Send exactly one of `borrower` and `borrower_data`.

The API returns `400` if an asset does not exist, is unavailable, or appears twice. Search the three main lists with `?q=`; filter assets and checkouts with `?status=`. Lists are paginated at 25 records per page. Use `PATCH` for changes; deletion is not exposed because it would damage lending history.

## Checks

The test settings use isolated in-memory SQLite so the suite does not touch the office database. Run from this directory:

```powershell
uv run python manage.py test --settings=config.test_settings
uv run python manage.py makemigrations --check --dry-run --settings=config.test_settings
uv run ruff check .
```

The SQLite suite checks API behavior and constraints. Before office deployment, run migrations and a checkout/return smoke test against the chosen PostgreSQL server as well.
