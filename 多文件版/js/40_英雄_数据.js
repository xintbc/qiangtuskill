// ==================== 英雄系统（4 英雄 × 3 技能 = 12 技能，特效各不相同）====================
// 【设计】4 个英雄共用同一套技能框架（统一的冷却 / HUD / 释放判定 / 联机上报），
// 每个英雄有 **3 个技能**（电脑端 V / B / N，手机端右下角三个按钮），
// 12 个技能的特效（几何体 / 颜色 / 动画方式）**各不相同**，一眼就能看出是谁放了什么。
//   ① 天狼 📡 蓝：战术探测器 / 闪光弹 / 全域透视   —— 侦查
//   ② 流火 ⚡ 橙：战术突进 / 冲锋号令 / 破片手雷   —— 突进（开路）
//   ③ 镇岳 🛡 绿：护盾投放 / 烟雾弹 / 堡垒阵地     —— 防守（团队减伤 + 封烟）
//   ④ 白泽 ✚ 金：医疗脉冲 / 急救箱 / 治疗烟雾     —— 医疗支援（3 个技能全是投掷物）
// 【投掷物体系】一共 7 件真物理投掷物：战术探测器 / 闪光弹 / 破片手雷 / 烟雾弹 / 治疗烟雾 / 医疗脉冲弹 / 急救箱
var HEROES=[
  {k:'scout', name:'天狼', tag:'侦查', fac:'未来', facDesc:'正规军', icon:'📡', color:0x49b6ff, css:'#49b6ff',
   passive:'敌情预警：附近有敌人时，会朝敌人方向闪红色警示箭头（18 米内）。', skills:[
    {k:'mine',  name:'战术探测器', icon:'🎯', cd:16, dur:12,
     desc:'按 V **拿在手里** → **长按开火键**瞄准（屏幕显示半透明抛物线＝落点，视角上下抬决定远近）→ 松手抛出。探测器会抛物线飞出、撞墙弹回，**落地吸附**后 12 秒内持续侦测 **14 米内正在移动的**敌人与玩家（穿墙标记 + 显示距离）。站着不动的探测不到——**只标移动目标**，也不显示你自己。'},
    {k:'flash', name:'闪光弹', icon:'✨', cd:14, dur:0,
     desc:'按 B **拿在手里** → **长按开火键**瞄准（半透明抛物线＝落点）→ 松手抛出。闪光弹会真抛物线飞出去、弹墙弹地，**落到地上之后再等一会儿**才爆开强光。**只有「正看着爆点」的人才会被闪**（**不限距离**、只看朝向，中间没墙挡着）：正对全效致盲 3 秒；侧对效果递减；**背对完全没事**——扔之前先看清对方在看哪。中招的玩家**整屏全白约 1 秒**再慢慢淡出。扔在脚下会闪到自己。'},
    {k:'eye',   name:'全域透视', icon:'👁', cd:24, dur:6,
     desc:'6 秒内**全场敌人**都被红色轮廓标记出来，并显示与你的距离（穿墙可见）。'}
  ]},
  {k:'rusher',name:'流火', tag:'突进', fac:'未来', facDesc:'正规军', icon:'⚡', color:0xff8a3d, css:'#ff8a3d',
   passive:'开镜机动：开镜时移动速度不降反升（×1.35），移动射击更灵活。', skills:[
    {k:'dash',  name:'战术突进', icon:'⚡', cd:11, dur:2.5,
     desc:'朝当前朝向瞬间突进 10 米（撞墙提前停下、不摔伤），**突进后 2.5 秒内移速 +25%**（突进余势），沿途留下橙色残影。'},
    {k:'rush',  name:'冲锋号令', icon:'🔥', cd:15, dur:6,
     desc:'吹响号角：**自己和 8 米内的队友**同时获得 **+55% 移速**并**免疫减速** 6 秒，脚下喷出橙色推进焰。'},
    {k:'frag',  name:'破片手雷', icon:'💣', cd:16, dur:0,
     desc:'按 N **拿在手里** → **长按开火键**瞄准（半透明抛物线＝落点）→ 松手抛出。手雷是真物理投掷物：抛物线飞出、能弹墙弹地，**抛出后 2.6 秒引信**到点即爆。爆炸时 **8 米内**的敌人受 **85 点**伤害（越远越轻，最低 25），并被冲击波**击退 3.5 米 + 减速 1.5 秒**。能弹墙、能扔进窗口——但**小心别炸到自己**。'}
  ]},
  {k:'guard', name:'镇岳', tag:'防守', fac:'未来', facDesc:'正规军', icon:'🛡', color:0x5ef07a, css:'#5ef07a',
   passive:'重甲：受到的手雷伤害减 30%（炸自己也没那么疼）。', skills:[
    {k:'shield',  name:'护盾投放', icon:'🛡', cd:18, dur:7,
     desc:'展开绿色六边形护盾 7 秒：**自己和 8 米内的队友**受到的伤害**降低 70%**（联机由服务端结算）。'},
    {k:'smoke',  name:'烟雾弹', icon:'🌫️', cd:18, dur:0,
     desc:'按 B **拿在手里** → **长按开火键**瞄准 → 松手抛出。烟雾弹落地即炸开一团**浓密白烟**（半径约 5 米、持续 14 秒）：**挡住视线**——烟里烟外互相看不见，**小兵也看不见你**（AI 的视线会被烟阻断）。撤退、掩护队友、切我方枪线全靠它。'},
    {k:'fortify', name:'堡垒阵地', icon:'🧱', cd:22, dur:8,
     desc:'在脚下铺开**半径 6 米的绿色阵地** 8 秒：**站在里面的玩家（含队友）减伤 30% 且免疫减速**，走出去立刻失效。'}
  ]},
  {k:'medic', name:'白泽', tag:'医疗支援', fac:'未来', facDesc:'正规军', icon:'✚', color:0xffd75e, css:'#ffd75e',
   passive:'医者仁心：受到的治疗 +50%（全队最多）；身处烟雾中再 +50%。', skills:[
    {k:'pulse', name:'医疗脉冲', icon:'✚', cd:20, dur:5,
     desc:'按 V **拿在手里** → **长按开火键**瞄准（半透明抛物线＝落点）→ 松手抛出。**治疗弹**落地炸开金色脉冲：**6 米内的自己和队友**立刻回复 **45 点**生命，并在**落点**留下 **5 秒治疗力场**（站在里面每 0.5 秒回 3 点）。扔队友脚下救人、扔自己脚下回血都行。'},
    {k:'medkit',name:'急救箱', icon:'🧰', cd:16, dur:0,
     desc:'按 B **拿在手里** → **长按开火键**瞄准（半透明抛物线＝落点）→ 松手抛出。金色急救箱会抛物线飞到落点、**落地开箱**：**6 米内的所有人**（含队友）立刻回复 **40 点生命并解除减速**。'},
    {k:'medsmoke', name:'治疗烟雾', icon:'🌫️', cd:18, dur:0,
     desc:'按 N **拿在手里** → **长按开火键**瞄准 → 松手抛出。落地炸开一团**金色医疗烟雾**（半径约 5 米、持续 14 秒）：同样**挡住视线**（AI 看不见你），并且**烟里的自己与队友立刻解除减速**——一边掩护一边回血养人。'}
  ]},
  /* ==================== 【batch120】新英雄 ⑤⑥ ==================== */
  /* 【batch158】蚀日者划归「未来」组织（用户口径：不再是"本季核心"独立段） */
  {k:'eclipse', name:'蚀日者', tag:'控场', fac:'未来', facDesc:'正规军', icon:'🌑', color:0xb07dff, css:'#b07dff',
   passive:'日冕庇护：站在自己创造的日蚀区域（「蚀日」的黑日圈）里时，移速 +15%。', skills:[
    {k:'solar', name:'蚀日', icon:'🌒', cd:20, dur:8,
     desc:'按 V **拿在手里** → **长按开火键**瞄准（半透明抛物线＝落点）→ 松手抛出。落点上空 4.2 米悬起一轮**黑日**，持续 **8 秒**：每 **1 秒**发出一记强光脉冲，**全图范围**内**朝它看**的敌人被**致盲**并被**灼烧**（持续掉血、隔墙看不见就没事）。把太阳挂到对面脸上，逼他们低头 —— 自己也别看它。'},
    {k:'portal', name:'日蚀之门', icon:'🌀', cd:18, dur:15,
     desc:'按 B 立刻**虚化**：身体留在原地（**期间无敌、不能开枪也不能用刀**），视角化作幽影**自由飘**（穿墙无障碍）。飘到想去的地方后，**左键**（或再按一次技能键）就在那里**放下门**，视角随即回到身体，并在**你面前**另开一扇 —— 两扇门共存 **15 秒**：人走进去会被送到另一扇，**扔出去的道具（手雷 / 烟雾 / 探测器…）飞进去也会从另一扇出来**。上高台、翻墙、把雷送进屋、脱身，一扇门的事。'},
    {k:'suneye', name:'日之眼', icon:'🧿', cd:22, dur:7,
     desc:'按 N 直接在原地升起一只**日之眼**：持续 **7 秒**，把**全图**所有敌人**全部标出来**（穿墙可见 + 显示距离）。不用再拿命去探点 —— 日之眼跟着你走，推进的时候直接开，把整张地图点亮。'}
  ]},
  {k:'lightning', name:'闪电', tag:'突进', fac:'暗月', facDesc:'佣兵团', icon:'🌩', color:0x6ff0ff, css:'#6ff0ff',
   passive:'电光疾行：冲刺中（双击 W / 摇杆推到底）移速再 +12%。', skills:[
    {k:'orb', name:'闪电光球', icon:'🔵', cd:15, dur:6,
     desc:'按 V **拿在手里** → **长按开火键**瞄准（半透明抛物线＝落点）→ 松手抛出。落地炸开一颗**闪电光球**，在 **2 米电区**内持续放电 **6 秒**：踏进来的敌人立刻吃 **25 点**电击，并被套上 **20 秒三重减益** —— **麻痹**（移速 −40%）、**过载**（被电弧糊住视野，**不能开镜**）、**易伤**（受到伤害 +25%，联机由服务端结算）。扔在自己脚下一样会电到自己。'},
    {k:'trap', name:'电荷陷阱', icon:'🕸', cd:13, dur:30,
     desc:'按 B **拿在手里** → **长按开火键**瞄准 → 松手抛出。陷阱会**吸在碰到的那个面上**（地面 / 墙面 / 天花板都行），敌人走进 **2.2 米**就触发**连劈 4 下、每下 20 点**（共 80 点）。陷阱自己有 **60 点血**，**可以被子弹打掉** —— 对面想强冲，就得先花子弹拆它。'},
    {k:'ball', name:'球形闪电', icon:'💫', cd:130, dur:0,
     desc:'按 N 释放 **3 枚球形闪电**：**穿墙**飞行、自动追踪 **40 米内**最近的敌人。命中的敌人**立刻倒地** —— 血量掉到 **1 点**、无法开枪、只能慢慢爬；**50 秒**内没有被治疗就会**直接死亡**。队友的治疗（医疗脉冲 / 急救箱 / 治疗力场）碰到倒地的人会把他**当场扶起来**（恢复到 40% 血量）。倒地的敌人**再补一枪或一刀就是秒杀** —— 冲上去补刀，或者晾着他自己流干。'}
  ]},
  /* ==================== 【batch158】新英雄 ⑦ 影月（暗月 · 控场） ==================== */
  {k:'yingyue', name:'影月', tag:'控场', fac:'暗月', facDesc:'佣兵团', icon:'🌙', color:0x8f7bff, css:'#8f7bff',
   passive:'暗影亲和：站在**自己**放的暗影里毫发无伤；吃**别的影月**的暗影伤害减半。', skills:[
    {k:'ssmoke', name:'暗影烟雾弹', icon:'🌫️', cd:20, dur:0,
     desc:'按 V **拿在手里** → **长按开火键**瞄准 → 松手抛出。落地炸开一团**浓密烟雾**（半径约 5 米、持续 14 秒）：**挡住视线**——烟里烟外互相看不见，**小兵也看不见你**。掩护、撤退、掐断对面枪线 —— 影月的起手式。'},
    {k:'sbomb', name:'暗影炸弹', icon:'🕳️', cd:25, dur:0,
     desc:'按 B **拿在手里** → **长按开火键**瞄准（半透明抛物线＝落点）→ 松手抛出一团暗影。**碰墙不炸**（弹墙继续飞），**碰地即爆**：以爆点为圆心 **4 米**内的**这张地面**上漫出暗影，持续 **10 秒** —— 站在暗影里每秒被毒蚀 **15 点**血。**落在哪层就只毒哪层**（二楼爆的毒不到一楼）。'},
    {k:'sshadow', name:'遁入暗影', icon:'🌑', cd:90, dur:20,
     desc:'按 N **遁入暗影**：原地只留下一团小小的暗影，本体**无敌** —— 敌人看不见你、锁不住你也打不到你。暗影状态下**不能攻击、不能开枪、不能开镜**，手上不持有任何东西。**再按一次 N** 或 **20 秒**后重新化回实体。遁入冷却 **90 秒** —— 用来躲大招、脱离包围或骗对面火力。'}
  ]}
];
var HERO_KEY='gunGame.hero.v1';
/* ==================== 【batch171】SP 形态（熟练度满级解锁）====================
   五个英雄（下标 0~4：四个正规军 + 蚀日者）的「专精进化」：**机制和原版完全不同**（不是数值加强，是换玩法）。
   解锁条件：该英雄熟练度满级（10 级）。数据结构与 HEROES 一致，heroNow() 按 SK.sp 分发，
   整条技能链（HUD / 释放 / 冷却）自动适配。其他英雄的 SP 以后按同一结构补。
   【batch181】蚀日者（下标 4）的 SP「焚曜」补齐，解锁方式与其他人完全一致（熟练度满级）。 */
var SP_KEY='gunGame.sp.v1';          // 当前是否启用 SP 形态（'1'/'0'）
var SP_XP_KEY='gunGame.spxp.v1';     // 熟练度存档：{"0":{xp:0,lv:1},...}
var SP_MAX_LV=10;                    // 满级 = 解锁 SP
var SP_XP_TABLE=[0,100,250,450,700,1000,1400,1900,2500,3300,4200];   // 升到下一级所需累计经验
var SP_XP={};                        // 运行态：下标 → {xp,lv}
function spXpLoad(){
  try{var v=JSON.parse(localStorage.getItem(SP_XP_KEY)||'{}');
    for(var k in v){var i=parseInt(k,10);if(i>=0&&i<5)SP_XP[i]={xp:Math.max(0,v[k].xp|0),lv:Math.max(1,Math.min(SP_MAX_LV,v[k].lv|0))};}
  }catch(e){}
}
function spXpSave(){try{localStorage.setItem(SP_XP_KEY,JSON.stringify(SP_XP));}catch(e){}}
/* 网址带 ?spmax=1（或 #spmax）→ 进游戏自动拉满熟练度 */
try{ if(/[?#&]spmax=1\b/.test(location.search+location.hash)) setTimeout(function(){spXpMaxAll();},600); }catch(e){}
function spXpOf(i){ if(!SP_XP[i])SP_XP[i]={xp:0,lv:1}; return SP_XP[i]; }
function spLevelOf(i){ return spXpOf(i).lv; }
function spUnlocked(i){ return spXpOf(i).lv>=SP_MAX_LV; }          // 满级 → 解锁 SP
/* 加熟练度经验（自动升级；调用点全部包 try，旧缓存不得经验也不崩）。n=经验值，i=英雄下标(0~3) */
function addHeroXp(i,n){
  try{
    i=i|0; if(i<0||i>=5)return false;                // 四个正规军 + 蚀日者都有熟练度
    n=Math.max(0,n|0); if(n<=0)return false;
    if(!spUnlocked(i)&&SK&&SK.idx!==i)return false;  // 只给"当前使用的英雄"涨（SK 未初始化时放过）
    var d=spXpOf(i),up=false;
    if(d.lv>=SP_MAX_LV)return false;                 // 满级后不再累加
    d.xp+=n;
    while(d.lv<SP_MAX_LV&&d.xp>=SP_XP_TABLE[d.lv]){d.lv++;up=true;}
    spXpSave();
    if(up&&typeof showMsg==='function')showMsg('「'+HEROES[i].name+'」熟练度 Lv.'+d.lv+(d.lv>=SP_MAX_LV?' —— ⚡ SP 形态已解锁！':''),'#ffd166');
    return up;
  }catch(e){return false;}
}
/* 【batch175】一键拉满熟练度：四个正规军 + 蚀日者直接满级 → SP 形态全部解锁（调试/试玩用）
   用法（界面上的按钮按用户要求已撤掉，别再往 HTML 里加）：
     ① 浏览器控制台输 spXpMaxAll()  或  熟练度灌满()
     ② 网址后面加 ?spmax=1 打开游戏即自动拉满
   会写进 localStorage（换设备/清缓存才丢）。 */
function spXpMaxAll(silent){
  try{
    var n=0;
    for(var i=0;i<5;i++){
      var d=spXpOf(i);
      d.xp=Math.max(d.xp||0,SP_XP_TABLE[SP_MAX_LV]);
      d.lv=SP_MAX_LV;
      n++;
    }
    spXpSave();
    try{if(typeof buildHeroGrid==='function')buildHeroGrid();}catch(e){}      // 刷新选人界面（SP 解锁标记）
    try{if(typeof heroHudUpdate==='function')heroHudUpdate(true);}catch(e){}
    try{if(typeof heroSpSyncUI==='function')heroSpSyncUI();}catch(e){}
    if(!silent&&typeof showMsg==='function')showMsg('⚡ 熟练度已全部拉满（'+n+' 个英雄满级，SP 形态全解锁）','#ffd166');
    return true;
  }catch(e){ return false; }
}
try{ window.spXpMaxAll=spXpMaxAll; window['熟练度灌满']=spXpMaxAll; }catch(e){}
/* 当前英雄距下一级还需多少经验（UI 进度条用） */
function spXpProgress(i){
  var d=spXpOf(i);
  if(d.lv>=SP_MAX_LV)return {lv:SP_MAX_LV,cur:1,need:1,pct:1};
  var base=SP_XP_TABLE[d.lv-1]||0,need=SP_XP_TABLE[d.lv]-base,cur=d.xp-base;
  return {lv:d.lv,cur:cur,need:need,pct:Math.max(0,Math.min(1,cur/need))};
}
/* ---------------- 四套 SP 形态数据（机制全部推倒重来）----------------
   天狼：信息辅助 → 隐身刺杀      流火：一波爆发 → 持续火区控制
   镇岳：软减伤   → 地形封锁      白泽：纯治疗   → 强化过载           */
var HERO_SP=[
 {k:'scout_sp', base:'scout', name:'暗哨', full:'天狼 · 暗哨', tag:'隐身刺杀', icon:'🥷', css:'#49b6ff',
   passive:'暗影步履：隐身期间移速 +15%；破隐后 1 秒内第一发子弹伤害 +30%。',
  skills:[
   {k:'sp_cloak', name:'光学隐身', icon:'👤', cd:16, dur:5,
    desc:'5 秒光学隐身：**敌人（含小兵）完全锁不到你**——看不见也听不见（贴脸也没用）；期间不能开枪（开枪或受伤会提前破隐）。脱身、绕后、骗枪线——原版是"看清别人"，SP 是"让别人当你不存在"。'},
   {k:'sp_mark', name:'猎杀标记', icon:'🎯', cd:16, dur:12,
    desc:'瞬间标记 **全图所有敌人**（金色轮廓 + 距离，小地图同显）12 秒：被标记的敌人**受你的枪/刀伤害 +30%**，且你**移速 +25%**（冲向猎物）。原版全域透视只是"看见"，SP 是**看见即增伤**。'},
   {k:'sp_drone', name:'蜂鸟无人机', icon:'🛩', cd:20, dur:0,
    desc:'**手持**蜂鸟无人机（屏幕显示**直线飞行轨迹**）→ 左键放出（右键取消）：直线飞出**不弹墙**，命中第一个敌人**自爆**——**70 点**伤害 + **过载 10 秒（无法开枪、只能近战）** + 减速 2 秒，被扎中的敌人头顶亮标记 10 秒。探路、破枪线一把好手。'}
  ]},
 {k:'rusher_sp', base:'rusher', name:'烈焰先锋', full:'流火 · 烈焰先锋', tag:'火区控制', icon:'🔥', css:'#ff8a3d',
  passive:'炽热之触：你的子弹命中敌人后，会留下 **2 秒灼烧**（每秒 3 点，可叠加 3 层）。',
  skills:[
   {k:'sp_firetrap', name:'烈焰之路', icon:'🛤', cd:16, dur:5,
    desc:'向前突进并在身后铺开 **5 秒火焰路径**：踩进去的敌人每秒 **12 点**灼烧并**减速 40%**。原版是"冲一次打一波"，SP 是**把地面变成武器**。'},
   {k:'sp_burn', name:'爆燃弹', icon:'💥', cd:14, dur:8,
    desc:'8 秒内你的**每一发子弹都是燃烧弹**：命中后小范围爆燃，对落点 **2 米内**敌人再造成 **20 点**火焰伤害并**点燃 2 秒**。'},
   {k:'sp_nova', name:'焚天新星', icon:'☄️', cd:25, dur:0,
    desc:'按 N **举起陨石**（和镇岳的掩体墙一样：举着只是瞄准）→ **准星指哪，地上就画哪的半径 8 米圆圈** → **左键召唤**，3 秒后陨石从天而降砸在那里。**圈内一律秒杀**：不分 1 楼 2 楼（只看水平距离），自己站在圈里也一样。落地前圈内会弹出「已在陨石范围内，请尽快撤出」的红色提示；右键 / 再按 N 可以收起不扣冷却。'}
  ]},
 {k:'guard_sp', base:'guard', name:'铁壁', full:'镇岳 · 铁壁', tag:'地形封锁', icon:'🧱', css:'#5ef07a',
  passive:'钢筋铁骨：站在自己放的掩体墙 **3 米内**时，受到的伤害 **-15%**（墙没了就失效）。',
  skills:[
   {k:'sp_wall', name:'掩体墙', icon:'🚧', cd:20, dur:12,
    desc:'在面前立起一面 **约 5 米宽**的实体墙：**永久存在**（最多同时立 2 堵，放第 3 堵时最早那堵自动撤；换图/退出对局才清空），**所有人都撞不进去**（自己、队友、小兵一视同仁），挡子弹也挡视线；墙有 **2000 点血**，能被集中火力打爆（快碎时泛红）。原版减伤是软保，SP 是**直接改写地形**。'},
   {k:'sp_net', name:'电磁减速网', icon:'🕸', cd:18, dur:8,
    desc:'在准星前方 **7 米**处铺开 **半径 4 米的电磁网 8 秒**：网内敌人移速 **-60%** 且**每秒掉 5 点血**。原版只有减速，SP 是**边减速边放电**。'},
   {k:'sp_dome', name:'力场穹顶', icon:'🔵', cd:30, dur:10,
    desc:'撑开 **10 秒力场穹顶（半径 6 米）**：罩内的**自己和队友受到伤害 -50%**（联机同样生效）。原版护盾只保自己，SP 是**撑起一片天**。'}
  ]},
 {k:'medic_sp', base:'medic', name:'战地医师', full:'白泽 · 战地医师', tag:'强化过载', icon:'💉', css:'#ffd75e',
  passive:'过载协议：你的强化技能对**倒地的人**也有效——肾上腺素能把倒地队友直接扶起来。',
  skills:[
   {k:'sp_adren', name:'肾上腺素', icon:'💉', cd:18, dur:6,
    desc:'给自己（和范围内的队友）注射过载：**6 秒内移速 +35%、射速 +50%、免疫减速**，每秒回 **8 点**血、**每次击杀再回 25 血**；倒地的队友会被直接扶起。原版是回血，SP 是**把人变成武器**。'},
   {k:'sp_nano', name:'纳米治疗云', icon:'☁️', cd:20, dur:10,
    desc:'在准星前方铺开 **半径 7 米的纳米云 10 秒**：范围内每秒回 **8 点**血，并**净化减速 / 致盲**；倒地的队友会被扶起。原版是扔出去的急救箱，SP 是**持续养人**。'},
   {k:'sp_revive', name:'复苏协议', icon:'❤️‍🩹', cd:35, dur:0,
    desc:'瞬间扶起 **12 米内倒地的队友**（回到 60% 血）；范围内所有人（含自己）回 **60 点**血，并给 8 秒 **减伤 50%**。原版急救箱要扔出去，SP 是**瞬间协议**。'}
  ]},
 /* ==================== 【batch181】蚀日者 · 焚曜（下标 4）====================
    解锁方式**和其他人一模一样**：熟练度满级（Lv.10）→ SP 形态。
    设定（第三章剧情交代）：每个人在极限战斗中沉淀出的「熟练度」就是与焘芯的共振频率，
    满级那一刻第二形态觉醒 —— 蚀日者觉醒后不再是"借太阳的光"，而是自身化为焚曜。 */
 {k:'eclipse_sp', base:'eclipse', name:'焚曜', full:'蚀日者 · 焚曜', tag:'日蚀化身', icon:'🌞', css:'#ffb347',
   passive:'日冕永昼：站在**自己创造**的蚀日区域（黑日圈）里时，技能冷却恢复速度 **×2**、每秒回 **3 点**血 —— 原版只在圈里加速，SP 是把圈变成充电桩。',
  skills:[
   {k:'sp_solarflare', name:'日冕喷发', icon:'🌅', cd:18, dur:0,
    desc:'以自身为中心爆发一轮**日冕光柱**：**12 米内**的敌人被**致盲 2.5 秒**并受到 **45 点**灼烧伤害；自己同时获得 **4 秒日冕护盾（减伤 60%）**与 **2.5 秒加速**。原版黑日要抛出去，SP 是**从自己身上烧出去**。'},
   {k:'sp_sunfall', name:'堕日', icon:'☄️', cd:22, dur:0,
    desc:'按 V **拿在手里** → **长按开火键**瞄准 → 松手抛出一颗**坠落的小太阳**：落地形成 **6 秒燃烧区**（半径 4.5 米、每秒 **18 点**火焰伤害并**点燃**）。原版是挂在天上的黑日，SP 是**把太阳砸进地里**。'},
   {k:'sp_eclipseveil', name:'蚀日 · 白夜', icon:'🌘', cd:80, dur:8,
    desc:'终极：天空被黑日遮蔽，**全图敌人致盲 4 秒**；自己 **8 秒**内减伤 **70%**、移速 **+30%**，一颗**黑日跟着自己走**，每 1.2 秒对 **9 米内**的敌人脉冲 **15 点**灼烧。原版是放装置，SP 是**自己成为天象**。'}
  ]}
];
// 天狼技能参数（与服务端 FLASH_R / FLASH_MS 同口径）
var MINE_R=14, MINE_PING=0.85;                                   // 战术探测器：侦测半径（米）/ 脉冲间隔（秒）
var FLASH_R=8, FLASH_THROW=7, FLASH_SELF_R=3, FLASH_BLIND=3;     // 闪光弹：爆闪环视觉半径 / (旧投掷距离·已废) / 贴脸必闪半径 / 致盲秒数
                                                                 // 【batch91】致盲**不再有距离上限**：朝爆点看 + 没墙挡就闪，多远都算（FLASH_R 现在只管视觉环）
var FLASH_WHITE=1.0, FLASH_FADE=1.6;                             // 屏幕泛白：全白 1 秒 → 再淡出 1.6 秒
var FLASH_DOT_FULL=0.82, FLASH_DOT_MIN=0.35;                     // 「看向爆点才被闪」：夹角余弦 ≥0.82 全效、≤0.35 完全不闪
/* ==================== 物理投掷物（借鉴 CS:GO / VALORANT 的投掷物）====================
   投掷物不再是"按一下就在固定落点炸"，而是一个真正会飞的东西：
     · 抛物线：出手速度 = 视线方向（pitch/yaw）× 出手力道 —— 抬头抛得高又远，低头能贴地扔
     · 弹跳：撞地面 / 撞墙 / 撞箱子按弹性系数反弹，触地还有摩擦 → 能扔墙反弹、能扔进窗口
     · 引信：抛出后 fuse 秒引爆（闪光弹）；或「第一次落地就激活」（战术探测器 / 急救箱）
     · 联机：把「出生点 + 初速」广播出去，别人在自己机器上用同一套物理跑出同一条轨迹，
             所以你能亲眼看见对方扔过来的手雷在天上飞（而不是隔空爆炸）。
   为让所有客户端跑出**同一条轨迹**，物理用固定步长 1/60 积分（与帧率无关）。 */
var PROJ_G=26, PROJ_R=0.16, PROJ_REST=0.46, PROJ_FRIC=0.72, PROJ_STOP=1.6;
var PROJ_SPEED=24, PROJ_LIFT=3.0;                                // 出手速度（米/秒）/ 平抛时额外的一点上抛量
                                                                 // 24 → 平视约 12 米、抬头约 26 米（之前 15.5 只有 7 / 12 米，太近）
var FLASH_FUSE=0.7;                                              // 闪光弹引信（秒）：**落地之后**过这么久才爆（不会一扔出去就炸）
/* 破片手雷 / 烟雾弹 / 治疗烟雾（batch92）—— 同样是真物理投掷物 */
var FRAG_FUSE=2.6;                                               // 手雷引信（秒）：**抛出后**计时，2.6 秒到点即爆
var FRAG_R=8, FRAG_DMG=85, FRAG_DMG_MIN=25, FRAG_SLOW=1.5, FRAG_KNOCK=3.5;  // 伤害半径 / 中心伤害 / 边缘保底 / 减速秒 / 击退米
var SMOKE_LAND_FUSE=0.5;                                         // 烟弹：**落地后** 0.5 秒炸开
var SMOKE_R=5.0, SMOKE_LIFE=14;                                  // 烟雾半径（米）/ 持续（秒）
/* 【batch107/108】烟云必须"真挡视线"——旧布局的实心范围只到 4.7 米，比判定半径 5 米还小，
   于是贴着判定圈的那一圈画面上没有烟，一开镜（放大 1.8 倍）就看见人。
   现在按层摆球（改这里就能调浓密度/范围，t_smoke.js 会用真几何量"视线穿面数"复核）：
   透光率 ≈ (1 - SMOKE_PUFF_OP) ^ 穿面数。
   【batch108】关键是"**最坏情况下**视线能穿过几个球面"：只堆一层壳，掠射/低角度的视线
   仍只穿 3 个面（透光 2.2%，开镜看得见）。所以外壳按高度拆成多层，任何方向都堵死。
   实测（真几何扫 48 视角 × 12 目标 × 8 组抖动）：最坏 6 个面 → 透光 0.048%。 */
var SMOKE_PUFF_OP=0.72;                                          // 单个烟球的不透明度（updateHeroFX 每帧按它设，别再写死别的数）
var SMOKE_PUFFS=[
  {n:14, ring:3.80, r:2.60, y:1.55, jy:0.35, jr:0.03},           // 外壳（腰部）
  {n:12, ring:3.10, r:2.50, y:1.25, jy:0.45, jr:0.05},           // 外壳内侧
  {n:10, ring:2.70, r:2.30, y:0.70, jy:0.30, jr:0.07},           // 贴地
  /* 【batch201】顶盖 ring 必须小于 r：原来 ring 2.50 > r 2.40，**正中心轴留了个 0.1 米的洞**，
     加上内芯（y=1.55, r=1.90）在 2.9 米以上的截面也缩到 1.34（小于它的环半径 1.40），
     两处空洞叠成一条"漏斗缝"——站在烟外、视线略抬起（约 +4°）时正好从缝里穿过去，
     看到烟后的血条/敌人（截图实测那块像素 rgb(207,181,185)，是"1 层烟 + 红色底"的混合）。
     2.20 < 2.40 → 中心被球面盖住了。 */
  {n:8,  ring:2.20, r:2.40, y:2.70, jy:0.35, jr:0.09},           // 顶盖
  {n:6,  ring:1.40, r:1.90, y:1.55, jy:0.40, jr:0.15},           // 内芯
  /* 【batch201】中心填充：前面几层全是"环"，中心轴上一直靠内芯那一层硬撑，
     而内芯半径 1.9 只到 y≈3.4，顶盖层（y=2.7）中心又带洞 —— 合起来在 2.8~3.4 米高度
     留了一条细缝。这一层 ring 1.0 + r 2.30 把整根中轴从 0 米盖到 4.4 米，任何仰角都不漏。 */
  {n:6,  ring:1.00, r:2.30, y:2.10, jy:0.30, jr:0.10}            // 中心填充（补洞）
];
var SMOKE_SCREEN_OP=0.82;                                        // 身处烟中时屏幕雾的最大浓度
/* 【趴下已删除】PRONE_HEAD_FWD / PRONE_BODY_LEN / PRONE_MODEL_BACK / PRONE_EYE_H 四个常量
   原是趴下专用（相机前伸 0.85、模型身长 1.78、第三人称后移 0.93、趴下眼高 0.65），
   连同一整套前伸施加/防卡墙/第三人称后移逻辑一起删除。 */
var PULSE_R=6.0, PULSE_LAND_FUSE=0.45, PULSE_HEAL=45;            // 医疗脉冲弹：治疗半径（米）/ 落地引信 / 瞬回血量
/* ==================== 英雄被动（batch100）====================
   每个英雄多一条「不用按技能键、一直生效」的被动，让 4 个英雄手感各有特色：
     天狼 → 敌情预警（方向指示）   流火 → 开镜机动
     镇岳 → 手雷减伤 30%          白泽 → 治疗增益（烟中更强） */
var HERO_SCOUT=0, HERO_RUSHER=1, HERO_GUARD=2, HERO_MEDIC=3;      // 与 HEROES 数组下标一致
var HERO_ECLIPSE=4, HERO_LIGHTNING=5;                             // 【batch120】蚀日者 / 闪电
var HERO_YINGYUE=6;                                               // 【batch158】影月（暗月 · 控场）

/* ==================== 【batch126】英雄锁定 & 永久解锁 ====================
   用户：把「蚀日者」和「闪电」暂时锁定。闪电的获取方式＝打完**剧情模式**「营救蚀日者」，
   一个账号通过过一次就**永久拥有**（本地记一份；连服务器时服务端按身份码再记一份）。
   蚀日者：要靠**剧情第二章「救出蚀日者」**把人救出来才解锁（batch149 已经把这一章做进去了）。
   【重要】锁定只挡「选人 / 换英雄」两个入口，**不动 heroLoad / SK.idx 这些底层** ——
   否则探针里拿 HERO_ECLIPSE 做功能断言会全崩。 */
var STORY_CLEAR_KEY='gunGame.storyClear.v1';
var UNLOCK={lightning:false,eclipse:false,station:false,general:false,code:'',name:'',t:0};   // 【batch147】eclipse＝蚀日者（控制台指令解锁）；【batch181】station＝第三章「日陨之地」通关记录（无解锁奖励，只作记录）；【batch245】general＝大将军（打完剧情第四章才解锁）
var HERO_LOCKED={};
/* 【batch245】下标 → UNLOCK 里的字段名：新英雄要"通关才解锁"时，在注册英雄的地方挂一行即可，
   不用再回来改 heroLocked()（这个函数被选人界面 / 读档 / 联机前后好几处调用，改一次容易漏）。 */
var HERO_UNLOCK_FLAG={};
HERO_UNLOCK_FLAG[HERO_ECLIPSE]='eclipse';
HERO_UNLOCK_FLAG[HERO_LIGHTNING]='lightning';
HERO_LOCKED[HERO_ECLIPSE]='锁定 · 通关剧情第二章「救出蚀日者」后解锁';
HERO_LOCKED[HERO_LIGHTNING]='通过剧情模式「营救蚀日者」后解锁';
function unlockLoad(){
  try{
    var v=localStorage.getItem(STORY_CLEAR_KEY);if(!v)return;
    var d=JSON.parse(v)||{};
    UNLOCK.lightning=!!d.lightning;UNLOCK.eclipse=!!d.eclipse;UNLOCK.station=!!d.station;UNLOCK.general=!!d.general;UNLOCK.code=d.code||'';UNLOCK.name=d.name||'';UNLOCK.t=d.t||0;
  }catch(e){}
}
function unlockSave(){
  try{localStorage.setItem(STORY_CLEAR_KEY,JSON.stringify(
    {lightning:!!UNLOCK.lightning,eclipse:!!UNLOCK.eclipse,station:!!UNLOCK.station,general:!!UNLOCK.general,code:UNLOCK.code||'',name:UNLOCK.name||'',t:UNLOCK.t||Date.now()}));}catch(e){}
}
/* 【batch181】第三章通关：只记一笔「打过了」（**不解锁任何东西** —— SP 靠熟练度满级解锁） */
function storyClearStation(){
  if(UNLOCK.station)return false;
  UNLOCK.station=true;UNLOCK.code=(typeof netMyCode==='function'?(netMyCode()||''):'');
  UNLOCK.name=S.playerName||'';UNLOCK.t=Date.now();
  unlockSave();
  try{if(typeof netIsMulti==='function'&&netIsMulti()&&NET.connected)netSend({t:'clear',k:'station'});}catch(e){}
  return true;
}
/* 【batch245】第四章「陵园惊梦」通关：解锁暗月新成员「大将军」。
   和闪电 / 蚀日者走**同一套**存档字段（STORY_CLEAR_KEY）与上报口径（{t:'clear',k:'general'}：
   本机记一份、连服务器时服务端按身份码再记一份 → 换设备也拿得回）。 */
function storyClearGeneral(){
  if(UNLOCK.general)return false;
  UNLOCK.general=true;UNLOCK.code=(typeof netMyCode==='function'?(netMyCode()||''):'');
  UNLOCK.name=S.playerName||'';UNLOCK.t=Date.now();
  unlockSave();
  try{if(typeof netIsMulti==='function'&&netIsMulti()&&NET.connected)netSend({t:'clear',k:'general'});}catch(e){}
  return true;
}
/* 这个英雄现在能不能选？返回空串＝能用，否则返回"锁定的理由" */
function heroLocked(i){
  i=i|0;
  if(!HERO_LOCKED[i])return '';
  var f=HERO_UNLOCK_FLAG[i];
  if(f&&UNLOCK[f])return '';          // 挂了解锁字段且已解锁 → 永久拥有
  return HERO_LOCKED[i];
}
/* ==================== 【batch147】开发者「控制台指令」 ====================
   用法：浏览器按 F12 → Console，直接敲 ——
       解锁蚀日者()           解锁「蚀日者」（也可以用英文名 unlockEclipse()）
       unlockEclipse(false)   重新锁上
       指令()                 打印这份指令表
   也可以在游戏内调试面板（手机端左上角 ? 按钮，密码见项目记忆）里点「🌀 解锁蚀日者」。
   解锁会写进本地存档；联机时一并上报服务端（服务端按名字记一笔，换设备也拿得回）。 */
function unlockEclipse(on){
  var want=(on===undefined)?true:!!on;
  if(UNLOCK.eclipse===want){
    showMsg(want?'「蚀日者」本来就是解锁状态':'「蚀日者」本来就是锁着的','#ffd166');
    return UNLOCK.eclipse;
  }
  UNLOCK.eclipse=want;
  if(want){UNLOCK.t=Date.now();UNLOCK.name=S.playerName||UNLOCK.name||'';}
  unlockSave();
  try{ if(heroLocked(SK.idx))SK.idx=HERO_SCOUT;                            // 锁回去时别把人卡在锁着的英雄上
       if(typeof heroSave==='function')heroSave(); }catch(e){}
  if(typeof buildHeroGrid==='function')buildHeroGrid();
  if(typeof storyRefreshBtn==='function')storyRefreshBtn();
  /* 联机：把这份解锁补报给服务器（服务端按名字记账；off=1 是取消） */
  try{
    if(typeof netIsMulti==='function'&&netIsMulti()&&NET.connected)
      netSend({t:'clear',k:'eclipse',off:want?0:1});
  }catch(e){}
  showMsg(want?'🌀 已解锁「蚀日者」—— 选人界面直接选他':'🌀 已重新锁定「蚀日者」','#b07dff');
  console.log('【指令】蚀日者解锁 = '+(want?'开 ✅':'关 ❌'));
  return UNLOCK.eclipse;
}
var 解锁蚀日者=unlockEclipse;            // 中文别名（同一个函数）
function 指令(){
  console.log('【可用指令】\n  管理员()      /  admin() / unlockAll()   一键全解锁（闪电 / 蚀日者 / 大将军 / 四章通关 / 熟练度满级 SP 全开 / 纪念枪）\n  管理员(0)                             全部锁回去（回到新号状态）\n  管理员(1)                             同上并上报服务器（需在联机房间）\n  解锁蚀日者()  /  unlockEclipse()       只解锁「蚀日者」\n  熟练度灌满()  /  spXpFill()            把当前英雄熟练度灌到满级（解锁 SP 形态）\n  熟练度灌满(1)                          指定英雄下标（0天狼 1流火 2镇岳 3白泽 4蚀日者）\n  纪念解锁()                             解锁纪念枪「长明」（作者通道）\n  指令()                                打印这份列表');
  return '见控制台输出';
}

/* ==================== 【batch247】管理员：一键全解锁（测试用）====================
   用户：给一个能在控制台输的"管理员代码"，一键拿到所有要解锁的东西，方便测试。
   用法：F12 → Console
       管理员()      全部解锁 —— 闪电 / 蚀日者 / 大将军 / 四章通关记录 / 所有英雄熟练度满级（SP 全开）/ 纪念枪
       管理员(0)     全部锁回去（回到新号状态）
       管理员(1)     全部解锁 + 把解锁上报服务器（需已经在联机房间里）
   别名：admin() / 全解锁() / unlockAll()
   ⚠️ 只动"解锁状态"，不改数值、不发道具；写的是本地存档（换设备要重敲一次，
      想跨设备保留就用 管理员(1) 在联机房间里上报一次）。 */
function 管理员(on){
  var want=(on===undefined)?true:!(on===0||on===false||on==='0'||on==='false');
  var 前={闪电:!!UNLOCK.lightning,蚀日者:!!UNLOCK.eclipse,大将军:!!UNLOCK.general};
  /* ① 四个解锁字段：闪电 / 蚀日者 / 第三章记录 / 大将军 */
  UNLOCK.lightning=want;UNLOCK.eclipse=want;UNLOCK.station=want;UNLOCK.general=want;
  if(want){UNLOCK.t=Date.now();try{UNLOCK.name=(typeof S!=='undefined'&&S&&S.playerName)||UNLOCK.name;}catch(e){}}
  unlockSave();
  /* ② 剧情通关记录：第四章的 done() 读这个键（章节卡的「✅ 已通关」） */
  try{
    if(want){ if(!localStorage.getItem('gunGame.story4.v1'))localStorage.setItem('gunGame.story4.v1',String(Date.now())); }
    else localStorage.removeItem('gunGame.story4.v1');
  }catch(e){}
  /* ③ 熟练度：全部满级 → 所有人 SP 形态解锁（关掉时重置回 Lv.1） */
  var sp='未变';
  try{
    if(want){ var okSp=(typeof spXpMaxAll==='function')?spXpMaxAll(true):false; sp=okSp?'全部满级':'失败'; }
    else if(typeof SP_XP!=='undefined'&&SP_XP){
      for(var k in SP_XP){ if(Object.prototype.hasOwnProperty.call(SP_XP,k))SP_XP[k]={xp:0,lv:1}; }
      if(typeof spXpSave==='function')spXpSave();
      sp='已重置';
    }
  }catch(e){ sp='失败'; }
  /* ④ 纪念枪「长明」（01 分片的作者通道：把登录天数补满，走的就是真实解锁判定） */
  var 纪念='未变';
  try{
    if(typeof 纪念已解锁==='function'){
      if(want){
        纪念=(typeof 纪念解锁==='function'&&纪念解锁(true))?'已解锁':'失败';
      }else{
        /* 锁回去：清掉纪念存档（回到 0/7 天），并顺手卸下它 */
        try{localStorage.removeItem('gunGame.memorial.v1');}catch(e){}
        try{localStorage.removeItem('gunGame.memorial.equipped');}catch(e){}
        try{_纪念缓存=null;}catch(e){}
        纪念=(typeof 纪念已解锁==='function'&&!纪念已解锁())?'已锁定':'仍解锁';
      }
      try{if(typeof 纪念刷新锁==='function')纪念刷新锁();}catch(e){}
    }
  }catch(e){ 纪念='失败'; }
  /* ⑤ 锁回去时别把人卡在锁着的英雄上 */
  try{
    if(!want&&typeof heroLocked==='function'&&heroLocked(SK.idx)){
      SK.idx=(typeof HERO_SCOUT==='number'?HERO_SCOUT:0);
      if(typeof heroSave==='function')heroSave();
      if(typeof heroLoad==='function')heroLoad();
    }
  }catch(e){}
  /* ⑥ 刷新界面：选人卡片 / 剧情入口 / 章节列表 / 技能条 / 武器选择 */
  try{if(typeof buildHeroGrid==='function')buildHeroGrid();}catch(e){}
  try{if(typeof storyRefreshBtn==='function')storyRefreshBtn();}catch(e){}
  try{if(typeof storyBuildChap==='function')storyBuildChap();}catch(e){}
  try{if(typeof heroHudUpdate==='function')heroHudUpdate(true);}catch(e){}
  try{if(typeof heroSpSyncUI==='function')heroSpSyncUI();}catch(e){}
  try{if(typeof buildWeaponList==='function')buildWeaponList();}catch(e){}
  /* ⑦ 可选上报服务器（k 只认 lightning / eclipse / general） */
  var 报='未上报（只写本机；要跨设备请用 管理员(1)）';
  if(on===1||on==='1'||on===true){
    报='跳过（没在联机房间）';
    try{
      if(typeof netIsMulti==='function'&&netIsMulti()&&typeof NET!=='undefined'&&NET&&NET.connected){
        var ks=['lightning','eclipse','general'];
        for(var i2=0;i2<ks.length;i2++)netSend({t:'clear',k:ks[i2],off:want?0:1});
        报='已上报 '+ks.length+' 项';
      }
    }catch(e){报='上报失败';}
  }
  /* ⑧ 打印一张清单：还剩谁锁着，一眼看全 */
  var 还锁=[];
  try{ for(var i=0;i<HEROES.length;i++){ var why=heroLocked(i); if(why)还锁.push(HEROES[i].name+'（'+why+'）'); } }catch(e){}
  console.log('%c【管理员】'+(want?'🔓 一键全解锁':'🔒 全部锁回去'),
    'color:'+(want?'#7fffd0':'#ff8a8a')+';font-weight:700;font-size:14px');
  console.log('  闪电 '+(want?'✅':'❌')+'   蚀日者 '+(want?'✅':'❌')+'   大将军 '+(want?'✅':'❌')+
              '   第三章记录 '+(want?'✅':'❌')+'   第四章记录 '+(want?'✅':'❌')+'   纪念枪「长明」'+纪念);
  console.log('  熟练度（SP 形态）：'+sp+'   服务器：'+报);
  console.log('  还锁着的英雄：'+(还锁.length?(还锁.length+' 个 → '+还锁.join('、')):'没有，全部可选 ✅'));
  try{if(typeof showMsg==='function')showMsg(want?'🔓 管理员：所有解锁已打开（三英雄 + SP 全开 + 纪念枪）':'🔒 管理员：解锁已全部关闭','#7fffd0');}catch(e){}
  return {改前:前,现在:{闪电:UNLOCK.lightning,蚀日者:UNLOCK.eclipse,大将军:UNLOCK.general,第三章:UNLOCK.station},
          熟练度:sp,纪念枪:纪念,服务器:报,还锁着:还锁};
}
try{ window['管理员']=管理员; window.admin=管理员; window['全解锁']=管理员; window.unlockAll=管理员; }catch(e){}
/* 【batch171】熟练度灌满（调试/测试 SP 用，写本地存档） */
function spXpFill(i){
  try{
    i=(i===undefined||i===null)?(SK?SK.idx:0):(i|0);
    if(i<0||i>=4)i=0;
    var d=spXpOf(i);d.xp=SP_XP_TABLE[SP_MAX_LV];d.lv=SP_MAX_LV;spXpSave();
    if(typeof showMsg==='function')showMsg('「'+HEROES[i].name+'」熟练度已灌满：⚡ SP 形态解锁','#ffd166');
    if(typeof buildHeroGrid==='function')buildHeroGrid();
    return true;
  }catch(e){return false;}
}
var PASSIVE_ADS_SPEED=1.35;    // 流火：开镜时移速倍率（普通兵种开镜会拖慢脚步，流火不慢反快）
var PASSIVE_NADE_CUT=0.7;      // 镇岳：受到的手雷伤害 ×0.7（减伤 30%）
var PASSIVE_SCOUT_R=18;        // 天狼：敌人进到这个半径内 → 朝那个方向闪红光（米）
var PASSIVE_MEDIC_HEAL=1.5;    // 白泽：受到的治疗 +50%（全队只有白泽有这个加成）
var PASSIVE_MEDIC_SMOKE=1.5;   // 白泽身处烟雾中：治疗再 +50%（乘算）
/* 【batch145】portal 已移出：日蚀之门不再"拿在手里扔"，改成「按技能键 → 虚化 → 飘过去放门」 */
var THROW_KINDS={mine:1,flash:1,medkit:1,frag:1,smoke:1,medsmoke:1,pulse:1,solar:1,orb:1,trap:1,suneye:1,ssmoke:1,sbomb:1,sp_drone:1,sp_net:1,sp_sunfall:1};   // 【batch177】+sp_net：电磁网改成真投掷物   // 【batch181】+sp_sunfall：蚀日者 SP「堕日」   // 需要「持握 → 瞄准 → 抛出」流程的技能（【batch125】日之眼也改成投掷；【batch158】影月两件投掷道具；【batch172】蜂鸟无人机）
/* ==================== 【batch120】新英雄常量（口径与服务端同名常量一致）==================== */
/* ⑤蚀日者：蚀日 / 日蚀之门 / 日之眼 */
var SOLAR_R=12, SOLAR_LIFE=8, SOLAR_H=4.2;        // 黑日：笼罩半径 / 持续秒 / 悬空高度
var SOLAR_PULSE=1.0, SOLAR_BLIND=1.0, SOLAR_DOT=0.45;   // 【batch125】脉冲间隔 1 秒 / 每次全白 1 秒 / 「朝它看」的余弦门槛
var SOLAR_DMG=15;                                        // 【batch125】朝黑日看的人，每次脉冲吃 15 点伤害
var PORTAL_LIFE=15.0, PORTAL_R=1.35, PORTAL_CD=0.6;     // 【batch145】传送门：存在 15 秒 / 进门判定半径 / 连穿冷却
var PORTAL_GHOST_SPD=0.34, PORTAL_GHOST_MAX=12;         // 【batch145】虚化：飘行速度 / 最长虚化秒数
var PORTAL_EXIT_FWD=2.2;                                 // 【batch152】传送落点：沿玩家视角朝前偏移的米数（须 > PORTAL_R，否则站着不动会被传回）
var SUNEYE_R=30, SUNEYE_LIFE=7;                          // 日之眼：暴露半径 / 持续秒（batch152 起改为全图，半径仅作兜底）
var SOLAR_BURN=0.16;                                     // 【batch152】太阳：朝黑日看的敌人被「灼烧」（约 9.6 点/秒，持续约 2.5 秒）的每帧伤害
/* 【batch158】⑦影月：暗影系参数 */
var SHADOW_R=4, SHADOW_LIFE=10, SHADOW_DPS=15;           // 暗影毒圈：半径（米）/ 持续秒 / 每秒毒伤
var SHADOW_SELF_LIFE=20;                                 // 遁入暗影：最长 20 秒（可再按技能键提前退出）
var PASSIVE_ECLIPSE_SPD=1.15;                            // 被动：站在自己的日蚀圈里移速 +15%
/* ⑥闪电：闪电光球 / 电荷陷阱 / 球形闪电 */
var ORB_R=2.0, ORB_LIFE=6, ORB_DMG=25, ORB_DEBUFF=20, ORB_ZAP_SLOW=0.6;   // 电区半径 / 存在秒 / 电击伤害 / 减益秒 / 麻痹再慢比例（乘算 0.6＝再 −40%）
/* 【batch121c 补漏】易伤系数。原来 heroMitigate 里写了 dmg*ORB_VULN 却**从没声明过这个常量**：
   只要 SK.vuln>0（联机被电区命中后就会置上），减伤函数就返回 NaN → S.hp 变 NaN → 血条 NaN、永远打不死。
   服务端同名常量 ORB_VULN 一起补，两边口径一致。 */
var ORB_VULN=1.25;                                        // 易伤：受到的伤害 +25%
var TRAP_R=2.2, TRAP_HP=60, TRAP_N=4, TRAP_DMG=20, TRAP_GAP=0.26, TRAP_LIFE=30;   // 触发半径 / 血量 / 连劈次数 / 每下伤害 / 间隔 / 存在秒
var BALL_N=3, BALL_SPD=34, BALL_LIFE=3.5, BALL_HIT_R=1.05;   // 球形闪电：装填枚数 / 飞行速度 / 最长飞行秒 / 命中判定半径
var BALL_RANGE=120;                                      // 【batch123b】服务端校验用：离发射者最远不会超过这个距离（防作弊）
var BALL_FIRE_GAP=0.28;                                  // 【batch123】两发之间的最小间隔（防止一次连点把 3 发糊在同一帧）
var PASSIVE_LIGHT_SPRINT=1.12;                            // 被动：冲刺时移速 +12%
/* 倒地（球形闪电命中）：本地 AI 与服务端同一口径 */
var DB_DOWN=50;                                           // 倒地后多少秒没人治就死（秒）
var DB_REVIVE_HP=0.4;                                     // 被治疗扶起时的血量比例
var projList=[];
var smokeZones=[];                                               // 正在生效的烟团 {x,y,z,r,t,gold}（y＝落地高度，屏幕雾用它区分"在烟里/在塔上"）
/* 视线是否被烟挡住（2D 线段 × 圆）：AI 的视野判定会调用它 —— 躲在烟后小兵就看不见你 */
function smokeBlocks2D(x1,z1,x2,z2){
  for(var i=0;i<smokeZones.length;i++){
    var s=smokeZones[i];if(s.t<=0)continue;
    var dx=x2-x1,dz=z2-z1,L2=dx*dx+dz*dz;
    if(L2<1e-6)continue;
    var t=((s.x-x1)*dx+(s.z-z1)*dz)/L2;
    if(t<0)t=0;else if(t>1)t=1;
    var px=x1+dx*t-s.x,pz=z1+dz*t-s.z;
    if(px*px+pz*pz<s.r*s.r)return true;
  }
  return false;
}
/* 出手方向 / 起手点：抬头看天 = 高抛；水平方向由 yaw 定 */
function heroThrowVel(){
  var cp=Math.cos(pitch);
  return {vx:-Math.sin(yaw)*cp*PROJ_SPEED, vy:Math.sin(pitch)*PROJ_SPEED+PROJ_LIFT, vz:-Math.cos(yaw)*cp*PROJ_SPEED};
}
function heroThrowFrom(){
  var cp=Math.cos(pitch);
  var fx=camera.position.x-Math.sin(yaw)*cp*0.7, fz=camera.position.z-Math.cos(yaw)*cp*0.7, fy=camera.position.y-0.35;
  /* 【batch125】贴墙时的坑：出手点在相机前 0.7 米，站在墙边/门框边时那一点正好落在墙体内 →
     投掷物第一步就判"撞墙" → 原地落地，看着像"扔不出去"（房子里尤其容易遇到）。
     所以：前点被挡就往回缩（0.7 → 0.45 → 0.2 → 相机原地），保证一定有一个能出手的位置。 */
  var d=0.7;
  while(d>0.05&&isColliding(fx,fz,0.14,fy)){ d-=0.25; fx=camera.position.x-Math.sin(yaw)*cp*d; fz=camera.position.z-Math.cos(yaw)*cp*d; }
  return {x:fx, y:fy, z:fz};
}
function projSpawn(kind,x,y,z,vx,vy,vz,opt){
  opt=opt||{};
  var p={kind:kind,x:x,y:y,z:z,vx:vx,vy:vy,vz:vz,
    fuse:(opt.fuse==null?-1:opt.fuse),rest:(opt.rest==null?PROJ_REST:opt.rest),
    landFuse:(opt.landFuse==null?0:opt.landFuse),                 // 「落地后引信」：第一次触地才开始计时
    mesh:opt.mesh||null,remote:!!opt.remote,landed:false,acc:0,dead:false,
    /* 【batch172】蜂鸟无人机联机复现：straight=true → 不受重力、不弹墙、不落地，
       沿初速方向直线飞 life 秒后消失（判定只在投掷者本机做，远端纯画面）。 */
    straight:!!opt.straight,life:(opt.life==null?-1:opt.life),
    onLand:opt.onLand||null,onBoom:opt.onBoom||null};
  if(p.mesh){p.mesh.position.set(x,y,z);if(!p.mesh.parent)scene.add(p.mesh);}
  projList.push(p);
  return p;
}
function projRemove(p,keepMesh){
  if(!p||p.dead)return;
  p.dead=true;
  var i=projList.indexOf(p);if(i>=0)projList.splice(i,1);
  if(!keepMesh&&p.mesh&&p.mesh.parent)p.mesh.parent.remove(p.mesh);
}
/* 撞墙 / 撞箱子反弹：拿"上一步的位置"判断是从哪一面撞进去的，再把那一轴的速度反向 */
function projWallBounce(p,ox,oz){
  for(var i=0;i<obstacles.length;i++){
    var o=obstacles[i];
    /* 【batch178】定向墙：按楼层 + 本地坐标判定，沿法线反弹 */
    if(o.spWall){
      if(o.rising)continue;
      if(p.y-PROJ_R>o.y1-0.02||p.y+PROJ_R<o.y0-0.02)continue;
      if(!(typeof spWallContains==='function'?spWallContains(o,p.x,p.z):true))continue;
      var _c=Math.cos(o.ang),_s=Math.sin(o.ang);
      var _vx=p.vx,_vz=p.vz;
      var vLong=_vx*_c-_vz*_s, vNorm=_vx*_s+_vz*_c;   // 本地 X（长边）/ 本地 Z（法线）
      vNorm=-vNorm*p.rest;                             // 法线分量反向（反弹）
      p.vx=_c*vLong+_s*vNorm; p.vz=-_s*vLong+_c*vNorm;
      var _dx=p.x-o.cx,_dz=p.z-o.cz;
      var _lx=_dx*_c-_dz*_s,_lz=_dx*_s+_dz*_c;
      var _side=(_lz>=0)?1:-1, _lzn=_side*(o.hth+PROJ_R);
      p.x=o.cx+_c*_lx+_s*_lzn; p.z=o.cz-_s*_lx+_c*_lzn;   // 推出到墙外（沿法线那一侧）
      return true;
    }
    if((o.rail||o.slab)&&(p.y<o.y0-0.02||p.y>o.y1+0.02))continue;
    if(p.y-PROJ_R>=(o.h||0)-0.02)continue;
    if(p.x+PROJ_R>o.minX&&p.x-PROJ_R<o.maxX&&p.z+PROJ_R>o.minZ&&p.z-PROJ_R<o.maxZ){
      var wasX=(ox+PROJ_R>o.minX&&ox-PROJ_R<o.maxX);
      var wasZ=(oz+PROJ_R>o.minZ&&oz-PROJ_R<o.maxZ);
      var cx=(o.minX+o.maxX)*0.5,cz=(o.minZ+o.maxZ)*0.5;
      if(!wasX){p.x=(ox<cx?o.minX-PROJ_R:o.maxX+PROJ_R);p.vx=-p.vx*p.rest;
                p.nx=(ox<cx?-1:1);p.nz=0;p.ny=0;}
      else if(!wasZ){p.z=(oz<cz?o.minZ-PROJ_R:o.maxZ+PROJ_R);p.vz=-p.vz*p.rest;
                p.nx=0;p.nz=(oz<cz?-1:1);p.ny=0;}
      else{
        var _dxl=(p.x+PROJ_R)-o.minX,_dxr=o.maxX-(p.x-PROJ_R);
        var _dzl=(p.z+PROJ_R)-o.minZ,_dzr=o.maxZ-(p.z-PROJ_R);
        if(Math.min(_dxl,_dxr)<=Math.min(_dzl,_dzr)){
          p.x=(_dxl<_dxr?o.minX-PROJ_R:o.maxX+PROJ_R);p.vx=-p.vx*p.rest;
          p.nx=(_dxl<_dxr?-1:1);p.nz=0;p.ny=0;
        }else{
          p.z=(_dzl<_dzr?o.minZ-PROJ_R:o.maxZ+PROJ_R);p.vz=-p.vz*p.rest;
          p.nx=0;p.nz=(_dzl<_dzr?-1:1);p.ny=0;
        }
      }
      return true;
    }
  }
  return false;
}
/* 固定步长推进（1/60 秒一步，多帧补齐）—— 与帧率无关，联机各端轨迹一致 */
/* ==================== 【batch110】投掷物的「真地形表面」 ====================
   旧代码只认基础地面（y<=0）：扔到方块顶上 / 高塔平台上会一路穿下去，
   落地引信与落地回调都不响。这里按「地面 0 / 方块顶面 o.h / 塔顶平台 TOWER_TOP+0.6」
   取当前能落上去的最高面。
   yPrev ＝ 本步积分**之前**的高度：只认"本来就在它上方"的面，
   避免从下面飞过时被吸到上面去（例如从塔下穿过去不会被拽到 11.6 米）。
   塔顶平台悬挑到 platHalf（比塔柱 AABB 大），所以单独判一次。 */
/* 【batch140】找"这一步从下往上穿过"的最低楼板 / 栏杆底面 y0（没有就 Infinity）。
   只认 rail / slab：普通方块是实心的，投掷物撞它由 projWallBounce 处理。
   用户要求：战术装备不仅贴地面和墙，**也该能贴天花板**。 */
/* 【batch142】绕**自身**轴自转。
   贴面吸附后的装置必须绕自己的 Y 轴转（`rotateY`），不能写 `rotation.y+=` ——
   后者按世界欧拉角重算，会把"底面贴住墙面"的朝向整个冲掉。
   但探针里的迷你 THREE 桩没实现 rotateY，所以这里做一次能力判断再调。 */
/* 【batch143】把一件装置按**所在面的法线**摆正（地面 / 墙 / 天花板 / 斜面通用）。
   · 默认约定「本地 +Y 是"底面 → 机身"的方向」—— 探测器 / 陷阱 / 六边形地砖都是这么建的；
   · 面朝型装置（日之眼 / 日蚀之门：本地 +Z 是正面）传 axis='z'。
   法线全是 0（没有法线）时直接返回，行为与"不贴面"完全一致。 */
function faceNormal(obj,nx,ny,nz,axis){
  if(!obj||!obj.quaternion)return false;
  var n=new THREE.Vector3(nx||0,ny||0,nz||0);
  if(n.lengthSq()<1e-6)return false;
  try{
    obj.quaternion.setFromUnitVectors(
      (axis==='z')?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0),
      n.normalize());
    return true;
  }catch(e){return false;}
}
/* 【batch143】把装置放到「落点 + 沿法线抬起 lift 米」的位置并摆正。
   地面（法线朝上）时行为与旧代码逐字一致（只沿 +Y 抬高 lift）。 */
function mountAt(obj,x,y,z,nx,ny,nz,lift,axis){
  if(!obj)return;
  var _z=(axis==='z');
  var _has=(typeof nx==='number')||(typeof ny==='number')||(typeof nz==='number');
  var _ny;
  if(typeof ny==='number')_ny=ny;
  else if(!_has)_ny=_z?0:1;            // 完全没有法线：按"地面"兜底
  else _ny=0;                          // 只给了 nx/nz（墙面）→ 竖直分量为 0
  var n=new THREE.Vector3(nx||0,_ny,nz||0);
  if(n.lengthSq()<1e-6)n=new THREE.Vector3(0,1,0);
  n.normalize();
  obj.position.set(x+n.x*lift,y+n.y*lift,z+n.z*lift);
  if(_z){ if(n.y<0.9)faceNormal(obj,n.x,n.y,n.z,'z'); }
  else faceNormal(obj,n.x,n.y,n.z,null);
}
function spinY(obj,rad){
  if(!obj)return;
  if(typeof obj.rotateY==='function')obj.rotateY(rad);
  else if(obj.rotation)obj.rotation.y+=rad;
}
function ceilBlockAt(x,z,yFrom,yTo){
  var best=Infinity;
  for(var i=0;i<obstacles.length;i++){
    var o=obstacles[i];
    if(!(o.rail||o.slab))continue;
    if(typeof o.y0!=='number')continue;
    if(x+PROJ_R<o.minX||x-PROJ_R>o.maxX||z+PROJ_R<o.minZ||z-PROJ_R>o.maxZ)continue;
    if(o.y0>yFrom&&o.y0<=yTo+PROJ_R&&o.y0<best)best=o.y0;
  }
  return best;
}
function projSurfAt(x,z,yPrev){
  var s=0;                                                               // 基础地面
  for(var i=0;i<obstacles.length;i++){
    var o=obstacles[i];
    if(o.rail)continue;                                                  // 栏杆是薄栏：只做水平阻挡，不算可站的顶面
    if(x<o.minX||x>o.maxX||z<o.minZ||z>o.maxZ)continue;
    var top=(o.slab&&typeof o.y1==='number')?o.y1:(o.h||0);              // 楼板 / 平台：可站的顶面在 y1（batch111 起塔顶平台也是楼板）
    if(top<=yPrev+PROJ_R+0.06&&top>s)s=top;
  }
  return s;
}
/* 触地 —— 只算第一次（表面接触 / 撞墙都会调）：
   ① 标记 landed；② 启动「落地后引信」landFuse；③ 跑落地回调 onLand（探测器吸附 / 烟雾铺开）。
   snap=true（撞墙触发）时先把投掷物落到它正下方的那个表面上，免得半空中吸住（探测器会挂在墙上）。 */
function projTouchGround(p,snap){
  if(p.landed)return;
  p.landed=true;
  /* 【batch140】吸附朝向：把装置的**底面**对准所在的那张面。
     本地 +Y 是"从底面指向机身"的方向（底盘在 -Y），所以让 +Y 对准表面法线，
     底面就自然贴平在那张面上 —— 地面朝上、墙壁朝外、天花板朝下，全都一个公式。
     用户："底面应该自动贴向墙壁，而不是只朝一个地方"、"贴天花板时天花板也该有特效"。
     （法线由 projWallBounce / projSurfAt / ceilBlockAt 三处分别记入 p.nx/ny/nz） */
  /* 【batch143】统一走 faceNormal：面朝型装置（日之眼 / 日蚀之门，本地 +Z 是正面）
     用 'z' 轴约定 —— 贴到墙上时正面朝屋外，而不是"沿着墙平躺"。
     其他装置仍是 +Y（底面 → 机身），与 batch140 逐字等价。 */
  if(p.mesh&&(p.nx||p.ny||p.nz)){
    var _fz=(p.kind==='suneye'||p.kind==='portal');          // 面朝型装置
    /* 【batch143b】地面（法线朝上）时**保持原样**：眼睛悬在落点上方、正面朝前，
       与施放者本机看到的完全一致；只有墙 / 天花板 / 斜面才把正面转到那一面。 */
    if(!(_fz&&typeof p.ny==='number'&&p.ny>=0.9))
      faceNormal(p.mesh,p.nx||0,p.ny||0,p.nz||0,_fz?'z':null);
  }
  /* 【batch135】撞墙（snap=true）**不再把它拽到下方的地面上**。
     原来这里会 projSurfAt 取"正下方能站的面"，然后 p.y=s0+PROJ_R ——
     站在二楼朝墙面/门楣扔，投掷物一碰墙就被吸到一楼地面，烟和爆焰自然全铺在一楼。
     现在：撞到哪儿就落在哪儿 → 引信一到就在**那个高度**炸开。
     二楼是二楼、半空是半空（用户："不一定要在地面爆炸，二楼也会有特效"）。 */
  /* 【batch110b】网格位置**无条件**落定：onLand（探测器）里会立刻 projRemove(p,true) 保留网格，
     那样 projStep 末尾的 `if(!p.dead&&p.mesh)` 就不再写位置，网格会停在上一步（浮在半空/埋进面里）。 */
  if(p.mesh)p.mesh.position.set(p.x,p.y,p.z);
  if(p.landFuse>0)p.fuse=p.landFuse;
  if(p.onLand)p.onLand(p);
}
function projStep(dt){
  if(!projList.length)return;
  var h=1/60;
  for(var i=projList.length-1;i>=0;i--){
    var p=projList[i];if(p.dead)continue;
    p.acc+=dt;var guard=0;
    while(p.acc>=h&&guard++<10&&!p.dead){
      p.acc-=h;
      var ox=p.x,oz=p.z,oy=p.y;                                          // 【batch110】oy＝本步积分前的高度
      /* 【batch172】直线飞行物（蜂鸟无人机）：无重力、不弹墙、不落地，飞满 life 或出界就消失 */
      if(p.straight){
        p.x+=p.vx*h;p.y+=p.vy*h;p.z+=p.vz*h;
        if(p.life>0){p.life-=h;if(p.life<=0){projRemove(p);break;}}
        if(Math.abs(p.x)>worldLimit()||Math.abs(p.z)>worldLimit()){projRemove(p);break;}
        continue;
      }
      p.vy-=PROJ_G*h;
      p.x+=p.vx*h;p.y+=p.vy*h;p.z+=p.vz*h;
      if(projPortalWarp(p))continue;                                     // 【batch145】飞进日蚀之门 → 从另一扇出来
      var _surf=projSurfAt(p.x,p.z,oy);                                  // 【batch110】真地形表面：地面 / 方块顶 / 塔顶平台
      var _onSurf=false;
      if(p.y-PROJ_R<=_surf){                                             // 落在表面上：弹一下 + 摩擦 + 触地
        p.y=_surf+PROJ_R;_onSurf=true;
        if(Math.abs(p.vy)>1.3)p.vy=-p.vy*p.rest;else p.vy=0;
        p.vx*=PROJ_FRIC;p.vz*=PROJ_FRIC;
        p.nx=0;p.ny=1;p.nz=0;                                            // 【batch140】地面法线（朝上）
        projTouchGround(p,false);
        if(p.dead)break;
      }
      /* 【batch140】天花板：往上飞时撞到楼板 / 栏杆底面 → 吸附在那块底面上。
         以前完全没有天花板碰撞，往上扔会穿过去、翻到楼板顶上。 */
      else if(p.vy>0){
        var _cy=ceilBlockAt(p.x,p.z,oy,p.y);
        if(_cy<Infinity){
          p.y=_cy-PROJ_R;p.vy=0;
          p.vx*=PROJ_FRIC;p.vz*=PROJ_FRIC;
          p.nx=0;p.ny=-1;p.nz=0;                                        // 天花板法线（朝下）
          projTouchGround(p,true);
          if(p.dead)break;
        }
      }
      if(projWallBounce(p,ox,oz)){projTouchGround(p,true);if(p.dead)break;}   // 【batch110】撞墙同样触发引线（用户要求）
      if(p.x>worldLimit()||p.x<-worldLimit()){p.x=Math.max(-worldLimit(),Math.min(worldLimit(),p.x));p.vx=-p.vx*p.rest;}
      if(p.z>worldLimit()||p.z<-worldLimit()){p.z=Math.max(-worldLimit(),Math.min(worldLimit(),p.z));p.vz=-p.vz*p.rest;}
      var onG=_onSurf||(p.y-PROJ_R<=projSurfAt(p.x,p.z,p.y)+0.02);        // 【batch110】静止判定也按真表面（能在方块顶上停下来）
      if(onG&&p.vx*p.vx+p.vy*p.vy+p.vz*p.vz<PROJ_STOP*PROJ_STOP){p.vx=0;p.vy=0;p.vz=0;}
      if(p.fuse>0){                                                      // 引信到点 → 引爆
        p.fuse-=h;
        if(p.fuse<=0){if(p.onBoom)p.onBoom(p);projRemove(p);break;}
      }
    }
    if(!p.dead&&p.mesh)p.mesh.position.set(p.x,p.y,p.z);
  }
}
var TEAM_R=8, ZONE_R=6, KNOCK_DIST=3;                            // 团队增益半径（米）/ 堡垒阵地半径（米）/ 震荡打击击退距离（米）
/* 「看没看向爆点」系数：从受闪者指向爆点的方向 与 他的视线方向 的夹角余弦 → 0..1
   正对（≥0.82，约 35°）全效；侧对递减；背对（≤0.35，约 70°）完全不闪 —— 和 CS 的闪光弹一个道理。 */
function flashFaceFactor(fx,fz,px,pz,vx,vz){
  var dx=fx-px,dz=fz-pz,L=Math.sqrt(dx*dx+dz*dz)||1;
  var d=(dx*vx+dz*vz)/L;
  if(d<=FLASH_DOT_MIN)return 0;
  if(d>=FLASH_DOT_FULL)return 1;
  return (d-FLASH_DOT_MIN)/(FLASH_DOT_FULL-FLASH_DOT_MIN);
}
/* 抛物线预览 / 持握 用到的碰撞测试（只判断、不改状态） */
function projHitsWall(x,y,z){
  for(var i=0;i<obstacles.length;i++){
    var o=obstacles[i];
    if(o.rail&&(y<o.y0-0.05||y>o.y1))continue;
    if(y-PROJ_R>=(o.h||0)-0.02)continue;                                 // 【batch110b】同 projWallBounce：停在顶面/飞过都不算撞墙
    if(x+PROJ_R>o.minX&&x-PROJ_R<o.maxX&&z+PROJ_R>o.minZ&&z-PROJ_R<o.maxZ)return true;
  }
  return false;
}