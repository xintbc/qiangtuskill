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
      重力:24, 起跳系数:1.0,         ← batch255 竖直物理：车不会自己飞，只有冲坡/掉台才腾空
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
    重力:24, 起跳系数:1.0,          /* 【batch255】重力 24 m/s²；起跳系数＝冲坡时地面顶起的速度继承多少 */
    第三人称:{高:2.35, 远:7.4}
  };
  function 定义(def){
    if(!def||!def.id){console.warn('载具.定义：缺 id');return null;}
    var d={},k;for(k in 默认)d[k]=默认[k];for(k in def)d[k]=def[k];
    车型表[d.id]=d;return d;
  }
  定义(默认);
  /* 再预置两种，方便以后直接放（现在也没人调） */
  定义({id:'越野车', 名:'越野车', 极速:27, 加速:11, 转向:2.1, 抓地:2.6, 颜色:0x5f7a4a, 长:4.8, 宽:2.2, 高:1.3,
        车轮:0.52, 轴距:1.62, 轮距:0.94, 重力:26, 起跳系数:1.15, 第三人称:{高:2.6,远:7.8}});
  定义({id:'摩托', 名:'摩托', 极速:38, 加速:16, 转向:2.4, 抓地:4.2, 颜色:0xd8443c, 长:2.2, 宽:0.7, 高:0.95, 车轮:0.34, 轮距:0, 轴距:0.8, 重力:22, 起跳系数:0.85, 第三人称:{高:1.9,远:5.6}});

  /* ---------- 建模（batch253 重做：从"方盒子"升级成分车型的成品车）---------------
     全部纯几何体拼装（不加载外部模型，保持单文件 / 离线可用）：
       · 车身：侧视轮廓 Extrude（跑车低趴流线 / 越野车方箱 / 摩托三角车架）
       · 细节：轮拱、灯组、格栅、后视镜、尾翼、行李架、射灯、备胎、前叉、车把、排气
     ⚠️【车头方向】物理里车头朝 **-z**（`fx=-sin(yaw), fz=-cos(yaw)`，前进＝-z），
        而建模习惯把车头画在 +z —— 所以所有部件都塞进 `壳`，再整体 `rotation.y=PI` 摆正。
        连带 驾驶Tick 里两处符号要反：轮子滚动 `-car.轮角`、前轮转向 `-car.转向*0.5`。
        **别再往 g 上直接 add**，否则车会"倒着跑、车头灯长在车尾"。 */
  function 建车(d){
    var 车漆=new THREE.MeshPhongMaterial({color:d.颜色,shininess:64,specular:0x555555});
    var 哑光=new THREE.MeshPhongMaterial({color:0x15171a,shininess:10});
    var 玻璃=new THREE.MeshPhongMaterial({color:0x2e5a75,shininess:140,specular:0xaaddff,transparent:true,opacity:0.48});
    var 白光=new THREE.MeshBasicMaterial({color:0xfff6d2});
    var 红  =new THREE.MeshBasicMaterial({color:0xff2b2b});
    var 银  =new THREE.MeshPhongMaterial({color:0xa8adb4,shininess:110,specular:0xffffff});
    var 钢  =new THREE.MeshPhongMaterial({color:0x4a4e54,shininess:90,specular:0x888888});
    var 胶  =new THREE.MeshPhongMaterial({color:0x121316,shininess:6});

    var g=new THREE.Group(), 壳=new THREE.Group();
    壳.rotation.y=Math.PI; g.add(壳);

    var 长=d.长, 宽=d.宽, 高=d.高, R=d.车轮, 半=长/2, 半W=宽/2;
    var 轴距=d.轴距||(长*0.33), 轮距=d.轮距||(宽*0.43);

    function 块(mat,w,h,dep,x,y,z,rx,ry,rz){
      var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,dep),mat);
      m.position.set(x||0,y||0,z||0);m.rotation.set(rx||0,ry||0,rz||0);壳.add(m);return m;
    }
    function 管(mat,r1,r2,h,x,y,z,rx,ry,rz){
      var m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,12),mat);
      m.position.set(x||0,y||0,z||0);m.rotation.set(rx||0,ry||0,rz||0);壳.add(m);return m;
    }
    /* 侧视轮廓挤出：pts=[[z,y],…]（自动闭合），厚度＝车宽，沿 X 居中 */
    function 壳片(pts,厚,mat){
      var s=new THREE.Shape();s.moveTo(pts[0][0],pts[0][1]);
      for(var i=1;i<pts.length;i++)s.lineTo(pts[i][0],pts[i][1]);
      s.closePath();
      var geo=new THREE.ExtrudeGeometry(s,{depth:厚,bevelEnabled:true,bevelSize:0.02,bevelThickness:0.02,bevelSegments:1,curveSegments:4});
      geo.rotateY(-Math.PI/2);geo.translate(厚/2,0,0);
      var m=new THREE.Mesh(geo,mat);壳.add(m);return m;
    }
    /* 车轮：胎 + 毂 + 5 根辐条
       ⚠️【batch254】拆成**两层**（这是"转向时前轮乱转"的根因）：
         · 外层 `转向组` 只绕 Y 转（打方向盘）
         · 内层 `滚`   只绕 X 转（车轮自转）
       以前两个角度写在**同一个** Object3D 的 rotation.x / rotation.y 上，
       three 的 Euler('XYZ') 是 **先绕 X 再把结果绕 Y** —— 也就是说车轮是"绕车身横向的轴"
       在自转，而不是"绕自己被打歪后的轴"自转。方向一打，轮子就像在胎里乱搅。
       嵌套之后矩阵变成 Ry·Rx，才是真的"先把轮子转向、再绕自己的轴滚"。 */
    function 造轮(px,pz,前,轮R,轮宽){
      var 转向组=new THREE.Group();      /* 外层：打方向（绕 Y） */
      var 滚=new THREE.Group();          /* 内层：滚动（绕 X） */
      转向组.add(滚);
      var 胎=new THREE.Mesh(new THREE.CylinderGeometry(轮R,轮R,轮宽,18),胶);胎.rotation.z=Math.PI/2;滚.add(胎);
      var 毂=new THREE.Mesh(new THREE.CylinderGeometry(轮R*0.58,轮R*0.58,轮宽*0.94,12),银);毂.rotation.z=Math.PI/2;滚.add(毂);
      for(var i=0;i<5;i++){
        var 辐=new THREE.Mesh(new THREE.BoxGeometry(轮宽*0.55,轮R*1.02,0.05),哑光);
        辐.rotation.x=i*Math.PI*2/5;滚.add(辐);
      }
      转向组.position.set(px,轮R,pz);壳.add(转向组);
      return {g:转向组, 滚:滚, 前:!!前};
    }
    /* 轮拱（半环，贴在轮胎外侧平面） */
    function 轮拱(px,pz,轮R,管粗){
      var m=new THREE.Mesh(new THREE.TorusGeometry(轮R*1.14,管粗||0.055,6,12,Math.PI),哑光);
      m.position.set(px,轮R,pz);m.rotation.y=Math.PI/2;壳.add(m);
    }

    var 轮=[], i, sx, sz;
    if(d.id==='摩托'){
      /* ==================== ① 摩托：三角车架 + 前叉 + 车把 ==================== */
      /* 发动机 + 两根斜梁 */
      块(哑光, 0.44, 高*0.36, 长*0.34, 0, 高*0.52, 0.02);
      for(i=-1;i<=1;i+=2)管(车漆, 0.045,0.045, 长*0.42, i*0.10, 高*0.66, -0.02, 0.55,0,0);
      /* 油箱（上宽下窄）+ 座垫 + 上翘尾段 */
      块(车漆, 宽*0.62, 高*0.24, 长*0.34, 0, 高*0.86, 长*0.10);
      块(车漆, 宽*0.44, 高*0.14, 长*0.20, 0, 高*0.98, 长*0.20);
      块(哑光, 宽*0.52, 0.10, 长*0.30, 0, 高*0.92, -长*0.16);
      块(车漆, 宽*0.40, 0.07, 长*0.20, 0, 高*1.00, -长*0.30, -0.18,0,0);
      /* 前叉 + 前挡泥板 + 车把 + 前灯 */
      for(i=-1;i<=1;i+=2)管(银, 0.04,0.04, 高*0.62, i*0.11, 高*0.62, 轴距*0.92, 0.34,0,0);
      块(车漆, 宽*0.46, 0.06, 长*0.20, 0, 高*0.52, 轴距*1.02);
      管(哑光, 0.03,0.03, 宽*1.02, 0, 高*0.96, 轴距*0.86, 0,0,Math.PI/2);
      管(白光, 0.12,0.12, 0.05, 0, 高*0.82, 轴距*1.04, Math.PI/2,0,0);
      /* 后视镜×2 */
      for(i=-1;i<=1;i+=2){
        管(哑光, 0.02,0.02, 0.22, i*0.30, 高*1.06, 轴距*0.82, 0,0,i*0.40);
        块(哑光, 0.09,0.06,0.03, i*0.40, 高*1.16, 轴距*0.82);
      }
      /* 排气（中段 + 尾段） */
      管(钢, 0.055,0.055, 长*0.30, 0.20, 高*0.34, -长*0.06, 0,0,Math.PI/2);
      管(钢, 0.075,0.075, 长*0.14, 0.22, 高*0.30, -长*0.28, Math.PI/2,0,0);
      /* 前后各一轮，细胎 */
      轮.push(造轮(0,  轴距, true,  R*0.98, 0.13));
      轮.push(造轮(0, -轴距, false, R*0.98, 0.16));
    }else if(d.id==='越野车'){
      /* ==================== ② 越野车：方箱 + 行李架 + 射灯 + 备胎 ==================== */
      var 身H=高*0.52;
      块(哑光, 宽*1.02, 高*0.20, 长*1.01, 0, 高*0.30, 0);                    /* 下裙 */
      块(车漆, 宽*0.98, 身H,    长*0.99, 0, 高*0.30+身H*0.6, 0);            /* 车身 */
      块(车漆, 宽*0.92, 高*0.10, 长*0.30, 0, 高*0.62, 半*0.62);             /* 引擎盖 */
      块(车漆, 宽*0.90, 高*0.42, 长*0.52, 0, 高*0.86, -半*0.16);            /* 车顶棚 */
      /* 玻璃：前风挡（略斜）+ 两侧窗 + 后窗 */
      块(玻璃, 宽*0.86, 高*0.30, 0.05, 0, 高*0.90, 半*0.14, -0.18,0,0);
      块(玻璃, 0.04, 高*0.26, 长*0.44, -(宽*0.45), 高*0.92, -半*0.18);
      块(玻璃, 0.04, 高*0.26, 长*0.44,  (宽*0.45), 高*0.92, -半*0.18);
      块(玻璃, 宽*0.80, 高*0.26, 0.05, 0, 高*0.92, -半*0.44);
      /* 保险杠 + 绞盘 + 拖车钩 */
      块(哑光, 宽*1.06, 高*0.16, 长*0.07, 0, 高*0.34, 半*1.02);
      块(哑光, 宽*1.06, 高*0.14, 长*0.06, 0, 高*0.34, -半*1.02);
      管(银, 0.10,0.10, 宽*0.30, 0, 高*0.44, 半*1.06, 0,0,Math.PI/2);
      /* 圆灯×2 + 转向灯 + 竖条尾灯 */
      for(i=-1;i<=1;i+=2){
        管(白光, 0.13,0.13, 0.06, i*宽*0.30, 高*0.52, 半*1.005, Math.PI/2,0,0);
        块(白光, 宽*0.10, 0.05, 0.04, i*宽*0.13, 高*0.40, 半*1.03);
        块(红, 0.09, 高*0.16, 0.05, i*宽*0.40, 高*0.52, -半*1.005);
      }
      /* 车顶行李架（2 纵 3 横）+ 4 个射灯 */
      块(哑光, 0.06, 0.06, 长*0.56, -宽*0.40, 高*1.10, -半*0.14);
      块(哑光, 0.06, 0.06, 长*0.56,  宽*0.40, 高*1.10, -半*0.14);
      for(i=0;i<3;i++)块(哑光, 宽*0.86, 0.05, 0.05, 0, 高*1.10, -半*0.36+i*长*0.22);
      for(i=0;i<4;i++){
        管(白光, 0.075,0.075, 0.07, (i<2?-1:1)*宽*0.30, 高*1.16, -半*0.32+(i%2)*长*0.10, Math.PI/2,0,0);
      }
      /* 尾门备胎 + 侧踏板 */
      管(胶, R*0.96, R*0.96, 0.22, 0, 高*0.60, -半*1.10, Math.PI/2,0,0);
      管(银, R*0.34, R*0.34, 0.24, 0, 高*0.60, -半*1.10, Math.PI/2,0,0);
      块(哑光, 0.20, 0.08, 长*0.40, -(半W+0.04), 高*0.18, 0);
      块(哑光, 0.20, 0.08, 长*0.40,  (半W+0.04), 高*0.18, 0);
      /* 四个大胎 + 粗轮拱 */
      for(i=0;i<4;i++){
        sx=(i%2===0?-1:1);sz=(i<2?1:-1);
        轮.push(造轮(sx*(半W-0.02), sz*轴距, sz>0, R, 0.34));
        轮拱(sx*(半W-0.01), sz*轴距, R*1.06, 0.085);
      }
    }else{
      /* ==================== ③ 跑车（默认外观，尺寸跟着 def 走）==================== */
      /* 主车身：低趴流线（前低后高、尾部收） */
      壳片([
        [-半,高*0.24],[-半,高*0.56],[-半*0.62,高*0.62],[-半*0.10,高*0.64],
        [ 半*0.34,高*0.62],[ 半*0.72,高*0.54],[ 半,高*0.40],[ 半,高*0.24]
      ], 宽*0.99, 车漆);
      /* 座舱罩（玻璃拱，比车身略窄） */
      壳片([
        [-半*0.44,高*0.62],[-半*0.34,高*0.99],[半*0.06,高*0.99],[半*0.30,高*0.62]
      ], 宽*0.90, 玻璃);
      /* 引擎盖进气口 + 车顶鲨鱼鳍 */
      块(哑光, 宽*0.42, 0.05, 长*0.14, 0, 高*0.645, 半*0.34, 0.03,0,0);
      块(哑光, 0.06, 高*0.10, 长*0.10, 0, 高*0.99, -半*0.12);
      /* 侧裙 / 前唇 / 后扩散器 */
      块(哑光, 0.10, 高*0.12, 长*0.52, -(半W-0.02), 高*0.22, 0);
      块(哑光, 0.10, 高*0.12, 长*0.52,  (半W-0.02), 高*0.22, 0);
      块(哑光, 宽*0.96, 0.07, 长*0.10, 0, 高*0.19, 半*0.97);
      块(哑光, 宽*0.92, 0.10, 长*0.08, 0, 高*0.21, -半*0.97);
      /* 灯：横贯日行灯 + 两侧主灯 + 尾灯带 */
      块(白光, 宽*0.62, 0.035, 0.045, 0, 高*0.46, 半*1.000);
      块(白光, 宽*0.20, 0.09,  0.06,  -宽*0.30, 高*0.40, 半*0.995);
      块(白光, 宽*0.20, 0.09,  0.06,   宽*0.30, 高*0.40, 半*0.995);
      块(红, 宽*0.66, 0.05, 0.04, 0, 高*0.50, -半*1.000);
      块(红, 宽*0.22, 0.08, 0.05, -宽*0.28, 高*0.44, -半*0.995);
      块(红, 宽*0.22, 0.08, 0.05,  宽*0.28, 高*0.44, -半*0.995);
      /* 前格栅（三条横杆） */
      块(哑光, 宽*0.50, 高*0.12, 0.05, 0, 高*0.30, 半*1.005);
      for(i=0;i<3;i++)块(银, 宽*0.46, 0.015, 0.02, 0, 高*0.265+i*0.028, 半*1.02);
      /* 后视镜 */
      for(i=-1;i<=1;i+=2){
        块(哑光, 0.16, 0.03, 0.03, i*(半W-0.02), 高*0.66, 半*0.44);
        块(车漆, 0.10, 0.07, 0.17, i*(半W+0.05), 高*0.68, 半*0.44);
      }
      /* 尾翼 */
      块(车漆, 宽*0.94, 0.06, 长*0.09, 0, 高*0.88, -半*0.88);
      块(哑光, 0.07, 高*0.22, 0.09, -宽*0.33, 高*0.75, -半*0.88);
      块(哑光, 0.07, 高*0.22, 0.09,  宽*0.33, 高*0.75, -半*0.88);
      /* 排气 */
      管(钢, 0.055,0.055, 0.14, -宽*0.26, 高*0.22, -半*1.02, Math.PI/2,0,0);
      管(钢, 0.055,0.055, 0.14,  宽*0.26, 高*0.22, -半*1.02, Math.PI/2,0,0);
      /* 四个轮 + 轮拱 */
      for(i=0;i<4;i++){
        sx=(i%2===0?-1:1);sz=(i<2?1:-1);
        轮.push(造轮(sx*(半W-0.05), sz*轴距, sz>0, R, 0.26));
        轮拱(sx*(半W-0.02), sz*轴距, R);
      }
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
             速:0,vy:0,腾空:false,离地:0,失衡:0,转向:0,生命:d.生命,漂移:0,轮角:0,冲撞冷却:0,发动机:0};
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
    /* 【batch256】只有真的"悬在空中"才不许下车。
       以前还判 car.腾空——但贴着坡面、停在崖边都会把腾空置 true，结果按 F 直接被拒。 */
    if((car.离地||0)>1.2){
      try{if(typeof showMsg==='function')showMsg('先落回地面再下车（现在离地 '+(Math.max(0,car.离地||0)).toFixed(1)+' 米）','#ffb347');}catch(e){}
      return;
    }
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

  /* ================= 【batch257】迷你刚体：车失稳时**完全交给物理** =================
     为什么非要这个：只要车还是"一个点 + 一个 y + 几个手写公式"，崖边就只能靠补丁凑
     （把车拽出去、插进山体再挤出来）。补丁怎么打都不对，因为**车身不是一个点**：
       · 前轮已经悬空、后轮还压在台面上 → 必然绕后轴往前栽（真实的车就是这样翻下去的）
       · 车头斜着插进崖壁 → 接触点在车头前角，反作用力把车头横着推开，而不是把整车抬上台面
     这套东西就是课本上的**刚体 + 冲量法**，没有一行是"凑"的：
       ① 重力 → 线速度 → 位置；角速度 → 四元数 → 姿态（都是积分出来的）
       ② 车身 8 个角各自探一次接触（地面用高度场、墙用 isColliding 的布尔场）
       ③ 每个接触点：算它自己的速度 vp = v + ω×r，取法向分量 vn
          冲量 j = -(1+e)·vn / (1/m + n·(I⁻¹(r×n))×r)   （m=1，球惯性近似 → 括号那项）
          施加到线速度 v 和角速度 ω 上；切向再按 μ·j 限幅加摩擦
       ④ 穿透用 Baumgarte 慢慢推出去（一帧最多推一点），所以不会"啪"一下弹上台面
     ⚠️ 探地高度的口径：groundHeightAt(x,z,py) 的第 3 参是**相机高度**（脚底 + GROUND_Y），
        不是世界 y！上一版写成 wy+0.6，等于把脚底算低了 1.4 米，台面全部被判成"不可站"，
        所以既探不到支撑、又会乱推。这里统一用 wy+GROUND_Y+0.12。 */
  function 建刚体(car,d){
    var L=(d.长||4.4), W=(d.宽||2.0), H=(d.高||1.15);
    var 半L=L/2, 半W=W/2, 半H=H/2;
    var 角点=[];
    /* 角点用局部坐标：原点在**轮底**（和 car.obj 一致），所以上下角是 ±半H */
    for(var sx=-1;sx<=1;sx+=2)for(var sy=-1;sy<=1;sy+=2)for(var sz=-1;sz<=1;sz+=2){
      角点.push(new THREE.Vector3(sx*半W, sy*半H, sz*半L));
    }
    var I1=(L*L+H*H)/12, I2=(L*L+W*W)/12, I3=(W*W+H*H)/12;
    return {
      d:d, 角点:角点, 半H:半H, 半L:半L, 半W:半W,
      p:new THREE.Vector3(car.x, car.y+半H, car.z),
      q:new THREE.Quaternion().setFromEuler(new THREE.Euler(car.倾倒x||0, car.yaw, car.倾倒z||0, 'YXZ')),
      v:new THREE.Vector3(-Math.sin(car.yaw)*car.速, car.vy||0, -Math.cos(car.yaw)*car.速),
      w:new THREE.Vector3(car.倾ωx||0, 0, car.倾ωz||0),
      Iinv:1/((I1+I2+I3)/3),          /* 各向同性惯量近似：稳、够用，不会算炸 */
      静帧:0
    };
  }

  /* 接触法线（地面）：高度场梯度 → n = normalize(-∂h/∂x, 1, -∂h/∂z)。
     平地梯度 0 → 朝上；坡面 → 斜着顶车；崖壁处梯度极大 → 法线接近水平（推出去而不是抬上去）。 */
  function 接触法线(wx,wy,wz){
    var e=0.45, gx=0, gz=0, py=wy+GROUND_Y+0.12;
    try{
      gx=(groundHeightAt(wx+e,wz,py)-groundHeightAt(wx-e,wz,py))/(2*e);
      gz=(groundHeightAt(wx,wz+e,py)-groundHeightAt(wx,wz-e,py))/(2*e);
    }catch(e2){}
    if(Math.abs(gx)>0.15||Math.abs(gz)>0.15){
      var n=new THREE.Vector3(-gx,1,-gz).normalize();
      /* 地面法线的 y 分量必须留够（≥0.55 ≈ 最陡 56°）：
         崖口那一瞬间梯度大得离谱（几米落差 / 0.9 米基线），法线几乎变成水平的，
         于是"地面"反过来把车横着往台面里推 —— 表现就是车刚翻过崖口又被打回去。
         真正的墙由 isColliding 那条布尔场负责；高度场只负责托住车，永远以向上为主。 */
      if(n.y<0.55){n.y=0.55;n.normalize();}
      return n;
    }
    return new THREE.Vector3(0,1,0);
  }

  /* 墙面接触：**只问 isColliding 这个布尔函数**，不去碰障碍表长什么样
     （游戏里叫 obstacles、试车台里叫「障碍」，两套字段完全不同；问布尔最省事也最不容易错）。
     做法：点已经在实体里 → 往 8 个水平方向各挪 0.26 米，哪个方向"出来了"就是逃逸方向；
     再逐个量出"挪多远才完全出来"，取最近的那个当法线。深度就取这个距离。 */
  var _八向=[[1,0],[0.707,0.707],[0,1],[-0.707,0.707],[-1,0],[-0.707,-0.707],[0,-1],[0.707,-0.707]];
  function 墙接触(wx,wz,wy,r){
    if(typeof isColliding!=='function')return null;
    try{ if(!isColliding(wx,wz,r,wy,true))return null; }catch(e){ return null; }
    var i,ok,候选=[];
    for(i=0;i<8;i++){
      ok=false;
      try{ ok=!isColliding(wx+_八向[i][0]*0.26, wz+_八向[i][1]*0.26, r, wy, true); }catch(e2){ ok=false; }
      if(ok)候选.push(i);
    }
    if(!候选.length)return null;
    var 选=候选[0], 最短=9;
    for(var k=0;k<候选.length;k++){
      var dd=0.26;
      for(var d=0.26;d<=1.22;d+=0.16){
        ok=false;
        try{ ok=!isColliding(wx+_八向[候选[k]][0]*d, wz+_八向[候选[k]][1]*d, r, wy, true); }catch(e3){ ok=false; }
        if(ok){ dd=d; break; }
        dd=1.22;
      }
      if(dd<最短){最短=dd; 选=候选[k];}
    }
    if(最短>1.2)return null;
    return {nx:_八向[选][0], nz:_八向[选][1], 深:Math.max(0.03,Math.min(0.45,最短-0.26+0.1))};
  }

  /* 刚体一步：积分 → 收集接触 → 冲量迭代 → 位置修正。返回接触点个数（0＝完全腾空） */
  function 刚体步进(B,dt,g){
    var i,k,c,it;
    B.v.y-=g*dt;
    B.p.addScaledVector(B.v,dt);
    /* 姿态积分：dq = ½·(ω,0)⊗q */
    var dq=new THREE.Quaternion(B.w.x*0.5*dt,B.w.y*0.5*dt,B.w.z*0.5*dt,0).multiply(B.q);
    B.q.set(B.q.x+dq.x,B.q.y+dq.y,B.q.z+dq.z,B.q.w+dq.w).normalize();

    /* ---------- ① 收集接触点：8 个角 × (地面 + 墙面) ---------- */
    var 接=[];
    for(i=0;i<B.角点.length;i++){
      var r=B.角点[i].clone().applyQuaternion(B.q);
      var wx=B.p.x+r.x, wy=B.p.y+r.y, wz=B.p.z+r.z;
      var gh=wy;
      try{ gh=groundHeightAt(wx,wz,wy+GROUND_Y+0.12)-GROUND_Y; }catch(e){}
      var 穿=gh-wy;
      if(穿>-0.03){
        接.push({r:r, n:接触法线(wx,wy,wz), 深:Math.max(0,穿), 地:true});
      }
      var 墙=墙接触(wx,wz,wy,0.26);
      if(墙){
        var n2=new THREE.Vector3(墙.nx,0.05,墙.nz).normalize();
        接.push({r:r, n:n2, 深:墙.深, 地:false});
      }
    }
    var 接触数=接.length;
    if(!接触数)return 0;

    /* ---------- ② 冲量迭代（法向 + 切向摩擦） ---------- */
    var 恢复=0.02;                       /* 几乎不弹：车是"砸"在地上的，不是皮球 */
    for(it=0;it<6;it++){
      var 动=0;
      for(k=0;k<接.length;k++){
        c=接[k];
        var vp=new THREE.Vector3().crossVectors(B.w,c.r).add(B.v);
        var vn=vp.dot(c.n);
        if(vn>0.0)continue;                       /* 已经在分离，不用再加力 */
        var rn=c.r.dot(c.n);
        var kk=1+B.Iinv*Math.max(0,c.r.lengthSq()-rn*rn);
        var j=-(1+恢复)*vn/Math.max(0.2,kk);
        if(j<=0)continue;
        B.v.addScaledVector(c.n,j);
        B.w.addScaledVector(new THREE.Vector3().crossVectors(c.r,c.n),j*B.Iinv);
        动++;
        /* 切向：摩擦冲量最多 μ·j（库仑摩擦），轮胎给 0.9，车身铁皮给 0.35 */
        var vp2=new THREE.Vector3().crossVectors(B.w,c.r).add(B.v);
        var 切=vp2.clone().addScaledVector(c.n,-vp2.dot(c.n));
        var 切长=切.length();
        if(切长>1e-3){
          var t=切.multiplyScalar(1/切长);
          var rt=c.r.dot(t);
          var kt=1+B.Iinv*Math.max(0,c.r.lengthSq()-rt*rt);
          var μ=(c.地?0.85:0.40);
          var jt=Math.min(切长/Math.max(0.2,kt), μ*j);
          B.v.addScaledVector(t,-jt);
          B.w.addScaledVector(new THREE.Vector3().crossVectors(c.r,t),-jt*B.Iinv);
        }
      }
      if(!动)break;
    }

    /* ---------- ③ 穿透修正：只推一点点，靠多帧收敛（推多了就会"飞上台面"） ---------- */
    var 推=new THREE.Vector3(), 数=0;
    for(k=0;k<接.length;k++){
      c=接[k];
      if(c.深<=0.004)continue;
      推.addScaledVector(c.n,Math.min(c.深,0.22));
      数++;
    }
    if(数){
      推.multiplyScalar(0.55/数);
      if(推.length()>0.30)推.setLength(0.30);
      B.p.add(推);
    }
    /* 阻尼 + 限幅：数值上兜个底，不然极端穿透时角速度会爆 */
    B.w.multiplyScalar(Math.max(0,1-0.8*dt));
    if(B.w.length()>16)B.w.setLength(16);
    if(B.v.length()>70)B.v.setLength(70);
    return 接触数;
  }

  /* ---------- 物理 + 视角（每帧，只在驾驶时跑）---------- */
  function 驾驶Tick(){
    var car=驾驶;if(!car)return;
    var now=performance.now();
    var dt=Math.min(0.05,(now-上一帧)/1000)||0.016;上一帧=now;
    if(!S.playing||S.over||S.hp<=0){下车();return;}
    var d=car.def;
    /* ================= 【batch255】竖直方向：重力 + 地形约束 → 落差腾空 =================
       ⚠️ 上一版（254）做错了：搞成"速度够快升力压过车重就自动起飞"。用户要的不是飞机，
          是**车跑过有高低落差的地方会飞起来一下**（冲上坡顶、从台子上掉下去）。
       现在只做两件事，就是初中物理的抛体运动：
         ① 每帧给车一个向下的重力加速度：v_y -= g·dt，y += v_y·dt
         ② 地面托住车：y 掉到地面以下就压回地面，并把向下的速度吃掉（落地）
       剩下全交给地形自然产生：
         · 平地/缓坡：重力每帧把车压回地面 → 贴地跑，一点不飘
         · 冲上坡顶：地面把车往上顶，车带着这个向上的速度冲出去 → 抛物线，飞一段再落下
         · 掉下台阶/陡坎：地面突然降下去，车还停在高处 → 自由落体掉下来
       所以"能不能飞"取决于落差和速度，不取决于有没有到某个速度。 */
    var 腾空=!!car.腾空;
    /* 轮子离地就没有抓地力了：空中不能踩油门加速，也不能靠方向盘转向（只有惯性） */
    var 抓地=腾空?0:1;
    /* 油门 / 刹车 / 倒车 */
    var 油门=(键.w?1:0)-(键.s?1:0);
    if(油门>0)car.速+=d.加速*抓地*dt;
    else if(油门<0)car.速-=(car.速>0?d.加速*1.6:d.倒车*0.9)*抓地*dt;
    else car.速-=car.速*Math.min(1,(腾空?0.22:2.4)*dt);
    if(键.空格&&!腾空)car.速-=car.速*Math.min(1,6.5*dt);      // 手刹（空中踩了没用）
    car.速=Math.max(-d.倒车,Math.min(d.极速,car.速));
    /* 转向：速度越低越转不动（原地打方向盘没用）；轮子离地就几乎转不动 */
    var 转向输入=(键.a?1:0)-(键.d?1:0);
    var 有效=Math.min(1,Math.abs(car.速)/6)*(腾空?0.06:1);
    car.转向+=(转向输入-car.转向)*Math.min(1,8*dt);
    car.yaw+=car.转向*d.转向*有效*dt*(car.速>=0?1:-1);
    /* 位置推进 + 碰撞（撞墙就把速度吃掉大半，并往切线方向滑一下） */
    var fx=-Math.sin(car.yaw),fz=-Math.cos(car.yaw);
    /* 高速时一帧能走 0.55 米，撞 0.5 米厚的墙有穿过去的风险 → 按位移切成小步推进。
       这不算补丁，任何物理引擎都得做（叫 substep / CCD）。车速越快步数越多，最多 12 步。 */
    var 步数=Math.max(1,Math.min(12,Math.ceil(Math.abs(car.速)*dt/0.35)));
    var 步dt=dt/步数;
    var nx=car.x+fx*car.速*dt, nz=car.z+fz*car.速*dt;
    var 撞了=false;
    /* 【batch257】车身不是"一个点"。原来只在中心判一个半径 1.24 的圆：
       车头其实已经戳进山体/崖壁了，中心还在外面 → 判定"没撞"，于是整车插进去，
       然后靠"挤出来"的补丁救 —— 用户一眼就看出来这是在掩盖。
       现在沿车轴取 3 个圆（车头 / 车中 / 车尾），半径＝半宽，等价于一根胶囊：
       车头先碰到墙就在推进前被挡住，永远不会先插进去再解释。
       第 4 参＝车身高度、第 5 参＝台阶容差（0.12 米的神道铺石不该把车卡住）。 */
    /* 碰撞箱口径＝**和车身一样大的胶囊**（两端各一个半径=半宽 的圆，中间连起来）：
       圆半径取半宽 → 宽度方向正好贴合车宽；
       圆心只放到 半长-半径 处 → 长度方向也正好贴合车长（不会像原来那样"离墙半米就停"）。
       上一版用 长*0.45 当圆心间距，车头比真实车身长出去 0.8 米，看起来就是"撞到空气"。 */
    var 撞半径=Math.max(0.62,(d.宽||2.0)*0.5);
    var 撞半长=Math.max(0.25,(d.长||4.4)*0.5-撞半径);
    var 车身挡=function(x,z){
      if(typeof isColliding!=='function')return false;
      var py=car.y+GROUND_Y+0.45;
      for(var i=-1;i<=1;i++){
        if(isColliding(x+fx*撞半长*i, z+fz*撞半长*i, 撞半径, py, true))return true;
      }
      return false;
    };
    for(var 步=0;步<步数;步++){
      var sx=car.x+fx*car.速*步dt, sz=car.z+fz*car.速*步dt;
      撞了=false;
      try{
        if(车身挡(sx,sz))撞了=true;
        if(!撞了&&typeof worldLimit==='function'&&(Math.abs(sx)>worldLimit()-2||Math.abs(sz)>worldLimit()-2))撞了=true;
      }catch(e){}
      if(撞了)break;
      car.x=sx; car.z=sz;
    }
    if(撞了){
      /* 只前进方向被挡：沿"横向"滑一小段，避免贴墙卡死 */
      var 侧x=-fz,侧z=fx;
      var 滑=car.速*dt*0.35;
      var tx=car.x+侧x*滑, tz=car.z+侧z*滑;
      if(!车身挡(tx,tz)){car.x=tx;car.z=tz;}
      if(Math.abs(car.速)>9){try{spawnParticle(new THREE.Vector3(car.x,car.y+0.8,car.z),0xffcf6a,8,0.25);}catch(e){}}
      car.速*=-0.18;
    }
    /* 兜底：万一还是嵌在实体里（障碍是后来加的、或者从空中掉进了墙里），
       沿**水平**最短方向推出去。只动 x/z、绝不动 y —— 这就是它和以前那个
       "往上顶、把车顶上台面"的补丁最根本的区别：水平推出永远不会让车爬上墙。 */
    if(车身挡(car.x,car.z)){
      var 最x=0,最z=0,最短=99;
      for(var 角=0;角<16;角++){
        var ang=角*Math.PI/8, ux=Math.cos(ang), uz=Math.sin(ang);
        for(var dd=0.15;dd<=2.4;dd+=0.15){
          if(!车身挡(car.x+ux*dd,car.z+uz*dd)){ if(dd<最短){最短=dd;最x=ux;最z=uz;} break; }
        }
      }
      if(最短<99){ car.x+=最x*最短; car.z+=最z*最短; car.速*=0.5; }
    }
    /* ---------- 竖直方向：地面探测 ----------
       ⚠️ 探测高度必须锁在"上一帧的脚底"，不能用当前 y：
       用当前 y 会形成正反馈——车在大台子下面被抬起来一点 → 探测高度变高 → 探到头顶 3.4 米的台面
       → 被吸上台面 → 越吸越高（用户报的"能从低处直接飞上悬崖"就是这个）。
       另外补一条硬规则：头顶的台面比脚底高 0.6 米以上一律不认。 */
    var 基高=(car.地基===undefined)?car.y:car.地基;
    var 地面=car.y;
    try{ 地面=groundHeightAt(car.x,car.z,基高+GROUND_Y+0.5)-GROUND_Y; }catch(e){}
    /* 【batch262b】"时不时卡进地下"的根因：
       原来是 `if(地面>基高+0.6) 地面=基高` —— 一条 30° 的坡，车中心一帧就比基高高 0.6 米以上，
       于是这个坡被当成"头顶的台面"直接丢掉，车按基高贴地 → **车身沉进坡里**。
       现在改成两步：
         ① 连续上升的坡（车前方 1.2 米处也高）→ 按速度给一个允许抬升量（不会卡地，也爬得上）；
         ② 孤立的高台 / 崖壁（前方是空的）→ 仍然不认（保留"从低处飞上悬崖"那条防线）。 */
    var 允许=0.55+Math.min(1.6,Math.abs(car.速||0)*dt*3.2);
    if(地面>基高+允许){
      var 前地=基高;
      try{ 前地=groundHeightAt(car.x+fx*1.2,car.z+fz*1.2,基高+GROUND_Y+0.9)-GROUND_Y; }catch(e2){}
      if(前地>基高+0.4) 地面=基高+允许;      // 连续坡：允许（按速度钳住）
      else 地面=基高;                          // 孤立台面：不认
    }
    var 地速=Math.max(-40,Math.min(40,(地面-基高)/Math.max(dt,0.001)));
    var g=(d.重力||24);

    /* ---------- 四角探地：哪几只轮子还踩在地上 ---------- */
    var 半长=Math.max(0.9,(d.长||4.4)*0.42), 半宽=Math.max(0.45,(d.宽||2.0)*0.42);
    var 右x=Math.cos(car.yaw), 右z=-Math.sin(car.yaw);
    var 角地=function(ax,az){
      try{return groundHeightAt(ax,az,基高+GROUND_Y+0.9)-GROUND_Y;}catch(e){return 基高;}
    };
    var FL=角地(car.x+fx*半长+右x*半宽, car.z+fz*半长+右z*半宽);
    var FR=角地(car.x+fx*半长-右x*半宽, car.z+fz*半长-右z*半宽);
    var BL=角地(car.x-fx*半长+右x*半宽, car.z-fz*半长+右z*半宽);
    var BR=角地(car.x-fx*半长-右x*半宽, car.z-fz*半长-右z*半宽);
    /* 【batch262b】0.8 → 1.4 米：赛车场是起伏地形，0.8 米的坑太常见了，
       四个轮子轮流被判"悬空"，车一路在失稳/刚体/翻车之间抽搐（用户："对崎岖路段兼容很差"）。 */
    var 深=1.4;
    /* 悬空 ＝ 这只轮子脚下真的空了（地面比车身低 0.8 米以上）。
       【batch257】不再把"车尾埋进台体"也算成失稳：那件事交给刚体的角点接触去处理。
       后轮压着台面就是真支撑，前轮悬空 → 自然产生绕后轴的力矩 → 车往前栽。
       之前那条"埋土也算悬空"的规则会把上坡时前轮那点高差也误判成失稳（冲坡必翻）。 */
    var 悬FL=(基高-FL)>深, 悬FR=(基高-FR)>深;
    var 悬BL=(基高-BL)>深, 悬BR=(基高-BR)>深;
    var 悬角=(悬FL?1:0)+(悬FR?1:0)+(悬BL?1:0)+(悬BR?1:0);
    var 支撑数=4-悬角;
    if(car.倾倒x===undefined)car.倾倒x=0;
    if(car.倾倒z===undefined)car.倾倒z=0;
    if(car.倾ωx===undefined)car.倾ωx=0;
    if(car.倾ωz===undefined)car.倾ωz=0;

    /* ---------- 竖直运动 ----------
       两条路，各管一段：
         A. 4 只轮子都踩着地、或者完全腾空 → 简化模型（重力 + 地面托底 + 地形继承）
            贴地跑的时候没必要跑 8 角解算，手感稳、开销小；4 轮着地时两套结论本来就一致。
         B. 车身失稳（1~2 只轮子还踩着、其余悬空）→ **整段交给刚体**：
            翻下去的角度、绕哪条轴、飞出去多快，全是冲量解出来的，没有手写公式。
       判据只看"脚下是不是真空了"（低于 0.8 米）。上坡时前轮脚下比车身**高**，
       绝不能算失稳 —— 否则一上引道就被判成在崖边（这正是用户报的"斜面一直说我在边缘"）。 */
    /* 【batch262b】慢速（<4 m/s）也不算失稳：停车时脚下地形起伏不该把车"翻"下去 */
    var 边缘失稳=(支撑数>=1&&支撑数<=2)&&(Math.abs(car.速||0)>4);
    if(!car.刚体 && 边缘失稳 && !car.腾空 && car.y<=地面+0.45){
      car.刚体=建刚体(car,d);
    }
    if(car.刚体){
      var B=car.刚体;
      var 接触数=刚体步进(B,dt,g);
      /* 位置 / 姿态全由刚体给（半H 是质心到轮底的距离） */
      car.x=B.p.x; car.y=B.p.y-B.半H; car.z=B.p.z;
      car.obj.position.set(car.x,car.y,car.z);
      car.obj.quaternion.copy(B.q);
      var euB=new THREE.Euler().setFromQuaternion(B.q,'YXZ');
      car.yaw=euB.y;
      car.vy=B.v.y;
      var 前x=-Math.sin(car.yaw), 前z=-Math.cos(car.yaw);
      car.速=B.v.x*前x+B.v.z*前z;
      car.腾空=(接触数===0);
      /* 收车：速度都静下来了就交回简化模型（否则静止时会一直有细微抖动）。
         ⚠️ 这里是**游戏手感**的唯一一处"非物理"：落地停稳后把残余的仰角/侧倾收掉，
            让车还能继续开。收的是"倾斜量"，不是位置速度，落点该在哪还在哪。 */
      if(接触数>0 && B.v.length()<0.9 && B.w.length()<1.1) B.静帧++; else B.静帧=0;
      if(B.静帧>10){
        car.刚体=null;
        car.倾倒x=euB.x; car.倾倒z=euB.z;
        car.倾ωx=0; car.倾ωz=0; car.支点=null; car.掉下=false;
        car.vy=0; car.速*=0.6;
        car.地基=undefined;              /* 让下一帧按新位置重新探地面 */
      }
    }else{
      car.vy-=g*dt;
      car.y+=car.vy*dt;
      car.腾空=true;
      if(car.y<=地面+0.02){
        var 落地速=car.vy;
        car.y=地面;
        if(落地速<-8){
          car.速*=0.86;
          try{spawnParticle(new THREE.Vector3(car.x,地面+GROUND_Y+0.3,car.z),0xffd08a,14,0.32,true);}catch(e2){}
        }
        car.vy=Math.max(0,地速*(d.起跳系数||1));
        car.腾空=false; car.掉下=false; car.掉落vx=0; car.掉落vz=0; car.支点=null;
      }else if(car.y-地面<0.16&&car.vy<=0.5){
        car.y=地面; car.vy=0; car.腾空=false;
      }
    }

    /* ---------- 姿态 + 位置（只在简化模型这条路上算；刚体自己给） ---------- */
    var 侧倾=0;
    if(!car.刚体){
      var 俯仰=-(油门)*0.012 + (car.腾空?Math.max(-0.30,Math.min(0.30,-car.vy*0.022)):0);
      侧倾=-(car.转向||0)*Math.min(1,Math.abs(car.速)/16)*0.10;
      if(支撑数>=1&&!car.掉下){
        var fFL=悬FL?FR:FL, fFR=悬FR?FL:FR, fBL=悬BL?BR:BL, fBR=悬BR?BL:BR;
        俯仰+=Math.max(-0.55,Math.min(0.55,Math.atan2(((fFL+fFR)/2)-((fBL+fBR)/2), 半长*2)));
        侧倾+=Math.max(-0.45,Math.min(0.45,Math.atan2(((fFL+fBL)/2)-((fFR+fBR)/2), 半宽*2)));
        car.倾倒x*=1-Math.min(1,6*dt); car.倾倒z*=1-Math.min(1,6*dt);
        car.倾ωx*=1-Math.min(1,8*dt); car.倾ωz*=1-Math.min(1,8*dt);
        car.支点=null;
      }
      car.obj.position.set(car.x,car.y,car.z);
      car.obj.rotation.copy(new THREE.Euler(俯仰+car.倾倒x, car.yaw, 侧倾+car.倾倒z, 'YXZ'));
    }
    /* 【batch262b】最后一道保险：车底绝不能低于地形。
       陡坡上（尤其是失稳进刚体、刚体只解障碍不解地形的那几帧）车会陷进土里，
       用户看到的就是"时不时卡进地下"。这里每帧兜一次底，穿透深度不超过 6cm。 */
    try{
      var _兜地=groundHeightAt(car.x,car.z,car.y+GROUND_Y+0.6)-GROUND_Y;
      if(car.y<_兜地-0.06){ car.y=_兜地-0.06; car.obj.position.y=car.y; }
    }catch(_e9){}
    car.x=car.obj.position.x; car.y=car.obj.position.y; car.z=car.obj.position.z;
    if(!car.刚体)car.地基=地面;
    car.离地=Math.max(0,car.y-地面);
    car.支撑数=支撑数; car.支点y=car.支点?car.支点.y:null;
    car.失衡角=侧倾; car.俯仰角=car.obj.rotation.x;
    /* 轮子：滚动 + 前轮转向（两层：外层转向绕 Y，内层滚动绕 X）
       ⚠️【batch254】滚动角原来的负号是错的，已改回正号。推导：
          模型整体在 `壳` 里转了 180°（绕 Y），所以轮子"局部 +X"在世界里是 **-X**；
          要"车往前（世界 -z）走、轮顶也往 -z 转"，世界角速度必须绕 +X 为负。
          绕 -X 转 a 等于绕 +X 转 -a，所以要世界为负 ⇒ a 必须为正。
          也就是 rotation.x = +轮角。（上一版写了 -轮角，看着就是"往前开轮子倒着滚"。） */
    car.轮角+=car.速*dt/Math.max(0.2,d.车轮);
    for(var i=0;i<car.轮.length;i++){
      var w=car.轮[i];
      var 滚=w.滚||w.g;
      滚.rotation.x=car.轮角;
      if(w.前)w.g.rotation.y=car.转向*0.5;
    }
    /* ---------- 撞人 / 推人 ----------
       【batch262b】用户："车辆应该可以推着小兵，而不是直接穿过小兵"。
       原来是"只在速>7 时、每人 0.5 秒冷却、撞一次就 break"——
       慢速贴上去完全没反应（直接穿过），高速也是一次撞一个然后冷却半秒。
       现在拆成两件事：
         · **推挤**：只要车身贴到（3.2 米内）就沿"车头方向 + 远离车身"推移，任何速度都生效；
         · **撞击伤害**：仍然只在速 > 7 时结算，扣血 + 减速 + 粒子。
       己方小兵（e.友军）不撞也不推 —— 那是自己人（石棺吐出来的兵）。 */
    car.冲撞冷却-=dt;
    for(var k=enemies.length-1;k>=0;k--){
      var e=enemies[k];
      if(!e||e.isNet||e.友军)continue;
      if(e.hp<=0)continue;
      var ep=heroEntWorld(e);
      var dx=ep.x-car.x,dz=ep.z-car.z;
      var d2=dx*dx+dz*dz;
      var 碰=3.2;
      if(d2>碰*碰)continue;
      /* 推挤：**位置约束**，不是"速度 × dt"。
         一开始写成 `推速*dt`，实测只推开 0.26 米 —— 兵在 3 米开外贴一下就出圈了，
         推挤窗口只有一两帧，等于没推（探针里推挤帧=1）。
         现在改成"车身胶囊半径内一律顶到半径外"：不依赖速度、不依赖帧率，
         一帧就把人顶出去；车速快的时候人就顺着车头一路被顶着走。 */
      var 距=Math.sqrt(d2)||0.001;
      var 半径=Math.min(碰-0.2, 2.5);
      var 需要=半径-距;
      var 前推=(-Math.sin(car.yaw))*Math.abs(car.速)*dt*0.7 + (-Math.cos(car.yaw))*0;
      var nx2=ep.x+(dx/距)*需要 + (-Math.sin(car.yaw))*Math.abs(car.速)*dt*0.7;
      var nz2=ep.z+(dz/距)*需要 + (-Math.cos(car.yaw))*Math.abs(car.速)*dt*0.7;
      var 卡=false;
      try{ 卡=isColliding(nx2,nz2,0.45,ep.y+1.0,true); }catch(err){ 卡=false; }
      if(!卡){
        ep.x=nx2; ep.z=nz2;
        car._推挤帧=(car._推挤帧||0)+1;   /* 调试计数：探针用来确认"推挤真的执行了" */
        /* 跟着地形走，别被推上坡后悬空 */
        try{ var 地2=groundHeightAt(ep.x,ep.z,ep.y+GROUND_Y+0.6)-GROUND_Y; if(Math.abs(地2-ep.y)<1.6)ep.y+=(地2-ep.y)*Math.min(1,dt*10); }catch(err2){}
      }
      /* 撞击伤害（高速才有） */
      if(Math.abs(car.速)>7&&car.冲撞冷却<=0){
        if(typeof netIsMulti==='function'&&netIsMulti()){ continue; }
        var 伤=Math.round(Math.abs(car.速)*3.2);
        e.hp-=伤;e.flash=0.3;
        if(e.hb)e.hb.scale.x=Math.max(0,e.hp/e.maxHp);
        if(e.hbMat)e.hbMat.color.setHex(e.hp/e.maxHp>.5?0x00ff00:(e.hp/e.maxHp>.25?0xffff00:0xff0000));
        if(e.hp<=0&&typeof killEnemy==='function')killEnemy(e,k,false);
        car.冲撞冷却=0.35;car.速*=0.86;
        try{spawnParticle(new THREE.Vector3(ep.x,ep.y+1,ep.z),0xff8a3d,12,0.3,true);}catch(_){}
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
  /* ---------- 玩家 ↔ 载具碰撞（【batch262b】用户："玩家跟车辆为什么没有碰撞？走不上车顶，会直接穿过车辆"）----------
     车的形状用"定向矩形"（长轴局部 z、宽轴局部 x，与 mesh.rotation.y=yaw 一致），
     挡人/可站判定都各自只算一次，开销就是"场上车辆数"（最多 3）次。
       · 挡人：脚底在车身高度区间里 → 挡住（玩家撞车不会穿过去）
       · 可站：脚底已经高过车顶（跳上去）→ groundHeightAt 把车顶当成可站面
     开车时跳过自己那辆车，否则玩家会被自己开的车挡住。 */
  function 车局部(car,x,z){
    var c=Math.cos(car.yaw||0), sn=Math.sin(car.yaw||0);
    var dx=x-car.x, dz=z-car.z;
    return {lx:dx*c-dz*sn, lz:dx*sn+dz*c};
  }
  function 载具挡人(x,z,feet,py){
    for(var i=0;i<场上.length;i++){
      var car=场上[i];
      if(car===驾驶)continue;
      var d=car.def||{}, 半L=(d.长||4.4)/2+0.08, 半W=(d.宽||2.0)/2+0.08;
      var p=车局部(car,x,z);
      if(Math.abs(p.lx)>半W||Math.abs(p.lz)>半L)continue;
      var 顶=car.y+(d.高||1.1);
      if(feet>顶-0.18)continue;          // 已经站在车顶上方 → 不挡
      if(feet>car.y-0.45)return true;    // 在车身高度区间里 → 挡
    }
    return false;
  }
  function 载具顶面(x,z,feet){
    var best=-999;
    for(var i=0;i<场上.length;i++){
      var car=场上[i];
      if(car===驾驶)continue;
      var d=car.def||{}, 半L=(d.长||4.4)/2+0.12, 半W=(d.宽||2.0)/2+0.12;
      var p=车局部(car,x,z);
      if(Math.abs(p.lx)>半W||Math.abs(p.lz)>半L)continue;
      var 顶=car.y+(d.高||1.1);
      if(顶>best)best=顶;
    }
    return best;
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
    _有车:function(){return 场上.length>0;},
    /* 【batch262】列出场上的车（探针 / 赛车场用）：返回浅拷贝，改它不会动到真车 */
    _列表:function(){return 场上.slice();},
    /* 【batch262b】玩家碰撞钩子（js/12 的 groundHeightAt / playerBlocked 会问它们） */
    挡人:载具挡人, 顶面:载具顶面
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
