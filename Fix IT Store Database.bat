@echo off
setlocal
where pwsh.exe >nul 2>nul
if %errorlevel%==0 (
  pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Fix-StaleSchema.ps1"
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Fix-StaleSchema.ps1"
)
if errorlevel 1 (
  echo.
  echo IT Store database repair did not complete. Review the message above.
  pause
)
endlocal
