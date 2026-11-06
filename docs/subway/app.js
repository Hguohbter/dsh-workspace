/* 胖虎快跑 —— 白天街道 + 学校的轻量跑酷
 * 世界坐标：x 车道方向（1 = 一条车道宽），y 高度，z 深度（越大越远）
 * 相机固定在原点上方看向 +z；玩家固定在 z = playerZ，物体朝相机移动。
 */
(function () {
  'use strict';

  /* ================= 配置 ================= */
  var CFG = {
    title: '胖虎快跑',
    laneW: 1.0,
    roadHalf: 1.9,
    playerZ: 3.4,
    playerH: 1.78,
    camH: 3.6,
    zFar: 90,
    jumpV: 7.6,
    gravity: 23,
    rollTime: 0.55,
    speedMin: 8,
    speedMax: 18,
    powerChance: 0.16,
    // 在线排行榜：ntfy.sh 的公共 topic，零注册零配置；12 小时自动过期
    lb: { base: 'https://ntfy.sh', topic: 'subway-hero-2026-x7k2' }
  };

  /* 角色表：加新同学就在这里加一条（详见 README） */
  var CHARACTERS = [
    {
      id: 'panghu',
      name: '胖虎',
      face: 'assets/panghu-face.webp',
      head: 'assets/panghu-head.webp',
      headScale: 1,      // 头整体缩放
      headOffsetX: 0,    // 头左右微调（占头宽的比例，0.05 = 向右 5% 头宽）
      colors: {
        jacket: '#8a3350', jacketDark: '#5f2036',
        pants: '#2f3240', pantsDark: '#23262f',
        shoe: '#1b2025', skin: '#c9968f', pack: '#15181c'
      }
    }
  ];

  /* 白天街道配色 */
  var PAL = {
    skyTop: '#4fa6dd', skyMid: '#9ed6f2', skyLow: '#e9f6fd',
    cloud: 'rgba(255,255,255,.85)',
    bldgFar: '#b3c4d3', bldgNear: '#a4b6c6', win: 'rgba(255,255,255,.55)',
    school: '#e8eef3', schoolRoof: '#c0563f', schoolWin: 'rgba(120,170,200,.55)',
    road: '#4d5762', roadFar: '#586470',
    walk: '#9fa9b5', curb: '#dbe3ea',
    line: 'rgba(255,255,255,.85)',
    trunk: '#7a5334', leaf: '#4f9f61', leafDark: '#3c7f4a',
    pole: '#5d6874', lamp: 'rgba(255,240,190,.95)'
  };

  var COL = CHARACTERS[0].colors;   // 当前角色配色，切换角色时更新

  /* ================= 画布与视图 ================= */
  var stage = document.getElementById('stage');
  var cvs = document.getElementById('game');
  var ctx = cvs.getContext('2d');

  var W = 0, H = 0, F = 1, horizon = 0, skyGrad = null;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = stage.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    F = Math.min(W * 1.05, H * 0.58);
    horizon = H * 0.30;
    skyGrad = null;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });

  function px(x, z) { return W / 2 + (x * F) / z; }
  function py(y, z) { return horizon + ((CFG.camH - y) * F) / z; }

  /* ================= 角色 ================= */
  var img = { face: new Image(), head: new Image() };
  var loadedCount = 0;
  var booted = false;

  function onAsset() {
    loadedCount++;
    if (loadedCount >= 2) ready();
  }

  function applyCharacter(ch, persist) {
    CFG.name = ch.name;
    COL = ch.colors;
    curChar = ch;
    img.face.src = ch.face;
    img.head.src = ch.head;
    if (persist) localStorage.setItem('subway.char', ch.id);
    var f1 = document.getElementById('startFace');
    var f2 = document.getElementById('overFace');
    var n1 = document.getElementById('startName');
    var n2 = document.getElementById('overName');
    if (f1) f1.src = ch.face;
    if (f2) f2.src = ch.face;
    if (n1) n1.textContent = ch.name;
    if (n2) n2.textContent = ch.name;
  }

  function pickCharacter() {
    var want = localStorage.getItem('subway.char');
    var m = /[?&]c=([a-z0-9_-]+)/i.exec(location.search);
    if (m) { want = m[1]; localStorage.setItem('subway.char', want); }
    for (var i = 0; i < CHARACTERS.length; i++) {
      if (CHARACTERS[i].id === want) return CHARACTERS[i];
    }
    return CHARACTERS[0];
  }

  var curChar = CHARACTERS[0];

  /* ================= 状态 ================= */
  var game = {
    state: 'menu',       // menu | play | over | paused
    t: 0,
    dist: 0,
    speed: CFG.speedMin,
    coins: 0,
    best: Number(localStorage.getItem('subway.best') || 0),
    shake: 0,
    invuln: 0,
    freeze: false,
    power: { magnet: 0, shield: 0, boost: 0 },
    objs: [],
    parts: [],
    nextSpawnAt: 40,
    lastScore: 0,
    lastCoins: 0,
    submitted: false
  };

  var player = { lane: 0, x: 0, y: 0, vy: 0, roll: 0, lean: 0 };
  var rig = { phase: 0 };

  function reset() {
    game.t = 0;
    game.dist = 0;
    game.speed = CFG.speedMin;
    game.coins = 0;
    game.shake = 0;
    game.invuln = 0;
    game.power.magnet = 0;
    game.power.shield = 0;
    game.power.boost = 0;
    game.objs = [];
    game.parts = [];
    game.nextSpawnAt = 40;   // 开局先给 4 秒左右的空跑道
    game.submitted = false;
    rig.phase = 0;
    player.lane = 0;
    player.x = 0;
    player.y = 0;
    player.vy = 0;
    player.roll = 0;
    player.lean = 0;
  }

  /* ================= 音效 ================= */
  var actx = null;
  var sfxOn = localStorage.getItem('subway.sfx') !== '0';

  function beep(freq, dur, type, vol) {
    if (!sfxOn) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.05, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g);
      g.connect(actx.destination);
      o.start();
      o.stop(actx.currentTime + dur);
    } catch (e) { /* 静默失败 */ }
  }

  /* ================= 物体定义 ================= */
  var OBJ = {
    barrier: { w: 0.86, h: 0.62, d: 0.5, top: '#f0912e', front: '#e8641f', edge: '#fff3d6' },
    bar: { w: 0.94, h: 1.0, y: 1.15, d: 0.45, top: '#c8323f', front: '#a8263a', edge: '#ffd0d6' },
    block: { w: 0.94, h: 2.35, d: 2.8, top: '#f2b632', front: '#e2a720', edge: '#fff3cb' },
    coin: { r: 0.3, y: 0.75 }
  };

  var POWERS = {
    magnet: { dur: 8, color: '#ff6f91', label: '磁铁' },
    shield: { dur: 0, color: '#54d6ff', label: '护盾' },
    boost: { dur: 4.5, color: '#ffd75e', label: '加速' }
  };
  var POWER_KINDS = ['magnet', 'shield', 'boost'];

  function rnd(n) { return Math.floor(Math.random() * n); }

  function push(type, lane, z, extra) {
    var o = { type: type, lane: lane, x: lane * CFG.laneW, z: z, dead: false, spin: Math.random() * 6.28 };
    if (extra) for (var k in extra) o[k] = extra[k];
    game.objs.push(o);
  }

  function coinLine(lane, z, n, step) {
    for (var i = 0; i < n; i++) push('coin', lane, z + i * (step || 1.15));
  }

  function otherLane(l) {
    var pool = [-1, 0, 1].filter(function (v) { return v !== l; });
    return pool[rnd(pool.length)];
  }

  function spawnPattern(z) {
    var r = Math.random();
    var free = 0;

    if (r < 0.20) {
      // 需要翻滚的横杆（校门口挂的横幅）
      var l = rnd(3) - 1;
      push('bar', l, z);
      coinLine(l, z - 4.2, 3, 1.0);
      free = otherLane(l);
    } else if (r < 0.42) {
      // 单个路障：跳过去
      l = rnd(3) - 1;
      push('barrier', l, z);
      coinLine(l === 0 ? 1 : 0, z, 3);
      free = otherLane(l);
    } else if (r < 0.60) {
      // 两个路障，留一条道
      free = rnd(3) - 1;
      for (var i = 0; i < 3; i++) if (i - 1 !== free) push('barrier', i - 1, z);
      coinLine(free, z, 3);
    } else if (r < 0.78) {
      // 校车（整道封死，必须换道）
      l = rnd(3) - 1;
      push('block', l, z + 1.4);
      coinLine(l === 0 ? 1 : 0, z, 4, 1.25);
      free = otherLane(l);
    } else if (r < 0.90) {
      // 跳跃吃金币弧线
      l = rnd(3) - 1;
      push('barrier', l, z);
      for (var j = 0; j < 5; j++) {
        var t = (j - 2) / 2;
        push('coin', l, z + j * 0.95, { y: 0.75 + 0.85 * (1 - t * t) });
      }
      free = otherLane(l);
    } else {
      // 两辆校车夹一条道
      free = rnd(3) - 1;
      for (var k = 0; k < 3; k++) if (k - 1 !== free) push('block', k - 1, z + 1.5);
    }

    // 偶尔在空道上放个道具
    if (Math.random() < CFG.powerChance) {
      push('power', free, z + 2.2, { kind: POWER_KINDS[rnd(POWER_KINDS.length)], y: 0.95 });
    }
  }

  /* ================= 主循环 ================= */
  var last = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!game.freeze) update(dt);
    render();
  }

  function update(dt) {
    game.t += dt;
    rig.phase += dt * (5.0 + game.speed * 0.7);
    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 2.4);

    if (game.state === 'menu') {
      game.dist += 5 * dt;     // 菜单里背景照样跑
      return;
    }
    if (game.state !== 'play') return;

    if (game.power.magnet > 0) game.power.magnet = Math.max(0, game.power.magnet - dt);
    if (game.power.boost > 0) game.power.boost = Math.max(0, game.power.boost - dt);
    if (game.invuln > 0) game.invuln = Math.max(0, game.invuln - dt);

    game.speed = Math.min(CFG.speedMax, CFG.speedMin + game.dist * 0.012);
    var moveSpeed = game.speed * (game.power.boost > 0 ? 1.55 : 1);
    game.dist += moveSpeed * dt;

    // 玩家
    if (player.roll > 0) player.roll = Math.max(0, player.roll - dt);
    if (player.y > 0 || player.vy > 0) {
      player.vy -= CFG.gravity * dt;
      player.y += player.vy * dt;
      if (player.y <= 0) { player.y = 0; player.vy = 0; }
    }
    var tx = player.lane * CFG.laneW;
    var k = 1 - Math.exp(-dt * 15);
    player.x += (tx - player.x) * k;
    player.lean += ((tx - player.x) * 2.2 - player.lean) * (1 - Math.exp(-dt * 12));

    // 物体
    var PZC = CFG.playerZ;
    for (var i = 0; i < game.objs.length; i++) {
      var o = game.objs[i];
      var prev = o.z;
      o.z -= moveSpeed * dt;

      // 磁铁：把附近金币吸过来
      if (o.type === 'coin' && game.power.magnet > 0 && o.z > 1.2 && o.z < PZC + 9) {
        o.x += (player.x - o.x) * Math.min(1, dt * 6);
      }

      if (!o.dead && prev > PZC && o.z <= PZC) {
        if (o.type === 'coin') collectCoin(o);
        else if (o.type === 'power') pickPower(o);
        else hitTest(o);
      }
      if (o.z < 0.9) o.dead = true;
    }
    for (var q = game.objs.length - 1; q >= 0; q--) {
      if (game.objs[q].dead) game.objs.splice(q, 1);
    }

    // 生成：nextSpawnAt 存的是“绝对里程”，再换算成相对相机的 z
    while (game.nextSpawnAt - game.dist < CFG.zFar) {
      spawnPattern(game.nextSpawnAt - game.dist);
      game.nextSpawnAt += Math.max(10, game.speed * 0.8) - Math.random() * 2;
    }

    // 粒子
    for (var p = game.parts.length - 1; p >= 0; p--) {
      var pt = game.parts[p];
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy -= 9 * dt;
      if (pt.life <= 0) game.parts.splice(p, 1);
    }

    syncHud();
  }

  function hitTest(o) {
    if (game.invuln > 0) return;
    if (Math.abs(player.x - o.x) > 0.52) return;
    if (o.type === 'barrier' && player.y >= 0.55) return;   // 跳过矮栏
    if (o.type === 'bar' && player.roll > 0) return;        // 滚过横杆
    if (o.type === 'block' && player.y > 2.3) return;

    if (game.power.boost > 0) {          // 冲刺时直接撞飞
      o.dead = true;
      burst(px(o.x, o.z), py(0.8, o.z), '#ffd75e', 8);
      return;
    }
    if (game.power.shield > 0) {
      game.power.shield = 0;
      game.invuln = 1.2;
      o.dead = true;
      game.shake = 0.5;
      beep(880, 0.16, 'sine', 0.06);
      burst(px(player.x, CFG.playerZ), py(player.y + 0.9, CFG.playerZ), '#54d6ff', 14);
      syncHud();
      return;
    }
    crash();
  }

  function collectCoin(o) {
    var needJump = (o.y || OBJ.coin.y) > 0.95;
    if (needJump && player.y < 0.4) return;
    if (Math.abs(player.x - o.x) > 0.6) return;
    o.dead = true;
    game.coins++;
    beep(1180 + Math.random() * 220, 0.07, 'triangle', 0.045);
    burst(px(o.x, o.z), py(o.y || OBJ.coin.y, o.z), '#ffd75e', 5);
  }

  function pickPower(o) {
    if (Math.abs(player.x - o.x) > 0.65) return;
    if (player.y > 1.2) return;
    o.dead = true;
    var def = POWERS[o.kind];
    if (o.kind === 'shield') game.power.shield = 1;
    else game.power[o.kind] = def.dur;
    beep(o.kind === 'boost' ? 880 : o.kind === 'magnet' ? 660 : 990, 0.16, 'triangle', 0.06);
    burst(px(o.x, o.z), py(o.y, o.z), def.color, 12);
    syncHud();
  }

  function crash() {
    game.state = 'over';
    game.shake = 1;
    beep(150, 0.32, 'sawtooth', 0.07);
    burst(px(player.x, CFG.playerZ), py(player.y + 0.9, CFG.playerZ), '#ff5d8f', 16);
    var score = scoreNow();
    if (score > game.best) {
      game.best = score;
      localStorage.setItem('subway.best', String(score));
    }
    document.getElementById('finalScore').textContent = score;
    document.getElementById('finalCoin').textContent = game.coins;
    document.getElementById('overBest').textContent = game.best;
    document.getElementById('over').classList.remove('hidden');
    document.getElementById('best').textContent = game.best;

    game.lastScore = score;
    game.lastCoins = game.coins;
    game.submitted = false;
    document.getElementById('nameInput').value = localStorage.getItem('subway.name') || CFG.name;
    document.getElementById('submitBtn').disabled = false;
    document.getElementById('submitHint').textContent = '';
  }

  function scoreNow() {
    return Math.floor(game.dist * 4) + game.coins * 15;
  }

  function burst(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283;
      var sp = 60 + Math.random() * 220;
      game.parts.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.7 + 60,
        life: 0.35 + Math.random() * 0.4,
        max: 0.75,
        color: color,
        size: 2 + Math.random() * 3
      });
    }
  }

  var lastChips = null;

  function syncHud() {
    var s = scoreNow();
    var el = document.getElementById('score');
    if (el.textContent !== String(s)) el.textContent = s;
    var c = document.getElementById('coin');
    if (c.textContent !== String(game.coins)) c.textContent = game.coins;

    var chips = '';
    if (game.power.boost > 0) {
      chips += '<span class="chip boost">加速 ' + game.power.boost.toFixed(1) + 's</span>';
    }
    if (game.power.magnet > 0) {
      chips += '<span class="chip magnet">磁铁 ' + game.power.magnet.toFixed(1) + 's</span>';
    }
    if (game.power.shield > 0) chips += '<span class="chip shield">护盾</span>';
    if (chips !== lastChips) {
      lastChips = chips;
      var box = document.getElementById('powerups');
      if (box) box.innerHTML = chips;
    }
  }

  /* ================= 渲染 ================= */
  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (game.shake > 0) {
      ctx.translate((Math.random() - 0.5) * game.shake * 14, (Math.random() - 0.5) * game.shake * 14);
    }

    drawSky();
    drawBackdrop();
    drawRoad();
    drawScenery();

    var list = game.objs.slice();
    list.push({ type: 'player', z: CFG.playerZ });
    list.sort(function (a, b) { return b.z - a.z; });

    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.z < 1.0) continue;
      if (o.type === 'player') drawPlayer();
      else if (o.type === 'coin') drawCoin(o);
      else if (o.type === 'power') drawPower(o);
      else drawBlock(o);
    }

    drawParts();
    if (game.power.boost > 0) drawBoostFx();
    ctx.restore();
  }

  function drawSky() {
    if (!skyGrad) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, horizon + 40);
      skyGrad.addColorStop(0, PAL.skyTop);
      skyGrad.addColorStop(0.62, PAL.skyMid);
      skyGrad.addColorStop(1, PAL.skyLow);
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, horizon + 2);

    // 太阳
    var sx = W * 0.78, sy = horizon * 0.38, sr = Math.max(26, W * 0.075);
    var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.6);
    g.addColorStop(0, 'rgba(255, 250, 215, .95)');
    g.addColorStop(0.35, 'rgba(255, 240, 170, .45)');
    g.addColorStop(1, 'rgba(255, 240, 170, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy, sr * 2.6, 0, 6.283); ctx.fill();

    // 云
    if (!cloudSeeds.length) {
      for (var i = 0; i < 7; i++) {
        cloudSeeds.push({ x: Math.random(), y: 0.12 + Math.random() * 0.45, s: 0.55 + Math.random() * 0.8 });
      }
    }
    for (var c = 0; c < cloudSeeds.length; c++) {
      var cl = cloudSeeds[c];
      var span = W + 260;
      var cx = ((cl.x * span - game.dist * 5 * cl.s) % span + span) % span - 130;
      drawCloud(cx, cl.y * horizon, 34 * cl.s);
    }
  }

  var cloudSeeds = [];

  function drawCloud(x, y, r) {
    ctx.fillStyle = PAL.cloud;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, 6.283);
    ctx.arc(x + r * 0.7, y + r * 0.1, r * 0.42, 0, 6.283);
    ctx.arc(x - r * 0.7, y + r * 0.12, r * 0.4, 0, 6.283);
    ctx.arc(x + r * 0.1, y - r * 0.3, r * 0.45, 0, 6.283);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 远处楼群 + 尽头的学校主楼
  function drawBackdrop() {
    var off = (game.dist * 3) % 720;
    var baseY = horizon + 2;
    for (var i = 0; i < 10; i++) {
      var seed = i * 41.3;
      var bw = 46 + Math.abs(Math.sin(seed)) * 56;
      var bh = 34 + Math.abs(Math.sin(seed * 1.7)) * 66;
      var x = ((i * 78 - off) % 780 + 780) % 780 - 100;
      ctx.fillStyle = i % 2 ? PAL.bldgFar : PAL.bldgNear;
      ctx.fillRect(x, baseY - bh, bw, bh);
      ctx.fillStyle = PAL.win;
      for (var r = 0; r < 3; r++) {
        for (var col = 0; col < 3; col++) {
          if ((r + col + i) % 3 === 0) continue;
          ctx.fillRect(x + 6 + col * (bw / 3.4), baseY - bh + 8 + r * (bh / 4), bw / 6.5, bh / 8);
        }
      }
    }

    // 学校主楼（正对跑道尽头）
    var sw = Math.min(W * 0.58, 260);
    var sh = horizon * 0.46;
    var sx0 = W / 2 - sw / 2;
    var sy0 = baseY - sh;
    ctx.fillStyle = PAL.school;
    ctx.fillRect(sx0, sy0, sw, sh);
    ctx.fillStyle = PAL.schoolRoof;
    ctx.fillRect(sx0 - 5, sy0 - 6, sw + 10, 7);
    // 时钟
    ctx.fillStyle = '#f5f7f9';
    ctx.beginPath(); ctx.arc(W / 2, sy0 + 10, 7, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#8b98a6';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(W / 2, sy0 + 10);
    ctx.lineTo(W / 2, sy0 + 5);
    ctx.moveTo(W / 2, sy0 + 10);
    ctx.lineTo(W / 2 + 4, sy0 + 11);
    ctx.stroke();
    // 窗户
    ctx.fillStyle = PAL.schoolWin;
    for (var rr = 0; rr < 2; rr++) {
      for (var cc = 0; cc < 6; cc++) {
        ctx.fillRect(sx0 + 14 + cc * (sw - 28) / 6, sy0 + 22 + rr * (sh - 36) / 2,
          (sw - 28) / 6 - 8, (sh - 36) / 2 - 8);
      }
    }
    // 校门：两根门柱 + 门楣
    var gw = sw * 0.34, gx = W / 2 - gw / 2, gt = baseY - sh * 0.5;
    ctx.fillStyle = '#dfe6ec';
    ctx.fillRect(gx - 12, gt, 12, baseY - gt);
    ctx.fillRect(gx + gw, gt, 12, baseY - gt);
    ctx.fillStyle = '#c0563f';
    ctx.fillRect(gx - 14, gt - 9, gw + 28, 9);
  }

  function roadQuad(x0, x1, z0, z1, fill) {
    ctx.beginPath();
    ctx.moveTo(px(x0, z0), py(0, z0));
    ctx.lineTo(px(x1, z0), py(0, z0));
    ctx.lineTo(px(x1, z1), py(0, z1));
    ctx.lineTo(px(x0, z1), py(0, z1));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawRoad() {
    var rh = CFG.roadHalf;
    // 人行道底色
    ctx.fillStyle = PAL.walk;
    ctx.fillRect(0, horizon, W, H - horizon);

    // 沥青路
    roadQuad(-rh, rh, 1.0, CFG.zFar, PAL.road);
    // 路缘
    roadQuad(-rh - 0.16, -rh, 1.0, CFG.zFar, PAL.curb);
    roadQuad(rh, rh + 0.16, 1.0, CFG.zFar, PAL.curb);

    // 人行道横缝
    var seamStep = 2.6;
    var seamOff = game.dist % seamStep;
    for (var z = 0.5 - seamOff; z < CFG.zFar; z += seamStep) {
      var z0 = Math.max(z, 0.5), z1 = z + 0.12;
      if (z1 <= 0.5) continue;
      roadQuad(-rh - 2.6, -rh - 0.16, z0, z1, 'rgba(255,255,255,.10)');
      roadQuad(rh + 0.16, rh + 2.6, z0, z1, 'rgba(255,255,255,.10)');
    }

    // 路面横向色带（速度感）
    var tieStep = 2.4;
    var tieOff = game.dist % tieStep;
    for (var t = 0.5 - tieOff; t < CFG.zFar; t += tieStep) {
      var t0 = Math.max(t, 0.5), t1 = t + 0.3;
      if (t1 <= 0.5) continue;
      roadQuad(-rh, rh, t0, t1, 'rgba(255,255,255,.045)');
    }

    // 车道虚线
    var dashStep = 1.6;
    var dashOff = game.dist % dashStep;
    for (var d = 0.5 - dashOff; d < CFG.zFar; d += dashStep) {
      var d0 = Math.max(d, 0.5), d1 = d + 0.82;
      if (d1 <= 0.5) continue;
      roadQuad(-0.535, -0.465, d0, d1, PAL.line);
      roadQuad(0.465, 0.535, d0, d1, PAL.line);
    }

    // 边线
    roadQuad(-rh + 0.04, -rh + 0.11, 1.0, CFG.zFar, 'rgba(255,255,255,.7)');
    roadQuad(rh - 0.11, rh - 0.04, 1.0, CFG.zFar, 'rgba(255,255,255,.7)');

    // 地平线附近的淡雾，让远处不那么生硬
    var g = ctx.createLinearGradient(0, horizon - 18, 0, horizon + 26);
    g.addColorStop(0, 'rgba(232, 246, 253, 0)');
    g.addColorStop(0.55, 'rgba(232, 246, 253, .55)');
    g.addColorStop(1, 'rgba(232, 246, 253, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon - 18, W, 44);
  }

  // 路灯 + 行道树
  function drawScenery() {
    var step = 7;
    var off = game.dist % step;
    for (var z = 3.4 - off; z < 62; z += step) {
      if (z < 2.8) continue;
      drawLamp(-(CFG.roadHalf + 0.9), z);
      drawTree(CFG.roadHalf + 1.0, z + step * 0.5);
    }
  }

  function drawLamp(x, z) {
    var h = 3.0;
    poly3([[x - 0.07, 0, z], [x + 0.07, 0, z], [x + 0.07, h, z], [x - 0.07, h, z]], PAL.pole);
    poly3([[x - 0.07, h - 0.5, z], [x - 0.55, h - 0.5, z], [x - 0.55, h - 0.42, z], [x - 0.07, h - 0.42, z]], PAL.pole);
    var lx = px(x - 0.5, z), ly = py(h - 0.5, z);
    var r = Math.max(1.4, 0.09 * (F / z));
    ctx.fillStyle = PAL.lamp;
    ctx.beginPath(); ctx.arc(lx, ly, r, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 0.16;
    ctx.beginPath(); ctx.arc(lx, ly, r * 2.6, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawTree(x, z) {
    var s = F / z;
    poly3([[x - 0.09, 0, z], [x + 0.09, 0, z], [x + 0.09, 1.0, z], [x - 0.09, 1.0, z]], PAL.trunk);
    var cx = px(x, z), cy = py(1.55, z), r = Math.max(1.5, 0.55 * s);
    ctx.fillStyle = PAL.leafDark;
    ctx.beginPath(); ctx.arc(cx - r * 0.4, cy + r * 0.1, r * 0.72, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * 0.4, cy + r * 0.05, r * 0.68, 0, 6.283); ctx.fill();
    ctx.fillStyle = PAL.leaf;
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.35, r * 0.82, 0, 6.283); ctx.fill();
  }

  function poly3(pts, fill) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var sx = px(p[0], p[2]);
      var sy = py(p[1], p[2]);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawBlock(o) {
    var c = OBJ[o.type];
    if (!c) return;
    var baseY = c.y || 0;
    var topY = baseY + c.h;
    var zn = Math.max(1.02, o.z - c.d / 2);
    var zf = o.z + c.d / 2;
    var x0 = o.x - c.w / 2;
    var x1 = o.x + c.w / 2;

    // 影子
    ctx.save();
    ctx.globalAlpha = 0.28;
    poly3([[x0 * 1.05, 0, zn], [x1 * 1.05, 0, zn], [x1 * 1.05, 0, zf], [x0 * 1.05, 0, zf]], '#000');
    ctx.restore();

    // 顶面
    poly3([[x0, topY, zn], [x1, topY, zn], [x1, topY, zf], [x0, topY, zf]], c.top);

    if (o.type === 'bar') {
      var pw = 0.1;
      poly3([[x0, 0, zn], [x0 + pw, 0, zn], [x0 + pw, topY, zn], [x0, topY, zn]], '#7c8794');
      poly3([[x1 - pw, 0, zn], [x1, 0, zn], [x1, topY, zn], [x1 - pw, topY, zn]], '#7c8794');
    } else if (o.x > 0.05) {
      poly3([[x0, baseY, zn], [x0, baseY, zf], [x0, topY, zf], [x0, topY, zn]], shade(c.front, 0.82));
    } else if (o.x < -0.05) {
      poly3([[x1, baseY, zn], [x1, baseY, zf], [x1, topY, zf], [x1, topY, zn]], shade(c.front, 0.82));
    }

    // 正面
    poly3([[x0, baseY, zn], [x1, baseY, zn], [x1, topY, zn], [x0, topY, zn]], c.front);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px(x0, zn), py(baseY, zn));
    ctx.lineTo(px(x1, zn), py(baseY, zn));
    ctx.lineTo(px(x1, zn), py(topY, zn));
    ctx.lineTo(px(x0, zn), py(topY, zn));
    ctx.closePath();
    ctx.stroke();

    if (o.type === 'block') {
      // 校车车窗
      var wy0 = baseY + c.h * 0.52, wy1 = baseY + c.h * 0.8;
      poly3([[x0 * 0.86, wy0, zn - 0.01], [x1 * 0.86, wy0, zn - 0.01],
        [x1 * 0.86, wy1, zn - 0.01], [x0 * 0.86, wy1, zn - 0.01]], '#bfe0f2');
      // 车身腰线
      poly3([[x0, baseY + c.h * 0.16, zn - 0.01], [x1, baseY + c.h * 0.16, zn - 0.01],
        [x1, baseY + c.h * 0.2, zn - 0.01], [x0, baseY + c.h * 0.2, zn - 0.01]], 'rgba(90,60,10,.5)');
    }
    if (o.type === 'barrier') {
      var hh = baseY + c.h * 0.42;
      poly3([[x0 * 0.98, hh, zn - 0.01], [x1 * 0.98, hh, zn - 0.01],
        [x1 * 0.98, hh + c.h * 0.2, zn - 0.01], [x0 * 0.98, hh + c.h * 0.2, zn - 0.01]], 'rgba(255,255,255,.85)');
    }
  }

  var shadeCache = {};
  function shade(hex, k) {
    var key = hex + k;
    if (shadeCache[key]) return shadeCache[key];
    var n = parseInt(hex.slice(1), 16);
    var out = 'rgb(' + Math.round(((n >> 16) & 255) * k) + ',' +
      Math.round(((n >> 8) & 255) * k) + ',' + Math.round((n & 255) * k) + ')';
    shadeCache[key] = out;
    return out;
  }

  function drawCoin(o) {
    var s = F / o.z;
    var cx = px(o.x, o.z);
    var cy = py(o.y || OBJ.coin.y, o.z);
    var r = OBJ.coin.r * s;
    var wob = Math.abs(Math.cos(game.t * 5 + o.spin));
    var rx = Math.max(r * 0.42, r * wob);

    var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.9);
    glow.addColorStop(0, 'rgba(255, 210, 90, .28)');
    glow.addColorStop(1, 'rgba(255, 210, 90, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.9, 0, 6.283); ctx.fill();

    var g = ctx.createLinearGradient(cx - rx, cy - r, cx + rx, cy + r);
    g.addColorStop(0, '#fff2b0');
    g.addColorStop(0.5, '#ffc93c');
    g.addColorStop(1, '#c98a12');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, r, 0, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 250, 210, .85)';
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.stroke();
  }

  function drawPower(o) {
    var def = POWERS[o.kind];
    if (!def) return;
    var s = F / o.z;
    var cx = px(o.x, o.z);
    var cy = py(o.y || 0.95, o.z);
    var r = 0.26 * s;
    var pulse = 1 + Math.sin(game.t * 4 + o.spin) * 0.06;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);

    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
    g.addColorStop(0, hexA(def.color, 0.5));
    g.addColorStop(1, hexA(def.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, 6.283); ctx.fill();

    ctx.fillStyle = '#10202b';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, 6.283); ctx.fill();

    drawPowerIcon(o.kind, r * 0.62);
    ctx.restore();
  }

  function drawPowerIcon(kind, r) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (kind === 'magnet') {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = r * 0.42;
      ctx.beginPath();
      ctx.arc(0, 0.05 * r, r * 0.62, Math.PI, 0);
      ctx.moveTo(-r * 0.62, 0.05 * r);
      ctx.lineTo(-r * 0.62, r * 0.72);
      ctx.moveTo(r * 0.62, 0.05 * r);
      ctx.lineTo(r * 0.62, r * 0.72);
      ctx.stroke();
      ctx.strokeStyle = '#e8375f';
      ctx.lineWidth = r * 0.22;
      ctx.beginPath();
      ctx.moveTo(-r * 0.62, r * 0.45);
      ctx.lineTo(-r * 0.62, r * 0.72);
      ctx.moveTo(r * 0.62, r * 0.45);
      ctx.lineTo(r * 0.62, r * 0.72);
      ctx.stroke();
    } else if (kind === 'shield') {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.85);
      ctx.lineTo(r * 0.72, -r * 0.5);
      ctx.lineTo(r * 0.72, r * 0.1);
      ctx.quadraticCurveTo(r * 0.7, r * 0.7, 0, r * 0.95);
      ctx.quadraticCurveTo(-r * 0.7, r * 0.7, -r * 0.72, r * 0.1);
      ctx.lineTo(-r * 0.72, -r * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1a8cc0';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.5);
      ctx.lineTo(r * 0.42, -r * 0.3);
      ctx.lineTo(r * 0.42, r * 0.1);
      ctx.quadraticCurveTo(r * 0.4, r * 0.45, 0, r * 0.6);
      ctx.quadraticCurveTo(-r * 0.4, r * 0.45, -r * 0.42, r * 0.1);
      ctx.lineTo(-r * 0.42, -r * 0.3);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(r * 0.15, -r * 0.9);
      ctx.lineTo(-r * 0.55, r * 0.12);
      ctx.lineTo(-r * 0.05, r * 0.12);
      ctx.lineTo(-r * 0.15, r * 0.9);
      ctx.lineTo(r * 0.6, -r * 0.16);
      ctx.lineTo(r * 0.06, -r * 0.16);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function drawBoostFx() {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(255, 245, 190, .9)';
    for (var i = 0; i < 6; i++) {
      var x = (i % 2 ? 1 : -1) * (W * 0.32 + Math.random() * W * 0.18);
      var y = Math.random() * H;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(W / 2 + x, y);
      ctx.lineTo(W / 2 + x * 1.08, y + 26 + Math.random() * 30);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- 角色：照片脑袋 + 程序化骨骼 ---------- */
  function poseRunner() {
    var ph = rig.phase;
    var a = Math.sin(ph), b = Math.sin(ph + Math.PI);
    var p = {
      hipL: 0.07 * a, kneeL: 1.45 * Math.max(0, a),
      hipR: 0.07 * b, kneeR: 1.45 * Math.max(0, b),
      armL: -0.5 * a, armR: -0.5 * b,
      pitch: 0.06, bob: -Math.abs(Math.sin(ph)) * 0.035
    };
    if (player.y > 0.02) {
      p.hipL = 0.45; p.kneeL = 1.5;
      p.hipR = -0.12; p.kneeR = 0.45;
      p.armL = -1.35; p.armR = -1.35;
      p.pitch = player.vy > 0 ? -0.06 : 0.1;
      p.bob = 0;
    }
    if (player.roll > 0) {
      p.hipL = 0.42; p.kneeL = 1.55;
      p.hipR = 0.30; p.kneeR = 1.65;
      p.armL = -0.95; p.armR = -0.95;
      p.pitch = 0.5;
      p.bob = 0;
    }
    return p;
  }

  function drawPlayer() {
    var s = F / CFG.playerZ;
    var x = px(player.x, CFG.playerZ);
    var feet = py(player.y, CFG.playerZ);
    var groundPx = py(0, CFG.playerZ);
    var p = poseRunner();
    var squash = player.roll > 0 ? 0.72 : 1;

    // 影子
    var sh = Math.max(0.18, 1 - player.y * 0.55);
    ctx.save();
    ctx.globalAlpha = 0.32 * sh;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, groundPx, 0.34 * s, 0.1 * s, 0, 0, 6.283);
    ctx.fill();
    ctx.restore();

    // 护盾泡泡
    if (game.power.shield > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(84,214,255,.85)';
      ctx.fillStyle = 'rgba(84,214,255,.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, feet - 0.9 * s, 0.62 * s, 1.02 * s, 0, 0, 6.283);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, feet + p.bob * s);
    ctx.rotate(-player.lean * 0.22 + p.pitch * 0.3);
    ctx.scale(1 + (1 - squash) * 0.5, squash);
    drawSkeleton(s, p);
    ctx.restore();

    if (player.y === 0 && game.state === 'play' && player.vy === 0 && Math.random() < 0.06) {
      game.parts.push({
        x: px(player.x, CFG.playerZ) + (Math.random() - 0.5) * 20,
        y: groundPx,
        vx: (Math.random() - 0.5) * 40,
        vy: 20 + Math.random() * 30,
        life: 0.3, max: 0.3,
        color: 'rgba(220, 214, 196, .9)',
        size: 1.5 + Math.random() * 1.5
      });
    }
  }

  function drawSkeleton(u, p) {
    var hipY = -0.84 * u;
    var shoulderY = -1.30 * u;

    drawLeg(u, 1, hipY, p.hipR, p.kneeR);
    drawLeg(u, -1, hipY, p.hipL, p.kneeL);

    // 躯干
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

    // 书包
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

    // 脑袋
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

  // 带描边的肢体
  function limb(x1, y1, x2, y2, w, color) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#221a18';
    ctx.lineWidth = w + Math.max(2.2, w * 0.26);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function drawLeg(u, side, hipY, hipAng, kneeBend) {
    var hx = side * 0.075 * u;
    var a1 = side * hipAng;
    var kx = hx + Math.sin(a1) * 0.44 * u;
    var ky = hipY + Math.cos(a1) * 0.44 * u;

    // 小腿朝镜头方向折，投影变短 → 视觉上就是脚抬起来了
    var shinLen = 0.42 * u * (0.34 + 0.66 * Math.cos(kneeBend * 0.95));
    var a2 = a1 + side * (0.10 + kneeBend * 0.30);
    var fx = kx + Math.sin(a2) * shinLen;
    var fy = ky + Math.cos(a2) * shinLen;

    limb(kx, ky, fx, fy, 0.13 * u, COL.pantsDark);
    limb(hx, hipY, kx, ky, 0.16 * u, COL.pants);

    // 裤子侧边的酒红线
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
    ctx.fillStyle = '#221a18';
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
    var a1 = side * (0.10 + swing * 0.5);
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

  function drawParts() {
    for (var i = 0; i < game.parts.length; i++) {
      var p = game.parts[i];
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function aspect(name, fallback) {
    var im = img[name];
    if (!im || !im.naturalWidth || !im.naturalHeight) return fallback;
    return im.naturalWidth / im.naturalHeight;
  }

  /* ================= 输入 ================= */
  var drag = null;

  function startGame() {
    reset();
    game.state = 'play';
    lastChips = null;
    document.getElementById('start').classList.add('hidden');
    document.getElementById('over').classList.add('hidden');
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('board').classList.add('hidden');
    last = 0;
    beep(660, 0.09, 'triangle', 0.05);
  }

  function jump() {
    if (player.y > 0 || player.roll > 0) return;
    player.vy = CFG.jumpV;
    player.y = 0.01;
    beep(520, 0.1, 'sine', 0.05);
  }

  function roll() {
    if (player.y > 0) { player.vy = -14; return; }
    if (player.roll > 0) return;
    player.roll = CFG.rollTime;
    beep(300, 0.12, 'sine', 0.05);
  }

  function move(dir) {
    var t = player.lane + dir;
    if (t < -1 || t > 1) return;
    player.lane = t;
    beep(420 + Math.abs(t) * 60, 0.05, 'sine', 0.03);
  }

  function onSwipe(dx, dy) {
    if (game.state !== 'play') return;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (Math.abs(dx) > 22) move(dx > 0 ? 1 : -1);
    } else {
      if (dy < -22) jump();
      else if (dy > 22) roll();
    }
  }

  function bindTouch() {
    cvs.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, used: false };
      if (game.state === 'play' && actx && actx.state === 'suspended') actx.resume();
      if (game.state === 'paused') resume();
    }, { passive: true });

    cvs.addEventListener('pointermove', function (e) {
      if (!drag || drag.used || game.state !== 'play') return;
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      if (Math.abs(dx) > 26 || Math.abs(dy) > 26) {
        drag.used = true;
        onSwipe(dx, dy);
      }
    }, { passive: true });

    cvs.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      if (!drag.used && Math.abs(dx) < 26 && Math.abs(dy) < 26 && game.state === 'play') jump();
      drag = null;
    }, { passive: true });

    cvs.addEventListener('pointercancel', function () { drag = null; }, { passive: true });
  }

  function bindKeys() {
    window.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      var k = e.key;
      if (game.state === 'menu' || game.state === 'over') {
        if (k === ' ' || k === 'Enter') { startGame(); e.preventDefault(); }
        return;
      }
      if (game.state === 'paused' && (k === ' ' || k === 'Escape')) { resume(); return; }
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { move(-1); e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { move(1); e.preventDefault(); }
      else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') { jump(); e.preventDefault(); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { roll(); e.preventDefault(); }
      else if (k === 'Escape') { pause(); }
    });
  }

  function pause() {
    if (game.state !== 'play') return;
    game.state = 'paused';
    document.getElementById('pause').classList.remove('hidden');
  }

  function resume() {
    if (game.state !== 'paused') return;
    game.state = 'play';
    document.getElementById('pause').classList.add('hidden');
    last = 0;
  }

  /* ================= 在线排行榜 ================= */
  // 用 ntfy.sh 的公共 pub/sub 当免费 KV：发一条消息就是一行成绩，读回来按名字去重取最高。
  function lbURL(path) { return CFG.lb.base + '/' + CFG.lb.topic + path; }

  function lbFetch() {
    return fetch(lbURL('/json?poll=1&since=all&limit=300'), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        var out = [];
        text.split('\n').forEach(function (line) {
          if (!line) return;
          try {
            var m = JSON.parse(line);
            if (m.event !== 'message') return;
            var d = JSON.parse(m.message);
            var name = String(d.n || '').trim().slice(0, 8);
            var score = Math.floor(Number(d.s) || 0);
            if (!name || score <= 0 || score > 200000) return;
            out.push({ name: name, score: score, coins: Math.floor(Number(d.c) || 0) });
          } catch (e) { /* 脏数据跳过 */ }
        });
        return out;
      });
  }

  function lbBest(items) {
    var best = {};
    items.forEach(function (e) {
      if (!best[e.name] || e.score > best[e.name].score) best[e.name] = e;
    });
    return Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 20);
  }

  function lbSubmit(name, score, coins) {
    var body = JSON.stringify({ n: name, s: score, c: coins, t: Date.now() });
    return fetch(lbURL(''), {
      method: 'POST',
      body: body,
      headers: { 'Content-Type': 'text/plain' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return true;
    });
  }

  function renderBoard(items) {
    var list = document.getElementById('boardList');
    var rows = lbBest(items);
    if (!rows.length) {
      list.innerHTML = '<li class="empty">还没有人上榜，抢个第一</li>';
      return;
    }
    var html = '';
    rows.forEach(function (r, i) {
      html += '<li><span class="rank">' + (i + 1) + '</span><span class="nm"></span><span class="sc">' + r.score + '</span></li>';
    });
    list.innerHTML = html;
    var cells = list.querySelectorAll('.nm');
    rows.forEach(function (r, i) { if (cells[i]) cells[i].textContent = r.name; });
  }

  function loadBoard() {
    var list = document.getElementById('boardList');
    list.innerHTML = '<li class="empty">加载中…</li>';
    lbFetch().then(renderBoard).catch(function () {
      list.innerHTML = '<li class="empty">连不上排行榜，稍后再试</li>';
    });
  }

  function openBoard() {
    document.getElementById('board').classList.remove('hidden');
    loadBoard();
  }

  function submitScore() {
    if (game.submitted) return;
    var input = document.getElementById('nameInput');
    var hint = document.getElementById('submitHint');
    var btn = document.getElementById('submitBtn');
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
    lbSubmit(name, game.lastScore, game.lastCoins).then(function () {
      game.submitted = true;
      localStorage.setItem('subway.lbAt', String(now));
      hint.textContent = '已上榜';
      loadBoard();
    }).catch(function () {
      btn.disabled = false;
      hint.textContent = '上传失败，检查网络后重试';
    });
  }

  /* ================= 启动 ================= */
  function buildCharRow() {
    var row = document.getElementById('charRow');
    if (!row) return;
    if (CHARACTERS.length < 2) { row.style.display = 'none'; return; }
    row.style.display = 'flex';
    row.innerHTML = '';
    CHARACTERS.forEach(function (ch) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'char-pick' + (ch.id === curChar.id ? ' on' : '');
      b.title = ch.name;
      var im = document.createElement('img');
      im.src = ch.face;
      im.alt = ch.name;
      b.appendChild(im);
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        applyCharacter(ch, true);
        buildCharRow();
      });
      row.appendChild(b);
    });
  }

  function ready() {
    if (booted) return;
    booted = true;

    document.getElementById('title').textContent = CFG.title;
    document.title = CFG.title;
    document.getElementById('best').textContent = game.best;
    buildCharRow();

    document.getElementById('playBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      startGame();
    });
    document.getElementById('retryBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      startGame();
    });
    document.getElementById('mute').addEventListener('click', function (e) {
      e.stopPropagation();
      sfxOn = !sfxOn;
      localStorage.setItem('subway.sfx', sfxOn ? '1' : '0');
      e.currentTarget.textContent = sfxOn ? '🔊' : '🔇';
    });
    document.getElementById('mute').textContent = sfxOn ? '🔊' : '🔇';

    document.getElementById('pause').addEventListener('click', function () { resume(); });

    document.getElementById('boardBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      openBoard();
    });
    document.getElementById('boardClose').addEventListener('click', function (e) {
      e.stopPropagation();
      document.getElementById('board').classList.add('hidden');
    });
    document.getElementById('boardRefresh').addEventListener('click', function (e) {
      e.stopPropagation();
      loadBoard();
    });
    document.getElementById('submitBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      submitScore();
    });

    resize();
    bindTouch();
    bindKeys();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
    });

    if (location.search.indexOf('auto=1') >= 0) startGame();

    requestAnimationFrame(frame);
  }

  // 调试入口（自动化测试/控制台调参用，不影响游戏）
  window.__subway = {
    game: game, player: player, start: startGame, CFG: CFG,
    resize: resize, lbBest: lbBest, rig: rig,
    characters: CHARACTERS, applyCharacter: applyCharacter
  };

  /* 启动：先把当前角色的两张图挂上，两张都到齐（或超时）再进 ready() */
  curChar = pickCharacter();
  img.face.onload = onAsset;
  img.head.onload = onAsset;
  img.face.onerror = onAsset;
  img.head.onerror = onAsset;
  applyCharacter(curChar, false);
  setTimeout(ready, 3000);
})();
