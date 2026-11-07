// ==================== MAP ====================
/* 【多地图系统 · batch111】一张地图 = 一个 THREE.Group + 一个独立的 obstacles 数组。
   为什么这么拆：碰撞函数（playerBlocked / isColliding / groundHeightAt / hasLineOfSight2D）
   全都在读全局 obstacles；切图时只要把 obstacles 指到对应数组、把别的 Group 藏起来，
   整张地图就"换"掉了 —— 所有调用点一行都不用改。
     · _mapTarget / _obsTarget ＝ 当前构建目标（addBox / 塔 / 围栏 往这里写）
     · MAP_GROUP[id] / MAP_OBS[id] / MAP_BUILT[id] ＝ 每张图的网格组 / 障碍物 / 是否已建
     · setMap(id) ＝ 切图（懒构建 + 显隐 + 重建射线盒 + 换背景与雾）
   【地面/楼层的通用口径（这套东西是"楼梯 / 二楼 / 平台"的地基）】
     · groundHeightAt(x,z,py) 返回「可站面的最高顶面 + 眼高」，遍历所有障碍物，不再特判哨塔；
     · 台阶容差 STEP_UP：顶面比自己脚底高出不超过它的方块，算"能迈上去的台阶"，
       于是矮方块不挡路、走上去自动抬脚 —— 楼梯就是这么走上去的；
     · 楼板 slab：只在 y0..y1 那一层挡人（脚下能穿过、能站上去），塔顶平台 / 二楼地板 / 雨棚全是它。 */
var WORLD_SIZE=160, WALL_T=8;
var MAP_GROUP={}, MAP_OBS={}, MAP_BUILT={}, MAP_TP={};
var teleports=[];                                                  // 当前生效的传送点（切图时换）
var _tpTarget=null;                                                // 当前构建目标（地图函数往这里塞）
MAP_GROUP.classic=new THREE.Group(); MAP_OBS.classic=obstacles; MAP_BUILT.classic=true;
scene.add(MAP_GROUP.classic);
var _mapTarget=MAP_GROUP.classic, _obsTarget=MAP_OBS.classic;      // 当前构建目标
obstacles=MAP_OBS.classic;                                        // 当前生效的障碍物
var STEP_UP=0.55;
function modStepUp(){return (window.ModLoader&&ModLoader._phys&&typeof ModLoader._phys.stepUp==='number')?ModLoader._phys.stepUp:STEP_UP;}                                                 // 台阶容差（米）：比脚底高不超过它的方块可以迈上去
var MAP_HAS_LADDER=true, MAP_HAS_TOWER=true;                      // 只有经典图有爬梯 / 哨塔（新图没有 → 对应分支直接跳过）
function makeGround(group,color){
  var g=new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE,WORLD_SIZE),new THREE.MeshLambertMaterial({color:color}));
  g.rotation.x=-Math.PI/2; group.add(g); return g;
}
var ground=makeGround(MAP_GROUP.classic,0x222233);
// 【地面网格别再画细线】GridHelper 是 LineSegments，细线没有 mipmap：相机一低（蹲下只有 1.47 米高）
// 就用极掠射角去看这一整片网格线 → 会闪成不断爬动的摩尔纹，
// 转视角看着像"顿卡"（用户反馈：蹲下后环顾顿卡）。改成把网格"烘进地面贴图"，
// 由 mipmap + 各向异性自动滤平（见下面 _mkTex('ground') 那一段）。
// 原来这行：scene.add(new THREE.GridHelper(WORLD_SIZE, Math.round(WORLD_SIZE/2.5), 0x333355, 0x222244).translateY(0.01));
var wallMat=new THREE.MeshLambertMaterial({color:0x334455});