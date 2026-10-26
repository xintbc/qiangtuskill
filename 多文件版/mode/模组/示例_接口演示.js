/* ============================================================================
 *  示例模组：统一接口「全家桶」演示（1.7.5）
 * 【模组信息】@id demo_api　@name 接口演示　@ver 1.7.5　@api 2
 * ----------------------------------------------------------------------------
 *  这个文件把 window.枪战模组 的常用接口串了一遍，**复制改改就是你的模组**：
 *    定义 → 加英雄 / 加技能 / 加武器 / 加模式 / 加模型 / 放装饰 / 设环境 /
 *           设物理 / 每帧 / 广播
 *  默认不在载入清单里（不会自动生效）。想试：
 *    在 mode/模组/载入清单.js 的数组里加一行 '示例_接口演示'。
 *  所有接口都带兜底：没写到的字段不影响原版；没这个接口的老版本会直接跳过本文件。
 * ========================================================================== */
(function () {
  'use strict';
  var M = window.枪战模组;
  if (!M) { console.warn('[接口演示] 需要游戏 1.7.5 或更新版本（枪战模组接口未就绪），已跳过'); return; }

  var 模组 = M.定义({
    id: 'demo_api', name: '接口演示', ver: '1.7.5', author: '官方示例',
    desc: '统一接口全家桶：英雄 / 技能 / 枪 / 模式 / 美术 / 物理，全在这一份里'
  });
  if (!模组) return;

  /* ---------- 1) 美术：具名模型 + 装饰物 + 灯光 + 环境 ---------- */
  try {
    // 具名模型：以后随时 模组.取模型('演示柱') 拿一个新实例
    模组.加模型('演示柱', function () {
      var m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.8, 6, 12),
        new THREE.MeshLambertMaterial({ color: 0x44ddff, emissive: 0x113355 })
      );
      m.position.set(0, 3, -10);
      return m;
    });
    模组.放装饰(模组.取模型('演示柱'));

    var 灯 = new THREE.PointLight(0x66ccff, 1.2, 30);
    灯.position.set(0, 6, -10);
    模组.加灯(灯);

    // 雾更浓、天更蓝（没给的字段保持原样）
    模组.设环境({ fog: 0x0a1428, fogD: 0.025, ambient: 0.6 });
    模组.日志('美术：模型 / 装饰 / 灯光 / 环境 都登记好了');
  } catch (e) { 模组.警告('美术失败：' + (e && e.message)); }

  /* ---------- 2) 枪械：新增一把霰弹枪 + 顺手改内置步枪 ---------- */
  try {
    var 槽位 = 模组.加武器({
      name: '🔫 霰弹枪',
      damage: 1.6,        // 伤害倍率（相对原版 25/50）
      fireRate: 700,      // 两发间隔(ms)，越大越慢
      magSize: 8,
      reloadTime: 1600,
      range: 40,
      recoil: 1.4,
      build: function (g) {                       // 第一人称模型：在传进来的 Group 上自由搭
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34),
          new THREE.MeshLambertMaterial({ color: 0x333333 })));
        var 管 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 8),
          new THREE.MeshLambertMaterial({ color: 0x111111 }));
        管.rotation.x = Math.PI / 2; 管.position.set(0, 0.01, -0.36); g.add(管);
      }
    });
    模组.日志('枪械：新增霰弹枪，槽位 = ' + 槽位 + '（模组.切枪(' + 槽位 + ') 可切过去）');
    模组.改枪械(0, { damage: 2.0, fireRate: 90, magSize: 45, recoil: 0.8 });   // 0 = 内置步枪
  } catch (e) { 模组.警告('枪械失败：' + (e && e.message)); }

  /* ---------- 3) 物理：降重力 + 每帧回调 ---------- */
  try {
    模组.设物理({ gravity: 0.010, stepUp: 0.7 });
    模组.每帧(function (dt) {
      // dt = 本帧秒数。想做自定义力场 / 风 / 低重力漂浮，在这里改 S.velY 或 camera.position
    });
    模组.日志('物理：重力下调到 0.010，每帧回调已挂上');
  } catch (e) { 模组.警告('物理失败：' + (e && e.message)); }

  /* ---------- 4) 玩法模式：注册一个「团队死斗」 ---------- */
  try {
    模组.加多人模式({
      id: 'tdm', name: '团队死斗', icon: '⚔️', teams: 2,
      desc: '红蓝两队互相剿杀，先到 40 杀的一方获胜',
      start: function () { 模组.设队伍(2); 模组.日志('团队死斗：开局'); },
      tick: function (dt) { /* 回合计时 / 计分 等每帧逻辑 */ },
      hud: function () { return '团队死斗 · 进行中'; },
      onDeath: function () { return false; },     // false = 走原版结算
      end: function (win) { 模组.日志('团队死斗结束，胜方=' + win); }
    });
    模组.日志('玩法：「团队死斗」已登记（模组.进房("tdm","r1") 可进房）');
  } catch (e) { 模组.警告('玩法失败：' + (e && e.message)); }

  /* ---------- 5) 可联机的自定义英雄 + 技能 ----------
     联机时要记住三件事：
       ① 本地施放：自己播特效 + 结算伤害 + 模组.广播(技能键, 数据)
       ② 远端：引擎收到 t:'modsk' 自动调 HEROES[下标].sync(技能键, 数据, 远端玩家) —— 只复现特效
       ③ 伤害只由「释放者」结算一次（联机走服务端 t:'hit'），不然每个客户端都扣一遍 */
  try {
    // 冰环特效：本地 / 远端共用一个函数，两边长得一模一样
    function 冰环(x, y, z) {
      try {
        if (typeof THREE === 'undefined' || !scene) return;
        var ring = new THREE.Mesh(
          new THREE.RingGeometry(0.5, 0.62, 32),
          new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, (y || 0) + 0.05, z);
        ring.renderOrder = 950;
        scene.add(ring);
        var t0 = performance.now();
        (function 动画() {
          var k = (performance.now() - t0) / 600;
          if (k >= 1) { try { scene.remove(ring); } catch (e) { } return; }
          var sc = 1 + k * 7;
          ring.scale.set(sc, sc, sc);
          ring.material.opacity = 0.9 * (1 - k);
          requestAnimationFrame(动画);
        })();
      } catch (e) { }
    }

    模组.加技能('demo_frost', function (i, s, H) {
      var px = camera.position.x, py = camera.position.y - 1.6, pz = camera.position.z;
      var R = 7, DMG = 35;
      冰环(px, py, pz);
      try {
        for (var n = 0; n < enemies.length; n++) {
          var e = enemies[n];
          if (!e || e.hp <= 0 || (e.isNet && e.netId === NET.id)) continue;
          var ex = e.root ? e.root.position.x : (e.x || 0);
          var ez = e.root ? e.root.position.z : (e.z || 0);
          var dx = ex - px, dz = ez - pz;
          if (dx * dx + dz * dz > R * R) continue;
          if (e.isNet && NET.connected) netSend({ t: 'hit', i: e.netId, d: DMG, h: false });   // 服务端权威
          else if (!e.isNet) { e.hp -= DMG; e.flash = 0.3; }                                    // 单机本地
        }
      } catch (e) { }
      模组.广播('demo_frost', { x: px, y: py, z: pz, r: R });   // 别人只复现特效，不重复扣血
      return true;
    });

    模组.加英雄({
      k: 'demohero', name: '演示英雄', tag: '演示', fac: '无阵营',
      icon: '🎭', color: 0xff66cc, css: '#ff66cc',
      passive: '演示被动：无（仅展示多人英雄接口）。',
      skills: [{
        k: 'demo_frost', name: '冰环', icon: '❄', cd: 12, dur: 0,
        desc: '脚下炸开冰环，7 米内敌人受 35 点伤害。联机时别人也看得见，伤害只由释放者结算。'
      }],
      sync: function (技能键, 数据, 是谁) {      // 远端收到时调用：只复现特效
        if (技能键 === 'demo_frost' && 数据) 冰环(数据.x, 数据.y, 数据.z);
      }
    });
    模组.日志('英雄：「演示英雄」已加（带可联机的冰环技能 demo_frost）');
  } catch (e) { 模组.警告('英雄失败：' + (e && e.message)); }

  /* ---------- 6) 每局开始 / 结束的收尾 ---------- */
  模组.载入后(function () { 模组.日志('全部模组载入完毕（这里适合做包裹原版函数的活）'); });
  模组.清场(function () { /* 退出对局时把本模组放进场上的东西收掉 */ });

  模组.日志('演示完毕。此模组只登记内容，不会强制切换任何状态。');
})();
