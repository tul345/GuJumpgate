@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "EXTENSION_ID=%~1"
if "%EXTENSION_ID%"=="" (
  echo Usage:
  echo   install-dedicated-mihomo-native-host.bat YOUR_EXTENSION_ID
  echo.
  echo Open chrome://extensions, enable Developer mode, copy this extension ID,
  echo then run this installer again with that ID.
  echo.
  pause
  exit /b 1
)

set "HOST_NAME=com.gujumpgate.dedicated_mihomo_launcher"
set "HOST_MANIFEST=%LOCALAPPDATA%\GuJumpgate\%HOST_NAME%.json"
set "HOST_SCRIPT=%CD%\scripts\dedicated_mihomo_native_host.cmd"

if not exist "%LOCALAPPDATA%\GuJumpgate" mkdir "%LOCALAPPDATA%\GuJumpgate"

> "%HOST_MANIFEST%" (
  echo {
  echo   "name": "%HOST_NAME%",
  echo   "description": "GuJumpgate dedicated Mihomo helper launcher",
  echo   "path": "%HOST_SCRIPT:\=\\%",
  echo   "type": "stdio",
  echo   "allowed_origins": [
  echo     "chrome-extension://%EXTENSION_ID%/"
  echo   ]
  echo }
)

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%HOST_MANIFEST%" /f >nul
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%HOST_MANIFEST%" /f >nul

echo Installed %HOST_NAME%
echo Manifest: %HOST_MANIFEST%
echo Extension ID: %EXTENSION_ID%
echo.
echo Reload the extension, then click "Start dedicated" / "启动专用" again.
pause
