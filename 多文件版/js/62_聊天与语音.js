/* 【batch228】聊天与语音（js/62_聊天与语音.js）====================================
   ----------------------------------------------------------------------------
   对应主人要求：「Add chat and voice chat features so players can open their
   microphone to talk or type messages in chat.」

   ① 文字聊天（联机）
      · Enter 打开输入框（游戏里也能发：先按 Esc 放鼠标，或战斗中直接打）
      · 输入时 WASD 不被吞（输入框自己拦按键）
      · 同房广播走服务端 t:'chat'（内容限 200 字，服务端再拦一道）
      · 左侧历史区：自己发的白色，别人按服务端给的颜色
   ② 语音聊天（不引 WebRTC，走服务端 WS 二进制转发 —— 同局域网延迟足够）
      · 按住 G 说话（PTT）：getUserMedia 采麦 → MediaRecorder(opus/webm) 100ms 切片
        → 二进制帧 [4字节说话人id][音频] → 服务端转同房 → 别人 MediaSource 播放
      · 松开 T 停；说话时头顶出小喇叭标识，HUD 上也有"正在说话"名单
      · 麦克风权限被拒 / 没有麦：给明确提示，不崩
      · 设置面板里可关掉语音（默认开）
   ⚠️ 三条加载路径都能播音频：file:// 受自动播放策略限制最少的是"用户已交互过"，
      进游戏前玩家点过按钮，AudioContext/MediaSource 都能起。
   ========================================================================= */
(function 聊天语音(){

var CHAT_KEY = 'gunGame.chat.v1';          // 本地聊天历史（最近 50 条）
var VOICE_KEY = 'gunGame.voice.v1';        // 语音开关
var PTT_KEY = 'KeyG';                      // 按住说话（T 是英雄第二技能，占了；G 空闲）

var 开 = false;                            // 输入框开着
var 语音开 = true;                         // 总开关（设置里改）
var 说中 = false;                          // 我正在说
var 录音器 = null;
var 麦流 = null;
var 取消麦 = 0;                            // 【batch229】开麦取消标记：解决"松手太快关不掉"的竞态
var 说话者们 = {};                         // id -> {名字, 麦:MediaSource实例...}
var 帧序号 = 0;

/* ---------------- 工具 ---------------- */
function 存(key, v){ try{ localStorage.setItem(key, v); }catch(e){} }
function 取(key){ try{ return localStorage.getItem(key); }catch(e){ return null; } }
function 颜色Hex(c){ return '#' + (c >>> 0).toString(16).padStart(6, '0'); }

/* ---------------- DOM（全部 JS 建，不动 index.html） ---------------- */
var 历史框 = null, 输入框 = null, 名单框 = null, 聊天钮 = null, 语音钮 = null;

function 建DOM(){
    if (document.getElementById('chatWrap')) return;
    var css = document.createElement('style');
    css.textContent =
      '#chatWrap{position:fixed;left:10px;bottom:10px;width:min(340px,42vw);z-index:60;font-family:"Microsoft YaHei UI",sans-serif;pointer-events:none;}' +
      '#chatLog{max-height:132px;overflow-y:auto;font-size:12.5px;line-height:1.55;padding:6px 8px;background:rgba(8,10,18,.55);border-radius:8px;margin-bottom:6px;pointer-events:auto;}' +
      '#chatLog div{word-break:break-all;}' +
      '#chatLog .sys{color:#9fb0c8;}' +
      '#chatLog .me{color:#fff;}' +
      '#chatInput{width:100%;box-sizing:border-box;display:none;padding:7px 10px;font-size:13px;color:#fff;background:rgba(8,10,18,.85);border:1px solid rgba(120,180,255,.45);border-radius:8px;outline:none;pointer-events:auto;}' +
      '#chatInput:focus{border-color:rgba(120,200,255,.9);}' +
      '#chatTalkers{position:fixed;right:12px;top:64px;z-index:60;display:flex;flex-direction:column;gap:4px;pointer-events:none;}' +
      '#chatTalkers .tk{display:flex;align-items:center;gap:5px;padding:3px 9px;font-size:12px;color:#dff;background:rgba(20,60,80,.72);border:1px solid rgba(90,220,255,.4);border-radius:20px;}' +
      '#chatTalkers .tk i{width:7px;height:7px;border-radius:50%;background:#4fe37a;box-shadow:0 0 6px #4fe37a;}' +
      /* 【batch229】手机端：聊天 + 语音两个触屏按钮（只触屏显示，复用 tbtn 深色风格） */
      '#chatBtn,#voiceBtn{position:fixed;display:none;z-index:60;align-items:center;justify-content:center;' +
        'width:56px;height:56px;border-radius:14px;background:rgba(40,40,60,.62);border:2px solid rgba(255,255,255,.38);' +
        'color:#fff;font-size:13px;font-weight:bold;pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;}' +
      '#chatBtn{left:14px;bottom:150px}' +
      '#voiceBtn{left:14px;bottom:214px}' +
      '#voiceBtn.on{background:rgba(200,40,40,.72);border-color:rgba(255,140,140,.6);}' +
      'body.is-touch #chatBtn,body.is-touch #voiceBtn{display:flex}';
    document.head.appendChild(css);

    历史框 = document.createElement('div');
    历史框.id = 'chatLog';
    var 包 = document.createElement('div');
    包.id = 'chatWrap';
    包.appendChild(历史框);
    输入框 = document.createElement('input');
    输入框.id = 'chatInput';
    输入框.maxLength = 200;
    输入框.placeholder = '输入消息，Enter 发送，Esc 取消';
    包.appendChild(输入框);
    document.body.appendChild(包);

    名单框 = document.createElement('div');
    名单框.id = 'chatTalkers';
    document.body.appendChild(名单框);

    /* 【batch229】手机端聊天 + 语音触屏按钮 */
    聊天钮 = document.createElement('div');
    聊天钮.id = 'chatBtn'; 聊天钮.textContent = '💬';
    聊天钮.addEventListener('touchstart', function(e){
        e.preventDefault(); e.stopPropagation();
        if (开) { 关输入(); } else if (S && S.playing) 开输入();
    }, { passive: false });
    document.body.appendChild(聊天钮);

    语音钮 = document.createElement('div');
    语音钮.id = 'voiceBtn'; 语音钮.textContent = '🎙️';
    语音钮.addEventListener('touchstart', function(e){
        e.preventDefault(); e.stopPropagation();
        if (开) { 关输入(); return; }
        开麦(); 语音钮.classList.add('on');
    }, { passive: false });
    语音钮.addEventListener('touchend', function(e){
        e.preventDefault(); e.stopPropagation();
        停麦(); 语音钮.classList.remove('on');
    });
    语音钮.addEventListener('touchcancel', function(e){ 停麦(); 语音钮.classList.remove('on'); });
    document.body.appendChild(语音钮);

    /* 按键：Enter 开输入框；开着时 WASD 不触发游戏（输入框自己吞） */
    document.addEventListener('keydown', function(e){
        if (e.code === 'Enter' && !开) {
            if (typeof S !== 'undefined' && S && S.playing === false) return;   // 主菜单不开
            /* 焦点在别的输入框（联机地址框 / 取名面板 / 身份码框）里时，Enter 是它们自己的事 */
            var ae = document.activeElement;
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae !== 输入框) return;
            e.preventDefault(); e.stopPropagation();
            开输入();
            return;
        }
        if (!开) return;
        if (e.code === 'Enter') { e.preventDefault(); 发送(); }
        else if (e.code === 'Escape') { e.preventDefault(); 关输入(); }
        else e.stopPropagation();                    // 别让 WASD/R 等透传到游戏
    }, true);

    /* PTT：按住 G 说话（联机 + 语音开着 + 麦没被禁） */
    document.addEventListener('keydown', function(e){
        if (e.code !== PTT_KEY || 开 || !语音开) return;
        if (typeof S !== 'undefined' && S && S.playing === false) return;
        e.stopPropagation();
        开麦();
    }, true);
    document.addEventListener('keyup', function(e){
        if (e.code !== PTT_KEY) return;
        停麦();
    }, true);
    window.addEventListener('blur', 停麦);

    /* 历史 */
    var 旧 = [];
    try{ 旧 = JSON.parse(取(CHAT_KEY) || '[]'); }catch(e){}
    旧.slice(-30).forEach(function(m){ 加一行(m.n, m.c, m.x, m.系); });
}

function 开输入(){
    开 = true;
    输入框.style.display = 'block';
    输入框.value = '';
    setTimeout(function(){ try{ 输入框.focus(); }catch(e){} }, 0);
    /* 【batch229】开聊天框要退指针锁（否则鼠标还锁着点不到输入框），但退锁会触发
       pointerlockchange → openGameMenu 弹暂停菜单。用 window.__聊天退锁 标记，让 22_输入与手势
       的 pointerlockchange 在这一下跳过 openGameMenu。 */
    try{ window.__聊天退锁 = 1; }catch(e){}
    try{ if(document.exitPointerLock) document.exitPointerLock(); }catch(e){}
    setTimeout(function(){ try{ window.__聊天退锁 = 0; }catch(e){} }, 200);
}
function 关输入(){
    开 = false;
    输入框.style.display = 'none';
    输入框.blur();
    /* 关输入框后游戏还在暂停态（指针没锁），不用自动锁回 —— 玩家点一下画面就锁（22 里 mousedown 处理） */
}
function 发送(){
    var v = String(输入框.value || '').trim();
    if (!v) { 关输入(); return; }
    if (typeof netSend === 'function' && typeof netIsMulti === 'function' && netIsMulti() && typeof NET !== 'undefined' && NET.connected) {
        netSend({ t: 'chat', x: v });
    } else {
        加一行('我', 0xffffff, v, 1);
    }
    关输入();
}
function 加一行(名, 色, 文, 系){
    if (!历史框) return;
    var d = document.createElement('div');
    if (系) { d.className = 'sys'; d.textContent = '【' + 名 + '】' + 文; }
    else {
        var 名span = document.createElement('span');
        名span.style.color = 颜色Hex(色 || 0xffffff);
        名span.textContent = '【' + 名 + '】';
        d.appendChild(名span);
        d.appendChild(document.createTextNode(文));
        if (typeof S !== 'undefined' && S && S.playerName && 名 === S.playerName) d.className = 'me';
    }
    历史框.appendChild(d);
    while (历史框.children.length > 60) 历史框.removeChild(历史框.firstChild);
    历史框.scrollTop = 历史框.scrollHeight;
    if (!系) {
        try{
            var 旧 = JSON.parse(取(CHAT_KEY) || '[]');
            旧.push({ n: 名, c: 色, x: 文 });
            if (旧.length > 50) 旧 = 旧.slice(-50);
            存(CHAT_KEY, JSON.stringify(旧));
        }catch(e){}
    }
}

/* ---------------- 联机消息接入（30_联机.js 的 netOnMsg 之前钩） ---------------- */
/* 实现方式：轮询等待 netOnMsg 就绪后包一层（分片加载顺序不可靠，钩子最稳） */
function 挂钩子(){
    if (typeof window.netOnMsg !== 'function') { setTimeout(挂钩子, 200); return; }
    if (window.netOnMsg.__聊天钩) return;
    var 原 = window.netOnMsg;
    function 包(m){
        try{
            if (m && m.t === 'chat' && typeof m.x === 'string') {
                if (m.i !== (typeof NET !== 'undefined' ? NET.id : 0)) 加一行(m.n || '?', m.c || 0, m.x);
                return;
            }
            if (m && m.t === 'voice') {
                if (m.i === (typeof NET !== 'undefined' ? NET.id : 0)) return;
                if (m.on) 加说话者(m.i, m.n || '?'); else 删说话者(m.i);
                return;
            }
        }catch(e){}
        return 原.apply(this, arguments);
    }
    包.__聊天钩 = 1;
    window.netOnMsg = 包;
}

/* ---------------- 语音 ---------------- */
function 加说话者(id, 名){
    if (说话者们[id]) { 刷新名单(); return; }
    var 项 = { 名: 名, 帧: 0 };
    说话者们[id] = 项;
    刷新名单();
}
function 删说话者(id){
    delete 说话者们[id];
    刷新名单();
}
function 刷新名单(){
    if (!名单框) return;
    名单框.innerHTML = '';
    for (var k in 说话者们) {
        var d = document.createElement('div');
        d.className = 'tk';
        d.innerHTML = '<i></i>';
        var s = document.createElement('span');
        s.textContent = 说话者们[k].名 + ' 说话中';
        d.appendChild(s);
        名单框.appendChild(d);
    }
}

function 开麦(){
    if (说中 || !语音开) return;
    if (typeof netIsMulti !== 'function' || !netIsMulti() || typeof NET === 'undefined' || !NET.connected) {
        if (typeof showMsg === 'function') showMsg('语音只在连上服务器时可用', '#ffd166');
        return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (typeof showMsg === 'function') showMsg('这个环境不支持麦克风（需要 https 或 localhost）', '#ffd166');
        return;
    }
    var 代 = ++取消麦;                       // 每次开麦记一个新代次，停麦时取消它
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(流){
        /* 【batch229】松手太快：停麦() 早就跑过了（当时 说中 还是 false，没进 stop 逻辑），
           而 getUserMedia 是异步的，授权/初始化要几十到几百毫秒 —— 等这个回调回来时人已经松手了，
           如果还往下走就会"开麦了却关不掉"。用取消标记：代次对不上说明已经停麦，直接收流返回。 */
        if (代 !== 取消麦) { 流.getTracks().forEach(function(t){ t.stop(); }); return; }
        麦流 = 流;
        var 选项 = {};
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            选项.mimeType = 'audio/webm;codecs=opus';
        }
        录音器 = new MediaRecorder(流, 选项);
        录音器.ondataavailable = function(e){
            if (!e.data || !e.data.size) return;
            var r = new FileReader();
            r.onload = function(){
                var 字节 = new Uint8Array(r.result);
                var 包 = new Uint8Array(字节.length + 4);
                var v = new DataView(包.buffer);
                v.setUint32(0, (typeof NET !== 'undefined' ? NET.id : 0), false);
                包.set(字节, 4);
                try{ if (NET.ws && NET.ws.readyState === 1) NET.ws.send(包.buffer); }catch(err){}
            };
            r.readAsArrayBuffer(e.data);
        };
        录音器.start(100);                    // 100ms 切片，低延迟
        说中 = true;
        if (typeof netSend === 'function') netSend({ t: 'voice', on: 1 });
        if (typeof showMsg === 'function') showMsg('🎙️ 松开发言完毕（按住 G 说话）', '#6ff0ff');
    }).catch(function(err){
        if (代 !== 取消麦) return;            // 已经停麦了，别弹错
        var 原因 = '麦克风打不开';
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) 原因 = '麦克风权限被拒绝——点地址栏左边的图标允许麦克风';
        else if (err && err.name === 'NotFoundError') 原因 = '没检测到麦克风设备';
        if (typeof showMsg === 'function') showMsg('🎙️ ' + 原因, '#ffd166');
    });
}
function 停麦(){
    取消麦++;                                 // 让还没回来的 getUserMedia 回调直接收流返回
    if (!说中) return;
    说中 = false;
    try{ if (录音器 && 录音器.state !== 'inactive') 录音器.stop(); }catch(e){}
    try{ if (麦流) 麦流.getTracks().forEach(function(t){ t.stop(); }); }catch(e){}
    录音器 = null; 麦流 = null;
    if (typeof netSend === 'function') netSend({ t: 'voice', on: 0 });
}

/* 收到别人的语音二进制帧（在 netOnMsg 钩里接 WS onmessage 之前包一层） */
function 接语音(){
    if (typeof window.NET === 'undefined' || !NET.ws) { setTimeout(接语音, 300); return; }
    if (NET.ws.__语音钩) return;
    /* ⚠️ binaryType 默认是 'blob'：语音二进制帧会以 Blob 到来，readAsArrayBuffer 那套全废。
       建连时必须设成 arraybuffer。 */
    try{ NET.ws.binaryType = 'arraybuffer'; }catch(e){}
    var 原on = NET.ws.onmessage;
    NET.ws.onmessage = function(e){
        try{
            if (e && e.data && e.data instanceof ArrayBuffer) {
                var 字节 = new Uint8Array(e.data);
                if (字节.length > 4) {
                    var id = new DataView(字节.buffer).getUint32(0, false);
                    if (id !== NET.id) {
                        var p = (typeof NET.players !== 'undefined') ? NET.players[id] : null;
                        if (p && !p.麦) p.麦 = 建播放器();
                        if (p && p.麦) {
                            p.麦.尾 = 字节.subarray(4);
                            喂(p);
                        }
                    }
                }
                return;
            }
        }catch(err){}
        if (原on) return 原on.apply(this, arguments);
    };
    NET.ws.__语音钩 = 1;
    /* 换连接（重连）后旧钩子失效 → 重连时清播放器、重新钩 */
    if (typeof netConnect === 'function' && !netConnect.__语音重钩) {
        netConnect.__语音重钩 = 1;
        var 原连 = netConnect;
        window.netConnect = function(){
            var r = 原连.apply(this, arguments);
            setTimeout(接语音, 800);
            return r;
        };
    }
}

/* 每个说话者一个 MediaSource 播放器（首个 chunk 含 webm 初始化信息，后续直接 append） */
function 建播放器(){
    var a = document.createElement('audio');
    a.autoplay = true;
    document.body.appendChild(a);
    var 项 = { a: a, ms: null, sb: null, 尾: null, 队列: [], 起: false };
    try{
        if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported && MediaSource.isTypeSupported('audio/webm;codecs=opus')) {
            var ms = new MediaSource();
            a.src = URL.createObjectURL(ms);
            ms.addEventListener('sourceopen', function(){
                try{
                    项.sb = ms.addSourceBuffer('audio/webm;codecs=opus');
                    项.sb.mode = 'sequence';
                    项.sb.addEventListener('updateend', function(){ 项.起 = true; 吐(项); });
                }catch(e){}
            });
            项.ms = ms;
        }
    }catch(e){}
    return 项;
}
function 喂(项){
    if (!项 || !项.尾) return;
    if (!项.sb || !项.起) { 项.队列.push(项.尾); if (项.队列.length > 20) 项.队列.shift(); return; }
    try{
        项.sb.appendBuffer(项.尾);
        项.起 = false;
    }catch(e){}
    项.尾 = null;
}
function 吐(项){
    while (项.队列.length && 项.起) {
        try{ 项.sb.appendBuffer(项.队列.shift()); 项.起 = false; }catch(e){ break; }
    }
}

/* ---------------- 初始化 ---------------- */
function 初始化(){
    if (!document.body) { setTimeout(初始化, 100); return; }
    建DOM();
    语音开 = 取(VOICE_KEY) !== '0';
    挂钩子();
    接语音();

    /* 设置面板里加一个语音开关（复用 ctLayer 风格，插在 spClose 前） */
    setTimeout(function(){
        var 板 = document.getElementById('settingsPanel');
        if (!板 || document.getElementById('spVoiceBtn')) return;
        var b = document.createElement('button');
        b.id = 'spVoiceBtn';
        b.className = 'spBtn';
        b.textContent = 语音开 ? '🎙️ 语音聊天：开（按住 G 说话）' : '🎙️ 语音聊天：关';
        b.addEventListener('click', function(e){
            e.preventDefault(); e.stopPropagation();
            语音开 = !语音开;
            存(VOICE_KEY, 语音开 ? '1' : '0');
            if (!语音开) 停麦();
            b.textContent = 语音开 ? '🎙️ 语音聊天：开（按住 G 说话）' : '🎙️ 语音聊天：关';
            if (typeof showMsg === 'function') showMsg(语音开 ? '语音已开：按住 G 说话' : '语音已关', '#6ff0ff');
        });
        var 尾 = document.getElementById('spClose');
        if (尾 && 尾.parentElement) 尾.parentElement.insertBefore(b, 尾);
        else 板.appendChild(b);
    }, 2500);

    /* 断线时清掉说话名单 */
    setInterval(function(){
        if (typeof NET === 'undefined' || !NET.connected) {
            for (var k in 说话者们) 删说话者(+k);
        }
    }, 2000);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') 初始化();
else document.addEventListener('DOMContentLoaded', 初始化);

/* 对外：给模组用 / 给探针回归用 */
window.枪战聊天 = {
  发: function(文){ if (输入框) { 输入框.value = 文; 发送(); } },
  说: function(名, 色, 文){ 加一行(名, 色, 文); },
  开关语音: function(开){ 语音开 = !!开; if (!开) 停麦(); },
  语音状态: function(){ return 语音开; },
  开麦: 开麦,           // 【batch229】暴露给回归探针（内部函数，页面逻辑不受影响）
  停麦: 停麦,
  在说: function(){ return 说中; },
  聊天开着: function(){ return 开; }
};

})();
