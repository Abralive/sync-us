@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem Only this computer (and Cloudflare Tunnel running on it) can reach the app.
rem Use SYNC_US_HOST=0.0.0.0 instead to open it to your local network.
set SYNC_US_HOST=127.0.0.1
set SYNC_US_PORT=8051

echo ============================================
echo   Sync-Us local service for syncus.hunghung.xyz
echo ============================================
echo Local URL:  http://localhost:%SYNC_US_PORT%
echo Public URL: https://syncus.hunghung.xyz
echo.
echo Cloudflare Tunnel should already be installed as a Windows service.
echo This window runs the Sync-Us app; closing it stops the app.
echo To start Sync-Us automatically at every logon instead, run
echo deploy\windows\install_autostart.bat once.
echo.

python run_sync_us.py
