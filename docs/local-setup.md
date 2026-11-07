# Local setup and operations

## Standalone Windows installation

Each installed PC has its own database and checkout history; this setup does not synchronize multiple PCs. Install Python 3.13 or newer, uv, Node.js 24 or newer, pnpm, and PostgreSQL. Copy the project to the PC and run `Setup IT Store.bat`. The installer creates the local `itstore` database using PostgreSQL account `postgres`, creates a private backend `.env` if needed, applies migrations, prompts for the Superadmin, and installs startup at Windows sign-in.

The app opens at `http://127.0.0.1:333`; the API listens on `127.0.0.1:334`. PostgreSQL must be running locally on port `5432`. Existing `.env` files are preserved. If a database named `itstore` already exists, setup stops rather than overwriting it. Startup logs are stored in `%LOCALAPPDATA%\TGC\ITStore\logs`.

To restart the local servers, double-click `Restart IT Store.bat`. To remove automatic startup, run `scripts/Uninstall-AutoStart.ps1`.

## Manual development

Configure `backend/.env` using `backend/.env.example`. Set a database URL, a strong secret key, allowed hosts, and CORS origins. PostgreSQL is the intended database. From the project root:

```powershell
Set-Location backend
uv sync
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver 127.0.0.1:334
```

In a second terminal:

```powershell
Set-Location frontend
pnpm install
pnpm dev --host 127.0.0.1 --port 333
```

Open `http://127.0.0.1:333`. Vite proxies `/api` to the local Django server. Do not use Django’s development server or Vite’s development server for an office production deployment. Production hosting needs a WSGI server, static web server, secure secrets, HTTPS, and a PostgreSQL backup plan.

## Checks

Run from `backend`:

```powershell
uv run python manage.py test --settings=config.test_settings
uv run python manage.py makemigrations --check --dry-run --settings=config.test_settings
uv run ruff check .
```

Run from `frontend`:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

The test settings use isolated SQLite and do not target the office PostgreSQL database. After installing dependencies in a fresh checkout, run the checks before deployment and perform a separate smoke test against the intended PostgreSQL host.
