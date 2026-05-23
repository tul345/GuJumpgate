@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 scripts\dedicated_mihomo_native_host.py
  exit /b %errorlevel%
)

where python >nul 2>nul
if %errorlevel%==0 (
  python scripts\dedicated_mihomo_native_host.py
  exit /b %errorlevel%
)

exit /b 1
