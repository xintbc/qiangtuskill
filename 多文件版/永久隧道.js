/* ============================================================================
   枪战突击 · 永久公网隧道（Tailscale Funnel）
   ----------------------------------------------------------------------------
   和"临时隧道"的区别：
     · 临时隧道（cloudflared trycloudflare）：每次重启换一个新网址，朋友得重新要；
     · **永久隧道（Tailscale Funnel）：网址绑在你的设备名上，关掉、重启电脑、换网络都还是它。**
       —— 所以只需要发给朋友一次。

   用法（一般不用手敲，双击「启动永久隧道.bat」即可）：
       node 永久隧道.js             # 默认把本机 8765 端口开到公网
       node 永久隧道.js 9000        # 换端口

   它会：
     ① 找到 tailscale.exe（PATH / 常见安装位置）
     ② 确认已登录（没登录会提示你先 tailscale up）
     ③ 开 Funnel（**必须带 --bg**：不带的话它挂在当前窗口，窗口一关隧道就断）
     ④ 把网址写进 服务器\公网地址.txt 与 多文件版\公网地址.txt
        （第一行＝网址，第二行＝"永久" —— 服务端读到"永久"就不会按"超过一天算过期"处理）
     ⑤ 把网址连同"发给朋友"的提示打到控制台
   ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
/* 【batch169】端口解析：手动参数 > 服务端写下的「实际端口.txt」 > 默认 8765
   这样服务端因端口被占跳到 8766 时，隧道也能自动跟过去，远程玩家不会连到空端口。 */
const PORT = (function () {
  const a = parseInt(process.argv[2], 10);
  if (a) return a;
  for (const f of ['多文件版/实际端口.txt', '服务器/实际端口.txt']) {
    try { const v = parseInt(fs.readFileSync(path.join(HERE, f), 'utf8')); if (v) return v; } catch (e) { }
  }
  return 8765;
})();
/* 两代服务端各读自己目录下的 公网地址.txt —— 两边都写一份最省事 */
const 输出目录 = [path.join(HERE, '服务器'), path.join(HERE, '多文件版')].filter(d => {
  try { return fs.statSync(d).isDirectory(); } catch (e) { return false; }
});

function 行(s) { console.log(s); }
function 标题(s) { 行(''); 行('  ' + s); }

/* ---------------------------------------------------------- 找 tailscale.exe */
function 找tailscale() {
  const 候选 = [
    process.env.TAILSCALE,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tailscale', 'tailscale.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Tailscale', 'tailscale.exe'),
    'tailscale'                     // 交给 PATH
  ].filter(Boolean);
  for (const c of 候选) {
    if (c === 'tailscale') {
      try { execFileSync('tailscale', ['version'], { stdio: 'ignore' }); return 'tailscale'; }
      catch (e) { continue; }
    }
    try { if (fs.statSync(c).isFile()) return c; } catch (e) { }
  }
  return null;
}

/* 跑一条 tailscale 子命令，返回 stdout（失败返回 null） */
function ts(exe, args) {
  try {
    return execFileSync(exe, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return null;
  }
}

/* 从 funnel status 文本里抠出 https://xxx.ts.net */
function 抠网址(text) {
  if (!text) return '';
  const m = String(text).match(/https:\/\/[A-Za-z0-9._-]+\.ts\.net\/?/);
  return m ? m[0].replace(/\/+$/, '') : '';
}

/* 取公网网址：三种姿势依次试（不同版本 tailscale 的输出格式不一样） */
function 取网址(exe) {
  let u = 抠网址(ts(exe, ['funnel', 'status']));
  if (u) return u;
  /* --json 版本：{"TCP":{"443":{"HTTPS":true}}, "AllowFunnel":..., "Web":[{"HostPort":"xxx.ts.net:443"}]} */
  const j1 = ts(exe, ['funnel', 'status', '--json']);
  if (j1) {
    try {
      const o = JSON.parse(j1);
      const web = o.Web || o.web;
      if (Array.isArray(web) && web.length) u = 抠网址(String(web[0].HostPort || '')) || ('https://' + String(web[0].HostPort || '').split(':')[0]);
      if (!u && o.Self && o.Self.DNSName) u = 'https://' + String(o.Self.DNSName).replace(/\.$/, '');
      if (u) return u;
    } catch (e) { }
  }
  /* 兜底：从设备名推 —— Funnel 挂在 443，网址就是 https://<设备>.<tailnet>.ts.net */
  const j2 = ts(exe, ['status', '--json']);
  if (j2) {
    try {
      const o = JSON.parse(j2);
      const dns = o.Self && o.Self.DNSName;
      if (dns) return 'https://' + String(dns).replace(/\.$/, '');
    } catch (e) { }
  }
  return '';
}

/* 写公网地址.txt：第一行网址，第二行"永久"（服务端靠它判断不过期） */
function 写地址文件(url) {
  for (const d of 输出目录) {
    const f = path.join(d, '公网地址.txt');
    try {
      fs.writeFileSync(f, url + '\r\n永久\r\n', 'utf8');
      行('  ✓ 已写入 ' + f);
    } catch (e) {
      行('  ✗ 写 ' + f + ' 失败：' + e.message);
    }
  }
}

/* ------------------------------------------------------------------ 主流程 */
标题('枪战突击 · 永久公网隧道（Tailscale Funnel）');

const exe = 找tailscale();
if (!exe) {
  行('  [错误] 没有找到 Tailscale。');
  行('');
  行('  永久网址靠的是 Tailscale（免费），装一次就行：');
  行('     1) 打开 https://tailscale.com/download 下载 Windows 版并安装');
  行('     2) 装好后登录（同一个账号在你的电脑和手机上）');
  行('     3) 再双击这个 BAT');
  行('');
  行('  注意：手机端也要装 Tailscale 并登录同一账号，才能连上这个永久网址。');
  process.exit(1);
}
行('  tailscale: ' + exe);

const st = ts(exe, ['status']);
if (st === null || /logged out|not logged in|NeedsLogin/i.test(st)) {
  行('  [需要先登录] 请在命令行执行一次：tailscale up');
  行('  然后再双击这个 BAT。');
  process.exit(1);
}
行('  ✓ Tailscale 已登录');

/* 开 Funnel。--bg 是关键：后台常驻，不跟着这个窗口一起死。 */
行('  正在把本机 ' + PORT + ' 端口开到公网 …（第一次会要你在浏览器里点一下授权）');
const 开 = ts(exe, ['funnel', '--bg', '--yes', String(PORT)]);
if (开 === null) {
  行('  [失败] tailscale funnel 没跑起来。常见原因：');
  行('     · 这个账号/设备还没在管理后台打开 Funnel（首次需要在 https://login.tailscale.com 里启用）');
  行('     · 端口不是 Funnel 允许的（只允许 443 / 8443 / 10000 对外，本地端口随意）');
  process.exit(1);
}
if (String(开).trim()) 行('  ' + String(开).trim().split('\n').join('\n  '));

const url = 取网址(exe);
if (!url) {
  行('  [!] 隧道应该开起来了，但没能自动读出网址。');
  行('      手动看一眼：tailscale funnel status');
  process.exit(1);
}

写地址文件(url);

标题('搞定 —— 这个网址是永久的，只用发一次');
行('');
行('      ' + url);
行('');
行('  朋友手机/电脑上也要装 Tailscale 并登录你的账号，然后浏览器打开上面的网址就能进。');
行('  服务端会自动认出它（控制台会打印这个网址），你直接看服务器窗口也行。');
行('  想关掉隧道：tailscale funnel --bg off');
行('');
