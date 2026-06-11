@echo off
REM Oserus Management - installer (Windows)
setlocal
cd /d "%~dp0"

echo.
echo === Oserus Management - installer ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js is not installed.
  echo     Install it from https://nodejs.org (LTS, 20 or newer^), then re-run.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%a in ('node -v') do set NODE_MAJOR=%%a
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% LSS 20 (
  echo [X] Node.js v%NODE_MAJOR% is too old. Need v20 or newer.
  echo     Get the LTS from https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo [OK] Node detected.
echo.
echo Installing dependencies + rebuilding native modules...
echo (1-3 minutes on first run)
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo [X] npm install failed. See errors above.
  pause
  exit /b 1
)

echo.
echo === Install complete ===
echo.
echo Locations:
echo   1. %~dp0
echo      ^(code^)
echo   2. %APPDATA%\reddit-manager
echo      ^(created on first launch - database, sessions^)
echo.
echo To run:        npm run dev
echo To uninstall:  uninstall.bat
echo.
echo Default login: admin / changeme
echo.
pause
