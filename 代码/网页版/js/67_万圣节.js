/* 【batch267】万圣节：南瓜头（js/67_万圣节.js）================================================
   用户口径：
     · 地图角落随机刷出南瓜头，靠近按 F 戴在头上；
     · 敌人在看你时，你头上就有一个南瓜灯（第三人称可见、发光）；
     · 像面罩一样戴在头上，**跟着视角一起转动** —— 向上看，它的脸也朝上；
     · 非常有万圣节气息。
   做法：
     ① 世界里刷 3 个南瓜灯（几何体建模：8 瓣瓜身 + 蒂 + 三角眼 + 锯齿嘴，眼睛嘴是自发光材质，
        不用任何贴图）；缓慢自转 + 上下浮动，靠近时屏幕下方出现「按 F 戴上」提示。
     ② 戴上后**第一人称画面完全不变**（用户口径："第一人称视角不会发生变化，只有别人看才会变成戴南瓜头"）。
        面罩那套模型代码保留在 南瓜_造面罩() 里，但**不挂相机** —— 想恢复只需在 万圣节_戴() 里加回 camera.add()。
     ③ 别人看你：远端玩家模型的 head 上挂一个完整的南瓜灯（发光眼睛嘴）。
     ④ 联机：位置报文 `{t:'p'}` 带 hat 标记（服务端存 p.hat，st 列表与 publicInfo 都带上），
        晚进的人也能看到谁戴着南瓜。
   ⚠️ 挂在模型/相机上的南瓜一律 `raycast=function(){}`（递归）：
      否则子弹会打中南瓜（爆头判定被它顶掉），第一人称射线还会被自己的面罩挡住。
   ⚠️ 换图时道具挂在 scene 上（不在 MAP_GROUP 里），必须自己清场。 */

var 万圣节_道具表=[];          /* 世界里的南瓜：{组,x,z,r,根} */
var 万圣节_已戴南瓜=false;
var 万圣节_面罩=null;          /* 挂在 camera 上的内壳 */
var 万圣节_提示牌=null;
var 万圣节_提示显示=false;
var 万圣节_远端瓜={};          /* netId -> 南瓜组（挂在 e.head 下） */

/* ==================== 一、建模 ==================== */
/* 8 瓣瓜身：球体顶点按经度做正弦膨胀 + 上下压扁 */
function 南瓜_球体(r, 带瓣){
  var geo=new THREE.SphereGeometry(r, 26, 18);
  var pos=geo.attributes.position;
  for(var i=0;i<pos.count;i++){
    var x=pos.getX(i), y=pos.getY(i), z=pos.getZ(i);
    var th=Math.atan2(z,x);
    var k=带瓣?(1+0.085*Math.sin(th*8)):1;
    pos.setXYZ(i, x*k, y*0.84*k, z*k);
  }
  geo.computeVertexNormals();
  return geo;
}
/* 把一块平面形状投影到球面上（脸朝 -z）：坐标以 (cx,cy) 为中心、缩放 倍 */
function 南瓜_面片(形状, r, cx, cy, 缩放){
  var g=new THREE.ShapeGeometry(形状);
  var p=g.attributes.position;
  for(var i=0;i<p.count;i++){
    var x=p.getX(i)*缩放+cx, y=p.getY(i)*缩放+cy;
    var yy=y/0.84;                                  /* 瓜身被压扁过，反算回球面 */
    var zz=r*r-x*x-yy*yy;
    var z=-Math.sqrt(Math.max(0.0004,zz))*0.99;     /* 稍微压在表面外一点，避免闪面 */
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}
function 南瓜_眼形(){
  var s=new THREE.Shape();
  s.moveTo(-0.5,-0.34);
  s.lineTo( 0.5,-0.10);
  s.lineTo( 0.10, 0.50);
  s.closePath();
  return s;
}
function 南瓜_嘴形(){
  var s=new THREE.Shape();
  s.moveTo(-0.50, 0.05);
  s.lineTo(-0.32,-0.42);
  s.lineTo(-0.13, 0.05);
  s.lineTo( 0.06,-0.42);
  s.lineTo( 0.24, 0.05);
  s.lineTo( 0.40,-0.38);
  s.lineTo( 0.50, 0.05);
  s.lineTo( 0.50,-0.85);
  s.lineTo(-0.50,-0.85);
  s.closePath();
  return s;
}
/* 完整南瓜灯（世界道具 / 别人头上的）——脸朝 -z，原点在瓜心 */
function 造南瓜灯(r){
  var g=new THREE.Group();
  var 皮=new THREE.MeshLambertMaterial({color:0xd2691e});
  var 亮=new THREE.MeshBasicMaterial({color:0xffd166,side:THREE.DoubleSide});
  g.add(new THREE.Mesh(南瓜_球体(r,true), 皮));
  /* 三角眼（左右各一） */
  var eL=new THREE.Mesh(南瓜_面片(南瓜_眼形(), r, -r*0.34, r*0.14, r*0.60), 亮);
  var eR=new THREE.Mesh(南瓜_面片(南瓜_眼形(), r,  r*0.34, r*0.14, r*0.60), 亮);
  /* 右眼镜像一下，两只眼才对得上 */
  eR.scale.x=-1;
  g.add(eL); g.add(eR);
  /* 锯齿嘴 */
  g.add(new THREE.Mesh(南瓜_面片(南瓜_嘴形(), r, 0, -r*0.36, r*0.62), 亮));
  /* 蒂 */
  var 蒂=new THREE.Mesh(new THREE.CylinderGeometry(r*0.09, r*0.14, r*0.32, 6),
                        new THREE.MeshLambertMaterial({color:0x4f7a34}));
  蒂.position.set(0, r*0.86+r*0.13, 0);
  蒂.rotation.z=0.16;
  g.add(蒂);
  /* 一根细细的"藤"更南瓜一点 */
  var 藤=new THREE.Mesh(new THREE.TorusGeometry(r*0.12, r*0.03, 5, 8, Math.PI*1.2),
                        new THREE.MeshLambertMaterial({color:0x5c8a3c}));
  藤.position.set(r*0.14, r*0.98, 0);
  藤.rotation.set(Math.PI/2, 0, 0.4);
  g.add(藤);
  g.traverse(function(o){ o.raycast=function(){}; });   /* 纯装饰：不参与任何射线 */
  return g;
}
/* 第一人称面罩（**当前不启用**，见 万圣节_戴 的注释）：
   挖掉正前方 ±32° 的球壳内壁 + 两个透光眼窝 + 蒂。留着备查/以后做"可选的沉浸模式"。 */
function 南瓜_造面罩(){
  var r=0.40;
  var 组=new THREE.Group();
  var 壳球=new THREE.SphereGeometry(r, 34, 16, Math.PI*1.678, Math.PI*1.644, 0, Math.PI*0.60);
  /* 一样做 8 瓣，免得内壁是个光溜的球 */
  var pos=壳球.attributes.position;
  for(var i=0;i<pos.count;i++){
    var x=pos.getX(i), y=pos.getY(i), z=pos.getZ(i);
    var th=Math.atan2(z,x), k=1+0.075*Math.sin(th*8);
    pos.setXYZ(i, x*k, y*0.92*k, z*k);
  }
  壳球.computeVertexNormals();
  var 壳=new THREE.Mesh(壳球, new THREE.MeshLambertMaterial({
    color:0xa9531b, emissive:0x3a1608, side:THREE.BackSide
  }));
  组.add(壳);
  /* 眼窝透光：从内壁看到的两块暖光（在开口外侧的壳上，不挡视线中央） */
  /* 眼窝：从里面看是两个**暗孔 + 一圈暖光**（实心亮圆看着像贴了两个橙球） */
  var 孔材=new THREE.MeshBasicMaterial({color:0x2a1206,side:THREE.DoubleSide});
  var 光材=new THREE.MeshBasicMaterial({color:0xffa94a,side:THREE.DoubleSide});
  for(var s=-1;s<=1;s+=2){
    var 孔=new THREE.Mesh(new THREE.CircleGeometry(0.024, 12), 孔材);
    孔.position.set(s*0.188, 0.095, -0.352);
    组.add(孔);
    var 晕=new THREE.Mesh(new THREE.RingGeometry(0.024, 0.036, 12), 光材);
    晕.position.set(s*0.188, 0.095, -0.3515);
    组.add(晕);
  }
  /* 内壁的瓜瓣起伏靠球壳本身的 8 瓣几何（已经做过），这里不再加"竖条"——
     第一版在球壳里立了 8 根细长 Box，从相机看就是两根柱子，很出戏。 */
  /* 头顶的蒂（抬头能看见） */
  var 蒂=new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.055,0.12,6),
                        new THREE.MeshBasicMaterial({color:0x4a6b2e}));
  蒂.position.set(0.02, 0.375, -0.06);
  蒂.rotation.z=0.2;
  组.add(蒂);
  组.traverse(function(o){ o.raycast=function(){}; });
  return 组;
}

/* ==================== 二、世界里的南瓜（角落随机刷） ==================== */
function 万圣节_清场(){
  for(var i=0;i<万圣节_道具表.length;i++){
    var it=万圣节_道具表[i];
    try{ if(it.组&&it.组.parent)it.组.parent.remove(it.组); }catch(e){}
  }
  万圣节_道具表.length=0;
}
function 万圣节_刷新(){
  万圣节_清场();
  var lim=0;
  try{ lim=worldLimit()||85; }catch(e){ lim=85; }
  var 基=lim*0.80;
  var 角=[[1,1],[-1,1],[1,-1],[-1,-1]];
  var 造了=0;
  for(var c=0;c<角.length&&造了<3;c++){
    for(var t=0;t<14;t++){
      var x=角[c][0]*基+(Math.random()*2-1)*lim*0.12;
      var z=角[c][1]*基+(Math.random()*2-1)*lim*0.12;
      /* ⚠️ 别用圆半径判断：方形地图的角落到中心 ≈ lim*1.13，一头就全被否掉
         （第一版 3 个都没刷出来，就是这个 continue 吃掉的）。按方形边界收。 */
      if(Math.abs(x)>lim*0.96||Math.abs(z)>lim*0.96)continue;
      var 卡=false;
      /* ⚠️ 碰撞与取地都按"站在地上的人"算：py 传 GROUND_Y+0.2（脚底 0.2 米），
         这样 2 米以下的箱子/矮墙会挡住刷新点，也不会把南瓜放到箱子顶上（第一版就悬在半空）。 */
      try{ 卡=isColliding(x,z,0.8,GROUND_Y+0.2,true); }catch(e2){ 卡=false; }
      if(卡)continue;
      var 地=0;
      try{ 地=groundHeightAt(x,z,GROUND_Y+0.05)-GROUND_Y; }catch(e3){ 地=0; }
      /* 坡度太陡的地方不刷（南瓜会半埋/悬空） */
      var 坡1=0,坡2=0;
      try{
        坡1=Math.abs((groundHeightAt(x+1.2,z,地+GROUND_Y+0.05)-GROUND_Y)-地)/1.2;
        坡2=Math.abs((groundHeightAt(x,z+1.2,地+GROUND_Y+0.05)-GROUND_Y)-地)/1.2;
      }catch(e4){}
      if(坡1>0.6||坡2>0.6)continue;
      var r=0.42+Math.random()*0.10;
      var 组=造南瓜灯(r);
      组.position.set(x, 地+GROUND_Y+r*0.72, z);
      /* 脸朝地图中心（模型脸朝 -z → yaw=atan2(-x,-z)）：玩家从场地中间走过来正好看到正脸 */
      组.rotation.y=Math.atan2(-x,-z)+ (Math.random()*0.5-0.25);
      try{ scene.add(组); }catch(e5){ continue; }
      万圣节_道具表.push({组:组,x:x,z:z,根:地,r:r,相位:Math.random()*6.283});
      造了++;
      break;
    }
  }
  return 造了;
}
/* 离玩家最近的、够得着的南瓜（没戴才找） */
function 万圣节_最近(){
  if(万圣节_已戴南瓜)return null;
  var best=null,bd=1e9;
  for(var i=0;i<万圣节_道具表.length;i++){
    var it=万圣节_道具表[i];
    var dx=camera.position.x-it.x, dz=camera.position.z-it.z;
    var d=dx*dx+dz*dz;
    if(d<6.0&&d<bd){ bd=d; best=it; }
  }
  return best;
}

/* ==================== 三、戴 / 摘 ==================== */
function 万圣节_已戴(){ return !!万圣节_已戴南瓜; }
function 万圣节_戴(on){
  万圣节_已戴南瓜=!!on;
  /* 【batch267c】第一人称**不做任何视觉变化**：不挂面罩、不改 FOV、不加滤镜。
     南瓜头只存在于别人眼里的第三人称模型上（远端 e.head 的挂件），
     自己这边最多弹一句提示，告诉他们"别人现在看得到"。
     ⚠️ 别在这里 camera.add(...)：一旦挂上去就是全屏遮挡，用户明确不要。 */
  if(on){
    try{ showMsg('🎃 戴上了南瓜头（只有别人看得到）','#ffb347'); }catch(e){}
  }else{
    try{ showMsg('🎃 摘下了南瓜头','#c8d8e8'); }catch(e){}
  }
  万圣节_刷新提示();
}
/* 摘下来的南瓜放回脚前，变成一个可以再捡的道具 */
function 万圣节_放回脚边(){
  var 前=1.35;
  var x=camera.position.x-Math.sin(yaw)*前;
  var z=camera.position.z-Math.cos(yaw)*前;
  var 地=0;
  try{ 地=groundHeightAt(x,z,camera.position.y)-GROUND_Y; }catch(e){ 地=0; }
  var r=0.44;
  var 组=造南瓜灯(r);
  组.position.set(x, 地+GROUND_Y+r*0.72, z);
  组.rotation.y=Math.random()*Math.PI*2;
  try{ scene.add(组); }catch(e){ return; }
  万圣节_道具表.push({组:组,x:x,z:z,根:地,r:r,相位:Math.random()*6.283});
}

/* ==================== 四、别人头上的南瓜 ==================== */
function 南瓜_应用远端(e,on){
  if(!e||!e.head)return;
  var id=e.netId;
  if(on){
    var h=e._南瓜;
    if(!h){
      h=造南瓜灯(0.30);
      h.position.set(0, 0.10, 0);
      try{ e.head.add(h); }catch(err){ return; }
      e._南瓜=h;
    }
    h.visible=true;
    if(id!=null)万圣节_远端瓜[id]=h;
  }else{
    var g=e._南瓜;
    if(g&&g.parent)g.parent.remove(g);
    e._南瓜=null;
    if(id!=null)delete 万圣节_远端瓜[id];
  }
}
function 万圣节_清远端(){
  for(var k in 万圣节_远端瓜){
    var g=万圣节_远端瓜[k];
    try{ if(g&&g.parent)g.parent.remove(g); }catch(e){}
  }
  万圣节_远端瓜={};
}

/* ==================== 五、屏幕提示 ==================== */
function 万圣节_建提示(){
  if(万圣节_提示牌||typeof document==='undefined')return;
  var d=document.createElement('div');
  d.id='hatTip';
  d.style.cssText='position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:120;'+
    'padding:7px 16px;border-radius:22px;font:700 14px/1.4 system-ui,"Microsoft YaHei",sans-serif;'+
    'color:#ffe0b0;background:rgba(28,16,8,.82);border:1px solid rgba(255,150,60,.55);'+
    'box-shadow:0 4px 18px rgba(0,0,0,.45);pointer-events:none;display:none;white-space:nowrap';
  d.textContent='按 F 戴上南瓜头';
  try{ document.body.appendChild(d); }catch(e){}
  万圣节_提示牌=d;
}
function 万圣节_刷新提示(){
  万圣节_建提示();
  if(!万圣节_提示牌)return;
  var 近=万圣节_最近();
  var 要=(!!近)&&(typeof S!=='undefined')&&S.playing&&!S.paused&&!S.over;
  if(要){
    var 手机='ontouchstart' in window;
    万圣节_提示牌.textContent=手机?'点「上梯」按钮戴上南瓜头':'按 F 戴上南瓜头';
    万圣节_提示牌.style.display='block';
  }else{
    万圣节_提示牌.style.display='none';
  }
  万圣节_提示显示=!!要;
}

/* ==================== 六、键盘：F 戴 / 摘 ==================== */
document.addEventListener('keydown',function(e){
  try{ if(e.code!=='KeyF'||e.repeat)return; }catch(_){ return; }
  try{ if(typeof 正在打字==='function'&&正在打字())return; }catch(_){}
  try{ if(!S||!S.playing||S.over||S.paused)return; }catch(_){ return; }
  try{ if(typeof 载具!=='undefined'&&载具&&typeof 载具.在开车==='function'&&载具.在开车())return; }catch(_){}
  if(万圣节_已戴南瓜){
    /* 已戴：按 F 摘下（手里正拿着投掷物/玩家长按交互时不动它，避免和别的 F 交互打架） */
    万圣节_戴(false);
    万圣节_放回脚边();
    return;
  }
  var it=万圣节_最近();
  if(!it)return;
  /* 从场上摘掉这个南瓜 */
  try{ if(it.组&&it.组.parent)it.组.parent.remove(it.组); }catch(_){}
  for(var i=万圣节_道具表.length-1;i>=0;i--) if(万圣节_道具表[i]===it)万圣节_道具表.splice(i,1);
  万圣节_戴(true);
},false);

/* ==================== 七、每帧（低速轮询就够） ==================== */
setInterval(function(){
  try{
    if(typeof S==='undefined')return;
    var t=performance.now()/1000;
    for(var i=0;i<万圣节_道具表.length;i++){
      var it=万圣节_道具表[i];
      if(!it.组)continue;
      it.组.rotation.y+=0.012;
      it.组.position.y=it.根+GROUND_Y+it.r*0.72+Math.sin(t*1.6+it.相位)*0.045;
    }
    万圣节_刷新提示();
  }catch(e){}
},60);

/* ==================== 八、换图：重刷 / 清远端 ==================== */
var _万圣节_setMap原=setMap;
setMap=function(id,不存){
  var ok=_万圣节_setMap原(id,不存);
  try{ 万圣节_清远端(); }catch(e){}
  /* 场景里的旧南瓜是挂在 scene 上的，setMap 不会替我们清 */
  try{ 万圣节_刷新(); }catch(e){}
  return ok;
};

/* ==================== 九、对外接口（探针 / 后续剧情可用） ==================== */
window.万圣节={
  刷新:万圣节_刷新, 清场:万圣节_清场, 已戴:万圣节_已戴, 戴上:万圣节_戴,
  最近:万圣节_最近, 道具数:function(){return 万圣节_道具表.length;},
  /* 场上南瓜的坐标（纯数据，给探针/调试用；模型对象不出页面） */
  点:function(){ var a=[]; for(var i=0;i<万圣节_道具表.length;i++){var it=万圣节_道具表[i];a.push({x:it.x,z:it.z,r:it.r});} return a; },
  提示显示:function(){return !!万圣节_提示显示;},
  面罩:function(){return 万圣节_面罩;},
  远端:南瓜_应用远端, 清远端:万圣节_清远端,
  造南瓜灯:造南瓜灯
};
