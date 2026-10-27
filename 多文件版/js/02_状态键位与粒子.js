// ==================== STATE ====================
/* 【batch229】版本分化模式（语义化版本 major.minor.patch）：
   · major＝架构级改动（不兼容旧版，例：存档格式/联机协议变了）—— 大版本
   · minor＝一次大更新（新功能：新模式/新英雄/新系统）—— 例：聊天语音、自定义资产
   · patch＝小更新（修 bug、调数值）—— 每次更新 +1
   服务器启动时会校验这个号：major 不同或版本低于服务器下限 → 连不上也进不去，
   并弹明确提示（在哪看到的：join 时带上 v，服务端比对，不符发 bye why:'ver'）。
   改版本号的规矩：小修 patch+1；上功能 minor+1 且 patch 归 0；动协议/存档 major+1 且其余归 0。 */
var GAME_VER='1.7.11';
/* 【batch234】模组接口版本：1=老的英文接口（ModLoader.addHero…），
   2=1.7.5 起的统一中文接口（window.枪战模组）。模组文件头写 `@api 2` 声明自己按哪版写的。
   加接口（新增一类"能加的东西"）动小版本，改已有接口的参数/语义才动这个数。 */
var 模组接口版本=2;
var MAX_PARTICLES=80,MINIMAP_INTERVAL=5,SEP_DIST=2.0,SEP_FORCE=0.03,WALL_DIST=3.0,WALL_FORCE=0.10,WALL_TANGENT=0.16,BASE_SPEED=0.10,BOB_STRIDE=2.1,GRAVITY=0.015,JUMP_FORCE=0.28,GROUND_Y=2.0,WORLD_LIMIT=76,VIEW_RANGE=60,FOV_HALF_COS=Math.cos(117*Math.PI/360),LEAN_ROLL=0.30;
/* ==================== 【batch180】靶场（range）====================
   独立于「原版对战」「爆能器」的**第三种模式**，**仅单人**：不联机、不刷敌人，
   弹药无限、技能无冷却 —— 专门用来试枪械手感和角色技能。
   入口：服务端模式选择页 /modes 选「靶场」→ /play?mode=range。
   【为什么定义在这里】js/02 是最早的分片之一，js/30 的 netAutoMode 比它晚，
   放这里才能保证"靶场不联机"在自动联机判定之前就生效（放到开局流程里就来不及了）。 */
function rangeMode(){
  try{ return /[?&]mode=range\b/.test((typeof location!=='undefined'&&location.search)||''); }catch(e){ return false; }
}
/* ==================== 【batch181】旧火车站：火车 & 可破坏轨道 ====================
   火车不定时从轨道一端驶来，**进站停靠**（停够再走）；轨道**贯穿全图**，两端是隧道口。
     · 进站前 3 秒预警：轨道两端警灯狂闪 + 屏幕红字（走哪条轨道随机）
     · 行驶中是一整实体：玩家撞上＝ 60 伤 + 顺向击飞；AI 敌人直接被碾死；子弹被车厢挡下并掉血
     · 停靠中：变成一排实体障碍（6 节车厢各自一份碰撞盒）—— 挡人、挡子弹、**车顶能上**，
       而且**可以被直接摧毁**（子弹 / 爆炸，整车 900 血）→ 大爆炸 + 残骸堵死那条轨道
     · 每隔 16~30 秒随机来一班
   轨道按 10 米一段登记血量（TRAIN_TRACKS）。**爆炸能炸烂轨道**（boomDamageTracks，
   由破片手雷等爆炸调）—— 哪段烂了，经过它的火车当场脱轨翻车，
   那条轨道永久堵死（残骸＋障碍体），其它轨道不受影响。
   网格全部挂 _mapTarget（切图自动隐藏）；只有 curMapId==='station' 时才跑状态机。
   ⚠ 联机不同步：每台客户端各自跑自己的火车（服务端没有火车状态）。 */
var TRAIN_SPEED=42;                 // 火车行驶速度（米/秒）——「疾驰」
var TRAIN_LEN=48;                   // 列车长（米）：车头 8 + 5 节车厢 ×8
var TRAIN_W=3.2, TRAIN_H=3.3;       // 车厢宽 / 高（车顶 0.25+3.3＝3.55：站台顶 1.3 + 跳跃 2.61＝3.91，正好跳得上）
var TRAIN_WARN=3.0;                 // 预警秒数
var TRAIN_MIN_CD=16, TRAIN_MAX_CD=30;   // 两班车间隔（不定时）
var TRAIN_HIT_DMG=60;               // 撞玩家伤害
var TRAIN_SEG_HP=100;               // 每段轨道血量
var TRAIN_DWELL=15;                 // 进站停靠秒数
var TRAIN_STOP=20;                  // 停靠时车头位置（dir*20 → 6 节车厢正好对称横在场地中央）
var TRAIN_HP=900;                   // 整车血量：步枪 25/发 ≈ 36 发；破片手雷一发 150
var TRAIN={st:'idle',t:0,cd:12,ti:-1,dir:1,head:0,group:null,hitP:false,blink:0,hp:TRAIN_HP,obs:[],wrecks:[]};
var TRAIN_TRACKS=[];                // [{z, wrecked, segs:[{x0,x1,hp,broken,meshes}], lamps:[灯网格×2]}]
function trainOnStation(){ try{ return curMapId==='station'; }catch(e){ return false; } }
/* 残骸（打爆 / 脱轨后的车厢）＝**纯视觉**：【batch183】用户口径"列车被打爆后碰撞体积要删除"，
   所以不再往 obstacles 里推残骸碰撞盒（原来那 6 个盒子既和歪倒的车身对不上，还永远不会被清掉）。
   残骸网格登记进 TRAIN.wrecks，离开地图 / 结算 / 重开时由 trainWreckClear 连网格一起收。 */
function trainWreckAdd(mesh){ TRAIN.wrecks.push(mesh); }
function trainWreckClear(){
  for(var i=0;i<TRAIN.wrecks.length;i++){ var m=TRAIN.wrecks[i]; if(m&&m.parent)m.parent.remove(m); }
  TRAIN.wrecks=[];
}
/* 停靠中的车厢 → 一排实体障碍（各自一份碰撞盒：挡人、挡子弹、车顶可站）。
   离站 / 被毁时由 trainObsClear 摘掉。⚠ 必须同步 buildObstacleBoxes()，否则缓存盒不刷新。 */
function trainObsAdd(){
  trainObsClear();
  if(!TRAIN.group||TRAIN.ti<0)return;
  var tz=TRAIN_TRACKS[TRAIN.ti].z;
  for(var i=0;i<6;i++){
    var cx=TRAIN.head-TRAIN.dir*i*8;
    var o={cx:cx,cz:tz,w:7.6,d:3.4,h:0.25+TRAIN_H,kind:'terrain',
           minX:cx-3.8,maxX:cx+3.8,minZ:tz-1.7,maxZ:tz+1.7,_train:1};
    obstacles.push(o);TRAIN.obs.push(o);
  }
  if(typeof buildObstacleBoxes==='function')buildObstacleBoxes();
}
function trainObsClear(){
  if(!TRAIN.obs.length)return;
  for(var i=0;i<TRAIN.obs.length;i++){ var bi=obstacles.indexOf(TRAIN.obs[i]); if(bi>=0)obstacles.splice(bi,1); }
  TRAIN.obs=[];
  if(typeof buildObstacleBoxes==='function')buildObstacleBoxes();
}
/* 列车血条（独立小 DOM，top:52 挂在剧情 Boss 条下面，不抢它的位）—— 停靠就显示，打掉 / 车走了就藏 */
function trainHpShow(on){
  try{
    var el=document.getElementById('trainHpWrap'); if(!el)return;
    var nm=document.getElementById('trainHpName'),bar=document.getElementById('trainHpBar');
    if(nm)nm.textContent='🚆 列车结构 '+Math.max(0,Math.ceil(TRAIN.hp));
    if(bar)bar.style.width=(Math.max(0,Math.min(1,TRAIN.hp/TRAIN_HP))*100)+'%';
    el.style.display=on?'block':'none';
  }catch(e){}
}
/* 列车受伤（子弹 / 爆炸调）。hp 见底 → 整列车原地炸掉 */
function trainDamage(n,px,py,pz){
  try{
    if(!TRAIN.group||TRAIN.ti<0)return;
    if(TRAIN.st!=='run'&&TRAIN.st!=='dwell'&&TRAIN.st!=='depart')return;
    if(n>0&&typeof px==='number')spawnParticle(new THREE.Vector3(px,py,pz),0xffcc66,3,0.2);
    /* 【batch184】多人模式：血量交给服务端权威记账，自己不上本地数值，只上报。
       服务端把新血量广播给同房所有人（含自己），这样「一个人打、全场都能看到扣血 / 打爆」。 */
    if(typeof netIsMulti==='function'&&netIsMulti()){ try{netSend({t:'train',d:Math.round(n)});}catch(_){} return; }
    TRAIN.hp-=n;
    trainHpShow(true);
    if(TRAIN.hp<=0)trainDestroy();
  }catch(e){}
}
/* 爆炸打到列车（破片手雷等调）：按爆炸中心到车厢的远近衰减 */
function boomDamageTrain(x,z,r,dmg){
  try{
    if(!TRAIN.group||TRAIN.ti<0)return;
    if(TRAIN.st!=='run'&&TRAIN.st!=='dwell'&&TRAIN.st!=='depart')return;
    var b=trainBox(); if(!b)return;
    var tz=TRAIN_TRACKS[TRAIN.ti].z;
    var cxp=Math.max(b.x0,Math.min(x,b.x1));
    var d=Math.sqrt((x-cxp)*(x-cxp)+(z-tz)*(z-tz));
    if(d>r+2.5)return;
    trainDamage(Math.round(dmg*Math.max(0.25,1-d/(r+2.5))));
  }catch(e){}
}
/* 整车摧毁：大爆炸 + 残骸歪在轨道上 + 堵死这条轨道 + 炸伤附近的人 */
function trainDestroy(){
  try{
    if(!TRAIN.group||TRAIN.ti<0)return;
    var T=TRAIN_TRACKS[TRAIN.ti],tz=T.z,h=TRAIN.head,dir=TRAIN.dir;
    trainObsClear();
    if(TRAIN.group&&TRAIN.group.parent)TRAIN.group.parent.remove(TRAIN.group);
    TRAIN.group=null;TRAIN.st='idle';TRAIN.cd=TRAIN_MAX_CD;T.wrecked=true;
    TRAIN.hp=TRAIN_HP;TRAIN.hitP=false;
    trainHpShow(false);
    var _wt=(typeof _mapTarget!=='undefined'&&_mapTarget)?_mapTarget:scene;   // 残骸挂地图组：切图跟着隐藏
    /* 残骸：6 节车厢歪在轨道上（纯视觉，【batch183】不再有碰撞体积 —— 打爆即删） */
    for(var i=0;i<6;i++){
      var cx=h-dir*i*8;
      var car=trainBuildMesh();
      car.position.set(cx,0.2,tz+(i%2?0.9:-0.7));
      car.rotation.z=(i%2?1:-1)*(0.9+Math.random()*0.5);
      car.rotation.x=(Math.random()-0.5)*0.3;
      car.rotation.y=dir>0?0:Math.PI;
      _wt.add(car);trainWreckAdd(car);
    }
    /* 爆炸炸伤附近的人（按最近的车厢算 —— 站在车顶上的也算） */
    var _hurt=false;
    for(var q=0;q<6;q++){
      var qx=h-dir*q*8;
      var ddx=camera.position.x-qx,ddz=camera.position.z-tz;
      if(ddx*ddx+ddz*ddz<100)_hurt=true;
    }
    /* 【batch227】联机下火车伤害服务端权威（trainHit 消息），本地不再算 —— 不然双扣 */
    if(_hurt&&S.hp>0){ if(!netIsMulti())takeDmg(60,null);showMsg('🚆 列车在爆炸中解体！','#ff6b6b'); }
    for(var p=0;p<60;p++) spawnParticle(new THREE.Vector3(h+(Math.random()-0.5)*TRAIN_LEN,0.5+Math.random()*4,tz+(Math.random()-0.5)*4),0xffaa55,5,1.0,true);
    showMsg('🚆 列车被打成筛子 —— 炸了！','#ff6b6b');
  }catch(e){}
}
/* 列车（行驶或停靠）身下有没有烂轨道段 */
function trainTrackBrokenUnder(){
  try{
    var T=TRAIN_TRACKS[TRAIN.ti]; if(!T||!T.segs)return false;
    var tail=TRAIN.head-TRAIN.dir*TRAIN_LEN;
    var x0=Math.min(TRAIN.head,tail)-2,x1=Math.max(TRAIN.head,tail)+2;
    for(var si=0;si<T.segs.length;si++){ var s=T.segs[si]; if(s.broken&&s.x1>x0&&s.x0<x1)return true; }
  }catch(e){}
  return false;
}
/* 【batch188】被列车撞飞：真正把人挪出车体。
   原来写的是"沿行驶方向推 9 米"——车体长 48 米，推完还在车厢里 → playerBlocked() 为 true →
   直接放弃改坐标 → 人留在车厢内部；列车停靠后车厢是实体障碍，就**锁死出不来**（单人靠
   trainDwellSettle 兜底，多人下那道兜底被跳过 → 必卡）。
   现在按优先级挑落点：服务端权威落点 → 轨道左/右 3.9 米（车半宽 1.7 + 人半径）→ 顺行驶方向前抛 →
   更外侧 → 四面都堵就直接抛上车顶。返回 true = 已落到可站立点。 */
function trainBlastAway(dir, tz, sx, sz){
  try{
    if(typeof tz!=='number'||!isFinite(tz))tz=camera.position.z;
    dir=(dir===1||dir===-1)?dir:1;
    var cand=[];
    if(typeof sx==='number'&&typeof sz==='number')cand.push([sx,sz]);      // 服务端算好的落点优先
    cand.push([camera.position.x,tz+3.9]);
    cand.push([camera.position.x,tz-3.9]);
    cand.push([camera.position.x+dir*9,camera.position.z]);
    cand.push([camera.position.x,(camera.position.z>=tz?tz+4.6:tz-4.6)]);
    for(var i=0;i<cand.length;i++){
      var cx=cand[i][0],cz=cand[i][1];
      if(!playerBlocked(cx,cz,standEyeY())){ camera.position.x=cx; camera.position.z=cz; return true; }
    }
    /* 四周都堵（贴墙 + 车厢夹住）→ 抛上车顶：车顶能站，至少不会锁在车体里 */
    camera.position.y=Math.max(camera.position.y,5.9); S.velY=2.0; return false;
  }catch(e){ return false; }
}
/* 停靠瞬间善后：① 把还在车厢位置里的玩家沿最浅轴推出来（否则新加的障碍体会把人锁死）
   ② 碾死压在车厢里的 AI（车是从它们身上压过来的） */
function trainDwellSettle(){
  try{
    var tz=TRAIN_TRACKS[TRAIN.ti].z;
    var px=camera.position.x,pz=camera.position.z,inside=false;
    for(var i=0;i<6;i++){
      var cx=TRAIN.head-TRAIN.dir*i*8;
      if(px>cx-3.9&&px<cx+3.9&&Math.abs(pz-tz)<2.2){ inside=true;break; }
    }
    if(inside&&camera.position.y<4.3){
      /* 【batch188】改用统一选址：原来只推 z±2.6，贴墙时照样推不出去 */
      trainBlastAway(TRAIN.dir,tz);
      showMsg('🚉 列车停靠 —— 把位让开了','#8fd6ff');
    }
    for(var ei=enemies.length-1;ei>=0;ei--){
      var e=enemies[ei];if(e.isNet||e.hp<=0||!e.root)continue;
      if(typeof STORY_!=='undefined'&&STORY_.boss===e)continue;   // 剧情 Boss 不碾
      var ex=e.root.position.x,ez=e.root.position.z;
      for(var j=0;j<6;j++){
        var ccx=TRAIN.head-TRAIN.dir*j*8;
        if(ex>ccx-4&&ex<ccx+4&&Math.abs(ez-tz)<2.0){
          spawnParticle(e.root.position.clone().setY(1.0),0xff6644,14,0.5,true);
          killEnemy(e,ei,false);break;
        }
      }
    }
  }catch(e){}
}
/* 登记一条轨道（buildMapStation 调）：ti=第几条, z=轨道中心 z, x0/x1=起止（贯穿全图）, segLen=段长 */
function trainTrackRegister(ti,z,x0,x1,segLen){
  try{
    TRAIN_TRACKS[ti]=TRAIN_TRACKS[ti]||{};
    var T=TRAIN_TRACKS[ti];
    T.z=z;T.wrecked=false;T.lamps=T.lamps||[];T.segs=[];
    for(var x=x0;x<x1-0.5;x+=segLen){
      T.segs.push({x0:x,x1:Math.min(x+segLen,x1),hp:TRAIN_SEG_HP,broken:false,meshes:null});
    }
  }catch(e){}
}
/* 把一条轨道的可视部分建出来（道床 + 枕木 + 两条铁轨），网格按段存好（炸烂时逐段摘） */
function trainTrackBuild(ti){
  try{
    var T=TRAIN_TRACKS[ti]; if(!T||!T.segs)return;
    var railMat=new THREE.MeshLambertMaterial({color:0x9aa3b0});
    var tieMat =new THREE.MeshLambertMaterial({color:0x4a3f33});
    var bedMat =new THREE.MeshLambertMaterial({color:0x39402f});
    for(var i=0;i<T.segs.length;i++){
      var s=T.segs[i],cx=(s.x0+s.x1)/2,len=s.x1-s.x0,ms=[];
      var bed=new THREE.Mesh(new THREE.BoxGeometry(len,0.30,4.4),bedMat);
      bed.position.set(cx,0.15,T.z);_mapTarget.add(bed);ms.push(bed);
      for(var k=0;k<Math.floor(len/1.2);k++){
        var tie=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.12,3.6),tieMat);
        tie.position.set(s.x0+0.6+k*1.2,0.33,T.z);_mapTarget.add(tie);ms.push(tie);
      }
      for(var r=-1;r<=1;r+=2){
        var rail=new THREE.Mesh(new THREE.BoxGeometry(len,0.16,0.18),railMat);
        rail.position.set(cx,0.46,T.z+r*0.75);_mapTarget.add(rail);ms.push(rail);
      }
      s.meshes=ms;
    }
  }catch(e){}
}
/* 一段轨道烂了：摘掉网格 + 弯轨残件 + 碎屑 */
function trainSegBreakFx(ti,si){
  try{
    var T=TRAIN_TRACKS[ti],s=T&&T.segs[si]; if(!s)return;
    if(s.meshes){ for(var i=0;i<s.meshes.length;i++){ var m=s.meshes[i]; if(m&&m.parent)m.parent.remove(m); } }
    s.meshes=null;
    var cx=(s.x0+s.x1)/2;
    var bent=new THREE.Mesh(new THREE.BoxGeometry(6,0.16,0.18),new THREE.MeshLambertMaterial({color:0x9aa3b0}));
    bent.position.set(cx,0.5,T.z+1.6);bent.rotation.z=0.5;bent.rotation.y=(Math.random()-0.5)*0.6;_mapTarget.add(bent);
    var bent2=bent.clone();bent2.position.set(cx,0.5,T.z-1.6);bent2.rotation.z=-0.6;_mapTarget.add(bent2);
    for(var p=0;p<14;p++) spawnParticle(new THREE.Vector3(cx+(Math.random()-0.5)*8,0.6+Math.random()*0.6,T.z+(Math.random()-0.5)*3),0xffa04a,3,0.5,true);
    showMsg('💥 轨道被炸烂了！','#ff9a4a');
  }catch(e){}
}
/* 爆炸伤轨道（破片手雷等调）：x/z=爆点, r=爆炸半径, dmg=伤害。返回炸烂的段数 */
function boomDamageTracks(x,z,r,dmg){
  if(!trainOnStation())return 0;
  var broke=0;
  for(var ti=0;ti<TRAIN_TRACKS.length;ti++){
    var T=TRAIN_TRACKS[ti]; if(!T||!T.segs||T.wrecked)continue;
    for(var si=0;si<T.segs.length;si++){
      var s=T.segs[si]; if(s.broken)continue;
      if(x<s.x0-r||x>s.x1+r)continue;
      if(Math.abs(T.z-z)>r+2.2)continue;
      s.hp-=dmg;
      if(s.hp<=0){ s.broken=true;trainSegBreakFx(ti,si);broke++; }
    }
  }
  return broke;
}
/* 当前列车占用的世界 AABB（头 x / 尾 x / z / 上下沿）；没车返回 null。
   【batch181】停靠（dwell）与离站（depart）也算数 —— 停靠时有碰撞体积，子弹照旧被车厢挡下 */
function trainBox(){
  if((TRAIN.st!=='run'&&TRAIN.st!=='dwell'&&TRAIN.st!=='depart')||!TRAIN.group)return null;
  var h=TRAIN.head, tail=h-TRAIN.dir*TRAIN_LEN;
  return {x0:Math.min(h,tail),x1:Math.max(h,tail),z:TRAIN_TRACKS[TRAIN.ti].z,z0:TRAIN_TRACKS[TRAIN.ti].z-1.7,z1:TRAIN_TRACKS[TRAIN.ti].z+1.7,y0:0.25,y1:0.25+TRAIN_H};
}
/* 点是否在车厢里（子弹拦截用） */
function trainBoxHit(x,y,z){
  var b=trainBox(); if(!b)return false;
  return x>=b.x0&&x<=b.x1&&z>=b.z0&&z<=b.z1&&y>=b.y0&&y<=b.y1;
}
/* 建一列车（车头 + 5 节车厢）；group 原点在车头中心 */
function trainBuildMesh(){
  var g=new THREE.Group();
  var bodyMat=new THREE.MeshLambertMaterial({color:0x2c4a6b});
  var roofMat=new THREE.MeshLambertMaterial({color:0xdfe6ee});
  var winMat =new THREE.MeshBasicMaterial({color:0x9fd8ff});
  var lampMat=new THREE.MeshBasicMaterial({color:0xfff3c0});
  for(var i=0;i<6;i++){
    var isHead=(i===0), cx=-i*8;
    var body=new THREE.Mesh(new THREE.BoxGeometry(7.6,TRAIN_H-0.5,2.9),bodyMat);
    body.position.set(cx,0.25+(TRAIN_H-0.5)/2,0);g.add(body);
    var roof=new THREE.Mesh(new THREE.BoxGeometry(7.8,0.5,3.0),roofMat);
    roof.position.set(cx,0.25+TRAIN_H-0.25,0);g.add(roof);
    var win=new THREE.Mesh(new THREE.BoxGeometry(6.6,0.9,0.1),winMat);
    win.position.set(cx,0.25+TRAIN_H-1.15,1.46);g.add(win);
    var win2=win.clone();win2.position.z=-1.46;g.add(win2);
    if(isHead){
      var lamp=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.5,0.9),lampMat);
      lamp.position.set(3.9,0.25+TRAIN_H-1.2,0);g.add(lamp);
      var nose=new THREE.Mesh(new THREE.BoxGeometry(0.6,TRAIN_H-1.0,2.6),bodyMat);
      nose.position.set(4.0,0.25+(TRAIN_H-1.0)/2,0);g.add(nose);
    }
  }
  return g;
}
function trainClear(){
  try{
    if(TRAIN.group&&TRAIN.group.parent)TRAIN.group.parent.remove(TRAIN.group);
  }catch(e){}
  trainObsClear();
  trainWreckClear();                                          // 【batch183】残骸网格一并收（换图 / 结算 / 重开时轨道恢复干净）
  TRAIN.group=null;TRAIN.st='idle';TRAIN.cd=TRAIN_MIN_CD+Math.random()*(TRAIN_MAX_CD-TRAIN_MIN_CD);
  TRAIN.hitP=false;TRAIN.hp=TRAIN_HP;TRAIN.ti=-1;
  trainHpShow(false);
}
/* 状态机（loop 每帧调）：idle → warn → run →（到站）dwell → depart → idle */
function trainTick(dt){
  try{
    if(!trainOnStation()||!S.playing){ if(TRAIN.group||TRAIN.obs.length||TRAIN.wrecks.length)trainClear(); return; }
    if(!TRAIN_TRACKS.length)return;
    dt=dt||0.016;
    if(TRAIN.st==='idle'){
      TRAIN.cd-=dt;
      if(TRAIN.cd<=0){
        /* 挑一条没残骸的轨道 */
        var ok=[];for(var i=0;i<TRAIN_TRACKS.length;i++)if(TRAIN_TRACKS[i]&&TRAIN_TRACKS[i].segs&&!TRAIN_TRACKS[i].wrecked)ok.push(i);
        if(!ok.length){ TRAIN.cd=TRAIN_MAX_CD; return; }
        TRAIN.ti=ok[(Math.random()*ok.length)|0];
        TRAIN.dir=Math.random()<0.5?1:-1;
        TRAIN.st='warn';TRAIN.t=TRAIN_WARN;TRAIN.blink=0;TRAIN.hp=TRAIN_HP;
        showMsg('🚆 列车即将进站 —— 离开轨道！','#ff6b6b');
      }
      return;
    }
    if(TRAIN.st==='warn'){
      TRAIN.t-=dt;TRAIN.blink+=dt;
      var T=TRAIN_TRACKS[TRAIN.ti];
      if(T&&T.lamps){ var on=(TRAIN.blink%0.3)<0.15;
        for(var li=0;li<T.lamps.length;li++){ var L=T.lamps[li]; if(L&&L.material)L.material.color.setHex(on?0xff2222:0x551111); } }
      if(TRAIN.t<=0){
        TRAIN.group=trainBuildMesh();scene.add(TRAIN.group);
        TRAIN.head=(TRAIN.dir>0)?-90:90;TRAIN.hitP=false;
        TRAIN.group.rotation.y=(TRAIN.dir>0)?0:Math.PI;
        TRAIN.st='run';
        /* 【batch184】多人：刚刷车就向服务端拉一次权威血量（别人可能更早打过这趟车），
           否则本地从满血开始、跟别人的血量对不上。 */
        try{ if(typeof netIsMulti==='function'&&netIsMulti())netSend({t:'train',d:0}); }catch(_){}
      }
      return;
    }
    /* run＝行驶进站；depart＝停够离站（都在动：撞人 / 碾人 / 脱轨检查照旧） */
    if(TRAIN.st==='run'||TRAIN.st==='depart'){
      var sp=TRAIN_SPEED*dt;
      if(TRAIN.st==='depart'){ TRAIN.depT=(TRAIN.depT||0)+dt; sp=TRAIN_SPEED*dt*Math.min(1,TRAIN.depT/2.5); }   // 离站缓起步
      TRAIN.head+=TRAIN.dir*sp;
      var tz=TRAIN_TRACKS[TRAIN.ti].z;
      TRAIN.group.position.set(TRAIN.head,0,tz);
      /* 到站：车头开到 dir*TRAIN_STOP → 停靠（上障碍体 + 善后 + 出血条） */
      if(TRAIN.st==='run'&&(TRAIN.dir>0?TRAIN.head>=TRAIN_STOP:TRAIN.head<=-TRAIN_STOP)){
        TRAIN.head=TRAIN.dir*TRAIN_STOP;
        TRAIN.group.position.set(TRAIN.head,0,tz);
        trainObsAdd();trainDwellSettle();
        TRAIN.st='dwell';TRAIN.t=TRAIN_DWELL;TRAIN.depT=0;
        trainHpShow(true);
        showMsg('🚉 列车停靠中 —— 车顶能上，也能一枪一枪打爆它','#8fd6ff');
        return;
      }
      /* 脱轨检查：列车覆盖的任一段烂了 → 当场翻 */
      if(trainTrackBrokenUnder()){ trainDerail();return; }
      /* 物理：撞玩家 */
      if(!TRAIN.hitP){
        var px=camera.position.x,pz=camera.position.z;
        var tail=TRAIN.head-TRAIN.dir*TRAIN_LEN;
        if(px>=Math.min(TRAIN.head,tail)-0.7&&px<=Math.max(TRAIN.head,tail)+0.7
           &&Math.abs(pz-tz)<=2.0&&camera.position.y<4.2&&camera.position.y>0.1){
          TRAIN.hitP=true;
          /* 【batch227】联机下火车撞人服务端权威（trainHit → applyDamage），本地不重复扣 */
          if(!netIsMulti())takeDmg(TRAIN_HIT_DMG,null);
          /* 【batch188】击飞必须真的把人挪出车体（原来推 9 米还在 48 米长的车厢里 → 被阻挡 → 不动 → 卡住） */
          trainBlastAway(TRAIN.dir,tz);
          S.velY=6.5;SK.slow=Math.max(SK.slow,1.2);
          spawnParticle(camera.position.clone(),0xffdd66,16,0.5,true);
          showMsg('🚆 被列车撞飞！','#ff6b6b');
        }
      }
      /* 物理：碾过 AI 敌人 */
      for(var ei=enemies.length-1;ei>=0;ei--){
        var e=enemies[ei];if(e.isNet||e.hp<=0||!e.root)continue;
        if(typeof STORY_!=='undefined'&&STORY_.boss===e)continue;   // 剧情 Boss 不碾（否则能靠等火车"通关"）
        var ex=e.root.position.x,ez=e.root.position.z;
        var tl=TRAIN.head-TRAIN.dir*TRAIN_LEN;
        if(ex>=Math.min(TRAIN.head,tl)-1&&ex<=Math.max(TRAIN.head,tl)+1&&Math.abs(ez-tz)<=1.9){
          spawnParticle(e.root.position.clone().setY(1.0),0xff6644,18,0.6,true);
          killEnemy(e,ei,false);
        }
      }
      if(Math.abs(TRAIN.head)>96){ trainClear(); }
      return;
    }
    if(TRAIN.st==='dwell'){
      TRAIN.t-=dt;
      /* 停靠时身下轨道被炸烂 → 原地翻 */
      if(trainTrackBrokenUnder()){ trainDerail(); return; }
      if(TRAIN.t<=0){
        trainObsClear();
        TRAIN.st='depart';TRAIN.depT=0;
        showMsg('🚆 列车离站 —— 让开！','#ff9a4a');
      }
      return;
    }
  }catch(e){}
}
/* 【batch184f-补4】多人：服务端权威列车 → 客户端只渲染（单人游戏仍走上面 trainTick，逻辑/渲染一体，互不影响）。
   trainApplyState：收到服务端 t:'train' 时落地状态（建/拆车、上障碍、出血条）。
   trainSyncSrv：每帧按 TRAIN 镜像摆位/闪灯，不做任何"状态决策"。 */
function trainApplyState(m){
  try{
    TRAIN.st=m.st;
    if(typeof m.ti==='number')TRAIN.ti=m.ti;
    if(typeof m.dir==='number')TRAIN.dir=m.dir;
    if(typeof m.head==='number')TRAIN.head=m.head;
    /* 【batch186 修复】服务端原来把倒计时也写在 `t` 上，与消息类型重复 → 客户端收不到本函数。
       现在服务端用 `ct`；这里两个都认，老服务端（数字 m.t）也能兜住。 */
    if(typeof m.ct==='number')TRAIN.t=m.ct;
    else if(typeof m.t==='number')TRAIN.t=m.t;
    if(typeof m.hp==='number')TRAIN.hp=m.hp;
    if(m.st==='warn'){
      if(typeof showMsg==='function')showMsg('🚆 列车即将进站 —— 离开轨道！','#ff6b6b');
    } else if(m.st==='run'){
      if(!TRAIN.group){
        TRAIN.group=trainBuildMesh();scene.add(TRAIN.group);
        TRAIN.group.rotation.y=(TRAIN.dir>0)?0:Math.PI;
        /* 建模当场就摆到车头位置：否则第一帧会从原点滑过来（远处轨道上会看到车"飞"一段） */
        try{ TRAIN.group.position.set(TRAIN.head,0,TRAIN_TRACKS[TRAIN.ti].z); }catch(e2){}
      }
    } else if(m.st==='dwell'){
      if(!TRAIN.group){ TRAIN.group=trainBuildMesh();scene.add(TRAIN.group);TRAIN.group.rotation.y=(TRAIN.dir>0)?0:Math.PI; }
      TRAIN.group.position.set(TRAIN.head,0,TRAIN_TRACKS[TRAIN.ti].z);
      if(!TRAIN.obs.length){ trainObsAdd(); if(typeof trainDwellSettle==='function')trainDwellSettle(); trainHpShow(true); }
      if(typeof showMsg==='function')showMsg('🚉 列车停靠中 —— 车顶能上，也能一枪一枪打爆它','#8fd6ff');
    } else if(m.st==='idle'){
      trainClear();
    }
  }catch(e){}
}
function trainSyncSrv(dt){
  try{
    if(!trainOnStation()||!S.playing){ if(TRAIN.group||TRAIN.obs.length||TRAIN.wrecks.length)trainClear(); return; }
    if(TRAIN.st==='idle'){ if(TRAIN.group||TRAIN.obs.length)trainClear(); return; }
    if(TRAIN.st==='warn'){
      var _Tw=TRAIN_TRACKS[TRAIN.ti];
      if(_Tw&&_Tw.lamps){ var _on=((performance.now()/1000%0.3)<0.15); for(var _wi=0;_wi<_Tw.lamps.length;_wi++){var _L=_Tw.lamps[_wi];if(_L&&_L.material)_L.material.color.setHex(_on?0xff2222:0x551111);} }
      return;
    }
    if(TRAIN.st==='run'||TRAIN.st==='depart'||TRAIN.st==='dwell'){
      var _tz=TRAIN_TRACKS[TRAIN.ti].z;
      if(!TRAIN.group){ TRAIN.group=trainBuildMesh();scene.add(TRAIN.group);TRAIN.group.rotation.y=(TRAIN.dir>0)?0:Math.PI; }
      TRAIN.group.position.x += (TRAIN.head-TRAIN.group.position.x)*Math.min(1,dt*12);   // 平滑跟随服务端车头
      TRAIN.group.position.z=_tz;
      if(TRAIN.st==='dwell'&&!TRAIN.obs.length){ trainObsAdd(); if(typeof trainDwellSettle==='function')trainDwellSettle(); trainHpShow(true); }
      return;
    }
  }catch(e){}
}
/* 脱轨：撤掉车，翻着残骸 + 堵死这条轨道（行驶中被烂轨绊翻 / 停靠时身下被炸烂 都走这里） */
function trainDerail(){
  try{
    if(!TRAIN.group||TRAIN.ti<0)return;
    var ti=TRAIN.ti,T=TRAIN_TRACKS[ti],tz=T.z;
    var h=TRAIN.head,tail=h-TRAIN.dir*TRAIN_LEN,dir=TRAIN.dir;
    trainObsClear();
    if(TRAIN.group&&TRAIN.group.parent)TRAIN.group.parent.remove(TRAIN.group);
    TRAIN.group=null;TRAIN.st='idle';TRAIN.cd=TRAIN_MAX_CD;T.wrecked=true;TRAIN.hp=TRAIN_HP;TRAIN.hitP=false;
    trainHpShow(false);
    var _wt=(typeof _mapTarget!=='undefined'&&_mapTarget)?_mapTarget:scene;   // 残骸挂地图组：切图跟着隐藏
    /* 残骸：6 节车厢歪在轨道上（纯视觉，【batch183】与"打爆"同口径：碰撞体积一并删除） */
    for(var i=0;i<6;i++){
      var cx=h-dir*i*8;
      var car=trainBuildMesh();
      car.position.set(cx,0.2,tz+(i%2?0.9:-0.7));
      car.rotation.z=(i%2?1:-1)*(0.9+Math.random()*0.5);
      car.rotation.x=(Math.random()-0.5)*0.3;
      car.rotation.y=dir>0?0:Math.PI;
      _wt.add(car);trainWreckAdd(car);
    }
    /* 残骸炸伤附近的人（按最近的车厢算） */
    var _hurt2=false;
    for(var q2=0;q2<6;q2++){
      var q2x=h-dir*q2*8;
      var d2x=camera.position.x-q2x,d2z=camera.position.z-tz;
      if(d2x*d2x+d2z*d2z<100)_hurt2=true;
    }
    /* 【batch227】同上：联机下脱轨翻覆伤害也以服务端为准 */
    if(_hurt2&&S.hp>0){ if(!netIsMulti())takeDmg(40,null);showMsg('🚆 脱轨的列车在你身边翻覆！','#ff6b6b'); }
    for(var p=0;p<40;p++) spawnParticle(new THREE.Vector3(h+(Math.random()-0.5)*TRAIN_LEN,0.5+Math.random()*3,tz+(Math.random()-0.5)*4),0xffaa55,4,0.8,true);
    showMsg('🚆 轨道被炸烂 —— 列车脱轨翻覆！','#ff6b6b');
  }catch(e){}
}
/* 火车站警灯（轨道两端各一盏）：buildMapStation 建好网格后登记进来 */
function trainLampRegister(ti,mesh){ try{ TRAIN_TRACKS[ti].lamps.push(mesh); }catch(e){} }
/* ---- 靶场的靶子 ----
   靶子**同时**是两样东西：① 障碍（addBox 加进去，子弹打上去本来就会冒火花）
   ② 登记进 RANGE_TARGETS，供准星射线做"命中闪白 + 计数"。
   命中判定刻意**不塞进 attack() 那条超长压缩行**：那条一动就是全游戏射击逻辑的风险，
   改成每帧看 S.lastShot 有没有变化（=这一帧开过枪），再单独射一条线打靶子。 */
var RANGE_TARGETS=[],_rgLastShot=0,_rgHits=0;
function rangeAddTarget(x,z,w,h){
  try{
    var par=(typeof _mapTarget!=='undefined'&&_mapTarget)?_mapTarget:scene;   // 挂当前地图组，切图跟着隐藏
    var mat=new THREE.MeshLambertMaterial({color:0xd94f4f});
    var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,0.22),mat);
    m.position.set(x,1.2+h/2,z); par.add(m);
    var pole=new THREE.Mesh(new THREE.BoxGeometry(0.16,1.2,0.16),new THREE.MeshLambertMaterial({color:0x6b7280}));
    pole.position.set(x,0.6,z); par.add(pole);
    if(typeof addBox==='function'){ try{ addBox(x,z,w,h,0.3,null,'terrain'); }catch(e){} }
    RANGE_TARGETS.push({mesh:m,mat:mat,hitT:0,hits:0});
  }catch(e){}
}
/* ---- 靶场假人（batch180）：左边「技能伤害靶」+ 右边「回血靶」----
   为什么做成**真敌人实体**（塞进 enemies）而不是自己写一套命中判定：
   每个技能的判定逻辑都不一样（半径 / 分层 / 视线 / 附魔减速），复刻一遍必然漏；
   而所有技能的伤害入口都是同一句 `e.hp-=dmg` —— 挂进 enemies 就全都能吃到，
   子弹、刀、闪电光球、电荷陷阱、球形闪电、灼烧、暗影、破片手雷…… 一律自动生效。
   假人不会动也不会打人（updateEnemies 里按 rangeDummy 跳过），
   血量掉到 0 也不会真死（killEnemy 拦住 → 重置血量继续测）。
   统计口径：每帧比对假人血量变化，掉了就是伤害、涨了就是治疗 —— 同样不用管是哪个技能。 */
var RANGE_DUMMIES=[];
/* 准星旁飘一个数字（伤害=红 / 治疗=绿）。自带一份，不依赖联机那套 netHitPopup。 */
function rangePopup(text,color){
  try{
    var el=document.createElement('div');
    el.textContent=text;
    el.style.cssText='position:fixed;pointer-events:none;z-index:80;font-weight:700;font-size:17px;'
      +'text-shadow:0 2px 8px #000;left:'+Math.round(innerWidth/2+(Math.random()-0.5)*130)+'px;'
      +'top:'+Math.round(innerHeight/2-46)+'px;color:'+(color||'#fff')
      +';opacity:1;transition:transform .55s ease-out,opacity .55s ease-out';
    document.body.appendChild(el);
    requestAnimationFrame(function(){el.style.transform='translateY(-36px)';el.style.opacity='0';});
    setTimeout(function(){try{el.remove();}catch(e){}},620);
  }catch(_){}
}
/* 头顶一块小木牌：写着这个假人是干什么的（canvas 贴图Sprite，不用管字体文件） */
function rangeSpriteLabel(text,colorHex){
  try{
    var c=document.createElement('canvas');c.width=256;c.height=64;
    var x=c.getContext('2d');
    x.fillStyle='rgba(8,12,20,.74)';
    x.beginPath();x.moveTo(14,6);x.lineTo(242,6);x.quadraticCurveTo(256,6,256,20);
    x.lineTo(256,44);x.quadraticCurveTo(256,58,242,58);x.lineTo(14,58);
    x.quadraticCurveTo(0,58,0,44);x.lineTo(0,20);x.quadraticCurveTo(0,6,14,6);x.closePath();x.fill();
    x.strokeStyle='#'+('000000'+((colorHex>>>0).toString(16))).slice(-6);x.lineWidth=4;x.stroke();
    x.font='bold 30px sans-serif';x.fillStyle='#ffffff';x.textAlign='center';x.textBaseline='middle';
    x.fillText(text,128,34);
    var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthTest:false}));
    sp.scale.set(2.8,0.7,1);
    return sp;
  }catch(_){ return null; }
}
function rangeAddDummy(x,z,kind){
  try{
    var isHeal=(kind==='heal');
    var sz=isHeal?1.05:1.35, col=isHeal?0x4fe08a:0x9b5cff;
    var model=null;
    try{ if(typeof _buildEnemyModel==='function')model=_buildEnemyModel(isHeal?'basic':'tank',sz,col); }catch(e){}
    var root,yawPivot,g,head,hb,hbMat;
    if(model){
      root=model.root;yawPivot=model.yawPivot;g=model.modelGroup;head=model.head;hb=model.hb;hbMat=model.hbMat;
      if(model.aimLine&&model.aimLine.parent)model.aimLine.parent.remove(model.aimLine);   // 假人不瞄准：瞄准线摘掉，别挡判定
    }else{
      /* 兜底：_buildEnemyModel 不在（极端情况）时用方块拼一个，别让建图失败 */
      root=new THREE.Group();yawPivot=new THREE.Group();yawPivot.rotation.order='YXZ';root.add(yawPivot);g=yawPivot;
      var m0=new THREE.MeshLambertMaterial({color:col});
      var bd=new THREE.Mesh(new THREE.BoxGeometry(sz*0.6,sz*1.1,sz*0.4),m0);bd.position.y=sz*0.85;g.add(bd);
      head=new THREE.Mesh(new THREE.BoxGeometry(sz*0.34,sz*0.34,sz*0.34),m0);head.position.y=sz*1.55;g.add(head);
      hb=new THREE.Mesh(new THREE.PlaneGeometry(sz*1.2,0.12),new THREE.MeshBasicMaterial({color:0x00ff00,side:THREE.DoubleSide}));
      hb.position.y=sz*1.9;g.add(hb);hbMat=hb.material;
    }
    root.position.set(x,0,z);
    /* 受击外壳：挂在 root 上（**不是** g）—— 子弹射线只扫 g.children，外壳不挡判定，只做"白一下"的表现 */
    var shell=new THREE.Mesh(new THREE.BoxGeometry(sz*0.85,sz*1.8,sz*0.62),
      new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false}));
    shell.position.y=sz*0.88;root.add(shell);
    var lab=rangeSpriteLabel(isHeal?'💚 回血靶':'🎯 技能伤害靶',col);
    if(lab){lab.position.set(0,sz*2.15,0);root.add(lab);}
    var par=(typeof _mapTarget!=='undefined'&&_mapTarget)?_mapTarget:scene;
    par.add(root);
    var hp0=isHeal?30:5000;
    var ent={root:root,yawPivot:yawPivot,g:g,head:head,hb:hb,hbMat:hbMat,shell:shell,
      type:'basic',hp:hp0,maxHp:isHeal?100:5000,sz:sz,sc:0,gold:0,dmg:0,
      canShoot:false,shootRange:0,minRange:0,shootCD:999999,
      flash:0,aimLine:null,aiState:'dummy',rangeDummy:true,dummyKind:isHeal?'heal':'dmg',
      isNet:false,alive:true,
      stat:{total:0,hits:0,max:0,heal:0,rounds:0},_lastHp:hp0};
    enemies.push(ent);RANGE_DUMMIES.push(ent);
    return ent;
  }catch(e){ return null; }
}
/* 假人起身：清掉「球形闪电」留下的倒地姿态（躺平 + 下沉）。重置时、被治疗扶起时都要调。 */
function rangeDummyStand(e){
  try{
    if(!e)return;
    if(e.g&&e.g.rotation)e.g.rotation.x=0;
    if(e.g&&e.g.position)e.g.position.y=0;
    e._dbSlump=false;e.downedLife=0;
  }catch(_){}
}
/* 假人"死亡"：不真死，重置血量 + 计数，继续测 */
function rangeDummyReset(e){
  try{
    if(!e)return;
    rangeDummyStand(e);                                       // 先起身，不然被球形闪电打躺过的人会一直躺着
    e.hp=(e.dummyKind==='heal')?Math.max(1,Math.round(e.maxHp*0.3)):e.maxHp;
    e.stat.rounds++;
    e._lastHp=e.hp;
    if(e.hb)e.hb.scale.x=e.hp/e.maxHp;
    if(e.hbMat)e.hbMat.color.setHex(0x00ff00);
    if(e.shell&&e.shell.material)e.shell.material.opacity=0;
    rangePopup(e.dummyKind==='heal'?'💚 回血靶已重置（30% 血）':'🎯 伤害靶已重置',e.dummyKind==='heal'?'#7fe6a8':'#c9a6ff');
  }catch(_){}
}
/* 给治疗技能调用：半径内的「回血靶」回 amt 点血（上限 maxHp）。伤害统计由每帧血量比对自动完成。 */
function rangeHealDummies(x,z,r,amt){
  try{
    if(typeof rangeMode!=='function'||!rangeMode())return;
    if(!(amt>0)||!(r>0))return;
    for(var i=0;i<RANGE_DUMMIES.length;i++){
      var d=RANGE_DUMMIES[i];
      if(!d||!d.root||d.dummyKind!=='heal'||d.hp>=d.maxHp)continue;
      var dx=d.root.position.x-x,dz=d.root.position.z-z;
      if(dx*dx+dz*dz<=r*r){
        if(d.downedLife>0)rangeDummyStand(d);      // 被球形闪电打躺了：治疗＝当场扶起来（和游戏里"治疗扶起倒地队友"同口径）
        d.hp=Math.min(d.maxHp,d.hp+amt);
      }
    }
  }catch(_){}
}
/* 【batch180】退出重进靶场：把两个特殊靶子补回来（修"退出重进靶子失效/打不动"）。
   根因（两层叠加，第二层是浏览器实测才抓到的）：
   ① 靶场图是**懒构建**的——setMap 里 MAP_BUILT.range 一旦为 true 就绝不会二次调用
     buildMapRange；退出对局时 clearFieldData() 又把假人当"AI 敌人"从 enemies 里 splice 掉
     → 重进靶场时没有任何人会补建假人。
   ② clearFieldData 摘模型用的是 `scene.remove(e.root)`，而 three.js 的 remove() 只在
     **直接子级**里找——假人 root 挂在地图组 MAP_GROUP.range 下（不是 scene 的子级），
     所以那行**什么都没摘掉**：模型还挂在地图组上（肉眼看得见），实体却已脱离 enemies
     → 打不掉血、技能打不到、统计不跳。用户看到的就是"靶子还在但不受伤害"。
     （18 个普通靶子的网格一直挂在地图组上，同样不受影响；要补的只是这两个 enemies 实体。）
   ⚠ 两个坑：① 补建必须显式挂 MAP_GROUP.range——setMap 结束后 _mapTarget 已被 finally
     还原成调用前的值（一般是 classic 组，visible=false），照 rangeAddDummy 的默认行为挂
     会把假人塞进看不见的组里；② _rgLastShot 必须同步成 S.lastShot——它初始为 0，
     若置 0 而 S.lastShot 是退出前残留的大数，重进第一帧就会把"没开枪"误判成"开枪"，
     准星对着靶子时凭空命中一次。
   ⚠ 判活**不能看 root.parent**：退出时 root 压根没被摘掉（见根因②），parent 一直非 null，
     会把它误判成"活着"从而不补建（实测踩过）。唯一可靠的判据是**还在不在 enemies 里**。 */
function rangeEnsureDummies(){
  try{
    if(typeof rangeMode!=='function'||!rangeMode())return;
    /* 兜底：图没建好（靶子全没了）→ 拆旧组强制重建（setMap 内部会连带补靶子和假人） */
    if(RANGE_TARGETS.length===0){
      try{
        var _og=(typeof MAP_GROUP!=='undefined')?MAP_GROUP.range:null;
        if(_og&&_og.parent)_og.parent.remove(_og);
      }catch(_){}
      if(typeof MAP_BUILT!=='undefined')MAP_BUILT.range=false;
      if(typeof setMap==='function')setMap('range',true);
      return;
    }
    /* ① 清幽灵+残留：只有**还在 enemies 里**的才算活（退出时模型没被摘掉，parent 不可信）。
         不在 enemies 的：把残留模型从地图组上摘掉（root.parent.remove 才有效），再摘引用。 */
    for(var i=RANGE_DUMMIES.length-1;i>=0;i--){
      var d=RANGE_DUMMIES[i];
      var _alive=false;
      for(var q=0;q<enemies.length;q++){ if(enemies[q]===d){_alive=true;break;} }
      if(_alive)continue;
      try{ if(d&&d.root&&d.root.parent)d.root.parent.remove(d.root); }catch(_){}
      RANGE_DUMMIES.splice(i,1);
    }
    /* ② enemies 里同口径再清一遍（双保险，防两个数组不一致） */
    for(var ei=enemies.length-1;ei>=0;ei--){
      var e=enemies[ei];
      if(e&&e.rangeDummy&&RANGE_DUMMIES.indexOf(e)<0)enemies.splice(ei,1);
    }
    /* ③ 缺哪个补哪个（一左一右，与 buildMapRange 同一组坐标） */
    var hasDmg=false,hasHeal=false;
    for(var k=0;k<RANGE_DUMMIES.length;k++){
      if(!RANGE_DUMMIES[k])continue;
      if(RANGE_DUMMIES[k].dummyKind==='heal')hasHeal=true; else hasDmg=true;
    }
    var _grp=(typeof MAP_GROUP!=='undefined')?MAP_GROUP.range:null;
    if(_grp&&typeof rangeAddDummy==='function'){
      var _savT=(typeof _mapTarget!=='undefined')?_mapTarget:null;
      try{
        _mapTarget=_grp;                          // 显式挂靶场组（见开头坑①）
        if(!hasDmg)rangeAddDummy(-30,6,'dmg');
        if(!hasHeal)rangeAddDummy(30,6,'heal');
      }finally{ _mapTarget=_savT; }
    }
    /* ④ 普通靶子的命中状态归零（新会话重新计数）；_rgLastShot 同步成当前 lastShot（坑②） */
    for(var t=0;t<RANGE_TARGETS.length;t++){
      var tg=RANGE_TARGETS[t]; if(!tg)continue;
      tg.hitT=0;tg.hits=0;
      if(tg.mat&&tg.mat.color)tg.mat.color.setHex(0xd94f4f);
    }
    _rgHits=0;
    _rgLastShot=(typeof S!=='undefined'&&typeof S.lastShot==='number')?S.lastShot:0;
  }catch(_){}
}
/* 左上角统计面板（两个假人的实时数据） */
var _rgPanel=null,_rgPanelT=0;
function rangeDummyPanel(show){
  try{
    if(!show){ if(_rgPanel&&_rgPanel.style)_rgPanel.style.display='none'; return; }
    if(!_rgPanel){
      _rgPanel=document.createElement('div');
      _rgPanel.style.cssText='position:fixed;left:12px;top:12px;z-index:55;pointer-events:none;'
        +'background:rgba(8,12,20,.74);border:1px solid rgba(127,255,208,.32);border-radius:10px;'
        +'padding:8px 12px;color:#dff6ff;font:12px/1.75 sans-serif;min-width:216px;'
        +'text-shadow:0 1px 3px #000';
      document.body.appendChild(_rgPanel);
    }
    var s='';
    for(var i=0;i<RANGE_DUMMIES.length;i++){
      var d=RANGE_DUMMIES[i]; if(!d)continue;
      var cur=Math.max(0,Math.round(d.hp));
      if(d.dummyKind==='heal'){
        s+='<div style="color:#7fe6a8;font-weight:700">💚 回血靶　'+cur+' / '+d.maxHp+'</div>'
          +'<div>累计治疗 <b style="color:#9ff5c4">'+d.stat.heal+'</b> ｜ 重置 '+d.stat.rounds+' 次</div>';
      }else{
        s+='<div style="color:#c9a6ff;font-weight:700">🎯 技能伤害靶　'+cur+' / '+d.maxHp+'</div>'
          +'<div>总伤害 <b style="color:#ffb3b3">'+d.stat.total+'</b> ｜ 命中 <b>'+d.stat.hits+'</b> 次</div>'
          +'<div>最高单次 <b style="color:#ffd166">'+d.stat.max+'</b> ｜ 打爆重置 '+d.stat.rounds+' 次</div>';
      }
    }
    if(!s)s='<div>靶场假人未生成</div>';
    _rgPanel.innerHTML=s;
    _rgPanel.style.display='block';
  }catch(_){}
}
/* 每帧推进：面向玩家 / 血条朝相机 / 外壳闪白衰减 / 血量变化统计 / 力场回血 / 面板刷新 */
function rangeDummyTick(dt){
  try{
    if(typeof rangeMode!=='function'||!rangeMode()||typeof S==='undefined'||!S.playing){ rangeDummyPanel(false); return; }
    var dtt=dt||0.016;
    var _pr=(typeof PULSE_R==='number')?PULSE_R:6;
    for(var i=0;i<RANGE_DUMMIES.length;i++){
      var d=RANGE_DUMMIES[i]; if(!d||!d.root)continue;
      try{
        d.yawPivot.rotation.y=Math.atan2(-(camera.position.x-d.root.position.x),-(camera.position.z-d.root.position.z));
        if(d.hb)d.hb.lookAt(camera.position);
      }catch(_){}
      if(d.shell&&d.shell.material&&d.shell.material.opacity>0)
        d.shell.material.opacity=Math.max(0,d.shell.material.opacity-dtt/0.16);
      /* 血量变化 → 统计。所有技能的伤害/治疗都归结到血量变化上，所以这里不用管是哪个技能 */
      if(d._lastHp===undefined)d._lastHp=d.hp;
      if(d.hp!==d._lastHp){
        var diff=d.hp-d._lastHp;
        if(diff<0){
          var dmg=-diff,deadly=(d.hp<=0);
          /* 致死那一帧的掉血其实是"攒了很久的剩余量"（可能几千），记进总伤害，但不冒充单次命中 */
          d.stat.total+=dmg;if(!deadly){d.stat.hits++;if(dmg>d.stat.max)d.stat.max=dmg;rangePopup('-'+dmg,'#ff9a9a');}
          if(d.shell&&d.shell.material)d.shell.material.opacity=0.5;
        }else{
          d.stat.heal+=diff;
          rangePopup('+'+diff,'#7fe6a8');
        }
        if(d.hb)d.hb.scale.x=Math.max(0,d.hp/d.maxHp);
        if(d.hbMat)d.hbMat.color.setHex(d.hp/d.maxHp>.5?0x00ff00:d.hp/d.maxHp>.25?0xffff00:0xff0000);
        d._lastHp=d.hp;
      }
      if(d.hp<=0){ rangeDummyReset(d); continue; }
      /* 回血靶：站在医疗脉冲的落点力场里，每 0.5 秒回 3 点（和技能说明一致；不飘字，省得刷屏） */
      if(d.dummyKind==='heal'&&typeof SK!=='undefined'&&SK&&SK.aura>0){
        var adx=d.root.position.x-SK.auraX,adz=d.root.position.z-SK.auraZ;
        if(adx*adx+adz*adz<=_pr*_pr){
          d._auraAcc=(d._auraAcc||0)+dtt;
          if(d._auraAcc>=0.5){
            d._auraAcc=0;
            var _nh=Math.min(d.maxHp,d.hp+3);
            if(_nh>d.hp){
              d.stat.heal+=(_nh-d.hp);d.hp=_nh;d._lastHp=d.hp;
              if(d.hb)d.hb.scale.x=d.hp/d.maxHp;
              if(d.hbMat)d.hbMat.color.setHex(d.hp/d.maxHp>.5?0x00ff00:0xffff00);
            }
          }
        }
      }
    }
    _rgPanelT-=dtt;
    if(_rgPanelT<=0){_rgPanelT=0.2;rangeDummyPanel(true);}
  }catch(_){}
}
function rangeTargetTick(dt){
  try{
    for(var i=0;i<RANGE_TARGETS.length;i++){
      var t=RANGE_TARGETS[i]; if(!t||!t.mat)continue;
      if(t.hitT>0){ t.hitT-=(dt||0.016); if(t.hitT<=0) t.mat.color.setHex(0xd94f4f); }   // 命中闪白后恢复
    }
    if(typeof rangeDummyTick==='function')rangeDummyTick(dt);   // 【batch180】两个特殊靶子：面朝玩家 / 血量变化统计 / 力场回血
    if(!rangeMode()||typeof S==='undefined'||!S.playing)return;
    if(S.lastShot===_rgLastShot)return;                 // 这一帧没开枪
    _rgLastShot=S.lastShot;
    if(typeof raycaster==='undefined'||typeof screenCenter==='undefined')return;
    raycaster.setFromCamera(screenCenter,camera);
    var best=null,bd=1e9,bp=null;
    for(var j=0;j<RANGE_TARGETS.length;j++){
      var tt=RANGE_TARGETS[j]; if(!tt||!tt.mesh)continue;
      var hs=raycaster.intersectObject(tt.mesh,false);
      if(hs.length&&hs[0].distance<bd&&hs[0].distance<(typeof S.range==='number'?S.range:80)){bd=hs[0].distance;best=tt;bp=hs[0].point;}
    }
    if(!best)return;
    best.hitT=0.22; best.hits=(best.hits||0)+1; _rgHits++;
    if(best.mat)best.mat.color.setHex(0xffffff);
    try{ if(typeof spawnParticle==='function')spawnParticle(bp||best.mesh.position,0x7fffd0,8,0.3); }catch(e){}
    try{ if(typeof showMsg==='function'&&(_rgHits%5===0))showMsg('🎯 已命中 '+_rgHits+' 次','#7fffd0'); }catch(e){}
  }catch(e){}
}
var S={playerName:'',hp:100,maxHp:100,score:0,kills:0,wave:0,left:0,ammo:30,maxAmmo:30,reloading:false,fireRate:50,reloadTime:1200,lastShot:0,range:80,pellets:1,spread:0,auto:true,baseSpeed:BASE_SPEED,sprintMul:1.5,sprinting:false,sens:0.003,sensMul:1,playing:false,over:false,recoilKick:0,recoilRot:0,bobPhase:0,damageMul:1.0,paused:true,recoilMul:1.0,velY:0,onGround:true,ladderCD:0,onLadder:false,landKick:0,mantle:0,mantleDur:0.5,swayX:0,swayY:0,prevYaw:0,prevPitch:0,yawVel:0,pitchVel:0,lean:0,leanX:0,leanZ:0,reloadInit:false,reloadOldDetached:false,reloadNewAttached:false,reloadDiscard:null,aiming:false,aimProgress:0,adsSpeedMul:1,hipSpreadMul:1,roll:0,crouch:false,touchCrouch:false,sprintLatch:false,joySprint:false,wTap:0,crP:0};
// —— 腿部尺寸（模型与"蹲下时相机该降多少"共用同一套数字）——
// 为什么要共用：蹲下是"腿折起来、上身下沉、脚还踩在地上"。相机降多少必须和模型的沉多少
// 一模一样，否则别人看你蹲下时脚会陷进地里（或人浮在半空）。
var LEG_HIP_Y=0.78, LEG_THIGH=0.40, LEG_SHIN=0.26, BOOT_H=0.12;
// 蹲下时：大腿前折 CROUCH_THIGH，小腿相对大腿回折 CROUCH_SHIN（弧度）。
// CROUCH_DROP 不是拍脑袋写的，是由腿部三段长度解出来的 —— 保证蹲下时脚底正好落回地面。
var CROUCH_THIGH=1.42, CROUCH_SHIN=-2.48;
var CROUCH_DROP=LEG_HIP_Y-LEG_THIGH*Math.cos(CROUCH_THIGH)-(LEG_SHIN+BOOT_H)*Math.cos(CROUCH_THIGH+CROUCH_SHIN);
// 冲刺的两种触发方式：电脑＝双击 W（两次间隔小于 SPRINT_TAP_MS）；手机＝摇杆推到最前（ny < SPRINT_JOY_NY）
var SPRINT_TAP_MS=320, SPRINT_JOY_NY=-0.78;
// 冲刺开关（纯函数：校验桩可以直接喂参数测，不必去模拟整个 update）
function sprintOn(mv,latch,joy){return !!(joy||(latch&&mv));}
// 一次性关掉冲刺的所有来源（松开 W / 开镜 / 蹲下 / 打开菜单 都调它）
function sprinting_off(){S.sprinting=false;S.sprintLatch=false;S.joySprint=false;}
var keys={},mouseDown=false,rightMouseDown=false,freshTrigger=false,enemies=[],bullets=[],enemyBullets=[],pickups=[],obstacles=[];
// ==================== 键位映射（电脑端可在设置里自定义）====================
var KEYMAP_KEY='gunGame.keymap.v1';
var KEYDEF={forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD',crouch:'ShiftLeft',jump:'Space',leanL:'KeyQ',leanR:'KeyE',reload:'KeyR',ladder:'KeyF',weapon1:'Digit1',weapon2:'Digit2',skill:'KeyV',skill2:'KeyT',skill3:'KeyN',inspect:'KeyI'};   // weapon2 从 KeyV 改回 Digit2；V/T/N 给英雄三技能；B 改为「打开武器选择界面」；【batch203】I＝检视（只有纪念枪有动作）
var KEYLABEL={forward:'前进',back:'后退',left:'向左',right:'向右',crouch:'蹲下(切换)',jump:'跳跃',leanL:'左探头',leanR:'右探头',reload:'换弹',ladder:'上/下梯子',weapon1:'切到枪',weapon2:'切到刀',skill:'技能①',skill2:'技能②',skill3:'技能③',inspect:'检视武器'};
var KEYORDER=['forward','back','left','right','crouch','jump','leanL','leanR','reload','ladder','weapon1','weapon2','skill','skill2','skill3','inspect'];
var KEYMAP={};for(var _ka in KEYDEF)KEYMAP[_ka]=KEYDEF[_ka];
var _raw={};
(function(){
  // 逻辑按键 keys.KeyW 等改为“读映射”：绑定变了立刻生效，游戏里 50 多处读取无需改动
  // 【注意】Shift 从「冲刺」改成了「蹲下（按住）」；冲刺不再占键位（电脑＝双击 W、手机＝摇杆最前）。
  var reads={KeyW:'forward',KeyS:'back',KeyA:'left',KeyD:'right',KeyQ:'leanL',KeyE:'leanR',KeyF:'ladder',ShiftLeft:'crouch',ShiftRight:'crouch',Space:'jump'};
  for(var c in reads){(function(code,act){
    Object.defineProperty(keys,code,{configurable:true,get:function(){return !!_raw[KEYMAP[act]];},set:function(v){_raw[KEYMAP[act]]=v;}});
  })(c,reads[c]);}
})();
function codeLabel(c){
  if(!c)return '未设置';
  var m={Space:'空格',ShiftLeft:'Shift',ShiftRight:'Shift',ControlLeft:'Ctrl',ControlRight:'Ctrl',AltLeft:'Alt',AltRight:'Alt',Escape:'Esc',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Enter:'回车',Tab:'Tab',Backspace:'退格'};
  if(m[c])return m[c];
  if(c.indexOf('Key')===0)return c.slice(3);
  if(c.indexOf('Digit')===0)return c.slice(5);
  if(c.indexOf('Numpad')===0)return '小键盘'+c.slice(6);
  return c;
}
function keymapLoad(){try{var m=JSON.parse(localStorage.getItem(KEYMAP_KEY)||'null');if(m){for(var k in KEYDEF){if(Object.prototype.hasOwnProperty.call(m,k)&&m[k])KEYMAP[k]=m[k];}if(KEYMAP.skill2==='KeyB')KEYMAP.skill2='KeyT';}}catch(e){}}
function keymapSave(){try{localStorage.setItem(KEYMAP_KEY,JSON.stringify(KEYMAP));}catch(e){}}


// ==================== PARTICLES ====================
/* 【batch196】粒子系统：CPU 逐粒子搬运 → GPU 顶点动画（用户问「能不能把 CPU 开销换成 GPU」）
   原实现：80 个独立 Mesh + 80 份独立材质。每帧 CPU 要逐个
     · 改 position（整条父链矩阵要重算）
     · 改 material.opacity（换材质 → uniform 重传）
     · 发 80 次 draw call（每次都是 CPU 算矩阵 / 剔除 / 绑材质）
   一次爆炸就把 CPU 花在「搬数字」上，GPU 反而在闲着。
   现在：一个 THREE.Points + 自定义着色器，全部粒子一次 draw call 画完；
     位移 / 阻尼 / 重力 / 淡出都按「出生时间 + 初速度」在顶点着色器里解析求出，
     CPU 每帧只推一个 uniform（当前时间），**零逐粒子循环**。
   物理与原实现等价（不是重新调手感）：
     · 原：每帧 pos += vel; vel *= 0.94  → 位移累加和 = v0·(1−0.94ᵗ)/0.06（t = 已过帧数）
     · 原：重力每帧 vel.y −= 0.012       → 二阶累加，用 t²/2 连续近似（带阻尼修正）
     · 原：opacity = 剩余帧/30           → 这里换成 (寿命 − 已过)/30
   槽位分配仍由 CPU 按时间算，但只在 spawn 时扫一遍，每帧不再碰。
   ⚠️ 对外 API 一字未改：spawnParticle(pos,color,count,spread,grav) / updateParticles()。
      activeParticles 保留成空数组 —— 剧情模式清场时的 .mesh.visible / .length=0 两行不会报错。 */
var particlePool=[],activeParticles=[];
var PT={点:null, mat:null, 开:false, 脏:false, 基准:0, 尺寸:0.11, 上限:48, _err:'' };
(function(){
  try{
    var pos=new Float32Array(MAX_PARTICLES*3);
    var vel=new Float32Array(MAX_PARTICLES*3);
    var col=new Float32Array(MAX_PARTICLES*3);
    var tim=new Float32Array(MAX_PARTICLES*3);          // x=出生时刻(秒) y=寿命(帧) z=是否受重力
    var G=new THREE.BufferGeometry();
    G.setAttribute('position',new THREE.BufferAttribute(pos,3));
    G.setAttribute('aVel',new THREE.BufferAttribute(vel,3));
    G.setAttribute('aCol',new THREE.BufferAttribute(col,3));
    G.setAttribute('aTime',new THREE.BufferAttribute(tim,3));
    var VS=[
      'attribute vec3 aVel;',
      'attribute vec3 aCol;',
      'attribute vec3 aTime;',
      'uniform float uNow;',
      'uniform float uScale;',
      'uniform float uSize;',
      'varying vec3 vCol;',
      'varying float vA;',
      'void main(){',
      '  float lifeF=aTime.y;',
      '  float ageF=(uNow-aTime.x)*60.0;',
      '  vCol=aCol;',
      /* 未出生 / 已超寿命 → 丢到裁剪空间外（点大小 0，光栅化阶段直接跳过） */
      '  if(lifeF<=0.0||ageF<0.0||ageF>=lifeF){',
      '    vA=0.0; gl_Position=vec4(2.0,2.0,2.0,1.0); gl_PointSize=0.0; return;',
      '  }',
      /* 阻尼位移闭式：Σ 0.94^k (k=0..t−1) = (1−0.94ᵗ)/0.06 */
      '  float k=(1.0-pow(0.94,ageF))/0.06;',
      '  vec3 p=position+aVel*k;',
      /* 重力：原实现每帧 vel.y−=0.012 且同时受 0.94 阻尼 → 用 t²/2 连续近似再乘阻尼修正 */
      '  if(aTime.z>0.5){',
      '    p.y-=0.012*ageF*ageF*0.5*(0.55+0.45*pow(0.94,ageF));',
      '  }',
      '  vec4 mv=modelViewMatrix*vec4(p,1.0);',
      '  vA=clamp((lifeF-ageF)/30.0,0.0,1.0);',
      '  gl_Position=projectionMatrix*mv;',
      /* 点的世界尺寸换算成像素：uScale = 画布高/2（和 three 自己的 PointsMaterial 同一口径） */
      '  gl_PointSize=clamp(uSize*(uScale/max(-mv.z,0.1)),1.0,24.0);',
      '}'
    ].join('\n');
    var FS=[
      'precision mediump float;',
      'varying vec3 vCol;',
      'varying float vA;',
      'void main(){',
      '  if(vA<=0.001) discard;',
      '  gl_FragColor=vec4(vCol,vA);',
      '}'
    ].join('\n');
    var m=new THREE.ShaderMaterial({
      vertexShader:VS, fragmentShader:FS,
      transparent:true, depthWrite:false, depthTest:true,
      uniforms:{ uNow:{value:0}, uScale:{value:360}, uSize:{value:PT.尺寸} }
    });
    var pts=new THREE.Points(G,m);
    pts.frustumCulled=false;            /* 粒子会飞出包围球，不能按包围球剔除 */
    pts.userData._粒子=1;
    scene.add(pts);
    PT.点=pts; PT.mat=m; PT.开=true;
    for(var i=0;i<MAX_PARTICLES;i++){
      particlePool.push({i:i, start:-999, life:0, mesh:{visible:true}});   /* mesh 只是兼容占位，不渲染 */
    }
  }catch(e){ PT._err=String(e); PT.开=false; }
})();
function initParticlePool(){ /* 【batch196】粒子几何在脚本加载时就建好了（这里只保留调用点，避免改所有入口） */ }
function spawnParticle(pos,color,count,spread,grav){
  if(!PT.开||!PT.点)return;
  spread=spread||0.3;
  var now=performance.now()/1000, s=0, a=(PT.点.geometry.attributes);
  var P=a.position.array, V=a.aVel.array, C=a.aCol.array, T=a.aTime.array;
  var c=new THREE.Color(color);
  for(var i=0;i<MAX_PARTICLES&&s<count;i++){
    var p=particlePool[i];
    var ageF=(now-p.start)*60;
    if(ageF<p.life)continue;                       /* 槽位还在飞，跳过 */
    var o=i*3;
    P[o]=pos.x; P[o+1]=pos.y; P[o+2]=pos.z;
    V[o]=(Math.random()-.5)*spread;
    V[o+1]=Math.random()*spread*.7;
    V[o+2]=(Math.random()-.5)*spread;
    C[o]=c.r; C[o+1]=c.g; C[o+2]=c.b;
    p.life=20+(Math.random()*15|0);                /* 和原来一样：20~35 帧 */
    T[o]=now; T[o+1]=p.life; T[o+2]=grav?1:0;
    p.start=now;
    s++;
  }
  PT.脏=true;
}
function updateParticles(){
  if(!PT.开||!PT.点)return;
  PT.基准=performance.now()/1000;
  PT.mat.uniforms.uNow.value=PT.基准;
  /* 画布高度每帧读一次（只是读一个整数属性，不触发 layout），窗口缩放 / 分辨率自适应都跟得上 */
  try{ PT.mat.uniforms.uScale.value=(renderer.domElement.height||720)*0.5; }catch(e){}
  if(PT.脏){
    var a=PT.点.geometry.attributes;
    a.position.needsUpdate=true; a.aVel.needsUpdate=true; a.aCol.needsUpdate=true; a.aTime.needsUpdate=true;
    PT.脏=false;
  }
}
