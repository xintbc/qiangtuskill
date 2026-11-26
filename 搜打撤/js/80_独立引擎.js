/* ==================================================================================
   搜打撤 · 独立引擎（js/80_独立引擎.js）
   ----------------------------------------------------------------------------------
   这个文件只给「搜打撤/index.html」用，**不引用原版任何脚本**。
   原版那套英雄 / 技能 / 波次 / 联机 / 载具全都不加载 —— 这里只有「搜、打、撤」。

   它做两件事：
     ① 补齐 js/78 过去向原版借的全局变量（S / keys / scene / camera / GAME_MODES /
        addBox / obstacles / startSoloGame / showMsg / lockPointer …），让 78 的仓库、
        部署、交易行、灰港建图和 HUD 不用改就能跑在自己的世界里。
     ② 自己跑渲染、第一人称移动、碰撞、射击、拾荒者 AI、引擎 HUD 与主循环。

   加载顺序：74 数据 → 75 物品 → 76 地图 → 77 搜刮 → 79 图标 → 80 本文件 → 78 界面。
   ================================================================================== */

window.RAID_独立版 = true;

/* ---------- js/78 借用的全局：全部自己给 ---------- */
var S = {
  hp: 100, maxHp: 100, paused: false, playing: false, over: false,
  ammo: 15, maxAmmo: 15, velY: 0, onGround: true, onLadder: false,
  mantle: 0, landKick: 0
};
var keys = {};
var CUR_MODE = null;
var GAME_MODES = {};
var MAP_GROUP = {};                 /* 独立版没有原版地图组，留空给 78 遍历 */
var curMapId = 'classic';
var obstacles = [], teleports = [];
var _mapTarget = null, _obsTarget = null, _tpTarget = null, _infoTarget = null;
var GROUND_Y = 2.0;
var curGun = -2;
var 正在打字 = false;

function mapById() { return { id: 'classic', limit: 112 }; }
function buildObstacleBoxes() { /* 碰撞盒直接读 obstacles，原版这个函数在本版是空操作 */ }

/* 与 js/11 的 addBox 同签名：78 的 灰港_建场() 直接拿它砌房子 */
function addBox(x, z, w, h, d, mat, kind) {
  var geo = new THREE.BoxGeometry(w, h, d);
  var mesh = new THREE.Mesh(geo, mat || new THREE.MeshLambertMaterial({ color: 0x777777 }));
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = false; mesh.receiveShadow = true;
  if (_mapTarget) _mapTarget.add(mesh);
  if (_obsTarget) _obsTarget.push({
    cx: x, cz: z, w: w, d: d, h: h, y0: 0, y1: h, kind: kind || 'terrain',
    minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2
  });
  return mesh;
}

/* 轻提示：独立版没有原版的 #msg，自己做一个 */
function showMsg(t, c) {
  try {
    var box = document.getElementById('raidToast');
    if (!box) {
      box = document.createElement('div'); box.id = 'raidToast';
      box.style.cssText = 'position:fixed;left:50%;top:72px;transform:translateX(-50%);'
        + 'z-index:1200;max-width:min(680px,90vw);padding:10px 16px;border-radius:10px;'
        + 'background:rgba(10,15,22,.92);border:1px solid rgba(255,199,92,.5);'
        + 'color:#ffd88a;font:600 13px/1.6 system-ui,"Microsoft YaHei",sans-serif;'
        + 'pointer-events:none;transition:opacity .25s;';
      document.body.appendChild(box);
    }
    box.textContent = t; box.style.color = c || '#ffd88a'; box.style.opacity = '1';
    clearTimeout(showMsg._t);
    showMsg._t = setTimeout(function () { box.style.opacity = '0'; }, 3200);
  } catch (e) { try { console.log('[搜打撤] ' + t); } catch (_e) { } }
}

/* ---------- 引擎内部状态 ---------- */
var renderer = null, scene = null, camera = null;
var P = {
  yaw: 0, pitch: 0, velY: 0, onGround: true,
  连发: false, 冷却: 0, 换弹: 0, 换弹总: 0, 后坐: 0, 受击闪: 0, 击倒: 0,
  瞄准中: false, 瞄准: 0, 散布: 0, 移动: 0, 命中闪: 0, 枪摆动: 0, 滚: 0,
  /* 武器：枪序 0/1 对应两个武器槽，弹匣表记住每把枪自己的弹匣；没枪就是没枪 */
  枪序: 0, 弹匣表: [0, 0], 空手: true,
  /* 姿态：探头 -1 左 / 0 / 1 右，蹲下布尔；带"值"的是平滑插值后的实际量 */
  探头: 0, 探头值: 0, 蹲: false, 蹲值: 0,
  /* 手感：水平速度单独留状态，起步/刹车/转向都走指数逼近，不再一按键瞬间满速 */
  速X: 0, 速Z: 0, 移动: 0, 横移: 0, 切枪: 0,
  上帧偏X: 0, 上帧偏Z: 0, 上帧偏Y: 0,
  /* 行走镜头摇晃：摇晃相累加步频，摇X/摇Y 是上一帧叠加的视点偏移，上帧摇Z 同理 */
  摇晃相: 0, 摇X: 0, 摇Y: 0, 摇Z: 0
};
var 敌人 = [], 弹道 = [], 子弹表 = [], 火花表 = [], 枪模 = null, 枪口灯 = null, 引擎HUD = null;
var 暂停窗 = null, 曾锁鼠标 = false;
var 上帧 = 0, 独立版HUD元素 = {};
/* 开镜枪位：瞄具上沿必须低于视线中心，否则枪身方块糊住准星内区域。
   FOV 45 时屏幕半高 ≈ |z|*tan(22.5°) ≈ 0.124；枪模最高零件约 +0.09，
   所以中心下放到 -0.15 才有安全余量，准星内区域保持可见。 */
var 枪基位 = { x: 0.18, y: -0.22, z: -0.45 }, 枪瞄位 = { x: 0, y: -0.15, z: -0.30 };
var 换弹弹匣 = null, 换弹掉落 = null;
/* 护甲 / 头盔：局内独立耐久，和仓库里那件装备 id 绑定，下局从新装备重置。
   头盔只管头部、护甲只管躯干，耐久耗尽前按部位全额吸收，本体不扣血。 */
var 护甲 = { id: '', 名: '', 上限: 0, 值: 0, 减: 0.55 };
var 头盔 = { id: '', 名: '', 上限: 0, 值: 0, 减: 0.35 };

/* ---------- 初始化 ---------- */
function 独立引擎_init() {
  scene = new THREE.Scene();
  /* 灰港是夜里封锁的港区：暗青灰天幕 + 近距雾。
     以前 ambient .78 + 两盏 .85/.42 的灯把一切冲成亮色块，现在只留一层薄环境光，
     靠路灯 / 撤离灯 / 灯罩自发光做明暗层次 —— 不再"光污染"。 */
  scene.background = new THREE.Color(0x141d22);
  scene.fog = new THREE.FogExp2(0x1d2a30, 0.0026);

  camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, GROUND_Y, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding || renderer.outputEncoding;
  document.body.insertBefore(renderer.domElement, document.body.firstChild);

  scene.add(new THREE.AmbientLight(0xa9bec9, 0.34));
  var 日 = new THREE.DirectionalLight(0xc3d6e2, 0.52);
  日.position.set(60, 110, 45); scene.add(日);
  scene.add(new THREE.HemisphereLight(0x425d6c, 0x151811, 0.24));

  枪口灯 = new THREE.PointLight(0xffd58a, 0, 12);
  camera.add(枪口灯); 枪口灯.position.set(0.22, -0.18, -0.7);
  scene.add(camera);

  rebuildWeaponModel();
  建引擎HUD();
  绑输入();

  /* 78 的 搜算格() 按 "整个准备层在 #uiZoom 里" 的口径算格宽；独立版没有放大层，
     用原公式会把格子白白缩小。运行时覆盖成无 zoom 的版本即可（78 的函数是全局的）。 */
  try {
    window.搜算格 = function () {
      var vh = window.innerHeight || 600;
      var rc = Math.round((vh * 0.94 - 265) / 8);
      return Math.max(24, Math.min(38, rc || 38));
    };
  } catch (e) { }

  /* 独立版的首屏就是准备层，不需要原版那套「名字面板 + 主菜单」 */
  var 退 = document.getElementById('raidBackBtn');
  if (退) 退.textContent = '← 返回主菜单';
  try {
    var 提 = document.querySelector('#rp-deploy .rpNoticeT');
    var 说 = document.querySelector('#rp-deploy .rpNoticeD');
    if (提) 提.textContent = '✅ 独立模式：只有搜、打、撤';
    if (说) 说.innerHTML = '这里<b>不加载英雄、技能和波次</b>，是一套自己的 3D 引擎。'
      + 'WASD 移动 / 鼠标观察 / 左键开枪 / <b>R 换弹（真扣胸挂背包里的子弹）</b> / H 急救 / '
      + '<b>B 随身背包</b> / 按住 <b>F</b> 开箱与撤离。'
      + '装备都要从仓库穿上；活着走出绿色光圈才算带出物资。';
  } catch (e) { }

  window.addEventListener('resize', function () {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  requestAnimationFrame(独立引擎_帧);
}

/* ---------- 鼠标锁 ---------- */
function lockPointer() {
  if (!renderer || !renderer.domElement) return;
  /* 搜刮窗 / 结算窗 / 暂停菜单开着时绝不抢鼠标 —— 这是「搜物品时鼠标不会自动解除」的根因防护 */
  try {
    if (S.paused) return;
    if (typeof RAID_搜刮 !== 'undefined' && RAID_搜刮.开) return;
    if (typeof RAID_ !== 'undefined' && RAID_.背包开) return;
    if (typeof RAID_局 !== 'undefined' && RAID_局.结算中) return;
    var p = renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(function () { });
  } catch (e) { }
}

function 鼠标已锁() {
  return !!(renderer && document.pointerLockElement === renderer.domElement);
}

/* 视角统一入口：yaw 归一化，pitch 夹紧，roll 与 pitch/yaw 一次性写进同一个 Euler。
   以前 mousemove/开火 写 rotation.set(pitch,yaw,0)，帧末又单独写 rotation.z，
   在多轴组合时会出现某角度突然翻/跳；现在任何路径都不允许只改其中一个轴。 */
function 同步视角() {
  if (!camera) return;
  var PI2 = Math.PI * 2;
  P.yaw = ((P.yaw + Math.PI) % PI2 + PI2) % PI2 - Math.PI;
  P.pitch = Math.max(-1.32, Math.min(1.32, P.pitch));
  camera.rotation.set(P.pitch, P.yaw, P.滚 || 0, 'YXZ');
}

/* ---------- 局内暂停：Esc 或浏览器抢先解锁鼠标都走这里 ----------
   独立页没有原版 #blocker，所以过去 Esc 只被当成"关背包"，局内什么也不会发生。
   这里自带一个轻量暂停层；S.paused 同时冻结主循环，恢复后重新抢鼠标锁。 */
function 开暂停菜单() {
  if (!RAID_.对局中 || RAID_.结算中 || RAID_.背包开) return;
  if (typeof RAID_搜刮 !== 'undefined' && RAID_搜刮.开) return;
  S.paused = true;
  P.连发 = false; P.瞄准中 = false;
  P.速X = P.速Z = P.移动 = 0;
  隐藏镜筒();
  try { document.exitPointerLock(); } catch (e) { }
  if (!暂停窗) {
    暂停窗 = document.createElement('div');
    暂停窗.id = 'rdPause';
    暂停窗.style.cssText = 'position:fixed;inset:0;z-index:10000;display:none;align-items:center;'
      + 'justify-content:center;background:rgba(5,9,14,.86);font-family:system-ui,"Microsoft YaHei",sans-serif;';
    暂停窗.innerHTML = '<div style="width:min(430px,92vw);padding:26px 28px;border-radius:16px;'
      + 'background:#101825;border:1px solid rgba(255,199,92,.45);box-shadow:0 24px 80px rgba(0,0,0,.7);color:#dfe9f0">'
      + '<h2 style="margin:0 0 6px;font-size:23px;color:#ffd166">已暂停</h2>'
      + '<p style="margin:0 0 18px;color:#93a4bc;font-size:12.5px;line-height:1.7">'
      + 'Esc 继续游戏 · B 随身背包 · R 换弹 · H 急救 · 右键开镜 · 按住 F 搜刮/撤离</p>'
      + '<button id="rdPauseResume" style="width:100%;padding:12px;border:0;border-radius:10px;'
      + 'background:linear-gradient(90deg,#e0a020,#ffd06a);color:#20170a;font-weight:800;font-size:15px;cursor:pointer">继续游戏</button>'
      + '<button id="rdPauseQuit" style="width:100%;margin-top:10px;padding:11px;border:1px solid rgba(255,255,255,.2);'
      + 'border-radius:10px;background:#26313a;color:#dfe9f0;font-weight:700;font-size:14px;cursor:pointer">返回准备层</button>'
      + '</div>';
    document.body.appendChild(暂停窗);
    暂停窗.querySelector('#rdPauseResume').addEventListener('click', 关暂停菜单);
    暂停窗.querySelector('#rdPauseQuit').addEventListener('click', function () {
      暂停窗.style.display = 'none';
      try { 灰港_退场(); } catch (e) { showMsg('返回准备层失败：' + e.message, '#ff8e8e'); }
    });
  }
  暂停窗.style.display = 'flex';
}
function 关暂停菜单() {
  if (!暂停窗 || 暂停窗.style.display !== 'block' && 暂停窗.style.display !== 'flex') return;
  暂停窗.style.display = 'none';
  if (RAID_.对局中 && !RAID_.结算中 && !RAID_.背包开 && !(typeof RAID_搜刮 !== 'undefined' && RAID_搜刮.开)) {
    S.paused = false;
    try { lockPointer(); } catch (e) { }
  }
}

/* ---------- 输入 ---------- */
function 绑输入() {
  document.addEventListener('mousemove', function (e) {
    if (!鼠标已锁() || S.paused || !RAID_.对局中 || RAID_.结算中) return;
    var mx = e.movementX || 0, my = e.movementY || 0;
    /* 指针锁刚拿到/浏览器偶发会塞一个巨大 movement，导致视角瞬移；超过 160px 直接丢 */
    if (Math.abs(mx) > 160) mx = 0;
    if (Math.abs(my) > 160) my = 0;
    P.yaw -= mx * 0.0021;
    P.pitch -= my * 0.0021;
    同步视角();
  });

  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (RAR_打字中(e.target)) return;
    if (!RAID_.对局中 || RAID_.结算中) return;
    /* B 在背包开关时必须先于暂停判断处理，否则窗开着就再也关不掉 */
    if (e.code === 'KeyB') {
      e.preventDefault();
      if (RAID_搜刮.开) return;
      if (暂停窗 && 暂停窗.style.display === 'block') 关暂停菜单();
      if (RAID_.背包开) 关背包(); else 开背包();
      return;
    }
    /* Esc 统一入口：搜刮窗 → 背包 → 暂停菜单，一次只处理最上面那层。
       以前这里只认「背包开着」，局内按 Esc 直接被 S.paused/return 吞掉，暂停菜单永远出不来。 */
    if (e.code === 'Escape') {
      e.preventDefault();
      if (typeof RAID_搜刮 !== 'undefined' && RAID_搜刮.开) { 搜刮_关(); return; }
      if (RAID_.背包开) { 关背包(); return; }
      if (暂停窗 && 暂停窗.style.display === 'block') 关暂停菜单(); else 开暂停菜单();
      return;
    }
    if (S.paused || RAID_.背包开) return;
    /* 1 / 2 直选主副武器；按住不重复切 */
    if (e.code === 'Digit1' || e.code === 'Numpad1') {
      e.preventDefault(); if (!e.repeat) 切枪(0); return;
    }
    if (e.code === 'Digit2' || e.code === 'Numpad2') {
      e.preventDefault(); if (!e.repeat) 切枪(1); return;
    }
    if (e.code === 'KeyR') { e.preventDefault(); 开始换弹(); }
    if (e.code === 'KeyH') { e.preventDefault(); 用急救(); }
    if (e.code === 'Space' && P.onGround) { e.preventDefault(); P.velY = 7.2; P.onGround = false; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space',
      'KeyQ', 'KeyE', 'ControlLeft', 'ControlRight', 'KeyC'].indexOf(e.code) >= 0)
      e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () {
    keys = {}; P.连发 = false; P.瞄准中 = false; P.探头 = 0; P.蹲 = false;
  });

  /* 滚轮切枪：只在局内且鼠标锁着时生效，别在背包/搜刮窗里乱切 */
  renderer.domElement.addEventListener('wheel', function (e) {
    if (!RAID_.对局中 || RAID_.结算中 || S.paused || RAID_.背包开 || !鼠标已锁()) return;
    e.preventDefault();
    滚轮切枪(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  renderer.domElement.addEventListener('mousedown', function (e) {
    if (!RAID_.对局中 || RAID_.结算中 || S.paused || RAID_.背包开) return;
    if (!鼠标已锁()) { lockPointer(); return; }
    if (!当前枪()) return;                      /* 空手没枪可开、可开镜 */
    if (e.button === 0) P.连发 = true;
    if (e.button === 2) P.瞄准中 = true;        /* 右键开镜：松手就还原 */
  });
  window.addEventListener('mouseup', function (e) {
    if (e.button === 0) P.连发 = false;
    if (e.button === 2) P.瞄准中 = false;
  });
  window.addEventListener('blur', function () { P.瞄准中 = false; });
  renderer.domElement.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  document.addEventListener('pointerlockchange', function () {
    var 锁 = 鼠标已锁();
    if (锁) 曾锁鼠标 = true;
    if (!RAID_.对局中 || RAID_.结算中 || RAID_.背包开 || typeof RAID_搜刮 === 'undefined' || RAID_搜刮.开) {
      if (引擎HUD元素.锁提) 引擎HUD元素.锁提.style.display = 'none';
      return;
    }
    if (引擎HUD元素.锁提) 引擎HUD元素.锁提.style.display = 锁 ? 'none' : 'block';
    /* 浏览器会先吞掉 Esc 用来退出指针锁，keydown 不一定到页面。
       只有"真的锁过又掉了"才弹暂停；没锁成功（无头/权限拒绝）不该一进图就暂停。 */
    if (曾锁鼠标 && !锁 && !S.paused && !(暂停窗 && 暂停窗.style.display === 'flex')) {
      曾锁鼠标 = false;
      开暂停菜单();
    }
  });
}

function RAR_打字中(el) {
  if (!el) return false;
  var t = (el.tagName || '').toLowerCase();
  return t === 'input' || t === 'textarea' || el.isContentEditable;
}

/* 把内存里的膛内子弹 / 甲盔耐久写回存档。
   撤离成功时由 78 调；异常中断则由 RAID异常中断 直接清掉，不会走这里。 */
function 保存弹匣() {
  var s = (typeof RAID档 === 'function') ? RAID档() : null;
  if (!s) return false;
  if (!Array.isArray(s.弹匣)) s.弹匣 = [0, 0];
  for (var i = 0; i < 2; i++) s.弹匣[i] = Math.max(0, Math.min(99, P.弹匣表[i] | 0));
  try { return RAID写档(); } catch (e) { return false; }
}
function 保存装备耐久() {
  var s = (typeof RAID档 === 'function') ? RAID档() : null;
  if (!s) return false;
  if (!s.装备耐久) s.装备耐久 = { 护甲: { id: '', 值: 0 }, 头盔: { id: '', 值: 0 } };
  s.装备耐久.护甲 = { id: (s.装备 && s.装备.护甲) || '', 值: Math.max(0, 护甲.值 | 0) };
  s.装备耐久.头盔 = { id: (s.装备 && s.装备.头盔) || '', 值: Math.max(0, 头盔.值 | 0) };
  try { return RAID写档(); } catch (e) { return false; }
}
/* ---------- 开局：78 负责建场，这里负责"活起来" ---------- */
function startSoloGame() {
  S.playing = true; S.over = false; S.paused = false;
  /* 空弹匣进图：枪里不带弹，第一枪自动触发换弹，从胸挂/背包真扣子弹。
     绝不预装 —— 否则等于白送一梭子，破坏搜打撤的弹药经济。 */
  S.hp = S.maxHp = 100; S.ammo = 0; S.maxAmmo = 0;
  P.冷却 = 0; P.换弹 = 0; P.换弹总 = 0; P.连发 = false; P.pitch = 0;
  P.瞄准 = 0; P.瞄准中 = false; P.散布 = 0; P.后坐 = 0; P.命中闪 = 0;
  P.枪序 = 0; P.弹匣表 = [0, 0];
  /* 膛内子弹按存档恢复：只有撤离成功才写档；异常中断时存档已被清成 0。
     不是"自动装满"——装多少是上一局玩家自己换进去并保留下来的。 */
  var s档 = (typeof RAID档 === 'function') ? RAID档() : null;
  if (s档 && Array.isArray(s档.弹匣)) {
    P.弹匣表[0] = Math.max(0, Math.min(99, s档.弹匣[0] | 0));
    P.弹匣表[1] = Math.max(0, Math.min(99, s档.弹匣[1] | 0));
  }
  S.ammo = P.弹匣表[0];
  P.探头 = 0; P.探头值 = 0; P.蹲 = false; P.蹲值 = 0;
  P.速X = P.速Z = P.移动 = P.横移 = P.切枪 = 0; P.滚 = 0;
  P.上帧偏X = P.上帧偏Z = P.上帧偏Y = 0;
  P.摇晃相 = 0; P.摇X = P.摇Y = P.摇Z = 0;
  曾锁鼠标 = false;
  清子弹(); 初始化护甲();
  if (s档) { s档.局中 = true; try { RAID写档(); } catch (e) { } }
  rebuildWeaponModel();   /* 没枪就不建模型；有枪按当前枪序建 */
  try { if (GAME_MODES.raid && GAME_MODES.raid.start) GAME_MODES.raid.start(); }
  catch (e) { showMsg('建场失败：' + e.message, '#ff6b6b'); return; }
  if (!RAID_.对局中 || !RAID_局.地图) return;

  /* 出生点朝着地图中心，别让第一眼对着边界墙 */
  var px = camera.position.x, pz = camera.position.z;
  P.yaw = Math.atan2(-(0 - px), -(0 - pz));
  同步视角();
  生成拾荒者();
  CUR_MODE = 'raid';
  lockPointer();
  if (引擎HUD元素.锁提) 引擎HUD元素.锁提.style.display = 鼠标已锁() ? 'none' : 'block';
}

/* 78 的 灰港_退场() 会调这两个；把它们送回本模式自己的清场钩子 */
function clearFieldData() { try { 隐藏镜筒(); } catch (e) { } try { 关背包(); } catch (e) { } try { 搜打撤_清场(); } catch (e) { } }
function resetRoundState() { try { 搜打撤_清状态(); } catch (e) { } }
function rebuildWeaponModel() {
  if (!camera) return;
  if (枪模) {
    camera.remove(枪模);
    try { 枪模.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); } catch (e) { }
    枪模 = null;
  }
  var s = (typeof RAID档 === 'function') ? RAID档() : null;
  var 槽 = s && s.装备 && s.装备.枪 ? s.装备.枪 : null;
  var id = 槽 ? 槽[P.枪序 | 0] : '';
  var g = (id && typeof RAID_GUNS !== 'undefined') ? RAID_GUNS[id] : null;
  if (!g) {
    /* 空手：不建枪，但两只手都必须可见（左手/右手不能因没持物而消失）。
       空手模型只做姿态，不参与开火/开镜；P.空手 让姿态函数走独立分支。 */
    S.maxAmmo = 0; S.ammo = 0; P.弹匣表[P.枪序 | 0] = 0;
    P.瞄准中 = false; P.瞄准 = 0; P.连发 = false; P.空手 = true;
    if (换弹掉落) { camera.remove(换弹掉落); 换弹掉落 = null; }
    枪模 = new THREE.Group();
    if (typeof 独立造空手 === 'function') 独立造空手(枪模);
    枪模.position.set(0, -.2, -.32);
    camera.add(枪模);
    return;
  }
  P.空手 = false;
  var 详 = (typeof RAID枪参 === 'function') ? RAID枪参(id) : null;
  S.maxAmmo = g.弹匣 | 0;
  S.ammo = Math.max(0, Math.min(S.ammo | 0, S.maxAmmo));
  P.弹匣表[P.枪序 | 0] = S.ammo;
  枪基位 = { x: 0.18, y: -0.22, z: -0.45 };
  枪瞄位 = { x: 0, y: -0.15, z: -0.30 };
  if (详 && 详.型 === 'pistol') 枪瞄位 = { x: 0.01, y: -0.155, z: -0.34 };
  if (详 && 详.型 === 'sniper') 枪瞄位 = { x: 0, y: -0.148, z: -0.27 };
  /* 换弹时掉出去的旧弹匣属于上一把枪，换模型必须一起清掉 */
  if (camera && 换弹掉落) { camera.remove(换弹掉落); 换弹掉落 = null; }
  P.换弹 = 0; P.换弹总 = 0;
  枪模 = new THREE.Group();
  /* 81 号外观分片：机匣 / 导轨 / 枪管 / 瞄具 / 双手，六种枪各有轮廓。
     没有兜底盒模 —— 空手进局就该什么都看不见。 */
  if (typeof 独立造枪模 === 'function') {
    独立造枪模(枪模, id);
    枪模.position.set(枪基位.x, 枪基位.y, 枪基位.z);
  }
  camera.add(枪模);
}

/* ---------- 碰撞（X/Z + Y 三轴）----------
   碰撞盒统一带 y0/y1：墙体 0..h，楼板/屋顶只占自己的高度区间。
   玩家眼高 2.0，脚底 ≈ 眼高−1.62，头顶 ≈ 眼高+0.12。
   以前只比 X/Z，跳起来能从楼板/屋顶穿过去；现在三者都要过。 */
var 玩家眼高 = 1.62, 玩家头高 = .12, 玩家半径 = .48;
function 撞墙(x, z, r, 眼) {
  r = r == null ? 玩家半径 : r;
  眼 = (眼 == null) ? camera.position.y : 眼;
  var 脚 = 眼 - 玩家眼高, 头 = 眼 + 玩家头高;
  for (var i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    if (!o) continue;
    var 底 = (o.y0 == null) ? 0 : o.y0;
    var 顶 = (o.y1 != null) ? o.y1 : (o.h || 0);
    if (顶 <= 脚 + .42) continue;                 /* 低沿能跨过去 */
    if (底 >= 头) continue;                       /* 障碍在头顶上方，不挡水平移动 */
    if (x + r > o.minX && x - r < o.maxX && z + r > o.minZ && z - r < o.maxZ) return true;
  }
  return false;
}

/* 头顶撞到楼板/屋顶底面时返回该底面高度；没有就返回 null */
function 碰头(x, z, 眼) {
  眼 = (眼 == null) ? camera.position.y : 眼;
  var 脚 = 眼 - 玩家眼高, 头 = 眼 + 玩家头高, 最近 = null;
  for (var i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    if (!o) continue;
    /* 楼梯踏步是"脚踩的台阶"，靠 地面眼高() 逐级站上去；
       把它算成撞头天花板会让玩家上楼时被自己的台阶压住，必须跳过。 */
    if (o.kind === 'stair') continue;
    var 底 = (o.y0 == null) ? 0 : o.y0;
    if (底 <= 脚 + .02) continue;                 /* 地板/脚边不算撞头 */
    if (底 < 头 && (最近 == null || 底 < 最近)) 最近 = 底;
  }
  return 最近;
}

/* 脚下能站住的最高面：地面 0，或低箱/楼板顶面；返回“眼睛应该到的 Y” */
function 地面眼高(x, z, 眼) {
  眼 = (眼 == null) ? camera.position.y : 眼;
  var 脚 = 眼 - 玩家眼高, 最高 = 0;
  for (var i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    if (!o) continue;
    var 顶 = (o.y1 != null) ? o.y1 : (o.h || 0);
    if (顶 < .05) continue;
    if (x + 玩家半径 > o.minX && x - 玩家半径 < o.maxX &&
        z + 玩家半径 > o.minZ && z - 玩家半径 < o.maxZ) {
      if (顶 <= 脚 + .55 && 顶 > 最高) 最高 = 顶;
    }
  }
  return GROUND_Y + 最高;
}

/* 两点之间有没有墙：沿线段采样撞墙盒。敌人索敌/开火和玩家子弹都要过这一关，
   否则会出现隔墙锁人、子弹穿集装箱打人的 bug。 */
function 有视线(ax, az, bx, bz) {
  var dx = bx - ax, dz = bz - az, 长 = Math.hypot(dx, dz);
  if (长 < .01) return true;
  var 步 = Math.ceil(长 / .55);
  for (var i = 1; i < 步; i++) {
    var t = i / 步;
    if (撞墙(ax + dx * t, az + dz * t)) return false;
  }
  return true;
}

/* ---------- 拾荒者（"打"）---------- */
function 生成拾荒者() {
  敌人.length = 0;
  var rng = RAID随机((RAID_局.种子 ^ 0x5f3a1c) >>> 0), 区 = RAID_MAP_GANG.区;
  for (var i = 0; i < 9; i++) {
    var 中 = 灰港区心[区[i % 区.length].id];
    var x = 中.x + (rng() - 0.5) * 34, z = 中.z + (rng() - 0.5) * 34;
    if (Math.hypot(x - camera.position.x, z - camera.position.z) < 20) x += 18;
    var 衣色 = [0x6d4540, 0x455a54, 0x414c5c][i % 3];
    var g = (typeof 独立造拾荒者 === 'function')
      ? 独立造拾荒者(x, z, 衣色)
      : new THREE.Group();
    RAID_局.地图.add(g);
    var 敌 = { 组: g, x: x, z: z, hp: 55 + (i % 3) * 8, 冷却: .6 + rng() * .6, 警觉: false, 相位: rng() * 6.28 };
    g.__敌 = 敌;                       /* 射线命中后靠它找回血量 */
    敌人.push(敌);
  }
}

function 更新拾荒者(dt) {
  var px = camera.position.x, pz = camera.position.z;
  for (var i = 敌人.length - 1; i >= 0; i--) {
    var e = 敌人[i], d = Math.hypot(e.x - px, e.z - pz);
    /* 先判视线：隔墙看不见就别锁人，更不许隔墙开枪 */
    var 见 = 有视线(e.x, e.z, px, pz);
    if (d < 22 && 见) e.警觉 = true;
    if (e.警觉 && d > 0.1) {
      if (d > 6) {
        var vx = (px - e.x) / d * 4.4 * dt, vz = (pz - e.z) / d * 4.4 * dt;
        if (!撞墙(e.x + vx, e.z)) e.x += vx;
        if (!撞墙(e.x, e.z + vz)) e.z += vz;
      }
      e.冷却 -= dt;
      if (d < 18 && 见 && e.冷却 <= 0) {
        e.冷却 = .85;
        /* 拾荒者开枪按部位结算：20% 头 / 60% 躯干 / 20% 四肢，护甲按部位吸收 */
        var r = Math.random(), 部 = r < .2 ? '头' : (r < .8 ? '躯干' : '四肢');
        玩家受伤(6, 部);
        弹道线(e.组.position, camera.position, 0xff6b6b);
      }
    } else {
      e.相位 += dt * 0.6;
      e.x += Math.cos(e.相位) * 0.5 * dt; e.z += Math.sin(e.相位 * 0.7) * 0.5 * dt;
    }
    e.组.position.set(e.x, 0, e.z);
    e.组.rotation.y = Math.atan2(px - e.x, pz - e.z);
    if (e.组.userData && typeof e.组.userData.走 === 'function') e.组.userData.走(performance.now() / 1000 + e.相位);
  }
}

/* ---------- 护甲 / 头盔：各自独立耐久，叠加抗伤，打穿就失效 ---------- */
function 初始化护甲() {
  护甲 = { id: '', 名: '', 上限: 0, 值: 0, 减: 0.55 };
  头盔 = { id: '', 名: '', 上限: 0, 值: 0, 减: 0.35 };
  var s = (typeof RAID档 === 'function') ? RAID档() : null;
  if (!s || !s.装备) return;
  var 甲id = s.装备.护甲, 盔id = s.装备.头盔, d;
  d = 甲id ? RAID物品(甲id) : null;
  if (d && d.类 === '护甲') {
    护甲.id = 甲id; 护甲.名 = d.名;
    护甲.上限 = d.耐 || 60;
    /* 撤离时写了剩余耐久就按它恢复；换了一件新甲（id 不匹配）才从满开始 */
    var 记甲 = s.装备耐久 && s.装备耐久.护甲;
    护甲.值 = (记甲 && 记甲.id === 甲id)
      ? Math.max(0, Math.min(护甲.上限, 记甲.值 | 0)) : 护甲.上限;
    护甲.减 = d.减 || .55;
  }
  d = 盔id ? RAID物品(盔id) : null;
  if (d && d.类 === '头盔') {
    头盔.id = 盔id; 头盔.名 = d.名;
    头盔.上限 = d.耐 || 45;
    var 记盔 = s.装备耐久 && s.装备耐久.头盔;
    头盔.值 = (记盔 && 记盔.id === 盔id)
      ? Math.max(0, Math.min(头盔.上限, 记盔.值 | 0)) : 头盔.上限;
    头盔.减 = d.减 || .35;
  }
}
/* 两种维修包各管各的部位：护甲包只修躯干甲，头盔包只修头甲。
   以前共用"修甲"字段还顺手把头盔一起补满，玩家带一个包就能全身修复，经济直接崩。 */
function 修护甲(量) {
  if (!护甲.上限) { showMsg('没穿护甲；头盔请用头盔维修包', '#ffc75c'); return false; }
  if (护甲.值 >= 护甲.上限) { showMsg('护甲已经满耐久', '#ffc75c'); return false; }
  var 加 = Math.min(护甲.上限 - 护甲.值, 量);
  护甲.值 += 加;
  showMsg('修补 ' + 护甲.名 + ' +' + 加, '#7bf0bd');
  保存装备耐久();
  return true;
}
function 修头盔(量) {
  if (!头盔.上限) { showMsg('没戴头盔；护甲请用护甲修补包', '#ffc75c'); return false; }
  if (头盔.值 >= 头盔.上限) { showMsg('头盔已经满耐久', '#ffc75c'); return false; }
  var 加 = Math.min(头盔.上限 - 头盔.值, 量);
  头盔.值 += 加;
  showMsg('修补 ' + 头盔.名 + ' +' + 加, '#7bf0bd');
  保存装备耐久();
  return true;
}
/* 部位倍率：没有对应护甲、或护甲已经破碎时，按命中部位结算。 */
var 部位倍率 = { 头: 1.75, 躯干: 1, 四肢: .75 };
function 部位倍(部位) { return 部位倍率[部位] || 1; }
/* 命中部位：先读模型上标的 userData.部位；没标的旧模型按命中点高度兜底。 */
function 命中部位(命, 敌组) {
  var o = 命 && 命.object;
  while (o) {
    if (o.userData && o.userData.部位) return o.userData.部位;
    if (o === 敌组) break;
    o = o.parent;
  }
  var y = 命 ? 命.point.y : 0;
  if (y >= 1.72) return '头';
  if (y >= .95) return '躯干';
  return '四肢';
}
/* 玩家受击：头盔只管头、护甲只管躯干，四肢没有护甲。
   对应部位护甲还有耐久时，整发伤害由护甲吃掉、本体不扣血（耐久即使不够也全吃）；
   耐久归零后，同部位再挨打才按倍率正常扣血。 */
function 玩家受伤(基础, 部位) {
  if (RAID_.结算中 || S.paused) return { 部位: 部位 || '躯干', 伤害: 0, 护甲吸收: false };
  部位 = 部位 || '躯干';
  var 伤 = Math.round(基础 * 部位倍(部位));
  var 甲 = 部位 === '头' ? 头盔 : (部位 === '躯干' ? 护甲 : null);
  var 被甲吃 = false;
  if (甲 && 甲.值 > 0) {
    甲.值 = Math.max(0, 甲.值 - 伤);
    被甲吃 = true;
    if (甲.值 <= 0) {
      try { showMsg(甲.名 + '已破碎，该部位失去防护', '#ff8e8e'); } catch (e) { }
    }
  } else {
    S.hp = Math.max(0, S.hp - 伤);
    P.受击闪 = .35;
  }
  if (被甲吃) 保存装备耐久();          /* 甲/盔耐久要跟着存档走，重进不从满开始 */
  刷引擎HUD();
  if (S.hp <= 0 && GAME_MODES.raid && GAME_MODES.raid.onDeath) GAME_MODES.raid.onDeath();
  return { 部位: 部位, 伤害: 伤, 护甲吸收: 被甲吃 };
}

/* ---------- 射击 ---------- */
function 当前枪() {
  var s = (typeof RAID档 === 'function') ? RAID档() : null;
  var 槽 = s && s.装备 && s.装备.枪 ? s.装备.枪 : null;
  var id = 槽 ? 槽[P.枪序 | 0] : '';
  if (!id || typeof RAID_GUNS === 'undefined') return null;   /* 空手就是空手，绝不回退到默认枪 */
  return RAID_GUNS[id] || null;
}
/* 切枪：滚轮和数字键都走这里。空槽跳过，换枪时保存各自弹匣、清空开镜和后坐。 */
function 切枪(序) {
  序 = 序 | 0;
  if (序 < 0 || 序 > 1 || 序 === (P.枪序 | 0)) return { ok: false, 因: '已经是这把' };
  var s = (typeof RAID档 === 'function') ? RAID档() : null;
  var 槽 = s && s.装备 && s.装备.枪 ? s.装备.枪 : null;
  if (!槽 || !槽[序]) { showMsg((序 === 0 ? '主' : '副') + '武器槽是空的', '#ffc75c'); return { ok: false, 因: '空武器槽' }; }
  P.弹匣表[P.枪序 | 0] = S.ammo;               /* 旧枪的弹匣留着，切回来还在 */
  P.枪序 = 序;
  S.ammo = Math.max(0, Math.min(P.弹匣表[序] | 0, 99));
  P.换弹 = 0; P.换弹总 = 0; P.连发 = false; P.瞄准中 = false; P.瞄准 = 0;
  P.后坐 = 0; P.散布 = 0; P.冷却 = Math.max(P.冷却, .12);
  P.切枪 = 1;                         /* 0.26s 抽枪/收枪动画；响应用 .12s 冷却，不拖沓 */
  隐藏镜筒();
  rebuildWeaponModel();
  保存弹匣();                       /* 切枪前那把的弹匣数要落盘 */
  刷引擎HUD();
  var g = 当前枪();
  if (g && typeof g.槽 === 'number') curGun = g.槽;   /* 原版遗留枪号也跟着切，别留旧值 */
  showMsg('切换到 ' + (g ? g.名 : '空手') + '（弹匣 ' + S.ammo + '）', '#9fb2c9');
  return { ok: true, 序: 序, id: 槽[序] };
}
/* 滚轮方向找下一把真存在的枪；只有一把时就地不动。 */
function 滚轮切枪(方向) {
  var s = (typeof RAID档 === 'function') ? RAID档() : null;
  var 槽 = s && s.装备 && s.装备.枪 ? s.装备.枪 : null;
  if (!槽) return { ok: false, 因: '没装备枪' };
  for (var i = 1; i <= 2; i++) {
    var 序 = ((P.枪序 | 0) + (方向 > 0 ? i : -i) + 2) % 2;
    if (槽[序]) return 切枪(序);
  }
  return { ok: false, 因: '身上没有第二把枪' };
}
/* ---------- 真·消耗式弹药：只认胸挂和背包里实际有的子弹 ----------
   以前换弹完直接 S.ammo=S.maxAmmo —— 无限子弹。现在每次换弹都从
   胸挂 → 背包按口径找弹药堆，换弹结束时真扣数量并写档；没有匹配的弹就不装。 */
function 身上弹药(口径, 最多) {
  var 表 = [], 可 = {}, id;
  for (id in RAID_ITEMS) if (RAID_ITEMS.hasOwnProperty(id)) {
    var d = RAID_ITEMS[id];
    if (d.类 === '弹药' && RAID_AMMO[id] && RAID_AMMO[id].口径 === 口径) 可[id] = 1;
  }
  var 容表 = [RAID预设胸挂(), RAID预设背包()], 剩 = 最多 == null ? 1e9 : 最多;
  for (var c = 0; c < 容表.length && 剩 > 0; c++) {
    var 容 = 容表[c];
    if (!容 || !容.件) continue;
    for (var i = 0; i < 容.件.length && 剩 > 0; i++) {
      var it = 容.件[i];
      if (!可[it.id] || (it.n | 0) <= 0) continue;
      var 拿 = Math.min(剩, it.n | 0);
      表.push({ 容: 容, u: it.u, 拿: 拿, id: it.id });
      剩 -= 拿;
    }
  }
  return 表;
}
function 扣弹药(口径, 需要) {
  var 表 = 身上弹药(口径, 需要), 共 = 0;
  for (var i = 0; i < 表.length; i++) {
    var e = 表[i], it = RAID取件(e.容, e.u);
    if (!it) continue;
    it.n = Math.max(0, (it.n | 0) - e.拿);
    共 += e.拿;
    if (it.n <= 0) RAID取出(e.容, e.u);
  }
  if (共 > 0) RAID写档();
  return 共;
}
function 开始换弹() {
  var g = 当前枪();
  if (!g || P.换弹 > 0 || P.切枪 > .2 || S.ammo >= S.maxAmmo) return;
  var 有 = 身上弹药(g.口径, 1);
  if (!有.length) {
    showMsg('胸挂和背包里没有 ' + g.口径 + ' 子弹 —— 先去箱子里搜', '#ff8e8e');
    return;
  }
  P.换弹 = g.换弹 || 2; P.换弹总 = P.换弹;
  P.瞄准中 = false;
  /* 真换弹动画：造一个掉落弹匣挂在相机下，由 刷新武器姿态() 逐帧推它 */
  if (camera) {
    if (换弹掉落) camera.remove(换弹掉落);
    换弹掉落 = new THREE.Group();
    var mg = (typeof 独枪料 === 'function') ? 独枪料() : null;
    var 体 = new THREE.Mesh(new THREE.BoxGeometry(.05, .14, .06),
      mg ? mg.暗 : new THREE.MeshLambertMaterial({ color: 0x22282e }));
    换弹掉落.add(体);
    var 底 = new THREE.Mesh(new THREE.BoxGeometry(.056, .014, .066),
      mg ? mg.钢 : new THREE.MeshLambertMaterial({ color: 0x707b86 }));
    底.position.y = -.075; 换弹掉落.add(底);
    camera.add(换弹掉落);
  }
  showMsg('换弹中 · 从胸挂/背包取 ' + g.口径 + ' 弹', '#9fb2c9');
}
function 完成换弹() {
  P.换弹 = 0; P.换弹总 = 0;
  if (换弹掉落 && camera) { camera.remove(换弹掉落); 换弹掉落 = null; }
  var g = 当前枪();
  if (!g) return;
  var 需 = S.maxAmmo - S.ammo;
  if (需 <= 0) return;
  var 拿 = 扣弹药(g.口径, 需);
  if (拿 > 0) {
    S.ammo += 拿; P.弹匣表[P.枪序 | 0] = S.ammo;
    保存弹匣(); showMsg('装填 ' + 拿 + ' 发 ' + g.口径, '#9fb2c9');
  }
  else showMsg('没有可装填的 ' + g.口径 + ' 子弹', '#ff8e8e');
}
/* ---------- 子弹：每一发都是独立对象，飞出去、撞人、撞墙都有反馈 ----------
   以前是 Raycaster 瞬发 + 画一条线，命中与否当场算完。现在子弹有自己的位置、
   速度、伤害、射程和曳光；按各枪弹速飞行，逐帧做线段命中检测。 */
function 清子弹() {
  if (!scene) return;
  for (var i = 0; i < 子弹表.length; i++) {
    if (子弹表[i].组 && 子弹表[i].组.parent) scene.remove(子弹表[i].组);
  }
  子弹表.length = 0;
  for (var k = 0; k < 火花表.length; k++) if (火花表[k].组.parent) scene.remove(火花表[k].组);
  火花表.length = 0;
}
function 生成火花(点, 色) {
  if (!scene) return;
  var g = new THREE.Group(), 粒 = [];
  for (var i = 0; i < 5; i++) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(.045, 5, 4),
      new THREE.MeshBasicMaterial({ color: 色 || 0xffd166, transparent: true, opacity: .95 }));
    m.position.copy(点); g.add(m);
    粒.push({ 网: m, 速: new THREE.Vector3((Math.random() - .5) * 5, Math.random() * 4, (Math.random() - .5) * 5) });
  }
  scene.add(g); 火花表.push({ 组: g, 粒: 粒, 命: .32 });
}
function 开火() {
  var s0 = (typeof RAID档 === 'function') ? RAID档() : null;
  var 槽0 = s0 && s0.装备 && s0.装备.枪 ? s0.装备.枪 : null;
  var g = 当前枪(), id = (槽0 && 槽0[P.枪序 | 0]) || '';
  var 参 = (g && typeof RAID枪参 === 'function') ? RAID枪参(id) : null;
  if (!g || !参) return;                 /* 没枪就是没枪，不能靠初始 ammo 空手打人 */
  if (P.冷却 > 0 || P.换弹 > 0 || P.切枪 > .45) return;
  if (S.ammo <= 0) { 开始换弹(); return; }
  S.ammo--;
  P.弹匣表[P.枪序 | 0] = S.ammo;   /* 实时同步，撤离时由 78 统一写档 */
  P.冷却 = 60 / Math.max(30, 参.射速);
  P.后坐 = 1;
  var 开镜 = P.瞄准中 || P.瞄准 > .5;
  /* 原版口径：相机只吃 15%（准星轻微上抬），其余 85% 加到子弹方向上 */
  P.pitch = Math.max(-1.32, Math.min(1.32, P.pitch - 参.后坐 * .15));
  同步视角();
  /* 开镜时不累积散布，还会快速收拢；腰射才越打越散 */
  if (!开镜) P.散布 = Math.min(.16, P.散布 + 参.散增);
  else P.散布 = Math.max(0, P.散布 - 参.散增 * 3);
  if (枪口灯) 枪口灯.intensity = 2.6;
  camera.updateMatrixWorld(true);
  var 前向 = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  var 右向 = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  var 上向 = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  var 起 = camera.position.clone().add(右向.clone().multiplyScalar(P.瞄准 > .5 ? 0 : .13))
    .add(上向.clone().multiplyScalar(-.09));
  /* 开镜时子弹必须指哪打哪：散布和后坐随机都归零。
     腰射才保留散布 + 后坐随机。若只收准星不收弹道，就会出现"开镜看着对准却打偏"。 */
  for (var n = 0; n < (参.弹丸 || 1); n++) {
    var 偏X = 开镜 ? 0 : (Math.random() - .5) * 2 * P.散布 * (参.型 === 'shotgun' ? 1.6 : 1);
    var 偏Y = 开镜 ? 0 : (Math.random() - .5) * 2 * P.散布 * (参.型 === 'shotgun' ? 1.6 : 1);
    var 向 = 前向.clone()
      .add(右向.clone().multiplyScalar(偏X))
      .add(上向.clone().multiplyScalar(偏Y + (开镜 ? 0 : 参.后坐 * .85 * Math.random())))
      .normalize();
    发射子弹(起.clone(), 向, 参);
  }
}
function 发射子弹(起, 向, 参) {
  if (!scene || 子弹表.length > 90) return;
  var g = new THREE.Group();
  var 头 = new THREE.Mesh(new THREE.SphereGeometry(.045, 6, 5),
    new THREE.MeshBasicMaterial({ color: 参.曳 || 0xffd166 }));
  g.add(头);
  var 尾 = new THREE.Mesh(new THREE.CylinderGeometry(.006, .026, .85, 6),
    new THREE.MeshBasicMaterial({ color: 参.曳 || 0xffd166, transparent: true, opacity: .5, depthWrite: false }));
  尾.position.z = .42; 尾.rotation.x = Math.PI / 2; g.add(尾);
  g.position.copy(起);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), 向);
  scene.add(g);
  子弹表.push({ 组: g, 位: 起.clone(), 速: 向.clone().multiplyScalar(参.弹速),
    伤: 参.伤, 余: 参.射程, 穿: 参.穿 || 0, 色: 参.曳 || 0xffd166 });
}
function 更新子弹(dt) {
  if (!scene) return;
  var 目标 = [];
  for (var t = 0; t < 敌人.length; t++) 目标.push(敌人[t].组);
  for (var i = 子弹表.length - 1; i >= 0; i--) {
    var b = 子弹表[i], 长 = b.速.length() * dt;
    var 向 = b.速.clone().normalize();
    var rc = new THREE.Raycaster(b.位, 向, 0, 长);
    var 命中 = 目标.length ? rc.intersectObjects(目标, true) : [];
    var 终点 = b.位.clone().addScaledVector(向, 长);
    var 死 = false;
    if (命中.length) {
      var o = 命中[0].object;
      while (o && !o.__敌) o = o.parent;
      /* 子弹也一样：墙比人近就不算命中，不能隔着集装箱打人 */
      if (o && o.__敌 && o.__敌.hp > 0
        && 有视线(b.位.x, b.位.z, 命中[0].point.x, 命中[0].point.z)) {
        /* 玩家打敌人也按部位结算：头 1.75 / 躯干 1 / 四肢 .75 */
        var 部 = 命中部位(命中[0], o), 伤 = Math.round(b.伤 * 部位倍(部));
        o.__敌.hp -= 伤;
        P.命中闪 = .14;
        生成火花(命中[0].point, 部 === '头' ? 0xffe7a3 : 0xff8e6b);
        if (o.__敌.hp <= 0) 击倒(o.__敌);
        死 = true;
      }
    }
    /* 撞墙 / 钻地 / 超射程 */
    if (!死 && (撞墙(终点.x, 终点.z) || 终点.y < .1 || 终点.y > 26)) {
      生成火花(终点, 0xc9d3d8); 死 = true;
    }
    b.余 -= 长; if (b.余 <= 0) 死 = true;
    if (死) { scene.remove(b.组); 子弹表.splice(i, 1); continue; }
    b.位.copy(终点); b.组.position.copy(终点);
  }
  for (var k = 火花表.length - 1; k >= 0; k--) {
    var h = 火花表[k]; h.命 -= dt;
    if (h.命 <= 0) { scene.remove(h.组); 火花表.splice(k, 1); continue; }
    for (var m = 0; m < h.粒.length; m++) {
      h.粒[m].网.position.addScaledVector(h.粒[m].速, dt);
      h.粒[m].速.y -= 12 * dt;
      h.粒[m].网.material.opacity = Math.max(0, h.命 / .32);
    }
  }
}
function 击倒(e) {
  P.击倒++;
  /* 倒地就是一只可搜的尸体容器：掉落走 js/77 的同一套规则 */
  try {
    var c = RAID生成容器('corpse', (Date.now() ^ (Math.random() * 1e9)) | 0, '拾荒者');
    c.x = e.x; c.z = e.z;
    c.模型 = 灰港_做容器('corpse', e.x, e.z);
    RAID_局.容器.push(c);
  } catch (_e) { }
  if (e.组 && e.组.parent) e.组.parent.remove(e.组);
  var k = 敌人.indexOf(e); if (k >= 0) 敌人.splice(k, 1);
  showMsg('击倒拾荒者 · 尸体可搜', '#7bf0bd');
}
function 弹道线(起, 终, 色) {
  if (!scene) return;
  var m = new THREE.Line(new THREE.BufferGeometry().setFromPoints([起, 终]),
    new THREE.LineBasicMaterial({ color: 色, transparent: true, opacity: 0.9 }));
  scene.add(m); 弹道.push({ 线: m, 命: 0.09 });
}
/* 医疗物品：原来这里拿 RAID取件()（只查不取）当消耗用，返回值没有 .ok，
   所以永远走不到恢复分支 —— 表现就是"医疗物品根本用不了"。
   改成 RAID取出() 真拿走一件，回血写档。背包窗的「使用」按钮走同一条路。 */
function 用医疗件(容, u) {
  var it = RAID取件(容, u);
  if (!it) return false;
  var d = RAID物品(it.id);
  if (!d || d.类 !== '医疗') return false;
  if (d.修甲 || d.修头) {
    var 可修 = d.修甲 ? (护甲.上限 && 护甲.值 < 护甲.上限) : (头盔.上限 && 头盔.值 < 头盔.上限);
    if (!可修) {
      showMsg(d.修甲 ? '没穿护甲，或护甲已经满耐久' : '没戴头盔，或头盔已经满耐久', '#ffc75c');
      return false;
    }
  } else if (S.hp >= S.maxHp) { showMsg('体力已满，先留着', '#ffc75c'); return false; }
  /* 只消耗 1 个：整堆取出会把剩下的急救包一起吞掉 */
  if ((it.n | 0) > 1) it.n = (it.n | 0) - 1;
  else if (!RAID取出(容, u)) return false;
  RAID写档();
  if (d.修甲) { 修护甲(d.修甲); return true; }
  if (d.修头) { 修头盔(d.修头); return true; }
  var 回 = d.回血 || 35;
  S.hp = Math.min(S.maxHp, S.hp + 回);
  showMsg('用了 ' + d.名 + '，恢复 ' + 回 + ' 点体力（已消耗）', '#7bf0bd');
  return true;
}
function 用急救() {
  var 表 = [RAID预设背包(), RAID预设胸挂()];
  for (var i = 0; i < 表.length; i++) {
    var c = 表[i]; if (!c || !c.件) continue;
    for (var u = 0; u < c.件.length; u++) if (用医疗件(c, c.件[u].u)) return;
  }
  showMsg('背包和胸挂里没有医疗物品', '#ffc75c');
}

/* ---------- 主循环 ---------- */
function 独立引擎_帧(t) {
  requestAnimationFrame(独立引擎_帧);
  var dt = Math.min(0.05, Math.max(0, (t - 上帧) / 1000)); 上帧 = t;
  if (!renderer) return;

  if (RAID_.对局中 && !RAID_.结算中) {
    if (!S.paused && !RAID_搜刮.开 && !RAID_.背包开) {
      更新玩家(dt);
      更新拾荒者(dt);
      if (P.连发) 开火();
      更新子弹(dt);
      if (P.冷却 > 0) P.冷却 -= dt;
      if (P.换弹 > 0) { P.换弹 -= dt; if (P.换弹 <= 0) 完成换弹(); }
      if (typeof GAME_MODES.raid.tick === 'function') GAME_MODES.raid.tick(dt);
    }
    if (枪口灯 && 枪口灯.intensity > 0) 枪口灯.intensity = Math.max(0, 枪口灯.intensity - dt * 30);
    if (P.切枪 > 0) P.切枪 = Math.max(0, P.切枪 - dt / .26);
    刷新武器姿态(dt);
    /* 散布：开枪涨，停火按枪的收敛速度回落；和原版准星是同一份数据 */
    if (!P.连发) {
      var s0 = (typeof RAID档 === 'function') ? RAID档() : null;
      var 槽0 = s0 && s0.装备 && s0.装备.枪 ? s0.装备.枪 : null;
      var id0 = (槽0 && 槽0[P.枪序 | 0]) || '';
      var 参0 = (当前枪() && typeof RAID枪参 === 'function') ? RAID枪参(id0) : null;
      var 收 = 参0 && 参0.型 === 'pistol' ? .11 : (参0 && 参0.型 === 'shotgun' ? .08 : .07);
      P.散布 = Math.max(0, P.散布 - 收 * dt);
    }
    刷新准星(dt);
    if (P.受击闪 > 0) P.受击闪 = Math.max(0, P.受击闪 - dt);
    for (var i = 弹道.length - 1; i >= 0; i--) {
      弹道[i].命 -= dt;
      if (弹道[i].命 <= 0) { scene.remove(弹道[i].线); 弹道.splice(i, 1); }
      else 弹道[i].线.material.opacity = Math.max(0, 弹道[i].命 / 0.09);
    }
    刷引擎HUD();
  }
  renderer.render(scene, camera);
}
/* ---------- 武器姿态：开镜 / 后坐 / 换弹动画统一在这里算 ----------
   ⚠️ 旧代码把枪模的 z 直接写成 P.后坐*0.09 —— 一开枪 z 从 -0.45 跳到 0，
   枪瞬间贴到相机近裁剪面，看起来就是"开枪后模型消失"。现在永远在基准位上叠加。 */
function 刷新武器姿态(dt) {
  if (!camera) return;
  var 有枪 = !!当前枪();
  var 目标 = (有枪 && P.瞄准中 && !P.换弹 && !RAID_.背包开 && !S.paused && !RAID_.结算中 && 枪模) ? 1 : 0;
  P.瞄准 += (目标 - P.瞄准) * Math.min(1, dt * 14);
  var s = (typeof RAID档 === 'function') ? RAID档() : null;
  var 槽 = s && s.装备 && s.装备.枪 ? s.装备.枪 : null;
  var id = (槽 && 槽[P.枪序 | 0]) || '', g = 当前枪();
  var 参 = (g && typeof RAID枪参 === 'function') ? RAID枪参(id) : null;
  var 镜FOV = 参 ? 参.镜FOV : 76;
  var fov = 76 + (镜FOV - 76) * P.瞄准;
  if (Math.abs(camera.fov - fov) > .12) { camera.fov = fov; camera.updateProjectionMatrix(); }
  /* 高倍镜（镜FOV ≤ 32）才进"镜筒画面"：相机 FOV 已经拉近，再盖一层圆形遮罩和十字线，
     同时藏掉枪模，否则枪身在 22° 视野里会把整个圆糊死。普通枪只拉近视野，不戴镜筒。 */
  var 镜筒 = !!(参 && 参.镜FOV <= 32 && P.瞄准 > .5 && !P.换弹 && !S.paused
    && !RAID_.结算中 && !RAID_.背包开 && 枪模);
  if (引擎HUD元素.镜) {
    var 镜显 = 镜筒 ? 'block' : 'none';
    if (引擎HUD元素.镜.style.display !== 镜显) 引擎HUD元素.镜.style.display = 镜显;
  }
  if (枪模) 枪模.visible = !镜筒;
  P.后坐 = Math.max(0, P.后坐 - dt * 7.5);
  P.命中闪 = Math.max(0, P.命中闪 - dt);
  if (!有枪) {
    /* 双手固定在画面下缘，不跟着枪的 ADS/后坐/切枪动画跑 */
    if (枪模) {
      枪模.visible = true;
      枪模.position.set(0, -.2, -.32);
      枪模.rotation.set(0, 0, 0);
    }
    return;
  }
  if (!枪模) return;                            /* 有枪却还没建出模型时只恢复 FOV */

  var 进 = P.换弹总 > 0 ? (1 - P.换弹 / P.换弹总) : 0;
  var 沉 = (进 > 0 && 进 < 1) ? Math.sin(进 * Math.PI) : 0;   /* 中段沉枪 + 转握把 */
  var x = 枪基位.x + (枪瞄位.x - 枪基位.x) * P.瞄准;
  var y = 枪基位.y + (枪瞄位.y - 枪基位.y) * P.瞄准;
  var z = 枪基位.z + (枪瞄位.z - 枪基位.z) * P.瞄准;
  var 摆 = P.移动 > 0 ? Math.sin(performance.now() / 1000 * 10) * .006 * P.移动 : 0;
  /* 切枪：抽枪时下沉并侧转，落位后回正；和换弹沉枪叠加但不互相覆盖 */
  var 切 = P.切枪 > 0 ? Math.sin((1 - P.切枪) * Math.PI) : 0;
  枪模.position.set(x + 摆 + 切 * .10, y + Math.abs(摆) * .6 - 沉 * .26 - 切 * .34,
    z + P.后坐 * .055 + 切 * .05);
  枪模.rotation.set(沉 * .48 - P.后坐 * .035 + 切 * .35, 切 * .5, 沉 * .2 + 切 * .22);
  /* 掉出来的旧弹匣：前半段往下掉并翻面，后半段消失（新弹匣"插回"） */
  if (换弹掉落) {
    var 落 = Math.min(1, 进 * 2.2);
    换弹掉落.position.set(x + .04, y - .1 - 落 * .7, z + .05 + 落 * .12);
    换弹掉落.rotation.set(落 * 2.4, 落 * .9, 落 * 1.2);
    换弹掉落.visible = 进 < .62;
  }
}
/* 准星：照原版 _准星刷新 的口径 —— 四段线按真实散布张开/收拢，命中闪单独一层 */
function 刷新准星(dt) {
  var el = 引擎HUD元素.准星;
  if (!el) return;
  var 镜 = (P.瞄准中 || P.瞄准 > .5);
  var h = window.innerHeight || 720;
  var t = Math.tan((camera ? camera.fov : 76) * Math.PI / 360);
  var 散 = 镜 ? 0 : P.散布;
  var px = t > .0001 ? 散 * (h / 2) / t : 0;
  px = Math.max(0, Math.min(90, px));
  if (!P.onGround && !镜) px += 3;
  px += 镜 ? 0 : Math.min(14, P.后坐 * 90);
  var 目标 = 镜 ? 2 : (4 + px);             /* 开镜留 2px 中心小十字，腰射 4px 静息间隙 */
  if (typeof P.xhairGap !== 'number') P.xhairGap = 目标;
  P.xhairGap += (目标 - P.xhairGap) * Math.min(1, dt * 18);
  if (Math.abs(P.xhairGap - (P.xhairGap写 || -999)) > .35) {
    P.xhairGap写 = P.xhairGap;
    el.style.setProperty('--gap', P.xhairGap.toFixed(1) + 'px');
  }
  /* 普通开镜留中心小十字；高倍镜已经自带镜内十字，别再叠一层腰射准星 */
  var 镜筒显示 = !!(引擎HUD元素.镜 && 引擎HUD元素.镜.style.display === 'block');
  var 显 = 镜筒显示 ? '0' : '1';
  if (el.style.opacity !== 显) el.style.opacity = 显;
  if (引擎HUD元素.命中) {
    var m = P.命中闪 > 0 ? '1' : '0';
    if (引擎HUD元素.命中.style.opacity !== m) 引擎HUD元素.命中.style.opacity = m;
  }
}
/* 切场景 / 开背包 / 结算时强制退出镜筒：主循环在结算后不再刷新姿态，
   不主动收掉的话圆形遮罩会留在结算页上。 */
function 隐藏镜筒() {
  P.瞄准中 = false; P.瞄准 = 0;
  if (引擎HUD元素.镜) 引擎HUD元素.镜.style.display = 'none';
  if (枪模) 枪模.visible = true;
  if (camera && Math.abs(camera.fov - 76) > .12) { camera.fov = 76; camera.updateProjectionMatrix(); }
}
function 更新玩家(dt) {
  /* 先撤掉上一帧的探头/蹲下偏移：碰撞与重力永远基于脚下的真实位置，
     否则偏移会逐帧累加，人越走越歪。 */
  camera.position.x -= P.上帧偏X;
  camera.position.z -= P.上帧偏Z;
  camera.position.y -= P.上帧偏Y;
  P.上帧偏X = P.上帧偏Z = P.上帧偏Y = 0;
  /* 镜头摇晃也是逐帧叠加的偏移，先撤掉，否则会和探头一起越积越歪 */
  camera.position.x -= P.摇X;
  camera.position.y -= P.摇Y;
  camera.position.z -= P.摇Z;
  P.摇X = P.摇Y = P.摇Z = 0;

  var 停姿态 = S.paused || RAID_.背包开 || (typeof RAID_搜刮 !== 'undefined' && RAID_搜刮.开);
  /* Q 左探 / E 右探，Ctrl 或 C 蹲下；暂停、开包、搜刮时自动恢复站姿 */
  P.探头 = 停姿态 ? 0 : ((keys.KeyQ ? -1 : 0) + (keys.KeyE ? 1 : 0));
  P.蹲 = !停姿态 && !!(keys.ControlLeft || keys.ControlRight || keys.KeyC) && P.onGround;
  P.探头值 += (P.探头 - P.探头值) * Math.min(1, dt * 14);
  P.蹲值 += ((P.蹲 ? 1 : 0) - P.蹲值) * Math.min(1, dt * 14);

  var 冲刺 = !!(keys.ShiftLeft || keys.ShiftRight);
  var sp = 冲刺 ? 13 : 8.4;
  if (P.蹲) sp *= .55;                          /* 蹲着走更慢 */
  var f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  var s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  /* 起步约 0.16s、松手约 0.10s、换向约 0.12s 到位：既不是一按键弹出去，
     也不会像穿泥。用真实世界时间做指数逼近，帧率变了手感不变。 */
  var 目标X = 0, 目标Z = 0;
  if (f || s) {
    var l = Math.hypot(f, s); f /= l; s /= l;
    目标X = (-Math.sin(P.yaw) * f + Math.cos(P.yaw) * s) * sp;
    目标Z = (-Math.cos(P.yaw) * f - Math.sin(P.yaw) * s) * sp;
  }
  var 响应 = (f || s) ? (冲刺 ? .14 : .17) : .10;
  var 系 = 1 - Math.exp(-dt / 响应);
  P.速X += (目标X - P.速X) * 系;
  P.速Z += (目标Z - P.速Z) * 系;
  if (Math.abs(P.速X) < .02) P.速X = 0;
  if (Math.abs(P.速Z) < .02) P.速Z = 0;
  var dx = P.速X * dt, dz = P.速Z * dt;
  if (撞墙(camera.position.x + dx, camera.position.z, 玩家半径, camera.position.y)) { P.速X = 0; dx = 0; }
  else camera.position.x += dx;
  if (撞墙(camera.position.x, camera.position.z + dz, 玩家半径, camera.position.y)) { P.速Z = 0; dz = 0; }
  else camera.position.z += dz;
  P.移动 = Math.min(1, Math.hypot(P.速X, P.速Z) / Math.max(1, sp));
  P.横移 += (((f || s) ? s : 0) - P.横移) * (1 - Math.exp(-dt / .13));
  /* 纵向：先落，再查头顶楼板，最后按脚下最高面站住 */
  P.velY -= 21 * dt;
  camera.position.y += P.velY * dt;
  var 头底 = 碰头(camera.position.x, camera.position.z, camera.position.y);
  if (头底 != null) {
    camera.position.y = 头底 - 玩家头高 - .01;
    if (P.velY > 0) P.velY = 0;
  }
  var 支撑 = 地面眼高(camera.position.x, camera.position.z, camera.position.y);
  if (camera.position.y <= 支撑) {
    camera.position.y = 支撑; P.velY = 0; P.onGround = true;
  } else {
    P.onGround = false;
  }

  /* 本帧偏移：探头沿相机右向平移视点，蹲下压低视高；撞墙就不探出去 */
  var 右x = Math.cos(P.yaw), 右z = -Math.sin(P.yaw);
  var 探 = P.探头值 * .58;
  var ox = 右x * 探, oz = 右z * 探;
  if (探 && 撞墙(camera.position.x + ox, camera.position.z + oz)) { ox = 0; oz = 0; }
  var oy = -P.蹲值 * .58;
  camera.position.x += ox; camera.position.z += oz; camera.position.y += oy;
  P.上帧偏X = ox; P.上帧偏Z = oz; P.上帧偏Y = oy;

  /* 行走镜头摇晃（view bob）：步频跟移速，冲刺更急；蹲下、静止、暂停都不摇。
     位置偏移与探头一样逐帧撤销；旋转是每帧直接赋值，避免被开火的 rotation.set 冲掉。 */
  var 走 = P.移动 > .02 && !停姿态;
  if (走) P.摇晃相 += dt * ((keys.ShiftLeft || keys.ShiftRight) ? 13 : 9.5) * Math.max(.4, P.移动);
  var 摆 = 走 ? Math.sin(P.摇晃相) * P.移动 : 0;
  var 起 = 走 ? Math.abs(Math.cos(P.摇晃相)) * .038 * P.移动 * (P.蹲值 ? .4 : 1) : 0;
  var rx = 右x * 摆 * .022, rz = 右z * 摆 * .022;
  camera.position.x += rx; camera.position.y += 起; camera.position.z += rz;
  P.摇X = rx; P.摇Y = 起; P.摇Z = rz;
  /* 滚转也走 同步视角：pitch/yaw/roll 一次性写入，不再单独改 rotation.z */
  P.滚 = 摆 * .007 - P.横移 * .012;
  同步视角();
}

/* ---------- 引擎 HUD：准星 / 血量 / 弹药 / 击倒 / 鼠标提示 ---------- */
function 建引擎HUD() {
  var d = document.createElement('div'); d.id = 'raidEngineHud';
  d.style.cssText = 'position:fixed;inset:0;z-index:305;pointer-events:none;'
    + 'font-family:system-ui,"Microsoft YaHei",sans-serif;color:#e8eefc;';
  d.innerHTML = '<style>'
    + '#rdCross{position:absolute;left:50%;top:50%;width:0;height:0;--gap:4px;--len:8px;transition:opacity .12s linear}'
    + '#rdCross i{position:absolute;display:block;background:#f4f8ff;border-radius:1px;'
    + 'box-shadow:0 0 0 1px rgba(0,0,0,.82),0 0 5px rgba(0,0,0,.45)}'
    + '#rdCross i.u,#rdCross i.d{width:2px;height:var(--len);left:-1px}'
    + '#rdCross i.l,#rdCross i.r{height:2px;width:var(--len);top:-1px}'
    + '#rdCross i.u{top:calc(-1*(var(--gap) + var(--len)))}'
    + '#rdCross i.d{top:var(--gap)}'
    + '#rdCross i.l{left:calc(-1*(var(--gap) + var(--len)))}'
    + '#rdCross i.r{left:var(--gap)}'
    + '#rdCross .dot{position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:3px;height:3px;'
    + 'border-radius:50%;background:#ff4d4d;box-shadow:0 0 0 1px rgba(0,0,0,.65)}'
    + '#rdHit{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;transition:opacity .06s}'
    + '#rdHit i{position:absolute;width:9px;height:2px;background:#fff;border-radius:1px;'
    + 'box-shadow:0 0 0 1px rgba(0,0,0,.8)}'
    + '#rdHit i:nth-child(1){left:6px;top:6px;transform:rotate(45deg)}'
    + '#rdHit i:nth-child(2){left:-15px;top:6px;transform:rotate(-45deg)}'
    + '#rdHit i:nth-child(3){left:6px;top:-8px;transform:rotate(-45deg)}'
    + '#rdHit i:nth-child(4){left:-15px;top:-8px;transform:rotate(45deg)}'
    + '#rdScope{position:absolute;inset:0;z-index:1;display:none;pointer-events:none;'
    + 'background:radial-gradient(circle at 50% 50%,rgba(0,0,0,0) 0,rgba(0,0,0,0) 28vmin,'
    + 'rgba(2,5,8,.96) 29vmin,#010406 100%)}'
    + '#rdScope i{position:absolute;left:50%;top:50%;display:block}'
    + '#rdScope .ring{width:56vmin;height:56vmin;transform:translate(-50%,-50%);border-radius:50%;'
    + 'border:1px solid rgba(186,214,224,.4);box-shadow:inset 0 0 26px rgba(0,0,0,.88)}'
    + '#rdScope .h{width:56vmin;height:1px;transform:translate(-50%,-50%);'
    + 'background:linear-gradient(90deg,rgba(14,20,22,.95) 0 46%,transparent 46% 54%,rgba(14,20,22,.95) 54% 100%)}'
    + '#rdScope .v{width:1px;height:56vmin;transform:translate(-50%,-50%);'
    + 'background:linear-gradient(180deg,rgba(14,20,22,.95) 0 46%,transparent 46% 54%,rgba(14,20,22,.95) 54% 100%)}'
    + '#rdScope .dot{width:3px;height:3px;transform:translate(-50%,-50%);border-radius:50%;background:#101719}</style>'
    + '<div id="rdScope"><i class="ring"></i><i class="h"></i><i class="v"></i><i class="dot"></i></div>'
    + '<div id="rdCross"><i class="u"></i><i class="d"></i><i class="l"></i><i class="r"></i><div class="dot"></div></div>'
    + '<div id="rdHit"><i></i><i></i><i></i><i></i></div>'
    + '<div id="rdVit" style="position:absolute;right:16px;bottom:18px;text-align:right;line-height:1.9">'
    + '<div style="font-size:12px;color:#93a4bc">体力 <b id="rdHpN" style="color:#7bf0bd;font-size:17px">100</b></div>'
    + '<div style="width:180px;height:7px;border-radius:5px;background:rgba(0,0,0,.55);overflow:hidden">'
    + '<i id="rdHpB" style="display:block;height:100%;width:100%;background:linear-gradient(90deg,#2f9e6e,#7bf0bd)"></i></div>'
    + '<div style="font-size:12px;color:#93a4bc">护甲 <b id="rdArm" style="color:#8fb8e8;font-size:13px">—</b></div>'
    + '<div style="width:180px;height:5px;border-radius:4px;background:rgba(0,0,0,.55);overflow:hidden">'
    + '<i id="rdArmB" style="display:block;height:100%;width:0;background:linear-gradient(90deg,#3f76b8,#9dd0ff)"></i></div>'
    + '<div style="font-size:12px;color:#93a4bc">头盔 <b id="rdHelm" style="color:#d7c68f;font-size:13px">—</b></div>'
    + '<div style="width:180px;height:5px;border-radius:4px;background:rgba(0,0,0,.55);overflow:hidden">'
    + '<i id="rdHelmB" style="display:block;height:100%;width:0;background:linear-gradient(90deg,#8a7a45,#e4d39b)"></i></div>'
    + '<div style="font-size:12px;color:#93a4bc">弹药 <b id="rdAmmo" style="color:#ffd166;font-size:17px">15 / 15</b></div>'
    + '<div id="rdKill" style="font-size:11px;color:#8fa0b8">击倒 0</div>'
    + '<div style="font-size:11px;color:#8293a6;margin-top:3px">Esc 暂停 · B 背包 · R 换弹 · H 急救 · 右键开镜</div></div>'
    + '<div id="rdLock" style="position:absolute;left:50%;top:58%;transform:translate(-50%,-50%);'
    + 'padding:9px 16px;border-radius:10px;background:rgba(8,12,18,.82);border:1px solid rgba(255,209,102,.5);'
    + 'color:#ffd166;font-size:13px;font-weight:800;display:none">点击画面锁定鼠标</div>'
    + '<div id="rdHurt" style="position:absolute;inset:0;background:rgba(190,30,30,.24);opacity:0"></div>';
  document.body.appendChild(d);
  引擎HUD = d;
  引擎HUD元素 = {
    准星: d.querySelector('#rdCross'), 命中: d.querySelector('#rdHit'), 镜: d.querySelector('#rdScope'),
    血: d.querySelector('#rdHpN'), 血条: d.querySelector('#rdHpB'),
    甲: d.querySelector('#rdArm'), 甲条: d.querySelector('#rdArmB'),
    盔: d.querySelector('#rdHelm'), 盔条: d.querySelector('#rdHelmB'),
    弹: d.querySelector('#rdAmmo'), 击: d.querySelector('#rdKill'), 锁提: d.querySelector('#rdLock'),
    伤: d.querySelector('#rdHurt')
  };
}
function 刷引擎HUD() {
  var e = 引擎HUD元素;
  if (!e.血) return;
  e.血.textContent = Math.ceil(S.hp);
  e.血条.style.width = Math.max(0, S.hp / S.maxHp * 100) + '%';
  if (e.甲) {
    e.甲.textContent = 护甲.上限 ? (护甲.值 + '/' + 护甲.上限 + (护甲.值 <= 0 ? ' · 破损' : '')) : '—';
    e.甲.style.color = 护甲.值 <= 0 ? '#ff8e8e' : '#8fb8e8';
    e.甲条.style.width = (护甲.上限 ? 护甲.值 / 护甲.上限 : 0) * 100 + '%';
  }
  if (e.盔) {
    e.盔.textContent = 头盔.上限 ? (头盔.值 + '/' + 头盔.上限 + (头盔.值 <= 0 ? ' · 破损' : '')) : '—';
    e.盔.style.color = 头盔.值 <= 0 ? '#ff8e8e' : '#d7c68f';
    e.盔条.style.width = (头盔.上限 ? 头盔.值 / 头盔.上限 : 0) * 100 + '%';
  }
  var g = 当前枪(), 备 = 0;
  if (g) {
    var 列 = 身上弹药(g.口径);
    for (var i = 0; i < 列.length; i++) 备 += 列[i].拿;
  }
  e.弹.textContent = g ? (S.ammo + ' / ' + S.maxAmmo + ' · 备 ' + 备 + (P.换弹 > 0 ? ' · 换弹中' : ''))
    : '空手 · 未装备枪械';
  e.击.textContent = '击倒 ' + P.击倒;
  e.伤.style.opacity = P.受击闪 > 0 ? String(Math.min(1, P.受击闪 * 2.4)) : '0';
  if (!鼠标已锁() && !RAID_搜刮.开 && !RAID_.背包开 && !RAID_局.结算中) e.锁提.style.display = 'block';
}

/* ==================================================================================
   局内背包：按 B 打开，解锁鼠标。
   排版对齐准备层仓库：左栏=三个随身容器的占格网格（用 js/78 的 搜画网格，所见即仓库那套），
   中栏=装备槽（枪 / 头盔 / 护甲 / 胸挂 / 背包 / 安全箱），右栏=详情。
   网格拖拽直接复用 78 的 搜绑网格（window 上已绑 pointermove/up）。
   —— 容器名故意用 rig/bp/safe，正好指向同一份 RAID预设*，拖拽落点解析零改动。
   绝不碰仓库：仓库是安全屋，局内只能动自己身上的东西。
   ================================================================================== */
var 背包窗 = null, 背包选中 = null, 背包拖后监听 = false;
/* 局内网格的 data-k 用 78 认识的容器键；搜打撤_取容器('rig'/'bp'/'safe') 正好是身上这三件 */
function 背包容器表() {
  return [
    { 键: 'rig', 名: '胸挂', 容: RAID预设胸挂() },
    { 键: 'bp', 名: '背包', 容: RAID预设背包() },
    { 键: 'safe', 名: '安全箱', 容: RAID安全箱() }
  ];
}
function 开背包() {
  if (!RAID_.对局中 || RAID_.结算中 || RAID_搜刮.开 || RAID_.背包开) return;
  RAID_.背包开 = true;
  S.paused = true;
  P.连发 = false;
  P.速X = P.速Z = P.移动 = 0;
  隐藏镜筒();
  try { document.exitPointerLock(); } catch (e) { }
  if (!背包窗) {
    背包窗 = document.createElement('div');
    背包窗.id = 'rdFieldBag';
    背包窗.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
      + 'width:min(1140px,96vw);height:min(760px,94vh);z-index:10001;display:none;'
      + 'background:linear-gradient(160deg,rgba(18,25,31,.98),rgba(10,14,19,.98));'
      + 'border:1px solid rgba(122,158,173,.35);border-radius:14px;color:#dfe9f0;'
      + 'box-shadow:0 24px 80px rgba(0,0,0,.75);'
      + 'font-family:system-ui,"Microsoft YaHei",sans-serif;pointer-events:auto;';
    背包窗.innerHTML = '<div id="rdBagTop" style="display:flex;align-items:center;justify-content:space-between;'
      + 'padding:12px 20px;border-bottom:1px solid rgba(255,255,255,.09)">'
      + '<b style="font-size:16px;letter-spacing:1px">🎒 随身背包 <small style="font-size:11px;color:#8ea1b2;font-weight:400">'
      + '· 拖动整理 · 占格显示 · 局内只能动身上的东西</small></b>'
      + '<button id="rdBagClose" style="border:1px solid rgba(255,255,255,.2);background:#26313a;color:#dfe9f0;'
      + 'border-radius:7px;padding:6px 14px;cursor:pointer">关闭 (B)</button></div>'
      + '<div style="display:flex;height:calc(100% - 49px)">'
      + '<div id="rdBagCols" style="flex:1 1 auto;min-width:0;overflow:auto;padding:14px 18px"></div>'
      + '<div id="rdBagGear" style="flex:0 0 232px;border-left:1px solid rgba(255,255,255,.08);padding:14px;overflow:auto"></div>'
      + '<div id="rdBagInfo" style="flex:0 0 250px;border-left:1px solid rgba(255,255,255,.08);padding:14px;overflow:auto"></div>'
      + '</div>';
    document.body.appendChild(背包窗);
    背包窗.querySelector('#rdBagClose').addEventListener('click', 关背包);
  }
  /* 78 的拖放结束会刷准备层；这里补一个监听，让局内窗在拖完后同步重画。
     只绑一次，靠 RAID_.背包开 守卫：不在局内背包时完全不做功。 */
  if (!背包拖后监听) {
    背包拖后监听 = true;
    window.addEventListener('pointerup', function () {
      if (!RAID_.背包开 || !背包窗 || 背包窗.style.display === 'none') return;
      setTimeout(function () { if (RAID_.背包开) 画背包(); }, 0);
    }, { passive: true });
  }
  背包窗.style.display = 'block';
  画背包();
}
function 关背包() {
  if (!RAID_.背包开) return;
  RAID_.背包开 = false;
  背包选中 = null;
  if (背包窗) 背包窗.style.display = 'none';
  if (RAID_.对局中 && !RAID_.结算中 && !RAID_搜刮.开) {
    S.paused = false;
    try { lockPointer(); } catch (e) { }
  }
}
/* 局内卸装：脱下来的东西必须落进随身容器，绝不能隔空回到仓库。
   胸挂只收弹药/医疗等小件，枪/甲/盔只有背包收，所以先找背包再找胸挂。 */
function 局内容器收(容, 类) {
  var 收 = (typeof RAID容器收 === 'function') ? RAID容器收(容) : null;
  return !收 || 收.indexOf(类) >= 0;
}
/* 局内从随身容器给空槽穿一件：只翻背包/胸挂，绝不碰仓库（那是安全屋）。
   空装备槽点一下就走这里 —— 之前只有详情按钮能穿，玩家点了槽没反应。 */
function 局内穿装(key) {
  var s = (typeof RAID档 === 'function') ? RAID档() : null;
  if (!s) return { ok: false, 因: '存档没读出来' };
  var 类 = (key === '枪' || key === '枪2') ? '枪' : key;
  if (key === '枪2' && !(s.装备.枪 && s.装备.枪[0])) return { ok: false, 因: '先穿主手，再穿副手' };
  var 表 = [RAID预设背包(), RAID预设胸挂()], 找 = null, id = '', 耐 = 0;
  for (var i = 0; i < 表.length && !找; i++) {
    var c = 表[i]; if (!c || !c.件) continue;
    for (var j = 0; j < c.件.length; j++) {
      var it = c.件[j], d = RAID物品(it.id);
      if (!d || d.类 !== 类 || (it.n | 0) <= 0) continue;
      找 = { 容: c, u: it.u }; id = it.id; 耐 = it.耐 | 0; break;
    }
  }
  if (!找) return { ok: false, 因: '随身背包/胸挂里没有' + (类 === '枪' ? '枪' : 类) + '，先去箱子里搜' };
  var r = (类 === '枪') ? RAID穿枪(id) : RAID穿(key, id);
  if (!r.ok) return r;
  if (类 === '护甲' || 类 === '头盔') {
    if (!s.装备耐久) s.装备耐久 = { 护甲: { id: '', 值: 0 }, 头盔: { id: '', 值: 0 } };
    var d0 = RAID物品(id);
    s.装备耐久[类] = { id: id, 值: 耐 > 0 ? 耐 : (d0.耐 | 0) };
  }
  return { ok: true, 名: RAID物品(id).名 };
}
function 局内卸装(key) {
  var s = (typeof RAID档 === 'function') ? RAID档() : null;
  if (!s) return { ok: false, 因: '存档没读出来' };
  var 序 = (key === '枪' || key === '枪2') ? (key === '枪' ? 0 : 1) : -1;
  var 枪 = 序 >= 0 ? RAID枪械(序) : null;
  var 旧 = 序 >= 0 ? (枪 ? { id: 枪.id } : null) : RAID槽件(key);
  if (!旧 || !旧.id) return { ok: false, 因: '这个槽是空的' };
  var d0 = RAID物品(旧.id);
  if (!d0) return { ok: false, 因: '未知装备' };
  var 备 = (key === '背包') ? null : RAID预设背包();
  var 胸 = (key === '胸挂') ? null : RAID预设胸挂();
  var 目标 = null, 名 = '';
  if (备 && 局内容器收(备, d0.类)) { 目标 = 备; 名 = '背包'; }
  else if (胸 && 局内容器收(胸, d0.类)) { 目标 = 胸; 名 = '胸挂'; }
  if (!目标) return { ok: false, 因: '没穿能装下' + d0.名 + '的随身容器（枪/甲/盔要背包），局内不会往仓库塞东西' };
  var 新件 = RAID新件(旧.id, 1);
  if (!新件) return { ok: false, 因: '未知装备' };
  /* 容器槽把里面的东西一起带走，内层只认 件.内.件 */
  if (旧.内 && 旧.内.件 && 旧.内.件.length) {
    if (!新件.内) 新件.内 = { id: 新件.id, 件: [] };
    新件.内.件 = 旧.内.件;
  }
  var r = RAID放入(目标, 新件);
  if (!r.ok) return { ok: false, 因: 名 + '放不下（' + r.因 + '）' };
  if (序 >= 0) s.装备.枪[序] = null;
  else if (key === '安全箱') s.安全箱 = { id: '', 内: null };
  else if (d0.类 === '头盔' || d0.类 === '护甲') {
    /* 旧甲/旧盔的剩余耐久写回件上，丢进背包后估值才反映损耗 */
    var 记 = s.装备耐久 && s.装备耐久[d0.类];
    if (记 && 记.id === 旧.id) 新件.耐 = 记.值;
    if (!s.装备耐久) s.装备耐久 = { 护甲: { id: '', 值: 0 }, 头盔: { id: '', 值: 0 } };
    s.装备耐久[d0.类] = { id: '', 值: 0 };
    s.装备[key] = '';
  }
  else s.装备[key] = null;
  RAID写档();
  return { ok: true, 件: 新件, 容: 名 };
}
/* 装备槽小格：显示当前穿的东西，点击卸下（局内塞进背包，不回仓库）。
   key 与 78 的 data-slot 一致，图标同样走 RAID图标。 */
function 背包装备格(key, 标题) {
  var s = (typeof RAID档 === 'function') ? RAID档() : null;
  var 件 = (typeof RAID槽件 === 'function') ? RAID槽件(key) : null;
  var 枪 = null;
  if (key === '枪' || key === '枪2') 枪 = (typeof RAID枪械 === 'function') ? RAID枪械(key === '枪' ? 0 : 1) : null;
  var d = 枪 || (件 ? RAID物品(件.id) : null);
  var 图 = (d && window.RAID图标) ? RAID图标(d.id) : '';
  var 有 = !!d;
  var 卸键 = key;
  return '<div data-bag-slot="' + 卸键 + '" data-bag-empty="' + (有 ? '' : 卸键) + '"'
    + ' title="' + (有 ? '点「卸下」收回随身容器' : '点这里从随身背包/胸挂穿一件') + '"'
    + ' style="border:1px solid ' + (有 ? 'rgba(169,198,212,.35)' : 'rgba(255,209,102,.3)')
    + ';border-radius:9px;background:rgba(255,255,255,.035);padding:8px;margin-bottom:9px;cursor:pointer">'
    + '<div style="display:flex;align-items:center;gap:8px">'
    + '<span style="width:30px;height:30px;flex:none;display:block">' + 图 + '</span>'
    + '<div style="min-width:0;flex:1"><div style="font-size:11px;color:#8ea1b2">' + 标题 + '</div>'
    + '<div style="font-size:12px;color:' + (有 ? '#dfe9f0' : '#63717e') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
    + (有 ? d.名 : '空 · 点此穿上') + '</div></div>'
    + (有 ? '<button data-bag-unset="' + 卸键 + '" style="font-size:10.5px;padding:3px 7px;border-radius:6px;'
      + 'border:1px solid rgba(255,255,255,.18);background:#26313a;color:#c9d7e2;cursor:pointer">卸下</button>' : '')
    + '</div></div>';
}
function 画背包() {
  if (!背包窗) return;
  var 列 = 背包窗.querySelector('#rdBagCols');
  var gear = 背包窗.querySelector('#rdBagGear');
  var 详 = 背包窗.querySelector('#rdBagInfo');
  if (typeof 搜算格 === 'function' && typeof 仓格 !== 'undefined') 仓格 = 搜算格();

  /* ---- 左栏：三个随身容器的真实占格网格（和准备层仓库同一套 搜画网格）---- */
  var 表 = 背包容器表(), h = '';
  for (var i = 0; i < 表.length; i++) {
    var c = 表[i], 容 = c.容;
    h += '<div style="margin-bottom:14px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
      + '<b style="font-size:13px;color:#a9c6d4">' + c.名 + (容 ? '' : ' <span style="color:#6f7d88">（未携带）</span>') + '</b>'
      + '<span style="font-size:11px;color:#8ea1b2">' + (容 ? (typeof RAID容器格数 === 'function' ? RAID容器格数(容).用 + '/' + RAID容器格数(容).共 + ' 格 · ' : '') + RAID容器件数(容) + ' 件' : '') + '</span></div>'
      + '<div class="rdGridWrap"><div class="rdGrid" id="rdBagGrid_' + c.键 + '"></div></div></div>';
  }
  列.innerHTML = h;
  /* 用 78 的函数画占格网格：data-k = rig/bp/safe，落点解析直接复用；
     再绑 搜绑网格，点选/拖拽/快移全部和仓库一致。 */
  if (typeof 搜画网格 === 'function' && typeof 搜绑网格 === 'function') {
    for (var g = 0; g < 表.length; g++) {
      var 根 = 背包窗.querySelector('#rdBagGrid_' + 表[g].键);
      if (!根) continue;
      搜画网格(表[g].容, 根, 表[g].键);
      搜绑网格(根);
      /* 78 的 click 只调 搜选中() 刷准备层；这里补一个后到的监听重画局内窗，
         于是"点占格物品 → 右栏出详情"和仓库里一样即时。拖拽落点的重画由 pointerup 监听管。 */
      根.addEventListener('click', function () {
        if (!RAID_.背包开) return;
        /* 刚拖完那一下浏览器会补 click，和 78 的吞点窗口对齐，别重复重画 */
        if (typeof 搜拖吞点 !== 'undefined' && Date.now() - 搜拖吞点 < 350) return;
        setTimeout(function () { if (RAID_.背包开) 画背包(); }, 0);
      });
    }
  }

  /* ---- 中栏：装备槽（能卸下；穿上用右栏详情的按钮）---- */
  var gh = '<div style="font-size:12px;color:#8ea1b2;margin:2px 0 10px;letter-spacing:.5px">身上装备</div>'
    + 背包装备格('枪', '主武器')
    + 背包装备格('枪2', '副武器')
    + 背包装备格('头盔', '头盔')
    + 背包装备格('护甲', '护甲')
    + 背包装备格('胸挂', '胸挂')
    + 背包装备格('背包', '背包')
    + 背包装备格('安全箱', '安全箱');
  gear.innerHTML = gh;
  var 卸钮 = gear.querySelectorAll('[data-bag-unset]');
  for (var q = 0; q < 卸钮.length; q++) 卸钮[q].addEventListener('click', function (e) {
    e.stopPropagation();
    var key = this.getAttribute('data-bag-unset');
    var r = 局内卸装(key);
    if (!r.ok) { showMsg(r.因 || '卸不下来', '#ff8e8e'); return; }
    if (key === '护甲' || key === '头盔') 初始化护甲();
    if (key === '枪' || key === '枪2') rebuildWeaponModel();
    showMsg('已卸下，放进' + r.容 + '（局内不会回仓库）', '#ffc75c');
    画背包(); 刷引擎HUD();
  });
  /* 空槽点一下就穿：从随身背包/胸挂找对应类，找不到给中文提示 */
  var 空槽 = gear.querySelectorAll('[data-bag-empty]');
  for (var w = 0; w < 空槽.length; w++) 空槽[w].addEventListener('click', function (e) {
    e.stopPropagation();
    var key = this.getAttribute('data-bag-empty');
    if (!key) return;
    var r = 局内穿装(key);
    if (!r.ok) { showMsg(r.因 || '穿不上', '#ff8e8e'); return; }
    if (key === '护甲' || key === '头盔') 初始化护甲();
    if (key === '枪' || key === '枪2') rebuildWeaponModel();
    showMsg('已穿上 ' + r.名, '#9fb2c9');
    画背包(); 刷引擎HUD();
  });

  /* ---- 右栏：详情。选中真源统一用 78 的 RAID_选（点格子/拖拽后自动同步）---- */
  var 选 = (typeof RAID_选 !== 'undefined') ? RAID_选 : null;
  var s = '';
  var 用容 = 选 ? (typeof 搜打撤_取容器 === 'function' ? 搜打撤_取容器(选.容) : null) : null;
  var tt = (用容 && 选) ? RAID取件(用容, 选.u) : null;
  if (!tt) {
    s = '<div style="color:#7f8fa0;font-size:12px;line-height:1.9">'
      + '点一个物品看详情，<b style="color:#ffd166">拖动</b>可整理到别的格子。<br><br>'
      + '换弹会<b style="color:#ffd166">真的扣掉</b>胸挂/背包里的子弹；'
      + '急救包用完也会消失。<br><br>安全箱里的东西死了也保住。</div>';
    详.innerHTML = s;
    return;
  }
  var dd = RAID物品(tt.id), 稀 = RAID_RARITY[dd && dd.稀有] || RAID_RARITY[0];
  s = '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">'
    + '<span style="width:46px;height:46px">' + (window.RAID图标 ? RAID图标(tt.id) : '') + '</span>'
    + '<div><b style="font-size:14px;color:' + 稀.色 + '">' + (dd ? dd.名 : tt.id) + '</b>'
    + '<div style="font-size:11px;color:#8ea1b2">' + (dd && dd.描 ? dd.类 : '') + (tt.n > 1 ? ' · ' + tt.n + ' 个' : '')
    + (dd && dd.格 ? ' · 占 ' + dd.格[0] + '×' + dd.格[1] + ' 格' : '') + '</div></div></div>'
    + '<div style="font-size:12px;color:#a9b8c6;line-height:1.9;border-top:1px solid rgba(255,255,255,.08);padding-top:10px">'
    + '价值 ' + Math.round(RAID件价(tt)).toLocaleString() + '<br>'
    + (dd && dd.描 ? '<span style="color:#82909e">' + dd.描 + '</span>' : '') + '</div>';
  var 本 = { 容: 用容, u: 选.u, 键: 选.容 };
  function 按钮(文, fn, 色) {
    return '<button data-bag-act="' + fn + '" style="width:100%;margin-top:8px;padding:8px;border-radius:7px;'
      + 'border:1px solid rgba(255,255,255,.16);background:' + (色 || '#2b3741') + ';color:#e7eef4;cursor:pointer;font-size:12px">' + 文 + '</button>';
  }
  if (dd && dd.类 === '医疗') s += 按钮('使用（消耗 1 个）', 'use', '#27624c');
  if (dd && dd.类 === '枪') s += 按钮('装备为主手', 'equip', '#3c5570');
  if (dd && (dd.类 === '护甲' || dd.类 === '头盔'))
    s += 按钮('穿上' + dd.名 + '（耐久生效）', 'wear', '#3c5570');
  var 其 = 表;
  for (var z = 0; z < 其.length; z++) if (其[z].容 && 其[z].容 !== 本.容)
    s += 按钮('转移到' + 其[z].名, 'to-' + 其[z].键);
  s += 按钮('丢弃（不可找回）', 'drop', '#5c3030');
  详.innerHTML = s;
  var 动 = 详.querySelectorAll('[data-bag-act]');
  for (var m = 0; m < 动.length; m++) 动[m].addEventListener('click', function () {
    var a = this.getAttribute('data-bag-act'), it = RAID取件(本.容, 本.u);
    if (!it) return;
    if (a === 'use') {
      if (!用医疗件(本.容, 本.u)) return;
    } else if (a === 'equip') {
      var 穿 = RAID穿枪(it.id);
      if (!穿.ok && /两个武器槽都满/.test(穿.因 || '')) {
        var 腾 = 局内卸装('枪');
        if (!腾.ok) { showMsg('腾不出武器槽：' + 腾.因, '#ff8e8e'); return; }
        穿 = RAID穿枪(it.id);
      }
      if (!穿.ok) { showMsg(穿.因 || '换枪失败', '#ff8e8e'); return; }
      rebuildWeaponModel(); showMsg('已换上 ' + (dd ? dd.名 : it.id) + '，旧枪已放进随身容器', '#9fb2c9');
    } else if (a === 'wear') {
      /* 先自己把旧甲/旧盔塞进背包，别让 RAID穿 内部的 RAID脱 隔空送回仓库 */
      if (RAID槽件(dd.类)) {
        var 脱旧 = 局内卸装(dd.类);
        if (!脱旧.ok) { showMsg('换装失败：' + 脱旧.因, '#ff8e8e'); return; }
      }
      var wr = RAID穿(dd.类, it.id);
      if (!wr.ok) { showMsg(wr.因 || '穿不上', '#ff8e8e'); return; }
      初始化护甲();
      showMsg('已穿上 ' + (dd ? dd.名 : it.id) + '（耐久生效）', '#9fb2c9');
    } else if (a === 'drop') {
      RAID取出(本.容, 本.u); showMsg('已丢弃 ' + (dd ? dd.名 : it.id), '#ffc75c');
    } else if (a.indexOf('to-') === 0) {
      var 键 = a.slice(3), 目标 = null;
      for (var z2 = 0; z2 < 表.length; z2++) if (表[z2].键 === 键) 目标 = 表[z2].容;
      if (!目标) return;
      var r = RAID移动(本.容, 本.u, 目标);
      if (!r.ok) { showMsg(r.因 || '放不下', '#ff8e8e'); return; }
    }
    RAID写档();
    if (typeof RAID_选 !== 'undefined') RAID_选 = null;
    画背包(); 刷引擎HUD();
  });
}

/* ---------- 启动 ---------- */
function 独立引擎_启动() {
  /* 上次进局没正常结算就关页面/退出：按异常中断处理，只保安全箱，
     绝不记撤离成功、也不给赛季任务加进度（防刷）。 */
  try {
    var 断 = (typeof RAID异常中断 === 'function') ? RAID异常中断() : { 触发: false };
    if (断.触发 && window.console) console.info('[搜打撤] 异常中断已结算，保住安全箱 ' + 断.保住 + ' 件');
  } catch (e) { }
  try { 独立引擎_init(); }
  catch (e) {
    try { console.error('[搜打撤独立引擎] 启动失败', e); } catch (_e) { }
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="position:fixed;inset:0;z-index:9999;background:#0c1119;color:#ff8e8e;'
      + 'padding:40px;font:16px/1.8 monospace">搜打撤独立引擎启动失败：' + (e && e.message) + '</div>');
  }
  /* 78 也挂了 load 自检（读 sessionStorage.raidAuto），这里直接把首屏打开 */
  try { if (typeof 搜打撤_准备层开 === 'function') 搜打撤_准备层开(); } catch (e) { }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', 独立引擎_启动);
else 独立引擎_启动();
