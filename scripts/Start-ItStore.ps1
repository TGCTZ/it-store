$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$frontendRoot = Join-Path $projectRoot 'frontend'
$python = Join-Path $backendRoot '.venv\Scripts\python.exe'
$vite = Join-Path $frontendRoot 'node_modules\vite\bin\vite.js'
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$stateRoot = Join-Path $env:LOCALAPPDATA 'TGC\ITStore'
$logsRoot = Join-Path $stateRoot 'logs'
$apiPort = 18473
$webPort = 18474
$webUrl = "http://127.0.0.1:$webPort"
$env:VITE_API_URL = '/api/v1'

New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null

function Show-StartupError([string]$message) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "$message`n`nLogs: $logsRoot",
        'TGC IT Store could not start',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

function Test-Port([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $pending = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($pending)
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-ForPort([int]$port, [System.Diagnostics.Process]$process) {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-Port $port) { return $true }
        if ($process -and $process.HasExited) { return $false }
        Start-Sleep -Seconds 1
    }
    return (Test-Port $port)
}

if (-not (Test-Path $python) -or -not (Test-Path $vite) -or -not $nodeCommand) {
    Show-StartupError 'The Python or frontend dependencies are missing. Reinstall the project dependencies before starting it.'
    exit 1
}

# Check the configured database before starting Django so an unavailable service is clear to the user.
$dbCheck = & $python (Join-Path $backendRoot 'manage.py') shell -c 'from django.db import connection; connection.ensure_connection()' 2>&1
if ($LASTEXITCODE -ne 0) {
    $dbCheck | Out-File (Join-Path $logsRoot 'database-check.log') -Encoding utf8
    Show-StartupError 'The configured database is not reachable. Check backend/.env and make sure its database service is running.'
    exit 1
}

$apiProcess = $null
if (-not (Test-Port $apiPort)) {
    $apiProcess = Start-Process -FilePath $python `
        -ArgumentList @('"' + (Join-Path $backendRoot 'manage.py') + '"', 'runserver', "127.0.0.1:$apiPort", '--noreload') `
        -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logsRoot 'api.out.log') `
        -RedirectStandardError (Join-Path $logsRoot 'api.err.log')
}

$webProcess = $null
if (-not (Test-Port $webPort)) {
    $webProcess = Start-Process -FilePath $nodeCommand.Source `
        -ArgumentList @('"' + $vite + '"', '--host', '127.0.0.1', '--port', "$webPort", '--strictPort') `
        -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logsRoot 'web.out.log') `
        -RedirectStandardError (Join-Path $logsRoot 'web.err.log')
}

if (-not (Wait-ForPort $apiPort $apiProcess)) {
    Show-StartupError 'The API did not start. Check api.err.log for details.'
    exit 1
}
if (-not (Wait-ForPort $webPort $webProcess)) {
    Show-StartupError 'The website did not start. Check web.err.log for details.'
    exit 1
}

Start-Process $webUrl
