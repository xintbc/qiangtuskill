/* ============================================================================
 *  示例模组：展示新版「美术 / 枪械 / 物理 / 多人模式」四个模组接口怎么用
 *  ----------------------------------------------------------------------------
 *  本文件只是示范，不会自动生效。想试用，把 '示例_接口演示' 加到
 *  mode/模组/载入清单.js 的数组里即可（加在现有条目后面）。
 *  全部接口都带兜底：没用到的字段不影响原版；引擎读不到 ModLoader 时自动走原版。
 * ========================================================================== */
(function () {
  'use strict';
  var ML = window.ModLoader;
  if (!ML) { console.warn('[接口演示] 没找到 ModLoader，跳过'); return; }

  /* ---------- 1) 美术：加一个发光柱子 + 改环境雾 ---------- */
  try {
    var pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.8, 6, 12),
      new THREE.MeshLambertMaterial({ color: 0x44ddff, emissive: 0x113355 })
    );
    pillar.position.set(0, 3, -10);
    ML.addScenery(pillar);

    // 再叠一盏点光源照亮它
    var lamp = new THREE.PointLight(0x66ccff, 1.2, 30);
    lamp.position.set(0, 6, -10);
    ML.addLight(lamp);

    // 把雾调浓一点、天空染成深蓝（不传的字段保持原样）
    ML.setEnv({ fog: 0x0a1428, fogD: 0.025, ambient: 0.6 });
    console.log('[接口演示] 美术：已加装饰物 + 改环境');
  } catch (e) { console.warn('[接口演示] 美术失败', e); }

  /* ---------- 2) 枪械：新增一把“霰弹枪” + 顺手改原版步枪属性 ---------- */
  try {
    var shotgunIdx = ML.addWeapon({
      name: '🔫 霰弹枪',
      melee: false,
      damage: 1.6,        // 伤害倍率（相对原版 25/50）
      fireRate: 700,      // 两发间隔(ms)，越大越慢
      magSize: 8,
      reloadTime: 1600,
      range: 40,
      recoil: 1.4,
      // 第一人称模型：在传进来的 Group 上自由搭
      build: function (g) {
        var body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), new THREE.MeshLambertMaterial({ color: 0x333333 }));
        g.add(body);
        var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 8), new THREE.MeshLambertMaterial({ color: 0x111111 }));
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.01, -0.36); g.add(barrel);
      }
    });
    console.log('[接口演示] 枪械：新增霰弹枪，槽位 =', shotgunIdx, '（用 ModLoader.selectWeapon(' + shotgunIdx + ') 切过去）');

    // 覆盖内置步枪（slot 0）：伤害翻倍、射速更慢、弹匣更大
    ML.setWeaponStats(0, { damage: 2.0, fireRate: 90, magSize: 45, recoil: 0.8 });
    console.log('[接口演示] 枪械：已覆盖内置步枪属性');
  } catch (e) { console.warn('[接口演示] 枪械失败', e); }

  /* ---------- 3) 物理：降低重力 + 每帧给所有玩家一个轻微上浮 ---------- */
  try {
    ML.setPhysics({ gravity: 0.010, stepUp: 0.7 });
    ML.addPhysicsTick(function (dt) {
      // dt = 本帧秒数；这里什么都不强制改，只演示“每帧能拿到 dt”
      // 想做自定义力场/风/低重力漂浮，在这里改 S.velY 或 camera.position 即可
    });
    console.log('[接口演示] 物理：重力下调到 0.010，已注册每帧回调');
  } catch (e) { console.warn('[接口演示] 物理失败', e); }

  /* ---------- 4) 多人模式：注册一个“团队死斗” ---------- */
  try {
    ML.addMPMode({
      id: 'tdm', name: '团队死斗', icon: '⚔️', teams: 2,
      desc: '红蓝两队互相剿杀，先到 40 杀的一方获胜',
      start: function () { ML.setTeams(2); console.log('[接口演示] 团队死斗：开局'); },
      tick: function (dt) { /* 回合计时 / 计分 等每帧逻辑 */ },
      hud: function () { return '团队死斗 · 进行中'; },
      onDeath: function () { return false; },   // false = 走原版结算
      end: function (win) { console.log('[接口演示] 团队死斗结束，胜方=', win); }
    });
    console.log('[接口演示] 多人模式：已注册「团队死斗」（id=tdm）。用 ModLoader.joinMP("tdm","r1") 进房');
  } catch (e) { console.warn('[接口演示] 多人模式失败', e); }

  /* ---------- 5) 多人英雄技能：一个可联机的自定义英雄 + 技能 ----------
     演示「模组英雄如何在联机里也正常」：
       · 用 ML.addHero 加一个英雄（带 sync 字段）；
       · 用 ML.addSkill 注册一个技能效果（CUSTOM_SKILLS['demo_frost']）；
       · 本地施放：播特效 + 给范围内敌人结算伤害 + ML.heroBroadcast 把事件广播出去；
       · 远端收到 t:'modsk' → 引擎自动调用 HEROES[h].sync('demo_frost', data, 远端玩家对象) 复现特效。
     注意：伤害由「释放者」这一个人权威结算（联机走服务端 t:'hit'，单机直接改 e.hp），
           远端只复现“看得到”的特效，不重复扣血——避免每个客户端都扣一遍。 */
  try {
    var DEMO_TAG = '演示英雄';

    // 在 (x,y,z) 处生成一个冰环特效（本地/远端都用同一个函数，保证两边长一样）
    function demoFrostRing(x, y, z, color) {
      try {
        if (typeof THREE === 'undefined' || !scene) return;
        var ring = new THREE.Mesh(
          new THREE.RingGeometry(0.5, 0.62, 32),
          new THREE.MeshBasicMaterial({ color: color || 0x9fe8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, (y || 0) + 0.05, z);
        ring.renderOrder = 950;
        scene.add(ring);
        var t0 = performance.now();
        (function anim() {
          var k = (performance.now() - t0) / 600;
          if (k >= 1) { try { scene.remove(ring); } catch (e) { } return; }
          var sc = 1 + k * 7;                       // 冰环从 1 倍扩散到 8 倍
          ring.scale.set(sc, sc, sc);
          ring.material.opacity = 0.9 * (1 - k);
          requestAnimationFrame(anim);
        })();
      } catch (e) { }
    }

    // 技能效果：本地施放时跑
    ML.addSkill('demo_frost', function (i, s, H) {
      var px = camera.position.x, py = camera.position.y - 1.6, pz = camera.position.z;
      var R = 7, DMG = 35;
      demoFrostRing(px, py, pz, 0x9fe8ff);          // 本体先播
      // 范围内敌人结算：联机只让“释放者”发 t:'hit'（服务端权威，不重复扣）；单机直接改 AI 的 hp
      try {
        for (var n = 0; n < enemies.length; n++) {
          var e = enemies[n];
          if (!e || e.hp <= 0 || (e.isNet && e.netId === NET.id)) continue;
          var ex = e.root ? e.root.position.x : (e.x || 0);
          var ez = e.root ? e.root.position.z : (e.z || 0);
          var dx = ex - px, dz = ez - pz;
          if (dx * dx + dz * dz > R * R) continue;
          if (e.isNet && NET.connected) {
            netSend({ t: 'hit', i: e.netId, d: DMG, h: false });   // 走服务端权威结算
          } else if (!e.isNet) {
            e.hp -= DMG; e.flash = 0.3;                             // 单机本地结算（与引擎内联写法一致）
          }
        }
      } catch (e) { }
      // 把“看得到”的事件广播给同房其他玩家（他们只会复现特效，不重复扣血）
      ML.heroBroadcast('demo_frost', { x: px, y: py, z: pz, r: R });
      return true;
    });

    // 加一个英雄：技能 k 指向上面注册的 demo_frost；sync 负责远端复现
    ML.addHero({
      k: 'demohero', name: DEMO_TAG, tag: '演示', fac: '无阵营', icon: '🎭', color: 0xff66cc, css: '#ff66cc',
      passive: '演示被动：无（仅展示多人英雄接口）。',
      skills: [
        { k: 'demo_frost', name: '冰环', icon: '❄', cd: 12, dur: 0, desc: '脚下炸开冰环，7 米内敌人受 35 点伤害。联机时别人也能看到冰环、且只由释放者权威结算伤害。' }
      ],
      // 远端玩家收到 t:'modsk' 时调用：只复现特效
      sync: function (skillKey, data, src) {
        if (skillKey === 'demo_frost' && data) demoFrostRing(data.x, data.y, data.z, 0x9fe8ff);
      }
    });
    console.log('[接口演示] 多人英雄：已加「' + DEMO_TAG + '」（带可联机的冰环技能 demo_frost）');
  } catch (e) { console.warn('[接口演示] 多人英雄失败', e); }

  console.log('[接口演示] 四个接口演示完毕。本模组仅示范，未强制切换任何状态。');
})();
