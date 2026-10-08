@echo off
rem Runs status.ps1 without changing the PowerShell execution policy.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0status.ps1"
echo.
pause
