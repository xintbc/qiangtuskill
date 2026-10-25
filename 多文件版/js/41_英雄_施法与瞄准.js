/* ==================== 半透明抛物线预览（长按开火键时显示）====================
   用**和实弹同一套物理**试跑一遍（同样重力、同样撞墙停），把轨迹画成一串半透明小点 + 落点圈。
   抬头 → 抛物线更高更远；低头 → 又低又近。看到的就是待会儿真正飞出去的那条线。 */
var _prevGrp=null,_prevDots=[],_prevRing=null;
var PREV_N=72, PREV_H=1/48;                                      // 预览步数 × 步长 ≈ 覆盖 1.5 秒飞行（够看高抛）
function heroPreviewPoints(){
  /* 【batch172】蜂鸟无人机：**直线轨迹**（不抛物线、不弹墙）——沿出手方向每 2 米一个点，共 40 米 */
  if(SK.hold&&SK.hold.kind==='sp_drone'){
    /* 【batch176】与实弹同一套：准星方向的直线（预览看到的线就是它真正飞的路） */
    var _d2=camera.getWorldDirection(new THREE.Vector3()).normalize();
    var p0=camera.position.clone().add(_d2.clone().multiplyScalar(0.6));
    var pts=[[p0.x,p0.y,p0.z]];
    for(var i2=1;i2<=20;i2++){var t2=2.0*i2;pts.push([p0.x+_d2.x*t2,p0.y+_d2.y*t2,p0.z+_d2.z*t2]);}
    return pts;
  }
  var v=heroThrowVel(),p=heroThrowFrom();
  var x=p.x,y=p.y,z=p.z,vx=v.vx,vy=v.vy,vz=v.vz,pts=[[x,y,z]];
  for(var i=0;i<PREV_N;i++){
    var _py0=y;                                                        // 【batch110】本步前的高度
    vy-=PROJ_G*PREV_H;
    x+=vx*PREV_H;y+=vy*PREV_H;z+=vz*PREV_H;
    var _psurf=projSurfAt(x,z,_py0);                                   // 【batch110】预览与实弹共用同一套表面判定
    if(y-PROJ_R<=_psurf){y=_psurf+PROJ_R;pts.push([x,y,z]);break;}
    if(projHitsWall(x,y,z)){pts.push([x,y,z]);break;}
    pts.push([x,y,z]);
  }
  return pts;
}
function heroPreviewMk(){
  if(_prevGrp)return;
  _prevGrp=new THREE.Group();scene.add(_prevGrp);
  for(var i=0;i<PREV_N+1;i++){
    var d=new THREE.Mesh(new THREE.SphereGeometry(0.085,7,5),
      new THREE.MeshBasicMaterial({color:0xbdefff,transparent:true,opacity:0.40,depthWrite:false}));
    d.raycast=function(){};d.visible=false;d.renderOrder=940;
    _prevGrp.add(d);_prevDots.push(d);
  }
  _prevRing=new THREE.Mesh(new THREE.RingGeometry(0.42,0.58,26),
    new THREE.MeshBasicMaterial({color:0xbdefff,transparent:true,opacity:0.8,side:THREE.DoubleSide,depthWrite:false}));
  _prevRing.rotation.x=-Math.PI/2;_prevRing.raycast=function(){};_prevRing.renderOrder=941;
  _prevGrp.add(_prevRing);
  _prevGrp.visible=false;
}
function heroPreviewUpdate(){
  if(!SK.aimThrow)return;
  heroPreviewMk();_prevGrp.visible=true;
  var pts=heroPreviewPoints();
  for(var i=0;i<_prevDots.length;i++){
    if(i<pts.length){var q=pts[i];_prevDots[i].position.set(q[0],q[1],q[2]);_prevDots[i].visible=true;}
    else _prevDots[i].visible=false;
  }
  var last=pts[pts.length-1];
  _prevRing.position.set(last[0],0.05,last[2]);
  _prevRing.visible=(last[1]-PROJ_R)<0.25;                     // 落在墙上就不画地面落点圈
}
function heroPreviewHide(){if(_prevGrp)_prevGrp.visible=false;}
/* 持握：**把枪/刀收起来**，改成"手里举着这件投掷物"。
   三件道具各有各的姿势与动作：探测器托在手心慢慢转、闪光弹举高且引信烧着轻抖、急救箱两手捧着随步伐晃。 */
var _holdObj=null,_holdHand=null, HOLD_POSE={
  mine:  {x:0.34,y:-0.30,z:-0.62, ry: 0.45, rise:0.55, spin:1.0, sway:0.05},
  flash: {x:0.26,y:-0.20,z:-0.54, ry:-0.30, rise:0.62, spin:2.2, sway:0.03},
  medkit:{x:0.02,y:-0.34,z:-0.55, ry: 0.00, rise:0.50, spin:0.5, sway:0.10},   /* 【batch216】上移 10cm：原来整箱沉在屏幕最底部，托它的手完全在画面外 */
  frag:  {x:0.30,y:-0.26,z:-0.58, ry: 0.30, rise:0.58, spin:1.8, sway:0.04},
  smoke: {x:0.28,y:-0.24,z:-0.56, ry:-0.20, rise:0.56, spin:1.1, sway:0.05},
  medsmoke:{x:0.28,y:-0.24,z:-0.56, ry:-0.20, rise:0.56, spin:1.1, sway:0.05},
  pulse: {x:0.30,y:-0.22,z:-0.56, ry: 0.10, rise:0.60, spin:1.4, sway:0.04},
  /* 【batch120】蚀日者 / 闪电 的四件投掷道具 */
  solar: {x:0.30,y:-0.16,z:-0.62, ry: 0.20, rise:0.62, spin:0.7, sway:0.03},
  portal:{x:0.26,y:-0.22,z:-0.58, ry:-0.25, rise:0.58, spin:1.3, sway:0.04},
  orb:   {x:0.30,y:-0.24,z:-0.56, ry: 0.15, rise:0.58, spin:2.0, sway:0.04},
  trap:  {x:0.30,y:-0.26,z:-0.58, ry: 0.30, rise:0.56, spin:1.5, sway:0.04},
  /* 【batch123b】球形闪电：装填后手里**托着一颗球**（左键一发一发朝前打出去） */
  ball:  {x:0.30,y:-0.22,z:-0.56, ry: 0.18, rise:0.60, spin:1.6, sway:0.03},
  /* 【batch158】影月 的两件投掷道具 */
  ssmoke:{x:0.28,y:-0.24,z:-0.56, ry:-0.20, rise:0.56, spin:1.1, sway:0.05},
  sbomb: {x:0.30,y:-0.24,z:-0.56, ry: 0.15, rise:0.58, spin:1.6, sway:0.04},
  /* 【batch172】蜂鸟无人机：托在掌心，旋翼轻转 */
  sp_drone:{x:0.30,y:-0.26,z:-0.58, ry: 0.12, rise:0.56, spin:1.2, sway:0.03},
  /* 【batch177】电磁网发生器：托在掌心 */
  sp_net:  {x:0.30,y:-0.24,z:-0.56, ry: 0.10, rise:0.56, spin:1.0, sway:0.04},
  /* 【batch181】堕日的小太阳：托在掌心，火苗轻转 */
  sp_sunfall:{x:0.30,y:-0.22,z:-0.56, ry: 0.00, rise:0.58, spin:1.4, sway:0.03},
  /* 【batch179】掩体墙：缩小并挪到**右下角**，别糊住准星。
     原来缩放 0.34（≈1.63×0.92 米）配 x:0.34，半宽 0.82 > 0.34，横着跨过屏幕中线 → 挡视野。
     现在缩到 0.14（≈0.67×0.38 米，半宽 0.34）配 x:0.42，最左边缘 0.08 仍在中线右侧，怎么转都不挡准星。 */
  sp_wall: {x:0.42,y:-0.38,z:-0.56, ry:-0.35, rise:0.50, spin:0.5, sway:0.02}
};
function heroHoldShow(kind){
  heroHoldHide();
  /* 【batch219】模组投掷物：先在 ModLoader.throwables 里找，找到就用模组自己的 mesh()。
     以前这里只认内置那 14 种，模组英雄掏出自己的道具会走到最后一个分支 = 建成一个烟罐。 */
  var m=null, _模组扔=null;
  try{
    _模组扔=(window.ModLoader&&ModLoader.throwables&&ModLoader.throwables[kind])||null;
    if(_模组扔&&typeof _模组扔.mesh==='function')m=_模组扔.mesh();
  }catch(e){ m=null; }
  if(!m)m=(kind==='mine')?heroMeshMine():(kind==='flash')?heroMeshFlash():(kind==='medkit')?heroMeshMedkit()
       :(kind==='frag')?heroMeshFrag():(kind==='pulse')?heroMeshPulse():(kind==='solar')?heroMeshSolar()
       :(kind==='portal')?heroMeshPortal():(kind==='orb')?heroMeshOrb():(kind==='trap')?heroMeshTrap()
       :(kind==='ball')?heroMeshBall()
       :(kind==='ssmoke')?heroMeshShadowSmoke():(kind==='sbomb')?heroMeshShadowBomb()   /* 【batch158】影月 */
       :(kind==='sp_drone')?heroMeshSpDrone()                                             /* 【batch172】蜂鸟无人机 */
       :(kind==='sp_net')?heroMeshSpNet():(kind==='sp_wall')?heroMeshSpWall()                                                 /* 【batch177】电磁网发生器 */
       :(kind==='sp_sunfall')?heroMeshSun()                                               /* 【batch181】堕日的小太阳 */
       :heroMeshSmoke(kind==='medsmoke');
  /* 【batch120】黑日（直径 1.7 米）与传送门（直径 2 米）是"大招级"尺寸，拿在手里必须缩到能握住，
     否则整块屏幕被糊住。其余小道具照旧 1.25。掩体墙模型已按真墙比例生成（4.8×2.7），缩到 0.34 即"小一号真墙"。 */
  /* 【batch179】掩体墙缩放 0.34→0.14（上面 batch120 注释里"缩到 0.34"已作废）：
     0.14×4.8≈0.67 米宽，配合 HOLD_POSE.sp_wall 的 x:0.42 稳稳落在右下角，举着不再挡准星。 */
  /* 【batch216】普通投掷物 1.25 → 0.55：原来为了"看得清"放大到 1.25，
     结果镜头前 0.58 米处一颗 0.21 米半径的球占掉半屏，**加再多手也被球挡住**。
     0.55 ≈ 直径 19cm（真手雷 6cm，游戏里偏大一点点刚好），手能从后下方露出来握住它。 */
  var _hs=(kind==='solar')?0.34:(kind==='portal')?0.40:(kind==='sp_wall')?0.14:(kind==='sp_sunfall')?0.5:0.55;
  if(_模组扔&&typeof _模组扔.scale==='number')_hs=_模组扔.scale;   /* 【batch219】模组投掷物自带缩放 */
  m.scale.set(_hs,_hs,_hs);
  m.traverse(function(o){o.raycast=function(){};});
  camera.add(m);_holdObj=m;
  SK.holdT=0;                                             // 掏出来的过渡（0→1）
  SK.holdHideGun=true;
  weaponGroup.visible=false;                              // 【关键】手里已经拿着投掷物，枪/刀先收起来
  if(typeof leftHandCamGroup!=='undefined'&&leftHandCamGroup)leftHandCamGroup.visible=false;
  /* 【batch217】用户："持有投掷物的时候，右下角显示的只有投掷物，不能显示步枪或者刀"。
     枪被藏起来是应该的（手里拿着雷），但**HUD 必须继续告诉他主武器还在**：
     右下角保留"步枪 / 刀"的名字 + 弹匣数，后面再补一句"手持××"。
     主武器名字先存进 data-主，放下投掷物时原样还原（rebuildWeaponModel 会重新写这个名字）。 */
  /* 【batch218】用户："把那个步枪的标去掉"、"步枪的子弹数量为什么也要显示"。
     拿投掷物时右下角**只显示手里这件东西的名字** —— 不带主武器前缀、不显示弹匣数。
     主武器名字先存进 data-主，放下时原样还原。 */
  try{
    var ne=document.getElementById('weapon-name');
    if(ne){
      if(!ne.getAttribute('data-主'))ne.setAttribute('data-主',ne.textContent);
      var 名表={frag:'破片手雷',flash:'闪光弹',smoke:'烟雾弹',medsmoke:'医疗烟',medkit:'急救箱',
                pulse:'战术探测器',mine:'感应雷',solar:'黑日',portal:'日蚀之门',orb:'电球',
                trap:'电荷陷阱',ball:'球形闪电',ssmoke:'影烟',sbomb:'影雷',
                sp_drone:'蜂鸟无人机',sp_net:'电磁网',sp_wall:'掩体墙',sp_sunfall:'小太阳'};
      SK.hold.名称=(名表[kind]||'投掷物');      /* 存一份：万一别处重建了武器模型，右下角还能还原成这个名字 */
      ne.textContent=SK.hold.名称;
    }
  }catch(e){}
  try{
    var _am=document.getElementById('ammo'); if(_am)_am.style.display='none';
    var _rt=document.getElementById('reload-text'); if(_rt)_rt.style.display='none';
  }catch(e){}
}
function heroHoldHide(){
  if(_holdObj){if(_holdObj.parent)_holdObj.parent.remove(_holdObj);_holdObj=null;}
  /* 【batch216】手里的东西收起来 → 那只手也一起收（不然它会一直举在半空） */
  if(_holdHand)_holdHand.visible=false;
  heroWallGhostHide();
  SK.holdHideGun=false;
  if(typeof weaponGroup!=='undefined'&&weaponGroup)weaponGroup.visible=true;   // 放下投掷物 → 枪/刀回来
  if(typeof leftHandCamGroup!=='undefined'&&leftHandCamGroup)leftHandCamGroup.visible=(currentWeapon===WEAPON_KNIFE);
  /* 【batch217】右下角还原成主武器名（把"· 手持 ××"去掉） */
  try{
    var ne2=document.getElementById('weapon-name');
    if(ne2){
      var 主2=ne2.getAttribute('data-主');
      if(主2)ne2.textContent=主2;
      ne2.removeAttribute('data-主');
    }
  }catch(e){}
  try{ if(typeof updateWeaponHUD==='function')updateWeaponHUD(); }catch(e){}
}
/* 收起当前投掷物（退还冷却） */
function heroHoldCancel(){
  if(!SK.hold)return;
  SK.cds[SK.hold.si]=0;                                        // 退还冷却：收起来就不该罚冷却
  SK.hold=null;SK.aimThrow=false;
  heroHoldHide();heroPreviewHide();heroWallGhostHide();heroHudUpdate(true);
}
// 英雄运行时状态（和 S 分开，免得动 S 的字段清单）
var SK={idx:0,cds:[0,0,0],revealAll:0,hold:null,aimThrow:false,holdT:0,holdHideGun:false,
        /* 【batch171】SP 形态：sp=1 时 heroNow() 返回 HERO_SP[idx]；cloak=隐身剩余秒；
           spMarkT=猎杀标记剩余秒；spMarkIds=被标记敌人集合；spDrone=蜂鸟无人机飞行体；
           【batch181】spVeil=蚀日者 SP「白夜」剩余秒；spVeilObj=跟着自己走的黑日 */
        sp:0,cloak:0,spMarkT:0,spMarkIds:null,spDrone:null,spVeil:0,spVeilPulse:0,spVeilObj:null,
        mine:0,mineLife:12,mineX:0,mineZ:0,mineObj:null,mineFly:null,minePing:0,
        blind:0,flashX:0,flashZ:0,
        dashBuff:0,inFortify:false,zoneX:0,zoneY:0,zoneZ:0,   // 【batch143】zoneY：阵地铺在哪张面上
        shield:0,reflect:0,fortify:0,dash:0,dashX:0,dashZ:0,dashLast:0,rush:0,smash:0,
        aura:0,auraX:0,auraZ:0,adren:0,slow:0,hitFlash:0,       // auraX/auraZ：治疗力场的**落点**圆心（batch94）
        shieldObj:null,reflectObj:null,fortifyObj:null,adrenObj:null,rushObj:null,auraObj:null,
        /* 【batch120】蚀日者 / 闪电 的运行态 */
        eclipses:[],inEclipse:false,portalCd:0,portals:[],   // 【batch145】portals ＝ 一对门一条 {a,b,life}
        ghost:0,ghostFrom:null,ghostSi:-1,ghostObj:null,      // 【batch145】虚化：剩余秒 / 身体位置 / 技能号 / 虚影
        suneyeT:0,suneyeObj:null,suneyeR:SUNEYE_R,suneyeX:null,suneyeY:null,suneyeZ:null,
        suneyeN:null,                                        // 【batch143】眼睛所在面的法线（贴墙 / 天花板用）
        orbs:[],traps:[],balls:[],ballLeft:0,ballGap:0,   // 【batch123】球形闪电：装填剩余发数 / 两发之间的小间隔
        shadows:[],shadowT:0,shadowObj:null,              // 【batch158】影月：暗影毒圈列表 / 遁入暗影剩余秒 + 原地残留那团小暗影
        zap:0,overload:0,vuln:0,downed:0,_dbT:0,
        _t:0,_hud:['','',''],_hudPct:[-1,-1,-1],_hudSt:['','','']};
var heroFXList=[];                       // 正在播放的特效片段 {o,life,max,kind,...}
// 闪光弹致盲：整屏「纯白」——头 1 秒不留一点缝（FLASH_WHITE），之后再用 FLASH_FADE 秒慢慢淡出。
// 【为什么改】原来是 opacity 与剩余时间成正比（最高才 0.92），一被闪就开始变淡 → 又暗又短，根本不像闪光。
var _blindEl=null;
function heroBlindSync(){
  if(!_blindEl)_blindEl=document.getElementById('blindFx');
  if(!_blindEl)return;
  var op=0;
  if(SK.blind>0){
    /* 【batch183】致盲总时长按**这一次**致盲的真实时长算（闪光弹 3 秒 / 日冕喷发 2.5 秒 / 白夜 4 秒）——
       以前写死 FLASH_BLIND=3，4 秒的白夜在 2.6 秒就淡出干净，后 1.4 秒其实没被闪。 */
    var total=(SK.blindDur&&SK.blindDur>0)?SK.blindDur:FLASH_BLIND;
    var elapsed=total-SK.blind;                          // 被闪之后过了几秒
    var fade=Math.max(0.3,total-FLASH_WHITE);            // 淡出刚好在致盲结束时归零
    op=(elapsed<FLASH_WHITE)?1:Math.max(0,1-(elapsed-FLASH_WHITE)/fade);
  }else SK.blindDur=0;
  _blindEl.style.opacity=op.toFixed(3);
}
function heroNow(){ if(SK.sp&&HERO_SP[SK.idx])return HERO_SP[SK.idx]; return HEROES[SK.idx]||HEROES[0]; }
function heroSkill(i){var H=heroNow();return H.skills[i]||H.skills[0];}
/* 【batch171】切换 SP 形态（仅熟练度满级的英雄可开）；返回是否成功 */
function heroSpToggle(force){
  try{
    var want=(force===undefined)?!SK.sp:!!force;
    if(want&&!spUnlocked(SK.idx)){showMsg('「'+HEROES[SK.idx].name+'」熟练度满级（Lv.'+SP_MAX_LV+'）才能解锁 SP 形态','#ffd166');return false;}
    SK.sp=want?1:0;
    try{localStorage.setItem(SP_KEY,SK.sp?'1':'0');}catch(e){}
    showMsg(want?('⚡ 已切换为 SP 形态：'+(HERO_SP[SK.idx]?HERO_SP[SK.idx].full:'')):'已恢复原版形态',want?'#ffd166':'#9ab');
    heroHudUpdate(true);
    return true;
  }catch(e){return false;}
}
function heroLoad(){
  unlockLoad();                                       // 【batch126】先读解锁状态，再决定"存档里那个英雄还能不能用"
  try{var v=parseInt(localStorage.getItem(HERO_KEY),10);if(v>=0&&v<HEROES.length)SK.idx=v;}catch(e){}
  if(heroLocked(SK.idx))SK.idx=HERO_SCOUT;            // 选了被锁的英雄（旧存档 / 换了机器）→ 退回天狼
  spXpLoad();
  try{SK.sp=(localStorage.getItem(SP_KEY)==='1')?1:0;}catch(e){}
  if(SK.sp&&!spUnlocked(SK.idx))SK.sp=0;              // 没解锁不能开（换英雄后 sp 状态由选人 UI 重算）
}
function heroSave(){try{localStorage.setItem(HERO_KEY,String(SK.idx));localStorage.setItem(SP_KEY,SK.sp?'1':'0');}catch(e){}}

/* ---------------- 选图 UI（主菜单「🗺 地图」页） ---------------- */
function buildMapGrid(){
  var g=document.getElementById('map-grid');if(!g)return;
  var h='';
  for(var i=0;i<MAPS.length;i++){
    var M=MAPS[i],on=(M.id===curMapId);
    if(typeof NET_MODE!=='undefined'&&NET_MODE==='spike'&&!spikeMapOk(M.id))continue;   /* 【batch166】爆能器模式只显示"声明过支持"的地图 */
    if(M.id==='range'&&!(typeof rangeMode==='function'&&rangeMode()))continue;   /* 【batch180】靶场图只归靶场模式，别在选图界面里露出来 */
    h+='<div class="map-card'+(on?' on':'')+'" data-m="'+M.id+'" style="--c:'+M.color+'">'
      +'<div class="vl-thumb">'+M.icon+'</div>'
      +'<div class="vl-mbody">'
      +'<div class="vl-mtop"><span class="vl-mname">'+M.name+'</span>'+(on?'<span class="vl-mtag">✓ 已选择</span>':'')+'</div>'
      +'<div class="md">'+M.desc+'</div>'
      +'<div class="mc" id="mapCnt-'+M.id+'">当前在线：— 人</div>'
      +'</div></div>';
  }
  g.innerHTML=h;
  var cards=g.querySelectorAll('.map-card');
  for(var c=0;c<cards.length;c++){
    cards[c].addEventListener('click',function(){
      var id=this.getAttribute('data-m');
      if(!mapById(id)||id===curMapId)return;
      setMap(id);buildMapGrid();
      /* 【batch167】联机时**必须把换图告诉服务端**：地图是房间钥匙的一部分 ——
         以前只在本地换图、服务端不知道，于是"不同地图的人会被算进同一间房"（还能组队）。 */
      try{if(typeof netIsMulti==='function'&&netIsMulti()&&NET.connected)netSend({t:'map',m:id});}catch(e){}
      showMsg('已选地图：'+mapNow().name,mapNow().color);
    });
  }
}
/* ---------------- 选人 UI（主菜单「🦸 英雄」页）：每张卡列出 3 个技能 ---------------- */
function buildHeroGrid(){
  var g=document.getElementById('hero-grid');if(!g)return;
  /* 左列：6 张紧凑特工卡（色条 + 头像 + 名字 + 阵营 + 定位 + 3 个技能图标 + 被动一行）
     —— `class="hero-card"` 必须恰好 6 个、`class="hs"` 18 个、`🧬 被动` 6 个，探针会数。
     【batch124】按阵营插分组标题（未来 / 无阵营 / 暗月），**只影响显示，不动 HEROES 下标**
     —— 下标一动，HERO_SCOUT 那些常量和 localStorage 里存的英雄号就全错位了。 */
  var FACTINT={'未来':'#4fc3ff','暗月':'#a98cff','无阵营':'#ffd75e'};
  function facColor(f){return FACTINT[f]||'#8ea3c0';}
  var h='<div class="vl-list">';
  var lastGroup=null;
  for(var i=0;i<HEROES.length;i++){
    var H=HEROES[i],on=(i===SK.idx);
    /* 【batch124】**全游戏只有两个组织**：未来（正规军）/ 暗月（佣兵团）。
       蚀日者不隶属任何组织（它是本季被双方争夺的目标），所以它的那一段标题写"本季核心"，
       而不是硬造第三个阵营 —— 数据上它的 fac 就是空字符串。 */
    var gkey=H.fac||'核心';
    if(gkey!==lastGroup){
      if(H.fac){
        h+='<div class="vl-group" style="color:'+facColor(H.fac)+'">◈ '+H.fac
          +(H.facDesc?('<span style="color:#8ea3c0;font-weight:600"> · '+H.facDesc+'</span>'):'')+'</div>';
      }else{
        h+='<div class="vl-group" style="color:#ffd75e">★ 本季核心'
          +'<span style="color:#8ea3c0;font-weight:600"> · '+H.facDesc+'</span></div>';
      }
      lastGroup=gkey;
    }
    var lk=heroLocked(i);                                     // 【batch126】锁定的英雄仍然显示，但选不了
    h+='<div class="hero-card" data-h="'+i+'"'+(lk?' data-lock="1" title="'+lk+'"':'')
      +' style="--c:'+H.css+';'+(on?'box-shadow:inset 0 0 0 2px #ff4655':'')+(lk?';opacity:.55':'')+'">'
      +'<div class="vl-face">'+H.icon+'</div>'
      +'<div class="vl-name"><span class="vl-nm">'+H.name+'</span>'+(H.fac?('<span class="vl-fac" style="color:'+facColor(H.fac)+'">'+H.fac+'</span>'):'')
        +(lk?('<span class="vl-lock">🔒 锁定</span>'):'')+(H._mod?('<span class="vl-mod">🧩 模组</span>'):'')+'</div>'
      +'<div class="vl-role">'+H.tag+'</div>'
      +'<div class="vl-keys">';
    for(var j=0;j<H.skills.length;j++) h+='<span class="hs">'+H.skills[j].icon+'</span>';
    /* 【batch171】熟练度条（下标 0~4 有：四个正规军 + 蚀日者）：满级显示 ⚡SP 徽标 */
    if(i<5){
      var xp=spXpProgress(i);
      h+='<div class="vl-xp" title="熟练度 Lv.'+xp.lv+'/'+SP_MAX_LV+'">'
        +'<span class="vl-xplv">熟练度 Lv.'+xp.lv+'/'+SP_MAX_LV+'</span>'
        +(xp.lv>=SP_MAX_LV?'<span class="vl-sptag">⚡SP 已解锁</span>':'')
        +'<div class="vl-xpbar"><i style="width:'+(xp.pct*100).toFixed(0)+'%'+(xp.lv>=SP_MAX_LV?';background:#ffd166':'')+'"></i></div>'
        +'</div>';
    }
    h+='</div>'
      +'<div class="hd">🧬 被动 · '+(H.passive||'')+'</div>'
      +'</div>';
  }
  h+='</div>';
  /* 右半边：选中那位特工的大立绘位 + 3 条技能详情 + 被动
     （这里的被动故意写成「🧬 常驻被动」，不然 `🧬 被动` 会从 4 个变成 5 个，探针会红） */
  var sel=HEROES[SK.idx]||HEROES[0];
  var selSp=(SK.sp&&HERO_SP[SK.idx])?HERO_SP[SK.idx]:null;    // 【batch171】SP 激活时详情区显示 SP 数据
  var selD=selSp||sel;
  h+='<div class="vl-detail">'
    +'<div class="vl-big" style="--c:'+(selSp?selSp.css:sel.css)+'">'
    +'<div class="vl-bigicon">'+selD.icon+'</div>'
    +'<div class="vl-watermark">'+selD.name+'</div>'
    +'<div class="vl-sel">✓ 已选择</div>'
    +'</div>'
    +'<div class="vl-dname">'+selD.name+(selSp?' <span class="vl-spflag">⚡SP 形态</span>':'')+'</div>'
    +'<div class="vl-drole">定位 · '+selD.tag+'</div>'
    +'<div class="vl-dfac">◈ 阵营 · <b style="color:'+facColor(sel.fac)+'">'+sel.fac+'</b>'
    +(sel.facDesc?('（'+sel.facDesc+'）'):'')+'</div>';
  for(var k=0;k<selD.skills.length;k++){
    var s=selD.skills[k];
    h+='<div class="vl-sk">'
      +'<div class="vl-skico">'+s.icon+'<b>'+['V','B','N'][k]+'</b></div>'
      +'<div class="vl-skname">'+s.name+'<span class="vl-skcd">冷却 '+s.cd+' 秒'+(s.dur?(' · 持续 '+s.dur+' 秒'):'')+'</span></div>'
      +'<div class="vl-skdesc">'+s.desc.replace(/\*\*/g,'')+'</div>'
      +'</div>';
  }
  var _sl=heroLocked(SK.idx);
  if(_sl)h+='<div class="vl-dlock">🔒 暂时锁定 · '+_sl+'</div>';
  /* 【batch171】SP 切换盒（熟练度满级才出现） */
  if(SK.idx<5&&spUnlocked(SK.idx)){
    h+='<div class="vl-spbox'+(SK.sp?' on':'')+'">'
      +'<div class="vl-sptitle">⚡ SP 形态 · '+(HERO_SP[SK.idx]?HERO_SP[SK.idx].full:'')+'</div>'
      +'<div class="vl-spdesc">'+(HERO_SP[SK.idx]?HERO_SP[SK.idx].passive:'')+'</div>'
      +'<button class="vl-spbtn" id="vlSpBtn">'+(SK.sp?'↩ 恢复原版形态':'⚡ 切换为 SP 形态')+'</button>'
      +'</div>';
  }
  h+='<div class="vl-passive">🧬 常驻被动 · '+(selD.passive||'')+'</div>'
    +'</div>';
  g.innerHTML=h;
  var cards=g.querySelectorAll('.hero-card');
  for(var c=0;c<cards.length;c++){
    cards[c].addEventListener('click',function(){
      var k=parseInt(this.getAttribute('data-h'),10)||0;
      var _lk=heroLocked(k);
      if(_lk){showMsg('🔒 '+HEROES[k].name+' 暂时锁定：'+_lk,'#ffb454');return;}
      if(k===SK.idx)return;
      // 【局内不许换英雄】一局打起来以后换英雄＝半路换成另一套技能，既破坏平衡，
      // 又能靠"换英雄重置三个技能冷却"刷技能。想换就先把这一局打完 / 退出对局。
      if(S.playing&&!S.over){showMsg('局内不能更换英雄：先打完这一局或退出对局后再换','#ffd166');return;}
      SK.idx=k;SK.cds=[0,0,0];
      if(SK.sp&&!spUnlocked(SK.idx))SK.sp=0;   // 【batch171】换到没满级的英雄 → 自动关 SP
      heroSave();buildHeroGrid();   // 换英雄：三个技能冷却一并重置（与服务端按英雄记冷却一致）
      try{if(typeof NET!=='undefined'&&NET&&NET.connected&&typeof netSend==='function')netSend({t:'hero',h:SK.idx});}catch(e){}   // 【模组英雄·多人】把换英雄广播给同房玩家
      showMsg('已选英雄：'+heroNow().name+(SK.sp?'（⚡SP 形态）':'')+'（3 个技能：V / B / N）',heroNow().css);
      heroHudUpdate(true);
    });
  }
  /* 【batch171】SP 切换钮绑定（详情区里那个） */
  var _spb=document.getElementById('vlSpBtn');
  if(_spb)_spb.addEventListener('click',function(e){
    e.stopPropagation();
    if(heroSpToggle())buildHeroGrid();
  });
}
/* ---------------- 技能 HUD（3 格） ---------------- */
var _heroHudBuilt=false;
function heroBuildHud(){
  var el=document.getElementById('skillHud');if(!el)return;
  if(_heroHudBuilt)return;
  var h='';
  for(var i=0;i<3;i++){
    h+='<div class="skSlot" id="skSlot'+i+'">'
      +'<div class="skIcon"></div><div class="skName"></div><div class="skKey"></div>'
      +'<div class="skBarWrap"><div class="skBar"></div></div></div>';
  }
  el.innerHTML=h;_heroHudBuilt=true;
}
function heroHudUpdate(force){
  var el=document.getElementById('skillHud');if(!el)return;
  var show=!!(S.playing&&!S.over&&!S.paused);
  if(!show){if(el.style.display!=='none')el.style.display='none';return;}
  if(el.style.display!=='flex')el.style.display='flex';
  var H=heroNow(),touch=(typeof isTouch!=='undefined'&&isTouch);
  for(var i=0;i<3;i++){
    var s=H.skills[i],slot=document.getElementById('skSlot'+i);
    if(!slot||typeof slot.querySelector!=='function')continue;   // 校验桩的精简 DOM 没有 querySelector
    var cd=SK.cds[i],pct=(s.cd>0)?(1-cd/s.cd):1;
    var ready=(cd<=0.05);
    /* 【batch123】球形闪电装填中：这个槽位显示「还剩几发」，并且算作「现在就绪」 */
    var armed=(i===2&&SK.idx===HERO_LIGHTNING&&SK.ballLeft>0);
    if(armed){ready=true;pct=1;}
    var kf=(i===0?'skill':('skill'+(i+1)));
    var keyTxt=touch?'按钮':((typeof codeLabel==='function')?codeLabel(KEYMAP[kf]):'?');
    var txt=s.icon+'|'+s.name+'|'+(armed?('装填 '+SK.ballLeft+' 发'):(ready?'就绪':('冷却 '+cd.toFixed(1)+' 秒')));
    if(force||txt!==SK._hud[i]||Math.abs(pct-SK._hudPct[i])>0.005||SK._hudSt[i]!==(ready?'ready':'no')){
      SK._hud[i]=txt;SK._hudPct[i]=pct;SK._hudSt[i]=ready?'ready':'no';
      slot.className='skSlot '+(ready?'ready':'no');
      var ic=slot.querySelector('.skIcon');
      if(ic){ic.textContent=s.icon;ic.style.background=H.css;ic.style.color='#10131c';ic.style.opacity=ready?'1':'.5';}
      var nm=slot.querySelector('.skName');if(nm)nm.textContent=(SK.sp?'⚡SP ':'')+'['+keyTxt+'] '+s.name;
      var kk=slot.querySelector('.skKey');if(kk)kk.textContent=armed?('×'+SK.ballLeft):(ready?'就绪':(cd.toFixed(1)+'s'));
      var bar=slot.querySelector('.skBar');
      if(bar){bar.style.width=(pct*100).toFixed(1)+'%';bar.style.background=H.css;}
    }
  }
}
/* ---------------- 减伤 / 免疫（单机本地结算；联机由服务端同口径结算） ----------------
   反射力场不再是"无敌"，而是**伤害减半 + 另一半反弹给开枪的人**（这才叫反射）；
   堡垒工事不再是"自己减伤"，而是**脚下的阵地**：站在圈里才减伤（SK.inFortify 每帧判定）。 */
function heroMitigate(dmg){
  if(SK.vuln>0)dmg=Math.max(1,Math.round(dmg*ORB_VULN));   // 【batch120】闪电「易伤」：受到伤害 +25%
  if(SK.spVeil>0){SK.hitFlash=0.20;return Math.max(1,Math.round(dmg*0.3));}   // 【batch181】蚀日者 SP「白夜」：减伤 70%
  if(SK.reflect>0){SK.hitFlash=0.22;return Math.max(1,Math.round(dmg*0.5));}   // 反射力场：减半（另一半反弹）
  if(SK.shield>0){SK.hitFlash=0.22;return Math.max(1,Math.round(dmg*0.3));}    // 护盾：减伤 70%
  if(SK.inFortify){SK.hitFlash=0.12;return Math.max(1,Math.round(dmg*0.7));}   // 堡垒阵地内：减伤 30%
  if(SK.inDome){SK.hitFlash=0.12;return Math.max(1,Math.round(dmg*0.5));}      // 【batch173】力场穹顶内：减伤 50%
  if(SK.sp&&typeof SP_ZONES!=='undefined'){                                    // 【batch173】镇岳 SP 被动：贴着自己放的掩体墙（3 米内）减伤 15%
    for(var _wi=0;_wi<SP_ZONES.length;_wi++){
      var _wz=SP_ZONES[_wi];
      if(_wz.kind!=='wall'||_wz.remote)continue;
      var _wx=camera.position.x-_wz.x,_wz2=camera.position.z-_wz.z;
      if(_wx*_wx+_wz2*_wz2<=9){SK.hitFlash=0.10;return Math.max(1,Math.round(dmg*0.85));}
    }
  }
  return dmg;
}
/* 移动速度倍率（被移动代码调用） */
function heroSpeedMul(){
  var m=1;
  if(SK.rush>0)m*=1.55;                                   // 冲锋号令 +55%
  if(SK.dashBuff>0)m*=1.25;                               // 战术突进余势 +25%
  if(SK.adren>0)m*=1.35;                                  // 肾上腺素 +35%
  if(SK.cloak>0)m*=1.15;                                  // 【batch173】暗哨被动：隐身期间 +15%
  if(SK.reflect>0)m*=0.8;                                 // 反射力场撑盾时变慢
  if(SK.slow>0&&!(SK.adren>0)&&!SK.inFortify)m*=0.6;       // 被减速（肾上腺素 / 阵地免疫）
  // 【batch100 被动】流火：开镜时机动性更强（普通兵种开镜只是走路，流火开镜还更快）
  if(SK.idx===HERO_RUSHER&&S.aiming&&currentWeapon===WEAPON_GUN)m*=PASSIVE_ADS_SPEED;
  /* 【batch120 被动】蚀日者「日冕庇护」：站在自己的日蚀圈里 +15% */
  if(SK.idx===HERO_ECLIPSE&&SK.inEclipse)m*=PASSIVE_ECLIPSE_SPD;
  /* 【batch181】焚曜「白夜」期间：移速 +30% */
  if(SK.sp&&SK.idx===HERO_ECLIPSE&&SK.spVeil>0)m*=1.30;
  /* 【batch120 被动】闪电「电光疾行」：冲刺中再 +12% */
  if(SK.idx===HERO_LIGHTNING&&S.sprinting)m*=PASSIVE_LIGHT_SPRINT;
  /* 【batch123b】倒地：**一步都动不了**（用户要求：被击倒的人不能干任何事，比如行走 / 开火）。
     原来给的是 ×0.35"慢慢爬"，现在直接归零；跳 / 爬梯 / 冲刺另在 updatePlayer 里
     每帧清空所有按键输入（见那里的说明）。 */
  /* 【batch171】SP·暗哨被动：隐身移速 +15%；猎杀标记期间（冲向猎物）+20% */
  if(SK.sp&&SK.idx===HERO_SCOUT){ if(SK.cloak>0)m*=1.15; if(SK.spMarkT>0)m*=1.25; }
  if(SK.downed>0)return 0;
  return m;
}
/* ---------------- 英雄被动（batch100） ----------------
   天狼「敌情预警」：附近有敌人 → 从准星朝那个方向闪红色箭头（updateScoutAlert 每帧刷新）
   白泽「医者仁心」：受到的治疗 +50%；身处烟雾中再 +50%（heroHealMul，被所有回血点调用）
   流火「开镜机动」写在 heroSpeedMul 里；镇岳「手雷减伤」写在 heroFragLocal 里。 */
/* 【batch107】站在烟里＝屏幕上也要"白成一片"。判定和白泽"身处烟雾中"完全同源，
   所以"能回血"和"看不清外面"永远同时成立。 */
var _smokeFxC=null,_smokeFxP=0,_smokeFxGold=false,_smokeFxDark=false,_smokeFxT=0;
var _烟雾背景P=-1;                                               // 【batch198】上一次写进 backdrop-filter 的浓度（-1＝已关）
function smokeCoverAt(x,y,z){
  var best=0;
  for(var i=0;i<smokeZones.length;i++){
    var s=smokeZones[i];if(s.t<=0)continue;
    /* 【batch135】高低差容差 6.5 → 3.0 米（一层楼约 3 米）。
       原来 6.5 米会把"二楼的烟"也算到一楼头上 —— 一楼莫名其妙白成一片。
       同一层（±3 米）照旧"人在烟里＝屏幕全白"，和白泽回血判定同源。 */
    if(Math.abs((s.y==null?0.6:s.y)+1.6-y)>3.0)continue;
    var dx=x-s.x,dz=z-s.z,d=Math.sqrt(dx*dx+dz*dz);
    var k=1-Math.max(0,Math.min(1,(d-s.r*0.55)/(s.r*0.45)));       // 圈心最浓 → 到判定圈边缘渐隐
    if(k>best){best=k;_smokeFxGold=!!s.gold;_smokeFxDark=!!s.dark;}
  }
  return best;
}
function updateSmokeScreen(){
  var now=performance.now(),dt=Math.min((now-(_smokeFxT||now))/1000,0.05);_smokeFxT=now;
  var k=smokeCoverAt(camera.position.x,camera.position.y,camera.position.z);
  _smokeFxP+=(k-_smokeFxP)*Math.min(1,dt*(k>_smokeFxP?9:5));       // 进烟快、出烟慢
  var p=_smokeFxP;
  if(p<0.01&&k<=0){ p=0; _smokeFxP=0; }
  /* 【batch200】正常路径：屏幕烟雾**整体进后处理合成 pass**（POST.设烟）——
     原来那层 DOM（#smokeFx 白雾 + backdrop-filter 全屏模糊）不再使用。
     为什么：backdrop-filter 会逼浏览器把 canvas 后面的内容整屏重新采样一遍，外加一次
     compositor 全屏拷贝，是整条渲染链上最贵的一步；换来的只是"模糊 + 降对比 + 加白"。
     挪进合成里只多 5 次纹理采样，还能和 AO/色调同色彩空间，不会因 DOM 透明度叠加偏色。
     效果完全对齐：模糊 → 提亮 → 降对比 → 按 SMOKE_SCREEN_OP 叠白雾。 */
  if(typeof POST!=='undefined'&&POST&&typeof POST.设烟==='function'&&POST.初始化&&POST.初始化()){
    POST.设烟(p,_smokeFxGold,_smokeFxDark);
    if(_烟雾背景P!==-2){                                   // 只在这一刻清一次 DOM，别每帧写样式
      _烟雾背景P=-2;
      if(!_smokeFxC)_smokeFxC=document.getElementById('smokeFx');
      if(_smokeFxC){
        _smokeFxC.style.opacity='0';
        _smokeFxC.style.backdropFilter='none';_smokeFxC.style.webkitBackdropFilter='none';
      }
    }
    return;
  }
  /* ---------- 兜底：后处理不可用（初始化失败 / 被关掉）→ 退回原来的 DOM 全屏雾 ---------- */
  if(!_smokeFxC)_smokeFxC=document.getElementById('smokeFx');
  if(!_smokeFxC)return;
  if(p<0.01&&k<=0){
    if(_smokeFxC.style.opacity!=='0')_smokeFxC.style.opacity='0';
    /* 顺带把滤镜摘掉（下面的统一出口也会摘，这里只是省一次函数尾部的判断） */
    if(_烟雾背景P!==-1){_烟雾背景P=-1;_smokeFxC.style.backdropFilter='none';_smokeFxC.style.webkitBackdropFilter='none';}
    return;
  }
  _smokeFxC.style.background=_smokeFxDark?'#241a45':_smokeFxGold?'#e9d9a6':'#dfe6ec';   // 【batch161】暗影烟=深紫屏罩
  _smokeFxC.style.opacity=(SMOKE_SCREEN_OP*_smokeFxP).toFixed(3);
  /* 【batch198】用户报的 bug：站在烟里/透过半透明技能，还能看清敌人投在地上的**影子** ——
     人能糊掉，影子是"暗 vs 亮"的高对比，隔着 18% 的透光照样认得出轮廓，等于透视位置。
     只叠一层白雾治不了这个（白雾均匀加亮，暗部依旧暗）。
     所以雾里同时做 **模糊 + 降对比 + 抬亮**：影子被糊成一片灰，轮廓彻底认不出。
     只要还在烟里（k>0）或残雾还浓（≥0.06）就挂着滤镜；两者都不成立＝人已出来、雾淡到看不见，
     立刻摘掉（挂着就在白算全屏模糊，opacity=0 也照算）。
     浓度变化超过 0.06 才写 DOM（每帧写字符串会触发样式重算）。*/
  if(k<=0&&p<0.06){
    if(_烟雾背景P!==-1){
      _烟雾背景P=-1;
      _smokeFxC.style.backdropFilter='none';_smokeFxC.style.webkitBackdropFilter='none';
    }
  }else if(Math.abs(p-_烟雾背景P)>0.06||(p>0.02&&_烟雾背景P<0)){
    _烟雾背景P=p;
    var bf='blur('+(3.2*p).toFixed(2)+'px) contrast('+(1-0.62*p).toFixed(3)+
           ') brightness('+(1+0.22*p).toFixed(3)+') saturate('+(1-0.45*p).toFixed(3)+')';
    _smokeFxC.style.backdropFilter=bf;_smokeFxC.style.webkitBackdropFilter=bf;
  }
}
function heroInSmoke(x,z){
  for(var i=0;i<smokeZones.length;i++){
    var s=smokeZones[i];if(s.t<=0)continue;
    var dx=x-s.x,dz=z-s.z;if(dx*dx+dz*dz<=s.r*s.r)return true;
  }
  return false;
}
function heroHealMul(){
  if(SK.idx!==HERO_MEDIC)return 1;                        // 只有白泽吃到治疗增益
  var m=PASSIVE_MEDIC_HEAL;
  if(heroInSmoke(camera.position.x,camera.position.z))m*=PASSIVE_MEDIC_SMOKE;
  return m;
}
/* 天狼「敌情预警」：找 PASSIVE_SCOUT_R 米内最近的敌人，把箭头转到那个方向（前方＝0°，顺时针为正） */
function updateScoutAlert(){
  var el=document.getElementById('scoutAlert'),ar=document.getElementById('scoutArrow');
  if(!el)return;
  if(SK.idx!==HERO_SCOUT||!S.playing||S.over||S.paused||S.hp<=0){if(el.style.display!=='none')el.style.display='none';return;}
  var px=camera.position.x,pz=camera.position.z,bd=PASSIVE_SCOUT_R*PASSIVE_SCOUT_R,dx=0,dz=0,found=false;
  for(var i=0;i<enemies.length;i++){
    var e=enemies[i];if(!e||e.hp<=0||!e.root)continue;
    var ex=e.root.position.x-px,ez=e.root.position.z-pz,d2=ex*ex+ez*ez;   // 世界坐标在 root（联机玩家 / AI 都一样）
    if(d2<bd){bd=d2;dx=ex;dz=ez;found=true;}
  }
  if(!found){if(el.style.display!=='none')el.style.display='none';return;}
  if(el.style.display!=='block')el.style.display='block';
  var d=Math.sqrt(bd),near=1-d/PASSIVE_SCOUT_R;if(near<0)near=0;else if(near>1)near=1;
  var fd=dx*(-Math.sin(yaw))+dz*(-Math.cos(yaw)),rd=dx*Math.cos(yaw)+dz*(-Math.sin(yaw));
  var ang=Math.atan2(rd,fd)*180/Math.PI;                  // 0°＝正前，+90°＝正右
  if(ar){ar.style.transform='rotate('+ang.toFixed(0)+'deg)';ar.style.opacity=(0.45+0.55*near).toFixed(2);}
  el.style.opacity=(0.4+0.6*near).toFixed(2);
}
/* ---------------- 释放（i＝第几个技能，0/1/2 对应 V/B/N） ---------------- */
var throwInfo=null;                        // 本次投掷的参数（出生点 + 初速），联机时广播给别人复现飞行
var ballTargets=null;                      // 【batch120】球形闪电本次锁定的目标 id 列表（联机交给服务端校验）
/* 【模组·自定义技能】模组用 ModLoader.addSkill(k, fn) 往 CUSTOM_SKILLS 注册"全新技能效果"（见 mode/ 模组加载器.js） */
var CUSTOM_SKILLS = {};
function heroCast(i){
  i=i|0;
  throwInfo=null;ballTargets=null;
  /* 【batch145】虚化中：再按一次技能键 = 在当前位置**放下门**（不用等冷却，也不受其它限制） */
  if(SK.ghost>0){if(i===SK.ghostSi)heroPortalPlace();return true;}
  if(SK.downed>0){showMsg('倒地中：被扶起来才能用技能','#ffd166');return false;}   // 【batch120】
  if(!S.playing||S.over||S.paused)return false;
  if(netIsMulti()&&(typeof NET!=='undefined')&&NET.dead)return false;
  if(S.hp<=0)return false;
  var H=heroNow(),s=H.skills[i];
  var multi=netIsMulti(),k=s.k;
  /* 【batch159】遁入暗影的"再按退出"必须放在冷却门**之前** ——
     否则冷却 90 秒里按第二次只会提示"冷却中"，人根本退不出暗影（探针抓到的真 bug）。 */
  if(k==='sshadow'&&SK.shadowT>0){heroShadowExit();return true;}
  if(SK.cds[i]>0){showMsg(s.name+' 冷却中（还剩 '+SK.cds[i].toFixed(1)+' 秒）','#ffd166');return false;}
  var _prevCd=SK.cds[i];   // 【batch158】遁入暗影"再按退出"要还原冷却，不能重新计满 90 秒
  if(k!=='sp_wall')SK.cds[i]=s.cd;
  if(typeof rangeMode==='function'&&rangeMode()){SK.cds[i]=0;SK.cds[0]=0;SK.cds[1]=0;SK.cds[2]=0;}   /* 【batch180】靶场：技能无冷却，随便放 */   // 【batch178】墙：举起不扣冷却，放下才扣
  /* 【模组·自定义技能钩子】模组注册的 k 会先在这里被拦截：fn(i, s, H) 返回 false 才交给下面的原版分支。
     这样模组就能做出"原版没有的"技能效果，而不必复用 dash/shield/eye 等原版技能。 */
  if (typeof CUSTOM_SKILLS !== 'undefined' && CUSTOM_SKILLS[k]) {
    var _cs = CUSTOM_SKILLS[k](i, s, H);
    if (_cs !== false) {
      if (multi && NET.connected) {
        var _sx = camera.position.x, _sz = camera.position.z, _sy = standSurfY();
        netSend({ t: 'skill', k: H.k, s: i, x: _sx, y: _sy, z: _sz });
      }
      showMsg('释放：' + s.name, H.css);
      heroHudUpdate(true);
      return true;
    }
  }
  /* 【batch171】SP 形态技能分发：机制与原版完全不同，统一走 SP_SKILLS 表（同片定义）。
     返回 true = 已处理（含进冷却/联机上报）；false = 该技能未实装，继续走原版链。 */
  if(SK.sp&&typeof SP_SKILLS!=='undefined'&&SP_SKILLS[k]){
    if(SP_SKILLS[k](i,s,H)!==false){
      if(k!=='sp_wall'&&multi&&NET.connected){
        var _spx=camera.position.x,_spz=camera.position.z,_spy=standSurfY();
        netSend({t:'skill',k:H.k,s:i,x:_spx,y:_spy,z:_spz});
      }
      if(k!=='sp_wall')showMsg('释放：'+s.name,H.css);
      heroHudUpdate(true);
      return true;
    }
  }
  if(THROW_KINDS[k]){
    // 投掷类技能：先**拿在手里**，不直接扔出去 ——
    // 真正的抛投是「长按开火键瞄准（看半透明抛物线）→ 松手抛出」，见 heroAimStart / heroAimEnd。
    if(SK.hold&&SK.hold.si===i){heroHoldCancel();showMsg('已收起「'+s.name+'」','#ffd166');return true;}
    if(SK.hold)heroHoldCancel();
    SK.hold={kind:k,si:i};
    heroHoldShow(k);
    showMsg('已拿起「'+s.name+'」：长按开火键瞄准（半透明抛物线＝落点），松手抛出；再按一次技能键收起',H.css);
    heroHudUpdate(true);
    return true;
  }
  /* 【batch145】蚀日者 ②「日蚀之门」：不是投掷 —— 按下先**虚化**（身体留在原地、视角自由飘），
     放门与回身都在 heroPortalPlace() 里完成。 */
  else if(k==='portal'){heroPortalCast();}
  /* 【batch158】⑦影月 N「遁入暗影」：退出走上面的前置分支（不受冷却门拦），这里只管进入 */
  else if(k==='sshadow'){
    if(SK.hold)heroHoldCancel();
    if(SK.ghost>0)return true;
    heroShadowEnter();
  }
  else if(k==='eye'){SK.revealAll=Math.max(SK.revealAll,s.dur);heroFXEye();}
  else if(k==='dash'){
    var sy=Math.sin(yaw),cy=Math.cos(yaw);
    SK.dashX=-sy;SK.dashZ=-cy;SK.dash=0.30;SK.dashLast=0;
    SK.dashBuff=Math.max(SK.dashBuff,2.5);heroFXTrail();          // 突进余势：2.5 秒 +25% 移速
  }
  else if(k==='rush'){SK.rush=s.dur;heroFXRush();}
  else if(k==='smash'){heroFXSmash();if(!multi)heroSmashLocal(5,25,2,KNOCK_DIST);}
  else if(k==='shield'){SK.shield=s.dur;heroFXShield();}
  else if(k==='reflect'){SK.reflect=s.dur;heroFXReflect();}
  else if(k==='fortify'){
    /* 【batch143】阵地铺在**脚下那张面**上（地面 / 二楼楼板 / 平台 / 箱子顶），
       不再写死 y≈0.05 —— 站在二楼放，圈就在二楼（用户："应该贴在脚下，而不是默认贴在地板上"）。 */
    SK.zoneX=camera.position.x;SK.zoneZ=camera.position.z;SK.zoneY=standSurfY();
    SK.fortify=s.dur;SK.inFortify=true;heroFXFortify();
  }
  // ①医疗脉冲（batch94）：改成投掷物 —— 上面 THROW_KINDS 分支已经接管（拿在手里 → 瞄准 → 抛出）
  else if(k==='adren'){SK.adren=s.dur;heroFXAdren();}
  /* 【batch120】⑤蚀日者 N「日之眼」；【batch125】改成投掷类：扔出去落地成眼，眼钉在落点
     （THROW_KINDS 分支已经接管"持握 → 瞄准 → 抛出"，这里不会再走到） */
  /* 【batch120】⑥闪电 N「球形闪电」；【batch123】改成「装填 3 发、左键一发一发打出去」 */
  else if(k==='ball'){heroBallArm();}
  if(k!=='pulse'&&k!=='medkit'&&k!=='portal')showMsg('释放：'+s.name,H.css);   // 【batch145】portal 自己有条更详细的提示
  if(multi&&NET.connected){                                  // 联机：服务端结算 + 通知别人播特效
    /* 【batch143】所有技能报文都带上「施放点 + 脚下那张面的高度」——
       别人的堡垒阵地要铺在**同一层楼**上（以前只发英雄和技能号，
       别人只能按自己的脚底高度猜）。 */
    var _skx=camera.position.x,_skz=camera.position.z,_sky=standSurfY();
    if(throwInfo)netSend({t:'skill',k:H.k,s:i,th:throwInfo});   // 投掷物把「出生点+初速」发出去，别人才能看见它飞
    else if(ballTargets)netSend({t:'skill',k:H.k,s:i,tgt:ballTargets,x:_skx,y:_sky,z:_skz});   // 【batch120】球形闪电
    else netSend({t:'skill',k:H.k,s:i,x:_skx,y:_sky,z:_skz});
  }
  heroHudUpdate(true);
  return true;
}
/* ==================== 【batch171】SP 技能表 ====================
   SP_SKILLS[k] = 该技能的效果函数（i=槽位, s=技能数据, H=英雄数据）。
   返回 false = 未实装（heroCast 继续走原版链）；true = 已处理。
   天狼三技能已全实装；其余三套的机制下轮补全（先占位，不崩、有提示）。 */
var SP_SKILLS={};
/* ---- 天狼 · 暗哨 ----
   ① 光学隐身：AI 视线断（canSeePlayer 已判 SK.cloak），开枪/受伤破隐（attack/hurt 已接） */
/* 【batch173 联机】隐身状态同步：自己开/破隐时上报一次，服务端广播给同房其他人 →
   别人的客户端把你的模型藏起来（状态没变就不发，避免每帧刷屏）。 */
function spCloakSync(){
  try{ if(typeof netIsMulti!=='function'||!netIsMulti())return; }catch(e){return;}
  var on=SK.cloak>0;
  if(on===SK._cloakNet)return;
  SK._cloakNet=on;
  try{ netSend({t:'spCloak',T:on?Math.round(SK.cloak*1000):0}); }catch(e){}
}
SP_SKILLS['sp_cloak']=function(i,s,H){
  SK.cloak=Math.max(SK.cloak,s.dur);
  spCloakSync();                                        /* 【batch173】联机：告诉别人「我隐身了」 */
  try{heroFXEye();}catch(e){}                       // 借个无色环当起手视觉
  showMsg('光学隐身：小兵看不见你（开枪/受伤会破隐）',H.css);
  return true;
};
/* ② 猎杀标记：**全图**敌人进集合（batch172 用户：原版都能全图标记，SP 不能只给 25 米），
   标记/易伤+30%/加速+25%/小地图全部读这个集合 */
SP_SKILLS['sp_mark']=function(i,s,H){
  SK.spMarkT=Math.max(SK.spMarkT,s.dur);
  var ids=SK.spMarkIds||(SK.spMarkIds={});
  var n=0;
  for(var j=0;j<enemies.length;j++){var e=enemies[j];
    if(e.isNet?(!e.alive):(e.hp<=0))continue;
    ids[e.__oid__||(e.__oid__='m'+j)]=1;n++;   /* 【batch172】全图：不再限 25 米 */
  }
  heroFXEye();
  showMsg('猎杀标记：全图 '+n+' 个目标（伤害+30%、移速+25%）',H.css);
  return true;
};
/* ③ 蜂鸟无人机：交给原版投掷流程（THROW_KINDS：拿起→看直线轨迹→左键抛出/右键取消），
   出手逻辑在 heroDoThrow 的 sp_drone 分支。 */
SP_SKILLS['sp_drone']=function(i,s,H){ return false; };
/* 无人机每帧更新（updateHero 调用） */
/* 【batch176】实体高度换算（联机能打中人的关键）：
     · 本地小兵：root.position.y = **脚底**（0）→ 胸部 = y+1.0
     · 远端玩家：root.position.y = **相机高度**（约 1.6，蹲下约 1.0）→ 脚底 = y-1.6，胸部 = y-0.6
   不换算的话，对真人的判定点会凭空高 1.5 米 —— 看着打中了、实际判定从他头顶过去。 */
function spEntChestY(e,ep){ return e&&e.isNet ? (ep.y-0.6) : (ep.y+1.0); }
function spEntFootY(e,ep){  return e&&e.isNet ? (ep.y-1.6) : ep.y; }
/* 点到线段的最短距离（无人机连续命中判定用：不再靠"每帧一个点"碰运气） */
function spSegPointDist(a,b,px,py,pz){
  var abx=b.x-a.x,aby=b.y-a.y,abz=b.z-a.z;
  var apx=px-a.x,apy=py-a.y,apz=pz-a.z;
  var ab2=abx*abx+aby*aby+abz*abz;
  var t=ab2>0?Math.max(0,Math.min(1,(apx*abx+apy*aby+apz*abz)/ab2)):0;
  var dx=apx-abx*t,dy=apy-aby*t,dz=apz-abz*t;
  return Math.sqrt(dx*dx+dy*dy+dz*dz);
}
function updateSpDrone(dt){
  var d=SK.spDrone;if(!d)return;
  d.t+=dt;
  /* 旋翼狂转（蜂鸟的味儿） */
  var _rt=d.mesh.userData&&d.mesh.userData.rotors;
  if(_rt){_rt[0].rotation.y+=dt*55;_rt[1].rotation.y+=dt*55;}
  /* 【batch176】软制导：前方 25 米、偏离 35° 内有敌人 → 蜂鸟自己微调扑过去。
     没有制导时，只要瞄得稍偏一点（或者敌人在动）就一定空 —— 这也是"打不中"的一大来源。 */
  try{
    var _best=null,_bd=1e9;
    for(var b=0;b<enemies.length;b++){
      var be=enemies[b];
      if(be.isNet?(!be.alive):(be.hp<=0))continue;
      var bp=(be.isNet&&typeof heroEntWorld==='function')?heroEntWorld(be):be.root.position;
      var vx=bp.x-d.mesh.position.x,vy=spEntChestY(be,bp)-d.mesh.position.y,vz=bp.z-d.mesh.position.z;
      var dist=Math.sqrt(vx*vx+vy*vy+vz*vz);
      if(dist>25||dist<0.2)continue;
      if((vx*d.dir.x+vy*d.dir.y+vz*d.dir.z)/dist<0.82)continue;      // 偏离超过约 35° 的不追
      if(dist<_bd){_bd=dist;_best=[vx/dist,vy/dist,vz/dist];}
    }
    if(_best){
      var _k=Math.min(1,dt*5.0);
      d.dir.x+=(_best[0]-d.dir.x)*_k;d.dir.y+=(_best[1]-d.dir.y)*_k;d.dir.z+=(_best[2]-d.dir.z)*_k;
      var _l=Math.sqrt(d.dir.x*d.dir.x+d.dir.y*d.dir.y+d.dir.z*d.dir.z)||1;
      d.dir.x/=_l;d.dir.y/=_l;d.dir.z/=_l;
      d.mesh.lookAt(d.mesh.position.clone().add(d.dir));
    }
  }catch(_){}
  var prev=d.mesh.position.clone();
  var step=d.speed*dt;
  var np=prev.clone().add(d.dir.clone().multiplyScalar(step));
  /* 碰墙：整段都要通（原来只看终点，会穿薄墙），撞上就在原地炸掉 */
  if(!hasLineOfSight2D(prev.x,prev.z,np.x,np.z,prev.y)){
    spawnParticle(prev,0x9bd4ff,6,0.25);_spDroneClear();return;
  }
  /* 撞地：朝下飞时别穿到地板下面去 */
  try{
    var _sy=projSurfAt(np.x,np.z,np.y);
    if(np.y<_sy+0.15){spawnParticle(np,0x9bd4ff,6,0.25);_spDroneClear();return;}
  }catch(_){}
  d.mesh.position.copy(np);
  d.trail-=dt;if(d.trail<=0){d.trail=0.04;spawnParticle(np,0x9bd4ff,1,0.2);}
  /* 【batch176】命中判定：**这一帧走过的整条线段** vs 敌人胸部（半径 2 米）。
     速度 75 m/s、一帧要走 1~2.5 米，原来只判"帧末那一个点"，等于从敌人身上跨过去（隧穿）——
     这就是"明明飞过去了却打不中"的真凶。现在改成线段判定，跨过去也算扎中。 */
  var _hit=null,_hi=-1;
  for(var j=enemies.length-1;j>=0;j--){
    var e=enemies[j];
    if(e.isNet?(!e.alive):(e.hp<=0))continue;
    var ep=(e.isNet&&typeof heroEntWorld==='function')?heroEntWorld(e):e.root.position;
    if(spSegPointDist(prev,np,ep.x,spEntChestY(e,ep),ep.z)<=2.0){_hit=e;_hi=j;break;}
  }
  if(_hit){
    var e2=_hit,j2=_hi;
    var ep2=(e2.isNet&&typeof heroEntWorld==='function')?heroEntWorld(e2):e2.root.position;
    spawnParticle(ep2.clone().setY(1.1),0x9bd4ff,14,0.4,true);
    /* 【batch172】命中后：头顶亮标记 10 秒 + **过载 10 秒（无法开枪、只能近战）** */
    e2.spHitAt=performance.now()+10000;
    e2.overloadT=Math.max(e2.overloadT||0,10.0);
    /* 联机：伤害 + 过载都交给服务端（本机不再扣一次，避免两边各扣一遍血） */
    if(e2.isNet){try{netHitRemote(e2,false,70,np);}catch(_){}
                 try{netSend({t:'spOv',i:e2.netId,T:10000});}catch(_){}}
    else{
      e2.hp-=70;e2.flash=0.3;e2.slowT=Math.max(e2.slowT||0,2.0);        // 附带减速 2 秒
      if(e2.aiState==='aiming'){e2.aiState='chase';if(e2.aimLine)e2.aimLine.visible=false;}
      if(e2.hb){e2.hb.scale.x=Math.max(0,e2.hp/e2.maxHp);}
      if(e2.hbMat)e2.hbMat.color.setHex(e2.hp/e2.maxHp>.5?0x00ff00:e2.hp/e2.maxHp>.25?0xffff00:0xff0000);
      if(e2.hp<=0)killEnemy(e2,j2,false);
    }
    _spDroneClear();return;
  }
  if(d.t>=d.life)_spDroneClear();
}
function _spDroneClear(){
  var d=SK.spDrone;if(!d)return;
  try{if(d.mesh){scene.remove(d.mesh);d.mesh.geometry.dispose();d.mesh.material.dispose();}}catch(e){}
  SK.spDrone=null;
}
/* ==================== 【batch173】SP 区域系统 ====================
   区域实体：火焰路径 / 电磁网 / 治疗云 / 力场穹顶 / 掩体墙 全走这一套。
   结算口径（联机关键）：**永远是施法者本机判定命中，再上报服务端** ——
     本地小兵 → 直接扣血；远端玩家 → netHitRemote 上报伤害 + spSlow 上报减速。
     别人那边的区域只是「画面」（remote:true，不结算），避免两边各扣一次血。
================================================================ */
var SP_ZONES=[];
var SP_WALL_HP=750;         // 【batch177】掩体墙血量：步枪单发 25、弹匣 30 → 满弹匣 750，**正好一梭子打爆**（原来 2000 要 2.7 个弹匣，玩家以为打不碎）
var SP_WALL_LIFE=99999;     // 【batch176】墙**不再自己消失**：只有被打爆 / 换图 / 退出对局才会没
var SP_WALL_MAX=2;          // 【batch176】但一个人最多同时立 2 堵（放第 3 堵 → 最早那堵自动撤），免得把地图堵死
function spWallCap(remoteToo){
  try{
    var mine=[],i;
    for(i=0;i<SP_ZONES.length;i++){
      var z=SP_ZONES[i];
      if(z.kind!=='wall')continue;
      if(remoteToo||!z.remote)mine.push(z);
    }
    var lim=remoteToo?4:SP_WALL_MAX;
    while(mine.length>lim){
      var old=mine.shift(),idx=SP_ZONES.indexOf(old);
      if(idx>=0){spZoneClear(old);SP_ZONES.splice(idx,1);}
    }
  }catch(_){}
}
/* 墙的碰撞盒：AABB 不能旋转，按朝向的主导轴选长边（与视觉的 BoxGeometry 同尺寸） */
function spWallBoxAt(x,z,rot,halfW,baseY){
  /* 【batch178】**任意角度**：不再吸附 90°（用户："只有两个角度，不灵活"）。
     宽 hw 沿墙长边、厚 hth 沿法线；碰撞用 spWallContains 做定向判定，
     AABB 只作粗筛，斜墙不会被撑成方块。同时尊重 y0/y1（二楼放墙就在二楼挡）。 */
  var hth=0.2,hh=2.7,hw=(typeof halfW==='number')?halfW:2.4;
  var y0=(typeof baseY==='number')?baseY:0;
  var ang=rot||0;
  var ab=spWallAABB(x,z,ang,hw,hth);
  return {minX:ab.minX,maxX:ab.maxX,minZ:ab.minZ,maxZ:ab.maxZ,
          cx:x,cz:z,ang:ang,hw:hw,hth:hth,h:hh,y0:y0,y1:y0+hh,spWall:1};
}
/* 【batch178】墙的「定向碰撞」辅助：任意角度放，碰撞在本地坐标系判定（宽 hw、厚 hth），
   AABB 只用于粗筛，避免斜墙被撑成方块。spWallAABB 算旋转矩形的 AABB。 */
function spWallAABB(cx,cz,ang,hw,hth){
  var c=Math.abs(Math.cos(ang)), s=Math.abs(Math.sin(ang));
  var hx=hw*c+hth*s, hz=hw*s+hth*c;
  return {minX:cx-hx,maxX:cx+hx,minZ:cz-hz,maxZ:cz+hz};
}
function spWallContains(o,x,z){
  if(!o||!o.spWall)return false;
  var dx=x-o.cx, dz=z-o.cz, c=Math.cos(o.ang), s=Math.sin(o.ang);
  var lx=dx*c-dz*s, lz=dx*s+dz*c;          // 世界→本地（与 mesh.rotation.y=ang 一致）
  return (lx>=-o.hw-0.001&&lx<=o.hw+0.001&&lz>=-o.hth-0.001&&lz<=o.hth+0.001);
}
/* 朝向吸附到最近的 90°（贴图与碰撞共用） */
function spWallSnapRot(rot){ return Math.round((rot||0)/(Math.PI/2))*(Math.PI/2); }
/* 打墙：命中点落在某堵墙的盒子里就扣血；扣光的墙当场碎掉（联机把伤害广播给同房其他人，各自扣各自那份） */
function spWallHitAt(point,dmg,noNet){
  if(!point||!(dmg>0))return false;
  /* 【batch178】本地墙在 SP_ZONES、别人的墙在 __remoteWalls，两边都要查，
     这样"打自己的墙"和"打别人的墙"都能扣血。服务端 spWallHit 不回传发送者，不会重复扣。 */
  var _lists=[SP_ZONES,(window.__remoteWalls||[])];
  for(var _li=0;_li<_lists.length;_li++){
    var _L=_lists[_li];
    for(var i=_L.length-1;i>=0;i--){
      var z=_L[i];
      if(_li===0){ if(!z||z.kind!=='wall')continue; }
      else { if(!z||!z.box||!z.mesh)continue; }
      if(z.box){
        if(point.x<z.box.minX-0.15||point.x>z.box.maxX+0.15)continue;
        if(point.z<z.box.minZ-0.15||point.z>z.box.maxZ+0.15)continue;
        if(z.box.spWall&&!(typeof spWallContains==='function'?spWallContains(z.box,point.x,point.z):true))continue;   // 定向精确命中（兜底：缺辅助函数则按 AABB 通过）
        var _by0=(typeof z.box.y0==='number')?z.box.y0:0;
        var _by1=(typeof z.box.y1==='number')?z.box.y1:(z.box.h||2.7);
        if(point.y<_by0-0.15||point.y>_by1+0.15)continue;
      }else{
        if(point.x<z.x-z.r-0.15||point.x>z.x+z.r+0.15)continue;
        if(point.z<z.z-z.r-0.15||point.z>z.z+z.r+0.15)continue;
        if(point.y<0||point.y>2.95)continue;
      }
      z.hp=(typeof z.hp==='number'?z.hp:SP_WALL_HP)-dmg;
      try{spawnParticle(point,0xbfd7e6,6,0.25);}catch(_){}
      if(!noNet){try{ if(typeof netIsMulti==='function'&&netIsMulti()) netSend({t:'spWallHit',x:z.x,z:z.z,d:Math.round(dmg)}); }catch(_){}}
      if(z.hp<=0){
        try{spawnParticle(new THREE.Vector3(z.x,1.4,z.z),0x8fb4c8,26,0.5,true);}catch(_){}
        if(_li===0){ spZoneClear(z); SP_ZONES.splice(i,1); }
        else { try{scene.remove(z.mesh);}catch(e6){} try{var _bi3=obstacles.indexOf(z.box);if(_bi3>=0)obstacles.splice(_bi3,1);buildObstacleBoxes();}catch(e7){} _L.splice(i,1); }
        /* 【batch184】打爆即广播：同房所有人把该位置的墙（自己的 / 别人的）一并撤掉，
           这样"一个人打爆 → 全场都看见打爆了"，不会各自一份血、别人那边还立着。 */
        if(!noNet){ try{ if(typeof netIsMulti==='function'&&netIsMulti())netSend({t:'spwallclear',x:z.x,z:z.z}); }catch(_){} }
        try{showMsg('掩体墙被打爆！','#9bd4ff');}catch(_){}
      }else if(z.mesh&&z.mesh.material){
        if(z.hp/SP_WALL_HP<0.35)z.mesh.material.color.setHex(0xc86a4a);
        else z.mesh.material.color.setHex(0x8fb4c8);
      }
      return true;
    }
  }
  return false;
}
function spZoneMesh(kind,r,rot){
  var mat=null,m=null;
  if(kind==='fire'||kind==='nova'){
    mat=new THREE.MeshBasicMaterial({color:(kind==='nova'?0xffb347:0xff8a3d),transparent:true,opacity:0.30,side:THREE.DoubleSide,depthWrite:false});
    m=new THREE.Mesh(new THREE.CircleGeometry(r,20),mat);m.rotation.x=-Math.PI/2;
  }else if(kind==='net'){
    mat=new THREE.MeshBasicMaterial({color:0x7ad7ff,transparent:true,opacity:0.24,side:THREE.DoubleSide,depthWrite:false,wireframe:true});
    m=new THREE.Mesh(new THREE.CircleGeometry(r,16,2),mat);m.rotation.x=-Math.PI/2;
  }else if(kind==='dome'){
    mat=new THREE.MeshBasicMaterial({color:0x6fd6ff,transparent:true,opacity:0.15,side:THREE.DoubleSide,depthWrite:false});
    m=new THREE.Mesh(new THREE.SphereGeometry(r,18,10,0,Math.PI*2,0,Math.PI*2),mat);
  }else if(kind==='nano'||kind==='adren'){
    mat=new THREE.MeshBasicMaterial({color:0x4fe08a,transparent:true,opacity:0.16,side:THREE.DoubleSide,depthWrite:false});
    m=new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.7,r),14,8),mat);
  }else if(kind==='revive'){
    mat=new THREE.MeshBasicMaterial({color:0xffe08a,transparent:true,opacity:0.26,side:THREE.DoubleSide,depthWrite:false});
    m=new THREE.Mesh(new THREE.CircleGeometry(r,24),mat);m.rotation.x=-Math.PI/2;
  }else if(kind==='wall'){
    /* 【batch177】改成**实心不透明**：原来 opacity 0.6 是半透明的，能直接看穿到墙后面的东西，
       看着像块玻璃、不像掩体。现在用受光材质（场景有环境光 + 平行光），挡视线也挡子弹。 */
    mat=new THREE.MeshLambertMaterial({color:0x93a7bb});
    m=new THREE.Mesh(new THREE.BoxGeometry(r*2,2.7,0.4),mat);
    if(rot)m.rotation.y=rot;
  }
  if(!m)return null;
  m.traverse(function(o){o.raycast=function(){};});   // 别挡自己的准星
  scene.add(m);
  return m;
}
function spZoneAdd(o){
  var kind=o.kind||'fire',r=o.r||3;
  var mesh=(o.mesh!==undefined)?o.mesh:spZoneMesh(kind,r,o.rot||0);
  var z={kind:kind,x:o.x,z:o.z,y:(typeof o.y==='number'?o.y:0),r:r,
         dur:o.dur||5,t:0,dps:o.dps||0,slow:o.slow||0,heal:o.heal||0,
         color:o.color||0xff8a3d,tick:0,mesh:mesh,box:o.box||null,remote:!!o.remote,follow:!!o.follow};
  if(kind==='wall'&&typeof o.hp==='number')z.hp=o.hp;                  // 【batch174】墙有血量，打光就碎
  if(mesh)mesh.position.set(z.x,z.y+(kind==='wall'?1.35:0.07),z.z);   /* 【batch177】墙也跟着 z.y 抬到所在楼层 */
  SP_ZONES.push(z);
  return z;
}
function spZoneClear(z){
  if(!z)return;
  if(z.box){                                   // 掩体墙：把障碍一起撤掉，否则人走了墙还在
    try{var bi=obstacles.indexOf(z.box);if(bi>=0)obstacles.splice(bi,1);buildObstacleBoxes();}catch(e){}
    z.box=null;
  }
  if(z.mesh){
    try{scene.remove(z.mesh);z.mesh.geometry.dispose();z.mesh.material.dispose();}catch(e){}
    z.mesh=null;
  }
}
/* 【batch183】remoteToo===false 时**只清自己的**，不动别人放在场上的东西
   —— 联机退出时用它：房间里其他人还在打，他们的墙 / 区域不该被我方客户端删掉。
   （残留的远端物件由下一局开局 enterGame() 兜底收掉，不会飘进新一局。）
   单人模式（remoteToo 不传 / 为 true）照旧全清 —— 单人场上本来就没有别人的。 */
function spZoneClearAll(remoteToo){
  for(var i=SP_ZONES.length-1;i>=0;i--){spZoneClear(SP_ZONES[i]);}
  SP_ZONES.length=0;
  if(remoteToo===false)return;
  /* 【batch176】别人放的墙（内联在 30 分片、不在 SP_ZONES 里）也要一起清，
     否则换图后贴图和碰撞会留在场上。 */
  try{
    var _rw=window.__remoteWalls||[];
    for(var j=_rw.length-1;j>=0;j--){
      try{scene.remove(_rw[j].mesh);}catch(e){}
      try{var _bi=obstacles.indexOf(_rw[j].box);if(_bi>=0)obstacles.splice(_bi,1);}catch(e){}
    }
    _rw.length=0;
    buildObstacleBoxes();
  }catch(_){}
}
/* 统一伤害入口：本地小兵直接扣；远端玩家上报服务端（顺带报减速） */
function spHitEnemy(e,dmg,point,slowT){
  if(!e)return;
  if(e.isNet){
    if(typeof _ffSkip==='function'&&_ffSkip(e))return;            // 不打队友（爆能器同队）
    try{netHitRemote(e,false,dmg,point||null);}catch(_){}
    if(slowT)try{netSend({t:'spSlow',i:e.netId,T:Math.round(slowT*1000)});}catch(_){}
    return;
  }
  e.hp-=dmg;e.flash=0.25;
  if(slowT)e.slowT=Math.max(e.slowT||0,slowT);
  if(e.hb)e.hb.scale.x=Math.max(0,e.hp/e.maxHp);
  if(e.hbMat)e.hbMat.color.setHex(e.hp/e.maxHp>.5?0x00ff00:e.hp/e.maxHp>.25?0xffff00:0xff0000);
  if(e.hp<=0){var idx=enemies.indexOf(e);if(idx>=0)killEnemy(e,idx,false);}
}
/* 每帧推进（updateHero 调） */
var _spBurnAcc=0;
function updateSpZones(dt){
  var i,j;
  /* ① 灼烧：跟着敌人走（焚天新星 / 爆燃弹） */
  _spBurnAcc-=dt;
  if(_spBurnAcc<=0){
    _spBurnAcc=0.5;
    for(j=enemies.length-1;j>=0;j--){
      var be=enemies[j];
      if(be.isNet?(!be.alive):(be.hp<=0))continue;
      if(!(be.burnT>0))continue;
      be.burnT=Math.max(0,be.burnT-0.5);
      var bp=(be.isNet&&typeof heroEntWorld==='function')?heroEntWorld(be):be.root.position;
      spHitEnemy(be,Math.max(1,Math.round((be.burnDps||8)*0.5)),bp.clone(),0);   // 按层结算（默认每秒 8 点）
      try{spawnParticle(bp.clone().setY(bp.y+1.1),0xff8a3d,2,0.25,true);}catch(_){}
    }
  }
  /* ② 区域 */
  for(i=SP_ZONES.length-1;i>=0;i--){
    var z=SP_ZONES[i];
    z.t+=dt;
    if(z.follow&&!z.remote){                                       // 跟着自己走（肾上腺素）
      z.x=camera.position.x;z.z=camera.position.z;
      if(z.mesh)z.mesh.position.set(z.x,z.mesh.position.y,z.z);
    }
    if(z.mesh&&(z.kind==='nano'||z.kind==='adren'||z.kind==='dome'))z.mesh.rotation.y+=dt*0.4;
    if(z.t>=z.dur){spZoneClear(z);SP_ZONES.splice(i,1);continue;}
    if(z.remote)continue;                                          // 别人放的区域：只播画面
    if(z.heal<=0&&z.dps<=0)continue;
    z.tick-=dt;
    if(z.tick>0)continue;
    z.tick=0.5;                                                    // 每 0.5 秒结算一次
    if(z.dps>0){
      var dmg=Math.max(1,Math.round(z.dps*0.5));
      for(j=enemies.length-1;j>=0;j--){
        var e=enemies[j];
        if(e.isNet?(!e.alive):(e.hp<=0))continue;
        var ep=(e.isNet&&typeof heroEntWorld==='function')?heroEntWorld(e):e.root.position;
        var dx=ep.x-z.x,dz=ep.z-z.z;
        if(dx*dx+dz*dz>z.r*z.r)continue;
        if(Math.abs(spEntFootY(e,ep)-z.y)>3.2)continue;            // 隔一层楼不算（按真人/小兵各自的脚底算）
        spHitEnemy(e,dmg,ep.clone(),z.slow);
        try{spawnParticle(ep.clone().setY(ep.y+1.0),z.color,3,0.3,true);}catch(_){}
      }
    }
    if(z.heal>0){
      var amt=Math.max(1,Math.round(z.heal*0.5));
      try{
        if(typeof netIsMulti==='function'&&netIsMulti()){
          netSend({t:'heal',x:z.x,z:z.z,y:z.y,r:z.r,a:amt,us:1,tm:1});   /* 【batch177】带高度：二楼的云只奶二楼 */    // 服务端权威回血（tm:1＝只奶自己人，倒地的会被扶起）
        }else{
          var ddx=camera.position.x-z.x,ddz=camera.position.z-z.z;
          if(ddx*ddx+ddz*ddz<=z.r*z.r){
            var hv=Math.round(amt*(typeof heroHealMul==='function'?heroHealMul():1));
            if(S.hp<S.maxHp){S.hp=Math.min(S.maxHp,S.hp+hv);updateHp();}
            SK.slow=0;SK.blind=0;SK.blindDur=0;                       // 治疗云顺带解除减速 / 致盲（【batch183】清总时长 + 立刻同步，否则白屏卡在最后一帧）
            try{if(typeof heroBlindSync==='function')heroBlindSync();}catch(_){}
          }
        }
        try{ if(typeof rangeHealDummies==='function')rangeHealDummies(z.x,z.z,z.r,amt); }catch(_){}   /* 【batch180】靶场回血靶：治疗云范围内一起回 */
      }catch(_){}
    }
  }
}
/* 广播区域给同房间的人（纯画面） */
function spZoneNet(kind,x,z,r,durMs,rot,y){
  try{ if(typeof netIsMulti!=='function'||!netIsMulti())return; }catch(_){return;}
  /* 【batch177】带上高度：以前只发 x/z，别人那边的区域一律画在一楼地面 —— 二楼放火/放网/放穹顶会"飘在楼下" */
  try{ netSend({t:'spZone',k:kind,x:x,z:z,y:(typeof y==='number'?y:0),r:r,dur:Math.round(durMs),rot:rot||0}); }catch(_){}
}
/* 前方 n 米的点（自动夹在图内） */
function spFrontPt(dist){
  var fwd=camera.getWorldDirection(new THREE.Vector3());
  var fl=Math.sqrt(fwd.x*fwd.x+fwd.z*fwd.z)||1;
  var x=camera.position.x+fwd.x/fl*dist, z=camera.position.z+fwd.z/fl*dist;
  var L=worldLimit()-1.5;
  return {x:Math.max(-L,Math.min(L,x)),z:Math.max(-L,Math.min(L,z)),fx:fwd.x/fl,fz:fwd.z/fl};
}
/* ---- 流火 · 烈焰先锋 ----
   ① 烈焰之路：向前突进并在身后铺 5 秒火焰路径 */
SP_SKILLS['sp_firetrap']=function(i,s,H){
  var f=spFrontPt(1);
  SK.dashX=f.fx;SK.dashZ=f.fz;SK.dash=0.42;SK.dashLast=0;                 // 比原版突进更远
  SK.dashBuff=Math.max(SK.dashBuff,1.2);
  var py=(typeof standSurfY==='function')?standSurfY():0,n=0;
  for(var k=1;k<=5;k++){
    var tx=camera.position.x+f.fx*k*1.7, tz=camera.position.z+f.fz*k*1.7;
    var L=worldLimit()-1;if(Math.abs(tx)>L||Math.abs(tz)>L)break;
    spZoneAdd({kind:'fire',x:tx,z:tz,y:py,r:1.9,dur:s.dur,dps:12,slow:0.40});
    spZoneNet('fire',tx,tz,1.9,s.dur*1000,0,py);n++;
  }
  heroFxRingAt(camera.position.x,camera.position.z,0xff8a3d,0.7,0.5,0.5);
  showMsg('烈焰之路：'+n+' 段火墙 '+s.dur+' 秒（12 伤/秒 + 减速 40%）',H.css);
  return true;
};
/* ② 爆燃弹：8 秒内每发子弹命中都小范围爆燃（挂在 attack 的枪械命中处） */
SP_SKILLS['sp_burn']=function(i,s,H){
  SK.spBurnT=Math.max(SK.spBurnT||0,s.dur);
  /* 【batch176】即时反馈：枪口喷火 + 脚下火环 + 明确提示（以前点了什么都没有，像没生效） */
  try{
    var _f=camera.getWorldDirection(new THREE.Vector3());
    spawnParticle(camera.position.clone().add(_f.clone().multiplyScalar(1.2)),0xff8a3d,18,0.5,true);
    spawnParticle(camera.position.clone().add(_f.clone().multiplyScalar(2.2)),0xff6a1a,12,0.4,true);
  }catch(_){}
  heroFxRingAt(camera.position.x,camera.position.z,0xff6a1a,2.2,0.7,0.55);
  showMsg('🔥 爆燃弹已装填！接下来 '+s.dur+' 秒，**开枪命中就爆燃**（2 米内 20 伤 + 点燃）',H.css);
  return true;
};
function _spBurnProc(point){
  if(!(SK.sp&&SK.spBurnT>0)||!point)return;
  for(var j=enemies.length-1;j>=0;j--){
    var e=enemies[j];
    if(e.isNet?(!e.alive):(e.hp<=0))continue;
    var ep=(e.isNet&&typeof heroEntWorld==='function')?heroEntWorld(e):e.root.position;
    var dx=ep.x-point.x,dy=(ep.y+0.9)-point.y,dz=ep.z-point.z;
    if(dx*dx+dy*dy+dz*dz>4)continue;                                  // 2 米
    e.burnT=Math.max(e.burnT||0,2.0);                                  // 点燃 2 秒
    spHitEnemy(e,20,ep.clone(),0);
    try{spawnParticle(ep.clone().setY(ep.y+1.0),0xff8a3d,10,0.35,true);}catch(_){}
  }
}
/* ③ 焚天新星：以自身为中心 8 米 —— 70 伤 + 点燃 4 秒（灼烧跟着敌人走） */
SP_SKILLS['sp_nova']=function(i,s,H){
  var px=camera.position.x,pz=camera.position.z,py=(typeof standSurfY==='function')?standSurfY():0;
  spZoneAdd({kind:'nova',x:px,z:pz,y:py,r:8,dur:0.9,dps:0});
  spZoneNet('nova',px,pz,8,900,0,py);
  var n=0;
  for(var j=enemies.length-1;j>=0;j--){
    var e=enemies[j];
    if(e.isNet?(!e.alive):(e.hp<=0))continue;
    var ep=(e.isNet&&typeof heroEntWorld==='function')?heroEntWorld(e):e.root.position;
    var dx=ep.x-px,dz=ep.z-pz;
    if(dx*dx+dz*dz>64)continue;                                        // 8 米
    if(Math.abs(ep.y-py)>3.2)continue;
    e.burnT=Math.max(e.burnT||0,4.0);
    spHitEnemy(e,70,ep.clone(),0);n++;
    try{spawnParticle(ep.clone().setY(ep.y+1.2),0xff8a3d,12,0.4,true);}catch(_){}
  }
  heroFxRingAt(px,pz,0xff8a3d,8,0.7,0.6);
  showMsg('焚天新星：'+n+' 个敌人被点燃（70 伤 + 4 秒灼烧）',H.css);
  return true;
};
/* ---- 镇岳 · 铁壁 ----
   ① 掩体墙：身前 3.2 米立一堵真墙（本地进 obstacles：挡人、挡子弹、挡视线） */
/* 【batch178】墙：手持 + 地面预览 + 点击放置（取代原来"前方凭空生成"）。函数集中放这里避免分散。 */
function heroMeshSpWall(){
  /* 【batch178】手持预览用"和真墙同比例"的模型（宽 4.8 / 高 2.7 / 厚 0.4），整体再靠 heroHoldShow 的 _hs 缩小。
     这样手里举的就是真墙的缩略，形状与放下后的碰撞墙完全吻合（之前是 1.1×1.5 的竖牌子，和真墙比例两样）。 */
  var g=new THREE.Group();
  var panel=new THREE.Mesh(new THREE.BoxGeometry(4.8,2.7,0.4),new THREE.MeshLambertMaterial({color:0x93a7bb}));
  g.add(panel);
  var edge=new THREE.Mesh(new THREE.BoxGeometry(4.96,0.18,0.46),new THREE.MeshLambertMaterial({color:0x6f8497}));
  edge.position.y=1.26;g.add(edge);
  var edge2=edge.clone();edge2.position.y=-1.26;g.add(edge2);
  return g;
}
/* 【batch180】射线落点专用：取 (x,z) 处「不高于 yTop」的最高可站面（地面 0 / 楼板 slab / 箱顶 / 墙顶）。
   为什么不能用 groundHeightAt：它只认「脚底 + STEP_UP」以内的面，是给"人能不能站上去"用的。
   站二楼往下看时，射线降到二楼楼板高度那一刻，它算出的 feet 已经低于楼板顶面，
   于是把楼板整块排除掉、退回一楼地面 → 墙死活放不到二楼（batch179 改完才暴露出来的回归）。
   这里直接扫全局 obstacles 取最高面。**同分片就地定义**（禁止跨分片引用函数）+ try/catch 兜底。 */
function heroWallSurfAt(x,z,yTop){
  var best=0;
  try{
    var lim=(typeof yTop==='number'?yTop:1e9)-0.05;     // 只认出发高度以下的面（头顶的楼板不算）
    for(var i=0;i<obstacles.length;i++){
      var o=obstacles[i];
      if(!o||o.rail)continue;
      if(x<o.minX||x>o.maxX||z<o.minZ||z>o.maxZ)continue;
      if(o.spWall){ if(o.rising)continue;               // 还在钻地升起中的墙不算面
        var _wt=(typeof o.y1==='number')?o.y1:o.h;
        if(_wt<=lim&&_wt>best)best=_wt; continue; }
      var top=(o.slab&&typeof o.y1==='number')?o.y1:(o.h||0);
      if(top<=lim&&top>best)best=top;
    }
  }catch(e){}
  return best;
}
function heroWallTarget(){
  /* 准星射线找地面落点（封顶 14 米，步长 0.25 更贴准星）；朝向由相机视线直接算出（任意角度）。看脚下 → 落点在脚下。 */
  var dir=camera.getWorldDirection(new THREE.Vector3()).normalize();
  var maxD=14,step=0.25,px=camera.position.x,py=camera.position.y,pz=camera.position.z;
  var hx=px,hz=pz,surf=0,hit=false;
  var _y0=py;                                            // 射线出发高度（＝当前眼高）
  for(var t=0.25;t<=maxD;t+=step){
    var x=px+dir.x*t,y=py+dir.y*t,z=pz+dir.z*t;
    var g=heroWallSurfAt(x,z,_y0);                       // 该处「不高于出发高度」的最高可站面
    /* 【batch179】必须拿射线的真实高度 y 去和地面高度 g 比。
       原来写成 y-GROUND_Y<=g，等于拿「眼高」去比地面 —— 而相机本来就在眼高，
       于是第一步 t=0.25 就命中，墙永远落在脚边，瞄哪儿都不在准心上。
       【batch180】g 也不再用 groundHeightAt 算（原因见 heroWallSurfAt 注释：会漏掉二楼）。 */
    if(y<=g){hx=x;hz=z;surf=g;hit=true;break;}
  }
  if(!hit){var t=maxD;hx=px+dir.x*t;hz=pz+dir.z*t;surf=heroWallSurfAt(hx,hz,_y0);}
  /* 【batch179】墙朝向（原注释里的约定写错了，这里按 spWallContains 的真实公式重推）：
       spWallContains: lx=dx*c-dz*s, lz=dx*s+dz*c（注释明写「与 mesh.rotation.y=ang 一致」）
     → 本地 X（长边）指向世界 (cos ang, -sin ang)；本地 Z（法线/厚度）指向世界 (sin ang, cos ang)。
     要「自己面朝哪、墙就面朝哪」（墙横在身前、正面朝着看的方向，人站在墙背面），
     法线就要等于水平视线 (dir.x, dir.z)，即 sin ang=dir.x、cos ang=dir.z → ang=atan2(dir.x, dir.z)。
     原来的 atan2(dir.x,-dir.z) 得到的是镜像角：正对轴向时只是转 180°（墙左右对称看不出来），
     斜着看时整整偏 90° —— 墙会顺着视线立着，而不是横在身前。 */
  var yaw=Math.atan2(dir.x, dir.z);
  return {x:hx,z:hz,surf:surf,rot:yaw};
}
var _wallGhost=null,_wallRing=null;
function heroWallGhostShow(){
  if(_wallGhost)return;
  _wallGhost=new THREE.Mesh(new THREE.BoxGeometry(4.8,2.7,0.4),new THREE.MeshBasicMaterial({color:0x7fffd0,transparent:true,opacity:0.35,depthWrite:false}));
  _wallGhost.traverse(function(o){o.raycast=function(){};});scene.add(_wallGhost);
  _wallRing=new THREE.Mesh(new THREE.RingGeometry(0.5,0.7,24),new THREE.MeshBasicMaterial({color:0x7fffd0,transparent:true,opacity:0.7,side:THREE.DoubleSide,depthWrite:false}));
  _wallRing.rotation.x=-Math.PI/2;_wallRing.traverse(function(o){o.raycast=function(){};});scene.add(_wallRing);
}
function heroWallGhostUpdate(){
  if(!(SK.hold&&SK.hold.kind==='sp_wall')){heroWallGhostHide();return;}
  heroWallGhostShow();
  var tgt=heroWallTarget();SK.wallTgt=tgt;
  _wallGhost.position.set(tgt.x,tgt.surf+1.35,tgt.z);_wallGhost.rotation.y=tgt.rot;
  _wallRing.position.set(tgt.x,tgt.surf+0.06,tgt.z);
}
function heroWallGhostHide(){if(_wallGhost){scene.remove(_wallGhost);_wallGhost=null;}if(_wallRing){scene.remove(_wallRing);_wallRing=null;}}
function heroWallPlace(){
  var tgt=SK.wallTgt||heroWallTarget();
  heroWallGhostHide();
  var h=SK.hold;if(!h)return false;
  SK.hold=null;SK.aimThrow=false;heroHoldHide();
  var H=heroNow(),i=h.si,s=heroSkill(i),halfW=2.4,wy=tgt.surf,ang=tgt.rot;
  var box=spWallBoxAt(tgt.x,tgt.z,ang,halfW,wy);box.rising=true;
  obstacles.push(box);try{buildObstacleBoxes();}catch(_){}
  var mesh=new THREE.Mesh(new THREE.BoxGeometry(halfW*2,2.7,0.4),new THREE.MeshLambertMaterial({color:0x93a7bb}));
  mesh.rotation.y=ang;mesh.traverse(function(o){o.raycast=function(){};});scene.add(mesh);
  spZoneAdd({kind:'wall',x:tgt.x,z:tgt.z,y:wy,r:halfW,dur:SP_WALL_LIFE,mesh:mesh,box:box,rot:ang,hp:SP_WALL_HP});
  mesh.position.y=wy-2.7;                                  // 钻地动画起点（spZoneAdd 会先放到 wy+1.35，这里覆盖）
  spZoneNet('wall',tgt.x,tgt.z,halfW,SP_WALL_LIFE*1000,ang,wy);
  spWallCap(false);
  if(!SK.wallRises)SK.wallRises=[];
  SK.wallRises.push({mesh:mesh,x:tgt.x,z:tgt.z,surf:wy,ang:ang,hw:halfW,box:box,t:0,dur:0.45});
  SK.cds[i]=s.cd;                                          // 放下才进冷却（举起那一下不扣）
  showMsg('掩体墙：'+s.dur+' 秒（挡子弹、挡人、挡视线，可任意角度）','#9bd4ff');
  heroHudUpdate(true);
  return true;
}
SP_SKILLS['sp_wall']=function(i,s,H){
  /* 【batch178】改成「手持 + 地面预览 + 点击放置」：举起墙→准星看地面实时预览落点，
     左键放下（任意角度 / 看多远放多远 / 看脚下放脚下），墙从地下钻出并把站上面的玩家顶起来。 */
  if(SK.hold&&SK.hold.kind==='sp_wall'){heroHoldCancel();showMsg('已收起「'+s.name+'」','#ffd166');return true;}
  if(SK.hold)heroHoldCancel();
  SK.hold={kind:'sp_wall',si:i};
  heroHoldShow('sp_wall');
  showMsg('已举起「'+s.name+'」：准星指向地面＝预览落点，左键放下；再按技能键收起','#9bd4ff');
  heroHudUpdate(true);
  return true;
};
/* ② 电磁减速网：前方 7 米铺网 —— 减速 60% + 5 伤/秒 */
/* 【batch177】电磁减速网改**真投掷物**：不再"前方 7 米凭空生成"（瞄哪儿都甩不到想去的地方，
   隔着一堵墙/在二楼就完全投不进去）。现在跟手雷一样：拿起 → 长按开火键看抛物线 → 松手抛出，
   落地才铺网。所有出手逻辑在 heroDoThrow 的 sp_net 分支。 */
SP_SKILLS['sp_net']=function(i,s,H){ return false; };
/* ③ 力场穹顶：以自己为中心 6 米 —— 范围内减伤 50%（联机服务端同步减伤） */
SP_SKILLS['sp_dome']=function(i,s,H){
  var px=camera.position.x,pz=camera.position.z,py=(typeof standSurfY==='function')?standSurfY():0;
  SK.dome=Math.max(SK.dome||0,s.dur);SK.domeX=px;SK.domeZ=pz;SK.domeY=py;SK.domeR=6;
  spZoneAdd({kind:'dome',x:px,z:pz,y:py+1.2,r:6,dur:s.dur,color:0x6fd6ff});
  spZoneNet('dome',px,pz,6,s.dur*1000,0,py);
  try{ if(typeof netIsMulti==='function'&&netIsMulti())
    netSend({t:'skill',k:'guard_sp',s:2,x:px,y:py,z:pz});            // 服务端：给范围内的人记减伤
  }catch(_){}
  heroFxRingAt(px,pz,0x6fd6ff,6,0.6,0.35);
  showMsg('力场穹顶：'+s.dur+' 秒（范围内减伤 50%）',H.css);
  return true;
};
/* ---- 白泽 · 战地医师 ----
   ① 肾上腺素：加速 35% + 免疫减速 + 每秒回 8 血（跟随自己） */
SP_SKILLS['sp_adren']=function(i,s,H){
  SK.adren=Math.max(SK.adren||0,s.dur);SK.slow=0;
  spZoneAdd({kind:'adren',x:camera.position.x,z:camera.position.z,
             y:(typeof standSurfY==='function')?standSurfY():0,r:1.4,dur:s.dur,heal:8,follow:true});
  heroFxRingAt(camera.position.x,camera.position.z,0x4fe08a,1.2,0.5,0.4);
  showMsg('肾上腺素：'+s.dur+' 秒（+35% 移速、免疫减速、每秒回 8 血）',H.css);
  return true;
};
/* ② 纳米治疗云：前方 4 米铺云 —— 10 秒范围内每秒回 8 血 + 解除减速 */
SP_SKILLS['sp_nano']=function(i,s,H){
  var f=spFrontPt(4);
  var py=(typeof standSurfY==='function')?standSurfY():0;
  spZoneAdd({kind:'nano',x:f.x,z:f.z,y:py+1.0,r:7,dur:s.dur,heal:8});
  spZoneNet('nano',f.x,f.z,7,s.dur*1000,0,py+1.0);
  heroFxRingAt(f.x,f.z,0x4fe08a,7,0.6,0.3);
  showMsg('纳米治疗云：'+s.dur+' 秒（范围内每秒回 8 血 + 解除减速）',H.css);
  return true;
};
/* ③ 复苏协议（大招）：范围内一次性回 60 血、扶起倒地队友 + 8 秒减伤 50% */
SP_SKILLS['sp_revive']=function(i,s,H){
  var px=camera.position.x,pz=camera.position.z,py=(typeof standSurfY==='function')?standSurfY():0;
  try{netSend({t:'heal',x:px,z:pz,y:py,r:12,a:60,us:1,tm:1});}catch(_){}   /* 【batch177】带高度 */    // 服务端权威：回血 + 扶人（只奶自己人）
  if(!(typeof netIsMulti==='function'&&netIsMulti())){
    S.hp=Math.min(S.maxHp,S.hp+Math.round(60*(typeof heroHealMul==='function'?heroHealMul():1)));updateHp();
  }
  try{ if(typeof rangeHealDummies==='function')rangeHealDummies(px,pz,12,60); }catch(_){}   /* 【batch180】靶场回血靶：范围内回 60（和技能说明一致） */
  SK.dome=Math.max(SK.dome||0,8);SK.domeX=px;SK.domeZ=pz;SK.domeY=py;SK.domeR=6;
  spZoneAdd({kind:'revive',x:px,z:pz,y:py,r:12,dur:1.6});
  spZoneNet('revive',px,pz,12,1600,0,py);
  heroFxRingAt(px,pz,0xffe08a,12,0.9,0.45);
  showMsg('复苏协议：范围内回 60 血、倒地的被扶起 + 8 秒减伤 50%',H.css);
  return true;
};
/* ---- 蚀日者 · 焚曜（batch181，下标 4）----
   ① 日冕喷发：自身为中心 12 米 —— 45 伤 + 致盲 2.5 秒；自己套 4 秒护盾（减伤 60%）+ 2.5 秒加速
   【batch183】真人玩家的致盲走服务端：heroCast 已发 {t:'skill',k:'eclipse_sp',s:0,x,y,z}，
   服务端按同一口径（12 米 + 同楼层）给房间里的其他人下发 {t:'flash',dur:2500}。
   本循环里的 e.blindT 只驱动**小兵 AI** 的视线（真人实体上是死数据），别以为置了它对面就会白。 */
SP_SKILLS['sp_solarflare']=function(i,s,H){
  var px=camera.position.x,pz=camera.position.z,py=(typeof standSurfY==='function')?standSurfY():0;
  var n=0;
  for(var j=enemies.length-1;j>=0;j--){
    var e=enemies[j];
    if(e.isNet?(!e.alive):(e.hp<=0))continue;
    var ep=(e.isNet&&typeof heroEntWorld==='function')?heroEntWorld(e):e.root.position;
    var dx=ep.x-px,dz=ep.z-pz;
    if(dx*dx+dz*dz>144)continue;                                       // 12 米
    if(Math.abs((e.isNet?ep.y-1.6:ep.y)-py)>3.2)continue;               // 隔一层楼不算
    e.blindT=Math.max(e.blindT||0,2.5);e.flash=0.3;
    spHitEnemy(e,45,ep.clone(),0);n++;
    try{spawnParticle(ep.clone().setY(ep.y+1.1),0xffd27a,12,0.45,true);}catch(_){}
  }
  SK.shield=Math.max(SK.shield,4);                                      // 日冕护盾：4 秒（heroMitigate 减伤 70%）
  SK.dashBuff=Math.max(SK.dashBuff,2.5);                                // 2.5 秒加速
  spZoneAdd({kind:'nova',x:px,z:pz,y:py,r:12,dur:0.8,dps:0});
  spZoneNet('nova',px,pz,12,800,0,py);
  heroFxRingAt(px,pz,0xffd27a,12,0.8,0.5);
  showMsg('日冕喷发：'+n+' 个敌人被灼盲（45 伤 + 致盲 2.5 秒）',H.css);
  return true;
};
/* ② 堕日：投掷一颗坠落的小太阳，落地 6 秒燃烧区（spZoneAdd 的 fire：18 伤/秒 + 点燃）。
   出手逻辑在 heroDoThrow 的 sp_sunfall 分支（THROW_KINDS 已登记）。 */
SP_SKILLS['sp_sunfall']=function(i,s,H){ return false; };
/* ③ 蚀日 · 白夜：全图致盲 4 秒 + 自身 8 秒（减伤 70% / 加速 30% / 跟随黑日脉冲）。
   【batch183】真人玩家的致盲走服务端：heroCast 已发 {t:'skill',k:'eclipse_sp',s:2,x,y,z}，
   服务端给同房间其他所有人（不分距离 / 不分楼层）下发 {t:'flash',dur:4000}。
   本循环里的 e.blindT 同样只驱动小兵 AI 视线。
   ⚠ 状态字段统一挂 SK.spVeil（updateHero 递减、heroMitigate / heroSpeedMul 读取），
     重置清单（storyStart / resetRoundState）里也要清，别让上一局的白夜漏到下一局。 */
SP_SKILLS['sp_eclipseveil']=function(i,s,H){
  var px=camera.position.x,pz=camera.position.z,py=(typeof standSurfY==='function')?standSurfY():0;
  SK.spVeil=Math.max(SK.spVeil||0,s.dur);
  SK.spVeilPulse=0;
  /* 全图致盲（不分距离 / 不看朝向 —— 天都黑了） */
  var n=0;
  for(var j=0;j<enemies.length;j++){
    var e=enemies[j];
    if(e.isNet?(!e.alive):(e.hp<=0))continue;
    e.blindT=Math.max(e.blindT||0,4.0);e.flash=0.3;n++;
    try{spawnParticle((e.isNet&&typeof heroEntWorld==='function')?heroEntWorld(e):e.root.position.clone().setY(1.2),0x1a1030,10,0.5,true);}catch(_){}
  }
  /* 跟着自己走的黑日 */
  if(SK.spVeilObj&&SK.spVeilObj.parent)SK.spVeilObj.parent.remove(SK.spVeilObj);
  var sun=new THREE.Mesh(new THREE.SphereGeometry(2.6,18,14),
    new THREE.MeshBasicMaterial({color:0x0d0a18}));
  var rim=new THREE.Mesh(new THREE.TorusGeometry(2.75,0.16,8,28),
    new THREE.MeshBasicMaterial({color:0xffb347}));
  sun.add(rim);scene.add(sun);SK.spVeilObj=sun;
  heroFxRingAt(px,pz,0x1a1030,26,1.2,0.7);
  heroFxRingAt(px,pz,0xffb347,14,1.0,0.5);
  showMsg('🌘 蚀日 · 白夜：全图致盲 '+n+' 个目标，8 秒内减伤 70% + 移速 +30%',H.css);
  return true;
};
/* 白夜的每帧推进（updateHero 调）：跟随 + 脉冲灼烧 9 米内敌人 */
function spVeilTick(dt){
  try{
    if(!(SK.spVeil>0)){ if(SK.spVeilObj){if(SK.spVeilObj.parent)SK.spVeilObj.parent.remove(SK.spVeilObj);SK.spVeilObj=null;} return; }
    SK.spVeil=Math.max(0,SK.spVeil-dt);
    if(SK.spVeilObj)SK.spVeilObj.position.set(camera.position.x,camera.position.y+15,camera.position.z);
    SK.spVeilPulse=(SK.spVeilPulse||0)+dt;
    if(SK.spVeilPulse>=1.2){
      SK.spVeilPulse=0;
      var px=camera.position.x,pz=camera.position.z,py=(typeof standSurfY==='function')?standSurfY():0;
      heroFxRingAt(px,pz,0xffb347,9,0.7,0.35,Math.max(0.2,py+0.2));
      for(var j=enemies.length-1;j>=0;j--){
        var e=enemies[j];
        if(e.isNet?(!e.alive):(e.hp<=0))continue;
        var ep=(e.isNet&&typeof heroEntWorld==='function')?heroEntWorld(e):e.root.position;
        var dx=ep.x-px,dz=ep.z-pz;
        if(dx*dx+dz*dz>81)continue;
        if(Math.abs((e.isNet?ep.y-1.6:ep.y)-py)>3.2)continue;
        spHitEnemy(e,15,ep.clone(),0);
        try{spawnParticle(ep.clone().setY(ep.y+1.1),0xffb347,6,0.35,true);}catch(_){}
      }
    }
    if(SK.spVeil<=0&&SK.spVeilObj){if(SK.spVeilObj.parent)SK.spVeilObj.parent.remove(SK.spVeilObj);SK.spVeilObj=null;showMsg('白夜结束了','#9ab');}
  }catch(e){}
}
/* 站在自己创造的蚀日区域里吗？（焚曜被动：冷却 ×2 + 每秒回 3 血） */
function spInOwnEclipse(){
  try{
    if(!(SK.sp&&SK.idx===HERO_ECLIPSE))return false;
    if(typeof SK.eclipses==='undefined'||!SK.eclipses.length)return false;
    var px=camera.position.x,pz=camera.position.z,py=(typeof standSurfY==='function')?standSurfY():0;
    for(var i=0;i<SK.eclipses.length;i++){
      var E=SK.eclipses[i];if(E.remote)continue;
      var dx=px-E.x,dz=pz-E.z;
      if(dx*dx+dz*dz<=E.r*E.r&&Math.abs((E.y||0)-py)<=3.2)return true;
    }
  }catch(e){}
  return false;
}
/* 松手抛出：按当前视角（pitch/yaw）把手里那件扔出去（真物理投掷物） */
function heroDoThrow(){
  var h=SK.hold;if(!h)return false;
  SK.hold=null;SK.aimThrow=false;
  heroHoldHide();heroPreviewHide();
  var H=heroNow(),i=h.si,k=h.kind,multi=netIsMulti();
  throwInfo=null;
  if(k==='sp_drone'){
    /* 【batch176】准星指哪扎哪：方向直接取**视线**。
       原来用 heroThrowVel()（投掷抛物线初速，带 +PROJ_LIFT 上抛分量）→ 一路往上飘，
       从敌人头顶飞过去 —— 这就是"老打不中"的头号原因。 */
    var _dir2=camera.getWorldDirection(new THREE.Vector3()).normalize();
    var df0=camera.position.clone().add(_dir2.clone().multiplyScalar(0.6));
    var dm=heroMeshSpDrone();dm.traverse(function(o){o.raycast=function(){};});
    dm.position.copy(df0);dm.lookAt(df0.clone().add(_dir2));scene.add(dm);
    SK.spDrone={from:df0.clone(),dir:_dir2,t:0,life:0.65,speed:75,mesh:dm,trail:0};
    heroFxRingAt(df0.x,df0.z,0x9bd4ff,0.25,1.0,0.3);
    /* 【batch172 联机】把「出手点 + 直线方向×速度 + 直线标记」塞进 throwInfo：
       尾部通用收尾会自动 netSend 给同房间的人 → 别人屏幕上也能看见这架无人机飞出去、扎中谁
       （伤害/过载仍由投掷者本机判定后上报，远端不做二次命中，避免两边各扣一次血）。 */
    throwInfo={x:df0.x,y:df0.y,z:df0.z,vx:_dir2.x*75,vy:_dir2.y*75,vz:_dir2.z*75,fuse:-1,straight:1,life:0.65};
    /* 不 return：继续走尾部通用收尾（showMsg + heroHudUpdate） */
  }
  /* 【batch177】② 电磁减速网：抛出去，**落点**铺网（能扔进二楼窗户 / 越过掩体） */
  else if(k==='sp_net'){
    var nv=heroThrowVel(),nf0=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,0x7ad7ff,0.3,1.4,0.35);
    throwInfo={x:nf0.x,y:nf0.y,z:nf0.z,vx:nv.vx,vy:nv.vy,vz:nv.vz,fuse:-1};
    projSpawn('sp_net',nf0.x,nf0.y,nf0.z,nv.vx,nv.vy,nv.vz,{fuse:-1,mesh:heroMeshSpNet(),rest:0.35,
      onLand:function(pp){
        try{
          var _ns=(H&&H.skills&&H.skills[i])?H.skills[i]:{dur:8};
          var _nd=_ns.dur||8, _ny=Math.max(0,pp.y);
          if(typeof spZoneAdd==='function')
            spZoneAdd({kind:'net',x:pp.x,z:pp.z,y:_ny,r:4.2,dur:_nd,dps:5,slow:0.60,color:0x7ad7ff});
          if(typeof spZoneNet==='function')spZoneNet('net',pp.x,pp.z,4.2,_nd*1000,0,_ny);
          heroFxRingAt(pp.x,pp.z,0x7ad7ff,4.2,0.5,0.4);
          showMsg('电磁减速网：'+_nd+' 秒（减速 60% + 5 伤/秒）',H.css);
        }catch(_){}
        projRemove(pp);
      } });
  }
  /* 【batch181】③ 蚀日者 SP「堕日」：抛出小太阳，落地形成 6 秒燃烧区（spZoneAdd 的 fire） */
  else if(k==='sp_sunfall'){
    var uv=heroThrowVel(),uf0=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,0xffb347,0.3,1.5,0.35);       // 灼橙起手圈
    throwInfo={x:uf0.x,y:uf0.y,z:uf0.z,vx:uv.vx,vy:uv.vy,vz:uv.vz,fuse:-1};
    projSpawn('sp_sunfall',uf0.x,uf0.y,uf0.z,uv.vx,uv.vy,uv.vz,{fuse:-1,mesh:heroMeshSun(),rest:0.42,
      onLand:function(pp){
        try{
          var _sd=(H&&H.skills&&H.skills[i])?H.skills[i]:{dur:6};
          var _sy2=Math.max(0,pp.y);
          if(typeof spZoneAdd==='function')spZoneAdd({kind:'fire',x:pp.x,z:pp.z,y:_sy2,r:4.5,dur:_sd.dur||6,dps:18,slow:0.30,color:0xff8a3d});
          if(typeof spZoneNet==='function')spZoneNet('fire',pp.x,pp.z,4.5,(_sd.dur||6)*1000,0,_sy2);
          heroFxRingAt(pp.x,pp.z,0xff8a3d,4.5,0.6,0.4);
          spawnParticle(new THREE.Vector3(pp.x,Math.max(0.5,pp.y),pp.z),0xffb347,20,0.6,true);
        }catch(_){}
        projRemove(pp);
      } });
  }
  else if(k==='mine'){
    // 战术探测器：抛物线飞出，**第一次落地**就吸附展开并开始侦测
    var mv=heroThrowVel(),mf0=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,0x49b6ff,0.3,1.4,0.35);      // 出手提示圈
    throwInfo={x:mf0.x,y:mf0.y,z:mf0.z,vx:mv.vx,vy:mv.vy,vz:mv.vz,fuse:-1};
    projSpawn('mine',mf0.x,mf0.y,mf0.z,mv.vx,mv.vy,mv.vz,{fuse:-1,mesh:heroMeshMine(),rest:0.30,
      onLand:function(pp){SK.mineX=pp.x;SK.mineZ=pp.z;SK.mine=SK.mineLife||12;SK.minePing=0;
                          /* 【batch140】记下落点的高度与所在面的法线：脉冲环要贴在那张面上 */
                           /* 【batch143】ny=0（墙面）是 falsy，写 `pp.ny||1` 会被换成 1 →
                              法线变成 (±1,1,0)，脉冲环歪 45°。必须显式判类型。 */
                           SK.mineY=pp.y;SK.mineN=[pp.nx||0,(typeof pp.ny==='number'?pp.ny:1),pp.nz||0];
                           SK.mineObj=pp.mesh;projRemove(pp,true);} });
  }
  else if(k==='flash'){
    // 闪光弹：抛物线飞出 → **落地后**再等 FLASH_FUSE 秒引信到点才爆闪（不会一扔出去就炸）
    var fv=heroThrowVel(),ff0=heroThrowFrom();
    SK.flashX=ff0.x;SK.flashZ=ff0.z;                                     // 兜底位置（还没落地就爆时用）
    heroFxRingAt(camera.position.x,camera.position.z,0xffffff,0.3,1.4,0.35);
    throwInfo={x:ff0.x,y:ff0.y,z:ff0.z,vx:fv.vx,vy:fv.vy,vz:fv.vz,fuse:-1};
    projSpawn('flash',ff0.x,ff0.y,ff0.z,fv.vx,fv.vy,fv.vz,{fuse:-1,landFuse:FLASH_FUSE,mesh:heroMeshFlash(),rest:0.5,
      onBoom:function(pp){
        SK.flashX=pp.x;SK.flashZ=pp.z;
        heroFXFlash(pp.x,Math.max(0.7,pp.y),pp.z);                       // 落地后的爆闪
        heroFlashLocal(pp.x,pp.z);                                       // 结算：8m 内 AI 致盲 + 自己站太近也白屏
        if(netIsMulti()&&NET.connected)netSend({t:'boom',k:H.k,s:i,x:pp.x,z:pp.z});   // 引爆才通知服务端结算（敌人不会提前白）
      } });
  }
  else if(k==='medkit'){
    // 急救箱：抛物线飞到落点，**落地开箱**治疗 6 米内的所有人（联机由服务端结算）
    var kv=heroThrowVel(),kp0=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,0xffd75e,0.3,1.4,0.35);
    throwInfo={x:kp0.x,y:kp0.y,z:kp0.z,vx:kv.vx,vy:kv.vy,vz:kv.vz,fuse:-1};
    projSpawn('medkit',kp0.x,kp0.y,kp0.z,kv.vx,kv.vy,kv.vz,{fuse:-1,mesh:heroMeshMedkit(),rest:0.35,
      onLand:function(pp){
        heroFXMedkitBurst(pp.x,pp.y,pp.z);
        projRemove(pp);
        if(netIsMulti()&&NET.connected)netSend({t:'boom',k:H.k,s:i,x:pp.x,z:pp.z,y:pp.y});   // 【batch143】带高度
        else{var _mh=Math.round(40*heroHealMul());S.hp=Math.min(S.maxHp,S.hp+_mh);SK.slow=0;updateHp();}   // batch100：白泽被动
        try{ if(typeof rangeHealDummies==='function')rangeHealDummies(pp.x,pp.z,6,40); }catch(_){}   /* 【batch180】靶场回血靶：落点 6 米内回 40 */
      } });
  }
  else if(k==='frag'){
    // 破片手雷：抛出后 FRAG_FUSE 秒引信到点即爆（真抛物线，能弹墙弹地）
    var gv=heroThrowVel(),gf0=heroThrowFrom();
    SK.fragX=gf0.x;SK.fragZ=gf0.z;
    heroFxRingAt(camera.position.x,camera.position.z,0xff8a3d,0.3,1.4,0.35);
    throwInfo={x:gf0.x,y:gf0.y,z:gf0.z,vx:gv.vx,vy:gv.vy,vz:gv.vz,fuse:FRAG_FUSE};
    projSpawn('frag',gf0.x,gf0.y,gf0.z,gv.vx,gv.vy,gv.vz,{fuse:FRAG_FUSE,mesh:heroMeshFrag(),rest:0.45,
      onBoom:function(pp){
        SK.fragX=pp.x;SK.fragZ=pp.z;
        heroFXFragBurst(pp.x,Math.max(0.6,pp.y),pp.z);
        if(!netIsMulti())heroFragLocal(pp.x,pp.z);                          // 单机：本地结算伤害
        if(netIsMulti()&&NET.connected)netSend({t:'boom',k:H.k,s:i,x:pp.x,z:pp.z,y:pp.y});   // 【batch135】带上高度
      } });
  }
  else if(k==='smoke'||k==='medsmoke'){
    // 烟雾弹 / 治疗烟雾：落地后 SMOKE_LAND_FUSE 秒炸开烟团（挡视线；治疗烟雾额外解减速）
    var gold=(k==='medsmoke');
    var sv=heroThrowVel(),sf0=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,gold?0xf3d98a:0xcfd8df,0.3,1.4,0.35);
    throwInfo={x:sf0.x,y:sf0.y,z:sf0.z,vx:sv.vx,vy:sv.vy,vz:sv.vz,fuse:-1};
    projSpawn(k,sf0.x,sf0.y,sf0.z,sv.vx,sv.vy,sv.vz,{fuse:-1,landFuse:SMOKE_LAND_FUSE,mesh:heroMeshSmoke(gold),rest:0.4,
      onBoom:function(pp){
        heroFXSmokePop(pp.x,Math.max(0.6,pp.y),pp.z,gold);
        smokeZones.push({x:pp.x,y:pp.y,z:pp.z,r:SMOKE_R,t:SMOKE_LIFE,gold:gold});
        if(!netIsMulti()&&gold)SK.slow=0;                                   // 单机：治疗烟雾顺手解自己的减速
        if(netIsMulti()&&NET.connected)netSend({t:'boom',k:H.k,s:i,x:pp.x,z:pp.z,y:pp.y});   // 【batch135】带上高度
      } });
  }
  else if(k==='pulse'){
    // 医疗脉冲弹：落地炸开金色脉冲 —— 6 米内自己/队友回 45 血 + 弹着点留 5 秒治疗力场
    var uv=heroThrowVel(),uf0=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,0xffe08a,0.3,1.4,0.35);
    throwInfo={x:uf0.x,y:uf0.y,z:uf0.z,vx:uv.vx,vy:uv.vy,vz:uv.vz,fuse:-1};
    projSpawn('pulse',uf0.x,uf0.y,uf0.z,uv.vx,uv.vy,uv.vz,{fuse:-1,landFuse:PULSE_LAND_FUSE,mesh:heroMeshPulse(),rest:0.4,
      onBoom:function(pp){
        SK.auraX=pp.x;SK.auraZ=pp.z;SK.aura=Math.max(SK.aura,H.skills[i].dur);   // 力场圆心 = 弹着点
        heroFXHealAt(pp.x,pp.z,Math.max(0.05,pp.y-PROJ_R));                       // 【batch135】按真实弹着高度
        if(!netIsMulti()){                                                 // 单机：自己站在 6 米内才被治疗
          var sdx=camera.position.x-pp.x,sdz=camera.position.z-pp.z;
          if(sdx*sdx+sdz*sdz<=PULSE_R*PULSE_R){S.hp=Math.min(S.maxHp,S.hp+Math.round(PULSE_HEAL*heroHealMul()));updateHp();}   // batch100：白泽被动
        }
        try{ if(typeof rangeHealDummies==='function')rangeHealDummies(pp.x,pp.z,PULSE_R,PULSE_HEAL); }catch(_){}   /* 【batch180】靶场回血靶：脉冲落点 6 米内回 45（落点力场的持续回血在 rangeDummyTick 里） */
        if(netIsMulti()&&NET.connected)netSend({t:'boom',k:H.k,s:i,x:pp.x,z:pp.z,y:pp.y});   // 【batch143】带高度
      } });
  }
  /* 【batch120】⑤蚀日者 V「蚀日」：落点上空悬起黑日，每 1.2 秒脉冲一次，朝它看的人被致盲 */
  else if(k==='solar'){
    var sv2=heroThrowVel(),sf2=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,0xfff0c0,0.3,1.7,0.35);   // 日冕白金起手圈
    throwInfo={x:sf2.x,y:sf2.y,z:sf2.z,vx:sv2.vx,vy:sv2.vy,vz:sv2.vz,fuse:-1};
    projSpawn('solar',sf2.x,sf2.y,sf2.z,sv2.vx,sv2.vy,sv2.vz,{fuse:-1,mesh:heroMeshSolar(),rest:0.25,
      onLand:function(pp){
        heroFXSolarAt(pp.x,Math.max(0.4,pp.y),pp.z);
        SK.eclipses.push({x:pp.x,z:pp.z,r:SOLAR_R,y:pp.y-PROJ_R+SOLAR_H,life:SOLAR_LIFE,pulse:SOLAR_PULSE,obj:null,remote:false});
        projRemove(pp);
        /* 【batch143】补上高度：别人那边的黑日也要挂在同一个高度（原来只发 x,z → 一律挂在一楼） */
        if(netIsMulti()&&NET.connected)netSend({t:'boom',k:H.k,s:i,x:pp.x,z:pp.z,y:pp.y});
      } });
  }
  /* 【batch125】⑤蚀日者 N「日之眼」：扔出去，落地处升起一只眼 —— 以**落点**为中心暴露敌人 */
  else if(k==='suneye'){
    var ev=heroThrowVel(),ef0=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,0xfff1b8,0.3,1.6,0.4);       // 【batch125】淡金起手圈（0xffd75e 与医疗脉冲/急救箱撞签名）
    throwInfo={x:ef0.x,y:ef0.y,z:ef0.z,vx:ev.vx,vy:ev.vy,vz:ev.vz,fuse:-1};
    projSpawn('suneye',ef0.x,ef0.y,ef0.z,ev.vx,ev.vy,ev.vz,{fuse:-1,mesh:heroMeshSunEye(),rest:0.2,
      onLand:function(pp){
        SK.suneyeX=pp.x;SK.suneyeZ=pp.z;SK.suneyeY=pp.y-PROJ_R;
        /* 【batch143】记下所在面的法线：眼和暴露圈都要贴在那张面上（墙上 / 天花板上也要有） */
        SK.suneyeN=[pp.nx||0,(typeof pp.ny==='number'?pp.ny:1),pp.nz||0];
        SK.suneyeT=heroNow().skills[2].dur;SK.suneyeR=SUNEYE_R;SK.suneyeObj=null;
        heroFXSunEye(pp.x,pp.z,SK.suneyeY,SK.suneyeN[0],SK.suneyeN[1],SK.suneyeN[2]);
        projRemove(pp);
      } });
  }
  /* 【batch145】蚀日者 B「日蚀之门」不再走投掷流程 —— 改成"虚化 → 放门"，见 heroPortalCast() */
  /* 【batch120】⑥闪电 V「闪电光球」：落地炸出 2 米电区，踏进来吃 25 伤 + 20 秒三重减益 */
  else if(k==='orb'){
    var ov2=heroThrowVel(),of2=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,0x6ff0ff,0.3,0.95,0.30);   // 电青起手圈
    throwInfo={x:of2.x,y:of2.y,z:of2.z,vx:ov2.vx,vy:ov2.vy,vz:ov2.vz,fuse:-1};
    projSpawn('orb',of2.x,of2.y,of2.z,ov2.vx,ov2.vy,ov2.vz,{fuse:-1,landFuse:0.45,mesh:heroMeshOrb(),rest:0.42,
      onBoom:function(pp){
        heroFXOrbPop(pp.x,Math.max(0.4,pp.y),pp.z);
        var _om=heroMeshOrb();scene.add(_om);_om.position.set(pp.x,pp.y-PROJ_R+0.75,pp.z);
        SK.orbs.push({x:pp.x,z:pp.z,y:pp.y-PROJ_R+0.75,r:ORB_R,life:ORB_LIFE,obj:_om,remote:false,zapT:0,hitT:{}});
        if(netIsMulti()&&NET.connected)netSend({t:'boom',k:H.k,s:i,x:pp.x,z:pp.z});
      } });
  }
  /* 【batch158】⑦影月 V「暗影烟雾弹」：与烟雾弹同机制（挡视线，AI 看不见烟里的人），落地炸开 */
  else if(k==='ssmoke'){
    var wv2=heroThrowVel(),wf2=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,0x6f5bd6,0.3,1.4,0.35);   // 暗紫起手圈（色别于暗影炸弹起手圈与遁入环：探针签名要两两不同）
    throwInfo={x:wf2.x,y:wf2.y,z:wf2.z,vx:wv2.vx,vy:wv2.vy,vz:wv2.vz,fuse:-1};
    projSpawn('ssmoke',wf2.x,wf2.y,wf2.z,wv2.vx,wv2.vy,wv2.vz,{fuse:-1,landFuse:SMOKE_LAND_FUSE,mesh:heroMeshShadowSmoke(),rest:0.4,
      onBoom:function(pp){
        heroFXSmokePop(pp.x,Math.max(0.6,pp.y),pp.z,false,true);               // 【batch161】暗紫色烟团
        heroFxRingAt(pp.x,pp.z,0x9f8bff,0.7,2.4,0.6,Math.max(0.05,pp.y-0.1));   // 暗影毒烟专属紫环（签名区别于镇岳白烟）
        smokeZones.push({x:pp.x,y:pp.y,z:pp.z,r:SMOKE_R,t:SMOKE_LIFE,gold:false,dark:1});
        if(netIsMulti()&&NET.connected)netSend({t:'boom',k:H.k,s:i,x:pp.x,z:pp.z,y:pp.y});
      } });
  }
  /* 【batch158】⑦影月 B「暗影炸弹」：**碰墙不炸**（弹墙继续飞）、**碰地即爆** ——
     落点 4 米内漫出暗影毒圈（10 秒、每秒毒蚀 15 点）；落在哪层只毒哪层（二楼爆的毒不到一楼）。
     【batch159 修复】与白泽①医疗脉冲同一套「落地引信」代码（landFuse + onBoom，弹底 pp.y-PROJ_R 就是
     落点地面）—— 原来的 onLand 版在二楼会穿过楼板掉到一楼才炸（用户实测）。 */
  else if(k==='sbomb'){
    var bv2=heroThrowVel(),bf2=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,0x4a3b7d,0.3,1.5,0.40);   // 深紫起手圈（色别于烟雾起手圈/遁入环）
    throwInfo={x:bf2.x,y:bf2.y,z:bf2.z,vx:bv2.vx,vy:bv2.vy,vz:bv2.vz,fuse:-1};
    projSpawn('sbomb',bf2.x,bf2.y,bf2.z,bv2.vx,bv2.vy,bv2.vz,{fuse:-1,landFuse:0.35,mesh:heroMeshShadowBomb(),rest:0.4,
      onBoom:function(pp){
        var _sy=Math.max(0,pp.y-PROJ_R);   // 落点那张地面的世界高度（与医疗脉冲同一套口径，二楼也准）
        heroFxRingAt(pp.x,pp.z,0x8f7bff,0.8,SHADOW_R*2,0.8,_sy+0.12);
        spawnParticle(new THREE.Vector3(pp.x,_sy+0.5,pp.z),0x8f7bff,14);
        var _bm=heroMeshShadowBlob();_bm.scale.set(SHADOW_R,1,SHADOW_R);
        _bm.position.set(pp.x,_sy+0.06,pp.z);scene.add(_bm);
        SK.shadows.push({x:pp.x,y:_sy,z:pp.z,r:SHADOW_R,life:SHADOW_LIFE,obj:_bm,remote:false});
        if(netIsMulti()&&NET.connected)netSend({t:'boom',k:H.k,s:i,x:pp.x,z:pp.z,y:pp.y});   // y＝弹心高度（远端再减 PROJ_R 得地面，与其它技能同口径）
      } });
  }
  /* 【batch120】⑥闪电 B「电荷陷阱」：吸在碰到的那个面上，敌人靠近连劈 4 下（有血量、能被打掉） */
  else if(k==='trap'){
    var tv2=heroThrowVel(),tf2=heroThrowFrom();
    heroFxRingAt(camera.position.x,camera.position.z,0xbdf7ff,0.3,0.85,0.50);   // 淡青起手圈
    throwInfo={x:tf2.x,y:tf2.y,z:tf2.z,vx:tv2.vx,vy:tv2.vy,vz:tv2.vz,fuse:-1};
    projSpawn('trap',tf2.x,tf2.y,tf2.z,tv2.vx,tv2.vy,tv2.vz,{fuse:-1,mesh:heroMeshTrap(),rest:0.12,
      onLand:function(pp){
        /* 【batch143】先取落点所在面的法线：吸附朝向与脉冲环都用它 */
        var _tn=[pp.nx||0,(typeof pp.ny==='number'?pp.ny:1),pp.nz||0];
        var _gbase=projSurfAt(pp.x,pp.z,pp.y);
        var _onWall=((pp.y-PROJ_R)-_gbase)>0.9;                 // 停在离地较高的位置 → 判成"吸在墙上"
        var _tm=heroMeshTrap();scene.add(_tm);
        _tm.position.set(pp.x+_tn[0]*0.10,pp.y-PROJ_R+_tn[1]*0.10,pp.z+_tn[2]*0.10);
        /* 【batch141】按**真实表面法线**贴面。原来是 `if(_onWall){_tm.rotation.x=Math.PI/2;}`
           —— 只要"停在离地较高处"就写死绕 X 转 90°，不管撞的是东墙西墙，**永远朝同一个方向**
           （用户："不要一直朝着一面"）。现在法线来自撞墙/落地/天花板三处记录（batch140），
           和探测器用的是同一个公式：本地 +Y（底盘反方向）对准表面法线。
           万一没有法线（老存档 / 极端情况），退回原来的"立起来"行为。 */
        if(pp.nx||pp.ny||pp.nz)faceNormal(_tm,_tn[0],_tn[1],_tn[2],null);
        else if(_onWall){_tm.rotation.x=Math.PI/2;}
        SK.traps.push({x:pp.x,y:pp.y-PROJ_R+0.10,z:pp.z,r:TRAP_R,hp:TRAP_HP,life:TRAP_LIFE,
                       obj:_tm,armed:true,left:0,strike:0,remote:false});
        /* 【batch143】环贴在陷阱所在的那张面上（以前固定 y=0.06 横铺在地面/半空） */
        heroFxRingAt(pp.x,pp.z,0x6ff0ff,0.3,TRAP_R,0.45,pp.y-PROJ_R+0.05*_tn[1],_tn[0],_tn[1],_tn[2]);
        projRemove(pp);
        /* 【batch141】把贴面法线一起发出去 —— 别人那边也要贴着同一面墙 */
        if(netIsMulti()&&NET.connected)netSend({t:'trap',x:pp.x,y:pp.y-PROJ_R+0.10,z:pp.z,
          nx:pp.nx||0,ny:(typeof pp.ny==='number'?pp.ny:1),nz:pp.nz||0});   // 别人也要看得见这枚陷阱
      } });
  }
  if(multi&&NET.connected&&throwInfo)netSend({t:'skill',k:H.k,s:i,th:throwInfo});   // 把「出生点+初速」发给别人复现飞行
  showMsg('抛出：'+H.skills[i].name,H.css);
  heroHudUpdate(true);
  return true;
}
/* 长按开火键：进入瞄准（显示半透明抛物线）。返回 true 表示这一下左键被投掷流程接管了 */
function heroAimStart(){
  if(!SK.hold)return false;
  if(!S.playing||S.over||S.paused)return false;
  if(SK.hold.kind==='sp_wall'){ heroWallPlace(); return true; }   // 【batch178】墙：直接放下（不是抛物线）
  SK.aimThrow=true;heroPreviewUpdate();
  return true;
}
function heroAimEnd(){if(SK.aimThrow)heroDoThrow();}
/* 单机「震荡打击」：5 米内 AI 敌人受 25 伤害 + 减速 2 秒 */
function heroSmashLocal(r,dmg,slowT,knock){
  knock=(typeof knock==='number')?knock:KNOCK_DIST;
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];if(e.isNet||e.hp<=0)continue;
    var ep=e.root.position;                    // 【坑】世界坐标在 root，e.g 只是模型子组（局部）——用 e.g 会算成「以世界原点为中心」
    var dx=ep.x-camera.position.x,dz=ep.z-camera.position.z;
    if(dx*dx+dz*dz>r*r)continue;
    // 击退：沿"从爆心向外"的方向推 3 米（撞墙就只推得动多少算多少）
    var dl=Math.sqrt(dx*dx+dz*dz)||1;
    var kx=ep.x+dx/dl*knock,kz=ep.z+dz/dl*knock;
    if(!isColliding(kx,kz,e.sz*0.4)){ep.x=kx;ep.z=kz;}
    else if(!isColliding(kx,ep.z,e.sz*0.4))ep.x=kx;
    else if(!isColliding(ep.x,kz,e.sz*0.4))ep.z=kz;
    e.hp-=dmg;e.flash=0.25;e.slowT=Math.max(e.slowT||0,slowT);
    spawnParticle(ep.clone().setY(1.0),0xff8a3d,8);
    var rr=Math.max(0,e.hp/e.maxHp);if(e.hb)e.hb.scale.x=rr;
    if(e.hbMat)e.hbMat.color.setHex(rr>.5?0x00ff00:rr>.25?0xffff00:0xff0000);
    if(e.hp<=0)killEnemy(e,i,false);
  }
}
/* 单机「破片手雷」：8 米内 AI 受伤害（越远越轻）+ 被击退 + 减速 */
function heroFragLocal(x,z){
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];if(e.isNet||e.hp<=0)continue;
    var ep=e.root.position;                    // 【坑】世界坐标在 root，e.g 只是模型子组（局部）
    var dx=ep.x-x,dz=ep.z-z,d2=dx*dx+dz*dz;
    if(d2>FRAG_R*FRAG_R)continue;
    var d=Math.sqrt(d2);
    var k=1-d/FRAG_R;if(k<0)k=0;else if(k>1)k=1;              // 0（边缘）..1（中心）
    var dmg=Math.round(FRAG_DMG_MIN+(FRAG_DMG-FRAG_DMG_MIN)*k);
    var knock=FRAG_KNOCK*(0.4+0.6*k);
    var dl=d||1;                                              // 只在算击退方向时兜底，不影响伤害
    var kx=ep.x+dx/dl*knock,kz=ep.z+dz/dl*knock;
    if(!isColliding(kx,kz,e.sz*0.4)){ep.x=kx;ep.z=kz;}
    else if(!isColliding(kx,ep.z,e.sz*0.4))ep.x=kx;
    else if(!isColliding(ep.x,kz,e.sz*0.4))ep.z=kz;
    e.hp-=dmg;e.flash=0.3;e.slowT=Math.max(e.slowT||0,FRAG_SLOW);
    spawnParticle(ep.clone().setY(1.0),0xff8a3d,8);
    var rr=Math.max(0,e.hp/e.maxHp);if(e.hb)e.hb.scale.x=rr;
    if(e.hbMat)e.hbMat.color.setHex(rr>.5?0x00ff00:rr>.25?0xffff00:0xff0000);
    if(e.hp<=0)killEnemy(e,i,false);
  }
  // —— 自己：站在 8 米内也会被自己的手雷炸到（越近越重；护盾 / 阵地减伤照常生效）——
  var sdx=camera.position.x-x,sdz=camera.position.z-z,sd2=sdx*sdx+sdz*sdz;
  if(sd2<=FRAG_R*FRAG_R&&S.hp>0){
    var sd=Math.sqrt(sd2);
    var sk=1-sd/FRAG_R;if(sk<0)sk=0;else if(sk>1)sk=1;
    var _sdmg=Math.round(FRAG_DMG_MIN+(FRAG_DMG-FRAG_DMG_MIN)*sk);
    if(SK.idx===HERO_GUARD)_sdmg=Math.max(1,Math.round(_sdmg*PASSIVE_NADE_CUT));   // 【batch100 被动】镇岳：手雷减伤 30%
    /* 【batch227】联机下手雷自伤服务端已算（handleBoom 的 rusher 分支含扔弹者自己），本地不重复扣 */
    if(!netIsMulti())takeDmg(_sdmg,null);
  }
  /* 【batch181】爆炸照样伤轨道：火车站里一雷下去，烂掉的轨道会让下一班车脱轨 */
  if(typeof boomDamageTracks==='function')boomDamageTracks(x,z,FRAG_R,60);
  /* 【batch181】爆炸也直接打列车（停靠中的车一雷 150，两雷不到就废） */
  if(typeof boomDamageTrain==='function')boomDamageTrain(x,z,FRAG_R,150);
}
/* 联机：服务端把队友技能的增益发过来（范围判定在服务端做，这里只负责套到自己身上） */
function heroApplyBuff(b,dur){
  if(!(dur>0))dur=3;
  if(b==='shield')SK.shield=Math.max(SK.shield,dur);
  else if(b==='fortify')SK.fortify=Math.max(SK.fortify,dur);
  else if(b==='rush')SK.rush=Math.max(SK.rush,dur);
  else if(b==='adren')SK.adren=Math.max(SK.adren,dur);
  /* 【batch173】力场穹顶（服务端判定你在圈里 → 给你减伤 50%） */
  else if(b==='dome'){SK.dome=Math.max(SK.dome||0,dur);SK.domeX=camera.position.x;SK.domeZ=camera.position.z;
                      SK.domeY=(typeof standSurfY==='function'?standSurfY():0);SK.domeR=6;}
}
/* 联机：被震荡打击击退 —— 位移由本地做（尊重碰撞，和走路同一套判定） */
function heroKnock(fx,fz,pw){
  var dx=camera.position.x-fx,dz=camera.position.z-fz,L=Math.sqrt(dx*dx+dz*dz)||1;
  var nx=camera.position.x+dx/L*pw,nz=camera.position.z+dz/L*pw;
  if(!playerBlocked(nx,camera.position.z,standEyeY()))camera.position.x=nx;
  if(!playerBlocked(camera.position.x,nz,standEyeY()))camera.position.z=nz;
}
/* 「闪光弹」落地结算：**不限距离**——只要「朝爆点看 + 中间没有墙挡着」就会被闪（背对着看 = 没事）。
   致盲时长按"看多正"折算（正对 3 秒、擦边更短）；贴脸 3 米内不看也白。
   单机和联机都跑这一份——真人玩家之间的致盲由服务端按同样的规则算。 */
function heroFlashLocal(x,z){
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];if(e.isNet||e.hp<=0)continue;
    var ep=e.root.position;                                   // 【坑】世界坐标在 root，e.g 是模型子组（局部）
    if(!hasLineOfSight2D(ep.x,ep.z,x,z,1.2))continue;         // 墙挡住 → 闪不到
    var ey=(e.yawPivot&&e.yawPivot.rotation)?e.yawPivot.rotation.y:0;
    var k=flashFaceFactor(x,z,ep.x,ep.z,-Math.sin(ey),-Math.cos(ey));   // 它自己朝哪边看
    if(k<=0.05)continue;                                      // 背对爆点 → 不被闪
    e.blindT=Math.max(e.blindT||0,FLASH_BLIND*k);e.flash=0.3;
    spawnParticle(ep.clone().setY(1.1),0xffffff,6);
  }
  // —— 自己：只要朝爆点看（或贴脸）就会白，**不限距离** ——
  if(hasLineOfSight2D(camera.position.x,camera.position.z,x,z,camera.position.y-0.3)){
    var sdx=camera.position.x-x,sdz=camera.position.z-z,sd2=sdx*sdx+sdz*sdz;
    var fwd=camera.getWorldDirection(new THREE.Vector3());
    var k2=flashFaceFactor(x,z,camera.position.x,camera.position.z,fwd.x,fwd.z);
    if(sd2<FLASH_SELF_R*FLASH_SELF_R)k2=1;                    // 贴脸：不管朝哪看都得白
    if(k2>0.05){SK.blind=Math.max(SK.blind,FLASH_BLIND*k2);SK.blindDur=Math.max(SK.blindDur||0,FLASH_BLIND*k2);}   // 【batch183】记下致盲总时长，淡出按它算
  }
  heroBlindSync();
}
/* ---------------- 每帧推进（由 loop 调） ---------------- */
function updateHero(){
  var now=performance.now();
  var dt=SK._t?Math.min((now-SK._t)/1000,0.1):0.016;SK._t=now;
  for(var i=0;i<3;i++)if(SK.cds[i]>0)SK.cds[i]=Math.max(0,SK.cds[i]-dt*(SK.sp&&SK.idx===HERO_ECLIPSE&&spInOwnEclipse()?2:1));   /* 【batch181】焚曜被动「日冕永昼」：站在自己的黑日圈里，冷却恢复 ×2 */
  if(typeof spVeilTick==='function')spVeilTick(dt);                    /* 【batch181】蚀日者 SP「白夜」：跟随黑日 + 脉冲 */
  if(SK.revealAll>0)SK.revealAll=Math.max(0,SK.revealAll-dt);
  /* 【batch171】SP 运行态递减 + 蜂鸟无人机飞行 */
  if(SK.cloak>0){SK.cloak=Math.max(0,SK.cloak-dt);if(SK.cloak<=0){SK._breakAt=performance.now();spCloakSync();if(typeof showMsg==='function'&&SK._cloakWas>0)showMsg('隐身结束','#9ab');}}
  SK._cloakWas=SK.cloak>0?1:0;
  if(SK.spMarkT>0)SK.spMarkT=Math.max(0,SK.spMarkT-dt);
  /* 【batch173】SP 区域（火路/电网/治疗云/穹顶/掩体墙）+ 灼烧 + 爆燃弹计时 */
  if(SK.spBurnT>0)SK.spBurnT=Math.max(0,SK.spBurnT-dt);
  if(SK.dome>0){
    SK.dome=Math.max(0,SK.dome-dt);
    SK.inDome=(Math.sqrt((camera.position.x-(SK.domeX||0))*(camera.position.x-(SK.domeX||0))
                        +(camera.position.z-(SK.domeZ||0))*(camera.position.z-(SK.domeZ||0)))<=SK.domeR
               &&Math.abs(standSurfY()-(SK.domeY||0))<=2.5);
  }else SK.inDome=false;
  updateSpZones(dt);
  updateSpDrone(dt);
  if(SK.blind>0){SK.blind=Math.max(0,SK.blind-dt);heroBlindSync();}
  if(SK.dashBuff>0)SK.dashBuff=Math.max(0,SK.dashBuff-dt);
  // 堡垒阵地：站在半径 6 米内才算「在阵地里」（减伤 / 免减速都看这个标志）
  /* 【batch143】除了水平 6 米，还要**站在同一层**才对：二楼楼板上的圈，
     站在它正下方的一楼不算在阵地里（以前只看水平距离，隔着一层楼照样吃减伤）。 */
  SK.inFortify=(SK.fortify>0
    &&Math.sqrt((camera.position.x-SK.zoneX)*(camera.position.x-SK.zoneX)+(camera.position.z-SK.zoneZ)*(camera.position.z-SK.zoneZ))<=ZONE_R
    &&Math.abs(standSurfY()-SK.zoneY)<=2.0);
  if(SK.shield>0)SK.shield=Math.max(0,SK.shield-dt);
  if(SK.reflect>0)SK.reflect=Math.max(0,SK.reflect-dt);
  if(SK.fortify>0)SK.fortify=Math.max(0,SK.fortify-dt);
  if(SK.rush>0)SK.rush=Math.max(0,SK.rush-dt);
  if(SK.adren>0)SK.adren=Math.max(0,SK.adren-dt);
  if(SK.aura>0)SK.aura=Math.max(0,SK.aura-dt);
  if(SK.slow>0)SK.slow=Math.max(0,SK.slow-dt);
  if(SK.hitFlash>0)SK.hitFlash=Math.max(0,SK.hitFlash-dt);
  // ---- 突进：沿朝向平移，撞墙提前停（用 playerBlocked 做水平碰撞，和走路同一套）----
  if(SK.dash>0){
    var step=34*dt,nx=camera.position.x+SK.dashX*step,nz=camera.position.z+SK.dashZ*step;
    if(playerBlocked(nx,camera.position.z,standEyeY())&&playerBlocked(camera.position.x,nz,standEyeY())){SK.dash=0;}
    else{
      if(!playerBlocked(nx,camera.position.z,standEyeY()))camera.position.x=nx;
      if(!playerBlocked(camera.position.x,nz,standEyeY()))camera.position.z=nz;
      SK.dash-=dt;S.velY=0;S.landKick=0;                      // 突进途中不摔
      SK.dashLast=(SK.dashLast||0)+dt;
      if(SK.dashLast>=0.035){SK.dashLast=0;heroGhost();}       // 每 35ms 留一个残影
      if(Math.abs(camera.position.x)>worldLimit()-1.2||Math.abs(camera.position.z)>worldLimit()-1.2)SK.dash=0;
    }
  }
  // ---- 医疗力场 / 肾上腺素：持续回血（联机由服务端结算，本地不叠加，避免血条抖）----
  if(!netIsMulti()){
    /* 【batch181】焚曜被动「日冕永昼」：站在自己的黑日圈里每秒回 3 血 */
    if(SK.sp&&SK.idx===HERO_ECLIPSE&&spInOwnEclipse()&&S.hp>0&&S.hp<S.maxHp){
      S._eclAcc=(S._eclAcc||0)+dt;
      if(S._eclAcc>=1.0){S._eclAcc=0;S.hp=Math.min(S.maxHp,S.hp+3);updateHp();}
    }
    var _adx=camera.position.x-SK.auraX,_adz=camera.position.z-SK.auraZ;
    var _inAura=(SK.aura>0&&_adx*_adx+_adz*_adz<=PULSE_R*PULSE_R);        // 站在落点力场里才回血
    if(_inAura&&S.hp>0&&S.hp<S.maxHp){
      S._healAcc=(S._healAcc||0)+dt;
      if(S._healAcc>=0.5){S._healAcc=0;S.hp=Math.min(S.maxHp,S.hp+Math.round(3*heroHealMul()));updateHp();}   // batch100：白泽被动
    }
    if(SK.adren>0&&S.hp>0&&S.hp<S.maxHp){
      S._adrAcc=(S._adrAcc||0)+dt;
      if(S._adrAcc>=0.5){S._adrAcc=0;S.hp=Math.min(S.maxHp,S.hp+Math.round(2*heroHealMul()));updateHp();}   // batch100：白泽被动
    }
  }
  updateHeroMark();
  updateScoutAlert();                                          // batch100 被动：天狼「敌情预警」箭头
  if(SK.hold&&(!S.playing||S.over||S.hp<=0))heroHoldCancel();   // 死了 / 结束了自动把手里的收起来
  if(SK.hold){
    weaponGroup.visible=false;                                  // 持握期间枪/刀一直不露头
    /* 【batch219】模组投掷物没有 HOLD_POSE 条目 → 用破片手雷的姿势兜底，
       否则 `if(HOLD_POSE[kind])` 不成立，它会一直待在相机原点（贴脸不动）。 */
    if(_holdObj){
      var P=HOLD_POSE[SK.hold.kind]||HOLD_POSE.frag,tt=performance.now()*0.001;
      SK.holdT=Math.min(1,(SK.holdT||0)+dt/0.26);
      var kk=1-Math.pow(1-SK.holdT,3);                          // ease-out：先快后慢地"掏出来"
      var jit=(SK.hold.kind==='flash')?Math.sin(tt*30)*0.006:0; // 闪光弹引信烧着 → 手在轻抖
      _holdObj.position.set(P.x, P.y+P.rise*(1-kk)+Math.sin(tt*2.2)*P.sway+jit, P.z);
      _holdObj.rotation.y=P.ry+kk*0.5+tt*P.spin*0.5;
      _holdObj.rotation.z=Math.sin(tt*(SK.hold.kind==='medkit'?1.6:2.2))*P.sway;
      /* 【batch216】用户："第一人称手持投掷物也要有手臂手持的样子"。
        以前拿投掷物时 weaponGroup 和 leftHandCamGroup 全藏起来 → 屏幕上只有一件东西浮着。
        现在建一只**独立的右手**（手套 + 小臂，和持枪那只同一套 buildRightHand），
        每帧跟着投掷物走：手在它的后下方握着，小臂往右下后方收回画面外。
        抖动（闪光弹引信）也会跟着传过去 —— 手和东西是一起动的。 */
      if(!_holdHand){
        _holdHand=new THREE.Group();
        try{
          camera.add(_holdHand);
          if(typeof buildRightHand==='function')
            buildRightHand(_holdHand,new THREE.Vector3(-0.020,-0.082,0.036),new THREE.Vector3(0.120,-0.150,0.330));
        }catch(e){ _holdHand=null; }
      }
      if(_holdHand){
        _holdHand.visible=true;
        _holdHand.position.copy(_holdObj.position);
        _holdHand.position.y+=jit;                                        // 引信抖动 → 手跟着抖
        _holdHand.rotation.set(-0.16,P.ry*0.55+kk*0.20,0.10);
        _holdHand.scale.setScalar(SK.hold.kind==='sp_wall'?0.55:1);       // 掩体墙是"举着"的大件，手放小一点免得挡屏
      }
    }
  }
  if(SK.hold&&SK.hold.kind==='sp_wall')heroWallGhostUpdate();   // 【batch178】举着墙时实时预览落点
  if(SK.aimThrow)heroPreviewUpdate();
  /* 【batch178】墙钻地动画 + 把站上面的玩家顶起来 */
  if(SK.wallRises&&SK.wallRises.length){
    for(var _ri=SK.wallRises.length-1;_ri>=0;_ri--){
      var _wr=SK.wallRises[_ri];_wr.t+=dt;
      var _k=Math.min(1,_wr.t/_wr.dur),_e=_k*_k*(3-2*_k);
      var _ys=_wr.surf-2.7,_ye=_wr.surf+1.35;
      _wr.mesh.position.y=_ys+_e*(_ye-_ys);
      if(_k<1){
        _wr.box.rising=true;
        var _top=_wr.mesh.position.y+1.35+GROUND_Y;
        if(camera.position.x>_wr.box.minX-0.5&&camera.position.x<_wr.box.maxX+0.5&&camera.position.z>_wr.box.minZ-0.5&&camera.position.z<_wr.box.maxZ+0.5){
          if(camera.position.y<_top)camera.position.y=_top;   // 顶起来（站到墙顶）
        }
      }else{ if(_wr.box)_wr.box.rising=false; SK.wallRises.splice(_ri,1); }
    }
  }                           // 瞄准中：抛物线跟着视角实时刷新
  updateHeroFX(dt);
  updateHeroWorld(dt);                                          // 【batch120】新英雄的世界层（黑日 / 传送门 / 电区 / 陷阱 / 球形闪电 / 倒地）
  heroHudUpdate(false);
}
