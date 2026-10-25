// ==================== DAMAGE & RELOAD ====================
/* 【batch227】联机拦截只针对"被远端玩家打"（那种服务端权威，走 hit 包，不经这里）。
   以前是无条件 return —— 而 takeDmg 的调用方全是**本地 AI 敌人 / 火车 / 剧情 BOSS**，
   服务端明确"不产生任何敌人"、根本不会替这些伤害兜底，
   于是从服务器网页打开（自动联机）玩单人/剧情时，敌人打玩家**完全不扣血**（用户实测）。 */
function takeDmg(n,src){if(netIsMulti()&&src&&src.isNet)return;
  if(typeof SK!=='undefined'&&SK&&SK.ghost>0)return;      // 【batch145】虚化中：无敌（联机由服务端权威，见 ghostUntil）
  if(typeof SK!=='undefined'&&SK&&SK.shadowT>0)return;    // 【batch158】遁入暗影：无敌（联机走 gh 标记 → 服务端 ghostUntil）
  /* 【batch120】球形闪电倒地后再挨一下（枪 / 刀 / 技能）＝ 秒杀（联机由服务端结算） */
  if(SK.downed>0){
    S.hp=0;updateHp();
    /* 【batch227】联机下本地算完还必须上报服务端：联机快照（netOnMsg 的 q.h）会拿
       服务端 hp 覆盖本地，不上报的话这一刀被抹掉，人还站着。 */
    if(netIsMulti()){try{netSend({t:'aihit',d:120});}catch(e){}}
    gameOver();return;}
  var raw=n;n=heroMitigate(n);   // 英雄技能：护盾减伤 / 反射减半
  // 反射力场：把另一半伤害还给开枪的人（单机就是 AI 敌人；联机由服务端结算，这里不会走到）
  if(SK.reflect>0&&raw>0&&src&&!src.isNet&&src.hp>0){
    var back=Math.max(1,Math.round(raw*0.5));
    src.hp-=back;src.flash=0.2;
    spawnParticle(src.g.position.clone().setY(1.0),0x7dffb0,6);
    if(src.hb)src.hb.scale.x=Math.max(0,src.hp/src.maxHp);
    if(src.hbMat)src.hbMat.color.setHex(src.hp/src.maxHp>.5?0x00ff00:src.hp/src.maxHp>.25?0xffff00:0xff0000);
    if(src.hp<=0){var si=enemies.indexOf(src);if(si>=0)killEnemy(src,si,false);}
  }
  if(SK.cloak>0){SK.cloak=0;SK._breakAt=performance.now();if(typeof spCloakSync==='function')spCloakSync();if(typeof showMsg==='function')showMsg('破隐！','#ffd166');}   // 【batch171】SP·暗哨：受伤破隐
  S.hp-=n;var ov=document.getElementById('dmg-overlay');ov.style.borderColor='rgba(255,0,0,.5)';setTimeout(function(){ov.style.borderColor='transparent';},150);
  /* 【batch227】联机下本地 AI / 环境伤害要上报服务端（aihit）纳入权威 —— 否则下一帧
     快照就把本地掉血抹回服务端认为的值（这就是"网页端敌人打玩家不扣血"的后半截）。 */
  if(netIsMulti()){try{netSend({t:'aihit',d:Math.max(1,Math.round(n))});}catch(e2){}}
  if(S.hp<=0){S.hp=0;updateHp();
    /* 【batch126】剧情里倒下 ≠ 游戏结束，而是走剧情结局（被闪电击败 → 被扔回总部） */
    if(typeof STORY_!=='undefined'&&STORY_.on&&!STORY_.cut){storyEnd('lose');return;}   // 【batch128】清剿阶段也算
    gameOver();}updateHp();}
function reload(){if(S.reloading||S.ammo===S.maxAmmo||!isGunWeapon()||!canAct())return;S.reloading=true;reloadAnimStart=performance.now();/* 【batch203】换弹会立刻打断检视（两个动作都抢枪的位姿，不打断就会打架） */try{if(typeof 结束检视==='function')结束检视();}catch(_eR){}/* 【batch203】上一次换弹的掉落弹匣也要清掉（换弹中途切枪/重按 R 时，网格会留在半空） */try{if(typeof _清掉落==='function')_清掉落();}catch(_eR2){}document.getElementById('reload-text').style.opacity='1';/* 【batch209】普通枪换弹音效：退匣 → （中途）上匣 → 收尾拉栓上膛。纪念枪走 _换弹高级，自己按动作点放音，这里不重复放 */try{if(typeof gunReloadStyle!=='function'||gunReloadStyle()!=='premium'){if(typeof playMagOut==='function')setTimeout(playMagOut,110);if(typeof playMagIn==='function')setTimeout(playMagIn,Math.max(300,S.reloadTime*0.55));if(typeof playChamber==='function')setTimeout(playChamber,Math.max(500,S.reloadTime*0.80));}}catch(_eRS){}setTimeout(function(){S.ammo=S.maxAmmo;S.reloading=false;if(currentMagMesh){currentMagMesh.position.y=0;currentMagMesh.rotation.x=0;currentMagMesh.visible=true;}weaponGroup.rotation.z=0;weaponGroup.rotation.y=0;/* 【batch203】高级换弹会临时改 position.y（枪下沉），收尾必须还原，否则换完枪永远低 3 厘米 */weaponGroup.position.y=(currentWeapon===WEAPON_GUN?gunGripPos().y:(curKnifeDef().gripPos||KNIFE_BASE_POS).y);updateAmmo();document.getElementById('reload-text').style.opacity='0';},S.reloadTime);}

// ==================== UI ====================
function updateHp(){var r=S.hp/S.maxHp;var bar=document.getElementById('hp-bar');bar.style.width=(r*100)+'%';bar.style.background=r>.5?'linear-gradient(90deg,#4f4,#6f6)':r>.25?'linear-gradient(90deg,#fa0,#fc0)':'linear-gradient(90deg,#f22,#f44)';document.getElementById('hp-text').textContent='❤️ '+Math.ceil(S.hp)+'/'+S.maxHp;}
function updateScore(){document.getElementById('score').textContent='得分: '+S.score;}
/* 【模组钩子 · batch166】玩法模式（GameMode）：让模组自定义"这一局怎么玩" ——
   比如做成瓦罗兰特那种回合制战术射击、或者和平精英那种缩圈大逃杀。
   模组用 ModLoader.addGameMode(模式对象) 注册、ModLoader.setGameMode('id') 启用。
   游戏会在四处问它：开局(startSoloGame) / 每帧(loop) / HUD(updateWave) / 阵亡(gameOver)。 */
var GAME_MODES={};
var CUR_MODE=null;
var _modeLastT=0;
function curMode(){try{return CUR_MODE?GAME_MODES[CUR_MODE]:null;}catch(e){return null;}}
function updateWave(){var _wv=document.getElementById('wave');if(!_wv)return;
  /* 玩法模式可以自己决定 HUD 这一栏显示什么（比如"剩余 42 人 / 决赛圈"） */
  var _gmh=curMode();if(_gmh&&typeof _gmh.hud==='function'){try{var _hv=_gmh.hud();if(_hv){_wv.textContent=_hv;return;}}catch(e){}}
  if(netIsMulti()){_wv.textContent='线上对战 · '+((NET.list&&NET.list.length)?NET.list.length:1)+' 人';return;}if(netIsMulti()){_wv.textContent='线上对战 · '+((NET.list&&NET.list.length)?NET.list.length:1)+' 人';return;}
  if(typeof STORY_!=='undefined'&&STORY_.on){_wv.textContent=storyGoalText();return;}      // 【batch126】剧情模式不显示波次
  _wv.textContent='第'+S.wave+'波 | 剩余:'+S.left;}
function updateAmmo(){
  /* 【batch218】手里拿着投掷物时枪已经收起来了，右下角的弹匣数没有意义 —— 直接藏掉。
     （以前只有拿刀时才藏，拿投掷物时还挂着"30/30"，用户："步枪的子弹数量为什么也要显示"） */
  try{ if(typeof SK!=='undefined'&&SK&&SK.hold){var _ae=document.getElementById('ammo');if(_ae)_ae.style.display='none';return;} }catch(e){}
  if(isGunWeapon())document.getElementById('ammo').innerHTML=S.ammo+' <span>/'+S.maxAmmo+'</span>';
  /* 【batch203】弹匣里的子弹跟着弹药量走：打掉一半低头看抱弹口，那发子弹真的没了 */
  try{ if(typeof 刷新弹匣子弹==='function'&&currentMagMesh)刷新弹匣子弹(currentMagMesh,S.ammo,S.maxAmmo); }catch(e){} }
function updateGoldHud(){document.getElementById('gold-hud').textContent='🪙 '+gold;}
function showMsg(t,c){var m=document.getElementById('msg');m.textContent=t;m.style.color=c||'#fff';m.style.opacity=1;setTimeout(function(){m.style.opacity=0;},1200);}
function renderUpgradeCards(){['upgrade-grid','ws-upgrade-grid'].forEach(function(gridId){var grid=document.getElementById(gridId);if(!grid)return;grid.innerHTML='';UPGRADES.forEach(function(u){var lv=upgradeLevels[u.id];var maxed=lv>=u.maxLv;var cost=maxed?0:u.costs[lv];var canBuy=!maxed&&gold>=cost;var card=document.createElement('div');card.className='upgrade-card'+(maxed?' maxed':'');var pips='';for(var i=0;i<u.maxLv;i++)pips+='<div class="level-pip'+(i<lv?(maxed?' filled maxed':' filled'):'')+'"></div>';var btnClass=maxed?'max-level':(canBuy?'can-buy':'locked');var btnText=maxed?'✅ 已满级':(canBuy?'🪙 '+cost+' 升级':'🪙 '+cost+' (不足)');card.innerHTML='<div class="upgrade-icon">'+u.icon+'</div><div class="upgrade-name">'+u.name+'</div><div class="upgrade-desc">'+u.desc+'</div><div class="upgrade-level">'+pips+'</div><button class="upgrade-btn '+btnClass+'" data-id="'+u.id+'">'+btnText+'</button>';grid.appendChild(card);});grid.querySelectorAll('.upgrade-btn.can-buy').forEach(function(btn){btn.addEventListener('click',function(ev){ev.stopPropagation();tryBuy(this.dataset.id);});});});var sg=document.getElementById('shop-gold');if(sg)sg.textContent=gold;var wg=document.getElementById('ws-gold');if(wg)wg.textContent=gold;}
/* 切页签（batch117）：原来靠全局 event.target 找"被点中的那个页签"，
   现在改成按 data-tab 找 —— 于是**不依赖事件**，别处也能直接调
   （setMenuMode 里要把暂停菜单复位到「枪械改装」就要用）。 */
function setTab(name){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active');});
  var tb=document.querySelector('.tab[data-tab="'+name+'"]');if(tb)tb.classList.add('active');
  var pn=document.getElementById('tab-'+name);if(pn)pn.classList.add('active');
}
function switchTab(name){setTab(name);}

// ==================== MINIMAP & BULLETS ====================
var mmFrame=0;
/* ==================== 小地图：谁能显示、谁不能（batch116）====================
   用户要求：**只有"看得见"或"被探测到"的敌人才画在小地图上**（不再是全知视角）。
   判据与头顶悬浮标记（updateHeroMark）同口径，改一处记得看另一处。 */
var MM_SIGHT=55, MM_HALF_FOV=70, MM_FOV_COS=Math.cos(MM_HALF_FOV*Math.PI/180);
// 被技能探测到 → 一定显示（红色 + 描边，和"亲眼看见"区分）
function mmDetected(e,rp){
  if(SK.revealAll>0)return true;                                   // 全域透视：全场标红
  if(SK.suneyeT>0)return true;                                    // 【batch152】日之眼：放出后**全图**所有敌人都暴露（不再限半径）
  if(SK.sp&&SK.spMarkT>0&&SK.spMarkIds&&SK.spMarkIds[e.__oid__])return true;   // 【batch171】猎杀标记：上小地图
  if(SK.mine>0){                                                   // 战术探测器：半径内 + 正在移动的目标
    var mx=rp.x-SK.mineX,mz=rp.z-SK.mineZ;
    if(mx*mx+mz*mz<MINE_R*MINE_R&&(e._mvSpd||0)>0.9)return true;
  }
  return false;
}
// 亲眼看见：够近 + 在视野锥内 + 中间没有墙挡（墙会挡视线，人就看不见）
function mmVisible(e,rp){
  var dx=rp.x-camera.position.x,dz=rp.z-camera.position.z,d2=dx*dx+dz*dz;
  if(d2>MM_SIGHT*MM_SIGHT)return false;
  var d=Math.sqrt(d2)||1;
  var fx=-Math.sin(yaw),fz=-Math.cos(yaw);                          // yaw=0 时前方是 -Z
  if((dx*fx+dz*fz)/d<MM_FOV_COS)return false;                       // 在侧后 / 背后 → 看不见
  return hasLineOfSight2D(camera.position.x,camera.position.z,rp.x,rp.z,rp.y+1.2);
}
function updateMinimap(){if(++mmFrame%MINIMAP_INTERVAL!==0)return;var cv=document.getElementById('minimap'),cx=cv.getContext('2d');var MM=MM_SIZE;if(cv.width!==MM){cv.width=MM;cv.height=MM;}var sc=0.8,c=MM/2,R=MM/2-2;cx.clearRect(0,0,MM,MM);cx.fillStyle='rgba(0,0,0,.4)';cx.beginPath();cx.arc(c,c,R,0,6.28);cx.fill();cx.fillStyle='rgba(100,100,150,.4)';for(var i=0;i<obstacles.length;i++){var o=obstacles[i];var ox=c+(o.cx-camera.position.x)*sc,oz=c+(o.cz-camera.position.z)*sc;if(ox>-20&&ox<MM+20&&oz>-20&&oz<MM+20)cx.fillRect(ox-o.w*sc/2,oz-o.d*sc/2,o.w*sc,o.d*sc);}/* 【batch149】第二章：小地图上标出「蚀日者」的位置（闪烁橙圈）——地图很大，没这个找不到路 */
if(typeof STORY_!=='undefined'&&STORY_.on&&STORY_.ch===2&&STORY_.phase==='rescue'){var _rx=c+(LAB_RESCUE.x-camera.position.x)*sc,_rz=c+(LAB_RESCUE.z-camera.position.z)*sc;if(_rx>-14&&_rx<MM+14&&_rz>-14&&_rz<MM+14){var _pl=0.5+0.5*Math.sin(performance.now()*0.006);cx.strokeStyle='#ffa03d';cx.lineWidth=2;cx.beginPath();cx.arc(_rx,_rz,5+2*_pl,0,6.28);cx.stroke();cx.fillStyle='#ffd06a';cx.beginPath();cx.arc(_rx,_rz,2.5,0,6.28);cx.fill();}}
for(var i=0;i<enemies.length;i++){var e=enemies[i];if(e.isNet?(!e.alive):(e.hp<=0))continue;var rp=heroEntWorld(e);var det=mmDetected(e,rp);if(!det&&!mmVisible(e,rp))continue;var ex=c+(rp.x-camera.position.x)*sc,ez=c+(rp.z-camera.position.z)*sc;if(!(ex>4&&ex<MM-4&&ez>4&&ez<MM-4))continue;var col=(e.isNet&&e.teamColor!==undefined)?e.teamColor:((ETYPES[e.type]||ETYPES.basic).c);cx.fillStyle=det?'#ff4d5e':('#'+col.toString(16).padStart(6,'0'));cx.fillRect(ex-2,ez-2,4,4);if(det){cx.strokeStyle='#ff4d5e';cx.lineWidth=1;cx.strokeRect(ex-4,ez-4,8,8);}}cx.fillStyle='#4f4';cx.beginPath();cx.arc(c,c,3,0,6.28);cx.fill();}
function updateBullets(){for(var i=bullets.length-1;i>=0;i--){var b=bullets[i];b.m.position.addScaledVector(b.d,2.5);if(trapBulletHit(b.m.position,20)){spawnParticle(b.m.position,0x6ff0ff,4,0.15);scene.remove(b.m);bullets.splice(i,1);continue;}if(typeof trainBoxHit==='function'&&trainBoxHit(b.m.position.x,b.m.position.y,b.m.position.z)){spawnParticle(b.m.position,0xffcc66,4,0.15);if(typeof trainDamage==='function')trainDamage(20,b.m.position.x,b.m.position.y,b.m.position.z);scene.remove(b.m);bullets.splice(i,1);continue;}   /* 【batch181】火车车厢挡子弹，并且掉血（20/发） */if(isColliding(b.m.position.x,b.m.position.z,0.15,b.m.position.y)){spawnParticle(b.m.position,0xffaa44,3,0.15);scene.remove(b.m);bullets.splice(i,1);continue;}if(--b.life<=0){scene.remove(b.m);bullets.splice(i,1);}}}
function updatePickups(){for(var i=pickups.length-1;i>=0;i--){var p=pickups[i];p.m.rotation.y+=0.03;p.m.position.y=1+Math.sin(performance.now()*0.003)*0.2;if(camera.position.distanceTo(p.m.position)<2){if(p.type==='hp'){var _ph=Math.round(25*heroHealMul());S.hp=Math.min(S.maxHp,S.hp+_ph);showMsg('+'+_ph+' HP','#4f4');updateHp();}else{S.ammo=S.maxAmmo;S.reloading=false;showMsg('弹药已满!','#fa0');updateAmmo();document.getElementById('reload-text').style.opacity='0';}scene.remove(p.m);pickups.splice(i,1);continue;}if(--p.life<=0){scene.remove(p.m);pickups.splice(i,1);}}}

// ==================== GAME LOOP ====================
/* 【batch155】死亡瞬间清掉所有"挂在身上"的屏幕层（白闪 / 电弧 / 倒地倒计时）：
   单机死后主循环停摆（S.over）、联机死后弹死亡面板——这些倒计时/特效不再被逐帧刷新，
   会永远糊在屏幕上（用户报：被闪光时被杀→白屏不消；被闪电大招击倒后再被补刀→倒计时和电弧不消） */
/* 【batch227】复活 / 重生时的"效果全清"：负面（倒地/减速/过载/易伤/致盲/感电/破甲/破隐）
   和正面（透视/虚化/暗影/隐身）一律清掉 —— 用户要求"正面效果也要清除"。
   放在 26 里（加载早于联机/剧情分片），大家共用；屏幕层一起收，避免"复活了白屏还挂着"。 */
function clearAllStatusFx(){
  if(typeof SK==='undefined'||!SK)return;
  SK.downed=0;SK._dbT=0;
  SK.slow=0;SK.overload=0;SK.vuln=0;
  SK.blind=0;SK.blindDur=0;SK.zap=0;
  SK.revealAll=0;                       // 正面：全域透视
  if(SK.ghost>0&&typeof heroGhostFx==='function')heroGhostFx(false);   // 虚化的半透视觉也要收
  SK.ghost=0;                           // 正面：虚化（无敌）
  SK.shadowT=0;                         // 正面：遁入暗影（无敌）
  if(SK.shadowObj){if(SK.shadowObj.parent)SK.shadowObj.parent.remove(SK.shadowObj);SK.shadowObj=null;}
  SK.cloak=0;SK._breakAt=0;             // 正面：隐身
  var sf=document.getElementById('shadowFx');if(sf)sf.style.display='none';
  var b=document.getElementById('blindFx');if(b)b.style.opacity='0';
  var z=document.getElementById('zapFx');if(z){z.style.opacity='0';z.style.transform='';}
  var d=document.getElementById('downedFx');if(d)d.style.display='none';
  if(typeof heroBlindSync==='function')heroBlindSync();
}
function clearDeathFx(){
  SK.blind=0;SK.blindDur=0;SK.zap=0;SK.overload=0;SK.vuln=0;SK.slow=0;SK.downed=0;
  /* 【batch158】死在暗影里也要把遁入状态一并收掉（残留小暗影 / 空手状态） */
  SK.shadowT=0;
  if(SK.shadowObj){if(SK.shadowObj.parent)SK.shadowObj.parent.remove(SK.shadowObj);SK.shadowObj=null;}
  var sf=document.getElementById('shadowFx');if(sf)sf.style.display='none';   // 【batch160】死在暗影里也把屏幕特效收掉
  var b=document.getElementById('blindFx');if(b)b.style.opacity='0';
  var z=document.getElementById('zapFx');if(z){z.style.opacity='0';z.style.transform='';}
  var d=document.getElementById('downedFx');if(d)d.style.display='none';
  if(typeof heroBlindSync==='function')heroBlindSync();
}
function gameOver(){
  /* 【模组钩子 · batch166】玩法模式可以接管阵亡：返回 true = 不走原版「游戏结束」面板 ——
     瓦罗兰特那种回合制就是"死了等下一回合"，和平精英那种则是"死了直接淘汰"。 */
  var _gm0=curMode();if(_gm0&&typeof _gm0.onDeath==='function'){try{if(_gm0.onDeath()===true)return;}catch(e){}}
  clearDeathFx();   /* 【batch155】死了也要把白闪 / 电弧 / 倒地倒计时一起收掉（含剧情阵亡，见下一行的剧情分支） */
  /* 【batch129】剧情模式里**绝不**弹通用的「游戏结束」面板：统一转到剧情结局
     （剧情演完后才由 storyFinish() 给出专门的阵亡提示）。 */
  if(typeof STORY_!=='undefined'&&STORY_.on){if(!STORY_.cut)storyEnd('lose');return;}
  S.over=true;S.playing=false;try{document.exitPointerLock();}catch(e){}document.getElementById('hud').style.display='none';document.getElementById('wave-shop').style.display='none';for(var i=0;i<enemies.length;i++){if(enemies[i].aimLine){scene.remove(enemies[i].aimLine);enemies[i].aimLine.geometry.dispose();enemies[i].aimLine.material.dispose();}}var go=document.getElementById('go');go.style.display='flex';document.getElementById('fs').textContent='得分: '+S.score;document.getElementById('fw').textContent='到达第 '+S.wave+' 波';document.getElementById('fk').textContent='击杀: '+S.kills;document.getElementById('fg').textContent='总获得金币: '+totalGoldEarned;}
var fpsFrames=0,fpsLast=performance.now();
function updateFPS(){fpsFrames++;var now=performance.now();if(now-fpsLast>=500){document.getElementById('fps').textContent='FPS: '+(fpsFrames*1000/(now-fpsLast)|0);fpsFrames=0;fpsLast=now;}}
function loop(){requestAnimationFrame(loop);
/* 【batch203】安全网：开镜光学（POST.镜）只应在"正在开镜"的时候开着。
   updatePlayer 在暂停 / 阵亡 / 结算时**整段 return**，那时候没人去刷新它 ——
   没有这一句，按 Esc 暂停后镜头还会带着一圈色散/压暗（看起来像画面坏了）。
   注：纪念枪的镜筒是枪上的真几何，不需要"收起"；这里只关屏幕空间的光学层。 */
try{
  if(!S.playing||S.over||S.paused||SK.ghost>0){
    if(typeof POST!=='undefined'&&POST&&typeof POST.设镜==='function'&&POST.镜>0.002)POST.设镜(0,0.693);
    try{ if(document.body&&document.body.classList){
      if(document.body.classList.contains('scope-on'))document.body.classList.remove('scope-on');
      if(document.body.classList.contains('mem-scope'))document.body.classList.remove('mem-scope');
    } }catch(_eC){}
  }
}catch(_eS){}
if(typeof PERF!=='undefined'&&PERF&&PERF.tick)PERF.tick();   /* 【batch196】PERF 现在只统计帧率，不再自动降分辨率（帧率本身上限＝显示器刷新率，代码里没有锁帧） */if(typeof rangeTargetTick==='function')rangeTargetTick(0.016);   /* 【batch180】靶子：命中判定 + 闪白恢复 *//* 【batch184f-补4】火车站：单人本地跑状态机(trainTick)；多人由服务端权威驱动(trainSyncSrv 只渲染) */
if(typeof trainTick==='function'){ if(typeof netIsMulti==='function'&&netIsMulti()){ if(typeof trainSyncSrv==='function')trainSyncSrv(0.016); } else { trainTick(0.016); } }if(typeof lockHintSync==='function')lockHintSync();if(typeof LIGHT!=='undefined'&&LIGHT&&typeof LIGHT.tick==='function'){var _ltN=performance.now();var _ldt=window._lightLastT?Math.min((_ltN-window._lightLastT)/1000,0.2):0.016;window._lightLastT=_ltN;LIGHT.tick(_ldt);}if(typeof eclipseSkyTick==='function')eclipseSkyTick();   /* 【batch190】蚀日：按方位跟随相机（等效无穷远天体，无透视位移） */   /* 【batch189】光影/阴影：跟随玩家 + 换图换色 + 帧率自适应（暂停时也跑，菜单背景才有影子） */if(!S.playing||S.over||(S.paused&&!netIsMulti())){(typeof POST!=='undefined'&&POST&&POST.渲染)?POST.渲染():renderer.render(scene,camera);return;}
  /* 【模组钩子 · batch166】玩法模式每帧推进：dt 是本帧秒数（缩圈、回合计时、积分等都靠它）。 */
  var _mn=performance.now();var _mdt=_modeLastT?Math.min((_mn-_modeLastT)/1000,0.12):0.016;_modeLastT=_mn;
  var _mm=curMode();if(_mm&&typeof _mm.tick==='function'){try{_mm.tick(_mdt);}catch(e){}}
  if(window.ModLoader&&ModLoader._physTicks&&ModLoader._physTicks.length){for(var _pi=0;_pi<ModLoader._physTicks.length;_pi++){try{ModLoader._physTicks[_pi](_mdt);}catch(e){}}}
  /* updateWave() 平时只在刷波 / 杀怪时才会被调用，倒计时不会走字 ——
     所以玩法模式只要给了 hud()，这里就每帧帮它刷新一次 HUD。 */
  if(_mm&&typeof _mm.hud==='function'){try{updateWave();}catch(e){}}
  updatePlayer();updateHero();updateEnemies();storyTick();cheatForceOff();netTick();netVisualTick();updateSmokeScreen();updateBullets();updateEnemyBullets();/* 【batch196】弹丸位置同步进 InstancedMesh：必须在 updateBullets / updateEnemyBullets 之后，位置才是本帧的 */if(typeof 同步弹丸==='function')同步弹丸();updateParticles();updatePickups();updateMinimap();if(mouseDown&&currentWeapon===WEAPON_GUN&&canAct())attack();(typeof POST!=='undefined'&&POST&&POST.渲染)?POST.渲染():renderer.render(scene,camera);updateFPS();}
