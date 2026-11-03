$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

$managedServers = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and
    $_.CommandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    (($_.Name -eq 'python.exe' -and $_.CommandLine -match 'manage\.py.*runserver') -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'node_modules[\\/]vite[\\/]bin[\\/]vite\.js'))
}

foreach ($server in $managedServers) {
    Stop-Process -Id $server.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($managedServers) { Start-Sleep -Seconds 2 }

& (Join-Path $PSScriptRoot 'Start-ItStore.ps1')
