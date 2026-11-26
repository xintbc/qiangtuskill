/* 【1.12.0】搜打撤 · 物品与容量底座（js/75_搜打撤_物品.js）===============================
   这个文件负责三件事，别往里塞别的：
     ① **二维格子容器**：仓库 / 胸挂 / 背包 / 保险箱内部，全用同一套放置逻辑（不做旋转）
     ② **存档** gunGame.raid.v1：读写、默认值、旧档迁移、坏档降级（旧档绝不能读崩）
     ③ **保险结算**：死亡时哪些保住、哪些丢失、凭证能赎哪一件

   ⚠️ 四条纪律：
     ① 物品实例（下面叫「件」）的形状是 { u, id, n, x, y, 内 }：
          u  唯一 id（存档里唯一，也是"这堆是不是同一堆"的判据）
          id 指向 RAID_ITEMS 的定义
          n  数量（不可堆叠的一律 1）
          x/y 在**所在容器**里的左上角格坐标
          内 子容器 {id, 件:[]}（只有保险箱这类有；胸挂/背包作为装备槽时也用它）
        所有字段都是纯数据 —— 能直接 JSON.stringify 进存档，不含 THREE 对象、不含 DOM。
     ② 位置一律"格子坐标"，不是像素。UI 再乘格子尺寸 —— 这样换分辨率、换手机都不用改数据。
     ③ 任何放置失败都必须返回**中文原因**（空间不足 / 超重 / 只能放弹药），由 UI 原样显示；
        不许静默失败，也不许自己 console.warn 了事。
     ④ 首次加载就把 RAID_档 建好。js/78 是后加载的，所以这里**不能**在解析期碰 RAID_。
*/

/* ==================== 唯一 id ==================== */
var _raidUidSeq = 0;
function RAID新id() {
  _raidUidSeq = (_raidUidSeq + 1) % 46656;
  return 'r' + Date.now().toString(36).slice(-5) + _raidUidSeq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

/* ==================== 件 ==================== */
/* 新建一件（不放进任何容器）。n 会被定义里的堆叠上限夹住。 */
function RAID新件(id, n, 耐) {
  var d = RAID物品(id);
  if (!d) return null;
  var 数 = Math.max(1, Math.min(d.叠 || 1, n == null ? 1 : (n | 0)));
  var 件 = { u: RAID新id(), id: id, n: 数, x: 0, y: 0 };
  if (耐 != null) 件.耐 = 耐;
  if (d.容) 件.内 = { id: id, 件: [] };      /* 容器类物品自带内层 */
  return 件;
}
function RAID件定义(件) { return 件 ? RAID物品(件.id) : null; }
function RAID件名(件) { var d = RAID件定义(件); return d ? d.名 : '未知物品'; }

/* 单件重量：容器类物品要把内层一起算（背着保险箱跑不动就是这个道理） */
function RAID件重(件) {
  var d = RAID件定义(件); if (!d) return 0;
  var w = d.重 * (件.n || 1);
  if (件.内) w += RAID容器重(件.内);
  return Math.round(w * 1000) / 1000;
}
function RAID件价(件) {
  var d = RAID件定义(件); if (!d) return 0;
  var v = d.价 * (件.n || 1);
  /* 护甲/头盔带当前耐久时按剩余比例折价 —— 打烂的甲不能按全新价回收。
     没记耐久的旧件仍按原价算，老存档不会突然贬值。 */
  if (d.耐 && 件.耐 != null) v *= Math.max(.05, Math.min(1, (件.耐 | 0) / d.耐));
  if (件.内) v += RAID容器价(件.内);
  return Math.round(v);
}
/* 穿在身上的甲/盔没有件对象（槽里只有 id），耐久记在 装备耐久 里，
   结算与仓库估值都要按同一套损耗规则折价。 */
function RAID装备估值(键) {
  var s = RAID档(), id = s.装备 && s.装备[键], d = id ? RAID物品(id) : null;
  if (!d || !d.耐 || !d.价) return 0;
  var 记 = s.装备耐久 && s.装备耐久[键];
  var 值 = (记 && 记.id === id) ? (记.值 | 0) : (d.耐 | 0);
  return Math.round(d.价 * Math.max(.05, Math.min(1, 值 / d.耐)));
}

/* ==================== 容器 ==================== */
/* 容器的两种形态：
     · 仓库：{宽, 高, 载, 件:[]}                 —— 尺寸写在容器上
     · 胸挂/背包/保险内层：{id, 件:[]}           —— 尺寸查物品定义（改装备定义即改容量）
   下面三个函数把两种形态统一成「格 / 载重 / 收哪些类」。 */
function RAID容器格(容器) {
  if (!容器) return [0, 0];
  if (容器.宽 && 容器.高) return [容器.宽, 容器.高];
  var d = RAID物品(容器.id);
  return d && d.容 ? [d.容[0], d.容[1]] : [0, 0];
}
function RAID容器载(容器) {
  if (!容器) return 0;
  if (容器.载 != null && !容器.id) return 容器.载;
  var d = RAID物品(容器.id);
  return d && d.载 ? d.载 : (容器.载 || 0);
}
function RAID容器收(容器) {
  var d = 容器 && 容器.id ? RAID物品(容器.id) : null;
  return (d && d.收) || null;                 /* null = 什么都能放 */
}
function RAID容器名(容器) {
  if (!容器) return '（无）';
  if (容器.id) { var d = RAID物品(容器.id); return d ? d.名 : '（未知容器）'; }
  return '仓库';
}

/* 占用图：true＝这一格已经被占。跳过某件时把它自己排除（移动/换位要用） */
function RAID占格图(容器, 跳过u) {
  var 格 = RAID容器格(容器), W = 格[0], H = 格[1];
  var 图 = new Array(W * H), i;
  for (i = 0; i < 图.length; i++) 图[i] = 0;
  var 件表 = (容器 && 容器.件) || [];
  for (i = 0; i < 件表.length; i++) {
    var it = 件表[i];
    if (跳过u && it.u === 跳过u) continue;
    var d = RAID物品(it.id); if (!d) continue;
    var w = d.格[0], h = d.格[1], xx, yy;
    for (yy = 0; yy < h; yy++) for (xx = 0; xx < w; xx++) {
      var gx = it.x + xx, gy = it.y + yy;
      if (gx >= 0 && gy >= 0 && gx < W && gy < H) 图[gy * W + gx] = 1;
    }
  }
  return 图;
}

/* 能不能把这个尺寸的东西放到 (x,y) —— 不检查重量与类别，那是 RAID放入 的事 */
function RAID格能放(容器, w, h, x, y, 跳过u) {
  var 格 = RAID容器格(容器), W = 格[0], H = 格[1];
  if (w <= 0 || h <= 0) return false;
  if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
  var 图 = RAID占格图(容器, 跳过u);
  for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
    if (图[(y + yy) * W + (x + xx)]) return false;
  }
  return true;
}

/* 首次适配：从左上往右下扫第一个塞得下的位置；塞不下返回 null */
function RAID找位(容器, w, h, 跳过u) {
  var 格 = RAID容器格(容器), W = 格[0], H = 格[1];
  for (var y = 0; y <= H - h; y++) {
    for (var x = 0; x <= W - w; x++) {
      if (RAID格能放(容器, w, h, x, y, 跳过u)) return { x: x, y: y };
    }
  }
  return null;
}

function RAID容器重(容器) {
  var s = 0, 件表 = (容器 && 容器.件) || [];
  for (var i = 0; i < 件表.length; i++) s += RAID件重(件表[i]);
  return Math.round(s * 1000) / 1000;
}
function RAID容器价(容器) {
  var s = 0, 件表 = (容器 && 容器.件) || [];
  for (var i = 0; i < 件表.length; i++) s += RAID件价(件表[i]);
  return s;
}
function RAID容器件数(容器) {
  var s = 0, 件表 = (容器 && 容器.件) || [];
  /* 用 n|0 而不是 n||1：n=0 的幽灵堆（早期并堆 bug 留下的）不该被当成 1 个 */
  for (var i = 0; i < 件表.length; i++) s += Math.max(0, 件表[i].n | 0);
  return s;
}
function RAID容器格数(容器) {
  var 格 = RAID容器格(容器), 图 = RAID占格图(容器), n = 0, i;
  for (i = 0; i < 图.length; i++) if (图[i]) n++;
  return { 用: n, 共: 格[0] * 格[1] };
}

/* ==================== 放置 / 取出 / 堆叠 / 拆分 ====================
   RAID放入(容器, 件, x, y, 跳过u) 统一返回 { ok:true, x, y } 或 { ok:false, 因:'中文原因' }。
   x/y 不填＝首次适配。跳过u 用于"同容器内换位"。 */
function RAID放入(容器, 件, x, y, 跳过u) {
  if (!容器 || !件) return { ok: false, 因: '容器或物品为空' };
  var d = RAID件定义(件);
  if (!d) return { ok: false, 因: '未知物品' };
  if ((件.n | 0) <= 0) return { ok: false, 因: '数量为 0，放不进去' };

  /* ① 类别准入（胸挂只收小件、封存筒只收任务物） */
  var 收 = RAID容器收(容器);
  if (收 && 收.indexOf(d.类) < 0) {
    return { ok: false, 因: RAID容器名(容器) + ' 只能放' + 收.join(' / ') };
  }
  /* ② 单件价值上限（帆布保险袋） */
  if (RAID容器id上限(容器) && d.价 * (件.n || 1) > RAID容器id上限(容器)) {
    return { ok: false, 因: '这件太贵了，保险袋装不下（上限 ' + RAID容器id上限(容器) + '）' };
  }
  /* ③ 重量 */
  var 上限 = RAID容器载(容器);
  if (上限 > 0) {
    var 现 = RAID容器重(容器);
    if (跳过u) { /* 换位：先把这一件自己的重量去掉 */
      var 旧 = RAID取件(容器, 跳过u);
      if (旧) 现 -= RAID件重(旧);
    }
    if (现 + RAID件重(件) > 上限 + 1e-6) {
      return { ok: false, 因: '超重（' + (现 + RAID件重(件)).toFixed(1) + '/' + 上限 + 'kg）' };
    }
  }
  /* ④ 格子 */
  var w = d.格[0], h = d.格[1], 位;
  if (x == null || y == null) {
    位 = RAID找位(容器, w, h, 跳过u);
    if (!位) return { ok: false, 因: '空间不足（需要 ' + w + '×' + h + ' 格）' };
  } else {
    if (!RAID格能放(容器, w, h, x, y, 跳过u)) return { ok: false, 因: '这里放不下（' + w + '×' + h + ' 格被占或越界）' };
    位 = { x: x, y: y };
  }
  件.x = 位.x; 件.y = 位.y;
  容器.件.push(件);
  return { ok: true, x: 位.x, y: 位.y };
}

/* 目标容器里能并进去的同 id 堆。
   指定了落点 → 只认落点压着的那一件（拖到另一堆上＝合并，拖到空格＝分开放）；
   没指定落点（按钮、双击快移）→ 找任意没满的堆。 */
function RAID找并堆(容器, id, x, y, 跳过u) {
  var d = RAID物品(id);
  if (!d || (d.叠 || 1) <= 1) return null;
  var 表 = (容器 && 容器.件) || [], i;
  for (i = 表.length - 1; i >= 0; i--) if ((表[i].n | 0) <= 0) 表.splice(i, 1);
  if (x != null && y != null) {
    for (i = 0; i < 表.length; i++) {
      var a = 表[i];
      if (a.id !== id || (a.n || 1) >= d.叠) continue;
      if (跳过u && a.u === 跳过u) continue;
      if (x >= a.x && x < a.x + d.格[0] && y >= a.y && y < a.y + d.格[1]) return a;
    }
    return null;
  }
  for (i = 0; i < 表.length; i++) {
    var b = 表[i];
    if (b.id !== id || (b.n || 1) >= d.叠) continue;
    if (跳过u && b.u === 跳过u) continue;
    return b;
  }
  return null;
}

/* 落在 (x,y) 这一格上的那件（用来把"这堆满了"和"这格被别的东西占着"分开说） */
function RAID格上件(容器, x, y) {
  var 表 = (容器 && 容器.件) || [], i;
  for (i = 0; i < 表.length; i++) {
    var it = 表[i], d = RAID物品(it.id);
    if (!d) continue;
    if (x >= it.x && x < it.x + d.格[0] && y >= it.y && y < it.y + d.格[1]) return it;
  }
  return null;
}

/* 把 it 并进 目标堆：返回 { 并了多少, 还剩多少 }（it.n 会被扣） */
function RAID并进去(目标堆, it, d) {
  var 空 = (d.叠 || 1) - (目标堆.n | 0 || 1);
  var 有 = Math.max(0, it.n | 0);
  var 拿 = Math.min(Math.max(0, 空), 有);
  if (拿 > 0) { 目标堆.n = (目标堆.n | 0 || 1) + 拿; it.n = 有 - 拿; }
  /* 余数必须用 it.n|0 —— 写 it.n||1 的话，正好并干净（n=0）时会返回 1，
     调用方以为"还剩一个"，于是把 n=0 的幽灵堆又推回容器。 */
  return { 并: 拿, 余: Math.max(0, it.n | 0) };
}

/* 把一个容器里同 id 的碎堆合并成尽量少的堆（不动位置）
   返回并掉的件数。拆分是玩家主动的，所以只在「整理」「买入」这类动作里调。 */
function RAID合并同id(容器) {
  var 表 = (容器 && 容器.件) || [], i, j, 合 = 0;
  /* 先把 n<=0 的幽灵堆清掉（早期 bug 的遗留，留着会被当成 1 个无限刷） */
  for (i = 表.length - 1; i >= 0; i--) if ((表[i].n | 0) <= 0) 表.splice(i, 1);
  for (i = 0; i < 表.length; i++) {
    var a = 表[i], da = RAID物品(a.id);
    if (!da || (da.叠 || 1) <= 1) continue;
    for (j = i + 1; j < 表.length;) {
      var b = 表[j];
      if (b.id !== a.id) { j++; continue; }
      var r = RAID并进去(a, b, da);
      合 += r.并;
      if (r.余 <= 0) 表.splice(j, 1);        /* b 空了，删掉这堆 */
      else j++;
      if ((a.n || 1) >= (da.叠 || 1)) break; /* 这堆满了，剩下的留给后面的 a */
    }
  }
  return 合;
}

/* 保险袋那种「单件价值上限」写在定义里 */
function RAID容器id上限(容器) {
  var d = 容器 && 容器.id ? RAID物品(容器.id) : null;
  return (d && d.单限) || 0;
}

function RAID取件(容器, u) {
  if (!容器 || !容器.件) return null;
  for (var i = 0; i < 容器.件.length; i++) if (容器.件[i].u === u) return 容器.件[i];
  return null;
}
function RAID取出(容器, u) {
  if (!容器 || !容器.件) return null;
  for (var i = 0; i < 容器.件.length; i++) {
    if (容器.件[i].u === u) { var it = 容器.件[i]; 容器.件.splice(i, 1); return it; }
  }
  return null;
}

/* 加入若干个：优先并进已有的同 id 堆（且都没到上限），剩下的开新堆。
   返回 { ok:数, 因:'' }；一个也放不进时 ok=0 且给中文原因。 */
function RAID加入(容器, id, n) {
  var d = RAID物品(id);
  if (!d) return { ok: 0, 因: '未知物品' };
  var 剩 = n | 0, 加 = 0, i;
  if (d.叠 > 1) {
    var 件表 = 容器.件 || [];
    for (i = 0; i < 件表.length && 剩 > 0; i++) {
      var it = 件表[i];
      if (it.id !== id) continue;
      var 空 = d.叠 - (it.n || 1);
      if (空 <= 0) continue;
      var 拿 = Math.min(空, 剩);
      it.n = (it.n || 1) + 拿; 剩 -= 拿; 加 += 拿;
    }
  }
  while (剩 > 0) {
    var 批 = Math.min(d.叠 || 1, 剩);
    var 件 = RAID新件(id, 批);
    var r = RAID放入(容器, 件);
    if (!r.ok) {
      if (加 === 0) return { ok: 0, 因: r.因 };
      break;                                   /* 放了一部分就停，别把已经放进去的退回 */
    }
    剩 -= 批; 加 += 批;
  }
  return { ok: 加, 因: '' };
}

/* 拆分：把 u 这一堆分出 n 个，新的一堆需要有空位（同容器内） */
function RAID拆分(容器, u, n) {
  var it = RAID取件(容器, u);
  if (!it) return { ok: false, 因: '物品不在了' };
  var d = RAID件定义(it);
  if (!d || d.叠 <= 1) return { ok: false, 因: '这件不能拆分' };
  var 总 = it.n || 1;
  if (n <= 0 || n >= 总) return { ok: false, 因: '拆出的数量要在 1 ~ ' + (总 - 1) + ' 之间' };
  var 新 = RAID新件(it.id, n);
  var r = RAID放入(容器, 新);
  if (!r.ok) return { ok: false, 因: r.因 };
  it.n = 总 - n;
  return { ok: true, 新: 新 };
}

/* 一键整理：按「面积大的先放、同面积贵的先放」重排，尽量腾出连续空间 */
function RAID整理(容器) {
  if (!容器 || !容器.件) return;
  /* 「整理」本来就该把拆散的碎堆并回去 —— 否则玩家只能靠猜哪两堆能合 */
  RAID合并同id(容器);
  var 表 = 容器.件.slice();
  表.sort(function (a, b) {
    var da = RAID物品(a.id), db = RAID物品(b.id);
    var aa = da ? da.格[0] * da.格[1] : 0, ab = db ? db.格[0] * db.格[1] : 0;
    if (ab !== aa) return ab - aa;
    return RAID件价(b) - RAID件价(a);
  });
  容器.件 = [];
  for (var i = 0; i < 表.length; i++) {
    var it = 表[i], d = RAID物品(it.id);
    if (!d) continue;
    var 位 = RAID找位(容器, d.格[0], d.格[1]);
    if (!位) { 容器.件.push(it); continue; }     /* 理论上不会发生：件数是固定的 */
    it.x = 位.x; it.y = 位.y; 容器.件.push(it);
  }
}

/* 搬一件到另一个容器 / 同容器换位。
   ⚠️ 这里绝不能直接调 RAID放入 处理"同容器" —— 放入会 push，而这一件本来就在数组里，
      结果就是同一件出现两次（一次在旧坐标、一次在新坐标），表现成"复制物品"。
      同容器换位只改 x/y 就行，重量与件数都不变。 */
/* 目标容器是不是在 src 这棵"内层树"里（防止把背包放进自己的内层） */
function 环含(目标, 内, 深) {
  if (!内 || 深 > 6) return false;
  if (内 === 目标) return true;
  var 表 = 内.件 || [], i;
  for (i = 0; i < 表.length; i++) if (表[i].内 && 环含(目标, 表[i].内, 深 + 1)) return true;
  return false;
}
function RAID移动(从, u, 到, x, y) {
  if (!从 || !到) return { ok: false, 因: '容器不存在' };
  var it = RAID取件(从, u);
  if (!it) return { ok: false, 因: '物品不在了' };
  var d = RAID件定义(it);
  if (!d) return { ok: false, 因: '未知物品' };
  /* 不许把容器塞进它自己（或它自己内部）：会形成环，之后算重量/画网格会无限递归。 */
  if (从 === 到) { /* 同容器换位，允许 */ }
  else if (it.内 && (到 === it.内 || 环含(到, it.内, 0))) return { ok: false, 因: '不能放进它自己里面' };

  if (从 === 到) {
    /* 拖到同容器里另一堆同 id 的物品上＝合并。以前这里直接报「这里放不下」，
       所以拆分之后两堆永远合不回去。 */
    if (x != null && y != null) {
      var 堆0 = RAID找并堆(到, it.id, x, y, u);
      if (堆0) {
        var r0 = RAID并进去(堆0, it, d);
        if (r0.余 <= 0) { RAID取出(从, u); return { ok: true, x: 堆0.x, y: 堆0.y, 并: r0.并 }; }
        var 位9 = RAID找位(到, d.格[0], d.格[1], u);
        if (!位9) { 堆0.n -= r0.并; it.n += r0.并; return { ok: false, 因: '放不下（合并 ' + r0.并 + ' 个后还剩 ' + r0.余 + ' 个没位置）' }; }
        it.x = 位9.x; it.y = 位9.y;
        return { ok: true, x: it.x, y: it.y, 并: r0.并 };
      }
    }
    if (x == null || y == null) { var 位0 = RAID找位(到, d.格[0], d.格[1], u); if (!位0) return { ok: false, 因: '空间不足' }; x = 位0.x; y = 位0.y; }
    if (!RAID格能放(到, d.格[0], d.格[1], x, y, u)) {
      var 占0 = RAID格上件(到, x, y);
      if (占0 && 占0.id === it.id) return { ok: false, 因: '那堆已经满了（' + (占0.n || 1) + '/' + (d.叠 || 1) + '），换个位置放' };
      return { ok: false, 因: '这里放不下（' + d.格[0] + '×' + d.格[1] + ' 格被占或越界）' };
    }
    it.x = x; it.y = y;
    return { ok: true, x: x, y: y };
  }

  /* 跨容器：**先查、后搬**。查的时候不动任何一边，失败就不用回滚。 */
  var 收 = RAID容器收(到);
  if (收 && 收.indexOf(d.类) < 0) return { ok: false, 因: RAID容器名(到) + ' 只能放' + 收.join(' / ') };
  if (RAID容器id上限(到) && d.价 * (it.n || 1) > RAID容器id上限(到)) {
    return { ok: false, 因: '这件太贵了，保险袋装不下（上限 ' + RAID容器id上限(到) + '）' };
  }
  var 上限 = RAID容器载(到);
  if (上限 > 0 && RAID容器重(到) + RAID件重(it) > 上限 + 1e-6) {
    return { ok: false, 因: '超重（' + (RAID容器重(到) + RAID件重(it)).toFixed(1) + '/' + 上限 + 'kg）' };
  }
  /* 同 id 可叠：目标里已有没满的堆就直接并进去，别再开一堆 */
  var 堆 = RAID找并堆(到, it.id, x, y);
  if (堆) {
    var rr = RAID并进去(堆, it, d);
    if (rr.余 <= 0) { RAID取出(从, u); return { ok: true, x: 堆.x, y: 堆.y, 并: rr.并 }; }
    var 位8 = RAID找位(到, d.格[0], d.格[1]);
    if (!位8) { 堆.n -= rr.并; it.n += rr.并; return { ok: false, 因: '能合并 ' + rr.并 + ' 个，但剩下的 ' + rr.余 + ' 个没位置放' }; }
    RAID取出(从, u);
    it.x = 位8.x; it.y = 位8.y;
    到.件.push(it);
    return { ok: true, x: it.x, y: it.y, 并: rr.并 };
  }
  var 位 = (x == null || y == null) ? RAID找位(到, d.格[0], d.格[1]) : null;
  if (x == null || y == null) {
    if (!位) return { ok: false, 因: '空间不足（需要 ' + d.格[0] + '×' + d.格[1] + ' 格）' };
    x = 位.x; y = 位.y;
  } else if (!RAID格能放(到, d.格[0], d.格[1], x, y)) {
    var 占1 = RAID格上件(到, x, y);
    if (占1 && 占1.id === it.id) return { ok: false, 因: '那堆已经满了（' + (占1.n || 1) + '/' + (d.叠 || 1) + '），换个位置放' };
    return { ok: false, 因: '这里放不下（' + d.格[0] + '×' + d.格[1] + ' 格被占或越界）' };
  }
  RAID取出(从, u);
  it.x = x; it.y = y;
  到.件.push(it);
  return { ok: true, x: x, y: y };
}

/* ==================== 存档 ====================
   键 gunGame.raid.v1，明文 JSON —— 加密由 js/00 的全局拦截负责，这里不用管。
   读档原则：**只认白名单字段 + 逐项夹取**，任何异常都回默认值，绝不让坏档把游戏读崩。 */
var RAID_KEY = 'gunGame.raid.v1';

function RAID默认存档() {
  var 仓 = { 宽: 10, 高: 8, 载: 400, 件: [] };
  var i;
  /* 起始物资：只在"第一次建档"时塞，之后仓库空了也不会再给 */
  for (i = 0; i < RAID_STARTER.length; i++) {
    var id = RAID_STARTER[i][0], n = RAID_STARTER[i][1];
    RAID加入(仓, id, n);
  }
  var 预设 = [];
  for (i = 0; i < RAID_PRESETS.length; i++) {
    var p = RAID_PRESETS[i];
    预设.push({
      名: p.名, 说明: p.说明,
      枪: p.枪.slice(), 弹: p.弹.map(function (x) { return [x[0], x[1]]; })
    });
  }
  return {
    v: 2,
    币: 0,
    仓库: 仓,
    预设: 预设,
    当前预设: 0,
    /* 装备槽：全部从空开始。胸挂/背包是容器形态 {id,件}（装上后它的内层就是容量），
       头盔/护甲只存 id。空 = null。要穿什么，得自己从仓库里拖上去。 */
    装备: { 胸挂: null, 背包: null, 头盔: '', 护甲: '', 枪: [null, null] },
    /* 枪膛里剩的子弹按武器槽存盘：撤离成功才保留，异常中断由 RAID异常中断 清掉。
       准备层卸枪时由 RAID脱枪 退回仓库，避免凭空多出一梭子。 */
    弹匣: [0, 0],
    /* 穿在身上的甲/盔当前耐久（它们是 id 字符串，没有件对象可挂耐），按 id 校验后才生效 */
    装备耐久: { 护甲: { id: '', 值: 0 }, 头盔: { id: '', 值: 0 } },
    /* 进局后置 true，正常结算（撤离/阵亡）清掉；启动时若还是 true = 上次异常中断 */
    局中: false,
    /* 安全箱槽位：id='' 表示不带。它也是从仓库里装上来的（仓库有 ins_* 才能装）。 */
    安全箱: { id: '', 内: null },
    保险: { 凭证: 0 },
    统计: { 局: 0, 撤离: 0, 死亡: 0, 带出: 0, 空箱: 0 },   /* 空箱：连续没摸到东西的次数，搜刮保底用 */
    剧情: { 情报: [], 样本: 0, 终端: 0, 已交付: [] },
    交易: { 挂单: [], 成交: [], 今日兑换: 0, 兑换日: '' },
    迁移: { 从: 0, 时间: 0, 丢弃: 0 }
  };
}

/* 把任意对象"夹"成一个合法容器：未知物品丢掉、数量夹到堆叠上限、
   坐标越界或重叠就重排；实在放不下就丢掉并计数（只有手改存档才会走到这里）。 */
function RAID校验容器(容, 计数) {
  if (!容 || !容.件 || !容.件.length) { if (容) 容.件 = []; return; }
  var 表 = 容.件.slice(), i;
  容.件 = [];
  /* 先按面积从大到小放，避免"小的占了大件的位置"导致大件放不下 */
  表.sort(function (a, b) {
    var da = RAID物品(a && a.id), db = RAID物品(b && b.id);
    var aa = da ? da.格[0] * da.格[1] : -1, ab = db ? db.格[0] * db.格[1] : -1;
    return ab - aa;
  });
  for (i = 0; i < 表.length; i++) {
    var raw = 表[i];
    if (!raw || !raw.id) continue;
    var d = RAID物品(raw.id);
    if (!d) { if (计数) 计数.丢弃++; continue; }
    /* 早期并堆 bug 会在容器里留下 n=0 的幽灵堆：读档时直接清掉，
       否则它会被 n||1 当成 1 个，反复拖就能无限加数量。 */
    if ((raw.n | 0) <= 0) { if (计数) 计数.丢弃++; continue; }
    var 件 = {
      u: (typeof raw.u === 'string' && raw.u) ? raw.u : RAID新id(),
      id: raw.id,
      n: Math.max(1, Math.min(d.叠 || 1, raw.n | 0 || 1)),
      x: 0, y: 0
    };
    if (raw.耐 != null) 件.耐 = Math.max(0, Math.min(100, raw.耐 | 0));
    if (d.容) {
      /* 正规位置是 raw.内.件；raw.件 是早期版本写错留下的野字段，
         读档时一并接回来，免得玩家的旧存档里"背包看着是空的"。
         注意判空：正规位置存在但是空数组时，也要看野字段（脏档正是"内有空壳、货在野外"）。 */
      var 正 = (raw.内 && Array.isArray(raw.内.件)) ? raw.内.件 : null;
      var 野 = Array.isArray(raw.件) ? raw.件 : null;
      var 内表 = (正 && 正.length) ? 正 : ((野 && 野.length) ? 野 : (正 || []));
      件.内 = { id: d.id, 件: 内表 };
      RAID校验容器(件.内, 计数);
    }
    var 位 = RAID找位(容, d.格[0], d.格[1]);
    if (!位) { if (计数) 计数.丢弃++; continue; }
    件.x = 位.x; 件.y = 位.y;
    容.件.push(件);
  }
}

var RAID_档 = null;
var RAID_档错误 = '';

function RAID读档() {
  if (RAID_档) return RAID_档;
  var 原 = null, 坏 = false;
  try { 原 = localStorage.getItem(RAID_KEY); } catch (e) { 原 = null; }
  var 默认 = RAID默认存档();
  if (!原) { RAID_档 = 默认; return RAID_档; }         /* 第一次玩：直接给默认 + 起始物资 */

  var o = null;
  try { o = JSON.parse(原); } catch (e) { 坏 = true; }
  if (!o || typeof o !== 'object') { RAID_档错误 = '存档解析失败，已回默认'; RAID_档 = 默认; return RAID_档; }

  /* —— 逐字段白名单合并：缺的补默认，类型不对的也补默认 —— */
  var 合 = RAID默认存档();
  /* 注意：默认存档里的仓库带起始物资；如果已有存档，得先把这些起始物资清掉，
     否则"老玩家每次读档都白拿一套"。 */
  合.仓库.件 = [];
  for (var i = 0; i < 合.预设.length; i++) {
    if (合.预设[i].胸挂) 合.预设[i].胸挂.件 = [];
    if (合.预设[i].背包) 合.预设[i].背包.件 = [];
  }

  合.币 = Math.max(0, o.币 | 0);
  合.当前预设 = Math.max(0, Math.min(合.预设.length - 1, o.当前预设 | 0));
  /* 老档没有"弹匣"字段：补 0，别读成 undefined 让引擎算出发射数 NaN */
  合.弹匣 = [0, 0];
  if (Array.isArray(o.弹匣)) for (var m = 0; m < 2; m++)
    合.弹匣[m] = Math.max(0, Math.min(99, o.弹匣[m] | 0));
  合.装备耐久 = { 护甲: { id: '', 值: 0 }, 头盔: { id: '', 值: 0 } };
  if (o.装备耐久 && typeof o.装备耐久 === 'object') {
    var 耐表 = ['护甲', '头盔'];
    for (var q = 0; q < 耐表.length; q++) {
      var 旧耐 = o.装备耐久[耐表[q]];
      if (旧耐 && typeof 旧耐 === 'object')
        合.装备耐久[耐表[q]] = { id: typeof 旧耐.id === 'string' ? 旧耐.id : '', 值: Math.max(0, 旧耐.值 | 0) };
    }
  }
  合.局中 = o.局中 === true;
  /* 赛季进度必须跟着存档走：它是安全箱解锁的依据，漏了会让老玩家重进后
     安全箱凭空上锁，箱内物品也被当作非法装备清掉。 */
  if (o.赛季 && typeof o.赛季 === 'object') {
    合.赛季 = {
      撤离: Math.max(0, o.赛季.撤离 | 0),
      情报: Math.max(0, o.赛季.情报 | 0),
      完成: o.赛季.完成 === true
    };
  }

  /* —— 装备与安全箱（1.12.0 阶段 2.5 新增字段）——
     老档没有 装备/安全箱，但没有关系：默认值已经填好了，
     下面再把"以前塞在预设里的那些件"搬进自带装备，一件都不许丢。 */
  /* 装备槽默认是空的，老档里已经穿着的（阶段 2.5 写成 RAID_BUILTIN 那套）保持穿着，
     不做"收回仓库"——那会让老玩家上线发现身上东西没了。 */

  if (o.仓库 && typeof o.仓库 === 'object') {
    合.仓库.宽 = Math.max(4, Math.min(20, o.仓库.宽 | 0 || 10));
    合.仓库.高 = Math.max(4, Math.min(16, o.仓库.高 | 0 || 8));
    合.仓库.载 = Math.max(50, o.仓库.载 | 0 || 400);
    合.仓库.件 = Array.isArray(o.仓库.件) ? o.仓库.件 : [];
  }
  if (Array.isArray(o.预设)) {
    for (var k = 0; k < 合.预设.length && k < o.预设.length; k++) {
      var p = o.预设[k];
      if (!p || typeof p !== 'object') continue;
      if (typeof p.名 === 'string' && p.名) 合.预设[k].名 = p.名.slice(0, 8);
      if (Array.isArray(p.保险)) 合.预设[k].保险 = p.保险.filter(function (x) { return !!RAID保险(x); });
      if (p.胸挂 && p.胸挂.id && RAID物品(p.胸挂.id)) {
        合.预设[k].胸挂 = { id: p.胸挂.id, 件: Array.isArray(p.胸挂.件) ? p.胸挂.件 : [] };
      } else if (p.胸挂 === null) 合.预设[k].胸挂 = null;
      if (p.背包 && p.背包.id && RAID物品(p.背包.id)) {
        合.预设[k].背包 = { id: p.背包.id, 件: Array.isArray(p.背包.件) ? p.背包.件 : [] };
      } else if (p.背包 === null) 合.预设[k].背包 = null;
      if (Array.isArray(p.枪)) 合.预设[k].枪 = p.枪.filter(function (x) { return !!RAID物品(x); });
      if (Array.isArray(p.弹)) 合.预设[k].弹 = p.弹.filter(function (x) { return x && RAID物品(x[0]); }).map(function (x) { return [x[0], Math.max(1, x[1] | 0)]; });
    }
  }
  /* 老档（v1）把胸挂/背包存在每个预设里。现在装备是角色自带的，只有一套，
     所以把各预设里的件全部收进来：先塞自带容器，塞不下就转仓库，还塞不下计数丢弃。
     （物品里可能还有 内 层，整体搬，不拆。） */
  if (Array.isArray(o.预设)) {
    var 搬家 = [];
    for (var q = 0; q < o.预设.length; q++) {
      var pq = o.预设[q];
      if (!pq || typeof pq !== 'object') continue;
      if (pq.胸挂 && Array.isArray(pq.胸挂.件)) 搬家 = 搬家.concat(pq.胸挂.件);
      if (pq.背包 && Array.isArray(pq.背包.件)) 搬家 = 搬家.concat(pq.背包.件);
    }
    for (var m = 0; m < 搬家.length; m++) {
      var it = 搬家[m];
      if (!it || !RAID物品(it.id)) continue;
      var r1 = RAID放入(合.装备.背包, it);
      if (r1.ok) continue;
      var r2 = RAID放入(合.装备.胸挂, it);
      if (r2.ok) continue;
      var r3 = RAID放入(合.仓库, it);
      if (!r3.ok) 合.迁移.丢弃++;
    }
    /* 老档里如果有人配置过保险，把它当成"背包里翻出来的一个箱子"：
       现在安全箱是槽位制，默认那格已经有 ins_bag 了，这里不再自动顶掉玩家的选择。 */
    var 老保 = o.预设[合.当前预设] && o.预设[合.当前预设].保险;
    if (Array.isArray(老保) && 老保.length && RAID保险(老保[0]) && !o.安全箱) {
      var 首 = 老保.filter(function (x) { return x !== 'ins_recover'; })[0];
      if (首 && RAID物品(首)) 合.安全箱 = { id: 首, 内: { id: 首, 件: [] } };
    }
  }
  if (o.装备 && typeof o.装备 === 'object') {
    ['胸挂', '背包'].forEach(function (k) {
      var e = o.装备[k];
      if (e && e.id && RAID物品(e.id) && RAID物品(e.id).容) {
        合.装备[k] = { id: e.id, 件: Array.isArray(e.件) ? e.件 : [] };
      } else {
        合.装备[k] = null;
      }
    });
    if (typeof o.装备.头盔 === 'string' && RAID物品(o.装备.头盔)) 合.装备.头盔 = o.装备.头盔;
    else 合.装备.头盔 = '';
    if (typeof o.装备.护甲 === 'string' && RAID物品(o.装备.护甲)) 合.装备.护甲 = o.装备.护甲;
    else 合.装备.护甲 = '';
    /* 武器槽两个：只认枪类物品，别的 id 一律当空槽 */
    合.装备.枪 = [null, null];
    if (Array.isArray(o.装备.枪)) {
      for (var wi = 0; wi < 2 && wi < o.装备.枪.length; wi++) {
        var wid = typeof o.装备.枪[wi] === 'string' ? o.装备.枪[wi] : (o.装备.枪[wi] && o.装备.枪[wi].id);
        var wd = wid ? RAID物品(wid) : null;
        if (wd && wd.类 === '枪') 合.装备.枪[wi] = wid;
      }
    }
  }
  if (o.安全箱 && typeof o.安全箱 === 'object') {
    var 箱id = o.安全箱.id;
    if (typeof 箱id === 'string' && 箱id && RAID物品(箱id) && RAID物品(箱id).容) {
      合.安全箱 = { id: 箱id, 内: { id: 箱id, 件: (o.安全箱.内 && Array.isArray(o.安全箱.内.件)) ? o.安全箱.内.件 : [] } };
    } else if (箱id === '') {
      合.安全箱 = { id: '', 内: null };
    }
  }
  if (o.保险 && typeof o.保险 === 'object') 合.保险.凭证 = Math.max(0, Math.min(1, o.保险.凭证 | 0));
  if (o.统计 && typeof o.统计 === 'object') {
    ['局', '撤离', '死亡', '带出', '空箱'].forEach(function (k) { 合.统计[k] = Math.max(0, o.统计[k] | 0); });
  }
  if (o.剧情 && typeof o.剧情 === 'object') {
    if (Array.isArray(o.剧情.情报)) 合.剧情.情报 = o.剧情.情报.filter(function (x) { return typeof x === 'string'; }).slice(0, 50);
    合.剧情.样本 = Math.max(0, o.剧情.样本 | 0);
    合.剧情.终端 = Math.max(0, o.剧情.终端 | 0);
    if (Array.isArray(o.剧情.已交付)) 合.剧情.已交付 = o.剧情.已交付.filter(function (x) { return typeof x === 'string'; });
  }
  if (o.交易 && typeof o.交易 === 'object') {
    合.交易.挂单 = Array.isArray(o.交易.挂单) ? o.交易.挂单 : [];
    合.交易.成交 = Array.isArray(o.交易.成交) ? o.交易.成交.slice(-200) : [];
    合.交易.今日兑换 = Math.max(0, o.交易.今日兑换 | 0);
    合.交易.兑换日 = typeof o.交易.兑换日 === 'string' ? o.交易.兑换日.slice(0, 10) : '';
  }
  if (typeof o.v === 'number' && o.v > 0) { 合.迁移.从 = o.v; 合.迁移.时间 = Date.now(); }

  /* 校验所有容器（未知物品丢弃、坐标重排） */
  var 计数 = { 丢弃: 0 };
  RAID校验容器(合.仓库, 计数);
  if (合.装备.胸挂) RAID校验容器(合.装备.胸挂, 计数);
  if (合.装备.背包) RAID校验容器(合.装备.背包, 计数);
  if (合.安全箱 && 合.安全箱.内) RAID校验容器(合.安全箱.内, 计数);
  合.迁移.丢弃 = (合.迁移.丢弃 | 0) + 计数.丢弃;   /* 迁移时塞不下的 + 校验时丢的，一起计 */

  RAID_档 = 合;
  if (坏) RAID_档错误 = '存档损坏，已尽量恢复';
  return RAID_档;
}

/* 写档：一次 setItem。返回 true 才算存住了，UI 必须把 false 告诉玩家。 */
function RAID写档() {
  if (!RAID_档) return false;
  RAID_档.v = 1;
  try {
    localStorage.setItem(RAID_KEY, JSON.stringify(RAID_档));
    return true;
  } catch (e) {
    try { console.warn('[搜打撤] 存档写入失败：' + e); } catch (_e) { }
    return false;
  }
}

/* 对外：取当前存档（懒加载） */
function RAID档() { return RAID_档 || RAID读档(); }
function RAID当前预设() {
  var s = RAID档();
  return s.预设[s.当前预设] || s.预设[0];
}

/* ==================== 装备槽 ====================
   1.12.0 阶段 2.6：装备**不是白给的**，槽位里放什么取决于仓库里有什么。
     穿：从仓库取走那件物品 → 槽位拿到 {id,件}（它的内层就是容量）
     脱：把槽位那件整体放回仓库（放不下就拒绝，绝不凭空消失）
   函数名 RAID预设胸挂/背包 保留：js/78 与自检到处在用，只是语义变成"当前装上的那件"。 */
function RAID自带(名) {
  var s = RAID档();
  return s && s.装备 ? s.装备[名] : null;
}
function RAID预设胸挂() { return RAID自带('胸挂'); }
function RAID预设背包() { return RAID自带('背包'); }
function RAID头盔() { var id = RAID自带('头盔'); return id ? RAID物品(id) : null; }
function RAID护甲() { var id = RAID自带('护甲'); return id ? RAID物品(id) : null; }

/* 槽位键 ←→ 容器/物品类别：'胸挂'|'背包'|'头盔'|'护甲'|'安全箱' */
function RAID槽配置(键) {
  for (var i = 0; i < RAID_槽位.length; i++) if (RAID_槽位[i].键 === 键) return RAID_槽位[i];
  return null;
}
/* 仓库里（只翻顶层）某一类的东西有多少件，给安全箱窗口与装备提示用 */
function RAID仓里有(类) {
  var s = RAID档(), 出 = [], i;
  for (i = 0; i < s.仓库.件.length; i++) {
    var it = s.仓库.件[i], d = RAID物品(it.id);
    if (d && d.类 === 类) 出.push(it);
  }
  return 出;
}
/* 仓库里找第一件指定 id 的物品（顶层） */
function RAID仓找(id) {
  var s = RAID档(), i;
  for (i = 0; i < s.仓库.件.length; i++) if (s.仓库.件[i].id === id) return s.仓库.件[i];
  return null;
}
/* 在"自己身上"找一件：仓库 → 背包 → 胸挂 → 安全箱（都只翻顶层）。
   为什么不能只认仓库：局内是从地上的尸体/箱子里搜出枪和甲，
   想立刻换上，那件东西在背包里、不在仓库里 —— 只认仓库就等于换不了。 */
function RAID找身上(id) {
  var s = RAID档();
  var 序 = [
    { 名: '仓库', 容: s.仓库 },
    { 名: '背包', 容: RAID预设背包() },
    { 名: '胸挂', 容: RAID预设胸挂() },
    { 名: '安全箱', 容: RAID安全箱() }
  ];
  for (var k = 0; k < 序.length; k++) {
    var c = 序[k].容;
    if (!c || !c.件) continue;
    for (var i = 0; i < c.件.length; i++) {
      if (c.件[i].id === id) return { 容器: c, 件: c.件[i], 来自: 序[k].名 };
    }
  }
  return null;
}

/* 武器槽：两个。序号 0 = 主武器，1 = 副武器（只是称呼，谁放哪都行） */
function RAID枪械(序) {
  var s = RAID档();
  var id = s.装备 && s.装备.枪 ? s.装备.枪[序 || 0] : '';
  return id ? RAID物品(id) : null;
}
function RAID穿枪(id) {
  var s = RAID档(), d = RAID物品(id);
  if (!d || d.类 !== '枪') return { ok: false, 因: '这不是枪' };
  if (!s.装备.枪) s.装备.枪 = [null, null];
  var 空 = -1, i;
  for (i = 0; i < s.装备.枪.length; i++) if (!s.装备.枪[i]) { 空 = i; break; }
  if (空 < 0) return { ok: false, 因: '两个武器槽都满了，先卸一把' };
  var 找 = RAID找身上(id);
  if (!找) return { ok: false, 因: '身上没有' + d.名 + '（要去买或去捡）' };
  RAID取出(找.容器, 找.件.u);
  s.装备.枪[空] = id;
  return { ok: true, 序: 空, id: id };
}
/* 口径 → 默认回收弹药 id（准备层卸枪时把膛内子弹退回仓库） */
function RAID口径弹id(口径) {
  var 首选 = '', 次选 = '';
  for (var id in RAID_ITEMS) if (RAID_ITEMS.hasOwnProperty(id)) {
    var d = RAID_ITEMS[id];
    if (d && d.类 === '弹药' && typeof RAID_AMMO !== 'undefined'
      && RAID_AMMO[id] && RAID_AMMO[id].口径 === 口径) {
      if (id.indexOf('_fmj') > 0) 首选 = id;
      else if (!次选) 次选 = id;
    }
  }
  return 首选 || 次选;
}
function RAID脱枪(序) {
  var s = RAID档();
  var id = s.装备.枪 ? s.装备.枪[序 || 0] : '';
  if (!id) return { ok: false, 因: '这个武器槽是空的' };
  var 新件 = RAID新件(id, 1);
  var r = RAID放入(s.仓库, 新件);
  if (!r.ok) return { ok: false, 因: '仓库放不下（' + r.因 + '）' };
  /* 枪膛剩弹退回仓库，绝不凭空清零也不凭空多出来 */
  var 发 = (Array.isArray(s.弹匣) ? (s.弹匣[序 || 0] | 0) : 0);
  if (发 > 0) {
    var 口径 = (typeof RAID_GUNS !== 'undefined' && RAID_GUNS[id]) ? RAID_GUNS[id].口径 : '9mm';
    var 弹id = RAID口径弹id(口径);
    if (弹id) RAID加入(s.仓库, 弹id, 发);
    if (Array.isArray(s.弹匣)) s.弹匣[序 || 0] = 0;
  }
  s.装备.枪[序 || 0] = null;
  return { ok: true, 件: 新件 };
}

/* 异常中断：退出/关页面/没结算就返回准备层。
   只有安全箱里的东西保住；绝不按撤离成功记账，也不给赛季任务加进度（防刷）。 */
function RAID异常中断() {
  var s = RAID档();
  if (!s.局中) return { 触发: false };
  var 箱id = s.安全箱 && s.安全箱.id ? s.安全箱.id : '';
  var 箱内 = (s.安全箱 && s.安全箱.内 && Array.isArray(s.安全箱.内.件))
    ? s.安全箱.内.件.slice() : [];
  s.局中 = false;
  /* 仓库是安全屋：异常中断只丢"带进局内的东西"。
     带进去的装备在 RAID穿/RAID穿枪 时已经从仓库扣掉了，清空装备槽就等于丢掉它们；
     绝不能碰 s.仓库，否则玩家只是关了个窗口，家里存的货全没了。
     预设只是清单，同样不碰。 */
  s.装备 = { 胸挂: null, 背包: null, 头盔: '', 护甲: '', 枪: [null, null] };
  s.弹匣 = [0, 0];
  s.装备耐久 = { 护甲: { id: '', 值: 0 }, 头盔: { id: '', 值: 0 } };
  s.安全箱 = { id: 箱id, 内: 箱id ? { id: 箱id, 件: 箱内 } : null };
  RAID写档();
  return { 触发: true, 保住: 箱内.length };
}

/* 读一个装备槽当前装着什么。
   注意形态不一样：胸挂/背包/安全箱存的是容器对象 {id,件}，
   头盔/护甲只存一个 id 字符串 —— 以前 穿/脱 都只按对象处理，
   结果"槽里有头盔却提示槽是空的"，而且换头盔时旧那件会被悄悄覆盖掉。 */
function RAID槽件(键) {
  var s = RAID档(), 槽 = RAID槽配置(键);
  if (!槽) return null;
  if (键 === '安全箱') {
    var x = s.安全箱;
    return (x && x.id) ? { id: x.id, 内: x.内 } : null;
  }
  var v = s.装备[键];
  if (!v) return null;
  if (槽.类 === '头盔' || 槽.类 === '护甲') {
    return (typeof v === 'string' && v) ? { id: v } : (v.id ? { id: v.id } : null);
  }
  return v.id ? { id: v.id, 内: v } : null;   /* 容器槽：内层就是它自己，卸下时要整体带走 */
}

/* 穿上：键 = 胸挂/背包/头盔/护甲/安全箱/枪，id = 物品 id（必须是仓库里有的） */
function RAID穿(键, id) {
  if (键 === '枪') return RAID穿枪(id);
  var s = RAID档(), 槽 = RAID槽配置(键);
  if (!槽) return { ok: false, 因: '没有这个装备槽' };
  var d = RAID物品(id);
  if (!d) return { ok: false, 因: '未知物品' };
  if (键 === '安全箱' && !RAID赛季解锁()) return { ok: false, 因: '安全箱未解锁：先完成赛季任务「灰港封锁令」' };
  if (d.类 !== 槽.类) return { ok: false, 因: 槽.名 + '槽只能放' + 槽.类 };
  var 找 = RAID找身上(id);
  if (!找) return { ok: false, 因: '身上没有这件装备（要去买或去捡）' };
  /* 槽里已经有一件：先脱下来放回仓库，放不下就别换（旧的那件绝不能凭空消失） */
  var 旧 = RAID槽件(键);
  if (旧) {
    var r0 = RAID脱(键);
    if (!r0.ok) return { ok: false, 因: '换不下来：' + r0.因 };
  }
  RAID取出(找.容器, 找.件.u);
  /* 内层在 件.内.件 —— 这里以前读的是 件.件（件对象上根本没有这个字段），
     所以穿上背包永远是空的；而脱下来那件又被写了同一个野字段，
     于是"卸下后看不见、再穿上又有"。下面这个兜底顺手接住旧脏档。 */
  var 正内 = (找.件.内 && Array.isArray(找.件.内.件)) ? 找.件.内.件 : null;
  var 野内 = Array.isArray(找.件.件) ? 找.件.件 : null;
  var 内件 = (正内 && 正内.length) ? 正内 : ((野内 && 野内.length) ? 野内 : (正内 || []));
  if (键 === '安全箱') s.安全箱 = { id: id, 内: { id: id, 件: 内件 } };
  else if (槽.类 === '头盔' || 槽.类 === '护甲') s.装备[键] = id;
  else s.装备[键] = { id: id, 件: 内件 };
  return { ok: true, 键: 键, id: id };
}

/* 脱下：整体放回仓库；仓库放不下就拒绝，不能把身上的东西变没 */
function RAID脱(键) {
  var s = RAID档(), 槽 = RAID槽配置(键);
  if (!槽) return { ok: false, 因: '没有这个装备槽' };
  var 旧 = RAID槽件(键);
  if (!旧) return { ok: false, 因: '这个槽是空的' };
  var 新件 = RAID新件(旧.id, 1);
  if (!新件) return { ok: false, 因: '未知装备' };
  /* 容器槽把里面的东西一起带走；头盔/护甲没有内层。
     必须写进 新件.内.件：写 新件.件 等于往件上挂了个野字段，
     详情页打开内层读的是 .内，看到的就是空背包，东西也跟着"消失"。 */
  if (旧.内 && 旧.内.件 && 旧.内.件.length) {
    if (!新件.内) 新件.内 = { id: 新件.id, 件: [] };
    新件.内.件 = 旧.内.件;
  }
  var r = RAID放入(s.仓库, 新件);
  if (!r.ok) return { ok: false, 因: '仓库放不下（' + r.因 + '）' };
  if (键 === '安全箱') s.安全箱 = { id: '', 内: null };
  else if (槽.类 === '头盔' || 槽.类 === '护甲') s.装备[键] = '';
  else s.装备[键] = null;
  return { ok: true, 件: 新件 };
}

/* ==================== 交易行（阶段 3.6：只开放七类购买）====================
   能买的：枪械 / 胸挂 / 背包 / 护甲 / 头盔 / 弹药 / 医药。
   不能买的：变卖物、任务物、保险箱 —— 那些只能靠搜刮或卖出。
   买入价 = 回收价 × 2：倒卖必亏，杜绝"低买高卖"刷钱。 */
var RAID_可买类 = ['枪', '胸挂', '背包', '护甲', '头盔', '弹药', '医疗'];

function RAID可买(id) {
  var d = RAID物品(id);
  return !!(d && RAID_可买类.indexOf(d.类) >= 0 && d.价 > 0);
}
function RAID买价(id) {
  var d = RAID物品(id);
  return d ? Math.max(1, Math.round(d.价 * 2)) : 0;
}
/* 买入：先算钱、再验仓库放得下，两步都过了才扣币（不能出现"钱花了东西没到手"） */
function RAID买入(id, n) {
  var s = RAID档(), d = RAID物品(id);
  if (!d) return { ok: false, 因: '未知物品' };
  if (!RAID可买(id)) return { ok: false, 因: '交易行不卖这一类' };
  n = Math.max(1, n | 0);
  if ((d.叠 || 1) <= 1) n = 1;
  else n = Math.min(n, d.叠);
  var 总 = RAID买价(id) * n;
  if ((s.币 | 0) < 总) return { ok: false, 因: '封锁币不够（要 ' + 总.toLocaleString() + '）' };
  var 试 = RAID新件(id, n);
  if (!试) return { ok: false, 因: '未知物品' };
  var r = RAID放入(s.仓库, 试);
  if (!r.ok) return { ok: false, 因: '仓库放不下（' + r.因 + '）' };
  s.币 = (s.币 | 0) - 总;
  RAID合并同id(s.仓库);          /* 买第二次弹药时并进原来那堆，别开碎堆 */
  return { ok: true, 得: n, 花: 总, 名: d.名 };
}

/* ==================== 直接卖出（交易行开放前的变现途径）====================
   规则很简单：按回收价（RAID物品(id).价）当场换成封锁币，不抽成、不挂单。
   不能卖的：任务物、以及价 0 的东西（自带装备早就没有价 0 的了）。
   拆着卖：份数小于整堆时只减数量，堆还在。 */
function RAID卖价(件) {
  var d = RAID件定义(件);
  if (!d || !d.价) return 0;
  return RAID件价(件);          /* 耐久损耗也要反映到回收价 */
}

function RAID卖出(容器, u, 份数) {
  var it = RAID取件(容器, u);
  if (!it) return { ok: false, 因: '这件已经不在了' };
  var d = RAID物品(it.id);
  if (!d) return { ok: false, 因: '未知物品' };
  if (d.务 || d.类 === '任务') return { ok: false, 因: '任务物不能卖（只能交任务）' };
  if (!d.价) return { ok: false, 因: '这件不能卖' };
  var 有 = it.n || 1;
  var n = Math.max(1, Math.min(有, 份数 || 有));
  var 得 = Math.max(0, Math.round(RAID件价(it) / 有) * n);   /* 按当前耐久折价，拆着卖也不按全新价 */
  if (n >= 有) RAID取出(容器, u);
  else it.n = 有 - n;
  var s = RAID档();
  s.币 = (s.币 | 0) + 得;
  return { ok: true, 得: 得, n: n, 名: d.名 };
}

/* 一键卖掉仓库里的某几类（默认只卖"变卖"，绝不碰枪/医疗/弹药/装备） */
function RAID一键卖(容器, 类表) {
  容器 = 容器 || RAID档().仓库;
  类表 = 类表 || ['变卖'];
  var 件数 = 0, 得 = 0, i, 表 = (容器.件 || []).slice();
  for (i = 0; i < 表.length; i++) {
    var it = 表[i], d = RAID物品(it.id);
    if (!d || 类表.indexOf(d.类) < 0 || !d.价) continue;
    var r = RAID卖出(容器, it.u);
    if (r.ok) { 件数 += r.n; 得 += r.得; }
  }
  return { 件数: 件数, 得: 得 };
}

/* ==================== 按预设自动装配 ====================
   预设不再"白给"装备：它只是一张清单 ——
     · 枪：仓库里有，就装进空的武器槽
     · 弹：仓库里有，就整堆搬进背包/胸挂，搬到够数为止
   缺什么原样报出来（"缺：蜂鸟冲锋枪"），让玩家知道要去买。
   已经在槽里的枪不重复装；两槽都满就报"武器槽满了"。 */
function RAID按预设装配(i) {
  var s = RAID档(), p = s.预设[i];
  if (!p) return { ok: false, 文: '没有这套预设' };
  var 装枪 = 0, 搬弹 = 0, 缺 = [], k, m;

  for (k = 0; k < p.枪.length; k++) {
    var gid = p.枪[k], gd = RAID物品(gid);
    var 已有 = (s.装备.枪 || []).indexOf(gid) >= 0;
    if (已有) { 装枪++; continue; }
    if (!RAID仓找(gid)) { 缺.push((gd ? gd.名 : gid) + '（仓库里没有）'); continue; }
    var rg = RAID穿枪(gid);
    if (rg.ok) 装枪++;
    else 缺.push((gd ? gd.名 : gid) + '（' + rg.因 + '）');
  }

  var 到包 = RAID预设背包(), 到挂 = RAID预设胸挂();
  for (m = 0; m < p.弹.length; m++) {
    var aid = p.弹[m][0], 需 = p.弹[m][1] | 0, ad = RAID物品(aid);
    var 左 = 需, 保护 = 0;
    while (左 > 0 && 保护++ < 20) {
      var 件 = RAID仓找(aid);
      if (!件) break;
      var 目标 = 到包 || 到挂;
      if (!目标) break;
      var r = RAID移动(s.仓库, 件.u, 目标);
      if (!r.ok && 到挂 && 目标 !== 到挂) r = RAID移动(s.仓库, 件.u, 到挂);
      if (!r.ok) break;
      左 -= (件.n || 1);
      搬弹 += (件.n || 1);
    }
    if (左 > 0 && !RAID仓找(aid)) 缺.push((ad ? ad.名 : aid) + ' ×' + 需 + '（仓库不够）');
  }

  if (!装枪 && !搬弹 && !缺.length) 缺.push('仓库里没有这套预设要的东西');
  return { ok: true, 装枪: 装枪, 搬弹: 搬弹, 缺: 缺 };
}

/* ==================== 赛季任务：完成「灰港封锁令」才解锁安全箱 ====================
   进度存在存档的 s.赛季 里，死亡不清空；完成后永久解锁。 */
function RAID赛季进度() {
  var s = RAID档();
  if (!s.赛季 || typeof s.赛季 !== 'object') s.赛季 = { 撤离: 0, 情报: 0, 完成: false };
  return s.赛季;
}
function RAID赛季解锁() {
  return RAID赛季进度().完成 === true;
}
function RAID赛季检查() {
  var p = RAID赛季进度(), 需 = (typeof RAID赛季任务 !== 'undefined') ? RAID赛季任务.需 : { 撤离: 1, 情报: 2 };
  if (!p.完成 && p.撤离 >= 需.撤离 && p.情报 >= 需.情报) {
    p.完成 = true;
    RAID写档();
    return true;
  }
  return p.完成 === true;
}
function RAID赛季撤离(带出件) {
  var p = RAID赛季进度(), 刚完成 = false;
  p.撤离 = (p.撤离 | 0) + 1;
  var 情 = 0;
  if (带出件 && 带出件.length) for (var i = 0; i < 带出件.length; i++) {
    if (带出件[i].id === 'task_intel') 情 += Math.max(0, 带出件[i].n | 0);
  }
  p.情报 = (p.情报 | 0) + 情;
  刚完成 = RAID赛季检查();
  RAID写档();
  return { 刚完成: 刚完成, 情报: 情, 进度: p };
}

/* ==================== 安全箱槽位 ====================
   安全箱不占背包格，它挂在角色身上；一个角色同时只带一个。
   return 容器形态 {id,件} 或 null（= 不带）。 */
function RAID安全箱() {
  var s = RAID档();
  if (!s || !s.安全箱 || !s.安全箱.id) return null;
  if (!s.安全箱.内 || s.安全箱.内.id !== s.安全箱.id) s.安全箱.内 = { id: s.安全箱.id, 件: [] };
  return s.安全箱.内;
}
/* 换安全箱：**必须仓库里有一件**（要买/要捡），而且旧箱内层要空。
   返回 {ok:true} 或 {ok:false, 因:'中文原因'}。id='' 表示卸下。 */
function RAID设安全箱(id) {
  var s = RAID档();
  if (id && !RAID赛季解锁()) return {
    ok: false,
    因: '安全箱未解锁：先完成赛季任务「' + ((typeof RAID赛季任务 !== 'undefined' && RAID赛季任务.名) || '灰港封锁令')
      + '」（' + ((typeof RAID赛季任务 !== 'undefined' && RAID赛季任务.描) || '') + '）'
  };
  if (!s.安全箱) s.安全箱 = { id: '', 内: null };
  if (id === s.安全箱.id) return { ok: true, 不变: true };
  var 旧内 = s.安全箱.内;
  if (id === '') {
    if (旧内 && 旧内.件 && 旧内.件.length) return { ok: false, 因: '先把安全箱里的东西取出来' };
    return RAID脱('安全箱');
  }
  var d = RAID物品(id);
  if (!d || !d.容 || d.类 !== '保险') return { ok: false, 因: '这个不是安全箱' };
  if (旧内 && 旧内.件 && 旧内.件.length) return { ok: false, 因: '先把安全箱里的东西取出来' };
  if (!RAID找身上(id)) return { ok: false, 因: '身上没有' + d.名 + '（要去买或去捡）' };
  return RAID穿('安全箱', id);
}

/* ==================== 保险结算 ====================
   阶段 7 局内死亡时会调它。现在先用自测探针跑六种组合，保证规则不会被改坏。

   入参 清点：[{ 件, 源:'带入'|'局内', 保险:true|false }]
        · 保险:true ＝ 这一件躺在某个保险容器的内层里（由调用方遍历容器标出来）
        · 源:'带入' ＝ 出发时自己带进来的；'局内' ＝ 图里搜到的
   入参 选项：{ 凭证:0|1 }（战后回收凭证的张数）

   返回 { 保住:[清点], 丢失:[清点], 可赎:清点|null, 任务保住:bool, 价值:{保住,丢失} }
   规则顺序（**改这里之前先想清楚，这是玩家最在意的一段**）：
     ① 在保险里 → 保住（标记 保:1，阶段 9 交易行不收）
     ② 不在保险里 → 一律丢失（带入的和局内搜到的都丢，塔科夫规则）
     ③ 任务物只有在保险容器里才保住（封存筒是最便宜的专用方案）；没进保险 → 本局进度丢失
     ④ 有凭证且丢失清单里有稀有及以下 → 可赎 1 件（贵的赎不回来） */
function RAID结算保险(清点, 选项) {
  var 保住 = [], 丢失 = [], 可赎 = null, 任务保住 = false;
  var 价保 = 0, 价丢 = 0;
  var 凭 = 选项 && 选项.凭证 ? 1 : 0;
  清点 = 清点 || [];
  for (var i = 0; i < 清点.length; i++) {
    var c = 清点[i];
    if (!c || !c.件) continue;
    var d = RAID件定义(c.件);
    if (!d) continue;
    var v = RAID件价(c.件);
    if (c.保险) {
      保住.push(c); 价保 += v;
      if (d.务) 任务保住 = true;
    } else {
      丢失.push(c); 价丢 += v;
    }
  }
  /* 可赎：稀有(<=1)及以下里最贵的一件 */
  if (凭) {
    for (var j = 0; j < 丢失.length; j++) {
      var dj = RAID件定义(丢失[j].件);
      if (!dj || dj.务 || dj.稀有 > 1) continue;
      if (!可赎 || RAID件价(丢失[j].件) > RAID件价(可赎.件)) 可赎 = 丢失[j];
    }
  }
  return { 保住: 保住, 丢失: 丢失, 可赎: 可赎, 任务保住: 任务保住, 价值: { 保住: 价保, 丢失: 价丢 } };
}

/* 把一整个容器里的件摊平成"清点"数组（阶段 7 直接用）。
   保险层里的件会被标 保险:true —— 递归时把标记传下去就是这个函数的全部意义。 */
function RAID摊平清点(容器, 源, 在保险, 出) {
  出 = 出 || [];
  if (!容器 || !容器.件) return 出;
  for (var i = 0; i < 容器.件.length; i++) {
    var it = 容器.件[i], d = RAID件定义(it);
    出.push({ 件: it, 源: 源 || '带入', 保险: !!在保险 });
    if (it.内) RAID摊平清点(it.内, 源, 在保险 || d && d.类 === '保险', 出);
  }
  return 出;
}

/* 一整局的死亡清点（阶段 7 直接调）。
   顺序有意义：安全箱里的东西**一律算保住**，剩下的才按胸挂/背包里的保险箱规则走。
   背包本身丢了，但背包里那个保险箱的"内层"照样保 —— 这就是保险箱存在的意义。 */
function RAID死亡清点() {
  var s = RAID档(), 出 = [];
  RAID摊平清点(RAID安全箱(), '带入', true, 出);
  RAID摊平清点(RAID预设胸挂(), '带入', false, 出);
  RAID摊平清点(RAID预设背包(), '带入', false, 出);
  return 出;
}

/* ==================== 自检（探针与"档案"页共用）==================== */
function RAID底座自检() {
  var 报 = [];
  function 查(名, 过, 详) { 报.push({ 名: 名, 过: !!过, 详: 详 || '' }); }
  var 箱 = { 宽: 4, 高: 4, 载: 10, 件: [] };
  查('空容器首次适配到 (0,0)', (function () { var r = RAID放入(箱, RAID新件('sell_screw', 5)); return r.ok && r.x === 0 && r.y === 0; })());
  查('堆叠并进已有堆', (function () { var r = RAID加入(箱, 'sell_screw', 10); var it = 箱.件[0]; return r.ok === 10 && it.n === 15; })());
  查('堆叠到上限后开新堆', (function () { RAID加入(箱, 'sell_screw', 100); return 箱.件.length >= 2; })());
  查('超重被拒且给中文原因', (function () { var c = { 宽: 4, 高: 4, 载: 1, 件: [] }; var r = RAID放入(c, RAID新件('sell_cement', 1)); return !r.ok && /超重/.test(r.因); })());
  查('指定坐标越界被拒', (function () { var c = { 宽: 2, 高: 2, 载: 99, 件: [] }; var r = RAID放入(c, RAID新件('sell_screw', 1), 5, 5); return !r.ok && /放不下/.test(r.因); })());
  查('自动摆放塞不下时说「空间不足」', (function () { var c = { 宽: 1, 高: 1, 载: 99, 件: [] }; var r = RAID放入(c, RAID新件('top_gold', 1)); return !r.ok && /空间不足/.test(r.因); })());
  查('胸挂拒收大件给中文原因', (function () { var c = { id: 'rig_cloth', 件: [] }; var r = RAID放入(c, RAID新件('gun_pigeon', 1)); return !r.ok && /只能放/.test(r.因); })());
  查('保险袋拒收超 3 万的单件', (function () { var c = { id: 'ins_bag', 件: [] }; var r = RAID放入(c, RAID新件('top_diamond', 1)); return !r.ok && /装不下/.test(r.因); })());
  查('拆分后总量不变', (function () {
    var c = { 宽: 4, 高: 4, 载: 99, 件: [] }; RAID加入(c, 'sell_screw', 30);
    var r = RAID拆分(c, c.件[0].u, 10);
    return r.ok && RAID容器件数(c) === 30 && c.件.length === 2;
  })());
  查('拆分数量越界被拒', (function () {
    var c = { 宽: 4, 高: 4, 载: 99, 件: [] }; RAID加入(c, 'sell_screw', 5);
    return !RAID拆分(c, c.件[0].u, 5).ok;
  })());
  查('整理后无重叠', (function () {
    var c = { 宽: 5, 高: 5, 载: 99, 件: [] };
    RAID加入(c, 'rare_gpu', 1); RAID加入(c, 'sell_screw', 20); RAID加入(c, 'top_gold', 1);
    RAID整理(c);
    var 图 = RAID占格图(c), n = 0, i;
    for (i = 0; i < 图.length; i++) n += 图[i];
    var 期望 = 0, 表 = c.件;
    for (i = 0; i < 表.length; i++) { var d = RAID物品(表[i].id); 期望 += d.格[0] * d.格[1]; }
    return n === 期望;
  })());
  查('跨容器移动成功', (function () {
    var a = { 宽: 4, 高: 4, 载: 99, 件: [] }, b = { 宽: 4, 高: 4, 载: 99, 件: [] };
    RAID加入(a, 'sell_screw', 5);
    var r = RAID移动(a, a.件[0].u, b);
    return r.ok && a.件.length === 0 && b.件.length === 1;
  })());
  查('跨容器移动失败时原地不动（不丢东西）', (function () {
    var a = { 宽: 4, 高: 4, 载: 99, 件: [] }, b = { 宽: 1, 高: 1, 载: 99, 件: [] };
    RAID加入(a, 'top_gold', 1);
    var r = RAID移动(a, a.件[0].u, b);
    return !r.ok && a.件.length === 1;
  })());
  查('同容器换位不重复计算', (function () {
    var a = { 宽: 4, 高: 4, 载: 99, 件: [] };
    RAID加入(a, 'sell_screw', 5);
    var u = a.件[0].u, r = RAID移动(a, u, a, 2, 2);
    return r.ok && a.件.length === 1 && a.件[0].x === 2 && a.件[0].y === 2;
  })());
  /* 保险结算六种组合 */
  var 带入枪 = RAID新件('gun_pigeon', 1), 带入表 = RAID新件('rare_watch', 1);
  var 局内金条 = RAID新件('top_gold', 1), 任务页 = RAID新件('task_intel', 1);
  查('保险里的一律保住', (function () {
    var r = RAID结算保险([{ 件: 带入表, 源: '带入', 保险: true }], {});
    return r.保住.length === 1 && r.丢失.length === 0;
  })());
  查('带入但不在保险里 → 丢失', (function () {
    var r = RAID结算保险([{ 件: 带入枪, 源: '带入', 保险: false }], {});
    return r.丢失.length === 1 && r.保住.length === 0;
  })());
  查('局内搜到的没进保险也丢', (function () {
    var r = RAID结算保险([{ 件: 局内金条, 源: '局内', 保险: false }], {});
    return r.丢失.length === 1;
  })());
  查('任务物在封存筒里保住进度', (function () {
    var r = RAID结算保险([{ 件: 任务页, 源: '局内', 保险: true }], {});
    return r.保住.length === 1 && r.任务保住 === true;
  })());
  查('任务物没封存 → 丢且不计可赎', (function () {
    var r = RAID结算保险([{ 件: 任务页, 源: '局内', 保险: false }], { 凭证: 1 });
    return r.丢失.length === 1 && r.可赎 === null && r.任务保住 === false;
  })());
  查('凭证只赎稀有及以下、且只赎最贵的一件', (function () {
    var r = RAID结算保险([
      { 件: RAID新件('sell_screw', 1), 源: '局内', 保险: false },
      { 件: RAID新件('rare_watch', 1), 源: '局内', 保险: false },
      { 件: 局内金条, 源: '局内', 保险: false }
    ], { 凭证: 1 });
    return r.可赎 && RAID件名(r.可赎.件) === '名牌腕表';
  })());
  查('贵重物不可赎', (function () {
    var r = RAID结算保险([{ 件: 局内金条, 源: '局内', 保险: false }], { 凭证: 1 });
    return r.可赎 === null;
  })());
  查('容器重量把内层一起算', (function () {
    var 箱2 = RAID新件('ins_tin', 1);
    RAID加入(箱2.内, 'top_gold', 1);
    return Math.abs(RAID件重(箱2) - (1.5 + 3.0 * 1)) < 0.001;
  })());
  /* ---------- 1.12.0 阶段 2.5：自带装备与安全箱 ----------
     这几条会短暂改动当前存档里的东西，所以每条都先快照、再还原 —— 自检可以在玩家
     的「档案」页里跑，绝不能把人家的安全箱或预设搞乱。 */
  查('预设里不再有胸挂/背包/保险字段（装备是角色自带的）', (function () {
    var s = RAID档(), i;
    for (i = 0; i < s.预设.length; i++) {
      if ('胸挂' in s.预设[i] || '背包' in s.预设[i] || '保险' in s.预设[i]) return false;
    }
    return true;
  })());
  查('切换预设不会换掉身上的装备与武器槽', (function () {
    var s = RAID档(), 旧 = s.当前预设;
    var a = s.装备.胸挂, b = s.装备.背包, g = (s.装备.枪 || []).join('|');
    s.当前预设 = (旧 + 1) % s.预设.length;
    var 同 = s.装备.胸挂 === a && s.装备.背包 === b && (s.装备.枪 || []).join('|') === g;
    s.当前预设 = 旧;
    return 同;
  })());
  查('头盔/护甲要花钱（有价格、不在掉落表里）', (function () {
    var h = RAID物品('eq_helm'), a = RAID物品('eq_armor');
    return !!(h && a && h.类 === '头盔' && a.类 === '护甲' && h.价 > 0 && a.价 > 0
      && !RAID可掉('eq_helm') && !RAID可掉('eq_armor'));
  })());
  查('安全箱默认带一档、内层是合法容器', (function () {
    var 箱 = RAID安全箱(), s = RAID档();
    if (!s.安全箱.id) return true;                 /* 玩家选了"不带"也算正确状态 */
    var d = RAID物品(s.安全箱.id);
    return !!(箱 && d && d.容 && 箱.件);
  })());
  查('没买过的安全箱装不上（仓库里没有就拒绝）', (function () {
    var s = RAID档();
    if (RAID仓找('ins_heavy')) return true;      /* 玩家自己有一件，跳过这条 */
    var r = RAID设安全箱('ins_heavy');
    return !r.ok && /(身上|仓库里)没有/.test(r.因 || '');
  })());
  查('安全箱里有东西时拒绝换箱，并给中文原因', (function () {
    var s = RAID档(), 旧 = s.安全箱;
    if (!旧 || !旧.内) return true;
    var 备份 = 旧.内.件.slice();
    RAID加入(旧.内, 'rare_watch', 1);
    var r = RAID设安全箱(旧.id === 'ins_army' ? 'ins_tin' : 'ins_army');
    旧.内.件 = 备份;
    return !r.ok && /取出来/.test(r.因);
  })());
  查('安全箱里的东西在死亡清点里算保住', (function () {
    var s = RAID档(), 旧 = s.安全箱;
    if (!旧 || !旧.内) return true;
    var 备份 = 旧.内.件.slice();
    RAID加入(旧.内, 'rare_ring', 1);
    var u = 旧.内.件[旧.内.件.length - 1].u;
    var 清点 = RAID死亡清点(), 找到 = null, i;
    for (i = 0; i < 清点.length; i++) if (清点[i].件 && 清点[i].件.u === u) 找到 = 清点[i];
    旧.内.件 = 备份;
    return !!(找到 && 找到.保险 === true);
  })());

  var 失败 = 报.filter(function (x) { return !x.过; });
  return { 总: 报.length, 过: 报.length - 失败.length, 报: 报, 全过: 失败.length === 0 };
}
