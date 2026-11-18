/* 【1.10.1】月球基地（地图）+ 剧情第五章「月面守卫战」+ 英雄「月引」（js/70_月球基地.js）============
   这一片是 1.10.x 的主线内容：
     ① 地图 moonbase —— **椭圆形**的月球基地：整座基地坐落在一个陨石坑里，坑口被一座透明穹顶盖住，
        抬头就是外太空（星空 + 远处的地球）。里面有一片研究设施：
          · 中央研究楼（月核就在大厅正中，南北两道门）
          · 植物培养基地（能进去，玻璃房 + 种植架 + 水培槽）
          · 恒星观测基地（能进去，圆顶 + 望远镜）
          · 居住舱 / 仓储间（都能进去）
          · 着陆场（登月舱）、太阳能阵列、通讯塔
     ② 剧情第五章 —— 暗月来攻打月球基地：成波的突击兵冲向「月核」拆解它，
        玩家要守住月核（月核血空 / 自己被击杀 = 失败；四波清完 = 守住）。
     ③ 英雄「月引」—— 月球重力（跳得高、落得慢、走得慢），三个技能：
        引力支点（准星前 5 米造支点并瞬移过去）/ 吸引手雷（贴墙贴人，3 米吸人再爆）/
        潮汐之筒（半透明长筒，把人吸进去持续掉血，能量耗尽那一刻 100 点爆伤）。
   实现约定：本分片**不改老分片的内部实现**，需要插入的地方一律"包一层"
   （updatePlayer / heroCast / attack / updateHero / heroSpeedMul / heroHudUpdate /
     storyFinish / storyClearNow / storyBuildPick / setMap）。老代码即使回退也不会被这里拽坏。 */
/* ==========================================================================================
   一、月球基地（椭圆 · 陨石坑 · 穹顶）
   ========================================================================================== */
var MOON_A=96, MOON_B=80;             // 椭圆半长轴 / 半短轴（世界半径按长轴算）
var MOON_DOME_H=30;                   // 穹顶最高点（视觉）
var 月核={x:0,z:0,hp:0,max:2000,r:6,obj:null,ring:null,hitT:0};

function 月_地形贴图(){
  return _mkTex('groundMoon',function(g,S){
    g.fillStyle='#5d6168';g.fillRect(0,0,S,S);                       // 月壤的冷灰
    /* 环形坑：大小不一的浅色圆 + 暗边 —— 比纯网格更像月面 */
    for(var i=0;i<26;i++){
      var x=Math.random()*S,y=Math.random()*S,r=3+Math.random()*S*0.09;
      g.beginPath();g.arc(x,y,r,0,6.2832);
      g.fillStyle='rgba(120,126,136,.5)';g.fill();
      g.lineWidth=1.6;g.strokeStyle='rgba(40,44,50,.55)';g.stroke();
    }
    g.fillStyle='rgba(255,255,255,.05)';
    for(var k=0;k<420;k++)g.fillRect(Math.random()*S,Math.random()*S,2,2);
  });
}
/* 椭圆地面：一圈边界点连成多边形（坑外不铺地，免得悬空） */
function 月_铺地面(){
  var pts=[],N=112,i,t;
  for(i=0;i<N;i++){
    t=i/N*Math.PI*2;
    pts.push(new THREE.Vector2(Math.cos(t)*MOON_A*1.02,Math.sin(t)*MOON_B*1.02));
  }
  var tex=月_地形贴图();
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(0.42,0.42);
  var m=new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)),
                       new THREE.MeshLambertMaterial({map:tex,color:0xffffff}));
  m.rotation.x=-Math.PI/2;m.position.y=0.02;m.receiveShadow=true;m.raycast=function(){};
  _mapTarget.add(m);
}
/* 陨石坑边：一圈岩壁（kind='border' → 永远挡人，跳多高也翻不出去）
   【步长】0.035 弧度（约 3.4 米一段，块 6.2 米）—— 段太粗从高处看会是一圈锯齿"台阶"，
   段细了齿小、轮廓更像火山口；方块本身是轴对齐的（碰撞盒只有 AABB），所以不旋转，只加密。 */
function 月_坑壁(mat){
  var step=0.035;
  for(var t=0;t<Math.PI*2;t+=step){
    var cx=Math.cos(t)*MOON_A, cz=Math.sin(t)*MOON_B;
    var h=9.6+2.6*Math.abs(Math.sin(t*3.1+0.7))+1.8*Math.abs(Math.sin(t*7.3));
    addBox(cx,cz,6.2,h,6.2,mat,'border');
  }
}
/* 穹顶：半透明椭球壳（纯视觉，不挡人也不挡子弹） */
function 月_穹顶(){
  var g=new THREE.SphereGeometry(1,44,22,0,Math.PI*2,0,Math.PI*0.54);
  var m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0x9fd8ff,transparent:true,opacity:0.13,
      side:THREE.DoubleSide,depthWrite:false}));
  m.scale.set(MOON_A*1.0,MOON_DOME_H,MOON_B*1.0);
  m.position.y=1.0;m.raycast=function(){};m.renderOrder=-2;
  _mapTarget.add(m);
  /* 两道环带（30° / 60° 仰角），让壳子看得出是"一圈圈玻璃拱起来的" */
  for(var e=0;e<2;e++){
    var th=(e?60:30)*Math.PI/180, rr=Math.cos(th), yy=Math.sin(th)*MOON_DOME_H+1;
    var band=new THREE.Mesh(new THREE.TorusGeometry(1,0.012,6,64),
        new THREE.MeshBasicMaterial({color:0x9fd8ff,transparent:true,opacity:0.28}));
    band.rotation.x=Math.PI/2;band.scale.set(MOON_A*rr,MOON_B*rr,1);
    band.position.y=yy;band.raycast=function(){};band.renderOrder=-2;_mapTarget.add(band);
  }
  /* 穹顶骨架：8 条经线（每 20 米一段的细杆），让"穹顶"看得出来是个结构而不是一层雾 */
  var ribMat=new THREE.MeshBasicMaterial({color:0x7fb6d8,transparent:true,opacity:0.35});
  for(var k=0;k<8;k++){
    var a=k/8*Math.PI*2;
    for(var s=0;s<10;s++){
      var p0=s/10*Math.PI*0.54, p1=(s+1)/10*Math.PI*0.54;
      var r0=Math.cos(p0), y0=Math.sin(p0), r1=Math.cos(p1), y1=Math.sin(p1);
      var x0=Math.cos(a)*MOON_A*r0, z0=Math.sin(a)*MOON_B*r0;
      var x1=Math.cos(a)*MOON_A*r1, z1=Math.sin(a)*MOON_B*r1;
      var seg=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.22,1),ribMat);
      var dx=x1-x0, dy=y1*MOON_DOME_H-y0*MOON_DOME_H, dz=z1-z0;
      var L=Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
      seg.position.set((x0+x1)/2,(y0+y1)/2*MOON_DOME_H+1,(z0+z1)/2);
      seg.scale.z=L;
      seg.lookAt(x1,y1*MOON_DOME_H+1,z1);
      seg.raycast=function(){};_mapTarget.add(seg);
    }
  }
}
/* 外太空：星空 + 远处的地球 */
function 月_星空(){
  var n=1000,pos=new Float32Array(n*3),i;
  for(i=0;i<n;i++){
    var u=Math.random()*Math.PI*2, v=Math.random()*0.85;          // 只布上半球，脚下那片看不见
    var r=150;
    pos[i*3]=Math.cos(u)*Math.cos(v)*r;
    pos[i*3+1]=Math.sin(v)*r+10;
    pos[i*3+2]=Math.sin(u)*Math.cos(v)*r;
  }
  var bg=new THREE.BufferGeometry();
  bg.setAttribute('position',new THREE.BufferAttribute(pos,3));
  var pts=new THREE.Points(bg,new THREE.PointsMaterial({color:0xffffff,size:0.9,transparent:true,opacity:0.95,sizeAttenuation:true}));
  pts.raycast=function(){};pts.renderOrder=-3;_mapTarget.add(pts);
  /* 地球：远景大球（放在 -z 方向的斜上方，抬头就能看到"家"） */
  var earth=new THREE.Mesh(new THREE.SphereGeometry(17,26,18),
      new THREE.MeshBasicMaterial({color:0x2f6fd0}));
  earth.position.set(60,64,-150);earth.raycast=function(){};earth.renderOrder=-3;_mapTarget.add(earth);
  var cloud=new THREE.Mesh(new THREE.SphereGeometry(17.4,20,14),
      new THREE.MeshBasicMaterial({color:0xdff0ff,transparent:true,opacity:0.18}));
  cloud.position.copy(earth.position);cloud.raycast=function(){};cloud.renderOrder=-3;_mapTarget.add(cloud);
}
/* 月核：研究楼大厅正中那根发光的柱体（剧情第五章守的东西） */
function 月_建月核(){
  var base=addBox(0,0,3.2,1.1,3.2,new THREE.MeshLambertMaterial({color:0x39414e}));
  var glow=new THREE.Mesh(new THREE.CylinderGeometry(1.15,1.15,3.4,18),
      new THREE.MeshBasicMaterial({color:0x7fe4ff,transparent:true,opacity:0.85}));
  glow.position.set(0,2.8,0);glow.raycast=function(){};_mapTarget.add(glow);
  var ring=new THREE.Mesh(new THREE.TorusGeometry(1.75,0.10,8,26),
      new THREE.MeshBasicMaterial({color:0xbfefff,transparent:true,opacity:0.75}));
  ring.rotation.x=Math.PI/2;ring.position.set(0,2.2,0);ring.raycast=function(){};_mapTarget.add(ring);
  var ring2=ring.clone();ring2.position.y=4.1;ring2.scale.setScalar(0.78);_mapTarget.add(ring2);
  月核.obj=glow;月核.ring=ring;
  return base;
}
/* 一栋"方盒子房间"：四面墙 + 指定几面留门 + 平屋顶可站 + 门/屋顶登记给导航表 */
function 月_房间(x0,x1,z0,z1,h,mat,doors,roofMat){
  var w=x1-x0, d=z1-z0, cx=(x0+x1)/2, cz=(z0+z1)/2, t=0.8;
  var doorW=4.6;
  function wallZ(z,side){
    var open=doors.indexOf(side)>=0;
    if(!open){addBox(cx,z,w,h,t,mat);return;}
    var seg=(w-doorW)/2;
    addBox(x0+seg/2,z,seg,h,t,mat);addBox(x1-seg/2,z,seg,h,t,mat);
    infoPush('doors',{side:side,x:cx,z:cz,w:doorW});
  }
  function wallX(x,side){
    var open=doors.indexOf(side)>=0;
    if(!open){addBox(x,cz,t,h,d,mat);return;}
    var seg=(d-doorW)/2;
    addBox(x,z0+seg/2,t,h,seg,mat);addBox(x,z1-seg/2,t,h,seg,mat);
    infoPush('doors',{side:side,x:cx,z:cz,w:doorW});
  }
  wallZ(z1,'S');wallZ(z0,'N');wallX(x1,'E');wallX(x0,'W');
  infoPush('roofs',{cx:cx,cz:cz,w:w,d:d});
  addLedge(cx,cz,w+0.6,0.5,d+0.6,roofMat||mat,'ledge',h);       // 屋顶（能站、能打）
  return {cx:cx,cz:cz,w:w,d:d,h:h};
}
function buildMapMoon(){
  var mRock=matOf('moonrock',function(g,S){
    g.fillStyle='#4a4f58';g.fillRect(0,0,S,S);
    for(var i=0;i<300;i++){
      var v=(Math.random()*26-13)|0;
      g.fillStyle='rgba('+(96+v)+','+(102+v)+','+(112+v)+',.55)';
      g.fillRect(Math.random()*S,Math.random()*S,4+Math.random()*8,4+Math.random()*8);
    }
    g.strokeStyle='rgba(24,28,34,.45)';g.lineWidth=2;
    g.beginPath();g.moveTo(0,S/2);g.lineTo(S,S/2);g.stroke();
  });
  var mPanel=new THREE.MeshLambertMaterial({color:0xb9c4d2});        // 舱体外壳（亮白金属）
  var mHull =new THREE.MeshLambertMaterial({color:0x8d99a8});
  var mDark =new THREE.MeshLambertMaterial({color:0x2b323c});
  var mGlass=new THREE.MeshLambertMaterial({color:0x8fe3cf,transparent:true,opacity:0.30,
              side:THREE.DoubleSide,depthWrite:false});
  var mGlassBlue=new THREE.MeshLambertMaterial({color:0x9fd8ff,transparent:true,opacity:0.28,
              side:THREE.DoubleSide,depthWrite:false});
  var mGreen=new THREE.MeshLambertMaterial({color:0x3f8a52});
  var mLeaf =new THREE.MeshLambertMaterial({color:0x54b56a});
  var mLamp =new THREE.MeshBasicMaterial({color:0xbfe9ff});
  var mYellow=new THREE.MeshBasicMaterial({color:0xffd166});

  /* 纯装饰（不出碰撞） */
  function deco(x,z,w,h,d,mat,y0){
    var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    m.position.set(x,(y0||0)+h/2,z);m.raycast=function(){};_mapTarget.add(m);return m;
  }
  function cyl(x,z,r,h,mat,y0){
    var m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,18),mat);
    m.position.set(x,(y0||0)+h/2,z);m.raycast=function(){};_mapTarget.add(m);return m;
  }
  /* —— 场地 —— */
  月_铺地面();
  月_坑壁(mRock);
  月_星空();
  月_穹顶();

  /* ---------- 中央研究楼（南北开门，月核在正中） ---------- */
  月_房间(-13,13,-13,13,6.6,mPanel,['N','S'],mHull);
  月_建月核();
  /* 楼里的实验台 + 柱子 */
  addBox(-9.5,9.5,4.4,1.2,2.2,mHull);addBox(9.5,9.5,4.4,1.2,2.2,mHull);
  addBox(-9.5,-9.5,4.4,1.2,2.2,mHull);addBox(9.5,-9.5,4.4,1.2,2.2,mHull);
  addBox(-9.5,0,1.0,6.6,1.0,mPanel);addBox(9.5,0,1.0,6.6,1.0,mPanel);
  /* 楼顶的天线 / 冷却塔 */
  deco(0,0,0.3,3.4,0.3,mHull,6.9);
  deco(0,0,1.6,0.25,1.6,mLamp,10.1);
  deco(-8,0,2.4,1.5,2.4,mDark,6.9);deco(8,0,2.4,1.5,2.4,mDark,6.9);

  /* ---------- 植物培养基地（玻璃房，东面开门） ---------- */
  var 温室=月_房间(-62,-38,16,34,5.2,mGlass,['E'],mGlassBlue);
  /* 里面：四排种植架 + 水培槽 + 补光灯 */
  for(var pz=19;pz<=31;pz+=4){
    addBox(-56,pz,8.6,0.9,1.6,mGreen);
    deco(-56,pz,8.2,0.7,1.2,mLeaf,0.9);
    deco(-56,pz,8.6,0.06,1.4,mYellow,5.0);
  }
  addBox(-41.5,25,1.2,2.6,7.0,mHull);                      // 中央水培塔
  deco(-41.5,25,1.4,0.3,7.2,mLamp,2.6);
  deco(-59,32,2.4,2.0,2.4,mDark,0);                        // 营养液罐
  cyl(-45,32,1.1,2.2,mHull,0);
  /* 屋顶的通风口（温室屋顶是玻璃，走上去能看到下面的绿） */
  deco(-50,25,3.0,0.8,3.0,mHull,5.7);

  /* ---------- 恒星观测基地（圆顶 + 望远镜，西面开门） ---------- */
  月_房间(37,57,18,38,6.0,mPanel,['W'],mHull);
  /* 观测圆顶（视觉）+ 里面那台望远镜 */
  var dome=new THREE.Mesh(new THREE.SphereGeometry(6.6,22,12,0,Math.PI*2,0,Math.PI*0.5),mHull);
  dome.position.set(47,6.4,28);dome.raycast=function(){};_mapTarget.add(dome);
  var slit=new THREE.Mesh(new THREE.BoxGeometry(1.6,0.3,11),mDark);
  slit.position.set(47,10.4,28);slit.rotation.z=0.35;slit.raycast=function(){};_mapTarget.add(slit);
  var tube=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.75,7.4,14),mDark);
  tube.position.set(47,7.6,28);tube.rotation.x=1.02;tube.raycast=function(){};_mapTarget.add(tube);
  deco(47,32,3.4,1.1,1.2,mHull,0);                          // 观测台座
  /* 控制台 + 星图屏 */
  addBox(39.6,35.6,3.2,1.15,2.0,mDark);
  deco(39.6,35.6,3.0,0.9,0.12,new THREE.MeshBasicMaterial({color:0x74c7ff}),1.35);
  addBox(54.4,20.4,2.6,1.15,2.0,mHull);
  /* 楼顶的天文雷达 */
  deco(52,34,2.6,0.3,2.6,mHull,6.2);
  deco(52,34,0.3,1.8,0.3,mHull,6.5);

  /* ---------- 居住舱（东面开门） ---------- */
  月_房间(-58,-38,-35,-21,4.6,mHull,['E'],mPanel);
  for(var bz=-32;bz<=-24;bz+=3.4){
    addBox(-54,bz,5.6,0.55,1.1,mPanel);                      // 上下铺
    addBox(-54,bz+1.3,5.6,0.55,1.1,mPanel);
  }
  addBox(-41.6,-28,2.2,0.9,3.0,mDark);                        // 餐台
  deco(-48,-33.6,6.0,1.4,0.12,new THREE.MeshBasicMaterial({color:0x9fe8ff}),2.6);   // 舷窗屏

  /* ---------- 仓储间（西面开门） ---------- */
  月_房间(38,58,-35,-21,5.0,mHull,['W'],mPanel);
  var 箱=[[42,-32],[46,-32],[50,-32],[44,-26],[48,-26],[54,-32],[54,-26]];
  for(var ci=0;ci<箱.length;ci++) addBox(箱[ci][0],箱[ci][1],2.6,2.2,2.6,mDark);
  addBox(48,-31,6.0,1.3,2.0,mPanel);

  /* ---------- 着陆场（南侧）：停机坪 + 登月舱 ---------- */
  var pad=new THREE.Mesh(new THREE.CircleGeometry(10,36),
        new THREE.MeshLambertMaterial({color:0x6b7280}));
  pad.rotation.x=-Math.PI/2;pad.position.set(0,0.05,-58);pad.receiveShadow=true;
  pad.raycast=function(){};_mapTarget.add(pad);
  for(var a2=0;a2<Math.PI*2;a2+=Math.PI/6){
    var lm=new THREE.Mesh(new THREE.BoxGeometry(1.8,0.12,0.5),mYellow);
    lm.position.set(Math.cos(a2)*8.6,0.1,-58+Math.sin(a2)*8.6);
    lm.rotation.y=-a2;lm.raycast=function(){};_mapTarget.add(lm);
  }
  /* 登月舱：四条腿 + 舱体 + 上升级 */
  for(var lg=0;lg<4;lg++){
    var ang=lg/4*Math.PI*2+0.78;
    deco(Math.cos(ang)*2.6,-58+Math.sin(ang)*2.6,0.28,2.4,0.28,mHull,0);
  }
  addBox(0,-58,5.4,2.4,5.4,mPanel);
  cyl(0,-58,2.0,2.6,mHull,2.4);
  deco(0,-58,2.6,0.5,2.6,mDark,5.0);
  deco(0,-58,0.2,1.6,0.2,mLamp,5.5);

  /* ---------- 太阳能阵列（东西两侧） ---------- */
  for(var sd=-1;sd<=1;sd+=2){
    for(var sp=0;sp<3;sp++){
      var sx=sd*(66+sp*7), sz=-4+sp*4;
      deco(sx,sz,0.26,3.0,0.26,mHull,0);
      var panel=new THREE.Mesh(new THREE.BoxGeometry(5.4,0.16,3.4),
          new THREE.MeshLambertMaterial({color:0x2b4a8a}));
      panel.position.set(sx,3.1,sz);panel.rotation.z=sd*0.22;
      panel.raycast=function(){};_mapTarget.add(panel);
    }
  }
  /* ---------- 通讯塔（北侧） ---------- */
  deco(0,68,0.5,14,0.5,mHull,0);
  deco(0,68,3.2,0.3,3.2,mHull,7.2);
  var dish=new THREE.Mesh(new THREE.SphereGeometry(2.2,16,10,0,Math.PI*2,0,Math.PI*0.45),
      new THREE.MeshLambertMaterial({color:0xd9e2ee,side:THREE.DoubleSide}));
  dish.position.set(0,14.4,68);dish.rotation.x=-0.9;dish.raycast=function(){};_mapTarget.add(dish);
  /* 塔周的地灯 */
  for(var dl=0;dl<6;dl++){
    var da=dl/6*Math.PI*2;
    deco(Math.cos(da)*7,58+Math.sin(da)*7,0.5,0.5,0.5,mLamp,0);
  }
  /* ---------- 中央大道两侧的路灯 ---------- */
  for(var lz=-44;lz<=44;lz+=11){
    if(Math.abs(lz)<16)continue;
    deco(-16,lz,0.22,4.2,0.22,mHull,0);
    deco(16,lz,0.22,4.2,0.22,mHull,0);
    deco(-16,lz,0.7,0.3,0.7,mLamp,4.2);
    deco(16,lz,0.7,0.3,0.7,mLamp,4.2);
  }
  /* ---------- 月面车（装饰，摆在着陆场边上） ---------- */
  deco(-9,-50,3.4,1.1,1.9,mPanel,0);
  deco(-9,-50,1.6,0.9,1.7,mDark,1.1);
  for(var wh=0;wh<4;wh++){
    var wx=-9+(wh%2?1.1:-1.1), wz=-50+((wh<2)?0.95:-0.95);
    var wheel=new THREE.Mesh(new THREE.CylinderGeometry(0.52,0.52,0.32,14),mDark);
    wheel.rotation.z=Math.PI/2;wheel.position.set(wx,0.52,wz);wheel.raycast=function(){};
    _mapTarget.add(wheel);
  }
}

/* 注册地图：limit 按椭圆长轴（不然椭圆边缘那一轴会被方形边界锁住） */
MAPS.push({id:'moonbase', name:'月球基地', icon:'🌕', color:'#9fd8ff', ladder:false, tower:false,
  limit:MOON_A,
  desc:'椭圆形的月球基地：整座基地坐落在一个陨石坑里，坑口被透明穹顶罩住，抬头就是外太空。' +
       '中央研究楼（月核在大厅正中，南北两道门）、能进去的植物培养基地与恒星观测基地、居住舱、仓储间；' +
       '南侧是着陆场与登月舱，东西两侧铺着太阳能阵列，北侧一座通讯塔。剧情第五章「月面守卫战」在这里进行。',
  build:function(){ buildMapMoon(); }});
MAP_THEME.moonbase={bg:0x05070f,fog:0x0a1220,fogD:0.0024};
/* 出生点：中央大道 + 各建筑之间的空地（都离墙 ≥2 米、彼此 ≥10 米） */
MAP_SPAWNS.moonbase=[
  [0,18],[0,32],[0,46],[0,-18],[0,-32],[0,-46],
  [22,0],[-22,0],[22,20],[-22,20],[22,-20],[-22,-20],
  [30,32],[-30,32],[30,-32],[-30,-32],[64,0],[-64,0],[0,-52]
];

/* ==========================================================================================
   二、剧情第五章「月面守卫战」
   ========================================================================================== */
var 月战={phase:'',wave:0,waveMax:4,waveN:[6,8,10,12],spawned:0,total:0,killed:0,
          spawnT:0,nextT:0,coreHp:0,coreMax:2000,raiders:[],msgT:0,coreFlash:0,done:false};
/* 【入口点】必须全部落在空地上（z 绝对值 ≥44 的环形空地 + 东西两端）——
   温室 / 观测站 / 居住舱 / 仓储间都摆在 |x| 38~62、|z| 18~38 这一圈里，
   入口点要是落进那些房子，突击兵会被墙卡住、永远到不了月核，这一波就永远清不掉。 */
var 月战_入口=[[0,52],[0,-52],[30,52],[-30,52],[30,-52],[-30,-52],
              [22,44],[-22,44],[22,-44],[-22,-44],[64,0],[-64,0]];

function 月战_重置(){
  月战.phase='';月战.wave=0;月战.spawned=0;月战.total=0;月战.killed=0;
  月战.spawnT=0;月战.nextT=0;月战.msgT=0;月战.done=false;
  月战.coreHp=月战.coreMax;月核.hp=月战.coreMax;
  月战.raiders.length=0;
  /* 清掉上一局残留的突击兵（他们打着 月兵 标记） */
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];
    if(e&&e.月兵){
      try{ if(e.root&&e.root.parent)e.root.parent.remove(e.root); }catch(_){}
      enemies.splice(i,1);
    }
  }
}
function 月战_刷一个(){
  var sp=月战_入口[(Math.random()*月战_入口.length)|0];
  var t=(月战.wave>=3&&Math.random()<0.35)?'tank':(Math.random()<0.45?'fast':'basic');
  var e=createEnemy(t,sp[0],sp[1]);
  if(!e)return;
  e.月兵=1;e.noAI=1;                        // 不归通用 AI 管：这一段自己驱动（否则只会追着玩家跑）
  e.canShoot=false;
  e.月快=(t==='fast');
  e.月速=(t==='tank')?2.6:(e.月快?4.4:3.4);
  e.spHitAt=0;
  月战.raiders.push(e);月战.spawned++;
}
function 月战_伤害(e,dmg,hs){
  if(!e)return;
  if(e.isNet){ try{ netHitRemote(e,!!hs,dmg,new THREE.Vector3(e.root.position.x,e.root.position.y+1,e.root.position.z),false); }catch(_){} return; }
  e.hp-=dmg;e.flash=Math.max(e.flash||0,0.22);
  if(e.hb){ e.hb.scale.x=Math.max(0,e.hp/e.maxHp); }
  if(e.hbMat) e.hbMat.color.setHex(e.hp/e.maxHp>0.5?0x00ff00:e.hp/e.maxHp>0.25?0xffff00:0xff0000);
  if(e.hp<=0){ var i=enemies.indexOf(e); if(i>=0)killEnemy(e,i,!!hs); }
}
/* 突击兵自己跑向月核：不追玩家、不打玩家，只拆月核（玩家必须在它们靠近前打掉） */
function 月战_兵Tick(dt){
  for(var i=月战.raiders.length-1;i>=0;i--){
    var e=月战.raiders[i];
    if(!e||!e.root||!e.root.parent||e.hp<=0){ 月战.raiders.splice(i,1); continue; }
    var px=e.root.position.x, pz=e.root.position.z;
    var dx=月核.x-px, dz=月核.z-pz, d=Math.sqrt(dx*dx+dz*dz)||1;
    /* 【防卡死】暗月突击兵是 noAI 自驱的：一旦被墙角 / 建筑卡住，它既打不死也不会上交，
       这一波就永远清不掉（软锁）。这里做个体面的兜底：超过 6 秒没有靠近月核 →
       把它挪到研究楼南北门外的通道口，当作"绕了个路"。 */
    if(e.月上次距===undefined){ e.月上次距=d; e.月卡时=0; e.月查时=0; }
    e.月查时+=dt;
    if(e.月查时>=1.0){
      e.月查时=0;
      if(d>e.月上次距-0.4) e.月卡时+=1.0; else e.月卡时=0;
      e.月上次距=d;
      if(e.月卡时>=6.0&&d>6){
        e.月卡时=0;
        e.root.position.set(0,0,(Math.random()<0.5?17:-17));
        e.root.position.y=groundHeightAt(0,e.root.position.z,GROUND_Y)-GROUND_Y;
        try{ spawnParticle(new THREE.Vector3(0,1.2,e.root.position.z),0x8f7bff,8,0.4); }catch(_){}
        /* 位置变了 → 这一帧的 px/pz/dx/dz/d 全部重算，否则下面还按旧点走 */
        px=e.root.position.x; pz=e.root.position.z;
        dx=月核.x-px; dz=月核.z-pz; d=Math.sqrt(dx*dx+dz*dz)||1;
        e.月上次距=d;
      }
    }
    if(d>3.0){
      var step=e.月速*dt;
      var nx=px+dx/d*step, nz=pz+dz/d*step;
      /* 分轴走：撞到墙就只走另一轴（否则会贴着墙角抖） */
      var eye=e.root.position.y+GROUND_Y;
      if(!isColliding(nx,pz,e.sz||1,eye,0.55)) e.root.position.x=nx;
      if(!isColliding(e.root.position.x,nz,e.sz||1,eye,0.55)) e.root.position.z=nz;
      e.root.position.y=groundHeightAt(e.root.position.x,e.root.position.z,eye)-GROUND_Y;
      /* 【1.10.3】原版敌人模型是**朝 -Z**（见 js/25 的 targetYaw=atan2(-dx,-dz)），
         这里少写两个负号 → 突击兵背对着前进方向跑（用户：AI 面朝与要走的方向不符）。 */
      if(e.yawPivot) e.yawPivot.rotation.y=Math.atan2(-dx,-dz);
      /* 走两步留个扬尘 */
      if(Math.random()<0.06) spawnParticle(new THREE.Vector3(e.root.position.x,e.root.position.y+0.2,e.root.position.z),0x9aa4b4,1,0.3);
    }else{
      /* 贴到月核：每秒拆 8 点，并溅出火花 */
      月战.coreHp-=8*dt;
      if(Math.random()<0.25) spawnParticle(new THREE.Vector3(月核.x+(Math.random()-0.5)*3,1.2+Math.random()*2.4,月核.z+(Math.random()-0.5)*3),0x8fe4ff,1,0.35);
      /* 顺手打玩家：站在 9 米内每秒 5 点（逼玩家清场，而不是站在远处看） */
      var pdx=camera.position.x-px, pdz=camera.position.z-pz;
      if(pdx*pdx+pdz*pdz<81&&S.hp>0) takeDmg(5*dt,e);
    }
  }
}
function 月战_HUD(){
  if(typeof storyGoalText==='function'&&typeof storyGoalRefresh==='function')storyGoalRefresh();
  /* 月核的血条直接画在血条下面那行——用 showMsg 会打架，这里改的是剧情 HUD 的文字 */
}
function 月战_Tick(dt){
  if(!(dt>0))dt=0.016;
  /* 【关键】只要剧情已经进入"结局"阶段（end / done），这一帧就**让给原版 storyTick**。
     以前这里只看 月战.phase：被暗月打死走的是 takeDmg → storyEnd('lose')，月战.phase 还停在
     'fight' → 本函数一直 return true → 原版 storyTick 永远不跑"结局收尾"那一块 →
     玩法播完了人却站在那儿干瞪眼（用户报的"第五章结束了没有结尾界面"）。 */
  if(typeof STORY_!=='undefined'&&(STORY_.phase==='end'||STORY_.phase==='done'))return false;
  if(月战.phase!=='fight')return false;
  /* 月核受击闪烁 */
  if(月核.obj){
    月战.coreFlash=Math.max(0,月战.coreFlash-dt*2.2);
     var k=0.55+0.35*Math.sin(performance.now()*0.004)+月战.coreFlash*0.6;
     try{ 月核.obj.material.opacity=Math.min(0.98,k); }catch(_){}
     try{ 月核.ring.rotation.z+=dt*0.8; }catch(_){}
  }
  /* 刷兵 */
  if(月战.spawned<月战.total){
    月战.spawnT-=dt;
    if(月战.spawnT<=0){
      月战.spawnT=(月战.wave>=3)?0.55:0.95;
      月战_刷一个();
    }
  }
  月战_兵Tick(dt);
  /* 本波清空？ */
  if(月战.spawned>=月战.total&&月战.raiders.length===0){
    if(月战.wave<月战.waveMax){
      月战.nextT-=dt;
      if(月战.nextT<=0){
        月战.wave++;
        月战.spawned=0;月战.total=月战.waveN[Math.min(月战.wave-1,月战.waveN.length-1)];
        月战.nextT=3.5;月战.spawnT=0.2;
        showMsg('⚠ 第 '+月战.wave+' 波暗月突击队压上来了','#ff8a3d');
        try{spawnParticle(new THREE.Vector3(月核.x,3,月核.z),0xff8a3d,20,0.6,true);}catch(_){}
      }
    }else{
      月战.phase='clear';
      storyEnd('win');
      return true;
    }
  }
  if(月战.nextT>0)月战.nextT-=dt;
  /* 月核被拆光 */
  if(月战.coreHp<=0){
    月战.coreHp=0;月战.phase='lost';
    showMsg('☠ 月核被拆掉了','#ff4d5e');
    storyEnd('lose');
    return true;
  }
  /* 自己倒下（兜底：takeDmg 里其实已经会走剧情结局） */
  if(S.hp<=0&&STORY_.phase!=='end'){storyEnd('lose');return true;}
  return true;
}
/* 把第五章挂进剧情列表（走模组系统的公开钩子，不动 60 分片的表） */
function 月战_登记剧情(){
  if(月战._已登记)return;
  if(!window.ModLoader||typeof ModLoader.addStory!=='function')return;
  月战._已登记=1;
  ModLoader.addStory({
    n:5, icon:'🌕', name:'第五章 · 月面守卫战', map:'月球基地',
    desc:'暗月的舰队绕过近地轨道，直接扑向我们在月球上的基地 —— 他们不要地盘，只要大厅正中那根「月核」。' +
         '成波的突击兵会绕过你直冲月核，贴上去就开始拆。四波之内把月核守住，月球就还是我们的。' +
         '（这一章的场地是**椭圆形**的月球基地：陨石坑 + 穹顶，植物培养基地和恒星观测基地都能进去。）',
    mapId:'moonbase', spawn:[0,26], need:0,
    lines:[
      '「未来」· 月球前哨 · 紧急通报',
      '三分钟前，暗月的登陆舰越过静海，直接压在我们的基地上空。',
      '他们不要地盘，也不要人质 —— 只要大厅正中那根「月核」。',
      '突击兵会绕过你，贴上去就拆。你能做的只有一件事：别让他们碰到它。',
      '这里重力只有地球的六分之一。跳得高、落得慢 —— 但跑起来也别指望快。'
    ],
    init:function(){ 月战_重置(); },
    begin:function(){
      月战.phase='fight';STORY_.cut=false;
      月战.wave=1;月战.spawned=0;月战.total=月战.waveN[0];
      月战.spawnT=1.0;月战.nextT=0;
      月核.hp=月战.coreHp=月战.coreMax;
      if(typeof storyCutShow==='function')storyCutShow(false);
      if(typeof storyGoalRefresh==='function')storyGoalRefresh();
      showMsg('守住月核：第 1/'+月战.waveMax+' 波','#9fd8ff');
      if(typeof lockPointer==='function')lockPointer();
    },
    tick:function(dt){ return 月战_Tick(dt); },
    goal:function(){
      var hp=Math.max(0,Math.round(月战.coreHp));
      if(月战.phase==='clear')return '剧情Ⅴ · 尾声';
      return '剧情Ⅴ · 守住月核 '+hp+'/'+月战.coreMax+' · 第 '+Math.max(1,月战.wave)+'/'+月战.waveMax+' 波'
             +'（余敌 '+(月战.raiders.length)+'）';
    },
    winLines:[
      '最后一台突击机甲在穹顶下熄了火，碎片慢慢飘起来，又落回去。',
      '月核还在转 —— 淡蓝色的光扫过整个大厅，像什么都没发生过。',
      '通讯频道里，总部那边沉默了两秒，然后是一句：「干得好，月球还是我们的。」',
      '穹顶外，地球悬在黑暗里，一半亮着。'
    ],
    loseLines:[
      '月核的光一寸寸暗下去，大厅里所有的门同时弹开。',
      '暗月的突击兵从你身边跑过，没人再看你一眼 —— 他们要的东西已经拿到了。',
      '穹顶外的地球，还是那样悬着。只是这片基地，不再属于我们。'
    ],
    reward:function(win){
      if(!win)return;
      try{ localStorage.setItem('gunGame.story5.v1',String(Date.now())); }catch(e){}
      /* 【1.10.3】第五章也要发剧情枪皮币：以前只有内置章节的 storyWin 会发，
         第五章走模组的 reward 钩子 → "5 章一共只能拿 200"（正好少这 50）。 */
      try{ if(typeof 领剧情枪皮币==='function')领剧情枪皮币(); }catch(e){}
      /* 新英雄「月引」打完第五章才解锁 */
      try{ if(!UNLOCK.yueyin){ UNLOCK.yueyin=true; if(typeof unlockSave==='function')unlockSave(); } }catch(e){}
      showMsg('✅ 第五章通关：月核守住了 · 「月引」已解锁','#9fd8ff');
    },
    done:function(){ try{ return !!localStorage.getItem('gunGame.story5.v1'); }catch(e){ return false; } }
  });
}

/* ==========================================================================================
   三、英雄「月引」（暗月 · 月球重力 · 引力支点 / 吸引手雷 / 潮汐之筒）
   ========================================================================================== */
/* 【重要】下标现取：大将军（js/64）已经占了 7，以后再有别的分片追加英雄也不会把这里挤错位。
   和 64 分片同一套写法：HERO_XXX=HEROES.length 再 push，前面所有英雄的下标一个都不动。 */
var HERO_YUEYIN=HEROES.length;
/* 【1.10.3】月引＝通关第五章才解锁（以前没登记 → 一开局就能选）。
   heroLoad 跑在 js/44/40，比本文件早，所以这里登记完补一次回退。 */
try{ HERO_LOCKED[HERO_YUEYIN]='锁定 · 通关剧情第五章「月面守卫战」后解锁'; }catch(e){}
try{ HERO_UNLOCK_FLAG[HERO_YUEYIN]='yueyin'; }catch(e){}
try{
  if(typeof heroLocked==='function'&&heroLocked(SK.idx)){ SK.idx=HERO_SCOUT; if(typeof heroSave==='function')heroSave(); }
}catch(e){}
HEROES.push({
  k:'yueyin', name:'月引', tag:'重力', fac:'暗月', facDesc:'佣兵团', icon:'🌙',
  color:0x9fd8ff, css:'#9fd8ff',
  passive:'月面步态：她走路一直偏慢（**移速 −15%**），但在**月球基地**上如鱼得水 ——' +
          '那张图是**六分之一重力**（跳得高、落得慢），而且她在那里**不再减速**。普通地图就是正常重力。',
  skills:[
    {k:'yanchor', name:'引力支点', icon:'⤴', cd:20, dur:0,
     desc:'朝**准星方向 5 米**打出一枚引力支点（有实体模型 + 一条连着自己的引力索），' +
          '然后**猛地把绳子一扯**——不是慢慢飘过去，而是被**一股朝支点的力直接拽飞出去**：起步极快、' +
          '会带着惯性**冲过支点**再落下来。冷却 20 秒 —— 上高台、越掩体、脱身全靠它。'},
    {k:'ybomb', name:'吸引手雷', icon:'🧲', cd:40, dur:0,
     desc:'按 B **拿在手里** → **长按开火键**瞄准（半透明抛物线＝落点）→ 松手抛出。' +
          '手雷会**贴在任何碰到的东西上**（地面 / 墙面 / 天花板，甚至**直接贴在敌人身上**）：' +
          '贴住后 1.3 秒把 **3 米内的人往它身上吸**，然后爆炸 —— 普通爆炸 **35 点**，' +
          '**贴在敌人身上爆炸 90 点**。冷却 40 秒。'},
    {k:'yult', name:'潮汐之筒', icon:'🌀', cd:100, dur:50,
     desc:'拿出装置（**50 点能量，每秒消耗 1 点**）—— 和投掷物一样**双手持装置**：枪/刀收起，**不能开枪、不能用近战**、也不能放别的技能。' +
          '**左键**朝正前方射出一道**半透明长筒**：**半秒伸到 30 米**，**筒身直径 3 米**；被筒罩住的人**跟着筒走**' +
          '（你抬头，他就被一起吸上天，**离你的距离永远是当初被吸住时那个距离**），**动不了**但**照样能开枪**、' +
          '**每秒掉 2 点血**、位置**持续暴露**。每过 **5 秒**停吸 1 秒（这一秒能挣脱）。' +
          '**能量耗尽那一刻，筒内所有人立刻受到 100 点伤害**。' +
          '**右键**收回圆筒（回到手持，能量保留，左键可以再放）；' +
          '**再按一次大招键**＝强制退出并**清空剩余能量**；能量耗尽或冷却转好会**自动退出**。冷却 100 秒。'}
  ]
});
/* ---------------- 月引的常量 ---------------- */
/* 【重力】低重力是**月球基地这张图的环境**，不是月引走到哪都带着走：
   只有 curMapId==='moonbase' 时才替换 GRAVITY / JUMP_FORCE，普通地图一点不改（用户：
   "为什么普通地图也有了引力效果"）。R=六分之一重力：GRAVITY 0.015→0.0072、跳力 0.28→0.30。 */
var 月引_重力=0.0072, 月引_跳力=0.300;
var 月引_移速=0.85;                // 行走速度 −15%（月球基地上是她的主场，不减速，见 heroSpeedMul 包装）
var 月钩_初速=1.15;                // 被绳子扯出去的初速（米/帧@60fps ≈ 69 m/s）
/* 【惯性】衰减越接近 1，惯性保留越久、飞得越远：总位移 ≈ 初速/(1-衰减)。
   0.912 → 约 13 米：支点在 5 米，也就是说**会冲过支点 7~8 米**再落下来，
   这才叫"被甩出去"；以前 0.85 只够飞 6 米，正好停在支点上（用户："只是把我拉到支点那个位置"）。 */
var 月钩_衰减=0.912;
var 月钩_上抛=0.14;                // 起手的一点上抛（米/帧@60fps）：平地扯出去也会先离地一小段
var 月弹_R=3.0, 月弹_伤害=35, 月弹_贴身伤害=90;
var 月弹_吸力=13.0, 月弹_吸时=1.3, 月弹_贴雷引信=1.6;
var 月弹_重力=26;                  // 与 PROJ_G 同口径 —— 抛物线预览画的就是它真正飞的线
var 月筒_R=1.5;                    // 筒身半径（直径 3 米）
var 月筒_长=30, 月筒_伸长=95;      // 30 米、95 米/秒（半秒内伸满）
var 月筒_每秒=2, 月筒_能量=50, 月筒_收尾伤害=100;
var 月筒_吸力=30;                  // 吸人强度（"强得离谱"：60fps 下每帧插值 0.5，约 0.2 秒就吸到位）
/* 被吸住的人是**就地悬停**的：水平位置保持"被吸住那一刻"的样子，只被抬离地面 ——
   所以这里不再需要"离你几米"的吸附距离，也不需要排圈半径。 */
var 月筒_抬升=1.0;                 // 抬升到"筒轴高度 - 这个值"（胸口贴轴，脚悬空 1 米）
var 月筒_停吸周期=6, 月筒_停吸时=1;
/* 把「吸引手雷」登记成**投掷类**技能：这样原版 heroCast 会自动走
   "拿在手里 → 长按开火键瞄准（半透明抛物线）→ 松手抛出"，出手在下面的 heroDoThrow 包装里接管。 */
try{ if(typeof THROW_KINDS!=='undefined')THROW_KINDS['ybomb']=1; }catch(e){}

/* ==================== ① 引力支点 ==================== */
var 月支点=null, 月索=null;
function 月引_支点建模(x,y,z){
  var g=new THREE.Group();
  var mat=new THREE.MeshBasicMaterial({color:0x9fe8ff,transparent:true,opacity:0.95});
  var core=new THREE.Mesh(new THREE.SphereGeometry(0.16,14,10),mat);g.add(core);
  var ring=new THREE.Mesh(new THREE.TorusGeometry(0.42,0.045,7,20),mat.clone());
  g.add(ring);
  var ring2=new THREE.Mesh(new THREE.TorusGeometry(0.30,0.035,7,18),mat.clone());
  ring2.rotation.y=Math.PI/2;g.add(ring2);
  var arm=new THREE.Mesh(new THREE.BoxGeometry(0.05,1.5,0.05),mat.clone());g.add(arm);
  g.position.set(x,y,z);
  g.traverse(function(o){o.raycast=function(){};});
  scene.add(g);
  if(月支点){ try{ if(月支点.g.parent)月支点.g.parent.remove(月支点.g); }catch(_){} }
  月支点={g:g,ring:ring,ring2:ring2,t:1.8,pos:new THREE.Vector3(x,y,z)};
  return 月支点;
}
function 月引_支点Tick(dt){
  if(!月支点)return;
  月支点.t-=dt;
  if(月支点.t<=0){
    try{ if(月支点.g.parent)月支点.g.parent.remove(月支点.g); }catch(_){}
    月支点=null;return;
  }
  月支点.ring.rotation.z+=dt*5.0;
  月支点.ring2.rotation.x+=dt*3.4;
  var a=Math.min(1,月支点.t/0.6);
  月支点.g.traverse(function(o){ if(o.material&&o.material.opacity!==undefined)o.material.opacity=0.95*a; });
  月支点.g.scale.setScalar(0.7+0.3*a);
  /* 引力索：从眼睛拉到支点（只在"扯"的这一小会儿显示）
     ⚠ 用**细圆柱**不用 THREE.Line：WebGL 里 Line 的线宽恒为 1 像素，
     在 1080p 下几乎看不见（用户："看不见"）。圆柱能占 7 厘米粗，还带真深度。 */
  if(SK.yHook) 月引_索显示(camera.position.x,camera.position.y-0.25,camera.position.z,
                           月支点.pos.x,月支点.pos.y,月支点.pos.z);
  else 月引_索隐藏();
}
/* 引力索：一根细圆柱，两点之间摆好（位置=中点、长度=距离、朝向=方向） */
function 月引_索显示(ax,ay,az,bx,by,bz){
  try{
    if(!月索){
      var geo=new THREE.CylinderGeometry(1,1,1,7);
      月索=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x9fe8ff,transparent:true,opacity:0.9}));
      月索.raycast=function(){};scene.add(月索);
    }
    var dx=bx-ax,dy=by-ay,dz=bz-az;
    var len0=Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
    /* 起点往支点方向推 0.75 米、再往下挪一点：相当于"从手里甩出去的绳"。
       贴着相机起点的话，沿绳看过去近端会糊满整个屏幕（一根 7cm 的杆从镜头里穿出去）。 */
    ax+=dx/len0*0.75; ay+=dy/len0*0.75-0.28; az+=dz/len0*0.75;
    dx=bx-ax;dy=by-ay;dz=bz-az;
    var len=Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
    月索.position.set((ax+bx)/2,(ay+by)/2,(az+bz)/2);
    月索.scale.set(0.022,len,0.022);
    var up=new THREE.Vector3(0,1,0), dirv=new THREE.Vector3(dx/len,dy/len,dz/len);
    月索.quaternion.setFromUnitVectors(up,dirv);
    月索.visible=true;
  }catch(_){}
}
function 月引_索隐藏(){ if(月索)月索.visible=false; }
function 月引_支点(){
  var dir=new THREE.Vector3();camera.getWorldDirection(dir);
  var dist=5.0,tx=camera.position.x+dir.x*dist,tz=camera.position.z+dir.z*dist,
      ty=camera.position.y+dir.y*dist;
  /* 落点不能卡在墙里：一点点往回缩（支点本身可以贴在墙上） */
  var use=0;
  for(var s=dist;s>=1.0;s-=0.35){
    var qx=camera.position.x+dir.x*s,qz=camera.position.z+dir.z*s,qy=camera.position.y+dir.y*s;
    if(!playerBlocked(qx,qz,qy)){ tx=qx;tz=qz;ty=qy;use=s;break; }
  }
  if(!use){ showMsg('引力支点被挡住了','#ffb454'); return false; }
  var gy=groundHeightAt(tx,tz,ty);
  if(ty<gy)ty=gy;
  月引_支点建模(tx,ty,tz);
  /* 引力索（立即显示一帧，之后由 月引_支点Tick 跟着眼睛刷新） */
  月引_索显示(camera.position.x,camera.position.y-0.25,camera.position.z,tx,ty,tz);
  /* 关键：**给一股朝支点的力**（不是"飞到支点为止"）——起步极快、带惯性冲过去，之后交给重力 */
  var vx=tx-camera.position.x, vy=ty-camera.position.y, vz=tz-camera.position.z;
  var L=Math.sqrt(vx*vx+vy*vy+vz*vz)||1;
  /* 起手给一点上抛（视线平着时也能"跃"起来）：只是把竖直分量抬高一点，不改变被扯的方向感 */
  SK.yHook={vx:vx/L*月钩_初速,vy:vy/L*月钩_初速+月钩_上抛,vz:vz/L*月钩_初速,t:0,dur:1.3};
  S.velY=0;S.onGround=false;S.landKick=0;SK.mantle=0;
  /* 【去前摇】按下的**这一帧**就先飞出去一截：以前要等下一次 updateHero 才动，
     那一帧的延迟在手上就是"技能按了没反应、等一下才飞"的前摇感。 */
  月引_钩索Tick(1/60);
  try{ spawnParticle(new THREE.Vector3(camera.position.x,camera.position.y-0.4,camera.position.z),0x8fe4ff,10,0.5); }catch(_){}
  try{ heroFxRingAt(tx,tz,0x8fe4ff,0.35,1.4,0.45); }catch(_){}
  showMsg('引力支点：'+use.toFixed(0)+' 米 —— 扯！','#9fd8ff');
  return true;
}
/* 抓钩飞行：每帧按"速度×时间"位移，速度指数衰减 + 吃重力 → 冲过支点再落下 */
function 月引_钩索Tick(dt){
  var h=SK.yHook;if(!h)return;
  var f=dt*60;
  var nx=camera.position.x+h.vx*f, ny=camera.position.y+h.vy*f, nz=camera.position.z+h.vz*f;
  var hitWall=false;
  if(!playerBlocked(nx,nz,ny)) camera.position.set(nx,ny,nz);
  else{
    /* 撞墙：能走的那一轴继续走，两个都走不动就断绳 */
    if(!playerBlocked(nx,camera.position.z,ny)) camera.position.x=nx;
    else if(!playerBlocked(camera.position.x,nz,ny)) camera.position.z=nz;
    else hitWall=true;
  }
  var damp=Math.pow(月钩_衰减,f);
  h.vx*=damp;h.vz*=damp;h.vy*=damp;
  h.vy-=月引_重力*f;
  S.velY=h.vy;S.onGround=false;
  /* 【地面不再中断飞行】以前脚尖一碰地就结束（`y<=gh` 直接 done）→ 平着扯出去只能飞两三米。
     现在贴地就贴地：把高度压在地面、竖直速度清零，**水平惯性照旧**（像贴着地面被拖过去）。
     只有"速度衰减完 / 撞墙 / 时间到"才结束。 */
  var gh=groundHeightAt(camera.position.x,camera.position.z,camera.position.y);
  var done=false;
  if(camera.position.y<gh){ camera.position.y=gh; if(h.vy<0)h.vy=0; }
  if(hitWall||h.t>=h.dur||(Math.abs(h.vx)+Math.abs(h.vz)+Math.abs(h.vy)<0.06&&h.t>0.12))done=true;
  h.t+=dt;
  if(done){
    SK.yHook=null;
    S.velY=h.vy;S.onGround=(camera.position.y<=gh+0.02);
    月引_索隐藏();
  }
}

/* ==================== ② 吸引手雷（真投掷物：拿在手里 → 瞄准 → 抛出） ==================== */
var 月弹=null;
function 月引_手雷模型(){
  var g=new THREE.Group();
  var body=new THREE.Mesh(new THREE.SphereGeometry(0.11,14,10),
      new THREE.MeshLambertMaterial({color:0x2b3a4a}));
  g.add(body);
  var ring=new THREE.Mesh(new THREE.TorusGeometry(0.15,0.022,6,18),
      new THREE.MeshBasicMaterial({color:0x9fe8ff}));
  ring.rotation.x=Math.PI/2;g.add(ring);
  var dot=new THREE.Mesh(new THREE.SphereGeometry(0.045,8,6),
      new THREE.MeshBasicMaterial({color:0xdff6ff}));
  dot.position.y=0.10;g.add(dot);
  g.traverse(function(o){o.raycast=function(){};});
  return g;
}
/* 出手：heroThrowVel / heroThrowFrom 与其它投掷物同一套（预览画的线＝它真正飞的线） */
function 月引_抛雷(){
  if(月弹){ try{ if(月弹.m.parent)月弹.m.parent.remove(月弹.m); }catch(_){} 月弹=null; }
  var v=heroThrowVel(),p=heroThrowFrom();
  var m=月引_手雷模型();
  m.position.set(p.x,p.y,p.z);scene.add(m);
  月弹={m:m,x:p.x,y:p.y,z:p.z,vx:v.vx,vy:v.vy,vz:v.vz,
        st:'fly',t:0,stick:null,attract:0,det:0,spin:0};
  try{ heroFxRingAt(camera.position.x,camera.position.z,0x9fe8ff,0.3,1.3,0.35); }catch(_){}
  /* 联机：把出生点+初速发出去（同房间的人能看到它飞） */
  try{ if(netIsMulti()&&NET.connected)netSend({t:'skill',k:'yueyin',s:1,th:{x:p.x,y:p.y,z:p.z,vx:v.vx,vy:v.vy,vz:v.vz,fuse:-1}}); }catch(_){}
  showMsg('抛出：吸引手雷','#9fd8ff');
  heroHudUpdate(true);
  return true;
}
function 月引_手雷Tick(dt){
  var b=月弹;if(!b)return;
  b.t+=dt;
  if(b.st==='fly'){
    /* ① 贴上人：飞的时候撞到谁就贴谁（贴人爆 90） */
    for(var i=0;i<enemies.length;i++){
      var e=enemies[i];
      if(e.isNet?(!e.alive):(e.hp<=0))continue;
      var ep=heroEntWorld(e);
      var ex=b.x-ep.x,ey=b.y-(ep.y+1.0),ez=b.z-ep.z;
      if(ex*ex+ey*ey+ez*ez<1.3){
        b.st='stuck';b.stick=e;b.det=月弹_贴雷引信;
        showMsg('手雷贴在敌人身上！','#ff8a3d');
        break;
      }
    }
  }
  if(b.st==='fly'){
    b.vy-=月弹_重力*dt;
    var nx=b.x+b.vx*dt, ny=b.y+b.vy*dt, nz=b.z+b.vz*dt;
    /* ② 贴墙 / 贴地：碰到就**吸住**（不反弹） */
    var hit=false;
    if(projHitsWall(nx,b.y,nz)){ nx=b.x;nz=b.z;b.vx=0;b.vz=0;hit=true; }
    var surf=projSurfAt(nx,nz,ny);
    if(ny-PROJ_R<=surf){ ny=surf+PROJ_R; b.vy=0; hit=true; }
    b.x=nx;b.y=ny;b.z=nz;
    if(hit){ b.st='stuck';b.stick=null;b.attract=月弹_吸时;b.det=月弹_吸时+0.4; }
  }else if(b.st==='stuck'){
    if(b.stick){
      var sp=heroEntWorld(b.stick);
      b.x=sp.x;b.y=sp.y+1.0;b.z=sp.z;
      if(b.stick.hp<=0||(b.stick.isNet&&!b.stick.alive)){ b.stick=null;b.det=0.35; }
    }else{
      /* ③ 吸人：3 米内的人被拽向它（吸力很强），吸完就炸 */
      b.attract-=dt;
      if(b.attract>0){
        var R2=月弹_R*月弹_R;
        for(var j=0;j<enemies.length;j++){
          var en=enemies[j];
          if(en.isNet?(!en.alive):(en.hp<=0))continue;
          var p2=heroEntWorld(en);
          var ddx=b.x-p2.x, ddz=b.z-p2.z, dd2=ddx*ddx+ddz*ddz;
          if(dd2<R2&&dd2>0.0004){
            var dl=Math.sqrt(dd2), k=Math.min(1,月弹_吸力*dt);
            if(!en.isNet){ en.root.position.x+=ddx* k; en.root.position.z+=ddz*k; }
          }
        }
        /* 自己也会被吸过去（贴脸扔要小心） */
        var pdx=b.x-camera.position.x, pdz=b.z-camera.position.z, pd2=pdx*pdx+pdz*pdz;
        if(pd2<R2&&pd2>0.0004){
          var pk=Math.min(0.5,3.2*dt);
          var tnx=camera.position.x+pdx*pk, tnz=camera.position.z+pdz*pk;
          if(!playerBlocked(tnx,camera.position.z,standEyeY()))camera.position.x=tnx;
          if(!playerBlocked(camera.position.x,tnz,standEyeY()))camera.position.z=tnz;
        }
      }
      b.det-=dt;
    }
    if(b.det<=0) 月引_手雷炸();
  }
  if(b&&b.m){
    b.m.position.set(b.x,b.y,b.z);
    b.spin+=dt*9;b.m.rotation.y=b.spin;b.m.rotation.x=Math.sin(b.spin*0.7)*0.5;
    if(b.st==='stuck'&&b.attract>0&&Math.random()<0.35){
      /* 吸人时向四周冒引力丝 */
      try{ spawnParticle(new THREE.Vector3(b.x,b.y,b.z),0x9fe8ff,1,0.5); }catch(_){}
    }
  }
}
function 月引_手雷炸(){
  var b=月弹;if(!b)return;
  var cx=b.x,cy=b.y,cz=b.z, 贴人=!!b.stick, 主人=b.stick;
  try{ if(b.m&&b.m.parent)b.m.parent.remove(b.m); }catch(_){}
  月弹=null;
  try{ heroFxRingAt(cx,cz,贴人?0xff8a3d:0x9fe8ff,0.5,贴人?3.4:月弹_R,0.5); }catch(_){}
  try{ spawnParticle(new THREE.Vector3(cx,cy,cz),贴人?0xff8a3d:0x9fe8ff,18,0.55,true); }catch(_){}
  if(贴人&&主人){ 月战_伤害(主人,月弹_贴身伤害,false); return; }
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];
    if(e.isNet?(!e.alive):(e.hp<=0))continue;
    var p=heroEntWorld(e);
    var dx=p.x-cx,dz=p.z-cz;
    if(dx*dx+dz*dz<=月弹_R*月弹_R) 月战_伤害(e,月弹_伤害,false);
  }
  var pdx=camera.position.x-cx,pdz=camera.position.z-cz;
  if(pdx*pdx+pdz*pdz<=月弹_R*月弹_R){ try{ takeDmg(月弹_伤害,null); }catch(_){} }
}

/* ==================== ③ 潮汐之筒 ==================== */
var 月筒=null;
/* ==================== 潮汐之筒的"手持装置"状态机 ====================
   状态（SK.yUlt）：null＝没开；{energy, armed}＝**手持装置**（未释放）；
                   月筒 存在＝**释放中**（装置朝前，圆筒伸出）。
   · 手持时和投掷物一样：**枪/刀收起来，不能开枪、不能用近战、不能放别的技能**
   · 左键：释放（圆筒伸出）    · 右键：释放中 → 收回圆筒，回到手持（能量保留）
   · 再按大招键：强制退出并**清空能量**
   · 能量耗尽 / 冷却已经转好 → 自动退出
   ================================================================ */
var 月引_装置=null;
function 月引_装置模型(){
  var g=new THREE.Group();
  var mat=new THREE.MeshBasicMaterial({color:0x9fe8ff});
  var body=new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.075,0.30,10),mat);g.add(body);
  var ring=new THREE.Mesh(new THREE.TorusGeometry(0.10,0.016,6,16),mat.clone());
  ring.rotation.x=Math.PI/2;ring.position.y=0.10;g.add(ring);
  var glass=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.12,10),
      new THREE.MeshBasicMaterial({color:0xdff6ff,transparent:true,opacity:0.75}));
  glass.position.y=-0.16;g.add(glass);
  g.traverse(function(o){o.raycast=function(){};});
  return g;
}
/* 【1.10.8】这个函数会动**全局**的武器显隐 / 左下角名字 / SK.holdHideGun。
   ⚠️ 它原来被 月引Tick() 里 "if(SK.idx!==HERO_YUEYIN)" 每帧调用一次 false 分支 ——
   等于**只要你不是月引，每帧都替所有英雄撤销一次持物状态**：
   枪被设回可见、刀手被设回可见、名字改回步枪、holdHideGun 清成 false。
   加月引之前根本没有这段，所以以前"掏道具就收枪"是好的；加了之后所有英雄全坏。
   两道修：这里用 月引_持握中 记住"是不是自己设的"，没设过就绝不乱动别人的状态。 */
var 月引_持握中=false;
function 月引_持握姿态(on){
  try{
    if(on){
      if(!月引_装置){
        月引_装置=月引_装置模型();
        月引_装置.position.set(0.30,-0.34,-0.58);
        月引_装置.rotation.set(-0.22,0.18,0.10);
        camera.add(月引_装置);
      }
      月引_装置.visible=true;
      weaponGroup.visible=false;                                  // 收枪（和持握投掷物同一套观感）
      if(typeof leftHandCamGroup!=='undefined'&&leftHandCamGroup)leftHandCamGroup.visible=false;
      SK.holdHideGun=true;
      /* 【1.10.3】拿着装置时左下角显示装置名（顺手记住原主武器名，收起时还原） */
      try{ var _ne=document.getElementById('weapon-name');
        if(_ne){ if(!_ne.getAttribute('data-主'))_ne.setAttribute('data-主',_ne.textContent); _ne.textContent='🌀 潮汐之筒'; } }catch(e){}
      月引_持握中=true;
    }else{
      if(!月引_持握中)return;          /* 没接管过武器显隐 → 不许碰（这就是每帧误清的那一下） */
      月引_持握中=false;
      if(月引_装置){ try{ camera.remove(月引_装置); }catch(_){} 月引_装置=null; }
      SK.holdHideGun=false;
      try{ var _ne2=document.getElementById('weapon-name'); if(_ne2&&_ne2.getAttribute('data-主')){ _ne2.textContent=_ne2.getAttribute('data-主'); _ne2.removeAttribute('data-主'); } }catch(e){}
      try{ weaponGroup.visible=true; }catch(_){}
      try{ if(typeof leftHandCamGroup!=='undefined'&&leftHandCamGroup)leftHandCamGroup.visible=true; }catch(_){}
    }
  }catch(_){}
}
/* 手持 / 释放两种手部姿态：释放时装置抬到正前方 */
function 月引_装置Tick(){
  if(!月引_装置)return;
  /* 每帧强制收枪：换弹 / 切枪 / rebuildWeaponModel 都会把 weaponGroup 重新设成可见，
     只设一次的话拿着装置走着走着枪就冒出来了。 */
  try{
    if(SK.yUlt){
      if(weaponGroup.visible)weaponGroup.visible=false;
      if(typeof leftHandCamGroup!=='undefined'&&leftHandCamGroup&&leftHandCamGroup.visible)leftHandCamGroup.visible=false;
      SK.holdHideGun=true;
    }
  }catch(_){}
  var 释放中=!!月筒;
  var tx=释放中?0.10:0.30, ty=释放中?-0.24:-0.34, tz=释放中?-0.52:-0.58;
  var rx=释放中?-0.05:-0.22, ry=释放中?0.02:0.18, rz=释放中?0.0:0.10;
  var k=0.18;
  月引_装置.position.x+=(tx-月引_装置.position.x)*k;
  月引_装置.position.y+=(ty-月引_装置.position.y)*k;
  月引_装置.position.z+=(tz-月引_装置.position.z)*k;
  月引_装置.rotation.x+=(rx-月引_装置.rotation.x)*k;
  月引_装置.rotation.y+=(ry-月引_装置.rotation.y)*k;
  月引_装置.rotation.z+=(rz-月引_装置.rotation.z)*k;
  /* 能量低时微微发红，提醒快没了 */
  var low=(SK.yUlt&&SK.yUlt.energy<10);
  try{ if(月引_装置.children[1]&&月引_装置.children[1].material)月引_装置.children[1].material.color.setHex(low?0xff8a3d:0x9fe8ff); }catch(_){}
}
function 月引_举起装置(){
  if(SK.hold){ try{ heroHoldCancel(); }catch(_){} }     // 手上还拿着别的投掷物就先收掉
  SK.yUlt={energy:月筒_能量,armed:true,t0:performance.now()};
  月引_持握姿态(true);
  showMsg('🌙 已拿出潮汐装置（能量 '+月筒_能量+'）：**左键**释放长筒 · **右键**收回 · 再按大招键强制退出','#9fd8ff');
  return true;
}
/* 退出大招状态：清空能量、收回装置、恢复枪械 */
function 月引_退出大招(提示){
  if(月筒){ try{ 月引_收筒内部(false); }catch(_){} }
  SK.yUlt=null;
  月引_持握姿态(false);
  if(提示)showMsg('潮汐装置已收起（能量清零）','#9fd8ff');
  try{ heroHudUpdate(true); }catch(_){}
}
function 月引_开筒(){
  if(!SK.yUlt)return false;
  if(SK.yUlt.energy<=0){ showMsg('潮汐装置能量已空','#ffb454'); return false; }
  var grp=new THREE.Group();
  var mat=new THREE.MeshBasicMaterial({color:0x9fe8ff,transparent:true,opacity:0.13,
      side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
  var cyl=new THREE.Mesh(new THREE.CylinderGeometry(月筒_R,月筒_R,1,24,1,true),mat);
  cyl.rotation.x=Math.PI/2;cyl.raycast=function(){};grp.add(cyl);
  var rim=new THREE.Mesh(new THREE.TorusGeometry(月筒_R,0.055,8,28),
      new THREE.MeshBasicMaterial({color:0xdff6ff,transparent:true,opacity:0.75}));
  rim.raycast=function(){};grp.add(rim);
  var rim2=new THREE.Mesh(new THREE.TorusGeometry(月筒_R*0.72,0.03,8,24),
      new THREE.MeshBasicMaterial({color:0xbfefff,transparent:true,opacity:0.45}));
  rim2.raycast=function(){};grp.add(rim2);
  scene.add(grp);
  月筒={grp:grp,cyl:cyl,rim:rim,rim2:rim2,len:0,t:0,acc:0,dir:new THREE.Vector3(0,0,-1)};
  if(SK.yUlt)SK.yUlt.armed=false;
  showMsg('🌊 潮汐之筒展开','#bfefff');
  return true;
}
/* 内部：只把圆筒拆掉、把被吸的人放开（不碰 SK.yUlt） */
function 月引_收筒内部(爆){
  var c=月筒;if(!c)return;
  if(爆){
    for(var i=enemies.length-1;i>=0;i--){
      var e=enemies[i];
      if(e.isNet?(!e.alive):(e.hp<=0))continue;
      if(月_算在筒里(e)||月_在筒内(e,0.6)) 月战_伤害(e,月筒_收尾伤害,false);
    }
    try{ heroFxRingAt(camera.position.x,camera.position.z,0xdff6ff,1.0,10,0.7); }catch(_){}
    showMsg('💥 潮汐之筒能量耗尽 —— 筒内 100 点爆伤','#ff8a3d');
  }
  try{ if(c.grp.parent)c.grp.parent.remove(c.grp); }catch(_){}
  月筒=null;
  月引_放开全部();
}
/* 对外：爆=true 是能量耗尽（100 点 + **整个大招结束**）；爆=false 是主动收回（回到手持，能量保留） */
function 月引_收筒(爆){
  if(!月筒)return;
  月引_收筒内部(爆);
  if(爆){
    SK.yUlt=null;
    月引_持握姿态(false);
  }else if(SK.yUlt){
    SK.yUlt.armed=true;
    showMsg('潮汐之筒已收回 · 剩余能量 '+Math.ceil(SK.yUlt.energy)+' 点（左键再放，右键/大招键退出）','#9fd8ff');
  }
}
/* 锁住一个目标：**停掉它的通用 AI**（noAI=1 → updateEnemies 直接 continue：不走路、不转身、不开火），
   于是它在筒里连"动一下"都没有。松手时原样恢复（记在 _原noAI / _原canShoot 上，不靠猜）。 */
/* 长筒的两个垂向基向量（筒轴 dir 之外的两个方向） */
function 月_筒基(){
  var c=月筒, d=c.dir;
  var u=new THREE.Vector3().crossVectors(d,new THREE.Vector3(0,1,0));
  if(u.lengthSq()<1e-6)u.set(1,0,0);
  u.normalize();
  var v=new THREE.Vector3().crossVectors(d,u).normalize();
  return {u:u,v:v};
}
/* 锁住一个目标：把它的胸口位置记在**筒坐标系**里（沿轴 t + 两个垂向分量 ou/ov）。
   → 之后每帧按"当前筒"重新算世界坐标：人跟着筒一起转（朝上看就被带上天），
     而**离你的距离永远是当初被吸住时那个距离**（t/ou/ov 都不变）。
   ⚠ 不冻结 AI：位置由本机每帧写死，他走不掉，但**照样能转身、瞄准、开火**（"不代表失去行动能力"）。 */
function 月引_锁住(e){
  if(!e||e.月锁)return;
  var c=月筒;if(!c)return;
  var p0=heroEntWorld(e);
  var cy=p0.y+(e.isNet?0.6:1.0);
  var ox=camera.position.x,oy=camera.position.y,oz=camera.position.z;
  var rx=p0.x-ox, ry=cy-oy, rz=p0.z-oz;
  var t=rx*c.dir.x+ry*c.dir.y+rz*c.dir.z;
  if(t<=0.3)return;
  var px=rx-c.dir.x*t, py=ry-c.dir.y*t, pz=rz-c.dir.z*t;
  var b=月_筒基();
  e.月锁={t:t,
          ou:px*b.u.x+py*b.u.y+pz*b.u.z,
          ov:px*b.v.x+py*b.v.y+pz*b.v.z,
          baseY:p0.y-cy};                 // 脚比胸口低多少（一般 -1）
  try{ if(e.aimLine)e.aimLine.visible=false; }catch(_){}
}
function 月引_放开一个(e){
  if(!e)return;
  e.月锁=null;
  if(e._原noAI!==undefined){ e.noAI=e._原noAI; delete e._原noAI; }       // 兼容旧存档 / 旧状态
  if(e._原canShoot!==undefined){ e.canShoot=e._原canShoot; delete e._原canShoot; }
}
function 月引_放开全部(){
  for(var i=0;i<enemies.length;i++){ var e=enemies[i]; if(e&&(e.月锁||e._原noAI!==undefined))月引_放开一个(e); }
}
function 月_筒距离(x,y,z){
  var c=月筒;if(!c)return -1;
  var ox=camera.position.x,oy=camera.position.y,oz=camera.position.z;
  var vx=x-ox,vy=y-oy,vz=z-oz;
  var t=vx*c.dir.x+vy*c.dir.y+vz*c.dir.z;
  if(t<0||t>c.len)return -1;
  var px=ox+c.dir.x*t,py=oy+c.dir.y*t,pz=oz+c.dir.z*t;
  var dx=x-px,dy=y-py,dz=z-pz;
  return Math.sqrt(dx*dx+dy*dy+dz*dz);
}
/* 目标是不是"被这道筒罩住了"：
   横向（垂直于筒轴的水平距离）≤ 筒半径，沿轴 0..len 之间，竖直方向离筒轴 ≤3.6 米。
   ⚠ 不能直接用点到轴线的三维距离：筒轴在眼睛高度，站地上的人天然就差 2 米，
   那样"站着的人"永远判不进筒里（以前靠把人抬到轴线上来掩盖这一点）。 */
function 月_在筒内(e,slack){
  var c=月筒;if(!c)return false;
  var p=heroEntWorld(e);
  var ox=camera.position.x,oy=camera.position.y,oz=camera.position.z;
  var cy=p.y+(e.isNet?0.6:1.0);
  var vx=p.x-ox,vy=cy-oy,vz=p.z-oz;
  var t=vx*c.dir.x+vy*c.dir.y+vz*c.dir.z;
  var sl=slack||0;
  if(t<0.2||t>c.len+sl)return false;
  var ax=ox+c.dir.x*t, ay=oy+c.dir.y*t, az=oz+c.dir.z*t;
  var hx=p.x-ax, hz=p.z-az;
  if(Math.sqrt(hx*hx+hz*hz)>月筒_R+sl)return false;
  if(Math.abs(ay-cy)>3.6+sl)return false;
  return true;
}
/* 【永远 false】长筒是从自己眼睛发出去的 —— 筒轴原点和相机重合，
   所以"玩家在不在筒内"这个判定算出来恒为真：以前每 0.5 秒给自己扣 1 点血、
   能量耗尽时还给自己来 100 点（用户："大招为什么会伤到我自己"）。
   施法者就是引力源，本来就不该被自己的筒吸 / 灼烧，这里直接判为不在筒内。 */
function 月_玩家在筒内(slack){ return false; }
/* 筒的推进：伸长 / 摆位 / 能量 / 掉血 / 暴露 —— 吸人另在"敌人更新之后"做（否则会被 AI 拽回去） */
function 月引_筒Tick(dt){
  var c=月筒;if(!c)return;
  c.t+=dt;
  /* 能量：每秒 1 点（只在开筒期间消耗） */
  if(SK.yUlt){
    SK.yUlt.energy=Math.max(0,SK.yUlt.energy-dt);
    if(SK.yUlt.energy<=0){ 月引_收筒(true); return; }
  }
  /* 极快伸长：0.32 秒伸满 30 米 */
  c.len=Math.min(月筒_长,c.len+月筒_伸长*dt);
  var fwd=new THREE.Vector3();camera.getWorldDirection(fwd);
  c.dir.copy(fwd);
  c.grp.position.copy(camera.position);
  c.grp.lookAt(camera.position.x+fwd.x,camera.position.y+fwd.y,camera.position.z+fwd.z);
  c.cyl.scale.set(1,c.len,1);
  c.cyl.position.set(0,0,c.len/2);
  c.rim.position.set(0,0,c.len);c.rim.rotation.z+=dt*2.2;
  c.rim2.position.set(0,0,c.len*0.55);c.rim2.rotation.z-=dt*3.0;
  /* 暴露：筒内一直续期（spHitAt＝头顶那枚金色菱形），离开后还剩 3 秒 */
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];
    if(e.isNet?(!e.alive):(e.hp<=0))continue;
    if(月_算在筒里(e)) e.spHitAt=performance.now()+3000;
  }
  /* 掉血：每 0.5 秒结算 1 点（＝每秒 2 点，帧率无关） */
  c.acc+=dt;
  if(c.acc>=0.5){
    c.acc-=0.5;
    for(var j=enemies.length-1;j>=0;j--){
      var en=enemies[j];
      if(en.isNet?(!en.alive):(en.hp<=0))continue;
      if(月_算在筒里(en)) 月战_伤害(en,月筒_每秒*0.5,false);
    }
    if(月_玩家在筒内(0)){ try{ takeDmg(月筒_每秒*0.5,null); }catch(_){} }
  }
}
/* 【关键】吸人：必须在 updateEnemies 之后跑 —— AI 每帧会把模型往自己想去的地方摆，
   放在它前面就"吸不动"。这里把被吸住的人**锁在半空**（月锁），他自己一步也走不了。 */
function 月引_吸力Tick(dt){
  var c=月筒;if(!c){ return; }
  /* 每 5 秒停吸 1 秒：这一秒里所有人放开、可以掉下来 / 跑掉 */
  var 吸引中=((c.t%月筒_停吸周期)<(月筒_停吸周期-月筒_停吸时));
  if(!吸引中){
    月引_放开全部();
    return;
  }
  var ox=camera.position.x,oy=camera.position.y,oz=camera.position.z;
  var b=月_筒基();
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];
    if(!e||!e.root)continue;
    if(e.isNet?(!e.alive):(e.hp<=0)){ 月引_放开一个(e); continue; }
    if(e.月锁){
      /* 已经锁住的**不再用几何判定复检**：筒一转，它那一刻必然"看起来在筒外"（因为它还没被摆过去）。
         只要筒还够长（沿轴 t 在范围内）就继续吸着；要挣脱就等每 5 秒那 1 秒停吸、或者大招结束。 */
      if(e.月锁.t>c.len){ 月引_放开一个(e); continue; }
    }else{
      if(!月_在筒内(e,0)){ continue; }
      月引_锁住(e);
      if(!e.月锁)continue;
    }
    if(e.isNet)continue;
    var L=e.月锁;
    /* 按当前筒重建世界坐标：t 沿轴、ou/ov 是当初的垂向偏移 → 筒怎么转，人怎么跟着转 */
    var cx=ox+c.dir.x*L.t+b.u.x*L.ou+b.v.x*L.ov;
    var cy=oy+c.dir.y*L.t+b.u.y*L.ou+b.v.y*L.ov;
    var cz=oz+c.dir.z*L.t+b.u.z*L.ou+b.v.z*L.ov;
    e.root.position.x=cx;
    e.root.position.y=cy+L.baseY;
    e.root.position.z=cz;
  }
}


/* 这一帧这个人算不算"在筒里"（被吸住的一律算 —— 他是被筒带着走的，不在几何判定范围内很正常） */
function 月_算在筒里(e){ if(!e)return false; if(e.月锁)return true; return 月_在筒内(e,0); }

/* 月引每帧总入口（由 updateHero 的包装调用） */
var 月引_上一帧=0;
function 月引Tick(){
  var now=performance.now();
  var dt=月引_上一帧?Math.min((now-月引_上一帧)/1000,0.1):0.016;月引_上一帧=now;
  月引_钩索Tick(dt);
  月引_装置Tick();
  /* 冷却已经转好（且没在放筒）→ 自动退出大招状态（靶场无冷却，跳过） */
  if(SK.yUlt&&SK.cds){
    /* 记下"这一次大招见过的最长冷却"：只有真的从 >0 一路走到 0 才算"冷却转好"。
       否则冷却本来就是 0（靶场 / 调试把 cds 清零）时会一拿出来就被自动退掉。 */
    if(SK.yUlt.cdSeen===undefined||SK.cds[2]>SK.yUlt.cdSeen)SK.yUlt.cdSeen=SK.cds[2];
    if(!月筒&&SK.yUlt.cdSeen>1&&SK.cds[2]<=0&&!(typeof rangeMode==='function'&&rangeMode())) 月引_退出大招(false);
  }
  月引_支点Tick(dt);
  月引_手雷Tick(dt);
  月引_筒Tick(dt);
  /* 不是月引了：把东西收干净（换人 / 死后别把筒留在场上） */
  if(SK.idx!==HERO_YUEYIN){
    if(月筒){ try{ if(月筒.grp.parent)月筒.grp.parent.remove(月筒.grp); }catch(_){} 月筒=null; }
    月引_放开全部();
    if(SK.yUlt)SK.yUlt=null;
    /* 【1.10.8】只有**真的还有月引的东西要收**时才调（筒还在 / 大招状态还在）。
       原来这里无条件调一次，而它是每帧都跑的 → 所有非月引英雄每一帧都被清一次持物状态。 */
    if(月引_装置||月引_持握中)月引_持握姿态(false);
  }
}
/* 换图 / 重开：把筒、雷、支点、索都收干净（否则模型会跟着飘到别的图） */
function 月引_清场(){
  if(月弹){ try{ if(月弹.m.parent)月弹.m.parent.remove(月弹.m); }catch(_){} 月弹=null; }
  if(月筒){ try{ if(月筒.grp.parent)月筒.grp.parent.remove(月筒.grp); }catch(_){} 月筒=null; }
  if(月支点){ try{ if(月支点.g.parent)月支点.g.parent.remove(月支点.g); }catch(_){} 月支点=null; }
  if(月索){ try{ if(月索.parent)月索.parent.remove(月索); }catch(_){} 月索=null; }
  月引_放开全部();
  SK.yHook=null;SK.yUlt=null;月引_上一帧=0;
  月引_持握姿态(false);
}

/* ==========================================================================================
   四、"包一层"：把月引接进现有流程（不修改任何老分片的函数体）
   ========================================================================================== */
/* ① 重力 / 跳跃：updatePlayer 之前换成月球参数，跑完还原（默认值原样保存，模组改过也不影响） */
var _月_原updatePlayer=updatePlayer;
/* 这张图是不是低重力（只有月球基地是）—— 探针 / 调试也读它，别在别处再写一遍判断 */
function 月引_该低重力(){ try{ return (typeof curMapId!=='undefined'&&curMapId==='moonbase'); }catch(e){ return false; } }
updatePlayer=function(){
  var g0=GRAVITY, j0=JUMP_FORCE;
  /* 只有月球基地是六分之一重力（环境属性，对所有人都一样）；普通地图原样不动 */
  if(月引_该低重力()){ GRAVITY=月引_重力; JUMP_FORCE=月引_跳力; }
  try{ return _月_原updatePlayer.apply(this,arguments); }
  finally{ GRAVITY=g0; JUMP_FORCE=j0; }
};
/* ② 行走速度 −15% */
var _月_原heroSpeedMul=heroSpeedMul;
heroSpeedMul=function(){
  var m=_月_原heroSpeedMul.apply(this,arguments);
  /* 她自己走路偏慢（−15%）；但在月球基地上这就是她的步态，不再减速 */
  if(SK.idx===HERO_YUEYIN&&!SK.sp&&!月引_该低重力())m*=月引_移速;
  return m;
};
/* ③ 每帧推进：updateHero 之后跑月引自己的东西（updatePlayer 已经跑完，位移才不会被物理覆盖） */
var _月_原updateHero=updateHero;
updateHero=function(){
  var r=_月_原updateHero.apply(this,arguments);
  try{ 月引Tick(); }catch(e){}
  return r;
};
/* ③-b 吸人放在 updateEnemies 之后（AI 每帧摆位置，放在它前面等于白吸） */
var _月_原updateEnemies=updateEnemies;
var _月_敌帧=0;
updateEnemies=function(){
  var r=_月_原updateEnemies.apply(this,arguments);
  try{
    var nw=performance.now();
    var edt=_月_敌帧?Math.min((nw-_月_敌帧)/1000,0.1):0.0166;_月_敌帧=nw;
    月引_吸力Tick(edt);
  }catch(e){}
  return r;
};
/* ④ 技能释放：月引三个技能走自己的分支，其余英雄照旧交给原版 heroCast
   （二技能是**投掷物**：交给原版走"拿在手里 → 瞄准 → 抛出"，出手在 ⑤ 的 heroDoThrow 里接管） */
var _月_原heroCast=heroCast;
heroCast=function(i){
  i=i|0;
  if(SK.idx!==HERO_YUEYIN)return _月_原heroCast.apply(this,arguments);
  if(!S.playing||S.over||S.paused||S.hp<=0)return _月_原heroCast.apply(this,arguments);
  if(i===1)return _月_原heroCast.apply(this,arguments);          // 吸引手雷＝投掷类
  if(typeof 载具!=='undefined'&&载具&&typeof 载具.在开车==='function'&&载具.在开车())return false;
  var H=heroNow(),s=H.skills[i];if(!s)return false;
  var 无冷却=(typeof rangeMode==='function'&&rangeMode());
  /* 【大招状态机】放在冷却门之前：
       · 释放中再按＝收回圆筒，回到"手持"（能量保留）
       · 手持中再按＝**强制退出并清空能量**（冷却照旧往下走，不重置） */
  if(i===2&&月筒){ 月引_收筒(false); heroHudUpdate(true); return true; }
  if(i===2&&SK.yUlt){ 月引_退出大招(true); return true; }
  /* 手持装置期间：和拿着投掷物一样，别的技能一概放不出来 */
  if(SK.yUlt){ showMsg('手持潮汐装置中：先放出/收起（或者再按一次大招键退出）','#ffb454'); return false; }
  if(!无冷却&&SK.cds[i]>0){ showMsg(s.name+' 冷却中（还剩 '+SK.cds[i].toFixed(1)+' 秒）','#ffd166'); return false; }
  var done=false;
  if(i===0)done=月引_支点();
  else if(i===2)done=月引_举起装置();
  if(!done)return false;
  if(!无冷却)SK.cds[i]=s.cd;else SK.cds[i]=0;
  try{ if(netIsMulti()&&NET.connected)netSend({t:'skill',k:'yueyin',s:i,x:camera.position.x,y:standSurfY(),z:camera.position.z}); }catch(e){}
  heroHudUpdate(true);
  return true;
};
/* ⑤ 投掷出手：吸引手雷走自己的物理（贴墙贴人 + 吸人 + 两档伤害） */
var _月_原heroDoThrow=heroDoThrow;
heroDoThrow=function(){
  var h=SK.hold;
  if(h&&h.kind==='ybomb'){
    SK.hold=null;SK.aimThrow=false;
    try{ heroHoldHide();heroPreviewHide(); }catch(_){}
    return 月引_抛雷();
  }
  return _月_原heroDoThrow.apply(this,arguments);
};
/* ⑤-b 手里举着的那枚雷用"自己的模型"（否则会退化成烟罐） */
try{ if(window.ModLoader&&ModLoader.throwables) ModLoader.throwables['ybomb']={id:'ybomb',name:'吸引手雷',mesh:月引_手雷模型,scale:0.55}; }catch(e){}
/* ⑥ 开火键：大招待发时扣扳机＝发射长筒（不开枪） */
var _月_原attack=attack;
attack=function(){
  var 在开车=false;
  try{ 在开车=!!(typeof 载具!=='undefined'&&载具&&typeof 载具.在开车==='function'&&载具.在开车()); }catch(_){}
  if(SK.idx===HERO_YUEYIN&&SK.yUlt&&S.playing&&!S.paused&&S.hp>0&&!在开车){
    if(月筒) return;              // 释放中：不开枪（也不挥刀）
    月引_开筒();                  // 手持：左键释放长筒
    return;
  }
  return _月_原attack.apply(this,arguments);
};
/* ⑦ 右键收起长筒（能量保留）：捕获阶段拦下来，免得顺手把 ADS 也按开了 */
try{
  window.addEventListener('mousedown',function(e){
    if(e.button!==2)return;
    if(typeof SK==='undefined'||SK.idx!==HERO_YUEYIN||!SK.yUlt)return;
    e.preventDefault();e.stopPropagation();
    if(月筒) 月引_收筒(false);        // 释放中 → 收回圆筒，回到手持（能量保留）
    else 月引_退出大招(true);          // 手持中 → 退出（清空能量）
    heroHudUpdate(true);
  },true);
}catch(e){}
/* ⑧ HUD：大招槽位显示剩余能量 */
var _月_原heroHudUpdate=heroHudUpdate;
heroHudUpdate=function(force){
  var r=_月_原heroHudUpdate.apply(this,arguments);
  try{
    if(SK.idx===HERO_YUEYIN&&SK.yUlt){
      var slot=document.getElementById('skSlot2');
      if(slot&&slot.querySelector){
        var kk=slot.querySelector('.skKey');
        var en=Math.ceil(Math.max(0,SK.yUlt.energy||0));
        if(kk)kk.textContent=(月筒?('⚡'+en):('能量 '+en));
      }
    }
  }catch(e){}
  return r;
};
/* ⑨ 剧情：第五章不让 storyFinish 走"第一章"那套文案，也不让它顺手解锁闪电 */
var _月_原storyClearNow=storyClearNow;
storyClearNow=function(){
  if(typeof STORY_!=='undefined'&&STORY_.ch===5)return false;
  return _月_原storyClearNow.apply(this,arguments);
};
var _月_原storyFinish=storyFinish;
storyFinish=function(){
  var r=_月_原storyFinish.apply(this,arguments);
  try{
    if(typeof STORY_==='undefined'||STORY_.ch!==5)return r;
    var win=(STORY_.res==='win');
    var ttl=document.getElementById('storyDoneTitle'), sub=document.getElementById('storyDoneSub'),
        body=document.getElementById('storyDoneBody');
    if(ttl)ttl.textContent=win?'🎬 剧情通关 · 月核守住了':'☠ 任务失败';
    if(sub)sub.textContent=win
      ?'四波突击队全被打退，月核还在转 —— 月球基地保住了。'
      :(月战.coreHp<=0?'月核被拆掉了。暗月要的东西已经拿到手。':'你倒在了基地里，突击兵从你身边跑过。');
    if(body)body.innerHTML=
      '<p class="stLine">结局 · '+(win?'月球还是我们的':'基地失守')+'</p>'
      +'<p class="stLine dim">'+(win?'穹顶下的灯一盏盏亮回来。地球在黑暗里悬着，一半亮着。'
                                     :'大厅的光一寸寸暗下去。通讯频道里，总部那边一直没有声音。')+'</p>'
      +'<div class="stUnlock"><b>🌕 月核</b>：'+Math.max(0,Math.round(月战.coreHp))+' / '+月战.coreMax
      +'　·　打退 <b>'+Math.max(0,月战.wave)+'</b> / '+月战.waveMax+' 波</div>'
      +'<div class="stUnlock" style="background:rgba(159,216,255,.08);border-color:rgba(159,216,255,.32)">'
      +'<b>🌙 月引</b>（暗月）：月球重力的新英雄 —— 跳得高、落得慢，引力支点 / 吸引手雷 / 潮汐之筒。'
      +'在「🦸 英雄」页可以直接选她出战。</div>'
      +'<p class="stLine dim">⛓ 守月核的诀窍：突击兵**只拆月核、不打你**（你凑近了才会挨打），'
      +'所以别追着他们跑 —— 站在大厅门口，把进来的清掉；涌得太多就用大招先把筒里的人吸住。</p>'
      +'<p class="stLine dim" style="font-size:12px">（剧情到此结束，可以返回主菜单了）</p>';
  }catch(e){}
  return r;
};
/* ⑨-b 主菜单那个「剧情模式」按钮的说明：60 分片里那句是 1.8.0 之前写的（只提到前三章 + 大将军），
   这里补一句第五章，免得主界面上看不到新章节。 */
var _月_原storyRefreshBtn=storyRefreshBtn;
storyRefreshBtn=function(){
  var r=_月_原storyRefreshBtn.apply(this,arguments);
  try{
    var tag=document.getElementById('storyTag');
    if(tag&&tag.textContent.indexOf('第五章')<0){
      tag.textContent+=' · 第五章「月面守卫战」已开放（月球基地 · 守月核）';
    }
  }catch(e){}
  return r;
};
/* ⑨-c 章节列表按章节号排序：本分片在**加载时**就登记第五章，而 js/64 的第四章是在
   陵园 Tick 里才登记的 → 不排一下的话列表会变成 1、2、3、5、4（第五章跑到第四章前面）。 */
var _月_原storyBuildChap=storyBuildChap;
storyBuildChap=function(){
  try{ STORY_CHAPS.sort(function(a,b){return (a.n|0)-(b.n|0);}); }catch(e){}
  return _月_原storyBuildChap.apply(this,arguments);
};
/* ⑩ 剧情选人面板：第五章允许多人 / 全部已解锁英雄（含月引）出战 */
var _月_原storyBuildPick=storyBuildPick;
storyBuildPick=function(){
  _月_原storyBuildPick.apply(this,arguments);
  if(typeof STORY_==='undefined'||STORY_.ch!==5)return;
  var g=document.getElementById('storyPickGrid');if(!g)return;
  var _t=document.getElementById('storyPickTitle'), _tp=document.getElementById('storyPickTip');
  if(_t)_t.textContent='🌕 第五章 · 月面守卫战';
  if(_tp)_tp.textContent='暗月的登陆舰已经压在基地上空，突击兵不要地盘，只要大厅正中那根「月核」——'+
    '他们会绕过你冲进去，贴上去就拆。四波之内守住月核，月球才是我们的。'+
    '这里重力只有地球的六分之一：跳得高、落得慢（月引在这里最顺手）。';
  var h='';
  for(var i=0;i<HEROES.length;i++){
    var H=HEROES[i];
    if(heroLocked(i))continue;
    h+='<div class="stCardItem" data-s="'+i+'" style="--c:'+H.css+'"'+(i===STORY_.sel?' data-on="1"':'')+'>'
      +'<div class="stIcon">'+H.icon+'</div><div class="stName">'+H.name+'</div>'
      +'<div class="stTag">'+H.tag+'</div>'
      +'<div class="stSk">'+H.skills.map(function(s){return s.icon;}).join(' ')+'</div></div>';
  }
  g.innerHTML=h;
  var cs=g.querySelectorAll('.stCardItem');
  for(var c=0;c<cs.length;c++)cs[c].addEventListener('click',function(){
    STORY_.sel=parseInt(this.getAttribute('data-s'),10)||0;storyBuildPick();
  });
};
/* ⑪ 换图 / 重开：把月引的筒、雷、支点、索都收掉（和 64 分片的"换图钩子"同一套写法，串在它后面） */
var _月_原setMap=setMap;
setMap=function(id,不存){
  var ok=_月_原setMap.apply(this,arguments);
  if(ok){ try{ 月引_清场(); }catch(e){} }
  return ok;
};

/* ==========================================================================================
   五、登记 / 刷新 UI
   ========================================================================================== */
try{ 月战_登记剧情(); }catch(e){}
try{ if(typeof buildMapGrid==='function')buildMapGrid(); }catch(e){}
try{ if(typeof buildHeroGrid==='function')buildHeroGrid(); }catch(e){}
try{ if(typeof storyRefreshBtn==='function')storyRefreshBtn(); }catch(e){}
/* 调试 / 探针接口（不进任何 UI） */
try{
  window.月球基地={
    地图:'moonbase', 月核:月核, 战况:月战,
    月引:{下标:HERO_YUEYIN, 支点:function(){return 月支点;}, 手雷:function(){return 月弹;}, 长筒:function(){return 月筒;}},
    打一章:function(){ if(typeof storyOpen==='function'){STORY_.ch=5;storyStart();} },
    刷一波:function(n){ 月战.total=月战.spawned+(n||3); for(var i=0;i<(n||3);i++)月战_刷一个(); },
    清兵:function(){ for(var i=enemies.length-1;i>=0;i--){var e=enemies[i];if(e&&e.月兵){try{if(e.root&&e.root.parent)e.root.parent.remove(e.root);}catch(_){}enemies.splice(i,1);}} 月战.raiders.length=0; }
  };
}catch(e){}
