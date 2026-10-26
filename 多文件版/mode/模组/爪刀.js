/* ============================================================================
 * 【模组信息】@id knife_claw　@name 爪刀　@ver 1.7.5　@api 2
 *  示例模组：爪刀（作者演示用）  【batch184d·#103/#104/#106 + batch184e 模型重做】
 *  ----------------------------------------------------------------------------
 *  · ModLoader.addKnife 注册一把新刀（进 B 菜单近战区，可单独选中切换）
 *  · 刀 def 的 gripPos / lhPos 字段 —— 自定义握持姿势（区别于内置战术刀）
 *  · 刀 def 的 swing(elapsed,total) 钩子 —— 完全独立的「横扫」动作（区别于直刺）
 *  · 模型重做：指环握把 + 弯爪（沿弧线渐细的弯刀，带刃口高光），不再是方盒子拼的丑爪
 * ========================================================================== */
(function () {
  'use strict';
  var M = window.枪战模组;
  if (!M) { console.warn('[爪刀] 需要游戏 1.7.5 或更新版本（枪战模组接口未就绪），已跳过'); return; }
  var 模组 = M.定义({ id: 'knife_claw', name: '爪刀', ver: '1.7.5', author: '官方示例', desc: '弯爪 · 横扫动作 + 自定义握持' });
  if (!模组) return;
  var THREE = window.THREE;

  function box(w, h, d, mat, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    if (x !== undefined) m.position.set(x, y, z);
    return m;
  }
  function cyl_(rt, rb, len, mat, x, y, z, rx) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, 14), mat);
    if (x !== undefined) m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    return m;
  }

  var steelMat = new THREE.MeshLambertMaterial({ color: 0xc4c9d2, side: THREE.DoubleSide, metalness: 0.6 });
  var darkMat  = new THREE.MeshLambertMaterial({ color: 0x1b1d22, side: THREE.DoubleSide });
  var edgeMat  = new THREE.MeshBasicMaterial({ color: 0xeaf2ff, side: THREE.DoubleSide });

  // 沿一条“向前下方弯”的弧线生成渐细的爪身（karambi 风格），并贴一条刃口高光
  function clawBlade(g) {
    var N = 9;
    for (var i = 0; i < N; i++) {
      var f = i / (N - 1);
      var z = 0.02 - 0.30 * f;                                   // 前伸
      var y = -0.02 - 0.18 * Math.sin(f * Math.PI * 0.62);        // 明显下弯
      var w = 0.026 * (1 - 0.7 * f);                             // 宽渐细
      var hgt = 0.030 * (1 - 0.55 * f);                          // 厚渐细
      var seg = box(w, hgt, 0.055, steelMat, 0, y, z);
      if (i > 0) seg.lookAt(new THREE.Vector3(0, y, z - 0.05));
      else seg.rotation.x = 0.3;
      g.add(seg);
      var e = box(w * 1.05, 0.006, 0.055, edgeMat, 0, y + hgt * 0.5, z);   // 刃口高光
      if (i > 0) e.lookAt(new THREE.Vector3(0, y + hgt * 0.5, z - 0.05));
      g.add(e);
    }
    var tip = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.07, 10), steelMat);  // 爪尖
    tip.position.set(0, -0.205, -0.30); tip.rotation.x = -Math.PI / 2 - 0.5; g.add(tip);
  }

  // 横扫动作：蓄力 → 向左横扫 → 顿住 → 回收翻腕（区别于内置战术刀的直刺）
  function clawSwing(o) {
    var e = o.elapsed, total = o.total || 420;
    var rx = 0, ry = 0, rz = 0, armZ = 0, armY = 0;
    var P1 = total * 0.22, P2 = total * 0.55, P3 = total * 0.78;
    if (e < P1) { var t = e / P1, k = t * t * (3 - 2 * t); rx = 0.5 * k; ry = -0.5 * k; rz = 0.2 * k; armZ = 0.05 * k; armY = 0.05 * k; }
    else if (e < P2) { var t2 = (e - P1) / (P2 - P1), k2 = t2 * t2; rx = 0.5 - 0.2 * k2; ry = -0.5 + 1.7 * k2; rz = 0.2 + 0.9 * k2; armZ = 0.05 - 0.10 * k2; armY = 0.05 - 0.02 * k2; }
    else if (e < P3) { rx = 0.3; ry = 1.2; rz = 1.1; armZ = -0.05; armY = 0.03; }
    else { var t4 = (e - P3) / (total - P3), k4 = t4 * (2 - t4); rx = 0.3 * (1 - k4); ry = 1.2 * (1 - k4); rz = 1.1 * (1 - k4); armZ = -0.05 * (1 - k4); armY = 0.03 * (1 - k4); }
    return { rx: rx, ry: ry, rz: rz, armZ: armZ, armY: armY };
  }

  // 第三人称简化弯爪（远端同步 wk 后显示）
  function clawTP(rig) {
    rig.add(cyl_(0.03, 0.03, 0.10, darkMat, 0, 0, 0.07, Math.PI / 2));
    rig.add(box(0.075, 0.018, 0.02, steelMat, 0, 0, 0.0));
    for (var i = 0; i < 6; i++) {
      var f = i / 5, z = 0.02 - 0.22 * f, y = -0.02 - 0.14 * Math.sin(f * Math.PI * 0.6);
      var seg = box(0.022 * (1 - 0.6 * f), 0.026 * (1 - 0.5 * f), 0.05, steelMat, 0, y, z);
      if (i > 0) seg.lookAt(new THREE.Vector3(0, y, z - 0.04)); else seg.rotation.x = 0.3;
      rig.add(seg);
    }
  }

  模组.加刀({
    id: 'claw',
    name: '爪刀',
    icon: '🗡️',
    damage: 95,
    range: 3.0,
    cooldown: 360,
    gripPos: { x: 0.20, y: -0.20, z: -0.42 },
    lhPos:   { x: -0.18, y: -0.24, z: -0.30, rx: 0.5, ry: 0.8, rz: 0.3 },
    swingDur: 420,
    swing: clawSwing,
    tpBuild: clawTP,
    build: function (g) {
      // 指环握把（karambit 标志：尾指环）
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.011, 10, 20), darkMat);
      ring.position.set(0, 0, 0.11); ring.rotation.y = Math.PI / 2; g.add(ring);
      // 缠绳握柄（暗色 + 几道环纹）
      g.add(cyl_(0.03, 0.03, 0.10, darkMat, 0, 0, 0.07, Math.PI / 2));
      for (var r = 0; r < 4; r++) g.add(cyl_(0.032, 0.032, 0.008, steelMat, 0, 0, 0.045 + r * 0.022, Math.PI / 2));
      // 护手盘
      g.add(box(0.075, 0.018, 0.02, steelMat, 0, 0, 0.0));
      // 弯爪
      clawBlade(g);
    }
  });

  console.log('[爪刀] 已注册「爪刀」：弯爪模型 + 独立横扫动作，区别于内置战术刀的直刺');
})();
