@echo off
chcp 65001 >nul
cd /d "%~dp0"

set SYNC_US_HOST=0.0.0.0
set SYNC_US_PORT=8051

echo ============================================
echo   Sync-Us local service for syncus.hunghung.xyz
echo ============================================
echo Local URL:  http://localhost:%SYNC_US_PORT%
echo Public URL: https://syncus.hunghung.xyz
echo.
echo Cloudflare Tunnel should already be installed as a Windows service.
echo This script only starts the local Sync-Us app.
echo.

python run_sync_us.py
