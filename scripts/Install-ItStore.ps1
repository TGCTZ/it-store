$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$frontendRoot = Join-Path $projectRoot 'frontend'
$backendEnv = Join-Path $backendRoot '.env'
$createdEnvironment = -not (Test-Path $backendEnv)

foreach ($toolName in @('uv', 'node', 'pnpm')) {
    if (-not (Get-Command $toolName -ErrorAction SilentlyContinue)) {
        throw "Install Python 3.13+, uv, Node.js 24+, pnpm, and PostgreSQL before running setup. Missing: $toolName"
    }
}

Push-Location $backendRoot
try {
    & uv sync
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }

    if ($createdEnvironment) {
        $secureAdminPassword = Read-Host "Password for PostgreSQL user 'postgres'" -AsSecureString
        $adminPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAdminPassword)
        try {
            $env:ITSTORE_PG_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPasswordPointer)
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPasswordPointer)
        }

        try {
            & .\.venv\Scripts\python.exe (Join-Path $PSScriptRoot 'bootstrap_postgres.py')
            if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL setup failed. Check that PostgreSQL is running and the postgres password is correct.' }
            $postgresPassword = $env:ITSTORE_PG_ADMIN_PASSWORD

            $secretBytes = [byte[]]::new(48)
            [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
            $secretKey = [Convert]::ToBase64String($secretBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
            $encodedPassword = [Uri]::EscapeDataString($postgresPassword)
            $databaseUrl = "postgres://postgres:$encodedPassword@localhost:5432/itstore"
            $configuration = @"
SECRET_KEY=$secretKey
DEBUG=True
DATABASE_URL=$databaseUrl
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=http://localhost:333,http://127.0.0.1:333
TIME_ZONE=Africa/Dar_es_Salaam
"@
            [System.IO.File]::WriteAllText(
                $backendEnv,
                $configuration,
                [System.Text.UTF8Encoding]::new($false)
            )
            Write-Output 'Created the local PostgreSQL database and private backend configuration.'
        }
        finally {
            Remove-Item Env:ITSTORE_PG_ADMIN_PASSWORD -ErrorAction SilentlyContinue
        }
    }
    else {
        Write-Output 'Keeping the existing backend/.env configuration.'
    }

    & .\.venv\Scripts\python.exe manage.py migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migrations failed. Check backend/.env and the PostgreSQL service.' }
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
Write-Output 'Setup is complete. Starting IT Store now; it will also start after you sign in to Windows.'
& (Join-Path $PSScriptRoot 'Start-ItStore.ps1')
