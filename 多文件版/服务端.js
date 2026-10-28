/* ============================================================================
   枪战突击 · 局域网对战服务器（服务端.js）
   ----------------------------------------------------------------------------
   · 只用 Node 内置模块，无需 npm install，无需联网（首次会自动缓存 three.js）
   · 服务端本身：不产生任何敌人、不渲染画面、不打开浏览器窗口
   · 玩家与玩家互为敌人；电脑端 / 手机端连上来就能进同一个世界
   启动：双击「启动服务器.bat」  或  node 服务端.js [端口]
   ============================================================================ */
'use strict';

/* 【batch229】版本分化（和客户端 js/02 的 GAME_VER 对应）：
   · SRV_VER     ＝ 这个服务器自己的版本号（开局日志会打出来）
   · SRV_VER_MIN ＝ 客户端最低可进版本（大版本升级后，老客户端连上也被拒，并收到明确提示）
   规则：major 不同 → 拒；客户端 < SRV_VER_MIN → 拒；同 major 且 >= min → 放行。
   改版本：上功能 minor+1；动联机协议/存档 major+1 并把 SRV_VER_MIN 顶到新 major 的起点。
   【1.7.5】只加了模组接口（纯客户端），联机协议没变 → SRV_VER 跟着走，SRV_VER_MIN 仍留 1.7.0，
   1.7.0 的老客户端照常能进（版本分化不等于逼所有人升级）。 */
const SRV_VER = '1.7.14';
const SRV_VER_MIN = '1.7.0';

/* 版本比较：'1.7.0' vs '1.7.0' → 0；前者小 → -1；前者大 → 1（按 major.minor.patch 逐段比） */
function verCmp(a, b) {
  const pa = String(a || '0').split('.').map(x => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

let PORT = parseInt(process.argv[2], 10) || 8765;   // 8765 不常见，避免被别的程序占用
const BASE_PORT = PORT;
let portTries = 0;
const DIR = __dirname;                        // 服务器/
const ROOT = path.resolve(DIR, '..');
/* 【batch182】多文件版客户端与模组都在 ROOT/多文件版/ 下。这份服务端跑在 服务器/ 里，
   DIR 下既没有 index.html 也没有 mode/ —— 旧写法让权威源的 /pc、/mode/、模组管理
   全指向不存在的路径（生成器把它复制进 多文件版/ 后 DIR 恰好才对，两边行为分叉）。
   统一走这个助手：优先 ROOT/多文件版，找不到就退回 DIR（兼容被单独挪走的情况）。 */
function gameDir() {
  const d = path.join(ROOT, '多文件版');
  try { if (fs.existsSync(d)) return d; } catch (e) { }
  return DIR || __dirname;
}         // 上级目录：电脑版/ 手机版/
const CLIENT_PC = path.join(ROOT, '电脑版', '枪战游戏_电脑版.html');
const CLIENT_MB = path.join(ROOT, '手机版', '枪战游戏_手机版.html');
const LIBDIR = path.join(DIR, 'libs');
const THREE_FILE = path.join(LIBDIR, 'three.r128.min.js');
const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

/* -------------------------------------------------- 公网隧道探测
   隧道脚本（启动公网隧道.bat → 公网隧道.js）拿到公网网址后会写进 服务器\公网地址.txt。
   服务端每 2 秒看一眼这个文件：出现了就把网址打到控制台上，文件被删掉（隧道关了）也提示一句。
   这样你只管把隧道开起来，那个又长又乱的网址由服务端自己报给你，不用去认。 */
const TUNNEL_FILE = process.env.GUN_TUNNEL_FILE || path.join(DIR, '公网地址.txt');
let tunnelUrl = '';
let tunnelPermanent = false;      // 当前这个网址是不是「永久网址」（Tailscale Funnel）

/* 读隧道地址文件 → { url, permanent }
   文件由 服务器\公网隧道.js 写，格式：
       https://xxx.xxx.ts.net/     ← 第一行：网址
       永久                        ← 可选第二行：表示这是固定网址
   「永久」是 Tailscale Funnel 的网址：它绑在设备名上，隧道关掉、电脑重启都还是它。
   所以**不能**按「文件超过一天就当过期」处理，否则固定网址第二天就从控制台消失了。 */
function readTunnel() {
  try {
    const st = fs.statSync(TUNNEL_FILE);
    const text = String(fs.readFileSync(TUNNEL_FILE, 'utf8'));
    const lines = text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    const t = lines[0] || '';
    if (!/^https?:\/\/[^\s/]+/.test(t)) return { url: '', permanent: false };
    const permanent = lines.indexOf('永久') >= 0;
    if (!permanent && Date.now() - st.mtimeMs > 24 * 3600 * 1000) {
      return { url: '', permanent: false };   // 临时隧道的文件超过一天当作过期，别显示老网址
    }
    return { url: t.replace(/\/+$/, ''), permanent: permanent };
  } catch (e) { return { url: '', permanent: false }; }
}
function tunnelCheck() {
  const ti = readTunnel();
  const u = ti.url;
  if (u === tunnelUrl && ti.permanent === tunnelPermanent) return;
  const had = !!tunnelUrl;
  const wasPerm = tunnelPermanent;
  tunnelUrl = u; tunnelPermanent = ti.permanent;
  if (u) {
    console.log('');
    console.log('   ==========================================================');
    console.log('   [公网] ★ 检测到隧道已开启 —— 把这个网址发给朋友：');
    console.log('          ' + u);
    if (ti.permanent) console.log('   （固定网址：关掉隧道、重启电脑都不会变）');
    console.log('   （朋友用浏览器打开就行，不用装任何东西；别发到群里）');
    console.log('   ==========================================================');
    console.log('');
  } else if (had) {
    console.log(wasPerm
      ? '   [公网] 隧道转发已停止（网址本身还是那个，重新开隧道就通）。'
      : '   [公网] 隧道已关闭，刚才那个网址已经失效了。');
  }
}

/* ------------------------------------------------------------------ 工具 */
function pad(n) { return (n < 10 ? '0' : '') + n; }
function stamp() {
  const d = new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function log(s) { console.log('[' + stamp() + '] ' + s); }

function lanIPs() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name in nets) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

/* ------------------------------------------------- 静态资源（电脑端/手机端） */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8'
};

function sendFile(res, file) {
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('找不到文件：' + file); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

// 把客户端页面里的 three.js CDN 换成服务端本地缓存（内网也能离线跑）
function clientHtml(file) {
  let html = fs.readFileSync(file, 'utf8');
  const before = html.split(THREE_CDN).length - 1;
  if (before > 0) html = html.split(THREE_CDN).join('/libs/three.r128.min.js');
  return { html: html, patched: before };
}

// 首次访问时把 three.js 拉到本地缓存，之后完全离线可用
let threeFetching = false;
function ensureThree(cb) {
  if (fs.existsSync(THREE_FILE)) return cb(true);
  if (threeFetching) return cb(false);
  threeFetching = true;
  log('首次运行：正在下载 three.js 到本地缓存 …');
  try { fs.mkdirSync(LIBDIR, { recursive: true }); } catch (e) { }
  const req = https.get(THREE_CDN, function (r) {
    if (r.statusCode !== 200) { threeFetching = false; log('three.js 下载失败（HTTP ' + r.statusCode + '），客户端将回退到 CDN'); return cb(false); }
    const chunks = [];
    r.on('data', function (c) { chunks.push(c); });
    r.on('end', function () {
      try { fs.writeFileSync(THREE_FILE, Buffer.concat(chunks)); log('three.js 已缓存到 ' + THREE_FILE); threeFetching = false; cb(true); }
      catch (e) { log('three.js 写盘失败：' + e.message); threeFetching = false; cb(false); }
    });
  });
  req.on('error', function (e) { threeFetching = false; log('three.js 下载失败：' + e.message + '（客户端将回退到 CDN）'); cb(false); });
  req.setTimeout(15000, function () { req.destroy(); });
}

/* ---------------------------------------------------------------- 首页 */
/* 【batch166】玩法模式选择页：玩家**先在这里选好模式与自建房号**，再带着
   ?mode=&room= 进 /play。这样自动联机发出的 join 就已经带上正确的房间参数，
   彻底避开"先自动连进原版房、之后选模式却不生效（服务端忽略重复 join）"的坑。 */
function modesPage(req, res) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>选择玩法模式</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0%,#1c2230,#0a0c11 70%);
 color:#e8edf5;font-family:-apple-system,"Microsoft YaHei",system-ui,sans-serif;display:flex;
 align-items:center;justify-content:center;padding:24px}
.box{width:100%;max-width:460px;background:rgba(22,27,38,.92);border:1px solid #2b3446;border-radius:18px;padding:26px 22px 22px}
h1{margin:0 0 6px;font-size:22px;text-align:center}
.sub{margin:0 0 18px;text-align:center;color:#8b97ab;font-size:13px}
label{display:block;margin:14px 0 6px;font-size:13px;color:#9fb0c8}
select,input{width:100%;padding:13px;border-radius:12px;border:1px solid #2b3446;background:#0e131c;color:#e8edf5;font-size:15px}
button{width:100%;margin-top:18px;padding:15px;border-radius:12px;border:0;font-size:17px;font-weight:700;
 background:linear-gradient(135deg,#2f6bff,#5b9dff);color:#fff}
button:active{transform:scale(.98)}
.hint{margin-top:14px;font-size:12px;color:#7d8899;line-height:1.7}
a{color:#6ea8ff}
</style></head><body><div class="box">
<h1>🎮 选择玩法模式</h1>
<p class="sub">不同模式在不同房间，互不碰面</p>
<script>
function vlSync(o){
  var v=o.value, isSp=(v==='spike'||v==='spikeSolo');
  document.getElementById('roomRow').style.display = isSp ? 'block' : 'none';
  document.getElementById('teamRow').style.display = (v==='spike') ? 'block' : 'none';
}
</script>
<form method="get" action="/play" onsubmit="
  var m=this.mode.value;
  if(m==='spike'){ this.action='/spike'; }
  else if(m==='spikeSolo'){ this.action='/spike'; this.mode.value='spike'; this.solo.value='1';
    this.room.disabled=true; this.team.disabled=true; }
  else { this.room.disabled=true; this.team.disabled=true; }   /* 原版：不支持自建房号 */
  return true;">
  <input type="hidden" name="solo" value="">
  <label>玩法模式</label>
  <select name="mode" onchange="vlSync(this)">
    <option value="">🕹 原版对战（按地图分房）</option>
    <option value="spike">💣 爆能器 · 自建房（多人）</option>
    <option value="spikeSolo">🎯 爆能器 · 单人训练</option>
    <option value="range">🎯 靶场（单人 · 试枪 / 试技能）</option>
  </select>
  <div id="roomRow" style="display:none">
    <label>自建房号（留空 = 该模式公共房）</label>
    <input name="room" placeholder="例如：我的房间" autocomplete="off">
  </div>
  <div id="teamRow" style="display:none">
    <label>阵营（进房后也能在大厅改）</label>
    <select name="team">
      <option value="">自动分配</option>
      <option value="0">🔴 进攻方</option>
      <option value="1">🔵 防守方</option>
    </select>
  </div>
  <button type="submit">进入游戏</button>
</form>
<p class="hint">
  <b>原版对战</b>：按地图分房，<b>不填房号</b>。<br>
  <b>爆能器</b>：进房自动分队（不限几 v 几），进攻方带包走到点位长按 F 安放，守方长按 F 拆除；
  同模式、同房号的人（同一张图）才碰得到面。<br>
  <b>单人训练</b>：一个人进图练安放 / 熟悉点位，不需要开房。<br>
  <a href="/">← 返回首页</a>
</p>
</div></body></html>`;
  try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); } catch (e) { }
  res.end(html);
}
/* ============================================================================
   【batch136】多文件版的导航页：三个入口 + 一份"你该用哪个地址"的清单。
   为什么要把地址分三类讲清楚：
     · 局域网  http://192.168.x.x:端口  —— 同一个 WiFi 的朋友直接就能进（最快、最稳）
     · Tailscale http://100.x.x.x:端口  —— 对方装了 Tailscale 并登录同一账号即可（IPv4，稳）
     · 永久隧道 https://xxx.ts.net      —— 谁都不用装，**但 Tailscale Funnel 是 IPv6-only**
       （公网 DNS 只有 AAAA 记录），对方网络没有 IPv6 就打不开 —— 不是服务端的问题。
   ============================================================================ */
function landingPage(req, res) {
  const ips = lanIPs();
  const isTail = function (a) { return /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./.test(a); };
  const tail = ips.filter(isTail);
  const lans = ips.filter(function (a) { return !isTail(a); });
  const ti = readTunnel();
  const turl = ti.url || '';
  function row(addr, who, note) {
    return '<div class="ar"><code>' + addr + '</code><b>' + who + '</b><i>' + note + '</i></div>';
  }
  let rows = row('http://127.0.0.1:' + PORT, '本机', '只在这台电脑上有效');
  lans.forEach(function (a) { rows += row('http://' + a + ':' + PORT, '同一个 WiFi', '连同一个路由器就能进，推荐'); });
  tail.forEach(function (a) { rows += row('http://' + a + ':' + PORT, '装了 Tailscale', '对方也要装并登录你的账号'); });
  if (turl) rows += row(turl, '外网 / 异地', '不用装东西，但对方网络要有 IPv6');
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">'
    + '<title>枪战突击 · 进入游戏</title><style>'
    + '*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}'
    + 'body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0%,#1c2230,#0a0c11 70%);'
    + 'color:#e8edf5;font-family:-apple-system,"Microsoft YaHei",system-ui,sans-serif;display:flex;'
    + 'align-items:center;justify-content:center;padding:22px}'
    + '.box{width:100%;max-width:560px;background:rgba(22,27,38,.92);border:1px solid #2b3446;'
    + 'border-radius:18px;padding:24px 20px;box-shadow:0 20px 60px rgba(0,0,0,.55)}'
    + 'h1{margin:0 0 4px;font-size:23px;letter-spacing:1px}'
    + '.sub{color:#8ea3c0;font-size:13px;margin-bottom:18px}'
    + 'a.enter{display:block;text-align:center;text-decoration:none;font-size:19px;font-weight:800;'
    + 'color:#08131f;background:linear-gradient(135deg,#6ff0ff,#4fc3ff);border-radius:14px;padding:15px;'
    + 'margin-bottom:10px;letter-spacing:2px}'
    + 'a.alt{display:inline-block;width:calc(50% - 5px);text-align:center;text-decoration:none;'
    + 'color:#cfe0f5;background:rgba(43,52,70,.75);border:1px solid #33405a;border-radius:11px;'
    + 'padding:11px 0;font-size:14px;margin-bottom:18px}'
    + 'a.alt+a.alt{margin-left:10px}'
    + 'h2{font-size:13px;color:#8ea3c0;margin:6px 0 8px;letter-spacing:1px;font-weight:600}'
    + '.ar{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;padding:9px 11px;margin-bottom:7px;'
    + 'background:rgba(12,16,24,.7);border:1px solid #263043;border-radius:10px;font-size:13px}'
    + '.ar code{color:#6ff0ff;font-size:13px;word-break:break-all}'
    + '.ar b{color:#ffd75e;font-weight:700;font-size:12px}'
    + '.ar i{color:#8ea3c0;font-style:normal;font-size:12px}'
    + '.tip{margin-top:14px;padding-top:12px;border-top:1px solid #263043;color:#8ea3c0;font-size:12.5px;line-height:1.7}'
    + '</style></head><body><div class="box">'
    + '<h1>枪战突击</h1><div class="sub">选一个入口进去 · 玩家与玩家互为敌人</div>'
    + '<a class="enter" href="/modes">▶ 进入游戏（选择玩法模式）</a>'
    + '<a class="alt" href="/play">原版对战（直接进）</a><a class="alt" href="/pc">电脑端</a><a class="alt" href="/mobile">手机端</a>'
    + '<h2>把哪个地址发给朋友</h2>' + rows
    + '<div class="tip">· <b>同一个 WiFi</b> 的人：发「同一个 WiFi」那条，最稳；<br>'
    + '· <b>异地</b>的人：让他装 Tailscale 并登录你的账号，用 100 开头那条；<br>'
    + '· 永久隧道那条谁都不用装，但对方网络必须有 IPv6，否则打不开。</div>'
    + '</div></body></html>';
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  res.end(html);
}
function landing(req, res) {
  const host = (req.headers.host || ('localhost:' + PORT)).split(':')[0];
  const ips = lanIPs();
  const ip = ips[0] || host;
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>枪战突击 · 局域网对战</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0%,#1c2230,#0a0c11 70%);
  color:#e8edf5;font-family:-apple-system,"Microsoft YaHei",system-ui,sans-serif;display:flex;
  align-items:center;justify-content:center;padding:24px}
.box{width:100%;max-width:460px;background:rgba(22,27,38,.92);border:1px solid #2b3446;border-radius:18px;
  padding:26px 22px 22px;box-shadow:0 20px 60px rgba(0,0,0,.55)}
h1{margin:0 0 6px;font-size:24px;letter-spacing:1px;text-align:center}
.sub{margin:0 0 20px;text-align:center;color:#8b97ab;font-size:13px;line-height:1.7}
a.big{display:block;text-align:center;text-decoration:none;padding:15px;border-radius:12px;font-size:17px;
  font-weight:700;margin-bottom:12px;transition:transform .12s}
a.big:active{transform:scale(.97)}
.pc{background:linear-gradient(135deg,#2f6bff,#5b9dff);color:#fff}
.mb{background:linear-gradient(135deg,#12b981,#3ddc9a);color:#04321f}
.addr{margin-top:18px;padding:13px;background:#0e131c;border:1px solid #222b3a;border-radius:12px;
  font-size:13px;color:#9fb0c8;line-height:1.9;word-break:break-all}
.addr b{color:#ffd166}
.tip{margin-top:13px;font-size:12px;color:#69768a;line-height:1.8;text-align:center}
</style></head><body><div class="box">
<h1>🔫 枪战突击</h1>
<p class="sub">局域网对战 · 玩家与玩家互为敌人<br>服务端不生成任何 AI 敌人</p>
<a class="big pc" href="/modes">🚀 进入游戏（自动适配设备）</a>
<a class="big mb" href="/play">⚡ 直接开始（原版对战）</a>
<div class="addr">
  电脑端地址：<b>http://${ip}:${PORT}/pc</b><br>
  手机端地址：<b>http://${ip}:${PORT}/mobile</b><br>
  本机可用：<b>http://localhost:${PORT}/pc</b>${tunnelUrl ? ('<br>公网地址（隧道）：<b>' + tunnelUrl + '</b>') : ''}
</div>
<p class="tip">手机需要与本机连同一个 WiFi / 热点<br>多人模式：所有进入的玩家互相为敌人</p>
</div></body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

/* ============================================================================
   WebSocket（RFC6455 手写实现，零依赖）
   ============================================================================ */
function wsAccept(key) {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}

function wsSend(sock, str) {
  if (!sock || sock.destroyed || !sock.writable) return;
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  head[0] = 0x81; // FIN + text
  // 【背压保护】待发字节积压太多说明这条链路已经堵了（隧道慢、手机弱网）。
  // 继续往里塞只会把内存撑大、让连接卡死甚至被中间层掐断 ——
  // 所以**丢掉这一帧**（位置包丢一帧完全无感，下一帧就补上了），保住连接。
  const q = (typeof sock.writableLength === 'number') ? sock.writableLength : 0;
  if (q > FLOOD.MAX_BUFFER) { fStat.skip++; return; }
  try { sock.write(Buffer.concat([head, payload])); } catch (e) { }
}

/* 【batch228】二进制帧发送（语音用）：opcode 0x82。
   ⚠️ 别用 sock.send() —— 服务端是裸 TCP socket（没有 ws 库），没有 send 方法，
      调用会被 try/catch 静默吞掉，表现为"语音发得出去、对方永远收不到"。 */
function wsSendBin(sock, buf) {
  if (!sock || sock.destroyed || !sock.writable) return;
  const payload = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  head[0] = 0x82; // FIN + binary
  const q = (typeof sock.writableLength === 'number') ? sock.writableLength : 0;
  if (q > FLOOD.MAX_BUFFER) { fStat.skip++; return; }
  try { sock.write(Buffer.concat([head, payload])); } catch (e) { }
}

/* WebSocket 协议层保活：发一个 PING 帧（opcode 0x9，空载荷）。
   浏览器收到会自动回 PONG，**不需要我们处理回包**。
   为什么必须发：应用层的 {t:'ping'} 是普通数据帧，NAT 表和隧道网关有时并不认；
   而 PING 帧能让映射保持活跃。公网隧道/家用路由器常在 30~100 秒空闲后悄悄丢连接表，
   之后连接就是"看着还在、其实已经死了"——客户端收不到任何数据却迟迟不报 onclose。 */
function wsPing(sock) {
  if (!sock || sock.destroyed || !sock.writable) return;
  const q = (typeof sock.writableLength === 'number') ? sock.writableLength : 0;
  if (q > FLOOD.MAX_BUFFER) return;
  try { sock.write(Buffer.from([0x89, 0x00])); fStat.ping++; } catch (e) { }
}

function wsParser(onMsg, onClose, onBin) {
  let buf = Buffer.alloc(0);
  return function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    for (; ;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2)); off = 10;
      }
      if (masked) { if (buf.length < off + 4) return; }
      const maskKey = masked ? buf.slice(off, off + 4) : null;
      if (masked) off += 4;
      /* 【batch229】超大包判定要区分帧类型：
         · 文本帧（op=0x1）＝控制消息，4096 字节足够，超了是异常 → 断开
         · 二进制帧（op=0x2）＝语音音频切片，100ms 的 opus 偶尔会到 8~16KB，属正常；
           超过 VOICE_MAX_BYTES 才判异常断开。之前用同一个 MSG_BYTES(4096) 卡语音，
           开麦时音频一超 4KB 就被当"超大包"踢下线 —— 这是"限流踢开麦玩家"的根因。 */
      const 是语音 = (op === 0x2);
      const 上限 = 是语音 ? FLOOD.VOICE_MAX_BYTES : FLOOD.MSG_BYTES;
      if (len > 上限) {
        fStat.bytes++;
        logThrottled('bytes', '⛔ 防挤爆：收到 ' + len + ' 字节的超大' + (是语音 ? '语音' : '消息') + '，已断开该连接');
        onClose(); return;
      }
      if (buf.length < off + len) return;
      let payload = buf.slice(off, off + len);
      if (masked) {
        const p = Buffer.from(payload);
        for (let i = 0; i < p.length; i++) p[i] ^= maskKey[i % 4];
        payload = p;
      }
      buf = buf.slice(off + len);
      if (op === 0x8) { onClose(); return; }
      else if (op === 0x9) { /* ping：忽略，浏览器不主动发 */ }
      else if (op === 0x1 && fin) { onMsg(payload.toString('utf8')); }
      /* 【batch228】语音：二进制帧（前 4 字节是说话人的玩家 id，后面是音频数据） */
      else if (op === 0x2 && fin) { if (onBin) onBin(payload); }
      else if (op === 0x0) { /* 分片续帧：本项目消息很短，忽略 */ }
    }
  };
}

/* ============================================================================
   对战世界（全部在服务端内存里；服务端本身不渲染、不生成 AI）
   ============================================================================ */
/* 广播频率：20Hz（50ms）。原来 30Hz，在隧道/弱网下发给所有人的包会把链路填满
   → TCP 积压 → 延迟一路涨到上千毫秒然后卡死。降到 20Hz 发送量少三分之一。
   客户端有位置插值 + 包间速度外推（cap 100~160ms），50ms 间隔落在外推窗口内，照样平滑。 */
const TICK_MS = 50;
const RESPAWN_MS = 3000;       // 阵亡后 3 秒重生
const MAX_HP = 100;
const TRAIN_HP = 900;            // 【batch184】火车站列车结构血量（多人权威，与客户端 TRAIN_HP 一致）
/* 【batch184f-补4】火车站列车「服务端权威」：逻辑状态机在服务端跑（无 THREE.js，只算数值），
   客户端按服务端下发的状态渲染。以下常量镜像自客户端 buildMapStation / trainTick，保证双方一致。 */
const TRAIN_SPEED = 42, TRAIN_LEN = 48, TRAIN_WARN = 3.0;
const TRAIN_MIN_CD = 16, TRAIN_MAX_CD = 30, TRAIN_HIT_DMG = 60, TRAIN_DWELL = 15, TRAIN_STOP = 20;
const STATION_TRACKS = [{ z: -9 }, { z: 0 }, { z: 9 }];   // 与客户端 buildMapStation 的 tz=[-9,0,9] 一致
const TRAIN_SRV_DT = TICK_MS / 1000;                       // 服务端推进用 dt（秒）
/* 【batch188】被列车撞飞：服务端**也要把人挪出车体**（原来只扣血不动坐标）。
   根因：客户端原来的击飞是"沿行驶方向推 9 米"，可车体长 48 米（TRAIN_LEN）——
   推完还在车厢里 → playerBlocked() 返回 true → 客户端直接放弃改坐标 → 人留在车厢内部，
   而车厢停靠时是实体障碍，多人下客户端还跳过了 trainDwellSettle() → **锁死出不来**。
   现在服务端权威地把落点定在轨道中心线外 3.9 米（车半宽 1.7 + 人半径 + 余量），顺行驶方向再抛 4 米。 */
const TRAIN_HALF_W = 1.7;                                  // 车体半宽（＝客户端 trainAABB 的 z±1.7）
const TRAIN_FLY_OUT = 3.9;                                 // 撞飞落点：轨道中心线外 3.9 米
const TRAIN_FLY_FWD = 4.0;                                 // 撞飞落点：顺行驶方向再抛 4 米
const STATION_LIMIT = { x: 76, z: 54 };                    // 火车站矩形围墙 x=±78 / z=±56，各留 2 米
function clampNum(v, a, b) { return v < a ? a : (v > b ? b : v); }
/* 英雄技能（服务端权威口径）：客户端 HEROES 表里的 cd 只用于本地 HUD，
   这里是"防刷 + 结算"的权威值 —— 护盾减伤、治疗回血、冷却拦截都在服务端算，
   免得客户端改数据就能无限放技能。 */
const SKILL_IDS = ['scout', 'rusher', 'guard', 'medic', 'eclipse', 'lightning', 'yingyue', 'phantom',
                   'scout_sp', 'rusher_sp', 'guard_sp', 'medic_sp', 'eclipse_sp'];   // 【batch120】⑤蚀日者 / ⑥闪电；【batch158】⑦影月；【模组】⑧魅影；【batch172】四英雄 SP 形态（联机记冷却防刷，特效暂由客户端本地播）【batch183】+eclipse_sp：蚀日者 SP 焚曜（致盲转发）
// 每个英雄 3 个技能的冷却（毫秒）：下标 0/1/2 对应电脑端 V / B / N
const SKILL_CD = {
  scout:  [16000, 14000, 24000],
  rusher: [11000, 15000, 16000],
  guard:  [18000, 18000, 22000],
  medic:  [20000, 16000, 18000],
  eclipse:  [20000, 18000, 22000],       // 【batch120】蚀日者：蚀日 / 日蚀之门 / 日之眼
  lightning:[15000, 13000, 130000],      // 【batch120】闪电：闪电光球 / 电荷陷阱 / 球形闪电（大招 130 秒）
  yingyue:  [20000, 25000, 90000],       // 【batch158】影月：暗影烟雾弹 / 暗影炸弹 / 遁入暗影（大招 90 秒）
  phantom:  [12000, 8000, 14000],        // 【模组】魅影：隐身 / 瞬闪 / 假人诱饵（与客户端 HEROES 表一致）
  /* 【batch172】四英雄 SP 形态冷却（毫秒）——与客户端 HERO_SP 数据一致；
     流火/镇岳/白泽的 SP 技能尚未实装，先按定位给一套占位冷却，实装时再调 */
  scout_sp: [16000, 16000, 20000],        // 暗哨：光学隐身 / 猎杀标记 / 蜂鸟无人机
  rusher_sp:[16000, 14000, 25000],        // 烈焰先锋：烈焰之路 / 爆燃弹 / 焚天新星
  guard_sp: [20000, 18000, 30000],        // 铁壁：掩体墙 / 电磁减速网 / 力场穹顶
  medic_sp: [18000, 20000, 35000],        // 战地医师：肾上腺素 / 纳米治疗云 / 复苏协议
  eclipse_sp: [18000, 22000, 80000]       // 【batch183】焚曜：日冕喷发 / 堕日 / 蚀日 · 白夜（与客户端 HERO_SP 的 cd 一致）
};
const SHIELD_MS = 7000;        // 镇岳①能量护盾持续（毫秒）
const SHIELD_CUT = 0.3;        // 护盾期间伤害系数（减伤 70%）
const REFLECT_MS = 6000;       // 镇岳②反射力场持续（完全免疫）
const FORTIFY_MS = 8000;       // 镇岳③堡垒工事持续
const FORTIFY_CUT = 0.7;       // 堡垒期间伤害系数（减伤 30%）
const DOME_MS = 10000;         // 【batch173】镇岳 SP 力场穹顶持续（毫秒）
const DOME_R = 6;              // 【batch173】力场穹顶半径（米）
const DOME_CUT = 0.5;          // 【batch173】力场穹顶内伤害系数（减伤 50%）
const RUSH_MS = 6000;          // 流火②冲锋号令持续（加速，服务端只校验冷却）
const ADREN_MS = 7000;         // 白泽③肾上腺素持续（服务端额外回血）
const SMASH_R = 5;             // 流火③震荡打击半径（米）
const SMASH_DMG = 25;          // 震荡打击伤害
const SMASH_SLOW_MS = 2000;    // 震荡打击减速时长
const HEAL_AURA_MS = 5000;     // 白泽①治疗力场持续
const PULSE_R = 6;             // 医疗脉冲弹：落地治疗半径 / 治疗力场半径（米）（batch94：原来是 3.6 的"跟人力场"）
const HEAL_AURA_PER = 500;     // 每 0.5 秒结算一次
const HEAL_AURA_AMT = 3;       // 每次回 3 点
const MEDIC_BURST = 45;        // 医疗脉冲瞬回
const MEDKIT_R = 6;            // 白泽②急救箱半径（米）
const MEDKIT_AMT = 40;         // 急救箱回血
/* batch92：破片手雷 / 烟雾弹 / 治疗烟雾（都是真投掷物，引爆点由客户端 {t:'boom'} 给出） */
const FRAG_R = 8;              // 流火③破片手雷伤害半径（米）
const FRAG_DMG = 85;           // 手雷中心伤害
const FRAG_DMG_MIN = 25;       // 手雷边缘保底伤害
const FRAG_SLOW_MS = 1500;     // 手雷冲击波减速时长（毫秒）
const FRAG_KNOCK = 3.5;        // 手雷击退距离（米）
const SMOKE_R = 5;             // 烟雾弹 / 治疗烟雾半径（米）
// 【batch91】闪光弹致盲**不再有距离上限**：只看「朝向」，多远都能闪（原 FLASH_R=8 半径门已去除）
const FLASH_MS = 3000;         // 闪光弹致盲时长（毫秒）
const FLASH_DOT_FULL = 0.82;   // 「看向爆点才被闪」：视线与"指向爆点"的夹角余弦 ≥0.82 算正对（全效）
const FLASH_DOT_MIN = 0.35;    // ≤0.35 算背对（完全不闪）；中间线性折算时长
const FLASH_CLOSE_R = 3;       // 贴脸 3 米内：不管朝哪看都会被闪（和客户端一致）
/* 团队化改造（batch86）：增益类技能不再只保自己，而是"自身 + 半径内队友"一起享受。
   半径判定放服务端（它知道所有人的坐标），命中者收到 {t:'buff',b,dur} 自己套状态。 */
const TEAM_R = 8;              // 团队增益半径（米）：护盾投放 / 冲锋号令 / 肾上腺素
const ZONE_R = 6;              // 堡垒阵地半径（米）
const ZONE_H = 2.0;            // 【batch143】阵地的高度容差（米）：隔着楼板不算在圈里
const ZONE_TICK_MS = 500;      // 阵地每 0.5 秒续一次 buff
const ZONE_BUFF_MS = 700;      // 阵地上 buff 的持续（略长于 tick，保证站在里面不断档）
const KNOCK_DIST = 3;          // 震荡打击击退距离（米）
const REFLECT_CUT = 0.5;       // 反射力场期间伤害系数（减半）
const REFLECT_BACK = 0.5;      // 反射给开枪者的比例
/* batch100：英雄被动（服务端权威口径，数值和客户端 PASSIVE_* 一致）
   ① 流火开镜加速 / ③ 天狼预警：纯客户端本地表现，服务端不参与
   ② 镇岳手雷减伤 → applyDamage(..., nade=true)
   ④ 白泽治疗增益（烟中更强）→ healMulFor()，所有回血点都乘它 */
const HERO_SCOUT = 0, HERO_RUSHER = 1, HERO_GUARD = 2, HERO_MEDIC = 3;   // 与客户端 HEROES 下标一致
const HERO_ECLIPSE = 4, HERO_LIGHTNING = 5;                   // 【batch120】蚀日者 / 闪电
/* 【batch120】⑤蚀日者「蚀日」：黑日周期脉冲 → 朝它看的人被致盲（口径与客户端 SOLAR_* 一致） */
const SOLAR_R = 12;               // 笼罩半径（米）
const SOLAR_LIFE_MS = 8000;       // 黑日存在（毫秒）
const SOLAR_PULSE_MS = 1000;      // 【batch125】脉冲间隔（毫秒）—— 与客户端 SOLAR_PULSE=1.0 对齐
const SOLAR_BLIND_MS = 3000;      // 【batch125】每次致盲时长（毫秒）—— 整屏纯白 1 秒 + 淡出（与闪光弹 FLASH_MS 同口径，否则敌人只收到淡出尾巴、没被"完全闪到"）
const SOLAR_DOT = 0.45;           // 「朝它看」的余弦门槛（低于它＝背对/侧对，不闪）
const SOLAR_DMG = 15;             // 【batch125】朝黑日看的人，每次脉冲吃 15 点伤害（与客户端 SOLAR_DMG 同口径）
/* 【batch183】蚀日者 · 焚曜（eclipse_sp）两招致盲的联机结算口径（与客户端 SP_SKILLS 一致）：
   ①日冕喷发：施法者为中心 12 米内、同一层楼的其他人致盲 2.5 秒；
   ③蚀日 · 白夜：同房间其他人全图致盲 4 秒（不分距离 / 不分楼层 —— 天都黑了）。
   以前这两招只在本机置 e.blindT（那只驱动小兵 AI 的视线），真人玩家屏幕上毫无反应。 */
const SP_FLARE_R = 12;            // 日冕喷发半径（米）
const SP_FLARE_BLIND_MS = 2500;   // 日冕喷发致盲时长（毫秒）
const SP_VEIL_BLIND_MS = 4000;    // 蚀日 · 白夜致盲时长（毫秒）
const eclipseZones = [];          // 正在生效的黑日 { x, z, until, next, map }
/* 【batch120】⑥闪电「闪电光球」：2 米电区持续放电 */
const ORB_R = 2;                  // 电区半径（米）
const ORB_LIFE_MS = 6000;         // 电区存在（毫秒）
const ORB_DMG = 25;               // 电击伤害
const ORB_DEBUFF_MS = 20000;      // 三重减益时长（毫秒）
const ORB_VULN = 1.25;            // 【batch121c】易伤：受到的所有伤害 +25%（三重减益的第三重 —— 原来只有注释、没实现，形同虚设）
/* 【batch158】⑦影月：暗影毒圈 */
const SHADOW_R = 4;               // 暗影半径（米）
const SHADOW_LIFE_MS = 10000;     // 暗影存在（毫秒）
const SHADOW_DPS = 15;            // 每秒毒伤
const SHADOW_FLOOR_TOL = 2;       // 分层容差（米）：二楼炸的毒不到一楼
const shadowZones = [];           // 正在生效的暗影 { x, z, y, until, next, map, by }
const orbZones = [];              // 正在生效的电区 { x, z, until, map, hits:{} }
/* 【batch120】⑥闪电「电荷陷阱」：触发连劈 4×20 */
const TRAP_R = 2.2;               // 触发半径（米）
const TRAP_N = 4;                 // 连劈次数
const TRAP_DMG = 20;              // 每下伤害
/* 【batch120】⑥闪电「球形闪电」：命中倒地 */
const BALL_N = 3;                 // 一次放几枚
const BALL_RANGE = 120;           // 【batch123b】球形闪电的飞行射程（米）：服务端用它防作弊（离发射者不可能更远）
const DB_DOWN_MS = 50000;         // 倒地后没人治 → 多久死亡（毫秒）
const DB_REVIVE_HP = 0.4;         // 被治疗扶起时的血量比例
const NADE_CUT = 0.7;          // 镇岳被动：受到的手雷伤害系数（减伤 30%）
const MEDIC_HEAL_MUL = 1.5;    // 白泽被动：受到的治疗 +50%
const MEDIC_SMOKE_MUL = 1.5;   // 白泽身处烟雾中：治疗再 +50%（乘算）
const SMOKE_LIFE_MS = 14000;   // 烟团存活（毫秒）：服务端据此判断"谁在烟里"（客户端 SMOKE_LIFE=14 秒）
const smokeZones = [];         // 正在生效的烟团 {x,z,r,until} —— 服务端只知道"哪里在冒烟"

/* ============================================================================
   【batch233】场景持久效果 · 唯一规约表
   ----------------------------------------------------------------------------
   以前"哪些效果要留给后进的玩家"散落在 handleBoom 的一堆 if 里，
   而且和 worldEnts 那套（spzone / portal / trap）各写一遍 → 谁漏了就没人知道。
   现在集中到这张表：key = k + '|' + s，值 = 这个效果在场上活多久（毫秒）。
     · 在表里 → 广播后自动登记进 worldEnts，晚进玩家进场时按剩余时间重放
     · 不在表里 → 瞬发特效（闪光、爆炸、落雷…），只播一次，不需要补发
   以后加新技能：只要效果是"留在场上"的，来这里加一行就行。
   ============================================================================ */
const 场景持久效果 = {
  'guard|1':     { life: SMOKE_LIFE_MS },     // 镇岳 · 烟雾弹（挡视线）
  'medic|2':     { life: SMOKE_LIFE_MS },     // 白泽 · 治疗烟雾（烟中治疗加成）
  'yingyue|0':   { life: SMOKE_LIFE_MS },     // 影月 · 暗影烟雾（紫烟）
  'eclipse|0':   { life: SOLAR_LIFE_MS },     // 蚀日 · 黑日（致盲区）
  'lightning|0': { life: ORB_LIFE_MS },       // 闪电 · 球形闪电（电区）
  'yingyue|1':   { life: SHADOW_LIFE_MS },    // 影月 · 暗影炸弹（毒圈）
};
/* 某个坐标是否在烟里（白泽"烟中治疗加成"判定用） */
function inSmokeSrv(x, z, mapId) {
  const now = Date.now();
  const mk = (mapId === undefined) ? null : normMapId(mapId);
  for (let i = 0; i < smokeZones.length; i++) {
    const s = smokeZones[i];
    if (s.until <= now) continue;
    if (mk !== null && normMapId(s.map) !== mk) continue;      // 【batch113】烟团不跨房间
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return true;
  }
  return false;
}
/* 【batch232】kind 记住这是哪种烟（guard 普通 / medic 治疗 / yingyue 暗影）——
   后进来的玩家要靠它建出**对的颜色**，不能一律当普通烟。y＝那层的高度（可选）。 */
function pushSmokeSrv(x, z, mapId, kind, y) {
  smokeZones.push({
    x: x, z: z, r: SMOKE_R, until: Date.now() + SMOKE_LIFE_MS,
    map: normMapId(mapId), kind: kind || 'guard',
    y: (typeof y === 'number' ? y : undefined)
  });
}

/* 某个玩家"吃到治疗"时的倍率：只有白泽有增益，且烟中再 ×1.5（和客户端 heroHealMul 同口径） */
function healMulFor(p) {
  if (!p || p.hero !== HERO_MEDIC) return 1;
  let m = MEDIC_HEAL_MUL;
  if (inSmokeSrv(p.x, p.z, p.map)) m *= MEDIC_SMOKE_MUL;
  return m;
}
/* ============================================================================
   【batch120】倒地（球形闪电命中）
     · downPlayer  ：把目标打成"倒地"：血量 1、撤掉所有技能增益、50 秒后没人治就死
     · downedTick  ：50 秒到点 → 判死（走和被打死完全一样的死亡流程）
     · healSrv     ：所有回血点的统一入口 —— 目标倒地时优先"扶起"（回 40% 血）
                    （倒地的目标血量只有 1，所以"被补刀即死"是天然成立的：
                      任何 ≥1 点伤害都会把他打到 0 血）
   ============================================================================ */
function downPlayer(q, by) {
  if (!q || !q.alive || q.downed) return;
  q.downed = true;
  q.downedUntil = Date.now() + DB_DOWN_MS;
  q.hp = 1;
  q.shieldUntil = 0; q.reflectUntil = 0; q.fortifyUntil = 0;       // 倒地＝所有技能增益清掉（否则减伤会让"补刀秒杀"失效）
  q.rushUntil = 0; q.adrenUntil = 0; q.healAuraUntil = 0; q.healAcc = 0; q.fortifyZone = 0;
  broadcast({ t: 'downed', i: q.id, ms: DB_DOWN_MS }, undefined, mapOf(q));
  broadcast({ t: 'hp', i: q.id, h: q.hp }, undefined, mapOf(q));
  if (by) q.lastHitBy = by.id;
  log('球形闪电击倒：' + q.name + (by ? ('（' + by.name + '）') : ''));
}
/* 50 秒没人治 → 判死（和被打死走同一套流程：alive=false + 3 秒后重生） */
function downedTick(now) {
  players.forEach(function (q) {
    if (q.stale || !q.alive || !q.downed) return;
    if (!q.downedUntil || now < q.downedUntil) return;
    q.downed = false; q.downedUntil = 0;
    q.hp = 0; q.alive = false; q.deaths++;
    spikeDropOnDeath(q);                                        // 【batch169】倒地超时也算阵亡 → 包同样掉在原地
    q.respawnAt = now + RESPAWN_MS;
    const by = q.lastHitBy ? players.get(q.lastHitBy) : null;
    if (by && by.alive !== undefined) by.kills++;
    broadcast({ t: 'kill', k: by ? by.id : 0, kn: by ? by.name : '', d: q.id, dn: q.name, hs: false }, undefined, mapOf(q));
    sendTo(q, { t: 'dead', rs: RESPAWN_MS });
    log('倒地超时死亡：' + q.name);
  });
}
/* 所有回血点的统一入口：倒地的人被治疗 = 当场扶起（回 40% 血） */
function healSrv(q, amt) {
  if (!q || q.stale || !q.alive) return;
  if (q.downed) {
    q.downed = false; q.downedUntil = 0;
    q.hp = Math.max(1, Math.round(MAX_HP * DB_REVIVE_HP));
    broadcast({ t: 'revived', i: q.id, h: q.hp }, undefined, mapOf(q));
    broadcast({ t: 'hp', i: q.id, h: q.hp, heal: 1 }, undefined, mapOf(q));
    log('被扶起：' + q.name);
    return;
  }
  if (q.hp >= MAX_HP) return;
  q.hp = Math.min(MAX_HP, q.hp + Math.round(amt));
  broadcast({ t: 'hp', i: q.id, h: q.hp, heal: 1 }, undefined, mapOf(q));
}
/* 蚀日：黑日每 SOLAR_PULSE_MS 脉冲一次 —— 半径内**朝它看**的玩家被致盲（背对没事，服务端不掌握地图故不做墙体判定） */
function eclipseTick(now) {
  for (let i = eclipseZones.length - 1; i >= 0; i--) if (eclipseZones[i].until <= now) eclipseZones.splice(i, 1);
  for (let i = 0; i < eclipseZones.length; i++) {
    const E = eclipseZones[i];
    if (now < E.next) continue;
    E.next = now + SOLAR_PULSE_MS;
    players.forEach(function (q) {
      if (q.stale || !q.alive) return;
      /* 【batch169】同雷区：改用房间口径 mapOf(q) 比（原来比地图 id，爆能器模式下永远不等 → 黑日失效） */
      if (mapOf(q) !== E.map) return;
      const dx = q.x - E.x, dz = q.z - E.z, d2 = dx * dx + dz * dz;
      // 【batch154】全图：去掉 12 米半径门（只要朝它看就闪 + 灼伤，与客户端口径一致）
      const L = Math.sqrt(d2) || 1;
      const yaw = +q.yaw || 0;
      const dot = ((E.x - q.x) * (-Math.sin(yaw)) + (E.z - q.z) * (-Math.cos(yaw))) / L;
      if (dot <= SOLAR_DOT) return;                              // 背对 / 侧对 → 闪不到
      sendTo(q, { t: 'flash', dur: SOLAR_BLIND_MS });
      /* 【batch125】除了全白，每次脉冲还吃 15 点伤害（越正对越疼，按 dot 折算）。
         黑日不认人：站在圈里朝它看的**包括扔黑日的人自己**都得挨。 */
      if (!q.downed) {
        const sd = Math.max(1, Math.round(SOLAR_DMG * Math.min(1, dot)));
        applyDamage(E.by === q.id ? null : (players.get(E.by) || null), q, sd, false, false, false);
      }
    });
  }
}
/* 闪电光球：电区持续放电 —— 进圈的人吃 25 伤 + 20 秒三重减益（麻痹 / 过载 / 易伤） */
function orbTick(now) {
  for (let i = orbZones.length - 1; i >= 0; i--) if (orbZones[i].until <= now) orbZones.splice(i, 1);
  for (let i = 0; i < orbZones.length; i++) {
    const O = orbZones[i];
    players.forEach(function (q) {
      if (q.stale || !q.alive) return;
      /* 【batch169】原来拿 normMapId(q.map)（**地图 id**）去比 O.map（存的是 mapOf(from)＝**房间钥匙**）。
         爆能器模式下房间钥匙是「spike:房号」，和地图 id 永远不相等 → 雷区在爆能器里**完全失效**。
         统一改用房间的口径 mapOf(q) 来比。 */
      if (mapOf(q) !== O.map) return;
      /* 【batch169】雷区同队判定：**队友不被电**（原版没有队伍概念 → 照常电）；
         放雷区的人自己也不被自己放的电到（与电荷陷阱保持一致）。
         注：黑日（eclipseTick）**故意**能闪到队友，那是设定，不要加这个判定。 */
      if (typeof q.team === 'number' && q.team >= 0) {
        const _owner = players.get(O.by);
        if (_owner && typeof _owner.team === 'number' && _owner.team >= 0 && _owner.team === q.team) return;
        if (q.id === O.by) return;
      }
      if (O.hits[q.id]) return;
      const dx = q.x - O.x, dz = q.z - O.z;
      if (dx * dx + dz * dz > ORB_R * ORB_R) return;
      O.hits[q.id] = 1;
      sendTo(q, { t: 'zapped', dur: ORB_DEBUFF_MS });
      // 【batch121c 顺序坑】电区自己这 25 点必须**先结算、后置易伤**：
      //   反过来的话，刚置上的 vulnUntil 会把这 25 也放大成 31（探针实测 95→64），
      //   而设计口径是「25 点电击 + 之后 20 秒内受到的伤害 +25%」—— 易伤不该管它自己的这一下。
      if (!q.downed) applyDamage(O.by === q.id ? null : (players.get(O.by) || null), q, ORB_DMG, false, false, false);
      q.vulnUntil = Math.max(q.vulnUntil || 0, now + ORB_DEBUFF_MS);
    });
  }
}
/* 【batch158】影月：暗影毒圈持续毒蚀 —— 每秒 15 点；
   · 自己放的暗影毒不到自己（影月被动「暗影亲和」）
   · 影月吃「别的影月」的暗影伤害减半
   · 分层：|脚底高度差| > 2 米不吃（二楼炸的毒不到一楼）—— 客户端上报的 y 是那张地面的高度 */
function shadowTick(now) {
  for (let i = shadowZones.length - 1; i >= 0; i--) if (shadowZones[i].until <= now) shadowZones.splice(i, 1);
  for (let i = 0; i < shadowZones.length; i++) {
    const Z = shadowZones[i];
    if (now < Z.next) continue;
    Z.next = now + 1000;
    players.forEach(function (q) {
      if (q.stale || !q.alive) return;
      /* 【batch169】同雷区：改用房间口径 mapOf(q) 比（原来比地图 id，爆能器模式下永远不等 → 暗影圈失效） */
      if (mapOf(q) !== Z.map) return;
      if (Z.by === q.id) return;                                        // 自己的暗影不毒自己
      const dx = q.x - Z.x, dz = q.z - Z.z;
      if (dx * dx + dz * dz > SHADOW_R * SHADOW_R) return;
      if (Math.abs(((q.y || 2) - 2) - (Z.y || 0)) > SHADOW_FLOOR_TOL) return;   // 分层（q.y 是眼高，脚底 = q.y-2）
      if (q.downed) return;
      const dps = (q.hero === 6) ? Math.round(SHADOW_DPS * 0.5) : SHADOW_DPS;   // 影月吃别人的暗影减半
      applyDamage(players.get(Z.by) || null, q, dps, false, false, false);
    });
  }
}
/* 掉线容忍：客户端每 2 秒发一次心跳，这里给到 20 秒 —— 相当于允许连续丢 9 个心跳。
   隧道/弱网下一次抖动就可能丢三五秒，阈值太低会把人反复误踢成"老是重连"。 */
const TIMEOUT_MS = 20000;      // 超过这么久没上报 → 先判「疑似掉线」（还没删！）
const GONE_MS = 45000;         // 疑似掉线后再等这么久没回来 → 才真正移除（宽限内重连无缝接回）
const MAX_PLAYERS = 15;        // 服务器最多同时多少人（满了就拒绝新玩家；疑似掉线的不占名额）

/* ------------------------------------------------------ 防挤爆（临时限流，不封人、会自愈）
   把服务器挂到隧道上以后，任何人都能拿到网址。要防的不是"坏人"，而是
   "有人不小心开了一堆窗口 / 链接被转到群里乱点 / 脚本狂刷"把连接和带宽挤爆。
   原则：只做**临时**限制 —— 超限的 IP 冷却 20 秒自动解除，**绝不写进封禁名单**。
   隧道场景：优先读 CF-Connecting-IP / X-Forwarded-For 拿玩家真实 IP；
   拿不到时（前面有代理但不转发 IP）自动放宽阈值，免得把整群人当成一个人限死。 */
const FLOOD = {
  MAX_SOCKETS: 80,          // 同时存在的连接总数上限（含还没进场的）
  PER_IP: 8,                // 同一来源 IP 同时最多几条连接
  PER_IP_PROXY: 60,         // 认不出真实 IP 时放宽
  RATE: 20,                 // 同一 IP 每 10 秒最多新建几条连接
  RATE_PROXY: 150,
  WIN_MS: 10000,            // 速率统计窗口
  COOL_MS: 20000,           // 触发阈值 → 该 IP 冷却这么久（到期自动解除）
  HELLO_MS: 8000,           // 连上后多久必须进场，否则断开（防"占着坑不说话"）
  MSG_PER_SEC: 150,         // 单连接每秒消息上限（客户端正常约 31 条/秒）
  MSG_BYTES: 4096,          // 单条**文本**消息字节上限（防超大包打爆内存）
  VOICE_MAX_BYTES: 32768,   // 【batch229】单条**语音**二进制帧字节上限（100ms opus 正常到 8~16KB，留 32KB 余量）
  HTTP_PER_WIN: 60,         // 同一 IP 每 10 秒最多请求网页几次
  HTTP_PER_WIN_PROXY: 400,
  MAX_BUFFER: 512 * 1024,   // 单连接待发字节上限：超了就跳过这一帧（丢帧不丢连接）
  WS_PING_MS: 15000,        // WebSocket 协议层保活：多久给客户端发一个 PING 帧
  LOG_MS: 3000              // 同一类拒绝日志的最小间隔（防日志本身被刷爆）
};
try { if (process.env.GUN_FLOOD_JSON) Object.assign(FLOOD, JSON.parse(process.env.GUN_FLOOD_JSON)); } catch (e) { }
let floodOn = process.env.GUN_FLOOD !== '0';        // GUN_FLOOD=0 可整体关掉（排查问题时用）

const fStat = { conn: 0, hello: 0, msg: 0, http: 0, bytes: 0, cool: 0, skip: 0, ping: 0 };   // 累计触发次数
let sockCount = 0;                                  // 当前连接总数
const liveIPs = new Map();                          // ip -> 当前连接数
const connHist = new Map();                         // ip -> [新建连接时间戳]
const httpHist = new Map();                         // ip -> [网页请求时间戳]
const coolMap = new Map();                          // ip -> 冷却到期时间戳
const lastLog = new Map();                          // 日志限频

function logThrottled(key, msg) {                   // 同一 key 至少间隔 FLOOD.LOG_MS 才再打
  const now = Date.now();
  if (now - (lastLog.get(key) || 0) < FLOOD.LOG_MS) return;
  lastLog.set(key, now);
  log(msg);
}
function rawIP(sock) {
  try { return String(sock.remoteAddress || '').replace(/^::ffff:/, '') || '?'; } catch (e) { return '?'; }
}
function isPrivateIP(ip) {                          // 内网 / 回环 / Tailscale 网段
  if (!ip || ip === '?' || ip === 'localhost' || ip === '::1') return true;
  if (/^127\./.test(ip)) return true;                                     // 回环 127.0.0.0/8（本机访问）
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
  if (/^f[cd]/i.test(ip)) return true;
  return false;
}
// 真实来源 IP + 是否"看得清这个人"（true＝直连公网，或前面的代理转发了真实 IP）
function srcIP(req, sock) {
  const h = (req && req.headers) || {};
  let v = String(h['cf-connecting-ip'] || '').trim();
  if (!v) v = String(h['x-real-ip'] || '').trim();
  if (!v) v = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  v = v.replace(/^::ffff:/, '');
  if (v && /^[0-9a-fA-F:.]{3,45}$/.test(v) && !isPrivateIP(v)) return { ip: v, sure: true };
  const raw = rawIP(sock);
  if (raw && raw !== '?' && !isPrivateIP(raw)) return { ip: raw, sure: true };
  return { ip: raw || '?', sure: false };          // 私有/回环又没有转发头 → 认不出人，放宽
}
function coolLeft(ip) {
  const t = coolMap.get(ip);
  if (!t) return 0;
  const left = t - Date.now();
  if (left <= 0) { coolMap.delete(ip); return 0; }
  return left;
}
function punish(ip, reason) {
  coolMap.set(ip, Date.now() + FLOOD.COOL_MS);
  fStat.cool++;
  logThrottled('cool', '⛔ 防挤爆：' + ip + ' 触发「' + reason + '」→ 冷却 '
    + Math.round(FLOOD.COOL_MS / 1000) + ' 秒（自动解除，不写入封禁名单）');
}
/* ------------------------------------------------------ 封禁名单（可解封，且跨重启保留）
   同样加密落盘：服务器/封禁名单.dat（用记事本打开是乱码）。
   一条记录同时记住 cid 与名字 → 解封时不管玩家在不在线、报的是哪个都能对上。 */
const BAN_DB = process.env.GUN_BAN_DB || path.join(DIR, '封禁名单.dat');
let BANS = [];                 // [{ cid, name, at }]
function banLoad() {
  try {
    const j = JSON.parse(nameDec(fs.readFileSync(BAN_DB, 'utf8').trim()));
    BANS = (j && Array.isArray(j.arr)) ? j.arr.filter(function (b) { return b && (b.cid || b.name); }) : [];
    if (BANS.length) console.log('   [封禁名单] 已载入 ' + BANS.length + ' 条（输入 bans 查看）');
  } catch (e) { BANS = []; }
}
function banSave() {
  try { fs.writeFileSync(BAN_DB, nameEnc(JSON.stringify({ v: 1, arr: BANS })), 'utf8'); } catch (e) { }
}

/* ------------------------------------------------------ 名字库（所有人的名字不能重复）
   存在 服务器/名字库.dat 里，内容经过「加密封装」→ 用记事本直接打开是乱码。
   一个名字被某人占用后，别人就不能再用（重连/改名换回自己的名字不受影响），
   直到管理员在控制台输入 free <名字> 释放。 */
const NAME_DB = process.env.GUN_NAME_DB || path.join(DIR, '名字库.dat');
let NAMES = [];                // [{ n: 名字, cid: 身份编号 }]
const NAME_SALT = 'gunGame.nameBox.k7';
function nameXor(str) {
  let out = '', k = NAME_SALT;
  for (let i = 0; i < str.length; i++) out += String.fromCharCode(str.charCodeAt(i) ^ k.charCodeAt(i % k.length) ^ ((i * 7 + 5) & 255));
  return out;
}
function nameEnc(txt) {
  const b = Buffer.from(String(txt == null ? '' : txt), 'utf8');
  let sum = 0;
  for (let i = 0; i < b.length; i++) sum = (sum * 31 + b[i]) & 65535;
  const x = nameXor(b.toString('latin1'));
  let hex = '';
  for (let i = 0; i < x.length; i++) { const v = x.charCodeAt(i) & 255; hex += (v < 16 ? '0' : '') + v.toString(16); }
  return 'n1' + ('0000' + sum.toString(16)).slice(-4) + hex;
}
function nameDec(v) {
  v = String(v == null ? '' : v);
  if (v.slice(0, 2) !== 'n1') return '';
  const sum = parseInt(v.slice(2, 6), 16);
  if (!isFinite(sum)) return '';
  const hex = v.slice(6);
  if (!hex.length || hex.length % 2) return '';
  let x = '';
  for (let i = 0; i < hex.length; i += 2) x += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  const b = Buffer.from(nameXor(x), 'latin1');
  let s2 = 0;
  for (let i = 0; i < b.length; i++) s2 = (s2 * 31 + b[i]) & 65535;
  if (s2 !== sum) return '';
  return b.toString('utf8');
}
function nameDbLoad() {
  try {
    const j = JSON.parse(nameDec(fs.readFileSync(NAME_DB, 'utf8').trim()));
    let migrated = false;
    NAMES = (j && Array.isArray(j.arr)) ? j.arr.filter(function (r) { return r && r.n; }).map(function (r) {
      if (!Array.isArray(r.cids)) { r.cids = r.cid ? [r.cid] : []; delete r.cid; migrated = true; }   // 老数据自动升级
      if (!r.code) { r.code = newCode(); migrated = true; }
      return r;
    }).slice(-800) : [];
    if (migrated) nameDbSave();        // 迁移完立刻落盘：否则下次重启又给老名字换个新身份码
    console.log('   [名字库] 已载入 ' + NAMES.length + ' 个已注册名字' + (migrated ? '（已升级为带身份码的新格式）' : ''));
  } catch (e) { NAMES = []; }
}
function nameDbSave() {
  try { fs.writeFileSync(NAME_DB, nameEnc(JSON.stringify({ v: 1, arr: NAMES })), 'utf8'); } catch (e) { }
}
function normName(n) { return String(n == null ? '' : n).trim().slice(0, 8); }
// 「身份码」：发给每个名字的一张小身份证。
// 隧道网址、局域网网址、本地文件是三个不同的"网站"，浏览器不允许它们共享数据，
// 所以玩家在新网址里输入同一个名字 + 身份码，就能把名字取回来（名字本人永远不变）。
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';    // 去掉容易看错的 0 O 1 I
function newCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function nameOwnerOf(n) {
  n = normName(n); if (!n) return null;
  for (let i = 0; i < NAMES.length; i++) if (NAMES[i].n === n) return NAMES[i];
  return null;
}
/* ------------------------------------------------------ 【batch126】剧情解锁
   用户口径：**一个账号通过过一次剧情模式「追捕蚀日者」就永久拥有「闪电」**。
   这里把解锁挂在**名字记录**上 —— 名字就是账号，身份码是它的取回凭据：
   玩家换网址 / 换设备后用「名字 + 身份码」取回名字，解锁会一起回来。
   本季「蚀日者」不开放（下赛季「救出蚀日者」），所以只认 lightning 一项。 */
function unlockOf(n) {
  const rec = nameOwnerOf(n);
  const u = (rec && rec.unlocks) || {};
  return { lightning: !!u.lightning, eclipse: !!u.eclipse };   // 【batch147】eclipse＝蚀日者（开发者指令解锁）
}
function unlockGet(n, k) {
  const rec = nameOwnerOf(n);
  return !!(rec && rec.unlocks && rec.unlocks[k]);
}
/* 返回 true ＝ 这次真的新解锁了（用来打一行有意义的日志） */
function unlockSet(n, k, off) {
  const rec = nameOwnerOf(n);
  if (!rec) return false;
  if (!rec.unlocks) rec.unlocks = {};
  if (off) {
    if (!rec.unlocks[k]) return false;
    delete rec.unlocks[k];
    nameDbSave();
    return true;
  }
  if (rec.unlocks[k]) return false;
  rec.unlocks[k] = Date.now();
  nameDbSave();                                  // 立刻落盘：重启 / 崩溃都不会丢
  return true;
}
function unlockList() {
  const out = [];
  NAMES.forEach(function (r) { if (r.unlocks && r.unlocks.lightning) out.push(r.n); });
  return out;
}
function nameOnline(n) {                       // 这个名字此刻有人在玩吗
  n = normName(n);
  let hit = null;
  players.forEach(function (p) { if (p.name === n) hit = p; });
  return hit;
}
// 把名字绑到某个身份上：新名字 → 建记录并生成身份码；老名字 → 把这个身份追加进 cids
function nameBind(n, cid) {
  n = normName(n); if (!n) return null;
  let rec = nameOwnerOf(n);
  if (!rec) {
    if (cid) {                                 // 改名：把自己从别的名字上摘下来
      NAMES.forEach(function (r) { r.cids = (r.cids || []).filter(function (c) { return c !== cid; }); });
      NAMES = NAMES.filter(function (r) { return r.cids.length; });
    }
    rec = { n: n, code: newCode(), cids: cid ? [cid] : [], at: Date.now() };
    NAMES.push(rec);
    if (NAMES.length > 800) NAMES = NAMES.slice(-800);
    nameDbSave();
    return rec;
  }
  if (cid && rec.cids.indexOf(cid) < 0) {
    rec.cids.push(cid);
    rec.at = Date.now();
    nameDbSave();
  }
  return rec;
}
function nameFree(n) {
  n = normName(n);
  const before = NAMES.length;
  NAMES = NAMES.filter(function (r) { return r.n !== n; });
  nameDbSave();
  return before - NAMES.length;
}
function nameWipeAll() {
  const n = NAMES.length;
  NAMES = [];
  nameDbSave();
  return n;
}
function nameAlt(n) {
  n = normName(n) || '玩家';
  for (let i = 2; i <= 9; i++) if (!nameOwnerOf(n + i)) return n + i;
  return n + (10 + Math.floor(Math.random() * 89));
}

let nextId = 1;
const players = new Map();     // id -> player
const roomTrainHp = new Map(); // 【batch184】房间钥匙 -> 列车当前结构血量（多人权威，一个人打、全场同步扣血）
const roomTrain = new Map();    // 【batch184f-补4】房间钥匙 -> 列车逻辑状态（服务端权威）：{st,ti,dir,head,t,hp,blink,_hit}
const worldEnts = new Map();    // 【batch184f-补4】房间钥匙 -> 现存世界实体数组（晚进者快照用）：[{type,msg,until}]

/* ===== 多地图分房（batch113）=====
   每张地图 = 一个**独立房间**：不同图的人互不可见、互不伤害，技能与团队增益也不越界。
   （两张图都以原点为中心，坐标范围完全重叠 —— 不按房间过滤就会"隔图互相看见、隔着图被打死"。）
   出生点表按图分开，每张图的点数必须 > 单房间人数上限，否则会两个人叠在同一个出生点上。 */
/* 【batch149】第三张图：地下实验室（剧情第二章的场地）。
   它是一张全封闭的地下设施 —— 出生点**全部落在走廊格点上**，房间内部不摆点（家具多）。
   剧情模式的固定出生点不走这张表（客户端 LAB_STORY_SPAWN 单独写死）。 */
const MAP_IDS = ['classic', 'eclipse', 'lab', 'station'];
const MAP_NAMES = { classic: '经典·哨塔竞技场', eclipse: '日蚀环城', lab: '地下实验室', station: '旧火车站' };
/* 经典图的出生点由 gen_spawns.py 从地图方块坐标**自动反推**（源码见 出生点表.js，服务端/客户端共用）。
   来历：原来是「半径 16~40 的圆环上随机取点」，完全不看障碍物；
   可那个圈里正好压着 (±15,±15)、(0,±30)、(±30,0) 这些方块 → 于是经常出生在方块内部卡住。
   地图改了要重跑一次：python gen_spawns.py --write（会自动复验每个点都不贴方块）。
   新图（日蚀环城）的点手写在下面 —— 客户端 网页3D枪战游戏.html 的 MAP_SPAWNS 是同一份数据的副本，
   探针 t_map.js 会逐个校验"不在障碍物里 + 踩在基础地面上"，t_maproom.js 再校验"点数够不够分"。 */
/* 【batch141】日蚀那张表**必须和客户端 网页3D枪战游戏.html 的 MAP_SPAWNS.eclipse 逐点一致**。
   原来这里是「往内收之前」的老点（[18,84]/[90,4]/[22,-74]/[52,72]/[74,44]/[-84,±30]），
   b133 把它们往内收过（超出老世界半径 76 会让那一轴动不了），但**只改了客户端** →
   联机时服务端按老点下发坐标，玩家出生在围墙外/房子里/楼梯里，一出生就卡住动不了；
   探针 t_spawn 那条「两端是同一批点」的红灯说的就是这件事。
   【坑】这张表被 t_spawn 用正则逐条解析（要求「数组后面紧跟 」），
   所以**不要在对象字面量里插注释**——会把它解析坏（曾把日蚀点当成经典点校验）。 */
const MAP_SPAWNS = {
  classic: [[-66,66], [-28,66], [66,66], [18,52], [-10,42], [-40,36], [-66,28], [58,24], [-22,16], [22,4], [-66,-2], [66,-16], [-48,-24], [-8,-24], [30,-36], [-32,-56], [-66,-66], [2,-66], [34,-66], [66,-66]],
  eclipse: [[-12,4], [-2,48], [30,24], [-44,26], [26,-22], [-2,-38], [-38,66], [60,14], [-42,-26], [18,80], [-66,-2], [58,-24], [52,70], [70,44], [-80,30], [86,4], [22,-70], [-40,-68], [56,-60], [-80,-30]],
  lab: [[0,22],[0,-22],[-26,0],[26,0],[-26,-60],[-26,-44],[26,60],[26,44],[-60,22],[60,22],[-60,-22],[60,-22],[-26,-12],[26,12],[-44,22],[44,-22],[26,-44],[-26,44],[36,22],[-36,-22]],
  station: [[0,36],[-16,42],[16,42],[-30,38],[30,38],[8,21],[24,20],[-24,20],[0,-20],[18,-24],[-20,-22],[40,-28],[-40,-30],[0,-40],[-15,-42],[24,-44],[28,-16],[48,-18],[-48,-18],[52,20],[-52,20],[0,12.5],[44,12.5],[-44,12.5]],
  range: [[0,50],[30,45],[-30,45],[0,20],[40,20],[-40,20],[20,40],[-20,40],[50,0],[-50,0],[40,-20],[-40,-20],[22,-30],[-22,-30],[20,-40],[-20,-40],[30,-45],[-30,-45],[0,-50]]
};
const SAFE_SPAWNS = MAP_SPAWNS.classic;          // 兼容旧名（＝经典图出生点）
function normMapId(v) { v = String(v == null ? '' : v); return MAP_IDS.indexOf(v) >= 0 ? v : 'classic'; }
function mapNameOf(v) { return MAP_NAMES[normMapId(v)] || MAP_NAMES.classic; }
/* 【batch166】房间钥匙。原来"房间"就等于"地图"：同一张图的人互相可见。
   现在要支持「不同玩法模式各自一间房」「爆能器走自建房（同房号才见面）」，
   所以房间钥匙改为：有玩法模式时 = 模式:房号；没模式时 = 地图 id（与以前完全一致）。
   ⚠️ 地图 id 另有 mapIdOf() —— 出生点、换图判断这类"真·地图"语义要用它，别用 mapOf。 */
function mapIdOf(p) { return normMapId(p && p.map); }
function roomKeyOf(p) {
  const m = (p && p.mode) ? String(p.mode) : '';
  if (!m) return mapIdOf(p);                    // 原版：房间 = 地图（向后兼容）
  /* 【batch168】房间 = 模式:房号。**地图不进钥匙** ——
     ⚠️ 上一版把地图塞进钥匙（模式:地图:房号），立刻踩坑：地图是**各人本机 localStorage 里
     存的那张图**，A 存了 eclipse、B 存了 classic，两人填同一个房号却被分进**两个房间**
     → 互相看不见、永远凑不够 2 人、开不了局（用户实测）。
     正确做法：**地图是房间的一个属性，由队长（第一个进房的人）决定，后来的人跟着走**。
     这样"同一个房号的人一定在同一张图上"，既不会各玩各的图，也不会被拆开。 */
  return m + ':' + String(p.room || '');
}
function mapOf(p) { return roomKeyOf(p); }      // 兼容旧名：广播过滤都走它 → 自动按房间隔离
function sameRoom(a, b) { return mapOf(a) === mapOf(b); }

/* ==================== 【batch166】爆能器模式（spike）====================
   自建房专属玩法（房间钥匙 = spike:房号，不同房号互不可见）：
     · 进房自动均衡分队，**不限几 v 几**（哪队人少补哪队）
     · 进攻方(team 0)有一人携带爆能器，走到点位长按 F 安放
     · 安放后引信倒计时；守方(team 1)可以在点位长按 F 拆除
   胜负：引爆=攻方得分；拆除 / 时间耗尽 / 团灭=守方得分。每回合结束 5 秒后开下一回合。 */
const SPIKE_ROUND_TIME = 100;   // 每回合时长（秒）
const SPIKE_PLANT_TIME = 3;     // 安放所需长按秒数
const SPIKE_DEFUSE_TIME = 5;    // 拆除所需长按秒数
/* 【batch168】按键：下包 / 拆包统一按 **4**（F 留着当"上梯/互动"，不再抢）。
   这是纯客户端的事（客户端上报 plant/defuse 给服务端），常量放这里只为说明与文档一致。 */
const SPIKE_KEY = 'Digit4';
const SPIKE_FUSE = 40;          // 安放后引信（秒）
const SPIKE_PREP_TIME = 12;     // 【batch166】每回合的"准备时间"（秒）：这段时间只能待在出生点附近
const SPIKE_PREP_R = 6;         // 准备时间内的活动半径（米）：走出这个圈会被服务端拉回
const SPIKE_SITE_R = 4;         // 点位半径（米）
const SPIKE_ROOMS = {};         // 房间钥匙 -> 爆能器对局状态
/* 【batch166】每张图的爆能器配置：下包区 site + 攻方/守方**固定出生点**。
   出生点尽量取各地图已验证安全的点位（MAP_SPAWNS），避免卡墙。 */
const SPIKE_MAP_CFG = {
  // 每张图两个安置点 A/B（爆能器可安在任意一处）—— 都放在远离双方出生点的位置；开局掉落点 spike 也远离出生点。
  // 攻防出生点刻意放在地图**两端**（用各地图已验证安全的 MAP_SPAWNS 坐标），避免两人一开局就贴脸。
  /* 【batch169】atk/def 改成**固定单点**（不再随机取），坐标全部取自上面 MAP_SPAWNS 里已验证安全的点
     —— 既固定，又不会某张图某一方刷进墙里/建筑里卡住。两队各占地图一端、距离拉满。 */
  classic: { sites: [{ x: -28, z: -2 }, { x: 28, z: -2 }], spike: { x: 0, z: 34 }, atk: [-28, 66], def: [2, -66] },
  eclipse: { sites: [{ x: -16, z: 34 }, { x: 16, z: 34 }], spike: { x: 0, z: 38 }, atk: [18, 80], def: [22, -70] },
  lab:     { sites: [{ x: -18, z: 18 }, { x: 18, z: 18 }], spike: { x: 0, z: 36 }, atk: [26, 60], def: [-26, -60] }
};
/* 【batch180】校验客户端（队长）上报的自定义图爆能器配置：防畸形 / 越界数值。
   只认 sites（下包点，最多 4 个）和 spike（爆能器出生点），两者缺一即视为无效。 */
function normSpikeCfg(c) {
  try {
    if (!c || typeof c !== 'object') return null;
    const num = v => (typeof v === 'number' && isFinite(v) && Math.abs(v) < 10000);
    const arr = c.sites || [];
    if (!Array.isArray(arr) || !arr.length) return null;
    const sites = [];
    for (let i = 0; i < arr.length && sites.length < 4; i++) { const s = arr[i]; if (s && num(s.x) && num(s.z)) sites.push({ x: s.x, z: s.z }); }
    if (!sites.length) return null;
    if (!c.spike || !num(c.spike.x) || !num(c.spike.z)) return null;
    const p2 = v => (Array.isArray(v) && num(v[0]) && num(v[1])) ? [v[0], v[1]] : null;
    return { sites: sites, spike: { x: c.spike.x, z: c.spike.z }, atk: p2(c.atk) || [0, 40], def: p2(c.def) || [0, -40] };
  } catch (e) { return null; }
}
/* 【batch180】内置三张图之外的自定义图，若**没有登记点位**不再静默套用 classic 的坐标
   —— 那在它的图里可能正好是墙里 / 坑里 / 图外。这里打日志点明，方便排查。 */
function spikeCfg(p) {
  const _id = mapIdOf(p);
  if (SPIKE_MAP_CFG[_id]) return SPIKE_MAP_CFG[_id];
  if (_id !== 'classic' && _id !== 'eclipse' && _id !== 'lab') {
    log('爆能器：地图「' + _id + '」未登记下包点/爆能器出生点，暂用 classic 点位（让队长在图里重进一次房即可上报）');
  }
  return SPIKE_MAP_CFG.classic;
}
/* 【batch169】爆能器出生点：**固定** —— 两队各一个点，不再随机。
   兼容两种写法：固定单点 [x,z]，或旧的点列表 [[x,z],[x,z]]（取第一个，仍然是固定的）。 */
function spikeSpawnPt(cfg, team) {
  const v = (team === 0) ? cfg.atk : cfg.def;
  if (Array.isArray(v) && v.length) {
    if (Array.isArray(v[0])) return v[0];                                  // 旧写法：点列表 → 取第一个
    if (typeof v[0] === 'number' && typeof v[1] === 'number') return v;    // 新写法：单点
  }
  return [0, 15];
}
function spikeIs(p) { return !!(p && p.mode === 'spike'); }
function spikeState(rk) {
  if (!SPIKE_ROOMS[rk]) SPIKE_ROOMS[rk] = {
    round: 1, score: [0, 0], phase: 'waiting',   // waiting 等人 / prep 准备 / live 对抗 / planted 已安放 / over 回合结束
    timer: SPIKE_ROUND_TIME, fuse: SPIKE_FUSE,
    plant: 0, defuse: 0, site: null, sites: [], plantSite: -1, carrier: 0,
    winner: -1, reason: '',       // 【batch166】上一回合谁赢了（0 进攻 / 1 防守 / -1 还没结果）与原因
    leader: 0,                    // 【batch166】队长（第一个进房的人），只有他能点「开始游戏」
    started: 0,                   // 【batch167】这场对局是否已经开过 —— 「全员准备」只在**开局前**要求，
                                  //   开局后中途进来的人不该把正在打的对局打回"等待"
    map: 'classic',               // 【batch168】房间地图：由队长（房主）决定，所有人跟着用这张图
    spikePos: null                // 【batch168】爆能器**掉在地上**时的坐标；null＝有人拿着（看 carrier）
  };
  return SPIKE_ROOMS[rk];
}
/* 均衡分队：房间里哪队人少就补哪队（所以 1v1、2v3、5v5 都能玩） */
function spikeAssignTeam(p, want) {
  const rk = mapOf(p);
  if (want === 0 || want === 1) { p.team = want; return; }   // 【batch166】玩家自己选了阵营（进攻 / 防守）
  let a = 0, d = 0;
  players.forEach(function (q) { if (mapOf(q) !== rk) return; if (q.team === 0) a++; else if (q.team === 1) d++; });
  p.team = (a <= d) ? 0 : 1;
}
/* 【batch168】单独告诉**本人**：你是哪队、出生点在哪。
   ⚠️ 以前只在"回合开始"时发，结果玩家进了大厅、明明已经分队了，界面还显示"阵营：未选择"。
   现在进房 / 换阵营 / 开回合都会发一次。 */
function spikeTellYou(q) {
  try { sendTo(q, { t: 'spikeYou', team: q.team | 0, spawn: q.spawnPt || null }); } catch (e) { }
}
/* 【batch169】持包的人**阵亡** → 爆能器掉在他的阵亡点（进攻方还能去捡回来继续安放）。
   以前持包者一死包就"消失"，回合直接卡死没法推进。 */
function spikeDropOnDeath(q) {
  try {
    if (!spikeIs(q)) return;
    const rk = mapOf(q), S = spikeState(rk);
    if (S.carrier !== q.id) return;
    S.spikePos = { x: q.x, z: q.z };
    S.carrier = 0; S.dropBy = q.id;
    S.dropLock = 0;                       // 阵亡掉的可以立刻捡（不用等"扔完 0.8 秒"的防抖）
    spikeSync(rk);
    log('爆能器掉落在 ' + q.name + ' 的阵亡处');
  } catch (e) { }
}
function spikeSync(rk) {
  const S = spikeState(rk);
  /* 【batch166】带上两队名单（队伍界面要显示"我方有谁、敌方有谁"） */
  const roster = [];
  let mkId = S.map || 'classic', allReady = true, any = false;
  players.forEach(function (q) {
    if (mapOf(q) !== rk) return;
    any = true;
    if (!q.spikeReady) allReady = false;
    roster.push({ i: q.id, n: q.name, t: q.team | 0, a: q.alive ? 1 : 0, h: Math.max(0, Math.round(q.hp)), r: q.spikeReady ? 1 : 0 });
  });
  if (!any) allReady = false;
  broadcast({
    t: 'spike', round: S.round, score: S.score, phase: S.phase,
    timer: Math.ceil(S.timer), fuse: Math.ceil(S.fuse),
    plant: Math.round(S.plant * 10) / 10, defuse: Math.round(S.defuse * 10) / 10,
    site: S.site, sites: (S.sites || []), plantSite: (typeof S.plantSite === 'number' ? S.plantSite : -1), carrier: S.carrier, winner: S.winner, reason: S.reason, leader: S.leader, roster: roster,
    mk: mkId, ar: allReady ? 1 : 0, st: S.started,           // 【batch167】本房地图 / 是否全员已准备 / 是否已开过局
    sp: S.spikePos || null,                                  // 【batch168】爆能器掉在地上的坐标（null＝有人拿着）
    ln: (function () {                                       // 【batch168】队长名字 —— 大厅里直接显示，
      let nm = '';                                           //   一眼就能看出"大家是不是在同一间房"
      players.forEach(function (q) { if (q.id === S.leader) nm = q.name; });
      return nm;
    })(),
    rk: rk                                                   // 【batch168】房间钥匙（排查用：同房号却互相看不见时看它）
  }, undefined, rk);
}
/* 开一回合：全员复活满血 + 随机挑一名进攻方携带爆能器 */
function spikeStartRound(rk) {
  const S = spikeState(rk);
  /* 【batch166】房里已经没人了就别再重开 —— 否则空房间会一直 setTimeout 循环下去 */
  /* 【batch166】开局条件：**至少 2 人、且两队都得有人** —— 否则进入"等待"（单人 / 同队都不开） */
  let _n = 0, _a = 0, _d = 0, _rd = 0;
  players.forEach(function (q) { if (mapOf(q) !== rk || !spikeIs(q)) return; _n++; if (q.spikeReady) _rd++; if (q.team === 0) _a++; else if (q.team === 1) _d++; });
  /* 【batch166】开局条件：≥2 人、两队各≥1；【batch167】且**开局前**才要求"所有人都已准备"
     （队长点了也要满足）。开打之后中途进人不再回退到"等待"，否则正在打的对局会被打断。 */
  if (_n < 2 || _a < 1 || _d < 1 || (!S.started && _rd < _n)) { S.phase = 'waiting'; S.timer = 0; S.winner = -1; S.reason = ''; spikeSync(rk); return; }
  S.started = 1;                                                                                  // 【batch167】这场已经开过了
  S.phase = 'prep'; S.timer = SPIKE_PREP_TIME; S.fuse = SPIKE_FUSE; S.plant = 0; S.defuse = 0;   // 【batch166】先准备阶段
  S.winner = -1; S.reason = '';                                                                  // 新回合：清掉上一回合的胜负
  const atk = [];
  let atkSpawn = [0, 15];              // 【batch169】进攻方出生点
  let roomCfg = SPIKE_MAP_CFG.classic; // 【batch169】本房地图配置（用于取两处安置点 + 开局掉落点）
  players.forEach(function (q) {
    if (mapOf(q) !== rk) return;
    /* 【batch166】按队伍送到各自**固定的出生点**（攻守分开），并把本图下包区设好 */
    const cfg = spikeCfg(q); roomCfg = cfg;
    S.sites = (cfg.sites || []).slice(); S.site = null; S.plantSite = -1;  // 【batch169】两处安置点 + 本回合还没安放
    const sp = spikeSpawnPt(cfg, q.team);              // 【batch169】固定出生点（不再随机）
    q.x = sp[0]; q.z = sp[1];
    q.spawnPt = sp;                    // 准备时间内不能走出这个点附近
    q.hp = MAX_HP; q.alive = true; q.downed = false; q.downedUntil = 0; q.respawnAt = 0;
    try { sendTo(q, { t: 'spikeYou', team: q.team, spawn: sp, hp: MAX_HP }); } catch (e) { }   // 告诉本人：你是哪队、出生点在哪（【batch238】hp：上回合死的人血要一起回满）
    if (q.team === 0) { atk.push(q.id); atkSpawn = sp; }
  });
  /* 【batch169】爆能器开局掉在**专门的掉落点**（远离出生点），进攻方走过去自动捡起；
     守方捡不了。可以扔/丢下，落地后进攻方还能再捡。 */
  S.carrier = 0;
  S.spikePos = { x: roomCfg.spike.x, z: roomCfg.spike.z };
  spikeSync(rk);
}
function spikeEndRound(rk, atkWon, reason) {
  const S = spikeState(rk);
  if (S.phase === 'over') return;
  if (atkWon) S.score[0]++; else S.score[1]++;
  S.round++; S.phase = 'over'; S.winner = atkWon ? 0 : 1; S.reason = reason || '';
  spikeSync(rk);
  setTimeout(function () { spikeStartRound(rk); }, 5000);   // 5 秒后开下一回合
}
/* 每帧推进（挂在服务器主循环里）。dt 单位：秒 */
function spikeTick(dt) {
  /* 【batch168】房间空了就把房间状态清掉（比分/回合/地图/队长一起重置）。
     否则人走光后再进来，会沿用上一局的地图 —— 队长想换图却换不掉。 */
  Object.keys(SPIKE_ROOMS).forEach(function (rk) {
    let n = 0; players.forEach(function (q) { if (mapOf(q) === rk && spikeIs(q)) n++; });
    if (!n) delete SPIKE_ROOMS[rk];
  });
  const seen = {};
  players.forEach(function (p) {
    if (!spikeIs(p)) return;
    const rk = mapOf(p); if (seen[rk]) return; seen[rk] = 1;
    const S = spikeState(rk);
    if (S.phase === 'over') return;
    /* 【batch168】队长还活着吗？**任何阶段都要查**（以前只在 waiting 查 →
       队长打到一半退出，剩下的人就永远没有队长：开始按钮不出现、换图也没人能点）。 */
    let _leadOk = false, _first = 0;
    players.forEach(function (q) { if (mapOf(q) !== rk || !spikeIs(q)) return; if (!_first) _first = q.id; if (q.id === S.leader) _leadOk = true; });
    if (!_leadOk && _first) S.leader = _first;          // 队长走了 → 顺位给房里第一个人

    if (S.phase === 'waiting') {   // 【batch166】等待：**不自动开** —— 要"全员准备 + 队长点开始"
      spikeSync(rk);
      return;
    }
    /* 0)【batch168】爆能器在地上 → **进攻方**走近自动捡起（守方捡不了）。
        刚扔出去的一瞬间有个 0.8 秒的锁定，免得原地扔了又被自己立刻捡回来。 */
    if (S.carrier === 0 && S.spikePos && S.phase !== 'over') {
      const _now = Date.now();
      let _pick = 0;
      players.forEach(function (q) {
        if (_pick || mapOf(q) !== rk || !spikeIs(q) || !q.alive) return;
        if (q.team !== 0) return;                                  // 只有进攻方能拿
        if (q.id === S.dropBy && _now < (S.dropLock || 0)) return;  // 刚扔的人先不能捡
        const dx = q.x - S.spikePos.x, dz = q.z - S.spikePos.z;
        if (dx * dx + dz * dz <= 2.2 * 2.2) _pick = q.id;
      });
      if (_pick) {
        S.carrier = _pick; S.spikePos = null; S.dropBy = 0; S.dropLock = 0;
        spikeSync(rk);
      }
    }
    // 1) 安放 / 拆除进度（双点位：玩家靠近**任一**安置点即可；实际安在哪一个由 plantSite 记录）
    let planted = false, defused = false;
    const _sites = (S.phase === 'planted' && S.site) ? [S.site] : (S.sites || []);
    players.forEach(function (q) {
      if (mapOf(q) !== rk || !q.alive) return;
      let nearSite = -1;
      for (let _si = 0; _si < _sites.length; _si++) {
        const _ss = _sites[_si]; if (!_ss) continue;
        if (Math.abs(q.x - _ss.x) <= SPIKE_SITE_R && Math.abs(q.z - _ss.z) <= SPIKE_SITE_R) { nearSite = _si; break; }
      }
      if (nearSite < 0) return;
      if (S.phase === 'live' && q.team === 0 && q.id === S.carrier && q.spikeAct === 'plant') {
        S.plant = Math.min(SPIKE_PLANT_TIME, S.plant + dt);
        if (S.plant >= SPIKE_PLANT_TIME) {
          S.phase = 'planted'; S.fuse = SPIKE_FUSE; planted = true;
          S.site = _sites[nearSite]; S.plantSite = nearSite;   // 【batch169】记录实际安放在哪个点
        }
      }
      if (S.phase === 'planted' && q.team === 1 && q.spikeAct === 'defuse') {
        S.defuse = Math.min(SPIKE_DEFUSE_TIME, S.defuse + dt);
        if (S.defuse >= SPIKE_DEFUSE_TIME) defused = true;
      }
    });
    if (defused) { spikeEndRound(rk, false, '拆除'); return; }
    // 2) 计时与胜负
    if (S.phase === 'prep') {                                   // 【batch166】准备时间
      S.timer -= dt;
      /* 准备时间内谁都不能离开出生点范围：超出的拉回圈边（服务端权威 ——
         别人看到的也是被限制后的坐标；玩家本机由客户端同步限制，见 js/30）。 */
      players.forEach(function (q) {
        if (mapOf(q) !== rk || !q.spawnPt) return;
        const dx = q.x - q.spawnPt[0], dz = q.z - q.spawnPt[1];
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > SPIKE_PREP_R) {
          const k = SPIKE_PREP_R / d;
          q.x = q.spawnPt[0] + dx * k; q.z = q.spawnPt[1] + dz * k;
        }
      });
      if (S.timer <= 0) { S.phase = 'live'; S.timer = SPIKE_ROUND_TIME; }   // 准备结束，开打
    } else if (S.phase === 'live') {
      S.timer -= dt;
      if (S.timer <= 0) { spikeEndRound(rk, false, '时间到'); return; }   // 时间到没安上 → 守方赢
    } else if (S.phase === 'planted') {
      S.fuse -= dt;
      if (S.fuse <= 0) { spikeEndRound(rk, true, '引爆'); return; }     // 引爆 → 攻方赢
    }
    /* 3) 团灭：**只要两队都还有人（不管死活）**就判 —— 死光的一方输这一回合。
       ⚠️ 以前写的是"双方**存活**人数加起来 ≥2 才判"，那是为了防"空房间无限循环"，
       但它把 1v1 也一起废了：1v1 里死一个，剩 1 个，判定直接被跳过 → 回合永远不结束。
       现在改成看"**队伍里有没有人**"（atkTot/defTot）：单人自己一队才会被跳过。
       【batch167】爆能器**不复活**，所以团灭＝直接结束这一回合。 */
    let atkAlive = 0, defAlive = 0, atkTot = 0, defTot = 0;
    players.forEach(function (q) {
      if (mapOf(q) !== rk || !spikeIs(q)) return;
      if (q.team === 0) { atkTot++; if (q.alive) atkAlive++; }
      else if (q.team === 1) { defTot++; if (q.alive) defAlive++; }
    });
    if (atkTot > 0 && defTot > 0) {
      if (atkAlive === 0) { spikeEndRound(rk, false, '进攻方被团灭'); return; }
      if (defAlive === 0) { spikeEndRound(rk, true, '防守方被团灭'); return; }
    }
    spikeSync(rk);
  });
}
/* 每 100ms 推进一次爆能器对局（回合计时 / 安放 / 拆除 / 引信）。
   用 try 包住：万一哪一间房的状态坏了，也不能把整个服务器拖挂。 */
setInterval(function () { try { spikeTick(0.1); } catch (e) { } }, 100);

function randSpawn(mapId) {
  // 【为什么不用"随机试几次"】试的次数有限，人一多就可能全抽到已被占的点 → 两人叠一起。
  // 改成确定性挑选：先排除「已经有人站着的点」，再在剩下的里挑离玩家最远的那个
  // （并列时随机取一个，保留一点随机性）。
  // 【batch113】按图取表，而且"这点有没有人站着"**只数同一个房间的人** ——
  // 两张图坐标重叠，不过滤就会把另一张图的人当成"占了这个点"。
  const mk = normMapId(mapId);
  const table = MAP_SPAWNS[mk] || SAFE_SPAWNS;
  const free = [];
  for (let i = 0; i < table.length; i++) {
    const sp = table[i];
    let taken = false, near = 1e9;
    players.forEach(function (q) {
      if (q.stale) return;
      if (mapOf(q) !== mk) return;
      const d = Math.hypot(q.x - sp[0], q.z - sp[1]);
      if (d < 2.5) taken = true;                 // 有人正站在这个点上
      if (d < near) near = d;
    });
    if (!taken) free.push({ sp: sp, near: near });
  }
  if (!free.length) free.push({ sp: table[(Math.random() * table.length) | 0], near: 0 });  // 兜底
  let bestD = -1, pick = [];
  for (let i = 0; i < free.length; i++) {
    if (free[i].near > bestD + 0.001) { bestD = free[i].near; pick = [free[i].sp]; }
    else if (Math.abs(free[i].near - bestD) <= 0.001) pick.push(free[i].sp);
  }
  const s = pick[(Math.random() * pick.length) | 0];
  return { x: s[0], z: s[1] };
}

/* 广播。第三个参数 mapId：
     · 传了   → 只发给**同一个房间**的人（batch113 多地图分房的核心）；
     · 不传   → 发给全场（只有"每张图都要知道"的全局消息才这么用，比如房间人数）。
   为什么必须过滤：两张图都以原点为中心，坐标范围完全重叠 —— 不过滤就会「隔图互相看见、隔着图被打死」。 */
function broadcast(obj, exceptId, mapId) {
  const s = JSON.stringify(obj);
  players.forEach(function (p) {
    if (exceptId !== undefined && p.id === exceptId) return;
    if (mapId !== undefined && mapOf(p) !== mapId) return;
    wsSend(p.ws, s);
  });
}
function sendTo(p, obj) { if (p) wsSend(p.ws, JSON.stringify(obj)); }

function publicInfo(p) {
  /* 【batch203】mem＝这名玩家拥有纪念枪皮（累积登录解锁）。客户端收到新玩家加入时会据此
     在屏幕上显示「感谢您这么久的陪伴」。只是一个标记，不参与任何战斗结算。 */
  return { i: p.id, n: p.name, k: p.kills, d: p.deaths, h: p.hp, al: p.alive ? 1 : 0, t: (typeof p.team === 'number' ? p.team : -1), hero: (typeof p.hero === 'number' ? p.hero : -1), mem: (p.mem ? 1 : 0) };
}

function spawnState(p) {
  const sp = randSpawn(p.map);                 // 【batch113】按他所处的房间（地图）选出生点
  p.x = sp.x; p.z = sp.z; p.y = 2;
  p._pAt = 0;                                  // 【batch238】换点＝重新起算，别拿上一个点的时刻判位移
  p._tpUntil = Date.now() + 1200;              // 并给 1.2 秒宽限：客户端那包可能还在路上
  p.hp = MAX_HP; p.alive = true; p.respawnAt = 0;
  p.downed = false; p.downedUntil = 0;                       // 【batch120】重生：倒地状态一并清掉
  p.vulnUntil = 0;                                           // 【batch121c】重生：易伤也清掉
  p.overloadUntil = 0;                                       // 【batch172】重生：无人机过载也清掉
  p.domeUntil = 0;                                           // 【batch173】重生：穹顶减伤也清掉
  p.shieldUntil = 0; p.reflectUntil = 0; p.fortifyUntil = 0;
  p.rushUntil = 0; p.adrenUntil = 0; p.healAuraUntil = 0; p.healAcc = 0;   // 重生：技能状态一并清掉
  return sp;
}

function dropPlayer(id) {
  const p = players.get(id);
  if (!p) return;
  players.delete(id);
  broadcast({ t: 'left', i: id, n: p.name }, undefined, mapOf(p));   // 【batch113】只通知同房间的人
  pushRooms();
  log('玩家离开：' + (p.code || '') + ' ' + p.name + '（当前 ' + onlineCount() + '/' + MAX_PLAYERS + ' 人）');
}

/* 真正"在场"的人数：疑似掉线的（还在宽限期内等他重连）不算，
   否则一个人掉线占着名额 45 秒，别人就进不来了。 */
function onlineCount() {
  let n = 0;
  players.forEach(function (p) { if (!p.stale) n++; });
  return n;
}
/* 某个房间（地图）里有几个"真正在场"的人 —— 人数上限按房间算 */
function onlineCountIn(mapId) {
  const mk = normMapId(mapId);
  let n = 0;
  players.forEach(function (p) { if (!p.stale && mapOf(p) === mk) n++; });
  return n;
}
/* 每张图各几个人：给客户端大厅显示（HTTP /status 和 WS 的 rooms 消息都用它） */
function roomCounts() {
  const r = {};
  for (let i = 0; i < MAP_IDS.length; i++) r[MAP_IDS[i]] = 0;
  players.forEach(function (p) { if (!p.stale) { const k = mapOf(p); r[k] = (r[k] || 0) + 1; } });
  return r;
}
function pushRooms() { broadcast({ t: 'rooms', r: roomCounts() }); }

function joinPlayer(sock, name, cid, code, mapId, clear, ecl, mode, room, teamWant, mem) {
  /* 【batch166】玩法模式与自建房号 —— 决定"房间钥匙"（谁能看见谁）：
       mode 为空 → 房间 = 地图（原版行为，向后兼容）
       mode 有值 → 房间 = mode:room（自建房：房号相同才碰面，不同房号互不可见） */
  const jm = String(mode || '').replace(/[:]/g, '').slice(0, 24);
  const jr = String(room || '').replace(/[:]/g, '').slice(0, 24);
  const mid = normMapId(mapId);          // 【batch113】进哪个房间（地图）。非法/缺省 → 经典图
  // 【名字唯一 + 身份码取回】名字一旦被注册就永久属于那个人（离线也算），别人不能再用：
  //   · 名字没被注册过            → 注册并生成身份码
  //   · 名字是自己的（同 cid）    → 放行（刷新/重连）
  //   · 别人带了正确的身份码      → 认领（换网址/换设备也是同一个人）
  //   · 其它情况                  → 拒绝，让 TA 换名字或用身份码取回
  const nmWant = normName(name);
  const own = nameOwnerOf(nmWant);
  if (own) {
    const mine = !!cid && own.cids.indexOf(cid) >= 0;
    const okCode = !!code && code === own.code;
    if (!mine && !okCode) {
      log('拒绝重名：' + nmWant + '（已被别人使用，建议改名 ' + nameAlt(nmWant) + '）');
      try { wsSend(sock, JSON.stringify({ t: 'bye', why: 'dupname', n: nmWant, needCode: 1, alt: nameAlt(nmWant) })); } catch (e) { }
      try { sock.destroy(); } catch (e) { }
      return null;
    }
    if (!mine && nameOnline(nmWant)) {          // 码对了，但这个名字此刻有人在玩 → 不允许同名同框
      log('拒绝重名：' + nmWant + '（该名字正在游戏中）');
      try { wsSend(sock, JSON.stringify({ t: 'bye', why: 'dupname', n: nmWant, busy: 1, alt: nameAlt(nmWant) })); } catch (e) { }
      try { sock.destroy(); } catch (e) { }
      return null;
    }
  }
  // 同一客户端重连（手机切后台、WiFi 闪断、刷新页面）→ 复用原身份与原 id。
  // 否则旧身份会继续留在世界里冻住，别人（以及他自己）就会看到"分身/幽灵"。
  if (cid) {
    for (const [oid, op] of players) {
      if (op.cid !== cid) continue;
      const oldSock = op.ws;
      players.delete(oid);
      // 告诉旧连接"你被接管了"：客户端收到后不再自动重连，避免两个页面无限互踢
      try { sendTo(op, { t: 'bye', why: 'replaced' }); } catch (e) { }
      try { oldSock.destroy(); } catch (e) { }
      op.ws = sock;
      op.name = normName(name || op.name) || op.name;
      // 【batch113】按他"现在选的地图"归位：在菜单里换过图的话，必须挪到新图的出生点，
      // 否则会带着旧图的坐标出现在新图里（那个点很可能正好卡在墙里）。
      // 图没变就一切照旧 —— 保留原来的坐标，做到"无缝接回"。
      if (mapIdOf(op) !== mid) { op.map = mid; spawnState(op); }   /* 【batch166】换图判断要用地图 id，不是房间钥匙 */
      op.mode = jm; op.room = jr;      /* 【batch166】重连也要跟上：他可能换了玩法模式 / 自建房号 */
      if (jm === 'spike' && op.team !== 0 && op.team !== 1) spikeAssignTeam(op);   /* 重连补个队伍 */
      nameBind(op.name, cid);
      /* 【batch126】客户端 join 时带 clear=1 ＝「我本机通关过剧情」，服务端把这份成绩记到名字上 */
      if (clear) unlockSet(op.name, 'lightning');
      if (ecl) unlockSet(op.name, 'eclipse');                // 【batch147】蚀日者（控制台指令解锁）
      op.unlocks = unlockOf(op.name);                        // 名字与身份绑定（改名会把自己从旧名上摘下来）
      op.lastSeen = Date.now();
      op.hp = MAX_HP; op.alive = true; op.respawnAt = 0;
      op.skReady = {}; op.shieldUntil = 0; op.reflectUntil = 0; op.fortifyUntil = 0; op.overloadUntil = 0;   // 【batch172】重连也清过载
      op.domeUntil = 0; op.domeZone = 0;                                    // 【batch173】重连也清穹顶
      op.mem = mem ? 1 : 0;                          // 【batch203】重连也要跟着更新：可能这几天刚好解锁了
      op.rushUntil = 0; op.adrenUntil = 0; op.healAuraUntil = 0; op.healAcc = 0;   // 重连：技能状态归零
      op.stale = false; op.staleAt = 0;              // 他回来了：从「疑似掉线」状态恢复
      op.reconn = (op.reconn || 0) + 1;              // 统计重连次数（控制台 list 可见）
      sock._pid = oid;
      players.set(oid, op);
      const others0 = [];
      players.forEach(function (q) { if (q.id !== oid && mapOf(q) === mapOf(op)) others0.push(publicInfo(q)); });   // 【batch166】只报同房间（房间钥匙）的人
      sendTo(op, { t: 'welcome', i: oid, n: op.name, x: op.x, y: op.y, z: op.z, hp: op.hp, maxHp: MAX_HP, ps: others0, code: op.codeId || '', map: op.map, mode: op.mode || '', room: op.room || '', unlocks: op.unlocks || unlockOf(op.name) });   /* 【batch168】map＝房间地图 */   // 【batch126】剧情解锁；【batch166】mode/room＝所在玩法模式与自建房号
      /* 【batch184f-补4】首连即在火车站：服务端起权威列车 + 下发当前地图状态（晚进者可见） */
      /* 【batch232】★ 以前这里写成 if (op.map === 'station') —— 只有火车站才补发世界实体，
         别的图（classic 等）晚进的玩家**什么都收不到**（用户："服务器好多都是没法给后进的玩家的"）。
         现在：列车只有 station 需要，实体快照**所有地图都发**。 */
      if (op.map === 'station') ensureRoomTrain(mapOf(op));
      sendWorldInit(op);
      log('玩家重连：' + op.code + ' ' + op.name + '（沿用 ' + op.code + '，第 ' + op.reconn + ' 次重连，当前 ' + onlineCount() + '/' + MAX_PLAYERS + ' 人）');
      return op;
    }
  }
  // 名字唯一：重名的在上面已经被挡掉了（身份认 cid，名字查名字库）
  const pname = normName(name) || ('玩家' + nextId);
  const p = {
    id: nextId++, code: '', name: pname, ws: sock, cid: cid || '',
    x: 0, y: 2, z: 15, yaw: 0, pitch: 0, an: 0, w: 0, ln: 0,
    hp: MAX_HP, alive: true, kills: 0, deaths: 0, respawnAt: 0, lastSeen: Date.now(),
    reconn: 0, stale: false, staleAt: 0,
    skReady: {}, shieldUntil: 0, reflectUntil: 0, fortifyUntil: 0,
    rushUntil: 0, adrenUntil: 0, healAuraUntil: 0, healAcc: 0,  // 英雄技能：3 个技能冷却到期 / 护盾 / 反射 / 堡垒 / 冲锋 / 肾上腺素 / 治疗力场 / 治疗累加器
    hero: HERO_SCOUT,                                          // batch100：当前英雄下标（被动结算要用：手雷减伤 / 治疗加成）
    downed: false, downedUntil: 0,                             // 【batch120】球形闪电倒地：是否倒地 / 倒地截止时刻
    vulnUntil: 0,                                              // 【batch121c】闪电「易伤」：三重减益的第三重（伤害 +25%），由 orbTick 置上、applyDamage 消费
    overloadUntil: 0,                                         // 【batch172】蜂鸟无人机过载：在此之前开火无效（只能近战）
    domeUntil: 0, domeZone: 0,                                // 【batch173】镇岳 SP 力场穹顶：圈内减伤 50%（服务端权威）
    mem: (mem ? 1 : 0),                                       // 【batch203】拥有纪念枪皮：广播给别人播「感谢陪伴」横幅
    unlocks: {}                                                // 【batch126】剧情解锁（{ lightning: 时间戳 }），英雄合法性校验要用
  };
  p.map = mid;             // 【batch113】所在地图（决定地图内容与出生点）
  p.mode = jm; p.room = jr;   // 【batch166】玩法模式 / 自建房号（决定房间钥匙＝谁能看见谁）
  /* 【batch168】爆能器：**地图由队长（第一个进房的人）决定，后来者跟着走**。
     房间是新房 → 用我选的这张图当"房间地图"；房间已经有人 / 残留了状态 → 用房间的图。 */
  if (jm === 'spike') {
    const _rk0 = mapOf(p);
    let _has = false;
    players.forEach(function (q) { if (q.id !== p.id && mapOf(q) === _rk0) _has = true; });
    if (!_has && !SPIKE_ROOMS[_rk0]) spikeState(_rk0).map = normMapId(mid);
    p.map = spikeState(_rk0).map || normMapId(mid);
  }
  spawnState(p);           // 【batch113】按这张图的出生点表选点（避开方块、尽量离同房间的人远）
  // 【注意】这里以前还有一行 p.x=0; p.z=15; 把刚算好的出生点覆盖掉了 ——
  // 结果每局所有新玩家都从同一个点冒出来、开局就叠在一起。已删除。
  p.code = '#' + (p.id < 10 ? '0' + p.id : p.id);   // 代号：只在服务器控制台显示
  sock._pid = p.id;
  players.set(p.id, p);
  const _rec = nameBind(pname, cid);               // 登记名字 → 别人再用这个名字就会被拒
  p.codeId = _rec ? _rec.code : '';                // 身份码（下发给本人，换网址时用它取回名字）
  if (clear) unlockSet(pname, 'lightning');        // 【batch126】带 clear=1 ＝ 本机通关过剧情 → 记到这个名字上
  if (ecl) unlockSet(pname, 'eclipse');            // 【batch147】带 ecl=1 ＝ 本机解锁过蚀日者
  p.unlocks = unlockOf(pname);
  /* 【batch166】爆能器模式：进房自动均衡分队；房间里第一个人进来时开第一回合 */
  if (jm === 'spike') {
    spikeAssignTeam(p, teamWant);
    p.spikeReady = false;                       // 新进来默认未准备
    const _st0 = spikeState(mapOf(p));
    if (!_st0.leader) _st0.leader = p.id;       // 【batch166】第一个进房的人当队长
    spikeSync(mapOf(p));
    spikeTellYou(p);                            // 【batch168】进房就告诉本人"你是哪队"（不然大厅一直显示"未选择"）
  }

  const others = [];
  players.forEach(function (q) { if (q.id !== p.id && mapOf(q) === mapOf(p)) others.push(publicInfo(q)); });   // 【batch166】只报同房间（房间钥匙）的人
  /* 【batch168】⚠️ 这里以前发的是客户端自己带来的 `mid` —— 后来者拿到的是**自己那张图**，
     于是"同一间房里各人渲染各人的图"（用户看到：我显示日蚀、他显示哨塔）。
     现在发**房间的图**（p.map，已被强制成房主那张）。 */
  sendTo(p, { t: 'welcome', i: p.id, n: p.name, x: p.x, y: p.y, z: p.z, hp: MAX_HP, maxHp: MAX_HP, ps: others, code: p.codeId || '', map: p.map, mode: jm, room: jr, unlocks: p.unlocks || {} });   // 【batch126】；【batch166】mode/room；【batch168】map＝房间地图
  /* 【batch184f-补4】首连即在火车站：服务端起权威列车 + 下发当前地图状态（晚进者可见） */
  /* 【batch232】同上：所有地图都要补发现存实体（烟 / 技能区域 / 门 / 陷阱） */
  if (p.map === 'station') ensureRoomTrain(mapOf(p));
  sendWorldInit(p);
  broadcast({ t: 'new', p: publicInfo(p), x: p.x, z: p.z }, p.id, mapOf(p));   // 【batch166】只通知同房间
  pushRooms();
  log('玩家进入：' + p.code + ' ' + p.name + '（地图「' + mapNameOf(mid) + '」当前 '
    + onlineCountIn(mid) + '/' + MAX_PLAYERS + ' 人，全场 ' + players.size + ' 人）');
  return p;
}

/* 统一的伤害结算（子弹命中 / 英雄技能都走这里，保证减伤口径一致）：
   · 反射力场：伤害减半，另一半**反弹给开枪的人**（noReflect 防止来回无限反弹）
   · 护盾投放：伤害 ×0.3（减伤 70%）
   · 堡垒阵地：伤害 ×0.7（减伤 30%）
   减伤口径与客户端 heroMitigate() 一致。 */
/* 【batch236】阵亡结算（从 applyDamage 里抽出来的）：扣到 0 之后要做的收尾都在这儿 ——
   掉包 / 清技能状态 / 广播击杀 / 给本人发 dead / 写日志。
   抽出来是为了让「陨石秒杀」这条权威路径复用同一套，避免两处各写一份、早晚写歪。 */
function killPlayerSrv(from, target, hs, why) {
  if (!target) return;
  target.hp = 0; target.alive = false; target.deaths++;
  spikeDropOnDeath(target);                                   // 【batch169】持包者阵亡 → 包掉在阵亡点
  target.downed = false; target.downedUntil = 0;              // 【batch120】死了就不再是"倒地"
  target.shieldUntil = 0; target.reflectUntil = 0; target.fortifyUntil = 0;
  target.rushUntil = 0; target.adrenUntil = 0; target.healAuraUntil = 0; target.healAcc = 0;   // 死了就撤技能状态
  target.fortifyZone = 0;
  target.domeUntil = 0; target.domeZone = 0;                  // 【batch173】死了就撤穹顶
  target.vulnUntil = 0;                                       // 【batch121c】死了就撤易伤
  target.respawnAt = Date.now() + RESPAWN_MS;
  if (from && from !== target) from.kills++;                  // 自己砸死自己不算人头
  broadcast({ t: 'kill', k: (from && from !== target) ? from.id : 0, kn: (from && from !== target) ? from.name : '',
              d: target.id, dn: target.name, hs: !!hs }, undefined, mapOf(target));
  sendTo(target, { t: 'dead', rs: RESPAWN_MS });
  log('击杀：' + (from ? (from.code + ' ' + from.name) : '（技能）') + ' → ' + target.code + ' ' + target.name +
      (why ? '（' + why + '）' : '') + (hs ? '（爆头）' : ''));
}

function applyDamage(from, target, rawDmg, hs, noReflect, nade) {
  if (!target || !target.alive) return 0;
  // 【batch145】虚化中（日蚀之门）：免疫一切伤害（客户端也在本地拦一道，这里是联机的权威）
  if (target.ghostUntil && target.ghostUntil > Date.now()) return 0;
  let dmg = Number(rawDmg);
  if (!isFinite(dmg) || dmg <= 0) return 0;
  dmg = Math.min(dmg, 120);            // 防止离谱伤害
  const now = Date.now();
  // 【batch100 被动】镇岳：受到的手雷伤害 ×0.7（减伤 30%）—— 放在最前，和护盾 / 堡垒可叠加
  if (nade && target.hero === HERO_GUARD) dmg = Math.max(1, Math.round(dmg * NADE_CUT));
  // 【batch121c】闪电「易伤」：踩过电区的人受所有伤害 +25%。
  //   放在护盾 / 堡垒前面（先放大再减伤，和客户端 heroMitigate 的顺序一致 —— 客户端也是先乘易伤再算减伤）。
  if (target.vulnUntil && target.vulnUntil > now) dmg = Math.max(1, Math.round(dmg * ORB_VULN));
  if (target.reflectUntil && target.reflectUntil > now) {
    dmg = Math.max(1, Math.round(dmg * REFLECT_CUT));       // 反射力场：伤害减半
    broadcast({ t: 'hitsk', i: target.id }, undefined, mapOf(target));                // 让射手看到"打上去被弹回来了"
    if (!noReflect && from && from.alive && from.id !== target.id) {
      // 另一半还给开枪的人；noReflect=true 保证只反弹一层（对方也开反射时不会无限互弹）
      applyDamage(target, from, Math.max(1, Math.round(Number(rawDmg) * REFLECT_BACK)), false, true);
    }
  }
  if (target.shieldUntil && target.shieldUntil > now) {
    dmg = Math.max(1, Math.round(dmg * SHIELD_CUT));    // 能量护盾：减伤 70%
  } else if (target.domeUntil && target.domeUntil > now) {
    dmg = Math.max(1, Math.round(dmg * DOME_CUT));      // 【batch173】力场穹顶：减伤 50%
  } else if (target.fortifyUntil && target.fortifyUntil > now) {
    dmg = Math.max(1, Math.round(dmg * FORTIFY_CUT));   // 堡垒工事：减伤 30%
  }

  target.hp -= dmg;
  if (target.hp <= 0) {
    killPlayerSrv(from, target, !!hs);
  } else {
    broadcast({ t: 'hp', i: target.id, h: target.hp, by: from ? from.id : 0, hs: !!hs }, undefined, mapOf(target));
    sendTo(target, { t: 'hurt', by: from ? from.name : '', d: dmg, h: target.hp, hs: !!hs });
  }
  return dmg;
}

/* ============================================================================
   【batch237】防瞬移（网络波动导致的"敌人突然出现在别处"）
   ----------------------------------------------------------------------------
   做法：服务器记下**上一次采纳的位置 + 时刻**，每个 p 包先算"这段时间最远能跑多远"：
        允许距离 = max(8 米, 间隔 × 26 米/秒)     （跑步 ~6-9，突进 10，留足余量）
   超了就不采纳，把旧坐标用 {t:'push'} 打回去，客户端会把自己拉回原地。
   · 间隔最多按 1.2 秒算 —— 掉线 5 秒回来也别想一步跨过半个地图；
   · 复活 / 换图 / 突进 / 传送门 / 被列车撞飞 这些**合法瞬移**由 p._tpUntil 开窗口；
   · 死了 / 倒地的人不动，直接跳过（别把尸体拽来拽去）。
   ==========================================================================*/
/* 【batch238】参数收紧一点：
   · 最低 3 米（原来是 8 米 —— 8 米意味着"每包都能跳 8 米"，闪现根本拦不住）；
   · 间隔最多按 0.45 秒算（原来 1.2 秒 → 最远能放行 31 米，卡一下就能从 A 点飘到 B 点）。
   跑动 6~9 m/s，26 m/s 的余量足够；真正合法的瞬移（突进/传送/列车/重生）都开了窗口，不靠这里放水。 */
const MOVE_MAX_SPEED = 26, MOVE_MIN_STEP = 3, MOVE_MAX_DT = 0.45;
function moveGuard(p, x, z) {
  const now = Date.now();
  /* 第一个状态包只当基准（刚进服 / 刚重生时客户端还在对齐出生点，不该判瞬移） */
  if (!p._pAt) { p._pAt = now; return true; }
  const dt = Math.min(MOVE_MAX_DT, Math.max(0.02, (now - p._pAt) / 1000));
  p._pAt = now;
  if (!p.alive || p.downed) return true;                       // 死了 / 倒地：不动
  if (now < (p._tpUntil || 0)) return true;                    // 合法瞬移窗口
  const dx = x - (p.x || 0), dz = z - (p.z || 0);
  const d = Math.sqrt(dx * dx + dz * dz);
  const allow = Math.max(MOVE_MIN_STEP, dt * MOVE_MAX_SPEED);
  if (d <= allow) return true;
  /* 日志节流：网络差的时候一秒能被抓几十次，不掐会把黑窗口刷爆、也拖慢主循环 */
  if (!p._mgLogAt || now - p._mgLogAt > 3000) {
    p._mgLogAt = now;
    log('抓回瞬移：' + p.code + ' ' + p.name + ' 一步 ' + d.toFixed(1) + ' 米（允许 ' + allow.toFixed(1) + '，间隔 ' + Math.round(dt * 1000) + 'ms）');
  }
  return false;
}

function handleHit(from, msg) {
  if (from.downed) return;                                  // 【batch120】倒地的人开不了枪（也补不了刀）
  /* 【batch172】装备过载（蜂鸟无人机）：服务端不认他的**枪**伤，防客户端绕过；
     kn=1 是近战（刀）—— 过载只是开不了枪，刀照样能砍，不拦。 */
  if (!msg.kn && from.overloadUntil && Date.now() < from.overloadUntil) return;
  const target = players.get(msg.i | 0);
  if (!target || !target.alive || target.id === from.id) return;
  if (!sameRoom(from, target)) return;            // 【batch113】打不到另一个房间的人（防作弊/防串味）
  /* 【batch169】友伤防护：同一队（爆能器 攻/防）不能互相伤害；原版没有队伍概念（team 为 undefined/-1）→ 照常打 */
  if (typeof from.team === 'number' && typeof target.team === 'number' && from.team >= 0 && target.team >= 0 && from.team === target.team) return;
  applyDamage(from, target, msg.d, !!msg.h);
}

/* ============================================================================
   【batch236】流火 SP ③「焚天新星 · 天陨」：3 秒延迟 + 不分楼层秒杀
   ----------------------------------------------------------------------------
   客户端在「举起 → 左键召唤」那一刻发 ph:0（准星落点 + 半径），之后：
     · 服务端**自己掐表** 3 秒（不信客户端的落地时刻 —— 改个请求就能瞬间砸人）；
     · 到点先广播 ph:1 给同房**除施法者以外**的人播落地特效（他本地已经播过）；
     · 再按**水平距离**判死：dx²+dz² ≤ r²，**故意不看 y** ——
       这就是"人在 1 楼、圈画在 2 楼也照样被砸中"的圆柱判定；
     · 施法者自己站在圈里也照杀（和客户端单机规则一致）。
   计数写在全局数组里而不是挂在玩家身上：施法者中途被打死 / 掉线，陨石照样落。
   ==========================================================================*/
const METEOR_MS = 3000, METEOR_R_MAX = 14, METEOR_GAP_MS = 12000;
const pendingMeteors = [];                 // {x,y,z,r,at,byId,byName,room}

function handleMeteor(from, msg) {
  if (!from || from.stale || !from.alive || from.downed) return;
  if (((msg.ph | 0) !== 0)) return;                       // 落地由服务端触发，客户端发的一律不认
  const now = Date.now();
  if (from._meteorAt && now - from._meteorAt < METEOR_GAP_MS) return;   // 防刷（客户端冷却 25 秒）
  const room = mapOf(from);
  if (!room) return;
  const x = Math.max(-200, Math.min(200, +msg.x || 0));
  const z = Math.max(-200, Math.min(200, +msg.z || 0));
  const y = Math.max(-50, Math.min(80, +msg.y || 0));
  const r = Math.max(2, Math.min(METEOR_R_MAX, +msg.r || 8));
  from._meteorAt = now;
  pendingMeteors.push({ x: x, y: y, z: z, r: r, at: now + METEOR_MS, byId: from.id, byName: from.name, room: room });
  while (pendingMeteors.length > 40) pendingMeteors.shift();
  broadcast({ t: 'meteor', ph: 0, i: from.id, x: x, y: y, z: z, r: r, d: METEOR_MS }, from.id, room);
  log('陨石起手：' + from.code + ' ' + from.name + ' → (' + x.toFixed(1) + ', ' + z.toFixed(1) + ') r=' + r);
}

function meteorTickSrv() {
  if (!pendingMeteors.length) return;
  const now = Date.now();
  for (let i = pendingMeteors.length - 1; i >= 0; i--) {
    const m = pendingMeteors[i];
    if (now < m.at) continue;
    pendingMeteors.splice(i, 1);
    const caster = players.get(m.byId) || null;
    broadcast({ t: 'meteor', ph: 1, i: m.byId, x: m.x, y: m.y, z: m.z, r: m.r }, m.byId, m.room);
    let n = 0;
    players.forEach(function (q) {
      if (!q || q.stale || !q.alive) return;
      if (mapOf(q) !== m.room) return;
      const dx = q.x - m.x, dz = q.z - m.z;
      if (dx * dx + dz * dz > m.r * m.r) return;
      killPlayerSrv(caster, q, false, '陨石');
      n++;
    });
    log('陨石落地：' + (caster ? (caster.code + ' ' + caster.name) : '（施法者已离开）') +
        ' 于 (' + m.x.toFixed(1) + ', ' + m.z.toFixed(1) + ') r=' + m.r + ' → 击杀 ' + n + ' 人');
  }
}
setInterval(function () { try { meteorTickSrv(); } catch (e) { } }, 100);

/* 英雄技能（联机权威结算）：客户端发 {t:'skill', k:'<英雄>', s:0|1|2}，
   这里做冷却校验 + 结算 + 广播特效（广播带 s，别人的模型上能播对第几个技能）。
   单机模式下技能完全由客户端本地算，这条只在联机里走。 */
/* 投掷物引爆 / 落地结算（配合客户端 batch88 的物理投掷物）
   客户端在「引信到点」或「第一次落地」的那一刻补发 {t:'boom', k, x, z}：
     · 闪光弹 → 8 米内其他玩家致盲（拿真实引爆点算，不再提前 1 秒）
     · 急救箱 → 6 米内所有人回血 + 解减速
   然后把这个引爆点广播给别人，他们好在同一位置播爆闪 / 开箱特效。 */
/* 【batch227】本地 AI 敌人 / 剧情 BOSS 的伤害上报（联机快照会拿服务端 hp 覆盖本地，
   不上报的话从服务器网页打开玩单人/剧情时"敌人打玩家完全不扣血"——用户实测）。
   · from=null：日志记「（AI）」，击杀广播 by=0
   · 限流：同一玩家 120ms 内只认一次（防脚本刷屏）；伤害钳 1~120（applyDamage 内部还有一道） */
function handleAiHit(from, msg) {
  if (!from || !from.alive || from.downed) return;
  const now = Date.now();
  if (from._aiHitAt && now - from._aiHitAt < 120) return;
  from._aiHitAt = now;
  let dmg = Math.floor(Number(msg && msg.d) || 0);
  if (dmg < 1 || dmg > 120) return;
  applyDamage(null, from, dmg, false, true);
}

/* 【batch228】文字聊天：内容限长（防刷屏），同房广播。颜色由客户端自带。 */
function handleChat(from, msg) {
  if (!from || from.stale) return;
  const txt = String(msg && msg.x || '').slice(0, 200);
  if (!txt.trim()) return;
  broadcast({ t: 'chat', i: from.id, n: from.name, c: from.color || 0, x: txt }, undefined, mapOf(from));
}

function handleBoom(from, msg) {
  const k = msg.k;
  // 技能序号：白泽的 ②急救箱(s=1) 与 ③治疗烟雾(s=2) 都用 k='medic'，靠 s 区分
  const s = (typeof msg.s === 'number') ? (msg.s | 0) : (k === 'rusher' ? 2 : 1);
  const x = (typeof msg.x === 'number') ? msg.x : from.x;
  const z = (typeof msg.z === 'number') ? msg.z : from.z;
  if (k === 'scout') {                                         // 闪光弹爆闪
    players.forEach(function (q) {
      if (q.id === from.id || q.stale || !q.alive) return;
      if (!sameRoom(from, q)) return;                            // 【batch113】只在同一个房间生效
      const dx = q.x - x, dz = q.z - z;
      const d2 = dx * dx + dz * dz;
      // 【看向爆点才会被闪 · 不限距离】拿该玩家上报的朝向 yaw 当视线方向，和"指向爆点"求夹角：
      //   正对（余弦 ≥0.82）→ 全效 3 秒；侧对 → 按时长折算；背对（≤0.35）→ 完全不闪。
      //   距离不影响结果（batch91 去掉了 8 米半径门）。贴脸 3 米内不看也白（和客户端同一套规则）。
      //   服务端不掌握地图，故不做墙体遮挡判定。
      let k2 = 1;
      if (d2 > FLASH_CLOSE_R * FLASH_CLOSE_R) {
        const yaw = +q.yaw || 0;
        const L = Math.sqrt(d2) || 1;
        const dot = ((x - q.x) * (-Math.sin(yaw)) + (z - q.z) * (-Math.cos(yaw))) / L;
        k2 = (dot <= FLASH_DOT_MIN) ? 0
           : (dot >= FLASH_DOT_FULL) ? 1
           : (dot - FLASH_DOT_MIN) / (FLASH_DOT_FULL - FLASH_DOT_MIN);
      }
      if (k2 <= 0.05) return;                                  // 背对着爆点 → 不闪
      sendTo(q, { t: 'flash', dur: Math.round(FLASH_MS * k2) });
      broadcast({ t: 'hitsk', i: q.id }, undefined, mapOf(from));                      // 所有人看到一圈闪光环
    });
  } else if (k === 'rusher') {                                 // 破片手雷爆炸（batch92）
    players.forEach(function (q) {
      if (q.stale || !q.alive) return;                         // 【含扔弹的人自己】炸到自己一样疼
      if (!sameRoom(from, q)) return;                          // 【batch113】手雷不跨房间炸
      const dx = q.x - x, dz = q.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > FRAG_R * FRAG_R) return;
      const dd = Math.sqrt(d2);
      let fall = 1 - dd / FRAG_R; if (fall < 0) fall = 0; else if (fall > 1) fall = 1;   // 0（边缘）..1（中心）
      const dmg = Math.round(FRAG_DMG_MIN + (FRAG_DMG - FRAG_DMG_MIN) * fall);
      sendTo(q, { t: 'slowed', dur: FRAG_SLOW_MS });           // 冲击波减速（位移在本地）
      sendTo(q, { t: 'knock', fx: x, fz: z, pw: FRAG_KNOCK }); // 从爆点向外击退
      broadcast({ t: 'hitsk', i: q.id }, undefined, mapOf(from));                      // 所有人看到命中环
      applyDamage(q.id === from.id ? null : from, q, dmg, false, false, true);   // 自己炸死自己 → 击杀者记「（技能）」；末位 true＝手雷伤害（镇岳被动要吃它）
    });
  } else if (k === 'medic') {
    if (s === 0) {                                             // ①医疗脉冲弹落地：6 米内自己/队友回 45 + 落点留 5 秒治疗力场
      players.forEach(function (q) {
        if (q.stale || !q.alive) return;
        if (!sameRoom(from, q)) return;                        // 【batch113】回血不跨房间
        const dx = q.x - x, dz = q.z - z;
        if (dx * dx + dz * dz > PULSE_R * PULSE_R) return;
        healSrv(q, Math.round(MEDIC_BURST * healMulFor(q)));   // batch100：白泽被动；【batch120】倒地的会被扶起
      });
      from.healAuraUntil = Date.now() + HEAL_AURA_MS; from.healAcc = 0;
      from.healAuraX = x; from.healAuraZ = z;                  // 力场圆心钉在弹着点
    } else if (s === 1) {                                      // ②急救箱落地开箱
      players.forEach(function (q) {
        if (q.stale || !q.alive) return;
        if (!sameRoom(from, q)) return;                        // 【batch113】回血不跨房间
        const dx = q.x - x, dz = q.z - z;
        if (dx * dx + dz * dz > MEDKIT_R * MEDKIT_R) return;
        healSrv(q, Math.round(MEDKIT_AMT * healMulFor(q)));    // 【batch120】倒地的会被扶起
        sendTo(q, { t: 'unslow' });                            // 满血也解减速（急救箱的战术价值）
      });
    } else {                                                   // ③治疗烟雾：烟内的人解除减速（挡视线是视觉/AI 层的事）
      players.forEach(function (q) {
        if (q.stale || !q.alive) return;
        if (!sameRoom(from, q)) return;                        // 【batch113】解减速不跨房间
        const dx = q.x - x, dz = q.z - z;
        if (dx * dx + dz * dz > SMOKE_R * SMOKE_R) return;
        sendTo(q, { t: 'unslow' });
      });
      pushSmokeSrv(x, z, mapOf(from), 'medic', (typeof msg.y === 'number' ? msg.y : undefined));   // batch232：记类型，后进来的玩家才建得出治疗烟的颜色
    }
  } else if (k === 'guard') {                                  // ②烟雾弹（batch92）：落地冒烟（只记位置，给白泽"烟中治疗加成"判定用）
    if (s === 1) pushSmokeSrv(x, z, mapOf(from), 'guard', (typeof msg.y === 'number' ? msg.y : undefined));
  } else if (k === 'eclipse') {
    if (s === 0) {                                             // ①蚀日：黑日落地 → 登记一段时间，之后由 eclipseTick 周期脉冲致盲
      eclipseZones.push({ x: x, z: z, until: Date.now() + SOLAR_LIFE_MS, next: Date.now() + 120, map: mapOf(from), by: from.id });
    }
    // ②日蚀之门：两扇门的走位完全在客户端本地算（只对自己生效），服务端不参与
  } else if (k === 'lightning') {
    if (s === 0) {                                             // ①闪电光球：登记电区，之后由 orbTick 持续放电
      orbZones.push({ x: x, z: z, until: Date.now() + ORB_LIFE_MS, map: mapOf(from), by: from.id, hits: {} });
    } else if (s === 1) {                                      // ②电荷陷阱触发：2.2 米内连劈 4×20 = 80
      players.forEach(function (q) {
        if (q.stale || !q.alive) return;
        if (!sameRoom(from, q)) return;
        if (q.id === from.id) return;                       /* 【batch169】自己放的陷阱不劈自己 */
        /* 【batch169】同队不劈（原版没有队伍概念，team 为 undefined/-1 → 照常劈） */
        if (typeof from.team === 'number' && typeof q.team === 'number' && from.team >= 0 && q.team >= 0 && from.team === q.team) return;
        const dx = q.x - x, dz = q.z - z;
        if (dx * dx + dz * dz > TRAP_R * TRAP_R) return;
        applyDamage(from, q, TRAP_N * TRAP_DMG, false, false, false);
      });
    } else if (s === 2) {
      /* 【batch123】球形闪电改成「装填 3 发、左键一发一发打出去」：
         装填那一下走 handleSkill（记 130 秒大招冷却），**每一发命中**时客户端再补发
         {t:'boom',k:'lightning',s:2,x,z,tgt:[id]}，这里就是那一发的权威结算 ——
         校验目标合法 / 同房间 / 40 米内，通过才判倒地（改客户端数据也不能凭空把人打倒）。 */
      const list = Array.isArray(msg.tgt) ? msg.tgt.slice(0, 1) : [];
      for (let i = 0; i < list.length; i++) {
        const q = players.get(Number(list[i]) | 0);
        if (!q || q.stale || !q.alive || q.downed) continue;
        if (!sameRoom(from, q)) continue;
        const dx = q.x - from.x, dz = q.z - from.z;
        if (dx * dx + dz * dz > BALL_RANGE * BALL_RANGE) continue;
        downPlayer(q, from);
      }
    }
  } else if (k === 'yingyue') {
    /* 【batch158】影月 ②暗影炸弹落地（客户端补发 {t:'boom',k:'yingyue',s:1,x,z,y}）：
       y＝落点那张地面的高度（分层用）→ 登记 shadowZones，由 shadowTick 每秒毒蚀 15 点 */
    if (s === 1) {
      shadowZones.push({
        x: x, z: z, y: (typeof msg.y === 'number' ? msg.y : 0),
        until: Date.now() + SHADOW_LIFE_MS, next: Date.now() + 300,
        map: mapOf(from), by: from.id
      });
    }
    // ①暗影烟雾弹＝挡视线：以前"客户端本地结算"→ 服务端没记录，后进来的玩家完全看不到紫烟。
    //   现在登记进 smokeZones（kind='yingyue'），join 时会补发。
    if (s === 0) pushSmokeSrv(x, z, mapOf(from), 'yingyue', (typeof msg.y === 'number' ? msg.y : undefined));
    // ③遁入暗影＝无敌（走位置包 gh 标记 → ghostUntil），服务端无需登记
  }
  /* 【batch135】把引爆点高度 y 也中继出去：撞墙 / 空中引爆时，别人那边要在**那个高度**播特效
     （原来只发 x,z，别人一律按 0.6~0.9 的地面高度播 → 二楼的烟在一楼冒）。
     老客户端不发这个字段 → y 为 undefined → JSON 里直接没有这个键，行为不变。 */
  /* 【batch143】引爆面法线也一起中继：别人那边要把特效**贴在他撞到的那张面**上
     （墙 / 天花板 / 地面），而不是一律横铺在地板上。 */
  const boomMsg = { t: 'boom', i: from.id, k: k, s: s, x: x, z: z };
  if (typeof msg.y === 'number') { boomMsg.y = msg.y; }
  if (typeof msg.nx === 'number' || typeof msg.ny === 'number') {
    boomMsg.nx = +msg.nx || 0; boomMsg.ny = (msg.ny === undefined ? 1 : +msg.ny || 0); boomMsg.nz = +msg.nz || 0;
  }
  broadcast(boomMsg, from.id, mapOf(from));   // 其他人播引爆特效（带 s：手雷/烟/急救箱各不同）

  /* 【batch233】持久效果统一登记：查表 → 登记进 worldEnts（晚进玩家进场时由 sendWorldInit 重放）。
     直接拿**刚广播出去的报文**做快照，所以后进来的人看到的和别人当时看到的逐字段一致。 */
  const 规约 = 场景持久效果[k + '|' + s];
  if (规约) {
    const 快照 = Object.assign({}, boomMsg, { left: 规约.life });
    recordWorldEnt(mapOf(from), 'boom', 快照, 规约.life);
  }
}
function handleSkill(from, msg) {
  const k = String(msg.k || '');
  const s = msg.s | 0;
  if (SKILL_IDS.indexOf(k) < 0 || s < 0 || s > 2) return;     // 未知英雄 / 技能序号越界：忽略
  if (!from.alive || from.downed) return;                     // 死了 / 倒地了都不能放技能
  /* 【batch237】突进（rusher ①）和虚化（eclipse ②）都是"一笔跨很远"，给防瞬移开窗 */
  if ((k === 'rusher' && s === 0) || (k === 'eclipse' && s === 1)) from._tpUntil = Date.now() + 900;
  const now = Date.now();
  if (!from.skReady) from.skReady = {};
  // 冷却按「英雄 + 技能位」记（不是只按 0/1/2）：否则一局里换过英雄后，
  // 新英雄的第 2 个技能会被旧英雄第 2 个技能的冷却挡住，最长要等 25 秒。
  const skKey = k + '#' + s;
  if (from.skReady[skKey] && now < from.skReady[skKey]) return;   // 该技能还在冷却：忽略（防刷）
  from.skReady[skKey] = now + ((SKILL_CD[k] && SKILL_CD[k][s]) || 16000);

  if (k === 'guard') {
    if (s === 0) {                                             // ①护盾投放：自己和 8 米内队友一起减伤 70%
      from.shieldUntil = now + SHIELD_MS;
      teamBuff(from, 'shield', SHIELD_MS);
    }
    // ②烟雾弹（batch92）：投掷物，落地炸开烟团挡视线；不涉及伤害结算（客户端本地做视觉/AI 视线）
    else if (s === 2) {                                        // ③堡垒阵地：脚下开圈，站里面才减伤（fortifyZoneTick 续 buff）
                                                               // 【batch100 顺手修】原来写成 `else` → 放②烟雾弹(s=1) 也会顺带套上堡垒减伤
      from.fortifyUntil = now + FORTIFY_MS;
      /* 【batch143】记下阵地所在的高度：站在二楼楼板上的圈，不该给正下方一楼的人续减伤 */
      from.fortifyZone = { x: from.x, y: (typeof msg.y === 'number' ? msg.y : 0), z: from.z, until: now + FORTIFY_MS };
    }
  } else if (k === 'guard_sp') {
    /* 【batch173】镇岳 SP：①掩体墙（本地障碍，服务端不参与）②电磁减速网（减速走 spSlow）
       ③力场穹顶 → 服务端记下圈的位置，fortifyZoneTick 里给站在圈里的人续减伤 50% */
    if (s === 2) {
      from.domeZone = { x: (typeof msg.x === 'number' ? msg.x : from.x),
                        y: (typeof msg.y === 'number' ? msg.y : 0),
                        z: (typeof msg.z === 'number' ? msg.z : from.z),
                        until: now + DOME_MS, r: DOME_R };
    }
  } else if (k === 'rusher') {
    // ①战术突进：位移由客户端本地做，服务端只校验冷却
    if (s === 1) {                                             // ②冲锋号令：自己和 8 米内队友一起加速
      from.rushUntil = now + RUSH_MS;
      teamBuff(from, 'rush', RUSH_MS);
    }
    // ③破片手雷（batch92）：投掷物，引信到点客户端补发 {t:'boom'} 时才结算（见 handleBoom）
  } else if (k === 'scout') {
    // ①战术探测器 / ②闪光弹 / ③全域透视：投掷物 + 纯本地视觉。
    // 【为什么挪走】原来一按下技能就按"身前 7 米"立刻结算 → 敌人比手雷落地早约 1 秒就白了。
    //   现在闪光弹是真投掷物，引信到点客户端再发 {t:'boom'}，服务端拿**真实引爆点**结算（见 handleBoom）。

  } else if (k === 'medic') {
    if (s === 0) {                                             // ①医疗脉冲弹（batch94）：投掷物，落地炸开才结算（见 handleBoom）
    } else if (s === 1) {                                      // ②急救箱：落地才开箱（结算见 handleBoom）
      // 投掷物落地时补发 {t:'boom'}，那时才按**落点**给 6 米内所有人回血 + 解减速
    } else {                                                   // ③治疗烟雾（batch92）：投掷物，落地炸烟 + 给烟内的人解减速（见 handleBoom）
    }
  } else if (k === 'eclipse') {
    // ①蚀日 / ②日蚀之门：都是投掷物（致盲由 handleBoom 登记黑日 → eclipseTick 脉冲；传送门纯客户端本地）
    // ③日之眼：纯客户端本地的范围侦测（服务端不参与）
  } else if (k === 'eclipse_sp') {
    /* 【batch183】蚀日者 · 焚曜（联机致盲转发）：
       ①日冕喷发（s=0）：以施法者为中心 12 米内、同一层楼的其他人致盲 2.5 秒；
       ③蚀日 · 白夜（s=2）：同房间其他人全图致盲 4 秒（不分距离 / 不分楼层）。
       ②堕日（s=1）是投掷物：出手时的 {t:'skill',th} 由下面 skMsg 广播出去（别人本地复现飞行），
       落地燃烧区由施法者本机的 spZoneNet 另行广播，服务端不参与。
       施法者本人不被闪（致盲的是"敌人"），与小兵 AI 的口径一致。 */
    if (s === 0) {
      const fy = (typeof msg.y === 'number') ? msg.y : 0;             // 施法者脚下那张面的高度
      players.forEach(function (q) {
        if (q.id === from.id || q.stale || !q.alive) return;
        if (!sameRoom(from, q)) return;                               // 【batch113】只闪同一个房间的人
        const dx = q.x - from.x, dz = q.z - from.z;
        if (dx * dx + dz * dz > SP_FLARE_R * SP_FLARE_R) return;      // 12 米内
        if (Math.abs((q.y - 2) - fy) > 3.2) return;                   // 隔一层楼不算（q.y 是眼高，脚底＝q.y-2；容差与客户端一致）
        sendTo(q, { t: 'flash', dur: SP_FLARE_BLIND_MS });
      });
    } else if (s === 2) {
      players.forEach(function (q) {
        if (q.id === from.id || q.stale || !q.alive) return;
        if (!sameRoom(from, q)) return;
        sendTo(q, { t: 'flash', dur: SP_VEIL_BLIND_MS });             // 全图致盲：不分距离 / 不看朝向 / 不分楼层
      });
    }
  } else if (k === 'lightning') {
    // ①闪电光球 / ②电荷陷阱：投掷物，落地时补发 {t:'boom'} 结算（见 handleBoom）
    if (s === 2) {                                             // ③球形闪电：客户端把它锁定的目标 id 一起发上来
      const list = Array.isArray(msg.tgt) ? msg.tgt.slice(0, BALL_N) : [];
      for (let i = 0; i < list.length; i++) {
        const q = players.get(Number(list[i]) | 0);
        if (!q || q.stale || !q.alive || q.downed) continue;   // 目标非法 / 已经倒地 → 跳过
        if (!sameRoom(from, q)) continue;                      // 【batch113】不跨房间
        const dx = q.x - from.x, dz = q.z - from.z;
        if (dx * dx + dz * dz > BALL_RANGE * BALL_RANGE) continue;     // 超出索敌半径 → 无效（防作弊）
        downPlayer(q, from);
      }
    }
  }
  // 广播给别人播特效。投掷类（探测器 / 闪光弹 / 急救箱）把「出生点 + 初速」一并转出去，
  // 别人本地用同一套物理就能跑出同一条轨迹 —— 于是能亲眼看见手雷飞过来。
  const skMsg = { t: 'sk', i: from.id, k: k, s: s };
  if (typeof msg.x === 'number' && typeof msg.z === 'number') { skMsg.x = msg.x; skMsg.z = msg.z; }
  /* 【batch143】施放高度：别人的堡垒阵地要铺在**同一层楼**上（老客户端不发 → 键直接不出现在 JSON 里） */
  if (typeof msg.y === 'number') { skMsg.y = msg.y; }
  if (typeof msg.nx === 'number' || typeof msg.ny === 'number') {
    skMsg.nx = +msg.nx || 0; skMsg.ny = (msg.ny === undefined ? 1 : +msg.ny || 0); skMsg.nz = +msg.nz || 0;
  }
  if (msg.th && typeof msg.th === 'object') {
    skMsg.th = { x: +msg.th.x || 0, y: +msg.th.y || 0, z: +msg.th.z || 0,
                 vx: +msg.th.vx || 0, vy: +msg.th.vy || 0, vz: +msg.th.vz || 0,
                 fuse: (typeof msg.th.fuse === 'number') ? msg.th.fuse : -1 };
    /* 【batch172】蜂鸟无人机：直线飞行（无重力、不弹墙）+ 飞行时长，
       这两个字段必须跟着中转，否则别人屏幕上的无人机会变成抛物线掉在地上。 */
    if (msg.th.straight) { skMsg.th.straight = 1; skMsg.th.life = (typeof msg.th.life === 'number' ? msg.th.life : 0.65); }
  }
  broadcast(skMsg, from.id, mapOf(from));                                    // 广播给别人；自己本地已经播过特效了
  log('技能：' + (from.code || '') + ' ' + from.name + ' 释放「' + k + ' #' + (s + 1) + '」');
}

/* 团队增益：把 buff 发给「除自己以外、8 米内、活着的」玩家（自己本地已经生效，不用再发） */
function teamBuff(from, b, dur) {
  const now = Date.now();
  players.forEach(function (q) {
    if (q.id === from.id || q.stale || !q.alive) return;
    if (!sameRoom(from, q)) return;                            // 【batch113】buff 不跨房间
    const dx = q.x - from.x, dz = q.z - from.z;
    if (dx * dx + dz * dz > TEAM_R * TEAM_R) return;
    // 【关键】除了通知客户端，服务端自己也要把状态记下来：
    // 否则队友屏幕上明明有护盾，服务端结算时却按"没护盾"算 → 说好的减伤不生效。
    if (b === 'shield') q.shieldUntil = Math.max(q.shieldUntil || 0, now + dur);
    else if (b === 'rush') q.rushUntil = Math.max(q.rushUntil || 0, now + dur);
    else if (b === 'adren') q.adrenUntil = Math.max(q.adrenUntil || 0, now + dur);
    sendTo(q, { t: 'buff', b: b, dur: dur });
  });
}
/* 堡垒阵地：站在圈里的活人，每 0.5 秒续一次短时减伤 buff —— 走出去下一次就不再续，自然失效 */
let _zoneTickAt = 0;
function fortifyZoneTick(now) {
  if (now - _zoneTickAt < ZONE_TICK_MS) return;
  _zoneTickAt = now;
  /* 【batch173】镇岳 SP 力场穹顶：圈内的人减伤 50%（自己 + 队友都算，同房间即可）。
     必须独立成一段 —— 写在下面 fortify 那段的 forEach 里会被「没有阵地就 return」挡掉，永远不生效。 */
  players.forEach(function (p) {
    if (p.stale || !p.alive || !p.domeZone || p.domeZone.until <= now) return;
    players.forEach(function (q) {
      if (q.stale || !q.alive) return;
      if (!sameRoom(p, q)) return;
      /* 【batch173】只保**自己人**：爆能器有队伍时只给同队；原版混战没有队伍概念 → 只给自己
         （否则敌人站进圈里也跟着减伤 50%，等于给对面发盾）。 */
      if (q !== p) {
        const pt = (typeof p.team === 'number' ? p.team : -1), qt = (typeof q.team === 'number' ? q.team : -1);
        if (!(pt >= 0 && pt === qt)) return;
      }
      const dx = q.x - p.domeZone.x, dz = q.z - p.domeZone.z;
      if (dx * dx + dz * dz > p.domeZone.r * p.domeZone.r) return;
      if (Math.abs((+q.y || 0) - (+p.domeZone.y || 0)) > ZONE_H) return;
      q.domeUntil = Math.max(q.domeUntil || 0, now + ZONE_BUFF_MS);
      sendTo(q, { t: 'buff', b: 'dome', dur: ZONE_BUFF_MS });
    });
  });
  players.forEach(function (p) {
    if (p.stale || !p.alive || !p.fortifyZone || p.fortifyZone.until <= now) return;
    players.forEach(function (q) {
      if (q.stale || !q.alive) return;
      if (!sameRoom(p, q)) return;                             // 【batch113】圈只对同房间的人生效
      const dx = q.x - p.fortifyZone.x, dz = q.z - p.fortifyZone.z;
      if (dx * dx + dz * dz > ZONE_R * ZONE_R) return;
      /* 【batch143】还要**站在同一层**：隔着楼板不算（q.y 是客户端 20Hz 上报的相机高度） */
      if (Math.abs((+q.y || 0) - (+p.fortifyZone.y || 0)) > ZONE_H) return;
      q.fortifyUntil = Math.max(q.fortifyUntil || 0, now + ZONE_BUFF_MS);   // 服务端同步记账，减伤才真的生效
      sendTo(q, { t: 'buff', b: 'fortify', dur: ZONE_BUFF_MS });
    });
  });
}
/* 治疗力场：所有带力场的活着的玩家，给半径内活着的玩家（含自己）按 0.5 秒节奏回血。 */
function healAuraTick(now) {
  const medics = [];
  players.forEach(function (p) {
    if (!p.stale && p.alive && p.healAuraUntil && p.healAuraUntil > now) medics.push(p);
  });
  if (!medics.length) return;
  players.forEach(function (q) {
    if (q.stale) return;
    if (!q.alive || q.hp >= MAX_HP) { q.healAcc = 0; return; }
    let inAura = false;
    for (let i = 0; i < medics.length; i++) {
      const m = medics[i];
      if (!sameRoom(q, m)) continue;                           // 【batch113】力场不跨房间
      const cx = (typeof m.healAuraX === 'number') ? m.healAuraX : m.x;   // 力场以「弹着点」为圆心（batch94）
      const cz = (typeof m.healAuraZ === 'number') ? m.healAuraZ : m.z;
      const dx = q.x - cx, dz = q.z - cz;
      if (dx * dx + dz * dz <= PULSE_R * PULSE_R) { inAura = true; break; }
    }
    if (!inAura) { q.healAcc = 0; return; }
    q.healAcc = (q.healAcc || 0) + TICK_MS;
    if (q.healAcc >= HEAL_AURA_PER) {
      q.healAcc -= HEAL_AURA_PER;
      healSrv(q, Math.round(HEAL_AURA_AMT * healMulFor(q)));   // batch100：白泽被动；【batch120】倒地的会被扶起
    }
  });
}

function handleMsg(sock, raw) {
  // 防挤爆：单连接消息频率（客户端正常是 30Hz 上报 + 每 2 秒心跳 ≈ 31 条/秒，这里留到 150 的余量）
  if (floodOn) {
    const now = Date.now();
    if (!sock._msgWin || now - sock._msgWin > 1000) { sock._msgWin = now; sock._msgN = 0; }
    sock._msgN = (sock._msgN || 0) + 1;
    if (sock._msgN > FLOOD.MSG_PER_SEC) {
      fStat.msg++;
      logThrottled('msg', '⛔ 防挤爆：某条连接消息刷得太快（超过 ' + FLOOD.MSG_PER_SEC + ' 条/秒），已断开');
      try { sock.destroy(); } catch (e) { }
      return;
    }
  }
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;

  if (m.t === 'join') {
    if (sock._pid) return;
    const cid = String(m.cid || '').slice(0, 40);
    const nm = normName(m.n);
    const code = String(m.code || '').trim().toUpperCase().slice(0, 8);
    if (isBanned(cid, nm)) {
      log('拒绝已封禁的玩家接入：' + (nm || cid));
      try { wsSend(sock, JSON.stringify({ t: 'bye', why: 'banned' })); } catch (e) { }
      try { sock.destroy(); } catch (e) { }
      return;
    }
    // 重连（同 cid 已在场）不算新玩家，不受人数上限影响
    let rejoin = false;
    if (cid) players.forEach(function (q) { if (q.cid === cid) rejoin = true; });
    const jmap = normMapId(m.map);                  // 【batch113】他选的是哪张图（决定地图内容与出生点）
    /* 【batch166】房间钥匙：有玩法模式时 = 模式:房号（自建房），没模式时 = 地图。
       冒号是分隔符，房号/模式名里去掉它，免得伪造出别人的房间钥匙。 */
    const jmode = String(m.mode || '').replace(/[:]/g, '').slice(0, 24);
    /* 【batch168】房号**先去空格再截断**：不然一个人填 "r1"、另一个填 "r1 "（多了个空格）
       就会变成两个不同的房间 → 各自都是自己那间房的"队长"（用户看到"两个队长")。 */
    const jroom = String(m.room || '').replace(/[:]/g, '').trim().slice(0, 24);
    const jkey = jmode ? (jmode + ':' + jroom) : jmap;   // 【batch168】模式:房号（口径与 roomKeyOf 一致；地图不进钥匙）
    const jteam = (m.team === 0 || m.team === 1) ? (m.team | 0) : -1;   // 【batch166】玩家自选阵营（-1 = 自动均衡）
    // 总闸：所有房间加起来的上限（【batch166】自建房可以有很多间，所以放宽房间数量）
    if (!rejoin && onlineCount() >= MAX_PLAYERS * 16) {
      log('服务器已满（' + onlineCount() + ' 人），拒绝：' + (nm || '(无名)'));
      try { wsSend(sock, JSON.stringify({ t: 'bye', why: 'full', max: MAX_PLAYERS })); } catch (e) { }
      try { sock.destroy(); } catch (e) { }
      return;
    }
    /* 【batch229】版本分化校验：major 不同或低于下限 → 拒（客户端会弹明确提示，不会重连轰炸） */
    const cv = String(m.v || '');
    if (!cv || verCmp(cv.split('.')[0] + '.0.0', SRV_VER.split('.')[0] + '.0.0') !== 0 || verCmp(cv, SRV_VER_MIN) < 0) {
      log('拒绝版本不符：' + (nm || '(无名)') + ' 客户端=' + (cv || '(没报版本)') + ' 服务器=' + SRV_VER + ' 下限=' + SRV_VER_MIN);
      try { wsSend(sock, JSON.stringify({ t: 'bye', why: 'ver', sv: SRV_VER, min: SRV_VER_MIN, cv: cv })); } catch (e) { }
      try { sock.destroy(); } catch (e) { }
      return;
    }
    /* 【batch243】模组核验：客户端带了服务器没有的模组，或模组代码和服务器那份不一样 → 不许进。
       拒绝报文带上名单，客户端弹面板"禁用这些模组并重连"。 */
    const 模组判定 = 校验客户端模组(m.mods, cv);
    if (模组判定.bad) {
      const 多 = 模组判定.extra || [], 改 = 模组判定.tampered || [];
      log('拒绝模组不符：' + (nm || '(无名)') + (多.length ? ('  多出[' + 多.join('、') + ']') : '') + (改.length ? ('  被改过[' + 改.join('、') + ']') : '') + (模组判定.reason ? ('  原因=' + 模组判定.reason) : ''));
      try {
        wsSend(sock, JSON.stringify({
          t: 'bye', why: 'mod', reason: 模组判定.reason || '',
          extra: 多, tampered: 改, missing: 模组判定.missing || [], sv: SRV_VER
        }));
      } catch (e) { }
      try { sock.destroy(); } catch (e) { }
      return;
    }
    if (!rejoin && onlineCountIn(jkey) >= MAX_PLAYERS) {
      // 分房间的上限：每间房各自 15 人（房间 = 模式:房号，或地图）
      log('房间「' + jkey + '」已满（' + onlineCountIn(jkey) + '/' + MAX_PLAYERS + '），拒绝：' + (nm || '(无名)'));
      try { wsSend(sock, JSON.stringify({ t: 'bye', why: 'full', max: MAX_PLAYERS, map: jmap })); } catch (e) { }
      try { sock.destroy(); } catch (e) { }
      return;
    }
    if (!joinPlayer(sock, nm, cid, code, jmap, m.clear ? 1 : 0, m.ecl ? 1 : 0, jmode, jroom, jteam, m.mem ? 1 : 0)) return;   // 【batch166】末尾 jteam=阵营   // 重名/需要身份码被拒；【batch126】clear=本机已通关剧情；【batch147】ecl=本机已解锁蚀日者；【batch166】jmode/jroom=玩法模式与自建房号
    return;
  }
  if (m.t === 'checkname') {                     // 取名时先问一句：这个名字还能用吗（只查、不登记）
    const nm = normName(m.n);
    const cid = String(m.cid || '').slice(0, 40);
    const code = String(m.code || '').trim().toUpperCase().slice(0, 8);
    const own = nameOwnerOf(nm);
    const mine = !!(own && cid && own.cids.indexOf(cid) >= 0);
    const okCode = !!(own && code && code === own.code);
    const free = !nm || !own || mine || okCode;
    const busy = !!(own && !mine && nameOnline(nm));
    /* 【batch221】bind=1 ＝ 玩家在取名面板点了「确定」，**这里就把名字登记进名字库**。
       以前只有 join（进多人游戏）才 nameBind，于是只玩单人、或者只在菜单里逛的玩家
       永远"未注册" —— 下次进网页又被要求重新注册，而且单人里根本没机会补登记。
       现在面板确认即注册：单人/多人一视同仁（用户要求"重名检测全局生效"）。
       绑定成功会回传新的身份码，客户端存下来（换设备/换网址可取回这个名字）。 */
    let bound = 0, newCodeStr = '';
    if (m.bind && free && nm) {
      const rec = nameBind(nm, cid);
      if (rec) { bound = 1; newCodeStr = rec.code || ''; }
    }
    try {
      wsSend(sock, JSON.stringify({
        t: 'namechk', ok: free, n: nm,
        /* 【batch221】known＝这个名字在名字库里**有没有登记**。
           客户端启动时靠它判断"本地存了个名字、但服务器不认识" → 让玩家重新注册一遍。
           ok=true 只代表"可以用"（没登记也是可以用），不能拿来当"已注册"。 */
        known: (own || bound) ? 1 : 0,
        bound: bound,
        code: newCodeStr,
        alt: (free && !okCode) ? '' : nameAlt(nm),
        needCode: (own && !mine && !okCode) ? 1 : 0,
        busy: busy ? 1 : 0
      }));
    } catch (e) { }
    return;
  }
  const p = sock._pid ? players.get(sock._pid) : null;
  if (!p) return;
  p.lastSeen = Date.now();

  if (m.t === 'p') {                              // 状态上报
    /* 【batch237】先过防瞬移：超了就不采纳坐标，并把旧坐标打回去（其余字段照常收） */
    const _nx = +m.x || 0, _nz = +m.z || 0;
    if (moveGuard(p, _nx, _nz)) { p.x = _nx; p.z = _nz; }
    else sendTo(p, { t: 'push', x: p.x || 0, z: p.z || 0, why: 'tp' });
    p.y = +m.y || 0;
    p.yaw = +m.yaw || 0; p.pitch = +m.pitch || 0;
    p.an = m.an | 0; p.w = m.w | 0; p.ln = +m.ln || 0;   // ln＝探头侧倾，转发给其他人显示
    p.wk = m.wk;                                         // 【batch184e】武器标识（枪=槽位号 / 刀='k:'+id）：让别人看到你手里具体的枪/刀
    p.nv = m.nv | 0;                                     // 【batch103】手里拿的投掷物种类（0=没拿），转发给别人显示
    p.na = m.na | 0;                                     // 【batch104】是否举着投掷物瞄准（点了左键抬起）
    /* 【batch216】换弹 / 检视进度（0=没在做，0~1=进度）。
       别人据此在第三人称播"退弹匣 → 上弹匣 → 拉栓"和"转枪检视"的动作。
       跟 nv/na 一样只做转发，不参与任何判定。 */
    p.rl = (typeof m.rl === 'number' && m.rl > 0) ? Math.min(1, m.rl) : 0;
    p.iv = (typeof m.iv === 'number' && m.iv > 0) ? Math.min(1, m.iv) : 0;
    /* 【batch145】虚化（日蚀之门）：客户端每个状态包带 gh=1 → 续一段"免疫伤害"窗口。
       用续期而不是开关：客户端一停发（掉线 / 死亡）窗口自然过期，不会留下永久无敌。 */
    if (m.gh) p.ghostUntil = Date.now() + 600;
    if (typeof m.h === 'number') {                       // batch100：每个状态包都带当前英雄下标（换了英雄，被动立刻跟着变）
      let hj = m.h | 0;
      /* 【batch126】英雄解锁校验（服务端权威）：改了客户端数据也没用 ——
         · 0~3 正规军四位：随时可用
         · 5 闪电：**必须这个名字通关过剧情**（p.unlocks.lightning）
         · 4 蚀日者：解锁了才放行
         · 6 影月：默认开放（【batch158】）
         其它下标（越界 / 乱填）同样打回天狼。 */
      /* 【batch147】4 蚀日者 / 5 闪电 都是"解锁了才放行"（越界 / 乱填一律打回天狼） */
      /* 【模组】下标 7+ 是模组英雄（魅影等），放行；越界 / 乱填仍打回天狼 */
      if (hj < 0 || hj > 30) hj = HERO_SCOUT;
      else if (hj === HERO_ECLIPSE && !unlockGet(p.name, 'eclipse')) hj = HERO_SCOUT;
      else if (hj === HERO_LIGHTNING && !unlockGet(p.name, 'lightning')) hj = HERO_SCOUT;
      p.hero = hj;
    }
    if (typeof m.sh === 'number') p.sh = m.sh | 0;       // batch101：累计开火次数（别人据此判断"他刚开了一枪"）
  } else if (m.t === 'grav') {                    // 【模组·暗影黑洞】引力源：施法者把黑洞中心/范围/强度发给服务端，服务端转发同房其他人；受害者客户端自己往中心拉（位移本地，再经 t:'p' 广播，别人就看到被吸）
    const gx = +m.x || 0, gz = +m.z || 0;
    const gr = (typeof m.r === 'number' && m.r > 0) ? m.r : 14;
    const gf = (typeof m.f === 'number' && m.f > 0) ? m.f : 0.07;
    players.forEach(function (q) {
      if (q.id === p.id) return;                  // 不发给自己（施法者不会被自己的黑洞吸）
      if (mapOf(q) !== mapOf(p)) return;          // 只转发同房（房间钥匙）
      sendTo(q, { t: 'grav', x: gx, z: gz, r: gr, f: gf });
    });
  } else if (m.t === 'heal') {                     // 【模组·夜莺】歌声治疗：释放者上报治疗中心/半径/治疗量，服务端给同房范围内玩家回血（满血不治、倒地的会被扶起）
    const hx = +m.x || 0, hz = +m.z || 0;
    const hr = (typeof m.r === 'number' && m.r > 0) ? m.r : 7;
    const ha = (typeof m.a === 'number' && m.a > 0) ? m.a : 6;
    const hUs = (typeof m.us === 'number') ? m.us : 0;
    const onlyTeam = (+m.tm === 1);                  // 【batch173】SP 治疗：只奶自己人（不给对手回血）
    /* 【batch177】楼层判定：治疗云/复苏圈只奶**同一层**的人。
       以前只算平面距离 → 站在二楼放云，一楼的人照样被奶到（跨楼板回血）。
       只在报文带了 y 时才判（老模组不发 y → 行为不变，不会误伤）。q.y 是眼高，脚底 = q.y-2。 */
    const _hy = (typeof m.y === 'number' && isFinite(m.y)) ? m.y : null;
    players.forEach(function (q) {
      if (q.stale || !q.alive) return;
      if (mapOf(q) !== mapOf(p)) return;            // 只治疗同房（房间钥匙）
      if (onlyTeam && q !== p) {
        const pt = (typeof p.team === 'number' ? p.team : -1), qt = (typeof q.team === 'number' ? q.team : -1);
        if (!(pt >= 0 && pt === qt)) return;        // 爆能器：只奶同队；原版混战：只奶自己
      }
      const dx = q.x - hx, dz = q.z - hz;
      if (dx * dx + dz * dz > hr * hr) return;
      if (_hy !== null && Math.abs(((q.y || 2) - 2) - _hy) > ZONE_H) return;    // 【batch177】隔一层楼板不算
      healSrv(q, Math.round(ha * healMulFor(q)));   // batch100：白泽被动；【batch120】倒地的会被扶起
      if (hUs) sendTo(q, { t: 'unslow' });          // 安神谣：顺带解除减速
    });
  } else if (m.t === 'map') {                     // 【batch113】换房间：在菜单里点了另一张图
    const mid = normMapId(m.m);
    if (mid === mapIdOf(p)) { sendTo(p, { t: 'map', m: mid, same: 1 }); return; }   // 本来就在这张图：只回一句（【batch166】用地图 id 比）
    broadcast({ t: 'left', i: p.id, n: p.name }, p.id, mapOf(p));   // 旧房间：告诉别人他走了
    p.map = mid;
    /* 【batch167】爆能器：地图是房间钥匙的一部分 → 换图＝换房，准备状态清零（新房里要重新准备） */
    if (spikeIs(p)) { p.spikeReady = false; p.spikeAct = ''; }
    const sp = spawnState(p);                     // 新房间的出生点（按图选点、血拉满）
    const ps = [];
    players.forEach(function (q) { if (q.id !== p.id && mapOf(q) === mapOf(p)) ps.push(publicInfo(q)); });   // 【batch166】按房间钥匙
    sendTo(p, { t: 'map', m: mid, x: sp.x, z: sp.z, hp: MAX_HP, ps: ps });
    broadcast({ t: 'new', p: publicInfo(p), x: p.x, z: p.z }, p.id, mapOf(p));   // 【batch166】按房间钥匙广播
    /* 【batch184f-补4】进/换到火车站：服务端起一列权威列车，并把当前地图状态（列车+实体）下发给刚进的人 */
    if (mid === 'station') ensureRoomTrain(mapOf(p));
    sendWorldInit(p);        /* 【batch232】换图后同样要补发世界实体（以前只有 station 发） */
    pushRooms();
    log('换地图：' + (p.code || '') + ' ' + p.name + ' → 「' + mapNameOf(mid) + '」');
  } else if (m.t === 'spOv') {                      // 【batch172】蜂鸟无人机过载：命中远端玩家 → 一段时间无法开枪（只能近战）
    const _tg = players.get(m.i | 0);
    const _T = Math.max(500, Math.min(30000, (+m.T) || 10000));
    if (!_tg || !_tg.alive || _tg.id === p.id || !sameRoom(p, _tg) || p.downed) return;
    _tg.overloadUntil = Date.now() + _T;
    sendTo(_tg, { t: 'overload', dur: _T });                              // 本人：禁枪倒计时（刀不受限）
    broadcast({ t: 'hitsk', i: _tg.id }, undefined, mapOf(p));            // 所有人：头顶一圈命中环
  } else if (m.t === 'spCloak') {                    // 【batch173】SP·暗哨光学隐身：广播给同房其他人「他隐身了 / 现形了」，别人把他模型藏起来
    const _T = Math.max(0, Math.min(30000, (+m.T) || 0));
    p.cloakUntil = _T ? Date.now() + _T : 0;
    broadcast({ t: 'cloaked', i: p.id, dur: _T }, p.id, mapOf(p));      // 排除自己：自己本来就看不见自己
  } else if (m.t === 'spZone') {                    // 【batch173】SP 区域（火路/电网/治疗云/穹顶/掩体墙）：把「样子」转给同房其他人，别人看得见但不结算
    const _dur = Math.max(200, Math.min(3600000, (+m.dur) || 3000));   // 【batch176】掩体墙是永久的（上限 1 小时，别把它截成 30 秒）
    const _r = Math.max(0.3, Math.min(20, (+m.r) || 3));
    const _y = (typeof m.y === 'number' && isFinite(m.y)) ? Math.max(-50, Math.min(80, m.y)) : 0;   // 【batch177】透传高度
    broadcast({ t: 'spzone', k: String(m.k || 'fire'), x: +m.x || 0, z: +m.z || 0, y: _y, r: _r, dur: _dur, rot: +m.rot || 0 }, p.id, mapOf(p));
    recordWorldEnt(mapOf(p), 'spzone', { t: 'spzone', k: String(m.k || 'fire'), x: +m.x || 0, z: +m.z || 0, y: _y, r: _r, dur: _dur, rot: +m.rot || 0 }, _dur);   // 【batch184f-补4】登记：晚进者可见
  } else if (m.t === 'spSlow') {                    // 【batch173】电磁减速网 / 火路：技能减速（权威记账，客户端改数据也甩不掉）
    const _st = players.get(m.i | 0);
    const _T = Math.max(200, Math.min(15000, (+m.T) || 2000));
    if (!_st || !_st.alive || _st.id === p.id || !sameRoom(p, _st)) return;
    if (_st.adrenUntil && _st.adrenUntil > Date.now()) return;      // 肾上腺素期间免疫减速
    sendTo(_st, { t: 'slowed', dur: _T });
  } else if (m.t === 'spWallHit') {                  // 【batch174】打掩体墙：把伤害转给同房其他人，各自扣自己那份墙的血（谁先归零谁碎，画面一致）
    broadcast({ t: 'spwallhit', x: +m.x || 0, z: +m.z || 0, d: Math.max(1, Math.min(2000, (+m.d) || 1)) }, p.id, mapOf(p));
  } else if (m.t === 'train') {                      // 【batch184】列车受伤：服务端权威记账，同房所有人共享同一管血
    const _rk = mapOf(p); if (!_rk) return;
    const _d = Math.max(0, Math.min(500, (+m.d) || 0));   // 0 表示"刚刷车，拉取当前权威血量"（客户端刷车瞬间同步用）
    let _hp = roomTrainHp.has(_rk) ? roomTrainHp.get(_rk) : TRAIN_HP;
    _hp = Math.max(0, _hp - _d);
    roomTrainHp.set(_rk, _hp);
    broadcast({ t: 'trainHp', hp: _hp }, undefined, _rk);   // 全员（含自己）同步最新血量 → 一个人打、全场都能看到扣血
    if (_hp <= 0) {                                       // 归零即炸：先把"血已空"同步给全场，再广播炸车（谁打爆的别人也看得见）
      broadcast({ t: 'trainHp', hp: 0 }, undefined, _rk);
      roomTrainHp.set(_rk, TRAIN_HP);                      // 重置（服务端状态机随后重新刷车）
      trainResetSrv(_rk);                                  // 【batch184f-补4】服务端列车状态归零 → 下一班重新进站
      trainBroadcast(_rk);                                 // 同步给全场：列车已重置为 idle
      broadcast({ t: 'trainDestroy' }, undefined, _rk);
    }
  } else if (m.t === 'spwallclear') {                 // 【batch184】掩体墙被打爆：通知同房其他人把该位置的墙（自己的 / 别人的）一并撤掉
    broadcast({ t: 'spwallclear', x: +m.x || 0, z: +m.z || 0 }, p.id, mapOf(p));
  } else if (m.t === 'hit') {
    handleHit(p, m);
  } else if (m.t === 'tp') {                       // 【batch237】客户端主动开瞬移窗口（踩传送点 / 模组传送）
    /* 【batch238】限频 1.2 秒一次：以前连发就能一直开着窗口＝防瞬移形同虚设。
       地图传送点本身有 1 秒多的冷却，正常玩不会卡到这个上限。 */
    const _tpNow = Date.now();
    if (!p._tpReqAt || _tpNow - p._tpReqAt > 1200) { p._tpReqAt = _tpNow; p._tpUntil = _tpNow + 800; }
  } else if (m.t === 'meteor') {                   // 【batch236】流火 SP·天陨：起手落点（落地由服务端掐表触发）
    handleMeteor(p, m);
  } else if (m.t === 'aihit') {                   // 【batch227】本地 AI / 剧情 BOSS 打中玩家：客户端上报，纳入权威
    handleAiHit(p, m);
  } else if (m.t === 'chat') {                    // 【batch228】文字聊天：限长 + 同房广播
    handleChat(p, m);
  } else if (m.t === 'voice') {                   // 【batch228】语音开关（开始/停止说话）：同房广播
    if (p && !p.stale) broadcast({ t: 'voice', i: p.id, n: p.name, on: m.on ? 1 : 0 }, undefined, mapOf(p));
  } else if (m.t === 'skill') {                   // 英雄技能：广播给其他人播特效（投掷物把飞行参数带上）
    handleSkill(p, m);
  } else if (m.t === 'throwfx') {
    /* 【batch219】模组投掷物**飞行**同步：客户端把"模型编号 + 出生点 + 初速 + 生存秒数"发上来，
       转发给同房其他人按抛物线复现。以前模组英雄扔东西，别人那边什么都没有。
       纯视觉，不参与任何结算（伤害/落点仍由模组自己发 boom 之类）。 */
    broadcast({
      t: 'throwfx', i: p.id, c: (m.c | 0),
      x: +m.x || 0, y: +m.y || 0, z: +m.z || 0,
      vx: +m.vx || 0, vy: +m.vy || 0, vz: +m.vz || 0,
      d: Math.max(0.2, Math.min(8, (+m.d) || 1.4))
    }, p.id, mapOf(p));
  } else if (m.t === 'boom') {                    // 投掷物「引爆 / 落地」：这一刻才按真实落点结算
    handleBoom(p, m);
  } else if (m.t === 'portal') {                  // 【batch145】日蚀之门：一对门的位置，转发给同房间的其他人
    p._tpUntil = Date.now() + 1200;               // 【batch237】穿门＝合法瞬移
    const ok3 = function (v) {
      return Array.isArray(v) && v.length === 3 && isFinite(+v[0]) && isFinite(+v[1]) && isFinite(+v[2]);
    };
    if (ok3(m.a) && ok3(m.b)) {
      const _portalMsg = { t: 'portal', i: p.id,
                  a: [+m.a[0], +m.a[1], +m.a[2]], b: [+m.b[0], +m.b[1], +m.b[2]],
                  life: Math.max(1000, Math.min(30000, (+m.life) || 15000)) };
      broadcast(_portalMsg, p.id, mapOf(p));
      recordWorldEnt(mapOf(p), 'portal', _portalMsg, _portalMsg.life);   // 【batch184f-补4】登记：晚进者可见
    }
  } else if (m.t === 'trap') {                    // 【batch120】电荷陷阱吸附成功：只是"让别人也看得见这枚陷阱"
    /* 【batch141】把陷阱贴面的法线也中继出去 —— 不然别人那边只能"朝着固定方向"摆这个陷阱 */
    broadcast({ t: 'trap', x: +m.x || 0, y: +m.y || 0, z: +m.z || 0,
                nx: +m.nx || 0, ny: (m.ny === undefined ? 1 : +m.ny || 0), nz: +m.nz || 0 },
              p.id, mapOf(p));
    recordWorldEnt(mapOf(p), 'trap', { t: 'trap', x: +m.x || 0, y: +m.y || 0, z: +m.z || 0, nx: +m.nx || 0, ny: (m.ny === undefined ? 1 : +m.ny || 0), nz: +m.nz || 0 }, 30000);   // 【batch184f-补4】登记：晚进者可见
  } else if (m.t === 'spikeReady') {              // 【batch166】准备 / 取消准备
    if (spikeIs(p)) { p.spikeReady = !!m.on; spikeSync(mapOf(p)); }
    return;
  } else if (m.t === 'spikeStart') {              // 【batch166】队长点「开始游戏」（(要求全员已准备)）
    if (spikeIs(p)) {
      const _rk2 = mapOf(p), _S2 = spikeState(_rk2);
      if (_S2.leader === p.id) spikeStartRound(_rk2); else spikeSync(_rk2);
    }
    return;
  } else if (m.t === 'spikeCfg') {                // 【batch180】队长上报"自定义地图的爆能器点位"
    /* 模组地图是**客户端**加载的，服务端 SPIKE_MAP_CFG 里没有它。
       所以由队长把自己这张图声明的 sites/spike 上报过来，服务端校验后登记，整房共用。 */
    if (spikeIs(p)) {
      const _rkC = mapOf(p), _SC = spikeState(_rkC);
      if (_SC.leader === p.id) {                  // 只认队长的，防止别人乱改点位
        const midC = normMapId(m.m), okC = normSpikeCfg(m.cfg);
        if (midC && okC && !SPIKE_MAP_CFG[midC]) {  // 内置三张图不接受覆盖
          SPIKE_MAP_CFG[midC] = okC;
          log('爆能器：已登记自定义图「' + midC + '」→ 下包点 ' + okC.sites.length + ' 处');
        }
      }
    }
    return;
  } else if (m.t === 'spikeMap') {                // 【batch168】队长换图：整个房间一起换（所有人跟着走）
    if (spikeIs(p)) {
      const _rkM = mapOf(p), _SM = spikeState(_rkM);
      if (_SM.leader === p.id) {
        const mid2 = normMapId(m.m);
        if (mid2 !== _SM.map) {
          _SM.map = mid2;
          players.forEach(function (q) {
            if (mapOf(q) !== _rkM || !spikeIs(q)) return;
            q.map = mid2; q.spawnPt = null;           // 换图 → 按新图的出生点重放
            try { sendTo(q, { t: 'spikeMap', m: mid2 }); } catch (e) { }
            if (_SM.phase === 'prep' || _SM.phase === 'live' || _SM.phase === 'planted') {
              /* 已经在打：立刻把人放到新图的出生点（换图是**当场生效**，不是等下一回合） */
              const cfg2 = SPIKE_MAP_CFG[mid2] || SPIKE_MAP_CFG.classic;
              const sp2 = spikeSpawnPt(cfg2, q.team);   // 【batch169】固定出生点（不再随机）
              q.x = sp2[0]; q.z = sp2[1]; q.spawnPt = sp2;   /* 不再调 spawnState()：它会用随机出生点把这里覆盖掉 */
            }
            spikeTellYou(q);                          // 带上新出生点
          });
          if (typeof spikeCfg === 'function') { try { const _c9 = SPIKE_MAP_CFG[mid2] || SPIKE_MAP_CFG.classic; _SM.sites = _c9.sites ? _c9.sites.slice() : []; _SM.site = null; _SM.plantSite = -1; } catch (e) { } }
          log('爆能器房间换图：' + (_rkM) + ' → 「' + mapNameOf(mid2) + '」');
        }
      }
      spikeSync(_rkM);
    }
    return;
  } else if (m.t === 'spikeTeam') {               // 【batch166】在队伍界面里自己选阵营（加入进攻 / 防守）
    if (spikeIs(p) && (m.team === 0 || m.team === 1)) {
      p.team = m.team | 0;
      const _srk = mapOf(p), _S = spikeState(_srk);
      /* 【batch168】换完阵营**立刻**告诉本人（不然大厅里还显示"阵营：未选择"） */
      spikeTellYou(p);
      if (_S.phase === 'waiting' || _S.phase === 'over') spikeStartRound(_srk);   // 人数够就立刻开
      else spikeSync(_srk);
    }
    return;
  } else if (m.t === 'spike') {                   // 【batch166】爆能器：上报"我正在安放 / 拆除"；【batch168】扔出
    if (spikeIs(p)) {
      const _rkS = mapOf(p), _SS = spikeState(_rkS);
      /* 【batch168】把爆能器**扔出去**：落点由客户端算，服务端校验（距离 ≤30 米、坐标合法），
         不合规则直接丢在脚下。扔完 0.8 秒内自己捡不回来（防原地扔了立刻捡）。 */
      if (m.a === 'throw' && _SS.carrier === p.id && _SS.phase !== 'planted' && _SS.phase !== 'over') {
        let tx = Number(m.x), tz = Number(m.z);
        let okp = isFinite(tx) && isFinite(tz);
        if (okp) { const ax = tx - p.x, az = tz - p.z; if (ax * ax + az * az > 30 * 30) okp = false; }
        if (!okp) { tx = p.x; tz = p.z; }
        _SS.spikePos = { x: tx, z: tz };
        _SS.carrier = 0; _SS.dropBy = p.id; _SS.dropLock = Date.now() + 800;
        spikeSync(_rkS);
        return;
      }
      p.spikeAct = m.on ? String(m.a || '') : '';   // a: 'plant' 安放 | 'defuse' 拆除；on=0 = 松手
    }
    return;
  } else if (m.t === 'ping') {                    // 心跳：原样回一份时间戳，客户端据此显示实时延迟
    sendTo(p, { t: 'pong', ts: m.ts });
  } else if (m.t === 'name') {                    // 改名
    p.name = String(m.n || p.name).slice(0, 10);
  } else if (m.t === 'clear') {                   // 【batch126】剧情通关上报：把「闪电」永久记到这个名字上
    const k = String(m.k || '').slice(0, 16);
    /* 【batch147】lightning＝剧情通关；eclipse＝控制台指令解锁；off=1 表示取消 */
    if (k === 'lightning' || k === 'eclipse') {
      const off = !!m.off;
      const chg = unlockSet(p.name, k, off);
      if (chg) log(off ? ('【解锁】' + p.name + ' 取消了「' + k + '」')
                       : (k === 'lightning' ? ('【剧情】' + p.name + ' 通关了「追捕蚀日者」→ 永久解锁「闪电」')
                                            : ('【解锁】' + p.name + ' 解锁了「蚀日者」')));
      p.unlocks = unlockOf(p.name);
      sendTo(p, { t: 'unlocks', unlocks: p.unlocks });
    }
  } else if (m.t === 'hero') {                   // 【模组英雄】客户端换英雄：记录并广播给同房其他玩家
    if (typeof m.h === 'number' && m.h >= 0 && m.h <= 60) { p.hero = m.h | 0; }
    broadcast({ t: 'hero', i: p.id, h: p.hero }, p.id, mapOf(p));
  } else if (m.t === 'modsk') {                  // 【模组英雄】自定义技能事件：服务端不解释，原样转发给同房其他玩家（与内置英雄特效一致：客户端各自复现）
    const sk = String(m.k || '').slice(0, 24);
    if (sk) broadcast({ t: 'modsk', i: p.id, h: (typeof p.hero === 'number' ? p.hero : -1), k: sk, d: m.d }, p.id, mapOf(p));
  }
}

/* ------------------------------------------------------ 管理员：BAN / 控制台 */
function isBanned(cid, name) {
  const nm = normName(name);
  for (let i = 0; i < BANS.length; i++) {
    const b = BANS[i];
    if (cid && b.cid && b.cid === cid) return b;
    if (nm && b.name && b.name === nm) return b;
  }
  return null;
}
function banAdd(cid, name) {
  const nm = normName(name);
  if (!cid && !nm) return false;
  for (let i = 0; i < BANS.length; i++) {
    const b = BANS[i];
    if ((cid && b.cid === cid) || (nm && b.name === nm)) return false;      // 已经在名单里了
  }
  BANS.push({ cid: cid || '', name: nm || '', at: Date.now() });
  banSave();
  return true;
}
function banRemove(pred) {
  let hit = 0;
  for (let i = BANS.length - 1; i >= 0; i--) if (pred(BANS[i], i)) { BANS.splice(i, 1); hit++; }
  if (hit) banSave();
  return hit;
}
function banByCode(code) {
  let target = null;
  players.forEach(function (p) { if (p.id === code) target = p; });
  if (!target) { console.log('   [BAN] 没找到代号 ' + code + ' 的玩家（输入 list 看名单）'); return; }
  banAdd(target.cid, target.name);
  console.log('   [BAN] 已封禁并踢出：' + target.code + ' ' + target.name + '（想解封就输入 解封 ' + target.code + '）');
  try { wsSend(target.ws, JSON.stringify({ t: 'bye', why: 'banned' })); } catch (e) { }
  const sock = target.ws;
  setTimeout(function () { try { sock.destroy(); } catch (e) { } }, 120);
  dropPlayer(target.id);
}
// 解封：支持「在线代号」「名单序号」「名字」三种写法
function unbanKey(key) {
  key = String(key == null ? '' : key).trim();
  if (!key) return 0;
  let hit = 0;
  if (/^\d+$/.test(key)) {
    const n = parseInt(key, 10);
    let online = null;
    players.forEach(function (p) { if (p.id === n) online = p; });
    if (online) hit += banRemove(function (b) { return (!!online.cid && b.cid === online.cid) || (!!online.name && b.name === online.name); });
    if (!hit) hit += banRemove(function (b, i) { return i === n - 1; });    // 退而求其次：当作名单序号
  }
  if (!hit) { const nm = normName(key); hit += banRemove(function (b) { return b.name === nm; }); }
  return hit;
}
function consoleBans() {
  console.log('   —— 封禁名单（' + BANS.length + ' 条）——');
  if (!BANS.length) { console.log('   （空的）'); return; }
  BANS.forEach(function (b, i) {
    console.log('   [' + (i + 1) + '] ' + (b.name || '(无名)') + (b.cid ? ('   cid=' + b.cid) : ''));
  });
  console.log('   解封：解封 <序号> / 解封 <名字> / 解封 <在线代号>   （unban 同样可用）');
}
function consoleHelp() {
  console.log('');
  console.log('   —— 控制台命令 ——');
  console.log('   list / 名单        查看在线玩家（含代号）');
  console.log('   ban <代号>         踢出并封禁，例如： ban 3  （代号见玩家进出时打印的 #03）');
  console.log('   unban <代号|名字|序号>  解除封禁，让那个人重新进来（封禁会跨重启保留）');
  console.log('   bans / 封禁        查看封禁名单');
  console.log('   names / 名字       查看名字库（含身份码；名字永久唯一，重复的进不来）');
  console.log('   code <名字>        查某个名字的身份码（玩家换网址后忘了码，念给他听）');
  console.log('   locks / 解锁       查看谁通关过剧情（＝ 谁永久拥有「闪电」）');
  console.log('   unlock <名字>      手动给某个名字解锁「闪电」（玩家换了设备又没记身份码时救急）');
  console.log('   lock <名字>        收回某个名字的「闪电」');
  console.log('   free <名字>        释放某个名字，让它可以再被别人使用（也可写 释放 <名字>）');
  console.log('   注销 / 删除 <名字>  彻底注销一个名字（连身份码一起删，谁都能重新注册）');
  console.log('   解封 <代号|名字|序号>  同 unban：解除封禁，让他重新进来');
  console.log('   清空名字库 确认     把名字库全部注销（不带「确认」二字不会执行）');
  console.log('   flood / 防护       查看防挤爆状态（写成「防护 关」可临时关闭限流，「防护 开」恢复）');
  console.log('   net / 网络         查看连接质量（谁的数据积压了、丢了多少帧 —— 卡顿先查这里）');
  console.log('   help               显示本帮助');
  console.log('   mod / 模组         查看模组列表与启用状态（✅已启用 / ⬜未启用）');
  console.log('   mod on <名称>      开启某个模组（ mod on all 开启全部）');
  console.log('   mod off <名称>     关闭某个模组（ mod off all 关闭全部）');
  console.log('');
}

/* ===== 模组管理（黑窗口命令：mod / mod on <名> / mod off <名>） ===== */
function modRootDir() { return path.join(gameDir(), 'mode', '模组'); }   // 【batch182】模组实际在 多文件版/mode/ 下
function modListFilePath() { return path.join(modRootDir(), '载入清单.js'); }
function readEnabledModules() {
  try {
    const txt = fs.readFileSync(modListFilePath(), 'utf8');
    const mm = txt.match(/MOD_FILES\s*=\s*\[([^\]]*)\]/);
    if (!mm) return [];
    const quoted = mm[1].match(/['"]([^'"]+)['"]/g) || [];
    return quoted.map(function (s) { return s.replace(/^['"]|['"]$/g, ''); });
  } catch (e) { return []; }
}
function writeEnabledModules(arr) {
  const header = '// 本文件由服务端「模组管理」命令自动维护，请勿手动编辑；如需手动改下面的数组即可。\n';
  const body = 'window.MOD_FILES = [\n' + arr.map(function (f) { return "  '" + f + "',"; }).join('\n') + '\n];\n';
  fs.writeFileSync(modListFilePath(), header + body, 'utf8');
}
function modAvailablePool() {
  const dir = modRootDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function (f) {
    return /\.js$/i.test(f) && f !== '载入清单.js';
  }).map(function (f) { return f.replace(/\.js$/i, ''); }).sort();
}

/* ===== 【batch243】客户端模组核验（join 时） =====
   服务器只认「载入清单里启用 + 文件存在」的模组。客户端 join 时会上报本机真正加载的模组
   （文件名 + @id + 内容指纹），这里逐条对账：
     · 客户端有、服务器没有  → 拒绝进入（客户端要禁用这个模组再来）
     · 两边都有但指纹不同（且客户端版本和服务器一致）→ 视为"模组代码被改过"，也拒绝
     · 服务器有、客户端没报  → 只提示（多半是还没同步），不拦
   ⚠️ 指纹算法必须和 js/61_模组管理.js 的 `简哈希` 一模一样（FNV-1a 32 位）。 */
function 简哈希(s) {
  s = String(s || '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return ('00000000' + h.toString(16)).slice(-8);
}
function 模组身份(文, 名) {
  const m = /@id\s+([A-Za-z0-9_.\-]+)/.exec(文 || '') || /MOD_ID\s*=\s*['"]([A-Za-z0-9_.\-]+)['"]/.exec(文 || '');
  if (m && m[1]) return String(m[1]).toLowerCase();
  return String(名 || '').replace(/\.js$/i, '').toLowerCase();
}
let _模组表缓存 = { at: 0, t: null };
function 服务器模组表() {
  const now = Date.now();
  if (_模组表缓存.t && now - _模组表缓存.at < 5000) return _模组表缓存.t;
  const 允许 = {}, 停用 = {};
  try {
    const 启用 = readEnabledModules();
    启用.forEach(function (base) {
      const n = String(base) + '.js';
      try {
        const 文 = fs.readFileSync(path.join(modRootDir(), n), 'utf8');
        允许[模组身份(文, n)] = { n: n, h: 简哈希(文) };
      } catch (e) { }                                    // 清单里有、磁盘上没有：忽略
    });
    modAvailablePool().forEach(function (base) {
      const n = base + '.js';
      const k = 模组身份('', n);
      if (允许[k]) return;
      try { if (fs.statSync(path.join(modRootDir(), n)).isFile()) 停用[k] = n; } catch (e) { }
    });
  } catch (e) { }
  _模组表缓存 = { at: now, t: { 允许: 允许, 停用: 停用 } };
  return _模组表缓存.t;
}
function 校验客户端模组(mods, cv) {
  const 表 = 服务器模组表();
  const 允许 = 表.允许;
  const 允许id = Object.keys(允许);
  const 有模组 = 允许id.length > 0 || Object.keys(表.停用).length > 0;
  const 同版本 = String(cv || '') === String(SRV_VER);
  const 短名 = function (n) { return String(n || '').replace(/\.js$/i, ''); };

  /* 没上报清单：老客户端（< 1.7.14）放行，新客户端必须报（否则等于关掉了自检） */
  if (!Array.isArray(mods)) {
    if (有模组 && verCmp(String(cv || '0.0.0'), '1.7.14') >= 0) {
      return { bad: true, reason: 'nomods', extra: [], tampered: [], missing: 允许id.map(function (k) { return 短名(允许[k].n); }) };
    }
    return { bad: false };
  }

  const extra = [], tampered = [], seen = {};
  const 上限 = Math.min(mods.length, 64);
  for (let i = 0; i < 上限; i++) {
    const it = mods[i];
    if (!it || typeof it !== 'object') continue;
    const 名 = String(it.n || '').slice(0, 120);
    const id = String(it.id || it.n || '').toLowerCase().replace(/\.js$/i, '').slice(0, 80);
    if (!id) continue;
    seen[id] = 1;
    const 服 = 允许[id];
    if (!服) { extra.push(短名(名) || id); continue; }
    if (同版本 && it.h && String(it.h) !== String(服.h)) tampered.push(短名(名) || id);
  }
  const missing = [];
  允许id.forEach(function (k) { if (!seen[k]) missing.push(短名(允许[k].n)); });

  return { bad: (extra.length > 0 || tampered.length > 0), extra: extra, tampered: tampered, missing: missing };
}
function modInfo(f) {
  const fp = path.join(modRootDir(), f + '.js');
  if (!fs.existsSync(fp)) return { missing: true };
  const c = fs.readFileSync(fp, 'utf8');
  const kinds = [];
  if (/ModLoader\.addHero\b/.test(c)) kinds.push('英雄');
  if (/ModLoader\.addMap\b/.test(c)) kinds.push('地图');
  if (/ModLoader\.addEnemyType\b/.test(c)) kinds.push('敌人');
  if (/ModLoader\.setPlayerModel\b/.test(c)) kinds.push('玩家建模');
  if (/ModLoader\.addSkill\b/.test(c)) kinds.push('自定义技能');
  let label = '';
  const hm = c.match(/name\s*:\s*['"]([^'"]+)['"]/);
  if (/addHero/.test(c) && hm) label = '角色：' + hm[1];
  else if (/addMap/.test(c) && hm) label = '地图：' + hm[1];
  else if (/addEnemyType/.test(c) && hm) label = '敌人：' + hm[1];
  return { missing: false, kinds: kinds, label: label };
}
function consoleMods() {
  const pool = modAvailablePool();
  const enabled = readEnabledModules();
  if (!pool.length) { console.log('   [模组] 没有发现任何模组文件（mode/模组/ 下没有 .js）'); return; }
  console.log('   可用模组（✅已启用 / ⬜未启用）：');
  pool.forEach(function (f) {
    const on = enabled.indexOf(f) >= 0;
    const info = modInfo(f);
    const tag = info.missing ? '  ⚠文件缺失' :
      ((info.kinds.length ? '  → ' + info.kinds.join('/') : '') + (info.label ? ('  〔' + info.label + '〕') : ''));
    console.log('     ' + (on ? '✅' : '⬜') + ' ' + f + tag);
  });
  const miss = enabled.filter(function (f) { return pool.indexOf(f) < 0; });
  if (miss.length) console.log('   [模组] 以下启用项磁盘上无对应文件：' + miss.join('、'));
  console.log('   开关命令： mod on <名称>    mod off <名称>    （on all / off all 批量）');
}
function consoleModEnable(arg) {
  let enabled = readEnabledModules();
  if (!arg) { console.log('   [模组] 用法： mod on <名称>   或  mod on all'); return; }
  if (arg.toLowerCase() === 'all') {
    enabled = modAvailablePool().slice();
    writeEnabledModules(enabled);
    console.log('   [模组] 已开启全部 ' + enabled.length + ' 个模组，刷新浏览器生效');
    return;
  }
  if (modAvailablePool().indexOf(arg) < 0 && !fs.existsSync(path.join(modRootDir(), arg + '.js'))) {
    console.log('   [模组] 未找到模组「' + arg + '」，输入  mod  查看全部');
    return;
  }
  if (enabled.indexOf(arg) >= 0) { console.log('   [模组] 「' + arg + '」已经是启用状态'); return; }
  enabled.push(arg);
  writeEnabledModules(enabled);
  console.log('   [模组] 已开启「' + arg + '」（共 ' + enabled.length + ' 个），刷新浏览器生效');
}
function consoleModDisable(arg) {
  let enabled = readEnabledModules();
  if (!arg) { console.log('   [模组] 用法： mod off <名称>   或  mod off all'); return; }
  if (arg.toLowerCase() === 'all') {
    writeEnabledModules([]);
    console.log('   [模组] 已关闭全部模组，刷新浏览器生效');
    return;
  }
  const i = enabled.indexOf(arg);
  if (i < 0) { console.log('   [模组] 「' + arg + '」本来就没启用'); return; }
  enabled.splice(i, 1);
  writeEnabledModules(enabled);
  console.log('   [模组] 已关闭「' + arg + '」（共 ' + enabled.length + ' 个），刷新浏览器生效');
}

function consoleFlood() {
  const now = Date.now();
  console.log('   —— 防挤爆（' + (floodOn ? '已开启' : '⚠ 已关闭') + '）——');
  console.log('   当前连接   ' + sockCount + ' / ' + FLOOD.MAX_SOCKETS
    + '      在线玩家 ' + players.size + ' / ' + MAX_PLAYERS);
  let n = 0;
  coolMap.forEach(function (t, ip) {
    if (t > now) { n++; console.log('   冷却中     ' + ip + '   还剩 ' + Math.ceil((t - now) / 1000) + ' 秒'); }
  });
  if (!n) console.log('   冷却中     （没有）');
  console.log('   累计触发   连接限流 ' + fStat.conn + ' / 握手超时 ' + fStat.hello + ' / 消息超频 ' + fStat.msg
    + ' / 超大包 ' + fStat.bytes + ' / 网页限流 ' + fStat.http + ' / 冷却 ' + fStat.cool);
  console.log('   说明       只做临时限流；冷却 ' + Math.round(FLOOD.COOL_MS / 1000)
    + ' 秒后自动解除，不会写进封禁名单');
  console.log('   临时关掉   防护 关    （要开大派对或排查问题时用；防护 开 恢复）');
}
/* 【batch126】谁通关过剧情（＝ 谁有「闪电」） */
function consoleLocks() {
  const arr = unlockList();
  console.log('   —— 剧情解锁（' + arr.length + ' 人已通关「追捕蚀日者」）——');
  if (!arr.length) { console.log('   （暂无。打完剧情模式就会自动记在这里）'); return; }
  arr.forEach(function (n) {
    const rec = nameOwnerOf(n);
    const on = nameOnline(n);
    console.log('   ' + n + '   身份码 ' + ((rec && rec.code) || '?') + (on ? '   （在线）' : ''));
  });
  console.log('   想手动给谁解锁：unlock <名字>     想收回：lock <名字>');
  console.log('   说明：蚀日者本季不开放（下赛季「救出蚀日者」）；解锁只认剧情通关，不存在别的获取途径。');
}
function consoleList() {
  console.log('   —— 在线玩家（全场 ' + players.size + ' 人；按图分房，每张图上限 ' + MAX_PLAYERS + ' 人）——');
  if (!players.size) { console.log('   （暂无）'); return; }
  players.forEach(function (p) {
    const ago = Math.round((Date.now() - p.lastSeen) / 1000);
    console.log('   ' + p.code + '  ' + p.name + '   〔' + mapNameOf(p.map) + '〕   击杀 ' + p.kills + ' / 死亡 ' + p.deaths
      + (p.stale ? '   [疑似掉线，等他 ' + Math.round((GONE_MS - (Date.now() - p.staleAt)) / 1000) + ' 秒]'
        : ('   ' + ago + ' 秒前有响应'))
      + (p.reconn ? ('   （重连过 ' + p.reconn + ' 次）') : ''));
  });
}
/* 连接质量：排查「卡顿」用。待发字节多 = 这条链路吃不下，服务器只能丢帧（画面一顿一顿）。 */
function consoleNet() {
  console.log('   —— 连接质量（' + players.size + ' 人在线，广播 ' + Math.round(1000 / TICK_MS) + 'Hz）——');
  if (!players.size) { console.log('   （暂无）'); return; }
  let bad = 0;
  players.forEach(function (p) {
    const q = (p.ws && typeof p.ws.writableLength === 'number') ? p.ws.writableLength : 0;
    const ago = Math.round((Date.now() - p.lastSeen) / 1000);
    if (q > 64 * 1024) bad++;
    console.log('   ' + p.code + '  ' + p.name
      + '   待发 ' + Math.round(q / 1024) + ' KB'
      + '   最后响应 ' + ago + ' 秒前'
      + (p.reconn ? ('   重连 ' + p.reconn + ' 次') : '')
      + (p.stale ? '   [疑似掉线，等他回来]' : ''));
  });
  console.log('   累计：因积压丢帧 ' + fStat.skip + ' 次，保活 PING ' + fStat.ping + ' 个');
  console.log(bad
    ? ('   ⚠ 有 ' + bad + ' 个人的待发数据积压超过 64KB —— 他们那边网络吃不下，画面会顿。')
    : '   ✓ 没有人积压（网络都还跟得上）');
  console.log('   丢帧是故意丢的：宁可少发一帧位置，也不让连接被撑死然后掉线。');
}
function consoleNames() {
  console.log('   —— 名字库（共 ' + NAMES.length + ' 个，名字唯一）——');
  if (!NAMES.length) { console.log('   （还没有人取过名字）'); return; }
  const online = new Set();
  players.forEach(function (p) { if (p.cid) online.add(p.cid); });
  NAMES.slice(-40).forEach(function (r) {
    const isOn = (r.cids || []).some(function (c) { return online.has(c); });
    console.log('   ' + r.n + '   身份码 ' + (r.code || '?') + (isOn ? '   （在线）' : ''));
  });
  console.log('   某个玩家换了网址 / 换了设备回不来？把身份码告诉他：code <名字>');
  console.log('   想彻底删掉一个名字（之后谁都能重新注册）：注销 <名字>');
}
function handleConsole(line) {
  let m = /^\s*ban\s*#?\s*(\d+)\s*$/i.exec(line);
  if (m) { banByCode(parseInt(m[1], 10)); return; }
  m = /^\s*(list|\u540d\u5355)\s*$/i.exec(line);
  if (m) { consoleList(); return; }
  m = /^\s*(unban|解封)\s+(.+?)\s*$/i.exec(line);
  if (m) {
    const cnt = unbanKey(m[2]);
    console.log(cnt ? ('   [BAN] 已解封 ' + cnt + ' 条：' + m[2] + '（他可以重新进来了）') : ('   [BAN] 名单里没找到：' + m[2] + '（输入 bans 看名单）'));
    return;
  }
  if (/^\s*(unban|解封)\s*$/i.test(line)) { consoleBans(); return; }
  if (/^\s*(bans|\u5c01\u7981)\s*$/i.test(line)) { consoleBans(); return; }
  m = /^\s*(names|\u540d\u5b57)\s*$/i.exec(line);
  if (m) { consoleNames(); return; }
  /* 【batch126】剧情解锁：查看 / 手动给 / 手动收回（玩家换了设备又没记身份码时救急用） */
  if (/^\s*(locks|unlocks|\u89e3\u9501)\s*$/i.test(line)) { consoleLocks(); return; }
  m = /^\s*(unlock|\u89e3\u9501)\s+(\S+)\s*$/i.exec(line);
  if (m) {
    const r = nameOwnerOf(m[2]);
    if (!r) { console.log('   [解锁] 名字库里没有「' + normName(m[2]) + '」（输入 names 看名字库）'); return; }
    console.log(unlockSet(r.n, 'lightning')
      ? ('   [解锁] 已给「' + r.n + '」解锁「闪电」')
      : ('   [解锁] 「' + r.n + '」本来就已经解锁了「闪电」'));
    return;
  }
  m = /^\s*(lock|\u56de\u6536)\s+(\S+)\s*$/i.exec(line);
  if (m) {
    const r = nameOwnerOf(m[2]);
    if (!r) { console.log('   [解锁] 名字库里没有「' + normName(m[2]) + '」'); return; }
    console.log(unlockSet(r.n, 'lightning', true)
      ? ('   [解锁] 已收回「' + r.n + '」的「闪电」（剧情成绩还在本地，他一联网就会补报回来）')
      : ('   [解锁] 「' + r.n + '」本来就没解锁「闪电」'));
    return;
  }
  m = /^\s*code\s+(\S+)\s*$/i.exec(line);
  if (m) {
    const rec = nameOwnerOf(m[1]);
    console.log(rec ? ('   [名字库] 「' + rec.n + '」的身份码是： ' + rec.code + '（把这串念给玩家，他在取名界面输入就能取回名字）')
      : ('   [名字库] 没有找到名字「' + normName(m[1]) + '」'));
    return;
  }
  if (/^\s*(注销|删除|delete|unreg)\s*$/i.test(line)) {
    console.log('   [名字库] 用法：注销 <名字>   （把该名字连身份码一起删掉，之后谁都能重新注册）');
    return;
  }
  m = /^\s*(free|释放|注销|删除|delete|unreg)\s+(\S+)\s*$/i.exec(line);
  if (m) {
    const hard = /^(注销|删除|delete|unreg)$/i.test(m[1]);
    const cnt = nameFree(m[2]);
    if (!cnt) { console.log('   [名字库] 没找到名字「' + normName(m[2]) + '」（输入 names 看名字库）'); return; }
    console.log(hard
      ? ('   [名字库] 已注销名字「' + normName(m[2]) + '」（连身份码一起删了，任何人都能重新注册）')
      : ('   [名字库] 已释放名字「' + normName(m[2]) + '」，别人可以用了'));
    return;
  }
  m = /^\s*(flood|防护)\s*(开|关|on|off)?\s*$/i.exec(line);
  if (m) {
    const v = String(m[2] || '').toLowerCase();
    if (v === '关' || v === 'off') { floodOn = false; console.log('   [防护] 已关闭防挤爆（现在不限流了，小心被刷爆）'); }
    else if (v === '开' || v === 'on') { floodOn = true; console.log('   [防护] 已开启防挤爆'); }
    else consoleFlood();
    return;
  }
  if (/^\s*(网络|延迟|net|ping)\s*$/i.test(line)) { consoleNet(); return; }
  if (/^\s*(help|\?|\u5e2e\u52a9)\s*$/i.test(line)) { consoleHelp(); return; }
  m = /^\s*(mod|模组)\s+list\s*$/i.exec(line);
  if (m) { consoleMods(); return; }
  m = /^\s*(mod|模组)\s+(on|enable|开启|启用)\s+(.+?)\s*$/i.exec(line);
  if (m) { consoleModEnable(m[3].trim()); return; }
  m = /^\s*(mod|模组)\s+(off|disable|关闭|关掉)\s+(.+?)\s*$/i.exec(line);
  if (m) { consoleModDisable(m[3].trim()); return; }
  if (/^\s*(mod|模组)\s*$/i.test(line)) { consoleMods(); return; }
  m = /^\s*(清空名字库|名字库清空|clearnames)\s*(\S*)\s*$/i.exec(line);
  if (m) {
    const yn = String(m[2] || '').toLowerCase();
    if (yn !== '确认' && yn !== 'yes' && yn !== 'confirm') {
      console.log('   [名字库] 这条命令会把全部 ' + NAMES.length + ' 个名字一次注销掉。');
      console.log('   [名字库] 确定的话，输入： 清空名字库 确认');
      return;
    }
    const n = nameWipeAll();
    console.log('   [名字库] 名字库已清空，共注销 ' + n + ' 个名字');
    return;
  }
  console.log('   [控制台] 无法识别的命令：' + line + '（输入 help 查看用法）');
}
try {
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', function (d) {
    let buf = String(d), i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r/g, '').trim();
      buf = buf.slice(i + 1);
      if (line) { try { handleConsole(line); } catch (e) { console.log('   [控制台] 出错：' + e.message); } }
    }
  });
  process.stdin.on('error', function () { });
} catch (e) { }

/* ------------------------------------------------------------------ 世界心跳 */
let _wsPingAt = 0;
let _roomsPushAt = 0;                           // 【batch113】上一次推送"每张图几个人"的时间
/* ============ 【batch184f-补4】火车站列车「服务端权威」状态机 ============ */
/* 逻辑状态在服务端按 TICK_MS 推进；客户端只按服务端下发的 st/head 渲染。常量镜像自客户端 trainTick。 */
function ensureRoomTrain(rk) {
  if (!rk) return null;
  if (!roomTrain.has(rk)) {
    roomTrain.set(rk, { st: 'idle', ti: 0, dir: 1, head: -90, cd: TRAIN_MIN_CD + Math.random() * (TRAIN_MAX_CD - TRAIN_MIN_CD), hp: TRAIN_HP, blink: 0, _hit: {} });
  }
  return roomTrain.get(rk);
}
function trainResetSrv(rk) {                       // 被打爆后：换新一班车（idle + 满血）
  if (!rk) return;
  roomTrain.set(rk, { st: 'idle', ti: 0, dir: 1, head: -90, cd: TRAIN_MAX_CD, hp: TRAIN_HP, blink: 0, _hit: {} });
}
function trainBroadcast(rk) {
  const t = roomTrain.get(rk); if (!t) return;
  /* 【batch186 修复】⚠ 这里原来写的是 `t: 'train'` + 后面又写了一次 `t: 倒计时` ——
     同一个对象里 `t` 出现两次，**后者覆盖前者**，客户端收到的 m.t 是数字而不是 'train'，
     `if(m.t==='train')` 永远不成立 → 客户端从不建车模（多人下"火车看不见、但会撞人"）。
     倒计时字段改名 `ct`，消息类型 `t` 保持唯一。 */
  broadcast({ t: 'train', st: t.st, ti: t.ti, dir: t.dir, head: Math.round(t.head * 100) / 100, ct: Math.round(t.t * 100) / 100, hp: (roomTrainHp.has(rk) ? roomTrainHp.get(rk) : TRAIN_HP) }, undefined, rk);
}
function trainBroadcastPos(rk) {                    // 行驶中每 tick 同步车头位置（让客户端平滑跟随）
  const t = roomTrain.get(rk); if (!t) return;
  broadcast({ t: 'trainpos', ti: t.ti, head: Math.round(t.head * 100) / 100 }, undefined, rk);
}
function trainHitPlayers(rk, t, tz) {               // 撞玩家（服务端权威）：用玩家上报的 x/z/y
  const tail = t.head - t.dir * TRAIN_LEN;
  const x0 = Math.min(t.head, tail) - 0.7, x1 = Math.max(t.head, tail) + 0.7;
  players.forEach(function (p) {
    if (mapOf(p) !== rk || !p.alive) return;
    if ((p.x || 0) < x0 || (p.x || 0) > x1) return;
    if (Math.abs((p.z || 0) - tz) > 2.0) return;
    const py = (typeof p.y === 'number') ? p.y : 2;
    if (py < 0.1 || py > 3.6) return;              // 车顶(≈3.9)以上安全，避免误伤站在车顶的人
    if (t._hit && t._hit[p.id]) return;             // 同一趟车每人只判定一次（与客户端 hitP 一致）
    if (!t._hit) t._hit = {}; t._hit[p.id] = 1;
    /* 【batch188】先算击飞落点（服务端权威坐标），报文一起下发 —— 客户端按它摆位，
       否则人留在车体里，等列车停靠（车厢变实体障碍）就彻底出不来了。 */
    const out = trainKnockOut(p, t, tz);
    p.x = out.x; p.z = out.z; p._tpUntil = Date.now() + 1500;   // 【batch237】击飞是合法的"瞬移"，服务器位置也跟上
    sendTo(p, { t: 'trainHit', dir: t.dir, dmg: TRAIN_HIT_DMG, px: out.x, pz: out.z, vy: 6.5 });
    try { applyDamage(null, p, TRAIN_HIT_DMG, false, true); } catch (e) { }   // 【batch184f-补4】服务端权威扣血（护盾/穹顶照样减伤），客户端只播击飞特效
  });
}
/* 【batch188】把玩家从车体里挪到轨道外侧（服务端权威坐标；返回落点，供 trainHit/push 报文使用） */
function trainKnockOut(p, t, tz) {
  const sgn = ((p.z || 0) >= tz) ? 1 : -1;                  // 就近一侧甩出去
  const dir = (t && t.dir) ? t.dir : 1;
  p.x = clampNum((p.x || 0) + dir * TRAIN_FLY_FWD, -STATION_LIMIT.x, STATION_LIMIT.x);
  p.z = clampNum(tz + sgn * TRAIN_FLY_OUT, -STATION_LIMIT.z, STATION_LIMIT.z);
  return { x: p.x, z: p.z };
}
/* 【batch188】列车停靠瞬间的兜底：谁还站在车体里就推出去（多人下客户端不再跑 trainDwellSettle，
   服务端必须接管，否则"被撞飞失败 / 卡在车里"的人永远出不来）。车顶上的人（眼高>3.6）不动。 */
function trainSettleSrv(rk, t, tz) {
  const tail = t.head - t.dir * TRAIN_LEN;
  const x0 = Math.min(t.head, tail) - 1, x1 = Math.max(t.head, tail) + 1;
  players.forEach(function (p) {
    if (mapOf(p) !== rk || !p.alive) return;
    const py = (typeof p.y === 'number') ? p.y : 2;
    if (py < 0.1 || py > 3.6) return;                       // 站在车顶：安全，别把人推下去
    if (Math.abs((p.z || 0) - tz) > TRAIN_HALF_W + 0.6) return;   // 已在车体侧面之外
    if ((p.x || 0) < x0 || (p.x || 0) > x1) return;         // 不在车身长度范围内
    const out = trainKnockOut(p, t, tz);
    p.x = out.x; p.z = out.z; p._tpUntil = Date.now() + 1500;   // 【batch237】同理
    sendTo(p, { t: 'push', x: out.x, z: out.z, why: 'train' });
  });
}
function trainTickSrv(rk, nowMs) {
  const t = roomTrain.get(rk); if (!t) return;
  /* 【batch186 修复·计时】原来固定用 TRAIN_SRV_DT(=0.05) 推进：
     进程一忙 setInterval 实际只跑到 8Hz 左右，列车倒计时就被拉长 2~3 倍
     （表现＝"火车迟迟不来"）。改成按真实流逝时间推进，最多一次补 0.5 秒，
     避免卡顿后一帧冲过站。 */
  const _now = nowMs || Date.now();
  let dt = t._last ? (_now - t._last) / 1000 : TRAIN_SRV_DT;
  if (!(dt > 0)) dt = TRAIN_SRV_DT;
  if (dt > 0.5) dt = 0.5;
  t._last = _now;
  if (t.st === 'idle') {
    t.cd -= dt;
    if (t.cd <= 0) {
      const ok = []; for (let i = 0; i < STATION_TRACKS.length; i++) ok.push(i);  // 残骸追踪未做：默认全可用
      t.ti = ok[(Math.random() * ok.length) | 0];
      t.dir = Math.random() < 0.5 ? 1 : -1;
      t.st = 'warn'; t.t = TRAIN_WARN; t.blink = 0; t.hp = TRAIN_HP; t._hit = {};
      trainBroadcast(rk);
    }
    return;
  }
  if (t.st === 'warn') {
    t.t -= dt; t.blink += dt;
    if (t.t <= 0) { t.head = (t.dir > 0) ? -90 : 90; t.st = 'run'; trainBroadcast(rk); }
    return;
  }
  if (t.st === 'run' || t.st === 'depart') {
    let sp = TRAIN_SPEED * dt;
    if (t.st === 'depart') { t.depT = (t.depT || 0) + dt; sp = TRAIN_SPEED * dt * Math.min(1, t.depT / 2.5); }
    t.head += t.dir * sp;
    if (t.st === 'run' && (t.dir > 0 ? t.head >= TRAIN_STOP : t.head <= -TRAIN_STOP)) {
      t.head = t.dir * TRAIN_STOP; t.st = 'dwell'; t.t = TRAIN_DWELL; t.depT = 0;
      try { trainSettleSrv(rk, t, STATION_TRACKS[t.ti].z); } catch (e) { }   // 【batch188】停靠前把还卡在车体里的人推出去
      trainBroadcast(rk); return;
    }
    if (t.st === 'depart' && Math.abs(t.head) > 96) { t.st = 'idle'; t.cd = TRAIN_MAX_CD; t._hit = {}; trainBroadcast(rk); return; }
    trainBroadcastPos(rk);
    trainHitPlayers(rk, t, STATION_TRACKS[t.ti].z);
    return;
  }
  if (t.st === 'dwell') {
    t.t -= dt;
    if (t.t <= 0) { t.st = 'depart'; t.depT = 0; trainBroadcast(rk); }
    return;
  }
}
/* 现存世界实体（投掷物/技能区域/门/陷阱）登记表：晚进者进房时由 sendWorldInit 重放 */
function recordWorldEnt(rk, type, msg, durMs) {
  if (!rk) return;
  if (!worldEnts.has(rk)) worldEnts.set(rk, []);
  worldEnts.get(rk).push({ type: type, msg: msg, until: Date.now() + (durMs || 30000) });
}
function sendWorldInit(p) {                          // 晚进者进房：把当前列车状态 + 现存实体一次性发过去
  const rk = mapOf(p); if (!rk) return;
  const t = roomTrain.get(rk);
  /* 【batch186 修复】同上：倒计时用 ct，别跟消息类型 t 撞名，否则晚进者收不到列车状态 */
  if (t) sendTo(p, { t: 'train', st: t.st, ti: t.ti, dir: t.dir, head: Math.round(t.head * 100) / 100, ct: Math.round(t.t * 100) / 100, hp: (roomTrainHp.has(rk) ? roomTrainHp.get(rk) : TRAIN_HP) });
  const ents = worldEnts.get(rk);
  if (ents && ents.length) {
    const now = Date.now();
    for (let i = 0; i < ents.length; i++) {
      if (ents[i].until <= now) continue;
      try {
        const m2 = JSON.parse(JSON.stringify(ents[i].msg));
        const 剩 = Math.max(200, ents[i].until - now);      // 按剩余时间重发，客户端自毁
        if (typeof m2.dur === 'number') m2.dur = 剩;        // spzone / portal：时长字段叫 dur
        if (typeof m2.left === 'number') m2.left = 剩;      // 【batch233】boom 类持久效果：字段叫 left
        sendTo(p, m2);
      } catch (e) { }
    }
  }
}

setInterval(function () {
  const now = Date.now();
  // 每 15 秒发一轮 WebSocket PING 帧：让 NAT / 隧道网关的连接表保持活跃
  // （这一条对"隧道下老是掉线"帮助最大 —— 空闲被中间层丢表是隐性杀手）
  if (now - _wsPingAt >= FLOOD.WS_PING_MS) {
    _wsPingAt = now;
    players.forEach(function (p) { if (!p.stale) wsPing(p.ws); });
  }
  const lists = {};                               // 【batch113】按房间分组下发（不同图的人不能互相看见）
  const stale = [];
  const gone = [];
  // 每 5 秒把"每张图几个人"推给所有人（客户端大厅显示用；进/离/换图时另有即时推送）
  if (now - _roomsPushAt >= 5000) { _roomsPushAt = now; pushRooms(); }
  players.forEach(function (p) {
    if (p.stale) {                                  // 已判「疑似掉线」：先留着等他回来
      if (now - p.staleAt > GONE_MS) gone.push(p.id);
      return;                                       // 也不广播给别人（省带宽；别人眼里他就是离线了）
    }
    if (now - p.lastSeen > TIMEOUT_MS) {
      // 【重要】**不要立刻删人**！
      // 直接删的后果：手机切一下后台 / 隧道抖几秒回来，他就变成"新玩家"——
      // 编号变了、位置被重置到出生点、别人看到他凭空消失又出现。
      // 现在只标记 + 掐掉旧 socket，宽限 GONE_MS 内他带着同一个 cid 回来就能**无缝接回原样**。
      stale.push(p.id);
      p.stale = true; p.staleAt = now;
      log('疑似掉线：' + (p.code || '') + ' ' + p.name + '（' + Math.round((now - p.lastSeen) / 1000)
        + ' 秒没上报；保留 ' + Math.round(GONE_MS / 1000) + ' 秒等他重连）');
      try { p.ws.destroy(); } catch (e) { }
      return;
    }
    if (!spikeIs(p) && !p.alive && p.respawnAt && now >= p.respawnAt) {   /* 【batch166】爆能器：回合制 —— 阵亡**不复活**，等下回合开始才满血返回 */
      const sp = spawnState(p);          // 内部已把 p.x/p.y/p.z 挪到重生点、hp 拉满、alive=true
      sendTo(p, { t: 'respawn', x: sp.x, z: sp.z, hp: MAX_HP });
      // 关键：重生点必须随 revive 一起广播。
      // 否则别的客户端只知道"他活了"、坐标还是死亡点 → 会看到尸体原地复活再滑过去，
      // 那具"尸体"还照样挨枪（服务端认为人已经活了），于是"打尸体伤到复活后的人"。
      broadcast({ t: 'revive', i: p.id, x: p.x, y: p.y, z: p.z, hp: MAX_HP }, undefined, mapOf(p));
      log('重生：' + p.name);
    }
    // 英雄技能：过期的状态顺手清掉（护盾 / 反射 / 堡垒 / 冲锋 / 肾上腺素 / 治疗力场）
    if (p.shieldUntil && now > p.shieldUntil) p.shieldUntil = 0;
    if (p.reflectUntil && now > p.reflectUntil) p.reflectUntil = 0;
    if (p.fortifyUntil && now > p.fortifyUntil) p.fortifyUntil = 0;
    if (p.rushUntil && now > p.rushUntil) p.rushUntil = 0;
    if (p.adrenUntil && now > p.adrenUntil) p.adrenUntil = 0;
    if (p.healAuraUntil && now > p.healAuraUntil) { p.healAuraUntil = 0; p.healAcc = 0; }
    const _mk = mapOf(p);
    if (!lists[_mk]) lists[_mk] = [];
    lists[_mk].push({
      // 【省流量】这里不再带 n（名字）：名字只在进场 welcome / new 广播时发一次，
      // 客户端 netEnsurePlayer 有名字就保留。中文名一个字 3 字节，每帧白花十几字节 × 人数 × 20Hz。
      i: p.id,
      x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100,
      r: Math.round(p.yaw * 1000) / 1000, p: Math.round(p.pitch * 1000) / 1000,
      a: p.an, w: p.w, wk: p.wk, ln: p.ln, nv: p.nv || 0, na: p.na || 0, h: p.hp, k: p.kills, d: p.deaths, al: p.alive ? 1 : 0,
      /* 【batch216】换弹 / 检视进度：两位小数就够了（别人按进度摆动画，不需要毫秒精度） */
      rl: Math.round((p.rl || 0) * 100) / 100, iv: Math.round((p.iv || 0) * 100) / 100,
      sh: p.sh || 0,                                        // batch101：开枪序号（变了＝刚开火 → 别人播枪口火光 + 曳光）
      gh: (p.ghostUntil && p.ghostUntil > now) ? 1 : 0      // 【batch158】虚化/遁入暗影标记：别人据此把他的模型藏起来（只剩一团小暗影）
    });
  });
  for (let _si = smokeZones.length - 1; _si >= 0; _si--) if (smokeZones[_si].until <= now) smokeZones.splice(_si, 1);   // batch100：过期烟团清掉
  healAuraTick(now);                                  // 白泽治疗力场：给半径内的活人按节奏回血
  fortifyZoneTick(now);                               // 镇岳堡垒阵地：给圈内的人续减伤 buff
  downedTick(now);                                    // 【batch120】倒地计时：50 秒没人治 → 死亡
  eclipseTick(now);                                   // 【batch120】蚀日：黑日的周期强光脉冲
  orbTick(now);                                       // 【batch120】闪电光球：电区持续放电
  shadowTick(now);                                    // 【batch158】影月：暗影毒圈持续毒蚀
  /* 【batch184f-补4】火车站列车服务端状态机推进 + 世界实体过期清理 */
  roomTrain.forEach(function (_st, _rk) { try { trainTickSrv(_rk, now); } catch (e) { } });
  worldEnts.forEach(function (arr, _rk) {
    if (!arr || !arr.length) return;
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].until <= now) arr.splice(i, 1);
  });
  for (const id of gone) {
    const p = players.get(id);
    if (!p) continue;
    log('玩家离开：' + (p.code || '') + ' ' + p.name + '（掉线超过 ' + Math.round(GONE_MS / 1000) + ' 秒，已移除）');
    dropPlayer(id);
  }
  // 【batch113】按房间分别下发：全都在宽限期里的房间就不发空列表（免得客户端把所有模型都清掉）
  for (const _m in lists) if (lists[_m].length) broadcast({ t: 'st', l: lists[_m] }, undefined, _m);   // 全都在宽限期里就不发空列表（免得客户端把所有模型都清掉）
}, TICK_MS);

/* -------------------------------------------- 防挤爆：定期清理统计表（防内存缓慢膨胀） */
setInterval(function () {
  const now = Date.now();
  const prune = function (map) {
    map.forEach(function (v, k) {
      if (Array.isArray(v)) {
        const f = v.filter(function (t) { return now - t < FLOOD.WIN_MS; });
        if (f.length) map.set(k, f); else map.delete(k);
      } else if (v <= now) map.delete(k);
    });
  };
  prune(connHist); prune(httpHist); prune(coolMap);
}, FLOOD.WIN_MS);

/* ------------------------------------------------------------------ HTTP 服务 */
const server = http.createServer(function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');   // 允许 file:// 打开的本地页面读取 /libs
  let url = (req.url || '/').split('?')[0];

  /* 防挤爆·第三道闸：网页请求限流。
     隧道暴露后最容易被刷的就是 /pc、/mobile（每份 150KB 起），
     它会同时吃掉你的上行带宽和隧道的并发额度。正常刷新远远用不到这个上限。 */
  if (floodOn) {
    const s = srcIP(req, req.socket);
    const cap = s.sure ? FLOOD.HTTP_PER_WIN : FLOOD.HTTP_PER_WIN_PROXY;
    const now = Date.now();
    let hist = (httpHist.get(s.ip) || []).filter(function (t) { return now - t < FLOOD.WIN_MS; });
    hist.push(now);
    httpHist.set(s.ip, hist);
    if (hist.length > cap) {
      fStat.http++;
      logThrottled('http', '⛔ 防挤爆：' + s.ip + ' 网页请求过频（' + hist.length + ' 次/'
        + (FLOOD.WIN_MS / 1000) + ' 秒），已限流');
      res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '10' });
      return res.end('请求太频繁了，请过一会儿再刷新。');
    }
  }

  /* ---- 首页：选择界面（多文件版 / 电脑端 / 手机端）----------------------------
     【batch136】用户："拆分版的服务器没有选择手机端和电脑端的界面"。
     上一版把 / 直接改成发游戏本体，等于把原来的导航页弄丢了 —— 朋友拿到网址后
     既看不到入口，也不知道该用哪个地址（同 WiFi？装了 Tailscale？隧道？）。
     现在：/ = 导航页（三个入口 + 所有可用地址），/play = 多文件版本体。 */
  if (url === '/' || url === '/index.html') return landingPage(req, res);

  if (url === '/play' || url === '/multi') return sendFile(res, path.join(DIR, 'index.html'));
  if (url === '/spike') return sendFile(res, path.join(DIR, 'spike.html'));   /* 【batch166】爆能器独立版（spike.html） */

  if (url.indexOf('/lib/') === 0 || url.indexOf('/js/') === 0) {
    /* 文件名是中文的，浏览器发过来是 %E5%89%8D... 这种转义形式，必须先解码 */
    let rel;
    try { rel = decodeURIComponent(url.replace(/^\/+/, '')); }
    catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('400 路径编码有问题');
    }
    const abs = path.resolve(DIR, rel);
    /* 目录穿越防护：拼出来的路径必须仍在 多文件版/ 里面 */
    if (abs !== DIR && abs.indexOf(DIR + path.sep) !== 0) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('403');
    }
    return sendFile(res, abs);
  }
  if (url === '/modes' || url === '/模式') return modesPage(req, res);   /* 【batch166】玩法模式选择页 */

  /* 【模组系统】mode/ 下的加载器和各模组文件（含中文目录名「模组」）。
     浏览器请求形如 /mode/%E6%A8%A1%E7%BB%84/...，必须先解码再拼路径。
     复用 /lib/ /js/ 的目录穿越防护，保证不会越出服务端根目录之外。 */
  if (url.indexOf('/mode/') === 0) {
    let rel;
    try { rel = decodeURIComponent(url.replace(/^\/+/, '')); }
    catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('400 路径编码有问题');
    }
    const mBase = gameDir();                            // 【batch182】mode/ 实际在 多文件版/ 下
    const abs = path.resolve(mBase, rel);
    if (abs !== mBase && abs.indexOf(mBase + path.sep) !== 0) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('403');
    }
    return sendFile(res, abs);
  }

  if (url === '/pc' || url === '/电脑版') {
    /* 【batch-武器选择】/pc 现在直接发「多文件版」本体（与 /play 完全一致）。
       旧的「电脑版」单文件已冻结、不再合入 B 键武器选择 / 模组等新功能，
       若继续发它，玩家连 /pc 会拿到旧代码、新功能全部失效（正是"B 弹不出界面"的根因）。
       项目只发展多文件版+服务器端，原电脑版文件仍可单独双击打开离线玩。
       【batch182】这份服务端跑在 服务器/ 里，DIR 下没有 index.html（旧写法发 404）——
       指向 ROOT/多文件版/index.html；生成器复制到 多文件版/ 后 ROOT 仍解出同一份文件。 */
    return sendFile(res, path.join(ROOT, '多文件版', 'index.html'));
  }

  if (url === '/mobile' || url === '/手机版') {
    try {
      const c = clientHtml(CLIENT_MB);
      if (!c.patched) log('警告：手机版里没找到 three.js 的 CDN 链接，将走外网加载');
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      return res.end(c.html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('读取手机版失败：' + e.message + '\n请确认 手机版\\枪战游戏_手机版.html 存在。');
    }
  }

  /* 【batch182】多文件版的静态资源：/pc 现在发的是 多文件版/index.html，
     页面按相对路径引 lib/（three.js） js/（各分片） mode/（模组加载器）。
     没有这几条路由，玩家打开 /pc 页面能出、脚本全 404 —— 就是一片空白。
     目录穿越防护与上面 /mode/ 同一套：拼出来的路径必须仍在 多文件版/ 里。 */
  if (url.indexOf('/lib/') === 0 || url.indexOf('/js/') === 0 || url.indexOf('/mode/') === 0) {
    let rel;
    try { rel = decodeURIComponent(url.replace(/^\/+/, '')); }
    catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('400 路径编码有问题');
    }
    const mfBase = path.join(ROOT, '多文件版');
    const abs = path.resolve(mfBase, rel);
    if (abs !== mfBase && abs.indexOf(mfBase + path.sep) !== 0) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('403');
    }
    return sendFile(res, abs);
  }

  if (url === '/libs/three.r128.min.js') {
    const local = path.join(DIR, 'lib', 'three.r128.min.js');
    if (fs.existsSync(local)) return sendFile(res, local);
    return ensureThree(function (ok) {
      if (ok) return sendFile(res, THREE_FILE);
      res.writeHead(302, { Location: THREE_CDN }); res.end();
    });
  }

  if (url === '/status') {                         // 简易状态查询（调试用）
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      players: players.size, tunnel: tunnelUrl,
      maps: roomCounts(),                                        // 【batch113】每张图各几个人（客户端大厅直接读它）
      ver: SRV_VER, min: SRV_VER_MIN,                            // 【batch229】版本分化：客户端可读它展示/自查
      list: [...players.values()].map(publicInfo)
    }));
  }

  /* 【batch226】图标：浏览器会自动来要 /favicon.ico；页面 <link> 里还要 图标.png。
     文件名是中文的，浏览器发过来是转义形式，先解码再对。 */
  {
    let u2 = url;
    try { u2 = decodeURIComponent(url); } catch (e) { }
    if (u2 === '/favicon.ico' || u2 === '/图标.ico') {
      const f = path.join(gameDir(), '图标.ico');
      if (fs.existsSync(f)) return sendFile(res, f);
    }
    if (u2 === '/图标.png' || u2 === '/favicon.png') {
      const f = path.join(gameDir(), '图标.png');
      if (fs.existsSync(f)) return sendFile(res, f);
    }
  }

  /* ==================== 【batch225】模组接口 ====================
     客户端「设置 → 🧩 模组管理」和联机时的自动同步都靠这几条：

       GET  /api/mods             → {ok:1, mods:[{n,s,t}]}  列 mode/模组/*.js
       GET  /api/mod?n=xx.js      → 源码文本（application/javascript）
       POST /api/mod/save?n=xx.js → body 就是源码 → {ok:1} / {ok:0,err}
       POST /api/mod/del?n=xx.js  → {ok:1}

     为什么用 POST + text/plain：不带 application/json 就不会触发 CORS 预检，
     file:// 打开的本体页面、安卓 / 桌面客户端壳子都能直接调。

     安全（别小看：这是往服务器磁盘写任意 JS 的口子）：
       · 文件名必须过白名单正则，不许带路径分隔符，不许 ..，不许写 载入清单.js
       · 落盘路径 resolve 之后必须仍在 mode/模组/ 里面
       · 单文件 512KB 上限，超了直接断开，不做半截写入
       · 只允许 .js（不收 .html/.bat，免得变成任意文件上传） */
  const MOD_DIR = path.join(gameDir(), 'mode', '模组');
  const MOD_NAME_OK = /^[\u4e00-\u9fa5A-Za-z0-9_\- .()（）]{1,48}\.js$/;
  /* 【batch228】资产文件名白名单：同样的字符规则，扩展名限定为玩家自定义资产用的这些 */
  const ASSET_NAME_OK = /^[\u4e00-\u9fa5A-Za-z0-9_\- .()（）]{1,48}\.(mp4|mp3|ogg|wav|png|jpg|jpeg|webm|m4a|aac|flac)$/i;
  const MOD_MAX = 512 * 1024;
  function modPath(n) {
    n = String(n || '');
    if (!MOD_NAME_OK.test(n)) return null;
    if (/\.\./.test(n)) return null;
    if (n === '载入清单.js') return null;              // 清单归游戏自己管
    const abs = path.resolve(MOD_DIR, n);
    if (abs.indexOf(path.resolve(MOD_DIR) + path.sep) !== 0) return null;
    return abs;
  }
  function modJson(res, o) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(o));
  }
  function modListSrv() {
    let out = [];
    /* 【batch226】on＝是否在载入清单里（服务端黑窗口 mod on/off 维护的就是它）。
       客户端只加载 on=1 的：不然清单里没有的模组也会被加载，mod off 形同虚设。 */
    const enabled = readEnabledModules().map(function (n) { return String(n) + '.js'; });
    try {
      fs.readdirSync(MOD_DIR).forEach(function (n) {
        if (!/\.js$/i.test(n)) return;
        if (n === '载入清单.js') return;
        if (!MOD_NAME_OK.test(n)) return;              // 教程 / zip 之类一律不列
        try {
          const st = fs.statSync(path.join(MOD_DIR, n));
          if (!st.isFile()) return;
          out.push({ n: n, s: st.size, t: Math.round(st.mtimeMs / 1000), on: enabled.indexOf(n) >= 0 ? 1 : 0 });
        } catch (e) { }
      });
    } catch (e) { }
    out.sort(function (a, b) { return String(a.n).localeCompare(String(b.n), 'zh'); });
    return out;
  }
  /* 【batch228】自定义资产：玩家放在 mode/模组/ 下的 mp4（闪光特效）/ mp3·ogg·wav（主菜单 BGM）/
     png·jpg（背景）。这些不是 js 模组，单独列一个 assets 数组给客户端。 */
  function assetListSrv() {
    let out = [];
    const ok = /\.(mp4|mp3|ogg|wav|png|jpg|jpeg|webm|m4a|aac|flac)$/i;
    try {
      fs.readdirSync(MOD_DIR).forEach(function (n) {
        if (!ok.test(n)) return;
        if (!ASSET_NAME_OK.test(n)) return;
        try {
          const st = fs.statSync(path.join(MOD_DIR, n));
          if (!st.isFile()) return;
          out.push({ n: n, s: st.size, t: Math.round(st.mtimeMs / 1000) });
        } catch (e) { }
      });
    } catch (e) { }
    return out;
  }
  if (url === '/api/mods') return modJson(res, { ok: 1, mods: modListSrv(), assets: assetListSrv() });

  if (url === '/api/mod' && req.method === 'GET') {
    const n = new URL(req.url, 'http://x').searchParams.get('n') || '';
    const abs = modPath(n);
    if (!abs) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('文件名不合法'); }
    return fs.readFile(abs, 'utf8', function (err, txt) {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('没有这个模组'); }
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(txt);
    });
  }

  if (url === '/api/mod/save' && req.method === 'POST') {
    const n = new URL(req.url, 'http://x').searchParams.get('n') || '';
    const abs = modPath(n);
    if (!abs) { return modJson(res, { ok: 0, err: '文件名不合法（只能是中文/字母/数字，并以 .js 结尾）' }); }
    let buf = '', 超 = false;
    req.setEncoding('utf8');
    req.on('data', function (c) {
      if (超) return;
      buf += c;
      if (buf.length > MOD_MAX) {
        超 = true; buf = '';
        modJson(res, { ok: 0, err: '模组太大了（上限 512KB）' });
        try { req.destroy(); } catch (e) { }
      }
    });
    req.on('end', function () {
      if (超) return;
      if (!buf.trim()) return modJson(res, { ok: 0, err: '内容是空的' });
      try {
        if (!fs.existsSync(MOD_DIR)) fs.mkdirSync(MOD_DIR, { recursive: true });
        fs.writeFileSync(abs, buf, 'utf8');
        log('📦 装了一个模组：' + n + '（' + Math.round(buf.length / 1024) + 'KB）');
        modJson(res, { ok: 1, s: buf.length });
      } catch (e) { modJson(res, { ok: 0, err: '写入失败：' + e.message }); }
    });
    req.on('error', function () { });
    return;
  }

  if (url === '/api/mod/del' && req.method === 'POST') {
    const n = new URL(req.url, 'http://x').searchParams.get('n') || '';
    const abs = modPath(n);
    if (!abs) return modJson(res, { ok: 0, err: '文件名不合法' });
    try {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
      log('🗑 删掉了一个模组：' + n);
      return modJson(res, { ok: 1 });
    } catch (e) { return modJson(res, { ok: 0, err: '删除失败：' + e.message }); }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404');
});

/* ------------------------------------------------------------------ WS 升级 */
server.on('upgrade', function (req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || !/websocket/i.test(req.headers['upgrade'] || '')) { socket.destroy(); return; }

  /* 防挤爆·第一道闸：总连接数 / 单 IP 并发数 / 单 IP 新建速率。
     超限就直接回 503，连 WebSocket 都不建立（早拒绝 = 省内存和省 CPU）。 */
  let _ip = rawIP(socket), _counted = false;
  if (floodOn) {
    const info = srcIP(req, socket);
    _ip = info.ip;
    const now = Date.now();
    const deny = function (why) {
      fStat.conn++;
      logThrottled('gate', '⛔ 防挤爆：' + _ip + ' 的连接被拒（' + why + '）');
      try {
        socket.end('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 10\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      } catch (e) { }
    };
    const left = coolLeft(_ip);
    if (left > 0) return deny('正在冷却，还剩 ' + Math.ceil(left / 1000) + ' 秒');
    if (sockCount >= FLOOD.MAX_SOCKETS) return deny('服务器连接数已满 ' + sockCount + '/' + FLOOD.MAX_SOCKETS);
    const capN = info.sure ? FLOOD.PER_IP : FLOOD.PER_IP_PROXY;
    const capR = info.sure ? FLOOD.RATE : FLOOD.RATE_PROXY;
    const cur = liveIPs.get(_ip) || 0;
    if (cur >= capN) {
      punish(_ip, '同一 IP 同时连了太多条（' + cur + '/' + capN + '）');
      return deny('同一 IP 连接过多 ' + cur);
    }
    let hist = (connHist.get(_ip) || []).filter(function (t) { return now - t < FLOOD.WIN_MS; });
    hist.push(now);
    connHist.set(_ip, hist);
    if (hist.length > capR) {
      punish(_ip, '短时间新建连接太快（' + hist.length + ' 次/' + (FLOOD.WIN_MS / 1000) + ' 秒）');
      return deny('新建连接过频 ' + hist.length);
    }
    liveIPs.set(_ip, cur + 1);
    sockCount++;
    _counted = true;
  }

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  );
  socket.setNoDelay(true);

  const onMsg = function (txt) { try { handleMsg(socket, txt); } catch (e) { log('消息处理异常：' + e.message); } };
  /* 【batch228】语音：二进制帧 = [4 字节说话人玩家 id][音频数据]，原样转给同房其他人 */
  const onBin = function (payload) {
    try {
      /* 【batch229】语音帧上限放宽到 32KB：100ms 的 opus 切片偶尔超 4KB，之前用 4096 卡
         会把正常语音帧当"小包防挤爆"直接丢掉（或更早被 wsParser 断开）。 */
      if (!payload || payload.length < 5 || payload.length > FLOOD.VOICE_MAX_BYTES) return;
      const from = players.get(socket._pid | 0);
      if (!from || from.stale || !from.alive) return;
      /* ⚠️ 别按 room 过滤发送方：原版模式根本没有房号（room=''），
         一滤就把所有人挡了。房号/地图的一致性放在下面的循环里逐人比。 */
      players.forEach(function (q) {
        if (q.id === from.id || q.stale || !q.ws) return;
        if (mapOf(q) !== mapOf(from) || q.room !== from.room) return;         // 只同房
        /* ⚠️ 别查 q.ws.readyState：服务端是裸 TCP socket，没有这个属性（恒 undefined，
           一查就把所有人滤掉）。连接有效性由 wsSendBin 内部的 destroyed/writable 兜。 */
        try { wsSendBin(q.ws, payload); } catch (e) { }
      });
    } catch (e) { }
  };
  const parse = wsParser(onMsg, function () { closeIt(); }, onBin);
  let closed = false;
  function closeIt() {
    if (closed) return; closed = true;
    if (socket._helloTimer) { clearTimeout(socket._helloTimer); socket._helloTimer = null; }
    if (_counted) {                                  // 把连接计数还回去
      _counted = false;
      const c = liveIPs.get(_ip) || 0;
      if (c > 1) liveIPs.set(_ip, c - 1); else liveIPs.delete(_ip);
      sockCount = Math.max(0, sockCount - 1);
    }
    if (socket._pid) {
      // 只清理「这条连接」对应的玩家：重连时旧连接被踢掉，不能把已接手的新会话一起删了
      const p = players.get(socket._pid);
      if (p && p.ws === socket) dropPlayer(socket._pid);
    }
    try { socket.destroy(); } catch (e) { }
  }
  /* 防挤爆·第二道闸：连上以后迟迟不进场（不发 join）→ 断开。
     否则有人开一堆空连接就能把连接表占满，真玩家反而挤不进来。 */
  socket._helloTimer = setTimeout(function () {
    if (closed || socket._pid) return;
    fStat.hello++;
    logThrottled('hello', '⛔ 防挤爆：一条连接连上 ' + Math.round(FLOOD.HELLO_MS / 1000) + ' 秒没进场，已断开');
    closeIt();
  }, FLOOD.HELLO_MS);

  socket.on('data', parse);
  socket.on('error', closeIt);
  socket.on('close', closeIt);
  socket.on('end', closeIt);
});

/* ------------------------------------------------------------------ 启动 */
function startListen() {
  server.listen(PORT, '::', function () {   // 双栈：同时监听 IPv4 与 IPv6，支持朋友通过公网IPv6直连
    nameDbLoad();
    banLoad();
    const ips = lanIPs();
    const ip = ips[0] || 'localhost';
    /* 【batch169】把实际监听端口写进文件，让隧道脚本永远跟真实端口走
       —— 避免「端口被占 → 服务端静默跳到 8766，而隧道还死盯 8765」导致远程连不上 */
    try {
      const _pf = String(PORT);
      const _base = DIR || __dirname;
      [ _base, path.join(_base, '..', '服务器') ].forEach(function (d) {
        try { fs.writeFileSync(path.join(d, '实际端口.txt'), _pf + '\r\n', 'utf8'); } catch (e) { }
      });
    } catch (e) { }
    const ti = readTunnel();           // 隧道可能比服务端先开：启动时就认一次
    tunnelUrl = ti.url; tunnelPermanent = ti.permanent;
    console.log('');
    // ===== 模组系统自检：扫描 mode/ 目录，把「已启用」的模组打印到这个黑窗口 =====
    try {
      const modRoot = modRootDir();          // 【batch182】走 gameDir()，别在 服务器/ 下找不到就报未启用
      console.log('----------------------------------------------------------');
      console.log('   [模组系统] mode/ 已挂载（中文目录「模组」支持）');
      if (!fs.existsSync(modRoot)) {
        console.log('   [模组系统] 未找到 mode/模组 目录（模组功能未启用）');
      } else {
        const listFile = path.join(modRoot, '载入清单.js');
        let enabled = [];
        if (fs.existsSync(listFile)) {
          const txt = fs.readFileSync(listFile, 'utf8');
          const mm = txt.match(/MOD_FILES\s*=\s*\[([^\]]*)\]/);
          if (mm) {
            const quoted = mm[1].match(/['"]([^'"]+)['"]/g) || [];
            enabled = quoted.map(function (s) { return s.replace(/^['"]|['"]$/g, ''); });
          }
        }
        if (!enabled.length) {
          console.log('   [模组系统] 载入清单为空，没有启用任何模组');
        } else {
          console.log('   [模组系统] 已启用 ' + enabled.length + ' 个模组文件：');
          enabled.forEach(function (f) {
            const fp = path.join(modRoot, f + (/\.js$/i.test(f) ? '' : '.js'));
            let info = '';
            if (fs.existsSync(fp)) {
              const c = fs.readFileSync(fp, 'utf8');
              const kinds = [];
              if (/ModLoader\.addHero\b/.test(c)) kinds.push('英雄');
              if (/ModLoader\.addMap\b/.test(c)) kinds.push('地图');
              if (/ModLoader\.addEnemyType\b/.test(c)) kinds.push('敌人');
              if (/ModLoader\.setPlayerModel\b/.test(c)) kinds.push('玩家建模');
              if (/ModLoader\.addSkill\b/.test(c)) kinds.push('自定义技能');
              const hm = c.match(/name\s*:\s*['"]([^'"]+)['"]/);
              const label = /addHero/.test(c) && hm ? ('角色：' + hm[1]) :
                            (/addMap/.test(c) && hm ? ('地图：' + hm[1]) :
                            (/addEnemyType/.test(c) && hm ? ('敌人：' + hm[1]) : ''));
              info = (kinds.length ? ' → ' + kinds.join('/') : '') + (label ? ('  〔' + label + '〕') : '');
            }
            console.log('      · ' + f + info);
          });
          console.log('   [模组系统] 打开游戏后，选人/选图界面会显示模组内容（带「🧩 模组」标记）');
        }
      }
      console.log('----------------------------------------------------------');
      console.log('   [模组系统] 黑窗口输入「mod」可查看/开关模组（无需手改文件）');
    } catch (eMod) {
      console.log('   [模组系统] 自检出错：' + eMod.message);
    }
    console.log('==========================================================');
    console.log('   枪战突击 · 局域网对战服务器  已启动');
    console.log('----------------------------------------------------------');
    console.log('   [版本]  ' + SRV_VER + '（客户端版本需大版本相同且不低于 ' + SRV_VER_MIN + ' 才能进）');
    console.log('   [PORT]  ' + PORT);
    console.log('   [本机]  http://localhost:' + PORT + '/pc');
    console.log('   [PC]    http://' + ip + ':' + PORT + '/pc');
    console.log('   [PHONE] http://' + ip + ':' + PORT + '/mobile');
    console.log('   [INDEX] http://' + ip + ':' + PORT + '/');
    console.log('   [公网]  ' + (tunnelUrl
      ? tunnelUrl + (tunnelPermanent ? '   ← 固定网址（不会变）' : '')
      : '未检测到隧道（想要一个不会变的网址：双击「启动永久隧道.bat」）'));
    console.log('----------------------------------------------------------');
    console.log('   · 手机连同一个 WiFi / 热点后，输入上面的 PHONE 地址');
    console.log('   · 服务端不生成 AI 敌人：玩家与玩家互为敌人');
    console.log('   · 关掉这个窗口 = 关闭服务器');
    console.log('   · 上限 ' + MAX_PLAYERS + ' 人；输入 list 看名单，ban <代号> 踢人');
    console.log('   · 名字永久唯一：撞名会被挡在门外；names 看名字库，code <名字> 查身份码');
    console.log('   · 掉线容忍：20 秒没心跳才判掉线，再宽限 45 秒等你回来（重连无缝接回原位）');
    console.log('   · 注销名字：注销 <名字> 彻底删掉（谁都能重新注册）；清空名字库 确认 全部清空');
    console.log('   · 防挤爆：单 IP 最多 ' + FLOOD.PER_IP + ' 条连接；连上 ' + Math.round(FLOOD.HELLO_MS / 1000)
      + ' 秒不进场会被断开；冷却 ' + Math.round(FLOOD.COOL_MS / 1000) + ' 秒自动解除（不封人）');
    console.log('   · 看防护状态：输入 防护       （流量太大被误伤时可临时「防护 关」）');
    console.log('   · 固定网址：双击「启动永久隧道.bat」= Tailscale Funnel，网址永久不变、重启电脑自动恢复');
    console.log('==========================================================');
    if (ips.length > 1) console.log('   其他网卡地址：' + ips.join('  '));

    // 隧道比服务端后开也要能认出来：每 2 秒看一眼（只在状态变化时打印）
    if (!startListen._tunnelTimer) startListen._tunnelTimer = setInterval(tunnelCheck, 2000);
    consoleHelp();
    console.log('');
    ensureThree(function (ok) { if (ok) log('three.js 就绪（本地缓存，内网可离线玩）'); });
  });
}

server.on('error', function (e) {
  if (e.code === 'EADDRINUSE') {
    // 端口被占：自动往后找下一个可用端口，不再直接退出（这样双击 BAT 永远能开起来）
    if (portTries < 10) {
      const busy = PORT;
      portTries++;
      PORT = BASE_PORT + portTries;
      console.log('   [提示] 端口 ' + busy + ' 已被别的程序占用，自动改用 ' + PORT + ' ...');
      console.log('   [注意] 若你开了「永久隧道」，请在本服务端完全启动后重开一次隧道（双击 启动永久隧道.bat），');
      console.log('           它会自动读取「实际端口.txt」指向 ' + PORT + '，否则远程玩家仍连到旧的 ' + busy + ' 端口。');
      setTimeout(startListen, 80);
      return;
    }
    console.log('');
    console.log('!! 端口 ' + BASE_PORT + ' ~ ' + PORT + ' 全都被占用，无法启动。');
    console.log('   可以手动指定其它端口： node 服务端.js 9000');
  } else {
    console.log('!! 服务端错误：' + e.message);
    process.exit(1);
  }
});

startListen();

process.on('SIGINT', function () { console.log('\n服务器已关闭。'); process.exit(0); });
