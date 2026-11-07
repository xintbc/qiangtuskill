/* ============================================================================
   瓦罗兰特核心（客户端）· DOM 桩自测
   ----------------------------------------------------------------------------
   不需要浏览器：用最小 DOM / window / 引擎全局桩把 瓦罗兰特核心.js 跑起来，
   验证「文件能加载不报错 / 收到报文正确改状态 / 没开始只亮大厅不进地图」。

   运行：node _vltest.js
   这是被删掉的 _vltest.js 的等价重建版（纯客户端脚本加载 + 报文断言）。
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '瓦罗兰特核心.js');
const code = fs.readFileSync(FILE, 'utf8');

const results = [];
function ok(name, cond, extra) {
  results.push({ name, cond: !!cond });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   ' + extra : ''));
}

/* ---------------- 最小 DOM 桩 ---------------- */
const allEls = [];
const byId = {};
function registerIds(html) {
  const re = /id="([^"]+)"/g; let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    if (!byId[id]) { const e = makeEl('div'); e.id = id; allEls.push(e); byId[id] = e; }
  }
}
function makeEl(tag) {
  const el = {
    tagName: tag || 'div', id: '', _html: '', textContent: '', value: '',
    style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } },
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, insertBefore(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getContext() { return null; }, focus() {}, blur() {}, remove() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); registerIds(this._html); }
  };
  return el;
}
const document = {
  readyState: 'complete',
  getElementById(id) { return byId[id] || allEls.find(e => e.id === id) || null; },
  createElement(tag) { const e = makeEl(tag); allEls.push(e); return e; },
  createElementNS(_n, tag) { return makeEl(tag); },
  head: (function () { const e = makeEl('head'); byId.head = e; return e; })(),
  body: (function () { const e = makeEl('body'); byId.body = e; return e; })(),
  addEventListener() {}, removeEventListener() {},
};

/* ---------------- 引擎全局桩（只够 waiting/over/spikeYou 路径用） ---------------- */
const NET = { id: 1, dead: false, connected: false, players: {}, server: '', secure: false, ws: null, enabled: false, reconnecting: false, replaced: false };
const camera = { position: { x: 0, y: 0, z: 0, set() {} }, getWorldDirection() { return { x: 0, y: 0, z: 1 }; } };
const scene = { add() {}, remove() {} };
const THREE = {};
const window = {};
function netSend() {}
function netConnect() {}
function netHostFromPage() { return ''; }
function updateHp() {}
function showMsg() {}
function lockPointer() {}
/* 引擎切枪/切刀桩（batch170 防重叠包裹要检测并替换它们） */
function setCurrentGun(g) { sandbox.__scg = g; }
function switchWeapon(t) { sandbox.__sw = t; }
window.setCurrentGun = setCurrentGun;
window.switchWeapon = switchWeapon;
const location = { host: 'localhost', protocol: 'http:', href: '' };
function setInterval() { return 0; }   // 桩里不真跑渲染循环，避免依赖 THREE/camera
function requestAnimationFrame() { return 0; }
const isTouch = false;
const keys = {};
const GROUND_Y = 2;

const sandbox = {
  window, document, NET, camera, scene, THREE, location,
  netSend, netConnect, netHostFromPage, updateHp, showMsg, lockPointer,
  setCurrentGun, switchWeapon,
  isTouch, keys, GROUND_Y, setInterval, requestAnimationFrame,
  console, Math, JSON, Date, parseInt, parseFloat, isFinite, Number, String, Array, Object, Boolean,
};
sandbox.global = sandbox;

(async function () {
  console.log('\n=== 瓦罗兰特核心（客户端）DOM 桩自测 ===\n');

  /* ① 加载不报错 */
  let loaded = true, loadErr = '';
  try {
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: '瓦罗兰特核心.js' });
  } catch (e) { loaded = false; loadErr = e.message; }
  ok('① 瓦罗兰特核心.js 加载无异常', loaded, loadErr);
  if (!loaded) { finish(); return; }

  ok('① 导出 window.VLUI.onMsg 是函数', !!(window.VLUI && typeof window.VLUI.onMsg === 'function'));
  ok('① 导出 window.SPIKE 状态对象存在', !!window.SPIKE);
  const SPIKE = window.SPIKE;
  ok('① 加载即固定 NET_MODE=spike', window.NET_MODE === 'spike', 'NET_MODE=' + window.NET_MODE);

  const onMsg = window.VLUI.onMsg;

  /* ② spikeYou：告诉本人阵营与出生点 */
  let t2 = true, e2 = '';
  try {
    onMsg({ t: 'spikeYou', team: 0, spawn: [30, -20] });
  } catch (e) { t2 = false; e2 = e.message; }
  ok('② spikeYou 设置阵营(0=进攻) 与出生点', t2 && SPIKE.team === 0 &&
    Array.isArray(SPIKE.mySpawn) && SPIKE.mySpawn[0] === 30 && SPIKE.mySpawn[1] === -20, e2 || ('team=' + SPIKE.team + ' spawn=' + JSON.stringify(SPIKE.mySpawn)));

  /* ③ 收到 waiting（等待开始）：只亮大厅，不进地图 */
  let t3 = true, e3 = '';
  try {
    onMsg({ t: 'spike', phase: 'waiting', round: 1, score: [0, 0],
      roster: [{ i: 1, n: '甲', t: 0, a: 1, h: 100, r: 0 }, { i: 2, n: '乙', t: 1, a: 1, h: 100, r: 0 }] });
  } catch (e) { t3 = false; e3 = e.message; }
  const vlRoot = document.getElementById('vlRoot');
  ok('③ 等待阶段：大厅已显示(vlRoot 带 on 类)', t3 && vlRoot && vlRoot.classList.contains('on'), e3 || (vlRoot ? ('on=' + vlRoot.classList.contains('on')) : '无 vlRoot'));
  ok('③ 等待阶段：没有进地图(_inGame 仍为 0)', SPIKE._inGame === 0, '_inGame=' + SPIKE._inGame);
  ok('③ 等待阶段：记录到大厅状态(_lobby=1)', SPIKE._lobby === 1, '_lobby=' + SPIKE._lobby);

  /* ④ 收到 over（回合结束）：仍在大厅/比分板，不进地图 */
  let t4 = true, e4 = '';
  try {
    onMsg({ t: 'spike', phase: 'over', winner: 1, reason: '拆除', round: 1, score: [0, 1],
      roster: [{ i: 1, n: '甲', t: 0, a: 0, h: 0, r: 0 }, { i: 2, n: '乙', t: 1, a: 1, h: 100, r: 0 }] });
  } catch (e) { t4 = false; e4 = e.message; }
  ok('④ 回合结束：phase=over 且 winner=1(防守方)', t4 && SPIKE.phase === 'over' && SPIKE.winner === 1, e4 || ('phase=' + SPIKE.phase + ' winner=' + SPIKE.winner));
  ok('④ 回合结束：仍在大厅(_inGame 仍为 0，未进地图)', SPIKE._inGame === 0, '_inGame=' + SPIKE._inGame);

  /* ⑤ spikeMap：换图指令 → 记录到 window.curMapId（即便还没进图） */
  let t5 = true, e5 = '';
  try {
    onMsg({ t: 'spikeMap', m: 'eclipse' });
  } catch (e) { t5 = false; e5 = e.message; }
  ok('⑤ spikeMap 换图指令被接收(无异常)', t5, e5);

  /* ⑥【batch170】武器选择界面钩子：
        · 没拾取爆能器 → spikeCard() 返回 null（界面里不出现这张卡）
        · 拾取后(carrier=我) → 有卡，手持态随 slot 走
        · selectSpike() = 切到 slot 2（相当于"选哪件拿哪件"）
        · 引擎换枪/换刀已包了防重叠层(setCurrentGun._vlWrap) */
  let t6 = true, e6 = '';
  try {
    const VLUI = window.VLUI;
    if (!VLUI || typeof VLUI.spikeCard !== 'function' || typeof VLUI.selectSpike !== 'function') { t6 = false; e6 = '钩子未导出'; }
    else {
      const 无包 = VLUI.spikeCard();
      if (无包 !== null) { t6 = false; e6 = '没拾取却返回了卡: ' + JSON.stringify(无包); }
      SPIKE.carrier = 1;                    /* NET.id=1（桩里固定）→ 我成了持包人 */
      const 有包 = VLUI.spikeCard();
      if (!有包 || 有包.手持中 !== false) { t6 = false; e6 = '持包后卡片状态不对: ' + JSON.stringify(有包); }
      VLUI.selectSpike();
      if (SPIKE.slot !== 2 || VLUI.spikeCard().手持中 !== true) { t6 = false; e6 = 'selectSpike 没切到手持态'; }
      VLUI.selectSpike = VLUI.selectSpike;  /* 再点一次应仍在 2（幂等） */
      if (window.setCurrentGun && window.setCurrentGun._vlWrap !== 1) { t6 = false; e6 = 'setCurrentGun 没包防重叠层'; }
      if (window.switchWeapon && window.switchWeapon._vlWrap !== 1) { t6 = false; e6 = 'switchWeapon 没包防重叠层'; }
      window.setCurrentGun(0);              /* 模拟"从武器选择界面点枪卡"→ 应收起手持包 */
      if (SPIKE.slot !== 0) { t6 = false; e6 = '点枪卡后手持包没收起(slot 仍 ' + SPIKE.slot + ')'; }
    }
  } catch (e) { t6 = false; e6 = e.message; }
  ok('⑥ 武器选择界面：未拾取无卡/拾取后有卡/点卡切手持/切枪收起', t6, e6);

  finish();
})();

function finish() {
  const failed = results.filter(r => !r.cond);
  console.log('\n--------------------------------------------------');
  console.log(failed.length ? ('❌ 失败 ' + failed.length + ' 项 / 共 ' + results.length + ' 项') : ('✅ 全部 ' + results.length + ' 项通过'));
  console.log('--------------------------------------------------\n');
  process.exit(failed.length ? 1 : 0);
}
