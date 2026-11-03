$ErrorActionPreference = 'Stop'

$startupFolder = [Environment]::GetFolderPath('Startup')
$startupEntry = Join-Path $startupFolder 'TGC IT Store.vbs'
$launcher = Join-Path $PSScriptRoot 'Start-ItStore.ps1'
$powerShell = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $powerShell) {
    $powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
}

$command = '"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}"' -f $powerShell, $launcher
$escapedCommand = $command.Replace('"', '""')
$vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "$escapedCommand", 0, False
"@

Set-Content -LiteralPath $startupEntry -Value $vbs -Encoding ascii
Write-Output "IT Store will start after you sign in to Windows. Startup entry: $startupEntry"
