// ==================== INIT ====================
weaponGroup.position.set(GUN_BASE_POS.x,GUN_BASE_POS.y,GUN_BASE_POS.z);
renderUpgradeCards();
addEventListener('resize',function(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

// ==================== 开局流程（取名 → 主菜单 → 进入 / 退出）====================
// 【延迟加载】菜单阶段一个 3D 资源都不建、主循环也不启动；点「开始」时才加载。
// 这样"在开始菜单里点开始之前，所有东西都不会被加载"，也不会在菜单里就占性能。
var _gameLoaded=false;
function loadGameOnce(){
  if(_gameLoaded)return;
  _gameLoaded=true;
  initParticlePool();rebuildWeaponModel();buildClimbHands();buildObstacleBoxes();
  requestAnimationFrame(loop);
}
var PLAYER_NAME_KEY='gunGame.playerName.v1';
// 名字在本地是「加密」保存的：用开发者工具直接看 localStorage，只会看到一串乱码，也不好手改。
// （说明：网页里的加密属于"混淆"，能挡住顺手看一眼/顺手改一下，不能当成真正的保密手段。）
var NAME_SALT='gunGame.nameBox.k7';
function _nameX(s){
  var out='',k=NAME_SALT;
  for(var i=0;i<s.length;i++)out+=String.fromCharCode(s.charCodeAt(i)^k.charCodeAt(i%k.length)^((i*7+5)&255));
  return out;
}
function _nameBytes(s){try{return unescape(encodeURIComponent(String(s)));}catch(e){return String(s);}}
function _nameText(b){try{return decodeURIComponent(escape(b));}catch(e){return b;}}
// 明文 → 密文：'n1' + 4 位校验和 + 十六进制密文
function nameEnc(n){
  var b=_nameBytes(n==null?'':n),sum=0,i;
  for(i=0;i<b.length;i++)sum=(sum*31+b.charCodeAt(i))&65535;
  var x=_nameX(b),hex='';
  for(i=0;i<x.length;i++){var v=x.charCodeAt(i)&255;hex+=(v<16?'0':'')+v.toString(16);}
  return 'n1'+('0000'+sum.toString(16)).slice(-4)+hex;
}
// 密文 → 明文；被手改过（校验和对不上）就返回空串，等于没有名字
function nameDec(v){
  v=String(v==null?'':v);
  if(v.slice(0,2)!=='n1')return '';
  var sum=parseInt(v.slice(2,6),16);if(!isFinite(sum))return '';
  var hex=v.slice(6);if(!hex.length||hex.length%2)return '';
  var x='',i;
  for(i=0;i<hex.length;i+=2)x+=String.fromCharCode(parseInt(hex.substr(i,2),16));
  var b=_nameX(x),s=0;
  for(i=0;i<b.length;i++)s=(s*31+b.charCodeAt(i))&65535;
  if(s!==sum)return '';
  return _nameText(b).slice(0,8);
}
function playerNameLoad(){
  try{
    var v=localStorage.getItem(PLAYER_NAME_KEY);if(!v)return;
    var d=nameDec(v);
    if(!d&&String(v).length<=8)d=String(v);      // 老版本存的是明文：读出来，下面立刻改存成密文
    if(d){S.playerName=d.slice(0,8);if(nameDec(v)!==d)playerNameSave(d);}
  }catch(e){}
}
function playerNameSave(n){
  S.playerName=String(n==null?'':n).trim().slice(0,8);
  try{localStorage.setItem(PLAYER_NAME_KEY,nameEnc(S.playerName));}catch(e){}
  if(typeof refreshMyIdLine==='function')refreshMyIdLine();
}
// 【身份码】每个名字一张"小身份证"。隧道网址 / 局域网网址 / 本地文件是三个不同的"网站"，
// 浏览器不允许它们共享本地数据，所以玩家在新网址里输入「名字 + 身份码」，就能把名字取回来。
var PLAYER_CODE_KEY='gunGame.playerCode.v1';
var _playerCode='';
function playerCodeNormalize(c){return String(c==null?'':c).trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);}
function playerCodeLoad(){
  try{
    var v=localStorage.getItem(PLAYER_CODE_KEY);if(!v)return;
    var d=nameDec(v);if(d)_playerCode=playerCodeNormalize(d);
  }catch(e){}
}
function playerCodeSave(c){
  _playerCode=playerCodeNormalize(c);
  try{localStorage.setItem(PLAYER_CODE_KEY,nameEnc(_playerCode));}catch(e){}
  if(typeof refreshMyIdLine==='function')refreshMyIdLine();
}
function netMyCode(){return _playerCode||'';}
/* ==================== 【batch230】启动器账号注入 ====================
   启动器（PCL 枪战突击修改版）里管着一份账号表；启动某个版本时把选中的账号拼进 URL：
     index.html?pclname=名字&pclcode=身份码&pclcid=客户端ID
   这里读出来写进 localStorage —— 于是"启动器一份账号，所有版本共用"。
   注意：只在**带了参数**时才写；不带的普通打开绝不动玩家现有账号。 */
(function 启动器账号注入(){
  var q='';
  try{ q=String(location.search||''); }catch(e){ return; }
  if(q.indexOf('pcl')<0) return;                 // 完全没带启动器参数：什么都不做
  function 取(k){
    var m=new RegExp('[?&]'+k+'=([^&]*)').exec(q);
    if(!m) return '';
    try{ return decodeURIComponent(m[1]); }catch(e2){ return m[1]; }
  }
  var 名=取('pclname'), 码=取('pclcode'), cid=取('pclcid');
  try{
    if(名) localStorage.setItem(PLAYER_NAME_KEY, nameEnc(String(名).trim().slice(0,8)));
    if(码) localStorage.setItem(PLAYER_CODE_KEY, nameEnc(playerCodeNormalize(码)));
    if(cid) localStorage.setItem('gunGame.clientId.v1', String(cid).slice(0,40));
  }catch(e){}
  /* 写进仓库后要把内存里的也刷一遍（playerNameLoad/playerCodeLoad 可能在这之前已经跑过） */
  try{ if(typeof playerNameLoad==='function') playerNameLoad(); }catch(e3){}
  try{ if(typeof playerCodeLoad==='function') playerCodeLoad(); }catch(e4){}
})();
// 主菜单那行「我的名字 · 身份码」
function refreshMyIdLine(){
  var el=document.getElementById('myIdLine');if(!el)return;
  var n=(typeof S!=='undefined'&&S&&S.playerName)||'';
  if(!n&&!_playerCode){el.textContent='';return;}
  el.textContent='🪪 我的名字：'+(n||'（未设置）')+(_playerCode?('　身份码 '+_playerCode+'（换网址/换设备时用它取回名字，建议抄下来）'):'');
}
// 名字规则：中文/字母/数字/_/-，1~8 个字；所有人名字必须唯一（由服务器把关）
function playerNameValid(n){return /^[\u4e00-\u9fa5A-Za-z0-9_-]{1,8}$/.test(String(n==null?'':n));}
// 问服务器"这个名字还能用吗"（取名时用）。服务器连不上就不拦（本地照样能玩单人）
/* 【batch221】第 4 参改成对象：{时限, bind}
     · 时限：超时毫秒（默认 2500）。启动时的"名字闸门"用更短的 1200 ——
       进网页不该为了一个查重等 2.5 秒；超时一律当"连不上服务器"，放行进主菜单（离线也要能玩）。
     · bind：1 ＝ 顺手把名字登记进名字库（客户端在面板点"确定"时传），
             服务端会回 bound=1 和一个身份码。启动闸门只查不登记，不传。 */
function netCheckName(n,code,cb,opt){
  opt=opt||{};
  var host='';
  try{host=NET.server||netNormHost(localStorage.getItem(NET_SRV_KEY)||'');}catch(e){}
  if(!host){cb(null);return;}
  var done=false;
  function fin(r){if(done)return;done=true;cb(r);}
  var proto=(NET.secure||(typeof location!=='undefined'&&location.protocol==='https:'))?'wss://':'ws://';
  var ws=null;
  try{ws=new WebSocket(proto+host+'/ws');}catch(e){cb(null);return;}
  var _ms=(typeof opt.时限==='number'&&opt.时限>0)?opt.时限:2500;
  var to=setTimeout(function(){try{ws.close();}catch(e){}fin(null);},_ms);
  ws.onopen=function(){
    try{
      /* ⚠️ 跨分片调用一律 typeof 守卫：玩家缓存了旧的 js/30 时 netClientId 不存在，
         这里一抛错就永远发不出请求（只能等超时），表现就是"名字一直卡在检查中"。 */
      var cid=(typeof netClientId==='function')?netClientId():'';
      var cd=(typeof playerCodeNormalize==='function')?playerCodeNormalize(code):'';
      ws.send(JSON.stringify({t:'checkname',n:n,cid:cid,code:cd,bind:opt.bind?1:0}));
    }catch(e){}
  };
  ws.onmessage=function(ev){var m=null;try{m=JSON.parse(ev.data);}catch(e){return;}
    if(m&&m.t==='namechk'){clearTimeout(to);fin(m);try{ws.close();}catch(e){}}};
  ws.onerror=function(){clearTimeout(to);fin(null);};
  ws.onclose=function(){clearTimeout(to);fin(null);};
}
// 被服务器拒绝连接时的统一处理：退出当前局 + 断开连接（并停止自动重连）
// needRename=true → 回「取名菜单」（重名必须改名才能再进）
// needRename=false → 直接回「开始界面」（主菜单：封禁 / 服务器满员）
function netKicked(tip,needRename,needCode){
  try{if(NET.ws){NET.ws.onclose=null;NET.ws.onmessage=null;NET.ws.close();}}catch(e){}
  NET.ws=null;NET.connected=false;NET.reconnecting=false;NET.replaced=true;NET.dead=false;NET.list=[];
  try{netClearPlayers();netKeepAlive(false);}catch(e){}
  S.playing=false;S.over=false;S.paused=false;
  ['netBoard','netDeath','wave-shop','go','hud'].forEach(function(id){var el=document.getElementById(id);if(el)el.style.display='none';});
  if(typeof isTouch!=='undefined'&&isTouch&&typeof touchUI!=='undefined'&&touchUI)touchUI.style.display='none';
  try{if(document.exitPointerLock)document.exitPointerLock();}catch(e){}
  var bl=document.getElementById('blocker'),np=document.getElementById('namePanel');
  var ni=document.getElementById('nameInput'),er=document.getElementById('nameErr');
  if(needRename){
    if(bl)bl.style.display='none';
    if(np)np.classList.add('on');
    if(ni){ni.value=S.playerName||'';try{ni.focus();ni.select();}catch(e){}}
    var ci=document.getElementById('codeInput');if(ci&&_playerCode)ci.value=_playerCode;
    if(er)er.textContent=tip||'这个名字已经被别人用了，请换一个';
    if(needCode&&ci){try{ci.focus();ci.select();}catch(e){}}
  }else{
    if(np)np.classList.remove('on');                 // 直接回到开始界面
    if(bl)bl.style.display='flex';
    setMenuMode('home');
  }
  if(tip)showMsg(tip,'#f66');
}
function netForceRename(tip,needCode){netKicked(tip,true,needCode);}    // 重名 → 回取名菜单（needCode=要填身份码）
function netKickedHome(tip){netKicked(tip,false);}    // 封禁/满员 → 回开始界面
// 主菜单 / 游戏内菜单两种形态
function setMenuMode(m){
  var bl=document.getElementById('blocker');if(bl)bl.classList.toggle('pause-mode',m==='pause');
  var h=document.getElementById('menuTitle');
  var sb=document.getElementById('startBtn');
  var nb=document.getElementById('netBtn');
  var rb=document.getElementById('relockBtn');
  if(m==='pause'){
    if(h)h.textContent='⏸️ 游戏暂停';
    if(sb)sb.textContent='▶️ 继续游戏';
    if(nb)nb.style.display='none';
    /* 【batch117】局内不许换地图 / 换英雄：相关页签与面板在 pause-mode 下由 CSS 整块隐藏，
       这里再把"当前激活的面板"复位到「枪械改装」—— 万一样式没生效（或以后有人改了 CSS），
       面板也不会跟着暂停菜单一起露出来。双保险。 */
    try{ setTab('upgrades'); }catch(e){}
  }else{
    if(h)h.textContent='🔫 枪战突击';
    if(sb)sb.textContent='⚔️ 单人游戏';
    if(nb)nb.style.display='';
    if(rb)rb.style.display='none';
  }
}
// 进入游戏（单人与多人共用）
function enterGame(){
  loadGameOnce();
  var bl=document.getElementById('blocker');if(bl)bl.style.display='none';
  var hd=document.getElementById('hud');if(hd)hd.style.display='block';
  if(typeof isTouch!=='undefined'&&isTouch&&typeof touchUI!=='undefined'&&touchUI)touchUI.style.display='block';
  var nd=document.getElementById('netDeath');if(nd)nd.style.display='none';
  /* 【batch183】开局兜底：上一局（联机）残留的**远端**技能物件（别人的墙）在这里收干净。
     退出时为了"不删别人的东西"特意留着 —— 但那只是留给"他还在打"的那间房，
     进新一局时不该跟着漂到新图上。只用全局（scene / obstacles / buildObstacleBoxes），不调任何分片函数。 */
  try{
    var _rw2=window.__remoteWalls||[];
    for(var _r2=_rw2.length-1;_r2>=0;_r2--){
      try{ if(_rw2[_r2]&&_rw2[_r2].mesh&&_rw2[_r2].mesh.parent)_rw2[_r2].mesh.parent.remove(_rw2[_r2].mesh); }catch(_e9){}
      try{ var _b2=obstacles.indexOf(_rw2[_r2]&&_rw2[_r2].box); if(_b2>=0)obstacles.splice(_b2,1); }catch(_e10){}
    }
    _rw2.length=0;
    /* 【batch184】进新一局时，自己上一局（多人退出时特意留着的）技能墙 / 区域也一并收掉，
       避免残留的碰撞盒漂进新图。只用全局，不调任何分片函数。 */
    for(var _sz=SP_ZONES.length-1;_sz>=0;_sz--){
      try{ var _z2=SP_ZONES[_sz]; if(_z2&&_z2.box){var _bz=obstacles.indexOf(_z2.box);if(_bz>=0)obstacles.splice(_bz,1);} if(_z2&&_z2.mesh&&_z2.mesh.parent)_z2.mesh.parent.remove(_z2.mesh); }catch(_e12){}
    }
    SP_ZONES.length=0;
    if(typeof buildObstacleBoxes==='function')buildObstacleBoxes();
  }catch(_e11){}
  try{for(var k in _raw)_raw[k]=false;}catch(e){}
  /* 【batch203】累积登录打卡（每局一次，同一天只算一天）。
     满 7 天当场解锁纪念枪「长明」并提示一次 —— 提示故意放在开局 1 秒后，
     不然会和"进入地图"的其它提示挤在一起。 */
  try{
    if(typeof 纪念打卡==='function'){
      var _md=纪念打卡();
      if(_md.新解锁)setTimeout(function(){ try{ showMsg('🕯️ 纪念枪「长明」已解锁 —— 感谢您这么久的陪伴。按 B 装备它','#ffd88a'); }catch(e){} },1200);
      else if(_md.今天首次&&typeof 纪念天数==='function'&&!纪念已解锁()){
        var _n=纪念天数();
        setTimeout(function(){ try{ showMsg('📅 累积登录 '+_n+'/7 天 · 再坚持一下就解锁纪念枪「长明」','#c9b489'); }catch(e){} },1600);
      }
    }
  }catch(e){}
  /* 【batch203】纪念枪：已拥有且上次装备过的，进局就恢复。
     不恢复的话每次进来都被打回普通步枪，这把枪等于"永远用不上"。
     只恢复纪念枪（槽位号固定 -1）—— 模组枪的号会随模组增删变化，恢复它有风险。 */
  var _恢复纪念=false;
  try{ _恢复纪念=!!(typeof 纪念拥有==='function'&&纪念拥有()&&localStorage.getItem('gunGame.memorial.equipped')==='1'); }catch(e){}
  curGun=(_恢复纪念&&typeof MEMORIAL_SLOT==='number')?MEMORIAL_SLOT:WEAPON_GUN;
  _rifleSnap=null;applyUpgrades();
  S.playing=true;S.over=false;S.paused=false;
  lockPointer();initAudio();
}
// 单人游戏
function startSoloGame(){
  // 【修复】开始游戏时主动让名字 / 身份码输入框失焦，避免输入焦点残留导致游戏内按键
  // （B、技能键）被输入框的 keydown 拦截而“按了没反应”。
  var __ni=document.getElementById('nameInput'); if(__ni&&document.activeElement===__ni)__ni.blur();
  var __ci=document.getElementById('codeInput'); if(__ci&&document.activeElement===__ci)__ci.blur();
  NET.enabled=false;NET.server='';       // 走单人路径：确保不联机
  NET.dead=false;
  enterGame();
  /* 【batch180】靶场：进图就告诉玩家这局是什么规则 */
  if(typeof rangeMode==='function'&&rangeMode()){
    try{showMsg('🎯 靶场：不刷敌人 · 弹药无限 · 技能无冷却','#ffd166');}catch(e){}
  }
  if(typeof rangeMode==='function'&&rangeMode()){ try{ curMapId='range'; }catch(_e){} }   /* 【batch180】靶场模式：强制进靶场这张独立的图 */
  setMap(curMapId,true);playerSpawnAt();      // 【batch111】按所选地图建图，并落到这张图的出生点
  /* 【batch180】退出重进要把两个特殊靶子补回来：靶场图懒构建（第二次 setMap 不会重建），
     而退出时 clearFieldData 把假人当 AI 敌人清掉了——不补就"退出重进靶子失效"。 */
  if(typeof rangeMode==='function'&&rangeMode()&&typeof rangeEnsureDummies==='function')rangeEnsureDummies();
  /* 【模组钩子 · batch166】玩法模式接管开局：给了 start() 就由它决定刷什么、怎么开始，
     不再走原版的"第一波刷怪"（大逃杀 / 回合制都不该一进图就刷波）。 */
  var _gms=curMode();
  if(_gms&&typeof _gms.start==='function'){try{_gms.start();return;}catch(e){}}
  if(S.wave===0)nextWave();
}
