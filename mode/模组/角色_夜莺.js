/* ============================================================================
 * 模组：角色「夜莺」—— 暗月组织新成员 · 歌声医师
 * 【模组信息】@id nightingale　@name 夜莺　@ver 1.7.5　@api 2
 * ----------------------------------------------------------------------------
 * 英雄：夜莺（暗月 · 医者）
 *   V 治愈之歌 ：以自身为中心 7 米的治愈光环，每 0.5 秒为自己与友方回复 6 点生命，
 *                持续 6 秒（联机可扶起倒地队友；再按一次 V 提前收声）
 *   B 安神谣   ：12 米内瞬间回复 25 点生命，并解除减速
 *   N 安魂曲   ：大招，15 米大范围持续治疗，每秒回复 10 点，持续 8 秒
 * 被动：余音绕梁 —— 歌声持续期间，自身移速 +12%
 *
 * 安装：把本文件放进 mode/模组/ ，并在 载入清单.js 的 window.MOD_FILES 里加一行
 *       '角色_夜莺'（本文件默认已加）。
 *
 * 多人模式：
 *   · 治疗数值走**服务端权威**：联机时释放者把治疗中心/半径/治疗量发给服务端
 *     （{t:'heal', x, z, r, a, us}），服务端对同房范围内玩家 healSrv（满血不治、
 *     倒地的会被扶起），并广播 t:'hp' —— 与内置医疗兵同一条回血通道；
 *   · 视觉特效走 heroBroadcast / sync：光环、音符、波纹别人也看得见；
 *   · 单机没有友方单位 → 单机下歌声只治疗自己（AI 敌人是敌方，不治）。
 * 注意：联机请用「打过补丁的服务端」启动，朋友也需加载本模组客户端。
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__nightingaleModLoaded) return;
  window.__nightingaleModLoaded = true;
  var M = window.枪战模组;                    // 统一模组接口（1.7.5 起）
  if (!M) { console.warn('[夜莺] 需要游戏 1.7.5 或更新版本（枪战模组接口未就绪），已跳过'); return; }
  if (typeof window.HEROES === 'undefined') return;
  var 模组 = M.定义({
    id: 'nightingale', name: '夜莺', ver: '1.7.5', author: '官方示例',
    desc: '暗月 · 歌声医师（治愈 / 解控 / 大范围持续治疗）'
  });
  if (!模组) return;

  var SONG_COLOR = 0x9ff0d0;                 // 歌声主色：薄荷青绿
  var SONG_CSS = '#9ff0d0';

  /* ---------------- 1. 英雄数据 ---------------- */
  var 夜莺 = {
    k: 'nightingale', name: '夜莺', tag: '医者', fac: '暗月', facDesc: '暗月战线 · 歌声医师',
    icon: '🎵', color: SONG_COLOR, css: SONG_CSS,
    passive: '余音绕梁：歌声持续期间，自身移速 +12%。',
    skills: [
      { k: 'song_heal',    name: '治愈之歌', icon: '🎶', cd: 20, dur: 6, desc: '以自身为中心 7 米的治愈光环：每 0.5 秒为自己与友方回复 6 点生命，持续 6 秒（可扶起倒地队友）' },
      { k: 'song_calm',    name: '安神谣',   icon: '🕊️', cd: 12, dur: 0, desc: '12 米内瞬间回复 25 点生命，并解除减速' },
      { k: 'song_lullaby', name: '安魂曲',   icon: '🌙', cd: 75, dur: 8, desc: '大招：15 米大范围持续治疗，每秒回复 10 点，持续 8 秒' }
    ],
    // 多人：别人放夜莺技能时，在他机器上复现可见效果（治疗数值由释放者走服务端 t:'heal' 权威结算）
    sync: function (skillKey, data, src) {
      if (!data) return;
      if (skillKey === 'song_heal' || skillKey === 'song_lullaby') {
        spawnRemoteRing(data, src);
      } else if (skillKey === 'song_calm') {
        remoteCalmFx(data);
      }
    }
  };
  模组.加英雄(夜莺);

  /* ---------------- 2. 运行时状态 ---------------- */
  var ST = {
    song: 0,        // 歌声剩余秒（>0 表示正在唱）
    songMax: 0,
    acc: 0,         // 治疗累计计时
    every: 0.5,     // 每跳间隔
    r: 7,           // 当前治疗半径
    amt: 6,         // 每跳治疗量
    key: 'song_heal',
    noteAcc: 0,     // 音符粒子计时
    ring: null, ringMeshes: null, ringMats: null,
    _t: 0
  };
  var MY_IDX = -1;

  function myHeroIdx() {
    for (var i = 0; i < HEROES.length; i++) if (HEROES[i] === 夜莺) return i;
    return -1;
  }
  function isMultiMode() { return typeof netIsMulti === 'function' && netIsMulti(); }
  function netOn() {
    return (typeof NET !== 'undefined' && NET && NET.connected && typeof netSend === 'function');
  }

  /* ---------------- 3. 技能效果 ---------------- */

  /* V 治愈之歌 / N 安魂曲：开唱（持续治疗光环） */
  function startSong(dur, r, amt, every, key) {
    ST.song = ST.songMax = dur;
    ST.r = r; ST.amt = amt; ST.every = every; ST.key = key;
    ST.acc = 0; ST.noteAcc = 0;
    ensureRing();
    /* 联机：广播“开唱”事件，其他玩家也在他机器上放一个同样的光环 */
    try {
      模组.广播(key, {
        x: camera.position.x, y: camera.position.y, z: camera.position.z, r: r, dur: dur
      });
    } catch (e) { }
    try {
      if (typeof heroFxRingAt === 'function') heroFxRingAt(camera.position.x, camera.position.z, SONG_COLOR, 0.3, r * 0.9, 0.6);
      if (typeof spawnParticle === 'function') spawnParticle(new THREE.Vector3(camera.position.x, camera.position.y - 0.6, camera.position.z), SONG_COLOR, 14);
      if (typeof showMsg === 'function') showMsg('🎵 夜莺开始歌唱……', SONG_CSS);
    } catch (e) { }
    overlayShow();
  }

  /* 收声（自然结束 / 提前取消共用） */
  function endSong(quiet) {
    ST.song = 0; ST.acc = 0;
    removeRing();
    if (!quiet) {
      try { if (typeof showMsg === 'function') showMsg('🎵 歌声停了', SONG_CSS); } catch (e) { }
    }
    overlayHide();
  }

  模组.加技能('song_heal', function (i, s, H) {
    if (ST.song > 0) { endSong(); return true; }        // 正在唱：再按一次提前收声（不重置冷却）
    startSong(s.dur || 6, 7, 6, 0.5, 'song_heal');
    return true;
  });

  模组.加技能('song_lullaby', function (i, s, H) {
    if (ST.song > 0) { endSong(true); }                 // 大招盖过小歌
    startSong(s.dur || 8, 15, 10, 1.0, 'song_lullaby');
    return true;
  });

  /* B 安神谣：瞬发中范围治疗 + 解减速 */
  模组.加技能('song_calm', function (i, s, H) {
    var r = 12, amt = 25;
    /* 数值结算：联机走服务端权威（同房范围内所有人，含自己）；单机只治自己 */
    if (netOn()) {
      try { netSend({ t: 'heal', x: camera.position.x, z: camera.position.z, r: r, a: amt, us: 1 }); } catch (e) { }
    } else {
      try {
        S.hp = Math.min(S.maxHp, S.hp + amt);
        SK.slow = 0;
        if (typeof updateHp === 'function') updateHp();
      } catch (e) { }
    }
    /* 联机：广播特效；视觉本地照播 */
    try {
      模组.广播('song_calm', { x: camera.position.x, y: camera.position.y, z: camera.position.z, r: r });
    } catch (e) { }
    try {
      if (typeof heroFxRingAt === 'function') heroFxRingAt(camera.position.x, camera.position.z, SONG_COLOR, 0.2, r, 0.7);
      if (typeof spawnParticle === 'function') spawnParticle(new THREE.Vector3(camera.position.x, camera.position.y - 0.4, camera.position.z), SONG_COLOR, 18);
      if (typeof showMsg === 'function') showMsg('🕊️ 安神谣：抚平伤痛', SONG_CSS);
    } catch (e) { }
    return true;
  });

  /* 治疗一跳（每 every 秒一次） */
  function healTick() {
    if (netOn()) {
      /* 联机：发包给服务端，服务端治疗同房范围内玩家（含我自己，靠 t:'hp' 回来） */
      try {
        netSend({ t: 'heal', x: camera.position.x, z: camera.position.z, r: ST.r, a: ST.amt });
      } catch (e) { }
    } else {
      /* 单机：没有友方单位，只治自己 */
      try {
        if (S.hp > 0 && S.hp < S.maxHp) {
          S.hp = Math.min(S.maxHp, S.hp + ST.amt);
          if (typeof updateHp === 'function') updateHp();
        }
      } catch (e) { }
    }
    /* 治疗反馈（本地始终播） */
    try {
      if (typeof spawnParticle === 'function') spawnParticle(new THREE.Vector3(camera.position.x, camera.position.y - 0.7, camera.position.z), SONG_COLOR, 4);
    } catch (e) { }
  }

  /* ---------------- 4. 光环视觉 ---------------- */
  function ensureRing() {
    if (ST.ring) return ST.ring;
    try {
      var g = new THREE.Group();
      var m1 = new THREE.Mesh(new THREE.RingGeometry(0.90, 1.0, 64),
        new THREE.MeshBasicMaterial({ color: SONG_COLOR, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      m1.rotation.x = -Math.PI / 2; g.add(m1);
      var m2 = new THREE.Mesh(new THREE.RingGeometry(0.60, 0.68, 48),
        new THREE.MeshBasicMaterial({ color: SONG_COLOR, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
      m2.rotation.x = -Math.PI / 2; m2.position.y = 0.03; g.add(m2);
      var m3 = new THREE.Mesh(new THREE.CircleGeometry(0.86, 48),
        new THREE.MeshBasicMaterial({ color: SONG_COLOR, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false }));
      m3.rotation.x = -Math.PI / 2; g.add(m3);
      scene.add(g);
      ST.ring = g; ST.ringMeshes = [m1, m2, m3]; ST.ringMats = [m1.material, m2.material, m3.material];
    } catch (e) { }
    return ST.ring;
  }
  function removeRing() {
    if (!ST.ring) return;
    try {
      if (ST.ring.parent) ST.ring.parent.remove(ST.ring);
      for (var i = 0; i < ST.ringMats.length; i++) { try { ST.ringMats[i].dispose(); } catch (e) { } }
    } catch (e) { }
    ST.ring = null; ST.ringMeshes = null; ST.ringMats = null;
  }
  function updateRing(dt) {
    var g = ST.ring; if (!g) return;
    try {
      var gy = camera.position.y;
      if (typeof groundHeightAt === 'function') gy = groundHeightAt(camera.position.x, camera.position.z, camera.position.y + (typeof GROUND_Y !== 'undefined' ? GROUND_Y : 0));
      g.position.set(camera.position.x, gy + 0.06, camera.position.z);
      g.scale.set(ST.r, ST.r, 1);
      var pulse = 0.5 + 0.12 * Math.sin(performance.now() * 0.005);
      if (ST.ringMeshes) {
        ST.ringMeshes[1].rotation.z += dt * 0.9;
        ST.ringMats[0].opacity = pulse;
        ST.ringMats[1].opacity = pulse * 0.6;
        ST.ringMats[2].opacity = 0.06 + 0.04 * Math.abs(Math.sin(performance.now() * 0.003));
      }
    } catch (e) { }
  }

  /* ---------------- 5. 屏幕效果（唱歌时的淡绿边缘光） ---------------- */
  var _ovEl = null;
  function overlayEnsure() {
    if (_ovEl) return;
    try {
      _ovEl = document.createElement('div');
      _ovEl.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:228;pointer-events:none;display:none;' +
        'background:radial-gradient(ellipse at center,rgba(159,240,208,0) 52%,rgba(120,230,190,0.20) 100%);';
      document.body.appendChild(_ovEl);
    } catch (e) { }
  }
  function overlayShow() { overlayEnsure(); if (_ovEl) _ovEl.style.display = 'block'; }
  function overlayHide() { if (_ovEl) _ovEl.style.display = 'none'; }

  /* ---------------- 6. 多人：远端复现 ---------------- */
  /* 6a. 远端光环：别人唱治愈之歌/安魂曲时，在他机器上放一个同半径的光环，到点消失 */
  var REMOTE = {};   // netId -> {g, meshes, mats, life, max}
  function spawnRemoteRing(d, src) {
    try {
      var nid = (src && src.netId) ? src.netId : 0;
      removeRemoteRing(nid);
      var g = new THREE.Group();
      var m1 = new THREE.Mesh(new THREE.RingGeometry(0.90, 1.0, 64),
        new THREE.MeshBasicMaterial({ color: SONG_COLOR, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      m1.rotation.x = -Math.PI / 2; g.add(m1);
      var m3 = new THREE.Mesh(new THREE.CircleGeometry(0.86, 48),
        new THREE.MeshBasicMaterial({ color: SONG_COLOR, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
      m3.rotation.x = -Math.PI / 2; g.add(m3);
      var r = (typeof d.r === 'number' && d.r > 0) ? d.r : 7;
      var dur = (typeof d.dur === 'number' && d.dur > 0) ? d.dur : 6;
      var gy = (typeof d.y === 'number') ? d.y : 0;
      if (typeof groundHeightAt === 'function') gy = groundHeightAt(d.x, d.z, gy + (typeof GROUND_Y !== 'undefined' ? GROUND_Y : 0));
      g.position.set(d.x, gy + 0.06, d.z);
      g.scale.set(r, r, 1);
      scene.add(g);
      REMOTE[nid] = { g: g, mats: [m1.material, m3.material], life: dur, max: dur };
      animateRemoteRing(nid);
      try { if (typeof heroFxRingAt === 'function') heroFxRingAt(d.x, d.z, SONG_COLOR, 0.3, r, 0.6); } catch (e) { }
    } catch (e) { }
  }
  function animateRemoteRing(nid) {
    var D = REMOTE[nid]; if (!D) return;
    var last = performance.now();
    (function step() {
      var D2 = REMOTE[nid]; if (!D2) return;
      var now = performance.now();
      var dt = Math.min((now - last) / 1000, 0.1); last = now;
      D2.life -= dt;
      var k = Math.max(0, D2.life / D2.max);
      D2.mats[0].opacity = 0.5 * k;
      D2.mats[1].opacity = 0.08 * k;
      D2.g.rotation.z += dt * 0.5;
      if (D2.life <= 0) { removeRemoteRing(nid); return; }
      requestAnimationFrame(step);
    })();
  }
  function removeRemoteRing(nid) {
    var D = REMOTE[nid]; if (!D) return;
    try {
      if (D.g.parent) D.g.parent.remove(D.g);
      for (var i = 0; i < D.mats.length; i++) { try { D.mats[i].dispose(); } catch (e) { } }
    } catch (e) { }
    delete REMOTE[nid];
  }
  /* 6b. 远端安神谣：一圈扩散波纹 + 粒子 */
  function remoteCalmFx(d) {
    try {
      var r = (typeof d.r === 'number' && d.r > 0) ? d.r : 12;
      var gy = (typeof d.y === 'number') ? d.y : 0;
      if (typeof heroFxRingAt === 'function') heroFxRingAt(d.x, d.z, SONG_COLOR, 0.2, r, 0.7);
      if (typeof spawnParticle === 'function') spawnParticle(new THREE.Vector3(d.x, gy - 0.4, d.z), SONG_COLOR, 16);
    } catch (e) { }
  }

  /* ---------------- 7. 每帧推进 ---------------- */
  function myTick() {
    var now = performance.now();
    var dt = ST._t ? Math.min((now - ST._t) / 1000, 0.1) : 0.016;
    ST._t = now;
    var alive = !!(typeof S !== 'undefined' && S && S.playing && !S.over && S.hp > 0);
    if (!alive) {
      if (ST.song > 0) endSong(true);
      return;
    }
    if (ST.song > 0) {
      ST.song -= dt;
      ST.acc += dt;
      if (ST.acc >= ST.every) { ST.acc -= ST.every; healTick(); }
      /* 音符粒子：边唱边飘 */
      ST.noteAcc += dt;
      if (ST.noteAcc >= 0.28) {
        ST.noteAcc = 0;
        try {
          if (typeof spawnParticle === 'function')
            spawnParticle(new THREE.Vector3(camera.position.x, camera.position.y - 0.8, camera.position.z), SONG_COLOR, 3, 1.6);
        } catch (e) { }
      }
      updateRing(dt);
      if (ST.song <= 0) endSong(true);
    }
  }

  /* ---------------- 8. 钩子 ---------------- */
  function wrapLoopHooks() {
    MY_IDX = myHeroIdx();
    /* 每帧推进：歌声倒计时 + 治疗跳 + 光环动画 */
    if (typeof window.updateHero === 'function') {
      var _uh = window.updateHero;
      window.updateHero = function () {
        try { myTick(); } catch (e) { }
        return _uh();
      };
    }
    /* 提前收声：正在唱时再按同一个技能键 = 停下（不重置冷却） */
    if (typeof window.heroCast === 'function') {
      var _hc = window.heroCast;
      window.heroCast = function (i) {
        i = i | 0;
        try {
          if (ST.song > 0 && ((i === 0 && ST.key === 'song_heal') || (i === 2 && ST.key === 'song_lullaby'))) {
            endSong();
            if (typeof heroHudUpdate === 'function') heroHudUpdate(true);
            return true;
          }
        } catch (e) { }
        return _hc.apply(this, arguments);
      };
    }
    /* 被动：余音绕梁 —— 歌声期间自身移速 +12% */
    if (typeof window.heroSpeedMul === 'function') {
      var _hs = window.heroSpeedMul;
      window.heroSpeedMul = function () {
        var m = _hs();
        try { if (typeof SK !== 'undefined' && SK && SK.idx === MY_IDX && ST.song > 0) m *= 1.12; } catch (e) { }
        return m;
      };
    }
    /* 死亡 / 结算：收声 + 清光环 */
    function cleanupRound() { if (ST.song > 0) endSong(true); removeRing(); overlayHide(); }
    if (typeof window.gameOver === 'function') {
      var _go = window.gameOver;
      window.gameOver = function () { cleanupRound(); return _go.apply(this, arguments); };
    }
    if (typeof window.storyEnd === 'function') {
      var _se = window.storyEnd;
      window.storyEnd = function () { cleanupRound(); return _se.apply(this, arguments); };
    }
  }
  模组.载入后(wrapLoopHooks);
  /* 退出对局清场：收声、撤光环、清远端复现的歌声环（否则回主菜单再开一局会残留） */
  模组.清场(function () {
    try { if (ST.song > 0) endSong(true); } catch (e) { }
    try { removeRing(); } catch (e) { }
    try { for (var k in REMOTE) removeRemoteRing(k); } catch (e) { }
    overlayHide();
  });
})();
