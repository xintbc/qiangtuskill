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
/* ============================================================================
   【1.10.18】触屏操作整段移交 js/72_手机操作.js
   ----------------------------------------------------------------------------
   这里原先有：固定圆摇杆(#joyBase)、铺满屏的视角区(#lookPad)、12 个 .tbtn 按键，
   外加一套"电脑上 ?touch=1 调试"的鼠标兜底。
   它们全部删掉了 —— 不是因为写得不好，是因为**结构本身撑不住**：
   位置靠 JS 逐像素摆、按键之间 20px、视角区和按钮抢同一批触摸事件。
   新的一套（js/72）改成纯 CSS 定位 + 分区触摸 + 弧形键簇 + 技能 HUD 直接可点。
   这里只留一个 tapKey：**其它分片仍然靠它把触屏操作翻译成真实键盘事件**
   （比如剧情里按 F 上梯、按空格跳，走同一条代码路径才不会两边行为不一致）。
   ============================================================================ */
function tapKey(code){
  try{ document.dispatchEvent(new KeyboardEvent('keydown',{code:code,bubbles:true})); }catch(e){}
  setTimeout(function(){
    try{ document.dispatchEvent(new KeyboardEvent('keyup',{code:code,bubbles:true})); }catch(e){}
  },60);
}

// ==================== 触屏设置：灵敏度 / 小地图 / 摇杆 / 游戏内暂停菜单 ====================
var TUNING_KEY='gunGame.touchTuning.v1';
var MM_SIZE=120;
function tuningLoad(){try{var t=JSON.parse(localStorage.getItem(TUNING_KEY)||'null');if(t){if(t.sens)S.sensMul=t.sens;if(t.mm)MM_SIZE=Math.round(t.mm);}}catch(e){}}
function tuningSave(){try{localStorage.setItem(TUNING_KEY,JSON.stringify({sens:S.sensMul,mm:MM_SIZE}));}catch(e){}}
function tuningApplyUI(){
  var cv=document.getElementById('minimap');
  if(cv){cv.style.width=MM_SIZE+'px';cv.style.height=MM_SIZE+'px';}
  /* 摇杆尺寸不再可调：新摇杆是按 --u 设计像素算的，调大小会让"落指点"和"视觉圈"错开 */
}
function tuningApplyToUI(){
  var s1=document.getElementById('spSens'),v1=document.getElementById('spSensVal');
  if(s1)s1.value=S.sensMul;if(v1)v1.textContent=Number(S.sensMul).toFixed(2)+'x';
  var s2=document.getElementById('spMM'),v2=document.getElementById('spMMVal');
  if(s2)s2.value=MM_SIZE;if(v2)v2.textContent=MM_SIZE;
  /* 【1.9.43】界面大小倍率回填滑块 */
  var su=document.getElementById('spUi'),vu=document.getElementById('spUiVal');
  if(su){
    /* 【1.10.24】滑块下限跟视口走：窄屏拉到最左 = 刚好铺满，不是"缩成一小块" */
    var _mn=0.5;try{if(typeof 界面最小倍率==='function')_mn=Math.ceil(界面最小倍率()*20)/20;}catch(e){}
    if(_mn<0.5)_mn=0.5;
    su.min=String(_mn);
    var _uk=1;try{if(typeof 读界面缩放==='function')_uk=读界面缩放();}catch(e){}
    if(_uk<_mn)_uk=_mn;
    su.value=_uk;if(vu)vu.textContent=Number(_uk).toFixed(2)+'x';
  }
}
function applyTuning(){
  tuningLoad();
  if(!(S.sensMul>0))S.sensMul=1;
  if(!(MM_SIZE>=80))MM_SIZE=120;
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

// ==================== 触屏设置（1.10.18 精简） ====================
/* 旧的「按键布局自定义」整段删除：LAYOUT_KEY / TS_DESIGN / layoutFit / layoutBindDrag /
   编辑态顶栏 / 16 个按钮的设计坐标表。
   为什么不能留：那套东西的坐标是"距右边多少 px"，按 760 设计；1.10.17 为了修 bug 改了
   反推公式，结果 layoutClampAll 把夹回来的错误坐标**写进了 localStorage**，
   于是"换枪"这种 dx=630 的键在 800px 宽的屏上直接跑到屏幕左边 —— 这就是用户说的
   「17 版修复后更乱了」。新布局是 CSS 算的，没有可存的像素，这整套机制彻底不需要了。
   ⚠️ 顺手把旧存档键删掉：不删的话，以后任何一次读到它都会把错位坐标再写回来。 */
try{ localStorage.removeItem('gunGame.touchLayout.v1'); localStorage.removeItem('gunGame.touchLayout.v2'); }catch(e){}

var spOpen=false,menuPrevPaused=null;
var layoutEdit=false;      /* 兼容：js/60 会把它设 false；新布局不接受拖动编辑 */

function menuPauseSync(){
  if(spOpen){ if(menuPrevPaused===null){ menuPrevPaused=S.paused; S.paused=true; } }
  else if(menuPrevPaused!==null){ S.paused=menuPrevPaused; menuPrevPaused=null; }
}
function openSettings(on){
  spOpen=on;
  var p=document.getElementById('settingsPanel');if(p)p.classList.toggle('on',on);
  if(on){keys.KeyW=keys.KeyS=keys.KeyA=keys.KeyD=false;mouseDown=false;S.aiming=false;}
  menuPauseSync();
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
  /* 【1.9.43】界面大小：拖动立刻生效（自动适配 × 倍率），存 localStorage */
  var _su=document.getElementById('spUi');if(_su)_su.addEventListener('input',function(){var k=parseFloat(_su.value)||1;var v=document.getElementById('spUiVal');if(v)v.textContent=k.toFixed(2)+'x';if(typeof 设界面缩放==='function')设界面缩放(k);});
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
  /* 【1.9.50】瓦罗兰特模式开关 */
  (function(){
    /* 【1.9.55】客户端内升级
       —— 只有内嵌客户端（电脑 exe / 手机 app）才有 /api/update/* 这个接口；
          网页版 fetch 会 404，catch 掉就行，面板一直隐藏。
       流程：检查 → 点升级 → 后台下载官方安装程序 → /S <当前目录> /等待 <pid> /启动
             → 本进程退出 → 安装器覆盖同目录 → 自动启动新版本。
       ⚠️ 升级只装回"当前这个目录"，绝不会改到 C 盘默认目录。 */
    (function(){
      var 盒=document.getElementById('spUpdateBox');
      if(!盒) return;
      var 版本标签=document.getElementById('spUpNow');
      var 按钮=document.getElementById('spUpCheck');
      var 提示行=document.getElementById('spUpHint');
      var 检查中=false, 可升级=null;

      /* 【1.9.61】版本号立刻用「正在运行的代码版本」GAME_VER 填上，不再等联网。
         以前要等 3 秒定时 + 一次联网检查（慢时 11~23 秒）才填，期间一直是「—」；
         网络失败就永远「—」，C 端解析不到 index.html 的 ?v= 时还会给「未知」；
         网页版/手机版没有 /api 接口，整块被隐藏，连版本都看不到。 */
      var 运行版本=(typeof GAME_VER!=='undefined'&&GAME_VER)?String(GAME_VER):'—';
      版本标签.textContent=运行版本;
      盒.style.display='block';

      function 说(html){ if(提示行) 提示行.innerHTML=html; }
      function 版本段(v){ var t=String(v||'').split('.'), r=[]; for(var i=0;i<3;i++){ var n=parseInt(t[i],10); r.push(isNaN(n)?0:n); } return r; }
      function 版本比(a,b){ var x=版本段(a), y=版本段(b); for(var i=0;i<3;i++){ if(x[i]!==y[i]) return x[i]-y[i]; } return 0; }
      function 没接口(因){
        可升级=null;
        if(按钮) 按钮.style.display='none';
        说('当前版本 <b>'+运行版本+'</b>'+(因?'（'+因+'）':'')+'<br>网页版 / 手机版没有一键更新，装新版请手动安装安装包。');
      }

      function 查(){
        if(检查中) return;
        检查中=true; if(按钮) 按钮.disabled=true;
        说('正在检查…');
        fetch('/api/update/check',{cache:'no-store'}).then(function(r){
          return r.text().then(function(t){
            var j=null; try{ j=JSON.parse(t); }catch(e){}
            return { 状态:r.status, 体:j };
          });
        }).then(function(o){
          检查中=false;
          if(按钮) 按钮.disabled=false;
          var j=o.体;
          if(!j){ 没接口('本地没有更新接口'); return; }      /* 接口不存在 → 网页版 / 手机版 */
          if(按钮) 按钮.style.display='';
          if(!j.ok){
            if(o.状态===503) 说('上一次检查还没结果，稍等一下再点一次。');
            else 说('检查失败：'+((j.err)||'未知原因')+'<br>当前版本 <b>'+运行版本+'</b>');
            return;
          }
          /* 主显示永远是「运行版本」；安装文件版本不一致只加一句说明，不换掉版本号 */
          var 备注='';
          if(j.now&&j.now!==运行版本)
            备注='<br><span style="color:#ffb347">安装文件版本 '+j.now+' 与运行版本 '+运行版本+' 不一致（文件被单独替换过？），已按运行版本判断。</span>';
          if(j.new&&版本比(j.new,运行版本)>0){
            可升级=j.new;
            if(按钮) 按钮.textContent='⬆ 升级到 '+j.new+' 并重启';
            说('发现新版本 <b>'+j.new+'</b>：点上面的按钮就会自动下载安装，<b>装完自己重启</b>（同目录覆盖，存档不动）。'+备注);
          }else{
            可升级=null;
            if(按钮) 按钮.textContent='已是最新';
            说('已经是最新版本（'+运行版本+'）。'+备注);
          }
        }).catch(function(){       /* fetch 直接失败：本机服务没响应，可重试 */
          检查中=false;
          if(按钮){ 按钮.disabled=false; 按钮.style.display=''; }
          说('没连上本地更新服务，点「检查更新」再试一次。<br>当前版本 <b>'+运行版本+'</b>');
        });
      }

      按钮.addEventListener('click', function(){
        if(!可升级){ 查(); return; }
        按钮.disabled=true;
        说('正在下载安装包，<b>装完会自动重启</b>，请等一会儿（别关窗口）…');
        fetch('/api/update/apply',{cache:'no-store'}).then(function(){ 
          说('安装程序已启动：本窗口马上退出，装好会自动开新版本。');
        }).catch(function(){ 按钮.disabled=false; 说('启动安装失败，请稍后再试。'); });
      });

      /* 先藏按钮：确认有接口再显示，网页版就不会闪一个按了没反应的按钮 */
      if(按钮) 按钮.style.display='none';
      setTimeout(查, 2500);
    })();

    var 按钮=document.getElementById('spValToggle');
    var 标签=document.getElementById('spValVal');
    function 刷() {
      if(标签)标签.textContent=瓦罗兰特?'瓦罗兰特':'默认';
      if(按钮)按钮.textContent=瓦罗兰特?'切回「默认模式」（正常散射）':'切换为「瓦罗兰特模式」';
    }
    if(按钮)按钮.addEventListener('click',function(e){
      e.preventDefault();e.stopPropagation();
      瓦罗兰特=!瓦罗兰特;
      try{localStorage.setItem('gunGame.valorant.v1',瓦罗兰特?'1':'0');}catch(_e){}
      S.valSpread=0;S.valFiring=0;S.valPitch0=0;
      try{ if(typeof showMsg==='function')showMsg(瓦罗兰特?'🔫 瓦罗兰特模式：首发零散射':'已切回默认射击模式','#8ee6ff'); }catch(_e){}
      刷();
    });
    刷();
  })();
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
