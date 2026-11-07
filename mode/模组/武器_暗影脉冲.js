/* ============================================================================
 *  模组：武器「暗影脉冲」（暗月科技 · 能量步枪）
 * 【模组信息】@id weapon_shadow_pulse　@name 暗影脉冲　@ver 1.7.5　@api 2
 *  ----------------------------------------------------------------------------
 *  按《模组开发教程.md》第 6 章 addWeapon 写法做的一把全新枪：
 *    · 暗月阵营科技风：深紫黑机匣 + 紫色能量条 + 发光能量核心
 *    · 全自动 · 中高伤 · 弹匣 32 发 · 换弹快 · 后坐适中（好压枪）
 *    · 红点瞄准镜（开镜隐藏镜身、屏幕中心显示红点，不挡视野）
 *    · 专属弹匣（magType:'rifle'）由引擎生成，换弹卸下/装上都是自己的弹匣
 *  游戏里按 B 打开「武器选择」，点卡片即替换成当前手持枪。
 * ========================================================================== */
(function () {
  'use strict';
  var M = window.枪战模组;
  if (!M) { console.warn('[暗影脉冲] 需要游戏 1.7.5 或更新版本（枪战模组接口未就绪），已跳过'); return; }
  var 模组 = M.定义({ id: 'weapon_shadow_pulse', name: '暗影脉冲', ver: '1.7.5', author: '官方示例', desc: '暗月科技 · 全自动能量步枪' });
  if (!模组) return;

  // ---- 通用小工具：搭盒子 / 搭圆柱 ----
  function box(w, h, d, mat, x, y, z, rx, ry, rz) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    if (x !== undefined) m.position.set(x, y, z);
    if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
    return m;
  }
  function cyl(rt, rb, len, mat, x, y, z, rx) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, 14), mat);
    if (x !== undefined) m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    return m;
  }
  function hand(g, grip, ext) { if (typeof buildRightHand === 'function') buildRightHand(g, grip, ext); }
  // 红点瞄准镜：镜身标记 userData.scope → 开镜时引擎自动隐藏，屏幕中心显示红点
  function redDot(g, color) {
    var b = box(0.05, 0.03, 0.05, metalDark, 0, 0.07, -0.02); b.userData.scope = true; g.add(b);
    var t = cyl(0.018, 0.018, 0.06, metalDark, 0, 0.10, -0.02, Math.PI / 2); t.userData.scope = true; g.add(t);
    var lens = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    lens.position.set(0, 0.10, -0.051); lens.userData.scope = true; g.add(lens);
  }

  // ---- 材质（暗月主题：深紫黑 + 亮紫能量） ----
  var metal     = new THREE.MeshLambertMaterial({ color: 0x241733, side: THREE.DoubleSide });  // 暗紫黑机匣
  var metalDark = new THREE.MeshLambertMaterial({ color: 0x120b1a, side: THREE.DoubleSide });  // 近黑部件
  var glow      = new THREE.MeshBasicMaterial({ color: 0xaa55ff, side: THREE.DoubleSide });    // 紫色能量条（自发光）
  var glowC     = new THREE.MeshBasicMaterial({ color: 0xcc88ff, side: THREE.DoubleSide });    // 能量核心（更亮）

  /* ---------------- 暗影脉冲 · 能量步枪 ---------------- */
  模组.加武器({
    name: '暗影脉冲', melee: false, icon: '🔫', note: '暗月科技 · 能量脉冲 · 全自动',
    damage: 1.3, magSize: 32, fireRate: 90, reloadTime: 1800, recoilMul: 1.05,
    range: 95, pellets: 1, spread: 0.028, auto: true, redDot: true, type: 'normal',
    magType: 'rifle', magPos: { x: 0, y: -0.04, z: -0.02 },
    build: function (g) {
      // 机匣（斜切科幻造型：两块组合）+ 顶部导轨
      g.add(box(0.07, 0.09, 0.34, metal, 0, 0.005, -0.04));
      g.add(box(0.05, 0.05, 0.30, metalDark, 0, 0.045, -0.05));
      // 枪管 + 枪口（细长，暗月风）
      g.add(cyl(0.016, 0.020, 0.46, metalDark, 0, 0.0, -0.30, Math.PI / 2));
      g.add(cyl(0.022, 0.016, 0.06, metalDark, 0, 0.0, -0.55, Math.PI / 2));
      // 能量核心（枪身中段发光球，暗影主题点睛）
      var core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), glowC);
      core.position.set(0, 0.02, -0.02); g.add(core);
      // 紫色能量条（枪身两侧发光条带）
      g.add(box(0.012, 0.02, 0.24, glow, 0.045, 0.005, -0.05));
      g.add(box(0.012, 0.02, 0.24, glow, -0.045, 0.005, -0.05));
      // 护木 + 前握把 + 枪托
      g.add(box(0.05, 0.05, 0.14, metalDark, 0, -0.02, -0.20));
      g.add(cyl(0.011, 0.011, 0.06, metalDark, 0, -0.06, -0.18, Math.PI / 2));
      var st = box(0.05, 0.07, 0.16, metalDark, 0, 0.005, 0.22); st.rotation.x = 0.08; g.add(st);
      // 红点瞄准镜
      redDot(g, 0xaa55ff);
      hand(g, new THREE.Vector3(0.04, 0.0, 0.06), new THREE.Vector3(0.12, -0.02, 0.30));
    }
  });

  console.log('[暗影脉冲] 已注册「暗影脉冲」能量步枪：全自动 · 32发 · 红点镜 · 暗月紫黑配色');
})();
