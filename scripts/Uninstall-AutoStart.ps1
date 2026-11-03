$startupEntry = Join-Path ([Environment]::GetFolderPath('Startup')) 'TGC IT Store.vbs'
if (Test-Path -LiteralPath $startupEntry) {
    Remove-Item -LiteralPath $startupEntry
    Write-Output 'Removed the IT Store Windows startup entry.'
}
else {
    Write-Output 'The IT Store Windows startup entry was not installed.'
}
