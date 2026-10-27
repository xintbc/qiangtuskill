// ==================== PLAYER & ANIMATION ====================
var lastFrameTime=performance.now();
/* 起跳瞬间的水平期望速度（每帧单位）—— 供"空中惯性"锁定用。
   与 updatePlayer 里的地面测速同一套口径（基础速 / 冲刺 / 蹲下 / 英雄变速 / 持刀加成），
   保证"起跳那一下跑多快，空中就保留多快的水平动量"。 */
function _jumpWish(){
  try{
    var sp=S.baseSpeed;if(!(sp>0.01))sp=BASE_SPEED;if(S.sprinting)sp*=S.sprintMul;if(S.crouch)sp*=0.45;
    sp*=heroSpeedMul();
    if(currentWeapon===WEAPON_KNIFE&&switchAnimState===ANIM_IDLE)sp*=KNIFE_SPEED_BONUS;
    var sinY=Math.sin(yaw),cosY=Math.cos(yaw),mx=0,mz=0;
    if(keys.KeyW){mx-=sinY;mz-=cosY;}if(keys.KeyS){mx+=sinY;mz+=cosY;}if(keys.KeyD){mx+=cosY;mz-=sinY;}if(keys.KeyA){mx-=cosY;mz+=cosY;}
    var l=mx*mx+mz*mz;
    if(l>0.0001){var k=sp/Math.sqrt(l);mx*=k;mz*=k;}
    return {x:mx,z:mz};
  }catch(e){return {x:0,z:0};}
}
/* ====================================================================================
   【batch203】纪念枪「长明」的三件专属表现：检视动作 / 真·镜内视野 / 高级换弹
   ------------------------------------------------------------------------------------
   这三样都挂在「武器 def 的开关」上（inspect / scopeView / premiumReload），
   其它枪的 def 里没有这些字段 → 一行都不会执行，行为与改动前完全一致。
   ==================================================================================== */

/* ---------------- ① 检视动作（对标 TACZ 的多段运镜） ----------------
   TACZ 的检视之所以"看着舒服"，靠的不是零件多，而是四件事：
     1. 有**节奏**：慢起 → 停顿（让人看清涂装）→ 快翻 → 慢收；
     2. 有**惯性**：翻转不是匀速转到底，而是快速甩过去再微微回弹；
     3. 有**呼吸**：停在某个角度时枪不是死的，跟着呼吸轻轻动；
     4. 有**手部配合**：翻面时托枪的手会跟着挪，不是只有枪在转。
   下面的关键帧表把 1/2 做在时间轴里，3 在渲染时叠加，4 用左手位置跟着改。 */
var 检视 = {on:false, t0:0, dur:3600, 栓响:0};
/* 关键帧：dx/dy/dz 是相对当前持握点的偏移（换 gripPos 也不会错位），rx/ry/rz 是枪身欧拉角 */
var 检视帧 = [
  {t:0.00, dx: 0.000,dy: 0.000,dz: 0.000, rx: 0.00,ry: 0.00,rz: 0.00},
  {t:0.08, dx:-0.020,dy: 0.030,dz: 0.055, rx:-0.10,ry:-0.28,rz: 0.10},   // 抬枪、枪口偏左
  {t:0.24, dx:-0.055,dy: 0.062,dz: 0.090, rx:-0.16,ry:-0.92,rz: 0.34},   // 翻出右侧面（看铭牌）
  {t:0.38, dx:-0.058,dy: 0.064,dz: 0.092, rx:-0.15,ry:-1.00,rz: 0.36},   // 停住（呼吸）
  {t:0.52, dx:-0.050,dy: 0.058,dz: 0.088, rx:-0.06,ry: 0.10,rz: 0.06},   // 快速翻过正面
  {t:0.62, dx:-0.030,dy: 0.040,dz: 0.070, rx: 0.04,ry: 0.86,rz:-0.30},   // 另一侧（左侧面）
  {t:0.72, dx:-0.012,dy: 0.004,dz: 0.040, rx: 0.30,ry: 0.10,rz:-0.10},   // 压低枪口看弹匣
  {t:0.80, dx:-0.012,dy:-0.004,dz: 0.038, rx: 0.34,ry: 0.06,rz:-0.08},   // 停住（敲弹匣）
  {t:0.90, dx: 0.006,dy: 0.018,dz: 0.020, rx: 0.06,ry:-0.06,rz: 0.02},   // 甩回
  {t:1.00, dx: 0.000,dy: 0.000,dz: 0.000, rx: 0.00,ry: 0.00,rz: 0.00}
];
function _缓入出(t){ return t*t*(3-2*t); }                       // smoothstep
/* 【batch209】改成单调三次样条：原来每段各自 smoothstep，每个关键帧处速度都归零，
   细看是"挪一下、停一下"。样条保证速度连续，整段检视是一条顺的曲线（关键帧本身不动）。 */
var _检视轨=null;
function _检视采样(p){
  if(!_检视轨)_检视轨=_关键帧(检视帧);
  return _检视轨(p);
}
function 检视可用(){
  if(currentWeapon!==WEAPON_GUN)return false;
  var wd=activeGunDef();
  return !!(wd&&wd.inspect);                                     // 只有纪念枪 def 里有 inspect
}
function 开始检视(){
  if(检视.on||S.reloading||switchAnimState!==ANIM_IDLE||S.aimProgress>0.04)return false;
  if(!检视可用()||!S.playing||S.over||S.paused)return false;
  if(!S.onGround||S.sprinting||S.crouch)return false;            // 跑动/蹲下/空中不检视（TACZ 也是站定才做）
  检视.on=true;检视.t0=performance.now();检视.栓响=0;
  return true;
}
function 结束检视(){ 检视.on=false; try{ _拉机柄动(0); }catch(e){} try{ _右手拉栓(0,0); }catch(e){} }
/* 每帧：检视时接管武器姿态，返回 true 表示"这一帧的枪姿已经由检视决定了" */
function _检视推进(now, basePos){
  if(!检视.on)return false;
  var p=(now-检视.t0)/检视.dur;
  if(p>=1||!检视可用()||S.reloading||S.aimProgress>0.05||switchAnimState!==ANIM_IDLE){
    检视.on=false;检视.栓响=0;
    try{ _拉机柄动(0); _右手拉栓(0,0); }catch(e){}
    return false;
  }
  var k=_检视采样(p);
  /* 呼吸微动：停在某个角度时枪不是死的（TACZ 的"活气"主要就来自这一点） */
  var br=Math.sin(now*0.0018)*0.0016, br2=Math.cos(now*0.0022)*0.0012;
  weaponGroup.position.set(basePos.x+k.dx+br, basePos.y+k.dy+br2, basePos.z+k.dz);
  weaponGroup.rotation.set(k.rx, k.ry+br*0.6, k.rz+br2*0.8);
  weaponGroup.visible=true;
  /* 左手跟着枪身走（托在护木下），敲弹匣那一段轻轻抬两下 */
  var lh=gunLH();
  var tap=0;
  if(p>0.74&&p<0.82){ var q=(p-0.74)/0.08; tap=Math.sin(q*Math.PI*3)*0.012; }
  leftHandAnchor.position.set(lh.x+k.dx*0.55, lh.y+k.dy*0.55+tap, lh.z+k.dz*0.45);
  leftHandAnchor.rotation.set(0,0,0);
  leftHandAnchor.visible=true;
  /* 【batch207】拉栓改成**右手**（用户："拉栓不应是右手拉栓吗"）。
     右手在模型里是一个独立的 Group（`weaponGroup.userData._右手`，见 js/01 的 _建纪念枪），
     合批只吃"直接子网格"，所以这个组没被并掉 —— 可以整组抬上去抓机柄。
     左手这时仍托在护木上（不然枪会浮空），节奏：0.80→0.855 右手离开握把抬到机柄
     → 0.855→0.905 连手带柄一起后拉 → 0.905→0.918 松手、机柄弹回 → 0.918→0.98 右手回握把。 */
  var 栓k=0, 抓=0;
  if(p>0.80&&p<0.98){
    if(p<0.855){ 抓=Math.min(1,(p-0.80)/0.055); 栓k=0; }
    else if(p<0.905){ 抓=1; 栓k=Math.min(1,(p-0.855)/0.050); }
    else if(p<0.918){ 抓=1; 栓k=1-Math.min(1,(p-0.905)/0.013); }
    else { 抓=1-Math.min(1,(p-0.918)/0.062); 栓k=0; }
  }
  _拉机柄动(栓k);
  _右手拉栓(抓, 栓k);
  /* 【batch209】检视拉栓的音效：后拉刮擦 → 松手闭锁，各放一次（用 p 的边沿判定，不按帧） */
  if(栓k>0.10&&!检视.栓响){ 检视.栓响=1; try{ if(typeof playBoltPull==='function')playBoltPull(); }catch(e){} }
  else if(栓k<=0.10&&检视.栓响===1){ 检视.栓响=2; try{ if(typeof playBoltSlam==='function')playBoltSlam(); }catch(e){} }
  return true;
}
/* 右手去抓拉机柄。
   ── 【batch208】上一版为什么"根本没拉在栓上"──
   右手在模型里分两层：`weaponGroup.userData._右手` 是个**空原点的组**（位置 0,0,0），
   手本体是组里的一个网格，局部偏 (0.040,−0.075,0.080)（见 js/01 buildRightHand 的 gripOffset）。
   上一版我把**组**挪到柄点上 → 手还要再加这 11cm 的自身偏移，实际落在柄下方 11cm，
   看着就是"手悬在握把那块，根本没碰到栓"。
   现在改成：把**手网格**直接送到柄上，再让小臂重新对齐到原来的肘端（转向 + 拉长/缩短），
   这样小臂不会被整块抬起来扫进画面。抓 = 0 时逐项还原。 */
function _右手拉栓(抓, k){
  var g=weaponGroup; if(!g)return;
  var rh=g.userData._右手; if(!rh||rh.parent!==g)return;      // 换枪后残留的引用直接不理
  var C=rh.userData._抓栓缓存;
  if(!C){
    var 手=null, 臂=null;
    rh.traverse(function(o){ if(o.isMesh){ if(!手)手=o; else if(!臂)臂=o; } });
    if(!手||!手.geometry)return;
    var 臂长=0;
    try{ 臂长=(臂&&臂.geometry&&臂.geometry.parameters&&臂.geometry.parameters.depth)||0; }catch(e){ 臂长=0; }
    C={手:手, 臂:臂,
       手位:手.position.clone(), 手转:手.rotation.clone(),
       臂位:臂?臂.position.clone():null, 臂四:臂?臂.quaternion.clone():null, 臂长:臂长,
       肘端:(臂&&臂长>0.001)?臂.position.clone()
             .add(new THREE.Vector3(0,0,1).applyQuaternion(臂.quaternion).multiplyScalar(臂长*0.5)):null};
    rh.userData._抓栓缓存=C;
  }
  var t=Math.max(0,Math.min(1,抓||0));
  var 手=C.手, 臂=C.臂;
  if(t<=0.0005){                                    // 完全还原（手 / 小臂 / 缩放）
    手.position.copy(C.手位); 手.rotation.copy(C.手转);
    if(臂&&C.臂位){ 臂.position.copy(C.臂位); 臂.quaternion.copy(C.臂四); 臂.scale.z=1; }
    return;
  }
  var 柄=_抓栓点(k||0);
  /* 掌心落在滚花头中心、稍微往下 4mm（握拳是包住栓头，不是拍在上面）*/
  var 新H=new THREE.Vector3(
    C.手位.x+(柄.x       - C.手位.x)*t,
    C.手位.y+(柄.y-0.004 - C.手位.y)*t,
    C.手位.z+(柄.z       - C.手位.z)*t);
  手.position.copy(新H);
  /* 手腕：压 0.55 弧度 + 往里拧 0.30 —— 栓是装在侧面的，手的横向量着抓才对；
     绕手自身中心转，不产生额外位移。 */
  手.rotation.set(C.手转.x-0.55*t, C.手转.y+0.30*t, C.手转.z+0.10*t);
  /* 小臂：起点跟着手（真枪握把是"手后 5cm"，与 buildRightHand 一致），肘端钉住不动 */
  if(臂&&C.臂位&&C.肘端&&C.臂长>0.001){
    var 起=new THREE.Vector3(新H.x, 新H.y, 新H.z+0.05);
    var 向=C.肘端.clone().sub(起), len=向.length();
    if(len>0.01){
      臂.position.copy(起).add(C.肘端).multiplyScalar(0.5);
      臂.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), 向.normalize());
      臂.scale.z=len/C.臂长;
    }
  }
}
/* 拉机柄位移（0=原位，1=拉到底）。找 animPart==='charging' 的组，沿 +z 后拉 3.4 厘米；
   抛壳窗里的枪机框（animPart='bolt'）按同样的位移后退 —— 从窗口能看见它真的动了。 */
function _拉机柄动(k){
  var g=weaponGroup;
  if(!g)return;
  if(g.userData._拉栓===undefined){
    var 柄=null, 机=null;
    g.traverse(function(o){
      if(o.userData&&o.userData.animPart==='charging'&&!柄)柄=o;
      if(o.userData&&o.userData.animPart==='bolt'&&!机)机=o;
    });
    g.userData._拉栓=柄||null;
    g.userData._枪机=机||null;
  }
  var m=g.userData._拉栓, b=g.userData._枪机;
  if(m)m.position.z=k*0.034;
  g.userData._拉栓量=k;                    // 枪机位置由 _枪机推进() 统一算（拉栓 + 开火后坐）
}

/* 【batch206】开火时的枪机往复：抛壳窗里那根栓后退 → 复进，一枪一次。
   ── 为什么单独一个状态机 ──
   开火和拉栓都会动机框，如果两处各写一次 position.z，谁后跑谁说了算（换弹时开枪就会打架）。
   所以机框只有一个写入口：_枪机推进(now)。它把「拉栓位移」和「这一枪的后坐位移」加起来。 */
var _枪机={起:0,on:false};
function _枪机击发(now){ _枪机.on=true; _枪机.起=(now||performance.now()); }
function _枪机推进(now){
  var g=weaponGroup; if(!g)return;
  if(g.userData._枪机===undefined)_拉机柄动(0);      // 顺手建缓存（内部不会再递归到这里）
  var b=g.userData._枪机; if(!b)return;
  var k=0;
  if(_枪机.on){
    var t=(now-_枪机.起)/110;                        // 110ms 一个完整往复
    if(t>=1){ _枪机.on=false; }
    else if(t<0.40) k=t/0.40;                        // 后退（快）
    else k=1-(t-0.40)/0.60;                          // 复进（稍慢）
  }
  var 拉=g.userData._拉栓量||0;
  b.position.z=(b.userData.原位Z||0)+拉*0.030+k*0.022;
}
/* 拉机柄的抓握点（枪的本地坐标，左手锚点也在枪里，所以直接拿来用）。
   k 是拉栓量：手要跟着机柄一起后移，不能停在原处"隔空搓"。 */
function _抓栓点(k){
  var g=weaponGroup;
  if(g&&g.userData._拉栓===undefined)_拉机柄动(0);      // 顺手把缓存建起来
  var m=g&&g.userData._拉栓;
  var p=(m&&m.userData&&m.userData.握点)?m.userData.握点:{x:0.056,y:0.034,z:0.062};
  return {x:p.x, y:p.y, z:p.z+(k||0)*0.034};
}

/* ---------------- ② 开镜光学：不再造"假镜筒" ----------------
   【batch203 重做】早先这里在相机前挂了一根独立镜筒 adsScope，同时把枪身和镜件全藏起来。
   用户明确否掉了这套做法：「瞄准镜就安装在枪械上面，并且非常精细。开镜也不会删除任何组件，
   就像我们的初始枪械一样，但它的瞄准镜更加高级。」
   所以现在：
     · 瞄准镜是枪上的真部件（见 js/01 的 _建纪念枪：目镜/中段/物镜 + 双调节塔 + 抱箍 + 快拆杆）；
     · 开镜**一件都不藏**，只是把整把枪推到眼前（aimPos.z ≈ -0.21，目镜口离眼睛 0.20 米），
       镜筒内壁、物镜圈、刻在目镜玻璃上的分划全是几何 → 自然框出镜内视野；
     · 这个函数只干两件事：算镜内强度，和按**几何实时算**镜口在屏幕上占多大（交给合成 shader 做色散）。
   镜口数据由模型自己报（weaponGroup.userData._镜口），换 FOV / 换模型都不会算错。 */
var _镜内开=0;
function _镜内视野刷新(){
  var wd=(currentWeapon===WEAPON_GUN)?activeGunDef():null;
  var 要=!!(wd&&wd.scopeView);
  var t=要?Math.max(0,Math.min(1,(S.aimProgress-0.28)/0.60)):0;
  _镜内开+=(t-_镜内开)*0.5;
  if(_镜内开<0.01)_镜内开=t;
  var R=0.693;
  try{
    var k=weaponGroup.userData._镜口;
    if(k){
      var 距=Math.max(0.03,-(weaponGroup.position.z+k.z));   // 眼睛(相机原点)到目镜后口
      var 半Fov=Math.tan(camera.fov*Math.PI/360);
      if(半Fov>0.0001){
        /* 【batch209】优先用模型**实测**的孔径半角（`_镜口.角`）——
           以前用 `r/距` 算，r 填的是目镜外口径，比真实孔径大一倍多：
           shader 画的光学圆（0.603 半屏高）和几何孔（0.275）对不上，
           色散/暗角全糊在黑色管壁上了。现在按角度算，眼距变了也自动跟着变。 */
        if(k.角)R=Math.tan(k.角)*((k.距设||距)/距)/半Fov;
        else if(k.r)R=k.r/(距*半Fov);
      }
      R=Math.max(0.25,Math.min(1.45,R));
    }
  }catch(e){}
  try{ if(POST&&typeof POST.设镜==='function')POST.设镜(_镜内开,R); }catch(e){}
}

/* ---------------- ③ 高级换弹（纪念枪专用）----------------
   旧换弹只有"抓弹匣→拔→插"三段，弹匣是**瞬间隐藏**的，很假。
   新的按真实动作拆成 7 段，全部落在 S.reloadTime 的比例上：
     0.00 枪下沉左倾 → 0.10 摸弹匣 → 0.20 按释放钮、弹匣**真掉出去**（受重力下落并翻转）
     → 0.30 手伸向身侧枪外取新匣 → 0.46 新匣从画面右下抬回 → 0.58 插入对齐
     → 0.68 掌心拍匣底（枪身一震）→ 0.78 拉栓上膛 → 0.90 回正。 */
var _换弹 = {掉落:null, 拍:0, 拉:0, 右抓:0, 插入:false, 响:0, 拉峰:0, 上次:0};
/* 把正在掉的弹匣从场景里摘掉（parent.remove，不是只是置空 —— 置空等于留个幽灵网格永远挂在那） */
function _清掉落(){
  var d=_换弹.掉落; _换弹.掉落=null;
  if(d&&d.m){ try{ if(d.m.parent)d.m.parent.remove(d.m); }catch(e){} }
}
function _开始掉落弹匣(mesh){
  if(!mesh||!weaponGroup)return;
  _清掉落();                                    /* 上一颗还没掉完就又换弹 → 先清掉，别叠 */
  try{ weaponGroup.attach(mesh); }catch(e){}
  _换弹.掉落={m:mesh,vz:0.35,t0:(performance.now?performance.now():Date.now()),
              y0:mesh.position.y,z0:mesh.position.z,rx0:mesh.rotation.x,rz0:mesh.rotation.z};
}
function _推进掉落(){
  var d=_换弹.掉落;if(!d)return;
  /* ⚠️ 用**真实时间**算轨迹，不要累加每帧 dt：
     dt 在低帧率下会被 clamp（2fps 时一帧只推进 33~50ms），
     于是一把 2.4 秒的换弹在 0.7 秒真实时间里只累计了 0.1 秒 → 弹匣停在半空，
     而换弹本体是按 now 算的（真实时间），两者对不上。用解析式还顺带让任何帧率轨迹都一样。 */
  var t=((performance.now?performance.now():Date.now())-d.t0)/1000;
  var g=3.6;
  d.m.position.y=d.y0-0.5*g*t*t;                 // 重力（比真实轻一点，看上去更"顿"）
  d.m.position.z=d.z0+d.vz*t;
  d.m.rotation.x=d.rx0+t*5.2;
  d.m.rotation.z=d.rz0+t*2.6;
  if(t>0.55)_清掉落();
}
/* ---------------- 抛壳（开火时从抛壳窗飞出一个弹壳） ----------------
   弹壳要加到 **scene**（世界空间），不能挂在 weaponGroup 下 ——
   挂在枪下它会跟着枪一起转，看起来像"粘在枪上的一片黄铜"。
   从枪的抛壳窗世界坐标出发，给一个朝右后上方的初速度 + 自旋，0.85 秒后收回对象池。
   对象池上限 12 个：自动步枪 64ms 一发，不封顶的话（连扫一梭子）会一口气生成几十个网格。 */
var _壳池=[], _壳活=[];
function 抛壳(){
  try{
    if(!weaponGroup||!weaponGroup.visible)return;
    var 壳;
    if(_壳池.length){ 壳=_壳池.pop(); }
    else{
      壳=new THREE.Mesh(new THREE.CylinderGeometry(0.0042,0.0046,0.024,8),
        new THREE.MeshLambertMaterial({color:0xb08a3a,side:THREE.DoubleSide}));
      壳.rotation.z=Math.PI/2;
      scene.add(壳);
    }
    var v=new THREE.Vector3(0.0350,0.0260,0.0140);      // 抛壳窗内侧
    weaponGroup.localToWorld(v);
    壳.position.copy(v);
    壳.visible=true;
    壳.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
    /* 初速（米/秒）：向右 1.3~1.9、向上 1.0~1.6、向后 0.5~1.2 —— 真枪的壳是往右后上方抛的 */
    _壳活.push({m:壳,
      vx:1.3+Math.random()*0.6, vy:1.0+Math.random()*0.6, vz:0.5+Math.random()*0.7,
      rx:(Math.random()-0.5)*16, ry:(Math.random()-0.5)*16, rz:(Math.random()-0.5)*16, t:0});
    if(_壳活.length>12){ var 旧=_壳活.shift(); 旧.m.visible=false; _壳池.push(旧.m); }
  }catch(e){}
}
function _推进弹壳(dt){
  for(var i=_壳活.length-1;i>=0;i--){
    var p=_壳活[i]; p.t+=dt;
    p.vy-=9.0*dt;                                        // 重力
    p.m.position.x+=p.vx*dt; p.m.position.y+=p.vy*dt; p.m.position.z+=p.vz*dt;
    p.m.rotation.x+=p.rx*dt; p.m.rotation.y+=p.ry*dt; p.m.rotation.z+=p.rz*dt;
    if(p.t>0.85){ p.m.visible=false; _壳活.splice(i,1); _壳池.push(p.m); }
  }
}

/* ====================================================================================
   【batch209】关键帧插值：单调三次样条（Fritsch–Carlson）
   ------------------------------------------------------------------------------------
   以前换弹是九段 `if/else` 拼的，每段自己走一遍 smoothstep —— 每个分段边界速度都归零，
   动作就成了"走一步、停一下、再走一步"，视角里看就是一顿一顿。
   单调三次插值同时给到两件事：
     · C1 连续 —— 段与段之间位置和**速度**都接得上，整条动作是一条顺的曲线；
     · 不过冲 —— 每段的值被限在相邻关键帧之间，不会为了"顺"把枪甩到关键帧之外。
   ==================================================================================== */
function _关键帧(帧){
  var n=帧.length, 键=[], kk;
  for(kk in 帧[0]) if(kk!=='t') 键.push(kk);
  var nk=键.length, 值=new Array(nk), 切=new Array(nk), i, j;
  for(j=0;j<nk;j++){ 值[j]=[]; for(i=0;i<n;i++) 值[j].push(Number(帧[i][键[j]])||0); }
  for(j=0;j<nk;j++){
    var v=值[j], d=[], m=[];
    for(i=0;i<n-1;i++) d[i]=(v[i+1]-v[i])/Math.max(1e-6,帧[i+1].t-帧[i].t);
    for(i=0;i<n;i++) m[i]=(i===0)?d[0]:(i===n-1)?d[n-2]:((d[i-1]*d[i]<=0)?0:(d[i-1]+d[i])*0.5);
    for(i=0;i<n-1;i++){
      if(Math.abs(d[i])<1e-9){ m[i]=0; m[i+1]=0; continue; }
      var a=m[i]/d[i], b=m[i+1]/d[i], s=a*a+b*b;
      if(s>9){ var tt=3/Math.sqrt(s); m[i]=tt*a*d[i]; m[i+1]=tt*b*d[i]; }
    }
    切[j]=m;
  }
  return function(p){
    var o={}, j2;
    if(p<=帧[0].t){ for(j2=0;j2<nk;j2++) o[键[j2]]=值[j2][0]; return o; }
    if(p>=帧[n-1].t){ for(j2=0;j2<nk;j2++) o[键[j2]]=值[j2][n-1]; return o; }
    var k=0; while(k<n-2&&p>帧[k+1].t) k++;
    var t0=帧[k].t, h=Math.max(1e-6,帧[k+1].t-t0), s2=(p-t0)/h;
    var h00=2*s2*s2*s2-3*s2*s2+1, h10=s2*s2*s2-2*s2*s2+s2, h01=-2*s2*s2*s2+3*s2*s2, h11=s2*s2*s2-s2*s2;
    for(j2=0;j2<nk;j2++) o[键[j2]]=h00*值[j2][k]+h10*h*切[j2][k]+h01*值[j2][k+1]+h11*h*切[j2][k+1];
    return o;
  };
}

function _换弹高级(a, now){
  var 轨=_换弹轨; if(!轨)轨=_建换弹轨();
  /* ⚠️ 关键动作点一律"过了阈值就补做一次"，不要写成"a 落在这一段里才执行"：
     一次换弹 2400ms，正常 60fps 时 a 每帧只加 0.007，区间判断没问题；
     但低端机掉到 3fps 时 a 每帧能跳 0.13（一帧 0.33s）—— 区间会被整段跨过去，
     于是"弹匣不掉、新匣不出现、拍匣不震"，动作直接断成两截（而且只在玩家的破电脑上复现）。
     改成里程碑式补做后，帧率再低也保证九个动作点全都发生过一次。
     ⚠️ 整段用 `a<0.99` 兜住：a 到 0.995 会把这些标记清干净准备下一次换弹，
        如果清完还有帧落在 a≈0.997，下一秒就会"重新开始"再掉一次弹匣、再响一次退匣声。
        这在 60fps 下是 1 帧的事（画面会闪一下、声音会重一下），所以必须挡住。 */
  if(a<0.99){
  if(!S.reloadInit){S.reloadInit=true;S.reloadOldDetached=false;S.reloadNewAttached=false;S.reloadDiscard=null;_换弹.插入=false;_换弹.响=0;_换弹.拉峰=0;_清掉落();}
  /* ---- 音效里程碑（batch209）：退匣 / 上匣 / 拍匣 / 拉栓 / 闭锁 ---- */
  if(!S.reloadOldDetached&&a>=0.20&&currentMagMesh){
    _开始掉落弹匣(currentMagMesh); S.reloadOldDetached=true; S.reloadDiscard=currentMagMesh;
    try{ if(typeof playMagOut==='function')playMagOut(); }catch(e){}
  }
  if(!S.reloadNewAttached&&a>=0.42){
    reloadNewMag=buildMagazineGroup(activeGunDef(),upgradeLevels.magSize||0);
    leftHandAnchor.add(reloadNewMag);
    reloadNewMag.position.set(0.010,-0.026,-0.020);reloadNewMag.rotation.set(0.5,0,0.3);
    S.reloadNewAttached=true;
  }
  if(!_换弹.插入&&a>=0.64&&reloadNewMag&&reloadNewMag.parent===leftHandAnchor){
    weaponGroup.attach(reloadNewMag);reloadNewMag.position.set(curMagPos.x,curMagPos.y,curMagPos.z);reloadNewMag.rotation.set(0,0,0);
    currentMagMesh=reloadNewMag;
    if(S.reloadDiscard&&S.reloadDiscard.parent)try{S.reloadDiscard.parent.remove(S.reloadDiscard);}catch(e){}
    _换弹.拍=1;                                     // 插入那一下的震
    _换弹.插入=true;
    try{ if(typeof playMagIn==='function')playMagIn(); }catch(e){}
  }
  }
  /* 拍匣底那一下（原来靠 t>0.45 触发震动，这里同时补一声轻响） */
  var k=轨(a);
  var hp={x:k.x,y:k.y,z:k.z};
  if(a<0.94){                 // 0.94 之后动作已经收尾，别再补响（重置后 a 还会再走一两帧）
  if(a>=0.712&&!(_换弹.响&1)){ _换弹.响|=1; try{ if(typeof playMagTap==='function')playMagTap(); }catch(e){} }
  /* 拉栓两段音：抓住后拉（刮擦+到位咔）→ 松手闭锁（闷响） */
  var 拉v=k.拉;
  if(拉v>0.10&&!(_换弹.响&2)){ _换弹.响|=2; try{ if(typeof playBoltPull==='function')playBoltPull(); }catch(e){} }
  if(拉v>0.6)_换弹.拉峰=Math.max(_换弹.拉峰||0,拉v);
  if(拉v<=0.10&&(_换弹.响&2)&&!(_换弹.响&4)&&(_换弹.拉峰||0)>0.6){
    _换弹.响|=4; try{ if(typeof playBoltSlam==='function')playBoltSlam(); }catch(e){}
  }
  }
  _换弹.拉=k.拉;
  _换弹.右抓=k.抓;
  if(a>=0.995){
    S.reloadInit=false;S.reloadOldDetached=false;S.reloadNewAttached=false;S.reloadDiscard=null;
    _换弹.拍=0;_换弹.拉=0;_换弹.右抓=0;_换弹.插入=false;_换弹.响=0;_换弹.拉峰=0;
    _拉机柄动(0);_右手拉栓(0,0);
  }
  leftHandAnchor.position.set(hp.x,hp.y,hp.z);
  leftHandAnchor.rotation.set(0,0,0);
  leftHandAnchor.visible=true;
  /* 新弹匣还挂在左手上时，跟着手一起翻转/对准；一插进枪里就不再管它 */
  if(reloadNewMag&&reloadNewMag.parent===leftHandAnchor){
    reloadNewMag.position.set(k.匣x,k.匣y,-0.020);
    reloadNewMag.rotation.set(k.匣rx,0,k.匣rz);
  }
  /* 枪身姿态：下沉 + 左倾 + 一点朝向变化 + 拍匣/插匣的震动。
     ⚠️ 震动的衰减必须按**时间**算，不能按帧数 —— 按帧算的话帧率一变，同样的动作时长
        震动衰减快慢就不一样，低帧机上会拖出一条"余震"，看着又是一顿。 */
  var dt=Math.min(0.1,Math.max(0,(now-(_换弹.上次||now))/1000)); _换弹.上次=now;
  var 震=Math.sin(now*0.05)*_换弹.拍*0.006;
  weaponGroup.position.y=gunGripPos().y-k.沉+震;
  weaponGroup.rotation.z=k.倾+震*0.6;
  weaponGroup.rotation.y=k.转;
  _拉机柄动(_换弹.拉);
  _右手拉栓(_换弹.右抓||0,_换弹.拉);
  _换弹.拍*=Math.pow(1e-4,dt); if(_换弹.拍<0.01)_换弹.拍=0;
}
/* 换弹轨道（懒建一次就缓存）。数值全部沿用 batch207 那套九段的关键位置，
   只是改成**连续曲线**：段与段的边界不再是"停一下再走"。
   左手三个位置：REST 护木下 / GRAB 抓住匣 / 侧取 身侧（画面外）/ 抬匣 带匣回枪下 / 拍点 掌心拍匣底 */
var _换弹轨=null;
function _建换弹轨(){
  var R={x:LH_GUN_LOCAL.x,y:LH_GUN_LOCAL.y,z:LH_GUN_LOCAL.z};
  var G={x:-0.020,y:-0.112,z:-0.050};
  var S={x:0.150,y:-0.300,z:-0.060};
  var T={x:0.010,y:-0.150,z:-0.080};
  var P={x:-0.030,y:-0.135,z:-0.055};
  var 手=_关键帧([
    {t:0.000, x:R.x, y:R.y, z:R.z},
    {t:0.090, x:G.x, y:G.y, z:G.z},
    {t:0.190, x:G.x, y:G.y, z:G.z},
    {t:0.340, x:S.x, y:S.y, z:S.z},
    {t:0.460, x:S.x, y:S.y, z:S.z},
    {t:0.600, x:T.x, y:T.y, z:T.z},
    {t:0.680, x:T.x, y:T.y, z:T.z},
    {t:0.715, x:P.x, y:P.y, z:P.z},
    {t:0.760, x:T.x, y:T.y, z:T.z},
    {t:0.900, x:R.x, y:R.y, z:R.z},
    {t:1.000, x:R.x, y:R.y, z:R.z}
  ]);
  var 沉=_关键帧([
    {t:0.000,v:0.000},{t:0.090,v:0.035},{t:0.600,v:0.035},{t:0.680,v:0.025},
    {t:0.715,v:0.033},{t:0.760,v:0.024},{t:0.940,v:0.000},{t:1.000,v:0.000}
  ]);
  var 倾=_关键帧([
    {t:0.000,v:0.000},{t:0.090,v:0.200},{t:0.145,v:0.215},{t:0.190,v:0.200},
    {t:0.620,v:0.200},{t:0.860,v:0.055},{t:0.960,v:0.000},{t:1.000,v:0.000}
  ]);
  var 转=_关键帧([
    {t:0.000,v:0.000},{t:0.200,v:0.000},{t:0.300,v:0.160},{t:0.460,v:0.160},
    {t:0.580,v:0.000},{t:0.800,v:0.000},{t:0.860,v:-0.100},{t:0.940,v:0.000},{t:1.000,v:0.000}
  ]);
  var 抓=_关键帧([
    {t:0.000,v:0},{t:0.780,v:0},{t:0.848,v:1},{t:0.876,v:1},{t:0.930,v:0},{t:1.000,v:0}
  ]);
  var 拉=_关键帧([
    {t:0.000,v:0},{t:0.848,v:0},{t:0.862,v:1},{t:0.876,v:0},{t:1.000,v:0}
  ]);
  var 匣=_关键帧([
    {t:0.000, x:0.010, y:-0.026, rx:0.50, rz:0.30},
    {t:0.460, x:0.010, y:-0.026, rx:0.50, rz:0.30},
    {t:0.580, x:0.010, y:-0.026, rx:0.00, rz:0.00},
    {t:0.680, x:0.000, y:-0.046, rx:0.00, rz:0.00},
    {t:1.000, x:0.000, y:-0.046, rx:0.00, rz:0.00}
  ]);
  _换弹轨=function(a){
    var h=手(a), c=沉(a), q=倾(a), z=转(a), u=抓(a), l=拉(a), m=匣(a);
    return {x:h.x, y:h.y, z:h.z, 沉:c.v, 倾:q.v, 转:z.v, 抓:u.v, 拉:l.v,
            匣x:m.x, 匣y:m.y, 匣rx:m.rx, 匣rz:m.rz};
  };
  return _换弹轨;
}

/* 【batch197】开镜功能件同步：把「这个网格开镜时必须消失」统一成一张缓存表。
   ── 为什么要重写 ──
   原来 adsHide 每帧 traverse 全武器组，而 scope 那批写在 `else if(switchAnimState===ANIM_IDLE)`
   里面 —— 切枪、换弹、抬枪动画期间压根执行不到，状态就会卡在上一帧：
   镜身留在视野正中挡着（用户报的「冲锋枪和其他枪开镜，镜头并没有正常隐藏」）。
   更狠的一条在 js/11：合批会把带这些标记的网格并进大网格，标记跟着原网格一起消失，
   于是**永远藏不掉**。那条已经修了（合批跳过功能件），这里保证状态每帧都对。
   阈值 0.35 与 #redDotFx / #scopeFx 的显示阈值完全一致 —— 三者必须同进同退，否则会出现
   「红点出来了但镜筒还在」、「镜筒没了但准星还是白十字」这类半截状态。 */
function _开镜功能件同步(){
  var ud=weaponGroup.userData||(weaponGroup.userData={});
  var 版本=ud._模型版本||0;
  var list=ud._功能件;
  if(!list||ud._功件版本!==版本){
    list=[];
    weaponGroup.traverse(function(o){
      if(o===weaponGroup)return;
      if(o.isMesh&&o.userData&&(o.userData.scope||o.userData.adsHide))list.push(o);
    });
    ud._功能件=list; ud._功件版本=版本; ud._功显=null;   /* 清空 → 下面必然重写一次 */
  }
  var 显示=!(S.aimProgress>0.35);
  if(ud._功显!==显示){
    ud._功显=显示;
    for(var i=0;i<list.length;i++){ try{ list[i].visible=显示; }catch(e){} }
  }
}

/* 【batch197】当前真实散布量（方向向量的偏移量，和子弹用的是同一套口径）。
   ⚠️ 这份算法必须与 js/21 attack() 里的完全一致：
     _hip = 0.020 × hipSpreadMul；开镜按 aimProgress 线性收到 (1-aim)；
     弹丸散布 spread 按 adsSpreadKeep 保留；冲刺 +0.020。
   以前散布圆（HUD）和准星（HUD）各写了一份，两边迟早漂移 —— 现在只在这里算一次。 */
function _当前散布(){
  var wd=(currentWeapon===WEAPON_GUN)?activeGunDef():null;
  var keep=(wd&&typeof wd.adsSpreadKeep==='number')?wd.adsSpreadKeep:((wd&&wd.type==='shotgun')?0.35:0);
  var spr=0.020*(S.hipSpreadMul||1)*(1-S.aimProgress);
  var sb=(typeof S.spread==='number')?S.spread:0;
  if(sb>0)spr+=sb*(1-(1-keep)*S.aimProgress);
  if(S.sprinting)spr+=0.020;
  return spr;
}
/* 散布量 → 屏幕像素（和准星/散布圆同一换算：垂直 FOV 对应的半屏高度 × tan） */
function _散布像素(spr){
  var h=(typeof innerHeight==='number')?innerHeight:720;
  var t=Math.tan((camera.fov*Math.PI)/360);
  if(!(t>0.0001))return 0;
  return spr*(h/2)/t;
}

/* 【batch197】开镜 HUD：镜框暗角（狙击） / 红点浮层 / 散布圆。
   每帧执行，只按「当前枪 + 当前开镜进度」算，不依赖切枪动画状态。 */
function _开镜HUD刷新(){
  var wd=(currentWeapon===WEAPON_GUN)?activeGunDef():null;
  var 开镜=S.aimProgress>0.35;
  var 狙击=!!(wd&&wd.scope);
  var 散弹=!!(wd&&(wd.type==='shotgun'||wd.spreadReticle===true));
  var sf=document.getElementById('scopeFx');
  if(sf)sf.style.display=(狙击&&开镜)?'block':'none';
  var rd=document.getElementById('redDotFx');
  if(rd)rd.style.display=((wd&&wd.redDot&&开镜)||散弹)?'block':'none';
  var rr=document.getElementById('redDotRing');
  if(rr){
    if(散弹){
      var px=Math.round(_散布像素(_当前散布()));
      px=Math.max(6,Math.min(160,px));
      var w=(px*2)+'px';
      rr.style.width=w; rr.style.height=w; rr.style.display='block';
    }else{ rr.style.display='none'; }
  }
  /* 狙击开镜时把技能栏压淡（它在镜片正下方，不淡掉会横穿镜片）——只在状态翻转时动 class */
  try{
    var b=document.body;
    if(b&&b.classList){
      var 要=(狙击&&开镜);
      if(要!==b.classList.contains('scope-on')){ if(要)b.classList.add('scope-on'); else b.classList.remove('scope-on'); }
      /* 【batch203】纪念枪的镜筒圆比普通狙击镜小一圈（要和几何镜筒对齐），
         用单独的 class 切 CSS —— 别的枪一点不受影响。 */
      var 要纪念=!!(wd&&wd.scopeView);
      if(要纪念!==b.classList.contains('mem-scope')){ if(要纪念)b.classList.add('mem-scope'); else b.classList.remove('mem-scope'); }
    }
  }catch(e){}
}

/* 【batch197】准星刷新：四段线按真实散布张开/收拢，开镜或换到红点镜时淡出。
   ── 为什么这么改 ──
   原来准星是固定 24px 的白十字：不管什么枪、走不走、开不开枪都一样大，白线 70% 不透明度
   在亮墙/强光下几乎看不见，而且只在 aim>0.6 时一刀切消失。
   现在：① 间隙 = 真实散布换算的像素（和子弹落点偏差一致）→ 走起来张开、停下收拢、
            开枪弹一下、开镜收到最小 —— 眼睛能直接读出"这一枪会不会偏"；
         ② 只在数值真的变了才写 DOM（每帧写 style 会触发整页样式重算）；
         ③ 淡出交给 CSS transition，不再是一帧之内硬切。 */
function _准星刷新(dt){
  var 通用=(typeof crosshairEl!=='undefined'&&crosshairEl)?crosshairEl:document.getElementById('crosshair');
  var el=通用;
  if(!el)return;
  var wd=(currentWeapon===WEAPON_GUN)?activeGunDef():null;
  /* 【batch203】纪念枪有自己的一套准星（#memCross）：金色刻线 + 暖光心 + 四角斜芒。
     两者共用同一份散布数据，只是"长什么样"不同 —— 所以下面只切可见性，算法一行不动。 */
  var 是纪念=!!(wd&&wd.reticle==='memorial');
  var 纪念层=document.getElementById('memCross');
  var 散弹=!!(wd&&(wd.type==='shotgun'||wd.spreadReticle===true));
  var 红点开镜=!!(wd&&wd.redDot)&&S.aimProgress>0.35;
  /* 散弹枪的准星就是散布圆；红点镜开镜后交给浮层红点；开镜到 0.6 之后其它枪也收起来 */
  var 显示=!(散弹||红点开镜||S.aimProgress>0.6||(typeof NET!=='undefined'&&NET&&NET.dead));   /* 【batch238】阵亡不显示准星 */
  var 通用显=显示&&!是纪念;
  var 纪念显=显示&&是纪念;
  var op=通用显?'1':'0';
  if(el.style.opacity!==op)el.style.opacity=op;
  if(纪念层){
    var op2=纪念显?'1':'0';
    if(纪念层.style.opacity!==op2)纪念层.style.opacity=op2;
  }
  if(!通用显&&!纪念显)return;            /* 都不可见时不做无谓的布局计算 */
  var px=_散布像素(_当前散布());
  px=Math.max(0,Math.min(90,px));
  if(!S.onGround)px+=3;                  /* 空中额外张开：纯显示，子弹不受影响 */
  px+=Math.min(14,(S.recoilKick||0)*90); /* 刚开过枪 → 抖一下（recoilKick 会自己衰减到 0） */
  var 目标=4+px;                         /* 4px 是静息间隙，中央留出视线 */
  if(typeof S.xhairGap!=='number')S.xhairGap=目标;
  S.xhairGap+=(目标-S.xhairGap)*Math.min(1,dt*18);
  if(Math.abs(S.xhairGap-(S.xhairGap写||-999))>0.35){
    S.xhairGap写=S.xhairGap;
    var gv=S.xhairGap.toFixed(1)+'px';
    el.style.setProperty('--gap',gv);
    if(纪念层)纪念层.style.setProperty('--gap',gv);
  }
}

function updatePlayer(){
  if(!S.playing||S.over||S.paused)return;
  /* 【batch123b】倒地的人**什么都不能干**（用户要求：不能行走 / 开火 / 跳 / 爬 / 冲刺）。
     两保险：① heroSpeedMul() 直接返回 0（所以位移恒为 0）；
     ② 这里每帧把所有按键输入清空（和"窗口失焦"同一招）→ 跳、爬梯也一并没了。
     在 updatePlayer 开头统一处理，比在每个分支里各加一道判断可靠（以后加新动作也不会漏）。 */
  if(SK&&SK.downed>0){
    try{ for(var _dk in _raw)_raw[_dk]=false; }catch(e){}
    mouseDown=false;rightMouseDown=false;
    S.aiming=false;S.sprinting=false;S.sprintLatch=false;S.joySprint=false;S.crouch=false;
  }
  /* 【batch126】剧情演出（开场 / 结局字幕）期间同样冻住输入 —— 但**不 return**，
     物理和镜头照常，只是人不能动、不能开枪（看字幕时不会乱跑）。 */
  if(typeof STORY_!=='undefined'&&STORY_.on&&STORY_.cut){
    try{ for(var _xq in _raw)_raw[_xq]=false; }catch(e){}
    mouseDown=false;rightMouseDown=false;S.aiming=false;
    S.sprinting=false;S.sprintLatch=false;S.joySprint=false;
  }
  var now=performance.now(),dt=Math.min((now-lastFrameTime)/1000,0.05);lastFrameTime=now;
  /* 【batch238】第一人称枪/手：活着显示、联机阵亡时收起。放在这里（每帧同步）而不是只写在
     死亡报文分支里 —— 退出对局 / 换图 / 被接管都可能直接把 NET.dead 清掉，写一处就会漏。 */
  try{
    var _枪该显示=!(typeof NET!=='undefined'&&NET&&NET.dead);
    /* recoilPivot 下面挂着「枪 + 左手 anchor」，一刀切最省事（拿枪的情况全靠它） */
    if(typeof recoilPivot!=='undefined'&&recoilPivot&&recoilPivot.visible!==_枪该显示)recoilPivot.visible=_枪该显示;
    /* 拿刀时的左手是挂在相机上的（不在 recoilPivot 里）→ 单独掩一下。
       只认「是不是我藏起来的」：复活那一刻按当时手里拿的东西决定要不要还回去，
       不去碰爬梯那套（climbHands 由爬梯逻辑自己管），免得凭空多出一只手。 */
    if(typeof leftHandCamGroup!=='undefined'&&leftHandCamGroup){
      if(!_枪该显示){
        if(leftHandCamGroup.visible){leftHandCamGroup.visible=false;leftHandCamGroup.userData._死藏=1;}
      }else if(leftHandCamGroup.userData._死藏){
        leftHandCamGroup.userData._死藏=0;
        leftHandCamGroup.visible=(currentWeapon===WEAPON_KNIFE);
      }
    }
  }catch(_eGunVis){}
  /* 【batch237】联机阵亡：人躺在地上动不了，镜头贴地 + 侧倒，只能转头看别人；
     3 秒后服务端发 respawn 再站起来（爆能器那种回合制则等下一回合）。 */
  if(typeof NET!=='undefined'&&NET&&NET.dead){
    try{ for(var _dkd in _raw)_raw[_dkd]=false; }catch(e){}
    mouseDown=false;rightMouseDown=false;
    S.aiming=false;S.sprinting=false;S.sprintLatch=false;S.joySprint=false;S.crouch=false;
    S.velX=0;S.velZ=0;S.velY=0;
    /* 【batch238】死了就别再端着枪、别再探头：上一轮只把镜头放倒，第一人称的枪还挂在镜头前，
       躺着"举枪"很出戏；开镜的话 FOV 也会一直冻在倍镜下（死亡分支 return 得早，
       下面那句 fov 更新根本跑不到）。这里一次性收干净。 */
    S.lean=0;
    if(S.aimProgress){S.aimProgress=0;if(Math.abs(camera.fov-75)>0.05){camera.fov=75;camera.updateProjectionMatrix();}}
    /* 手里的技能（陨石/掩体墙/小太阳…）放下：不放下的话预览圈还跟着准星走、
       第一人称还举着一坨东西，人就躺地上了手还在比划。heroHoldCancel 自己会退冷却，
       SK.hold 已经是空的时候直接返回 —— 每帧调是安全的。 */
    if(typeof SK!=='undefined'&&SK&&SK.hold){ try{ if(typeof heroHoldCancel==='function')heroHoldCancel(); }catch(_eHC){} }
    /* 准星：平时在 updatePlayer 末尾的 _准星刷新() 里更新，这里提前 return 了所以要自己关 */
    try{
      var _ch=document.getElementById('crosshair'); if(_ch&&_ch.style.opacity!=='0')_ch.style.opacity='0';
      var _mc=document.getElementById('memCross'); if(_mc&&_mc.style.opacity!=='0')_mc.style.opacity='0';
    }catch(_eCH){}
    /* 脚下的面（1 楼 0 / 2 楼楼板…）→ 眼高降到 0.55，像躺在地上 */
    var _gd=0;
    try{ _gd=(typeof standSurfY==='function')?standSurfY():0; }catch(e){ _gd=0; }
    camera.position.y+=(((_gd+0.55)-camera.position.y))*Math.min(1,dt*6);
    if(typeof THREE!=='undefined'&&camera.quaternion&&camera.quaternion.setFromEuler){
      camera.quaternion.setFromEuler(new THREE.Euler(Math.max(-0.9,Math.min(1.0,pitch||0)),yaw||0,0.55,'YXZ'));
    }
    var _pd=document.querySelector('#netDeath p');
    if(_pd){
      var _left=(typeof NET.deadUntil==='number'&&NET.deadUntil>0)?Math.max(0,(NET.deadUntil-now)/1000):0;
      _pd.textContent=_left>0.05?(_left.toFixed(1)+' 秒后重生…'):'等待下一回合…';
    }
    return;
  }
  /* 【batch180】帧率归一：位移原来是"每帧固定 BASE_SPEED"，**完全没乘 dt** ——
     120Hz 屏上比 60Hz 整整快一倍（这就是"移速过快"和掉帧时表现飘忽的根源）。
     统一换算成"以 60fps 为基准的每帧量"；上限 2.0（≈30fps）防止掉帧时一步跨太大穿墙。 */
  var MOVE_DTF=Math.min(dt*60,2.0);
  // 【蹲下】S.crouch 是唯一状态源：按一下蹲下键 / 点一下「蹲」钮＝蹲/站 切换（不再是长按）。
  /* 【蹲下平滑】蹲下是点击切换：状态量 S.crouch 立即生效（移速 / 冲刺关闭 / 第三人称姿态都读它），
     但**相机眼高**走 crP 平滑过渡 —— 原来蹲下没有任何过渡量，点一下相机瞬间沉 CROUCH_DROP(0.53) 米，
     "切换不自然"（第三人称那边也早有平滑的 e.cr，只有第一人称相机原来是瞬移）。 */
  S.crP+=((S.crouch?1:0)-S.crP)*Math.min(1,dt*7);
  if(!S.crouch&&S.crP<0.002)S.crP=0;
  // 【冲刺】电脑＝双击 W（keydown 里判定）；手机＝摇杆推到最前。松开 W 就结束，避免"冲起来停不下来"。
  // 原来冲刺绑在 Shift 上，现在 Shift 让给蹲下了。
  if(!keys.KeyW)S.sprintLatch=false;
  S.sprinting=sprintOn(keys.KeyW,S.sprintLatch,S.joySprint);
  if(S.aiming||S.crouch)sprinting_off();
  var sp=S.baseSpeed;if(!(sp>0.01))sp=BASE_SPEED;if(S.sprinting)sp*=S.sprintMul;if(S.crouch)sp*=0.45;
  sp*=heroSpeedMul();   // 英雄技能：冲锋 / 肾上腺素加速，反射力场 / 堡垒 / 被减速则变慢
  if(currentWeapon===WEAPON_KNIFE&&switchAnimState===ANIM_IDLE)sp*=KNIFE_SPEED_BONUS;
  camera.position.x-=S.leanX;camera.position.z-=S.leanZ;S.leanX=0;S.leanZ=0;
  /* 碰撞盒口径：默认"站直口径"（standEyeY 已把蹲下压低的那段加回来）。
     【蹲下降低碰撞盒】蹲下时把「盒顶」按 CROUCH_DROP*crP 一起降下来，
     但脚底（feet=py-eye）保持不变 —— 这样蹲下既能压低视角、又能钻进比站姿矮一头的地方，
     又不会因为 feet 算低而穿楼板（地面判定仍走 standEyeY 站直口径，见下一行 groundHeightAt）。 */
  var _cd=(typeof CROUCH_DROP==='number'?CROUCH_DROP:0)*(S.crP||0);
  var _bcPy=standEyeY()-_cd,_bcEye=GROUND_Y-_cd;
  // ---- 翻上哨塔(mantle)：到顶双手撑地往上攀爬一下 ----
  if(S.mantle>0){
    S.mantle-=dt;
    var mk=1-Math.max(0,S.mantle)/S.mantleDur; // 进度 0→1
    var me=1-Math.pow(1-mk,3); // easeOutCubic
    camera.position.lerpVectors(S.mantleFrom,S.mantleTo,me);
    var handPush=Math.sin(Math.min(1,mk*1.3)*Math.PI); // 0→1→0 撑推量
    chL.position.y=-0.55+handPush*0.38; chL.rotation.x=-0.5-handPush*0.7;
    chR.position.y=-0.55+handPush*0.38; chR.rotation.x=-0.5-handPush*0.7;
    setClimbGrip(chL,0);setClimbGrip(chR,0);
    if(S.mantle<=0){
      S.mantle=0;camera.position.copy(S.mantleTo);S.onGround=true;S.ladderCD=now+300;
      weaponGroup.visible=true;climbHands.visible=false;
      leftHandCamGroup.visible=(currentWeapon===WEAPON_KNIFE);
    }
    return;
  }

  var sinY=Math.sin(yaw),cosY=Math.cos(yaw),moveX=0,moveZ=0;
  if(keys.KeyW){moveX-=sinY;moveZ-=cosY;}if(keys.KeyS){moveX+=sinY;moveZ+=cosY;}if(keys.KeyD){moveX+=cosY;moveZ-=sinY;}if(keys.KeyA){moveX-=cosY;moveZ+=sinY;}
  var lenSq=moveX*moveX+moveZ*moveZ,isMoving=lenSq>0.0001;
  if(SK.ghost>0){
    /* 【batch145】虚化：身体留在原地，视角自由飘 —— 不判碰撞、不受重力、不做推出修正 */
    heroGhostMove(dt,moveX,moveZ,isMoving,lenSq);
    isMoving=false;                                      // 飘着不该有脚步起伏
  } else {
  /* 【batch189】物理重写·水平轴：不再"按下即满速"，改成**速度追逐**（加速度 + 惯性）。
     wantX/wantZ 是这一帧的目标位移（＝方向 × 速度 × 帧率归一，和 batch180 完全同一口径），
     实际位移由 S.velX/velZ 按时间常数逼近它：
       · 地面 22/s ≈ 0.09 秒到位 —— 起步有一点重量，松手会滑十来厘米，不是"贴地瞬移"；
       · 空中 6.5/s ≈ 0.3 秒 —— 空中只能慢慢修正方向（起跳惯性仍由下面那段 airVX/airWX 主导）。
     ⚠️ 最高速**一点没变**：稳态时 velX 收敛到 wantX，就是原来的 sp*MOVE_DTF。 */
  var wantX=0,wantZ=0;
  if(isMoving){var invLen=sp*MOVE_DTF/Math.sqrt(lenSq);wantX=moveX*invLen;wantZ=moveZ*invLen;}   /* 【batch180】乘 MOVE_DTF 做帧率归一 */
  if(typeof S.velX!=='number')S.velX=wantX;
  if(typeof S.velZ!=='number')S.velZ=wantZ;
  /* 【batch211/212】地面水平移动：**方向**和**速度**分开处理。
     ── 历史 ──
     最初是"按下即满速"（一按就窜）；batch211 改成"整个速度向量按加速度追"，
     起步是顺了，但带来两个新问题（用户："明显的厚重感、初速太低、转向像开赛车漂移"）：
       · 起步 22 m/s² → 0.27 秒才到满速，太重；
       · 更严重的是**向量整体追**：你按 A 的时候，速度矢量是从"前"慢慢转向"左"，
         中间人会继续往前滑 —— 那就是"漂移"。45° 变向都要 0.2 秒，转得越大画得越弧。
     ── 现在 ──
     拆成两件事各自逼近，这也是绝大多数射击游戏的做法：
       ① **方向**：按角速度追（90 rad/s ≈ 180° 变向只要 35 毫秒、2 帧）——
          按 A 就是立刻往左走，不再往前滑；低帧率下也不会"转弯画弧"。
       ② **大小**：按**用时**追（每帧变化 = 满速 × dt / T）：
          起步 T=0.10 秒、冲刺 0.13 秒、停步 0.06 秒。
          用"用时"而不是写死 m/s² —— 移速升级/冲刺倍率一变，写死加速度的话起步会跟着变重。
          起步保留一点点重量感，但不会拖。
     两个单位的换算：`S.velX` 的单位是**米/帧@60fps**（BASE_SPEED=0.10 就是 6 m/s），
     所以 a(m/s²) 要 `/60`；`MOVE_DTF` 保证不同帧率下用时一致。角速度是弧度/秒，与它无关。 */
  var 目标长=Math.sqrt(wantX*wantX+wantZ*wantZ);
  var 现长=Math.sqrt(S.velX*S.velX+S.velZ*S.velZ);
  var T_起步=0.10, T_冲刺=0.13, T_停步=0.06, 角速度=90;
  var _dts=Math.min(dt,0.05);
  if(目标长<0.0008){
    /* 松开方向键：方向不变，只把速度线性减到 0（0.07 秒停住，不会像冰面） */
    var 新长0=Math.max(0,现长-(sp*MOVE_DTF)*_dts/T_停步);
    if(现长>1e-6){ var 比0=新长0/现长; S.velX*=比0; S.velZ*=比0; }
  }else{
    /* ① 方向：以固定角速度转向目标方向（最短弧） */
    var 角目=Math.atan2(wantZ,wantX), 角现=角目;
    if(现长>0.004){
      角现=Math.atan2(S.velZ,S.velX);
      var 差角=角目-角现;
      while(差角>Math.PI)差角-=Math.PI*2;
      while(差角<-Math.PI)差角+=Math.PI*2;
      var 最大转=角速度*_dts;
      if(差角>最大转)差角=最大转; else if(差角<-最大转)差角=-最大转;
      角现+=差角;
    }
    /* ② 大小：加速 / 减速都不许冲过目标。
       速率按**用时**给，不写死 m/s²：每帧变化 = 满速 × dt / T。
       好处是升级加了移速、冲刺倍率变了，起步用时都一样（写死加速度的话
       移速一升级，起步就变慢，手感会莫名其妙变重 —— 上一版就是这样，用户说"厚重感"）。 */
    var 加=(目标长>现长);
    var 满速=sp*MOVE_DTF;
    var T_本=加?(S.sprinting?T_冲刺:T_起步):T_停步;
    var 步=满速*_dts/T_本;
    var 新长=现长+(加?1:-1)*步;
    if(加&&新长>目标长)新长=目标长;
    if(!加&&新长<目标长)新长=目标长;
    if(新长<0)新长=0;
    S.velX=Math.cos(角现)*新长; S.velZ=Math.sin(角现)*新长;
  }
  if(!isMoving&&S.onGround&&Math.abs(S.velX)<0.0015&&Math.abs(S.velZ)<0.0015){S.velX=0;S.velZ=0;}   // 收尾：别让 0.0001 的残速抖着人走
  moveX=S.velX;moveZ=S.velZ;
  /* 【空中惯性】起跳后水平速度"锁定"成起跳那一下的方向与大小：空中按方向键只能在这个基础速度上做
     **有限偏移**（上限＝起跳速度的一半，且是渐变、不能瞬间转向）—— 于是按前＝落点更远、按后＝落点更近、
     按左/右＝落点偏向那侧；站着起跳则空中完全不能横向漂移（就是正常的垂直跳）。
     原来的写法空中和地面一样全速四向移动，等于"在空中飞行"，不正常（用户反馈）。
     梯子 / 翻越(mantle) / 突进(dash) / 虚化(ghost) 各有自己的位移逻辑，这里一律不接管。 */
  if(!S.onGround && !S.onLadder && S.mantle<=0 && typeof SK!=='undefined' && SK && SK.dash<=0 && SK.ghost<=0){
    if(!S._airInit){                                   // 刚起跳 / 刚从平台边走出去：锁定起跳时的水平速度
      S._airInit=true;
      S.airVX=(typeof S._jumpVX==='number')?S._jumpVX:(isMoving?moveX:0);
      S.airVZ=(typeof S._jumpVZ==='number')?S._jumpVZ:(isMoving?moveZ:0);
      S.airWX=0;S.airWZ=0;S._jumpVX=null;S._jumpVZ=null;
    } else {                                           // 空中：基础速度不变，输入只做有限偏移
      var _avMag=Math.sqrt(S.airVX*S.airVX+S.airVZ*S.airVZ);
      var _airMax=_avMag*0.4;                          // 空中可控的额外偏移上限（起跳速度的 40%：能偏落点，但不能空中全速漂移）
      var _wx=0,_wz=0;
      /* 注意：moveX/moveZ 到这里已经被乘成"每帧位移"（含速度 sp），要先还原成**单位方向向量**，
         否则偏移上限会被速度再缩一次（0.075 → 0.011），空中控制弱到几乎感觉不到。 */
      if(isMoving){var _ml=Math.sqrt(moveX*moveX+moveZ*moveZ);if(_ml>0.0001){_wx=moveX/_ml;_wz=moveZ/_ml;}}
      var _ak=Math.min(1,dt*4.0);                      // 空中响应速率：渐变，不能瞬间改向
      S.airWX+=(_wx*_airMax-S.airWX)*_ak;
      S.airWZ+=(_wz*_airMax-S.airWZ)*_ak;
      moveX=(S.airVX+S.airWX)*MOVE_DTF;moveZ=(S.airVZ+S.airWZ)*MOVE_DTF;   /* 【batch180】空中惯性同样帧率归一（airVX/VZ 是"60fps 每帧"口径的动量） */
      S.velX=moveX;S.velZ=moveZ;                                       /* 【batch189】空中位移同步回速度状态：落地那一下不"顿"，也不会突然加速 */
    }
  } else if(S.onGround){
    S._airInit=false;                                  // 一着地立刻恢复完全操控
  }
  var _bobX0=camera.position.x,_bobZ0=camera.position.z;      // 【batch180】记录移动前位置，用来按实际位移推进走路起伏
  var nx=camera.position.x+moveX;if(Math.abs(nx)<worldLimit()&&!playerBlocked(nx,camera.position.z,_bcPy,_bcEye))camera.position.x=nx;var nz=camera.position.z+moveZ;if(Math.abs(nz)<worldLimit()&&!playerBlocked(camera.position.x,nz,_bcPy,_bcEye))camera.position.z=nz;
  /* 【batch144】从方块顶上掉下来的过程中如果和方块重叠了，先把自己推出来再算地面高度 ——
     否则一掉下来就被"实心方块 + 自身位移太小"锁死（慢走时尤其明显，卡在墙里动不了）。 */
  /* falling：正在自由下落（不在地面上且垂直速度向下）—— 传true让 pushOutOfBoxes 别在下落中把人从楼板上弹开 */
  pushOutOfBoxes(_bcPy,_bcEye,(!S.onGround&&S.velY<-0.02));
  /* 【batch180】走路起伏(bob)：S.bobPhase **从来没有被推进过**（全文只有读取和初始化，没有一处 +=），
     所以移动时镜头和武器一点起伏都没有 → 观感就是"贴地滑行 / 脚在地上打滑"（玩家说的滑脚）。
     改成按**这一帧实际走过的距离**推进（步幅口径 BOB_STRIDE ≈ 每 3 米一个完整周期）：
     走得快步频自然快、走得慢就慢，冲刺 / 蹲下 / 被减速全都自动跟着，不会再打滑。 */
  if(S.onGround&&SK.ghost<=0){
    var _mvDx=camera.position.x-_bobX0,_mvDz=camera.position.z-_bobZ0;
    S.bobPhase+=Math.sqrt(_mvDx*_mvDx+_mvDz*_mvDz)*BOB_STRIDE;
    if(S.bobPhase>6.283185)S.bobPhase-=6.283185;              // 别让它无限增长丢精度
  }
  }
  // 【模组·暗影黑洞】引力：被服务端标记为"处于黑洞范围内"时，本客户端持续把自己往中心拉（位移本地，再经 t:'p' 广播，别人就看到你被吸）。虚化中不吸（身体留原地）。
  if(SK.ghost<=0 && _gravSrc.length){
    var _gnow=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    for(var _gi=_gravSrc.length-1;_gi>=0;_gi--){
      var _gs=_gravSrc[_gi];
      if(!_gs||_gnow>_gs.until){_gravSrc.splice(_gi,1);continue;}
      var _dx=_gs.x-camera.position.x,_dz=_gs.z-camera.position.z,_d=Math.sqrt(_dx*_dx+_dz*_dz);
      if(_d<_gs.r&&_d>0.6){
        var _st=_gs.f*(dt*60);if(_st>_gs.f)_st=_gs.f;   // 帧率归一（60fps≈f），低帧不超量
        var _nx=camera.position.x+_dx/_d*_st,_nz=camera.position.z+_dz/_d*_st;
        if(Math.abs(_nx)<worldLimit()&&!playerBlocked(_nx,camera.position.z,_bcPy,_bcEye))camera.position.x=_nx;
        if(Math.abs(_nz)<worldLimit()&&!playerBlocked(camera.position.x,_nz,_bcPy,_bcEye))camera.position.z=_nz;
      }
    }
  }
  // 【视角速度】把"这一帧转了多少"换算成"以 60fps 为基准的每帧量"。原来直接存每帧增量：
  // 60Hz 和 120Hz / 30Hz 下同一个手速算出来的值会差一倍，挂在它上面的"武器转动滞后"就随刷新率变味。
  var _dtS=Math.max(dt,0.004);
  S.yawVel=(yaw-S.prevYaw)*(1/60)/_dtS;S.pitchVel=(pitch-S.prevPitch)*(1/60)/_dtS;S.prevYaw=yaw;S.prevPitch=pitch;
  // 【转动滞后】原来固定 *0.12（"每帧"系数）——帧率一变 / 手机掉帧就会看成"一顿一顿"。
  // 改成按 dt 指数逼近（60fps 时正好等效 0.12），任何刷新率下手感都一致。
  var _swk=Math.min(1,dt*7.2);
  S.swayX+=(-S.yawVel*6-S.swayX)*_swk;S.swayY+=(S.pitchVel*6-S.swayY)*_swk;
  // 眼高：蹲下＝腿部折叠算出来的 CROUCH_DROP（和模型同源），走 crP 平滑过渡
  /* 【batch118】地面判定要用"站直口径"的高度：蹲下把相机压低的那段必须先加回来，
     否则 feet 被算低 → STEP_UP 台阶容差失效 → 站在二楼楼板/楼梯上蹲下就穿下去（穿模）。 */
  /* 【batch189】物理重写·跳跃三个补丁（都在这里统一处理，避免每个分支各写一套）：
     ① 土狼时间 0.10 秒：刚走下平台边缘那一瞬仍然算"在地上"，还能起跳；
     ② 输入缓冲 0.12 秒：落地前一点点按跳，落地会自动弹出（不再"按早了一点没反应"）；
     ③ 可变跳跃高度：上升途中松开跳跃键 → 上升速度立刻砍到 45%（轻点=矮跳，按住=满跳）。 */
  if(S.onGround&&!S.onLadder&&S.mantle<=0)S._coyoteT=0.10;
  else S._coyoteT=Math.max(0,(S._coyoteT||0)-dt);
  if(S._jumpBuf>0){
    S._jumpBuf=Math.max(0,S._jumpBuf-dt);
    if((S._coyoteT>0||S.onGround)&&!S.onLadder&&S.mantle<=0&&SK.ghost<=0&&!(SK.dash>0)){
      S.velY=JUMP_FORCE;S.onGround=false;S._jumpBuf=0;S._coyoteT=0;S._jumpHold=true;
      var _jw=_jumpWish();S._jumpVX=_jw.x;S._jumpVZ=_jw.z;
    }
  }
  var gh=groundHeightAt(camera.position.x,camera.position.z,standEyeY());
  var eyeH=(SK.ghost>0)?0:(-CROUCH_DROP*(typeof S.crP==='number'?S.crP:(S.crouch?1:0)));   // 【batch145】虚化中不蹲；蹲下眼高走 crP 平滑（原来瞬间下沉）
  _eyeDropApplied=-eyeH;                                   // 记下这一帧减掉的眼高，下一帧反推脚底时加回来
  var ladderNear=MAP_HAS_LADDER&&Math.abs(camera.position.x-LADDER_X)<1.6&&Math.abs(camera.position.z-LADDER_Z)<1.6;
  if(!ladderNear)S.onLadder=false;
  if(S.onLadder){
    camera.position.x=LADDER_X;camera.position.z=LADDER_Z+0.55;
    var climb=(keys.KeyW?1:0)-(keys.KeyS?1:0);
    camera.position.y+=climb*0.13;
    var cv=camera.position.y*6.283;var sL=Math.sin(cv),sR=Math.sin(cv+Math.PI);
    chL.position.set(-0.16,-0.5+sL*0.16,-0.7);chL.rotation.set(-0.2,0,0);
    chR.position.set(0.16,-0.5+sR*0.16,-0.7);chR.rotation.set(-0.2,0,0);
    setClimbGrip(chL,0.5+0.5*Math.cos(cv));setClimbGrip(chR,0.5+0.5*Math.cos(cv+Math.PI));
    if(camera.position.y>=TOWER_TOP+0.25 && climb>=0){
      S.mantle=S.mantleDur;S.mantleFrom=camera.position.clone();
      S.mantleTo=new THREE.Vector3(TOWER_X, TOWER_TOP+0.6+GROUND_Y, TOWER_Z+platHalf-1.6);
      S.onLadder=false;S.ladderCD=now+600;
      weaponGroup.visible=false;leftHandCamGroup.visible=false;climbHands.visible=true;
      chL.position.set(-0.16,-0.55,-0.7);chL.rotation.set(-0.5,0,0);
      chR.position.set(0.16,-0.55,-0.7);chR.rotation.set(-0.5,0,0);
      setClimbGrip(chL,1);setClimbGrip(chR,1);
      return;
    }
    if(climb<0&&camera.position.y<=GROUND_Y+0.06){camera.position.y=GROUND_Y;S.onLadder=false;S.onGround=true;S.ladderCD=now+200;}
  } else if(SK.ghost>0){
    /* 【batch145】虚化中：高度完全由自由飘控制，不走重力 / 不落地 */
  } else if(!S.onGround){
    /* 【batch189】物理重写·垂直轴帧率归一：原来 `velY -= 重力; y += velY` 是**纯每帧量**，
       120Hz 屏幕上一秒跑 120 帧 → 重力只作用一半、上升速度却每帧都加 → 跳跃高度和滞空时间
       随刷新率乱变（60Hz 跳 2.6 米，120Hz 能跳近 5 米）。现在和水平轴同一口径（×MOVE_DTF），
       60fps 下与改动前**逐帧等价**，高刷/掉帧才被修正。 */
    var _g=(window.ModLoader&&ModLoader._phys&&typeof ModLoader._phys.gravity==='number')?ModLoader._phys.gravity:GRAVITY;
    if(S._jumpHold===false&&S.velY>JUMP_FORCE*0.45)S.velY=JUMP_FORCE*0.45;   // 松开跳跃键 → 上升被截断（可变跳跃高度）
    S.velY-=_g*MOVE_DTF;camera.position.y+=S.velY*MOVE_DTF;
    /* 【batch138】头顶撞楼板：跳起来时脑袋顶到楼板底面就停住（垂直速度清零）。
       没有这一句，人能从 1 楼"跳穿"楼板站到 2 楼上去（用户报的穿地板）。 */
    var _hb=headBlockAt(camera.position.x,camera.position.z,gh);
    if(_hb<Infinity&&camera.position.y+HEAD_CLEAR>_hb){
      camera.position.y=_hb-HEAD_CLEAR;
      if(S.velY>0)S.velY=0;
    }
    if(camera.position.y<=gh+eyeH){
      camera.position.y=gh+eyeH;
      /* 【batch189】落地缓冲按**落地速度**缩放：从二楼跳下来比原地小跳沉得更明显，高度仍有上限不会晕 */
      if(S.velY<-0.1)S.landKick=Math.min(0.22,0.10+Math.abs(S.velY)*0.30);
      S.velY=0;S.onGround=true;S._jumpHold=false;
    }
  } else {
    /* 【修】蹲下**过渡中不判"离地"**：蹲下就是把眼高主动降下来，过渡中上一帧的眼高必然比本帧高，
       于是 y_old > gh+eyeH_new+0.06 恒成立 → 原来这里会立刻判 onGround=false →
       吃重力下落 → 落地时 velY<-0.1 触发 landKick=0.14，相机被多压 0.14 米再花约 1 秒逐帧弹回
       （症状：蹲下瞬间画面"沉一下再回弹"，开镜时 FOV 变窄、这个下沉被放大得更明显）。
       只有过渡量收敛后（crP≈1）才恢复正常离地判定（走下平台边缘照旧能走空）。 */
    if(camera.position.y>gh+eyeH+0.06&&!(S.crouch&&S.crP<0.999)){S.onGround=false;}
    else{camera.position.y=gh+eyeH+(isMoving?Math.sin(S.bobPhase)*0.05:Math.sin(now*0.001)*0.008);}
  }
  updateTeleports();                                   // 踩到 A/B 点就传送（batch112）
  camera.position.y-=S.landKick;S.landKick*=0.85;if(S.landKick<0.004)S.landKick=0;
  /* 【趴下已删除】原来这里把相机往脚底前方前伸（PRONE_HEAD_FWD）+ 撞墙收缩 + 记 S.prX/prZ 供下一帧回收。
     整套前伸位移是"趴着贴墙头插墙 / 转身绕脚飘大圈 / 子弹与服务端位置差 0.85~1.7 米 /
     第三人称模型要配一套防卡墙后移"等一连串 bug 的源头，用户要求整个删掉趴下。现在相机就在脚底正上方，
     与服务端认定的位置、第三人称模型锚点、子弹出点全部同点。 */
  /* 【batch211】脚步也挂在"实际速度"上：有了起步加速之后，刚按下 W 的头几帧人还没动起来，
     这时候就"咚"一脚不真实（原来 _stepping 只看 isMoving，按下第一帧就响）。
     0.025 单位/帧 ≈ 1.5 m/s —— 走到四分之一速才开始有脚步。 */
  var _stepping=isMoving&&S.onGround&&!S.onLadder&&Math.sqrt(S.velX*S.velX+S.velZ*S.velZ)>0.025;
  if(_stepping){if(!S._wasStepping){playStep();S._stepAcc=0;}S._stepAcc=(S._stepAcc||0)+dt;var _sg=S.sprinting?0.30:0.45;if(S._stepAcc>=_sg){S._stepAcc=0;playStep();}}else{S._stepAcc=0;}
  S._wasStepping=_stepping;

  // 开镜(ADS)进度
  var _adsTarget=(S.aiming&&currentWeapon===WEAPON_GUN&&!S.reloading)?1:0;
  var _adsBase=0.22/S.adsSpeedMul;var _adsRate=dt/_adsBase;
  if(S.aimProgress<_adsTarget)S.aimProgress=Math.min(_adsTarget,S.aimProgress+_adsRate);
  else if(S.aimProgress>_adsTarget)S.aimProgress=Math.max(_adsTarget,S.aimProgress-_adsRate*1.5);
  /* 开镜 FOV：基础 75，满开镜降到 def.adsFov（默认 45≈1.67倍；狙击枪 scope 在模组 def 里把 adsFov 调小=放大倍数更大）。完全由模组 def 控制，无需改主文件 */
  var _wdFov=(currentWeapon===WEAPON_GUN)?activeGunDef():null;
  var _adsFov=(_wdFov&&typeof _wdFov.adsFov==='number')?_wdFov.adsFov:45;
  var _wantFov=75-(75-_adsFov)*S.aimProgress;if(Math.abs(camera.fov-_wantFov)>0.05){camera.fov=_wantFov;camera.updateProjectionMatrix();}
  /* 【batch197】准星：动态散布四段线（见 _准星刷新）。
     原来这里是「aim>0.6 一刀切 opacity=0」，既生硬又和红点浮层的 0.35 阈值打架。 */
  _准星刷新(dt);
  _开镜HUD刷新();
  /* 【batch203】真·镜内视野：镜筒几何与合成 shader 的镜内效果每帧同步一次。
     放在 HUD 之后、姿态之前 —— 它只读 aimProgress / sway / lean，不参与姿态计算。 */
  _镜内视野刷新();
  var basePos=currentWeapon===WEAPON_GUN?gunGripPos():(curKnifeDef().gripPos||KNIFE_BASE_POS);
  var leanAmt=(keys.KeyE?1:0)-(keys.KeyQ?1:0);
  // 探头平滑：按 dt 指数逼近（原来固定 *0.2，帧率一变手感就漂、看着一顿一顿）
  S.lean+=(leanAmt-S.lean)*Math.min(1,dt*14);if(Math.abs(S.lean)<0.0008)S.lean=0;
  var leanDist=S.lean*0.35;
  camera.position.x+=cosY*leanDist;camera.position.z+=-sinY*leanDist;
  S.leanX=cosY*leanDist;S.leanZ=-sinY*leanDist;
  S.roll=-S.lean*LEAN_ROLL;
  // 【关键】每帧都把「侧倾」写进相机姿态。原先只有 mousemove / touchmove 才写，
  // 电脑端鼠标一停就只剩平移、动一下鼠标才突然倾斜 —— 这就是探头卡顿的根因。
  camera.quaternion.setFromEuler(new THREE.Euler(pitch+(S.recoilPunch||0),yaw,S.roll||0,'YXZ'));
  recoilPivot.rotation.z=-S.lean*0.22;
  updateLeftHand(dt);
  /* 【batch146】虚化（日蚀之门）中不放枪 / 不放刀：这一句是**每帧执行**的权威口径，
   不在它里面让位的话，heroGhostFx() 的隐藏会被立刻覆盖掉。 */
  /* 狙击枪(scope:true)开镜→隐藏枪身与手部（透过镜看不挡视野）；由模组 def 的 scope 控制，其它枪不受影响 */
  var _scoping=false;try{var _gdS=activeGunDef();if(_gdS&&_gdS.scope&&S.aimProgress>0.35)_scoping=true;}catch(e){}
  weaponGroup.visible=(!S.onLadder&&SK.ghost<=0&&!_scoping);
  /* 【batch203】纪念枪开镜**不藏枪**：它的镜筒就是枪上的真部件，靠把枪推到眼前形成镜内视野。
     （只有 def 里带 scope:true 的枪才整组隐藏，见上面的 _scoping） */
  leftHandCamGroup.visible=(!S.onLadder&&currentWeapon===WEAPON_KNIFE&&SK.ghost<=0&&!_scoping);
climbHands.visible=S.onLadder;
  /* 【batch184e】开镜遮挡修复：标记 adsHide 的瞄具网格（镜身/镜片）在开镜时隐藏，
     改由 #redDotFx 浮层显示红点，避免“镜子挡住视野”。非开镜时照常显示。
     【batch197】改成统一出口 _开镜功能件同步()：
       · 原来 adsHide 走 traverse（每帧扫全组）、scope 走另一个 else-if 分支（切枪/换弹/开镜动画
         期间根本执行不到）→ 两边状态各说各话，模型换过之后还会残留旧网格的 visible；
       · 现在两类标记合成一张缓存表，每帧只按「开镜进度是否过 0.35」翻一次 visible，
         模型换过（_模型版本 变了）自动重建表。
     这两个标记是「这个网格开镜时必须消失」，所以**合批时不许被合并**（见 js/11 合批静态）。 */
  _开镜功能件同步();

  if(S.reloading&&currentWeapon===WEAPON_GUN){
    var reloadElapsed=now-reloadAnimStart;var totalTime=S.reloadTime;
    var a=Math.min(1,reloadElapsed/totalTime);
    var REST={x:LH_GUN_LOCAL.x,y:LH_GUN_LOCAL.y,z:LH_GUN_LOCAL.z};
    if(gunReloadStyle()==='premium'){
      /* 【batch203】高级换弹（纪念枪）：整段动画在 ANIM_IDLE 之后统一绘制（见函数末尾），
         因为这里写完姿态会被 ANIM_IDLE 的 `weaponGroup.rotation.set(0,0,0)` 覆盖掉 ——
         旧换弹里那句 `rotation.z=0.06` 其实一直是无效的。这里什么都不做，只保住判断顺序。 */
    } else if(gunReloadStyle()==='cylinder'){
      /* 【batch184e】左轮：转轮侧翻 + 旋转上弹（区别于普通弹匣更换）。
         模组把转轮放进 userData.cylinderPivot 组并标记 userData.cylinder=true；
         引擎开镜时翻出(pivot.y)、旋转(pivot.z)露出弹巢，再合回。 */
      var _cyl=null;
      if(weaponGroup.userData&&weaponGroup.userData.cylinderPivot)_cyl=weaponGroup.userData.cylinderPivot;
      else weaponGroup.traverse(function(o){ if(o.userData&&o.userData.cylinder&&!_cyl)_cyl=o; });
      var GRABc={x:-0.03,y:-0.12,z:-0.04}, hpc;
      if(a<0.22){ hpc=lerp3(REST,GRABc,a/0.22); }
      else if(a<0.42){ hpc=GRABc; if(_cyl)_cyl.rotation.y=-1.05; }
      else if(a<0.72){ hpc=GRABc; if(_cyl){ _cyl.rotation.y=-1.05; _cyl.rotation.z=(a-0.42)/0.30*Math.PI*2; } }
      else if(a<0.88){ hpc=GRABc; if(_cyl){ _cyl.rotation.y=-1.05*(1-(a-0.72)/0.16); _cyl.rotation.z=Math.PI*2; } }
      else { hpc=lerp3(GRABc,REST,(a-0.88)/0.12); if(_cyl)_cyl.rotation.set(0,0,0); }
      leftHandAnchor.position.set(hpc.x,hpc.y,hpc.z); leftHandAnchor.rotation.set(0,0,0);
      weaponGroup.rotation.z=0;
    } else {
      /* 普通弹匣更换 */
      var GRAB={x:-0.02,y:-0.11,z:-0.05},HOLD={x:-0.14,y:-0.21,z:0.07};
      var l3=function(p,q,t){return {x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t,z:p.z+(q.z-p.z)*t};};
      var hp;
      if(a<0.22){ hp=l3(REST,GRAB,a/0.22);
        if(!S.reloadInit){S.reloadInit=true;S.reloadOldDetached=false;S.reloadNewAttached=false;S.reloadDiscard=null;}
      } else if(a<0.40){ hp=l3(GRAB,HOLD,(a-0.22)/0.18);
        if(!S.reloadOldDetached&&currentMagMesh){ leftHandAnchor.attach(currentMagMesh); S.reloadOldDetached=true; S.reloadDiscard=currentMagMesh; }
      } else if(a<0.50){ hp=HOLD;
        if(S.reloadOldDetached&&currentMagMesh){ currentMagMesh.visible=false; }
        if(!S.reloadNewAttached){ reloadNewMag=buildMagazineGroup(activeGunDef(), upgradeLevels.magSize||0); leftHandAnchor.add(reloadNewMag); reloadNewMag.position.set(0.015,-0.02,-0.02); reloadNewMag.rotation.set(0,0,0); S.reloadNewAttached=true; }
      } else if(a<0.70){ hp=l3(HOLD,GRAB,(a-0.50)/0.20);
      } else if(a<0.82){ hp=GRAB;
        if(S.reloadNewAttached&&reloadNewMag&&reloadNewMag.parent===leftHandAnchor){ weaponGroup.attach(reloadNewMag); reloadNewMag.position.set(curMagPos.x,curMagPos.y,curMagPos.z); reloadNewMag.rotation.set(0,0,0); currentMagMesh=reloadNewMag; if(S.reloadDiscard&&S.reloadDiscard.parent===leftHandAnchor){ leftHandAnchor.remove(S.reloadDiscard); } }
      } else { hp=l3(GRAB,REST,(a-0.82)/0.18); if(a>=0.99){S.reloadInit=false;S.reloadOldDetached=false;S.reloadNewAttached=false;S.reloadDiscard=null;} }
      leftHandAnchor.position.set(hp.x,hp.y,hp.z);
      leftHandAnchor.rotation.set(0,0,0);
      weaponGroup.rotation.z=(a>0.20&&a<0.82)?0.06:0;
    }
  }else if(currentMagMesh&&currentWeapon===WEAPON_GUN){ currentMagMesh.position.set(curMagPos.x,curMagPos.y,curMagPos.z);currentMagMesh.rotation.set(0,0,0);currentMagMesh.visible=true; weaponGroup.rotation.z=0; }

  var recoilRecoverySpeed=0.12/S.recoilMul;
  // 开镜时模型不参与后坐力表现：模型后坐/摆动/倾斜按 (1-开镜进度) 衰减，满开镜时枪身纹丝不动，后坐力只由视角向上表达
  var _rScale=1-S.aimProgress;
  if(S.recoilKick>0.001){recoilPivot.position.z=S.recoilKick*_rScale;recoilPivot.rotation.x=-S.recoilRot*_rScale;S.recoilKick=Math.max(0,S.recoilKick-recoilRecoverySpeed*dt);S.recoilRot=Math.max(0,S.recoilRot-recoilRecoverySpeed*1.5*dt);}
  else{recoilPivot.position.z=0;recoilPivot.rotation.x=0;S.recoilKick=0;S.recoilRot=0;}
  /* 【batch184f】视角后坐冲量逐帧回落（快上慢回，约 0.2s 归零） */
  if(S.recoilPunch>0.0001)S.recoilPunch=Math.max(0,S.recoilPunch-0.22*dt);else S.recoilPunch=0; /* 【batch184f】回正放慢：用户嫌归零太快，0.6→0.22(约2.7倍慢) */
  recoilPivot.position.x=S.swayX*0.18*_rScale;recoilPivot.position.y=S.swayY*0.14*_rScale;recoilPivot.rotation.z=((keys.KeyA?0.05:0)-(keys.KeyD?0.05:0))*_rScale;

  // 持续后坐力：按住开火键，视角平滑持续向上攀升（连续上抬，不是每发一跳）；开镜时略收敛更好压枪
  if(mouseDown&&currentWeapon===WEAPON_GUN&&canAct()&&S.ammo>0&&S.auto!==false){
    var _cl=RECOIL_PER_SHOT*(1000/S.fireRate)*S.recoilMul*(1-S.aimProgress*0.3)*dt;
    pitch=Math.min(1.4,pitch+_cl);
    camera.quaternion.setFromEuler(new THREE.Euler(pitch+(S.recoilPunch||0),yaw,S.roll||0,'YXZ'));
  }

  if(switchAnimState===ANIM_LOWERING){var elapsed=now-switchAnimStart,t=Math.min(1,elapsed/SWITCH_LOWER_DURATION),ease=t*t;weaponGroup.position.set(basePos.x,basePos.y-ease*0.5,basePos.z+ease*0.1);weaponGroup.rotation.x=-ease*0.3;if(t>=1){currentWeapon=pendingWeapon;rebuildWeaponModel();switchAnimState=ANIM_RAISING;switchAnimStart=now;}}
  else if(switchAnimState===ANIM_RAISING){var elapsed=now-switchAnimStart,t=Math.min(1,elapsed/SWITCH_RAISE_DURATION),c1=1.70158,c3=c1+1,ease=1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);weaponGroup.position.set(basePos.x,basePos.y-(1-ease)*0.5,basePos.z+(1-ease)*0.1);weaponGroup.rotation.x=-(1-ease)*0.3;if(t>=1){switchAnimState=ANIM_IDLE;weaponGroup.position.set(basePos.x,basePos.y,basePos.z);weaponGroup.rotation.set(0,0,0);}}
  else if(switchAnimState===ANIM_IDLE){
    if(currentWeapon===WEAPON_KNIFE){
      if(knifeSwinging){var elapsed=now-knifeSwingTime;var rx=0,ry=0,rz=0,armZ=0,armY=0;
        var _kd=curKnifeDef();
        if(_kd&&typeof _kd.swing==='function'){
          /* 【batch184d·#103/#106】刀皮挥刀姿势钩子：自定义刀可给出完全独立的挥刀动作（区别于普通刀的直刺） */
          var _sp=_kd.swing({elapsed:elapsed,total:(typeof _kd.swingDur==='number'?_kd.swingDur:KNIFE_TOTAL_DUR)});
          if(_sp&&typeof _sp==='object'){rx=_sp.rx||0;ry=_sp.ry||0;rz=_sp.rz||0;armZ=_sp.armZ||0;armY=_sp.armY||0;}
          var _swd=(typeof _kd.swingDur==='number'?_kd.swingDur:KNIFE_TOTAL_DUR);
          if(elapsed>=_swd||(_sp&&_sp.done))knifeSwinging=false;
        }else{
          var PH1=KNIFE_WRIST_DUR,PH2=KNIFE_STAB_DUR,PH3=KNIFE_HOLD_DUR,PH4=KNIFE_RECOVER_DUR;
          if(elapsed<PH1){var t=elapsed/PH1;var e=t*t*(3-2*t);rx=0.3*e;ry=0;armZ=0.12*e;armY=0.04*e;}
          else if(elapsed<PH1+PH2){var t=(elapsed-PH1)/PH2;var e=t*t;rx=0.3-0.3*e;ry=0;armZ=0.12-0.62*e;armY=0.04-0.04*e;}
          else if(elapsed<PH1+PH2+PH3){rx=0;ry=0;armZ=-0.5;armY=0;}
          else if(elapsed<KNIFE_TOTAL_DUR){var t=(elapsed-PH1-PH2-PH3)/PH4;var e=t*(2-t);rx=0;ry=0;armZ=-0.5*(1-e);armY=0;}
          else{knifeSwinging=false;}
        }
        weaponGroup.rotation.set(rx,ry,rz);weaponGroup.position.set(basePos.x,basePos.y+armY,basePos.z+armZ);
      }else{var bobX=(isMoving&&S.onGround)?Math.sin(S.bobPhase)*0.012:0;var bobY=(isMoving&&S.onGround)?Math.cos(S.bobPhase*2)*0.008:0;weaponGroup.position.set(basePos.x+bobX,basePos.y+bobY,basePos.z);weaponGroup.rotation.set(0,0,0);}
    }else{var bobX=(S.onGround&&isMoving)?Math.sin(S.bobPhase)*0.008:0;var bobY=(S.onGround&&isMoving)?Math.cos(S.bobPhase*2)*0.006:0;var sd=S.sprinting?0.06:0;weaponGroup.position.set(basePos.x+bobX,basePos.y-bobY-sd,basePos.z+(S.sprinting?0.05:0));weaponGroup.rotation.set(0,0,0);}
    if(S.aimProgress>0.002&&currentWeapon===WEAPON_GUN){var _ap=S.aimProgress;var _aim=gunAimPos();weaponGroup.position.x+=(_aim.x-weaponGroup.position.x)*_ap;weaponGroup.position.y+=(_aim.y-weaponGroup.position.y)*_ap;weaponGroup.position.z+=(_aim.z-weaponGroup.position.z)*_ap;weaponGroup.rotation.x+=(0-weaponGroup.rotation.x)*_ap;weaponGroup.rotation.y+=(0-weaponGroup.rotation.y)*_ap;}
    /* 【第一人称铁律】武器永远对准准星：子弹是从相机中心沿视线飞出的，武器挂在相机下，
       任何时候都不能给它加"下沉/前伸/低头"的额外姿态 —— 枪口一偏，模型的枪口就偏离屏幕中心，
       开镜（FOV 45/18）时偏差被放大得更明显（用户实测反馈）。想表现"人放低了"就动相机眼高。
       （趴下曾在某版给武器加过姿态导致准星错位，已连趴下一起删除。） */
    /* 【batch197】开镜 HUD（镜框暗角 / 红点 / 散布圆）已移到每帧的 _开镜HUD刷新() ——
       原来写在这个 ANIM_IDLE 分支里，切枪 / 换弹 / 抬枪动画期间整段不执行，
       于是「切到红点枪浮层不出现 / 切走之后浮层还留着」。HUD 是纯显示量，必须每帧算。 */
  }
  /* 【batch203】高级换弹 / 检视：都必须在 ANIM_IDLE 之后写姿态 ——
     ANIM_IDLE 每帧都会把 weaponGroup 的位置与旋转重置回持握位，
     写在它前面等于白写（旧换弹的枪身倾斜就是这样消失的）。 */
  if(S.reloading&&currentWeapon===WEAPON_GUN&&gunReloadStyle()==='premium'){
    _换弹高级(Math.min(1,(now-reloadAnimStart)/S.reloadTime), now);
  }
  try{ _推进掉落(); }catch(e){}
  try{ _推进弹壳(dt); }catch(e){}
  try{ _检视推进(now, basePos); }catch(e){}
  /* 【batch206】枪机往复（开火后坐）：放在所有会动机框的动作之后，作唯一的写入点 */
  try{ _枪机推进(now); }catch(e){}
  /* 【趴下已删除】原来这里有"趴下起身：双手撑地推一下"的 getup 动画（S.getup 计时），
     随趴下功能一起删除。 */
}
