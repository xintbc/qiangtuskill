# -*- coding: utf-8 -*-
# 打「枪战突击」电脑客户端单文件安装程序（一个 exe，双击即装）。
#
# 流程：
#   1) 收集要内嵌的文件（客户端 exe + 游戏拷贝 + 使用说明）复制到 ASCII 临时目录
#      （windres 不认中文文件名，必须走这一步）
#   2) 生成 清单.txt（编号\t相对路径\t大小）和 安装器资源.rc
#   3) windres 编译资源 → 安装器资源.o
#   4) gcc 链接 安装器.c + 资源.o → 枪战突击_安装程序.exe
#
# 产物：客户端/枪战突击_安装程序.exe（约 3.5MB，含全部游戏文件）
import os, io, shutil, subprocess, sys

客户端目录 = os.path.dirname(os.path.abspath(__file__))
游戏目录 = os.path.join(客户端目录, '游戏')
临时 = os.path.join(os.environ.get('TEMP', 'C:////Windows////Temp'), 'qzst_pkg')  # ⚠️ 必须整条路径 ASCII：windres 不认中文目录
输出 = os.path.join(客户端目录, '枪战突击_安装程序.exe')

GCC = r'D:\msy\mingw64\bin\gcc.exe'
WINDRES = r'D:\msy\mingw64\bin\windres.exe'

# 要装的文件：(磁盘路径, 安装后相对路径)。顺序＝清单顺序。
文件们 = []


def 收(磁盘路径, 相对路径):
    if os.path.isfile(磁盘路径):
        文件们.append((磁盘路径, 相对路径.replace('\\', '/')))


# ① 客户端 exe（64 位）
收(os.path.join(客户端目录, '枪战客户端.exe'), '枪战客户端.exe')
# ①-b WebView2 引导库（exe 启动就要它，少了直接"内核起不来"——启动日志会写 Loader 载入=失败）
收(os.path.join(客户端目录, 'sdk', 'WebView2Loader.dll'), 'sdk/WebView2Loader.dll')
# ② 使用说明
收(os.path.join(客户端目录, '使用说明.txt'), '使用说明.txt')
# ③ 游戏拷贝全部文件
for 根, 目录们, 文件列表 in os.walk(游戏目录):
    for f in sorted(文件列表):
        全 = os.path.join(根, f)
        相对 = os.path.relpath(全, 游戏目录).replace('\\', '/')
        收(全, '游戏/' + 相对)

assert 文件们, '没找到要打包的文件'
print('待内嵌文件 %d 个' % len(文件们))

# 1) ASCII 临时目录（000001.bin …），中文路径全躲开
if os.path.exists(临时):
    shutil.rmtree(临时)
os.makedirs(临时)

清单行 = []
总大小 = 0
for i, (磁盘, 相对) in enumerate(文件们, start=1):
    临时名 = '%06d.bin' % i
    shutil.copyfile(磁盘, os.path.join(临时, 临时名))
    大小 = os.path.getsize(磁盘)
    总大小 += 大小
    清单行.append('%d\t%s\t%d' % (i, 相对, 大小))
io.open(os.path.join(临时, 'manifest.txt'), 'w', encoding='utf-8', newline='\n').write('\n'.join(清单行) + '\n')
print('内嵌总大小 %.1f MB' % (总大小 / 1048576))

# 2) 生成 rc（清单也是资源，号 900）
rc行 = ['#pragma code_page(65001)']
rc行.append('900 RCDATA "%s"' % os.path.join(临时, 'manifest.txt').replace('\\', '\\\\'))
for i in range(1, len(文件们) + 1):
    rc行.append('%d RCDATA "%s"' % (i, os.path.join(临时, '%06d.bin' % i).replace('\\', '\\\\')))
rc路径 = os.path.join(临时, 'installer_res.rc')
io.open(rc路径, 'w', encoding='utf-8', newline='\n').write('\n'.join(rc行) + '\n')

# 3) windres
o路径 = os.path.join(临时, 'installer_res.o')
r = subprocess.run([WINDRES, '-O', 'coff', rc路径, '-o', o路径], capture_output=True, encoding='utf-8', errors='replace')
if r.returncode != 0 or not os.path.exists(o路径):
    print('windres 失败：', r.stderr[:500]); sys.exit(1)
print('资源编译 OK')

# 4) gcc 链接安装器
# ⚠️ 输出名必须 ASCII：从 Git Bash 给 gcc 传中文输出路径会产乱码文件名，
#    所以先出 installer_tmp.exe，再用 python 改名（老坑，见项目记忆）。
临时exe = os.path.join(临时, 'installer_tmp.exe')
if os.path.exists(临时exe):
    os.remove(临时exe)
cmd = [GCC, '-O2', '-std=gnu99', '-w', '-municode', '-mwindows',
       '-finput-charset=UTF-8',
       os.path.join(客户端目录, '安装器.c'), o路径,
       '-o', 临时exe,
       '-lws2_32', '-lole32', '-loleaut32', '-lcomctl32', '-lshell32',
       '-luser32', '-lgdi32', '-ladvapi32', '-luuid']
r = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace')
if r.returncode != 0 or not os.path.exists(临时exe):
    print('gcc 失败：', (r.stderr or r.stdout)[:2000]); sys.exit(1)
print('安装器链接 OK')
if os.path.exists(输出):
    os.remove(输出)
shutil.move(临时exe, 输出)

# 5) 校验：是 PE、体积合理
大小 = os.path.getsize(输出)
assert 大小 > 1024 * 1024, '产物太小，可能没带上资源'
头 = open(输出, 'rb').read(2)
assert 头 == b'MZ', '不是 PE 文件'
print('✅ 单文件安装程序：%s' % 输出)
print('   大小 %.1f MB（内含游戏 %d 个文件）' % (大小 / 1048576, len(文件们)))

# 6) 清理临时目录
shutil.rmtree(临时)
print('临时文件已清理')
