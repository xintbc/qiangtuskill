# -*- coding: utf-8 -*-
"""一键打包安卓 APK（替代 ③ 一键打包.bat，避免 pause 卡住）"""
import os, io, re, shutil, subprocess, sys

根 = r'D:\mc2\多文件版\手机版安卓'
os.chdir(根)


def 读版本():
    """从游戏源码读 GAME_VER，算成 Android 的 versionName / versionCode。

    【1.7.8】以前这里写死 '1.7.5' + code 175 —— 之后每次发版，APK 里显示的还是 1.7.5，
    而且 versionCode 一直不变，玩家装新版会被系统当成"同一个版本"直接拒绝覆盖安装。
    """
    t = io.open(os.path.join(根, 'app', 'src', 'main', 'assets', 'js', '02_状态键位与粒子.js'),
                encoding='utf-8').read()
    m = re.search(r"GAME_VER\s*=\s*'([0-9]+\.[0-9]+\.[0-9]+)'", t)
    if not m:
        print('[x] 读不到 GAME_VER（assets/js/02_状态键位与粒子.js）'); sys.exit(1)
    v = m.group(1)
    a, b, c = [int(x) for x in v.split('.')]
    return v, a * 10000 + b * 100 + c        # 1.7.8 → 10708，单调递增


版本名, 版本号 = 读版本()
print('[v] 版本 %s（versionCode %d）' % (版本名, 版本号))
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
   '--target-sdk-version', '34', '--version-code', str(版本号), '--version-name', 版本名,
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


# ---------------------------------------------------------------------------
# 7) 覆盖安装自检（关键：装不上就等于逼玩家卸载，卸载＝账号没了）
# ---------------------------------------------------------------------------
# 能"直接装新版覆盖"的三个条件：
#   ① 包名相同（com.qiangtu.game）
#   ② versionCode **单调递增**（相同或更小，系统直接拒装）
#   ③ 签名证书完全相同（同一个 debug.keystore；换过就再也覆盖不了）
# 这里拿 docs/版本/ 里已经发布过的 APK 逐个比，任何一条不满足就当场报错，
# 别等玩家下载完才发现"应用未安装"。
发布目录 = r'D://mc2//_开源仓库//docs//版本'


def _跑(args, env=None):
    return subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)


def 读APK版本(路径):
    r = _跑([os.path.join(BT, 'aapt2.exe'), 'dump', 'badging', 路径])
    a = re.search(r"versionCode='(\d+)'", r.stdout or '')
    b = re.search(r"versionName='([^']*)'", r.stdout or '')
    return (int(a.group(1)) if a else 0), (b.group(1) if b else '')


def 读APK证书(路径):
    r = _跑([os.path.join(BT, 'apksigner.bat'), 'verify', '--print-certs', 路径], env=env)
    文 = (r.stdout or '') + (r.stderr or '')
    m = re.search(r'SHA-256 digest: ([0-9a-fA-F]+)', 文)
    return m.group(1).lower() if m else ''


新包 = os.path.join(根, '枪战突击.apk')
新码, 新名 = 读APK版本(新包)
新证书 = 读APK证书(新包)
print('[i] 新包：%s（versionCode %d）证书 %s' % (新名, 新码, (新证书[:16] or '(读不到)')))

旧包们 = []
# 补历史版本的包时（1.7.7 比 1.7.8 小）必然过不了"递增"这条，用环境变量跳过
跳过自检 = os.environ.get('跳过覆盖自检') == '1'
if 跳过自检:
    print('[i] 跳过覆盖安装自检（补历史版本包）')
elif os.path.isdir(发布目录):
    for f in os.listdir(发布目录):
        if f.lower().endswith('.apk'):
            旧包们.append(os.path.join(发布目录, f))
if 旧包们 and not 跳过自检:
    最高 = max(旧包们, key=lambda x: 读APK版本(x)[0])
    旧码, 旧名 = 读APK版本(最高)
    旧证书 = 读APK证书(最高)
    print('[i] 已发布的最新：%s（versionCode %d）%s' % (旧名, 旧码, os.path.basename(最高)))
    if 新证书 and 旧证书 and 新证书 != 旧证书:
        print('[x] 签名和已发布的包不一样！换过 keystore 就再也无法覆盖安装（玩家只能卸载，账号会丢）。')
        sys.exit(1)
    if 新码 < 旧码 or (新码 == 旧码 and 新名 != 旧名):
        print('[x] versionCode 必须递增：新包 %d（%s） ≤ 已发布 %d（%s）。' % (新码, 新名, 旧码, 旧名))
        print('    相同/更小的 versionCode 会被系统当成同一个版本直接拒装，只能卸载重装。')
        sys.exit(1)
    print('[v] 覆盖安装自检通过（%d → %d，签名一致）' % (旧码, 新码))
elif not 跳过自检:
    print('[i] 发布目录里还没有 APK，跳过覆盖安装自检')

print('✅ APK：%s（%.2f MB）' % (os.path.join(根, '枪战突击.apk'), os.path.getsize(os.path.join(根, '枪战突击.apk')) / 1048576))
