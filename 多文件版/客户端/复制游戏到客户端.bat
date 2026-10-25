@echo off
chcp 936 >nul
cd /d "%~dp0"
echo.
echo   ===== 把最新游戏文件复制进客户端（客户端自带拷贝，不和服务器共用）=====
echo.
set SRC=..
if not exist "%SRC%index.html" (
  echo   [x] 没找到 ..\index.html：这个 bat 要放在 多文件版\客户端\ 里用。
  goto :end
)
if not exist "游戏" mkdir 游戏
copy /Y "%SRC%index.html" "游戏\" >nul
copy /Y "%SRC%spike.html" "游戏\" >nul
copy /Y "%SRC%图标.png" "游戏\" >nul
copy /Y "%SRC%图标.ico" "游戏\" >nul
xcopy "%SRC%js"   "游戏\js\"   /E /I /Y /Q >nul
xcopy "%SRC%lib"  "游戏\lib\"  /E /I /Y /Q >nul
xcopy "%SRC%libs" "游戏\libs\" /E /I /Y /Q >nul
xcopy "%SRC%mode" "游戏\mode\" /E /I /Y /Q >nul
rem 【batch226】客户端发行不自带模组：模组让玩家自己在游戏里装（进本地模组库）
del /Q "游戏\mode\模组\*.*" >nul 2>&1
echo window.MOD_FILES = [];>"游戏\mode\模组\载入清单.js"
echo   [v] 复制完成：客户端\游戏\ 已是最新。改了游戏代码后重跑一次这里即可。
:end
echo.
pause
