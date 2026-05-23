@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if /i "%~1"=="/?" goto :usage
if /i "%~1"=="-h" goto :usage
if /i "%~1"=="--help" goto :usage

call :resolve_python
if errorlevel 1 goto :python_not_found

if "%~1"=="" (
  "%PYTHON_EXE%" %PYTHON_ARGS% scripts\dedicated_mihomo_helper.py --port 18768
  exit /b %errorlevel%
)

"%PYTHON_EXE%" %PYTHON_ARGS% scripts\dedicated_mihomo_helper.py --port %~1
exit /b %errorlevel%

:resolve_python
where py >nul 2>nul
if %errorlevel%==0 (
  set "PYTHON_EXE=py"
  set "PYTHON_ARGS=-3"
  exit /b 0
)

where python >nul 2>nul
if %errorlevel%==0 (
  set "PYTHON_EXE=python"
  set "PYTHON_ARGS="
  exit /b 0
)

exit /b 1

:python_not_found
echo Python 3 not found. Please install Python 3.10+ and try again.
pause
exit /b 1

:usage
echo Usage:
echo   start-dedicated-mihomo-helper.bat
echo   start-dedicated-mihomo-helper.bat 18768
echo.
echo Optional: set MIHOMO_PATH to your mihomo.exe path before starting.
exit /b 0
