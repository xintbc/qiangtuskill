/* ==================================================================================
   灰港·北岸仓储区（js/82_灰港北岸.js）
   ----------------------------------------------------------------------------------
   400m×400m 新图：数据来自 js/76 的 RAID_MAP_BUILDINGS / RAID_MAP_CONTAINERS。
   本文件只做三件事：
     ① 按新数据铺地形、水域、9 条道路、边界；
     ② 按 20 个建筑数据砌外壳、地面、二层楼板、楼梯与主要掩体；
     ③ 把 116 个容器按绝对坐标落到场景里（2F 容器先摆在二层楼板上）。
   旧 81 的灰港建场不再调用；82 在 81 之后加载，直接覆盖同名函数。
   当前：地形/道路/20 栋外壳/116 容器点 + 容器 1..116 编号牌 + 一二楼默认开放 +
   楼梯逐级碰撞（可上 2F）+ 静态件分批合批（支持 20 万方块上限）+ 主要掩体碰撞。
   逐房间门扇仍属后续精修，不在此假装完成。布局与容器坐标严格来自三张原图，不得调整。
   ================================================================================== */
(function () {
  var 地材 = null, 水材 = null, 钢 = null, 水泥 = null, 锈 = null, 木 = null, 暗 = null;
  var 路 = null, 路缘 = null, 漆 = null;

  function X(x) { return x - 200; }
  function Z(z) { return z - 200; }

  function 初始化材质() {
    if (地材) return;
    地材 = 独材('沥青'); 地材 = 地材.clone();
    地材.map = 独取贴图('沥青').clone();
    地材.map.repeat.set(52, 52); 地材.map.needsUpdate = true;
    水材 = 独材('水'); 水材 = 水材.clone();
    水材.map = 独取贴图('水').clone();
    水材.map.repeat.set(16, 6); 水材.map.needsUpdate = true;
    钢 = 独材('钢板'); 水泥 = 独材('水泥'); 锈 = 独材('锈铁');
    木 = 独材('木'); 暗 = 独纯(0x1b2227);
    路 = 独材('沥青', 0xaeb7bb); 路缘 = 独纯(0x566168); 漆 = 独纯(0xb9ad72);
  }

  /* 从 y0 到 y0+h 的盒子（独盒 的 y 是中心） */
  function 高盒(g, x, y0, z, w, h, d, 材) {
    return 独盒(g, x, y0 + h / 2, z, w, h, d, 材);
  }

  /* 只登记碰撞盒、不再生成第二个方块（油罐/变压器这类已经有圆柱/模型的用） */
  function 只障(x, z, w, h, d) {
    if (!_obsTarget) return;
    _obsTarget.push({
      cx: x, cz: z, w: w, d: d, h: h, y0: 0, y1: h, kind: 'terrain',
      minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2
    });
  }

  /* 只有 Y 轴区间的碰撞盒：楼板/屋顶/雨棚用。没有它，玩家跳起来会从楼板/屋顶穿过去。 */
  function 只障Y(x, z, w, d, y0, y1) {
    if (!_obsTarget) return;
    _obsTarget.push({
      cx: x, cz: z, w: w, d: d, h: y1, y0: y0, y1: y1, kind: 'floor',
      minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2
    });
  }

  function 地面块(g, x, z, w, d, 材, y) {
    独盒(g, x, (y == null ? .04 : y), z, w, .08, d, 材);
  }

  /* 带门洞的墙：门数组元素 [x,z,w,'h'|'v',swing,ext] */
  function 横墙(g, z, x1, x2, h, 材, 门, y0) {
    y0 = y0 || 0;
    var 洞 = [];
    (门 || []).forEach(function (d) {
      if (d[3] === 'h' && Math.abs(d[1] - z) < 2.2) 洞.push([d[0] - d[2] / 2, d[0] + d[2] / 2]);
    });
    洞.sort(function (a, b) { return a[0] - b[0]; });
    var cur = x1;
    for (var i = 0; i < 洞.length; i++) {
      var a = Math.max(x1, 洞[i][0]), b = Math.min(x2, 洞[i][1]);
      if (a > cur + .05) {
        if (y0 <= .01) addBox((cur + a) / 2, z, a - cur, h, .62, 材, 'terrain');
        else 高盒(g, (cur + a) / 2, y0, z, a - cur, h, .62, 材);
      }
      cur = Math.max(cur, b);
    }
    if (cur < x2 - .05) {
      if (y0 <= .01) addBox((cur + x2) / 2, z, x2 - cur, h, .62, 材, 'terrain');
      else 高盒(g, (cur + x2) / 2, y0, z, x2 - cur, h, .62, 材);
    }
  }

  function 纵墙(g, x, z1, z2, h, 材, 门, y0) {
    y0 = y0 || 0;
    var 洞 = [];
    (门 || []).forEach(function (d) {
      if (d[3] === 'v' && Math.abs(d[0] - x) < 2.2) 洞.push([d[1] - d[2] / 2, d[1] + d[2] / 2]);
    });
    洞.sort(function (a, b) { return a[0] - b[0]; });
    var cur = z1;
    for (var i = 0; i < 洞.length; i++) {
      var a = Math.max(z1, 洞[i][0]), b = Math.min(z2, 洞[i][1]);
      if (a > cur + .05) {
        if (y0 <= .01) addBox(x, (cur + a) / 2, .62, h, a - cur, 材, 'terrain');
        else 高盒(g, x, y0, (cur + a) / 2, .62, h, a - cur, 材);
      }
      cur = Math.max(cur, b);
    }
    if (cur < z2 - .05) {
      if (y0 <= .01) addBox(x, (cur + z2) / 2, .62, h, z2 - cur, 材, 'terrain');
      else 高盒(g, x, y0, (cur + z2) / 2, .62, h, z2 - cur, 材);
    }
  }

  function 窗带(g, b) {
    (b.windows || []).forEach(function (w) {
      if (w[3] === 'h') 高盒(g, X(w[0]), 1.7, Z(w[1]), w[2], 1.0, .16, 独材('钢板', 0x9dc6d0));
      else 高盒(g, X(w[0]), 1.7, Z(w[1]), .16, 1.0, w[2], 独材('钢板', 0x9dc6d0));
    });
  }

  function 楼梯(g, s, y0) {
    var x = X(s[0]), z = Z(s[1]), w = s[2], d = s[3], 竖 = s[5] !== 'h';
    var 步 = 9, 高 = (y0 ? 3.2 : 4.2) / 步;
    for (var i = 0; i < 步; i++) {
      var tx, tz, tw, td;
      if (竖) { tx = x + w / 2; tz = z + d - (i + .5) * d / 步; tw = w - .2; td = d / 步 + .04; }
      else { tx = x + (i + .5) * w / 步; tz = z + d / 2; tw = w / 步 + .04; td = d - .2; }
      高盒(g, tx, i * 高, tz, tw, 高, td, 钢);
      /* 每级踏步一个可站立面：地面眼高() 踩着它逐级上 2F，通道真正连通 */
      if (_obsTarget && (typeof RAID楼层可通行 !== 'function' || RAID楼层可通行(2))) {
        _obsTarget.push({
          cx: tx, cz: tz, w: tw, d: td, h: (i + 1) * 高, y0: i * 高, y1: (i + 1) * 高,
          kind: 'stair', minX: tx - tw / 2, maxX: tx + tw / 2, minZ: tz - td / 2, maxZ: tz + td / 2
        });
      }
    }
  }

  /* 立面细节：基座、檐口、窗带、门头雨棚。全部是静态件，合批后不会增加 draw call，
     但能把“灰盒子”变成有层级、有边缘、有门窗节奏的建筑。 */
  function 立面细节(g, b) {
    var w = b.x2 - b.x1, d = b.z2 - b.z1, x1 = X(b.x1), x2 = X(b.x2), z1 = Z(b.z1), z2 = Z(b.z2);
    var 高 = b.floors >= 2 ? 4.2 : 4.4;
    var 基 = 独纯(0x242b2f), 檐 = 独材('锈铁', 0x8a7258), 玻 = 独材('钢板', 0x6d8f9b);
    /* 基座/檐口必须比墙厚，否则会被 0.62m 的墙吞掉看不见 */
    高盒(g, (x1 + x2) / 2, .02, z1, w + .5, .55, .82, 基);
    高盒(g, (x1 + x2) / 2, .02, z2, w + .5, .55, .82, 基);
    高盒(g, x1, .02, (z1 + z2) / 2, .82, .55, d + .5, 基);
    高盒(g, x2, .02, (z1 + z2) / 2, .82, .55, d + .5, 基);
    /* 檐口：屋顶下沿一圈锈色收边，长墙不再是一条直线到顶 */
    高盒(g, (x1 + x2) / 2, 高 + (b.floors >= 2 ? 3.1 : .1), z1, w + .7, .22, .92, 檐);
    高盒(g, (x1 + x2) / 2, 高 + (b.floors >= 2 ? 3.1 : .1), z2, w + .7, .22, .92, 檐);
    高盒(g, x1, 高 + (b.floors >= 2 ? 3.1 : .1), (z1 + z2) / 2, .92, .22, d + .7, 檐);
    高盒(g, x2, 高 + (b.floors >= 2 ? 3.1 : .1), (z1 + z2) / 2, .92, .22, d + .7, 檐);
    /* 窗带：沿长墙每 7m 一段，门洞附近自动跳开；二层再补一圈高窗。
       窗中心往墙外偏移 0.34m，避免嵌进墙里变成“看不见的窗”。 */
    function 横窗(zw, 外) {
      for (var x = b.x1 + 4; x < b.x2 - 3; x += 7) {
        var 撞门 = (b.doors || []).some(function (o) { return o[3] === 'h' && Math.abs(o[1] - zw) < 2 && Math.abs(o[0] - x) < 3; });
        var z = zw + 外 * .34;
        if (!撞门) 高盒(g, X(x), 1.6, Z(z), 4.2, .95, .14, 玻);
        if (b.floors >= 2) 高盒(g, X(x), 5.0, Z(z), 3.4, .8, .14, 玻);
        if (!撞门) 高盒(g, X(x), .55, Z(z), .10, 3.4, .10, 基);
      }
    }
    function 纵窗(xw, 外) {
      for (var z = b.z1 + 4; z < b.z2 - 3; z += 7) {
        var 撞门 = (b.doors || []).some(function (o) { return o[3] === 'v' && Math.abs(o[0] - xw) < 2 && Math.abs(o[1] - z) < 3; });
        var x = xw + 外 * .34;
        if (!撞门) 高盒(g, X(x), 1.6, Z(z), .14, .95, 4.2, 玻);
        if (b.floors >= 2) 高盒(g, X(x), 5.0, Z(z), .14, .8, 3.4, 玻);
        if (!撞门) 高盒(g, X(x), .55, Z(z), .10, 3.4, .10, 基);
      }
    }
    横窗(b.z1, -1); 横窗(b.z2, 1); 纵窗(b.x1, -1); 纵窗(b.x2, 1);
    /* 门头雨棚 */
    (b.doors || []).forEach(function (o) {
      if (o[5]) {
        var 横 = o[3] === 'h', ww = 横 ? o[2] + 1.6 : 1.6, dd = 横 ? 1.6 : o[2] + 1.6;
        高盒(g, X(o[0]), 2.85, Z(o[1]), ww, .18, dd, 檐);
      }
    });
  }

  function 楼(g, b) {
    var w = b.x2 - b.x1, d = b.z2 - b.z1, cx = X((b.x1 + b.x2) / 2), cz = Z((b.z1 + b.z2) / 2);
    var 外墙高 = b.floors >= 2 ? 4.2 : 4.4;
    /* 按设计稿分区的墙材：仓储冷灰钢、工业锈铁、镇中心暖水泥、居民楼灰绿、木屋暖木 */
    var 墙材 = 水泥;
    if (b.kind === 'warehouse') 墙材 = 独材('钢板', 0x7d8a90);
    else if (b.kind === 'factory') 墙材 = 独材('锈铁', 0x8a6b52);
    else if (b.kind === 'shop') 墙材 = 独材('水泥', 0xc4b6a0);
    else if (b.kind === 'clinic') 墙材 = 独材('水泥', 0xd0d8d4);
    else if (b.kind === 'restaurant') 墙材 = 独材('木', 0x9a7b58);
    else if (b.kind === 'residential' || b.kind === 'apartment') 墙材 = 独材('水泥', 0xb6b8a8);
    else if (b.kind === 'fishing' || b.kind === 'cabin') 墙材 = 木;
    else if (b.kind === 'dock') 墙材 = 独材('钢板', 0x6e7a80);
    /* 水泥坪 + 地面 + 外壳：先垫一圈比建筑大 6m 的坪，和道路有过渡 */
    地面块(g, cx, cz, w + 6, d + 6, 水泥, .012);
    地面块(g, cx, cz, w, d, 水泥, .028);
    横墙(g, Z(b.z1), X(b.x1), X(b.x2), 外墙高, 墙材, b.doors);
    横墙(g, Z(b.z2), X(b.x1), X(b.x2), 外墙高, 墙材, b.doors);
    纵墙(g, X(b.x1), Z(b.z1), Z(b.z2), 外墙高, 墙材, b.doors);
    纵墙(g, X(b.x2), Z(b.z1), Z(b.z2), 外墙高, 墙材, b.doors);
    窗带(g, b);
    立面细节(g, b);
    /* 二层楼板 / 屋顶：先做结构，不做可走碰撞（M3 再补楼板高度与护栏） */
    if (b.floors >= 2) {
      高盒(g, cx, 4.2, cz, w - .2, .22, d - .2, 钢);
      只障Y(cx, cz, w - .2, d - .2, 4.2, 4.42);
      横墙(g, Z(b.z1), X(b.x1), X(b.x2), 3.1, 墙材, b.doors, 4.42);
      横墙(g, Z(b.z2), X(b.x1), X(b.x2), 3.1, 墙材, b.doors, 4.42);
      纵墙(g, X(b.x1), Z(b.z1), Z(b.z2), 3.1, 墙材, b.doors, 4.42);
      纵墙(g, X(b.x2), Z(b.z1), Z(b.z2), 3.1, 墙材, b.doors, 4.42);
      /* 二层房间：按 rooms2 补 2.5m 隔墙；南墙留 1.8m 门洞，视觉上和设计图一致 */
      (b.rooms2 || []).forEach(function (r) {
        var rx1 = X(r[0]), rx2 = X(r[2]), rz1 = Z(r[1]), rz2 = Z(r[3]);
        var rw2 = rx2 - rx1, rd2 = rz2 - rz1, 门 = 1.8;
        高盒(g, (rx1 + rx2) / 2, 4.44, rz1, rw2, 2.5, .16, 墙材);
        高盒(g, rx1, 4.44, (rz1 + rz2) / 2, .16, 2.5, rd2, 墙材);
        高盒(g, rx2, 4.44, (rz1 + rz2) / 2, .16, 2.5, rd2, 墙材);
        if (rw2 > 门 + 2) {
          var 半 = (rw2 - 门) / 2;
          高盒(g, rx1 + 半 / 2, 4.44, rz2, 半, 2.5, .16, 墙材);
          高盒(g, rx2 - 半 / 2, 4.44, rz2, 半, 2.5, .16, 墙材);
        } else {
          高盒(g, (rx1 + rx2) / 2, 4.44, rz2, rw2, 2.5, .16, 墙材);
        }
      });
      高盒(g, cx, 7.52, cz, w + .3, .28, d + .3, 锈);
      只障Y(cx, cz, w + .3, d + .3, 7.52, 7.8);
      /* 屋顶：女儿墙 + 水箱 + 空调外机 + 天窗，和设计图的屋顶掩体对应 */
      var 顶 = 7.82;
      for (var rx = b.x1 + 1; rx < b.x2 - 1; rx += 4) {
        高盒(g, X(rx), 顶, Z(b.z1) + .2, .12, .8, .12, 钢);
        高盒(g, X(rx), 顶, Z(b.z2) - .2, .12, .8, .12, 钢);
      }
      高盒(g, X(b.x1 + 5), 顶, Z(b.z1 + 5), 2.8, 1.4, 2.4, 独材('钢板', 0x8a969c));
      高盒(g, X(b.x2 - 5), 顶, Z(b.z2 - 5), 2.2, 1.8, 2.2, 钢);
      for (var sk = 0; sk < 2; sk++)
        高盒(g, cx + (sk ? 1 : -1) * w * .18, 顶 + .02, cz, 3.2, .06, 2.2, 独纯(0x9fd4f0, 1));
    } else {
      高盒(g, cx, 4.4, cz, w + .3, .26, d + .3, 锈);
      只障Y(cx, cz, w + .3, d + .3, 4.4, 4.66);
      /* 单层屋顶也放水箱/空调/通风器，避免从街上看是一块纯平盒子 */
      高盒(g, X(b.x1 + 5), 4.62, Z(b.z1 + 5), 2.4, 1.3, 2.2, 独材('钢板', 0x8a969c));
      高盒(g, X(b.x2 - 5), 4.62, Z(b.z2 - 5), 1.8, 1.5, 1.8, 钢);
      高盒(g, cx, 4.62, cz, 1.2, 1.8, 1.2, 暗);
    }
    /* 房间隔断先做 0.95m 矮墙/台面：不挡路，但能看出房间轮廓；门扇与全高隔墙放 M3 */
    (b.rooms1 || []).forEach(function (r) {
      var rw = r[2] - r[0], rd = r[3] - r[1], rx = X((r[0] + r[2]) / 2), rz = Z((r[1] + r[3]) / 2);
      高盒(g, rx, .02, Z(r[1]), rw - .4, .95, .18, 木);
      高盒(g, rx, .02, Z(r[3]), rw - .4, .95, .18, 木);
      高盒(g, X(r[0]), .02, rz, .18, .95, rd - .4, 木);
      高盒(g, X(r[2]), .02, rz, .18, .95, rd - .4, 木);
    });
    /* 楼梯：只做可见踏步，暂不改变玩家楼层（M3 接楼板高度） */
    (b.stairs || []).forEach(function (s) { 楼梯(g, s, 0); });
    /* 家具 / 货架：建模型和登记碰撞一起做，杜绝"看得见撞不到" */
    function 掩体(x, z, ww, hh, dd, 材) {
      高盒(g, x, .02, z, ww, hh, dd, 材);
      只障(x, z, ww, hh, dd);
    }
    if (b.id === 'B1' || b.id === 'B2') {
      for (var i = 0; i < 4; i++) 掩体(cx, Z(b.z1 + 8 + i * 7), w - 8, 2.3, 1.4, 钢);
    }
    if (b.id === 'B4') {
      for (var r2 = 0; r2 < 3; r2++) for (var c2 = 0; c2 < 4; c2++)
        掩体(X(b.x1 + 8 + c2 * 16), Z(b.z1 + 10 + r2 * 12), 5, 1.8, 3.2, 钢);
    }
    if (b.id === 'B10') {
      for (var m = 0; m < 3; m++) 掩体(X(b.x1 + 6 + m * 9), Z(b.z2 - 5), 1.2, .8, 3.4, 独材('医疗'));
    }
    if (b.id === 'B12' || b.id === 'B13' || b.id === 'B14') {
      for (var q = 0; q < 3; q++) 掩体(cx, Z(b.z1 + 12 + q * 8), 4, .7, 1.6, 木);
    }
    if (b.id === 'B15') {
      掩体(X(b.x1 + 5), Z(b.z2 - 6), 2, 1.2, 1.4, 木);
    }
    /* 楼梯间/屋顶检修口的可见标记 */
    高盒(g, X((b.x1 + b.x2) / 2), 1.8, Z(b.z2 - 2), 1.6, .08, 1.6, 独纯(0xd8b45c, 1));
    /* 设计图上的建筑编号/名称，直接带到 3D */
    var 标 = 做标牌(b.id + ' ' + b.name, b.floors >= 2 ? '#f59e0b' : '#8fa3ad', 8.5, 2.1);
    标.position.set(cx, b.floors >= 2 ? 9.6 : 6.0, cz);
    g.add(标);
  }

  function 集装箱堆场(g, b) {
    var 行 = [106, 120, 134, 148, 162];
    for (var r = 0; r < 行.length; r++) for (var c = 0; c < 8; c++) {
      var x = X(48 + c * 14 + 6), z = Z(行[r] + 1.2);
      addBox(x, z, 12, 2.6, 2.4, (r + c) % 3 ? 钢 : 锈, 'terrain');
      if ((r === 1 || r === 3) && (c === 1 || c === 5)) {
        高盒(g, x, 2.7, z, 11.6, 2.5, 2.2, 钢);
        /* 双层箱上层与下层是同一个实心箱体：y0 从 0 起，避免"悬空底面"被碰头()误判成天花板。
           kind 用 terrain，不是楼板。 */
        if (_obsTarget) _obsTarget.push({
          cx: x, cz: z, w: 11.6, d: 2.2, h: 5.2, y0: 0, y1: 5.2, kind: 'terrain',
          minX: x - 5.8, maxX: x + 5.8, minZ: z - 1.1, maxZ: z + 1.1
        });
      }
    }
  }

  function 油罐区(g, b) {
    var 罐 = [[348, 52], [362, 52], [348, 72], [362, 72]];
    罐.forEach(function (p) {
      var x = X(p[0]), z = Z(p[1]);
      var m = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 10, 18), 钢);
      m.position.set(x, 5, z); g.add(m);
      只障(x, z, 12, 10, 12);
      var 顶 = new THREE.Mesh(new THREE.CylinderGeometry(6.15, 6.15, .3, 18), 锈);
      顶.position.set(x, 10.1, z); g.add(顶);
    });
    高盒(g, X(355), .02, Z(92), 30, 3.2, 16, 水泥);
    只障(X(355), Z(92), 30, 3.2, 16);   /* 泵房 */
  }

  function 铁路区(g, b) {
    for (var i = 0; i < 2; i++) {
      高盒(g, X(360), .04, Z(128 + i * 10), 40, .12, .18, 钢);
      高盒(g, X(360), .04, Z(139 + i * 10), 40, .12, .18, 钢);
    }
    高盒(g, X(369), .02, Z(118), 18, 2.8, 10, 锈);
    只障(X(369), Z(118), 18, 2.8, 10);     /* 敞车车厢 */
    高盒(g, X(350), .02, Z(150), 20, 3.2, 10, 水泥);
    只障(X(350), Z(150), 20, 3.2, 10);     /* 装卸月台 */
  }

  function 码头区(g, b) {
    var 船体 = 高盒(g, X(320), .02, Z(358), 18, 1.6, 9, 钢);
    只障(X(320), Z(358), 18, 1.6, 9);      /* 渔船船体 */
    var 舱 = 高盒(g, X(320), 1.7, Z(355), 7, 2.4, 4, 木);
    /* 船舱与船体同一个实心体：y0 从 0 起，不制造悬空天花板 */
    if (_obsTarget) _obsTarget.push({
      cx: X(320), cz: Z(355), w: 7, d: 4, h: 4.1, y0: 0, y1: 4.1, kind: 'terrain',
      minX: X(320) - 3.5, maxX: X(320) + 3.5, minZ: Z(355) - 2, maxZ: Z(355) + 2
    });
    for (var i = 0; i < 3; i++) {
      高盒(g, X(335), .02, Z(338 + i * 8), .7, 14, .7, 钢);
      只障(X(335), Z(338 + i * 8), .7, 14, .7);  /* 吊机立柱 */
    }
    高盒(g, X(328), 13.4, Z(338), 14, .7, .7, 钢);
  }

  function 变电站(g, b) {
    高盒(g, X(336), .02, Z(216), 12, 3.2, 12, 水泥);
    只障(X(336), Z(216), 12, 3.2, 12);    /* 控制室 */
    for (var i = 0; i < 4; i++) {
      var x = X(346 + (i % 2) * 5), z = Z(216 + Math.floor(i / 2) * 10);
      高盒(g, x, .02, z, 4.6, 3.6, 4.2, 钢);
      只障(x, z, 4.6, 3.6, 4.2);
    }
  }

  function 山洞(g, b) {
    var pts = [[20, 240], [28, 230], [38, 236], [40, 246], [30, 250], [22, 248]];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], c = pts[(i + 1) % pts.length];
      高盒(g, X((a[0] + c[0]) / 2), .02, Z((a[1] + c[1]) / 2), 3, 2.6, 3, 锈);
    }
    高盒(g, X(29), .02, Z(241), 4, .35, 4, 独纯(0x8a5a3a));
  }

  function 树(g, x, z) {
    var t = new THREE.Mesh(new THREE.CylinderGeometry(.28, .38, 4.6, 6), 木);
    t.position.set(X(x), 2.3, Z(z)); g.add(t);
    var c = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5.2, 7), 独材('帆布', 0x3f6b4a));
    c.position.set(X(x), 5.6, Z(z)); g.add(c);
  }

  /* 场景标牌：把设计图里的建筑名/区域名带进 3D。Sprite 始终朝向相机，
     不参与静态合批（二十来个 draw call，换来可读的地图层级）。 */
  function 做标牌(文字, 色, 宽, 高) {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    var x = c.getContext('2d');
    x.fillStyle = 'rgba(9,15,19,.86)';
    x.strokeStyle = 色 || '#f0d6a0';
    x.lineWidth = 4;
    x.beginPath();
    x.roundRect ? x.roundRect(6, 6, 500, 116, 18) : x.rect(6, 6, 500, 116);
    x.fill(); x.stroke();
    x.fillStyle = '#f2e7cc';
    x.font = 'bold 54px "Microsoft YaHei","Noto Sans SC",sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(文字, 256, 68);
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(宽 || 10, 高 || 2.5, 1);
    return sp;
  }

  function 路灯(g, x, z, 真光) {
    高盒(g, X(x), .02, Z(z), .18, 6.4, .18, 钢);
    只障(X(x), Z(z), .18, 6.4, .18);
    高盒(g, X(x) + .7, 6.1, Z(z), 1.4, .12, .12, 钢);
    高盒(g, X(x) + 1.3, 5.9, Z(z), .7, .12, .4, 独纯(0xd9dfc4, 1));
    if (真光) {
      var L = new THREE.PointLight(0xd9dfc4, .42, 28, 2);
      L.position.set(X(x) + 1.0, 6.0, Z(z)); g.add(L);
    }
  }

  function 废弃车(g, x, z, 旋) {
    var h = 高盒(g, X(x), .02, Z(z), 4.2, 1.0, 1.9, 锈);
    h.rotation.y = 旋 || 0;
    高盒(g, X(x), 1.0, Z(z), 2.2, .7, 1.7, 暗).rotation.y = 旋 || 0;
    /* 旋转车的碰撞按外接盒估，宁可略大也别让人穿车 */
    只障(X(x), Z(z), 4.2, 1.7, 2.6);
  }

  /* 静态零件合并：地图砌完后，把同材质的 Mesh 烘成一个 BufferGeometry。
     这样静态地图的 draw call 从“上千块零件”降到“材质批次数”；
     容器/撤离点/敌人/枪模都是合并之后才加入，仍然是独立对象，状态互不影响。 */
  function 合并静态(g) {
    /* 规模上限来自地图配置（20 万方块）。单一批次的顶点数封顶，超了就 flush 成新 Mesh，
       这样即使单图塞满 20 万块也只是多几个 draw call，不会把 JS 数组撑爆。 */
    var 每批顶点上限 = 180000;   /* 约 1.8 万个 BoxGeometry，留足 Uint16/内存余量 */
    var 批 = {}, 原 = [], 件数 = 0, 批数 = 0;
    g.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.material || Array.isArray(o.material)) return;
      if (o.userData && o.userData.dynamic) return;
      原.push(o);
      var 材 = o.material;
      /* 同一张贴图 + 同样的透明/双面/深度设置 → 一个批次；颜色烘进顶点色，
         这样“钢色/锈色/木色”不再各自开一个材质，静态批次能从 20 降到个位数。 */
      var k = 材.type + '|' + (材.map ? 材.map.uuid : '无图') + '|'
        + (材.transparent ? 1 : 0) + '|' + (材.opacity == null ? 1 : 材.opacity) + '|'
        + (材.side || 0) + '|' + (材.depthWrite === false ? 0 : 1);
      if (!批[k]) 批[k] = { 材: 材, 位: [], 法: [], uv: [], 色: [] };
      o.updateWorldMatrix(true, false);
      var geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      var p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
      var c = (材.color && 材.color.clone) ? 材.color : new THREE.Color(0xffffff);
      if (p) for (var i = 0; i < p.count; i++) {
        批[k].位.push(p.getX(i), p.getY(i), p.getZ(i));
        批[k].色.push(c.r, c.g, c.b);
      }
      if (n) for (i = 0; i < n.count; i++) 批[k].法.push(n.getX(i), n.getY(i), n.getZ(i));
      if (u) for (i = 0; i < u.count; i++) 批[k].uv.push(u.getX(i), u.getY(i));
      件数++;
      /* 达到单批顶点上限：先把这一批烘出去，再开新批（规模再大也不会爆数组） */
      if (批[k].位.length / 3 >= 每批顶点上限) {
        flush(批[k]);
        批[k] = { 材: 材, 位: [], 法: [], uv: [], 色: [] };
      }
      geo.dispose();
    });
    function flush(b) {
      if (!b.位.length) return;
      var geo2 = new THREE.BufferGeometry();
      geo2.setAttribute('position', new THREE.Float32BufferAttribute(b.位, 3));
      if (b.法.length === b.位.length) geo2.setAttribute('normal', new THREE.Float32BufferAttribute(b.法, 3));
      if (b.uv.length === (b.位.length / 3) * 2) geo2.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo2.setAttribute('color', new THREE.Float32BufferAttribute(b.色, 3));
      if (!geo2.attributes.normal) geo2.computeVertexNormals();
      geo2.computeBoundingSphere();
      var 源 = b.材, 参 = {
        map: 源.map || null, vertexColors: true,
        transparent: !!源.transparent, opacity: 源.opacity == null ? 1 : 源.opacity,
        side: 源.side || THREE.FrontSide, depthWrite: 源.depthWrite !== false
      };
      var mat = 源.type === 'MeshBasicMaterial'
        ? new THREE.MeshBasicMaterial(参)
        : new THREE.MeshLambertMaterial(参);
      var mesh = new THREE.Mesh(geo2, mat);
      mesh.receiveShadow = 源.type !== 'MeshBasicMaterial';
      mesh.frustumCulled = true;
      g.add(mesh); 批数++;
    }
    /* 烘出所有残留批（含被切批后剩下的尾巴） */
    for (var kk in 批) if (Object.prototype.hasOwnProperty.call(批, kk)) flush(批[kk]);
    原.forEach(function (o) { if (o.parent) o.parent.remove(o); try { o.geometry.dispose(); } catch (e) { } });
    g.userData.静态批次 = 批数;
    g.userData.静态零件 = 原.length;
    g.userData.方块上限 = (typeof RAID地图方块上限 === 'function') ? RAID地图方块上限() : 200000;
    g.userData.合并件数 = 件数;
  }

  function 建场() {
    初始化材质();
    var g = new THREE.Group(); g.name = '灰港·北岸仓储区';
    var obs = [], tp = [], info = { stairs: [], floors: [], windows: [], roofs: [], doors: [], oval: [] };
    var 存 = [_mapTarget, _obsTarget, _tpTarget, _infoTarget];
    _mapTarget = g; _obsTarget = obs; _tpTarget = tp; _infoTarget = info;
    try {
      /* 地面 */
      var 地 = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), 地材);
      地.rotation.x = -Math.PI / 2; 地.position.y = .01; 地.receiveShadow = true; g.add(地);
      /* 海面：南侧 z380..400，低 1.5m */
      var 水 = new THREE.Mesh(new THREE.PlaneGeometry(400, 24), 水材);
      水.rotation.x = -Math.PI / 2; 水.position.set(0, -1.5, Z(388)); g.add(水);
      /* 北侧山体：视觉土坡 + 边界；不参与可走区域 */
      for (var h = 0; h < 5; h++) {
        var hx = -200 + h * 95;
        高盒(g, hx, .02, Z(12), 100, 9 + (h % 3) * 2, 36, 独材('水泥', 0x4a5148));
      }
      /* 西侧林地 */
      for (var t = 0; t < 56; t++) {
        var tx = 12 + (t * 37) % 70, tz = 150 + (t * 53) % 120;
        if (tx > 78 && tz > 120 && tz < 270) continue;
        树(g, tx, tz);
      }
      /* 边界：北/西/东 + 南侧留码头缺口 */
      addBox(0, Z(10), 400, 6, 1.2, 暗, 'border');
      addBox(X(10), 0, 1.2, 6, 400, 暗, 'border');
      addBox(X(390), 0, 1.2, 6, 400, 暗, 'border');
      addBox(X(150), Z(390), 300, 4, 1.2, 暗, 'border');
      addBox(X(370), Z(390), 60, 4, 1.2, 暗, 'border');
      addBox(X(320), Z(398), 40, 4, 1.2, 暗, 'border');
      /* 九条道路：绝对坐标 → 居中 */
      var 路表 = [
        [180, 0, 20, 400], [0, 180, 400, 20], [40, 120, 320, 10],
        [40, 260, 320, 10], [80, 120, 10, 150], [310, 120, 10, 150],
        [280, 260, 10, 140], [110, 40, 8, 80], [40, 95, 130, 8]
      ];
      路表.forEach(function (r) {
        地面块(g, X(r[0] + r[2] / 2), Z(r[1] + r[3] / 2), r[2], r[3], 路, .03);
      });
      /* 中央广场 + 斑马线 */
      地面块(g, X(200), Z(200), 80, 80, 独材('沥青', 0x929da2), .035);
      for (var z = 46; z < 390; z += 10) {
        if (z > 176 && z < 204) continue;
        高盒(g, X(190), .04, Z(z), .18, .02, 4.4, 漆);
      }
      for (var x = 46; x < 390; x += 10) {
        if (x > 176 && x < 204) continue;
        高盒(g, X(x), .04, Z(190), 4.4, .02, .18, 漆);
      }
      for (var zb = 0; zb < 8; zb++) {
        高盒(g, X(185 + zb * 1.7), .045, Z(184), .9, .02, 8, 漆);
        高盒(g, X(185 + zb * 1.7), .045, Z(266), .9, .02, 6, 漆);
      }
      /* 20 栋建筑 + 特殊结构 */
      (RAID_MAP_BUILDINGS || []).forEach(function (b) {
        if (b.kind === 'yard') 集装箱堆场(g, b);
        else if (b.kind === 'tanks') 油罐区(g, b);
        else if (b.kind === 'rail') 铁路区(g, b);
        else if (b.kind === 'dock') 码头区(g, b);
        else if (b.kind === 'power') 变电站(g, b);
        else if (b.kind === 'cave') 山洞(g, b);
        else 楼(g, b);
      });
      /* 设计图的七个区域名：放在区域入口/中心上方，玩家一眼知道自己在哪 */
      [[105, 105, '北区·仓储区', '#8fb8d8'], [310, 95, '东北区·工业区', '#d8a06a'],
       [160, 255, '中区·镇中心', '#d8c08a'], [210, 330, '南区·居民与码头', '#9fc0a0'],
       [45, 220, '西区·林地', '#8fc09a'], [345, 225, '东区·变电站', '#b8a0d8'],
       [200, 200, '中央枢纽', '#ffd166']].forEach(function (z) {
        var sp = 做标牌(z[2], z[3], 14, 3.5);
        sp.position.set(X(z[0]), 7.2, Z(z[1]));
        g.add(sp);
      });
      /* 路灯 / 废弃车 / 掩体 */
      [[35, 170, 1], [100, 170, 0], [200, 170, 1], [300, 170, 0], [365, 170, 0],
       [35, 300, 0], [110, 300, 1], [200, 300, 0], [300, 300, 1], [365, 300, 0]].forEach(function (p) {
        路灯(g, p[0], p[1], p[2]);
      });
      [[214, 136, .2], [300, 242, -.5], [150, 276, .8], [245, 206, 1.2]].forEach(function (p) { 废弃车(g, p[0], p[1], p[2]); });
      for (var b = 0; b < 26; b++) {
        var bx = 20 + (b * 47) % 360, bz = 40 + (b * 71) % 330;
        if (bx > 160 && bx < 240 && bz > 160 && bz < 240) continue;
        高盒(g, X(bx), .02, Z(bz), 1.6, 1.1, 1.2, 木);
        只障(X(bx), Z(bz), 1.6, 1.1, 1.2);
      }
      /* 静态地图在容器/撤离/敌人加入之前合并，避免把可交互对象烘死。
         ?noMerge=1 只给性能对照探针用，正常游戏永远走合并。 */
      var 静态数 = 0;
      g.traverse(function (o) { if (o.isMesh) 静态数++; });
      g.userData.静态零件 = 静态数;
      if (!/[?&]noMerge=1/.test(location.search)) 合并静态(g);
    } finally {
      _mapTarget = 存[0]; _obsTarget = 存[1]; _tpTarget = 存[2]; _infoTarget = 存[3];
    }
    return { 组: g, 障碍: obs, 传送: tp, 信息: info };
  }

  /* 容器编号牌：按点位表顺序 1..116 的全局数字牌，清晰可见。
     用 canvas 画圆角黑底 + 亮边 + 大号数字，Sprite 始终朝向相机；
     稀有度用边框颜色区分，和原图五色一致。牌挂在容器组上，2F 容器自动跟着抬高。 */
  var 稀色 = ['#d6dee2', '#5fd08a', '#5fa8e6', '#b07de0', '#f2c14e'];
  function 做容器编号牌(号, 稀, 层) {
    var c = document.createElement('canvas');
    c.width = 160; c.height = 160;
    var x = c.getContext('2d');
    var 色 = 稀色[稀 | 0] || 稀色[0];
    x.fillStyle = 'rgba(8,13,17,.92)';
    x.strokeStyle = 色; x.lineWidth = 7;
    x.beginPath();
    x.roundRect ? x.roundRect(8, 8, 144, 144, 26) : x.rect(8, 8, 144, 144);
    x.fill(); x.stroke();
    x.fillStyle = 色;
    x.font = 'bold 82px "Microsoft YaHei","Noto Sans SC",sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(号), 80, 84);
    /* 二楼容器加一条顶部横线，远处也能分辨楼层 */
    if (层 === 2) {
      x.strokeStyle = '#ffd166'; x.lineWidth = 6;
      x.beginPath(); x.moveTo(34, 24); x.lineTo(126, 24); x.stroke();
    }
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(2.3, 2.3, 1);
    sp.renderOrder = 20;
    return sp;
  }

  /* 容器碰撞：每个箱子都登记一个能挡住玩家的盒。2F 容器用 y0/y1 放在楼板上。
     没有它，116 个箱子就是"看得见撞不到"的幽灵模型。 */
  function 容器碰盒(c, p) {
    if (!_obsTarget && !obstacles) return;
    var 宽 = 2.0, 深 = 1.6, 高 = 1.3;
    if (p.型 === 'crate_weapon') { 宽 = 2.6; 深 = 1.3; 高 = 1.25; }
    else if (p.型 === 'safe_vault') { 宽 = 1.7; 深 = 1.4; 高 = 1.8; }
    else if (p.型 === 'crate_med') { 宽 = 1.6; 深 = 1.2; 高 = 1.15; }
    else if (p.型 === 'tool_box') { 宽 = 1.8; 深 = 1.2; 高 = .95; }
    else if (p.型 === 'bag_travel') { 宽 = 2.2; 深 = 1.3; 高 = 1.0; }
    var y0 = (c.层 === 2) ? 4.42 : 0, y1 = y0 + 高;
    var o = {
      cx: c.x, cz: c.z, w: 宽, d: 深, h: 高, y0: y0, y1: y1, kind: 'container',
      minX: c.x - 宽 / 2, maxX: c.x + 宽 / 2,
      minZ: c.z - 深 / 2, maxZ: c.z + 深 / 2
    };
    if (_obsTarget) _obsTarget.push(o); else obstacles.push(o);
  }

  function 布容器() {
    RAID_局.容器.length = 0;
    var 基 = (RAID_局.种子 || 1) >>> 0;
    /* 布容器在建场之后调用，此时 _obsTarget 已还原；碰撞盒直接进全局 obstacles */
    var 存观察 = _obsTarget;
    _obsTarget = obstacles;
    try {
      for (var i = 0; i < (RAID_MAP_CONTAINERS || []).length; i++) {
        var p = RAID_MAP_CONTAINERS[i];
        var c = RAID生成容器(p.型, (基 ^ Math.imul(i + 1, 2654435761)) >>> 0, p.区 || '灰港');
        c.x = X(p.x); c.z = Z(p.z); c.层 = p.层 || 1;
        c.原图号 = p.id;
        c.编号 = (typeof RAID容器编号 === 'function') ? RAID容器编号(i) : (i + 1);
        c.模型 = 灰港_做容器(p.型, c.x, c.z);
        if (c.层 === 2 && c.模型 && c.模型.组) c.模型.组.position.y = 4.42;
        /* 编号牌挂在容器组上：2F 容器抬高时牌一起抬，始终清晰可见 */
        if (c.模型 && c.模型.组) {
          var 牌 = 做容器编号牌(c.编号, p.稀, c.层);
          牌.position.set(0, 2.6, 0);
          c.模型.组.add(牌);
          c.模型.编号牌 = 牌;
        }
        容器碰盒(c, p);
        RAID_局.容器.push(c);
      }
    } finally { _obsTarget = 存观察; }
  }

  function 区心() {
    var o = {};
    (RAID_MAP_GANG.区 || []).forEach(function (z) { o[z.id] = { x: X(z.x), z: Z(z.z) }; });
    return o;
  }

  window.灰港_建场 = 建场;
  window.灰港_布容器 = 布容器;
  window.灰港区心 = 区心();
  /* 楼层与编号对外查询：一楼二楼默认开放、无权限；容器编号按原图点位表 1..116 */
  window.灰港楼层状态 = function (层) {
    if (typeof RAID楼层状态 === 'function') return RAID楼层状态(层);
    return { 层: 层, 开放: true, 需权限: false, 可通行: true, 可访问: true };
  };
  window.灰港容器编号表 = function () {
    return (typeof RAID容器编号表 === 'function') ? RAID容器编号表() : [];
  };
})();
