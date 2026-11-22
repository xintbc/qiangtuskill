/* ==================== 【1.11.0】载入动画（三轮） ====================
   用户口径：
     ① 校验文件完整度 —— 先看当前版本，再检查所有文件是否和这个版本一致；
        不一致就自动替换掉（**绝不替换玩家数据**：localStorage / IndexedDB 一律不碰）。
     ② 检查更新。
     ③ 加载模组和所有组件。
     进度条走满后淡出，正常进界面。
     退出游戏 / 重开 / 死亡后重来 —— 都要**立刻**先起这个屏，不能先卡一下再刷。

   为什么屏在 HTML 里而不是这里建：
     35 个 js 是同步下载执行的，这段 js 本身要等到最后一个才跑。屏放在 body 第一个元素
     （index.html 里 #boot），HTML 解析到就整屏盖住 —— 用户从头到尾看不到白屏。
     这个文件只负责「驱动进度 + 校验 + 收尾」。

   校验能做到什么程度（写清楚，别吹）：
     · 能查：script 的 ?v= 是否与 GAME_VER 一致、每条 URL 是否还活着（HEAD）、
       本轮有没有脚本加载失败（window.__jsFail 在 index.html 里收集）。
     · 能修：HTTP(S) 下「文件不一致」几乎只有一种成因——浏览器缓存了旧文件。
       修法就是带一次性 _f=<时间戳> 强制重取，服务端文件本来就是新的，
       重取即等于替换；连续两次仍失败就不再死循环，标红继续进游戏（而不是卡死）。
     · 不能修：本地文件(file://) / 断网 / 服务端真的缺文件 —— 这些只标红，不阻断。
   ==================================================================== */
(function () {
  'use strict';

  var 屏 = document.getElementById('boot');
  if (!屏) return;                       /* spike.html 这类独立页面没有载入屏，直接跳过 */

  /* 屏在的时候，底下的名字面板 / 主菜单不显示（否则淡出的 160ms 里会透上来和 logo 叠字）。
     挂在这里而不是写死在 <body> 上：这段 js 要是没加载成功，菜单仍然照常可见。 */
  try { document.body.classList.add('boot-on'); } catch (e) { }

  var 填充 = document.getElementById('bootFill');
  var 百分 = document.getElementById('bootPct');
  var 说明 = document.getElementById('bootMsg');
  var 版本标 = document.getElementById('bootVer');
  var 步骤 = 屏.querySelectorAll('#bootSteps li');
  var 修复键 = document.getElementById('bootFix');

  var 当前 = 0, 目标 = 0, 在跑 = 0, 已关 = 0, 有错 = 0;
  var 修复标记 = 'gunGame.bootFix';
  /* 代号：完成() 里有两次 setTimeout（260ms 加 off、420ms 再 display:none）。
     如果玩家在这两段延时里点了「退出」，重载() 刚把屏亮起来，旧定时器又会把它藏掉 ——
     代号一变，旧定时器全部作废。 */
  var 代数 = 0;

  /* ---------- 进度条：目标值 + 缓动，避免忽快忽慢 ---------- */
  function 画() {
    在跑 = 0;
    当前 += (目标 - 当前) * 0.18;
    if (目标 - 当前 < 0.4) 当前 = 目标;
    if (填充) 填充.style.width = 当前.toFixed(1) + '%';
    if (百分) 百分.textContent = Math.round(当前) + '%';
    if (当前 < 目标) 在跑 = requestAnimationFrame(画);
  }
  function 到(v) {
    目标 = Math.max(0, Math.min(100, v));
    if (!在跑) 在跑 = requestAnimationFrame(画);
  }
  function 说(t) { if (说明) 说明.textContent = t || ''; }
  function 步(i, 态, 注) {
    var li = 步骤[i];
    if (!li) return;
    li.className = 态 || '';
    var em = li.querySelector('em');
    if (em && 注 != null) em.textContent = 注;
    if (态 === 'bad') 有错 = 1;
  }
  function 存(k, v) { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { } }
  function 取(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function 睡(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function 帧() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }

  function 主版本(v) {
    var m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
    return m ? m[1] + '.' + m[2] + '.' + m[3] : '';
  }
  function 本地能改() { return location.protocol === 'http:' || location.protocol === 'https:'; }

  /* ---------- ① 校验文件完整度 / 版本一致性 ---------- */
  function 校验() {
    步(0, 'run', '校验中');
    说('正在核对 ' + document.querySelectorAll('script[src]').length + ' 个文件…');
    到(8);

    var 本版 = (typeof GAME_VER !== 'undefined' && GAME_VER) ? String(GAME_VER) : '';
    if (版本标) 版本标.textContent = 本版 ? ('版本 ' + 本版) : '开发版';
    var 主 = 主版本(本版);

    var 标签 = document.querySelectorAll('script[src]');
    var 地址 = [], 不一致 = [], 无版本 = 0;

    标签.forEach(function (s) {
      var 原文 = s.getAttribute('src') || '';
      var m = /[?&]v=([^&]+)/.exec(原文);
      if (!m) { 无版本++; return; }
      if (主 && 主版本(decodeURIComponent(m[1])) !== 主) 不一致.push(原文.split('/').pop());
      try { 地址.push(s.src); } catch (e) { }
    });

    var 加载失败 = (window.__jsFail || []).slice(0);
    到(20);

    /* 存活探测：只发 HEAD，6 路并发，总共最多等 3 秒，超时不算错（网慢不能挡住玩）。
       只把 404 当「文件缺失」：405/403/HEAD 不支持/中断 全部按未知处理 ——
       宁可漏报也不能误报（误报会触发一次无谓的整页重载）。 */
    function 探(u) {
      var 控 = null, 定时 = null;
      try {
        控 = new AbortController();
        定时 = setTimeout(function () { try { 控.abort(); } catch (e) { } }, 2000);
        return fetch(u, { method: 'HEAD', cache: 'no-store', signal: 控.signal })
          .then(function (r) { clearTimeout(定时); return r.status === 404 ? (u.split('/').pop().split('?')[0]) : null; })
          .catch(function () { clearTimeout(定时); return null; });   /* 中断/网络错误一律不算缺文件 */
      } catch (e) { return Promise.resolve(null); }
    }
    function 批量(表, 并发) {
      var 游标 = 0, 缺 = [];
      function 工() {
        if (游标 >= 表.length) return Promise.resolve();
        var u = 表[游标++];
        return 探(u).then(function (x) { if (x) 缺.push(x); return 工(); });
      }
      var 组 = [];
      for (var i = 0; i < 并发; i++) 组.push(工());
      return Promise.all(组).then(function () { return 缺; });
    }

    var 探活 = 本地能改() ? 批量(地址, 6) : Promise.resolve([]);
    return Promise.race([探活, 睡(3000).then(function () { return []; })]).then(function (缺失) {
      到(34);
      var 问题 = 缺失.length + 不一致.length + 加载失败.length;

      if (!问题) {
        存(修复标记, null);                       /* 这一轮干净 → 允许下次再修 */
        步(0, 'ok', 地址.length ? (地址.length + ' 个文件一致') : '单文件，无需校验');
        说(地址.length ? ('文件完整，版本 ' + (主 || '开发版') + ' 一致') : '单文件版，跳过文件校验');
        return { ok: true };
      }

      var 明细 = [];
      if (加载失败.length) 明细.push(加载失败.length + ' 个脚本没加载上');
      if (不一致.length) 明细.push(不一致.length + ' 个版本不一致');
      if (缺失.length) 明细.push(缺失.length + ' 个文件缺失');
      var 文案 = 明细.join('、');

      if (本地能改() && !取(修复标记)) {
        /* 自动替换：强制重取整套文件（服务端本来是新版，重取即替换） */
        存(修复标记, '1');
        步(0, 'run', '正在重新拉取');
        说(文案 + ' → 正在自动替换（玩家的存档/模组/设置都不动）');
        到(38);
        return 睡(520).then(function () {
          var u = location.href.split('#')[0];
          u += (u.indexOf('?') >= 0 ? '&' : '?') + '_f=' + Date.now();
          try { location.replace(u); } catch (e) { }
          return new Promise(function () { });       /* 等页面被换掉 */
        });
      }

      步(0, 'bad', 文案);
      说(文案 + '，已尽力，先继续（不影响已加载的部分）');
      return { ok: false, 文案: 文案 };
    });
  }

  /* ---------- ② 检查更新 ---------- */
  function 比版本(a, b) {
    function 切(v) { var m = /^(\d+)\.(\d+)\.(\d+)(?:-(\w+?)(\d+))?$/.exec(String(v || '')); return m ? [ +m[1], +m[2], +m[3], m[4] || '', +m[5] || 0 ] : [0, 0, 0, '', 0]; }
    var A = 切(a), B = 切(b), i;
    for (i = 0; i < 3; i++) { if (A[i] !== B[i]) return A[i] > B[i] ? 1 : -1; }
    if (A[3] === B[3]) return A[4] === B[4] ? 0 : (A[4] > B[4] ? 1 : -1);
    return 0;
  }
  function 更新() {
    步(1, 'run', '查询中');
    说('正在向发布站查询新版本…');
    到(46);
    if (!本地能改()) { 步(1, 'ok', '本地文件'); 到(62); return Promise.resolve(); }
    var 超 = new Promise(function (r) { setTimeout(function () { r(null); }, 2500); });
    var 查 = fetch('/api/update/check', { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } })
      .catch(function () { return null; });
    return Promise.race([查, 超]).then(function (j) {
      到(62);
      if (!j || !j.ok) { 步(1, 'ok', '已是最新'); 说('网页版/手机版：直接使用服务器上的最新文件'); return; }
      if (j.new && 比版本(j.new, (typeof GAME_VER !== 'undefined' ? GAME_VER : '')) > 0) {
        步(1, 'ok', '发现 ' + j.new);
        说('发现新版本 ' + j.new + '，可在「设置 → 版本」里一键升级');
      } else {
        步(1, 'ok', '已是最新');
        说('已经是最新版本');
      }
    });
  }

  /* ---------- ③ 加载模组与组件 ---------- */
  function 等条件(判, 毫秒) {
    var t0 = Date.now();
    return new Promise(function (r) {
      (function 试() {
        var ok = false;
        try { ok = !!判(); } catch (e) { ok = false; }
        if (ok || Date.now() - t0 > 毫秒) return r(ok);
        setTimeout(试, 60);
      })();
    });
  }
  function 组件() {
    步(2, 'run', '等待模组');
    说('正在加载模组与组件…');
    到(70);
    /* 模组加载器的全局名是 window.ModLoader（js 里那个 ML 只是它的局部别名），
       别按 ML 去找 —— 会永远等不到「已载入」而卡在 70% 满 4.5 秒。 */
    function 加载器() { return window.ModLoader || window.ML || null; }
    return 等条件(function () { var M = 加载器(); return !M || M.已载入 === true; }, 4500).then(function (模组好) {
      到(84);
      /* 触屏操作层要在 DOM 里就位（js/72 在 DOMContentLoaded 后才挂） */
      return 等条件(function () {
        if (typeof isTouch === 'undefined' || !isTouch) return true;
        return !!document.getElementById('mobFire');
      }, 1500).then(function () {
        到(92);
        var 数 = 0;
        try { var M = 加载器(); 数 = (M && M.mods && M.mods.length) || 0; } catch (e) { }
        if (模组好) 步(2, 'ok', 数 ? ('模组 ' + 数 + ' 个') : '无模组');
        else 步(2, 'ok', '已就绪');
        说(模组好 ? ('组件就绪' + (数 ? '，模组 ' + 数 + ' 个' : '')) : '组件就绪（模组加载较慢，已先进入）');
        return 帧();
      });
    });
  }

  /* ---------- 收尾 ---------- */
  function 完成() {
    if (已关) return;
    已关 = 1;
    var 代 = ++代数;
    到(100);
    说(有错 ? '启动完成（有项目标红，已在设置里可复查）' : '启动完成，正在进入');
    setTimeout(function () {
      if (代 !== 代数) return;                 /* 中途点了退出 → 这次收尾作废 */
      屏.classList.add('off');
      setTimeout(function () {
        if (代 !== 代数) return;
        try { 屏.style.display = 'none'; } catch (e) { }
        try { document.body.classList.remove('boot-on'); } catch (e) { }   /* 露出名字面板/主菜单 */
        /* 菜单要能直接吃键盘：body 有 tabindex=0，但焦点此刻可能还在地址栏 */
        try { document.body.focus(); } catch (e) { }
      }, 220);
      try { window.__载入完成 = 1; } catch (e) { }
      try { window.dispatchEvent(new CustomEvent('gunGame:loaded')); } catch (e) { }
    }, 260);
  }

  /* 退出 / 重开 / 死亡后重来：**先亮屏，再刷新**。
     顺序很重要：两次 rAF 保证"这一帧真的画出来了"，再 reload；
     直接 reload 的话浏览器可能还没提交绘制就换了文档，用户看到的还是旧画面黑一下。 */
  function 重载(t) {
    try {
      已关 = 0;
      代数++;                                  /* 作废掉 完成() 里还没到点的隐藏定时器 */
      屏.classList.remove('off');
      屏.style.display = 'flex';
      if (版本标) 版本标.textContent = '正在重新启动';
      步(0, 'run', '收尾'); 步(1, '', '等待'); 步(2, '', '等待');
      当前 = 0; 到(6);
      说(t || '正在重新载入…');
      if (修复键) 修复键.classList.remove('on');
    } catch (e) { }
    /* 只有探针会带 ?bootdry=1：走完「亮屏」就停，用来验证退出时屏是真的先出现。 */
    if (/[?&]bootdry=1/.test(location.search) || window.__载入演练) {
      window.__演练完成 = 1;
      return;
    }
    var 已走 = 0;
    function 走() { if (已走) return; 已走 = 1; try { location.reload(); } catch (e) { } }
    帧().then(function () { setTimeout(走, 40); });
    /* 兜底：标签页在后台时 rAF 不触发，别让「退出」变成什么都不发生 */
    setTimeout(走, 420);
  }

  function 失败(msg) {
    说(msg || '启动失败');
    到(100);
    步(0, 'ok', ''); 步(1, '', '跳过'); 步(2, 'bad', '失败');
    if (修复键) 修复键.classList.add('on');
  }

  if (修复键) 修复键.onclick = function () {
    存(修复标记, null);
    重载('正在重新拉取…');
  };

  window.载入屏 = {
    显示: 重载, 重载: 重载, 完成: 完成, 失败: 失败, 说: 说, 到: 到, 步: 步,
    在: function () { return !已关; }
  };

  /* ---------- 开跑 ---------- */
  var 兜底 = setTimeout(function () { 完成(); }, 15000);   /* 任何一步卡死都别把人关在屏里 */

  校验().then(更新).then(组件).then(function () {
    clearTimeout(兜底);
    完成();
  }).catch(function (e) {
    clearTimeout(兜底);
    try { console.warn('[载入] 出错：', e && e.message); } catch (_e) { }
    失败('启动流程出错：' + ((e && e.message) || '未知'));
    setTimeout(完成, 700);
  });
})();
