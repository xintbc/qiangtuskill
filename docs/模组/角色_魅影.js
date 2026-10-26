/* ============================================================================
 * 模组：角色「魅影」—— 隐身 / 瞬闪 / 假人诱饵
 * 【模组信息】@id phantom　@name 魅影　@ver 1.7.5　@api 2
 * ----------------------------------------------------------------------------
 * 英雄：魅影（暗月 · 突进）
 *   V 隐身     ：8 秒内敌人看不见你（不追、不瞄、不锁、听不见），可自由移动射击
 *   B 瞬闪     ：朝前方快速突进并留下残影，之后 2.5 秒移速 +25%（复用原版 dash）
 *   N 假人诱饵 ：在面前放出一个向前行走的假人分身，吸引敌人仇恨并替自己挡下近身攻击
 * 被动：幻影步 —— 移动速度 +10%
 *
 * 安装：把本文件放进 mode/模组/ ，并在 载入清单.js 的 window.MOD_FILES 里加一行
 *       '角色_魅影'（本文件默认已加）。
 *
 * 多人模式：已同步登记服务端（服务器/服务端.js 英雄表 / 冷却表 / 英雄下标放行，
 *   并已重新生成 多文件版/服务端.js）。
 *   · 瞬闪＝原版 dash，联机原生可用；
 *   · 隐身＝走服务端「幽灵」机制：联机时别人看不见你（原地只剩一团暗影）、
 *     期间免疫伤害、仍可自由行动与射击；
 *   · 假人＝本地分身：单机吸引敌人仇恨；联机时通过 heroBroadcast 广播，其他玩家也能看见（远端复现模型，不回传、不扣血）。
 * 注意：联机请用「打过补丁的服务端」启动，朋友也需加载本模组客户端。
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__phantomModLoaded) return;
  window.__phantomModLoaded = true;
  var M = window.枪战模组;                    // 统一模组接口（1.7.5 起）
  if (!M) { console.warn('[魅影] 需要游戏 1.7.5 或更新版本（枪战模组接口未就绪），已跳过'); return; }
  if (typeof window.HEROES === 'undefined') return;
  var 模组 = M.定义({
    id: 'phantom', name: '魅影', ver: '1.7.5', author: '官方示例',
    desc: '暗月 · 突进（隐身 / 瞬闪 / 假人诱饵）'
  });
  if (!模组) return;

  /* ---------------- 1. 英雄数据 ---------------- */
  var 魅影 = {
    k: 'phantom', name: '魅影', tag: '突进', fac: '暗月', facDesc: '佣兵团 · 暗夜特工',
    icon: '👻', color: 0xd8e6ff, css: '#d8e6ff',
    passive: '幻影步：移动速度 +10%。',
    skills: [
      { k: 'phantom_invis', name: '隐身',     icon: '🌫️', cd: 12, dur: 8,   desc: '遁入无形：敌人看不见你，可自由移动与射击' },
      { k: 'dash',          name: '瞬闪',     icon: '💨', cd: 8,  dur: 2.5, desc: '朝前方快速突进并留下残影，之后 2.5 秒移速 +25%' },
      { k: 'phantom_decoy', name: '假人诱饵', icon: '🎭', cd: 14, dur: 6,   desc: '释放一个向前行走的假人分身，吸引敌人仇恨并替你挡下近身攻击' }
    ],
    // 多人：别人放魅影技能时，在他机器上复现可见效果（伤害由释放者走服务端 t:'hit' 权威结算，这里只复现假人模型）
    sync: function (skillKey, data, src) {
      if (skillKey === 'phantom_decoy' && data) {
        var nid = (src && src.netId) ? src.netId : 0;
        spawnRemoteDecoy(nid, data);
      }
    }
  };
  模组.加英雄(魅影);

  /* ---------------- 2. 运行时状态（只属于本模组，不污染游戏） ---------------- */
  var ST = {
    invis: 0,       // 隐身剩余秒
    decoy: null,    // 假人 {model,mats,dirX,dirZ,life,max,phase,fading}
    absorb: false,  // 假人正在替身挡伤（仅在 updateEnemies 期间为 true）
    _t: 0
  };
  var VIS_COLOR = 0x9fd8ff, DECOY_COLOR = 0x8f7bff;
  var MY_IDX = -1;

  function myHeroIdx() {
    for (var i = 0; i < HEROES.length; i++) if (HEROES[i] === 魅影) return i;
    return -1;
  }

  /* ---------------- 3. 技能效果 ---------------- */

  /* V 隐身 */
  模组.加技能('phantom_invis', function (i, s, H) {
    if (ST.invis > 0) return true;                 // 已隐身：提前退出走 heroCast 包裹
    ST.invis = s.dur || 8;
    try {
      if (typeof heroFxRingAt === 'function') heroFxRingAt(camera.position.x, camera.position.z, VIS_COLOR, 0.4, 1.7, 0.55);
      if (typeof spawnParticle === 'function') spawnParticle(new THREE.Vector3(camera.position.x, (typeof standSurfY === 'function' ? standSurfY() : 0) + 1.0, camera.position.z), VIS_COLOR, 10);
    } catch (e) { }
    invisOverlayShow();
    return true;
  });

  /* N 假人诱饵 */
  模组.加技能('phantom_decoy', function (i, s, H) {
    if (ST.decoy) return true;                     // 已有假人：提前取消走 heroCast 包裹
    spawnDecoy(s.dur || 6);
    /* 联机：把假人生成事件广播给同房其他人，让他们也看得见这个假人 */
    try {
      if (模组) {
        模组.广播('phantom_decoy', {
          x: camera.position.x, y: camera.position.y, z: camera.position.z,
          dirX: -Math.sin(yaw), dirZ: -Math.cos(yaw), dur: s.dur || 6
        });
      }
    } catch (e) { }
    return true;
  });

  /* ---------------- 4. 假人：生成 / 走路 / 回收 ---------------- */
  function spawnDecoy(dur) {
    try {
      if (typeof _buildPlayerModel !== 'function') return;
      var model = _buildPlayerModel();
      if (!model || !model.root) return;
      if (model.hb) model.hb.visible = false;                    // 假人不带血条
      var mats = [];
      model.root.traverse(function (o) {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();                       // 材质全局共享，克隆一份才能安全淡出
          o.material.transparent = true;
          o.material.opacity = 1;
          mats.push(o.material);
        }
      });
      var sy = (typeof standSurfY === 'function') ? standSurfY() : 0;
      var dirX = -Math.sin(yaw), dirZ = -Math.cos(yaw);          // 与 dash 同口径的前方向量
      model.root.position.set(camera.position.x, sy, camera.position.z);
      model.yawPivot.rotation.y = yaw;                            // 面向行走方向
      scene.add(model.root);
      ST.decoy = { model: model, mats: mats, dirX: dirX, dirZ: dirZ,
                   life: dur, max: dur, phase: Math.random() * 6.28, fading: false };
      if (typeof heroFxRingAt === 'function') heroFxRingAt(camera.position.x, camera.position.z, DECOY_COLOR, 0.4, 1.8, 0.5, sy + 0.08);
      if (typeof spawnParticle === 'function') spawnParticle(new THREE.Vector3(camera.position.x, sy + 1.1, camera.position.z), DECOY_COLOR, 12);
    } catch (e) { }
  }

  function updateDecoy(dt) {
    var D = ST.decoy; if (!D) return;
    D.life -= dt;
    var moved = false;
    if (!D.fading) {
      var nx = D.model.root.position.x + D.dirX * 7.5 * dt;
      var nz = D.model.root.position.z + D.dirZ * 7.5 * dt;
      var feet = D.model.root.position.y;
      var ok = true;
      if (typeof isColliding === 'function' && isColliding(nx, nz, 0.35, feet + GROUND_Y, true)) ok = false;
      if (Math.abs(nx) > worldLimit() - 1 || Math.abs(nz) > worldLimit() - 1) ok = false;
      if (ok) { D.model.root.position.x = nx; D.model.root.position.z = nz; moved = true; }
    }
    /* 脚底跟地形（上楼 / 下楼自动贴地，和敌人 AI 同口径） */
    try {
      if (typeof groundHeightAt === 'function') {
        var gh = groundHeightAt(D.model.root.position.x, D.model.root.position.z, D.model.root.position.y + GROUND_Y);
        D.model.root.position.y = gh - GROUND_Y;
      }
    } catch (e) { }
    /* 走路动画：摆腿 + 摆臂 */
    if (moved) D.phase += dt * 9; else D.phase += dt * 2;
    var sw = Math.sin(D.phase) * 0.32;
    try {
      if (moved) {
        if (D.model.legL && D.model.legL.hip) D.model.legL.hip.rotation.x = sw;
        if (D.model.legR && D.model.legR.hip) D.model.legR.hip.rotation.x = -sw;
        if (D.model.lArm) D.model.lArm.rotation.x = -sw * 0.7;
        if (D.model.rArm) D.model.rArm.rotation.x = sw * 0.45;
      } else {
        if (D.model.legL && D.model.legL.hip) D.model.legL.hip.rotation.x *= 0.9;
        if (D.model.legR && D.model.legR.hip) D.model.legR.hip.rotation.x *= 0.9;
        if (D.model.lArm) D.model.lArm.rotation.x *= 0.9;
        if (D.model.rArm) D.model.rArm.rotation.x *= 0.9;
      }
    } catch (e) { }
    /* 最后 0.8 秒淡出 */
    if (D.life <= 0.8) {
      D.fading = true;
      var k = Math.max(0, D.life / 0.8);
      for (var i = 0; i < D.mats.length; i++) { try { D.mats[i].opacity = k; } catch (e) { } }
    }
    if (D.life <= 0) removeDecoy();
  }

  function removeDecoy() {
    var D = ST.decoy; if (!D) return;
    var x = D.model.root.position.x, y = D.model.root.position.y, z = D.model.root.position.z;
    try {
      if (D.model.root.parent) D.model.root.parent.remove(D.model.root);
      for (var i = 0; i < D.mats.length; i++) { try { D.mats[i].dispose(); } catch (e) { } }
    } catch (e) { }
    ST.decoy = null;
    try { if (typeof spawnParticle === 'function') spawnParticle(new THREE.Vector3(x, y + 1.0, z), DECOY_COLOR, 12); } catch (e) { }
  }

  /* ---------------- 4.5 多人：远端假人（其他玩家看你放出的假人） ----------------
     引擎收到其他玩家的 t:'modsk'（skillKey='phantom_decoy'）时，会调用本英雄的 sync 复现。
     这里用 _buildPlayerModel 造一个临时模型，按广播的位置/朝向走路、淡出、回收，
     行为和本地假人一致，但这是“别人客户端上”的副本，不回传、不扣血。 */
  var ST_REMOTE = {};   // netId -> 假人状态
  function spawnRemoteDecoy(netId, d) {
    try {
      if (typeof _buildPlayerModel !== 'function') return;
      if (ST_REMOTE[netId]) removeRemoteDecoy(netId);
      var model = _buildPlayerModel();
      if (!model || !model.root) return;
      if (model.hb) model.hb.visible = false;
      var mats = [];
      model.root.traverse(function (o) {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 1;
          mats.push(o.material);
        }
      });
      model.root.position.set(d.x, d.y, d.z);
      model.yawPivot.rotation.y = Math.atan2(d.dirX, d.dirZ);
      scene.add(model.root);
      ST_REMOTE[netId] = { model: model, mats: mats, dirX: d.dirX, dirZ: d.dirZ,
        life: d.dur || 6, max: d.dur || 6, phase: Math.random() * 6.28, fading: false };
      if (typeof heroFxRingAt === 'function') heroFxRingAt(d.x, d.z, DECOY_COLOR, 0.4, 1.8, 0.5, d.y + 0.08);
      animateRemoteDecoy(netId);
    } catch (e) { }
  }
  function animateRemoteDecoy(netId) {
    var D = ST_REMOTE[netId]; if (!D) return;
    var last = performance.now();
    (function step() {
      var D2 = ST_REMOTE[netId]; if (!D2) return;
      var now = performance.now();
      var dt = Math.min((now - last) / 1000, 0.1); last = now;
      D2.life -= dt;
      var moved = false;
      if (!D2.fading) {
        var nx = D2.model.root.position.x + D2.dirX * 7.5 * dt;
        var nz = D2.model.root.position.z + D2.dirZ * 7.5 * dt;
        var ok = true;
        if (typeof isColliding === 'function' && isColliding(nx, nz, 0.35, D2.model.root.position.y + GROUND_Y, true)) ok = false;
        if (Math.abs(nx) > worldLimit() - 1 || Math.abs(nz) > worldLimit() - 1) ok = false;
        if (ok) { D2.model.root.position.x = nx; D2.model.root.position.z = nz; moved = true; }
      }
      try {
        if (typeof groundHeightAt === 'function') {
          var gh = groundHeightAt(D2.model.root.position.x, D2.model.root.position.z, D2.model.root.position.y + GROUND_Y);
          D2.model.root.position.y = gh - GROUND_Y;
        }
      } catch (e) { }
      D2.phase += dt * (moved ? 9 : 2);
      var sw = Math.sin(D2.phase) * 0.32;
      try {
        if (moved) {
          if (D2.model.legL && D2.model.legL.hip) D2.model.legL.hip.rotation.x = sw;
          if (D2.model.legR && D2.model.legR.hip) D2.model.legR.hip.rotation.x = -sw;
          if (D2.model.lArm) D2.model.lArm.rotation.x = -sw * 0.7;
          if (D2.model.rArm) D2.model.rArm.rotation.x = sw * 0.45;
        } else {
          if (D2.model.legL && D2.model.legL.hip) D2.model.legL.hip.rotation.x *= 0.9;
          if (D2.model.legR && D2.model.legR.hip) D2.model.legR.hip.rotation.x *= 0.9;
          if (D2.model.lArm) D2.model.lArm.rotation.x *= 0.9;
          if (D2.model.rArm) D2.model.rArm.rotation.x *= 0.9;
        }
      } catch (e) { }
      if (D2.life <= 0.8) {
        D2.fading = true;
        var k = Math.max(0, D2.life / 0.8);
        for (var i = 0; i < D2.mats.length; i++) { try { D2.mats[i].opacity = k; } catch (e) { } }
      }
      if (D2.life <= 0) { removeRemoteDecoy(netId); return; }
      requestAnimationFrame(step);
    })();
  }
  function removeRemoteDecoy(netId) {
    var D = ST_REMOTE[netId]; if (!D) return;
    try {
      if (D.model.root.parent) D.model.root.parent.remove(D.model.root);
      for (var i = 0; i < D.mats.length; i++) { try { D.mats[i].dispose(); } catch (e) { } }
    } catch (e) { }
    delete ST_REMOTE[netId];
  }

  /* ---------------- 5. 隐身屏幕特效（自建遮罩，不动原版元素） ---------------- */
  var _invisEl = null, _invisTip = null;
  function invisOverlayEnsure() {
    if (_invisEl) return;
    try {
      _invisEl = document.createElement('div');
      _invisEl.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:230;pointer-events:none;display:none;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(159,216,255,0) 45%,rgba(120,180,255,0.32) 100%);';
      _invisTip = document.createElement('div');
      _invisTip.style.cssText = 'position:absolute;top:20%;left:50%;transform:translateX(-50%);color:#cdeeff;font:600 16px/1.4 "Microsoft YaHei",sans-serif;text-shadow:0 0 12px rgba(120,190,255,0.9);white-space:nowrap;letter-spacing:1px;';
      _invisEl.appendChild(_invisTip);
      document.body.appendChild(_invisEl);
    } catch (e) { }
  }
  function invisOverlayShow() {
    invisOverlayEnsure();
    if (_invisEl) { _invisEl.style.display = 'flex'; _invisEl.style.opacity = '1'; }
  }
  function invisOverlayTick(sec) {
    invisOverlayEnsure();
    if (!_invisEl) return;
    if (_invisEl.style.display !== 'flex') _invisEl.style.display = 'flex';
    _invisEl.style.opacity = (0.5 + 0.3 * Math.abs(Math.sin(performance.now() * 0.003))).toFixed(3);
    if (_invisTip) _invisTip.textContent = '👻 隐身中 · 剩余 ' + Math.ceil(sec) + ' 秒 · ' +
      (isMultiMode() ? '别人看不见你（免疫伤害）' : '敌人看不见你');
  }
  function isMultiMode() { return typeof netIsMulti === 'function' && netIsMulti(); }
  function invisOverlayHide() {
    if (_invisEl) { _invisEl.style.opacity = '0'; _invisEl.style.display = 'none'; }
  }

  /* ---------------- 6. 每帧推进 + 钩子（全部在 onApply 里挂，确保游戏函数已就位） ---------------- */
  function myTick() {
    var now = performance.now();
    var dt = ST._t ? Math.min((now - ST._t) / 1000, 0.1) : 0.016;
    ST._t = now;
    var alive = !!(typeof S !== 'undefined' && S && S.playing && !S.over && S.hp > 0);
    if (!alive) {
      if (ST.invis > 0) { ST.invis = 0; invisOverlayHide(); }
      if (ST.decoy) removeDecoy();
      return;
    }
    if (ST.invis > 0) {
      ST.invis -= dt;
      invisOverlayTick(ST.invis);
      if (ST.invis <= 0) { ST.invis = 0; invisOverlayHide(); }
    }
    if (ST.decoy) updateDecoy(dt);
  }

  function wrapLoopHooks() {
    MY_IDX = myHeroIdx();
    /* 每帧推进：隐身倒计时 + 假人走路 */
    if (typeof window.updateHero === 'function') {
      var _uh = window.updateHero;
      window.updateHero = function () {
        try { myTick(); } catch (e) { }
        return _uh();
      };
    }
    /* 敌人 AI（仅单机有 AI 敌人）：
       · 假人在场 → 把“玩家位置”临时换成假人，敌人只会追假人、打假人（调用完立刻还原，不影响任何其它逻辑）
       · 只有隐身 → 临时置 ghost 标记，敌人看不见 / 听不见 / 锁不住你（调用完立刻还原，不影响玩家行动）
       · 联机是玩家互相对战、没有 AI → 直接走原逻辑，不做任何替换 */
    if (typeof window.updateEnemies === 'function') {
      var _ue = window.updateEnemies;
      window.updateEnemies = function () {
        if (isMultiMode()) return _ue();
        var D = ST.decoy, realPos = null, gSaved = null;
        if (D) {
          realPos = camera.position.clone();
          camera.position.set(D.model.root.position.x, D.model.root.position.y + GROUND_Y, D.model.root.position.z);
          ST.absorb = true;
        } else if (typeof SK !== 'undefined' && SK && ST.invis > 0) {
          gSaved = SK.ghost;
          SK.ghost = (SK.ghost > 0 ? SK.ghost : 0.001);
        }
        try { _ue(); }
        finally {
          if (realPos) { camera.position.copy(realPos); ST.absorb = false; }
          if (gSaved !== null) { SK.ghost = gSaved; }
        }
      };
    }
    /* 联机隐身：给位置上报包（t:'p'）注入 ghost 标记 → 服务端把我标记为「幽灵」
       （别人看不见你的模型、原地只剩暗影 + 免疫伤害）。不碰 SK.ghost / SK.shadowT，
       避免触发原版传送门 / 遁入暗影的副作用，隐身后照样能行动射击。 */
    if (typeof window.netSend === 'function') {
      var _ns = window.netSend;
      window.netSend = function (msg) {
        if (msg && msg.t === 'p' && ST.invis > 0 && isMultiMode()) msg.gh = 1;
        return _ns.apply(this, arguments);
      };
    }
    /* 假人挡伤：updateEnemies 期间被敌人近身攻击 → 伤害记到假人头上（扣寿命 + 火花），玩家不掉血 */
    if (typeof window.takeDmg === 'function') {
      var _td = window.takeDmg;
      window.takeDmg = function (n, src) {
        if (ST.absorb && ST.decoy) {
          ST.decoy.life = Math.max(0.15, ST.decoy.life - 1.2);
          try {
            if (typeof spawnParticle === 'function')
              spawnParticle(new THREE.Vector3(ST.decoy.model.root.position.x, ST.decoy.model.root.position.y + 1.0, ST.decoy.model.root.position.z), 0xff8a3d, 6);
          } catch (e) { }
          return;
        }
        return _td.apply(this, arguments);
      };
    }
    /* 技能键：隐身后再按 V / 假人在场再按 N = 提前取消（不重置冷却） */
    if (typeof window.heroCast === 'function') {
      var _hc = window.heroCast;
      window.heroCast = function (i) {
        i = i | 0;
        try {
          if (i === 0 && ST.invis > 0) {
            ST.invis = 0; invisOverlayHide();
            if (typeof showMsg === 'function') showMsg('已退出隐身', '#9fd8ff');
            if (typeof heroHudUpdate === 'function') heroHudUpdate(true);
            return true;
          }
          if (i === 2 && ST.decoy) {
            removeDecoy();
            if (typeof showMsg === 'function') showMsg('已收起假人', '#8f7bff');
            if (typeof heroHudUpdate === 'function') heroHudUpdate(true);
            return true;
          }
        } catch (e) { }
        return _hc.apply(this, arguments);
      };
    }
    /* 死亡 / 结算：清掉隐身遮罩与场上的假人 */
    function cleanupRound() {
      if (ST.invis > 0) { ST.invis = 0; invisOverlayHide(); }
      if (ST.decoy) removeDecoy();
    }
    if (typeof window.gameOver === 'function') {
      var _go = window.gameOver;
      window.gameOver = function () {
        cleanupRound();
        return _go.apply(this, arguments);
      };
    }
    if (typeof window.storyEnd === 'function') {
      var _se = window.storyEnd;
      window.storyEnd = function () {
        cleanupRound();
        return _se.apply(this, arguments);
      };
    }
    /* 被动：幻影步 —— 移动速度 +10% */
    if (typeof window.heroSpeedMul === 'function') {
      var _hs = window.heroSpeedMul;
      window.heroSpeedMul = function () {
        var m = _hs();
        try { if (typeof SK !== 'undefined' && SK && SK.idx === MY_IDX) m *= 1.1; } catch (e) { }
        return m;
      };
    }
  }
  模组.载入后(wrapLoopHooks);
  /* 退出对局清场：收掉假人、所有远端假人、隐身遮罩（否则回主菜单再开一局会残留） */
  模组.清场(function () {
    try { if (ST.invis > 0) { ST.invis = 0; invisOverlayHide(); } } catch (e) { }
    try { if (ST.decoy) removeDecoy(); } catch (e) { }
    try { for (var k in ST_REMOTE) removeRemoteDecoy(k); } catch (e) { }
  });
})();
