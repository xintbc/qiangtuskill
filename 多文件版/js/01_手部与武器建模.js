// ==================== PLAYER HAND SYSTEM ====================
var RECOIL_PER_SHOT=0.006; // 每发子弹视角上抬量(rad)；攀升速率 = 该值 × 每秒发射数 → 射速越快后坐越猛
var recoilPivot = new THREE.Group();
camera.add(recoilPivot);
var weaponGroup = new THREE.Group();
recoilPivot.add(weaponGroup);
var leftHandAnchor = new THREE.Group();
weaponGroup.add(leftHandAnchor);

var currentMagMesh = null;
var reloadNewMag = null;
var curMagPos = { x:0, y:0, z:0 };   // 当前枪弹匣在武器组里的挂点（换弹后会回到这里）
var reloadAnimStart = 0;

var GUN_BASE_POS = { x: 0.18, y: -0.22, z: -0.45 };
var ADS_GUN_POS = { x: 0.0, y: -0.092, z: -0.30 };
var KNIFE_BASE_POS = { x: 0.18, y: -0.22, z: -0.45 };
var LH_GUN_LOCAL = { x: -0.04, y: -0.095, z: -0.22 };
var LH_KNIFE_CAM = { x: -0.22, y: -0.26, z: -0.35, rx: 0.4, ry: 0.6, rz: 0.2 };
var leftHandCamGroup = new THREE.Group();
camera.add(leftHandCamGroup);
var climbHands=new THREE.Group();var chL,chR;climbHands.visible=false;camera.add(climbHands);function buildClimbHand(side){var g=new THREE.Group();var palm=new THREE.Mesh(new THREE.BoxGeometry(0.10,0.12,0.035),gloveMat);g.add(palm);var fingers=[];for(var fi=0;fi<4;fi++){var fng=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.07,0.025),skinMat);fng.geometry.translate(0,0.035,0);fng.position.set((fi-1.5)*0.026,-0.005,0.035);g.add(fng);fingers.push(fng);}var wrist=new THREE.Mesh(new THREE.BoxGeometry(0.075,0.075,0.14),skinMat);wrist.position.set(0,0.07,0.05);wrist.rotation.x=0.5;g.add(wrist);g.userData.fingers=fingers;return g;}function setClimbGrip(hand,grip){var fs=hand.userData.fingers;if(!fs)return;for(var i=0;i<fs.length;i++){var f=fs[i];f.rotation.x=-grip*1.0;f.rotation.z=(1-grip)*((i-1.5)*0.12);}}function buildClimbHands(){if(chL)return;chL=buildClimbHand(-1);chR=buildClimbHand(1);chL.position.set(-0.16,-0.55,-0.7);chL.rotation.x=-0.5;chR.position.set(0.16,-0.55,-0.7);chR.rotation.x=-0.5;climbHands.add(chL);climbHands.add(chR);}
var lhCurrent = { x: LH_KNIFE_CAM.x, y: LH_KNIFE_CAM.y, z: LH_KNIFE_CAM.z, rx: LH_KNIFE_CAM.rx, ry: LH_KNIFE_CAM.ry, rz: LH_KNIFE_CAM.rz };

/* 【batch184d·枪/刀姿势】每把枪/刀可带自定义握持(gripPos)/开镜(aimPos)/左手(lhPos)姿态，
   引擎在这些点优先取当前武器 def 的字段，缺省回退到上面的全局常量。 */
function activeGunPose(){ var d=(currentWeapon===WEAPON_GUN)?activeGunDef():null; return (d&&(d.gripPos||d.aimPos||d.lhPos))?d:null; }
function gunGripPos(){ var d=activeGunPose(); return (d&&d.gripPos)?d.gripPos:GUN_BASE_POS; }
function gunAimPos(){ var d=activeGunPose(); return (d&&d.aimPos)?d.aimPos:ADS_GUN_POS; }
function gunLH(){ var d=activeGunPose(); return (d&&d.lhPos)?d.lhPos:LH_GUN_LOCAL; }
/* 【batch184e】每把枪可声明持法(hold)与换弹方式(reloadStyle)：区分手枪/左轮与步枪的
   第一人称手持动作与换弹动画，缺省回退步枪行为。lerp3 供换弹插值复用。 */
function gunHold(){ var d=activeGunPose(); return (d&&d.hold)?d.hold:'rifle'; }
function gunReloadStyle(){
  var d=activeGunPose();
  if(d&&d.premiumReload)return 'premium';        /* 【batch203】纪念枪：走 7 段高级换弹 */
  return (d&&d.reloadStyle)?d.reloadStyle:'mag';
}
function lerp3(p,q,t){return {x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t,z:p.z+(q.z-p.z)*t};}
/* 【batch184d·刀】自定义刀注册表：ModLoader.addKnife 往 KNIVES 加；内置战术刀是默认。 */
var KNIVES={}; var currentKnife='tactical';
function builtinKnifeDef(){ return { id:'tactical', name:'战术刀', icon:'🔪', builtin:true, gripPos:KNIFE_BASE_POS, lhPos:LH_KNIFE_CAM, damage:KNIFE_DAMAGE, range:KNIFE_RANGE, cooldown:KNIFE_COOLDOWN, build:null }; }
function curKnifeDef(){ try{ var d=KNIVES[currentKnife]; if(d)return d; }catch(e){} return builtinKnifeDef(); }
function setCurrentKnife(id){ if(!id)return; if(id!=='tactical'&&!KNIVES[id])return;
  /* 【batch218b】同上：拿着投掷物时不换刀 */
  try{ if(typeof SK!=='undefined'&&SK&&SK.hold)return; }catch(_e3){} currentKnife=id; if(currentWeapon===WEAPON_KNIFE)rebuildWeaponModel(); }
function getAllKnives(){ var arr=[{id:'tactical',name:'战术刀',icon:'🔪',builtin:true}]; try{ for(var k in KNIVES){ if(Object.prototype.hasOwnProperty.call(KNIVES,k)){ var d=KNIVES[k]; arr.push({id:k,name:d.name||k,icon:d.icon||'🔪',builtin:false}); } } }catch(e){} return arr; }

var gMat=new THREE.MeshLambertMaterial({color:0x1a1a1a,side:THREE.DoubleSide});
var gMatDark=new THREE.MeshLambertMaterial({color:0x111111,side:THREE.DoubleSide});
var gMatLight=new THREE.MeshLambertMaterial({color:0x2a2a2a,side:THREE.DoubleSide});
var railMat=new THREE.MeshLambertMaterial({color:0x333333,side:THREE.DoubleSide});
var magMat=new THREE.MeshLambertMaterial({color:0x2a2a2a,side:THREE.DoubleSide});
var drumMat=new THREE.MeshLambertMaterial({color:0x222222,side:THREE.DoubleSide});
var drumRingMat=new THREE.MeshLambertMaterial({color:0x3a3a3a,side:THREE.DoubleSide});
var stockMat=new THREE.MeshLambertMaterial({color:0x1e1e1e,side:THREE.DoubleSide});
var gripMat=new THREE.MeshLambertMaterial({color:0x151515,side:THREE.DoubleSide});
var foreGripMat=new THREE.MeshLambertMaterial({color:0x181818,side:THREE.DoubleSide});
var bladeMat=new THREE.MeshLambertMaterial({color:0xcccccc,side:THREE.DoubleSide});
var handleMat=new THREE.MeshLambertMaterial({color:0x442200,side:THREE.DoubleSide});
var edgeMat=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide});
var skinMat=new THREE.MeshLambertMaterial({color:0xd4a574,side:THREE.DoubleSide});
var gloveMat=new THREE.MeshLambertMaterial({color:0x1a1a1a,side:THREE.DoubleSide});
var muzzleMat=new THREE.MeshLambertMaterial({color:0x0a0a0a,side:THREE.DoubleSide});

var WEAPON_GUN=0,WEAPON_KNIFE=1;
var currentWeapon=WEAPON_GUN;
var curGun=WEAPON_GUN;        // 当前手持主武器：WEAPON_GUN=内置步枪；>=2=ModLoader.addWeapon 注册的枪；-1=纪念枪「长明」
var _rifleSnap=null;          // 切到模组枪前快照步枪的 伤害/弹容/弹量，切回时还原（保留升级加成）
/* 【batch203】内置枪 def 表：key = 槽位号。
   为什么要这张表：模组枪走 ModLoader.weapons（外部文件注册），而纪念枪是**游戏本体的一部分**
   （单文件版没有 mode 目录，读不到任何模组），所以它必须有自己的一条路。
   用 -1 当槽位号：ModLoader 从 2 往上发号（_wNext），负数永远不会撞车。 */
var BUILTIN_GUNS={};
function activeGunDef(){
  try{ if(window.ModLoader&&ModLoader.weapons&&ModLoader.weapons[curGun])return ModLoader.weapons[curGun]; }catch(e){}
  return BUILTIN_GUNS[curGun]||null;
}
var ANIM_IDLE=0,ANIM_LOWERING=1,ANIM_RAISING=2;
var switchAnimState=ANIM_IDLE,switchAnimStart=0,pendingWeapon=-1;
var SWITCH_LOWER_DURATION=200,SWITCH_RAISE_DURATION=250;
var knifeSwinging=false,knifeSwingTime=0,lastKnifeAttack=0;
var KNIFE_WRIST_DUR=100,KNIFE_STAB_DUR=90,KNIFE_HOLD_DUR=40,KNIFE_RECOVER_DUR=140;
var KNIFE_TOTAL_DUR=KNIFE_WRIST_DUR+KNIFE_STAB_DUR+KNIFE_HOLD_DUR+KNIFE_RECOVER_DUR;
var KNIFE_COOLDOWN=420,KNIFE_DAMAGE=80,KNIFE_RANGE=3.5,KNIFE_SPEED_BONUS=1.4;
/* 【模组·枪械】以下辅助函数让 ModLoader.addWeapon / setWeaponStats 能真正生效。
   全部就地定义（和 attack 在同一个分片），绝不去跨分片调函数，避免浏览器旧缓存导致 ReferenceError。 */
function curWDef(){try{return (window.ModLoader&&ModLoader.weapons&&ModLoader.weapons[currentWeapon])||null;}catch(e){return null;}}
function wStat(slot){try{return (window.ModLoader&&ModLoader._wstat&&ModLoader._wstat[slot])||null;}catch(e){return null;}}
function weaponValid(idx){ if(idx===WEAPON_GUN||idx===WEAPON_KNIFE)return true; if(BUILTIN_GUNS[idx])return true; try{return !!(window.ModLoader&&ModLoader.weapons&&ModLoader.weapons[idx]);}catch(e){return false;} }
function isGunWeapon(){ var d=curWDef(); if(d)return !d.melee&&d.ammo!==false; return currentWeapon===WEAPON_GUN; }
/* 【模组·枪械】新枪与内置步枪「行为完全一致」（同样能开镜/换弹/走同一套射击逻辑），
   区别只在三样：弹容量(maxAmmo)、伤害(damageMul)、模型(build)。
   因此这里只应用 伤害 与 弹容量 两项；射速/换弹时间/后坐/射程全部沿用步枪基准，不对单把枪特殊化。 */
function applyWeaponDef(){
  if(currentWeapon!==WEAPON_GUN)return;            // 刀：无枪械属性
  var d=activeGunDef();                            // 当前手持枪（步枪=内置 null；模组枪=对应 def）
  if(!d){
    // 内置步枪：还原为切换到模组枪之前快照的步枪属性（含升级加成），保留当前弹量
    if(_rifleSnap){
      S.damageMul=_rifleSnap.damageMul;S.maxAmmo=_rifleSnap.maxAmmo;S.ammo=_rifleSnap.ammo;
      S.fireRate=_rifleSnap.fireRate;S.reloadTime=_rifleSnap.reloadTime;S.recoilMul=_rifleSnap.recoilMul;
      S.range=_rifleSnap.range;S.pellets=_rifleSnap.pellets;S.spread=_rifleSnap.spread;S.auto=_rifleSnap.auto;
      _rifleSnap=null;
    }
    updateAmmo();return;
  }
  // 第一次拿到模组枪：先把步枪当前属性存进快照（切回步枪时还原）
  if(!_rifleSnap)_rifleSnap={damageMul:S.damageMul,maxAmmo:S.maxAmmo,ammo:S.ammo,fireRate:S.fireRate,reloadTime:S.reloadTime,recoilMul:S.recoilMul,range:S.range,pellets:S.pellets,spread:S.spread,auto:S.auto};
  if(typeof d.damage==='number')S.damageMul=d.damage;
  if(typeof d.magSize==='number')S.maxAmmo=d.magSize;
  if(S.ammo>S.maxAmmo||S.ammo<=0||typeof S.ammo!=='number')S.ammo=S.maxAmmo;
  // 数值属性：缺省沿用步枪快照基准（即原「行为完全一致」兜底），有则覆盖 → 各枪数值真正不同
  S.fireRate   = (typeof d.fireRate==='number')   ? d.fireRate   : _rifleSnap.fireRate;
  S.reloadTime = (typeof d.reloadTime==='number') ? d.reloadTime : _rifleSnap.reloadTime;
  S.recoilMul  = (typeof d.recoilMul==='number')  ? d.recoilMul  : _rifleSnap.recoilMul;
  S.range      = (typeof d.range==='number')      ? d.range      : _rifleSnap.range;
  S.pellets    = (typeof d.pellets==='number')    ? d.pellets    : _rifleSnap.pellets;
  S.spread     = (typeof d.spread==='number')     ? d.spread     : _rifleSnap.spread;
  S.auto       = (typeof d.auto==='boolean')      ? d.auto       : _rifleSnap.auto;
  updateAmmo();
}
function knifeDmg(){var d=curKnifeDef();if(d&&typeof d.damage==='number')return d.damage;var st=wStat(WEAPON_KNIFE);return (st&&typeof st.damage==='number')?st.damage:KNIFE_DAMAGE;}
function knifeRange(){var d=curKnifeDef();if(d&&typeof d.range==='number')return d.range;var st=wStat(WEAPON_KNIFE);return (st&&typeof st.range==='number')?st.range:KNIFE_RANGE;}
function knifeCD(){var d=curKnifeDef();if(d&&typeof d.cooldown==='number')return d.cooldown;var st=wStat(WEAPON_KNIFE);return (st&&typeof st.cooldown==='number')?st.cooldown:KNIFE_COOLDOWN;}

function canAct(){return switchAnimState===ANIM_IDLE&&!S.reloading&&!netIsDead()&&!(SK&&SK.downed>0)&&!(SK&&SK.ghost>0)&&!(SK&&SK.shadowT>0)   // 【batch145】虚化中：不能开枪、不能挥刀；【batch158】遁入暗影同样不能
  &&!(typeof STORY_!=='undefined'&&STORY_.on&&STORY_.cut);}      // 【batch126】剧情演出时不放行开火   // 【batch120】倒地＝不能开枪

function buildLeftHandForGun(anchor){
  if(typeof ModLoader!=='undefined'&&ModLoader.handBuilder&&ModLoader.handBuilder('gunLeft',anchor))return;   /* 【batch184d·#100】模组可替换左手（持枪）模型 */
  while(anchor.children.length>0){var c=anchor.children[0];anchor.remove(c);if(c.geometry)c.geometry.dispose();}
  var palm=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.08,0.07),gloveMat);anchor.add(palm);
  var fingers=new THREE.Mesh(new THREE.BoxGeometry(0.055,0.065,0.04),gloveMat);fingers.position.set(0.01,-0.005,-0.045);anchor.add(fingers);
  var thumb=new THREE.Mesh(new THREE.BoxGeometry(0.025,0.035,0.025),gloveMat);thumb.position.set(0.035,0.025,-0.01);thumb.rotation.set(0.2,0,-0.3);anchor.add(thumb);
  var elbowTarget=new THREE.Vector3(-0.14,0.09,0.42);
  var armLen=elbowTarget.length();var armCenter=elbowTarget.clone().multiplyScalar(0.5);
  var arm=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.06,armLen),skinMat);arm.position.copy(armCenter);arm.lookAt(elbowTarget);anchor.add(arm);
  _标静态(anchor);   /* 【batch196】手掌/手指/拇指/小臂 4 件同材质 → 合批成 1 次绘制 */
}

function buildLeftHandForKnife(group){
  if(typeof ModLoader!=='undefined'&&ModLoader.handBuilder&&ModLoader.handBuilder('knifeLeft',group))return;   /* 【batch184d·#100】模组可替换左手（持刀）模型 */
  while(group.children.length>0){var c=group.children[0];group.remove(c);if(c.geometry)c.geometry.dispose();}
  var palm=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.08,0.07),gloveMat);group.add(palm);
  var fingers=new THREE.Mesh(new THREE.BoxGeometry(0.055,0.065,0.04),gloveMat);fingers.position.set(0.01,-0.005,-0.045);group.add(fingers);
  var thumb=new THREE.Mesh(new THREE.BoxGeometry(0.025,0.035,0.025),gloveMat);thumb.position.set(0.035,0.025,-0.01);thumb.rotation.set(0.2,0,-0.3);group.add(thumb);
  var elbowTarget=new THREE.Vector3(-0.14,0.09,0.42);
  var armLen=elbowTarget.length();var armCenter=elbowTarget.clone().multiplyScalar(0.5);
  var arm=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.06,armLen),skinMat);arm.position.copy(armCenter);arm.lookAt(elbowTarget);group.add(arm);
  _标静态(group);   /* 【batch196】同 buildLeftHandForGun */
}

function buildRightHand(group,gripOffset,armExtDir){
  if(typeof ModLoader!=='undefined'&&ModLoader.handBuilder&&ModLoader.handBuilder('right',group,gripOffset,armExtDir))return;   /* 【batch184d·#100】模组可替换右手（持械）模型 */
  var hand=new THREE.Mesh(new THREE.BoxGeometry(0.09,0.06,0.10),gloveMat);hand.position.copy(gripOffset);group.add(hand);
  var armOrigin=gripOffset.clone().add(new THREE.Vector3(0,0,0.05));
  var armEnd=armOrigin.clone().add(armExtDir);var armCenter=armOrigin.clone().add(armEnd).multiplyScalar(0.5);
  var armLen=armExtDir.length();
  var arm=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.08,armLen),skinMat);arm.position.copy(armCenter);arm.lookAt(armEnd);group.add(arm);
  _标静态(group);   /* 【batch196】持械手 + 小臂：和枪身一起按材质合批 */
}

function buildMagazineGroup(def, magLv){
  var mt=(def&&def.magType)?def.magType:'rifle';
  var magGroup=new THREE.Group();magGroup.name='magazine';
  if(mt==='rifle'){
    if(magLv>=4){
      var drumBody=new THREE.Mesh(new THREE.CylinderGeometry(0.085,0.085,0.07,16),drumMat);drumBody.rotation.z=Math.PI/2;drumBody.position.set(0,-0.10,-0.04);magGroup.add(drumBody);
      var ringF=new THREE.Mesh(new THREE.TorusGeometry(0.075,0.008,6,16),drumRingMat);ringF.rotation.y=Math.PI/2;ringF.position.set(-0.036,-0.10,-0.04);magGroup.add(ringF);
      var ringB=new THREE.Mesh(new THREE.TorusGeometry(0.075,0.008,6,16),drumRingMat);ringB.rotation.y=Math.PI/2;ringB.position.set(0.036,-0.10,-0.04);magGroup.add(ringB);
      var hub=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.075,8),gMatLight);hub.rotation.z=Math.PI/2;hub.position.set(0,-0.10,-0.04);magGroup.add(hub);
      for(var hi=0;hi<4;hi++){var hole=new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.012,0.072,6),gMatDark);hole.rotation.z=Math.PI/2;var ha=hi*Math.PI/2;hole.position.set(0,-0.10+Math.sin(ha)*0.05,-0.04+Math.cos(ha)*0.05);magGroup.add(hole);}
      var feed=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.04,0.03),gMat);feed.position.set(0,-0.04,-0.04);magGroup.add(feed);
    }else{
      var magW=0.04+magLv*0.005;var magLen=0.12+magLv*0.04;
      var mag=new THREE.Mesh(new THREE.BoxGeometry(magW,magLen,0.05),magMat);mag.position.set(0,-0.045-magLen/2,-0.02);magGroup.add(mag);
      var basePlate=new THREE.Mesh(new THREE.BoxGeometry(magW+0.008,0.012,0.054),gMatLight);basePlate.position.set(0,-0.045-magLen+0.006,-0.02);magGroup.add(basePlate);
      if(magLv>=2){var rib=new THREE.Mesh(new THREE.BoxGeometry(magW+0.004,magLen*0.6,0.004),gMatDark);rib.position.set(0,-0.045-magLen*0.4,-0.02+0.028);magGroup.add(rib);}
    }
  }else if(mt==='shotgun'){            // 短粗弹匣
    var sgLen=0.12;
    var sgMag=new THREE.Mesh(new THREE.BoxGeometry(0.06,sgLen,0.07),magMat);sgMag.position.set(0,-sgLen/2,-0.02);magGroup.add(sgMag);
    var sgBase=new THREE.Mesh(new THREE.BoxGeometry(0.066,0.014,0.076),gMatLight);sgBase.position.set(0,-sgLen+0.007,-0.02);magGroup.add(sgBase);
    var sgTop=new THREE.Mesh(new THREE.BoxGeometry(0.056,0.02,0.062),gMatDark);sgTop.position.set(0,-0.01,-0.02);magGroup.add(sgTop);
  }else if(mt==='smg'){                // 弯香蕉弹匣
    var smLen=0.15;
    var smMag=new THREE.Mesh(new THREE.BoxGeometry(0.05,smLen,0.06),magMat);smMag.position.set(0.012,-smLen/2,-0.02);smMag.rotation.x=-0.30;magGroup.add(smMag);
    var smBase=new THREE.Mesh(new THREE.BoxGeometry(0.056,0.014,0.066),gMatLight);smBase.position.set(0.028,-smLen+0.006,-0.02);smBase.rotation.x=-0.30;magGroup.add(smBase);
  }else if(mt==='sniper'){             // 短小弹匣
    var snLen=0.085;
    var snMag=new THREE.Mesh(new THREE.BoxGeometry(0.045,snLen,0.05),magMat);snMag.position.set(0,-snLen/2,-0.02);magGroup.add(snMag);
    var snBase=new THREE.Mesh(new THREE.BoxGeometry(0.052,0.012,0.056),gMatLight);snBase.position.set(0,-snLen+0.006,-0.02);magGroup.add(snBase);
  }else if(mt==='lmg'){                // 大方弹箱
    var lmLen=0.16;
    var lmMag=new THREE.Mesh(new THREE.BoxGeometry(0.10,lmLen,0.10),magMat);lmMag.position.set(0,-lmLen/2,-0.02);magGroup.add(lmMag);
    var lmTop=new THREE.Mesh(new THREE.BoxGeometry(0.106,0.02,0.106),gMatDark);lmTop.position.set(0,-0.01,-0.02);magGroup.add(lmTop);
    var lmBase=new THREE.Mesh(new THREE.BoxGeometry(0.11,0.016,0.11),gMatLight);lmBase.position.set(0,-lmLen+0.008,-0.02);magGroup.add(lmBase);
  }else if(mt==='memorial'){
    /* 【batch206】纪念枪弹匣（第三版，按用户最新的话重做）
       ── 用户原话 ──
       "消耗掉一颗子弹是在上面消耗，不过会从下面送上去"、"子弹的排列应该呈 S 型"、
       "最后推上去的只有一颗子弹，就是以 S 型一颗一颗往上推"、"弹夹要跟抛弹口连在一起"。
       ── 做法 ──
       · 30 发按**S 形**排：每 5.8mm 一级、左右交替（一发在左一发在右），
         从正面看就是经典的锯齿/S 形双排 —— 不是上一版"每排两发并排"的方块阵列；
       · 只留前 N 个实例 → 上面那摞不动、**底下先空**，看起来就是"从下面一颗一颗顶上来"；
       · 托弹板（follower）跟着最上面那摞的下沿一路上移，看得见"一直在往上送"；
       · 弹匣最上面那发就露在下机匣的喂弹口里、正对抛壳窗（喂弹口见 js/01 下机匣那段）；
       · 侧面开 18mm 竖窗（真镂空，不是透明材质），从侧面能看清每一发。 */
    var 壳材=new THREE.MeshLambertMaterial({color:0xb98a34});
    var 头材=new THREE.MeshLambertMaterial({color:0xb7a071});
    var 匣外=new THREE.MeshLambertMaterial({color:0x2c332f,side:THREE.DoubleSide});
    var 匣暗=new THREE.MeshLambertMaterial({color:0x191f1c,side:THREE.DoubleSide});
    var 匣金=new THREE.MeshBasicMaterial({color:0xe6c46a});
    var 匣钢=new THREE.MeshLambertMaterial({color:0x333c39,side:THREE.DoubleSide});
    var 匣胶=new THREE.MeshLambertMaterial({color:0x1c1d21,side:THREE.DoubleSide});
    var M=new THREE.Group();magGroup.add(M);
    var 宽=0.033, 厚=0.070;
    var 段高=0.0350, 段数=5, 折角=0.056;
    var 弹位=[], 级=0;
    var 累Y=0, 累Z=0;
    for(var 段=0;段<段数;段++){
      var 角=段*折角;
      var g2=new THREE.Group();
      g2.position.set(0, 累Y-段高/2*Math.cos(角), 累Z-段高/2*Math.sin(角));
      g2.rotation.x=角;
      M.add(g2);
      var 段内=function(w,h,d,m,x,y,z){var o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);g2.add(o);return o;};
      for(var 侧=-1;侧<=1;侧+=2){
        var x0=侧*0.0145;
        段内(0.004,段高,0.024,匣外,x0,0,-0.021);
        段内(0.004,段高,0.023,匣外,x0,0, 0.0215);
      }
      段内(宽,段高,0.005,匣暗,0,0, 厚/2-0.0025);
      段内(宽,段高,0.005,匣暗,0,0,-厚/2+0.0025);
      段内(宽*0.66,0.0035,0.004,匣暗,0, 0.0085,-厚/2+0.0015);
      段内(宽*0.66,0.0035,0.004,匣暗,0,-0.0085,-厚/2+0.0015);
      if(段===0){
        段内(宽+0.006,0.008,0.012,匣暗,0,段高/2, 厚/2-0.006);
        段内(宽+0.006,0.008,0.012,匣暗,0,段高/2,-厚/2+0.006);
        段内(0.005,0.011,0.030,匣钢,-0.0190,0.004,0);
      }
      if(段===段数-1){
        段内(宽+0.006,0.013,厚+0.004,匣胶,0,-段高/2-0.007,0);
        段内(宽+0.012,0.004,厚+0.008,匣金,0,-段高/2-0.015,0);
      }
      /* ★ S 形：每段 6 级，每级一发，左右交替 */
      for(var 级i=0;级i<6;级i++){
        var yl=段高/2-(级i+0.5)*(段高/6);
        var xo=((级%2)?1:-1)*0.0068;
        var zo=((级%2)?0.0022:-0.0022);
        var py=累Y-段高/2*Math.cos(角)+yl*Math.cos(角)-zo*Math.sin(角);
        var pz=累Z-段高/2*Math.sin(角)+yl*Math.sin(角)+zo*Math.cos(角);
        弹位.push({x:xo,y:py,z:pz,rx:角});
        级++;
      }
      累Y-=段高*Math.cos(角); 累Z-=段高*Math.sin(角);
    }
    var 壳G=new THREE.CylinderGeometry(0.0034,0.0036,0.024,10);壳G.rotateX(Math.PI/2);
    var 缘G=new THREE.CylinderGeometry(0.0042,0.0042,0.0028,10);缘G.rotateX(Math.PI/2);
    var 头G=new THREE.CylinderGeometry(0.0018,0.0034,0.014,10);头G.rotateX(-Math.PI/2);
    var 总2=弹位.length;
    var 弹壳=new THREE.InstancedMesh(壳G,壳材,总2);
    var 弹缘=new THREE.InstancedMesh(缘G,壳材,总2);
    var 弹头=new THREE.InstancedMesh(头G,头材,总2);
    var _mtx=new THREE.Matrix4(),_q=new THREE.Quaternion(),_e=new THREE.Euler(),_s=new THREE.Vector3(1,1,1),_v=new THREE.Vector3();
    for(var bi=0;bi<总2;bi++){
      var b=弹位[bi];
      _e.set(b.rx,0,0);_q.setFromEuler(_e);_v.set(b.x,b.y,b.z);
      var 基=new THREE.Matrix4().compose(_v,_q,_s);
      弹壳.setMatrixAt(bi,基);
      弹缘.setMatrixAt(bi,new THREE.Matrix4().makeTranslation(0,0,0.0126).premultiply(基));
      弹头.setMatrixAt(bi,new THREE.Matrix4().makeTranslation(0,0,-0.0140).premultiply(基));
    }
    [弹壳,弹缘,弹头].forEach(function(o){
      o.instanceMatrix.needsUpdate=true;
      o.frustumCulled=false;
      o.castShadow=false;o.receiveShadow=false;
      M.add(o);
    });
    /* 托弹板：跟着最上面那摞的下沿走（刷新弹匣子弹 每帧按可见发数摆它） */
    var 托弹板=new THREE.Mesh(new THREE.BoxGeometry(宽-0.004,0.006,厚-0.012),匣钢);
    托弹板.position.set(0,-0.006,0);M.add(托弹板);
    var 托簧=new THREE.Mesh(new THREE.BoxGeometry(宽-0.010,0.0026,厚-0.020),匣暗);
    托簧.position.set(0,-0.012,0);M.add(托簧);
    magGroup.userData.子弹组=[弹壳,弹缘,弹头];
    magGroup.userData.子弹数=总2;
    magGroup.userData.弹位=弹位;
    magGroup.userData.托弹板=托弹板;
    magGroup.userData.托簧=托簧;
  }else{                               // 兜底：标准弹匣
    var m0=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.13,0.05),magMat);m0.position.set(0,-0.10,-0.02);magGroup.add(m0);
  }
  return magGroup;
}

/* 【batch203】按当前弹药量刷新弹匣里露出的子弹 —— 中空弹匣的意义就在这：
   打掉一半再检视，透过观察窗看到的子弹真的少了一半（从下往上留，上面被打空）。
   只对带 userData.子弹 的弹匣生效（纪念枪专属），别的弹匣一行不执行。 */
function 刷新弹匣子弹(mag, n, max){
  if(!mag)return;
  /* 【batch205】instanced 版本：弹位按"从弹匣最上面往下一路排"存，
     所以只画前 N 个实例 = 上面那摞还在、下面先空 —— 正是用户要的"从最下面慢慢消失到最上面"。
     （托弹板在下面把弹药顶上来，真实弹匣就是这个样子。） */
  var 组=(mag.userData&&mag.userData.子弹组)||null;
  var 总=(mag.userData&&mag.userData.子弹数)||0;
  if(组&&组.length&&总>0){
    var 满1=(max>0)?max:总;
    var 可见1=Math.round(Math.max(0,Math.min(1,n/满1))*总);
    for(var k=0;k<组.length;k++){ if(组[k].count!==可见1)组[k].count=可见1; }
    /* 托弹板跟着最上面那摞的下沿上移 —— "从下面一颗一颗往上顶"就靠它看出来 */
    var 位=mag.userData.弹位, 板=mag.userData.托弹板, 簧=mag.userData.托簧;
    if(位&&板&&位.length){
      var 槽=位[Math.min(位.length-1,Math.max(0,可见1))]||位[位.length-1];
      var 底Y=槽.y-0.0055, 底Z=槽.z;
      if(可见1>=总){ 槽=位[总-1]; 底Y=槽.y-0.0055; 底Z=槽.z; }
      板.position.set(0,底Y,底Z); 板.rotation.x=槽.rx;
      if(簧){ 簧.position.set(0,底Y-0.006,底Z); 簧.rotation.x=槽.rx; }
    }
    return;
  }
  var 弹=(mag.userData&&mag.userData.子弹)||null;    // 旧路径（老弹匣才有 .子弹 数组）
  if(!弹||!弹.length)return;
  var 满=(max>0)?max:30;
  var 可见=Math.round(Math.max(0,Math.min(1,n/满))*弹.length);
  for(var i=0;i<弹.length;i++){
    var v=(i<可见);
    if(弹[i].visible!==v)弹[i].visible=v;
  }
}

function buildGunMeshes(group){
  var receiver=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.09,0.28),gMat);receiver.position.set(0,0,0);group.add(receiver);
  var railTop=new THREE.Mesh(new THREE.BoxGeometry(0.035,0.015,0.26),railMat);railTop.position.set(0,0.052,0);group.add(railTop);
  for(var ri=0;ri<5;ri++){var tooth=new THREE.Mesh(new THREE.BoxGeometry(0.038,0.008,0.012),gMatLight);tooth.position.set(0,0.062,-0.10+ri*0.05);group.add(tooth);}
  var handguard=new THREE.Mesh(new THREE.BoxGeometry(0.065,0.07,0.22),gMatLight);handguard.position.set(0,-0.01,-0.24);group.add(handguard);
  for(var si=0;si<3;si++){var slot=new THREE.Mesh(new THREE.BoxGeometry(0.068,0.008,0.03),gMatDark);slot.position.set(0,-0.01+si*0.02-0.02,-0.24);group.add(slot);}
  var fgBase=new THREE.Mesh(new THREE.BoxGeometry(0.035,0.015,0.04),foreGripMat);fgBase.position.set(0,-0.052,-0.22);group.add(fgBase);
  var fgBody=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.07,0.035),foreGripMat);fgBody.position.set(0,-0.095,-0.22);group.add(fgBody);
  var fgCap=new THREE.Mesh(new THREE.CylinderGeometry(0.015,0.015,0.035,6),foreGripMat);fgCap.rotation.z=Math.PI/2;fgCap.position.set(0,-0.13,-0.22);group.add(fgCap);
  var barrel=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.022,0.38,8),gMatDark);barrel.rotation.x=Math.PI/2;barrel.position.set(0,0.01,-0.50);group.add(barrel);
  var muzzle=new THREE.Mesh(new THREE.CylinderGeometry(0.028,0.024,0.06,8),muzzleMat);muzzle.rotation.x=Math.PI/2;muzzle.position.set(0,0.01,-0.72);group.add(muzzle);
  var muzzleSlot=new THREE.Mesh(new THREE.BoxGeometry(0.032,0.006,0.04),gMatLight);muzzleSlot.position.set(0,0.03,-0.72);group.add(muzzleSlot);
  var grip=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.10,0.045),gripMat);grip.position.set(0,-0.08,0.08);grip.rotation.x=0.25;group.add(grip);
  var gripTex=new THREE.Mesh(new THREE.BoxGeometry(0.042,0.06,0.003),gMatLight);gripTex.position.set(0,-0.08,0.08-0.024);gripTex.rotation.x=0.25;group.add(gripTex);
  var stockTube=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.18,6),stockMat);stockTube.rotation.x=Math.PI/2;stockTube.position.set(0,0.01,0.22);group.add(stockTube);
  var stockPad=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.08,0.03),stockMat);stockPad.position.set(0,0,0.32);group.add(stockPad);
  var rubberPad=new THREE.Mesh(new THREE.BoxGeometry(0.048,0.075,0.008),gMatDark);rubberPad.position.set(0,0,0.338);group.add(rubberPad);
  // 瞄准镜（中空薄壁镜筒 + 中间玻璃 + 玻璃上的小十字；镜筒整根不被零件侵入）
  var scopeTube=new THREE.Mesh(new THREE.CylinderGeometry(0.030,0.030,0.125,24,1,true),new THREE.MeshLambertMaterial({color:0x161616,side:THREE.DoubleSide}));scopeTube.rotation.x=Math.PI/2;scopeTube.position.set(0,0.092,-0.074);group.add(scopeTube);
  var scopeRimGeo=new THREE.TorusGeometry(0.0296,0.0020,6,28);
  var scopeRimRear=new THREE.Mesh(scopeRimGeo,gMatLight);scopeRimRear.position.set(0,0.092,-0.0121);group.add(scopeRimRear);
  var scopeRimFront=new THREE.Mesh(scopeRimGeo,gMatLight);scopeRimFront.position.set(0,0.092,-0.1359);group.add(scopeRimFront);
  // 【batch109】镜片必须 depthWrite:false ！！transparent:true 在 THREE 里**默认仍然写深度**，
  // 而镜片贴在相机前 0.06 米 → 它一写深度，所有"比它远"的透明物体（烟雾 / 投掷物 / 各类特效，
  // 它们 renderOrder=900、在镜片之后绘制）深度测试全部失败 → **在镜片窗口里整片消失**。
  // 症状就是用户报的：开镜后"烟雾跟没有一样""战术装备也不见了"（两者都是 transparent 材质）。
  var scopeGlass=new THREE.Mesh(new THREE.CircleGeometry(0.0292,28),new THREE.MeshBasicMaterial({color:0xbfe0ff,transparent:true,opacity:0.18,side:THREE.DoubleSide,depthWrite:false}));scopeGlass.position.set(0,0.092,-0.06);group.add(scopeGlass);
  var _crMat=new THREE.MeshBasicMaterial({color:0x101010,side:THREE.DoubleSide});
  var _crH=new THREE.Mesh(new THREE.PlaneGeometry(0.015,0.0012),_crMat);_crH.position.set(0,0.092,-0.0585);group.add(_crH);
  var _crV=new THREE.Mesh(new THREE.PlaneGeometry(0.0012,0.015),_crMat);_crV.position.set(0,0.092,-0.0585);group.add(_crV);
  var scopeShoe=new THREE.Mesh(new THREE.BoxGeometry(0.026,0.020,0.07),gMatDark);scopeShoe.position.set(0,0.052,-0.06);group.add(scopeShoe);
  buildRightHand(group,new THREE.Vector3(0.04,-0.08,0.08),new THREE.Vector3(0.12,-0.08,0.30));
  _标静态(group);   /* 【batch196】枪身 ~24 件 + 持械手 2 件，按材质最多并成 4~6 个网格 */
}

function buildKnifeMeshes(group){
  var kHandle=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.04,0.14),handleMat);kHandle.position.set(0,0,0.07);group.add(kHandle);
  var guard=new THREE.Mesh(new THREE.BoxGeometry(0.10,0.04,0.02),gMat);guard.position.set(0,0,0);group.add(guard);
  var blade=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.01,0.30),bladeMat);blade.position.set(0,0,-0.16);group.add(blade);
  var edge=new THREE.Mesh(new THREE.BoxGeometry(0.005,0.012,0.28),edgeMat);edge.position.set(0.016,0,-0.16);group.add(edge);
  buildRightHand(group,new THREE.Vector3(0.03,-0.02,0.07),new THREE.Vector3(0.10,-0.06,0.28));
  _标静态(group);
}
/* 【batch196】标记助手：真正实现（标静态 / 合批静态）在 js/11 的贴图文件里。
   js/01 先于 js/11 加载，所以这里必须用 typeof 守卫 —— 缓存了旧分片的机器上
   js/11 可能还没有这个函数，此时就退化成「不合批」，绝不能抛错把刀枪搞失效。 */
function _标静态(g,keep){ try{ if(typeof 标静态==='function')return 标静态(g,keep); }catch(e){} return 0; }
function _合批(g,最少){ try{ if(typeof 合批静态==='function')return 合批静态(g,最少||3); }catch(e){} return null; }

/* ====================================================================================
   【batch203】纪念版步枪「长明」—— 这个游戏做了这么久还在运营的纪念作品
   ------------------------------------------------------------------------------------
   它和别的枪有三处本质区别（也是它唯一的三个特权）：
     ① **有自己的检视动作**（按 I）：抬枪看涂装 → 翻转看另一面 → 侧看弹匣 → 拉栓 → 归位；
     ② **有专属准星**：金色刻线 + 中心暖光点，不是通用四段白线；
     ③ **有真·镜内视野**：开镜时眼睛里塞进一根真实镜筒（几何内壁），
        镜内是窄 FOV 的放大画面，再叠镜片色散 —— 而不是"屏幕上一个圆形遮罩"。
   解锁条件：累积登录 7 天（见文件末尾的「纪念解锁」段）。

   配色：深墨绿枪身 + 暖金刻线（"长明"＝一直亮着的火）。
   铭牌上的字是 canvas 现画的，不引任何外部图片 —— 单文件版也能用。
   ==================================================================================== */
var MEMORIAL_SLOT=-1;                       // 纪念枪槽位号（负数，永远不撞 ModLoader 的 2/3/4…）
function _纪念贴花(w,h,主,副,色){
  var c=document.createElement('canvas');c.width=w;c.height=h;
  var x=c.getContext('2d');
  x.clearRect(0,0,w,h);
  // 底：深墨绿 + 极淡的斜向拉丝
  x.fillStyle='#121915';x.fillRect(0,0,w,h);
  for(var i=0;i<w;i+=3){x.fillStyle='rgba(255,255,255,'+(0.006+(i%9)*0.002)+')';x.fillRect(i,0,1,h);}
  // 金框（双线）
  x.strokeStyle=色;x.lineWidth=3;x.strokeRect(5,5,w-10,h-10);
  x.strokeStyle='rgba(230,196,106,.45)';x.lineWidth=1;x.strokeRect(10,10,w-20,h-20);
  // 主字
  x.fillStyle=色;x.textAlign='center';x.textBaseline='middle';
  x.font='bold '+(h*0.40)+'px "Microsoft YaHei","PingFang SC",sans-serif';
  x.fillText(主,w/2,h*0.42);
  // 副字
  x.fillStyle='rgba(230,196,106,.78)';
  x.font=(h*0.155)+'px "Microsoft YaHei","PingFang SC",sans-serif';
  x.fillText(副,w/2,h*0.76);
  var t=new THREE.CanvasTexture(c);
  try{ t.anisotropy=4; }catch(e){}
  return t;
}
function _建纪念枪(g){
  /* ---- 材质（6 种，合批后每个材质一次绘制）---- */
  /* 【batch204】配色照 D:/建模/模型/步枪_基础.glb 的五种材质来（变量名沿用旧称，颜色已换）：
     枪身金属 #3d424a · 暗件聚合物 #272a30 · 亮钢件 #999fad · 橡胶握把 #1c1d21 · 金饰 #c59946
     —— 参考模型的整体比例也一并吸收：长 0.837 / 高 0.196 / 宽 0.056（不含镜）。 */
  var 墨绿   = new THREE.MeshLambertMaterial({color:0x3d424a,side:THREE.DoubleSide});   // 枪身金属
  var 墨绿深 = new THREE.MeshLambertMaterial({color:0x272a30,side:THREE.DoubleSide});   // 暗件聚合物
  var 金     = new THREE.MeshLambertMaterial({color:0xc59946,side:THREE.DoubleSide});   // 金饰
  var 金亮   = new THREE.MeshBasicMaterial({color:0xe8c877,side:THREE.DoubleSide});     // 亮金（刻线/描边）
  var 钢     = new THREE.MeshLambertMaterial({color:0x999fad,side:THREE.DoubleSide});   // 亮钢件
  var 握把胶 = new THREE.MeshLambertMaterial({color:0x1c1d21,side:THREE.DoubleSide});   // 橡胶握把
  function bx(w,h,d,m,x,y,z,rx,ry,rz){
    var o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);
    o.position.set(x||0,y||0,z||0);
    if(rx)o.rotation.x=rx; if(ry)o.rotation.y=ry; if(rz)o.rotation.z=rz;
    g.add(o);return o;
  }
  function cy(rt,rb,len,m,x,y,z,rx,seg){
    var o=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,len,seg||16),m);
    o.position.set(x||0,y||0,z||0); if(rx)o.rotation.x=rx; g.add(o);return o;
  }
  /* ---- 机匣 ---- */
  bx(0.064,0.056,0.30,墨绿,0,0.020,-0.010);                 // 上机匣
  /* 【batch206】下机匣不再是实心块：中间开一个 8.5cm 的**喂弹口**，
     弹匣从下面插上来，最上面那发弹就露在口里、正对抛壳窗 —— 这就是"弹匣跟抛弹口连在一起"。
     做法 = 两片侧板 + 前后两个实心段 + 顶部一层地板，中间留空。 */
  bx(0.006,0.050,0.225,墨绿,-0.026,-0.030,-0.020);            // 下机匣·左侧板
  bx(0.006,0.050,0.225,墨绿, 0.026,-0.030,-0.020);            // 下机匣·右侧板
  bx(0.058,0.050,0.022,墨绿,0,-0.030,-0.1215);                 // 下机匣·前段（实心，前移后只剩 2.2cm）
  bx(0.058,0.050,0.103,墨绿,0,-0.030,0.0615);                  // 下机匣·后段（实心，含扳机组）
  bx(0.058,0.013,0.225,墨绿,0,-0.0115,-0.020);                 // 下机匣·顶板（喂弹口的上盖）
  bx(0.052,0.004,0.100,墨绿深,0,-0.0545,-0.062);               // 喂弹口下唇（前移，对齐新弹匣位）
  bx(0.062,0.010,0.30,墨绿深,0,-0.004,-0.015);               // 机匣分界线（暗色夹层）
  /* 抛壳窗：不是贴一块暗板糊弄，而是**真凹槽** —— 四周边框凸起、里面一层内凹暗腔、
     腔里能看见枪机框（钢色）。开火时弹壳就是从这里飞出去的（见 js/24 的 抛壳()）。 */
  (function(){
    var 窗Y=0.026, 窗Z=0.026, 窗L=0.088, 窗H=0.030;
    bx(0.005,0.004,窗L+0.010,墨绿深,0.0335,窗Y+窗H/2+0.002,窗Z);      // 上沿
    bx(0.005,0.004,窗L+0.010,墨绿深,0.0335,窗Y-窗H/2-0.002,窗Z);      // 下沿
    bx(0.005,窗H+0.008,0.004,墨绿深,0.0335,窗Y,窗Z+窗L/2+0.002);      // 前沿
    bx(0.005,窗H+0.008,0.004,墨绿深,0.0335,窗Y,窗Z-窗L/2-0.002);      // 后沿
    var 腔=new THREE.Mesh(new THREE.BoxGeometry(0.020,窗H,窗L),
      new THREE.MeshLambertMaterial({color:0x080c0a,side:THREE.BackSide}));
    腔.position.set(0.0270,窗Y,窗Z);g.add(腔);                          // 内凹暗腔（BackSide：看得见的只有墙壁）
    var 机框=bx(0.012,窗H-0.008,0.040,钢,0.0290,窗Y,窗Z-0.012);   // 枪机框（从窗口能看见，随拉栓前后动）
    机框.userData.animPart='bolt';                              // 拉栓时机框跟着一起后退，窗口里看得见
    机框.userData.原位Z=机框.position.z;
    var 挡=new THREE.Mesh(new THREE.BoxGeometry(0.006,0.008,窗L),
      new THREE.MeshLambertMaterial({color:0x3d4643,side:THREE.DoubleSide}));
    挡.position.set(0.0355,窗Y+窗H/2+0.004,窗Z);挡.rotation.z=-0.35;g.add(挡);   // 抛壳挡板（斜着，把壳往外赶）
  })();
  bx(0.030,0.011,0.355,墨绿深,0,0.053,-0.045);               // 顶部皮卡汀尼导轨
  for(var t=0;t<8;t++)bx(0.034,0.008,0.011,墨绿深,0,0.0585,-0.185+t*0.042);   // 导轨齿（压低 1.5mm：齿顶 0.0625 正好齐镜筒内壁下沿，不许探进镜筒）
  /* 弹匣井：四片边框围出来，中间是**空的**（弹匣从中间真穿过去，不是插在一块实心方块里）*/
  (function(){
    /* 【batch206】弹匣井前移 2.6cm（用户："后握把太靠近弹夹了，把弹夹往前移一点"），
       并且**取消井底** —— 井底是一块横板，会挡在弹匣通道里（从下往上看是一块悬空的铁皮）。 */
    var hw=0.031,hd=0.039,井Y=-0.054,井H=0.034,井Z=-0.072;
    bx(0.006,井H,0.078,墨绿深,-hw,井Y,井Z);
    bx(0.006,井H,0.078,墨绿深, hw,井Y,井Z);
    bx(0.062,井H,0.006,墨绿深,0,井Y,井Z-hd);
    bx(0.062,井H,0.006,墨绿深,0,井Y,井Z+hd);
    bx(0.066,0.007,0.082,金,0,-0.038,井Z);                     // 井口金边
  })();
  /* ---- 护木（M-LOK 开孔 + 侧导轨）----
     【batch207】用户圈出护木前端："这里没有接上枪管"。
     真因不是缺零件，而是**几何对不齐**：枪管轴在 y=0.012、半径 0.0155（顶到 0.0275），
     而护木箱体中心在 y=-0.006、只到 0.023 —— 枪管顶面比护木还高 4.5mm，
     等于一根管子从盒子的上沿"擦"出去，看起来当然是两截。
     修法：护木整体上抬 7mm（中心 y=0.001，高 62mm）让枪管从截面中间穿出；
     再加三件真枪上就有的连接件：**前端盖（带枪管孔）+ 枪管螺母 + 导气箍**。 */
  bx(0.060,0.062,0.265,墨绿,0,0.001,-0.272);
  bx(0.062,0.012,0.265,墨绿深,0,0.031,-0.272);               // 护木上沿
  for(var s=0;s<5;s++){                                      // 两侧 M-LOK 长孔
    bx(0.004,0.014,0.030,墨绿深,0.0300,0.002,-0.170-s*0.048);
    bx(0.004,0.014,0.030,墨绿深,-0.0300,0.002,-0.170-s*0.048);
  }
  bx(0.008,0.013,0.090,墨绿深,0.0320,0.016,-0.250);          // 右侧战术导轨
  bx(0.008,0.013,0.090,墨绿深,-0.0320,0.016,-0.250);         // 左侧战术导轨
  /* 护木前端：端盖（中间挖一个枪管孔）+ 枪管螺母 + 导气箍 */
  (function(){
    var 半W=0.030, 半H=0.031;
    var sh=new THREE.Shape();
    sh.moveTo(-半W,-半H); sh.lineTo(半W,-半H); sh.lineTo(半W,半H); sh.lineTo(-半W,半H); sh.lineTo(-半W,-半H);
    var 孔=new THREE.Path();
    孔.absarc(0, 0.011, 0.0175, 0, Math.PI*2, true);          // 孔心对着枪管轴
    sh.holes.push(孔);
    var 盖=new THREE.Mesh(new THREE.ShapeGeometry(sh,18),
      new THREE.MeshLambertMaterial({color:0x272a30,side:THREE.DoubleSide}));
    盖.position.set(0,0.001,-0.4045);g.add(盖);
    /* 枪管螺母：端盖外面那圈钢箍（带 8 个缺口，真枪上就是用扳手卡这圈）*/
    var 母=new THREE.Mesh(new THREE.CylinderGeometry(0.0208,0.0208,0.018,20,1,true),钢);
    母.rotation.x=Math.PI/2;母.position.set(0,0.012,-0.4140);g.add(母);
    for(var n=0;n<8;n++){
      var a=n*Math.PI/4+0.39;
      var 缺=new THREE.Mesh(new THREE.BoxGeometry(0.0042,0.0042,0.018),墨绿深);
      缺.position.set(Math.cos(a)*0.0198,0.012+Math.sin(a)*0.0198,-0.4140);缺.rotation.z=a;g.add(缺);
    }
    var 母环=new THREE.Mesh(new THREE.TorusGeometry(0.0208,0.0016,6,20),金);
    母环.position.set(0,0.012,-0.4055);g.add(母环);
    /* 导气箍：卡在枪管上、正好压在端盖前面（这根管子从此"有根"了）*/
    var 箍=new THREE.Mesh(new THREE.BoxGeometry(0.025,0.026,0.019),墨绿深);
    箍.position.set(0,0.0255,-0.4310);g.add(箍);
    var 箍金=new THREE.Mesh(new THREE.BoxGeometry(0.026,0.0035,0.021),金);
    箍金.position.set(0,0.0125,-0.4310);g.add(箍金);
    var 气管=new THREE.Mesh(new THREE.CylinderGeometry(0.0038,0.0038,0.026,10),钢);
    气管.rotation.x=Math.PI/2;气管.position.set(0,0.0360,-0.4200);g.add(气管);
  })();
  /* ---- 枪管：**真的能看见膛** ----
     【batch205】用户："看不见枪管内部"。
     上一版是"内膛用 BackSide 黑筒"，问题在于筒两端都开着 —— 从枪口斜着看进去，
     只能看到一段被光打亮的筒壁，读不出"深洞"，也没有尽头。
     现在三件事一起做：
       ① 内膛加**封底**（z=-0.30 一片纯黑圆片）→ 视线一定被截住，永远是黑的；
       ② 枪口做**45° 内倒角（crown）**，倒角用比枪身亮的钢色 —— 有一圈亮边，那个黑圆才看得出是"洞"；
       ③ 膛线从 4 道加到 6 道，并且贴着膛壁（半径 0.0080），从枪口能看出螺旋的走向。
     消焰器改成**鸟笼式**：6 根竖条围成笼，条间是真通缝，前口一圈钢环 —— 不再是三大片怪东西。 */
  (function(){
    var 口Y=0.012;
    var 钢暗=new THREE.MeshLambertMaterial({color:0x333c39,side:THREE.DoubleSide});
    var 钢亮=new THREE.MeshLambertMaterial({color:0x5d6663,side:THREE.DoubleSide});
    var 膛材=new THREE.MeshLambertMaterial({color:0x050706,side:THREE.BackSide});
    var 外管=new THREE.Mesh(new THREE.CylinderGeometry(0.0135,0.0155,0.365,18,1,true),钢暗);
    外管.rotation.x=Math.PI/2;外管.position.set(0,口Y,-0.470);g.add(外管);
    /* 内膛：内径 8.6mm，后端封死 */
    var 膛=new THREE.Mesh(new THREE.CylinderGeometry(0.0086,0.0086,0.335,18,1,true),膛材);
    膛.rotation.x=Math.PI/2;膛.position.set(0,口Y,-0.485);g.add(膛);
    var 膛底=new THREE.Mesh(new THREE.CircleGeometry(0.0086,18),
      new THREE.MeshBasicMaterial({color:0x000000,side:THREE.DoubleSide}));
    膛底.position.set(0,口Y,-0.318);g.add(膛底);
    /* 枪口端面 + 内倒角 */
    var 口环=new THREE.Mesh(new THREE.RingGeometry(0.0086,0.0135,20,1),钢亮);
    口环.position.set(0,口Y,-0.6525);g.add(口环);
    var 倒角=new THREE.Mesh(new THREE.CylinderGeometry(0.0086,0.0119,0.007,20,1,true),钢亮);
    倒角.rotation.x=Math.PI/2;倒角.position.set(0,口Y,-0.6492);g.add(倒角);
    /* 六道膛线 */
    for(var 线=0;线<6;线++){
      var a=线*Math.PI/3;
      var 筋=new THREE.Mesh(new THREE.BoxGeometry(0.0014,0.0016,0.315),new THREE.MeshLambertMaterial({color:0x1b2220,side:THREE.DoubleSide}));
      筋.position.set(Math.cos(a)*0.0080,口Y+Math.sin(a)*0.0080,-0.482);
      筋.rotation.z=a;g.add(筋);
    }
    /* 消焰器后颈（把 20mm 的笼子接到 13.5mm 的枪管上）*/
    var 颈=new THREE.Mesh(new THREE.CylinderGeometry(0.0136,0.0192,0.014,18,1,true),钢暗);
    颈.rotation.x=Math.PI/2;颈.position.set(0,口Y,-0.639);g.add(颈);
    /* 鸟笼：6 根竖条（条间是真通缝，能看见里面的枪管）*/
    for(var q=0;q<6;q++){
      var aq=q*Math.PI/3+0.26;
      var 条=new THREE.Mesh(new THREE.BoxGeometry(0.0112,0.0034,0.046),钢暗);
      条.position.set(Math.cos(aq)*0.0178,口Y+Math.sin(aq)*0.0178,-0.665);
      条.rotation.z=aq;g.add(条);
    }
    var 前环=new THREE.Mesh(new THREE.TorusGeometry(0.0190,0.0026,6,24),钢亮);
    前环.position.set(0,口Y,-0.6875);g.add(前环);
    var 后环=new THREE.Mesh(new THREE.TorusGeometry(0.0190,0.0022,6,24),钢暗);
    后环.position.set(0,口Y,-0.6425);g.add(后环);
    /* 笼子内壁再补一小段黑膛，避免从侧面缝隙看穿 */
    var 内膛2=new THREE.Mesh(new THREE.CylinderGeometry(0.0102,0.0102,0.048,14,1,true),
      new THREE.MeshLambertMaterial({color:0x0a0e0c,side:THREE.BackSide}));
    内膛2.rotation.x=Math.PI/2;内膛2.position.set(0,口Y,-0.663);g.add(内膛2);
  })();
  /* ---- 前握把 / 后握把 / 扳机组 ----
     【batch205】用户："后握把太小了、朝向也不对、还没有扳机" —— 三条都是真的：
       ① 太小：原来是 40×98×52mm 的一块，还没弹匣宽。现在主体 46×112×56，后面再加掌托；
       ② 朝向反了：原来 rotation.x=+0.34。绕 +x 正转会把握把**下端推向枪口**（看着往前撇），
          真枪是下端朝后 → 角度必须取负（-0.30）；
       ③ 没扳机：原来那块 8×20mm 的扳机整个埋在下机匣里（下机匣 y 到 -0.055），外面一点都看不见。
          现在护圈、扳机、扳机保险片全挂在下机匣**下面**，从侧面一眼就能看见。 */
  bx(0.030,0.080,0.034,握把胶,0,-0.062,-0.216,0.20);        // 前握把
  bx(0.032,0.012,0.036,金,0,-0.028,-0.212,0.20);             // 前握把金环
  (function(){
    /* 后握把：整组绕自身中心后倾 0.30 rad，所以零件都挂在 握 这个 Group 下 */
    var 握=new THREE.Group();
    握.position.set(0,-0.106,0.100);握.rotation.x=-0.30;g.add(握);
    function 握件(w,h,d,m,x,y,z){var o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);握.add(o);return o;}
    握件(0.046,0.112,0.054,握把胶,0,0,0);                    // 主体
    握件(0.048,0.074,0.020,握把胶,0,-0.012,0.033);           // 掌托（后面鼓起来那块）
    握件(0.050,0.016,0.058,墨绿深,0,0.050,0.002);            // 与机匣相接的颈部
    握件(0.044,0.010,0.014,金,0,0.030,-0.026);               // 颈部金线
    握件(0.048,0.012,0.056,墨绿深,0,-0.050,0.001);           // 底盖
    握件(0.049,0.004,0.058,金,0,-0.0575,0.001);              // 底盖金线
    for(var hI=0;hI<3;hI++)握件(0.047,0.007,0.009,墨绿深,0,-0.004-hI*0.015,-0.0275);  // 指槽
    握件(0.049,0.030,0.004,握把胶,0,0.020,0.0435);           // 掌托上缘（贴虎口）
  })();
  /* 扳机护圈：前立柱 + 底梁 + 后立柱，围出一个真正的 U 形（全部在机匣下方可见）*/
  bx(0.010,0.030,0.010,墨绿深,0,-0.070,0.010);
  bx(0.010,0.008,0.048,墨绿深,0,-0.0855,0.032);
  bx(0.010,0.026,0.010,墨绿深,0,-0.073,0.055);
  /* 扳机：两段斜接的弧形刀片 + 中间那道扳机保险片 */
  bx(0.008,0.019,0.007,钢,0,-0.0655,0.0315,0.24);
  bx(0.007,0.013,0.006,钢,0,-0.0775,0.0355,0.62);
  bx(0.0034,0.015,0.004,墨绿深,0,-0.0675,0.0292,0.24);
  /* 弹匣释放钮（右侧，面朝 +x）+ 左侧空仓挂机柄 */
  (function(){
    var 钮=new THREE.Mesh(new THREE.CylinderGeometry(0.0048,0.0048,0.007,14),金);
    钮.rotation.z=Math.PI/2;钮.position.set(0.0312,-0.0470,-0.040);g.add(钮);   // 跟弹匣井一起前移
    bx(0.006,0.012,0.026,墨绿深,-0.0312,-0.032,-0.044);      // 左侧空仓挂机柄（前移）
    bx(0.007,0.005,0.010,钢,0.0312,-0.028,0.004);
  })();
  /* ---- 枪托 ---- */
  cy(0.020,0.020,0.120,墨绿深,0,0.010,0.205,Math.PI/2,12);   // 缓冲管
  bx(0.048,0.064,0.135,墨绿,0,0.004,0.285);                  // 托身
  bx(0.042,0.020,0.145,墨绿深,0,0.044,0.280);                // 托腮板
  bx(0.050,0.072,0.020,握把胶,0,0.000,0.358);                // 缓冲垫
  bx(0.050,0.008,0.020,金,0,0.038,0.358);                    // 缓冲垫金边
  bx(0.006,0.040,0.030,墨绿深,0.026,0.000,0.230);            // 托身镂空（右）
  bx(0.006,0.040,0.030,墨绿深,-0.026,0.000,0.230);           // 托身镂空（左）
  /* ---- 金色刻线（这条线是整个皮肤的灵魂：从机匣一路拉到护木）---- */
  bx(0.0025,0.006,0.265,金亮,0.0330,0.038,-0.030);
  bx(0.0025,0.006,0.265,金亮,-0.0330,0.038,-0.030);
  bx(0.0025,0.005,0.230,金亮,0.0305,0.020,-0.272);
  bx(0.0025,0.005,0.230,金亮,-0.0305,0.020,-0.272);
  /* ---- 纪念铭牌（左右各一块；canvas 现画，不引图片）---- */
  var 贴图=_纪念贴花(384,144,'长 明','感谢您这么久的陪伴','#e6c46a');
  var 铭牌材=new THREE.MeshBasicMaterial({map:贴图,transparent:true,side:THREE.DoubleSide,depthWrite:false});
  var 铭牌=new THREE.Mesh(new THREE.PlaneGeometry(0.098,0.037),铭牌材);
  铭牌.position.set(0.0332,-0.006,0.010);铭牌.rotation.y=-Math.PI/2;铭牌.renderOrder=880;
  铭牌.userData.animPart='plaque';g.add(铭牌);
  var 铭牌2=铭牌.clone();铭牌2.material=铭牌材;铭牌2.position.set(-0.0332,-0.006,0.010);铭牌2.rotation.y=Math.PI/2;
  铭牌2.scale.x=-1;   /* 文字镜像修正：左侧这块绕 y 转 +90° 后 UV 是反的 */铭牌2.userData.animPart='plaque';g.add(铭牌2);
  /* ---- 拉机柄（检视/换弹的拉栓动作要单独动它，所以标记 animPart）---- */
  var 拉栓=新的拉机柄组();拉栓.userData.animPart='charging';g.add(拉栓);
  function 新的拉机柄组(){
    var gg=new THREE.Group();
    /* 拉机柄做粗一点、带滚花，检视/换弹时左手要真的抓住它（见 js/24 的 _拉机柄动 / _手去抓栓） */
    var 杆=new THREE.Mesh(new THREE.BoxGeometry(0.034,0.011,0.011),钢);杆.position.set(0.031,0.036,0.062);gg.add(杆);
    var 颈=new THREE.Mesh(new THREE.CylinderGeometry(0.0075,0.0075,0.012,10),钢);颈.rotation.z=Math.PI/2;颈.position.set(0.043,0.036,0.062);gg.add(颈);
    var 头=new THREE.Mesh(new THREE.CylinderGeometry(0.0110,0.0110,0.014,14),金);头.rotation.z=Math.PI/2;头.position.set(0.052,0.036,0.062);gg.add(头);
    for(var 纹=0;纹<3;纹++){                                   // 滚花三道
      var t2=new THREE.Mesh(new THREE.TorusGeometry(0.0110,0.0009,5,14),金亮);
      t2.rotation.y=Math.PI/2;t2.position.set(0.048+纹*0.004,0.036,0.062);gg.add(t2);
    }
    var 端=new THREE.Mesh(new THREE.CircleGeometry(0.0110,14),金亮);
    端.rotation.y=Math.PI/2;端.position.set(0.0592,0.036,0.062);gg.add(端);
    /* 左手抓握点（枪本地坐标）：js/24 直接读它，别在那边写死数字 */
    gg.userData.握点={x:0.056,y:0.034,z:0.062};
    return gg;
  }
  /* ---- 瞄准镜：真的装在导轨上的高级光学件 ----
     ⚠️ 这里**一个件都不标 scope**。用户明确要求："瞄准镜就安装在枪上，开镜不会删除任何组件，
        就像初始枪械一样，只是它的瞄准镜更高级。"
        开镜靠的不是"藏枪 + 屏幕上画个圆"，而是把整把枪推到眼前（aimPos.z 只有 -0.21）：
        目镜口离眼睛 0.20 米，镜筒内壁、物镜圈、目镜玻璃上的分划全是真几何 → 自然框出镜内视野。
     结构（从后往前）：目镜筒(带金圈) → 中段(防滑纹) → 物镜筒(口径最大) → 物镜玻璃；
     另有两个调节塔（顶部高低 / 右侧风偏）、两道抱箍 + 螺栓、左侧快拆杆、镜座。 */
  /* ⚠️ 镜件直接挂在 g 上（不套一层 Group）：这样 rebuildWeaponModel 末尾的 _合批 才吃得到它们，
     同材质会并成几个网格（30 多件 → 5 个 draw call）。合批只影响"怎么画"，不影响"在不在"。 */
  var 镜组=g;
  var _镜首=g.children.length;                        /* 【batch213】镜件第一件的下标，末尾整组后移要用 */
  var 镜外材=new THREE.MeshLambertMaterial({color:0x1b2420,side:THREE.DoubleSide});
  var 镜内材=new THREE.MeshLambertMaterial({color:0x161e1a,side:THREE.DoubleSide});
  function 筒(rt,rb,len,m,y,z,seg){
    var o=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,len,seg||24,1,true),m);
    o.rotation.x=Math.PI/2;o.position.set(0,y,z);镜组.add(o);return o;
  }
  function 环(r,管,m,y,z,seg){
    var o=new THREE.Mesh(new THREE.TorusGeometry(r,管,6,seg||28),m);
    o.position.set(0,y,z);镜组.add(o);return o;
  }
  /* 【batch214】光轴高度。用户："瞄准镜要贴着枪啊，为什么要架两个架子上来？"
     ── 为什么会架起来 ──
     为了让"枪口不出现在镜内下沿"，我之前一路把光轴从 0.092 抬到 0.125 ——
     管底离导轨 2.4cm，只能靠两块高座子撑着，看着就是"镜子被架在枪上"。
     ── 现在 ──
     光轴压回 0.108：物镜外径 0.0318 → 管底 0.0762，导轨顶面 0.0625，只差 1.4cm，
     抱箍下面垫一块 8mm 厚的夹座就够了（真枪的镜环也就这个高度）。
     ⚠️ 代价：光轴越低，枪口离瞄线越近，能开的孔径越小（详见下面的口径注释）。 */
  var 轴Y=0.1080;
  /* 【batch209/210】镜内可视范围 —— 两次实测的结论
     ── 原始问题（batch208）──
     从眼睛往上扫射线：3.35° 处就被挡住，挡它的是**遮光罩前口**（内径 0.0260，而且越往前越细）；
     屏幕上的亮圈只有 27.5% 屏高。而且 shader 按 r=0.0295（目镜外口径）算出来的光学圆是 0.603，
     比真实几何孔大一倍多 —— 色散/暗角全糊在黑色管壁上了。
     ── batch209 走错的一步 ──
     把眼距从 0.20 拉到 0.145 来放大孔径：亮圈是变大了（39%），但整根镜筒在屏幕上同时变大，
     **黑筒遮住的屏高从 58% 涨到 76%** → 观感反而是"能看到的画面变小了"。
     ── 现在的做法（batch210）──
     ① 眼距退回 0.230（aimPos.z=-0.2150）→ 黑筒轮廓（前抱箍 0.0451）恢复到原来的 6.8°；
     ② 视野改从**物镜口径**要：物镜内壁 0.0320→0.0340、中段 0.0302→0.0315，
        遮光罩扩成喇叭口（0.0400 前口，不再是孔径的一环）；
     ③ 取消 阑1（它就是 batch206 为挡枪管加的那道收口，现在孔径由物镜前口决定，
        挡枪管改由"镜桥抬高"负责）。
     结果：孔径角 3.35°→4.79°、亮圈 27.5%→39.4% 屏高，而黑筒尺寸**一点没变大**。 */
  筒(0.0312,0.0312,0.050,镜外材,轴Y,-0.040,26);
  筒(0.0300,0.0300,0.046,镜内材,轴Y,-0.040,26);       // 内壁（BackSide? 用 DoubleSide 免得单面消失）
  环(0.0312,0.0028,金,轴Y,-0.0150);                    // 目镜金圈（后口）
  环(0.0314,0.0016,墨绿深,轴Y,-0.0640);                // 目镜段前端的收口环
  /* 中段（细一点，带防滑滚花）*/
  筒(0.0315,0.0315,0.055,镜外材,轴Y,-0.094,22);
  环(0.0306,0.0015,墨绿深,轴Y,-0.0790);
  环(0.0306,0.0015,墨绿深,轴Y,-0.1090);
  /* 物镜段（口径最大，正对目标）*/
  筒(0.0318,0.0306,0.056,镜外材,轴Y,-0.1500,28);
  筒(0.0290,0.0271,0.052,镜内材,轴Y,-0.1500,28);
  环(0.0318,0.0028,金,轴Y,-0.1775);                    // 物镜金圈（前口）
  环(0.0311,0.0015,钢,轴Y,-0.1245);
  /* 【batch206】物镜遮光罩：往前伸出的黑色喇叭口。
     【batch209】改成**真的外扩**（原来 0.0288→0.0272 越往前越细，等于又给镜头加了一圈光圈，
     把可视范围压到 27.5% 屏高）。现在从物镜外径 0.0342 一路扩到 0.0404，
     前口内径 0.0394 —— 不再是孔径的一环，纯粹挡杂光 + 美化正面。
     顺带：它仍然挡住"斜下看见枪管"的那条视线（枪管顶面 y=0.0275，光轴 y=0.092）。 */
  (function(){
    var 罩=new THREE.Mesh(new THREE.CylinderGeometry(0.0320,0.0362,0.046,26,1,true),镜外材);
    罩.rotation.x=Math.PI/2;罩.position.set(0,轴Y,-0.2005);镜组.add(罩);
    var 罩内=new THREE.Mesh(new THREE.CylinderGeometry(0.0312,0.0352,0.045,24,1,true),
      new THREE.MeshBasicMaterial({color:0x0a0e0c,side:THREE.BackSide}));
    罩内.rotation.x=Math.PI/2;罩内.position.set(0,轴Y,-0.2005);镜组.add(罩内);
    var 罩口=new THREE.Mesh(new THREE.TorusGeometry(0.0362,0.0016,6,26),金);
    罩口.position.set(0,轴Y,-0.2235);镜组.add(罩口);
    var 罩根=new THREE.Mesh(new THREE.TorusGeometry(0.0318,0.0015,6,26),镜外材);
    罩根.position.set(0,轴Y,-0.1790);镜组.add(罩根);
  })();
  /* 三道消光螺纹（开镜时看进去的纵深全靠它）*/
  for(var 螺=0;螺<3;螺++)环(0.0300,0.0007,镜内材,轴Y,-0.132-螺*0.014,24);
  /* 调节塔：顶部高低、右侧风偏（滚花环 + 顶盖）*/
  (function(){
    var t1=new THREE.Mesh(new THREE.CylinderGeometry(0.0125,0.0125,0.020,16),镜外材);
    t1.position.set(0,轴Y+0.040,-0.094);镜组.add(t1);
    var t2=new THREE.Mesh(new THREE.CylinderGeometry(0.0132,0.0132,0.004,16),金);
    t2.position.set(0,轴Y+0.050,-0.094);镜组.add(t2);
    var t3=new THREE.Mesh(new THREE.CylinderGeometry(0.0135,0.0135,0.005,16),墨绿深);
    t3.position.set(0,轴Y+0.030,-0.094);镜组.add(t3);   // 塔底垫圈
    var s1=new THREE.Mesh(new THREE.CylinderGeometry(0.0120,0.0120,0.018,16),镜外材);
    s1.rotation.z=Math.PI/2;s1.position.set(0.036,轴Y,-0.094);镜组.add(s1);
    var s2=new THREE.Mesh(new THREE.CylinderGeometry(0.0128,0.0128,0.004,16),金);
    s2.rotation.z=Math.PI/2;s2.position.set(0.046,轴Y,-0.094);镜组.add(s2);
  })();
  /* 两道抱箍 + 镜桥（【batch213】整个重做）
     ── 原来哪里不对（用户：瞄准镜跟枪械的连接并不正常）──
     抱箍下面是两根 16×16mm 的细立柱，底下再垫一块 9cm 长的底板；
     可底板的 z 只到 −0.050，而**后抱箍在 −0.040 —— 后立柱整个挂在底板外面**，
     两块夹座又都埋进导轨里。从侧面看就是"镜筒被两根牙签架在枪上"，后脚还是悬空的。
     ── 现在 ──
     每个抱箍下面是一整块**实心镜桥**：从导轨顶面(0.0625)一直填到抱箍下沿，26mm 宽 / 24mm 深；
     镜桥下面是压导轨的夹座（带一道金色垫条）+ 两侧贯通锁紧螺栓。
     两块镜桥各自独立压在导轨上，后一块再挂一根快拆杆 —— 侧面看是"两个座 + 一根镜筒"。
     ⚠️ 抱箍必须是**环**（torus）：方板高度超过筒径就会从筒顶穿出来。
     ⚠️ 镜桥顶**不许高过镜筒内壁**（【batch205】那块"镜中突起"就是座顶凸进筒里）。 */
  for(var 箍=0;箍<2;箍++){
    /* 【batch214】后抱箍从 −0.040 挪到 −0.050：它离眼睛最近，原来在 9.1° 处顶着，
       比目镜口本身（7.6°）还大 —— 镜内那圈黑边主要是它撑出来的。挪进去就藏到目镜口后面了。 */
    var zc=(箍===0)?-0.1500:-0.0500;
    var 箍R=(箍===0)?0.0328:0.0320;                 /* 按该处镜筒外径给的，贴着筒壁 */
    环(箍R+0.0020,0.0032,墨绿深,轴Y,zc,26);                      // 环形抱箍（套在筒外，薄一点：厚了会在镜内变成一圈黑边）
    /* 环形抱箍下面垫的短座：从导轨顶面(0.0625)填到抱箍下沿。
       【batch214】以前这里是 26×24×32mm 的"实心镜桥"——因为光轴被抬到 0.125，
       不架那么高就够不到镜筒。光轴压回 0.108 之后这段只有 8mm，就是一付正常的镜环座。 */
    var 桥底=0.0625, 桥顶=轴Y-箍R+0.002;
    var 桥高=Math.max(0.006,桥顶-桥底);
    var 桥=new THREE.Mesh(new THREE.BoxGeometry(0.028,桥高,0.026),墨绿深);
    桥.position.set(0,桥底+桥高/2,zc);镜组.add(桥);
    /* 压在导轨上的夹具（下面一道金垫条，是这个涂装的收尾色） */
    var 夹=new THREE.Mesh(new THREE.BoxGeometry(0.032,0.012,0.030),墨绿深);
    夹.position.set(0,0.0568,zc);镜组.add(夹);
    var 夹金=new THREE.Mesh(new THREE.BoxGeometry(0.034,0.003,0.032),金);
    夹金.position.set(0,0.0502,zc);镜组.add(夹金);
    /* ⚠️ 抱箍上**不装外露螺栓**。踩过两次坑：
       ① 40mm 长的"贯穿螺栓"横放在 x=±箍R*0.5 → 整根从镜筒内孔穿过去，
          开镜时镜内正下方横着一根钢柱（实测把下视野从 5.2° 压到 3.35°）；
       ② 改成两侧短螺栓后，因为目镜离眼睛只有 21cm，它们会在屏幕左右边缘
          变成两个悬空的灰色圆头 —— 开镜画面里非常碍眼。
       真实的镜环螺栓都在抱箍的**上下夹缝**里、被镜筒挡住，本来就不该看得见。 */
  }
  /* 快拆杆：挂在后一块镜桥右侧（真正用来收放镜子的那根杆） */
  var 快拆=new THREE.Mesh(new THREE.BoxGeometry(0.006,0.006,0.056),金);
  快拆.position.set(0.026,0.050,-0.040);镜组.add(快拆);
  var 快拆柄=new THREE.Mesh(new THREE.BoxGeometry(0.010,0.008,0.024),金亮);
  快拆柄.position.set(0.026,0.050,-0.008);镜组.add(快拆柄);
  /* 物镜玻璃（淡蓝镀膜，边缘浓中间透）*/
  /* 【batch206】镜内光阑：在物镜内侧加一圈黑色挡圈收口，挡住"斜下扫到枪管"的视线。
     【batch209】口径从 25.0/25.6 放到 32.0/31.2 —— 原来这两个环才是孔径的真限制
     （25mm @0.379m = 3.78°）。现在它们只是"贴着物镜内壁的一道压圈"，
     不再收窄视野；挡枪管的活由物镜前口 + 遮光罩接手（实测枪管仍在视野外）。 */
  (function(){
    var 阑材=new THREE.MeshBasicMaterial({color:0x0b0f0d,side:THREE.DoubleSide});
    /* 【batch210】原来这里还有一道 阑1（内径 0.0250 @z=-0.169），它是孔径的真限制（3.78°）。
       batch206 加它是为了挡枪管，现在枪管交给"镜桥抬高到 0.120"处理，孔径交给物镜前口（0.0340），
       所以这道收口整个去掉 —— 留着它就等于又把视野压回 25mm。 */
    var 阑2=new THREE.Mesh(new THREE.RingGeometry(0.0300,0.0322,24,1),阑材);
    阑2.position.set(0,轴Y,-0.1050);镜组.add(阑2);
  })();
  (function(){
    var c=document.createElement('canvas');c.width=64;c.height=64;
    var x=c.getContext('2d');
    var gg=x.createRadialGradient(32,32,4,32,32,32);
    gg.addColorStop(0,'rgba(150,205,255,0)');gg.addColorStop(0.72,'rgba(160,210,255,0.02)');
    gg.addColorStop(0.92,'rgba(185,225,255,0.10)');gg.addColorStop(1,'rgba(215,240,255,0.26)');
    x.fillStyle=gg;x.fillRect(0,0,64,64);
    var g2=new THREE.Mesh(new THREE.CircleGeometry(0.0326,30),
      new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false,side:THREE.DoubleSide}));
    g2.position.set(0,轴Y,-0.1768);镜组.add(g2);
  })();
  /* 目镜玻璃：**分划直接画在玻璃上**（真几何，不是屏幕浮层）。
     细金十字四段贯穿 + 中心点 + 下半密位刻度 + 四角斜芒（和腰射的纪念准星同一套视觉语言）。 */
  (function(){
    var c=document.createElement('canvas');c.width=256;c.height=256;
    var x=c.getContext('2d');
    x.strokeStyle='rgba(255,214,138,0.92)';x.lineWidth=2.2;x.lineCap='round';
    var G=20,L=108;
    x.beginPath();
    x.moveTo(128,128-G);x.lineTo(128,128-G-L);
    x.moveTo(128,128+G);x.lineTo(128,128+G+L*0.72);
    x.moveTo(128-G,128);x.lineTo(128-G-L,128);
    x.moveTo(128+G,128);x.lineTo(128+G+L,128);
    x.stroke();
    x.fillStyle='rgba(255,214,138,0.95)';
    x.beginPath();x.arc(128,128,1.8,0,6.29);x.fill();
    x.lineWidth=1.5;
    for(var i=1;i<=4;i++){var yy=128+G+i*18;var w2=(i%2===0)?8:5;
      x.beginPath();x.moveTo(128-w2,yy);x.lineTo(128+w2,yy);x.stroke();}
    x.lineWidth=1.2;x.strokeStyle='rgba(255,214,138,0.55)';
    for(var k2=0;k2<4;k2++){                            // 四角斜芒
      var a=k2*Math.PI/2+Math.PI/4;
      x.beginPath();
      x.moveTo(128+Math.cos(a)*88,128+Math.sin(a)*88);
      x.lineTo(128+Math.cos(a)*106,128+Math.sin(a)*106);
      x.stroke();
    }
    var m=new THREE.Mesh(new THREE.CircleGeometry(0.0242,30),
      new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false,side:THREE.DoubleSide}));
    m.position.set(0,轴Y,-0.1520);镜组.add(m);   /* 【batch206】分划挪到物镜前（原来贴在目镜上，角尺寸大得离谱，还把镜筒下沿的枪管衬出来）*/
  })();
  /* 【已删】原来这里装过一个无框红点小瞄具，用户说主镜已经是二倍镜、上面再挂个红点多余 → 去掉。 */
  /* 给 js/24 报"镜口几何"：开镜时按这个算镜筒在屏幕上的半径。
     【batch209】以前只报 r=0.0295（目镜外口径）—— 但真正决定"能看到多大一圈"的是
     **最窄的那道孔**（物镜内壁 0.0320 @0.336m → 半角 5.45°），当时没人算这条链，
     于是 shader 画的圆（0.603 半屏高）比真实孔径（0.275）大一倍多。
     现在直接把实测半角报出来：`角`（弧度，在 距设 的眼距下量的）+ 量它时的眼距。
     js/24 按 tan(角)×(距设/当前距)/半Fov 算 R，几何和光学永远对得上。 */
  /* 【batch214】孔径 = 物镜内壁前口 0.0271 @（眼距+0.136）→ 4.2°。
     ⚠️ 为什么不能再大：光轴在 0.108 时，枪口（顶面 y=0.0336、距眼 0.92m）只有 4.6° ——
        孔径一旦超过它，镜内下沿就会露出消焰器（batch206 那个"突起"就是这么来的）。
        想把视野做回 5.2°，只能把枪管缩短（让枪口退到视锥外）或把光轴再抬回去。 */
  g.userData._镜口={y:轴Y,z:0.0250,r:0.0271,角:0.0733,距设:0.208};
  /* 【batch213】整组镜件后移 4cm（用户：瞄准镜可以更靠近人物一点）。
     逐个改 30 多个 z 常量太容易漏，所以记下"镜件第一件"的下标，在这里一次性平移。
     后移之后目镜落在拉机柄后面一点（真枪就是这个位置），配合 aimPos 的补偿，
     开镜时眼距从 0.230 收到 0.210 —— 镜子离眼睛更近一点。 */
  for(var _zi=_镜首;_zi<g.children.length;_zi++){ g.children[_zi].position.z+=0.040; }
  /* ---- 持枪手 ---- */
  /* ---- 持枪手：装进单独的 Group（预览页要能把"模型"和"手"分开看；游戏里行为不变）---- */
  var 手组=new THREE.Group();
  buildRightHand(手组,new THREE.Vector3(0.040,-0.075,0.080),new THREE.Vector3(0.120,-0.075,0.300));
  g.add(手组);g.userData._右手=手组;
  /* 合批：把以上 ~60 件按材质并成 6~8 个网格。
     ⚠️ 镜件(scope)、拉栓与铭牌(animPart) 会被自动排除 —— 见 js/11。 */
  _标静态(g);
  g.userData._纪念枪=1;
}
/* ---------------- 纪念枪 def（数值 + 三项特权开关）---------------- */
BUILTIN_GUNS[MEMORIAL_SLOT]={
  name:'长明 · 纪念版', icon:'🕯️', note:'纪念 · 累积登录 7 天解锁',
  damage:1.18, magSize:30, fireRate:64, reloadTime:2400, recoilMul:0.94,
  range:95, pellets:1, spread:0.016, auto:true,
  /* 开镜：adsFov=26 ≈ 2.9 倍（75/26）；scopeView 打开镜内的光学处理（色散/边缘柔化）。
     【batch209】原来 24（3.1 倍），视野偏窄 → 放到 26，配合镜口放大。
     ⚠️ 这里**没有 scope:true** —— scope 是"开镜时把这件藏起来"的标记（给那些会被镜筒挡住的件用的），
        纪念枪的镜筒本身就是镜内视野，藏了就没得看了。 */
  adsFov:24, adsSpreadKeep:0, scopeView:true, reticle:'memorial',
  /* 三项特权 */
  inspect:true, premiumReload:true, memorial:true,
  /* 【batch207】弹匣前移 3.2cm（-0.014 → -0.072）。
     ⚠️ 上一轮我按 magType:'rifle' 去替换这一行，但这里是 'memorial' —— 替换静默没生效，
     所以你说"还是很近"是对的：弹匣一直还在原位，而且尾端 0.021 正好压在扳机护圈（z=0.010）上。 */
  magType:'memorial', magPos:{x:0,y:-0.052,z:-0.072},
  gripPos:{x:0.180,y:-0.228,z:-0.442},       // 腰射持握（比步枪略微贴脸：纪念枪更长）
  /* 开镜：整把枪推到眼前，目镜后口（局部 z=-0.015）离眼睛 **0.145** 米 → 镜筒内壁自然框住视野。
     【batch209】原来是 -0.215（眼距 0.20 米），镜口在屏幕上被推得太小 ——
     眼距拉到 14.5cm（真人眼距 7~9cm 的量级）之后同一个孔径的角尺寸大了三成多。
     y=-0.092 是把光轴(局部 y=0.092)压到眼睛高度；x=0 让光轴正对屏幕中心。 */
  aimPos:{x:0,y:-0.108,z:-0.2330},
  lhPos:{x:-0.045,y:-0.100,z:-0.235},        // 左手托护木
  build:_建纪念枪
};
/* ==================== 纪念解锁：累积登录 7 天 ====================
   —— 为什么按"自然日"算而不是按"在线时长"：
      这是给"这么久还在"的人留的东西，衡量标准应该是"还愿意每天来看看"，
      不是"这次坐了多久"。同一天开十次也只算一天（按本地日期去重）。
   —— 存储 key 带版本号，将来改规则不会读坏老数据。 */
var 纪念存储键='gunGame.memorial.v1';
var 纪念需要天数=7;
var _纪念缓存=null;
function 纪念读取(){
  if(_纪念缓存)return _纪念缓存;
  var o={days:[],owned:0};
  try{
    var raw=localStorage.getItem(纪念存储键);
    if(raw){
      var m=JSON.parse(raw);
      if(m&&m.days instanceof Array){
        for(var i=0;i<m.days.length;i++){ if(typeof m.days[i]==='string')o.days.push(m.days[i]); }
      }
      if(m&&m.owned)o.owned=+m.owned||1;
    }
  }catch(e){}
  _纪念缓存=o;return o;
}
function 纪念保存(){ try{ localStorage.setItem(纪念存储键,JSON.stringify(_纪念缓存||{days:[],owned:0})); }catch(e){} }
function _今天键(){ var d=new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
function 纪念天数(){ return 纪念读取().days.length; }
function 纪念已解锁(){ return !!(纪念读取().owned||纪念天数()>=纪念需要天数); }
/* 打卡：进游戏调一次。返回 {天数, 新解锁, 今天首次} */
function 纪念打卡(){
  var o=纪念读取(),k=_今天键();
  var 今天首次=false, 新解锁=false;
  if(o.days.indexOf(k)<0){
    o.days.push(k);今天首次=true;
    if(o.days.length>400)o.days.splice(0,o.days.length-400);   // 只留最近 400 天，别把 localStorage 撑爆
    if(o.days.length>=纪念需要天数&&!o.owned){ o.owned=1; 新解锁=true; }
    纪念保存();
  }
  return {天数:o.days.length, 新解锁:新解锁, 今天首次:今天首次};
}
/* 卡片上的锁：每次打开武器选择时重新算（打卡后能立刻变"已解锁"） */
function 纪念刷新锁(){
  var d=BUILTIN_GUNS[MEMORIAL_SLOT];if(!d)return;
  var n=纪念天数(),has=纪念已解锁();
  d.锁=!has;
  d.锁提示=has?'':('累积登录 '+Math.min(n,纪念需要天数)+'/'+纪念需要天数+' 天解锁');
}
/* 持有纪念枪皮（联机感谢横幅的判定条件；换了别的枪也算"拥有"） */
function 纪念拥有(){
  try{ if(纪念已解锁())return true; }catch(e){}
  try{ if(localStorage.getItem('gunGame.memorial.equipped')==='1')return true; }catch(e){}
  return false;
}
function 纪念记住装备(){ try{ localStorage.setItem('gunGame.memorial.equipped','1'); }catch(e){} }
/* ==================== 作者通道：快速解锁（便于测试） ====================
   7 天累积是给玩家看的仪式感，但作者自己测一遍要等一周没法干活，所以留三个后门：
     ① 浏览器地址后面加 ?memorial=1（重进即解锁，最省事）
     ② 控制台敲 纪念解锁()
     ③ 武器面板里连点锁住的纪念卡 7 下 → 输口令「长明」
   ⚠️ 解锁只把 days 补满 7 天、并不绕过判定：走的是和真实打卡完全同一条 纪念已解锁()，
      所以"补满之后到底解不解锁"这件事本身也被验证了（不是硬塞一个 owned=1 骗过 UI）。 */
function 纪念解锁(静默){
  var o=纪念读取(),T=new Date();
  o.days=[];
  for(var i=纪念需要天数-1;i>=0;i--){
    var d=new Date(T.getTime()-i*86400000);
    o.days.push(d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate());
  }
  o.owned=1;
  _纪念缓存=o; 纪念保存(); 纪念刷新锁();
  try{ if(!静默&&typeof showMsg==='function')showMsg('🕯️ 纪念枪「长明」已解锁（作者通道）','#ffd88a'); }catch(e){}
  return 纪念已解锁();
}
/* 地址栏后门：?memorial=1（或 ?纪念=1 / #memorial=1）脚本一加载就解锁，并顺手装备它 ——
   作者点开链接就是"拿着长明"的状态，不用再按 B 选一次。 */
(function(){
  try{
    var 串=String(location.search||'')+'&'+String(location.hash||'');
    if(/memorial=1|纪念=1|解锁纪念/.test(串)){ 纪念解锁(true); 纪念记住装备(); }
  }catch(e){}
})();

function rebuildWeaponModel(){
  /* 【batch197】模型换了 → 让 js/24 的「开镜功能件」缓存失效重建。
     不做这一步的话，换了一把枪之后 cache 里还是老枪的镜身，新枪的镜子就永远不隐藏。 */
  weaponGroup.userData._模型版本=(weaponGroup.userData._模型版本||0)+1;
  weaponGroup.userData._功能件=null;
  for(var i=weaponGroup.children.length-1;i>=0;i--){var c=weaponGroup.children[i];if(c===leftHandAnchor)continue;weaponGroup.remove(c);if(c.geometry)c.geometry.dispose();}
  currentMagMesh=null;
  /* 【batch203】换模型时把上一把枪的纪念标记清掉 —— 不清的话切到别的枪还会走纪念枪的准星/检视。 */
  try{ delete weaponGroup.userData._纪念枪; }catch(e){}
  /* 【batch205】拉机柄 / 枪机的缓存也必须清 —— 不清的话切一次枪，缓存里还指着**上一把枪**已经被
     remove 掉的网格，之后 _拉机柄动 会一直去推一个不在场景里的对象：动作"看着像没做"。 */
  try{ delete weaponGroup.userData._拉栓; delete weaponGroup.userData._枪机; }catch(e){}
  /* 【batch208】右手组的引用同理 —— 不清的话 _右手拉栓 会去动上一把枪残留的手，真手反而不动。 */
  try{ delete weaponGroup.userData._右手; }catch(e){}
  /* 【batch203】上一把枪换弹时掉出去的弹匣挂在场景里，模型都换了它还在半空掉 —— 一并清掉 */
  try{ if(typeof _清掉落==='function')_清掉落(); }catch(e){}
  纪念刷新锁();
  var _isGun=(currentWeapon===WEAPON_GUN);
  var _wd=_isGun?activeGunDef():null;   // 枪：取当前手持枪(def 或 null=内置步枪)；刀：null
  var _wdK=(!_isGun)?curKnifeDef():null;   // 刀：取当前手持刀(def 或 内置战术刀)
  if(_isGun){
    if(_wd&&typeof _wd.build==='function'){ try{ _wd.build(weaponGroup); }catch(e){ buildGunMeshes(weaponGroup); } }
    else { buildGunMeshes(weaponGroup); }
    var _lh=gunLH();leftHandAnchor.position.set(_lh.x,_lh.y,_lh.z);leftHandAnchor.rotation.set(0,0,0);buildLeftHandForGun(leftHandAnchor);leftHandAnchor.visible=true;leftHandCamGroup.visible=false;
  }else{
    if(_wdK&&typeof _wdK.build==='function'){ try{ _wdK.build(weaponGroup); }catch(e){ buildKnifeMeshes(weaponGroup); } }
    else { buildKnifeMeshes(weaponGroup); }
    leftHandAnchor.visible=false;leftHandCamGroup.visible=true;buildLeftHandForKnife(leftHandCamGroup);
  }
  if(_isGun){   // 所有「枪」统一在此装配**该枪专属**的弹匣（步枪=内置弹匣；模组枪=各自 magType）
    currentMagMesh=buildMagazineGroup(_wd, upgradeLevels.magSize||0);
    curMagPos=(_wd&&_wd.magPos)?_wd.magPos:{x:0,y:0,z:0};
    currentMagMesh.position.set(curMagPos.x,curMagPos.y,curMagPos.z);
    weaponGroup.add(currentMagMesh);
  }
  var _ne=document.getElementById('weapon-name'); if(_ne)_ne.textContent=(_wd&&_wd.name)?_wd.name:(_wdK&&_wdK.name)?(_wdK.icon||'🔪')+' '+_wdK.name:(_isGun?'🔫 步枪':'🔪 战术刀');
  /* 【batch218b】如果这一刻手里正拿着投掷物（极端情况：模组强行重建了武器模型），
     右下角要还原成那件东西的名字，而不是刚重建出来的枪名。 */
  try{
    if(typeof SK!=='undefined'&&SK&&SK.hold&&_ne){
      _ne.setAttribute('data-主',_ne.textContent);
      _ne.textContent=SK.hold.名称||'投掷物';
    }
  }catch(_e5){}
  applyWeaponDef();
  updateWeaponHUD();
  /* 【batch196】视角武器静态件合批：枪身 24 件 + 手 2 件 → 按材质并成 4~8 个网格。
     实测 draw call 75 → 6（挂在 camera 下的东西永远不会被视锥剔除，每帧必画，所以这一刀最实）。
     ⚠️ 合批必须放在**这里**而不是 build 函数里：弹匣 currentMagMesh 是 rebuild 末尾才加进来的，
        而且它是个 Group（换弹时要整块弹出去）；合批只吃「直接子 Mesh」→ 天然碰不到它。
        左手锚点 leftHandAnchor 同理是 Group，也不会被碰。 */
  try{
    _合批(weaponGroup,3);
    if(leftHandAnchor)_合批(leftHandAnchor,3);
    if(leftHandCamGroup)_合批(leftHandCamGroup,3);
  }catch(e){}
}

function switchWeapon(toWeapon){
  /* 【batch218】手里拿着投掷物时**禁止切枪**（用户："使用投掷物的时候不能切换武器"）。
     硬切会同时出现两把模型（枪重新显示、投掷物还挂在相机上），而且掏枪动画会和
     "把投掷物收回去"打架。要切枪得先按技能键把投掷物放下（heroHoldCancel）。
     ⚠️ 跨分片：SK 定义在 js/41，本分片加载时还没有 → 必须 typeof 守卫。 */
  try{ if(typeof SK!=='undefined'&&SK&&SK.hold)return; }catch(_eSW){}
  if(!weaponValid(toWeapon)||toWeapon===currentWeapon||switchAnimState!==ANIM_IDLE||S.reloading)return;
  pendingWeapon=toWeapon;switchAnimState=ANIM_LOWERING;switchAnimStart=performance.now();
}
/* 【模组·枪械】循环切换武器：0=步枪 1=战术刀 2+=ModLoader.addWeapon 注册的枪械。
   dir=1 下一把，dir=-1 上一把。列表里只有当前持有武器时等于原地不动（交给 switchWeapon 的守卫）。 */
function cycleWeapon(dir){ // 仅在「枪↔刀」两槽互切；新枪通过 B 菜单「替换」当前主武器，不是新增可切换槽
  if(currentWeapon===WEAPON_GUN)switchWeapon(WEAPON_KNIFE); else switchWeapon(WEAPON_GUN);
}
// ==================== 武器选择界面（按 B 弹出，类似瓦罗兰特买枪界面；替换当前手持枪）====================
function getAllWeapons(){
  var arr=[];
  /* 卡片上的锁按"今天"重新算一次：打卡后立刻能看到解锁，不用重启游戏 */
  try{ if(typeof 纪念刷新锁==='function')纪念刷新锁(); }catch(e){}
  /* 【batch203】内置枪（目前只有纪念版「长明」）：排在卡片第一位 —— 它是这个游戏的纪念作品 */
  try{
    for(var _bk in BUILTIN_GUNS){
      if(!Object.prototype.hasOwnProperty.call(BUILTIN_GUNS,_bk))continue;
      var _bd=BUILTIN_GUNS[_bk];
      arr.push({idx:+_bk,name:_bd.name,melee:false,icon:_bd.icon||'🔫',dmg:(typeof _bd.damage==='number'?_bd.damage:1),
        mag:_bd.magSize||30,fr:_bd.fireRate||50,rel:_bd.reloadTime||1200,range:_bd.range||80,
        auto:(_bd.auto!==false),pellets:(_bd.pellets||1),note:_bd.note||'',
        锁:!!_bd.锁,锁提示:_bd.锁提示||''});
    }
  }catch(e){}
  arr.push({idx:WEAPON_GUN,name:'步枪',melee:false,icon:'🔫',dmg:1.0,mag:30,fr:50,rel:1200,range:80,auto:true,pellets:1,note:'标准步枪·全自动·可开镜/换弹'});
  try{
    if(window.ModLoader&&ModLoader.weapons){
      for(var k in ModLoader.weapons){
        if(!Object.prototype.hasOwnProperty.call(ModLoader.weapons,k))continue;
        var d=ModLoader.weapons[k];
        arr.push({idx:+k,name:d.name||('武器'+k),melee:!!d.melee,icon:d.icon||'🔫',dmg:(typeof d.damage==='number'?d.damage:1.0),mag:(typeof d.magSize==='number'?d.magSize:30),fr:(typeof d.fireRate==='number'?d.fireRate:50),rel:(typeof d.reloadTime==='number'?d.reloadTime:1200),range:(typeof d.range==='number'?d.range:80),auto:(d.auto===false?false:true),pellets:(typeof d.pellets==='number'?d.pellets:1),note:d.note||'模组枪械'});
      }
    }
  }catch(e){}
  return arr;
}
function weaponSelectOpen(){var el=document.getElementById('weapon-select');return !!(el&&el.style.display==='flex');}
function renderWeaponCards(){
  var grid=document.getElementById('wsel-grid');if(!grid)return;grid.innerHTML='';
  var guns=getAllWeapons();
  for(var i=0;i<guns.length;i++){
    (function(w){
      var sel=(!w.melee)?(currentWeapon===WEAPON_GUN&&curGun===w.idx):(currentWeapon===WEAPON_KNIFE);
      var card=document.createElement('div');
      card.className='wsel-card'+(w.melee?' melee':'')+(sel?' cur':'')+(w.锁?' lock':'');
      if(w.note&&/纪念/.test(w.note))card.className+=' memorial';
      var stats=w.melee
        ? '<div class="wsel-stats">类型: <b>近战</b><br>伤害: <b>高</b><br>射程: <b>3.5</b></div>'
        : (function(){var _rpm=Math.round(60000/(w.fr||50));var _rel=((w.rel||1200)/1000).toFixed(1)+'s';var _mode=(w.auto===false)?'半自动':'全自动';var _pl=(w.pellets>1)?(' · 弹丸×'+w.pellets):'';return '<div class="wsel-stats">伤害 <b>×'+w.dmg+'</b> · 弹容 <b>'+w.mag+'</b><br>射速 <b>'+_rpm+' 发/分</b> · '+_mode+_pl+'<br>换弹 <b>'+_rel+'</b> · 射程 <b>'+(w.range||80)+'m</b></div>';})();
      var lockHtml=w.锁?('<div class="wsel-lock">🔒 '+ (w.锁提示||'未解锁') +'</div>'):'';
      card.innerHTML='<div class="wsel-ico">'+w.icon+'</div><div class="wsel-name">'+w.name+'</div>'+stats+
        (w.note?('<div class="wsel-note">'+w.note+'</div>'):'')+lockHtml+(sel?'<div class="wsel-tag">使用中</div>':'');
      card.addEventListener('click',function(e){e.stopPropagation();
        if(w.锁){
          /* 【batch203】作者通道③：连点锁住的纪念卡 7 下 → 输口令「长明」解锁。
             普通玩家点一下只会看到进度提示，不会知道这个入口。 */
          try{
            var 现在=performance.now();
            if(!window.__锁连点||现在-(window.__锁连点.t||0)>2500)window.__锁连点={n:0,t:现在};
            window.__锁连点.t=现在; window.__锁连点.n++;
            if(window.__锁连点.n>=7){
              window.__锁连点={n:0,t:现在};
              var 口令=prompt('作者通道：输入口令解锁纪念枪「长明」\n（普通玩家请累积登录 7 天）','');
              if(口令&&/^\s*长明\s*$/.test(口令)){ 纪念解锁(); renderWeaponCards(); return; }
              showMsg('口令不对','#ff8a8a'); return;
            }
          }catch(_eLk){}
          try{showMsg('🔒 '+w.锁提示,'#ffd166');}catch(_e){}
          return;
        }
        if(w.melee){ if(currentWeapon!==WEAPON_KNIFE)switchWeapon(WEAPON_KNIFE); }
        else { setCurrentGun(w.idx); }
        closeWeaponSelect();
      });
      grid.appendChild(card);
    })(guns[i]);
  }
  /* 【batch184d·#104/#106】刀槽：内置战术刀 + ModLoader.addKnife 注册的所有刀，每张卡片可单独选中。
     点卡片 = 设当前刀 + 切到近战槽（setCurrentKnife 会触发 rebuildWeaponModel 换模型/姿势）。 */
  var knives=getAllKnives();
  for(var ki=0;ki<knives.length;ki++){
    (function(kd){
      var selK=(currentWeapon===WEAPON_KNIFE&&currentKnife===kd.id);
      var kc=document.createElement('div');kc.className='wsel-card melee'+(selK?' cur':'');
      kc.innerHTML='<div class="wsel-ico">'+(kd.icon||'🔪')+'</div><div class="wsel-name">'+kd.name+'</div><div class="wsel-stats">类型: <b>近战</b><br>伤害: <b>高</b><br>射程: <b>3.5</b></div>'+(selK?'<div class="wsel-tag">使用中</div>':'');
      kc.addEventListener('click',function(e){e.stopPropagation();setCurrentKnife(kd.id);if(currentWeapon!==WEAPON_KNIFE)switchWeapon(WEAPON_KNIFE);closeWeaponSelect();});
      grid.appendChild(kc);
    })(knives[ki]);
  }
  /* 【batch170】爆能器卡：只有**爆能器版且已拾取爆能器**时才出现（VLUI.spikeCard 返回 null 就没有）。
     点它 = 切到手持爆能器（VLUI.selectSpike），和枪/刀走同一套"选哪件拿哪件"逻辑。
     原版页面没有 window.VLUI，这里整段跳过，行为零变化。 */
  if(window.VLUI&&window.VLUI.spikeCard){
    var spk=window.VLUI.spikeCard();
    if(spk){
      var sc=document.createElement('div');sc.className='wsel-card spike'+(spk.手持中?' cur':'');
      sc.innerHTML='<div class="wsel-ico">💣</div><div class="wsel-name">爆能器</div><div class="wsel-stats">类型: <b>任务目标</b><br>已拾取 · 带到下包点安放</div>'+(spk.手持中?'<div class="wsel-tag">手持中</div>':'');
      sc.addEventListener('click',function(e){e.stopPropagation();if(window.VLUI.selectSpike)window.VLUI.selectSpike();closeWeaponSelect();});
      grid.appendChild(sc);
    }
  }
}
function setCurrentGun(g){ // 把当前主武器替换为 g（0=内置步枪，-1=纪念枪，>=2=模组枪）；刀仍独立
  /* 【batch218b】手里拿着投掷物时不许换枪。B 菜单点卡片走的是这里（不是 switchWeapon），
     所以守卫必须加在这里，否则菜单能绕过 switchWeapon 直接 curGun+重建模型。 */
  try{ if(typeof SK!=='undefined'&&SK&&SK.hold){ try{showMsg('先放下手里的投掷物（再按一次技能键）','#ffd166');}catch(_e1){} return; } }catch(_e2){}
  curGun=g;
  if(g===MEMORIAL_SLOT)纪念记住装备();          // 只要装备过一次，联机就会带"拥有纪念枪皮"的标记
  if(currentWeapon===WEAPON_GUN){ rebuildWeaponModel(); }   // 已在枪槽：直接换模型+属性
  else { switchWeapon(WEAPON_GUN); }                         // 在刀槽：切回枪（抬枪完成时 rebuild 用新 curGun）
}
function showWeaponSelect(){
  /* 【batch218b】拿着投掷物时 B 菜单打不开：菜单一开就要暂停 + 解锁鼠标，
     玩家很容易在里面点枪 → 绕过守卫。直接提示更清楚。 */
  try{ if(typeof SK!=='undefined'&&SK&&SK.hold){ showMsg('先放下手里的投掷物（再按一次技能键）','#ffd166'); return; } }catch(_e4){}
  if(S.over||!S.playing)return; if(weaponSelectOpen())return; S.paused=true; var el=document.getElementById('weapon-select'); if(el)el.style.display='flex'; renderWeaponCards(); try{document.exitPointerLock();}catch(e){} }
function closeWeaponSelect(){ if(!weaponSelectOpen())return; var el=document.getElementById('weapon-select'); if(el)el.style.display='none'; S.paused=false; if(!isTouch)lockPointer(); }
(function(){ // 关闭按钮（点卡片也会关）；点空白处不再关闭，避免误触退出
  var _ws=document.getElementById('weapon-select');
  if(_ws){
    var _c=document.getElementById('wselClose'); if(_c)_c.addEventListener('click',function(e){e.stopPropagation();closeWeaponSelect();});
  }
})();
function updateWeaponHUD(){var _wd=curWDef();var _isGun=(currentWeapon===WEAPON_GUN)||(_wd&&!_wd.melee&&_wd.ammo!==false);var el=document.getElementById('ammo');if(!el)return;if(_isGun){el.innerHTML=S.ammo+' <span>/'+S.maxAmmo+'</span>';el.style.display='block';var rt=document.getElementById('reload-text');if(rt)rt.style.display='block';}else{el.style.display='none';var rt=document.getElementById('reload-text');if(rt)rt.style.display='none';}}

function lerpVal(a,b,t){return a+(b-a)*t;}
function updateLeftHand(dt){
  if(S.reloading)return;
  if(currentWeapon===WEAPON_GUN){
    var now=performance.now();var isMoving=(keys.KeyW||keys.KeyS||keys.KeyA||keys.KeyD)&&S.onGround;
    var bobX=0,bobY=0,bobZ=0;
    if(isMoving){var sf=S.sprinting?1.4:1.0;bobX=Math.sin(S.bobPhase+Math.PI)*0.006*sf;bobY=Math.cos(S.bobPhase*2+Math.PI)*0.004*sf;bobZ=Math.sin(S.bobPhase*2+Math.PI)*0.003*sf;}
    else{var breath=now*0.0015;bobY=Math.sin(breath)*0.001;bobX=Math.sin(breath*0.7)*0.0005;}
    var _lh=gunLH();leftHandAnchor.position.set(_lh.x+bobX,_lh.y+bobY,_lh.z+bobZ);
    /* 【batch184e】手枪类(单手)持法：非换弹时隐藏辅助手，呈现与步枪双手端枪明显不同的单手持枪动作 */
    leftHandAnchor.visible = !(gunHold()==='pistol' && !S.reloading);
  }else{
    var target=curKnifeDef().lhPos||LH_KNIFE_CAM;var speed=12.0*dt;
    lhCurrent.x=lerpVal(lhCurrent.x,target.x,speed);lhCurrent.y=lerpVal(lhCurrent.y,target.y,speed);lhCurrent.z=lerpVal(lhCurrent.z,target.z,speed);
    lhCurrent.rx=lerpVal(lhCurrent.rx,target.rx,speed);lhCurrent.ry=lerpVal(lhCurrent.ry,target.ry,speed);lhCurrent.rz=lerpVal(lhCurrent.rz,target.rz,speed);
    var now=performance.now();var isMoving=(keys.KeyW||keys.KeyS||keys.KeyA||keys.KeyD)&&S.onGround;
    var bobX=0,bobY=0,bobZ=0,bobRX=0,bobRY=0;
    if(isMoving){var sf=S.sprinting?1.4:1.0;bobX=Math.sin(S.bobPhase+Math.PI)*0.010*sf;bobY=Math.cos(S.bobPhase*2+Math.PI)*0.007*sf;bobZ=Math.sin(S.bobPhase*2+Math.PI)*0.005*sf;bobRX=Math.sin(S.bobPhase+Math.PI)*0.03*sf;bobRY=Math.cos(S.bobPhase+Math.PI)*0.02*sf;}
    else{var breath=now*0.0015;bobY=Math.sin(breath)*0.002;bobX=Math.sin(breath*0.7)*0.001;bobRX=Math.sin(breath*0.8)*0.005;}
    leftHandCamGroup.position.set(lhCurrent.x+bobX,lhCurrent.y+bobY,lhCurrent.z+bobZ);leftHandCamGroup.rotation.set(lhCurrent.rx+bobRX,lhCurrent.ry+bobRY,lhCurrent.rz);
  }
  /* 【batch184e/#101】第一人称手部动作钩子：优先用当前武器/刀 def 自带的 handAction
     （每把枪/刀可有各自不同的手持动作），否则退回 ModLoader.handAction 全局钩子。 */
  var _haArgs={ dt:dt, gun:(currentWeapon===WEAPON_GUN),
    leftAnchor:leftHandAnchor, leftCam:leftHandCamGroup, weaponGroup:weaponGroup,
    bobPhase:S.bobPhase, moving:(keys.KeyW||keys.KeyS||keys.KeyA||keys.KeyD)&&S.onGround, sprinting:S.sprinting,
    knifeSwinging:knifeSwinging, knifeElapsed:knifeSwinging?(performance.now()-knifeSwingTime):0 };
  var _ha=null;
  if(currentWeapon===WEAPON_GUN){ var _gdH=activeGunDef(); if(_gdH&&typeof _gdH.handAction==='function')_ha=_gdH.handAction; }
  if(!_ha&&typeof ModLoader!=='undefined'&&ModLoader.handAction)_ha=ModLoader.handAction;
  if(_ha){ try{ _ha(_haArgs); }catch(e){} }
}
