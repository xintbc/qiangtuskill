/* 同步资源版本号.js —— 把 index.html / spike.html 里 `?v=x.y.z` 统一成 js/02 的 GAME_VER
 *
 * 为什么必须有这一步：
 *   客户端「本地服务.c」和 Node 服务端对 .js/.css 都发
 *   `Cache-Control: public, max-age=31536000, immutable`（一年不过期、不用再问）。
 *   这是为了让玩家不用每次进游戏重下 1.6MB 分片。
 *   代价：只要 URL 里的 ?v= 不变，WebView2 / 浏览器就永远用缓存里的旧代码 ——
 *   升了版本、改了 js，客户端画面却一点没变（1.9.41 踩过）。
 *
 * 用法：
 *   node 工具/同步资源版本号.js          只检查，打印哪些文件不是当前版本
 *   node 工具/同步资源版本号.js --写     真正改文件
 */
const fs = require('fs');
const path = require('path');

const 根 = path.resolve(__dirname, '..', '..');
const 多文件 = path.join(根, '多文件版');

/* ---- 1. 从 js/02 读当前版本 ---- */
const 状态文件 = path.join(多文件, 'js', '02_状态键位与粒子.js');
const 状态源 = fs.readFileSync(状态文件, 'utf8');
const m = 状态源.match(/GAME_VER\s*=\s*['"]([0-9]+\.[0-9]+\.[0-9]+)['"]/);
if (!m) {
  console.error('✗ 没能从 js/02_状态键位与粒子.js 读到 GAME_VER');
  process.exit(1);
}
const 版本 = m[1];

/* ---- 2. 要处理的 html（存在才处理） ---- */
const 目标 = [
  path.join(多文件, 'index.html'),
  path.join(多文件, 'spike.html'),
  path.join(多文件, '客户端', '游戏', 'index.html'),
  path.join(多文件, '客户端', '游戏', 'spike.html'),
  path.join(多文件, '手机版安卓', 'app', 'src', 'main', 'assets', 'index.html'),
  path.join(多文件, '手机版安卓', 'app', 'src', 'main', 'assets', 'spike.html'),
];

const 写 = process.argv.includes('--写');
let 有差异 = 0;

for (const f of 目标) {
  if (!fs.existsSync(f)) continue;
  const 原 = fs.readFileSync(f, 'utf8');
  const 旧版本们 = new Set([...原.matchAll(/\?v=([0-9]+\.[0-9]+\.[0-9]+)/g)].map(x => x[1]));
  if (!旧版本们.size) {
    console.log('  跳过（没有 ?v=）', path.relative(根, f));
    continue;
  }
  const 新 = 原.replace(/(\?v=)[0-9]+\.[0-9]+\.[0-9]+/g, '$1' + 版本);
  const 处 = (原.match(/\?v=[0-9]+\.[0-9]+\.[0-9]+/g) || []).length;
  const 旧 = [...旧版本们].join('/');
  if (新 === 原) {
    console.log('  ✓ 已是最新', path.relative(根, f), `(${处} 处 ${版本})`);
  } else {
    有差异++;
    if (写) {
      fs.writeFileSync(f, 新, 'utf8');
      console.log('  ✎ 已改', path.relative(根, f), `${旧} → ${版本}，共 ${处} 处`);
    } else {
      console.log('  ✗ 版本不对', path.relative(根, f), `${旧} → 应为 ${版本}，共 ${处} 处`);
    }
  }
}

if (!有差异) {
  console.log(`\n全部指向 ${版本}，没有需要改的。`);
} else if (!写) {
  console.log(`\n有 ${有差异} 个文件版本号不同步。加 --写 执行修正。`);
  process.exitCode = 2;
} else {
  console.log(`\n已同步 ${有差异} 个文件到 ${版本}。注意：还要把改动复制到客户端/安卓副本（或重跑打包）。`);
}
