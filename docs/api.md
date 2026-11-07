# API contract

The API prefix is `/api/v1/`. All endpoints require an authenticated Superadmin except login and token refresh. Authentication uses JWT access and refresh tokens. The browser stores its session locally and refreshes the access token when needed.

## Routes

| Method and route | Purpose |
| --- | --- |
| `POST auth/login/` | Sign in with `email` and `password`; returns `access`, `refresh`, and user data. |
| `POST auth/refresh/` | Refresh an access token. |
| `POST auth/logout/` | Blacklist the supplied refresh token. |
| `GET auth/me/` | Return the current Superadmin. |
| `POST auth/password/` | Change the password with `current_password` and `new_password`. |
| `GET/POST assets/`; `GET/PATCH/DELETE assets/{id}/` | List/search assets; create, edit, or delete eligible assets. |
| `GET/POST accessories/`; `GET/PATCH/DELETE accessories/{id}/` | List, add, rename, or delete eligible shared accessory options. |
| `GET/POST people/`; `GET/PATCH/DELETE people/{id}/` | List/search, add, edit, or delete eligible people. |
| `GET/POST checkouts/`; `GET/PATCH checkouts/{id}/` | List/search, create, or edit an active checkout. Checkout deletion is not supported. |
| `POST checkout-items/{id}/resolve/` | Record a checked-out item as returned, returned damaged, or lost. |
| `POST checkout-items/{id}/accessories-received/` | Record recovery of previously missing accessories. |

Deletion is blocked when it would discard checkout history or remove an accessory option assigned to an asset. Retire an asset with history instead of deleting it.

## Search, filters, and pagination

- `q` searches asset names, person names or phone numbers, and checkout recipient names, phone numbers, or asset names.
- `status` filters assets by asset status or checkouts by checkout item status.
- `date_from` and `date_to` filter checkouts by issue date in `YYYY-MM-DD` format; either bound can be omitted.
- `page` selects a page and `page_size` selects its size. The browser requests 10 records per page by default. The API defaults to 25 and caps requested page sizes at 100.
- With a checkout status filter, responses include only matching items inside each matching checkout record.
- People duplicate checking uses `duplicate_check=1` with `first_name`, `last_name`, `phone`, and `recipient_type`. A match requires all fields to agree; phone numbers are compared by their digits.

## Create a checkout

Each request creates exactly one checkout for one asset. Use either an existing person ID or inline person details.

Existing person:

```json
{
  "recipient": 4,
  "asset_id": 12,
  "accessory_ids": [3, 7]
}
```

New person:

```json
{
  "recipient_data": {
    "first_name": "Juma",
    "last_name": "Guest",
    "phone": "+255700000002",
    "recipient_type": "guest"
  },
  "asset_id": 12,
  "accessory_ids": [3, 7]
}
```

`accessory_ids` is optional. If omitted, the API snapshots all configured accessories except those still marked missing. If provided, every ID must belong to the chosen asset and cannot be marked missing. Creating an inline person and checkout is atomic: if checkout creation fails, no unused person record is left behind.

## Record a return

The resolve request uses `outcome`, `missing_accessory_ids`, and optional `notes`:

```json
{
  "outcome": "returned",
  "missing_accessory_ids": [7],
  "notes": "Power cable was not returned"
}
```

Allowed outcomes are `returned`, `returned_damaged`, and `lost`. For a non-lost item with issued accessories, explicitly send the IDs that are missing (an empty array means all came back). A normal return with missing accessories becomes `partially_returned`; a damaged return becomes `returned_damaged` and marks the asset `needs_repair`.

To record accessories recovered later, post the recovered IDs:

```json
{
  "received_accessory_ids": [7]
}
```

Only IDs still recorded as missing on that checkout item can be submitted.
