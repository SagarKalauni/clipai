@echo off
title ClipAI Live Server Launcher
cd /d "C:\Users\Dell\Desktop\Videso to shorts"

echo ==========================================================
echo   ClipAI - Starting Live Website Server (24/7 Mode)
echo ==========================================================
echo.

:: Kill old processes on port 8000
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
taskkill /F /IM ngrok.exe 2>nul
taskkill /F /IM cloudflared.exe 2>nul

:: Start local video server in minimized window
echo Starting local video server...
start /min "ClipAI Server" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File server.ps1

:: Wait 5 seconds for server port 8000
ping 127.0.0.1 -n 6 >nul

:: Start Ngrok in minimized window (attached to Windows Desktop Shell 24/7)
echo Starting Ngrok Live Tunnel...
start /min "ClipAI Tunnel" "C:\Users\Dell\Desktop\Videso to shorts\ngrok.exe" http 8000 --authtoken 3HmpwzWH23Hy3PpK9Q0Tg9VrQfr_hXTXCjdqo3ki3gJHwis2

echo.
echo Website server and tunnel started successfully!
echo Desktop shortcut updated: ClipAI Live Website.url
echo.
ping 127.0.0.1 -n 4 >nul
