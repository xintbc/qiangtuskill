@echo off
title 枪战突击 - 永久公网隧道（Tailscale）
cd /d "%~dp0"

echo.
echo   ==================================================
echo      枪战突击 . 永久公网隧道（Tailscale Funnel）
echo   ==================================================
echo.
echo   用之前请先让服务器开着（双击「启动服务器.bat」）。
echo   这个网址是永久的：绑在你的设备名上，关掉/重启电脑都还是它，只用发给朋友一次。
echo   第一次用会要你在浏览器里点一下授权；手机端也要装 Tailscale 并登录同一账号。
echo.

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE for /f "delims=" %%i in ('dir /b /s "%USERPROFILE%\.workbuddy\binaries\node\versions\*\node.exe" 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"

if not defined NODE_EXE (
  echo   [错误] 没有找到 Node.js
  echo.
  echo   请先安装 Node.js 后再运行本脚本: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

rem 含中文的路径必须在这里（936 代码页下）解析好，chcp 65001 之后的行只能是纯 ASCII
set "TUNJS=%~dp0永久隧道.js"
if not exist "%TUNJS%" set "TUNJS=%~dp0..\永久隧道.js"
if not exist "%TUNJS%" (
  echo   [错误] 找不到 永久隧道.js —— 它应该和这个 BAT 在同一个文件夹里。
  pause
  exit /b 1
)

chcp 65001 >nul
"%NODE_EXE%" "%TUNJS%" %*
chcp 936 >nul

echo.
echo   [!] 上面是隧道的输出。隧道本身用 --bg 常驻后台，关掉这个窗口它不会断。
pause
