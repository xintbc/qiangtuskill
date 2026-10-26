// ==================== INPUT ====================
var yaw=0,pitch=0,pointerLocked=false;
// 指针锁重试：Chrome 在按 Esc 退出锁定后的短时间内会拒绝再次锁定，
// 点「继续」时如果一次没锁上就自动重试几次，避免卡在暂停菜单里动不了。
var _lockToken=0,_lockErr=0,_lockUnavailable=false;
function lockPointer(){
  if(isTouch)return;
  var my=++_lockToken,tries=0;
  (function go(){
    if(my!==_lockToken)return;                                  // 已被取消或被新的请求取代
    if(pointerLocked||_lockUnavailable||!S.playing||S.over)return;
    try{var pr=document.body.requestPointerLock();if(pr&&pr.catch)pr.catch(function(){});}catch(e){}
    if(tries++<4)setTimeout(go,400);
  })();
}
// 指针锁被浏览器拒绝（页面嵌在 iframe 里、隧道预览、或反复按 Esc 后浏览器短时拒绝）：
// 连续失败 3 次即判定为不可用，之后不再反复尝试锁定；此时按住鼠标右键拖动照样能转视角。
// 指针锁连续失败：标记为不可用，并给出可点的「重新尝试锁定鼠标」按钮。
// 【重要】不可用不是永久判决 —— 浏览器在刚按过 Esc 的一小段时间内会拒绝锁定，
// 之后又能锁上。所以每次从暂停菜单恢复时都会清掉这个标记重试一次（见 mousedown）。
document.addEventListener('pointerlockerror',function(){
  _lockErr++;
  if(_lockErr>=3){_lockUnavailable=true;}
  if(_lockErr===3){
    showMsg('⚠️ 浏览器未允许锁定鼠标：按住鼠标左键或右键拖动都能转视角。若拖动时浏览器自己弹出手势，请在浏览器设置里关闭「鼠标手势」','#fc0');
    var rb=document.getElementById('relockBtn');if(rb)rb.style.display='inline-block';
  }
});
// 「重新尝试锁定鼠标」：清掉失败计数再锁一次（通常按过 Esc 后再点就能锁上）
var _relockBtn=document.getElementById('relockBtn');
if(_relockBtn)_relockBtn.addEventListener('click',function(e){
  e.preventDefault();e.stopPropagation();
  _lockErr=0;_lockUnavailable=false;
  lockPointer();
});
/* 「鼠标未锁定」常驻提示：电脑端只要在游戏中而指针没锁，就一直显示；
   点提示（或点画面）＝清掉失败计数并重新请求锁定。
   以前只在"连续失败 3 次"那一刻闪一条消息，玩家按 Esc 解锁后往往找不到重新锁定的入口。 */
var _lockHintOn=false;
function lockHintSync(){
  var need=!!(S.playing&&!S.over&&!S.paused&&!isTouch&&!pointerLocked);
  if(need===_lockHintOn)return;
  _lockHintOn=need;
  var el=document.getElementById('lockHint');
  if(el)el.classList.toggle('on',need);
}
var _lockHintEl=document.getElementById('lockHint');
if(_lockHintEl){
  var _lockHintGo=function(e){e.preventDefault();e.stopPropagation();_lockErr=0;_lockUnavailable=false;lockPointer();};
  _lockHintEl.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();});
  _lockHintEl.addEventListener('click',_lockHintGo);
  _lockHintEl.addEventListener('touchstart',_lockHintGo,{passive:false});
}
// 窗口失焦：只清空原始按键状态即可。
// 【重要】这里绝不能写 keys={}：keys 是用 Object.defineProperty 存取器实现的，
// 一旦被替换成普通空对象，所有键位映射会永久失效 → 电脑版「动不了」（刷新才能恢复）。
window.addEventListener('blur',function(){for(var _bk in _raw)_raw[_bk]=false;mouseDown=false;rightMouseDown=false;S.sprintLatch=false;S.joySprint=false;S.crouch=false;});
document.addEventListener('keydown',function(e){if(keyCaptureAction){e.preventDefault();keyCaptureSet(e.code);return;}if(e.code==='Escape'){if(weaponSelectOpen()){closeWeaponSelect();return;}if(spOpen){openSettings(false);return;}if(S.playing&&!S.over&&!overlayOpen()){if(S.paused)closeGameMenu();else openGameMenu();}return;}_raw[e.code]=true;if(!S.playing||S.over||S.paused)return;
/* 【蹲下＝点击切换】按一下蹲下键＝蹲/站 切换（不再是长按）。
   同时认 KEYMAP.crouch（设置里可自定义）与左右 Shift，改键后照样能用。 */
if((e.code===KEYMAP.crouch||e.code==='ShiftLeft'||e.code==='ShiftRight')&&!e.repeat){
  S.crouch=!S.crouch;if(S.crouch&&typeof sprinting_off==='function')sprinting_off();
}
if(e.code===KEYMAP.reload&&currentWeapon===WEAPON_GUN&&canAct())reload();
/* 【batch203】检视武器：只有 def 里带 inspect 的枪（纪念枪「长明」）会动，别的枪按了没反应。
   typeof 守卫：缓存里若是旧分片（js/24 还没有 开始检视），按 I 就等于什么都没发生，绝不报错。 */
if(e.code===KEYMAP.inspect&&!e.repeat){ try{ if(typeof 开始检视==='function')开始检视(); }catch(_eI){} }if(e.code===KEYMAP.jump){S._jumpBuf=0.12;S._jumpHold=true;   /* 【batch189】跳跃改成"输入缓冲"：真正起跳由 updatePlayer 统一判定（土狼时间 / 缓冲 / 空中检查都在那边），这里只登记一次意图；按住=满跳，松手=矮跳 */}if(e.code===KEYMAP.weapon2||e.code==='Digit2')switchWeapon(WEAPON_KNIFE);if(e.code===KEYMAP.weapon1)switchWeapon(WEAPON_GUN);if(e.code===KEYMAP.ladder){ if(e.repeat)return; if(S.mantle>0)return; var nf=performance.now();var ln2=MAP_HAS_LADDER&&Math.abs(camera.position.x-LADDER_X)<1.6&&Math.abs(camera.position.z-LADDER_Z)<1.6;if(ln2&&nf>S.ladderCD){S.onLadder=!S.onLadder;S.ladderCD=nf+250;if(!S.onLadder)S.velY=0;}}if(e.code===KEYMAP.forward&&!e.repeat){var _wt=performance.now();if(_wt-S.wTap<SPRINT_TAP_MS)S.sprintLatch=true;S.wTap=_wt;}});
document.addEventListener('keyup',function(e){_raw[e.code]=false;if(e.code===KEYMAP.jump)S._jumpHold=false;});   /* 【batch189】松开跳跃键 → 可变跳跃高度（上升被截断） */
// 滚轮切枪。原来把所有滚轮事件都当成"切枪"，有两种误伤：
//  · 触控板两指横扫会发出横向 wheel，被浏览器当成前进/后退手势 → 只认纵向滚动
//  · 触摸屏/触控板双指捏合会发出 Ctrl+wheel（整页缩放，画面会被缩放毁掉）→ 直接屏蔽
document.addEventListener('wheel',function(e){
  if(e.ctrlKey){if(e.cancelable)e.preventDefault();return;}
  if(!S.playing||S.over||S.paused)return;
  var _dx=Math.abs(e.deltaX||0),_dy=Math.abs(e.deltaY||0);
  if(_dx>_dy){if(e.cancelable)e.preventDefault();return;}   // 横向为主＝触控板横扫，不切枪也不翻页
  if(rightMouseDown&&e.cancelable)e.preventDefault();        // 正在开镜（按住右键）时，滚动一律不交给浏览器
  if(currentWeapon===WEAPON_GUN)switchWeapon(WEAPON_KNIFE);else switchWeapon(WEAPON_GUN);
},{passive:false});
// 【重要】失去指针锁（按 Esc / Alt+Tab / 切窗口）时一律呼出开始菜单。
// 原判定额外要求 S.left>0（本波剩余敌人数），而多人对战从不调用 nextWave()，S.left 恒为 0
// → 通过隧道联机时按 Esc 永远弹不出菜单。这里统一改调 openGameMenu()。
document.addEventListener('pointerlockchange',function(){
  pointerLocked=(document.pointerLockElement===document.body);
  if(typeof lockHintSync==='function')lockHintSync();
  if(pointerLocked){
    _lockErr=0;_lockUnavailable=false;S.paused=false;
    document.getElementById('blocker').style.display='none';
    var rb=document.getElementById('relockBtn');if(rb)rb.style.display='none';
  }else{
    _lockToken++;
    // 【bug 修复】「战斗间歇商店 / 武器选择」是我们自己主动 exitPointerLock() 的（见 showWaveShop / showWeaponSelect），
    // 那一次也会触发 pointerlockchange。原来这里无条件 openGameMenu() → 浮层上又盖一层
    // 暂停菜单，玩家就"卡在界面里"（点继续也不是、点浮层也不是），而且因为浮层 z-index 低于 blocker，面板会被遮住看不见。
    // 全屏浮层（商店 / 结算 / 武器选择）开着时不弹暂停菜单，交给它自己的按钮收尾。
    if(overlayOpen()||weaponSelectOpen())return;
    /* 【batch229】开聊天框主动退锁也会走到这：别把聊天误判成"玩家按 Esc 暂停"，
       否则一按 Enter 聊天就弹暂停菜单。聊天退锁由 62 用 window.__聊天退锁 标记。 */
    try{ if(window.__聊天退锁) return; }catch(e){}
    openGameMenu();
  }
});
document.getElementById('startBtn').addEventListener('click',function(){
  if(S.playing&&S.paused&&!S.over){closeGameMenu();return;}   // 游戏中暂停：这个按钮＝「继续游戏」
  startSoloGame();
});
document.addEventListener('mousedown',function(e){if(weaponSelectOpen()||spOpen)return;var target=e.target;while(target&&target!==document.body){if(target.id==='wave-shop'||target.id==='weapon-select'||target.id==='blocker'||target.id==='go'||target.id==='keyPanel'||target.id==='netPanel'||target.id==='lockHint'||target.id==='modPanel')return;target=target.parentElement;}if(S.paused&&!S.over&&S.playing){_lockErr=0;_lockUnavailable=false;if(!isTouch)lockPointer();closeGameMenu();return;}
  // 电脑端在游戏中点了画面但指针还没锁上 → 这一下只用来"重新锁定"，不当作开枪
  if(e.button===0&&!isTouch&&S.playing&&!S.over&&!S.paused&&!pointerLocked){_lockErr=0;_lockUnavailable=false;lockPointer();return;}
  if(e.button===0){if(SK.ghost>0){e.preventDefault();heroPortalPlace();return;}   /* 【batch145】虚化中：左键＝放下门 */
                   if(heroBallFire()){e.preventDefault();return;}if(heroAimStart()){e.preventDefault();return;}mouseDown=true;freshTrigger=true;if(S.playing&&!S.over&&!S.paused)attack();}if(e.button===1)e.preventDefault();if(e.button===2){if(SK.hold&&SK.hold.kind==='ball'){e.preventDefault();return;}if(SK.hold){heroHoldCancel();e.preventDefault();return;}rightMouseDown=true;if(S.adsToggle){S.aiming=!S.aiming;}else{S.aiming=true;}e.preventDefault();}});
document.addEventListener('mouseup',function(e){if(e.button===0){mouseDown=false;freshTrigger=false;heroAimEnd();}if(e.button===2){rightMouseDown=false;if(!S.adsToggle)S.aiming=false;}});
// ==================== 开镜方式：按住右键 / 点一下切换 ====================
// 【为什么要做】Edge 114+ 自带「鼠标手势」：按住右键移动鼠标＝浏览器手势（左滑后退、下划刷新…），
// 而「按住右键开镜＋拖鼠标瞄准」恰好就是这个动作 → 瞄准时被浏览器抢走。
// 网页无法关闭浏览器的鼠标手势（那是浏览器 UI 层的功能），只能让游戏不再依赖长按右键。
// 切换模式下：点一下右键开镜、再点一下关镜；右键单击不会触发手势（手势需要移动鼠标）。
var ADS_KEY='gunGame.adsMode.v1';
function adsLoad(){try{S.adsToggle=(localStorage.getItem(ADS_KEY)==='toggle');}catch(e){S.adsToggle=false;}}
function adsSave(){try{localStorage.setItem(ADS_KEY,S.adsToggle?'toggle':'hold');}catch(e){}}
function adsApplyUI(){
  var v=document.getElementById('spAdsVal'),b=document.getElementById('spAdsMode');
  if(v)v.textContent=S.adsToggle?'点一下切换':'按住右键';
  if(b)b.textContent=S.adsToggle?'🔄 切换为「按住右键」':'🔄 切换为「点一下开镜」（防浏览器鼠标手势）';
}
function adsSet(t){S.adsToggle=!!t;adsSave();adsApplyUI();if(!S.adsToggle)S.aiming=false;}
adsLoad();adsApplyUI();
var _adsBtn=document.getElementById('spAdsMode');
if(_adsBtn)_adsBtn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();adsSet(!S.adsToggle);});
document.addEventListener('contextmenu',function(e){e.preventDefault();});
// ==================== 屏蔽浏览器手势 ====================
// 电脑端在游戏画面上滑动（触控板两指滑 / 触摸屏手指滑）转视角时，
// 浏览器会把它当成"翻页返回 / 下拉刷新 / 双指缩放"，视角直接被抢走。
// 做法：只有当触点落在"游戏画面本身"（画布或 body，即没有任何浮层盖住）时才拦截；
//       暂停菜单 / 改装界面 / 设置 / 改键 / 联机 / 调试面板都是全屏浮层，
//       触点落在它们身上一律不拦 —— 面板滚动、滑块拖动、按钮点按全部照旧。
function isPlaySurface(t){
  if(!t)return false;
  if(t===document.body||t===document.documentElement)return true;
  return t.tagName==='CANVAS';
}
function stopBrowserGesture(e){
  if(!e.cancelable)return;
  if(!S.playing||S.paused||S.over)return;      // 菜单/暂停/改装界面开着时不拦，保证能正常操作
  if(!isPlaySurface(e.target))return;
  e.preventDefault();
}
document.addEventListener('touchstart',stopBrowserGesture,{passive:false});
document.addEventListener('touchmove',stopBrowserGesture,{passive:false});
// Safari 的双指缩放走私有 gesture 事件，单独拦一次
document.addEventListener('gesturestart',function(e){if(S.playing&&!S.paused&&!S.over&&isPlaySurface(e.target))e.preventDefault();},{passive:false});
document.addEventListener('gesturechange',function(e){if(S.playing&&!S.paused&&!S.over&&isPlaySurface(e.target))e.preventDefault();},{passive:false});
// 拖动转向时别让浏览器进入「选中文字 / 拖拽元素」模式，否则拖动会被打断
document.addEventListener('selectstart',function(e){if(S.playing&&!S.over)e.preventDefault();});
document.addEventListener('dragstart',function(e){e.preventDefault();});
document.addEventListener('mousemove',function(e){
  if(!S.playing||S.paused||S.over)return;
  // 锁定成功时 pointerLocked 就够；锁不上时按左键（射击/拖动）或右键（开镜/拖动）都能转视角。
  // 特意支持左键拖动：浏览器的「鼠标手势」只认右键拖动，左键拖动不会被它抢走。
  if(!(pointerLocked||rightMouseDown||mouseDown))return;
  if(e.cancelable)e.preventDefault();   // 别让浏览器把这次拖动当成手势/选中/拖拽
  var mx=e.movementX||0,my=e.movementY||0;
  var MAX_RAW=120;mx=Math.max(-MAX_RAW,Math.min(MAX_RAW,mx));my=Math.max(-MAX_RAW,Math.min(MAX_RAW,my));
  var mag=Math.sqrt(mx*mx+my*my);var SOFT_CAP=60;
  if(mag>SOFT_CAP){var scale=SOFT_CAP+(mag-SOFT_CAP)*0.3;var ratio=scale/mag;mx*=ratio;my*=ratio;}
  var _sm=1-S.aimProgress*0.55;yaw-=mx*S.sens*_sm;pitch-=my*S.sens*_sm;pitch=Math.max(-1.4,Math.min(1.4,pitch));
  camera.quaternion.setFromEuler(new THREE.Euler(pitch+(S.recoilPunch||0),yaw,S.roll||0,'YXZ'));
});
