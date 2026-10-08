@echo off
rem Runs uninstall_autostart.ps1 without changing the PowerShell execution policy.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall_autostart.ps1"
echo.
pause
