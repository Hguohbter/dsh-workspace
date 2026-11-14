/* 胖虎快跑 · 夜市跑酷
 * 2D Canvas 伪 3D：世界坐标 x 车道、y 高度、z 深度（越大越远）
 * 跑道沿"路径曲线"弯曲起伏，所有投影都带曲线/坡度偏移。
 */
(function () {
  'use strict';

  /* ================= CONFIG ================= */
  var CONFIG = {
    title: '胖虎快跑',
    laneW: 1.0,
    roadHalf: 1.9,
    playerZ: 3.6,
    camH: 3.85,
    speedMin: 9,
    speedMax: 21,
    accel: 0.011,
    jumpV: 7.9,
    gravity: 24,
    rollTime: 0.5,
    lives: 3,
    invuln: 1.25,
    hitSlow: 0.55,
    hitSlowTime: 0.9,
    zFar: 105,
    scooter: { speedMul: 1.65, dur: 9, minGap: 80 },
    food: {
      juan: { name: '香妃卷', score: 30, effect: 'shield', color: '#ffb04a' },
      chicken: { name: '鸡肉卷', score: 45, effect: 'boost', color: '#ffd166' },
      lengmian: { name: '烤冷面', score: 35, effect: 'heal', color: '#ff7a52' }
    },
    spawn: { sideGap: 6, rowGap: 13, jitter: 3 },
    lb: { base: 'https://ntfy.sh', topic: 'subway-hero-2026-x7k2' }
  };

  var CHARACTERS = [
    {
      id: 'panghu', name: '胖虎',
      face: 'assets/panghu-face.webp',
      head: 'assets/panghu-head.webp',
      headScale: 1, headOffsetX: 0,
      colors: {
        jacket: '#8a3350', jacketDark: '#5f2036',
        pants: '#2f3240', pantsDark: '#23262f',
        shoe: '#1b2025', skin: '#c9968f', pack: '#15181c'
      }
    }
  ];

  var COL = CHARACTERS[0].colors;

  /* ================= 工具 ================= */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rnd(arr.length)]; }
  function rnd2(a, b) { return a + Math.random() * (b - a); }
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ================= 路径（弯道 + 起伏） ================= */
  function curveAt(w) { return 0.62 * Math.sin(w * 0.035) + 0.26 * Math.sin(w * 0.083 + 1.3); }
  function hillAt(w) { return 0.40 * Math.sin(w * 0.026) + 0.16 * Math.sin(w * 0.061 + 2.1); }

  /* ================= 画布 ================= */
  var stage = document.getElementById('stage');
  var cvs = document.getElementById('game');
  var ctx = cvs.getContext('2d');

  var W = 0, H = 0, F = 1, horizon = 0, cx = 0;
  var dpr = 1;
  var skyGrad = null;

  var view = {
    shake: 0,
    fov: 1,
    fovTarget: 1,
    swayX: 0,
    swayPhase: 0
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, qualityDpr());
    var r = stage.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    F = Math.min(W * 0.92, H * 0.5);
    horizon = H * 0.34;
    cx = W / 2;
    skyGrad = null;
  }

  function qualityDpr() {
    var q = localStorage.getItem('subway.quality') || 'high';
    if (q === 'low') return 1;
    if (q === 'mid') return 1.5;
    return 2;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 140); });

  /* ================= 角色 ================= */
  var img = { face: new Image(), head: new Image() };
  var loadedCount = 0;
  var booted = false;

  function onAsset() {
    loadedCount++;
    updateLoadUI();
    if (loadedCount >= 2) ready();
  }

  var curChar = CHARACTERS[0];

  function applyCharacter(ch, persist) {
    curChar = ch;
    CONFIG.name = ch.name;
    COL = ch.colors;
    img.face.src = ch.face;
    img.head.src = ch.head;
    if (persist) localStorage.setItem('subway.char', ch.id);
    var f = document.getElementById('overFace');
    var n = document.getElementById('overName');
    if (f) f.src = ch.face;
    if (n) n.textContent = ch.name;
  }

  function pickCharacter() {
    var want = localStorage.getItem('subway.char');
    var m = /[?&]c=([a-z0-9_-]+)/i.exec(location.search);
    if (m) { want = m[1]; localStorage.setItem('subway.char', want); }
    for (var i = 0; i < CHARACTERS.length; i++) if (CHARACTERS[i].id === want) return CHARACTERS[i];
    return CHARACTERS[0];
  }

  /* ================= 游戏状态 ================= */
  var state = 'loading';
  var dist = 0;
  var speed = CONFIG.speedMin;
  var gameTime = 0;
  var score = 0;
  var foodCount = 0;
  var lives = CONFIG.lives;
  var invuln = 0;
  var slowTimer = 0;
  var best = Number(localStorage.getItem('subway.best') || 0);
  var freeze = false;

  var power = { shield: 0, boost: 0, scooter: 0 };
  var riding = false;

  var player = {
    lane: 0, x: 0, y: 0, vy: 0, roll: 0, lean: 0,
    grounded: true, groundH: 0
  };
  var rig = { phase: 0, ridePose: 0, idle: 0 };

  var world = { items: [], sideCursor: 0, rowCursor: 0, lastScooter: -100, nextId: 1 };
  var particles = [];
  var menuGhost = null;

  function resetRun() {
    dist = 0; speed = CONFIG.speedMin; gameTime = 0; score = 0; foodCount = 0;
    lives = CONFIG.lives; invuln = 0; slowTimer = 0;
    power.shield = 0; power.boost = 0; power.scooter = 0; riding = false;
    player.lane = 0; player.x = 0; player.y = 0; player.vy = 0;
    player.roll = 0; player.lean = 0; player.grounded = true; player.groundH = 0;
    rig.phase = 0; rig.ridePose = 0;
    world.items = []; world.sideCursor = 34; world.rowCursor = 40; world.lastScooter = -100;
    particles = [];
    view.fov = 1; view.fovTarget = 1; view.shake = 0;
    buffsDirty = true;
  }

  /* ================= 音效 ================= */
  var actx = null;
  var sfxOn = localStorage.getItem('subway.sfx') !== '0';
  var vibOn = localStorage.getItem('subway.vib') !== '0';

  function beep(freq, dur, type, vol) {
    if (!sfxOn) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.05, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { }
  }

  function vibrate(ms) {
    if (!vibOn) return;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { }
  }

  /* ================= 物件生成 ================= */
  var SIDE_TYPES = ['stall', 'stall', 'stall', 'lamp', 'tree', 'pole', 'bin', 'billboardSide'];
  var FOOD_KEYS = ['juan', 'chicken', 'lengmian'];

  function addItem(o) {
    o.id = world.nextId++;
    o.alive = true;
    world.items.push(o);
    return o;
  }

  function spawnSide(w) {
    var side = Math.random() < 0.5 ? -1 : 1;
    var type = pick(SIDE_TYPES);
    var x = side * rnd2(CONFIG.roadHalf + 0.55, CONFIG.roadHalf + 1.75);
    var o = {
      kind: 'side', type: type, w: w, x: x, lane: null, h: 0,
      variant: rnd(4), rot: rnd2(-0.26, 0.26), tilt: rnd2(-0.035, 0.035),
      scale: rnd2(0.9, 1.12), hue: rnd2(-12, 12), side: side
    };
    if (type === 'stall') {
      o.food = FOOD_KEYS[rnd(3)];
      o.steam = rnd2(0, 6.28);
      o.stallH = 1.05;
    }
    if (type === 'tree') o.h = rnd2(2.2, 3.4);
    if (type === 'lamp') o.h = rnd2(3.0, 3.4);
    if (type === 'pole') o.h = rnd2(3.4, 4.2);
    if (type === 'billboardSide') o.h = rnd2(2.4, 3.0);
    addItem(o);
  }

  function addObstacle(type, lane, w) {
    var base = {
      kind: 'obstacle', type: type, w: w, lane: lane,
      x: lane * CONFIG.laneW, variant: rnd(3), rot: rnd2(-0.15, 0.15), scale: 1
    };
    if (type === 'bin') { base.h = 0.85; base.dw = 0.62; }
    else if (type === 'barrier') { base.h = 0.62; base.dw = 0.9; }
    else if (type === 'billboard') { base.h = 2.2; base.dw = 0.95; }
    else if (type === 'banner') { base.h = 2.1; base.low = 1.05; base.dw = 0.95; }
    addItem(base);
    return base;
  }

  function addPlatform(type, lane, w) {
    var o = {
      kind: 'platform', type: type, w: w, lane: lane,
      x: lane * CONFIG.laneW, variant: rnd(3), rot: rnd2(-0.1, 0.1), scale: 1,
      dw: 1.0, depth: 1.1
    };
    if (type === 'crate') { o.h = 0.82; o.dw = 0.95; o.depth = 2.4; }
    else if (type === 'wall') { o.h = 1.12; o.dw = 1.1; o.depth = 2.8; }
    else if (type === 'steps') { o.h = 1.05; o.dw = 1.15; o.depth = 3.2; }
    else if (type === 'roof') { o.h = 1.05; o.dw = 1.2; o.depth = 3.4; }
    addItem(o);
    return o;
  }

  function addFood(key, lane, w, y) {
    addItem({
      kind: 'food', type: key, w: w, lane: lane, x: lane * CONFIG.laneW,
      y: y || 0.95, variant: 0, spin: rnd2(0, 6.28)
    });
  }

  function addScooter(lane, w) {
    addItem({ kind: 'scooter', type: 'scooter', w: w, lane: lane, x: lane * CONFIG.laneW, y: 0, variant: rnd(2) });
    world.lastScooter = w;
  }

  function otherLane(l) {
    var pool = [-1, 0, 1].filter(function (v) { return v !== l; });
    return pool[rnd(pool.length)];
  }

  function foodLine(lane, w, n) {
    n = n || 3;
    for (var i = 0; i < n; i++) addFood(pick(FOOD_KEYS), lane, w + i * 1.6, 0.95);
  }

  function spawnRow(w) {
    var r = Math.random(), lane = rnd(3) - 1, free, i;
    if (r < 0.26) {
      addObstacle(pick(['bin', 'barrier']), lane, w);
      if (Math.random() < 0.6) foodLine(otherLane(lane), w + 3.5, 3);
    } else if (r < 0.40) {
      free = rnd(3) - 1;
      for (i = 0; i < 3; i++) if (i - 1 !== free) addObstacle(pick(['bin', 'barrier']), i - 1, w);
      foodLine(free, w, 3);
    } else if (r < 0.52) {
      addObstacle('billboard', lane, w);
      foodLine(otherLane(lane), w + 4, 2);
    } else if (r < 0.62) {
      addObstacle('banner', lane, w);
      foodLine(lane, w - 3, 2);
    } else if (r < 0.78) {
      addPlatform(pick(['crate', 'wall', 'steps', 'roof']), lane, w);
      if (Math.random() < 0.7) addFood(pick(FOOD_KEYS), lane, w, 0.95 + 0.9);
    } else if (r < 0.90) {
      foodLine(lane, w, 3);
    } else if (w - world.lastScooter > CONFIG.scooter.minGap) {
      addScooter(lane, w);
    }
  }

  function updateWorld() {
    var horizonW = dist + CONFIG.zFar + 30;
    while (world.sideCursor < horizonW) {
      spawnSide(world.sideCursor);
      world.sideCursor += CONFIG.spawn.sideGap + rnd2(-1.6, 1.6);
    }
    while (world.rowCursor < horizonW) {
      if (state === 'menu') {
        var hasScooter = false;
        for (var q = 0; q < world.items.length; q++) {
          var qi = world.items[q];
          if (qi.kind === "scooter" && qi.w > dist + 4) hasScooter = true;
        }
        if (!hasScooter) addScooter(rnd(3) - 1, world.rowCursor + 8);
      } else {
        spawnRow(world.rowCursor);
      }
      world.rowCursor += CONFIG.spawn.rowGap + rnd2(-CONFIG.spawn.jitter, CONFIG.spawn.jitter);
    }
    // 回收
    for (var i = world.items.length - 1; i >= 0; i--) {
      var it = world.items[i];
      if (it.w < dist - 6 || !it.alive) world.items.splice(i, 1);
    }
  }

  /* ================= 投影 ================= */
  function refCurve() { return curveAt(dist + CONFIG.playerZ); }
  function refHill() { return hillAt(dist + CONFIG.playerZ); }
  function zOf(w) { return Math.max(0.85, w - dist); }

  function projX(x, w) {
    var z = zOf(w);
    return cx + ((x + curveAt(w) - refCurve()) * F * view.fov) / z + view.swayX;
  }
  function projY(y, w) {
    var z = zOf(w);
    return horizon + ((CONFIG.camH - y - (hillAt(w) - refHill())) * F * view.fov) / z;
  }
  function scaleAt(w) { return (F * view.fov) / zOf(w); }

  function quad3(pts, fill) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var sx = projX(p[0], p[2]), sy = projY(p[1], p[2]);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function boxAt(x, w, dw, dh, dd, cTop, cFront, cSide) {
    var w0 = w - dd / 2, w1 = w + dd / 2;
    var x0 = x - dw / 2, x1 = x + dw / 2;
    var z = zOf(w);
    var alpha = fogAlpha(z);
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    quad3([[x0, dh, w0], [x1, dh, w0], [x1, dh, w1], [x0, dh, w1]], cTop);
    if (x > 0.06) quad3([[x0, 0, w0], [x0, 0, w1], [x0, dh, w1], [x0, dh, w0]], cSide);
    else if (x < -0.06) quad3([[x1, 0, w0], [x1, 0, w1], [x1, dh, w1], [x1, dh, w0]], cSide);
    quad3([[x0, 0, w0], [x1, 0, w0], [x1, dh, w0], [x0, dh, w0]], cFront);
    ctx.globalAlpha = 1;
  }

  function fogAlpha(z) {
    if (z > CONFIG.zFar) return 0;
    if (z > CONFIG.zFar - 30) return clamp((CONFIG.zFar - z) / 30, 0, 1);
    return 1;
  }

  /* ================= 更新 ================= */
  function update(dt) {
    gameTime += dt;
    view.swayPhase += dt * 1.7;

    if (state === 'menu') {
      dist += 4.5 * dt;
      updateWorld();
      updateMenuGhost(dt);
      rig.idle += dt;
      view.swayX = Math.sin(view.swayPhase * 0.6) * 2;
      return;
    }
    if (state !== 'play') return;

    if (invuln > 0) invuln = Math.max(0, invuln - dt);
    if (slowTimer > 0) slowTimer = Math.max(0, slowTimer - dt);
    if (power.boost > 0) power.boost = Math.max(0, power.boost - dt);
    if (power.scooter > 0) {
      power.scooter = Math.max(0, power.scooter - dt);
      if (power.scooter === 0 && riding) endRide(false);
    }

    var base = Math.min(CONFIG.speedMax, CONFIG.speedMin + dist * CONFIG.accel);
    var target = base * (riding ? CONFIG.scooter.speedMul : 1) * (slowTimer > 0 ? CONFIG.hitSlow : 1);
    speed += (target - speed) * Math.min(1, dt * 6);
    dist += speed * dt;
    gameTime += 0;

    // 视角：随速度/FOV/惯性
    view.fovTarget = riding ? 1.075 : 1 + clamp((speed - 9) / 12, 0, 1) * 0.035;
    view.fov += (view.fovTarget - view.fov) * Math.min(1, dt * 4);
    view.swayX = Math.sin(view.swayPhase) * 2.2 + (player.x * -6);
    if (view.shake > 0) view.shake = Math.max(0, view.shake - dt * 2.2);

    updatePlayer(dt);
    updateWorld();
    checkPickups();
    updateParticles(dt);
    updateHud();
  }

  function updatePlayer(dt) {
    if (player.roll > 0) player.roll = Math.max(0, player.roll - dt);

    var tx = player.lane * CONFIG.laneW;
    var k = 1 - Math.exp(-dt * 14);
    player.x += (tx - player.x) * k;
    player.lean += ((tx - player.x) * 2.0 - player.lean) * (1 - Math.exp(-dt * 12));

    var gh = groundHeight();
    if (player.y > gh + 0.004 || player.vy > 0) {
      player.vy -= CONFIG.gravity * dt;
      player.y += player.vy * dt;
      if (player.y <= gh) {
        var impact = -player.vy;
        player.y = gh; player.vy = 0; player.grounded = true;
        if (impact > 5) { burst(projX(player.x, dist + CONFIG.playerZ), projY(gh, dist + CONFIG.playerZ), '#d9c9a8', 4); }
      } else {
        player.grounded = false;
      }
    } else {
      player.y = gh; player.vy = 0; player.grounded = true;
    }
    player.groundH = gh;

    // 障碍碰撞
    var pw = dist + CONFIG.playerZ;
    for (var i = 0; i < world.items.length; i++) {
      var it = world.items[i];
      if (it.kind !== 'obstacle') continue;
      if (Math.abs(it.w - pw) > 0.6) continue;
      if (Math.abs(player.x - it.x) > it.dw * 0.5 + 0.3) continue;
      if (it.type === 'banner') {
        if (player.roll > 0) continue;
        if (player.y > it.low + 0.55) continue;
        hitObstacle(it);
      } else if (it.type === 'billboard') {
        if (player.y > it.h - 0.2) continue;
        hitObstacle(it);
      } else {
        if (player.y >= it.h - 0.18) continue;
        hitObstacle(it);
      }
    }

    // 平台侧面：低于台面撞上去
    for (var j = 0; j < world.items.length; j++) {
      var pl = world.items[j];
      if (pl.kind !== 'platform') continue;
      if (Math.abs(pl.w - pw) > (pl.depth || 1.1) * 0.5) continue;
      if (Math.abs(player.x - pl.x) > (pl.dw || 1) * 0.5 + 0.28) continue;
      if (player.y >= pl.h - 0.24) continue;
      hitObstacle(pl);
      break;
    }
  }

  function groundHeight() {
    var pw = dist + CONFIG.playerZ;
    var g = 0;
    for (var i = 0; i < world.items.length; i++) {
      var it = world.items[i];
      if (it.kind !== 'platform') continue;
      var halfZ = (it.depth || 1.1) * 0.5 + 0.3;
      if (Math.abs(it.w - pw) > halfZ) continue;
      if (Math.abs(player.x - it.x) > (it.dw || 1) * 0.5 + 0.25) continue;
      if (player.y >= it.h - 0.28) g = Math.max(g, it.h);
    }
    return g;
  }

  function checkPickups() {
    var pw = dist + CONFIG.playerZ;
    for (var i = 0; i < world.items.length; i++) {
      var it = world.items[i];
      if (!it.alive) continue;
      if (it.kind === 'food') {
        if (Math.abs(it.w - pw) < 0.7 && Math.abs(player.x - it.x) < 0.7 &&
            Math.abs(player.y + 0.55 - it.y) < 1.0) {
          eatFood(it);
        }
      } else if (it.kind === 'scooter' && !riding) {
        if (Math.abs(it.w - pw) < 0.9 && Math.abs(player.x - it.x) < 0.75 && player.y < 1.0) {
          it.alive = false;
          startRide();
        }
      }
    }
  }

  function eatFood(it) {
    var def = CONFIG.food[it.type];
    it.alive = false;
    foodCount++;
    score += def.score;
    beep(920 + Math.random() * 160, 0.08, 'triangle', 0.045);
    burst(projX(it.x, it.w), projY(it.y, it.w), def.color, 7);
    if (def.effect === 'shield') { power.shield = 1; flashHint('香妃卷 · 获得护盾'); }
    else if (def.effect === 'boost') { power.boost = 4; flashHint('鸡肉卷 · 加速！'); }
    else if (def.effect === 'heal') {
      if (lives < CONFIG.lives) { lives++; flashHint('烤冷面 · 回一格血'); }
      else flashHint('烤冷面 · 满血 +分');
    }
    buffsDirty = true;
  }

  function hitObstacle(it) {
    if (invuln > 0) return;
    if (power.shield > 0) {
      power.shield = 0; invuln = 1.1; it.alive = false;
      view.shake = 0.5; vibrate(30);
      beep(880, 0.16, 'sine', 0.06);
      burst(projX(player.x, dist + CONFIG.playerZ), projY(player.y + 0.8, dist + CONFIG.playerZ), '#6cd8ff', 12);
      buffsDirty = true;
      return;
    }
    if (riding) {
      endRide(true);
      it.alive = false;
      return;
    }
    lives--;
    invuln = CONFIG.invuln;
    slowTimer = CONFIG.hitSlowTime;
    view.shake = 1;
    vibrate(60);
    beep(150, 0.3, 'sawtooth', 0.07);
    burst(projX(player.x, dist + CONFIG.playerZ), projY(player.y + 0.8, dist + CONFIG.playerZ), '#ff5d6c', 14);
    if (lives <= 0) gameOver();
  }

  function startRide() {
    riding = true;
    power.scooter = CONFIG.scooter.dur;
    invuln = Math.max(invuln, 0.6);
    view.fovTarget = 1.08;
    view.shake = 0.35;
    vibrate(25);
    beep(700, 0.12, 'square', 0.05);
    beep(1000, 0.16, 'square', 0.04);
    flashHint('骑上小电驴！');
    buffsDirty = true;
  }

  function endRide(crashed) {
    riding = false;
    power.scooter = 0;
    invuln = Math.max(invuln, 1.4);
    slowTimer = crashed ? 0.7 : 0;
    view.shake = crashed ? 0.9 : 0.3;
    if (crashed) {
      vibrate(60);
      beep(200, 0.25, 'sawtooth', 0.06);
      burst(projX(player.x, dist + CONFIG.playerZ), projY(0.6, dist + CONFIG.playerZ), '#ffc857', 14);
    }
    buffsDirty = true;
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.g == null ? -9 : p.g) * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function burst(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, sp = 50 + Math.random() * 200;
      particles.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 80,
        life: 0.35 + Math.random() * 0.35, max: 0.7, color: color,
        size: 2 + Math.random() * 3, g: -260
      });
    }
  }

  function updateMenuGhost(dt) {
    if (!menuGhost) {
      menuGhost = { w: dist + 14, lane: 1 };
    }
    if (menuGhost.w - dist < 3) { menuGhost.w = dist + rnd2(20, 32); menuGhost.lane = rnd(3) - 1; }
    menuGhost.w += 0;
  }

  /* ================= 渲染：天空 / 城市 / 路面 ================= */
  var stars = null, clouds = null;

  function drawSky() {
    if (!skyGrad) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, horizon + 50);
      skyGrad.addColorStop(0, '#150e26');
      skyGrad.addColorStop(0.42, '#331b39');
      skyGrad.addColorStop(0.72, '#6d2f45');
      skyGrad.addColorStop(1, '#c4643f');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, horizon + 2);

    if (!stars) {
      stars = [];
      for (var i = 0; i < 46; i++) {
        stars.push({ x: Math.random(), y: Math.random() * 0.62, r: 0.6 + Math.random() * 1.2, p: Math.random() * 6.28 });
      }
    }
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      var tw = 0.45 + 0.55 * Math.abs(Math.sin(gameTime * 1.4 + st.p));
      ctx.globalAlpha = tw * 0.8;
      ctx.fillStyle = '#ffeccf';
      ctx.beginPath();
      ctx.arc(st.x * W, st.y * horizon, st.r, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 月亮
    var mx = W * 0.74, my = horizon * 0.26, mr = Math.max(20, W * 0.055);
    var mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 3.2);
    mg.addColorStop(0, 'rgba(255, 226, 178, .55)');
    mg.addColorStop(1, 'rgba(255, 226, 178, 0)');
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.arc(mx, my, mr * 3.2, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#ffe9c2';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.283); ctx.fill();

    // 低多边形云
    if (!clouds) {
      clouds = [];
      for (var c = 0; c < 6; c++) clouds.push({ x: Math.random(), y: 0.10 + Math.random() * 0.34, s: 0.6 + Math.random() * 0.8 });
    }
    for (var k = 0; k < clouds.length; k++) {
      var cl = clouds[k];
      var span = W + 300;
      var cxp = ((cl.x * span - dist * 1.6) % span + span) % span - 150;
      drawCloud(cxp, horizon * cl.y, 30 * cl.s);
    }
  }

  function drawCloud(x, y, r) {
    ctx.fillStyle = 'rgba(255, 210, 200, .07)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, 6.283);
    ctx.arc(x + r * 0.6, y + r * 0.08, r * 0.42, 0, 6.283);
    ctx.arc(x - r * 0.6, y + r * 0.1, r * 0.4, 0, 6.283);
    ctx.fill();
  }

  function drawCity() {
    // 远景：三层视差天际线
    // 地平线暖光（夜市灯光的散射）
    var hg = ctx.createLinearGradient(0, horizon - 90, 0, horizon + 40);
    hg.addColorStop(0, 'rgba(255, 130, 60, 0)');
    hg.addColorStop(0.55, 'rgba(255, 130, 60, .22)');
    hg.addColorStop(1, 'rgba(255, 90, 40, .05)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, horizon - 90, W, 130);
    skylineLayer(0.12, horizon + 4, '#241a30', 0.55, 0);
    skylineLayer(0.28, horizon + 8, '#1b1224', 0.85, 1);
    drawBridge();
    skylineLayer(0.55, horizon + 14, '#120c18', 1.05, 2);
  }

  function skylineLayer(par, baseY, color, scale, seed) {
    var off = (dist * par) % 1400;
    ctx.fillStyle = color;
    for (var i = 0; i < 16; i++) {
      var sd = i * 53.1 + seed * 17;
      var bw = (34 + Math.abs(Math.sin(sd)) * 54) * scale;
      var bh = (24 + Math.abs(Math.sin(sd * 1.6)) * 62) * scale;
      var x = ((i * 104 - off) % 1664 + 1664) % 1664 - 120 + view.swayX * par * -2;
      ctx.fillRect(x, baseY - bh, bw, bh);
      // 亮窗
      if (scale > 0.8) {
        ctx.fillStyle = 'rgba(255, 190, 120, .18)';
        for (var r = 0; r < 3; r++) {
          for (var c = 0; c < 3; c++) {
            if ((r + c + i) % 3 === 0) continue;
            ctx.fillRect(x + 7 + c * (bw / 3.4), baseY - bh + 8 + r * (bh / 4), bw / 14, bh / 20);
          }
        }
        ctx.fillStyle = color;
      }
    }
  }

  function drawBridge() {
    var y = horizon - 26, hgt = 16;
    var off = (dist * 0.2) % 900;
    ctx.fillStyle = '#1a1222';
    ctx.fillRect(0, y, W, hgt);
    ctx.fillStyle = '#2a1e33';
    for (var i = 0; i < 10; i++) {
      var x = ((i * 90 - off) % 900 + 900) % 900 - 60;
      ctx.fillRect(x, y + hgt, 9, 22);
    }
    // 高架上的列车剪影
    var tx = ((dist * 0.35) % 1400) - 200;
    ctx.fillStyle = '#3a2a44';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(tx, y - 10, 130, 14, 4) : ctx.rect(tx, y - 10, 130, 14);
    ctx.fill();
    for (var w = 0; w < 5; w++) {
      ctx.fillStyle = 'rgba(255, 214, 150, .45)';
      ctx.fillRect(tx + 12 + w * 24, y - 6, 12, 6);
      ctx.fillStyle = '#3a2a44';
    }
  }

  function ribbon(x0, x1, fill) {
    var zs = [];
    for (var z = 1.1; z < CONFIG.zFar; z *= 1.14) zs.push(z);
    zs.push(CONFIG.zFar);
    ctx.beginPath();
    for (var i = zs.length - 1; i >= 0; i--) {
      var w = dist + zs[i];
      ctx.lineTo(projX(x0, w), projY(0, w));
    }
    for (var j = 0; j < zs.length; j++) {
      var w2 = dist + zs[j];
      ctx.lineTo(projX(x1, w2), projY(0, w2));
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function strip(x0, x1, w0, w1, fill) {
    quad3([[x0, 0, w0], [x1, 0, w0], [x1, 0, w1], [x0, 0, w1]], fill);
  }

  function drawRoad() {
    var rh = CONFIG.roadHalf;
    ctx.fillStyle = '#0d080f';
    ctx.fillRect(0, horizon - 2, W, H - horizon + 2);

    ribbon(-rh - 2.9, -rh - 0.16, '#3a2a30');
    ribbon(rh + 0.16, rh + 2.9, '#3a2a30');
    ribbon(-rh, rh, '#2a2029');
    ribbon(-rh - 0.16, -rh, '#6b4f5c');
    ribbon(rh, rh + 0.16, '#6b4f5c');

    // 车道虚线
    var step = 2.6, len = 1.05;
    var start = Math.floor((dist + 1) / step) * step;
    for (var w = start; w < dist + CONFIG.zFar; w += step) {
      strip(-0.53, -0.47, w, w + len, 'rgba(255, 232, 200, .42)');
      strip(0.47, 0.53, w, w + len, 'rgba(255, 232, 200, .42)');
    }
    // 边线
    ribbon(-rh + 0.03, -rh + 0.1, 'rgba(255, 176, 74, .5)');
    ribbon(rh - 0.1, rh - 0.03, 'rgba(255, 176, 74, .5)');

    // 人行道砖缝
    var seam = 2.2;
    var s0 = Math.floor((dist + 1) / seam) * seam;
    for (var sw = s0; sw < dist + CONFIG.zFar; sw += seam) {
      strip(-rh - 2.8, -rh - 0.2, sw, sw + 0.1, 'rgba(255, 200, 170, .05)');
      strip(rh + 0.2, rh + 2.8, sw, sw + 0.1, 'rgba(255, 200, 170, .05)');
    }
  }

  /* ================= 渲染：物件 ================= */
  var FOOD_GLOW = { juan: '#ffb04a', chicken: '#ffd166', lengmian: '#ff7a52' };

  function drawItems() {
    var list = [];
    for (var i = 0; i < world.items.length; i++) {
      var it = world.items[i];
      var z = it.w - dist;
      if (!it.alive) continue;
      if (z < 0.7 || z > CONFIG.zFar) continue;
      list.push(it);
    }
    list.sort(function (a, b) { return b.w - a.w; });
    for (var k = 0; k < list.length; k++) drawItem(list[k]);
  }

  function drawItem(it) {
    switch (it.type) {
      case 'stall': drawStall(it); break;
      case 'lamp': drawLamp(it); break;
      case 'tree': drawTree(it); break;
      case 'pole': drawPole(it); break;
      case 'bin': case 'barrier': case 'billboard': case 'banner': drawObstacle(it); break;
      case 'billboardSide': drawBillboardSide(it); break;
      case 'crate': case 'wall': case 'steps': case 'roof': drawPlatform(it); break;
      case 'juan': case 'chicken': case 'lengmian': drawFood(it); break;
      case 'scooter': drawScooter(it); break;
    }
  }

  function drawStall(it) {
    var w = it.w, x = it.x, z = w - dist, s = scaleAt(w), a = fogAlpha(z);
    if (a <= 0) return;
    ctx.globalAlpha = a;

    var gx = projX(x, w), gy = projY(0.02, w), gr = 2.6 * s;
    var g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, 'rgba(255, 176, 92, .42)');
    g.addColorStop(1, 'rgba(255, 176, 92, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(gx, gy, gr, gr * 0.42, 0, 0, 6.283); ctx.fill();

    var dw = 1.7, dd = 1.15, bodyH = 1.0;
    boxAt(x, w, dw, bodyH, dd, '#8d4f2c', '#a56237', '#6d3a20');
    boxAt(x, w, dw + 0.08, bodyH + 0.07, dd + 0.08, '#f5dbb0', '#e7c592', '#c9a877');
    // 台面上的小吃
    for (var f = 0; f < 3; f++) {
      var fx = x - dw * 0.3 + f * dw * 0.3;
      quad3([[fx - 0.1, bodyH + 0.2, w - 0.1], [fx + 0.1, bodyH + 0.2, w - 0.1],
        [fx + 0.1, bodyH + 0.2, w + 0.1], [fx - 0.1, bodyH + 0.2, w + 0.1]], FOOD_GLOW[it.food] || '#ffb04a');
    }
    // 棚下挂灯
    var lx2 = projX(x, w), ly2 = projY(1.95, w), lr2 = 0.55 * s;
    var lg = ctx.createRadialGradient(lx2, ly2, 0, lx2, ly2, lr2);
    lg.addColorStop(0, 'rgba(255, 210, 130, .55)');
    lg.addColorStop(1, 'rgba(255, 210, 130, 0)');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(lx2, ly2, lr2, 0, 6.283); ctx.fill();

    // 立柱
    boxAt(x - dw / 2 + 0.09, w - dd / 2 + 0.06, 0.07, 2.15, 0.07, '#5a3a2a', '#6b4632', '#4a2f22');
    boxAt(x + dw / 2 - 0.09, w - dd / 2 + 0.06, 0.07, 2.15, 0.07, '#5a3a2a', '#6b4632', '#4a2f22');

    // 雨棚条纹
    var w0 = w - dd / 2 - 0.12, w1 = w + dd / 2 + 0.12;
    var ax0 = x - dw / 2 - 0.3, ax1 = x + dw / 2 + 0.3;
    for (var sIdx = 0; sIdx < 5; sIdx++) {
      var t0 = sIdx / 5, t1 = (sIdx + 1) / 5;
      quad3([
        [lerp(ax0, ax1, t0), 2.3, w0],
        [lerp(ax0, ax1, t1), 2.3, w0],
        [lerp(ax0, ax1, t1), 2.02, w1],
        [lerp(ax0, ax1, t0), 2.02, w1]
      ], (sIdx % 2) ? '#e8503f' : '#f7e6c8');
    }

    // 招牌
    var sx = projX(x, w), sy = projY(2.66, w);
    var sw = 1.4 * s, sh = 0.44 * s;
    ctx.fillStyle = 'rgba(26, 11, 18, .92)';
    ctx.fillRect(sx - sw / 2, sy - sh / 2, sw, sh);
    ctx.strokeStyle = FOOD_GLOW[it.food] || '#ffb04a';
    ctx.lineWidth = Math.max(1, 0.03 * s);
    ctx.strokeRect(sx - sw / 2, sy - sh / 2, sw, sh);
    var fpx = 0.24 * s;
    if (fpx > 4) {
      ctx.fillStyle = '#fff6e2';
      ctx.font = '700 ' + fpx.toFixed(1) + 'px "PingFang SC","Microsoft YaHei",system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CONFIG.food[it.food].name, sx, sy + 0.5);
    }

    // 蒸汽
    for (var k = 0; k < 3; k++) {
      var ph = (gameTime * 0.45 + it.steam + k * 0.34) % 1;
      var yy = 1.1 + ph * 1.15;
      var xx = x + Math.sin(ph * 6 + k * 2) * 0.16;
      var rr = (0.1 + ph * 0.2) * s;
      ctx.globalAlpha = a * (1 - ph) * 0.45;
      ctx.fillStyle = '#ffe9cf';
      ctx.beginPath(); ctx.arc(projX(xx, w), projY(yy, w), rr, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawLamp(it) {
    var w = it.w, x = it.x, z = w - dist, s = scaleAt(w), a = fogAlpha(z);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    boxAt(x, w, 0.1, it.h, 0.1, '#3b2f3b', '#4c3e4c', '#2a212a');
    var armX = x - Math.sign(x) * 0.6;
    quad3([[x, it.h, w], [armX, it.h, w], [armX, it.h - 0.09, w], [x, it.h - 0.09, w]], '#4c3e4c');
    var lx = projX(armX, w), ly = projY(it.h - 0.12, w), r = 0.62 * s;
    var g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
    g.addColorStop(0, 'rgba(255, 208, 140, .5)');
    g.addColorStop(1, 'rgba(255, 208, 140, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(lx, ly, r, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#ffe4b0';
    ctx.beginPath(); ctx.arc(lx, ly, Math.max(1.5, 0.07 * s), 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawTree(it) {
    var w = it.w, x = it.x, z = w - dist, s = scaleAt(w), a = fogAlpha(z);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    boxAt(x, w, 0.16, it.h * 0.55, 0.16, '#3a2a20', '#4a3628', '#2e211a');
    var cx0 = projX(x, w), cy0 = projY(it.h * 0.72, w), r = 0.75 * s;
    ctx.fillStyle = '#1d3327';
    ctx.beginPath(); ctx.arc(cx0 - r * 0.4, cy0 + r * 0.1, r * 0.72, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(cx0 + r * 0.4, cy0 + r * 0.05, r * 0.66, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#26452f';
    ctx.beginPath(); ctx.arc(cx0, cy0 - r * 0.3, r * 0.78, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPole(it) {
    var w = it.w, x = it.x, z = w - dist, a = fogAlpha(z);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    boxAt(x, w, 0.12, it.h, 0.12, '#332a2a', '#443636', '#251e1e');
    quad3([[x - 0.55, it.h - 0.3, w], [x + 0.55, it.h - 0.3, w],
      [x + 0.55, it.h - 0.2, w], [x - 0.55, it.h - 0.2, w]], '#3e3333');
    ctx.globalAlpha = 1;
  }

  function drawObstacle(it) {
    var w = it.w, x = it.x, z = w - dist, a = fogAlpha(z);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    if (it.type === 'bin') {
      boxAt(x, w, 0.62, 0.85, 0.55, '#2f4a3d', '#24483a', '#1d3a2e');
      boxAt(x, w, 0.66, 0.92, 0.6, '#3d6152', '#2f5a49', '#254638');
    } else if (it.type === 'barrier') {
      boxAt(x, w, 0.9, 0.62, 0.35, '#ffb43a', '#ff8c1a', '#d96b0d');
      quad3([[x - 0.4, 0.55, w - 0.18], [x + 0.4, 0.55, w - 0.18],
        [x + 0.4, 0.36, w - 0.18], [x - 0.4, 0.36, w - 0.18]], 'rgba(255,255,255,.85)');
    } else if (it.type === 'billboard') {
      boxAt(x, w, 0.12, 2.2, 0.12, '#3a3a46', '#4a4a58', '#2c2c36');
      boxAt(x, w, 1.1, 2.2, 0.16, '#1d2230', '#232a3a', '#161b26');
      var sx = projX(x, w), sy = projY(1.75, w), s = scaleAt(w);
      ctx.fillStyle = '#ff7a2f';
      ctx.fillRect(sx - 0.42 * s, sy - 0.2 * s, 0.84 * s, 0.4 * s);
      ctx.fillStyle = '#2a1100';
      ctx.font = '700 ' + (0.2 * s).toFixed(1) + 'px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (0.2 * s > 4) ctx.fillText('夜市', sx, sy + 0.5);
    } else if (it.type === 'banner') {
      boxAt(x - 0.52, w, 0.12, 2.1, 0.12, '#4a3a30', '#5a4638', '#3a2c24');
      boxAt(x + 0.52, w, 0.12, 2.1, 0.12, '#4a3a30', '#5a4638', '#3a2c24');
      quad3([[x - 0.52, 2.05, w], [x + 0.52, 2.05, w], [x + 0.52, 1.05, w], [x - 0.52, 1.05, w]], '#c8303f');
      quad3([[x - 0.52, 1.6, w - 0.01], [x + 0.52, 1.6, w - 0.01],
        [x + 0.52, 1.5, w - 0.01], [x - 0.52, 1.5, w - 0.01]], 'rgba(255,255,255,.8)');
    }
    ctx.globalAlpha = 1;
  }

  function drawBillboardSide(it) {
    var w = it.w, x = it.x, z = w - dist, a = fogAlpha(z);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    boxAt(x, w, 0.14, it.h, 0.14, '#3a3a46', '#4a4a58', '#2c2c36');
    boxAt(x, w, 1.3, 1.5, 0.18, '#231d2b', '#2b2434', '#1a1520');
    var s = scaleAt(w), sx = projX(x, w), sy = projY(it.h - 0.75, w);
    ctx.fillStyle = 'rgba(255, 190, 90, .55)';
    ctx.fillRect(sx - 0.55 * s, sy - 0.55 * s, 1.1 * s, 1.1 * s);
    ctx.fillStyle = '#2a1a10';
    ctx.font = '700 ' + (0.34 * s).toFixed(1) + 'px "PingFang SC",system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (0.34 * s > 5) ctx.fillText('胖虎', sx, sy);
    ctx.globalAlpha = 1;
  }

  function drawPlatform(it) {
    var w = it.w, x = it.x, z = w - dist, a = fogAlpha(z);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    var dw = it.dw, dd = it.depth || 1.1;
    if (it.type === 'crate') {
      boxAt(x, w, dw, it.h, dd, '#c98f4e', '#b87a3c', '#8d5a28');
      var s = scaleAt(w);
      var sx = projX(x, w), sy = projY(it.h, w);
      ctx.strokeStyle = 'rgba(255, 210, 140, .9)';
      ctx.lineWidth = Math.max(1, 0.025 * s);
      ctx.beginPath();
      ctx.moveTo(sx - dw * 0.42 * s, sy);
      ctx.lineTo(sx + dw * 0.42 * s, sy);
      ctx.stroke();
    } else if (it.type === 'wall') {
      boxAt(x, w, dw, it.h, dd, '#6b5a72', '#7a6880', '#55465c');
      boxAt(x, w, dw * 1.02, it.h * 0.18, dd * 1.02, '#8a7890', '#7a6880', '#5e4e66');
    } else if (it.type === 'steps') {
      boxAt(x, w, dw, 0.55, dd, '#7a6a82', '#6a5a72', '#57495e');
      boxAt(x, w + 0.35, dw, 1.05, dd * 0.62, '#8a7a92', '#7a6a82', '#63536a');
    } else {
      // roof：摊位顶棚
      boxAt(x, w, dw, it.h, dd, '#e8503f', '#b93c2e', '#8f2c22');
      boxAt(x, w, dw + 0.12, it.h + 0.06, dd + 0.1, '#f7e6c8', '#e8d4b0', '#c9b894');
      var s2 = scaleAt(w);
      var rx = projX(x, w), ry = projY(it.h + 0.06, w);
      ctx.strokeStyle = 'rgba(255, 230, 160, .9)';
      ctx.lineWidth = Math.max(1, 0.03 * s2);
      ctx.beginPath();
      ctx.moveTo(rx - dw * 0.5 * s2, ry);
      ctx.lineTo(rx + dw * 0.5 * s2, ry);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ================= 渲染：小吃 / 电驴 / 角色 ================= */
  function drawFood(it) {
    var w = it.w, x = it.x, z = w - dist, s = scaleAt(w), a = fogAlpha(z);
    if (a <= 0) return;
    var def = CONFIG.food[it.type];
    var bob = Math.sin(gameTime * 3 + it.spin) * 0.08;
    var cx0 = projX(x, w), cy0 = projY(it.y + bob, w);
    var r = 0.24 * s;

    ctx.globalAlpha = a;
    var g = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, r * 2.6);
    g.addColorStop(0, hexA(def.color, 0.55));
    g.addColorStop(1, hexA(def.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx0, cy0, r * 2.6, 0, 6.283); ctx.fill();

    ctx.fillStyle = '#2a1408';
    ctx.beginPath(); ctx.arc(cx0, cy0, r, 0, 6.283); ctx.fill();
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(cx0, cy0, r * 0.84, 0, 6.283); ctx.fill();
    // 卷饼纹路
    ctx.strokeStyle = 'rgba(255, 245, 220, .8)';
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath();
    ctx.arc(cx0, cy0, r * 0.5, 0.4, 2.4);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawScooterBody(x, w, yBase, scaleMul) {
    var s = scaleAt(w) * (scaleMul || 1);
    var wheelR = 0.15 * s;
    var wx1 = projX(x - 0.34, w), wx2 = projX(x + 0.34, w);
    var wy = projY(yBase + 0.15, w);

    ctx.fillStyle = '#1a1a22';
    ctx.beginPath(); ctx.arc(wx1, wy, wheelR, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(wx2, wy, wheelR, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#3a3a48';
    ctx.beginPath(); ctx.arc(wx1, wy, wheelR * 0.5, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(wx2, wy, wheelR * 0.5, 0, 6.283); ctx.fill();

    // 车身
    quad3([
      [x - 0.3, yBase + 0.3, w - 0.1],
      [x + 0.3, yBase + 0.3, w - 0.1],
      [x + 0.34, yBase + 0.42, w + 0.12],
      [x - 0.34, yBase + 0.42, w + 0.12]
    ], '#2fd8c0');
    // 车头
    var hx = projX(x, w - 0.1), hy0 = projY(yBase + 0.42, w - 0.1), hy1 = projY(yBase + 1.0, w - 0.1);
    ctx.strokeStyle = '#2fd8c0';
    ctx.lineWidth = Math.max(1.5, 0.09 * s);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy0); ctx.lineTo(hx, hy1); ctx.stroke();
    // 车把
    ctx.lineWidth = Math.max(1.5, 0.07 * s);
    ctx.beginPath();
    ctx.moveTo(projX(x - 0.28, w - 0.12), hy1);
    ctx.lineTo(projX(x + 0.28, w - 0.12), hy1);
    ctx.stroke();
    // 车灯
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(hx, hy1 - 0.06 * s, Math.max(1.4, 0.06 * s), 0, 6.283); ctx.fill();
  }

  function drawScooter(it) {
    var w = it.w, x = it.x, z = w - dist, a = fogAlpha(z);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    var s = scaleAt(w);
    var gx = projX(x, w), gy = projY(0.02, w), gr = 1.0 * s;
    var g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, 'rgba(56, 224, 200, .35)');
    g.addColorStop(1, 'rgba(56, 224, 200, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(gx, gy, gr, gr * 0.42, 0, 0, 6.283); ctx.fill();
    drawScooterBody(x, w, 0.02);
    // 浮动箭头提示
    var ty = projY(1.35 + Math.sin(gameTime * 4) * 0.08, w);
    ctx.fillStyle = '#38e0c8';
    ctx.beginPath();
    ctx.moveTo(gx, ty + 0.18 * s);
    ctx.lineTo(gx - 0.14 * s, ty);
    ctx.lineTo(gx + 0.14 * s, ty);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function runPose() {
    var ph = rig.phase;
    var a = Math.sin(ph), b = Math.sin(ph + Math.PI);
    var liftL = Math.max(0, a), liftR = Math.max(0, b);
    return {
      hipL: 0.09 + 0.11 * liftL,
      kneeL: 1.55 * liftL,
      hipR: 0.09 + 0.11 * liftR,
      kneeR: 1.55 * liftR,
      armL: -0.5 * a,
      armR: -0.5 * b,
      pitch: 0.075,
      bob: -Math.abs(Math.sin(ph)) * 0.045
    };
  }

  function idlePose() {
    var s = Math.sin(rig.idle * 1.6);
    return {
      hipL: 0.1, kneeL: 0.08, hipR: 0.1, kneeR: 0.08,
      armL: 0.04 * s, armR: -0.04 * s,
      pitch: 0.02, bob: s * 0.012
    };
  }

  function ridePose() {
    var s = Math.sin(gameTime * 6) * 0.02;
    return {
      hipL: 0.2, kneeL: 0.62, hipR: 0.17, kneeR: 0.56,
      armL: -0.75, armR: -0.75,
      pitch: 0.14, bob: s
    };
  }

  function drawPlayer() {
    var pw = dist + CONFIG.playerZ;
    var s = scaleAt(pw);
    var x = projX(player.x, pw);
    var feet = projY(player.y, pw);
    var ground = projY(0, pw);

    var pose = state === 'menu' ? idlePose() : (riding ? ridePose() : runPose());
    var squash = player.roll > 0 ? 0.72 : 1;

    // 影子
    var sh = Math.max(0.15, 1 - (player.y - player.groundH) * 0.5);
    ctx.save();
    ctx.globalAlpha = 0.38 * sh;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, ground, 0.36 * s, 0.11 * s, 0, 0, 6.283);
    ctx.fill();
    ctx.restore();

    if (power.shield > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(108,216,255,.85)';
      ctx.fillStyle = 'rgba(108,216,255,.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, feet - 0.9 * s, 0.62 * s, 1.02 * s, 0, 0, 6.283);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    if (riding) drawScooterBody(player.x, pw, player.y + 0.02, 1);

    legThighMul = riding ? 0.5 : 1;
    legShinMul = riding ? 0.92 : 1;

    ctx.save();
    ctx.translate(x, feet + pose.bob * s - (riding ? 0.34 * s : 0));
    ctx.rotate(-player.lean * 0.2 + pose.pitch * 0.3);
    ctx.scale(1 + (1 - squash) * 0.45, squash);
    drawSkeleton(s, pose);
    ctx.restore();
    legThighMul = 1; legShinMul = 1;

    // 无敌闪烁
    if (invuln > 0 && state === 'play') {
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.25 * Math.sin(gameTime * 30);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, feet - 0.8 * s, 0.5 * s, 0.95 * s, 0, 0, 6.283);
      ctx.stroke();
      ctx.restore();
    }
  }

  function limb(x1, y1, x2, y2, w, color) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1216';
    ctx.lineWidth = w + Math.max(2, w * 0.26);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function drawSkeleton(u, p) {
    var hipY = -0.84 * u;
    var shoulderY = -1.30 * u;

    drawLeg(u, 1, hipY, p.hipR, p.kneeR);
    drawLeg(u, -1, hipY, p.hipL, p.kneeL);

    var g = ctx.createLinearGradient(0, shoulderY, 0, hipY);
    g.addColorStop(0, COL.jacket);
    g.addColorStop(1, COL.jacketDark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-0.13 * u, hipY + 0.02 * u);
    ctx.quadraticCurveTo(0, hipY + 0.07 * u, 0.13 * u, hipY + 0.02 * u);
    ctx.lineTo(0.19 * u, shoulderY + 0.08 * u);
    ctx.quadraticCurveTo(0, shoulderY - 0.02 * u, -0.19 * u, shoulderY + 0.08 * u);
    ctx.closePath();
    ctx.fill();

    drawArm(u, 1, shoulderY + 0.04 * u, p.armR);
    drawArm(u, -1, shoulderY + 0.04 * u, p.armL);

    rrect(-0.13 * u, shoulderY + 0.06 * u, 0.26 * u, 0.42 * u, 0.055 * u, COL.pack);
    rrect(-0.09 * u, hipY - 0.26 * u, 0.18 * u, 0.14 * u, 0.03 * u, 'rgba(255,255,255,.06)');
    ctx.strokeStyle = '#0b0d10';
    ctx.lineWidth = 0.045 * u;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.125 * u, shoulderY + 0.02 * u);
    ctx.lineTo(-0.15 * u, hipY - 0.30 * u);
    ctx.moveTo(0.125 * u, shoulderY + 0.02 * u);
    ctx.lineTo(0.15 * u, hipY - 0.30 * u);
    ctx.stroke();

    var hh = 0.48 * u * (curChar.headScale || 1);
    var hw = hh * aspect('head', 0.92);
    var hy = shoulderY - hh + 0.05 * u;
    var hx = (curChar.headOffsetX || 0) * hw;
    if (img.head.naturalWidth) {
      ctx.drawImage(img.head, hx - hw / 2, hy, hw, hh);
    } else {
      rrect(hx - hw / 2, hy, hw, hh, hw * 0.4, COL.pack);
    }
  }

  var legThighMul = 1, legShinMul = 1;

  function drawLeg(u, side, hipY, hipAng, kneeBend) {
    var hx = side * 0.075 * u;
    var a1 = side * hipAng;
    var kx = hx + Math.sin(a1) * 0.44 * u * legThighMul;
    var ky = hipY + Math.cos(a1) * 0.44 * u * legThighMul;

    var shinLen = 0.42 * u * (0.34 + 0.66 * Math.cos(kneeBend * 0.95)) * legShinMul;
    var a2 = a1 + side * (0.1 + kneeBend * 0.3);
    var fx = kx + Math.sin(a2) * shinLen;
    var fy = ky + Math.cos(a2) * shinLen;

    limb(kx, ky, fx, fy, 0.13 * u, COL.pantsDark);
    limb(hx, hipY, kx, ky, 0.16 * u, COL.pants);

    ctx.strokeStyle = COL.jacket;
    ctx.lineWidth = 0.022 * u;
    ctx.beginPath();
    ctx.moveTo(hx + side * 0.07 * u, hipY + 0.02 * u);
    ctx.lineTo(kx + side * 0.07 * u, ky);
    ctx.lineTo(fx + side * 0.055 * u, fy);
    ctx.stroke();

    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(a2 * 0.5);
    ctx.fillStyle = '#1a1216';
    ctx.beginPath();
    ctx.ellipse(side * 0.02 * u, 0.015 * u, 0.122 * u, 0.07 * u, 0, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = COL.shoe;
    ctx.beginPath();
    ctx.ellipse(side * 0.02 * u, 0.012 * u, 0.11 * u, 0.058 * u, 0, 0, 6.283);
    ctx.fill();
    ctx.restore();
  }

  function drawArm(u, side, shoulderY, swing) {
    var sx = side * 0.155 * u;
    var a1 = side * (0.1 + swing * 0.5);
    var ex = sx + Math.sin(a1) * 0.28 * u;
    var ey = shoulderY + Math.cos(a1) * 0.28 * u;
    var fore = 0.26 * u * (0.68 + 0.32 * Math.cos(swing * 1.8));
    var a2 = a1 - side * 0.18;
    var hx = ex + Math.sin(a2) * fore;
    var hy = ey + Math.cos(a2) * fore;

    limb(sx, shoulderY, ex, ey, 0.115 * u, COL.jacket);
    limb(ex, ey, hx, hy, 0.10 * u, COL.jacket);

    ctx.fillStyle = COL.skin;
    ctx.beginPath();
    ctx.arc(hx, hy, 0.048 * u, 0, 6.283);
    ctx.fill();
  }

  function rrect(x, y, w, h, r, fill) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawFog() {
    var g = ctx.createLinearGradient(0, horizon - 40, 0, horizon + 70);
    g.addColorStop(0, 'rgba(196, 100, 63, 0)');
    g.addColorStop(0.42, 'rgba(160, 86, 70, .42)');
    g.addColorStop(1, 'rgba(130, 70, 66, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon - 40, W, 110);
  }

  function drawSpeedFx() {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = 'rgba(255, 230, 190, .8)';
    for (var i = 0; i < 7; i++) {
      var side = i % 2 ? 1 : -1;
      var x = W / 2 + side * (W * 0.34 + Math.random() * W * 0.1);
      var y = Math.random() * H;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + side * 14, y + 40 + Math.random() * 50);
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    stage.classList.toggle('menu-mode', state === 'menu' || state === 'loading');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (view.shake > 0) {
      ctx.translate((Math.random() - 0.5) * view.shake * 10, (Math.random() - 0.5) * view.shake * 10);
    }
    drawSky();
    drawCity();
    drawRoad();
    drawItems();
    drawPlayer();
    drawParticles();
    drawFog();
    if (riding || power.boost > 0) drawSpeedFx();
    ctx.restore();
  }

  function aspect(name, fallback) {
    var im = img[name];
    if (!im || !im.naturalWidth || !im.naturalHeight) return fallback;
    return im.naturalWidth / im.naturalHeight;
  }

  /* ================= HUD / 界面 ================= */
  var buffsDirty = true;
  var hintTimer = 0;

  function el(id) { return document.getElementById(id); }

  function buildLives() {
    var box = el('lives');
    if (!box) return;
    box.innerHTML = '';
    for (var i = 0; i < CONFIG.lives; i++) box.appendChild(document.createElement('i'));
  }

  function updateHud() {
    var s = Math.floor(dist * 4) + score;
    var sc = el('score');
    if (sc && sc.textContent !== String(s)) sc.textContent = s;

    var hearts = el('lives') ? el('lives').children : [];
    for (var i = 0; i < hearts.length; i++) {
      hearts[i].classList.toggle('off', i >= lives);
    }
    if (buffsDirty) {
      buffsDirty = false;
      var html = '';
      if (riding) html += '<span class="buff scooter">🛵 ' + power.scooter.toFixed(1) + 's</span>';
      if (power.shield > 0) html += '<span class="buff shield">🛡 护盾</span>';
      if (power.boost > 0) html += '<span class="buff boost">🍗 ' + power.boost.toFixed(1) + 's</span>';
      var b = el('buffs');
      if (b) b.innerHTML = html;
    }
    // 每 0.1s 刷新一次倒计时
    if (riding || power.boost > 0) {
      var t = Math.floor(gameTime * 10);
      if (t % 3 === 0) buffsDirty = true;
    }
    if (hintTimer > 0) {
      hintTimer -= 1 / 60;
      if (hintTimer <= 0) el('hint').classList.add('hidden');
    }
  }

  function flashHint(text) {
    var h = el('hint');
    if (!h) return;
    h.textContent = text;
    h.classList.remove('hidden');
    hintTimer = 1.3;
  }

  function show(id, on) {
    var n = el(id);
    if (n) n.classList.toggle('hidden', !on);
  }

  var tutDone = false;

  function startRun() {
    if (loadedCount < 2) return;
    if (!tutDone && !localStorage.getItem('subway.tut')) {
      show('tutorial', true);
      return;
    }
    el('fade').classList.add('on');
    setTimeout(function () {
      resetRun();
      state = 'play';
      show('menu', false);
      show('over', false);
      show('board', false);
      show('tutorial', false);
      el('fade').classList.remove('on');
      last = 0;
      beep(680, 0.09, 'triangle', 0.05);
    }, 360);
  }

  function gameOver() {
    state = 'over';
    show('over', true);
    var finalScore = Math.floor(dist * 4) + score;
    if (finalScore > best) {
      best = finalScore;
      localStorage.setItem('subway.best', String(best));
    }
    el('finalScore').textContent = finalScore;
    el('finalFood').textContent = foodCount;
    el('overBest').textContent = best;
    el('best').textContent = best;
    el('nameInput').value = localStorage.getItem('subway.name') || CONFIG.name;
    el('submitBtn').disabled = false;
    el('submitHint').textContent = '';
    lastScore = finalScore;
    submitted = false;
  }

  var lastScore = 0, submitted = false;

  function pause() {
    if (state !== 'play') return;
    state = 'paused';
    show('pause', true);
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'play';
    show('pause', false);
    last = 0;
  }

  /* ================= 输入 ================= */
  var drag = null;

  function move(dir) {
    var t = player.lane + dir;
    if (t < -1 || t > 1) return;
    player.lane = t;
    beep(430 + Math.abs(t) * 60, 0.05, 'sine', 0.03);
  }

  function jump() {
    if (!player.grounded || player.roll > 0) return;
    player.vy = CONFIG.jumpV;
    player.grounded = false;
    beep(540, 0.09, 'sine', 0.045);
  }

  function roll() {
    if (!player.grounded) { player.vy = -16; return; }
    if (player.roll > 0) return;
    player.roll = CONFIG.rollTime;
    beep(300, 0.1, 'sine', 0.045);
  }

  function onSwipe(dx, dy) {
    if (state !== 'play') return;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (Math.abs(dx) > 24) move(dx > 0 ? 1 : -1);
    } else {
      if (dy < -24) jump();
      else if (dy > 24) roll();
    }
  }

  function bindInput() {
    cvs.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, used: false };
      if (state === 'paused') resume();
    }, { passive: true });

    cvs.addEventListener('pointermove', function (e) {
      if (!drag || drag.used || state !== 'play') return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) > 26 || Math.abs(dy) > 26) {
        drag.used = true;
        onSwipe(dx, dy);
      }
    }, { passive: true });

    cvs.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.used && Math.abs(dx) < 26 && Math.abs(dy) < 26 && state === 'play') jump();
      drag = null;
    }, { passive: true });

    cvs.addEventListener('pointercancel', function () { drag = null; }, { passive: true });

    window.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      var k = e.key;
      if (state === 'menu' || state === 'over') {
        if (k === 'Enter' || k === ' ' || k === 'Spacebar') { e.preventDefault(); startRun(); }
        return;
      }
      if (state === 'paused') { if (k === ' ' || k === 'Escape' || k === 'Enter') resume(); return; }
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { move(-1); e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { move(1); e.preventDefault(); }
      else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') { jump(); e.preventDefault(); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { roll(); e.preventDefault(); }
      else if (k === 'Escape') pause();
    });
  }

  /* ================= 排行榜 ================= */
  function lbURL(path) { return CONFIG.lb.base + '/' + CONFIG.lb.topic + path; }

  function lbFetch() {
    return fetch(lbURL('/json?poll=1&since=all&limit=300'), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) {
        var out = [];
        text.split('\n').forEach(function (line) {
          if (!line) return;
          try {
            var m = JSON.parse(line);
            if (m.event !== 'message') return;
            var d = JSON.parse(m.message);
            var name = String(d.n || '').trim().slice(0, 8);
            var sc = Math.floor(Number(d.s) || 0);
            if (!name || sc <= 0 || sc > 500000) return;
            out.push({ name: name, score: sc });
          } catch (e) { }
        });
        return out;
      });
  }

  function lbBest(items) {
    var map = {};
    items.forEach(function (e) {
      if (!map[e.name] || e.score > map[e.name].score) map[e.name] = e;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.score - a.score; }).slice(0, 20);
  }

  function lbSubmit(name, sc) {
    return fetch(lbURL(''), {
      method: 'POST',
      body: JSON.stringify({ n: name, s: sc, t: Date.now() }),
      headers: { 'Content-Type': 'text/plain' }
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return true; });
  }

  function renderBoard(items) {
    var list = el('boardList');
    var rows = lbBest(items);
    if (!rows.length) { list.innerHTML = '<li class="empty">还没有人上榜，抢个第一</li>'; return; }
    var html = '';
    rows.forEach(function (r, i) {
      html += '<li><span class="rank">' + (i + 1) + '</span><span class="nm"></span><span class="sc">' + r.score + '</span></li>';
    });
    list.innerHTML = html;
    var cells = list.querySelectorAll('.nm');
    rows.forEach(function (r, i) { if (cells[i]) cells[i].textContent = r.name; });
  }

  function loadBoard() {
    var list = el('boardList');
    list.innerHTML = '<li class="empty">加载中…</li>';
    lbFetch().then(renderBoard).catch(function () {
      list.innerHTML = '<li class="empty">连不上排行榜，稍后再试</li>';
    });
  }

  function submitScore() {
    if (submitted) return;
    var input = el('nameInput'), hint = el('submitHint'), btn = el('submitBtn');
    var name = (input.value || '').trim().slice(0, 8);
    if (!name) { hint.textContent = '先写个名字'; return; }
    var now = Date.now();
    if (now - Number(localStorage.getItem('subway.lbAt') || 0) < 20000) {
      hint.textContent = '刚传过，歇 20 秒再传';
      return;
    }
    btn.disabled = true;
    hint.textContent = '上传中…';
    localStorage.setItem('subway.name', name);
    lbSubmit(name, lastScore).then(function () {
      submitted = true;
      localStorage.setItem('subway.lbAt', String(now));
      hint.textContent = '已上榜';
      loadBoard();
    }).catch(function () {
      btn.disabled = false;
      hint.textContent = '上传失败，检查网络后重试';
    });
  }

  /* ================= 加载 / 启动 ================= */
  function updateLoadUI() {
    var fill = el('loadFill'), text = el('loadText');
    var pct = Math.min(100, Math.round(loadedCount / 2 * 100));
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = pct >= 100 ? '资源就绪' : '加载中… ' + pct + '%';
  }

  function syncSettingsUI() {
    el('setSfx').checked = sfxOn;
    el('setVib').checked = vibOn;
    el('setQuality').value = localStorage.getItem('subway.quality') || 'high';
  }

  function ready() {
    if (booted) return;
    booted = true;
    updateLoadUI();
    state = 'menu';
    buildLives();
    el('best').textContent = best;

    el('playBtn').addEventListener('click', function (e) { e.stopPropagation(); startRun(); });
    el('retryBtn').addEventListener('click', function (e) { e.stopPropagation(); startRun(); });
    el('boardBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      show('board', true);
      loadBoard();
    });
    el('boardClose').addEventListener('click', function (e) { e.stopPropagation(); show('board', false); });
    el('boardRefresh').addEventListener('click', function (e) { e.stopPropagation(); loadBoard(); });
    el('submitBtn').addEventListener('click', function (e) { e.stopPropagation(); submitScore(); });

    el('settingsBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      syncSettingsUI();
      show('settings', true);
    });
    el('settingsClose').addEventListener('click', function (e) { e.stopPropagation(); show('settings', false); });
    el('setSfx').addEventListener('change', function (e) {
      sfxOn = e.target.checked;
      localStorage.setItem('subway.sfx', sfxOn ? '1' : '0');
    });
    el('setVib').addEventListener('change', function (e) {
      vibOn = e.target.checked;
      localStorage.setItem('subway.vib', vibOn ? '1' : '0');
      if (vibOn) vibrate(20);
    });
    el('setQuality').addEventListener('change', function (e) {
      localStorage.setItem('subway.quality', e.target.value);
      resize();
    });

    el('helpBtn').addEventListener('click', function (e) { e.stopPropagation(); show('help', true); });
    el('helpClose').addEventListener('click', function (e) { e.stopPropagation(); show('help', false); });

    el('tutOk').addEventListener('click', function (e) {
      e.stopPropagation();
      tutDone = true;
      localStorage.setItem('subway.tut', '1');
      show('tutorial', false);
      startRun();
    });

    el('mute').addEventListener('click', function (e) {
      e.stopPropagation();
      sfxOn = !sfxOn;
      localStorage.setItem('subway.sfx', sfxOn ? '1' : '0');
      e.currentTarget.textContent = sfxOn ? '🔊' : '🔇';
    });
    el('mute').textContent = sfxOn ? '🔊' : '🔇';

    el('pause').addEventListener('click', function () { resume(); });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
    });

    resize();
    bindInput();
    if (location.search.indexOf('auto=1') >= 0) {
      setTimeout(startRun, 400);
    }
  }

  /* ================= 主循环 ================= */
  var last = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!freeze) update(dt);
    render();
  }

  requestAnimationFrame(frame);

  /* ================= 引导启动 ================= */
  curChar = pickCharacter();
  img.face.onload = onAsset;
  img.head.onload = onAsset;
  img.face.onerror = onAsset;
  img.head.onerror = onAsset;
  applyCharacter(curChar, false);
  setTimeout(ready, 3000);

  // 调试入口
  window.__subway = {
    config: CONFIG, world: world, player: player,
    get state() { return state; },
    start: startRun, jump: jump, roll: roll, move: move,
    lbBest: lbBest, rig: rig, freeze: function (v) { freeze = v; },
    get dist() { return dist; }, get speed() { return speed; },
    get lives() { return lives; }, get power() { return power; },
    get riding() { return riding; }, get score() { return Math.floor(dist * 4) + score; }
  };
})();
