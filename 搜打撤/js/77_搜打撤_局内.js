/* 【1.12.0】搜打撤 · 搜刮引擎与搜刮窗口（js/77_搜打撤_局内.js）====================
   阶段 3 的全部逻辑都在这里，**不依赖任何 3D 场景**：
     · 按种子确定性生成容器（同一个种子永远开出同一箱东西，联机/回放都对得上）
     · 开盖进度（可中断，被打断就清零 —— 阶段 4 接上"挨枪就断"）
     · 按权重掷战利品：先掷类别，再掷稀有度，再从池子里抽具体物品
     · 连续空箱保底：连开 3 个空箱，第 3 个强制塞一件稀有以上的东西
     · 拿取：背包 → 胸挂 → 安全箱，依次尝试；都装不下就说原因，不丢东西

   为什么掉落放在"打开时"而不是"生成时"：
     容器在场景里存在很久，如果生成时就把东西掷出来，服务端就得把所有容器内容
     同步给每个客户端（等于透视挂）；打开时再掷，只要种子一致，每台机器算出来一样。
   ============================================================================= */

/* ==================== 随机源 ====================
   mulberry32：32 位状态、够快、分布够均匀，而且**可复现**。
   项目里人机掉落也是同一套算法（见搜打撤方案第 2 条）。 */
function RAID随机(种子) {
  var a = (种子 >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 按键取一个：表 = {键: 权重} */
function RAID按权重(rng, 表) {
  var 总 = 0, k, 末 = null;
  for (k in 表) if (表.hasOwnProperty(k)) { 总 += 表[k]; 末 = k; }
  if (总 <= 0) return null;
  var r = rng() * 总;
  for (k in 表) {
    if (!表.hasOwnProperty(k)) continue;
    r -= 表[k];
    if (r <= 0) return k;
  }
  return 末;
}
/* 数组版：返回下标（稀有度权重表用） */
function RAID按权重序(rng, 数) {
  var 总 = 0, i;
  for (i = 0; i < 数.length; i++) 总 += 数[i];
  if (总 <= 0) return 0;
  var r = rng() * 总;
  for (i = 0; i < 数.length; i++) {
    r -= 数[i];
    if (r <= 0) return i;
  }
  return 数.length - 1;
}

/* 类别 + 稀有度的抽奖池（缓存：容器一多，反复扫全表会卡） */
var _搜池缓存 = {};
function RAID抽池(类, 稀) {
  var k = 类 + '|' + 稀;
  if (_搜池缓存[k]) return _搜池缓存[k];
  var 全 = RAID按类(类), 出 = [], i;
  for (i = 0; i < 全.length; i++) {
    var d = RAID物品(全[i]);
    if (!d) continue;
    if (!RAID可掉(全[i])) continue;
    if (d.稀有 === 稀) 出.push(全[i]);
  }
  _搜池缓存[k] = 出;
  return 出;
}

/* 抽一件物品 id：先按类别权重 → 再按稀有度权重 → 该档没有就往下退一档 */
function RAID抽一件(型, rng) {
  var cfg = RAID容器配置(型);
  var 类 = RAID按权重(rng, cfg.权重);
  if (!类) return null;
  var 稀 = RAID按权重序(rng, cfg.稀);
  var 池 = RAID抽池(类, 稀), k;
  for (k = 稀 - 1; k >= 0 && !池.length; k--) 池 = RAID抽池(类, k);
  if (!池.length) {
    /* 这档全没有就从该类任意稀有度里抽（比如"枪"没有 3 档） */
    var 全 = RAID按类(类), i;
    池 = [];
    for (i = 0; i < 全.length; i++) if (RAID可掉(全[i])) 池.push(全[i]);
  }
  if (!池.length) return null;
  return 池[Math.floor(rng() * 池.length) % 池.length];
}

/* ==================== 容器实例 ==================== */
function RAID生成容器(型, 种子, 区) {
  var cfg = RAID容器配置(型);
  return {
    型: 型, 名: cfg.名, 宽: cfg.容[0], 高: cfg.容[1], 载: cfg.载,
    件: [], 已开: false, 进度: 0,
    种子: (种子 | 0) || 1, 区: 区 || ''
  };
}

/* 掷一箱东西（会直接塞进容器；塞不下的自然少几件） */
function RAID掷战利品(容器, rng) {
  var cfg = RAID容器配置(容器.型);
  /* 先掷"这箱子是不是被人翻过了"：没有这一步，每个容器都必然出货，
     连续空箱的保底规则就永远触发不到，箱子也会变成稳定的刷钱点。 */
  if (rng() < (cfg.空率 || 0)) return 容器;
  var 件数 = cfg.件[0] + Math.floor(rng() * (cfg.件[1] - cfg.件[0] + 1));
  var i, id;
  for (i = 0; i < 件数; i++) {
    id = RAID抽一件(容器.型, rng);
    if (!id) continue;
    var d = RAID物品(id), n = 1;
    if (d.类 === '弹药') n = 20 + Math.floor(rng() * 41);          /* 20~60 发 */
    else if (d.叠 > 1) n = 1 + Math.floor(rng() * Math.min(3, d.叠));
    RAID加入(容器, id, n);
  }
  return 容器;
}

/* 保底：连开 3 个空箱，这一箱强制给一件"稀有以上、且塞得下"的东西。
   从贵到便宜试，塞不下就退一档 —— 宁可给小的，也不能让玩家连开三个空箱。 */
function RAID塞保底(容器, rng) {
  var 档, i;
  var 类表 = ['变卖', '医疗', '枪', '弹药'];
  for (档 = 3; 档 >= 1; 档--) {
    for (i = 0; i < 类表.length; i++) {
      var 池 = RAID抽池(类表[i], 档);
      if (!池.length) continue;
      /* 同档里挑最贵的：保底就该给点像样的 */
      池 = 池.slice().sort(function (a, b) { return (RAID物品(b).价 | 0) - (RAID物品(a).价 | 0); });
      var 试 = Math.min(池.length, 4), k;
      for (k = 0; k < 试; k++) {
        var id = 池[k];
        if (RAID放入(容器, RAID新件(id, 1)).ok) return id;
      }
    }
  }
  return null;
}

/* 开箱：掷掉落 + 结算保底计数。已经开过就原样返回。 */
function RAID开箱(容器) {
  if (!容器 || 容器.已开) return 容器;
  容器.件 = [];
  var rng = RAID随机(容器.种子 || 1);
  RAID掷战利品(容器, rng);
  var s = RAID档();
  if (!s.统计) s.统计 = { 局: 0, 撤离: 0, 死亡: 0, 带出: 0, 空箱: 0 };
  if (!容器.件.length) {
    s.统计.空箱 = (s.统计.空箱 | 0) + 1;
    if (s.统计.空箱 >= 3) { RAID塞保底(容器, rng); s.统计.空箱 = 0; }
  } else {
    s.统计.空箱 = 0;
  }
  容器.已开 = true;
  容器.进度 = 1;
  RAID写档();
  return 容器;
}

/* ==================== 搜刮状态与窗口 ==================== */
var RAID_搜刮 = { 开: false, 容器: null, 定时: null };

function 搜刮_元素(id) { return document.getElementById(id); }

/* 打开一个容器：先开盖（进度条），盖子开了才掷东西 */
function 搜刮_开始(型, 种子, 区) {
  var c = RAID生成容器(型, 种子 == null ? ((Date.now() ^ (Math.random() * 1e9)) | 0) : 种子, 区);
  RAID_搜刮.容器 = c;
  RAID_搜刮.开 = true;
  搜刮_清定时();
  搜刮_画();
  /* 开箱＝要把手放出来点物品：鼠标必须立刻脱离指针锁，否则点不到列表里的按钮 */
  try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) { }
  var 窗 = 搜刮_元素('rdLootWin');
  if (窗) 窗.classList.add('on');
  if (c.进度 < 1) {
    RAID_搜刮.定时 = setInterval(function () { 搜刮_推进(0.06); }, 60);
  }
  return c;
}

function 搜刮_清定时() {
  if (RAID_搜刮.定时) { clearInterval(RAID_搜刮.定时); RAID_搜刮.定时 = null; }
}

/* 【阶段 4】直接打开场景里那一箱，不再临时造一个新的。
   与 搜刮_开始() 的区别：容器实例是场上同一个对象，开过的箱子保持原样，
   开盖进度也跟着它走 —— 关窗再开不会重掷（重掷＝凭空刷物资）。 */
function 搜刮_打开已有(c) {
  if (!c) return null;
  RAID_搜刮.容器 = c;
  RAID_搜刮.开 = true;
  搜刮_清定时();
  搜刮_画();
  /* 【关键】开箱就松鼠标。原来只搬 DOM、没退指针锁，玩家在箱子里点「拿」时
     指针还锁在 3D 画面上，根本点不到按钮 —— 表现出来就是"搜物品时鼠标不会自动解除"。 */
  try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) { }
  var 窗 = 搜刮_元素('rdLootWin');
  if (窗) {
    /* 局内 #raidPrep 是 display:none，搜刮窗原本挂在它里面（absolute），
       不移出来就是"按了 F 没反应"。事件绑在元素自身，移动节点不会丢监听。 */
    if (typeof RAID_ !== 'undefined' && RAID_.对局中) {
      if (!窗.__原父) 窗.__原父 = 窗.parentNode;
      if (窗.parentNode !== document.body) document.body.appendChild(窗);
      窗.style.position = 'fixed';
      窗.style.zIndex = '10000';
    }
    窗.classList.add('on');
  }
  if (!c.已开 && c.进度 < 1) {
    RAID_搜刮.定时 = setInterval(function () { 搜刮_推进(0.06); }, 60);
  }
  return c;
}

/* 推进开盖进度；dt 是秒。盖子开完自动掷掉落。 */
function 搜刮_推进(dt) {
  var c = RAID_搜刮.容器;
  if (!c || c.已开) return c;
  var cfg = RAID容器配置(c.型);
  c.进度 = Math.min(1, c.进度 + (dt || 0) / Math.max(0.4, cfg.开盖));
  if (c.进度 >= 1) {
    搜刮_清定时();
    RAID开箱(c);
    try { if (typeof showMsg === 'function') showMsg('已打开：' + c.名, '#ffc75c'); } catch (e) { }
  }
  搜刮_画();
  return c;
}

function 搜刮_关() {
  搜刮_清定时();
  RAID_搜刮.开 = false;
  RAID_搜刮.容器 = null;
  var 窗 = 搜刮_元素('rdLootWin');
  if (窗) {
    窗.classList.remove('on');
    /* 局内用完后挪回准备层，免得下次进准备层时多一张盖在主菜单上的窗 */
    if (窗.parentNode === document.body && 窗.__原父) {
      窗.__原父.appendChild(窗);
      窗.style.position = '';
      窗.style.zIndex = '';
    }
  }
  /* 局内：关窗＝把玩家还给 3D（解除暂停、重新锁鼠标） */
  try { if (typeof 搜打撤_搜刮关回调 === 'function') 搜打撤_搜刮关回调(); } catch (e) { }
}

/* 拿一件：背包 → 胸挂 → 安全箱。都装不下就把原因说出来，东西留在容器里。 */
function 搜刮_拿一件(u) {
  var c = RAID_搜刮.容器;
  if (!c) return { ok: false, 因: '没有打开的容器' };
  var it = RAID取件(c, u);
  if (!it) return { ok: false, 因: '这件已经不在了' };
  var 目标 = [
    { 键: 'bp', 容: RAID预设背包() },
    { 键: 'rig', 容: RAID预设胸挂() },
    { 键: 'safe', 容: RAID安全箱() }
  ];
  var 因 = '背包和胸挂都装不下';
  for (var i = 0; i < 目标.length; i++) {
    if (!目标[i].容) continue;
    var r = RAID移动(c, u, 目标[i].容);
    if (r.ok) {
      RAID写档();
      搜刮_画();
      搜打撤_刷仓库();
      return { ok: true, 到: 目标[i].键 };
    }
    因 = r.因 || 因;
  }
  return { ok: false, 因: 因 };
}

/* 拿走同一个物品的所有堆（列表里一行＝一个物品） */
function 搜刮_拿一组(id) {
  var c = RAID_搜刮.容器;
  if (!c) return { ok: false, 因: '没有打开的容器' };
  var 拿 = 0, 因 = '', 保护 = 0;
  for (var i = 0; i < c.件.length && 保护++ < 100;) {
    if (c.件[i].id !== id) { i++; continue; }
    var r = 搜刮_拿一件(c.件[i].u);
    if (r.ok) { 拿++; continue; }        /* 拿走后数组变短，下标不动 */
    因 = r.因 || 因;
    i++;
  }
  return { ok: 拿 > 0, 拿: 拿, 因: 因 };
}

/* 全部拿走：能拿几件拿几件，拿不动就停（不报错刷屏） */
function 搜刮_全部() {
  var c = RAID_搜刮.容器;
  if (!c) return { 拿: 0, 剩: 0 };
  var 拿 = 0, 保护 = 0;
  while (c.件.length && 保护++ < 200) {
    var u = c.件[0].u;
    var r = 搜刮_拿一件(u);
    if (!r.ok) break;
    拿++;
  }
  return { 拿: 拿, 剩: c.件.length };
}

/* ---------- 画窗口 ---------- */
function 搜刮_画() {
  var c = RAID_搜刮.容器;
  var 名 = 搜刮_元素('rdLootName'), 元 = 搜刮_元素('rdLootMeta');
  var 条 = 搜刮_元素('rdLootBar'), 体 = 搜刮_元素('rdLootBody'), 全 = 搜刮_元素('rdLootAll');
  if (!名 || !体) return;
  名.textContent = c ? c.名 : '容器';
  if (元) {
    if (!c) 元.textContent = '';
    else if (!c.已开) 元.textContent = '开盖 ' + Math.round((c.进度 || 0) * 100) + '%';
    else 元.textContent = RAID容器件数(c) + ' 件 · ' + RAID容器重(c).toFixed(1) + ' kg · 值 ' + RAID容器价(c).toLocaleString();
  }
  if (条) {
    条.style.display = (c && !c.已开) ? '' : 'none';
    var 内 = 搜刮_元素('rdLootBarIn');
    if (内) 内.style.width = Math.round((c && c.进度 || 0) * 100) + '%';
  }
  if (!c || !c.已开) {
    体.innerHTML = '<div class="rdLootWait">正在开盖…</div>';
    if (全) 全.disabled = true;
    return;
  }
  if (!c.件.length) {
    体.innerHTML = '<div class="rdLootEmpty">空的<span>这箱子被人翻过了。连开三个空箱会出保底。</span></div>';
    if (全) 全.disabled = true;
    return;
  }
  /* 同一个物品可能占好几堆（叠到上限就开新堆）。列表按物品合并成一行，
     「拿」＝把这个物品的所有堆都收走 —— 一箱里出现两行"活动扳手"只会让人以为出 bug。 */
  var 组 = {}, 序 = [], i;
  for (i = 0; i < c.件.length; i++) {
    var it = c.件[i];
    if (!组[it.id]) { 组[it.id] = { id: it.id, n: 0, 价: 0, 堆: 0 }; 序.push(it.id); }
    组[it.id].n += it.n || 1;
    组[it.id].价 += RAID件价(it);
    组[it.id].堆++;
  }
  序.sort(function (a, b) { return 组[b].价 - 组[a].价; });
  var h = '';
  for (i = 0; i < 序.length; i++) {
    var g = 组[序[i]], d = RAID物品(g.id);
    if (!d) continue;
    var 稀 = RAID_RARITY[d.稀有] || RAID_RARITY[0];
    h += '<div class="rdLootRow" style="border-left-color:' + 稀.色 + '">'
      + '<span class="rdLootIco">' + (window.RAID图标 ? RAID图标(g.id) : '') + '</span>'
      + '<span class="rdLootNm">' + d.名 + (g.n > 1 ? '<em>×' + g.n + '</em>' : '')
      + (g.堆 > 1 ? '<i class="rdLootSplit">' + g.堆 + ' 堆</i>' : '') + '</span>'
      + '<span class="rdLootVal">' + (g.价 | 0).toLocaleString() + '</span>'
      + '<button class="rdBtn rdLootTake" data-take="' + g.id + '">拿</button>'
      + '</div>';
  }
  体.innerHTML = h;
  if (全) 全.disabled = false;
}

/* ---------- 事件（只绑一次） ---------- */
(function 绑搜刮() {
  function 防(e) { try { e.preventDefault(); e.stopPropagation(); } catch (_e) { } }

  var 窗 = 搜刮_元素('rdLootWin');
  if (窗) 窗.addEventListener('click', function (e) {
    if (e.target === 窗) { 防(e); 搜刮_关(); return; }
    e.stopPropagation();
  });

  ['rdLootClose', 'rdLootClose2'].forEach(function (id) {
    var b = 搜刮_元素(id);
    if (b) b.addEventListener('click', function (e) { 防(e); 搜刮_关(); });
  });

  var 全 = 搜刮_元素('rdLootAll');
  if (全) 全.addEventListener('click', function (e) {
    防(e);
    var r = 搜刮_全部();
    try { if (typeof showMsg === 'function') showMsg(r.拿 ? ('拿走 ' + r.拿 + ' 件' + (r.剩 ? '，还有 ' + r.剩 + ' 件装不下' : '')) : '一件也装不下', '#ffc75c'); } catch (_e) { }
  });

  var 体 = 搜刮_元素('rdLootBody');
  if (体) 体.addEventListener('click', function (e) {
    var t = e.target;
    var b = (t && t.closest) ? t.closest('[data-take]') : null;
    if (!b) return;
    防(e);
    var r = 搜刮_拿一组(b.getAttribute('data-take'));
    if (!r.ok) {
      搜提(r.因);
      try { if (typeof showMsg === 'function') showMsg(r.因, '#ff9a9a'); } catch (_e) { }
    }
  });

})();
