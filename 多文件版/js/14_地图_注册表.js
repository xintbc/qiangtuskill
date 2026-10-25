/* ==================== 地图注册表 / 切图（batch111）====================
   每张地图给一个 id + 构建函数；setMap(id) 负责"懒构建 → 显隐 → 换 obstacles → 重建射线盒 → 换背景"。
   新地图直接往 MAPS 里加一条就行，碰撞 / 小地图 / 出生点全部自动跟着走。 */
/* 【batch180】靶场地图：一块开阔平地 + 四周矮墙 + 距离标尺 + 三排靶子。
   ⚠ addBox 的签名是 (x, z, w, h, d, mat, kind) —— **第二个参数是 z，没有 y**（y 由地面推出来）。
   靶场是**单人**图，不走联机，所以不需要同步服务端那份 MAP_SPAWNS（这里顺手给一份，防出生点报错）。 */
function buildMapRange(){
  try{ RANGE_TARGETS.length=0; }catch(e){}
  /* 【batch194】地面：和火车站同一个毛病 —— 全局 ground 挂在经典图组里，切到靶场也是空的。
     这块比围墙（±62）各宽 13 米，凑够 limit 70 的活动范围。 */
  try{
    var _rt=_mkTex('groundRange',function(g,S){
      g.fillStyle='#232733';g.fillRect(0,0,S,S);                   // 室内训练场的冷灰蓝
      g.strokeStyle='#2c3242';g.lineWidth=2;
      g.beginPath();g.moveTo(0,1);g.lineTo(S,1);g.moveTo(1,0);g.lineTo(1,S);g.stroke();
    });
    _rt.wrapS=_rt.wrapT=THREE.RepeatWrapping;
    _rt.repeat.set(150/2.5,150/2.5);
    var _rf=new THREE.Mesh(new THREE.PlaneGeometry(150,150),
                           new THREE.MeshLambertMaterial({map:_rt,color:0xffffff}));
    _rf.rotation.x=-Math.PI/2; _rf.position.set(0,0.02,0);
    _rf.receiveShadow=true;
    _mapTarget.add(_rf);
  }catch(e){}
  /* 【batch180】切图重进时先把上一次的假人清掉（不然 enemies 里会越积越多） */
  try{
    for(var di=enemies.length-1;di>=0;di--){
      if(enemies[di]&&enemies[di].rangeDummy){
        try{ if(enemies[di].root&&enemies[di].root.parent)enemies[di].root.parent.remove(enemies[di].root); }catch(_){}
        enemies.splice(di,1);
      }
    }
  }catch(e){}
  try{ RANGE_DUMMIES.length=0; }catch(e){}
  /* 【batch180】靶场出生点已写进 MAP_SPAWNS.range（静态表，见地图注册表那一节）——
     这里不再运行时覆盖，免得两份表说岔。 */
  try{
    /* 四周矮墙，别让人跑出场地 */
    addBox(0,-62,130,4,2); addBox(0,62,130,4,2);
    addBox(-62,0,2,4,130); addBox(62,0,2,4,130);
    /* 射击线 + 10 / 20 / 30 / 50 米距离标尺 */
    var base=-45;
    var dists=[10,20,30,50];
    for(var d=0;d<dists.length;d++) addBox(0,base+dists[d],44,0.35,0.5);
    /* 三排靶子：约 10 米 / 25 米 / 45 米，每排 6 个 */
    var rows=[{z:base+10,n:6,gap:7,w:1.6,h:2.0},
              {z:base+25,n:6,gap:7,w:1.4,h:1.8},
              {z:base+45,n:6,gap:8,w:1.2,h:1.6}];
    for(var r=0;r<rows.length;r++){
      var R=rows[r];
      for(var k=0;k<R.n;k++){
        if(typeof rangeAddTarget==='function') rangeAddTarget((k-(R.n-1)/2)*R.gap, R.z, R.w, R.h);
      }
    }
    /* 【batch180】两个特殊靶子，一左一右（x=±30，在三排靶子两侧的空地上，从出生点一眼能看见）：
       左边「技能伤害靶」5000 血，专测各种技能的伤害；右边「回血靶」100 血、初始 30%，专测治疗技能。 */
    if(typeof rangeAddDummy==='function'){
      rangeAddDummy(-30,6,'dmg');
      rangeAddDummy(30,6,'heal');
    }
  }catch(e){}
}
/* ==================== 【batch181】新地图：旧火车站 ====================
   三段式布局（轨道带**贯穿全图**，两头是隧道口）：
     · 南站区：站前广场（喷泉 / 雕像 / 路灯 / 树）+ 候车大厅（有门有窗有柜台，屋顶可走视线）
     · 轨道带：3 条轨道（z=-9 / 0 / 9，各 16 段可破坏）+ 两座岛式站台 + 雨棚 + 警灯
     · 北货场：仓库（大门可进）+ 货柜堆场 + 水塔 + 装卸台
     · 两座天桥（x=±38）跨过整条轨道带，楼梯上下 —— 不想被火车撞就走天桥
   火车不定时疾驰而过（见文件顶部的 trainTick）：撞玩家＝重创+击飞，碾过 AI 敌人；
   轨道能被爆炸炸烂，烂了那班车就脱轨翻车、永久堵死那条轨道。 */
function buildMapStation(){
  try{
    /* ---------- 【batch194】地面（这块以前是漏的）----------
       全局那张 ground 是 makeGround(MAP_GROUP.classic) 建出来的，**挂在经典图的组里**；
       setMap 会把非当前地图的组整个 visible=false → 切到火车站，脚下直接露出天空背景。
       用户报的「火车站怎么没有地板」就是这条。
       （日蚀环城用 makeOvalGround 自己铺、实验室自己铺了一块，只有 station / range 漏了。）
       尺寸 180×132：比围墙（x ±78 / z ±56）各宽 12 米，隧道口外面也有地，不会看到"悬空的墙脚"。 */
    try{
      var _gt=_mkTex('groundStation',function(g,S){
        g.fillStyle='#6b675f';g.fillRect(0,0,S,S);                 // 黄昏的水泥站场（暖灰）
        g.strokeStyle='#787369';g.lineWidth=2;                      // 每 2.5 米一格，和经典图同一个口径
        g.beginPath();g.moveTo(0,1);g.lineTo(S,1);g.moveTo(1,0);g.lineTo(1,S);g.stroke();
      });
      _gt.wrapS=_gt.wrapT=THREE.RepeatWrapping;
      _gt.repeat.set(180/2.5,132/2.5);
      var _gf=new THREE.Mesh(new THREE.PlaneGeometry(180,132),
                             new THREE.MeshLambertMaterial({map:_gt,color:0xffffff}));
      _gf.rotation.x=-Math.PI/2; _gf.position.set(0,0.02,0);
      /* 必须收影：站台/雨棚/货柜的影子全都要落在这块地上；但它自己的包围球半径 ≈111 米，
         LIGHT.扫场景 会把它判成"只收影不投影"（否则整张平面自己投自己＝满地痤疮条纹）。 */
      _gf.receiveShadow=true;
      _mapTarget.add(_gf);
    }catch(e){}
    /* ---------- 材质 ---------- */
    var mPlaster=matOf('plaster',plasterTexDraw);            // 站房外墙（米白抹灰）
    var mConc    =new THREE.MeshLambertMaterial({color:0x8d95a1});   // 站台地面（混凝土）
    var mSteel   =new THREE.MeshLambertMaterial({color:0x5b6672});   // 雨棚钢构
    var mWood    =matOf('wood',woodTexDraw);                 // 长椅 / 木箱
    var mDark    =new THREE.MeshLambertMaterial({color:0x22262e});   // 隧道口
    var mRed     =new THREE.MeshLambertMaterial({color:0xa03a2a});   // 货柜
    var mBlue    =new THREE.MeshLambertMaterial({color:0x2f6b8a});
    var mGreen   =new THREE.MeshLambertMaterial({color:0x3f6b3a});
    var mLamp    =new THREE.MeshBasicMaterial({color:0xffe9b0});     // 路灯（自发光，黄昏也亮）
    var mRedLamp =new THREE.MeshBasicMaterial({color:0x551111});     // 轨道警灯（trainTick 会改它的色）
    /* 纯装饰网格（不出碰撞）：柱子 / 雨棚梁 / 树 / 路灯这类 */
    function deco(x,z,w,h,d,mat,y0){
      var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
      m.position.set(x,(y0||0)+h/2,z);_mapTarget.add(m);return m;
    }
    /* ---------- 边界墙：南北整面，东西各留一个「隧道口」（轨道带 z -14..14） ---------- */
    addBox(0,-56,156,16,2,null,'border');
    addBox(0, 56,156,16,2,null,'border');
    addBox(-78,-35,2,16,42,null,'border');addBox(-78,35,2,16,42,null,'border');   // 西墙（留隧道口）
    addBox( 78,-35,2,16,42,null,'border');addBox( 78,35,2,16,42,null,'border');   // 东墙（留隧道口）
    for(var sx=-1;sx<=1;sx+=2){                                 // 隧道口：黑洞 + 混凝土门框
      deco(sx*80,0,3,9,28,mDark,0);
      deco(sx*78.6,0,1.2,10,30,mConc,0);
      deco(sx*78.6,-15.2,1.2,10,1.6,mConc,0);deco(sx*78.6,15.2,1.2,10,1.6,mConc,0);
    }
    /* ---------- 3 条轨道（贯穿全图，10 米一段，可被爆炸破坏） ---------- */
    var tz=[-9,0,9];
    for(var ti=0;ti<3;ti++){
      trainTrackRegister(ti,tz[ti],-80,80,10);
      trainTrackBuild(ti);
      /* 轨道两端警灯（预警时狂闪） */
      for(var li=-1;li<=1;li+=2){
        var pole=new THREE.Mesh(new THREE.BoxGeometry(0.18,3.4,0.18),mSteel);
        pole.position.set(li*76,1.7,tz[ti]);_mapTarget.add(pole);
        var lamp=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.5),mRedLamp);
        lamp.position.set(li*76,3.6,tz[ti]);_mapTarget.add(lamp);
        trainLampRegister(ti,lamp);
      }
    }
    /* ---------- 两座岛式站台 + 雨棚 ---------- */
    for(var p=0;p<2;p++){
      var pz=(p===0)?-4.5:4.5;
      addBox(0,pz,104,1.3,5,mConc);                                     // 站台（高 1.3，顶面可站；1.3+跳跃 2.61 能跳上停靠列车的车顶）
      deco(0,pz,104,0.06,0.22,new THREE.MeshBasicMaterial({color:0xe8c84a}),1.3);   // 安全黄线
      addLedge(0,pz,104,0.4,5,mSteel,'ledge',4.6);                      // 雨棚（顶上可站）
      for(var cx=-48;cx<=48;cx+=12){                                    // 雨棚立柱
        deco(cx,pz-2.2,0.32,4.6,0.32,mSteel,0);deco(cx,pz+2.2,0.32,4.6,0.32,mSteel,0);
      }
      /* 长椅 + 站台名牌柱 */
      for(var b=-40;b<=40;b+=16){ deco(b,pz+(p===0?1.4:-1.4),2.6,0.45,0.6,mWood,1.3); }
      deco(-44,pz,0.5,2.6,0.5,mSteel,1.3);deco(44,pz,0.5,2.6,0.5,mSteel,1.3);
    }
    /* ---------- 两座天桥（跨过整条轨道带，x=±38） ---------- */
    for(var f=-1;f<=1;f+=2){
      var bx=f*38;
      addLedge(bx,0,4,0.4,24,mSteel,'ledge',5.2);                       // 桥面（z -12..12，只跨轨道带）
      addLedge(bx,-11.9,4,1.1,0.16,mSteel,'ledge',5.2);                 // 栏杆（桥面两缘）
      addLedge(bx, 11.9,4,1.1,0.16,mSteel,'ledge',5.2);
      for(var st=0;st<11;st++){                                         // 南楼梯（11 级 ×0.47，从桥缘向外铺，别钻进桥面底下）
        addBox(bx,12.3+0.55*st,4,0.47*(st+1),0.55,mSteel);
        addBox(bx,-12.3-0.55*st,4,0.47*(st+1),0.55,mSteel);             // 北楼梯
      }
    }
    /* ---------- 南站区：站前广场 ---------- */
    /* 中央喷泉雕像 */
    addBox(0,44,7,1.0,7,mConc);
    deco(0,44,1.6,2.6,1.6,mConc,1.0);
    deco(0,44,2.2,2.2,2.2,new THREE.MeshLambertMaterial({color:0xb8c4d4}),3.6);
    /* 树（南广场 + 北货场散几棵） */
    function tree(x,z){
      deco(x,z,0.55,2.6,0.55,mWood,0);
      deco(x,z,3.0,3.2,3.0,new THREE.MeshLambertMaterial({color:0x3d6b34}),2.6);
    }
    tree(-24,50);tree(24,50);tree(-40,44);tree(40,44);tree(-14,34);tree(14,34);
    tree(-50,-16);tree(50,-16);tree(-24,-52);tree(24,-52);
    /* 路灯 */
    for(var lp=-2;lp<=2;lp++){
      var lx=lp*22;
      deco(lx,52,0.24,5.2,0.24,mSteel,0);
      var head=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.35,0.7),mLamp);
      head.position.set(lx,5.4,52);_mapTarget.add(head);
    }
    /* 广场上的掩体（翻倒的报刊亭 / 石墩 / 护栏） */
    addBox(-20,44,3,1.2,3,mWood);addBox(20,44,3,1.2,3,mWood);
    addBox(-8,50,1.2,1.0,1.2,mConc);addBox(8,50,1.2,1.0,1.2,mConc);
    /* ---------- 候车大厅（x -34..34，z 16..30，南北开门） ---------- */
    var HX0=-34,HX1=34,HZ0=16,HZ1=30,HCX=0,HCZ=23;
    addBox(-18.25,HZ0,31.5,6,0.6,mPlaster);addBox(18.25,HZ0,31.5,6,0.6,mPlaster);   // 北墙（中间留门）
    addBox(-18.25,HZ1,31.5,6,0.6,mPlaster);addBox(18.25,HZ1,31.5,6,0.6,mPlaster);   // 南墙（中间留门）
    addBox(HX0,HCZ,0.6,6,14,mPlaster);addBox(HX1,HCZ,0.6,6,14,mPlaster);             // 东西墙
    infoPush('roofs',{cx:HCX,cz:HCZ,w:68,d:14});
    infoPush('doors',{side:'N',x:HCX,z:HCZ,w:5});
    infoPush('doors',{side:'S',x:HCX,z:HCZ,w:5});
    addLedge(HCX,HCZ,68,0.4,14,mSteel,'ledge',6);                                    // 屋顶
    /* 厅内：柱子 + 售票柜台 + 长椅 + 大钟 */
    for(var px2=-16;px2<=16;px2+=16)for(var pz2=19;pz2<=27;pz2+=4)addBox(px2,pz2,1.0,6,1.0,mPlaster);
    addBox(-11,17.4,12,1.15,1.3,mWood);addBox(11,17.4,12,1.15,1.3,mWood);            // 售票柜台
    deco(0,28.4,2.2,1.6,0.3,new THREE.MeshBasicMaterial({color:0x22303f}),4.2);      // 大钟
    for(var bb=-20;bb<=20;bb+=10)deco(bb,28.4,2.8,0.45,0.6,mWood,0);
    /* ---------- 北货场 ---------- */
    /* 仓库（x -62..-18，z -48..-26，东墙开 6 米大门） */
    addBox(-40,-48,44,7,0.6,mPlaster);addBox(-40,-26,44,7,0.6,mPlaster);
    addBox(-62,-37,0.6,7,22,mPlaster);
    addBox(-18,-44,0.6,7,8,mPlaster);addBox(-18,-30,0.6,7,8,mPlaster);               // 东墙留门
    infoPush('roofs',{cx:-40,cz:-37,w:44,d:22});
    infoPush('doors',{side:'E',x:-40,z:-37,w:6});
    addLedge(-40,-37,44,0.4,22,mSteel,'ledge',7);
    addBox(-40,-37,1.0,7,1.0,mPlaster);addBox(-26,-37,1.0,7,1.0,mPlaster);           // 库内柱子
    addBox(-46,-42,3,1.4,3,mWood);addBox(-34,-32,3,1.4,3,mWood);                     // 库内货箱
    /* 货柜堆场（x 6..56，z -50..-20） */
    var cont=[[10,-24,mRed],[26,-24,mBlue],[42,-24,mGreen],[18,-32,mBlue],[34,-32,mRed],[50,-32,mGreen],
              [10,-40,mGreen],[26,-40,mRed],[42,-40,mBlue],[18,-48,mRed],[34,-48,mGreen],[50,-48,mBlue]];
    for(var ci=0;ci<cont.length;ci++){
      var c=cont[ci];
      addBox(c[0],c[1],12,2.6,2.5,c[2]);
      if(ci%3===0)addLedge(c[0],c[1],12,2.6,2.5,c[2],'ledge',2.6);                   // 几个叠一层（顶面可站）
    }
    /* 水塔（x 58，z -38） */
    deco(58,-40,0.4,7,0.4,mSteel,0);deco(58,-36,0.4,7,0.4,mSteel,0);
    deco(56.4,-40,0.4,7,0.4,mSteel,0);deco(56.4,-36,0.4,7,0.4,mSteel,0);
    addBox(57.2,-38,5.2,3.2,5.2,mSteel);
    deco(57.2,-38,5.6,0.5,5.6,new THREE.MeshLambertMaterial({color:0x6b5646}),10.2);
    /* 装卸台（贴着北侧轨道，矮台可迈上） */
    addBox(0,-12.2,80,0.5,2.4,mConc);
    addBox(-30,-12.2,2.4,1.1,2.4,mWood);addBox(30,-12.2,2.4,1.1,2.4,mWood);          // 台上货箱
    /* ---------- 联机出生点外的一点缀：站前花坛 ---------- */
    addBox(-30,50,6,0.8,6,mGreen);addBox(30,50,6,0.8,6,mGreen);
  }catch(e){}
}
var MAPS=[
  {id:'classic', name:'经典·哨塔竞技场', icon:'🏟', color:'#6ea8ff', ladder:true, tower:true,
   /* 【batch133】世界半径：玩家 / AI / 投掷物能到达的最远处。经典图一直是 76，原样保留。 */
   limit:76,
   desc:'方形竞技场：四角与中央散布掩体，北侧一座哨塔（爬梯上塔顶，塔顶围栏可翻出去跳下）。视野开阔、节奏快。',
   build:function(){ /* 经典图在脚本解析时就建好了（obstacles 一开始就指向它），这里不用重来 */ }},
  {id:'eclipse', name:'日蚀环城', icon:'🌒', color:'#ff8a3d', ladder:false, tower:false,
   /* 【batch133】这张图是椭圆 a=104 / b=88 —— 比原来写死的 WORLD_LIMIT(76) 还大。
      边界不跟着放大的话：出生在 (18,84) 这类点时 z 的绝对值已经 ≥76，
      移动判定 `Math.abs(nz)<WORLD_LIMIT` 恒为 false → 那一个轴一步都迈不出去，
      玩家就"只能沿着另一条轴 + 垂直方向"动 —— 用户报的"卡在一个平面里"。
      取 104＝椭圆长轴；短轴方向外面有围墙挡着，实际走不到那么远。 */
   limit:104,
   desc:'椭圆形环城（东北角有一处外凸）：右侧一栋两层楼房（楼梯上二楼、二楼窗口可跳下）、左侧一栋更大的楼、四周散落民房与掩体；左上 A 点与右上 B 点互为传送门。',
   build:function(){ buildMapEclipse(); }},
  {id:'lab', name:'地下实验室', icon:'🧪', color:'#49e0ff', ladder:false, tower:false,
   /* 【batch149】全封闭的地下设施：天花板是一整块楼板，跳起来会顶头；边界是方盒。 */
   limit:LAB_LIM,
   desc:'地下 40 米的暗月实验设施：9 个功能区由横竖走廊串起来，走廊两侧全是观察窗（玻璃极透明，能看见里面）；中央控制大厅、服务器机房、培养舱区、冷库、反应堆、收容区各据一方。剧情第二章在这里营救「蚀日者」。',
   build:function(){ buildMapLab(); }},
  /* 【batch180】靶场：**独立的一张图**（不是对战图），只给靶场模式用（单人试枪 / 试技能）。
     开阔平地 + 距离标尺 + 三排靶子；靶子既是障碍也是 RANGE_TARGETS 里的可命中目标。 */
  {id:'range', name:'靶场', icon:'🎯', color:'#ffd166', ladder:false, tower:false,
   limit:70,
   desc:'射击训练场：10 / 20 / 30 / 50 米距离标尺，三排共 18 个靶子。弹药无限、技能无冷却，专门用来试枪械手感与角色技能。',
   build:function(){ buildMapRange(); }},
  /* 【batch181】旧火车站：黄昏的废弃车站。3 条轨道**贯穿全图**（两头隧道口），
     火车不定时疾驰而过（撞人 / 碾敌 / 挡子弹）；轨道能被爆炸炸烂 → 班车脱轨翻车。
     南站区（广场 + 候车大厅）/ 轨道带（站台 + 雨棚 + 天桥）/ 北货场（仓库 + 货柜 + 水塔）。 */
  {id:'station', name:'旧火车站', icon:'🚉', color:'#c8d8e8', ladder:false, tower:false,
   limit:78,
   desc:'黄昏里的废弃火车站：3 条轨道贯穿全图，火车不定时疾驰而过（小心被撞飞、AI 会被碾死）；轨道能被爆炸炸烂 —— 烂了那班车就脱轨翻覆、堵死轨道。南有站前广场与候车大厅，北有货场仓库与水塔，两座天桥跨过轨道带。剧情第三章「日陨之地」在这里进行。',
   build:function(){ buildMapStation(); }}
];
var MAP_THEME={
  classic:{bg:0x1a1a2e,fog:0x1a1a2e,fogD:0.015},
  /* 【batch114】原来是 0x141824 / 雾 0.013（又黑又雾）。改成"日食天的白天"：
     天穹是天蓝、地面被暖阳照着，雾调淡到 0.0035（不然 100 米外就白茫茫，放大后的地图看不穿）。 */
  eclipse:{bg:0x9ab4cc,fog:0xa8bccd,fogD:0.0035},
  /* 【batch149】地下实验室：没有天空 —— 背景就是「地下的黑」，雾浓一点把走廊尽头吃掉 */
  lab:{bg:0x04070c,fog:0x070d14,fogD:0.0105},
  /* 【batch180】靶场：室内训练场的冷灰蓝，雾调淡，远处 50 米的靶子也要看得清 */
  range:{bg:0x121722,fog:0x151b28,fogD:0.006},   /* 【batch184d】注意 fogD 是小数密度，不是十六进制；写成 0x006(=6) 会让 FogExp2 密度爆表→进靶场整屏发黑 */
  /* 【batch181】旧火车站：黄昏 —— 天边剩一点暖色，近处已经凉了；雾别太浓，火车老远就要能看见 */
  station:{bg:0x2c3446,fog:0x46536b,fogD:0.0042}
};
/* 【batch133】当前地图的世界半径。原来各处直接用写死的 WORLD_LIMIT(76)，
   遇到比它还大的新图就会把玩家锁在"看不见的方形边界"里（日蚀环城 a=104/b=88）。
   没写 limit 的地图退回默认值，行为与以前完全一致。 */
function worldLimit(){ var m=mapNow(); if(m&&m.limit>0)return m.limit; if(window.ModLoader&&ModLoader._phys&&typeof ModLoader._phys.worldLimit==='number')return ModLoader._phys.worldLimit; return WORLD_LIMIT; }
var MAP_KEY='gunGame.map.v1';
var curMapId='classic';
function mapById(id){ for(var i=0;i<MAPS.length;i++) if(MAPS[i].id===id) return MAPS[i]; return null; }
function mapNow(){ return mapById(curMapId)||MAPS[0]; }
function mapLoad(){ try{ var v=localStorage.getItem(MAP_KEY); if(v&&mapById(v))curMapId=v; }catch(e){} }
function mapSave(){ try{ localStorage.setItem(MAP_KEY,curMapId); }catch(e){} }
/* 单机出生点（脚踩地面，y 由 groundHeightAt 管）。联机出生点由服务端按图下发。 */
var MAP_SPAWNS={
  classic: [[0,15]],
  eclipse: [[-12,4], [-2,48], [30,24], [-44,26], [26,-22], [-2,-38], [-38,66], [60,14], [-42,-26], [18,80], [-66,-2], [58,-24], [52,70], [70,44], [-80,30], [86,4], [22,-70], [-40,-68], [56,-60], [-80,-30]],
  /* 【batch149】实验室：**平时玩的出生点**全部落在走廊交叉口/直走廊上（房间里道具多，不摆出生点）。
     剧情第二章有**固定的**出生点 LAB_STORY_SPAWN(-56,52)，与这里任何一个都不重合 —— 这就是
     用户要的"剧情出生点固定，平时玩在别的地方"。 */
  lab: [[0,22],[0,-22],[-26,0],[26,0],[-26,-60],[-26,-44],[26,60],[26,44],[-60,22],[60,22],[-60,-22],[60,-22],[-26,-12],[26,12],[-44,22],[44,-22],[26,-44],[-26,44],[36,22],[-36,-22]],
  /* 【batch180】靶场：静态也摆一份（buildMapRange 运行时还会再设一次同值）。
     探针 t_map 要求"每张图都有出生点"—— 而 setMap('range') 在非靶场模式会回落经典图，
     运行时就来不及设了，所以对象字面量里必须有。
     19 个点绕开靶子排 / 距离标尺 / 边界墙，也都离两边假人 ≥10 米（探针要求彼此 ≥10 米）。 */
  range: [[0,50],[30,45],[-30,45],[0,20],[40,20],[-40,20],[20,40],[-20,40],[50,0],[-50,0],
          [40,-20],[-40,-20],[22,-30],[-22,-30],[20,-40],[-20,-40],[30,-45],[-30,-45],[0,-50]],
  /* 【batch181】旧火车站：南广场 / 大厅里 / 北货场 / 站台两侧都有点。
     ⚠ 三个口径（探针 t_spawn 逐条验）：① 站台面高 1.3，不算"基础地面"，点摆在站台**外侧**；
              ② 每个点离任意障碍物 ≥2 米、彼此 ≥10 米；
              ③ 轨道带中间不摆点 —— 停靠的列车占 z -1.7..1.7、x -23.8..23.8，别把人刷进车厢。 */
  station: [[0,36],[-16,42],[16,42],[-30,38],[30,38],[8,21],[24,20],[-24,20],
            [0,-20],[18,-24],[-20,-22],[40,-28],[-40,-30],[0,-40],[-15,-42],[24,-44],
            [28,-16],[48,-18],[-48,-18],[52,20],[-52,20],[0,12.5],[44,12.5],[-44,12.5]]
};
function setMap(id){
  /* 【batch131】门口导航表跟着建图一起做（buildNavFor 定义在后面，函数声明会提升） */
  var m=mapById(id); if(!m)return false;
  /* 【batch180】靶场是独立模式的专用图：非靶场模式选到它（含读档带回的 curMapId）一律回落经典图，
     否则原版 / 爆能器里会冒出一张带假人的靶场图 */
  if(id==='range'&&!(typeof rangeMode==='function'&&rangeMode())){ id='classic'; m=mapById(id); if(!m)return false; }
  /* 【batch114】每张图另存一份「地标」：楼梯在哪、二楼地板多高、二楼窗在哪、屋顶多高。
     探针只读它，不写死坐标 —— 以后改布局不用改探针（写死坐标是上次踩过的坑）。 */
  MAP_INFO[id]=MAP_INFO[id]||{stairs:[],floors:[],windows:[],roofs:[],doors:[],oval:[]};
  if(!MAP_BUILT[id]){                                   // 懒构建：第一次用到才建
    MAP_GROUP[id]=new THREE.Group(); MAP_OBS[id]=[]; MAP_TP[id]=[]; MAP_BUILT[id]=true; scene.add(MAP_GROUP[id]);
    var _gT=_mapTarget,_oT=_obsTarget,_tT=_tpTarget,_iT=_infoTarget;
    _mapTarget=MAP_GROUP[id]; _obsTarget=MAP_OBS[id]; _tpTarget=MAP_TP[id]; _infoTarget=MAP_INFO[id];
    _blockedRects=[];
    try{ m.build(); } finally { _mapTarget=_gT; _obsTarget=_oT; _tpTarget=_tT; _infoTarget=_iT; }
  }
  /* 【batch195】把静态方块并成 2~3 个大网格（draw call 从上千降到个位数）。
     ⚠️ 必须放在「懒构建 if」**外面**：经典图是在脚本加载时用顶层 addBox 直接砌好的
     （MAP_BUILT.classic 一开始就是 true），走不进上面那个 if ——
     放在里面就只有日蚀图 / 实验室被合并，经典图照样上百次 draw call。
     用 _合并过 标记保证每张图只并一次（合并会把原网格从组里摘掉，重复调用虽然幂等但白跑遍历）。 */
  try{
    var _mg=MAP_GROUP[id];
    if(_mg&&!_mg.userData._合并过){ mergeMapGroup(_mg); _mg.userData._合并过=1; }
  }catch(e){}
  curMapId=id;
  MAP_HAS_LADDER=!!m.ladder; MAP_HAS_TOWER=!!m.tower;   // 爬梯 / 哨塔特判只对有它们的图生效
  obstacles=MAP_OBS[id];
  teleports=MAP_TP[id]||[];                             // 传送点也跟着换图
  for(var k in MAP_GROUP) if(Object.prototype.hasOwnProperty.call(MAP_GROUP,k)) MAP_GROUP[k].visible=(k===id);
  var th=MAP_THEME[id]||MAP_THEME.classic;
  try{ scene.background.setHex(th.bg); if(scene.fog){scene.fog.color.setHex(th.fog);scene.fog.density=th.fogD;} }catch(e){}
  if(!_navBuiltFor[id]){ _navBuiltFor[id]=1; try{buildNavFor(id);}catch(e){} }   // 【batch131】门口导航表（建完图再算，才能拿到 doors/roofs）
  buildObstacleBoxes();
  mapSave();
  return true;
}
/* ---------------- 传送门（batch112）----------------
   踩进 A 点的圈 → 立刻出现在 B 点；B 点同理。两个坑必须一起堵：
     · 落点不能正好压在对面那个圈上（否则一落地就被传回来）→ 落点取"圈的边缘再往场地中心推 4 米"；
     · 再加 1.2 秒冷却兜底（网络抖动 / 帧率极低时也不会来回弹）。 */
var TP_COOLDOWN_MS=1200;
function updateTeleports(){
  if(!teleports.length||S.hp<=0)return;
  var now=performance.now();
  if(S._tpCD&&now<S._tpCD)return;
  for(var i=0;i<teleports.length;i++){
    var t=teleports[i];
    var dx=camera.position.x-t.x, dz=camera.position.z-t.z;
    if(dx*dx+dz*dz<t.r*t.r){
      camera.position.x=t.to[0];
      camera.position.z=t.to[1];
      camera.position.y=groundHeightAt(t.to[0],t.to[1],GROUND_Y+2);
      S.velY=0;S.onGround=true;S.onLadder=false;S.mantle=0;S.landKick=0.12;
      S._tpCD=now+TP_COOLDOWN_MS;
      if(typeof showMsg==='function')showMsg('⚡ 传送门：'+t.name+' → '+t.toName,'#7fd6ff');
      break;
    }
  }
}
/* 把玩家放到当前地图的一个出生点上（单机开局用） */
/* 【出生点兜底·batch166】若所选出生点（或以后改图/加图时误放进墙里）落在墙体内，
   沿螺旋向外搜索最近的空位再落点；坐标本就干净则原样返回，不影响现有任何行为。 */
function safeSpawnPoint(x,z){
  if(typeof playerBlocked!=='function'||!playerBlocked(x,z,standEyeY()))return [x,z];
  for(var ring=1; ring<=40; ring++){
    var step=1.5, n=Math.max(6, ring*4);
    for(var k=0;k<n;k++){
      var a=k/n*6.2831853, r=ring*step;
      var nx=x+Math.cos(a)*r, nz=z+Math.sin(a)*r;
      if(!playerBlocked(nx,nz,standEyeY()))return [nx,nz];
    }
  }
  return [x,z];   // 极端兜底：实在搜不到就原位（不会比现在更糟）
}
function playerSpawnAt(){
  var l=MAP_SPAWNS[curMapId]||[[0,15]];
  var sp=l[(Math.random()*l.length)|0];
  var s=safeSpawnPoint(sp[0],sp[1]);
  camera.position.set(s[0],GROUND_Y,s[1]);
  S.velY=0;S.onGround=true;S.onLadder=false;S.mantle=0;S.landKick=0;
}
function closestOnAABB(px,pz,o){return{x:Math.max(o.minX,Math.min(px,o.maxX)),z:Math.max(o.minZ,Math.min(pz,o.maxZ))};}
function hasLineOfSight2D(fromX,fromZ,toX,toZ,toY){var dx=toX-fromX,dz=toZ-fromZ,distSq=dx*dx+dz*dz;if(distSq<0.01)return true;var invDist=1/Math.sqrt(distSq),dirX=dx*invDist,dirZ=dz*invDist,maxT=Math.sqrt(distSq);for(var i=0;i<obstacles.length;i++){var o=obstacles[i];if(o.slab)continue;if(o.h&&toY>o.h+0.2)continue;var tmin,tmax;if(Math.abs(dirX)<1e-8){if(fromX<o.minX||fromX>o.maxX)continue;tmin=0;tmax=maxT;}else{tmin=(o.minX-fromX)/dirX;tmax=(o.maxX-fromX)/dirX;if(tmin>tmax){var tmp=tmin;tmin=tmax;tmax=tmp;}}var tymin,tymax;if(Math.abs(dirZ)<1e-8){if(fromZ<o.minZ||fromZ>o.maxZ)continue;tymin=0;tymax=maxT;}else{tymin=(o.minZ-fromZ)/dirZ;tymax=(o.maxZ-fromZ)/dirZ;if(tymin>tymax){var tmp2=tymin;tymin=tymax;tymax=tmp2;}}if(tmin>tymax||tymin>tmax)continue;var enter=Math.max(tmin,tymin),exit=Math.min(tmax,tymax);if(enter<=maxT&&exit>=0)return false;}return true;}
