/* 【batch244】古代陵园 + 巡逻直升机 + 大将军（js/64_陵园与将军.js）====================
   这一片放三件彼此关联的新东西，调用都在本片内（跨片一律 typeof 守卫）：

   ① 新地图「古代陵园」——**不是方盒子**：四角用封土山切掉，整块地是八边形；
      中央是**三层封土台**（每层都能走上去，台顶一座石殿），周围是环形墓道、
      碑林迷宫、石像生、枯树林、断墙残柱。地图 190×190，比火车站大得多。

   ② 天上巡逻的直升机——随机朝地面投导弹（90 点伤害），打不爆就**永久留在场上**；
      留场满 15 分钟会向总部申请核弹：**1 分钟内没击落 → 全图核爆**，
      当场炸死所有人，并在之后 1 分钟里**反复**清场。

   ③ 暗月新英雄「大将军」——爆炸长矛 / 石棺 / 分身；
      外加剧情第四章：他在陵园里被复活，得让他重新睡回去。

   【独立成片的原因】地图 / 天上的 Boss / 英雄技能 / 剧情钩子是一整套，
   分片放一起改起来不会互相串；其它分片只加了三行守卫钩子。
*/

/* ==================== ① 地图：古代陵园 ==================== */
var CEM_LIM=96;                       // 世界半径（190×190 的场子，四角被土山切掉）
var CEM_STORY_SPAWN={x:0,z:82};       // 剧情第四章固定出生点（牌坊下，面朝神道）
var 陵_石=new THREE.MeshLambertMaterial({color:0x7b7e70});
var 陵_暗=new THREE.MeshLambertMaterial({color:0x494c44});
var 陵_阶=new THREE.MeshLambertMaterial({color:0x6a6d60});
var 陵_木=new THREE.MeshLambertMaterial({color:0x39301f});
var 陵_金=new THREE.MeshLambertMaterial({color:0xb8933a});
var 陵_土=new THREE.MeshLambertMaterial({color:0x333a2c});
var 陵_水=new THREE.MeshLambertMaterial({color:0x1d2b30});

/* 装饰件：只加网格、不加碰撞（和地图里那些 deco 一个意思，但 deco 是建图函数里的局部函数，拿不到） */
function 陵饰(x,z,w,h,d,mat,y){
  var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.position.set(x,(y||0)+h/2,z);m.userData._可合并=1;_mapTarget.add(m);return m;
}
/* 一段石阶：从 fromY 往 toY 抬 k 级（每级 0.5 米，刚好在 STEP_UP=0.55 容差内，人能直接走上去） */
function 陵阶(x,z,w,d,fromY,toY,axis){
  var n=Math.max(1,Math.round((toY-fromY)/0.5)),i;
  for(i=1;i<=n;i++){
    var y=fromY+(toY-fromY)*i/n;
    /* 越高的那级越"往里"（沿 -z / +x 收）—— 不然人会先撞到最高的一级，台阶就白铺了 */
    if(axis==='z')addBox(x,z+(n/2-i+0.5)*1.0,w,y,d/n,陵_阶);
    else addBox(x+(i-n/2-0.5)*1.0,z,w/n,y,d,陵_阶);
  }
}
/* 封土山（四角）：三层台阶状土丘 —— 既是地形，也把方图切成八边形 */
function 陵角山(sx,sz){
  addBox(sx*68,sz*68,56,8,56,陵_土);
  addBox(sx*74,sz*74,44,15,44,陵_土);
  addBox(sx*81,sz*81,30,24,30,陵_土);
  陵饰(sx*81,sz*81,10,6,10,陵_暗,24);          // 山顶一块残碑
}
function buildMapCemetery(){
  makeGround(_mapTarget,0x23261f);
  var i,j,x,z;
  /* ---------- 边界：四条直墙 + 四角封土山 → 整体八边形 ---------- */
  addBox(0,-96,84,9,4,null,'border');
  addBox(0, 96,84,9,4,null,'border');
  addBox(-96,0,4,9,84,null,'border');
  addBox( 96,0,4,9,84,null,'border');
  陵角山(-1,-1);陵角山(1,-1);陵角山(-1,1);陵角山(1,1);

  /* ---------- 南端：牌坊 + 石阶广场 ---------- */
  addBox(-11,84,2.2,8,2.2,陵_石);addBox(11,84,2.2,8,2.2,陵_石);
  addLedge(0,84,24,0.9,2.2,陵_暗,'ledge',8);       // 横梁
  陵饰(0,84,9,1.4,0.5,陵_金,9.4);                  // 匾额
  for(i=-2;i<=2;i++){addBox(i*8,70,4,0.35,8,陵_阶);}   // 广场铺石（矮，不挡人）

  /* ---------- 神道：中央大道（x -8..8） ---------- */
  for(z=66;z>=-12;z-=6)addBox(0,z,16,0.12,4,陵_阶);
  /* 石像生：两侧一对一对的石人石兽（底座挡人，雕像不挡） */
  for(z=60;z>=-6;z-=12){
    for(i=-1;i<=1;i+=2){
      addBox(i*11,z,2.0,0.55,2.0,陵_石);
      陵饰(i*11,z,1.0,2.3,0.9,陵_暗,0.55);
      陵饰(i*11,z,0.8,0.8,0.8,陵_暗,2.85);
    }
  }
  /* 石灯笼：神道两侧，隔一段一座 */
  for(z=56;z>=-8;z-=16){
    for(i=-1;i<=1;i+=2){addBox(i*15,z,0.9,1.6,0.9,陵_石);陵饰(i*15,z,1.3,0.5,1.3,陵_金,1.6);}
  }

  /* ---------- 中央封土台（三级，台顶石殿）---------- */
  addBox(0,-42,64,1.6,58,陵_阶);                      // 一层台（顶 1.6）
  addLedge(0,-42,48,1.6,42,陵_阶,'ledge',1.6);        // 二层台（顶 3.2）
  addLedge(0,-42,32,1.6,28,陵_阶,'ledge',3.2);        // 三层台（顶 4.8）
  /* 正面三跑石阶：从神道一路走到台顶 */
  陵阶(0,-11.6,10,6,0,1.6,'z');
  陵阶(0,-19.6,10,6,1.6,3.2,'z');
  陵阶(0,-27.6,10,6,3.2,4.8,'z');
  /* 侧面各一条窄阶（打起来有第二条路，不至于被堵死在正面；要摆在台体外侧，不能埋进土台） */
  陵阶(-33.6,-42,6,10,0,1.6,'x');陵阶(33.6,-42,6,10,0,1.6,'x');
  /* 台顶石殿：四面墙 + 门洞 + 屋顶（屋顶能站上去，是制高点） */
  addLedge(0,-56,32,5.2,1.2,陵_石,'ledge',4.8);                 // 北墙
  addLedge(-15.4,-42,1.2,5.2,28,陵_石,'ledge',4.8);             // 西墙
  addLedge( 15.4,-42,1.2,5.2,28,陵_石,'ledge',4.8);             // 东墙
  addLedge(-9.5,-28,13,5.2,1.2,陵_石,'ledge',4.8);              // 南墙（左）
  addLedge( 9.5,-28,13,5.2,1.2,陵_石,'ledge',4.8);              // 南墙（右）→ 中间 6 米门洞
  addLedge(0,-42,32,0.7,30,陵_暗,'ledge',10.0);                 // 屋顶（顶面 10.7）
  /* 殿内四根石柱 + 大将军的石棺 */
  for(i=-1;i<=1;i+=2)for(j=-1;j<=1;j+=2)addLedge(i*10,-42+j*8,1.3,5.2,1.3,陵_石,'ledge',4.8);
  addLedge(0,-48,3.4,1.4,2.0,陵_暗,'ledge',4.8);
  陵饰(0,-48,3.8,0.35,2.4,陵_金,6.2);
  /* 殿前一对石阙 */
  addBox(-7,-25,1.8,5.4,1.8,陵_石);addBox(7,-25,1.8,5.4,1.8,陵_石);

  /* ---------- 环形墓道：围绕封土台的一圈碑墙（东西两道长、南北两道短，各留缺口）---------- */
  for(i=-1;i<=1;i+=2){
    for(z=-64;z<=-20;z+=6){
      if(z>-40&&z<-34)continue;                        // 留一道侧向缺口（两条路进环道）
      addBox(i*40,z,1.2,2.6,4.4,陵_暗);
    }
  }
  for(x=-34;x<=34;x+=6){
    if(x>-8&&x<8)continue;                            // 正中留门洞（正对神道与石阶）
    addBox(x,-72,4.4,2.6,1.2,陵_暗);                   // 北侧碑墙
    if(Math.abs(x)>13)addBox(x,-12,4.4,2.6,1.2,陵_暗); // 南侧碑墙（中间要给石阶让路）
  }

  /* ---------- 碑林：东西两片，密集但不规则（走位全靠它）---------- */
  for(z=54;z>=-64;z-=5.2){
    for(x=22;x<=78;x+=6.2){
      var r=Math.random();
      if(Math.abs(x)<46&&z>-80&&z<-4)continue;          // 封土台范围内不放
      if(x>40&&x<52&&z>-30&&z<40)continue;              // 留出一条南北通路
      if(r<0.22)continue;                               // 随机留空，避免"整齐的方格"
      var hh=1.3+Math.random()*1.5;
      addBox(x,z,1.6,hh,0.4,陵_石);
      陵饰(x,z,2.0,0.14,0.6,陵_暗,hh);
    }
    for(x=-22;x>=-78;x-=6.2){
      if(Math.abs(x)<46&&z>-80&&z<-4)continue;
      if(x<-40&&x>-52&&z>-30&&z<40)continue;
      if(Math.random()<0.22)continue;
      var hh2=1.3+Math.random()*1.5;
      addBox(x,z,1.6,hh2,0.4,陵_石);
      陵饰(x,z,2.0,0.14,0.6,陵_暗,hh2);
    }
  }

  /* ---------- 两座"墓坑"：矮土垄围出一圈下沉地（地形有高有低，不是一块平地）---------- */
  for(i=-1;i<=1;i+=2){
    var tx=i*62;
    addBox(tx-9,20,2.2,1.9,34,陵_土);addBox(tx+9,20,2.2,1.9,34,陵_土);
    addBox(tx,4,20,1.9,2.2,陵_土);addBox(tx,36,20,1.9,2.2,陵_土);
    陵饰(tx,20,14,0.08,26,陵_水,0.02);                 // 坑底积水（纯视觉）
  }

  /* ---------- 断墙残柱：零散掩体 ---------- */
  var 残=[[-30,44,10],[-46,58,7],[34,52,9],[52,44,6],[-58,-40,8],[58,-46,9],
          [-26,6,5],[28,2,6],[-70,8,6],[70,-8,7],[6,58,5],[-14,74,4],[16,66,4]];
  for(i=0;i<残.length;i++){addBox(残[i][0],残[i][1],残[i][2],1.6+Math.random()*0.8,1.1,陵_暗);}

  /* ---------- 枯树林：纯装饰（不挡人，穿过去有"枯枝擦身"的错觉）---------- */
  for(i=0;i<46;i++){
    var ax=(Math.random()*2-1)*90,az=(Math.random()*2-1)*90;
    if(Math.abs(ax)<20&&az>-14)continue;                       // 神道不长树
    if(Math.abs(ax)<36&&az<-6&&az>-76)continue;                // 封土台不长树
    陵饰(ax,az,0.5,3+Math.random()*3,0.5,陵_木,0);
    陵饰(ax,az,2.2,0.3,0.3,陵_木,2.6);
  }
}
/* 这张图的自定义主题：夜里、雾更低、月光偏冷 */
MAP_THEME.cemetery={bg:0x0d1216,fog:0x131b20,fogD:0.0058};
/* 出生点：神道 / 广场 / 两翼空地 / 墓坑边 / 台前，全部避开建筑 */
MAP_SPAWNS.cemetery=[
  [0,86],[0,72],[0,58],[0,44],[0,30],[0,16],[0,2],
  [-16,64],[16,64],[-16,40],[16,40],[-16,16],[16,16],
  [-26,70],[26,70],[-26,50],[26,50],[-28,26],[28,26],
  [-30,-4],[30,-4],[-52,20],[52,20],[-52,44],[52,44],
  [-62,60],[62,60],[-70,30],[70,30],[-70,-20],[70,-20],
  [-52,-24],[52,-24],[-24,-70],[24,-70],[0,-80],[-34,4],[34,4]
];
MAPS.push({
  id:'cemetery', name:'古代陵园', icon:'⚰', color:'#c9b47a', ladder:false, tower:false,
  limit:CEM_LIM,
  desc:'依山开出来的古代陵园：四角是三层封土山，中央一座三级封土台、台顶停着大将军的石棺；'+
       '环形墓道、两片碑林迷宫、石像生、枯树林、两处积水墓坑。天上会有直升机巡逻 —— 它会往地面投导弹，'+
       '打不爆它就永远不走；留场满 15 分钟它会申请核弹，1 分钟内没击落，全图清场。',
  build:function(){ buildMapCemetery(); }
});

/* ==================== ② 天上的直升机 ==================== */
/* 参数都放在一处，调数值不用满地找 */
var HELI_HP=1600;               // 直升机血量（步枪 25/发 → 64 发；重机枪/狙击更快）
var HELI_RADIUS=34;             // 巡逻半径
var HELI_ALT=28;                // 巡逻高度
var HELI_MISSILE_MIN=7.5, HELI_MISSILE_MAX=11.5;   // 两发导弹之间的间隔（秒）
var HELI_MISSILE_DMG=90;        // 导弹直击伤害
var HELI_MISSILE_R=7;           // 导弹爆炸半径
var HELI_NUKE_AT=900;           // 留场满 15 分钟 → 申请核弹
var HELI_NUKE_WINDOW=60;        // 申请之后 60 秒内必须击落
var HELI_AFTERMATH=60;          // 核爆之后还要持续清场 60 秒

var HELI={on:false,dead:false,hp:0,obj:null,rotor:[],tail:null,blink:null,
          ang:0,fieldT:0,missileT:0,phase:'',nukeT:0,afterT:0,killT:0,
          pos:new THREE.Vector3(0,HELI_ALT,0),ring:null,hud:null,ban:null};
var 陵_导弹=[];

/* 【batch246】命中飘字：打天上的直升机时用来显示扣了多少血（不然只有一粒火花，看不出打没打中） */
function 陵_飘字(txt,world){
  try{
    if(!world||typeof camera==='undefined'||!camera)return;
    var v=world.clone().project(camera);
    if(v.z>1)return;
    var d=document.createElement('div');
    d.textContent=txt;
    d.style.cssText='position:fixed;left:'+((v.x*0.5+0.5)*innerWidth).toFixed(0)+'px;top:'+
      ((-v.y*0.5+0.5)*innerHeight).toFixed(0)+'px;transform:translate(-50%,-50%);'+
      'font:700 20px/1 "Microsoft YaHei",system-ui,sans-serif;color:#ffd24d;'+
      'text-shadow:0 2px 6px rgba(0,0,0,.9);pointer-events:none;z-index:55;'+
      'transition:transform .55s ease-out,opacity .55s ease-out';
    document.body.appendChild(d);
    requestAnimationFrame(function(){d.style.transform='translate(-50%,-190%)';d.style.opacity='0.15';});
    setTimeout(function(){if(d.parentNode)d.parentNode.removeChild(d);},700);
  }catch(e){}
}

function 陵_建直升机(){
  var g=new THREE.Group();
  var 壳=new THREE.MeshLambertMaterial({color:0x3d4a3a});
  var 暗=new THREE.MeshLambertMaterial({color:0x232a24});
  var 玻=new THREE.MeshLambertMaterial({color:0x7fd6ff,transparent:true,opacity:0.45});
  var 金=new THREE.MeshLambertMaterial({color:0xb8933a});
  var 机身=new THREE.Mesh(new THREE.BoxGeometry(4.4,1.7,2.2),壳);g.add(机身);
  var 机头=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.2,1.9),壳);机头.position.set(2.5,0.1,0);g.add(机头);
  var 舱=new THREE.Mesh(new THREE.BoxGeometry(1.3,0.9,1.7),玻);舱.position.set(2.6,0.55,0);g.add(舱);
  var 尾梁=new THREE.Mesh(new THREE.BoxGeometry(5.2,0.5,0.5),暗);尾梁.position.set(-4.6,0.2,0);g.add(尾梁);
  var 尾翼=new THREE.Mesh(new THREE.BoxGeometry(0.4,1.8,0.35),壳);尾翼.position.set(-7.1,0.7,0);g.add(尾翼);
  var 尾桨=new THREE.Mesh(new THREE.BoxGeometry(0.12,1.9,0.12),暗);尾桨.position.set(-7.2,0.7,0.25);g.add(尾桨);
  HELI.tail=尾桨;
  /* 主旋翼：两根交叉的长桨 + 中间桨毂 */
  var 桨=[];var k;
  for(k=0;k<2;k++){
    var b=new THREE.Mesh(new THREE.BoxGeometry(11,0.12,0.55),暗);
    b.position.set(0,1.15,0);b.rotation.y=k*Math.PI/2;g.add(b);桨.push(b);
  }
  var 毂=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.35,0.4,8),金);毂.position.set(0,1.18,0);g.add(毂);
  HELI.rotor=桨;
  /* 起落架 */
  for(k=-1;k<=1;k+=2){
    var 架=new THREE.Mesh(new THREE.BoxGeometry(3.4,0.14,0.14),暗);
    架.position.set(0,-1.05,k*0.85);g.add(架);
    var 腿=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.8,0.14),暗);
    腿.position.set(0.8,-0.7,k*0.85);g.add(腿);
  }
  /* 机身两侧的暗月徽记 + 机腹投弹口 */
  var 徽=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.9,0.06),金);徽.position.set(0,0.1,1.13);g.add(徽);
  var 徽2=徽.clone();徽2.position.set(0,0.1,-1.13);g.add(徽2);
  var 灯=new THREE.Mesh(new THREE.SphereGeometry(0.18,8,8),new THREE.MeshBasicMaterial({color:0xff3b3b}));
  灯.position.set(-7.2,0.7,0.4);g.add(灯);HELI.blink=灯;
  /* 机腹的红色瞄准环（跟着导弹落点走，给玩家"要被打了"的提示） */
  var ring=new THREE.Mesh(new THREE.RingGeometry(2.6,3.1,28),new THREE.MeshBasicMaterial({color:0xff3b3b,transparent:true,opacity:0.55,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;ring.visible=false;scene.add(ring);HELI.ring=ring;
  /* 【batch245】**不要禁用射线**：直升机是敌人，子弹靠 `raycaster.intersectObjects(e.g.children,true)`
     才打得到。以前这里为了让"特效模型不挡子弹"统一写了 `o.raycast=function(){}`，
     结果天上那架**根本打不中**（用户：步枪射程内也打不到飞机）。现在反过来给它一个更好打的隐形命中盒。 */
  var 命中=new THREE.Mesh(new THREE.BoxGeometry(9.5,3.2,3.2),
    new THREE.MeshBasicMaterial({color:0xff4444,transparent:true,opacity:0.001,depthWrite:false}));
  命中.position.set(-1.4,0.2,0);命中.name='hitspot';g.add(命中);HELI.hitbox=命中;
  scene.add(g);
  return g;
}
/* HUD：左上角一条"直升机"状态（血量 + 留场时间 + 核弹倒计时） */
function 陵_建直升机HUD(){
  if(HELI.hud)return;
  var d=document.createElement('div');d.id='heliHud';
  d.style.cssText='position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:34;display:none;'+
    'padding:7px 14px;border-radius:8px;background:rgba(8,12,14,.72);border:1px solid rgba(201,180,122,.45);'+
    'color:#e8dfc6;font:600 13px/1.5 system-ui,"Microsoft YaHei",sans-serif;text-align:center;pointer-events:none;'+
    'text-shadow:0 1px 3px #000;min-width:260px';
  document.body.appendChild(d);HELI.hud=d;
  var b=document.createElement('div');b.id='heliBan';
  b.style.cssText='position:fixed;left:0;right:0;top:34%;z-index:35;display:none;text-align:center;pointer-events:none;'+
    'font:900 34px/1.35 system-ui,"Microsoft YaHei",sans-serif;color:#ff5a5a;text-shadow:0 0 18px rgba(255,40,40,.85),0 3px 0 #000;';
  document.body.appendChild(b);HELI.ban=b;
}
function 陵_横幅(文,色,毫秒){
  陵_建直升机HUD();
  var b=HELI.ban;if(!b)return;
  if(!文){b.style.display='none';return;}
  b.textContent=文;b.style.color=色||'#ff5a5a';b.style.display='block';
  clearTimeout(陵_横幅._t);陵_横幅._t=setTimeout(function(){b.style.display='none';},毫秒||2600);
}
function 直升机出现(){
  if(HELI.on)return;
  陵_建直升机HUD();
  HELI.on=true;HELI.dead=false;HELI.hp=HELI_HP;HELI.fieldT=0;HELI.phase='';
  HELI.nukeT=0;HELI.afterT=0;HELI.killT=0;HELI.missileT=6;HELI.ang=Math.random()*6.28;
  HELI.obj=陵_建直升机();
  HELI.obj.position.set(HELI_RADIUS,HELI_ALT,0);
  /* 也塞进 enemies：这样子弹的射线能打到它（21 分片只对 enemies 做射线） */
  if(!HELI.e){
    HELI.e={helix:true,noAI:true,type:'tank',isNet:false,
            root:HELI.obj,g:HELI.obj,head:null,
            hp:HELI_HP,maxHp:HELI_HP,sz:3.2,sc:0,sc_值:0,gold:0,
            flash:0,hb:null,hbMat:null,aiState:'idle'};
    /* 【必须给一个真的血条对象】21 分片的命中分支会无条件写 `e.hb.scale.x = 剩余血量比`
       —— 给 null 就是"一枪打中直升机直接报错"。这里塞一个隐藏的小条，只当占位。 */
    var _hb=new THREE.Mesh(new THREE.BoxGeometry(1,0.08,1),new THREE.MeshBasicMaterial({color:0xff4444}));
    _hb.visible=false;HELI.e.hb=_hb;HELI.e.hbMat=_hb.material;
    enemies.push(HELI.e);
  }
  if(HELI.hud)HELI.hud.style.display='block';
  陵_横幅('⚠ 陵园上空出现一架直升机','#ffb347',3200);
  showMsg('⚠ 陵园上空出现一架直升机：它会往下投导弹。打不爆它，它就永远不走','#ffb347');
  if(typeof 音频提示==='function')音频提示();
}
function 直升机关闭(){
  HELI.on=false;HELI.dead=false;
  if(HELI.obj){if(HELI.obj.parent)HELI.obj.parent.remove(HELI.obj);HELI.obj=null;}
  if(HELI.ring){HELI.ring.visible=false;}
  if(HELI.e){var i=enemies.indexOf(HELI.e);if(i>=0)enemies.splice(i,1);HELI.e=null;}
  if(HELI.hud)HELI.hud.style.display='none';
  陵_横幅('');
  for(var k=陵_导弹.length-1;k>=0;k--){if(陵_导弹[k].m.parent)陵_导弹[k].m.parent.remove(陵_导弹[k].m);}
  陵_导弹.length=0;
}
/* --- 导弹：从机腹丢下去，落地炸 90 --- */
/* 【batch245】"给定高度往下探"的脚下地面高度。
   ⚠️ 以前这里一律写 `groundHeightAt(x,z,GROUND_Y+2)`（＝按 2 米眼高探）——
   陵园的中央是三级封土台（1.6 / 3.2 / 4.8 米），2 米探不到台顶，于是
   **台面被当成基础地面 0.12**：大将军一进 boss 就整只埋进土里（用户：生成在地里、打不到），
   长矛预览也会在台前"扎空"。凡是"在某个高度上找脚下那张面"，都要把那个高度传进来。 */
function 陵_脚下(x,z,y){
  return groundHeightAt(x,z,(typeof y==='number')?y:(GROUND_Y+2))-GROUND_Y;
}
function 陵_投导弹(tx,tz){
  var 体=new THREE.Group();
  var 壳=new THREE.MeshLambertMaterial({color:0x4a4a48});
  var 红=new THREE.MeshLambertMaterial({color:0xa32b2b});
  var b=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.16,1.5,8),壳);b.rotation.x=Math.PI/2;体.add(b);
  var h=new THREE.Mesh(new THREE.ConeGeometry(0.2,0.5,8),红);h.rotation.x=-Math.PI/2;h.position.z=0.9;体.add(h);
  var f=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.06,0.35),壳);体.add(f);
  体.position.copy(HELI.pos);体.position.y-=1.2;
  体.traverse(function(o){o.raycast=function(){};});
  scene.add(体);
  陵_导弹.push({m:体,tx:tx,tz:tz,vy:-6,life:14,t:0,trail:0});
  陵_横幅('⚠ 导弹来袭','#ff7a45',1500);
  if(HELI.ring){
    HELI.ring.visible=true;
    HELI.ring.position.set(tx,陵_脚下(tx,tz,GROUND_Y+12)+0.06,tz);
  }
}
function 陵_导弹Tick(dt){
  for(var i=陵_导弹.length-1;i>=0;i--){
    var p=陵_导弹[i];
    p.t+=dt;p.vy-=26*dt;p.life-=dt;
    p.m.position.y+=p.vy*dt;
    /* 朝落点缓慢修正（看起来像制导炸弹，但不会追着你拐弯） */
    p.m.position.x+=(p.tx-p.m.position.x)*Math.min(1,dt*1.5);
    p.m.position.z+=(p.tz-p.m.position.z)*Math.min(1,dt*1.5);
    p.m.rotation.x=Math.atan2(-p.vy,2.5);
    var g=陵_脚下(p.m.position.x,p.m.position.z,p.m.position.y);   /* 按导弹自己此刻的高度探，台面上空也能正确落地 */
    if(p.m.position.y<=g+0.2||p.life<=0){
      var px=p.m.position.x,py=g+0.3,pz=p.m.position.z;
      陵_爆炸(px,py,pz,HELI_MISSILE_R,HELI_MISSILE_DMG,0xff8a3d);
      if(p.m.parent)p.m.parent.remove(p.m);
      陵_导弹.splice(i,1);
      if(HELI.ring)HELI.ring.visible=false;
    }
  }
}
/* --- 通用爆炸：玩家 + 场上所有 AI（含远端玩家走 netHitRemote）--- */
function 陵_爆炸(x,y,z,r,dmg,色,跳过){
  try{
    spawnParticle(new THREE.Vector3(x,y,z),色||0xff8a3d,26,0.5,true);
    spawnParticle(new THREE.Vector3(x,y,z),0xffe08a,12,0.35,true);
  }catch(e){}
  /* 玩家 */
  var py=standSurfY()+1.0;
  var dx=camera.position.x-x,dy=py-y,dz=camera.position.z-z;
  if(dx*dx+dy*dy+dz*dz<=r*r&&S.hp>0&&跳过!=='玩家')takeDmg(dmg,null);
  /* AI / 远端玩家 */
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];
    if(!e||e===跳过)continue;
    if(e.isNet?(!e.alive):(e.hp<=0))continue;
    var ep=heroEntWorld(e);
    var dx2=ep.x-x,dy2=(ep.y+1.0)-y,dz2=ep.z-z;
    if(dx2*dx2+dy2*dy2+dz2*dz2>r*r)continue;
    if(e.isNet){try{netHitRemote(e,false,dmg,new THREE.Vector3(ep.x,ep.y+1.0,ep.z));}catch(_){}continue;}
    e.hp-=dmg;e.flash=0.3;
    if(e.hb)e.hb.scale.x=Math.max(0,e.hp/e.maxHp);
    if(e.hbMat)e.hbMat.color.setHex(e.hp/e.maxHp>.5?0x00ff00:(e.hp/e.maxHp>.25?0xffff00:0xff0000));
    if(e.hp<=0&&typeof killEnemy==='function')killEnemy(e,i,false);
  }
}
/* --- 直升机被击落 --- */
function 直升机坠毁(){
  if(!HELI.on||HELI.dead)return;
  HELI.dead=true;HELI.on=false;
  var px=HELI.pos.x,py=HELI.pos.y,pz=HELI.pos.z;
  陵_横幅('直升机被击落','#7fffd0',3000);
  showMsg('✅ 直升机被击落 —— 核弹威胁解除','#7fffd0');
  if(HELI.e){HELI.e.hp=0;}
  /* 残骸往下掉，落地再炸一次（砸到人有 60 伤害） */
  var 残=HELI.obj;
  if(残){
    var t0=performance.now();
    (function 坠落(){
      if(!残.parent)return;
      var k=(performance.now()-t0)/1400;
      残.position.y=py-(py)*Math.min(1,k*k);
      残.rotation.z+=0.06;残.rotation.x+=0.03;
      if(k<1)requestAnimationFrame(坠落);
      else{
        陵_爆炸(残.position.x,1.0,残.position.z,7,60,0xff8a3d);
        if(残.parent)残.parent.remove(残);
      }
    })();
  }
  if(typeof 陵_爆点==='function')陵_爆点(px,py,pz);
  if(HELI.hud)HELI.hud.style.display='none';
  if(HELI.ring)HELI.ring.visible=false;
  HELI.obj=null;
  if(HELI.e){var i=enemies.indexOf(HELI.e);if(i>=0)enemies.splice(i,1);HELI.e=null;}
}
/* --- 核弹 --- */
function 陵_投核弹(){
  HELI.phase='after';HELI.afterT=HELI_AFTERMATH;HELI.killT=0;
  陵_横幅('☢ 核 弹 投 下','#ff2a2a',6000);
  showMsg('☢ 核弹落下 —— 全图清场','#ff2a2a');
  var f=document.createElement('div');
  f.style.cssText='position:fixed;inset:0;z-index:60;background:#ffd8a8;opacity:0;pointer-events:none;transition:opacity .18s';
  document.body.appendChild(f);
  requestAnimationFrame(function(){f.style.opacity='0.95';});
  setTimeout(function(){f.style.transition='opacity 2.4s';f.style.opacity='0';},260);
  setTimeout(function(){if(f.parentNode)f.parentNode.removeChild(f);},3200);
  /* 先炸一轮：全图所有人 */
  陵_清场();
  /* 核弹落点的大爆炸（纯视觉） */
  try{
    for(var k=0;k<26;k++){
      spawnParticle(new THREE.Vector3((Math.random()*2-1)*70,2,(Math.random()*2-1)*70),0xff8a3d,16,1.2,true);
    }
  }catch(e){}
}
/* 杀光全图：玩家 + 所有 AI（穿透无敌：虚化 / 暗影也躲不掉） */
function 陵_清场(){
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];
    if(!e||e===HELI.e)continue;
    if(e.isNet?(!e.alive):(e.hp<=0))continue;
    if(e.isNet){try{netHitRemote(e,false,99999,heroEntWorld(e));}catch(_){}continue;}
    e.hp=0;e.flash=0.4;
    if(typeof killEnemy==='function')killEnemy(e,i,false);
  }
  if(S.hp>0)takeDmg(999999,null,true);        // 第三参＝穿透无敌
}
/* --- 直升机主循环 --- */
function 直升机Tick(dt){
  /* 只有**真的进了联机房间**才不做本地直升机（房间地图由服务器定，各客户端各算各的会互相矛盾）。
     ⚠️ 不能用 netIsMulti() 一刀切：服务器托管的网页只要 URL 没有 ?solo=1 它就算"多人页面"，
     连房间都没进也返回 true —— 那样玩家在服务器页面上玩单人永远见不到直升机。 */
  var 真联机=false;
  try{ 真联机=!!(typeof netIsMulti==='function'&&netIsMulti()&&typeof NET!=='undefined'&&NET&&NET.connected); }catch(e){}
  if(真联机){
    if(HELI.on)直升机关闭();
    return;
  }
  if(!HELI.on){
    if(curMapId==='cemetery'&&!HELI.dead&&S.playing&&!S.over)直升机出现();
    return;
  }
  if(curMapId!=='cemetery'){直升机关闭();return;}
  var now=performance.now();
  HELI.fieldT+=dt;
  /* 巡逻：绕场一圈一圈飞，机头朝着前进方向 */
  HELI.ang+=dt*0.16;
  HELI.pos.set(Math.cos(HELI.ang)*HELI_RADIUS,HELI_ALT+Math.sin(HELI.ang*2.1)*1.6,Math.sin(HELI.ang)*HELI_RADIUS);
  if(HELI.obj){
    HELI.obj.position.copy(HELI.pos);
    HELI.obj.rotation.y=-HELI.ang+Math.PI/2;
    HELI.obj.rotation.z=Math.sin(HELI.ang)*0.06;
    for(var r=0;r<HELI.rotor.length;r++)HELI.rotor[r].rotation.y=now*0.045+r*Math.PI/2;
    if(HELI.tail)HELI.tail.rotation.z=now*0.06;
    if(HELI.blink)HELI.blink.material.opacity=0.35+0.65*Math.abs(Math.sin(now*0.004));
  }
  if(HELI.e){
    /* 【batch246】用户："拿枪打不到直升机"。真因不是射线 —— 子弹结算走的是 `HELI.e.hp-=dmg`（js/21），
       这里原本每帧无条件 `HELI.e.hp=HELI.hp` 把血**补回满值**：
       打上去只冒火花、HUD 血条一格不动、64 发打完也不掉血 → 看着就像"根本打不到"。
       改成"谁小听谁的"：被子弹扣掉的血要记回权威值 HELI.hp。 */
    if(typeof HELI.e.hp==='number'&&HELI.e.hp<HELI.hp)HELI.hp=HELI.e.hp;
    else HELI.e.hp=HELI.hp;
    HELI.e.maxHp=HELI_HP;HELI.e.root=HELI.obj;
    if(HELI.hp<=0&&!HELI.dead)直升机坠毁();
  }
  /* 导弹 */
  if(HELI.phase===''&&S.hp>0){
    HELI.missileT-=dt;
    if(HELI.missileT<=0){
      HELI.missileT=HELI_MISSILE_MIN+Math.random()*(HELI_MISSILE_MAX-HELI_MISSILE_MIN);
      /* 70% 砸玩家附近，30% 砸场上随机一处（有人在打 AI 的时候不至于只针对你） */
      var tx,tz;
      if(Math.random()<0.7){tx=camera.position.x+(Math.random()*2-1)*5;tz=camera.position.z+(Math.random()*2-1)*5;}
      else{tx=(Math.random()*2-1)*70;tz=(Math.random()*2-1)*70;}
      陵_投导弹(tx,tz);
    }
  }
  /* 15 分钟 → 申请核弹 */
  if(HELI.phase===''&&HELI.fieldT>=HELI_NUKE_AT){
    HELI.phase='nuke';HELI.nukeT=HELI_NUKE_WINDOW;
    陵_横幅('☢ 直升机已向总部申请核弹投送\n60 秒内击落它','#ff3b3b',6000);
    showMsg('☢ 直升机向总部发起了核弹投送 —— 60 秒内把它打下来，否则全图清场','#ff3b3b');
  }
  if(HELI.phase==='nuke'){
    HELI.nukeT-=dt;
    if(HELI.nukeT<=0)陵_投核弹();
  }
  if(HELI.phase==='after'){
    HELI.afterT-=dt;HELI.killT-=dt;
    if(HELI.killT<=0){HELI.killT=3.0;陵_清场();}          // 核爆后 1 分钟内反复清场
    if(HELI.afterT<=0)HELI.phase='';
  }
  /* HUD */
  if(HELI.hud){
    var hpr=Math.max(0,HELI.hp/HELI_HP);
    var mm=Math.floor(HELI.fieldT/60),ss=Math.floor(HELI.fieldT%60);
    var 线='🚁 直升机 <b>'+Math.max(0,Math.ceil(HELI.hp))+'</b> / '+HELI_HP;
    if(HELI.phase==='nuke')线+='<br><span style="color:#ff5a5a">☢ 核弹投送中：'+Math.ceil(HELI.nukeT)+' 秒后落弹</span>';
    else if(HELI.phase==='after')线+='<br><span style="color:#ff5a5a">☢ 核爆余波：还在清场 '+Math.ceil(HELI.afterT)+' 秒</span>';
    else 线+='<br><span style="color:#9aa">留场 '+(mm<10?'0':'')+mm+':'+(ss<10?'0':'')+ss+' · 满 15:00 申请核弹</span>';
    HELI.hud.innerHTML=线;
    HELI.hud.style.borderColor=HELI.phase?('rgba(255,80,80,.8)'):('rgba(201,180,122,.45)');
  }
  陵_导弹Tick(dt);
}

/* ==================== ③ 大将军：数据 / 长矛 / 石棺 / 分身 ==================== */
var 将军_主色=0xd9c37a, 将军_css='#d9c37a';
var HERO_GENERAL=HEROES.length;          // 追加在最后，前面的下标一个都不动
HEROES.push({
  k:'general', name:'大将军', tag:'召唤', fac:'暗月', facDesc:'佣兵团', icon:'⚔', color:将军_主色, css:将军_css,
  passive:'不坏之躯：受到的手雷 / 爆炸伤害降低 25%，倒地后爬起来的速度更快。',
  skills:[
    {k:'g_spear', name:'爆炸长矛', icon:'🗡', cd:12, dur:0,
     desc:'按 V **手持长矛** → **点攻击键**先亮出「行动预览」（一条长矛虚影直指落点）→ **再点一次攻击键**投出。'+
          '长矛直线飞出，**戳中敌人扣 70 点**并**钉在他身上**，3 秒后原地炸开 **30 点**爆炸伤害；'+
          '**扎在墙上 / 地上没有那 70 点直伤，但 30 点爆炸照样炸**。'},
    {k:'g_coffin', name:'石棺', icon:'⚰', cd:16, dur:0,
     desc:'按 B **举起石棺**，准星指地实时预览落点，**左键放下**：一具立在身前的石棺，**挡子弹、挡人、挡视线**，'+
          '自带 520 点血。**被打爆时棺盖炸开，里面爬出 2 个只听命于大将军的小兵**（它们不攻击大将军，只打其他人）。'},
    {k:'g_clone', name:'将军分身', icon:'👥', cd:55, dur:30,
     desc:'按 N 召唤一具**分身**，持续 30 秒：它会跟着你走，**自己投爆炸长矛**（同款 70+30）、'+
          '**自己立石棺**替你挡枪。分身不挡子弹、也打不死 —— 它只是替你多开一条战线。'}
  ]
});
var 将军_技能名={g_spear:'爆炸长矛',g_coffin:'石棺',g_clone:'将军分身'};

/* ---------- 【batch245】大将军是「通关奖励」，不是默认开放的 ----------
   用户：大将军要**打败第四章这个关卡**才能解锁。
   做法与闪电 / 蚀日者完全一致：只挡「选人 / 换英雄」两个入口，
   **不动 HEROES 下标、不动技能实现** —— 探针 / 剧情 Boss 照旧能直接用 HERO_GENERAL。
   解锁字段挂在 UNLOCK.general（js/40），英雄号 → 字段的映射挂在 HERO_UNLOCK_FLAG。 */
HERO_LOCKED[HERO_GENERAL]='锁定 · 通关剧情第四章「陵园惊梦」后解锁';
HERO_UNLOCK_FLAG[HERO_GENERAL]='general';
/* 老存档里可能已经存着「当前英雄＝7」（1.8.0 那一版大将军默认能用）：
   heroLoad 跑在 js/44（比这个文件早），那时 HERO_LOCKED[7] 还没登记 → 这里补一次回退。 */
try{
  if(typeof heroLocked==='function'&&heroLocked(SK.idx)){
    SK.idx=HERO_SCOUT;
    if(typeof heroSave==='function')heroSave();
  }
}catch(e){}
/* 1.8.0 通关过第四章的人（只留了 gunGame.story4.v1，没有 UNLOCK.general）：补一次迁移，别把人挡回去 */
try{
  if(!UNLOCK.general&&localStorage.getItem('gunGame.story4.v1')){UNLOCK.general=true;unlockSave();}
}catch(e){}
/* 解锁（给 console / 调试面板 / 剧情通关用）。返回 true＝这次**新**解锁了 */
function 将军解锁(静默){
  var 新=false;
  try{ 新=storyClearGeneral(); }catch(e){ 新=false; }
  try{ if(typeof buildHeroGrid==='function')buildHeroGrid(); }catch(e){}
  try{ if(typeof storyRefreshBtn==='function')storyRefreshBtn(); }catch(e){}
  if(新&&!静默){
    try{ if(typeof showMsg==='function')showMsg('⚔ 已解锁「大将军」—— 通关第四章的奖励，现在可以在「🦸 英雄」页选他出战了','#d9c37a'); }catch(e){}
  }
  return 新;
}
var 解锁大将军=将军解锁;          // 控制台中文别名（与 解锁蚀日者 一致）

/* ---------- 造模型 ---------- */
function 造将军模型(scale){
  var root=new THREE.Group();
  var 甲=new THREE.MeshLambertMaterial({color:将军_主色});
  var 暗=new THREE.MeshLambertMaterial({color:0x3a3226});
  var 金=new THREE.MeshLambertMaterial({color:0xc9a227});
  var 肤=new THREE.MeshLambertMaterial({color:0xb9926a});
  function bx(w,h,d,m,x,y,z){var o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x||0,y||0,z||0);root.add(o);return o;}
  bx(0.34,0.9,0.34,甲,-0.16,0.45,0);bx(0.34,0.9,0.34,甲,0.16,0.45,0);      // 腿
  bx(0.9,0.9,0.5,甲,0,1.35,0);                                              // 甲身
  bx(0.95,0.22,0.52,金,0,1.02,0);                                           // 腰封
  bx(0.62,0.62,0.6,肤,0,2.05,0);                                            // 头
  bx(0.72,0.3,0.66,暗,0,2.22,0);                                            // 盔
  bx(0.1,0.5,0.1,金,0,2.55,0);                                              // 盔顶红缨杆
  bx(0.3,0.3,0.3,new THREE.MeshLambertMaterial({color:0xa3262b}),0,2.75,0); // 缨
  bx(1.0,0.9,0.34,暗,0,1.3,0.42);                                           // 披风
  bx(0.26,0.8,0.26,甲,-0.55,1.35,0);bx(0.26,0.8,0.26,甲,0.55,1.35,0);      // 手臂
  root.scale.setScalar(scale||1);
  /* 【batch245】**不要禁用射线**：这段模型同时也是剧情 Boss 的实体，子弹靠
     `raycaster.intersectObjects(e.g.children,true)` 才打得到他。
     以前这里跟特效模型一样写了 `o.raycast=function(){}`，结果大将军站在台上**完全无敌**
     ——用户报的"我根本就打不到他"就是这个。 */
  return {root:root,g:root,head:null};
}
function 造长矛(len){
  var g=new THREE.Group();
  var 木=new THREE.MeshLambertMaterial({color:0x5b4630});
  var 金=new THREE.MeshLambertMaterial({color:0xc9a227});
  var 红=new THREE.MeshBasicMaterial({color:0xff5a3d,transparent:true,opacity:0.85});
  var 杆=new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.045,len,6),木);
  杆.rotation.x=Math.PI/2;g.add(杆);
  var 头=new THREE.Mesh(new THREE.ConeGeometry(0.12,0.45,6),金);
  头.rotation.x=Math.PI/2;头.position.z=len/2+0.18;g.add(头);
  var 爆=new THREE.Mesh(new THREE.SphereGeometry(0.16,8,8),红);
  爆.position.z=len/2-0.15;g.add(爆);
  g.traverse(function(o){o.raycast=function(){};});
  return g;
}
/* ---------- 手持：长矛 / 石棺（自己造，不用通用投掷物模型）---------- */
var 将军_手持=null,将军_手持种类='';
function 将军持物(kind){
  if(typeof heroHoldShow!=='function')return;
  heroHoldShow(kind);
  /* heroHoldShow 给未知 kind 会塞一个烟雾罐；这里换成自己的东西 */
  try{
    if(typeof _holdObj!=='undefined'&&_holdObj){
      camera.remove(_holdObj);_holdObj=null;
    }
  }catch(e){}
  var m=(kind==='g_spear')?造长矛(3.0):(()=>{                    // 石棺：小一号的真棺
    var g=new THREE.Group();
    var 石=new THREE.MeshLambertMaterial({color:0x8a8d80});
    var 金=new THREE.MeshLambertMaterial({color:0xc9a227});
    var b=new THREE.Mesh(new THREE.BoxGeometry(1.5,2.9,0.5),石);g.add(b);
    var l=new THREE.Mesh(new THREE.BoxGeometry(1.7,0.3,0.6),金);l.position.y=1.5;g.add(l);
    g.traverse(function(o){o.raycast=function(){};});
    return g;
  })();
  if(kind==='g_spear'){ m.rotation.set(-0.5,0.35,-0.55); m.scale.setScalar(0.62); }
  else { m.scale.setScalar(0.2); m.rotation.set(0,0.3,0); }
  var wrap=new THREE.Group();wrap.add(m);wrap.position.set(0.34,-0.30,-0.62);
  camera.add(wrap);
  将军_手持=wrap;将军_手持种类=kind;
  try{ _holdObj=wrap; }catch(e){}
}
function 将军收手持(){
  将军_手持=null;将军_手持种类='';
  陵_矛预览隐藏();陵_棺预览隐藏();
  if(typeof heroHoldHide==='function')heroHoldHide();
}
/* ---------- 长矛：预览 / 投出 / 命中 / 粘身爆炸 ---------- */
var 陵_矛=[];          // 飞行中的长矛
var 陵_矛预览组=null;
function 陵_矛方向(){
  var d=camera.getWorldDirection(new THREE.Vector3()).normalize();
  return d;
}
function 陵_矛落点(){
  /* 从眼睛往前步进，撞到障碍或飞出 45 米就停 —— 这就是"行动预览"的终点 */
  var d=陵_矛方向(),o=camera.position;
  var maxD=45,step=0.6,t;
  for(t=1.0;t<=maxD;t+=step){
    var x=o.x+d.x*t,y=o.y+d.y*t,z=o.z+d.z*t;
    if(陵_点被挡(x,y,z))return {x:x,y:y,z:z,d:d,dist:t};
    var g=陵_脚下(x,z,y);
    if(y<=g+0.05)return {x:x,y:g,z:z,d:d,dist:t};
  }
  return {x:o.x+d.x*maxD,y:o.y+d.y*maxD,z:o.z+d.z*maxD,d:d,dist:maxD};
}
function 陵_点被挡(x,y,z){
  for(var i=0;i<obstacles.length;i++){
    var o=obstacles[i];
    if(x<o.minX||x>o.maxX||z<o.minZ||z>o.maxZ)continue;
    var y0=(typeof o.y0==='number')?o.y0:0;
    var y1=(typeof o.y1==='number')?o.y1:(o.h||0);
    if(o.slab){if(y>=y0&&y<=y1)return true;}
    else if(y>=0&&y<=y1)return true;
  }
  return false;
}
function 陵_矛预览显示(){
  if(!陵_矛预览组){
    陵_矛预览组=new THREE.Group();
    var 虚=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,1),new THREE.MeshBasicMaterial({color:0xffd08a,transparent:true,opacity:0.55,depthWrite:false}));
    虚.name='线';陵_矛预览组.add(虚);
    var 圈=new THREE.Mesh(new THREE.RingGeometry(0.55,0.85,20),new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.7,side:THREE.DoubleSide,depthWrite:false}));
    圈.name='圈';圈.rotation.x=-Math.PI/2;陵_矛预览组.add(圈);
    var 影=造长矛(3.0);影.name='矛';影.traverse(function(o){o.raycast=function(){};});陵_矛预览组.add(影);
    陵_矛预览组.traverse(function(o){o.raycast=function(){};});
    scene.add(陵_矛预览组);
  }
  陵_矛预览组.visible=true;陵_矛预览更新();
}
function 陵_矛预览更新(){
  if(!陵_矛预览组||!陵_矛预览组.visible)return;
  var r=陵_矛落点(),o=camera.position;
  var 线=陵_矛预览组.getObjectByName('线'),圈=陵_矛预览组.getObjectByName('圈'),影=陵_矛预览组.getObjectByName('矛');
  if(线){
    线.position.set((o.x+r.x)/2,(o.y+r.y)/2,(o.z+r.z)/2);
    线.scale.set(1,1,Math.max(0.5,o.distanceTo(new THREE.Vector3(r.x,r.y,r.z))));
    线.lookAt(r.x,r.y,r.z);
  }
  if(圈){圈.position.set(r.x,r.y+0.06,r.z);}
  if(影){
    影.position.set(r.x,r.y+0.5,r.z);
    影.lookAt(camera.position.x,r.y+0.5,camera.position.z);
    影.rotateX(Math.PI/2);
  }
}
function 陵_矛预览隐藏(){if(陵_矛预览组)陵_矛预览组.visible=false;}
/* 投出：归属 '玩家' / '分身' / '将军' */
function 陵_投矛(x,y,z,dir,归属){
  var m=造长矛(3.0);
  m.position.set(x,y,z);
  scene.add(m);
  陵_矛.push({m:m,x:x,y:y,z:z,dx:dir.x,dy:dir.y,dz:dir.z,spd:52,life:2.2,t:0,
              归属:归属||'玩家',stuck:null,stickT:0,ox:0,oy:0,oz:0,hited:null});
}
function 陵_矛Tick(dt){
  陵_矛预览更新();
  for(var i=陵_矛.length-1;i>=0;i--){
    var p=陵_矛[i];
    /* --- 已经钉住：3 秒后爆炸 --- */
    if(p.stuck){
      p.stickT-=dt;
      if(p.stuck.hp!==undefined){
        var wp=heroEntWorld(p.stuck);
        p.x=wp.x+p.ox;p.y=wp.y+p.oy;p.z=wp.z+p.oz;
        if(p.stuck.isNet?(p.stuck.alive===false):(p.stuck.hp<=0))p.stickT=0;
      }
      p.m.position.set(p.x,p.y,p.z);
      if(p.stickT<=0){
        陵_爆炸(p.x,p.y,p.z,2.6,30,0xff8a3d,p.hited);
        if(p.m.parent)p.m.parent.remove(p.m);
        陵_矛.splice(i,1);
      }
      continue;
    }
    /* --- 飞行 --- */
    p.life-=dt;p.t+=dt;
    var 步=Math.min(0.06,dt);
    var 移=p.spd*dt;
    p.x+=p.dx*移;p.y+=p.dy*移;p.z+=p.dz*移;
    p.m.position.set(p.x,p.y,p.z);
    p.m.lookAt(p.x+p.dx,p.y+p.dy,p.z+p.dz);
    p.m.rotateX(Math.PI/2);
    /* 打人：玩家投的矛只打敌人，将军投的矛只打玩家 */
    if(p.归属==='将军'){
      var py=standSurfY()+1.0;
      var ddx=camera.position.x-p.x,ddy=py-p.y,ddz=camera.position.z-p.z;
      if(ddx*ddx+ddy*ddy+ddz*ddz<1.5){
        takeDmg(70,null);
        p.stuck={};p.stickT=3.0;
        if(typeof showMsg==='function')showMsg('🗡 长矛扎进了你身上 —— 3 秒后爆','#ff5a3d');
        continue;
      }
    }else{
      var 命中=null;
      for(var k=enemies.length-1;k>=0;k--){
        var e=enemies[k];if(!e||e===HELI.e)continue;
        if(e.isNet?(!e.alive):(e.hp<=0))continue;
        var ep=heroEntWorld(e);
        var ex=ep.x-p.x,ey=(ep.y+1.1)-p.y,ez=ep.z-p.z;
        if(ex*ex+ey*ey+ez*ez<1.7){命中=e;break;}
      }
      if(命中){
        var wp2=heroEntWorld(命中);
        if(命中.isNet){try{netHitRemote(命中,false,70,new THREE.Vector3(p.x,p.y,p.z));}catch(_){}}
        else{
          命中.hp-=70;命中.flash=0.3;
          if(命中.hb)命中.hb.scale.x=Math.max(0,命中.hp/命中.maxHp);
          if(命中.hbMat)命中.hbMat.color.setHex(命中.hp/命中.maxHp>.5?0x00ff00:(命中.hp/命中.maxHp>.25?0xffff00:0xff0000));
          if(命中.hp<=0&&typeof killEnemy==='function')killEnemy(命中,enemies.indexOf(命中),false);
        }
        p.stuck=命中;p.stickT=3.0;
        p.ox=p.x-wp2.x;p.oy=p.y-wp2.y;p.oz=p.z-wp2.z;
        p.hited=命中;
        try{spawnParticle(new THREE.Vector3(p.x,p.y,p.z),0xff5a3d,10,0.3,true);}catch(_){}
        continue;
      }
    }
    /* 撞墙 / 落地 / 超时就钉住（30 点爆炸，但**没有**那 70 点直伤） */
    var 地=陵_脚下(p.x,p.z,p.y);                              /* 按长矛自身高度探，扎在封土台上也算落地 */
    if(p.y<=地+0.05||陵_点被挡(p.x,p.y,p.z)||p.life<=0){
      p.stuck={};p.stickT=3.0;
      if(p.y<地+0.05)p.y=地+0.05;
      try{spawnParticle(new THREE.Vector3(p.x,p.y,p.z),0xd9c37a,6,0.2);}catch(_){}
    }
  }
}
/* ---------- 石棺：立墙 + 血量 + 爆开吐小兵 ---------- */
var 陵_棺=[];          // 自己立的石棺（记着，打爆了要吐兵）
var 陵_棺预览=null,陵_棺预览环=null;
function 造石棺(宽){
  宽=宽||1.25;
  var g=new THREE.Group();
  var 石=new THREE.MeshLambertMaterial({color:0x8b8e81});
  var 暗=new THREE.MeshLambertMaterial({color:0x5d6057});
  var 金=new THREE.MeshLambertMaterial({color:0xb8933a});
  var 体=new THREE.Mesh(new THREE.BoxGeometry(宽*2,2.7,0.55),石);体.position.y=1.35;g.add(体);
  var 盖=new THREE.Mesh(new THREE.BoxGeometry(宽*2+0.16,0.28,0.66),暗);盖.position.y=2.72;g.add(盖);
  var 纹=new THREE.Mesh(new THREE.BoxGeometry(宽*1.2,0.16,0.6),金);纹.position.set(0,1.9,0.03);g.add(纹);
  var 纹2=new THREE.Mesh(new THREE.BoxGeometry(0.16,1.1,0.6),金);纹2.position.set(0,1.35,0.03);g.add(纹2);
  g.traverse(function(o){o.raycast=function(){};});
  return g;
}
function 陵_棺预览显示(){
  if(!陵_棺预览){
    陵_棺预览=造石棺(1.25);
    陵_棺预览.traverse(function(o){
      if(o.isMesh){o.material=o.material.clone();o.material.transparent=true;o.material.opacity=0.35;o.material.depthWrite=false;}
      o.raycast=function(){};
    });
    scene.add(陵_棺预览);
    陵_棺预览环=new THREE.Mesh(new THREE.RingGeometry(1.0,1.35,24),new THREE.MeshBasicMaterial({color:0xd9c37a,transparent:true,opacity:0.55,side:THREE.DoubleSide,depthWrite:false}));
    陵_棺预览环.rotation.x=-Math.PI/2;陵_棺预览环.traverse(function(o){o.raycast=function(){};});scene.add(陵_棺预览环);
  }
  陵_棺预览.visible=true;if(陵_棺预览环)陵_棺预览环.visible=true;
  陵_棺预览更新();
}
function 陵_棺预览更新(){
  if(!陵_棺预览||!陵_棺预览.visible)return;
  if(typeof heroWallTarget!=='function')return;
  var t=heroWallTarget();SK.棺目标=t;
  陵_棺预览.position.set(t.x,t.surf,t.z);陵_棺预览.rotation.y=t.rot;
  if(陵_棺预览环)陵_棺预览环.position.set(t.x,t.surf+0.05,t.z);
}
function 陵_棺预览隐藏(){
  if(陵_棺预览)陵_棺预览.visible=false;
  if(陵_棺预览环)陵_棺预览环.visible=false;
}
/* 立棺：真正放下去（敌我通用；归属决定吐出来的小兵算谁的） */
function 陵_立棺(x,z,wy,rot,归属){
  var mesh=造石棺(1.25);
  mesh.position.set(x,wy-2.7,z);mesh.rotation.y=rot;
  scene.add(mesh);
  var box=(typeof spWallBoxAt==='function')?spWallBoxAt(x,z,rot,1.3,wy):null;
  if(box){obstacles.push(box);try{buildObstacleBoxes();}catch(e){}}
  var z2=null;
  if(typeof spZoneAdd==='function'){
    /* kind 必须是 'wall'：子弹挡板 / 打墙扣血两套逻辑都只认 'wall' */
    z2=spZoneAdd({kind:'wall',x:x,z:z,y:wy,r:1.3,dur:9999,mesh:mesh,box:box,rot:rot,hp:520});
  }
  /* 钻地动画 */
  var t0=performance.now();
  (function 升起(){
    if(!mesh.parent)return;
    var k=Math.min(1,(performance.now()-t0)/380),e=k*k*(3-2*k);
    mesh.position.y=(wy-2.7)+e*2.7;
    if(k<1)requestAnimationFrame(升起);
  })();
  陵_棺.push({zone:z2,mesh:mesh,x:x,z:z,wy:wy,归属:归属||'玩家',已爆:false});
  return z2;
}
function 陵_棺Tick(dt){
  for(var i=陵_棺.length-1;i>=0;i--){
    var c=陵_棺[i];
    var alive=false;
    if(c.zone&&typeof SP_ZONES!=='undefined'){
      for(var k=0;k<SP_ZONES.length;k++)if(SP_ZONES[k]===c.zone){alive=true;break;}
      if((c.zone.hp||0)>0)alive=true;else alive=false;
    }
    if(!c.已爆&&!alive){
      c.已爆=true;
      try{
        if(c.mesh&&c.mesh.parent)c.mesh.parent.remove(c.mesh);
        spawnParticle(new THREE.Vector3(c.x,c.wy+1,c.z),0x9aa08e,18,0.45,true);
      }catch(e){}
      /* 棺盖炸开 → 爬出 2 个小兵（只听命于大将军，对其他人都是敌人） */
      if(c.归属!=='将军'&&typeof createEnemy==='function'){
        for(var n=0;n<2;n++){
          var a=Math.random()*6.28,r=1.4+Math.random();
          var mx=c.x+Math.cos(a)*r,mz=c.z+Math.sin(a)*r;
          var e=null;
          try{e=createEnemy('basic',mx,mz);}catch(_){}
          if(e){try{e.棺兵=1;if(e.g)e.g.scale.setScalar(1.08);}catch(_){}}
        }
        if(typeof showMsg==='function')showMsg('⚰ 石棺炸开：里面爬出小兵','#d9c37a');
      }
      陵_棺.splice(i,1);
    }
  }
}
/* ---------- 分身：跟着你、自己扔矛、自己立棺 ---------- */
var 分身={on:false,root:null,t:0,spearT:2,coffinT:7,x:0,z:0,y:0};
function 召唤分身(){
  if(分身.on)return;
  var m=造将军模型(1.0);
  分身.root=m.root;分身.on=true;分身.t=30;分身.spearT=2.2;分身.coffinT=7;
  分身.x=camera.position.x+2.5;分身.z=camera.position.z+1.5;
  分身.y=standSurfY();
  m.root.position.set(分身.x,分身.y,分身.z);
  scene.add(m.root);
  showMsg('👥 将军分身出战：它会自己投矛、自己立棺（30 秒）','#d9c37a');
}
function 收回分身(){
  if(分身.root){if(分身.root.parent)分身.root.parent.remove(分身.root);分身.root=null;}
  分身.on=false;分身.t=0;
}
function 分身Tick(dt){
  if(!分身.on)return;
  分身.t-=dt;
  if(分身.t<=0||!S.playing||S.over||S.hp<=0){收回分身();return;}
  /* 站到玩家侧后方 3 米 —— 别挡视线 */
  var 前x=-Math.sin(yaw),前z=-Math.cos(yaw);
  var tx=camera.position.x-前x*2.2+前z*2.0, tz=camera.position.z-前z*2.2-前x*2.0;
  var dx=tx-分身.x,dz=tz-分身.z,d=Math.sqrt(dx*dx+dz*dz);
  if(d>0.6){
    var 步=Math.min(d,dt*5.5);
    分身.x+=dx/d*步;分身.z+=dz/d*步;
  }
  分身.y=(typeof standSurfY==='function')?standSurfY():陵_脚下(分身.x,分身.z,GROUND_Y+5.0);   /* 跟着玩家站在同一张面上 */
  分身.root.position.set(分身.x,分身.y,分身.z);
  分身.root.rotation.y=Math.atan2(camera.position.x-分身.x,camera.position.z-分身.z);
  /* 自己找最近的敌人投矛 */
  分身.spearT-=dt;
  if(分身.spearT<=0){
    分身.spearT=3.6;
    var best=null,bd=30*30;
    for(var i=enemies.length;i--;){
      var e=enemies[i];if(!e||e===HELI.e)continue;
      if(e.isNet?(!e.alive):(e.hp<=0))continue;
      var ep=heroEntWorld(e);
      var ddx=ep.x-分身.x,ddz=ep.z-分身.z,d2=ddx*ddx+ddz*ddz;
      if(d2<bd){bd=d2;best=e;}
    }
    if(best){
      var bp=heroEntWorld(best);
      var vx=bp.x-分身.x,vy=(bp.y+1.1)-(分身.y+1.6),vz=bp.z-分身.z;
      var L=Math.sqrt(vx*vx+vy*vy+vz*vz)||1;
      陵_投矛(分身.x,分身.y+1.6,分身.z,{x:vx/L,y:vy/L,z:vz/L},'分身');
    }
  }
  /* 自己立棺挡枪 */
  分身.coffinT-=dt;
  if(分身.coffinT<=0){
    分身.coffinT=11;
    var ax=-Math.sin(yaw),az=-Math.cos(yaw);
    陵_立棺(分身.x+ax*1.6,分身.z+az*1.6,分身.y,Math.atan2(ax,az),'分身');
  }
}
/* ---------- 技能：挂进 CUSTOM_SKILLS（heroCast 会优先问这里）---------- */
CUSTOM_SKILLS['g_spear']=function(i,s,H){
  if(SK.hold&&SK.hold.kind==='g_spear'){将军收手持();SK.hold=null;showMsg('已收起「爆炸长矛」','#ffd166');return true;}
  if(SK.hold&&typeof heroHoldCancel==='function')heroHoldCancel();
  SK.cds[i]=0;                                   // 举起不扣冷却，投出去才扣
  SK.hold={kind:'g_spear',si:i};SK.矛预瞄=0;
  将军持物('g_spear');
  showMsg('🗡 已握起爆炸长矛：点攻击键看「行动预览」，再点一次投出；右键 / 再按 V 收起','#d9c37a');
  if(typeof heroHudUpdate==='function')heroHudUpdate(true);
  return true;
};
CUSTOM_SKILLS['g_coffin']=function(i,s,H){
  if(SK.hold&&SK.hold.kind==='g_coffin'){将军收手持();SK.hold=null;showMsg('已收起「石棺」','#ffd166');return true;}
  if(SK.hold&&typeof heroHoldCancel==='function')heroHoldCancel();
  SK.cds[i]=0;
  SK.hold={kind:'g_coffin',si:i};
  将军持物('g_coffin');陵_棺预览显示();
  showMsg('⚰ 举起石棺：准星指向地面＝预览落点，左键放下；再按 B 收起','#d9c37a');
  if(typeof heroHudUpdate==='function')heroHudUpdate(true);
  return true;
};
CUSTOM_SKILLS['g_clone']=function(i,s,H){
  if(分身.on){showMsg('分身还在场上（剩 '+分身.t.toFixed(0)+' 秒）','#ffd166');return true;}
  召唤分身();
  if(typeof netIsMulti==='function'&&netIsMulti()&&NET.connected)
    netSend({t:'skill',k:'general',s:i,x:camera.position.x,y:standSurfY(),z:camera.position.z});
  if(typeof heroHudUpdate==='function')heroHudUpdate(true);
  return true;
};
/* ---------- 接管 heroAimStart / heroHoldCancel（长矛两步、石棺落点）---------- */
var _陵_aim原=heroAimStart,_陵_收原=heroHoldCancel;
heroAimStart=function(){
  if(SK&&SK.hold&&SK.hold.kind==='g_spear'){
    if(!S.playing||S.over||S.paused||S.hp<=0)return false;
    if(!SK.矛预瞄){
      SK.矛预瞄=1;陵_矛预览显示();
      showMsg('👁 行动预览已开：长矛虚影指到哪就扎到哪 —— 再点攻击键投出','#ffd08a');
      return true;
    }
    var r=陵_矛落点();
    var o=camera.position;
    陵_投矛(o.x+陵_矛方向().x*0.8,o.y-0.15,o.z+陵_矛方向().z*0.8,陵_矛方向(),'玩家');
    SK.矛预瞄=0;陵_矛预览隐藏();
    SK.cds[SK.hold.si]=heroNow().skills[SK.hold.si].cd;
    将军收手持();SK.hold=null;
    try{if(typeof netIsMulti==='function'&&netIsMulti()&&NET.connected)
      netSend({t:'skill',k:'general',s:0,x:o.x,y:standSurfY(),z:o.z});}catch(e){}
    showMsg('🗡 长矛已投出','#d9c37a');
    if(typeof heroHudUpdate==='function')heroHudUpdate(true);
    return true;
  }
  if(SK&&SK.hold&&SK.hold.kind==='g_coffin'){
    if(!S.playing||S.over||S.paused||S.hp<=0)return false;
    if(typeof heroWallTarget!=='function')return true;
    var t=SK.棺目标||heroWallTarget();
    陵_立棺(t.x,t.z,t.surf,t.rot,'玩家');
    SK.cds[SK.hold.si]=heroNow().skills[SK.hold.si].cd;
    将军收手持();SK.hold=null;
    try{if(typeof netIsMulti==='function'&&netIsMulti()&&NET.connected)
      netSend({t:'skill',k:'general',s:1,x:t.x,y:t.surf,z:t.z});}catch(e){}
    showMsg('⚰ 石棺已立起：挡子弹、挡人，被打爆会爬出小兵','#d9c37a');
    if(typeof heroHudUpdate==='function')heroHudUpdate(true);
    return true;
  }
  return _陵_aim原.apply(this,arguments);
};
heroHoldCancel=function(){
  if(SK&&SK.hold&&(SK.hold.kind==='g_spear'||SK.hold.kind==='g_coffin')){
    SK.矛预瞄=0;陵_矛预览隐藏();陵_棺预览隐藏();
    将军_手持=null;将军_手持种类='';
    SK.hold=null;
    if(typeof heroHoldHide==='function')heroHoldHide();
    return;
  }
  return _陵_收原.apply(this,arguments);
};

/* ==================== ④ 剧情第四章：陵园惊梦 ==================== */
var 将军_BOSS={e:null,hp:1500,maxHp:1500,spearT:3,coffinT:10,x:0,z:0,y:0,t:0,进入:false};
var 陵园_剧情已登记=false;
function 陵园_剧情重置(){
  收回分身();
  if(将军_BOSS.e){var i=enemies.indexOf(将军_BOSS.e);if(i>=0)enemies.splice(i,1);
    if(将军_BOSS.e.root&&将军_BOSS.e.root.parent)将军_BOSS.e.root.parent.remove(将军_BOSS.e.root);
    将军_BOSS.e=null;}
  STORY_.将军击杀=0;
}
function 陵园_刷兵(n){
  if(typeof storySpawnMob!=='function')return;
  storySpawnMob(n);
}
function 陵园_召Boss(){
  var m=造将军模型(1.35);
  var 台顶=陵_脚下(0,-42,GROUND_Y+5.0);                // 石殿前的三级封土台顶（4.8），别写死、也别探到屋顶
  m.root.position.set(0,台顶,-42);                      // 从石殿里走出来
  scene.add(m.root);
  var e={isNet:false,type:'tank',root:m.root,g:m.root,head:null,
         hp:将军_BOSS.maxHp,maxHp:将军_BOSS.maxHp,sz:1.5,sc:0,gold:0,
         flash:0,hb:null,hbMat:null,noAI:true,将军Boss:true,aiState:'chase'};
  /* 一个不显示的血条网格（21 分片打中时会去改 hb.scale.x，给个真的对象免得报错） */
  var hb=new THREE.Mesh(new THREE.BoxGeometry(1,0.08,1),new THREE.MeshBasicMaterial({color:0xff4444}));
  hb.visible=false;e.hb=hb;e.hbMat=hb.material;
  enemies.push(e);
  将军_BOSS.e=e;将军_BOSS.x=0;将军_BOSS.z=-42;将军_BOSS.y=台顶;
  将军_BOSS.spearT=2.5;将军_BOSS.coffinT=9;将军_BOSS.进入=true;
  STORY_.boss=e;
  陵_横幅('大将军 · 复活','#d9c37a',3200);
}
function 陵园_剧情Tick(dt){
  if(!STORY_.on||STORY_.ch!==4)return false;
  var ph=STORY_.phase;
  if(ph==='intro'||ph==='end'||ph==='done')return false;
  if(ph==='hunt'){
    STORY_.killed=STORY_.killed||0;
    if(STORY_.killed>=STORY_.need){
      /* 小兵清完了 → 发现大将军已经复活 */
      STORY_.phase='boss';STORY_.cut=true;
      if(typeof clearStoryMobs==='function')clearStoryMobs();
      陵园_召Boss();
      storySay([
        '最后一个守陵兵倒下了。你踩过碎骨，推开石殿的门。',
        '棺盖翻在一边 —— 里面是空的。',
        '「你们来晚了。」',
        '高台上那个人慢慢抬起头：甲胄上还挂着泥土，眼睛是暗月给他的那种光。',
        '「既然把我叫醒了，就别急着走。」'
      ],3.2);
      return true;
    }
    STORY_.spawnT=(STORY_.spawnT||0)-dt;
    var 场上=0;
    for(var i=0;i<enemies.length;i++){var e=enemies[i];if(!e.isNet&&e!==STORY_.boss&&e.hp>0)场上++;}
    if(STORY_.spawnT<=0&&场上<6&&(STORY_.spawned||0)<STORY_.need){
      STORY_.spawnT=1.1;
      陵园_刷兵(Math.min(2,STORY_.need-(STORY_.spawned||0)));
    }
    return true;
  }
  if(ph==='boss'){
    if(!_storyQueue.length&&!storyCutOn()){
      STORY_.phase='duel';STORY_.cut=false;
      if(typeof lockPointer==='function')lockPointer();
      showMsg('让他重新睡回去 —— 击败「大将军」！','#d9c37a');
      if(typeof bossShow==='function')bossShow(true);
    }
    return true;
  }
  if(ph==='duel'){
    var b=将军_BOSS.e;
    if(!b||b.hp<=0){storyEnd('win');return true;}
    if(S.hp<=0){storyEnd('lose');return true;}
    将军_BossTick(dt);
    return true;
  }
  return true;
}
/* 将军 Boss 的 AI：**不套用闪电那套**（不会瞬闪、不会电球），只用长矛 + 石棺 —— 剧情里不给分身 */
function 将军_BossTick(dt){
  var b=将军_BOSS.e;if(!b||!b.root)return;
  var px=camera.position.x,pz=camera.position.z;
  var dx=px-将军_BOSS.x,dz=pz-将军_BOSS.z,d=Math.sqrt(dx*dx+dz*dz)||1;
  /* 保持 9~16 米：太近就退，太远就压上 */
  var 想=12,速=0;
  if(d>想+3)速=1;else if(d<想-4)速=-1;
  if(速!==0){
    var nx=将军_BOSS.x+dx/d*速*3.4*dt, nz=将军_BOSS.z+dz/d*速*3.4*dt;
    if(typeof isColliding!=='function'||!isColliding(nx,nz,0.7,将军_BOSS.y+GROUND_Y+1.0,true)){
      将军_BOSS.x=nx;将军_BOSS.z=nz;
    }else{
      /* 贴墙就侧着挪，别卡死 */
      if(!isColliding(将军_BOSS.x+dz/d*3*dt,将军_BOSS.z-dx/d*3*dt,0.7,将军_BOSS.y+GROUND_Y+1.0,true)){
        将军_BOSS.x+=dz/d*3*dt;将军_BOSS.z-=dx/d*3*dt;
      }
    }
  }
  /* ⚠️【batch245】这里原来是 GROUND_Y+2 → 站在三级封土台（4.8 米）上的 Boss 被判成站在 0.12 地面，
     整个人埋进土里、只露半截，玩家打不到、看着像"boss 生成在地里"。
     探到 5.0 米就够：能看到 4.8 的台顶，又不会一路探到石殿屋顶（10.7）上去。 */
  将军_BOSS.y=陵_脚下(将军_BOSS.x,将军_BOSS.z,GROUND_Y+5.0);
  b.root.position.set(将军_BOSS.x,将军_BOSS.y,将军_BOSS.z);
  b.root.rotation.y=Math.atan2(px-将军_BOSS.x,pz-将军_BOSS.z);
  /* 投矛：抬手 0.7 秒后投出（给玩家躲的时间） */
  将军_BOSS.spearT-=dt;
  if(将军_BOSS.spearT<=0){
    将军_BOSS.spearT=3.4;
    将军_BOSS.蓄=0.7;
  }
  if(将军_BOSS.蓄>0){
    将军_BOSS.蓄-=dt;
    b.root.rotation.x=-0.18;                        // 抬身
    if(将军_BOSS.蓄<=0){
      b.root.rotation.x=0;
      var vx=px-将军_BOSS.x,vy=(standSurfY()+1.0)-(将军_BOSS.y+1.8),vz=pz-将军_BOSS.z;
      var L=Math.sqrt(vx*vx+vy*vy+vz*vz)||1;
      陵_投矛(将军_BOSS.x,将军_BOSS.y+1.8,将军_BOSS.z,{x:vx/L,y:vy/L,z:vz/L},'将军');
    }
  }
  /* 立棺当掩体（挡玩家的枪） */
  将军_BOSS.coffinT-=dt;
  if(将军_BOSS.coffinT<=0){
    将军_BOSS.coffinT=13;
    var ax=(px-将军_BOSS.x)/d,az=(pz-将军_BOSS.z)/d;
    陵_立棺(将军_BOSS.x+ax*1.9,将军_BOSS.z+az*1.9,将军_BOSS.y,Math.atan2(ax,az),'将军');
  }
  if(typeof bossBarRefresh==='function')bossBarRefresh();
}
/* 【重要】storyFinish 里会无条件调 storyClearNow()（那是"第一章通关解锁闪电"）。
   第四章不能顺手把闪电送出去 —— 这里做个按章节的闸门。 */
var _陵_清关原=storyClearNow;
storyClearNow=function(){
  if(typeof STORY_!=='undefined'&&STORY_.ch===4)return false;   // 第四章不通关解锁闪电
  return _陵_清关原.apply(this,arguments);
};
function 陵园_登记剧情(){
  if(陵园_剧情已登记)return;
  if(!window.ModLoader||typeof ModLoader.addStory!=='function')return;
  陵园_剧情已登记=true;
  ModLoader.addStory({
    n:4, icon:'⚰', name:'第四章 · 陵园惊梦', map:'古代陵园',
    desc:'侦察卫星在城外三十里的古陵园里拍到了不该有的东西：暗月在做一场「复活」。'+
         '「未来」派你赶在仪式完成前进去，把那些守陵的东西清掉 —— 可等你打进石殿才发现，'+
         '大将军已经醒了。让他重新睡回这片陵园里，是你这一趟唯一的活。'+
         '（这张图天上会有直升机巡逻，它会投导弹；别在陵园里跟它耗太久。）',
    mapId:'cemetery', spawn:[CEM_STORY_SPAWN.x,CEM_STORY_SPAWN.z], need:14,
    lines:[
      '「未来」· 外勤简报',
      '城外三十里，有一片没人敢进的古陵园。三天前，那里的土动了。',
      '侦察卫星拍到：暗月的人在石殿里摆了一场复活仪式 —— 他们要叫醒一位埋了两千年的大将军。',
      '你的任务很简单：进去，清掉守陵的暗月兵，别让仪式完成。',
      '还有 —— 那里的天上有东西在转。听见螺旋桨的声音，先找掩体。'
    ],
    init:function(){ 陵园_剧情重置(); },
    begin:function(){
      STORY_.phase='hunt';STORY_.cut=false;STORY_.spawnT=1.2;STORY_.killed=0;STORY_.spawned=0;
      if(typeof storyCutShow==='function')storyCutShow(false);
      if(typeof storyGoalRefresh==='function')storyGoalRefresh();
      showMsg('清剿守陵的暗月兵：'+STORY_.need+' 个','#4fc3ff');
      陵园_刷兵(4);
      if(typeof lockPointer==='function')lockPointer();
    },
    tick:function(dt){ return 陵园_剧情Tick(dt); },
    goal:function(){
      if(STORY_.phase==='hunt')return '剧情Ⅳ · 清剿守陵兵 '+(STORY_.killed||0)+'/'+(STORY_.need||14);
      if(STORY_.phase==='boss'||STORY_.phase==='duel')return '剧情Ⅳ · 让大将军重新沉睡';
      if(STORY_.phase==='end'||STORY_.phase==='done')return '剧情Ⅳ · 尾声';
      return '剧情Ⅳ · 陵园惊梦';
    },
    winLines:[
      '大将军跪了下去，甲胄一寸寸裂开，露出里面早就干透的骨头。',
      '「……原来，睡了这么久。」',
      '他没有再看你，只是慢慢躺回那口空棺里 —— 像是终于把一件很累的事做完了。',
      '石殿的门在你身后合上。陵园重新安静下来，只剩风穿过碑林的声音。',
      '总部后来把这片地方列成了禁区。有些人不该被叫醒。'
    ],
    loseLines:[
      '长矛穿过你的胸口，把你钉在封土台上。',
      '大将军俯下身看了你一眼，转身走向石殿外的夜色 —— 这一次，没人再能让他睡回去。',
      '陵园的钟响了一声。'
    ],
    reward:function(win){
      if(!win)return;
      try{localStorage.setItem('gunGame.story4.v1',String(Date.now()));}catch(e){}
      /* 解锁本身由 storyFinish → storyClearGeneral() 统一发（与闪电 / 蚀日者同一条路径），
         这里只报一句，避免"同一件事两条路径各解一次、提示弹两遍"。 */
      showMsg('✅ 第四章通关：大将军已重新沉睡','#d9c37a');
    },
    done:function(){try{return !!localStorage.getItem('gunGame.story4.v1');}catch(e){return false;}}
  });
}

/* ==================== ⑤ 每帧总入口 ==================== */
/* 由 26 分片的主循环调用（typeof 守卫，别的分片没有它也能跑） */
function 陵园Tick(dt){
  if(!(dt>0))dt=0.016;
  陵园_登记剧情();
  /* 换图 / 退出对局：把陵园这一套收干净 */
  if(curMapId!=='cemetery'){
    if(HELI.on||HELI.dead&&HELI.e)直升机关闭();
    陵_矛预览隐藏();陵_棺预览隐藏();
    if(分身.on)收回分身();
  }
  直升机Tick(dt);
  陵_矛Tick(dt);
  陵_棺Tick(dt);
  分身Tick(dt);
}
/* 换图钩子：setMap 是 14 分片的函数声明，这里接管一下（只做"进出陵园"的开关，不改它的行为） */
var _陵_setMap原=setMap;
setMap=function(id,不存){
  var ok=_陵_setMap原(id,不存);
  if(ok){
    if(id!=='cemetery'){直升机关闭();陵_矛预览隐藏();陵_棺预览隐藏();if(分身.on)收回分身();}
  }
  return ok;
};
/* 调试 / 探针接口（不放进任何 UI） */
window.陵园={
  直升机出现:直升机出现,直升机关闭:直升机关闭,击落:直升机坠毁,
  投核弹:陵_投核弹,清场:陵_清场,
  快进:function(秒){HELI.fieldT=Math.max(HELI.fieldT,秒);},
  状态:function(){return {on:HELI.on,hp:HELI.hp,fieldT:HELI.fieldT,phase:HELI.phase,nukeT:HELI.nukeT,导弹:陵_导弹.length,矛:陵_矛.length,棺:陵_棺.length,分身:分身.on};},
  召Boss:陵园_召Boss,刷兵:陵园_刷兵,剧情重置:陵园_剧情重置,
  将军解锁:将军解锁,将军锁定:function(){UNLOCK.general=false;unlockSave();try{if(typeof buildHeroGrid==='function')buildHeroGrid();}catch(e){}}
};
/* 剧情章节：ModLoader 是最后一个 <script>，这里等一拍再登记 */
setTimeout(function(){try{陵园_登记剧情();}catch(e){}},0);
