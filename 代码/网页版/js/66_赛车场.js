/* ============================================================================
   ⚠️⚠️ 【batch263】这张地图**暂不启用**（用户：玩法还不成熟，先下线）。
   现状：
     · index.html 里这一行的 <script> 已经注释掉 → 本文件不会被加载；
     · 所以下面这段 `MAPS.push({id:'racing'...})` 不会执行，选图面板里不出现；
     · 服务端 MAP_IDS / MAP_NAMES / MAP_SPAWNS 也把 racing 去掉了。
   ✅ 恢复方法（三处一起改，缺一不可）：
     1) index.html 取消 `<script src="js/66_赛车场.js?v=...">` 那行的注释；
     2) 服务端.js 的 MAP_IDS 加回 'racing'、MAP_NAMES / MAP_SPAWNS 补回 racing 条目；
     3) 同步工具的「分片表」里加回 [ 'js/66_赛车场.js', '/* 【batch262】新地图：赛车场（js/66_赛车场.js）...' ]，
        并把本文件内容手工拼进唯一源（最后一个 </script> 之前），工具才认。
   已知没解决的问题（下次要接着改）：
     · 跑道"实体感"仍然靠地形+路面几何，没有真正的碰撞箱（用户三次投诉的点）；
     · 跳台落点会随车速变化，车速足够快时会飞进弯道；
     · 玩法单薄：没有圈数、没有计时、没有对手。
   ============================================================================ */
/* 【batch262】新地图：赛车场（js/66_赛车场.js）================================================
   用户要的：① 比日蚀环城大 3 倍；② 一圈赛车跑道围着地图；③ 地板和别人不一样；
            ④ 地形蜿蜒起伏、偏山丘，而且山丘是**完全圆滑**的（不是几个方块拼的）；
            ⑤ 车道边上随机刷现有三种车。

   ── 尺寸口径（为什么是"半径 170"）──
   日蚀环城是椭圆 a=104 / b=88，面积 π·104·88 ≈ 2.87 万 m²。
   这里做成方形世界半径 170（limit=170，实际可玩区是圆形），面积 π·170² ≈ 9.08 万 m²
   ≈ **3.16 倍**。取 3 倍面积而不是 3 倍边长（那会是 9 倍＝620 米，低端机直接跪）。

   ── 地形为什么是"解析函数"而不是堆方块 ──
   山丘由 3 个低频正弦 + 十几个**高斯凸包**叠加而成（高斯处处无穷阶可导 → 天生圆滑，
   没有任何折线/棱角），同一份函数既生成视觉网格、又供 groundHeightAt 采样，
   于是"看到的地面"和"站上去的地面"永远一致（这是堆方块做不到的）。
   视觉用一张 168×168 段的整块地形网格 + computeVertexNormals 平滑着色 = 1 个 draw call。

   ── 三条铁律 ──
   ① 地形不参与 obstacles（它是"可走的坡"，不是墙）。玩家 y 每帧吸附 groundHeightAt，
      所以上下坡天然顺滑；坡度过陡才走不上去（本图最陡约 20°，能走）。
   ② 赛道带（|赛道距离| < 9.5 米）必须**压平**到路面高度，两侧 9.5→26 米平滑过渡 ——
      路面高差超过 1 米车就会弹起来，压平后才开得爽。
   ③ 边界环山从 r=146 才抬起（不是 132）：给赛道外侧留出 34 米缓冲带放看台/龙门，
      不然看台会被山坡埋掉半个。

   ⚠️ 载具不在 MAP_GROUP 里（它 add 到 scene），所以**换图必须 载具.清空()**，
      否则车会跟着飘到别的图（`赛车场_收车()` 挂在 setMap 包装里）。
   ⚠️ 地图尺寸超了相机远平面（far=300）：对角 480 米会被整块裁掉，
      所以 00_升级与场景.js 里 far 改成了 620（见那里的注释）。
   ============================================================================ */
var 赛车场_半=166;              // 世界半径（worldLimit）＝边界桩所在半径：撞到的是**看得见的路障**，不是桩缝里的空气墙
var 赛车场_网格半=200;          // 地形网格覆盖 ±200（世界 170，多铺 30 米以免站在山顶看见网格边缘）
var 赛道_半=112;                // 跑道中心线的圆角矩形半边长
var 赛道_圆角=48;               // 圆角半径（四段直道各 128 米 + 四个 R48 弯）
var 赛道_带宽=9;                // 半宽（整条路 18 米，够三辆车并排）
var 赛道_边线内=7.4;            // 白色边线的位置（相对中心线）
var 赛车场_已建=false;
var 赛车场_网格={地形:null,跑道:null,起点线:null};   // 调试 / 探针用（别在玩法里依赖它）

/* 0..1 的平滑过渡（smoothstep）：地形拼接处绝不能出现硬边 */
function 赛车场_平滑(a,b,v){
  var t=(v-a)/(b-a);
  if(t<=0)return 0; if(t>=1)return 1;
  return t*t*(3-2*t);
}
/* 到跑道中心线的**有符号距离**（圆角矩形的 SDF：场内为负、场外为正）
   为什么用 SDF 而不是"沿路径找最近点"：SDF 是纯解析的、每帧几十次调用也不心疼，
   而且它天然给出"离路边多远"，压平过渡、路肩、刷车点全都能直接用它。
   （公式 = 圆角矩形的 signed distance：max(q,0) 的长度 + min(max(q),0) − 圆角半径） */
function 赛道距离(x,z){
  var r=赛道_圆角, h=赛道_半;
  var qx=Math.abs(x)-(h-r), qz=Math.abs(z)-(h-r);
  var ax=qx>0?qx:0, az=qz>0?qz:0;
  var outer=Math.sqrt(ax*ax+az*az);
  var inner=Math.max(qx,qz);
  if(inner>0)inner=0;
  return outer+inner-r;
}
/* 跑道路面本身的缓起伏：整张图共享的低频波，所以"路"和"山"是同一片大地，
   不会出现"路是平的、旁边山是斜的"那种贴上去的假路。振幅控制得很小（±1.2 米），
   车开过去像压过缓坡，不会飞起来。 */
function 赛车场_路面高(x,z){
  /* 【batch262b】振幅整体压到 ±0.5 米：原来 ±1.26 米的路面波浪，18 米宽的路看着不陡，
     但车速 30 m/s 时每 40 米就一个坡，车一直在"起飞-落地"，用户的原话是"开车开得很困难"。
     现在只在整圈留两三个极缓的长坡（视觉上仍不是一块平板），车不会自己飞起来。 */
  return 0.25*Math.sin(x*0.0125+0.9)*Math.cos(z*0.0102-0.35)
       + 0.18*Math.sin((x+z)*0.0195-1.7)
       + 0.10*Math.sin((x-z)*0.0281+2.4);
}
/* 山丘：低频正弦打底 + 高斯凸包叠加（**完全圆滑**的根源）
   每个高斯 a·exp(-d²/2r²)：a=峰高、r=影响半径；最大坡度 ≈ 0.61·a/r，
   下面这些参数都在 20° 以内（玩家能走上去，车也能爬缓坡）。 */
var 赛车场_山=[
  /* 【batch262b】"太崎岖、开车困难"：高度全部压到 0.6 倍、半径放大 1.25 倍
     （坡度 ≈ 0.61·a/r 直接砍半）。仍然是连绵山丘，但车能一路开过去、不会每 20 米飞一次。 */
  {x:  0, z:  0, r:58, a: 9},   // 中央主峰（地图正中，绕一圈都能看见）
  {x:-52, z: 26, r:38, a:10},
  {x: 40, z:-34, r:35, a: 8},
  {x:-16, z:-56, r:33, a:10},
  {x: 58, z: 44, r:30, a: 6},
  {x:-62, z:-30, r:28, a: 5.5},
  {x:-20, z: 70, r:25, a: 5},
  {x: 70, z: -8, r:23, a: 4},
  {x:-78, z:-62, r:25, a: 6},
  {x: 22, z: 62, r:20, a: 3.5},
  /* 赛道外圈的几座矮丘（放在没看台的方向，别挡住起跑区视线） */
  {x:-128,z:  86, r:32, a: 4},
  {x: 126,z: -72, r:30, a: 3.5},
  {x:-118,z: -98, r:28, a: 5}
];
function 赛车场_山丘(x,z){
  var h=1.05*Math.sin(x*0.0128+0.7)*Math.cos(z*0.0107-0.3)
      + 0.55*Math.sin(x*0.0271-1.1)*Math.sin(z*0.0233+2.2)
      + 0.30*Math.cos((x*0.9+z*0.6)*0.0455+0.4);
  for(var i=0;i<赛车场_山.length;i++){
    var p=赛车场_山[i], dx=x-p.x, dz=z-p.z;
    h+=p.a*Math.exp(-(dx*dx+dz*dz)/(2*p.r*p.r));
  }
  return h;
}
/* 【唯一的地形口径】视觉网格、groundHeightAt、载具探地、刷车点，全部只认这一个函数。
   改动任何一条参数，视觉与物理都会一起变 —— 不允许出现"第二份地形"。 */
function 赛车场_地形高(x,z){
  var d=Math.abs(赛道距离(x,z));
  var 路=赛车场_路面高(x,z);
  var t=赛车场_平滑(赛道_带宽+1, 44, d);         // 0=赛道上，1=完全山丘（44 米过渡＝路边一大圈缓坡缓冲区）
  var h=路+(赛车场_山丘(x,z)-路)*t;
  /* 【batch262b】路基：赛道带内整体抬起 0.5 米，8→14 米过渡到草地。
     这样"跑道"是真的比草地高一层的路基（路肩有厚度），而不是一张贴在地面上的贴图；
     车/玩家的地面高度、跑道网格、起点线都用同一个值，不会穿模。 */
  /* ⚠️ 过渡起点必须 ≥ 路面半宽（9）：从 8 开始降的话，路面覆盖区（|d|≤9）里
     有两侧已经往下掉 3~7 厘米 —— 路面 ribbon 是直线连的，两边的地形却已经塌下去，
     视觉上路面就"浮"起来了（用户："跑道的贴图能不能贴着地面呀，不然我老是开到跑道下面"）。 */
  h+=0.5*(1-赛车场_平滑(9.5,15.5,d));
  /* ---------- 边界（三层碗壁，见文件顶部「边界口径」）----------
     ① 内环山脊：r=132 起缓抬，到 164 抬到 24~31 米（高低错落，不呆板）
        ⚠️ 别写成 e*e：平方会让山脚 150 米处才 1 米高，看着像"外面依然平地"，
           实际上 168 米处突然 25 米，形成一道突兀的墙。线性过渡才是自然的碗壁。
        ⚠️ 起点别早于 130：赛道在 112，太早上坡会把 122..134 的看台顶到半山腰。
     ② 外环高峰：r=176 起再抬 40 米，到 208（网格边缘之外）达到 70 米。
        作用是把"地形网格边缘"彻底挡住 —— 玩家能走到 r=170 的山脊上，
        如果没有这层，平视前方 30 米就是网格的方形切边（一眼穿帮）。
        有了它，站在山脊上看到的是"还有更高的山"，像真正被群山围住的赛车场。
     ③ 可见边界：r=166 的山脊上立一圈红白路障（见 赛车场_建边界桩），
        limit=170 的隐形墙只是最后的兜底，玩家先看到/撞到的是路障。 */
  var rr=Math.sqrt(x*x+z*z);
  var e=赛车场_平滑(132,164,rr);
  h+=e*(24+7*Math.sin(Math.atan2(z,x)*3+1.2));
  var e2=赛车场_平滑(176,208,rr);
  h+=e2*40;
  return h;
}
/* ==================== 视觉：草地/岩坡地形（一块整网格）====================
   贴图只提供"颗粒细节"（灰度噪点），**颜色全部来自顶点色** —— 这样草地、山坡、
   干土三种材质共用一张贴图、一个材质、一次 draw call，还没有接缝。
   （如果按材质分块拼，块与块之间一定会有缝，且拼不出圆滑过渡。） */
function 赛车场_地面纹理(){
  return _mkTex('raceGround',function(g,S){
    g.fillStyle='#e6e6e6';g.fillRect(0,0,S,S);
    /* 大块斑驳（模拟草地/泥土的深浅） */
    for(var i=0;i<180;i++){
      var v=200+((Math.random()*56)|0);
      g.fillStyle='rgba('+v+','+v+','+v+',0.10)';
      var r=8+Math.random()*46;
      g.beginPath();g.arc(Math.random()*S,Math.random()*S,r,0,6.283);g.fill();
    }
    /* 细颗粒 */
    for(var k=0;k<5200;k++){
      var v2=170+((Math.random()*80)|0);
      g.fillStyle='rgba('+v2+','+v2+','+v2+',0.16)';
      g.fillRect(Math.random()*S,Math.random()*S,2,2);
    }
    /* 草叶短线（近距离看得出是草，不是水泥） */
    g.strokeStyle='rgba(210,210,210,0.22)';g.lineWidth=1;
    for(var b=0;b<900;b++){
      var x=Math.random()*S,y=Math.random()*S;
      g.beginPath();g.moveTo(x,y);g.lineTo(x+(Math.random()*3-1.5),y-2-Math.random()*3);g.stroke();
    }
  },512);
}
/* 顶点色：草绿 → 干黄 → 岩灰，按高度与坡度过渡 */
function 赛车场_地表色(h,坡度,tmp,x,z){
  /* 低处：晒过的草绿；中段：草黄；高处/陡坡：岩石灰
     坡度＝法线 y 分量（1=平地，越小越陡）→ 用 1-smoothstep 把陡坡推向岩色 */
  var 草=[0.34,0.52,0.26], 黄=[0.53,0.53,0.30], 岩=[0.58,0.56,0.50];
  var c1=赛车场_平滑(4,15,h);              // 草 → 黄
  var c2=赛车场_平滑(20,30,h);             // 黄 → 岩（只有边界山最高处才转岩，中央主峰保持草色）
  var c3=(1-赛车场_平滑(0.45,0.74,坡度))*0.5;   // 越陡越岩（只推一半：全推会把陡坡压成黑幕，远看像一块黑板）
  var r=草[0]+(黄[0]-草[0])*c1, gg=草[1]+(黄[1]-草[1])*c1, b=草[2]+(黄[2]-草[2])*c1;
  r+=(岩[0]-r)*c2; gg+=(岩[1]-gg)*c2; b+=(岩[2]-b)*c2;
  r+=(岩[0]-r)*c3; gg+=(岩[1]-gg)*c3; b+=(岩[2]-b)*c3;
  /* 低频明暗：**必须用平面坐标做扰动**，不能用 sin(高度)。
     按高度做明暗 = 沿等高线刷出一道道横纹，山坡上看着就是"阴影条纹/斑马纹"
     （我第一次截图就以为是 shadow acne，其实是顶点色画出来的）。 */
  var n=0.93+0.07*(Math.sin(x*0.083+z*0.061)+Math.sin(x*0.037-z*0.052))*0.5;
  tmp[0]=r*n; tmp[1]=gg*n; tmp[2]=b*n;
}
function 赛车场_建地形(){
  var N=190, S=赛车场_网格半*2, step=S/N;
  var 顶点数=(N+1)*(N+1);
  var pos=new Float32Array(顶点数*3), uv=new Float32Array(顶点数*2), col=new Float32Array(顶点数*3);
  var H=new Float32Array(顶点数);            // 先算一遍高度（差分复用，省 2/3 的采样开销）
  var idx=[];
  var tmp=[0,0,0], p=0, q=0, c=0, i, j;
  for(j=0;j<=N;j++){
    for(i=0;i<=N;i++){
      H[j*(N+1)+i]=赛车场_地形高(-赛车场_网格半+i*step, -赛车场_网格半+j*step);
    }
  }
  for(j=0;j<=N;j++){
    for(i=0;i<=N;i++){
      var x=-赛车场_网格半+i*step, z=-赛车场_网格半+j*step;
      var k=j*(N+1)+i, h=H[k];
      pos[p++]=x; pos[p++]=h; pos[p++]=z;
      /* UV：每 16 米平铺一次（纹理是 512，细节足够；太密会闪） */
      uv[q++]=x/16; uv[q++]=z/16;
      /* 坡度：用网格差分（不额外采样地形，建图时间省 2/3）；边缘取自身 → 差分为 0 */
      var kx=(i<N)?k+1:k, kz=(j<N)?k+(N+1):k;
      var hx=(H[kx]-h)/step, dz=(H[kz]-h)/step;
      var 坡=1/Math.sqrt(1+hx*hx+dz*dz);
      赛车场_地表色(h,坡,tmp,x,z);
      col[c++]=tmp[0]; col[c++]=tmp[1]; col[c++]=tmp[2];
    }
  }
  for(var jj=0;jj<N;jj++){
    for(var ii=0;ii<N;ii++){
      var a=jj*(N+1)+ii, b2=a+1, cc=a+(N+1), d=cc+1;
      idx.push(a,cc,b2, b2,cc,d);      // 逆时针（法线朝上）
    }
  }
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  geo.setIndex(idx);
  geo.computeVertexNormals();          // 顶点法线 → Gouraud 平滑着色 = "圆滑"的观感来源
  var mat=new THREE.MeshLambertMaterial({map:赛车场_地面纹理(),vertexColors:true});
  var mesh=new THREE.Mesh(geo,mat);
  mesh.receiveShadow=true;
  /* ⚠️ 不打 _可合并：mergeMapGroup 只吃 BoxGeometry，这块本来就该独立成一块 */
  _mapTarget.add(mesh);
  赛车场_网格.地形=mesh;
  return mesh;
}
/* ==================== 视觉：跑道 ====================
   沿圆角矩形中心线均匀取点，往两侧各推 9 米，连成三角带（ribbon）。
   UV：u 横向 0..1（贴图里画边线），v 沿路（每 8 米重复一次，白线才是连续的一条）。 */
function 赛车场_路径(段数){
  var pts=[],i,t,r=赛道_圆角,h=赛道_半;
  var L=h-r;                                  // 直道半长（112-48=64）
  /* 八段：北直道 → 东北弯 → 东直道 → 东南弯 → 南直道 → 西南弯 → 西直道 → 西北弯
     ⚠️ 顺序必须首尾相接、同向绕圈，否则 ribbon 会自己打结 */
  /* ⚠️ 四个弯的**角度必须递减**（逆时针绕圈 = 角度减）：
        东北 90°→0°、东南 0°→-90°、西南 270°→180°、西北 180°→90°。
        我第一版写成了 +k·90°，结果每个弯都从"终点"绕到"起点"，
        路径在弯道处来回折返 —— 弯上的点跑到赛道内侧 48 米的地方去，
        车就被刷到地图中央了（探针报"离路 73 米"）。 */
  var 段=[
    function(k){ return [ -L+2*L*k,  h ]; },                         // 北直道 +x
    function(k){ var a=(1-k)*Math.PI/2; return [ L+r*Math.cos(a),  L+r*Math.sin(a) ]; },   // 东北弯
    function(k){ return [  h,  L-2*L*k ]; },                         // 东直道 -z
    function(k){ var a=-k*Math.PI/2;   return [ L+r*Math.cos(a), -L+r*Math.sin(a) ]; },    // 东南弯
    function(k){ return [ L-2*L*k, -h ]; },                          // 南直道 -x
    function(k){ var a=1.5*Math.PI-k*Math.PI/2; return [ -L+r*Math.cos(a), -L+r*Math.sin(a) ]; }, // 西南弯
    function(k){ return [ -h, -L+2*L*k ]; },                         // 西直道 +z
    function(k){ var a=Math.PI-k*Math.PI/2; return [ -L+r*Math.cos(a), L+r*Math.sin(a) ]; }       // 西北弯
  ];
  var 每段=Math.max(8,Math.round(段数/8));
  for(i=0;i<段.length;i++){
    for(var k=0;k<每段;k++){
      /* k 取 [0,1)：段与段之间不自重复，接缝靠下一段的 0 点连上 */
      var o=段[i](k/每段);
      pts.push({x:o[0],z:o[1]});
    }
  }
  /* 切线（前后差分）与累计弧长 */
  for(i=0;i<pts.length;i++){
    var a2=pts[(i-1+pts.length)%pts.length], b2=pts[(i+1)%pts.length];
    var dx=b2.x-a2.x, dz=b2.z-a2.z, L2=Math.sqrt(dx*dx+dz*dz)||1;
    pts[i].tx=dx/L2; pts[i].tz=dz/L2;
    pts[i].nx=-pts[i].tz; pts[i].nz=pts[i].tx;      // 法线（左侧）
    var pv=pts[(i-1+pts.length)%pts.length];
    pts[i].s=(i===0?0:(pv.s||0)+Math.sqrt(Math.pow(pts[i].x-pv.x,2)+Math.pow(pts[i].z-pv.z,2)));
  }
  return pts;
}
/* 【batch262c】这张贴图已停用：跑道顶面改成纯色材质 + 实体路缘/标线。函数留作备查。 */
function 赛车场_沥青纹理(){
  var t=_mkTex('raceRoad',function(g,S){
    g.fillStyle='#3c4046';g.fillRect(0,0,S,S);
    /* 沥青颗粒 */
    for(var k=0;k<7000;k++){
      var v=44+((Math.random()*40)|0);
      g.fillStyle='rgba('+v+','+(v+2)+','+(v+5)+',0.55)';
      g.fillRect(Math.random()*S,Math.random()*S,2,2);
    }
    /* 两侧**红白路肩**（每 1/8 贴图长度换一次色 → 沿路是红白相间的赛道牙子） */
    var 肩宽=S*0.055, 段数=8, 段高=S/段数;
    for(var r2=0;r2<段数;r2++){
      var 红白=(r2%2)===0;
      g.fillStyle=红白?'#c8402f':'#eceae0';
      g.fillRect(0,r2*段高,肩宽,段高);
      g.fillRect(S-肩宽,r2*段高,肩宽,段高);
    }
    /* 白边线（路肩内侧） */
    g.fillStyle='rgba(236,238,232,0.95)';
    g.fillRect(S*0.055,0,S*0.022,S);
    g.fillRect(S-肩宽-S*0.022,0,S*0.022,S);
    /* 中间虚线（沿 v 方向循环，每张贴图 4 段） */
    g.fillStyle='rgba(226,228,220,0.55)';
    for(var d2=0;d2<4;d2++) g.fillRect(S*0.487,S*(d2/4+0.06),S*0.026,S*0.115);
  },512);
  t.wrapS=THREE.ClampToEdgeWrapping;     // 横向只铺一次（边线不能重复）
  t.wrapT=THREE.RepeatWrapping;          // 纵向无限平铺
  return t;
}
function 赛车场_建跑道(){
  var pts=赛车场_路径(560);
  var n=pts.length;
  /* 【batch262f】高抬 0.075 → 0.012：0.075 是"怕 z-fighting"随手给的，
     结果车/人贴的是地形高，视觉路面比它高 7.5 厘米 → 车轮被路面切掉一截，
     用户看着就是"开到跑道下面去了"。1.2 厘米足够避免闪面（再配合 polygonOffset），
     同时车轮压在路上几乎看不出来。 */
  var 外=赛道_带宽, 高抬=0.012;
  var 总长=pts[n-1].s||1;
  /* 沿弧长取路径点（放路缘石 / 点线用） */
  function 取点(距){
    for(var i=1;i<n;i++){ if((pts[i].s||0)>=距) return pts[i]; }
    return pts[n-1];
  }
  /* 纯装饰方块：**不进 obstacles**（只挡眼睛不挡车），标 _可合并 → 建图结束并成 1~2 个网格。
     ⚠️ 不能旋转：mergeMapGroup 只吃 position/scale，rotation 会被丢掉 → 一律用正方形截面。 */
  var 黑=new THREE.MeshLambertMaterial({color:0x24262a});
  var 白=new THREE.MeshLambertMaterial({color:0xe8e6dc});
  var 红=new THREE.MeshLambertMaterial({color:0xc2402f});
  function 块(x,y,z,w,h,d,mat){
    var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    m.position.set(x,y,z);
    m.userData._可合并=1;
    _mapTarget.add(m);
    return m;
  }

  /* ---------- ① 路面：**一整块连续平滑的路面** ----------
     【batch262e】上一版把路面拆成 179 块板、留 16cm 缝、还加 ±1.5cm 沉降差 ——
     用户实测："车开的一抽一抽的"。原因很直白：车的四角探地每 6 米换一次基准高度，
     每过一道缝就短暂离地 → 一颠一颠，完全没法开。
     **路面顶面必须连续平滑**，这是驾驶手感的第一前提。
     所以这里回到一张连续的 ribbon（和地形高度完全一致，误差 0），
     "实体感"改由这些东西表达（它们都不参与碰撞、不会颠）：
       · 路基侧面（0.62 米厚的裙边，路是垫高的）
       · 红白路缘石（一颗颗实体方块）
       · 实体白边线 + 中路反光钉
       · 四条直道的跳台（那个颠是故意的，用来腾空）
     要"能站能撞"的碰撞：路面就是地形的一段（压平后连续），
     再加跳台/看台/龙门这些实心体，车压上去有反馈。 */
  var pos=[], col=[], idx=[];
  for(var i=0;i<n;i++){
    var p=pts[i];
    var lx=p.x+p.nx*外, lz=p.z+p.nz*外;
    var rx=p.x-p.nx*外, rz=p.z-p.nz*外;
    /* ⚠️ 这里必须加 `赛车场_跳台高`：路面 ribbon 是"视觉路面"，而物理地面
       （TERRAIN_H = 地形 + 跳台）已经包含跳台 —— 两边不一致的话，
       车会开在路面上方/下方，跳台看起来就是"贴在路面上的贴纸"。
       加进来之后，路面自己就鼓成跳台了（跳台模型只负责立面和警示条）。 */
    var ly=赛车场_地形高(lx,lz)+赛车场_跳台高(lx,lz)+高抬;
    var ry=赛车场_地形高(rx,rz)+赛车场_跳台高(rx,rz)+高抬;
    pos.push(lx,ly,lz, rx,ry,rz);
    /* 顶点色：整条路一个色（只有极轻微的老化明暗，看不出图案） */
    var g0=0.97+0.03*Math.sin((p.s||0)*0.12);
    col.push(g0,g0,g0, g0,g0,g0);
  }
  for(var j=0;j<n;j++){
    var j2=(j+1)%n; var a=j*2,b=a+1,c=j2*2,d=c+1;
    idx.push(a,c,b, b,c,d);
  }
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  /* ⚠️ side:DoubleSide：单面材质从稍微偏下的角度看会被背面剔除 → 路面"消失"，
     只剩下面的地形，看着就像"开到了跑道下面"。polygonOffset 把路面往镜头方向挪一点点，
     和地形网格（同一高度）之间不再闪面。 */
  var mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({
    color:0x45484e, vertexColors:true, side:THREE.DoubleSide,
    polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-2
  }));
  mesh.receiveShadow=true;
  _mapTarget.add(mesh);
  赛车场_网格.跑道=mesh;

  /* ①-b 垫层：连续一层深色混凝土（低 14cm）。板缝里看到的就是它 ——
     没有这层的话，16cm 的缝里直接露出草地，看着像"路面上长草"，反而更假。 */
  (function(){
    var P=[], I=[];
    var r2=外-0.06;
    for(var i=0;i<n;i++){
      var p=pts[i];
      var lx=p.x+p.nx*r2, lz=p.z+p.nz*r2;
      var rx=p.x-p.nx*r2, rz=p.z-p.nz*r2;
      P.push(lx,赛车场_地形高(lx,lz)+高抬-0.14, lz, rx,赛车场_地形高(rx,rz)+高抬-0.14, rz);
    }
    for(var j=0;j<n;j++){
      var j2=(j+1)%n; var a2=j*2,b2=a2+1,c2=j2*2,d2=c2+1;
      I.push(a2,c2,b2, b2,c2,d2);
    }
    var gg=new THREE.BufferGeometry();
    gg.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
    gg.setIndex(I); gg.computeVertexNormals();
    var mm=new THREE.Mesh(gg,new THREE.MeshLambertMaterial({color:0x2c2e33,side:THREE.DoubleSide}));
    mm.receiveShadow=true;
    _mapTarget.add(mm);
  })();

  /* ---------- ② 白色边线：两条**实体细带**（几何体，不是画上去的线） ---------- */
  function 建边线(偏移, 宽, 色){
    var P=[], I=[];
    for(var i=0;i<n;i++){
      var p=pts[i];
      var cx=p.x+p.nx*偏移, cz=p.z+p.nz*偏移;
      var ax=cx+p.nx*(宽/2), az=cz+p.nz*(宽/2);
      var bx=cx-p.nx*(宽/2), bz=cz-p.nz*(宽/2);
      P.push(ax,赛车场_地形高(ax,az)+赛车场_跳台高(ax,az)+高抬+0.02, az,
             bx,赛车场_地形高(bx,bz)+赛车场_跳台高(bx,bz)+高抬+0.02, bz);
    }
    for(var j=0;j<n;j++){
      var j2=(j+1)%n; var a2=j*2,b2=a2+1,c2=j2*2,d2=c2+1;
      I.push(a2,c2,b2, b2,c2,d2);
    }
    var gg=new THREE.BufferGeometry();
    gg.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
    gg.setIndex(I);
    gg.computeVertexNormals();
    var mm=new THREE.Mesh(gg,new THREE.MeshLambertMaterial({color:色,side:THREE.DoubleSide}));
    _mapTarget.add(mm);
    return mm;
  }
  建边线(外-0.85,0.30,0xe8e6dc);
  建边线(-(外-0.85),0.30,0xe8e6dc);

  /* ---------- ③ 中路点线：一颗颗**实体反光钉**（沿路每 4.5 米一个） ---------- */
  for(var s1=0;s1<总长;s1+=4.5){
    var p1=取点(s1);
    var y1=赛车场_地形高(p1.x,p1.z)+赛车场_跳台高(p1.x,p1.z)+高抬+0.015;
    块(p1.x,y1,p1.z,0.46,0.03,0.46,白);
  }

  /* ---------- ④ 红白路缘石：两侧每 0.85 米一块**实体块**（几乎连成一条，像真赛道的路牙） ---------- */
  var 缘=0;
  for(var s2=0;s2<总长;s2+=0.85){
    var p2=取点(s2);
    var 红白=(缘%2)===0?红:白;
    for(var k=-1;k<=1;k+=2){
      var cx2=p2.x+p2.nx*(外-0.30)*k, cz2=p2.z+p2.nz*(外-0.30)*k;
      var y2=赛车场_地形高(cx2,cz2)+赛车场_跳台高(cx2,cz2)+高抬+0.145;
      块(cx2,y2,cz2,0.80,0.30,0.80,红白);
    }
    缘++;
  }

  /* ---------- ⑤ 路基裙边：路面板的侧面（深灰混凝土，厚 0.62 米） ---------- */
  var 裙高=0.62;
  var 裙pos=[], 裙idx=[];
  for(var q=0;q<n;q++){
    var pq=pts[q];
    var lx2=pq.x+pq.nx*外, lz2=pq.z+pq.nz*外;
    var rx2=pq.x-pq.nx*外, rz2=pq.z-pq.nz*外;
    var ly2=赛车场_地形高(lx2,lz2)+赛车场_跳台高(lx2,lz2)+高抬;
    var ry2=赛车场_地形高(rx2,rz2)+赛车场_跳台高(rx2,rz2)+高抬;
    裙pos.push(lx2,ly2,lz2, lx2,ly2-裙高,lz2,  rx2,ry2,rz2,  rx2,ry2-裙高,rz2);
  }
  for(var q2=0;q2<n;q2++){
    var q3=(q2+1)%n, A=q2*4, B2=q3*4;
    裙idx.push(A,B2,A+1, A+1,B2,B2+1);
    裙idx.push(A+2,A+3,B2+2, A+3,B2+3,B2+2);
  }
  var 裙geo=new THREE.BufferGeometry();
  裙geo.setAttribute('position',new THREE.Float32BufferAttribute(裙pos,3));
  裙geo.setIndex(裙idx);
  裙geo.computeVertexNormals();
  var 裙=new THREE.Mesh(裙geo,new THREE.MeshLambertMaterial({color:0x6a7078,side:THREE.DoubleSide}));
  _mapTarget.add(裙);
  赛车场_网格.路基=裙;

  /* ---------- ⑥ 起点格子线：也改成实体方块拼的（不再是贴图平面） ---------- */
  for(var gx=0;gx<8;gx++)for(var gz=0;gz<2;gz++){
    var bx3=-赛道_带宽+(gx+0.5)*(赛道_带宽*2/8);
    var bz3=赛道_半+(gz-0.5)*1.62;
    var by3=赛车场_地形高(bx3,bz3)+赛车场_跳台高(bx3,bz3)+高抬+0.022;
    块(bx3,by3,bz3,(赛道_带宽*2/8)*0.96,0.03,1.55,((gx+gz)%2)?白:黑);
  }
  赛车场_网格.起点线=true;
  return mesh;
}

/* ==================== 赛道跳台（平顺助跑坡 + 直接落空）====================
   用户两轮的要求合起来是：
     · 「为什么实现悬空那么难？不是有高低落差就能悬空吗」→ 要有真落差；
     · 「你的跳台不能是平的吗？」→ 别做成一级级台阶（那样车上去一格一格颠）。
   定案：**连续平滑的助跑坡 + 末端直接落空**，没有台阶。
     · 坡面：h = H·s²（s 从 0 到 1 表示从坡脚到坡顶）
       起端坡度 0（车平顺地压上去，不会"咯噔"），越接近坡顶越陡（末端坡度 2H/L），
       车在坡顶拿到最大上升速度 = 车速 × 末端坡度 → 自然抛出去。
     · 坡顶 u>0 高度直接归零（断崖）：车带着上升速度腾空，这才是真落差。
   ⚠️ 物理与视觉必须分开做，原因两个：
     ① 地形网格间距 2.1 米，坡长 7 米只有 3 个采样点 —— 画出来是折线，
        断崖还会被插值成 2 米宽的斜披（看着像缓坡，实际物理是垂直断崖，穿帮）；
     ② 所以坡面用**独立高精度模型**（沿路 0.27 米一段），而物理走 `赛车场_跳台高`
        （加在 TERRAIN_H 上），两边的公式是同一份，绝对不会对不上。
   ⚠️ 跳台模型不进 obstacles：它是"可开上去的地面"，不是墙；
      黄色警示条只画在断崖立面上（那里车撞不到）。 */
var 跳台_高=1.15, 跳台_长=7.0, 跳台_半宽=9.0;
/* 【位置口径】坡顶放在直道**后段**（离弯道入口 38 米）：
     · 直道半长 L = 112-48 = 64，所以直道是 x∈[-64,64]；坡脚在 +19，车有一整条直道加速；
     · 落点 ≈ +54（仍在直道上），**不会撞起点龙门的立柱**（x=±13，坡脚离它 6 米）；
     · 之前放在 x=±24（直道正中）时，飞出去正好撞 x=-13 的立柱（实测落点 -15.7、末速 0）——
       直道正中是龙门，跳台必须避开它。 */
var 跳台_表=[
  {cx: 26,      cz: 赛道_半, ux: 1, uz: 0},   // 北直道，车流 +x
  {cx: 赛道_半, cz:-26,      ux: 0, uz:-1},   // 东直道，车流 -z
  {cx:-26,      cz:-赛道_半, ux:-1, uz: 0},   // 南直道，车流 -x
  {cx:-赛道_半, cz: 26,      ux: 0, uz: 1}    // 西直道，车流 +z
];
/* 物理口径：返回"在路面上要再抬多少"（0 = 不在跳台上）。
   加在 TERRAIN_H 上（见 setMap 包装），所以视觉路面、车的四角探地、
   玩家脚下、子弹撞山，全都自动认这个跳台。 */
function 赛车场_跳台高(x,z){
  var best=0;
  for(var i=0;i<跳台_表.length;i++){
    var t=跳台_表[i];
    var dx=x-t.cx, dz=z-t.cz;
    var u=dx*t.ux+dz*t.uz;                 // 沿行车方向
    if(u<-跳台_长||u>0)continue;            // 坡脚之前 / 已过坡顶（断崖之后）
    var v=Math.abs(dx*t.uz-dz*t.ux);       // 横向
    if(v>跳台_半宽)continue;                // 只在路宽内（外侧是草地，不做坡）
    var s=(u+跳台_长)/跳台_长;              // 0=坡脚，1=坡顶
    var y=跳台_高*s*s;
    if(y>best)best=y;
  }
  return best;
}
/* 视觉：高精度楔形（顶面 + 断崖立面 + 两侧立面），一个跳台一块网格 */
function 赛车场_建跳台(){
  /* 顶面颜色和路面基色一致（0x45484e ≈ 0.27/0.28/0.31），
     坡顶 2 米刷黄黑警示条纹 —— 不然跳台和路面一个色，远处根本看不出来是个跳台
     （第一版截图就是这样：站在坡顶都看不出脚下有坡）。 */
  var 顶材=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});
  var 侧材=new THREE.MeshLambertMaterial({color:0x5c6068,side:THREE.DoubleSide});
  var 黄=new THREE.MeshBasicMaterial({color:0xd8a52a,side:THREE.DoubleSide});
  var 黑=new THREE.MeshBasicMaterial({color:0x1f2126,side:THREE.DoubleSide});
  var 段U=26, 段V=2;
  var 路抬=0.012;                            // 与 建跑道 里的 高抬 一致
  function 路面Y(x,z){ return 赛车场_地形高(x,z)+路抬; }

  for(var i=0;i<跳台_表.length;i++){
    var t=跳台_表[i];
    var ax=t.ux, az=t.uz;                    // 沿路单位向量
    var bx=-t.uz, bz=t.ux;                   // 横向单位向量
    /* ---------- ① 坡顶警示带（黄黑相间，只铺坡顶最后 2.2 米） ----------
       整片顶面**不再画**：路面 ribbon 已经含 `赛车场_跳台高`，路面自己就鼓成坡了，
       这里再画一层同色顶面只会和路面争像素（z-fighting）。
       只留一条贴着坡面的警示带 —— 它是"涂在坡上"的，抬高 6 毫米。 */
    var 带长=3.0, 带段=10, 带V=2;
    var P=[], I=[], C=[];
    for(var a=0;a<=带段;a++){
      var u=-带长+带长*a/带段;                    // -3.0 → 0
      var s=(u+跳台_长)/跳台_长;
      var 色=((a/1)|0)%2 ? [0.86,0.66,0.15] : [0.10,0.11,0.13];
      for(var b=0;b<=带V;b++){
        var v=-跳台_半宽+2*跳台_半宽*b/带V;
        var px=t.cx+ax*u+bx*v, pz=t.cz+az*u+bz*v;
        P.push(px, 路面Y(px,pz)+跳台_高*s*s+0.006, pz);
        C.push(色[0],色[1],色[2]);
      }
    }
    for(var a2=0;a2<带段;a2++){
      for(var b2=0;b2<带V;b2++){
        var i0=a2*(带V+1)+b2, i1=i0+1, i2=i0+(带V+1), i3=i2+1;
        I.push(i0,i2,i1, i1,i2,i3);
      }
    }
    var g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(C,3));
    g.setIndex(I); g.computeVertexNormals();
    var m=new THREE.Mesh(g,顶材);
    _mapTarget.add(m);

    /* ---------- ② 断崖立面 + 两侧立面（深灰，让跳台看着是"垫起来的一块实体"） ----------
       ⚠️ 断崖立面往里收 0.06 米（-u 方向），避免和顶面的最后一条边共面闪面。 */
    var 立=[], 立I=[];
    /* 断崖面：从坡顶高度垂直落到路面 */
    var 顶=跳台_高;
    var u2=-0.02;
    var 四角=[];
    for(var k=-1;k<=1;k+=2){
      var v2=k*跳台_半宽;
      var qx=t.cx+ax*u2+bx*v2, qz=t.cz+az*u2+bz*v2;
      四角.push([qx,qz]);
    }
    立.push(四角[0][0], 路面Y(四角[0][0],四角[0][1])+顶, 四角[0][1],
            四角[1][0], 路面Y(四角[1][0],四角[1][1])+顶, 四角[1][1],
            四角[0][0], 路面Y(四角[0][0],四角[0][1]), 四角[0][1],
            四角[1][0], 路面Y(四角[1][0],四角[1][1]), 四角[1][1]);
    立I.push(0,1,2, 1,3,2);
    /* 两侧立面：沿坡面往下到路面 */
    var 基=4;
    for(var s2=-1;s2<=1;s2+=2){
      var 起=基;
      for(var a3=0;a3<=段U;a3++){
        var u3=-跳台_长+跳台_长*a3/段U;
        var s3=(u3+跳台_长)/跳台_长;
        var v3=s2*跳台_半宽;
        var px3=t.cx+ax*u3+bx*v3, pz3=t.cz+az*u3+bz*v3;
        var y3=路面Y(px3,pz3);
        立.push(px3, y3+跳台_高*s3*s3, pz3, px3, y3, pz3);
      }
      for(var a4=0;a4<段U;a4++){
        var A4=起+a4*2;
        立I.push(A4,A4+1,A4+2, A4+1,A4+3,A4+2);
      }
      基=起+(段U+1)*2;
    }
    var g2=new THREE.BufferGeometry();
    g2.setAttribute('position',new THREE.Float32BufferAttribute(立,3));
    g2.setIndex(立I); g2.computeVertexNormals();
    _mapTarget.add(new THREE.Mesh(g2,侧材));

    /* ---------- ③ 断崖立面上的黄黑警示条（纯视觉，车撞不到） ---------- */
    for(var w=0;w<10;w++){
      var v4=-跳台_半宽+ (w+0.5)*(2*跳台_半宽/10);
      var qx4=t.cx+ax*u2+bx*v4, qz4=t.cz+az*u2+bz*v4;
      var yy=路面Y(qx4,qz4);
      var 条=new THREE.Mesh(new THREE.BoxGeometry(2*跳台_半宽/10*0.94, 顶*0.30, 0.10),
                            (w%2)?黑:黄);
      /* 条要朝着赛道（-u 方向）贴，但不旋转 —— 用中心点摆位即可（±u 方向只有 0.1 厚） */
      条.position.set(qx4 - ax*0.06, yy+顶*0.22, qz4 - az*0.06);
      条.rotation.y=Math.atan2(ax,az)+Math.PI/2;
      条.userData._可合并=0;                    // 带旋转 → 不参与合并
      _mapTarget.add(条);
    }
  }
}

/* ==================== 装饰：起点龙门 + 看台 + 旗杆 ====================
   都用 addBox/addLedge（会进 obstacles＝能挡人），位置全在赛道**外侧**的缓冲带，
   不会挡住行车线。 */
function 赛车场_建看台(){
  var 钢=new THREE.MeshLambertMaterial({color:0xb8bec6});
  var 座=new THREE.MeshLambertMaterial({color:0x3f6ea8});
  var 浅=new THREE.MeshLambertMaterial({color:0xc2c8d0});
  var 顶=new THREE.MeshLambertMaterial({color:0xd8dde3});
  /* ⚠️ 看台用「一排由矮到高、各自从地面长起来的实心台」砌成阶梯：
     · 用 addLedge(y0=当地地形高) 一级一级摆 → 40 米宽的地形两端差两三米，台阶悬空（第一版截图就是"飘着的板子"）；
     · 用一整块高基座 → 朝赛道那面是一堵 10 米高的墙，看不见台阶（第二版截图）；
     现在每级都 addBox 从 y=0 长到自己的高度，既不会悬空，又天然是一层层台阶。 */
  /* 【位置口径】看台必须紧贴赛道外侧的缓冲带（z 122..134）：
     放到 z=138 以外就上山坡了 —— 那里地形已经 6~8 米高，第一级台阶本身就是一堵高墙，
     从赛道看只有一个大方块（第二版截图）。放在缓冲带里，每级只比当地地面高 0.55 米，
     一级级抬起来才看得出是看台。 */
  var 级=5, 台深=2.2, 台宽=34, 台高=0.55, 起点z=122;
  for(var i=0;i<级;i++){
    var z=起点z+i*台深;
    var 地=赛车场_地形高(0,z);
    var h=地+台高*(i+1);                          // 顶面比当地地面高 0.55~2.75 米
    addBox(0,z,台宽,h,台深,(i%2)?座:浅);          // 从 y=0 长起来 → 绝不悬空
  }
  var 尾z=起点z+(级-1)*台深;
  var 顶面=赛车场_地形高(0,尾z)+台高*级;          // 最高一级的台面
  /* 顶棚 + 立柱（立柱从最高一级台面起） */
  addLedge(0,尾z+3.4,台宽+4,0.4,9,顶,'ledge',顶面+3.0);
  for(var px=-15;px<=15;px+=7.5){
    addLedge(px,尾z+3.4,0.42,3.0,0.42,钢,'ledge',顶面);
  }
  /* 起点龙门：两根立柱跨在赛道两侧（x=±13，正好在路肩外），横梁高 6.6 米 */
  for(var s=-1;s<=1;s+=2){
    var lx=s*13;
    var 柱高0=赛车场_地形高(lx,赛道_半);
    addLedge(lx,赛道_半,0.9,8.2,0.9,钢,'ledge',柱高0);
    addLedge(lx,赛道_半,1.6,0.5,1.6,顶,'ledge',柱高0+8.2);
  }
  /* 横梁上的横幅（红底 + 白条） */
  var 横地=赛车场_地形高(0,赛道_半);
  addLedge(0,赛道_半,26,1.5,0.6,new THREE.MeshLambertMaterial({color:0xd94b3a}),'ledge',横地+6.6);
  addLedge(0,赛道_半,26,0.5,0.7,new THREE.MeshLambertMaterial({color:0xf2f2ee}),'ledge',横地+5.9);
  /* 旗杆（赛道四角外侧） */
  var 旗色=[0xd94b3a,0x3c78c8,0xe8c84a,0x3f9a5a];
  var 角=[[80,80],[-80,80],[80,-80],[-80,-80]];
  for(var q=0;q<角.length;q++){
    var cx=角[q][0]*1.42, cz=角[q][1]*1.42;
    var gy=赛车场_地形高(cx,cz);
    addLedge(cx,cz,0.28,7,0.28,钢,'ledge',gy);
    addLedge(cx+1.1,cz,2.2,1.3,0.12,new THREE.MeshLambertMaterial({color:旗色[q]}),'ledge',gy+5.4);
  }
}
/* ==================== 可见边界：山脊上一圈红白路障 ====================
   为什么要有它：`limit=170` 只是**看不见的数值墙** —— 玩家走上去"撞空气"，
   完全不知道自己已经到边了（别的图都有 border 方块墙挡着）。
   这里沿 r=166 的山脊立一圈红白路障：看得见、撞得到，才是"地图边界"。
   ⚠️ 必须用 addBox（kind='border'）+ 从 y=0 长起来，不能用 addLedge：
      · addLedge 是 slab，跳起来（脚底高过 y1-0.3）会放行 → 能跳过边界；
      · border 类型在 playerBlocked 里**不认高度、永远挡**（这就是"边界墙"的正确口径）。
      柱子在地形以下的那 25 米埋在土里看不见（地形是不透明实体），
      露出来的就是一圈 1.2 米高的路障 —— 正好是赛车场护栏的样子。 */
function 赛车场_建边界桩(){
  /* 用**不受光照**的材质：路障本来就是反光板。用 Lambert 时背光那一面全黑，
     站在坡下往上看只有一条深灰带，根本看不出是红白路障（第一版截图就是这样）。 */
  var 红=new THREE.MeshBasicMaterial({color:0xd9382b});
  var 白=new THREE.MeshBasicMaterial({color:0xe8e6dc});
  var R=166, 间距=3.6, 个数=Math.round(2*Math.PI*R/间距);   // 间距 3.6 米：连起来看是一排护栏，不是一根根孤立的柱子
  for(var i=0;i<个数;i++){
    var a=i/个数*Math.PI*2;
    var x=Math.cos(a)*R, z=Math.sin(a)*R;
    var 地=赛车场_地形高(x,z);
    /* 露出地面 2.6 米：1.5 米只有走到跟前才看得见，从赛道看山脊是一片草坡；
       2.6 米才像"赛道护栏"，远处也能看出这是一圈边界 */
    addBox(x,z,1.3,地+2.6,1.3,(i%2)?红:白,'border');
  }
  return 个数;
}

/* ==================== 车辆：车道边随机刷（三种车）====================
   刷在**路肩上**（离中心线 7.2 米，还在 9 米路宽内），车头顺着切线方向：
   载具物理里前进是 -z（fx=-sin(yaw), fz=-cos(yaw)），所以 yaw 要按 -切线 来算。 */
var 赛车场_车型=['赛车','越野车','摩托'];
function 赛车场_刷新车辆(){
  if(typeof 载具==='undefined'||!载具||typeof 载具.生成!=='function')return 0;
  try{ 载具.清空(); }catch(e){}
  if(curMapId!=='racing')return 0;
  var pts=赛车场_路径(220), n=pts.length, 刷=0, 已用=[];
  for(var i=0;i<3;i++){
    /* 三次尝试找一个"离已有的车足够远"的点，找不到就退而求其次 */
    var 选=null;
    for(var tryN=0;tryN<24&&!选;tryN++){
      var k=(Math.random()*n)|0, p=pts[k];
      var 合=false;
      for(var e=0;e<已用.length;e++){
        var dx=p.x-已用[e].x, dz=p.z-已用[e].z;
        if(dx*dx+dz*dz<70*70){合=true;break;}
      }
      if(!合)选=p;
    }
    if(!选)选=pts[(Math.random()*n)|0];
    /* 【batch262d】别刷在跳台上（跳台高 0.75 米，车会半悬在上面）：
       跳台中心在四个直道的 ±24 处，离它 13 米内的点一律重选。 */
    var 跳台点=[[26,112],[112,-26],[-26,-112],[-112,26]];
    for(var 试=0;试<30;试++){
      var 撞台=false;
      for(var tq=0;tq<跳台点.length;tq++){
        var ddx=选.x-跳台点[tq][0], ddz=选.z-跳台点[tq][1];
        if(ddx*ddx+ddz*ddz<13*13){撞台=true;break;}
      }
      if(!撞台)break;
      选=pts[(Math.random()*n)|0];
    }
    已用.push(选);
    /* 路肩：左右随机一侧，偏 7.2 米（仍在路面内，不压到边线外的草地） */
    var side=(Math.random()<0.5)?1:-1;
    var x=选.x+选.nx*7.2*side, z=选.z+选.nz*7.2*side;
    /* 车头沿切线：载具前进是 -z（fx=-sin(yaw), fz=-cos(yaw)）→ yaw=atan2(-tx,-tz) */
    var yaw=Math.atan2(-选.tx,-选.tz);
    try{ 载具.生成(赛车场_车型[i%赛车场_车型.length], x, z, yaw); 刷++; }catch(err){}
  }
  return 刷;
}
function 赛车场_收车(){
  try{
    if(typeof 载具==='undefined'||!载具)return;
    /* ⚠️ 正在开车时直接 清空() 会把玩家丢在"没有武器、没有准星"的状态里
       （清空只把 驾驶=null，不恢复 weaponGroup / crosshair）→ 先正常下车再收车 */
    if(typeof 载具.在开车==='function'&&载具.在开车()){ try{ 载具.让玩家下车(); }catch(e){} }
    if(typeof 载具.清空==='function')载具.清空();
  }catch(e){}
}

/* ==================== 建图 ==================== */
function buildMapRacing(){
  try{
    赛车场_建地形();
    赛车场_建跑道();
    赛车场_建看台();
    赛车场_建跳台();
    赛车场_建边界桩();
    赛车场_已建=true;
  }catch(e){}
}
/* ==================== 注册（MAPS / 主题 / 出生点）====================
   ⚠️ PHP 那边服务端 MAP_IDS / MAP_SPAWNS 里也要有 'racing'，
      否则联机 join 会被 normMapId 打回 classic（房间、出生点全错位）。 */
MAPS.push({
  id:'racing', name:'赛车场', icon:'🏁', color:'#4fc3a1', ladder:false, tower:false,
  limit:166,
  desc:'面积约日蚀环城 3 倍（半径 166）：一圈 18 米宽的环形沥青赛道绕着整张图，赛道边随机停着赛车/越野车/摩托（F 上车）；' +
       '赛道内是连绵的圆滑山丘（高斯曲面，没有一块方块），弯道起伏、可开车也可爬山。',
  build:function(){ buildMapRacing(); }
});
MAP_THEME.racing={bg:0x8fbde8, fog:0xa8c8e4, fogD:0.0012};
/* 出生点：全在赛道上（沿路一圈，彼此 ≥30 米），服务端那份必须逐点一致 */
MAP_SPAWNS.racing=[
  [-48,112],[-16,112],[16,112],[48,112],
  [112,48],[112,0],[112,-48],
  [48,-112],[16,-112],[-16,-112],[-48,-112],
  [-112,-40],[-112,40]
];
/* 切图包装：进赛车场 → 接地形钩子 + 刷车；离开 → 撤地形 + 收车。
   ⚠️ 地形钩子必须在这里清空，否则站在别的图里 groundHeightAt 还在用赛车场的高度。
   ⚠️ 载具一律"离开就清空"，它们挂在 scene 上，不随 MAP_GROUP 显隐。 */
/* 【batch262f】地形钩子的最终口径：地形 + 跳台。
   跑道本身（ribbon）只用 赛车场_地形高 画 —— 跳台是独立模型盖上去的；
   但**物理**必须认跳台，否则车从坡上压过去毫无反应、更别说腾空。
   所以这里把两者相加作为 TERRAIN_H：视觉路面、车的四角探地、玩家脚下、
   子弹撞山（地形射线）全都自动认这个跳台，不需要各处再判断一次。 */
function 赛车场_地面高(x,z){
  return 赛车场_地形高(x,z)+赛车场_跳台高(x,z);
}

var _赛车场_setMap原=setMap;
setMap=function(id,不存){
  var ok=_赛车场_setMap原(id,不存);
  if(ok){
    /* 注意：setMap('range') 在非靶场模式会被内部打回 'classic'，所以这里要读真实的 curMapId */
    var 真=curMapId;
    if(真==='racing'){
      TERRAIN_H=赛车场_地面高;
      赛车场_刷新车辆();
    }else{
      if(TERRAIN_H===赛车场_地面高)TERRAIN_H=null;
      赛车场_收车();
    }
  }
  return ok;
};
/* 调试 / 探针接口 */
window.赛车场={
  地形高:赛车场_地形高, 赛道距离:赛道距离, 路面高:赛车场_路面高,
  地面高:赛车场_地面高, 跳台高:赛车场_跳台高,
  网格:function(){return 赛车场_网格;},
  刷新车辆:赛车场_刷新车辆, 收车:赛车场_收车,
  车型:function(){return 赛车场_车型.slice();},
  状态:function(){
    var 车数=0; try{ 车数=(typeof 载具!=='undefined'&&载具&&载具._有车)?(载具._有车()?1:0):0; }catch(e){}
    return {已建:赛车场_已建, 地形钩子:!!TERRAIN_H, 车:车数, 世界半径:赛车场_半};
  }
};
