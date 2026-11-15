// ==================== ENEMY MODEL BUILDER (COMPLETELY REWORKED) ====================
var _eMatCache = {};
function _getEMat(hex){ if(!_eMatCache[hex]) _eMatCache[hex]=new THREE.MeshLambertMaterial({color:hex}); return _eMatCache[hex]; }
var _eDarkMat = new THREE.MeshLambertMaterial({color:0x111111});
var _eArmorMat = new THREE.MeshLambertMaterial({color:0x2a2a2a});
var _eSkinMat = new THREE.MeshLambertMaterial({color:0x8a6a4a});
var _eBootMat = new THREE.MeshLambertMaterial({color:0x1a1a1a});
var _eVisorMat = new THREE.MeshBasicMaterial({color:0xff2200});
var _eGunMetal = new THREE.MeshLambertMaterial({color:0x222222});

var ETYPES={basic:{c:0xff3333,hp:30,spd:0.06,sz:1,sc:100,dmg:8,gold:15,canShoot:true,shootRange:25,minRange:6,shootCD:1800,bulletSpd:0.4,bulletCount:1,spread:0.04,aimTime:500,aimColor:0xff4444},fast:{c:0xffaa00,hp:20,spd:0.11,sz:0.8,sc:150,dmg:5,gold:20,canShoot:false},tank:{c:0x8833ff,hp:80,spd:0.03,sz:1.4,sc:250,dmg:6,gold:40,canShoot:true,shootRange:22,minRange:5,shootCD:2800,bulletSpd:0.3,bulletCount:5,spread:0.15,aimTime:800,aimColor:0xaa44ff},elite:{c:0xff0066,hp:60,spd:0.07,sz:1.1,sc:300,dmg:18,gold:50,canShoot:true,shootRange:35,minRange:10,shootCD:2200,bulletSpd:0.5,bulletCount:1,spread:0.01,aimTime:700,aimColor:0xff0088},
/* 【batch126】剧情 boss「闪电」——佣兵团「暗月」的当家。青白色、体型比精英兵大一圈，
   血量厚、反应快、远程压制；不会掉金币（她不是小怪）。 */
lightning:{c:0x6ff0ff,hp:900,spd:0.085,sz:1.6,sc:2000,dmg:6,gold:0,canShoot:true,
  /* 【batch129】用户口径：射速要"跟我们差不多快"、警戒范围只要 10 米（不像小兵老远就锁人）。
     射速 170ms/发（小兵 1800ms 的 10 倍，接近玩家步枪手感）；伤害降到 6 平衡 DPS；
     真正决定"什么时候开火"的是 storyBossAI() 里的警戒判定（10 米内才开枪）。 */
  shootRange:10,minRange:0,shootCD:170,bulletSpd:0.95,bulletCount:1,spread:0.035,
  aimTime:180,aimColor:0x8ff8ff,
  alertR:10},
/* 【batch181】剧情第三章 boss「灰枭」—— 暗月残部校尉。旧军大衣、灰红配色；
   数值比闪电薄一点（火车站更开阔，靠电球 / 突进 / 大球三招压制），同样不吃金币。 */
darkmajor:{c:0xc84a4a,hp:750,spd:0.078,sz:1.55,sc:1500,dmg:7,gold:0,canShoot:true,
  shootRange:10,minRange:0,shootCD:190,bulletSpd:0.9,bulletCount:1,spread:0.04,
  aimTime:190,aimColor:0xff9a8a,
  alertR:10}};

function _orientMesh(mesh, from, to){
  var dir = new THREE.Vector3().subVectors(to, from).normalize();
  var up = new THREE.Vector3(0,1,0);
  var q = new THREE.Quaternion();
  var m = new THREE.Matrix4();
  m.lookAt(from, to, up);
  q.setFromRotationMatrix(m);
  mesh.quaternion.copy(q);
}

// ✅ 构建一段肢体（两点之间的盒子），返回 mesh
function _buildLimb(parent, from, to, thickness, material){
  var mid = from.clone().add(to).multiplyScalar(0.5);
  var len = from.distanceTo(to);
  if(len < 0.001) len = 0.001;
  var mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, len, thickness), material);
  mesh.position.copy(mid);
  _orientMesh(mesh, mid, to);
  parent.add(mesh);
  return mesh;
}

function _buildEnemyModel(type, sz, colorHex){
  var root = new THREE.Group();
  var yawPivot = new THREE.Group();
  yawPivot.name = 'yawPivot';
  // 【batch106】这一层同时管「躺平(X)」和「转身(Y)」。默认欧拉顺序 XYZ 会"先转身、再翻倒"，
  // 导致倒地躺平后转身变成原地打滚（身子永远朝 -Z、yaw 只把它绕长轴滚一圈）。
  // 指定 YXZ：先躺平、再绕世界 Y 转 yaw —— yawPivot 原点在脚底，于是"脚不动、身子绕脚扫过去"。
  yawPivot.rotation.order = 'YXZ';
  root.add(yawPivot);
  var g = yawPivot;

  var mat = _getEMat(colorHex);
  var t = ETYPES[type];

  // === 腿部 ===
  var legH = sz * 0.55, legW = sz * 0.18, legD = sz * 0.2, legSpacing = sz * 0.15;
  var leftLeg = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legD), mat);
  leftLeg.position.set(-legSpacing, legH/2, 0); g.add(leftLeg);
  var rightLeg = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legD), mat);
  rightLeg.position.set(legSpacing, legH/2, 0); g.add(rightLeg);
  var kneeGeo = new THREE.BoxGeometry(legW*1.2, legH*0.2, legD*0.6);
  var leftKnee = new THREE.Mesh(kneeGeo, _eArmorMat); leftKnee.position.set(-legSpacing, legH*0.45, legD*0.35); g.add(leftKnee);
  var rightKnee = new THREE.Mesh(kneeGeo, _eArmorMat); rightKnee.position.set(legSpacing, legH*0.45, legD*0.35); g.add(rightKnee);
  var bootH = sz * 0.12, bootGeo = new THREE.BoxGeometry(legW*1.3, bootH, legD*1.4);
  var leftBoot = new THREE.Mesh(bootGeo, _eBootMat); leftBoot.position.set(-legSpacing, bootH/2, legD*0.1); g.add(leftBoot);
  var rightBoot = new THREE.Mesh(bootGeo, _eBootMat); rightBoot.position.set(legSpacing, bootH/2, legD*0.1); g.add(rightBoot);

  // === 躯干 ===
  var torsoH = sz * 0.65, torsoW = sz * 0.55, torsoD = sz * 0.35, torsoY = legH + torsoH/2;
  var torso = new THREE.Mesh(new THREE.BoxGeometry(torsoW, torsoH, torsoD), mat); torso.position.set(0, torsoY, 0); g.add(torso);
  var plate = new THREE.Mesh(new THREE.BoxGeometry(torsoW*0.7, torsoH*0.6, torsoD*0.15), _eArmorMat); plate.position.set(0, torsoY + torsoH*0.05, -torsoD*0.45); g.add(plate);
  var belt = new THREE.Mesh(new THREE.BoxGeometry(torsoW*1.05, sz*0.06, torsoD*1.05), _eDarkMat); belt.position.set(0, legH + sz*0.03, 0); g.add(belt);
  var pouchGeo = new THREE.BoxGeometry(sz*0.08, sz*0.1, sz*0.06);
  var pouchL = new THREE.Mesh(pouchGeo, _eArmorMat); pouchL.position.set(-torsoW*0.5, legH + sz*0.06, 0); g.add(pouchL);
  var pouchR = new THREE.Mesh(pouchGeo, _eArmorMat); pouchR.position.set(torsoW*0.5, legH + sz*0.06, 0); g.add(pouchR);

  // === 头部 ===
  var headSz = sz * 0.32, headY = torsoY + torsoH/2 + headSz*0.6;
  var head = new THREE.Mesh(new THREE.BoxGeometry(headSz, headSz, headSz), mat); head.position.set(0, headY, 0); g.add(head);
  var helmet = new THREE.Mesh(new THREE.BoxGeometry(headSz*1.15, headSz*0.5, headSz*1.1), _eArmorMat); helmet.position.set(0, headY + headSz*0.25, 0); g.add(helmet);
  var visor = new THREE.Mesh(new THREE.BoxGeometry(headSz*0.9, headSz*0.2, headSz*0.15), _eVisorMat); visor.position.set(0, headY + headSz*0.05, -headSz*0.48); g.add(visor);
  var neck=new THREE.Mesh(new THREE.CylinderGeometry(headSz*0.28, headSz*0.34, headSz*0.45, 6), _eSkinMat); neck.position.set(0, headY-headSz*0.45, 0); g.add(neck);
  var backpack=new THREE.Mesh(new THREE.BoxGeometry(torsoW*0.85, torsoH*0.7, torsoD*0.5), _eArmorMat); backpack.position.set(0, torsoY+torsoH*0.08, torsoD*0.6); g.add(backpack);
  var bpStrapGeo=new THREE.BoxGeometry(0.04, torsoH*0.95, torsoD*0.12);
  var bpStrapL=new THREE.Mesh(bpStrapGeo, _eDarkMat); bpStrapL.position.set(-torsoW*0.28, torsoY, 0); g.add(bpStrapL);
  var bpStrapR=new THREE.Mesh(bpStrapGeo, _eDarkMat); bpStrapR.position.set(torsoW*0.28, torsoY, 0); g.add(bpStrapR);

  // === 肩甲（视觉标记，固定在躯干两侧）===
  var shoulderW = sz * 0.14, shoulderGeo = new THREE.BoxGeometry(shoulderW*1.3, shoulderW, torsoD*0.8);
  var leftShoulderPad = new THREE.Mesh(shoulderGeo, _eArmorMat); leftShoulderPad.position.set(-torsoW/2 - shoulderW*0.3, torsoY + torsoH*0.35, 0); g.add(leftShoulderPad);
  var rightShoulderPad = new THREE.Mesh(shoulderGeo, _eArmorMat); rightShoulderPad.position.set(torsoW/2 + shoulderW*0.3, torsoY + torsoH*0.35, 0); g.add(rightShoulderPad);

  // ✅ 肩关节世界位置（在 g 的局部空间中）
  var shoulderY = torsoY + torsoH * 0.35;
  var rShoulderPos = new THREE.Vector3(torsoW/2 + shoulderW*0.15, shoulderY, -torsoD*0.05);
  var lShoulderPos = new THREE.Vector3(-torsoW/2 - shoulderW*0.15, shoulderY, -torsoD*0.05);

  var weaponRig = null;
  var aimLine = null;

  // ✅ 只有能射击的敌人才建枪和手臂；近战兵单独建刀
  if(t.canShoot){
    weaponRig = new THREE.Group(); weaponRig.name = 'weaponRig';
    // 枪托抵右肩、枪身水平前指：抬到肩部高度并稍向右前
    weaponRig.position.set(torsoW*0.18, shoulderY, -torsoD*0.15); g.add(weaponRig);

    var gunLen, gunH, gunW;
    if(type === 'tank'){ gunLen = sz*0.7; gunH = sz*0.15; gunW = sz*0.12; }
    else if(type === 'elite'){ gunLen = sz*0.9; gunH = sz*0.1; gunW = sz*0.08; }
    else { gunLen = sz*0.6; gunH = sz*0.1; gunW = sz*0.08; }

    var gunGroup = new THREE.Group(); gunGroup.name = 'enemyGun';
    var gunBody = new THREE.Mesh(new THREE.BoxGeometry(gunW, gunH, gunLen), _eGunMetal); gunGroup.add(gunBody);
    var barrelLen = gunLen * 0.5;
    var eBarrel = new THREE.Mesh(new THREE.CylinderGeometry(gunW*0.3, gunW*0.35, barrelLen, 6), _eDarkMat);
    eBarrel.rotation.x = Math.PI/2; eBarrel.position.set(0, gunH*0.1, -gunLen/2 - barrelLen/2); gunGroup.add(eBarrel);
    var eMag = new THREE.Mesh(new THREE.BoxGeometry(gunW*0.6, gunH*1.2, gunLen*0.2), _eDarkMat);
    eMag.position.set(0, -gunH*0.8, gunLen*0.05); gunGroup.add(eMag);
    // 枪身整体前移：枪托(+z端)回到右肩附近，枪管向前
    gunGroup.position.set(0, 0, -gunLen*0.3); weaponRig.add(gunGroup);

    var gunOff = gunGroup.position;
    var rigOff = weaponRig.position;
    // 右手：枪托/扳机区（枪后部，靠近右肩）
    var rGripLocal = new THREE.Vector3(gunW*0.4, -gunH*0.5, gunLen*0.18).add(gunOff).add(rigOff);
    // 左手：护木/前段（枪前部）
    var lGripLocal = new THREE.Vector3(-gunW*0.3, -gunH*0.4, -gunLen*0.22).add(gunOff).add(rigOff);

    var armThick = sz * 0.10;

    // 右臂：肩 → 肘 → 右手（握扳机）
    var rElbow = new THREE.Vector3(rShoulderPos.x + sz*0.10, rShoulderPos.y - sz*0.16, rShoulderPos.z - sz*0.14);
    _buildLimb(g, rShoulderPos, rElbow, armThick, mat);
    _buildLimb(g, rElbow, rGripLocal, armThick*0.9, mat);
    var rHand = new THREE.Mesh(new THREE.BoxGeometry(armThick*1.4, armThick*1.1, armThick*1.4), _eSkinMat);
    rHand.position.copy(rGripLocal); g.add(rHand);

    // 左臂：肩 → 肘 → 左手（托护木）
    var lElbow = new THREE.Vector3(lShoulderPos.x - sz*0.10, lShoulderPos.y - sz*0.14, lShoulderPos.z - sz*0.16);
    _buildLimb(g, lShoulderPos, lElbow, armThick, mat);
    _buildLimb(g, lElbow, lGripLocal, armThick*0.9, mat);
    var lHand = new THREE.Mesh(new THREE.BoxGeometry(armThick*1.4, armThick*1.1, armThick*1.4), _eSkinMat);
    lHand.position.copy(lGripLocal); g.add(lHand);

    // 瞄准线
    var lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1)]);
    aimLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({color:t.aimColor, transparent:true, opacity:0.6, depthWrite:false}));
    aimLine.visible = false; scene.add(aimLine);
  } else {
    // 近战兵（如 fast）：右手持刀，刀刃朝前指敌
    var knifeRig = new THREE.Group(); knifeRig.name = 'knifeRig';
    var knifePos = new THREE.Vector3(torsoW*0.18, shoulderY - sz*0.22, -torsoD*0.55);
    knifeRig.position.copy(knifePos);
    knifeRig.scale.setScalar(sz*0.9);
    g.add(knifeRig);
    // 仅建刀身（刀柄/护手/刀刃/刀锋），手部由下方手臂统一处理，避免重复
    var kHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.04,0.14), _eDarkMat); kHandle.position.set(0,0,0.07); knifeRig.add(kHandle);
    var kGuard = new THREE.Mesh(new THREE.BoxGeometry(0.10,0.04,0.02), _eGunMetal); kGuard.position.set(0,0,0); knifeRig.add(kGuard);
    var kBlade = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.01,0.30), new THREE.MeshLambertMaterial({color:0xcccccc})); kBlade.position.set(0,0,-0.16); knifeRig.add(kBlade);
    var kEdge = new THREE.Mesh(new THREE.BoxGeometry(0.005,0.012,0.28), new THREE.MeshBasicMaterial({color:0xffffff})); kEdge.position.set(0.016,0,-0.16); knifeRig.add(kEdge);
    var armThick2 = sz * 0.10;
    // 右臂：肩 → 肘 → 右手握刀柄
    var rElbow2 = new THREE.Vector3(rShoulderPos.x + sz*0.10, rShoulderPos.y - sz*0.14, rShoulderPos.z - sz*0.16);
    _buildLimb(g, rShoulderPos, rElbow2, armThick2, mat);
    _buildLimb(g, rElbow2, knifePos, armThick2*0.9, mat);
    var rHand2 = new THREE.Mesh(new THREE.BoxGeometry(armThick2*1.4, armThick2*1.1, armThick2*1.4), _eSkinMat);
    rHand2.position.copy(knifePos); g.add(rHand2);
    // 左臂：肩 → 肘 → 身前防卫位
    var lGrip2 = new THREE.Vector3(-torsoW*0.12, shoulderY - sz*0.18, -torsoD*0.6);
    var lElbow2 = new THREE.Vector3(lShoulderPos.x - sz*0.10, lShoulderPos.y - sz*0.12, lShoulderPos.z - sz*0.14);
    _buildLimb(g, lShoulderPos, lElbow2, armThick2, mat);
    _buildLimb(g, lElbow2, lGrip2, armThick2*0.9, mat);
    var lHand2 = new THREE.Mesh(new THREE.BoxGeometry(armThick2*1.4, armThick2*1.1, armThick2*1.4), _eSkinMat);
    lHand2.position.copy(lGrip2); g.add(lHand2);
  }
  // === 血条 ===
  var hb = new THREE.Mesh(new THREE.PlaneGeometry(sz*1.2, 0.12), new THREE.MeshBasicMaterial({color:0x00ff00, side:THREE.DoubleSide}));
  hb.position.set(0, headY + headSz*0.8, 0); g.add(hb);

  /* 【batch196】静态件合批：每个敌人原本 32 个独立 Mesh ＝ 32 次 draw call，10 个兵 320 次，
     阴影 pass 再重复一遍。这些方块/圆柱里绝大多数从头到尾都不动，完全可以拼成一个几何。
     实测 32 → 13（躯干/护甲/靴/腰带/皮肤/护目镜各 1 个，腿和头保留，枪 3 件）。
     ⚠️ 必须保留的四个（不能合进去，否则动画和判定全废）：
        · head      —— 爆头判定 / 头部朝向
        · leftLeg   —— 走路摆腿
        · rightLeg  —— 走路摆腿
        · hb        —— 血条（要用独立材质改颜色）
     合批只吃「g 的直接子 Mesh」，所以 weaponRig / knifeRig 这两个 Group 天然不受影响。 */
  try{
    if(typeof 标静态==='function') 标静态(g,[head,leftLeg,rightLeg,hb]);
    if(typeof 合批静态==='function') 合批静态(g,3);
  }catch(e){}

  return { root:root, yawPivot:yawPivot, modelGroup:g, head:head, hb:hb, hbMat:hb.material, aimLine:aimLine, leftLeg:leftLeg, rightLeg:rightLeg, weaponRig:weaponRig };
}

// ==================== 联机玩家模型（比 AI 敌人精致得多的士兵）====================
// 【为什么单独一套】AI 敌人（_buildEnemyModel）是"方块风"机器人；而联机模式里你看到的
//   人**全是真人玩家**，方块人太丑。于是单独建一套像士兵的模型：
//     · 圆润的头 + 球面头盔 + 护目镜（不再是"方块头 + 方块头盔"）
//     · 胸甲 / 弹匣袋 / 背包 / 电台天线 / 肩甲 / 护膝 / 战术手套，装备有层次
//     · 圆柱形四肢、两段式（大腿+小腿、上臂+前臂）：站着走路时腿绕"胯"摆，不再是绕腿中间转
//     · 双手端枪；跑起来＝右手端枪、左臂前后摆（见 netPoseRemote）
// 【结构是给动画用的】分了三层，动画只动这几层、互不干扰：
//     g(朝向)
//      ├─ 每条腿：hip(绕胯) → knee(绕膝)
//      └─ bodyPivot(以胯为轴) → bodyGroup(躯干/头) / armRig(双臂+枪) → lArm / rArm
// 【爆头判定完全没变】爆头看的是 e.head —— 一块直接挂在模型树里的网格（这里依然如此），
//   所以"打头 = 爆头"的规则一点没动。
// 【性能】材质全局共享一份（_pmMat）：15 个玩家也不会重复创建材质、不会重复占显存。
//   玩家退出时不要去 dispose（还有别人在用）。
var _pmMat=null;
function _pmInit(){
  if(_pmMat)return;
  _pmMat={
    uniform :new THREE.MeshLambertMaterial({color:0x53667a}),   // 军装（和 AI 的灰蓝同色系）
    uniform2:new THREE.MeshLambertMaterial({color:0x46566a}),   // 军装暗部（小腿/前臂）
    gear    :new THREE.MeshLambertMaterial({color:0x2f3946}),   // 背心 / 背包 / 肩甲
    gear2   :new THREE.MeshLambertMaterial({color:0x1c232b}),   // 弹匣袋 / 护膝 / 手套
    boot    :new THREE.MeshLambertMaterial({color:0x15191e}),
    skin    :new THREE.MeshLambertMaterial({color:0xa07c58}),
    metal   :new THREE.MeshLambertMaterial({color:0x8d949c}),
    gun     :new THREE.MeshLambertMaterial({color:0x23262b}),
    lens    :new THREE.MeshBasicMaterial({color:0x18222b}),     // 护目镜片
    /* 【batch216】第三人称纪念枪「长明」的专属配色（黑金）—— 别人远远一眼就能认出
       他手里拿的是那把纪念枪，而不是普通步枪。材质同样全局共享。 */
    memBody :new THREE.MeshLambertMaterial({color:0x1e2227}),   // 黑枪身
    memSteel:new THREE.MeshLambertMaterial({color:0x9aa0a8}),   // 亮钢件（枪管/消焰器）
    gold    :new THREE.MeshLambertMaterial({color:0xd8b25a}),   // 金环 / 金件
    goldDark:new THREE.MeshLambertMaterial({color:0x8a7038})    // 暗金（弹匣底 / 托底）
  };
}
// 两点之间架一根圆柱肢体。注意：几何体的长度沿本地 +Y，所以要把 +Y 转到 from→to 的方向
// （不能像 _buildLimb 那样用 lookAt —— 那样转出来的是"横着的棍子"，四肢会歪）
function _pmLimb(parent,from,to,rad,mtl){
  var dir=new THREE.Vector3().subVectors(to,from);
  var len=dir.length();if(!(len>0.001))len=0.001;
  var q=new THREE.Mesh(new THREE.CylinderGeometry(rad,rad*0.92,len,7),mtl);
  q.position.copy(from).add(to).multiplyScalar(0.5);
  q.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());
  parent.add(q);return q;
}
function _buildPlayerModel(){
  _pmInit();
  var P=_pmMat;
  var root=new THREE.Group();
  var yawPivot=new THREE.Group();yawPivot.name='yawPivot';
  // 【batch106】躺平(X) 与 转身(Y) 同在这一层：必须 YXZ（先躺平再绕世界 Y 转），
  // 否则倒地躺平后转身＝绕身体长轴翻滚（侧躺、肩膀埋地），而不是"绕脚底圆心旋转"。
  yawPivot.rotation.order='YXZ';root.add(yawPivot);
  var g=yawPivot;
  function box(parent,w,h,d,mtl,x,y,z){var q=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mtl);q.position.set(x,y,z);parent.add(q);return q;}
  function cyl(parent,rt,rb2,h,mtl,x,y,z,seg){var q=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb2,h,seg||10),mtl);q.position.set(x,y,z);parent.add(q);return q;}

  // ---------- 腿：每条腿两层（跨→大腿，膝→小腿+靴），蹲下时两层一起折 ----------
  function makeLeg(side){
    var hip=new THREE.Group();hip.position.set(side*0.155,LEG_HIP_Y,0);g.add(hip);
    cyl(hip,0.108,0.100,LEG_THIGH,P.uniform,0,-LEG_THIGH/2,0,8);          // 大腿
    box(hip,0.215,0.09,0.25,P.gear2,0,-LEG_THIGH-0.005,-0.055);           // 护膝
    var knee=new THREE.Group();knee.position.set(0,-LEG_THIGH,0);hip.add(knee);
    cyl(knee,0.098,0.088,LEG_SHIN,P.uniform2,0,-LEG_SHIN/2,0,8);          // 小腿
    box(knee,0.195,BOOT_H,0.30,P.boot,0,-LEG_SHIN-BOOT_H/2,-0.035);       // 战靴
    if(side>0)box(hip,0.10,0.17,0.13,P.gear,0.115,-0.30,0.03);            // 右腿外侧枪套
    return {hip:hip,knee:knee};
  }
  var legL=makeLeg(-1),legR=makeLeg(1);

  // ---------- 上半身：挂在"以跨为轴"的枢轴上 ----------
  // 蹲下要整体下沉 + 前倾：绕跨转才自然（绕脚底转会像整个人向前倒）
  var bodyPivot=new THREE.Group();bodyPivot.position.set(0,LEG_HIP_Y,0);g.add(bodyPivot);
  var bodyGroup=new THREE.Group();bodyGroup.position.set(0,-LEG_HIP_Y,0);bodyPivot.add(bodyGroup);
  box(bodyGroup,0.56,0.22,0.32,P.uniform,0,0.86,0);                       // 骨盆
  box(bodyGroup,0.60,0.075,0.35,P.gear2,0,0.965,0);                       // 腰带
  box(bodyGroup,0.09,0.06,0.05,P.metal,0,0.965,-0.185);                   // 腰带扣
  box(bodyGroup,0.09,0.10,0.06,P.gear,-0.19,0.90,-0.155);                 // 腰包
  box(bodyGroup,0.09,0.10,0.06,P.gear,0.19,0.90,-0.155);
  box(bodyGroup,0.10,0.12,0.07,P.gear2,0.25,0.86,0.05);
  box(bodyGroup,0.46,0.24,0.29,P.uniform,0,1.08,0);                       // 腹部
  box(bodyGroup,0.58,0.34,0.34,P.uniform,0,1.33,0);                       // 胸腔
  box(bodyGroup,0.44,0.30,0.075,P.gear,0,1.34,-0.185);                    // 胸前护板
  box(bodyGroup,0.075,0.26,0.28,P.gear,0.285,1.33,0);                     // 侧板
  box(bodyGroup,0.075,0.26,0.28,P.gear,-0.285,1.33,0);
  box(bodyGroup,0.12,0.15,0.07,P.gear2,-0.15,1.19,-0.205);                // 弹匣袋 ×3
  box(bodyGroup,0.12,0.15,0.07,P.gear2,0.00,1.19,-0.205);
  box(bodyGroup,0.12,0.15,0.07,P.gear2,0.15,1.19,-0.205);
  box(bodyGroup,0.46,0.40,0.19,P.gear,0,1.36,0.245);                      // 背包
  box(bodyGroup,0.075,0.14,0.065,P.gear2,0.205,1.45,0.30);                // 电台
  cyl(bodyGroup,0.012,0.012,0.30,P.gear2,0.205,1.66,0.30,6);              // 天线
  box(bodyGroup,0.17,0.13,0.29,P.gear,0.365,1.44,0);                      // 肩甲
  box(bodyGroup,0.17,0.13,0.29,P.gear,-0.365,1.44,0);
  cyl(bodyGroup,0.082,0.10,0.12,P.skin,0,1.575,0);                        // 脖
  var head=new THREE.Mesh(new THREE.SphereGeometry(0.19,14,12),P.skin);
  head.position.set(0,1.78,-0.03);head.scale.set(1,1.06,1);bodyGroup.add(head);
  // 头盔是"半球壳"（只盖头顶+两侧+后脑），而且故意比脸靠后一点 ——
  // 正面打脸先命中的仍然是 head 这块网格，爆头判定不受影响。
  var helmet=new THREE.Mesh(new THREE.SphereGeometry(0.212,16,10,0,Math.PI*2,0,Math.PI*0.80),P.gear);
  helmet.position.set(0,1.83,0.02);bodyGroup.add(helmet);
  cyl(bodyGroup,0.222,0.222,0.035,P.gear2,0,1.795,0.02,16);               // 头盔下沿
  box(bodyGroup,0.30,0.06,0.06,P.lens,0,1.86,-0.19);                      // 护目镜（架在额前）

  // ---------- 双臂 + 步枪 ----------
  // armRig：整体的"持枪组"—— 瞄准上抬、奔跑略抬、爬梯举高都改它一个角度
  var armRig=new THREE.Group();armRig.name='armRig';armRig.position.set(0,1.30,0);bodyGroup.add(armRig);
  // 右臂 + 枪绑在一起（枪跟着右手走）
  var rArm=new THREE.Group();rArm.name='rArm';rArm.position.set(0.335,0.10,0);armRig.add(rArm);
  // 左臂单独一组（奔跑时脱开护木、前后摆动）
  var lArm=new THREE.Group();lArm.name='lArm';lArm.position.set(-0.335,0.10,0);armRig.add(lArm);
  // 右臂：肩(组原点) → 肘 → 握把；顺手在 rArm 局部坐标里把步枪挂到右手上
  _pmLimb(rArm,new THREE.Vector3(0,0,0),new THREE.Vector3(0.03,-0.20,-0.02),0.075,P.uniform2);
  _pmLimb(rArm,new THREE.Vector3(0.03,-0.20,-0.02),new THREE.Vector3(-0.045,-0.13,-0.22),0.066,P.uniform2);
  var gloveR=new THREE.Mesh(new THREE.BoxGeometry(0.155,0.13,0.17),P.gear2);gloveR.position.set(-0.045,-0.13,-0.22);rArm.add(gloveR);
  // 【batch103】枪挂在右手前方：枪身轴线落在**右肩正前方**，枪托贴住右肩窝。
  // 原来 x=-0.205（相对肩关节）→ 换算到身体轴线只有 x≈0.13，正面看就是"贴在胸口中心"。
  var gun=new THREE.Group();gun.position.set(-0.045,0.02,-0.26);rArm.add(gun);
  buildThirdPersonWeapon(gun,null);                                        // 【batch184e】按 def 建枪入口；null=内置步枪
  // 左臂：肩 → 肘 → 护木下方（"双手端枪"的托枪手位）
  _pmLimb(lArm,new THREE.Vector3(0,0,0),new THREE.Vector3(0.24,-0.30,-0.14),0.075,P.uniform2);
  _pmLimb(lArm,new THREE.Vector3(0.24,-0.30,-0.14),new THREE.Vector3(0.44,-0.20,-0.52),0.066,P.uniform2);
  var gloveL=new THREE.Mesh(new THREE.BoxGeometry(0.155,0.13,0.17),P.gear2);gloveL.position.set(0.44,-0.20,-0.52);lArm.add(gloveL);

  // ---------- 血条（挂在 bodyGroup 上：蹲下会跟着下去，倒地躺平由 lookAt 自己转正）----------
  // 瞄准线已移除（batch102）：那条线会暴露玩家位置/朝向，改为「开枪时的后坐力」表现。
  // ---------- 刀【batch103】：切刀时显示在右手上（枪收起来）----------
  var knifeRig=new THREE.Group();knifeRig.name='knifeRig';
  knifeRig.position.set(-0.045,-0.13,-0.22);knifeRig.visible=false;rArm.add(knifeRig);
  buildThirdPersonKnife(knifeRig,null);                                    // 【batch184e】按 def 建刀入口；null=内置战术刀
  // ---------- 手里的投掷物【batch103】：联机对手手持时显示 ----------
  var nadeRig=new THREE.Group();nadeRig.name='nadeRig';
  nadeRig.position.set(-0.04,-0.15,-0.30);nadeRig.visible=false;rArm.add(nadeRig);

  var hb=new THREE.Mesh(new THREE.PlaneGeometry(1.4,0.13),new THREE.MeshBasicMaterial({color:0x00ff00,side:THREE.DoubleSide}));
  hb.position.set(0,2.30,0);bodyGroup.add(hb);

  return { root:root, yawPivot:yawPivot, modelGroup:g, head:head, hb:hb, hbMat:hb.material,
           leftLeg:legL.hip, rightLeg:legR.hip, legL:legL, legR:legR,
           bodyPivot:bodyPivot, bodyGroup:bodyGroup, armRig:armRig, lArm:lArm, rArm:rArm,
           gun:gun, knifeRig:knifeRig, nadeRig:nadeRig };
}

/* 【batch184e】第三人称武器/刀模型入口：清空 rig 子节点后，优先用武器 def 的 tpBuild（模组注册），
   否则用内置步枪/战术刀几何。联机远端玩家切武器时由 netRebuildTPWeapon 按 wk 重建。 */
function netTPBox(w,h,d,mtl,x,y,z){var q=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mtl);q.position.set(x,y,z);return q;}
/* 【batch216】第三人称枪模型重做（用户：要别人能看出你手持着什么枪）
   ── 旧版的问题 ──
   不管是内置步枪、模组枪还是纪念枪「长明」，全是"三块灰方块 + 一根短管"，远看一模一样。
   ── 现在 ──
   ① 普通步枪：机匣 / 导轨 / 护木（带散热槽）/ 枪管 / 枪托 + 托底 / 握把 /
      扳机护圈 / 前后照门 / 拉机柄 / 带底板的弹匣 —— 侧面轮廓就认得出来是步枪；
   ② 纪念枪「长明」：黑枪身 + 亮钢长枪管 + 鸟笼消焰器 + **圆筒瞄准镜**（双抱箍 + 两个调节塔）
      + 两道金环 + 金弹匣底 + 暗金托底 —— 远远一眼就是"那把黑金的纪念枪"；
   ③ 弹匣登记成 `rig.userData.tpMag`：netPoseRemote 换弹时把它往下拽 + 淡出，
      再让新弹匣从下往上顶（别人看得见"弹匣掉了"）；
   ④ 枪口登记成 `rig.userData.tpMuzzle`：别人开火时火光/曳光从**真正的枪口**出来，
      不再从胸口冒出来。
   坐标：组原点≈握把，-Z＝枪口方向，+Z＝枪托。 */
function buildThirdPersonWeapon(rig,def){
  while(rig.children.length>0){var c=rig.children[0];rig.remove(c);if(c.geometry)c.geometry.dispose();}
  rig.userData.tpMag=null;rig.userData.tpMagBase=null;rig.userData.tpMuzzle=null;
  rig.userData.tpBolt=null;rig.userData.tpBoltZ=0;
  if(def&&typeof def.tpBuild==='function'){ try{ def.tpBuild(rig); return; }catch(e){} }
  if(typeof ModLoader!=='undefined'&&ModLoader.tpWeapon&&ModLoader.tpWeapon(def,rig))return;
  /* 【batch216】用户口径："直接把枪械模型从第一人称复制到第三人称上" —— 先复制，失败才兜底 */
  if(_TP复制第一人称(rig,def))return;
  _TP简化枪(rig,def);
}
/* 把第一人称那套模型**原样**建到 rig 里（同一个 def.build / buildGunMeshes），
   再做三件第一人称不需要、第三人称必须的事：
     ① **合批**：第一人称模型有 100~200 个网格。直接挂给每个远端玩家，
        draw call 会按人数翻倍（4 人就是 800 次）→ 用现成的 标静态/合批静态 按材质并成十几次；
     ② **握把对齐**：第一人称模型原点在机匣中心，而 gun 组原点在右手虎口。
        纪念枪的握把在模型局部 (0,-0.106,+0.100)，gun 组比手套高 0.15、前 0.04，
        所以 rig 要平移 (0,-0.044,-0.060) 才能让"手握在握把上"。
        换别的枪觉得手没握准，就调这三个数（这是唯一需要手调的偏移）。
     ③ **补弹匣**：第一人称的弹匣是 currentMagMesh 单独挂的、不在枪模型里，
        这里按 def.magPos 补一个简化匣（换弹动画要抓它）。 */
function _TP复制第一人称(rig,def){
  /* ⚠️ 模型必须建进**子组**，不能直接建进 rig：
     rig(=gun 组) 的 position 是 (-0.045,0.02,-0.26)（右肩前下方），
     谁把它改掉，整把枪就跑到人物身体外面去了。偏移只作用在这个 inner 上。 */
  var inner=new THREE.Group();
  var ok=false;
  try{
    /* 【batch217】判据放宽到 >=1：模组枪的 build 可能只搭两三件（手搓简易模型），
       以前要求 >2 会把它们当成"没建出来"→ 掉到兜底方块枪，看着就是"模组没兼容"。 */
    if(def&&typeof def.build==='function'){ def.build(inner); ok=inner.children.length>=1; }
    else if(typeof buildGunMeshes==='function'){ buildGunMeshes(inner); ok=inner.children.length>=1; }
  }catch(e){ ok=false; }
  if(!ok) return false;                        // 交给兜底（inner 是新建的，直接丢掉就行）
  try{
    if(typeof 标静态==='function') 标静态(inner,[]);
    /* 最少 2（不是 3）：远端玩家的枪会有好几把同时在场景里，
       同材质只要凑够 2 件就并掉，纪念枪因此从 200+ 件压到几十次绘制。 */
    if(typeof 合批静态==='function') 合批静态(inner,2);
  }catch(e){}
  /* 拉机柄：合批会跳过 animPart='charging' 的件，找出它给换弹动画用 */
  try{
    inner.traverse(function(o){
      if(!rig.userData.tpBolt&&o.isMesh&&o.userData&&o.userData.animPart==='charging'){
        rig.userData.tpBolt=o;rig.userData.tpBoltZ=o.position.z;
      }
    });
  }catch(e){}
  var P=_pmMat;
  var mem=!!(def&&def.memorial);
  /* 握把对齐（见函数头 ②）：只动 inner，不动 rig */
  inner.position.set(0,-0.044,-0.060);
  rig.add(inner);
  /* 补弹匣（见函数头 ③）—— 加在 inner 里，坐标就是「模型坐标」 */
  var mp=(def&&def.magPos)?def.magPos:{x:0,y:-0.090,z:-0.050};
  var mag=new THREE.Mesh(new THREE.BoxGeometry(mem?0.054:0.052,mem?0.165:0.155,mem?0.086:0.084),mem?P.memBody:P.gear2);
  mag.position.set(mp.x,mp.y,mp.z);mag.rotation.x=0.12;inner.add(mag);
  var magBase=new THREE.Mesh(new THREE.BoxGeometry(mem?0.060:0.058,0.014,mem?0.092:0.090),mem?P.goldDark:P.gear2);
  magBase.position.set(mp.x,mp.y-(mem?0.080:0.075),mp.z-0.008);magBase.rotation.x=0.12;inner.add(magBase);
  rig.userData.tpMag=mag;rig.userData.tpMagBase=magBase;
  rig.userData.tpMagY=mp.y;rig.userData.tpMagBaseY=mp.y-(mem?0.080:0.075);
  /* 枪口（相对 **rig** 的坐标）：模型在 inner 里，加上 inner 的偏移 (0,-0.044,-0.060)。
     别人开火时火光/曳光从这里出，不再从胸口冒出来。 */
  rig.userData.tpMuzzle=new THREE.Vector3(0,0.012-0.044,(mem?-0.690:-0.580)-0.060);
  return true;
}
/* 兜底：第一人称模型建不出来时（模组枪没 def.build、构建抛错）用这套方块枪。
   和第一人称风格不一致，但至少手里有东西、不会凭空消失。 */
function _TP简化枪(rig,def){
  var P=_pmMat;
  var mem=!!(def&&def.memorial);
  var 身=mem?P.memBody:P.gun;
  var 钢=mem?P.memSteel:P.metal;
  var 暗=mem?P.memBody:P.gear2;
  function bx(w,h,d,m,x,y,z){var q=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);q.position.set(x,y,z);rig.add(q);return q;}
  function cy(rt,rb,h,m,x,y,z,seg){var q=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||9),m);q.position.set(x,y,z);rig.add(q);return q;}

  /* ---- 机匣 / 导轨 / 抛壳窗 ---- */
  bx(0.078,0.105,0.40,身,0,0,-0.04);
  bx(0.050,0.014,0.34,P.gear2,0,0.058,-0.10);
  bx(0.080,0.018,0.10,钢,0,0.050,0.055);

  /* ---- 护木（比机匣细、往前伸，带散热槽） ---- */
  bx(0.072,0.082,0.24,身,0,0.002,-0.33);
  for(var hh=0;hh<3;hh++) bx(0.074,0.010,0.020,P.gear2,0,-0.030,-0.26-hh*0.055);

  /* ---- 枪管 + 消焰器 ---- */
  cy(0.017,0.017,0.20,钢,0,0.014,-0.47,10).rotation.x=Math.PI/2;
  if(mem){
    cy(0.024,0.022,0.058,钢,0,0.014,-0.585,10).rotation.x=Math.PI/2;      // 鸟笼消焰器
    cy(0.0125,0.0125,0.010,P.gold,0,0.014,-0.612,8).rotation.x=Math.PI/2; // 枪口金环
  }
  rig.userData.tpMuzzle=new THREE.Vector3(0,0.014,mem?-0.620:-0.575);

  /* ---- 枪托 / 托底 / 握把 / 扳机 ---- */
  bx(0.062,0.090,0.20,身,0,-0.006,0.255);
  bx(0.070,0.104,0.026,mem?P.goldDark:P.gear2,0,-0.006,0.368);
  var 握=bx(0.052,0.135,0.062,暗,0,-0.088,0.085);握.rotation.x=-0.26;
  bx(0.018,0.010,0.078,P.metal,0,-0.066,0.012);
  bx(0.014,0.026,0.012,P.metal,0,-0.052,0.048);

  /* ---- 弹匣（换弹动画抓的就是它） ---- */
  var mag=new THREE.Mesh(new THREE.BoxGeometry(mem?0.054:0.052,mem?0.165:0.155,mem?0.086:0.084),暗);
  mag.position.set(0,-0.132,-0.062);mag.rotation.x=0.12;rig.add(mag);
  var magBase=new THREE.Mesh(new THREE.BoxGeometry(mem?0.060:0.058,0.014,mem?0.092:0.090),mem?P.goldDark:P.gear2);
  magBase.position.set(0,-0.212,-0.070);magBase.rotation.x=0.12;rig.add(magBase);
  rig.userData.tpMag=mag;rig.userData.tpMagBase=magBase;
  rig.userData.tpMagY=-0.132;rig.userData.tpMagBaseY=-0.212;

  /* ---- 照门 / 拉机柄 ---- */
  bx(0.012,0.030,0.012,P.metal,0,0.080,-0.30);
  bx(0.034,0.022,0.010,P.metal,0,0.076,0.060);
  /* 拉机柄：换弹最后一步要把它往后拽（别人看得见"上膛"） */
  rig.userData.tpBolt=bx(0.030,0.013,0.014,P.metal,0.046,0.040,0.052);
  rig.userData.tpBoltZ=0.052;

  if(!mem)return;

  /* ---- 纪念枪专属：圆筒瞄准镜 + 金环 ---- */
  cy(0.030,0.030,0.240,身,0,0.103,-0.120,12).rotation.x=Math.PI/2;      // 镜筒
  cy(0.034,0.032,0.020,身,0,0.103,-0.242,12).rotation.x=Math.PI/2;      // 物镜口
  cy(0.032,0.030,0.018,身,0,0.103, 0.004,12).rotation.x=Math.PI/2;      // 目镜口
  cy(0.0345,0.0345,0.006,P.gold,0,0.103,-0.252,12).rotation.x=Math.PI/2; // 物镜金圈
  cy(0.0325,0.0325,0.006,P.gold,0,0.103, 0.013,12).rotation.x=Math.PI/2; // 目镜金圈
  bx(0.032,0.054,0.018,身,0,0.078,-0.205);                              // 前抱箍
  bx(0.032,0.054,0.018,身,0,0.078,-0.040);                              // 后抱箍
  cy(0.011,0.011,0.020,P.gold,0,0.134,-0.120,10);                       // 顶部调节塔
  cy(0.010,0.010,0.018,P.gold,0.030,0.103,-0.120,10).rotation.z=Math.PI/2; // 侧调节塔
  /* 枪管两道金环 + 护木前端金线（黑金配色的识别点） */
  cy(0.0195,0.0195,0.008,P.gold,0,0.014,-0.400,10).rotation.x=Math.PI/2;
  cy(0.0195,0.0195,0.008,P.gold,0,0.014,-0.510,10).rotation.x=Math.PI/2;
  bx(0.076,0.010,0.014,P.gold,0,0.026,-0.452);
}
/* 【batch219】第三人称刀：和枪一样**直接复制第一人称模型**。
   用户问"第三人称模型全面兼容模组了吗" —— 查下来枪兼容了、刀没有（只会建一把内置方块刀），
   所以模组刀（爪刀那种带 build 的）在别人眼里永远是一个样。
   ⚠️ 两个和枪不同的地方：
     ① 第一人称的刀模型**自带手**（buildKnifeMeshes 末尾会调 buildRightHand 建手套 + 小臂），
        第三人称本来就有一只手 → 必须按材质（gloveMat / skinMat）把手剔掉，否则两只手叠一起；
     ② 刀的原点在**护手**，第一人称握把在 +0.07；而 knifeRig 的原点正好落在手套上，
        所以整把刀要往前挪 7cm，手才握在柄上而不是握着护手。 */
function buildThirdPersonKnife(rig,def){
  while(rig.children.length>0){var c=rig.children[0];rig.remove(c);if(c.geometry)c.geometry.dispose();}
  rig.userData.tpBolt=null;rig.userData.tpMuzzle=null;rig.userData.tpMag=null;
  if(def&&typeof def.tpBuild==='function'){ try{ def.tpBuild(rig); return; }catch(e){} }
  if(typeof ModLoader!=='undefined'&&ModLoader.tpWeapon&&ModLoader.tpWeapon(def,rig))return;
  var inner=new THREE.Group();
  var ok=false;
  try{
    if(def&&typeof def.build==='function'){ def.build(inner); ok=inner.children.length>0; }
    else if(typeof buildKnifeMeshes==='function'){ buildKnifeMeshes(inner); ok=inner.children.length>0; }
  }catch(e){ ok=false; }
  if(ok){
    try{
      var 手材=[];
      if(typeof gloveMat!=='undefined')手材.push(gloveMat);
      if(typeof skinMat!=='undefined')手材.push(skinMat);
      if(手材.length){
        for(var i=inner.children.length-1;i>=0;i--){
          var c2=inner.children[i];
          if(c2.isMesh&&手材.indexOf(c2.material)>=0){ inner.remove(c2); if(c2.geometry)c2.geometry.dispose(); }
        }
      }
    }catch(e){}
    try{
      if(typeof 标静态==='function') 标静态(inner,[]);
      if(typeof 合批静态==='function') 合批静态(inner,2);
    }catch(e){}
    inner.position.set(0,0,-0.070);
    rig.add(inner);
    return;
  }
  var P=_pmMat;
  rig.add(netTPBox(0.038,0.038,0.14,P.gear2,0,0,0.06));
  rig.add(netTPBox(0.105,0.035,0.022,P.metal,0,0,0));
  rig.add(netTPBox(0.028,0.012,0.30,P.metal,0,0,-0.16));
  rig.add(netTPBox(0.006,0.012,0.28,P.lens,0.016,0,-0.16));
}

/* 【batch126】多了两个**可选**参数 px/pz：剧情模式要在指定位置（玩家附近 / 广场中央）刷兵。
   不传就还是老行为（地图上随机找空地）。末尾把实体返回出去，方便剧情脚本拿到 boss。 */
function createEnemy(type,px,pz){
  type=type||'basic';var t=ETYPES[type];
  var model = _buildEnemyModel(type, t.sz, t.c);
  var root = model.root;
  var x=0,z=-20,tries=0;
  if(typeof px==='number'&&typeof pz==='number'){
    x=px;z=pz;
    /* 指定点被墙卡住就绕着它找个空位 —— 否则兵会生成在墙里，AI 一步也走不了 */
    if(isColliding(x,z,t.sz))do{var a0=Math.random()*6.28,d0=1.5+Math.random()*7;
      x=px+Math.cos(a0)*d0;z=pz+Math.sin(a0)*d0;tries++;}while(isColliding(x,z,t.sz)&&tries<60);
  }else{
    do{var a=Math.random()*6.28,d=20+Math.random()*20;x=Math.cos(a)*d;z=Math.sin(a)*d;tries++;}while((Math.abs(x)>72||Math.abs(z)>72||isColliding(x,z,t.sz))&&tries<100);
    if(tries>=100){x=0;z=-35;}
  }
  root.position.set(x,0,z);scene.add(root);model.yawPivot.rotation.y=Math.random()*Math.PI*2;
  var wm=1+(S.wave-1)*0.15;
  enemies.push({
    root:root, yawPivot:model.yawPivot, g:model.modelGroup,
    body:null, head:model.head, hb:model.hb, hbMat:model.hbMat,
    type:type, hp:t.hp*wm, maxHp:t.hp*wm, spd:t.spd*(1+(S.wave-1)*0.05), sz:t.sz, sc:t.sc, dmg:t.dmg*wm, gold:t.gold,
    lastAtk:0, cd:1000, phase:Math.random()*6.28, flash:0,
    canShoot:t.canShoot, shootRange:t.shootRange, minRange:t.minRange||0,
    shootCD:t.shootCD, bulletSpd:t.bulletSpd, bulletCount:t.bulletCount,
    spread:t.spread, aimTime:t.aimTime, aimLine:model.aimLine,
    aiState:'patrol', patrolTarget:null, aimStartTime:0, lastShot:0,
    leftLeg:model.leftLeg, rightLeg:model.rightLeg, weaponRig:model.weaponRig
  });
  return enemies[enemies.length-1];
}

function showGoldPopup(amount,x,y){var el=document.createElement('div');el.className='gold-popup';el.textContent='+'+amount+' 🪙';el.style.left=x+'px';el.style.top=y+'px';document.body.appendChild(el);setTimeout(function(){el.remove();},1200);}
