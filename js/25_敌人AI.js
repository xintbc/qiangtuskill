// ==================== ENEMY AI ====================
var _dir=new THREE.Vector3(),_sep=new THREE.Vector3(),_avoid=new THREE.Vector3(),_steer=new THREE.Vector3(),_tangent=new THREE.Vector3();
var FOV_HALF = 117*Math.PI/360;
function pickPatrolTarget(e){
  var cx=e.root.position.x, cz=e.root.position.z;
  for(var t=0;t<50;t++){
    /* 【batch262b】巡逻点改成"自己周围 24~70 米"、并且**看高差和坡度**：
       原来取全图随机点 —— 在赛车场会抽到 150 米外的边界山上，
       小兵就一路往陡坡上爬，看着像"巡逻完全不看地形"（用户的原话）。
       现在只挑缓坡、高差 6 米以内的点，巡逻路线才会顺着地势走。 */
    var 角=Math.random()*6.283, 距离=24+Math.random()*46;
    var x=cx+Math.cos(角)*距离, z=cz+Math.sin(角)*距离;
    var 限=worldLimit()*0.95;
    x=Math.max(-限,Math.min(限,x)); z=Math.max(-限,Math.min(限,z));
    if(isColliding(x,z,e.sz*0.6))continue;
    var h0=groundHeightAt(x,z,GROUND_Y+2);
    if(Math.abs(h0-(e.root.position.y+GROUND_Y))>6)continue;
    var 坡=Math.abs(groundHeightAt(x+1.2,z,GROUND_Y+2)-h0)/1.2;
    if(坡>0.55)continue;
    e.patrolTarget={x:x,z:z};
    return;
  }
  e.patrolTarget=null;
}
/* 【batch258】"看得见这个点吗"：和 canSeePlayer 同一条视线判定（视野角 + 烟 + 遮挡），
   只是不看"玩家隐身"那一套 —— 小兵不会隐身。敌兵打己方小兵要用它来判断有没有看见。 */
function 看得见点(e,x,z,y){
  var dx=x-e.root.position.x, dz=z-e.root.position.z, d=Math.sqrt(dx*dx+dz*dz);
  if(d>VIEW_RANGE)return false;
  if(d>0.001){
    var fwdX=-Math.sin(e.yawPivot.rotation.y), fwdZ=-Math.cos(e.yawPivot.rotation.y);
    if((fwdX*dx+fwdZ*dz)/d < FOV_HALF_COS)return false;
  }
  if(smokeBlocks2D(e.root.position.x,e.root.position.z,x,z))return false;
  return hasLineOfSight2D(e.root.position.x,e.root.position.z,x,z,y);
}
function canSeePlayer(e,cp){
  var dx=cp.x-e.root.position.x, dz=cp.z-e.root.position.z;
  var dist=Math.sqrt(dx*dx+dz*dz);
  if(dist>VIEW_RANGE) return false;
  var fwdX=-Math.sin(e.yawPivot.rotation.y), fwdZ=-Math.cos(e.yawPivot.rotation.y);
  var invd=dist>0.001?1/dist:0;
  var dot=fwdX*(dx*invd)+fwdZ*(dz*invd);
  if(dot < FOV_HALF_COS) return false;
  if(smokeBlocks2D(e.root.position.x,e.root.position.z,cp.x,cp.z))return false;   // 隔着烟 → 看不见你
  if(SK.cloak>0)return false;                                    // 【batch171】SP·暗哨光学隐身：AI 直接瞎
  return hasLineOfSight2D(e.root.position.x,e.root.position.z,cp.x,cp.z,cp.y);
}
function updateEnemies(){
  if(S.paused)return;
  var now=performance.now(),cp=camera.position,n=enemies.length;
  var _pGhost=(typeof SK!=='undefined'&&SK&&(SK.ghost>0||SK.shadowT>0));   // 【batch151/158】虚化或遁入暗影中：敌人看不见、听不见、也锁不住你
  var _pbid=(typeof navBuildingAt==='function')?navBuildingAt(curMapId,cp.x,cp.z):-1;   // 【batch131】玩家在不在楼里
  for(var ei=0;ei<n;ei++){
    var e=enemies[ei];if(e.isNet){netUpdateRemote(e);continue;}if(e.rangeDummy)continue;if(e.hp<=0)continue;
    /* 【batch244】noAI＝不归通用 AI 管（天上的直升机 / 剧情大将军都由自己的分片驱动）。
       必须放在这里：否则直升机会被当成普通兵去"追玩家 + 开枪"，大将军也会被抢去走位。 */
    if(e.noAI)continue;   /* 【batch180】靶场假人：不参与 AI（不动、不瞄、不开火） */
    /* 【batch184b】剧情 Boss 在「演出中」（开场 / 登场 / 结局字幕）不能被通用 AI 驱动 ——
       否则它会在自己的登场字幕期间就朝被锁住输入的玩家移动 + 开火，玩家毫无还手之力
       （用户报"剧情还没过完 BOSS 就出现了、根本打不了"）。演出期间冻结它的通用 AI，
       等 duel 阶段（cut=false）再恢复「通用 AI 移动 + storyBossAI 技能」的正常战斗。 */
    if(typeof STORY_!=='undefined'&&STORY_.on&&STORY_.cut&&e===STORY_.boss)continue;
    if(_pGhost)e.lastSeen=null;   // 【batch151】虚化中：让敌人失去你的踪迹（不再追、不再瞄）
    var dx=cp.x-e.root.position.x,dz=cp.z-e.root.position.z,dist=Math.sqrt(dx*dx+dz*dz);
    if(e.scanCd===undefined){e.scanCd=2000+Math.random()*3500;e.scanning=false;e.scanT=0;e.scanBase=0;e.scanDir=1;}
    if(e.lastSeen===undefined){e.lastSeen=null;}
    /* 【batch172】SP·暗哨光学隐身：**看不见也听不见**（和虚化同口径）。
       之前只在 canSeePlayer 里挡了"看见"，被下面 heard 的"8 米内听见你"绕过 →
       贴脸隐身 AI 照样锁敌开火（用户报"隐身了 AI 还是能看到我"）。 */
    var _pStealth=(typeof SK!=='undefined'&&SK.cloak>0);
    var heard=(dist<8)&&!_pGhost&&!_pStealth;
    var seen=(_pGhost||_pStealth)?false:(canSeePlayer(e,cp)||heard);   // 隐身中：不锁敌 / 不开火 / 不锤人
    /* 【batch258】目标不再只有玩家 —— 这就是"敌方小兵不还手"的根：
       下面的所有判定（dx/dz/dist/瞄准/开火/近战）全都是围着 camera.position 转的，
       己方小兵（石棺 / 分身吐出来的兵）压根不在候选里，所以被围着砍也不还手。
       现在：看得见玩家 → 仍然打玩家（老手感一个字不改）；
             看不见玩家、但看得见小兵 → 打小兵，谁近打谁。
       ⚠️ 只把 `友军` / `minionGhost` 当目标（都是"小兵"），联机玩家那条路由原来就在处理。 */
    var _tg={x:cp.x,y:cp.y,z:cp.z}, _tEnt=null;
    if(!seen && !e.友军){
      var _最=VIEW_RANGE*VIEW_RANGE;
      for(var _mi=0;_mi<enemies.length;_mi++){
        var _mo=enemies[_mi];
        if(!_mo||_mo===e||_mo.helix)continue;
        if(!(_mo.友军||_mo.minionGhost))continue;
        if(_mo.minionGhost&&_mo.友军)continue;          /* 自己队伍的幽灵兵：那是友军，不打 */
        if(_mo.hp<=0)continue;
        var _mr=_mo.root&&_mo.root.position; if(!_mr)continue;
        var _mdx=_mr.x-e.root.position.x,_mdz=_mr.z-e.root.position.z,_md2=_mdx*_mdx+_mdz*_mdz;
        if(_md2>_最)continue;
        if(!看得见点(e,_mr.x,_mr.z,_mr.y+1.0))continue;
        _最=_md2; _tEnt=_mo; _tg={x:_mr.x,y:_mr.y+(_mo.sz||1)*0.95,z:_mr.z};
      }
      if(_tEnt){ seen=true; dx=_tg.x-e.root.position.x; dz=_tg.z-e.root.position.z; dist=Math.sqrt(dx*dx+dz*dz); }
    }
    /* 【batch131】门口导航：玩家在屋里、我在屋外、又看不见他 → 先把"门口"当成他最后出现的位置。
       不这么干的话，AI 进入 chase 后会朝玩家直线冲，一路撞在外墙上（用户报的"进不了房子"）。 */
    /* 【batch132】只要「玩家在楼里、我在楼外」就朝门口走 —— **不管看不看得见**。
       原来加了 `seen&&`（要求"看得见玩家"），可玩家一躲进屋角就看不见了 → AI 直接回到巡逻，
       永远等不到"看见"那一刻（诊断实测：400 帧后还在 12 米外乱逛）。 */
    e._doorNav=false;
    if(!_pGhost && _pbid>=0 && navBuildingAt(curMapId,e.root.position.x,e.root.position.z)!==_pbid){
      var _dr=navNearestDoor(curMapId,_pbid,e.root.position.x,e.root.position.z);
      /* 【batch132】不再要求"看不见玩家" —— 只要玩家在楼里、我在屋外，就一路按门口导航走。
         原来一旦 AI 挪到门口、视线从门洞透过看见玩家，就会切成 chase 直冲玩家（玩家在屋角时
         那条直线正好撞在内墙上）→ 卡死在门外 1 米。走完"门内侧"这一点后自然进屋、自动恢复。 */
      if(_dr){
        e.lastSeen={x:(_dr.ix!==undefined?_dr.ix:_dr.x),z:(_dr.iz!==undefined?_dr.iz:_dr.z),t:now};   // 【batch132】目标取**门内侧**：一路走进屋里
        e.aiState='search';
        e._doorNav=true;                        // 【batch132】正在"过门"：
        seen=false;
      }
    }
    if(e.blindT>0){e.blindT-=0.03;seen=false;}      // 被闪光弹致盲：这 3 秒看不见也听不见玩家
    if(seen)e.lastSeen={x:_tg.x,z:_tg.z,t:now};
    // ---- 状态决策 ----
    if(seen){
      if(e.aiState==='patrol'||e.aiState==='search')e.aiState='chase';
      if(e.scanning)e.scanning=false;
    } else {
      if(e.aiState==='aiming'){ if(e.aimLine)e.aimLine.visible=false; e.aiState='search'; }
      else if(e.aiState==='chase'){ e.aiState='search'; }
      else if(e.aiState==='cooldown'){ e.aiState='search'; }
      else if(e.aiState==='search'){
        if(e.lastSeen){
          var reached=(Math.sqrt((e.root.position.x-e.lastSeen.x)*(e.root.position.x-e.lastSeen.x)+(e.root.position.z-e.lastSeen.z)*(e.root.position.z-e.lastSeen.z))<2);
          if(now-e.lastSeen.t>5000||reached){ e.aiState='patrol'; if(!e.patrolTarget)pickPatrolTarget(e); }
        } else { e.aiState='patrol'; if(!e.patrolTarget)pickPatrolTarget(e); }
      }
    }
    // ---- 朝向目标 ----
    var targetYaw;
    var doScan=false;
    if(e.aiState==='search'&&e.lastSeen){ targetYaw=Math.atan2(-(e.lastSeen.x-e.root.position.x),-(e.lastSeen.z-e.root.position.z)); }
    else if(seen){ targetYaw=Math.atan2(-dx,-dz); }
    else if(e.patrolTarget){ var pdx=e.patrolTarget.x-e.root.position.x, pdz=e.patrolTarget.z-e.root.position.z; targetYaw=Math.atan2(-pdx,-pdz); }
    else { targetYaw=e.yawPivot.rotation.y; }
    // 巡逻/搜索时偶尔扫视周围（背后的玩家也会被察觉）
    if(!seen && (e.aiState==='patrol'||e.aiState==='search')){
      e.scanCd-=16;
      if(!e.scanning && e.scanCd<=0){ e.scanning=true; e.scanT=0; e.scanBase=e.yawPivot.rotation.y; e.scanDir=(Math.random()<0.5?-1:1); }
      if(e.scanning){ e.scanT+=16; var dur=1400; if(e.scanT>=dur){ e.scanning=false; e.scanCd=2500+Math.random()*3500; } else { var sp=e.scanT/dur; targetYaw=e.scanBase+e.scanDir*Math.sin(sp*Math.PI)*1.1; doScan=true; } }
    }
    var curY=e.yawPivot.rotation.y, dy=targetYaw-curY; while(dy>Math.PI)dy-=2*Math.PI; while(dy<-Math.PI)dy+=2*Math.PI; e.yawPivot.rotation.y=curY+dy*0.12;
    // ---- 腿部动画 ----
    var isMovingE=(e.aiState==='chase'||e.aiState==='cooldown'||e.aiState==='patrol'||e.aiState==='search');
    if(e.leftLeg&&e.rightLeg){ if(isMovingE&&!doScan){ e.phase+=e.spd*4*(e.aiState==='patrol'?0.6:1); var legSwing=Math.sin(e.phase)*0.3; e.leftLeg.rotation.x=legSwing; e.rightLeg.rotation.x=-legSwing; } else { e.leftLeg.rotation.x*=0.9; e.rightLeg.rotation.x*=0.9; } }
    if(e.weaponRig){ var targetPitch=0; if(e.aiState==='aiming'){ var aimDist=dist; var aimUp=_tg.y-(e.root.position.y+e.sz*0.9); var ap=Math.atan2(aimUp,Math.max(1,aimDist)); targetPitch=Math.max(-0.4,Math.min(0.6,ap)); } else if(e.aiState==='cooldown'){ targetPitch=-0.05; } else { targetPitch=0.15; } if(e._wp===undefined)e._wp=e.weaponRig.rotation.x; e._wp+=(targetPitch-e._wp)*0.1; e.rec=Math.max(0,(e.rec||0)-0.016*RECOIL_DECAY); e.weaponRig.rotation.x=e._wp-e.rec*RECOIL_KICK; if(e._wpBack===undefined)e._wpBack=e.weaponRig.position.z; e.weaponRig.position.z=e._wpBack+e.rec*RECOIL_BACK; }
    // ---- 移动意图 ----
    var desiredDirX=0,desiredDirZ=0,moveSpd=e.spd;
    if(e.slowT>0){e.slowT-=0.03;moveSpd*=0.5;}   // 被英雄技能（震荡打击）减速
    if(!e.isNet&&e.burnT>0){
      e.burnT-=0.03;e.hp-=SOLAR_BURN;
      if(Math.random()<0.25)spawnParticle(e.root.position.clone().setY(1.2),0xff8a3a,3);
      /* 【batch156】灼烧致死**必须走正常击杀**（killEnemy＝模型移除 + 记分/波次记数 + splice）——
         原来只扣血不击杀，小兵卡在场上：模型不消失、打不着、S.left 不减 → 波次永远结束不了。
         ei--/n--：killEnemy 内部会 splice，回退索引避免这一帧漏处理/越界。 */
      if(e.hp<=0){killEnemy(e,ei,false);ei--;n--;continue;}
    }
    if(e.zapT>0){e.zapT-=0.03;moveSpd*=ORB_ZAP_SLOW;}   // 【batch120】闪电「麻痹」：再慢 40%
    if(e.overloadT>0)e.overloadT-=0.03;                 // 【batch120】闪电「过载」：无法开火（见下面的开火判定）
    if(e.downedLife>0)moveSpd=0;                        // 【batch130】倒地＝**一步都走不了**（原来还留了 0.25 倍爬行）

    var STOP=(e.sz*0.5+0.5);
    if(e.canShoot&&!(e.overloadT>0)&&!(e.downedLife>0)){   // 【batch120】过载 / 倒地 → 开不了火
      /* 【batch258】打小兵时**不套「最小射程」**：那是为了防止枪兵贴着玩家脸还硬射，
       小兵会自己压到 3 米内，枪兵于是永远在后退、永远不开枪 → 看着就是不还手。
       开枪本身不受影响（子弹能不能打到由命中判定管）。 */
      var inRange=dist<=e.shootRange,tooClose=(!_tEnt)&&(dist<e.minRange),hasLOS=hasLineOfSight2D(e.root.position.x,e.root.position.z,_tg.x,_tg.z,_tg.y)&&!smokeBlocks2D(e.root.position.x,e.root.position.z,_tg.x,_tg.z);
      if(seen){
        if(e.aiState==='chase'){ if(inRange&&!tooClose&&hasLOS){ e.aiState='aiming'; e.aimStartTime=now; if(e.aimLine){e.aimLine.visible=true;e.aimLine.material.opacity=0.2;} } }
        else if(e.aiState==='aiming'){
          if(e.aimLine){ var gunWorldPos=new THREE.Vector3(0,e.sz*0.9,-e.sz*0.5); gunWorldPos.applyMatrix4(e.g.matrixWorld); var pos=e.aimLine.geometry.attributes.position.array; pos[0]=gunWorldPos.x; pos[1]=gunWorldPos.y; pos[2]=gunWorldPos.z; pos[3]=_tg.x; pos[4]=_tg.y; pos[5]=_tg.z; e.aimLine.geometry.attributes.position.needsUpdate=true; var progress=Math.min(1,(now-e.aimStartTime)/e.aimTime); e.aimLine.material.opacity=0.2+progress*0.6; }
          if(!inRange||tooClose||!hasLOS){ e.aiState='chase'; if(e.aimLine)e.aimLine.visible=false; }
          else if(now-e.aimStartTime>=e.aimTime){ var origin=e.root.position.clone(); origin.y+=e.sz*0.9; _dir.set(dx, _tg.y-origin.y, dz); var dLen=_dir.length(); if(dLen>0.001)_dir.divideScalar(dLen); else _dir.set(0,0,1); origin.add(_dir.clone().multiplyScalar(e.sz*0.5)); for(var b=0;b<e.bulletCount;b++){ var bDir=_dir.clone(); bDir.x+=(Math.random()-0.5)*e.spread; bDir.y+=(Math.random()-0.5)*e.spread; bDir.z+=(Math.random()-0.5)*e.spread; var bLen=bDir.length(); if(bLen>0.001)bDir.divideScalar(bLen); else bDir.set(0,0,1); spawnEnemyBullet(origin,bDir,e.bulletSpd,e.dmg,e); } playEnemyShot(e.root.position); netMuzzleFlash(origin.x,origin.y,origin.z,0xff8a3d); e.rec=Math.min(1,(e.rec||0)+0.85); e.lastShot=now; e.aiState='cooldown'; if(e.aimLine)e.aimLine.visible=false; }
        }
        else if(e.aiState==='cooldown'){ if(now-e.lastShot>e.shootCD)e.aiState='chase'; }
        desiredDirX=dx; desiredDirZ=dz;
        if(e.aiState==='aiming')moveSpd=0; else if(e.aiState==='cooldown')moveSpd*=0.4; else if(tooClose){ desiredDirX=-dx; desiredDirZ=-dz; moveSpd*=0.8; } else if(dist<e.shootRange*0.7){ desiredDirX=-dz; desiredDirZ=dx; moveSpd*=0.6; }
      } else {
        if(e.aiState==='search'&&e.lastSeen){ desiredDirX=e.lastSeen.x-e.root.position.x; desiredDirZ=e.lastSeen.z-e.root.position.z; var sd2=Math.sqrt(desiredDirX*desiredDirX+desiredDirZ*desiredDirZ); if(sd2>0.5){desiredDirX/=sd2;desiredDirZ/=sd2;} moveSpd=e.spd*0.7; }
        else { if(!e.patrolTarget)pickPatrolTarget(e); if(e.patrolTarget){ desiredDirX=e.patrolTarget.x-e.root.position.x; desiredDirZ=e.patrolTarget.z-e.root.position.z; var pdd=Math.sqrt(desiredDirX*desiredDirX+desiredDirZ*desiredDirZ); if(pdd<1.5){ pickPatrolTarget(e); } else { desiredDirX/=pdd; desiredDirZ/=pdd; } } moveSpd=e.spd*0.5; }
      }
    } else {
      if(seen){
        if(!(e.downedLife>0)&&dist<=1.5 && Math.abs(_tg.y-(e.root.position.y+e.sz*0.9))<2.2){ if(now-e.lastAtk>e.cd){ e.lastAtk=now; if(_tEnt&&typeof 打小兵==='function')打小兵(_tEnt,e.dmg,true); else takeDmg(e.dmg); } }   // 【batch130】倒地的人不能锤人
        if(dist>STOP){ desiredDirX=dx; desiredDirZ=dz; } else { desiredDirX=0; desiredDirZ=0; }
        moveSpd=e.spd;
      } else {
        if(e.aiState==='search'&&e.lastSeen){ desiredDirX=e.lastSeen.x-e.root.position.x; desiredDirZ=e.lastSeen.z-e.root.position.z; var sdd=Math.sqrt(desiredDirX*desiredDirX+desiredDirZ*desiredDirZ); if(sdd>0.5){desiredDirX/=sdd;desiredDirZ/=sdd;} moveSpd=e.spd*0.7; }
        else { if(e.aiState!=='patrol'||!e.patrolTarget){ e.aiState='patrol'; if(!e.patrolTarget)pickPatrolTarget(e); } if(e.patrolTarget){ desiredDirX=e.patrolTarget.x-e.root.position.x; desiredDirZ=e.patrolTarget.z-e.root.position.z; var pdd2=Math.sqrt(desiredDirX*desiredDirX+desiredDirZ*desiredDirZ); if(pdd2<1.5){ pickPatrolTarget(e); } else { desiredDirX/=pdd2; desiredDirZ/=pdd2; } } moveSpd=e.spd*0.5; }
      }
    }
    // ---- 转向 + 避障(推开 + 绕墙切线) + 分离 + 应用 ----
    var ddLen=Math.sqrt(desiredDirX*desiredDirX+desiredDirZ*desiredDirZ);
    if(ddLen>0.001){ desiredDirX/=ddLen; desiredDirZ/=ddLen; } else { desiredDirX=0; desiredDirZ=0; }
    if(doScan)moveSpd=0;
    _steer.set(desiredDirX*moveSpd,0,desiredDirZ*moveSpd);
    _sep.set(0,0,0); var sc=0; for(var j=0;j<n;j++){ if(j===ei)continue; var o=enemies[j]; if(o.hp<=0)continue; var sx=e.root.position.x-o.root.position.x, sz=e.root.position.z-o.root.position.z, sd=sx*sx+sz*sz; if(sd<SEP_DIST*SEP_DIST&&sd>0.001){ var d=Math.sqrt(sd); _sep.x+=sx/d/d; _sep.z+=sz/d/d; sc++; } }
    if(sc>0&&!e._doorNav){ _sep.multiplyScalar(SEP_FORCE); _steer.add(_sep); }   // 【batch132】过门时不互相挤
    _avoid.set(0,0,0); _tangent.set(0,0,0);
    /* 【batch132】"正在穿门"且已经贴近门口（<3.5 米）时，**暂时不避墙**：
       门只有 3 米宽，两侧外墙的排斥力正好把 AI 夹在门口、一步也迈不进去
       （实测：1500 帧卡在门外 2 米）。目标点就是门正中，直接走过去即可，
       撞墙还有下面的 isColliding 兜底，不会穿墙。 */
    var _noWall=false;
    if(e._doorNav&&e.lastSeen){
      var _wx=e.lastSeen.x-e.root.position.x,_wz=e.lastSeen.z-e.root.position.z;
      _noWall=(_wx*_wx+_wz*_wz<12.25);
    }
    for(var oi=0;!_noWall&&oi<obstacles.length;oi++){ var obs=obstacles[oi];
      /* 【batch132】**头顶上的楼板 / 门楣（悬空方块）不参与水平避障** —— 它们底面就高于 AI 头顶，
         物理上根本碰不到，但原来的避障只看水平距离 → AI 一到门口就被门楣的排斥力顶回门外，
         怎么走都进不了屋（用户报的"小兵没办法进出房子"，实测 1500 帧卡在门外 3.6 米）。 */
      if(obs.slab&&(obs.y0||0)>e.root.position.y+e.sz*1.15+0.15)continue;
      var cp2=closestOnAABB(e.root.position.x,e.root.position.z,obs); var ax=e.root.position.x-cp2.x, az=e.root.position.z-cp2.z, ad=ax*ax+az*az; if(ad<WALL_DIST*WALL_DIST&&ad>0.001){ var d2=Math.sqrt(ad); var str=1-d2/WALL_DIST; var nx=ax/d2, nz=az/d2; _avoid.x+=nx*str; _avoid.z+=nz*str; var tx=nz, tz=-nx; if(tx*desiredDirX+tz*desiredDirZ<0){tx=-tx;tz=-tz;} _tangent.x+=tx*str; _tangent.z+=tz*str; } }
    _avoid.multiplyScalar(WALL_FORCE); _tangent.multiplyScalar(WALL_TANGENT); _steer.add(_avoid); _steer.add(_tangent);
    if(_steer.lengthSq()>moveSpd*moveSpd&&moveSpd>0.0001)_steer.normalize().multiplyScalar(moveSpd);
    /* 【batch125】传给 isColliding 的 py ＝ 脚底 + GROUND_Y（和玩家同口径），
       并打开 stepUp —— 于是台阶/楼梯不再被当成墙，小兵能上楼梯、能跨进屋里。
       传 py 还有个好处：楼板（slab）只在"自己那一层"挡人，楼上楼下互不干扰。 */
    /* 【batch258】改口径：用**身体区间**（脚底 → 头顶）判墙，不再传眼高那个标量。
       旧写法 `isColliding(x,z,r,脚底+GROUND_Y,true)` 的问题：那一参是"眼高 2.0"，
       函数内部只拿它跟障碍顶面比高度 → `眼高 > 顶面` 就放行 →
       **所有不高于 2 米的墙对 AI 都是空气**，小兵（包括近战兵）一头走进去就卡在墙里。
       玩家那边是"脚底 + 台阶容差 0.55"，差 1.45 米，所以玩家看着明明是堵墙，敌人却穿过去了。 */
    var _feetY=e.root.position.y;
    var _headY=_feetY+Math.max(1.2,e.sz*1.45);
    var _ar=Math.max(0.34,e.sz*0.42);
    var _挡=function(x,z){
      if(typeof bodyBlockedAt==='function')return bodyBlockedAt(x,z,_ar,_feetY,_headY);
      return isColliding(x,z,e.sz*.4,_feetY+GROUND_Y,true);
    };
    var newX=e.root.position.x+_steer.x, newZ=e.root.position.z+_steer.z;
    if(!_挡(newX,newZ)){ e.root.position.x=newX; e.root.position.z=newZ; }
    else if(!_挡(newX,e.root.position.z)){ e.root.position.x=newX; }
    else if(!_挡(e.root.position.x,newZ)){ e.root.position.z=newZ; }
    /* 【batch258】万一已经嵌在实体里（刷怪点落在墙里、被技能推进去、别的兵把它挤进去），
       沿水平最短方向慢慢推出来 —— 旧版没有这一步，嵌进去就等于永远卡死在那儿。 */
    if(typeof pushBodyOut==='function'){
      var _救=pushBodyOut(e.root.position.x,e.root.position.z,_ar,_feetY,_headY);
      if(_救){ e.root.position.x=_救.x; e.root.position.z=_救.z; }
    }
    /* 【batch125】脚底跟着地形走：原来 position.y 永远不变（一直是出生时的 0），
       所以就算判定放行，人也是"贴着地面穿过台阶/楼板"的。现在每帧按脚下的可站面抬一次，
       上楼、上台阶、下台阶都会自动跟着走。 */
    /* 【batch262b】脚底跟地形：大落差直接贴（跳下/被推下去），小起伏平滑跟随 ——
       原来是一帧直接赋值，走缓坡时每帧抬 0.2 米，看着像"一格一格往上跳"。 */
    var _地=groundHeightAt(e.root.position.x,e.root.position.z,e.root.position.y+GROUND_Y)-GROUND_Y;
    var _dy=_地-e.root.position.y;
    if(Math.abs(_dy)>1.5)e.root.position.y=_地;
    else e.root.position.y+=_dy*0.3;
    e.root.position.x=Math.max(-worldLimit(),Math.min(worldLimit(),e.root.position.x));
    e.root.position.z=Math.max(-worldLimit(),Math.min(worldLimit(),e.root.position.z));
    e.hb.lookAt(_tg);
    if(e.flash>0)e.flash-=0.03;
  }
}