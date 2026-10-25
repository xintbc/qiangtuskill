@echo off
chcp 936 >nul
title 枪战突击 - 游戏服务器
cd /d "D:\mc2\多文件版"
echo.
echo   正在启动服务器，请不要关闭这个窗口 ...
echo   关闭此窗口 = 关闭服务器
echo.
node 服务端.js
echo.
echo   [!] 服务器已停止。
pause
