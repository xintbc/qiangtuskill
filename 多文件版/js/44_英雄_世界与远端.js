/* ============================================================
   【batch120】新英雄：世界层每帧推进
     · eclipses ：黑日悬空 + 强光脉冲（朝它看的人被致盲）
     · portals  ：日蚀之门互传（3 秒）
     · orbs     ：2 米电区，踏进来吃 25 伤 + 三重减益
     · traps    ：电荷陷阱（吸附 / 连劈 4×20 / 有血量能被打掉）
     · balls    ：球形闪电穿墙追踪 → 命中倒地
     · 倒地     ：AI 爬行 50 秒自灭 / 被补刀即死；自己也有一套遮罩与倒计时
   ============================================================ */
function updateHeroWorld(dt){
  updateEclipseZones(dt);
  updatePortals(dt);
  updateOrbs(dt);
  updateShadowZones(dt);    // 【batch158】影月：暗影毒圈
  updateShadowSelf(dt);     // 【batch158】影月：遁入暗影倒计时
  updateTraps(dt);
  updateBalls(dt);
  updateDownedAI(dt);
  updateSunEye(dt);
  updateZapFx(dt);
  updateDownedSelf(dt);
}
/* 黑日：悬空 + 自转 + 每 SOLAR_PULSE 秒一次脉冲；自己站在圈里 → 被动 +15% 移速 */
function updateEclipseZones(dt){
  var now=performance.now();
  SK.inEclipse=false;
  for(var i=SK.eclipses.length-1;i>=0;i--){
    var E=SK.eclipses[i];
    E.life-=dt;
    if(E.life<=0){
      if(E.obj&&E.obj.parent)E.obj.parent.remove(E.obj);
      SK.eclipses.splice(i,1);continue;
    }
    if(!E.obj){E.obj=heroMeshSolar();scene.add(E.obj);E.obj.position.set(E.x,E.y,E.z);}
    E.obj.position.set(E.x,E.y+Math.sin(now*0.0016+i)*0.16,E.z);
    if(E.obj.userData&&E.obj.userData.corona)E.obj.userData.corona.rotation.z+=dt*0.8;
    try{E.obj.lookAt(camera.position.x,E.obj.position.y,camera.position.z);}catch(e){}
    if(SK.idx===HERO_ECLIPSE){
      var ddx=camera.position.x-E.x,ddz=camera.position.z-E.z;
      if(ddx*ddx+ddz*ddz<=E.r*E.r)SK.inEclipse=true;
    }
    E.pulse-=dt;
    if(E.pulse<=0){
      E.pulse=SOLAR_PULSE;
      if(E.life>0.2){heroFXSolarPulse(E.x,E.y,E.z);if(!E.remote)eclipseBlind(E);}   // 远端黑日的致盲由服务端权威结算
    }
  }
}
/* 强光脉冲：**朝黑日看**的敌人被致盲（背对没事）；自己看它也会被闪 */
function eclipseBlind(E){
  for(var i=0;i<enemies.length;i++){
    var e=enemies[i];if(!e.root)continue;
    var dead=e.isNet?(!e.alive):(e.hp<=0);if(dead)continue;
    // 【batch152】全图范围：去掉 12 米半径限制（只保留视线判定），朝黑日看的敌人**全图**都会灼烧 + 致盲
    if(!hasLineOfSight2D(e.root.position.x,e.root.position.z,E.x,E.z,1.2))continue;
    var ey=(e.yawPivot&&e.yawPivot.rotation)?e.yawPivot.rotation.y:0;
    var k=flashFaceFactor(E.x,E.z,e.root.position.x,e.root.position.z,-Math.sin(ey),-Math.cos(ey));
    if(k<=0.05)continue;
    e.blindT=Math.max(e.blindT||0,SOLAR_BLIND*k);e.flash=1.0;   // 【batch154】闪色调到最强（受击染色 1 秒）
    e.burnT=Math.max(e.burnT||0,2.5);                            // 灼烧：看向黑日即点燃，持续约 2.5 秒（持续掉血）
    /* 【batch125】朝黑日看的人**每次脉冲吃 15 点伤害**（越正对越疼：按朝向系数折算）。
       —— 联机玩家（isNet）的伤害不在这里算，交给服务端 eclipseTick 权威结算，否则会扣两遍。 */
    if(!e.isNet){
      var _sd=Math.max(1,Math.round(SOLAR_DMG*k));
      e.hp-=_sd;
      spawnParticle(e.root.position.clone().setY(1.2),0xfff0c0,6);
      var _rr=Math.max(0,e.hp/e.maxHp);
      if(e.hb)e.hb.scale.x=_rr;
      if(e.hbMat)e.hbMat.color.setHex(_rr>.5?0x00ff00:_rr>.25?0xffff00:0xff0000);
      if(e.hp<=0){killEnemy(e,i,false);i--;continue;}   /* 【batch156】splice 后回退索引，别跳过下一个敌人 */
    }else{
      spawnParticle(e.root.position.clone().setY(1.2),0xfff0c0,6);
    }
  }
  /* 【batch154】全图：只要**看得见**太阳（视线无遮挡）就闪 + 灼伤，不再限 12 米半径 */
  var sdx=camera.position.x-E.x,sdz=camera.position.z-E.z;
  if(hasLineOfSight2D(camera.position.x,camera.position.z,E.x,E.z,camera.position.y-0.3)){
    var fwd=camera.getWorldDirection(new THREE.Vector3());
    var k2=flashFaceFactor(E.x,E.z,camera.position.x,camera.position.z,fwd.x,fwd.z);
    if(k2>SOLAR_DOT){
      /* 【batch154】闪光强度对齐闪光弹：SK.blind 置满 FLASH_BLIND → blindFx 映射出**整屏纯白 1 秒 + 淡出**。
         （原来置 SOLAR_BLIND=1，映射到 elapsed=2 秒的淡出段，只有 0.375 透明度——这就是"不够闪"的真因。）
         单机时自己也照吃这 15 点（联机由服务端权威结算，见 服务端.js 的 eclipseTick）。 */
      SK.blind=Math.max(SK.blind,FLASH_BLIND);SK.blindDur=Math.max(SK.blindDur||0,FLASH_BLIND);   // 【batch183】记总时长
      if(!netIsMulti()&&S.hp>0){S.hp-=Math.max(1,Math.round(SOLAR_DMG*k2));updateHp();if(S.hp<=0){S.hp=0;gameOver();}}
    }
  }
  heroBlindSync();
}
/* ==================== 【batch145】日蚀之门：虚化 / 放门 / 双向传送 ====================
   一对门 ＝ SK.portals 里的一条 {a:{x,y,z,nx,ny,nz,obj}, b:{...}, life}。
   人、投掷物都能穿；别人的门走 {t:'portal'} 报文在本地也开出来，同样能传送我。 */
function portalMake(x,y,z){
  var m=heroMeshPortal();m.position.set(x,y,z);m.renderOrder=902;
  m.raycast=function(){};
  return {x:x,y:y,z:z,nx:0,ny:0,nz:0,obj:m};
}
/* 两扇门互相"对看"：本地 +Z（环的正面）指向对面那扇 */
function portalFace(self,other){
  var dx=other.x-self.x,dy=other.y-self.y,dz=other.z-self.z;
  var L=Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
  self.nx=dx/L;self.ny=dy/L;self.nz=dz/L;
  faceNormal(self.obj,self.nx,self.ny,self.nz,'z');
}
function portalBuildPair(ax,ay,az,bx,by,bz){
  var G={life:PORTAL_LIFE,a:portalMake(ax,ay,az),b:portalMake(bx,by,bz)};
  portalFace(G.a,G.b);portalFace(G.b,G.a);
  scene.add(G.a.obj);scene.add(G.b.obj);
  return G;
}
function portalKillPair(G){
  if(!G)return;
  var ks=['a','b'];
  for(var i=0;i<2;i++){var P=G[ks[i]];if(P&&P.obj&&P.obj.parent)P.obj.parent.remove(P.obj);}
}
function portalTickPair(G,dt){
  var f=Math.max(0.25,Math.min(1,G.life/PORTAL_LIFE));
  var ks=['a','b'];
  for(var i=0;i<2;i++){
    var P=G[ks[i]];
    if(!P||!P.obj)continue;
    spinY(P.obj,dt*1.5);                                   // 绕**自身**轴转，免得冲掉"对看"的朝向
    if(P.obj.children[2])P.obj.children[2].rotation.z-=dt*2.2;
    P.obj.scale.set(f,f,f);
  }
}
/* 点在不在某扇门的判定球里；返回那扇门（不在就返回 null） */
function portalHit(G,x,y,z){
  if(!G)return null;
  var R2=PORTAL_R*PORTAL_R,ks=['a','b'];
  for(var i=0;i<2;i++){
    var P=G[ks[i]];if(!P)continue;
    var dx=x-P.x,dy=y-P.y,dz=z-P.z;
    if(dx*dx+dy*dy+dz*dz<=R2)return P;
  }
  return null;
}
function portalPartner(G,P){return (P===G.a)?G.b:G.a;}
/* 出门口：沿"门面朝向（远离配对门那一面）"往外挪 lift 米，并夹到世界边界内（不能出图） */
function portalExit(P,lift){
  var lim=worldLimit()-1.0;
  var x=P.x-(P.nx||0)*lift, y=P.y-(P.ny||0)*lift, z=P.z-(P.nz||0)*lift;
  x=Math.max(-lim,Math.min(lim,x)); z=Math.max(-lim,Math.min(lim,z)); y=Math.max(0.7,Math.min(46,y));
  return {x:x,y:y,z:z};
}
/* 投掷物穿门：进哪扇从哪扇出来，速度 / 引信全不变 */
function projPortalWarp(p){
  if(!SK.portals||!SK.portals.length)return false;
  for(var i=0;i<SK.portals.length;i++){
    var G=SK.portals[i],P=portalHit(G,p.x,p.y,p.z);
    if(!P)continue;
    var to=portalPartner(G,P),e=portalExit(to,PORTAL_EXIT_FWD);
    p.x=e.x;p.y=e.y;p.z=e.z;
    if(p.mesh)p.mesh.position.set(p.x,p.y,p.z);
    heroFxRingAt(P.x,P.z,0xb07dff,0.4,1.6,0.45,P.y-0.15);
    heroFxRingAt(to.x,to.z,0xfff0c0,0.4,1.6,0.45,to.y-0.15);
    return true;
  }
  return false;
}
/* 自己穿门：脚下落到"门下沿"（门心比脚底高 1.15 米）；落点沿**玩家视角朝前**偏移一点点、夹世界边界、且保证落在门触发球外（站着不动不会又被传回来） */
function portalWarpLocal(G,P){
  var to=portalPartner(G,P);
  var fdx=-Math.sin(yaw),fdz=-Math.cos(yaw);          // 玩家水平视角朝前方向（用 yaw，避免抬头/低头时水平偏移塌成 0）
  var lim=worldLimit()-1.0;
  var e={x:to.x+fdx*PORTAL_EXIT_FWD,y:to.y,z:to.z+fdz*PORTAL_EXIT_FWD};
  e.x=Math.max(-lim,Math.min(lim,e.x));e.z=Math.max(-lim,Math.min(lim,e.z));e.y=Math.max(0.7,Math.min(46,e.y));
  // 兜底：夹边界后仍落在任一扇门触发球内（出口门贴边、朝前正好指向界外时会发生）→
  // 沿多个候选方向把落点推到门触发球外，**优先选不出图的方向**，确保站着不动不会被传回
  if(portalHit(G,e.x,e.y,e.z)){
    var _c=[[fdx,fdz],[-fdz,fdx],[fdz,-fdx],[-fdx,-fdz],[0,1],[0,-1],[1,0],[-1,0]];
    for(var _ci=0;_ci<_c.length;_ci++){
      var _nx=e.x+_c[_ci][0]*PORTAL_R,_nz=e.z+_c[_ci][1]*PORTAL_R;
      if(_nx<-lim||_nx>lim||_nz<-lim||_nz>lim)continue;
      if(!portalHit(G,_nx,e.y,_nz)){e.x=_nx;e.z=_nz;break;}
    }
  }
  /* 【batch153】落点防穿模（门下方有建筑物的情况）：
     ① 脚下：按"门心高度"向下找最近的可站面（屋顶/楼板/地面），落点若被它顶住 → 站到那张面**顶上**，
        不再按"门心−1.15"硬塞进楼板里；② 头顶：塞得下才压低（保"不穿脚下"优先）；
     ③ 水平：落点卡在墙/方块里 → 就近螺旋找空点。 */
  var camY=Math.max(GROUND_Y,e.y-1.15);
  var _gh=groundHeightAt(e.x,e.z,Math.max(camY,e.y));           // 用门心高度找"脚下那张面"（比 camY 高的面才算顶住）
  if(_gh>camY)camY=_gh;                                          // 被屋顶/楼板顶住 → 站到顶面上
  var _hb=headBlockAt(e.x,e.z,camY);
  if(_hb<Infinity&&camY+HEAD_CLEAR>_hb&&_hb-HEAD_CLEAR>=_gh)camY=_hb-HEAD_CLEAR;
  if(isColliding(e.x,e.z,0.5,camY)){                             // 落点在墙/方块里 → 螺旋找空点
    var _fix=heroPortalFreeSpot(e.x,camY,e.z);
    e.x=Math.max(-lim,Math.min(lim,_fix.x));e.z=Math.max(-lim,Math.min(lim,_fix.z));
  }
  camera.position.x=e.x;camera.position.z=e.z;
  camera.position.y=camY;
  S.velY=0;S.landKick=0;S.onGround=false;SK.dash=0;
  heroFxRingAt(P.x,P.z,0xb07dff,0.4,1.9,0.5,P.y-0.15);
  heroFxRingAt(to.x,to.z,0xfff0c0,0.4,1.9,0.5,to.y-0.15);
}
/* 虚影：虚化时在"身体"位置立一个半透明人形，提示队友/自己身体还在原地 */
function heroGhostFx(on){
  if(on){
    if(!SK.ghostObj){
      var g=new THREE.Group();
      var body=new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.42,1.5,10),
        new THREE.MeshBasicMaterial({color:0xb07dff,transparent:true,opacity:0.22,side:THREE.DoubleSide,depthWrite:false}));
      body.position.y=0.95;body.raycast=function(){};
      var head=new THREE.Mesh(new THREE.SphereGeometry(0.26,12,10),
        new THREE.MeshBasicMaterial({color:0xfff0c0,transparent:true,opacity:0.34,depthWrite:false}));
      head.position.y=1.85;head.raycast=function(){};
      g.add(body);g.add(head);g.renderOrder=895;scene.add(g);SK.ghostObj=g;
    }
    SK.ghostObj.visible=true;
    if(SK.ghostFrom)SK.ghostObj.position.set(SK.ghostFrom.x,SK.ghostFrom.y-GROUND_Y,SK.ghostFrom.z);
    if(typeof weaponGroup!=='undefined')weaponGroup.visible=false;
    if(typeof leftHandCamGroup!=='undefined')leftHandCamGroup.visible=false;
  }else{
    if(SK.ghostObj){if(SK.ghostObj.parent)SK.ghostObj.parent.remove(SK.ghostObj);SK.ghostObj=null;}
    if(typeof weaponGroup!=='undefined')weaponGroup.visible=true;
    if(typeof leftHandCamGroup!=='undefined')leftHandCamGroup.visible=true;
  }
  var el=document.getElementById('ghostFx');
  if(el)el.style.display=on?'flex':'none';
}
/* 进虚化：身体位置记下来，视角自由飘 */
function heroPortalCast(){
  SK.ghostFrom={x:camera.position.x,y:camera.position.y,z:camera.position.z};
  SK.ghost=PORTAL_GHOST_MAX;SK.ghostSi=1;
  S.onLadder=false;S.velY=0;S.aiming=false;mouseDown=false;
  if(SK.hold)heroHoldCancel();
  heroGhostFx(true);
  showMsg('日蚀之门：虚化中（无敌）—— WASD 飘 / 空格升 / 蹲下键降；左键（或再按技能键）放门','#b07dff');
  heroHudUpdate(true);
  return true;
}
/* 虚化中的自由飘（在 updatePlayer 的移动段里调用） */
function heroGhostMove(dt,moveX,moveZ,isMoving,lenSq){
  /* 【batch150】虚化：身体留在原地、视角自由飘；水平被墙挡住（不穿墙，playerBlocked 逐轴判定），
     垂直仍可自由飞行（空格升高 / Shift 降低）。不受重力、不做推出修正。 */
  if(isMoving){
    var il=PORTAL_GHOST_SPD/Math.sqrt(lenSq);
    var nx=camera.position.x+moveX*il;
    if(Math.abs(nx)<worldLimit()-1.5 && !playerBlocked(nx,camera.position.z,camera.position.y))camera.position.x=nx;
    var nz=camera.position.z+moveZ*il;
    if(Math.abs(nz)<worldLimit()-1.5 && !playerBlocked(camera.position.x,nz,camera.position.y))camera.position.z=nz;
  }
  /* 【蹲下＝点击切换】虚化飘行的"下降"跟着蹲下状态走（原来读 Shift 是否按着，改切换后读 S.crouch） */
  var up=(keys.Space?1:0)-(S.crouch?1:0);
  /* 【batch151】垂直也要被楼板 / 天花板挡住（不再穿楼层）：
     上升顶到头顶上方最近楼板底面、下降落到脚下地板顶面。复用玩家自身的 headBlockAt /
     groundHeightAt（同一套世界坐标 Y 口径 —— slab 的 y0/y1 即世界 Y）。 */
  var ny=camera.position.y+up*PORTAL_GHOST_SPD*0.85;
  var _gh=groundHeightAt(camera.position.x,camera.position.z,camera.position.y);   // 脚下地板顶面（相机高度）
  var _hb=headBlockAt(camera.position.x,camera.position.z,camera.position.y);     // 头顶上方最近楼板/栏杆底面（世界Y）
  if(up>0&&_hb<Infinity&&ny+HEAD_CLEAR>_hb)ny=_hb-HEAD_CLEAR;   // 撞天花板 / 楼板底 → 停住
  else if(up<0&&_gh>0&&ny<_gh)ny=_gh;                            // 落穿地板 → 停在地板顶面
  camera.position.y=ny;
  var lim=worldLimit()-1.5;
  camera.position.x=Math.max(-lim,Math.min(lim,camera.position.x));
  camera.position.z=Math.max(-lim,Math.min(lim,camera.position.z));
  camera.position.y=Math.max(0.7,Math.min(46,camera.position.y));   // 兜底边界，正常已被上面的楼板/天花板夹住
  S.onGround=false;S.velY=0;
  SK.ghost-=dt;
  if(SK.ghost<=0)heroPortalPlace();          // 超时：就在当前位置把门放下（技能不白费）
}
/* 放门：出口门＝幽影停留处；入口门＝**身体身前** 2.4 米（不是脚下）；随后视角回到身体 */
function heroPortalPlace(){
  if(!(SK.ghost>0))return false;
  var gx=camera.position.x,gy=camera.position.y,gz=camera.position.z;
  var from=SK.ghostFrom||{x:gx,y:gy,z:gz};
  SK.ghost=0;SK.ghostSi=-1;
  camera.position.x=from.x;camera.position.y=from.y;camera.position.z=from.z;   // 视角回到身体
  S.velY=0;S.landKick=0;
  heroGhostFx(false);
  /* 出口门（幽影那边）：落点若正好埋在某堵墙里，就往外挪一点 */
  var out=heroPortalFreeSpot(gx,gy,gz);
  /* 入口门（身前）：从 2.6 米开始试，被墙挡住就往回收 */
  var fx=-Math.sin(yaw),fz=-Math.cos(yaw),feet=standSurfY();
  var inX=from.x+fx*1.2,inZ=from.z+fz*1.2;
  for(var d=2.6;d>=1.0;d-=0.7){
    var tx=from.x+fx*d,tz=from.z+fz*d;
    if(!isColliding(tx,tz,0.5,feet+GROUND_Y)){inX=tx;inZ=tz;break;}
  }
  var inY=feet+1.25;
  var G=portalBuildPair(inX,inY,inZ,out.x,out.y,out.z);
  SK.portals.push(G);
  while(SK.portals.length>3){portalKillPair(SK.portals.shift());}     // 最多同时 3 对，免得满屏门
  heroFxRingAt(inX,inZ,0xb07dff,0.4,2.2,0.5,inY-0.15);
  heroFxRingAt(out.x,out.z,0xfff0c0,0.4,2.2,0.5,out.y-0.15);
  showMsg('日蚀之门已开启（15 秒）：人走进去会被送到另一扇，扔出去的道具也一样','#b07dff');
  if(netIsMulti()&&NET.connected)
    netSend({t:'portal',a:[inX,inY,inZ],b:[out.x,out.y,out.z],life:PORTAL_LIFE});
  heroHudUpdate(true);
  return true;
}
/* 门被埋在墙里就往外找一个空点（找不到就抬高一点，至少让它能露出来） */
function heroPortalFreeSpot(x,y,z){
  var feet=y-GROUND_Y;
  if(!isColliding(x,z,0.6,feet))return {x:x,y:y,z:z};
  for(var r=0.6;r<=2.4;r+=0.6){
    for(var a=0;a<8;a++){
      var t=a*Math.PI/4,tx=x+Math.cos(t)*r,tz=z+Math.sin(t)*r;
      if(!isColliding(tx,tz,0.6,feet))return {x:tx,y:y,z:tz};
    }
  }
  return {x:x,y:Math.max(GROUND_Y+1.4,y),z:z};
}
/* 别人的门：本地也开出来（同样能传送我 / 我的道具） */
function heroPortalRemote(m){
  if(!m||!m.a||!m.b)return;
  var G=portalBuildPair(m.a[0],m.a[1],m.a[2],m.b[0],m.b[1],m.b[2]);
  G.life=(typeof m.life==='number'?m.life/1000:PORTAL_LIFE);
  G.remote=true;
  SK.portals.push(G);
  while(SK.portals.length>3){portalKillPair(SK.portals.shift());}
}
/* 日蚀之门：每对门共存 15 秒 —— 人（我）走进去立刻被送到另一扇；投掷物见 projPortalWarp */
function updatePortals(dt){
  if(SK.portalCd>0)SK.portalCd=Math.max(0,SK.portalCd-dt);
  for(var i=SK.portals.length-1;i>=0;i--){
    var G0=SK.portals[i];
    G0.life-=dt;
    if(G0.life<=0){portalKillPair(G0);SK.portals.splice(i,1);continue;}
    portalTickPair(G0,dt);
  }
  /* 自己走进任意一扇门（自己的 / 别人的都算）→ 立刻送到配对门 */
  if(SK.portalCd<=0&&S.playing&&!S.over&&S.hp>0&&SK.downed<=0&&SK.ghost<=0&&SK.portals.length){
    var _feet=camera.position.y-GROUND_Y;
    for(var g=0;g<SK.portals.length;g++){
      var G1=SK.portals[g],H=portalHit(G1,camera.position.x,_feet+1.15,camera.position.z);
      if(!H)continue;
      portalWarpLocal(G1,H);
      SK.portalCd=PORTAL_CD;
      showMsg('穿过日蚀之门','#b07dff');
      break;
    }
  }
}
/* 电区：目标踏进来 → 25 点电击（每个目标每次投掷只吃一次） + 20 秒三重减益 */
function updateOrbs(dt){
  for(var i=SK.orbs.length-1;i>=0;i--){
    var O=SK.orbs[i];
    O.life-=dt;
    if(O.life<=0){
      if(O.obj&&O.obj.parent)O.obj.parent.remove(O.obj);
      SK.orbs.splice(i,1);continue;
    }
    if(O.obj){
      O.obj.rotation.y+=dt*2.0;
      if(O.obj.userData&&O.obj.userData.shell)O.obj.userData.shell.rotation.x+=dt*3.0;
      O.zapT-=dt;
      if(O.zapT<=0){O.zapT=0.5;heroFXZapAt(O.x,O.y,O.z);}
    }
    if(!O.remote)orbShock(O);
  }
}
function orbShock(O){
  var now=performance.now();
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];if(!e.root||e.isNet)continue;
    if(e.hp<=0)continue;
    var ex=e.root.position.x-O.x,ez=e.root.position.z-O.z;
    if(ex*ex+ez*ez>O.r*O.r)continue;
    if(!O.hitT[e.__oid__||(e.__oid__='o'+(now+i))]){
      O.hitT[e.__oid__]=1;
      e.hp-=ORB_DMG;e.flash=0.30;
      spawnParticle(e.root.position.clone().setY(1.0),0x6ff0ff,8);
      var rr=Math.max(0,e.hp/e.maxHp);if(e.hb)e.hb.scale.x=rr;
      if(e.hbMat)e.hbMat.color.setHex(rr>.5?0x00ff00:rr>.25?0xffff00:0xff0000);
      heroFXZapAt(e.root.position.x,e.root.position.y+0.6,e.root.position.z);
      if(e.hp<=0){killEnemy(e,i,false);i--;continue;}   /* 【batch156】splice 后回退索引，别跳过下一个敌人 */
    }
    /* 三重减益：麻痹（再 −40%）/ 过载（不能开火）/ 易伤（受到伤害 +25%）。
       【batch121c 口径】AI 小兵只吃「麻痹 + 过载」两重（单机靶子不给易伤；对 AI 的伤害散落在枪/刀/
       震荡打击/手雷/电区/陷阱 6 个点，逐个乘系数不划算）。玩家侧三重齐全：单机自己踩进去走
       heroMitigate（SK.vuln），联机由服务端 applyDamage 乘 ORB_VULN。 */
    e.zapT=Math.max(e.zapT||0,ORB_DEBUFF);e.overloadT=Math.max(e.overloadT||0,ORB_DEBUFF);
    e.slowT=Math.max(e.slowT||0,0.6);
  }
  /* 自己踩进自己的电区：一样中招 —— 和服务端 orbTick 完全同口径
     （三重减益 20 秒 + 25 点电击，每颗球只算一次；原来只给自己 0.6 秒麻痹/过载、还不掉血）。 */
  var sdx=camera.position.x-O.x,sdz=camera.position.z-O.z;
  if(sdx*sdx+sdz*sdz<=O.r*O.r&&S.hp>0){
    SK.slow=Math.max(SK.slow,ORB_DEBUFF);SK.overload=Math.max(SK.overload,ORB_DEBUFF);
    SK.vuln=Math.max(SK.vuln,ORB_DEBUFF);SK.zap=ORB_DEBUFF;
    if(!O.selfHit){O.selfHit=1;S.hp-=ORB_DMG;updateHp();if(S.hp<=0){S.hp=0;gameOver();}}
  }
}
/* ==================== 【batch158】⑦影月：暗影毒圈 / 遁入暗影 ==================== */
/* 暗影毒圈：站在**同一层**的暗影里每秒被毒蚀 15 点（分层：|脚底高度差|>2 米不吃，二楼炸的毒不到一楼）。
   自己放的暗影毒不到自己（影月被动「暗影亲和」）；联机吃「别的影月」的暗影由服务端 shadowTick 结算（影月减半）。 */
function updateShadowZones(dt){
  for(var i=SK.shadows.length-1;i>=0;i--){
    var Z=SK.shadows[i];
    Z.life-=dt;
    if(Z.life<=0){if(Z.obj&&Z.obj.parent)Z.obj.parent.remove(Z.obj);SK.shadows.splice(i,1);continue;}
    if(Z.obj&&Z.obj.userData&&Z.obj.userData.rim){
      try{Z.obj.userData.rim.material.opacity=0.32+0.24*Math.abs(Math.sin(performance.now()*0.002+i));}catch(e){}
    }
    if(!Z.remote)shadowZoneShock(Z,dt);
  }
}
function shadowZoneShock(Z,dt){
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];if(!e.root||e.isNet||e.hp<=0)continue;
    var ex=e.root.position.x-Z.x,ez=e.root.position.z-Z.z;
    if(ex*ex+ez*ez>Z.r*Z.r)continue;
    if(Math.abs(e.root.position.y-Z.y)>2.0)continue;          // 【分层】暗影只毒它所在的那张地面
    e.hp-=SHADOW_DPS*dt;
    if(Math.random()<0.2)spawnParticle(e.root.position.clone().setY(Math.max(0.6,e.root.position.y+1.0)),0x8f7bff,3);
    var rr=Math.max(0,e.hp/e.maxHp);if(e.hb)e.hb.scale.x=rr;
    if(e.hbMat)e.hbMat.color.setHex(rr>.5?0x00ff00:rr>.25?0xffff00:0xff0000);
    if(e.hp<=0){killEnemy(e,i,false);i--;continue;}   /* splice 后回退索引（batch156 老规矩） */
  }
  /* 自己：自己放的暗影 → 影月被动免疫，不结算。别人（remote）的暗影伤害走服务端权威，不在这里扣。 */
}
/* 遁入暗影的逐帧推进：倒计时到点自动化回实体；期间不能开镜 / 开火 */
var _shadowFxEl=null;
function shadowFxSync(){                                   /* 【batch160】屏幕特效：暗紫黑边光 + 剩余秒数（呼吸感） */
  if(!_shadowFxEl)_shadowFxEl=document.getElementById('shadowFx');
  if(!_shadowFxEl)return;
  if(SK.shadowT>0){
    if(_shadowFxEl.style.display!=='flex')_shadowFxEl.style.display='flex';
    var tip=document.getElementById('shadowTip');
    if(tip)tip.textContent='⏱ 剩余 '+Math.ceil(SK.shadowT)+' 秒 · 不能攻击 / 开枪 / 开镜 · 再按 N 化回实体';
    try{_shadowFxEl.style.opacity=(0.80+0.20*Math.abs(Math.sin(performance.now()*0.0018))).toFixed(3);}catch(e){}
  }else if(_shadowFxEl.style.display!=='none'){_shadowFxEl.style.display='none';_shadowFxEl.style.opacity='';}
}
function updateShadowSelf(dt){
  if(SK.shadowT<=0)return;
  SK.shadowT-=dt;
  S.aiming=false;mouseDown=false;
  /* 【batch159】每帧强制收枪：切武器等操作会把 weaponGroup 顶回可见，暗影里手上一件东西都不能有 */
  if(typeof weaponGroup!=='undefined'&&weaponGroup)weaponGroup.visible=false;
  if(typeof leftHandCamGroup!=='undefined'&&leftHandCamGroup)leftHandCamGroup.visible=false;
  shadowFxSync();                                          // 【batch160】每帧刷新屏幕特效（倒计时 + 呼吸）
  if(SK.shadowT<=0)heroShadowExit();
}
/* 遁入暗影：原地留一团小暗影，本体无敌（敌人锁不住也打不到），手上不持有任何东西 */
function heroShadowEnter(){
  SK.shadowT=SHADOW_SELF_LIFE;
  var sy=standSurfY();
  var b=heroMeshShadowBlob();b.scale.set(1.1,1,1.1);
  b.position.set(camera.position.x,sy+0.06,camera.position.z);scene.add(b);
  SK.shadowObj=b;
  if(typeof weaponGroup!=='undefined'&&weaponGroup)weaponGroup.visible=false;    // 手上不持有任何东西
  if(typeof leftHandCamGroup!=='undefined'&&leftHandCamGroup)leftHandCamGroup.visible=false;
  heroFxRingAt(camera.position.x,camera.position.z,0x8f7bff,0.5,2.2,0.6,sy+0.10);
  showMsg('已遁入暗影（无敌 20 秒）：不能攻击 / 开枪 / 开镜；再按一次 N 化回实体','#8f7bff');
  shadowFxSync();                                          // 【batch160】立刻亮出屏幕特效
  heroHudUpdate(true);
}
function heroShadowExit(){
  SK.shadowT=0;
  shadowFxSync();                                          // 【batch160】退出即收掉屏幕特效
  if(SK.shadowObj){if(SK.shadowObj.parent)SK.shadowObj.parent.remove(SK.shadowObj);SK.shadowObj=null;}
  if(typeof weaponGroup!=='undefined'&&weaponGroup)weaponGroup.visible=true;
  if(typeof leftHandCamGroup!=='undefined'&&leftHandCamGroup)leftHandCamGroup.visible=(currentWeapon===WEAPON_KNIFE);
  heroFxRingAt(camera.position.x,camera.position.z,0x8f7bff,0.4,1.8,0.5);
  showMsg('已化回实体','#8f7bff');
  heroHudUpdate(true);
}
/* 电荷陷阱：敌人进圈 → 连劈 TRAP_N 下、每下 TRAP_DMG；血量归零 / 到期 = 报废 */
function updateTraps(dt){
  for(var i=SK.traps.length-1;i>=0;i--){
    var T=SK.traps[i];
    T.life-=dt;
    if(T.obj){
      /* 【batch141/142】必须绕**自身** Y 轴转：写 rotation.y 会按世界欧拉角重算，
         把"贴墙朝向"整个冲掉 —— 这正是"陷阱永远朝一面"的第二个原因。 */
      spinY(T.obj,dt*1.2);
      if(T.obj.userData&&T.obj.userData.core)T.obj.userData.core.rotation.y-=dt*3.0;
    }
    if(T.hp<=0||T.life<=0){
      heroFXZapAt(T.x,T.y,T.z);
      if(T.obj&&T.obj.parent)T.obj.parent.remove(T.obj);
      SK.traps.splice(i,1);continue;
    }
    if(T.strike>0){
      T.strike-=dt;
      if(T.strike<=0&&T.left>0){
        T.left--;T.strike=TRAP_GAP;
        heroFXTrapStrike(T.x,T.y,T.z);
        if(!T.remote)trapHit(T);
        if(T.left<=0)T.life=0;                     // 打完 4 下就报废
      }
    }else if(T.armed&&!T.remote){
      for(var k=0;k<enemies.length;k++){
        var e=enemies[k];if(!e.root)continue;
        var dead=e.isNet?(!e.alive):(e.hp<=0);if(dead)continue;
        var ex=e.root.position.x-T.x,ez=e.root.position.z-T.z;
        if(ex*ex+ez*ez<=T.r*T.r){
          T.armed=false;T.left=TRAP_N;T.strike=0.001;
          if(netIsMulti()&&NET.connected)netSend({t:'boom',k:'lightning',s:1,x:T.x,z:T.z});
          break;
        }
      }
    }
  }
}
function trapHit(T){
  for(var k=enemies.length-1;k>=0;k--){
    var e=enemies[k];if(!e.root||e.isNet)continue;
    if(e.hp<=0)continue;
    var ex=e.root.position.x-T.x,ez=e.root.position.z-T.z;
    if(ex*ex+ez*ez>T.r*T.r)continue;
    e.hp-=TRAP_DMG;e.flash=0.25;
    spawnParticle(e.root.position.clone().setY(1.0),0x6ff0ff,7);
    var rr=Math.max(0,e.hp/e.maxHp);if(e.hb)e.hb.scale.x=rr;
    if(e.hbMat)e.hbMat.color.setHex(rr>.5?0x00ff00:rr>.25?0xffff00:0xff0000);
    if(e.hp<=0)killEnemy(e,k,false);
  }
}
/* 子弹打掉陷阱（每发 20，陷阱 60 血 → 三发拆掉）；只打自己/队友放的实体陷阱 */
function trapBulletHit(pos,dmg){
  for(var i=0;i<SK.traps.length;i++){
    var T=SK.traps[i];
    if(T.remote)continue;
    var dx=pos.x-T.x,dz=pos.z-T.z,dy=pos.y-T.y;
    if(dx*dx+dz*dz<=0.40&&dy>-0.7&&dy<1.1){T.hp-=dmg;heroFXZapAt(T.x,T.y,T.z);return true;}
  }
  return false;
}
/* 球形闪电：穿墙追踪最近的敌人（不需要视线），命中 → 倒地 */
/* 【batch123】⑥闪电 N「球形闪电」改成「装填 → 左键一发一发打」
   用户反馈：不应该是原地释放。原来按下 N 就在脚下一次性摆出 3 枚，手感很奇怪。
   现在：按 N ＝ **装填 3 发**（HUD 技能槽显示剩余发数），之后每点一次左键朝视线前方
   飞出一枚球状闪电（穿墙追踪 40 米内最近的敌人，命中就让人倒地）；打完 3 发自动收工。
   联机：装填时上报 {t:'skill',k:'lightning',s:2}（服务端记 130 秒大招冷却 + 播起手特效），
   每枚**命中**时再上报 {t:'boom',k:'lightning',s:2,x,z,tgt:[id]}，由服务端校验
   （同房间 + 40 米内 + 目标合法）后判倒地 —— 和原来一样是服务端权威。 */
function heroBallArm(){
  if(SK.ballLeft>0){showMsg('球形闪电 已经装填好了：左键发射','#6ff0ff');return;}
  SK.ballLeft=BALL_N;
  SK.ballGap=0;
  /* 【batch123b】手持动画：和四件投掷物复用同一套「掏出来 / 托在手里」的动作
     （HOLD_POSE.ball + heroHoldShow），枪/刀自动收起，手里那颗球会缓缓自转。 */
  SK.hold={kind:'ball',si:2};
  heroHoldShow('ball');
  heroFxRing(0x00e5ff,0.4,8,0.6,0.07,52,0);
  showMsg('球形闪电 已装填 '+BALL_N+' 发：左键一发一发打出去','#6ff0ff');
  heroHudUpdate(true);
}
/* 打出一发。返回 true ＝ 这一下左键被球形闪电接管了（不要再去开枪） */
function heroBallFire(){
  if(!(SK.ballLeft>0))return false;
  if(SK.ballGap>0)return true;                      // 两发之间留一点间隔，连点也不会同帧糊成一片
  SK.ballGap=BALL_FIRE_GAP;
  SK.ballLeft--;
  /* 手持动画：万一中途换过枪/刀把球收起来了，打下一发时重新托回手里 */
  if(!SK.hold||SK.hold.kind!=='ball'){SK.hold={kind:'ball',si:2};heroHoldShow('ball');}
  /* 【batch123b】用户："不是往前发射吗？为什么会追踪啊？"
     —— 对，就是**朝前直着飞出去**的投射物：不索敌、不追踪、不穿墙。
        打到谁算谁（命中就让人倒地），撞墙就消散，飞满 BALL_LIFE 秒也自己消失。 */
  var fwd=camera.getWorldDirection(new THREE.Vector3());
  var cam=camera.position;
  var m=heroMeshBall();scene.add(m);
  var sx=cam.x+fwd.x*0.9, sy=cam.y-0.22+fwd.y*0.9, sz=cam.z+fwd.z*0.9;
  m.position.set(sx,sy,sz);
  SK.balls.push({x:sx,y:sy,z:sz,mesh:m,life:BALL_LIFE,
                 vx:fwd.x*BALL_SPD,vy:fwd.y*BALL_SPD,vz:fwd.z*BALL_SPD});
  heroFXZapAt(sx,sy,sz);
  if(SK.ballLeft<=0){
    /* 【重要】打完只能调 heroHoldHide（收手 + 枪/刀回来）；
       千万别用 heroHoldCancel —— 那个函数会"退还冷却"（SK.cds[si]=0），
       一用就把 130 秒大招冷却白白退掉了。 */
    SK.hold=null;heroHoldHide();
  }
  showMsg(SK.ballLeft>0?('⚡ 球形闪电 剩 '+SK.ballLeft+' 发（左键继续打）'):'⚡ 球形闪电 打完了','#6ff0ff');
  heroHudUpdate(true);
  return true;
}
/* 球心落在谁身上了（水平距离 + 高度都要对得上；已经倒地的、自己人跳过） */
function ballHitAt(x,y,z){
  for(var j=0;j<enemies.length;j++){
    var e=enemies[j];if(!e.root)continue;
    var dead=e.isNet?(!e.alive):(e.hp<=0);if(dead)continue;
    if(e.isNet&&NET.id&&e.netId===NET.id)continue;
    if(e.downedLife>0)continue;
    var rp=heroEntWorld(e);
    var dx=rp.x-x,dz=rp.z-z;
    if(dx*dx+dz*dz>BALL_HIT_R*BALL_HIT_R)continue;
    if(y<rp.y-0.5||y>rp.y+2.2)continue;
    return e;
  }
  return null;
}
/* 【batch134】球状闪电"近身淡出"。
   用户："闪电的大招，球状闪电太遮挡屏幕了。" 糊屏的真凶是它飞到眼前那几帧：
   一颗实心白球 + 附加混合光晕，离相机不到 1 米时整块白盖住准星。
   做法：按"球心到相机的距离"动态缩+淡化 —— 越近越小越透（最近只剩 10% 大小），
   3.4 米外恢复原样（该看见还是看得见）。
   基准缩放 / 基准不透明度在**第一次调用时**记下来，所以 boss 球先做过
   「0.26 缩放 + ×0.40 透明」那套加工也不会被覆盖。
   注意：这里只动视觉，碰撞半径（ballHitAt / BOSS_BALL_HIT_R）一点没动。 */
function ballFadeNearCam(mesh){
  if(!mesh)return;
  try{
    if(mesh.userData._bs===undefined)mesh.userData._bs=mesh.scale.x||1;
    var dx=camera.position.x-mesh.position.x,dy=camera.position.y-mesh.position.y,dz=camera.position.z-mesh.position.z;
    var d=Math.sqrt(dx*dx+dy*dy+dz*dz);
    var k=(d-1.1)/3.4; if(k<0.10)k=0.10; else if(k>1)k=1;
    mesh.scale.setScalar(mesh.userData._bs*k);
    var f=0.25+0.75*k;
    mesh.traverse(function(o){
      if(o&&o.material&&typeof o.material.opacity==='number'){
        if(o.userData._ob===undefined)o.userData._ob=o.material.opacity;
        o.material.opacity=o.userData._ob*f;
      }
    });
  }catch(e){}
}
function updateBalls(dt){
  if(SK.ballGap>0)SK.ballGap=Math.max(0,SK.ballGap-dt);      // 【batch123】两发之间的小间隔
  for(var i=SK.balls.length-1;i>=0;i--){
    var B=SK.balls[i];
    B.life-=dt;
    if(B.life<=0||!B.mesh){
      if(B.mesh&&B.mesh.parent)B.mesh.parent.remove(B.mesh);
      SK.balls.splice(i,1);continue;
    }
    if(B.mesh.userData&&B.mesh.userData.spikes)B.mesh.userData.spikes.rotation.y+=dt*6;
    /* 小步推进：34 米/秒的球一帧能走好几米，一步到位会"穿过"人和墙（隧道效应） */
    var travel=Math.sqrt(B.vx*B.vx+B.vy*B.vy+B.vz*B.vz)*dt;
    var steps=Math.max(1,Math.min(16,Math.ceil(travel/0.35)));
    var gone=false;
    for(var st=1;st<=steps;st++){
      B.x+=B.vx*dt/steps;B.y+=B.vy*dt/steps;B.z+=B.vz*dt/steps;
      var e=ballHitAt(B.x,B.y,B.z);
      if(e){
        if(B.mesh.parent)B.mesh.parent.remove(B.mesh);
        heroFXBallHit(B.x,B.y,B.z);
        if(!e.isNet)downedEnemy(e);                                  // 单机：本地结算倒地
        else if(netIsMulti()&&NET.connected)                         // 联机：报命中点 + 目标 id，服务端校验
          netSend({t:'boom',k:'lightning',s:2,x:B.x,z:B.z,tgt:[e.netId]});
        gone=true;break;
      }
      if(isColliding(B.x,B.z,0.18,B.y)){               // 撞墙（和子弹同款判定）→ 消散
        if(B.mesh.parent)B.mesh.parent.remove(B.mesh);
        heroFXZapAt(B.x,B.y,B.z);
        gone=true;break;
      }
    }
    if(gone){SK.balls.splice(i,1);continue;}
    B.mesh.position.set(B.x,B.y,B.z);
    ballFadeNearCam(B.mesh);                                   // 【batch134】近身淡出，别糊住准星
    if(Math.random()<0.35)heroFXZapAt(B.x,B.y,B.z);
  }
}
/* 让一个 AI 小兵倒地：血量 1、瘫倒、不能开枪、50 秒自灭、被补刀即死 */
function downedEnemy(e){
  if(e.downedLife>0)return;
  e.hp=1;
  if(e.hb)e.hb.scale.x=Math.max(0,e.hp/e.maxHp);
  if(e.hbMat)e.hbMat.color.setHex(0xff0000);
  e.downedLife=DB_DOWN;
  e.aiState='search';
  if(e.aimLine)e.aimLine.visible=false;
  showMsg('⚡ 有敌人被球形闪电击倒！补刀即死 / 50 秒后自灭','#6ff0ff');
}
function updateDownedAI(dt){
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];if(!e.root||e.isNet)continue;
    if(e.downedLife>0){
      if(!e._dbSlump){e._dbSlump=true;if(e.g&&e.g.rotation){e.g.rotation.x=-1.35;e.g.position.y=0.18;}}
      e.downedLife-=dt;
      if(e.downedLife<=0){e.hp=0;killEnemy(e,i,false);}
    }
  }
}
/* 日之眼：跟着自己走的金色巨眼（30 米内敌人全部暴露，见 updateHeroMark / mmDetected） */
function updateSunEye(dt){
  if(SK.suneyeT<=0)return;
  SK.suneyeT=Math.max(0,SK.suneyeT-dt);
  if(!SK.suneyeObj){SK.suneyeObj=heroMeshSunEye();scene.add(SK.suneyeObj);}
  var t=performance.now()*0.001;
  /* 【batch125】眼睛钉在**落点**（不再跟着自己走），所以暴露范围也是以它为中心 */
  var _ex=(SK.suneyeX==null?camera.position.x:SK.suneyeX), _ez=(SK.suneyeZ==null?camera.position.z:SK.suneyeZ);
  var _ey=(SK.suneyeY==null?GROUND_Y-2:SK.suneyeY);
  /* 【batch143】沿**所在面的法线**悬出去 2.7 米：地面→正上方（与旧行为逐字一致），
     墙面→朝屋外，天花板→朝下。并把正面（本地 +Z）转向法线。 */
  var _en=SK.suneyeN||[0,1,0];
  var _eL=2.7+Math.sin(t*1.4)*0.16;
  SK.suneyeObj.position.set(_ex+_en[0]*_eL,_ey+_en[1]*_eL,_ez+_en[2]*_eL);
  if(_en[1]<0.9)faceNormal(SK.suneyeObj,_en[0],_en[1],_en[2],'z');
  spinY(SK.suneyeObj,dt*0.9);
  SK.suneyeR=SUNEYE_R;
  if(SK.suneyeT<=0&&SK.suneyeObj){if(SK.suneyeObj.parent)SK.suneyeObj.parent.remove(SK.suneyeObj);SK.suneyeObj=null;}
}
/* 触电 / 过载的屏幕层：满屏电弧 + 轻微抖动，并且期间不能开镜 */
function updateZapFx(dt){
  if(SK.overload>0)SK.overload=Math.max(0,SK.overload-dt);
  if(SK.vuln>0)SK.vuln=Math.max(0,SK.vuln-dt);
  if(SK.zap>0)SK.zap=Math.max(0,SK.zap-dt);
  if(SK.overload>0)S.aiming=false;                              // 过载：不能开镜
  var el=document.getElementById('zapFx');if(!el)return;
  if(SK.overload<=0){if(el.style.opacity!=='0'){el.style.opacity='0';el.style.transform='';}return;}
  el.style.opacity=(0.45+0.35*Math.random()).toFixed(3);
  el.style.transform='translate('+((Math.random()-0.5)*7).toFixed(1)+'px,'+((Math.random()-0.5)*7).toFixed(1)+'px)';
}
/* 自己倒地：遮罩 + 倒计时（联机时"是否死亡 / 是否被扶起"由服务端说了算） */
function updateDownedSelf(dt){
  var el=document.getElementById('downedFx');
  if(SK.downed>0){
    SK.downed=Math.max(0,SK.downed-dt);
    if(el&&el.style.display!=='flex')el.style.display='flex';
    var tip=document.getElementById('downedTip');
    if(tip)tip.textContent='⏱ 倒地倒计时 '+Math.ceil(SK.downed)+' 秒 · 被队友治疗就能站起来；归零就死';
    S.aiming=false;mouseDown=false;
  }else if(el&&el.style.display!=='none'){el.style.display='none';}
}
/* 别人的电荷陷阱：本地放个装饰件（不会本地触发，结算在服务端） */
function remoteTrap(x,y,z,nx,ny,nz){
  var m=heroMeshTrap();scene.add(m);m.position.set(x,y,z);
  /* 【batch141】按中继过来的法线贴面（老服务端没有 nx/ny/nz → 用 +Y，即老行为） */
  try{
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),
      new THREE.Vector3(nx||0,(ny===undefined?1:ny),nz||0).normalize());
  }catch(e){}
  SK.traps.push({x:x,y:y,z:z,r:TRAP_R,hp:TRAP_HP,life:TRAP_LIFE,obj:m,armed:false,left:0,strike:0,remote:true});
}
/* ---------------- 别人的技能（联机）：在对方模型上播同一套特效 ---------------- */
/* 联机：别人扔出的投掷物 —— 用他给的「出生点+初速」在本地跑同一套物理，
   于是你能亲眼看见那颗手雷在天上飞过来。这里只播画面，结算由服务端在引爆时下发。 */
function heroRemoteThrow(e,kind,s,th){
  if(!th)return;
  s=s|0;
  // 只负责「让这件投掷物在本机也飞一遍」；特效统一由服务端引爆时的 {t:'boom'} 广播播（heroRemoteBoom）
  var mesh=null,lf=0;
  if(kind==='scout'&&s===0){mesh=heroMeshMine();lf=12;}                    // 探测器：落地后留 12 秒
  else if(kind==='medic'&&s===0){mesh=heroMeshPulse();lf=PULSE_LAND_FUSE;} // 医疗脉冲弹：落地炸开治疗脉冲
  else if(kind==='scout'&&s===1){mesh=heroMeshFlash();lf=FLASH_FUSE;}      // 闪光弹：落地后再等引信
  else if(kind==='medic'&&s===1){mesh=heroMeshMedkit();lf=0.6;}            // 急救箱：落地开箱
  else if(kind==='rusher'&&s===2)mesh=heroMeshFrag();                      // 手雷：th.fuse 自带引信
  else if(kind==='guard'&&s===1){mesh=heroMeshSmoke(false);lf=SMOKE_LAND_FUSE;}
  else if(kind==='medic'&&s===2){mesh=heroMeshSmoke(true);lf=SMOKE_LAND_FUSE;}
  /* 【batch120】新英雄的四件投掷物 */
  else if(kind==='eclipse'&&s===0)mesh=heroMeshSolar();                    // 蚀日：黑日
  else if(kind==='eclipse'&&s===1)mesh=heroMeshPortal();                   // 日蚀之门
  else if(kind==='lightning'&&s===0){mesh=heroMeshOrb();lf=0.45;}          // 闪电光球
  else if(kind==='lightning'&&s===1){mesh=heroMeshTrap();lf=-1;}           // 电荷陷阱（吸附靠落地回调）
  /* 【batch143】日蚀之门 / 日之眼：**别人以前完全看不见**这两件
     （heroRemoteThrow 里根本没有它们，服务端也不处理 eclipse 的 s=1/s=2）。
     现在本地按同一套物理飞一遍，落地按所在面的法线钉在那张面上（地面 / 墙 / 天花板都行），
     圈也跟着贴那一面。纯画面 —— 门和眼的判定本来就走投掷者本机，服务端不参与。 */
  else if(kind==='eclipse'&&s===2)mesh=heroMeshSunEye();                   // 别人的日之眼（【batch145】门不再飞行）
  else if(kind==='scout_sp'&&s===2)mesh=heroMeshSpDrone();                 // 【batch172】别人的蜂鸟无人机
  else if(kind==='eclipse_sp'&&s===1){mesh=heroMeshSun();lf=0.05;}       // 【batch183】别人的堕日：小太阳飞一遍，落地即消（landFuse 必须 >0，否则 fuse=-1 永远不消失）；燃烧区由施法者的 spzone 广播画
  if(!mesh)return;
  var _landR=null;
  if(kind==='eclipse'&&s===2)_landR=function(pp){
    var _n2=[pp.nx||0,(typeof pp.ny==='number'?pp.ny:1),pp.nz||0];
    mountAt(pp.mesh,pp.x,pp.y-PROJ_R,pp.z,_n2[0],_n2[1],_n2[2],2.7,'z');
    heroFXSunEye(pp.x,pp.z,pp.y-PROJ_R,_n2[0],_n2[1],_n2[2]);
    projRemove(pp,true);
    var _g2=pp.mesh;setTimeout(function(){try{if(_g2.parent)_g2.parent.remove(_g2);}catch(err){}},SUNEYE_LIFE*1000);
  };
  var _rp=projSpawn(kind+':'+s,th.x,th.y,th.z,th.vx,th.vy,th.vz,
    {fuse:(th.fuse==null?-1:th.fuse),landFuse:lf,mesh:mesh,remote:true,onLand:_landR,
     /* 【batch172】别人的蜂鸟无人机：直线飞、无重力、0.65 秒后消失（纯画面） */
     straight:!!th.straight,life:(th.life==null?-1:th.life)});
  if(_rp&&_rp.mesh)_rp.mesh.scale.setScalar(1.3);   // 【batch101】别人的投掷物放大一圈：远处也能看见它在飞
}
/* 联机：别人的投掷物引爆 → 在引爆点播特效（谁被致盲 / 谁回血由服务端另行下发） */
function heroRemoteBoom(m){
  var x=(typeof m.x==='number')?m.x:0,z=(typeof m.z==='number')?m.z:0;
  /* 【batch232】服务端补发"场上还留着的烟/黑日/电区/毒圈"时会带 left＝剩余毫秒。
     有它就按剩余时间算寿命 —— 后进来的人看到的是"还剩几秒"，而不是重新数满 14 秒。 */
  var _左=(typeof m.left==='number'&&m.left>0)?m.left/1000:null;
  var s=(typeof m.s==='number')?(m.s|0):1;
  /* 【batch135】引爆点高度：撞墙 / 在空中引爆时服务端会把 y 一起中继过来，
     本机也要在**那个高度**播特效 —— 原来一律硬写 0.9 / 0.6，
     所以二楼的烟总是在一楼冒（用户："2楼有特效，1楼就没有"）。
     老服务端没有这个字段 → my=null → 全部退回原来的固定高度，行为不变。 */
  var my=(typeof m.y==='number')?m.y:null;
  var _sy=(my==null?0.9:Math.max(0.05,my-PROJ_R));            // 地面类特效的落点高度
  var _my=(my==null?0.6:Math.max(0.05,my-PROJ_R));            // 烟雾 / 急救箱那两颗原本用 0.6
  if(m.k==='scout')heroFXFlash(x,_sy,z);
  else if(m.k==='rusher')heroFXFragBurst(x,_sy,z);
  else if(m.k==='medic'&&s===0)heroFXHealAt(x,z,my==null?0:_sy);
  else if(m.k==='medic'&&s===1)heroFXMedkitBurst(x,_my,z);
  else if(m.k==='medic'&&s===2){heroFXSmokePop(x,_my,z,true);smokeZones.push({x:x,y:_my,z:z,r:SMOKE_R,t:(_左!=null?_左:SMOKE_LIFE),gold:true});}
  else if(m.k==='guard'){heroFXSmokePop(x,_my,z,false);smokeZones.push({x:x,y:_my,z:z,r:SMOKE_R,t:(_左!=null?_左:SMOKE_LIFE),gold:false});}
  /* 【batch120】新英雄 */
  else if(m.k==='eclipse'&&s===0){                     // 别人的蚀日：黑日悬空（致盲由服务端权威结算，这里只是画面）
    heroFXSolarAt(x,0.9,z);
    SK.eclipses.push({x:x,z:z,r:SOLAR_R,y:0.9+SOLAR_H,life:(_左!=null?_左:SOLAR_LIFE),pulse:SOLAR_PULSE,obj:null,remote:true});
  }
  else if(m.k==='lightning'&&s===0){                   // 别人的闪电光球：电区画面（伤害/减益由服务端结算）
    heroFXOrbPop(x,_sy,z);
    var _om2=heroMeshOrb();scene.add(_om2);_om2.position.set(x,_sy,z);
    SK.orbs.push({x:x,z:z,y:_sy,r:ORB_R,life:(_左!=null?_左:ORB_LIFE),obj:_om2,remote:true,zapT:0,hitT:{}});
  }
  else if(m.k==='yingyue'&&s===0){                     // 【batch161】别人的暗影烟雾弹：紫色烟团（之前远端完全看不到烟）
    heroFXSmokePop(x,_my,z,false,true);
    smokeZones.push({x:x,y:_my,z:z,r:SMOKE_R,t:(_左!=null?_左:SMOKE_LIFE),gold:false,dark:1});
  }
  else if(m.k==='yingyue'&&s===1){                     // 【batch158】别人的暗影炸弹：本地也漫出毒圈（毒伤由服务端 shadowTick 结算）
    heroFxRingAt(x,z,0x8f7bff,0.8,SHADOW_R*2,0.8,_sy+0.12);
    var _sbm=heroMeshShadowBlob();_sbm.scale.set(SHADOW_R,1,SHADOW_R);
    _sbm.position.set(x,Math.max(0.06,_sy+0.06),z);scene.add(_sbm);
    SK.shadows.push({x:x,y:Math.max(0,_sy),z:z,r:SHADOW_R,life:(_左!=null?_左:SHADOW_LIFE),obj:_sbm,remote:true});
  }
  else if(m.k==='lightning'&&s===1)heroFXTrapStrike(x,_sy,z);   // 别人的陷阱触发：只播落雷
}
function heroRemoteFX(e,kind,s,x,y,z,nx,ny,nz){
  if(!e||!e.root)return;
  s=s|0;
  /* 【batch176】四套 SP 形态的**瞬发**特效：以前别人放 SP 技能，对面屏幕上一点反应都没有
     （持续区域类走 spzone 报文，这里只补瞬发的那几个，位置用施法者发来的落点）。 */
  var _px=(typeof x==='number')?x:e.root.position.x;
  var _pz=(typeof z==='number')?z:e.root.position.z;
  var _py=(typeof y==='number')?y:e.root.position.y;
  if(kind==='rusher_sp'){
    if(s===2){                                    // 焚天新星：8 米火环 + 爆燃粒子
      heroFxRingAt(_px,_pz,0xff8a3d,8,0.7,0.55);
      try{spawnParticle(new THREE.Vector3(_px,_py+1.0,_pz),0xff8a3d,26,0.5,true);}catch(_){}
      return;
    }
    if(s===1){                                    // 爆燃弹：装填时橙色闪光
      try{spawnParticle(new THREE.Vector3(_px,_py+1.1,_pz),0xff6a1a,14,0.4,true);}catch(_){}
      heroFxRingAt(_px,_pz,0xff6a1a,2.2,0.6,0.5);
      return;
    }
    if(s===0){                                    // 烈焰之路：突进起点火环（火区本身由 spzone 下发）
      heroFxRingAt(_px,_pz,0xff8a3d,1.6,0.5,0.5);
      return;
    }
  }
  if(kind==='scout_sp'&&s===1){                   // 猎杀标记：金色环（标记是他自己看的，这里只给个"他在标记"的反馈）
    heroFxRingAt(_px,_pz,0xffd166,2.4,0.7,0.5);
    return;
  }
  if(kind==='medic_sp'&&s===0){                   // 肾上腺素：绿环
    heroFxRingAt(_px,_pz,0x4fe08a,1.8,0.6,0.45);
    return;
  }
  if(kind==='guard_sp'&&s===2){                   // 力场穹顶：罩子本体由 spzone 下发，这里补一圈起手环
    heroFxRingAt(_px,_pz,0x6fd6ff,6,0.6,0.4);
    return;
  }
  if(kind==='eclipse_sp'){
    /* 【batch183】蚀日者 · 焚曜的两招致盲：以前别人放这俩技能，对面屏幕上一点反应都没有
       （服务端根本没把 eclipse_sp 登记进 SKILL_IDS，{t:'skill'} 报文被直接丢掉）。 */
    if(s===0){                                    // 日冕喷发：橙白光环 + 粒子（和施法者本地同一套）
      heroFxRingAt(_px,_pz,0xffd27a,12,0.8,0.5);
      try{spawnParticle(new THREE.Vector3(_px,_py+1.0,_pz),0xffd27a,20,0.5,true);}catch(_){}
      return;
    }
    if(s===2){                                    // 蚀日 · 白夜：暗色大环 + 金边（天整个黑下来）
      heroFxRingAt(_px,_pz,0x1a1030,26,1.2,0.7);
      heroFxRingAt(_px,_pz,0xffb347,14,1.0,0.5);
      return;
    }
  }
  if(kind==='guard'){
    if(s===2){
      var tiles=new THREE.Group();
      var tmat=new THREE.MeshBasicMaterial({color:0x5ef07a,transparent:true,opacity:0.2,side:THREE.DoubleSide,depthWrite:false});
      for(var i=0;i<7;i++){
        var hex=new THREE.Mesh(new THREE.CircleGeometry(0.85,6),tmat);
        hex.rotation.x=-Math.PI/2;hex.raycast=function(){};
        var a=i/6*Math.PI*2,rr=(i===0?0:1.5);
        hex.position.set(Math.cos(a)*rr,0.02,Math.sin(a)*rr);tiles.add(hex);
      }
      /* 【batch143】别人的堡垒阵地要铺在**他放技能时脚下那张面**上（服务端把 y 中继过来），
         不再一律铺在 y=0 的一楼地板上。老服务端没有 y → 退回老行为（0）。 */
      tiles.position.set((typeof x==='number')?x:e.root.position.x,
                         (typeof y==='number')?y:0,
                         (typeof z==='number')?z:e.root.position.z);
      scene.add(tiles);setTimeout(function(){try{scene.remove(tiles);}catch(err){}},8000);
      return;
    }
    var col=(s===1)?0x7dffb0:0x5ef07a,rad=(s===1)?1.55:1.25;
    var g=heroShieldObj(col,rad);
    g.scale.set(1.2,1.2,1.2);g.position.set(0,(e.sz||1.28)*1.02,0);
    e.root.add(g);
    setTimeout(function(){try{e.root.remove(g);}catch(err){}},6000);
    return;
  }
  if(kind==='medic'){
    if(s===1){
      var box=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.4,0.5),
        new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:0.9,depthWrite:false}));
      box.position.set(e.root.position.x,e.root.position.y+0.3,e.root.position.z);
      box.raycast=function(){};heroFxPush(box,0.8,3);
      var rr2=new THREE.Mesh(new THREE.RingGeometry(0.9,1.0,36),
        new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:0.8,side:THREE.DoubleSide,depthWrite:false}));
      rr2.rotation.x=-Math.PI/2;rr2.position.set(e.root.position.x,0.06,e.root.position.z);
      rr2.raycast=function(){};heroFxPush(rr2,0.7);rr2.userData={r0:0.5,r1:6};
      return;
    }
    if(s===2){
      var ring=new THREE.Mesh(new THREE.TorusGeometry(0.6,0.05,8,28),
        new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:0.7,depthWrite:false}));
      ring.rotation.x=Math.PI/2;ring.position.y=0.6;ring.raycast=function(){};
      e.root.add(ring);setTimeout(function(){try{e.root.remove(ring);}catch(err){}},7000);
      return;
    }
    var aura=new THREE.Mesh(new THREE.CircleGeometry(3.6,36),
      new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:0.16,side:THREE.DoubleSide,depthWrite:false}));
    aura.rotation.x=-Math.PI/2;aura.position.set(e.root.position.x,0.05,e.root.position.z);
    aura.raycast=function(){};heroFxPush(aura,5);
    return;
  }
  if(kind==='scout'){
    if(s===0){                                   // 别人投了战术探测器：落点附近炸一台小装置 + 一圈侦测环
      var mpx=(typeof x==='number')?x:e.root.position.x,mpz=(typeof z==='number')?z:e.root.position.z;
      var mg=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.21,0.34,8),
        new THREE.MeshBasicMaterial({color:0x49b6ff,transparent:true,opacity:0.9,depthWrite:false}));
      mg.position.set(mpx,0.17,mpz);mg.raycast=function(){};heroFxPush(mg,0.7);
      var mring=new THREE.Mesh(new THREE.RingGeometry(0.9,1.0,36),
        new THREE.MeshBasicMaterial({color:0x35e0ff,transparent:true,opacity:0.8,side:THREE.DoubleSide,depthWrite:false}));
      mring.rotation.x=-Math.PI/2;mring.position.set(mpx,0.06,mpz);
      mring.raycast=function(){};heroFxPush(mring,0.6);mring.userData={r0:0.4,r1:14};
      return;
    }
    if(s===1){                                   // 别人丢了闪光弹：在他（或消息带的坐标）处爆一团白光
      var fpx=(typeof x==='number')?x:e.root.position.x,fpz=(typeof z==='number')?z:e.root.position.z;
      var fb=new THREE.Mesh(new THREE.SphereGeometry(0.55,12,8),
        new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.9,depthWrite:false}));
      fb.position.set(fpx,0.9,fpz);fb.raycast=function(){};heroFxPush(fb,0.4);
      var fring=new THREE.Mesh(new THREE.RingGeometry(0.9,1.0,36),
        new THREE.MeshBasicMaterial({color:0xfff6c0,transparent:true,opacity:0.85,side:THREE.DoubleSide,depthWrite:false}));
      fring.rotation.x=-Math.PI/2;fring.position.set(fpx,0.07,fpz);
      fring.raycast=function(){};heroFxPush(fring,0.5);fring.userData={r0:0.4,r1:8};
      return;
    }
    var mm=new THREE.Mesh(new THREE.RingGeometry(0.9,1.0,40),
      new THREE.MeshBasicMaterial({color:0xff4d5e,transparent:true,opacity:0.85,side:THREE.DoubleSide,depthWrite:false}));
    mm.rotation.x=-Math.PI/2;
    mm.position.set(e.root.position.x,0.06,e.root.position.z);
    mm.raycast=function(){};heroFxPush(mm,0.8);mm.userData={r0:0.6,r1:26};
    return;
  }
  if(kind==='rusher'){
    if(s===2){
      var sw=new THREE.Mesh(new THREE.RingGeometry(0.9,1.0,44),
        new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.85,side:THREE.DoubleSide,depthWrite:false}));
      sw.rotation.x=-Math.PI/2;sw.position.set(e.root.position.x,0.08,e.root.position.z);
      sw.raycast=function(){};heroFxPush(sw,0.6);sw.userData={r0:0.4,r1:6.5};
      return;
    }
    var gm=new THREE.Mesh(new THREE.PlaneGeometry(0.7,1.7),
      new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.3,side:THREE.DoubleSide,depthWrite:false}));
    gm.position.set(e.root.position.x,e.root.position.y+0.85,e.root.position.z);
    gm.rotation.y=e.yawPivot?(e.yawPivot.rotation.y+Math.PI):0;
    gm.raycast=function(){};heroFxPush(gm,0.35);
    return;
  }
  /* 【batch120】蚀日者 N「日之眼」 */
  if(kind==='eclipse'&&s===2){
    var eg=heroMeshSunEye();
    eg.position.set(e.root.position.x,e.root.position.y+2.7,e.root.position.z);
    scene.add(eg);
    var er=new THREE.Mesh(new THREE.RingGeometry(0.9,1.0,64),
      new THREE.MeshBasicMaterial({color:0xffd75e,transparent:true,opacity:0.8,side:THREE.DoubleSide,depthWrite:false}));
    er.rotation.x=-Math.PI/2;er.position.set(e.root.position.x,0.07,e.root.position.z);
    er.raycast=function(){};heroFxPush(er,0.9);er.userData={r0:0.6,r1:SUNEYE_R};
    setTimeout(function(){try{scene.remove(eg);}catch(err){}},SUNEYE_LIFE*1000);
    return;
  }
  /* 【batch120】闪电 N「球形闪电」：别人放的时候，本地也飞三枚出去（命中由服务端结算） */
  if(kind==='lightning'&&s===2){
    var sy2=Math.sin(yaw),cy2=Math.cos(yaw);
    for(var bi=0;bi<BALL_N;bi++){
      var bm=heroMeshBall();scene.add(bm);
      var ang2=(bi-(BALL_N-1)/2)*0.55;
      var bx2=e.root.position.x+Math.cos(yaw)*ang2,by2=e.root.position.y+1.2,bz2=e.root.position.z-Math.sin(yaw)*ang2;
      bm.position.set(bx2,by2,bz2);
      SK.balls.push({x:bx2,y:by2,z:bz2,e:null,mesh:bm,life:BALL_LIFE*0.6});
    }
    return;
  }
}
/* 别人被「震荡打击」命中的橙色环（联机） */
function heroRemoteHit(e){
  if(!e||!e.root)return;
  var sw=new THREE.Mesh(new THREE.RingGeometry(0.9,1.0,40),
    new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.9,side:THREE.DoubleSide,depthWrite:false}));
  sw.rotation.x=-Math.PI/2;sw.position.set(e.root.position.x,0.09,e.root.position.z);
  sw.raycast=function(){};heroFxPush(sw,0.5);sw.userData={r0:0.3,r1:3};
}

/* ---------------- 技能键（电脑端）：独立监听，不去动那个超长的 keydown 处理器 ---------------- */
document.addEventListener('keydown',function(e){
  if(e.repeat)return;
  if(typeof keyCaptureAction!=='undefined'&&keyCaptureAction)return;   // 正在改键
  var idx=-1;
  if(e.code===KEYMAP.skill)idx=0;
  else if(e.code===KEYMAP.skill2)idx=1;
  else if(e.code===KEYMAP.skill3)idx=2;
  if(idx<0)return;
  if(!S.playing||S.over||S.paused)return;
  e.preventDefault();
  heroCast(idx);
},true);   // 【修复】捕获阶段：即使输入焦点停在名字框等元素上，技能键也必触发
// ⭐ B 键：开关「武器选择界面」（游戏内，点开始/多人后生效）。仅在未改键时响应。
document.addEventListener('keydown',function(e){
  if(e.repeat)return;
  if(typeof keyCaptureAction!=='undefined'&&keyCaptureAction)return;   // 正在改键
  if(e.code!=='KeyB')return;
  if(!S.playing||S.over)return;
  e.preventDefault();
  // 只做「切换」：界面已开→关；没开且当前没有任何浮层（暂停菜单等）→开。
  // 主 keydown 里已不含 KeyB 分支，这里单点处理，避免一次按键被触发两次互相抵消。
  if(weaponSelectOpen())closeWeaponSelect();
  else if(!overlayOpen())showWeaponSelect();
},true);   // 【修复】捕获阶段：即使输入焦点停在名字框等元素上，B 也必触发（免疫输入框 stopPropagation）
heroBuildHud();
heroLoad();
mapLoad();buildHeroGrid();buildMapGrid();
heroHudUpdate(true);
