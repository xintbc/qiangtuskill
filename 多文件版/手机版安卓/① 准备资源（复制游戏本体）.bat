@echo off
chcp 936 >nul
cd /d "%~dp0"
echo.
echo   把「多文件版」本体复制进 assets（只需第一次 / 本体更新后各跑一次）
echo.
if exist "app\src\main\assets" rd /s /q "app\src\main\assets"
mkdir "app\src\main\assets"

copy /Y "..\index.html"      "app\src\main\assets\" >nul
copy /Y "..\spike.html"      "app\src\main\assets\" >nul
xcopy "..\js"   "app\src\main\assets\js\"   /E /I /Y /Q >nul
xcopy "..\lib"  "app\src\main\assets\lib\"  /E /I /Y /Q >nul
xcopy "..\libs" "app\src\main\assets\libs\" /E /I /Y /Q >nul
xcopy "..\mode" "app\src\main\assets\mode\" /E /I /Y /Q >nul

echo.
echo   [v] 已复制到 app\src\main\assets\
echo       接下来用 Android Studio 打开本文件夹，或执行 gradlew assembleDebug
echo.
pause
