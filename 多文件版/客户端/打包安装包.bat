@echo off
chcp 936 >nul
cd /d "%~dp0"
echo.
echo   ===== 打电脑客户端安装程序（单文件 exe） =====
echo.
echo   前提：客户端\游戏\ 已用「复制游戏到客户端.bat」更新到最新。
echo.
python 打包安装包.py
if errorlevel 1 (
  echo.
  echo   [x] 打包失败：确认装了 python，且 枪战客户端.exe / sdk\WebView2Loader.dll 都在。
) else (
  echo.
  echo   [v] 完成：枪战突击_安装程序.exe —— 把这一个文件发给朋友即可。
)
echo.
pause
