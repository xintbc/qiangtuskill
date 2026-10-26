# -*- coding: utf-8 -*-
"""一键打包安卓 APK（替代 ③ 一键打包.bat，避免 pause 卡住）"""
import os, io, shutil, subprocess, sys

根 = r'D:\mc2\多文件版\手机版安卓'
os.chdir(根)
SDK = r'C:\Android\sdk'
BT = os.path.join(SDK, 'build-tools', '34.0.0')
AJ = os.path.join(SDK, 'platforms', 'android-34', 'android.jar')
JRE = r'C:\Program Files\Eclipse Adoptium\jre-17.0.20.101-hotspot'
JAVAC = r'C:\Program Files\Common Files\Oracle\Java\javapath\javac.exe'
BUILD = r'C:\Android\apkbuild'

def 跑(cmd, 名):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('[x] %s 失败\n%s\n%s' % (名, (r.stdout or '')[-1500:], (r.stderr or '')[-1500:]))
        sys.exit(1)
    print('[v] %s' % 名)

# 1) assets：发行包不自带模组（与 ③ 脚本一致）
素 = os.path.join(根, 'app', 'src', 'main', 'assets')
模 = os.path.join(素, 'mode', '模组')
if os.path.isdir(模): shutil.rmtree(模)
os.makedirs(模)
io.open(os.path.join(模, '载入清单.js'), 'w', encoding='utf-8', newline='\n').write('window.MOD_FILES = [];\n')
print('[v] assets 就绪（%d 个 js 分片）' % len(os.listdir(os.path.join(素, 'js'))))

# 2) aapt2 compile 资源 + link
os.makedirs(os.path.join(根, 'output'), exist_ok=True)
if os.path.isfile(r'output\base.apk'): os.remove(r'output\base.apk')
跑([os.path.join(BT, 'aapt2.exe'), 'compile', '--dir', r'app\src\main\res', '-o', r'output\res.zip'], 'aapt2 compile')
跑([os.path.join(BT, 'aapt2.exe'), 'link', '-o', r'output\base.apk', '-I', AJ,
   '--manifest', r'app\src\main\AndroidManifest.xml', '--min-sdk-version', '24',
   '--target-sdk-version', '34', '--version-code', '175', '--version-name', '1.7.5',
   r'output\res.zip'], 'aapt2 link')

# 3) javac
classes = os.path.join(BUILD, 'classes')
if os.path.isdir(classes): shutil.rmtree(classes)
os.makedirs(classes)
跑([JAVAC, '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', AJ,
   '-d', classes, r'app\src\main\java\com\qiangtu\game\MainActivity.java'], 'javac')

# 4) d8
dex = os.path.join(BUILD, 'dex')
if os.path.isdir(dex): shutil.rmtree(dex)
os.makedirs(dex)
类们 = ['MainActivity', 'MainActivity$JsBridge', 'MainActivity$MyClient', 'MainActivity$PickTask']
跑([os.path.join(JRE, 'bin', 'java.exe'), '-cp', os.path.join(BT, 'lib', 'd8.jar'),
   'com.android.tools.r8.D8', '--lib', AJ, '--min-api', '24', '--output', dex] +
  [os.path.join(classes, 'com', 'qiangtu', 'game', c + '.class') for c in 类们], 'd8')

# 5) 打 assets + dex
跑([sys.executable, '打包工具.py'], '打包 assets + dex')

# 6) 对齐 + 签名
跑([os.path.join(BT, 'zipalign.exe'), '-f', '4', r'output\unsigned.apk', r'output\aligned.apk'], 'zipalign')
env = dict(os.environ); env['JAVA_HOME'] = JRE
r = subprocess.run([os.path.join(BT, 'apksigner.bat'), 'sign', '--ks', 'debug.keystore',
                    '--ks-pass', 'pass:android', '--key-pass', 'pass:android',
                    '--out', '枪战突击.apk', r'output\aligned.apk'],
                   capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
if r.returncode != 0:
    print('[x] apksigner 失败\n' + (r.stdout or '')[-800:] + '\n' + (r.stderr or '')[-800:]); sys.exit(1)
print('[v] apksigner')
print('✅ APK：%s（%.2f MB）' % (os.path.join(根, '枪战突击.apk'), os.path.getsize(os.path.join(根, '枪战突击.apk')) / 1048576))
