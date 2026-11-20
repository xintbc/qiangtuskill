# -*- coding: utf-8 -*-
"""
枪战突击 · 发布打包脚本
====================
把「多文件版」打包成一个版本 zip，塞进 发布/版本/ 目录，
再生成 / 更新 manifest.json（网页 + 启动器都读它）。

用法：python 打包发布.py [版本号] [更新说明一行] [正式|预览]
  例：python 打包发布.py 1.7.5 "统一模组接口" 正式
      python 打包发布.py 1.8.0-p1 "试试新功能" 预览
  类型只影响显示与 PCL 里的分组（release / snapshot），不影响下载。

版本包内容（启动器解压后玩家点"开始游戏"就启动）：
  多文件版整个目录（js/ mode/ index.html spike.html 服务端.js 等）
  —— 不含客户端配置/编译产物/安卓壳（那些是开发者源码，不进玩家包）
"""
import io, os, json, shutil, sys, zipfile, hashlib

ROOT = os.path.dirname(os.path.abspath(__file__))          # D:/mc2
SRC = os.path.join(ROOT, '多文件版')
发布根 = os.path.join(ROOT, '_开源仓库', 'docs')             # 版本包 + 模组放这里（GitHub Pages 从 /docs 直接发布）
版本目录 = os.path.join(发布根, '版本')
模组目录 = os.path.join(发布根, '模组')
清单文件 = os.path.join(发布根, 'manifest.json')

# 玩家包里不要的东西（相对多文件版根）
排除 = {
    '客户端', '手机版安卓', '名字库.dat', '名字库.dat.bak',
    '实际端口.txt', '公网地址.txt', '启动日志.txt', '服务端',
}

# 【1.10.18】发版前先过手机版守卫。
# 用户要求：手机版操作层（js/72 + #touchUI 那套）以后不能被升级顶掉。
# 校验脚本会同时核对 源码分片 / index.html / 唯一源 / 客户端·安卓两个副本，
# 只要有一处被换回旧结构或者副本没同步，这里直接中止发布，不发出去。
def 校验手机版():
    脚本 = os.path.join(ROOT, '_以删除_20261018', '工具', '校验手机版.js')
    if not os.path.isfile(脚本):
        print('⚠️  找不到手机版校验脚本，跳过（%s）' % 脚本)
        return
    try:
        import subprocess
        r = subprocess.run(['node', 脚本], cwd=ROOT)
    except FileNotFoundError:
        print('⚠️  这台机器没有 node，跳过手机版校验')
        return
    if r.returncode != 0:
        print('\n❌ 手机版操作层校验不通过，已中止发布（没有生成任何版本包）。')
        print('   修好后重跑：node "_以删除_20261018/工具/校验手机版.js"')
        sys.exit(1)

def 版本(默认='1.7.5'):
    return sys.argv[1] if len(sys.argv) > 1 else 默认

def 说明():
    return sys.argv[2] if len(sys.argv) > 2 else '更新'

def 类型():
    if len(sys.argv) > 3 and ('预览' in sys.argv[3] or 'snapshot' in sys.argv[3].lower()):
        return '预览'
    return '正式'

# ==================== 版本号 → 平台（1.10.26 起） ====================
# 用户定的规矩：
#   x.y.z              → 全平台（电脑 + 手机 一起发）
#   x.y.z-mobile1      → 只有手机，电脑版**保持原版本号不动**
#   x.y.z-pc1          → 只有电脑，手机版**保持原版本号不动**
# 前三段数字只要变了，两个平台都必须跟上（所以裸号 = 全平台）。
import re as _版本re

def 版本平台(v):
    """'1.10.26' → 全平台 / '1.10.26-mobile1' → 安卓 / '1.10.26-pc2' → 电脑"""
    m = _版本re.match(r'^\d+\.\d+\.\d+-([A-Za-z]+)(\d+)$', str(v or ''))
    if not m:
        return '全平台'
    t = m.group(1).lower()
    if t in ('mobile', 'apk', 'android', 'm'):
        return '安卓'
    if t in ('pc', 'win', 'windows', 'desktop'):
        return '电脑'
    return '全平台'

def 平台覆盖(本次, 平台):
    """本次发布是否要更新这个平台"""
    return 本次 == '全平台' or 本次 == 平台

def 后缀号(v):
    """'1.10.26-pc12' → 12；裸号 → 0"""
    m = _版本re.search(r'-([A-Za-z]+)(\d+)$', str(v or ''))
    return int(m.group(2)) if m else 0

def 读游戏版本(路径):
    """从一个 js/02 文件里读 GAME_VER（读不到返回空串）"""
    try:
        with io.open(路径, encoding='utf-8') as f:
            m = _版本re.search(r"GAME_VER\s*=\s*'([0-9][0-9A-Za-z.\-]*)'", f.read())
            return m.group(1) if m else ''
    except Exception:
        return ''

# 玩家包白名单：只打「开游戏真正用得到」的文件。
# 以前是整目录复制（黑名单排除），结果 zip 里塞满了开发用的东西：
#   bat 脚本 / 名字库.dat / 端口 txt / 快捷方式 lnk / spike.html / 枪械预览.html /
#   libs（three.js 的另一份拷贝）/ 教程 txt …… 玩家打开一脸问号。
白名单文件 = [
    'index.html',
    'lib/three.r128.min.js',
    '图标.ico',
    '图标.png',
    '服务端.js',            # 想联机时自己跑（可选，留着）
]
白名单目录 = [
    'js',                   # 全部分片
    # 【不打包 mode/模组 里的示例模组】玩家要的是干净的游戏本体，
    # 示例模组改成在启动器「模组」页里按需下载（发布中心那边有）。
    # 只补一个空目录 + 说明，方便玩家自己往里丢文件。
]


def 打zip(源, 目标zip):
    """按白名单打包（只打玩家用得上的文件，前后端源码/脚本一律不进包）"""
    os.makedirs(os.path.dirname(目标zip), exist_ok=True)
    with zipfile.ZipFile(目标zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        根名 = ''          # 不套一层目录：解压出来直接就是 index.html
        已加 = set()

        def 加(全, 入):
            if os.path.isfile(全) and 入 not in 已加:
                z.write(全, 入)
                已加.add(入)

        # ① 单文件
        for 名 in 白名单文件:
            加(os.path.join(源, 名.replace('/', os.sep)), 根名 + 名)

        # ② 目录（递归；跳过隐藏/备份/日志）
        for 目录名 in 白名单目录:
            根 = os.path.join(源, 目录名.replace('/', os.sep))
            if not os.path.isdir(根):
                continue
            for 目录, 子, 文件们 in os.walk(根):
                子[:] = [x for x in 子 if not x.startswith('.')]
                for f in 文件们:
                    if f.startswith('.') or f.endswith(('.bak', '.tmp', '.log', '.zip')):
                        continue
                    if f == '模组制作教程.txt':      # 旧版教程，和 模组开发教程.md 重复
                        continue
                    全 = os.path.join(目录, f)
                    入 = 根名 + os.path.relpath(全, 源).replace('\\', '/')
                    加(全, 入)

        # ③ 模组加载器本体（index.html 里引的，必须在）
        加(os.path.join(源, 'mode', '模组加载器.js'), 根名 + 'mode/模组加载器.js')

        # ④ 版本内启动器：双击 枪战突击.exe 就进游戏（玩家不用去点 index.html）
        #    带 WebView2Loader.dll —— 内嵌内核靠它找 WebView2 运行时。
        额外 = [
            (os.path.join(源, '客户端', '游戏启动.exe'), '枪战突击.exe'),
            (os.path.join(源, '客户端', 'sdk', 'WebView2Loader.dll'), 'WebView2Loader.dll'),
        ]
        for 全, 入 in 额外:
            加(全, 入)
        缺 = [入 for 全, 入 in 额外 if not os.path.isfile(全)]
        if 缺:
            raise SystemExit('打包缺文件（版本内启动器）：' + '、'.join(缺))

        # ⑤ 空模组目录（玩家自己放 .js 模组；也告诉他在启动器里能一键下）
        z.writestr('mode/模组/放模组到这里.txt',
                   '把你的 .js 模组文件丢进这个文件夹，然后在同目录的「载入清单.js」里加一行文件名。\r\n'
                   '也可以在启动器的「模组」列表里点一下直接下载。\r\n')
        # ⑤-b 空载入清单：没有它加载器会报一次"加载失败"，玩家以为坏了
        z.writestr('mode/模组/载入清单.js',
                   '// 装了模组就把文件名（不用写 .js）加进这个数组，按顺序加载。\n'
                   '// 例：window.MOD_FILES = [\'角色_夜莺\', \'爪刀\'];\n'
                   'window.MOD_FILES = [];\n')
        # ⑤-c 模组教程：想写模组的玩家不用去翻仓库
        教程 = os.path.join(源, 'mode', '模组', '模组开发教程.md')
        if os.path.isfile(教程):
            z.write(教程, 'mode/模组/模组开发教程.md')
        else:
            raise SystemExit('打包缺文件：mode/模组/模组开发教程.md')

    return 目标zip

def md5(文件):
    h = hashlib.md5()
    with open(文件, 'rb') as f:
        for 块 in iter(lambda: f.read(1 << 20), b''):
            h.update(块)
    return h.hexdigest()

def 主():
    校验手机版()
    ver = 版本()
    本次平台 = 版本平台(ver)
    print('📦 本次发布 %s → 平台范围：%s' % (ver, 本次平台))
    zip名 = '枪战突击_v%s.zip' % ver
    zip路径 = os.path.join(版本目录, zip名)
    打zip(SRC, zip路径)
    大小 = os.path.getsize(zip路径)
    print('✅ 版本包：%s（%.1f MB）' % (zip路径, 大小 / 1048576))

    # 读旧 manifest（没有就新建）
    m = {'版本': [], '模组': [], '内核': [], '开服器': []}
    if os.path.exists(清单文件):
        m = json.load(io.open(清单文件, encoding='utf-8'))

    # 追加 / 覆盖这个版本
    新条目 = {
        '版本': ver,
        '文件': zip名,
        '大小': 大小,
        'md5': md5(zip路径),
        '日期': __import__('datetime').date.today().isoformat(),
        '说明': 说明(),
        '平台': 本次平台,     # 【1.10.26】启动器/客户端按它过滤，避免跨平台收到别人的更新
    }
    新条目['类型'] = 类型()
    m['版本'] = [x for x in m.get('版本', []) if x.get('版本') != ver]
    m['版本'].insert(0, 新条目)          # 最新的排最前
    # 版本号排序要容得下「1.8.0-p1」这种预览版后缀（旧的 int(p) 会直接崩）
    import re as _re
    def _版本键(x):
        # 【1.10.26】1.10.26-mobile1 / -pc1 这种平台后缀也要参与排序：
        #   主体三段 → 后缀号 → 平台字母。只取前 3 个数字会让
        #   「1.10.25-mobile1」和「1.10.25」并列，每次发布 manifest 顺序随机抖动。
        _s = str(x.get('版本', '0'))
        nums = _re.findall(r'\d+', _s)
        while len(nums) < 3: nums.append('0')
        _tag = _re.search(r'-([A-Za-z]+)(\d+)', _s)
        return [int(n) for n in nums[:3]] + [int(_tag.group(2)) if _tag else 0,
                                             _tag.group(1).lower() if _tag else '']
    m['版本'].sort(key=_版本键, reverse=True)

    # 扫模组目录里的 .js 填进清单。
    # 【1.7.10】统一走 工具/更新模组清单.py —— 投稿机器人也用同一份扫描逻辑，
    # 两处各写一遍迟早漂移（比如作者字段只有一个地方有）。
    try:
        import importlib.util
        _工具 = os.path.join(ROOT, '_开源仓库', '工具', '更新模组清单.py')
        _spec = importlib.util.spec_from_file_location('更新模组清单', _工具)
        _mod = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(_mod)
        m['模组'] = _mod.扫模组(模组目录)
    except Exception as e:
        print('⚠️ 模组清单刷新失败（沿用清单里的旧数据）：%s' % e)
        m['模组'] = m.get('模组', [])

    # ------------------------------------------------------------------
    # 【1.9.46】开服器内核包 + 开服器本体 → docs/内核/ 和 docs/开服器/
    # ------------------------------------------------------------------
    # 「枪战开服器」（电脑 EXE / 手机 APK）的「📦 内核」页会拉 manifest.json 里的
    # 「内核」数组，和本地 内核/内核版本.txt 比对，有新版就整包下载覆盖。
    # 升级包故意**不含** node.exe（90MB，基本不变）和 mode/模组/（玩家自己的模组）。
    try:
        with io.open(os.path.join(SRC, '服务端.js'), encoding='utf-8') as _f:
            _mk = _re.search(r"const\s+SRV_VER\s*=\s*'([0-9.]+(?:-[A-Za-z]+[0-9]+)?)'", _f.read())
        内核版 = _mk.group(1) if _mk else ver
    except Exception:
        内核版 = ver

    内核发布目录 = os.path.join(发布根, '内核')
    os.makedirs(内核发布目录, exist_ok=True)
    内核zip名 = '枪战内核_v%s.zip' % 内核版
    内核zip路径 = os.path.join(内核发布目录, 内核zip名)

    def _加树(_z, _源, _基, _排除=()):
        for _目录, _子, _文件们 in os.walk(_源):
            _子[:] = [x for x in _子
                      if not x.startswith('.') and os.path.join(os.path.basename(_目录), x) not in _排除
                      and os.path.relpath(os.path.join(_目录, x), _源).replace('\\', '/') not in _排除]
            for _f in _文件们:
                if _f.startswith('.') or _f.endswith(('.bak', '.tmp', '.log', '.zip')):
                    continue
                _全 = os.path.join(_目录, _f)
                _入 = _基 + os.path.relpath(_全, _源).replace('\\', '/')
                _z.write(_全, _入)

    with zipfile.ZipFile(内核zip路径, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for _名 in ('服务端.js', 'index.html', 'spike.html', '图标.ico', '图标.png'):
            _p = os.path.join(SRC, _名)
            if os.path.isfile(_p):
                z.write(_p, _名)
        for _名 in ('js', 'lib', 'libs'):
            _p = os.path.join(SRC, _名)
            if os.path.isdir(_p):
                _加树(z, _p, _名 + '/')
        # mode/ 全要，唯独 mode/模组/ 不进升级包（那里面是玩家自己装的模组）
        _mp = os.path.join(SRC, 'mode')
        if os.path.isdir(_mp):
            _加树(z, _mp, 'mode/', _排除={'mode/模组', '模组'})
        z.writestr('内核版本.txt', 内核版 + '\n' + __import__('datetime').date.today().isoformat() + '\n')
    print('✅ 内核包：%s（%.2f MB，内核 %s）' % (内核zip路径, os.path.getsize(内核zip路径) / 1048576, 内核版))

    m['内核'] = [x for x in m.get('内核', []) if x.get('版本') != 内核版]
    m['内核'].insert(0, {
        '版本': 内核版, '文件': 内核zip名, '大小': os.path.getsize(内核zip路径),
        'md5': md5(内核zip路径), '日期': __import__('datetime').date.today().isoformat(),
        '说明': '开服器内核：服务端.js + 游戏网页文件（不含 node.exe 和玩家模组）',
    })
    m['内核'].sort(key=_版本键, reverse=True)

    # 开服器本体（电脑 zip + 手机 apk），有的话一起挂上下载站
    m['开服器'] = m.get('开服器', [])
    开服器发布目录 = os.path.join(SRC, '开服器')
    开服器下载目录 = os.path.join(发布根, '开服器')
    os.makedirs(开服器下载目录, exist_ok=True)

    _电脑发布 = os.path.join(开服器发布目录, '发布', '枪战开服器')
    if os.path.isdir(_电脑发布) and os.path.isfile(os.path.join(_电脑发布, '枪战开服器.exe')):
        _zip名 = '枪战开服器_电脑_v%s.zip' % 内核版
        _zip路径 = os.path.join(开服器下载目录, _zip名)
        with zipfile.ZipFile(_zip路径, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for _目录, _子, _文件们 in os.walk(_电脑发布):
                for _f in _文件们:
                    _全 = os.path.join(_目录, _f)
                    if _f in ('启动日志.txt',):
                        continue
                    z.write(_全, os.path.join('枪战开服器', os.path.relpath(_全, _电脑发布).replace('\\', '/')))
        m['开服器'] = [x for x in m['开服器'] if x.get('平台') != '电脑']
        m['开服器'].insert(0, {
            '平台': '电脑', '版本': 内核版, '文件': _zip名, '大小': os.path.getsize(_zip路径),
            'md5': md5(_zip路径), '日期': __import__('datetime').date.today().isoformat(),
            '说明': '💻 电脑开服器（解压后双击 枪战开服器.exe，一键开服）',
        })
        print('✅ 开服器（电脑）：%s（%.1f MB）' % (_zip路径, os.path.getsize(_zip路径) / 1048576))
    else:
        print('⚠️ 没找到开服器电脑版发布目录（开服器\\发布\\枪战开服器），跳过电脑包')

    _apk源 = os.path.join(开服器发布目录, '手机版', '枪战开服器.apk')
    if os.path.isfile(_apk源):
        _apk名 = '枪战开服器_手机_v%s.apk' % 内核版
        _apk路径 = os.path.join(开服器下载目录, _apk名)
        shutil.copy2(_apk源, _apk路径)
        m['开服器'] = [x for x in m['开服器'] if x.get('平台') != '手机']
        m['开服器'].insert(0, {
            '平台': '手机', '版本': 内核版, '文件': _apk名, '大小': os.path.getsize(_apk路径),
            'md5': md5(_apk路径), '日期': __import__('datetime').date.today().isoformat(),
            '说明': '📱 手机开服器（APK，手机自己当服务器）',
        })
        print('✅ 开服器（手机）：%s（%.1f MB）' % (_apk路径, os.path.getsize(_apk路径) / 1048576))
    else:
        print('⚠️ 没找到开服器手机版 APK，跳过手机包')

    # 开服器安装程序（SFX 安装包：双击安装 + 快捷方式 + 系统卸载）
    _setup源 = os.path.join(开服器发布目录, '发布', '枪战开服器_安装版_v%s.exe' % 内核版)
    if os.path.isfile(_setup源):
        _setup名 = '枪战开服器_电脑安装版_v%s.exe' % 内核版
        _setup路径 = os.path.join(开服器下载目录, _setup名)
        shutil.copy2(_setup源, _setup路径)
        m['开服器'] = [x for x in m['开服器'] if x.get('平台') != '电脑安装包']
        m['开服器'].insert(0, {
            '平台': '电脑安装包', '版本': 内核版, '文件': _setup名, '大小': os.path.getsize(_setup路径),
            'md5': md5(_setup路径), '日期': __import__('datetime').date.today().isoformat(),
            '说明': '💻 电脑开服器安装版（双击安装，自动建快捷方式，可在系统里卸载）',
        })
        print('✅ 开服器（电脑安装包）：%s（%.1f MB）' % (_setup路径, os.path.getsize(_setup路径) / 1048576))
    else:
        print('⚠️ 没找到开服器安装包（开服器\\发布\\枪战开服器_安装版_v%s.exe），跳过安装包' % 内核版)

    # ------------------------------------------------------------------
    # 客户端安装包（手机 APK / 电脑安装程序）
    # ------------------------------------------------------------------
    # 【1.7.8】以前发布中心只有源码 zip —— 手机玩家拿到 zip 根本装不了，
    # 电脑玩家也得先解压再找 exe。这里把两个「双击就能装」的产物一起放上去。
    # 【1.7.9】改成**保留历史**：每个版本都留着，玩家想回旧版随时能下
    # （安装包必须和服务器版本对得上，所以清单里要能看出是哪个版本）。
    # 【1.10.26】每个平台各带一个「包内版本来源」：
    #   只发手机版（-mobileN）时，电脑包一个字节都不动，条目也保持上一版的版本号，
    #   以前两平台共用同一个 ver，会把旧电脑包改名成手机版号 → 电脑端收到手机版更新、
    #   一个版本里两个平台版本号对不上。
    安装包源 = [
        ('安卓', os.path.join(SRC, '手机版安卓', '枪战突击.apk'), '枪战突击_安卓_v%s.apk', '📱 安卓 APK（手机）',
         os.path.join(SRC, '手机版安卓', 'app', 'src', 'main', 'assets', 'js', '02_状态键位与粒子.js')),
        ('电脑', os.path.join(SRC, '客户端', '枪战突击_安装程序.exe'), '枪战突击_安装程序_v%s.exe', '💻 电脑安装程序（Windows）',
         os.path.join(SRC, '客户端', '游戏', 'js', '02_状态键位与粒子.js')),
    ]

    # 【1.9.33b】防再犯：安装包/APK 是**独立打包**的（打包安装包.py / _一键打包.py），
    # 本脚本只负责复制——如果它们比游戏源码旧，说明忘了重打，内嵌的还是老版本。
    _游戏源 = os.path.join(SRC, 'js', '02_状态键位与粒子.js')
    if os.path.isfile(_游戏源):
        _源时 = os.path.getmtime(_游戏源)
        for _平台, _文件, _t, _标题, _版本源 in 安装包源:
            if os.path.isfile(_文件) and os.path.getmtime(_文件) < _源时:
                import time as _time
                print('⚠️  警告：%s（%s）比游戏源码旧（打包于 %s），内嵌的可能不是本版内容！'
                      % (_平台, os.path.basename(_文件), _time.strftime('%m-%d %H:%M', _time.localtime(os.path.getmtime(_文件)))))
                print('    请先跑对应打包脚本（电脑：客户端/打包安装包.py；安卓：手机版安卓/_一键打包.py）再发布。')

    # 【1.9.42】防再犯：js/css 的 URL 带 ?v=版本号，本地服务和 Node 服务端都对 .js 发
    # `immutable`（一年不过期）。版本号不同步 → 玩家装上新版，跑的还是缓存里的旧代码
    # （1.9.41 事故：GAME_VER 已 1.9.41，index.html 仍写 ?v=1.9.40，客户端画面一点没变）。
    _ver = '?'
    try:
        import re as _re
        with io.open(_游戏源, encoding='utf-8') as _f:
            _mm = _re.search(r"GAME_VER\s*=\s*'([0-9][0-9A-Za-z.\-]*)'", _f.read())
            if _mm:
                _ver = _mm.group(1)
    except Exception:
        pass
    if _ver != '?':
        # 【1.10.26】只查本次真正发布的平台：
        #   只发手机版时，电脑那份 index.html 停在旧版本号是**正常的**
        #   （它没跟着重打），以前一刀切检查会把正常情况判成"没同步"拒绝发布。
        _要查 = [os.path.join(SRC, 'index.html')]
        if 平台覆盖(本次平台, '安卓'):
            _要查.append(os.path.join(SRC, '手机版安卓', 'app', 'src', 'main', 'assets', 'index.html'))
        if 平台覆盖(本次平台, '电脑'):
            _要查.append(os.path.join(SRC, '客户端', '游戏', 'index.html'))
        _坏的 = []
        for _h in _要查:
            if not os.path.isfile(_h):
                continue
            with io.open(_h, encoding='utf-8') as _f:
                _t = _f.read()
            import re as _re2
            _旧 = set(_re2.findall(r'\?v=([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z]+[0-9]+)?)', _t))
            if _旧 and _旧 != {_ver}:
                _坏的.append('%s（%s）' % (os.path.relpath(_h, ROOT), '/'.join(sorted(_旧))))
        if _坏的:
            print('❌ 资源版本号没同步，拒绝发布：')
            for _x in _坏的:
                print('    ' + _x)
            print('    应为 ?v=%s。先跑：node "_以删除_20261018/工具/同步资源版本号.js" --写' % _ver)
            print('    然后刷副本 + 重打安装包（打包安装包.py / _一键打包.py）再发布。')
            sys.exit(1)

    # 先把旧清单里的条目读出来（上一版是 dict，这里统一成 list）
    旧客 = m.get('客户端') or []
    if isinstance(旧客, dict):
        旧客 = [dict(v, 平台=k) for k, v in 旧客.items()]
    条目表 = {}
    for x in 旧客:
        if isinstance(x, dict) and x.get('平台') and x.get('文件'):
            条目表[(x['平台'], str(x.get('版本', '')))] = x

    for 平台, 源文件, 模板, 标题, 版本源 in 安装包源:
        if not os.path.isfile(源文件):
            print('ℹ️  跳过 %s：没有 %s（先打包客户端/APK 再跑本脚本）' % (平台, os.path.basename(源文件)))
            continue
        # 【1.10.26】只发一个平台时，另一个平台的包原样不动
        if not 平台覆盖(本次平台, 平台):
            _旧版 = sorted({str(x.get('版本', '')) for x in 旧客 if x.get('平台') == 平台} - {''})
            print('⏭️  %s：本次是「%s」单独更新，保持原版本 %s 不动'
                  % (平台, 本次平台, '、'.join(_旧版) if _旧版 else '（暂无）'))
            continue
        # 包内真实版本号（打 APK / 安装包时写进去的 GAME_VER），必须和本次发布号一致，
        # 否则说明忘了重打 —— 宁可中止，也不要把旧包标成新版本发出去。
        # 【1.10.27-pc1】例外：只改了打包内容、游戏本体没动时（例如修安装包里混进玩家模组），
        # 允许「包内版本 = 发布号主体」（1.10.27 的包 配 1.10.27-pc1 的发布号）。
        # 裸号发布仍然严格：包内必须一字不差等于发布号。
        包版本 = 读游戏版本(版本源) or ver
        _主体 = ver.split('-')[0]
        _主体放行 = (ver != _主体 and 包版本 == _主体)
        if 包版本 != ver and not _主体放行:
            print('❌ %s 安装包里的玩家版本是 %s，但本次发布的是 %s。' % (平台, 包版本, ver))
            print('   说明这个平台的包没跟着重打（或重打时 GAME_VER 还是旧的），拒绝发布。')
            print('   先重打：%s' % ('手机版安卓/_一键打包.py' if 平台 == '安卓' else '客户端/打包安装包.py'))
            sys.exit(1)
        if _主体放行:
            print('ℹ️  %s：包内版本 %s = 发布号主体，判定为「只更新打包内容」，放行' % (平台, 包版本))
        文件名 = 模板 % ver
        目标 = os.path.join(版本目录, 文件名)
        shutil.copy2(源文件, 目标)
        条目表[(平台, ver)] = {
            '平台': 平台,
            '标题': 标题,
            '版本': ver,
            '文件': 文件名,
            '大小': os.path.getsize(目标),
            'md5': md5(目标),
            '日期': __import__('datetime').date.today().isoformat(),
        }
        print('✅ %s：%s（%.1f MB）' % (平台, 目标, os.path.getsize(目标) / 1048576))

    # 【1.7.9】再把目录里已经存在的历史安装包也补进清单：
    # 只靠"旧清单 + 本版本"会漏 —— 补历史包是直接往目录里丢文件的，清单里就没它们。
    import re as _re2
    _包前缀 = r'^枪战突击_(安卓|安装程序)_v(\d+\.\d+\.\d+(?:-[A-Za-z]+\d+)?)\.(apk|exe)$'
    for _f in os.listdir(版本目录):
        _m = _re2.match(_包前缀, _f)
        if not _m:
            continue
        _平台 = '安卓' if _m.group(1) == '安卓' else '电脑'
        _ver = _m.group(2)
        if (_平台, _ver) in 条目表:
            continue
        _全 = os.path.join(版本目录, _f)
        条目表[(_平台, _ver)] = {
            '平台': _平台,
            '标题': ('📱 安卓 APK（手机）' if _平台 == '安卓' else '💻 电脑安装程序（Windows）'),
            '版本': _ver,
            '文件': _f,
            '大小': os.path.getsize(_全),
            'md5': md5(_全),
            '日期': __import__('datetime').date.fromtimestamp(os.path.getmtime(_全)).isoformat(),
        }

    # 只留文件真的还在的条目（有人手工删了文件，清单不能指向空气）
    客户端列表 = [x for x in 条目表.values()
              if os.path.isfile(os.path.join(版本目录, x['文件']))]
    # 排序：主体版本倒序 → 同主体后缀号大的在前 → 同版本 安卓 在前
    def _客键(x):
        _s = str(x.get('版本', '0'))
        nums = _re2.findall(r'\d+', _s)
        while len(nums) < 3: nums.append('0')
        return (-int(nums[0]), -int(nums[1]), -int(nums[2]), -后缀号(_s),
                0 if x.get('平台') == '安卓' else 1)
    客户端列表.sort(key=_客键)
    m['客户端'] = 客户端列表

    io.open(清单文件, 'w', encoding='utf-8').write(
        json.dumps(m, ensure_ascii=False, indent=2))
    print('✅ manifest.json 已更新：%d 个版本 / %d 个模组 / %d 个客户端'
          % (len(m['版本']), len(m['模组']), len(m['客户端'])))

if __name__ == '__main__':
    主()
