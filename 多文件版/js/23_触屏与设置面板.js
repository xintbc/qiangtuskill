// ==================== 触屏操作 + 音效 ====================
var audioCtx=null,noiseBuf=null,lastCrack=0;
function initAudio(){try{if(!audioCtx){audioCtx=new (window.AudioContext||window.webkitAudioContext)();var len=Math.floor(audioCtx.sampleRate*0.3);noiseBuf=audioCtx.createBuffer(1,len,audioCtx.sampleRate);var d=noiseBuf.getChannelData(0);for(var i=0;i<len;i++)d[i]=Math.random()*2-1;}if(audioCtx&&audioCtx.state==='suspended')audioCtx.resume();}catch(e){}}
function noiseHit(dur,freq,q,vol,type){if(!audioCtx||!noiseBuf)return;try{var t=audioCtx.currentTime;var src=audioCtx.createBufferSource();src.buffer=noiseBuf;var f=audioCtx.createBiquadFilter();f.type=type||'lowpass';f.frequency.value=freq;if(q)f.Q.value=q;var g=audioCtx.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);src.connect(f);f.connect(g);g.connect(audioCtx.destination);src.start(t);src.stop(t+dur);}catch(e){}}
function volAt(pos,base){if(!pos||!camera)return base;var d=camera.position.distanceTo(pos);var v=base*(1-d/95);return Math.max(0.02,Math.min(base,v));}
function playShot(vol){noiseHit(0.18,2000,0,vol==null?0.5:vol,'lowpass');}
function playEnemyShot(pos){noiseHit(0.16,1300,0,volAt(pos,0.4),'lowpass');}
function playStep(){noiseHit(0.09,420,0,0.16,'lowpass');}
function playCrack(){noiseHit(0.06,5200,6,0.34,'bandpass');}
/* ==================== 【batch209/210】拉栓 / 换弹音效 ====================
   —— 上一版为什么"不真实" ——
   ① 用的是方波振荡器 + 单层带通噪声：方波听起来是"哔"，不是"咔"；
   ② 几层音靠 `setTimeout` 拼，主线程一卡（渲染一帧 16ms 起）层与层之间就会被挤开几十毫秒，
      听起来像"两个声音"而不是"一个动作"；
   ③ 每次都是同一个音高、同一个音量，连着换两次弹完全一样 —— 真枪每次都有细微差别。
   —— 现在的做法 ——
   一次机械动作的声音在物理上就是三层叠出来的：
     ① **冲击**：极短的高通/带通噪声，决定"硬不硬"（2~50ms）；
     ② **金属余鸣**：2~3 个失谐正弦各自快速衰减，决定"是不是钢"；
     ③ **结构闷响**：低频正弦下扫，决定"重不重"。
   三层全部用 `audioCtx` 的时钟排程（`start(t0)` / `setValueAtTime(t0)`），
   主线程再卡也不会散架；每次调用给音高 ±4%、音量 ±10% 的随机量，重复播放不会"复读"。
   刮擦声用**一串带抖动的颗粒**而不是一整段噪声 —— 金属滑动本来就是"沙沙沙"的颗粒感。 */
function toneHit(freq,dur,vol,type,slideTo){
  if(!audioCtx)return;
  try{
    var t=audioCtx.currentTime;
    var o=audioCtx.createOscillator();o.type=type||'triangle';
    o.frequency.setValueAtTime(Math.max(20,freq),t);
    if(slideTo)o.frequency.exponentialRampToValueAtTime(Math.max(20,slideTo),t+dur);
    var g=audioCtx.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002,vol),t+0.003);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g);g.connect(audioCtx.destination);o.start(t);o.stop(t+dur+0.02);
  }catch(e){}
}
/* ① 冲击：带通/低通噪声，可带频率扫动（f1→f2）。t0 是 audioCtx 时间轴上的绝对时刻 */
function _噪击(t0,dur,f1,f2,q,vol,type){
  if(!audioCtx||!noiseBuf)return;
  try{
    var src=audioCtx.createBufferSource();src.buffer=noiseBuf;
    var f=audioCtx.createBiquadFilter();
    f.type=type||'bandpass';
    f.frequency.setValueAtTime(Math.max(40,f1),t0);
    if(f2)f.frequency.exponentialRampToValueAtTime(Math.max(40,f2),t0+dur*0.92);
    f.Q.value=q||1;
    var g=audioCtx.createGain();
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.linearRampToValueAtTime(Math.max(0.0002,vol),t0+0.0018);   // 1.8ms 起振：够快但不"啪"
    g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    src.connect(f);f.connect(g);g.connect(audioCtx.destination);
    src.start(t0,Math.random()*0.12);src.stop(t0+dur+0.02);
  }catch(e){}
}
/* ② 金属余鸣：两个轻微失谐的正弦（拍频听起来才像钢），指数衰减 */
function _鸣(t0,freq,dur,vol){
  if(!audioCtx)return;
  for(var i=0;i<2;i++){
    try{
      var o=audioCtx.createOscillator();o.type='sine';
      o.frequency.setValueAtTime(Math.max(60,freq*(i?1.006:1)),t0);
      var g=audioCtx.createGain();
      g.gain.setValueAtTime(0.0001,t0);
      g.gain.linearRampToValueAtTime(Math.max(0.0002,vol*(i?0.55:1)),t0+0.002);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+dur*(i?0.7:1));
      o.connect(g);g.connect(audioCtx.destination);o.start(t0);o.stop(t0+dur+0.02);
    }catch(e){}
  }
}
/* ③ 结构闷响：低频正弦下扫 */
function _咚(t0,f1,f2,dur,vol){
  if(!audioCtx)return;
  try{
    var o=audioCtx.createOscillator();o.type='sine';
    o.frequency.setValueAtTime(Math.max(30,f1),t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(25,f2),t0+dur);
    var g=audioCtx.createGain();
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.linearRampToValueAtTime(Math.max(0.0002,vol),t0+0.0025);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(g);g.connect(audioCtx.destination);o.start(t0);o.stop(t0+dur+0.02);
  }catch(e){}
}
function _揉(){ return 1+(Math.random()-0.5)*0.08; }        // 音高随机 ±4%
function _晃(){ return 0.88+Math.random()*0.24; }            // 音量随机 ±12%

/* 弹匣释放：金属按钮"嗒" → 匣体从井里滑出（颗粒感） → 出井后轻晃 */
function playMagOut(){
  if(!audioCtx)return;
  var t=audioCtx.currentTime+0.005, k=_揉();
  _噪击(t,0.008,3100*k,0,9,0.16*_晃());            // 按钮弹起
  _鸣(t,2450*k,0.05,0.05*_晃());
  /* 匣体滑出：6 颗粒，频率往下走（匣越出来、摩擦面越少，声音越闷） */
  for(var i=0;i<6;i++){
    var u=i/6, tt=t+0.012+u*0.075+(Math.random()-0.5)*0.005;
    _噪击(tt,0.022+Math.random()*0.012,(1500-500*u)*k,(1300-500*u)*k,1.5,0.085*_晃());
  }
  _咚(t+0.030,210*k,120,0.055,0.10*_晃());          // 匣体离井时的那一下沉
  _噪击(t+0.100,0.05,780*k,600*k,1.1,0.055*_晃());  // 落到手里/地面的余响
}
/* 弹匣到位：匣顶撞机匣（实心）+ 卡榫咬合（脆）+ 钢件余鸣 */
function playMagIn(){
  if(!audioCtx)return;
  var t=audioCtx.currentTime+0.005, k=_揉();
  _咚(t,152*k,62,0.10,0.32*_晃());                  // 整把枪都被撞了一下
  _噪击(t,0.030,2600*k,1800*k,2.6,0.24*_晃());
  _鸣(t,1240*k,0.07,0.050*_晃());
  _鸣(t,2080*k,0.05,0.032*_晃());
  _噪击(t+0.030,0.012,4200*k,0,3.2,0.15*_晃());     // 卡榫咬住
  _噪击(t+0.050,0.095,720*k,480*k,1.0,0.070*_晃()); // 匣体在井里的余振（拖长，金属不会一下停）
}
/* 手掌拍匣底（换弹中间那一下） */
function playMagTap(){
  if(!audioCtx)return;
  var t=audioCtx.currentTime+0.005, k=_揉();
  _咚(t,235*k,150,0.075,0.17*_晃());
  _噪击(t,0.038,1700*k,1200*k,2.0,0.14*_晃());
  _鸣(t,1850*k,0.085,0.030*_晃());
  _鸣(t,2740*k,0.055,0.018*_晃());
}
/* 拉栓：抓住滚花 → 一路刮擦（颗粒、频率上扬） → 到后位"咔" */
function playBoltPull(){
  if(!audioCtx)return;
  var t=audioCtx.currentTime+0.005, k=_揉();
  _噪击(t,0.022,3200*k,0,5,0.075*_晃());                       // 手掌抓住滚花
  for(var i=0;i<8;i++){                                        // 刮擦：8 颗粒，越拉越紧
    var u=i/8, tt=t+0.020+u*0.115+(Math.random()-0.5)*0.006;
    _噪击(tt,0.028+Math.random()*0.018,(900+1100*u)*k,(1000+1200*u)*k,1.7,0.080*_晃());
  }
  var t2=t+0.155;                                              // 拉到后位、钢件互撞
  _噪击(t2,0.014,4400*k,0,7,0.20*_晃());
  _鸣(t2,2680*k,0.09,0.048*_晃());
  _鸣(t2,3860*k,0.06,0.028*_晃());
  _咚(t2,780*k,520,0.030,0.055*_晃());
}
/* 松手：复进簧把栓弹回去 → 机匣闭锁（比后拉重得多，余鸣也更长） */
function playBoltSlam(){
  if(!audioCtx)return;
  var t=audioCtx.currentTime+0.005, k=_揉();
  _咚(t,540*k,180,0.045,0.10*_晃());                           // 弹簧释放的"吁"
  var t2=t+0.012;
  _咚(t2,140*k,60,0.095,0.34*_晃());                           // 栓撞到闭锁面
  _噪击(t2,0.032,1900*k,1400*k,2.2,0.30*_晃());
  _鸣(t2,1480*k,0.12,0.050*_晃());
  _鸣(t2,2290*k,0.09,0.032*_晃());
  _噪击(t2+0.004,0.09,480*k,380*k,0.9,0.10*_晃(),'lowpass');   // 机匣的低频共振
  _噪击(t2+0.045,0.05,3000*k,0,4,0.045*_晃());                 // 一点高频碎响收尾
}
/* 一把枪"上膛"（普通枪换弹收尾用）：拉栓 + 立刻闭锁 */
function playChamber(){ playBoltPull(); if(audioCtx){ var t=audioCtx.currentTime+0.185; _咚(t,140,60,0.09,0.28); _噪击(t,0.03,1900,1400,2.2,0.24); _鸣(t,1480,0.10,0.04); } }
function pointSegDist(p,a,b){var abx=b.x-a.x,aby=b.y-a.y,abz=b.z-a.z;var apx=p.x-a.x,apy=p.y-a.y,apz=p.z-a.z;var ab2=abx*abx+aby*aby+abz*abz;var t=ab2>0?(apx*abx+apy*aby+apz*abz)/ab2:0;if(t<0)t=0;else if(t>1)t=1;var cx=a.x+abx*t-p.x,cy=a.y+aby*t-p.y,cz=a.z+abz*t-p.z;return Math.sqrt(cx*cx+cy*cy+cz*cz);}
var touchUI=document.getElementById('touchUI');var crosshairEl=document.getElementById('crosshair');
/* 【batch137】用户："自动适配是错的，我是电脑，它却识别成手机。适配逻辑应该检测设备**系统**，
   而不是检测设备**是否触屏**。"
   原来是三选一：有 ontouchstart / maxTouchPoints>0 / 指针是 coarse —— 带触摸屏的 Windows 笔记本
   三条全中，于是按钮层、摇杆、触屏键位一股脑冒出来，鼠标锁定也不请求了。
   现在只认**操作系统**：Android / iPhone / iPad / 鸿蒙 / Windows Phone 之类算触屏端；
   Windows / macOS / Linux 桌面一律当电脑，哪怕它带触摸屏。
   唯一保留的触屏特例是 iPad：iPadOS 13 起 UA 伪装成 Macintosh，所以补一条
   「Macintosh UA + 多指触摸」—— 这条只对 iPad 成立，不会把触摸屏 Windows 误判进来。 */
var isTouch=(function(){
  var ua=(navigator&&navigator.userAgent)||'', plat=(navigator&&navigator.platform)||'';
  if(/Android|iPhone|iPod|iPad|Windows Phone|HarmonyOS|Mobile/i.test(ua))return true;
  if(/Android|iPhone|iPod|iPad/i.test(plat))return true;
  if(/Macintosh/i.test(ua)&&(navigator.maxTouchPoints||0)>1)return true;
  /* 【batch163】测试手机版：网址加 ?touch=1 强制进入触屏界面 —— 电脑上也能看/玩手机版（摇杆/按键会用鼠标兜底） */
  try{if(/[?&]touch=1/.test((location&&location.search)||''))return true;}catch(e){}
  return false;
})();
if(isTouch){touchUI.style.display='block';document.body.classList.add('is-touch');}
// 摇杆
var joyBase=document.getElementById('joyBase'),joyKnob=document.getElementById('joyKnob'),joyId=null,joyCx=0,joyCy=0;var JOY_R=42,JOY_OFF=40,JOY_SCALE=1;
joyBase.addEventListener('touchstart',function(e){if(layoutEdit)return;e.preventDefault();var t=e.changedTouches[0];joyId=t.identifier;var r=joyBase.getBoundingClientRect();joyCx=r.left+r.width/2;joyCy=r.top+r.height/2;},{passive:false});
joyBase.addEventListener('touchmove',function(e){if(layoutEdit)return;e.preventDefault();for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];if(t.identifier!==joyId)continue;_joyAt(t.clientX,t.clientY);}e.stopPropagation();},{passive:false});
/* 摇杆核心（batch163 抽出来共用：触摸 / 鼠标都走这里） */
function _joyAt(cx,cy){var dx=cx-joyCx,dy=cy-joyCy;var dd=Math.sqrt(dx*dx+dy*dy);if(dd>JOY_R){dx*=JOY_R/dd;dy*=JOY_R/dd;}joyKnob.style.left=(JOY_OFF+dx)+'px';joyKnob.style.top=(JOY_OFF+dy)+'px';var nx=dx/JOY_R,ny=dy/JOY_R;keys.KeyW=ny<-0.3;keys.KeyS=ny>0.3;keys.KeyA=nx<-0.3;keys.KeyD=nx>0.3;S.joySprint=(ny<SPRINT_JOY_NY);}
function joyEnd(e){for(var i=0;i<e.changedTouches.length;i++){if(e.changedTouches[i].identifier===joyId){joyId=null;joyKnob.style.left=JOY_OFF+'px';joyKnob.style.top=JOY_OFF+'px';keys.KeyW=keys.KeyS=keys.KeyA=keys.KeyD=false;S.joySprint=false;}}}
joyBase.addEventListener('touchend',joyEnd);joyBase.addEventListener('touchcancel',joyEnd);
// 视角拖动（右侧）
var lookPad=document.getElementById('lookPad'),lookId=null,lookX=0,lookY=0;
lookPad.addEventListener('touchstart',function(e){if(layoutEdit)return;e.preventDefault();var t=e.changedTouches[0];lookId=t.identifier;lookX=t.clientX;lookY=t.clientY;},{passive:false});
lookPad.addEventListener('touchmove',function(e){if(layoutEdit)return;e.preventDefault();for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];if(t.identifier!==lookId)continue;_lookAt(t.clientX,t.clientY);}e.stopPropagation();},{passive:false});
/* 视角拖动核心（batch163 抽出来共用：触摸 / 鼠标都走这里） */
function _lookAt(cx,cy){var dx=cx-lookX,dy=cy-lookY;lookX=cx;lookY=cy;var _ts=1-S.aimProgress*0.55;yaw-=dx*S.sens*1.4*_ts*S.sensMul;pitch-=dy*S.sens*1.4*_ts*S.sensMul;pitch=Math.max(-1.4,Math.min(1.4,pitch));camera.quaternion.setFromEuler(new THREE.Euler(pitch+(S.recoilPunch||0),yaw,S.roll||0,'YXZ'));}
lookPad.addEventListener('touchend',function(e){for(var i=0;i<e.changedTouches.length;i++)if(e.changedTouches[i].identifier===lookId)lookId=null;});
/* 【batch163】电脑上测试手机版（?touch=1 强制触屏，但没有触摸事件）→
   摇杆 / 视角区 / 按键全部补一套鼠标绑定，不然只能看不能玩。真手机（有触摸）不会绑，绝不双触发。 */
var _natTouch=('ontouchstart' in window)||(navigator.maxTouchPoints||0)>0;
if(!_natTouch){
  joyBase.addEventListener('mousedown',function(e){if(layoutEdit)return;e.preventDefault();joyId=-1;var r=joyBase.getBoundingClientRect();joyCx=r.left+r.width/2;joyCy=r.top+r.height/2;_joyAt(e.clientX,e.clientY);});
  document.addEventListener('mousemove',function(e){if(joyId===-1)_joyAt(e.clientX,e.clientY);});
  document.addEventListener('mouseup',function(){if(joyId===-1){joyId=null;joyKnob.style.left=JOY_OFF+'px';joyKnob.style.top=JOY_OFF+'px';keys.KeyW=keys.KeyS=keys.KeyA=keys.KeyD=false;S.joySprint=false;}});
  lookPad.addEventListener('mousedown',function(e){if(layoutEdit)return;e.preventDefault();lookId=-1;lookX=e.clientX;lookY=e.clientY;});
  document.addEventListener('mousemove',function(e){if(lookId===-1)_lookAt(e.clientX,e.clientY);});
  document.addEventListener('mouseup',function(){if(lookId===-1)lookId=null;});
}
// 触屏按键
function tapKey(code){document.dispatchEvent(new KeyboardEvent('keydown',{code:code,bubbles:true}));}
function tbtn(id,down,up){var el=document.getElementById(id);if(!el)return;el.addEventListener('touchstart',function(e){if(layoutEdit)return;e.preventDefault();e.stopPropagation();down();},{passive:false});el.addEventListener('touchend',function(e){e.preventDefault();e.stopPropagation();if(up)up();});el.addEventListener('touchcancel',function(e){e.preventDefault();if(up)up();});
  /* 【batch163】电脑上测试手机版（无触摸事件）→ 按键补鼠标绑定 */
  if(!(('ontouchstart' in window)||(navigator.maxTouchPoints||0)>0)){
    el.addEventListener('mousedown',function(e){if(layoutEdit)return;e.preventDefault();e.stopPropagation();down();});
    el.addEventListener('mouseup',function(e){e.preventDefault();if(up)up();});
    el.addEventListener('mouseleave',function(){if(up)up();});
  }}
tbtn('btnFire',function(){if(audioCtx&&audioCtx.state==='suspended')audioCtx.resume();initAudio();if(SK.ghost>0){heroPortalPlace();return;}   /* 【batch145】虚化中：开火键＝放下门 */if(heroBallFire())return;if(heroAimStart())return;mouseDown=true;freshTrigger=true;if(S.playing&&!S.over&&!S.paused)attack();},function(){mouseDown=false;heroAimEnd();});
tbtn('btnRescue',function(){keys.KeyF=true;},function(){keys.KeyF=false;});   /* 【batch159】手机营救：按住＝长按 F（松开＝松手） */
tbtn('btnCrouch',function(){   // 蹲下＝点击切换（点一下蹲、再点一下站）
  S.crouch=!S.crouch;
  if(S.crouch&&typeof sprinting_off==='function')sprinting_off();
});
/* 【batch149】第二章营救时，攀爬键临时改当「长按 F」用（按住才算，松手就停）；
   其它情况照旧是点一下＝上/下梯。手机上没有 F 键，不这么改第二章就没法救人。 */
tbtn('btnClimb',function(){
  if(typeof STORY_!=='undefined'&&STORY_.on&&STORY_.ch===2&&STORY_.phase==='rescue'){
    keys.KeyF=true;var _cl=document.getElementById('btnClimb');if(_cl)_cl.textContent='救援';
  } else tapKey('KeyF');
},function(){
  if(typeof STORY_!=='undefined'&&STORY_.on&&STORY_.ch===2&&STORY_.phase==='rescue'){
    keys.KeyF=false;var _cl2=document.getElementById('btnClimb');if(_cl2)_cl2.textContent='上梯';
  }
});
tbtn('btnJump',function(){tapKey('Space');});
tbtn('btnWeapon',function(){showWeaponSelect();});
/* 【手机版·换枪】补一个 click 兜底：部分手机浏览器 / 电脑上用 ?touch=1 调试时 touchstart 不一定触发。
   重复触发无害 —— showWeaponSelect 内部有「面板已开就直接返回」的守卫。 */
(function(){var _wb=document.getElementById('btnWeapon');if(_wb)_wb.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();if(typeof layoutEdit!=='undefined'&&layoutEdit)return;showWeaponSelect();});})();
tbtn('btnSkill',function(){heroCast(0);});
tbtn('btnSkill2',function(){heroCast(1);});
tbtn('btnSkill3',function(){heroCast(2);});
tbtn('btnReload',function(){reload();});
/* 【batch164】手机版：手上有技能（持握投掷物 / 装填了球形闪电）时，点「开镜」＝**取消技能**。
   手机上"再按一次技能键收起"要低头找键，开镜键就在拇指边，取消更快。
   球形闪电只收起、**不退冷却**（130 秒大招不能靠"装填→取消"白嫖）。 */
tbtn('btnAim',function(){
  if(SK.hold){
    var _sk=heroSkill(SK.hold.si);
    if(SK.hold.kind==='ball'){
      SK.hold=null;SK.aimThrow=false;SK.ballLeft=0;SK.ballGap=0;
      heroHoldHide();heroPreviewHide();
      showMsg('已收起「'+_sk.name+'」','#6ff0ff');heroHudUpdate(true);return;
    }
    heroHoldCancel();                                  // 投掷物：收起 + 退还冷却
    showMsg('已收起「'+_sk.name+'」','#ffd166');return;
  }
  S.aiming=true;
},function(){S.aiming=false;});
tbtn('btnPeekL',function(){keys.KeyQ=true;},function(){keys.KeyQ=false;});
tbtn('btnPeekR',function(){keys.KeyE=true;},function(){keys.KeyE=false;});

// ==================== 触屏设置：灵敏度 / 小地图 / 摇杆 / 游戏内暂停菜单 ====================
var TUNING_KEY='gunGame.touchTuning.v1';
var MM_SIZE=120;
function tuningLoad(){try{var t=JSON.parse(localStorage.getItem(TUNING_KEY)||'null');if(t){if(t.sens)S.sensMul=t.sens;if(t.mm)MM_SIZE=Math.round(t.mm);if(t.joy)JOY_SCALE=t.joy;}}catch(e){}}
function tuningSave(){try{localStorage.setItem(TUNING_KEY,JSON.stringify({sens:S.sensMul,mm:MM_SIZE,joy:JOY_SCALE}));}catch(e){}}
function tuningApplyUI(){
  var cv=document.getElementById('minimap');
  if(cv){cv.style.width=MM_SIZE+'px';cv.style.height=MM_SIZE+'px';}
  if(typeof joyBase!=='undefined'&&joyBase&&typeof joyKnob!=='undefined'&&joyKnob){
    joyBase.style.width=(130*JOY_SCALE)+'px';joyBase.style.height=(130*JOY_SCALE)+'px';
    joyKnob.style.width=(50*JOY_SCALE)+'px';joyKnob.style.height=(50*JOY_SCALE)+'px';
    JOY_R=42*JOY_SCALE;JOY_OFF=40*JOY_SCALE;
    joyKnob.style.left=JOY_OFF+'px';joyKnob.style.top=JOY_OFF+'px';
  }
}
function tuningApplyToUI(){
  var s1=document.getElementById('spSens'),v1=document.getElementById('spSensVal');
  if(s1)s1.value=S.sensMul;if(v1)v1.textContent=Number(S.sensMul).toFixed(2)+'x';
  var s2=document.getElementById('spMM'),v2=document.getElementById('spMMVal');
  if(s2)s2.value=MM_SIZE;if(v2)v2.textContent=MM_SIZE;
  var s3=document.getElementById('spJoy'),v3=document.getElementById('spJoyVal');
  if(s3)s3.value=JOY_SCALE;if(v3)v3.textContent=Number(JOY_SCALE).toFixed(2)+'x';
}
function applyTuning(){
  tuningLoad();
  if(!(S.sensMul>0))S.sensMul=1;
  if(!(MM_SIZE>=80))MM_SIZE=120;
  if(!(JOY_SCALE>0))JOY_SCALE=1;
  tuningApplyUI();tuningApplyToUI();
  if(typeof layoutClampAll==='function')layoutClampAll();
}
/* ============================================================================
   【batch220】后处理阴影（屏幕空间 AO）开关。
   用户要求：加个开关，**默认关闭**。
   ─ 关掉的是什么：后处理里那两趟 AO + 双边模糊（半分辨率 6 次半球采样 + 9 tap），
     表现上就是墙角、箱子底、人和地面接缝那一圈"接触暗边"。这是全链最贵的一步。
   ─ 关掉不影响什么：太阳投影出来的影子照旧（那是 LIGHT 的阴影贴图，不是后处理）；
     暗角、色调曲线、屏幕雾、开镜镜内视野也都还在（它们和 AO 共用合成 pass，但各是各的 uniform）。
   ─ 存档键单独一个（gunGame.postAO.v1），没存过 = '0' = 关。
   ============================================================================ */
var AO_KEY='gunGame.postAO.v1';
function aoLoad(){ try{ return localStorage.getItem(AO_KEY)==='1'; }catch(e){ return false; } }
function aoSave(on){ try{ localStorage.setItem(AO_KEY,on?'1':'0'); }catch(e){} }
function aoUI(on){
  var v=document.getElementById('spAoVal'); if(v)v.textContent=on?'开':'关';
  var b=document.getElementById('spAoToggle');
  if(b){
    b.textContent=on?'关闭后处理阴影（省性能）':'开启后处理阴影（接触处更立体）';
    b.style.background=on?'rgba(52,140,102,.85)':'rgba(60,120,200,.85)';
    b.style.borderColor=on?'rgba(140,240,190,.55)':'rgba(255,255,255,.35)';
  }
}
/* on=开关；save=true 时写存档 */
function aoApply(on,save){
  on=!!on;
  try{ if(typeof POST!=='undefined'&&POST&&typeof POST.设影==='function')POST.设影(on); }catch(e){}
  aoUI(on);
  if(save)aoSave(on);
  return on;
}
function aoToggle(){ aoApply(aoLoad()!==true?true:false, true); }

/* ============================================================================
   【batch139】手机端专有：全屏切换 + 陀螺仪微调（灵敏度 0~100，0＝关）。
   只在触屏端出现：对应的 DOM 行都带 class="only-touch"，
   电脑上由 `body:not(.is-touch) .only-touch{display:none}` 藏掉（用户："这些电脑版都没有"）。
   ============================================================================ */
var GYRO_KEY='gunGame.gyroSens.v1';
var gyroSens=0,gyroOn=false,gyroBase=null;
function gyroLoad(){try{gyroSens=parseInt(localStorage.getItem(GYRO_KEY)||'0',10)||0;}catch(e){gyroSens=0;}
  if(gyroSens<0)gyroSens=0;if(gyroSens>100)gyroSens=100;}
function gyroSave(){try{localStorage.setItem(GYRO_KEY,String(gyroSens));}catch(e){}}
function gyroUI(){var s=document.getElementById('spGyro'),v=document.getElementById('spGyroVal');
  if(s)s.value=gyroSens;if(v)v.textContent=gyroSens>0?String(gyroSens):'关';}
/* 收到一次倾斜事件：把"相对开启那一刻的偏移"加到视角上（相对式，不用管手机怎么拿的） */
function gyroEv(e){
  if(!gyroOn||gyroSens<=0)return;
  var b=e.beta,g=e.gamma;
  if(b==null&&g==null)return;
  b=b||0;g=g||0;
  if(!gyroBase){gyroBase={b:b,g:g};return;}              // 第一个事件只当基准，免得视角突跳
  var k=gyroSens/100*0.9;                                // 0~100 → 0~0.9 系数
  var db=b-gyroBase.b,dg=g-gyroBase.g;
  if(db>60||db<-60)db=0;                                 // 越过翻转边界的跳变忽略
  if(dg>90||dg<-90)dg=0;
  pitch=Math.max(-1.4,Math.min(1.4,pitch+db*0.022*k));   // 前后倾 → 俯仰
  yaw-=dg*0.022*k*S.sensMul;                             // 左右倾 → 转向（吃镜头灵敏度）
  gyroBase={b:b,g:g};
}
function gyroStart(){
  if(!window.DeviceOrientationEvent){if(typeof showMsg==='function')showMsg('这台设备 / 浏览器不支持陀螺仪','#ffd166');return;}
  var 真开=function(){gyroOn=true;gyroBase=null;window.addEventListener('deviceorientation',gyroEv);
    if(typeof showMsg==='function')showMsg('陀螺仪已开启（灵敏度 '+gyroSens+'）· 倾斜手机补瞄','#4fc3ff');};
  if(typeof DeviceOrientationEvent.requestPermission==='function'){    // iOS 13+ 必须在用户手势里申请
    DeviceOrientationEvent.requestPermission().then(function(r){
      if(r==='granted')真开();
      else if(typeof showMsg==='function')showMsg('陀螺仪权限被拒绝（去 设置→Safari→动作与方向 打开）','#ff6b6b');
    }).catch(function(){if(typeof showMsg==='function')showMsg('陀螺仪权限申请失败','#ff6b6b');});
  } else 真开();
}
function gyroStop(){gyroOn=false;gyroBase=null;try{window.removeEventListener('deviceorientation',gyroEv);}catch(e){}}
function gyroSet(v){
  v=parseInt(v,10)||0;if(v<0)v=0;if(v>100)v=100;
  gyroSens=v;gyroSave();gyroUI();
  if(v>0){if(!gyroOn)gyroStart();}
  else if(gyroOn){gyroStop();if(typeof showMsg==='function')showMsg('陀螺仪已关闭','#ffd166');}
}
(function(){
  var gs=document.getElementById('spGyro');
  if(gs)gs.addEventListener('input',function(){gyroSet(this.value);});
  gyroLoad();gyroUI();
  if(gyroSens>0){   /* 上次开着 → 这次自动恢复；iOS 要用户手势，所以挂在第一次点击上 */
    var once=function(){gyroSet(gyroSens);document.removeEventListener('pointerdown',once);document.removeEventListener('touchstart',once);};
    document.addEventListener('pointerdown',once);document.addEventListener('touchstart',once);
  }
})();
/* ---- 全屏（手机）---- */
function fsOn(){try{return !!(document.fullscreenElement||document.webkitFullscreenElement);}catch(e){return false;}}
function fsUI(){var v=document.getElementById('spFsVal');if(v)v.textContent=fsOn()?'开':'关';}
(function(){
  function 切(){
    try{
      if(fsOn()){
        var ex=document.exitFullscreen||document.webkitExitFullscreen;if(ex)ex.call(document);
      }else{
        var el=document.documentElement,rq=el.requestFullscreen||el.webkitRequestFullscreen;
        if(rq){var p=rq.call(el);if(p&&p.catch)p.catch(function(){});}
        try{if(screen.orientation&&screen.orientation.lock)screen.orientation.lock('landscape').catch(function(){});}catch(e2){}
      }
    }catch(e){}
    setTimeout(fsUI,350);
  }
  var b=document.getElementById('spFullscreen');
  if(b)b.addEventListener('click',function(e){e.preventDefault();切();});
  document.addEventListener('fullscreenchange',fsUI);document.addEventListener('webkitfullscreenchange',fsUI);
  fsUI();
})();
function openGameMenu(){
  if(!S.playing||S.over)return;
  S.paused=true;mouseDown=false;S.aiming=false;
  keys.KeyW=keys.KeyS=keys.KeyA=keys.KeyD=false;keys.KeyQ=false;keys.KeyE=false;
  S.sprintLatch=false;S.joySprint=false;S.touchCrouch=false;S.crouch=false;
  var bl=document.getElementById('blocker');if(bl)bl.style.display='flex';
  setMenuMode('pause');
  if(isTouch)touchUI.style.display='none';
}
// 是否有别的全屏浮层（每波改装界面 / 游戏结束）正开着——开着时 Esc 不应抢菜单
function overlayOpen(){var a=document.getElementById('wave-shop'),b=document.getElementById('go'),c=document.getElementById('weapon-select');return !!((a&&a.style.display==='flex')||(b&&b.style.display==='flex')||(c&&c.style.display==='flex'));}
// 关闭开始菜单、回到游戏。指针锁不可用时同样能恢复（靠按住鼠标右键拖动转视角）
function closeGameMenu(){
  if(overlayOpen())return;
  var bl=document.getElementById('blocker');if(bl)bl.style.display='none';
  S.paused=false;
  if(isTouch)touchUI.style.display='block';
  lockPointer();
}

// ==================== 触屏设置：按键布局自定义 ====================
var LAYOUT_KEY='gunGame.touchLayout.v2';   // v2：坐标从"屏幕左上角 px"改成"距右/下边 px"，换屏幕也成立
var layoutEdit=false,spOpen=false,menuPrevPaused=null,menuHidBlocker=false;
var layoutMovable=['joyBase','btnFire','btnReload','btnJump','btnClimb','btnCrouch','btnWeapon','btnPeekL','btnPeekR','btnAim','btnSkill','btnSkill2','btnSkill3'];
var layoutDefaults={};

/* ==================== 触屏按键：多比例屏幕自适应 ====================
   每个按键记的是「距右边 dx / 距下边 dy」（设计坐标，单位 px），再乘一个整体缩放系数 s。
   s = min(屏宽/760, 屏高/560)，夹在 0.58~1 之间 —— 屏幕越小，整簇按键越小、越贴边，
   不会再把最上面那几个按钮顶出屏幕（横屏手机以前就是这样点不到「蹲」和「技能③」）。
   joyBase 锚在左下角，其余锚在右下角。 */
var TS_DESIGN={
  joyBase:{ax:'lb',dx:92,dy:68,w:130,h:130},
  btnFire:{ax:'rb',dx:15,dy:24,w:104,h:104},
  btnReload:{ax:'rb',dx:492,dy:118,w:86,h:54},
  btnAim:{ax:'rb',dx:112,dy:396,w:86,h:54},
  btnJump:{ax:'rb',dx:360,dy:118,w:86,h:54},
  btnClimb:{ax:'rb',dx:194,dy:300,w:86,h:54},
  btnWeapon:{ax:'rb',dx:630,dy:118,w:86,h:54},
  btnCrouch:{ax:'rb',dx:102,dy:226,w:86,h:54},
  btnPeekL:{ax:'lb',dx:85,dy:494,w:86,h:54},
  btnPeekR:{ax:'lb',dx:206,dy:494,w:86,h:54},
  btnSkill:{ax:'rb',dx:240,dy:488,w:86,h:54},
  btnSkill2:{ax:'rb',dx:108,dy:488,w:86,h:54},
  btnSkill3:{ax:'rb',dx:10,dy:488,w:86,h:54}
};
var TS_REF_W=760,TS_REF_H=560,TS_MIN=0.58,TS_MAX=1.0;
var TS_OVR={},_tsS=1;
function tsScale(){
  var W=window.innerWidth||360,H=window.innerHeight||640;
  return Math.max(TS_MIN,Math.min(TS_MAX,Math.min(W/TS_REF_W,H/TS_REF_H)));
}
function layoutFit(){
  if(typeof isTouch==='undefined'||!isTouch)return;
  var s=layoutEdit?1:tsScale();
  _tsS=s;
  var W=window.innerWidth,H=window.innerHeight;
  for(var id in TS_DESIGN){
    if(!Object.prototype.hasOwnProperty.call(TS_DESIGN,id))continue;
    var d=TS_DESIGN[id],el=document.getElementById(id);if(!el)continue;
    var dx=d.dx,dy=d.dy;
    if(TS_OVR[id]){dx=TS_OVR[id][0];dy=TS_OVR[id][1];}
    el.style.right='auto';el.style.bottom='auto';
    el.style.left=(d.ax==='lb'?dx:(W-dx-d.w*s))+'px';
    el.style.top=(H-dy-d.h*s)+'px';
    el.style.transformOrigin='top left';
    el.style.transform=(s===1?'':'scale('+s+')');
  }
}
/* 把当前实际位置换算回设计坐标（保存布局用） */
function layoutDesign(){
  var o={},W=window.innerWidth,H=window.innerHeight,s=_tsS;
  for(var id in TS_DESIGN){
    if(!Object.prototype.hasOwnProperty.call(TS_DESIGN,id))continue;
    var d=TS_DESIGN[id],el=document.getElementById(id);if(!el)continue;
    var x=parseFloat(el.style.left),y=parseFloat(el.style.top);
    if(!isFinite(x)||!isFinite(y)){x=(d.ax==='lb'?d.dx:(W-d.dx-d.w*s));y=(H-d.dy-d.h*s);}
    o[id]=[Math.round(d.ax==='lb'?x:(W-(x+d.w*s))),Math.round(H-(y+d.h*s))];
  }
  return o;
}
function menuPauseSync(){var open=(layoutEdit||spOpen);if(open){if(menuPrevPaused===null){menuPrevPaused=S.paused;S.paused=true;}}else if(menuPrevPaused!==null){S.paused=menuPrevPaused;menuPrevPaused=null;}}
function layoutApply(map){
  for(var id in map){
    if(!Object.prototype.hasOwnProperty.call(map,id))continue;
    if(!TS_DESIGN[id]||!map[id]||map[id].length!==2)continue;
    TS_OVR[id]=[map[id][0],map[id][1]];
  }
  layoutFit();
}
function layoutCollect(){return layoutDesign();}
function layoutInit(){
  try{
    var sv=JSON.parse(localStorage.getItem(LAYOUT_KEY)||'null');
    if(sv)for(var id in sv){
      if(!Object.prototype.hasOwnProperty.call(sv,id))continue;
      if(TS_DESIGN[id]&&sv[id]&&sv[id].length===2)TS_OVR[id]=[sv[id][0],sv[id][1]];
    }
  }catch(e){}
  layoutFit();
}
function layoutSave(){try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(layoutDesign()));}catch(e){}showMsg('✅ 布局已保存');}
function layoutResetAll(){TS_OVR={};try{localStorage.removeItem(LAYOUT_KEY);}catch(e){}layoutFit();showMsg('↺ 已恢复默认布局');}
/* 转屏 / 改窗口大小：把越界的按键拉回屏幕内（存成设计坐标），再按新尺寸重新摆放 */
function layoutClampAll(){
  if(typeof isTouch==='undefined'||!isTouch)return;
  var s=layoutEdit?1:tsScale();
  var W=window.innerWidth,H=window.innerHeight;
  for(var id in TS_DESIGN){
    if(!Object.prototype.hasOwnProperty.call(TS_DESIGN,id))continue;
    var d=TS_DESIGN[id],o=TS_OVR[id]||[d.dx,d.dy];
    var maxX=Math.max(2,W-d.w*s-2),maxY=Math.max(2,H-d.h*s-2);
    var dx=Math.max(2,Math.min(maxX,o[0]));
    var dy=Math.max(2,Math.min(maxY,o[1]));
    TS_OVR[id]=[Math.round(dx),Math.round(dy)];
  }
  layoutFit();
}
function layoutBindDrag(el){
  var dID=null,offX=0,offY=0;
  el.addEventListener('touchstart',function(e){if(!layoutEdit)return;e.preventDefault();e.stopPropagation();var t=e.changedTouches[0];dID=t.identifier;var r=el.getBoundingClientRect();offX=t.clientX-r.left;offY=t.clientY-r.top;el.classList.add('dragging');},{passive:false});
  el.addEventListener('touchmove',function(e){if(!layoutEdit||dID===null)return;e.preventDefault();e.stopPropagation();for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];if(t.identifier!==dID)continue;var nx=t.clientX-offX,ny=t.clientY-offY,w=el.offsetWidth,h=el.offsetHeight;nx=Math.max(0,Math.min(Math.max(0,window.innerWidth-w),nx));ny=Math.max(0,Math.min(Math.max(0,window.innerHeight-h),ny));el.style.left=nx+'px';el.style.top=ny+'px';}},{passive:false});
  var end=function(e){for(var i=0;i<e.changedTouches.length;i++){if(e.changedTouches[i].identifier===dID){dID=null;el.classList.remove('dragging');}}};
  el.addEventListener('touchend',end);el.addEventListener('touchcancel',end);
}
function setLayoutEdit(on){
  layoutEdit=on;
  if(on){if(typeof layoutFit==='function')layoutFit();if(typeof layoutClampAll==='function')layoutClampAll();}
  touchUI.classList.toggle('editing',on);
  var bar=document.getElementById('layoutBar');if(bar)bar.classList.toggle('on',on);
  var bl=document.getElementById('blocker');
  if(on){
    keys.KeyW=keys.KeyS=keys.KeyA=keys.KeyD=false;keys.KeyQ=false;keys.KeyE=false;keys.KeyF=false;keys.ShiftLeft=false;keys.ShiftRight=false;mouseDown=false;S.aiming=false;
    // 在开始菜单里调整时：先把菜单挡板收起来，并把触屏层提到最上方，方便看到并拖动按键
    if(bl&&bl.style.display!=='none'){menuHidBlocker=true;bl.style.display='none';}else{menuHidBlocker=false;}
    touchUI.classList.add('layoutTop');
    if(isTouch)touchUI.style.display='block';
  }else{
    touchUI.classList.remove('layoutTop');
    if(menuHidBlocker&&bl){bl.style.display='';menuHidBlocker=false;}
  }
  menuPauseSync();
}
function beginLayoutFromMenu(){setLayoutEdit(true);}
function openSettings(on){spOpen=on;var p=document.getElementById('settingsPanel');if(p)p.classList.toggle('on',on);if(on){keys.KeyW=keys.KeyS=keys.KeyA=keys.KeyD=false;mouseDown=false;S.aiming=false;}menuPauseSync();}
if(isTouch){
  layoutInit();
  for(var _li=0;_li<layoutMovable.length;_li++){var _le=document.getElementById(layoutMovable[_li]);if(_le)layoutBindDrag(_le);}
  window.addEventListener('resize',layoutClampAll);
  var _g=document.getElementById('btnSettings');if(_g)_g.addEventListener('touchstart',function(e){e.preventDefault();e.stopPropagation();openSettings(true);},{passive:false});
  var _e2=document.getElementById('spEdit');if(_e2)_e2.addEventListener('touchstart',function(e){e.preventDefault();openSettings(false);setLayoutEdit(true);},{passive:false});
  var _r2=document.getElementById('spReset');if(_r2)_r2.addEventListener('touchstart',function(e){e.preventDefault();layoutResetAll();},{passive:false});
  var _d=document.getElementById('lbDone');if(_d)_d.addEventListener('touchstart',function(e){e.preventDefault();layoutSave();setLayoutEdit(false);},{passive:false});
  var _rb=document.getElementById('lbReset');if(_rb)_rb.addEventListener('touchstart',function(e){e.preventDefault();layoutResetAll();},{passive:false});
  var _pb=document.getElementById('btnPause');if(_pb)_pb.addEventListener('touchstart',function(e){e.preventDefault();e.stopPropagation();openGameMenu();},{passive:false});
  var _s3=document.getElementById('spJoy');if(_s3)_s3.addEventListener('input',function(){JOY_SCALE=parseFloat(_s3.value)||1;var v=document.getElementById('spJoyVal');if(v)v.textContent=JOY_SCALE.toFixed(2)+'x';tuningApplyUI();tuningSave();});
}
/* 【batch162b】设置面板的**通用**入口与控件 —— 此前整块包在 if(isTouch) 里，导致电脑端：
   点暂停菜单的「⚙设置」没反应（menuSetBtn 没注册 click）、面板关不掉（spClose 只有 touchstart）、
   灵敏度 / 小地图滑条是死的（input 没注册）。batch139「动 isTouch 让电脑端静默丢功能」同款坑复发。
   摇杆大小 / 全屏 / 陀螺仪 / 自定义布局仍是触屏专有（留在上面 + .only-touch 藏 UI）。 */
(function(){
  var _c=document.getElementById('spClose');
  if(_c){_c.addEventListener('touchstart',function(e){e.preventDefault();openSettings(false);},{passive:false});
         _c.addEventListener('click',function(e){e.preventDefault();openSettings(false);});}
  var _mb=document.getElementById('menuSetBtn');if(_mb)_mb.addEventListener('click',function(e){e.preventDefault();openSettings(true);});
  var _s1=document.getElementById('spSens');if(_s1)_s1.addEventListener('input',function(){S.sensMul=parseFloat(_s1.value)||1;var v=document.getElementById('spSensVal');if(v)v.textContent=S.sensMul.toFixed(2)+'x';tuningSave();});
  var _s2=document.getElementById('spMM');if(_s2)_s2.addEventListener('input',function(){MM_SIZE=parseInt(_s2.value,10)||120;var v=document.getElementById('spMMVal');if(v)v.textContent=MM_SIZE;tuningApplyUI();tuningSave();});
  applyTuning();   // 电脑端也要恢复已保存的灵敏度 / 小地图大小（从触屏块挪到这里，两端共用）
  /* 【batch220】后处理阴影：按钮切换 + 启动时按存档恢复（**没存过就是关**） */
  var _aoBtn=document.getElementById('spAoToggle');
  if(_aoBtn)_aoBtn.addEventListener('click',function(e){
    e.preventDefault();e.stopPropagation();
    var on=!(typeof POST!=='undefined'&&POST&&POST.影);
    aoApply(on,true);
    try{ if(typeof showMsg==='function')showMsg(on?'🌑 后处理阴影：开':'🌑 后处理阴影：关','#9fd7ff'); }catch(_e){}
  });
  aoApply(aoLoad(),false);
})();

// ==================== 电脑端键位设置面板 ====================
var keyCaptureAction=null;
function keymapReset(){for(var k in KEYDEF)KEYMAP[k]=KEYDEF[k];keymapSave();keymapApplyUI();}
function keymapApplyUI(){
  var box=document.getElementById('keyList');if(!box)return;
  var html='';
  for(var i=0;i<KEYORDER.length;i++){
    var a=KEYORDER[i];
    html+='<div class="kRow"><span>'+KEYLABEL[a]+'</span><span class="kCode'+(keyCaptureAction===a?' wait':'')+'">'+(keyCaptureAction===a?'按下按键…':codeLabel(KEYMAP[a]))+'</span><button class="kBtn" data-act="'+a+'">改</button></div>';
  }
  box.innerHTML=html;
  var bs=box.querySelectorAll('.kBtn');
  for(var j=0;j<bs.length;j++)bs[j].addEventListener('click',function(e){e.preventDefault();e.stopPropagation();keyCaptureAction=this.getAttribute('data-act');keymapApplyUI();});
}
function keyCaptureSet(code){
  var act=keyCaptureAction;if(!act)return;keyCaptureAction=null;
  if(code!=='Escape')KEYMAP[act]=code;
  keymapSave();keymapApplyUI();
}
function keyPanelOpen(on){
  var p=document.getElementById('keyPanel');if(p)p.classList.toggle('on',!!on);
  keyCaptureAction=null;
  if(on)keymapApplyUI();
}
function keymapInitUI(){
  var k=document.getElementById('spKeys');if(k)k.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();keyPanelOpen(true);});
  var kr=document.getElementById('spKeysReset');if(kr)kr.addEventListener('click',function(e){e.preventDefault();keymapReset();});
  var k2=document.getElementById('keyReset');if(k2)k2.addEventListener('click',function(e){e.preventDefault();keymapReset();});
  var kc=document.getElementById('keyClose');if(kc)kc.addEventListener('click',function(e){e.preventDefault();keyPanelOpen(false);});
  keymapLoad();keymapApplyUI();
}
if(!isTouch)keymapInitUI();

// ==================== 【batch148】开挂状态：强制关闭 ====================
/* 用户要求：「把手机版那个问号打开的挂都删掉，问号也要删掉；所有人的开挂状态默认关闭，
   就算改了之后，还是会不停地关闭。」
   → ? 按钮 / 密码页 / 调试面板，以及整套挂（自瞄、锁头、旋转自瞄、无视伤害、透视、
     子弹与刀穿墙、伤害倍率、移速、跳跃）**全部删除**。
   → 这里只留一个"把状态钉死为关"的小函数，主循环每帧跑一次：就算有人改 localStorage
     或者在控制台里手改 S.cheatXxx，下一帧也会被按回去 —— 也就是"不停地关闭"。 */
function cheatForceOff(){
  S.cheatAim=false;S.cheatHead=false;S.cheatSpin=false;S.cheatGod=false;
  S.cheatEsp=false;S.cheatWall=false;
  S.cheatDmg=1;S.cheatSpeed=1;S.cheatJump=1;
}
cheatForceOff();
try{ localStorage.removeItem('gunGame.cheat.v1'); }catch(e){}   // 旧存档里的挂设置一并抹掉

/* ==================== 【batch229】主菜单左右侧栏 ====================
   宽屏（≥1200px）主菜单是三栏：中间是原来的内容，左右两栏放"玩家信息 / 快捷入口 /
   联机状态 / 公告"—— 把原来挤在中间的东西摊到两边，中间就宽松了。
   侧栏只在宽屏显示（CSS display:none 兜底），这里只做数据刷新 + 按钮绑定。 */
(function 主菜单侧栏(){
  function $(id){ return document.getElementById(id); }
  function 设(id, 文){ var el=$(id); if(el) el.textContent = 文; }

  /* 刷新：名字/金币/身份码/联机状态/版本（2 秒一次，主菜单开着时几乎零成本） */
  function 刷新(){
    try{
      设('sideName', (typeof S!=='undefined'&&S&&S.playerName)||'—');
      设('sideGold', (typeof gold!=='undefined'?gold:0));
      设('sideCode', (typeof netMyCode==='function'&&netMyCode())||'—');
      var 连=false, 服='—';
      try{ 连=!!(window.NET&&NET.connected); 服=(NET.server||NET.raw)||'—'; }catch(e){}
      设('sideNet', 连?'✅ 已连接':'离线（可玩单人）');
      设('sideSrv', 连?服:'—');
      设('sideVer', (typeof GAME_VER!=='undefined'?GAME_VER:'?'));
    }catch(e){}
  }

  /* 按钮绑定（元素可能被缓存旧版页面没有 → 全部判空） */
  function 绑(id, 干){ var b=$(id); if(b) b.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); try{ 干(); }catch(err){} }); }
  {
    绑('sideHeroBtn', function(){ if(typeof switchTab==='function') switchTab('hero'); });
    绑('sideMapBtn',  function(){ if(typeof switchTab==='function') switchTab('map'); });
    绑('sideInfoBtn', function(){ if(typeof switchTab==='function') switchTab('info'); });
    绑('sideModBtn',  function(){ if(window.MOD_MGR&&typeof MOD_MGR.打开==='function') MOD_MGR.打开(); });
    绑('sideSetBtn',  function(){ if(typeof openSettings==='function') openSettings(true); });
    /* 多人按钮＝直接点中间那个大钮（逻辑完全复用，不另写一套） */
    绑('sideNetBtn', function(){ var b=$('netBtn'); if(b) b.click(); });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', function(){ 刷新(); setInterval(刷新, 2000); });
  else { 刷新(); setInterval(刷新, 2000); }
})();
