/* ==================== 【batch126/165】剧情模式「营救蚀日者」====================
   【本季走向】本季主线＝**营救蚀日者**：「蚀日者」是未来的人，被佣兵团「暗月」掳进了地下实验室；
     第一章打通救援线（清剿斥候 + 击败闪电），第二章冲进实验室把人抢回来。
   玩家从正规军 4 位特工里挑一位出战 → 清剿暗月斥候 → 闪电亲自拦路。
   **两个结局都通向同一件事：蚀日者被暗月带走** —— 这正是下赛季「救出蚀日者」的引子：
     · 击败闪电 → 力竭晕倒，醒来时人已被带走
     · 输给闪电 → 被扔回总部，人还是被带走
   不管走哪个结局，**走完剧情就永久解锁「闪电」**（用户口径）。
   【batch149 续】下一章就是上面那句引子：第二章「救出蚀日者」钻进暗月的地下实验室，
   在源源不断的小兵和「闪电」的闪现偷袭下，走到收容舱长按 F 20 秒把人抢回来 ——
   **救不出来不算赢**，也永远解锁不了蚀日者。两张地图 / 两套流程都做进游戏了。
   【实现】沿用单人玩法内核（enterGame / setMap / createEnemy / AI），
   只加一层阶段机；演出期间用 STORY.cut 冻住输入，但保持 S.playing=true
   （否则主循环会停，字幕就不走了）。 */
var STORY_MAP='eclipse';                 // 剧情用「日蚀环城」——主题最贴，街道也够开阔
var STORY_NEED=24;                       // 清剿目标：暗月斥候（【batch157】10→24：原数量毫无压迫感，直接就通关了）
var STORY_={
  /* 【batch149】ch＝当前章节（1「打通救援线」/ 2「救出蚀日者」）；
     第二章用自己的几个计时器：rescueP＝营救进度(秒)、amb/ambT＝闪电偷袭、mobT＝刷兵节拍。 */
  ch:1,rescueP:0,rescueNear:false,amb:null,ambT:0,mobT:0,started:0,
  on:false,phase:'',sel:0,killed:0,spawned:0,spawnT:0,
  /* 【注意】need 必须在这里就写好：漏了它 → STORY_.spawned>=STORY_.need 永远是 false
     → 清完小怪闪电永不登场（探针 t_story.js 抓到的真 bug）。 */
  need:STORY_NEED,
  boss:null,res:'',cut:false,_lt:0,_qt:0
};
var _storyQueue=[],_storyDur=3;
function storyEl(id){return document.getElementById(id);}
function storyShowPick(on){var p=storyEl('storyPick');if(p){if(on)p.classList.add('on');else p.classList.remove('on');}}
function storyShowDone(on){var p=storyEl('storyDone');if(p){if(on)p.classList.add('on');else p.classList.remove('on');}}
function storyCutShow(on){var c=storyEl('storyCut');if(c)c.style.display=on?'flex':'none';}
function storyCutOn(){var c=storyEl('storyCut');return !!(c&&c.style.display!=='none');}
function storyHudShow(on){var h=storyEl('storyHud');if(h)h.style.display=on?'block':'none';}
function bossShow(on){var w=storyEl('bossWrap');if(w)w.style.display=on?'block':'none';}
function storyGoalText(){
  /* 【模组钩子 · batch166】自定义章节可以自己决定 HUD 上显示什么目标。 */
  var _sc=storyCur();if(_sc&&typeof _sc.goal==='function'){try{var _sg=_sc.goal();if(_sg)return _sg;}catch(e){}}
  /* 【batch149】第二章的目标只有一个：把蚀日者救出来（HUD 直接显示剩余秒数）。 */
  if(STORY_.ch===2){
    if(STORY_.phase==='rescue')return '剧情Ⅱ · 营救「蚀日者」 '+Math.floor(STORY_.rescueP)+'/'+RESCUE_NEED+' 秒';
    if(STORY_.phase==='end'||STORY_.phase==='done')return '剧情Ⅱ · 尾声';
    return '剧情Ⅱ · 救出蚀日者';
  }
  if(STORY_.ch===3){                                            // 【batch181】第三章：焘芯守卫战
    if(STORY_.phase==='hunt')return '剧情Ⅲ · 清剿暗月残部 '+STORY_.killed+'/'+STORY_.need;
    if(STORY_.phase==='boss'||STORY_.phase==='duel')return '剧情Ⅲ · 击败「灰枭」';
    if(STORY_.phase==='end'||STORY_.phase==='done')return '剧情Ⅲ · 尾声';
    return '剧情Ⅲ · 守住火车站';
  }
  if(STORY_.phase==='hunt')return '剧情 · 清剿暗月斥候 '+STORY_.killed+'/'+STORY_.need;
  if(STORY_.phase==='boss'||STORY_.phase==='duel')return '剧情 · 击败「闪电」';
  if(STORY_.phase==='end'||STORY_.phase==='done')return '剧情 · 尾声';
  return '剧情模式';
}
function storyGoalRefresh(){var t=storyEl('storyHudTxt');if(!t)return;var v=storyGoalText();if(t.textContent!==v)t.textContent=v;}
function storyRefreshBtn(){
  var b=storyEl('storyBtn');if(!b)return;
  var tag=storyEl('storyTag');
  /* 【batch149】两章各有各的解锁奖励，标签按「还剩哪章没打」来说。
     【batch181】第三章（日陨之地）没有解锁奖励，只在全通关时改一句文案。 */
  if(UNLOCK.lightning&&UNLOCK.eclipse&&UNLOCK.station){if(tag)tag.textContent='✅ 三章都通关 · 「闪电」「蚀日者」均已解锁 · SP 的由来已揭晓';b.classList.add('storyDone');}
  else if(UNLOCK.lightning&&UNLOCK.eclipse){if(tag)tag.textContent='✅ 两章都通关 · 「闪电」「蚀日者」均已解锁';b.classList.remove('storyDone');}
  else if(UNLOCK.eclipse){if(tag)tag.textContent='第二章已通关 · 第一章击败闪电可解锁「闪电」';b.classList.remove('storyDone');}
  else if(UNLOCK.lightning){if(tag)tag.textContent='第一章已通关 · 第二章救人可解锁「蚀日者」';b.classList.remove('storyDone');}
  else{if(tag)tag.textContent='第一章击败闪电 / 第二章救出蚀日者，各解锁一位英雄';b.classList.remove('storyDone');}
}
/* ---------- 主菜单：进剧情 → 选章节 → 选人面板 ---------- */
var STORY_CHAPS=[
  {n:1,icon:'🏙',name:'第一章 · 打通救援线',map:'日蚀环城',
   desc:'清剿封锁这座城的暗月斥候，正面击败「闪电」，撕开通往地下实验室的救援通道。通关永久解锁闪电。'},
  {n:2,icon:'🧪',name:'第二章 · 救出蚀日者',map:'地下实验室',
   desc:'钻进暗月的地下设施：小兵不断涌来，闪电不时从背后闪现。走到收容舱，长按 F 维持 '+20+' 秒把蚀日者抢回来 —— 救不出来就不算赢。通关永久解锁蚀日者。'},
  /* 【batch181】第三章 · 日陨之地（旧火车站）：暗月余党来抢「焘芯」——总部研究熟练度的设施。
     这一章**不解锁任何英雄**：它交代的是所有人 SP 形态的由来（熟练度满级 → 与焘芯共振 → 第二形态觉醒）。
     火车会不定时从站台上疾驰而过（撞飞玩家 / 碾过小兵），轨道还能被爆炸炸烂让火车脱轨。 */
  {n:3,icon:'🚉',name:'第三章 · 日陨之地',map:'旧火车站',
   desc:'黄昏的废弃火车站 —— 15 年前一颗太阳碎屑落在<b>蚀日环城</b>，蚀日者由此诞生；而她的 SP 形态，就是在这座车站地下的「焘芯基地」里觉醒的。暗月残部倾巢而来要抢焘芯：清掉余党，干掉他们的校尉「灰枭」。小心轨道上疾驰的列车。通关无解锁奖励 —— 这一章交代的是<b>所有人 SP 形态的由来</b>。'}
];
/* 【模组钩子 · batch166】自定义剧情章节登记表：{ 章节号n : 章节定义 }
   模组用 ModLoader.addStory(章节对象) 往这里塞一条，就能新增一章，
   并且可以改这一章的：地图、出生点、清剿目标数、开场/结局台词、目标文案、
   推进逻辑（tick）、通关奖励。不填的字段就沿用原版第一章那套流程。
   游戏侧在 storyGoalText / storyStart / storyTick / storyEnd / storyFinish 各处
   都会优先问这里（见 storyCur）。原版两章（n=1/2）完全不受影响。 */
var STORY_CUSTOM={};
function storyCur(){try{return STORY_CUSTOM[STORY_.ch]||null;}catch(e){return null;}}
function storyShowChap(on){var p=storyEl('storyChapter');if(p){if(on)p.classList.add('on');else p.classList.remove('on');}}
function storyBuildChap(){
  var g=storyEl('storyChapGrid');if(!g)return;
  if(!STORY_.ch)STORY_.ch=1;
  var h='';
  for(var i=0;i<STORY_CHAPS.length;i++){
    var c=STORY_CHAPS[i],done=(c.n===1?UNLOCK.lightning:(c.n===2?UNLOCK.eclipse:(c.n===3?UNLOCK.station:false)));
    if(c.n!==1&&c.n!==2&&c.n!==3&&typeof c.done==='function'){try{done=!!c.done();}catch(e){}}   /* 【batch166】自定义章节自己判断"通关没" */
    h+='<div class="stChapItem" data-c="'+c.n+'"'+(c.n===STORY_.ch?' data-on="1"':'')+'>'
      +'<div class="stIcon">'+c.icon+'</div><div class="stName">'+c.name+'</div>'
      +'<div class="stTag">地图：'+c.map+(done?' · ✅ 已通关':' · 未通关')+'</div>'
      +'<div class="stDesc">'+c.desc+'</div></div>';
  }
  g.innerHTML=h;
  var cs=g.querySelectorAll('.stChapItem');
  for(var k=0;k<cs.length;k++)cs[k].addEventListener('click',function(){
    STORY_.ch=parseInt(this.getAttribute('data-c'),10)||1;storyBuildChap();
  });
}
function storyOpen(){
  if(S.playing&&!S.over){showMsg('先打完这一局、或退出对局后再进剧情','#ffd166');return;}
  if(!STORY_.ch)STORY_.ch=1;
  storyBuildChap();storyShowChap(true);
}
function storyGoPick(){
  storyShowChap(false);
  STORY_.sel=(SK.idx<4)?SK.idx:0;
  storyBuildPick();storyShowPick(true);
}
function storyBuildPick(){
  var g=storyEl('storyPickGrid');if(!g)return;
  /* 【batch149】选人面板的标题跟着章节走，免得第二章还写着第一章的名字。 */
  var _t=storyEl('storyPickTitle'), _tp=storyEl('storyPickTip');
  if(_t)_t.textContent=(STORY_.ch===2)?'🧪 第二章 · 救出蚀日者':(STORY_.ch===3)?'🚉 第三章 · 日陨之地':'🎬 第一章 · 打通救援线';
  if(_tp)_tp.textContent=(STORY_.ch===2)
    ?'暗月在地下 40 米建了一座实验设施 —— 蚀日者就被关在最深处。小兵会源源不断地涌来，而「闪电」随时可能出现在你背后。找到收容舱，长按 F 维持 20 秒把人救出来。从下面四位特工里挑一位下去。'
    :(STORY_.ch===3)
    ?'旧火车站 —— 15 年前「日陨」落在蚀日环城，蚀日者由此诞生；这座车站地下是总部研究英雄战斗中沉淀出的熟练度的「焘芯基地」，她的 SP 形态就是在这里觉醒的。暗月残部倾巢而来要抢焘芯：清掉余党，干掉校尉「灰枭」。站台上会有列车不定时疾驰而过，被撞上就是重创；轨道还能被爆炸炸烂，让下一班车脱轨。从下面四位特工里挑一位守站。'
    :'你是正规军「未来」的一员。半个月前，太阳之下诞生了能吸收阳光的「蚀日者」；佣兵团「暗月」派出的斥候已经先一步封锁了这座城，而「闪电」正亲自赶来抢人。先清掉斥候，再面对她。从下面四位特工里挑一位出战。';
  var h='';
  for(var i=0;i<4;i++){                        // 只有正规军「未来」的四位能出战
    var H=HEROES[i];
    h+='<div class="stCardItem" data-s="'+i+'" style="--c:'+H.css+'"'+(i===STORY_.sel?' data-on="1"':'')+'>'
      +'<div class="stIcon">'+H.icon+'</div><div class="stName">'+H.name+'</div>'
      +'<div class="stTag">'+H.tag+'</div>'
      +'<div class="stSk">'+H.skills.map(function(s){return s.icon;}).join(' ')+'</div></div>';
  }
  g.innerHTML=h;
  var cs=g.querySelectorAll('.stCardItem');
  for(var c=0;c<cs.length;c++)cs[c].addEventListener('click',function(){
    STORY_.sel=parseInt(this.getAttribute('data-s'),10)||0;storyBuildPick();
  });
}
/* ---------- 字幕（开场 / 结局共用）---------- */
function storySay(lines,dur){
  _storyQueue=(lines||[]).slice();_storyDur=dur||3;
  storyNextLine();
}
function storyNextLine(){
  var el=storyEl('storyCutTxt');
  if(!_storyQueue.length){storyCutShow(false);return;}
  var line=_storyQueue.shift();
  if(el){
    try{el.textContent=line;el.classList.remove('in');void el.offsetWidth;el.classList.add('in');}catch(e){}
  }
  storyCutShow(true);STORY_._qt=_storyDur;
}
/* 【batch129】点一下字幕＝**立刻跳下一段**。
   原来这里只写 `STORY_._qt=0`，而 storyTick 的推进条件是 `if(_qt>0){…减到 <=0 才调 storyNextLine()}` ——
   清零之后条件不再成立，于是「点了也没反应」，剧情就卡在第一段（用户报的就是这个）。 */
function storySkip(){
  if(!STORY_.on)return;
  if(_storyQueue.length){STORY_._qt=0;storyNextLine();}
}
/* ---------- 开始：进场 + 开场演出 ---------- */
function storyStart(){
  /* 【batch128】兜底：上一次剧情没走干净（中途阵亡 → 冒出「游戏结束」面板、或 S.over 残留）
     会让"退出重进"看起来像卡住。进来先把这些一律收掉，保证每局都是从零开始。 */
  if(STORY_.on)storyAbort();
  storyShowPick(false);storyShowDone(false);storyCutShow(false);storyShowChap(false);
  rescueShow(false);storyAmbushClear();
  var _rb0=document.getElementById('btnRescue');if(_rb0)_rb0.style.display='none';   /* 【batch159】开局收掉手机救援按钮 */
  STORY_.started=0;
  ['go','wave-shop','netDeath'].forEach(function(id){var el=storyEl(id);if(el)el.style.display='none';});
  S.over=false;S.paused=false;
  SK.idx=STORY_.sel|0;SK.cds=[0,0,0];heroSave();buildHeroGrid();heroHudUpdate(true);
  try{if(typeof NET!=='undefined'&&NET&&NET.connected&&typeof netSend==='function')netSend({t:'hero',h:SK.idx});}catch(e){}   // 【模组英雄·多人】把换英雄广播给同房玩家
  /* 清掉上一局留下的状态（倒地 / 减益 / 场上残留的技能物） */
  SK.downed=0;SK.slow=0;SK.overload=0;SK.vuln=0;SK.blind=0;SK.blindDur=0;SK.revealAll=0;SK.zap=0;
  SK.shadowT=0;SK.shadowObj=null;SK.shadows.length=0;   // 【batch158】暗影状态/毒圈一并清
  for(var _pg=0;_pg<SK.portals.length;_pg++)portalKillPair(SK.portals[_pg]);   // 【batch145】门要连网格一起清
  if(SK.ghost>0)heroGhostFx(false);
  SK.ghost=0;SK.ghostFrom=null;SK.ghostSi=-1;
  SK.eclipses=[];SK.orbs=[];SK.traps=[];SK.balls=[];SK.portals=[];SK.ballLeft=0;
  /* 【batch181】白夜状态连黑日网格一起收（别让上一局的天象漏到下一局） */
  if(SK.spVeilObj&&SK.spVeilObj.parent)SK.spVeilObj.parent.remove(SK.spVeilObj);SK.spVeil=0;SK.spVeilPulse=0;SK.spVeilObj=null;
  SK.suneyeT=0;SK.suneyeObj=null;SK.inEclipse=false;SK.hold=null;
  SK.shadowT=0;SK.shadowObj=null;SK.shadows.length=0;   // 【batch158】上一局残留的暗影状态/毒圈一并清掉
  STORY_.on=true;STORY_.phase='intro';STORY_.cut=true;
  STORY_.killed=0;STORY_.spawned=0;STORY_.spawnT=0;STORY_.boss=null;STORY_.res='';
  storyBossClearFX();STORY_.bossCd={orb:5,dash:8,ball:14};   // 【batch129】上一局残留的电球/大球一并清掉
  STORY_.diedByMob=false;STORY_.downT=0;
  NET.enabled=false;NET.server='';NET.dead=false;
  S.wave=1;S.left=999;S.score=0;S.kills=0;S.hp=S.maxHp;S.over=false;S.paused=false;
  enterGame();
  /* 【模组钩子 · batch166】自定义章节：可指定地图 / 固定出生点 / 清剿目标数 / 开场初始化 / 开场台词。
     自定义章节在这里就完成初始化并直接 return，不走下面原版第一 / 二章的分支（原版两章不受影响）。 */
  var _cs=storyCur();
  if(_cs){
    if(typeof _cs.need==='number')STORY_.need=_cs.need;
    if(_cs.mapId)setMap(_cs.mapId); else setMap(STORY_MAP);
    if(_cs.spawn)camera.position.set(_cs.spawn[0],GROUND_Y,_cs.spawn[1]); else playerSpawnAt();
    S.velY=0;S.onGround=true;S.onLadder=false;S.mantle=0;S.landKick=0;
    if(typeof _cs.init==='function'){try{_cs.init();}catch(e){}}   /* begin 留给"开场白演完"之后，init 是刚进图时 */
    updateHp();updateWave();updateScore();
    try{if(document.exitPointerLock)document.exitPointerLock();}catch(e){}
    storyHudShow(true);bossShow(false);storyGoalRefresh();
    STORY_._lt=performance.now();
    var _ln=(Array.isArray(_cs.lines)&&_cs.lines.length)?_cs.lines:['—— 自定义章节 ——','（模组作者别忘了给这一章写开场台词）'];
    storySay(_ln,3.4);
    return;
  }
  if(STORY_.ch===2){
    /* 【batch149】第二章：地图换成「地下实验室」，出生点用**固定的** LAB_STORY_SPAWN ——
       它与收容舱相距约 146 米，且不在正常对局的出生点表里（用户要求：剧情固定、平时另算）。 */
    setMap('lab');
    camera.position.set(LAB_STORY_SPAWN.x,GROUND_Y,LAB_STORY_SPAWN.z);
    S.velY=0;S.onGround=true;S.onLadder=false;S.mantle=0;S.landKick=0;
    STORY_.rescueP=0;STORY_.rescueNear=false;STORY_.amb=null;STORY_.ambT=AMB_FIRST;STORY_.mobT=1.0;
    if(typeof LAB_MARK!=='undefined'&&LAB_MARK)LAB_MARK.visible=true;
  }else if(STORY_.ch===3){
    /* 【batch181】第三章：旧火车站（站前广场固定出生点，面朝大厅与轨道带）。
       火车由地图系统自己跑（trainTick），这一章照样会有班车不时进站。 */
    setMap('station');
    camera.position.set(STATION_STORY_SPAWN.x,GROUND_Y,STATION_STORY_SPAWN.z);
    S.velY=0;S.onGround=true;S.onLadder=false;S.mantle=0;S.landKick=0;
  }else{
    setMap(STORY_MAP);playerSpawnAt();
  }
  updateHp();updateWave();updateScore();
  try{if(document.exitPointerLock)document.exitPointerLock();}catch(e){}
  storyHudShow(true);bossShow(false);storyGoalRefresh();
  STORY_._lt=performance.now();
  if(STORY_.ch===2){
    storySay(['正规军「未来」· 营救小组',
              '地下 40 米，暗月编号「实验室」的设施 —— 蚀日者就被关在最深处。',
              '守备队填满了每一层走廊；而「闪电」，随时可能出现在你背后。',
              '别恋战。找到收容舱，长按 F 维持 20 秒，把人带出来。',
              '记住 —— 救不出他，这一趟就等于白来。'],3.4);
  }else if(STORY_.ch===3){
    /* 【batch181】第三章开场：交代焘芯 / 熟练度 / SP 的由来（这一章的主题） */
    storySay(['「未来」总部 · 绝密通报',
              '暗月残部在旧火车站集结 —— 15 年前，一颗太阳碎屑落在蚀日环城，蚀日者由此诞生。',
              '而她的 SP 形态，就是在这座车站地下的「焘芯基地」里觉醒的 —— 那里研究英雄们在极限战斗里沉淀出的熟练度。',
              '规律已经明确：熟练度推到极限的人，会与焘芯共振，觉醒第二形态 —— 未来管它叫「SP」。',
              '暗月想抢走焘芯，把这份力量倒过来用。守住火车站，干掉他们的校尉「灰枭」。',
              '还有 —— 站台上的列车不定时进站。被撞上，就是重创。'],3.6);
  }else{
    storySay(['正规军「未来」· 救援小队',
              '半个月前，太阳之下诞生了一个能吸收阳光的人 ——「蚀日者」。他是我们的人。',
              '暗月把他掳进了地下实验室，准备拿他做非人道实验 —— 本季任务只有一条：把人救回来。',
              '暗月派出的斥候已经先一步封锁了这座城 —— 清掉他们，撕开救援通道。'],3.4);
  }
}
/* ==================== 【batch129】剧情 boss「闪电」的技能 & 警戒 ====================
   用户要求：① 她会**放技能**（不能只会开枪）；② 射速跟玩家差不多快；③ 警戒范围只有 10 米。
   【为什么写在剧情侧】AI 主循环（updateEnemies）是个超长函数，动它风险最大；
   而这里的都是"只在这种 boss 战里生效"的逻辑，放 storyTick 里每帧推进最安全。
   三个技能（都用玩家已有的特效函数，不新增美术资源）：
     ⚡ 电荷光球 —— 朝你脚下抛一团电，落地炸出 2 米电区 5 秒，进去吃 25 点 + 三重减益
     ⚡ 雷光突进 —— 朝你瞬闪 9 米，直接贴脸
     ⚡ 球形闪电 —— 正对你直射一枚大球，命中吃 55 点（很痛但不秒杀，血不够才会倒下） */
var BOSS_ALERT_R=10;                 // 警戒半径（米）：进来才全速逼近 + 开火
var BOSS_ORB_CD=8, BOSS_DASH_CD=11, BOSS_BALL_CD=20;
var BOSS_ORB_R=2.0, BOSS_ORB_LIFE=5, BOSS_ORB_DMG=25, BOSS_ORB_DEBUFF=6;
var BOSS_BALL_SPD=26, BOSS_BALL_DMG=55, BOSS_BALL_HIT_R=1.2;

function storyBossClearFX(){
  ['orbFly','ballFly'].forEach(function(k){
    var f=STORY_[k];if(f&&f.m&&f.m.parent)f.m.parent.remove(f.m);STORY_[k]=null;
  });
  STORY_.orb=null;
}
function storyBossAI(dt){
  var b=STORY_.boss;if(!b||b.hp<=0)return;
  if(b.spd0===undefined){b.spd0=b.spd;b.canShoot0=b.canShoot;}
  var rp=heroEntWorld(b);
  var dx=camera.position.x-rp.x,dz=camera.position.z-rp.z;
  var dist=Math.sqrt(dx*dx+dz*dz);
  /* —— 警戒：10 米内全速 + 开火；10 米外只慢慢摸过来、不开枪（不像小兵那样老远锁人）—— */
  var alert=(dist<=BOSS_ALERT_R);
  b.canShoot=alert;
  b.spd=alert?b.spd0:b.spd0*0.45;
  b.alertNow=alert;
  if(!STORY_.bossCd)STORY_.bossCd={orb:4,dash:7,ball:13};
  var cd=STORY_.bossCd;
  for(var k in cd)cd[k]-=dt;
  if(cd.orb<=0&&dist>3.5&&dist<34){cd.orb=BOSS_ORB_CD;storyBossThrowOrb();}
  if(cd.dash<=0&&dist>BOSS_ALERT_R+4){cd.dash=BOSS_DASH_CD;storyBossDash();}
  if(cd.ball<=0&&alert&&dist<28){cd.ball=BOSS_BALL_CD;storyBossShootBall();}
  storyBossOrbStep(dt);
  storyBossBallStep(dt);
}
/* ---- ① 电荷光球：抛物线飞到"你此刻站的地方"（不预判 → 跑开就能躲） ---- */
function storyBossThrowOrb(){
  var b=STORY_.boss,rp=heroEntWorld(b);
  var sx=rp.x,sy=rp.y+1.9,sz=rp.z;
  var m=heroMeshOrb();scene.add(m);m.position.set(sx,sy,sz);
  STORY_.orbFly={m:m,sx:sx,sy:sy,sz:sz,tx:camera.position.x,tz:camera.position.z,t:0,dur:0.72};
  heroFxRingAt(sx,sz,0x6ff0ff,0.35,1.4,0.4);
  showMsg('⚡ 闪电扔出一团电球 —— 快离开落点！','#6ff0ff');
}
function storyBossOrbStep(dt){
  var f=STORY_.orbFly;if(!f)return;
  f.t+=dt;var p=Math.min(1,f.t/f.dur);
  var x=f.sx+(f.tx-f.sx)*p, z=f.sz+(f.tz-f.sz)*p;
  var y=f.sy+(0.35-f.sy)*p+Math.sin(p*Math.PI)*3.4;         // 抛物线（自己算，不依赖投掷物内核）
  if(f.m)f.m.position.set(x,y,z);
  if(p>=1){
    if(f.m&&f.m.parent)f.m.parent.remove(f.m);
    STORY_.orbFly=null;
    STORY_.orb={x:f.tx,z:f.tz,hit:false,life:BOSS_ORB_LIFE,pulse:0};
    heroFXZapAt(f.tx,0.8,f.tz);heroFxRingAt(f.tx,f.tz,0x6ff0ff,1.9,0.6,2.2);
    showMsg('⚡ 电区！别踩进去','#6ff0ff');
  }
}
function storyBossOrbTick(dt){
  var O=STORY_.orb;if(!O)return;
  O.life-=dt;
  if(O.life<=0){STORY_.orb=null;return;}
  O.pulse-=dt;
  if(O.pulse<=0){O.pulse=0.45;heroFxRingAt(O.x,O.z,0x6ff0ff,1.7,0.45,0.35);}
  if(O.hit)return;
  var dx=camera.position.x-O.x,dz=camera.position.z-O.z;
  if(dx*dx+dz*dz<=BOSS_ORB_R*BOSS_ORB_R&&S.hp>0){
    O.hit=true;                                   // 一个电区只结算一次（和玩家技能同口径）
    heroFXZapAt(camera.position.x,0.8,camera.position.z);
    SK.zap=0.7;SK.overload=BOSS_ORB_DEBUFF;SK.vuln=BOSS_ORB_DEBUFF;SK.slow=0.6;
    showMsg('⚡ 被电到了：麻痹 / 过载 / 易伤','#6ff0ff');
    takeDmg(BOSS_ORB_DMG);                        // 走统一结算（减伤 / 剧情结局都生效）
  }
}
/* ---- ② 雷光突进：朝你瞬闪 9 米（带残影） ---- */
function storyBossDash(){
  var b=STORY_.boss,rp=heroEntWorld(b);
  var dx=camera.position.x-rp.x,dz=camera.position.z-rp.z,d=Math.sqrt(dx*dx+dz*dz)||1;
  var ux=dx/d,uz=dz/d,nx=rp.x,nz=rp.z;
  for(var s=9;s>=2;s-=1){                          // 撞墙就退回能站的位置
    var tx=rp.x+ux*s,tz=rp.z+uz*s;
    if(!isColliding(tx,tz,b.sz)){nx=tx;nz=tz;break;}
  }
  heroFXZapAt(rp.x,rp.y+1,rp.z);
  b.root.position.x=nx;b.root.position.z=nz;
  heroFXZapAt(nx,b.root.position.y+1,nz);
  heroFxRingAt(nx,nz,0x6ff0ff,0.9,0.5,1.6);
  if(STORY_.bossCd)STORY_.bossCd.orb=Math.min(STORY_.bossCd.orb,2.5);   // 突进到位后紧跟一发
  showMsg('⚡ 闪电瞬闪到你身边！','#6ff0ff');
}
/* ---- ③ 球形闪电：正对你直射（命中 55 点） ---- */
function storyBossShootBall(){
  var b=STORY_.boss,rp=heroEntWorld(b);
  var dx=camera.position.x-rp.x,dz=camera.position.z-rp.z,d=Math.sqrt(dx*dx+dz*dz)||1;
  var m=heroMeshBall();scene.add(m);
  /* 【batch133】用户："闪电的大招太挡视野了"。
     糊屏的真凶不是大小，是那颗 **opacity:1 的白色实心核** —— 球飞到眼前时整块白挡住准星。
     所以除了缩小，还把整颗球调成半透明：看得见、躲得开，但不再糊住视野。
     （用户要求再小一点：0.42 → 0.30 缩放；所有子网格 opacity ×0.48）
     【batch134】用户："球状闪电太遮挡屏幕了" → 再收一档：0.30 → 0.26 缩放、opacity ×0.48 → ×0.40，
     并加"近身淡出"（ballFadeNearCam：正朝你飞来时越近越小越透）。 */
  try{
    m.scale.setScalar(0.26);
    m.traverse(function(o){
      if(o&&o.material){
        o.material.transparent=true;
        o.material.opacity=(typeof o.material.opacity==='number'?o.material.opacity:1)*0.40;
        o.material.depthWrite=false;
      }
    });
  }catch(e){}
  var sx=rp.x+dx/d*0.9, sy=rp.y+1.9, sz=rp.z+dz/d*0.9;
  m.position.set(sx,sy,sz);
  STORY_.ballFly={m:m,x:sx,y:sy,z:sz,vx:dx/d*BOSS_BALL_SPD,vy:0,vz:dz/d*BOSS_BALL_SPD,life:2.4};
  showMsg('⚡ 球形闪电！躲开！','#ff9f43');
}
function storyBossBallStep(dt){
  var B=STORY_.ballFly;if(!B)return;
  B.life-=dt;
  var travel=BOSS_BALL_SPD*dt;
  var steps=Math.max(1,Math.min(12,Math.ceil(travel/0.4)));   // 小步推进：别一帧穿过玩家
  var gone=false;
  for(var i=0;i<steps;i++){
    B.x+=B.vx*dt/steps;B.y+=B.vy*dt/steps;B.z+=B.vz*dt/steps;
    var dx=camera.position.x-B.x,dz=camera.position.z-B.z;
    if(dx*dx+dz*dz<=BOSS_BALL_HIT_R*BOSS_BALL_HIT_R&&Math.abs(camera.position.y-B.y)<1.5){
      if(B.m&&B.m.parent)B.m.parent.remove(B.m);
      heroFXZapAt(B.x,B.y,B.z);heroFxRingAt(B.x,B.z,0x6ff0ff,1.0,0.5,1.8);
      SK.zap=0.8;SK.overload=8;SK.vuln=8;SK.slow=0.6;
      takeDmg(BOSS_BALL_DMG);
      /* 【batch130】用户："被闪电大招打中了，不是说了不能移动吗" ——
         球形闪电命中就该**倒地**：一步都走不了、开不了枪（和玩家的球形闪电同一个口径）。 */
      if(S.hp>0){
        SK.downed=DB_DOWN;SK._dbT=0;
        STORY_.downT=0;
        showMsg('⚡ 被球形闪电击倒 —— 没人能来扶你','#ff6b6b');
      }
      STORY_.ballFly=null;return;
    }
    if(isColliding(B.x,B.z,0.2,B.y)){
      if(B.m&&B.m.parent)B.m.parent.remove(B.m);
      heroFXZapAt(B.x,B.y,B.z);
      STORY_.ballFly=null;return;
    }
  }
  if(B.life<=0){
    if(B.m&&B.m.parent)B.m.parent.remove(B.m);
    STORY_.ballFly=null;return;
  }
  if(B.m)B.m.position.set(B.x,B.y,B.z);
  ballFadeNearCam(B.m);                                // 【batch134】它正朝你飞来 —— 越近越小越透
  if(Math.random()<0.12)heroFXZapAt(B.x,B.y,B.z);      // 【batch130】0.4 → 0.12：别糊住玩家视野
}
/* ---------- 阶段机（主循环每帧调）---------- */
function storyMobCount(){
  var n=0;
  for(var i=0;i<enemies.length;i++){var e=enemies[i];if(e.isNet)continue;if(e===STORY_.boss)continue;if(e.hp>0)n++;}
  return n;
}
/* ============================================================================
   【batch134】剧情刷兵点：必须在「图内 + 不卡障碍 + 踩基础地面」上。
   为什么改：原来是在玩家周围 19~34 米的圆上**纯随机取点**，完全不看地图 ——
   玩家贴着围墙打的时候，取到的点落到墙外 / 楼外，小兵就站在墙那边隔墙打你
   （用户报的"小兵会出现在墙外"）。
   筛选顺序：① 玩家周围 19~34 米随机圈；② 不成再逐圈往玩家身边收（17→3 米）；
   ③ 还不行退回本图出生点表里离玩家最近的那个点（那些点已验证安全）。
   边界口径与玩家移动一致（±worldLimit 的方盒）；日蚀环城再叠一层椭圆 a=104/b=88 ——
   围墙就在椭圆上，而方盒比椭圆大，只判盒子会漏到墙外去。
   ============================================================================ */
function storySpotOk(x,z){
  var m=mapNow(), lim=worldLimit();
  if(Math.abs(x)>=lim-2||Math.abs(z)>=lim-2)return false;           // 和移动判定同一口径
  if(m&&m.id==='eclipse'){                                          // 【batch133】椭圆长轴 104 / 短轴 88
    var EA=104,EB=88,margin=0.94;
    if((x*x)/(EA*EA)+(z*z)/(EB*EB)>margin)return false;
  }
  /* 【batch182】旧火车站是**矩形围墙**（南/北墙在 z=±56、东/西墙在 x=±78，只留东西两个隧道口），
     而 limit 取的是 78 —— 只判方盒的话，z 在 57~75 的点（墙外荒地）会全部通过，
     小兵就刷到墙外面去，玩家隔着墙打不到（用户报的"小兵在地图外面"）。
     按墙的内侧面（z=55 / x=77）再收 2 米：只认墙内。 */
  if(m&&m.id==='station'){
    if(Math.abs(x)>75||Math.abs(z)>53)return false;
  }
  if(playerBlocked(x,z))return false;                               // 不落在方块 / 墙里面
  return Math.abs(groundHeightAt(x,z)-GROUND_Y)<=0.35;              // 只踩基础地面，不站箱顶
}
function storySpawnPoint(){
  var i,a,x,z;
  for(i=0;i<24;i++){                                                // ① 玩家周围 19~34 米
    a=Math.random()*6.28;var d=19+Math.random()*15;
    x=camera.position.x+Math.cos(a)*d;z=camera.position.z+Math.sin(a)*d;
    if(storySpotOk(x,z))return {x:x,z:z};
  }
  for(var r=17;r>=3;r-=2){                                          // ② 往玩家身边一层层收
    for(var j=0;j<12;j++){
      a=j/12*6.28;
      x=camera.position.x+Math.cos(a)*r;z=camera.position.z+Math.sin(a)*r;
      if(storySpotOk(x,z))return {x:x,z:z};
    }
  }
  var tb=MAP_SPAWNS[mapNow().id]||[],best=null,bd=1e9;              // ③ 本图出生点表（已验证过）
  for(var k=0;k<tb.length;k++){
    var px=tb[k][0],pz=tb[k][1];
    var dd=(px-camera.position.x)*(px-camera.position.x)+(pz-camera.position.z)*(pz-camera.position.z);
    if(dd<bd){bd=dd;best={x:px,z:pz};}
  }
  return best||{x:camera.position.x,z:camera.position.z};
}
function storySpawnMob(n){
  n=n|0;if(n<1)n=1;
  for(var i=0;i<n;i++){
    var sp=(STORY_.ch===2)?storyLabSpawnPoint():storySpawnPoint();   // 【batch149】第二章走走廊格点
    var t=(STORY_.spawned>=6&&Math.random()<0.32)?'tank':(Math.random()<0.4?'fast':'basic');   // 【batch157】重甲比例 0.28→0.32
    createEnemy(t,sp.x,sp.z);STORY_.spawned++;
  }
}
function storyBeginHunt(){
  STORY_.phase='hunt';STORY_.spawnT=1.6;STORY_.cut=false;
  storyCutShow(false);storyGoalRefresh();
  showMsg('清剿暗月斥候：'+STORY_.need+' 个','#4fc3ff');
  storySpawnMob(4);                       // 【batch157】开局先压上 4 个（原 3 个）
  lockPointer();
}
/* 【batch128】把剧情小兵（不含 boss）一次性撤掉：闪电登场后就是 1v1，不留杂兵夹击 */
function clearStoryMobs(){
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];if(e.isNet||e===STORY_.boss)continue;
    if(e.aimLine&&e.aimLine.parent)e.aimLine.parent.remove(e.aimLine);
    if(scene&&e.root)scene.remove(e.root);
    enemies.splice(i,1);
  }
}
function storyBeginBoss(){
  STORY_.phase='boss';STORY_.cut=true;STORY_.killed=STORY_.need;   // 记满，免得 HUD 还显示差几个
  clearStoryMobs();
  storyBossClearFX();
  STORY_.bossCd={orb:5,dash:8,ball:14};      // 【batch129】登场后给她一点缓冲，别一露面就糊技能
  var a=Math.random()*6.28,d=17;
  var x=camera.position.x+Math.cos(a)*d,z=camera.position.z+Math.sin(a)*d;
  /* 【batch181】别把 boss 刷进停靠的列车里（会卡在车厢中）—— 换个角度试试；
     【batch182】也别刷到地图围墙外面（第三章是矩形围墙，旧版判定只挡方盒 limit，
     玩家贴墙时 17 米圈能落到墙外荒地 → boss 在墙外打不到）。storySpotOk 顺便保证
     不卡障碍 + 踩基础地面。 */
  var _tb=trainBox();
  for(var _bt=0;_bt<12;_bt++){
    var _out=(!_tb||x<_tb.x0-1||x>_tb.x1+1||z<_tb.z0-1||z>_tb.z1+1);
    if(_out&&storySpotOk(x,z))break;
    a=Math.random()*6.28;x=camera.position.x+Math.cos(a)*d;z=camera.position.z+Math.sin(a)*d;
  }
  /* 【batch181】第三章的 boss 是暗月校尉「灰枭」（ETYPES.darkmajor），用的是同一套 boss AI */
  var _bType=(STORY_.ch===3)?'darkmajor':'lightning';
  STORY_.boss=createEnemy(_bType,x,z);
  var _bn=storyEl('bossName');
  if(_bn)_bn.textContent=(STORY_.ch===3)?'🦅 灰枭 · 暗月残部校尉':'⚡ 闪电 · 暗月佣兵团';
  bossShow(true);bossBarRefresh();storyGoalRefresh();
  if(STORY_.ch===3){
    showMsg('🦅 灰枭 出现了','#c84a4a');
    storySay(['余党清完了 ——',
              '轨道尽头传来汽笛。可来的不是列车，是一个穿旧军大衣的女人。',
              '「灰枭」。暗月残部的校尉，手里转着一枚电球。',
              '「焘芯在哪儿？」她只问了这一句，「交出来，让你们死得痛快点。」'],2.7);
    return;
  }
  showMsg('⚡ 闪电 出现了','#6ff0ff');
  storySay(['斥候清完了 ——',
            '然后一道青白色的光砸在对面的地上。',
            '「闪电」。暗月佣兵团的当家。她只说了一句话：',
            '「把人交出来，然后滚。」'],2.7);
}
function bossBarRefresh(){
  var b=storyEl('bossBar');
  if(!b||!STORY_.boss)return;
  var r=Math.max(0,Math.min(1,STORY_.boss.hp/STORY_.boss.maxHp));
  b.style.width=(r*100).toFixed(1)+'%';
}
/* ==================== 【batch149/165】第二章「救出蚀日者」 ====================
   用户口径：地图是地下实验室；目标只有一个 —— **把蚀日者救出来**（救不出来不算赢）；
   过程中小兵源源不断；闪电偶尔随机闪现到你背后打一下然后消失；
   走到收容舱旁，**长按 F 维持 20 秒**完成营救。
   【设计取舍】
     · 闪电的偷袭**不进 enemies 数组**：她自己一具模型，由 storyAmbushTick 全权驱动。
       这样 updateEnemies 的通用 AI 不会接管她（否则她会一路追着玩家、在 1.25 秒里打出七八发子弹），
       玩家也打不到她 —— 她的设定本来就是"闪现一击就走"。同理，杀掉她也不会触发胜利：
       第二章的胜利条件只有一个（故事也没有别的出口）。
     · 小兵刷点走**走廊格点**（storyLabSpawnPoint）而不是"玩家周围随机圈"：
       实验室全是房间，随机圈几乎必然落进隔间里，AI 一路撞墙根本走不过来。 */
var RESCUE_NEED=20;        // 长按 F 需要维持的秒数
var RESCUE_R=4.2;          // 站在收容舱多近才算"在救"
var MOB_MAX=9;             // 场上同时存在的小兵上限（【batch157】6→9：营救阶段要有多线受敌的压迫感）
var AMB_FIRST=14;          // 闪电第一次偷袭（秒）
var AMB_MIN=16, AMB_MAX=26;
var AMB_LIFE=1.25;         // 她在场上停留多久
var AMB_FIRE_T=0.62;       // 出现后多久开那一枪（留 0.6 秒给人回头）
var AMB_DMG=16;

function rescueShow(on){var w=storyEl('rescueWrap');if(w)w.style.display=on?'block':'none';}
function storyRescueHud(){
  var b=storyEl('rescueBar'),h=storyEl('rescueHint'),t=storyEl('rescueTitle');
  if(b)b.style.width=(Math.max(0,Math.min(1,STORY_.rescueP/RESCUE_NEED))*100).toFixed(1)+'%';
  if(t){var v='🌀 营救「蚀日者」 '+Math.floor(STORY_.rescueP)+' / '+RESCUE_NEED+' 秒';
        if(t.textContent!==v)t.textContent=v;}
  if(h){
    var v2;
    if(STORY_.rescueNear)v2=keys.KeyF?'正在解除收容锁…（松手会缓慢回退）':'按住 F 解除收容锁';
    else v2='跟着橙色光柱走 —— 光柱隔墙也能看见';
    if(h.textContent!==v2)h.textContent=v2;
  }
}
/* ---------- 第二章刷兵点：走廊格点 ---------- */
function storyLabSpawnPoint(){
  var vz=[-66,-44,-22,0,22,44,66], hx=[-52,-26,0,26,52];
  var pts=[],i,j;
  for(i=0;i<LAB_VX.length;i++)for(j=0;j<vz.length;j++)pts.push([LAB_VX[i],vz[j]]);
  for(i=0;i<LAB_HZ.length;i++)for(j=0;j<hx.length;j++)pts.push([hx[j],LAB_HZ[i]]);
  pts.push([-26,-22],[26,-22],[-26,22],[26,22],[0,0]);
  var ok=[];
  for(i=0;i<pts.length;i++){
    var px=pts[i][0],pz=pts[i][1];
    var d=Math.sqrt((px-camera.position.x)*(px-camera.position.x)+(pz-camera.position.z)*(pz-camera.position.z));
    if(d<12||d>46)continue;
    if(isColliding(px,pz,0.9,GROUND_Y))continue;
    ok.push({x:px,z:pz,d:d});
  }
  if(!ok.length)return storySpawnPoint();                       // 兜底：通用选点
  ok.sort(function(a,b){return Math.abs(a.d-24)-Math.abs(b.d-24);});
  var top=ok.slice(0,Math.min(6,ok.length));
  var pick=top[(Math.random()*top.length)|0];
  var jx=pick.x+(Math.random()-0.5)*3.0, jz=pick.z+(Math.random()-0.5)*3.0;
  if(isColliding(jx,jz,0.9,GROUND_Y)){jx=pick.x;jz=pick.z;}
  return {x:jx,z:jz};
}
/* ---------- 闪电：闪现到背后 → 打一枪 → 消失 ---------- */
function storyAmbushClear(){
  var A=STORY_.amb;
  if(A&&A.m&&A.m.parent)A.m.parent.remove(A.m);
  STORY_.amb=null;
}
function storyAmbush(){
  var bx=Math.sin(yaw), bz=Math.cos(yaw);        // 「背后」方向（局内前向 = (-sin,-cos)）
  var ex=null, ez=null;
  for(var i=0;i<14;i++){
    var t=(i===0)?0:((i%2?1:-1)*((i+1)/2)*0.35+(Math.random()-0.5)*0.3);
    var ca=Math.cos(t), sa=Math.sin(t);
    var ux=bx*ca-bz*sa, uz=bx*sa+bz*ca;
    var d=4.2+Math.random()*2.6;
    var px=camera.position.x+ux*d, pz=camera.position.z+uz*d;
    if(Math.abs(px)>LAB_LIM-6||Math.abs(pz)>LAB_LIM-6)continue;
    if(isColliding(px,pz,1.1,GROUND_Y))continue;
    if(groundHeightAt(px,pz,GROUND_Y)-GROUND_Y>0.4)continue;
    ex=px;ez=pz;break;
  }
  if(ex===null)return false;
  var model=_buildEnemyModel('lightning',ETYPES.lightning.sz,ETYPES.lightning.c);
  var root=model.root;
  root.position.set(ex,groundHeightAt(ex,ez,GROUND_Y)-GROUND_Y,ez);
  root.rotation.y=Math.atan2(camera.position.x-ex,camera.position.z-ez);
  if(model.aimLine)model.aimLine.visible=false;       // 别把瞄准线一起带出来
  scene.add(root);
  spawnParticle(new THREE.Vector3(ex,1.2,ez),0x6ff0ff,26,0.7,false);
  STORY_.amb={m:root,t:0,fired:0};
  return true;
}
function storyAmbushTick(dt){
  var A=STORY_.amb;
  if(A&&A.m){
    A.t+=dt;
    var rp=A.m.position;
    A.m.rotation.y=Math.atan2(camera.position.x-rp.x,camera.position.z-rp.z);
    if(A.t>=AMB_FIRE_T&&!A.fired){
      A.fired=1;
      var oy=rp.y+1.5;
      var dx=camera.position.x-rp.x, dy=(camera.position.y-0.3)-oy, dz=camera.position.z-rp.z;
      var L=Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
      var dir=new THREE.Vector3(dx/L,dy/L,dz/L);
      dir.x+=(Math.random()-0.5)*0.06; dir.z+=(Math.random()-0.5)*0.06; dir.normalize();
      spawnEnemyBullet(new THREE.Vector3(rp.x,oy,rp.z),dir,0.95,AMB_DMG,null);
      spawnParticle(new THREE.Vector3(rp.x,oy,rp.z),0x8ff8ff,10,0.3,false);
    }
    if(A.t>=AMB_LIFE){
      spawnParticle(new THREE.Vector3(rp.x,1.3,rp.z),0x8ff8ff,22,0.6,false);
      if(A.m.parent)A.m.parent.remove(A.m);
      STORY_.amb=null;
      STORY_.ambT=AMB_MIN+Math.random()*(AMB_MAX-AMB_MIN);
    }
    return;
  }
  STORY_.amb=null;
  STORY_.ambT-=dt;
  if(STORY_.ambT<=0){
    if(storyAmbush())showMsg('⚡ 闪电出现在你背后！','#6ff0ff');
    else STORY_.ambT=3;
  }
}
/* ---------- 营救主循环 ---------- */
function storyBeginRescue(){
  STORY_.phase='rescue';STORY_.cut=false;STORY_.started=1;
  storyCutShow(false);
  STORY_.rescueP=0;STORY_.rescueNear=false;STORY_.amb=null;STORY_.ambT=AMB_FIRST;STORY_.mobT=1.0;
  if(typeof LAB_MARK!=='undefined'&&LAB_MARK)LAB_MARK.visible=true;
  rescueShow(true);storyRescueHud();storyGoalRefresh();
  lockPointer();
  showMsg('走到橙色光柱处，长按 F 维持 '+RESCUE_NEED+' 秒','#ffa03d');
}
function storyRescueTick(dt){
  if(S.hp<=0){storyEnd('lose');return;}
  if(SK.downed>0){                                  // 倒地了就没法救
    STORY_.downT=(STORY_.downT||0)+dt;
    if(STORY_.downT>6){storyEnd('lose');return;}
  }else STORY_.downT=0;
  var dx=camera.position.x-LAB_RESCUE.x, dz=camera.position.z-LAB_RESCUE.z;
  var near=(dx*dx+dz*dz<=RESCUE_R*RESCUE_R);
  STORY_.rescueNear=near;
  /* 【batch159】手机没有 F 键：靠近营救点时弹出「救援」按钮（按住＝长按 F，松开＝松手）。
     电脑端靠 .only-touch 自动隐藏（body 没有 .is-touch 时 display:none!important 压过内联样式）。 */
  var _rb=document.getElementById('btnRescue');
  if(_rb)_rb.style.display=(isTouch&&near&&SK.downed<=0&&SK.ghost<=0)?'flex':'none';
  var hold=near&&!!keys.KeyF&&SK.downed<=0&&SK.ghost<=0;
  if(hold)STORY_.rescueP=Math.min(RESCUE_NEED,STORY_.rescueP+dt);
  else if(STORY_.rescueP>0)STORY_.rescueP=Math.max(0,STORY_.rescueP-dt*0.55);   // 松手缓慢回退
  if(LAB_MARK){                                     // 光柱做呼吸感
    try{LAB_MARK.material.opacity=0.13+0.07*Math.abs(Math.sin(performance.now()*0.0016));}catch(e){}
  }
  STORY_.mobT-=dt;                                  // 小兵源源不断（【batch157】节奏加快：0.9/1.6 秒）
  if(STORY_.mobT<=0){
    if(storyMobCount()<MOB_MAX)storySpawnMob(storyMobCount()<MOB_MAX-2?2:1);
    STORY_.mobT=(storyMobCount()<MOB_MAX-2)?0.9:1.6;
  }
  storyAmbushTick(dt);
  storyRescueHud();
  if(STORY_.rescueP>=RESCUE_NEED)storyEnd('win');   // ★ 唯一胜利条件
}
function storyTick(){
  if(!STORY_.on)return;
  var now=performance.now();
  var dt=STORY_._lt?Math.min((now-STORY_._lt)/1000,0.12):0.016;STORY_._lt=now;
  storyGoalRefresh();
  if(STORY_._qt>0){STORY_._qt-=dt;if(STORY_._qt<=0)storyNextLine();}
  /* 【模组钩子 · batch166】自定义章节每帧推进：返回 true = 已自行处理完这一帧，
     直接跳过下面原版的 phase 推进逻辑（想完全自己写玩法就用它）。 */
  var _ct=storyCur();
  if(_ct&&typeof _ct.tick==='function'){try{if(_ct.tick(dt)===true)return;}catch(e){}}
  if(STORY_.phase==='intro'){
    if(!_storyQueue.length&&!storyCutOn()){
      /* 【模组钩子 · batch166】自定义章节用自己的 begin() 开场（替代原版的清剿 / 营救）。 */
      if(_ct&&typeof _ct.begin==='function'){try{_ct.begin();}catch(e){}}
      else if(STORY_.ch===2)storyBeginRescue(); else storyBeginHunt();
    }
    return;
  }
  if(STORY_.phase==='rescue'){storyRescueTick(dt);return;}   // 【batch149】第二章：营救
  if(STORY_.phase==='hunt'){
    /* 【batch128】口径改成「**杀满 10 个**就进入闪电登场」。
       原来写的是"刷满 10 个 + 场上清空"，玩家视角就是"杀不完"（杀掉的会被立刻补上）。 */
    if(STORY_.killed>=STORY_.need){storyBeginBoss();return;}
    /* 场上留着最多 7 个陪打（【batch157】原 4 个毫无压迫感），每拍最多补 3 个；总共只放 need 个出来（放完就等玩家杀） */
    if(STORY_.spawned<STORY_.need){
      STORY_.spawnT-=dt;
      if(STORY_.spawnT<=0&&storyMobCount()<7){
        storySpawnMob(Math.min(3,STORY_.need-STORY_.spawned));
        STORY_.spawnT=0.9;
      }
    }
    return;
  }
  if(STORY_.phase==='boss'){
    if(!_storyQueue.length&&!storyCutOn()){STORY_.phase='duel';STORY_.cut=false;lockPointer();showMsg('击败「闪电」！','#6ff0ff');}
    return;
  }
  if(STORY_.phase==='duel'){
    if(!STORY_.boss||STORY_.boss.hp<=0){storyEnd('win');return;}
    if(S.hp<=0){storyEnd('lose');return;}
    /* 【batch130】被球形闪电击倒：趴着 6 秒（有"动不了"的体感）→ 剧情失败结局。
       剧情里没有队友来扶，所以不等满 50 秒。 */
    if(SK.downed>0){
      STORY_.downT=(STORY_.downT||0)+dt;
      if(STORY_.downT>6){storyEnd('lose');return;}
    }else STORY_.downT=0;
    storyBossAI(dt);          // 【batch129】闪电的技能 + 警戒
    storyBossOrbTick(dt);
    bossBarRefresh();
    return;
  }
  if(STORY_.phase==='end'){
    if(!_storyQueue.length&&!storyCutOn())storyFinish();
    return;
  }
}
/* ---------- 结局 ---------- */
function storyEnd(res){
  if(STORY_.phase==='end'||STORY_.phase==='done')return;
  var _rb=document.getElementById('btnRescue');if(_rb)_rb.style.display='none';   /* 【batch159】离开营救阶段收掉手机救援按钮 */
  var byMob=(STORY_.phase==='hunt'||STORY_.phase==='rescue');   // 【batch128/149】清剿 / 营救阶段被打死
  STORY_.diedByMob=byMob;                     // 【batch129】阵亡提示要按死因分文案
  STORY_.phase='end';STORY_.res=(res==='win')?'win':'lose';STORY_.cut=true;
  mouseDown=false;rightMouseDown=false;S.aiming=false;
  try{if(document.exitPointerLock)document.exitPointerLock();}catch(e){}
  bossShow(false);storyHudShow(false);
  storyBossClearFX();                       // 【batch129】飞行中的电球 / 大球一并撤掉
  /* 收场：小兵全撤掉；输的那次把闪电留在原地（她站着，你躺着） */
  for(var i=enemies.length-1;i>=0;i--){
    var e=enemies[i];if(e.isNet)continue;
    if(STORY_.res==='win'||e!==STORY_.boss){
      if(e.aimLine&&e.aimLine.parent)e.aimLine.parent.remove(e.aimLine);
      if(scene&&e.root)scene.remove(e.root);
      enemies.splice(i,1);
    }
  }
  if(STORY_.res==='win'){STORY_.boss=null;}
  S.hp=Math.max(1,S.hp);updateHp();
  var byBall=(STORY_.downT>0);   // 【batch130】被球形闪电击倒 → 专用文案
  /* 【模组钩子 · batch166】自定义章节：结局台词自己给（winLines / loseLines）。 */
  var _ce=storyCur();
  if(_ce&&(_ce.winLines||_ce.loseLines)){
    STORY_._lt=performance.now();
    var _wl=(STORY_.res==='win')?_ce.winLines:_ce.loseLines;
    storySay((Array.isArray(_wl)&&_wl.length)?_wl:['（这一章结束了）'],3.4);
    return;
  }
  if(STORY_.ch===2){                     // 【batch149】第二章：结局只看「人救出来没有」
    STORY_._lt=performance.now();
    storySay((STORY_.res==='win')?[
      '收容舱的锁扣一个一个弹开 ——',
      '蚀日者跌坐在地上，抬头看你。',
      '「……你们总算来了。」',
      '暗月的实验没能继续下去。这一次，是你把人带走的。'
    ]:[
      '你倒在了地下。',
      '警报声里，暗月的人把收容舱重新锁上，灯一盏一盏灭掉。',
      '蚀日者还留在实验室最深处。',
      '下次，先想想怎么活着走到那扇玻璃门前。'
    ],3.1);
    return;
  }
  if(STORY_.ch===3){                     // 【batch181】第三章：交代所有人 SP 的由来
    STORY_._lt=performance.now();
    storySay((STORY_.res==='win')?[
      '灰枭倒下了。她手里的那枚电球滚下站台，熄在轨道中间。',
      '焘芯保住了 —— 可你心里那个问题，总部的研究员后来替所有人答了。',
      '「所谓 SP，并不是谁赐予的力量。它是一个人在极限战斗里沉淀下的熟练度，',
      '  与焘芯共振之后，觉醒的第二形态。」',
      '天狼的隐身、流火的火焰、镇岳的铁壁、白泽的过载、蚀日者的焚曜 ——',
      '五个人，五种频率。火车站的这一夜，只是第一次齐鸣。',
      '（熟练度练到满级，就能在英雄界面切换 SP 形态 —— 路还长。）'
    ]:[
      '你倒在了轨道旁。灰枭从你身上跨过去，径直走向车站地下。',
      '汽笛远远地响 —— 又一趟列车进站，盖住了身后的枪声。',
      '焘芯还是落进了暗月手里。',
      '下次，先弄清那阵汽笛意味着什么，再上轨道。'
    ],3.4);
    return;
  }
  var L=(STORY_.res==='win')?[
    '闪电倒下了。',
    '可你也在最后一击里用光了力气 —— 眼前一黑，跪倒在废墟上。',
    '等你醒来，总部的人告诉你：蚀日者早就被暗月带走了。',
    '「未来」没能抢到人。但至少，你摸清了那道闪电的底细。'
  ]:(byBall?[
    '球形闪电把你掀翻在地 —— 你连站都站不起来。',
    '暗月的人没有杀你 —— 他们把你扔回「未来」的大门口，像扔一袋垃圾。',
    '蚀日者还是被带走了。',
    '下次，别让那团球靠近你。'
  ]:byMob?[
    '你被暗月的斥候拖垮了 —— 倒在了追上闪电之前。',
    '暗月的人没有杀你 —— 他们把你扔回「未来」的大门口，像扔一袋垃圾。',
    '蚀日者还是被带走了。',
    '下次，先清干净路，再去碰那道青白色的光。'
  ]:[
    '你被那道闪电击倒了。',
    '暗月的人没有杀你 —— 他们把你扔回「未来」的大门口，像扔一袋垃圾。',
    '蚀日者还是被带走了。',
    '你记住了那道青白色的光。下次，不会再输。'
  ]);
  STORY_._lt=performance.now();
  storySay(L,3.1);
}
function storyClearNow(){
  var first=!UNLOCK.lightning;
  UNLOCK.lightning=true;UNLOCK.code=(typeof netMyCode==='function'?(netMyCode()||''):'');
  UNLOCK.name=S.playerName||'';UNLOCK.t=Date.now();
  unlockSave();
  /* 联机时立刻告诉服务器（单人剧情一般连不上，靠下次 join 时带上 clear 标记补报） */
  try{if(typeof netIsMulti==='function'&&netIsMulti()&&NET.connected)netSend({t:'clear',k:'lightning'});}catch(e){}
  return first;
}
/* 【batch149】第二章通关：永久解锁「蚀日者」（本地存档 + 联机按名字记账）。 */
function storyClearEclipse(){
  if(UNLOCK.eclipse)return false;
  UNLOCK.eclipse=true;UNLOCK.code=(typeof netMyCode==='function'?(netMyCode()||''):'');
  UNLOCK.name=S.playerName||'';UNLOCK.t=Date.now();
  unlockSave();
  try{if(typeof netIsMulti==='function'&&netIsMulti()&&NET.connected)netSend({t:'clear',k:'eclipse'});}catch(e){}
  return true;
}
function storyFinish(){
  STORY_.phase='done';STORY_.cut=false;
  storyCutShow(false);storyHudShow(false);bossShow(false);rescueShow(false);
  storyBossClearFX();
  storyAmbushClear();
  var first=storyClearNow();
  var win=(STORY_.res==='win');
  /* 【模组钩子 · batch166】自定义章节：通关奖励自己发（reward(win)），比如"解锁某个英雄"。
     原版两章的奖励逻辑（storyClearNow / storyClearEclipse）在下面照旧执行；
     自定义章节不给 reward 就只拿"演完剧情"的通用解锁。 */
  var _cf=storyCur();
  if(_cf&&typeof _cf.reward==='function'){try{_cf.reward(win);}catch(e){}}
  var firstE=(STORY_.ch===2&&win)?storyClearEclipse():false;   // 【batch149】救出蚀日者＝永久解锁他
  var firstS=(STORY_.ch===3&&win)?storyClearStation():false;   // 【batch181】第三章只记通关（不解锁任何东西）
  /* 【batch129】用户要求：剧情里倒下了，**不要**像平时那样弹通用的「游戏结束」结算面板；
     而是等剧情演完之后，给一个**专门的阵亡提示**（这里就是它）。 */
  var card=storyEl('storyDoneCard'),ttl=storyEl('storyDoneTitle'),sub=storyEl('storyDoneSub');
  if(card){if(win)card.classList.remove('stDead');else card.classList.add('stDead');}
  if(ttl)ttl.textContent=win?(STORY_.ch===2?'🎬 剧情通关 · 蚀日者获救':(STORY_.ch===3?'🎬 剧情通关 · 焘芯守住了':'🎬 剧情通关')):'☠ 任务失败';
  if(sub)sub.textContent=(STORY_.ch===3)
    ?(win?'灰枭被打倒在站台上，暗月残部退出了火车站。'
        :(STORY_.diedByMob?'你被暗月残部拖垮，倒在了通往焘芯基地的入口前。'
                          :'你倒在了「灰枭」手下 —— 她一击就走，你没能撑住。'))
    :(STORY_.ch===2)
    ?(win?'你把人从收容舱里带出来了。'
          :(STORY_.diedByMob?'你被地下守备队拖垮，倒在了收容舱之前。'
                            :'你倒在了「闪电」手下 —— 她一击就走，你没能撑住。'))
    :(win?'你打倒了「闪电」—— 但蚀日者已经被暗月带走了。'
        :(STORY_.diedByMob?'你被暗月的斥候拖垮，倒在了追上闪电之前。'
                           :'你倒在了「闪电」手下 —— 暗月的人把你扔回了总部。'));
  var body=storyEl('storyDoneBody');
  if(body)body.innerHTML=(STORY_.ch===3)
    ?('<p class="stLine">结局 · '+(win?'焘芯守住了':'火车站失守')+'</p>'
      +'<p class="stLine dim">'+(win?'暗月残部退出了车站。汽笛远去，天光重新落回轨道上。'
                                  :'灰枭带走了焘芯的核心数据。车站的灯，一夜之间全灭了。')+'</p>'
      +'<div class="stUnlock" style="background:rgba(255,179,71,.08);border-color:rgba(255,179,71,.32)">'
      +'<b>🌞 SP 形态的由来</b>：所谓 SP 并不是谁赐予的力量 —— 它是一个人在极限战斗里沉淀出的<b>熟练度</b>，'
      +'与焘芯共振后觉醒的<b>第二形态</b>。天狼 / 流火 / 镇岳 / 白泽 / 蚀日者，五个人五种频率。</div>'
      +'<div class="stUnlock" style="background:rgba(111,240,255,.08);border-color:rgba(111,240,255,.32)">'
      +'<b>⚡ 怎么解锁</b>：这一章<b>不解锁任何英雄</b> —— SP 靠练！把任意英雄的<b>熟练度打到 Lv.10</b>，'
      +'就能在「🦸 英雄」页一键切换 SP 形态（蚀日者也在其中）。</div>'
      +'<p class="stLine dim" style="font-size:12px">（剧情到此结束，可以返回主菜单了）</p>')
    :(STORY_.ch===2)
    ?('<p class="stLine">结局 · '+(win?'蚀日者获救':'营救失败')+'</p>'
      +'<p class="stLine dim">'+(win?'暗月的实验被中止了 —— 蚀日者活着走出了那扇玻璃门。'
                                  :'警报解除之后，收容舱重新上了锁。你没能把人带出来。')+'</p>'
      +'<div class="stUnlock"><b>🌀 蚀日者</b> 已'+(win?(firstE?'解锁':'保持解锁'):'仍未解锁')+'：'
        +(win?'现在可以在「🦸 英雄」页选他出战了。':'把人救出来才会解锁。')+'</div>'
      +'<div class="stUnlock" style="background:rgba(111,240,255,.08);border-color:rgba(111,240,255,.32)">'
        +'<b>⚡ 闪电</b> 已'+(first?'解锁':'保持解锁')+'（演完剧情就算通过）。</div>'
      +'<p class="stLine dim" style="font-size:12px">（剧情到此结束，可以返回主菜单了）</p>')
    :('<p class="stLine">结局 · '+(win?'你击败了闪电':(STORY_.diedByMob?'你被斥候击败':'你被闪电击败'))+'</p>'
      +'<p class="stLine dim">但无论输赢 —— 蚀日者已经被暗月佣兵团带走，这是第一章的结局。</p>'
      +'<div class="stUnlock"><b>⚡ 闪电</b> 已'+(first?'解锁':'保持解锁')+'：走完剧情就算通过，现在可以在「🦸 英雄」页选她出战了。</div>'
      +'<p class="stLine dim">🔒 蚀日者还锁着 —— 去第二章「救出蚀日者」把他抢回来就解锁了。</p>'
      +'<p class="stLine dim" style="font-size:12px">（剧情到此结束，可以返回主菜单了）</p>');
  storyShowDone(true);storyRefreshBtn();buildHeroGrid();heroHudUpdate(true);
  S.playing=false;S.over=false;S.paused=false;
  var hd=storyEl('hud');if(hd)hd.style.display='none';
  var sh=storyEl('skillHud');if(sh)sh.style.display='none';
}
/* ---------- 收尾 / 中止 ---------- */
function storyHome(){
  storyShowDone(false);storyShowPick(false);storyCutShow(false);storyShowChap(false);rescueShow(false);
  storyHudShow(false);bossShow(false);
  STORY_.on=false;STORY_.phase='';STORY_.cut=false;STORY_.boss=null;
  quitToHome();storyRefreshBtn();buildHeroGrid();
}
function storyAbort(){
  storyShowDone(false);storyShowPick(false);storyCutShow(false);storyShowChap(false);
  storyHudShow(false);bossShow(false);rescueShow(false);
  if(typeof storyBossClearFX==='function')storyBossClearFX();   // 【batch129】
  if(typeof storyAmbushClear==='function')storyAmbushClear();   // 【batch149】把闪现的闪电收掉
  STORY_.on=false;STORY_.phase='';STORY_.cut=false;STORY_.boss=null;
  _storyQueue.length=0;STORY_._qt=0;
  storyRefreshBtn();
}
/* ---------- 初始化：把剧情那几个按钮接上 ---------- */
(function storyInit(){
  unlockLoad();
  var b=storyEl('storyBtn');if(b)b.addEventListener('click',storyOpen);
  var c=storyEl('storyCut');if(c)c.addEventListener('click',function(){storySkip();});
  var pc=storyEl('storyPickCancel');if(pc)pc.addEventListener('click',function(){storyShowPick(false);});
  var pg=storyEl('storyPickGo');if(pg)pg.addEventListener('click',storyStart);
  var cn=storyEl('storyChapNext');if(cn)cn.addEventListener('click',storyGoPick);   // 【batch149】选完章节再选人
  var cc=storyEl('storyChapCancel');if(cc)cc.addEventListener('click',function(){storyShowChap(false);});
  var dh=storyEl('storyDoneHome');if(dh)dh.addEventListener('click',storyHome);
  storyRefreshBtn();
})();
// 退出对局时的「清场」：把本局动态产生的东西全部从场景里收掉，与死亡后刷新页面同等干净。
// 为什么需要：quitToHome 原来只移除 AI 敌人，子弹 / 敌人子弹 / 拾取物 / 粒子 / 烟团 / 投掷物 /
// 技能区域（电区、黑日、陷阱、闪电球、传送门、暗影毒圈）全都留着 —— 回主菜单再开一局时
// 上一局的子弹还在飞、粒子还在冒、区域还在生效（用户反馈：退出游戏没删地图数据）。
// 地图 Group 是懒构建复用的（setMap 只管显隐），这里不销毁；联机玩家模型由 netClearPlayers 处理。
function clearFieldData(){
  try{
    /* ① AI 敌人（联机玩家模型跳过，交给 netClearPlayers） */
    for(var i=enemies.length-1;i>=0;i--){
      var e=enemies[i];
      if(e&&e.isNet)continue;
      if(e&&e.aimLine&&e.aimLine.parent)e.aimLine.parent.remove(e.aimLine);
      /* 【batch180】必须用 root.parent.remove，不能 scene.remove：three.js 的 remove() 只在
         **直接子级**里找，而靶场假人的 root 挂在地图组 MAP_GROUP.range 下（不是 scene 子级）
         —— scene.remove 对它什么都不会摘，结果退出后模型残留在地图组上、实体却已脱离
         enemies，用户看到的就是"靶子还在但不受伤害"。对普通敌人（root 就挂 scene）
         两种写法完全等价。 */
      if(e&&e.root&&e.root.parent)e.root.parent.remove(e.root);
      enemies.splice(i,1);
    }
    /* ② 玩家子弹 / 敌人子弹 */
    for(var b=0;b<bullets.length;b++){var bm=bullets[b]&&bullets[b].m;if(bm&&bm.parent)bm.parent.remove(bm);}
    bullets.length=0;
    for(var eb=0;eb<enemyBullets.length;eb++){var em=enemyBullets[eb]&&enemyBullets[eb].m;if(em&&em.parent)em.parent.remove(em);}
    enemyBullets.length=0;
    /* ③ 拾取物（血包 / 弹药） */
    for(var pk=0;pk<pickups.length;pk++){var pm=pickups[pk]&&pickups[pk].m;if(pm&&pm.parent)pm.parent.remove(pm);}
    pickups.length=0;
    /* ④ 投掷物（含落地后保留网格的探测器等） */
    for(var pj=projList.length-1;pj>=0;pj--){try{projRemove(projList[pj]);}catch(e2){}}
    /* ⑤ 粒子：回收隐藏（网格是池子里复用的，不能 remove） */
    for(var pt=activeParticles.length-1;pt>=0;pt--){try{if(activeParticles[pt].mesh)activeParticles[pt].mesh.visible=false;}catch(e3){}}
    activeParticles.length=0;
    /* ⑥ 烟团 */
    smokeZones.length=0;
    /* ⑦ 英雄技能区域 / 传送门 / 暗影毒圈（与剧情开局同一套口径） */
    if(typeof SK!=='undefined'&&SK){
      SK.downed=0;SK.slow=0;SK.overload=0;SK.vuln=0;SK.blind=0;SK.blindDur=0;SK.revealAll=0;SK.zap=0;
      SK.shadowT=0;SK.shadowObj=null;if(SK.shadows)SK.shadows.length=0;
      if(SK.portals)for(var pg=0;pg<SK.portals.length;pg++){try{portalKillPair(SK.portals[pg]);}catch(e4){}}
      if(SK.ghost>0&&typeof heroGhostFx==='function')heroGhostFx(false);
      SK.ghost=0;SK.ghostFrom=null;SK.ghostSi=-1;
      SK.eclipses=[];SK.orbs=[];SK.traps=[];SK.balls=[];SK.portals=[];SK.ballLeft=0;
  /* 【batch181】白夜状态连黑日网格一起收（别让上一局的天象漏到下一局） */
  if(SK.spVeilObj&&SK.spVeilObj.parent)SK.spVeilObj.parent.remove(SK.spVeilObj);SK.spVeil=0;SK.spVeilPulse=0;SK.spVeilObj=null;
      SK.suneyeT=0;SK.suneyeObj=null;SK.inEclipse=false;SK.hold=null;SK.aimThrow=false;
      if(SK.mineObj&&SK.mineObj.parent)SK.mineObj.parent.remove(SK.mineObj);
      SK.mineObj=null;
    }
    /* ⑧ 屏幕特效（白闪 / 电弧 / 倒地倒计时） */
    if(typeof clearDeathFx==='function')clearDeathFx();
    /* ⑨ 模组自己放进场上的物体（黑洞 / 假人 / 歌声光环 / 远端复现物） */
    try{if(window.ModLoader&&typeof ModLoader.clearField==='function')ModLoader.clearField();}catch(e5){}
  }catch(e){}
}
/* 退出对局时的「状态归零」：把本局跑过的所有运行时状态重置回"刚打开页面"的初始值。
   死亡后重开走 location.reload()（整页重载，一切归零）；退出回主菜单不刷新页面，
   所以必须在这里逐项重置，否则会留一堆后患：
     · 退出时正按着的键卡住（_raw 不清）→ 重开局人物自己往前走；
     · 护盾 / 反射力场 / 肾上腺素 / 冲锋火 / 阵地 / 虚影 / 全域之眼 / 遁入暗影 这些模型挂在
       camera 或 scene 上，而退出后 S.playing=false 让主循环跳过 updateHero —— 没人再去收它们；
     · 武器选择界面（z-index 110）开着时退出 → 残留盖住主菜单；
     · 金币 / 冲刺 / 开镜 / 位移插值 等 S、SK 字段不清 → 带进下一局。
   与 clearFieldData() 的分工：那个清"场景里的物体"，这个清"变量与界面"。 */
/* 技能物件（掩体墙 / 火路 / 电网 / 治疗云 / 穹顶 / 暗影圈等）的清理口径【batch184，覆盖 batch183】：
   · 多人游戏退出（wasMulti=true）→ **一律不动**：自己放的、别人放的都留在战场上，
     因为同房其他人还在打，谁的墙 / 区域都不该被"某人退出"这一动作抹掉 —— 用户口径。
   · 单人游戏退出（wasMulti 未传 / false）→ 全清（场上本来只有自己）。
   具体删除动作在下面 11899 行 `if(!wasMulti){ spZoneClearAll(true); }` 执行。 */
function resetRoundState(wasMulti){
  try{
    /* ① 键盘 / 鼠标：退出时正按着的键必须松掉，否则重开局人物自己往前走。
         ★ keys 是 Object.defineProperty 存取器，绝不能 keys={}（会永久失效），只能清底下的 _raw。 */
    for(var _rk in _raw)_raw[_rk]=false;
    mouseDown=false;rightMouseDown=false;freshTrigger=false;
    try{ if(typeof keyCaptureAction!=='undefined')keyCaptureAction=null; }catch(e0){}   // 改键捕获中退出 → 后续按键会被吞
    /* ② 玩家状态 S：全部回到初始值（名字不清，主菜单还要显示） */
    S.hp=100;S.maxHp=100;S.score=0;S.kills=0;S.wave=0;S.left=0;
    S.ammo=30;S.maxAmmo=30;S.reloading=false;S.fireRate=50;S.reloadTime=1200;S.lastShot=0;
    S.range=80;S.pellets=1;S.spread=0;S.auto=true;
    S.baseSpeed=BASE_SPEED;S.sprintMul=1.5;S.sprinting=false;
    S.sens=0.003;S.sensMul=1;S.playing=false;S.over=false;S.paused=false;
    S.recoilKick=0;S.recoilRot=0;S.recoilPunch=0;S.bobPhase=0;S.damageMul=1.0;S.recoilMul=1.0;
    S.velY=0;S.onGround=true;S.ladderCD=0;S.onLadder=false;S.landKick=0;S.mantle=0;S.mantleDur=0.5;
    S.swayX=0;S.swayY=0;S.prevYaw=0;S.prevPitch=0;S.yawVel=0;S.pitchVel=0;
    S.lean=0;S.leanX=0;S.leanZ=0;
    S.reloadInit=false;S.reloadOldDetached=false;S.reloadNewAttached=false;S.reloadDiscard=null;
    S.aiming=false;S.aimProgress=0;S.adsSpeedMul=1;S.hipSpreadMul=1;S.roll=0;
    S.crouch=false;S.touchCrouch=false;S.sprintLatch=false;S.joySprint=false;S.wTap=0;
    S.crP=0;
    S._airInit=false;S.airVX=0;S.airVZ=0;S.airWX=0;S.airWZ=0;S._jumpVX=null;S._jumpVZ=null;   // 空中惯性
    /* ③ 英雄状态 SK：除 idx 之外全部归零；挂着的模型连父节点一起摘（主循环已不跑，没人替我们收） */
    SK.cds=[0,0,0];SK.revealAll=0;SK.hold=null;SK.aimThrow=false;SK.holdT=0;SK.holdHideGun=false;
    SK.cloak=0;SK._breakAt=0;SK.spMarkT=0;SK.spMarkIds=null;SK.spBurnT=0;SK.dome=0;SK.inDome=false;if(SK.spDrone)_spDroneClear();   // 【batch171】SP 状态一并清
    /* 【batch184】退出清技能物件：
        单人游戏退出 → 全清（自己的墙 / 区域 + 别人的远端墙，场上本来只有自己）。
        多人游戏退出 → 一律不动：自己放的、别人放的都留在战场上，
          因为同房其他人还在打，他们的墙 / 区域不该被"某人退出"这一动作抹掉。
          （这正是用户要求的："多人模式下退出不会删除所有人、包括自己的技能特效，只有单人游戏下才会删除"） */
    if(!wasMulti){ try{spZoneClearAll(true);}catch(_){} }
    spCloakSync();   /* 【batch173】联机：重置也要告诉别人「我现形了」 */
    SK.mine=0;SK.mineLife=12;SK.mineX=0;SK.mineZ=0;SK.mineObj=null;SK.mineFly=null;SK.minePing=0;
    SK.blind=0;SK.blindDur=0;SK.flashX=0;SK.flashZ=0;
    SK.dashBuff=0;SK.inFortify=false;SK.zoneX=0;SK.zoneY=0;SK.zoneZ=0;
    SK.shield=0;SK.reflect=0;SK.fortify=0;SK.dash=0;SK.dashX=0;SK.dashZ=0;SK.dashLast=0;SK.rush=0;SK.smash=0;
    SK.aura=0;SK.auraX=0;SK.auraZ=0;SK.adren=0;SK.slow=0;SK.hitFlash=0;
    ['shieldObj','reflectObj','fortifyObj','adrenObj','rushObj','auraObj','ghostObj','suneyeObj','shadowObj'].forEach(function(_k){
      try{ if(SK[_k]&&SK[_k].parent)SK[_k].parent.remove(SK[_k]); }catch(e2){}
      SK[_k]=null;
    });
    SK.eclipses=[];SK.inEclipse=false;SK.portalCd=0;SK.portals=[];
    SK.ghost=0;SK.ghostFrom=null;SK.ghostSi=-1;
    SK.suneyeT=0;SK.suneyeR=SUNEYE_R;SK.suneyeX=null;SK.suneyeY=null;SK.suneyeZ=null;SK.suneyeN=null;
    SK.orbs=[];SK.traps=[];SK.balls=[];SK.ballLeft=0;SK.ballGap=0;
    SK.shadows=[];SK.shadowT=0;
    SK.zap=0;SK.overload=0;SK.vuln=0;SK.downed=0;SK._dbT=0;
    SK._hud=['','',''];SK._hudPct=[-1,-1,-1];SK._hudSt=['','',''];
    /* ④ 金币 */
    gold=0;totalGoldEarned=0;
    /* ⑤ 打开着的浮层一律收掉（武器选择界面 z-index 110，不退掉会盖住主菜单） */
    ['weapon-select','scopeFx','redDotFx','settingsPanel','keyPanel','layoutBar','netPanel','wave-shop','go','netDeath','netBoard','hud'].forEach(function(id){
      try{var el=document.getElementById(id);if(el)el.style.display='none';}catch(e3){}
    });
    try{ if(typeof spOpen!=='undefined'&&spOpen&&typeof openSettings==='function')openSettings(false); }catch(e4){}
    try{ if(typeof layoutEdit!=='undefined')layoutEdit=false; }catch(e5){}
    try{ if(typeof menuPauseSync==='function')menuPauseSync(); }catch(e6){}
    try{ if(typeof closeGameMenu==='function')closeGameMenu(); }catch(e7){}
    /* ⑥ 黑洞引力源（退出后本会 160ms 自动过期，这里直接清干净） */
    try{ if(typeof _gravSrc!=='undefined')_gravSrc.length=0; }catch(e8){}
    /* ⑦ 视角回正 */
    yaw=0;pitch=0;
  }catch(e){}
}
// 结束当前局、回到主菜单（此时才允许加入服务器）
function quitToHome(){
  if(typeof storyAbort==='function')storyAbort();          // 【batch126】退出对局＝同时中止剧情
  /* 【batch183】这一局是不是联机，必须在断开连接**之前**记下来：
     联机退出时只清自己的技能物件，别人（远端）的墙 / 区域留着 —— 那是房间里其他人的。 */
  var _wasNet=!!(NET.ws||NET.connected||(NET.list&&NET.list.length));
  S.playing=false;S.over=false;S.paused=false;
  S.wave=0;S.left=0;S.score=0;S.kills=0;S.hp=S.maxHp;
  // 清掉场上所有本局动态数据：AI 敌人、子弹、粒子、拾取物、烟团、投掷物、技能区域、模组物体
  // （联机玩家模型留着由后面的 netClearPlayers 处理）
  clearFieldData();
  // 断开与服务器的连接（退出游戏＝离开服务器）
  try{if(NET.ws){NET.ws.onclose=null;NET.ws.onmessage=null;NET.ws.close();}}catch(e){}
  NET.ws=null;NET.connected=false;NET.reconnecting=false;NET.id=0;NET.dead=false;
  NET.replaced=false;NET.enabled=null;NET.list=[];
  netClearPlayers();netKeepAlive(false);
  ['netBoard','netDeath','wave-shop','go','hud'].forEach(function(id){var el=document.getElementById(id);if(el)el.style.display='none';});
  if(typeof isTouch!=='undefined'&&isTouch&&typeof touchUI!=='undefined'&&touchUI)touchUI.style.display='none';
  try{if(document.exitPointerLock)document.exitPointerLock();}catch(e){}
  updateHp();
  /* 状态归零：按键 / S / SK（含挂在 camera、scene 上的英雄模型）/ 金币 / 浮层 / 视角
     —— 死亡后重开是 location.reload() 整页重载，退出不刷新页面，就得在这里逐项归零。
     顺带把英雄选择恢复默认（内存、存档、选人界面、技能 HUD 四处一起）。 */
  resetRoundState(_wasNet);
  try{
    /* 【batch222】**不再把英雄写回默认**。
       用户口径：退出＝直接刷新，其他任何东西都不变。之前这里 `SK.idx=HERO_SCOUT;heroSave()`
       主动存了一次默认值，刷新后 heroLoad() 读到的就是天狼 —— 看起来就是"退出把我的英雄弄丢了"。
       现在什么都不写，刷新后自然恢复上次选的那位。 */
    if(typeof buildHeroGrid==='function')buildHeroGrid();
    if(typeof heroHudUpdate==='function')heroHudUpdate(true);
  }catch(e){}
  var bl=document.getElementById('blocker');if(bl)bl.style.display='flex';
  setMenuMode('home');
  /* 【batch197】退出＝**整页刷新**（用户口径：「退出游戏时要像死亡一样刷新一下页面」）。
     ── 为什么干脆刷新，而不是继续靠上面那一大段逐项归零 ──
     死亡后「再来一局」走的就是 location.reload()，那条路天然干净：GPU 纹理/几何、事件监听、
     定时器、模组塞进 scene 的东西、WebSocket 半连接状态，全部随页面一起销毁，下一局从零开始。
     而 quitToHome 只能"觉得自己清干净了"——每加一个技能 / 模组钩子，就得往 resetRoundState
     里补一条，漏一条就是"退出后重开人物自己走 / 特效还在 / 界面残留"这类疑难杂症。
     所以这里改成和死亡同一条路：刷新。
     · 上面那段 resetRoundState 保留 —— 它是**兜底**：万一刷新被浏览器拦下（某些内嵌 WebView
       会拦 location.reload），页面仍然是一个干净的主菜单，而不是半清理状态。
     · 延迟 60ms 而不是立刻刷：给 ws.close() 的关闭帧和主菜单 DOM 一点时间真正发出去/画出来。
       刷新会掐断所有连接，太急的话服务端有时要等 TCP 超时才认为人走了。
     · __退出刷新中 防重入：连点两次「退出」只刷新一次。 */
  try{
    if(!window.__退出刷新中){
      window.__退出刷新中=1;
      setTimeout(function(){
        try{ location.reload(); }
        catch(e){ window.__退出刷新中=0; }   /* 刷不了就留在主菜单（上面已经恢复好了） */
      }, 60);
    }
  }catch(e){}
}
// 启动流程：没取过名字就先取名字；**取过名字也要先跟名字库核对一遍**（【batch221】）
(function bootFlow(){
  playerNameLoad();
  playerCodeLoad();
  var np=document.getElementById('namePanel'),ni=document.getElementById('nameInput');
  var ci=document.getElementById('codeInput');
  var bl=document.getElementById('blocker'),ok=document.getElementById('nameOk');
  var er=document.getElementById('nameErr');
  if(ci&&_playerCode)ci.value=_playerCode;
  var _核对中=false,_已进=false;
  function toHome(){
    _已进=true;
    /* 【batch226】给「服务器连接条」的旗子：名字这关过了，可以 join 了。
       现在打开服务器页面就自动连，不等的的话 join 会带着默认名"电脑664"上服务器，
       玩家随后注册的名字根本没发出去。 */
    try{ window.__名字就绪=1; }catch(e){}
    try{ if(np)np.classList.remove('on'); }catch(e){}
    try{ if(bl)bl.style.display='flex'; }catch(e){}
    try{ setMenuMode('home'); }catch(e){}
    try{ refreshMyIdLine(); }catch(e){}
  }
  function 弹面板(msg){
    _已进=false;
    try{ if(np)np.classList.add('on'); }catch(e){}
    try{ if(bl)bl.style.display='none'; }catch(e){}
    if(er)er.textContent=msg||'';
    if(ni){try{ni.focus();}catch(e){}}
  }
  function 放行(){ _核对中=false; if(ok)ok.disabled=false; if(er)er.textContent=''; toHome(); }
  /* 存名字/身份码：函数可能因为玩家缓存了旧分片而不存在 → 退一步只写内存，绝不抛错 */
  function 存名字(v,c){
    try{ if(typeof playerNameSave==='function')playerNameSave(v); else S.playerName=String(v||'').slice(0,8); }
    catch(e){ try{ S.playerName=String(v||'').slice(0,8); }catch(e2){} }
    if(c)try{ if(typeof playerCodeSave==='function')playerCodeSave(c); }catch(e){}
  }
  if(ni&&S.playerName)ni.value=S.playerName;

  /* ---- 名字闸门：**一进网页就查**，不等进多人游戏（【batch221】用户要求）----
     规则：
       · 名字库里有、且是自己的（同 cid 或身份码对） → 直接进主菜单
       · 名字库里**没有**（known=0）                → 回取名面板，让玩家确认后重新注册一遍
       · 名字是别人的 / 正在游戏里                  → 回取名面板并说明（填身份码或改名）
       · 连不上服务器（超时/离线）                  → 放行进主菜单（不能因为没网就把人锁死）
     ⚠️ 放行/弹面板都必须**幂等**：超时放行之后回调再晚回来，也不能把已经在菜单里的玩家弹回面板。 */
  (function 名字闸门(){
    if(!S.playerName){ 弹面板(''); return; }
    /* 【batch222】本地已经有**身份码** → 说明这名字在服务器上注册成功过，直接进。
       用户口径：「登录信息直接保存到本地，不要每次打开都登录一遍」。
       身份码只会由服务端在注册/join 成功时下发，所以它存在＝真的注册过。
       名字库万一被清了也不影响：进服务器时服务端会按 cid/身份码重新登记（join → nameBind）。 */
    if(_playerCode){ toHome(); return; }
    弹面板('正在核对名字…');
    _核对中=true; if(ok)ok.disabled=true;
    var 已回=false;
    function 完成(fn){ if(已回)return; 已回=true; fn(); }
    try{
      if(typeof netCheckName!=='function'){ 完成(放行); return; }   // 旧分片：别把玩家锁死在面板上
      netCheckName(S.playerName,_playerCode,function(r){
        完成(function(){
          _核对中=false; if(ok)ok.disabled=false;
          if(!r){ 放行(); return; }                                  // 连不上：离线放行
          /* ⚠️ 旧版服务端没有 known 字段（它只回 ok）——这时**必须保守放行**，
             否则服务端没重启的话，所有老玩家都会被判成"未注册"、每次进来都被要求重新注册一遍。 */
          if(r.ok&&typeof r.known!=='number'){ 放行(); return; }
          if(r.ok&&r.known){ 放行(); return; }                       // 名字库有、是我的
          if(r.ok&&!r.known){                                        // 名字库没有 → 让他重新注册
            弹面板('这个名字还没有在服务器上注册过。确认名字后点「确定」完成注册。');
            return;
          }
          if(r.needCode){
            弹面板('🔒 这个名字是别人的。如果这就是你，请在「身份码」框里填上你的身份码再点确定；否则换个名字'+(r.alt?('，比如「'+r.alt+'」'):''));
            if(ci){try{ci.focus();}catch(e){}}
            return;
          }
          if(r.busy){ 弹面板('⏳ 这个名字正在游戏中（同一个名字不能同时两个人用），请稍后再试或换个名字'); return; }
          弹面板('❌ 这个名字已经有人在用了'+(r.alt?('，换个「'+r.alt+'」试试'):'')+'，请换一个名字');
        });
      },{时限:1200});
    }catch(e){ 完成(放行); }
  })();

  function submit(){
    if(_核对中)return;          // 正在核对就别重复提交
    if(_已进)return;            // 已经在主菜单了
    var v=ni?String(ni.value||'').trim():'';
    var c=ci?((typeof playerCodeNormalize==='function')?playerCodeNormalize(ci.value):''):'';
    if(!v){if(er)er.textContent='请先输入名字';return;}
    if(typeof playerNameValid==='function'&&!playerNameValid(v)){if(er)er.textContent='名字只能用中文、字母、数字、_ 或 -，最多 8 个字';return;}
    if(c&&!/^[A-Z0-9]{6}$/.test(c)){if(er)er.textContent='身份码是 6 位字母或数字（没有就留空）';return;}
    if(er)er.textContent='正在检查这个名字…';
    if(ok)ok.disabled=true;
    var 已回=false,兜底=null;
    /* ⚠️ 4 秒硬兜底（【batch221】）：万一 netCheckName 没回来（旧分片 / 浏览器把定时器节流 /
       服务端半死），玩家会永久卡在"正在检查这个名字…"、按钮一直禁用 —— 这正是"新玩家进不去"的样子。
       名字格式既然合法，宁可先放他进主菜单，也不能锁死。 */
    兜底=setTimeout(function(){
      if(已回)return; 已回=true;
      if(ok)ok.disabled=false; if(er)er.textContent='';
      存名字(v,c); toHome();
    },4000);
    function 结束(r){
      if(已回)return; 已回=true;
      if(兜底){clearTimeout(兜底);兜底=null;}
      if(ok)ok.disabled=false;
      if(r&&r.ok===false){          // 服务器上有别人用了 → 提示换名，或者用身份码取回
        if(r.needCode){
          if(er)er.textContent='🔒 这个名字是别人的。如果这就是你，请在「身份码」框里填上你的身份码再点确定；否则换个名字'+(r.alt?('，比如「'+r.alt+'」'):'');
          if(ci){try{ci.focus();}catch(e){}}
          return;
        }
        if(r.busy){if(er)er.textContent='⏳ 这个名字正在游戏中（同一个名字不能同时两个人用），请稍后再试或换个名字';return;}
        if(er)er.textContent='❌ 这个名字已经有人在用了'+(r.alt?('，换个「'+r.alt+'」试试'):'')+'，请换一个名字';
        return;
      }
      if(er)er.textContent='';
      /* 【batch221】服务端登记成功后回传身份码（新注册才有）→ 存下来，换设备/换网址能取回这个名字 */
      var 码=(r&&r.code)?String(r.code):c;
      存名字(v,码);
      toHome();
    }
    try{
      if(typeof netCheckName!=='function'){ 结束(null); return; }   // 旧分片：直接当"没有服务器"处理
      netCheckName(v,c,结束,{bind:1});
    }catch(e){ 结束(null); }
  }
  if(ok)ok.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();submit();});
  if(ni){
    ni.addEventListener('keydown',function(e){
      // 【修复】只对回车做处理；绝不能无条件 stopPropagation——否则输入焦点停在名字框时
      // （例如某些浏览器里点"开始"后输入框仍保留焦点），B / 技能键等所有按键都会被拦在
      // 冒泡途中，永远到不了 document 上的游戏监听器，表现就是"按了没反应"。
      if(e.key==='Enter'){e.preventDefault();e.stopPropagation();submit();}
    });
  }
  if(ci){
    ci.addEventListener('keydown',function(e){
      if(e.key==='Enter'){e.preventDefault();e.stopPropagation();submit();}
    });
  }
  var rs=document.getElementById('btnResume');
  if(rs)rs.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();closeGameMenu();});
  var qt=document.getElementById('btnQuit');
  if(qt)qt.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();quitToHome();});
})();
