$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$frontendRoot = Join-Path $projectRoot 'frontend'
$backendEnv = Join-Path $backendRoot '.env'

foreach ($toolName in @('uv', 'node', 'pnpm')) {
    if (-not (Get-Command $toolName -ErrorAction SilentlyContinue)) {
        throw "Install Python 3.13+, uv, Node.js 24+, and pnpm before running this setup. Missing: $toolName"
    }
}

if (-not (Test-Path $backendEnv)) {
    $randomBytes = [byte[]]::new(48)
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
    $secretKey = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $databasePath = (Join-Path $backendRoot 'db.sqlite3').Replace('\', '/')
    @"
SECRET_KEY=$secretKey
DEBUG=True
DATABASE_URL=sqlite:///$databasePath
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
TIME_ZONE=Africa/Dar_es_Salaam
"@ | ForEach-Object {
        [System.IO.File]::WriteAllText(
            $backendEnv,
            $_,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
    Write-Output 'Created a private local configuration and SQLite database for this PC.'
}
else {
    Write-Output 'Keeping the existing backend/.env configuration.'
}

Push-Location $backendRoot
try {
    & uv sync
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
    & .\.venv\Scripts\python.exe manage.py migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migrations failed. Check backend/.env and the PostgreSQL service if it uses PostgreSQL.' }
    $superuserState = & .\.venv\Scripts\python.exe manage.py shell -c "from django.contrib.auth import get_user_model; print('exists' if get_user_model().objects.filter(is_superuser=True).exists() else 'missing')"
    if ($LASTEXITCODE -ne 0) { throw 'Could not check the Superadmin account.' }
    if (($superuserState | Select-Object -Last 1).Trim() -ne 'exists') {
        Write-Output 'Create the Superadmin account for this PC:'
        & .\.venv\Scripts\python.exe manage.py createsuperuser
        if ($LASTEXITCODE -ne 0) { throw 'Superadmin creation did not complete.' }
    }
}
finally {
    Pop-Location
}

Push-Location $frontendRoot
try {
    & pnpm install
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
}
finally {
    Pop-Location
}

& (Join-Path $PSScriptRoot 'Install-AutoStart.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Could not add the Windows automatic startup entry.' }
Write-Output 'Setup is complete. Starting IT Store now; it will also start after you sign in to Windows.'
& (Join-Path $PSScriptRoot 'Start-ItStore.ps1')
