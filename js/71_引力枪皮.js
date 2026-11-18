/* 【1.10.9】月球主题枪皮「引力」（js/71_引力枪皮.js）=====================================
   用户口径（原话拆解）：
     · 引力主题枪皮，弹夹容量 **8**，**伤害 ×4**；
     · 装弹特殊：屏幕**左边飘来一个弹夹**，手伸过去把弹夹拿过来再装到枪上；
     · 枪上有个**月球挂饰**；**前握把是月球那种颜色**（月岩灰）；
     · 检视时玩家把它**抛向空中、悬浮在正中间旋转**；
     · 狙击枪，**每开一枪都要拉一次栓**，拉栓要时间；装弹慢。

   实现分工（照 js/69 万圣枪皮的先例，全部用包装，不改老分片函数体）：
     · 本分片注册 `BUILTIN_GUNS[-3]`（-1 长明 / -2 南瓜 / 2+ 模组枪）；
     · 第一人称模型 = 第三人称模型（js/20 的 _TP复制第一人称 直接复制 def.build）；
     · 弹匣：包装 buildMagazineGroup，magType==='gravity' 时给自己的弹匣；
     · 拉栓：def.boltAction/boltTime，包装 attack（拉栓中不许开火）+ updatePlayer 推进动画；
     · 换弹动画（左侧飞弹夹）与检视（抛空悬浮）在 js/24 里按 def.reloadAnim / inspectAnim 分支。
   ⚠️ 本分片排在 js/70 之后（最后），跨分片调用一律 typeof 守卫。 */

var GRAVITY_SLOT = -3;
var 引力枪皮键 = 'gunGame.gravSkin.v1';
var 引力枪皮名 = '引力';
var 引力皮价 = 200;   /* 重做后价格：比南瓜（250）低一档，用户反馈原 300 不值 */

/* ==================== 一、解锁 / 购买（同万圣枪皮那套） ==================== */
function 引力已解锁() {
  try { return localStorage.getItem(引力枪皮键) === '1'; } catch (e) { return false; }
}
function 引力解锁(静默) {
  try { localStorage.setItem(引力枪皮键, '1'); } catch (e) { }
  引力刷新锁();
  if (!静默) { try { showMsg('🌑 已解锁枪皮「引力」！按 B 打开武器界面装备', '#9fd8ff'); } catch (e) { } }
}
function 引力刷新锁() {
  var d = BUILTIN_GUNS[GRAVITY_SLOT]; if (!d) return;
  var 有 = 引力已解锁();
  d.锁 = !有;
  d.锁提示 = 有 ? '' : '未购买 · 去主菜单「枪械购买」用 ' + 引力皮价 + ' 枪皮币解锁';
}
/* 商店购买钩子（枪皮商店点击时调用，名字与万圣保持一致的口径） */
function 引力购买尝试() {
  if (引力已解锁()) return true;
  try {
    if (typeof 枪皮币 !== 'number' || 枪皮币 < 引力皮价) {
      showMsg('枪皮币不足：需要 ' + 引力皮价 + '（当前 ' + (typeof 枪皮币 === 'number' ? 枪皮币 : 0) + '）', '#ffd166');
      return false;
    }
  } catch (e) { }
  try { 枪皮币 -= 引力皮价; if (typeof 存枪皮币 === 'function') 存枪皮币(); } catch (e) { }
  引力解锁(false);
  return true;
}

/* ==================== 二、模型：狙击枪 + 月球挂饰 + 月岩前握把 ==================== */
function _建引力枪(g) {
  /* 【1.10.13】整体重做（对照纪念枪的建模口径）。
     坐标习惯：枪膛轴线 y=+0.020；枪口朝 -z；机匣顶 y≈0.047；导轨齿顶 y≈0.0575。 */
  var 天顶 = Math.PI / 2;

  /* ---- 材质：深色主体 + 月白点缀（这套配色用户已认可，不动） ---- */
  var 深空 = new THREE.MeshLambertMaterial({ color: 0x232c3a, side: THREE.DoubleSide });
  var 深空暗 = new THREE.MeshLambertMaterial({ color: 0x11161f, side: THREE.DoubleSide });
  var 月岩 = new THREE.MeshLambertMaterial({ color: 0x8f99a6, side: THREE.DoubleSide });
  var 月岩暗 = new THREE.MeshLambertMaterial({ color: 0x626b77, side: THREE.DoubleSide });
  var 钢 = new THREE.MeshLambertMaterial({ color: 0x5a636f, side: THREE.DoubleSide });
  var 钢暗 = new THREE.MeshLambertMaterial({ color: 0x3a424c, side: THREE.DoubleSide });
  var 蓝 = new THREE.MeshBasicMaterial({ color: 0x6ec8ff, side: THREE.DoubleSide });
  var 蓝暗 = new THREE.MeshLambertMaterial({ color: 0x2f6f9c, side: THREE.DoubleSide });
  var 月面 = new THREE.MeshLambertMaterial({ color: 0xd8dde4, side: THREE.DoubleSide });
  var 月坑 = new THREE.MeshLambertMaterial({ color: 0x9aa4b0, side: THREE.DoubleSide });
  /* 镜筒单面材质：从里往外看背面剔除（开镜时筒壁不糊视野） */
  /* 【1.10.15】镜筒改回 DoubleSide：筒壁从内侧也画出来 → 开镜能看到一圈镜筒隧道。
     ⚠️ 关键区分：端盖仍然由 筒() 的 openEnded=true 去掉（中心通透、看得清远处）；
        单面材质剔的是"整根筒壁"，那会让镜子在开镜时直接消失 —— 那是错的做法。
        纪念枪也是 DoubleSide 筒壁 + 无端盖。 */
  var 镜筒 = new THREE.MeshLambertMaterial({ color: 0x1d2534, side: THREE.DoubleSide });
  var 镜筒暗 = new THREE.MeshLambertMaterial({ color: 0x11161f, side: THREE.DoubleSide });
  var 镜钢 = new THREE.MeshLambertMaterial({ color: 0x9ca6b4 });

  function bx(w, h, d, m, x, y, z, rx, ry, rz) {
    var o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x || 0, y || 0, z || 0);
    if (rx) o.rotation.x = rx; if (ry) o.rotation.y = ry; if (rz) o.rotation.z = rz;
    g.add(o); return o;
  }
  /* 圆柱：默认轴沿 Z（枪管/镜筒方向）；rx=0 → 轴沿 Y（竖直件：旋塔/销钉） */
  function cy(rt, rb, len, m, x, y, z, rx, seg) {
    var o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg || 16), m);
    o.position.set(x || 0, y || 0, z || 0);
    o.rotation.x = (rx === undefined ? 天顶 : rx);
    g.add(o); return o;
  }
  /* 【1.10.14】空心圆筒（openEnded=true）——瞄镜专用。
     ⚠️ CylinderGeometry 默认带两端盖；转成轴沿 Z 后**后端盖正对眼睛**，
        FrontSide 材质照样渲染 → 开镜就是一片实心圆盘，什么都看不见。
     筒() 去掉端盖，只剩筒壁；配合 FrontSide，从筒内往外看背面被剔除 → 完全通透。 */
  function 筒(rt, rb, len, m, x, y, z, seg) {
    var o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg || 20, 1, true), m);
    o.position.set(x || 0, y || 0, z || 0);
    o.rotation.x = 天顶;
    g.add(o); return o;
  }
  /* 环（torus）：默认 torus 在 XY 面、孔沿 Z —— 这才是"套在枪管/镜筒上的环"。
     ⚠️ 旧版全部 rx=π/2，那是平躺的垫片，瞄镜看起来一圈圈"摞"在筒上，很假。 */
  function 环Z(R, 管, m, x, y, z, seg) {
    var o = new THREE.Mesh(new THREE.TorusGeometry(R, 管, 8, seg || 20), m);
    o.position.set(x, y, z); g.add(o); return o;
  }
  /* 横向圆柱（轴沿 X：拉机柄/侧旋塔/销钉） */
  function 横cy(r, len, m, x, y, z, seg) {
    var o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 12), m);
    o.rotation.z = 天顶; o.position.set(x, y, z); g.add(o); return o;
  }

  /* ================= 一、机匣 ================= */
  bx(0.058, 0.054, 0.290, 深空, 0, 0.020, -0.015);            // 上机匣（z -0.16 ~ +0.13）
  bx(0.058, 0.040, 0.250, 深空, 0, -0.024, -0.015);           // 下机匣
  bx(0.060, 0.006, 0.290, 深空暗, 0, -0.002, -0.015);         // 分界槽
  bx(0.054, 0.004, 0.290, 深空暗, 0, 0.0485, -0.015);         // 顶沿压线
  /* 两侧能量槽（引力识别色） */
  bx(0.003, 0.007, 0.110, 蓝, -0.0296, 0.022, -0.080);
  bx(0.003, 0.007, 0.110, 蓝, 0.0296, 0.022, -0.080);
  bx(0.003, 0.005, 0.056, 蓝暗, -0.0296, 0.022, 0.066);
  bx(0.003, 0.005, 0.056, 蓝暗, 0.0296, 0.022, 0.066);
  /* 抛壳窗（右侧真凹槽：暗腔 BackSide + 看得见的枪机框） */
  (function () {
    var 窗Y = 0.024, 窗Z = 0.030, 窗L = 0.080, 窗H = 0.028;
    bx(0.005, 0.004, 窗L + 0.010, 深空暗, 0.0300, 窗Y + 窗H / 2 + 0.002, 窗Z);
    bx(0.005, 0.004, 窗L + 0.010, 深空暗, 0.0300, 窗Y - 窗H / 2 - 0.002, 窗Z);
    bx(0.005, 窗H + 0.008, 0.004, 深空暗, 0.0300, 窗Y, 窗Z + 窗L / 2 + 0.002);
    bx(0.005, 窗H + 0.008, 0.004, 深空暗, 0.0300, 窗Y, 窗Z - 窗L / 2 - 0.002);
    var 腔 = new THREE.Mesh(new THREE.BoxGeometry(0.018, 窗H, 窗L),
      new THREE.MeshLambertMaterial({ color: 0x080c0a, side: THREE.BackSide }));
    腔.position.set(0.0255, 窗Y, 窗Z); g.add(腔);
    /* 枪机框：拉栓时后退（js/24 靠 animPart 找它） */
    var 机框 = bx(0.011, 窗H - 0.009, 0.036, 钢, 0.0272, 窗Y, 窗Z - 0.010);
    机框.userData.animPart = 'bolt';
    机框.userData.原位Z = 机框.position.z;
  })();
  /* 拉机柄（右后上方：横杆 + 球头，随拉栓后退） */
  var 柄杆 = 横cy(0.0052, 0.030, 钢, 0.034, 0.034, 0.062, 10);
  柄杆.userData.animPart = 'bolt'; 柄杆.userData.原位Z = 柄杆.position.z;
  var 柄球 = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 12, 10), 钢暗);
  柄球.position.set(0.052, 0.034, 0.062); g.add(柄球);
  柄球.userData.animPart = 'bolt'; 柄球.userData.原位Z = 柄球.position.z;
  /* 销钉（左右贯通两颗） */
  横cy(0.0032, 0.062, 钢暗, 0, -0.012, -0.070, 8);
  横cy(0.0032, 0.062, 钢暗, 0, -0.012, 0.088, 8);
  /* 顶部导轨（基座 + 13 齿，齿顶 y=0.0575） */
  bx(0.024, 0.006, 0.330, 深空暗, 0, 0.050, -0.015);
  (function () {
    for (var i = 0; i < 13; i++) bx(0.028, 0.005, 0.008, 深空, 0, 0.0555, -0.158 + i * 0.024);
  })();

  /* ================= 二、重型枪管（比瞄镜粗！） ================= */
  /* 旧版：外露段只有 15mm，瞄镜物镜 52mm —— 镜比管粗 3.5 倍，主次颠倒。 */
  bx(0.050, 0.042, 0.058, 深空, 0, 0.020, -0.190);             // 枪管节套
  cy(0.0175, 0.0175, 0.260, 钢, 0, 0.020, -0.330, 天顶, 20);   // 重管（护木内，-0.20~-0.46）
  cy(0.0150, 0.0162, 0.220, 钢, 0, 0.020, -0.570, 天顶, 20);   // 外露段（-0.46~-0.68，微收）
  环Z(0.0170, 0.0022, 钢暗, 0, 0.020, -0.462, 18);             // 管箍
  /* 制退器：三段室 + 蓝色能量环 + 端面 */
  cy(0.0220, 0.0220, 0.082, 深空暗, 0, 0.020, -0.722, 天顶, 20);
  bx(0.046, 0.007, 0.010, 深空, 0, 0.020, -0.700);
  bx(0.046, 0.007, 0.010, 深空, 0, 0.020, -0.722);
  bx(0.046, 0.007, 0.010, 深空, 0, 0.020, -0.744);
  环Z(0.0228, 0.0028, 蓝, 0, 0.020, -0.683, 20);
  bx(0.040, 0.012, 0.004, 钢暗, 0, 0.020, -0.764);
  cy(0.0115, 0.0115, 0.004, 深空暗, 0, 0.020, -0.766, 天顶, 14); // 枪口孔

  /* ================= 三、护木（深空色，和机匣同一色调） ================= */
  bx(0.052, 0.046, 0.240, 深空, 0, 0.008, -0.330);             // 主体（z -0.21 ~ -0.45）
  bx(0.048, 0.040, 0.032, 深空暗, 0, 0.008, -0.462);           // 前端收口
  bx(0.054, 0.004, 0.240, 月岩暗, 0, 0.033, -0.330);           // 上沿月岩细线（点缀）
  bx(0.054, 0.006, 0.240, 深空暗, 0, -0.017, -0.330);          // 下沿深槽
  /* 侧面散热孔（每侧 3 个） */
  (function () {
    for (var i = 0; i < 3; i++) {
      bx(0.004, 0.018, 0.024, 深空暗, 0.0264, 0.008, -0.262 - i * 0.052);
      bx(0.004, 0.018, 0.024, 深空暗, -0.0264, 0.008, -0.262 - i * 0.052);
    }
  })();
  /* 顶部短导轨与机匣导轨衔接 */
  bx(0.022, 0.005, 0.200, 深空暗, 0, 0.038, -0.330);
  /* 底部挂轨（两脚架 / 挂饰都挂这里） */
  bx(0.020, 0.006, 0.190, 深空暗, 0, -0.020, -0.335);
  /* ---- 前握把（月岩色，带指槽与月面坑 —— 这块用户没骂，保留造型） ---- */
  bx(0.034, 0.120, 0.038, 月岩, 0, -0.070, -0.270, 0.14);
  bx(0.038, 0.012, 0.044, 月岩暗, 0, -0.128, -0.264, 0.14);
  bx(0.036, 0.010, 0.040, 月岩暗, 0, -0.012, -0.276, 0.14);
  (function () {
    for (var i = 0; i < 3; i++)
      bx(0.039, 0.008, 0.006, 月岩暗, 0, -0.036 - i * 0.030, -0.2525 - i * 0.0042, 0.14);
    var 坑 = [[-0.008, -0.030, 0.0072], [0.009, -0.052, 0.0055], [-0.005, -0.084, 0.0064], [0.007, -0.104, 0.0042]];
    for (var j = 0; j < 坑.length; j++) {
      var d = new THREE.Mesh(new THREE.CylinderGeometry(坑[j][2], 坑[j][2], 0.003, 10), 月岩暗);
      d.rotation.x = 天顶 + 0.14; d.position.set(坑[j][0], 坑[j][1], -0.2525); g.add(d);
    }
  })();

  /* ================= 四、两脚架（沿用已验证的角度） ================= */
  bx(0.030, 0.010, 0.030, 钢暗, 0, -0.030, -0.430);
  bx(0.009, 0.009, 0.110, 钢暗, -0.020, -0.082, -0.470, -1.15);
  bx(0.009, 0.009, 0.110, 钢暗, 0.020, -0.082, -0.470, -1.15);
  bx(0.016, 0.009, 0.018, 钢, -0.020, -0.132, -0.492);
  bx(0.016, 0.009, 0.018, 钢, 0.020, -0.132, -0.492);

  /* ================= 五、瞄镜（照纪念枪口径：细筒 + 阶梯 + 环座 + 旋塔） =================
     旧版：主镜管 26mm + 物镜 52mm、全长 0.40m —— 一台天文望远镜。
     纪念枪：筒 31mm 但全身阶梯收窄、环座压低、双旋塔 —— 视觉上细。
     本版：主筒 16.5mm，物镜口 24mm，全长 0.37m，光轴 y=+0.096。
     镜筒比枪管（17.5mm）细 —— 主次才对。 */
  var 轴Y = 0.096;
  var _镜件起 = g.children.length;
  (function () {
    /* 目镜段（最后，直径 21mm）：橡胶罩 + 目镜筒 + 蓝环 */
    环Z(0.0215, 0.0048, 深空暗, 0, 轴Y, 0.106, 22);            // 橡胶眼罩
    筒(0.0205, 0.0185, 0.055, 镜筒, 0, 轴Y, 0.080, 22);  // 目镜钟形（z 0.0525~0.1075）
    环Z(0.0206, 0.0020, 蓝, 0, 轴Y, 0.100, 22);                // 目镜蓝环（识别色）
    环Z(0.0168, 0.0016, 镜筒暗, 0, 轴Y, 0.052, 20);            // 目镜收口
    /* 变倍环（目镜前方略粗的一节，真镜都有的 power ring） */
    筒(0.0188, 0.0188, 0.028, 镜筒暗, 0, 轴Y, 0.036, 22);
    环Z(0.0190, 0.0012, 镜钢, 0, 轴Y, 0.022, 22);
    /* 主镜管（细！16.5mm，z +0.022 ~ -0.158） */
    筒(0.0165, 0.0165, 0.180, 镜筒, 0, 轴Y, -0.068, 22);
    环Z(0.0168, 0.0012, 镜筒暗, 0, 轴Y, -0.030, 20);           // 滚花环×2
    环Z(0.0168, 0.0012, 镜筒暗, 0, 轴Y, -0.110, 20);
    /* 物镜钟形（往前张开到 24mm，z -0.158 ~ -0.228） */
    筒(0.0240, 0.0168, 0.070, 镜筒, 0, 轴Y, -0.193, 24);
    环Z(0.0242, 0.0022, 蓝, 0, 轴Y, -0.224, 24);               // 物镜蓝环
    /* 遮光罩（短喇叭，不再是大喇叭） */
    筒(0.0270, 0.0242, 0.036, 镜筒暗, 0, 轴Y, -0.244, 24);
    环Z(0.0270, 0.0018, 镜钢, 0, 轴Y, -0.261, 24);
    /* 镜片：物镜一片 + 目镜一片（极低透明，只留镀膜反光） */
    var 玻材 = new THREE.MeshBasicMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0.055,
      depthWrite: false, side: THREE.DoubleSide
    });
    /* 【1.10.14】镜片改成 RingGeometry 圆环：原来用薄圆柱 = 两片半透明实心盖片，
       叠在光轴上。现在中间完全空，只剩一圈极淡的镀膜反光，看得出镜片又不挡视野。 */
    (function () {
      var 片 = [[0.0225, 0.0212, -0.250, 22], [0.0170, 0.0158, 0.098, 20]];
      for (var q = 0; q < 片.length; q++) {
        var r = new THREE.Mesh(new THREE.RingGeometry(片[q][1], 片[q][0], 片[q][3]), 玻材);
        r.position.set(0, 轴Y, 片[q][2]); g.add(r);
      }
    })();
    /* 消光螺纹两道（从物镜口看进去的纵深） */
    环Z(0.0220, 0.0010, 镜筒暗, 0, 轴Y, -0.236, 20);
    环Z(0.0190, 0.0010, 镜筒暗, 0, 轴Y, -0.176, 20);

    /* 【1.10.15】镜内悬浮准星：CanvasTexture 画在圆形薄片上，真几何挂在镜筒里。
       ⚠️ 不是屏幕准星（那个在 aimProgress>0.6 会隐藏），而是"透过镜子看到的分划"，
          和镜筒一起随枪运动 —— 这才是瞄准镜里的十字线。
       位置 z=-0.152（主镜管前段），半径 0.0158；眼到分划 ≈ 0.245+0.152 = 0.397m，
       端点角 ≈ 2.17° —— 配合 adsFov 4.7°（16 倍），端点落在屏幕半高 93%，上下几乎贴边。
       画法照纪念枪：细十字四段 + 中心空点 + 下半密位刻度 + 引力蓝配色。 */
    (function () {
      var c = document.createElement('canvas'); c.width = 256; c.height = 256;
      var x = c.getContext('2d');
      x.strokeStyle = 'rgba(150,224,255,0.92)'; x.lineWidth = 2.0; x.lineCap = 'round';
      var G = 18, L = 104;
      x.beginPath();
      x.moveTo(128, 128 - G); x.lineTo(128, 128 - G - L);       // 上
      x.moveTo(128, 128 + G); x.lineTo(128, 128 + G + L);       // 下（【1.10.16】与上端对称，贴屏幕下沿）
      x.moveTo(128 - G, 128); x.lineTo(128 - G - L, 128);       // 左
      x.moveTo(128 + G, 128); x.lineTo(128 + G + L, 128);       // 右
      x.stroke();
      /* 中心留一个空心圈（"悬浮准星"的视觉核心，比实心点更容易看清目标） */
      x.lineWidth = 2.4; x.beginPath(); x.arc(128, 128, 5.5, 0, 6.29); x.stroke();
      /* 下半密位刻度：左右各四道，长短交替 */
      x.lineWidth = 1.4;
      for (var i = 1; i <= 4; i++) {
        var yy = 128 + G + i * 17, w2 = (i % 2 === 0) ? 9 : 5;
        x.beginPath(); x.moveTo(128 - w2, yy); x.lineTo(128 + w2, yy); x.stroke();
      }
      /* 左右细密位（测距用） */
      for (var j = 1; j <= 3; j++) {
        var xx = 128 + G + j * 20, h2 = (j % 2 === 0) ? 7 : 4;
        x.beginPath(); x.moveTo(xx, 128 - h2); x.lineTo(xx, 128 + h2); x.stroke();
        x.beginPath(); x.moveTo(256 - xx, 128 - h2); x.lineTo(256 - xx, 128 + h2); x.stroke();
      }
      var 片 = new THREE.Mesh(new THREE.CircleGeometry(0.0158, 30),
        new THREE.MeshBasicMaterial({
          map: new THREE.CanvasTexture(c), transparent: true,
          depthWrite: false, side: THREE.DoubleSide
        }));
      片.position.set(0, 轴Y, -0.152);
      片.renderOrder = 2;               // 压在镜片反光之上
      g.add(片);
    })();
    /* 调节旋塔：顶部高低 + 右侧风偏（垫圈 + 塔身 + 顶盖 + 蓝点） */
    cy(0.0115, 0.0115, 0.006, 镜筒暗, 0, 轴Y + 0.018, -0.068, 0, 14);   // 顶塔垫圈
    cy(0.0102, 0.0102, 0.020, 镜筒, 0, 轴Y + 0.030, -0.068, 0, 14);     // 顶塔身
    cy(0.0112, 0.0112, 0.005, 镜钢, 0, 轴Y + 0.042, -0.068, 0, 14);     // 顶塔盖
    cy(0.0028, 0.0028, 0.003, 蓝, 0, 轴Y + 0.046, -0.068, 0, 8);        // 塔顶蓝点
    横cy(0.0102, 0.018, 镜筒, 0.026, 轴Y, -0.068, 14);                  // 侧塔身
    横cy(0.0112, 0.005, 镜钢, 0.037, 轴Y, -0.068, 14);                  // 侧塔盖
    /* 两道环形镜座：环套筒 + 短桥 + 压导轨夹具（这才是"镜子架在枪上"的样子） */
    var 座Z = [0.010, -0.140];
    for (var i = 0; i < 2; i++) {
      环Z(0.0185, 0.0028, 深空暗, 0, 轴Y, 座Z[i], 22).userData.adsHide = 1;
      var 桥底 = 0.0575, 桥顶 = 轴Y - 0.0185 + 0.002;
      var 桥高 = Math.max(0.006, 桥顶 - 桥底);
      bx(0.026, 桥高, 0.024, 深空, 0, 桥底 + 桥高 / 2, 座Z[i]).userData.adsHide = 1;
      bx(0.032, 0.010, 0.028, 深空暗, 0, 0.0600, 座Z[i]).userData.adsHide = 1;
      bx(0.034, 0.0025, 0.030, 钢, 0, 0.0540, 座Z[i]).userData.adsHide = 1;
    }
    /* 旋塔在开镜视野里也是两个黑疙瘩 → 同样让位 */
    for (var t = g.children.length - 1; t >= _镜件起; t--) {
      var m = g.children[t];
      if (m.isMesh && (Math.abs(m.position.z + 0.068) < 0.001) &&
          (Math.abs(m.position.x) > 0.001 || m.position.y > 轴Y + 0.005)) m.userData.adsHide = 1;
    }
  })();
  /* 收进 Group：供 js/24「开镜功能件同步」整组遍历 */
  (function () {
    var 镜组 = new THREE.Group(); var 移 = [];
    for (var i = _镜件起; i < g.children.length; i++) 移.push(g.children[i]);
    for (var j = 0; j < 移.length; j++) { g.remove(移[j]); 镜组.add(移[j]); }
    g.add(镜组);
    g.userData._镜组 = 镜组;
    /* 开镜时的可见性（镜筒 16.5mm @0.245m = 3.9° < 屏幕半角 9°，且单面材质从里看穿）：
       镜筒/镜身/镜片全部保留 —— 用户要"镜子还在枪上"；
       让位的只有：两个镜座（在屏幕下缘是两个黑团）+ 两个旋塔（上/右黑疙瘩）。 */
  })();

  /* ================= 六、弹匣井 / 握把 / 扳机 / 枪托 ================= */
  /* 弹匣井（咬住弹匣，不留缝） */
  bx(0.050, 0.046, 0.074, 深空暗, 0, -0.048, -0.055);
  bx(0.054, 0.008, 0.078, 深空, 0, -0.086, -0.055);
  bx(0.006, 0.040, 0.070, 深空, -0.026, -0.048, -0.055);
  bx(0.006, 0.040, 0.070, 深空, 0.026, -0.048, -0.055);
  /* 手枪握把（带指槽） */
  bx(0.032, 0.100, 0.040, 深空, 0, -0.078, 0.060, -0.24);
  bx(0.034, 0.010, 0.044, 深空暗, 0, -0.126, 0.084, -0.24);
  bx(0.033, 0.006, 0.006, 深空暗, 0, -0.058, 0.039, -0.24);
  bx(0.033, 0.006, 0.006, 深空暗, 0, -0.080, 0.046, -0.24);
  /* 扳机护圈 + 扳机 + 保险 */
  bx(0.008, 0.040, 0.006, 深空暗, 0, -0.056, 0.028);
  bx(0.008, 0.006, 0.052, 深空暗, 0, -0.076, 0.002);
  bx(0.008, 0.034, 0.006, 深空暗, 0, -0.060, -0.024);
  bx(0.010, 0.026, 0.008, 钢, 0, -0.048, 0.010, 0.22);
  bx(0.008, 0.010, 0.024, 钢暗, 0.024, -0.014, 0.052);
  /* 枪托：顶线压在机匣顶（0.047）以下，四段收腰 */
  bx(0.044, 0.048, 0.070, 深空, 0, 0.004, 0.152);              // 托颈
  bx(0.046, 0.054, 0.110, 深空, 0, 0.000, 0.228);              // 托身
  bx(0.040, 0.014, 0.112, 深空, 0, 0.034, 0.226);              // 托腮板（顶 0.041 < 机匣顶）
  bx(0.042, 0.005, 0.114, 月岩暗, 0, 0.043, 0.226);            // 托腮月岩上沿
  bx(0.048, 0.066, 0.020, 月岩, 0, 0.000, 0.296);              // 托底（月岩色）
  bx(0.050, 0.070, 0.009, 深空暗, 0, 0.000, 0.310);            // 托底橡胶垫
  bx(0.048, 0.010, 0.080, 深空暗, 0, -0.028, 0.232);           // 托下握槽（侧影收腰）
  cy(0.005, 0.005, 0.012, 钢暗, 0.026, 0.006, 0.284, 0, 10);   // 托长调节钮
  环Z(0.0075, 0.0018, 钢, -0.024, -0.012, 0.288, 12);          // 背带环

  /* ================= 七、月球挂饰（缩到 18mm，挂护木底轨） ================= */
  (function () {
    var 挂 = new THREE.Group();
    挂.position.set(0.000, -0.062, -0.240);
    var 环1 = new THREE.Mesh(new THREE.TorusGeometry(0.0050, 0.0013, 6, 12), 钢);
    环1.rotation.x = 天顶; 挂.add(环1);
    var 绳 = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.026, 6), 钢暗);
    绳.position.set(0, 0.016, 0); 挂.add(绳);
    var 月 = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), 月面);
    月.position.set(0, -0.012, 0); 挂.add(月);
    var 坑表 = [[0.007, 0.001, -0.013, 0.0054], [-0.006, -0.005, -0.013, 0.0038],
    [0.001, -0.012, -0.010, 0.0030], [0.010, -0.010, -0.009, 0.0026]];
    for (var i = 0; i < 坑表.length; i++) {
      var k = new THREE.Mesh(new THREE.SphereGeometry(坑表[i][3], 8, 6), 月坑);
      k.position.set(坑表[i][0], -0.012 + 坑表[i][1], 坑表[i][2]); 挂.add(k);
    }
    var 点 = new THREE.Mesh(new THREE.SphereGeometry(0.0018, 6, 5), 蓝);
    点.position.set(-0.007, 0.002, -0.014); 挂.add(点);
    挂.traverse(function (o) { o.raycast = function () { }; });
    g.add(挂); g.userData._挂饰 = 挂;
  })();

  /* ================= 八、持枪手 ================= */
  var 手组 = new THREE.Group();
  if (typeof buildRightHand === 'function')
    buildRightHand(手组, new THREE.Vector3(0.038, -0.066, 0.066), new THREE.Vector3(0.120, -0.072, 0.300));
  g.add(手组); g.userData._右手 = 手组;

  _标静态(g);
  g.userData._引力枪 = 1;
}

/* ==================== 三、弹匣（8 发短直匣，月岩 + 能量条） ==================== */
function _建引力弹匣() {
  /* 【1.10.10】用户："放了三块方块就说自己是弹夹" —— 重做。
     结构照真弹匣：外壳四面（前后+左右，中间是真空腔）+ 8 发可见子弹 + 托弹板 + 底板 + 卡榫 + 侧面观察窗。 */
  var 组 = new THREE.Group(); 组.name = 'magazine';
  var 壳 = new THREE.MeshLambertMaterial({ color: 0xc3cbd4 });        // 月岩灰
  var 壳暗 = new THREE.MeshLambertMaterial({ color: 0x8d97a3 });
  var 壳深 = new THREE.MeshLambertMaterial({ color: 0x5d6672 });
  var 蓝m = new THREE.MeshBasicMaterial({ color: 0x6ec8ff });
  var 铜 = new THREE.MeshLambertMaterial({ color: 0xb08a4a });        // 弹壳
  var 铅 = new THREE.MeshLambertMaterial({ color: 0x9aa4b2 });        // 弹头

  var 宽 = 0.044, 高 = 0.112, 厚 = 0.050;
  /* 外壳四面（左右侧板 + 前后挡板），中间留空腔放子弹 */
  var 左 = new THREE.Mesh(new THREE.BoxGeometry(0.004, 高, 厚), 壳); 左.position.set(-宽 / 2 + 0.002, -0.062, -0.018); 组.add(左);
  var 右 = new THREE.Mesh(new THREE.BoxGeometry(0.004, 高, 厚), 壳); 右.position.set(宽 / 2 - 0.002, -0.062, -0.018); 组.add(右);
  var 前 = new THREE.Mesh(new THREE.BoxGeometry(宽, 高, 0.004), 壳暗); 前.position.set(0, -0.062, -0.018 - 厚 / 2 + 0.002); 组.add(前);
  var 后 = new THREE.Mesh(new THREE.BoxGeometry(宽, 高, 0.004), 壳暗); 后.position.set(0, -0.062, -0.018 + 厚 / 2 - 0.002); 组.add(后);
  /* 顶部喂弹口（缩口，接机匣） */
  var 口 = new THREE.Mesh(new THREE.BoxGeometry(宽 - 0.008, 0.014, 厚 - 0.010), 壳深);
  口.position.set(0, -0.004, -0.018); 组.add(口);
  /* 底板 + 底沿凸台 */
  var 底 = new THREE.Mesh(new THREE.BoxGeometry(宽 + 0.006, 0.012, 厚 + 0.006), 壳深);
  底.position.set(0, -0.122, -0.018); 组.add(底);
  var 底沿 = new THREE.Mesh(new THREE.BoxGeometry(宽 + 0.002, 0.005, 厚 + 0.002), 壳暗);
  底沿.position.set(0, -0.116, -0.018); 组.add(底沿);
  /* 托弹板（弹簧顶板，浅色一片） */
  var 托 = new THREE.Mesh(new THREE.BoxGeometry(宽 - 0.012, 0.006, 厚 - 0.012), 壳暗);
  托.position.set(0, -0.026, -0.018); 组.add(托);

  /* 8 发子弹：双排交错（能看见最上面两发 + 侧面窗里的排布） */
  (function () {
    var 弹R = 0.0042, 壳长 = 0.026;
    for (var i = 0; i < 8; i++) {
      var 左排 = (i % 2 === 0);
      var x = 左排 ? -0.009 : 0.009;
      var y = -0.040 - i * 0.0105;
      var 壳m = new THREE.Mesh(new THREE.CylinderGeometry(弹R, 弹R, 壳长, 8), 铜);
      壳m.position.set(x, y, -0.018); 组.add(壳m);
      var 头 = new THREE.Mesh(new THREE.ConeGeometry(弹R * 0.92, 0.012, 8), 铅);
      头.position.set(x, y + 壳长 / 2 + 0.005, -0.018); 组.add(头);
    }
  })();
  /* 侧面观察窗（左右各一道细长蓝窗，能透出里面的子弹轮廓） */
  var 窗L = new THREE.Mesh(new THREE.BoxGeometry(0.0018, 0.070, 0.012), 蓝m);
  窗L.position.set(-宽 / 2 + 0.0004, -0.066, -0.018); 组.add(窗L);
  var 窗R = 窗L.clone(); 窗R.position.x = 宽 / 2 - 0.0004; 组.add(窗R);
  /* 卡榫（侧面凸起的小块，插进枪的那一下能看见它咬合） */
  var 榫 = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.014), 壳深);
  榫.position.set(-宽 / 2 - 0.002, -0.030, -0.018); 组.add(榫);
  /* 底部铭牌位（一道深色横条，不加文字） */
  var 条 = new THREE.Mesh(new THREE.BoxGeometry(宽 - 0.010, 0.004, 0.003), 壳深);
  条.position.set(0, -0.104, -0.018 - 厚 / 2 + 0.001); 组.add(条);
  return 组;
}

/* 包装 buildMagazineGroup：只接管 magType==='gravity' */
(function () {
  if (typeof buildMagazineGroup !== 'function') return;
  var _原建匣 = buildMagazineGroup;
  buildMagazineGroup = function (def, magLv) {
    if (def && def.magType === 'gravity') return _建引力弹匣();
    return _原建匣.apply(this, arguments);
  };
})();

/* ==================== 四、def 注册 ==================== */
BUILTIN_GUNS[GRAVITY_SLOT] = {
  name: 引力枪皮名, icon: '🌑', note: '月球主题 · 高倍狙 · ' + 引力皮价 + ' 枪皮币',
  引力: true,
  /* 用户口径：伤害 ×4、弹夹 8 发、狙击枪、装弹慢、每枪拉栓 */
  damage: 4.0, magSize: 8, fireRate: 1500, reloadTime: 4200, recoilMul: 1.30,
  /* 腰射散布 0.085（≈6°）—— 狙击枪不开镜本来就该打不中（用户："不开镜根本就玩不了的那一种"）。
     开镜靠 adsSpreadKeep:0 把散布清成 0，一枪一个准。
     ⚠️ 上一版写 0.0035，比步枪（0.016）还准，等于腰射也能当连狙用。 */
  range: 170, pellets: 1, spread: 0.085, auto: false,
  /* 开镜：adsFov 24 ≈ 3.1 倍（和纪念枪同档）。
     ⚠️ 上一版 18（4.2 倍）视野窄到只剩一根枪管，被用户点名"开镜是啥东西"。
     ⚠️ 上一版还把瞄镜整组打了 userData.scope → 开镜瞬间镜子被隐藏，更没法看。
     现在瞄镜是真镜筒（不标 scope），aimPos 把目镜推到眼前 0.135 米，镜筒内壁自己框视野。 */
  /* 【1.10.11】倍率 3.1 → **4.2 倍**（用户："把那个放大倍率调大"）。
     scopeView 仍关掉：开镜不做镜内圆遮罩 —— 目镜孔径半角（11.7°）比屏幕半角（8.9°）大，
     遮罩本来就盖不到屏幕里；而一旦打开，它要求一套镜内分划几何，做不齐反而添乱。
     现在的观感就是"透过中空镜筒看出去"，干净且不挡。 */
  /* 【1.10.16】极限倍率：adsFov 4.7 ≈ 16 倍。准星片离眼 0.397m、端点角 2.17°，
     fov 4.7° 时端点落在屏幕半高 93% —— 上下端几乎贴边，符合用户口径。 */
  adsFov: 4.7, adsSpreadKeep: 0, scopeView: false, reticle: 'gravity',
  inspect: true,
  /* 拉栓：开一枪必须拉一次，拉完才能下一发 */
  boltAction: true, boltTime: 780,
  /* 换弹 / 检视：这两个交给 js/24 按标记走专属动画 */
  reloadAnim: 'gravity', inspectAnim: 'float',
  magType: 'gravity', magPos: { x: 0, y: -0.014, z: -0.055 },   /* 上提 1.6cm：原来顶上留着一道缝，像没插到底 */
  gripPos: { x: 0.176, y: -0.224, z: -0.430 },
  /* 【1.10.11】瞄镜组 scale 0.85 + 下移 1.2cm 之后，光轴从 y=0.098 变成 0.071、
     目镜后沿从 z=+0.120 变成 +0.112 → aimPos 跟着重算：
       y=-0.071 把光轴压到眼睛高度；z=-(0.112+0.135)=-0.247 让目镜离眼 13.5cm。 */
  aimPos: { x: 0, y: -0.096, z: -0.245 },   /* 【1.10.13】新镜光轴 0.096 / 目镜后沿 0.108 / 眼距 0.135 */
  lhPos: { x: -0.044, y: -0.098, z: -0.215 },
  枪皮: 引力枪皮名, 皮价: 引力皮价,
  build: _建引力枪
};
引力刷新锁();

/* ==================== 五、拉栓：开一枪必须拉一次 ==================== */
var 引力_上一刻 = 0;
function 引力_是当前枪() {
  try { var d = activeGunDef(); return !!(d && d.引力); } catch (e) { return false; }
}
/* 包装 attack：拉栓中不许开火；真的打出一发 → 进入拉栓 */
(function () {
  if (typeof attack !== 'function') return;
  var _原射击 = attack;
  attack = function () {
    if (引力_是当前枪() && S.boltT > 0) return;          /* 拉栓没拉完，扣扳机没反应 */
    var 弹前 = S.ammo;
    var r = _原射击.apply(this, arguments);
    if (引力_是当前枪() && S.ammo < 弹前) {              /* 确实打出了一发（不是空挂/哑火） */
      var d = activeGunDef();
      S.boltT = Math.max(0.15, ((d && d.boltTime) || 780) / 1000);
      S.boltDur = S.boltT;
      try { if (typeof playBoltPull === 'function') playBoltPull(); } catch (e) { }
    }
    return r;
  };
})();
/* 每帧推进：按剩余时间驱动右手拉机柄 */
(function () {
  if (typeof updatePlayer !== 'function') return;
  var _原更新 = updatePlayer;
  updatePlayer = function () {
    var r = _原更新.apply(this, arguments);
    try { 引力_拉栓Tick(); } catch (e) { }
    return r;
  };
})();
function 引力_拉栓Tick() {
  /* 换掉这把枪（切刀 / 切别的枪）时，拉栓状态立刻作废，否则切回来还卡着 */
  if (!引力_是当前枪()) {
    if (S.boltT > 0 || S.boltWas) {
      S.boltT = 0; S.boltWas = false;
      try { _右手拉栓(0, 0); _拉机柄动(0); } catch (e) { }
    }
    return;
  }
  if (!(S.boltT > 0)) {
    if (S.boltWas) { S.boltWas = false; try { _右手拉栓(0, 0); _拉机柄动(0); } catch (e) { } }
    return;
  }
  var now = performance.now();
  var dt = 引力_上一刻 ? Math.min(0.1, (now - 引力_上一刻) / 1000) : 0.016;
  引力_上一刻 = now;
  S.boltT = Math.max(0, S.boltT - dt);
  var 总 = S.boltDur || 0.78;
  var p = Math.min(1, 1 - S.boltT / 总);                 // 0→1 拉栓进度
  /* 抓柄(0.05~0.85) → 后拉(0.30~0.62 到顶) → 松手(0.62 后回落) */
  var 抓 = (p > 0.05 && p < 0.88) ? 1 : 0;
  var 拉 = 0;
  if (p > 0.28 && p < 0.44) 拉 = (p - 0.28) / 0.16;
  else if (p >= 0.44 && p < 0.58) 拉 = 1;
  else if (p >= 0.58 && p < 0.74) 拉 = 1 - (p - 0.58) / 0.16;
  拉 = Math.max(0, Math.min(1, 拉));
  try { _右手拉栓(抓, 拉); _拉机柄动(拉); } catch (e) { }
  S.boltWas = true;
  if (S.boltT <= 0) { try { if (typeof playBoltSlam === 'function') playBoltSlam(); } catch (e) { } }
}

/* ==================== 七、检视：抛向空中 → 悬浮在正前方旋转 → 接回 ====================
   只在 def.inspectAnim==='float' 时由 js/24 的 _检视推进 调进来（p = 检视进度 0~1）。
   位置用相机局部坐标（weaponGroup 在 recoilPivot 里，原点就是眼睛），
   "玩家的正中间" = x0 / 略高于光轴 / 前伸约 0.6 米。 */
var 引力_检视上次 = 0;
function 引力_检视平滑(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
function 引力_检视姿态(p, base) {
  var bx = base ? base.x : 0.18, by = base ? base.y : -0.22, bz = base ? base.z : -0.45;
  var x, y, z, rx, ry, rz;
  /* 【1.10.10】悬浮点往外挪到 0.82 米 —— 枪全长 1.02 米，0.6 米处会顶到脸、只看得见机匣。
     旋转从 2.1 圈降到 1 圈（用户："转的那么快"）。 */
  var 中Y = 0.048, 中Z = -0.82;
  if (p < 0.14) {                                /* 抛出：从手心窜上去 */
    var t = 引力_检视平滑(p / 0.14);
    x = bx + (0 - bx) * t;
    y = by + (中Y - by) * t;
    z = bz + (中Z - bz) * t;
    rx = -0.16 * t; ry = 0.30 * t; rz = 0.08 * t;
  } else if (p < 0.22) {                         /* 到顶，开始悬浮 */
    var t2 = 引力_检视平滑((p - 0.14) / 0.08);
    x = 0; y = 中Y + 0.022 * t2; z = 中Z - 0.02 * t2;
    rx = -0.16; ry = 0.30 + 0.45 * t2; rz = 0.08 - 0.08 * t2;
  } else if (p < 0.70) {                         /* 悬浮在正中间旋转（一圈）＋轻浮 */
    var t3 = (p - 0.22) / 0.48;
    x = Math.sin(t3 * Math.PI) * 0.018;
    y = 中Y + 0.022 + Math.sin(t3 * Math.PI * 2) * 0.020;
    z = 中Z - 0.02;
    rx = -0.14 + Math.sin(t3 * Math.PI * 2) * 0.055;
    ry = 0.55 + t3 * Math.PI * 2.0;          /* 整段转一圈（原 2.1 圈） */
    rz = Math.sin(t3 * Math.PI * 2.5) * 0.10;
  } else if (p < 0.88) {                         /* 落回手心 */
    var t4 = 引力_检视平滑((p - 0.70) / 0.18);
    x = 0 + (bx - 0) * t4;
    y = (中Y + 0.022) + (by - (中Y + 0.022)) * t4;
    z = (中Z - 0.02) + (bz - (中Z - 0.02)) * t4;
    rx = -0.14 * (1 - t4); ry = (0.75 + Math.PI * 2.1) * (1 - t4); rz = 0.10 * (1 - t4);
  } else {                                       /* 收尾：回到正常持握 */
    x = bx; y = by; z = bz; rx = 0; ry = 0; rz = 0;
  }
  weaponGroup.position.set(x, y, z);
  weaponGroup.rotation.set(rx, ry, rz);
  weaponGroup.visible = true;
  /* 【1.10.10】枪飞起来时左手必须彻底离开画面。
     ⚠️ 上一版只设 visible=false —— leftHandAnchor 是 weaponGroup 的子节点，
        updateLeftHand 每帧都会把它设回 visible=true，于是"左手跟着枪一起飞"（用户报的现象）。
        现在**直接把它挪到画面外**（枪局部 y=-3），visible 也关，双保险。 */
  try {
    if (typeof leftHandAnchor !== 'undefined' && leftHandAnchor) {
      leftHandAnchor.position.set(0, -3, -1);
      leftHandAnchor.visible = false;
    }
    if (typeof _holdHand !== 'undefined' && _holdHand) _holdHand.visible = false;
    var _rh = weaponGroup.userData._右手;
    if (_rh) _rh.visible = true;
  } catch (e) { }
  /* 检视期间强制退出开镜：否则枪一边飞一边保持 adsFov，画面像被望远镜怼住 */
  try {
    if (S.aiming || S.aimProgress > 0) {
      S.aiming = false; S.aimProgress = 0;
      camera.fov = 75; camera.updateProjectionMatrix();
    }
  } catch (e) { }
}

/* ==================== 八、换弹：弹夹从屏幕左侧飘来、左手伸过去接 ====================
   时间轴（a = 换弹进度）：
     0.26~0.40  左手向屏幕左侧伸出去
     0.34       弹夹从画面左外飘入
     0.40~0.50  弹夹飞到左手心
     0.50       交接给左手（attach 保持世界变换，不跳）
     0.48~0.62  手带着弹夹收回枪身
   飞匣挂在相机下（不是 weaponGroup），这样它才能在"枪之外"飞。 */
var 引力_飞匣 = null;
function 引力_飞匣挂载中() { return !!(引力_飞匣 && 引力_飞匣.挂载); }
function 引力_飞匣开始(mag) {
  if (!mag) return false;
  try {
    if (引力_飞匣 && 引力_飞匣.obj && 引力_飞匣.obj.parent) 引力_飞匣.obj.parent.remove(引力_飞匣.obj);
  } catch (e) { }
  引力_飞匣 = { obj: mag, 挂载: true, t: 0, 出发: false };
  /* 起点：画面左侧外（相机局部） */
  camera.add(mag);
  mag.position.set(-0.62, -0.30, -0.80);
  mag.rotation.set(0.35, 0.9, 0.45);
  mag.scale.setScalar(1);
  return true;
}
function 引力_飞匣Tick(a) {
  var F = 引力_飞匣; if (!F || !F.挂载) return;
  /* 换弹结束/被取消 → 飞匣直接清掉，别留在画面上 */
  if (!S.reloading) { 引力_飞匣清理(); return; }
  var o = F.obj; if (!o || !o.parent) { 引力_飞匣 = null; return; }
  /* 【1.10.10】飞行区间 0.42→0.56：弹匣本来就是 a=0.42 才创建，
     上一版按 0.34 起算 → 一出现就已在半路，看不出"从左边飘来"。 */
  var t = (a - 0.42) / 0.14;
  t = Math.max(0, Math.min(1, t));
  var k = 引力_检视平滑(t);
  var 起x = -0.62, 起y = -0.30, 起z = -0.80;
  var 止x = -0.255, 止y = -0.290, 止z = -0.520;
  o.position.set(起x + (止x - 起x) * k, 起y + (止y - 起y) * k + Math.sin(k * Math.PI) * 0.035,
    起z + (止z - 起z) * k);
  /* 一路转正（飘过来的时候是歪的，快到手里时已经扶正） */
  o.rotation.set(0.35 * (1 - k) + 0.35 * k * 0.4, 0.9 * (1 - k), 0.45 * (1 - k));
}
function 引力_飞匣交接(anchor, mag) {
  var F = 引力_飞匣; if (!F || !F.挂载) return;
  try {
    anchor.attach(mag);                       /* attach 保持世界变换 → 视觉上不跳 */
    mag.position.set(0.010, -0.026, -0.020);
    mag.rotation.set(0.5, 0, 0.3);
  } catch (e) {
    try { anchor.add(mag); mag.position.set(0.010, -0.026, -0.020); mag.rotation.set(0.5, 0, 0.3); } catch (e2) { }
  }
  F.挂载 = false; F.obj = null;
}
function 引力_飞匣清理() {
  var F = 引力_飞匣; if (!F) return;
  if (F.挂载 && F.obj && F.obj.parent) { try { F.obj.parent.remove(F.obj); } catch (e) { } }
  引力_飞匣 = null;
}
/* 左手向画面左侧伸（由 js/24 在设完普通换弹手位之后调，覆盖成"够过去"） */
function 引力_手偏移(a) {
  if (!引力_是当前枪()) return;
  var t = 0;
  /* 【1.10.10】和飞匣对齐：弹匣 0.42 才出现、0.56 到手，手要在这段伸出去等它 */
  if (a >= 0.34 && a < 0.46) t = (a - 0.34) / 0.12;
  else if (a >= 0.46 && a < 0.56) t = 1;
  else if (a >= 0.56 && a < 0.70) t = 1 - (a - 0.56) / 0.14;
  if (t <= 0) return;
  var k = 引力_检视平滑(t);
  try {
    leftHandAnchor.position.x -= 0.255 * k;      /* 枪局部 -x = 屏幕左侧 */
    leftHandAnchor.position.y += 0.035 * k;
    leftHandAnchor.position.z += 0.075 * k;
    leftHandAnchor.visible = true;
  } catch (e) { }
}

/* ==================== 六、对外 ==================== */
try {
  window.引力枪皮 = {
    名: 引力枪皮名, 槽: GRAVITY_SLOT, 价: 引力皮价,
    已解锁: 引力已解锁, 解锁: 引力解锁, 刷新锁: 引力刷新锁, 购买: 引力购买尝试,
    装备: function () { try { curGun = GRAVITY_SLOT; currentWeapon = WEAPON_GUN; rebuildWeaponModel(); } catch (e) { } }
  };
} catch (e) { }
