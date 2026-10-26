/* ============================================================================
 *  模组加载器（mode/模组加载器.js）
 *  ----------------------------------------------------------------------------
 *  这个文件由 index.html 在末尾引入。它的工作是：
 *    1. 提供一个全局对象  window.ModLoader  —— 模组作者用来登记自己的模组；
 *    2. 自动读取  mode/模组/载入清单.js  里列出的文件，按顺序把它们加载进来；
 *    3. 全部加载完成后，刷新「选英雄 / 选地图」界面，让新增的英雄、地图立刻出现。
 *
 *  模组文件统一放在  mode/模组/  目录下（可以是 .js 文件，也可以有子目录）。
 *  想要启用 / 停用某个模组，只改  mode/模组/载入清单.js  里的数组即可，不用动这里。
 * ========================================================================== */
(function () {
  'use strict';

  // 模组文件统一目录（相对于网页根目录）。中文目录名在现代浏览器 + 本游戏服务器下均可正常使用。
  var BASE = 'mode/模组/';

  /* ---------------- 全局注册表：模组作者可以用这些辅助函数 ---------------- */
  window.ModLoader = window.ModLoader || {
    mods: [],          // 用 register() 登记过的模组对象
    initFns: [],       // 用 onApply() 登记的“全部载入后执行”回调

    // 登记一个模组（可选）。obj 形如 { name:'xxx', init:function(){/**/} }
    register: function (obj) { if (obj) this.mods.push(obj); },

    /* ---------------- 退出对局清场：让模组清掉自己放进场上的物体 ---------------- */
    // 退出对局（回主菜单）时引擎会调 ModLoader.clearField()，逐个调用这里登记的函数。
    // 模组把"本局加进场景的东西"（黑洞 / 假人 / 歌声光环 / 远端复现物…）在登记函数里收掉即可，
    // 否则回主菜单再开一局时上一局的物体还留在场上。
    //   ModLoader.onFieldClear(function(){ 移除我的场上物体 });
    _fieldClears: [],
    onFieldClear: function (fn) { if (typeof fn === 'function') this._fieldClears.push(fn); },
    clearField: function () { for (var i = 0; i < this._fieldClears.length; i++) { try { this._fieldClears[i](); } catch (e) { } } },

    // 加英雄：hero 必须是 HEROES 数组里的一项（包含 k/name/skills 等字段）。
    // 想让它**在联机里也正常**（别人能看到你的英雄、吃得到你的技能），给 hero 加这几个可选字段：
    //   · k          : 字符串键（如 'myhero'），只做标识用，不强制
    //   · remoteModel: function(model, info){ /* 自定义其他玩家看你时的第三人称外观 */ }
    //                  —— 不写就用通用联机模型（所有人长得一样）；写了就按你的英雄打扮
    //   · sync       : function(skillKey, data, srcPlayer){ /* 别人放你这个英雄的技能时，在他机器上复现效果 */ }
    //                  —— 关键！联机时引擎会把你的技能事件 {t:'modsk', k:skillKey, d:data} 转发出去，
    //                    收到的人会调用  HEROES[英雄下标].sync(skillKey, data, 那个远端玩家对象)。
    //                    注意：本地施放时由你的 cast/触发函数自己播特效 + 调 ModLoader.heroBroadcast；
    //                    远端只跑 sync（不会重复跑本地的 cast），所以伤害/特效要在 sync 里也写一遍。
    addHero: function (hero) { if (hero && hero.k) { hero._mod = true; HEROES.push(hero); } },

    /* ---------------- 多人英雄：技能事件广播 / 远端外观 ---------------- */
    // 本地施放了一个自定义英雄技能 → 把事件广播给同房其他玩家。
    //   ModLoader.heroBroadcast('冰环', { x:px, y:py, z:pz, r:8 });
    // 其他玩家收到后会自动调用你这个英雄 def 上的 sync('冰环', data, 远端玩家对象)。
    // 联机才发（单机或没连服务器时静默忽略）。
    heroBroadcast: function (skillKey, data) {
      try {
        if (typeof NET === 'undefined' || !NET || !NET.connected) return;
        if (typeof netSend === 'function') netSend({ t: 'modsk', k: String(skillKey || ''), d: data });
      } catch (e) { }
    },

    // 远端玩家（其他真人）建好或换英雄时调用：让你有机会按英雄自定义他的第三人称外观。
    // model 结构同 _buildPlayerModel() 返回的对象（含 root / modelGroup / head 等）。
    // 不自定义就保持通用模型（什么都不做）。
    onRemoteHero: function (e, idx) {
      try {
        if (typeof HEROES === 'undefined' || !HEROES) return;
        var H = HEROES[idx];
        if (H && typeof H.remoteModel === 'function') H.remoteModel(e, idx);
      } catch (e) { }
    },

    // 加地图：map 必须是 MAPS 数组里的一项（包含 id/name/build 等字段）
    // ★ 如果 map 里带了 spawns 字段（出生点表），会顺手帮你注册到 MAP_SPAWNS —— 见下面 addSpawn
    addMap: function (map) {
      if (map && map.id) {
        MAPS.push(map);
        if (map.spawns) ML.addSpawn(map.id, map.spawns, true);
      }
    },

    // ── 出生点钩子（新地图必须配套！）────────────────────────────────
    // 为什么必须加：游戏开局是从当前地图的出生点表里**随机抽一个**把玩家放过去
    // （见 playerSpawnAt：`MAP_SPAWNS[curMapId] || [[0,15]]`）。
    // 你的新地图没注册出生点的话，会 fallback 到经典图的默认点 [0,15] ——
    // 那在你的图里很可能是墙里、坑里、或者直接悬空掉出地图。
    //
    //   ModLoader.addSpawn('你的地图id', [[x,z], [x,z], ...]);   // 一批点
    //   ModLoader.addSpawn('你的地图id', [x, z]);                // 单个点也行
    //   ModLoader.addSpawn('你的地图id', [...], true);           // true = 覆盖（重来一遍）
    //
    // 坐标怎么选：挑地图上**开阔的地面**，别压在墙/箱子/树上；
    // 联机的话还要把同一份表加到服务端（见教程第 11 章）。
    addSpawn: function (mapId, points, replace) {
      if (!mapId || points == null) { warn('addSpawn：缺少地图 id 或坐标'); return; }
      if (typeof MAP_SPAWNS === 'undefined' || !MAP_SPAWNS) { warn('addSpawn：找不到全局 MAP_SPAWNS'); return; }
      var list = Array.isArray(points[0]) ? points : [points];   // 允许传单个 [x,z]
      try {
        if (!Array.isArray(MAP_SPAWNS[mapId]) || replace) MAP_SPAWNS[mapId] = [];
        for (var i = 0; i < list.length; i++) MAP_SPAWNS[mapId].push(list[i]);
        log('地图「' + mapId + '」已注册出生点，共 ' + MAP_SPAWNS[mapId].length + ' 个');
      } catch (e) { warn('addSpawn 出错：' + (e && e.message)); }
    },

    // ── 剧情章节钩子 ──────────────────────────────────────────────
    // 加一整个自定义剧情章节（第 n 章）。n 别和原版的 1 / 2 撞车。
    //
    //   ModLoader.addStory({
    //     n:3, icon:'🌋', name:'第三章 · 火山据点', map:'火山据点',
    //     desc:'选章节界面上显示的说明文字',
    //
    //     // ↓ 下面全是可选的，不写就复用原版第一章那套「清剿 → boss → 决斗」流程
    //     mapId:'volcano',        // 用哪张地图（填地图 id；不填用剧情默认图）
    //     spawn:[0,25],           // 固定出生点 [x,z]；不填就从该图出生点表随机
    //     need:30,                // 清剿目标数（干掉多少个才进 boss）
    //     lines:['开场白1','开场白2'],        // 开场台词
    //     goal:function(){ return '守住据点 3 分钟'; },   // HUD 上显示的目标
    //     init:function(){ /* 刚进图时（放道具、设变量） */ },
    //     begin:function(){ /* 开场白演完、玩法正式开始 */ },
    //     tick:function(dt){ /* 每帧推进；return true 表示你已全权接管，原版流程不再跑 */ },
    //     winLines:['赢了…'], loseLines:['输了…'],       // 结局台词
    //     reward:function(win){ /* 通关奖励，比如解锁英雄 */ },
    //     done:function(){ return false; }   // 章节列表里显示"已通关"吗
    //   });
    addStory: function (chap) {
      if (!chap || !chap.n) { warn('addStory：章节缺少 n（章节号）'); return; }
      try {
        if (typeof STORY_CHAPS !== 'undefined' && Array.isArray(STORY_CHAPS)) {
          var hit = false;
          for (var i = 0; i < STORY_CHAPS.length; i++) {
            if (STORY_CHAPS[i] && STORY_CHAPS[i].n === chap.n) { STORY_CHAPS[i] = chap; hit = true; break; }
          }
          if (!hit) STORY_CHAPS.push(chap);
        }
        if (typeof STORY_CUSTOM !== 'undefined' && STORY_CUSTOM) STORY_CUSTOM[chap.n] = chap;
        // 章节面板此刻若开着就重画一下
        try { if (typeof storyBuildChap === 'function') storyBuildChap(); } catch (e) { }
        log('已登记剧情章节：第 ' + chap.n + ' 章 · ' + (chap.name || ''));
      } catch (e) { warn('addStory 出错：' + (e && e.message)); }
    },

    // ── 玩法模式钩子（自定义"这一局怎么玩"）────────────────────────
    // 想做瓦罗兰特那种回合制战术射击、或和平精英那种缩圈大逃杀，就用这个。
    //
    //   ModLoader.addGameMode({
    //     id:'br', name:'大逃杀', icon:'🪂', desc:'缩圈吃鸡，活到最后',
    //     start:function(){ /* 开局：自己决定刷什么、人在哪（不写就走原版刷波） */ },
    //     tick:function(dt){ /* 每帧：缩圈 / 回合计时 / 积分… dt 是本帧秒数 */ },
    //     hud:function(){ return '剩余 '+42+' 人 · 决赛圈'; },   // HUD 那一栏显示什么
    //     onDeath:function(){ return false; },   // 阵亡时；return true = 不走原版结算面板
    //     end:function(win){ /* 自己宣布结束（win=true 算赢） */ }
    //   });
    //   ModLoader.setGameMode('br');      // 启用（之后开局就按这个玩法来）
    //   ModLoader.setGameMode(null);      // 关掉，恢复原版玩法
    addGameMode: function (mode) {
      if (!mode || !mode.id) { warn('addGameMode：模式缺少 id'); return; }
      try {
        if (typeof GAME_MODES !== 'undefined' && GAME_MODES) GAME_MODES[mode.id] = mode;
        else warn('addGameMode：游戏里还没有 GAME_MODES（版本太旧？）');
        log('已登记玩法模式：' + mode.id + ' · ' + (mode.name || ''));
      } catch (e) { warn('addGameMode 出错：' + (e && e.message)); }
    },
    setGameMode: function (id) {
      try {
        if (id && typeof GAME_MODES !== 'undefined' && GAME_MODES && !GAME_MODES[id]) {
          warn('setGameMode：没有这个模式「' + id + '」，请先 addGameMode 注册');
          return;
        }
        window.CUR_MODE = id || null;
        log('玩法模式已' + (id ? '启用：' + id : '关闭（恢复原版玩法）'));
      } catch (e) { warn('setGameMode 出错：' + (e && e.message)); }
    },
    listGameModes: function () { try { return Object.keys(GAME_MODES || {}); } catch (e) { return []; } },

    // ── 声明"这张地图支持爆能器" ────────────────────────────────
    // 【batch166】爆能器模式只认"声明过支持"的地图（原生三张已内置）。
    // 你模组加的新地图，**必须**调一次这个，否则爆能器模式里不会出现这张图。
    //   ModLoader.addSpikeMap('volcano');
    addSpikeMap: function (mapId, cfg) {
      if (!mapId) { warn('addSpikeMap：缺少地图 id'); return false; }
      try {
        var ok = ModLoader._spikeCfgOk(cfg);
        if (!ok) {
          warn('addSpikeMap「' + mapId + '」被拒绝：自定义地图要进爆能器模式，**必须**声明 ' +
               'sites（下包点，至少 1 个 {x,z}）和 spike（爆能器出生点 {x,z}）。' +
               '没声明=注册失败=spikeMapOk 仍为 false，这张图不会出现在爆能器模式里。');
          return false;
        }
        window.SPIKE_MAPS = window.SPIKE_MAPS || {};
        window.SPIKE_MAPS[mapId] = {
          sites: ok.sites, spike: ok.spike, atk: ok.atk, def: ok.def,
          soloSpawn: ok.soloSpawn, _mod: true
        };
        log('地图「' + mapId + '」已注册进爆能器模式（下包点 ' + ok.sites.length + ' 处）');
        return true;
      } catch (e) { warn('addSpikeMap 出错：' + (e && e.message)); return false; }
    },
    /* 【batch180】校验并规整爆能器地图配置，不合法返回 null。
       为什么强制：以前只声明个 id 就能进，服务端 SPIKE_MAP_CFG 里没有这张图就会
       **静默 fallback 到 classic 的坐标** —— 在你的图里可能正好是墙里 / 坑里 / 图外。
       现在没点位就是进不来，报错也说得清楚。 */
    _spikeCfgOk: function (cfg) {
      try {
        if (!cfg || typeof cfg !== 'object') return null;
        var num = function (v) { return typeof v === 'number' && isFinite(v); };
        var arr = cfg.sites || cfg.包点 || [];
        if (!Array.isArray(arr) || !arr.length) return null;
        var sites = [];
        for (var i = 0; i < arr.length && sites.length < 4; i++) {
          var s = arr[i];
          if (!s || !num(s.x) || !num(s.z)) continue;
          sites.push({ x: s.x, z: s.z });
        }
        if (!sites.length) return null;
        var sp = cfg.spike || cfg.爆能器出生点;
        if (!sp || !num(sp.x) || !num(sp.z)) return null;
        var pt2 = function (v) { return (Array.isArray(v) && num(v[0]) && num(v[1])) ? [v[0], v[1]] : null; };
        return {
          sites: sites, spike: { x: sp.x, z: sp.z },
          atk: pt2(cfg.atk), def: pt2(cfg.def), soloSpawn: pt2(cfg.soloSpawn)
        };
      } catch (e) { return null; }
    },

    // 自检用：（地图已建好、人已经在图里之后）某个点现在卡不卡墙 —— true=空地 / false=压墙
    // 例：在浏览器控制台敲  ModLoader.spawnFree(0, 15)
    spawnFree: function (x, z) {
      try { return !playerBlocked(x, z, standEyeY()); } catch (e) { return null; }
    },

    // 加敌人类型：把新类型合并进 ETYPES（key 为类型名，def 为属性对象）
    addEnemyType: function (key, def) { if (key && def) ETYPES[key] = def; },

    // 加自定义技能：k 为技能标识（自定义，别用原版已有的 dash/shield/eye…），
    // fn(i, s, H) 返回 false 才会退给游戏原版分支；返回其它值（含 true/undefined）即视为"已被模组处理"。
    // 游戏 heroCast 遇到 CUSTOM_SKILLS[k] 会直接交给这里（见 js/41 的钩子）。
    addSkill: function (k, fn) {
      if (k && typeof fn === 'function') {
        window.CUSTOM_SKILLS = window.CUSTOM_SKILLS || {};
        window.CUSTOM_SKILLS[k] = fn;
      }
    },

    // 替换玩家模型：传入一个"返回模型对象"的函数，内部会覆盖 _buildPlayerModel
    setPlayerModel: function (fn) {
      if (typeof fn === 'function') {
        try { window._buildPlayerModel = fn; }
        catch (e) { _buildPlayerModel = fn; }
      }
    },

    // 立刻生成一个敌人（仅在游戏进行中有效）
    spawnEnemy: function (type, x, z) {
      if (typeof createEnemy === 'function') return createEnemy(type, x, z);
      return null;
    },

    // 在“全部模组载入后”执行一段代码（适合做 nextWave 之类的包裹）
    onApply: function (fn) { if (typeof fn === 'function') this.initFns.push(fn); },

    // 手动刷新选英雄 / 选地图界面（当你直接改了全局数组后调用）
    refresh: function () {
      try { if (typeof buildHeroGrid === 'function') buildHeroGrid(); } catch (e) { }
      try { if (typeof buildMapGrid === 'function') buildMapGrid(); } catch (e) { }
    },

    /* ===================================================================
     *  美术（Art）接口
     *  -------------------------------------------------------------------
     *  模组可以在这里给世界加模型、改天空盒 / 雾 / 灯光，或往场景里塞装饰物。
     *  scene / THREE 在模组加载时已经存在（主脚本先把场景建好），所以这些方法
     *  大多能“立刻生效”；setEnv 的环境覆盖会在 applyArt() 里统一套用。
     * ===================================================================*/
    _models: {},            // name -> 返回 Object3D 的构建函数
    _pendingScenery: [],    // scene 还没好时先暂存
    _env: null,             // 环境覆盖（天空盒 / 雾 / 灯光）

    // 登记一个具名模型构建器：fn() 必须返回一个新的 THREE.Object3D
    //   ModLoader.addModel('我的箱子', function(){ var m=new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshLambertMaterial({color:0x88ff88})); return m; });
    addModel: function (name, fn) { if (name && typeof fn === 'function') this._models[name] = fn; },

    // 取一个具名模型的新实例（每次都新建，别忘了加到场景里）
    getModel: function (name) { try { return this._models[name] ? this._models[name]() : null; } catch (e) { return null; } },

    // 列出已登记的所有模型名
    listModels: function () { try { return Object.keys(this._models); } catch (e) { return []; } },

    // 往场景里加一个装饰物 / 道具（Object3D）。scene 没就绪时先暂存，等 applyArt 再挂。
    //   ModLoader.addScenery(ModLoader.getModel('我的箱子'));
    addScenery: function (obj) {
      if (!obj) return;
      try { if (typeof scene !== 'undefined' && scene) scene.add(obj); else this._pendingScenery.push(obj); }
      catch (e) { try { this._pendingScenery.push(obj); } catch (_) { } }
    },

    // 从场景移除一个之前加过的装饰物
    removeScenery: function (obj) { try { if (scene) scene.remove(obj); } catch (e) { } },

    // 加一盏灯（PointLight / DirectionalLight / AmbientLight 都行）
    addLight: function (light) { try { if (scene && light) scene.add(light); } catch (e) { } },

    // 覆盖环境：{ bg:0x112233, fog:0x112233, fogD:0.02, ambient:0.9, ambientColor:0x334455, sunIntensity:1.2 }
    // 颜色用十六进制数字（如 0x1a1a2e）。不传的字段保持原样。
    setEnv: function (o) {
      try { this._env = Object.assign(this._env || {}, o || {}); this.applyArt(); } catch (e) { }
    },

    // 统一套用：环境覆盖 + 暂存的装饰物。模组加载完、切图时都可以再调一次。
    applyArt: function () {
      try {
        var M = this;
        if (M._env && typeof scene !== 'undefined' && scene) {
          var e = M._env;
          if (e.bg != null) { try { scene.background = new THREE.Color(e.bg); } catch (_) { if (scene.background && scene.background.setHex) scene.background.setHex(e.bg); } }
          if (e.fog != null && scene.fog && scene.fog.color) { try { scene.fog.color.setHex(e.fog); } catch (_) { } }
          if (e.fogD != null && scene.fog) { try { scene.fog.density = e.fogD; } catch (_) { } }
          if (e.ambient != null) { scene.traverse(function (o) { if (o.isAmbientLight) { if (e.ambientColor != null) o.color.setHex(e.ambientColor); o.intensity = e.ambient; } }); }
          if (e.sunIntensity != null) { scene.traverse(function (o) { if (o.isDirectionalLight) o.intensity = e.sunIntensity; }); }
        }
        if (M._pendingScenery && M._pendingScenery.length && typeof scene !== 'undefined' && scene) {
          for (var i = 0; i < M._pendingScenery.length; i++) scene.add(M._pendingScenery[i]);
          M._pendingScenery = [];
        }
      } catch (e) { }
    },

    /* ===================================================================
     *  枪械（Weapons）接口
     *  -------------------------------------------------------------------
     *  两种方式：
     *   1) 覆盖内置枪 / 刀的属性：ModLoader.setWeaponStats(0, {damage:2, fireRate:40, ...})
     *      slot 0 = 步枪，slot 1 = 战术刀。damage 是“伤害倍率”（1 = 原版）。
     *   2) 新增一把武器：ModLoader.addWeapon({ name:'霰弹枪', melee:false, damage:1.5,
     *      fireRate:600, magSize:8, range:30, reloadTime:1500, recoil:1.2,
     *      build:function(g){ /* 在 g(一个 Group) 上搭模型 *\/ } })  → 返回一个槽位号 idx
     *      之后用 ModLoader.selectWeapon(idx) 切过去。
     *  引擎会在换枪 / 升级时把 def 里的属性写进 S（射速 / 弹匣 / 换弹 / 后坐 / 伤害），
     *  并在 rebuildWeaponModel 时调用 def.build 来搭第一人称模型。
     *  【batch216】def.build 现在**也被用来搭第三人称**（联机时每个远端玩家各复制一份挂到手上）：
     *    · 只能往传进来的 g 里 add，绝对不能 add 到 weaponGroup / camera（远端没有这些）
     *    · 原点≈握把、-Z 朝枪口、单位是米、真人比例（别为第一人称放大）
     *    · 尽量复用材质（引擎按材质合批，同材质 ≥2 件就并；每件都 new Material 就没法合）
     *    · 想让第三人称长得不一样，可以再给 def.tpBuild(rig)（优先级 highest）
     *  详见《模组开发教程》6.2。
     * ===================================================================*/
    weapons: {},           // idx -> def（新增武器；0/1 是内置，不存这里）
    _wstat: {},            // slot -> 覆盖属性（setWeaponStats 用）
    _wNext: 2,             // 新武器从 2 号槽开始（0=枪 1=刀）

    setWeaponStats: function (slot, def) {
      if (slot == null || !def) return;
      try {
        this._wstat[slot] = Object.assign(this._wstat[slot] || {}, def || {});
        if (typeof applyWeaponDef === 'function') applyWeaponDef();
        if (typeof rebuildWeaponModel === 'function' && currentWeapon === slot) rebuildWeaponModel();
      } catch (e) { warn('setWeaponStats 出错：' + (e && e.message)); }
    },

    // 新增武器，返回槽位号（之后 selectWeapon 用它切换）
    addWeapon: function (def) {
      if (!def || !def.name) { warn('addWeapon：缺少 name'); return -1; }
      try {
        def.melee = !!def.melee;
        if (typeof def.ammo === 'undefined') def.ammo = !def.melee;   // 近战默认无弹药
        if (typeof def.damage !== 'number') def.damage = def.melee ? 80 : 1.0;
        if (typeof def.fireRate !== 'number') def.fireRate = def.melee ? 0 : 50;
        if (typeof def.magSize !== 'number') def.magSize = def.melee ? 0 : 30;
        if (typeof def.reloadTime !== 'number') def.reloadTime = def.melee ? 0 : 1200;
        if (typeof def.range !== 'number') def.range = def.melee ? 3.5 : 80;
        var idx = this._wNext++; this.weapons[idx] = def;
        log('已登记武器：' + def.name + '（槽位 ' + idx + (def.melee ? ' · 近战' : ' · 枪械') + '）');
        return idx;
      } catch (e) { warn('addWeapon 出错：' + (e && e.message)); return -1; }
    },

    /* -------------------------------------------------------------------
     *  投掷物（Throwables）【batch219】
     *  英雄技能"掏出东西拿在手上"用的道具模型。内置 14 种（手雷/闪光/烟/…）之外，
     *  模组英雄可以注册自己的：
     *    ModLoader.addThrowable({ id:'shock', name:'震荡雷', scale:0.55,
     *                             mesh:function(){ 返回一个 Group } });
     *  注册后：
     *    · 你（第一人称）用技能掏出它时，手上拿的是 mesh() 建出来的模型；
     *    · 别人（第三人称）看到你手上也是同一个模型（编号自动登记进 NADE_CODE/NADE_KIND）；
     *    · 扔出去之后的落地/飞行表现仍由你自己的技能代码负责（引擎只负责"拿在手上"这一段）。
     *  约定：mesh() 每次都要**新建**一个（不要返回单例），原点在物体中心、直径约 0.2 米。
     * ----------------------------------------------------------------- */
    throwables: {},
    /* 【batch236】编号从 40 起：1~14 是内置投掷物，15~19 被 SP 形态的"手持技能"
       （无人机 / 电磁网 / 掩体墙 / 小太阳 / 陨石）占了，模组从 40 开始，别撞车。 */
    _tNext: 40,
    addThrowable: function (def) {
      if (!def || !def.id) { warn('addThrowable：缺少 id'); return -1; }
      try {
        def.name = def.name || def.id;
        if (!this.throwables) this.throwables = {};
        this.throwables[def.id] = def;
        var code = (typeof this._tNext === 'number' && this._tNext >= 40) ? this._tNext : 40;
        this._tNext = code + 1;
        if (typeof NADE_CODE !== 'undefined' && !NADE_CODE[def.id]) NADE_CODE[def.id] = code;
        if (typeof NADE_KIND !== 'undefined' && !NADE_KIND[code]) NADE_KIND[code] = def.id;
        log('已登记投掷物：' + def.name + '（编号 ' + code + '）');
        return code;
      } catch (e) { warn('addThrowable 出错：' + (e && e.message)); return -1; }
    },

    /* 让"我扔出去的这个模组投掷物"在**别人屏幕上**飞起来。
       参数就是物理量：出生点 + 初速（米/秒）+ 生存秒数（默认 1.4）。
       纯视觉广播，不参与任何伤害/落点结算 —— 落地爆炸仍由你自己的技能发 boom 之类。
       典型用法：扔出去的瞬间调一次
         ModLoader.throwFx(code, 出手点x,y,z, 初速x,y,z, 1.6); */
    throwFx: function (code, x, y, z, vx, vy, vz, dur) {
      try {
        if (typeof netSend !== 'function') return false;
        if (typeof netIsMulti !== 'function' || !netIsMulti()) return false;
        netSend({
          t: 'throwfx', c: code | 0,
          x: +x || 0, y: +y || 0, z: +z || 0,
          vx: +vx || 0, vy: +vy || 0, vz: +vz || 0, d: +dur || 1.4
        });
        return true;
      } catch (e) { return false; }
    },

    listWeapons: function () {
      var out = [{ idx: 0, name: '步枪', melee: false }, { idx: 1, name: '战术刀', melee: true }];
      try { for (var k in this.weapons) if (this.weapons.hasOwnProperty(k)) out.push({ idx: +k, name: this.weapons[k].name, melee: !!this.weapons[k].melee }); } catch (e) { }
      return out;
    },

    // 切到某把武器（内置 0/1 或新增 >=2）。无效槽位会被忽略。
    selectWeapon: function (idx) { try { if (typeof weaponValid === 'function' && weaponValid(idx) && typeof switchWeapon === 'function') switchWeapon(idx); } catch (e) { } },

    /* ===================================================================
     *  近战刀（Knife）接口  【batch184d·#104/#103】
     *  -------------------------------------------------------------------
     *  新增一把「刀」到刀槽（B 菜单近战区会出现它，可单独选中切换）。
     *  与 addWeapon(melee:true) 不同：刀不是「替换当前主武器」的新槽位，
     *  而是和内置战术刀并排出现在近战卡片里，各带自己的握持姿势 / 挥刀动作。
     *    ModLoader.addKnife({
     *      id:'claw', name:'爪刀', icon:'🗡️',
     *      damage:90, range:3.2, cooldown:380,
     *      gripPos:{x,y,z},            // 持刀时武器挂点（不写=内置战术刀位）
     *      lhPos:{x,y,z,rx,ry,rz},     // 左手持刀相机位姿（不写=内置）
     *      build:function(g){ /* 在 g 上搭刀模型 *\/ },
     *      swing:function(o){ /* o={elapsed,total} → 返回 {rx,ry,rz,armZ,armY,done} *\/ },
     *      swingDur:420                // 自定义挥刀总时长（毫秒）
     *    });
     *  引擎在 rebuildWeaponModel / updateLeftHand / 挥刀动画 里优先取这里的字段。
     * ==================================================================*/
    addKnife: function (def) {
      if (!def || !def.id) { warn('addKnife：缺少 id'); return -1; }
      try {
        if (typeof def.damage !== 'number') def.damage = 80;
        if (typeof def.range !== 'number') def.range = 3.5;
        if (typeof def.cooldown !== 'number') def.cooldown = 420;
        if (typeof def.icon !== 'string') def.icon = '🔪';
        if (typeof def.name !== 'string') def.name = def.id;
        // 写入引擎全局刀注册表 KNIVES（引擎直接读它）
        if (typeof KNIVES !== 'undefined') { KNIVES[def.id] = def; }
        else { (this._knives = this._knives || {})[def.id] = def; }
        log('已登记刀：' + def.name + '（' + def.id + '）');
        // 若武器选择界面已打开，刷新卡片
        if (typeof renderWeaponCards === 'function' && typeof weaponSelectOpen === 'function' && weaponSelectOpen()) renderWeaponCards();
        return def.id;
      } catch (e) { warn('addKnife 出错：' + (e && e.message)); return -1; }
    },

    getKnife: function (id) { try { if (typeof KNIVES !== 'undefined' && KNIVES[id]) return KNIVES[id]; if (this._knives && this._knives[id]) return this._knives[id]; } catch (e) { } return null; },

    listKnives: function () {
      var out = [{ id: 'tactical', name: '战术刀', builtin: true }];
      try { var src = (typeof KNIVES !== 'undefined') ? KNIVES : (this._knives || {}); for (var k in src) if (src.hasOwnProperty(k)) out.push({ id: k, name: src[k].name || k, builtin: false }); } catch (e) { }
      return out;
    },

    // 选中某把刀（切到近战槽并设为当前刀）
    selectKnife: function (id) {
      try {
        if (typeof setCurrentKnife === 'function') setCurrentKnife(id);
        if (currentWeapon !== WEAPON_KNIFE && typeof switchWeapon === 'function') switchWeapon(WEAPON_KNIFE);
      } catch (e) { }
    },

    /* ===================================================================
     *  第一人称手部（Hand）接口  【batch184d·#100/#101】
     *  -------------------------------------------------------------------
     *  #100 手部模型：模组可整把替换「持枪左手 / 持刀左手 / 右手」的模型。
     *    ModLoader.setHandModel(function(role, group, gripOffset, armExtDir){
     *      if(role==='gunLeft'){ /* 在 group 上搭左手持枪 *\/ return true; }
     *      if(role==='knifeLeft'){ /* ... *\/ return true; }
     *      if(role==='right'){ /* gripOffset/armExtDir 是挂点 *\/ return true; }
     *      return false;   // 返回 false 让引擎用默认手
     *    });
     *  #101 手部动作：模组可在每帧覆写手部姿态（持枪/持刀、挥刀状态都暴露）。
     *    ModLoader.setHandAction(function(ctx){
     *      // ctx={dt,gun,leftAnchor,leftCam,weaponGroup,bobPhase,moving,sprinting,knifeSwinging,knifeElapsed}
     *      // 直接改 leftAnchor.position / weaponGroup.rotation 等即可
     *    });
     *  引擎在 buildLeftHandForGun/buildLeftHandForKnife/buildRightHand 末尾、
     *  以及 updateLeftHand 每帧末尾，会判断这两个钩子是否存在并调用。
     * ==================================================================*/
    setHandModel: function (fn) { if (typeof fn === 'function') this.handBuilder = fn; },
    setHandAction: function (fn) { if (typeof fn === 'function') this.handAction = fn; },
    // 【batch184e】第三人称武器/刀模型接口：覆盖联机远端玩家手持物的第三人称外形。
    //   优先级：def.tpBuild（武器/刀 def 自带）> ModLoader.tpWeapon（全局钩子）> 内置几何。
    //   钩子签名 fn(def, rig)：把模型搭到 rig（THREE.Group）里即可，返回 true 表示已处理。
    setThirdPersonWeapon: function (fn) { if (typeof fn === 'function') this.tpWeapon = fn; },

    /* ===================================================================
     *  物理（Physics）接口
     *  -------------------------------------------------------------------
     *  覆盖全局物理参数，或注册一个每帧执行的物理回调（做自定义力场 / 碰撞）。
     *    ModLoader.setPhysics({ gravity:0.03, stepUp:0.9, worldLimit:120, jumpForce:0.4 });
     *    ModLoader.addPhysicsTick(function(dt){ /* dt = 本帧秒数 *\/ });
     *  所有参数均可单独给；不给的保持原版。
     * ===================================================================*/
    _phys: {},             // { gravity, stepUp, jumpForce, worldLimit }
    _physTicks: [],        // 每帧回调列表

    setPhysics: function (o) { try { this._phys = Object.assign(this._phys || {}, o || {}); } catch (e) { } },
    getPhysics: function () { try { return Object.assign({}, this._phys); } catch (e) { return {}; } },

    // 注册每帧物理回调（dt 单位秒）。返回该回调的“句柄”，可传给 removePhysicsTick 取消。
    addPhysicsTick: function (fn) {
      if (typeof fn !== 'function') return null;
      try { this._physTicks.push(fn); return fn; } catch (e) { return null; }
    },
    addPhysicsStep: function (fn) { return this.addPhysicsTick(fn); },   // 别名
    removePhysicsTick: function (fn) {
      try { var a = this._physTicks; for (var i = a.length - 1; i >= 0; i--) if (a[i] === fn) a.splice(i, 1); } catch (e) { }
    },

    /* ===================================================================
     *  多人模式（Multiplayer）接口
     *  -------------------------------------------------------------------
     *  注册一个“联机玩法模式”：在 addGameMode 的基础上多打 mp 标记，并附带
     *  队伍配置。服务端的房间隔离已经按“模式:房号”分房（见 roomKeyOf），
     *  所以只要客户端 setGameMode 到这个模式并加入同一房号，就能和同模式的人同场。
     *    ModLoader.addMPMode({ id:'br', name:'大逃杀', teams:2,
     *      start:function(){...}, tick:function(dt){...}, hud:function(){return '剩余 42 人';},
     *      onDeath:function(){return false;}, end:function(win){...} });
     *    ModLoader.setTeams(2);          // 本局分几队
     *    ModLoader.joinMP('br','r1');    // 启用模式并加入房号 r1
     * ===================================================================*/
    _mp: {},               // id -> def
    _mpTeams: 0,           // 当前模式队伍数（0=不分队，自由对战）

    addMPMode: function (def) {
      if (!def || !def.id) { warn('addMPMode：模式缺少 id'); return; }
      try {
        def.mp = true;
        this.addGameMode(def);          // 复用已有的玩法模式登记
        this._mp[def.id] = def;
        log('已登记多人模式：' + def.id + ' · ' + (def.name || ''));
      } catch (e) { warn('addMPMode 出错：' + (e && e.message)); }
    },
    listMPModes: function () { try { return Object.keys(this._mp); } catch (e) { return []; } },

    // 设置当前模式的队伍数（>0 时按队伍分房 / 分色）
    setTeams: function (n) { try { this._mpTeams = n > 0 ? n : 0; } catch (e) { } },

    // 启用某个多人模式并（若已联机）加入指定房号
    joinMP: function (modeId, room) {
      try {
        this.setGameMode(modeId);
        this._mpTeams = (this._mp[modeId] && this._mp[modeId].teams) || this._mpTeams;
        if (room && typeof netJoinRoom === 'function') netJoinRoom(room);
        log('已切换到多人模式：' + modeId + (room ? '（房号 ' + room + '）' : ''));
      } catch (e) { warn('joinMP 出错：' + (e && e.message)); }
    }
  };
  var ML = window.ModLoader;

  function log(m) { try { console.log('[模组加载器] ' + m); } catch (e) { } }
  function warn(m) { try { console.warn('[模组加载器] ' + m); } catch (e) { } }

  /* ===================================================================
   *  【batch234 · 1.7.5】统一模组接口 —— window.枪战模组
   *  -------------------------------------------------------------------
   *  以前每加一样东西就得记一个英文函数名（addHero / addWeapon / addKnife /
   *  addThrowable / addStory / addGameMode …），模组头部还要自己写 @ver。
   *  从 1.7.5 起统一成两件事：
   *
   *    ① 开头报身份（写一次，建议都写）：
   *         枪战模组.定义({ id:'nightingale', name:'夜莺', ver:'1.7.5',
   *                         author:'你', desc:'一句话说明' });
   *    ② 想加什么就说什么，**全是中文，参数和原来一模一样**：
   *         加英雄 / 加地图 / 加出生点 / 加武器 / 加刀 / 加投掷物 /
   *         加技能 / 加敌人类型 / 加模式 / 加剧情 / 加模型 / 放装饰 /
   *         设环境 / 设物理 / 每帧 / 载入后 / 清场 / 广播 …
   *
   *  老的 ModLoader.addHero(…) 等英文接口**全部保留**（指向同一份实现），
   *  老模组一个字都不用改；新模组按教程用中文接口写就行。
   *
   *  接口版本（接口版本 / @api）：1=老英文接口，2=1.7.5 统一中文接口。
   *  模组按更高接口写的，游戏只会警告（不拦），按更低接口写的一律放行。
   * ===================================================================*/
  var 模组表 = {};          // id -> 元数据

  /* 记一笔「这个模组加了什么」。句柄调用时 this=该模组的句柄；
     老写法 ModLoader.加英雄(...) 没有句柄，就不记账（不影响功能）。 */
  function 计数(句柄, 键) {
    try {
      if (句柄 && 句柄.内容 && typeof 句柄.内容[键] === 'number') 句柄.内容[键]++;
    } catch (e) { }
  }

  /* 每个中文方法 = 一层薄包装：调引擎原有实现 + 记一笔「这个模组加了什么」。
     想加新接口，只在这里加一行，然后教程里加一行表格。 */
  var 实现 = {
    加英雄: function (hero) { ML.addHero(hero); 计数(this, '英雄'); return hero; },
    加地图: function (map) { ML.addMap(map); 计数(this, '地图'); return map; },
    加出生点: function (id, 点, 覆盖) { ML.addSpawn(id, 点, 覆盖); return id; },
    加武器: function (def) { var i = ML.addWeapon(def); 计数(this, '武器'); return i; },
    加刀: function (def) { var i = ML.addKnife(def); 计数(this, '刀'); return i; },
    加投掷物: function (def) { var i = ML.addThrowable(def); 计数(this, '投掷物'); return i; },
    加技能: function (k, fn) { ML.addSkill(k, fn); 计数(this, '技能'); return k; },
    加敌人类型: function (k, def) { ML.addEnemyType(k, def); 计数(this, '敌人'); return k; },
    加模式: function (def) { ML.addGameMode(def); 计数(this, '模式'); return def; },
    加多人模式: function (def) { ML.addMPMode(def); 计数(this, '模式'); return def; },
    设队伍: function (n) { ML.setTeams(n); },
    进房: function (modeId, room) { ML.joinMP(modeId, room); },
    加剧情: function (chap) { ML.addStory(chap); 计数(this, '剧情'); return chap; },
    加模型: function (名, fn) { ML.addModel(名, fn); 计数(this, '模型'); return 名; },
    加爆能器地图: function (id, cfg) { return ML.addSpikeMap(id, cfg); },
    放装饰: function (obj) { ML.addScenery(obj); return obj; },
    摘装饰: function (obj) { ML.removeScenery(obj); },
    加灯: function (light) { ML.addLight(light); return light; },
    改枪械: function (slot, def) { ML.setWeaponStats(slot, def); return def; },
    设环境: function (o) { ML.setEnv(o); return o; },
    设物理: function (o) { ML.setPhysics(o); return o; },
    每帧: function (fn) { return ML.addPhysicsTick(fn); },
    载入后: function (fn) { ML.onApply(fn); return fn; },
    清场: function (fn) { ML.onFieldClear(fn); return fn; },
    广播: function (k, d) { return ML.heroBroadcast(k, d); },
    扔出: function (code, x, y, z, vx, vy, vz, dur) { return ML.throwFx(code, x, y, z, vx, vy, vz, dur); },
    换玩法: function (id) { ML.setGameMode(id); },
    刷敌人: function (type, x, z) { return ML.spawnEnemy(type, x, z); },
    切枪: function (idx) { ML.selectWeapon(idx); },
    切刀: function (id) { ML.selectKnife(id); },
    取模型: function (名) { return ML.getModel(名); },
    刷新界面: function () { ML.refresh(); },
    查出生点: function (x, z) { return ML.spawnFree(x, z); }
  };

  var 枪战模组 = {
    接口版本: (typeof window.模组接口版本 === 'number' ? window.模组接口版本 : 2),
    游戏版本: (typeof GAME_VER !== 'undefined' ? GAME_VER : '?'),

    /* 声明一个模组：登记元数据，返回这个模组的专属句柄。
       句柄上的方法 = 上面那张表（加英雄/加武器…），也支持在定义里直接声明：
         枪战模组.定义({ id:'x', name:'X', hero:[…], weapons:[…], skills:{…},
                       env:{…}, physics:{…}, tick:fn, init:fn, clear:fn }); */
    定义: function (def) {
      def = def || {};
      var id = String(def.id || def.标识 || '').trim();
      if (!id) { warn('定义()：缺少 id（模组唯一标识，建议英文小写 + 下划线）'); return null; }
      if (模组表[id]) { warn('定义()：id「' + id + '」重复，本次不再登记'); return 模组表[id].句柄; }

      var 接口 = +def.api || 枪战模组.接口版本;
      if (接口 > 枪战模组.接口版本) {
        warn('模组「' + id + '」按接口 v' + 接口 + ' 写的，本游戏只到 v' + 枪战模组.接口版本 + '，可能有不兼容的地方');
      }
      var 元 = {
        id: id,
        name: String(def.name || def.名字 || id),
        ver: String(def.ver || def.版本 || ''),
        api: 接口,
        author: String(def.author || def.作者 || ''),
        desc: String(def.desc || def.说明 || ''),
        内容: { 英雄: 0, 地图: 0, 武器: 0, 刀: 0, 投掷物: 0, 技能: 0, 敌人: 0, 模式: 0, 剧情: 0, 模型: 0 }
      };
      var 句柄 = { 模组: 元, 内容: 元.内容 };
      Object.keys(实现).forEach(function (名) {
        /* this 绑到这个句柄上：不管什么时候调（包括「载入后」里），都记在这个模组名下 */
        句柄[名] = function () { try { return 实现[名].apply(句柄, arguments); } catch (e) { warn(名 + ' 出错：' + (e && e.message)); } };
      });
      句柄.日志 = function (m) { log('[' + 元.name + '] ' + m); };
      句柄.警告 = function (m) { warn('[' + 元.name + '] ' + m); };
      元.句柄 = 句柄;
      模组表[id] = 元;

      /* 声明式写法：定义里带了字段就顺手登记，省掉一串调用 */
      var 列表 = [['hero', '加英雄'], ['heroes', '加英雄'], ['weapons', '加武器'], ['knives', '加刀'],
                  ['throwables', '加投掷物'], ['maps', '加地图'], ['modes', '加模式'], ['story', '加剧情']];
      for (var i = 0; i < 列表.length; i++) {
        (function (v, 方法名) {          // 包一层：别让 forEach 闭包抓到循环变量
          if (v) [].concat(v).forEach(function (x) { 句柄[方法名](x); });
        })(def[列表[i][0]], 列表[i][1]);
      }
      if (def.skills) Object.keys(def.skills).forEach(function (k) { 句柄.加技能(k, def.skills[k]); });
      if (def.enemies) Object.keys(def.enemies).forEach(function (k) { 句柄.加敌人类型(k, def.enemies[k]); });
      if (def.models) Object.keys(def.models).forEach(function (k) { 句柄.加模型(k, def.models[k]); });
      if (def.env) 句柄.设环境(def.env);
      if (def.physics) 句柄.设物理(def.physics);
      if (def.tick) 句柄.每帧(def.tick);
      if (def.init) 句柄.载入后(def.init);
      if (def.clear) 句柄.清场(def.clear);

      log('模组已登记：' + 元.name + (元.ver ? ' v' + 元.ver : '') + '（id=' + id + ' · 接口 v' + 接口 + '）');
      return 句柄;
    },

    /* 已登记的模组一览（模组管理面板、控制台自检都用它） */
    表: function () {
      var out = [];
      for (var k in 模组表) if (模组表.hasOwnProperty(k)) out.push(模组表[k]);
      return out;
    },

    /* 一行字概括：给面板 / 控制台用 */
    摘要: function () {
      var a = 枪战模组.表();
      if (!a.length) return '';
      return a.map(function (m) { return m.name + (m.ver ? ' v' + m.ver : ''); }).join('、');
    },

    /* 控制台敲 枪战模组.报告() 看每个模组到底登记了什么 */
    报告: function () {
      var a = 枪战模组.表();
      try {
        console.group('[枪战模组] 已登记 ' + a.length + ' 个 · 接口 v' + 枪战模组.接口版本);
        a.forEach(function (m) {
          var 有 = [];
          for (var k in m.内容) if (m.内容[k]) 有.push(k + '×' + m.内容[k]);
          console.log(m.name + (m.ver ? ' v' + m.ver : '') + '  [' + m.id + ']  ' + (有.join(' ') || '（没登记内容）'));
        });
        console.groupEnd();
      } catch (e) { }
      return a;
    }
  };

  /* 中文方法同时挂到 ModLoader 上：老模组里写 ModLoader.加英雄(...) 也能跑 */
  /* 老写法 ModLoader.加英雄(...) 也能用；这一路没有句柄，不记内容统计 */
  Object.keys(实现).forEach(function (名) { ML[名] = function () { return 实现[名].apply(null, arguments); }; });
  ML.接口版本 = 枪战模组.接口版本;
  ML.模组表 = 模组表;

  window.枪战模组 = 枪战模组;
  try { window.模组接口版本 = 枪战模组.接口版本; } catch (e) { }

  // 顺序加载一个脚本，返回 Promise（保证按清单顺序执行）
  function loadOne(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.type = 'text/javascript';
      s.async = false;                       // 保持清单里的执行顺序
      s.onload = function () { resolve(true); };
      s.onerror = function () { warn('加载失败（文件不存在或路径错误）：' + src); resolve(false); };
      document.head.appendChild(s);
    });
  }

  // 读清单：载入清单.js 会设置 window.MOD_FILES 这个数组
  function getFileList() {
    try { if (Array.isArray(window.MOD_FILES)) return window.MOD_FILES.slice(); } catch (e) { }
    return [];
  }

  async function main() {
    // 1) 先加载“载入清单”本身（它负责设置 window.MOD_FILES）
    await loadOne(BASE + '载入清单.js');

    /* 1.5) 【batch225】问模组管理要一份「最终加载计划」：
       它会把「清单里的内置模组 + 本机已经装过的模组」合成一张表，
       再去掉玩家关掉 / 删掉的，顺手把存在浏览器库里的模组做成 Blob URL。
       没装模组管理（老页面 / spike.html）就退回原来的单一清单行为，行为完全不变。 */
    var 计划 = null;
    try {
      if (window.MOD_MGR && typeof window.MOD_MGR.准备 === 'function') {
        计划 = await window.MOD_MGR.准备(getFileList());
      }
    } catch (e) { warn('取加载计划失败，改用载入清单：' + (e && e.message)); }

    var files = getFileList();
    var 总 = 0;
    if (计划 && Array.isArray(计划.文件) && 计划.文件.length) {
      // 2) 按计划逐个加载（内置的走 mode/模组/，玩家装的可能是 Blob URL）
      for (var m = 0; m < 计划.文件.length; m++) {
        var it = 计划.文件[m];
        if (!it || !it.url) continue;
        await loadOne(it.url);
        总++;
      }
      if (计划.跳过 && 计划.跳过.length) log('已按玩家设置跳过 ' + 计划.跳过.length + ' 个模组');
    } else {
      // 2) 按顺序加载清单里列出的每个模组文件（老路径）
      for (var i = 0; i < files.length; i++) {
        var name = files[i];
        if (!name) continue;
        var src = BASE + name + (/\.js$/i.test(name) ? '' : '.js');
        await loadOne(src);
        总++;
      }
    }
    files = 计划 && 计划.文件 ? 计划.文件 : files;

    // 3) 全部载入完成：执行 onApply 回调与每个模组的 init
    for (var j = 0; j < ML.initFns.length; j++) {
      try { ML.initFns[j](); } catch (e) { warn('模组回调出错：' + (e && e.message)); }
    }
    for (var k = 0; k < ML.mods.length; k++) {
      try { if (ML.mods[k] && typeof ML.mods[k].init === 'function') ML.mods[k].init(); }
      catch (e) { warn('模组 init 出错：' + (e && e.message)); }
    }

    // 4) 刷新界面，让新增的英雄 / 地图立刻出现在选人、选图界面
    ML.refresh();
    // 4.5) 套用美术环境 + 武器属性（若模组登记了）
    try { if (typeof ML.applyArt === 'function') ML.applyArt(); } catch (e) { }
    try { if (typeof applyWeaponDef === 'function') applyWeaponDef(); } catch (e) { }
    // 4.6) 告诉模组管理「这一轮真正跑起来了」——它会把临时的 Blob URL 回收掉
    try { if (window.MOD_MGR && typeof window.MOD_MGR.载入完成 === 'function') window.MOD_MGR.载入完成(); } catch (e) { }
    /* 【batch225】给探针 / 模组作者一个「全部载入完了」的标记：
       以前只能靠数 HEROES 或者等日志，异步加载的模组到底进没进根本没法判断。 */
    ML.已载入 = true;
    ML.已载入数 = 总;
    log('模组载入完成：共加载 ' + 总 + ' 个文件，登记 ' + ML.mods.length + ' 个模组。');
  }

  // 在 DOM 就绪后启动（此时 HEROES / MAPS / ETYPES / 场景 等都已存在）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { main(); });
  } else {
    main();
  }
})();
