/* ==================== 地图注册表 / 切图（batch111）====================
   每张地图给一个 id + 构建函数；setMap(id) 负责"懒构建 → 显隐 → 换 obstacles → 重建射线盒 → 换背景"。
   新地图直接往 MAPS 里加一条就行，碰撞 / 小地图 / 出生点全部自动跟着走。 */
var MAPS=[
  {id:'classic', name:'经典·哨塔竞技场', icon:'🏟', color:'#6ea8ff', ladder:true, tower:true,
   /* 【batch133】世界半径：玩家 / AI / 投掷物能到达的最远处。经典图一直是 76，原样保留。 */
   limit:76,
   desc:'方形竞技场：四角与中央散布掩体，北侧一座哨塔（爬梯上塔顶，塔顶围栏可翻出去跳下）。视野开阔、节奏快。',
   build:function(){ /* 经典图在脚本解析时就建好了（obstacles 一开始就指向它），这里不用重来 */ }},
  {id:'eclipse', name:'日蚀环城', icon:'🌒', color:'#ff8a3d', ladder:false, tower:false,
   /* 【batch133】这张图是椭圆 a=104 / b=88 —— 比原来写死的 WORLD_LIMIT(76) 还大。
      边界不跟着放大的话：出生在 (18,84) 这类点时 z 的绝对值已经 ≥76，
      移动判定 `Math.abs(nz)<WORLD_LIMIT` 恒为 false → 那一个轴一步都迈不出去，
      玩家就"只能沿着另一条轴 + 垂直方向"动 —— 用户报的"卡在一个平面里"。
      取 104＝椭圆长轴；短轴方向外面有围墙挡着，实际走不到那么远。 */
   limit:104,
   desc:'椭圆形环城（东北角有一处外凸）：右侧一栋两层楼房（楼梯上二楼、二楼窗口可跳下）、左侧一栋更大的楼、四周散落民房与掩体；左上 A 点与右上 B 点互为传送门。',
   build:function(){ buildMapEclipse(); }}
];
var MAP_THEME={
  classic:{bg:0x1a1a2e,fog:0x1a1a2e,fogD:0.015},
  /* 【batch114】原来是 0x141824 / 雾 0.013（又黑又雾）。改成"日食天的白天"：
     天穹是天蓝、地面被暖阳照着，雾调淡到 0.0035（不然 100 米外就白茫茫，放大后的地图看不穿）。 */
  eclipse:{bg:0x9ab4cc,fog:0xa8bccd,fogD:0.0035}
};
/* 【batch133】当前地图的世界半径。原来各处直接用写死的 WORLD_LIMIT(76)，
   遇到比它还大的新图就会把玩家锁在"看不见的方形边界"里（日蚀环城 a=104/b=88）。
   没写 limit 的地图退回默认值，行为与以前完全一致。 */
function worldLimit(){ var m=mapNow(); return (m&&m.limit>0)?m.limit:WORLD_LIMIT; }
var MAP_KEY='gunGame.map.v1';
var curMapId='classic';
function mapById(id){ for(var i=0;i<MAPS.length;i++) if(MAPS[i].id===id) return MAPS[i]; return null; }
function mapNow(){ return mapById(curMapId)||MAPS[0]; }
function mapLoad(){ try{ var v=localStorage.getItem(MAP_KEY); if(v&&mapById(v))curMapId=v; }catch(e){} }
function mapSave(){ try{ localStorage.setItem(MAP_KEY,curMapId); }catch(e){} }
/* 单机出生点（脚踩地面，y 由 groundHeightAt 管）。联机出生点由服务端按图下发。 */
var MAP_SPAWNS={
  classic: [[0,15]],
  eclipse: [[-12,4], [-2,48], [30,24], [-44,26], [26,-22], [-2,-38], [-38,66], [60,14], [-42,-26], [18,80], [-66,-2], [58,-24], [52,70], [70,44], [-80,30], [86,4], [22,-70], [-40,-68], [56,-60], [-80,-30]]
};
function setMap(id){
  /* 【batch131】门口导航表跟着建图一起做（buildNavFor 定义在后面，函数声明会提升） */
  var m=mapById(id); if(!m)return false;
  /* 【batch114】每张图另存一份「地标」：楼梯在哪、二楼地板多高、二楼窗在哪、屋顶多高。
     探针只读它，不写死坐标 —— 以后改布局不用改探针（写死坐标是上次踩过的坑）。 */
  MAP_INFO[id]=MAP_INFO[id]||{stairs:[],floors:[],windows:[],roofs:[],doors:[],oval:[]};
  if(!MAP_BUILT[id]){                                   // 懒构建：第一次用到才建
    MAP_GROUP[id]=new THREE.Group(); MAP_OBS[id]=[]; MAP_TP[id]=[]; MAP_BUILT[id]=true; scene.add(MAP_GROUP[id]);
    var _gT=_mapTarget,_oT=_obsTarget,_tT=_tpTarget,_iT=_infoTarget;
    _mapTarget=MAP_GROUP[id]; _obsTarget=MAP_OBS[id]; _tpTarget=MAP_TP[id]; _infoTarget=MAP_INFO[id];
    _blockedRects=[];
    try{ m.build(); } finally { _mapTarget=_gT; _obsTarget=_oT; _tpTarget=_tT; _infoTarget=_iT; }
  }
  curMapId=id;
  MAP_HAS_LADDER=!!m.ladder; MAP_HAS_TOWER=!!m.tower;   // 爬梯 / 哨塔特判只对有它们的图生效
  obstacles=MAP_OBS[id];
  teleports=MAP_TP[id]||[];                             // 传送点也跟着换图
  for(var k in MAP_GROUP) if(Object.prototype.hasOwnProperty.call(MAP_GROUP,k)) MAP_GROUP[k].visible=(k===id);
  var th=MAP_THEME[id]||MAP_THEME.classic;
  try{ scene.background.setHex(th.bg); if(scene.fog){scene.fog.color.setHex(th.fog);scene.fog.density=th.fogD;} }catch(e){}
  if(!_navBuiltFor[id]){ _navBuiltFor[id]=1; try{buildNavFor(id);}catch(e){} }   // 【batch131】门口导航表（建完图再算，才能拿到 doors/roofs）
  buildObstacleBoxes();
  mapSave();
  return true;
}
/* ---------------- 传送门（batch112）----------------
   踩进 A 点的圈 → 立刻出现在 B 点；B 点同理。两个坑必须一起堵：
     · 落点不能正好压在对面那个圈上（否则一落地就被传回来）→ 落点取"圈的边缘再往场地中心推 4 米"；
     · 再加 1.2 秒冷却兜底（网络抖动 / 帧率极低时也不会来回弹）。 */
var TP_COOLDOWN_MS=1200;
function updateTeleports(){
  if(!teleports.length||S.hp<=0)return;
  var now=performance.now();
  if(S._tpCD&&now<S._tpCD)return;
  for(var i=0;i<teleports.length;i++){
    var t=teleports[i];
    var dx=camera.position.x-t.x, dz=camera.position.z-t.z;
    if(dx*dx+dz*dz<t.r*t.r){
      camera.position.x=t.to[0];
      camera.position.z=t.to[1];
      camera.position.y=groundHeightAt(t.to[0],t.to[1],GROUND_Y+2);
      S.velY=0;S.onGround=true;S.onLadder=false;S.mantle=0;S.landKick=0.12;
      S._tpCD=now+TP_COOLDOWN_MS;
      if(typeof showMsg==='function')showMsg('⚡ 传送门：'+t.name+' → '+t.toName,'#7fd6ff');
      break;
    }
  }
}
/* 把玩家放到当前地图的一个出生点上（单机开局用） */
function playerSpawnAt(){
  var l=MAP_SPAWNS[curMapId]||[[0,15]];
  var sp=l[(Math.random()*l.length)|0];
  camera.position.set(sp[0],GROUND_Y,sp[1]);
  S.velY=0;S.onGround=true;S.onLadder=false;S.mantle=0;S.landKick=0;
}
function closestOnAABB(px,pz,o){return{x:Math.max(o.minX,Math.min(px,o.maxX)),z:Math.max(o.minZ,Math.min(pz,o.maxZ))};}
function hasLineOfSight2D(fromX,fromZ,toX,toZ,toY){var dx=toX-fromX,dz=toZ-fromZ,distSq=dx*dx+dz*dz;if(distSq<0.01)return true;var invDist=1/Math.sqrt(distSq),dirX=dx*invDist,dirZ=dz*invDist,maxT=Math.sqrt(distSq);for(var i=0;i<obstacles.length;i++){var o=obstacles[i];if(o.slab)continue;if(o.h&&toY>o.h+0.2)continue;var tmin,tmax;if(Math.abs(dirX)<1e-8){if(fromX<o.minX||fromX>o.maxX)continue;tmin=0;tmax=maxT;}else{tmin=(o.minX-fromX)/dirX;tmax=(o.maxX-fromX)/dirX;if(tmin>tmax){var tmp=tmin;tmin=tmax;tmax=tmp;}}var tymin,tymax;if(Math.abs(dirZ)<1e-8){if(fromZ<o.minZ||fromZ>o.maxZ)continue;tymin=0;tymax=maxT;}else{tymin=(o.minZ-fromZ)/dirZ;tymax=(o.maxZ-fromZ)/dirZ;if(tymin>tymax){var tmp2=tymin;tymin=tymax;tymax=tmp2;}}if(tmin>tymax||tymin>tmax)continue;var enter=Math.max(tmin,tymin),exit=Math.min(tmax,tymax);if(enter<=maxT&&exit>=0)return false;}return true;}
