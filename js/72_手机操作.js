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
function 可操作(){ return !!S && S.playing && !S.paused && !S.over; }
function 有原生触摸(){ return ('ontouchstart' in window) || (navigator.maxTouchPoints||0)>0; }

/* ---------------------------------------------------------------------------
   0. 触摸 / 鼠标统一绑定
   ---------------------------------------------------------------------------
   为什么不用 click：click 在移动端有 300ms 判定（要区分单击和双击缩放），
   开火、跳跃这种要求"按下即生效"的动作等不起。全部走 touchstart/touchend。
   电脑上用 ?touch=1 调试时没有触摸事件，补一套 mousedown/mouseup 兜底 ——
   但只在**确实没有触摸能力**时才绑，真手机不会绑，绝不双触发。 */
var 有触摸=有原生触摸();

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

  if(!有触摸){
    el.addEventListener('mousedown',function(e){
      if(e.button!==0)return;
      e.preventDefault();e.stopPropagation();
      el.classList.add('down');if(onDown)onDown(e);
    });
    el.addEventListener('mousemove',function(e){ if(onMove&&el.classList.contains('down'))onMove(e); });
    var 起=function(){ if(!el.classList.contains('down'))return; el.classList.remove('down'); if(onUp)onUp(); };
    el.addEventListener('mouseup',function(e){e.stopPropagation();起();});
    el.addEventListener('mouseleave',起);
  }
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

  /* 电脑上 ?touch=1 调试：鼠标也能拖摇杆 */
  if(!有触摸){
    movePad.addEventListener('mousedown',function(e){
      if(e.button!==0)return;e.preventDefault();e.stopPropagation();
      摇杆起(e.clientX,e.clientY,'mouse');
    });
    document.addEventListener('mousemove',function(e){ if(moveId==='mouse')摇杆算(e.clientX,e.clientY); });
    document.addEventListener('mouseup',function(){ if(moveId==='mouse'){ moveId=null; 摇杆居中(); } });
  }
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

/* ---- 上梯 / 救援：靠近梯子才出现；剧情第二章营救阶段按住＝长按 F ---- */
var climbEl=$('mobClimb');
按住(climbEl,function(){
  if(typeof STORY_!=='undefined'&&STORY_.on&&STORY_.ch===2&&STORY_.phase==='rescue'){
    keys.KeyF=true;
    if(climbEl)climbEl.textContent='救援';
  }else{
    tapKey('KeyF');
  }
},function(){
  if(typeof STORY_!=='undefined'&&STORY_.on&&STORY_.ch===2&&STORY_.phase==='rescue'){
    keys.KeyF=false;
    if(climbEl)climbEl.textContent='上梯';
  }
});

/* ---- 营救：按住＝长按 F（由 js/60 控制显隐） ---- */
按住($('mobRescue'),function(){ keys.KeyF=true; },function(){ keys.KeyF=false; });

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
  /* 上梯键：靠近梯子才出现（和电脑端 F 键的判定同口径） */
  if(climbEl){
    var 梯=false;
    try{
      if(typeof MAP_HAS_LADDER!=='undefined'&&MAP_HAS_LADDER&&typeof camera!=='undefined'&&camera&&typeof LADDER_X!=='undefined'){
        梯=Math.abs(camera.position.x-LADDER_X)<2.2&&Math.abs(camera.position.z-LADDER_Z)<2.2;
      }
    }catch(e){}
    if(typeof STORY_!=='undefined'&&STORY_.on&&STORY_.ch===2&&STORY_.phase==='rescue')梯=true;
    climbEl.style.display=梯?'flex':'none';
  }
}

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

/* 失焦（切后台 / 来电）：把所有"按住"状态清干净，否则回来角色会一直往前走 */
window.addEventListener('blur',function(){
  moveId=null;摇杆居中();lookId=null;
  S.aiming=false;mouseDown=false;
  if(aimEl)aimEl.classList.remove('on');
});

try{ if(typeof 界面对账==='function')界面对账(); }catch(e){}
})();
