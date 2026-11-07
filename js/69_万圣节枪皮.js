/* 【batch273】万圣节限定枪皮「南瓜鬼宴」（js/69_万圣节枪皮.js）=============================
   用户口径（原话拆解）：
     · 万圣节主题枪皮，枪上有**南瓜灯**元素，还有**鬼魂**元素；
     · 不像「长明」那样在枪上出现文字（所以整把枪**没有任何铭牌/文字贴图**）；
     · 瞄准镜就是**一个被掏空了的南瓜**；
     · 弹夹里的子弹换成**糖果**；
     · 抛壳抛出来的是**糖果纸**；
     · 伤害 **×1.5**、弹夹 **32 发**、售价 **250** 枪皮币；
     · 击杀动画 4 秒：尸体不立刻消失 → 鬼魂窜出 → 给尸体戴上南瓜头 → 抓进裂缝 → 裂缝喷糖果；
     · 击杀数显示上要有鬼魂 / 糖果 / 南瓜元素。

   实现分工：
     · 本分片注册 `BUILTIN_GUNS[-2]`（槽位 -2，避开 -1 长明 与模组枪 2+），自带 build 模型；
     · 第一人称模型 = 第三人称模型（js/20 的 _TP复制第一人称 会直接复制 def.build），
       所以别人看你手里的枪也长这样，不用再写第二套；
     · 抛壳：js/24 的 抛壳() 开头问 `万圣_抛糖纸()`，是这把枪就改抛糖纸；
     · 击杀：js/21 的 killEnemy() 调 `万圣_击杀(e)`，返回 true 表示"尸体我接手了，别 remove"；
     · 击杀计数卡：本分片自己一块 #hwKill 的 DOM（南瓜+鬼魂+糖果），不碰长明的 #memKill。
   ⚠️ 本分片排在最后（js/69），所有跨分片调用一律 typeof 守卫。 */

var HALLOWEEN_SLOT = -2;
var 万圣枪皮键 = 'gunGame.hwSkin.v1';        /* 是否已购买（纯本地） */
var 万圣枪皮名 = '南瓜鬼宴';

/* ==================== 一、解锁 / 购买 ==================== */
function 万圣已解锁() {
  try { return localStorage.getItem(万圣枪皮键) === '1'; } catch (e) { return false; }
}
function 万圣解锁(静默) {
  try { localStorage.setItem(万圣枪皮键, '1'); } catch (e) { }
  万圣刷新锁();
  try { if (!静默 && typeof showMsg === 'function') showMsg('🎃 「南瓜鬼宴」已解锁 · 按 B 换枪', '#ffa63d'); } catch (e) { }
  return true;
}
function 万圣刷新锁() {
  var d = BUILTIN_GUNS[HALLOWEEN_SLOT]; if (!d) return;
  var 有 = 万圣已解锁();
  d.锁 = !有;
  d.锁提示 = 有 ? '' : '未购买 · 去主菜单「枪械购买」用 250 枪皮币解锁';
}
/* 地址栏后门：?pumpkin=1 直接解锁并装备（作者自测用，和长明的 ?memorial=1 同一套习惯） */
(function () {
  try {
    var 串 = String(location.search || '') + '&' + String(location.hash || '');
    if (/pumpkin=1|南瓜=1/.test(串)) {
      万圣解锁(true);
      setTimeout(function () { try { if (typeof setCurrentGun === 'function') setCurrentGun(HALLOWEEN_SLOT); } catch (e) { } }, 800);
    }
  } catch (e) { }
})();

/* 手持的是不是这把枪 */
function 万圣在用() {
  try {
    if (typeof activeGunDef !== 'function') return false;
    var d = activeGunDef();
    return !!(d && d.halloween);
  } catch (e) { return false; }
}

/* ==================== 二、模型：南瓜灯 + 鬼魂 ====================
   坐标约定和「长明」完全一致：原点在机匣中心，-z 是枪口，+z 是枪托，y 向上。
   全枪**没有任何文字/铭牌**（用户明确要求），识别度靠三样东西：
     ① 万圣节配色：暗紫枪身 + 南瓜橙饰件 + 骨白鬼魂；
     ② 瞄准镜＝**掏空的南瓜**：扁球南瓜（带刻脸贴图）+ 贯穿的镜孔 + 两端橙圈 + 顶部瓜蒂；
     ③ 护木下挂一只半透明小鬼（会随枪晃），枪托上贴两颗糖。 */
function _万圣南瓜贴图() {
  /* 一张 512×256 的南瓜皮：橙底 + 竖向瓜棱 + 正反两面各刻一张脸。
     ⚠️ 球面 UV 的 u 是绕一圈，所以 0.25 与 0.75 两处各画一张脸 → 左右都看得见。 */
  if (window.__万圣南瓜tex) return window.__万圣南瓜tex;
  var c = document.createElement('canvas'); c.width = 512; c.height = 256;
  var x = c.getContext('2d');
  var g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#ffb043'); g.addColorStop(0.55, '#ef8a1c'); g.addColorStop(1, '#c96a12');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  /* 瓜棱：一圈深浅竖条（比几何凸起更省面数，远看一样） */
  for (var i = 0; i < 24; i++) {
    var bx = i * (512 / 24);
    x.fillStyle = (i % 2) ? 'rgba(120,58,6,.16)' : 'rgba(255,210,140,.10)';
    x.fillRect(bx, 0, 512 / 24 * 0.55, 256);
  }
  /* 刻脸：三角眼 + 三角鼻 + 锯齿嘴（挖空感 = 近黑色 + 一点内壁暖光边） */
  function 脸(cx) {
    /* 先把画布坐标系压扁到"中间一条"，画完再恢复 —— 这样脸不会被拉长 */
    x.save(); x.translate(0, 64); x.scale(0.52, 1); x.translate(0, -64);
    x.fillStyle = '#2a1004';
    x.beginPath(); x.moveTo(cx - 54, 96); x.lineTo(cx - 16, 96); x.lineTo(cx - 35, 58); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(cx + 54, 96); x.lineTo(cx + 16, 96); x.lineTo(cx + 35, 58); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(cx, 118); x.lineTo(cx - 13, 142); x.lineTo(cx + 13, 142); x.closePath(); x.fill();
    x.beginPath();
    x.moveTo(cx - 62, 168); x.lineTo(cx - 34, 152); x.lineTo(cx - 12, 172); x.lineTo(cx + 10, 152);
    x.lineTo(cx + 34, 172); x.lineTo(cx + 62, 154); x.lineTo(cx + 50, 196); x.lineTo(cx - 50, 196);
    x.closePath(); x.fill();
    /* 挖口内壁的一点暖光（让"掏空"有厚度感） */
    x.strokeStyle = 'rgba(255,220,150,.30)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(cx - 54, 98); x.lineTo(cx - 35, 60); x.stroke();
    x.beginPath(); x.moveTo(cx + 54, 98); x.lineTo(cx + 35, 60); x.stroke();
    x.restore();
  }
  /* 刻脸只画一张、而且只占中间一条（u 0.44~0.56、v 0.30~0.72）：
     画满一圈 / 画太大，在瓜身轮廓处会被 UV 拉成黑三角挂在边缘，很难看。
     这张脸朝向枪的左侧 —— 也就是第一人称看得见的那一面。 */
  脸(256);
  var t = new THREE.CanvasTexture(c);
  try { t.anisotropy = 4; } catch (e) { }
  window.__万圣南瓜tex = t;
  return t;
}
function _万圣刻脸贴图() {
  /* 透明底的"刻脸"：两个三角眼 + 锯齿嘴，贴在瓜身两侧（±X）当真正的雕刻。
     为什么要单独一张：回转体（Lathe）的 UV 是"绕一圈 + 沿母线"，
     把脸画在瓜皮贴图里会被拉得又细又长，第一人称几乎看不出来。 */
  if (window.__万圣脸tex) return window.__万圣脸tex;
  var c = document.createElement('canvas'); c.width = c.height = 128;
  var x = c.getContext('2d');
  x.clearRect(0, 0, 128, 128);
  x.fillStyle = 'rgba(18,6,2,.94)';
  x.beginPath(); x.moveTo(16, 44); x.lineTo(52, 44); x.lineTo(34, 14); x.closePath(); x.fill();     // 左眼
  x.beginPath(); x.moveTo(112, 44); x.lineTo(76, 44); x.lineTo(94, 14); x.closePath(); x.fill();   // 右眼
  x.beginPath(); x.moveTo(64, 56); x.lineTo(54, 78); x.lineTo(74, 78); x.closePath(); x.fill();    // 鼻
  x.beginPath();                                                                                    // 嘴（锯齿）
  x.moveTo(18, 96); x.lineTo(38, 84); x.lineTo(52, 100); x.lineTo(64, 84);
  x.lineTo(76, 100); x.lineTo(90, 84); x.lineTo(110, 96); x.lineTo(104, 118); x.lineTo(24, 118);
  x.closePath(); x.fill();
  var t = new THREE.CanvasTexture(c);
  try { t.anisotropy = 4; } catch (e) { }
  window.__万圣脸tex = t;
  return t;
}
function _万圣糖纸贴图() {
  /* 糖果条纹：斜条双色，缠在圆柱上就是"糖纸" */
  if (window.__万圣糖tex) return window.__万圣糖tex;
  var c = document.createElement('canvas'); c.width = 64; c.height = 64;
  var x = c.getContext('2d');
  x.fillStyle = '#ff8a1f'; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = '#7b2d8e'; x.lineWidth = 9;
  for (var i = -64; i < 128; i += 22) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); }
  var t = new THREE.CanvasTexture(c);
  try { t.anisotropy = 4; } catch (e) { }
  window.__万圣糖tex = t;
  return t;
}
function _建南瓜枪(g) {
  /* 【batch274】按用户口径重做成**冲锋枪**：短机匣 + 短枪管 + 折叠托 + 竖直弹匣。
     全长 0.62 米（步枪版是 0.84），握把到枪口只有 0.33 —— 一眼就是紧凑型的枪。 */
  var 紫     = new THREE.MeshLambertMaterial({ color: 0x2b1f3d, side: THREE.DoubleSide });  // 枪身主色（暗紫）
  var 紫深   = new THREE.MeshLambertMaterial({ color: 0x1a1327, side: THREE.DoubleSide });  // 暗件
  var 橙     = new THREE.MeshLambertMaterial({ color: 0xe07a1f, side: THREE.DoubleSide });  // 南瓜橙饰件
  var 橙亮   = new THREE.MeshBasicMaterial({ color: 0xffb45c, side: THREE.DoubleSide });    // 亮橙（描边/圈）
  var 钢     = new THREE.MeshLambertMaterial({ color: 0x8f96a3, side: THREE.DoubleSide });
  var 胶     = new THREE.MeshLambertMaterial({ color: 0x141019, side: THREE.DoubleSide });
  var 鬼材   = new THREE.MeshLambertMaterial({ color: 0xe9e6f5, side: THREE.DoubleSide, transparent: true, opacity: 0.72 });
  var 鬼眼   = new THREE.MeshBasicMaterial({ color: 0x2a1b3d });

  function bx(w, h, d, m, x, y, z, rx, ry, rz) {
    var o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x || 0, y || 0, z || 0);
    if (rx) o.rotation.x = rx; if (ry) o.rotation.y = ry; if (rz) o.rotation.z = rz;
    g.add(o); return o;
  }
  function cy(rt, rb, len, m, x, y, z, rx, seg) {
    var o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg || 16), m);
    o.position.set(x || 0, y || 0, z || 0); if (rx) o.rotation.x = rx; g.add(o); return o;
  }

  /* ---------- 机匣（短粗） ---------- */
  bx(0.062, 0.054, 0.235, 紫, 0, 0.020, -0.006);                 // 上机匣
  bx(0.006, 0.046, 0.185, 紫, -0.025, -0.028, -0.012);           // 下机匣·左板
  bx(0.006, 0.046, 0.185, 紫, 0.025, -0.028, -0.012);            // 下机匣·右板
  bx(0.056, 0.046, 0.022, 紫, 0, -0.028, -0.100);                // 下机匣·前段
  bx(0.056, 0.046, 0.078, 紫, 0, -0.028, 0.058);                 // 下机匣·后段（含扳机组）
  bx(0.056, 0.012, 0.185, 紫, 0, -0.0105, -0.012);               // 喂弹口上盖
  bx(0.060, 0.010, 0.235, 紫深, 0, -0.004, -0.006);              // 机匣分界线
  /* 橙色饰条：机身两侧各一道（本枪的识别色，全程不放任何文字） */
  bx(0.004, 0.011, 0.20, 橙, -0.0322, 0.024, -0.008);
  bx(0.004, 0.011, 0.20, 橙, 0.0322, 0.024, -0.008);

  /* ---------- 抛壳窗（真凹槽） ---------- */
  (function () {
    var 窗Y = 0.024, 窗Z = 0.026, 窗L = 0.062, 窗H = 0.024;
    bx(0.005, 0.004, 窗L + 0.010, 紫深, 0.0325, 窗Y + 窗H / 2 + 0.002, 窗Z);
    bx(0.005, 0.004, 窗L + 0.010, 紫深, 0.0325, 窗Y - 窗H / 2 - 0.002, 窗Z);
    bx(0.005, 窗H + 0.008, 0.004, 紫深, 0.0325, 窗Y, 窗Z + 窗L / 2 + 0.002);
    bx(0.005, 窗H + 0.008, 0.004, 紫深, 0.0325, 窗Y, 窗Z - 窗L / 2 - 0.002);
    var 腔 = new THREE.Mesh(new THREE.BoxGeometry(0.020, 窗H, 窗L),
      new THREE.MeshLambertMaterial({ color: 0x090610, side: THREE.BackSide }));
    腔.position.set(0.0262, 窗Y, 窗Z); g.add(腔);
    var 框 = bx(0.012, 窗H - 0.008, 0.034, 钢, 0.0282, 窗Y, 窗Z - 0.008);
    框.userData.animPart = 'bolt';
    框.userData.原位Z = 框.position.z;
  })();

  /* ---------- 导轨（短） + 护木 + 短枪管 ---------- */
  bx(0.028, 0.010, 0.235, 紫深, 0, 0.050, -0.010);               // 皮卡汀尼导轨
  for (var t = 0; t < 6; t++) bx(0.032, 0.006, 0.009, 紫深, 0, 0.0545, -0.100 + t * 0.038);
  bx(0.048, 0.042, 0.108, 紫, 0, 0.010, -0.168);                 // 护木（冲锋枪的短护木）
  bx(0.052, 0.009, 0.108, 橙, 0, 0.0325, -0.168);                // 护木橙条
  for (var v = 0; v < 2; v++) {                                   // 侧面散热槽
    bx(0.002, 0.011, 0.018, 紫深, 0.0252, 0.010, -0.146 - v * 0.040);
    bx(0.002, 0.011, 0.018, 紫深, -0.0252, 0.010, -0.146 - v * 0.040);
  }
  cy(0.0100, 0.0100, 0.135, 钢, 0, 0.018, -0.252, Math.PI / 2, 14);    // 枪管（短）
  cy(0.0160, 0.0140, 0.042, 紫深, 0, 0.018, -0.320, Math.PI / 2, 14);  // 消焰器外壳
  cy(0.0110, 0.0110, 0.050, 钢, 0, 0.018, -0.322, Math.PI / 2, 12);    // 枪口内管
  var 口环 = new THREE.Mesh(new THREE.TorusGeometry(0.0160, 0.0045, 6, 18), 橙);
  口环.position.set(0, 0.018, -0.342); g.add(口环);

  /* ---------- 折叠托（两根细杆 + 托板） ---------- */
  bx(0.009, 0.009, 0.150, 紫深, -0.017, 0.012, 0.150);
  bx(0.009, 0.009, 0.150, 紫深, 0.017, 0.012, 0.150);
  bx(0.042, 0.052, 0.014, 紫深, 0, 0.006, 0.226);                // 托板
  bx(0.036, 0.009, 0.030, 橙, 0, 0.034, 0.210);                  // 托背橙条

  /* ---------- 握把 / 扳机 ----------
     ⚠️ 握把后倾角必须写 **负值**：rotation.x 为负，box 的下端才朝枪托（+z）方向倒；
        写成正值是"下端朝枪口"，看着就是握把装反了（用户报过）。
     尺寸也放大了：0.036×0.115×0.052（原来 0.032×0.092×0.044 太细）。 */
  bx(0.036, 0.115, 0.052, 胶, 0, -0.080, 0.052, -0.34);          // 握把（后倾，下端朝后）
  bx(0.028, 0.011, 0.062, 紫深, 0, -0.044, -0.004);              // 扳机护圈·上
  bx(0.028, 0.011, 0.014, 紫深, 0, -0.062, -0.034);              // 扳机护圈·前
  bx(0.011, 0.024, 0.009, 钢, 0, -0.046, 0.002);                 // 扳机

  /* ---------- 瞄准镜：掏空的南瓜（扁圆回转体，两端都是孔） ---------- */
  (function () {
    var 轴Y = 0.0940, 轴Z = -0.040;
    /* ⚠️ 这里踩过一个坑：一开始用"球 + 贯穿圆管"，球壳本身还是闭合的 ——
       开镜时正前方那一片球面正好糊在镜孔上（看着就是一个大南瓜堵死视野）。
       现在改用 **LatheGeometry 回转体**：母线两端半径不是 0，而是镜孔半径，
       绕轴转一圈就是一个"两端都是洞"的南瓜壳，中间是真通的。 */
    var 孔R = 0.0175, 外R = 0.0360, 半长 = 0.0310;   /* 扁圆：长度≈0.86 倍直径，看着才像南瓜不像圆筒 */
    var 轮廓 = [];
    /* 母线带一点"腰"：两端 0.86R、中间 1.0R —— 别做成直筒，直筒看着像齿轮 */
    var 采样 = [
      [孔R, -半长], [外R * 0.86, -半长 * 0.86], [外R * 0.96, -半长 * 0.42],
      [外R, 0], [外R * 0.96, 半长 * 0.42], [外R * 0.86, 半长 * 0.86], [孔R, 半长]
    ];
    for (var pi = 0; pi < 采样.length; pi++) 轮廓.push(new THREE.Vector2(采样[pi][0], 采样[pi][1]));
    var 壳 = new THREE.Mesh(new THREE.LatheGeometry(轮廓, 26),
      new THREE.MeshLambertMaterial({ map: _万圣南瓜贴图(), side: THREE.FrontSide }));
    壳.rotation.x = Math.PI / 2;          /* 回转轴 Y → Z（枪口方向） */
    壳.position.set(0, 轴Y, 轴Z); g.add(壳);
    /* 瓜棱：8 道沿枪管方向的凸条（真几何，比纯贴图更像"南瓜"） */
    var 棱材 = new THREE.MeshLambertMaterial({ color: 0xc9660f, side: THREE.DoubleSide });
    for (var rb = 0; rb < 8; rb++) {
      var a = rb / 8 * Math.PI * 2;
      var 棱 = new THREE.Mesh(new THREE.BoxGeometry(0.0024, 0.0026, 半长 * 1.16), 棱材);
      棱.position.set(Math.cos(a) * 外R * 0.960, 轴Y + Math.sin(a) * 外R * 0.960, 轴Z);
      棱.rotation.z = a;
      g.add(棱);
    }
    /* 镜孔内壁（暗色圆管，只看得见内壁 → 就是"掏空"的那层） */
    var 胆 = new THREE.Mesh(new THREE.CylinderGeometry(孔R, 孔R, 半长 * 2 + 0.006, 20, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x2b1508, side: THREE.BackSide }));
    胆.rotation.x = Math.PI / 2; 胆.position.set(0, 轴Y, 轴Z); g.add(胆);
    /* 前后孔圈（橙） */
    var 前圈 = new THREE.Mesh(new THREE.TorusGeometry(孔R + 0.0018, 0.0034, 6, 20), 橙);
    前圈.position.set(0, 轴Y, 轴Z - 半长); g.add(前圈);
    var 后圈 = new THREE.Mesh(new THREE.TorusGeometry(孔R + 0.0018, 0.0034, 6, 20), 橙亮);
    后圈.position.set(0, 轴Y, 轴Z + 半长); g.add(后圈);
    /* 瓜蒂 */
    cy(0.0045, 0.0062, 0.022, new THREE.MeshLambertMaterial({ color: 0x4a6b2a, side: THREE.DoubleSide }),
      0, 轴Y + 外R * 0.92, 轴Z, 0, 8);
    /* 镜座：两块桥 + 橙色夹条 */
    for (var m = 0; m < 2; m++) {
      var zc = 轴Z + (m ? 0.024 : -0.024);
      var 桥 = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.014, 0.018), 紫深);
      桥.position.set(0, 0.058, zc); g.add(桥);
      var 夹 = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.004, 0.022), 橙);
      夹.position.set(0, 0.0525, zc); g.add(夹);
    }
    /* 【batch274】镜内分划（照「长明」的做法：分划是**镜子里的几何玻璃**，不是屏幕浮层）。
       ⚠️ 位置很关键：贴在**靠眼睛的孔口**（后口）而不是靠前 ——
          后口离眼 0.17 米，同样大小的十字看起来才有"贴在镜片上"的分量；
          贴在前口会缩成一个小点，看着就像"没有准心"。
       画的东西：橙色细十字（中心留缺口）+ 中心糖点（外圈紫）+ 外圈细环 + 下方密位点。 */
    (function () {
      var c = document.createElement('canvas'); c.width = c.height = 256;
      var x = c.getContext('2d');
      x.clearRect(0, 0, 256, 256);
      var 中 = 128, G = 13, L = 86;
      /* 外圈细环（镜片的边界，弱一点，不抢十字） */
      x.strokeStyle = 'rgba(255,170,90,0.30)'; x.lineWidth = 2;
      x.beginPath(); x.arc(中, 中, 104, 0, 6.29); x.stroke();
      /* 十字 */
      x.strokeStyle = 'rgba(255,178,86,0.95)'; x.lineWidth = 3; x.lineCap = 'round';
      x.beginPath();
      x.moveTo(中, 中 - G); x.lineTo(中, 中 - G - L);
      x.moveTo(中, 中 + G); x.lineTo(中, 中 + G + L * 0.62);
      x.moveTo(中 - G, 中); x.lineTo(中 - G - L, 中);
      x.moveTo(中 + G, 中); x.lineTo(中 + G + L, 中);
      x.stroke();
      /* 下方密位点（三档） */
      x.fillStyle = 'rgba(255,178,86,0.80)';
      for (var i = 1; i <= 3; i++) {
        x.beginPath(); x.arc(中, 中 + G + 20 + i * 22, i === 2 ? 3.2 : 2.2, 0, 6.29); x.fill();
      }
      /* 中心：糖点（橙芯 + 紫圈） */
      x.fillStyle = 'rgba(255,196,120,0.98)';
      x.beginPath(); x.arc(中, 中, 5.2, 0, 6.29); x.fill();
      x.strokeStyle = 'rgba(190,110,255,0.85)'; x.lineWidth = 2.4;
      x.beginPath(); x.arc(中, 中, 8.6, 0, 6.29); x.stroke();
      var tex = new THREE.CanvasTexture(c);
      try { tex.anisotropy = 4; } catch (e) { }
      var m2 = new THREE.Mesh(new THREE.CircleGeometry(孔R * 0.90, 32),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m2.position.set(0, 轴Y, 轴Z + 半长 - 0.0035);   /* 靠眼的孔口 */
      m2.renderOrder = 3;
      g.add(m2);
      g.userData._分划 = m2;
    })();
    g.userData._镜口 = { y: 轴Y, z: 轴Z, r: 孔R, 角: 0.080, 距设: 0.208 };
    g.userData._南瓜镜 = 1;
  })();

  /* ---------- 鬼魂：护木下挂一只，枪托上趴一只（半透明白） ---------- */
  function 小鬼(x, y, z, 大) {
    var o = new THREE.Group();
    var 身 = new THREE.Mesh(new THREE.SphereGeometry(0.030 * 大, 14, 10), 鬼材);
    身.scale.set(1, 1.15, 0.9); o.add(身);
    var 尾 = new THREE.Mesh(new THREE.ConeGeometry(0.026 * 大, 0.040 * 大, 12), 鬼材);
    尾.position.y = -0.030 * 大; 尾.rotation.x = Math.PI; o.add(尾);
    var 手L = new THREE.Mesh(new THREE.SphereGeometry(0.010 * 大, 8, 6), 鬼材);
    手L.position.set(-0.028 * 大, 0.004, 0.004); o.add(手L);
    var 手R = 手L.clone(); 手R.position.x = 0.028 * 大; o.add(手R);
    var eL = new THREE.Mesh(new THREE.SphereGeometry(0.0055 * 大, 8, 6), 鬼眼);
    eL.position.set(-0.011 * 大, 0.006 * 大, -0.024 * 大); o.add(eL);
    var eR = eL.clone(); eR.position.x = 0.011 * 大; o.add(eR);
    o.position.set(x, y, z);
    g.add(o); return o;
  }
  小鬼(-0.034, -0.016, -0.196, 0.95);     // 挂在护木左下，探头
  小鬼(0.000, 0.036, 0.196, 0.62);        // 趴在折叠托上

  /* ---------- 糖果（枪身上的装饰） ---------- */
  var 糖材 = new THREE.MeshLambertMaterial({ map: _万圣糖纸贴图(), side: THREE.DoubleSide });
  function 糖(x, y, z, rx, ry, s) {
    var o = new THREE.Mesh(new THREE.CylinderGeometry(0.0058 * s, 0.0058 * s, 0.016 * s, 10), 糖材);
    o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, 0); g.add(o); return o;
  }
  /* 两颗装饰糖贴在机匣左侧（原来放在 z=0.140 的空中 —— 那里是机匣和折叠托之间的空隙，
     看起来就是两片糖浮在半空）。现在贴着侧面、横放，像贴纸一样趴在枪身上。 */
  糖(-0.0315, 0.006, 0.062, Math.PI / 2, 0, 1);
  糖(-0.0315, 0.006, 0.086, Math.PI / 2, 0, 1);

  /* ---------- 持枪手（和长明一样包进独立 Group，方便预览页单独隐藏） ---------- */
  if (typeof buildRightHand === 'function') {
    var 手组 = new THREE.Group();
    buildRightHand(手组, new THREE.Vector3(0.038, -0.070, 0.062), new THREE.Vector3(0.112, -0.070, 0.270));
    g.add(手组); g.userData._右手 = 手组;
  }
  try { if (typeof _标静态 === 'function') _标静态(g); } catch (e) { }
  g.userData._万圣枪 = 1;
}

/* ==================== 三、弹匣：糖果 ==================== */
/* 由 js/01 的 buildMagazineGroup 在 magType==='candy' 时调到这里（见那边的分支）。
   设计：两侧导轨 + 后面板 → 正面露出一列**糖**（一根竖窗）；
   最上面那颗糖顶在喂弹口里，正对抛壳窗 —— 和「长明」的"从下面顶上来"是同一个视觉逻辑。 */
function _万圣弹匣(magGroup) {
  /* 【batch275】按用户口径重做：**排列方式和长明完全一致**，只是把子弹换成糖果。
     · 32 发（弹容 32 → 模型里就是 32 颗糖），每 5.8mm 一级、左右交替 = 经典 S 形双排；
     · 只显示前 N 颗 → 上面那摞不动、底下先空，看起来就是"从下面一颗一颗顶上来"；
     · 托弹板（follower）跟着最上面那摞的下沿上移；
     · 侧面是真镂空竖窗（不是透明材质），从外面能看清每一颗糖。
     实现上刻意沿用长明那套 userData 约定（子弹组 / 子弹数 / 弹位 / 托弹板 / 托簧），
     这样 js/01 的 `刷新弹匣子弹` 一行都不用改就认这颗弹匣。 */
  var 匣外 = new THREE.MeshLambertMaterial({ color: 0x2b1f3d, side: THREE.DoubleSide });
  var 匣暗 = new THREE.MeshLambertMaterial({ color: 0x140f20, side: THREE.DoubleSide });
  var 匣橙 = new THREE.MeshBasicMaterial({ color: 0xffa63d });
  var 匣钢 = new THREE.MeshLambertMaterial({ color: 0x8f96a3, side: THREE.DoubleSide });
  var 糖材 = new THREE.MeshLambertMaterial({ map: _万圣糖纸贴图(), side: THREE.DoubleSide });
  var M = new THREE.Group(); magGroup.add(M);

  var 宽 = 0.033, 厚 = 0.052;
  var 段高 = 0.0255, 段数 = 6, 折角 = 0.030, 每段 = 6, 总数 = 32;   /* 6×6=36 个位置，只取前 32；间距 4.25mm → 全长约 15cm */
  var 弹位 = [], 级 = 0;
  var 累Y = 0, 累Z = 0;
  for (var 段 = 0; 段 < 段数; 段++) {
    var 角 = 段 * 折角;
    var g2 = new THREE.Group();
    g2.position.set(0, 累Y - 段高 / 2 * Math.cos(角), 累Z - 段高 / 2 * Math.sin(角));
    g2.rotation.x = 角;
    M.add(g2);
    var 段内 = function (w, h, d, m, x, y, z) {
      var o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      o.position.set(x, y, z); g2.add(o); return o;
    };
    /* 左右两侧各两片薄壁（中间留出竖窗，糖从窗口看得见） */
    for (var 侧 = -1; 侧 <= 1; 侧 += 2) {
      var x0 = 侧 * 0.0145;
      段内(0.004, 段高, 0.014, 匣外, x0, 0, -0.019);   /* 前壁 */
      段内(0.004, 段高, 0.014, 匣外, x0, 0, 0.019);    /* 后壁 */
    }
    段内(宽, 段高, 0.005, 匣暗, 0, 0, 厚 / 2 - 0.0025);
    段内(宽, 段高, 0.005, 匣暗, 0, 0, -厚 / 2 + 0.0025);
    /* 窗口上下沿的小唇边（真几何，让"镂空"有厚度） */
    段内(宽 * 0.66, 0.0035, 0.004, 匣暗, 0, 0.0085, -厚 / 2 + 0.0015);
    段内(宽 * 0.66, 0.0035, 0.004, 匣暗, 0, -0.0085, -厚 / 2 + 0.0015);
    if (段 === 0) {
      段内(宽 + 0.006, 0.008, 0.012, 匣暗, 0, 段高 / 2, 厚 / 2 - 0.006);
      段内(宽 + 0.006, 0.008, 0.012, 匣暗, 0, 段高 / 2, -厚 / 2 + 0.006);
      段内(0.005, 0.011, 0.030, 匣钢, -0.0190, 0.004, 0);      /* 弹匣释放钮 */
    }
    if (段 === 段数 - 1) {
      段内(宽 + 0.006, 0.013, 厚 + 0.004, 匣暗, 0, -段高 / 2 - 0.007, 0);   /* 底板 */
      段内(宽 + 0.012, 0.004, 厚 + 0.008, 匣橙, 0, -段高 / 2 - 0.015, 0);   /* 橙线（南瓜色收尾） */
    }
    /* ★ S 形：每段 6 级、每级一颗糖，左右交替（和长明同一个算法） */
    for (var 级i = 0; 级i < 每段; 级i++) {
      if (弹位.length >= 总数) break;
      var yl = 段高 / 2 - (级i + 0.5) * (段高 / 每段);
      var xo = ((级 % 2) ? 1 : -1) * 0.0068;
      var zo = ((级 % 2) ? 0.0022 : -0.0022);
      var py = 累Y - 段高 / 2 * Math.cos(角) + yl * Math.cos(角) - zo * Math.sin(角);
      var pz = 累Z - 段高 / 2 * Math.sin(角) + yl * Math.sin(角) + zo * Math.cos(角);
      弹位.push({ x: xo, y: py, z: pz, rx: 角 });
      级++;
    }
    累Y -= 段高 * Math.cos(角); 累Z -= 段高 * Math.sin(角);
  }
  /* 糖果本体：**横着放**（轴沿 Z，糖纸两头朝前后），和长明的子弹一个朝向；
     几何先整体转 90°，实例矩阵只负责每段的倾角。实例化后 32 颗只占 1 次绘制。 */
  var 糖体G = new THREE.CylinderGeometry(0.0046, 0.0046, 0.0130, 10);
  糖体G.rotateX(Math.PI / 2);
  var 糖尖G = new THREE.ConeGeometry(0.0040, 0.0056, 8);
  糖尖G.rotateX(Math.PI / 2);          /* 尖朝 +z */
  var 总 = 弹位.length;
  var 糖体 = new THREE.InstancedMesh(糖体G, 糖材, 总);
  var 糖尖 = new THREE.InstancedMesh(糖尖G, 糖材, 总 * 2);
  var _mtx = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(),
    _s = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();
  for (var bi = 0; bi < 总; bi++) {
    var b = 弹位[bi];
    _e.set(b.rx, 0, 0); _q.setFromEuler(_e); _v.set(b.x, b.y, b.z);
    var 基 = new THREE.Matrix4().compose(_v, _q, _s);
    糖体.setMatrixAt(bi, 基);
    /* 两头糖纸扭结：前尖朝 +z、后尖朝 -z（后尖整体翻 180°） */
    _e.set(b.rx, 0, 0); _q.setFromEuler(_e);
    糖尖.setMatrixAt(bi * 2, new THREE.Matrix4().makeTranslation(0, 0, 0.0092).premultiply(基));
    _e.set(b.rx, Math.PI, 0); _q.setFromEuler(_e);
    糖尖.setMatrixAt(bi * 2 + 1, new THREE.Matrix4().compose(_v, _q, _s).multiply(
      new THREE.Matrix4().makeTranslation(0, 0, 0.0092)));
  }
  [糖体, 糖尖].forEach(function (o) {
    o.instanceMatrix.needsUpdate = true;
    o.frustumCulled = false;
    o.castShadow = false; o.receiveShadow = false;
    M.add(o);
  });
  /* 托弹板 + 托簧：刷新弹匣子弹 会按可见发数把它往上顶 */
  var 托弹板 = new THREE.Mesh(new THREE.BoxGeometry(宽 - 0.004, 0.006, 厚 - 0.012), 匣钢);
  托弹板.position.set(0, -0.006, 0); M.add(托弹板);
  var 托簧 = new THREE.Mesh(new THREE.BoxGeometry(宽 - 0.010, 0.0026, 厚 - 0.020), 匣暗);
  托簧.position.set(0, -0.012, 0); M.add(托簧);

  magGroup.userData.子弹组 = [糖体, 糖尖];   /* 刷新时按可见数裁 count */
  magGroup.userData.子弹数 = 总;
  magGroup.userData.弹位 = 弹位;
  magGroup.userData.托弹板 = 托弹板;
  magGroup.userData.托簧 = 托簧;
  return M;
}

/* ==================== 四、抛壳：糖果纸 ====================
   和 抛壳() 同一套物理（向右后上方抛 + 自旋 + 0.85 秒回收），
   只是把"黄铜弹壳"换成"扭结的糖纸"：中间一段圆柱 + 两头锥形扭结。 */
var _糖纸池 = [], _糖纸活 = [];
function _造糖纸() {
  var 纸 = new THREE.Group();
  var 材 = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  var 中 = new THREE.Mesh(new THREE.CylinderGeometry(0.0052, 0.0052, 0.012, 8),
    new THREE.MeshLambertMaterial({ map: _万圣糖纸贴图(), side: THREE.DoubleSide }));
  中.rotation.z = Math.PI / 2; 纸.add(中);
  var 左尾 = new THREE.Mesh(new THREE.ConeGeometry(0.0048, 0.011, 7), 材);
  左尾.position.x = -0.0115; 左尾.rotation.z = Math.PI / 2; 纸.add(左尾);
  var 右尾 = new THREE.Mesh(new THREE.ConeGeometry(0.0048, 0.011, 7), 材);
  右尾.position.x = 0.0115; 右尾.rotation.z = -Math.PI / 2; 纸.add(右尾);
  /* 两头扭结尖：把锥体的顶点拉出来一点点（就是糖纸拧紧的那个小揪） */
  var 尖1 = new THREE.Mesh(new THREE.ConeGeometry(0.0016, 0.008, 6), 材);
  尖1.position.x = -0.0195; 尖1.rotation.z = Math.PI / 2; 纸.add(尖1);
  var 尖2 = 尖1.clone(); 尖2.position.x = 0.0195; 尖2.rotation.z = -Math.PI / 2; 纸.add(尖2);
  /* 糖纸颜色：每次随机换一种（材质是共享的，所以只换颜色） */
  var 色 = [0xff8a1f, 0xffd166, 0xa855f7, 0x4ade80, 0xff5d73][(Math.random() * 5) | 0];
  纸.traverse(function (o) { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex(色); } });
  纸.rotation.z = Math.PI / 2;
  return 纸;
}
function 万圣_抛糖纸() {
  try {
    if (!万圣在用()) return false;
    if (!weaponGroup || !weaponGroup.visible) return true;    // 拿着枪但模型没显示：不出壳（也别让黄铜弹壳冒出来）
    var 纸 = _糖纸池.length ? _糖纸池.pop() : null;
    if (!纸) { 纸 = _造糖纸(); scene.add(纸); }
    纸.visible = true;
    var v = new THREE.Vector3(0.0350, 0.0260, 0.0140);
    weaponGroup.localToWorld(v);
    纸.position.copy(v);
    纸.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    _糖纸活.push({
      m: 纸, vx: 1.2 + Math.random() * 0.7, vy: 1.0 + Math.random() * 0.6, vz: 0.5 + Math.random() * 0.8,
      rx: (Math.random() - 0.5) * 18, ry: (Math.random() - 0.5) * 18, rz: (Math.random() - 0.5) * 18, t: 0
    });
    if (_糖纸活.length > 14) { var 旧 = _糖纸活.shift(); 旧.m.visible = false; _糖纸池.push(旧.m); }
    return true;
  } catch (e) { return true; }
}
function 万圣_推进糖纸(dt) {
  for (var i = _糖纸活.length - 1; i >= 0; i--) {
    var p = _糖纸活[i]; p.t += dt;
    p.vy -= 9.0 * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    p.m.rotation.x += p.rx * dt; p.m.rotation.y += p.ry * dt; p.m.rotation.z += p.rz * dt;
    if (p.t > 0.9) { p.m.visible = false; _糖纸活.splice(i, 1); _糖纸池.push(p.m); }
  }
}

/* ==================== 五、击杀演出（4 秒） ====================
   时间轴（用户要求"整个击杀动画维持 4 秒"）：
     0.00 ~ 0.15  尸体留在原地（不再被 remove），只轻微一颤
     0.15 ~ 1.20  鬼魂从侧后窜出，绕着尸体螺旋逼近头部
     1.20 ~ 1.45  鬼魂把南瓜头按到尸体头上（南瓜头从上方砸下 + 弹一下）
     1.45 ~ 2.05  脚下裂缝张开（暗紫口 + 紫色光边 + 一圈獠牙状的齿）
     1.55 ~ 2.60  尸体被拖进裂缝：下沉 + 倾倒 + 缩小
     2.60 ~ 2.85  鬼魂一头扎进裂缝
     2.70 ~ 3.85  裂缝往外喷糖（20 颗，带抛物线 + 落地回弹）
     3.85 ~ 4.00  裂缝合上、清理
   实现：自己一条 requestAnimationFrame（和长明的 MK 同一套路），有演出才跑。 */
var HW = { 演: [], _raf: 0, _last: 0 };
var _万圣共用 = null;
function _万圣资源() {
  if (_万圣共用) return _万圣共用;
  var 糖色 = [0xff8a1f, 0xffd166, 0xa855f7, 0x4ade80, 0xff5d73, 0xfff1c9];
  _万圣共用 = {
    糖球: new THREE.SphereGeometry(0.046, 10, 8),
    糖纸: new THREE.CylinderGeometry(0.0095, 0.0095, 0.022, 8),
    糖色: 糖色.map(function (c) { return new THREE.MeshLambertMaterial({ color: c }); }),
    裂: new THREE.CircleGeometry(0.85, 26),
    裂沿: new THREE.TorusGeometry(0.85, 0.055, 6, 28),
    裂材: new THREE.MeshBasicMaterial({ color: 0x0b0612, side: THREE.DoubleSide }),
    裂光: new THREE.MeshBasicMaterial({ color: 0xa855f7, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    齿: new THREE.ConeGeometry(0.055, 0.16, 5),
    齿材: new THREE.MeshBasicMaterial({ color: 0x6b2fa0, side: THREE.DoubleSide }),
    鬼身: new THREE.SphereGeometry(0.21, 16, 12),
    鬼尾: new THREE.ConeGeometry(0.185, 0.26, 14),
    鬼材: new THREE.MeshLambertMaterial({ color: 0xf2eeff, side: THREE.DoubleSide, transparent: true, opacity: 0.80 }),
    鬼眼: new THREE.MeshBasicMaterial({ color: 0x1b1030 }),
    瓜球: new THREE.SphereGeometry(0.165, 18, 14),
    瓜材: new THREE.MeshLambertMaterial({ map: _万圣南瓜贴图(), side: THREE.DoubleSide }),
    瓜棒: new THREE.CylinderGeometry(0.014, 0.020, 0.075, 8),
    瓜棒材: new THREE.MeshLambertMaterial({ color: 0x4a6b2a, side: THREE.DoubleSide })
  };
  return _万圣共用;
}
function _造鬼(R) {
  var o = new THREE.Group();
  var 身 = new THREE.Mesh(R.鬼身, R.鬼材); 身.scale.set(1, 1.15, 0.95); o.add(身);
  var 尾 = new THREE.Mesh(R.鬼尾, R.鬼材); 尾.position.y = -0.19; 尾.rotation.x = Math.PI; o.add(尾);
  var 手1 = new THREE.Mesh(R.鬼身, R.鬼材); 手1.scale.setScalar(0.32); 手1.position.set(-0.17, 0.02, 0.02); o.add(手1);
  var 手2 = 手1.clone(); 手2.position.x = 0.17; o.add(手2);
  var e1 = new THREE.Mesh(R.鬼身, R.鬼眼); e1.scale.setScalar(0.16); e1.position.set(-0.06, 0.04, -0.145); o.add(e1);
  var e2 = e1.clone(); e2.position.x = 0.06; o.add(e2);
  return o;
}
function _造裂缝(R) {
  var o = new THREE.Group();
  var 盘 = new THREE.Mesh(R.裂, R.裂材); 盘.rotation.x = -Math.PI / 2; 盘.position.y = 0.012; o.add(盘);
  var 沿 = new THREE.Mesh(R.裂沿, R.裂光); 沿.rotation.x = -Math.PI / 2; 沿.position.y = 0.020; o.add(沿);
  /* 一圈向内的獠牙（像一张嘴） */
  for (var i = 0; i < 12; i++) {
    var a = i / 12 * Math.PI * 2;
    var 牙 = new THREE.Mesh(R.齿, R.齿材);
    牙.position.set(Math.cos(a) * 0.72, 0.030, Math.sin(a) * 0.72);
    牙.rotation.set(Math.PI, -a, 0);
    牙.scale.setScalar(0.7 + (i % 3) * 0.18);
    o.add(牙);
  }
  return o;
}
/* 返回 true = 尸体我接手了，killEnemy 不要再 scene.remove */
/* 【batch285】联机替身：把远端玩家的模型克隆一份到场景里，演出只在**替身**上播。
   ⚠️ 为什么必须这样：联机死了 3 秒后服务端就让他重生（revive → alive=true），
      以前直接在真身上演，revive 一到 `_万圣推进` 就判"他复活了"收演 ——
      4 秒的击杀动画**永远播不完**（用户报："不能在正常玩家上正常播完"）。
   替身演完自己消失；真身藏起来（_hwHide）等他复活/演出结束再放出来。 */
function _万圣替身(src) {
  try {
    var c = src.clone(true);
    c.position.copy(src.position); c.rotation.copy(src.rotation); c.scale.copy(src.scale);
    c.visible = true;      /* ⚠️ 克隆会连 visible=false 一起抄过来（真身可能正被藏着）→ 强制显形 */
    /* 克隆会把名字牌 / 血条（都是 Sprite）一起带过来 → 摘掉，否则替身头顶挂着一块空名字 */
    var 删 = [];
    c.traverse(function (o) { if (o && (o.isSprite || o.isPoints || o.isLine)) 删.push(o); });
    for (var i = 0; i < 删.length; i++) { try { if (删[i].parent) 删[i].parent.remove(删[i]); } catch (e2) { } }
    c.traverse(function (o) { if (o.raycast) o.raycast = function () { }; });   // 替身不参与任何命中判定
    scene.add(c);
    return c;
  } catch (err) { return null; }
}
function 万圣_击杀(e, 联机) {
  try {
    if (!万圣在用()) return false;
    /* ① 计数卡（不管尸体动画能不能播，计数一定要走）
       【batch278】联机击杀真人玩家时本地 S.kills 不一定更新，由调用方直接报数 */
    万圣_计数到(联机 && typeof 联机.计数 === 'number' ? 联机.计数 : ((typeof S !== 'undefined' && S) ? (S.kills || 0) : 0));
    if (!e || !e.root) return false;
    var R = _万圣资源();
    /* ② 联机：演出改在替身上做（真身藏起来、交给联机逻辑随时复活） */
    var 真身 = (联机 && 联机.实体 && 联机.实体.root) ? 联机.实体 : null;
    var 尸 = e.root, 用替身 = false;
    if (真身) {
      var 副 = _万圣替身(真身.root);
      if (副) { 尸 = 副; 用替身 = true; 真身._hwHide = 1; try { 真身.root.visible = false; } catch (_eH) { } }
    }
    联机 = 用替身 ? null : 联机;      // 替身模式＝纯本地演出：收演时直接删替身，绝不碰真身
    var 原Y = 尸.position.y, 原RY = 尸.rotation.y, 原RZ = 尸.rotation.z || 0;
    var 根位 = 尸.position.clone();
    /* ② 裂缝放在脚底 */
    var 裂 = _造裂缝(R);
    裂.position.set(根位.x, 原Y + 0.01, 根位.z);
    裂.visible = false; 裂.scale.set(0.01, 1, 0.01);
    scene.add(裂);
    /* ③ 鬼魂从侧后方窜出 */
    var 鬼 = _造鬼(R);
    鬼.position.set(根位.x + 2.2, 原Y + 1.2, 根位.z + 1.6);
    鬼.visible = false;
    scene.add(鬼);
    /* ④ 南瓜头：直接挂到尸体身上（跟着一起下沉/缩放，省一套跟算） */
    var 瓜 = new THREE.Group();
    var 球 = new THREE.Mesh(R.瓜球, R.瓜材); 球.scale.set(1, 0.86, 0.96); 瓜.add(球);
    var 棒 = new THREE.Mesh(R.瓜棒, R.瓜棒材); 棒.position.y = 0.175; 瓜.add(棒);
    瓜.position.set(0, 1.74, 0);
    瓜.visible = false;
    尸.add(瓜);
    /* ⑤ 尸体上那些"该收"的东西先收掉：血条、瞄准线 */
    try { if (e.hb) e.hb.visible = false; } catch (_) { }
    try { if (e.aimLine) { e.aimLine.visible = false; } } catch (_) { }
    /* 【batch279】联机（没克隆成功时的旧路）：锁住这具尸体的快照插值，
       否则每帧插值会把"拖进裂缝"的下沉/旋转动画原样拉回去。
       【batch285】克隆成功时 联机=null，走替身，压根不碰真身 → 不需要锁。 */
    try { if (联机 && 联机.实体) 联机.实体._hwLock = true; } catch (_) { }
  /* ⑥ 登记演出。【batch285】联机：演出对象是**替身**（net=null）→ 演完直接删替身，
     真身一直归联机逻辑管，复活 / 移动 / 再死亡都互不干扰。 */
  HW.演.push({
    t: 0, 尸: 尸, 鬼: 鬼, 裂: 裂, 瓜: 瓜, 头: 根位.clone().setY(原Y + 1.72),
    原Y: 原Y, 原RY: 原RY, 原RZ: 原RZ, 糖: null, 喷完: false,
    net: 联机 || null, 实体: 联机 ? 联机.实体 : null
  });
    _万圣踢();
    return true;
  } catch (err) { return false; }
}
function _万圣收(o) {
  try { if (o.鬼 && o.鬼.parent) o.鬼.parent.remove(o.鬼); } catch (e) { }
  try { if (o.裂 && o.裂.parent) o.裂.parent.remove(o.裂); } catch (e) { }
  try { if (o.瓜 && o.瓜.parent) o.瓜.parent.remove(o.瓜); } catch (e) { }   /* 南瓜头挂在尸体上：单机随尸走，联机要显式摘 */
  if (o.net && o.尸) {
    /* 【batch278】联机：尸体是远端玩家的模型，复活还要用 —— 还原姿态，不移除 */
    try { if (o.实体) o.实体._hwLock = false; } catch (e) { }   /* 【batch279】解锁插值，下一包快照接手 */
    try { o.尸.position.y = o.原Y; o.尸.rotation.y = o.原RY; o.尸.rotation.z = o.原RZ || 0; o.尸.scale.setScalar(1); } catch (e) { }
  } else {
    try { if (o.尸 && o.尸.parent) o.尸.parent.remove(o.尸); } catch (e) { }   /* 演出结束才真正移除尸体 */
  }
  try { if (o.糖) { for (var i = 0; i < o.糖.length; i++) { if (o.糖[i].m.parent) o.糖[i].m.parent.remove(o.糖[i].m); } } } catch (e) { }
}
function _万圣推进(o, dt) {
  /* 【batch278】联机：死者复活了（root 还要接着当活人模型用）→ 立刻还原收演 */
  if (o.net && o.实体 && o.实体.alive) return false;
  o.t += dt;
  var t = o.t, 根 = o.尸;
  if (!根 || !根.parent) return false;
  /* --- 尸体：前 1.55 秒站原地，之后被拖下去 --- */
  if (t < 1.55) {
    根.rotation.z = o.原RZ + Math.sin(t * 11) * 0.022 * (1 - t / 1.55);
  } else {
    var k = Math.min(1, (t - 1.55) / 1.05);
    var ease = k * k * (3 - 2 * k);
    根.position.y = o.原Y - 1.55 * ease;
    根.rotation.z = o.原RZ + 0.55 * ease;
    根.rotation.y = o.原RY + 1.15 * ease;
    根.scale.setScalar(1 - 0.62 * ease);
  }
  /* --- 鬼魂 --- */
  if (t < 0.15) { o.鬼.visible = false; }
  else if (t < 2.60) {
    o.鬼.visible = true;
    if (t < 1.20) {
      var k1 = Math.min(1, (t - 0.15) / 1.05);
      var e1 = 1 - Math.pow(1 - k1, 3);
      var 角 = -1.35 + e1 * 2.1;
      var 半径 = 2.7 * (1 - e1) + 0.16;
      var 目标 = o.头;
      /* 头部跟着尸体下沉，鬼魂在 1.55 秒后跟着走 */
      if (t > 1.55) 目标 = o.头.clone().setY(根.position.y + 1.72 * 根.scale.x);
      o.鬼.position.set(目标.x + Math.cos(角) * 半径, o.头.y + 0.10 + Math.sin(k1 * Math.PI) * 0.55,
        目标.z + Math.sin(角) * 半径);
      o.鬼.rotation.y = 角 + Math.PI / 2;
      o.鬼.scale.setScalar(0.25 + 0.75 * Math.min(1, k1 * 2.6));
    } else {
      var 头位 = o.头.clone().setY(根.position.y + 1.72 * 根.scale.x);
      o.鬼.position.lerp(new THREE.Vector3(头位.x + 0.30, 头位.y + 0.05, 头位.z + 0.32), Math.min(1, dt * 6));
      o.鬼.rotation.y = -0.8;
      o.鬼.scale.setScalar(1.0);
    }
  } else if (t < 2.85) {
    /* 一头扎进裂缝 */
    var k3 = (t - 2.60) / 0.25;
    o.鬼.position.y = 根.position.y + 1.0 * (1 - k3) - 0.6 * k3;
    o.鬼.scale.setScalar(1 - 0.85 * k3);
    o.鬼.visible = k3 < 1;
  } else { o.鬼.visible = false; }
  /* --- 南瓜头：1.20 秒从上方砸到头上，落地弹一下 --- */
  if (t < 1.20) { o.瓜.visible = false; }
  else {
    o.瓜.visible = true;
    var kp = Math.min(1, (t - 1.20) / 0.25);
    var 弹 = kp < 1 ? (1 - kp) : Math.max(0, 1 - (t - 1.45) / 0.10);
    o.瓜.position.y = 1.74 + 0.55 * (1 - kp) * (1 - kp) + 0.05 * Math.sin(弹 * Math.PI);
    o.瓜.rotation.y = o.原RY * -0.6 + t * 1.2;
    o.瓜.scale.setScalar(0.96 + 0.04 * Math.sin(t * 20));
  }
  /* --- 裂缝：1.45 张开，3.85 合上 --- */
  if (t < 1.45) 裂显(o, 0);
  else if (t < 1.95) 裂显(o, (t - 1.45) / 0.5);
  else if (t < 3.85) 裂显(o, 1);
  else 裂显(o, Math.max(0, 1 - (t - 3.85) / 0.15));
  /* --- 喷糖 --- */
  if (!o.喷完 && t >= 2.70) { o.喷完 = true; o.糖 = _喷糖(o.裂.position, R_HW()); }
  if (o.糖) _推进喷糖(o.糖, dt);
  if (t >= 4.00) return false;
  return true;
}
function R_HW() { return _万圣资源(); }
function 裂显(o, k) {
  o.裂.visible = k > 0.005;
  var s = 0.05 + 0.95 * Math.min(1, k);
  o.裂.scale.set(s, 1, s);
  o.裂.rotation.y = k * 0.5;
}
function _喷糖(位, R) {
  var arr = [];
  for (var i = 0; i < 20; i++) {
    var g = new THREE.Group();
    var 球 = new THREE.Mesh(R.糖球, R.糖色[i % R.糖色.length]);
    球.scale.set(1.1, 0.85, 0.9); g.add(球);
    var 纸 = new THREE.Mesh(R.糖纸, R.糖色[(i + 2) % R.糖色.length]);
    纸.rotation.z = Math.PI / 2; 纸.position.x = 0.042; g.add(纸);
    var 纸2 = new THREE.Mesh(R.糖纸, R.糖色[(i + 4) % R.糖色.length]);
    纸2.rotation.z = Math.PI / 2; 纸2.position.x = -0.042; g.add(纸2);
    g.position.set(位.x + (Math.random() - 0.5) * 0.4, 位.y + 0.05, 位.z + (Math.random() - 0.5) * 0.4);
    scene.add(g);
    var 角 = Math.random() * Math.PI * 2, 速 = 1.6 + Math.random() * 2.6;
    arr.push({
      m: g, vx: Math.cos(角) * 速, vy: 4.2 + Math.random() * 3.2, vz: Math.sin(角) * 速,
      rx: (Math.random() - 0.5) * 12, ry: (Math.random() - 0.5) * 12,
      地: (typeof groundY === 'number' ? groundY : 0) + 0.06, t: 0
    });
  }
  return arr;
}
function _推进喷糖(arr, dt) {
  for (var i = 0; i < arr.length; i++) {
    var p = arr[i]; p.t += dt;
    p.vy -= 11.0 * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    p.m.rotation.x += p.rx * dt; p.m.rotation.y += p.ry * dt;
    if (p.m.position.y < p.地) {
      p.m.position.y = p.地;
      if (Math.abs(p.vy) > 1.2) { p.vy = -p.vy * 0.42; p.vx *= 0.7; p.vz *= 0.7; }
      else { p.vy = 0; p.vx *= 0.85; p.vz *= 0.85; p.rx = 0; p.ry = 0; }
    }
  }
}
function _万圣踢() {
  if (HW._raf) return;
  HW._last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  HW._raf = requestAnimationFrame(_万圣帧);
}
function _万圣帧(now) {
  HW._raf = 0;
  var dt = Math.min(0.10, (now - HW._last) / 1000);
  if (!(dt > 0)) dt = 0.016;
  HW._last = now;
  var 停 = false;
  try { 停 = (typeof S !== 'undefined' && S && (!S.playing || S.over)); } catch (e) { }
  if (停) {
    for (var j = 0; j < HW.演.length; j++) _万圣收(HW.演[j]);
    HW.演.length = 0; return;
  }
  for (var i = HW.演.length - 1; i >= 0; i--) {
    var o = HW.演[i], live = false;
    try { live = _万圣推进(o, dt); } catch (e) { live = false; }
    if (!live) { _万圣收(o); HW.演.splice(i, 1); }
  }
  if (HW.演.length) _万圣踢();
}

/* ==================== 六、击杀数显示（南瓜 / 鬼魂 / 糖果） ==================== */
var HK = { 目: 0, 显: 0, 收: 0, _raf: 0, _last: 0 };
function 万圣_计数到(n) {
  if (typeof n === 'number' && isFinite(n) && n > HK.目) HK.目 = n;
  var el = document.getElementById('hwKill');
  if (!el) return;
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go', 'on');
  var bar = document.getElementById('hwKillBar');
  if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = 'hwBar 2.6s linear forwards'; }
  HK.收 = 2.6;
  _HK踢();
}
function _HK踢() {
  if (HK._raf) return;
  HK._last = performance.now();
  HK._raf = requestAnimationFrame(_HK帧);
}
function _HK帧(now) {
  HK._raf = 0;
  var dt = Math.min(0.10, (now - HK._last) / 1000); if (!(dt > 0)) dt = 0.016;
  HK._last = now;
  var num = document.getElementById('hwKillNum');
  if (num) {
    if (HK.显 < HK.目) {
      var 差 = HK.目 - HK.显;
      HK.显 += Math.max(差 * Math.min(1, dt * 11), Math.max(0.5, dt * 26));
      if (HK.显 > HK.目) HK.显 = HK.目;
    }
    var s = String(Math.round(HK.显));
    if (num.textContent !== s) num.textContent = s;
  }
  if (HK.收 > 0) {
    HK.收 -= dt;
    if (HK.收 <= 0) { var el = document.getElementById('hwKill'); if (el) el.classList.remove('on', 'go'); }
  }
  if (HK.收 > 0) _HK踢();
}
function 万圣_计数复位() {
  HK.目 = 0; HK.显 = 0; HK.收 = 0;
  var el = document.getElementById('hwKill'); if (el) el.classList.remove('on', 'go');
  var num = document.getElementById('hwKillNum'); if (num) num.textContent = '0';
}

/* ==================== 七、注册枪皮 def ====================
   数值全按用户口径：伤害 ×1.5、弹夹 32、售价 250。
   没有 memorial / scopeView：不带长明那三样特权（检视、镜内光学、高级换弹），
   本枪的卖点是外观 + 击杀演出。 */
BUILTIN_GUNS[HALLOWEEN_SLOT] = {
  name: 万圣枪皮名, icon: '🎃', note: '万圣节限定 · 250 枪皮币',
  halloween: true,
  /* 【batch274】冲锋枪手感：射速比步枪快一截（78 → 约 770 发/分）、射程短（62m）、
     换弹略快（2.0s）、散布稍大。伤害/弹容/售价仍是用户口径的 1.5 / 32 / 250。 */
  damage: 1.5, magSize: 32, fireRate: 78, reloadTime: 2000, recoilMul: 0.96,
  range: 62, pellets: 1, spread: 0.021, auto: true,
  adsFov: 30, adsSpreadKeep: 0, reticle: 'pumpkin',
  magType: 'candy', magPos: { x: 0, y: -0.030, z: -0.050 },
  gripPos: { x: 0.176, y: -0.222, z: -0.420 },
  aimPos: { x: 0, y: -0.094, z: -0.186 },
  lhPos: { x: -0.042, y: -0.092, z: -0.170 },
  枪皮: 万圣枪皮名, 皮价: 250,
  build: _建南瓜枪
};
万圣刷新锁();

/* ==================== 八、对外接口（探针 / 控制台） ==================== */
try {
  window.万圣枪皮 = {
    槽位: HALLOWEEN_SLOT,
    已解锁: 万圣已解锁,
    解锁: 万圣解锁,
    在用: 万圣在用,
    击杀: 万圣_击杀,
    计数: 万圣_计数到,
    演出数: function () { return HW.演.length; },
    糖纸数: function () { return _糖纸活.length; }
  };
  window.万圣击杀测试 = function () {
    try {
      var 甲 = { root: new THREE.Group() };
      甲.root.position.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(5));
      甲.root.position.y = Math.max(0, 甲.root.position.y - 1.7);
      var 仿 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.3),
        new THREE.MeshLambertMaterial({ color: 0x8a93a8 }));
      仿.position.y = 0.85; 甲.root.add(仿);
      scene.add(甲.root);
      return 万圣_击杀(甲);
    } catch (e) { return false; }
  };
} catch (e) { }
