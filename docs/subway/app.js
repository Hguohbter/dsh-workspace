/* 同学跑酷 —— 纯 Canvas 2D 伪 3D 跑酷
 * 世界坐标：x 车道方向（1 = 一条车道宽），y 高度，z 深度（越大越远）
 * 相机固定在原点上方，看向 +z；玩家固定在 z = playerZ 处，物体朝相机移动。
 */
(function () {
  'use strict';

  /* ================= 配置（改这里就行） ================= */
  var CFG = {
    name: '同学',
    asset: {
      front: 'assets/student-front.webp',
      back: 'assets/student-back.webp',
      face: 'assets/student-face.webp',
      head: 'assets/student-head.webp'
    },
    laneW: 1.0,
    roadHalf: 1.9,
    playerZ: 3.4,
    playerH: 1.75,
    camH: 3.4,
    zFar: 90,
    jumpV: 7.6,
    gravity: 23,
    rollTime: 0.55,
    speedMin: 8,
    speedMax: 18,
    // 在线排行榜：ntfy.sh 的公共 topic，零注册零配置；12 小时自动过期
    lb: { base: 'https://ntfy.sh', topic: 'subway-hero-2026-x7k2' }
  };

  // 骨骼小人的配色（取自背面照采样）
  var COL = {
    jacket: '#8a3350', jacketDark: '#5f2036',
    pants: '#2f3240', pantsDark: '#23262f',
    shoe: '#1b2025', skin: '#c9968f', pack: '#15181c'
  };

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

  /* ================= 素材 ================= */
  var img = { face: new Image(), head: new Image() };
  var loadedCount = 0;

  function onAsset() {
    loadedCount++;
    if (loadedCount >= 2) ready();
  }
  ['face', 'head'].forEach(function (k) {
    img[k].onload = onAsset;
    img[k].onerror = onAsset;
    img[k].src = CFG.asset[k];
  });
  setTimeout(ready, 3000); // 兜底：图挂了也能玩

  function aspect(name, fallback) {
    var im = img[name];
    if (!im.naturalWidth || !im.naturalHeight) return fallback;
    return im.naturalWidth / im.naturalHeight;
  }

  /* ================= 状态 ================= */
  var game = {
    state: 'menu',       // menu | play | over | paused
    t: 0,
    dist: 0,
    speed: CFG.speedMin,
    coins: 0,
    best: Number(localStorage.getItem('subway.best') || 0),
    shake: 0,
    objs: [],
    parts: [],
    nextSpawnAt: 40,
    lastScore: 0,
    lastCoins: 0,
    submitted: false
  };

  var player = { lane: 0, x: 0, y: 0, vy: 0, roll: 0, lean: 0 };

  function reset() {
    game.t = 0;
    game.dist = 0;
    game.speed = CFG.speedMin;
    game.coins = 0;
    game.shake = 0;
    game.objs = [];
    game.parts = [];
    game.nextSpawnAt = 40;   // 开局先给 4 秒左右的空跑道，别一上来就撞
    game.submitted = false;
    rig.phase = 0;
    player.lane = 0;
    player.x = 0;
    player.y = 0;
    player.vy = 0;
    player.roll = 0;
    player.lean = 0;
  }

  /* ================= 音效（WebAudio 合成，无音频文件） ================= */
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

  /* ================= 生成器 ================= */
  var OBJ = {
    barrier: { w: 0.86, h: 0.62, d: 0.5, top: '#6b5233', front: '#4a3826', edge: '#ffcf4d' },
    bar: { w: 0.94, h: 1.0, y: 1.15, d: 0.45, top: '#5a2a3f', front: '#3d1b2c', edge: '#ff5d8f' },
    block: { w: 0.94, h: 2.35, d: 2.8, top: '#33475f', front: '#223349', edge: '#7fa8d4' },
    coin: { r: 0.3, y: 0.75 }
  };

  function rnd(n) { return Math.floor(Math.random() * n); }

  function push(type, lane, z, extra) {
    var o = { type: type, lane: lane, x: lane * CFG.laneW, z: z, dead: false, spin: Math.random() * 6.28 };
    if (extra) for (var k in extra) o[k] = extra[k];
    game.objs.push(o);
  }

  function coinLine(lane, z, n, step) {
    for (var i = 0; i < n; i++) push('coin', lane, z + i * (step || 1.15));
  }

  function spawnPattern(z) {
    var r = Math.random();
    var free, l, i;

    if (r < 0.20) {
      // 需要翻滚的低横杆
      l = rnd(3) - 1;
      push('bar', l, z);
      coinLine(l, z - 4.2, 3, 1.0);
    } else if (r < 0.42) {
      // 单个矮栏：跳过去
      l = rnd(3) - 1;
      push('barrier', l, z);
      coinLine(l === 0 ? 1 : 0, z, 3);
    } else if (r < 0.60) {
      // 两个矮栏，留一条道
      free = rnd(3);
      for (i = 0; i < 3; i++) if (i !== free) push('barrier', i - 1, z);
      coinLine(free - 1, z, 3);
    } else if (r < 0.78) {
      // 列车（整道封死，必须换道）
      l = rnd(3) - 1;
      push('block', l, z + 1.4);
      coinLine(l === 0 ? 1 : 0, z, 4, 1.25);
    } else if (r < 0.90) {
      // 跳跃吃金币弧线
      l = rnd(3) - 1;
      push('barrier', l, z);
      for (i = 0; i < 5; i++) {
        var t = (i - 2) / 2;
        push('coin', l, z + i * 0.95, { y: 0.75 + 0.85 * (1 - t * t) });
      }
    } else {
      // 两列车夹一条道
      free = rnd(3);
      for (i = 0; i < 3; i++) if (i !== free) push('block', i - 1, z + 1.5);
    }
  }

  /* ================= 主循环 ================= */
  var last = 0, rafId = 0;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!last) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!game.freeze) update(dt);
    render();
  }

  function update(dt) {
    game.t += dt;
    rig.phase += dt * (4.0 + game.speed * 0.55);
    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 2.4);

    if (game.state === 'menu') {
      game.dist += 5 * dt;     // 菜单里背景照样跑，有气氛
      return;
    }
    if (game.state !== 'play') return;

    game.speed = Math.min(CFG.speedMax, CFG.speedMin + game.dist * 0.012);
    game.dist += game.speed * dt;

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
      o.z -= game.speed * dt;
      if (!o.dead && prev > PZC && o.z <= PZC) {
        if (o.type === 'coin') collectCoin(o); else if (o.type !== 'coin') hitTest(o);
      }
      if (o.z < 0.9) o.dead = true;
    }
    for (var j = game.objs.length - 1; j >= 0; j--) {
      if (game.objs[j].dead) game.objs.splice(j, 1);
    }

    // 生成：nextSpawnAt 存的是“绝对里程”，再换算成相对相机的 z
    // （旧写法直接把 z 累加，跑出 90 之后就不再生成，后面就空了）
    while (game.nextSpawnAt - game.dist < CFG.zFar) {
      spawnPattern(game.nextSpawnAt - game.dist);
      game.nextSpawnAt += Math.max(10, game.speed * 0.8) - Math.random() * 2;
    }

    // 粒子
    for (var p = game.parts.length - 1; p >= 0; p--) {
      var q = game.parts[p];
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy -= 9 * dt;
      if (q.life <= 0) game.parts.splice(p, 1);
    }

    syncHud();
  }

  function hitTest(o) {
    if (Math.abs(player.x - o.x) > 0.52) return;
    if (o.type === 'barrier' && player.y >= 0.55) return;      // 跳过矮栏
    if (o.type === 'bar' && player.roll > 0) return;           // 滚过横杆
    if (o.type === 'block' && player.y > 2.3) return;          // 极限弹跳（基本不会）
    crash(o);
  }

  function collectCoin(o) {
    var needJump = (o.y || OBJ.coin.y) > 0.95;
    if (needJump && player.y < 0.4) return;
    if (Math.abs(player.x - o.x) > 0.5) return;
    o.dead = true;
    game.coins++;
    beep(1180 + Math.random() * 220, 0.07, 'triangle', 0.045);
    burst(px(o.x, o.z), py(o.y || OBJ.coin.y, o.z), '#ffd75e', 5);
  }

  function crash(o) {
    game.state = 'over';
    game.shake = 1;
    beep(150, 0.32, 'sawtooth', 0.07);
    var cx = px(player.x, CFG.playerZ);
    var cy = py(player.y + 0.9, CFG.playerZ);
    burst(cx, cy, '#ff5d8f', 16);
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

    // 结算页的上传入口
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

  function syncHud() {
    var s = scoreNow();
    var el = document.getElementById('score');
    if (el.textContent !== String(s)) el.textContent = s;
    var c = document.getElementById('coin');
    if (c.textContent !== String(game.coins)) c.textContent = game.coins;
  }

  /* ================= 渲染 ================= */
  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (game.shake > 0) {
      ctx.translate((Math.random() - 0.5) * game.shake * 14, (Math.random() - 0.5) * game.shake * 14);
    }

    drawSky();
    drawRoad();
    drawPillars();

    var list = game.objs.slice();
    list.push({ type: 'player', z: CFG.playerZ });
    list.sort(function (a, b) { return b.z - a.z; });

    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.z < 1.0) continue;
      if (o.type === 'player') drawPlayer();
      else if (o.type === 'coin') drawCoin(o);
      else drawBlock(o);
    }

    drawParts();
    ctx.restore();
  }

  function drawSky() {
    if (!skyGrad) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, horizon + 40);
      skyGrad.addColorStop(0, '#0d1a2e');
      skyGrad.addColorStop(0.55, '#1b2c45');
      skyGrad.addColorStop(1, '#3a4a5e');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, horizon + 2);

    // 月亮
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#f6e6b6';
    ctx.beginPath();
    ctx.arc(W * 0.76, horizon * 0.34, Math.max(14, W * 0.045), 0, 6.283);
    ctx.fill();
    ctx.restore();

    // 天际线（两层视差）
    skyline((game.dist * 4) % 9000, horizon + 2, 'rgba(14, 22, 34, .85)', 0.55);
    skyline((game.dist * 9) % 9000 + 40, horizon + 4, 'rgba(8, 13, 21, .95)', 1);

    // 地平线雾
    var g = ctx.createLinearGradient(0, horizon - 26, 0, horizon + 10);
    g.addColorStop(0, 'rgba(120, 160, 200, 0)');
    g.addColorStop(0.6, 'rgba(120, 160, 200, .14)');
    g.addColorStop(1, 'rgba(90, 130, 170, .05)');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon - 26, W, 40);
  }

  function skyline(offset, baseY, color, scale) {
    ctx.fillStyle = color;
    var period = 62;
    var total = 20;
    for (var i = 0; i < total; i++) {
      var seed = i * 37.7;
      var bw = (22 + Math.abs(Math.sin(seed)) * 34) * scale;
      var bh = (34 + Math.abs(Math.sin(seed * 1.7)) * 96) * scale;
      var x = ((i * period - offset) % (total * period) + total * period) % (total * period) - period;
      ctx.fillRect(x, baseY - bh, bw, bh);
    }
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
    ctx.fillStyle = '#0a111b';
    ctx.fillRect(0, horizon, W, H - horizon);

    var rh = CFG.roadHalf;
    roadQuad(-rh - 2.4, -rh, 1.0, CFG.zFar, '#0d1622');
    roadQuad(rh, rh + 2.4, 1.0, CFG.zFar, '#0d1622');
    roadQuad(-rh, rh, 1.0, CFG.zFar, '#1a2537');

    // 枕木 / 横向速度线
    var tieStep = 2.4;
    var tieOff = game.dist % tieStep;
    for (var z = 0.5 - tieOff; z < CFG.zFar; z += tieStep) {
      var z0 = Math.max(z, 0.5), z1 = z + 0.34;
      if (z1 <= 0.5) continue;
      roadQuad(-rh, rh, z0, z1, 'rgba(255, 255, 255, .055)');
    }

    // 车道虚线
    var dashStep = 2.2;
    var dashOff = game.dist % dashStep;
    for (var z2 = 0.5 - dashOff; z2 < CFG.zFar; z2 += dashStep) {
      var d0 = Math.max(z2, 0.5), d1 = z2 + 1.1;
      if (d1 <= 0.5) continue;
      roadQuad(-0.535, -0.465, d0, d1, 'rgba(214, 231, 255, .5)');
      roadQuad(0.465, 0.535, d0, d1, 'rgba(214, 231, 255, .5)');
    }

    // 边线
    roadQuad(-rh, -rh + 0.07, 1.0, CFG.zFar, 'rgba(240, 190, 80, .85)');
    roadQuad(rh - 0.07, rh, 1.0, CFG.zFar, 'rgba(240, 190, 80, .85)');
  }

  // 站台立柱：给速度感和纵深，纯几何绘制，不占素材
  function drawPillars() {
    var step = 7;
    var off = game.dist % step;
    for (var z = 3.2 - off; z < 62; z += step) {
      if (z < 2.6) continue;
      column(-(CFG.roadHalf + 1.25), z);
      column(CFG.roadHalf + 1.25, z);
    }
  }

  function column(x, z) {
    var w = 0.5, h = 2.6, d = 0.6;
    var zn = Math.max(1.02, z - d / 2), zf = z + d / 2;
    var x0 = x - w / 2, x1 = x + w / 2;
    poly3([[x0, h, zn], [x1, h, zn], [x1, h, zf], [x0, h, zf]], '#162233');
    poly3([[x0, 0, zn], [x1, 0, zn], [x1, h, zn], [x0, h, zn]], '#0e1826');
    var ly = h - 0.16;
    poly3([[x0, ly, zn - 0.02], [x1, ly, zn - 0.02],
      [x1, ly + 0.09, zn - 0.02], [x0, ly + 0.09, zn - 0.02]], 'rgba(255, 206, 120, .7)');
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

    // 地面影子
    ctx.save();
    ctx.globalAlpha = 0.35;
    poly3([[x0 * 1.05, 0, zn], [x1 * 1.05, 0, zn], [x1 * 1.05, 0, zf], [x0 * 1.05, 0, zf]], 'rgba(0,0,0,.6)');
    ctx.restore();

    // 顶面
    poly3([[x0, topY, zn], [x1, topY, zn], [x1, topY, zf], [x0, topY, zf]], c.top);

    // 横杆两侧的支柱，看着才像“门”
    if (o.type === 'bar') {
      var pw = 0.1;
      poly3([[x0, 0, zn], [x0 + pw, 0, zn], [x0 + pw, topY, zn], [x0, topY, zn]], '#33405a');
      poly3([[x1 - pw, 0, zn], [x1, 0, zn], [x1, topY, zn], [x1 - pw, topY, zn]], '#33405a');
    }

    // 侧面（朝向画面中心的那一侧）
    if (o.x > 0.05) {
      poly3([[x0, baseY, zn], [x0, baseY, zf], [x0, topY, zf], [x0, topY, zn]], shade(c.front, 0.82));
    } else if (o.x < -0.05) {
      poly3([[x1, baseY, zn], [x1, baseY, zf], [x1, topY, zf], [x1, topY, zn]], shade(c.front, 0.82));
    }

    // 正面
    poly3([[x0, baseY, zn], [x1, baseY, zn], [x1, topY, zn], [x0, topY, zn]], c.front);
    ctx.strokeStyle = 'rgba(150, 180, 220, .45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px(x0, zn), py(baseY, zn));
    ctx.lineTo(px(x1, zn), py(baseY, zn));
    ctx.lineTo(px(x1, zn), py(topY, zn));
    ctx.lineTo(px(x0, zn), py(topY, zn));
    ctx.closePath();
    ctx.stroke();

    // 高光条 / 霓虹边
    ctx.strokeStyle = c.edge;
    ctx.lineWidth = Math.max(1, Math.min(3, 220 / o.z / 6));
    ctx.beginPath();
    var ax = px(x0, zn), ay = py(topY, zn), bx = px(x1, zn), by = py(topY, zn);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    if (o.type === 'block') {
      // 车厢窗户
      var wy0 = baseY + c.h * 0.55, wy1 = baseY + c.h * 0.82;
      var wz0 = zn - 0.01, wz1 = zn - 0.02;
      ctx.save();
      ctx.globalAlpha = 0.9;
      poly3([[x0 * 0.86, wy0, wz0], [x1 * 0.86, wy0, wz0], [x1 * 0.86, wy1, wz0], [x0 * 0.86, wy1, wz0]], 'rgba(126, 186, 235, .85)');
      ctx.restore();
      void wz1;
    }
    if (o.type === 'barrier') {
      // 斜纹警示
      var hh = baseY + c.h * 0.5;
      poly3([[x0 * 0.98, hh, zn - 0.01], [x1 * 0.98, hh, zn - 0.01],
        [x1 * 0.98, hh + c.h * 0.22, zn - 0.01], [x0 * 0.98, hh + c.h * 0.22, zn - 0.01]], 'rgba(255, 207, 77, .75)');
    }
  }

  var shadeCache = {};
  function shade(hex, k) {
    var key = hex + k;
    if (shadeCache[key]) return shadeCache[key];
    var n = parseInt(hex.slice(1), 16);
    var r = Math.round(((n >> 16) & 255) * k);
    var g = Math.round(((n >> 8) & 255) * k);
    var b = Math.round((n & 255) * k);
    var out = 'rgb(' + r + ',' + g + ',' + b + ')';
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
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.9, 0, 6.283);
    ctx.fill();

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

  /* ---------- 角色：照片脑袋 + 程序化骨骼（跑/跳/滚都有动作） ---------- */
  var rig = { phase: 0 };

  function poseRunner() {
    var ph = rig.phase;
    var a = Math.sin(ph), b = Math.sin(ph + Math.PI);
    var p = {
      hipL: 0.10 * a, kneeL: 1.45 * Math.max(0, a),
      hipR: 0.10 * b, kneeR: 1.45 * Math.max(0, b),
      armL: -0.55 * a, armR: -0.55 * b,
      pitch: 0.05, bob: -Math.abs(Math.cos(ph)) * 0.02
    };
    if (player.y > 0.02) {
      // 空中：收腿、抬手
      p.hipL = 0.5; p.kneeL = 1.5;
      p.hipR = -0.1; p.kneeR = 0.5;
      p.armL = -1.4; p.armR = -1.4;
      p.pitch = player.vy > 0 ? -0.06 : 0.1;
      p.bob = 0;
    }
    if (player.roll > 0) {
      // 翻滚：缩成一团，头往下压
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
    ctx.globalAlpha = 0.42 * sh;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, groundPx, 0.34 * s, 0.1 * s, 0, 0, 6.283);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, feet + p.bob * s);
    ctx.rotate(-player.lean * 0.22 + p.pitch * 0.3);
    ctx.scale(1 + (1 - squash) * 0.5, squash);
    drawSkeleton(s, p);
    ctx.restore();

    // 落地扬起的土
    if (player.y === 0 && game.state === 'play' && player.vy === 0 && Math.random() < 0.06) {
      game.parts.push({
        x: px(player.x, CFG.playerZ) + (Math.random() - 0.5) * 20,
        y: groundPx,
        vx: (Math.random() - 0.5) * 40,
        vy: 20 + Math.random() * 30,
        life: 0.3, max: 0.3,
        color: 'rgba(180, 200, 230, .8)',
        size: 1.5 + Math.random() * 1.5
      });
    }
  }

  function drawSkeleton(u, p) {
    var hipY = -0.84 * u;
    var shoulderY = -1.32 * u;

    // 远侧腿先画
    drawLeg(u, 1, hipY, p.hipR, p.kneeR);
    drawLeg(u, -1, hipY, p.hipL, p.kneeL);

    // 躯干（校服外套）
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

    // 手臂
    drawArm(u, 1, shoulderY + 0.04 * u, p.armR);
    drawArm(u, -1, shoulderY + 0.04 * u, p.armL);

    // 书包
    rrect(-0.13 * u, shoulderY + 0.06 * u, 0.26 * u, 0.44 * u, 0.055 * u, COL.pack);
    rrect(-0.09 * u, hipY - 0.28 * u, 0.18 * u, 0.15 * u, 0.03 * u, 'rgba(255,255,255,.05)');
    // 肩带
    ctx.strokeStyle = '#0b0d10';
    ctx.lineWidth = 0.045 * u;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.125 * u, shoulderY + 0.02 * u);
    ctx.lineTo(-0.15 * u, hipY - 0.32 * u);
    ctx.moveTo(0.125 * u, shoulderY + 0.02 * u);
    ctx.lineTo(0.15 * u, hipY - 0.32 * u);
    ctx.stroke();

    // 脑袋（照片：后脑勺 + 猫耳）
    var hh = 0.56 * u;
    var hw = hh * aspect('head', 0.92);
    var hy = shoulderY - hh * 0.72;
    if (img.head.naturalWidth) {
      ctx.drawImage(img.head, -hw / 2, hy, hw, hh);
    } else {
      rrect(-hw / 2, hy, hw, hh, hw * 0.4, COL.pack);
    }
  }

  // 带描边的肢体：先用深色粗线勾一圈，再用本色画，避免同色糊成一团
  function limb(x1, y1, x2, y2, w, color) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0c0f14';
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

    // 鞋
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(a2 * 0.5);
    ctx.fillStyle = '#0c0f14';
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
    var a1 = side * (0.16 + swing * 0.45);
    var ex = sx + Math.sin(a1) * 0.28 * u;
    var ey = shoulderY + Math.cos(a1) * 0.28 * u;
    var fore = 0.26 * u * (0.72 + 0.28 * Math.cos(swing * 1.8));
    var a2 = a1 + side * 0.22;
    var hx = ex + Math.sin(a2) * fore;
    var hy = ey + Math.cos(a2) * fore;

    limb(sx, shoulderY, ex, ey, 0.125 * u, COL.jacket);
    limb(ex, ey, hx, hy, 0.112 * u, COL.jacketDark);

    ctx.fillStyle = COL.skin;
    ctx.beginPath();
    ctx.arc(hx, hy, 0.055 * u, 0, 6.283);
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

  /* ================= 在线排行榜 ================= */
  // 用 ntfy.sh 的公共 pub/sub 当免费 KV：发一条消息就是一行成绩，读回来按名字去重取最高。
  // 零注册、零后端、CORS 全开；代价是消息 12 小时后过期、topic 是公开的（谁都能看能写）。
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
          } catch (e) { /* 脏数据直接跳过 */ }
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

  /* ================= 输入 ================= */
  var drag = null;

  function startGame() {
    reset();
    game.state = 'play';
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
    if (player.y > 0) { player.vy = -14; return; }  // 空中下滑 = 快速落地
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

  /* ================= 启动 ================= */
  var started = false;
  function ready() {
    if (started) return;
    started = true;

    document.getElementById('startFace').src = CFG.asset.face;
    document.getElementById('overFace').src = CFG.asset.face;
    document.getElementById('startName').textContent = CFG.name;
    document.getElementById('overName').textContent = CFG.name;
    document.getElementById('best').textContent = game.best;

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

    // 手机上没有键盘，暂停层要能点一下继续
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

    // 竖屏/横屏都自适应
    resize();
    bindTouch();
    bindKeys();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
    });

    // 调试：?auto=1 直接开跑
    if (location.search.indexOf('auto=1') >= 0) startGame();

    rafId = requestAnimationFrame(frame);
  }

  // 调试入口（自动化测试/控制台调参用，不影响游戏）
  window.__subway = { game: game, player: player, start: startGame, CFG: CFG, resize: resize, lbBest: lbBest, rig: rig };
})();
