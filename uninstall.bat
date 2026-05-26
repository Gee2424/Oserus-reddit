@echo off
REM Reddit Manager - uninstaller (Windows)
REM Transparent: lists exactly what will be deleted, asks before doing it.

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo === Reddit Manager - uninstaller ===
echo.

set "DATA_DIR=%APPDATA%\reddit-manager"
set FOUND=0

echo The following will be permanently deleted:
echo.

if exist "%~dp0node_modules" (
  echo   [-] %~dp0node_modules
  echo       Installed Node dependencies
  echo.
  set FOUND=1
)

if exist "%~dp0dist" (
  echo   [-] %~dp0dist
  echo       Build output
  echo.
  set FOUND=1
)

if exist "%DATA_DIR%" (
  echo   [-] %DATA_DIR%
  echo       App data ^(database, Reddit sessions, settings^)
  echo.
  set FOUND=1
)

if %FOUND%==0 (
  echo Nothing to clean up. The app hasn't created any files outside this folder.
  echo.
  echo To remove the project itself, just delete this folder:
  echo     %~dp0
  echo.
  pause
  exit /b 0
)

echo This will sign you out of every Reddit account stored in the app
echo and erase all drafts, profiles, and team data. This cannot be undone.
echo.

set /p CONFIRM="Type 'delete' to confirm: "
if not "%CONFIRM%"=="delete" (
  echo.
  echo Cancelled. Nothing was deleted.
  echo.
  pause
  exit /b 0
)

echo.
if exist "%~dp0node_modules" (
  echo   Removing node_modules...
  rmdir /s /q "%~dp0node_modules"
)
if exist "%~dp0dist" (
  echo   Removing dist...
  rmdir /s /q "%~dp0dist"
)
if exist "%DATA_DIR%" (
  echo   Removing %DATA_DIR%...
  rmdir /s /q "%DATA_DIR%"
)

echo.
echo === All app data removed ===
echo.
echo Last step - delete the project folder itself by dragging it to the Recycle Bin,
echo or run this from another folder:
echo     rmdir /s /q "%~dp0"
echo.
pause
