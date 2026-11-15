// ==================== 方块贴图（全部程序化生成，不引任何外部图片）====================
// 【为什么这么做】
//   原来每个方块都是纯色 Material，看不出"掩体"和"边界墙"，而且"贴图/模型不匹配"。
//   这里分成两类：
//     地形方块（掩体/建筑）：侧面砖石纹，上下面水泥纹 —— 六个面都有归属，不会露底。
//     边界方块（围住地图的一圈墙）：整块深色钢板 + 分层线 + 淡警示斜纹，一眼就能认出来。
//   【关键】贴图与模型怎么对齐：不按方块尺寸去克隆贴图（那会爆显存），而是
//   把 BoxGeometry 的 UV 按方块真实尺寸缩放（scaleBoxUV），每 unit 米平铺一次。
//   这样大方块自动多铺几遍砖，砖块大小处处一致 —— 大墙上绝不会出现"砖被拉成一条"。
var _texCache={};
function _mkTex(key,draw,W){
  if(_texCache[key])return _texCache[key];
  var S=W||256,c=document.createElement('canvas');c.width=c.height=S;   // 【batch190】允许指定尺寸：天空这种大面积渐变 / 日轮这种精细天体，256 严重不够
  var g=c.getContext('2d');
  draw(g,S);
  var t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;      // 允许平铺（UV 超过 1 才铺得开）
  // 各向异性过滤：这些贴图都是"每 2~4 米平铺一次"的高频花纹，贴地看（尤其蹲下，相机只有
  // 0.65 米高）时掠射角会把它们闪成一片不断爬动的摩尔纹，转视角看着"一顿一顿"。
  // 开 4x 各向异性把掠射角滤平（4x 对手机 GPU 的开销几乎可以忽略）。
  try{ if(typeof renderer!=='undefined'&&renderer&&renderer.capabilities&&renderer.capabilities.getMaxAnisotropy){ t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy()||1); } }catch(e){}
  _texCache[key]=t;
  return t;
}
// 地形方块·侧面：砖石
function brickTex(){
  return _mkTex('brick',function(g,S){
    g.fillStyle='#333c47';g.fillRect(0,0,S,S);
    var rows=8,bh=S/rows,bw=S/4;
    for(var r=0;r<rows;r++){
      for(var i=-1;i<5;i++){
        var x=i*bw+(r%2?bw*0.5:0),y=r*bh,v=(Math.random()*20-10)|0;
        g.fillStyle='rgb('+(80+v)+','+(92+v)+','+(106+v)+')';
        g.fillRect(x+2,y+2,bw-4,bh-4);
      }
    }
    g.strokeStyle='rgba(0,0,0,0.30)';g.lineWidth=2;
    for(var r2=0;r2<=rows;r2++){g.beginPath();g.moveTo(0,r2*bh);g.lineTo(S,r2*bh);g.stroke();}
    g.fillStyle='rgba(255,255,255,0.05)';
    for(var k=0;k<150;k++)g.fillRect(Math.random()*S,Math.random()*S,2,2);
  });
}
// 地形方块·上下面：水泥
function topTex(){
  return _mkTex('top',function(g,S){
    g.fillStyle='#49525d';g.fillRect(0,0,S,S);
    for(var k=0;k<900;k++){
      var v=(Math.random()*26-13)|0;
      g.fillStyle='rgba('+(92+v)+','+(103+v)+','+(115+v)+',0.55)';
      g.fillRect(Math.random()*S,Math.random()*S,3,3);
    }
    g.strokeStyle='rgba(0,0,0,0.20)';g.lineWidth=3;g.strokeRect(1.5,1.5,S-3,S-3);
  });
}
// 边界方块：深色钢板 + 分层线 + 淡警示斜纹
function borderTex(){
  return _mkTex('border',function(g,S){
    g.fillStyle='#212a34';g.fillRect(0,0,S,S);
    for(var r=0;r<4;r++){
      var y=r*S/4;
      g.fillStyle='rgba(255,255,255,0.055)';g.fillRect(0,y,S,4);
      g.fillStyle='rgba(0,0,0,0.35)';g.fillRect(0,y+S/4-5,S,5);
    }
    g.save();g.globalAlpha=0.075;g.strokeStyle='#ffb020';g.lineWidth=12;
    for(var i=-S;i<S*2;i+=52){g.beginPath();g.moveTo(i,0);g.lineTo(i+S,S);g.stroke();}
    g.restore();
  });
}
// ---------- 地面网格贴图（替代原来的 GridHelper 细线）----------
// 每 2.5 米一格，和原来的 GridHelper(WORLD_SIZE, WORLD_SIZE/2.5) 完全一致。
// 有 mipmap + 各向异性 → 掠射角会被自动平均成一层淡灰，转视角不再有爬动的摩尔纹。
var _groundTex=null;
function groundTex(){
  if(_groundTex)return _groundTex;
  _groundTex=_mkTex('ground',function(g,S){
    g.fillStyle='#222233';g.fillRect(0,0,S,S);                  // 底色和原地面一致
    g.strokeStyle='#333355';g.lineWidth=2;                      // 网格线（颜色和原来的 GridHelper 一致）
    g.beginPath();g.moveTo(0,1);g.lineTo(S,1);g.moveTo(1,0);g.lineTo(1,S);g.stroke();
  });
  _groundTex.repeat.set(WORLD_SIZE/2.5,WORLD_SIZE/2.5);
  return _groundTex;
}
/* 给某张地图的地面贴上网格（新图懒构建时也用同款，保证手感一致） */
function applyGroundTex(m){
  if(!m||!m.material)return m;
  m.material.map=groundTex();m.material.color.setHex(0xffffff);m.material.needsUpdate=true;return m;
}
applyGroundTex(ground);
// 让贴图跟着方块尺寸走：每 unit 米一个循环
// BoxGeometry 的面序固定是 +x -x +y -y +z -z，每个面 4 个顶点
function scaleBoxUV(geo,w,h,d,unit){
  var uv=geo&&geo.attributes&&geo.attributes.uv;
  if(!uv)return;
  var f=[[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
  for(var i=0;i<6;i++){
    var su=f[i][0]/unit, sv=f[i][1]/unit;
    for(var j=0;j<4;j++){
      var k=i*4+j;
      uv.setXY(k, uv.getX(k)*su, uv.getY(k)*sv);
    }
  }
  uv.needsUpdate=true;
}
// 两类方块各自的六面材质（懒生成、全局复用）
var _terrainFaces=null,_borderFaces=null;
function boxFaces(kind){
  if(kind==='border'){
    if(!_borderFaces){var b=new THREE.MeshLambertMaterial({map:borderTex()});_borderFaces=[b,b,b,b,b,b];}
    return _borderFaces;
  }
  if(!_terrainFaces){
    var s=new THREE.MeshLambertMaterial({map:brickTex()});
    var t=new THREE.MeshLambertMaterial({map:topTex()});
    _terrainFaces=[s,s,t,t,s,s];     // 侧面砖石、上下水泥 —— 六面都有贴图
  }
  return _terrainFaces;
}
// kind：不传/undefined = 地形方块；'border' = 边界方块。传了 mat 则用调用方自己的材质（塔、梯子等）
function addBox(x,z,w,h,d,mat,kind){
  var geo=new THREE.BoxGeometry(w,h,d);
  scaleBoxUV(geo,w,h,d,kind==='border'?4:2);
  var m=new THREE.Mesh(geo, mat?mat:(kind==='border'?boxFaces('border'):boxFaces('terrain')));
  m.position.set(x,h/2,z);m.userData._可合并=1;_mapTarget.add(m);   /* 【batch195】静态方块，建图完可以并进大网格 */
  // 【碰撞体也要分类】kind：'border'＝边界墙（把所有人关在里面的那圈），其余＝地形。
  // 两类方块的碰撞规则完全不同（边界墙永远挡），所以必须在这里标清楚，别让下游再靠猜。
  _obsTarget.push({cx:x,cz:z,w:w,d:d,h:h,kind:kind||'terrain',minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});
  return m;                                  // 【batch114】把网格返回去（建筑要给墙面开阴影）
}
/* 【batch112】addLedge —— "高空方块"：addBox 只能从地面长起来（盒子中心在 h/2），
   做不了二楼墙 / 楼板 / 雨棚。这个辅助函数把 mesh 摆在 y0..y0+h，碰撞体标成 slab
   （只在 y0..y1 那一层挡人、顶面可站）—— 于是"二楼"就这么搭起来了。 */
function addLedge(x,z,w,h,d,mat,kind,y0){
  y0=y0||0;
  var geo=new THREE.BoxGeometry(w,h,d);
  scaleBoxUV(geo,w,h,d,2);
  var m=new THREE.Mesh(geo, mat||boxFaces('terrain'));
  m.position.set(x,y0+h/2,z);m.userData._可合并=1;_mapTarget.add(m);   /* 【batch195】同 addBox */
  _obsTarget.push({cx:x,cz:z,w:w,d:d,h:y0+h,kind:kind||'ledge',slab:true,y0:y0,y1:y0+h,
                   minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});
  return m;
}
/* ==================== 【batch195】静态几何合并 ====================
   问题：地图是 addBox 一个一个砌出来的，日蚀图 1100+ 个独立 Mesh ＝ 每帧 1100 次 draw call，
   阴影 pass 再一遍。draw call 是 CPU 侧的固定开销，**降分辨率一分钱都省不到**
   —— 这就是"小体量网页游戏却很吃性能"的真凶（用户说的"还不如升级一下代码"，对）。
   做法：建图结束后，把 addBox / addLedge 生产的方块按材质分组，顶点变换到组坐标后
   拼成 2~3 个大 BufferGeometry，draw call 从上千掉到个位数。
     · 方块的 UV 已经 scaleBoxUV 过，拼进去之后贴图完全一致，不会拉伸；
     · material groups 按面保留（侧面砖石 / 上下水泥各自一个组，合并相邻同材质的组）；
     · 碰撞完全不受影响 —— obstacles 是纯数据，从来不依赖网格对象；
     · 合并后的网格标 _合几何：LIGHT.扫场景 见到它就永远投影 + 永远收影
       （否则包围球半径 = 整张地图 → 被"超大件不投影"的规则误杀，全图没影子）。
   返回被吃掉的网格数（探针用来确认真的合并了）。 */
function mergeMapGroup(g){
  if(!g||!g.children||!g.children.length)return 0;
  var buckets=[],i,n,k;
  var kids=g.children.slice();
  for(i=0;i<kids.length;i++){
    var o=kids[i];
    if(!o.isMesh||!o.geometry||!o.userData||!o.userData._可合并)continue;
    if(o.geometry.type!=='BoxGeometry'||!o.geometry.index||!o.geometry.attributes.uv||!o.geometry.attributes.normal)continue;
    var b=-1;
    for(n=0;n<buckets.length;n++) if(buckets[n].mat===o.material){ b=n; break; }
    if(b<0){ buckets.push({mat:o.material,list:[]}); b=buckets.length-1; }
    buckets[b].list.push(o);
  }
  var killed=0;
  for(n=0;n<buckets.length;n++){
    var bk=buckets[n];
    if(bk.list.length<4)continue;                       /* 三两个不值得合并，多一次 draw call 无所谓 */
    var pos=[],nor=[],uv=[],idx=[],grp=[],base=0,off=0,j,kk;
    for(j=0;j<bk.list.length;j++){
      var m0=bk.list[j], gm=m0.geometry;
      var pa=gm.attributes.position,na=gm.attributes.normal,ua=gm.attributes.uv;
      var dx=m0.position.x,dy=m0.position.y,dz=m0.position.z;
      var sx=m0.scale.x,sy=m0.scale.y,sz=m0.scale.z;
      for(kk=0;kk<pa.count;kk++){
        pos.push(pa.getX(kk)*sx+dx, pa.getY(kk)*sy+dy, pa.getZ(kk)*sz+dz);
        nor.push(na.getX(kk),na.getY(kk),na.getZ(kk));
        uv.push(ua.getX(kk),ua.getY(kk));
      }
      var ix=gm.index;
      for(kk=0;kk<ix.count;kk++) idx.push(base+ix.getX(kk));
      var gs=gm.groups;
      if(gs&&gs.length){
        for(k=0;k<gs.length;k++){
          var st=off+gs[k].start, ct=gs[k].count, mi=gs[k].materialIndex||0;
          var last=grp.length?grp[grp.length-1]:null;
          if(last&&last[2]===mi&&last[0]+last[1]===st) last[1]+=ct;
          else grp.push([st,ct,mi]);
        }
      }
      off+=ix.count; base+=pa.count;
    }
    var G=new THREE.BufferGeometry();
    G.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    G.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
    G.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    G.setIndex(idx);
    for(k=0;k<grp.length;k++) G.addGroup(grp[k][0],grp[k][1],grp[k][2]);
    G.computeBoundingSphere();
    var mm=new THREE.Mesh(G,bk.mat);
    mm.userData._合几何=1;
    mm.castShadow=true; mm.receiveShadow=true;
    mm.matrixAutoUpdate=false; mm.updateMatrix();
    g.add(mm);
    for(j=0;j<bk.list.length;j++){ g.remove(bk.list[j]); try{ bk.list[j].geometry.dispose(); }catch(e){} }
    killed+=bk.list.length;
  }
  return killed;
}

/* ==================== 【batch196】通用静态件合批（武器 / 敌人模型）====================
   用户问「能不能把 CPU 开销换成 GPU？」—— 能，而且最大的一块还没换：
   地图合并之后，剩下的 draw call 全在**模型**上：
     · 视角武器：75 个独立 Mesh（挂在 camera 下，永远不会被视锥剔除，每帧必画）
     · 每个敌人：32 个独立 Mesh（10 个兵 = 320 次提交，阴影 pass 再来一遍）
     · 粒子池：80 个 Mesh + 80 份独立材质
     · 每发玩家子弹都 new 一个 SphereGeometry + 一个 MeshBasicMaterial
   每次 draw call 都是 CPU 在干同一件苦力（算矩阵 / 剔除 / 绑材质 / 传 uniform），
   而 GPU 一次能吞几万个顶点。把「N 次提交」压成「1 次提交」就是纯粹的 CPU → GPU。

   与 mergeMapGroup 的分工：
     · mergeMapGroup 只吃地图方块（仅 BoxGeometry / 仅直接子节点 / 不处理旋转）；
     · 这个通用版支持任意几何（Cylinder / Torus / Circle / Plane）**和旋转缩放**，
       用完整 matrix 变换顶点，所以能用在武器和敌人上。

   保险规则（宁可少合，不能合错）：
     ① 只处理**直接子 Mesh** —— 嵌套 Group（弹匣 magazine、左手锚点 leftHandAnchor、
        weaponRig、knifeRig）天然跳过，动画该动的照样动；
     ② 只处理 userData._静态 标记过的 —— 模组自定义 build() 出来的不标记 → 不碰；
     ③ **功能件永不合并**（scope / adsHide）—— 详见下面【batch197】那条；
     ④ 材质必须是单个（material 数组跳过）；
     ⑤ 几何必须有 position / normal / uv 三件套（缺 uv 拼进去会花贴图）；
     ⑥ 透明件跳过 —— 合并后透明排序会乱（镜片在相机前 6cm，最怕这个）；
     ⑦ 同材质至少 3 个才合（两个不值得）。

   ⚠️【batch197】功能件（userData.scope / userData.adsHide）**绝对不能被合进去**：
   这两个标记的含义是「开镜时把这个网格隐藏掉」（引擎 js/24 按 visible 逐个切）。
   一旦被并进大网格，标记连原网格一起消失 → 那一坨永远 visible →
   开镜时瞄准镜死死挡在视野正中。用户报的「冲锋枪和其他枪开镜，镜头并没有正常隐藏」就是它。
   而狙击枪（def.scope=true）是**整组隐藏**，所以看起来"只有狙击枪正常"。
   为什么以前没暴露：模组枪的 build 里调 hand() → buildRightHand 末尾会 _标静态(group)，
   把**整组所有直接子 Mesh**都打上可合批标记（含之前加进来的瞄准镜）——这是合批最容易踩的坑。
   所以这里按"标记"排除，标静态 里也排除，双保险。
   返回 { 组:合了几组, 吃掉:几个网格 }，探针用来确认真的生效。 */
function 合批静态(g, 最少){
  var out={组:0,吃掉:0};
  if(!g||!g.children||!g.children.length)return out;
  最少=最少||3;
  var kids=g.children.slice(), buckets=[], i, n, kk, j;
  for(i=0;i<kids.length;i++){
    var o=kids[i];
    if(!o.isMesh||o.isInstancedMesh||o.isSkinnedMesh||!o.geometry)continue;
    if(!o.userData||!o.userData._静态)continue;
    /* 【batch197】功能件（开镜要单独隐藏的瞄准镜）保持独立 Mesh，绝不合并
       【batch203】动画件（拉机柄/铭牌等，检视与换弹要逐帧改姿态）同样保持独立 */
    if(o.userData.scope||o.userData.adsHide||o.userData.animPart)continue;
    var gm=o.geometry, at=gm.attributes;
    if(!at||!at.position||!at.normal||!at.uv)continue;
    if(gm.morphAttributes&&gm.morphAttributes.position&&gm.morphAttributes.position.length)continue;
    var mt=o.material;
    if(!mt||mt.length!==undefined)continue;           /* 材质数组（地图方块那种）跳过 */
    if(mt.transparent)continue;                        /* 透明件跳过 */
    var b=-1;
    for(n=0;n<buckets.length;n++)if(buckets[n].mat===mt){ b=n; break; }
    if(b<0){ buckets.push({mat:mt,list:[]}); b=buckets.length-1; }
    buckets[b].list.push(o);
  }
  for(n=0;n<buckets.length;n++){
    var bk=buckets[n];
    if(bk.list.length<最少)continue;
    var pos=[],nor=[],uv=[],idx=[],base=0;
    var nm=new THREE.Matrix3(), v=new THREE.Vector3();
    for(j=0;j<bk.list.length;j++){
      var m0=bk.list[j], geo=m0.geometry;
      m0.updateMatrix();
      var M=m0.matrix;
      nm.getNormalMatrix(M);
      var pa=geo.attributes.position, na=geo.attributes.normal, ua=geo.attributes.uv;
      for(kk=0;kk<pa.count;kk++){
        v.set(pa.getX(kk),pa.getY(kk),pa.getZ(kk)).applyMatrix4(M);
        pos.push(v.x,v.y,v.z);
        v.set(na.getX(kk),na.getY(kk),na.getZ(kk)).applyMatrix3(nm).normalize();
        nor.push(v.x,v.y,v.z);
        uv.push(ua.getX(kk),ua.getY(kk));
      }
      var ix=geo.index;
      if(ix){ for(kk=0;kk<ix.count;kk++) idx.push(base+ix.getX(kk)); }
      else { for(kk=0;kk<pa.count;kk++) idx.push(base+kk); }
      base+=pa.count;
    }
    var G=new THREE.BufferGeometry();
    G.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    G.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
    G.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    G.setIndex(idx);
    G.computeBoundingSphere();
    var mm=new THREE.Mesh(G,bk.mat);
    /* 顶点已经变换到 g 的本地坐标 → 新网格自己就是单位矩阵，固定不动 */
    mm.matrixAutoUpdate=false; mm.updateMatrix();
    mm.castShadow=false; mm.receiveShadow=false;     /* 由 LIGHT.扫场景 按规则接管 */
    mm.userData._合几何=1;                            /* 超大件规则见 扫场景 的特判 */
    mm.userData._静态合批=1;
    g.add(mm);
    for(j=0;j<bk.list.length;j++){ g.remove(bk.list[j]); try{ bk.list[j].geometry.dispose(); }catch(e){} }
    out.组++; out.吃掉+=bk.list.length;
  }
  return out;
}
/* 给一组「直接子 Mesh」打上可合批标记；keep 里的对象会被跳过（要保留动画的部件）。
   【batch197】带 scope / adsHide 的功能件也跳过 —— 它们必须能被单独切 visible。 */
function 标静态(g, keep){
  if(!g||!g.children)return 0;
  var n=0;
  for(var i=0;i<g.children.length;i++){
    var c=g.children[i];
    if(!c.isMesh)continue;
    /* 【batch203】功能件（开镜隐藏）与动画件（检视/换弹要单独动，如拉机柄、铭牌）都不许被并掉 ——
       合并之后这些网格就没了，动画找不到对象、开镜也藏不掉，症状会像"代码没生效"。 */
    if(c.userData&&(c.userData.scope||c.userData.adsHide||c.userData.animPart))continue;
    if(keep&&keep.length){ var sk=false; for(var k=0;k<keep.length;k++)if(keep[k]===c){sk=true;break;} if(sk)continue; }
    c.userData._静态=1; n++;
  }
  return n;
}
var HALF=WORLD_SIZE/2 - WALL_T/2;
// ① 边界方块：围住整张地图的那圈高墙（高度 16 米，基本看不到顶 —— 真正把人围在里面）
var WALL_H=16;
addBox(0,-HALF,WORLD_SIZE,WALL_H,2,null,'border');addBox(0,HALF,WORLD_SIZE,WALL_H,2,null,'border');
addBox(-HALF,0,2,WALL_H,WORLD_SIZE,null,'border');addBox(HALF,0,2,WALL_H,WORLD_SIZE,null,'border');
// ② 地形方块：地图里的掩体/建筑（不传 mat 就是「侧面砖石 + 上下水泥」那套贴图）
addBox(-15,-15,6,4,6);addBox(15,-15,6,4,6);addBox(-15,15,6,4,6);addBox(15,15,6,4,6);addBox(0,0,4,3,4);addBox(-30,0,8,5,3);addBox(30,0,8,5,3);addBox(0,-30,3,5,8);addBox(0,30,3,5,8);
addBox(-55,-55,10,6,10);addBox(55,55,10,6,10);addBox(-55,55,10,6,10);addBox(55,-55,10,6,10);
addBox(-42,42,14,7,4);addBox(42,-42,14,7,4);
// ===== 哨塔 + 爬梯 =====
