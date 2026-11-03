@echo off
setlocal
where pwsh.exe >nul 2>nul
if %errorlevel%==0 (
  pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-ItStore.ps1"
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-ItStore.ps1"
)
if errorlevel 1 (
  echo.
  echo Setup did not finish. Read the error above and try again.
  pause
)
endlocal
