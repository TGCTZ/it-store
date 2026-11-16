$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $projectRoot 'backend'
$managePy = Join-Path $backendDir 'manage.py'

if (-not (Test-Path -LiteralPath $managePy)) {
    throw "Could not find backend/manage.py under $projectRoot. Place this script inside the IT Store project folder."
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw 'uv is required. Install uv, then run this repair again.'
}

Write-Host 'This repair removes only obsolete database columns:' -ForegroundColor Cyan
Write-Host '  inventory_asset: category, serial_number, notes'
Write-Host '  inventory_checkout: notes'
Write-Host 'Asset and checkout rows are preserved. Any old values in those columns will be deleted.' -ForegroundColor Yellow
$confirmation = Read-Host 'Type FIX to continue'
if ($confirmation -cne 'FIX') {
    Write-Host 'Repair cancelled. No database changes were made.'
    exit 1
}

$pythonCode = @'
from django.db import connection, transaction

if connection.vendor != "postgresql":
    raise RuntimeError("This repair only supports PostgreSQL.")
if connection.settings_dict["NAME"] != "itstore":
    raise RuntimeError("Safety check failed: the configured database is not named itstore.")

with transaction.atomic():
    with connection.cursor() as cursor:
        cursor.execute(
            'ALTER TABLE public.inventory_asset '
            'DROP COLUMN IF EXISTS category, '
            'DROP COLUMN IF EXISTS serial_number, '
            'DROP COLUMN IF EXISTS notes'
        )
        cursor.execute(
            'ALTER TABLE public.inventory_checkout '
            'DROP COLUMN IF EXISTS notes'
        )

print("Repair complete. Existing asset and checkout records were preserved.")
'@

Push-Location $backendDir
try {
    & uv run python manage.py shell -c $pythonCode
    if ($LASTEXITCODE -ne 0) {
        throw 'The repair command failed. Review the database error above.'
    }
} finally {
    Pop-Location
}

Write-Host 'Restart IT Store, then refresh the browser.' -ForegroundColor Green
