@echo off
setlocal
where pwsh.exe >nul 2>nul
if %errorlevel%==0 (
  pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Restart-ItStore.ps1"
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Restart-ItStore.ps1"
)
if errorlevel 1 (
  echo.
  echo IT Store could not restart. Check the message above.
  pause
)
endlocal
