/* ============================================================
   特效：12 个技能各不同（环 / 扇 / 光柱 / 残影 / 喷焰 / 冲击波 / 六边壳 / 半球 / 地砖 / 治疗圈 / 急救箱 / 光环）
   ============================================================ */
function heroFxPush(obj,life,kind){
  obj.renderOrder=900;
  scene.add(obj);
  heroFXList.push({o:obj,life:life,max:life,kind:kind||0,
    op0:(obj.material&&typeof obj.material.opacity==='number')?obj.material.opacity:1});
}
/* 【batch201】投掷物模型必须**写深度** —— 否则烟（group.renderOrder=916）会把它整段盖掉。
   原因：烟球 `depthWrite:false`、投掷物也是 `depthWrite:false`，两者没有深度可比，
   先后只能由 groupOrder 决定，而 groupOrder 与距离无关 → 烟永远后画、永远盖住投掷物，
   连"扔在玩家和烟之间"的手雷都看不见（原本 913 还比 908 大、能穿出来，抬到 916 后就被盖了）。
   写深度之后交给深度测试，前后关系自然就对：
     · 投掷物在烟**前面** → 它的深度更近 → 烟球片元测试失败 → 不被盖，该看得见就看得见
     · 投掷物在烟**后面** → 烟更近 → 正常遮住，该看不见就看不见
   只对 opacity≥0.6 的实体件生效；光晕（0.3 左右）不写深度，否则会在烟上挖出一个硬洞。 */
function heroSolidDepth(g){
  g.traverse(function(o){
    if(!o.isMesh||!o.material||o.material.length)return;
    var op=(typeof o.material.opacity==='number')?o.material.opacity:1;
    if(op<0.6)return;
    o.material.depthWrite=true;
  });
  return g;
}
function heroFxRing(color,r0,r1,life,y,seg,delay){
  var m=new THREE.Mesh(new THREE.RingGeometry(0.86,1.0,seg||48),
    new THREE.MeshBasicMaterial({color:color,transparent:true,opacity:0.95,side:THREE.DoubleSide,depthWrite:false}));
  m.rotation.x=-Math.PI/2;
  m.position.set(camera.position.x,(y==null?0.06:y),camera.position.z);
  m.scale.set(r0,r0,1);m.raycast=function(){};
  heroFxPush(m,life);m.userData={r0:r0,r1:r1};
  if(delay){heroFXList[heroFXList.length-1].delay=delay;m.visible=false;}
  return m;
}
/* 同款扩散环，但中心可以指定（战术探测器的脉冲 / 闪光弹的地面圈要用它） */
function heroFxRingAt(x,z,color,r0,r1,life,y,nx,ny,nz){
  var m=new THREE.Mesh(new THREE.RingGeometry(0.86,1.0,44),
    new THREE.MeshBasicMaterial({color:color,transparent:true,opacity:0.9,side:THREE.DoubleSide,depthWrite:false}));
  /* 【batch140】第 8~10 个参数＝贴面法线：传了就按它把环贴到那张面上
     （墙 / 天花板 / 任意斜面），不传保持老行为（水平环，y 默认 0.07）。
     环本身在 XY 平面、法线是本地 +Z，所以把 +Z 转到目标法线即可。 */
  if(typeof ny==='number'||typeof nx==='number'){
    try{
      var _n=new THREE.Vector3(nx||0,ny||0,nz||0);
      if(_n.lengthSq()>1e-6){
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),_n.normalize());
        m.position.set(x,(y==null?0.07:y),z);
        m.scale.set(r0,r0,1);m.raycast=function(){};
        heroFxPush(m,life);m.userData={r0:r0,r1:r1};
        return m;
      }
    }catch(e){}
  }
  m.rotation.x=-Math.PI/2;
  m.position.set(x,(y==null?0.07:y),z);
  m.scale.set(r0,r0,1);m.raycast=function(){};
  heroFxPush(m,life);m.userData={r0:r0,r1:r1};
  return m;
}
/* ① 天狼 1 的模型：战术探测器 —— 「圆柱机身 + 八面体探头 + 底盘光环」三件套。
   只负责造模型，飞行 / 落地 / 计时全交给物理投掷物系统（projSpawn）。 */
/* 【batch172】蜂鸟无人机模型（手持 + 飞行共用）：小机身 + 十字旋翼 + 蓝色头灯 */
function heroMeshSpDrone(){
  var g=new THREE.Group();
  var body=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.035,0.15),new THREE.MeshLambertMaterial({color:0x2a2f3a}));
  g.add(body);
  var core=new THREE.Mesh(new THREE.SphereGeometry(0.022,8,6),new THREE.MeshBasicMaterial({color:0x9bd4ff}));
  core.position.z=-0.065;g.add(core);
  var rmat=new THREE.MeshLambertMaterial({color:0x1d2026});
  var r1=new THREE.Mesh(new THREE.BoxGeometry(0.17,0.007,0.022),rmat);r1.position.y=0.025;g.add(r1);
  var r2=new THREE.Mesh(new THREE.BoxGeometry(0.022,0.007,0.17),rmat);r2.position.y=0.025;g.add(r2);
  g.userData.rotors=[r1,r2];
  return g;
}
/* 【batch177】电磁网发生器（投掷物本体）：线圈小圆盘，飞在空中发蓝光 */
function heroMeshSpNet(){
  var g=new THREE.Group();
  var disc=new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.13,0.05,10),
    new THREE.MeshLambertMaterial({color:0x1d4a63}));
  g.add(disc);
  var coil=new THREE.Mesh(new THREE.TorusGeometry(0.09,0.018,6,14),
    new THREE.MeshBasicMaterial({color:0x7ad7ff}));
  coil.rotation.x=Math.PI/2;g.add(coil);
  var core=new THREE.Mesh(new THREE.SphereGeometry(0.042,8,6),
    new THREE.MeshBasicMaterial({color:0xd8f6ff}));
  g.add(core);
  for(var _i=0;_i<4;_i++){
    var pr=new THREE.Mesh(new THREE.BoxGeometry(0.022,0.022,0.10),
      new THREE.MeshLambertMaterial({color:0x2a6f8f}));
    var _a=_i*Math.PI/2;
    pr.position.set(Math.cos(_a)*0.10,0,Math.sin(_a)*0.10);pr.rotation.y=-_a;g.add(pr);
  }
  return g;
}
function heroMeshMine(){
  var g=new THREE.Group();
  var body=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.21,0.34,8),
    new THREE.MeshBasicMaterial({color:0x49b6ff,transparent:true,opacity:0.95,depthWrite:false}));
  body.raycast=function(){};
  var head=new THREE.Mesh(new THREE.OctahedronGeometry(0.15,0),
    new THREE.MeshBasicMaterial({color:0xd8f6ff,transparent:true,opacity:0.95,depthWrite:false}));
  head.position.y=0.36;head.raycast=function(){};
  var foot=new THREE.Mesh(new THREE.CircleGeometry(0.30,16),
    new THREE.MeshBasicMaterial({color:0x35e0ff,transparent:true,opacity:0.55,side:THREE.DoubleSide,depthWrite:false}));
  foot.rotation.x=-Math.PI/2;foot.position.y=-0.15;foot.raycast=function(){};
  g.add(body);g.add(head);g.add(foot);
  g.renderOrder=910;
  return heroSolidDepth(g);
}
/* ① 天狼 2a 的模型：闪光弹投掷物 —— 抛出的小白球（外裹光晕），引信到点才爆闪 */
function heroMeshFlash(){
  var g=new THREE.Group();
  var ball=new THREE.Mesh(new THREE.SphereGeometry(0.16,10,8),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1,depthWrite:false}));
  var halo=new THREE.Mesh(new THREE.SphereGeometry(0.30,10,8),
    new THREE.MeshBasicMaterial({color:0xfff6c0,transparent:true,opacity:0.35,depthWrite:false}));
  ball.raycast=function(){};halo.raycast=function(){};
  g.add(ball);g.add(halo);g.renderOrder=912;
  return heroSolidDepth(g);
}
/* ① 天狼 2b：闪光弹落地爆闪 —— 亮白爆闪球 + 十道星芒 + 地面白光圈（「全白」主要靠屏幕层） */
function heroFXFlash(x,y,z){
  var core=new THREE.Mesh(new THREE.SphereGeometry(0.85,14,10),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1,depthWrite:false}));
  core.position.set(x,y,z);core.raycast=function(){};
  heroFxPush(core,0.45);
  for(var i=0;i<10;i++){
    var sp=new THREE.Mesh(new THREE.PlaneGeometry(0.07,2.0),
      new THREE.MeshBasicMaterial({color:0xfff6c0,transparent:true,opacity:0.75,side:THREE.DoubleSide,depthWrite:false}));
    sp.position.set(x,y,z);sp.rotation.z=i/10*Math.PI;
    sp.raycast=function(){};heroFxPush(sp,0.4);
  }
  heroFxRingAt(x,z,0xfff6c0,0.4,FLASH_R,0.55,0.08);
  spawnParticle(new THREE.Vector3(x,y,z),0xffffff,14);
}
/* ① 天狼 3：全域透视 —— 红色大环 + 一圈升起的光柱 */
function heroFXEye(){
  heroFxRing(0xff4d5e,1.0,26,1.0,0.06,56,0);
  heroFxRing(0xff4d5e,1.0,26,1.0,0.06,56,0.18);
  for(var i=0;i<6;i++){
    var a=i/6*Math.PI*2;
    var p=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,7,6),
      new THREE.MeshBasicMaterial({color:0xff4d5e,transparent:true,opacity:0.35,depthWrite:false}));
    p.position.set(camera.position.x+Math.cos(a)*6,3.5,camera.position.z+Math.sin(a)*6);
    p.raycast=function(){};heroFxPush(p,1.0);
  }
}
/* ② 流火 1：残影人形（战术突进沿途留下） */
function heroGhost(){
  var g=new THREE.Group();
  var mat=new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.34,depthWrite:false});
  var body=new THREE.Mesh(new THREE.BoxGeometry(0.52,1.05,0.3),mat);body.position.y=1.0;body.raycast=function(){};
  var head=new THREE.Mesh(new THREE.SphereGeometry(0.17,10,8),mat);head.position.y=1.72;head.raycast=function(){};
  var legs=new THREE.Mesh(new THREE.BoxGeometry(0.44,0.78,0.28),mat);legs.position.y=0.39;legs.raycast=function(){};
  g.add(body);g.add(head);g.add(legs);
  g.position.set(camera.position.x,camera.position.y-GROUND_Y,camera.position.z);
  g.rotation.y=yaw+Math.PI;
  g.traverse(function(o){o.renderOrder=880;});
  scene.add(g);heroFXList.push({o:g,life:0.34,max:0.34,kind:1,mat:mat});
}
/* ② 流火 1：速度线 */
function heroFXTrail(){
  for(var i=0;i<7;i++){
    var m=new THREE.Mesh(new THREE.PlaneGeometry(0.05,1.5),
      new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.55,side:THREE.DoubleSide,depthWrite:false}));
    m.position.set(camera.position.x+(Math.random()-0.5)*1.4,camera.position.y-GROUND_Y+0.5+Math.random()*0.9,camera.position.z+(Math.random()-0.5)*1.4);
    m.rotation.y=yaw+Math.PI;m.raycast=function(){};heroFxPush(m,0.30);
  }
}
/* ② 流火 2：冲锋号令 —— 脚下橙色推进焰 + 速度线 */
function heroFXRush(){
  if(SK.rushObj&&SK.rushObj.parent)return;
  var flame=new THREE.Mesh(new THREE.ConeGeometry(0.5,1.4,10),
    new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.5,depthWrite:false}));
  flame.position.set(0,-1.2,-0.2);flame.raycast=function(){};
  camera.add(flame);SK.rushObj=flame;
  heroFXTrail();
  spawnParticle(camera.position.clone().setY(0.3),0xff8a3d,12);
}
/* ② 流火 3：震荡打击 —— 大冲击波环 + 上冲的橙色碎块 */
function heroFXSmash(){
  heroFxRing(0xff8a3d,0.4,6.5,0.55,0.08,48,0);
  heroFxRing(0xffd0a0,0.4,4.2,0.45,0.10,48,0.1);
  for(var i=0;i<14;i++){
    var m=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.18,0.18),
      new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.9,depthWrite:false}));
    var a=Math.random()*Math.PI*2,r=1.2+Math.random()*3.6;
    m.position.set(camera.position.x+Math.cos(a)*r,0.4+Math.random()*0.6,camera.position.z+Math.sin(a)*r);
    m.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);m.raycast=function(){};
    heroFxPush(m,0.6,3);   // kind=3：边转边缩淡出
  }
}
/* ③ 镇岳：六边形线框壳（护盾 / 反射共用几何，颜色/半径不同） */
function heroShieldObj(color,rad){
  var g=new THREE.Group();
  var wire=new THREE.Mesh(new THREE.IcosahedronGeometry(rad||1.02,1),
    new THREE.MeshBasicMaterial({color:color||0x5ef07a,wireframe:true,transparent:true,opacity:0.55,depthWrite:false}));
  wire.raycast=function(){};
  var skin=new THREE.Mesh(new THREE.SphereGeometry((rad||1.02)*0.96,20,14),
    new THREE.MeshBasicMaterial({color:color||0x5ef07a,transparent:true,opacity:0.10,side:THREE.DoubleSide,depthWrite:false}));
  skin.raycast=function(){};
  g.add(wire);g.add(skin);return g;
}
/* ③ 镇岳 1：能量护盾 */
function heroFXShield(){
  if(SK.shieldObj&&SK.shieldObj.parent)return;
  var g=heroShieldObj(0x5ef07a,1.02);camera.add(g);SK.shieldObj=g;
}
/* ③ 镇岳 2：反射力场（更大的半球线框罩） */
function heroFXReflect(){
  if(SK.reflectObj&&SK.reflectObj.parent)return;
  var g=new THREE.Group();
  var dome=new THREE.Mesh(new THREE.SphereGeometry(1.62,18,12,0,Math.PI*2,0,Math.PI/2),
    new THREE.MeshBasicMaterial({color:0x7dffb0,wireframe:true,transparent:true,opacity:0.42,depthWrite:false}));
  dome.raycast=function(){};
  var skin=new THREE.Mesh(new THREE.SphereGeometry(1.58,20,12,0,Math.PI*2,0,Math.PI/2),
    new THREE.MeshBasicMaterial({color:0x7dffb0,transparent:true,opacity:0.10,side:THREE.DoubleSide,depthWrite:false}));
  skin.raycast=function(){};
  g.add(dome);g.add(skin);camera.add(g);SK.reflectObj=g;
}
/* ③ 镇岳 3：堡垒工事（脚下绿色六边形地砖阵） */
function heroFXFortify(){
  if(SK.fortifyObj&&SK.fortifyObj.parent)return;
  var g=new THREE.Group();
  var mat=new THREE.MeshBasicMaterial({color:0x5ef07a,transparent:true,opacity:0.22,side:THREE.DoubleSide,depthWrite:false});
  for(var i=0;i<7;i++){
    var hex=new THREE.Mesh(new THREE.CircleGeometry(0.85,6),mat);
    hex.rotation.x=-Math.PI/2;hex.raycast=function(){};
    var a=i/6*Math.PI*2,rr=(i===0?0:1.5);
    hex.position.set(Math.cos(a)*rr,0,Math.sin(a)*rr);g.add(hex);
  }
  g.position.set(SK.zoneX,SK.zoneY+0.05,SK.zoneZ);      // 【batch143】铺在脚下那张面上
  g.renderOrder=890;scene.add(g);SK.fortifyObj=g;
}
/* ④ 白泽 1：医疗脉冲弹（投掷）—— 金色治疗圈 + 双脉冲环 + 上升十字，**全部落在弹着点** */
function heroFXHealAt(x,z,y){
  /* 【batch135】第 3 个参数 y：落点高度（撞墙 / 空中引爆时不再硬贴地面 0.05）。
     不传＝0，效果与改动前完全一致。 */
  var _y=(typeof y==='number'?y:0);
  var aura=new THREE.Mesh(new THREE.CircleGeometry(PULSE_R,40),
    new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:0.16,side:THREE.DoubleSide,depthWrite:false}));
  aura.rotation.x=-Math.PI/2;aura.position.set(x,_y+0.05,z);
  aura.raycast=function(){};heroFxPush(aura,5);SK.auraObj=aura;
  heroFxRingAt(x,z,0xffd75e,0.5,4.2,0.7,_y+0.08);
  heroFxRingAt(x,z,0xffd75e,0.5,4.2,0.7,_y+0.24);
  heroCrossAt(x,z);
}
/* ① 白泽 1 的模型：医疗脉冲弹 —— 金色治疗球（顶上一个小白十字） */
function heroMeshPulse(){
  var g=new THREE.Group();
  var orb=new THREE.Mesh(new THREE.SphereGeometry(0.17,12,8),
    new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:0.97,depthWrite:false}));
  orb.raycast=function(){};
  var halo=new THREE.Mesh(new THREE.SphereGeometry(0.30,12,8),
    new THREE.MeshBasicMaterial({color:0xfff0b8,transparent:true,opacity:0.32,depthWrite:false}));
  halo.raycast=function(){};
  var c1=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.16,0.04),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.95,depthWrite:false}));
  c1.position.y=0.30;c1.raycast=function(){};
  var c2=new THREE.Mesh(new THREE.BoxGeometry(0.13,0.05,0.04),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.95,depthWrite:false}));
  c2.position.y=0.30;c2.raycast=function(){};
  g.add(orb);g.add(halo);g.add(c1);g.add(c2);g.renderOrder=915;
  return heroSolidDepth(g);
}
function heroCrossAt(x,z){
  var g=new THREE.Group();
  var cm=new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:0.9,depthWrite:false});
  var b1=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.72,0.14),cm);b1.raycast=function(){};
  var b2=new THREE.Mesh(new THREE.BoxGeometry(0.52,0.16,0.14),cm);b2.raycast=function(){};
  g.add(b1);g.add(b2);
  g.position.set(x,1.2,z);
  g.rotation.y=yaw+Math.PI;g.traverse(function(o){o.renderOrder=902;});
  scene.add(g);heroFXList.push({o:g,life:1.1,max:1.1,kind:2,mat:cm});
}
/* ④ 白泽 2：急救箱（抛出的金色箱子，落地炸开治疗环） */
/* 【batch181】蚀日者 SP「堕日」的小太阳：灼热的橙红小球 + 外焰环（作为投掷物飞出，落地成火区） */
function heroMeshSun(){
  var g=new THREE.Group();
  var core=new THREE.Mesh(new THREE.SphereGeometry(0.34,14,10),
    new THREE.MeshBasicMaterial({color:0xffb347,transparent:true,opacity:0.98,depthWrite:false}));
  core.raycast=function(){};g.add(core);
  var halo=new THREE.Mesh(new THREE.TorusGeometry(0.46,0.07,8,20),
    new THREE.MeshBasicMaterial({color:0xff7a2a,transparent:true,opacity:0.85,depthWrite:false}));
  halo.rotation.x=Math.PI/2;g.add(halo);
  var halo2=halo.clone();halo2.rotation.x=0.6;halo2.rotation.y=0.4;g.add(halo2);
  g.renderOrder=912;
  return heroSolidDepth(g);
}
/* ④ 白泽 2 的模型：急救箱 —— 金色药箱（作为投掷物飞出），落地才开箱 */
function heroMeshMedkit(){
  var g=new THREE.Group();
  var box=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.4,0.5),
    new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:0.95,depthWrite:false}));
  box.raycast=function(){};
  var cap=new THREE.Mesh(new THREE.BoxGeometry(0.54,0.1,0.14),
    new THREE.MeshBasicMaterial({color:0xff4d5e,transparent:true,opacity:0.95,depthWrite:false}));
  cap.position.y=0.21;cap.raycast=function(){};
  g.add(box);g.add(cap);g.renderOrder=911;
  return heroSolidDepth(g);
}
/* 急救箱落地：金色治疗圈 + 粒子 */
function heroFXMedkitBurst(x,y,z){
  heroFxRingAt(x,z,0xffd75e,0.4,3.0,0.6,0.06);
  spawnParticle(new THREE.Vector3(x,Math.max(0.6,y),z),0xffd75e,10);
}
/* ② 流火 3 的模型：破片手雷 —— 深色弹体 + 橙色辨识环 + 拉环 */
function heroMeshFrag(){
  var g=new THREE.Group();
  var body=new THREE.Mesh(new THREE.SphereGeometry(0.17,10,8),
    new THREE.MeshBasicMaterial({color:0x3a3f47,transparent:true,opacity:0.98,depthWrite:false}));
  body.raycast=function(){};
  var ring=new THREE.Mesh(new THREE.TorusGeometry(0.17,0.035,8,16),
    new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.95,depthWrite:false}));
  ring.rotation.x=Math.PI/2;ring.raycast=function(){};
  var pin=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.14,6),
    new THREE.MeshBasicMaterial({color:0xffd0a0,transparent:true,opacity:0.95,depthWrite:false}));
  pin.position.y=0.21;pin.raycast=function(){};
  g.add(body);g.add(ring);g.add(pin);g.renderOrder=913;
  return heroSolidDepth(g);
}
/* ②/③ 烟弹的模型：圆柱烟罐（镇岳灰白 / 白泽金色） */
function heroMeshSmoke(gold){
  var c=gold?0xf3d98a:0xcfd8df;
  var g=new THREE.Group();
  var can=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.14,0.34,10),
    new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0.96,depthWrite:false}));
  can.raycast=function(){};
  var band=new THREE.Mesh(new THREE.CylinderGeometry(0.145,0.145,0.06,10),
    new THREE.MeshBasicMaterial({color:0x8a949e,transparent:true,opacity:0.95,depthWrite:false}));
  band.position.y=0.07;band.raycast=function(){};
  g.add(can);g.add(band);g.renderOrder=914;
  return heroSolidDepth(g);
}
/* ② 流火 3：手雷爆炸 —— 亮黄爆心 + 橙色外壳 + 双层冲击环 + 上冲碎片 */
function heroFXFragBurst(x,y,z){
  var core=new THREE.Mesh(new THREE.SphereGeometry(0.7,14,10),
    new THREE.MeshBasicMaterial({color:0xffd24d,transparent:true,opacity:1,depthWrite:false}));
  core.position.set(x,y,z);core.raycast=function(){};heroFxPush(core,0.35);
  var shell=new THREE.Mesh(new THREE.IcosahedronGeometry(1.0,1),
    new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.85,depthWrite:false}));
  shell.position.set(x,Math.max(0.8,y),z);shell.raycast=function(){};heroFxPush(shell,0.45);
  heroFxRingAt(x,z,0xff8a3d,0.4,FRAG_R,0.55,0.09);
  heroFxRingAt(x,z,0xffd24d,0.4,FRAG_R*0.7,0.45,0.12);
  for(var i=0;i<16;i++){
    var m=new THREE.Mesh(new THREE.OctahedronGeometry(0.14,0),
      new THREE.MeshBasicMaterial({color:i%2?0xff8a3d:0xffd24d,transparent:true,opacity:0.95,depthWrite:false}));
    var a=Math.random()*Math.PI*2,r=1.0+Math.random()*5.5;
    m.position.set(x+Math.cos(a)*r,0.4+Math.random()*1.2,z+Math.sin(a)*r);
    m.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);m.raycast=function(){};
    heroFxPush(m,0.7,3);
  }
  spawnParticle(new THREE.Vector3(x,Math.max(0.8,y),z),0xff8a3d,16);
}
/* ②/③ 烟：落地炸开一团浓烟（多层大球慢慢撑开 + 末尾淡出）。灰白=镇岳 / 金色=白泽 / 暗紫=影月（batch161） */
/* 【batch200】烟球合并 —— 原来是 50 个 Mesh + 50 个材质 = **50 次 draw call/团**
   （同时两团烟就是 100 次），而它们同 group、同颜色、同不透明度，没有任何理由分开画。
   这里在创建时把 50 个球的顶点变换到 group 局部坐标，拼成**一个** BufferGeometry，
   材质也只留 1 个 → 1 次 draw call。
   ⚠️ 不用 THREE.BufferGeometryUtils：r128 的核心里没有它（在 examples/jsm 里），
      而这是个单文件游戏，不能加 import。所以这里手拼 position/normal/uv。
   ⚠️ 必须 toNonIndexed()：SphereGeometry 是索引几何，不同索引数量拼不到一起去。 */
function _合并烟球(list){
  var geos=[],total=0,i,j,m4=new THREE.Matrix4();
  for(i=0;i<list.length;i++){
    var it=list[i];
    var raw=new THREE.SphereGeometry(it[0],16,12);
    var sg=raw.toNonIndexed(); raw.dispose();
    m4.makeTranslation(it[1],it[2],it[3]);
    sg.applyMatrix4(m4);
    geos.push(sg); total+=sg.attributes.position.count;
  }
  var pos=new Float32Array(total*3),nor=new Float32Array(total*3),uv=new Float32Array(total*2),o=0;
  for(i=0;i<geos.length;i++){
    var a=geos[i].attributes,n=a.position.count;
    pos.set(a.position.array,o*3); nor.set(a.normal.array,o*3); uv.set(a.uv.array,o*2);
    o+=n; geos[i].dispose();
  }
  var out=new THREE.BufferGeometry();
  out.setAttribute('position',new THREE.BufferAttribute(pos,3));
  out.setAttribute('normal',new THREE.BufferAttribute(nor,3));
  out.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  out.computeBoundingSphere();
  return out;
}
function heroFXSmokePop(x,y,z,gold,dark){
  var col=dark?0x5b3fb0:gold?0xf3d98a:0xcfd8df;
  var g=new THREE.Group();
  // 每颗都是「双面 + SMOKE_PUFF_OP 不透明度」的大球：球层叠得越多，透出来的光越少 → 越浓。
  // 【batch107/108】层布局写在 SMOKE_PUFFS 里（外壳/内侧/贴地/顶盖/内芯/中心填充 共 6 层 56 球）：
  // 最坏情况（贴在判定圈边的人、被 8 米外平视看他的脚）视线要穿 ≥6 个球面（透光 0.05%），
  // 开镜放大也看不出后面的人。每帧的不透明度由 updateHeroFX 按 SMOKE_PUFF_OP 统一设置。
  var list=[];
  for(var L=0;L<SMOKE_PUFFS.length;L++){
    var ly=SMOKE_PUFFS[L];
    for(var i=0;i<ly.n;i++){
      var a=i/ly.n*Math.PI*2;                                     // 均匀铺一圈（抖动靠 jr/jy，保证最坏处也浓）
      var rad=ly.ring*(1+(Math.random()-0.5)*2*ly.jr);
      list.push([ly.r, Math.cos(a)*rad, ly.y+(Math.random()-0.5)*2*ly.jy, Math.sin(a)*rad]);
    }
  }
  var puffMesh=new THREE.Mesh(_合并烟球(list),
    /* 【batch202】blending 为什么不是默认的 NormalBlending：
       烟必须在后处理里"能被认出来"（合成阶段据此跳过 AO，否则 AO 会拿烟后面的深度
       在烟面上画出烟后物体的暗轮廓 = 看起来能透视，见 js/00 合成 shader 的说明）。
       做法只动 **alpha 通道**的混合：
         颜色：SRC_ALPHA, ONE_MINUS_SRC_ALPHA  ← 与 NormalBlending 逐位相同，烟的样子不变
         alpha：ZERO,      ONE_MINUS_SRC_ALPHA  ← a_out = a_in*(1-srcA)，被烟覆盖处一路乘到 0
       其他透明件走 NormalBlending，其 alpha 是 src*1+dst*(1-src)，dst=1 时恒为 1、不会被打穿，
       所以"alpha<1"等价于"这里有烟"，判据干净。 */
    new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:SMOKE_PUFF_OP,side:THREE.DoubleSide,depthWrite:false,
      blending:THREE.CustomBlending,
      blendSrc:THREE.SrcAlphaFactor, blendDst:THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha:THREE.ZeroFactor, blendDstAlpha:THREE.OneMinusSrcAlphaFactor}));
  puffMesh.raycast=function(){};                                   // 烟不参与拾取（原来每颗球都这么设）
  g.add(puffMesh);
  g.position.set(x,Math.max(0.4,y),z);
  g.scale.set(0.25,0.25,0.25);
  heroFxPush(g,SMOKE_LIFE,5);
  /* 【batch201】用户报「站在烟外，能透过烟看见烟里的东西和烟后面的物品」。
     根因不在烟本身浓不浓 —— 真几何测得烟后 10 米的 opaque 箱子/敌人、普通透明件、
     甚至 renderOrder=997 的联机名字牌，橙像素全都是 0（被烟彻底挡住）。
     漏的是 **901~915 这一档**：闪光弹/手雷/急救箱/烟罐/医疗包/破片的模型。
     原因是 three.js 的排序键 **groupOrder 优先于 renderOrder**：
     `projectObject()` 把 group.renderOrder 记进 groupOrder，`painterSortStable()`
     先比 groupOrder 再比 renderOrder。烟原来写 908，可下面那行 heroFxPush 内部
     有一句 `obj.renderOrder=900` 又把它盖回去了 —— 净结果烟是 **900**，
     比那批物件（901~915）都小，于是它们一律画在烟**之后** → 隔着浓烟看见"烟后的物品"。
     ⚠️ 所以这行必须在 heroFxPush 之后：谁后写谁生效。
     916 = 压过现有最高的一档；以后再加更高 groupOrder 的物件，这里要同步抬高。 */
  g.renderOrder=916;
  spawnParticle(new THREE.Vector3(x,Math.max(0.6,y),z),col,14);
}
/* ④ 白泽 3：肾上腺素（缠绕全身的金色光环） */
function heroFXAdren(){
  if(SK.adrenObj&&SK.adrenObj.parent)return;
  var g=new THREE.Group();
  var ring1=new THREE.Mesh(new THREE.TorusGeometry(0.62,0.05,8,32),
    new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:0.75,depthWrite:false}));
  ring1.rotation.x=Math.PI/2;ring1.position.y=-0.6;ring1.raycast=function(){};
  var ring2=ring1.clone();ring2.position.y=0.5;ring2.scale.set(0.8,0.8,0.8);
  ring2.material=ring1.material.clone();ring2.raycast=function(){};
  g.add(ring1);g.add(ring2);camera.add(g);SK.adrenObj=g;
}
