@echo off
chcp 936 >nul
cd /d "%~dp0"
echo.
echo   ===== 枪战突击 桌面客户端 · 编译 =====
echo.
set GCC=D://msy//mingw64//bin//gcc.exe
if not exist "%GCC%" set GCC=gcc

set WINDRES=D://msy//mingw64//bin//windres.exe
if not exist "%WINDRES%" set WINDRES=windres

rem 【batch226】图标资源：exe 终于有自己的图标了（资源.rc -> 资源.o）
"%WINDRES%" -O coff 资源.rc -o 资源.o
if errorlevel 1 (
  echo   [!] 图标资源编译失败，先出一个没图标的 exe。
  set 资源=
) else (
  set 资源=资源.o
)

"%GCC%" -O2 -std=gnu99 -w -municode -mwindows -finput-charset=UTF-8 -I sdk ^
  客户端.c 网页视图.c -o 枪战客户端.exe ^
  -lws2_32 -lole32 -loleaut32 -lcomctl32 -lshell32 -luser32 -lgdi32 -ladvapi32 -luuid

if errorlevel 1 (
  echo.
  echo   [x] 编译失败。确认 gcc 装了、sdk\WebView2.h 还在本目录。
) else (
  echo.
  echo   [v] 编译成功：枪战客户端.exe
)
echo.
pause
