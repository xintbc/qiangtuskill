/* ==================================================================================
   搜打撤 · 独立外观（js/81_独立外观.js）
   ----------------------------------------------------------------------------------
   专供 搜打撤/index.html。加载顺序必须在 78 之后：这里会按独立版自己的口径
   覆盖 78 的建场 / 容器 / 撤离建模，不动主游戏一行代码。

   三件事：
     ① 程序化贴图（沥青、水泥、锈钢、钢板、木栈道、帆布、医疗白、警戒斜纹、
        水面），全部 Canvas 现画，不引外部图片；灰港不再是纯色方块。
     ② 原版枪械/手部建模思路搬过来：六种枪各有自己的轮廓、瞄具、弹匣和双手。
     ③ 六种可搜容器各有外形（军用箱 / 医疗箱 / 旅行包 / 工具箱 / 保险柜 /
        尸体袋），敌人换成有四肢和装备的人形，不再是"圆柱顶个球"。
   ================================================================================== */

var 独立材质库 = {};

/* ---------- 程序化贴图 ---------- */
function 独贴图(键, 画, 尺寸) {
  var c = document.createElement('canvas'), S = 尺寸 || 256;
  c.width = c.height = S;
  画(c.getContext('2d'), S);
  var t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  try {
    if (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
      t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy() || 1);
  } catch (e) { }
  独立材质库['图_' + 键] = t;
  return t;
}
function 独取贴图(键) {
  if (独立材质库['图_' + 键]) return 独立材质库['图_' + 键];
  var 噪 = function (g, S, 数, 色) {
    for (var i = 0; i < 数; i++) {
      g.fillStyle = 色 || 'rgba(255,255,255,.035)';
      g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
  };
  switch (键) {
    case '沥青':
      return 独贴图(键, function (g, S) {
        g.fillStyle = '#242b2f'; g.fillRect(0, 0, S, S);
        噪(g, S, 2600, 'rgba(160,175,178,.055)');
        噪(g, S, 1600, 'rgba(0,0,0,.16)');
        for (var i = 0; i < 26; i++) {
          g.fillStyle = 'rgba(8,10,12,.22)';
          g.beginPath(); g.ellipse(Math.random() * S, Math.random() * S, 2 + Math.random() * 9, 1 + Math.random() * 5, Math.random() * 3, 0, 6.29); g.fill();
        }
        g.strokeStyle = 'rgba(175,180,170,.07)'; g.lineWidth = 1;
        for (var k = 0; k < 8; k++) {
          g.beginPath(); g.moveTo(Math.random() * S, Math.random() * S);
          g.lineTo(Math.random() * S, Math.random() * S); g.stroke();
        }
      });
    case '水泥':
      return 独贴图(键, function (g, S) {
        g.fillStyle = '#485259'; g.fillRect(0, 0, S, S);
        噪(g, S, 2200, 'rgba(210,220,225,.06)');
        g.strokeStyle = 'rgba(12,16,20,.28)'; g.lineWidth = 2;
        for (var y = 0; y <= S; y += S / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
        g.strokeStyle = 'rgba(255,255,255,.035)'; g.lineWidth = 1;
        for (var y2 = 2; y2 <= S; y2 += S / 4) { g.beginPath(); g.moveTo(0, y2); g.lineTo(S, y2); g.stroke(); }
      });
    case '锈铁':
      return 独贴图(键, function (g, S) {
        g.fillStyle = '#5b463c'; g.fillRect(0, 0, S, S);
        /* 集装箱的竖波纹：亮边 + 暗槽 */
        for (var x = 0; x < S; x += 14) {
          g.fillStyle = 'rgba(255,255,255,.075)'; g.fillRect(x, 0, 3, S);
          g.fillStyle = 'rgba(0,0,0,.23)'; g.fillRect(x + 8, 0, 5, S);
        }
        for (var i = 0; i < 36; i++) {
          var px = Math.random() * S, py = Math.random() * S, r = 5 + Math.random() * 28;
          var rg = g.createRadialGradient(px, py, 0, px, py, r);
          rg.addColorStop(0, 'rgba(137,68,35,.55)'); rg.addColorStop(1, 'rgba(137,68,35,0)');
          g.fillStyle = rg; g.beginPath(); g.arc(px, py, r, 0, 6.29); g.fill();
        }
        噪(g, S, 800, 'rgba(0,0,0,.18)');
      });
    case '钢板':
      return 独贴图(键, function (g, S) {
        g.fillStyle = '#39434a'; g.fillRect(0, 0, S, S);
        for (var y = 0; y < S; y += 32) {
          g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(0, y, S, 2);
          g.fillStyle = 'rgba(0,0,0,.24)'; g.fillRect(0, y + 28, S, 4);
        }
        for (var x = 12; x < S; x += 44) for (var y2 = 12; y2 < S; y2 += 44) {
          g.fillStyle = '#242d33'; g.beginPath(); g.arc(x, y2, 3, 0, 6.29); g.fill();
          g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(x - 1, y2 - 1, 1, 0, 6.29); g.fill();
        }
        噪(g, S, 600, 'rgba(255,255,255,.03)');
      });
    case '木':
      return 独贴图(键, function (g, S) {
        g.fillStyle = '#54412f'; g.fillRect(0, 0, S, S);
        for (var y = 0; y < S; y += 22) {
          g.fillStyle = 'rgba(0,0,0,.34)'; g.fillRect(0, y, S, 2);
          g.fillStyle = 'rgba(255,255,255,.045)'; g.fillRect(0, y + 3, S, 1);
          for (var i = 0; i < 12; i++) {
            g.fillStyle = 'rgba(20,12,6,.10)';
            g.fillRect(Math.random() * S, y + 4 + Math.random() * 17, 8 + Math.random() * 46, 1);
          }
        }
      });
    case '帆布':
      return 独贴图(键, function (g, S) {
        g.fillStyle = '#394535'; g.fillRect(0, 0, S, S);
        g.strokeStyle = 'rgba(255,255,255,.035)'; g.lineWidth = 1;
        for (var i = 0; i < S; i += 5) {
          g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke();
          g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke();
        }
        噪(g, S, 700, 'rgba(0,0,0,.12)');
      });
    case '医疗':
      return 独贴图(键, function (g, S) {
        g.fillStyle = '#c2ccc9'; g.fillRect(0, 0, S, S);
        噪(g, S, 700, 'rgba(0,0,0,.05)');
        g.fillStyle = '#ba3737'; g.fillRect(S * 0.36, S * 0.16, S * 0.28, S * 0.68);
        g.fillRect(S * 0.16, S * 0.36, S * 0.68, S * 0.28);
        g.strokeStyle = 'rgba(0,0,0,.20)'; g.lineWidth = 5; g.strokeRect(2, 2, S - 4, S - 4);
      });
    case '警戒':
      return 独贴图(键, function (g, S) {
        g.fillStyle = '#252c32'; g.fillRect(0, 0, S, S);
        g.save(); g.globalAlpha = .72; g.strokeStyle = '#c69332'; g.lineWidth = 20;
        for (var i = -S; i < S * 2; i += 62) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke(); }
        g.restore();
        g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, 0, S, 14); g.fillRect(0, S - 14, S, 14);
      });
    case '水':
      return 独贴图(键, function (g, S) {
        g.fillStyle = '#162b35'; g.fillRect(0, 0, S, S);
        g.strokeStyle = 'rgba(130,175,190,.10)'; g.lineWidth = 2;
        for (var i = 0; i < 30; i++) {
          var y = Math.random() * S;
          g.beginPath(); g.moveTo(0, y);
          for (var x = 0; x <= S; x += 12) g.lineTo(x, y + Math.sin(x * .05 + i) * 3);
          g.stroke();
        }
      });
  }
  return new THREE.MeshLambertMaterial({ color: 0x777777 });
}
function 独材(键, 色) {
  var k = 键 + '|' + (色 || 0xffffff);
  if (独立材质库[k]) return 独立材质库[k];
  var m = new THREE.MeshLambertMaterial({ map: 独取贴图(键), color: 色 == null ? 0xffffff : 色 });
  独立材质库[k] = m;
  return m;
}
function 独纯(色, 发光) {
  var k = '纯' + 色 + '|' + (发光 || 0);
  if (独立材质库[k]) return 独立材质库[k];
  var m = 发光
    ? new THREE.MeshBasicMaterial({ color: 色 })
    : new THREE.MeshLambertMaterial({ color: 色 });
  独立材质库[k] = m;
  return m;
}
/* 按真实尺寸铺 UV：大墙不会把砖拉成条 */
function 独铺UV(geo, w, h, d, 单位) {
  var uv = geo && geo.attributes && geo.attributes.uv;
  if (!uv) return geo;
  var u = 单位 || 4;
  var 面 = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (var i = 0; i < 6; i++) for (var j = 0; j < 4; j++) {
    var k = i * 4 + j;
    uv.setXY(k, uv.getX(k) * 面[i][0] / u, uv.getY(k) * 面[i][1] / u);
  }
  uv.needsUpdate = true;
  return geo;
}
function 独盒(g, x, y, z, w, h, d, 材, 单位) {
  var geo = 独铺UV(new THREE.BoxGeometry(w, h, d), w, h, d, 单位);
  var m = new THREE.Mesh(geo, 材);
  m.position.set(x, y, z); m.receiveShadow = true; g.add(m);
  return m;
}

/* ==================================================================================
   灰港建场：贴图的仓库 / 集装箱 / 诊所 / 油罐 / 码头，暗调冷光
   ================================================================================== */
function 灰港_建场() {
  var g = new THREE.Group(); g.name = '灰港封锁区';
  var obs = [], tp = [], info = { stairs: [], floors: [], windows: [], roofs: [], doors: [], oval: [] };
  var 存 = [_mapTarget, _obsTarget, _tpTarget, _infoTarget];
  _mapTarget = g; _obsTarget = obs; _tpTarget = tp; _infoTarget = info;
  var i, k;
  try {
    /* 地面：沥青 + 中央车道线（局部贴花，不是整张地板重复画出车道） */
    var 地材 = 独材('沥青'); 地材 = 地材.clone();
    地材.map = 独取贴图('沥青').clone();
    地材.map.repeat.set(46, 40); 地材.map.needsUpdate = true;
    var 地 = new THREE.Mesh(new THREE.PlaneGeometry(230, 190), 地材);
    地.rotation.x = -Math.PI / 2; 地.position.y = 0.01; 地.receiveShadow = true; g.add(地);
    /* 路：一条南北主通道 + 一条东西联络道。旧版把横竖虚线全场铺成十字格，
       站在集装箱堆场里像走在停车场坐标纸上，这是"地形怪异"最显眼的来源。
       现在只有真路面才画线，且是断开的虚线；路缘压低到 10cm，只收边不挡人。 */
    var 路面 = 独材('沥青', 0xb2babe), 路缘 = 独纯(0x566168), 漆 = 独纯(0xb9ad72);
    独盒(g, 0, .014, 0, 9.2, .018, 188, 路面, 6);
    独盒(g, 0, .015, -6, 224, .020, 8.4, 路面, 6);
    for (i = -88; i <= 88; i += 8)
      独盒(g, 0, .031, i, .16, .012, 3.4, 漆);
    for (i = -106; i <= 106; i += 8) {
      if (Math.abs(i) < 7) continue;          /* 两条路交叉处不画短线，避免叠成井字 */
      独盒(g, i, .032, -6, 3.4, .012, .16, 漆);
    }
    独盒(g, -4.8, .05, 0, .16, .10, 188, 路缘);
    独盒(g, 4.8, .05, 0, .16, .10, 188, 路缘);

    /* 港池水面（码头外侧），压在地面下面一点 */
    var 水材 = 独材('水'); 水材 = 水材.clone();
    水材.map = 独取贴图('水').clone(); 水材.map.repeat.set(9, 3); 水材.map.needsUpdate = true;
    var 水 = new THREE.Mesh(new THREE.PlaneGeometry(190, 34), 水材);
    水.rotation.x = -Math.PI / 2; 水.position.set(0, -0.42, 103); g.add(水);

    var 水混 = 独材('水泥'), 钢 = 独材('钢板'), 锈 = 独材('锈铁');
    var 木 = 独材('木'), 警 = 独材('警戒');
    var 暗 = 独纯(0x1b2227), 锈色 = 独材('锈铁', 0xd08a62), 钢色 = 独材('钢板', 0xb5c6d0);

    /* 各功能区先铺一块水泥坪再摆建筑：以前箱子/房子直接坐在沥青上，
       区与区之间没有过渡，看着像模型随手扔在路面上。坪比路面高 4mm，避免 z-fighting。 */
    var 坪 = 独材('水泥', 0xa9b3b6);
    [[-70, -42, 38, 30], [-10, -28, 36, 28], [-48, 36, 32, 20],
      [25, -46, 28, 26], [60, 18, 56, 26], [0, 72, 62, 16]].forEach(function (a) {
        独盒(g, a[0], .012, a[1], a[2], .016, a[3], 坪, 6);
      });

    /* 边界围墙：钢板 + 顶部警戒带，关闭"走到天边"的穿帮 */
    function 围墙(x, z, w, d) {
      独盒(g, x, 3.1, z, w, 6.2, d, 钢);
      独盒(g, x, 6.28, z, w, 0.36, d + 0.02, 警);
      obs.push({ cx: x, cz: z, w: w, d: d, h: 6.2, kind: 'border', minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    }
    围墙(0, -94, 230, 2);
    /* 南侧给码头留一个开口，水面才能从场内看见；缺口用矮护岸挡住人，
       不是直接把玩家放进水里（水面本身没有碰撞）。 */
    围墙(-73, 94, 84, 2); 围墙(73, 94, 84, 2);
    独盒(g, 0, .7, 94, 62, 1.4, 1.2, 水混);
    obs.push({ cx: 0, cz: 94, w: 62, d: 1.2, h: 1.4, kind: 'border',
      minX: -31, maxX: 31, minZ: 93.4, maxZ: 94.6 });
    围墙(-114, 0, 2, 190); 围墙(114, 0, 2, 190);
    /* 围墙内侧的低土坡只有 0.8m（低于碰撞阈值），纯粹把"一整块平板"切成有纵深的边界 */
    for (i = -76; i <= 76; i += 38) {
      独盒(g, -108, .4, i, 8, .8, 32, 独材('水泥', 0x8d9799), 6);
      独盒(g, 108, .4, i + 19, 8, .8, 32, 独材('水泥', 0x8d9799), 6);
    }

    /* A 集装箱堆场：每只箱子有波纹、门、角铁、锁杆；两层堆叠 */
    function 集装箱(x, z, 旋, 色, 层) {
      var box = new THREE.Group(), W = 7.4, H = 2.9, D = 2.65;
      独盒(box, 0, H / 2, 0, W, H, D, 色, 3.2);
      /* 端门：两扇 + 两根锁杆 + 把手 */
      for (var s = -1; s <= 1; s += 2) {
        独盒(box, s * W / 2, H / 2, 0, 0.08, H - .12, D - .12, 钢, 2);
        独盒(box, s * W / 2 + s * .06, H / 2, 0, .04, H - .35, .055, 暗);
        独盒(box, s * W / 2 + s * .09, H / 2 - .35, .22, .12, .16, .12, 独纯(0x8c969d));
      }
      /* 八只角件 */
      for (var cx = -1; cx <= 1; cx += 2) for (var cz = -1; cz <= 1; cz += 2)
        for (var cy = 0; cy <= 1; cy++)
          独盒(box, cx * (W / 2 - .18), cy * (H - .1) + .05, cz * (D / 2 - .14), .34, .22, .28, 钢);
      box.position.set(x, (层 || 0) * (H + .12), z); box.rotation.y = 旋 || 0;
      g.add(box);
      if (!层) {
        var 占宽 = Math.abs(Math.cos(旋 || 0)) * W + Math.abs(Math.sin(旋 || 0)) * D;
        var 占深 = Math.abs(Math.sin(旋 || 0)) * W + Math.abs(Math.cos(旋 || 0)) * D;
        obs.push({ cx: x, cz: z, w: 占宽, d: 占深,
          h: H + (层 || 0) * (H + .12), kind: 'terrain',
          minX: x - 占宽 / 2 - .1, maxX: x + 占宽 / 2 + .1,
          minZ: z - 占深 / 2 - .1, maxZ: z + 占深 / 2 + .1 });
      }
    }
    for (i = 0; i < 9; i++) {
      var ax = -78 + (i % 3) * 9.4, az = -52 + Math.floor(i / 3) * 9.4;
      集装箱(ax, az, (i % 2) * .02 - .01, i % 3 === 0 ? 锈色 : 钢色, 0);
      if (i === 2 || i === 6) 集装箱(ax - 1.2, az, .04, 钢色, 1);
    }
    /* 托盘与散箱 */
    for (i = 0; i < 6; i++) {
      独盒(g, -84 + (i % 3) * 13, .22, -28 + Math.floor(i / 3) * 11, 1.6, .44, 1.2, 木);
      独盒(g, -84 + (i % 3) * 13, .79, -28 + Math.floor(i / 3) * 11, 1.3, .7, 1, 独材('帆布'));
    }

    /* B 海关仓库：墙 + 半个屋顶 + 两排货架 + 顶灯 */
    function 墙(x, z, w, h, d, 材) {
      独盒(g, x, h / 2, z, w, h, d, 材 || 水混);
      obs.push({ cx: x, cz: z, w: w, d: d, h: h, kind: 'terrain', minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    }
    墙(-24, -28, 1, 5.2, 22); 墙(4, -28, 1, 5.2, 22);
    墙(-10, -39, 29, 5.2, 1); 墙(-10, -17.5, 12, 5.2, 1); 墙(-16, -17.5, 6, 5.2, 1);
    独盒(g, -10, 5.35, -35, 27, .3, 7, 钢);
    独盒(g, -10, 5.35, -22, 20, .3, 4, 钢);
    for (i = 0; i < 3; i++) {
      var rx = -19 + i * 8;
      for (k = 0; k < 2; k++) {
        独盒(g, rx, 1.1, -32 + k * 6, 2.2, 2.2, 1.6, 木);
        独盒(g, rx, 2.2, -32 + k * 6, 2.28, .12, 1.7, 钢);
        obs.push({ cx: rx, cz: -32 + k * 6, w: 2.2, d: 1.6, h: 2.3, kind: 'terrain', minX: rx - 1.1, maxX: rx + 1.1, minZ: -32 + k * 6 - .8, maxZ: -32 + k * 6 + .8 });
      }
    }
    独盒(g, -10, 5.1, -28, 2.4, .12, .4, 独纯(0xc6d8d0, 1));

    /* C 诊所：白房 + 红十字牌 + 半顶棚 */
    墙(-60, 36, 1, 3.8, 15, 独材('水泥', 0xd5dedb));
    墙(-36, 36, 1, 3.8, 15, 独材('水泥', 0xd5dedb));
    墙(-48, 43.5, 25, 3.8, 1, 独材('水泥', 0xd5dedb));
    墙(-48, 29, 10, 3.8, 1, 独材('水泥', 0xd5dedb));
    墙(-40, 29, 15, 3.8, 1, 独材('水泥', 0xd5dedb));
    独盒(g, -48, 3.95, 39, 23, .24, 8, 独材('水泥', 0xd5dedb));
    独盒(g, -48, 2.55, 28.42, 4, 1.3, .08, 独材('医疗'));
    for (i = 0; i < 3; i++) 独盒(g, -56 + i * 8, .55, 34, 2.4, 1.1, 1.1, 独材('医疗', 0xe0e7e5));

    /* D 行政楼：钢框 + 暗窗 + 局部楼板 */
    for (i = 0; i < 4; i++) {
      var dx = 16 + i * 6;
      独盒(g, dx, 3.5, -46, .5, 7, 20, 钢);
      if (i < 3) for (k = 0; k < 4; k++)
        独盒(g, dx + 3, 2.2 + k * 1.5, -55.3, 4.6, 1.05, .06, 独纯(0x16252d));
    }
    墙(25, -56, 20, 7, 1, 钢); 墙(19, -36, 8, 7, 1, 钢); 墙(25, -46, 8, 7, 1, 钢);
    独盒(g, 25, 7.1, -46, 20, .3, 20, 钢);
    独盒(g, 25, 7.35, -46, 19, .1, .22, 独纯(0xc0a458, 1));

    /* E 油罐：罐体 + 顶盖 + 盘梯 + 管道 + 警示环 */
    for (i = 0; i < 3; i++) {
      var tx = 46 + i * 15;
      var 罐 = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 7, 24), 钢色);
      罐.position.set(tx, 3.5, 18); 罐.receiveShadow = true; g.add(罐);
      var 盖 = new THREE.Mesh(new THREE.CylinderGeometry(5.25, 5.25, .28, 24), 独材('钢板'));
      盖.position.set(tx, 7.1, 18); g.add(盖);
      for (k = 0; k < 3; k++) {
        var 箍 = new THREE.Mesh(new THREE.TorusGeometry(5.24, .09, 6, 24), 独纯(0x232c33));
        箍.rotation.x = Math.PI / 2; 箍.position.set(tx, 1.6 + k * 2.2, 18); g.add(箍);
      }
      for (k = 0; k < 9; k++) 独盒(g, tx + 5.35, .5 + k * .72, 18, .9, .07, .4, 独材('钢板'));
      独盒(g, tx, 7.45, 18, .9, .5, .9, 独纯(0x2d363d));
      obs.push({ cx: tx, cz: 18, w: 10.4, d: 10.4, h: 7, kind: 'terrain', minX: tx - 5.2, maxX: tx + 5.2, minZ: 12.8, maxZ: 23.2 });
    }
    独盒(g, 58, .55, 30, 52, 1.1, .6, 独材('锈铁'));

    /* F 码头：木栈道 + 系船桩 + 吊机剪影 */
    独盒(g, 0, .25, 72, 58, .5, 9, 木);
    for (i = 0; i < 12; i++) 独盒(g, -27 + i * 5, .52, 72, .08, .03, 8.6, 独纯(0x2c241c));
    for (i = 0; i < 6; i++) {
      var mx = -22 + i * 9;
      独盒(g, mx, .95, 78, 1, 1.9, 1, 独纯(0x2e373d));
      独盒(g, mx, 1.9, 78, 1.3, .22, 1.3, 独材('钢板'));
    }
    for (i = 0; i < 4; i++) {
      独盒(g, -50 + i * 34, 7, 84, .7, 14, .7, 钢);
    }
    独盒(g, 1, 14, 84, 92, .8, .9, 钢);
    独盒(g, -36, 10, 84, .7, .7, 9, 钢);
    独盒(g, 36, 6, 84, .7, .7, 9, 钢);

    /* 路灯：真实点光只放三盏，其余用自发光灯罩，避免"光污染"又保留层次 */
    function 路灯(x, z, 真光) {
      独盒(g, x, 3.6, z, .22, 7.2, .22, 钢);
      独盒(g, x + .55, 7.15, z, 1.2, .12, .12, 钢);
      独盒(g, x + 1.05, 7.0, z, .55, .12, .35, 独纯(0xd9dfc4, 1));
      if (真光) {
        var L = new THREE.PointLight(0xd9dfc4, .55, 26, 2);
        L.position.set(x + 1, 6.9, z); g.add(L);
      }
    }
    路灯(-78, -30, true); 路灯(-10, -28, true); 路灯(48, 18, true);
    路灯(-48, 34, false); 路灯(24, -46, false); 路灯(0, 70, false);

    /* 散落掩体与油桶：让区域之间不是空跑 */
    function 桶(x, z) {
      var b = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, 1.5, 12), 独材('锈铁', 0x9e6c4c));
      b.position.set(x, .75, z); g.add(b);
      var 环 = new THREE.Mesh(new THREE.TorusGeometry(.56, .05, 5, 12), 独纯(0x2a3035));
      环.rotation.x = Math.PI / 2; 环.position.set(x, 1.2, z); g.add(环);
    }
    [[-72, 0], [-30, 4], [10, 18], [74, -30], [-18, 70], [66, 58]].forEach(function (p, idx) {
      var w = 6, d = 3, h = 2.2;
      独盒(g, p[0], h / 2, p[1], w, h, d, idx % 2 ? 木 : 钢);
      obs.push({ cx: p[0], cz: p[1], w: w, d: d, h: h, kind: 'terrain', minX: p[0] - w / 2, maxX: p[0] + w / 2, minZ: p[1] - d / 2, maxZ: p[1] + d / 2 });
    });
    for (i = 0; i < 14; i++) 桶(-90 + (i % 7) * 26, (i % 2 ? -8 : 26) + (i % 3) * 2);
  } finally {
    _mapTarget = 存[0]; _obsTarget = 存[1]; _tpTarget = 存[2]; _infoTarget = 存[3];
  }
  return { 组: g, 障碍: obs, 传送: tp, 信息: info };
}

/* ==================================================================================
   六种容器：各长各的样子，不再是一排一模一样的"棺材"
   ================================================================================== */
/* 容器是独立可交互对象，但一个容器没必要 8 个 draw call。
   把“箱体零件”按材质合并，盖子和提手单独留着做开盖动画 —— 状态仍然独立，
   只是箱体从多块变成一个材质批次。 */
var 容器体材 = null;
function 合并容器体(g, 盖) {
  var 位 = [], 法 = [], 色 = [], 原 = [];
  g.children.forEach(function (o) {
    if (!o.isMesh || !o.geometry || !o.material || Array.isArray(o.material)) return;
    if (o === 盖 || (盖 && o.parent === 盖)) return;
    原.push(o);
    o.updateMatrix();
    var geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(o.matrix);
    var p = geo.attributes.position, n = geo.attributes.normal;
    var c = (o.material.color && o.material.color.clone) ? o.material.color : new THREE.Color(0x8a8f93);
    if (p) for (var i = 0; i < p.count; i++) {
      位.push(p.getX(i), p.getY(i), p.getZ(i));
      色.push(c.r, c.g, c.b);
    }
    if (n) for (i = 0; i < n.count; i++) 法.push(n.getX(i), n.getY(i), n.getZ(i));
    geo.dispose();
  });
  if (!位.length) return;
  var geo2 = new THREE.BufferGeometry();
  geo2.setAttribute('position', new THREE.Float32BufferAttribute(位, 3));
  if (法.length === 位.length) geo2.setAttribute('normal', new THREE.Float32BufferAttribute(法, 3));
  if (!geo2.attributes.normal) geo2.computeVertexNormals();
  geo2.setAttribute('color', new THREE.Float32BufferAttribute(色, 3));
  geo2.computeBoundingSphere();
  if (!容器体材) 容器体材 = new THREE.MeshLambertMaterial({ vertexColors: true });
  g.add(new THREE.Mesh(geo2, 容器体材));
  原.forEach(function (o) { if (o.parent) o.parent.remove(o); try { o.geometry.dispose(); } catch (e) { } });
}

function 灰港_做容器(型, x, z) {
  var g = new THREE.Group(), 盖 = null, 盒 = null;
  var 钢 = 独材('钢板'), 暗 = 独纯(0x232a30), 金 = 独纯(0xa89870);
  if (型 === 'crate_mil') {
    /* 军用箱：军绿帆布纹 + 四角铁 + 两道锁扣 */
    盒 = 独盒(g, 0, .62, 0, 1.9, 1.24, 1.35, 独材('帆布'), 1);
    for (var sx = -1; sx <= 1; sx += 2) for (var sz = -1; sz <= 1; sz += 2)
      独盒(g, sx * .88, .62, sz * .6, .12, 1.28, .12, 钢);
    盖 = 独盒(g, 0, 1.3, 0, 2, .14, 1.45, 钢);
    独盒(g, 0, 1.39, 0, .5, .04, .16, 金);
    for (var c = -1; c <= 1; c += 2) {
      独盒(g, c * .55, 1.14, .7, .16, .24, .06, 金);
      独盒(g, c * .55, .68, .7, .1, .5, .05, 暗);
    }
  } else if (型 === 'crate_weapon') {
    /* 武器箱：深灰长箱 + 两道锁扣 + 侧面枪械轮廓，和军用箱明显区分 */
    盒 = 独盒(g, 0, .55, 0, 2.5, 1.1, 1.15, 独材('钢板', 0x4a555d), 1.2);
    盖 = 独盒(g, 0, 1.15, 0, 2.58, .16, 1.22, 钢);
    for (var wc = -1; wc <= 1; wc += 2) {
      独盒(g, wc * .72, .78, .61, .26, .42, .07, 金);
      独盒(g, wc * .72, 1.24, .61, .2, .12, .05, 暗);
    }
    独盒(g, 0, .58, .59, 1.3, .18, .04, 独纯(0x98a5ad));
    独盒(g, 0, 1.25, 0, .9, .03, .1, 独纯(0xc7a44d));
  } else if (型 === 'crate_med') {
    /* 医疗箱：白箱 + 红十字 + 提手 */
    盒 = 独盒(g, 0, .5, 0, 1.5, 1, 1.05, 独材('医疗', 0xe3eae7), 1.2);
    独盒(g, 0, .62, .54, .85, .45, .03, 独材('医疗'));
    盖 = 独盒(g, 0, 1.06, 0, 1.58, .13, 1.12, 独材('水泥', 0xd6dedb));
    var 把 = new THREE.Mesh(new THREE.TorusGeometry(.24, .035, 6, 12, Math.PI), 独纯(0x4c555b));
    把.position.set(0, 1.12, 0); 把.rotation.z = Math.PI; g.add(把);
    盖.__提手 = 把;
  } else if (型 === 'bag_travel') {
    /* 旅行包：软塌的圆筒 + 两条皮带 + 拉链 */
    盒 = 独盒(g, 0, .45, 0, 2.15, .9, 1.15, 独材('帆布', 0x6680a8), 1.2);
    var 弧 = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, 2.1, 12, 1, false, 0, Math.PI), 独材('帆布', 0x6680a8));
    弧.rotation.z = Math.PI / 2; 弧.rotation.y = Math.PI / 2; 弧.position.y = .9; g.add(弧);
    盖 = 独盒(g, 0, .96, 0, 2.18, .1, .12, 独纯(0xb9c2c8));
    for (var b = -1; b <= 1; b += 2)
      独盒(g, b * .6, .52, 0, .12, .94, 1.2, 独纯(0x2c3946));
    var 提 = new THREE.Mesh(new THREE.TorusGeometry(.3, .045, 6, 14, Math.PI), 独纯(0x263441));
    提.position.set(0, 1.05, 0); g.add(提);
  } else if (型 === 'tool_box') {
    /* 工具箱：橘红塑料 + 黑提手 + 卡扣 */
    盒 = 独盒(g, 0, .38, 0, 1.7, .76, 1.05, 独纯(0xa9552a), 1);
    盖 = 独盒(g, 0, .84, 0, 1.76, .22, 1.1, 独纯(0xc26a35));
    独盒(g, 0, .98, 0, .7, .12, .16, 独纯(0x1e252a));
    var 手 = new THREE.Mesh(new THREE.TorusGeometry(.26, .04, 6, 14, Math.PI), 独纯(0x20272d));
    手.position.set(0, 1.0, 0); g.add(手); 盖.__提手 = 手;
    独盒(g, 0, .84, .57, .56, .18, .05, 独纯(0x22282e));
  } else if (型 === 'safe_vault') {
    /* 保险柜：厚钢板 + 门缝 + 转盘 + 铆钉 */
    盒 = 独盒(g, 0, .85, 0, 1.6, 1.7, 1.3, 钢);
    盖 = 独盒(g, 0, .86, .68, 1.46, 1.5, .1, 独材('钢板', 0x8e9ba3));
    var 盘 = new THREE.Mesh(new THREE.CylinderGeometry(.26, .26, .09, 16), 金);
    盘.rotation.x = Math.PI / 2; 盘.position.set(0, .92, .77); g.add(盘);
    for (var a = 0; a < 8; a++) {
      var 螺 = new THREE.Mesh(new THREE.SphereGeometry(.045, 6, 5), 独纯(0xb9c4cb));
      螺.position.set(Math.cos(a * .785) * .62, .86 + Math.sin(a * .785) * .64, .75); g.add(螺);
    }
    独盒(g, .55, .9, .76, .1, .5, .06, 暗);
  } else {
    /* 尸体袋：深色软袋 + 拉链 + 头部凸起，一眼不是普通箱子 */
    盒 = 独盒(g, 0, .28, 0, 2.2, .56, .95, 独纯(0x353c3a), 1.2);
    var 头 = new THREE.Mesh(new THREE.SphereGeometry(.34, 10, 8), 独纯(0x3b4340));
    头.position.set(-1.02, .38, 0); g.add(头);
    盖 = 独盒(g, 0, .6, 0, 2.16, .07, .09, 独纯(0x9aa19a));
    for (var z2 = -1; z2 <= 1; z2 += 2)
      独盒(g, z2 * .48, .3, 0, .12, .6, 1, 独纯(0x2a3030));
  }
  合并容器体(g, 盖);
  g.position.set(x, 0, z);
  if (RAID_局.地图) RAID_局.地图.add(g);
  return { 组: g, 盖: 盖, 盒: 盒, 盖高: 盖 ? 盖.position.y : 0 };
}
function 灰港_开箱外观(c) {
  try {
    if (!c.模型 || !c.模型.盖) return;
    var 盖 = c.模型.盖;
    if (c.型 === 'safe_vault') { 盖.rotation.y = -.7; 盖.position.z += .22; }
    else if (c.型 === 'bag_travel' || c.型 === 'corpse') { 盖.position.y += .32; 盖.rotation.z = .22; }
    else { 盖.position.y = c.模型.盖高 + .42; 盖.rotation.z = .32; }
    if (盖.__提手) 盖.__提手.rotation.x = .8;
    if (c.模型.盒 && c.模型.盒.material) c.模型.盒.material = c.模型.盒.material.clone(), c.模型.盒.material.color.multiplyScalar(.76);
  } catch (e) { }
}

/* ---------- 撤离点：多层旋转环 + 暗光柱 + 地面标记 ---------- */
function 灰港_做撤离(p) {
  var c = 灰港坐标(p), g = new THREE.Group(), 绿 = new THREE.MeshBasicMaterial({ color: 0x53e6a4 });
  var 盘 = new THREE.Mesh(new THREE.CircleGeometry(3.4, 32),
    new THREE.MeshBasicMaterial({ color: 0x51dfa2, transparent: true, opacity: .14, depthWrite: false }));
  盘.rotation.x = -Math.PI / 2; 盘.position.y = .04; g.add(盘);
  for (var i = 0; i < 3; i++) {
    var 环 = new THREE.Mesh(new THREE.TorusGeometry(2.6 + i * .45, .07, 6, 36), 绿);
    环.rotation.x = Math.PI / 2; 环.position.y = .22 + i * .12; g.add(环);
  }
  var 柱 = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 11, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x4ce3a0, transparent: true, opacity: .085, side: THREE.DoubleSide, depthWrite: false }));
  柱.position.y = 5.5; g.add(柱);
  for (var k = 0; k < 4; k++) {
    var a = k * Math.PI / 2;
    独盒(g, Math.cos(a) * 3.3, .7, Math.sin(a) * 3.3, .22, 1.4, .22, 独纯(0x2b3735));
    var 灯 = new THREE.Mesh(new THREE.SphereGeometry(.13, 8, 6), 绿);
    灯.position.set(Math.cos(a) * 3.3, 1.5, Math.sin(a) * 3.3); g.add(灯);
  }
  g.position.set(c.x, 0, c.z);
  if (RAID_局.地图) RAID_局.地图.add(g);
  return { id: p.id, 名: p.名, x: c.x, z: c.z, 组: g, 柱: 柱, 环: g.children[1] };
}

/* ==================================================================================
   原版风格的持枪双手 + 六种枪械建模
   ================================================================================== */
var 独枪材 = null;
function 独枪料() {
  if (独枪材) return 独枪材;
  独枪材 = {
    身: new THREE.MeshLambertMaterial({ color: 0x2b3138, side: THREE.DoubleSide }),
    暗: new THREE.MeshLambertMaterial({ color: 0x15191d, side: THREE.DoubleSide }),
    钢: new THREE.MeshLambertMaterial({ color: 0x707b86, side: THREE.DoubleSide }),
    握: new THREE.MeshLambertMaterial({ color: 0x1d2024, side: THREE.DoubleSide }),
    铜: new THREE.MeshLambertMaterial({ color: 0xa58b52, side: THREE.DoubleSide }),
    皮: new THREE.MeshLambertMaterial({ color: 0xd2a87c, side: THREE.DoubleSide }),
    套: new THREE.MeshLambertMaterial({ color: 0x22272c, side: THREE.DoubleSide }),
    镜: new THREE.MeshBasicMaterial({ color: 0x9fd4f0, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide })
  };
  return 独枪材;
}
function 独件(g, geo, 材, x, y, z, rx, ry, rz) {
  var m = new THREE.Mesh(geo, 材);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
  g.add(m); return m;
}
function 独手(g, x, y, z, 朝) {
  var M = 独枪料();
  独件(g, new THREE.BoxGeometry(.09, .07, .11), M.套, x, y, z);
  for (var i = 0; i < 4; i++)
    独件(g, new THREE.BoxGeometry(.018, .018, .085), M.套, x + (i - 1.5) * .022, y + .022, z - .075);
  独件(g, new THREE.BoxGeometry(.026, .032, .07), M.皮, x + (朝 || 1) * .05, y - .01, z - .02, 0, (朝 || 1) * .4, 0);
  独件(g, new THREE.BoxGeometry(.075, .075, .34), M.皮, x + (朝 || 1) * .06, y - .055, z + .19, -.35, 0, 0);
}
function 独瞄具(g, y, z, 大) {
  var M = 独枪料();
  if (!大) {
    独件(g, new THREE.BoxGeometry(.02, .035, .02), M.暗, 0, y + .04, z - .13);
    独件(g, new THREE.BoxGeometry(.02, .035, .02), M.暗, 0, y + .04, z + .09);
    return;
  }
  var 筒 = new THREE.Mesh(new THREE.CylinderGeometry(.034, .034, 大 === 2 ? .24 : .16, 16, 1, true), M.暗);
  筒.rotation.x = Math.PI / 2; 筒.position.set(0, y + .09, z - .02); g.add(筒);
  for (var s = -1; s <= 1; s += 2) {
    var 圈 = new THREE.Mesh(new THREE.TorusGeometry(.033, .003, 5, 18), M.钢);
    圈.position.set(0, y + .09, z - .02 + s * (大 === 2 ? .12 : .08)); g.add(圈);
  }
  var 玻 = new THREE.Mesh(new THREE.CircleGeometry(.03, 18), M.镜);
  玻.position.set(0, y + .09, z - .02 - (大 === 2 ? .118 : .078)); g.add(玻);
  独件(g, new THREE.BoxGeometry(.02, .04, .05), M.暗, 0, y + .04, z - .02);
}
function 独弹匣(g, 型, y, z) {
  var M = 独枪料();
  if (型 === 'drum') {
    var d = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .075, 14), M.暗);
    d.rotation.z = Math.PI / 2; d.position.set(0, y - .12, z); g.add(d);
    var 圈 = new THREE.Mesh(new THREE.TorusGeometry(.075, .008, 5, 16), M.钢);
    圈.rotation.y = Math.PI / 2; 圈.position.set(.04, y - .12, z); g.add(圈);
  } else {
    var 长 = 型 === 'smg' ? .17 : (型 === 'pistol' ? .11 : .15);
    var m = 独件(g, new THREE.BoxGeometry(型 === 'shotgun' ? .062 : .046, 长, .055), M.暗,
      型 === 'smg' ? .014 : 0, y - 长 / 2 - .02, z);
    m.rotation.x = 型 === 'smg' ? -.22 : 0;
    独件(g, new THREE.BoxGeometry(.05, .012, .06), M.钢, 型 === 'smg' ? .03 : 0, y - 长 - .015, z);
  }
}
/* 空手：两只手都在画面里，只是不握枪。左手/右手用 朝=-1/1 分开，
   掌心朝下、前臂向相机方向收，避免两个掌心在屏幕中心叠成一块。 */
function 独立造空手(g) {
  独手(g, -.17, -.16, -.33, -1);
  独手(g, .17, -.16, -.33, 1);
}
function 独立造枪模(g, id) {
  /* 没有 id 就不是枪 —— 绝不能回退到默认手枪，否则空手进局也凭空多出一把 */
  var G = RAID_GUNS[id];
  if (!G) return;
  var M = 独枪料();
  var 型 = (G.槽 === -2) ? 'pistol' : (G.槽 === -3) ? 'smg' : (G.槽 === -4) ? 'shotgun'
    : (G.槽 === -5) ? 'rifle' : (G.槽 === -6) ? 'lmg' : 'sniper';
  if (型 !== 'pistol') {
    var 长 = 型 === 'sniper' ? .48 : (型 === 'lmg' ? .36 : .3);
    独件(g, new THREE.BoxGeometry(.072, .095, 长), M.身, 0, 0, 0);
    独件(g, new THREE.BoxGeometry(.038, .014, 长 * .9), M.钢, 0, .055, 0);
    for (var r = 0; r < 5; r++) 独件(g, new THREE.BoxGeometry(.04, .008, .012), M.暗, 0, .065, -.1 + r * .05);
    var 护 = 型 === 'shotgun' ? .18 : .22;
    独件(g, new THREE.BoxGeometry(.07, .075, 护), M.暗, 0, -.012, -.22);
    for (var s = 0; s < 4; s++) 独件(g, new THREE.BoxGeometry(.073, .007, .022), M.钢, 0, -.04 + s * .018, -.22);
    var 口径 = 型 === 'shotgun' ? .032 : .016;
    var 管长 = 型 === 'sniper' ? .58 : (型 === 'lmg' ? .46 : .38);
    独件(g, new THREE.CylinderGeometry(口径, 口径 * 1.15, 管长, 10), M.暗, 0, .008, -.4, Math.PI / 2, 0, 0);
    var 口 = 型 === 'shotgun' ? .045 : .026;
    独件(g, new THREE.CylinderGeometry(口, 口 * .85, .07, 10), M.钢, 0, .008, -管长 / 2 - .12, Math.PI / 2, 0, 0);
    /* 枪托 */
    if (型 !== 'smg') {
      独件(g, new THREE.BoxGeometry(.05, .075, .26), M.握, 0, -.01, .25, .08, 0, 0);
      独件(g, new THREE.BoxGeometry(.055, .09, .02), M.暗, 0, -.02, .385);
    } else {
      独件(g, new THREE.BoxGeometry(.02, .055, .22), M.钢, 0, -.03, .26, 0, .08, 0);
    }
    独件(g, new THREE.BoxGeometry(.04, .1, .045), M.握, 0, -.085, .075, .22, 0, 0);
    独弹匣(g, 型 === 'lmg' ? 'drum' : (型 === 'smg' ? 'smg' : 'rifle'), -.04, -.02);
    独瞄具(g, .01, -.06, 型 === 'sniper' ? 2 : (型 === 'rifle' ? 1 : 0));
    /* 栓动枪机 */
    if (型 === 'sniper') {
      独件(g, new THREE.CylinderGeometry(.013, .013, .1, 8), M.钢, .04, .03, .12, Math.PI / 2, 0, 0);
      独件(g, new THREE.SphereGeometry(.023, 8, 6), M.钢, .04, .03, .17);
    }
    独手(g, .045, -.085, .07, 1);
    独手(g, .01, -.1, -.24, -1);
  } else {
    /* 手枪：套筒 + 枪管 + 握把 + 扳机护圈 */
    独件(g, new THREE.BoxGeometry(.055, .075, .23), M.身, 0, .01, -.04);
    独件(g, new THREE.BoxGeometry(.05, .025, .2), M.钢, 0, .052, -.05);
    独件(g, new THREE.CylinderGeometry(.014, .014, .17, 10), M.暗, 0, .012, -.17, Math.PI / 2, 0, 0);
    独件(g, new THREE.BoxGeometry(.048, .16, .06), M.握, 0, -.105, .045, -.22, 0, 0);
    独件(g, new THREE.BoxGeometry(.052, .012, .064), M.钢, 0, -.183, .03);
    var 护圈 = new THREE.Mesh(new THREE.TorusGeometry(.04, .007, 5, 12, Math.PI), M.暗);
    护圈.position.set(0, -.055, -.005); 护圈.rotation.y = Math.PI / 2; g.add(护圈);
    独瞄具(g, .05, -.04, 0);
    独弹匣(g, 'pistol', -.08, .04);
    独手(g, .04, -.11, .07, 1);
  }

  /* 六把枪各自的专属零件：不是同一套模型换个颜色，轮廓一眼能分开 */
  if (id === 'gun_pigeon') {
    /* 灰鸽：亮钢套筒 + 胡桃木握把片 */
    独件(g, new THREE.BoxGeometry(.058, .026, .21), M.钢, 0, .055, -.06);
    独件(g, new THREE.BoxGeometry(.05, .09, .008), new THREE.MeshLambertMaterial({ color: 0x6d4a2e }),
      -.026, -.11, .05, -.22, 0, 0);
  } else if (id === 'gun_humming') {
    /* 蜂鸟：折叠枪托 + 侧拉机柄 */
    独件(g, new THREE.BoxGeometry(.012, .06, .24), M.钢, .055, -.01, .24, 0, -.24, 0);
    独件(g, new THREE.SphereGeometry(.018, 6, 5), M.钢, .07, .02, .01);
  } else if (id === 'gun_anvil') {
    /* 铁砧：泵动护木 + 双管箍 */
    独件(g, new THREE.BoxGeometry(.085, .075, .16), new THREE.MeshLambertMaterial({ color: 0x5c3d29 }), 0, -.06, -.29);
    for (var q = 0; q < 2; q++) 独件(g, new THREE.TorusGeometry(.038, .006, 5, 12), M.钢, 0, .008, -.24 - q * .13, Math.PI / 2, 0, 0);
  } else if (id === 'gun_watcher') {
    /* 守望者：遮光罩 + 两脚架 */
    独件(g, new THREE.CylinderGeometry(.042, .042, .06, 14, 1, true), M.暗, 0, .09, -.17, Math.PI / 2, 0, 0);
    独件(g, new THREE.CylinderGeometry(.008, .008, .16, 6), M.钢, -.05, -.16, -.31, 0, 0, .28);
    独件(g, new THREE.CylinderGeometry(.008, .008, .16, 6), M.钢, .05, -.16, -.31, 0, 0, -.28);
  } else if (id === 'gun_bone') {
    /* 碎骨：弹鼓外圈 + 散热孔 + 提把 */
    for (var h2 = 0; h2 < 8; h2++) {
      var a2 = h2 * Math.PI / 4;
      独件(g, new THREE.CylinderGeometry(.009, .009, .08, 6), M.暗,
        Math.cos(a2) * .05, -.12 + Math.sin(a2) * .05, -.02, Math.PI / 2, 0, 0);
    }
    独件(g, new THREE.BoxGeometry(.03, .04, .24), M.钢, 0, .075, -.22);
  } else if (id === 'gun_spike') {
    /* 长钉：枪口制退器开槽 + 高镜座 + 大栓柄 */
    独件(g, new THREE.BoxGeometry(.055, .012, .09), M.钢, 0, .05, -.72);
    独件(g, new THREE.BoxGeometry(.05, .08, .03), M.钢, 0, .05, -.06);
    独件(g, new THREE.SphereGeometry(.028, 8, 6), M.钢, .07, .03, .15);
  }
}

/* ==================================================================================
   敌人：有头、躯干、四肢、背包、头盔和枪的人形，不再"圆柱顶球"
   ================================================================================== */
function 独立造拾荒者(x, z, 色) {
  var g = new THREE.Group(), 衣 = new THREE.MeshLambertMaterial({ color: 色 || 0x4c5853 });
  var 裤 = new THREE.MeshLambertMaterial({ color: 0x303840 });
  var 肤 = new THREE.MeshLambertMaterial({ color: 0xb99a7c });
  var 黑 = new THREE.MeshLambertMaterial({ color: 0x20272d });
  /* 每个部件标好部位：命中判定直接读 userData.部位，不再靠命中点 y 猜。
     头盔算头部、背包算躯干、四肢包括手臂和腿，持枪按躯干计。 */
  var 身 = 独件(g, new THREE.BoxGeometry(.62, .78, .36), 衣, 0, 1.35, 0);
  var 头 = 独件(g, new THREE.SphereGeometry(.21, 10, 8), 肤, 0, 1.95, 0);
  身.userData.部位 = '躯干'; 头.userData.部位 = '头';
  独件(g, new THREE.SphereGeometry(.225, 10, 8, 0, 6.29, 0, 1.4), 黑, 0, 2.0, 0).userData.部位 = '头';
  独件(g, new THREE.BoxGeometry(.5, .17, .42), 黑, 0, 2.08, -.01).userData.部位 = '头';   /* 头盔 */
  独件(g, new THREE.BoxGeometry(.56, .56, .24), 裤, 0, 1.35, .29).userData.部位 = '躯干'; /* 背包 */
  独件(g, new THREE.BoxGeometry(.5, .1, .26), 黑, 0, 1.62, .31).userData.部位 = '躯干';
  var 腿L = 独件(g, new THREE.BoxGeometry(.22, .82, .24), 裤, -.17, .48, 0);
  var 腿R = 独件(g, new THREE.BoxGeometry(.22, .82, .24), 裤, .17, .48, 0);
  var 臂L = 独件(g, new THREE.BoxGeometry(.18, .68, .2), 衣, -.4, 1.28, -.16, -.5, 0, 0);
  var 臂R = 独件(g, new THREE.BoxGeometry(.18, .68, .2), 衣, .4, 1.28, -.16, -.5, 0, 0);
  腿L.userData.部位 = 腿R.userData.部位 = '四肢';
  臂L.userData.部位 = 臂R.userData.部位 = '四肢';
  独件(g, new THREE.BoxGeometry(.12, .12, .66), 黑, .25, 1.16, -.4).userData.部位 = '躯干';
  独件(g, new THREE.BoxGeometry(.06, .14, .08), 黑, .25, 1.1, -.05).userData.部位 = '躯干';
  g.position.set(x, 0, z);
  g.userData.腿 = [腿L, 腿R]; g.userData.臂 = [臂L, 臂R];
  g.userData.走 = function (t) {
    var a = Math.sin(t * 7) * .38;
    腿L.rotation.x = a; 腿R.rotation.x = -a;
    臂L.rotation.x = -.5 - a * .35; 臂R.rotation.x = -.5 + a * .35;
  };
  return g;
}

/* ==================================================================================
   六把枪的完整手感参数（独立版唯一真源）
   ----------------------------------------------------------------------------------
   74 里的 RAID_GUNS 只记价格 / 口径 / 弹匣，是给仓库称重用的；真正开枪用的
   伤害、射速、散布、后坐、弹速、曳光颜色全在这里。每把枪一份，没有占位配置。
   ================================================================================== */
var RAID枪详 = {
  gun_pigeon: { 名: '灰鸽手枪', 型: 'pistol', 伤: 34, 射速: 320, 弹匣: 15, 换弹: 1.9,
    散布: 0.006, 散增: 0.004, 后坐: 0.010, 弹速: 95, 射程: 90, 弹丸: 1, 穿: 0,
    镜FOV: 52, 曳: 0xffd166, 描: '9mm 半自动。稳，停火后散布收得快。' },
  gun_humming: { 名: '蜂鸟冲锋枪', 型: 'smg', 伤: 24, 射速: 900, 弹匣: 32, 换弹: 2.1,
    散布: 0.013, 散增: 0.0055, 后坐: 0.008, 弹速: 115, 射程: 100, 弹丸: 1, 穿: 0,
    镜FOV: 55, 曳: 0xffcf72, 描: '高射速，连射散布明显，适合贴脸。' },
  gun_anvil: { 名: '铁砧霰弹枪', 型: 'shotgun', 伤: 13, 射速: 75, 弹匣: 8, 换弹: 3.4,
    散布: 0.055, 散增: 0.004, 后坐: 0.030, 弹速: 68, 射程: 38, 弹丸: 9, 穿: 0,
    镜FOV: 60, 曳: 0xffb066, 描: '九颗鹿弹一次喷出，近距离一发致命。准星就是散布圆。' },
  gun_watcher: { 名: '守望者精确射手步枪', 型: 'rifle', 伤: 48, 射速: 260, 弹匣: 20, 换弹: 2.6,
    散布: 0.004, 散增: 0.0028, 后坐: 0.013, 弹速: 155, 射程: 180, 弹丸: 1, 穿: 1,
    镜FOV: 32, 曳: 0xc9e6ff, 描: '中远距离点射，开镜后几乎无散布。' },
  gun_bone: { 名: '碎骨轻机枪', 型: 'lmg', 伤: 29, 射速: 650, 弹匣: 100, 换弹: 5.2,
    散布: 0.018, 散增: 0.0065, 后坐: 0.011, 弹速: 135, 射程: 150, 弹丸: 1, 穿: 1,
    镜FOV: 48, 曳: 0xff9d6b, 描: '百发弹鼓，压住枪口就是一片火网。换弹很慢。' },
  gun_spike: { 名: '长钉栓动狙击', 型: 'sniper', 伤: 96, 射速: 45, 弹匣: 5, 换弹: 3.0,
    散布: 0.0012, 散增: 0.001, 后坐: 0.034, 弹速: 230, 射程: 260, 弹丸: 1, 穿: 2,
    镜FOV: 22, 曳: 0x9fe8ff, 描: '一发一命。高倍镜，开镜后散布归零。' }
};
function RAID枪参(id) {
  return RAID枪详[id] || RAID枪详.gun_pigeon;
}
