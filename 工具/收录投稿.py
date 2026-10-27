# -*- coding: utf-8 -*-
"""把一条 GitHub Issue 投稿收录成一个模组文件

由 .github/workflows/收录模组投稿.yml 调用（也可以本地手测）：
    ISSUE_TITLE="[模组] 我的火箭筒" ISSUE_BODY="...含 ```js 代码块..." ISSUE_NUM=12 \
    python 工具/收录投稿.py

流程：解析标题 → 从正文抠出 ```js 代码块 → 安全体检 → 写成 docs/模组/<名字>_投稿<号>.js
      → 刷新 manifest 的模组段 → 把结果写进 工具/收录结果.json（Action 拿它去回帖）
任何一步不过，**不写文件**，只写结果 JSON 说明原因。
"""
import io, json, os, re, sys

仓库根 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
模组目录 = os.path.join(仓库根, 'docs', '模组')
结果文件 = os.path.join(仓库根, '工具', '收录结果.json')
# 这是机器人每次运行重写的产物，已加入 .gitignore，别手动提交它。
# Action 的「回帖并关闭」步骤当场读它；读不到时有兜底默认值，不会崩。

# 模组是**玩家本地会执行的 JS**，这里只做能一眼看出来的坏事拦截。
# 不是沙箱（真要做坏事总能绕过），主要是挡住"顺手清存档 / 偷偷上传数据 / 弹外链"这类。
禁止 = [
    ('document.cookie', '读取网页 Cookie'),
    ('localStorage.clear', '清空玩家存档'),
    ('indexedDB.deleteDatabase', '删掉玩家模组库'),
    ('XMLHttpRequest', '直接发起网络请求（要联机请用引擎的 广播/netSend）'),
    ('new Function(', '动态执行字符串代码'),
    ('eval(', '动态执行字符串代码'),
    ('<script', '往页面里插脚本标签'),
    ('window.location=', '把玩家跳转到别的网站'),
]

最小字节 = 200
最大字节 = 512 * 1024


def 写结果(ok, 消息, 文件名=''):
    io.open(结果文件, 'w', encoding='utf-8').write(json.dumps(
        {'ok': bool(ok), '消息': 消息, '文件': 文件名}, ensure_ascii=False, indent=2))
    print(('[v] ' if ok else '[x] ') + 消息)
    if not ok:
        sys.exit(0)          # 不算 Action 失败：这条投稿被驳回而已，别把整条流水线标红


def 抠代码(正文):
    """从 Issue 正文里取第一个 ```js 代码块；没有就取任意代码块"""
    m = re.search(r'```(?:js|javascript)\s*\r?\n(.*?)```', 正文, re.S)
    if not m:
        m = re.search(r'```\s*\r?\n(.*?)```', 正文, re.S)
    return m.group(1) if m else ''


def 安全名(名):
    """文件名里只留中文/字母/数字/下划线，限 20 个字（防路径穿越、防超长）"""
    名 = re.sub(r'[\\/:*?"<>|\r\n\t]', '', 名 or '')
    名 = re.sub(r'\s+', '', 名)
    return 名[:20] or '未命名模组'


def 主():
    标题 = os.environ.get('ISSUE_TITLE', '').strip()
    正文 = os.environ.get('ISSUE_BODY', '') or ''
    号 = os.environ.get('ISSUE_NUM', '0').strip() or '0'
    用户 = os.environ.get('ISSUE_USER', '').strip()

    if not 标题:
        写结果(False, '标题是空的。格式要写成「[模组] 你的模组名」。')
    if not re.match(r'^[\[【]\s*模组\s*[\]】]', 标题):
        写结果(False, '标题要以「[模组] 」开头，后面跟模组名。现在收到的是：`%s`' % 标题)

    名字 = 安全名(re.sub(r'^[\[【]\s*模组\s*[\]】]\s*', '', 标题))
    代码 = 抠代码(正文)
    if not 代码.strip():
        写结果(False, '正文里没找到代码块。请把模组代码放进 ```js … ``` 之间（三个反引号 + js）。')

    字节 = len(代码.encode('utf-8'))
    if 字节 < 最小字节:
        写结果(False, '代码只有 %d 字节，看着不像一个完整模组（至少 %d 字节）。' % (字节, 最小字节))
    if 字节 > 最大字节:
        写结果(False, '代码 %d 字节，超过 %d KB 上限。' % (字节, 最大字节 // 1024))

    if ('枪战模组' not in 代码) and ('ModLoader' not in 代码):
        写结果(False, '代码里既没有 `枪战模组` 也没有 `ModLoader` —— 这不像是本游戏的模组。')

    for 坏, 原因 in 禁止:
        if 坏 in 代码:
            写结果(False, '代码里有 `%s`（%s），出于安全考虑不能收录。' % (坏, 原因))

    # 作者署名：优先用代码头里声明的，没有就用投稿人的 GitHub 名
    作者 = ''
    mm = re.search(r'@author\s+([^\r\n　]+)', 代码)
    if mm:
        作者 = mm.group(1).strip()
    elif 用户:
        作者 = 用户

    os.makedirs(模组目录, exist_ok=True)
    文件名 = '%s_投稿%s.js' % (名字, 号)
    目标 = os.path.join(模组目录, 文件名)

    # 统一补一个模组信息头（发布中心靠它显示版本/作者；代码里已经有了就不重复）
    头 = ''
    if '@api' not in 代码:
        头 += '/* 【模组信息】@id tuiguo_%s　@name %s　@ver 1.0.0　@api 2\n' % (号, 名字)
        头 += ' * @author %s　（发布中心投稿 #%s）\n' % (作者 or '匿名', 号)
        头 += ' * ============================================================ */\n'
    io.open(目标, 'w', encoding='utf-8', newline='\n').write(头 + 代码)

    sys.path.insert(0, os.path.join(仓库根, '工具'))
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location('更新模组清单', os.path.join(仓库根, '工具', '更新模组清单.py'))
        模块 = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(模块)
        模块.主(仓库根)
    except Exception as e:
        写结果(False, '写好了文件但刷新清单失败：%s' % e, 文件名)

    写结果(True, '已收录成 `docs/模组/%s`（作者：%s），发布中心「🧩 模组」页马上能看到。' % (文件名, 作者 or '匿名'), 文件名)


if __name__ == '__main__':
    主()
