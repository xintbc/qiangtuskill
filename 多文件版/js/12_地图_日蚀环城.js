/* ==================== 新地图：日蚀环城 ====================
   batch111 立骨架 / batch112 盖楼 / batch114 按反馈重做成「有阳光的小镇」。
   用户反馈 → 对策：
     ① 天上没有日食   → buildEclipseSky()：天穹渐变 + 日轮 + 月盘 + 日冕环（都在图组里，切图即消失）
     ② 地上没有阳光   → buildEclipseSun()：半球天光 + 暖色平行光（带阴影）+ 暖色地面 + 雾调淡
     ③ 围墙像竞技场   → buildRidgeWall()：还是沿椭圆取点（碰撞仍 kind='border'，永远挡，48 方向探针逐个验），
                         但高度做成 15~32 米起伏的山峰、贴图换成岩石；山脚再散大石头、种树、立木栅栏
     ④ 房子没屋顶     → 民房＝双坡瓦顶＋山墙；楼房＝平顶＋女儿墙＋水箱
     ⑤⑥ 地图/房子小   → 场地 68×58 → 104×88；民房 9×7 → 15×12；楼房 18×16 → 22~24 × 16~17
     ⑦ 布局不像真的   → 纵街＋横街在镇中心十字交汇，沿街人行道、成排楼房（门朝街）、
                         一楼二楼都开窗、屋里摆家具 —— 不再是"到处随手丢几个盒子"
   【碰撞口径不变】addBox / addLedge → _obsTarget；边界一律 kind='border'，其余 kind='terrain'。 */
var MAP_INFO={};                      // 每张图的「地标」（探针读它，不写死坐标）
var _infoTarget=null;                 // 当前地标收集目标（setMap 里跟着 _mapTarget 一起换）
var _blockedRects=[];                 // 建图期间登记的建筑/道路占位（装饰物别插进屋里）
/* 【batch115b】以前是 `if(_infoTarget&&_infoTarget[k])...push(v)` —— 键没预先开好就**静默丢掉**，
   调用方完全看不出来（batch115 的 oval 地标就这么丢了一次）。改成自动建键。 */
function infoPush(k,v){ if(!_infoTarget)return v; if(!_infoTarget[k])_infoTarget[k]=[]; _infoTarget[k].push(v); return v; }
function childCount(){ try{return _mapTarget.children.length;}catch(e){return 0;} }
/* 给「刚从 _mapTarget 长出来的那批网格」开阴影。只给建筑 / 山体 / 树这种大件用，
   小家具不开（省一趟投影绘制）。为什么用"下标区间"而不是 userData：沙箱里 Group.children 是空数组，
   这样写不报错；真机上是真数组，照常生效。 */
function shadowFrom(from,on){
  try{
    var ch=_mapTarget.children;
    for(var i=from;i<ch.length;i++){ var m=ch[i]; if(m){ m.castShadow=!!on; m.receiveShadow=!!on; } }
  }catch(e){}
}
/* ==================== 【batch131】建筑门口导航 ====================
   AI 只会"朝目标直线冲 + 沿墙滑"，门开在侧面时它就贴在外墙上进不去（用户报的"小兵进不了房子"）。
   这里在建图之后把每张图的「门的世界坐标 + 建筑矩形」预算好：
   AI 与玩家不在同一栋楼、又看不见玩家时，就把**最近的门口**当成"最后见到他的地方"走过去。
   —— 复用 AI 本来就有的 search 状态（它会朝 lastSeen 走），不新增寻路算法，风险最低。 */
var MAP_NAV={};
var _navBuiltFor={};
function buildNavFor(id){
  var info=MAP_INFO[id];
  MAP_NAV[id]=[];
  if(!info||!info.doors||!info.roofs)return;
  for(var i=0;i<info.doors.length;i++){
    var d=info.doors[i],r=null;
    for(var j=0;j<info.roofs.length;j++){
      var rr=info.roofs[j];
      if(Math.abs(rr.cx-d.x)<0.01&&Math.abs(rr.cz-d.z)<0.01){r=rr;break;}
    }
    if(!r)continue;
    var px=d.x,pz=d.z,nx=0,nz=0;
    if(d.side==='S'){pz=d.z+r.d/2;nz=1;} else if(d.side==='N'){pz=d.z-r.d/2;nz=-1;}
    else if(d.side==='E'){px=d.x+r.w/2;nx=1;} else {px=d.x-r.w/2;nx=-1;}
    /* ix/iz ＝ 门**内侧** 2.4 米处（屋里）。导航目标用它而不是门槛本身：
       原来目标是门槛，AI 走到门口就被判定"到了"→ 转回 patrol，正好差一步没迈进去。 */
    MAP_NAV[id].push({x:px,z:pz,nx:nx,nz:nz,ix:px-nx*2.4,iz:pz-nz*2.4,
                      cx:d.x,cz:d.z,w:r.w,d:r.d,side:d.side});
  }
}
/* 这个点在哪栋楼里？（没在楼里返回 -1） */
function navBuildingAt(id,x,z){
  var L=MAP_NAV[id];if(!L)return -1;
  for(var i=0;i<L.length;i++){
    var b=L[i];
    if(Math.abs(x-b.cx)<b.w/2-0.35&&Math.abs(z-b.cz)<b.d/2-0.35)return i;
  }
  return -1;
}
/* 同一栋楼里离 (x,z) 最近的那扇门 */
function navNearestDoor(id,bi,x,z){
  var L=MAP_NAV[id];if(!L||bi<0||bi>=L.length)return null;
  var b=L[bi],best=null,bd=1e9;
  for(var i=0;i<L.length;i++){
    var o=L[i];
    if(o.cx!==b.cx||o.cz!==b.cz)continue;
    var dd=(o.x-x)*(o.x-x)+(o.z-z)*(o.z-z);
    if(dd<bd){bd=dd;best=o;}
  }
  return best;
}
function rectAdd(cx,cz,w,d){ _blockedRects.push([cx-w/2-2.0,cx+w/2+2.0,cz-d/2-2.0,cz+d/2+2.0]); }
function rectFree(x,z){ for(var i=0;i<_blockedRects.length;i++){var r=_blockedRects[i]; if(x>r[0]&&x<r[1]&&z>r[2]&&z<r[3])return false;} return true; }

/* ---------------- 这张图专属的程序化贴图 ---------------- */
/* 【batch123】原来的 skyTexDraw（天穹渐变）已并入下面的 skyEclipseDraw：整幅日食一张贴图。 */
function rockTexDraw(g,S){         // 山体 / 巨石：花岗岩
  g.fillStyle='#5a5f66';g.fillRect(0,0,S,S);
  for(var i=0;i<80;i++){
    var x=Math.random()*S,y=Math.random()*S,r=10+Math.random()*34,v=(Math.random()*44-22)|0;
    g.fillStyle='rgba('+(99+v)+','+(104+v)+','+(110+v)+',0.7)';
    g.beginPath();g.arc(x,y,r,0,6.2832);g.fill();
  }
  g.strokeStyle='rgba(0,0,0,0.22)';g.lineWidth=2;
  for(var k=0;k<30;k++){var a=Math.random()*S,b=Math.random()*S;g.beginPath();g.moveTo(a,b);g.lineTo(a+(Math.random()*70-35),b+(Math.random()*70-35));g.stroke();}
}
function roofTexDraw(g,S){         // 屋顶：一排排红瓦
  g.fillStyle='#5d3129';g.fillRect(0,0,S,S);
  var rows=8,rh=S/rows,cw=S/8,r,c;
  for(r=0;r<rows;r++)for(c=-1;c<9;c++){
    var x=c*cw+(r%2?cw*0.5:0),y=r*rh,v=(Math.random()*30-15)|0;
    g.fillStyle='rgb('+(146+v)+','+(70+v)+','+(56+v)+')';g.fillRect(x+1,y+1,cw-2,rh-2);
  }
  g.fillStyle='rgba(0,0,0,0.20)';
  for(r=0;r<=rows;r++)g.fillRect(0,r*rh-1,S,2);
}
function plasterTexDraw(g,S){      // 外墙：米白抹灰
  g.fillStyle='#c4b49b';g.fillRect(0,0,S,S);
  for(var k=0;k<900;k++){var v=(Math.random()*22-11)|0;g.fillStyle='rgba('+(198+v)+','+(182+v)+','+(158+v)+',0.5)';g.fillRect(Math.random()*S,Math.random()*S,3,3);}
}
function woodTexDraw(g,S){         // 木材：树干 / 家具 / 栅栏
  g.fillStyle='#5f4229';g.fillRect(0,0,S,S);
  for(var r=0;r<6;r++){var y=r*S/6,v=(Math.random()*26-13)|0;g.fillStyle='rgb('+(118+v)+','+(82+v)+','+(52+v)+')';g.fillRect(0,y+2,S,S/6-4);}
  g.strokeStyle='rgba(0,0,0,0.18)';g.lineWidth=2;
  for(var r2=0;r2<=6;r2++){g.beginPath();g.moveTo(0,r2*S/6);g.lineTo(S,r2*S/6);g.stroke();}
}
function roadTexDraw(g,S){         // 沥青路面
  g.fillStyle='#3a3d43';g.fillRect(0,0,S,S);
  for(var k=0;k<1600;k++){var v=(Math.random()*32-16)|0;g.fillStyle='rgba('+(74+v)+','+(77+v)+','+(81+v)+',0.5)';g.fillRect(Math.random()*S,Math.random()*S,2,2);}
}
function walkTexDraw(g,S){         // 人行道地砖
  g.fillStyle='#8b8982';g.fillRect(0,0,S,S);
  g.strokeStyle='rgba(0,0,0,0.22)';g.lineWidth=3;
  for(var i=0;i<=4;i++){
    g.beginPath();g.moveTo(i*S/4,0);g.lineTo(i*S/4,S);g.stroke();
    g.beginPath();g.moveTo(0,i*S/4);g.lineTo(S,i*S/4);g.stroke();
  }
}
/* 【batch123】原来的 sunTexDraw（日轮）/ coronaTexDraw（日冕）已并入 skyEclipseDraw。 */
var _matCache={};
function matOf(key,draw,color){
  if(_matCache[key])return _matCache[key];
  _matCache[key]=new THREE.MeshLambertMaterial({map:_mkTex(key,draw),color:(color===undefined?0xffffff:color)});
  return _matCache[key];
}
var _floorMat=null,_stepMat=null,_leafMat=null,_glassMat=null;
function floorMat(){ if(!_floorMat)_floorMat=new THREE.MeshLambertMaterial({color:0x6d5c46}); return _floorMat; }   // 木楼板
function stepMat(){ if(!_stepMat)_stepMat=new THREE.MeshLambertMaterial({color:0x7c8290}); return _stepMat; }       // 石头台阶
function leafMat(){ if(!_leafMat)_leafMat=new THREE.MeshLambertMaterial({color:0x3f6b3a}); return _leafMat; }       // 树冠
function glassMat(){ if(!_glassMat)_glassMat=new THREE.MeshLambertMaterial({color:0x9fc2d8,transparent:true,opacity:0.55,side:THREE.DoubleSide,depthWrite:false}); return _glassMat; }

/* ---------------- 场地：椭圆 + 内部判定 ---------------- */
var OVA_A=104, OVA_B=88, OVA_BUMP=0.16;         // 场地放大到 104 × 88（原来 68 × 58）
function ovalPoint(t,a,b,bump){                 // t∈[0,2π)，返回边界点（含东北方向的外凸）
  var x=a*Math.cos(t), z=b*Math.sin(t);
  var k=bump?Math.exp(-Math.pow((t-0.35*Math.PI)/0.42,2))*bump:0;
  return [x*(1+k), z*(1+k)];
}
function inOval(x,z,m){                          // (x,z) 是否在椭圆内、且离边至少 m 米
  m=m||0; var a=OVA_A-m, b=OVA_B-m;
  return a>0&&b>0&&(x*x)/(a*a)+(z*z)/(b*b)<=1;
}
/* 椭圆地面：把边界点连成一个真·椭圆多边形（墙外不铺地 = 悬在场上的小镇）。
   【朝向注意】ShapeGeometry 建在 XY 平面，绕 X 转 -90° 后 shape 的 +y 会落到 -z，
   所以喂进去的 y 要取 -z，转过来才和碰撞体（按世界 z 建）对得上。 */
function makeOvalGround(group,color,a,b,bump,scale){
  var pts=[],N=96,i,t,p;
  for(i=0;i<N;i++){ t=i/N*Math.PI*2; p=ovalPoint(t,a,b,bump); pts.push(new THREE.Vector2(p[0]*scale,-p[1]*scale)); }
  var m=new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)),new THREE.MeshLambertMaterial({color:color}));
  m.rotation.x=-Math.PI/2; m.position.y=0.01; group.add(m);
  return m;
}
/* 地面贴图：ShapeGeometry 的 UV 就是顶点坐标（±100 米左右），所以 repeat 取 1/2.5＝0.4
   → 每 2.5 米一格，和经典图的地面网格完全一致。颜色换成"被太阳晒过的土色"。 */
function applyGroundTexOval(m){
  if(!m||!m.material)return m;
  var t=_mkTex('groundWarm',function(g,S){
    g.fillStyle='#8c8064';g.fillRect(0,0,S,S);
    g.strokeStyle='#9a8f72';g.lineWidth=2;
    g.beginPath();g.moveTo(0,1);g.lineTo(S,1);g.moveTo(1,0);g.lineTo(1,S);g.stroke();
  });
  t.repeat.set(0.4,0.4); t.wrapS=t.wrapT=THREE.RepeatWrapping;
  m.material.map=t; m.material.color.setHex(0xffffff); m.material.needsUpdate=true;
  m.receiveShadow=true;                       // 阳光能在地面上投出影子
  return m;
}

/* ---------------- 边界：一圈起伏的山体（不是钢板墙了）----------------
   取点方式完全沿用原来的椭圆墙：每 5 米一段、内表面贴着椭圆 —— 所以「48 方向都撞得到、
   围墙不往场内拱」这些性质一个不少（t_map.js 的 E 段逐个验）。区别只有两点：
     · 高度按角度做两个正弦叠加 → 15~32 米连绵山峰，不再是方方正正的 16 米板；
     · 贴图换成花岗岩。碰撞仍是 kind='border' → 永远挡，跳多高也翻不出去。 */
function buildRidgeWall(a,b,bump,th){
  var step=5,x0,x1,t0,t1,zu0,zu1,zl0,zl1,cx,cz,w,d,h,mat=matOf('rock',rockTexDraw);
  function ang(x){ return Math.acos(Math.max(-1,Math.min(1,x/a))); }
  function peak(tt){ return 16+11*Math.abs(Math.sin(tt*2.7+0.6))+6*Math.abs(Math.sin(tt*6.1+1.9)); }
  for(x0=-a;x0<a-1e-6;x0+=step){
    x1=Math.min(x0+step,a);
    t0=ang(x0); t1=ang(x1);
    zu0=ovalPoint(t0,a,b,bump)[1]; zu1=ovalPoint(t1,a,b,bump)[1];   // 北半圈：带东北角外凸
    /* 【batch115c】南半圈**不能**直接拿北半圈的 z 取负镜像：
       那个外凸是"东北角"专属的（bump 是个只挂在 t≈0.35π 上的窄高斯），
       镜像过去会在西南角凭空多出一个包 —— 于是南边比椭圆边界往外凸十来米，
       而且和 makeOvalGround() 铺的地面（那里按纯椭圆算，k≈0）对不齐、墙脚悬在地面外。
       t_map.js 的"撞墙距离"就是这么被误报的（4.97 rad: 98.5 vs 边界 88.8）。
       所以下半圈按纯椭圆算：z = b·sin(t)。 */
    zl0=b*Math.sin(t0); zl1=b*Math.sin(t1);
    cx=(x0+x1)/2; w=(x1-x0)+0.10;
    h=peak(ang(cx));
    var s0=childCount();
    /* 上下各自算：内表面（朝场地那一面）刚好贴住各自的边界，方块一律往场地**外**再加 th 厚
       （上：cz+d/2 = max(z)；下：cz-d/2 = -max(|z|)） */
    cz=(zu0+zu1)/2+th/2;                d=Math.abs(zu1-zu0)+th;
    addBox(cx, cz, w, h, d, mat, 'border');           // 北半圈（含东北方向的外凸）
    cz=-(zl0+zl1)/2-th/2;               d=Math.abs(zl1-zl0)+th;
    addBox(cx, cz, w, h+1.6, d, mat, 'border');       // 南半圈（纯椭圆，高度略不同 → 山脊更自然）
    shadowFrom(s0,true);
  }
  return true;
}

/* ---------------- 天空：日食 ----------------
   【batch190】整段重做。原来是「天穹渐变 + 日食」全画进同一张 256×256 贴图里，再贴到
   24×16 分段的球面上 —— 两处都糊：
     ① 贴图只有 256：日轮在贴图上直径才 25 像素（横向）/ 40 像素（纵向），
        月牙、色球边、日冕环全挤在 1~2 个像素里，放大看就是一团发光的糊块；
     ② 球面一段 15°，日轮只压在 3~4 个四边形上，边缘直接折成多边形。
   现在拆成两件东西：
     · 天穹 —— 只管渐变（1024 贴图 + 48×32 分段 + 色带抖动）；
     · 蚀日 —— 单独一张 1024×1024 透明贴图的 Sprite：永远正对镜头（怎么转头都是正圆，
       不会被球面纬度拉扁），位置每帧跟着相机、固定在同一个方位角上 ——
       等效于「无穷远天体」：走动没有透视位移，大小恒定，抬头低头都稳定。
   光照方向仍由 SKY_SUN_U/V 反推（sunDirFromUV），太阳在哪光就在哪，不会打架。 */
var SKY_R=135;
var SKY_SUN_U=0.62, SKY_SUN_V=0.30;      // 太阳在天空中的方位（u＝横向一圈，v＝纵向半圈；0＝天顶）
function sunDirFromUV(u,v){              // 由贴图坐标反推世界方向（与 SphereGeometry 的 uv 同源）
  var th=v*Math.PI, ph=u*Math.PI*2;
  return new THREE.Vector3(-Math.cos(ph)*Math.sin(th), Math.cos(th), Math.sin(ph)*Math.sin(th));
}

/* ---- 蚀日那张贴图的几何口径（改这几个数就能整体缩放，视半径不变） ---- */
var ECL_DISC_RAD=0.246;                  // 日轮视半径（弧度）——沿用 batch123 的口径，看起来大小和以前一致
var ECL_TEX_RAD=0.62;                    // 贴图半宽覆盖的弧度（要包住最外层日冕）
var ECL_DIST=105;                        // Sprite 挂多远（< 天穹 135，< 相机远平面 300）
var ECL_SIZE=0;                          // Sprite 世界边长（buildEclipseSky 里算）
var ECL_SPRITE=null, ECL_DIR=null;
function _seedRand(n){ var s=(n>>>0)||1; return function(){ s=(s*1664525+1013904223)>>>0; return s/4294967296; }; }

/* 天穹：只有渐变。等距柱状投影，v=0 是天顶、v=1 是天底。
   最后一层是全图级别的 ±2 级抖动噪点 —— 8 位色深下几百像素的平滑渐变会出明显色带
   （地平线上那几圈"台阶"就是这么来的），加抖动是标准解法。 */
function skyEclipseDraw(g,S){
  var gr=g.createLinearGradient(0,0,0,S);
  gr.addColorStop(0.00,'#16233d');gr.addColorStop(0.26,'#33507a');
  gr.addColorStop(0.44,'#8ea9c4');gr.addColorStop(0.50,'#e9c99b');
  gr.addColorStop(0.53,'#8a7f68');gr.addColorStop(0.64,'#6b6653');
  gr.addColorStop(1.00,'#4a4638');
  g.fillStyle=gr;g.fillRect(0,0,S,S);
  /* 太阳那一侧的地平线暖光（等距柱状图横向会被 sin 拉宽 → 先压扁再画圆，落回天上才是圆的） */
  try{
    var hx=SKY_SUN_U*S;
    g.save();
    g.translate(hx,S*0.50); g.scale(1,0.40);
    var hg=g.createRadialGradient(0,0,0,0,0,S*0.44);
    hg.addColorStop(0.00,'rgba(255,214,150,0.22)');
    hg.addColorStop(0.42,'rgba(255,190,120,0.09)');
    hg.addColorStop(1.00,'rgba(255,180,110,0)');
    g.fillStyle=hg; g.beginPath(); g.arc(0,0,S*0.44,0,6.2832); g.fill();
    g.restore();
  }catch(e){}
  /* 色带抖动：逐像素 ±2 级（1024² 一次性，几十毫秒，只在建图时跑一次） */
  try{
    var img=g.getImageData(0,0,S,S), d=img.data, rnd=_seedRand(20261018);
    for(var i=0;i<d.length;i+=4){
      var n=(rnd()*2-1)*2.0;
      d[i]=Math.max(0,Math.min(255,d[i]+n));
      d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));
      d[i+2]=Math.max(0,Math.min(255,d[i+2]+n));
    }
    g.putImageData(img,0,0);
  }catch(e){}
}

/* 蚀日：一张 1024 的正方形透明贴图，由外到内八层。
   全部走默认的 source-over（**不用 'lighter'**）：canvas 的 'lighter' 会连 alpha 一起相加，
   传到 three 里（纹理是"非预乘"口径）整体会发暗，光晕那几层就白画了。 */
function eclipseDiscDraw(g,S){
  var cx=S/2, cy=S/2, R=S/2;
  var k=R/ECL_TEX_RAD, RR=ECL_DISC_RAD*k;      // k＝每弧度多少像素；RR＝日轮半径（像素）
  var rnd=_seedRand(20261018);
  var MAXR=R*0.93;                             // 所有绘制都不许碰到贴图边缘：顶到边就没抗锯齿，会切出一道硬圆边
  function disc(r,ox,oy,fill){ g.beginPath(); g.arc(cx+ox,cy+oy,r,0,6.2832); g.fillStyle=fill; g.fill(); }
  g.clearRect(0,0,S,S);

  /* ① 最外层散射：极淡、极快衰减。上一版这里给了 0.22 的浓橙，整片糊成一张"橙饼"，
     日冕的层次全被压平了 —— 真实的日冕其实很薄，出彩的是贴边那一圈和内层的放射丝。 */
  var halo=g.createRadialGradient(cx,cy,RR*1.02,cx,cy,MAXR);
  halo.addColorStop(0.00,'rgba(255,206,158,0.20)');
  halo.addColorStop(0.20,'rgba(255,192,140,0.105)');
  halo.addColorStop(0.48,'rgba(255,176,124,0.030)');
  halo.addColorStop(0.76,'rgba(252,162,110,0.006)');
  halo.addColorStop(1.00,'rgba(246,152,102,0)');
  disc(MAXR,0,0,halo);

  /* ② 贴边内冕：紧挨日轮那一圈最亮（整个日食最标志性的层次），向外 0.42R 掉干净 */
  var inn=g.createRadialGradient(cx,cy,RR*0.97,cx,cy,RR*1.45);
  inn.addColorStop(0.00,'rgba(255,254,250,0.92)');
  inn.addColorStop(0.20,'rgba(255,249,234,0.54)');
  inn.addColorStop(0.55,'rgba(255,236,204,0.15)');
  inn.addColorStop(1.00,'rgba(255,220,178,0)');
  disc(RR*1.45,0,0,inn);

  /* ③ 日冕射线（内层）：60 根细丝，必须画在②之后 —— 上一版画在内冕下面，
     被那圈 0.86 alpha 的白环整个盖掉了，所以怎么调都看不见。 */
  for(var i=0;i<60;i++){
    var a=rnd()*Math.PI*2;
    var len=RR*(1.24+rnd()*rnd()*0.92);
    var half=Math.max(1.7,RR*(0.009+rnd()*0.022));
    var da=half/RR;
    var al=0.34+rnd()*0.40;
    var x0=cx+Math.cos(a)*RR*0.98, y0=cy+Math.sin(a)*RR*0.98;
    var x1=cx+Math.cos(a)*len,    y1=cy+Math.sin(a)*len;
    var lg=g.createLinearGradient(x0,y0,x1,y1);
    lg.addColorStop(0.00,'rgba(255,252,242,'+al.toFixed(3)+')');
    lg.addColorStop(0.20,'rgba(255,240,214,'+(al*0.66).toFixed(3)+')');
    lg.addColorStop(0.60,'rgba(255,220,176,'+(al*0.22).toFixed(3)+')');
    lg.addColorStop(1.00,'rgba(255,204,158,0)');
    g.beginPath();
    g.moveTo(cx+Math.cos(a-da)*RR*0.98, cy+Math.sin(a-da)*RR*0.98);
    g.lineTo(cx+Math.cos(a+da)*RR*0.98, cy+Math.sin(a+da)*RR*0.98);
    g.lineTo(x1,y1);
    g.closePath(); g.fillStyle=lg; g.fill();
  }

  /* ④ 外冕长丝：20 根又宽又淡、拖到 2.2R 的长条 —— 日全食照片里最外那层"羽毛"就是它，
     少了这一层，日轮看起来就像贴了个橙边黑圆片。 */
  for(var j=0;j<20;j++){
    var a2=rnd()*Math.PI*2;
    var len2=RR*(1.50+rnd()*0.72);
    var half2=Math.max(3.2,RR*(0.030+rnd()*0.032));
    var da2=half2/RR;
    var al2=0.18+rnd()*0.16;
    var x2=cx+Math.cos(a2)*len2, y2=cy+Math.sin(a2)*len2;
    var lg2=g.createLinearGradient(cx,cy,x2,y2);
    lg2.addColorStop(0.00,'rgba(255,246,228,'+al2.toFixed(3)+')');
    lg2.addColorStop(0.42,'rgba(255,232,198,'+(al2*0.55).toFixed(3)+')');
    lg2.addColorStop(1.00,'rgba(255,214,170,0)');
    g.beginPath();
    g.moveTo(cx+Math.cos(a2-da2)*RR*0.98, cy+Math.sin(a2-da2)*RR*0.98);
    g.lineTo(cx+Math.cos(a2+da2)*RR*0.98, cy+Math.sin(a2+da2)*RR*0.98);
    g.lineTo(x2,y2);
    g.closePath(); g.fillStyle=lg2; g.fill();
  }

  /* ⑤ 日珥：露光那一侧边缘往外拱的几小团火焰 */
  var mox=RR*0.115, moy=RR*0.074;              // 月盘偏移（右下）
  var mrr=RR*0.960;                            // 月盘半径：比日轮小 2.5% + 偏移 → 左上留出约 0.15R 的金色月牙
  var ba=Math.atan2(-moy,-mox);                // 露光方向（左上）
  for(var p=0;p<4;p++){
    var pa=ba+(p-1.5)*0.17+(rnd()-0.5)*0.06;
    var pl=RR*(0.050+rnd()*0.065), pw=RR*(0.026+rnd()*0.024);
    var px=cx+Math.cos(pa)*RR*1.002, py=cy+Math.sin(pa)*RR*1.002;
    var pg=g.createRadialGradient(px,py,0,px,py,pl*1.5);
    pg.addColorStop(0,'rgba(255,146,98,0.66)');
    pg.addColorStop(0.42,'rgba(255,102,64,0.28)');
    pg.addColorStop(1,'rgba(255,74,44,0)');
    g.beginPath(); g.ellipse(px,py,pl,pw,pa+Math.PI/2,0,6.2832); g.fillStyle=pg; g.fill();
  }

  /* ⑥ 色球层：日轮最外那一圈暗红细边（月盘盖不满，会露出来一点点） */
  g.beginPath(); g.arc(cx,cy,RR*1.003,0,6.2832);
  g.lineWidth=Math.max(1.2,RR*0.014); g.strokeStyle='rgba(255,108,74,0.62)'; g.stroke();

  /* ⑦ 日轮本体：中心近白、边缘压到暖金（临边昏暗） */
  var body=g.createRadialGradient(cx-RR*0.18,cy-RR*0.18,RR*0.08,cx,cy,RR);
  body.addColorStop(0.00,'#fffefa');
  body.addColorStop(0.40,'#fff9df');
  body.addColorStop(0.72,'#ffeab4');
  body.addColorStop(0.92,'#ffd693');
  body.addColorStop(1.00,'#ffb768');
  disc(RR,0,0,body);

  /* ⑧ 月盘：纯黑剪影（带一点极暗的球面明暗，免得像贴了张纯黑圆片） */
  var mg=g.createRadialGradient(cx+mox-RR*0.24,cy+moy-RR*0.24,RR*0.10,cx+mox,cy+moy,mrr);
  mg.addColorStop(0.00,'#0a0c14');
  mg.addColorStop(0.66,'#06080e');
  mg.addColorStop(1.00,'#0c1018');
  disc(mrr,mox,moy,mg);

  /* ⑨ 钻石环：露光点上的强星光 + 四道光芒（沿露光方向最长，竖直方向短） */
  var bx=cx+mox+Math.cos(ba)*mrr, by=cy+moy+Math.sin(ba)*mrr;
  var bg=g.createRadialGradient(bx,by,0,bx,by,RR*0.34);
  bg.addColorStop(0.00,'rgba(255,255,252,0.98)');
  bg.addColorStop(0.10,'rgba(255,249,224,0.76)');
  bg.addColorStop(0.30,'rgba(255,230,172,0.26)');
  bg.addColorStop(1.00,'rgba(255,210,144,0)');
  disc(RR*0.34,bx-cx,by-cy,bg);
  function ray(ang,len,wid,al){
    var ex=bx+Math.cos(ang)*len, ey=by+Math.sin(ang)*len;
    var lg=g.createLinearGradient(bx,by,ex,ey);
    lg.addColorStop(0.00,'rgba(255,255,248,'+al+')');
    lg.addColorStop(0.30,'rgba(255,244,210,'+(al*0.40).toFixed(3)+')');
    lg.addColorStop(1.00,'rgba(255,232,184,0)');
    var nx=Math.cos(ang+Math.PI/2)*wid, ny=Math.sin(ang+Math.PI/2)*wid;
    g.beginPath();
    g.moveTo(bx+nx,by+ny); g.lineTo(bx-nx,by-ny); g.lineTo(ex,ey);
    g.closePath(); g.fillStyle=lg; g.fill();
  }
  ray(ba,RR*0.88,RR*0.019,0.60);
  ray(ba+Math.PI,RR*0.48,RR*0.015,0.32);
  ray(ba+Math.PI/2,RR*0.36,RR*0.013,0.24);
  ray(ba-Math.PI/2,RR*0.30,RR*0.011,0.18);

  /* ⑩ 抖动：radialGradient 在 8 位色深下会出一圈圈同心色带（日冕这种大面积渐变最明显，
     上一版就是被这个毁的）。逐像素 ±2 级抖动是标准解法，顺带让暗部有一点胶片颗粒。 */
  try{
    var img=g.getImageData(0,0,S,S), d=img.data;
    for(var q=0;q<d.length;q+=4){
      if(d[q+3]===0)continue;
      var nz=(rnd()*2-1)*1.9;
      d[q]=Math.max(0,Math.min(255,d[q]+nz));
      d[q+1]=Math.max(0,Math.min(255,d[q+1]+nz));
      d[q+2]=Math.max(0,Math.min(255,d[q+2]+nz));
      d[q+3]=Math.max(0,Math.min(255,d[q+3]+(rnd()*2-1)*1.3));
    }
    g.putImageData(img,0,0);
  }catch(e){}
}

function buildEclipseSky(){
  var sky=new THREE.Group();
  /* 天穹：opaque + renderOrder=-2 + depthWrite=false —— 最先画、不写深度，
     后面的地面/山/房子照常盖在它上面（相机远平面 300，135 米肯定画得到）。
     分段从 24×16 提到 48×32：渐变本身不怕少几段，但地平线那一带太稀会看出折线。 */
  var dome=new THREE.Mesh(new THREE.SphereGeometry(SKY_R,48,32),
    new THREE.MeshBasicMaterial({map:_mkTex('skyEclipse',skyEclipseDraw,1024),side:THREE.BackSide,fog:false,depthWrite:false}));
  dome.renderOrder=-2;
  dome.userData._光影=true;                    // 天穹不参与投影/收影
  sky.add(dome);

  /* 蚀日：单独一个 Sprite。NormalBlending 是硬要求 —— 用 Additive 的话黑色月盘会被加没，
     整轮太阳只剩一团光晕，就看不见"蚀"了。depthWrite=false 保证不和后画的地面抢深度；
     depthTest 保持 true：站在屋里抬头，屋顶照样能挡住太阳。 */
  try{
    ECL_SIZE=2*ECL_DIST*Math.tan(ECL_DISC_RAD)*ECL_TEX_RAD/(2*ECL_DISC_RAD);
    var mat=new THREE.SpriteMaterial({map:_mkTex('eclipseDisc',eclipseDiscDraw,1024),transparent:true,depthWrite:false,depthTest:true,fog:false,color:0xffffff});
    var sp=new THREE.Sprite(mat);
    sp.scale.set(ECL_SIZE,ECL_SIZE,1);
    sp.renderOrder=-1;
    ECL_SPRITE=sp;
    ECL_DIR=sunDirFromUV(SKY_SUN_U,SKY_SUN_V).normalize();
    sky.add(sp);
    try{ eclipseSkyTick(); }catch(e){}
  }catch(e){ ECL_SPRITE=null; }

  _mapTarget.add(sky);
  return sky;
}
/* 每帧把蚀日摆到相机上方那个方位（主循环里调；不在日蚀图时直接跳过）。
   只用相机的 x/z、y 固定在天上 —— 跳起来太阳不会跟着一上一下。 */
function eclipseSkyTick(){
  var sp=ECL_SPRITE;
  if(!sp||!ECL_DIR)return;
  try{
    if(typeof MAP_GROUP!=='undefined'&&MAP_GROUP.eclipse&&MAP_GROUP.eclipse.visible===false)return;
    var cp=camera.position;
    sp.position.set(cp.x+ECL_DIR.x*ECL_DIST, ECL_DIR.y*ECL_DIST, cp.z+ECL_DIR.z*ECL_DIST);
  }catch(e){}
}

/* ---------------- 阳光：半球天光 + 暖色平行光（【batch123】不再开阴影）----------------
   用户反馈"光影算法太卡了"。这张图有 1100+ 个方块，开阴影＝每帧**多渲染一整趟**
   1100 个物体（还要 PCF 软阴影采样），是卡顿的主因 —— 也就是"一出生就动不了"的真凶：
   帧时间被拉到几百毫秒，按键当然像没反应。
   日食天本来就暗，地上的影子几乎看不出来，去掉对画面几乎没有损失，
   但每帧省下一整趟绘制。光的方向仍和贴图上那轮太阳对齐（sunDirFromUV），
   所以明暗关系没变。 */
function buildEclipseSun(){
  if(THREE.HemisphereLight) _mapTarget.add(new THREE.HemisphereLight(0xbcd6ff,0x6a5a45,0.26));   // 天光（上蓝下土）——【batch189】全局光接手主照明，这里只留氛围，避免和主光重复叠加过曝
  var sun=new THREE.DirectionalLight(0xfff0d2,0.42);                                              // 【batch189】1.05→0.42：主光是会跟人走的那盏 LIGHT.sun，这盏只补一点夕阳侧光
  var d=sunDirFromUV(SKY_SUN_U,SKY_SUN_V);       // 和天空贴图上那轮太阳同一个方向
  sun.position.set(d.x*260,d.y*260,d.z*260);
  sun.castShadow=false;
  _mapTarget.add(sun);
  if(sun.target){ sun.target.position.set(0,0,0); _mapTarget.add(sun.target); }
  return sun;
}

/* ---------------- 街道 / 人行道（纯视觉，不参与碰撞，所以地面仍然是平的）---------------- */
function scalePlaneUV(geo,w,d,unit){
  var uv=geo&&geo.attributes&&geo.attributes.uv; if(!uv)return;
  var n=uv.count|0;
  for(var i=0;i<n;i++){ uv.setXY(i, uv.getX(i)*w/unit, uv.getY(i)*d/unit); }
  uv.needsUpdate=true;
}
function buildPad(x,z,w,d,texKey,draw,unit,y){
  var geo=new THREE.PlaneGeometry(w,d); scalePlaneUV(geo,w,d,unit||16);
  var m=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({map:_mkTex(texKey,draw)}));
  m.rotation.x=-Math.PI/2; m.position.set(x,(y===undefined?0.03:y),z); _mapTarget.add(m);
  m.receiveShadow=true;
  rectAdd(x,z,w,d);
  return m;
}
/* 一条街 = 路面 + 两侧人行道。axis='z' 表示南北向的长街（沿 z 铺）。 */
function buildStreet(cx,cz,len,w,axis){
  if(axis==='z'){
    buildPad(cx,cz,w,len,'road',roadTexDraw,14,0.03);
    buildPad(cx-w/2-1.0,cz,2.0,len,'walk',walkTexDraw,4,0.05);
    buildPad(cx+w/2+1.0,cz,2.0,len,'walk',walkTexDraw,4,0.05);
  }else{
    buildPad(cx,cz,len,w,'road',roadTexDraw,14,0.03);
    buildPad(cx,cz-w/2-1.0,len,2.0,'walk',walkTexDraw,4,0.05);
    buildPad(cx,cz+w/2+1.0,len,2.0,'walk',walkTexDraw,4,0.05);
  }
}

/* ---------------- 通用楼梯 / 楼板 / 墙段 ---------------- */
/* 从 y0 起砌一段墙：y0=0 用 addBox（从地面长起），否则用 addLedge（悬空那层） */
function addBoxSeg(x,z,w,h,d,mat,y0){
  if(!y0) return addBox(x,z,w,h,d,mat);
  return addLedge(x,z,w,h,d,mat,'terrain',y0);
}
/* 一面墙的一个"高度带"：在 [y0,y1] 之间砌实心墙，并在 holes 处留洞。
   holes: [[中心偏移, 洞宽, 洞下沿, 洞上沿], ...]（偏移沿墙的走向：南北墙＝x，东西墙＝z） */
function buildWallBand(kind,cx,cz,W,D,T,y0,y1,holes,mat){
  var horiz=(kind==='N'||kind==='S'), len=horiz?W:D;
  var wx = kind==='W'? cx-W/2+T/2 : (kind==='E'? cx+W/2-T/2 : cx);
  var wz = kind==='N'? cz-D/2+T/2 : (kind==='S'? cz+D/2-T/2 : cz);
  var hs=(holes||[]).slice().sort(function(a,b){return a[0]-b[0];});
  var cur=-len/2;
  function seg(c0,c1,a,b){
    if(c1-c0<0.06||b-a<0.06)return;
    var c=(c0+c1)/2,w2=c1-c0,h2=b-a;
    if(horiz) addBoxSeg(wx+c,wz,w2,h2,T,mat,a);
    else      addBoxSeg(wx,wz+c,T,h2,w2,mat,a);
  }
  for(var i=0;i<hs.length;i++){
    var h0=hs[i][0]-hs[i][1]/2, h1=hs[i][0]+hs[i][1]/2;
    seg(cur,h0,y0,y1);                                   // 洞左边（下边）整段
    if(hs[i][2]>y0+0.06) seg(h0,h1,y0,hs[i][2]);         // 窗台以下的墙
    if(hs[i][3]<y1-0.06) seg(h0,h1,hs[i][3],y1);         // 过梁以上的墙
    cur=h1;
  }
  seg(cur,len/2,y0,y1);
}
/* 洞口补一块半透明玻璃（好看，且不挡视线/不挡人） */
function buildGlass(kind,cx,cz,W,D,T,off,w,y0,y1){
  var horiz=(kind==='N'||kind==='S');
  var wx = kind==='W'? cx-W/2+T/2 : (kind==='E'? cx+W/2-T/2 : cx);
  var wz = kind==='N'? cz-D/2+T/2 : (kind==='S'? cz+D/2-T/2 : cz);
  var geo=horiz?new THREE.BoxGeometry(w,y1-y0,0.08):new THREE.BoxGeometry(0.08,y1-y0,w);
  var m=new THREE.Mesh(geo,glassMat());
  m.position.set(horiz?wx+off:wx,(y0+y1)/2,horiz?wz:wz+off);
  _mapTarget.add(m);
  return m;
}

/* ---------------- 沿街楼房（两层）----------------
   opts.doorSide 'S'|'N'|'E'|'W' 门开在哪面（沿街的那面）
   opts.doorAt   门在墙面上的偏移；opts.doorW 门宽
   opts.winSide / opts.winAt / opts.winW  二楼那扇"能跳出去"的窗（默认北面）
   opts.interiors 一楼家具 [[dx,dz,w,h,d],...]；opts.upstairs 二楼家具（摆在楼板面上）
   结构：一楼墙砌到 F2；二楼墙用 addLedge 悬在 F2..TOP；楼板铺满内部只留一条楼梯口；
        楼梯贴着"门对面那面墙"一级级上去（每级 0.35 米 < 台阶容差 0.55 → 直接走上去）；
        屋顶＝平顶＋女儿墙＋水箱。 */
var WIN_SILL=0.30;                 // 【batch115】二楼逃生窗的窗台高度（米，相对二楼地面）：必须 < STEP_UP 0.55 才迈得出去
function buildBuilding(cx,cz,W,D,T,H1,SLAB,H2,opts){
  opts=opts||{};
  var X0=cx-W/2, X1=cx+W/2, Z0=cz-D/2, Z1=cz+D/2;
  var F2=H1+SLAB, TOP=F2+H2;
  /* 【batch119】可选第三层：opts.H3>0 时再加一层。三楼同样有墙有窗（从外面看得出"这是栋大楼"），
     楼板也铺出来，但**不配楼梯** —— 能上人的仍然只有二楼，三楼只是体量/层次。 */
  var H3=(opts.H3||0), SLAB3=(opts.SLAB3||0.30), TOP3=TOP+(H3?SLAB3+H3:0), ROOFY=(H3?TOP3:TOP);
  var z0i=Z0+T, z1i=Z1-T, x0i=X0+T, x1i=X1-T;
  var mat=matOf('plaster',plasterTexDraw);
  var doorSide=opts.doorSide||'S';
  var doorW=(opts.doorW===undefined?3.0:opts.doorW), doorAt=(opts.doorAt===undefined?0:opts.doorAt);
  var winSide=opts.winSide||'N';
  var winW=(opts.winW===undefined?4.0:opts.winW), winAt=(opts.winAt===undefined?0:opts.winAt);
  /* 楼梯放在"门对面"那面墙；有梯子的那面墙一楼不开窗，免得窗和梯子打架 */
  var stSide=(doorSide==='W')?'E':(doorSide==='E'?'W':(doorSide==='N'?'S':'N'));

  var h1={S:[],N:[],E:[],W:[]}, h2={S:[],N:[],E:[],W:[]}, h3={S:[],N:[],E:[],W:[]};
  h1[doorSide].push([doorAt,doorW,0,2.45]);                              // 一楼门
  /* 【batch115】窗台 0.80 → 0.30：低于台阶容差（STEP_UP 0.55）→ 站在二楼能直接迈出窗口再往下跳。
     0.80 那版人过不去（窗台比 STEP_UP 高），只能靠跳跃挤出去，用户反馈的"二楼有窗可跳下"就不成立。 */
  h2[winSide].push([winAt,winW,F2+WIN_SILL,F2+2.35]);                    // 二楼大窗（跳出去的那扇）

  var sides=['S','N','E','W'];
  for(var i=0;i<4;i++){
    var k=sides[i];
    if(k===doorSide||k===stSide) continue;                               // 有门/有梯子的那面不排窗
    var len=(k==='N'||k==='S')?W:D, ww=Math.min(2.4,len*0.24), off=len*0.27;
    h1[k].push([-off,ww,1.00,2.40]); h1[k].push([ off,ww,1.00,2.40]);    // 一楼两扇窗
    if(k!==winSide){ h2[k].push([-off,ww,F2+0.85,F2+2.15]); h2[k].push([off,ww,F2+0.85,F2+2.15]); }
  }

  if(H3){
    for(var i3=0;i3<4;i3++){
      var k3=sides[i3]; if(k3===winSide||k3===doorSide) continue;
      var len3=(k3==='N'||k3==='S')?W:D, ww3=Math.min(2.4,len3*0.24), off3=len3*0.27;
      h3[k3].push([-off3,ww3,TOP+SLAB3+1.00,TOP+SLAB3+2.30]);             // 三楼两扇窗
      h3[k3].push([ off3,ww3,TOP+SLAB3+1.00,TOP+SLAB3+2.30]);
    }
  }
  var s0=childCount();
  for(var j=0;j<4;j++){
    var kk=sides[j];
    buildWallBand(kk,cx,cz,W,D,T,0,F2,h1[kk],mat);                        // 一楼（从地面砌）
    buildWallBand(kk,cx,cz,W,D,T,F2,TOP,h2[kk],mat);                      // 二楼（悬空）
    if(H3) buildWallBand(kk,cx,cz,W,D,T,TOP+SLAB3,TOP3,h3[kk],mat);       // 三楼（悬空）
    for(var q=0;q<h1[kk].length;q++){ var o1=h1[kk][q]; if(o1[2]>0.5) buildGlass(kk,cx,cz,W,D,T,o1[0],o1[1],o1[2],o1[3]); }
    /* 【batch115】二楼那扇"逃生窗"（winSide 那面）不装玻璃：它是要人走出去跳下的开口，
       套一块玻璃穿过去就是穿墙。其它二楼的窗照旧补玻璃（好看、不挡人不挡视线）。 */
    if(kk!==winSide) for(var q2=0;q2<h2[kk].length;q2++){ var o2=h2[kk][q2]; buildGlass(kk,cx,cz,W,D,T,o2[0],o2[1],o2[2],o2[3]); }
  }
  shadowFrom(s0,true);

  /* --- 二楼楼板：铺满内部，只留楼梯那一条口 --- */
  var swW=3.0, swZ0=z0i+0.5, swZ1=z1i-0.5;
  var swX0=(stSide==='W')?x0i:(stSide==='E')?(x1i-swW):(x0i+x1i-swW)/2;   // 楼梯贴哪面墙（门在北/南时走中间）
  var swX1=swX0+swW;
  var s1=childCount();
  if(swX0-x0i>0.3) addLedge((x0i+swX0)/2, cz, swX0-x0i, SLAB, z1i-z0i, floorMat(), 'slab-floor', H1);   // 梯口左（西）侧
  if(x1i-swX1>0.3) addLedge((swX1+x1i)/2, cz, x1i-swX1, SLAB, z1i-z0i, floorMat(), 'slab-floor', H1);   // 梯口右（东）侧
  addLedge((swX0+swX1)/2, (swZ1+z1i)/2, swW, SLAB, z1i-swZ1, floorMat(), 'slab-floor', H1);             // 梯口南端
  addLedge((swX0+swX1)/2, (z0i+swZ0)/2, swW, SLAB, Math.max(0.3,swZ0-z0i), floorMat(), 'slab-floor', H1); // 梯口北端
  shadowFrom(s1,true);

  /* --- 楼梯：贴 stSide 那面墙，从北往南一级级上去 --- */
  var nSteps=Math.max(8,Math.round(F2/0.35)), stepH=F2/nSteps, stepD=(swZ1-swZ0)/nSteps, sx=(swX0+swX1)/2;
  var s2=childCount();
  for(var st=0;st<nSteps;st++) addBox(sx, swZ0+stepD*(st+0.5), swW, stepH*(st+1), stepD, stepMat());
  shadowFrom(s2,true);

  /* --- 家具 --- */
  var ints=opts.interiors||[];
  for(var ii=0;ii<ints.length;ii++){ var o=ints[ii]; addBox(cx+o[0], cz+o[1], o[2], o[3], o[4], matOf('wood',woodTexDraw)); }
  var ups=opts.upstairs||[];
  for(var uu=0;uu<ups.length;uu++){ var o3=ups[uu]; addLedge(cx+o3[0], cz+o3[1], o3[2], o3[3], o3[4], matOf('wood',woodTexDraw), 'ledge', F2); }

  /* --- 屋顶：平顶 + 女儿墙 + 水箱 --- */
  var s3=childCount();
  if(H3) addLedge(cx, cz, W-T*2, SLAB3, D-T*2, floorMat(), 'slab-floor', TOP);                // 三楼楼板（纯体量，不上人）
  /* 【batch119c】平屋顶用灰石材（混凝土），红瓦只留给民房的双坡顶 —— 原来平顶也铺红瓦，
     俯视整个镇子一片陶土色，像砖厂不像小镇。 */
  addLedge(cx, cz, W+0.7, 0.35, D+0.7, matOf('rock',rockTexDraw), 'ledge', ROOFY);             // 屋面板（四周外挑 0.35）
  var PW=0.30, PH=0.95, ry=ROOFY+0.35;
  addLedge(cx, Z0-0.35+PW/2, W+0.7, PH, PW, mat, 'ledge', ry);                               // 北女儿墙
  addLedge(cx, Z1+0.35-PW/2, W+0.7, PH, PW, mat, 'ledge', ry);                               // 南女儿墙
  addLedge(X0-0.35+PW/2, cz, PW, PH, D+0.7, mat, 'ledge', ry);                               // 西女儿墙
  addLedge(X1+0.35-PW/2, cz, PW, PH, D+0.7, mat, 'ledge', ry);                               // 东女儿墙
  addLedge(cx+W*0.22, cz-D*0.18, 2.2, 1.6, 2.2, matOf('wood',woodTexDraw), 'ledge', ry);     // 屋顶水箱
  shadowFrom(s3,true);

  infoPush('floors',{cx:cx,cz:cz,y:H1,w:W,d:D,stairSide:stSide});
  infoPush('stairs',{x:sx,z0:swZ0,z1:swZ1,dx:0,topY:F2,side:stSide});
  infoPush('roofs',{cx:cx,cz:cz,y:ROOFY,w:W,d:D});
  infoPush('doors',{side:doorSide,x:cx,z:cz,w:doorW});
  var winInfo={side:winSide,off:winAt,w:winW,y0:F2+WIN_SILL,y1:F2+2.35,y:F2};
  if(winSide==='N'){ winInfo.x=cx+winAt; winInfo.z=Z0+T/2; }
  else if(winSide==='S'){ winInfo.x=cx+winAt; winInfo.z=Z1-T/2; }
  else if(winSide==='W'){ winInfo.x=X0+T/2; winInfo.z=cz+winAt; }
  else { winInfo.x=X1-T/2; winInfo.z=cz+winAt; }
  infoPush('windows',winInfo);
  rectAdd(cx,cz,W+1.0,D+1.0);
  return {F2:F2,TOP:TOP,TOP3:TOP3};
}

/* ---------------- 单层民房（双坡瓦顶 + 山墙 + 家具）----------------
   opts.doorSide / doorAt / doorW：门；opts.interiors：家具。
   屋顶两片斜面用旋转的薄盒子拼（屋檐外挑 0.6 米）—— 屋顶不参与碰撞（人爬不上去，也不该在头顶挡人）。 */
function buildHouse(cx,cz,W,D,H,opts){
  opts=opts||{};
  var T=0.42, X0=cx-W/2, X1=cx+W/2, Z0=cz-D/2, Z1=cz+D/2;
  var mat=matOf('plaster',plasterTexDraw);
  var doorW=(opts.doorW===undefined?2.6:opts.doorW), doorSide=opts.doorSide||'S', doorAt=(opts.doorAt===undefined?0:opts.doorAt);
  var h1={S:[],N:[],E:[],W:[]};
  h1[doorSide].push([doorAt,doorW,0,2.30]);
  var sides=['S','N','E','W'], i;
  for(i=0;i<4;i++){
    var k=sides[i]; if(k===doorSide) continue;
    var len=(k==='N'||k==='S')?W:D, ww=Math.min(2.2,len*0.26), off=len*0.28;
    h1[k].push([-off,ww,1.00,2.25]); h1[k].push([ off,ww,1.00,2.25]);
  }
  var s0=childCount();
  for(i=0;i<4;i++){
    var kk=sides[i];
    buildWallBand(kk,cx,cz,W,D,T,0,H,h1[kk],mat);
    for(var q=0;q<h1[kk].length;q++){ var o1=h1[kk][q]; if(o1[2]>0.5) buildGlass(kk,cx,cz,W,D,T,o1[0],o1[1],o1[2],o1[3]); }
  }
  /* 双坡屋顶：脊高 rise，两片斜面各绕 X 轴倾斜 */
  var over=0.55, halfD=D/2+over, rise=Math.min(3.0,D*0.30), ang=Math.atan2(rise,halfD), paneL=Math.sqrt(halfD*halfD+rise*rise);
  var rmat=matOf('roof',roofTexDraw);
  for(var sg=1;sg>=-1;sg-=2){
    var pane=new THREE.Mesh(new THREE.BoxGeometry(W+over*2,0.26,paneL),rmat);
    pane.rotation.x=sg*ang;
    pane.position.set(cx, H+rise/2, cz+sg*halfD/2);
    _mapTarget.add(pane);
  }
  /* 山墙（两端三角形），把墙顶到屋脊之间的空补上 */
  if(THREE.ShapeGeometry){
    for(var ex=1;ex>=-1;ex-=2){
      var tri=new THREE.Shape([new THREE.Vector2(-halfD,0),new THREE.Vector2(halfD,0),new THREE.Vector2(0,rise+0.1)]);
      var gm=new THREE.Mesh(new THREE.ShapeGeometry(tri),mat);
      gm.rotation.y=Math.PI/2; gm.position.set(cx+ex*(W/2),H,cz);
      _mapTarget.add(gm);
    }
  }
  shadowFrom(s0,true);
  var ints=opts.interiors||[];
  for(var ii=0;ii<ints.length;ii++){ var o=ints[ii]; addBox(cx+o[0], cz+o[1], o[2], o[3], o[4], matOf('wood',woodTexDraw)); }
  infoPush('roofs',{cx:cx,cz:cz,y:H,w:W,d:D,gable:rise});
  infoPush('doors',{side:doorSide,x:cx,z:cz,w:doorW});
  rectAdd(cx,cz,W+0.8,D+0.8);
  return {H:H};
}

/* ---------------- 树 / 巨石 / 木栅栏（山脚的"生活感"）---------------- */
function buildTree(x,z,sc){
  if(!inOval(x,z,11)||!rectFree(x,z))return false;
  var s0=childCount();
  addBox(x,z,0.95*sc,3.3*sc,0.95*sc,matOf('wood',woodTexDraw));           // 树干（能挡人）
  var c1=new THREE.Mesh(new THREE.SphereGeometry(2.4*sc,8,6),leafMat()); c1.position.set(x,4.3*sc,z); _mapTarget.add(c1);
  var c2=new THREE.Mesh(new THREE.SphereGeometry(1.75*sc,8,6),leafMat()); c2.position.set(x+1.15*sc,5.4*sc,z-0.7*sc); _mapTarget.add(c2);
  var c3=new THREE.Mesh(new THREE.SphereGeometry(1.55*sc,8,6),leafMat()); c3.position.set(x-1.05*sc,5.1*sc,z+0.9*sc); _mapTarget.add(c3);
  shadowFrom(s0,true);
  return true;
}
function buildBoulder(x,z,r){
  if(!inOval(x,z,10)||!rectFree(x,z))return false;
  var s0=childCount();
  addBox(x,z,r*2,r*0.9,r*1.7,matOf('rock',rockTexDraw));
  shadowFrom(s0,true);
  return true;
}
function buildFenceRun(x,z,len,horiz){
  if(!inOval(x,z,11)||!rectFree(x,z))return false;
  var s0=childCount(), wm=matOf('wood',woodTexDraw), n=Math.max(2,Math.round(len/2.6)), i;
  for(i=0;i<=n;i++){
    var t=-len/2+len*i/n;
    var p=new THREE.Mesh(new THREE.BoxGeometry(0.22,1.35,0.22),wm);
    p.position.set(horiz?x+t:x,0.67,horiz?z:z+t); _mapTarget.add(p);
  }
  for(i=0;i<2;i++){
    var rr=new THREE.Mesh(horiz?new THREE.BoxGeometry(len,0.16,0.1):new THREE.BoxGeometry(0.1,0.16,len),wm);
    rr.position.set(x,0.5+i*0.55,z); _mapTarget.add(rr);
  }
  shadowFrom(s0,true);
  return true;
}

/* ---------------- 传送门（A/B 点）---------------- */
function buildTeleport(x,z,label,toX,toZ,toLabel,color){
  var r=1.9;
  var ring=new THREE.Mesh(new THREE.CylinderGeometry(r,r,0.12,26),
    new THREE.MeshLambertMaterial({color:color,transparent:true,opacity:0.55,depthWrite:false}));
  ring.position.set(x,0.07,z); _mapTarget.add(ring);
  var core=new THREE.Mesh(new THREE.CylinderGeometry(r*0.62,r*0.62,0.18,24),
    new THREE.MeshLambertMaterial({color:color}));
  core.position.set(x,0.09,z); _mapTarget.add(core);
  var beam=new THREE.Mesh(new THREE.CylinderGeometry(r*0.55,r*0.75,9,20,1,true),
    new THREE.MeshLambertMaterial({color:color,transparent:true,opacity:0.16,side:THREE.DoubleSide,depthWrite:false}));
  beam.position.set(x,4.5,z); _mapTarget.add(beam);
  var post=new THREE.Mesh(new THREE.BoxGeometry(0.24,3.4,0.24),matOf('wood',woodTexDraw));
  post.position.set(x+1.5,1.7,z); _mapTarget.add(post);                 // 一根指路木桩，看着更像"地标"
  if(_tpTarget)_tpTarget.push({x:x,z:z,r:r,name:label,to:[toX,toZ],toName:toLabel});
}

/* ==================== 日蚀环城：小镇总平面 ====================
   一条纵街（南北向，x=0）和一条横街（东西向，z=6）在镇中心十字交汇。
   街两侧是成排的楼房（门开向街面）与民房；镇口在南北两头；外围是一圈山、山脚树林与栅栏。
   坐标都挑过：每栋房子都落在椭圆内并留 ≥ 9 米余量（inOval 会用），彼此不重叠。 */
function buildMapEclipse(){
  /* --- 地面 + 山 --- */
  applyGroundTexOval(makeOvalGround(_mapTarget,0x8c8064,OVA_A,OVA_B,OVA_BUMP,1.06));
  buildRidgeWall(OVA_A,OVA_B,OVA_BUMP,5);
  /* 【batch115】把椭圆的三个参数也登记成"地标"：探针（t_map.js E 段）直接读它，
     不再在探针里写死 a=68/b=58 —— 那组数是放大前的旧值，batch114 一改图探针就全红。 */
  infoPush('oval',{a:OVA_A,b:OVA_B,bump:OVA_BUMP});

  /* --- 街道（batch119：12/11 米 → 9 米，+两侧 2 米人行道 → 终于像"街"而不是跑道）--- */
  buildStreet(0,0,150,9,'z');             // 纵街：路面 x∈[-4.5,4.5]，z∈[-75,75]
  buildStreet(0,0,150,9,'x');             // 横街：路面 z∈[-4.5,4.5]，x∈[-75,75]

  /* --- 沿街楼房（batch119：窄而高 16×13、一楼 4.0 / 二楼 3.6，纵街两侧各 6 栋成排）---
     原来 22~24 米宽只有 7.2 米高 —— 街宽 12 米、楼像仓库、彼此隔 30 多米，一点不像街。
     现在沿街排开：门朝街、**二楼逃生窗也朝街**（从二楼窗直接跳到大街上）。 */
  var LZ=[-50,-32,-14,14,32,50];
  var inUS=[[2.6,2.4,2.2,0.9,1.0],[-2.6,2.8,1.1,0.8,1.0],[-3.2,-3.2,2.6,1.7,0.9]];
  var upUS=[[2.4,2.6,2.0,0.6,1.1],[-2.4,2.6,1.1,0.5,2.0]];
  for(var li=0;li<LZ.length;li++){
    var lz=LZ[li];
    if(lz!==-14) buildBuilding(-15,lz,16,13,0.5, 4.0,0.35,3.6,          // 西侧（门朝东）
      {doorSide:'E',doorAt:0,doorW:3.0,winSide:'E',winAt:4.2,winW:4.0,interiors:inUS,upstairs:upUS});
    buildBuilding(15,lz,16,13,0.5, 4.0,0.35,3.6,                        // 东侧（门朝西）
      {doorSide:'W',doorAt:0,doorW:3.0,winSide:'W',winAt:4.2,winW:4.0,interiors:inUS,upstairs:upUS});
    addLedge(-6.1,lz,1.7,0.16,5.0,matOf('roof',roofTexDraw),'ledge',2.8);   // 店门口的遮阳篷
    addLedge( 6.1,lz,1.7,0.16,5.0,matOf('roof',roofTexDraw),'ledge',2.8);
  }
  /* 镇中心西侧那栋**三层的大楼**（原需求："靠左侧有一栋更大的楼"）—— 20×15、总高 11.65 米 */
  buildBuilding(-16.5,-14,20,15,0.5, 4.0,0.35,3.6,
    {doorSide:'E',doorAt:0,doorW:3.4,winSide:'E',winAt:4.2,winW:4.4,H3:3.4,
     interiors:[[3.4,3.0,2.6,1.0,1.2],[-3.4,4.0,1.2,0.85,1.2],[-4.0,-4.2,3.0,1.9,0.9]],
     upstairs:[[3.2,3.4,2.4,0.7,1.3],[-3.2,3.4,1.3,0.55,2.4]]});

  /* --- 民房（单层，双坡瓦顶）：纵街外侧的第二排，8 栋 —— 街区成片，不再东一栋西一栋 --- */
  var HS=[[-31,-34,'E'],[-35,-14,'E'],[-31,14,'E'],[-35,34,'E'],
          [ 31,-34,'W'],[ 35,-14,'W'],[ 31,14,'W'],[ 35,34,'W']];
  for(var hi2=0;hi2<HS.length;hi2++){
    var HS0=HS[hi2];
    buildHouse(HS0[0],HS0[1],14,12,4.0,{doorSide:HS0[2],doorAt:0,doorW:2.8,
      interiors:[[2.6,2.2,2.0,0.9,1.0],[-2.6,2.4,1.1,0.8,1.0],[-3.0,-2.6,1.4,1.2,1.4]]});
  }

  /* --- 街道家具（batch119）：路灯 / 花坛 / 长椅 / 木箱 —— 让街上有"生活气息" ---
     原来那 16 个箱子是随手丢的，batch119 改了街道与楼房位置后有一半正好压在新楼里，
     所以整段换成"沿人行道成排"的街道家具（都 ≤0.9 米高，能一脚迈上去，不当路障）。 */
  function buildLamp(x,z){
    addBox(x,z,0.26,4.9,0.26,matOf('wood',woodTexDraw));                    // 灯柱
    var head=new THREE.Mesh(new THREE.SphereGeometry(0.36,8,6),new THREE.MeshBasicMaterial({color:0xfff2c8}));
    head.position.set(x,5.05,z); _mapTarget.add(head);
  }
  function buildPlanter(x,z){
    addBox(x,z,2.0,0.55,1.1,matOf('wood',woodTexDraw));
    var b=new THREE.Mesh(new THREE.SphereGeometry(0.55,7,5),leafMat()); b.position.set(x,0.95,z); _mapTarget.add(b);
  }
  var s0=childCount();
  var lampZ=[-58,-42,-26,26,42,58];
  for(var lp3=0;lp3<lampZ.length;lp3++){
    buildLamp(-6.0,lampZ[lp3]); buildLamp(6.0,lampZ[lp3]);                  // 纵街两侧
    buildLamp(lampZ[lp3],-6.0); buildLamp(lampZ[lp3],6.0);                  // 横街两侧
  }
  var props=[[-5.6,10],[5.6,-10],[-5.6,-26],[5.6,26],[-5.6,42],[5.6,-42],
             [10,5.6],[-10,-5.6],[26,5.6],[-26,-5.6],[42,5.6],[-42,-5.6],
             [-5.6,-5.6],[5.6,5.6],[5.6,-5.6],[-5.6,5.6]];
  for(var pi2=0;pi2<props.length;pi2++){
    var PP=props[pi2];
    if(pi2%3===0) buildPlanter(PP[0],PP[1]);
    else if(pi2%3===1) addBox(PP[0],PP[1],2.2,0.5,0.75,matOf('wood',woodTexDraw));   // 长椅
    else addBox(PP[0],PP[1],1.3,0.85,1.0,matOf('wood',woodTexDraw));                 // 木箱（当掩体）
  }
  shadowFrom(s0,false);

  /* --- 山脚：巨石 + 树林 + 木栅栏（把"山脚下的小镇边缘"做出来）--- */
  for(var bi=0;bi<26;bi++){
    var bt=bi/26*Math.PI*2;
    var bx=Math.cos(bt)*OVA_A*0.885, bz=Math.sin(bt)*OVA_B*0.885;
    buildBoulder(bx,bz,1.5+((bi*37)%9)*0.18);
  }
  for(var ti=0;ti<30;ti++){
    var tt=(ti/30+0.013)*Math.PI*2;
    buildTree(Math.cos(tt)*OVA_A*0.79, Math.sin(tt)*OVA_B*0.79, 0.95+((ti*53)%7)*0.07);
  }
  buildFenceRun(-62,-54,24,true); buildFenceRun(62,-54,24,true);
  buildFenceRun(-70,22,20,false); buildFenceRun(70,22,20,false);
  buildFenceRun(0,-72,20,true);   buildFenceRun(0,72,20,true);

  /* --- A 点（左上）/ B 点（右上）：互为传送门 ---
     落点从对面圈的边缘再往场地里推 5 米 → 不会一落地就被传回来。 */
  buildTeleport(-66,-44,'A 点',  61,-41,'B 点', 0x49b6ff);
  buildTeleport( 66,-44,'B 点', -61,-41,'A 点', 0xffb347);

  /* --- 天空与阳光（放最后：前面的 shadowFrom 就不会把天空也算进投影队列）--- */
  buildEclipseSky();
  buildEclipseSun();
}

var TOWER_X=0, TOWER_Z=-60, TOWER_HALF=3, TOWER_TOP=11, LADDER_X=TOWER_X, LADDER_Z=TOWER_Z+TOWER_HALF+2.5, platHalf=TOWER_HALF+2.5;
/* 上面这组常量属于「经典图」的哨塔：爬梯与攀爬逻辑只认它们，而且只在经典图才启用。
   新地图没有哨塔、没有爬梯 → MAP_HAS_LADDER/MAP_HAS_TOWER 置 false，相关分支整段跳过
   （这样就不必为了新图去动爬梯那套代码，也不会让新图误判"附近有梯子"）。*/
var towerMat=new THREE.MeshLambertMaterial({color:0x556677});
var towerPillar=new THREE.Mesh(new THREE.BoxGeometry(TOWER_HALF*2, TOWER_TOP, TOWER_HALF*2), towerMat);
towerPillar.position.set(TOWER_X, TOWER_TOP/2, TOWER_Z); _mapTarget.add(towerPillar);
_obsTarget.push({cx:TOWER_X,cz:TOWER_Z,w:TOWER_HALF*2,d:TOWER_HALF*2,h:TOWER_TOP+0.6,pillar:true,kind:'pillar',minX:TOWER_X-TOWER_HALF,maxX:TOWER_X+TOWER_HALF,minZ:TOWER_Z-TOWER_HALF,maxZ:TOWER_Z+TOWER_HALF});
var platform=new THREE.Mesh(new THREE.BoxGeometry(platHalf*2, 0.6, platHalf*2), new THREE.MeshLambertMaterial({color:0x667788}));
platform.position.set(TOWER_X, TOWER_TOP+0.3, TOWER_Z); _mapTarget.add(platform);
/* 【batch111】塔顶平台从"特判"升级成一块正式的「楼板 slab」障碍物：
   楼板只在 y0..y1 那一层挡人（塔下照样能走），顶面 y1 可站 —— 于是新图的二楼地板、
   平台、雨棚全都是同一种东西，不用再为每种结构写特判。 */
_obsTarget.push({cx:TOWER_X,cz:TOWER_Z,w:platHalf*2,d:platHalf*2,h:TOWER_TOP+0.6,slab:true,kind:'slab',y0:TOWER_TOP,y1:TOWER_TOP+0.6,minX:TOWER_X-platHalf,maxX:TOWER_X+platHalf,minZ:TOWER_Z-platHalf,maxZ:TOWER_Z+platHalf});
var railMat2=new THREE.MeshLambertMaterial({color:0x334455});
var railGap=1.4;
  for(var ri=0;ri<4;ri++){
    if(ri===1){
      var segW=(platHalf-railGap), segCx=(platHalf+railGap)*0.5;
      var railL=new THREE.Mesh(new THREE.BoxGeometry(segW,1.1,0.25), railMat2); railL.position.set(TOWER_X-segCx, TOWER_TOP+1.0, TOWER_Z+platHalf); _mapTarget.add(railL);
      var railR=new THREE.Mesh(new THREE.BoxGeometry(segW,1.1,0.25), railMat2); railR.position.set(TOWER_X+segCx, TOWER_TOP+1.0, TOWER_Z+platHalf); _mapTarget.add(railR);
    } else {
      var horizontal=(ri<2); var rw=horizontal?platHalf*2:0.25, rd=horizontal?0.25:platHalf*2; var rail=new THREE.Mesh(new THREE.BoxGeometry(rw,1.1,rd), railMat2); rail.position.set(TOWER_X+(ri===2?-platHalf:ri===3?platHalf:0), TOWER_TOP+1.0, TOWER_Z+(ri===0?-platHalf:ri===1?platHalf:0)); _mapTarget.add(rail);
    }
  }
  // ===== 塔顶围栏的碰撞体（前侧中间留缺口 railGap，供上下梯）=====
  // 【重要】围栏 != 边界墙，两者绝不能共用一套碰撞规则：
  //   · 边界墙（kind='border'）负责"把所有人关在地图里"—— 16 米高，永远挡得住，跳不过去。
  //   · 围栏只是塔顶的一道栏杆 —— 只在自己那一层（y0..y1）挡人：
  //       站在塔顶时挡住你（不会一不留神走下塔），但**跳起来脚高过栏杆顶就能翻出去、跳下塔**。
  //   原来这里只写了 h（=12.55）而没有下沿，于是这道栏杆在地面上也变成一堵隐形墙：
  //   塔周围走不过去、子弹被莫名吃掉、跳起来也翻不过去（跳不下塔）。现在用 y0/y1 标明
  //   它是"高处的一根栏杆"，并加 rail:true，让所有"只按水平距离判断"的地方忽略它。
  function pushRail(cx,cz,w,d){_obsTarget.push({cx:cx,cz:cz,w:w,d:d,rail:true,kind:'rail',y0:TOWER_TOP+0.35,y1:TOWER_TOP+1.55,h:TOWER_TOP+1.55,minX:cx-w/2,maxX:cx+w/2,minZ:cz-d/2,maxZ:cz+d/2});}
  pushRail(TOWER_X-segCx, TOWER_Z+platHalf, segW, 0.25);
  pushRail(TOWER_X+segCx, TOWER_Z+platHalf, segW, 0.25);
  pushRail(TOWER_X, TOWER_Z-platHalf, platHalf*2, 0.25);
  pushRail(TOWER_X-platHalf, TOWER_Z, 0.25, platHalf*2);
  pushRail(TOWER_X+platHalf, TOWER_Z, 0.25, platHalf*2);
var ladderMat=new THREE.MeshLambertMaterial({color:0x222222});
var railL=new THREE.Mesh(new THREE.BoxGeometry(0.15, TOWER_TOP-GROUND_Y+1.2, 0.15), ladderMat); railL.position.set(LADDER_X-0.4, (TOWER_TOP+GROUND_Y)/2, LADDER_Z); _mapTarget.add(railL);
var railR=railL.clone(); railR.position.x=LADDER_X+0.4; _mapTarget.add(railR);
for(var st=0; GROUND_Y+st <= TOWER_TOP+0.6; st++){ var rung=new THREE.Mesh(new THREE.BoxGeometry(0.95,0.1,0.12), ladderMat); rung.position.set(LADDER_X, GROUND_Y+st, LADDER_Z); _mapTarget.add(rung); }
/* 【batch111 通用地面】返回"站在 (x,z) 时脚下的地板高度"（＝可站面最高顶面 + 眼高 GROUND_Y）。
   这么做是为了让楼梯、二楼地板、平台、矮箱子全都自动成立：
     · 遍历所有障碍物，取"顶面不高于脚底 + STEP_UP"里最高的那个（再兜底基础地面 0）；
     · STEP_UP 那一档就是"能迈上去的台阶"：比脚底高一点点也算它能站 → 玩家自然被抬上去；
     · 楼板（slab）取 y1 当顶面；栏杆（rail）是薄栏，不算可站面。
   注意返回值是**相机高度**（脚底 + GROUND_Y），调用处就是这么用的。 */
/* 【batch118】"站直口径"的相机高度 —— 把蹲下压低的那一段加回来。
   为什么必须有这个：
     groundHeightAt(x,z,py) 与 playerBlocked(x,z,py) 都是拿 `feet = py - GROUND_Y` 反推脚底的
     （GROUND_Y=2.0 是眼高）。蹲下会把相机压低 CROUCH_DROP≈0.534 米，
     若直接把被压低的相机高度喂进去，反推出来的脚底就比真实脚底低了一大截：
       · groundHeightAt：`top <= feet + STEP_UP` 的台阶容差被吃光 → 站在二楼楼板 / 楼梯上蹲下时，
         "脚下的那块面"被判成不可站，gh 掉回基础地面 0 → 人原地穿进楼板掉下去（用户报的穿模）；
       · playerBlocked：`kind==='terrain' && feet>=o.h-modStepUp()`（台阶不挡路）失效 → 蹲着时楼梯变墙；
         塔顶围栏 `feet>o.y1` 被误判 → 蹲着能爬出围栏。
     记一个 _eyeDropApplied（上一帧真正从相机上减掉的眼高量），反推脚底前加回去即可 ——
     站立 / 跳跃时它是 0，行为与改动前**完全一致**。
     （趴下曾在这里占一大段说明，已随趴下功能一起删除。） */
var _eyeDropApplied=0;                    // 上一帧实际减掉的眼高量（蹲下 CROUCH_DROP）
function standEyeY(){ return camera.position.y+_eyeDropApplied; }
function groundHeightAt(x,z,py){
  var feet=(typeof py==='number'?py:GROUND_Y)-GROUND_Y;
  var lim=feet+STEP_UP+0.02, best=0;
  for(var i=0;i<obstacles.length;i++){
    var o=obstacles[i];
    if(o.rail)continue;
    if(o.spWall){ if(o.rising)continue; var _wc=Math.cos(o.ang||0),_ws=Math.sin(o.ang||0),_wx=x-(o.cx||0),_wz=z-(o.cz||0); var _wlx=_wx*_wc-_wz*_ws,_wlz=_wx*_ws+_wz*_wc; if(Math.abs(_wlx)<=(o.hw||0)+0.001&&Math.abs(_wlz)<=(o.hth||0)+0.001){ var _wt=(typeof o.y1==='number')?o.y1:o.h; if(_wt<=lim&&_wt>best)best=_wt; } continue; }   /* 【batch178】墙顶可站（升起中除外）；【batch180】改**定向矩形**判定（内联 spWallContains 同款公式，不跨分片调用）——原来用 AABB 外接方框，斜墙会在墙外的空角上被"空气地板"托住 */
    if(x<o.minX||x>o.maxX||z<o.minZ||z>o.maxZ)continue;
    var top=(o.slab&&typeof o.y1==='number')?o.y1:(o.h||0);
    if(top<=lim&&top>best)best=top;
  }
  return best+GROUND_Y;
}
/* 【batch143】脚下那块「能站的面」的**绝对高度**（0＝基础地面；二楼楼板＝楼板顶面…）。
   镇岳大招「堡垒阵地」要铺在这个面上 —— 站在二楼放，圈就在二楼；
   以前写死 y≈0.05，所以站二楼放出来的圈永远铺在一楼地板上。
   groundHeightAt 返回的是**相机高度**（base+GROUND_Y），减掉眼高就是脚底那张面。 */
function standSurfY(){
  return groundHeightAt(camera.position.x,camera.position.z,standEyeY())-GROUND_Y;
}
// 玩家能不能站到 (x,z) —— py 是相机高度（不传就用当前相机高度）。
// 【必须把垂直范围算进去】否则"高处的一根栏杆"会退化成"从地面到 12.55 米"的一堵隐形墙。
//   · pillar（塔柱）：站得比它高就直接跨过去
//   · rail  （塔顶围栏）：脚一旦高过栏杆顶（跳起来）就放行 → 能翻出去跳下塔；
//                        人还在地面（头顶都够不到栏杆下沿）时也不挡 → 塔周围不再有隐形墙
/* ============================================================================
   【batch138】头顶碰撞（跳起来撞楼板底面）
   用户："日蚀环城在 1 楼往上跳，头会直接穿过地板（穿到二楼去）。"
   根因：竖直方向只判了"脚下有没有地面"，**完全没判头顶**。跳起来时
   camera.position.y 越过楼板底面也没人管；等脚底进了 STEP_UP 容差，
   groundHeightAt 就把二楼楼板当成"可站的面"，人直接被吸到二楼。
   HEAD_CLEAR ＝ 眼睛到头顶的高度；headBlockAt 找脚下正上方最近的楼板/栏杆底面。
   （只认 rail / slab：普通方块是实心的，人不可能站在它下面。）
   ============================================================================ */
var HEAD_CLEAR=0.35;
/* ============================================================================
   【batch189】碰撞箱口径统一：玩家＝**圆柱体**（半径 PLAYER_R），不再是"边长 1 米的方盒"。
   为什么改：方盒在斜着贴墙角时会额外吃掉 0.2 米（对角 0.707），表现就是"墙角像有块看不见的胶水"，
   转身蹭墙一顿一顿、门框斜着进不去。改成"点到矩形的最近距离 < 半径"（＝圆角方盒）之后：
     · 正面贴墙的距离完全一样（1.0 米缝隙照样过得去，不会变胖）；
     · 只有四个角被削圆 —— 擦角、绕柱、斜穿门框都顺了。
   推出逻辑（pushOutOfBoxes）同步改成沿"最近点法线"推，和阻挡判定同一套口径，否则墙边会来回抖。
   ============================================================================ */
var PLAYER_R=0.5;
/* 【batch193】圆 ↔ 定向矩形（SP 墙）的最近距离判定。
   为什么必须有它：原来 SP 墙走的是 spWallContains(o,x,z)——**只判中心点**。
   玩家半径 0.5，所以只要中心点还在墙外，身体就能嵌进墙里半个身位，
   表现就是"防御兵的墙能贴进去 / 半身穿模"，同时贴墙时推不出去（推出逻辑也用的点判定）。
   这里把世界坐标转到墙的本地系，clamp 到矩形求最近点，再和半径比 —— 和其它 AABB 障碍
   **完全同口径**（都是圆柱对盒子），玩家不会再因为障碍种类不同而有两套手感。 */
function obsWallDist2(o,x,z){
  var c=Math.cos(o.ang||0), s=Math.sin(o.ang||0);
  var wx=x-(o.cx||0), wz=z-(o.cz||0);
  var lx=wx*c-wz*s, lz=wx*s+wz*c;              // 世界 → 本地（与 mesh.rotation.y=ang 一致）
  var hw=o.hw||0, hth=o.hth||0;
  var cx=(lx<-hw)?-hw:((lx>hw)?hw:lx);
  var cz=(lz<-hth)?-hth:((lz>hth)?hth:lz);
  var dx=lx-cx, dz=lz-cz;
  return {d2:dx*dx+dz*dz, lx:lx, lz:lz, cx:cx, cz:cz};
}
function obsHitCircle(o,x,z,r){
  var cx=(x<o.minX)?o.minX:((x>o.maxX)?o.maxX:x);
  var cz=(z<o.minZ)?o.minZ:((z>o.maxZ)?o.maxZ:z);
  var dx=x-cx,dz=z-cz;
  return dx*dx+dz*dz<r*r;
}
function headBlockAt(x,z,feetY){
  var best=Infinity;
  for(var i=0;i<obstacles.length;i++){
    var o=obstacles[i];
    if(!(o.rail||o.slab))continue;
    if(typeof o.y0!=='number')continue;
    /* 【batch193】头顶判定也用圆（半径 0.36 ≈ 肩宽的一半，比身体 0.5 略小：
       头顶永远比肩膀窄，用 0.5 会在墙边跳起来误撞）。原来用 0.32 的方盒，
       和身体口径不一致 —— 贴着墙跳，身体已经蹭到楼板了，头顶却判不到。 */
    if(!obsHitCircle(o,x,z,0.36))continue;
    if(o.y0>feetY+0.05&&o.y0<best)best=o.y0;
  }
  return best;
}
function playerBlocked(x,z,py,eye){
  py=(typeof py==='number')?py:standEyeY();               // 【batch118】不传就用站直口径（蹲下压低的那段要加回来）
  /* 第 4 参 eye＝当前姿态的"眼高"。默认 GROUND_Y（站立，feet=py-GROUND_Y 与原逻辑一致）。
     （趴下曾在这里有"扁盒口径"：趴着碰撞盒变 0.65 米高、能钻矮栏杆 —— 已随趴下功能一起删除。） */
  eye=(typeof eye==='number')?eye:GROUND_Y;
  var feet=py-eye;                                   // 相机高度 − 姿态眼高 = 脚底高度
  for(var i=0;i<obstacles.length;i++){
    var o=obstacles[i];
    if(o.pillar&&py>o.h)continue;
    if(o.rail&&(feet>o.y1-0.02||py<o.y0))continue;
    if(o.spWall){
      if(o.rising)continue;
      if(!(py>o.y0+0.05&&feet<o.y1-0.05))continue;   /* 【batch180】竖直用「身体区间」判：头顶高于墙底 且 脚底低于墙顶 */
      /* 【batch193】点判定 → **圆判定**：原来只判中心点，身体能嵌进墙里半个身位 */
      if(obsWallDist2(o,x,z).d2<PLAYER_R*PLAYER_R)return true;
      continue;
    }
    // 【batch111 楼板】只在自己那一层挡：站在楼板上 / 从楼板下面走过 → 都不算撞
    if(o.slab&&!(feet<o.y1-0.30&&py>o.y0+0.02))continue;
    // 【batch111 台阶】顶面比脚底高不超过 STEP_UP 的矮方块＝台阶，不挡路（走上去会被 groundHeightAt 抬起来）。
    // 这一条让楼梯、路沿、矮箱全都"能踩上去"，同时 3 米以上的掩体照旧是墙。
    if(o.kind==='terrain'&&feet>=o.h-modStepUp())continue;
    if(obsHitCircle(o,x,z,PLAYER_R))return true;   /* 【batch189】圆-矩形（原：x±0.5 / z±0.5 的方盒） */
  }
  return false;
}
/* 【batch144】把"已经卡在方块里面"的人推出来（沿穿透最浅的那一轴）。
   什么时候会卡：从方块顶上走到边缘掉下来 —— 见 apply_batch144.py 里的根因说明。
   · 判定条件与 playerBlocked **逐条一致**（同一套 pillar / rail / slab / 台阶容差口径），
     所以它只会在"playerBlocked 认为你正身处墙里"时才动手，绝不会误推贴着墙正常走位的人。
   · 只改水平坐标，不动高度：掉下来的人会滑到方块旁边继续落地，而不是被弹回方块顶。 */
function pushOutOfBoxes(py,eye,falling){
  py=(typeof py==='number')?py:standEyeY();
  eye=(typeof eye==='number')?eye:GROUND_Y;   // 同 playerBlocked（趴下已删除，只剩站/蹲两种口径）
  /* 【修】第 3 参 falling＝正在自由下落。原来每帧无条件推：从二楼平台 / 窗口边缘往下走时，
     脚底还在楼板区间里、身体又与楼板水平重叠（刚跨出边缘，半径 0.5 的身体有一半压在板上），
     slab 分支的放行条件不成立 → 把人沿最浅轴**水平弹开** → 直接把人弹出一楼（用户实测）。
     batch144 原本要解决的是"贴墙掉下来卡住动不了"——那需要在落地/被挡住时才推；
     自由下落中的人会自己穿过楼板，不该被水平弹开。墙 / 实体方块照旧推（防卡墙不受影响）。 */
  var falling=(typeof falling==='boolean')?falling:false;
  var px=camera.position.x,pz=camera.position.z;
  var feet=py-eye;
  for(var i=0;i<obstacles.length;i++){
    var o=obstacles[i];
    if(o.pillar&&py>o.h)continue;
    if(o.rail&&(feet>o.y1-0.02||py<o.y0))continue;
    if(o.spWall){
      if(o.rising)continue;
      if(!(py>o.y0+0.05&&feet<o.y1-0.05))continue;      /* 【batch180】同 playerBlocked：身体区间判竖直（头顶高于墙底 且 脚底低于墙顶），不能只拿眼高比，否则跳起来就穿墙 */
      /* 【batch193】与 playerBlocked 同一口径：圆 ↔ 定向矩形 */
      var _wr=obsWallDist2(o,px,pz);
      if(_wr.d2>=PLAYER_R*PLAYER_R*0.999)continue;        // 没真的重叠（贴着墙站合法）
      var _c=Math.cos(o.ang||0),_s=Math.sin(o.ang||0);
      var _nlx=0,_nlz=0;
      if(_wr.d2>1e-8){                                    // 圆心在墙外：沿"最近点→圆心"推
        var _mx=_wr.lx-_wr.cx,_mz=_wr.lz-_wr.cz,_ml=Math.sqrt(_wr.d2);
        _nlx=_mx/_ml; _nlz=_mz/_ml;
        var _need=PLAYER_R-_ml+0.004;
        px+=(_nlx*_c+_nlz*_s)*_need; pz+=(-_nlx*_s+_nlz*_c)*_need;
      }else{                                              // 圆心已陷进墙里：退回最浅边推出
        var _pl=_wr.lx+(o.hw||0),_pr=(o.hw||0)-_wr.lx,_pu=_wr.lz+(o.hth||0),_pd=(o.hth||0)-_wr.lz;
        var _pm=Math.min(_pl,_pr,_pu,_pd);
        _nlx=(_pm===_pl?-1:(_pm===_pr?1:0)); _nlz=(_pm===_pu?-1:(_pm===_pd?1:0));
        var _push=PLAYER_R+0.004+Math.min(_pm,0.35);       /* 单帧最多推 0.35 米，几帧走出来、也不瞬移 */
        px+=(_nlx*_c+_nlz*_s)*_push; pz+=(-_nlx*_s+_nlz*_c)*_push;
      }
      continue;
    }
    if(o.slab&&!(feet<o.y1-0.30&&py>o.y0+0.02))continue;
    if(o.slab&&falling)continue;                     // 【修】自由下落中不推楼板
    if(o.kind==='terrain'&&feet>=o.h-modStepUp())continue;      // 台阶容差内：能踩上去，不算卡住
    /* 【batch189】圆-矩形推出：沿"最近点 → 圆心"的法线推，穿透深度＝半径 − 距离。
       和 playerBlocked 同一口径，贴着墙站（距离恰好 = 半径）不会被误推，也就不会在墙边抖。 */
    var _cx=(px<o.minX)?o.minX:((px>o.maxX)?o.maxX:px);
    var _cz=(pz<o.minZ)?o.minZ:((pz>o.maxZ)?o.maxZ:pz);
    var _dx=px-_cx,_dz=pz-_cz,_d2=_dx*_dx+_dz*_dz;
    if(_d2>=PLAYER_R*PLAYER_R*0.999)continue;                   // 没真的重叠
    if(_d2>1e-8){
      var _d=Math.sqrt(_d2),_push=PLAYER_R-_d+0.004;
      px+=_dx/_d*_push; pz+=_dz/_d*_push;
    }else{
      /* 圆心已经陷进盒子里（重生点/传送/被技能推进去）：退回"最浅轴"推出，和旧逻辑一致 */
      var l=px+PLAYER_R-o.minX, r=o.maxX-(px-PLAYER_R);
      var u=pz+PLAYER_R-o.minZ, d=o.maxZ-(pz-PLAYER_R);
      /* 【batch193】原来 m>1.2 直接 continue（"陷得过深不归这套逻辑管"）—— 但被技能推进墙里、
         落在方块内部重生、或者从高处掉进实心块，都属于"深陷"，于是**永远推不出来，只能卡死**。
         现在深陷也推，但**单帧最多挪 0.35 米**：几帧之内自己走出来，也不会一帧瞬移出去。 */
      var m=Math.min(l,r,u,d), _lim=Math.min(m,0.35);
      if(m===l)px=o.minX-PLAYER_R-_lim-0.004;
      else if(m===r)px=o.maxX+PLAYER_R+_lim+0.004;
      else if(m===u)pz=o.minZ-PLAYER_R-_lim-0.004;
      else pz=o.maxZ+PLAYER_R+_lim+0.004;
    }
  }
  camera.position.x=px;camera.position.z=pz;
}
// 纯水平碰撞（AI 走位、子弹撞墙、出生点检测）。只有传了 py 才考虑"高处的围栏 / 楼板"，
// 不传就当它们不存在 —— 它们只该挡住"那一层的人"，不该在地面上变成隐形墙拦住 AI 和子弹。
function isColliding(x,z,r,py,stepUp){
  /* 【batch125】第 5 个参数 stepUp：启用"台阶容差"（和 playerBlocked 同一口径）——
     顶面比脚底高不超过 STEP_UP 的**矮地形**不算挡路，这样 AI 才能跨门槛、上楼梯。
     为什么做成可选参数而不是自动判：子弹也走这个函数（不传 stepUp），
     要是自动放行矮方块，子弹就能从矮箱子顶上"穿"过去，掩护全废。 */
  for(var i=0;i<obstacles.length;i++){
    var o=obstacles[i];
    if((o.rail||o.slab)&&(typeof py!=='number'||py<o.y0||py>o.y1))continue;
    /* 【batch184f】普通 addBox 矮障碍（如火车站 1.3m 站台、1m 喷泉座）也要按垂直范围判：
       子弹/AI 在其顶面之上时应放行，否则矮盒子会被当成"全高墙"挡住子弹，
       导致站在地面朝对面的火车开枪、子弹越过站台 z 带就被误杀、打不到火车。
       slab/rail 维持原逻辑（无 py 时不挡、有 py 时按 y0/y1）不变。 */
    var _yb=(typeof o.y0==='number')?o.y0:0, _yt=(typeof o.y1==='number')?o.y1:(o.h||0);
    if(!(o.rail||o.slab)&&typeof py==='number'&&(py<_yb||py>_yt))continue;
    /* 【batch193】定向墙：AABB 粗筛 + 点判定 → 直接"圆 ↔ 定向矩形"。
       原来 AABB 粗筛会把斜墙外面那一圈空气也算进来，配合点判定，子弹/射线在墙角
       会被一堵看不见的墙挡住。现在和其它障碍同口径。 */
    if(o.spWall){ if(o.rising)continue; if(typeof py==='number'&&(py<o.y0||py>o.y1))continue; if(obsWallDist2(o,x,z).d2<r*r)return true; continue; }
    if(stepUp&&o.kind==='terrain'&&typeof py==='number'&&(py-GROUND_Y)>=o.h-modStepUp())continue;
    if(x+r>o.minX&&x-r<o.maxX&&z+r>o.minZ&&z-r<o.maxZ)return true;
  }
  return false;
}
