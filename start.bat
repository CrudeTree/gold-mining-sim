@echo off
title Golden Valley
cd /d "%~dp0"

node --version >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies - first run only...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. See the messages above.
    pause
    exit /b 1
  )
)

echo Starting Golden Valley... your browser will open automatically.
echo Keep this window open while playing. Close it to stop the game.
echo.
call npm run dev

echo.
echo The game server stopped.
pause
