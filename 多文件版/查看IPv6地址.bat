@echo off
chcp 65001 >nul
echo Scanning for your public IPv6 address...
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike 'fe80*' -and $_.IPAddress -notlike 'fd*' -and $_.IPAddress -notlike 'fc*' -and $_.IPAddress -notlike '::1' -and ($_.IPAddress -like '2408*' -or $_.IPAddress -like '2409*' -or $_.IPAddress -like '240e*' -or $_.IPAddress -like '2001*' -or $_.IPAddress -like '240a*' -or $_.IPAddress -like '240*') } | Select-Object -First 1).IPAddress"`) do set ADDR=%%a
if "%ADDR%"=="" (
  echo [X] No public IPv6 found.
  echo     Step 1: Enable IPv6 on your router (see instructions).
  echo     Step 2: Re-run this script.
  pause
  exit /b 1
)
echo [OK] Your public IPv6: %ADDR%
echo Game URL for friends: http://[%ADDR%]:8765
echo http://[%ADDR%]:8765> "公网地址.txt"
echo [Saved] -> 公网地址.txt  (give this URL to your friends)
pause
