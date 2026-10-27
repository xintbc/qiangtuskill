# -*- coding: utf-8 -*-
"""重新生成 manifest.json 的「模组」段（别的段原样保留）

模组投稿被收录、或者手工往 docs/模组/ 里丢了一个 .js，跑一下这个脚本就行。
打包发布.py 里也调用了同样的逻辑（发版本时顺便刷一遍）。
"""
import io, json, os, re, sys, hashlib


def md5(文件):
    h = hashlib.md5()
    with open(文件, 'rb') as f:
        for 块 in iter(lambda: f.read(1 << 20), b''):
            h.update(块)
    return h.hexdigest()


def 扫模组(模组目录):
    """扫描目录里的 .js，按文件头 @ver / @api 生成清单条目"""
    清单 = []
    if not os.path.isdir(模组目录):
        return 清单
    for f in sorted(os.listdir(模组目录)):
        if not f.endswith('.js'):
            continue
        全 = os.path.join(模组目录, f)
        文 = io.open(全, encoding='utf-8', errors='replace').read()
        m = re.search(r"@ver\s+([0-9]+(?:\.[0-9]+){0,2})", 文) or \
            re.search(r"MOD_VER\s*=\s*['\"]([0-9]+(?:\.[0-9]+){0,2})['\"]", 文)
        ma = re.search(r"@api\s+(\d+)", 文)
        接口 = int(ma.group(1)) if ma else 1
        作者 = ''
        mm = re.search(r"@author\s+([^\r\n　]+)", 文)
        if mm:
            作者 = mm.group(1).strip()
        清单.append({
            '名字': f,
            '作者': 作者,
            '版本': m.group(1) if m else '',
            '大小': os.path.getsize(全),
            'md5': md5(全),
            # 兼容标注看「模组接口版本」：@api 2 = 需要 1.7.5+；没写 @api 的是老英文接口
            '兼容': ('接口 v2（需 1.7.5+）' if 接口 >= 2 else '通用（不限版本）'),
            '接口': 接口,
        })
    return 清单


def 主(仓库根=None):
    仓库根 = 仓库根 or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    docs = os.path.join(仓库根, 'docs')
    清单文件 = os.path.join(docs, 'manifest.json')
    m = {'版本': [], '模组': [], '客户端': []}
    if os.path.exists(清单文件):
        m = json.load(io.open(清单文件, encoding='utf-8'))
    m['模组'] = 扫模组(os.path.join(docs, '模组'))
    io.open(清单文件, 'w', encoding='utf-8').write(json.dumps(m, ensure_ascii=False, indent=2))
    print('✅ 模组清单已更新：%d 个模组（版本 %d / 客户端 %d 未动）'
          % (len(m['模组']), len(m.get('版本', [])), len(m.get('客户端', []))))
    return m['模组']


if __name__ == '__main__':
    主(sys.argv[1] if len(sys.argv) > 1 else None)
