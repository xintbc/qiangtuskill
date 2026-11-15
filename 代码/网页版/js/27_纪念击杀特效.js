// ==================== 【batch215】纪念枪击杀特效 ====================
/* 只有手持「长明」（activeGunDef().memorial）并且**是自己完成击杀**时才播：
   ① 屏幕右侧中部：黑金累计击杀卡 —— 滑入、数字弹一下、" +1 " 上飘、2.2 秒后收回。
      **不分模式**：单人打 AI、多人打真人都算，对着"这一局一共杀了几个"。
   ② 死者头顶上方：一块悬浮 LCD 终端 —— 逐字打出死者 ID，稳定 3 秒后整块 ERROR 闪烁，
      再上飘淡出消失。**只有多人模式才出现**（单人打的是 AI，没有"敌人 ID"可播）。

   ── 实现上的三个取舍 ──
   ① **不进主循环**：loop() 在暂停/阵亡时是 early-return 的，而这些是短命特效（最多 4.6 秒）。
      自己用 requestAnimationFrame 自调度：有东西在动才跑，跑完立刻停（空转成本 = 0）。
   ② **canvas 不每帧重绘**：一块 256×128 的 CanvasTexture 每帧上传约 128KB，三块屏就是
      400KB/帧。所以扫描线用一根**几何光条**自己上下跑，canvas 只在「字变了 / 该反相了」时重画。
   ③ **屏按距离轻度放大**：世界尺寸固定 1 米宽，20 米外只有几十像素、字根本看不清。
      按距离做非等比补偿（近处不夸张、远处还能读），不是简单的 sizeAttenuation 关掉。

   ⚠️ 铁律：跨分片调用一律 typeof 守卫。本分片排在 js/26 之后、js/30 之前。 */

var MK = {
  目标: 0, 显示: 0, 收T: 0,          // 计数：目标值 / 当前滚到的值 / 剩下的显示秒数
  lcd: [], 上限: 3,                  // 同时最多 3 块屏（再多就换掉最老的）
  序: 1,
  _geo: null, _晕tex: null,
  _raf: 0, _last: 0
};

/* 手持的是不是纪念枪 */
function _MK枪皮在用() {
  try {
    if (typeof activeGunDef !== 'function') return false;
    var d = activeGunDef();
    return !!(d && d.memorial);
  } catch (e) { return false; }
}

/* ---------- ① 击杀计数卡（屏幕空间） ---------- */

function _MK计数到(n) {
  if (typeof n === 'number' && isFinite(n)) {
    if (n > MK.目标) MK.目标 = n;
  }
  var el = document.getElementById('memKill');
  if (!el) return;
  /* 重启 CSS 动画：先移除类，强制一次 reflow，再加回去 */
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
  el.classList.add('on');
  var bar = document.getElementById('memKillBar');
  if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = 'mkBar 2.2s linear forwards'; }
  MK.收T = 2.2;
  _MK踢一次();
}

function _MK计数帧(dt) {
  var num = document.getElementById('memKillNum');
  if (num) {
    if (MK.显示 < MK.目标) {
      /* 低帧率下也要在 0.35 秒内追到（别写死每帧 +1，2fps 会滚成幻灯片） */
      var 差 = MK.目标 - MK.显示;
      MK.显示 += Math.max(差 * Math.min(1, dt * 11), Math.max(0.5, dt * 26));
      if (MK.显示 > MK.目标) MK.显示 = MK.目标;
    }
    var s = String(Math.round(MK.显示));
    if (num.textContent !== s) num.textContent = s;
  }
  if (MK.收T > 0) {
    MK.收T -= dt;
    if (MK.收T <= 0) {
      var el = document.getElementById('memKill');
      if (el) el.classList.remove('on', 'go');
    }
  }
}

function _MK计数复位() {
  MK.目标 = 0; MK.显示 = 0; MK.收T = 0;
  var el = document.getElementById('memKill');
  if (el) el.classList.remove('on', 'go');
  var num = document.getElementById('memKillNum');
  if (num) num.textContent = '0';
}

/* ---------- ② 悬浮 LCD 屏（世界空间） ---------- */

function _MK几何() {
  if (MK._geo) return MK._geo;
  /* ⚠️ 尺寸是照着"7~10 米外 ID 要能读"定的：1.6 米宽的屏 + 按距离补偿之后，
     10 米处大约占屏宽 16%（≈205px），40px 的 ID 字还认得出来。
     最早做成 1.0 米宽时，实测在 8 米外只有 70px 宽 —— ID 完全看不清。 */
  MK._geo = {
    板: new THREE.BoxGeometry(1.72, 0.92, 0.035),
    屏: new THREE.PlaneGeometry(1.60, 0.80),
    扫: new THREE.PlaneGeometry(1.60, 0.080),
    晕: new THREE.PlaneGeometry(3.30, 2.05),
    杆: new THREE.CylinderGeometry(0.010, 0.010, 0.95, 5)
  };
  return MK._geo;
}

function _MK晕贴图() {
  if (MK._晕tex) return MK._晕tex;
  var c = document.createElement('canvas');
  c.width = c.height = 128;
  var x = c.getContext('2d');
  var g = x.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,232,176,0.50)');
  g.addColorStop(0.42, 'rgba(226,182,92,0.15)');
  g.addColorStop(1, 'rgba(226,182,92,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  var t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  MK._晕tex = t;
  return t;
}

/* 画一帧到 canvas。o.已绘 记着上次的关键串，没变就不重画（省纹理上传）。 */
function _MK绘(o, 强制) {
  try {
    var 错 = (o.阶段 === 'err');
    var 反 = !!o.反相;
    var 字 = (错 ? 'ERR' : o.id).toString();
    var 用字 = 错 ? 字 : 字.slice(0, o.字);
    var 倒 = (错 ? 0 : Math.max(0, 3 - o.t));
    var 键 = (错 ? 'E' : 'N') + '|' + (反 ? '1' : '0') + '|' + 用字 + '|' + (错 ? 0 : Math.floor(倒 * 10));
    if (!强制 && o.已绘 === 键) return;
    o.已绘 = 键;

    var cv = o.canvas, x = cv.getContext('2d'), W = cv.width, H = cv.height;
    /* 所有尺寸按 384×192 写；画布尺寸改了就整体等比缩放，别逐处改数字 */
    var U = W / 384;
    /* 两套配色：正常（黑底金字）/ 错误反相（金底黑字） */
    var 底 = 反 ? '#d9b45f' : '#07080b';
    var 主 = 反 ? '#0a0803' : '#f4de9e';
    var 副 = 反 ? 'rgba(10,8,3,.62)' : 'rgba(214,176,86,.72)';
    var 线 = 反 ? 'rgba(10,8,3,.55)' : 'rgba(214,176,86,.55)';

    x.fillStyle = 底; x.fillRect(0, 0, W, H);

    /* 横向扫描线（静态：一块屏一次就够，动的那根是几何光条） */
    if (!反) {
      x.fillStyle = 'rgba(0,0,0,0.22)';
      for (var y = 0; y < H; y += 4 * U) x.fillRect(0, y, W, 1.2 * U);
    }
    /* 内框 + 四角定位角 */
    x.strokeStyle = 线; x.lineWidth = 1.5 * U;
    x.strokeRect(7 * U, 7 * U, W - 14 * U, H - 14 * U);
    x.strokeStyle = 主; x.lineWidth = 3 * U;
    var 角 = 14 * U, b0 = 7 * U;
    x.beginPath();
    x.moveTo(b0, b0 + 角); x.lineTo(b0, b0); x.lineTo(b0 + 角, b0);
    x.moveTo(W - b0 - 角, b0); x.lineTo(W - b0, b0); x.lineTo(W - b0, b0 + 角);
    x.moveTo(b0, H - b0 - 角); x.lineTo(b0, H - b0); x.lineTo(b0 + 角, H - b0);
    x.moveTo(W - b0 - 角, H - b0); x.lineTo(W - b0, H - b0); x.lineTo(W - b0, H - b0 - 角);
    x.stroke();

    /* 顶部标题栏 */
    x.textAlign = 'left'; x.textBaseline = 'middle';
    x.font = 'bold ' + Math.round(12 * U) + 'px Consolas, "Courier New", monospace';
    x.fillStyle = 副;
    x.fillText('MEMORIAL FIELD TERMINAL', 15 * U, 20 * U);
    /* 右上状态点：正常=圆点，错误=方块快闪 */
    x.fillStyle = 主;
    if (错) { x.fillRect(W - 30 * U, 14 * U, 10 * U, 10 * U); }
    else { x.beginPath(); x.arc(W - 24 * U, 20 * U, 3.9 * U, 0, 6.2832); x.fill(); }
    x.strokeStyle = 线; x.lineWidth = 1.5 * U;
    x.beginPath(); x.moveTo(12 * U, 34 * U); x.lineTo(W - 12 * U, 34 * U); x.stroke();

    if (!错) {
      /* 副标题 */
      x.font = 'bold ' + Math.round(10.5 * U) + 'px Consolas, "Courier New", monospace';
      x.fillStyle = 副;
      x.fillText('SUBJECT ID', 18 * U, 50 * U);
      x.textAlign = 'right';
      x.fillText('LOCK 0x' + ('0000' + (o.码 & 0xFFFF).toString(16).toUpperCase()).slice(-4), W - 18 * U, 50 * U);
      x.textAlign = 'left';
      /* 主字：按长度自适应字号（ID 可能是中文名，也可能只有 3 个字符） */
      var n = 用字.length || 1;
      var fs = n <= 6 ? 56 : (n <= 11 ? 44 : 33);
      x.font = 'bold ' + Math.round(fs * U) + 'px Consolas, "Microsoft YaHei", "PingFang SC", monospace';
      x.fillStyle = 主;
      x.fillText(用字 + (o.字 < o.id.length && (o.t * 12 % 2 < 1) ? '_' : ''), 16 * U, 95 * U);
      /* 分隔线 + 底部信息 */
      x.strokeStyle = 线; x.lineWidth = 1.5 * U;
      x.beginPath(); x.moveTo(12 * U, 127 * U); x.lineTo(W - 12 * U, 127 * U); x.stroke();
      x.font = 'bold ' + Math.round(11 * U) + 'px Consolas, "Courier New", monospace';
      x.fillStyle = 副;
      x.fillText('TARGET CONFIRMED', 18 * U, 145 * U);
      x.textAlign = 'right';
      x.fillText('T-' + 倒.toFixed(1), W - 18 * U, 145 * U);
      x.textAlign = 'left';
      /* 3 秒倒计时进度条 */
      var bw = W - 36 * U, p = Math.max(0, Math.min(1, 1 - o.t / 3));
      x.fillStyle = 反 ? 'rgba(10,8,3,.22)' : 'rgba(214,176,86,.20)';
      x.fillRect(18 * U, 160 * U, bw, 8 * U);
      x.fillStyle = 主;
      x.fillRect(18 * U, 160 * U, bw * p, 8 * U);
      /* 微弱噪点：让屏"在发光"而不是一张贴纸 */
      for (var i = 0; i < 14; i++) {
        x.fillStyle = 'rgba(255,236,186,' + (0.05 + Math.random() * 0.10).toFixed(3) + ')';
        x.fillRect(12 * U + Math.random() * (W - 24 * U), 36 * U + Math.random() * (H - 51 * U), 2 * U, 2 * U);
      }
    } else {
      /* 错误态：大字 ERROR + 干扰带 + IDENTITY LOST */
      x.textAlign = 'center';
      x.font = 'bold ' + Math.round(52 * U) + 'px Consolas, "Courier New", monospace';
      x.fillStyle = 主;
      x.fillText('ERROR', W / 2, 82 * U);
      x.font = 'bold ' + Math.round(13.5 * U) + 'px Consolas, "Courier New", monospace';
      x.fillStyle = 副;
      x.fillText('0x' + ('0000' + (o.码 & 0xFFFF).toString(16).toUpperCase()).slice(-4) + '  IDENTITY LOST', W / 2, 117 * U);
      x.font = 'bold ' + Math.round(11 * U) + 'px Consolas, "Courier New", monospace';
      x.fillText('SEVERING UPLINK', W / 2, 144 * U);
      x.textAlign = 'left';
      /* 撕裂干扰带 */
      if (!反) {
        for (var j = 0; j < 4; j++) {
          var yy = 45 * U + Math.random() * 99 * U;
          x.fillStyle = 'rgba(244,222,158,0.85)';
          x.fillRect(Math.random() * 90 * U, yy, 60 * U + Math.random() * 180 * U, (1.5 + Math.random() * 3) * U);
        }
      }
      /* 底部碎裂条 */
      for (var k = 0; k < 24; k++) {
        x.fillStyle = 主;
        var w2 = (3 + Math.random() * 13) * U;
        x.fillRect(15 * U + Math.random() * (W - 30 * U - w2), 160 * U + Math.random() * 12 * U, w2, 3 * U);
      }
    }

    o.tex.needsUpdate = true;
  } catch (e) { }
}

function _MK销毁(o) {
  try {
    if (!o || !o.g) return;
    if (o.g.parent) o.g.parent.remove(o.g);
    /* ⚠️ 几何是共享的（_MK几何），只销毁**每块屏独占**的材质与纹理 */
    o.g.traverse(function (c) { if (c && c.material) { try { c.material.dispose(); } catch (e) { } } });
    if (o.tex) { try { o.tex.dispose(); } catch (e) { } }
  } catch (e) { }
}

function _MK建屏(id, 位置) {
  try {
    if (typeof THREE === 'undefined' || typeof scene === 'undefined' || !scene) return null;
    if (typeof camera === 'undefined' || !camera) return null;
    while (MK.lcd.length >= MK.上限) _MK销毁(MK.lcd.shift());
    var G = _MK几何();
    var g = new THREE.Group();
    g.position.copy(位置);

    var 板 = new THREE.Mesh(G.板, new THREE.MeshBasicMaterial({
      color: 0x0a0b0e, transparent: true, opacity: 1, fog: false
    }));
    g.add(板);

    var cv = document.createElement('canvas');
    /* ⚠️ 必须是 2 的幂（512×256）：384×192 在 WebGL 里是 NPOT，
       实测在 SwiftShader / 部分集显上采样会错位（字被压成几条竖线、屏整体发黑）。 */
    cv.width = 512; cv.height = 256;
    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    var 屏 = new THREE.Mesh(G.屏, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 1, depthWrite: false, fog: false
    }));
    /* ⚠️ 板厚 0.035 → 前表面在 z=+0.0175。面片必须放在它**前面**，
       之前写 0.017（正好在板内 0.5mm）→ 深度测试整块丢，屏只剩一块黑板。
       这是"改了板厚忘了改面片"的连带坑。 */
    屏.position.z = 0.021;
    g.add(屏);

    var 扫 = new THREE.Mesh(G.扫, new THREE.MeshBasicMaterial({
      color: 0xffe9b6, transparent: true, opacity: 0.10, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false
    }));
    扫.position.z = 0.025;
    g.add(扫);

    var 晕 = new THREE.Mesh(G.晕, new THREE.MeshBasicMaterial({
      map: _MK晕贴图(), transparent: true, opacity: 0.40, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false
    }));
    晕.position.z = -0.030;
    g.add(晕);

    /* 吊杆：从屏幕顶往上伸，像悬在天上的一条金索 */
    var 杆 = new THREE.Mesh(G.杆, new THREE.MeshBasicMaterial({
      color: 0xe6c46a, transparent: true, opacity: 0.50, fog: false
    }));
    杆.position.set(0, 0.875, 0);
    g.add(杆);

    scene.add(g);
    var o = {
      g: g, canvas: cv, tex: tex, 屏: 屏, 扫: 扫, 晕: 晕, 杆: 杆, 板: 板,
      id: String(id || 'UNKNOWN'), 码: ((MK.序++) * 2654435761) & 0xFFFF,
      t: 0, 阶段: 'in', 字: 0, 反相: false,
      原位: g.position.clone(), 已绘: ''
    };
    MK.lcd.push(o);
    _MK绘(o, true);
    _MK踢一次();
    return o;
  } catch (e) { return null; }
}

/* ---------- 每帧推进 ---------- */

function _MK屏帧(o, dt, now) {
  o.t += dt;
  var t = o.t;

  /* 阶段切换 */
  if (t >= 3.0 && o.阶段 !== 'err') { o.阶段 = 'err'; o.字 = o.id.length; _MK绘(o, true); }
  if (t >= 3.9) o.阶段 = 'out';

  /* 打字机：每 0.055 秒一个字（低帧率下用时间算，不按帧累加） */
  if (o.阶段 === 'in' && o.t > 0.30) {
    var 应字 = Math.min(o.id.length, Math.floor((o.t - 0.30) / 0.055) + 1);
    if (应字 !== o.字) { o.字 = 应字; }
  }

  /* 出现 / 抖动 / 消失 */
  var 淡 = 1, 缩 = 1, 升 = 0;
  if (t < 0.5) {
    var k = t / 0.5; k = k * k * (3 - 2 * k);
    缩 = 0.58 + 0.42 * k; 升 = (1 - k) * -0.30; 淡 = k;
  } else if (t >= 3.0 && t < 3.9) {
    /* 错误闪烁：每 0.10 秒反相一次 */
    var 反 = (Math.floor((t - 3.0) / 0.10) % 2) === 1;
    if (反 !== o.反相) { o.反相 = 反; _MK绘(o, true); }
  } else if (t >= 3.9) {
    var k2 = Math.min(1, (t - 3.9) / 0.70);
    升 = k2 * 0.60; 缩 = 1 - 0.18 * k2; 淡 = 1 - k2;
  }

  /* 距离轻度补偿（非等比：近处别夸张、远处还能读字） */
  var dx = 0, dz = 0, 距 = 6;
  try { dx = camera.position.x - o.原位.x; dz = camera.position.z - o.原位.z; 距 = Math.sqrt(dx * dx + dz * dz); } catch (e) { }
  缩 *= Math.max(0.88, Math.min(2.90, 0.82 + 距 * 0.095));

  var g = o.g;
  g.position.set(o.原位.x, o.原位.y + 升, o.原位.z);
  if (o.阶段 === 'err') {
    /* 抖动：整块屏错位，像信号被打断 */
    g.position.x += (Math.random() - 0.5) * 0.024;
    g.position.z += (Math.random() - 0.5) * 0.024;
  }
  g.scale.setScalar(缩);
  /* 只在水平面朝向相机（完全 billboard 会让屏跟着俯仰歪，像一张贴纸） */
  try { g.rotation.y = Math.atan2(dx, dz); } catch (e) { }

  /* 透明度统一走一遍（板/屏/杆/晕各自基准不同，按比例乘） */
  var 基准 = { 板: 1, 屏: 1, 杆: 0.50, 晕: 0.40 };
  o.板.material.opacity = 基准.板 * 淡;
  o.屏.material.opacity = 基准.屏 * 淡;
  o.杆.material.opacity = 基准.杆 * 淡;
  o.晕.material.opacity = 基准.晕 * 淡 * (o.阶段 === 'err' ? (o.反相 ? 1.6 : 0.7) : 1);

  /* 扫描线光条：正常阶段上下扫；错误阶段跟着闪 */
  o.扫.position.y = 0.40 - ((t * 0.62) % 0.80);
  o.扫.material.opacity = (o.阶段 === 'err' ? (o.反相 ? 0.05 : 0.20) : 0.11) * 淡;

  /* canvas 只在「该重画」时重绘（键没变会自己 return） */
  if (o.阶段 !== 'out') _MK绘(o, false);

  if (t >= 4.60) return false;    // 该销毁了
  return true;
}

function _MK屏推进(dt) {
  var 还有 = false;
  for (var i = MK.lcd.length - 1; i >= 0; i--) {
    var o = MK.lcd[i];
    var live = false;
    try { live = _MK屏帧(o, dt); } catch (e) { live = false; }
    if (!live) { _MK销毁(o); MK.lcd.splice(i, 1); }
    else 还有 = true;
  }
  return 还有;
}

function _MK清理() {
  for (var i = 0; i < MK.lcd.length; i++) _MK销毁(MK.lcd[i]);
  MK.lcd.length = 0;
  _MK计数复位();
}

/* ---------- 自调度循环（有东西在动才跑） ---------- */

function _MK踢一次() {
  if (MK._raf) return;
  MK._last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  MK._raf = requestAnimationFrame(_MK滴答);
}

function _MK滴答(now) {
  MK._raf = 0;
  var dt = Math.min(0.10, (now - MK._last) / 1000);
  if (!(dt > 0)) dt = 0.016;
  MK._last = now;

  /* 阵亡/退出：立刻收干净，别把屏留在半空 */
  var 停 = false;
  try { 停 = (typeof S !== 'undefined' && S && (!S.playing || S.over)); } catch (e) { }
  if (停) { _MK清理(); return; }

  var 忙 = false;
  _MK计数帧(dt);
  if (MK.收T > 0) 忙 = true;
  if (MK.显示 < MK.目标) 忙 = true;
  if (_MK屏推进(dt)) 忙 = true;

  if (忙) _MK踢一次();
}

/* ---------- 对外入口 ---------- */

/* 单人：killEnemy() 里调。
   ⚠️ 【batch215 用户口径】单人模式**只播击杀计数**，不出现 LCD 终端 ——
      那块屏显示的是「敌人 ID」，而 ID 只有在多人模式里才是有意义的东西（真人名字）。
      单人打的是 AI，没有 ID 可播，硬造一个编号反而出戏。 */
function 纪念击杀(e) {
  try {
    if (!_MK枪皮在用()) return;
    _MK计数到((typeof S !== 'undefined' && S) ? (S.kills || 0) : 0);
    _MK音('local');
  } catch (e4) { }
}

/* 联机：30_联机.js 的 kill 报文里调（只在自己是击杀者那支）。
   **LCD 终端只在这里出现** —— 多人模式才有「敌人 ID」可播。 */
function 纪念击杀联机(死者名, 位置, 总杀数) {
  try {
    if (!_MK枪皮在用()) return;
    var p = null;
    try { p = 位置 ? 位置.clone() : null; } catch (e) { }
    if (!p) { try { p = camera.position.clone().add(new THREE.Vector3(0, 0, -8)); } catch (e2) { return; } }
    p.y += 2.15;
    _MK计数到((typeof 总杀数 === 'number') ? 总杀数 : 0);
    _MK建屏(死者名 || 'UNKNOWN', p);
    _MK音('net');
  } catch (e3) { }
}

/* 音效：低频金鸣 + 一小段数据流噪声（不依赖具体实现，没有就静音） */
function _MK音(来源) {
  try {
    if (typeof audioCtx === 'undefined' || !audioCtx || !audioCtx.currentTime) return;
    if (typeof _咚 === 'function') _咚(audioCtx.currentTime + 0.005, 196, 92, 0.22, 0.16);
    if (typeof _鸣 === 'function') {
      _鸣(audioCtx.currentTime + 0.01, 1180, 0.30, 0.030);
      _鸣(audioCtx.currentTime + 0.06, 1760, 0.22, 0.018);
    }
    if (typeof _噪击 === 'function') {
      var t = audioCtx.currentTime + 0.02;
      for (var i = 0; i < 4; i++) _噪击(t + i * 0.05, 0.035, 2600 + i * 900, 0, 6, 0.045);
    }
  } catch (e) { }
}

/* 调试用：控制台敲 纪念击杀测试('夜鹰') 就能看一遍（不用真的打死人） */
try {
  window.纪念击杀测试 = function (名) {
    try {
      var p = camera.position.clone();
      var d = camera.getWorldDirection(new THREE.Vector3());
      p.add(d.multiplyScalar(7)); p.y = Math.max(p.y, 1.2);
      _MK计数到(((typeof S !== 'undefined' && S) ? (S.kills || 0) : MK.目标) + 1);
      _MK建屏(名 || ('TEST-' + ('000' + (MK.序 & 0xFFF).toString(16).toUpperCase()).slice(-3)), p.clone().setY(p.y + 2.15));
      return true;
    } catch (e) { return false; }
  };
} catch (e) { }
