/* 【1.10.18】手机版操作层（js/72_手机操作.js）==========================================
   手机版操作层 —— 1.10.18 完全重写（不是修补）
   ============================================================================

   【为什么要重写，而不是继续调坐标】
     旧版是 13 个绝对定位按钮 + JS 逐像素摆放，问题是一整套的、互相连锁的：
       · 位置靠 window.innerWidth 反推 → WebView 里只要被整体缩放一次，
         布局坐标和手指触摸坐标就不是同一套单位，"看着在这、点着在那"
       · 按钮之间只留 20px 间隙，而指腹有效接触直径 40px 以上 → 必然误触
       · 视角区是一整块铺满屏的 lookPad，和按钮抢同一批触摸，谁先收到靠 z-index 碰运气
       · 技能占了 3 个独立大按钮，右下角一半地方被低频操作吃掉
       · 蹲/跳/换弹/换枪/探头全平铺，拇指要横跨半个屏幕才能按到最左边那个

   【新版的四条原则】
     1) **尺寸和位置全部交给 CSS**：JS 一个像素都不算。单位是 --u（设计像素，
        750×375 横屏为基准，自动跟随屏幕缩放）。CSS 算出来的是什么，手指摸到的就是什么，
        WebView 再怎么缩放都不会错位 —— 因为两边本来就是同一个坐标系。
     2) **左手管走，右手管打**：
        · 左 44% 全高是移动区，**落下即出现摇杆**（不用去找固定的圆圈），推满外侧＝疾跑
        · 右下是弧形键簇：开火在最舒服的角落，其余键沿拇指自然弧线排，圆心间距永远 ≥ 半径和 + 8
     3) **技能不再单独开键**：直接点屏幕底部中间的技能 HUD 槽。
        眼睛本来就在看冷却，指哪儿点哪儿，比"低头找第几个按钮"快一个数量级。
     4) **开火键按住后拖动＝微调视角**（跟枪）。手机上没有鼠标，边打边修正是刚需。

   【和旧版的兼容】
     · 对外仍然只暴露 `isTouch` / `touchUI` / `layoutEdit` 三个名字（别的分片在用）
     · `layoutEdit` 恒为 false：新布局不接受拖动编辑，旧设置面板里的入口已移除
     · `layoutClampAll` / `layoutFit` 等旧函数保留为空实现，避免别处调用时报错
   ============================================================================ */
(function(){
'use strict';

if(typeof isTouch==='undefined'||!isTouch)return;
var root=document.getElementById('touchUI');
if(!root)return;

function $(id){return document.getElementById(id);}
function msg(t,c){ try{ if(typeof showMsg==='function')showMsg(t,c); }catch(e){} }
/* 游戏里"能不能动手"：暂停、结算、菜单里一律不响应 */
function 可操作(){
  if(!S)return false;
  if(S.paused||S.over)return false;
  if(S.playing)return true;
  /* 【1.11.0】真机专属兜底：电脑端靠 pointer lock 判定"进没进对局"，
     手机上 pointer lock 本来就用不了 —— 一旦开始流程卡在半路，S.playing 会一直是 false，
     于是**所有触摸都被这里丢掉**：按键看着在、点了没反应，屏幕也拖不动。
     真正决定"能不能操作"的是菜单有没有挡着 → #blocker 已经收起就放行。 */
  try{
    var b=document.getElementById('blocker');
    if(b&&(b.style.display==='none'||getComputedStyle(b).display==='none'))return true;
  }catch(e){}
  return false;
}
function 有原生触摸(){ return ('ontouchstart' in window) || (navigator.maxTouchPoints||0)>0; }

/* ---------------------------------------------------------------------------
   0. 触摸 / 鼠标统一绑定
   ---------------------------------------------------------------------------
   为什么不用 click：click 在移动端有 300ms 判定（要区分单击和双击缩放），
   开火、跳跃这种要求"按下即生效"的动作等不起。全部走 touchstart/touchend。
   电脑上用 ?touch=1 调试时没有触摸事件，补一套 mousedown/mouseup 兜底 ——
   但只在**确实没有触摸能力**时才绑，真手机不会绑，绝不双触发。 */
var 有触摸=有原生触摸();

/* 【1.11.0】鼠标兜底不再按"有没有触摸能力"决定，而是**一律绑上**。
   根因（用户：mumu 模拟器无法模拟真实的手机端环境、手机端无法拖拽屏幕）：
     · muMu / 雷电这类模拟器跑的仍是 Android WebView，UA 里带 Android、`ontouchstart` 也在，
       于是 `有触摸=true`，老代码就**不绑鼠标事件**；
     · 但模拟器的鼠标点击/拖动只发 mouse 事件（或只发一部分 touch），
       结果按钮按不动、#mobLook 拖不转视角、摇杆也拖不出来。
   现在两套事件都绑，用"最近 500ms 内发生过真实触摸"来抑制重复触发：
   真手机上触摸后浏览器补发的兼容 mouse 事件会被这段窗口挡掉，不会双触发。 */
var 末次触摸=0;
function 是鼠标(){ return Date.now()-末次触摸>500; }
if(document&&document.addEventListener){
  document.addEventListener('touchstart',function(){末次触摸=Date.now();},true);
  document.addEventListener('touchmove',function(){末次触摸=Date.now();},true);
  document.addEventListener('touchend',function(){末次触摸=Date.now();},true);
}

function 按住(el,onDown,onUp,onMove){
  if(!el)return;
  var tid=null;
  el.addEventListener('touchstart',function(e){
    if(e.cancelable)e.preventDefault();
    e.stopPropagation();
    if(tid!==null)return;                       // 同一颗按钮只认第一根手指
    var t=e.changedTouches[0];
    tid=t.identifier;
    el.classList.add('down');
    if(onDown)onDown(t);
  },{passive:false});
  el.addEventListener('touchmove',function(e){
    if(e.cancelable)e.preventDefault();
    e.stopPropagation();
    if(tid===null)return;
    for(var i=0;i<e.changedTouches.length;i++){
      var t=e.changedTouches[i];
      if(t.identifier===tid){ if(onMove)onMove(t); break; }
    }
  },{passive:false});
  function 抬(e){
    if(tid===null)return;
    var hit=false;
    for(var i=0;i<e.changedTouches.length;i++)if(e.changedTouches[i].identifier===tid)hit=true;
    if(!hit)return;
    tid=null;
    el.classList.remove('down');
    if(onUp)onUp();
  }
  el.addEventListener('touchend',function(e){e.stopPropagation();抬(e);});
  el.addEventListener('touchcancel',function(e){e.stopPropagation();抬(e);});

  /* 【1.11.0】真机上「按了一次之后这颗键就再也不响应」的根因：
     系统手势（全面屏侧滑/下拉）、来电、切后台时，touchend 可能永远不来，
     tid 一直停在旧手指的 identifier 上 → 之后任何新触摸都被 `if(tid!==null)return` 挡掉。
     暴露一个释放口，blur / 页面隐藏时统一清（见文件末尾的事件监听）。 */
  el._mobRelease=function(){
    if(tid===null)return;
    tid=null;
    el.classList.remove('down');
    if(onUp)onUp();
  };

  /* 鼠标兜底：无条件绑（原因见上面「末次触摸」那段注释） */
  el.addEventListener('mousedown',function(e){
    if(e.button!==0||!是鼠标())return;
    e.preventDefault();e.stopPropagation();
    el.classList.add('down');if(onDown)onDown(e);
  });
  el.addEventListener('mousemove',function(e){
    if(!是鼠标()||!el.classList.contains('down'))return;
    if(onMove)onMove(e);
  });
  var 起=function(){ if(!el.classList.contains('down'))return; el.classList.remove('down'); if(onUp)onUp(); };
  el.addEventListener('mouseup',function(e){e.stopPropagation();起();});
  el.addEventListener('mouseleave',起);
}

/* ---------------------------------------------------------------------------
   1. 视角转动（全屏，多指友好）
   ---------------------------------------------------------------------------
   公式和电脑端鼠标一致（js/22 的 mousemove 同款）：
       转角 = 位移 × S.sens × S.sensMul × 1.38 × 开镜减速
   开镜时减速 55%，否则开镜后拉一下就飞过头。 */
function 转视角(dx,dy){
  if(!可操作())return;
  var _sm=1-S.aimProgress*0.55;
  var k=S.sens*S.sensMul*1.38*_sm;
  yaw-=dx*k;
  pitch-=dy*k;
  pitch=Math.max(-1.4,Math.min(1.4,pitch));
  if(typeof camera!=='undefined'&&camera){
    camera.quaternion.setFromEuler(new THREE.Euler(pitch+(S.recoilPunch||0),yaw,S.roll||0,'YXZ'));
  }
}

var look=$('mobLook'),lookId=null,lookX=0,lookY=0;
if(look){
  look.addEventListener('touchstart',function(e){
    if(lookId!==null)return;
    var t=e.changedTouches[0];
    lookId=t.identifier;lookX=t.clientX;lookY=t.clientY;
  },{passive:true});
  look.addEventListener('touchmove',function(e){
    if(lookId===null)return;
    if(e.cancelable)e.preventDefault();
    for(var i=0;i<e.changedTouches.length;i++){
      var t=e.changedTouches[i];
      if(t.identifier!==lookId)continue;
      var dx=t.clientX-lookX,dy=t.clientY-lookY;
      lookX=t.clientX;lookY=t.clientY;
      转视角(dx,dy);
    }
  },{passive:false});
  function 视抬(e){
    if(lookId===null)return;
    for(var i=0;i<e.changedTouches.length;i++)if(e.changedTouches[i].identifier===lookId)lookId=null;
  }
  look.addEventListener('touchend',视抬);
  look.addEventListener('touchcancel',视抬);

  /* 【1.11.0】鼠标拖动视角（muMu / 桌面 ?touch=1）：
     模拟器里"拖屏幕转身"走的往往是 mouse 事件，以前只绑了 touch → 拖不动。
     移动监听挂在 document 上：手指/鼠标划出屏幕边缘也不会中断。 */
  look.addEventListener('mousedown',function(e){
    if(e.button!==0||!是鼠标())return;
    e.preventDefault();
    lookId='mouse';lookX=e.clientX;lookY=e.clientY;
  });
  document.addEventListener('mousemove',function(e){
    if(lookId!=='mouse'||!是鼠标())return;
    var dx=e.clientX-lookX,dy=e.clientY-lookY;
    lookX=e.clientX;lookY=e.clientY;
    if(Math.abs(dx)>0.1||Math.abs(dy)>0.1)转视角(dx,dy);
  });
  document.addEventListener('mouseup',function(){ if(lookId==='mouse')lookId=null; });
}

/* ---------------------------------------------------------------------------
   2. 动态摇杆（左 44% 全高，落指即出现）
   ---------------------------------------------------------------------------
   旧版是固定在左下角的一个圆圈，手指必须先摸到它才能走 —— 手机横屏时玩家
   拇指落点很少正好在圈里，于是"第一下没走起来"。
   新版：左半屏任意位置按下，摇杆就出现在那儿（半径按 CSS 算出来的真实值读，
   不写死像素），松手消失。推过 72% 自动疾跑。 */
var movePad=$('mobMove'),joy=$('mobJoy'),knob=$('mobJoyKnob');
var moveId=null,joyCx=0,joyCy=0,joyR=58;

function 摇杆居中(){
  if(!joy)return;
  joy.classList.remove('on');
  if(knob)knob.style.transform='translate(-50%,-50%)';
  keys.KeyW=keys.KeyS=keys.KeyA=keys.KeyD=false;
  S.joySprint=false;
}
function 摇杆算(cx,cy){
  if(!joy)return;
  var dx=cx-joyCx,dy=cy-joyCy;
  var d=Math.sqrt(dx*dx+dy*dy);
  if(d>joyR){ dx*=joyR/d; dy*=joyR/d; d=joyR; }
  if(knob)knob.style.transform='translate(calc(-50% + '+dx.toFixed(1)+'px),calc(-50% + '+dy.toFixed(1)+'px))';
  var nx=dx/joyR, ny=dy/joyR;
  /* 死区 0.26：手指轻微抖动不该让角色原地蹭步 */
  keys.KeyA=nx<-0.26; keys.KeyD=nx>0.26;
  keys.KeyW=ny<-0.26; keys.KeyS=ny>0.26;
  S.joySprint=(ny<-0.72);
}
function 摇杆起(cx,cy,id){
  if(!joy)return;
  moveId=id;
  /* 半径取 CSS 实际渲染值：设计像素 → 真机像素的换算交给浏览器，JS 不算 */
  var w=joy.offsetWidth||117;
  joyR=w*0.44;                                   // 内圆（摇杆可推动半径）≈ 视觉圈的 44%
  var pad=movePad?movePad.getBoundingClientRect():{left:0,right:window.innerWidth};
  var half=w/2+8;
  joyCx=Math.max(pad.left+half,Math.min(pad.right-half,cx));
  joyCy=Math.max(half+4,Math.min(window.innerHeight-half-4,cy));
  joy.style.left=joyCx+'px';
  joy.style.top=joyCy+'px';
  joy.classList.add('on');
  摇杆算(cx,cy);
}
if(movePad&&joy){
  movePad.addEventListener('touchstart',function(e){
    if(moveId!==null)return;
    var t=e.changedTouches[0];
    摇杆起(t.clientX,t.clientY,t.identifier);
  },{passive:true});
  movePad.addEventListener('touchmove',function(e){
    if(moveId===null)return;
    if(e.cancelable)e.preventDefault();
    for(var i=0;i<e.changedTouches.length;i++){
      var t=e.changedTouches[i];
      if(t.identifier===moveId){ 摇杆算(t.clientX,t.clientY); break; }
    }
  },{passive:false});
  var 移抬=function(e){
    if(moveId===null)return;
    for(var i=0;i<e.changedTouches.length;i++){
      if(e.changedTouches[i].identifier===moveId){ moveId=null; 摇杆居中(); break; }
    }
  };
  movePad.addEventListener('touchend',移抬);
  movePad.addEventListener('touchcancel',移抬);

  /* 【1.11.0】鼠标也能拖摇杆（muMu 模拟器 / 桌面 ?touch=1 调试）——
     以前只在"没有触摸能力"时绑，模拟器 UA 带 Android 就永远绑不上。 */
  movePad.addEventListener('mousedown',function(e){
    if(e.button!==0||!是鼠标())return;
    e.preventDefault();e.stopPropagation();
    摇杆起(e.clientX,e.clientY,'mouse');
  });
  document.addEventListener('mousemove',function(e){ if(moveId==='mouse'&&是鼠标())摇杆算(e.clientX,e.clientY); });
  document.addEventListener('mouseup',function(){ if(moveId==='mouse'){ moveId=null; 摇杆居中(); } });
}

/* ---------------------------------------------------------------------------
   3. 战斗键
   ------------------------------------------------------------------------- */
function 开火(){
  try{ initAudio(); }catch(e){}
  if(typeof audioCtx!=='undefined'&&audioCtx&&audioCtx.state==='suspended')audioCtx.resume();
  if(typeof SK!=='undefined'&&SK.ghost>0){ try{heroPortalPlace();}catch(e){} return; }   // 虚化中＝放门
  if(typeof heroBallFire==='function'&&heroBallFire())return;
  if(typeof heroAimStart==='function'&&heroAimStart())return;
  mouseDown=true;freshTrigger=true;
  if(可操作()&&typeof attack==='function')attack();
}
function 停火(){
  mouseDown=false;freshTrigger=false;
  try{ if(typeof heroAimEnd==='function')heroAimEnd(); }catch(e){}
}

/* ---- 开火键（按住连发 + 按住拖动微瞄） ---- */
var fireEl=$('mobFire'),firePX=0,firePY=0;
按住(fireEl,function(t){
  firePX=t.clientX;firePY=t.clientY;
  开火();
},function(){ 停火(); },function(t){
  /* 按住开火的同时拖动＝边打边修正，灵敏度打 55% 折（比专门转视角稳，不会一甩就脱） */
  var dx=t.clientX-firePX,dy=t.clientY-firePY;
  firePX=t.clientX;firePY=t.clientY;
  if(Math.abs(dx)>0.5||Math.abs(dy)>0.5)转视角(dx*0.55,dy*0.55);
});

/* ---- 开镜键（按住开镜）。手上有投掷物/球形闪电时＝收起技能 ---- */
var aimEl=$('mobAim');
按住(aimEl,function(){
  if(typeof SK!=='undefined'&&SK.hold){
    var _sk=(typeof heroSkill==='function')?heroSkill(SK.hold.si):{name:'技能'};
    if(SK.hold.kind==='ball'){
      SK.hold=null;SK.aimThrow=false;SK.ballLeft=0;SK.ballGap=0;
      try{heroHoldHide();heroPreviewHide();}catch(e){}
      msg('已收起「'+_sk.name+'」','#6ff0ff');
      try{heroHudUpdate(true);}catch(e){}
      return;
    }
    try{heroHoldCancel();}catch(e){}
    msg('已收起「'+_sk.name+'」','#ffd166');
    return;
  }
  S.aiming=true;
  if(aimEl)aimEl.classList.add('on');
},function(){
  S.aiming=false;
  if(aimEl)aimEl.classList.remove('on');
});

/* ---- 换弹：弹匣满了按下去没反应，给个提示免得以为键坏了 ---- */
var reloadEl=$('mobReload');
按住(reloadEl,function(){
  if(typeof S.reloading!=='undefined'&&(S.reloading||S.ammo>=S.maxAmmo)){
    msg(S.reloading?'正在换弹…':'弹匣是满的','#9fb4d6');
    return;
  }
  try{ if(typeof reload==='function')reload(); }catch(e){}
});

/* ---- 跳 ---- */
按住($('mobJump'),function(){ if(可操作())tapKey('Space'); });

/* ---- 蹲：点一下蹲、再点一下站（触屏上没有"按住不放"的余裕） ---- */
var crouchEl=$('mobCrouch'),crouchOn=false;
按住(crouchEl,function(){
  S.crouch=!S.crouch;
  if(S.crouch&&typeof sprinting_off==='function')sprinting_off();
  crouchOn=S.crouch;
  if(crouchEl){
    crouchEl.classList.toggle('on',crouchOn);
    crouchEl.textContent=crouchOn?'站':'蹲';
  }
});

/* ---- 换枪：打开武器面板 ---- */
按住($('mobSwap'),function(){ if(typeof showWeaponSelect==='function')showWeaponSelect(); });

/* ---------------------------------------------------------------------------
   3.4 左右探头（1.10.21 加回）
   ---------------------------------------------------------------------------
   电脑上是 Q / E 按住探头、松手回正；手机上给两个圆键，行为完全一致。
   ⚠️ 别用 dispatchEvent 合成 KeyQ/KeyE：js/22 的 keydown 里根本没有这两个键的分支
      （探头是 js/24 直接读 keys.KeyQ / keys.KeyE 算侧倾）。
      而 keys 上的 KeyQ/KeyE 是 defineProperty 出来的**带 setter 的别名**，
      setter 会写 _raw[KEYMAP.leanL] —— 直接赋值既能生效，又跟着"设置里改键位"走。 */
function 绑探头(id,别名){
  var el=$(id);if(!el)return;
  按住(el,function(){
    try{ keys[别名]=true; }catch(e){}
    el.classList.add('on');
  },function(){
    try{ keys[别名]=false; }catch(e){}
    el.classList.remove('on');
  });
}
绑探头('mobPeekL','KeyQ');
绑探头('mobPeekR','KeyE');

/* ---------------------------------------------------------------------------
   3.5 交互键（原「上梯」键）—— 一个键管全部"靠近才能用"的动作
   ---------------------------------------------------------------------------
   四种目标，优先级从高到低：
     ① 剧情第二章营救：走近营救点 → **按住**＝长按 F（松手缓慢回退）
     ② 载具（赛车场 / 模组）：附近有车 → 点一下上车；在车上 → 点一下下车
     ③ 经典图的爬梯：靠近梯子 → 点一下上下梯
     ④ 万圣节南瓜头：附近有瓜 → 点一下戴上；已经戴着 → 点一下摘下
        （放最后：戴着瓜走到梯子旁时，键要先给"上梯"，走开再按就是"摘瓜"）

   ⚠️ 以前这里有两个坑：
     · 显示条件只认"靠近梯子"，万圣节的提示写着「点上梯按钮」却根本没有按钮可点；
     · 营救段只要 `phase==='rescue'` 就一直亮着 —— 一进第二章屏幕中间就挂个键，
       而且和 js/60 单独控制的「救援」键重复，两个键同时出现。
   现在：**有没有目标**决定显示；营救改看 `rescueNear`（真走近了才亮）；
   救援键合并进这一个键，不再单独存在。 */
var climbEl=$('mobClimb');
var 交互态='';                       // '' | 'rescue' | 'tap'

function 交互目标(){
  /* ① 营救：条件与 js/60 里 hold 的判定同口径（走近 + 没倒地 / 没虚化） */
  try{
    if(typeof STORY_!=='undefined'&&STORY_.on&&STORY_.phase==='rescue'&&STORY_.rescueNear){
      var 不能=!!(typeof SK!=='undefined'&&SK&&((SK.downed||0)>0||(SK.ghost||0)>0));
      if(!不能)return {kind:'rescue',label:'救援'};
    }
  }catch(e){}
  /* ② 载具：现在游戏里没有入口，留给赛车场 / 模组；没这系统时整段跳过 */
  try{
    if(typeof 载具!=='undefined'&&载具){
      if(typeof 载具.在开车==='function'&&载具.在开车())return {kind:'tap',label:'下车'};
      if(typeof camera!=='undefined'&&camera&&typeof 载具.最近的车==='function'&&
         载具.最近的车(camera.position.x,camera.position.z,4.2))return {kind:'tap',label:'上车'};
    }
  }catch(e){}
  /* ③ 爬梯：和电脑端 F 的判定同一套变量，半径放宽到 2.2（手指没有准星那么准） */
  try{
    if(typeof MAP_HAS_LADDER!=='undefined'&&MAP_HAS_LADDER&&typeof camera!=='undefined'&&camera&&
       typeof LADDER_X!=='undefined'&&
       Math.abs(camera.position.x-LADDER_X)<2.2&&Math.abs(camera.position.z-LADDER_Z)<2.2)
      return {kind:'tap',label:'上梯'};
  }catch(e){}
  /* ④ 南瓜头：js/67 自己监听 KeyF，这里只负责把键亮出来、文字对上。
     ⚠️ 排在梯子后面：戴着瓜走到梯子旁要先能上梯，摘瓜走开再按就有 */
  try{
    if(typeof 万圣节_已戴==='function'&&万圣节_已戴())return {kind:'tap',label:'摘瓜'};
    if(typeof 万圣节_最近==='function'&&万圣节_最近())return {kind:'tap',label:'戴瓜'};
  }catch(e){}
  return null;
}

var 交互按下='';
按住(climbEl,function(){
  var tg=交互目标();
  交互按下=tg?tg.kind:'';
  if(tg&&tg.kind==='rescue'){
    keys.KeyF=true;                  // 长按：js/60 的 rescueP 自己累积
  }else{
    tapKey('KeyF');                  // 点按：走真实键盘流程，万圣节 / 载具 / 梯子各自处理
  }
},function(){
  if(交互按下==='rescue')keys.KeyF=false;
  交互按下='';
});

/* ---- 暂停 ---- */
按住($('mobPause'),function(){ if(typeof openGameMenu==='function')openGameMenu(); });

/* ---------------------------------------------------------------------------
   4. 键盘事件补丁：触屏按钮靠 tapKey 走真实键盘流程
   ------------------------------------------------------------------------- */
function tapKey(code){
  try{ document.dispatchEvent(new KeyboardEvent('keydown',{code:code,bubbles:true})); }catch(e){}
  setTimeout(function(){
    try{ document.dispatchEvent(new KeyboardEvent('keyup',{code:code,bubbles:true})); }catch(e){}
  },60);
}

/* ---------------------------------------------------------------------------
   5. 技能 HUD 直接可点
   ---------------------------------------------------------------------------
   `#skillHud` 里就是 3 个 .skSlot，和施法顺序一一对应。
   事件委托绑在容器上：HUD 内部是 innerHTML 重建的，绑到槽位上会丢。
   ⚠️ 必须判断"是不是点在槽位上"：HUD 之间的空隙不能吞掉视角拖动。 */
var hud=$('skillHud');
if(hud){
  var hudId=null;
  /* ⚠️ 不用 el.closest()：老 WebView（Chrome 41 以前）没有这个方法，
     一行 closest 就能让整个技能点击在旧机型上全废。手写向上找，四行而已。 */
  function 找槽(el){
    while(el&&el!==hud){
      if(el.className&&String(el.className).indexOf('skSlot')>=0)return el;
      el=el.parentElement;
    }
    return null;
  }
  hud.addEventListener('touchstart',function(e){
    var slot=找槽(e.target);
    if(!slot)return;                       // 点在空隙＝放过去，让下面的视角区收
    e.preventDefault();e.stopPropagation();
    hudId=e.changedTouches[0].identifier;
    slot.classList.add('press');
  },{passive:false});
  var hud抬=function(e){
    if(hudId===null)return;
    var 中=false;
    for(var i=0;i<e.changedTouches.length;i++)if(e.changedTouches[i].identifier===hudId)中=true;
    if(!中)return;
    hudId=null;
    var all=hud.querySelectorAll('.skSlot');
    for(var j=0;j<all.length;j++)all[j].classList.remove('press');
  };
  hud.addEventListener('touchend',function(e){
    if(hudId===null)return;
    e.stopPropagation();
    var slot=找槽(e.target);
    hud抬(e);
    if(!slot)return;
    var idx=parseInt(String(slot.id||'').replace('skSlot',''),10);
    if(isNaN(idx))return;
    if(!可操作())return;
    try{ if(typeof heroCast==='function')heroCast(idx); }catch(_e){}
  });
  hud.addEventListener('touchcancel',hud抬);
}

/* ---------------------------------------------------------------------------
   6. 每帧对账：状态被别处改掉时，按钮外观要跟上
   ---------------------------------------------------------------------------
   ⚠️ 这条不能省。换英雄、死亡复活、剧情重开都会直接把 S/SK 重置，
   如果按钮外观只在自己被按的时候更新，就会出现"显示蹲着、其实站着"。 */
var _对账=0;
function 界面对账(){
  var now=performance.now();
  if(now-_对账<140)return;
  _对账=now;
  /* 蹲 */
  if(crouchEl){
    var 蹲=!!S.crouch;
    if(蹲!==crouchOn){
      crouchOn=蹲;
      crouchEl.classList.toggle('on',蹲);
      crouchEl.textContent=蹲?'站':'蹲';
    }
  }
  /* 交互键：有目标才亮。⚠️ 编辑模式别碰它 —— 那边用 CSS !important 强制显示，
     这里再写内联 display 等于每秒把它藏回去，用户就摸不到这个键了。 */
  if(climbEl&&!按键编辑中){
    var tg=交互目标();
    if(tg){
      交互态=tg.kind;
      if(climbEl.style.display!=='flex')climbEl.style.display='flex';
      if(climbEl.textContent!==tg.label)climbEl.textContent=tg.label;
    }else{
      交互态='';
      if(climbEl.style.display!=='none')climbEl.style.display='none';
    }
  }
  /* 【1.11.0】技能 HUD 是 innerHTML 重建的（js/41 每次换英雄/刷新都会重画），
     重建后 inline 定位和 .mobPos 全丢 → 用户拖好的技能位置会"自己弹回去"。
     这里只补"有条目但 class 丢了"的槽，避免每 140ms 白写一遍样式。 */
  for(var si=0;si<3;si++){
    var sid='skSlot'+si;
    if(!布局表[sid])continue;
    var se=$(sid);
    if(se&&!se.classList.contains('mobPos'))应用一项(sid);
  }
  /* 聊天 / 语音两个键是 js/62 动态建的，可能比这个脚本晚 —— 建好后补一次自定义样式 */
  var _cb=$('chatBtn'),_vb=$('voiceBtn');
  if(_cb&&_cb.getAttribute('data-moblay')!=='1'){_cb.setAttribute('data-moblay','1');应用一项('chatBtn');}
  if(_vb&&_vb.getAttribute('data-moblay')!=='1'){_vb.setAttribute('data-moblay','1');应用一项('voiceBtn');}
}

/* ---------------------------------------------------------------------------
   4.5 按键设置：位置 / 大小 / 透明度（1.10.19）
   ---------------------------------------------------------------------------
   【为什么用 CSS 变量 + 百分比，而不是直接写像素】
     · 大小/透明度写在元素内联 style 的 --ks / --ka 上，CSS 里 transform/opacity 读它们：
       `.down` 的按压反馈还能叠乘（scale(calc(var(--ks,1)*.91))），不会互相覆盖；
     · 位置写 left/top 的**中心点百分比** + `.mobPos` 的 translate(-50%,-50%)：
       换屏幕比例、换分辨率都不跑偏，也不跟 --u 的等比缩放打架；
     · 只存用户改过的项 —— 没改的继续走 CSS 默认布局，默认值和以前一模一样。

   【编辑模式怎么不误触】
     用 document 上的**捕获阶段**监听统一接管触摸：父级捕获先于元素自身的目标阶段执行，
     所以能一次性拦掉开火、跳、摇杆、视角。底部操作条自己放行（滑块要能拖）。 */
var 布局键='gunGame.mobKeys.v1';
var 布局表={};
var 可编辑名={mobFire:'开火',mobAim:'开镜',mobReload:'换弹',mobJump:'跳跃',mobCrouch:'蹲下',
  mobSwap:'换枪',mobClimb:'交互',mobPeekL:'左探头',mobPeekR:'右探头',
  mobPause:'菜单',chatBtn:'发消息',voiceBtn:'开麦',minimap:'小地图',
  /* 【1.11.0】三个技能槽单独可调（用户："无法单独调整某个技能位置"）。
     id 由 js/41 生成 skillHud 时写死（skSlot0/1/2）。 */
  skSlot0:'技能①',skSlot1:'技能②',skSlot2:'技能③'};
var 可编辑=[['mobFire','开火'],['mobAim','开镜'],['mobReload','换弹'],['mobJump','跳跃'],
  ['mobCrouch','蹲下'],['mobSwap','换枪'],['mobClimb','交互'],
  ['mobPeekL','左探头'],['mobPeekR','右探头'],
  ['mobPause','菜单'],['chatBtn','发消息'],['voiceBtn','开麦'],['minimap','小地图'],
  ['skSlot0','技能①'],['skSlot1','技能②'],['skSlot2','技能③']];
/* 技能槽是 position:fixed、以**视口**为坐标 → 百分比基准不能用父层（#skillHud 会塌陷） */
function 是技能(id){ return id==='skSlot0'||id==='skSlot1'||id==='skSlot2'; }

var 按键编辑中=false, 选中键=null, 拖动=null;

function 读数(){
  try{
    var t=JSON.parse(localStorage.getItem(布局键)||'{}');
    布局表=(t&&typeof t==='object')?t:{};
  }catch(e){ 布局表={}; }
}
function 存数(){ try{ localStorage.setItem(布局键,JSON.stringify(布局表)); }catch(e){} }

function 应用一项(id){
  var el=$(id);if(!el)return;
  var o=布局表[id];
  if(o&&o.x!=null&&o.y!=null){
    el.classList.add('mobPos');
    el.style.right='auto';el.style.bottom='auto';
    el.style.left=o.x+'%';el.style.top=o.y+'%';
    el.style.setProperty('--ks',o.s||1);
    el.style.setProperty('--ka',(o.a==null?1:o.a));
  }else{
    el.classList.remove('mobPos');
    el.style.left='';el.style.top='';el.style.right='';el.style.bottom='';
    el.style.removeProperty('--ks');el.style.removeProperty('--ka');
  }
}
function 应用布局(){ for(var i=0;i<可编辑.length;i++)应用一项(可编辑[i][0]); }
function 全部复位(){ 布局表={};技能已固定=false;应用布局();存数();选中键刷新(); }

/* 【1.10.22】百分比的基准。
   以前一律除以 window.innerWidth/innerHeight —— 那只对 #touchUI 里的按键成立。
   #hud 从 1.10.22 起整层 transform:scale(--hudk) 缩小，它的布局宽是"视口/--hudk"
   （虚拟画布 100%/k），小地图就住在里面：还按真实视口算，拖 100px 会被记成
   "100/视口"的百分比，实际却作用在虚拟宽上 → 位置越拖越偏。
   解决：一切以"最近的定位祖先"为基准 —— 它的**布局尺寸**算百分比，
   它的**视觉 rect**算拖动位移，两者比例天然一致（缩放多少都不影响）。 */
function 父层(el){
  /* 【1.11.0】技能槽是 position:fixed、相对**视口**定位；
     #skillHud 容器在三个槽都脱离 flex 后会塌陷，拿它当基准百分比会全错。 */
  if(el&&是技能(el.id))return null;
  var p=el&&el.offsetParent;
  if(!p||p===document.body)return null;
  return p;
}
function 基宽(el){
  var p=父层(el);
  return (p&&p.offsetWidth>0)?p.offsetWidth:(window.innerWidth||1);
}
function 基高(el){
  var p=父层(el);
  return (p&&p.offsetHeight>0)?p.offsetHeight:(window.innerHeight||1);
}
/* 父层在屏幕上的视觉宽高（拖动位移用：dx 是视觉像素） */
function 视宽(el){ var p=父层(el); var r=p?p.getBoundingClientRect():null; return (r&&r.width>0)?r.width:(window.innerWidth||1); }
function 视高(el){ var p=父层(el); var r=p?p.getBoundingClientRect():null; return (r&&r.height>0)?r.height:(window.innerHeight||1); }

/* 把 CSS 的 right/bottom 定位换成"中心点百分比"。不换的话拖动第一下会跳。
   ⚠️ 必须先量再改：`.mobPos` 的 translate 带 0.07s 过渡，改完立刻读 rect
   拿到的是过渡中途的值（会偏半个按钮高），所以中心点用**改之前**的 rect 算，
   并且把算出来的值传出去给 当前项 用。 */
function 中心化(el){
  if(!el)return null;
  var r=el.getBoundingClientRect();
  if(!r.width||!r.height)return null;
  var p=父层(el), pr=p?p.getBoundingClientRect():null;
  var L=pr?pr.left:0, T=pr?pr.top:0;
  var x=+((r.left+r.width/2-L)/视宽(el)*100).toFixed(2);
  var y=+((r.top +r.height/2-T)/视高(el)*100).toFixed(2);
  if(!el.classList.contains('mobPos')){
    /* 临时关掉过渡：translate 的 0.07s 会让"改完立刻读"拿到中途值 */
    var 旧过渡=el.style.transition;
    el.style.transition='none';
    el.style.right='auto';el.style.bottom='auto';
    el.style.left=x+'%';el.style.top=y+'%';
    el.classList.add('mobPos');
    void el.offsetWidth;
    el.style.transition=旧过渡;
  }
  return {x:x,y:y};
}
/* 拿（必要时新建）这一项的设置；只调大小/透明度也要建条目，否则滑块改了存不下来 */
function 当前项(已量){
  if(!选中键||!选中键.id)return null;
  var id=选中键.id;
  if(!布局表[id]){
    var c=已量||中心化(选中键)||{x:50,y:50};
    布局表[id]={x:c.x,y:c.y,s:1,a:1};
  }
  return 布局表[id];
}
function 选中键刷新(){
  var 名=$('mobEditName'),sz=$('mobEditSize'),sa=$('mobEditAlpha'),
      sv=$('mobEditSizeVal'),av=$('mobEditAlphaVal');
  if(!选中键){
    if(名)名.textContent='未选中';
    if(sz)sz.value=100;if(sa)sa.value=100;
    if(sv)sv.textContent='—';if(av)av.textContent='—';
    return;
  }
  var o=布局表[选中键.id]||{s:1,a:1};
  if(名)名.textContent=可编辑名[选中键.id]||选中键.id;
  var svv=Math.round((o.s==null?1:o.s)*100), avv=Math.round((o.a==null?1:o.a)*100);
  if(sz)sz.value=svv;if(sa)sa.value=avv;
  if(sv)sv.textContent=svv+'%';if(av)av.textContent=avv+'%';
}
/* 【1.11.0】三个技能槽原来在 #skillHud 里用 flex 排一排。单独拖某一个时，
   它一旦变成 fixed 脱离 flex，剩下两个会立刻重排 → 位置跳变。
   所以"第一次拖技能"时先把三个槽的**当前视觉位置**全部量下来，再一起转成 fixed。
   ⚠️ 必须先全部量完再应用：边量边改会让后量的那两个读到重排后的坐标。 */
var 技能已固定=false;
function 技能全转固定(){
  if(技能已固定)return;
  技能已固定=true;
  var 量=[],VW=window.innerWidth||1,VH=window.innerHeight||1;
  for(var i=0;i<3;i++){
    var id='skSlot'+i, e2=$(id);
    if(!e2||布局表[id])continue;
    var r=e2.getBoundingClientRect();
    if(!r.width||!r.height)continue;
    量.push({id:id,x:+((r.left+r.width/2)/VW*100).toFixed(2),y:+((r.top+r.height/2)/VH*100).toFixed(2)});
  }
  for(var j=0;j<量.length;j++){
    布局表[量[j].id]={x:量[j].x,y:量[j].y,s:1,a:1};
    应用一项(量[j].id);
  }
}
function 技能复位(){
  技能已固定=false;
  for(var i=0;i<3;i++){ delete 布局表['skSlot'+i]; 应用一项('skSlot'+i); }
}
function 选中元素(el){
  if(选中键&&选中键!==el)选中键.classList.remove('mobSel');
  选中键=el;
  if(el){
    if(是技能(el.id))技能全转固定();      // 先批量转 fixed，再选中
    el.classList.add('mobSel');
    /* ⚠️ 中心点必须用"改之前"量到的那个：中心化 之后再读一次 rect 会拿到过渡中途值 */
    var c=中心化(el);
    当前项(c);                      // 建条目，位置就定在这儿
  }
  选中键刷新();
}

/* 从触摸目标往上找可编辑元素（不用 closest：老 WebView 没有这个方法） */
function 找可编辑(el){
  while(el&&el!==document.body){
    if(el.id&&可编辑名[el.id])return el;
    el=el.parentElement;
  }
  return null;
}
/* 拖动边界：按元素**自身半宽/半高**算，别让按钮一半跑到屏幕外。
   offsetWidth 不含 transform:scale，所以乘上用户设的大小倍率才是真实视觉半径；
   分母用父层布局尺寸（#hud 缩放后是虚拟画布，和 left/top 的百分比同一套坐标）。 */
function 屏内X(el,v){
  var k=(布局表[el.id]&&布局表[el.id].s)||1;
  var 半=el.offsetWidth*k/2/基宽(el)*100;
  return Math.max(Math.min(半,45),Math.min(100-Math.min(半,45),v));
}
function 屏内Y(el,v){
  var k=(布局表[el.id]&&布局表[el.id].s)||1;
  var 半=el.offsetHeight*k/2/基高(el)*100;
  return Math.max(Math.min(半,45),Math.min(100-Math.min(半,45),v));
}

/* 统一接管：捕获阶段，先于任何按钮自身的 touchstart */
function 编辑放下(cx,cy,target){
  var el=找可编辑(target);
  if(!el)return false;
  选中元素(el);
  var o=当前项();if(!o)return false;
  拖动={id:el.id,el:el,px:cx,py:cy,x0:o.x,y0:o.y};
  return true;
}
function 编辑移动(cx,cy){
  if(!拖动)return;
  var o=布局表[拖动.id];if(!o)return;
  /* 位移是视觉像素 → 除以父层的**视觉**宽高，才和 left/top 的百分比同口径 */
  o.x=+屏内X(拖动.el,拖动.x0+(cx-拖动.px)/视宽(拖动.el)*100).toFixed(2);
  o.y=+屏内Y(拖动.el,拖动.y0+(cy-拖动.py)/视高(拖动.el)*100).toFixed(2);
  拖动.el.style.left=o.x+'%';
  拖动.el.style.top=o.y+'%';
}
function 编辑抬起(){ if(拖动){拖动=null;存数();} }

var 编辑条=$('mobEditBar');
function 在操作条里(t){ return !!(编辑条&&t&&编辑条.contains(t)); }

document.addEventListener('touchstart',function(e){
  if(!按键编辑中)return;
  if(在操作条里(e.target))return;                 // 底部滑块 / 按钮放行
  if(e.cancelable)e.preventDefault();
  e.stopPropagation();
  var t=e.changedTouches[0];
  if(t)编辑放下(t.clientX,t.clientY,e.target);
},true);
document.addEventListener('touchmove',function(e){
  if(!按键编辑中||!拖动)return;
  if(e.cancelable)e.preventDefault();
  e.stopPropagation();
  var t=e.changedTouches[0];
  if(t)编辑移动(t.clientX,t.clientY);
},true);
document.addEventListener('touchend',function(e){
  if(!按键编辑中)return;
  if(在操作条里(e.target))return;
  e.stopPropagation();
  编辑抬起();
},true);
document.addEventListener('touchcancel',function(){ if(按键编辑中)编辑抬起(); },true);

/* 电脑上 ?touch=1 调试：鼠标也能拖 */
document.addEventListener('mousedown',function(e){
  if(!按键编辑中||在操作条里(e.target))return;
  e.preventDefault();e.stopPropagation();
  if(编辑放下(e.clientX,e.clientY,e.target)){
    var mv=function(ev){编辑移动(ev.clientX,ev.clientY);};
    var up=function(){编辑抬起();document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  }
},true);

/* ---- 进入 / 退出 ---- */
function 按键设置(开){
  开=!!开;
  if(开===按键编辑中)return;
  按键编辑中=开;
  try{ document.body.classList.toggle('mob-edit',开); }catch(e){}
  if(开){
    try{ if(typeof openSettings==='function')openSettings(false); }catch(e){}
    /* 进来先把"按住"状态全清掉，否则角色会一直往前走 / 一直开枪 */
    moveId=null;摇杆居中();lookId=null;
    try{ S.aiming=false; }catch(e){}
    mouseDown=false;freshTrigger=false;
    if(aimEl)aimEl.classList.remove('on');
    应用布局();
    窗位应用();                     /* 【1.11.0】设置小窗回到上次拖到的位置 */
    选中元素($('mobFire')||null);
  }else{
    存数();
    编辑抬起();
    if(选中键)选中键.classList.remove('mobSel');
    选中键=null;
    选中键刷新();
    /* 退出后让交互键立刻回到"该藏就藏"，不用等下一次对账 */
    交互态='';
  }
}
window.mobKeySettings=按键设置;

(function 绑编辑按钮(){
  var b=$('spMobKeys');if(b)b.addEventListener('click',function(e){e.preventDefault();按键设置(true);});
  /* 【1.10.21】暂停菜单 / 主菜单里的直达入口：不用先开设置面板，
     点一下直接进编辑层（进之前 openSettings(false) 会把设置关掉，菜单由 CSS 藏起来）。 */
  var pb=$('mobKeyBtn');if(pb)pb.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();按键设置(true);});
  var mb2=$('mobKeyBtn2');if(mb2)mb2.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();按键设置(true);});
  var d=$('mobEditDone');if(d)d.addEventListener('click',function(e){e.preventDefault();按键设置(false);});
  var r=$('mobEditReset');if(r)r.addEventListener('click',function(e){
    e.preventDefault();
    if(!选中键)return;
    /* 技能三个是一组：单复位一个会让另外两个留在 fixed 上错位 → 整组复位 */
    if(是技能(选中键.id)){ 技能复位(); 选中键刷新(); 存数(); return; }
    delete 布局表[选中键.id];
    应用一项(选中键.id);
    选中键刷新();
    存数();
  });
  var ra=$('mobEditResetAll');if(ra)ra.addEventListener('click',function(e){e.preventDefault();全部复位();});
  var sz=$('mobEditSize');if(sz)sz.addEventListener('input',function(){
    var o=当前项();if(!o)return;
    o.s=+sz.value/100;
    选中键.style.setProperty('--ks',o.s);
    var v=$('mobEditSizeVal');if(v)v.textContent=sz.value+'%';
    存数();
  });
  var sa=$('mobEditAlpha');if(sa)sa.addEventListener('input',function(){
    var o=当前项();if(!o)return;
    o.a=+sa.value/100;
    选中键.style.setProperty('--ka',o.a);
    var v=$('mobEditAlphaVal');if(v)v.textContent=sa.value+'%';
    存数();
  });
})();

读数();
应用布局();

/* ---------------------------------------------------------------------------
   4.6 设置小窗：拖标题栏移动 + 位置记忆（1.11.0）
   ---------------------------------------------------------------------------
   窗口位置存**百分比**（不是像素）：换分辨率、转屏、改窗口大小都不会跑到屏幕外。
   位置只影响这个小窗，不影响按键布局。 */
var 窗位键='gunGame.mobEditWin.v1';
function 窗位读(){
  try{ var v=JSON.parse(localStorage.getItem(窗位键)||'null'); return (v&&typeof v.x==='number')?v:null; }catch(e){ return null; }
}
function 窗位应用(){
  var bar=$('mobEditBar');if(!bar)return;
  var w=窗位读();
  if(!w){
    var r=bar.getBoundingClientRect();
    if(!r.width)return;
    w={x:+((r.left+r.width/2)/(window.innerWidth||1)*100).toFixed(2),
       y:+((r.top+r.height/2)/(window.innerHeight||1)*100).toFixed(2)};
  }
  bar.style.left=w.x+'%';bar.style.top=w.y+'%';bar.style.transform='translate(-50%,-50%)';
}
(function 绑窗拖动(){
  var bar=$('mobEditBar'),tip=$('mobEditTip');
  if(!bar||!tip)return;
  var 起=null;
  function 下(cx,cy){
    var r=bar.getBoundingClientRect();if(!r.width)return;
    var vw=window.innerWidth||1,vh=window.innerHeight||1;
    起={cx:cx,cy:cy,l:r.left,t:r.top,w:r.width,h:r.height,
        x:(r.left+r.width/2)/vw*100,y:(r.top+r.height/2)/vh*100};
  }
  function 动(cx,cy){
    if(!起)return;
    var vw=window.innerWidth||1,vh=window.innerHeight||1;
    var x=(起.x*vw/100+(cx-起.cx))/vw*100, y=(起.y*vh/100+(cy-起.cy))/vh*100;
    x=Math.max(4,Math.min(96,x));y=Math.max(6,Math.min(94,y));   // 别拖出屏幕
    起.x=x;起.y=y;
    bar.style.left=x.toFixed(2)+'%';bar.style.top=y.toFixed(2)+'%';
    bar.style.transform='translate(-50%,-50%)';
  }
  function 抬(){
    if(!起)return;
    try{ localStorage.setItem(窗位键,JSON.stringify({x:+起.x.toFixed(2),y:+起.y.toFixed(2)})); }catch(e){}
    起=null;
  }
  tip.addEventListener('touchstart',function(e){
    if(e.cancelable)e.preventDefault();e.stopPropagation();
    var t=e.changedTouches[0];if(t)下(t.clientX,t.clientY);
  },{passive:false});
  tip.addEventListener('touchmove',function(e){
    if(!起)return;
    if(e.cancelable)e.preventDefault();e.stopPropagation();
    var t=e.changedTouches[0];if(t)动(t.clientX,t.clientY);
  },{passive:false});
  tip.addEventListener('touchend',function(e){e.stopPropagation();抬();});
  tip.addEventListener('touchcancel',function(){抬();});
  /* 鼠标（muMu / 桌面 ?touch=1）同样能拖 */
  tip.addEventListener('mousedown',function(e){
    if(e.button!==0||!是鼠标())return;
    e.preventDefault();e.stopPropagation();
    下(e.clientX,e.clientY);
    var mv=function(ev){动(ev.clientX,ev.clientY);};
    var up=function(){抬();document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  });
})();

/* ---------------------------------------------------------------------------
   7. 旧接口保留（别的分片会调用）
   ------------------------------------------------------------------------- */
/* js/23 的 applyTuning / 设置面板会调这两个。新布局不接受手工编辑，
   但"界面大小"倍率仍要生效 —— 那个走 --uiz，不归这里管。 */
window.layoutFit=function(){};
window.layoutClampAll=function(){};
window.layoutApply=function(){};
window.layoutCollect=function(){return {};};
window.layoutDesign=function(){return {};};
window.layoutSave=function(){};
window.layoutResetAll=function(){};
window.setLayoutEdit=function(){};
window.beginLayoutFromMenu=function(){};
/* ⚠️ 必须挂 window：这个 IIFE 里的 `var layoutEdit` 是**局部**变量，
   js/60 读的是全局的那个，写成本地变量等于没定义（typeof 会变成 undefined）。 */
window.layoutEdit=false;

/* ---------------------------------------------------------------------------
   8. 主循环挂载
   ------------------------------------------------------------------------- */
(function 循环(){
  try{ 界面对账(); }catch(e){}
  requestAnimationFrame(循环);
})();

/* 转屏：摇杆正在进行时强行位移会错位，直接收掉重来 */
window.addEventListener('orientationchange',function(){ moveId=null; 摇杆居中(); lookId=null; });

/* 失焦（切后台 / 来电 / 系统手势）：把所有"按住"状态清干净，否则回来角色会一直往前走，
   更糟的是某颗按钮的 tid 卡在旧手指上 —— 那颗键之后**永远不响应**（真机高发）。 */
function 全部松开(){
  moveId=null;摇杆居中();lookId=null;
  try{ S.aiming=false; }catch(e){}
  mouseDown=false;freshTrigger=false;
  if(aimEl)aimEl.classList.remove('on');
  /* 探头是"按住"状态，切后台必须手动松开，否则回来角色一直歪着 */
  try{ keys.KeyQ=false; keys.KeyE=false; }catch(e){}
  var _pl=$('mobPeekL'),_pr=$('mobPeekR');
  if(_pl)_pl.classList.remove('on');
  if(_pr)_pr.classList.remove('on');
  /* 【1.11.0】逐颗按钮释放（清 tid / 移除 .down） */
  try{
    var _bs=document.querySelectorAll('#touchUI .mobBtn,#mobPause');
    for(var _i=0;_i<_bs.length;_i++){ if(_bs[_i]&&_bs[_i]._mobRelease)_bs[_i]._mobRelease(); }
  }catch(e){}
}
window.addEventListener('blur',全部松开);
/* 安卓/iOS 切到后台时不一定触发 blur（尤其是全屏 WebView）→ 补一条页面隐藏 */
document.addEventListener('visibilitychange',function(){ if(document.hidden)全部松开(); });

try{ if(typeof 界面对账==='function')界面对账(); }catch(e){}
})();
