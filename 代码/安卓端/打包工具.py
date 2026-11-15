# 把 assets 和 classes.dex 打进 apk（python 的 zipfile 能正确写 UTF-8 文件名；
# aapt2 在中文路径上会报 "failed to open file"，所以这一步必须由它代劳）
import io, os, shutil, sys, zipfile

base = 'output/base.apk'
tmp = 'output/unsigned.apk'
assets = 'app/src/main/assets'
dex = 'C:/Android/apkbuild/dex/classes.dex'

shutil.copyfile(base, tmp)
n = 0
with zipfile.ZipFile(tmp, 'a', zipfile.ZIP_DEFLATED) as z:
    z.write(dex, 'classes.dex')
    for root, dirs, files in os.walk(assets):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, assets).replace('\\', '/')
            z.write(full, 'assets/' + rel)
            n += 1
print('assets 文件数 %d，apk %.1f MB' % (n, os.path.getsize(tmp) / 1048576))
