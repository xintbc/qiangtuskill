/* 【batch228】自定义资产（js/63_自定义资产.js）====================================
   ----------------------------------------------------------------------------
   对应主人要求：
   「Add a custom flash style system where players can import MP4 files to
    customize flash effects, including playing the audio from the MP4.
    Add customizable backgrounds and main menu background music, with the main
    menu music automatically stopping when the player enters the game.
    All of these custom assets should be placed in the mod folder and are
    player-added rather than part of the base game.」

   资产全部放 mode/模组/（玩家自己往里丢，不属于基础游戏）：
     · 闪光特效：mode/模组/ 下的 .mp4 —— 被闪光弹致盲时全屏播放（含音频），
       致盲时长跟视频时长走（上限 FLASH_VIDEO_MAX 秒）。多个随机选一个。
     · 自定义背景：mode/模组/ 下的 背景.png / 背景.jpg / 背景.mp4 / 背景.webm
       —— 主菜单/暂停菜单背后换图（视频则是动态背景）。
     · 主菜单 BGM：mode/模组/ 下的 音乐.mp3 / 音乐.ogg / 音乐.wav / 音乐.m4a
       —— 主菜单循环播放；**进入游戏自动停**，回主菜单恢复。

   三条加载路径都能读到这些文件（都是相对路径直取，不用 fetch）：
     · 双击 index.html（file://）        → src="mode/模组/x.mp4"（相对路径）
     · 客户端壳子（虚拟主机）            → 自动解析成 https://game.example/游戏/mode/模组/x.mp4
     · 服务器网页（http://服务器/...）   → 同源静态路径 mode/模组/x.mp4
   文件清单从哪来：
     · 服务器模式：/api/mods 的 assets 数组（服务端扫目录，批量228加的）
     · 本地模式（双击/壳子）：用 <video>/<img>/<audio> 元素探测约定文件名
       （闪光.mp4 / 背景.png / 音乐.mp3 … 见 约定清单），onloadeddata/onload 命中即用
   ========================================================================= */
(function 自定义资产(){

var 资产目录 = 'mode/模组/';
var 闪光视频们 = [];          // [{名, url}]
var 背景 = null;              // {名, url, 视频:boolean}
var 音乐 = null;              // {名, url}
var 音乐元素 = null;
var 已就绪 = false;
var 菜单时播放 = false;       // 现在是不是该放 BGM（主菜单/暂停 = true，游戏中 = false）

var FLASH_VIDEO_MAX = 5.0;    // 闪光视频致盲时长上限（秒）
var 音乐音量 = 0.5;

/* 约定文件名探测清单（本地模式列不了目录，只能按约定名试） */
var 约定闪光 = ['闪光.mp4', '闪光特效.mp4', 'flash.mp4', '闪光1.mp4', '闪光2.mp4', '闪光3.mp4', '闪光4.mp4', '闪光5.mp4'];
var 约定背景图 = ['背景.png', '背景.jpg', '背景.jpeg', 'background.png', 'background.jpg'];
var 约定背景视 = ['背景.mp4', '背景.webm', 'background.mp4'];
var 约定音乐 = ['音乐.mp3', '音乐.ogg', '音乐.wav', '音乐.m4a', 'bgm.mp3', 'bgm.ogg', '主菜单音乐.mp3'];

/* ---------------- 小工具 ---------------- */
function 相对(名){ return 资产目录 + 名; }
function 是服务器模式(){
    try{
        return typeof netAutoMode === 'function' && netAutoMode() &&
               typeof location !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:');
    }catch(e){ return false; }
}

/* ---------------- 服务器模式：直接问 /api/mods 要资产清单 ---------------- */
function 拉服务器资产(){
    return new Promise(function(定){
        fetch('api/mods', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(function(j){
            var 列 = (j && j.assets) || [];
            列.forEach(function(a){
                if (!a || !a.n) return;
                var n = String(a.n).toLowerCase();
                if (/\.(mp4|webm)$/.test(n)) {
                    if (/^(背景|background)/.test(n)) 设背景({ 名: a.n, url: 相对(a.n), 视频: n.indexOf('.mp4') >= 0 || n.indexOf('.webm') >= 0 });
                    else 闪光视频们.push({ 名: a.n, url: 相对(a.n) });
                } else if (/\.(png|jpg|jpeg)$/.test(n)) {
                    if (/^(背景|background)/.test(n)) 设背景({ 名: a.n, url: 相对(a.n), 视频: false });
                } else if (/\.(mp3|ogg|wav|m4a|aac|flac)$/.test(n)) {
                    if (/^(音乐|bgm|主菜单)/.test(n)) 音乐 = { 名: a.n, url: 相对(a.n) };
                }
            });
            定();
        }).catch(function(){ 定(); });
    });
}

/* ---------------- 本地模式：约定名探测 ---------------- */
function 探测视频(名){
    return new Promise(function(定){
        var v = document.createElement('video');
        v.preload = 'metadata';
        var 清 = function(){ v.onloadeddata = v.onerror = null; };
        v.onloadeddata = function(){ 清(); 定(true); };
        v.onerror = function(){ 清(); 定(false); };
        v.src = 相对(名);
        setTimeout(function(){ 清(); 定(false); }, 4000);
    });
}
function 探测图(名){
    return new Promise(function(定){
        var i = document.createElement('img');
        var 清 = function(){ i.onload = i.onerror = null; };
        i.onload = function(){ 清(); 定(true); };
        i.onerror = function(){ 清(); 定(false); };
        i.src = 相对(名);
        setTimeout(function(){ 清(); 定(false); }, 4000);
    });
}
async function 本地探测(){
    for (var i = 0; i < 约定闪光.length; i++) {
        if (await 探测视频(约定闪光[i])) 闪光视频们.push({ 名: 约定闪光[i], url: 相对(约定闪光[i]) });
    }
    for (var j = 0; j < 约定背景视.length; j++) {
        if (!背景 && await 探测视频(约定背景视[j])) 设背景({ 名: 约定背景视[j], url: 相对(约定背景视[j]), 视频: true });
    }
    if (!背景) for (var k = 0; k < 约定背景图.length; k++) {
        if (await 探测图(约定背景图[k])) { 设背景({ 名: 约定背景图[k], url: 相对(约定背景图[k]), 视频: false }); break; }
    }
    for (var m = 0; m < 约定音乐.length; m++) {
        var a = document.createElement('audio');
        var ok = await new Promise(function(定){
            var 清 = function(){ a.onloadedmetadata = a.onerror = null; };
            a.onloadedmetadata = function(){ 清(); 定(true); };
            a.onerror = function(){ 清(); 定(false); };
            a.preload = 'metadata';
            a.src = 相对(约定音乐[m]);
            setTimeout(function(){ 清(); 定(false); }, 4000);
        });
        if (ok) { 音乐 = { 名: 约定音乐[m], url: 相对(约定音乐[m]) }; break; }
    }
}

/* ---------------- 自定义背景 ---------------- */
function 设背景(b){ 背景 = b; }
function 应用背景(){
    if (!背景) return;
    if (背景.视频) {
        /* 动态背景：一个循环静音视频铺在 blocker 后面 */
        if (document.getElementById('qzstBgVideo')) return;
        var v = document.createElement('video');
        v.id = 'qzstBgVideo';
        v.src = 背景.url;
        v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;';
        var 挂 = document.getElementById('blocker') || document.body;
        if (挂 === document.body) document.body.appendChild(v);
        else {
            /* blocker 是 display:flex 的层：背景视频挂它前面（DOM 上插到它前面），
               并把它自己的背景色改半透明，让视频透出来 */
           挂.parentElement.insertBefore(v, 挂);
           挂.style.background = 'rgba(5,5,15,.55)';
        }
        v.play().catch(function(){});
    } else {
        if (document.getElementById('qzstBgStyle')) return;
        var st = document.createElement('style');
        st.id = 'qzstBgStyle';
        st.textContent = '#blocker,#go,#wave-shop{background:rgba(5,5,15,.6) url("' + 背景.url + '") center/cover no-repeat fixed !important;}';
        document.head.appendChild(st);
    }
}

/* ---------------- 主菜单 BGM ---------------- */
function 建音乐(){
    if (!音乐 || 音乐元素) return;
    音乐元素 = document.createElement('audio');
    音乐元素.loop = true;
    音乐元素.volume = 音乐音量;
    音乐元素.src = 音乐.url;
    document.body.appendChild(音乐元素);
}
function BGM放(){
    建音乐();
    菜单时播放 = true;
    if (音乐元素) {
        if (音乐元素.paused) 音乐元素.play().catch(function(){
            /* 自动播放被拦：等玩家第一次交互再放 */
            var 一试 = function(){ 音乐元素.play().catch(function(){}); document.removeEventListener('pointerdown', 一试); document.removeEventListener('keydown', 一试); };
            document.addEventListener('pointerdown', 一试);
            document.addEventListener('keydown', 一试);
        });
    }
}
function BGM停(){
    菜单时播放 = false;
    if (音乐元素 && !音乐元素.paused) 音乐元素.pause();
}

/* 状态机：主菜单/暂停 → 放；游戏中 → 停。轮询 S 状态（60 里 S.playing/S.paused/S.over） */
function 音乐状态机(){
    setInterval(function(){
        try{
            if (typeof S === 'undefined' || !S) return;
            var 游戏中 = S.playing && !S.paused && !S.over;
            if (游戏中) { if (菜单时播放) BGM停(); }
            else { if (!菜单时播放) BGM放(); }
        }catch(e){}
    }, 500);
}

/* ---------------- 闪光弹：MP4 特效 ---------------- */
var 视频层 = null, 视频元素 = null, 闪光计时 = 0;

function 建视频层(){
    if (视频层) return 视频层;
    视频层 = document.createElement('div');
    视频层.id = 'qzstFlashVideo';
    视频层.style.cssText = 'position:fixed;inset:0;z-index:4100;display:none;background:#000;pointer-events:none;';
    视频元素 = document.createElement('video');
    视频元素.playsInline = true;
    视频元素.setAttribute('playsinline', '');
    视频元素.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
    视频层.appendChild(视频元素);
    document.body.appendChild(视频层);
    return 视频层;
}

/* 被致盲时调用（41 的 heroBlindSync 之前钩）：有自定义视频就播视频，没有就交给原版纯白 */
function 钩致盲(){
    if (typeof window.heroBlindSync !== 'function') { setTimeout(钩致盲, 300); return; }
    if (window.heroBlindSync.__视频钩) return;
    var 原 = window.heroBlindSync;
    function 包(){
        try{
            if (typeof SK !== 'undefined' && SK && SK.blind > 0) {
                if (!视频元素 || 视频元素.dataset.播 !== '1') 播闪光视频();
            } else if (视频元素 && 视频元素.dataset.播 === '1') {
                收闪光视频();
            }
        }catch(e){}
        return 原.apply(this, arguments);
    }
    包.__视频钩 = 1;
    window.heroBlindSync = 包;
}

function 播闪光视频(){
    if (!闪光视频们.length) return;
    建视频层();
    var 选 = 闪光视频们[Math.floor(Math.random() * 闪光视频们.length)];
    if (视频元素.src.indexOf(encodeURI(选.url)) < 0) 视频元素.src = 选.url;
    视频元素.currentTime = 0;
    视频元素.volume = 1;                       /* MP4 里的音频一起放（主人要求） */
    视频层.style.display = 'block';
    视频元素.dataset.播 = '1';
    var p = 视频元素.play();
    if (p && p.catch) p.catch(function(){
        /* 自动播放被拦：静音强行播（画面还是要），声音只好算了 */
        视频元素.muted = true;
        视频元素.play().catch(function(){});
    });
    /* 致盲时长跟视频时长走（上限 FLASH_VIDEO_MAX） */
    var 时长 = FLASH_VIDEO_MAX;
    try{ if (视频元素.duration && isFinite(视频元素.duration)) 时长 = Math.min(FLASH_VIDEO_MAX, Math.max(1.5, 视频元素.duration)); }catch(e){}
    if (typeof SK !== 'undefined' && SK) {
        SK.blind = Math.max(SK.blind || 0, 时长);
        SK.blindDur = 时长;
        if (typeof heroBlindSync === 'function') heroBlindSync();
    }
    闪光计时 = setTimeout(收闪光视频, 时长 * 1000 + 400);
}
function 收闪光视频(){
    if (闪光计时) { clearTimeout(闪光计时); 闪光计时 = 0; }
    if (视频元素) {
        try{ 视频元素.pause(); }catch(e){}
        视频元素.dataset.播 = '0';
    }
    if (视频层) 视频层.style.display = 'none';
}

/* ---------------- 初始化 ---------------- */
async function 初始化(){
    if (!document.body) { setTimeout(初始化, 100); return; }
    if (是服务器模式()) await 拉服务器资产();
    else await 本地探测();

    if (闪光视频们.length) try{ console.log('[资产] 自定义闪光特效 ' + 闪光视频们.length + ' 个：' + 闪光视频们.map(function(v){ return v.名; }).join('、')); }catch(e){}
    if (背景) try{ console.log('[资产] 自定义背景：' + 背景.名); }catch(e){}
    if (音乐) try{ console.log('[资产] 主菜单 BGM：' + 音乐.名); }catch(e){}

    应用背景();
    BGM放();
    音乐状态机();
    钩致盲();
    已就绪 = true;

    /* 模组管理面板里显示一份资产清单（设置 → 🧩 面板底部） */
    setTimeout(function(){
        if (typeof window.MOD_MGR === 'undefined' || !window.MOD_MGR) return;
        try{
            var 行 = [];
            if (闪光视频们.length) 行.push('闪光特效：' + 闪光视频们.map(function(v){ return v.名; }).join('、'));
            if (背景) 行.push('背景：' + 背景.名);
            if (音乐) 行.push('主菜单音乐：' + 音乐.名);
            if (!行.length) 行.push('（没有自定义资产：把 mp4/mp3/图片放进 mode\\模组\\ 即可）');
            var 说 = window.MOD_MGR.提示 || function(){};
            if (typeof window.MOD_MGR.资产提示 === 'function') window.MOD_MGR.资产提示(行.join('；'));
        }catch(e){}
    }, 3000);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') 初始化();
else document.addEventListener('DOMContentLoaded', 初始化);

/* 对外 */
window.枪战资产 = {
  就绪: function(){ return 已就绪; },
  闪光们: function(){ return 闪光视频们.slice(); },
  背景: function(){ return 背景; },
  音乐: function(){ return 音乐; },
  刷新: function(){ 初始化(); }
};

})();
