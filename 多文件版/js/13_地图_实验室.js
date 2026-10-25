/* ==================== 【batch149】新地图：地下实验室 ====================
   用户需求：① 地下地图、错综复杂、面积要大；② 有实验设施，部分装玻璃（非常透明）能看见里面；
             ③ 剧情第二章在这里：小兵不断进攻 + 闪电随机闪现到背后偷袭一下就走，
                必须走到「蚀日者」收容舱、长按 F 维持 20 秒把人救出来才算赢；
             ④ 剧情出生点固定（离收容舱很远）；平时单人玩这张图出生在别处。
   【结构分层】
     · 天花板 = 一整块 addLedge 悬空楼板（y0=LAB_H）→ headBlockAt 生效，跳起来会顶头；
     · 外墙 kind='border'（永远挡，人出不去）；内墙 = 全高实体方块（一辈子是墙，不参与台阶容差）；
     · 走廊 = "房间与房间之间的空隙"：横竖各两条，把场地切成 3×3 共 9 个区块房间；
     · 每面内墙上开门（4~7 米宽）与观察窗（玻璃）——**所有主门都开在房间边的正中间**，
       于是 z=0 / z=±47 / x=0 / x=±53.5 这几条线上 "门对门" 连成直通道，
       既方便玩家跑图，也让 AI 的"门口导航"（MAP_NAV）能一路走通。
   【玻璃】只加网格、不推 obstacles？——不，**玻璃要挡人**（是窗，不是洞）：
     窗洞处登记一条"从地面到顶"的实心碰撞体，视觉上再摆窗台 + 玻璃 + 过梁三层。
     所以看得见（透明 0.14）、走不过（碰撞照旧），子弹也照样被挡。
   【注意】内墙一律用 addBox / labSolid（**不用 addLedge**）——addLedge 会打成 slab，
     而 isColliding 对 slab 在"不传 py"时直接放行 → 子弹会穿墙。 */
var LAB_H=5.6;                     // 层高（天花板底面高度）；正常起跳 2.6 米，顶不到头
var LAB_LIM=88;                    // 世界半径
var LAB_WX=78, LAB_WZ=69;          // 外墙中心线（内表面分别在 ±76.5 / ±67.5）
var LAB_T=1.2;                     // 内墙厚
var LAB_VX=[-26,26];               // 纵向走廊中心线（x）
var LAB_HZ=[-22,22];               // 横向走廊中心线（z）
var LAB_RESCUE={x:52,z:-46};       // 「蚀日者」收容舱（剧情第二章营救点）
var LAB_STORY_SPAWN={x:-56,z:52};  // 剧情第二章固定出生点（与收容舱相距约 146 米）
var STATION_STORY_SPAWN={x:0,z:36};   // 【batch181】剧情第三章固定出生点（站前广场南缘，面北朝大厅与轨道带；别塞进 (0,44) 的喷泉盒子里）
var LAB_DOOR_SIDES=[               // 九个房间 + 它们"登记给 AI 门口导航"的那扇门在哪一面
  {cx:-53.5,cz:-47,w:46,d:41,side:'E'},   // 西·北：培养舱区
  {cx:-53.5,cz:  0,w:46,d:35,side:'E'},   // 西·中：冷库
  {cx:-53.5,cz: 47,w:46,d:41,side:'E'},   // 西·南：电梯大厅（第二章出生点）
  {cx:   0,cz:-47,w:43,d:41,side:'S'},    // 中·北：服务器机房
  {cx:   0,cz:  0,w:43,d:35,side:'S'},    // 中·中：中央控制大厅
  {cx:   0,cz: 47,w:43,d:41,side:'N'},    // 中·南：实验台区
  {cx: 53.5,cz:-47,w:46,d:41,side:'W'},   // 东·北：收容区（蚀日者在这里）
  {cx: 53.5,cz:  0,w:46,d:35,side:'W'},   // 东·中：观察室
  {cx: 53.5,cz: 47,w:46,d:41,side:'W'}    // 东·南：反应堆
];

/* ---------------- 这张图专属的程序化贴图 ---------------- */
function labWallTexDraw(g,S){          // 墙板：暗金属 + 铆钉 + 一条青色警示带
  g.fillStyle='#2b323c';g.fillRect(0,0,S,S);
  var rows=6,rh=S/rows,r,c,k;
  for(r=0;r<rows;r++){
    var v=((r*29)%13)-6;
    g.fillStyle='rgb('+(45+v)+','+(53+v)+','+(64+v)+')';
    g.fillRect(0,r*rh+1,S,rh-2);
  }
  g.strokeStyle='rgba(0,0,0,.35)';g.lineWidth=2;
  for(r=0;r<=rows;r++){g.beginPath();g.moveTo(0,r*rh);g.lineTo(S,r*rh);g.stroke();}
  g.fillStyle='rgba(0,0,0,.28)';
  for(c=0;c<=4;c++)g.fillRect(c*S/4-1,0,2,S);
  g.fillStyle='rgba(90,225,255,.5)';g.fillRect(0,S*0.47,S,4);
  g.fillStyle='rgba(180,200,220,.30)';
  for(k=0;k<40;k++){g.beginPath();g.arc(8+(k%8)*S/8,14+((k/8)|0)*S/6,2.2,0,6.2832);g.fill();}
}
function labFloorTexDraw(g,S){         // 地砖：深灰方砖 + 缝
  g.fillStyle='#171c24';g.fillRect(0,0,S,S);
  var n=4,u=S/n,r,c,i,v;
  for(r=0;r<n;r++)for(c=0;c<n;c++){
    v=((r*7+c*11)%9)-4;
    g.fillStyle='rgb('+(31+v)+','+(37+v)+','+(46+v)+')';
    g.fillRect(c*u+1,r*u+1,u-2,u-2);
  }
  g.strokeStyle='rgba(0,0,0,.5)';g.lineWidth=2;
  for(i=0;i<=n;i++){g.beginPath();g.moveTo(i*u,0);g.lineTo(i*u,S);g.moveTo(0,i*u);g.lineTo(S,i*u);g.stroke();}
}
function labCeilTexDraw(g,S){          // 天花板：暗色格栅
  g.fillStyle='#20262e';g.fillRect(0,0,S,S);
  g.fillStyle='#151a21';
  for(var i=0;i<4;i++)for(var j=0;j<4;j++)g.fillRect(i*S/4+5,j*S/4+5,S/4-10,S/4-10);
  g.strokeStyle='rgba(120,160,200,.12)';g.lineWidth=3;g.strokeRect(0,0,S,S);
}
/* 机柜：一格一格的设备 + 两排指示灯（六面同贴图，看着像"机柜阵"） */
function labRackTexDraw(g,S){
  g.fillStyle='#161b22';g.fillRect(0,0,S,S);
  for(var r=0;r<9;r++){
    g.fillStyle=(r%2)?'#222a34':'#12171d';
    g.fillRect(10,r*S/9+4,S-20,S/9-8);
    for(var k=0;k<4;k++){
      g.fillStyle=((k+r)%3)?'rgba(80,230,255,.9)':'rgba(110,255,160,.9)';
      g.fillRect(20+k*24,r*S/9+9,8,6);
    }
  }
  g.strokeStyle='rgba(90,225,255,.25)';g.lineWidth=4;g.strokeRect(2,2,S-4,S-4);
}
function labPipeTexDraw(g,S){          // 管道：金属 + 锈
  g.fillStyle='#4a525c';g.fillRect(0,0,S,S);
  for(var i=0;i<220;i++){
    g.fillStyle='rgba('+(60+((i*13)%40))+','+(66+((i*7)%36))+','+(74+((i*11)%34))+',.55)';
    g.fillRect(Math.random()*S,Math.random()*S,4,3);
  }
  g.fillStyle='rgba(0,0,0,.30)';
  for(var k=0;k<3;k++)g.fillRect(0,k*S/3,S,4);
}

/* ---------------- 材质 ---------------- */
var _labGlassMat=null,_labGlowMats={};
function labGlassMat(){          // 【非常透明】观察窗玻璃：透明度 0.14
  if(!_labGlassMat)_labGlassMat=new THREE.MeshLambertMaterial(
    {color:0xbfe4f5,transparent:true,opacity:0.14,side:THREE.DoubleSide,depthWrite:false});
  return _labGlassMat;
}
function labGlowMat(c){          // 自发光（灯 / 屏幕 / 指示带）：不受光照影响
  if(!_labGlowMats[c])_labGlowMats[c]=new THREE.MeshBasicMaterial({color:c});
  return _labGlowMats[c];
}

/* ---------------- 墙 / 板 ---------------- */
/* 只出网格、不出碰撞体（灯罩 / 窗台 / 过梁这类装饰用） */
function labMesh(x,z,w,d,y0,y1,mat){
  var h=y1-y0; if(h<0.04||w<0.04||d<0.04)return null;
  var geo=new THREE.BoxGeometry(w,h,d); scaleBoxUV(geo,w,h,d,2);
  var m=new THREE.Mesh(geo, mat||matOf('labwall',labWallTexDraw));
  m.position.set(x,y0+h/2,z); _mapTarget.add(m); return m;
}
/* 网格 + 「从地面到 y1」的实心碰撞体。为什么碰撞体从地面算：
   窗洞下面是窗台（0~0.95）、上面是过梁 —— 人本来就走不到玻璃那一层，
   按"整段是墙"记碰撞最稳（子弹也照常被挡），还省掉一堆叠起来的盒子。 */
function labSolid(x,z,w,d,y0,y1,mat){
  y1=(y1===undefined)?LAB_H:y1;
  labMesh(x,z,w,d,y0,y1,mat);
  _obsTarget.push({cx:x,cz:z,w:w,d:d,h:y1,kind:'terrain',
                   minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});
}
/* 一道内墙：axis='z' 表示沿 z 延伸（墙位于 x）；反之沿 x 延伸（墙位于 z）。
   open=[[相对于墙段中心的偏移, 洞宽, 'door'|'glass', 玻璃下沿(可省), 玻璃上沿(可省)], ...]
   'door'  → 全高洞口，人/子弹都能过；
   'glass' → 窗台 + 玻璃 + 过梁三层（视觉透明，碰撞实心）。 */
function labWallRun(x,z,len,axis,open){
  var ops=(open||[]).slice().sort(function(a,b){return a[0]-b[0];});
  var cur=-len/2, i, sym=matOf('labwall',labWallTexDraw);
  function put(c0,c1,y0,y1){
    var L=c1-c0; if(L<0.1||(y1-y0)<0.1)return;
    var c=(c0+c1)/2;
    if(axis==='z')labSolid(x,z+c,LAB_T,L,y0,y1,sym);
    else          labSolid(x+c,z,L,LAB_T,y0,y1,sym);
  }
  for(i=0;i<ops.length;i++){
    var o=ops[i],h0=o[0]-o[1]/2,h1=o[0]+o[1]/2,kind=o[2]||'door';
    put(cur,h0,0,LAB_H);
    if(kind==='glass'){
      var a=(o[3]===undefined)?0.95:o[3], b=(o[4]===undefined)?4.35:o[4];
      var L2=h1-h0, c2=(h0+h1)/2;
      var gx=(axis==='z')?x:x+c2, gz=(axis==='z')?z+c2:z;
      var gw=(axis==='z')?LAB_T:L2, gd=(axis==='z')?L2:LAB_T;
      labMesh(gx,gz,gw,gd,0,a,sym);                                        // 窗台
      labMesh(gx,gz,(axis==='z')?0.32:L2,(axis==='z')?L2:0.32,a,b,labGlassMat());  // 玻璃（薄）
      labMesh(gx,gz,gw,gd,b,LAB_H,sym);                                    // 过梁
      _obsTarget.push({cx:gx,cz:gz,w:gw,d:gd,h:LAB_H,kind:'terrain',
                       minX:gx-gw/2,maxX:gx+gw/2,minZ:gz-gd/2,maxZ:gz+gd/2});
    }
    cur=h1;
  }
  put(cur,len/2,0,LAB_H);
}

/* ---------------- 实验设施 ---------------- */
/* 培养舱：透明玻璃筒 + 里面发光的液体（"能看见里面的情况"） */
function labTank(x,z,r,h,glow){
  var g=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,18,1,true), labGlassMat());
  g.position.set(x,h/2,z); _mapTarget.add(g);
  var liq=new THREE.Mesh(new THREE.CylinderGeometry(r*0.85,r*0.85,h*0.74,18),
    new THREE.MeshBasicMaterial({color:glow,transparent:true,opacity:0.42,depthWrite:false}));
  liq.position.set(x,h*0.43,z); _mapTarget.add(liq);
  var cap=new THREE.Mesh(new THREE.CylinderGeometry(r*1.1,r*1.1,0.26,18), matOf('labrack',labRackTexDraw));
  cap.position.set(x,h+0.13,z); _mapTarget.add(cap);
  var base=new THREE.Mesh(new THREE.CylinderGeometry(r*1.12,r*1.2,0.36,18), matOf('labrack',labRackTexDraw));
  base.position.set(x,0.18,z); _mapTarget.add(base);
  _obsTarget.push({cx:x,cz:z,w:r*2,d:r*2,h:h,kind:'terrain',minX:x-r,maxX:x+r,minZ:z-r,maxZ:z+r});
  infoPush('labs',{k:'tank',x:x,z:z});
}
/* 机柜（服务器 / 冷库货架）：1.0×1.9 的方柱，带指示灯 */
function labRack(x,z){
  addBox(x,z,1.0,3.1,1.9,matOf('labrack',labRackTexDraw));
  var led=new THREE.Mesh(new THREE.BoxGeometry(0.62,0.06,0.04), labGlowMat(0x5ef0ff));
  led.position.set(x,3.02,z-0.96); _mapTarget.add(led);
  var led2=new THREE.Mesh(new THREE.BoxGeometry(0.62,0.06,0.04), labGlowMat(0x5ef0ff));
  led2.position.set(x,3.02,z+0.96); _mapTarget.add(led2);
}
/* 控制台：矮台 + 一块斜着的发光屏 */
function labConsole(x,z,w,d){
  addBox(x,z,w,1.05,d,matOf('labrack',labRackTexDraw));
  var scr=new THREE.Mesh(new THREE.BoxGeometry(w*0.78,0.5,d*0.62), labGlowMat(0x2ad6ff));
  scr.position.set(x,1.36,z); scr.rotation.x=-0.42; _mapTarget.add(scr);
}
/* 顶灯：贴在天花板底面上的一块自发光板 */
function labLamp(x,z,w,d){
  var m=new THREE.Mesh(new THREE.BoxGeometry(w,0.13,d), labGlowMat(0xd8ecff));
  m.position.set(x,LAB_H-0.16,z); _mapTarget.add(m);
  var halo=new THREE.Mesh(new THREE.BoxGeometry(w*1.5,0.05,d*1.5),
    new THREE.MeshBasicMaterial({color:0xbfe0ff,transparent:true,opacity:0.16,depthWrite:false}));
  halo.position.set(x,LAB_H-0.26,z); _mapTarget.add(halo);
}
/* 天花板管道（纯装饰，不参与碰撞） */
function labPipeRun(x,z,len,axis,r){
  var g=new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,10), matOf('labpipe',labPipeTexDraw));
  if(axis==='z')g.rotation.x=Math.PI/2; else g.rotation.z=Math.PI/2;
  g.position.set(x,LAB_H-0.62,z); _mapTarget.add(g);
}
/* 收容舱：蚀日者被关在这里（玻璃筒 + 里面的人影 + 日冕光晕） */
function labPod(x,z){
  var shell=new THREE.Mesh(new THREE.CylinderGeometry(2.6,2.6,4.6,22,1,true), labGlassMat());
  shell.position.set(x,2.3,z); _mapTarget.add(shell);
  var top=new THREE.Mesh(new THREE.CylinderGeometry(2.85,2.85,0.42,22), matOf('labrack',labRackTexDraw));
  top.position.set(x,4.75,z); _mapTarget.add(top);
  var base=new THREE.Mesh(new THREE.CylinderGeometry(2.95,3.15,0.5,22), matOf('labrack',labRackTexDraw));
  base.position.set(x,0.25,z); _mapTarget.add(base);
  /* 里面的人影（暗色剪影 + 蚀日者标志性的日冕橙光） */
  var body=new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.56,1.6,10), new THREE.MeshBasicMaterial({color:0x1b1030}));
  body.position.set(x,1.9,z); _mapTarget.add(body);
  var head=new THREE.Mesh(new THREE.SphereGeometry(0.33,10,8), new THREE.MeshBasicMaterial({color:0x1b1030}));
  head.position.set(x,2.9,z); _mapTarget.add(head);
  var halo=new THREE.Mesh(new THREE.SphereGeometry(1.05,14,10),
    new THREE.MeshBasicMaterial({color:0xff9a3d,transparent:true,opacity:0.52,depthWrite:false}));
  halo.position.set(x,2.95,z); _mapTarget.add(halo);
  _obsTarget.push({cx:x,cz:z,w:5.2,d:5.2,h:4.6,kind:'terrain',minX:x-2.6,maxX:x+2.6,minZ:z-2.6,maxZ:z+2.6});
  infoPush('labs',{k:'pod',x:x,z:z});
}
/* 任务光柱：depthTest:false → **隔墙也能看见**，玩家据此认路 */
function labBeacon(x,z){
  var m=new THREE.Mesh(new THREE.CylinderGeometry(1.0,2.0,24,16,1,true),
    new THREE.MeshBasicMaterial({color:0xffa03d,transparent:true,opacity:0.17,
                                 side:THREE.DoubleSide,depthWrite:false,depthTest:false}));
  m.position.set(x,11,z); m.renderOrder=870; _mapTarget.add(m);
  LAB_MARK=m; return m;
}
/* 反应堆：大玻璃罩 + 中间发光堆芯 */
function labReactor(x,z){
  var shell=new THREE.Mesh(new THREE.CylinderGeometry(4.6,4.6,4.6,24,1,true), labGlassMat());
  shell.position.set(x,2.3,z); _mapTarget.add(shell);
  var core=new THREE.Mesh(new THREE.CylinderGeometry(1.5,1.5,4.2,20),
    new THREE.MeshBasicMaterial({color:0x49e0ff,transparent:true,opacity:0.72,depthWrite:false}));
  core.position.set(x,2.1,z); _mapTarget.add(core);
  var ring=new THREE.Mesh(new THREE.TorusGeometry(3.5,0.16,8,26), labGlowMat(0x9ff0ff));
  ring.rotation.x=Math.PI/2; ring.position.set(x,3.1,z); _mapTarget.add(ring);
  var pad=new THREE.Mesh(new THREE.CylinderGeometry(5.4,5.6,0.42,26), matOf('labrack',labRackTexDraw));
  pad.position.set(x,0.21,z); _mapTarget.add(pad);
  _obsTarget.push({cx:x,cz:z,w:9.2,d:9.2,h:4.6,kind:'terrain',minX:x-4.6,maxX:x+4.6,minZ:z-4.6,maxZ:z+4.6});
  infoPush('labs',{k:'reactor',x:x,z:z});
}
/* 电梯（第二章的"入口"）：一个门框 + 两扇金属门 + 楼层指示 */
function labElevator(x,z){
  var frame=matOf('labrack',labRackTexDraw);
  addBox(x,z-3.2,7.2,0.7,1.0,frame);
  addBox(x,z+3.2,7.2,0.7,1.0,frame);
  addBox(x-3.6,z,0.7,LAB_H,7.4,frame);
  addBox(x+3.6,z,0.7,LAB_H,7.4,frame);
  addBox(x,z,6.4,LAB_H-0.7,0.5,frame);
  var lamp=new THREE.Mesh(new THREE.BoxGeometry(2.6,0.22,0.16), labGlowMat(0x6effb0));
  lamp.position.set(x,LAB_H-0.85,z-0.3); _mapTarget.add(lamp);
  infoPush('labs',{k:'lift',x:x,z:z});
}
/* 柱子：1.2×1.2 全高，用来在空旷大厅里造掩体与层次 */
function labPillar(x,z,h){
  addBox(x,z,1.2,h===undefined?LAB_H:h,1.2,matOf('labwall',labWallTexDraw));
}

function buildMapLab(){
  var i,j,x,z;
  /* ---------- 地面 / 天花板 / 外墙 ---------- */
  var ft=_mkTex('labfloor',labFloorTexDraw); ft.repeat.set(168/6,148/6);
  var fg=new THREE.Mesh(new THREE.PlaneGeometry(168,148), new THREE.MeshLambertMaterial({map:ft}));
  fg.rotation.x=-Math.PI/2; fg.position.set(0,0.02,0); _mapTarget.add(fg); fg.receiveShadow=false;
  addLedge(0,0,166,0.6,146,matOf('labceil',labCeilTexDraw),'ledge',LAB_H);   // 天花板（头顶碰撞）
  var oW=(LAB_WX+1.5)*2, oD=(LAB_WZ+1.5)*2, bm=null;
  addBox(0,-LAB_WZ,oW,LAB_H,3,bm,'border');
  addBox(0, LAB_WZ,oW,LAB_H,3,bm,'border');
  addBox(-LAB_WX,0,3,LAB_H,oD,bm,'border');
  addBox( LAB_WX,0,3,LAB_H,oD,bm,'border');

  /* ---------- 内墙：竖 4 面 × 3 段，横 4 面 × 3 段 ----------
     每段都有一扇"正中间"的门 —— z=0 / z=±47 / x=0 / x=±53.5 这几条线上门对门连成直通道；
     另有若干观察窗（glass）：窗台 0.95、玻璃到 4.35、上面是过梁。 */
  var VW=[
    [-30.5,-47,41,[[0,6,'door'],[-14,5,'glass',0.95,4.35]]],
    [-30.5,  0,35,[[0,6,'door'],[ 11,6,'glass',0.95,4.35]]],
    [-30.5, 47,41,[[0,6,'door'],[-14,5,'glass',0.95,4.35]]],
    [-21.5,-47,41,[[0,6,'door']]],
    [-21.5,  0,35,[[0,7,'door']]],
    [-21.5, 47,41,[[0,6,'door']]],
    [ 21.5,-47,41,[[0,6,'door']]],
    [ 21.5,  0,35,[[0,7,'door']]],
    [ 21.5, 47,41,[[0,6,'door']]],
    [ 30.5,-47,41,[[0,6,'door'],[ 16,6,'glass',0.95,4.35]]],
    [ 30.5,  0,35,[[0,6,'door'],[-13,7,'glass',0.95,4.35]]],
    [ 30.5, 47,41,[[0,6,'door'],[ 14,6,'glass',0.95,4.35]]]
  ];
  for(i=0;i<VW.length;i++)labWallRun(VW[i][0],VW[i][1],VW[i][2],'z',VW[i][3]);
  /* 【batch149-D】数组约定与上面的 VW 完全一致：[x(墙所在的横坐标), z(墙段中心), 段长, 开口表]。
     原来这里按 [z, x, ...] 写，调用时又照 [x, z] 取 —— 每面横墙都跑偏了位置。 */
  var HW=[
    [-53.5,-26.5,46,[[0,6,'door'],[-14,5,'glass',0.95,4.35]]],
    [    0,-26.5,43,[[0,7,'door']]],
    [ 53.5,-26.5,46,[[0,7,'door'],[-16,6,'glass',0.95,4.35]]],
    [-53.5,-17.5,46,[[0,6,'door'],[ 12,5,'glass',0.95,4.35]]],
    [    0,-17.5,43,[[0,7,'door']]],
    [ 53.5,-17.5,46,[[0,6,'door'],[ 15,5,'glass',0.95,4.35]]],
    [-53.5, 17.5,46,[[0,6,'door'],[-12,5,'glass',0.95,4.35]]],
    [    0, 17.5,43,[[0,7,'door']]],
    [ 53.5, 17.5,46,[[0,6,'door'],[ 13,5,'glass',0.95,4.35]]],
    [-53.5, 26.5,46,[[0,7,'door'],[-15,6,'glass',0.95,4.35]]],
    [    0, 26.5,43,[[0,7,'door']]],
    [ 53.5, 26.5,46,[[0,7,'door'],[ 15,6,'glass',0.95,4.35]]]
  ];
  for(i=0;i<HW.length;i++)labWallRun(HW[i][0],HW[i][1],HW[i][2],'x',HW[i][3]);

  /* ---------- 九个房间的门口导航登记（AI 进房间要靠它） ---------- */
  for(i=0;i<LAB_DOOR_SIDES.length;i++){
    var R=LAB_DOOR_SIDES[i];
    infoPush('roofs',{cx:R.cx,cz:R.cz,w:R.w,d:R.d});
    infoPush('doors',{side:R.side,x:R.cx,z:R.cz,w:6});
  }

  /* ---------- 西·北：培养舱区 ---------- */
  for(i=0;i<3;i++)for(j=0;j<2;j++) labTank(-66+i*13, -58+j*20, 1.5, 3.6, (i+j)%2?0x49e0ff:0x6effb0);
  labPipeRun(-53.5,-47,38,'x',0.28); labPipeRun(-53.5,-40,38,'x',0.22);
  labLamp(-64,-58,5,1.4); labLamp(-42,-58,5,1.4); labLamp(-64,-38,5,1.4); labLamp(-42,-38,5,1.4);

  /* ---------- 西·中：冷库（机柜阵） ---------- */
  for(i=0;i<4;i++)for(j=0;j<3;j++) labRack(-68+i*11, -10+j*10);
  labLamp(-53.5,0,7,1.6);
  labPipeRun(-53.5,-14,40,'x',0.26); labPipeRun(-53.5,14,40,'x',0.26);

  /* ---------- 西·南：电梯大厅（剧情第二章的固定出生点） ---------- */
  labElevator(-73,52);
  for(i=0;i<5;i++) labConsole(-44+i*7, 62, 2.4, 1.5);
  for(i=0;i<3;i++) labPillar(-66+i*11,34);
  labLamp(-56,52,8,1.8); labLamp(-40,44,5,1.4); labLamp(-70,62,5,1.4);
  labPipeRun(-53.5,47,40,'x',0.3);

  /* ---------- 中·北：服务器机房 ---------- */
  for(i=0;i<2;i++)for(j=0;j<4;j++) labRack(-12+i*24, -60+j*9);
  labConsole(0,-30,3.0,1.6);
  labLamp(0,-47,8,1.8); labLamp(-12,-60,5,1.2); labLamp(12,-60,5,1.2);
  labPipeRun(0,-47,38,'z',0.3); labPipeRun(-6,-47,38,'z',0.22);

  /* ---------- 中·中：中央控制大厅 ---------- */
  var hol=new THREE.Mesh(new THREE.CylinderGeometry(1.7,2.2,1.1,20), labGlowMat(0x2ad6ff));
  hol.position.set(0,0.55,0); _mapTarget.add(hol);
  var holRing=new THREE.Mesh(new THREE.TorusGeometry(2.6,0.12,8,28), labGlowMat(0x9ff0ff));
  holRing.rotation.x=Math.PI/2; holRing.position.set(0,0.06,0); _mapTarget.add(holRing);
  _obsTarget.push({cx:0,cz:0,w:3.4,d:3.4,h:1.1,kind:'terrain',minX:-1.7,maxX:1.7,minZ:-1.7,maxZ:1.7});
  for(i=0;i<4;i++){ labPillar(-16+((i%2)*32), -12+(((i/2)|0)*24)); }
  labLamp(0,0,10,1.8); labLamp(-14,-14,5,1.4); labLamp(14,14,5,1.4);
  labLamp(-14,14,5,1.4); labLamp(14,-14,5,1.4);
  labPipeRun(0,0,34,'z',0.3); labPipeRun(0,-6,34,'z',0.24);

  /* ---------- 中·南：实验台区 ---------- */
  for(i=0;i<3;i++)for(j=0;j<2;j++) labConsole(-14+i*14, 36+j*20, 4.0, 2.0);
  for(i=0;i<3;i++) labTank(-14+i*14, 58, 1.2, 2.9, 0xffd75e);
  labLamp(0,47,8,1.8); labLamp(0,58,6,1.4);
  labPipeRun(0,47,38,'z',0.28);

  /* ---------- 东·北：收容区（蚀日者就在这里） ---------- */
  labPod(LAB_RESCUE.x,LAB_RESCUE.z);
  for(i=0;i<4;i++) labTank(36+i*4.2, -60, 1.1, 3.0, 0xff8a3d);
  for(i=0;i<3;i++) labPillar(38+i*6, -36);
  labLamp(52,-46,9,2.0); labLamp(40,-62,5,1.4); labLamp(66,-34,5,1.4);
  labPipeRun(53.5,-47,40,'x',0.3);
  labBeacon(LAB_RESCUE.x,LAB_RESCUE.z);

  /* ---------- 东·中：观察室（玻璃隔断 + 桌椅） ---------- */
  for(i=0;i<3;i++) labConsole(40+i*12, -6, 3.2, 1.6);
  for(i=0;i<3;i++) labConsole(40+i*12, 6, 3.2, 1.6);
  labPillar(72,0,LAB_H);
  labLamp(53.5,0,9,1.8);
  labPipeRun(53.5,0,36,'x',0.28);

  /* ---------- 东·南：反应堆 ---------- */
  labReactor(53.5,47);
  for(i=0;i<2;i++) labRack(36+i*4.2, 62);
  for(i=0;i<2;i++) labRack(70, 30+i*4.2);
  labLamp(53.5,47,10,2.0); labLamp(38,62,5,1.2); labLamp(70,38,5,1.2);
  labPipeRun(53.5,47,40,'x',0.32); labPipeRun(53.5,40,40,'x',0.24);

  /* ---------- 走廊：顶灯 + 管道（把"地下通道"的感觉做出来） ---------- */
  for(i=0;i<4;i++){
    labLamp(LAB_VX[0], -58+i*36, 4.5, 1.2);
    labLamp(LAB_VX[1], -58+i*36, 4.5, 1.2);
    labLamp(-58+i*36, LAB_HZ[0], 1.2, 4.5);
    labLamp(-58+i*36, LAB_HZ[1], 1.2, 4.5);
  }
  labLamp(0,0,4.5,4.5);
  labPipeRun(LAB_VX[0],0,132,'z',0.3); labPipeRun(LAB_VX[1],0,132,'z',0.3);
  labPipeRun(0,LAB_HZ[0],152,'x',0.3); labPipeRun(0,LAB_HZ[1],152,'x',0.3);

  /* ---------- 照明：半球天光（冷）+ 大厅点光 ---------- */
  if(THREE.HemisphereLight) _mapTarget.add(new THREE.HemisphereLight(0x9fc8ff,0x141a22,0.24));   // 【batch189】0.42→0.24：主光改由全局 LIGHT.sun 提供，这里只留冷色氛围
  var pl=new THREE.PointLight(0x9fe4ff,0.9,60); pl.position.set(0,4.4,0); _mapTarget.add(pl);
  var pl2=new THREE.PointLight(0xffb070,0.7,45); pl2.position.set(LAB_RESCUE.x,3.4,LAB_RESCUE.z); _mapTarget.add(pl2);
}