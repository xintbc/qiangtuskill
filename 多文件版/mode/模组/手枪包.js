/* ============================================================================
 *  示例模组：手枪包（作者演示用）  【batch184d·#102/#105 + batch184e 重做】
 *  ----------------------------------------------------------------------------
 *  · 每把手枪自带握持(gripPos)/开镜(aimPos)/左手(lhPos) 姿势；
 *  · hold:'pistol' → 第一人称单手持枪（区别于步枪双手端枪）；
 *  · 红点镜标记 adsHide，开镜时自动隐藏、改用浮层红点，不再挡视野；
 *  · 左轮 reloadStyle:'cylinder' → 转轮侧翻+旋转上弹，区别于普通弹匣更换；
 *  · 模型重做为更精致的程序化几何（滑套圆头/枪管/扳机护圈/指槽握把/识别环）。
 * ========================================================================== */
(function () {
  'use strict';
  if (!window.ModLoader) { console.warn('[手枪包] ModLoader 未就绪，跳过注册'); return; }
  var ML = window.ModLoader;
  var THREE = window.THREE;

  // ---- 小工具 ----
  function box(w, h, d, mat, x, y, z, rx, ry, rz) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    if (x !== undefined) m.position.set(x, y, z);
    if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
    return m;
  }
  function cyl(rt, rb, len, mat, x, y, z, rx, ry, rz, seg) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg || 16), mat);
    if (x !== undefined) m.position.set(x, y, z);
    if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
    return m;
  }
  function hand(g, grip, ext) { if (typeof buildRightHand === 'function') buildRightHand(g, grip, ext); }
  // 低 Profile 红点：镜座常显；镜身/镜片标记 adsHide（开镜隐藏，由 #redDotFx 浮层显示红点）
  function redDot(g, color) {
    g.add(box(0.045, 0.020, 0.05, metalDark, 0, 0.074, -0.06));
    var tube = cyl(0.012, 0.012, 0.05, metalDark, 0, 0.096, -0.06, Math.PI / 2); tube.userData.adsHide = true; g.add(tube);
    var lens = new THREE.Mesh(new THREE.CircleGeometry(0.009, 14),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    lens.position.set(0, 0.096, -0.085); lens.userData.adsHide = true; g.add(lens);
  }
  function triggerGuard(g, mat, z) {
    var t = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 16, Math.PI * 1.4), mat);
    t.position.set(0, -0.045, z); t.rotation.z = Math.PI * 0.75; g.add(t);
  }
  function grip(g, mat, x, y, z, rot, grooves) {
    var gp = box(0.05, 0.13, 0.05, mat, x, y, z, rot, 0, 0); g.add(gp);
    for (var i = 0; i < (grooves || 3); i++) g.add(box(0.052, 0.012, 0.052, gripMat, x, y + 0.045 - i * 0.032, z + 0.004, rot, 0, 0));
  }

  // ---- 材质 ----
  var metal     = new THREE.MeshLambertMaterial({ color: 0x3a3d42, side: THREE.DoubleSide });
  var metalDark = new THREE.MeshLambertMaterial({ color: 0x16181c, side: THREE.DoubleSide });
  var slideMat  = new THREE.MeshLambertMaterial({ color: 0x4a4e55, side: THREE.DoubleSide });
  var gripMat   = new THREE.MeshLambertMaterial({ color: 0x141414, side: THREE.DoubleSide });
  var goldMat   = new THREE.MeshLambertMaterial({ color: 0xc9a227, side: THREE.DoubleSide });
  var woodMat   = new THREE.MeshLambertMaterial({ color: 0x5a3a1c, side: THREE.DoubleSide });
  function accent(c) { return new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }); }

  // 手枪通用底座：滑套(圆头) + 枪管 + 枪口 + 扳机护圈 + 握把(指槽) + 防滑纹 + 识别环
  function pistolBase(g, slideIn, gripIn, accentColor) {
    g.add(box(0.052, 0.05, 0.17, slideIn, 0, 0.005, -0.05));
    g.add(cyl(0.026, 0.026, 0.05, slideIn, 0, 0.005, -0.155, Math.PI / 2));   // 滑套圆头
    g.add(cyl(0.013, 0.015, 0.20, metalDark, 0, 0.0, -0.14, Math.PI / 2));     // 枪管
    g.add(cyl(0.016, 0.013, 0.03, metalDark, 0, 0.0, -0.25, Math.PI / 2));     // 枪口
    triggerGuard(g, metalDark, 0.02);
    grip(g, gripIn, 0, -0.085, 0.10, 0.32, 3);
    for (var i = 0; i < 5; i++) g.add(box(0.056, 0.012, 0.006, metalDark, 0, 0.02, -0.12 + i * 0.025)); // 防滑纹
    if (accentColor !== undefined) g.add(cyl(0.028, 0.028, 0.012, accent(accentColor), 0, 0.005, 0.018, Math.PI / 2));
  }
  // 第三人称简化模型（供 setThirdPersonWeapon 用；远端同步武器 id 后可显示对应手枪）
  function pistolTP(rig) {
    rig.add(box(0.05, 0.06, 0.18, slideMat, 0, 0, -0.05));
    rig.add(cyl(0.018, 0.020, 0.18, metalDark, 0, 0.01, -0.14, Math.PI / 2));
    rig.add(box(0.045, 0.12, 0.05, gripMat, 0, -0.09, 0.10, 0.32, 0, 0));
  }

  /* ---- 1) M9（9mm 紧凑手枪）：平衡·半自动·绿点 ---- */
  ML.addWeapon({
    name: 'M9手枪', melee: false, icon: '🔫', note: '平衡·半自动·9mm',
    damage: 1.4, magSize: 15, fireRate: 160, reloadTime: 1400, recoilMul: 0.8, range: 50, pellets: 1, spread: 0.006, auto: false, redDot: true,
    adsFov: 52, hold: 'pistol',
    gripPos: { x: 0.12, y: -0.24, z: -0.42 },
    aimPos:  { x: 0.0,   y: -0.105, z: -0.30 },
    lhPos:   { x: -0.03, y: -0.13, z: -0.04 },
    tpBuild: pistolTP,
    build: function (g) {
      pistolBase(g, slideMat, gripMat, 0x33cc55);
      redDot(g, 0x33cc55);
      hand(g, new THREE.Vector3(0.02, -0.07, 0.12), new THREE.Vector3(0.10, -0.10, 0.30));
    }
  });

  /* ---- 2) 沙漠之鹰（大威力半自动手枪）：高伤少弹·金色 ---- */
  ML.addWeapon({
    name: '沙漠之鹰', melee: false, icon: '🔫', note: '大威力·高伤·半自动',
    damage: 3.2, magSize: 7, fireRate: 360, reloadTime: 1800, recoilMul: 1.5, range: 70, pellets: 1, spread: 0.004, auto: false, redDot: true,
    adsFov: 48, hold: 'pistol',
    gripPos: { x: 0.13, y: -0.23, z: -0.45 },
    aimPos:  { x: -0.004, y: -0.095, z: -0.29 },
    lhPos:   { x: -0.02, y: -0.13, z: -0.03 },
    tpBuild: pistolTP,
    build: function (g) {
      // 更大滑套 + 三角顶（沙漠之鹰标志外形）
      g.add(box(0.07, 0.055, 0.20, goldMat, 0, 0.005, -0.06));
      g.add(box(0.05, 0.05, 0.10, goldMat, 0, 0.02, -0.14));           // 顶部加高块
      g.add(cyl(0.018, 0.020, 0.26, metalDark, 0, 0.006, -0.20, Math.PI / 2));
      g.add(cyl(0.024, 0.020, 0.05, metalDark, 0, 0.006, -0.35, Math.PI / 2));
      g.add(box(0.02, 0.016, 0.16, metalDark, 0, -0.04, -0.18));        // 下导轨
      triggerGuard(g, metalDark, 0.02);
      grip(g, gripMat, 0, -0.10, 0.12, 0.30, 4);
      for (var i = 0; i < 5; i++) g.add(box(0.074, 0.012, 0.006, metalDark, 0, 0.022, -0.14 + i * 0.03));
      redDot(g, 0xffcc00);
      hand(g, new THREE.Vector3(0.03, -0.08, 0.14), new THREE.Vector3(0.11, -0.12, 0.32));
    }
  });

  /* ---- 3) 左轮手枪（Revolver）：六发·超高伤·木握把·转轮换弹 ---- */
  ML.addWeapon({
    name: '左轮手枪', melee: false, icon: '🔫', note: '六发·超高伤·转轮换弹',
    damage: 4.0, magSize: 6, fireRate: 480, reloadTime: 2200, recoilMul: 1.7, range: 80, pellets: 1, spread: 0.003, auto: false, redDot: true,
    adsFov: 45, hold: 'pistol', reloadStyle: 'cylinder',
    gripPos: { x: 0.12, y: -0.23, z: -0.43 },
    aimPos:  { x: 0.010, y: -0.098, z: -0.31 },
    lhPos:   { x: -0.03, y: -0.13, z: -0.04 },
    tpBuild: pistolTP,
    build: function (g) {
      // 底把 + 顶部枪管（长）
      g.add(box(0.055, 0.055, 0.14, metal, 0, 0.0, -0.02));
      g.add(cyl(0.020, 0.022, 0.24, metalDark, 0, 0.006, -0.16, Math.PI / 2));
      g.add(box(0.03, 0.02, 0.20, metal, 0, 0.03, -0.10));             // 顶部枪管罩
      g.add(box(0.03, 0.03, 0.06, metalDark, 0, 0.06, 0.04));          // 击锤座
      g.add(box(0.018, 0.03, 0.025, metalDark, 0, 0.075, 0.05));        // 击锤
      // 转轮（放进 cylinderPivot：引擎换弹时侧翻+旋转）
      var cylPivot = new THREE.Group(); cylPivot.position.set(0, -0.012, 0.02);
      cylPivot.userData.cylinder = true; g.userData.cylinderPivot = cylPivot; g.add(cylPivot);
      cylPivot.add(cyl(0.044, 0.044, 0.052, metalDark, 0, 0, 0, Math.PI / 2));
      for (var c = 0; c < 6; c++) {
        var ang = c * Math.PI / 3;
        cylPivot.add(cyl(0.012, 0.012, 0.054, metalDark, Math.sin(ang) * 0.026, 0, Math.cos(ang) * 0.026, Math.PI / 2));
      }
      // 抛壳杆
      g.add(cyl(0.006, 0.006, 0.10, metalDark, 0.03, -0.012, 0.02, Math.PI / 2));
      // 木握把（两片）
      var gpL = box(0.028, 0.12, 0.05, woodMat, -0.018, -0.10, 0.11, 0, 0, 0.04); gpL.rotation.x = 0.34; g.add(gpL);
      var gpR = box(0.028, 0.12, 0.05, woodMat, 0.018, -0.10, 0.11, 0, 0, -0.04); gpR.rotation.x = 0.34; g.add(gpR);
      g.add(box(0.06, 0.02, 0.06, metalDark, 0, -0.04, 0.03));          // 扳机护圈底座
      redDot(g, 0xff5533);
      hand(g, new THREE.Vector3(0.03, -0.07, 0.12), new THREE.Vector3(0.10, -0.11, 0.30));
    }
  });

  console.log('[手枪包] 已注册 3 把手枪（M9 / 沙漠之鹰 / 左轮），单手持枪 + 红点不挡视野 + 左轮转轮换弹');
})();
