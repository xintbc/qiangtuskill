// ==================== 多人联机（局域网对战）====================
// 从服务端页面打开（http/https）→ 自动联机；双击本地文件仍是单人。
// 想在服务端页面里玩单人：地址后加 ?solo=1
var NET_NAME_KEY='gunGame.netName.v1';
var NET_COLORS=[0x3399ff,0xffaa00,0x33dd88,0xff66cc,0xaa66ff,0x00cccc,0xff8844,0x99cc33];
var NET={ws:null,id:0,connected:false,dead:false,players:{},list:[],sendAcc:0,reconnecting:false,name:'',_t:0,_boardT:0,enabled:null,server:'',raw:'',secure:false,ping:0,
         retry:0,reconn:0,lastRecv:0,closeCode:0};   // retry＝连续重连次数；lastRecv＝最后收到服务器消息的时刻
var NET_ANIM={IDLE:0,WALK:1,RUN:2,LADDER:4,AIM:5,AIR:6,CROUCH:7};   // 3 原是 PRONE（趴下），已整个删除；值保留空位不重排，避免新旧客户端互看时姿态错位
var NET_INTERP_DELAY=110;   // 【batch162】远端渲染延迟（ms）：快照插值的固定回看量，高延迟链路自适应加大
function netIsMulti(){
  try{
    if(typeof NET!=='undefined'&&NET&&NET.enabled!==null)return !!NET.enabled;
    if(typeof location==='undefined'||!location||!location.protocol)return false;
    return (location.protocol==='http:'||location.protocol==='https:')&&!/[?&]solo=1/.test(location.search||'')&&!(typeof rangeMode==='function'&&rangeMode())   /* 【batch180】靶场：强制单人，绝不自动联机 */;
  }catch(e){return false;}
}
function netIsDead(){return !!NET.dead;}
/* 【batch169】友伤判定：本机当前队伍（爆能器模式才分队伍；原版无队伍 → -1）。
   netIsFriendly(e) ＝ 远端玩家与我是同一队 → 枪/刀不打（也不会发命中包给服务器）。 */
function netMyTeam(){try{if(typeof SPIKE!=='undefined'&&SPIKE.on&&typeof SPIKE.team==='number'&&SPIKE.team>=0)return SPIKE.team;}catch(e){}return -1;}
function netIsFriendly(e){return !!(e&&e.isNet&&(typeof e.team==='number'&&e.team>=0)&&e.team===netMyTeam());}
// 【重要】身份 cid 与默认名字必须「按标签页」隔离（sessionStorage），绝不能用 localStorage。
// 同一个浏览器里同时开「电脑版」和「手机版」两个页面时，localStorage 是共享的
// → 两个页面拿到同一个 cid、同一个名字 → 服务端按 cid 判定为"同一人重连"，
//   把先连上的那个踢掉；被踢的页面 2 秒后自动重连又把另一个踢掉……
//   结果两边无限互踢、不停重连，还都是同一个名字。
var _netTabMem={};
function netTabStore(key,gen){
  try{
    var v=sessionStorage.getItem(key);
    if(v)return v;
    v=gen();
    try{sessionStorage.setItem(key,v);}catch(e){_netTabMem[key]=v;}
    return v;
  }catch(e){
    if(!_netTabMem[key])_netTabMem[key]=gen();
    return _netTabMem[key];
  }
}
function netMyName(){
  // 玩家自己在「取名菜单」里取的名字（单机/多人共用，存 localStorage）
  if(typeof S!=='undefined'&&S&&S.playerName)return S.playerName;
  var m=/[?&]name=([^&]+)/.exec((typeof location!=='undefined'&&location.search)||'');
  if(m){try{return decodeURIComponent(m[1]).slice(0,8);}catch(e){}}
  // 默认名字带端标记（电脑/手机），且每个标签页各生成一个 → 两个页面不会重名
  return netTabStore(NET_NAME_KEY,function(){return (isTouch?'手机':'电脑')+(100+Math.floor(Math.random()*900));});
}
function netSend(o){try{if(NET.ws&&NET.ws.readyState===1)NET.ws.send(JSON.stringify(o));}catch(e){}}
var NET_CID_KEY='gunGame.clientId.v1';
/* 【batch221】客户端身份 cid **必须存 localStorage**，不能用 netTabStore（sessionStorage）。
   原因：sessionStorage 每个标签页独立 —— 玩家关掉页面再打开就是"新客户端"，
   服务端据此认定"这个名字不是你的" → 弹"请在身份码框里填上你的身份码"；
   而新玩家根本没有身份码 → 永远注册不进去。用户报的"新玩家无法完成注册"就是这个。
   改用 localStorage 之后：同一浏览器＝同一身份，关标签页、重开、刷新都还认得自己。
   ⚠️ 副作用：同一浏览器开两个标签页会共用 cid，后进的那个会把先进的服务端连接顶掉
      （joinPlayer 的"接管"逻辑）。本机双开测试请用**隐身窗口**（隐身窗口有独立 localStorage）。
   ⚠️ 隐私模式下 localStorage 会抛错 → 再兜一层 window.name（同标签页刷新能保住身份）。 */
function netClientId(){
  var v='';
  try{ v=localStorage.getItem(NET_CID_KEY)||''; }catch(e){}
  if(v)return v;
  try{
    var w=String((window&&window.name)||'');
    if(/^gunGameCid:c[a-z0-9]{6,}$/i.test(w))return w.slice(11);
  }catch(e){}
  v='c'+Math.random().toString(36).slice(2,10)+Date.now().toString(36);
  try{ localStorage.setItem(NET_CID_KEY,v); }catch(e){}
  try{ window.name='gunGameCid:'+v; }catch(e){}
  return v;
}
function netKeepAlive(on){
  if(NET.ka){clearInterval(NET.ka);NET.ka=null;}
  if(!on)return;
  NET.lastRecv=Date.now();
  // 每 2 秒发一次心跳：暂停/在菜单里时也会发，避免被服务端误判掉线
  NET.ka=setInterval(function(){
    if(!NET.connected)return;
    netSend({t:'ping',ts:Date.now()});                     // 心跳兼测延迟
    // 【半死连接自检】TCP 看着还连着，但隧道网关/NAT 把连接表悄悄丢了之后，
    // 浏览器会迟迟不报 onclose —— 玩家就卡在"显示已联机、其实早就没数据"。
    // 服务端 30Hz 广播 + 每 2 秒回 pong，正常绝不可能 9 秒一个包都收不到。
    if(NET.lastRecv&&Date.now()-NET.lastRecv>9000)netForceReconnect('连接已失效，正在重连…');
  },2000);
}
/* 退避重连的等待时间：越连不上等得越久（带抖动，防一堆人同时敲服务器）。
   为什么不能一直是 2 秒：被限流/服务器满时，猛敲会不断累加"新建连接"计数，
   触发 IP 冷却 → 冷却期内每次都被拒 → 永远连不上，就是"老是重连"。 */
function netRetryDelay(n){
  var t=[0,2000,2500,4000,6000,9000][n]||12000;
  return Math.round(t*(0.85+Math.random()*0.3));
}
function netCloseWhy(c){
  if(c===1000)return '正常关闭';
  if(c===1001)return '页面已离开';
  if(c===1006)return '网络中断';
  if(c===1009)return '数据包过大';
  if(c===1011)return '服务端出错';
  if(c===1013)return '服务器繁忙';
  return c?('连接中断 '+c):'连接中断';
}
/* 立刻重连：先把旧连接彻底作废（连 onclose 都摘掉），再重开一条。
   用于「半死连接」「切后台回来」「网络恢复」——这些情况下旧 socket 已经没救了。 */
function netForceReconnect(msg){
  if(!netIsMulti()||NET.replaced)return;
  try{if(NET.ws){NET.ws.onclose=null;NET.ws.onmessage=null;NET.ws.onerror=null;NET.ws.close();}}catch(e){}
  NET.ws=null;NET.connected=false;NET.reconnecting=false;NET.retry=0;
  netKeepAlive(false);
  if(msg)showMsg(msg,'#7fd6ff');
  netConnect();
}
/* 手机切后台 / 电脑锁屏时，浏览器的定时器会被冻结 → 心跳停发 → 服务端判他掉线。
   回到前台立刻重连，体感就是"切回来马上就在"，而不是傻等退避计时器。 */
if(typeof document!=='undefined'&&document.addEventListener){
  document.addEventListener('visibilitychange',function(){
    if(document.hidden)return;
    if(!netIsMulti()||NET.replaced)return;
    if(!NET.connected||(NET.lastRecv&&Date.now()-NET.lastRecv>6000))netForceReconnect('欢迎回来，正在重连…');
  });
}
if(typeof window!=='undefined'&&window.addEventListener){
  window.addEventListener('online',function(){                    // 网络恢复：立刻连，不等退避
    if(netIsMulti()&&!NET.replaced&&!NET.connected){netForceReconnect('网络已恢复，正在重连…');}
  });
  window.addEventListener('offline',function(){                   // 明确告知，避免玩家以为游戏坏了
    if(netIsMulti()&&!NET.replaced)showMsg('网络已断开，等网络恢复后会自动重连','#fc0');
  });
}
function netConnect(){
  if(!netIsMulti()||NET.reconnecting)return;
  if(typeof WebSocket==='undefined')return;
  // 【重要】已经有一条连着的/正在连的 socket 时绝不再开第二条：
  // 同一页面两条 socket 会互相踩——旧的那条被服务端踢掉时 onclose 会清空玩家并触发
  // 2 秒重连，于是两条连接轮流把对方踢掉，变成两边同时无限重连。
  if(NET.replaced)return;
  if(NET.ws&&(NET.ws.readyState===0||NET.ws.readyState===1))return;
  NET.reconnecting=true;
  var _host=NET.server||(typeof location!=='undefined'?location.host:'');
  if(!_host){NET.reconnecting=false;return;}
  var proto=(NET.secure||(typeof location!=='undefined'&&location.protocol==='https:'))?'wss://':'ws://';
  var _ws;try{_ws=new WebSocket(proto+_host+'/ws');}catch(e){NET.reconnecting=false;return;}
  NET.ws=_ws;
  _ws.onopen=function(){
    if(NET.ws!==_ws)return;
    NET.connected=true;NET.reconnecting=false;NET.lastRecv=Date.now();
    if(NET.retry>0)showMsg('已重新连上服务器','#6f6');      // 重连回来：给个明确的好消息
    else showMsg('已进入对战服务器','#6f6');
    NET.retry=0;
    NET.name=netMyName();
    /* 【batch167】join 必须把**地图**也带上：以前没带，服务端一律按 classic 算，
       于是"客户端自己选了别的图、服务端却认为在 classic"——出生点/房间全对不上，
       而且不同地图的人会因为房号相同被塞进同一间房。现在地图进 join、也进房间钥匙。 */
    netSend({t:'join',n:NET.name,cid:netClientId(),code:netMyCode(),clear:(UNLOCK.lightning?1:0),ecl:(UNLOCK.eclipse?1:0),
             mode:(window.NET_MODE||''),room:(window.NET_ROOM||''),map:(typeof curMapId!=='undefined'?curMapId:''),
             /* 【batch229】版本分化：上报客户端版本，服务端校验（major 不同/低于下限 → 拒） */
             v:(typeof GAME_VER!=='undefined'?GAME_VER:''),
             /* 【batch203】mem＝我拥有纪念枪皮（累积登录解锁）。服务端把它带给同房其他人，
                他们的屏幕会升起一条「感谢您这么久的陪伴」—— 只发给别人，自己看不到。 */
             mem:((typeof 纪念拥有==='function'&&纪念拥有())?1:0),
             /* 【batch243】上报本机**真正加载了**的模组（文件名 + @id + 内容指纹）。
                服务端据此判断：带了服务器没有的模组 → 拒绝进入并要求禁用；
                模组代码和服务器那份不一致（同版本下）→ 视为改过模组，也拒绝。 */
             mods:(function(){
               try{
                 if(window.MOD_MGR&&typeof MOD_MGR.连接清单==='function'){
                   var a=MOD_MGR.连接清单();
                   if(a&&a.length!==undefined)return Array.prototype.slice.call(a,0,64);
                 }
               }catch(e){}
               return [];
             })(),
             team:((typeof NET_TEAM==='number'&&NET_TEAM>=0)?NET_TEAM:undefined)});   // 【batch126】通关 / 【batch147】蚀日者解锁；【batch166】mode/room；【batch167】map/team
    /* 【batch225】连上过一次就记住这台服务器：下次打开游戏自动连回去。
       记住的是「玩家填的原文」（NET.raw），过隧道 / 换端口都还能直接用。
       玩家主动点「离线玩单人」时由服务器连接条把这个键清掉。 */
    try{ localStorage.setItem(NET_AUTO_KEY, NET.raw || NET.server || ''); }catch(e){}
    /* 【batch225】跟服务器对个账：服务器上有、本机没有的模组自动下载装好。
       延迟 1.5 秒再跑，别跟 join / 首帧抢带宽（下载只是补齐，不影响这一局）。 */
    setTimeout(function(){
      try{
        if(window.MOD_MGR&&typeof MOD_MGR.同步服务器==='function'&&NET.connected){
          MOD_MGR.同步服务器(NET.server,NET.secure,true);
        }
      }catch(e){}
    },1500);
    netKeepAlive(true);
  };
  _ws.onmessage=function(ev){
    if(NET.ws!==_ws)return;
    NET.lastRecv=Date.now();             // 半死连接自检靠它
    try{netOnMsg(JSON.parse(ev.data));}catch(e){}
  };
  _ws.onclose=function(ev){
    if(NET.ws!==_ws)return;              // 已被替换的旧连接：它的一切事件全部忽略，不再触发重连
    NET.connected=false;netKeepAlive(false);
    NET.closeCode=(ev&&ev.code)||0;
    if(NET.replaced){netClearPlayers();return;}             // 已被服务端明确拒绝（封禁/满员/重名）：不再重连
    if(!netIsMulti()){netClearPlayers();return;}
    NET.retry++;NET.reconn++;
    /* 【batch231】连续 10 次都连不上就停下来 —— 玩家看到的是"一直重连"转圈，
       以为游戏卡死（主人实测反馈）。停下来给一句明确提示，让他点「多人游戏」重试或改地址。 */
    if(NET.retry>10){
      NET.enabled=false;NET.reconnecting=false;NET.connected=false;
      netClearPlayers();
      showMsg('连不上 '+(NET.server||'服务器')+'，已停止自动重连。点「多人游戏」可以再试或换个地址。','#f66');
      return;
    }
    var wait=netRetryDelay(NET.retry);
    NET.lastWait=wait;                                      // 记下这次要等多久（HUD/排查都用得上）
    var why=netCloseWhy(NET.closeCode);
    showMsg('与服务器断开（'+why+'），'+Math.round(wait/1000)+' 秒后重连…'+(NET.retry>4?'（一直连不上？看看服务器那个黑窗口还开着吗）':''),'#f66');
    // 短暂断开先别清玩家：万一 1 秒就重连上了，服务端会重发全量，
    // 画面上就不会出现"所有人凭空消失又出现"的闪烁。
    setTimeout(function(){if(NET.ws!==_ws)return;if(!NET.connected)netClearPlayers();},3000);
    setTimeout(function(){if(NET.ws!==_ws)return;NET.reconnecting=false;netConnect();},wait);
  };
  _ws.onerror=function(){};
}
function netClearPlayers(){for(var k in NET.players)netRemovePlayer(NET.players[k]);NET.players={};}
function netRemovePlayer(e){
  if(!e)return;
  if(e.label&&e.label.material){if(e.label.material.map)e.label.material.map.dispose();e.label.material.dispose();}
  if(scene&&e.root)scene.remove(e.root);
  e._armBack=undefined;                                              // 【batch102】丢掉后坐力基准（模型已移除）
  var i=enemies.indexOf(e);if(i>=0)enemies.splice(i,1);
  delete NET.players[e.netId];
}
function netStart(){
  if(!netIsMulti())return;
  var b=document.getElementById('netBoard');if(b)b.style.display='block';
  var nm=document.getElementById('netMode');if(nm)nm.textContent='🌐 多人对战模式 · 你的名字：'+netMyName()+(_playerCode?(' · 身份码 '+_playerCode):'');
  if(typeof refreshMyIdLine==='function')refreshMyIdLine();
  S.hp=S.maxHp;updateHp();netUpdateBoard([]);
  if(!NET.connected)netConnect();
  showMsg(NET.connected?'已连接服务器':'正在连接服务器…','#7fd6ff');
}
// ==================== 多人模式开关：本地文件也能连服务器 ====================
var NET_SRV_KEY='gunGame.netServer.v1';
/* 【batch225】「上次连过哪台服务器」——连上过一次就写，下次打开自动连回去。
   和 NET_SRV_KEY 的区别：NET_SRV_KEY 只是"输入框里填过的历史"（填了但没连上也存），
   这个键只有**真的连上过**才写；玩家点「离线玩单人」会被清掉。 */
var NET_AUTO_KEY='gunGame.autoConn.v1';
function netSecureOf(v){
  return /^(https|wss):\/\//i.test(String(v==null?'':v).trim());
}
function netNormHost(v,exact){
  var s=String(v==null?'':v).trim();
  var secure=netSecureOf(s);
  var hadProto=/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(s);   // 用户自己写了 http:// / https://
  s=s.replace(/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//,'');
  s=s.replace(/\/.*$/,'');
  if(!s)return '';
  // exact=true 表示"这是当前页面自己的 host"（已经带了非默认端口）→ 原样使用，绝不补 :8765
  if(exact)return s;
  // 只有"裸 IP / 裸主机名"（没写协议、也没写端口）才补局域网默认端口 8765；
  // 写了协议就说明用户在粘贴完整地址（隧道域名走 443、http 走 80），一律尊重
  if(!/:\d+$/.test(s)&&!secure&&!hadProto)s=s+':8765';
  return s;
}
// 当前页面自己的服务器地址（/pc、/mobile 由服务端提供；隧道域名也直接用）
function netHostFromPage(){try{return String(location.host||'');}catch(e){return '';}}
function netAutoMode(){
  try{
    /* 【batch225】客户端壳子把本地目录映射成 https://game.example/ —— 它是 http 源，
       但**没有任何服务器**。不排掉的话，壳子里一打开就去连 game.example/ws，永远连不上。 */
    if(String(location.host||'')==='game.example')return false;
    /* 【batch231】电脑客户端改成内置 http://127.0.0.1:端口 之后，光排 game.example 不够了：
       127.0.0.1:39002 长得像"服务器页面"，于是被当成对战服务器 → 页面去连自己的静态服务
       → ws://127.0.0.1:39002/ws 404 → 无限重连（主人实测："点多人游戏一直重连"）。
       客户端壳子由 __inClient 标记，直接排除。 */
    if(window.__inClient)return false;
    return (location.protocol==='http:'||location.protocol==='https:')&&!/[?&]solo=1/.test(location.search||'')&&!(typeof rangeMode==='function'&&rangeMode())   /* 【batch180】靶场：强制单人，绝不自动联机 */;
  }catch(e){return false;}
}
function netPanelHint(t,cls){
  var h=document.getElementById('netHint');if(!h)return;
  h.textContent=t;h.className='spHint'+(cls?(' '+cls):'');
}
function netOpenPanel(){
  /* 【batch237】优先亮**连接条**（文档流、不挡画面）；没有它才退回老的全屏面板 */
  if(typeof window.netShowBar==='function'){ try{ window.netShowBar(); return; }catch(e){} }
  var p=document.getElementById('netPanel');if(!p)return;
  var a=document.getElementById('netAddr');
  if(a)a.value=NET.raw||NET.server||'';
  netPanelHint(NET.server?('上次用的服务器：'+NET.server+'，直接点下面按钮即可'):'本机测试填 localhost:8765；局域网填 192.168.x.x:8765；远程隧道直接粘贴 https:// 开头的完整地址','');
  p.classList.add('on');
  if(a){try{a.focus();a.select();}catch(e){}}
}
function netClosePanel(){var p=document.getElementById('netPanel');if(p)p.classList.remove('on');}
function netEnterGame(){
  if(S.playing&&!S.paused&&!S.over){if(!NET.connected){NET.reconnecting=false;netConnect();}return;}  // 已在局中：只补连接，不重开
  enterGame();
  /* 【1.7.12】多人建房**沿用玩家在主菜单选的地图**（"多人按地图分房间"，见选图页说明），
     不再强制 classic —— 1.7.11 那句 curMapId='classic' 会把玩家选的图冲掉，
     导致"不管我咋选，进多人都是哨塔"。现在：
       · 玩家选过十日环城 → mapLoad() 读回 → 进十日环城房；
       · 从没选过 → curMapId 默认 classic → 哨塔（"默认哨塔"仍成立）；
       · 靶场是单人专用 → 多人里回落 classic；
       · 加入别人的房，最终仍以服务器 welcome 下发的 m.map 为准（见 welcome 分支 setMap 重建）。
     全程 setMap 传 不存=true，不写回存档，不污染单人选图记忆。 */
  try{ if(typeof mapLoad==='function')mapLoad(); }catch(e){}          // 读回玩家上次选的图（存档）
  var _pickMap=(typeof curMapId!=='undefined'&&curMapId)?curMapId:'classic';
  if(_pickMap==='range')_pickMap='classic';                            // 靶场是单人专用，不进多人
  if(typeof mapById==='function'&&!mapById(_pickMap))_pickMap='classic';
  if(typeof curMapId!=='undefined')curMapId=_pickMap;
  try{ if(typeof setMap==='function')setMap(_pickMap,true); }catch(e){}
  netStart();
  setTimeout(function(){
    if(!NET.connected){showMsg('暂时连不上服务器，正在重试…请检查地址和网络','#f66');}
  },4000);
}
function netPlayMulti(v){
  var raw=String(v==null?'':v).trim();
  var fromPage=(raw!==''&&raw===netHostFromPage());     // 就是当前页面自己的地址（含隧道域名）
  var host=netNormHost(raw,fromPage);
  if(!host){netPanelHint('请先填服务器地址，例如 192.168.1.5:8765','bad');return;}
  /* 【batch237】已经连着同一台服务器 → **不重连**，直接进游戏。
     用户："如果连上了服务器，点多人游戏就直接连去，不需要再一次触发连接"。 */
  if(NET.connected&&NET.server===host){
    try{localStorage.setItem(NET_SRV_KEY,NET.raw||host);}catch(e){}
    netClosePanel();netEnterGame();return;
  }
  NET.server=host;NET.enabled=true;
  NET.secure=fromPage?(typeof location!=='undefined'&&location.protocol==='https:'):netSecureOf(raw);
  NET.raw=raw||host;
  NET.replaced=false;                                   // 手动连接＝用户主动要求，解除"被接管"状态
  // 手动连接可能要换服务器地址：先把旧连接彻底掐掉（先摘掉 onclose，避免它排重连定时器）
  if(NET.ws){try{NET.ws.onclose=null;NET.ws.onmessage=null;NET.ws.close();}catch(e){}NET.ws=null;}
  NET.connected=false;NET.reconnecting=false;
  try{localStorage.setItem(NET_SRV_KEY,NET.raw||host);}catch(e){}
  netClosePanel();
  netEnterGame();
}
(function netModeInit(){
  // 【坑】从服务端页面（/pc、/mobile、隧道域名）打开时，地址就用页面自己的 host。
  // 千万别走 netNormHost()：隧道域名没有端口，会被补成「域名:8765」，而隧道只转发 443
  // → 必然连不上，然后无限重连。局域网 http://192.168.x.x:8765/mobile 的 host 本身就含 8765。
  var 单人=false;
  try{ 单人=/[?&]solo=1/.test(location.search||''); }catch(e){}
  try{var v=localStorage.getItem(NET_SRV_KEY);if(v){NET.raw=v;NET.secure=netSecureOf(v);NET.server=netNormHost(v);}}catch(e){}
  /* 【batch225】自动重连优先于"页面自己的地址"：
     玩家上次真的连上过某台服务器 → 这次打开就直接连它。
     为什么必须放在 netAutoMode 前面：客户端壳子（https://game.example）和静态站都是 http 源，
     按老逻辑会用"页面自己的地址"去连，那是壳子自己的虚拟域名，永远连不上。 */
  var 自动='';
  try{ 自动=localStorage.getItem(NET_AUTO_KEY)||''; }catch(e){}
  if(自动&&!单人){
    /* 【batch238】存的地址如果就是**当前页面自己的 host**（隧道域名 / 反代），
       不能再按"裸主机名"补 :8765 —— 隧道只转 443，补了端口就永远连不上。
       协议也跟着页面走：页面是 https，就是 wss。 */
    var _是页面=(自动===netHostFromPage());
    var host=netNormHost(自动,_是页面);
    if(host){
      NET.raw=自动; NET.server=host;
      NET.secure=_是页面?(location.protocol==='https:'):netSecureOf(自动);
      NET.enabled=true; NET._autoStart=1;          // 标记：一会儿由「服务器连接条」真的发起连接
      return;
    }
  }
  /* 【batch231】电脑客户端：页面跑在客户端内置的 http://127.0.0.1:端口（只是读游戏文件的
     静态服务，**不是对战服务器**）。对战服务器地址来自客户端注入的 gunGame.netServer.v1
     （本机 8765 探测到的，或玩家上次填的）→ 直接自动连它。
     ⚠️ 必须排在 netAutoMode 前面：否则会被当成"服务器页面"，server 被改成 location.host
        （= 内置静态服务自己）→ 连自己 → 404 → 无限重连。 */
  try{
    if(window.__inClient && NET.server && !单人){
      NET.enabled=true; NET._autoStart=1;
      NET.secure=netSecureOf(NET.raw||NET.server);
      return;
    }
  }catch(e){}
  if(netAutoMode()){NET.enabled=true;NET.server=netHostFromPage();NET.secure=(location.protocol==='https:');return;}
})();
/* 【batch237】「多人游戏」按钮的完整逻辑：
   ① 已经连着服务器 → 直接进（netPlayMulti 内部会跳过重连）
   ② 有上次连过的服务器 → 先悄悄探一下（2.5 秒）：通了直接进，不通才弹地址框
   ③ 从来没连过 → 弹地址框 */
function netLastHost(){
  try{
    var a=localStorage.getItem(NET_AUTO_KEY)||'';
    var b=localStorage.getItem(NET_SRV_KEY)||'';
    return String((NET&&NET.raw)||a||b||'');
  }catch(e){ return String((NET&&NET.raw)||''); }
}
function netPingHost(host,cb){
  var h='';try{
    /* 【batch238】和 netPlayMulti 同一套口径：传来的如果就是页面自己的地址，
       不补端口、协议按页面走（隧道 = https → wss） */
    var _是页面=(String(host||'')===netHostFromPage());
    h=netNormHost(host,_是页面);
    var secure=_是页面?(location.protocol==='https:'):netSecureOf(host);
    if(!h){cb(false);return;}
  }catch(e){ h=''; }
  if(!h){cb(false);return;}
  var url=(secure?'wss://':'ws://')+h+'/ws';
  var done=false,ws=null;
  var t=setTimeout(function(){ if(done)return; done=true; try{ws&&ws.close();}catch(e){} cb(false); },2500);
  try{ ws=new WebSocket(url); }catch(e){ clearTimeout(t); cb(false); return; }
  ws.onopen=function(){ if(done)return; done=true; clearTimeout(t); try{ws.close();}catch(e){} cb(true); };
  ws.onerror=function(){ if(done)return; done=true; clearTimeout(t); try{ws.close();}catch(e){} cb(false); };
}
var NET_PROBING=false;          /* 【batch238】探测中：防连点。连着戳会一口气开十几条连接，
                                   撞上服务端「同 IP 10 秒内最多新建 20 条」的闸门 → 真的连不上 */
function netMultiClick(){
  if(typeof NET==='undefined')return;
  if(NET.connected&&NET.server){netPlayMulti(NET.server);return;}
  if(NET_PROBING)return;
  /* 候选顺序：上次连过的服务器 → 页面自己的地址（真的是对战服务器时 netHostFromPage 才给值）
     ⚠️ 不能直接信 netAutoMode：普通静态服务器（客户端内置的读文件服务、python -m http.server）
     也会被判成 true，拿页面地址去连必然失败。所以一律先探一下，通了才真连。 */
  var 候选=[];
  var 上次=netLastHost(); if(上次)候选.push(上次);
  try{ if(netAutoMode()){ var pg=netHostFromPage(); if(pg&&候选.indexOf(pg)<0)候选.push(pg); } }catch(e){}
  if(!候选.length){netOpenPanel();return;}
  var i=0;
  NET_PROBING=true;
  (function 试下一个(){
    if(i>=候选.length){
      NET_PROBING=false;
      netOpenPanel();
      var 话=(上次?('连不上 '+上次+'，确认地址后再点「连接」'):'没找到可用的服务器，先填地址');
      if(typeof window.netBarSay==='function'){ try{ window.netBarSay(话,'bad'); }catch(e){} }
      else netPanelHint(话,'bad');
      var si=document.getElementById('srvInput');if(si&&!si.value&&上次)si.value=上次;
      var a=document.getElementById('netAddr');if(a&&!a.value&&上次)a.value=上次;
      return;
    }
    var h=候选[i++];
    try{ if(typeof showMsg==='function')showMsg('正在连接 '+h+' …','#8fd6ff'); }catch(e){}
    netPingHost(h,function(通){ if(通){ NET_PROBING=false; netPlayMulti(h); } else 试下一个(); });
  })();
}
(function netUIInit(){
  var b=document.getElementById('netBtn');
  if(b)b.addEventListener('click',function(e){
    e.preventDefault();e.stopPropagation();
    netMultiClick();   /* 【batch237】已连／有上次的服务器 → 直接进；连不上才弹地址框 */
  });
  var g=document.getElementById('netGo');
  if(g)g.addEventListener('click',function(e){
    e.preventDefault();e.stopPropagation();
    /* 【batch166】连接前先取「玩法模式 + 自建房号」。
       关键：从服务端页面打开时会**自动联机**（那时还没选模式，join 已按原版发出），
       而服务端会忽略重复的 join —— 所以这里必须断开重连，新模式才会真正生效。 */
    var sel=document.querySelector('#modePick .modeOpt.sel');
    NET_MODE=sel?(sel.getAttribute('data-mode')||''):'';
    var rmEl=document.getElementById('netRoom');NET_ROOM=rmEl?rmEl.value:'';
    if(NET&&NET.ws){
      try{NET.ws.onclose=null;}catch(e2){}
      try{NET.ws.close();}catch(e2){}
      NET.ws=null;NET.connected=false;NET.reconnecting=false;
    }
    var a=document.getElementById('netAddr');netPlayMulti(a?a.value:'');
  });
  var c=document.getElementById('netCancel');
  if(c)c.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();netClosePanel();});
  var a=document.getElementById('netAddr');
  if(a)a.addEventListener('keydown',function(e){
    e.stopPropagation();   // 别让 W/A/S/D/R 这些字母触发游戏按键
    if(e.key==='Enter'){e.preventDefault();var x=document.getElementById('netGo');if(x)x.click();}
  });
  var p=document.getElementById('netPanel');
  if(p)p.addEventListener('click',function(e){if(e.target===p)netClosePanel();});
})();
/* ==================== 【batch167】爆能器（瓦罗兰特版）====================
   瓦罗兰特版是**一份完全独立的页面**（spike.html）＋**它自己的玩法核心**
   （mode/瓦罗兰特核心.js）。原版主体里**不再保留任何瓦罗兰特界面 / 玩法代码** ——
   这里只留一根极细的钩子：收到爆能器报文就转交给它。
   原版 index.html 不加载那个文件 → window.VLUI 不存在 → 这里什么都不做，原版零影响。 */
/* 【batch180】从"布尔白名单"升级成**真实配置对象**（与服务端 SPIKE_MAP_CFG 同值，改一边记得同步另一边）：
   sites=下包点 A/B，spike=爆能器出生点（开局掉包处），atk/def=攻守双方出生区。
   这样内建图和模组图（addSpikeMap 注册）形状一致：单人训练能直接读，spikeMapOk 依旧只判真假。 */
window.SPIKE_MAPS=window.SPIKE_MAPS||{
  classic:{sites:[{x:-28,z:-2},{x:28,z:-2}],spike:{x:0,z:34},atk:[-28,66],def:[2,-66]},
  eclipse:{sites:[{x:-16,z:34},{x:16,z:34}],spike:{x:0,z:38},atk:[18,80],def:[22,-70]},
  lab:    {sites:[{x:-18,z:18},{x:18,z:18}],spike:{x:0,z:36},atk:[26,60],def:[-26,-60]}
};
function spikeMapOk(id){try{return !!(window.SPIKE_MAPS&&window.SPIKE_MAPS[id]);}catch(e){return false;}}
// 【模组·暗影黑洞】引力源登记：被服务端通知"你在某黑洞范围内"时调用，刷新或新增一个短期引力源（约 160ms 过期，由施法者持续上报刷新）
var _gravSrc = [];
function _gravAdd(x, z, r, f) {
  var _now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  for (var i = 0; i < _gravSrc.length; i++) {
    if (Math.abs(_gravSrc[i].x - x) < 0.01 && Math.abs(_gravSrc[i].z - z) < 0.01) {
      _gravSrc[i].r = r; _gravSrc[i].f = f; _gravSrc[i].until = _now + 160; return;
    }
  }
  _gravSrc.push({ x: x, z: z, r: r, f: f, until: _now + 160 });
}
function netOnMsg(m){
  /* 【batch167】爆能器报文交给瓦罗兰特自己的核心（原版页没有它 → 什么都不做）
     【batch168】以 spike 开头的都转过去（含队长换图 spikeMap） */
  if(m&&m.t&&String(m.t).slice(0,5)==='spike'){
    if(window.VLUI&&VLUI.onMsg)VLUI.onMsg(m);
    return;
  }
  if(!m||!m.t)return;
  if(m.t==='welcome'){
    NET.id=m.i;NET.dead=false;
    if(typeof m.hp==='number'){S.hp=m.hp;S.maxHp=m.maxHp||100;}
    if(m.code){                                  // 服务器把身份码发回来 → 存好，换网址时用它取回名字
      var _had=(_playerCode&&_playerCode===playerCodeNormalize(m.code));
      playerCodeSave(m.code);
      if(!_had)showMsg('你的身份码：'+playerCodeNormalize(m.code)+'（换网址或换设备时，用它取回这个名字）','#7fd6ff');
    }
    /* 【batch126】服务器记住了「这个账号通关过剧情」→ 本地补写解锁（换设备 / 换网址也拿得回「闪电」） */
    /* 【batch147】服务器记住的解锁都取回来：闪电（剧情通关）/ 蚀日者（控制台指令） */
    if(m.unlocks){
      var _got=[];
      if(m.unlocks.lightning&&!UNLOCK.lightning){UNLOCK.lightning=true;_got.push('⚡ 闪电');}
      if(m.unlocks.eclipse&&!UNLOCK.eclipse){UNLOCK.eclipse=true;_got.push('🌀 蚀日者');}
      if(m.unlocks.general&&!UNLOCK.general){UNLOCK.general=true;_got.push('⚔ 大将军');}   /* 【batch245】通关第四章的奖励 */
      if(_got.length){
        UNLOCK.code=(netMyCode()||'');UNLOCK.name=S.playerName||'';UNLOCK.t=Date.now();
        unlockSave();storyRefreshBtn();
        if(typeof buildHeroGrid==='function')buildHeroGrid();
        showMsg('已从服务器取回解锁：'+_got.join('、')+' 可以使用了','#6ff0ff');
      }
    }
    if(typeof refreshMyIdLine==='function')refreshMyIdLine();
    /* 【batch167】服务端确认的「地图 / 玩法模式 / 房号」—— 一律以服务端为准（它才权威）。
       地图：以前客户端自己选了自己显示、服务端却按 classic 算，两边对不上。
       【修复·多人地图回归】之前这里只改 curMapId 不重建地图，导致客户端永远是进多人前
       （netEnterGame 里）强制建的哨塔图，服务器房间其实是火车站也照样进哨塔。
       现在按服务器权威地图真正重建：服务器是火车站就进火车站、是哨塔(classic)就进哨塔。 */
    try{ if(m.map&&typeof mapById==='function'&&mapById(m.map)){
      curMapId=m.map;
      if(typeof setMap==='function')setMap(m.map,true);   // 真按服务器地图建图（不写存档）
    } }catch(e){}
    if(typeof m.mode!=='undefined')NET_MODE=String(m.mode||'');
    if(typeof m.room!=='undefined')NET_ROOM=String(m.room||'');
    camera.position.set(m.x,2,m.z);S.velY=0;S.onLadder=false;S.mantle=0;S.landKick=0;
    updateHp();netClearPlayers();
    var ps=m.ps||[];for(var i=0;i<ps.length;i++)netEnsurePlayer(ps[i]);
    netUpdateBoard(NET.list);
    return;
  }
  if(m.t==='bye'){
    NET.replaced=true;                                   // 停止自动重连（服务端不接纳本连接）
    var _why=m.why||'';
    if(_why==='banned')netKickedHome('你已被管理员封禁，无法进入服务器');
    else if(_why==='full')netKickedHome('服务器已满（上限 '+(m.max||15)+' 人），请稍后再试');
    else if(_why==='dupname'){
      netForceRename('❌ 这个名字已经被别人用了'+(m.alt?('，换个「'+m.alt+'」试试'):'')
        +(m.needCode?'；如果这就是你，请在「身份码」框填上你的身份码取回':'；如果这就是你，请填上你的身份码取回'), !!m.needCode);
    }
    /* 【batch229】版本不符：客户端 major 和服务器不同，或客户端低于服务器下限。
       提示要写清楚「谁连不上、要什么版本」——玩家自己知道该更新哪边。 */
    else if(_why==='ver'){
      var _我=(typeof GAME_VER!=='undefined'?GAME_VER:'?');
      var _要=(m.min?('服务器要求至少 '+m.min):('服务器大版本为 '+m.sv))+'，你的版本是 '+_我;
      netKickedHome('🚫 版本不符，连不上这台服务器\n'+_要+'\n\n请更新游戏客户端（或换台版本匹配的服务器）');
    }
    /* 【batch243】模组不符：客户端带了服务器没有的模组 / 模组代码被改过 → 弹出可操作的拦截面板
       （列出必须禁用的模组 + 一键禁用并重连）。面板由 js/61 画，这里没有就退回一句提示。 */
    else if(_why==='mod'){
      var 拦={extra:m.extra||[],tampered:m.tampered||[],missing:m.missing||[],reason:m.reason||''};
      var 画了=false;
      try{
        if(window.MOD_MGR&&typeof MOD_MGR.拦截面板==='function'){ MOD_MGR.拦截面板(拦); 画了=true; }
      }catch(_eMod){}
      if(!画了){
        var 行=[];
        if(拦.extra.length)行.push('服务器没有这些模组（请禁用）：'+拦.extra.join('、'));
        if(拦.tampered.length)行.push('这些模组代码和服务器不一致（请换回服务器那版）：'+拦.tampered.join('、'));
        netKickedHome('⛔ 模组不符，连不上这台服务器\n'+(行.join('\n')||'请检查你安装的模组'));
      }
    }
    else showMsg('本页面身份已被另一个窗口占用，已停止自动重连','#fc0');
    return;
  }
  if(m.t==='pong'){                                    // 心跳回包 → 实时延迟（HUD 上显示）
    if(typeof m.ts==='number'){NET.ping=Math.max(0,Date.now()-m.ts);netUpdateBoard(NET.list);}
    return;
  }
  if(m.t==='new'){
    /* 【batch203】他是带着纪念枪皮进来的 → 在**我的**屏幕上道一声谢（服务端只广播给别人，
       所以自己不会看到自己的横幅）。 */
    try{ if(m.p&&m.p.mem&&typeof 显示感谢横幅==='function')显示感谢横幅(m.p.n); }catch(_eM){}
    netEnsurePlayer(m.p);return;
  }
  if(m.t==='left'){var e=NET.players[m.i];if(e)netRemovePlayer(e);return;}
  if(m.t==='st'){
    NET.list=m.l||[];
    var seen={};
    for(var i=0;i<NET.list.length;i++){
      var q=NET.list[i];seen[q.i]=1;
      if(q.i===NET.id){
        if(!NET.dead&&typeof q.h==='number'&&q.h>0&&q.h!==S.hp){S.hp=q.h;updateHp();}
        /* 【batch215】服务端权威击杀数：纪念枪的计数卡对的是"这一局杀了几个"，必须用它
           （单人的 S.kills 在联机里不动，是波次计数器）。 */
        try{ if(typeof MK!=='undefined')MK.联机杀=q.k||0; }catch(_eK0){}
        continue;
      }
      var rp=netEnsurePlayer({i:q.i,n:q.n,k:q.k,d:q.d,h:q.h,al:q.al});
      if(!rp)continue;
      var _pt0=performance.now(),_tyNew=q.y-netEyeOff(q.a);
      var _alive=(q.al!==0);
      // 刚复活 / 从死亡恢复 / 位置突跳（重生、瞬移、卡点自救）→ 直接瞬移到位，
      // 否则会看到「尸体在原地复活、再滑到重生点」，那具'尸体'还照样挨枪（服务端认为人已活）
      if(_alive&&(!rp.alive||Math.abs(q.x-rp.tx)+Math.abs(q.z-rp.tz)>8)){
        rp._snap=true;rp.vx=0;rp.vy=0;rp.vz=0;
      }
      if(rp._pt&&!rp._snap){                       // 由两包之间的位移估速度，供两包之间外推
        var _dt0=Math.max(_pt0-rp._pt,1)/1000;
        var _nvx=(q.x-rp.tx)/_dt0,_nvy=(_tyNew-rp.ty)/_dt0,_nvz=(q.z-rp.tz)/_dt0;
        rp.vx=rp.vx*0.4+_nvx*0.6;rp.vy=rp.vy*0.4+_nvy*0.6;rp.vz=rp.vz*0.4+_nvz*0.6;
      }
      // 顺序要紧：先更新「活着/死了」，再套血量。
      // 否则阵亡那一帧 netSetHp 会把血量夹在「存活保底 1 点」，尸体就留 1 点血、还能被当活人打。
      /* 【batch237】al=0 不再把模型藏起来：留一具尸体躺在地上（3 秒后重生再由 al=1 站起来） */
      if(rp.alive!==_alive){rp.alive=_alive;rp.root.visible=true;if(rp.label)rp.label.visible=_alive;if(rp.hb)rp.hb.visible=_alive;}
      rp.tx=q.x;rp.ty=_tyNew;rp.tz=q.z;rp.tyaw=q.r;rp.tp=(typeof q.p==='number')?q.p:0;rp.tan=q.a;rp.tw=q.w;rp.nv=(typeof q.nv==='number'?q.nv:0);rp.na=(typeof q.na==='number'?q.na:0);rp._pt=_pt0;rp.tln=q.ln||0;
      /* 【batch216】换弹 / 检视进度（服务端转发） */
      rp.rl=(typeof q.rl==='number'?q.rl:0);rp.iv=(typeof q.iv==='number'?q.iv:0);
      rp.wk=q.wk; if(rp._wk!==rp.wk){ rp._wk=rp.wk; netRebuildTPWeapon(rp); }   // 【batch184e】武器变了→按 wk 重建第三人称枪/刀模型
      rp._shadow=(q.gh===1);   // 【batch158】他在虚化/遁入暗影：模型要藏起来（netUpdateRemote 里处理）
      /* 【batch162】快照入缓冲（时间戳＝本机收到时刻）：netUpdateRemote 按「现在-110ms」的
         渲染时刻在两个快照之间**匀速线性插值**——远端移动从此丝滑，不再"新包跳一下、lerp 追一下"地抽 */
      if(!rp._buf)rp._buf=[];
      rp._buf.push({t:performance.now(),x:q.x,y:_tyNew,z:q.z,yaw:q.r});
      if(rp._buf.length>24)rp._buf.shift();
      // 【batch101】服务端把「开枪序号」一起广播：序号一变 = 他刚开了一枪 → 播枪口火光 + 曳光弹道
      if(typeof q.sh==='number'){
        if(rp.shSeq<0)rp.shSeq=q.sh;
        else if(q.sh!==rp.shSeq){rp.shSeq=q.sh;netRemoteShot(rp,q.r,q.p);}
      }
      if(typeof q.h==='number')netSetHp(rp,q.h);
      rp.kills=q.k||0;rp.deaths=q.d||0;
    }
    for(var k2 in NET.players){if(!seen[k2])netRemovePlayer(NET.players[k2]);}
    var nowT=performance.now();
    if(nowT-NET._boardT>600){NET._boardT=nowT;netUpdateBoard(NET.list);}
    return;
  }
  if(m.t==='hp'){
    if(m.i===NET.id){S.hp=m.h;updateHp();}
    else{var t=NET.players[m.i];if(t)netSetHp(t,m.h);}
    return;
  }
  if(m.t==='hurt'){netHurtFlash();return;}
  if(m.t==='sk'){                                  // 别人放了英雄技能 → 在他身上播对应英雄的特效
    var _skp=NET.players[m.i];
    if(m.th)heroRemoteThrow(_skp,m.k,m.s||0,m.th);                 // 投掷物：本地用同一套物理复现飞行
    else if(_skp)heroRemoteFX(_skp,m.k,m.s||0,m.x,m.y,m.z,m.nx,m.ny,m.nz);   // 【batch143】带落点高度
    return;
  }
  if(m.t==='boom'){heroRemoteBoom(m);return;}       // 别人的投掷物引爆 → 在引爆点播爆闪/开箱特效
  /* 【batch184f-补4】服务端权威列车：收状态/位置/撞人（多人下状态在服务端，客户端只渲染） */
  if(m.t==='train'){trainApplyState(m);return;}
  if(m.t==='trainpos'){ try{ if(typeof TRAIN!=='undefined'){ TRAIN.head=(typeof m.head==='number')?m.head:TRAIN.head; if(typeof m.ti==='number')TRAIN.ti=m.ti; } }catch(e){} return; }
  if(m.t==='trainHit'){ try{ var _kd=(m.dir||1), _tz=null; try{ _tz=TRAIN_TRACKS[TRAIN.ti].z; }catch(e3){ _tz=camera.position.z; } if(typeof trainBlastAway==='function'){ trainBlastAway(_kd,_tz,m.px,m.pz); } else { if(typeof m.pz==='number'){ camera.position.x=(typeof m.px==='number')?m.px:camera.position.x; camera.position.z=m.pz; } else { var _kx=camera.position.x+_kd*9; if(typeof playerBlocked==='function'&&!playerBlocked(_kx,camera.position.z,standEyeY()))camera.position.x=_kx; } } S.velY=(typeof m.vy==='number')?m.vy:6.5;SK.slow=Math.max(SK.slow,1.2); if(typeof spawnParticle==='function')spawnParticle(camera.position.clone(),0xffdd66,16,0.5,true); if(typeof showMsg==='function')showMsg('🚆 被列车撞飞！','#ff6b6b'); }catch(e){} return; }   // 扣血由服务端 applyDamage 权威处理；【batch188】击飞落点也由服务端下发（px/pz），避免推不动卡在车体里
  if(m.t==='push'){ try{
      if(typeof m.x==='number')camera.position.x=m.x;
      if(typeof m.z==='number')camera.position.z=m.z;
      /* 【batch238】两种 push 的收尾不一样：
         · train＝被列车挤出来：给一点减速，免得刚出来又冲回车厢；
         · tp＝防瞬移抓回：**速度直接清零**（人被拽回来了还在往前跑，会一帧一帧地被反复抓），
           并且不加 slow —— 守规矩的玩家不该莫名其妙变慢。 */
      if(m.why==='train'){ SK.slow=Math.max(SK.slow,0.35); }
      else { S.velX=0; S.velZ=0; }
      if(typeof showMsg==='function'){
        if(m.why==='train')showMsg('🚉 列车把卡住的你挤了出来','#8fd6ff');
        else showMsg('⚠ 位移异常，已把你拉回原地','#ffd166');
      }
    }catch(e){} return; }   // 【batch188】服务端停靠兜底：把人从车体里挪出来
  if(m.t==='portal'){heroPortalRemote(m);return;}   // 【batch145】别人的日蚀之门（一对门）→ 本地也开出来
  if(m.t==='flash'){var _bd=(m.dur||3000)/1000;SK.blind=Math.max(SK.blind,_bd);SK.blindDur=Math.max(SK.blindDur||0,_bd);heroBlindSync();return;}   // 被对方闪光弹致盲：整屏泛白（【batch183】dur 可能是 2.5s 日冕喷发 / 4s 白夜，淡出按真实时长算）
  if(m.t==='buff'){heroApplyBuff(m.b,(m.dur||3000)/1000);return;}   // 队友的技能增益共享到自己
  if(m.t==='unslow'){SK.slow=0;return;}                             // 急救箱：解除自己的减速
  if(m.t==='knock'){heroKnock(m.fx,m.fz,m.pw||KNOCK_DIST);return;}  // 被震荡打击击退（位移是本地的）
  /* 【模组·暗影黑洞】被服务端通知"处于某黑洞引力范围内"：登记/刷新短期引力源，本客户端每帧把自己往中心拉（位移本地，再经 t:'p' 广播，别人看到被吸） */
  if(m.t==='grav'){_gravAdd((typeof m.x==='number'?m.x:0),(typeof m.z==='number'?m.z:0),(typeof m.r==='number'&&m.r>0?m.r:14),(typeof m.f==='number'&&m.f>0?m.f:0.07));return;}
  if(m.t==='slowed'){SK.slow=Math.max(SK.slow,(m.dur||2000)/1000);return;}   // 被对方技能减速（肾上腺素免疫）
  if(m.t==='hitsk'){var _hp2=NET.players[m.i];if(_hp2)heroRemoteHit(_hp2);return;}   // 别人被打中技能（橙色环反馈）
  /* 【batch173】别人放的区域（火路/电网/穹顶/治疗云/墙）：本地只播画面，不结算伤害
     （伤害由施法者上报服务端，避免两边各扣一次血） */
  /* 【batch236】别人的「天陨」：ph=0 只能在他那边看到他举起，落点圈得等 ph=0 广播过来才画；
     ph=1 落地只播特效（真人伤害由服务端 killPlayerSrv 判，客户端别再扣一遍）。 */
  if(m.t==='meteor'){ if(typeof heroMeteorRemote==='function'){try{heroMeteorRemote(m);}catch(e){}} return; }
  if(m.t==='spzone'){
    /* 【batch176】**全部内联**，不碰 41 分片的任何函数。
       上一版调 spZoneAdd / spZoneMesh / spWallBoxAt（都在 js/41），只要对面浏览器缓存了旧分片，
       typeof 或 try 就静默跳过 → 别人的墙**既没贴图也没碰撞**，看得见才怪、更别说挡人了。
       现在这里只用 THREE / scene / obstacles / buildObstacleBoxes（都是最早加载的全局），稳。 */
    try{
      var _kz=String(m.k||'fire');
      var _zx=(+m.x||0), _zzz=(+m.z||0), _zr=(+m.r||3), _zrot=(+m.rot||0);
      var _zy=(typeof m.y==='number')?m.y:0;
      var _zd=Math.max(0.5,Math.min(3600,((+m.dur)||3000)/1000));
      var _mesh=null,_col=0xff8a3d;
      if(_kz==='fire')_col=0xff8a3d; else if(_kz==='nova')_col=0xffb347;
      else if(_kz==='revive')_col=0xffe08a; else if(_kz==='net')_col=0x7ad7ff;
      else if(_kz==='dome')_col=0x6fd6ff; else if(_kz==='nano')_col=0x4fe08a;
      if(_kz==='wall'){
        /* 【batch177】与施法端一致：实心不透明 + 立在施法者那一层楼（_zy＝脚下高度） */
        _mesh=new THREE.Mesh(new THREE.BoxGeometry(_zr*2,2.7,0.4),
          new THREE.MeshLambertMaterial({color:0x93a7bb}));
        _mesh.rotation.y=_zrot; _mesh.position.set(_zx,_zy+1.35,_zzz);
      }else if(_kz==='fire'||_kz==='nova'||_kz==='revive'||_kz==='net'){
        _mesh=new THREE.Mesh(new THREE.CircleGeometry(_zr,20),
          new THREE.MeshBasicMaterial({color:_col,transparent:true,opacity:(_kz==='net'?0.24:0.30),
            side:THREE.DoubleSide,depthWrite:false,wireframe:(_kz==='net')}));
        _mesh.rotation.x=-Math.PI/2; _mesh.position.set(_zx,_zy+0.07,_zzz);
      }else if(_kz==='dome'||_kz==='nano'){
        _mesh=new THREE.Mesh(new THREE.SphereGeometry(_zr,18,10),
          new THREE.MeshBasicMaterial({color:_col,transparent:true,opacity:0.16,side:THREE.DoubleSide,depthWrite:false}));
        _mesh.position.set(_zx,_zy+1.2,_zzz);
      }
      if(_mesh){
        _mesh.traverse(function(o){o.raycast=function(){};});
        scene.add(_mesh);
        var _box=null;
        if(_kz==='wall'){
          /* 【batch178】与施法端一致：实心不透明 + 立在施法者那一层楼（_zy） + 任意角度（定向盒） */
          /* 【batch178】内联旋转矩形 AABB（不跨分片调用 spWallAABB，避免远端报文静默失效） */
          var _wc=Math.abs(Math.cos(_zrot)),_ws=Math.abs(Math.sin(_zrot));
          var _wx2=_zr*_wc+0.2*_ws,_wz2=_zr*_ws+0.2*_wc;
          var _box={minX:_zx-_wx2,maxX:_zx+_wx2,minZ:_zzz-_wz2,maxZ:_zzz+_wz2,
                    cx:_zx,cz:_zzz,ang:_zrot,hw:_zr,hth:0.2,h:2.7,y0:_zy,y1:_zy+2.7,spWall:1,rising:true};
          obstacles.push(_box);
          try{buildObstacleBoxes();}catch(e2){}
          if(!window.__remoteWalls)window.__remoteWalls=[];
          var _whp=(typeof SP_WALL_HP==='number')?SP_WALL_HP:750;
          var _rw={mesh:_mesh,box:_box,hp:_whp,hpMax:_whp,x:_zx,z:_zzz};
          window.__remoteWalls.push(_rw);
          while(window.__remoteWalls.length>4){
            var _old=window.__remoteWalls.shift();
            try{scene.remove(_old.mesh);}catch(e3){}
            try{var _bi2=obstacles.indexOf(_old.box);if(_bi2>=0)obstacles.splice(_bi2,1);buildObstacleBoxes();}catch(e4){}
          }
          _mesh.position.y=_zy-2.7;                       // 钻地动画：从地下升起
          if(!SK.wallRises)SK.wallRises=[];
          SK.wallRises.push({mesh:_mesh,x:_zx,z:_zzz,surf:_zy,ang:_zrot,hw:_zr,box:_box,t:0,dur:0.45});
          return;
        }
        /* 【batch178 修复 A10】恢复被吞掉的 if(_mesh) 结尾：非墙区域（火/电/穹顶等）到时自毁 */
        setTimeout(function(){
          try{scene.remove(_mesh);_mesh.geometry.dispose();_mesh.material.dispose();}catch(e5){}
        },_zd*1000);
      }
    }catch(e){}
    return;
  }
  /* 【batch176】别人在打某堵（别人的）掩体墙 → 扣本地这份墙的血，打爆就撤掉贴图和碰撞 */
  if(m.t==='spwallhit'){
    try{
      var _wx=(+m.x||0),_wz=(+m.z||0),_wd=(+m.d||0);
      /* 【batch178】先查本地墙（SP_ZONES），再查别人的墙（__remoteWalls） */
      var _done=false;
      for(var _si=SP_ZONES.length-1;_si>=0&&!_done;_si--){
        var _z=SP_ZONES[_si];
        if(!_z||_z.kind!=='wall')continue;
        if(Math.abs(_z.x-_wx)>0.6||Math.abs(_z.z-_wz)>0.6)continue;
        _z.hp=(typeof _z.hp==='number'?_z.hp:SP_WALL_HP)-_wd;
        try{spawnParticle(new THREE.Vector3(_z.x,1.4,_z.z),0xbfd7e6,6,0.25);}catch(e8){}
        if(_z.hp<=0){ try{spawnParticle(new THREE.Vector3(_z.x,1.4,_z.z),0x8fb4c8,26,0.5,true);}catch(e9){} spZoneClear(_z);SP_ZONES.splice(_si,1); }
        else if(_z.hp<SP_WALL_HP*0.35&&_z.mesh&&_z.mesh.material){_z.mesh.material.color.setHex(0xc86a4a);}
        _done=true;
      }
      if(!_done){
        var _list=window.__remoteWalls||[];
        for(var _wi2=_list.length-1;_wi2>=0;_wi2--){
          var _w=_list[_wi2];
          if(Math.abs(_w.x-_wx)>0.6||Math.abs(_w.z-_wz)>0.6)continue;
          _w.hp-=_wd;
          try{spawnParticle(new THREE.Vector3(_w.x,1.4,_w.z),0xbfd7e6,6,0.25);}catch(e8){}
          if(_w.hp<=0){
            try{spawnParticle(new THREE.Vector3(_w.x,1.4,_w.z),0x8fb4c8,26,0.5,true);}catch(e9){}
            try{scene.remove(_w.mesh);}catch(e6){}
            try{var _bi3=obstacles.indexOf(_w.box);if(_bi3>=0)obstacles.splice(_bi3,1);buildObstacleBoxes();}catch(e7){}
            _list.splice(_wi2,1);
          }else if(_w.hp<(_w.hpMax||750)*0.35&&_w.mesh&&_w.mesh.material){
            _w.mesh.material.color.setHex(0xc86a4a);
          }
          break;
        }
      }
    }catch(e){}
    return;
  }
  /* 【batch184】列车血量同步（服务端权威）：一个人打、全场都看到扣血；打爆时全场都炸 */
  if(m.t==='trainHp'){
    try{ var _th=(typeof m.hp==='number')?Math.max(0,Math.min(TRAIN_HP,m.hp)):TRAIN_HP;
      if(TRAIN.group&&TRAIN.ti>=0){ TRAIN.hp=_th; trainHpShow(true); if(TRAIN.hp<=0)trainDestroy(); } }
    catch(e){}
    return;
  }
  if(m.t==='trainDestroy'){
    try{ if(TRAIN.group&&TRAIN.ti>=0)trainDestroy(); }catch(e){}
    return;
  }
  /* 【batch184】掩体墙被（任意客户端）打爆 → 同房所有人把该位置的墙（自己的 / 别人的）一并撤掉 */
  if(m.t==='spwallclear'){
    try{
      var _cx=(+m.x||0),_cz=(+m.z||0);
      for(var _si=SP_ZONES.length-1;_si>=0;_si--){ var _zz=SP_ZONES[_si];
        if(_zz&&_zz.kind==='wall'&&Math.abs(_zz.x-_cx)<0.8&&Math.abs(_zz.z-_cz)<0.8){ spZoneClear(_zz); SP_ZONES.splice(_si,1); } }
      var _rl2=window.__remoteWalls||[];
      for(var _wi3=_rl2.length-1;_wi3>=0;_wi3--){ var _w2=_rl2[_wi3];
        if(Math.abs(_w2.x-_cx)<0.8&&Math.abs(_w2.z-_cz)<0.8){
          try{scene.remove(_w2.mesh);}catch(e){}
          try{var _bi4=obstacles.indexOf(_w2.box);if(_bi4>=0)obstacles.splice(_bi4,1);buildObstacleBoxes();}catch(e){}
          _rl2.splice(_wi3,1);
        } }
    }catch(e){}
    return;
  }
  /* 【batch184c】别人隐身 / 现形：用 _cloak 标志位 + 每帧 netUpdateRemote 尊重，
     而不是只设一次 visible（否则下一帧 netUpdateRemote 的 e.root.visible=e.alive 会把它强行显示 → 「从不隐身」）。
     同时把血条 label 一并藏起来。 */
  if(m.t==='cloaked'){
    var _ce=NET.players[m.i];
    if(_ce&&_ce.root){
      var _dur=(typeof m.dur==='number'?m.dur:0);
      try{if(_ce._cloakTmr)clearTimeout(_ce._cloakTmr);}catch(e){}
      if(_dur>0){
        _ce._cloak=true;                                       // 标记：每帧 netUpdateRemote 都保持隐藏
        _ce.root.visible=false;
        if(_ce.label)_ce.label.visible=false;
        _ce._cloakTmr=setTimeout(function(){try{_ce._cloak=false;if(_ce.root)_ce.root.visible=true;if(_ce.label)_ce.label.visible=_ce.alive;if(_ce.hb)_ce.hb.visible=_ce.alive;}catch(e){}_ce._cloakTmr=0;},_dur+200);
      }else{ _ce._cloak=false;_ce.root.visible=true;if(_ce.label)_ce.label.visible=_ce.alive;if(_ce.hb)_ce.hb.visible=_ce.alive;_ce._cloakTmr=0; }
    }
    return;
  }
  /* 【batch172】自己被蜂鸟无人机扎中 → 过载：这段时间内开不了枪（刀不受影响）。
     由服务端权威下发并同步拦截伤害，本机只负责表现 + 拦自己的开火输入。 */
  if(m.t==='overload'){
    NET.overloadUntil=performance.now()+(m.dur||10000);
    try{showMsg('⚡ 武器过载！'+Math.round((m.dur||10000)/1000)+' 秒内无法开枪（只能用刀）','#9bd4ff');}catch(_){}
    return;
  }
  /* 【模组英雄·多人】别人换英雄：更新他的英雄下标，并让模组刷新他的第三人称外观 */
  if(m.t==='hero'){var _he=NET.players[m.i];if(_he){_he.heroIdx=(typeof m.h==='number'?m.h:-1);try{if(window.ModLoader&&window.ModLoader.onRemoteHero)window.ModLoader.onRemoteHero(_he,_he.heroIdx);}catch(_){}}return;}
  /* 【模组英雄·多人】别人放自定义技能：查他当前的英雄 def，调用它的 sync(k,data,src) 在本客户端复现特效/伤害（与内置英雄特效一致：各客户端本地跑） */
  if(m.t==='modsk'){var _ms=(typeof NET!=='undefined'&&NET&&NET.players)?NET.players[m.i]:null;var _mh=(typeof m.h==='number'?m.h:-1),_mhero=null;try{if(typeof HEROES!=='undefined'&&HEROES[_mh])_mhero=HEROES[_mh];}catch(_){}if(_mhero&&typeof _mhero.sync==='function'){try{_mhero.sync(m.k,m.d,_ms);}catch(_e){}}return;}
  /* 【batch120】球形闪电：倒地 / 被扶起 / 触电三重减益 */
  if(m.t==='downed'){
    if(m.i===NET.id){SK.downed=(m.ms||DB_DOWN*1000)/1000;S.hp=1;updateHp();showMsg('⚡ 你被球形闪电击中，倒地了！','#6ff0ff');}
    else{var _dp=NET.players[m.i];if(_dp){_dp.downed=true;_dp.downedLife=(m.ms||DB_DOWN*1000)/1000;}}
    return;
  }
  if(m.t==='revived'){
    if(m.i===NET.id){SK.downed=0;S.hp=m.h||Math.round(S.maxHp*DB_REVIVE_HP);updateHp();showMsg('被扶起来了！','#6ff0ff');}
    else{var _rv=NET.players[m.i];if(_rv){_rv.downed=false;_rv.downedLife=0;}}
    return;
  }
  if(m.t==='zapped'){
    var _zd=(m.dur||ORB_DEBUFF*1000)/1000;
    SK.overload=Math.max(SK.overload,_zd);SK.vuln=Math.max(SK.vuln,_zd);
    SK.slow=Math.max(SK.slow,_zd);SK.zap=Math.max(SK.zap,_zd);
    return;
  }
  /* 【batch141】`m.x|0` 会把坐标取整（差最多半米），改成 +m.x；并把贴面法线一起传下去 */
  if(m.t==='trap'){remoteTrap(+m.x||0,+m.y||0,+m.z||0,m.nx,m.ny,m.nz);return;}   // 别人的电荷陷阱：本地放个装饰件（结算在服务端）
  if(m.t==='dead'){
    NET.dead=true;S.hp=0;updateHp();clearDeathFx();   /* 【batch155】联机死亡同样收掉白闪/电弧/倒地倒计时 */
    NET.deadUntil=performance.now()+((typeof m.rs==='number'&&m.rs>0)?m.rs:3000);   /* 【batch237】死亡条倒计时 */
    /* 【batch227】倒地中被打死（球形闪电放倒再补刀）：死就不再是"倒地"，
       否则复活时 SK.downed 还是正数 → 人躺在地上起不来（用户实测）。 */
    SK.downed=0;SK._dbT=0;
    var d=document.getElementById('netDeath');if(d)d.style.display='flex';
    try{if(document.exitPointerLock)document.exitPointerLock();}catch(e){}
    return;
  }
  if(m.t==='respawn'){
    NET.dead=false;NET.deadUntil=0;NET.overloadUntil=0;S.hp=m.hp||S.maxHp;updateHp();   /* 【batch172】重生清过载 */
    /* 【batch227】重生＝效果全清（负面 + 正面，用户要求："复活的时候应该清除所有的负面效果，
       正面效果也要清除"）。倒地状态必须在这里清掉，否则"闪电放倒→补刀→复活"后人起不来。 */
    if(typeof clearAllStatusFx==='function')clearAllStatusFx();
    camera.position.set(m.x,2,m.z);S.velY=0;S.landKick=0;S.onLadder=false;S.mantle=0;
    var d2=document.getElementById('netDeath');if(d2)d2.style.display='none';
    if(!isTouch&&typeof lockPointer==='function')lockPointer();
    showMsg('已重生','#6f6');
    return;
  }
  if(m.t==='throwfx'){                    // 【batch219】别人扔出的（模组）投掷物：按抛物线复现飞行
    try{ if(typeof netThrowFx==='function')netThrowFx(m); }catch(_eTF){}
    return;
  }
  if(m.t==='revive'){                     // 复活：服务端把重生点一起发过来 → 直接瞬移过去
    var r=NET.players[m.i];
    if(r){
      r.alive=true;r.pendHp=0;r.srvHp=(typeof m.hp==='number')?m.hp:100;netDrawHp(r);
      /* 【batch227】倒地中被打死再复活：远端的倒地姿态也要收（不然别人眼里他一直瘫着） */
      r.downed=false;r.downedLife=0;
      r.vx=0;r.vy=0;r.vz=0;
      if(typeof m.x==='number'){r.tx=m.x;r.tz=m.z;r.ty=((typeof m.y==='number'?m.y:2)-netEyeOff(0));}
      r._snap=true;   // 下一帧直接出现在重生点：不会在死亡点"原地复活再滑过去"
      r.root.visible=true;if(r.label)r.label.visible=true;
    }
    return;
  }
  if(m.t==='kill'){
    if(m.k===NET.id){
      showMsg('💀 你击杀了 '+(m.dn||'对手')+(m.hs?'（爆头）':''),'#ffd166');
      /* 【batch215】纪念枪「长明」：只有**自己完成击杀**才播（被别人杀不播）。
         屏挂在死者的位置上方；如果这一包到时他已经被移除了，退化到"他最后一次同步的位置"。 */
      try{
        if(typeof MK!=='undefined')MK.联机杀=(MK.联机杀||0)+1;
        if(typeof 纪念击杀联机==='function'){
          var _mr=NET.players[m.d], _mp=null;
          if(_mr&&_mr.root&&_mr.root.position)_mp=_mr.root.position.clone();
          else if(_mr)_mp=new THREE.Vector3(_mr.tx||0,1,_mr.tz||0);
          纪念击杀联机(m.dn,_mp,(typeof MK!=='undefined')?MK.联机杀:0);
        }
      }catch(_eK1){}
    }
    else if(m.d===NET.id)showMsg('☠️ 你被 '+(m.kn||'对手')+' 击杀','#ff8080');
    else showMsg((m.kn||'?')+' 击杀了 '+(m.dn||'?'),'#9fb0c8');
    return;
  }
}
// 给联机对手加"队伍色标识"：头盔色带 + 脚下光环。
// 头盔带挂在 modelGroup 上（倒地躺平时会跟着一起躺），但必须 raycast=function(){} ——
// 否则子弹会打中色带（命中判定用的是 e.g.children），爆头判定会被它顶掉。
function netDecoratePlayer(model,teamColor){
  try{
    var sz=1.28;
    var mat=new THREE.MeshBasicMaterial({color:teamColor});
    var band=new THREE.Mesh(new THREE.BoxGeometry(sz*0.36,sz*0.055,sz*0.36),mat);
    band.position.set(0,sz*1.47,0);
    band.raycast=function(){};
    model.modelGroup.add(band);
    var ring=new THREE.Mesh(new THREE.RingGeometry(0.34,0.46,20),mat.clone());
    ring.material.transparent=true;ring.material.opacity=0.7;
    ring.rotation.x=-Math.PI/2;ring.position.y=0.03;
    model.root.add(ring);
  }catch(e){}
}
/* 【batch203】「感谢您这么久的陪伴」横幅 —— 当有玩家带着纪念枪皮进入同一间房时，
   在他人的屏幕上从上方升起 7 秒。
   为什么不做成聊天消息：这不是一条信息，是一份致意；横幅有"仪式感"，也不会被刷屏冲掉。
   只由服务端的 `t:'new'`（新玩家加入）触发：老玩家重连/掉线重连不会重复弹，避免刷屏。 */
var _memThanksT=0;
function 显示感谢横幅(name){
  var el=document.getElementById('memThanks');if(!el)return;
  var nm=document.getElementById('memThanksName');
  if(nm)nm.textContent=(name&&String(name).trim())||'一位老兵';
  el.classList.add('on');
  try{ clearTimeout(_memThanksT); }catch(e){}
  _memThanksT=setTimeout(function(){ try{ el.classList.remove('on'); }catch(e){} },7000);
  try{ if(typeof playSound==='function')playSound('pickup'); }catch(e){}
}
function netEnsurePlayer(info){
  if(!info||!info.i||info.i===NET.id)return null;
  var e=NET.players[info.i];
  if(e){if(info.n)e.name=info.n;return e;}
  var _teamC=NET_COLORS[Math.abs(info.i)%NET_COLORS.length];   // 队伍色：只做标识，不做全身
  var model=_buildPlayerModel();                               // 联机玩家专用模型（比 AI 的方块人精致得多）
  var root=model.root;
  netDecoratePlayer(model,_teamC);                             // 头盔带 + 脚下光环
  // 【batch101】不能再把瞄准线摘掉：它要挂在场景里，用来显示「他正看向哪」
  root.position.set(0,-60,0);
  scene.add(root);
  e={isNet:true,netId:info.i,name:info.n||('玩家'+info.i),type:'basic',teamColor:_teamC,team:(typeof info.t==='number'?info.t:-1),heroIdx:(typeof info.hero==='number'?info.hero:-1),
    root:root,yawPivot:model.yawPivot,g:model.modelGroup,head:model.head,hb:model.hb,hbMat:model.hbMat,
    legL:model.legL,legR:model.legR,bodyPivot:model.bodyPivot,armRig:model.armRig,lArm:model.lArm,rArm:model.rArm,
    leftLeg:model.leftLeg,rightLeg:model.rightLeg,alive:(info.al!==0),
    hp:(typeof info.h==='number'?info.h:100),srvHp:(typeof info.h==='number'?info.h:100),pendHp:0,pendT:0,
    maxHp:100,sz:1.28,sc:0,gold:0,flash:0,vx:0,vy:0,vz:0,_pt:0,   // srvHp/pendHp＝低延迟血量；vx/vz＝包间外推
    ln:0,tln:0,cr:0,run:0,aimP:0,dclimb:0,mv:0,   // mv＝走路摆幅平滑量(0..1)：停下时「收摆幅」而不是把相位往回扫   // ln/tln＝探头侧倾（当前值/目标值）
    kills:info.k||0,deaths:info.d||0,tx:0,ty:0,tz:0,tyaw:0,tp:0,pt:0,tan:0,walk:0,_t:0,_snap:true,rec:0,
    /* 【batch216】rl/iv＝服务端转发的换弹/检视进度；rlS/ivS＝本地平滑后的值（直接跳会一顿一顿） */
    rl:0,iv:0,rlS:0,ivS:0,_tpMag:null,_rlPhase:-1,
    gunRig:model.gun,knifeRig:model.knifeRig,nadeRig:model.nadeRig,hb:model.hb,hbMat:model.hbMat,wk:undefined,_wk:undefined,nv:0,na:0,holdP:0,naP:0,_nadeCode:0,shSeq:-1};
  NET.players[info.i]=e;
  enemies.push(e);
  netMakeLabel(e);
  /* 【模组英雄·多人】远端玩家建好后，让模组有机会按他的英雄自定义第三人称外观（不自定义就保持通用模型） */
  try{ if(window.ModLoader&&window.ModLoader.onRemoteHero)window.ModLoader.onRemoteHero(e,e.heroIdx); }catch(_){}
  return e;
}
function netMakeLabel(e){
  try{
    var c=document.createElement('canvas');c.width=256;c.height=80;
    var x=c.getContext('2d');
    var hex=('000000'+((e&&e.teamColor!==undefined?e.teamColor:0x7fd6ff)>>>0).toString(16)).slice(-6);
    var r=16;
    x.beginPath();
    x.moveTo(r,5);x.lineTo(256-r,5);x.quadraticCurveTo(256,5,256,5+r);
    x.lineTo(256,75-r);x.quadraticCurveTo(256,75,256-r,75);
    x.lineTo(r,75);x.quadraticCurveTo(0,75,0,75-r);
    x.lineTo(0,5+r);x.quadraticCurveTo(0,5,r,5);x.closePath();
    x.fillStyle='rgba(8,12,20,0.74)';x.fill();
    x.strokeStyle='#'+hex;x.lineWidth=4;x.stroke();
    x.font='bold 36px sans-serif';x.fillStyle='#ffffff';x.textAlign='center';x.textBaseline='middle';
    x.fillText(e.name,128,43);
    var tex=new THREE.CanvasTexture(c);
    var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
    sp.scale.set(2.4,0.75,1);sp.position.set(0,2.75,0);sp.renderOrder=997;
    sp.raycast=function(){};   // 名字不能被子弹打到
    e.root.add(sp);e.label=sp;
  }catch(err){}
}
// ===== 低延迟血量：显示值 = 服务端权威值 − 本地尚未被确认的预测伤害 =====
// netPredictHp：本地打中那一刻立刻扣血、飘伤害数字 → 肉眼零延迟
// netSetHp    ：服务端值到达（st 每帧都带），用「服务端掉了多少血」抵扣掉本地预测，
//               这样血条不会先掉再弹回、也不会重复扣。
function netDrawHp(e){
  var base=(typeof e.srvHp==='number')?e.srvHp:100;
  var v=base-(e.pendHp||0);
  e.hp=(e.alive===false)?Math.max(0,v):Math.max(1,v);   // 未确认阵亡前保留 1 点，保证还打得到（模型消失由服务端 al 决定）
  var r=Math.max(0,Math.min(1,e.hp/(e.maxHp||100)));
  if(e.hb)e.hb.scale.x=Math.max(0.001,r);
  if(e.hbMat)e.hbMat.color.setHex(r>0.5?0x00ff00:r>0.25?0xffff00:0xff0000);
}
function netSetHp(e,hp){
  if(!e)return;
  if(typeof e.srvHp!=='number')e.srvHp=hp;
  var drop=e.srvHp-hp;
  if(drop>0)e.pendHp=Math.max(0,(e.pendHp||0)-drop);    // 服务端确认的掉血先抵扣本地预测
  else if(drop<0)e.pendHp=0;                            // 回血/重生 → 预测作废
  e.srvHp=hp;
  netDrawHp(e);
}
function netPredictHp(e,dmg,hs){
  if(!e||!(dmg>0))return;
  e.pendHp=(e.pendHp||0)+dmg;e.pendT=performance.now();
  netDrawHp(e);
  netHitPopup(dmg,hs);
}
function netHitPopup(dmg,hs){   // 打中立刻在准星旁飘个伤害数字（纯本地表现，不参与判定）
  try{
    var el=document.createElement('div');
    el.textContent=(hs?'💥':'')+dmg;
    el.style.cssText='position:fixed;pointer-events:none;z-index:80;font-weight:700;text-shadow:0 2px 8px #000;'
      +'left:'+Math.round(innerWidth/2+(Math.random()-0.5)*90)+'px;top:'+(innerHeight/2-64)+'px;'
      +'color:'+(hs?'#ffd166':'#ffffff')+';font-size:'+(hs?'22px':'18px')+';opacity:1;'
      +'transition:transform .5s ease-out,opacity .5s ease-out;';
    document.body.appendChild(el);
    requestAnimationFrame(function(){el.style.transform='translateY(-30px)';el.style.opacity='0';});
    setTimeout(function(){try{el.remove();}catch(e){}},560);
  }catch(e){}
}
// 服务端上报的 y 是「相机高度」（站立在平地上 = GROUND_Y），而模型根节点在脚底(AI 敌人也是 y=0)
// → 显示时减掉眼高：站立 2.0，蹲下低 0.534
// 蹲下的眼高降量和模型完全同源（都是 CROUCH_DROP），所以别人看你蹲下时脚是踩在地上的，不会陷进去或浮空。
// （趴下曾有专门的 PRONE_EYE_H 眼高，已随趴下功能一起删除。）
function netEyeOff(anim){ if(anim===NET_ANIM.CROUCH)return GROUND_Y-CROUCH_DROP; return GROUND_Y; }
// 【远程姿态】把「蹲下 / 爬梯 / 奔跑 / 瞄准 / 探头 / 倒地」换算成模型各层的角度。
// 演进：最初只有「趴下＝整个人绕 X 轴转平」一个动作，后来补齐了蹲下/爬梯/奔跑；
// **趴下已整个删除**（用户结论：趴下 bug 太多 —— 贴墙头插墙、转身绕脚飘大圈、子弹与身体差
// 0.85~1.7 米、模型要配一整套防卡墙后移补丁）。现在逐层给动作：
//   · 蹲下：两条腿折成深蹲（膝盖微外撇）、上身下沉 + 明显前倾、枪微收（脚底仍踩在地面）
//   · 爬梯：双臂举到头顶，随爬升交替抓握，身子轻微起伏
//   · 奔跑：右手端着枪（略抬），左臂脱开护木、跟着腿反相前后摆
//   · 左右探头：只倾**躯干**（绕胯侧倾）+ 身体向探头方向微移 —— 脚不横移
//   · 倒地：整个人绕 X 轴瘫平（-1.30），脚留在原地
//   · 视角俯仰【batch105】：抬头 → 躯干后仰 + 枪口抬高；低头 → 前倾 + 枪口压低（看得出他在看天还是看地）
function netPoseRemote(e,sw){
  sw=sw||0;
  /* 【batch237】阵亡姿态：整个人瘫在地上（模型**不消失**，别人能看到尸体），
     四肢摆成自然的"散架"样，别再跟着走路/瞄准动。 */
  if(!e.alive){
    if(e.g){e.g.rotation.x=-1.45;e.g.position.y=0.16;e.g.rotation.z=0;}
    if(e.bodyPivot)e.bodyPivot.rotation.set(0,0,0);
    if(e.armRig)e.armRig.rotation.set(0.16,0,0);
    if(e.rArm)e.rArm.rotation.set(0.30,0,-0.25);
    if(e.lArm)e.lArm.rotation.set(-0.26,0,0.30);
    if(e.legL&&e.legR){
      e.legL.hip.rotation.set(0.10,0,0);e.legR.hip.rotation.set(-0.06,0,0);
      e.legL.knee.rotation.x=0.18;e.legR.knee.rotation.x=0.10;
      e.legL.hip.position.y=LEG_HIP_Y;e.legR.hip.position.y=LEG_HIP_Y;
    }
    return;
  }
  var cr=e.cr||0,run=e.run||0,aimP=e.aimP||0,dclimb=e.dclimb||0,ln=e.ln||0,rec=e.rec||0;
  // 【batch105】视角俯仰（抬头/低头）：以前只同步左右朝向，别人根本看不出你在看天还是看地。
  // 把 pitch 摊到「躯干」和「手臂+枪」两层上 —— 都是**动作本身**，不额外加提示线（不暴露位置）。
  var pt=e.pt||0;
  // 正 pitch ＝ 抬头（本地相机 pitch 正为上看）。模型本地朝 -Z，绕 X 正转＝后仰，所以同号相加即可。
  var _ptB=pt*AIM_PITCH_BODY;
  var _ptA=pt*AIM_PITCH_ARM;
  if(e.g){
    /* 只有「倒地」还动 modelGroup 本身：整个人绕 X 轴瘫平（脚留在原地），
       y 抬 0.20≈躯干厚度的一半：瘫平时前胸正好贴地，不会半个身子埋进地里。
       （趴下的"躺平 + 整体后移 + 防卡墙收缩"一整套都曾在这里，已随趴下整个删除。） */
    if(e.downed){ e.g.rotation.x=-1.30; e.g.position.y=0.20; }
    else{ e.g.rotation.x=0; e.g.position.y=0; }
    /* 探头不再倾 modelGroup：整条模型绕 Z 侧倾时，脚会绕髋横移约 0.26 米，像在滑冰。
       改成只倾躯干（bodyPivot，见下），这里不再碰 rotation.z / position.x。 */
  }
  if(e.legL&&e.legR){
    /* 蹲下：大腿前折 CROUCH_THIGH、小腿回折 CROUCH_SHIN、髋部随之下沉 CROUCH_DROP ——
       三个量同源，脚底始终踩在地上（与第一人称眼高下降量一致，不会陷地或浮空）。
       膝盖微外撇（±0.12）：深蹲时两膝略张，比"两块板平行折"自然得多。
       走路摆幅蹲下时归零：腿是折着的，再"原地踏步"就很怪（用户反馈过）。 */
    var _drop=-CROUCH_DROP*cr,_swW=sw*(1-cr);
    e.legL.hip.rotation.x=_swW+CROUCH_THIGH*cr;   e.legR.hip.rotation.x=-_swW+CROUCH_THIGH*cr;
    e.legL.knee.rotation.x=CROUCH_SHIN*cr;        e.legR.knee.rotation.x=CROUCH_SHIN*cr;
    e.legL.hip.rotation.z=-0.12*cr;               e.legR.hip.rotation.z=0.12*cr;   // 膝盖外撇
    e.legL.hip.position.y=LEG_HIP_Y+_drop;        e.legR.hip.position.y=LEG_HIP_Y+_drop;
  }
  if(e.bodyPivot){
    e.bodyPivot.position.y=LEG_HIP_Y-CROUCH_DROP*cr;
    // 负号才是前倾：模型本地朝 -Z，绕 X 正转会把 +Y 推向 +Z（＝向后仰）
    // 蹲下＝战术蹲姿：躯干明显前倾（绕胯转才自然，绕脚底转会像整个人向前倒）
    e.bodyPivot.rotation.x=-0.28*cr+_ptB;           // 【batch105】+_ptB＝抬头后仰 / 低头前倾
    /* 【batch216】瞄准时身体侧转：真枪是"枪托进肩窝、上身前倾一点点、躯干侧转"，
       只抬手臂看起来像"单手举枪"。0.20 rad≈11°，配合手臂上抬就够读了。 */
    e.bodyPivot.rotation.y=-0.20*aimP;
    /* 左右探头：躯干绕胯侧倾（0.42 rad≈24°）+ 身体向探头方向微移 0.16 米。
       腿在另一层、不随之横移 → 脚底钉在原地，不再"滑冰"。 */
    e.bodyPivot.rotation.z=-ln*0.42;
    e.bodyPivot.position.x=-ln*0.16;
  }
  if(e.armRig){
    // 爬梯要把手臂抬到「身体正上方」
    var _reach=1.62*dclimb;
    // 【batch104】投掷动作：拿着投掷物 → 手臂略抬；举起来瞄准 → 手臂明显抬高（做出"要扔了"的姿态）
    // 【batch216】主要抬臂改由 rArm 承担（下面 netPoseThrow 那段），这里只留一点整体带动
    var _nap=(e.holdP||0)*0.12+(e.naP||0)*0.28;
    // 蹲下：枪随身体下沉一点、往怀里收一点（收枪警戒的姿态）—— 别还端着站姿的枪
    var _crGun=-0.10*cr;
    // 【batch102】开火后坐力：枪口猛地往上跳一下，再逐帧回弹（第三人称下"枪在抖"看得一清二楚）
    // 【batch105】+_ptA：抬头 → 枪口抬高；低头 → 枪口压低（正面/侧面都看得出他在瞄哪一层）
    /* 【batch217】开镜＝把枪**平移**到眼睛高度，不是旋转（用户："水平方向并没有动，而你这个是直接旋转了，
       而且是向下旋转"）。原来写 -0.42*aimP —— 绕 X 负转会把枪口转向**下方**，看着像"枪越瞄越朝地"。
       现在的做法跟真人据枪一致：
         · 枪身整体上抬 10.5cm（抬到眼睛高度）
         · 往身体中线收 5.5cm（枪托顶进右肩窝）
         · 旋转只留 +0.04（几乎看不出来，只是微微抬头对上视线）
       后坐力也不再让枪"自己抖"（见下）—— 真实的开火是**视角上移**，枪跟着视角走（_ptA 那一路）。 */
    e.armRig.rotation.x=_reach+0.04*aimP-0.18*run+0.28*dclimb*Math.sin(e.walk||0)-_nap+_ptA+_crGun;
    if(e._armBack===undefined){e._armBack=e.armRig.position.z;e._armY=e.armRig.position.y;e._armX=e.armRig.position.x;}
    /* 蹲下时枪往怀里收（本地 +Z 是身后）。⚠️ 这里**不再**加 rec —— 加了就是"枪原地抖"，
       而用户要的是后坐力体现在视角上（pitch 20Hz 上报 + 本地平滑 = 枪跟着视线一起抬）。 */
    e.armRig.position.z=e._armBack-0.05*cr;
    /* 0.15 米 ≈ 把瞄具从"胸口"抬到"下巴/眼睛"之间：肩窝到眼睛约 0.26 米，
       枪托仍顶在肩上，所以枪身只抬一半多一点（全抬上去手臂会横在脸前面）。 */
    e.armRig.position.y=e._armY+0.150*aimP;
    e.armRig.position.x=e._armX-0.070*aimP;
  }
  if(e.lArm){
    // 左臂：正常双手端枪（0）；跑起来脱开护木、跟着腿反相前后摆（用户点名要的「另一只手前后摆动」）
    // 蹲下时左手仍托着枪（略抬，保持据枪稳定）；【batch103】手里换成刀/投掷物时 → 自然收回到身侧
    var _noGun=(((e.nv|0)>0)||((e.tw|0)===1))?1:0;
    e.lArm.rotation.x=-0.62*run-Math.sin(e.walk||0)*0.55*run-_noGun*0.75-0.12*cr*(1-_noGun);
    e.lArm.rotation.z=0;                       // 【batch216】每帧清零：下面换弹/检视会往上叠加
  }
  netPoseGunWork(e,aimP);                      // 【batch216】换弹 / 检视：枪和手的动作
  if(e.hb)e.hb.lookAt(camera.position);       // 血条永远朝向自己（和 AI 敌人一致），侧面也看得见
}
/* 【batch216】换弹 / 检视动作（第三人称）—— 用户："要别人能看出你在换弹 / 在检视"
   数据来自服务端转发的 rl / iv（0~1 进度），这里把进度翻译成**枪+手**的动作。
   要点：动的是**枪相对手**的位置（gunRig 是 rArm 的子节点），不是整个人摆姿势 ——
   所以别人看到的是"他右手握着枪、枪在他手里下沉/倾斜、左手去掏弹匣"。
   ── 换弹六段（与第一人称同一套节奏，只是没有第一人称那么细）──
     0.00~0.16  枪下沉 + 左倾（左手离开护木，往弹匣井去）
     0.18~0.42  旧弹匣往下掉并缩小
     0.42~0.52  空档（匣已经不在枪上）
     0.52~0.70  新弹匣从下面顶上来
     0.70~0.86  拍匣底（枪震）+ 拉机柄后拉
     0.86~1.00  枪回正、左手回护木
   ── 检视 ──
     枪抬到胸前 + 绕 Y 轴来回转 + 左手托护木 */
function _净01(v,a,b){ var t=(v-a)/Math.max(0.0001,b-a); return t<0?0:(t>1?1:t); }
function netPoseGunWork(e,aimP){
  var g=e.gunRig; if(!g)return;
  var rl=e.rlS||0, iv=e.ivS||0;
  if(!e._gunBase)e._gunBase={x:g.position.x,y:g.position.y,z:g.position.z};
  var B=e._gunBase;
  var gx=B.x,gy=B.y,gz=B.z,grx=0,gry=0,grz=0;

  if(rl>0.015){
    var p=rl;
    /* 两头的包围曲线：进得快、出得慢，且两端一定回到 0（否则动作会"啪"地跳回原位） */
    var 包=Math.min(1,p/0.16)*Math.min(1,(1-p)/0.10);
    gy-=0.075*包; gz+=0.050*包; grz+=0.30*包; grx-=0.14*包;

    var mg=g.userData.tpMag, mb=g.userData.tpMagBase;
    if(mg&&mb){
      var my0=(typeof g.userData.tpMagY==='number')?g.userData.tpMagY:mg.position.y;
      var mb0=(typeof g.userData.tpMagBaseY==='number')?g.userData.tpMagBaseY:mb.position.y;
      var dy=0, sy=1, vis=true;
      if(p<0.18){ }
      else if(p<0.42){ var k1=_净01(p,0.18,0.42); dy=-0.20*k1; sy=1-0.72*k1; }
      else if(p<0.52){ vis=false; }
      else if(p<0.70){ var k2=_净01(p,0.52,0.70); dy=-0.18*(1-k2); sy=0.28+0.72*k2; }
      if(!vis){ mg.visible=false; mb.visible=false; }
      else{
        mg.visible=true; mb.visible=true;
        mg.position.y=my0+dy; mb.position.y=mb0+dy;
        var s=(sy>0.06)?sy:0.06;
        mg.scale.set(1,s,1); mb.scale.set(1,s,1);
      }
    }
    /* 拉机柄：0.78~0.86 后拉，0.86~0.92 复进 */
    var bo=g.userData.tpBolt;
    if(bo){
      var bz=(typeof g.userData.tpBoltZ==='number')?g.userData.tpBoltZ:bo.position.z;
      bo.position.z=bz+0.030*_净01(p,0.78,0.86)*(1-_净01(p,0.86,0.92));
    }
    /* 左手：摸弹匣 → 拉出 → 送新匣 → 拍匣底 → 回护木 */
    var lk=0;
    if(p<0.10)lk=0;
    else if(p<0.32)lk=_净01(p,0.10,0.32);
    else if(p<0.46)lk=1;
    else if(p<0.62)lk=1-0.45*_净01(p,0.46,0.62);
    else if(p<0.74)lk=0.55+0.45*_净01(p,0.62,0.74);
    else if(p<0.92)lk=1-_净01(p,0.78,0.92);
    else lk=0;
    /* ⚠️ 左手要**往下**去弹匣井（模型本地 -Z 朝前，绕 X 正转会把手臂往后上方甩，
       实测正号会让左手举到头顶上）。负号才是往下收，和 _noGun 收手是同一方向。 */
    if(e.lArm){ e.lArm.rotation.x-=0.95*lk; e.lArm.rotation.z+=0.30*lk; }
  }

  if(iv>0.015){
    var q=iv;
    var 举=Math.min(1,q/0.12)*Math.min(1,(1-q)/0.10);
    gy+=0.155*举; gz+=0.085*举;
    gry+=1.45*Math.sin(q*Math.PI*2)*举;
    grx-=0.55*举; grz+=0.42*举;
    if(e.lArm){ e.lArm.rotation.x+=0.34*举; e.lArm.rotation.z+=0.22*举; }
  }

  /* 只写枪（臂的姿态由 netPoseRemote 按 run/cr/aim 负责，别在这里重复写） */
  g.position.set(gx,gy,gz);
  g.rotation.set(grx,gry,grz);

  /* 【batch216】投掷物握持：右臂抬到胸前 → 举到肩侧（投掷预备）。
     以前只有 armRig 整体抬一点点，"拿着手雷"和"空着手"在别人眼里几乎没区别。 */
  if(e.rArm){
    var hp=e.holdP||0, ap=e.naP||0;
    if(hp>0.01||ap>0.01){
      /* ⚠️ 抬臂是**正**值：rArm 初始是自然下垂（没有初始旋转），绕 X 正转才是把手臂往前上方抬；
         负值是把手臂往身后甩（和 lArm 相反 —— lArm 初始就是端枪的姿势，负值才是往下压）。 */
      e.rArm.rotation.x= 0.34*hp+0.95*ap;
      e.rArm.rotation.z=-0.16*hp-0.52*ap;
      e.rArm.rotation.y= 0.10*ap;
    }else{
      e.rArm.rotation.set(0,0,0);
    }
  }
}
function netUpdateRemote(e){
  var now=performance.now();
  var dt=e._t?Math.min((now-e._t)/1000,0.1):0.016;e._t=now;
  if(e._snap){e._snap=false;e.root.position.set(e.tx,e.ty,e.tz);e._buf=null;}   // 首次出现直接就位（并丢弃跨地图的旧快照）
  var moving=false;
  /* 【batch162】远端表现层重做：**快照缓冲 + 渲染时刻固定回看 110ms 的匀速线性插值**。
     旧方案（朝新包目标做 lerp + 速度外推）的两个毛病——"慢半拍"和"抽一下抽一下"——
     都是目标点每来一包就跳一下、lerp 再追一下造成的。快照插值让远端永远以真实速度匀速移动，
     一帧一帧都对得上；代价是固定 ~110ms 的显示延迟（FPS 联机的业界标准做法）。
     高延迟链路（隧道）按 NET.ping 自适应加大回看量；没有缓冲（探针直接喂 e.tx）时退回旧 lerp。 */
  var buf=e._buf;
  if(buf&&buf.length>=2){
    var _delay=Math.max(NET_INTERP_DELAY,Math.min(250,(NET.ping||0)*1.2));
    var rt=now-_delay;
    var i0=0;
    while(i0<buf.length-1&&buf[i0+1].t<=rt)i0++;
    var s0=buf[i0],s1=buf[Math.min(i0+1,buf.length-1)];
    var span=s1.t-s0.t;
    var f=span>0?Math.max(0,Math.min(1.2,(rt-s0.t)/span)):1;   // 缺包时最多顺延 20%，宁可停一下也不瞬移
    e.root.position.x=s0.x+(s1.x-s0.x)*f;
    e.root.position.y=s0.y+(s1.y-s0.y)*f;
    e.root.position.z=s0.z+(s1.z-s0.z)*f;
    var dyw=s1.yaw-s0.yaw;
    while(dyw>Math.PI)dyw-=Math.PI*2;while(dyw<-Math.PI)dyw+=Math.PI*2;
    e.yawPivot.rotation.y=s0.yaw+dyw*f;
    moving=Math.sqrt((s1.x-s0.x)*(s1.x-s0.x)+(s1.z-s0.z)*(s1.z-s0.z))/Math.max(span,1)*1000>0.5;   // 快照间有位移＝在动
  }else{
    // 【低延迟】按上一包估出的速度把目标位置往前外推（最多 0.1 秒），画面就贴住服务端的真实位置
    var gx=e.tx,gy=e.ty,gz=e.tz;
    if(e._pt&&(e.vx||e.vz||e.vy)){
      var ex=Math.min((now-e._pt)/1000,(NET.ping>150?0.16:0.10));   // 延迟越高，外推窗口越大
      gx+=e.vx*ex;gy+=e.vy*ex;gz+=e.vz*ex;
    }
    var k=Math.min(1,dt*20);
    e.root.position.x+=(gx-e.root.position.x)*k;
    e.root.position.y+=(gy-e.root.position.y)*k;
    e.root.position.z+=(gz-e.root.position.z)*k;
    var d=e.tyaw-e.yawPivot.rotation.y;
    while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;
    e.yawPivot.rotation.y+=d*Math.min(1,dt*22);
    var dx=gx-e.root.position.x,dz=gz-e.root.position.z;
    moving=Math.sqrt(dx*dx+dz*dz)>0.06;
  }
  // 【腿部摆动 —— 这里原来有个大坑】walk 是"相位"不是"幅度"：它一路累加（走一段路就几十弧度），
  // 原来"不移动时 e.walk*=0.9"等于把相位往回猛扫，一帧能扫过好几弧度 → 别人看你
  // "左右滑动视角（＝原地不动只转视角）时腿部跟瞬移一样"（用户反馈原话）。
  // 正确做法：相位只按固定速率前进、永不回头；"摆幅"另外用一个平滑量 mv(0..1) 控制。
  var _mvT=(moving||e.tan===NET_ANIM.LADDER)?1:0;
  e.mv=(e.mv||0)+(_mvT-(e.mv||0))*Math.min(1,dt*8);
  if(e.tan===NET_ANIM.LADDER)e.walk+=dt*4;
  else if(e.mv>0.02)e.walk+=dt*(e.tan===NET_ANIM.RUN?14:9);
  var sw=Math.sin(e.walk)*0.5*e.mv;
  // 【姿态混合】蹲下/奔跑/瞄准/爬梯 几个姿态量都按 dt 平滑过渡，状态一变就"啪"地瞬移很难看。
  // 各关节到底转多少度，统一交给 netPoseRemote()（那里才是真正"摆姿势"的地方）。
  // （趴下过渡量 e.pr 曾在这里平滑，已随趴下删除。）
  e.cr=e.cr+(((e.tan===NET_ANIM.CROUCH)?1:0)-e.cr)*Math.min(1,dt*10);
  e.run=e.run+(((e.tan===NET_ANIM.RUN)?1:0)-e.run)*Math.min(1,dt*6);
  e.aimP=e.aimP+(((e.tan===NET_ANIM.AIM)?1:0)-e.aimP)*Math.min(1,dt*8);
  e.dclimb=e.dclimb+(((e.tan===NET_ANIM.LADDER)?1:0)-e.dclimb)*Math.min(1,dt*8);
  e.ln=e.ln+((e.tln||0)-e.ln)*Math.min(1,dt*16);
  // 【batch105】视角俯仰平滑：pitch 20Hz 一包 → 直接赋值会一包一跳，这里逐帧追上去
  e.pt=(e.pt||0)+(((e.tp||0))-(e.pt||0))*Math.min(1,dt*AIM_PITCH_SMOOTH);
  /* 【batch216】换弹 / 检视进度平滑：20Hz 一包，直接赋值会让动作一顿一顿 */
  e.rlS=(e.rlS||0)+((e.rl||0)-(e.rlS||0))*Math.min(1,dt*18);
  e.ivS=(e.ivS||0)+((e.iv||0)-(e.ivS||0))*Math.min(1,dt*14);
  netUpdateHeld(e);                                              // 【batch103】按 tw/nv 切换他手里拿的东西
  // 【batch104】投掷动作过渡量：holdP＝手里拿着（掏出），naP＝举起来瞄准（点了左键）
  var _nadeOn=(((e.nv|0)>0)?1:0), _aimOn=(((e.na|0)===1)?1:0);
  e.holdP=(e.holdP||0)+(_nadeOn-(e.holdP||0))*Math.min(1,dt*7);
  e.naP=(e.naP||0)+(_aimOn-(e.naP||0))*Math.min(1,dt*9);
  netPoseRemote(e,sw);
  /* 【batch219】手上的投掷物要"活"起来：第一人称 heroHoldShow 那套每帧转它（P.spin），
     第三人称以前是死的 —— 一个静止的模型拿在别人手上，看着像贴纸。
     模组投掷物可以给 def.spin 控制转速（不写就按内置的手雷 1.8）。 */
  if(e.nadeRig&&e.nadeRig.visible&&e.nadeRig.children.length){
    var _sp=1.8;
    try{
      var _k=NADE_KIND[e._nadeCode|0]||'';
      var _td=(window.ModLoader&&ModLoader.throwables&&ModLoader.throwables[_k])||null;
      if(_td&&typeof _td.spin==='number')_sp=_td.spin;
      else if(typeof HOLD_POSE!=='undefined'&&HOLD_POSE[_k]&&typeof HOLD_POSE[_k].spin==='number')_sp=HOLD_POSE[_k].spin;
    }catch(_eSp){}
    e.nadeRig.rotation.y+=dt*_sp;
    /* 【batch236】手持时轻微浮动 + 举起来时再抬高一点：静止死贴的模型像贴纸 */
    var _hp2=e.holdP||0,_ap2=e.naP||0;
    var _by=(typeof e._nadeBaseY==='number')?e._nadeBaseY:-0.15;
    e.nadeRig.position.y=_by+0.012*Math.sin(performance.now()*0.004)+0.05*_ap2;
    e.nadeRig.position.z=-0.30+0.04*_ap2;                // 举起时往前送一点，看得出"要用了"
  }
  e.rec=Math.max(0,(e.rec||0)-dt*RECOIL_DECAY);                  // 【batch102】开火后坐逐帧回弹
  if(e.flash>0)e.flash-=dt;                                      // 闪光只负责染色，血条已在命中瞬间更新
  if(e.pendHp>0&&now-(e.pendT||0)>800){e.pendHp=0;netDrawHp(e);} // 预测迟迟没被服务端认账 → 复原，避免血条长期偏低
  /* 【batch158】他在虚化 / 遁入暗影 → 模型整个藏起来，原地只留一团小小的暗影（别人视角） */
  if(e._shadow){
    e.root.visible=false;if(e.label)e.label.visible=false;
    if(!e._shadowBlob){e._shadowBlob=heroMeshShadowBlob();e._shadowBlob.scale.set(1.1,1,1.1);scene.add(e._shadowBlob);}
    e._shadowBlob.visible=true;
    e._shadowBlob.position.set(e.root.position.x,Math.max(0.06,e.root.position.y+0.06),e.root.position.z);
  }else{
    if(e._shadowBlob){if(e._shadowBlob.parent)e._shadowBlob.parent.remove(e._shadowBlob);e._shadowBlob=null;}
    /* 【batch184c】光学隐身：每帧尊重 _cloak 标志（和 _shadow 同理），否则会被 e.root.visible=e.alive 盖掉 → 别人永远看得到你 */
    if(e._cloak&&e.alive){ e.root.visible=false; if(e.label)e.label.visible=false; if(e.hb)e.hb.visible=false; }
    else {
      /* 【batch237】活着 / 死了都显示：死了要留一具尸体（以前直接隐藏＝人凭空消失） */
      e.root.visible=true;
      if(e.label)e.label.visible=e.alive;
      if(e.hb)e.hb.visible=e.alive;
    }
  }
}
function netHitRemote(e,hs,dmg,point,melee){
  if(!e||!e.alive)return;
  /* 【batch172】kn:1 ＝ 近战伤害：服务端不会被「过载」拦掉（过载只是开不了枪，刀照样能砍） */
  netSend({t:'hit',i:e.netId,d:Math.round(dmg),h:!!hs,kn:melee?1:0});
  netPredictHp(e,Math.round(dmg),hs);   // 【低延迟】本地先扣血 + 飘字，不等服务端回包
  e.flash=0.25;
  if(e.hbMat)e.hbMat.color.setHex(hs?0xffcc00:0xffffff);
  if(point)spawnParticle(point,hs?0xffff00:0xff4444,hs?8:4);
  showMsg(hs?'💥 命中头部!':'💥 命中!','#ffd166');
}
function netHurtFlash(){
  var ov=document.getElementById('dmg-overlay');if(!ov)return;
  ov.style.borderColor='rgba(255,0,0,.55)';
  setTimeout(function(){ov.style.borderColor='transparent';},150);
}
function netUpdateBoard(list){
  var el=document.getElementById('netBoard');if(!el)return;
  var arr=(list||[]).slice().sort(function(a,b){return (b.k||0)-(a.k||0)||(a.d||0)-(b.d||0);});
  var hasMe=false;for(var i=0;i<arr.length;i++)if(arr[i].i===NET.id)hasMe=true;
  if(NET.id&&!hasMe)arr.push({i:NET.id,n:NET.name||netMyName(),k:0,d:0,h:S.hp});
  var pg=NET.ping|0,pc=(pg<=0?'#8ea3c0':(pg<80?'#6fe08a':(pg<200?'#ffd166':'#ff8080')));
  var h='<h4>🌐 线上对战 · '+arr.length+' 人 · <span style="color:'+pc+'">延迟 '+(pg>0?pg+'ms':'—')+'</span></h4>';
  if(!NET.connected||NET.reconnecting)
    h+='<div class="nb-row" style="color:#ffb347">⟳ 正在重连第 '+Math.max(1,NET.retry)+' 次…</div>';
  else if(NET.reconn>=5)
    h+='<div class="nb-row" style="color:#8ea3c0;font-size:11px">本局重连过 '+NET.reconn+' 次（网络不太稳）</div>';
  for(var j=0;j<arr.length&&j<8;j++){
    var q=arr[j];
    h+='<div class="nb-row'+(q.i===NET.id?' nb-me':'')+'"><span>'+(q.i===NET.id?'▶ ':'')+(q.n||('玩家'+q.i))+'</span><span>'+(q.k||0)+' / '+(q.d||0)+'</span></div>';
  }
  el.innerHTML=h;
}
function netAnimState(){
  if(S.onLadder)return NET_ANIM.LADDER;
  if(S.crouch)return NET_ANIM.CROUCH;
  if(S.aiming)return NET_ANIM.AIM;
  if(!S.onGround)return NET_ANIM.AIR;
  var mv=keys.KeyW||keys.KeyS||keys.KeyA||keys.KeyD;
  if(S.sprinting&&mv)return NET_ANIM.RUN;
  if(mv)return NET_ANIM.WALK;
  return NET_ANIM.IDLE;
}
/* ==================== batch101：把「别人在开火 / 在看哪」画出来 ====================
   以前别人开枪你这边**什么都看不见**：没有枪口火光、没有弹道，也不知道他瞄哪。
   做法：20Hz 的位置包里塞一个「开枪序号 sh」——序号一跳，就说明他刚开了一枪，
        于是本机在他身上播一团枪口火光 + 一条曳光弹道（方向取他上报的朝向）。
        零新消息类型、几乎不占带宽；弹道只是视觉，不参与任何判定。
   另外开火时给玩家模型一个「后坐力」：枪口猛地往上跳一下再回弹，第三人称下明显看出他在开枪。 */
var RECOIL_KICK=0.55;                              // 【batch102】开后坐：枪口上跳弧度（越大越猛）
var RECOIL_BACK=0.10;                              // 【batch102】开后坐：枪身向肩后一顿的距离（米）
var RECOIL_DECAY=9;                                // 【batch102】后坐回弹速度（每秒，9≈0.1 秒弹回）
var AIM_PITCH_BODY=0.42;                           // 【batch105】抬头/低头：躯干后仰/前倾的比例（1.4 弧度满抬头 → 约 34°）
var AIM_PITCH_ARM=0.55;                            // 【batch105】抬头/低头：手臂连同枪抬落的比例（比躯干大一点，一眼看出枪口朝天还是朝地）
var AIM_PITCH_SMOOTH=16;                           // 【batch105】俯仰平滑速度（每秒；pitch 20Hz 一包，不快平滑会一包一跳）
var netShotSeq=0;                                  // 本机累计开火次数（随状态包发出去）
var netTracers=[],netFlashes=[];                   // 曳光弹道 / 枪口火光（纯视觉，会自己消失）
var netTracerGeo=new THREE.BoxGeometry(0.05,0.05,3.4);
var netTracerMat=new THREE.MeshBasicMaterial({color:0xffcc55});
var netFlashGeo=new THREE.SphereGeometry(0.17,7,6);
/* 枪口火光：一小团亮球，约 60 毫秒后自己消失 */
function netMuzzleFlash(x,y,z,color){
  var m=new THREE.Mesh(netFlashGeo,new THREE.MeshBasicMaterial({color:(color||0xffd070)}));
  m.position.set(x,y,z);m.raycast=function(){};
  scene.add(m);netFlashes.push({m:m,t:0.06});
}
/* 曳光弹道：一条细长亮条沿射击方向飞出去，撞墙 / 超时即消失 */
function netTracerSpawn(x,y,z,dir){
  var d=dir.clone().normalize();
  var m=new THREE.Mesh(netTracerGeo,netTracerMat);
  m.position.set(x,y,z);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),d);   // 长条沿 -Z 朝前
  m.raycast=function(){};scene.add(m);
  netTracers.push({m:m,d:d,spd:170,life:0.6,prev:new THREE.Vector3(x,y,z)});
}
/* 别人开了一枪：在他枪口播火光 + 一条曳光弹道 */
function netRemoteShot(e,yaw,pitch){
  if(!e||!e.root||!e.alive||typeof yaw!=='number')return;
  var p=pitch||0,cp=Math.cos(p);
  var dx=-Math.sin(yaw)*cp,dy=Math.sin(p),dz=-Math.cos(yaw)*cp;
  var ox=e.root.position.x,oy=e.root.position.y+1.40,oz=e.root.position.z;
  /* 【batch216】火光/曳光从**真正的枪口**出：第二/第三人称的枪现在是第一人称那套模型的复制品，
     枪口位置由模型自己报（gunRig.userData.tpMuzzle）。以前固定从胸口 +0.55 米，
     打起来看着像"子弹从肚子飞出去"——枪越长越明显。 */
  var mx=ox+dx*0.55,my=oy+dy*0.55,mz=oz+dz*0.55;
  try{
    var mu=e.gunRig&&e.gunRig.userData&&e.gunRig.userData.tpMuzzle;
    if(mu&&e.gunRig.visible){
      var wp=mu.clone();
      e.gunRig.localToWorld(wp);
      if(isFinite(wp.x)&&isFinite(wp.y)&&isFinite(wp.z)){ mx=wp.x;my=wp.y;mz=wp.z; }
    }
  }catch(_eM){}
  netMuzzleFlash(mx,my,mz,e.teamColor||0xffd070);
  netTracerSpawn(mx,my,mz,new THREE.Vector3(dx,dy,dz));
  e.rec=Math.min(1,(e.rec||0)+0.85);                 // 【batch102】开火后坐：枪口上跳 + 枪身后顿（连发叠加）
}
/* 【batch103】联机对手"手里拿什么"：按他上报的武器类型 tw（0 枪 / 1 刀）与手持投掷物 nv 切换显示。
   投掷物直接复用第一人称那套 heroMesh*()（每次调用都新建、不是单例，可以放心挂到别人手上）。 */
/* 【batch168】补全**所有**投掷物的第三人称模型：以前只有通用 7 件（frag/flash/smoke/
   medsmoke/medkit/pulse/mine），英雄的投掷物（黑日 solar / 传送门 portal / 眼 orb /
   电荷陷阱 trap / 球形闪电 ball / 影月两件 ssmoke·sbomb）在别人眼里**手上什么都没有**
   —— 因为它们根本没有编号，nv 上报出来是 0。现在补齐编号与建模函数。 */
var NADE_KIND=['','frag','flash','smoke','medsmoke','medkit','pulse','mine',
               'solar','portal','orb','trap','ball','ssmoke','sbomb',
               /* 【batch236】SP 形态的「手持技能」也占编号：15~19。
                  以前这几种 nv 上报是 0 → 别人眼里你**空着手**，举墙 / 举无人机 / 举小太阳
                  在第三人称一点动作都没有（用户："所有的手持技能几乎都没有第三人称动画"）。 */
               'sp_drone','sp_net','sp_wall','sp_sunfall','sp_meteor'];
var NADE_CODE={frag:1,flash:2,smoke:3,medsmoke:4,medkit:5,pulse:6,mine:7,
               solar:8,portal:9,orb:10,trap:11,ball:12,ssmoke:13,sbomb:14,
               sp_drone:15,sp_net:16,sp_wall:17,sp_sunfall:18,sp_meteor:19};
/* 手里握着的尺寸：黑日/传送门/掩体墙是"大招级"，第一人称就缩得很小，第三人称同理。
   【batch236】这张表以前定义了却没人用（代码里写死 code>=8?0.85:0.48），
   于是掩体墙挂到别人手上是 4.8×2.7 的**整面墙**。现在统一按表取。 */
var NADE_SCALE={solar:0.34,portal:0.40,ball:0.9,orb:1.0,trap:1.0,sbomb:1.0,
                sp_wall:0.16,sp_drone:0.55,sp_net:0.55,sp_sunfall:0.5,sp_meteor:0.5};
function netNadeMesh(code){
  var k=NADE_KIND[code]||'';
  /* 【batch219】模组投掷物：先在 ModLoader.throwables 里找，找到就用模组自己的 mesh()。
     以前这里只认内置 14 种，模组英雄掏出来的东西在别人手上是**空**的。 */
  try{
    var _t=(window.ModLoader&&ModLoader.throwables&&ModLoader.throwables[k])||null;
    if(_t&&typeof _t.mesh==='function'){ var _mm=_t.mesh(); if(_mm)return _mm; }
  }catch(_eTN){}
  if(k==='frag')return heroMeshFrag();
  if(k==='flash')return heroMeshFlash();
  if(k==='smoke')return heroMeshSmoke(false);
  if(k==='medsmoke')return heroMeshSmoke(true);
  if(k==='medkit')return heroMeshMedkit();
  if(k==='pulse')return heroMeshPulse();
  if(k==='mine')return heroMeshMine();
  /* ---- 英雄投掷物（batch120 / batch158）---- */
  if(k==='solar')return heroMeshSolar();
  if(k==='portal')return heroMeshPortal();
  if(k==='orb')return heroMeshOrb();
  if(k==='trap')return heroMeshTrap();
  if(k==='ball')return heroMeshBall();
  if(k==='ssmoke')return heroMeshShadowSmoke();
  if(k==='sbomb')return heroMeshShadowBomb();
  /* 【batch236】SP 手持技能：直接用第一人称那套模型（形状一致，尺寸靠 NADE_SCALE 缩） */
  try{
    if(k==='sp_drone')return heroMeshSpDrone();
    if(k==='sp_net')return heroMeshSpNet();
    if(k==='sp_wall')return heroMeshSpWall();
    if(k==='sp_sunfall')return heroMeshSun();
    if(k==='sp_meteor')return heroMeshSpMeteor();
  }catch(_eSPN){}
  return null;
}
/* 按 tw / nv 切换对手手上的东西：投掷物 > 刀 > 枪 */
function netUpdateHeld(e){
  if(!e)return;
  /* 【batch238】尸体不举东西：人躺下了手里还举着陨石/掩体墙，看着像在摆拍。
     手里原来的枪/刀保持最后状态（别把人"扒光"）。复活后 e.alive=true 立刻恢复正常。 */
  if(e.alive===false){ if(e.nadeRig)e.nadeRig.visible=false; return; }
  var code=(e.nv|0)||0, knife=((e.tw|0)===1), held=(code>0);
  if(e.nadeRig&&e._nadeCode!==code){                 // nv 变了才重建投掷物网格（省性能）
    e._nadeCode=code;
    while(e.nadeRig.children.length)e.nadeRig.remove(e.nadeRig.children[0]);
    var m=code?netNadeMesh(code):null;
    /* 【batch216】手里的投掷物按真人比例缩：第一人称那套为了看得清放大到 1.25 倍，
       直接挂到第三人称手上会是一颗"篮球那么大的手雷"。0.62 ≈ 真手雷尺寸。 */
    if(m){
      var _k=NADE_KIND[code]||'';
      var _sc=(NADE_SCALE[_k]!=null)?NADE_SCALE[_k]:(code>=8?0.85:0.48);
      m.scale.setScalar(_sc);
      e.nadeRig.add(m);
      e._nadeBaseY=(e.nadeRig.position.y||-0.15);        /* 记一个基准高度，下面做呼吸浮动 */
    }
  }
  if(e.gunRig)e.gunRig.visible=(!held&&!knife);
  if(e.knifeRig)e.knifeRig.visible=(!held&&knife);
  if(e.nadeRig)e.nadeRig.visible=held;
}
/* 【batch184e】按 wk 重建远端玩家的第三人称枪/刀模型：
   wk 为数字＝枪槽位号（0=内置步枪，>=2=模组枪）；为 'k:<id>'＝刀（tactical/claw…）。
   清掉旧几何、按 def.tpBuild 重建，远端玩家切武器时就能看到正确的枪/刀，而非永远一把步枪。 */
function netRebuildTPWeapon(e){
  if(!e)return;
  var wk=e.wk;
  if(((e.tw|0)===1)){
    var kd=null;
    if(typeof wk==='string'&&wk.indexOf('k:')===0){ var _id=wk.slice(2); if(_id!=='tactical'&&KNIVES&&KNIVES[_id])kd=KNIVES[_id]; }
    buildThirdPersonKnife(e.knifeRig,kd);
    e._tpMag=null;e._rlPhase=-1;               /* 换成刀：枪的弹匣缓存全部作废（旧引用指向已删网格） */
  }else{
    var gd=null;
    if(typeof wk==='number'){
      if(wk!==0){
        if(window.ModLoader&&ModLoader.weapons&&ModLoader.weapons[wk])gd=ModLoader.weapons[wk];
        /* 【batch216】wk 也可能是**内置槽位**（-1=纪念枪「长明」）——
           以前只查 ModLoader.weapons，查不到就当普通步枪建，
           所以纪念枪在别人眼里一直是一把普通步枪。 */
        else if(typeof BUILTIN_GUNS!=='undefined'&&BUILTIN_GUNS&&BUILTIN_GUNS[wk])gd=BUILTIN_GUNS[wk];
      }
    }
    buildThirdPersonWeapon(e.gunRig,gd);
    e._tpMag=null;e._rlPhase=-1;                 // 换弹动画的缓存跟着新模型清掉（旧引用指向已删网格）
  }
}
/* 【batch219】别人扔出的投掷物（纯视觉）：按 出生点+初速 走抛物线，落地弹两下，到点消失。
   模型用 netNadeMesh(编号) —— 内置 14 种和模组 addThrowable 注册的都能建出来。 */
var netThrowFxList=[];
function netThrowFx(m){
  if(!m)return;
  var mesh=null;
  try{ mesh=netNadeMesh(m.c|0); }catch(e){ mesh=null; }
  if(!mesh)return;
  try{ mesh.scale.setScalar((m.c|0)>=40?0.55:0.48); }catch(e){}
  mesh.position.set(+m.x||0,+m.y||0,+m.z||0);
  scene.add(mesh);
  netThrowFxList.push({
    m:mesh, x:+m.x||0, y:+m.y||0, z:+m.z||0,
    vx:+m.vx||0, vy:+m.vy||0, vz:+m.vz||0,
    t:0, life:(+m.d>0.2?+m.d:1.4), rot:Math.random()*6.28
  });
  if(netThrowFxList.length>12){                       // 防刷屏：最多 12 个
    var old=netThrowFxList.shift();
    try{ scene.remove(old.m); }catch(e){}
  }
}
function netThrowFxTick(dt){
  if(!netThrowFxList.length)return;
  var G=(typeof PROJ_G==='number')?PROJ_G:18, R=(typeof PROJ_R==='number')?PROJ_R:0.13;
  for(var i=netThrowFxList.length-1;i>=0;i--){
    var f=netThrowFxList[i]; f.t+=dt;
    f.vy-=G*dt;
    f.x+=f.vx*dt; f.y+=f.vy*dt; f.z+=f.vz*dt;
    try{
      var surf=(typeof projSurfAt==='function')?projSurfAt(f.x,f.z,f.y):0;
      if(f.y-R<surf){ f.y=surf+R; f.vy*=-0.34; f.vx*=0.68; f.vz*=0.68; }
    }catch(e){}
    f.m.position.set(f.x,f.y,f.z);
    f.rot+=dt*5.5;
    f.m.rotation.set(f.rot*0.6,f.rot,0);
    if(f.t>=f.life||f.t>4){
      try{ scene.remove(f.m); }catch(e){}
      netThrowFxList.splice(i,1);
    }
  }
}
/* 每帧：推进曳光 / 撞墙 / 淡出枪口火光（都不结算伤害） */
function netVisualTick(){
  var now=performance.now();
  var dt=netVisualTick._t?Math.min((now-netVisualTick._t)/1000,0.1):0.016;
  netVisualTick._t=now;
  for(var i=netTracers.length-1;i>=0;i--){
    var t=netTracers[i];
    t.prev.copy(t.m.position);t.m.position.addScaledVector(t.d,t.spd*dt);
    var hit=false;
    for(var w=0;w<obstacles.length;w++){
      var o=obstacles[w];
      if(o.rail&&(t.m.position.y<o.y0-0.05||t.m.position.y>o.y1))continue;
      if(t.m.position.y>(o.h||0)+0.1)continue;
      if(t.m.position.x>o.minX&&t.m.position.x<o.maxX&&t.m.position.z>o.minZ&&t.m.position.z<o.maxZ){hit=true;break;}
    }
    t.life-=dt;
    if(hit||t.life<=0){try{scene.remove(t.m);}catch(err){}netTracers.splice(i,1);}
  }
  for(var j=netFlashes.length-1;j>=0;j--){
    var f=netFlashes[j];f.t-=dt;
    if(f.t<=0){try{scene.remove(f.m);}catch(err){}netFlashes.splice(j,1);}
  }
  netThrowFxTick(dt);          // 【batch219】别人扔出来的投掷物
}
function netTick(){
  if(!netIsMulti()||!NET.connected)return;
  var now=performance.now();
  var dt=NET._t?Math.min((now-NET._t)/1000,0.1):0.016;NET._t=now;
  NET.sendAcc+=dt*1000;
  // 20Hz（50ms）：和服务器广播同频。原来 30Hz 在隧道/弱网下会把上行塞满 →
  // TCP 积压 → 延迟越来越高然后卡死。自己的移动手感不受影响（本地即时），
  // 别人看到的你由服务端插值 + 速度外推补齐，照样平滑。
  if(NET.sendAcc<50)return;
  NET.sendAcc=0;
  // 上报的就是「脚底」（相机就在脚底正上方）：服务端认定的位置、模型根节点、子弹出点三点同点。
  // y 仍然是相机高度，别人用 netEyeOff(姿态) 换算脚底。
  // （趴下曾把相机架到脚底前方 0.85~1.7 米，上报时要扣掉那一段前伸，已随趴下删除。）
  var _fpx=camera.position.x,_fpz=camera.position.z,_fpy=camera.position.y;
  /* 【batch145】虚化时"身体"还留在原地：上报的仍是身体位置（别人看你站在原地不动），
     并带上 gh 标记 —— 服务端据此给你一段"免疫伤害"的窗口。 */
  if(SK.ghost>0&&SK.ghostFrom){_fpx=SK.ghostFrom.x;_fpz=SK.ghostFrom.z;_fpy=SK.ghostFrom.y;}
  netSend({t:'p',x:Math.round(_fpx*100)/100,y:Math.round(_fpy*100)/100,z:Math.round(_fpz*100)/100,
    yaw:Math.round(yaw*1000)/1000,pitch:Math.round(pitch*1000)/1000,an:netAnimState(),w:currentWeapon,wk:((currentWeapon===WEAPON_KNIFE)?('k:'+currentKnife):curGun),ln:Math.round(S.lean*100)/100,
    h:SK.idx,sh:netShotSeq,
    nv:(SK.hold?(NADE_CODE[SK.hold.kind]||0):0),
    na:((SK.aimThrow||(SK.hold&&(SK.hold.kind==='sp_meteor'||SK.hold.kind==='sp_wall')))?1:0),   /* 【batch236】举墙/举陨石也是"举起"姿态 */
    /* 【batch216】换弹 / 检视进度（0~1，0=没在做）——
       别人靠这两个数在第三人称播"退弹匣→上弹匣→拉栓"和"转枪检视"。 */
    rl:(function(){try{
      if(!S.reloading)return 0;
      var t0=(typeof reloadAnimStart==='number')?reloadAnimStart:0;
      var d=(typeof S.reloadTime==='number'&&S.reloadTime>0)?S.reloadTime:1200;
      if(!t0)return 0;
      return Math.max(0.001,Math.min(0.999,(performance.now()-t0)/d));
    }catch(e){return 0;}})(),
    iv:(function(){try{
      if(typeof 检视==='undefined'||!检视||!检视.on)return 0;
      var d2=(检视.dur>0)?检视.dur:3600;
      return Math.max(0.001,Math.min(0.999,(performance.now()-检视.t0)/d2));
    }catch(e){return 0;}})(),
    gh:((SK.ghost>0||SK.shadowT>0)?1:0)});                              // 【batch145】虚化标记（服务端免疫伤害）；【batch158】遁入暗影同样置 gh
}

/* ==================== 【batch222】服务器连接条 ====================
   用户口径（原话拆开）：
     · 打开游戏就先问服务器地址；**不填＝离线**（能单人/剧情，不能多人）
     · 连接失败要提示；**再失败还提示**，直到玩家主动选「离线模式」
     · 顺带修掉"没有服务器就改不了设置"：原来点「多人」弹的是 #netPanel
       （z-index 660 的全屏 modal），把设置面板（600）压在底下，看着像点不动。
   所以这里做的是主菜单里的**文档流横条**，不占全屏、不拦点击。
   ⚠️ 判断顺序很重要：
     ?solo=1          → 玩家/客户端明确要单人，不打扰
     http 页面自动联机 → 先给它 1.2 秒去连，连不上再亮条提示
     file:// 或连不上  → 亮条，等玩家填地址或点离线
*/
(function 服务器连接条(){
  var 条=document.getElementById('srvBar');
  if(!条) return;
  var 输入=document.getElementById('srvInput');
  var 状态=document.getElementById('srvSt');
  var 已连接过=false;

  function 显示(){ 条.classList.remove('hide'); 预填(); }
  function 隐藏(){ 条.classList.add('hide'); }
  /* 【batch237】给外面（netMultiClick）用：连不上时亮条 / 写字 */
  window.netShowBar=显示; window.netHideBar=隐藏;
  function 说话(t,cls){
    if(状态) 状态.textContent=t;
    条.classList.remove('ok','bad');
    if(cls) 条.classList.add(cls);
  }
  /* 亮条时把上次的地址预填进去（原来只在点「多人游戏」时调，现在统一挂在 显示() 后面） */
  function 预填(){
    var v='';
    try{ v=(typeof NET!=='undefined'&&(NET.raw||NET.server))||localStorage.getItem('gunGame.netServer.v1')||''; }catch(e){}
    if(输入&&!输入.value) 输入.value=v;
  }

  /* 离线：断开一切联机意图，只留单人。记住这个选择，本次会话不再打扰。 */
  function 离线(){
    已连接过=false;
    try{ NET.enabled=false; NET.server=''; NET.raw=''; }catch(e){}
    try{ if(NET.ws){NET.ws.onclose=null;NET.ws.onmessage=null;NET.ws.close();} }catch(e){}
    try{ NET.ws=null; NET.connected=false; NET.reconnecting=false; NET.dead=false; }catch(e){}
    /* 【batch225】玩家明确选了离线 → 把「下次自动连回去」的记号也删掉，
       否则下次打开还会自作主张去连、又失败、又被弹一次提示。 */
    try{ localStorage.removeItem(NET_AUTO_KEY); }catch(e){}
    说话('✅ 已进入离线模式：单人 / 剧情都能玩，想联机再点上面的「多人游戏」。','ok');
    setTimeout(隐藏,1400);
  }

  /* 连接：只连不进战场；连上了再进（否则失败了人已经在战场里，看不到提示） */
  function 连接(){
    var raw=输入?String(输入.value||'').trim():'';
    if(!raw){
      说话('没填地址就当作离线模式 —— 想联机请填服务器地址，例如 127.0.0.1:8765。','bad');
      return;
    }
    var host='';
    try{ host=netNormHost(raw); }catch(e){ host=''; }
    if(!host){ 说话('地址格式不对：写成 IP:端口 或域名，例如 192.168.1.5:8765','bad'); return; }

    说话('⏳ 正在连接 '+host+' …');
    条.classList.remove('ok','bad');
    try{
      NET.raw=raw; NET.server=host; NET.enabled=true;
      try{ localStorage.setItem('gunGame.netServer.v1', raw); }catch(e){}
      if(typeof netConnect==='function') netConnect();
    }catch(e){ 说话('连接出错：'+e,'bad'); return; }

    var n=0;
    var t=setInterval(function(){
      n++;
      if(NET && NET.connected){
        clearInterval(t); 已连接过=true;
        说话('✅ 已连接 '+host+'，正在进入战场…','ok');
        setTimeout(function(){
          隐藏();
          try{ if(typeof netEnterGame==='function') netEnterGame(); }catch(e){}
        },500);
        return;
      }
      if(n>=16){                                  // 4 秒还没连上
        clearInterval(t);
        说话('❌ 连不上 '+host+'。确认服务端已启动、地址端口没错，可以再点「连接」重试；不想联机就点「离线玩单人」。','bad');
      }
    },250);
  }

  if(document.getElementById('srvGo')) document.getElementById('srvGo').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); 连接(); });
  if(document.getElementById('srvOffline')) document.getElementById('srvOffline').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); 离线(); });
  if(输入) 输入.addEventListener('keydown',function(e){
    e.stopPropagation();                       // 别让 W/A/S/D 触发游戏按键
    if(e.key==='Enter'){ e.preventDefault(); 连接(); }
  });

  /* 【batch237】「多人游戏」按钮**只有一个入口**：netMultiClick（在 netUIInit 里）。
     这里原来还有一条 capture 监听，会先把点击吃掉 —— 于是"已连接就直接进 / 有上次的服务器先探一下"
     那套新逻辑永远跑不到（探针抓到的）。串行化后只保留下面这个只读的对外写字接口。 */
  window.netBarSay=说话;

  /* ---- 启动判断：什么时候该主动亮条 ---- */
  var 单人=false;
  try{ 单人=/[?&]solo=1/.test(location.search||''); }catch(e){}
  if(单人){ 隐藏(); return; }

  /* 等「名字闸门」放行再 join（【batch226】）：
     自动连接现在发生在页面一打开，而取名面板可能还没过 ——
     不等的话 join 会带着默认名（电脑664 / 手机xxx）上服务器，玩家注册的名字发不出去。 */
  function 等名字就绪(然后){
    var 等=0;
    var t=setInterval(function(){
      等++;
      if(window.__名字就绪 || 等>48){ clearInterval(t); 然后(); }   // 12 秒兜底：闸门卡死也得能连
    },250);
  }
  /* 【batch227】连不上就**静默离线**：不亮条、不弹文字、不烦玩家（用户口径：
     "刷新网页后不要老是显示连接服务器中，它在后台自动连接，连不上就自动加到离线模式上，
      只有点击多人模式后才会弹出要你强制连服务器的东西"）。
     【batch229 修】静默离线**不再删 autoConn 记号**——服务器只是这次没开，删了记号
     下次打开客户端就再也不自动连了（主人实测："客户端连不上服务器了"）。记号留着：
     下次刷新还会安安静静再试一次；只有玩家主动点「离线玩单人」才删（离线() 里删）。 */
  function 静默离线(){
    try{ if(NET.ws){NET.ws.onclose=null;NET.ws.onmessage=null;NET.ws.close();} }catch(e){}
    try{ NET.ws=null; NET.connected=false; NET.reconnecting=false; NET.dead=false; NET.enabled=false; NET._autoStart=0; }catch(e){}
  }
  /* 连上之后 4 秒半还连不上 → 静默离线（静态站、服务器没开的兜底，不打扰玩家） */
  function 连不上就静默离线(){
    var n0=0, t0=setInterval(function(){
      n0++;
      if(NET && NET.connected){ clearInterval(t0); return; }
      if(n0>=18){
        clearInterval(t0);
        if(NET && NET.connected) return;
        静默离线();
      }
    },250);
  }

  setTimeout(function(){
    if(NET && NET.connected){ 隐藏(); return; }
    /* 【batch226/227】页面就是服务器发的：打开网页就静默连；连不上静默离线，
       不亮条、不显示"连接服务器中"（刷不刷新都一个样：能连上就用，连不上就当单人玩）。 */
    if(NET && typeof netAutoMode==='function' && netAutoMode() && NET.server){
      隐藏();
      等名字就绪(function(){
        try{ if(typeof netConnect==='function') netConnect(); }catch(e){}
        连不上就静默离线();
      });
      return;
    }
    /* 本地文件 / 客户端壳子：上次真的连上过（autoConn）→ 静默重连一次，
       连不上也静默离线，不亮条不提示。从没连过 → 什么都不显示，点「多人游戏」再说。 */
    隐藏();
    if(NET && NET.enabled && NET._autoStart){
      等名字就绪(function(){
        try{ if(NET.server && typeof netConnect==='function') netConnect(); }catch(e){}
        var n=0;
        var t=setInterval(function(){
          n++;
          if(NET && NET.connected){ clearInterval(t); setTimeout(隐藏,900); return; }
          if(n>=14){ clearInterval(t); 静默离线(); }
        },300);
      });
    }
  },1200);
})();
