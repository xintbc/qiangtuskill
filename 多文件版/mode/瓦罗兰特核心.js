/* ============================================================================
   瓦罗兰特（爆能器）核心 · 独立文件
   ----------------------------------------------------------------------------
   这是**瓦罗兰特版自己的玩法核心**，不在 `网页3D枪战游戏.html`（原版主体）里。
   原版主体只保留一根极细的钩子：收到 spike/spikeYou 报文时转交 VLUI.onMsg()。
   所以「原版」和「瓦罗兰特版」是两套核心：
     · 原版核心：波次刷怪 / 金币商店 / 枪械改装 / 剧情      （在 网页3D枪战游戏.html）
     · 瓦罗兰特核心：大厅 / 准备 / 队长开局 / 回合 / 比分 / 包 / 拆包 / 选阵营  （就是这个文件）
   共用的只有底层引擎：three.js 渲染、碰撞、枪械手感、地图、英雄、网络收发
   —— 这正是用户说的「除了英雄、地图一样，其他都不一样」。
   ----------------------------------------------------------------------------
   加载方式：只被 spike.html 引用（原版 index.html 不引它 → 原版一丝影响都没有）。
   本文件自己**动态生成全部界面**（不依赖主体里任何瓦罗兰特专用 DOM），
   只借用引擎本来就要用的那些通用元素（准星 / 血条 / 弹药 / 提示 / 技能栏 / 设置面板…）。
   ========================================================================== */
'use strict';
(function () {

  /* ---------------- ① 状态 ---------------- */
  var SPIKE = window.SPIKE = {
    on: false, phase: 'live', round: 1, score: [0, 0], timer: 0, fuse: 0,
    plant: 0, defuse: 0, site: { x: 0, z: 30 }, sites: [], plantSite: -1, carrier: 0, winner: -1, leader: 0,
    _act: '', team: -1, mySpawn: null, myReady: false,
    _inGame: 0, mk: '', allReady: false, started: 0, _lastPhase: '', _lobby: 0, _skin: 0
  };
  window.NET_MODE = 'spike';        /* 瓦罗兰特版固定为爆能器模式 */
  window.NET_ROOM = '';
  window.NET_TEAM = -1;
  /* 支持爆能器的地图（原生三张）。模组新地图要 ModLoader.addSpikeMap('id') 声明才出现。 */
  /* 【batch180】与引擎同口径的真实配置对象（sites=下包点 / spike=爆能器出生点 / atk,def=攻守出生区）；
     引擎已设置时这里只是兜底，不会覆盖。 */
  window.SPIKE_MAPS = window.SPIKE_MAPS || {
    classic: { sites: [{ x: -28, z: -2 }, { x: 28, z: -2 }], spike: { x: 0, z: 34 }, atk: [-28, 66], def: [2, -66] },
    eclipse: { sites: [{ x: -16, z: 34 }, { x: 16, z: 34 }], spike: { x: 0, z: 38 }, atk: [18, 80], def: [22, -70] },
    lab: { sites: [{ x: -18, z: 18 }, { x: 18, z: 18 }], spike: { x: 0, z: 36 }, atk: [26, 60], def: [-26, -60] }
  };
  window.spikeMapOk = window.spikeMapOk || function (id) {
    try { return !!(window.SPIKE_MAPS && window.SPIKE_MAPS[id]); } catch (e) { return false; }
  };

  /* ---------------- ①b 爆能器当作"武器槽位"（跟枪/刀并列）：捡起后按 3 / 滚轮切换 ---------------- */
  var WEAPON_SPIKE = 2;            // 仅本核心内部使用（引擎只认 0=枪 / 1=刀）
  SPIKE.slot = 0;                  // 0=枪 1=刀 2=爆能器（手持）
  SPIKE._lastCarrier = 0;
  var _spikeVM = null;             // 第一人称手持爆能器模型
  function buildSpikeVM() {
    if (_spikeVM) return _spikeVM;
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.20, 16), new THREE.MeshLambertMaterial({ color: 0x32363f }));
    body.rotation.x = Math.PI / 2; g.add(body);
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.04, 16), new THREE.MeshLambertMaterial({ color: 0x1d2026 }));
    cap.rotation.x = Math.PI / 2; cap.position.z = -0.12; g.add(cap);
    var core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff8a3d }));
    core.position.z = -0.04; g.add(core);
    var grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.10, 0.03), new THREE.MeshLambertMaterial({ color: 0x222629 }));
    grip.position.set(0.0, -0.06, 0.02); g.add(grip);
    var hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.09), (typeof gloveMat !== 'undefined') ? gloveMat : new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
    hand.position.set(0.02, -0.06, 0.02); g.add(hand);
    g.userData.core = core;
    /* 【batch169】**独立的第一人称手持模型**：直接挂 camera，绝不挂 recoilPivot / weaponGroup。
       以前挂在 recoilPivot 上 —— 它和 weaponGroup（枪 / 刀）是同级、位置几乎完全重合，
       所以看上去就是"卡在枪模型里"，而且还会跟着后坐力一起抖。
       挂到 camera 之后它就是独立于枪 / 刀的一件手持物，位置也往下往前挪开，一眼能分辨。 */
    g.position.set(0.22, -0.30, -0.46);
    g.rotation.set(0.12, -0.40, 0.10);
    g.scale.setScalar(1.15);
    camera.add(g);
    _spikeVM = g; return g;
  }
  function showSpikeVM(on) { if (_spikeVM) _spikeVM.visible = !!on; }
  function setSlot(s) {
    try {
      if (s === 2 && !_carrying()) return;          // 没拿包不能选爆能器槽
      if (s === SPIKE.slot) return;
      SPIKE.slot = s;
      if (s === 2) {
        if (typeof weaponGroup !== 'undefined' && weaponGroup) weaponGroup.visible = false;
        buildSpikeVM(); showSpikeVM(true);
        var wn = document.getElementById('weapon-name'); if (wn) wn.textContent = '💣 爆能器';
        var am = document.getElementById('ammo'); if (am) am.style.display = 'none';
        var rt = document.getElementById('reload-text'); if (rt) rt.style.display = 'none';
      } else {
        showSpikeVM(false);
        if (typeof weaponGroup !== 'undefined' && weaponGroup) weaponGroup.visible = true;
        var target = (s === 0 ? 0 : 1);
        if (typeof currentWeapon !== 'undefined' && currentWeapon === target && typeof rebuildWeaponModel === 'function') rebuildWeaponModel();
        else if (typeof switchWeapon === 'function') switchWeapon(target);
      }
    } catch (e) { }
  }
  /* 【batch169】手上的东西跟着"我是不是持包人"走：
     · **丢出（G）或安放完成后**不再是持包人 → 手上的包必须消失，并**自动切回枪**（slot 0）
     · 捡起后**不强制**切到爆能器，玩家自己按 3 / 滚轮切过去（跟枪 / 刀完全同一套逻辑）
     · 旧的浮空球 carrierFx 彻底停用：它在相机前方飘着，不管拿枪还是拿刀都显示 → 正是"和枪/刀重叠"的原因 */
  function spikeSyncHand() {
    try {
      var _planted = (SPIKE.phase === 'planted' || SPIKE.phase === 'over');
      var _mine = !!_carrying() && !_planted;
      if (!_mine && SPIKE.slot === 2) setSlot(0);          // 丢出 / 部署完 → 自动切回枪
      if (_ballGrp) _ballGrp.visible = false;               // 浮空球不再使用
      showSpikeVM(_mine && SPIKE.slot === 2);
    } catch (e) { }
  }
  /* 【batch170】防重叠：从**武器选择界面（B 键）**点枪卡/刀卡时，引擎走的是
     setCurrentGun / switchWeapon，**不经过 setSlot** → SPIKE.slot 还是 2、手持包还挂着
     visible=true → 包和枪模型重叠（batch169 那个"卡在枪里"的老 bug 复发）。
     包一层这两个引擎函数：切枪/刀之前先把手持包收起来。数字键 1/2/3 走 setSlot，不受影响。 */
  (function(){
    function 收起手持(){
      try{
        if(SPIKE.slot===2){
          SPIKE.slot=0;
          showSpikeVM(false);
          if(typeof weaponGroup!=='undefined'&&weaponGroup)weaponGroup.visible=true;
        }
      }catch(e){}
    }
    /* 裸标识符检测（引擎顶层函数；浏览器里同时就是 window 的属性），替换后双写，
       保证 window.setCurrentGun / setCurrentGun 指向同一个包裹函数。 */
    if(typeof setCurrentGun==='function'&&!setCurrentGun._vlWrap){
      var _o1=setCurrentGun;
      var _w1=function(g){收起手持();return _o1.apply(this,arguments);};
      _w1._vlWrap=1;setCurrentGun=_w1;
      try{if(typeof window!=='undefined')window.setCurrentGun=_w1;}catch(e){}
    }
    if(typeof switchWeapon==='function'&&!switchWeapon._vlWrap){
      var _o2=switchWeapon;
      var _w2=function(t){收起手持();return _o2.apply(this,arguments);};
      _w2._vlWrap=1;switchWeapon=_w2;
      try{if(typeof window!=='undefined')window.switchWeapon=_w2;}catch(e){}
    }
  })();
  // 武器切换键（仅在爆能器模式内拦截，避免和引擎抢键）
  document.addEventListener('keydown', function (e) {
    if (!SPIKE.on) return;
    if (e.code === 'Digit1') { e.preventDefault(); e.stopImmediatePropagation(); setSlot(0); }
    else if (e.code === 'Digit2') { e.preventDefault(); e.stopImmediatePropagation(); setSlot(1); }
    else if (e.code === 'Digit3') { e.preventDefault(); e.stopImmediatePropagation(); setSlot(2); }
  }, true);
  /* 【batch169】电脑端**去掉滚轮切换爆能器**（容易误触，且会和引擎自己的切枪打架）。
     现在电脑只用数字键：1=枪 2=刀 3=爆能器；手机用右下角那个圆钮（见 spikeWeaponBtn）。 */
  // 手持爆能器时拦截开火（左键），避免"拿着炸弹却开枪"
  document.addEventListener('mousedown', function (e) {
    if (SPIKE.on && SPIKE.slot === 2) { try { e.preventDefault(); e.stopImmediatePropagation(); } catch (_) { } }
  }, true);

  /* ---------------- ①d 手机端触屏：切换「爆能器 ⇄ 枪」----------------
     电脑有 1/2/3 数字键，手机没有键盘，所以在安放钮上方放一个圆钮：
     持包时显示，点一下切到爆能器，再点一下切回枪。 */
  var _btnWep = null;
  function spikeWeaponBtn() {
    try {
      var touch = (typeof isTouch !== 'undefined') && isTouch;
      if (!SPIKE.on || !touch) { if (_btnWep) _btnWep.style.display = 'none'; return; }
      if (!_btnWep) {
        var b = document.createElement('div');
        b.id = 'btnSpikeWep';
        b.style.cssText = 'position:fixed;right:24px;bottom:258px;width:78px;height:78px;border-radius:50%;'
          + 'background:rgba(58,62,72,.88);border:2px solid #ff8a3d;color:#fff;font-size:18px;font-weight:700;'
          + 'display:flex;align-items:center;justify-content:center;z-index:61;user-select:none;'
          + 'box-shadow:0 6px 18px rgba(0,0,0,.45);-webkit-tap-highlight-color:transparent;';
        var _tap = function (e) {
          e.preventDefault(); e.stopPropagation();
          try { setSlot(SPIKE.slot === 2 ? 0 : 2); } catch (_) { }
        };
        b.addEventListener('touchstart', _tap, { passive: false });
        b.addEventListener('click', _tap);
        document.body.appendChild(b);
        _btnWep = b;
      }
      var carrying = !!_carrying();
      _btnWep.style.display = carrying ? 'flex' : 'none';
      _btnWep.textContent = (SPIKE.slot === 2) ? '🔫 枪' : '💣 包';
      _btnWep.style.borderColor = (SPIKE.slot === 2) ? '#7fd6ff' : '#ff8a3d';
    } catch (e) { }
  }

  /* ---------------- ② 样式（瓦罗兰特风：深色 + 橙红/青蓝 + 直角切割）---------------- */
  var CSS = [
    '#vlRoot{position:fixed;inset:0;z-index:9000;display:none;flex-direction:column;',
    'background:radial-gradient(120% 90% at 50% 0%,#1b0b10 0%,#0a0d12 55%,#07090c 100%);',
    "color:#e9edf5;font-family:'Segoe UI',-apple-system,'Microsoft YaHei',system-ui,sans-serif;overflow:auto}",
    '#vlRoot.on{display:flex}',
    '.vlBar{display:flex;align-items:center;gap:14px;padding:14px 26px;border-bottom:2px solid #ff4655;background:rgba(10,12,16,.75)}',
    '.vlLogo{font-size:22px;font-weight:800;letter-spacing:5px;color:#ff4655}',
    '.vlTag{font-size:12px;letter-spacing:2px;color:#7e8899}',
    '.vlWrap{flex:1;display:flex;gap:18px;padding:18px 26px 30px;flex-wrap:wrap;align-items:flex-start}',
    '.vlCol{flex:1;min-width:280px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);padding:14px}',
    '.vlColH{display:flex;justify-content:space-between;align-items:center;font-weight:800;letter-spacing:1px;margin-bottom:10px;font-size:15px}',
    '.vlAtk{border-top:3px solid #ff4655}.vlDef{border-top:3px solid #3ad2ff}',
    '.vlRow{display:flex;justify-content:space-between;align-items:center;padding:7px 9px;margin:5px 0;background:rgba(255,255,255,.05);font-size:14px}',
    '.vlRow.me{outline:1px solid #ffd24a}',
    '.vlRow.dead{opacity:.4}',
    '.vlOK{color:#54e39a;font-size:12px}.vlNo{color:#8b97ab;font-size:12px}',
    '.vlBtn{background:#ff4655;border:0;color:#fff;font-weight:800;letter-spacing:1px;padding:12px 18px;cursor:pointer;font-size:15px}',
    '.vlBtn:hover{filter:brightness(1.15)}',
    '.vlBtn.gray{background:#2b313c}',
    '.vlBtn.blue{background:#3ad2ff;color:#06202a}',
    '.vlBtn:disabled{opacity:.45;cursor:not-allowed}',
    '.vlBtns{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}',
    '.vlBig{font-size:26px;font-weight:800;letter-spacing:2px}',
    '.vlHint{font-size:12px;color:#8b97ab;line-height:1.9}',
    '.vlMid{flex:1;min-width:260px;text-align:center}',
    '.vlScore{font-size:44px;font-weight:800;letter-spacing:6px;margin:6px 0}',
    '.vlA{color:#ff4655}.vlD{color:#3ad2ff}',
    '.vlPhase{font-size:14px;color:#ffd24a;font-weight:700;min-height:22px}',
    '.vlMe{display:inline-block;margin-top:8px;padding:4px 12px;font-size:13px;background:rgba(255,70,85,.18);border:1px solid #ff4655}',
    /* 局内：顶部回合条（替换原版波次条的样子） */
    '#wave.vlBarTop{left:50%;transform:translateX(-50%);top:8px;background:rgba(8,10,14,.72);border:1px solid rgba(255,255,255,.14);',
    'border-bottom:2px solid #ff4655;padding:6px 16px;letter-spacing:1px;font-weight:700;color:#e9edf5}',
    /* 瓦罗兰特版把原版的得分/金币/波次商店/多人记分板之类全部不显示 */
    '#wave-shop,#score,#gold-hud,#shop-gold,#go,#netBoard{display:none!important}',
    /* ---- 小地图：挪到左下角，做成雷达的样子（Val 味）---- */
    '#minimap{position:fixed!important;left:18px;bottom:18px;right:auto!important;top:auto!important;',
    'border:1px solid rgba(255,255,255,.18);border-bottom:2px solid #ff4655;background:rgba(8,10,14,.62)!important;',
    'box-shadow:0 6px 18px rgba(0,0,0,.45)}',
    /* ---- 手机：安放/拆除共用一个按钮（与救援同位置）---- */
    '#btnSpike{right:24px;bottom:150px;width:88px;height:88px;border-radius:50%;background:rgba(255,90,60,.82);font-size:20px;color:#fff}',
    /* ---- 瓦罗兰特自己的主菜单 ---- */
    /* ⚠️ z-index 必须**低于**设置面板(600)和键位面板(645) —— 以前写了 800，把两个面板
       整个压在菜单底下，点了"设置 / 改键位"看着像没反应（其实开了，只是被挡住）。 */
    '#blocker{position:fixed;inset:0;z-index:100;display:flex;align-items:flex-start;justify-content:center;overflow:auto;',
    'background:radial-gradient(120% 90% at 50% 0%,#1b0b10 0%,#0a0d12 55%,#07090c 100%);color:#e9edf5}',
    '#vlMenu{width:100%;max-width:1080px;padding:26px 22px 40px}',
    '.vlMenuTop{display:flex;align-items:baseline;gap:14px;border-bottom:2px solid #ff4655;padding-bottom:10px;margin-bottom:16px}',
    '.vlMenuLogo{font-size:34px;font-weight:800;letter-spacing:8px;color:#ff4655}',
    '.vlMenuSub{font-size:13px;letter-spacing:3px;color:#7e8899}',
    '.vlTabs{display:flex;gap:8px;margin-bottom:14px}',
    '.vlTab{padding:9px 20px;background:rgba(255,255,255,.06);cursor:pointer;font-weight:700;letter-spacing:1px;border-bottom:2px solid transparent}',
    '.vlTab.on{background:rgba(255,70,85,.18);border-bottom-color:#ff4655}',
    '.vlPane{display:none}#vlPaneAgent.on,#vlPaneMap.on,#vlPaneHow.on{display:block}',
    '.vlNote{font-size:13px;color:#aab3c2;line-height:1.95}',
    '.vlNote p{margin:6px 0}',
    '.vlMenuBtns{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}',
    '.vlMenuBn2{display:flex;gap:12px;margin-top:12px}',
    '.vlMenuTip{margin-top:14px;font-size:12px;color:#7e8899;line-height:1.8}',
    /* ---- 局内暂停菜单（ESC）---- */
    '#vlPause{display:none;align-items:center;justify-content:center;width:100%;min-height:100vh}',
    '#blocker.pause-mode #vlMenu{display:none}',
    '#blocker.pause-mode #vlPause{display:flex}',
    '.vlPauseCard{background:rgba(10,12,16,.92);border:1px solid #2b3446;border-top:3px solid #ff4655;',
    'padding:26px 30px;min-width:320px;text-align:center}',
    '.vlPauseTitle{font-size:24px;font-weight:800;letter-spacing:4px;color:#ff4655;margin-bottom:18px}',
    '#vlPause .vlBtn{width:100%;margin-top:10px}'
  ].join('');

  function injectCss() {
    try {
      if (document.getElementById('vlCss')) return;
      var s = document.createElement('style'); s.id = 'vlCss'; s.textContent = CSS;
      document.head.appendChild(s);
    } catch (e) { }
  }

  /* ---------------- ③ 界面（全部由本文件自己生成）---------------- */
  function buildLobby() {
    if (document.getElementById('vlRoot')) return;
    var d = document.createElement('div');
    d.id = 'vlRoot';
    d.innerHTML =
      '<div class="vlBar"><span class="vlLogo">SPIKE</span><span class="vlTag">爆 能 器 · 自 建 房</span>' +
      '<span class="vlTag" id="vlRoom" style="margin-left:auto"></span>' +
      '<button class="vlBtn gray" id="vlQuit" style="padding:8px 14px">离开</button></div>' +
      '<div class="vlWrap">' +
      '  <div class="vlCol" style="flex:0 0 100%">' +
      '    <div class="vlColH"><span>📡 房间</span><span class="vlTag" id="vlCount"></span></div>' +
      '    <div class="vlHint" id="vlMapLine">地图：—</div>' +
      '    <div class="vlBtns" id="vlMapPick"></div>' +
      '  </div>' +
      '  <div class="vlCol vlAtk"><div class="vlColH"><span>🔺 进攻方</span><span class="vlTag" id="vlAtkN"></span></div><div id="vlAtk"></div></div>' +
      '  <div class="vlMid">' +
      '    <div class="vlPhase" id="vlPhase">等待玩家…</div>' +
      '    <div class="vlScore"><span class="vlA" id="vlSA">0</span> <span style="color:#4a5364">:</span> <span class="vlD" id="vlSD">0</span></div>' +
      '    <div class="vlTag" id="vlRound">第 1 回合</div>' +
      '    <div class="vlMe" id="vlMe">阵营：未选择</div>' +
      '    <div class="vlBtns" style="justify-content:center;margin-top:14px">' +
      '      <button class="vlBtn blue" id="vlJoinA">加入进攻方</button>' +
      '      <button class="vlBtn blue" id="vlJoinD">加入防守方</button>' +
      '    </div>' +
      '    <div class="vlBtns" style="justify-content:center;margin-top:10px">' +
      '      <button class="vlBtn gray" id="vlReady">✅ 准备</button>' +
      '      <button class="vlBtn" id="vlStart" style="display:none">▶ 开始游戏（队长）</button>' +
      '    </div>' +
      '    <div class="vlHint" style="margin-top:16px">开局条件：<b>至少 2 人</b>，且<b>两队各需至少 1 人</b>；<b>全员准备</b>后由队长点开始<br>' +
      '      回合开始前不会进入地图；进攻方带包到<b style="color:#ff8a3d">橙色光柱</b>长按 F 安放，守方长按 F 拆除</div>' +
      '    <div class="vlBtns" style="justify-content:center;margin-top:12px"><button class="vlBtn gray" id="vlFold" style="display:none">收起看比分板</button></div>' +
      '  </div>' +
      '  <div class="vlCol vlDef"><div class="vlColH"><span>🔹 防守方</span><span class="vlTag" id="vlDefN"></span></div><div id="vlDef"></div></div>' +
      '</div>';
    document.body.appendChild(d);
  }
  function el(id) { return document.getElementById(id); }
  /* 【batch168】进房前必须先选特工：没在本页点过特工之前，"进入大厅"是禁用的 */
  function refreshEnterBtn() {
    var b = el('vbEnter'); if (!b) return;
    var picked = !!SPIKE._heroPicked;
    b.textContent = picked ? ('💣 以「' + heroName() + '」进入爆能器大厅') : '① 先选一个特工';
    b.disabled = !picked;
    b.style.opacity = picked ? '1' : '.55';
    var t = el('vbTip');
    if (t) t.textContent = picked
      ? ('已选特工：' + heroName() + '　·　点下面的按钮进大厅')
      : '先在「特工」页签里点一个特工，才能进入大厅（不然进去了也没有英雄）';
  }

  /* 当前所选特工的名字（提示玩家进房前先选人） */
  function heroName() {
    try {
      if (typeof HEROES !== 'undefined' && typeof SK !== 'undefined' && HEROES[SK.idx]) return HEROES[SK.idx].name || '特工';
    } catch (e) { }
    return '特工';
  }
  function showLobby(on) { var r = el('vlRoot'); if (r) r.classList[(on ? 'add' : 'remove')]('on'); }

  /* ---------------- ④ 渲染 ---------------- */  function renderTeam(roster) {
    var A = el('vlAtk'), D = el('vlDef');
    if (!A || !D) return;
    var ha = '', hd = '', na = 0, nd = 0, meRow = null;
    (roster || []).forEach(function (r) {
      var me = (typeof NET !== 'undefined' && r.i === NET.id);
      var hp = '<span class="' + ((r.h > 40) ? 'vlOK' : 'vlNo') + '">HP ' + r.h + '</span>';
      var s = '<div class="vlRow' + (r.a ? '' : ' dead') + (me ? ' me' : '') + '">' +
        '<span>' + (me ? '▶ ' : '') + (r.a ? '' : '💀 ') + (r.n || ('玩家' + r.i)) + '</span>' +
        '<span>' + hp + (r.r ? ' <span class="vlOK">已准备</span>' : ' <span class="vlNo">未准备</span>') + '</span></div>';
      if (r.t === 0) { ha += s; na++; } else { hd += s; nd++; }
      if (me) meRow = r;
    });
    A.innerHTML = ha || '<div class="vlHint">（没人）</div>';
    D.innerHTML = hd || '<div class="vlHint">（没人）</div>';
    if (el('vlAtkN')) el('vlAtkN').textContent = na ? (na + ' 人') : '';
    if (el('vlDefN')) el('vlDefN').textContent = nd ? (nd + ' 人') : '';
    if (el('vlSA')) el('vlSA').textContent = SPIKE.score[0];
    if (el('vlSD')) el('vlSD').textContent = SPIKE.score[1];
    if (el('vlRound')) el('vlRound').textContent = '第 ' + SPIKE.round + ' 回合';
    var mn = '';
    try { mn = (SPIKE.mk && typeof mapById === 'function' && mapById(SPIKE.mk)) ? (mapById(SPIKE.mk).name || '') : ''; } catch (e) { }
    if (el('vlRoom')) el('vlRoom').textContent = '房间：' + (window.NET_ROOM || '公共房') + (mn ? ('　地图：' + mn) : '');
    /* 【batch168】房间人数 + 地图（**队长可以换图**；其他人跟着队长走） */
    if (el('vlCount')) el('vlCount').textContent = '本房 ' + ((roster && roster.length) || 0) + ' 人';
    var ml = el('vlMapLine');
    if (ml) {
      var lead2 = (typeof NET !== 'undefined' && NET.id === SPIKE.leader);
      ml.innerHTML = '地图：<b style="color:#ffd24a">' + (mn || '—') + '</b>' +
        (lead2 ? '　👑 你是队长，可以换图' : '　（由队长决定）');
    }
    /* 【batch168】地图按钮**所有人都看得见**（队长可点；队员点了会给明确提示），
       这样"到底有没有这个按钮 / 点了有没有反应"一眼就能确认，不用猜。 */
    var mp = el('vlMapPick');
    if (mp) {
      if (!mp._built) {
        var mh = '';
        try {
          var _ml = (typeof MAPS !== 'undefined' && MAPS) ? MAPS : [];
          _ml.forEach(function (M) {
            if (!M || !M.id) return;
            if (typeof spikeMapOk === 'function' && !spikeMapOk(M.id)) return;
            mh += '<button class="vlBtn gray" data-m="' + M.id + '">' + (M.icon || '') + ' ' + (M.name || M.id) + '</button>';
          });
        } catch (e) { mh = ''; }
        /* 没取到地图列表就**先别标记已建好**，下一帧再试 —— 免得永远渲染不出按钮、点了没反应 */
        if (!mh) { mp.innerHTML = '<div class="vlHint">（地图列表加载中…）</div>'; return; }
        mp._built = 1;
        mp.innerHTML = mh;
        var bs0 = mp.querySelectorAll('button');
        for (var bi = 0; bi < bs0.length; bi++) (function (b) {
          b.addEventListener('click', function () {
            var id = b.getAttribute('data-m');
            var lead = (typeof NET !== 'undefined' && NET.id === SPIKE.leader);
            if (!lead) {
              showMsg('只有队长能换图（当前队长：' + (SPIKE.leaderName || '对方') + '）', '#fc0');
              return;
            }
            showMsg('已请求换图：' + ((mapById(id) && mapById(id).name) || id) + ' …', '#7fd6ff');
            netSend({ t: 'spikeMap', m: id }); spikeReportCfg(id);   /* 【batch180】顺手把这张图的爆能器点位报给服务端 */
          });
        })(bs0[bi]);
      }
      var bs1 = mp.querySelectorAll('button');
      for (var bj = 0; bj < bs1.length; bj++) {
        bs1[bj].style.outline = (bs1[bj].getAttribute('data-m') === SPIKE.mk) ? '2px solid #ffd24a' : 'none';
      }
    }
    refreshEnterBtn();
    var ph = el('vlPhase');
    if (ph) {
      var nr = 0; (roster || []).forEach(function (r) { if (!r.r) nr++; });
      var _pn = (roster && roster.length) || 0;
      if (SPIKE.phase === 'waiting' && _pn < 2) {
        /* 【batch168】队长/有人退出后房里不到 2 人 → 说清楚，别让人以为卡住了。
           队长走了会自动顺位给房里剩下的人（服务端已处理），再来一个人就能开。 */
        ph.textContent = _pn === 0 ? '（房间里没人了）' : '房里只有你一个人 —— 再叫一个人进来（同模式 + 同房号）就能开';
      }
      else if (SPIKE.phase === 'waiting') ph.textContent = SPIKE.allReady ? '全员已准备 —— 等队长开始' : ('等待开始（还有 ' + nr + ' 人未准备）');
      else if (SPIKE.phase === 'over') ph.textContent = (SPIKE.winner === 0 ? '🔺 进攻方拿下这一回合' : '🔹 防守方拿下这一回合') + (SPIKE.reason ? ('（' + SPIKE.reason + '）') : '');
      else if (SPIKE.phase === 'prep') ph.textContent = '准备时间 ' + SPIKE.timer + ' 秒（不能离开出生点）';
      else if (SPIKE.phase === 'planted') ph.textContent = '爆能器已安放 · ' + SPIKE.fuse + ' 秒后引爆';
      else ph.textContent = '交战中 · 剩余 ' + SPIKE.timer + ' 秒';
    }
    if (el('vlMe')) el('vlMe').textContent = '阵营：' + (SPIKE.team === 0 ? '进攻方' : SPIKE.team === 1 ? '防守方' : '未选择');
    var amLead = (typeof NET !== 'undefined' && NET.id === SPIKE.leader);
    var st = el('vlStart');
    if (st) {
      var show = (amLead && SPIKE.phase === 'waiting');
      st.style.display = show ? 'block' : 'none';
      if (show) st.textContent = SPIKE.allReady ? '▶ 开始游戏（全员已准备）' : '▶ 开始游戏（等全员准备）';
    }
    if (el('vlReady')) {
      SPIKE.myReady = !!(meRow && meRow.r);
      el('vlReady').textContent = SPIKE.myReady ? '⏳ 取消准备' : '✅ 准备';
    }
    if (el('vlFold')) el('vlFold').style.display = SPIKE._inGame ? 'block' : 'none';
  }
  function hud() {
    var w = el('wave'); if (!w || !SPIKE.on) return;
    try { w.classList.add('vlBarTop'); } catch (e) { }
    var me = (SPIKE.team === 0) ? '进攻' : (SPIKE.team === 1 ? '防守' : '观战');
    var carrying = (SPIKE.solo || (typeof NET !== 'undefined' && NET.id === SPIKE.carrier)) &&
      SPIKE.phase !== 'planted' && SPIKE.phase !== 'over';
    var bomb = carrying ? '💣 你拿着爆能器　' : '';
    /* 【batch168】阵亡 → 观战队友时，顶部直接写明在看谁 */
    if (_specId && (typeof NET === 'undefined' || NET.dead)) {
      var sn = '';
      for (var q = 0; q < (SPIKE.roster || []).length; q++) if (SPIKE.roster[q].i === _specId) sn = SPIKE.roster[q].n || '';
      w.textContent = '👁 观战 ' + sn + '　·　阵亡不能复活，等下一回合';
      return;
    }
    var DEF_S = 4;                                  /* 【batch168】拆包 4 秒（和安放一样） */
    if (SPIKE.phase === 'prep') w.textContent = bomb + '准备 ' + SPIKE.timer + 's · ' + me + '（不能离开出生点）';
    else if (SPIKE.phase === 'planted') w.textContent = '💣 已安放 ' + SPIKE.fuse + 's' + (SPIKE.defuse > 0 ? (' · 拆除 ' + SPIKE.defuse + '/' + DEF_S) : '　·　守方长按 F 拆除');
    else if (SPIKE.plant > 0) w.textContent = '💣 安放中 ' + SPIKE.plant + '/4s';
    else if (_carrying() && near()) w.textContent = bomb + me + ' · 第 ' + SPIKE.round + ' 回合 · ' + SPIKE.timer + 's　·　长按 F 安放';
    else if (_carrying()) w.textContent = bomb + me + ' · 第 ' + SPIKE.round + ' 回合 · ' + SPIKE.timer + 's　·　按 G 可扔出';
    else w.textContent = me + ' · 第 ' + SPIKE.round + ' 回合 · ' + SPIKE.timer + 's · ' + SPIKE.score[0] + ':' + SPIKE.score[1];
  }

  /* ---------------- ⑤-0 单人训练（不需要开房、不连服务器也能练安放）----------------
     各图的下包区与出生点（与服务端 SPIKE_MAP_CFG 同口径，改一边记得同步另一边）。 */
  var SOLO_CFG = {
    classic: { site: { x: 0, z: 10 }, spawn: [0, 45] },
    eclipse: { site: { x: 0, z: 30 }, spawn: [-12, 4] },
    lab: { site: { x: 0, z: 0 }, spawn: [0, 22] }
  };
  function startSoloTraining() {
    SPIKE.solo = 1;
    var c = SOLO_CFG[window.curMapId];
    if (!c) {
      /* 【batch180】自定义图：读模组 addSpikeMap 注册进来的配置
         （下包点取第 1 处；出生点取 soloSpawn，没写就用该图出生点表的第一个）。 */
      try {
        var _sc = window.SPIKE_MAPS && window.SPIKE_MAPS[window.curMapId];
        if (_sc && _sc.sites && _sc.sites.length) {
          var _sps = _sc.soloSpawn
            || ((window.MAP_SPAWNS && window.MAP_SPAWNS[window.curMapId] && window.MAP_SPAWNS[window.curMapId][0]) || [0, 15]);
          c = { site: _sc.sites[0], spawn: _sps };
        }
      } catch (e) { }
    }
    if (!c) c = SOLO_CFG.classic;
    SPIKE.on = true; SPIKE.phase = 'live'; SPIKE.team = 0; SPIKE.carrier = -1;
    SPIKE.site = c.site;
    /* 【batch180】多下包点的自定义图：全部登记进去（原来单人只认一个点） */
    try { var _all = window.SPIKE_MAPS && window.SPIKE_MAPS[window.curMapId]; SPIKE.sites = (_all && _all.sites && _all.sites.length) ? _all.sites : []; }
    catch (e) { SPIKE.sites = []; }
    SPIKE.plant = 0; SPIKE.fuse = 40; SPIKE.timer = 0;
    SPIKE._lobby = 1;
    showLobby(false);
    enterGame();
    try { setMap(window.curMapId); } catch (e) { }
    camera.position.set(c.spawn[0], GROUND_Y, c.spawn[1]);
    S.velY = 0; S.onGround = true; S.onLadder = false; S.mantle = 0; S.landKick = 0;
    SPIKE._inGame = 1;
    NET.dead = false; updateHp();
    if (typeof showMsg === 'function') showMsg('🎯 单人训练：走到橙色光柱长按 F 练习安放', '#ffd24a');
  }
  /* 单人训练的本地推进：安放 4 秒 → 引信 40 秒 → 引爆 → 复位再来 */
  function soloTick(dt) {
    if (!SPIKE.solo || !SPIKE._inGame) return;
    if (SPIKE.phase === 'live') {
      if (near() && !!keys.KeyF) {
        SPIKE.plant = Math.min(4, SPIKE.plant + dt);
        if (SPIKE.plant >= 4) { SPIKE.phase = 'planted'; SPIKE.fuse = 40; }
      } else if (SPIKE.plant > 0) SPIKE.plant = Math.max(0, SPIKE.plant - dt * 2);
      hud();
    } else if (SPIKE.phase === 'planted') {
      SPIKE.fuse -= dt;
      if (SPIKE.fuse <= 0) {
        SPIKE.phase = 'live'; SPIKE.plant = 0; SPIKE.fuse = 40;
        if (typeof showMsg === 'function') showMsg('💥 引爆成功！再来一次', '#ffd24a');
      }
      hud();
    }
  }

  /* ---------------- ⑤ 世界里的东西：下包区光柱 + 携带者身上的"包" ---------------- */
  var _marks = [], _ball = null;
  function markSync() {
    try {
      if (!SPIKE.on) { for (var _mi = 0; _mi < _marks.length; _mi++) _marks[_mi].visible = false; return; }
      var _sites = (SPIKE.sites && SPIKE.sites.length) ? SPIKE.sites : [SPIKE.site];
      while (_marks.length < _sites.length) {
        var _mk = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 14, 18, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
        scene.add(_mk); _marks.push(_mk);
      }
      for (var _mj = 0; _mj < _marks.length; _mj++) {
        if (_mj >= _sites.length) { _marks[_mj].visible = false; continue; }
        var _s = _sites[_mj];
        _marks[_mj].position.set(_s.x, 7, _s.z);
        _marks[_mj].visible = true;
        var _col = 0xff8a3d;
        if (SPIKE.phase === 'planted' && typeof SPIKE.plantSite === 'number' && SPIKE.plantSite === _mj) _col = 0xff4655;
        else if (SPIKE.phase === 'prep') _col = 0x9aa4b2;
        else if (SPIKE.phase === 'planted') _col = 0xff4655;
        _marks[_mj].material.color.setHex(_col);
      }
    } catch (e) { }
  }
  /* 【batch168】爆能器"包"：**像样的实体** —— 深色外壳 + 橙色发光核心 + 一圈光晕，
     拿在手里（右下、略低，和投掷物同样的握持位），并随步伐轻微晃动。 */
  var _ballGrp = null;
  function carrierFx() {
    try {
      if (!SPIKE.on) { if (_ballGrp) _ballGrp.visible = false; return; }
      var mine = (SPIKE.solo || (typeof NET !== 'undefined' && NET.id === SPIKE.carrier)) &&
        SPIKE.phase !== 'planted' && SPIKE.phase !== 'over';
      if (!mine) { if (_ballGrp) _ballGrp.visible = false; return; }
      if (!_ballGrp) {
        _ballGrp = new THREE.Group();
        var shell = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.18),
          new THREE.MeshBasicMaterial({ color: 0x2b2f38 }));
        var core = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.10, 0.14),
          new THREE.MeshBasicMaterial({ color: 0xff8a3d }));
        core.position.y = 0.10;
        var glow = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10),
          new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.20, depthWrite: false }));
        _ballGrp.add(shell); _ballGrp.add(core); _ballGrp.add(glow);
        _ballGrp.userData.core = core;
        scene.add(_ballGrp);
      }
      /* 握在右手位置：相机右前方、略低（和投掷物同一手感） */
      var d = new THREE.Vector3(), right = new THREE.Vector3();
      camera.getWorldDirection(d);
      right.set(d.z, 0, -d.x).normalize();          // 视线方向顺时针 90° ＝ 右手边
      var t = Date.now() * 0.004;
      var sway = Math.sin(t) * 0.012;
      /* 【batch169】原来放在**右手位**，正好和枪 / 刀的手部模型重叠成一坨。
         改到**左手位**（视线前方偏左、略低）—— 和瓦罗兰特一样：枪在右手，包在左手。
         同时往下压一点、往前收一点，避免和准星下方的手部模型互相穿插。 */
      _ballGrp.position.set(
        camera.position.x + d.x * 0.58 - right.x * 0.34,
        camera.position.y - 0.36 + sway,
        camera.position.z + d.z * 0.58 - right.z * 0.34
      );
      _ballGrp.rotation.y += 0.015;
      /* 呼吸式发光，一眼能看出"包在我身上" */
      var k = 0.55 + 0.45 * Math.sin(Date.now() * 0.006);
      try { _ballGrp.userData.core.material.color.setHex(k > 0.7 ? 0xffd24a : 0xff8a3d); } catch (e) { }
      _ballGrp.visible = true;
    } catch (e) { }
  }
  /* 【batch168】准备时间的活动范围**画出来**（半径 6 米）：半透明立墙 + 地面圆环。
     不然玩家只会"被空气墙挡住"，根本不知道边界在哪。 */
  var _prepRing = null, _prepDisc = null;
  function prepRingSync() {
    try {
      var show = !!(SPIKE.on && SPIKE.phase === 'prep' && SPIKE.mySpawn);
      if (!show) { if (_prepRing) _prepRing.visible = false; if (_prepDisc) _prepDisc.visible = false; return; }
      var R = 6;
      if (!_prepRing) {
        _prepRing = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 3.2, 44, 1, true),
          new THREE.MeshBasicMaterial({ color: 0x54d6ff, transparent: true, opacity: 0.17, side: THREE.DoubleSide, depthWrite: false }));
        scene.add(_prepRing);
      }
      if (!_prepDisc) {
        _prepDisc = new THREE.Mesh(new THREE.RingGeometry(R - 0.28, R, 56),
          new THREE.MeshBasicMaterial({ color: 0x54d6ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
        _prepDisc.rotation.x = -Math.PI / 2;
        scene.add(_prepDisc);
      }
      _prepRing.position.set(SPIKE.mySpawn[0], 1.6, SPIKE.mySpawn[1]);
      _prepDisc.position.set(SPIKE.mySpawn[0], 0.12, SPIKE.mySpawn[1]);
      _prepRing.visible = true; _prepDisc.visible = true;
      /* 越靠近边界越亮 —— 给个"快到边了"的提示 */
      var dx = camera.position.x - SPIKE.mySpawn[0], dz = camera.position.z - SPIKE.mySpawn[1];
      var d = Math.sqrt(dx * dx + dz * dz), k = Math.max(0, Math.min(1, d / R));
      _prepRing.material.opacity = 0.10 + 0.22 * k;
      _prepDisc.material.opacity = 0.32 + 0.55 * k;
    } catch (e) { }
  }
  /* 【batch168】**掉在地上的爆能器**：一个看得见的实体（深色壳 + 橙色核心 + 光晕），
     缓慢自转 + 轻微上下浮动，还带一根细光柱方便远处找到它。 */
  var _dropGrp = null;
  function spikeDropFx() {
    try {
      var onGround = !!(SPIKE.on && SPIKE.carrier === 0 && SPIKE.sp &&
        SPIKE.phase !== 'planted' && SPIKE.phase !== 'over');
      if (!onGround) { if (_dropGrp) _dropGrp.visible = false; return; }
      if (!_dropGrp) {
        _dropGrp = new THREE.Group();
        var shell2 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.30, 0.30),
          new THREE.MeshBasicMaterial({ color: 0x2b2f38 }));
        var core2 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.10, 0.24),
          new THREE.MeshBasicMaterial({ color: 0xff8a3d }));
        core2.position.y = 0.09;
        var glow2 = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12),
          new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.14, depthWrite: false }));
        var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 6, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.16, side: 2, depthWrite: false }));
        beam.position.y = 3;
        _dropGrp.add(shell2); _dropGrp.add(core2); _dropGrp.add(glow2); _dropGrp.add(beam);
        scene.add(_dropGrp);
      }
      var t2 = Date.now() * 0.002;
      /* 【batch168】贴着**真实地面**放（日蚀环城地面有高低，写死 y 会陷进地里/浮空） */
      /* 【batch169】groundHeightAt 返回的是**相机高度**（＝ 地面 + GROUND_Y），第三个参数是"从多高往下找"。
         原来传 40 → 它会把 38 米以下**最高的那个面**（塔顶 / 屋顶）当成地面，再加一个 GROUND_Y，
         包就飘到天上去了。正确用法：从站立高度往下找，再减掉 GROUND_Y 才是真实地面高度。 */
      var gy = 0;
      try {
        var _GY = (typeof GROUND_Y === 'number') ? GROUND_Y : 2;
        var _gh = (typeof groundHeightAt === 'function') ? groundHeightAt(SPIKE.sp.x, SPIKE.sp.z, _GY) : NaN;
        gy = isFinite(_gh) ? (_gh - _GY) : 0;
      } catch (e2) { gy = 0; }
      if (!isFinite(gy)) gy = 0;
      _dropGrp.position.set(SPIKE.sp.x, gy + 0.24 + Math.sin(t2 * 1.6) * 0.05, SPIKE.sp.z);
      _dropGrp.rotation.y = t2;
      _dropGrp.visible = true;
    } catch (e) { }
  }
  /* 【batch168】阵亡后观战队友：回合制阵亡要等到下一回合，那段时间跟着队友的视角看。
     · 只在"已经进图 + 自己已阵亡"时生效
     · 目标：同队、还活着、不是自己（优先沿用上一个目标，不来回跳）
     · 顺手把挡视线的阵亡蒙层收掉，改成顶部一行小字 */
  var _specId = 0, _specHidden = [];
  /* 观战时把队友"挡镜头"的部分藏掉：头 / 躯干 / 腿 / 头顶血条名牌，
     **保留手臂与手上的东西**（枪 / 刀 / 投掷物）—— 这样看到的正是"队友的第一人称"。
     不藏的话镜头卡在模型内部，看到的就是一片白。 */
  function _specHide(e, on) {
    try {
      if (!on) {
        for (var j = 0; j < _specHidden.length; j++) { try { _specHidden[j].visible = true; } catch (x) { } }
        _specHidden.length = 0; return;
      }
      var parts = [e.head, e.bodyPivot, e.hb, e.legL, e.legR, e.leftLeg, e.rightLeg];
      for (var i = 0; i < parts.length; i++) {
        var n = parts[i];
        if (!n || n.visible === false) continue;
        n.visible = false; _specHidden.push(n);
      }
    } catch (x) { }
  }
  function spectateTick() {
    try {
      var dying = (SPIKE.on && SPIKE._inGame && typeof NET !== 'undefined' && NET.dead);
      if (!dying) { if (_specId) { _specHide(null, false); _specId = 0; } return; }
      var rs = SPIKE.roster || [];
      var want = 0;
      for (var i = 0; i < rs.length; i++) {
        var r = rs[i];
        if (r.i === NET.id) continue;
        if (r.t !== SPIKE.team) continue;
        if (!r.a) continue;
        if (r.i === _specId) { want = r.i; break; }     // 沿用旧目标，避免视角乱跳
        if (!want) want = r.i;
      }
      var nd = el('netDeath'); if (nd) nd.style.display = 'none';   // 别挡住观战画面
      if (!want) {
        /* 【batch168】队友全倒了（或正在观战的那个死了、又没别人了）：
           恢复模型可见 → 镜头拉到**下包区上方俯瞰**，等服务端团灭判定结束这一回合。
           不这么做的话，镜头会卡在尸体模型里，看到一片白。 */
        _specHide(null, false); _specId = 0;
        try {
          var _fs = (SPIKE.sites && SPIKE.sites.length) ? SPIKE.sites[0] : SPIKE.site;
          camera.position.set(_fs.x, 26, _fs.z + 0.01);
          pitch = -1.15;                     // 俯视（约 -66°）
        } catch (e2) { }
        return;
      }
      if (want !== _specId) { _specHide(null, false); _specId = want; }
      var e = NET.players[want];
      if (!e || !e.root) return;
      _specHide(e, true);
      camera.position.set(e.root.position.x, e.root.position.y + 1.62, e.root.position.z);
      try { if (typeof e.tyaw === 'number') yaw = e.tyaw; } catch (e2) { }
      try { if (typeof e.tp === 'number') pitch = e.tp; } catch (e2) { }
    } catch (e) { }
  }
  function near() {
    var _ss = (SPIKE.sites && SPIKE.sites.length) ? SPIKE.sites : [SPIKE.site];
    for (var _si = 0; _si < _ss.length; _si++) {
      var dx = camera.position.x - _ss[_si].x, dz = camera.position.z - _ss[_si].z;
      if (dx * dx + dz * dz <= 16) return true;
    }
    return false;
  }
  /* 我现在拿着爆能器吗？（单人训练用 soloCarry，联机看 carrier） */
  function _carrying() {
    if (SPIKE.solo) return !!SPIKE.soloCarry;
    return (typeof NET !== 'undefined' && NET.id === SPIKE.carrier && SPIKE.carrier > 0);
  }
  function btnSync() {
    var b = el('btnSpike'); if (!b) return;
    var touch = (typeof isTouch !== 'undefined') && isTouch;
    if (!SPIKE.on || !touch) { b.style.display = 'none'; return; }
    b.style.display = near() ? 'flex' : 'none';
    b.textContent = (SPIKE.phase === 'planted') ? '拆除' : '安放';
  }

  /* ---------------- ⑥ 进大厅 / 进地图（这是"没开始之前不进地图"的关键）---------------- */
  /* 【batch180】把"这张图声明的爆能器点位"上报给服务端（服务端只接受**队长**发的）。
     模组地图是客户端加载的，服务端 SPIKE_MAP_CFG 里本来没有它 —— 不报就会 fallback 到 classic 的坐标，
     在你的图里可能正好是墙里 / 坑里 / 图外。只报模组图（_mod），内置三张服务端本来就有。 */
  function spikeReportCfg(id) {
    try {
      var _id = id || window.curMapId;
      var c = window.SPIKE_MAPS && window.SPIKE_MAPS[_id];
      if (!c || !c._mod || !c.sites || !c.sites.length || !c.spike) return;
      if (typeof netSend === 'function') netSend({ t: 'spikeCfg', m: _id, cfg: { sites: c.sites, spike: c.spike, atk: c.atk, def: c.def } });
    } catch (e) { }
  }
  function enterLobby() {
    /* 只连接服务器 + 亮大厅：**不建图、不进人**。等回合真正开始才 enterGame()。 */
    try {
      NET.enabled = true;
      if (!NET.server) NET.server = (typeof netHostFromPage === 'function' ? netHostFromPage() : '') || location.host;
      if (!NET.secure && location.protocol === 'https:') NET.secure = true;
      if (NET.ws) { try { NET.ws.onclose = null; } catch (e) { } try { NET.ws.onmessage = null; } catch (e) { } try { NET.ws.close(); } catch (e) { } NET.ws = null; }
      NET.connected = false; NET.reconnecting = false; NET.replaced = false;
    } catch (e) { }
    showLobby(true);
    if (typeof netConnect === 'function') netConnect();
    if (typeof showMsg === 'function') showMsg('正在进入爆能器大厅…', '#7fd6ff');
  }
  function enterMatch() {
    if (SPIKE._inGame) return;
    SPIKE._inGame = 1;
    showLobby(false);
    /* 【batch168】大厅盖住画面时鼠标锁会丢掉；收起后要**重新锁一次**，
       否则点左键只是"重新锁定"、打不出子弹（用户报"我不能开枪"）。 */
    try { if (typeof lockPointer === 'function' && !isTouch) lockPointer(); } catch (e) { }
    enterGame();                                    /* 到这一刻才建图 / 开 HUD / 锁鼠标 */
    try { setMap(window.curMapId); } catch (e) { }  /* 【batch168】用**房间**的地图（队长定的），不用本机那张 */
    if (SPIKE.mySpawn) camera.position.set(SPIKE.mySpawn[0], GROUND_Y, SPIKE.mySpawn[1]);
    else playerSpawnAt();
    S.velY = 0; S.onGround = true; S.onLadder = false; S.mantle = 0; S.landKick = 0;
    updateHp();
    if (!NET.connected) { NET.reconnecting = false; netConnect(); }
  }

  /* ---------------- ⑦ 报文（由主体 js/30 转交过来）---------------- */
  function onMsg(m) {
    if (!m) return;
    /* 【batch168】队长换图 → 整个房间一起换：本机跟着切图（已在图里就立刻重建地图） */
    if (m.t === 'spikeMap') {
      try {
        var nm = String(m.m || '');
        if (nm && typeof mapById === 'function' && mapById(nm)) {
          window.curMapId = nm;
          var _mn3 = (mapById(nm) && mapById(nm).name) || nm;
          /* 【batch168】换图**当场生效**：已经在图里就立刻重建地图（服务端同时把人放到新图的出生点）；
             还在大厅就直接切（进游戏就是这张新图）—— 不用等下一回合。 */
          if (SPIKE._inGame && typeof setMap === 'function') setMap(nm);
          showMsg('已换图：' + _mn3 + (SPIKE._inGame ? '（已立刻切图）' : '（进游戏就是这张图）'), '#ffd24a');
        }
      } catch (e) { }
      return;
    }
    if (m.t === 'spikeYou') {
      SPIKE.team = (m.team | 0); SPIKE.mySpawn = m.spawn || null;
      /* 已经在地图里（第 2 回合起）→ 立刻送回出生点。第一回合由 enterMatch() 负责落点。 */
      if (SPIKE._inGame && SPIKE.mySpawn) {
        camera.position.set(SPIKE.mySpawn[0], GROUND_Y, SPIKE.mySpawn[1]);
        S.velY = 0; S.onGround = true; S.onLadder = false; S.mantle = 0; S.landKick = 0;
        NET.dead = false; updateHp();
        var nd = el('netDeath'); if (nd) nd.style.display = 'none';
        try { if (!isTouch && typeof lockPointer === 'function') lockPointer(); } catch (e) { }
      }
      return;
    }
    if (m.t !== 'spike') return;
    var wasOver = (SPIKE.phase === 'over');
    SPIKE.on = true;
    SPIKE.phase = m.phase || 'live'; SPIKE.round = m.round || 1; SPIKE.score = m.score || [0, 0];
    SPIKE.timer = m.timer || 0; SPIKE.fuse = m.fuse || 0; SPIKE.plant = m.plant || 0; SPIKE.defuse = m.defuse || 0;
    if (m.site) SPIKE.site = m.site;
    if (m.sites) SPIKE.sites = m.sites;
    if (typeof m.plantSite === 'number') SPIKE.plantSite = m.plantSite;
    SPIKE.carrier = m.carrier || 0;
    if (typeof m.winner === 'number') SPIKE.winner = m.winner;
    if (typeof m.reason !== 'undefined') SPIKE.reason = String(m.reason || '');
    if (typeof m.leader !== 'undefined') SPIKE.leader = m.leader;
    if (m.mk) SPIKE.mk = m.mk;
    if (typeof m.ar === 'number') SPIKE.allReady = !!m.ar;
    if (typeof m.st === 'number') SPIKE.started = !!m.st;
    /* 【batch168】爆能器掉在地上的位置（null / 缺省 ＝ 有人拿着） */
    if (typeof m.sp !== 'undefined') SPIKE.sp = m.sp || null;
    if (m.roster) SPIKE.roster = m.roster;      /* 观战要用：谁还活着、各自是哪队 */
    var ph = SPIKE.phase, chg = (SPIKE._lastPhase !== ph);
    SPIKE._lastPhase = ph;
    /* 大厅 / 地图 切换：等待中只在大厅；开打才进图；回合间隙亮比分板（人还留在地图里） */
    if (!SPIKE._lobby) { SPIKE._lobby = 1; showLobby(true); }
    if (ph === 'waiting') {
      SPIKE._inGame = 0;
      if (chg) showLobby(true);
    } else if (ph === 'over') {
      if (chg) showLobby(true);
    } else {
      if (!SPIKE._inGame) enterMatch();
      else if (chg) showLobby(false);
    }
    if (ph === 'prep' && chg) {                       /* 新回合：清掉阵亡态（回合制满血回出生点） */
      NET.dead = false; updateHp();
      var d2 = el('netDeath'); if (d2) d2.style.display = 'none';
    }
    if (!SPIKE._skin) {                               /* 局内：把原版的得分/金币/商店整块关掉 */
      SPIKE._skin = 1;
      ['score', 'gold-hud', 'wave-shop', 'shop-gold'].forEach(function (id) { var e = el(id); if (e) e.style.display = 'none'; });
    }
    hud();
    renderTeam(m.roster);
    if (ph === 'over' && !wasOver && typeof m.winner === 'number' && m.winner >= 0) {
      var t = (m.winner === 0 ? '🔺 进攻方获胜' : '🔹 防守方获胜') + (m.reason ? ('（' + m.reason + '）') : '');
      if (typeof showMsg === 'function') showMsg(t, '#ffd24a');
    }
    /* 【batch171】熟练度经验：安放成功 +50；回合胜方 +30、败方 +10（仅原版四英雄有熟练度） */
    if (chg && ph === 'planted' && typeof addHeroXp === 'function') { try { addHeroXp(SK.idx, 50); } catch (e) { } }
    if (ph === 'over' && !wasOver && typeof addHeroXp === 'function') {
      try { addHeroXp(SK.idx, (SPIKE.team === m.winner) ? 30 : 10); } catch (e) { }
    }
  }

  /* ---------------- ⑧ 每 100ms：按钮 / 光柱 / 包 / 上报安放拆除 ---------------- */
  setInterval(function () {
    try {
      if (!SPIKE.on) { try { showSpikeVM(false); if (_ballGrp) _ballGrp.visible = false; } catch (e) { } return; }
      btnSync(); spikeWeaponBtn(); markSync(); spikeSyncHand(); spikeDropFx(); soloTick(0.1); prepRingSync(); spectateTick();
      /* 【batch168】按 **G** 把爆能器扔出去：客户端算落点（视线前方 7 米），服务端校验距离 */
      try {
        /* 【batch169】keys 是用 KEYMAP 存取器实现的，只有映射过的逻辑键才有值；KeyG 没被映射，
           keys.KeyG 永远是 undefined → 以前按 G 完全没反应（包丢不出去）。直接读原始按键 _raw。 */
        var _g = ((typeof _raw !== 'undefined') && !!_raw.KeyG) || ((typeof keys !== 'undefined') && !!keys.KeyG);
        if (_carrying() && _g && !SPIKE._gHeld) {
          SPIKE._gHeld = 1;
          var _d2 = new THREE.Vector3(); camera.getWorldDirection(_d2);
          var _tx = camera.position.x + _d2.x * 7, _tz = camera.position.z + _d2.z * 7;
          if (SPIKE.solo) { SPIKE.sp = { x: _tx, z: _tz }; SPIKE.soloCarry = false; showMsg('已把爆能器扔出去', '#ffd24a'); }
          else netSend({ t: 'spike', a: 'throw', on: 1, x: Math.round(_tx * 100) / 100, z: Math.round(_tz * 100) / 100 });
        } else if (!_g) SPIKE._gHeld = 0;
      } catch (e) { }
      if (SPIKE.phase === 'prep' && SPIKE.mySpawn) {   /* 准备时间：本机也限制在出生点范围内 */
        var dx = camera.position.x - SPIKE.mySpawn[0], dz = camera.position.z - SPIKE.mySpawn[1];
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d > 6) { var k = 6 / d; camera.position.x = SPIKE.mySpawn[0] + dx * k; camera.position.z = SPIKE.mySpawn[1] + dz * k; }
      }
      if (typeof NET === 'undefined' || !NET.connected) return;
      /* 下包/拆包：长按 **4**（F 也保留，免得老玩家找不到） */
      var _pk = (typeof keys !== 'undefined') && !!(keys.Digit4 || keys.KeyF);
      var act = (near() && _pk) ? (SPIKE.phase === 'planted' ? 'defuse' : 'plant') : '';
      if (act !== SPIKE._act) { SPIKE._act = act; netSend({ t: 'spike', a: act, on: act ? 1 : 0 }); }
    } catch (e) { }
  }, 100);

  /* ---------------- ⑨ 界面绑定 ---------------- */
  function bind() {
    injectCss(); buildLobby();
    var on = function (id, fn) { var e = el(id); if (e) e.addEventListener('click', fn); };
    on('vlJoinA', function () { window.NET_TEAM = 0; netSend({ t: 'spikeTeam', team: 0 }); });
    on('vlJoinD', function () { window.NET_TEAM = 1; netSend({ t: 'spikeTeam', team: 1 }); });
    on('vlReady', function () { SPIKE.myReady = !SPIKE.myReady; netSend({ t: 'spikeReady', on: SPIKE.myReady ? 1 : 0 }); });
    on('vlStart', function () { netSend({ t: 'spikeStart' }); });
    on('vlFold', function () { showLobby(false); });
    on('vlQuit', function () { try { location.href = '/modes'; } catch (e) { } });
    /* 主菜单：进入大厅（**只连接 + 亮大厅，不进地图**）*/
    on('vbEnter', enterLobby);
    /* 设置面板是引擎的通用件，这里只是替它转一下手 */
    on('vbSet', function () { var b = el('menuSetBtn'); if (b) b.click(); });
    on('vbSet2', function () { var b = el('menuSetBtn'); if (b) b.click(); });
    /* 瓦罗兰特自己的页签 */
    try {
      var tabs = document.querySelectorAll('#vlMenu .vlTab');
      for (var i = 0; i < tabs.length; i++) (function (t) {
        t.addEventListener('click', function () {
          for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('on');
          t.classList.add('on');
          var k = t.getAttribute('data-vl');
          ['agent', 'map', 'how'].forEach(function (n) {
            var p = el('vlPane' + n.charAt(0).toUpperCase() + n.slice(1));
            if (p) p.classList[k === n ? 'add' : 'remove']('on');
          });
        });
      })(tabs[i]);
    } catch (e) { }
    var w = el('wave');
    if (w) w.addEventListener('click', function () { if (SPIKE.on) showLobby(true); });
    /* 【batch168】点过特工才算"选好了"（进房前必须选一次，不然进去没有英雄） */
    try {
      var hg = el('hero-grid');
      if (hg) hg.addEventListener('click', function () {
        SPIKE._heroPicked = 1;
        setTimeout(refreshEnterBtn, 60);        // 等引擎把 SK.idx 改完再读名字
      });
    } catch (e) { }
    /* 【batch168】**已经进房之后**再点主菜单「地图」页签 = 队长换图（不再只改自己本机） */
    try {
      var mg = el('map-grid');
      if (mg) mg.addEventListener('click', function (e) {
        if (!SPIKE.on) return;                  // 还没进房 → 保持原样（建房间时就拿这张图）
        e.preventDefault(); e.stopPropagation();
        var node = e.target || e.srcElement, card = null;
        while (node && node !== mg) { if (node.getAttribute && node.getAttribute('data-m')) { card = node; break; } node = node.parentNode; }
        var id = card ? card.getAttribute('data-m') : null;
        if (!id) return;
        if (!spikeMapOk(id)) { showMsg('这张图不支持爆能器模式', '#f66'); return; }
        if (typeof NET !== 'undefined' && NET.id === SPIKE.leader) { netSend({ t: 'spikeMap', m: id }); spikeReportCfg(id); }   /* 【batch180】队长换图时同时上报点位 */
        else showMsg('地图由队长决定（你是队员，改不了）', '#fc0');
      }, true);
    } catch (e) { }
    refreshEnterBtn();
    /* 手机：安放/拆除共用一个按钮（按住＝长按 F）—— 复用引擎的 tbtn（按键布局里可拖动）*/
    try {
      if (typeof tbtn === 'function') {
        tbtn('btnSpike', function () { keys.KeyF = true; }, function () { keys.KeyF = false; });
      }
    } catch (e) { }
    /* 从服务端「玩法模式选择页」(/modes) 进来时，网址上带着 ?room=&team= → 直接进大厅 */
    var came = false, soloWant = false;
    try {
      var q = new URLSearchParams(location.search);
      var r = q.get('room'), t = q.get('team');
      if (r) { window.NET_ROOM = String(r).slice(0, 24); came = true; }
      if (t === '0' || t === '1') { window.NET_TEAM = parseInt(t, 10); came = true; }
      if (q.get('mode')) came = true;
      if (q.get('solo') === '1') soloWant = true;
    } catch (e) { }
    if (soloWant) { startSoloTraining(); return; }   /* 单人训练：不连服务器，直接进图练安放 */
    /* 【batch168】**不再自动进大厅**：必须先选一次特工（网址里的房号/阵营仍然生效，
       选完特工点按钮就带着它们进房）。这就是"进房前人人都要选一次英雄"。 */
    /* 阵亡提示改成"回合制"文案（本页永远不复活，原版那句"3 秒后自动重生"不适用） */
    try {
      var nd = el('netDeath');
      if (nd) { var p = nd.querySelector('p'); if (p) p.textContent = '本回合不能复活 —— 等下一回合开始会满血重生'; }
    } catch (e) { }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();

  /* 【batch168】阵亡后**锁死操作**：不能开枪、不能放技能（只能观战）。
     做法是把引擎的 attack / heroCast 包一层：阵亡时直接吞掉，活着时原样放行。
     （刀与拾取由引擎自己的死亡态一并处理 —— hp=0 时 updatePlayer 已经不再推进。） */
  function _deadLocked() {
    return !!(SPIKE.on && SPIKE._inGame && typeof NET !== 'undefined' && NET.dead);
  }
  try {
    if (typeof window.attack === 'function' && !window.attack.__vlWrapped) {
      var _oa = window.attack;
      window.attack = function () { if (_deadLocked()) return; return _oa.apply(this, arguments); };
      window.attack.__vlWrapped = 1;
    }
    if (typeof window.heroCast === 'function' && !window.heroCast.__vlWrapped) {
      var _oh = window.heroCast;
      window.heroCast = function () { if (_deadLocked()) return; return _oh.apply(this, arguments); };
      window.heroCast.__vlWrapped = 1;
    }
  } catch (e) { }
  /* 观战要跟得上队友的转视角，100ms 太卡 → 单独跑一个 33ms（约 30fps）的跟随 */
  setInterval(spectateTick, 33);

  /* ---------------- ⑩ 对外接口 ---------------- */
  window.VLUI = {
    onMsg: onMsg,
    showLobby: showLobby,
    enterLobby: enterLobby,
    state: SPIKE,
    renderTeam: renderTeam,
    hud: hud,
    /* 【batch170】武器选择界面（B 键）的爆能器卡：
       · 没拾取爆能器 → 返回 null（界面里根本不出现这张卡，想选也选不了）
       · 已拾取 → 返回 {手持中: 当前是不是正拿着它}
       · selectSpike = 点卡片后切到手持爆能器 */
    spikeCard: function(){ if(!_carrying())return null; return {手持中: SPIKE.slot===2}; },
    selectSpike: function(){ setSlot(2); }
  };
})();
