
/* ==================== 【batch167】页面自适配（引擎空壳补齐）====================
   为什么需要：瓦罗兰特版是一份**完全独立的页面** spike.html —— 它的 <body> 是手写的，
   里面没有原版主菜单 / 战斗商店 / 剧情 / 枪械改装这些东西。可引擎里有 20 多处是直接
   `document.getElementById('xxx').yyy` 的（没做空值保护），元素一旦不存在，那一整段
   脚本就抛错 → **整个游戏都起不来**。
   做法：启动时把"这一页没有、但引擎会碰"的元素统一补成**隐藏空壳**：
     · 原版 index.html 本来就有这些元素 → 这个函数什么都不做，对它零影响；
     · 独立页面缺哪个补哪个 → 引擎照常跑，不会因为少个菜单就崩。
   ⚠️ 只补"普通元素"。canvas / 有专属行为的元素必须由页面自己提供。 */
function ensureEngineDom(){
  var ids=['startBtn','btnResume','btnQuit','storyBtn','storyTag','nameOk','wsContinue',
           'upgrade-grid','ws-upgrade-grid','wave-shop','ws-gold','ws-wave','shop-gold',
           'score','gold-hud','relockBtn','menuTitle','menuSetBtn','btnRescue','storyChapGrid',
           'storyPickGrid','downedTip','ghostTip','shadowTip','netBoard','netDeath','go','fs',
           'fg','fk','fw','myIdLine'];
  for(var i=0;i<ids.length;i++){
    var id=ids[i];
    try{
      if(!document.getElementById(id)){
        var d=document.createElement('div');d.id=id;d.style.display='none';
        document.body.appendChild(d);
      }
    }catch(e){}
  }
}
try{ensureEngineDom();}catch(e){}
// ==================== UPGRADE SYSTEM ====================
var UPGRADES = [
  { id:'damage',   icon:'⚔️', name:'伤害提升',   desc:'每级 +30% 武器伤害', maxLv:5, costs:[80,160,320,640,1200], effect:function(lv){return 1+lv*0.3;} },
  { id:'fireRate', icon:'🔥', name:'射速提升',   desc:'每级射击间隔 -12%', maxLv:5, costs:[80,160,320,640,1200], effect:function(lv){return Math.pow(0.88,lv);} },
  { id:'magSize',  icon:'📦', name:'弹匣扩容',   desc:'扩容改变枪械外观，满级变弹鼓', maxLv:5, costs:[60,120,240,480,900], effect:function(lv){return 30+lv*8;} },
  { id:'reload',   icon:'⚡', name:'快速装弹',   desc:'每级换弹时间 -15%', maxLv:5, costs:[60,120,240,480,900], effect:function(lv){return 1200*Math.pow(0.85,lv);} },
  { id:'speed',    icon:'👟', name:'移动速度',   desc:'每级移速 +10%', maxLv:5, costs:[60,120,240,480,900], effect:function(lv){return 0.15*(1+lv*0.1);} },
  { id:'health',   icon:'❤️', name:'生命强化',   desc:'每级最大HP +25', maxLv:5, costs:[80,160,320,640,1200], effect:function(lv){return 100+lv*25;} },
  { id:'recoil',   icon:'🎯', name:'后坐力控制', desc:'每级后坐力幅度与恢复时间 -15%', maxLv:5, costs:[100,200,400,800,1500], effect:function(lv){return Math.pow(0.85,lv);} },
  { id:'adsSpeed', icon:'🔭', name:'开镜速度',   desc:'每级开镜/收镜速度 +18%', maxLv:5, costs:[60,120,240,480,900], effect:function(lv){return 1+lv*0.18;} },
  { id:'hipSpread',icon:'📐', name:'腰射精度',   desc:'每级不开镜时散射 -15%', maxLv:5, costs:[60,120,240,480,900], effect:function(lv){return Math.pow(0.85,lv);} }
];
var upgradeLevels = { damage:0, fireRate:0, magSize:0, reload:0, speed:0, health:0, recoil:0, adsSpeed:0, hipSpread:0 };
var gold = 0, totalGoldEarned = 0;

function getVal(id){ for(var i=0;i<UPGRADES.length;i++){ if(UPGRADES[i].id===id){ var lv=upgradeLevels[id]||0; var val=UPGRADES[i].effect(lv); return(typeof val==='number'&&isFinite(val))?val:0;}} return 0;}
function tryBuy(id){ var u=null;for(var i=0;i<UPGRADES.length;i++)if(UPGRADES[i].id===id)u=UPGRADES[i];if(!u)return;var lv=upgradeLevels[id];if(lv>=u.maxLv)return;var cost=u.costs[lv];if(gold<cost)return;gold-=cost;upgradeLevels[id]++;applyUpgrades();renderUpgradeCards();}
function applyUpgrades(){ S.maxHp=Math.max(100,getVal('health'));S.hp=Math.min(S.hp,S.maxHp);S.maxAmmo=Math.max(30,getVal('magSize'));S.ammo=Math.min(S.ammo,S.maxAmmo);S.fireRate=Math.max(28,50*getVal('fireRate'));S.reloadTime=Math.max(400,getVal('reload'));S.damageMul=Math.max(1,getVal('damage'));var spd=getVal('speed');S.baseSpeed=(spd>0.01)?spd:0.15;S.recoilMul=getVal('recoil');var _as=getVal('adsSpeed');S.adsSpeedMul=(_as>0.05)?_as:1;var _hs=getVal('hipSpread');S.hipSpreadMul=(_hs>0.05)?_hs:1;rebuildWeaponModel();updateHp();updateAmmo();try{if(typeof applyWeaponDef==='function')applyWeaponDef();}catch(e){}}

// ==================== THREE.JS SETUP ====================
var scene=new THREE.Scene();scene.background=new THREE.Color(0x1a1a2e);scene.fog=new THREE.FogExp2(0x1a1a2e,0.015);
var camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,0.01,300);camera.position.set(0,2,15);   // 【batch114】远平面 200→300：日蚀图的天空穹顶在 135 米外，太小会把它裁掉
var renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'});renderer.setSize(innerWidth,innerHeight);
/* 【batch195】像素比上限 1.25，**下限 0.72**，中间由 PERF（文件末尾）动态调。
   原来这里是死值：高端机浪费、低端机一律卡。现在对外只有一个承诺——尽量稳 60 帧，
   帧时间一旦超过 18.6ms 就往下收渲染分辨率（0.08 一档，最低 0.72），
   富余时再慢慢放回去（0.04 一档，最多回到 1.25）。
   分辨率是**唯一能线性买帧率**的手段（像素数按平方缩），所以第一个动它是正确的；
   阴影档位 / AO 强度排在它后面（见 LIGHT.tick 里的判断条件）。 */
var RENDER_PR=(function(){ try{ return Math.max(0.9,Math.min(devicePixelRatio||1,1.25)); }catch(e){ return 1; } })();
renderer.setPixelRatio(RENDER_PR);document.body.appendChild(renderer.domElement);
/* 【batch114】打开阴影贴图（真正的投影灯由下面的【batch189】光影系统创建）。 */
try{ renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; }catch(e){}
/* 【batch194】**阴影贴图不再每帧重画**：autoUpdate=false，改由 LIGHT.tick 按需置 needsUpdate。
   r128 的 WebGLShadowMap.render 开头是 `if(!autoUpdate && !needsUpdate) return;`，
   末尾会把 needsUpdate 复位 —— 所以"一次 render 一次消费"是成立的。
   省的是整整一趟阴影渲染（日蚀图 336 个投影网格 × 每帧），是当前最大的单项开销之一。 */
try{ renderer.shadowMap.autoUpdate=false; renderer.shadowMap.needsUpdate=true; }catch(e){}

/* ==================== 【batch194】柔和阴影：自己接管 PCF_SOFT 的采样 ====================
   用户两条反馈挂在同一处：
     ·「阴影的边缘特别粗糙」← three 的 PCF_SOFT 把 16 个采样点**全挤在 1.5 texel 以内**。
       2048 / 32 米的贴图一格才 3 厘米，半影只有 4~5 厘米 —— 等于没有过渡，就是一刀切的硬边。
     ·「阴影的渲染怎么会有那么多噪点」← 它用 `fract(uv*size+0.5)` 做双线性，
       在深度不连续的地方会整整跳一格 texel，于是影子边缘一圈"颗粒 + 锯齿"；
       地面是一整张 160×160 的平面，掠射角下最明显，看着就是满屏噪点。
   改法：PCF_SOFT 分支换成**旋转 13 点圆盘 PCF**，半径由 shadow.radius 控制（单位：texel）：
     · 采样数 16 → 13，比原来更省；
     · 半影 ≈ 2 × radius × texel，radius=3 时约 19 厘米 —— 边缘是真正的渐变；
     · 每个像素的旋转相位来自**交错梯度噪声（IGN）**：只跟 gl_FragCoord 有关，
       静止时绝对不动（不会"沙沙"响），相邻像素相位有序 → 噪点细密均匀，
       模糊/缩放之后就被吃掉了，不会留下随机 hash 那种"云纹斑"。
   ⚠️ 必须整段匹配成功才替换；匹配不上就原样保留 three 的实现（宁可不柔，也不要半截 shader）。 */
var SOFT_SHADOW_OK=false;
try{
  var _sc=THREE.ShaderChunk&&THREE.ShaderChunk.shadowmap_pars_fragment;
  if(_sc){
    var _sa0=_sc.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
    var _sb0=_sc.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )');
    if(_sa0>0&&_sb0>_sa0){
      var _sfc=[
        '#elif defined( SHADOWMAP_TYPE_PCF_SOFT )',
        '\t\t\tvec2 texelSize = vec2( 1.0 ) / shadowMapSize;',
        '\t\t\tfloat srd = max( shadowRadius, 0.75 );',
        '\t\t\tfloat sang = fract( 52.9829189 * fract( 0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y ) ) * 6.2831853;',
        '\t\t\tfloat ssa = sin( sang );',
        '\t\t\tfloat sca = cos( sang );',
        '\t\t\tvec2 shc = shadowCoord.xy;',
        '\t\t\tfloat shz = shadowCoord.z;',
        '\t\t\tfloat swi = 0.0;',
        '\t\t\tfloat swt = 0.0;',
        '\t\t\tfloat sv;',
        /* 【batch195】内核：半径只有外圈的 0.30 —— 物体脚底、墙根这些"明明被挡住"的接触点
           在本影里，必须接近全黑。原来单圈 PCF 的半影从接触点就开始渐变，
           于是每个物体周围挂着一圈亮缝（用户说的"被遮挡了却还有一丝光亮"）。 */
        '\t\t\tvec2 si = vec2( sca, ssa ) * texelSize * srd * 0.30;',
        '\t\t\tvec2 sj = vec2( -ssa, sca ) * texelSize * srd * 0.30;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc, shz );                 swi += sv * 0.34; swt += 0.34;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc + si, shz );            swi += sv * 0.115; swt += 0.115;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc - si, shz );            swi += sv * 0.115; swt += 0.115;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc + sj, shz );            swi += sv * 0.115; swt += 0.115;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc - sj, shz );            swi += sv * 0.115; swt += 0.115;',
        /* 【batch195】外圈：半径 = radius，45° 错开 8 点 —— 负责"影子边缘由硬到软"的长渐变，
           离遮挡物越远、越接近半影外沿，权重越低。两层叠起来就是本影 + 半影：
           同一块影子从核心到边缘亮度连续变化，而不是一个死板强度。 */
        '\t\t\tvec2 sx = vec2( sca, ssa ) * texelSize * srd;',
        '\t\t\tvec2 sy = vec2( -ssa, sca ) * texelSize * srd;',
        '\t\t\tvec2 sd0 = ( sx + sy ) * 0.70710678;',
        '\t\t\tvec2 sd1 = ( sx - sy ) * 0.70710678;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc + sx, shz );             swi += sv * 0.055; swt += 0.055;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc - sx, shz );             swi += sv * 0.055; swt += 0.055;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc + sy, shz );             swi += sv * 0.055; swt += 0.055;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc - sy, shz );             swi += sv * 0.055; swt += 0.055;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc + sd0, shz );            swi += sv * 0.0425; swt += 0.0425;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc - sd0, shz );            swi += sv * 0.0425; swt += 0.0425;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc + sd1, shz );            swi += sv * 0.0425; swt += 0.0425;',
        '\t\t\tsv = texture2DCompare( shadowMap, shc - sd1, shz );            swi += sv * 0.0425; swt += 0.0425;',
        '\t\t\tshadow = swt > 0.0 ? swi / swt : 1.0;',
        ''
      ].join('\n');
      THREE.ShaderChunk.shadowmap_pars_fragment=_sc.slice(0,_sa0)+_sfc+_sc.slice(_sb0);
      SOFT_SHADOW_OK=true;
    }
  }
}catch(e){ SOFT_SHADOW_OK=false; }
var ambLight=new THREE.AmbientLight(0x556677,0.8);scene.add(ambLight);   /* 【batch189】环境光交给 LIGHT 按地图调强度（日蚀图 0.8 会把白色地面顶到纯白，阴影全被削平） */
var muzzleLight=new THREE.PointLight(0xffaa00,0,8);muzzleLight.position.set(0.3,-0.3,-1);camera.add(muzzleLight);scene.add(camera);

/* ==================== 【batch189】光影 / 阴影系统 ====================
   背景：batch123 用户反馈"光影算法太卡"，当时的做法是把日蚀图的投影灯整个关掉，
   于是全游戏**没有一个影子**（画面是纯平光，完全没有立体感）。
   这次重做成"一盏会走路的太阳 + 自动降档"，思路：
     ① 只留**一盏**投影方向光，且它的位置始终跟着玩家（偏移固定）——
        阴影相机只覆盖身边 22/34/46 米，远处的物体被视锥直接剔掉，
        所以"1100 个方块全图投影"那种灾难不会重演；
     ② 谁投影也筛过：透明材质(玻璃/体积光/粒子)、天空穹顶、相机下的视角武器(枪/手/刀)
        一律不投影；尺寸小于 0.45 米的碎件只收影不投影；
     ③ 帧率自适应：连续 3 秒低于 38fps 自动降一档（最狠降到 0=关阴影），
        稳定 56fps 以上 8 秒再升回去 —— 卡不卡由机器自己决定，不用玩家去设置里翻；
     ④ 每张地图一套光色（暖阳 / 冷白 / 昏黄），和 MAP_THEME 的背景雾色配套。
   ⚠️ 视角武器必须排除投影：它挂在 camera 上，离镜头 0.3 米，
      一旦投进 shadow map 就是一块糊在屏幕正中的黑斑。 */
var LIGHT={
  档位:2,               // 0=关阴影 1=低 2=中 3=高（贴图见 档尺寸，覆盖范围见 档范围）
  档位上限:3,
  /* 【batch195】档位不再是"范围换大小"，而是"贴图密度"：
     覆盖范围永远是**整张地图**（只有一张 shadow map，和玩家站哪儿无关），
     档位只决定这张全图贴图有多细。这样"走过去才有影子"的问题从根上没了。 */
  档尺寸:function(lv){ lv=lv|0; return (lv<=1)?2048:((lv===2)?3072:4096); },
  /* 【batch195】阴影覆盖半径 = 地图 limit × 1.20（把边线上的墙也罩进去）。
     各图 limit：classic 76 / eclipse 104 / lab 88 / station 78 / range 70
     → 覆盖半径 91 / 125 / 106 / 94 / 84 米 —— 玩家在图上任何位置，
     视野里的地面、墙、箱子都在阴影相机里，不存在"走近才出现影子"。 */
  档范围:function(lv){
    var R=95;
    try{
      var m=(typeof mapNow==='function')?mapNow():null;
      if(m&&m.limit>0)R=m.limit*1.20;
    }catch(e){}
    return Math.max(62,Math.min(140,R));
  },
  /* 【batch195】texel 尺寸（米/格）：所有 bias / 半影参数都要按它换算，
     否则换图（范围变了）之后阴影会突然出条纹或者糊成一团。 */
  格宽:function(lv){ lv=lv|0; return (2*this.档范围(lv))/this.档尺寸(lv); },
  自动:true,            // 帧率自适应
  sun:null,半球:null,目标:null,
  _色调:'',_扫:0,_fpsT:0,_fpsN:0,_低:0,_高:0,_图范围:0,
  图色:{
    classic:{光:0xffeedd,强:0.85,天:0x9fb6d8,地:0x2b2f3a,天强:0.20,环境:0.80},
    eclipse:{光:0xffd9a6,强:0.85,天:0xa8c4e8,地:0x6a5638,天强:0.26,环境:0.50},
    lab:    {光:0xd8ecff,强:0.66,天:0x8fb4d8,地:0x141a22,天强:0.24,环境:0.55},
    station:{光:0xffd2a0,强:0.78,天:0xb9c6de,地:0x3a3226,天强:0.22,环境:0.66},
    range:  {光:0xfff2dd,强:0.80,天:0xa8c0e0,地:0x2a303c,天强:0.24,环境:0.68}
  },
  初始化:function(){
    var s=this;
    /* 主光：原来那盏固定在 (30,50,20) 的方向光，现在改成一盏"跟着玩家走的太阳"并开投影 */
    s.sun=new THREE.DirectionalLight(0xffeedd,0.72);
    s.sun.castShadow=true;
    try{
      var c=s.sun.shadow.camera;
      /* 【batch195】范围由 应用档位 按地图设置（全图覆盖），这里只给一个保守初值 */
      c.left=-95;c.right=95;c.top=95;c.bottom=-95;c.near=0.5;c.far=360;
      /* 【batch195】bias 全部改成**按 texel 自动换算**：
         贴图从"身边 72 米 / 2048"变成"整图 240 米 / 3072"，一格从 3.5 厘米变成 7.8 厘米，
         bias / normalBias 如果还是写死的小数字，立刻就是满地条纹（bias 不够）
         或者影子从物体脚下断开（normalBias 太大）。统一在 应用档位 里按 格宽() 算。 */
      s.sun.shadow.bias=-0.0006;
      s.sun.shadow.normalBias=0.06;
      s.sun.shadow.radius=2.2;
    }catch(e){}
    s.目标=new THREE.Object3D();
    scene.add(s.目标); s.sun.target=s.目标; scene.add(s.sun);
    /* 半球光：补天光/地面反射，让背光面不是死黑（很弱，只负责"透气"） */
    try{ s.半球=new THREE.HemisphereLight(0xa8c0e0,0x2a2e38,0.20); scene.add(s.半球); }catch(e){}
    s.amb=(typeof ambLight!=='undefined')?ambLight:null;   /* 环境光按地图调强度（见下方图色表 环境） */
    /* 【batch192】换 key：旧版的自适应会把"被降到 0"也写进 localStorage，玩家从此永远没阴影。
       新 key 一读就是玩家真正选过的档位，脏数据自动作废（读不到就用默认档）。 */
    try{ var v=parseInt(localStorage.getItem('mc2_光影档位_v2'),10); if(v>=0&&v<=3)s.档位=v; }catch(e){}
    s.应用档位();
  },
  应用档位:function(临时){
    var s=this; if(!s.sun)return;
    var lv=s.档位|0;
    try{
      s.sun.castShadow=(lv>0);
      var size=s.档尺寸(lv), r=s.档范围(lv);
      s.sun.shadow.mapSize.set(size,size);
      var c=s.sun.shadow.camera; c.left=-r;c.right=r;c.top=r;c.bottom=-r;
      c.near=0.5; c.far=r*2.6;
      try{ c.updateProjectionMatrix(); }catch(e){}
      /* 【batch195】bias 按 texel 自适应，而且要**尽量小**：
         任何 bias 都会让影子从物体边缘往回收（彼得潘效应），收出来的那条缝
         就是用户说的"明明被遮挡了却还有一丝光亮"。
         收多少 ≈ normalBias × tan(光角度)，光方向 (32,42,22) 的 tan≈0.96，
         所以 normalBias 8.3cm 时影子就离物体 8cm —— 肉眼看就是一圈亮边。
         现在压到 1 格（≈6cm），剩下的靠深度 bias 补：
         深度 bias 换算成世界尺寸是 bias × (far-near)，这里 (far-near)≈237，
         取 -0.00028×比值 ≈ 7cm 等效 —— 两个加起来刚好够压痤疮，又不至于把影子撑开。 */
      var gw=s.格宽(lv);
      s.sun.shadow.normalBias=gw*1.05;
      s.sun.shadow.bias=-0.00028*(gw/0.035);
      s.sun.shadow.radius=(gw<0.070)?2.8:2.2;
      /* 改了贴图尺寸必须丢掉旧 render target，否则 three 会继续用旧的（档位看起来没变） */
      if(s.sun.shadow.map){ try{ s.sun.shadow.map.dispose(); }catch(e){} s.sun.shadow.map=null; }
      /* map 被丢掉之后必须**立刻重画一次**：现在 shadowMap.autoUpdate=false，
         不主动要一次的话新贴图是空白 → 整屏没影子。 */
      try{ if(renderer&&renderer.shadowMap){ renderer.shadowMap.needsUpdate=true; s._影强制=true; } }catch(e){}
      s._图范围=r;
    }catch(e){}
    /* 【batch192】自动降档传 临时=true → 不落盘。localStorage 里永远存的是**玩家自己选的**档位，
       所以"刷新页面就回到原画质"是成立的；否则降一次就被永久记住、再也回不来。 */
    if(!临时){ try{ localStorage.setItem('mc2_光影档位_v2',String(lv)); }catch(e){} }
  },
  升级:function(){ if(this.档位<this.档位上限){this.档位++;this.应用档位();} },
  降级:function(){ if(this.档位>0){this.档位--;this.应用档位();} },
  换色:function(id){
    var s=this,c=s.图色[id]||s.图色.classic;
    try{
      s.sun.color.setHex(c.光); s.sun.intensity=c.强;
      if(s.半球){ s.半球.color.setHex(c.天); s.半球.groundColor.setHex(c.地); s.半球.intensity=c.天强; }
      if(s.amb&&typeof c.环境==='number')s.amb.intensity=c.环境;
    }catch(e){}
  },
  扫场景:function(){
    var s=this, px=camera.position.x, pz=camera.position.z;
    /* 【batch195】阴影相机罩住整张地图（半径 = limit×1.2），所以"近"的门槛
       也跟着放到全图：小件在 1.05R 以内参与，大件永远参与。
       ⚠️ 这里只管**投影**（castShadow）；接收（receiveShadow）在下面一律为 true ——
       用户要的是"能看见的地方都有影子"，而 receiveShadow 按距离关掉之后，
       站在地图角落时远处 70 米外的地面/箱子根本不接影子（实测只剩 8 个网格收影），
       那不是"全覆盖"，是"半覆盖"。省 shadow pass 靠筛 castShadow 就够。 */
    var _R=(s._图范围>0)?s._图范围:s.档范围(s.档位|0);
    var _nearD=_R*1.05, _farD=_R*1.15;
    try{
      scene.traverse(function(o){
        if(!o.isMesh||!o.geometry)return;
        var ud=o.userData||(o.userData={});
        /* 【batch195】合并后的静态地图（draw call 从上千降到个位数）：
           它的包围球就是整张地图，走下面的尺寸规则会被判成"超大件不投影" → 全图没影子。
           直接钉死：永远投影、永远收影，不参与任何距离/尺寸剔除。 */
        /* 【batch198】合并后的敌人/角色模型也是 _合几何 —— 但"烟里的角色"必须不投影，
           所以这条特判要认 _遮影（由 js/43 updateShadeShadow 打标记），不能无条件开投影。 */
        if(ud._合几何){ var _c=!ud._遮影; if(o.castShadow!==_c)o.castShadow=_c; if(!o.receiveShadow)o.receiveShadow=true; return; }
        if(!ud._光影){
          /* 第一次见到这个网格：判材质 / 父链 / 包围球，不合格的永久跳过（_光影=2） */
          var m=o.material,skip=false;
          if(m&&!m.length){
            if(m.transparent||((typeof m.opacity==='number')&&m.opacity<0.95))skip=true;   // 玻璃 / 体积光 / 淡出特效
            else if(m.side===THREE.BackSide)skip=true;                                    // 天空穹顶
            else if(m.depthWrite===false)skip=true;                                       // 叠加层特效
          }
          if(!skip){
            var q=o.parent;
            while(q){ if(q===camera){skip=true;break;} q=q.parent; }                        // 视角武器绝不投影（会糊黑屏幕）
          }
          var r=0;
          if(!skip){
            try{
              if(!o.geometry.boundingSphere)o.geometry.computeBoundingSphere();
              var bs=o.geometry.boundingSphere;
              if(bs)r=bs.radius*Math.max(o.scale.x,o.scale.y,o.scale.z);
            }catch(e){}
            if(r>220)skip=true;                                                            // 远景/天空板
          }
          ud._光影=skip?2:1; ud._r=r; ud._近=null; ud._投=null;
          if(skip)return;
        }
        if(ud._光影!==1)return;
        /* 距离判定：走 matrixWorld 的平移分量，比 getWorldPosition 便宜得多。
           【batch193】口径改成「包围球**表面**到玩家的距离」＝ 距离 − 半径。
           原来直接比较「网格原点到玩家」：地面是一整张 160×160 的 PlaneGeometry，原点钉在
           场景正中 —— 玩家只要走出中心 45 米，地面就被判成"远" → receiveShadow=false
           → **整张地图不再接收阴影，影子全部消失**；走回中心又恢复。
           这就是"阴影一会儿有一会儿没有"的真正原因（跟 AO 参数、帧率都无关）。
           用包围球半径之后，大平板恒为"近"，小方块照旧按距离剔除，开销不变。 */
        var e=o.matrixWorld&&o.matrixWorld.elements;
        var near=true, rr=ud._r||0;
        /* 【batch193】大件（≥8 米：整栋楼、长围墙、地面）**永远参与**，不按距离切。
           为什么：receiveShadow 在 three 里是影响 shader 编译的参数，改一次 = 重编译一次材质。
           原来 1100 多个方块每 1.2 秒在 45 米边界上翻 true/false，等于每 1.2 秒重编译几十个材质
           → 明显卡一下 → 触发帧率自适应降档 → 阴影真的被关掉。这条链子就是"影子一会儿有一会儿没有"。
           大件不切就少掉九成的翻转；小件保留距离剔除（远处小碎件的阴影本来也在 shadow camera 外面）。
           另外加了 45/55 的滞回：进场用 45 米、退场用 55 米，站在边界上也不会来回抖。 */
        if(e&&e.length>=15&&rr<8){
          var dx=e[12]-px, dz=e[14]-pz, d=Math.sqrt(dx*dx+dz*dz)-rr;
          near=ud._近? (d<_farD) : (d<_nearD);
        }
        /* 【batch195】超大件（地面 / 长围墙 / 台基，包围球半径 ≥ 60 米）**只收影、不投影**：
           一个 160×160 的平面自己投自己，阴影贴图精度再高也只会得到满地"痤疮"条纹。 */
        var wantCast=near&&(rr>=0.85)&&(rr<60);
        /* 【batch198】站在烟里的角色（小兵 / 联机远端玩家）一律不投影。
           反过来的老问题：烟把"人"糊掉了，却挡不住他投在地上的影子 ——
           影子从烟底一直伸到烟圈外的亮地板上，等于给对面画了个坐标。
           标记由 js/43 的 updateShadeShadow 每 0.2 秒刷一次（进烟=1 / 出烟=0）。 */
        if(wantCast&&ud._遮影)wantCast=false;
        if(ud._近!==near||ud._投!==wantCast||ud._收!==true){
          ud._近=near; ud._投=wantCast; ud._收=true;
          o.receiveShadow=true;          /* 【batch195】接收一律开：整张地图都能落影子 */
          o.castShadow=wantCast;
        }
      });
    }catch(e){}
  },
  tick:function(dt){
    var s=this; if(!s.sun)return;
    /* 【batch195】光源**不再跟着玩家走**。
       以前太阳钉在玩家头顶（+32,42,+22），shadow camera 只罩身边 72 米 —— 于是"走近才有影子"，
       而且玩家每走一步都要重算 texel 吸附、整张深度图都得重画。
       现在阴影相机罩住整张地图、太阳挂在地图正中：世界里的影子位置**完全固定**，
       玩家走到哪都一样清晰、一样有，换图只重设一次。
       （光的**方向**不变 = 所有物体的受光面不变；变的只是投影相机罩的范围。） */
    var id='classic';
    try{ var m=(typeof mapNow==='function')?mapNow():null; if(m&&m.id)id=m.id; }catch(e){}
    if(id!==s._色调){
      s._色调=id;
      try{ s.换色(id); }catch(e){}
      /* 换图 = 覆盖范围变了：重设 shadow camera + 立刻重画一次，否则新图前几帧是空白影子 */
      try{ s.应用档位(true); }catch(e){}
    }
    if(s.sun.position.x!==32||s.sun.position.y!==42){
      s.sun.position.set(32,42,22);
      s.目标.position.set(0,0,0);
      try{ s.sun.shadow.camera.updateProjectionMatrix(); }catch(e){}
      s._影强制=true;
    }
    /* 新长出来的网格（换图 / 刷怪 / 放技能）定期接管阴影属性
       【batch194】1.2s → 2.5s：大件（≥8 米）已经永久锁死不再翻转，剩下的小件距离变化很慢。 */
    s._扫-=Math.max(0,Math.min(dt,0.1)); if(s._扫<=0){ s._扫=2.5; s.扫场景(); }
    /* 【batch192】帧率自适应重做：原来每秒判一次，转个身看到的东西一变 fps 就抖，
       档位跟着来回切 → 阴影（分辨率/范围/AO 强度）突变，就是"乱转一下阴影也在乱变"。
       现在：3 秒滑动平均 → 降档要连续 6 秒低于 32fps，升档要连续 20 秒高于 58fps，
       且两次换档至少隔 5 秒。慢一点无所谓，重要的是别在玩家眼前跳。 */
    if(s.自动){
      s._fpsT+=dt; s._fpsN++;
      if(s._fpsT>=1.0){
        var fps=s._fpsN/s._fpsT; s._fpsT=0; s._fpsN=0;
        if(typeof s._fpsA!=='number')s._fpsA=fps;
        s._fpsA=s._fpsA*0.55+fps*0.45;                 /* 3 秒量级的滑动平均 */
        s._冷却=(s._冷却||0)+1;
        var ok=s._冷却>=4;                              /* 换档后至少冷 4 秒再判 */
        /* 【batch195】画质项只在**分辨率已经砍到底**之后才动。
           原因：PERF 的动态分辨率是第一步（线性买帧率、只影响锐度），
           而阴影档位 / AO 强度是"看得见的降级"（影子范围、软硬、接触暗角全变）。
           顺序错了就会出现"明明还能靠降分辨率救，先把影子降没了"。 */
        var _prLow=true;
        try{ if(typeof PERF!=='undefined'&&PERF) _prLow=(PERF.当前<=PERF.下限+0.021); }catch(e){}
        if(ok&&_prLow&&s._fpsA<50&&s.档位>1){
          s._低=(s._低||0)+1; s._高=0;
          if(s._低>=6){ s._低=0; s._冷却=0; s.档位--; s.应用档位(true); }
        }else{ s._低=0; s._高=0; }
        /* 【batch192】**只降不升**：升档同样是一次可见的突变（shadow map 分辨率/范围整个换掉），
           玩家在意的是"别在眼前跳"，不是"必须一直往上爬"。降过就稳定在那儿，
           想恢复高级画质刷新页面即可（档位上限还是玩家自己选的）。 */
        try{
          if(typeof POST!=='undefined'&&POST){
            if(_prLow&&s._fpsA<56){ POST._低=(POST._低||0)+1; POST._高=0; if(POST._低>=6){ POST._低=0; POST.降档(); } }
            else { POST._低=0; POST._高=0; }
          }
        }catch(e){}
      }
    }
    /* 【batch195】阴影贴图按需重画（配合 renderer.shadowMap.autoUpdate=false）。
       光源固定之后，玩家**移动本身不再让整张深度图失效** —— 世界里的影子位置是死的，
       只有敌人 / 子弹 / 火车这些动态物件在动。所以不再区分"走没走"，统一隔帧重画一次：
       动态影子最多晚 1 帧（16 毫秒），肉眼不可能看出来，而开销直接砍半。 */
    try{
      s._影帧=(s._影帧||0)+1;
      var _影需=!!s._影强制||(s._影帧%2===0);
      s._影强制=false;
      if(renderer&&renderer.shadowMap)renderer.shadowMap.needsUpdate=_影需;
    }catch(e){}
  }
};
var dLight=null;               // 兼容旧名（初始化完成后指向同一盏主光）
try{ LIGHT.初始化(); }catch(e){}
dLight=LIGHT.sun;

/* ==================== 【batch192】后处理阴影（屏幕空间 AO） ====================
   用户口径：「阴影采用后处理」，并且「乱转一下阴影也会乱变」——所以这一版的第一目标
   不是更浓，是**稳**：同一个世界点，不管镜头怎么转，压暗程度必须基本不变。

   【batch192 修的三条乱变根因】
     ① 法线是深度差分算的：掠射角下 cross(pr-p, pu-p) 的两条边几乎平行，长度趋近 0，
        normalize 之后方向完全随机 → 半球朝向随机 → AO 整片闪。现在三重保护：
        差分取"深度更接近的一侧"（跨物体边界不混面）+ 长度保护（退化用视线法线）
        + 强制朝相机（dot(n,p)>0 就翻）。
     ② 深度衰减原来是 abs(p.z - spv.z)：掠射角下 z 差被放大十几倍，远处的墙也被算成遮挡。
        现在用 length()——视空间是刚体变换，length 就是真实米数，跟视角无关。
     ③ AO 跑半分辨率 + 深度纹理是 Nearest：一个 AO 像素盖 2×2 个主像素却只读左上角，
        镜头一动，读到的是 4 个里的另一个 → 深度跳一格 → 法线跳。现在 AO 全分辨率，
        模糊才降到 1/2（模糊本来就是低频，越模糊越稳）。

   【为什么还是屏幕空间 AO】
     shadow map 是"每个投影物体多画一趟"，日蚀图 1100+ 个方块一忙就掉帧；
     AO 是**一次全屏**，开销和物体数量无关，还能给 shadow map 精度撑不到的
     墙根 / 箱底 / 掩体边补细暗角。所以分工不变：
       shadow map 管太阳投在地上的长影子，本模块管所有贴合的接触阴影。

   【自适应也重做了】原来每秒判一次 fps，转个身看到的东西一变就换档 → 阴影突变。
     现在：3 秒滑动平均 + 长滞回 + 强度**平滑过渡**（降档只是把 AO 慢慢调淡，
     不是一刀切），降到 0 才真正关闭，关闭那一刻视觉上没有跳变。

   兜底：POST.开=false、或者这里任何一步抛错 → 立刻退回原来的一趟渲染，绝不黑屏。 */
var POST=(function(){
  var P={
    开:true,
    强度:0.88,        // 目标强度（0 = 不压）【batch195】0.75→0.88：阴影相机罩全图后格变粗，接触处要靠 AO 补
    强度实:0.88,      // 当前实际强度：每帧朝"目标"逼近 → 换档不会瞬间变明变暗
    半径:0.55,        // 采样半球半径（米）【batch195】0.85→0.55：专门管"贴住的那条缝"，不再假装能替代长投影
    采样:6,           // 每像素采样数【batch195】8→6（半分辨率后再降采样，看不出差别）
    模糊:2.20,        // 双边模糊的像素步长【batch195】1.35→2.20：半分辨率 AO 必须多糊才不显块
    影:false,         // 【batch220】后处理阴影（屏幕空间 AO）的独立开关，**默认关**
                      //   和"开"（后处理总开关）分开：关掉它只是不做 AO 那两趟，
                      //   暗角/色调/屏幕雾/镜内视野全都照旧。改它请用 P.设影()，别直接赋值。
    影实:0,           // AO 的实际强度（0~强度），每帧朝目标逼近 → 开关是淡入淡出不是硬切
    暗角:0.26,        // 屏幕四角压暗（0 = 不要）
    色调:0.62,        // 【batch195】色调曲线混合量：0 = 原样（亮处刺眼、暗处糊死），1 = 全量（发灰）
    rt:null, ao:null, ao2:null, _enc:0,
    quad:null, qs:null, qc:null,
    mAO:null, mBlur:null, mComp:null,
    _w:0, _h:0, _err:'', _on:false
  };

  var VS=[
    'varying vec2 vUv;',
    'void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }'
  ].join('\n');

  /* ---- AO：从深度重建位置/法线，半球内取样，投影回屏幕比视距 ---- */
  var FS_AO=[
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D tDepth;',
    'uniform mat4 uProj;',
    'uniform mat4 uProjInv;',
    'uniform vec2 uTexel;',
    'uniform float uRadius;',
    'uniform float uBias;',
    'uniform int uCount;',
    'uniform vec3 uKernel[6];',
    /* 屏幕 uv + 深度 → 视空间坐标（视空间 z 为负） */
    'vec3 viewPos(vec2 uv,float d){',
    '  vec4 c=vec4(uv*2.0-1.0,d*2.0-1.0,1.0);',
    '  vec4 v=uProjInv*c;',
    '  return v.xyz/v.w;',
    '}',
    /* 【batch195】深度一律走 2 点对角平均。
       AO 现在跑 1/2 分辨率，深度图是全分辨率 + Nearest：AO 的像素中心在深度图上
       平时正好落在两个 texel 中间，镜头一动就"选中"邻居那一格 → 深度跳一格 → 法线跳 → 整片闪。
       对角平均把这块地读成"一个平均深度"，镜头再怎么挪读到的都是同一块，
       抖动从源头没了。代价是每个采样点 2 次纹理，但像素只有 1/4，总账更便宜。 */
    'float dep(vec2 uv){',
    '  vec2 o=uTexel*0.25;',
    '  return 0.5*(texture2D(tDepth,uv+o).x+texture2D(tDepth,uv-o).x);',
    '}',
    /* 每像素固定旋转角：只跟屏幕坐标有关，不跟时间走 → 静止时绝对不跳 */
    'float hash12(vec2 p){',
    '  vec3 p3=fract(vec3(p.xyx)*0.1031);',
    '  p3+=dot(p3,p3.yzx+33.33);',
    '  return fract((p3.x+p3.y)*p3.z);',
    '}',
    'void main(){',
    '  float d=dep(vUv);',
    '  if(d>=0.99995){ gl_FragColor=vec4(1.0); return; }',      /* 天空不参与 AO */
    '  vec3 p=viewPos(vUv,d);',
    '  float pdist=length(p);',                                 /* 真实米数：刚体变换不变量，与视角无关 */
    '  vec2 ex=vec2(uTexel.x,0.0);',
    '  vec2 ey=vec2(0.0,uTexel.y);',
    '  vec3 pr=viewPos(vUv+ex,dep(vUv+ex));',
    '  vec3 pl=viewPos(vUv-ex,dep(vUv-ex));',
    '  vec3 pu=viewPos(vUv+ey,dep(vUv+ey));',
    '  vec3 pv=viewPos(vUv-ey,dep(vUv-ey));',
    /* 【关键①】差分取"深度更接近"的一侧：物体边界处不会把前后两个面连成一条斜边 */
    '  vec3 dxv=(abs(pr.z-p.z)<=abs(p.z-pl.z))?(pr-p):(p-pl);',
    '  vec3 dyv=(abs(pu.z-p.z)<=abs(p.z-pv.z))?(pu-p):(p-pv);',
    '  vec3 n=cross(dxv,dyv);',
    '  float nl=length(n);',
    '  if(nl>1e-9){ n/=nl; } else { n=-normalize(p); }',         /* 长度保护：掠射角两轴共线时退回视线法线 */
    '  if(dot(n,p)>0.0) n=-n;',                                 /* 强制朝相机：视空间里 p 指向表面，dot<0 才对 */
    '  vec3 up=(abs(n.y)<0.99)?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0);',
    '  vec3 T=normalize(cross(up,n));',
    '  vec3 B=cross(n,T);',
    /* 【batch194】旋转相位换成**交错梯度噪声（IGN）**——这是消掉 AO 颗粒感的关键：
       随机 hash 每个像素独立乱转，模糊之后会留下"云纹状"的低频斑（用户看到的 AO 噪点）；
       IGN 只跟 gl_FragCoord 走，相邻像素的相位是有序排列的，模糊之后直接抹平。
       而且它不含时间项 → 静止时逐帧完全一致，不会"沙沙"抖。 */
    '  float ang=fract(52.9829189*fract(0.06711056*gl_FragCoord.x+0.00583715*gl_FragCoord.y))*6.2831853;',
    '  float ca=cos(ang); float sa=sin(ang);',
    '  float occ=0.0; float tot=0.0;',
    /* 【batch194】12 → 8 采样：AO 后面本来还有一趟双边模糊，8 采样 + 模糊和 12 采样几乎分不出来，
       但每像素少 4 次深度采样 + 4 次矩阵乘 —— 全屏算下来是这一模块最划算的一刀。
       ⚠️ 这是**编译期常数**，不是"换档改采样数"，所以不会出现"转个身 AO 纹理就变"的老毛病。 */
    '  for(int i=0;i<6;i++){',
    '    if(i>=uCount) break;',
    '    vec3 k=uKernel[i];',
    '    vec3 kd=vec3(k.x*ca-k.y*sa,k.x*sa+k.y*ca,k.z);',
    '    vec3 sp=p+(T*kd.x+B*kd.y+n*kd.z)*uRadius;',
    '    vec4 op=uProj*vec4(sp,1.0);',
    '    if(op.w<=0.0) continue;',
    '    vec2 suv=op.xy/op.w*0.5+0.5;',
    '    if(suv.x<0.002||suv.x>0.998||suv.y<0.002||suv.y>0.998) continue;',
    '    float sd=dep(suv);',
    '    if(sd>=0.99995) continue;',
    '    vec3 spv=viewPos(suv,sd);',
    '    float sdist=length(spv);',
    '    float spdist=length(sp);',
    '    float gap=abs(spdist-sdist);',
    /* 【关键②】视距差判定 + 视距衰减：都是 length，不是 z 分量 → 掠射角不会放大成假遮挡 */
    '    tot+=1.0;',
    '    if(sdist<spdist-uBias){',
    '      occ+=clamp(uRadius/max(gap,1e-4),0.0,1.0);',
    '    }',
    '  }',
    /* 【batch195】下限 0.24 → 0.16：接触缝必须能压到接近黑，否则物体脚下永远挂一层亮灰。
       上限仍然 1.0（不压的地方一点不动），所以"亮处过亮"不靠 AO 解决，交给合成里的色调曲线。 */
    '  float ao=1.0-(tot>0.0?occ/tot:0.0)*1.46;',
    '  gl_FragColor=vec4(clamp(ao,0.16,1.0),0.0,0.0,1.0);',
    '}'
  ].join('\n');

  /* ---- 双边模糊：只在深度接近的像素之间平均，否则墙边会出现一圈灰雾 ---- */
  var FS_BLUR=[
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D tAO;',
    'uniform sampler2D tDepth;',
    'uniform vec2 uTexel;',
    'uniform float uStep;',
    'void main(){',
    '  float d0=texture2D(tDepth,vUv).x;',
    '  float sum=0.0; float wsum=0.0;',
    '  for(int y=-1;y<=1;y++){',
    '    for(int x=-1;x<=1;x++){',
    '      vec2 uv=vUv+vec2(float(x),float(y))*uTexel*uStep;',
    '      float d=texture2D(tDepth,uv).x;',
    /* 【batch195】权重系数 900 → 420：模糊现在跑在 1/2 分辨率上，uv 已经放大了 2 倍，
       同一个 900 会让"差一格深度"的邻居直接被判成不相关 → 边缘一圈糊不掉、还发脏。
       放宽之后 AO 在物体轮廓两侧过渡更自然（这是"阴影边缘难看"的一部分）。 */
    '      float w=1.0/(1.0+abs(d-d0)*420.0);',
    '      sum+=texture2D(tAO,uv).r*w; wsum+=w;',
    '    }',
    '  }',
    '  gl_FragColor=vec4(sum/max(wsum,0.0001),0.0,0.0,1.0);',
    '}'
  ].join('\n');

  /* ---- 合成：颜色 × AO + 色调曲线 + 暗角 ---- */
  var FS_COMP=[
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D tColor;',
    'uniform sampler2D tAO;',
    'uniform float uStrength;',
    'uniform float uVig;',
    'uniform float uEnc;',
    'uniform float uTone;',
    /* 【batch200】屏幕烟雾：原来是一层 DOM（#smokeFx + backdrop-filter）盖在 canvas 上，
       现在整段挪进合成 pass —— 详见下面 uSmoke 分支的说明。 */
    'uniform float uSmoke;',
    'uniform float uSmokeOp;',
    'uniform vec3 uSmokeCol;',
    'uniform vec2 uTexel;',
    /* 【batch203】镜内视野：uScope=开启强度(0..1)，uScopeR=镜筒半径（以屏幕高度为单位的半径，
       几何镜筒 0.033/0.062 → 角半径 28° → 0.693），uScopeAsp=宽高比（修圆形） */
    'uniform float uScope;',
    'uniform float uScopeR;',
    'uniform float uScopeAsp;',
    'void main(){',
    '  vec4 t0=texture2D(tColor,vUv);',
    '  vec3 c=t0.rgb;',
    '  float ao=texture2D(tAO,vUv).r;',
    /* 【batch202】用户报「烟还是能看穿，正常不该是纯白吗」。实测（烟后挂 16 米黑白棋盘）：
         关后处理 → 烟区 211~213、纯色零杂点，棋盘一点没透（烟本身完全遮挡，56 层不是摆设）；
         开后处理 → 烟区冒出 ±20 的暗块。**是 AO 干的**：
       AO 读的是深度图，而烟 depthWrite:false 不写深度 → 烟所在像素拿到的是**烟后面**
       物体的深度，AO 就按烟后的几何算遮蔽，再 c*=ao 乘到烟的颜色上 →
       烟后面有什么暗部/轮廓，烟面上就会浮出同样的形状，看起来就是"透过烟看见了东西"。
       修法：让合成知道"这个像素被烟盖住了"，那里不做 AO。
       怎么知道：烟材质改成 CustomBlending，只把 **alpha 通道**打穿
         （blendSrcAlpha=Zero、blendDstAlpha=OneMinusSrcAlpha → a_out = a_in*(1-srcA)），
       颜色通道的混合和原来 NormalBlending 完全一致，所以烟的样子一点不变。
       别的透明件（NormalBlending 的 alpha 是 src*1+dst*(1-src)，dst=1 时恒等于 1）不会打穿 alpha
       → 只有烟会，判据不会误伤。t0.a 的实际含义（实测）：0=天空/被烟盖住，1=不透明表面，
       所以判据两边都安全 —— 天空本来就不该有 AO。
       ⚠️ 用 smoothstep 而不是硬阈值：烟球边缘 alpha 是渐变的，硬切会在轮廓上留一圈生硬的 AO 分界。 */
    '  float lit=smoothstep(0.02,0.60,t0.a);',
    '  c*=mix(1.0,ao,uStrength*lit);',
    /* 【batch195】色调曲线 —— 用户原话「发光的地方特别亮，阴影的地方特别暗」。
       这不是"再压暗一点"能解决的，是动态范围的**两端都顶到边**：暗部糊成一块、
       亮部一片死白。这里做三件事（都在线性空间、sRGB 编码之前）：
         ① 幂曲线 0.82：暗部抬得最多（线性 0.02 → 0.037，+85%），
            中段 0.5 → 0.56（+12%），亮部 1.0 几乎不动 —— 天然就是"降对比"；
         ② 肩部压缩 c/(1+0.08c²)：只在亮部生效，把顶到 1 以上的高光往回拉；
         ③ 抬黑场 +0.006：纯黑变"深灰"，阴影里的结构不至于糊死。
       混合系数 uTone=0.62 —— 全量会让画面发灰（像套滤镜），六成刚好。
       ⚠️ 用过 ACES 近似式，千万别换回去：它在 c<0.05 的区间是**压暗**的
          （0.02 → 0.0105），正好和"阴影别太暗"相反。 */
    '  vec3 t=pow(max(c,vec3(0.0)),vec3(0.82));',
    '  t=t/(1.0+t*t*0.08);',
    '  t+=vec3(0.006);',
    '  c=mix(c,t,uTone);',
    '  vec2 q=vUv-0.5;',
    '  c*=1.0-dot(q,q)*uVig;',
    '  if(uEnc>0.5) c=pow(max(c,vec3(0.0)),vec3(0.4545));',   /* RT 里存的是线性值 → 这里补上 sRGB 编码 */
    /* 【batch200】屏幕烟雾进后处理 —— 原来是 #smokeFx 这层 DOM + backdrop-filter。
       为什么挪：backdrop-filter 会逼浏览器把 canvas 后面的内容整屏重新采样一遍（还多一次
       compositor 全屏拷贝），是这条链上最贵的一步，而它换来的效果只是"糊掉 + 降对比 + 加白"。
       在后处理里做只多 5 次纹理采样，还能和 AO/色调处在同一个色彩空间，
       不会因为 DOM 透明度叠加而偏色。
       效果顺序严格对齐原来的 backdrop-filter：模糊 → 提亮 → 降对比 → 再按 uSmokeOp 叠白雾。
       ⚠️ 这一段必须放在 uEnc 编码**之后** —— 原 DOM 是盖在最终画面上的，在线性空间混会偏亮。 */
    '  if(uSmoke>0.002){',
    '    float p=uSmoke;',
    '    vec2 d=uTexel*(1.0+2.6*p);',
    '    vec3 bl=texture2D(tColor,vUv).rgb*0.36',
    '           +(texture2D(tColor,vUv+vec2(-d.x,-d.y)).rgb+texture2D(tColor,vUv+vec2(d.x,-d.y)).rgb',
    '           +texture2D(tColor,vUv+vec2(-d.x, d.y)).rgb+texture2D(tColor,vUv+vec2(d.x, d.y)).rgb)*0.16;',
    '    if(uEnc>0.5) bl=pow(max(bl,vec3(0.0)),vec3(0.4545));',
    '    bl*=1.0+0.22*p;                                   /* brightness：抬亮，让影子那点暗部也抬起来 */',
    '    float lu=dot(bl,vec3(0.299,0.587,0.114));',
    '    bl=mix(vec3(lu),bl,1.0-0.62*p);                   /* contrast：把"暗 vs 亮"的对比压掉 */',
    '    c=bl;',
    '    vec3 sc=uSmokeCol;',
    '    if(uEnc<0.5) sc=pow(max(sc,vec3(0.0)),vec3(2.2));  /* 常量是 sRGB 分量，线性输出时补一次转换 */',
    '    c=mix(c,sc,clamp(uSmokeOp*p,0.0,1.0));',
    '  }',
    /* 【batch203】真·镜内视野的光学部分（只对纪念枪「长明」生效，uScope=0 时整段跳过）：
       镜筒几何解决"看得见管子"，这里解决"透过镜片看"的质感：
         ① 径向色散：越靠边缘，R 往外、B 往里偏 —— 真实镜片的色差就是这样；
         ② 边缘柔化：镜片边缘像差，一串 4 tap 轻微模糊；
         ③ 管壁暗角：最后 20% 半径压暗，和几何镜筒内壁的阴影接上；
         ④ 整体 +3% 亮度：镀膜镜片会比裸眼亮一点点。
       ⚠️ 与烟雾同理：必须在 uEnc 编码**之后**做（这里混的是最终显示值），
          采样回来的 rt 是线性值，要先各自编码再混。 */
    '  if(uScope>0.002){',
    '    vec2 dv=vUv-0.5; dv.x*=uScopeAsp;',
    '    float r=length(dv)*2.0;',
    '    if(r<uScopeR){',
    '      float e=r/max(uScopeR,0.0001);',
    '      vec2 dir=(r>0.0001)?normalize(dv):vec2(0.0,0.0);',
    '      float k=e*e*uScope;',
    '      vec2 off=dir*0.0026*k; off.x/=uScopeAsp;',
    '      vec3 cc;',
    '      cc.r=texture2D(tColor,vUv+off).r;',
    '      cc.g=c.g;',
    '      cc.b=texture2D(tColor,vUv-off).b;',
    '      if(uEnc>0.5){',
    '        float cr=pow(max(texture2D(tColor,vUv+off).r,0.0),0.4545);',
    '        float cb=pow(max(texture2D(tColor,vUv-off).b,0.0),0.4545);',
    '        cc=vec3(cr,c.g,cb);',
    '      }',
    '      float bl=smoothstep(0.70,1.0,e)*0.55*uScope;',
    '      if(bl>0.002){',
    '        vec2 tt=uTexel*2.4;',
    '        vec3 mm=(texture2D(tColor,vUv+vec2(tt.x,0.0)).rgb+texture2D(tColor,vUv-vec2(tt.x,0.0)).rgb',
    '               +texture2D(tColor,vUv+vec2(0.0,tt.y)).rgb+texture2D(tColor,vUv-vec2(0.0,tt.y)).rgb)*0.25;',
    '        if(uEnc>0.5) mm=pow(max(mm,vec3(0.0)),vec3(0.4545));',
    '        cc=mix(cc,mm,bl);',
    '      }',
    '      cc*=1.0+0.03*uScope;',
    '      cc*=1.0-smoothstep(0.82,1.0,e)*0.60*uScope;',
    '      c=mix(c,cc,uScope);',
    '    }',
    '  }',
    '  gl_FragColor=vec4(c,1.0);',
    '}'
  ].join('\n');

  /* 半球核：固定种子（每次进游戏采样图案一致，不会"噪点在跳"）
     【batch195】数量跟随 shader 里的 6：uKernel[6] 必须刚好 6 个，多传/少传都会让 AO 出奇怪的环。 */
  var KERNEL=(function(){
    var s=20261018, out=[];
    function r(){ s=(s*1664525+1013904223)>>>0; return s/4294967296; }
    for(var i=0;i<6;i++){
      var x=r()*2-1, y=r()*2-1, z=r();                       // z>0：只取法线正面那半球
      var l=Math.sqrt(x*x+y*y+z*z)||1;
      var k=0.30+0.70*Math.pow((i+1)/6,1.6);                  // 内圈密外圈疏，和真实 AO 分布一致
      out.push(new THREE.Vector3(x/l*k,y/l*k,z/l*k));
    }
    return out;
  })();

  P.初始化=function(){
    if(P.quad)return true;
    try{
      /* 【batch202】rt 的 alpha 通道现在承载"哪里被烟盖住"（见合成 shader 的 t0.a 判据）。
         ⚠️ 别想当然：r128 的清屏 alpha 实际是 **0**（实测 renderer.getClearAlpha()===0，
         alpha:false 并不代表 1），所以 rt 里 alpha 的含义是：
             0 = 没有任何几何（天空）/ 被烟盖住（烟把 alpha 乘到 0）
             1 = 不透明物体表面
         判据 lit=smoothstep(0.02,0.60,a) 让"天空"和"烟"都不做 AO —— 这两处本来都不需要
         （天空没有表面可遮蔽，烟上的遮蔽只会是烟后物体的轮廓 = 假装能透视）。
         这里**故意不校正 clearAlpha**：把它设成 1 会让天空参与 AO，无穷远深度算出来的
         法线会抖、天空出噪点，得不偿失。 */
      P.qs=new THREE.Scene();
      P.qc=new THREE.Camera();
      P.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),null);
      P.quad.frustumCulled=false;
      P.qs.add(P.quad);
      P.mAO=new THREE.ShaderMaterial({
        vertexShader:VS, fragmentShader:FS_AO, depthTest:false, depthWrite:false,
        uniforms:{
          tDepth:{value:null}, uProj:{value:new THREE.Matrix4()}, uProjInv:{value:new THREE.Matrix4()},
          uTexel:{value:new THREE.Vector2(0.001,0.001)}, uRadius:{value:P.半径},
          uBias:{value:0.045}, uCount:{value:P.采样}, uKernel:{value:KERNEL}
        }
      });
      P.mBlur=new THREE.ShaderMaterial({
        vertexShader:VS, fragmentShader:FS_BLUR, depthTest:false, depthWrite:false,
        uniforms:{ tAO:{value:null}, tDepth:{value:null}, uTexel:{value:new THREE.Vector2(0.001,0.001)}, uStep:{value:P.模糊} }
      });
      P.mComp=new THREE.ShaderMaterial({
        vertexShader:VS, fragmentShader:FS_COMP, depthTest:false, depthWrite:false,
        uniforms:{ tColor:{value:null}, tAO:{value:null}, uStrength:{value:P.强度}, uVig:{value:P.暗角}, uEnc:{value:0}, uTone:{value:P.色调},
                   /* 【batch200】烟雾：#dfe6ec 的白雾，默认关（uSmoke=0）；uSmokeOp 由 js/41 每帧
                      用 SMOKE_SCREEN_OP 覆盖，保证"屏幕白成一片"的浓度和逻辑判定同源。 */
                   uSmoke:{value:0}, uSmokeOp:{value:0.82}, uSmokeCol:{value:new THREE.Color(0.875,0.902,0.925)},
                   /* 【batch203】镜内视野：默认全关（uScope=0 → shader 整段跳过，零开销） */
                   uScope:{value:0}, uScopeR:{value:0.693}, uScopeAsp:{value:1.7778},
                   uTexel:{value:new THREE.Vector2(0.001,0.001)} }
      });
      P._w=0; P._h=0;
      return true;
    }catch(e){ P._err='初始化失败: '+e; P.开=false; return false; }
  };

  /* 尺寸变了就重建（只比 drawingBuffer 尺寸，避免浏览器缩放/DPR 变化留下来的拉伸）
     【batch194】复用同一个 Vector2：这个函数**每帧**都被 P.渲染 调一次，别每帧 new 一个对象
     （V8 分配虽小，但每帧一次 × 每秒 60 次 × 玩几小时，GC 抖动就是这么攒出来的）。 */
  var _szV=null;
  P.适配=function(){
    var w=1,h=1;
    try{
      if(!_szV)_szV=new THREE.Vector2();
      renderer.getDrawingBufferSize(_szV); w=Math.max(1,_szV.x|0); h=Math.max(1,_szV.y|0);
    }catch(e){ w=Math.max(1,renderer.domElement.width); h=Math.max(1,renderer.domElement.height); }
    if(w===P._w&&h===P._h&&P.rt)return;
    P._w=w; P._h=h;
    try{
      if(P.rt){ P.rt.dispose(); if(P.rt.depthTexture)P.rt.depthTexture.dispose(); }
      if(P.ao){ P.ao.dispose(); }
      if(P.ao2){ P.ao2.dispose(); }
    }catch(e){}
    var rt=new THREE.WebGLRenderTarget(w,h,{
      minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
      format:THREE.RGBAFormat, type:THREE.UnsignedByteType,
      depthBuffer:true, stencilBuffer:false
    });
    /* ⚠️ 色彩空间：RT 一律保持**线性**（不碰它的 colorSpace），最后由合成 pass 手动编码。
       为什么不沿用「让 RT 跟随 renderer 的输出色彩空间」：那套写法各版本行为不一致
       （有的版本给 RT 设 sRGB 会真的编码、有的直接忽略），一旦对不上，整屏就统一偏暗
       —— 第一版就是这么翻的车。现在只看 renderer 最终输出是不是 sRGB，是就在合成里
       pow(1/2.2)，行为完全可预期。 */
    try{
      var _srgb=false;
      if(renderer.outputColorSpace!==undefined&&THREE.SRGBColorSpace!==undefined)_srgb=(renderer.outputColorSpace===THREE.SRGBColorSpace);
      else if(renderer.outputEncoding!==undefined&&THREE.sRGBEncoding!==undefined)_srgb=(renderer.outputEncoding===THREE.sRGBEncoding);
      P._enc=_srgb?1:0;
      if(P.mComp)P.mComp.uniforms.uEnc.value=P._enc;
    }catch(e){}
    /* 深度纹理：AO 唯一的输入。WebGL2 用 24 位，WebGL1 只能 16 位（精度差、但能用） */
    try{
      var isGL2=false;
      try{ isGL2=!!(renderer.capabilities&&renderer.capabilities.isWebGL2); }catch(e){}
      var dt=new THREE.DepthTexture(w,h);
      dt.format=THREE.DepthFormat;
      try{ dt.type=isGL2?THREE.UnsignedIntType:THREE.UnsignedShortType; }catch(e){ dt.type=THREE.UnsignedShortType; }
      dt.minFilter=THREE.NearestFilter; dt.magFilter=THREE.NearestFilter;
      rt.depthTexture=dt;
    }catch(e){ P._err='深度纹理不可用: '+e; }
    P.rt=rt;
    /* 【batch195】AO 走**半分辨率**：这一趟每像素 6 个半球采样 × 2 次深度读，
       全屏算下来原本是整条管线最贵的一步，减到 1/4 像素量之后性能直接回了一大截。
       抖动的老问题（"转视角阴影乱变"）用 dep() 的对角平均治掉了 —— 见 FS_AO 里的说明。
       模糊与 AO 同分辨率（都是 1/2），再做一次 9 tap 双边模糊把颗粒抹平。 */
    var aw=Math.max(1,w>>1), ah=Math.max(1,h>>1);
    P.ao=new THREE.WebGLRenderTarget(aw,ah,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,stencilBuffer:false});
    P.ao2=new THREE.WebGLRenderTarget(aw,ah,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,stencilBuffer:false});
    try{
      P.mAO.uniforms.uTexel.value.set(1/w,1/h);      /* 深度图是全分辨率，采样步长必须按它算 */
      P.mComp.uniforms.uTexel.value.set(1/w,1/h);    /* 【batch200】烟雾的模糊半径也按全分辨率 texel 算 */
      /* 【batch203】uScopeAsp：镜内那个圆必须是正圆（并按屏幕高度归一），
         窗口一变比例就得跟着改，否则开镜圆会被拉成椭圆。 */
      try{ if(P.mComp)P.mComp.uniforms.uScopeAsp.value=(h>0)?(w/h):1.7778; }catch(e){}
      P.mBlur.uniforms.uTexel.value.set(1/aw,1/ah);
      P.mAO.uniforms.uKernel.value=KERNEL;
    }catch(e){}
  };

  P.渲染=function(){
    /* 【batch192】强度平滑：换档只改"目标"，这里每帧挪一点 → 不会一格一格地跳明暗 */
    /* 【batch220】AO 的实际强度 = 开关打开（P.影）且后处理总开关也在时，才去追 P.强度；
       关掉时往 0 平滑淡出（硬切会让整屏突然亮一下，很像"闪了一下"）。 */
    var _影目标=(P.开&&P.影)?P.强度:0;
    P.强度实+=(_影目标-P.强度实)*0.12;
    P.影实=P.强度实;
    if(P.强度<=0.001&&P.强度实<0.008){ P.开=false; }        /* 已经淡到看不见了，这时关才无感 */
    /* 【batch200】烟在的时候强制走后处理：否则"关了后处理"就没有屏幕雾了（雾只存在于合成 pass 里）。 */
    /* 【batch203】镜内视野（P.镜>0）也要走合成 pass —— 它就是在合成里做的。
       只有"不透明、无烟、无镜"三样都关时才允许直接裸渲染。 */
    if(!P.初始化()||(!P.开&&P.烟<=0.002&&P.镜<=0.002)){ renderer.setRenderTarget(null); renderer.render(scene,camera); return; }
    try{
      P.适配();
      if(!P.rt||!P.rt.depthTexture){ P._on=false; renderer.setRenderTarget(null); renderer.render(scene,camera); return; }

      /* ① 主场景 → rt（带深度纹理） */
      renderer.setRenderTarget(P.rt);
      renderer.render(scene,camera);

      /* ②③ 后处理阴影（AO + 双边模糊）—— 设置里可以关掉，**默认就是关的**
         （【batch220】用户要求："给后处理阴影加个开关，默认关闭"）。
         关掉时这两趟整段跳过：省的是半分辨率 6 次半球采样 + 9 tap 模糊，
         是全链最贵的一步。合成里 uStrength 已经平滑到 0，所以画面只是少一圈接触暗边。
         注意 tAO 必须绑一个**有效纹理**（着色器里是无条件采样），这里绑上次的结果无所谓 ——
         反正乘的是 0；初始化过就没问题（rt 为空早退上面已经挡了）。 */
      var _要影=(P.影&&P.强度实>0.004);
      if(_要影){
        var u=P.mAO.uniforms;
        u.tDepth.value=P.rt.depthTexture;
        u.uProj.value.copy(camera.projectionMatrix);
        u.uProjInv.value.copy(camera.projectionMatrix).invert();
        u.uRadius.value=P.半径;
        u.uCount.value=P.采样|0;
        P.quad.material=P.mAO;
        renderer.setRenderTarget(P.ao);
        renderer.render(P.qs,P.qc);

        /* 双边模糊一次（1/2 分辨率，9 tap，把 AO 的颗粒抹平） */
        var b=P.mBlur.uniforms;
        b.tDepth.value=P.rt.depthTexture;
        b.tAO.value=P.ao.texture;
        b.uStep.value=P.模糊;
        P.quad.material=P.mBlur;
        renderer.setRenderTarget(P.ao2);
        renderer.render(P.qs,P.qc);
      }

      /* ④ 合成 → 屏幕 */
      var c=P.mComp.uniforms;
      c.tColor.value=P.rt.texture;
      c.tAO.value=P.ao2.texture;
      c.uStrength.value=P.强度实;
      c.uVig.value=P.暗角;
      P.quad.material=P.mComp;
      renderer.setRenderTarget(null);
      renderer.render(P.qs,P.qc);
      P._on=true;
    }catch(e){
      P._err='渲染失败: '+e; P._on=false;
      try{ renderer.setRenderTarget(null); renderer.render(scene,camera); }catch(e2){}
    }
  };

  P.设置=function(k,v){ P[k]=v; try{
    if(k==='强度'){ P.mComp.uniforms.uStrength.value=v; if(v>0.001)P.开=true; }
    if(k==='暗角')P.mComp.uniforms.uVig.value=v;
    if(k==='色调')P.mComp.uniforms.uTone.value=v;
    if(k==='半径')P.mAO.uniforms.uRadius.value=v;
    if(k==='采样')P.mAO.uniforms.uCount.value=v|0;
    if(k==='模糊'){ P.mBlur.uniforms.uStep.value=v; }
  }catch(e){} };

  /* 【batch200】屏幕烟雾：每帧由 js/41 的 updateSmokeScreen 调一次。
     p=浓度 0~1（已经过"进烟快、出烟慢"的平滑），gold/dark 决定雾色。
     只有颜色真的变了才 setHex（Color.setHex 每帧写也没事，但这样读起来更清楚）。 */
  P.烟=0;
  P.设烟=function(p,gold,dark){
    P.烟=(p>0?p:0);
    var u=P.mComp&&P.mComp.uniforms; if(!u)return;
    u.uSmoke.value=P.烟;
    u.uSmokeOp.value=(typeof SMOKE_SCREEN_OP==='number')?SMOKE_SCREEN_OP:0.82;
    var col=dark?0x241a45:gold?0xe9d9a6:0xdfe6ec;
    if(P._烟色!==col){ P._烟色=col; u.uSmokeCol.value.setHex(col); }
  };
  /* 【batch203】真·镜内视野：每帧由 js/24 的 _镜内视野刷新 调一次。
     p=开启强度（随开镜进度淡入），r=镜筒半径（屏幕高度归一，默认 0.693 对应 28° 半角）。
     ⚠️ 镜内效果是合成 pass 的一部分：P.开 为 false 时 render 会直接走裸渲染，
        所以必须同时把 P.开 顶起来（见 render 里的 _needScope）。 */
  P.镜=0;
  P.设镜=function(p,r){
    P.镜=(p>0?p:0);
    var u=P.mComp&&P.mComp.uniforms; if(!u)return;
    u.uScope.value=P.镜;
    if(typeof r==='number'&&r>0.02)u.uScopeR.value=r;
    if(P.镜>0.002)P.开=true;
  };

  /* 【batch220】后处理阴影开关。设置面板 / 存档都走这里，别直接写 P.影：
     ① 打开时要把总开关顶起来（P.开 可能因为强度淡到 0 被自动关掉）；
     ② 关掉时立刻把强度实按 0 处理，下一帧就开始淡出（不硬切）。 */
  P.设影=function(on){
    P.影=!!on;
    if(P.影)P.开=true;
    return P.影;
  };

  /* 帧率兜底：只动强度（平滑过渡），不动采样数 —— 采样数一变画面纹理就换，那才是"乱变"。
     一级级往下淡：0.88 → 0.66 → 0.45（到底为止，不关：关掉那一刻整屏会亮一下）。 */
  P.降档=function(){
    if(!P.开||!P.影)return;          /* 【batch220】AO 关掉时没有"档"可降（否则会悄悄把强度改小，下次打开就变了） */
    if(P.强度<=0.46)return;
    if(P.强度>0.67){ P.强度=0.66; return; }
    P.强度=0.45;
  };
  P.升档=function(){
    if(!P.影)return;                 /* 【batch220】AO 关着就别升档，别偷偷改玩家看到的画面 */
    if(!P.开){ P.开=true; P.强度=0.45; return; }
    if(P.强度<0.67){ P.强度=0.66; return; }
    if(P.强度<0.87){ P.强度=0.88; return; }
  };

  try{ P.初始化(); }catch(e){}
  return P;
})();

/* ==================== 【batch196】性能：只统计，不自动降分辨率 ====================
   历史：batch195 这里做过一套「帧时间闭环 → 自动降内部渲染分辨率」的自适应，
   目标是「稳 60 帧」。用户后来明确要求：「把帧率上限删了。这个样子反而更流畅」。
   —— 删的是**自适应降分辨率**，不是帧率（帧率本来就没锁，见下）。

   为什么删掉是对的：
     · 主循环是 requestAnimationFrame，它天生跟着显示器刷新率走 ——
       60Hz 屏就是 60，144Hz 屏就是 144，代码里从来没有锁帧的地方；
     · 那套自适应的实际效果是「偶发卡顿 → 把分辨率砍掉 → 画面变糊」，
       而 setPixelRatio 会**重建整张 RT**，改动那一帧自己就卡一下 —— 越修越卡；
     · 它只会在"本来只是偶尔掉一帧"的时候触发，稳态满帧时反而不动，
       所以它优化不到该优化的场景，只制造画质波动。

   现在这个对象只做两件事：统计帧率（HUD / 探针用）、给出手动设置入口。
   画质从此是**固定**的：阴影档位、AO 强度、像素比都不会自己变。
   真需要给弱机降负担，手动调用 PERF.锁定(0.8)。 */
var PERF=(function(){
  var Q={
    /* 【batch196】目标帧:60 → 0。用户要求「把帧率上限删了」。
       ⚠️ 先说清楚：这里**从来没有锁过帧**，主循环是 requestAnimationFrame，
          它天生跟着显示器刷新率走（60Hz 屏 60、144Hz 屏 144）。
          真正的「上限」是这个对象里的**自适应降分辨率**：帧时间超过 18.6ms（≈54fps）
          就把内部渲染分辨率往下调，好去凑 60 帧 —— 那才是会主动把画面变糊、而且
          调 setPixelRatio 会重建整张 RT（那一帧必卡）、越修越卡的东西。已停用。
       现在 PERF 只**统计**帧时间（给 HUD / 探针看），一个像素都不动。
       副作用（好事）：LIGHT / POST 的画质降档门槛是「PERF.当前 <= 下限+0.02」，
       分辨率不再降 → 这个条件永远不成立 → 阴影档位和 AO 强度也不会自己动，
       画质从此是稳定的。真要降分辨率，手动调 PERF.锁定(0.8)。 */
    上限:0, 下限:0.72, 当前:0, 目标帧:0,
    帧率:0, 平均帧时间:0,
    _last:0,_acc:0,_n:0,_cd:0,_坏:0,_好:0,_调次:0,
    窗口:90,
    初始化:function(){
      try{
        Q.上限=Math.max(0.9,Math.min(window.devicePixelRatio||1,1.25));
        Q.当前=RENDER_PR;                       /* 和 50 行的初始 setPixelRatio 保持同一个值 */
        if(Q.当前>Q.上限)Q.当前=Q.上限;
      }catch(e){}
    },
    tick:function(){
      /* 只统计，不调整。全部改成"只读"之后，这一帧的开销就是两次 performance.now()。 */
      var now=performance.now();
      if(!Q._last){ Q._last=now; return; }
      var ms=now-Q._last; Q._last=now;
      /* 切后台 / 加载卡顿：这一段不算（300ms 以上的间隔不当作一帧） */
      if(ms<=0||ms>250){ Q._acc=0; Q._n=0; return; }
      Q.帧时间=ms;
      Q._acc+=ms; Q._n++;
      if(Q._n>=30){ Q.平均帧时间=Q._acc/Q._n; Q.帧率=1000/Math.max(Q.平均帧时间,0.01); Q._acc=0; Q._n=0; }
    },
    调:function(d){
      var v=Math.max(Q.下限,Math.min(Q.上限,Q.当前+d));
      if(Math.abs(v-Q.当前)<0.019)return;
      Q.当前=v; Q._cd=Q.窗口;
      Q._调次++;
      try{
        renderer.setPixelRatio(Q.当前);
        if(typeof POST!=='undefined'&&POST&&POST.适配)POST.适配();
      }catch(e){}
    },
    /* 给设置面板 / 探针用：强制设一个分辨率（同时冻结自动调节） */
    锁定:function(v){
      Q.当前=Math.max(Q.下限,Math.min(Q.上限,v||Q.上限));
      Q._cd=99999999;
      try{ renderer.setPixelRatio(Q.当前); if(typeof POST!=='undefined'&&POST&&POST.适配)POST.适配(); }catch(e){}
      return Q.当前;
    }
  };
  Q.初始化();
  return Q;
})();
