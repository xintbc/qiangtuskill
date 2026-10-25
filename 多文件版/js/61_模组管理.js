/* 【batch225】模组管理（js/61_模组管理.js）====================================
   ----------------------------------------------------------------------------
   用户要求（原话拆开）：
     · 手机版也能装 Mod：选完文件自动进 Mods 文件夹、自动登记进模组注册表
     · 手机和电脑都能**启用 / 关闭 / 删除** Mod
     · 服务器上有、客户端没有的 Mod → 自动请求下载并添加

   这个文件干三件事：
     1. 给「模组加载器」提供加载计划（window.MOD_MGR.准备/载入完成）
        —— 内置清单 + 本机已装的，合并去重，再按玩家开关过滤；
     2. 给玩家一个图形面板（设置 → 🧩 模组管理）：装 / 启用 / 关闭 / 删除；
     3. 连上服务器后跟服务器对账（/api/mods），缺哪个下哪个。

   ── 模组到底存在哪（三种后端，启动时自动探测，优先级从上到下）──
     ① 安卓桥（window.gameClient.modList 存在）
        真写进 App 私有目录 files/mods/ —— 就是安卓这边的「Mods 文件夹」。
        MainActivity 拦截 mode/模组/* 时先查它、再回退 assets，所以装完立刻生效。
     ② 服务器（/api/mods 能正常回 JSON）
        真写进 多文件版/mode/模组/ —— 就是电脑这边的「Mods 文件夹」。
        只有页面本身是 http(s) 打开、且那个服务端是新版（有 /api 路由）时才会命中。
     ③ 本地保险库（IndexedDB）
        file:// 双击打开、或桌面客户端那种「虚拟域名」壳子，拿不到写盘权限，
        源码就存在浏览器自己的库里，下次打开照样加载（用 Blob URL 注入）。

   ⚠️ 三条铁律
     · 这个文件必须在「mode/模组加载器.js」之前执行（index.html 里排在 js/ 段末）。
       加载器只认 window.MOD_MGR，没有它就退回原来的单一清单行为，不会崩。
     · 关闭/删除的名单存 localStorage（gunGame.mods.off.v1 / .del.v1），
       按「文件名」记 —— 换服务器换目录也认得出是同一个模组。
     · 别在这里碰 THREE / 场景：这时 scene 可能还没建好，只做文件与界面的事。
   ========================================================================== */
(function () {
  'use strict';
  if (window.MOD_MGR) return;

  var BASE = 'mode/模组/';
  var 键关闭 = 'gunGame.mods.off.v1';      // 已关闭的模组文件名数组
  var 键删除 = 'gunGame.mods.del.v1';      // 已删除的模组文件名数组（内置文件删不掉时靠它隐藏）
  var 键位置 = 'gunGame.mods.where.v1';    // 上次用的存储位置（只用于显示，不参与判断）

  /* ---------------- 小工具 ---------------- */
  function ls读(k, d) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
  }
  function ls写(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function 集合(键) { var a = ls读(键, []), m = {}; for (var i = 0; i < a.length; i++) m[a[i]] = 1; return m; }
  function 加入(键, 名) { var a = ls读(键, []); if (a.indexOf(名) < 0) { a.push(名); ls写(键, a); } }
  function 移出(键, 名) { var a = ls读(键, []), i = a.indexOf(名); if (i >= 0) { a.splice(i, 1); ls写(键, a); } }
  function 去重(a) { var m = {}, o = []; for (var i = 0; i < a.length; i++) { if (a[i] && !m[a[i]]) { m[a[i]] = 1; o.push(a[i]); } } return o; }
  function 补扩展(名) { 名 = String(名 || '').trim(); if (!名) return ''; return /\.js$/i.test(名) ? 名 : 名 + '.js'; }
  function 大小字(n) {
    n = +n || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function 提示(t, 好) {
    try {
      if (typeof showMsg === 'function') { showMsg(t, 好 ? '#6f6' : '#7fd6ff'); return; }
    } catch (e) { }
    try { console.log('[模组管理] ' + t); } catch (e) { }
  }

  /* ---------------- 本地保险库（IndexedDB）----------------
     为什么不用 localStorage：几个模组就能顶满 5MB，而且写大字符串会拖慢主线程。
     IndexedDB 里一条记录＝{v:源码, t:写入时间}，键就是文件名。 */
  var _库 = null;
  function 开库() {
    if (_库) return _库;
    _库 = new Promise(function (ok, no) {
      var r;
      try { r = indexedDB.open('枪战模组库', 1); } catch (e) { no(e); return; }
      r.onupgradeneeded = function () {
        try { var d = r.result; if (!d.objectStoreNames.contains('文件')) d.createObjectStore('文件'); } catch (e) { }
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error || new Error('打不开模组库')); };
    });
    return _库;
  }
  /* 在事务里跑一个动作，等事务 complete 再取结果（比单个 request.onsuccess 稳） */
  function 库跑(读写, 动作) {
    return 开库().then(function (d) {
      return new Promise(function (ok, no) {
        var t = d.transaction('文件', 读写), s = t.objectStore('文件'), req;
        try { req = 动作(s); } catch (e) { no(e); return; }
        t.oncomplete = function () { ok(req ? req.result : undefined); };
        t.onerror = function () { no(t.error || new Error('模组库读写失败')); };
        t.onabort = function () { no(t.error || new Error('模组库事务中断')); };
      });
    });
  }
  var 库 = {
    写: function (名, 文) { return 库跑('readwrite', function (s) { return s.put({ v: String(文 || ''), t: Date.now() }, 名); }); },
    读: function (名) { return 库跑('readonly', function (s) { return s.get(名); }); },
    删: function (名) { return 库跑('readwrite', function (s) { return s.delete(名); }); },
    列: function () {
      return 开库().then(function (d) {
        return new Promise(function (ok, no) {
          var t = d.transaction('文件', 'readonly'), s = t.objectStore('文件');
          var kq = s.getAllKeys(), vq = s.getAll();
          t.oncomplete = function () {
            var ks = kq.result || [], vs = vq.result || [], out = [];
            for (var i = 0; i < ks.length; i++) {
              var rec = vs[i];
              out.push({ 名: ks[i], 大小: rec && rec.v ? String(rec.v).length : 0, 时间: rec && rec.t || 0 });
            }
            ok(out);
          };
          t.onerror = function () { no(t.error); };
        });
      });
    }
  };

  /* ---------------- 后端探测 ---------------- */
  function 有安卓桥() {
    try { return !!(window.gameClient && typeof window.gameClient.modList === 'function'); } catch (e) { return false; }
  }
  var _后端 = '';          // '安卓' | '服务器' | '保险库'
  var _后端定 = false;     // true=已经确定；false=还没定（下次调用会重探）
  var _探测中 = null;

  /* 带超时的 fetch（服务器没开 / 域名是虚拟的，都要能在几秒内放弃） */
  function 拿(url, 选项, 毫秒) {
    var opt = 选项 || {};
    if (typeof AbortController === 'function' && 毫秒) {
      var ac = new AbortController();
      opt.signal = ac.signal;
      var t = setTimeout(function () { try { ac.abort(); } catch (e) { } }, 毫秒);
      return fetch(url, opt).then(function (r) { clearTimeout(t); return r; },
        function (e) { clearTimeout(t); throw e; });
    }
    return fetch(url, opt);
  }

  /* 后端探测
     ⚠️ 【batch225 踩过的坑】探测一开始只给 1500ms —— 页面刚打开时正好有 30 多个 <script>
        在同一个域上排队，/api/mods 被挤在后面超时了，于是被判成「保险库」：
        模组管理把文件写进了浏览器库、服务器上的模组也列不出来（还时好时坏）。
        现在：① 等 5 秒；② 超时不算"定案"，下次打开面板 / 同步时再探一次。 */
  function 探测后端() {
    if (_后端定 && _后端) return Promise.resolve(_后端);
    if (_探测中) return _探测中;
    if (有安卓桥()) { _后端 = '安卓'; _后端定 = true; return Promise.resolve(_后端); }
    var 可http = false;
    try { 可http = (location.protocol === 'http:' || location.protocol === 'https:'); } catch (e) { }
    /* 桌面客户端的壳子把本地目录映射成 https://game.example/ —— 它能发 http 请求，
       但没有 /api。直接认出来，省掉一次注定失败的探测。 */
    var 虚拟壳 = false;
    try { 虚拟壳 = (location.host === 'game.example'); } catch (e) { }
    if (!可http || 虚拟壳) { _后端 = '保险库'; _后端定 = true; return Promise.resolve(_后端); }

    _探测中 = 拿('api/mods', { cache: 'no-store' }, 5000).then(function (r) {
      if (!r || !r.ok) throw new Error('无 /api');
      return r.json();
    }).then(function (j) {
      if (!j || j.ok !== 1) throw new Error('不是模组接口');
      _后端 = '服务器'; _后端定 = true;
      try { ls写(键位置, '服务器'); } catch (e) { }
      _探测中 = null;
      return _后端;
    }).catch(function () {
      _后端 = '保险库'; _后端定 = false;        // 留个活口：下次再探
      try { ls写(键位置, '保险库'); } catch (e) { }
      _探测中 = null;
      return _后端;
    });
    return _探测中;
  }

  /* 后端：列出「已装的模组」（不含内置清单里的） */
  function 后端列() {
    if (_后端 === '安卓') {
      return Promise.resolve().then(function () {
        var s = window.gameClient.modList();
        var arr = [];
        try { arr = JSON.parse(s || '[]'); } catch (e) { arr = []; }
        var out = [];
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i];
          if (!it || !it.n) continue;
          out.push({ 名: 补扩展(it.n), 大小: +it.s || 0, 来源: '已装' });
        }
        return out;
      }).catch(function () { return []; });
    }
    if (_后端 === '服务器') {
      return 拿('api/mods', { cache: 'no-store' }, 4000).then(function (r) { return r.json(); }).then(function (j) {
        var out = [];
        var a = (j && j.mods) || [];
        for (var i = 0; i < a.length; i++) if (a[i] && a[i].n) out.push({ 名: a[i].n, 大小: +a[i].s || 0, 来源: '已装', 启用: !!a[i].on });
        return out;
      }).catch(function () { return []; });
    }
    return 库.列().then(function (a) {
      var out = [];
      for (var i = 0; i < a.length; i++) out.push({ 名: a[i].名, 大小: a[i].大小, 来源: '已装' });
      return out;
    }).catch(function () { return []; });
  }

  /* 后端：写入一个模组（安卓/服务器＝真存进 Mods 文件夹；保险库＝存浏览器） */
  function 后端写(名, 文) {
    if (_后端 === '安卓') {
      return Promise.resolve().then(function () {
        var ok = window.gameClient.modWrite(名, 文);
        if (ok === false) throw new Error('安卓写入失败');
        return true;
      });
    }
    if (_后端 === '服务器') {
      /* body 用 text/plain 发：不带 Content-Type: application/json 就不会触发 CORS 预检，
         浏览器在 file:// 或跨域页面里也能直接 POST。 */
      return 拿('api/mod/save?n=' + encodeURIComponent(名), {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: 文
      }, 8000).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || j.ok !== 1) throw new Error((j && j.err) || '服务器拒绝了这次写入');
        return true;
      });
    }
    return 库.写(名, 文).then(function () { return true; });
  }

  function 后端删(名) {
    if (_后端 === '安卓') {
      return Promise.resolve().then(function () { window.gameClient.modDelete(名); return true; });
    }
    if (_后端 === '服务器') {
      return 拿('api/mod/del?n=' + encodeURIComponent(名), { method: 'POST', headers: { 'Content-Type': 'text/plain' } }, 6000)
        .then(function (r) { return r.json(); }).then(function (j) { return !!(j && j.ok === 1); })
        .catch(function () { return false; });
    }
    return 库.删(名).then(function () { return true; }).catch(function () { return false; });
  }

  function 后端读(名) {
    if (_后端 === '安卓') {
      return Promise.resolve().then(function () { return window.gameClient.modRead(名); });
    }
    if (_后端 === '服务器') {
      return 拿('api/mod?n=' + encodeURIComponent(名), { cache: 'no-store' }, 6000)
        .then(function (r) { if (!r.ok) throw new Error('取不到 ' + 名); return r.text(); });
    }
    return 库.读(名).then(function (rec) { return rec && rec.v ? rec.v : ''; });
  }

  /* ---------------- 扫描：把「内置清单」和「已装」合成一张表 ---------------- */
  var 已扫描 = [];          // [{名, 大小, 来源:'内置'|'已装', url, _blob, ver, 兼容}]
  var 内置名单 = [];        // 最近一次准备() 拿到的内置清单（去掉扩展名前的原名也存一份）
  var _版本不兼容 = [];     // 【batch229】大版本和游戏对不上的模组（面板里说明，不加载）

  function 扫描(内置) {
    var 内 = [], 内集 = {};
    for (var i = 0; i < (内置 || []).length; i++) {
      var n = 补扩展(内置[i]);
      if (!n || 内集[n]) continue;
      内集[n] = 1;
      内.push({ 名: n, 大小: 0, 来源: '内置', url: BASE + encodeURIComponent(n) });
    }
    内置名单 = 内;
    return 后端列().then(function (外) {
      var 表 = 内.slice();
      for (var j = 0; j < 外.length; j++) {
        var it = 外[j];
        if (!it || !it.名) continue;
        if (内集[it.名]) {
          /* 名字和内置清单里的撞了 —— 就是同一个文件（服务器 / 手机那边的 Mods 目录
             本来就放着这些内置模组），只把大小/启用状态补上，**标签保持「内置」**。
             如果这里改成「已装」，玩家看到的会是整整一列"已装"，分不清哪些是自己装的。 */
          for (var k = 0; k < 表.length; k++) if (表[k].名 === it.名) { 表[k].大小 = it.大小; 表[k].启用 = it.启用; }
          continue;
        }
        /* 启用状态：服务器后端由载入清单决定（on）；别的后端没有这个概念，默认全启用 */
        表.push({ 名: it.名, 大小: it.大小, 来源: '已装', 启用: it.启用 === undefined ? true : it.启用, url: BASE + encodeURIComponent(it.名) });
      }
      已扫描 = 表;
      return 表;
    });
  }

  /* ---------------- 给加载器用：准备 / 载入完成 ---------------- */
  var _blobUrl = [];

  /* 【batch229】模组版本兼容：模组可在文件头声明版本（两种写法任选）
       // @ver 1.7.0
       var MOD_VER='1.7.0';
     大版本（major）和游戏不一致 → 不加载、面板里标红说明。
     没声明的一律放行 —— 老模组不受影响（向后兼容）。 */
  function 抽模组版本(文) {
    if (!文) return '';
    var m = /@ver\s+([0-9]+(?:\.[0-9]+){0,2})/.exec(文) ||
            /MOD_VER\s*=\s*['"]([0-9]+(?:\.[0-9]+){0,2})['"]/.exec(文);
    return m ? (m[1] || m[2]) : '';
  }
  function 模组兼容(ver) {
    if (!ver) return true;
    var a = String(ver).split('.')[0];
    var b = String((typeof GAME_VER !== 'undefined' ? GAME_VER : '1.0.0')).split('.')[0];
    return a === b;
  }
  /* 读一个模组的文本：保险库走库里读，别的走 fetch（浏览器会缓存，随后真正加载不费二次网络） */
  function 读模组文本(项) {
    if (项._文) return Promise.resolve(项._文);
    if (_后端 === '保险库') return 库读文案(项.名).then(function (文) { 项._文 = 文 || ''; return 项._文; }).catch(function () { return ''; });
    return fetch(项.url, { cache: 'force-cache' }).then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (文) { 项._文 = 文 || ''; return 项._文; }).catch(function () { return ''; });
  }

  function 准备(内置) {
    return 探测后端().then(function () { return 扫描(内置); }).then(function (表) {
      var 关 = 集合(键关闭), 删 = 集合(键删除);
      /* 【batch226】网页玩家（后端=服务器）：服务器上的模组**全员照常加载**，
         本机的开关/删除名单一概不认 —— 网页端不让禁用模组，同一台服务器上所有人看到的东西一致。
         （名单还留在 localStorage 里，哪天改用客户端打开又能用上。） */
      if (_后端 === '服务器') { 关 = {}; 删 = {}; }
      var 文件 = [], 跳过 = [];
      /* 【batch229】先并发把所有模组的版本声明读出来（小文件，几十毫秒的事） */
      return Promise.all(表.map(function (it) {
        return 读模组文本(it).then(function (文) {
          it.ver = 抽模组版本(文);
          it.兼容 = 模组兼容(it.ver);
        });
      })).then(function () {
        for (var i = 0; i < 表.length; i++) {
          var it = 表[i];
          /* 【batch226】服务器后端：**载入清单才是权威**。清单里没有（/api/mods 的 on=0）
             就不加载 —— 不然黑窗口 mod off 关掉的模组照样被加载，清单形同虚设。
             （这就是"模组清单里没有的模组却被正常加载"的根因。） */
          if (_后端 === '服务器' && it.启用 === false) { 跳过.push(it.名); continue; }
          if (删[it.名]) { 跳过.push(it.名); continue; }
          if (关[it.名]) { 跳过.push(it.名); continue; }
          /* 【batch229】大版本不兼容的模组：跳过并记账（面板里会说明原因） */
          if (!it.兼容) {
            跳过.push(it.名);
            _版本不兼容.push({ 名: it.名, ver: it.ver || '(没声明)' });
            continue;
          }
          文件.push({ 名: it.名, url: it.url });
        }
        /* 保险库里的模组没有真实 URL：现做一个 Blob URL（加载完再统一回收）。
         逐个查库：库里有源码就用 Blob（玩家自己装的，可能还覆盖了同名内置文件），
         库里没有才回落到 mode/模组/ 那个真实路径（游戏自带的文件）。 */
      if (_后端 === '保险库') {
        var 任务 = [];
        for (var r = 0; r < 文件.length; r++) {
          任务.push((function (idx) {
            return 库读文案(文件[idx].名).then(function (文) {
              if (!文) return;
              var u = URL.createObjectURL(new Blob([文], { type: 'text/javascript' }));
              _blobUrl.push(u);
              文件[idx].url = u;
            }).catch(function () { });
          })(r));
        }
        return Promise.all(任务).then(function () {
          return { 文件: 文件, 跳过: 跳过, 后端: _后端 };
        });
      }
      return { 文件: 文件, 跳过: 跳过, 后端: _后端 };
      });   /* 【batch229】关闭 Promise.all(版本读取).then */
    });     /* 关闭 探测后端().then */
  }
  function 库读文案(名) { return 库.读(名).then(function (rec) { return rec && rec.v ? rec.v : ''; }); }

  function 载入完成() {
    for (var i = 0; i < _blobUrl.length; i++) { try { URL.revokeObjectURL(_blobUrl[i]); } catch (e) { } }
    _blobUrl = [];
    /* 已经加载过的（未关闭、未删除的）记一份，面板里据此标「正在生效」 */
    try { 重画面板(); } catch (e) { }
  }

  /* ---------------- 安装 / 启用 / 关闭 / 删除 ---------------- */
  /* 【batch226】谁能改模组？
     · 后端是「安卓 / 保险库」＝改的是**自己设备上的本地模组** → 随便装随便删；
     · 后端是「服务器」（网页从 /pc、/mobile 打开）＝那台服务器是别人的，
       网页玩家**不许**往服务器磁盘写文件、删文件 —— 模组由服务器主管理，
       玩家顶多把自己不喜欢的关掉（这只影响自己这台设备）。
     桌面客户端 / 手机 APK / 双击 index.html 都是前一种，所以"只有客户端能管理本地模组"。 */
  function 本地可写() { return _后端 === '安卓' || _后端 === '保险库'; }

  function 装(名, 文) {
    名 = 补扩展(名);
    if (!名) return Promise.reject(new Error('文件名是空的'));
    if (!文 || !String(文).trim()) return Promise.reject(new Error('文件是空的'));
    if (!本地可写()) return Promise.reject(new Error('网页上不能改动服务器上的模组：模组由服务器主放进服务器的 mode/模组/，所有人自动同步'));
    移出(键删除, 名);                        // 重新装回来的东西当然要重新出现
    return 探测后端().then(function () { return 后端写(名, 文); }).then(function () {
      return 扫描(内置名单.map(function (x) { return x.名; })).then(function () { return 名; });
    });
  }

  function 设启用(名, 开) {
    名 = 补扩展(名);
    /* 【batch226】网页玩家连开关也没有：服务器上的模组由服务器主统一管理，
       不让浏览器端一个人关掉 —— 要不大家的画面都不一样了。 */
    if (!本地可写()) return Promise.reject(new Error('网页上不能开关服务器模组：要装/关/删模组请用客户端（手机 App / 电脑客户端）'));
    if (开) { 移出(键关闭, 名); 移出(键删除, 名); } else { 加入(键关闭, 名); }
    return Promise.resolve(名);
  }

  function 删(名) {
    名 = 补扩展(名);
    if (!本地可写()) return Promise.reject(new Error('网页上不能删除服务器上的模组（这会影响所有人）'));
    加入(键删除, 名);
    return 探测后端().then(function () {
      return 后端删(名).catch(function () { return false; });
    }).then(function (真删了) {
      return 扫描(内置名单.map(function (x) { return x.名; })).then(function () { return 真删了; });
    });
  }

  /* 把「删除」过的内置模组全放回来（玩家手滑删了内置的，又不想重装游戏） */
  function 恢复内置() {
    ls写(键删除, []);
    return 扫描(内置名单.map(function (x) { return x.名; }));
  }

  /* ---------------- 跟服务器对账：服务器有、本机没有 → 自动下载 ---------------- */
  /* host 形如 192.168.1.5:8765；secure=wss 时走 https。 */
  function 同源(host) {
    try { return String(location.host || '') === String(host || ''); } catch (e) { return false; }
  }
  function 基地址(host, secure) {
    if (!host) return '';
    if (同源(host)) return '';                       // 页面本来就是这台服务器发的：用相对路径，免混内容
    return (secure || /:443$/.test(host) ? 'https://' : 'http://') + host;
  }

  var _同步中 = false;
  function 同步服务器(host, secure, 静默) {
    if (_同步中) return Promise.resolve(0);
    var base = 基地址(host, secure);
    if (!base && (location.protocol !== 'http:' && location.protocol !== 'https:')) return Promise.resolve(0);
    _同步中 = true;
    return 拿(base + '/api/mods', { cache: 'no-store' }, 5000).then(function (r) {
      if (!r || !r.ok) throw new Error('服务器没有模组接口');
      return r.json();
    }).then(function (j) {
      var 远端 = (j && j.mods) || [];
      var 有 = {};
      for (var i = 0; i < 已扫描.length; i++) 有[已扫描[i].名] = 1;
      /* 【batch226】网页玩家（后端=服务器）：模组本来就在同一台服务器上、直接就能加载，
         "下载到本机"毫无意义，还会把旧副本存进保险库、以后服务器更新了它还在用旧的。
         顺手把列表刷新一下就走人。 */
      if (_后端 === '服务器') {
        _同步中 = false;
        return 扫描(内置名单.map(function (x) { return x.名; })).then(function () { return 0; });
      }
      var 缺 = [];
      for (var k = 0; k < 远端.length; k++) {
        var n = 远端[k] && 远端[k].n;
        /* 【batch226】只同步「服务器启用的」：没启用的下回来也会被保险库加载，等于绕过 mod off */
        if (n && !有[n] && 远端[k].on !== 0) 缺.push(n);
      }
      if (!缺.length) {
        _同步中 = false;
        if (!静默) 提示('✅ 服务器上的模组本机都有了', true);
        return 0;
      }
      /* 串行下载：模组不大，串行更稳，也不会把隧道带宽打满 */
      var 装好 = [], p = Promise.resolve();
      缺.forEach(function (n) {
        p = p.then(function () {
          return 拿(base + '/api/mod?n=' + encodeURIComponent(n), { cache: 'no-store' }, 10000)
            .then(function (r) { if (!r.ok) throw new Error('下载失败'); return r.text(); })
            .then(function (文) { return 装(n, 文); })
            .then(function () { 装好.push(n); })
            .catch(function (e) { try { console.warn('[模组管理] 下载 ' + n + ' 失败：' + (e && e.message)); } catch (_) { } });
        });
      });
      return p.then(function () {
        _同步中 = false;
        重画面板();
        if (装好.length) {
          提示('⬇️ 已从服务器装好 ' + 装好.length + ' 个模组：' + 装好.join('、') + '（点「刷新游戏」后生效）', true);
          try { 亮刷新钮(); } catch (e) { }
        } else if (!静默) {
          提示('服务器上有模组没下下来，可以到「设置 → 模组管理」点「从服务器同步」重试', false);
        }
        return 装好.length;
      });
    }).catch(function (e) {
      _同步中 = false;
      if (!静默) 提示('同步失败：' + ((e && e.message) || '服务器连不上'), false);
      return -1;
    });
  }

  /* ---------------- 界面 ---------------- */
  var _面板 = null, _列表 = null, _提示行 = null, _刷新钮 = null, _输入 = null;

  function 建面板() {
    if (_面板) return _面板;
    var L = document.createElement('div');
    L.id = 'modPanel';
    L.className = 'ctLayer';
    L.innerHTML =
      '<div class="ctCard" style="width:92%;max-width:560px;text-align:left">' +
      '<h3 style="text-align:center">🧩 模组管理</h3>' +
      '<p class="spHint" id="modWhere" style="text-align:center">正在检查存储位置…</p>' +
      '<div id="modList" style="margin:8px 0;max-height:46vh;overflow-y:auto;touch-action:pan-y"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0">' +
      '<button class="spBtn" id="modInstall" style="flex:1;min-width:132px;margin:0">📂 安装模组（选文件）</button>' +
      '<button class="spBtn" id="modSync" style="flex:1;min-width:132px;margin:0">🌐 从服务器同步</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0">' +
      '<button class="spBtn" id="modRefreshBtn" style="flex:1;min-width:110px;margin:0;display:none">🔄 刷新游戏（生效）</button>' +
      '<button class="spBtn" id="modRestore" style="flex:1;min-width:110px;margin:0">↺ 恢复内置模组</button>' +
      '</div>' +
      '<p class="spHint" id="modHint" style="text-align:center"></p>' +
      '<button class="spBtn spClose" id="modClose">关闭</button>' +
      '</div>';
    document.body.appendChild(L);

    _列表 = L.querySelector('#modList');
    _提示行 = L.querySelector('#modHint');
    _刷新钮 = L.querySelector('#modRefreshBtn');
    _面板 = L;                       // ⚠️ 必须在这里落名：开面板()/重画面板() 都靠它，忘了就是"点了没反应"

    var 文件 = document.createElement('input');
    文件.type = 'file';
    文件.accept = '.js,text/javascript,application/javascript,text/plain';
    文件.multiple = true;
    文件.style.display = 'none';
    document.body.appendChild(文件);
    _输入 = 文件;

    文件.addEventListener('change', function () {
      var fs = 文件.files || [];
      if (!fs.length) return;
      说('⏳ 正在安装 ' + fs.length + ' 个模组…');
      var p = Promise.resolve(), 好 = 0, 坏 = [];
      for (var i = 0; i < fs.length; i++) {
        (function (f) {
          p = p.then(function () {
            return 读文件文案(f).then(function (文) { return 装(f.name, 文); })
              .then(function () { 好++; })
              .catch(function (e) { 坏.push(f.name + '（' + ((e && e.message) || '失败') + '）'); });
          });
        })(fs[i]);
      }
      p.then(function () {
        文件.value = '';
        重画面板();
        if (好) { 说('✅ 已装好 ' + 好 + ' 个模组。' + (坏.length ? '失败：' + 坏.join('、') : '点「刷新游戏」后生效。')); 亮刷新钮(); }
        else 说('❌ 安装失败：' + (坏.join('、') || '文件读不出来'));
      });
    });

    L.querySelector('#modInstall').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!有加载器()) { 说('这个页面（单文件版）没有模组加载器：请打开「多文件版」或手机 APK 再装模组。'); return; }
      if (有安卓桥() && typeof window.gameClient.pickMod === 'function') {
        /* 安卓：走系统文件选择器 —— 选完直接落进 files/mods/ 并自动重载（原生那边做完了） */
        window.gameClient.pickMod();
        return;
      }
      try { _输入.click(); } catch (err) { 说('这个浏览器不让选文件，只能手动把 .js 放进 mode/模组/ 目录'); }
    });
    L.querySelector('#modSync').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var host = '';
      try { host = (typeof NET !== 'undefined' && NET && (NET.server || NET.raw)) || ''; } catch (err) { }
      if (!host) { 说('还没连服务器：先在主菜单「多人游戏」里连一次，再回来同步。'); return; }
      说('⏳ 正在跟 ' + host + ' 对账…');
      同步服务器(host, (function () { try { return !!NET.secure; } catch (err) { return false; } })(), false);
    });
    _刷新钮.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      try { location.reload(); } catch (err) { }
    });
    L.querySelector('#modRestore').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      恢复内置().then(function () { 重画面板(); 说('已恢复内置模组列表（被删掉的文件需要重新放回 mode/模组/）'); });
    });
    L.querySelector('#modClose').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); 关面板();
    });
    L.addEventListener('click', function (e) { if (e.target === L) 关面板(); });
    return L;
  }

  function 读文件文案(f) {
    return new Promise(function (ok, no) {
      try {
        var r = new FileReader();
        r.onload = function () { ok(String(r.result || '')); };
        r.onerror = function () { no(new Error('读取失败')); };
        r.readAsText(f, 'utf-8');
      } catch (e) { no(e); }
    });
  }

  function 说(t) { if (_提示行) _提示行.textContent = t; }
  function 亮刷新钮() { if (_刷新钮) _刷新钮.style.display = 'block'; }

  /* 这个页面到底有没有模组加载器？
     单文件版（网页3D枪战游戏.html）里是**没有**的 —— 它的模组靠 index.html 那份
     分片页面去 mode/ 目录拉。没有加载器时面板只当"说明"用，别让玩家以为装了就生效。 */
  function 有加载器() { try { return !!(window.ModLoader && typeof window.ModLoader.addWeapon === 'function'); } catch (e) { return false; } }

  function 重画面板() {
    if (!_面板 || !_列表) return;
    var 关 = 集合(键关闭), 删 = 集合(键删除);
    var 位置 = _后端 === '安卓' ? '📱 手机 Mods 文件夹（App 私有目录 files/mods/）'
      : (_后端 === '服务器' ? '💻 服务器的 Mods 文件夹（mode/模组/）—— 网页上只读，由服务器主管理'
        : '💾 浏览器本地模组库（离线模式：双击打开的网页 / 客户端壳子都存这儿）');
    var w = _面板.querySelector('#modWhere');
    if (w) w.textContent = '存储位置：' + 位置 + (有加载器() ? '' : '　⚠️ 本页面没有模组加载器');

    var 表 = 已扫描;
    if (!表.length) {
      _列表.innerHTML = '<p class="spHint" style="text-align:center">' + (有加载器()
        ? '还没有任何模组。点下面的「安装模组」选一个 .js 文件。'
        : '这个页面（单文件版）没有模组加载器，装不了模组。<br>想在电脑上玩模组：打开「多文件版」的 index.html 或客户端；手机上装 APK。') + '</p>';
      return;
    }
    var 名集 = {};
    for (var i = 0; i < 表.length; i++) 名集[表[i].名] = 1;
    /* 删除名单里但文件还在的（内置删不掉的情况）也要列出来 —— 玩家得能看见自己删了什么 */
    var 隐形 = ls读(键删除, []);

    var 行 = [];
    var 全部 = 表.slice();
    for (var j = 0; j < 隐形.length; j++) {
      if (!名集[隐形[j]]) 全部.push({ 名: 隐形[j], 大小: 0, 来源: '内置', 已删: true });
    }
    全部.sort(function (a, b) {
      if (!!a.已删 !== !!b.已删) return a.已删 ? 1 : -1;
      return String(a.名).localeCompare(String(b.名), 'zh');
    });

    for (var k = 0; k < 全部.length; k++) {
      var it = 全部[k];
      var 可管 = 本地可写();
      /* 网页玩家：启不满由服务器载入清单决定（黑窗口 mod on/off），本机不许改 */
      var 启用 = 可管 ? (!关[it.名] && !删[it.名]) : (it.启用 !== false);
      var 标签 = it.来源 === '内置' ? '<span style="color:#7fd6ff">内置</span>' : '<span style="color:#ffd166">已装</span>';
      if (it.已删) 标签 += ' <span style="color:#f88">已删除</span>';
      else if (启用) 标签 += ' <span style="color:#6f6">● 启用中</span>';
      else 标签 += ' <span style="color:#999">' + (可管 ? '○ 已关闭' : '○ 服务器未启用') + '</span>';
      /* 【batch229】版本徽章：声明了 @ver 的显示版本号；大版本和游戏对不上的标红说明 */
      if (it.ver) 标签 += ' <span style="color:' + (it.兼容 === false ? '#f88' : '#9cf') + '">v' + 转义(it.ver) + '</span>';
      if (it.兼容 === false) 标签 += ' <span style="color:#f88">⛔ 版本不兼容（要 ' + (typeof GAME_VER !== 'undefined' ? GAME_VER : '?') + ' 的大版本）</span>';
      行.push(
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid rgba(255,255,255,.09)">' +
        '<div style="flex:1;min-width:0">' +
        '<div style="font-size:14px;color:#fff;word-break:break-all">' + 转义(it.名) + '</div>' +
        '<div style="font-size:11px;color:#889;margin-top:2px">' + 标签 + (it.大小 ? (' · ' + 大小字(it.大小)) : '') + '</div>' +
        '</div>' +
        (可管 && !it.已删 ? '<button data-act="' + (启用 ? 'off' : 'on') + '" data-n="' + 转义(it.名) + '"' +
          ' style="' + 钮样式(启用 ? '#555' : '#2f7b45') + '">' + (启用 ? '关闭' : '启用') + '</button>' : '') +
        (可管 ? '<button data-act="del" data-n="' + 转义(it.名) + '" style="' + 钮样式('#8a3232') + '">删除</button>' : '') +
        '</div>'
      );
    }
    _列表.innerHTML = 行.join('');

    /* 【batch226】网页玩家：这个面板就是纯"看"——装 / 同步 / 恢复 / 开关 / 删除全部收起。
       服务器上的模组由服务器主统一管理（放进 mode/模组/ 大家自动同步），
       不让浏览器端一个人禁用，免得同一台服务器上大家画面都不一样。
       ⚠️ 别动 modRefreshBtn：它由 亮刷新钮() 单独管（default 是 display:none，改 '' 会常驻显示）。 */
    if (!本地可写()) {
      ['modInstall', 'modSync', 'modRestore'].forEach(function (id) {
        var b = _面板.querySelector('#' + id);
        if (b) b.style.display = 'none';
      });
    }
    绑定行按钮();
    if (!_提示行.textContent) {
      说(本地可写() ? '提示：模组是第三方代码，装之前最好看一眼里面写了什么。'
        : '这里只是列表：网页端不能装 / 关 / 删模组，服务器上的模组由服务器主统一管理。想用自己的模组请用手机 App 或电脑客户端。');
    }
  }

  function 钮样式(色) {
    return 'padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.28);background:' + 色 +
      ';color:#fff;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;flex:0 0 auto';
  }
  function 转义(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function 绑定行按钮() {
    if (!_列表) return;
    var bs = _列表.querySelectorAll('button[data-act]');
    for (var i = 0; i < bs.length; i++) {
      bs[i].addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var act = this.getAttribute('data-act');
        var n = this.getAttribute('data-n');
        if (act === 'on' || act === 'off') {
          设启用(n, act === 'on').then(function () {
            重画面板();
            说((act === 'on' ? '已启用 ' : '已关闭 ') + n + ' —— 点「刷新游戏」后生效。');
            亮刷新钮();
          }).catch(function (err) { 重画面板(); 说('❌ ' + ((err && err.message) || '改不了')); });
          return;
        }
        if (act === 'del') {
          if (!confirm('删除模组「' + n + '」？\n\n· 已装的文件会从 Mods 文件夹里删掉\n· 内置模组删不掉文件，只会从加载列表里移除（可以点「恢复内置模组」找回来）')) return;
          删(n).then(function (真删了) {
            重画面板();
            说('已删除 ' + n + (真删了 ? '（文件已移除）' : '（已从加载列表移除）') + ' —— 点「刷新游戏」后生效。');
            亮刷新钮();
          }).catch(function (err) { 重画面板(); 说('❌ ' + ((err && err.message) || '删除失败')); });
        }
      });
    }
  }

  function 开面板() {
    建面板();
    _面板.classList.add('on');
    重画面板();
    探测后端().then(function () {
      return 扫描(内置名单.map(function (x) { return x.名; }));
    }).then(function () { 重画面板(); }).catch(function () { 重画面板(); });
  }
  function 关面板() { if (_面板) _面板.classList.remove('on'); }

  /* 设置面板里挂一个入口（不改 index.html：直接插在「关闭」按钮前面，跟着设置面板走） */
  function 挂设置入口() {
    var card = document.querySelector('#settingsPanel .spCard');
    if (!card || document.getElementById('spModBtn')) return;
    var b = document.createElement('button');
    b.id = 'spModBtn';
    b.className = 'spBtn';
    b.textContent = '🧩 模组管理（装 / 启停 / 删除）';
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      /* ⚠️ 必须走 openSettings(false) 正规关闭，不能只把 class 摘掉！
         js/23 的 spOpen 旗子不清掉，游戏里所有 mousedown 都会被
         `if(weaponSelectOpen()||spOpen)return` 吞掉 → 进游戏后左键开不了枪、右键开不了镜
         （batch226 用户实测："左键和右键按了都没效果"）。menuPauseSync 的 S.paused 也得它来还原。 */
      if (typeof openSettings === 'function') openSettings(false);
      else { var sp = document.getElementById('settingsPanel'); if (sp) sp.classList.remove('on'); }
      开面板();
    });
    var close = card.querySelector('#spClose');
    if (close && close.parentNode === card) card.insertBefore(b, close);
    else card.appendChild(b);
  }

  /* ---------------- 对外 ---------------- */
  window.MOD_MGR = {
    准备: 准备,
    载入完成: 载入完成,
    打开: 开面板,
    关闭: 关面板,
    装: 装,
    删: 删,
    设启用: 设启用,
    恢复内置: 恢复内置,
    同步服务器: 同步服务器,
    列出: function () { return 已扫描.slice(); },
    扫描: function () { return 扫描(内置名单.map(function (x) { return x.名; })); },
    当前后端: function () { return _后端 || '未探测'; },
    刷新: function () { 重画面板(); }
  };

  /* ---------------- 启动 ---------------- */
  function 启动() {
    挂设置入口();
    /* 探一次后端，让「存储位置」这句在打开面板前就是对的（失败也无所谓） */
    探测后端().catch(function () { });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', 启动);
  else 启动();
})();
