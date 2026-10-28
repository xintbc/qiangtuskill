/* 【batch244】载具系统（js/65_载具.js）—— **故意藏在最后、不接任何 UI** ====================
   用途：给以后的「赛车场」地图铺路。现在游戏里**没有任何入口**能碰到它：
     · 菜单、选图、设置面板里都不会出现一个字；
     · 只有控制台 / 模组 / 以后的赛车场地图能调它；
     · 平时不跑任何逻辑（没有载具、没在开车时，每帧只做一次 if 判断，开销 ≈ 0）。

   对外接口（都挂在 window.载具 上，全中文）：
     载具.定义(def)              注册一种车型（以后赛车场地图/模组用）
     载具.生成(id,x,z)           在(x,z)放一辆车，返回车的句柄
     载具.清空()                 收掉场上所有车
     载具.最近的车(x,z,半径)     找最近的一辆
     载具.让玩家上车(车)         直接把玩家塞进驾驶位（脚本/剧情用）
     载具.让玩家下车()
     载具.在开车()               现在是否在驾驶
     载具.车型(id)               取车型定义
   def 字段：
     {id:'赛车', 名:'赛车', 长:4.4, 宽:2.0, 高:1.15, 极速:34, 加速:13, 倒车:12,
      转向:1.9, 抓地:3.2, 生命:900, 颜色:0xd94b3a, 车轮:0.44, 轮距:0.86, 轴距:1.45,
      第三人称:{高:2.35, 远:7.4}}
   【为什么现在先做】赛车场那张图要的是"能开、能撞、视角顺手"这三件事，
   这三件事跟地图无关。先把底盘/轮胎/油门/漂移/上下车做扎实，以后加图只要放车、调数值。
   【已知边界】多人里不作为权威载具（不同步位置）——等赛车场真的做了再跟服务端一起定协议，
   现在硬塞只会让联机多一份不可信状态。
*/
var 载具=(function(){
  var 车型表={}, 场上=[], 驾驶=null, 上一帧=0;
  var 提示冷却=0;

  /* ---------- 默认车型：一辆能开的赛车（以后的赛车场直接用）---------- */
  var 默认={
    id:'赛车', 名:'赛车', 长:4.4, 宽:2.0, 高:1.15,
    极速:34, 加速:13, 倒车:12, 转向:1.9, 抓地:3.2, 生命:900,
    颜色:0xd94b3a, 车轮:0.44, 轮距:0.86, 轴距:1.45,
    第三人称:{高:2.35, 远:7.4}
  };
  function 定义(def){
    if(!def||!def.id){console.warn('载具.定义：缺 id');return null;}
    var d={},k;for(k in 默认)d[k]=默认[k];for(k in def)d[k]=def[k];
    车型表[d.id]=d;return d;
  }
  定义(默认);
  /* 再预置两种，方便以后直接放（现在也没人调） */
  定义({id:'越野车', 名:'越野车', 极速:27, 加速:11, 转向:2.1, 抓地:2.6, 颜色:0x5f7a4a, 长:4.8, 宽:2.2, 高:1.3, 第三人称:{高:2.6,远:7.8}});
  定义({id:'摩托', 名:'摩托', 极速:38, 加速:16, 转向:2.4, 抓地:4.2, 颜色:0x2f2f33, 长:2.2, 宽:0.7, 高:0.95, 车轮:0.34, 轮距:0, 轴距:0.8, 第三人称:{高:1.9,远:5.6}});

  /* ---------- 建模 ---------- */
  function 建车(d){
    var g=new THREE.Group();
    var 漆=new THREE.MeshLambertMaterial({color:d.颜色});
    var 暗=new THREE.MeshLambertMaterial({color:0x1d1f22});
    var 玻=new THREE.MeshLambertMaterial({color:0x9fd8ff,transparent:true,opacity:0.5});
    var 灯=new THREE.MeshBasicMaterial({color:0xfff3c4});
    var 尾=new THREE.MeshBasicMaterial({color:0xff3b3b});
    var 车长=d.长,车宽=d.宽,车高=d.高;
    /* 底盘 + 车身 + 座舱 */
    var 底=new THREE.Mesh(new THREE.BoxGeometry(车宽,车高*0.52,车长),漆);
    底.position.y=d.车轮+车高*0.26;g.add(底);
    var 舱=new THREE.Mesh(new THREE.BoxGeometry(车宽*0.78,车高*0.52,车长*0.42),漆);
    舱.position.set(0,d.车轮+车高*0.7,-车长*0.04);g.add(舱);
    var 窗=new THREE.Mesh(new THREE.BoxGeometry(车宽*0.72,车高*0.36,车长*0.36),玻);
    窗.position.set(0,d.车轮+车高*0.76,-车长*0.04);g.add(窗);
    /* 前脸 / 尾翼 / 灯 */
    var 前=new THREE.Mesh(new THREE.BoxGeometry(车宽*0.96,车高*0.2,0.3),暗);
    前.position.set(0,d.车轮+车高*0.2,车长*0.48);g.add(前);
    if(d.id!=='摩托'){
      var 翼=new THREE.Mesh(new THREE.BoxGeometry(车宽*1.02,0.09,0.42),暗);
      翼.position.set(0,d.车轮+车高*0.95,-车长*0.46);g.add(翼);
      var 架1=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.34,0.1),暗);架1.position.set(-车宽*0.4,d.车轮+车高*0.78,-车长*0.46);g.add(架1);
      var 架2=架1.clone();架2.position.x=车宽*0.4;g.add(架2);
    }
    for(var s=-1;s<=1;s+=2){
      var 头=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.16,0.08),灯);
      头.position.set(s*车宽*0.32,d.车轮+车高*0.34,车长*0.5);g.add(头);
      var 后=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.14,0.08),尾);
      后.position.set(s*车宽*0.32,d.车轮+车高*0.34,-车长*0.5);g.add(后);
    }
    /* 车轮：四个圆柱（摩托两个） */
    var 轮=[];
    var 轮材=new THREE.MeshLambertMaterial({color:0x141416});
    var 毂材=new THREE.MeshLambertMaterial({color:0x8a8d92});
    var 位=[[-1,1],[1,1],[-1,-1],[1,-1]];
    var 数=(d.id==='摩托')?2:4;
    for(var i=0;i<数;i++){
      var px=(d.id==='摩托')?0:位[i][0]*d.轮距;
      var pz=(d.id==='摩托')?((i===0?1:-1)*d.轴距):(位[i][1]*d.轴距);
      var w=new THREE.Group();
      var 胎=new THREE.Mesh(new THREE.CylinderGeometry(d.车轮,d.车轮,0.26,12),轮材);
      胎.rotation.z=Math.PI/2;w.add(胎);
      var 毂=new THREE.Mesh(new THREE.CylinderGeometry(d.车轮*0.52,d.车轮*0.52,0.28,8),毂材);
      毂.rotation.z=Math.PI/2;w.add(毂);
      w.position.set(px,d.车轮,pz);
      g.add(w);
      轮.push({g:w,前:(pz>0)});
    }
    g.traverse(function(o){o.raycast=function(){};});
    return {g:g,轮:轮};
  }
  /* ---------- 生成 / 清空 ---------- */
  function 生成(id,x,z,yaw){
    var d=车型表[id]||车型表['赛车'];
    var 模=建车(d);
    var y=0;
    try{y=groundHeightAt(x,z,GROUND_Y+2)-GROUND_Y;}catch(e){}
    模.g.position.set(x||0,y,z||0);
    模.g.rotation.y=yaw||0;
    scene.add(模.g);
    var car={def:d,obj:模.g,轮:模.轮,x:x||0,y:y,z:z||0,yaw:yaw||0,
             速:0,转向:0,生命:d.生命,漂移:0,轮角:0,冲撞冷却:0,发动机:0};
    场上.push(car);
    return car;
  }
  function 清空(){
    for(var i=场上.length-1;i>=0;i--){var c=场上[i];if(c.obj&&c.obj.parent)c.obj.parent.remove(c.obj);}
    场上.length=0;驾驶=null;
  }
  function 最近的车(x,z,r){
    var best=null,bd=(r||4)*(r||4);
    for(var i=0;i<场上.length;i++){
      var c=场上[i],dx=c.x-x,dz=c.z-z,d2=dx*dx+dz*dz;
      if(d2<bd){bd=d2;best=c;}
    }
    return best;
  }
  /* ---------- 上车 / 下车 ---------- */
  function 上车(car){
    if(!car||驾驶)return false;
    驾驶=car;
    try{
      if(typeof weaponGroup!=='undefined'&&weaponGroup)weaponGroup.visible=false;
      if(typeof leftHandCamGroup!=='undefined'&&leftHandCamGroup)leftHandCamGroup.visible=false;
      document.getElementById('crosshair').style.opacity='0';
    }catch(e){}
    上一帧=performance.now();
    try{if(typeof showMsg==='function')showMsg('🚗 已上车：W/S 油门·倒车　A/D 转向　空格 手刹　F 下车','#9bd4ff');}catch(e){}
    return true;
  }
  function 下车(){
    if(!驾驶)return;
    var car=驾驶;
    var 侧x=car.x+Math.cos(car.yaw)*1.9, 侧z=car.z-Math.sin(car.yaw)*1.9;
    /* 门被堵就换另一侧 */
    try{
      if(typeof isColliding==='function'&&isColliding(侧x,侧z,0.5)){侧x=car.x-Math.cos(car.yaw)*1.9;侧z=car.z+Math.sin(car.yaw)*1.9;}
    }catch(e){}
    try{camera.position.set(侧x,groundHeightAt(侧x,侧z,GROUND_Y+2),侧z);S.velY=0;S.onGround=true;}catch(e){}
    驾驶=null;
    try{
      if(typeof weaponGroup!=='undefined'&&weaponGroup)weaponGroup.visible=true;
      document.getElementById('crosshair').style.opacity='';
    }catch(e){}
    try{if(typeof showMsg==='function')showMsg('已下车','#9bd4ff');}catch(e){}
  }
  /* ---------- 键盘：只在开车（或车就在脚边）时接管 ---------- */
  var 键={w:false,s:false,a:false,d:false,空格:false};
  document.addEventListener('keydown',function(e){
    if(typeof 正在打字==='function'&&正在打字())return;
    if(e.code==='KeyF'&&!e.repeat){
      if(驾驶){e.preventDefault();下车();return;}
      if(typeof S!=='undefined'&&S.playing&&!S.over&&!S.paused){
        var c=最近的车(camera.position.x,camera.position.z,4.2);
        if(c){e.preventDefault();上车(c);return;}
      }
    }
    if(!驾驶)return;
    if(e.code==='KeyW'||e.code==='ArrowUp'){键.w=true;e.preventDefault();}
    else if(e.code==='KeyS'||e.code==='ArrowDown'){键.s=true;e.preventDefault();}
    else if(e.code==='KeyA'||e.code==='ArrowLeft'){键.a=true;e.preventDefault();}
    else if(e.code==='KeyD'||e.code==='ArrowRight'){键.d=true;e.preventDefault();}
    else if(e.code==='Space'){键.空格=true;e.preventDefault();}
  },true);
  document.addEventListener('keyup',function(e){
    if(e.code==='KeyW'||e.code==='ArrowUp')键.w=false;
    else if(e.code==='KeyS'||e.code==='ArrowDown')键.s=false;
    else if(e.code==='KeyA'||e.code==='ArrowLeft')键.a=false;
    else if(e.code==='KeyD'||e.code==='ArrowRight')键.d=false;
    else if(e.code==='Space')键.空格=false;
  },true);

  /* ---------- 物理 + 视角（每帧，只在驾驶时跑）---------- */
  function 驾驶Tick(){
    var car=驾驶;if(!car)return;
    var now=performance.now();
    var dt=Math.min(0.05,(now-上一帧)/1000)||0.016;上一帧=now;
    if(!S.playing||S.over||S.hp<=0){下车();return;}
    var d=car.def;
    /* 油门 / 刹车 / 倒车 */
    var 油门=(键.w?1:0)-(键.s?1:0);
    if(油门>0)car.速+=d.加速*dt;
    else if(油门<0)car.速-=(car.速>0?d.加速*1.6:d.倒车*0.9)*dt;
    else car.速-=car.速*Math.min(1,2.4*dt);
    if(键.空格)car.速-=car.速*Math.min(1,6.5*dt);            // 手刹
    car.速=Math.max(-d.倒车,Math.min(d.极速,car.速));
    /* 转向：速度越低越转不动（原地打方向盘没用） */
    var 转向输入=(键.a?1:0)-(键.d?1:0);
    var 有效=Math.min(1,Math.abs(car.速)/6);
    car.转向+=(转向输入-car.转向)*Math.min(1,8*dt);
    car.yaw+=car.转向*d.转向*有效*dt*(car.速>=0?1:-1);
    /* 位置推进 + 碰撞（撞墙就把速度吃掉大半，并往切线方向滑一下） */
    var fx=-Math.sin(car.yaw),fz=-Math.cos(car.yaw);
    var nx=car.x+fx*car.速*dt, nz=car.z+fz*car.速*dt;
    var 撞了=false;
    try{
      var r=Math.max(d.宽*0.62,0.9);
      /* 第 4 参＝车身离地高度、第 5 参＝台阶容差：这样 0.1 米的路沿、矮台不会把车顶住
         （不给这两个参数的话，神道那种 0.12 高的铺石会把车"卡在原地"，实测踩油门不动） */
      var 车高=car.y+GROUND_Y+0.45;
      if(typeof isColliding==='function'&&isColliding(nx,nz,r,车高,true))撞了=true;
      if(!撞了&&typeof worldLimit==='function'&&(Math.abs(nx)>worldLimit()-2||Math.abs(nz)>worldLimit()-2))撞了=true;
    }catch(e){}
    if(撞了){
      /* 只前进方向被挡：沿"横向"滑一小段，避免贴墙卡死 */
      var 侧x=-fz,侧z=fx;
      var 滑=car.速*dt*0.35;
      var tx=car.x+侧x*滑, tz=car.z+侧z*滑;
      try{
        if(typeof isColliding!=='function'||!isColliding(tx,tz,d.宽*0.62,car.y+GROUND_Y+0.45,true)){car.x=tx;car.z=tz;}
      }catch(e){}
      if(Math.abs(car.速)>9){try{spawnParticle(new THREE.Vector3(car.x,car.y+0.8,car.z),0xffcf6a,8,0.25);}catch(e){}}
      car.速*=-0.18;
    }else{car.x=nx;car.z=nz;}
    try{car.y=groundHeightAt(car.x,car.z,GROUND_Y+2)-GROUND_Y;}catch(e){}
    /* 车身姿态：加速抬头、刹车点头、转弯侧倾 */
    car.obj.position.set(car.x,car.y,car.z);
    car.obj.rotation.y=car.yaw;
    car.obj.rotation.z=-(car.转向||0)*Math.min(1,Math.abs(car.速)/16)*0.10;
    car.obj.rotation.x=-(油门)*0.012;
    /* 轮子：滚动 + 前轮转向 */
    car.轮角+=car.速*dt/Math.max(0.2,d.车轮);
    for(var i=0;i<car.轮.length;i++){
      var w=car.轮[i];
      w.g.rotation.x=car.轮角;
      if(w.前)w.g.rotation.y=car.转向*0.5;
    }
    /* 撞人：速度够快就把挡在前面的撞飞（载具也是武器） */
    car.冲撞冷却-=dt;
    if(Math.abs(car.速)>7&&car.冲撞冷却<=0){
      for(var k=enemies.length-1;k>=0;k--){
        var e=enemies[k];if(!e||e.isNet)continue;
        if(e.hp<=0)continue;
        var ep=heroEntWorld(e);
        var dx=ep.x-car.x,dz=ep.z-car.z;
        if(dx*dx+dz*dz<4.2){
          if(typeof netIsMulti==='function'&&netIsMulti())continue;
          var 伤=Math.round(Math.abs(car.速)*3.2);
          e.hp-=伤;e.flash=0.3;
          if(e.hb)e.hb.scale.x=Math.max(0,e.hp/e.maxHp);
          if(e.hbMat)e.hbMat.color.setHex(e.hp/e.maxHp>.5?0x00ff00:(e.hp/e.maxHp>.25?0xffff00:0xff0000));
          if(e.hp<=0&&typeof killEnemy==='function')killEnemy(e,k,false);
          car.冲撞冷却=0.5;car.速*=0.82;
          try{spawnParticle(new THREE.Vector3(ep.x,ep.y+1,ep.z),0xff8a3d,12,0.3,true);}catch(_){}
          break;
        }
      }
    }
    /* 相机：车后方第三人称；稍微跟着速度拉远一点 */
    var tp=d.第三人称||{高:2.35,远:7.4};
    var 拉远=tp.远+Math.min(3,Math.abs(car.速)*0.08);
    var camx=car.x-fx*拉远, camz=car.z-fz*拉远;
    var camy=car.y+tp.高;
    try{
      camera.position.x+=(camx-camera.position.x)*Math.min(1,10*dt);
      camera.position.y+=(camy-camera.position.y)*Math.min(1,10*dt);
      camera.position.z+=(camz-camera.position.z)*Math.min(1,10*dt);
      camera.lookAt(car.x+fx*4,car.y+1.05,car.z+fz*4);
    }catch(e){}
    /* 开车的震动（发动机） */
    if(Math.abs(car.速)>1){
      var 抖=0.006*Math.min(1,Math.abs(car.速)/20);
      camera.position.y+=Math.sin(now*0.03)*抖;
    }
    /* 车被打也会掉血（留好接口，以后赛车场里能打爆车） */
    if(car.生命<=0){
      try{spawnParticle(new THREE.Vector3(car.x,car.y+1,car.z),0xff6a2b,26,0.6,true);}catch(e){}
      下车();
      var i2=场上.indexOf(car);if(i2>=0){if(car.obj&&car.obj.parent)car.obj.parent.remove(car.obj);场上.splice(i2,1);}
    }
  }
  /* 玩家位置跟车同步（AI 才会朝车开火 / 敌人子弹有落点） */
  function 同步玩家(){
    if(!驾驶)return;
    try{camera.position.set(camera.position.x,camera.position.y,camera.position.z);}catch(e){}
  }
  return {
    定义:定义,生成:生成,清空:清空,最近的车:最近的车,
    让玩家上车:上车,让玩家下车:下车,在开车:function(){return !!驾驶;},
    车型:function(id){return 车型表[id];},车型表:function(){var a=[],k;for(k in 车型表)a.push(k);return a;},
    当前车:function(){return 驾驶;},
    /* 脚本 / 探针 / 以后的过场动画用：直接给油门与方向，不依赖真键盘
       （名字带下划线＝内部接口，不当作正式玩法入口） */
    _按:function(k,v){ if(Object.prototype.hasOwnProperty.call(键,k))键[k]=!!v; },
    _tick:function(){if(驾驶)驾驶Tick();同步玩家();},
    _有车:function(){return 场上.length>0;}
  };
})();

/* 把 updatePlayer 接管一下：开着车时不让"步行移动"再跑（否则车和玩家会打架）。
   没开车时是一层直通，行为与原来完全一致。 */
var _载_updatePlayer原=updatePlayer;
updatePlayer=function(){
  if(载具.在开车()){载具._tick();return;}
  return _载_updatePlayer原.apply(this,arguments);
};
/* 主循环收尾：驾驶由 updatePlayer 那层接管（这里不能再跑一次，否则一帧算两遍物理）。
   场上有车但没人开的时候，车只是"摆着"，不需要每帧逻辑。 */
function 载具Tick(dt){/* 空实现：留给以后赛车场做"没人开的车也要动"（比如 AI 车） */}
