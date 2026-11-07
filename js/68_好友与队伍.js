/* 【batch271】好友 / 服务器在线列表 / 队伍（js/68_好友与队伍.js）================================
   用户口径：
     · 「好友」按钮放在地图按钮旁边；
     · 连上服务器后再多两个按钮：「服务器在线列表」「队伍」，都在好友旁边；
     · 在线列表显示同服务器内的玩家，可以加好友；
     · 好友页里可以邀请好友组队；队伍面板看成员、离开。
   实现：
     · 服务端：好友按名字存 好友库.dat（friendList/friendAdd/friendDel/friendReqList/friendAnswer）、
       全服在线推送（online，随 pushRooms 刷新）、队伍（partyInvite/partyAnswer/partyLeave/partyKick，
       队长换图时队员收 partyGo 跟着换）。
     · 本分片只管 UI + 报文：面板三页、事件委托、邀请弹窗、跟随换图。
   ⚠️ 面板打开时不锁鼠标：这是菜单态（S.paused 时为真），关掉面板后玩家自己点「继续」。
   ⚠️ 【batch272】好友改成**双向**：我加你 → 你收到申请，同意了才互为好友（和大多数游戏一致）。
      · 待处理申请在「好友」页顶部金色区块，可直接同意/拒绝；按钮上挂数字提醒。
      · 在线列表按钮四态：移除好友 / 同意申请 / 已申请（灰） / 加好友。
      · 对方先加过我时再点「加好友」＝直接互为好友，不必再走一轮。
      · 申请落盘在 好友库.dat 的 req 字段，保留 7 天，离线期间发的上线也能看到。 */

var 社交_在线 = [];          /* 服务端在线列表 [{n,图,大厅,友,申,求}] */
var 社交_好友 = [];          /* [{n,在,大厅,图}] */
var 社交_申请 = [];          /* 【batch272】待处理的好友申请 [{n,t}] —— 别人申请加我 */
var 社交_已申 = {};          /* 【batch272】我申请过谁 { 名字:1 }，按钮显示「已申请」 */
var 社交_队伍 = null;        /* {id, lead, m, l:[{n,lead,在,大厅}]} */
var 社交_页 = 'friend';
var 社交_邀请 = null;        /* {from} —— 正在弹的组队邀请 */
var 社交_面板 = null;

function 社交_连接了吗() {
  try { return !!(typeof NET !== 'undefined' && NET && NET.connected); } catch (e) { return false; }
}
function 社交_发(obj) {
  try { if (typeof netSend === 'function' && 社交_连接了吗()) { netSend(obj); return true; } } catch (e) { }
  return false;
}
function 社交_提示(t, 色) {
  try { if (typeof showMsg === 'function') showMsg(t, 色 || '#9bd4ff'); } catch (e) { }
}

/* ==================== 一、面板骨架 ==================== */
function 社交_建面板() {
  if (社交_面板) return 社交_面板;
  var d = document.getElementById('socialPanel');
  if (!d) return null;
  社交_面板 = d;
  var close = document.getElementById('socialClose');
  if (close) close.addEventListener('click', 社交_关闭);
  d.addEventListener('click', function (ev) {
    if (ev.target === d) 社交_关闭();          /* 点遮罩关闭 */
  });
  var tabs = d.querySelectorAll('.socialTab');
  for (var i = 0; i < tabs.length; i++) {
    (function (t) {
      t.addEventListener('click', function () { 社交_切页(t.dataset.s); });
    })(tabs[i]);
  }
  /* 【batch277】内容区点击/输入框回车统一走 document 委托（见启动接线），
     不再在 #socialBody 上单独绑 —— 否则顶部标签页和弹层各绑一份会双触发。 */
  return d;
}
function 社交_打开(页) {
  var d = 社交_建面板();
  if (!d) return;
  if (!社交_连接了吗()) {
    社交_提示('先连上服务器才能用好友 / 在线列表 / 队伍', '#ffb347');
    return;
  }
  d.classList.add('on');
  社交_切页(页 || 社交_页);
  社交_发({ t: 'online' });
  社交_发({ t: 'friendList' });
  社交_发({ t: 'friendReqList' });          /* 【batch272】顺带取一次待处理申请 */
}
function 社交_关闭() {
  var d = 社交_建面板();
  if (d) d.classList.remove('on');
}
function 社交_切页(页) {
  社交_页 = 页 || 'friend';
  var tabs = document.querySelectorAll('#socialPanel .socialTab');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].dataset.s === 社交_页) tabs[i].classList.add('active');
    else tabs[i].classList.remove('active');
  }
  社交_渲染();
}
/* 【batch277】渲染目标：旧弹层开着就优先弹层；否则顶部社交标签页激活时渲染进面板容器 */
function 社交_当前Body() {
  var sp = document.getElementById('socialPanel');
  if (sp && sp.classList.contains('on')) return document.getElementById('socialBody');
  var tab = document.querySelector('.tab.active[data-tab^="soc"]');
  if (tab) {
    var pane = document.getElementById('tab-' + tab.dataset.tab);
    var b = pane ? pane.querySelector('.socialBody') : null;
    if (b) return b;
  }
  return document.getElementById('socialBody');
}
function 社交_渲染() {
  var body = 社交_当前Body();
  if (!body) return;
  /* 未连服务器：面板里给引导提示（不再让人以为功能没做），弹层照样打开不了（入口处守卫） */
  if (!社交_连接了吗()) {
    body.innerHTML = '<div class="socEmpty">还没有连接服务器。<br>点「🌐 多人游戏（局域网联机）」连上服务器后，<br>这里就会显示好友、同服玩家和你的队伍。<br>' +
      '<span style="color:#6f86a6">好友 / 在线列表 / 队伍都需要连着服务器才能用。</span></div>';
    return;
  }
  if (社交_页 === 'friend') body.innerHTML = 社交_HTML好友();
  else if (社交_页 === 'online') body.innerHTML = 社交_HTML在线();
  else body.innerHTML = 社交_HTML队伍();
}
/* 【batch277】顶部标签页切到社交页（setTab 钩子调）：映射页名 → 渲染 + 拉一次数据 */
var 社交_TAB映射 = { socfriend: 'friend', soconline: 'online', socparty: 'party' };
function 社交_顶部页(name) {
  var 页 = 社交_TAB映射[name];
  if (!页) return;
  社交_页 = 页;
  社交_渲染();
  if (社交_连接了吗()) {
    社交_发({ t: 'online' });
    社交_发({ t: 'friendList' });
    社交_发({ t: 'friendReqList' });
  }
}
function 社交_转义(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}
function 社交_状态文(x) {
  if (!x.在) return '离线';
  if (x.大厅) return '在线 · 大厅';
  return '在线 · ' + (x.图 || '对局中');
}

/* ==================== 二、三页 HTML ==================== */
function 社交_HTML好友() {
  var h = '<div class="socInputRow"><input class="socAddInput" maxlength="8" placeholder="输入玩家名字，加为好友">' +
    '<button class="socBtn" data-act="add">加好友</button></div>';
  /* 【batch272】待处理申请：别人申请加我，这里直接同意/拒绝 */
  if (社交_申请.length) {
    h += '<div class="socReqBox"><div class="socReqHead">好友申请 · ' + 社交_申请.length + ' 条</div>';
    for (var k = 0; k < 社交_申请.length; k++) {
      var r = 社交_申请[k];
      h += '<div class="socRow">' +
        '<span class="socDot on"></span>' +
        '<div class="socName">' + 社交_转义(r.n) + '<div class="socSub">请求加你为好友</div></div>' +
        '<button class="socBtn" data-act="reqok" data-n="' + 社交_转义(r.n) + '">同意</button>' +
        '<button class="socBtn ghost" data-act="reqno" data-n="' + 社交_转义(r.n) + '">拒绝</button>' +
        '</div>';
    }
    h += '</div>';
  }
  if (!社交_好友.length) {
    h += '<div class="socEmpty">还没有好友。<br>去「服务器在线」页，把同服的人加进来。<br>' +
      '<span style="color:#6f86a6">加好友要对方同意后才会出现在这里。</span></div>';
    return h;
  }
  for (var i = 0; i < 社交_好友.length; i++) {
    var f = 社交_好友[i];
    var 在队 = !!(社交_队伍 && 社交_队伍.l && 社交_队伍.l.some(function (x) { return x.n === f.n; }));
    h += '<div class="socRow">' +
      '<span class="socDot' + (f.在 ? ' on' : '') + '"></span>' +
      '<div class="socName">' + 社交_转义(f.n) + '<div class="socSub">' + 社交_状态文(f) + '</div></div>' +
      '<button class="socBtn" data-act="invite" data-n="' + 社交_转义(f.n) + '"' + (f.在 && !在队 ? '' : ' disabled') + '>' +
      (在队 ? '已在队伍' : (f.在 ? '邀请组队' : '不在线')) + '</button>' +
      '<button class="socBtn ghost" data-act="del" data-n="' + 社交_转义(f.n) + '">删除</button>' +
      '</div>';
  }
  return h;
}
function 社交_HTML在线() {
  if (!社交_在线.length) return '<div class="socEmpty">服务器里现在只有你一个人。</div>';
  var h = '';
  for (var i = 0; i < 社交_在线.length; i++) {
    var p = 社交_在线[i];
    var 在队 = !!(社交_队伍 && 社交_队伍.l && 社交_队伍.l.some(function (x) { return x.n === p.n; }));
    /* 【batch272】加好友按钮四种状态：已是好友 / 他申请了我（同意）/ 我已申请（灰） / 可申请 */
    var 按钮;
    if (p.友) 按钮 = '<button class="socBtn ghost" data-act="del" data-n="' + 社交_转义(p.n) + '">移除好友</button>';
    else if (p.求) 按钮 = '<button class="socBtn" data-act="reqok" data-n="' + 社交_转义(p.n) + '">同意申请</button>';
    else if (p.申 || 社交_已申[p.n]) 按钮 = '<button class="socBtn ghost" data-act="none" disabled>已申请</button>';
    else 按钮 = '<button class="socBtn" data-act="addname" data-n="' + 社交_转义(p.n) + '">加好友</button>';
    h += '<div class="socRow">' +
      '<span class="socDot' + (p.大厅 ? '' : ' on') + '"></span>' +
      '<div class="socName">' + 社交_转义(p.n) + (p.友 ? ' <span class="socSub">★ 好友</span>' : '') +
      '<div class="socSub">' + (p.大厅 ? '在线 · 大厅' : ('在线 · ' + (p.图 || '对局中'))) + '</div></div>' +
      按钮 +
      '<button class="socBtn" data-act="invite" data-n="' + 社交_转义(p.n) + '"' + (在队 ? ' disabled' : '') + '>' +
      (在队 ? '已在队伍' : '邀请组队') + '</button>' +
      '</div>';
  }
  return h;
}
function 社交_HTML队伍() {
  if (!社交_队伍 || !社交_队伍.l || !社交_队伍.l.length) {
    return '<div class="socEmpty">你还没有队伍。<br>去「好友」或「服务器在线」页，点「邀请组队」。<br>' +
      '<span style="color:#6f86a6">队长换地图时，队员会自动跟着进同一张图。</span></div>';
  }
  var h = '<div class="socEmpty" style="padding:4px 0 8px;text-align:left">队伍成员：' + 社交_队伍.l.length + ' 人' +
    (社交_队伍.m ? ' · 队长所在「' + 社交_转义(社交_队伍.m) + '」' : '') + '</div>';
  for (var i = 0; i < 社交_队伍.l.length; i++) {
    var x = 社交_队伍.l[i];
    var 我是队长 = 社交_队伍.lead === (typeof S !== 'undefined' && S ? S.playerName : '');
    h += '<div class="socRow">' +
      '<span class="socDot' + (x.在 ? ' on' : '') + '"></span>' +
      '<div class="socName">' + 社交_转义(x.n) + (x.lead ? ' <span class="socSub">👑 队长</span>' : '') +
      '<div class="socSub">' + (x.在 ? (x.大厅 ? '在线 · 大厅' : '在线 · 对局中') : '离线') + '</div></div>' +
      (我是队长 && !x.lead ? '<button class="socBtn ghost" data-act="kick" data-n="' + 社交_转义(x.n) + '">移出</button>' : '') +
      '</div>';
  }
  var 我队长 = 社交_队伍.lead === (typeof S !== 'undefined' && S ? S.playerName : '');
  h += '<div class="socInputRow" style="margin-top:10px">' +
    '<button class="socBtn ghost" data-act="leave">' + (我队长 ? '解散队伍' : '离开队伍') + '</button></div>';
  return h;
}

/* ==================== 三、按钮事件 ==================== */
function 社交_点按钮(ev) {
  var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
  if (!b) return;
  var act = b.dataset.act, n = b.dataset.n || '';
  if (act === 'add') {
    /* 【batch277】输入框不再用 id（顶部标签页和弹层可能同时各有一份），从同一容器里找 */
    var box = b.closest('.socialBody');
    var inp = box ? box.querySelector('.socAddInput') : document.querySelector('.socAddInput');
    社交_加好友(inp ? inp.value : '');
  }
  else if (act === 'addname') 社交_加好友(n);
  else if (act === 'reqok') { 社交_发({ t: 'friendAnswer', n: n, ok: 1 }); 社交_提示('已同意 ' + n + ' 的好友申请', '#7ee0a8'); }
  else if (act === 'reqno') { 社交_发({ t: 'friendAnswer', n: n, ok: 0 }); 社交_提示('已拒绝 ' + n + ' 的好友申请', '#c8d8e8'); }
  else if (act === 'del') {
    社交_发({ t: 'friendDel', n: n });
    delete 社交_已申[n];
    社交_提示('已移除好友：' + n, '#c8d8e8');
  }
  else if (act === 'invite') { 社交_发({ t: 'partyInvite', n: n }); }
  else if (act === 'leave') { 社交_发({ t: 'partyLeave', disband: 1 }); }
  else if (act === 'kick') { 社交_发({ t: 'partyKick', n: n }); }
}
function 社交_加好友(n) {
  n = String(n == null ? '' : n).trim().slice(0, 8);
  if (!n) { 社交_提示('先输入玩家名字', '#ffb347'); return; }
  if (typeof S !== 'undefined' && S && n === S.playerName) { 社交_提示('不能加自己', '#ffb347'); return; }
  社交_发({ t: 'friendAdd', n: n });
}

/* ==================== 四、邀请弹窗 ==================== */
function 社交_弹邀请(from) {
  社交_邀请 = { from: from };
  var d = document.getElementById('partyInvite');
  if (!d) return;
  var t = d.querySelector('.piT'), b = d.querySelector('.piB');
  if (t) t.textContent = '🛡 ' + from + ' 邀请你组队';
  if (b) {
    b.innerHTML = '<button class="socBtn" data-ans="1">接受</button>' +
      '<button class="socBtn ghost" data-ans="0">拒绝</button>';
  }
  d.classList.add('on');
}
function 社交_关邀请() {
  var d = document.getElementById('partyInvite');
  if (d) d.classList.remove('on');
  社交_邀请 = null;
}
function 社交_答邀请(ok) {
  var inv = 社交_邀请;
  社交_关邀请();
  if (!inv) return;
  社交_发({ t: 'partyAnswer', n: inv.from, ok: ok ? 1 : 0 });
  if (ok) 社交_提示('已加入 ' + inv.from + ' 的队伍', '#7ee0a8');
}

/* ==================== 五、跟随队长换图 ==================== */
function 社交_跟随换图(m) {
  try {
    var mid = m.m;
    /* 【batch278】人还在大厅 / 主界面（没进对局）：先按联机路径把对局开起来
       （enterGame 发 ready + netStart 起同步），否则只切了地图数据、界面还停在菜单
       —— 队长进图队员"没跟着进"的实测根因之一。 */
    var 已在局 = false;
    try { 已在局 = !!(S.playing && !S.over && typeof NET !== 'undefined' && NET && !NET.lobby); } catch (e) { }
    if (!已在局 && typeof netEnterGame === 'function') { try { netEnterGame(); } catch (e) { } }
    if (typeof mapById === 'function' && mapById(mid)) {
      curMapId = mid;
      if (typeof setMap === 'function') setMap(mid, true);
    }
    if (typeof m.x === 'number') {
      camera.position.set(m.x, (typeof m.y === 'number' ? m.y : 2), m.z);
    }
    try { S.velY = 0; S.onLadder = false; S.mantle = 0; S.landKick = 0; } catch (e) { }
    if (typeof m.hp === 'number') { S.hp = m.hp; try { updateHp(); } catch (e) { } }
    try { if (typeof netClearPlayers === 'function') netClearPlayers(); } catch (e) { }
    var ps = m.ps || [];
    for (var i = 0; i < ps.length; i++) { try { netEnsurePlayer(ps[i]); } catch (e) { } }
    社交_提示('🛡 跟着队长 ' + (m.from || '') + ' 进入了新地图', '#9bd4ff');
  } catch (e) { }
}

/* ==================== 六、服务端报文 ==================== */
function 社交_onMsg(m) {
  if (!m || !m.t) return false;
  if (m.t === 'online') {
    社交_在线 = m.l || [];
    if (社交_页 === 'online') 社交_渲染();
    return true;
  }
  if (m.t === 'friendList') {
    社交_好友 = m.l || [];
    /* 成为好友后清掉「已申请」标记，按钮才能回到正常状态 */
    for (var fi = 0; fi < 社交_好友.length; fi++) delete 社交_已申[社交_好友[fi].n];
    if (社交_页 === 'friend' || 社交_页 === 'online') 社交_渲染();
    return true;
  }
  if (m.t === 'friendMsg') {
    if (m.msg) 社交_提示(m.msg, m.ok === 0 ? '#ff8a8a' : '#9bd4ff');
    return true;
  }
  if (m.t === 'friendNew') {
    社交_提示('👥 ' + (m.from || '某人') + ' 把你加为好友了', '#ffd166');
    return true;
  }
  if (m.t === 'friendReqList') {                  /* 【batch272】待处理申请 */
    社交_申请 = m.l || [];
    if (社交_页 === 'friend') 社交_渲染();
    社交_刷新申请标();
    return true;
  }
  if (m.t === 'friendReqSent') {                  /* 【batch272】我发出的申请：按钮置灰 */
    if (m.n) 社交_已申[m.n] = 1;
    if (社交_页 === 'online') 社交_渲染();
    return true;
  }
  if (m.t === 'friendReqNew') {                   /* 【batch272】实时提示：有人申请加我 */
    社交_提示('👥 ' + (m.from || '某人') + ' 申请加你为好友，去「好友」页同意', '#ffd166');
    return true;
  }
  if (m.t === 'partyInvite') {
    社交_弹邀请(m.from || '某人');
    return true;
  }
  if (m.t === 'partyState') {
    if (m.gone || !m.l || !m.l.length) {
      社交_队伍 = null;
      if (社交_页 === 'party' || 社交_页 === 'friend') 社交_渲染();
      社交_刷新队标();
    } else {
      社交_队伍 = m;
      if (社交_页 === 'party' || 社交_页 === 'friend') 社交_渲染();
      社交_刷新队标();
    }
    return true;
  }
  if (m.t === 'partyGo') { 社交_跟随换图(m); return true; }
  return false;
}

/* 菜单里「队伍」按钮上显示人数（3 人以上很直观） */
function 社交_刷新队标() {
  var n = (社交_队伍 && 社交_队伍.l) ? 社交_队伍.l.length : 0;
  ['sidePartyBtn', 'sidePartyBtn2'].forEach(function (id) {
    var b = document.getElementById(id);
    if (!b) return;
    b.textContent = n > 1 ? ('🛡 队伍 · ' + n) : '🛡 队伍';
  });
}
/* 【batch272】「好友」按钮上挂待处理申请数（别让人错过申请） */
function 社交_刷新申请标() {
  var n = 社交_申请.length;
  ['sideFriendBtn', 'sideFriendBtn2'].forEach(function (id) {
    var b = document.getElementById(id);
    if (!b) return;
    b.textContent = n > 0 ? ('👥 好友 · ' + n) : '👥 好友';
    b.style.color = n > 0 ? '#ffd166' : '';
  });
}

/* ==================== 七、启动接线 ==================== */
(function () {
  function 绑(id, fn) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', fn);
  }
  /* 两套入口（三栏用左栏快捷入口，两栏用主按钮区那一行）绑到同一个打开逻辑 */
  绑('sideFriendBtn', function () { 社交_打开('friend'); });
  绑('sideOnlineBtn', function () { 社交_打开('online'); });
  绑('sidePartyBtn', function () { 社交_打开('party'); });
  绑('sideFriendBtn2', function () { 社交_打开('friend'); });
  绑('sideOnlineBtn2', function () { 社交_打开('online'); });
  绑('sidePartyBtn2', function () { 社交_打开('party'); });
  /* 邀请弹窗的两个按钮 */
  var d = document.getElementById('partyInvite');
  if (d) d.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-ans]') : null;
    if (b) 社交_答邀请(b.dataset.ans === '1');
  });
  /* 【batch277】内容按钮 / 加好友输入框回车：document 级委托，
     弹层（#socialBody）和顶部标签页（#tabSocFriend 等三处容器）一套逻辑通吃。
     只认 .socialBody 容器里的 [data-act]，不会误伤别的系统。 */
  document.addEventListener('click', function (ev) {
    if (ev.target && ev.target.closest) {
      var b = ev.target.closest('.socialBody [data-act]');
      if (b) { 社交_点按钮(ev); return; }
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || !ev.target || !ev.target.classList) return;
    if (ev.target.classList.contains('socAddInput')) {
      ev.preventDefault();
      社交_加好友(ev.target.value);
    }
  });
  /* 连接状态：未连服务器时藏起「在线列表 / 队伍」（好友按钮常显，点了会提示先连服务器） */
  var 上次连 = 社交_连接了吗();
  setInterval(function () {
    var on = 社交_连接了吗();
    ['sideOnlineBtn', 'sidePartyBtn', 'sideOnlineBtn2', 'sidePartyBtn2'].forEach(function (id) {
      var b = document.getElementById(id);
      if (!b) return;
      b.style.display = on ? '' : 'none';
    });
    /* 刚断线才清旧申请标记（不能每 800ms 无条件清，否则单机/探针里注入的内容会被抹掉） */
    if (上次连 && !on) { 社交_申请 = []; 社交_刷新申请标(); }
    上次连 = on;
  }, 800);
  setTimeout(社交_刷新申请标, 1200);
})();

/* ==================== 八、对外接口（探针用） ==================== */
window.社交 = {
  打开: 社交_打开, 关闭: 社交_关闭, 切页: 社交_切页,
  在线: function () { return 社交_在线; },
  好友: function () { return 社交_好友; },
  申请: function () { return 社交_申请; },          /* 【batch272】待处理申请 */
  已申: function () { return 社交_已申; },
  队伍: function () { return 社交_队伍; },
  加好友: 社交_加好友,
  答邀请: 社交_答邀请,
  当前页: function () { return 社交_页; },
  渲染: 社交_渲染
};
