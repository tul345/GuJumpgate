@echo off
setlocal EnableExtensions

set "HOST_NAME=com.gujumpgate.dedicated_mihomo_launcher"
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /f >nul 2>nul
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /ve /f >nul 2>nul

echo Uninstalled %HOST_NAME%
pause
