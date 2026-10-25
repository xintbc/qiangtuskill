(function(){
  console.log('[暗影模组] 加载开始（原版投掷手感版 v3）');

  var hero_anYing = {
    k:'shadow_yanyue',
    name:'暗影',
    tag:'时空术士',
    fac:'暗月',
    facDesc:'掌控时空裂隙的暗月秘术师',
    icon:'🌑',
    color:0x2b1442,
    css:'#2b1442',
    passive:'暗影潜行：脱离战斗移动速度提升20%',
    skills:[
      {k:'custom_blackhole_throw', name:'奇点黑洞', icon:'🕳', cd:24, dur:5,  desc:'投掷黑洞，落地吸附敌人并爆炸伤害'},
      {k:'custom_portal_throw',    name:'空间裂隙', icon:'🌀', cd:16, dur:0,  desc:'投掷传送标记；再次释放瞬移到标记处'},
      {k:'custom_timestop_all',    name:'时间凝滞', icon:'⏱', cd:48, dur:10, desc:'时间暂停10秒，全场敌人静止'}
    ],
    // 多人：别人放暗影技能时，在他机器上复现可见特效（伤害/控制由释放者走服务端 t:'hit' 权威结算，这里只复现视觉）
    sync: function (skillKey, data, src) {
      if (!data) return;
      if (skillKey === 'custom_blackhole_throw') spawnRemoteBlackHole(data.x, data.y, data.z, data.dur || 5);
      else if (skillKey === 'custom_portal_throw') spawnRemotePortalMark(data.x, data.y, data.z);
      else if (skillKey === 'custom_timestop_all') remoteTimeStopFx(data);
    }
  };

  var shadow = {
    portalPos: null,
    tpProtect: null,
    stop: false,
    stopLeft: 0,
    enemySnap: [],
    holes: [],
    lastT: 0
  };
  var _gravSendAt = 0;   // 【多人】黑洞引力上报节流时间戳（约 70ms 一次）

  /* 自定义投掷物外观（黑洞球 / 传送标记环）——材质全部 fog:false 保证远处可见 */
  function myMesh(kind){
    try{
      if(kind==='hole'){
        var g=new THREE.Group();
        var s1=new THREE.Mesh(new THREE.SphereGeometry(0.20,12,12),
          new THREE.MeshBasicMaterial({color:0x110033,transparent:true,opacity:0.95,depthWrite:false,fog:false}));
        var s2=new THREE.Mesh(new THREE.SphereGeometry(0.10,10,10),
          new THREE.MeshBasicMaterial({color:0x7722dd,transparent:true,opacity:0.85,depthWrite:false,fog:false}));
        s2.position.y=0.02;
        g.add(s1);g.add(s2);
        return g;
      }
      if(kind==='portalMark'){
        var g2=new THREE.Group();
        var r=new THREE.Mesh(new THREE.TorusGeometry(0.16,0.045,8,18),
          new THREE.MeshBasicMaterial({color:0x9944ff,fog:false}));
        g2.add(r);
        return g2;
      }
    }catch(e){ console.log('[暗影] mesh 出错',e); }
    return null;
  }

  /* 落地黑洞模型：黑色核心 + 紫色发光层 + 旋转吸积盘 + 外环光晕 + 立体球体范围罩（帧循环里旋转/脉动） */
  /* 注意：全部材质 fog:false —— 场景有指数雾，远距离落点会被雾吞掉，必须无视雾才能看见 */
  function makeBlackHoleMesh(){
    var g = new THREE.Group();
    try{
      var core = new THREE.Mesh(new THREE.SphereGeometry(0.5,20,20),
        new THREE.MeshBasicMaterial({color:0x000000,fog:false}));
      var glow = new THREE.Mesh(new THREE.SphereGeometry(0.62,20,20),
        new THREE.MeshBasicMaterial({color:0x3a0f6a,transparent:true,opacity:0.5,depthWrite:false,fog:false}));
      var disc = new THREE.Mesh(new THREE.RingGeometry(0.7,1.25,32),
        new THREE.MeshBasicMaterial({color:0x9b4dff,transparent:true,opacity:0.8,side:THREE.DoubleSide,depthWrite:false,fog:false}));
      disc.rotation.x = -Math.PI/2;
      var halo = new THREE.Mesh(new THREE.RingGeometry(1.35,1.75,32),
        new THREE.MeshBasicMaterial({color:0x2a084a,transparent:true,opacity:0.4,side:THREE.DoubleSide,depthWrite:false,fog:false}));
      halo.rotation.x = -Math.PI/2;
      /* 立体球体范围罩：半径 14 与吸附/爆炸范围一致，半透明球壳 + 线框球 */
      var rangeBall = new THREE.Mesh(new THREE.SphereGeometry(14,24,16),
        new THREE.MeshBasicMaterial({color:0x8844ff,transparent:true,opacity:0.10,side:THREE.DoubleSide,depthWrite:false,fog:false}));
      var rangeWire = new THREE.Mesh(new THREE.SphereGeometry(14,24,16),
        new THREE.MeshBasicMaterial({color:0xaa66ff,wireframe:true,transparent:true,opacity:0.35,depthWrite:false,fog:false}));
      g.add(core); g.add(glow); g.add(disc); g.add(halo); g.add(rangeBall); g.add(rangeWire);
    }catch(e){ console.log('[暗影] 黑洞建模出错',e); }
    g.userData.spin = 0;
    return g;
  }

  /* 障碍阻挡判断：点(x,z,y)是否卡在实心墙内（平台 slab 不算墙，可被吸上去站在上面） */
  function _inBlock(x,z,y){
    try{
      for (var i=0;i<obstacles.length;i++){
        var o=obstacles[i];
        if (!o || o.slab) continue;
        if (x<=o.minX+0.15 || x>=o.maxX-0.15) continue;
        if (z<=o.minZ+0.15 || z>=o.maxZ-0.15) continue;
        var _h=(typeof o.h==='number')?o.h:(typeof o.y1==='number'?o.y1:3);
        if (y>0.2 && y<_h-0.1) return true;
      }
    }catch(e){}
    return false;
  }

  /* 空间裂隙钩子：已有落地标记 → 传送；否则放行给原版 THROW_KINDS 分支（拿在手里 → 瞄准 → 抛出） */
  function castPortal(i,s,H){
    console.log('[暗影] 空间裂隙槽位'+i+'：'+(shadow.portalPos?'传送':'准备投掷'));
    if(shadow.portalPos){
      try{
        camera.position.x = shadow.portalPos.x;
        camera.position.z = shadow.portalPos.z;
        /* 关键：传送目标高度用 groundHeightAt 计算「该处可站立的相机高度」——
           标记在平台顶时返回 平台顶+眼高(13.6)，标记在一楼时返回 2.0。
           不能直接设 标记y+1.2（≈12.96）：引擎 groundHeightAt 只认脚底±台阶容差内的表面，
           12.96 的脚底 10.96 距平台顶 11.6 超出容差 0.55 → 判定脚下无平台 → 重力掉一楼。 */
        var _tpY = (typeof groundHeightAt==='function')
          ? groundHeightAt(shadow.portalPos.x, shadow.portalPos.z, shadow.portalPos.y + 2.5)
          : (shadow.portalPos.y + 1.2);
        camera.position.y = _tpY;
        S.velY = 0; S.onGround = true;                  /* 阻止重力下落 */
        shadow.tpProtect = { y: _tpY, end: Date.now() + 3000 };  /* 3秒悬浮保护：防穿模掉一楼 */
        spawnParticle({x:shadow.portalPos.x,y:shadow.portalPos.y,z:shadow.portalPos.z},0x9944ff,30);
        showMsg('🌀 空间跃迁完成','#bb77ff');
      }catch(e){ console.log('[暗影] 传送出错',e); }
      shadow.portalPos = null;
      return true;
    }
    return false;   /* 返回 false → 交给原版 THROW_KINDS：拿在手里 */
  }

  /* 时间凝滞：全场 AI 敌人静止 dur 秒 */
  function castTimeStop(i,s,H){
    console.log('[暗影] 释放三技能·时间凝滞（槽位'+i+'，时长'+(s?s.dur:10)+'秒）');
    shadow.stop = true;
    shadow.stopLeft = (s && s.dur) ? s.dur : 10;
    shadow.enemySnap = [];
    try{
      for (var n=0; n<enemies.length; n++){
        var e = enemies[n];
        if (e && !e.isNet && e.root){
          shadow.enemySnap.push({ e:e, x:e.root.position.x, z:e.root.position.z });
        }
      }
      showMsg('⏱ 时间凝滞！全场敌人静止'+shadow.stopLeft+'秒','#f8f040');
    }catch(err){ console.log('[暗影] 时间暂停初始化出错', err); }
    /* 联机：把时间凝滞事件广播给同房其他人（远端只复现可见特效：clock 冲击 + 屏幕提示；
       注意：真人对玩家的“静止”需要服务端权威，模组暂只做视觉，不锁真人移动） */
    try{ if (window.ModLoader && ModLoader.heroBroadcast) ModLoader.heroBroadcast('custom_timestop_all', { x: camera.position.x, y: camera.position.y, z: camera.position.z, dur: (s && s.dur) ? s.dur : 10 }); }catch(e){}
    return true;
  }

  /* ---------------- 多人：远端复现（其他玩家看到你的技能） ----------------
     引擎收到 t:'modsk' 时会自动调用 HEROES[英雄下标].sync(skillKey, data, 远端玩家对象)。
     这里只复现“看得见的特效”，伤害/控制一律由释放者走服务端 t:'hit' 权威结算，避免重复扣血。 */
  var _remotePortal = null;
  function spawnRemoteBlackHole(x, y, z, dur) {
    try {
      if (typeof THREE === 'undefined' || !scene) return;
      var obj = makeBlackHoleMesh();
      if (!obj) return;
      obj.position.set(x, y, z);
      scene.add(obj);
      if (typeof heroFxRingAt === 'function') heroFxRingAt(x, z, 0x110033, 1, 14, (dur || 5));
      var t0 = performance.now(), last = t0;
      (function step() {
        if (!obj.parent) return;
        var dt = Math.min((performance.now() - last) / 1000, 0.1); last = performance.now();
        obj.userData.spin = (obj.userData.spin || 0) + dt * 2.4;
        obj.rotation.y = obj.userData.spin;
        var _pulse = 1 + 0.10 * Math.sin(Date.now() * 0.006);
        obj.scale.set(_pulse, _pulse, _pulse);
        if (performance.now() - t0 >= (dur || 5) * 1000) {
          try { spawnParticle({ x: x, y: 2, z: z }, 0x120022, 70); } catch (_) { }
          try { if (obj.parent) obj.parent.remove(obj); } catch (_) { }
          return;
        }
        requestAnimationFrame(step);
      })();
    } catch (e) { }
  }
  function spawnRemotePortalMark(x, y, z) {
    try {
      if (_remotePortal && _remotePortal.parent) _remotePortal.parent.remove(_remotePortal);
      var m = myMesh('portalMark');
      if (!m) return;
      m.position.set(x, y, z);
      scene.add(m);
      _remotePortal = m;
      var t0 = performance.now();
      (function step() {
        if (!m.parent) return;
        m.rotation.y += 0.05; m.rotation.z += 0.02;
        if (performance.now() - t0 >= 16000) { try { if (m.parent) m.parent.remove(m); } catch (_) { } if (_remotePortal === m) _remotePortal = null; return; }
        requestAnimationFrame(step);
      })();
    } catch (e) { }
  }
  function remoteTimeStopFx(d) {
    try {
      if (typeof heroFxRingAt === 'function' && d) heroFxRingAt(d.x, d.z, 0xbb44ff, 1, 30, (d.dur || 10));
      var el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:225;pointer-events:none;display:flex;align-items:center;justify-content:center;color:#e6c8ff;font:700 28px/1.4 "Microsoft YaHei",sans-serif;text-shadow:0 0 16px rgba(180,100,255,.9);background:radial-gradient(ellipse at center,rgba(120,40,200,0) 40%,rgba(120,40,200,.22) 100%);transition:opacity .4s;';
      el.textContent = '⏱ 时间凝滞！';
      document.body.appendChild(el);
      setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { try { el.remove(); } catch (_) { } }, 500); }, ((d && d.dur) ? d.dur : 10) * 1000);
    } catch (e) { }
  }

  /* ================= 帧循环：黑洞吸附/爆炸 + 时间凝滞 ================= */
  function frame(ts){
    requestAnimationFrame(frame);
    var dt = (ts - shadow.lastT)/1000;
    shadow.lastT = ts;
    if (!(dt>0)) dt = 0.016;
    if (dt>0.15) dt = 0.15;

    try{
      /* —— 传送悬浮保护：传送后 3 秒内若玩家被地面判定拉回一楼，强制保持在标记高度 —— */
      if (shadow.tpProtect){
        if (Date.now() > shadow.tpProtect.end){
          shadow.tpProtect = null;
        } else {
          S.velY = 0; S.onGround = true;                 /* 全程保持地面态：防止引擎转重力分支下落 */
          if (camera.position.y < shadow.tpProtect.y - 0.6){
            camera.position.y = shadow.tpProtect.y;      /* 被拉回一楼 → 强制拉回标记高度 */
          }
        }
      }

      /* —— 已落地的黑洞：持续吸附 14 米内敌人，到点爆炸 120 伤（14 米范围，能秒紫色散弹兵 tank） —— */
      for (var hi=shadow.holes.length-1; hi>=0; hi--){
        var hh = shadow.holes[hi];
        /* 联机：把黑洞中心/范围/强度上报服务端，由服务端转发同房其他人 → 被吸者客户端自己往中心拉（位移本地，别人经 t:'p' 看到被吸）。仅联机、约 70ms 一次。 */
        if (Date.now() <= hh.end && (typeof NET!=='undefined' && NET && NET.connected) && Date.now()-_gravSendAt > 70){
          _gravSendAt = Date.now();
          try{ netSend({ t:'grav', x: hh.x, z: hh.z, r: 14, f: 0.07 }); }catch(_){}
        }
        if (Date.now() > hh.end){
          try{
            spawnParticle({x:hh.x,y:2,z:hh.z},0x120022,70);
            for (var n=0;n<enemies.length;n++){
              var e=enemies[n];
              if (!e || !e.root) continue;
              var dx=e.root.position.x - hh.x;
              var dy=e.root.position.y - hh.y;
              var dz=e.root.position.z - hh.z;
              if (Math.sqrt(dx*dx+dy*dy+dz*dz)<=14){   /* 3D 距离：含 y 轴高度差 */
                if (e.isNet){
                  /* 联机：真人玩家由释放者走服务端 t:'hit' 权威结算（避免各客户端重复扣血） */
                  if (typeof NET!=='undefined' && NET && NET.connected){ try{ netSend({t:'hit', i:e.netId, d:120, h:false}); }catch(_){} }
                } else {
                  e.hp = (e.hp||0) - 120;
                  e.flash = 0.35;
                  /* 同步更新血条显示（缩放+颜色），让扣血肉眼可见 */
                  try{
                    var _rr = Math.max(0, e.hp / (e.maxHp||100));
                    if (e.hb) e.hb.scale.x = _rr;
                    if (e.hbMat) e.hbMat.color.setHex(_rr>0.5?0x00ff00:_rr>0.25?0xffff00:0xff0000);
                  }catch(e2){}
                  if (e.hp<=0 && typeof killEnemy==='function') killEnemy(e,n,false);
                }
              }
            }
            if (hh.obj && hh.obj.parent) hh.obj.parent.remove(hh.obj);
          }catch(err){}
          shadow.holes.splice(hi,1);
          continue;
        }
        /* 吸附（3D 方向：高处黑洞连 y 一起拉，让敌人被吸向高处）+ 防卡墙 */
        try{
          for (var n2=0;n2<enemies.length;n2++){
            var e2=enemies[n2];
            if (!e2 || e2.isNet || !e2.root) continue;
            var dx2 = hh.x - e2.root.position.x;
            var dy2 = hh.y - e2.root.position.y;
            var dz2 = hh.z - e2.root.position.z;
            var d2 = Math.sqrt(dx2*dx2+dy2*dy2+dz2*dz2);   /* 3D 距离：含 y 轴高度差 */
            if (d2<14 && d2>0.5){
              var _sp=0.11;
              var _nx=e2.root.position.x+(dx2/d2)*_sp;
              var _nz=e2.root.position.z+(dz2/d2)*_sp;
              var _cy=e2.root.position.y+0.6;              /* 敌人身体中心高度 */
              if(!_inBlock(_nx,e2.root.position.z,_cy))e2.root.position.x=_nx;
              if(!_inBlock(e2.root.position.x,_nz,_cy))e2.root.position.z=_nz;
              /* y：黑洞在上 → 持续向高处抬升（模组帧循环后执行，覆盖引擎地面回拉 → 敌人被吸向高处）；
                 黑洞在下 → 平滑下降但不穿地。均不穿墙、不吸过头。 */
              if (dy2>0.05){
                var _liftY = e2.root.position.y + Math.max((dy2/d2)*_sp, 0.06);
                if (_liftY > hh.y) _liftY = hh.y;                       /* 不吸过头 */
                var _srfY = (typeof groundHeightAt==='function') ? groundHeightAt(e2.root.position.x, e2.root.position.z, _liftY+2.0) : 0;
                if (_liftY < _srfY) _liftY = _srfY;                     /* 不低于当地表面（不穿地） */
                if(!_inBlock(e2.root.position.x,_liftY,_cy))e2.root.position.y=_liftY;
              } else if (dy2<-0.05){
                var _lowY = e2.root.position.y + (dy2/d2)*_sp;
                var _srfL = (typeof groundHeightAt==='function') ? groundHeightAt(e2.root.position.x, e2.root.position.z, e2.root.position.y+2.0) : 0;
                if (_lowY < _srfL) _lowY = _srfL;                       /* 不穿地 */
                if(!_inBlock(e2.root.position.x,_lowY,_cy))e2.root.position.y=_lowY;
              }
            }
          }
          if (typeof heroFxRingAt==='function') heroFxRingAt(hh.x,hh.z,0x110033,1,14,0.5);
          if (hh.obj){
            hh.obj.userData.spin = (hh.obj.userData.spin||0) + dt*2.4;
            hh.obj.rotation.y = hh.obj.userData.spin;
            var _pulse = 1 + 0.10*Math.sin(Date.now()*0.006);
            hh.obj.scale.set(_pulse,_pulse,_pulse);
          }
        }catch(e){}
      }

      /* —— 时间凝滞 —— */
      if (shadow.stop){
        shadow.stopLeft -= dt;
        if (shadow.stopLeft<=0){
          shadow.stop = false;
          try{
            for (var i=0;i<enemies.length;i++){
              var ee=enemies[i];
              if (ee && !ee.isNet && ee._savedSpd!==undefined){
                ee.spd = ee._savedSpd; delete ee._savedSpd;
              }
            }
            showMsg('⏱ 时间凝滞结束，敌人恢复行动','#ff7722');
          }catch(e){}
        } else {
          try{
            for (var i2=0;i2<enemies.length;i2++){
              var ee2=enemies[i2];
              if (!ee2 || ee2.isNet || !ee2.root) continue;
              if (ee2._savedSpd===undefined) ee2._savedSpd = ee2.spd;
              ee2.spd = 0;
            }
            for (var s2=0;s2<shadow.enemySnap.length;s2++){
              var sn = shadow.enemySnap[s2];
              if (sn.e && sn.e.root){
                sn.e.root.position.x = sn.x;
                sn.e.root.position.z = sn.z;
              }
            }
          }catch(e){}
        }
      } else {
        try{
          for (var i3=0;i3<enemies.length;i3++){
            var ee3=enemies[i3];
            if (ee3 && !ee3.isNet && ee3._savedSpd!==undefined){
              ee3.spd = ee3._savedSpd; delete ee3._savedSpd;
            }
          }
        }catch(e){}
      }
    }catch(err){
      console.log('[暗影] 帧循环出错：', err);
    }
  }

  /* ============ hook heroCast：传送优先于冷却门 ============
     原版 heroCast 里冷却门在 CUSTOM_SKILLS 钩子之前 → 标记落地后冷却还没好，
     按 B 会被"冷却中"拦死、传不出去。这里在调用原版之前先拦截：
     「已有落地标记 → 直接传送（传送后冷却重新开始）」。
     与原版"遁入暗影再按退出"（sshadow 分支）同一思路：特殊二段操作必须绕开冷却门。 */
  var _origHeroCast = window.heroCast;
  window.heroCast = function(i){
    i = i|0;
    try{
      var H = heroNow(), s = H.skills[i];
      if (s && s.k === 'custom_portal_throw' && shadow.portalPos){
        try{
          camera.position.x = shadow.portalPos.x;
          camera.position.z = shadow.portalPos.z;
          /* 传送目标高度用 groundHeightAt 计算「该处可站立的相机高度」：
             标记在平台顶 → 13.6；标记在一楼 → 2.0。直接设 标记y+1.2 会因
             脚底超出平台顶台阶容差(0.55)被判定无平台 → 重力掉一楼。 */
          var _tpY = (typeof groundHeightAt==='function')
            ? groundHeightAt(shadow.portalPos.x, shadow.portalPos.z, shadow.portalPos.y + 2.5)
            : (shadow.portalPos.y + 1.2);
          camera.position.y = _tpY;
          S.velY = 0; S.onGround = true;                  /* 阻止重力下落 */
          shadow.tpProtect = { y: _tpY, end: Date.now() + 3000 };  /* 3秒悬浮保护：防穿模掉一楼 */
          spawnParticle({x:shadow.portalPos.x,y:shadow.portalPos.y,z:shadow.portalPos.z},0x9944ff,30);
          showMsg('🌀 空间跃迁完成','#bb77ff');
        }catch(e){ console.log('[暗影] 传送出错',e); }
        shadow.portalPos = null;
        SK.cds[i] = s.cd;                      /* 传送也消耗冷却：重新开始计 */
        try{ heroHudUpdate(true); }catch(e){}
        return true;
      }
    }catch(e){ console.log('[暗影] heroCast 前置拦截出错',e); }
    return _origHeroCast.apply(this, arguments);
  };

  /* ============ hook heroDoThrow：自定义投掷物走原版物理（重力/反弹/碰撞/落地） ============ */
  var _origHeroDoThrow = window.heroDoThrow;
  window.heroDoThrow = function(){
    var h = SK.hold;
    if (h && (h.kind==='custom_blackhole_throw' || h.kind==='custom_portal_throw')){
      var si = h.si;
      SK.hold = null; SK.aimThrow = false;
      try{ heroHoldHide(); heroPreviewHide(); }catch(e){}
      var H = heroNow();
      var mv = heroThrowVel(), mf0 = heroThrowFrom();
      var isHole = (h.kind==='custom_blackhole_throw');
      if (!isHole){
        /* 传送标记缩短投掷：落点 ~4.3 米（原版 20 米）。塔顶平台只有 ±5.5 米（11×11），
           0.2 倍速实测落点 5.7 米仍差 0.2 米飞出平台；0.15 倍 → 稳落平台内。 */
        mv.vx*=0.15; mv.vy*=0.15; mv.vz*=0.15;
      }
      try{ heroFxRingAt(camera.position.x,camera.position.z, isHole?0x0a0018:0x7722dd, 0.3, 1.4, 0.35); }catch(e){}
      var opt = { fuse:-1, rest:0.30, mesh: myMesh(isHole?'hole':'portalMark') };
      if (isHole){
        var _s = H.skills[si];
        opt.onLand = function(pp){
          var _dur = (_s && _s.dur) ? _s.dur : 5;
          var _obj = null;
          try{
            _obj = makeBlackHoleMesh();
            var _surfY = (typeof projSurfAt==='function') ? projSurfAt(pp.x,pp.z,pp.y) : 0;
            var _holeY = _surfY + 0.55;                    /* 黑洞悬浮在地面上方 */
            _obj.position.set(pp.x, _holeY, pp.z);
            scene.add(_obj);
            spawnParticle({x:pp.x,y:1,z:pp.z},0x0a0018,40);
            if (typeof heroFxRingAt==='function') heroFxRingAt(pp.x,pp.z,0x110033,0.5,14,2);
          }catch(e){ console.log('[暗影] 黑洞模型创建出错',e); }
          shadow.holes.push({x:pp.x,z:pp.z,y:(_holeY||0),end:Date.now()+_dur*1000,obj:_obj});
          try{ projRemove(pp,false); }catch(e){}
          /* 联机：让同房其他人也看到这个黑洞（远端只复现视觉，伤害由释放者走服务端 t:'hit'） */
          try{ if(window.ModLoader && ModLoader.heroBroadcast) ModLoader.heroBroadcast('custom_blackhole_throw', {x:pp.x, y:(_holeY||0), z:pp.z, dur:_dur}); }catch(e2){}
        };
      } else {
        opt.onLand = function(pp){
          shadow.portalPos = {x:pp.x, y:pp.y, z:pp.z};   /* 记录落地高度：二楼标记 → 传送回二楼 */
          try{
            console.log('[暗影] 标记落地 y='+pp.y.toFixed(2)+' x='+pp.x.toFixed(1)+' z='+pp.z.toFixed(1));
            spawnParticle({x:pp.x,y:pp.y,z:pp.z},0x8833ff,30);
            showMsg('🌀 标记已落地！高度'+pp.y.toFixed(1)+'，再次按B传送','#aa66ff');
          }catch(e){}
          try{ projRemove(pp); }catch(e){}
          /* 联机：让同房其他人也看到传送标记 */
          try{ if(window.ModLoader && ModLoader.heroBroadcast) ModLoader.heroBroadcast('custom_portal_throw', {x:pp.x, y:pp.y, z:pp.z}); }catch(e2){}
        };
      }
      try{
        projSpawn(isHole?'hole':'portalMark', mf0.x,mf0.y,mf0.z, mv.vx,mv.vy,mv.vz, opt);
      }catch(e){ console.log('[暗影] projSpawn 出错',e); }
      try{ showMsg('抛出：'+H.skills[si].name, H.css); }catch(e){}
      try{ heroHudUpdate(true); }catch(e){}
      return true;
    }
    return _origHeroDoThrow.apply(this, arguments);
  };

  /* ============ hook heroHoldShow：自定义投掷物拿在手里的外观 ============ */
  var _origHeroHoldShow = window.heroHoldShow;
  window.heroHoldShow = function(kind){
    if (kind==='custom_blackhole_throw' || kind==='custom_portal_throw'){
      _origHeroHoldShow(kind);
      try{
        var hold = window._holdObj;
        if (hold){
          if (hold.isMesh){
            if (hold.geometry) hold.geometry.dispose();
            hold.geometry = new THREE.SphereGeometry(0.18,10,10);
            hold.material = new THREE.MeshBasicMaterial({color:0x110033,transparent:true,opacity:0.95});
          }
          while (hold.children && hold.children.length) hold.remove(hold.children[0]);
          var nm = myMesh(kind==='custom_blackhole_throw'?'hole':'portalMark');
          if (nm) hold.add(nm);
        }
      }catch(e){ console.log('[暗影] 持握外观替换失败(不影响功能)',e); }
      return;
    }
    return _origHeroHoldShow(kind);
  };

  /* ================= 注册 ================= */
  /* ① 把两个投掷技能挂进原版 THROW_KINDS → heroCast 走「拿在手里 → 长按瞄准 → 松手抛出」 */
  try{
    if (typeof THROW_KINDS==='object' && THROW_KINDS){
      THROW_KINDS['custom_blackhole_throw']=1;
      THROW_KINDS['custom_portal_throw']=1;
      console.log('[暗影模组] 两个投掷技能已接入原版投掷流程(拿起→瞄准→抛出)');
    } else {
      console.log('[暗影模组] 警告：THROW_KINDS 不可用，投掷流程无法接入');
    }
  }catch(e){ console.log('[暗影模组] THROW_KINDS 注册失败',e); }

  /* ② 给自定义投掷物加持握姿势（右下角托举，带轻晃） */
  try{
    if (typeof HOLD_POSE==='object' && HOLD_POSE){
      HOLD_POSE['custom_blackhole_throw']={x:0.30,y:-0.24,z:-0.58, ry:0.15, rise:0.58, spin:1.6, sway:0.04};
      HOLD_POSE['custom_portal_throw']={x:0.28,y:-0.22,z:-0.56, ry:-0.20, rise:0.56, spin:1.2, sway:0.05};
    }
  }catch(e){ console.log('[暗影模组] HOLD_POSE 注册失败(不致命)',e); }

  /* ③ CUSTOM_SKILLS 注册：空间裂隙（传送分流）+ 时间凝滞。
     奇点黑洞不注册 —— 全靠原版投掷流程。 */
  try{
    if (window.ModLoader && typeof ModLoader.addSkill==='function'){
      ModLoader.addSkill('custom_portal_throw', castPortal);
      ModLoader.addSkill('custom_timestop_all', castTimeStop);
      console.log('[暗影模组] 空间裂隙(传送分流)/时间凝滞 已注册');
    } else {
      if (typeof CUSTOM_SKILLS==='object'){
        CUSTOM_SKILLS['custom_portal_throw']=castPortal;
        CUSTOM_SKILLS['custom_timestop_all']=castTimeStop;
      }
    }
  }catch(e){ console.log('[暗影模组] 注册技能出错',e); }

  if (window.ModLoader && typeof ModLoader.onApply==='function'){
    ModLoader.onApply(function(){
      console.log('[暗影模组] onApply 执行');
      try{
        if (typeof ModLoader.addHero==='function') ModLoader.addHero(hero_anYing);
        else if (window.HEROES) HEROES.push(hero_anYing);
      }catch(e){ console.log('[暗影模组] 注册英雄出错',e); }
      shadow.lastT = performance.now();
      requestAnimationFrame(frame);
    });
  } else {
    try{ HEROES.push(hero_anYing); }catch(e){}
    shadow.lastT = performance.now();
    requestAnimationFrame(frame);
  }
  console.log('[暗影模组] 加载完成');
  /* 退出对局清场：收掉场上黑洞、结束时间凝滞并恢复敌人速度（否则回主菜单再开一局会残留） */
  if (window.ModLoader && typeof ModLoader.onFieldClear === 'function') {
    ModLoader.onFieldClear(function () {
      try {
        for (var i = shadow.holes.length - 1; i >= 0; i--) {
          var h = shadow.holes[i];
          if (h && h.obj && h.obj.parent) h.obj.parent.remove(h.obj);
        }
        shadow.holes.length = 0;
        shadow.stop = false; shadow.stopLeft = 0;
        shadow.enemySnap.length = 0;
        shadow.tpProtect = null;
        _gravSendAt = 0;
        for (var j = 0; j < enemies.length; j++) {
          var e = enemies[j];
          if (e && !e.isNet && e._savedSpd !== undefined) { e.spd = e._savedSpd; delete e._savedSpd; }
        }
      } catch (e) { }
    });
  }
})();
