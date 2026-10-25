@echo off
chcp 936 >nul
cd /d "%~dp0"
setlocal
set SDK=C://Android//sdk
set BT=%SDK%\build-tools\34.0.0
set AJ=%SDK%\platforms\android-34\android.jar
set JRE=C://Program Files\Eclipse Adoptium\jre-17.0.20.101-hotspot
set JAVAC=C://Program Files\Common Files\Oracle\Java\javapath\javac.exe
set BUILD=C://Android//apkbuild

echo.
echo   ===== 枪战突击 手机版 · 一键打包 =====
echo.

if not exist "%AJ%" (
  echo   [x] 没找到 Android SDK：%SDK%
  echo       先装 SDK 并放好 platforms\android-34 和 build-tools\34.0.0。
  goto :end
)

echo [1/6] 复制游戏本体到 assets...
if exist "app\src\main\assets" rd /s /q "app\src\main\assets"
mkdir "app\src\main\assets"
copy /Y "..\index.html" "app\src\main\assets\" >nul
copy /Y "..\spike.html" "app\src\main\assets\" >nul
xcopy "..\js"   "app\src\main\assets\js\"   /E /I /Y /Q >nul
xcopy "..\lib"  "app\src\main\assets\lib\"  /E /I /Y /Q >nul
xcopy "..\libs" "app\src\main\assets\libs\" /E /I /Y /Q >nul
xcopy "..\mode" "app\src\main\assets\mode\" /E /I /Y /Q >nul
rem 【batch226】发行包不自带模组：模组让玩家自己在游戏里装（会进 files/mods 或本地模组库）
del /Q "app\src\main\assets\mode\模组\*.*" >nul 2>&1
echo window.MOD_FILES = [];>"app\src\main\assets\mode\模组\载入清单.js"

echo [2/6] aapt2 生成基础包...
if not exist output mkdir output
"%BT%\aapt2.exe" link -o output\base.apk -I "%AJ%" --manifest app\src\main\AndroidManifest.xml --min-sdk-version 24 --target-sdk-version 34 --version-code 1 --version-name 1.0
if errorlevel 1 goto :fail

echo [3/6] 编译 Java...
if not exist "%BUILD%\classes" mkdir "%BUILD%\classes"
"%JAVAC%" -encoding UTF-8 -source 8 -target 8 -bootclasspath "%AJ%" -d "%BUILD%\classes" app\src\main\java\com\qiangtu\game\MainActivity.java
if errorlevel 1 goto :fail

echo [4/6] 生成 dex...
if exist "%BUILD%\dex" rd /s /q "%BUILD%\dex"
mkdir "%BUILD%\dex"
"%JRE%\bin\java.exe" -cp "%BT%\lib\d8.jar" com.android.tools.r8.D8 --lib "%AJ%" --min-api 24 --output "%BUILD%\dex" "%BUILD%\classes\com\qiangtu\game\MainActivity.class" "%BUILD%\classes\com\qiangtu\game\MainActivity$JsBridge.class" "%BUILD%\classes\com\qiangtu\game\MainActivity$MyClient.class" "%BUILD%\classes\com\qiangtu\game\MainActivity$PickTask.class"
if errorlevel 1 goto :fail

echo [5/6] 打包 assets + dex...
python 打包工具.py
if errorlevel 1 goto :fail

echo [6/6] 对齐 + 签名...
if not exist debug.keystore "%JRE%\bin\keytool.exe" -genkeypair -keystore debug.keystore -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US" >nul 2>&1
"%BT%\zipalign.exe" -f 4 output\unsigned.apk output\aligned.apk
set JAVA_HOME=%JRE%
call "%BT%\apksigner.bat" sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android --out "枪战突击.apk" output\aligned.apk
if errorlevel 1 goto :fail

echo.
echo   [v] 成功：枪战突击.apk
goto :end

:fail
echo.
echo   [x] 失败了，看上面哪一步报错。

:end
echo.
pause
