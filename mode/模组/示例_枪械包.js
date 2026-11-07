/* ============================================================================
 * 【模组信息】@id weapon_pack_demo　@name 示例枪械包　@ver 1.7.5　@api 2
 *  示例模组：枪械包（作者演示用）
 *  ----------------------------------------------------------------------------
 *  通过 ModLoader.addWeapon 注册 4 把「模型各不相同」的枪械，演示：
 *    · 每把枪都自带一个 build(group) 函数，在 group 上搭出**独一无二**的第一人称模型
 *      （绝不是调用 buildGunMeshes 复用同一个模型）
 *    · 每把枪除了 伤害(damage) / 弹容量(magSize) / 模型(build) 之外，
 *      还有一套**彼此不同**的数值：射速(fireRate) / 换弹(reloadTime) / 后坐(recoilMul) /
 *      射程(range) / 弹丸(pellets) / 散布(spread) / 射击模式(auto：全自动/半自动)，
 *      以及 magType(弹匣外形) / magPos(弹匣挂点) —— 引擎据此生成各枪**专属弹匣模型**，
 *      换弹时装上的/取下的都是这一把枪自己的弹匣，不再是步枪弹匣。
 *    · 开镜散布与准星完全由本文件里的武器 def 字段决定，**无需改动游戏主文件**：
 *        - type: 'shotgun'  → 注册为「散弹枪」：开镜仍保留 35% 散射（可用 adsSpreadKeep 微调，0.35=保留35%），
 *                            并自动使用「散布圆」专属准星——圆多大散射就多大。
 *        - type: 'normal'（或其它/留空）→ 普通枪：开镜后完全无散射；红点镜枪开镜显示中心红点。
 *        - 狙击枪 scope: true → 开镜显示镜框暗角准星，并自动隐藏枪身与手部；可用 adsFov 调开镜放大倍数（越小越放大，默认45，狙击枪示例18≈4倍）。
 *      想加新枪只改本文件、调这些字段即可，主文件一次都不用碰。
 *    · 游戏里按 B 弹出「武器选择」界面，点哪把就把它**替换**成当前手持枪
 *
 *  注意：本文件在引擎之后加载，THREE、buildRightHand、ModLoader 都已就绪。
 * ========================================================================== */
(function () {
  'use strict';
  var M = window.枪战模组;
  if (!M) { console.warn('[枪械包] 需要游戏 1.7.5 或更新版本（枪战模组接口未就绪），已跳过'); return; }
  var 模组 = M.定义({ id: 'weapon_pack_demo', name: '示例枪械包', ver: '1.7.5', author: '官方示例', desc: '四把不同手感/模型的枪（教学示例）' });
  if (!模组) return;

  // ---- 通用小工具：搭盒子 / 搭圆柱（圆柱默认轴是 y，转 90° 让轴沿 z = 朝向屏幕里）----
  function box(w, h, d, mat, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    if (x !== undefined) m.position.set(x, y, z);
    return m;
  }
  function cyl(rt, rb, len, mat, x, y, z, rx) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, 14), mat);
    if (rx) m.rotation.x = rx;
    if (x !== undefined) m.position.set(x, y, z);
    return m;
  }
  function hand(g, grip, ext) {
    if (typeof buildRightHand === 'function') buildRightHand(g, grip, ext);
  }
  // 给狙击镜相关网格打标记：开镜时引擎会隐藏它们并显示镜框暗角，避免实体镜筒挡视野
  function scope(m) { m.userData = m.userData || {}; m.userData.scope = true; return m; }
  // 给每把枪（除狙击枪外）加一个小红点瞄准镜：开镜时镜身隐藏（不挡视野），由 #redDotFx 浮层显示中心红点
  function sight(g, color, z) {
    var b = box(0.05, 0.03, 0.05, metalDark, 0, 0.07, z); b.userData.scope = true; g.add(b);
    var t = cyl(0.018, 0.018, 0.06, metalDark, 0, 0.10, z, Math.PI / 2); t.userData.scope = true; g.add(t);
    var lens = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    lens.position.set(0, 0.10, z - 0.031); lens.userData.scope = true; g.add(lens);
  }

  // ---- 材质（各自独立，不依赖引擎内部变量）----
  var metal      = new THREE.MeshLambertMaterial({ color: 0x2b2b2b, side: THREE.DoubleSide });
  var metalDark  = new THREE.MeshLambertMaterial({ color: 0x161616, side: THREE.DoubleSide });
  var wood       = new THREE.MeshLambertMaterial({ color: 0x6b3f1d, side: THREE.DoubleSide });
  var woodDark   = new THREE.MeshLambertMaterial({ color: 0x4a2a12, side: THREE.DoubleSide });
  var bandShot   = new THREE.MeshLambertMaterial({ color: 0xff7a1a, side: THREE.DoubleSide }); // 橙：霰弹枪
  var bandSMG    = new THREE.MeshLambertMaterial({ color: 0x33cc55, side: THREE.DoubleSide }); // 绿：冲锋枪
  var bandSnip   = new THREE.MeshLambertMaterial({ color: 0xcc2222, side: THREE.DoubleSide }); // 红：狙击枪
  var bandLMG    = new THREE.MeshLambertMaterial({ color: 0xffcc00, side: THREE.DoubleSide }); // 黄：重机枪

  var MAG_POS = { x: 0, y: -0.04, z: -0.02 };   // 各枪弹匣统一挂点（引擎据 magType 生成对应外形）

  /* ---------------- 1) 霰弹枪：双管 + 木托，近距离一片弹丸·半自动 ---------------- */
  模组.加武器({
    name: '霰弹枪', melee: false, icon: '🔫', note: '近距离·一片弹丸·半自动',
    damage: 0.45, magSize: 6, fireRate: 750, reloadTime: 2600, recoilMul: 1.4, range: 45, pellets: 8, spread: 0.022, auto: false, redDot: true, type: 'shotgun', adsSpreadKeep: 0.35, // 注册为「散弹枪」：开镜保留35%散射 + 专属散布圆准星（圆多大散射就多大）
    magType: 'shotgun', magPos: MAG_POS,
    build: function (g) {
      // 两根并排枪管
      g.add(cyl(0.022, 0.022, 0.46, metal, -0.03, 0.01, -0.28, Math.PI / 2));
      g.add(cyl(0.022, 0.022, 0.46, metal,  0.03, 0.01, -0.28, Math.PI / 2));
      // 枪口
      g.add(cyl(0.026, 0.022, 0.06, metalDark, -0.03, 0.01, -0.52, Math.PI / 2));
      g.add(cyl(0.026, 0.022, 0.06, metalDark,  0.03, 0.01, -0.52, Math.PI / 2));
      // 木机匣 + 泵式前握把 + 木枪托
      g.add(box(0.07, 0.07, 0.16, wood, 0, 0.01, 0.0));
      g.add(box(0.05, 0.05, 0.16, wood, 0, -0.04, -0.22));
      var stock = box(0.05, 0.07, 0.20, woodDark, 0, 0.0, 0.20); stock.rotation.x = 0.12; g.add(stock);
      // 橙色识别环
      g.add(cyl(0.031, 0.031, 0.02, bandShot, 0, 0.01, 0.06, Math.PI / 2));
      // 红点瞄准镜
      sight(g, 0xff7a1a, -0.02);
      hand(g, new THREE.Vector3(0.04, 0.0, 0.06), new THREE.Vector3(0.12, -0.02, 0.30));
    }
  });

  /* ---------------- 2) 冲锋枪：短小紧凑 + 香蕉弹匣，高射速低伤·全自动 ---------------- */
  模组.加武器({
    name: '冲锋枪', melee: false, icon: '🔫', note: '高射速·低伤·全自动',
    damage: 0.55, magSize: 40, fireRate: 60, reloadTime: 1500, recoilMul: 1.25, range: 70, pellets: 1, spread: 0.045, auto: true, redDot: true, type: 'normal', // 普通枪：开镜后完全无散射
    magType: 'smg', magPos: MAG_POS,
    build: function (g) {
      // 紧凑机匣 + 短枪管
      g.add(box(0.07, 0.08, 0.18, metal, 0, 0.0, -0.05));
      g.add(cyl(0.015, 0.018, 0.18, metalDark, 0, 0.0, -0.24, Math.PI / 2));
      // 垂直前握把 + 短枪托（不再画静态弹匣：弹匣由引擎按 magType='smg' 统一生成）
      g.add(cyl(0.012, 0.012, 0.06, metalDark, 0, -0.06, -0.18, Math.PI / 2));
      g.add(box(0.04, 0.05, 0.12, metal, 0, 0.0, 0.14));
      // 绿色识别环
      g.add(cyl(0.029, 0.029, 0.02, bandSMG, 0, 0.0, 0.02, Math.PI / 2));
      // 红点瞄准镜
      sight(g, 0x33cc55, -0.02);
      hand(g, new THREE.Vector3(0.03, -0.02, 0.06), new THREE.Vector3(0.10, -0.06, 0.26));
    }
  });

  /* ---------------- 3) 狙击枪：超长细管 + 大镜，超高伤少弹·半自动·带镜 ---------------- */
  模组.加武器({
    name: '狙击枪', melee: false, icon: '🎯', note: '超远·超高伤·半自动·开镜有镜',
    damage: 4.0, magSize: 5, fireRate: 1100, reloadTime: 3200, recoilMul: 2.6, range: 220, pellets: 1, spread: 0.0, auto: false, scope: true, adsFov: 18, // 狙击枪：开镜 FOV=18（≈4倍放大，比默认45明显更大）；开镜自动隐藏枪身与手部
    magType: 'sniper', magPos: MAG_POS,
    build: function (g) {
      // 超长细枪管 + 细长机匣
      g.add(cyl(0.012, 0.014, 0.95, metal, 0, 0.01, -0.50, Math.PI / 2));
      g.add(box(0.05, 0.06, 0.42, metalDark, 0, 0.01, -0.08));
      // 大瞄准镜（红环）+ 镜架（镜身打 scope 标记，开镜时隐藏避免挡视野；镜框暗角中央有准星）
      g.add(scope(cyl(0.035, 0.035, 0.22, metal, 0, 0.10, -0.10, Math.PI / 2)));
      g.add(scope(cyl(0.038, 0.038, 0.02, bandSnip, 0, 0.10, -0.20, Math.PI / 2)));
      g.add(scope(box(0.02, 0.05, 0.03, metalDark, 0, 0.06, -0.10)));
      g.add(scope(box(0.02, 0.05, 0.03, metalDark, 0, 0.06, 0.0)));
      // 长枪托 + 两脚架
      var st = box(0.05, 0.07, 0.34, woodDark, 0, 0.0, 0.30); st.rotation.x = 0.05; g.add(st);
      g.add(cyl(0.008, 0.008, 0.18, metalDark, -0.02, -0.08, -0.42, 0.5));
      g.add(cyl(0.008, 0.008, 0.18, metalDark, 0.02, -0.08, -0.42, -0.5));
      hand(g, new THREE.Vector3(0.03, -0.02, 0.06), new THREE.Vector3(0.10, -0.06, 0.26));
    }
  });

  /* ---------------- 4) 重机枪：方正机匣 + 大弹箱，中伤巨弹容·全自动 ---------------- */
  模组.加武器({
    name: '重机枪', melee: false, icon: '🔫', note: '中伤·海量子弹·全自动',
    damage: 0.9, magSize: 100, fireRate: 80, reloadTime: 5000, recoilMul: 2.0, range: 90, pellets: 1, spread: 0.06, auto: true, redDot: true, type: 'normal', // 普通枪：开镜后完全无散射
    magType: 'lmg', magPos: MAG_POS,
    build: function (g) {
      // 方正粗大机匣 + 粗枪管 + 散热环
      g.add(box(0.10, 0.11, 0.30, metal, 0, 0.0, -0.04));
      g.add(cyl(0.028, 0.030, 0.50, metalDark, 0, 0.02, -0.34, Math.PI / 2));
      g.add(cyl(0.034, 0.034, 0.03, metal, 0, 0.02, -0.20, Math.PI / 2));
      g.add(cyl(0.034, 0.034, 0.03, metal, 0, 0.02, -0.30, Math.PI / 2));
      // 侧挂大弹箱（额外特征，不与底部弹匣冲突）+ 短粗枪托
      g.add(box(0.10, 0.14, 0.08, metalDark, 0.12, -0.10, -0.02));
      g.add(box(0.06, 0.08, 0.16, metalDark, 0, 0.0, 0.16));
      // 黄色识别环 + 两脚架
      g.add(cyl(0.041, 0.041, 0.02, bandLMG, 0, 0.0, 0.06, Math.PI / 2));
      g.add(cyl(0.010, 0.010, 0.20, metalDark, -0.04, -0.10, -0.40, 0.6));
      g.add(cyl(0.010, 0.010, 0.20, metalDark, 0.04, -0.10, -0.40, -0.6));
      // 红点瞄准镜
      sight(g, 0xffcc00, -0.02);
      hand(g, new THREE.Vector3(0.05, -0.02, 0.08), new THREE.Vector3(0.14, -0.06, 0.30));
    }
  });

  console.log('[枪械包] 已注册 4 把枪械：霰弹枪(半自动·8弹丸) / 冲锋枪(全自动) / 狙击枪(半自动·带镜) / 重机枪(全自动) —— 各有专属弹匣模型 + 瞄准镜，射速/换弹/后坐/射程/弹丸/散布/射击模式 各不相同');
})();
