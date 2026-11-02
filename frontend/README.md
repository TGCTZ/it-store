# TGC IT Store frontend

This React and TypeScript app gives IT staff a browser interface for inventory, people receiving equipment, checkouts, returns, and overdue follow-up. Its logo and colors were adapted from the TGC service project.

See the [project README](../README.md) for the complete office workflow.

## Set up locally

Start the backend first. Then, from this directory:

```powershell
pnpm install
pnpm dev
```

Open the URL printed by Vite. Its development server proxies `/api` to `http://localhost:8000`. If the API is at another address, copy `.env.example` to `.env` and set `VITE_API_URL` to the full `/api/v1` URL. When the frontend and API have different origins, add the frontend origin to the backend's `CORS_ALLOWED_ORIGINS`.

The production build is generated with `pnpm build` in `dist/`. The office web server can serve those static files once a deployment host has been selected. Do not commit `dist/`, `node_modules/`, or `.env`.

## Screen and code map

- **Overview:** available, checked-out, overdue, incomplete, damaged, and lost counts.
- **Assets:** searchable inventory by unique name. Admins can record included accessories from a shared checklist, manage checklist options, and resolve incomplete items.
- **People:** reusable recipient contacts with required name and phone number.
- **Checkouts:** search for an existing person or register a new recipient inside the creation dialog, then issue several assets together. Staff can later change a due date and confirm accessories on each return. Missing accessories leave the asset unavailable until an Admin resolves it. The detail view shows the automatic activity history.
- **Staff accounts:** visible to admins for account creation, role changes, activation, and password resets.

`src/App.tsx` contains the screens and forms. `src/lib/api.ts` handles JSON requests, staff sign-in, token refresh, and session expiry; `src/lib/types.ts` describes the API data. `src/styles/theme.css` contains the retained TGC palette, while `src/styles/app.css` defines the interface layout.

Tokens live in browser `sessionStorage`, so closing the tab ends the browser session. The API issues the tokens; the frontend retries a protected request once after refreshing an expired access token. The API enforces permissions even if a user bypasses the interface. Recipients never sign in.

## Checks

Run from this directory after installing dependencies:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

The unit tests cover sign-in token storage and access-token refresh. The backend tests cover lending rules, including partial returns and double-loan prevention. The package registry was unavailable during the initial build, so the first frontend checks used the template's installed packages; rerun them after `pnpm install` in this project.
