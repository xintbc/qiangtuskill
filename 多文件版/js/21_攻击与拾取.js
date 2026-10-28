// ==================== ATTACK ====================
var raycaster=new THREE.Raycaster(),screenCenter=new THREE.Vector2(0,0);
var obstacleBoxes=[];// 围栏的包围盒从 y0 开始（不是从地面）：刀/枪的射线只在栏杆那一层挡，
// 站在地面上朝塔的方向开枪不会被「看不见的栏杆」吃掉。
function buildObstacleBoxes(){obstacleBoxes=[];for(var oi=0;oi<obstacles.length;oi++){var o=obstacles[oi];var yb=(o.rail||o.slab)?o.y0:((typeof o.y0==='number')?o.y0:0);var yt=(typeof o.y1==='number')?o.y1:(o.h||0);obstacleBoxes.push(new THREE.Box3(new THREE.Vector3(o.minX,yb,o.minZ),new THREE.Vector3(o.maxX,yt,o.maxZ)));}}  // 【batch178】墙的碰撞盒尊重 y0/y1
/* 【batch187】射线 vs 掩体墙（定向板），返回 {z,dist,point} 或 null。
   为什么要单独写：obstacleBoxes 里存的是墙「旋转后的外包 AABB」，斜着放的墙，AABB 会盖住
   墙两侧一大片空气。射线打在 AABB 近面上的点根本不在墙上 → spWallHitAt 用它做
   spWallContains 判定必然失败 → **斜墙永远打不碎**。
   这里直接对定向板（长 hw、厚 hth）做 slab 求交，拿到真正落在墙面上的点。
   ★ 就地定义在 21 分片：打墙是核心路径，绝不能跨分片引用（旧缓存会 ReferenceError）。 */
function spWallRayHit(ox,oy,oz,dx,dy,dz,maxD){
  var best=null;
  var lists=[(typeof SP_ZONES!=='undefined'&&SP_ZONES)?SP_ZONES:[],(window.__remoteWalls||[])];
  for(var li=0;li<lists.length;li++){
    var L=lists[li]||[];
    for(var i=0;i<L.length;i++){
      var z=L[i];if(!z||!z.box)continue;
      if(li===0&&z.kind!=='wall')continue;
      var b=z.box;
      var cx=b.cx,cz=b.cz,ang=b.ang||0,hw=b.hw,hth=b.hth;
      if(typeof cx!=='number'||typeof cz!=='number'||typeof hw!=='number')continue;
      var y0=(typeof b.y0==='number')?b.y0:0,y1=(typeof b.y1==='number')?b.y1:y0+2.7;
      var c=Math.cos(ang),s=Math.sin(ang);
      var px=ox-cx,pz=oz-cz;
      var lx=px*c-pz*s,lz=px*s+pz*c,ly=oy-y0;          // 世界→墙的本地坐标（与 spWallContains 同式）
      var ldx=dx*c-dz*s,ldz=dx*s+dz*c,ldy=dy;
      var t0=0,t1=maxD,ok=true,k,p,d,lo,hi,ta,tb,tm;
      for(k=0;k<3&&ok;k++){
        if(k===0){p=lx;d=ldx;lo=-hw;hi=hw;}
        else if(k===1){p=ly;d=ldy;lo=0;hi=y1-y0;}
        else{p=lz;d=ldz;lo=-hth;hi=hth;}
        if(d>-1e-8&&d<1e-8){ if(p<lo||p>hi)ok=false; }
        else{ ta=(lo-p)/d;tb=(hi-p)/d;if(ta>tb){tm=ta;ta=tb;tb=tm;} if(ta>t0)t0=ta;if(tb<t1)t1=tb;if(t0>t1)ok=false; }
      }
      if(!ok||t0<=0.01||t0>maxD)continue;
      if(!best||t0<best.dist)best={z:z,dist:t0,point:new THREE.Vector3(ox+dx*t0,oy+dy*t0,oz+dz*t0)};
    }
  }
  return best;
}
/* 【batch169】友伤判定**就地定义**：attack() 在 21 分片，绝不能依赖 30 分片的 netIsFriendly ——
   跨分片一旦有一边是浏览器旧缓存，这里就会 ReferenceError，刀和枪直接全部失效。
   放在同一个分片里，永远可用；再套 try/catch，出错也只当"不是队友"，不会打断攻击。 */
function _ffMyTeam(){try{if(typeof SPIKE!=='undefined'&&SPIKE.on&&typeof SPIKE.team==='number'&&SPIKE.team>=0)return SPIKE.team;}catch(e){}return -1;}
function _ffSkip(e){try{return !!(e&&e.isNet&&(typeof e.team==='number'&&e.team>=0)&&e.team===_ffMyTeam());}catch(err){return false;}}
function attack(){if(!canAct())return;var now=performance.now();
  /* 【batch203】开火立刻打断检视（TACZ 也是这个手感：扣扳机就收枪） */
  try{ if(typeof 检视!=='undefined'&&检视&&检视.on&&typeof 结束检视==='function')结束检视(); }catch(_eA){}
  if(SK.cloak>0){SK.cloak=0;SK._breakAt=performance.now();if(typeof spCloakSync==='function')spCloakSync();if(typeof showMsg==='function')showMsg('破隐！','#ffd166');}   /* 【batch171】SP·暗哨：开枪破隐 */if(currentWeapon===WEAPON_KNIFE){if(knifeSwinging||now-lastKnifeAttack<knifeCD())return;knifeSwinging=true;knifeSwingTime=now;lastKnifeAttack=now;raycaster.setFromCamera(screenCenter,camera);var obsDist=Infinity,obsPoint=null;var _obsPair=(obstacleBoxes.length===obstacles.length);for(var oi=0;oi<obstacleBoxes.length;oi++){if(_obsPair&&obstacles[oi]&&obstacles[oi].spWall)continue;var op=new THREE.Vector3();if(raycaster.ray.intersectBox(obstacleBoxes[oi],op)!==null){var od=op.distanceTo(camera.position);if(od<obsDist){obsDist=od;obsPoint=op;}}}
/* 【batch187】掩体墙跳过上面的 AABB 粗筛（那个框对斜墙会盖住空气），改用定向射线拿真实交点 */if(typeof spWallRayHit==='function'){var _rd=raycaster.ray.direction;var _wh=spWallRayHit(camera.position.x,camera.position.y,camera.position.z,_rd.x,_rd.y,_rd.z,90);if(_wh&&_wh.dist<obsDist){obsDist=_wh.dist;obsPoint=_wh.point;}}raycaster.far=knifeRange();var hitEnemy=false;for(var i=enemies.length-1;i>=0;i--){var e=enemies[i];if(e.hp<=0)continue;var hits=raycaster.intersectObjects(e.g.children,true);if(hits.length&&hits[0].distance<=knifeRange()&&(hits[0].distance<obsDist)){var hs=(hits[0].object===e.head);var dmg=(hs?knifeDmg()*2:knifeDmg())*S.damageMul;
              if(SK.sp&&SK.spMarkT>0&&SK.spMarkIds&&SK.spMarkIds[e.__oid__])dmg=Math.round(dmg*1.30);   /* 【batch172】猎杀标记易伤+30% */
              if(SK.sp&&SK._breakAt&&now-SK._breakAt<1000){dmg=Math.round(dmg*1.30);SK._breakAt=0;}   /* 【batch173】暗哨被动：破隐后 1 秒内首刀 +30% */
              if(e.isNet){if(_ffSkip(e)){hitEnemy=true;break;}netHitRemote(e,hs,dmg,hits[0].point,true);hitEnemy=true;break;}   /* 【batch172】第 5 参＝近战：被过载时刀照样能砍 */e.hp-=dmg;e.flash=0.2;spawnParticle(hits[0].point,hs?0xffff00:0xff4444,hs?10:6);var r=Math.max(0,e.hp/e.maxHp);e.hb.scale.x=r;e.hbMat.color.setHex(r>.5?0x00ff00:r>.25?0xffff00:0xff0000);if(hs)showMsg('🔪 爆头!','#fc0');if(e.aiState==='aiming'){e.aiState='chase';if(e.aimLine)e.aimLine.visible=false;}if(e.hp<=0)killEnemy(e,i,hs);hitEnemy=true;break;}}raycaster.far=Infinity;if(!hitEnemy){if(obsPoint&&typeof spWallHitAt==='function')spWallHitAt(obsPoint,knifeDmg()*S.damageMul,false);   /* 【batch187】刀也能砍墙（原来近战分支压根没调打墙，拿刀砍墙毫无反应） */spawnParticle(camera.position.clone().add(new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion)),0xaaaaaa,3,0.1);}}else{if(S.auto===false){if(!freshTrigger)return;freshTrigger=false;}if(S.reloading||S.ammo<=0||now-S.lastShot<((SK.sp&&SK.adren>0)?Math.round(S.fireRate*0.667):S.fireRate))return;   /* 【batch173】肾上腺素：射速 +50%（间隔 ×0.667） */
  /* 【batch172】被蜂鸟无人机过载：这段时间开不了枪（近战不受影响——刀的分支在上面已经走完） */
  if(typeof NET!=='undefined'&&NET&&NET.overloadUntil&&now<NET.overloadUntil){
    if(!NET._ovlMsgAt||now-NET._ovlMsgAt>1500){NET._ovlMsgAt=now;try{showMsg('⚡ 过载中：只能用刀','#9bd4ff');}catch(_){}}
    return;
  }if(!(typeof rangeMode==='function'&&rangeMode()))S.ammo--;S.lastShot=now;   /* 【batch180】靶场：弹药不减（相当于无限弹） */
  /* 【batch203】抛壳：只有带抛壳窗的纪念枪抛（其它枪的模型没有那个开口，抛出来就是凭空冒壳）。
     每发都抛，靠 js/24 的对象池封顶（同时最多 12 个）。靶场里也抛 —— 那是纯视觉，不影响弹药。 */
  try{ var _gdK=activeGunDef(); if(_gdK&&_gdK.memorial&&typeof 抛壳==='function')抛壳(); }catch(_eK){}
  /* 【batch206】枪机往复：抛壳窗里那根栓后退一下再复进，一枪一次（只有带 animPart='bolt' 的枪有）*/
  try{ if(typeof _枪机击发==='function')_枪机击发(now); }catch(_eB){}
  netShotSeq++;updateAmmo();playShot();S.recoilKick=0.08*S.recoilMul;S.recoilRot=0.15*S.recoilMul;/* 【batch184f】半自动(狙击/手枪)每发视角后坐冲量：原只有枪身抖且开镜归零→没后坐力；现每发给视角一跳(开镜减弱到60%不归零)。全自动走原"持续上抬"，不再叠这层。基值0.032(用户嫌跳太高/回正太快→由原0.05下调)+按recoilMul缩放 */if(S.auto===false)S.recoilPunch=(S.recoilPunch||0)+0.032*S.recoilMul*(1-S.aimProgress*0.4);muzzleLight.intensity=3;setTimeout(function(){muzzleLight.intensity=0;},40);raycaster.setFromCamera(screenCenter,camera);var _range=(typeof S.range==='number')?S.range:80;var _pellets=(typeof S.pellets==='number')?S.pellets:1;var _spreadB=(typeof S.spread==='number')?S.spread:0;var _hip=0.020*S.hipSpreadMul;
/* 【开镜散布·完全由模组 def 控制，无需改主文件】读取当前枪 def 的 adsSpreadKeep（开镜保留的散射比例：0=开镜无散射）。
   若未显式设置而 def.type==='shotgun' 则默认保留 35%（散弹枪开镜仍有散射）；其它枪默认 0（开镜完全无散射）。
   模组作者只要给武器 def 写 type:'shotgun' 或 adsSpreadKeep 即可，无需改动本文件。 */
var _wdGun=(currentWeapon===WEAPON_GUN)?activeGunDef():null;
var _adsKeep=(_wdGun&&typeof _wdGun.adsSpreadKeep==='number')?_wdGun.adsSpreadKeep:(_wdGun&&_wdGun.type==='shotgun'?0.35:0);
for(var _p=0;_p<_pellets;_p++){var _spr=_hip*(1-S.aimProgress)+(_spreadB>0?_spreadB*(1-(1-_adsKeep)*S.aimProgress):0);if(S.sprinting)_spr+=0.020;var _sd=raycaster.ray.direction.clone();_sd.x+=(Math.random()-0.5)*2*_spr;_sd.y+=(Math.random()-0.5)*2*_spr;_sd.z+=(Math.random()-0.5)*2*_spr;_sd.normalize();raycaster.set(camera.position,_sd);var obsDist=Infinity,obsPoint=null;var _obsPair=(obstacleBoxes.length===obstacles.length);for(var oi=0;oi<obstacleBoxes.length;oi++){if(_obsPair&&obstacles[oi]&&obstacles[oi].spWall)continue;var op=new THREE.Vector3();if(raycaster.ray.intersectBox(obstacleBoxes[oi],op)!==null){var od=op.distanceTo(camera.position);if(od<obsDist){obsDist=od;obsPoint=op;}}}
/* 【batch187】掩体墙跳过上面的 AABB 粗筛（那个框对斜墙会盖住空气），改用定向射线拿真实交点 */if(typeof spWallRayHit==='function'){var _rd=raycaster.ray.direction;var _wh=spWallRayHit(camera.position.x,camera.position.y,camera.position.z,_rd.x,_rd.y,_rd.z,90);if(_wh&&_wh.dist<obsDist){obsDist=_wh.dist;obsPoint=_wh.point;}}for(var i=enemies.length-1;i>=0;i--){var e=enemies[i];if(e.hp<=0)continue;var hits=raycaster.intersectObjects(e.g.children,true);if(hits.length&&hits[0].distance<_range&&(hits[0].distance<obsDist)){var hs=(hits[0].object===e.head);var dmg=(hs?50:25)*S.damageMul;
            /* 【batch176】爆燃弹：**内联**写在这里。原来调 41 分片的 _spBurnProc，
               一旦玩家浏览器缓存了旧分片，typeof 检查就静默跳过 → 点了技能完全没反应。 */
            if(SK.sp&&SK.spBurnT>0&&hits[0].point){
              var _bp=hits[0].point;
              for(var _bi=enemies.length-1;_bi>=0;_bi--){
                var _be=enemies[_bi];
                if(_be.isNet?(!_be.alive):(_be.hp<=0))continue;
                var _bep=_be.root.position;
                var _by0=(_be.isNet?(_bep.y-0.6):(_bep.y+1.0));   /* 远端玩家 root.y 是相机高度，换算成胸部 */
                var _bx=_bep.x-_bp.x,_by=_by0-_bp.y,_bz=_bep.z-_bp.z;
                if(_bx*_bx+_by*_by+_bz*_bz>4)continue;                       // 2 米内
                _be.burnT=Math.max(_be.burnT||0,2.0);
                _be.burnDps=Math.min(9,(_be.burnDps||0)+3);
                if(_be.isNet){ try{netHitRemote(_be,false,20,_bp);}catch(_){} }
                else{
                  _be.hp-=20;_be.flash=0.3;
                  if(_be.hb)_be.hb.scale.x=Math.max(0,_be.hp/_be.maxHp);
                  if(_be.hbMat)_be.hbMat.color.setHex(_be.hp/_be.maxHp>.5?0x00ff00:(_be.hp/_be.maxHp>.25?0xffff00:0xff0000));
                  if(_be.hp<=0)killEnemy(_be,_bi,false);
                }
                try{spawnParticle(_bep.clone().setY(_bep.y+1.0),0xff8a3d,10,0.35,true);}catch(_){}
              }
            }
            if(SK.sp&&SK.idx===HERO_RUSHER){e.burnT=Math.max(e.burnT||0,2.0);e.burnDps=Math.min(9,(e.burnDps||0)+3);}   /* 【batch173】流火 SP 被动：灼烧可叠 3 层 */
            if(SK.sp&&SK.spMarkT>0&&SK.spMarkIds&&SK.spMarkIds[e.__oid__])dmg=Math.round(dmg*1.30);   /* 【batch172】猎杀标记易伤+30% */
            if(SK.sp&&SK._breakAt&&now-SK._breakAt<1000){dmg=Math.round(dmg*1.30);SK._breakAt=0;}   /* 【batch173】暗哨被动：破隐后 1 秒内首弹 +30% */
            if(e.isNet){if(_ffSkip(e)){break;}netHitRemote(e,hs,dmg,hits[0].point);break;}e.hp-=dmg;e.flash=0.2;spawnParticle(hits[0].point,hs?0xffff00:0xff4444,hs?8:4);var r=Math.max(0,e.hp/e.maxHp);e.hb.scale.x=r;e.hbMat.color.setHex(r>.5?0x00ff00:r>.25?0xffff00:0xff0000);if(hs)showMsg('💥 爆头!','#fc0');if(e.aiState==='aiming'){e.aiState='chase';if(e.aimLine)e.aimLine.visible=false;}if(e.hp<=0)killEnemy(e,i,hs);break;}}if(obsDist<_range)spawnParticle(obsPoint||camera.position.clone().add(new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion).multiplyScalar(2)),0x888888,4,0.2);
if(obsPoint&&typeof spWallHitAt==='function')spWallHitAt(obsPoint,25*S.damageMul,false);   /* 【batch187】打掩体墙扣墙血。★原来传的是变量 dmg —— 它只在「打中敌人」的分支里才被赋值，打墙时是 undefined，spWallHitAt 里 !(dmg>0) 直接 return → 墙永远不掉血（这就是"墙打不碎"的根因）。现在显式给 25×伤害倍率（墙没有爆头），步枪满弹匣 750 正好一梭子 */var dir=(typeof _sd!=='undefined')?_sd.clone():camera.getWorldDirection(new THREE.Vector3());/* 【batch196】曳光弹不再每发 new 几何+材质，改用实例池（见下方 同步弹丸）：这里只登记一个位置 */var b={position:camera.position.clone().add(dir.clone().multiplyScalar(1.5))};/* 【batch184f】子弹弹道 tracer 飞得越远才消失：原来 life:15（2.5/帧）→ 最多 37.5m，
   火车站长轴 156m，火车停靠点常离玩家 >37.5m，导致"离太远打不到火车"（火车不吃 attack 的瞬时射线，
   只吃这条 tracer 的 trainBoxHit）。改成按武器射程算帧数并给 200m 下限，让最远的火车也打得到。 */
bullets.push({m:b,d:dir,life:Math.max(80,Math.ceil(((typeof S.range==='number'?S.range:80))/2.5))});}if(S.ammo<=0)reload();}}
function killEnemy(e,idx,hs){
  /* 【batch244】天上的直升机：它也在 enemies 里（子弹射线才打得到），但"死"要走自己的流程
     —— 坠机动画 + 解除核弹倒计时。这里直接交出去，别按小兵结算金币/分数/刷怪。 */
  if(e&&e.helix){ if(typeof 直升机坠毁==='function')直升机坠毁(); return; }
  /* 【batch180】靶场假人：不真的死 —— 重置血量继续测（不进波次结算、不掉金币、不出拾取） */
  if(e&&e.rangeDummy){ if(typeof rangeDummyReset==='function'){try{rangeDummyReset(e);}catch(_){}} return; }
  var gb=e.gold*(hs?2:1);
  /* 【batch173】白泽 SP 被动：肾上腺素期间击杀回 25 血 */
  if(typeof SK!=='undefined'&&SK&&SK.sp&&SK.adren>0&&S.hp>0){S.hp=Math.min(S.maxHp,S.hp+25);updateHp();}S.score+=e.sc*(hs?2:1);S.kills++;S.left--;gold+=gb;totalGoldEarned+=gb;
  /* 【batch215】纪念枪「长明」专属击杀特效：屏幕计数卡 + 死者头顶的 LCD 终端。
     放在这里（而不是 attack 里）是因为它是**击杀确认点** —— 灼烧、技能溅射打死的也会走到。
     跨分片调用，必须 typeof 守卫（本分片加载时 js/27 还没加载）。 */
  try{ if(typeof 纪念击杀==='function')纪念击杀(e); }catch(_eMk){}
  try{if(typeof addHeroXp==='function')addHeroXp(SK.idx,hs?30:20);}catch(_){}   /* 【batch171】熟练度：击杀+20、爆头+30 */updateScore();updateWave();updateGoldHud();showGoldPopup(gb,innerWidth/2+(Math.random()-.5)*100,innerHeight/2-50);spawnParticle(e.root.position.clone().setY(1),ETYPES[e.type].c,12,0.4,true);if(Math.random()<.3)spawnPickup(e.root.position.clone());if(e.aimLine){e.aimLine.visible=false;scene.remove(e.aimLine);e.aimLine.geometry.dispose();e.aimLine.material.dispose();}scene.remove(e.root);enemies.splice(idx,1);if(S.left<=0)setTimeout(showWaveShop,1500);
  /* 【batch128】剧情模式：清剿小兵要**真的记数**。
     之前只加了 spawned、忘了 killed → HUD 永远是「0/10」，玩家体感就是"杀多少都不结束"。 */
  if(typeof STORY_!=='undefined'&&STORY_.on&&!e.isNet&&STORY_.phase==='hunt'){
    STORY_.killed++;
    if(typeof storyGoalRefresh==='function')storyGoalRefresh();
  }
  /* 【batch126】剧情模式：干掉的是「闪电」→ 走胜利结局（别开波次商店） */
  /* 【batch149】只有**第一章**的闪电才是「打倒即胜利」。第二章的闪电根本不在 enemies 里
     （她只是闪现一击就走），胜利条件唯一：把人救出来。 */
  if(typeof STORY_!=='undefined'&&STORY_.on&&STORY_.ch!==2&&e===STORY_.boss){STORY_.boss=null;storyEnd('win');}}

// ==================== ENEMY BULLETS ====================
var ebGeo=new THREE.SphereGeometry(0.13,6,6),ebMat=new THREE.MeshBasicMaterial({color:0xff6a2a});   // 【batch101】弹丸加大加亮（原来 0.08 太小、几乎看不见）

/* ==================== 【batch196】弹丸实例化（CPU → GPU）====================
   用户问「能不能把 CPU 开销换成 GPU？」，弹丸是第二个大坑：
     · 玩家**每开一枪**都 new 一个 SphereGeometry + 一个 MeshBasicMaterial
       → 驱动侧要建 buffer、上传、之后销毁；GC 也跟着抖（步枪 50ms 一发 = 每秒 20 次）
     · 敌人子弹虽然共享几何，但每颗仍是独立 Mesh → 屏上 60 颗 = 60 次 draw call
   现在：玩家曳光弹 / 敌人弹丸各一个 InstancedMesh（96 实例），**各 1 次 draw call**，
   几何和材质在脚本加载时建一次，之后永不再申请。
   实体上的 b.m 保留成「只有 position 的壳」（普通对象 + 一个 Vector3），所以外部所有
     b.m.position 读写、scene.remove(b.m)、b.m.parent 判断全部照旧有效
     （壳没有 parent，remove 是空操作，parent 判断自然为假）。
   ⚠️ 子弹被 splice 掉不需要通知池：下一帧同步时「上一帧用过、本帧没用」的槽会被缩放到 0 隐藏。 */
function _建弹池(geo,mat,容量){
  var 网=new THREE.InstancedMesh(geo,mat,容量);
  网.frustumCulled=false;                    /* 弹丸会飞出包围球，按包围球剔除会突然消失 */
  网.castShadow=false; 网.receiveShadow=false;
  网.userData._弹池=1;
  var 零=new THREE.Matrix4().makeScale(0,0,0);
  for(var i=0;i<容量;i++)网.setMatrixAt(i,零);
  网.instanceMatrix.needsUpdate=true;
  scene.add(网);
  return {网:网, 容量:容量, 标:new Uint8Array(容量), 上一:new Uint8Array(容量), 零:零};
}
var EB_池=null, PB_池=null;
var _弹M=new THREE.Matrix4();
/* 【batch196】下面这几个盒子/向量在 updateEnemyBullets 里**每个子弹每帧**都要用，
   原来都是现场 new 出来的（60 颗子弹＝每秒 3600 次分配）。改成模块级复用，
   注意 setFromCenterAndSize 是重置式的，所以复用不会串味。 */
var _弹盒=new THREE.Box3(), _弹半=new THREE.Vector3(0.3,0.3,0.3);
var _玩家盒=new THREE.Box3(), _玩家半=new THREE.Vector3();
/* 把一组弹丸实体的位置同步进 InstancedMesh（每帧一次，O(弹丸数 + 容量)） */
function _同步弹池(池, arr){
  if(!池)return;
  var 用=池.标, i, s, k, 改=false;
  用.fill(0);
  for(i=0;i<arr.length;i++){
    var b=arr[i]; if(!b||!b.m)continue;
    s=b.slot;
    if(s===undefined||s<0||用[s]){
      s=-1;
      for(k=0;k<池.容量;k++)if(!用[k]){ s=k; break; }
      if(s<0)continue;                        /* 池满：这颗本帧不画，判定逻辑照旧走 */
      b.slot=s;
    }
    用[s]=1;
    _弹M.makeTranslation(b.m.position.x,b.m.position.y,b.m.position.z);
    池.网.setMatrixAt(s,_弹M); 改=true;
  }
  for(s=0;s<池.容量;s++){
    if(!用[s]&&池.上一[s]){ 池.网.setMatrixAt(s,池.零); 改=true; }
  }
  池.上一.set(用);
  if(改)池.网.instanceMatrix.needsUpdate=true;
}
/* 每帧调一次：两个池一起同步。放在 js/26 主循环里（typeof 守卫）。 */
function 同步弹丸(){
  try{ if(!PB_池)PB_池=_建弹池(new THREE.SphereGeometry(0.03,4,4),new THREE.MeshBasicMaterial({color:0xffff44}),128); }catch(e){}
  try{ if(!EB_池)EB_池=_建弹池(ebGeo,ebMat,96); }catch(e){}
  _同步弹池(PB_池,bullets);
  _同步弹池(EB_池,enemyBullets);
}
function spawnEnemyBullet(origin,direction,speed,damage,by){var m={position:origin.clone()};enemyBullets.push({m:m,d:direction.clone(),spd:speed,dmg:damage,life:200,prevPos:origin.clone(),by:by||null});}
/* 线段 p0→p1 是否穿过「以 c 为中心、半尺寸 (hx,hy,hz)」的轴对齐盒（slab 法）。
   原来这里是**每颗子弹每帧** new 一个 BoxGeometry(1.2,2.0,1.2) + Mesh 再走 Raycaster
   —— 20 颗子弹＝每秒上千次几何创建/销毁（驱动建 buffer、GC 回收），是纯 CPU 浪费。
   而这个临时盒和上面 playerBox 的中心/尺寸完全一样，slab 法十几行浮点就能得到同样结果。 */
function _段穿盒(p0,p1,c,hx,hy,hz){
  var t0,t1,tmp,tmin=0,tmax=1,sw;
  var o=[p0.x-c.x,p0.y-c.y,p0.z-c.z];
  var v=[p1.x-p0.x,p1.y-p0.y,p1.z-p0.z];
  var h=[hx,hy,hz];
  for(var i=0;i<3;i++){
    if(Math.abs(v[i])<1e-9){ if(o[i]<-h[i]||o[i]>h[i])return false; continue; }
    t0=(-h[i]-o[i])/v[i]; t1=(h[i]-o[i])/v[i];
    if(t0>t1){ tmp=t0; t0=t1; t1=tmp; }
    if(t0>tmin)tmin=t0;
    if(t1<tmax)tmax=t1;
    if(tmin>tmax)return false;
  }
  return true;
}
function updateEnemyBullets(){var playerBox=_玩家盒;playerBox.setFromCenterAndSize(camera.position,_玩家半.set(S.crouch?0.9:1.2,S.crouch?1.5:2.0,S.crouch?0.9:1.2));for(var i=enemyBullets.length-1;i>=0;i--){var b=enemyBullets[i];b.prevPos.copy(b.m.position);b.m.position.addScaledVector(b.d,b.spd);var bulletBox=_弹盒;bulletBox.setFromCenterAndSize(b.m.position,_弹半);var hit=playerBox.intersectsBox(bulletBox);if(!hit&&!b.cracked&&performance.now()-lastCrack>45&&pointSegDist(camera.position,b.prevPos,b.m.position)<1.6){b.cracked=true;lastCrack=performance.now();playCrack();}if(!hit){if(_段穿盒(b.prevPos,b.m.position,camera.position,0.6,1.0,0.6))hit=true;}if(hit){takeDmg(b.dmg,b.by);spawnParticle(b.m.position,0xff4400,6,0.3);scene.remove(b.m);enemyBullets.splice(i,1);continue;}   /* 【batch181】火车车厢也挡 AI 的子弹 */if(typeof trainBoxHit==='function'&&trainBoxHit(b.m.position.x,b.m.position.y,b.m.position.z)){spawnParticle(b.m.position,0xffcc66,4,0.15);if(typeof trainDamage==='function')trainDamage(15,b.m.position.x,b.m.position.y,b.m.position.z);scene.remove(b.m);enemyBullets.splice(i,1);continue;}{var bx=b.m.position.x,bz=b.m.position.z,by=b.m.position.y,bwall=false;for(var wi=0;wi<obstacles.length;wi++){var wo=obstacles[wi];if(wo.spWall){if(by>wo.y1+0.3||by<wo.y0-0.3)continue;if(typeof spWallContains==='function'?spWallContains(wo,bx,bz):true){bwall=true;break;}else continue;}if(by>wo.h+0.3)continue;if((wo.rail||wo.slab)&&(by<wo.y0-0.3||(wo.slab&&by>wo.y1+0.3)))continue;if(bx+0.15>wo.minX&&bx-0.15<wo.maxX&&bz+0.15>wo.minZ&&bz-0.15<wo.maxZ){bwall=true;break;}}if(bwall){spawnParticle(b.m.position,0xff8844,3,0.15);scene.remove(b.m);enemyBullets.splice(i,1);continue;}}if(--b.life<=0){scene.remove(b.m);enemyBullets.splice(i,1);}}}

// ==================== PICKUPS & WAVES ====================
var pkGeo=new THREE.OctahedronGeometry(0.4,0);
function spawnPickup(pos){var type=Math.random()<.5?'hp':'ammo';var m=new THREE.Mesh(pkGeo,new THREE.MeshBasicMaterial({color:type==='hp'?0x00ff88:0xffaa00}));pos.y=1;m.position.copy(pos);scene.add(m);pickups.push({m:m,type:type,life:500});}
function nextWave(){if(typeof rangeMode==='function'&&rangeMode()){S.left=9999;updateWave();return;}   /* 给个大数：避免"剩余 0"触发过波结算商店（靶场没有波次） */   /* 【batch180】靶场：不刷敌人，专心试枪 / 试技能 */S.wave++;var n=4+S.wave*2;S.left=n;updateWave();showMsg('第'+S.wave+'波 - '+n+'个敌人','#fc0');for(var i=0;i<n;i++){(function(idx){setTimeout(function(){if(S.over)return;var r=Math.random();var t='basic';if(S.wave>=3&&r<.12)t='elite';else if(S.wave>=2&&r<.3)t='tank';else if(r<.5)t='fast';createEnemy(t);},idx*350);})(i);}S.hp=Math.min(S.maxHp,S.hp+20);updateHp();}
function showWaveShop(){if(S.over)return;S.paused=true;document.getElementById('wave-shop').style.display='flex';document.getElementById('ws-wave').textContent=S.wave;renderUpgradeCards();try{document.exitPointerLock();}catch(e){}}
document.getElementById('wsContinue').addEventListener('click',function(e){e.stopPropagation();document.getElementById('wave-shop').style.display='none';S.paused=false;lockPointer();nextWave();});
