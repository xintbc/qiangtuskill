/* 【1.12.0】搜打撤（Extraction）界面与模式框架（js/78_搜打撤_界面.js）====================
   阶段 1 只做「入口 + 双向切换 + 状态隔离」，**不含任何玩法内容**：
     · 主菜单「🧳 搜打撤行动」→ #raidPrep 准备层（部署 / 仓库 / 交易行 / 档案 四个占位页）
     · 准备层「← 返回原游戏」→ 关层回主菜单，**不刷新页面**
     · 清场 / 清状态挂在 js/60 的 clearFieldData() / resetRoundState() 尾部，供阶段 7 真局内使用

   ⚠️ 三条纪律（写在这里，免得以后踩）：
     ① 准备层阶段**绝不设 CUR_MODE** —— 一旦设了，主菜单的 updateWave() 就会去问 curMode().hud()，
        等于让"还没开局"的模式去接管对局 HUD。CUR_MODE 只在真进图时设（阶段 7）。
     ② 搜打撤**不新开第二条 WebSocket**：单人局走 NET.enabled=false，多人局复用现有 NET（阶段 8 接）。
     ③ #raidPrep 是独立于 #blocker 的全屏层，**必须登记进 js/22 的点击穿透白名单**，
        否则在准备层点一下空白会走到"左键＝开枪"分支，留下 mouseDown=true 的脏状态。
*/
var RAID_={
  on:false,          // 是否处于搜打撤（准备层也算在内）
  阶段:'idle',       // idle 空闲 / prep 准备层 / deploy 部署中 / in 局内 / result 结算
  对局中:false,      // 是否已经进了搜打撤的 3D 局（阶段 7 起才为真）
  页:'deploy'        // 准备层当前标签
};
window.RAID_=RAID_;

function 搜打撤_元素(id){ return document.getElementById(id); }

/* ==================== 准备层开关 ==================== */
function 搜打撤_准备层开(){
  var el=搜打撤_元素('raidPrep'); if(!el)return false;
  RAID_.on=true; RAID_.阶段='prep';
  el.classList.add('on');
  /* 进层前先松鼠标锁：指针锁着的时候点不到任何按钮（这也是 1.9.x 菜单类 bug 的老根因） */
  try{ if(document.exitPointerLock)document.exitPointerLock(); }catch(e){}
  try{ if(typeof closeGameMenu==='function')closeGameMenu(); }catch(e){}
  /* 【1.12.0 阶段 2】读档失败也绝不能挡住界面 —— RAID档() 内部有降级，
     外面再包一层 try 只是防"物品表没加载进来"这种更蠢的情况。 */
  try{ RAID读档(); }catch(e){ try{console.warn('[搜打撤] 读档失败',e);}catch(_e){} }
  搜打撤_切页(RAID_.页||'deploy');
  return true;
}
function 搜打撤_准备层关(){
  var el=搜打撤_元素('raidPrep'); if(el)el.classList.remove('on');
  RAID_.on=false;
  if(RAID_.阶段==='prep')RAID_.阶段='idle';
}

/* ==================== 双向切换 ====================
   入口探测：单文件版 / 精简客户端分发时可能没有"搜打撤"独立目录，
   直接 location.href 会跳到浏览器的"未找到文件"页。
   用一个零副作用的标记脚本探测文件是否存在（<script> 在 file:// 与 http:// 下都可靠，
   不像 XHR/fetch 会被 file:// 的 CORS 拦掉）。存在才跳转，不存在就明确提示并停下。 */
function 搜打撤_提示失败(文){
  try{ if(typeof showMsg==='function'){ showMsg(文,'#ff8e8e'); return; } }catch(e){}
  try{ alert(文); }catch(e){}
}
function 搜打撤_探测独立页(回调){
  var 标='搜打撤/独立模式存在标记.js?t='+Date.now();
  var s=document.createElement('script'), 完=false;
  function 收(果){ if(完)return; 完=true; try{s.remove();}catch(e){} 回调(果); }
  s.src=标; s.onload=function(){收(true);}; s.onerror=function(){收(false);};
  try{ document.head.appendChild(s); }catch(e){ 收(false); return; }
  setTimeout(function(){ 收(false); }, 2500);   /* 兜底：卡住也当文件缺失，别无限等 */
}
/* 探测通过才跳转；不通过时只提示，绝不 assignment location，避免触发文件读取 */
function 搜打撤_跳转独立页(){
  搜打撤_探测独立页(function(在){
    if(在){ try{ location.href='搜打撤/index.html'; }catch(e){} }
    else 搜打撤_提示失败('未找到搜打撤模式的文件，无法进入。请使用完整版（含「搜打撤」文件夹）或重新安装客户端。');
  });
}
function 搜打撤_进入准备(){
  /* 原版主菜单里的入口现在只做一件事：先确认独立页文件齐全，再跳到独立页面。
     独立页有自己的 HTML 和 JS，不加载英雄 / 技能 / 波次 —— 旧的"在原版框架里开个窗"
     就是玩家说的"进去了除了搜东西其他全是原版"，不再走那条路。 */
  if(!window.RAID_独立版){
    try{ if(S&&S.playing&&!S.over&&!window.confirm('当前对局还没结束。\n进入搜打撤会结束这一局，确定吗？'))return; }catch(e){}
    搜打撤_跳转独立页();
    return;
  }
  /* 正常路径：主菜单点按钮 → #blocker 是 home 态、S.playing 为假，直接开层。
     下面这段是兜底：万一以后有人在暂停菜单里加了入口，也不能把玩家一局游戏悄悄丢掉。 */
  if(typeof S!=='undefined'&&S&&S.playing&&!S.over){
    var 走=true;
    try{ 走=window.confirm('当前对局还没结束。\n进入搜打撤会结束这一局并回到主菜单，确定吗？'); }catch(e){ 走=false; }
    if(!走)return;
    /* quitToHome 末尾会整页刷新（项目既定行为，见 js/60 batch197 的说明），
       刷新后靠这个一次性标记自动回到准备层，保证"一步到位"不被打断。 */
    try{ sessionStorage.setItem('gunGame.raidAuto','1'); }catch(e){}
    if(typeof quitToHome==='function'){ quitToHome(); return; }
  }
  搜打撤_准备层开();
}

function 搜打撤_返回原游戏(){
  /* 独立版：没有"原游戏"这个全屏层可回，按钮直接带玩家回主菜单页面。 */
  if(window.RAID_独立版){ try{ location.href='../index.html'; }catch(e){} return; }
  if(RAID_.对局中){
    var 走=true;
    try{ 走=window.confirm('本局还没撤离。\n现在返回会丢失带入的装备与未带出的战利品，确定吗？'); }catch(e){ 走=false; }
    if(!走)return;
    搜打撤_清场(); 搜打撤_清状态();
  }
  搜打撤_准备层关();
  /* 回主菜单：这里**故意不调 quitToHome()** —— 它会整页刷新，而准备层阶段本来就没有 3D 局，
     没有任何东西需要靠刷新来清。真正的清场在阶段 7 由 搜打撤_清场() 负责。 */
  try{
    var bl=搜打撤_元素('blocker'); if(bl)bl.style.display='flex';
    if(typeof setMenuMode==='function')setMenuMode('home');
  }catch(e){}
  try{ if(typeof showMsg==='function')showMsg('已返回原游戏','#ffc75c'); }catch(e){}
}

/* ==================== 清场钩子（js/60 调用）====================
   两个函数都带「不在搜打撤就立刻返回」的守卫：
   原版对局退出时也会走 clearFieldData / resetRoundState，这里必须是**零副作用**的空操作。 */
function 搜打撤_清场(){
  if(!RAID_.对局中)return;
  /* 唯一清场入口：灰港场景 / 容器 / 撤离光柱 / HUD / 障碍与雾，全在 灰港_收场() 里还原。 */
  try{ 灰港_收场(); }catch(e){ try{console.warn('[搜打撤] 收场失败',e);}catch(_e){} }
  RAID_.对局中=false;
}
function 搜打撤_清状态(){
  if(!RAID_.on)return;
  RAID_.对局中=false;
  RAID_.阶段=(RAID_.on?'prep':'idle');
}

/* ==================== 准备层标签切换 ==================== */
function 搜打撤_切页(名){
  var 页表=['deploy','stash','market','profile'];
  if(页表.indexOf(名)<0)名='deploy';
  RAID_.页=名;
  var 根=搜打撤_元素('raidPrep'); if(!根)return;
  var tabs=根.querySelectorAll('.rpTab');
  for(var i=0;i<tabs.length;i++){
    if(tabs[i].getAttribute('data-rp')===名)tabs[i].classList.add('active');
    else tabs[i].classList.remove('active');
  }
  var panes=根.querySelectorAll('.rpPane');
  for(var j=0;j<panes.length;j++){
    if(panes[j].id==='rp-'+名)panes[j].classList.add('on');
    else panes[j].classList.remove('on');
  }
  /* 「出发」是卡片底部固定区，只在部署页出现 —— 仓库/交易行/档案页没有主行动按钮，
     留着它反而让人以为"在仓库里也能直接出发"。 */
  var 脚=搜打撤_元素('rpFoot');
  if(脚){ if(名==='deploy')脚.classList.remove('hide'); else 脚.classList.add('hide'); }
  /* 【1.12.0 阶段 2】切页时现渲染：仓库里的东西随时在变，缓存一份反而容易显示过期数据 */
  try{
    if(名==='deploy')搜打撤_刷部署();
    else if(名==='stash')搜打撤_刷仓库();
    else if(名==='profile')搜打撤_刷档案();
    else if(名==='market')搜打撤_刷交易行();
  }catch(e){ try{console.warn('[搜打撤] 渲染失败',e);}catch(_e){} }
}

/* ==================================================================
   阶段 2：仓库 / 物品网格界面
   ------------------------------------------------------------------
   一条硬规矩：**格子坐标 × 格宽 = 像素**，中间不做任何缩放换算。
   整个准备层在 #uiZoom 里（CSS zoom），所以「CSS 像素」本身就是被缩过的那套，
   物品的 left/top 用格坐标直接乘 40 就能对齐背景格子 —— 一旦在这里掺进
   window.innerWidth / dpr 之类的换算，就会出现"拖到哪都不对"的老问题。
   ================================================================== */
var 仓格=38;             /* 每格边长（CSS px），由 搜算格() 按窗口算，不写死 */
var RAID_选=null;        /* { 容:'stash'|'rig'|'bp'|'inner', u } */
var RAID_展开=null;      /* 详情面板里正展开的保险箱「件」（有 .内） */
var RAID_筛='全部';

/* 拖拽状态（阶段 2.5）。搜拖吞点 是一个时间戳：
   拖完松手时浏览器还会补一个 click，不吞掉的话会立刻把被拖的物品又"选中"一次，
   表现成"拖完东西跳回原处还高亮着"。 */
var 搜拖=null, 搜拖吞点=0;

/* 格子边长按「有效高度」算。
   为什么要算：整个准备层在 #uiZoom 里，zoom ≈ 窗口宽/1080。
   2340×1080（21:9 手机横屏）zoom 2.167，CSS 可用高只有 1080/2.167 ≈ 498，
   卡片正文只剩 341 —— 8 行固定 38 格 + 表头筛选工具条 = 420，一定溢出。
   16:9 的屏（有效高 ≈ 600）则塞得下 38。所以按高度反推，大屏不缩、超宽屏自动矮一档。
   公式来源：正文高 ≈ 有效高×0.94 − 127（头 + 页签），固定开销 265（表头/筛选/工具条/间距/
   内边距，实测值），要 8×rc + 265 ≤ 正文高 → rc ≤ (有效高×0.94 − 265) / 8。 */
function 搜算格(){
  var vw=window.innerWidth||1080, vh=window.innerHeight||600;
  var k=(vh>vw)?1:Math.max(0.5,Math.min(vw/1080,4));   /* 与 js/00 自动K 同口径 */
  var 有效高=vh/k;
  var rc=Math.round((有效高*0.94-265)/8);
  return Math.max(24,Math.min(38,rc||38));
}

var 搜筛表=['全部','变卖','弹药','医疗','投掷','枪','装备','任务'];

/* 「展开」记的是"我在翻哪个容器"（{容,u}），和"我选中了哪件"是两件事。
   阶段 2 把这两件事合成一个 RAID_展开=件 对象，结果选中别的物品就把打开的内层收掉了 ——
   玩家看到的正是"背包打开了却拖不进去"。现在拆开：展开只按 容+u 去查，选谁都不影响它。 */
function 搜展开件(){
  if(!RAID_展开)return null;
  var 容=搜打撤_取容器(RAID_展开.容);
  var it=容?RAID取件(容,RAID_展开.u):null;
  if(!it||!it.内){ RAID_展开=null; return null; }
  return it;
}
function 搜打撤_取容器(名){
  var s=RAID档();
  if(名==='stash')return s.仓库;
  if(名==='rig')return RAID预设胸挂();
  if(名==='bp')return RAID预设背包();
  if(名==='safe')return RAID安全箱();
  if(名==='inner'){ var it=搜展开件(); return it?it.内:null; }
  return null;
}

/* 筛选：装备＝胸挂/背包/保险三类合在一起 */
function 搜合筛(d){
  if(RAID_筛==='全部')return true;
  if(RAID_筛==='装备')return d.类==='胸挂'||d.类==='背包'||d.类==='保险'||d.类==='头盔'||d.类==='护甲';
  return d.类===RAID_筛;
}

function 搜提(t){
  try{ if(typeof showMsg==='function')showMsg(t,'#ff9a9a'); }catch(e){}
  var el=搜打撤_元素('rdTip'); if(el)el.textContent=t;
}

/* 画一个容器到某个根元素。名 就是点击时回传的容器键。 */
function 搜画网格(容器,根,名){
  if(!根)return;
  if(!容器){ 根.classList.add('off'); 根.innerHTML=''; return; }
  var g=RAID容器格(容器),W=g[0],H=g[1];
  if(!W||!H){ 根.classList.add('off'); 根.innerHTML=''; return; }
  根.classList.remove('off');
  根.setAttribute('data-k',名);        /* 拖拽落点靠它认容器，事件委托也要用 */
  根.style.width=(W*仓格)+'px'; 根.style.height=(H*仓格)+'px';
  根.style.gridTemplateColumns='repeat('+W+','+仓格+'px)';
  根.style.gridTemplateRows='repeat('+H+','+仓格+'px)';
  var html='',i;
  for(i=0;i<W*H;i++)html+='<div class="rdCell" data-c="'+名+'" data-i="'+i+'"></div>';
  var 件表=(容器&&容器.件)||[];
  for(i=0;i<件表.length;i++){
    var it=件表[i],d=RAID物品(it.id); if(!d)continue;
    var 稀=RAID_RARITY[d.稀有]||RAID_RARITY[0];
    var cls='rdItem';
    if(RAID_选&&RAID_选.u===it.u&&RAID_选.容===名)cls+=' sel';
    if(!搜合筛(d))cls+=' dim';
    html+='<div class="'+cls+'" data-c="'+名+'" data-u="'+it.u+'"'
      +' style="left:'+(it.x*仓格)+'px;top:'+(it.y*仓格)+'px;width:'+(d.格[0]*仓格)+'px;height:'+(d.格[1]*仓格)+'px">'
      +'<div class="rdItemIn" style="border-color:'+稀.边+'">'
      +'<span class="rdItemIcon">'+(window.RAID图标?RAID图标(it.id):'')+'</span>'
      +(it.n>1?'<span class="rdItemN">'+it.n+'</span>':'')
      +'</div></div>';
  }
  根.innerHTML=html;
}

function 搜格元信息(容器){
  if(!容器)return '未装备';
  var g=RAID容器格(容器),格=RAID容器格数(容器);
  return {
    格:格.用+'/'+格.共+' 格',
    重:RAID容器重(容器).toFixed(1)+'/'+(RAID容器载(容器)||'∞')+'kg',
    名:RAID容器名(容器)
  };
}

/* ==================== 选中 / 移动 ==================== */
function 搜选中(c,u){
  RAID_选={容:c,u:u};
  /* 这里**故意不动 RAID_展开**：翻着的背包要一直翻着，不然选一件战利品它就合上了，
     玩家永远没法"选中仓库里的东西 → 拖进刚打开的背包"。 */
  搜打撤_刷仓库();
}

function 搜点格(c,i){
  if(!RAID_选)return;
  var 目标=搜打撤_取容器(c),源=搜打撤_取容器(RAID_选.容);
  if(!目标||!源)return;
  var g=RAID容器格(目标),W=g[0]; if(!W)return;
  var x=i%W,y=(i/W)|0,u=RAID_选.u;
  var r=RAID移动(源,u,目标,x,y);
  /* 点的那一格放不下时，别直接报错 —— 这个容器里可能还有别处放得下。
     「点空格」这个动作的意图是"放进这个容器"，不是"必须落在这格"，所以退回自动找位。
     （拖拽不走这条：拖是瞄着放的，放不下就该说放不下。） */
  if(!r.ok&&/放不下|空间不足/.test(r.因)) r=RAID移动(源,u,目标);
  if(!r.ok){ 搜提(r.因); return; }
  RAID_选={容:c,u:u};
  if(!RAID写档())搜提('存档写入失败：这次移动可能不会被保存');
  搜打撤_刷仓库();
}

/* 快速转移：仓库↔背包，胸挂→仓库，保险内层→背包 */
function 搜快移(c,u){
  var 表={stash:'bp',rig:'stash',bp:'stash',inner:'bp',safe:'stash'};
  var 到键=表[c]||'stash';
  var 到=搜打撤_取容器(到键);
  if(!到&&到键==='bp'){ 到=搜打撤_取容器('rig'); 到键='rig'; }
  if(!到){
    var 名表={bp:'背包',rig:'胸挂',safe:'安全箱',stash:'仓库'};
    搜提('还没装备'+名表[到键]+'：去仓库把它拖到对应槽位上');
    return;
  }
  var 从=搜打撤_取容器(c); if(!从)return;
  var r=RAID移动(从,u,到);
  if(!r.ok){ 搜提(r.因); return; }
  RAID_选={容:到键,u:u};
  if(!RAID写档())搜提('存档写入失败：这次移动可能不会被保存');
  搜打撤_刷仓库();
}

function 搜拆堆(c,u){
  var 容=搜打撤_取容器(c); if(!容)return;
  var it=RAID取件(容,u); if(!it)return;
  var d=RAID物品(it.id);
  if(!d||d.叠<=1){ 搜提('这件不能拆分'); return; }
  var 总=it.n||1;
  if(总<=1){ 搜提('只有 1 个，拆不开'); return; }
  var 输=null;
  try{ 输=window.prompt('从这 '+总+' 个里拆出几个？',''+Math.ceil(总/2)); }catch(e){ 输=null; }
  if(输==null)return;
  var n=parseInt(输,10);
  if(!isFinite(n)){ 搜提('请输入数字'); return; }
  var r=RAID拆分(容,u,n);
  if(!r.ok){ 搜提(r.因); return; }
  if(!RAID写档())搜提('存档写入失败：这次拆分可能不会被保存');
  搜打撤_刷仓库();
}

/* ==================== 详情面板 ==================== */
function 搜画详情(){
  var 根=搜打撤_元素('rdDetail'); if(!根)return;
  /* 装备小槽已经搬到左栏、永远可见（以前"选中就藏"会让人以为头盔没了、也拖不进去） */
  仓格=搜算格();
  var 空='<div class="rdEmpty">选一件物品看详情<span>点物品选中 → 再点空格移动；也可以直接拖<br>双击＝快移到背包 / 仓库</span></div>';
  var 开件=搜展开件();          /* 先取，渲染时不管选中是谁 */
  var it=null,容=null;
  if(RAID_选){ 容=搜打撤_取容器(RAID_选.容); it=容?RAID取件(容,RAID_选.u):null; }
  if(!it&&!开件){ RAID_选=null; 根.innerHTML=空; return; }
  if(!it&&开件){ 根.innerHTML=空+'<div id="rdOpenHost"></div>'; 挂内层(根,开件); return; }

  var d=RAID物品(it.id);
  if(!d){ 根.innerHTML=空; return; }
  var 稀=RAID_RARITY[d.稀有]||RAID_RARITY[0];
  var n=it.n||1;
  var html='';
  html+='<div class="rdDetT"><span class="rdDetIcon">'+(window.RAID图标?RAID图标(it.id):'')+'</span>'+d.名
    +'<em style="color:'+稀.色+';background:'+稀.边.replace(/[\d.]+\)$/,'.16)')+'">'+稀.名+'</em></div>';
  html+='<div class="rdDetRow"><span>数量</span><b>'+n+(d.叠>1?' / 堆叠上限 '+d.叠:'')+'</b></div>';
  if(n>1)html+='<div class="rdDetRow"><span>单重</span><b>'+d.重.toFixed(2)+' kg</b></div>';   /* 只有一件时和总重重复，省一行 */
  html+='<div class="rdDetRow"><span>总重</span><b>'+RAID件重(it).toFixed(2)+' kg</b></div>';
  if(d.价>0){
    html+='<div class="rdDetRow"><span>回收价</span><b>'+d.价.toLocaleString()+' / 件'
      +(d.务?' <i class="rdNoSell">任务物，不可出售</i>':'')+'</b></div>';
    html+='<div class="rdDetRow"><span>小计</span><b>'+(d.价*n).toLocaleString()+' 封锁币</b></div>';
  }else{
    html+='<div class="rdDetRow"><span>回收价</span><b>'+(d.类==='头盔'||d.类==='护甲'?'角色自带，不可出售':'不可出售')+'</b></div>';
  }
  html+='<div class="rdDetRow"><span>占格</span><b>'+d.格[0]+' × '+d.格[1]+'</b></div>';
  if(d.容)html+='<div class="rdDetRow"><span>容量</span><b>'+d.容[0]+'×'+d.容[1]+' · '+d.载+'kg</b></div>';
  if(d.收)html+='<div class="rdDetRow"><span>只收</span><b>'+d.收.join(' / ')+'</b></div>';
  if(d.口径)html+='<div class="rdDetRow"><span>口径</span><b>'+d.口径+'</b></div>';

  var 说=d.描||'';
  if(!说){
    if(d.类==='变卖')说='封锁区里翻出来的东西。带出去按回收价卖给收货人，或者挂交易行等更好的价。';
    else if(d.类==='弹药')说='按发消耗，占背包重量。同口径才能装进对应的枪。';
    else if(d.类==='枪')说='武器本体。死了没保险就没了 —— 这是搜打撤最疼的一课。';
    else if(d.类==='任务')说='任务关键物。不能卖，死了必掉（除非放进保险）。';
  }
  /* 说明文字放到按钮之后：详情面板高度有限，按钮是"要做的事"，
     不能因为一段风味文字被挤到滚动区外面去（卖东西找不到按钮是最烦的）。 */
  /* 操作按钮：目标容器与当前相同时禁用，避免"移了个寂寞" */
  var c=RAID_选.容;
  html+='<div class="rdDetActs">';
  /* 装备类：在仓库里就能穿上（这是"装备要自己买/自己带"的入口） */
  var 可穿=(c==='stash'&&['胸挂','背包','头盔','护甲','保险','枪'].indexOf(d.类)>=0);
  if(可穿)html+='<button class="rdBtn rdBtnWarm" data-act="equip">穿上</button>';
  html+='<button class="rdBtn" data-act="to-stash"'+(c==='stash'?' disabled':'')+'>移入仓库</button>';
  html+='<button class="rdBtn" data-act="to-bp"'+(c==='bp'||!RAID预设背包()?' disabled':'')+'>移入背包</button>';
  html+='<button class="rdBtn" data-act="to-rig"'+(c==='rig'||!RAID预设胸挂()?' disabled':'')+'>移入胸挂</button>';
  html+='<button class="rdBtn" data-act="to-safe"'+(c==='safe'||!RAID安全箱()?' disabled':'')+'>移入安全箱</button>';
  if(d.价>0&&!d.务&&d.类!=='任务'){
    html+='<button class="rdBtn rdBtnSell" data-act="sell">卖出 +'+(d.价*n).toLocaleString()+'</button>';
  }
  html+='<button class="rdBtn" data-act="split"'+(d.叠<=1||n<=1?' disabled':'')+'>拆分</button>';
  html+='</div>';
  if(说)html+='<div class="rdDetD">'+说+'</div>';

  /* 容器：按钮跟着「展开」走，不只是跟着当前选中走 */
  if(d.容){
    var 开=(RAID_展开&&RAID_展开.u===it.u&&RAID_展开.容===RAID_选.容);
    html+='<div class="rdInnerWrap"><div class="rdInnerT">内层 '+d.容[0]+'×'+d.容[1]
      +'<span>'+RAID容器重(it.内).toFixed(1)+'/'+d.载+'kg</span></div>'
      +'<div class="rdDetActs"><button class="rdBtn" data-act="toggle-inner">'+(开?'收起内层':'打开内层')+'</button>'
      +'</div></div>';
  }
  根.innerHTML=html;
  挂内层(根,开件);
}

/* 把「正在打开」的内层网格挂到详情面板底部。
   单独抽出来是因为它**不属于某一次选中**：选中换了、甚至取消选中，只要没点收起，
   这个网格就得在原地，玩家才能接着往里拖东西。 */
function 挂内层(根,件){
  if(!件||!根)return;
  var d=RAID物品(件.id); if(!d)return;
  var 区=document.createElement('div');
  区.className='rdInnerWrap';
  区.innerHTML='<div class="rdInnerT">▾ 正在打开：'+d.名
    +'<span>'+RAID容器重(件.内).toFixed(1)+'/'+(d.载||'∞')+'kg</span></div>'
    +'<div class="rdDetActs"><button class="rdBtn" data-act="close-inner">收起</button>'
    +'<button class="rdBtn" data-act="sort-inner">整理</button></div>'
    +'<div class="rdGridWrap" style="margin-top:8px"><div class="rdGrid" id="rdInnerGrid"></div></div>';
  /* 挂在**最上面**：右栏现在上面是安全箱、下面是详情，内层如果接在详情末尾，
     在 1600×900 这种屏上会被顶到可视区之外，玩家得先滚一下才看得到格子。
     "正在打开的箱子"才是当下要用的东西，放最前面更合理。 */
  根.insertBefore(区,根.firstChild);
  var ig=搜打撤_元素('rdInnerGrid');
  搜画网格(件.内,ig,'inner');
  try{ if(区.scrollIntoView)区.scrollIntoView({block:'nearest'}); }catch(_e){}
  /* 这里是**动态生成**的网格，不绑定的话点了没反应、也拖不动 ——
     阶段 2.5 重写时漏了这一行，表现就是"打开背包但东西放不进去"。 */
  搜绑网格(ig);
}

/* ==================== 整页渲染 ==================== */
function 搜打撤_刷仓库(){
  var s=RAID档();
  var 仓=s.仓库,挂=RAID预设胸挂(),包=RAID预设背包();
  仓格=搜算格();          /* 每次渲染前重算：转屏 / 拉窗口都会走这里 */

  var 筛根=搜打撤_元素('rdFilters');
  if(筛根&&!筛根.__建){
    筛根.__建=1;
    var h='';
    for(var i=0;i<搜筛表.length;i++)h+='<button class="rdF'+(搜筛表[i]===RAID_筛?' on':'')+'" data-f="'+搜筛表[i]+'">'+搜筛表[i]+'</button>';
    筛根.innerHTML=h;
  }else if(筛根){
    var fs=筛根.querySelectorAll('.rdF');
    for(var k=0;k<fs.length;k++){
      if(fs[k].getAttribute('data-f')===RAID_筛)fs[k].classList.add('on');
      else fs[k].classList.remove('on');
    }
  }

  var 箱=RAID安全箱(), 盔=RAID头盔(), 甲=RAID护甲();
  搜画网格(仓,搜打撤_元素('rdStashGrid'),'stash');

  /* ---- 装备槽：有货就画容量网格，没货就摆一块"空槽"（能接拖拽） ---- */
  function 刷槽(键, 件, 网格id, 名id, 元id, 图id, 网格键){
    var 槽=document.querySelector('#raidPrep .rdSlot[data-slot="'+键+'"]');
    var 有=!!件;
    if(槽)槽.classList.toggle('空',!有);
    var g=搜打撤_元素(网格id);
    if(有&&网格键)搜画网格(件,g,网格键);
    else if(g){ g.classList.add('off'); g.innerHTML=''; }
    var 名=搜打撤_元素(名id), 元=搜打撤_元素(元id);
    if(名)名.textContent = 有 ? (件.名||RAID容器名(件)) : 键;
    if(元){
      if(!有)元.textContent='未装备';
      else if(网格键){ var a=搜格元信息(件); 元.textContent=a.格+' · '+a.重; }
      else { var 稀=RAID_RARITY[件.稀有]||RAID_RARITY[0]; 元.textContent=稀.名; }   /* 别再重复一遍名字 */
    }
    var 图=搜打撤_元素(图id);
    if(图)图.innerHTML=(有&&件.id&&window.RAID图标)?RAID图标(件.id):'';
  }
  刷槽('胸挂',挂,'rdRigGrid','rdRigName','rdRigMeta','rdRigIco','rig');
  刷槽('背包',包,'rdBpGrid','rdBpName','rdBpMeta','rdBpIco','bp');
  刷槽('安全箱',箱,'rdSafeGrid','rdSafeName','rdSafeMeta','rdSafeIco','safe');
  刷槽('头盔',盔,'','rdHelmName','rdHelmMeta','rdHelmIco','');
  刷槽('护甲',甲,'','rdArmorName','rdArmorMeta','rdArmorIco','');
  /* 两个武器槽：枪没有内层，所以只显示名字/口径 */
  for(var wi=0;wi<2;wi++){
    var 枪=RAID枪械(wi);
    var 槽w=document.querySelector('#raidPrep .rdSlot[data-slot="'+(wi?'枪2':'枪')+'"]');
    if(槽w)槽w.classList.toggle('空',!枪);
    var nw=搜打撤_元素('rdGunName'+(wi?'1':'0')), mw=搜打撤_元素('rdGunMeta'+(wi?'1':'0'));
    var iw=搜打撤_元素('rdGunIco'+(wi?'1':'0'));
    if(nw)nw.textContent=枪?枪.名:(wi?'副武器':'主武器');
    if(mw)mw.textContent=枪?(枪.口径||'')+' · '+(RAID_GUNS[枪.id]?(RAID_GUNS[枪.id].弹匣+' 发'):''):'未装备';
    if(iw)iw.innerHTML=枪&&window.RAID图标?RAID图标(枪.id):'';
  }

  var 仓元=搜格元信息(仓);
  var 币=搜打撤_元素('rdCoin'); if(币)币.textContent='🪙 '+(s.币|0).toLocaleString()+' 封锁币';
  var 仓名=搜打撤_元素('rdStashMeta');
  if(仓名)仓名.innerHTML=仓元.格+' · <b>'+仓元.重+'</b> · 总值 <b>'+RAID容器价(仓).toLocaleString()+'</b>';

  var 箱钮=搜打撤_元素('rdSafePick2');
  if(箱钮)箱钮.textContent=箱?'换安全箱':'选择安全箱';

  搜画详情();
}

function 搜打撤_刷部署(){
  var s=RAID档(),根=搜打撤_元素('rdPresets'),i;
  /* 预设只决定"带哪把枪、多少弹"。装备是角色自带的，不在这里选 —— 见 js/74 的 RAID_BUILTIN */
  if(根){
    var html='';
    for(i=0;i<s.预设.length;i++){
      var p=s.预设[i],枪名=[],弹名=[],k;
      for(k=0;k<p.枪.length;k++){ var dg=RAID物品(p.枪[k]); if(dg)枪名.push(dg.名); }
      for(k=0;k<p.弹.length;k++){ var da=RAID物品(p.弹[k][0]); if(da)弹名.push(da.名+'×'+p.弹[k][1]); }
      html+='<button class="rdPre'+(i===s.当前预设?' on':'')+'" data-p="'+i+'">'
        +'<b>'+p.名+'</b><span>'+(p.说明||'')+'</span>'
        +'<i>'+(枪名.join('、')||'空手')+(弹名.length?' · '+弹名.join('、'):' · 无弹')+'</i></button>';
    }
    根.innerHTML=html;
  }

  /* 自带装备：只读展示。四个格子都不给点，避免又变成"部署页选装备" */
  var 装根=搜打撤_元素('rdDeployGear');
  if(装根){
    var 表=[['主武器',(s.装备.枪&&s.装备.枪[0])||''],['副武器',(s.装备.枪&&s.装备.枪[1])||''],
            ['胸挂',(s.装备.胸挂&&s.装备.胸挂.id)||''],['背包',(s.装备.背包&&s.装备.背包.id)||''],
            ['头盔',s.装备.头盔||''],['护甲',s.装备.护甲||''],
            ['安全箱',(s.安全箱&&s.安全箱.id)||'']];
    var gh='';
    for(i=0;i<表.length;i++){
      var dd=RAID物品(表[i][1]);
      gh+='<div class="rdGearI'+(dd?'':' off')+'"><span class="rdGearIco">'+(表[i][1]&&window.RAID图标?RAID图标(表[i][1]):'')+'</span>'
        +'<i>'+表[i][0]+'</i><b>'+(dd?dd.名:'未装备')+'</b></div>';
    }
    装根.innerHTML=gh;
  }

  var 挂=RAID预设胸挂(),包=RAID预设背包(),箱=RAID安全箱();
  var 总重=0,枪名=[],i2;
  /* 武器来自两个武器槽（仓库里装的），弹来自身上容器里实际带的 */
  for(i2=0;i2<2;i2++){
    var 枪2=RAID枪械(i2);
    if(枪2){ 总重+=枪2.重; 枪名.push(枪2.名); }
  }
  var 弹数=0;
  [挂,包,箱].forEach(function(c){
    if(!c)return;
    var 表=RAID摊平清点(c,'带入',false,[]);
    表.forEach(function(x){ var d=RAID物品(x.件.id); if(d&&d.类==='弹药')弹数+=x.件.n||1; });
  });
  if(挂)总重+=RAID容器重(挂);
  if(包)总重+=RAID容器重(包);
  if(箱)总重+=RAID容器重(箱);
  var p2=s.预设[s.当前预设];

  var 汇总=搜打撤_元素('rdDeploySum');
  if(汇总&&p2){
    var 挂格=挂?RAID容器格数(挂):null,包格=包?RAID容器格数(包):null,箱格=箱?RAID容器格数(箱):null;
    汇总.innerHTML='<div class="rdSumT">🧾 本次携带</div>'
      +'<div class="rdDetRow"><span>武器</span><b>'+(枪名.length?枪名.join('、'):'空手')+'</b></div>'
      +'<div class="rdDetRow"><span>弹药</span><b>'+(弹数?弹数+' 发':'无')+'</b></div>'
      +'<div class="rdDetRow"><span>胸挂</span><b>'+(挂?挂格.用+'/'+挂格.共+' 格':'未装备')+'</b></div>'
      +'<div class="rdDetRow"><span>背包</span><b>'+(包?包格.用+'/'+包格.共+' 格':'未装备')+'</b></div>'
      +'<div class="rdDetRow"><span>安全箱</span><b>'+(箱?箱格.用+'/'+箱格.共+' 格':'不带')+'</b></div>'
      +'<div class="rdDetRow"><span>合计重量</span><b>'+总重.toFixed(1)+' kg</b></div>';
  }

  var 清单=搜打撤_元素('rdInsList');
  if(清单){
    /* 只列「占 / 保 / 限制」，说明文字留到窗口里再说。
       早先每条都带一段描，六条摞起来 500px，把底下的「出发」直接顶出可视区。 */
    var h2='<div class="rdInsT" style="color:#ffd88a;padding-left:2px;margin-bottom:2px">🛡 六种保险</div>';
    for(i2=0;i2<RAID_INSURANCE.length;i2++){
      var z=RAID_INSURANCE[i2];
      h2+='<div class="rdIns"><div class="rdInsT">'+z.名+'<em>'+(z.价|0).toLocaleString()+'</em></div>'
        +'<div class="rdInsD">占 '+z.占+' ｜ 保 '+z.保+' ｜ '+z.限+'</div></div>';
    }
    清单.innerHTML=h2;
  }

  var 保=搜打撤_元素('rdDeploySafe');
  if(保){
    var 解锁=false; try{ 解锁=RAID赛季解锁(); }catch(e){}
    if(!解锁){
      var 进={撤离:0,情报:0}; try{ 进=RAID赛季进度(); }catch(e){}
      var 需=(typeof RAID赛季任务!=='undefined')?RAID赛季任务.需:{撤离:1,情报:2};
      保.innerHTML='<span style="color:#ff9a9a">🔒 未解锁</span>'
        +'<small style="display:block;font-size:10px;color:#8ea1b2;font-weight:400">赛季任务：撤离 '
        +(进.撤离|0)+'/'+需.撤离+' · 情报 '+(进.情报|0)+'/'+需.情报+'</small>';
    } else 保.textContent=箱?RAID容器名(箱):'不带';
  }
  var 安选=搜打撤_元素('rdSafePick2');
  if(安选){
    var 已=false; try{ 已=RAID赛季解锁(); }catch(e){}
    安选.disabled=!已;
    安选.title=已?'':'完成赛季任务「灰港封锁令」后解锁';
  }
}

/* ==================== 交易行（阶段 3.6）====================
   只卖七类：枪械 / 胸挂 / 背包 / 护甲 / 头盔 / 弹药 / 医药。
   买入价＝回收价 ×2，所以"买了再卖"永远亏，不会被刷钱。 */
var RAID_买类 = '全部';
var RAID_买类表 = ['全部', '枪', '胸挂', '背包', '护甲', '头盔', '弹药', '医疗'];

function 搜打撤_刷交易行(){
  var 根 = 搜打撤_元素('rdMkList'); if (!根) return;
  var s = RAID档();
  var 币 = 搜打撤_元素('rdMkCoin');
  if (币) 币.textContent = '🪙 ' + (s.币 | 0).toLocaleString() + ' 封锁币';

  var 筛 = 搜打撤_元素('rdMkFilters');
  if (筛) {
    var fh = '', i;
    for (i = 0; i < RAID_买类表.length; i++) {
      var 类 = RAID_买类表[i];
      fh += '<button class="rdF' + (类 === RAID_买类 ? ' on' : '') + '" data-mk="' + 类 + '">' + 类 + '</button>';
    }
    筛.innerHTML = fh;
  }

  var 表 = [], k;
  for (k in RAID_ITEMS) {
    var d0 = RAID_ITEMS[k];
    if (!d0 || !RAID可买(k)) continue;
    if (RAID_买类 !== '全部' && d0.类 !== RAID_买类) continue;
    表.push(k);
  }
  表.sort(function (a, b) {
    var da = RAID物品(a), db = RAID物品(b);
    if (da.类 !== db.类) return RAID_买类表.indexOf(da.类) - RAID_买类表.indexOf(db.类);
    return RAID买价(a) - RAID买价(b);
  });

  if (!表.length) { 根.innerHTML = '<div class="rdMkEmpty">这一类没有在售的东西</div>'; return; }
  var h = '', 币数 = s.币 | 0;
  for (var j = 0; j < 表.length; j++) {
    var id = 表[j], d = RAID物品(id), 单价 = RAID买价(id);
    var 组 = 1;
    if (d.类 === '弹药') 组 = 20;
    else if (d.叠 > 1) 组 = Math.min(5, d.叠);
    var 够1 = 币数 >= 单价, 够组 = 币数 >= 单价 * 组;
    h += '<div class="rdMkCard">'
      + '<span class="rdMkIco">' + (window.RAID图标 ? RAID图标(id) : '') + '</span>'
      + '<div class="rdMkInfo"><b>' + d.名 + '</b><i>' + d.类
      + (d.类 === '弹药' ? ' · ' + (d.口径 || '') : '') + ' · ' + (RAID_RARITY[d.稀有] || RAID_RARITY[0]).名 + '</i></div>'
      + '<span class="rdMkPrice">🪙 ' + 单价.toLocaleString() + '</span>'
      + '<button class="rdBtn" data-buy="' + id + '" data-n="1"' + (够1 ? '' : ' disabled') + '>买</button>'
      + (组 > 1 ? '<button class="rdBtn" data-buy="' + id + '" data-n="' + 组 + '"' + (够组 ? '' : ' disabled') + '>×' + 组 + '</button>' : '')
      + '</div>';
  }
  根.innerHTML = h;
}

/* ==================== 安全箱选择窗口 ====================
   玩家自己挑带哪个箱子。这里不卖东西（阶段 9 交易行才管买卖），只做"带 / 不带"。
   换箱有硬条件：箱子里还有东西不许换（否则那些保底物会凭空消失）。 */
function 搜开安全箱窗(){
  var 窗=搜打撤_元素('rdSafeWin'),列=搜打撤_元素('rdSafeList');
  if(!窗||!列)return;
  var s=RAID档(),当=(s.安全箱&&s.安全箱.id)?s.安全箱.id:'';
  /* 仓库里有的才算：没买过的箱子是灰的，点不动，并写明去哪弄 */
  var 拥有={};
  RAID仓里有('保险').forEach(function(it){ 拥有[it.id]=(拥有[it.id]||0)+1; });
  var h='<button class="rdSafeOpt'+(当===''?' on':'')+'" data-safe="">'
    +'<b>不带安全箱<em>—</em></b><span>不带就不保底。死了箱子里的东西当然也没有。</span></button>';
  for(var i=0;i<RAID_INSURANCE.length;i++){
    var z=RAID_INSURANCE[i];
    if(z.类型!=='物品')continue;          /* 战后回收凭证不是容器，不进这个窗口 */
    var d=RAID物品(z.id); if(!d||!d.容)continue;
    var n=拥有[z.id]||0, 是当前=(当===z.id);
    /* 已经穿在身上的那档要写"已装备"：它已经从仓库里扣掉了，
       还写"未拥有"会让人以为自己的箱子没了。 */
    var 可用=(n>0||是当前);
    h+='<button class="rdSafeOpt'+(是当前?' on':'')+(可用?'':' off')+'" data-safe="'+z.id+'"'+(可用?'':' disabled')+'>'
      +'<b><span class="rdSafeIco">'+(window.RAID图标?RAID图标(z.id):'')+'</span>'+z.名
      +'<em>'+(是当前?'已装备':(n?('仓库 '+n):'未拥有'))+'</em></b>'
      +'<span>容量 '+d.容[0]+'×'+d.容[1]+' · 载 '+d.载+'kg<br>'
      +(是当前?'正在使用':(n?(z.限||'无限制'):'仓库里没有，去交易行买或去封锁区捡'))+'</span></button>';
  }
  列.innerHTML=h;
  窗.classList.add('on');
}
function 搜关安全箱窗(){ var w=搜打撤_元素('rdSafeWin'); if(w)w.classList.remove('on'); }

function 搜打撤_刷档案(){
  var s=RAID档();
  function 置(id,v){ var e=搜打撤_元素(id); if(e)e.textContent=v; }
  置('rdPfCoin',(s.币|0).toLocaleString());
  置('rdPfItems',RAID容器件数(s.仓库));
  置('rdPfValue',RAID容器价(s.仓库).toLocaleString());
  置('rdPfVoucher',s.保险.凭证|0);
  var 文=搜打撤_元素('rdPfText');
  if(!文)return;
  var 自检=null;
  try{ 自检=RAID底座自检(); }catch(e){}
  var 行=[];
  行.push('仓库 '+RAID容器格(s.仓库)[0]+'×'+RAID容器格(s.仓库)[1]+'，装载 '+RAID容器重(s.仓库).toFixed(1)+'kg');
  行.push('当前预设：'+(RAID当前预设()||{}).名);
  行.push('自带装备：'+(RAID容器名(RAID预设胸挂())||'—')+' / '+(RAID容器名(RAID预设背包())||'—')
    +' / '+(RAID头盔()?RAID头盔().名:'—')+' / '+(RAID护甲()?RAID护甲().名:'—'));
  行.push('安全箱：'+(RAID安全箱()?RAID容器名(RAID安全箱()):'不带'));
  if(s.迁移.丢弃)行.push('<b style="color:#ff9a9a">旧存档里有 '+s.迁移.丢弃+' 件无法识别，已丢弃</b>');
  if(RAID_档错误)行.push('<b style="color:#ff9a9a">'+RAID_档错误+'</b>');
  行.push('物品定义 '+Object.keys(RAID_ITEMS).length+' 种 · 保险 '+RAID_INSURANCE.length+' 种');
  if(自检)行.push('底座自检 <b style="color:'+(自检.全过?'#8ce0a0':'#ff9a9a')+'">'+自检.过+'/'+自检.总+'</b>'
    +(自检.全过?'':'：'+自检.报.filter(function(x){return !x.过;}).map(function(x){return x.名;}).join('、')));
  行.push('阶段 7 开放：局数 / 撤离 / 死亡 / 带出总值 / 剧情进度');
  文.innerHTML=行.join('<br>');
}

/* ==================== 拖拽（阶段 2.5）====================
   为什么自己写而不用 HTML5 拖放：dragstart/dragover 在触屏上根本不触发，
   而且被拖的那张"影子"是浏览器画的，样式改不了。这里用 Pointer Events，
   鼠标和手指走同一套逻辑，影子是自己画的 DOM，能显示物品图标。
   ⚠️ 影子必须挂在 document.body 上：准备层在 #uiZoom 里（CSS zoom），
      fixed 元素如果留在里面会被 zoom 一起放大，指针就对不上了。 */
function 搜格在点(px,py){
  var el=document.elementFromPoint(px,py);
  if(!el||!el.closest)return null;
  var gd=el.closest('.rdGrid'); if(!gd)return null;
  var 名=gd.getAttribute('data-k'); if(!名)return null;
  var 容器=搜打撤_取容器(名); if(!容器)return null;
  var g=RAID容器格(容器),W=g[0],H=g[1]; if(!W||!H)return null;
  /* 落在某件物品上：直接用它自己的格坐标。
     别用像素反算 —— 网格有 padding/border 时算出来的格子会偏，
     拖到另一堆上会被判成"落在旁边空格"，于是该合并的变成了换位。 */
  var 件块=el.closest('.rdItem');
  if(件块){
    var uu=件块.getAttribute('data-u');
    var it=uu?RAID取件(容器,uu):null;
    if(it)return {根:gd,名:名,容器:容器,W:W,H:H,x:it.x,y:it.y,i:it.y*W+it.x,件:it};
  }
  var r=gd.getBoundingClientRect(); if(!r.width)return null;
  /* 视觉倍率：rect 是缩放后的尺寸，仓格 是布局尺寸，两者一除就是当前 zoom */
  var k=r.width/(W*仓格); if(!(k>0))return null;
  var cx=Math.floor((px-r.left)/(仓格*k)),cy=Math.floor((py-r.top)/(仓格*k));
  if(cx<0||cy<0||cx>=W||cy>=H)return null;
  return {根:gd,名:名,容器:容器,W:W,H:H,x:cx,y:cy,i:cy*W+cx};
}
function 搜清高亮(){
  var a=document.querySelectorAll('#raidPrep .rdCell.hot');
  for(var i=0;i<a.length;i++)a[i].classList.remove('hot');
}
function 搜亮目标(落,格){
  if(!落||!格)return;
  var w=格[0],h=格[1],W=落.W,H=落.H,x,y;
  for(y=落.y;y<落.y+h&&y<H;y++)for(x=落.x;x<落.x+w&&x<W;x++){
    var c=落.根.querySelector('.rdCell[data-i="'+(y*W+x)+'"]');
    if(c)c.classList.add('hot');
  }
}
function 搜拖影建(){
  if(!搜拖||!搜拖.件)return null;
  if(搜拖.影)return 搜拖.影;
  var 影=document.createElement('div');
  影.className='rdGhost';
  影.innerHTML=(window.RAID图标?RAID图标(搜拖.件.id):'')||'';
  document.body.appendChild(影);
  搜拖.影=影;
  return 影;
}
function 搜拖按下(e){
  if(e.button&&e.button!==0)return;
  var t=e.target; if(!t||!t.closest)return;
  /* 按在装备槽上：把身上那件拖出来（拖到格子里＝卸下并放进那个容器） */
  var 槽块=t.closest('.rdSlot');
  if(槽块&&!t.closest('.rdGrid')){
    var 键0=槽块.getAttribute('data-slot');
    if(键0==='枪'||键0==='枪2'){
      /* 武器槽存的是一个数组（[主,副]），不走 RAID槽件，直接按序号取 */
      var 序=(键0==='枪2')?1:0, 枪=RAID枪械(序);
      if(枪){
        搜拖={槽:'枪',槽序:序,件:{id:枪.id,n:1},u:null,x0:e.clientX,y0:e.clientY,动:false,影:null,目标:null};
        return;
      }
    }else{
      var 旧=RAID槽件(键0);
      if(旧){
        搜拖={槽:键0,槽序:0,件:{id:旧.id,n:1},u:null,x0:e.clientX,y0:e.clientY,动:false,影:null,目标:null};
        return;
      }
    }
  }
  var item=t.closest('.rdItem'); if(!item)return;
  var 名=item.getAttribute('data-c'),u=item.getAttribute('data-u');
  var 容=搜打撤_取容器(名); if(!容)return;
  var 件=RAID取件(容,u); if(!件)return;
  搜拖={容:名,u:u,件:件,x0:e.clientX,y0:e.clientY,动:false,影:null,目标:null};
}
function 搜拖移动(e){
  if(!搜拖||!搜拖.件)return;
  var dx=e.clientX-搜拖.x0,dy=e.clientY-搜拖.y0;
  if(!搜拖.动&&(dx*dx+dy*dy)<40)return;
  if(!搜拖.动){ 搜拖.动=true; try{ document.body.classList.add('rdDragging'); }catch(_e){} }
  try{ if(e.cancelable)e.preventDefault(); }catch(_e){}
  var 影=搜拖影建();
  影.style.left=e.clientX+'px'; 影.style.top=e.clientY+'px';
  var 落=搜格在点(e.clientX,e.clientY);
  搜清高亮();
  if(落)搜亮目标(落,(RAID物品(搜拖.件.id)||{格:[1,1]}).格);
  搜拖.目标=落;
}
function 搜拖松开(e){
  if(!搜拖)return;
  var d=搜拖; 搜拖=null;
  try{ document.body.classList.remove('rdDragging'); }catch(_e){}
  if(d.影){ try{ d.影.parentNode.removeChild(d.影); }catch(_e){} }
  搜清高亮();
  if(!d.动)return;                 /* 没动＝普通点击，交给 click 去选中 */
  搜拖吞点=Date.now();
  var 落=搜格在点(e.clientX,e.clientY);
  if(d.槽){
    /* 从装备槽拖到格子：先卸下（回仓库），再把这件挪进目标容器 */
    if(!落)return;
    var r0=(d.槽==='枪')?RAID脱枪(d.槽序||0):RAID脱(d.槽);
    if(!r0.ok){ 搜提(r0.因); return; }
    var r1=RAID移动(RAID档().仓库, r0.件.u, 落.容器, 落.x, 落.y);
    if(!r1.ok){ 搜提('放不下（'+r1.因+'），已放回仓库'); }
    RAID_选=null;
    RAID写档();
    搜打撤_刷仓库(); 搜打撤_刷部署();
    return;
  }
  if(!落){
    /* 没落在格子上：看看是不是落在装备槽上 —— 拖装备上去就是"穿上" */
    var el=document.elementFromPoint(e.clientX,e.clientY);
    var 槽=el&&el.closest?el.closest('.rdSlot'):null;
    if(槽&&d.件){
      var 键=槽.getAttribute('data-slot');
      var r2=(键==='枪2')?RAID穿枪(d.件.id):RAID穿(键,d.件.id);
      if(!r2.ok){ 搜提(r2.因); return; }
      RAID写档();
      RAID_选=null;
      搜打撤_刷仓库(); 搜打撤_刷部署();
      搜提('已装备 '+RAID件名(d.件));
    }
    return;                   /* 丢在空白处＝取消 */
  }
  var 源=搜打撤_取容器(d.容);
  if(!源)return;
  var r=RAID移动(源,d.u,落.容器,落.x,落.y);
  if(!r.ok){ 搜提(r.因); return; }
  RAID_选={容:落.名,u:d.u};
  if(!RAID写档())搜提('存档写入失败：这次移动可能不会被保存');
  搜打撤_刷仓库();
}
function 搜拖取消(){
  if(!搜拖)return;
  if(搜拖.影){ try{ 搜拖.影.parentNode.removeChild(搜拖.影); }catch(_e){} }
  搜拖=null;
  try{ document.body.classList.remove('rdDragging'); }catch(_e){}
  搜清高亮();
}

/* ==================== 网格事件（委托，只绑一次）==================== */
function 搜绑网格(根){
  if(!根||根.__绑)return;
  根.__绑=1;
  根.addEventListener('pointerdown',搜拖按下);
  根.addEventListener('click',function(e){
    if(Date.now()-搜拖吞点<350)return;      /* 刚拖完，这次 click 是浏览器补的 */
    var t=e.target;
    var item=(t&&t.closest)?t.closest('.rdItem'):null;
    if(item){ 搜选中(item.getAttribute('data-c'),item.getAttribute('data-u')); return; }
    var cell=(t&&t.closest)?t.closest('.rdCell'):null;
    if(cell)搜点格(cell.getAttribute('data-c'),parseInt(cell.getAttribute('data-i'),10));
  });
  根.addEventListener('dblclick',function(e){
    var t=e.target;
    var item=(t&&t.closest)?t.closest('.rdItem'):null;
    if(item)搜快移(item.getAttribute('data-c'),item.getAttribute('data-u'));
  });
}

(function 绑仓库界面(){
  function 防(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(_e){} }
  /* 三个常驻网格只绑一次；保险内层那个是动态生成的，在 搜画详情 里单独绑 */
  搜绑网格(搜打撤_元素('rdStashGrid'));
  搜绑网格(搜打撤_元素('rdRigGrid'));
  搜绑网格(搜打撤_元素('rdBpGrid'));
  搜绑网格(搜打撤_元素('rdSafeGrid'));

  var 筛根=搜打撤_元素('rdFilters');
  if(筛根)筛根.addEventListener('click',function(e){
    var t=e.target;
    if(!t||!t.classList||!t.classList.contains('rdF'))return;
    防(e); RAID_筛=t.getAttribute('data-f')||'全部';
    搜打撤_刷仓库();
  });

  var 卖杂=搜打撤_元素('rdSellJunk');
  if(卖杂)卖杂.addEventListener('click',function(e){
    防(e);
    var s=RAID档(), 仓=s.仓库;
    var 可卖=0, 估价=0, 表=仓.件||[];
    for(var i=0;i<表.length;i++){ var d=RAID物品(表[i].id); if(d&&d.类==='变卖'&&d.价){ 可卖+=(表[i].n||1); 估价+=d.价*(表[i].n||1); } }
    if(!可卖){ 搜提('仓库里没有可卖的杂物'); return; }
    var 走=true;
    try{ 走=window.confirm('把仓库里 '+可卖+' 件变卖物一次卖掉？合计 +'+估价.toLocaleString()+' 封锁币。'); }catch(_e){ 走=false; }
    if(!走)return;
    var r=RAID一键卖(仓);
    RAID_选=null;
    if(!RAID写档())搜提('存档写入失败：这次卖出可能不会被保存');
    搜打撤_刷仓库(); 搜打撤_刷部署();
    var 文='卖出 '+r.件数+' 件杂物，+'+r.得.toLocaleString()+' 封锁币';
    搜提(文);
    try{ if(typeof showMsg==='function')showMsg(文,'#ffc75c'); }catch(_e){}
  });

  var 整理=搜打撤_元素('rdSortBtn');
  if(整理)整理.addEventListener('click',function(e){
    防(e);
    var 容=搜打撤_取容器((RAID_选&&RAID_选.容==='inner')?'inner':'stash');
    RAID整理(容||RAID档().仓库);
    RAID写档();
    搜打撤_刷仓库();
    搜提('已整理');
  });

  var 预设根=搜打撤_元素('rdPresets');
  if(预设根)预设根.addEventListener('click',function(e){
    var t=e.target;
    var b=(t&&t.closest)?t.closest('.rdPre'):null;
    if(!b)return;
    防(e);
    var i=parseInt(b.getAttribute('data-p'),10);
    var s=RAID档();
    if(!isFinite(i)||i<0||i>=s.预设.length)return;
    /* 【用户硬要求】选方案 ≠ 强制装配。点卡片只记录"当前看的是哪套清单"，
       绝不碰仓库和装备槽；真要按它装，必须另外点「按选中方案一键装配」。 */
    s.当前预设=i; RAID_选=null; RAID_展开=null;
    RAID写档();
    搜打撤_刷部署();
    var 文='已选中「'+s.预设[i].名+'」清单（不会自动装东西）';
    搜提(文);
    try{ if(typeof showMsg==='function')showMsg(文,'#9fb2c9'); }catch(_e){}
  });

  var 预装=搜打撤_元素('rdPreApply');
  if(预装)预装.addEventListener('click',function(e){
    防(e);
    var s=RAID档(), i=s.当前预设|0;
    if(!s.预设[i]){ 搜提('先选一套方案'); return; }
    var 装=RAID按预设装配(i);
    /* 显式点"一键装配"才连装备槽一起装；出发流程本身绝不自动碰玩家配置 */
    try{ 搜打撤_出发装配(); }catch(e){}
    RAID写档();
    搜打撤_刷部署(); 搜打撤_刷仓库();
    var 文='「'+s.预设[i].名+'」：装枪 '+装.装枪+' 把 · 搬弹 '+装.搬弹+' 发';
    if(装.缺&&装.缺.length)文+='；缺 '+装.缺.join('、');
    搜提(文);
    try{ if(typeof showMsg==='function')showMsg(文,'#ffd166'); }catch(_e){}
  });

  var 详情=搜打撤_元素('rdDetail');
  if(详情)详情.addEventListener('click',function(e){
    var t=e.target;
    var b=(t&&t.closest)?t.closest('[data-act]'):null;
    if(!b||b.disabled)return;
    防(e);
    var act=b.getAttribute('data-act');
    /* 穿上：把仓库里这件装备放进对应槽位（装备不是白给的，这是唯一入口） */
    if(act==='equip'){
      var 容0=搜打撤_取容器(RAID_选?RAID_选.容:'');
      var it0=容0&&RAID_选?RAID取件(容0,RAID_选.u):null;
      var d0=it0?RAID物品(it0.id):null;
      if(!d0)return;
      var 键0=(d0.类==='保险')?'安全箱':(d0.类==='枪'?'枪':d0.类);
      var r0=RAID穿(键0,d0.id);
      if(!r0.ok){ 搜提(r0.因); return; }
      RAID_选=null; RAID_展开=null;
      RAID写档();
      搜打撤_刷仓库(); 搜打撤_刷部署();
      搜提('已装备 '+d0.名);
      return;
    }
    if(act==='toggle-inner'){
      var 容=搜打撤_取容器(RAID_选?RAID_选.容:'');
      var it=容&&RAID_选?RAID取件(容,RAID_选.u):null;
      if(!it)return;
      var 已开=(RAID_展开&&RAID_展开.u===it.u&&RAID_展开.容===RAID_选.容);
      RAID_展开=已开?null:{容:RAID_选.容,u:it.u};
      搜打撤_刷仓库();
      return;
    }
    if(act==='close-inner'){ RAID_展开=null; 搜打撤_刷仓库(); return; }
    if(act==='sort-inner'){
      var 开=搜展开件();
      if(开){ RAID整理(开.内); RAID写档(); 搜打撤_刷仓库(); 搜提('内层已整理'); }
      return;
    }
    if(!RAID_选)return;
    var 从=搜打撤_取容器(RAID_选.容);
    if(!从)return;
    var u=RAID_选.u;
    if(act==='to-stash'||act==='to-bp'||act==='to-rig'||act==='to-safe'){
      var 键=act==='to-stash'?'stash':(act==='to-bp'?'bp':(act==='to-safe'?'safe':'rig'));
      var 到=搜打撤_取容器(键);
      if(!到){ 搜提('这一侧没有可用的容器'); return; }
      var r=RAID移动(从,u,到);
      if(!r.ok){ 搜提(r.因); return; }
      RAID_选={容:键,u:u};
      if(!RAID写档())搜提('存档写入失败：这次移动可能不会被保存');
      搜打撤_刷仓库();
      return;
    }
    if(act==='sell'){
      var rs=RAID卖出(从,u);
      if(!rs.ok){ 搜提(rs.因); return; }
      RAID_选=null;
      if(!RAID写档())搜提('存档写入失败：这次卖出可能不会被保存');
      搜打撤_刷仓库(); 搜打撤_刷部署();
      var 文='卖出 '+rs.名+' ×'+rs.n+'，+'+rs.得.toLocaleString()+' 封锁币';
      搜提(文);
      try{ if(typeof showMsg==='function')showMsg(文,'#ffc75c'); }catch(_e){}
      return;
    }
    if(act==='split')搜拆堆(RAID_选.容,u);
  });
})();

/* ==================== 玩法模式（阶段 4：真局内）==================== */
(function 注册模式(){
  if(typeof GAME_MODES==='undefined'||GAME_MODES.raid)return;
  GAME_MODES.raid={
    id:'raid',
    名:'搜打撤',
    start:function(){ 灰港_开局(); },
    tick:function(dt){ 灰港_每帧(dt); },
    hud:function(){ return 灰港_HUD文字(); },
    onDeath:function(){ return 灰港_阵亡(); }
  };
})();

/* ==================== 事件绑定 ==================== */
(function 绑入口(){
  function 防(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(_e){} }
  var b=搜打撤_元素('raidBtn');
  if(b)b.addEventListener('click',function(e){ 防(e); 搜打撤_进入准备(); });

  var back=搜打撤_元素('raidBackBtn');
  if(back)back.addEventListener('click',function(e){ 防(e); 搜打撤_返回原游戏(); });

  /* 标签用事件委托：四个标签共用一段逻辑，以后加页签不用再绑一次 */
  var 根=搜打撤_元素('raidPrep');
  /* 装备槽不是网格，没人给它绑 pointerdown —— 从槽里往外拖就永远起不来。
     委托在整个准备层上：格子的拖拽由各网格自己的监听器处理，槽走这一条。 */
  if(根)根.addEventListener('pointerdown',搜拖按下);
  if(根)根.addEventListener('click',function(e){
    var t=e.target;
    if(t&&t.classList&&t.classList.contains('rpTab')){ 防(e); 搜打撤_切页(t.getAttribute('data-rp')); return; }
    /* 装备槽上的「卸下」：整体放回仓库，放不下就拒绝（不能把身上的东西变没） */
    var 卸=(t&&t.closest)?t.closest('[data-unset]'):null;
    if(卸){
      防(e);
      var 键=卸.getAttribute('data-unset');
      var r=(键==='枪')?RAID脱枪(0):((键==='枪2')?RAID脱枪(1):RAID脱(键));
      if(!r.ok){ 搜提(r.因); return; }
      搜拖吞点=0;
      RAID写档();
      搜打撤_刷仓库(); 搜打撤_刷部署();
      搜提('已卸下「'+(RAID物品(r.件.id)?RAID物品(r.件.id).名:键)+'」，放回仓库');
    }
  });

  var go=搜打撤_元素('raidGoBtn');
  if(go){
    /* 阶段 4：按钮从占位变成真入口，样式上的 off 也要一起摘掉 */
    go.classList.remove('off');
    go.setAttribute('aria-disabled','false');
    go.textContent='出发 · 灰港封锁区';
    go.addEventListener('click',function(e){ 防(e); 搜打撤_出发(); });
  }

  /* 安全箱选择窗口：部署页的字段、仓库页的按钮、窗口里的每一项，都走同一条路 */
  /* 交易行：分类筛选 + 买入 */
  var 买筛=搜打撤_元素('rdMkFilters');
  if(买筛)买筛.addEventListener('click',function(e){
    var t=e.target;
    if(!t||!t.classList||!t.classList.contains('rdF'))return;
    防(e);
    RAID_买类=t.getAttribute('data-mk')||'全部';
    搜打撤_刷交易行();
  });
  var 买列=搜打撤_元素('rdMkList');
  if(买列)买列.addEventListener('click',function(e){
    var t=e.target;
    var b=(t&&t.closest)?t.closest('[data-buy]'):null;
    if(!b||b.disabled)return;
    防(e);
    var id=b.getAttribute('data-buy'), n=parseInt(b.getAttribute('data-n'),10)||1;
    var r=RAID买入(id,n);
    if(!r.ok){ 搜提(r.因); return; }
    RAID写档();
    搜打撤_刷交易行(); 搜打撤_刷仓库(); 搜打撤_刷部署();
    var 文='买入 '+r.名+' ×'+r.得+'，-'+r.花.toLocaleString()+' 封锁币';
    搜提(文);
    try{ if(typeof showMsg==='function')showMsg(文,'#ffc75c'); }catch(_e){}
  });

  var 箱区=搜打撤_元素('rdSafeField');
  if(箱区)箱区.addEventListener('click',function(e){ 防(e); 搜开安全箱窗(); });
  var 箱钮=搜打撤_元素('rdSafePick2');
  if(箱钮)箱钮.addEventListener('click',function(e){ 防(e); 搜开安全箱窗(); });
  var 箱关=搜打撤_元素('rdSafeClose');
  if(箱关)箱关.addEventListener('click',function(e){ 防(e); 搜关安全箱窗(); });
  var 箱窗=搜打撤_元素('rdSafeWin');
  if(箱窗)箱窗.addEventListener('click',function(e){
    if(e.target===箱窗){ 防(e); 搜关安全箱窗(); return; }   /* 点暗底关窗 */
    /* 窗口内点空白不穿透到准备层（准备层也在 #raidPrep 的事件链上） */
    e.stopPropagation();
  });
  var 箱列=搜打撤_元素('rdSafeList');
  if(箱列)箱列.addEventListener('click',function(e){
    var t=e.target;
    var b=(t&&t.closest)?t.closest('[data-safe]'):null;
    if(!b)return;
    防(e);
    var id=b.getAttribute('data-safe')||'';
    var r=RAID设安全箱(id);
    if(!r.ok){ 搜提(r.因); return; }
    RAID写档();
    搜关安全箱窗();
    搜打撤_刷部署(); 搜打撤_刷仓库();
    搜提(id?('已带上 '+RAID保险(id).名):'已清空安全箱');
  });
})();

/* 拖拽的移动/松开挂在 window 上：指针滑出网格甚至滑出卡片也要跟得住 */
window.addEventListener('pointermove',搜拖移动,{passive:false});
window.addEventListener('pointerup',搜拖松开,{passive:true});
window.addEventListener('pointercancel',搜拖取消,{passive:true});

/* ==================== 窗口变化：格子尺寸要跟着重算 ====================
   转屏 / 拖动窗口 / 手机收起地址栏都会改 innerHeight，仓格 是算出来的，
   不重画就会停在旧尺寸上（表现：格子比卡片宽出去一截，或者缩得太小）。 */
var _搜尺t=0;
window.addEventListener('resize',function(){
  if(!RAID_.on||RAID_.页!=='stash')return;
  clearTimeout(_搜尺t);
  _搜尺t=setTimeout(function(){ try{ 搜打撤_刷仓库(); }catch(e){} },120);
});

/* ==================== 开机自检 ====================
   从"对局中"切过来时 quitToHome 会整页刷新，刷新后要靠 gunGame.raidAuto 这个一次性标记
   自动回到准备层 —— 否则玩家点一次按钮要经历"刷新 → 回主菜单 → 再点一次"，就不是一步到位了。 */
function 搜打撤_开机自检(){
  var 要进=false;
  try{ 要进=(sessionStorage.getItem('gunGame.raidAuto')==='1'); }catch(e){}
  if(!要进)return;
  try{ sessionStorage.removeItem('gunGame.raidAuto'); }catch(e){}
  /* 老标记只可能来自旧版入口：一样送去独立页（先探测文件，缺文件就只提示不跳），
     别在主菜单里把旧准备层翻出来 */
  if(!window.RAID_独立版){ 搜打撤_跳转独立页(); return; }
  /* 名字还没取（#namePanel 还开着）就先别抢屏：取完名字玩家自己点按钮进，避免两层叠在一起 */
  var np=搜打撤_元素('namePanel');
  if(np&&np.classList&&np.classList.contains('on'))return;
  搜打撤_准备层开();
}
window.addEventListener('load',function(){ try{ 搜打撤_开机自检(); }catch(e){} });

/* ==================================================================================
   阶段 4：灰港封锁区 · 真局内
   ----------------------------------------------------------------------------------
   设计口径：
     ① 灰港**不塞进 MAPS**：它是搜打撤专用图，服务端不认这个 id。塞进去会让主菜单选图
        里冒出一张多人进不去的图（月球基地那种"看着能选、实际不同步"的坑不再踩第二遍）。
        这里自己建一个 Group，临时接管 obstacles / teleports，退出时原样还回去。
     ② 容器实例就是 js/77 的那一套：生成时只有种子，开盖那一帧才掷掉落。
     ③ 交互统一按住 F（搜刮 / 撤离），血量掉一次就把开盖进度清零 —— 挨枪打断开箱。
   ================================================================================== */
var RAID_局={
  地图:null, 容器:[], 撤离:[], 剩余:0, 进度:0, 上帧血:100,
  种子:0, 原图:null, 原障碍:null, 原传送:null, 原背景:0, 原雾:0, 原雾密:0,
  原图id:'', 原limit:0,
  HUD:null, 提示:null, 条:null, 条内:null, 结算窗:null,
  结算中:false, 撤离中:false
};
var 灰港区心={
  A:{x:-55,z:-36}, B:{x:-10,z:-28}, C:{x:-48,z:36},
  D:{x:24,z:-38}, E:{x:58,z:18}, F:{x:0,z:60}
};
function 灰港坐标(p){ return { x:(p.x-0.5)*RAID_MAP_GANG.宽, z:(p.z-0.5)*RAID_MAP_GANG.高 }; }

/* ---------- 建图：仓库 / 堆场 / 诊所 / 办公楼 / 油罐 / 码头 ---------- */
function 灰港_建场(){
  var g=new THREE.Group(); g.name='灰港封锁区';
  var obs=[], tp=[], info={stairs:[],floors:[],windows:[],roofs:[],doors:[],oval:[]};
  var 存=[_mapTarget,_obsTarget,_tpTarget,_infoTarget], i;
  _mapTarget=g; _obsTarget=obs; _tpTarget=tp; _infoTarget=info;
  try{
    var 地=new THREE.Mesh(new THREE.PlaneGeometry(RAID_MAP_GANG.宽+12,RAID_MAP_GANG.高+12),
                          new THREE.MeshLambertMaterial({color:0x626d68}));
    地.rotation.x=-Math.PI/2; 地.position.y=0.02; 地.receiveShadow=true; g.add(地);
    var mRust=new THREE.MeshLambertMaterial({color:0x8d4f38});
    var mSteel=new THREE.MeshLambertMaterial({color:0x5c6670});
    var mPale=new THREE.MeshLambertMaterial({color:0xa9b0ae});
    var mWood=new THREE.MeshLambertMaterial({color:0x6b5338});
    var mDark=new THREE.MeshLambertMaterial({color:0x2c3238});
    /* 边界：把人关在图里，别让"能走到天边"暴露这是临时图 */
    addBox(0,-94,230,4,2,mDark,'border'); addBox(0,94,230,4,2,mDark,'border');
    addBox(-114,0,2,4,190,mDark,'border'); addBox(114,0,2,4,190,mDark,'border');
    /* A 集装箱堆场：三排锈红箱子，中间留巷 */
    for(i=0;i<9;i++){
      var ax=-78+(i%3)*9, az=-52+Math.floor(i/3)*9;
      addBox(ax,az,7.4,2.9,2.6,(i%2)?mRust:mSteel);
    }
    /* B 海关仓库：四面墙留南门 + 两排货架 */
    addBox(-24,-28,1.2,5,22,mPale); addBox(4,-28,1.2,5,22,mPale);
    addBox(-10,-39,29,5,1.2,mPale); addBox(-10,-17.5,12,5,1.2,mPale); addBox(-16,-17.5,6,5,1.2,mPale);
    addBox(-18,-32,2.2,2.4,10,mWood); addBox(-2,-32,2.2,2.4,10,mWood);
    /* C 诊所：白房子 + 分诊台 */
    addBox(-60,36,1,3.6,15,mPale); addBox(-36,36,1,3.6,15,mPale);
    addBox(-48,43.5,25,3.6,1,mPale); addBox(-48,29,10,3.6,1,mPale); addBox(-40,29,15,3.6,1,mPale);
    addBox(-48,34,6,1.1,1.4,mSteel);
    /* D 行政楼：L 形两层（二楼只是掩体，不做楼梯，避免和原版攀爬冲突） */
    addBox(16,-46,1,7,20,mSteel); addBox(34,-46,1,7,20,mSteel);
    addBox(25,-56,20,7,1,mSteel); addBox(19,-36,8,7,1,mSteel);
    addBox(25,-46,8,7,1,mSteel);
    /* E 油罐区：三个大罐 + 护栏 */
    for(i=0;i<3;i++){
      var 罐=new THREE.Mesh(new THREE.CylinderGeometry(5.2,5.2,7,18),mSteel);
      罐.position.set(46+i*15,3.5,18); 罐.castShadow=true; 罐.receiveShadow=true; g.add(罐);
      obs.push({cx:46+i*15,cz:18,w:10.4,d:10.4,h:7,kind:'terrain',
                minX:46+i*15-5.2,maxX:46+i*15+5.2,minZ:12.8,maxZ:23.2});
    }
    addBox(58,30,52,1.1,0.6,mRust);
    /* F 码头前沿：木栈道 + 系船桩 */
    addBox(0,72,54,0.5,9,mWood);
    for(i=0;i<6;i++) addBox(-22+i*9,78,0.9,1.3,0.9,mDark);
    /* 零散掩体：让 6 个区之间不是一路空跑 */
    addBox(-72,0,6,2.2,3,mSteel); addBox(-30,4,5,2.2,3,mWood);
    addBox(10,18,5,2.2,3,mSteel); addBox(74,-30,6,2.2,3,mWood);
    addBox(-18,72,4,2.2,4,mSteel); addBox(66,58,5,2.2,3,mWood);
  } finally {
    _mapTarget=存[0]; _obsTarget=存[1]; _tpTarget=存[2]; _infoTarget=存[3];
  }
  return {组:g,障碍:obs,传送:tp,信息:info};
}

/* ---------- 容器模型 ---------- */
function 灰港_做容器(型,x,z){
  var 色={crate_mil:0x66713d,crate_med:0xc9d0cc,bag_travel:0x35425c,
          tool_box:0xb5652c,safe_vault:0x4a5058,corpse:0x6b3a3a}[型]||0x777777;
  var 小=(型==='crate_med'||型==='tool_box'), w=小?1.6:2.0, h=小?1.1:1.35, d=小?1.1:1.4;
  var g=new THREE.Group();
  var 盒=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color:色}));
  盒.position.y=h/2; 盒.castShadow=true; 盒.receiveShadow=true; g.add(盒);
  var 盖=new THREE.Mesh(new THREE.BoxGeometry(w+0.12,0.16,d+0.12),
                        new THREE.MeshLambertMaterial({color:0x2b3038}));
  盖.position.y=h+0.08; g.add(盖);
  if(型==='crate_med'){
    var 白=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.06,0.22),new THREE.MeshBasicMaterial({color:0xe34b4b}));
    白.position.set(0,h+0.18,0); g.add(白);
    var 横=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.06,0.9),白.material);
    横.position.set(0,h+0.18,0); g.add(横);
  }else if(型==='safe_vault'){
    var 盘=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,0.08,12),new THREE.MeshBasicMaterial({color:0xc7a44d}));
    盘.rotation.x=Math.PI/2; 盘.position.set(0,h*0.6,d/2+0.04); g.add(盘);
  }
  g.position.set(x,0,z);
  RAID_局.地图.add(g);
  return {组:g,盖:盖,盒:盒,盖高:盖.position.y};
}
function 灰港_布容器(){
  var rng=RAID随机(RAID_局.种子), 区=RAID_MAP_GANG.区, 号=0;
  var 散=[[-7,-5],[0,-5],[7,-5],[-7,0],[0,0],[7,0],[-7,5],[0,5],[7,5],[13,0]];
  for(var a=0;a<区.length;a++){
    var 中=灰港区心[区[a].id]||{x:0,z:0}, 组=区[a].容器||[];
    for(var b=0;b<组.length;b++){
      for(var k=0;k<(组[b][1]|0);k++){
        var 位=散[号%散.length];
        var x=中.x+位[0]+(rng()-0.5)*1.6, z=中.z+位[1]+(rng()-0.5)*1.6;
        var 种=(RAID_局.种子 ^ Math.imul(号+1,2654435761))>>>0;
        var c=RAID生成容器(组[b][0],种||1,区[a].名);
        c.x=x; c.z=z; c.模型=灰港_做容器(组[b][0],x,z);
        RAID_局.容器.push(c);
        号++;
      }
    }
  }
}
function 灰港_开箱外观(c){
  try{
    if(!c.模型)return;
    c.模型.盖.position.y=c.模型.盖高+0.55;
    c.模型.盖.rotation.z=0.3;
    c.模型.盒.material.color.multiplyScalar(0.72);
  }catch(e){}
}

/* ---------- 撤离点 ---------- */
function 灰港_做撤离(p){
  var c=灰港坐标(p), g=new THREE.Group();
  var 柱=new THREE.Mesh(new THREE.CylinderGeometry(3.1,3.1,9,18,1,true),
    new THREE.MeshBasicMaterial({color:0x4ce3a0,transparent:true,opacity:0.15,
                                 side:THREE.DoubleSide,depthWrite:false}));
  柱.position.y=4.5; g.add(柱);
  var 环=new THREE.Mesh(new THREE.TorusGeometry(3.1,0.14,8,30),
                        new THREE.MeshBasicMaterial({color:0x4ce3a0,transparent:true,opacity:0.85}));
  环.rotation.x=Math.PI/2; 环.position.y=0.2; g.add(环);
  g.position.set(c.x,0,c.z);
  RAID_局.地图.add(g);
  return {id:p.id,名:p.名,x:c.x,z:c.z,组:g,柱:柱,环:环};
}
function 灰港_布撤离(){
  for(var i=0;i<RAID_MAP_GANG.撤离.length;i++) RAID_局.撤离.push(灰港_做撤离(RAID_MAP_GANG.撤离[i]));
}

/* ---------- 出发 / 收场 ---------- */
/* 出发前自动把仓库里的起始装备穿上：只搬仓库里真有的东西，不凭空造。
   准备层仍然是"空槽自己拖上去"的口径（存档建档时槽位保持空），
   但新玩家点出发时必须带得动东西 —— 否则开第一个箱子会发现一件都拿不走。 */
function 搜打撤_出发装配(){
  var s=RAID档(), 装=[], i, k, d;
  var 表=[['胸挂','胸挂'],['背包','背包'],['头盔','头盔'],['护甲','护甲']];
  for(i=0;i<表.length;i++){
    if(RAID槽件(表[i][0]))continue;
    var 件=RAID仓里有(表[i][1])[0];
    if(!件)continue;
    if(RAID穿(表[i][0],件.id).ok)装.push((RAID物品(件.id)||{}).名||件.id);
  }
  if(!RAID槽件('安全箱')){
    for(k=0;k<s.仓库.件.length;k++){
      d=RAID物品(s.仓库.件[k].id);
      if(d&&d.类==='保险'&&RAID穿('安全箱',d.id).ok){ 装.push(d.名); break; }
    }
  }
  if(!RAID枪械(0)){
    for(k=0;k<s.仓库.件.length;k++){
      d=RAID物品(s.仓库.件[k].id);
      if(d&&d.类==='枪'&&RAID穿枪(d.id).ok){ 装.push(d.名); break; }
    }
  }
  var 挂=RAID预设胸挂();
  if(挂){
    for(k=s.仓库.件.length-1;k>=0;k--){
      d=RAID物品(s.仓库.件[k].id);
      if(d&&d.类==='弹药')RAID移动(s.仓库,s.仓库.件[k].u,挂);
    }
  }
  if(装.length)try{ showMsg('出发装配：'+装.join('、')+'（从仓库取的，不是白送）','#ffd166'); }catch(e){}
}
function 搜打撤_出发(){
  var s=RAID档();
  /* 【用户硬要求】出发不替玩家装配。三个方案只是可选清单，不点「一键装配」
     就保持玩家自己拖出来的样子 —— 空手出发也是玩家自己的选择。 */
  if(!RAID预设背包()&&!RAID预设胸挂())
    try{ showMsg('空手出发：没穿胸挂或背包，搜到的东西要先有地方放','#ffc75c'); }catch(e){}
  s.统计.局=(s.统计.局|0)+1;
  RAID写档();
  /* 准备层只隐藏 DOM，不调 搜打撤_准备层关()：RAID_.on 要留着，
     否则退出时的 搜打撤_清状态() 不会把玩家送回准备层。 */
  var 层=搜打撤_元素('raidPrep'); if(层)层.classList.remove('on');
  RAID_.on=true; RAID_.阶段='in'; RAID_.对局中=true;
  RAID_.结算中=false; RAID_.撤离中=false;
  try{ if(正在打字)document.activeElement.blur(); }catch(e){}
  CUR_MODE='raid';
  try{ startSoloGame(); }catch(e){
    try{ console.error('[搜打撤] 进图失败',e); }catch(_e){}
    try{ showMsg('进图失败：'+e.message,'#ff6b6b'); }catch(_e){}
    灰港_退场();
  }
}
function 灰港_开局(){
  if(!RAID_.对局中)return;
  try{
    var 场=灰港_建场(), k;
    RAID_局.地图=场.组; scene.add(场.组);
    /* 原地图整组隐藏并记下状态；curMapId 不动，退出时什么都不用恢复 */
    RAID_局.原图={};
    for(k in MAP_GROUP) if(Object.prototype.hasOwnProperty.call(MAP_GROUP,k)){
      RAID_局.原图[k]=MAP_GROUP[k].visible; MAP_GROUP[k].visible=false;
    }
    RAID_局.原障碍=obstacles; RAID_局.原传送=teleports;
    obstacles=场.障碍; teleports=场.传送;
    /* 边界与地面高度：worldLimit()/groundHeightAt() 都按 curMapId 取旧图参数
       （旧图 limit 只有 76，而灰港出生点在 x≈-92 —— 不换就会被锁在边界外）。
       临时切到 classic 并把它的 limit 放大到围墙内侧，退出时原样还回去。 */
    RAID_局.原图id=curMapId;
    var 临图=mapById('classic');
    RAID_局.原limit=临图?临图.limit:0;
    curMapId='classic';
    if(临图)临图.limit=196;   /* 新图 400×400，旧 112 会把玩家锁在围墙内一半的位置 */
    try{ buildObstacleBoxes(); }catch(e){}
    try{
      RAID_局.原背景=scene.background.getHex(); RAID_局.原雾=scene.fog.color.getHex();
      RAID_局.原雾密=scene.fog.density;
      scene.background.setHex(0x35444e); scene.fog.color.setHex(0x46555f); scene.fog.density=0.0035;
    }catch(e){}
    RAID_局.种子=(Date.now()^Math.floor(Math.random()*1e9))|0;
    RAID_局.容器.length=0; RAID_局.撤离.length=0;
    RAID_局.剩余=RAID_MAP_GANG.时长; RAID_局.进度=0;
    RAID_局.上帧血=S.hp;
    var 生=灰港坐标(RAID_MAP_GANG.出生[0]);
    camera.position.set(生.x,GROUND_Y,生.z);
    S.velY=0; S.onGround=true; S.onLadder=false; S.mantle=0; S.landKick=0;
    灰港_布容器(); 灰港_布撤离(); 灰港_建HUD();
    /* 带进来的枪：槽号是负数（BUILTIN 扩展槽），直接拿原版武器模型来画 */
    var s=RAID档(), 枪=s.装备&&s.装备.枪?s.装备.枪[0]:'', g=RAID_GUNS[枪];
    if(g&&typeof g.槽==='number'&&g.槽<0){
      curGun=g.槽;
      try{ rebuildWeaponModel(); }catch(e){}
      /* 空弹匣进图：第一枪触发换弹，从胸挂/背包真扣子弹，绝不预装 */
      S.maxAmmo=g.弹匣|0;
      /* 膛内子弹由 startSoloGame 按存档恢复到这里，绝不能无脑清零 */
      S.ammo=Math.max(0,Math.min((typeof P!=='undefined'&&P.弹匣表)?(P.弹匣表[P.枪序|0]|0):0,S.maxAmmo));
    }
    showMsg('灰港封锁区：按住 F 搜刮 / 撤离。活着走出去才算带出物资。','#ffd166');
  }catch(e){
    try{ console.error('[灰港] 建场失败',e); }catch(_e){}
    try{ showMsg('灰港场景加载失败：'+e.message,'#ff6b6b'); }catch(_e){}
  }
}
function 灰港_收场(){
  var i;
  if(RAID_局.HUD&&RAID_局.HUD.parentNode)RAID_局.HUD.parentNode.removeChild(RAID_局.HUD);
  if(RAID_局.结算窗&&RAID_局.结算窗.parentNode)RAID_局.结算窗.parentNode.removeChild(RAID_局.结算窗);
  RAID_局.HUD=RAID_局.提示=RAID_局.条=RAID_局.条内=RAID_局.结算窗=null;
  /* 搜刮窗若还开着，直接收掉（不走 搜刮_关，免得回调又去解锁鼠标） */
  try{
    搜刮_清定时();
    var 窗=document.getElementById('rdLootWin');
    if(窗){
      窗.classList.remove('on');
      if(窗.parentNode===document.body&&窗.__原父)窗.__原父.appendChild(窗);
      窗.style.position=''; 窗.style.zIndex='';
    }
    RAID_搜刮.开=false; RAID_搜刮.容器=null;
  }catch(e){}
  if(RAID_局.地图&&RAID_局.地图.parent)RAID_局.地图.parent.remove(RAID_局.地图);
  if(RAID_局.原图){
    for(var k in RAID_局.原图) if(Object.prototype.hasOwnProperty.call(RAID_局.原图,k))
      MAP_GROUP[k].visible=RAID_局.原图[k];
  }
  if(RAID_局.原障碍){ obstacles=RAID_局.原障碍; try{ buildObstacleBoxes(); }catch(e){} }
  if(RAID_局.原传送)teleports=RAID_局.原传送;
  try{
    scene.background.setHex(RAID_局.原背景); scene.fog.color.setHex(RAID_局.原雾);
    scene.fog.density=RAID_局.原雾密;
  }catch(e){}
  try{
    var 临图=mapById('classic');
    if(临图&&RAID_局.原limit)临图.limit=RAID_局.原limit;
    curMapId=RAID_局.原图id||curMapId;
  }catch(e){}
  RAID_局.地图=null; RAID_局.原图=null; RAID_局.原障碍=null; RAID_局.原传送=null;
  RAID_局.容器.length=0; RAID_局.撤离.length=0;
  RAID_局.结算中=false; RAID_局.撤离中=false; RAID_局.进度=0;
}

/* ---------- 局内 HUD ---------- */
function 灰港_建HUD(){
  var d=document.createElement('div'); d.id='raidWorldHud';
  d.style.cssText='position:fixed;inset:0;z-index:300;pointer-events:none;'
    +'font-family:system-ui,"Microsoft YaHei",sans-serif;color:#e8eefc;';
  d.innerHTML='<div id="rdwTop" style="position:absolute;left:16px;top:14px;padding:8px 12px;'
    +'border-radius:9px;background:rgba(12,18,24,.72);border:1px solid rgba(255,255,255,.12);'
    +'font-size:13px;font-weight:700;letter-spacing:.3px"></div>'
    +'<div id="rdwHint" style="position:absolute;left:50%;bottom:104px;transform:translateX(-50%);'
    +'padding:8px 16px;border-radius:10px;background:rgba(12,18,24,.82);'
    +'border:1px solid rgba(255,209,102,.45);font-size:15px;font-weight:800;color:#ffd166;'
    +'white-space:nowrap;display:none"></div>'
    +'<div id="rdwBar" style="position:absolute;left:50%;bottom:84px;transform:translateX(-50%);'
    +'width:250px;height:8px;border-radius:6px;background:rgba(0,0,0,.55);overflow:hidden;display:none">'
    +'<i style="display:block;height:100%;width:0;background:linear-gradient(90deg,#d8a125,#ffe08a)"></i></div>';
  document.body.appendChild(d);
  RAID_局.HUD=d;
  RAID_局.顶=d.querySelector('#rdwTop');
  RAID_局.提示=d.querySelector('#rdwHint');
  RAID_局.条=d.querySelector('#rdwBar');
  RAID_局.条内=d.querySelector('#rdwBar i');
}
function 灰港_HUD文字(){
  if(!RAID_.对局中||!RAID_局.剩余)return '🧳 搜打撤';
  var 余=Math.max(0,Math.floor(RAID_局.剩余));
  var 开=0, i;
  for(i=0;i<RAID_局.容器.length;i++) if(RAID_局.容器[i].已开)开++;
  return '🧳 灰港封锁区 · 剩余 '+Math.floor(余/60)+':'+String(余%60).padStart(2,'0')
         +' · 已搜 '+开+'/'+RAID_局.容器.length;
}
function 灰港_提示(t,比){
  if(!RAID_局.提示)return;
  if(!t){ RAID_局.提示.style.display='none'; RAID_局.条.style.display='none'; return; }
  RAID_局.提示.style.display=''; RAID_局.提示.textContent=t;
  RAID_局.条.style.display=(typeof 比==='number')?'':'none';
  if(typeof 比==='number')RAID_局.条内.style.width=Math.max(0,Math.min(100,比*100))+'%';
}

/* ---------- 每帧：交互 / 倒计时 / 受击打断 ---------- */
function 灰港_每帧(dt){
  if(!RAID_.对局中||RAID_.结算中)return;
  if(RAID_局.顶)RAID_局.顶.textContent=灰港_HUD文字();
  RAID_局.剩余-=dt||0;
  if(RAID_局.剩余<=0){ 灰港_阵亡('时间耗尽，没能撤离'); return; }
  /* 挨枪 → 开盖归零（原地挨打不能靠硬抗把柜子撬开） */
  if(S.hp<RAID_局.上帧血-0.01)RAID_局.进度=0;
  RAID_局.上帧血=S.hp;
  var px=camera.position.x, pz=camera.position.z, i, c, d, 近=null, 最近=1e9;
  /* 撤离点优先：撤离光圈和箱子挨着时，别把 F 让给箱子 */
  for(i=0;i<RAID_局.撤离.length;i++){
    c=RAID_局.撤离[i]; d=Math.hypot(px-c.x,pz-c.z);
    if(d<5&&d<最近){ 最近=d; 近=c; }
  }
  if(近){
    if(keys.KeyF){
      RAID_局.进度+=(dt||0)/3;
      if(RAID_局.进度>=1){ 灰港_撤离(近); return; }
    }else RAID_局.进度=Math.max(0,RAID_局.进度-(dt||0)*1.5);
    灰港_提示('按住 F 撤离 · '+近.名,RAID_局.进度);
    return;
  }
  近=null; 最近=1e9;
  for(i=0;i<RAID_局.容器.length;i++){
    c=RAID_局.容器[i];
    /* 二层容器要等玩家真的上到二层才能搜；现在还没接楼板高度，先在楼下过滤掉 */
    if(c.层===2&&camera.position.y<4.2)continue;
    d=Math.hypot(px-c.x,pz-c.z);
    if(d<3.4&&d<最近){ 最近=d; 近=c; }
  }
  if(近){
    var cfg=RAID容器配置(近.型);
    if(近.已开){
      灰港_提示('按 F 搜刮 · '+近.名,keys.KeyF?1:0);
      if(keys.KeyF&&!RAID_搜刮.开)灰港_开箱(近,true);
    }else{
      if(keys.KeyF)近.进度=Math.min(1,近.进度+(dt||0)/Math.max(0.4,cfg.开盖));
      else 近.进度=Math.max(0,近.进度-(dt||0)*0.5);
      灰港_提示('按住 F 开盖 · '+近.名,近.进度);
      if(近.进度>=1)灰港_开箱(近,false);
    }
    return;
  }
  灰港_提示('');
}
function 灰港_开箱(c,已开){
  if(RAID_.结算中)return;
  try{
    if(!已开){ RAID开箱(c); 灰港_开箱外观(c); }
    搜刮_打开已有(c);
    S.paused=true;                 /* 搜刮时人不走、枪不响；关窗由回调恢复 */
    RAID_局.进度=0;
  }catch(e){
    try{ showMsg('开箱失败：'+e.message,'#ff6b6b'); }catch(_e){}
  }
}
/* 搜刮窗关掉之后，把人还给 3D 局（js/77 在 搜刮_关() 尾部调它） */
function 搜打撤_搜刮关回调(){
  if(!RAID_.对局中||RAID_.结算中)return;
  S.paused=false;
  try{ lockPointer(); }catch(e){}
}

/* ---------- 结算 ---------- */
function 灰港_清点(含身上){
  var 表=[{名:'安全箱',容:RAID安全箱()}];
  if(含身上)表.unshift({名:'背包',容:RAID预设背包()},{名:'胸挂',容:RAID预设胸挂()});
  var 件=0, 值=0;
  for(var i=0;i<表.length;i++){
    var c=表[i].容; if(!c)continue;
    件+=RAID容器件数(c); 值+=RAID容器价(c);
  }
  return {件:件,值:Math.round(值)};
}
function 灰港_撤离(点){
  if(RAID_.结算中||RAID_局.撤离中)return;
  RAID_局.撤离中=true;
  var s=RAID档(), 清=灰港_清点(true);
  s.局中=false;                       /* 正常结算：下次进图不算异常中断 */
  s.统计.撤离=(s.统计.撤离|0)+1;
  s.统计.带出=(s.统计.带出|0)+清.件;
  s.统计.空箱=0;
  /* 膛内子弹与甲/盔剩余耐久跟着存档走，撤离后重新进图不回满 */
  var 膛=0;
  try{ 保存弹匣(); 保存装备耐久(); 膛=(P.弹匣表[0]|0)+(P.弹匣表[1]|0); }catch(e){}
  /* 赛季任务进度：成功撤离 + 带出的加密情报页，达标后永久解锁安全箱 */
  var 带出件=[], 表=[RAID预设背包(),RAID预设胸挂(),RAID安全箱()], i;
  for(i=0;i<表.length;i++){
    if(!表[i]||!表[i].件)continue;
    for(var k=0;k<表[i].件.length;k++)带出件.push({id:表[i].件[k].id,n:表[i].件[k].n||1});
  }
  var 季={刚完成:false};
  try{ 季=RAID赛季撤离(带出件); }catch(e){}
  RAID写档();
  var 细='带出 '+清.件+' 件物资 · 估值 '+清.值.toLocaleString()+' 封锁币';
  if(膛)细+=' · 枪内已保留 '+膛+' 发';
  if(季.刚完成)细+='<br><b style="color:#ffd166">赛季任务「灰港封锁令」完成 · 安全箱已解锁</b>';
  灰港_结算(true,'✅ 从「'+点.名+'」成功撤离',细);
}
function 灰港_阵亡(因){
  if(!RAID_.对局中||RAID_.结算中)return true;
  var s=RAID档(), 清=灰港_清点(false);
  s.局中=false;                       /* 阵亡也是正常结算，不能当异常中断重复惩罚 */
  s.统计.死亡=(s.统计.死亡|0)+1;
  s.统计.空箱=0;
  /* 搜打撤的代价：身上装备全丢，安全箱里的东西保住（这就是保险箱的用处） */
  s.装备={胸挂:null,背包:null,头盔:'',护甲:'',枪:[null,null]};
  s.弹匣=[0,0];
  s.装备耐久={护甲:{id:'',值:0},头盔:{id:'',值:0}};
  RAID写档();
  灰港_结算(false,'☠ '+(因||'阵亡，物资全部丢失'),
             '仅安全箱保住 '+清.件+' 件 · 估值 '+清.值.toLocaleString()+' 封锁币');
  return true;
}
function 灰港_结算(成功,标题,明细){
  RAID_.结算中=true;
  S.paused=true;
  try{ 隐藏镜筒(); }catch(e){}
  try{ document.exitPointerLock(); }catch(e){}
  var d=document.createElement('div'); d.id='raidResult';
  d.style.cssText='position:fixed;inset:0;z-index:900;display:flex;align-items:center;'
    +'justify-content:center;background:rgba(5,9,14,.78);font-family:system-ui,"Microsoft YaHei",sans-serif;';
  d.innerHTML='<div style="width:min(520px,92vw);padding:28px 30px;border-radius:16px;'
    +'background:#101825;border:1px solid '+(成功?'#4ce3a0':'#ff6b6b')+';box-shadow:0 24px 80px rgba(0,0,0,.6)">'
    +'<h2 style="margin:0 0 14px;font-size:23px;color:'+(成功?'#7bf0bd':'#ff8e8e')+'">'+标题+'</h2>'
    +'<p style="margin:0 0 10px;color:#c9d5e8;font-size:15px">'+明细+'</p>'
    +'<p style="margin:0 0 22px;color:#7f8ca2;font-size:12px">撤离记录与战利品已写入档案，回准备层可以继续整理仓库。</p>'
    +'<button id="raidResultBack" style="width:100%;padding:12px;border:0;border-radius:10px;'
    +'background:linear-gradient(90deg,#e0a020,#ffd06a);color:#20170a;font-weight:800;font-size:15px;cursor:pointer">返回准备层</button>'
    +'</div>';
  document.body.appendChild(d);
  RAID_局.结算窗=d;
  var b=d.querySelector('#raidResultBack');
  if(b)b.addEventListener('click',function(){ 灰港_退场(); });
}
function 灰港_退场(){
  /* 没经过撤离/阵亡结算就退场 = 异常中断：只保安全箱，不算撤离成功 */
  var 断={触发:false};
  try{ 断=RAID异常中断(); }catch(e){}
  S.playing=false; S.over=false; S.paused=false;
  CUR_MODE=null;
  if(断.触发)try{ showMsg('异常中断：仅安全箱内 '+断.保住+' 件物品保住，未计入撤离','#ff8e8e'); }catch(e){}
  try{ clearFieldData(); }catch(e){}
  try{ resetRoundState(); }catch(e){}
  try{ var h=document.getElementById('hud'); if(h)h.style.display='none'; }catch(e){}
  try{ document.exitPointerLock(); }catch(e){}
  RAID_.结算中=false; RAID_.撤离中=false;
  搜打撤_准备层开();
}
