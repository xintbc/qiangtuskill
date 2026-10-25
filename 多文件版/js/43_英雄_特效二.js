/* ============================================================
   【batch120】新英雄的模型与特效
     · 蚀日者：黑日 / 日蚀之门 / 日之眼        —— 紫金配色
     · 闪电  ：闪电光球 / 电荷陷阱 / 球形闪电   —— 电青白配色
   ============================================================ */
/* ⑤蚀日者 V 的模型：黑日（暗盘 + 日冕环 + 外发光），抛出去时当投掷物，落地后悬空当"太阳" */
function heroMeshSolar(){
  var g=new THREE.Group();
  var disc=new THREE.Mesh(new THREE.SphereGeometry(0.85,18,14),
    new THREE.MeshBasicMaterial({color:0x0e0714,transparent:true,opacity:0.98,depthWrite:false}));
  disc.raycast=function(){};
  var corona=new THREE.Mesh(new THREE.RingGeometry(0.87,1.18,40),
    new THREE.MeshBasicMaterial({color:0xfff0c0,transparent:true,opacity:1.0,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
  corona.raycast=function(){};
  var halo=new THREE.Mesh(new THREE.SphereGeometry(1.40,16,12),
    new THREE.MeshBasicMaterial({color:0xffe9a8,transparent:true,opacity:0.28,depthWrite:false,blending:THREE.AdditiveBlending}));
  halo.raycast=function(){};
  g.add(disc);g.add(corona);g.add(halo);
  g.userData={corona:corona,halo:halo};
  g.renderOrder=901;
  return g;
}
/* 黑日落地：地面铺一圈紫金环 */
function heroFXSolarAt(x,y,z){
  heroFxRingAt(x,z,0xb07dff,0.5,SOLAR_R,0.75,0.07);
  heroFxRingAt(x,z,0xfff0c0,0.4,SOLAR_R*0.55,0.55,0.10);
  spawnParticle(new THREE.Vector3(x,y,z),0xb07dff,14);
}
/* 黑日的强光脉冲（每 SOLAR_PULSE 秒一次）—— batch152：调亮调大，闪光更显眼 */
function heroFXSolarPulse(x,y,z){
  heroFxRingAt(x,z,0xfff0c0,0.95,SOLAR_R*1.05,0.7,0.10);     // 主环：更亮、略大
  heroFxRingAt(x,z,0xffd27a,0.7,SOLAR_R*0.6,0.55,0.12);       // 内环：叠一层暖光
  var s=new THREE.Mesh(new THREE.SphereGeometry(2.6,18,14),
    new THREE.MeshBasicMaterial({color:0xfff6d0,transparent:true,opacity:1.0,depthWrite:false,blending:THREE.AdditiveBlending}));
  s.position.set(x,y,z);s.raycast=function(){};heroFxPush(s,0.35);
}
/* ==================== 【batch158】⑦影月 的模型 ==================== */
/* 暗影烟雾弹（黑紫罐体 + 紫环）/ 暗影炸弹（暗影核 + 紫晕）/ 暗影团（地面黑紫圆盘，半径用 scale 调） */
function heroMeshShadowSmoke(){
  var g=new THREE.Group();
  var can=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.16,0.42,10),
    new THREE.MeshBasicMaterial({color:0x2a1247}));
  can.raycast=function(){};
  var band=new THREE.Mesh(new THREE.CylinderGeometry(0.165,0.165,0.10,10),
    new THREE.MeshBasicMaterial({color:0x8f7bff}));
  band.raycast=function(){};
  g.add(can);g.add(band);
  return g;
}
function heroMeshShadowBomb(){
  var g=new THREE.Group();
  var core=new THREE.Mesh(new THREE.SphereGeometry(0.30,14,10),
    new THREE.MeshBasicMaterial({color:0x1a0b2e}));
  core.raycast=function(){};
  var halo=new THREE.Mesh(new THREE.SphereGeometry(0.42,12,8),
    new THREE.MeshBasicMaterial({color:0x8f7bff,transparent:true,opacity:0.30,depthWrite:false,blending:THREE.AdditiveBlending}));
  halo.raycast=function(){};
  g.add(core);g.add(halo);
  return g;
}
function heroMeshShadowBlob(){
  var g=new THREE.Group();
  var disc=new THREE.Mesh(new THREE.CircleGeometry(1,28),
    new THREE.MeshBasicMaterial({color:0x12061f,transparent:true,opacity:0.74,depthWrite:false}));
  disc.rotation.x=-Math.PI/2;disc.raycast=function(){};
  var rim=new THREE.Mesh(new THREE.RingGeometry(0.90,1.0,28),
    new THREE.MeshBasicMaterial({color:0x8f7bff,transparent:true,opacity:0.5,side:THREE.DoubleSide,depthWrite:false}));
  rim.rotation.x=-Math.PI/2;rim.raycast=function(){};
  g.add(disc);g.add(rim);
  g.userData={rim:rim};
  return g;
}
/* ⑤蚀日者 B 的模型：日蚀之门（竖直紫环 + 门内漩涡） */
function heroMeshPortal(){
  var g=new THREE.Group();
  var fill=new THREE.Mesh(new THREE.CircleGeometry(0.95,32),
    new THREE.MeshBasicMaterial({color:0x2a1247,transparent:true,opacity:0.60,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
  fill.raycast=function(){};
  var ring=new THREE.Mesh(new THREE.TorusGeometry(1.0,0.10,10,32),
    new THREE.MeshBasicMaterial({color:0xb07dff,transparent:true,opacity:0.95,depthWrite:false}));
  ring.raycast=function(){};
  var ring2=new THREE.Mesh(new THREE.TorusGeometry(1.24,0.035,8,32),
    new THREE.MeshBasicMaterial({color:0xfff0c0,transparent:true,opacity:0.65,depthWrite:false,blending:THREE.AdditiveBlending}));
  ring2.raycast=function(){};
  g.add(fill);g.add(ring);g.add(ring2);
  g.renderOrder=902;
  return g;
}
/* ⑤蚀日者 N 的模型：日之眼（金球 + 瞳孔 + 双层眼环） */
function heroMeshSunEye(){
  var g=new THREE.Group();
  var ball=new THREE.Mesh(new THREE.SphereGeometry(0.90,18,14),
    new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:0.95,depthWrite:false}));
  ball.raycast=function(){};
  var iris=new THREE.Mesh(new THREE.SphereGeometry(0.36,14,10),
    new THREE.MeshBasicMaterial({color:0x2a1a00,transparent:true,opacity:0.95,depthWrite:false}));
  iris.position.z=0.74;iris.raycast=function(){};
  var ring=new THREE.Mesh(new THREE.TorusGeometry(1.26,0.07,10,36),
    new THREE.MeshBasicMaterial({color:0xfff0c0,transparent:true,opacity:0.80,depthWrite:false,blending:THREE.AdditiveBlending}));
  ring.raycast=function(){};
  var ring2=new THREE.Mesh(new THREE.TorusGeometry(1.58,0.04,8,36),
    new THREE.MeshBasicMaterial({color:0xb07dff,transparent:true,opacity:0.55,depthWrite:false}));
  ring2.rotation.x=Math.PI/2;ring2.raycast=function(){};
  g.add(ball);g.add(iris);g.add(ring);g.add(ring2);
  g.renderOrder=903;
  return g;
}
/* 【batch143】改成在**眼睛落点**画圈，并按落点所在面的法线贴上去。
   原来它调 heroFxRing —— 圆心写死在 camera 上：眼睛扔到 20 米外，
   暴露圈却在**自己脚下**炸开；贴在墙上时圈也还是横铺在地面/半空。 */
function heroFXSunEye(x,z,y,nx,ny,nz){
  var _x=(x==null?camera.position.x:x),_z2=(z==null?camera.position.z:z);
  var _y=(y==null?0.07:y+0.05);
  var _nx=(nx==null?0:nx),_ny=(ny==null?0:ny),_nz=(nz==null?0:nz);
  heroFxRingAt(_x,_z2,0xffd75e,0.6,SUNEYE_R,0.9,_y,_nx,_ny,_nz);
  heroFxRingAt(_x,_z2,0xb07dff,0.6,SUNEYE_R*0.7,0.75,_y+0.02,_nx,_ny,_nz);
}
/* ⑥闪电 V 的模型：闪电光球（白青核心 + 电壳线框 + 辉光） */
function heroMeshOrb(){
  var g=new THREE.Group();
  var core=new THREE.Mesh(new THREE.SphereGeometry(0.30,14,10),
    new THREE.MeshBasicMaterial({color:0xe8ffff,transparent:true,opacity:1,depthWrite:false}));
  core.raycast=function(){};
  var shell=new THREE.Mesh(new THREE.IcosahedronGeometry(0.52,1),
    new THREE.MeshBasicMaterial({color:0x6ff0ff,wireframe:true,transparent:true,opacity:0.85,depthWrite:false}));
  shell.raycast=function(){};
  var glow=new THREE.Mesh(new THREE.SphereGeometry(0.72,14,10),
    new THREE.MeshBasicMaterial({color:0x6ff0ff,transparent:true,opacity:0.18,depthWrite:false,blending:THREE.AdditiveBlending}));
  glow.raycast=function(){};
  g.add(core);g.add(shell);g.add(glow);
  g.userData={shell:shell,glow:glow};
  g.renderOrder=906;
  return g;
}
/* ⑥闪电 B 的模型：电荷陷阱（六棱底座 + 电极核 + 三根电极爪） */
function heroMeshTrap(){
  var g=new THREE.Group();
  var base=new THREE.Mesh(new THREE.CylinderGeometry(0.20,0.26,0.16,6),
    new THREE.MeshBasicMaterial({color:0x2b3a44,transparent:true,opacity:0.97,depthWrite:false}));
  base.raycast=function(){};
  var core=new THREE.Mesh(new THREE.OctahedronGeometry(0.17,0),
    new THREE.MeshBasicMaterial({color:0x6ff0ff,transparent:true,opacity:0.95,depthWrite:false}));
  core.position.y=0.22;core.raycast=function(){};
  g.add(base);g.add(core);
  for(var i=0;i<3;i++){
    var a=i/3*Math.PI*2;
    var prong=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.02,0.36,5),
      new THREE.MeshBasicMaterial({color:0xbdf7ff,transparent:true,opacity:0.9,depthWrite:false}));
    prong.position.set(Math.cos(a)*0.18,0.31,Math.sin(a)*0.18);
    prong.rotation.z=-Math.cos(a)*0.5;prong.rotation.x=Math.sin(a)*0.5;
    prong.raycast=function(){};g.add(prong);
  }
  g.userData={core:core};
  g.renderOrder=907;
  return g;
}
/* ⑥闪电 N 的模型：球形闪电（亮核 + 尖刺线框 + 辉光） */
function heroMeshBall(){
  var g=new THREE.Group();
  /* 【batch134】整体收小一圈 + 降透明度（用户："球状闪电太遮挡屏幕了"）：
     0.34/0.64/0.86 → 0.26/0.46/0.62；实心核 opacity 1 → 0.72、线框 0.9 → 0.5、光晕 0.22 → 0.13。
     近身那几帧另由 ballFadeNearCam 继续收缩 —— 这里管的是"正常距离也别太抢眼"。
     【铁律】transparent:true 必须显式 depthWrite:false，否则会剔除后面的烟 / 投掷物。 */
  var core=new THREE.Mesh(new THREE.SphereGeometry(0.26,14,10),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.72,depthWrite:false}));
  core.raycast=function(){};
  var spikes=new THREE.Mesh(new THREE.IcosahedronGeometry(0.46,0),
    new THREE.MeshBasicMaterial({color:0x6ff0ff,wireframe:true,transparent:true,opacity:0.5,depthWrite:false}));
  spikes.raycast=function(){};
  var glow=new THREE.Mesh(new THREE.SphereGeometry(0.62,14,10),
    new THREE.MeshBasicMaterial({color:0x9df6ff,transparent:true,opacity:0.13,depthWrite:false,blending:THREE.AdditiveBlending}));
  glow.raycast=function(){};
  g.add(core);g.add(spikes);g.add(glow);
  g.userData={spikes:spikes};
  g.renderOrder=909;
  return g;
}
/* 电弧碎块（触电 / 过载的通用视觉） */
function heroFXZapAt(x,y,z){
  for(var i=0;i<6;i++){
    var a=Math.random()*Math.PI*2,r=0.4+Math.random()*1.6;
    var seg=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.05,0.5+Math.random()*0.8),
      new THREE.MeshBasicMaterial({color:i%2?0xffffff:0x6ff0ff,transparent:true,opacity:0.95,depthWrite:false}));
    seg.position.set(x+Math.cos(a)*r,y+Math.random()*1.2,z+Math.sin(a)*r);
    seg.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
    seg.raycast=function(){};heroFxPush(seg,0.22,3);
  }
}
/* 电球落地炸开 */
function heroFXOrbPop(x,y,z){
  heroFxRingAt(x,z,0x6ff0ff,0.4,ORB_R,0.5,0.07);
  var s=new THREE.Mesh(new THREE.SphereGeometry(0.9,14,10),
    new THREE.MeshBasicMaterial({color:0xdcffff,transparent:true,opacity:0.9,depthWrite:false,blending:THREE.AdditiveBlending}));
  s.position.set(x,y,z);s.raycast=function(){};heroFxPush(s,0.30);
  spawnParticle(new THREE.Vector3(x,y,z),0x6ff0ff,14);
}
/* 陷阱触发一下：一道落雷 + 地面电环 */
function heroFXTrapStrike(x,y,z){
  var bolt=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.02,3.4,6),
    new THREE.MeshBasicMaterial({color:0xdcffff,transparent:true,opacity:0.95,depthWrite:false,blending:THREE.AdditiveBlending}));
  bolt.position.set(x,y+1.7,z);bolt.raycast=function(){};heroFxPush(bolt,0.22);
  heroFxRingAt(x,z,0x6ff0ff,0.3,TRAP_R,0.35,0.06);
  heroFXZapAt(x,y,z);
}
/* 球形闪电命中 */
function heroFXBallHit(x,y,z){
  var s=new THREE.Mesh(new THREE.SphereGeometry(1.1,14,10),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1,depthWrite:false,blending:THREE.AdditiveBlending}));
  s.position.set(x,y,z);s.raycast=function(){};heroFxPush(s,0.35);
  heroFXZapAt(x,y,z);
  heroFxRingAt(x,z,0x6ff0ff,0.4,4.5,0.5,0.07);
}
/* ---------------- 标记（侦察系）：倒三角 / 菱形 + 可选距离 ---------------- */
function makeLabel(color){
  var c=document.createElement('canvas');c.width=128;c.height=48;
  var ctx=c.getContext('2d');
  var tex=new THREE.CanvasTexture(c);
  var spr=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,transparent:true}));
  spr.scale.set(1.0,0.38,1);spr._t='';
  spr.setText=function(s){
    if(spr._t===s)return;spr._t=s;
    ctx.clearRect(0,0,c.width,c.height);
    ctx.font='bold 26px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=color||'#fff';ctx.fillText(s,c.width/2,c.height/2);
    tex.needsUpdate=true;
  };
  return spr;
}
function heroMarkOne(e,color,shape,t,showDist){
  var mk=e._skMark;
  if(!mk||mk.userData.shape!==shape||mk.userData.color!==color){
    if(mk&&mk.parent)mk.parent.remove(mk);
    var geo=(shape==='diamond')?new THREE.OctahedronGeometry(0.20,0):new THREE.ConeGeometry(0.22,0.38,4);
    mk=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:color,transparent:true,opacity:0.95,depthTest:false,depthWrite:false}));
    if(shape!=='diamond')mk.rotation.x=Math.PI;
    mk.renderOrder=999;mk.raycast=function(){};
    mk.userData={shape:shape,color:color};
    (e.g||e.root).add(mk);e._skMark=mk;
    if(showDist){var lb=makeLabel('#fff');lb.position.set(0,0.42,0);lb.raycast=function(){};mk.add(lb);mk.userData.lb=lb;}
  }
  mk.visible=true;
  var base=(e.sz||1.28)*2.15;
  mk.position.set(0,base+Math.sin(t*2)*0.06,0);
  mk.rotation.z=Math.sin(t*2.4)*0.25;
  if(mk.userData.lb){
    var rp=heroEntWorld(e);
    mk.userData.lb.setText(Math.round(Math.hypot(rp.x-camera.position.x,rp.z-camera.position.z))+'m');
  }
}
/* 取实体的「世界坐标」：AI 小兵和联机玩家都是 root 挂在场景里（root.position 才是世界坐标），
   e.g 只是模型子组（局部，倒地躺平 / 蹲下探头动的是它下面的子组）。
   【坑】之前拿 e.g 当世界坐标 → 单机和联机全都探测不到（用户反馈）。 */
function heroEntWorld(e){ return (e.root||e.g).position; }
function updateHeroMark(){
  var t=performance.now()*0.003,now=performance.now();
  for(var j=0;j<enemies.length;j++){
    var e=enemies[j];
    var dead=e.isNet?(!e.alive):(e.hp<=0);
    var rp=heroEntWorld(e);
    /* 【batch172】蜂鸟无人机命中亮标记：被扎中后 3 秒内金色菱形常亮（打中了谁一眼看见） */
    if(!dead&&e.spHitAt&&e.spHitAt>now){ heroMarkOne(e,0xffd166,'diamond',t,false); continue; }
    // ---- 逐目标测水平移动速度（战术探测器「只标移动目标」要用）----
    if(e._mvT===undefined){e._mvT=now;e._mvX=rp.x;e._mvZ=rp.z;e._mvSpd=0;}
    var mvDt=(now-e._mvT)/1000;
    if(mvDt>=0.05){
      e._mvSpd=Math.sqrt((rp.x-e._mvX)*(rp.x-e._mvX)+(rp.z-e._mvZ)*(rp.z-e._mvZ))/mvDt;
      e._mvT=now;e._mvX=rp.x;e._mvZ=rp.z;
    }
    var show=false,color=0x49b6ff,shape='tri',dist=false;
    if(!dead&&!(e.isNet&&NET.id&&e.netId===NET.id)){          // 不标记自己（联机时自己不在 enemies 里，这里只是兜底）
      var d2=(rp.x-camera.position.x)*(rp.x-camera.position.x)+(rp.z-camera.position.z)*(rp.z-camera.position.z);
      /* 【batch120】倒地的目标（AI 的 downedLife / 联机玩家的 downed）：电青色菱形常亮，方便补刀 / 救人 */
      var _dn=(e.downedLife>0)||(e.isNet&&e.downed);
      if(_dn){show=true;color=0x6ff0ff;shape='diamond';dist=false;}
      else if(SK.revealAll>0){show=true;color=0xff4d5e;shape='diamond';dist=true;}
      else if(SK.suneyeT>0){show=true;color=0xffd75e;shape='diamond';dist=true;}   // 【batch152】日之眼：全图敌人全部标金菱形
      else if(SK.sp&&SK.spMarkT>0&&SK.spMarkIds&&SK.spMarkIds[e.__oid__]){show=true;color=0xffd166;shape='diamond';dist=true;}   // 【batch171】猎杀标记：金色菱形
      else if(SK.mine>0){
        // 战术探测器：半径内 **且正在移动**（>0.9 米/秒）才标记；站着不动探测不到
        var mx=rp.x-SK.mineX,mz=rp.z-SK.mineZ,md2=mx*mx+mz*mz;
        if(md2<MINE_R*MINE_R&&e._mvSpd>0.9){show=true;color=0x35e0ff;shape='tri';dist=true;}
      }
    }
    if(show)heroMarkOne(e,color,shape,t,dist);
    else if(e._skMark)e._skMark.visible=false;
  }
}

/* ==================== 【batch198】烟里的角色不投影 ====================
   用户报的 bug：透过半透明的技能/烟雾，还能看见敌人投在地上的**影子** ——
   人看不见，影子明明白白躺在那里，等于直接透视他的位置。
   为什么会有：烟球是半透明叠加（挡的是"像素"），而影子是烘在地面材质里的
   shadow map 结果，烟根本不参与阴影 pass；更糟的是影子能从烟底一直伸到
   烟圈外的亮地板上（太阳高角，影子约 1.7 米长），比人本身还显眼。
   做法：角色站进烟圈（半径 + 影子落点外扩 SHADE_PAD 米）→ 整只模型 castShadow 全关；
   出圈立刻恢复。0.2 秒刷一次（不是每帧），只在状态真的翻转时才重画 shadow map。
   ⚠️ 标记要写进每个网格的 userData._遮影：js/00 的 扫场景 每 2.5 秒会重算
   castShadow（而且敌人模型合批后带 _合几何，走的是"永远投影"那条分支），
   没有这个标记就会被扫回 true。 */
/* ⚠️【batch199】为什么不让烟自己去投 ShadowMap（"烟直接挡光源"）：
   three.js 的阴影是**二值深度图**，不支持半透明遮挡 —— 烟一旦进 shadow pass，
   地面会出现一个**硬边黑圆盘**（50 个球拼出来的锯齿轮廓），比原来的影子更暴露烟的位置；
   烟里所有角色还会整个变成**全黑剪影**，玩家在烟里等于全瞎；更要命的是烟球每帧翻滚缩放，
   等于每帧强制重画整张 shadow map（全图网格重绘一遍），正好抵消 batch195 的优化。
   所以这里改成**真正的光路判定**：从角色身体沿太阳方向往上走，
   只要被烟柱挡住 → 他身上本来就没有阳光 → 本来就不该有影子。
   这在物理上就是"烟挡光"的正确表现，只是拿"关掉他的 castShadow"来落地，
   代价 0 帧 —— 因为 shadow map 只能二值，关影子就是它能表达的最小值。 */
var _shadeT=0;
/* 太阳固定在 (32,42,22)、照向原点 → 指向光源的单位向量。
   水平分量长 0.6792，每水平前进 1 米上升 1.0812 米。 */
var _SUN_UX=0.8236,_SUN_UZ=0.5663,_SUN_UPS=1.0812;
var SMOKE_COL_H=5.0;                       // 烟柱有效高度（球层最高 2.7 + 球半径 2.4）
function _shadowRayBlocked(x,y,z){
  for(var i=0;i<smokeZones.length;i++){
    var s=smokeZones[i];if(!s||s.t<=0)continue;
    var r=s.r||SMOKE_R, sy=s.y||0, top=sy+SMOKE_COL_H;
    if(y>top)continue;                                      // 起点已经高过烟顶，越走越高，挡不到
    var px=x-s.x, pz=z-s.z, d2=px*px+pz*pz;
    if(d2<r*r)return true;                                  // 人就在烟柱里
    var rx=-px, rz=-pz;                                     // 人 → 烟心
    var t=rx*_SUN_UX+rz*_SUN_UZ;                            // 烟心在太阳方向上的投影
    if(t<=0)continue;                                       // 烟在他背光侧，挡的是别人
    var qx=rx-_SUN_UX*t, qz=rz-_SUN_UZ*t;                   // 烟心到这条光路的垂足
    var q2=qx*qx+qz*qz;
    if(q2>=r*r)continue;                                    // 光路擦不到这支烟柱
    var enter=t-Math.sqrt(r*r-q2); if(enter<0)enter=0;      // 进入烟柱时的水平距离
    var hEnter=y+enter*_SUN_UPS;                            // 进入时的离地高度
    if(hEnter<sy)continue;                                  // 那时还没升到烟底（二楼放烟/人在楼下）
    if(hEnter<=top)return true;                             // 被这支烟柱挡住了
  }
  return false;
}
function updateShadeShadow(dt){
  _shadeT+=dt; if(_shadeT<0.2)return; _shadeT=0;
  var dirty=false;
  for(var i=0;i<enemies.length;i++){
    var e=enemies[i]; if(!e||!e.root||!e.g)continue;
    /* 取身体中部（脚底 + 0.95），那一段被挡＝阳光照不到他身上 */
    var off=_shadowRayBlocked(e.root.position.x,e.root.position.y+0.95,e.root.position.z);
    if(e._遮影===off)continue;
    e._遮影=off;
    if(e._影g!==e.g){                                  // 换了模型（重建 / 换类型）就重收一遍网格
      e._影g=e.g; e._影网格=[];
      var _self=e;
      e.g.traverse(function(o){
        if(!o.isMesh||!o.geometry)return;
        var m=o.material;
        if(m&&!m.length){                               // 血条 / 自发光件本来就不投影，别碰
          if(m.transparent||(typeof m.opacity==='number'&&m.opacity<0.95))return;
          if(m.depthWrite===false)return;
          if(m.side===THREE.BackSide)return;
        }
        _self._影网格.push(o);
      });
    }
    var L=e._影网格; if(!L)continue;
    for(var k=0;k<L.length;k++){
      var o2=L[k]; if(!o2)continue;
      o2.castShadow=!off;
      o2.userData._遮影=off?1:0;
    }
    dirty=true;
  }
  if(dirty){ try{ if(typeof LIGHT!=='undefined'&&LIGHT.sun&&LIGHT.sun.shadow)LIGHT.sun.shadow.needsUpdate=true; }catch(_){} }
}
/* ---------------- 每帧推进所有特效 ---------------- */
function updateHeroFX(dt){
  for(var i=heroFXList.length-1;i>=0;i--){
    var f=heroFXList[i],o=f.o;
    if(f.delay>0){f.delay-=dt;o.visible=false;continue;}
    o.visible=true;f.life-=dt;
    var k=Math.max(0,f.life/f.max);
    if(f.kind===1){                                  // 残影：淡出 + 上浮
      if(f.mat)f.mat.opacity=0.34*k;o.position.y+=dt*0.25;
    }else if(f.kind===2){                            // 金色十字：上浮 + 淡出 + 旋转
      if(f.mat)f.mat.opacity=0.9*k;o.position.y+=dt*1.15;o.rotation.y+=dt*1.6;
    }else if(f.kind===3){                            // 冲击波碎块 / 急救箱箱体：边转边缩
      if(o.material&&o.material.transparent)o.material.opacity=0.9*k;
      o.rotation.x+=dt*4;o.rotation.y+=dt*3;
    }else if(f.kind===5){                            // 烟云：先迅速撑开，全程保持浓密
      var el=f.max-f.life,gr=Math.min(1,0.25+el*1.2);
      o.scale.set(gr,gr,gr);
      // 【batch108】两个坑都在这行：
      //  (a) 原来写死 0.6，把常量 SMOKE_PUFF_OP 盖掉了 → "调常量根本不生效"（探针量 0.72、游戏用 0.6）。
      //      现在直接用 SMOKE_PUFF_OP，常量和游戏同源。
      //  (b) 原来乘 min(1,(life/max)*4)：烟在**最后 1/4 寿命（≈3.5 秒）里一路淡到 0**，
      //      开镜的人正好能趁这个"透视窗口"看清烟里。现在全程满浓，只在消失前 0.3 秒快速淡掉。
      var sop=SMOKE_PUFF_OP*(f.life<0.3?(f.life/0.3):1);
      o.traverse(function(mm){if(mm.material&&mm.material.transparent)mm.material.opacity=sop;});
    }else if(f.kind===4){                            // 急救箱：抛物线落地后淡出
      f.vy-=dt*9;o.position.y+=f.vy*dt;
      if(o.position.y<=0.25){o.position.y=0.25;f.vy=0;}
      o.traverse(function(mm){if(mm.material)mm.material.opacity=0.95*k;});
      o.rotation.y+=dt*4;
    }else{                                           // 环 / 地面圈：扩散 + 淡出
      if(o.userData&&o.userData.r1){
        var tt=1-k,s=o.userData.r0+(o.userData.r1-o.userData.r0)*tt;
        o.scale.set(s,s,1);
        if(o.material)o.material.opacity=(o.userData.fan?0.85:0.95)*k;
      }else if(o.material){o.material.opacity=f.op0*k;}
    }
    if(f.life<=0){
      if(o.parent)o.parent.remove(o);
      if(o.geometry&&o.geometry.dispose)try{o.geometry.dispose();}catch(e){}
      if(o.material&&o.material.dispose)try{o.material.dispose();}catch(e){}
      heroFXList.splice(i,1);
    }
  }
  var now=performance.now();
  // ---- 烟团计时：到点就撤（撤掉后 AI 视线恢复）----
  for(var _si=smokeZones.length-1;_si>=0;_si--)if((smokeZones[_si].t-=dt)<=0)smokeZones.splice(_si,1);
  /* 【batch198】烟里的角色不投影（烟散了/人出圈就自动恢复） */
  updateShadeShadow(dt);
  // ---- 物理投掷物统一推进：抛物线 / 弹跳 / 引信 / 落地回调（含联机别人的投掷物）----
  projStep(dt);
  /* 【batch142】飞行自转统一走 spinY（绕自身轴）：投掷物落地时已按法线定好朝向，
     用世界欧拉角转会让那一帧的朝向跳变。 */
  for(var _pi=0;_pi<projList.length;_pi++)spinY(projList[_pi].mesh,dt*6);
  // ---- 战术探测器（已经落地的那台）：周期脉冲 → 到期消失 ----
  if(SK.mine>0){
    SK.mine=Math.max(0,SK.mine-dt);
    if(SK.mineObj&&SK.mineObj.children.length>=3){
      /* 【batch140/142】自转绕**自身** Y 轴，不能写 rotation.y ——
         网格已转成"底面贴合所在面"，写 rotation.y 会按世界欧拉角重算，把贴面朝向又冲掉。 */
      spinY(SK.mineObj,dt*0.9);
      SK.mineObj.children[1].rotation.y-=dt*2.4;
      var msc=1+Math.sin(now*0.006)*0.18;
      SK.mineObj.children[2].scale.set(msc,msc,1);
    }
    SK.minePing-=dt;
    if(SK.minePing<=0){
      SK.minePing=MINE_PING;
      /* 【batch140】脉冲环贴在探测器所在的那张面上（地面 / 墙面 / 天花板），
         而不是永远铺在 y≈0 的地板上（用户："贴天花板时天花板也该有特效"）。 */
      var _mn=SK.mineN||[0,1,0];
      heroFxRingAt(SK.mineX,SK.mineZ,0x35e0ff,0.3,MINE_R,0.9,
        (SK.mineY==null?null:SK.mineY+0.05*_mn[1]),_mn[0],_mn[1],_mn[2]);
    }
    if(SK.mine<=0&&SK.mineObj){
      if(SK.mineObj.parent)SK.mineObj.parent.remove(SK.mineObj);
      SK.mineObj=null;
    }
  }
  if(SK.shieldObj){
    if(SK.shield<=0){if(SK.shieldObj.parent)SK.shieldObj.parent.remove(SK.shieldObj);SK.shieldObj=null;}
    else{
      var br=1+Math.sin(now*0.004)*0.02;SK.shieldObj.scale.set(br,br,br);
      SK.shieldObj.rotation.y+=dt*0.5;SK.shieldObj.rotation.x+=dt*0.22;
      var op=(SK.hitFlash>0)?0.95:0.55;
      if(SK.shieldObj.children[0])SK.shieldObj.children[0].material.opacity=op;
      if(SK.shieldObj.children[1])SK.shieldObj.children[1].material.opacity=(SK.hitFlash>0)?0.3:0.10;
    }
  }
  if(SK.reflectObj){
    if(SK.reflect<=0){if(SK.reflectObj.parent)SK.reflectObj.parent.remove(SK.reflectObj);SK.reflectObj=null;}
    else{var br2=1+Math.sin(now*0.003)*0.03;SK.reflectObj.scale.set(br2,br2,br2);SK.reflectObj.rotation.y-=dt*0.7;}
  }
  if(SK.rushObj){
    if(SK.rush<=0){if(SK.rushObj.parent)SK.rushObj.parent.remove(SK.rushObj);SK.rushObj=null;}
    else{SK.rushObj.scale.setScalar(0.8+Math.random()*0.5);SK.rushObj.material.opacity=0.35+Math.random()*0.3;}
  }
  if(SK.adrenObj){
    if(SK.adren<=0){if(SK.adrenObj.parent)SK.adrenObj.parent.remove(SK.adrenObj);SK.adrenObj=null;}
    else{
      SK.adrenObj.rotation.y+=dt*2.2;
      var r1=SK.adrenObj.children[0],r2=SK.adrenObj.children[1];
      if(r1){r1.rotation.z+=dt*1.5;r1.position.y=-0.6+Math.sin(now*0.006)*0.5;}
      if(r2){r2.rotation.z-=dt*2;r2.position.y=0.5+Math.sin(now*0.006+1.5)*0.4;}
    }
  }
  if(SK.auraObj&&SK.aura<=0){if(SK.auraObj.parent)SK.auraObj.parent.remove(SK.auraObj);SK.auraObj=null;}
  if(SK.fortifyObj){
    if(SK.fortify<=0){if(SK.fortifyObj.parent)SK.fortifyObj.parent.remove(SK.fortifyObj);SK.fortifyObj=null;}
    else{SK.fortifyObj.position.set(SK.zoneX,SK.zoneY+0.05,SK.zoneZ);SK.fortifyObj.rotation.y+=dt*0.6;}
  }
}
