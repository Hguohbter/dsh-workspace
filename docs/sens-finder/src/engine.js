/*
 * Sens Lab — canvas aim-test engine.
 * Renders a first-person style arena (camera rotates, crosshair stays centred)
 * and scores three drills: tracking, flicking and micro-adjust.
 */
(function (root) {
  'use strict';

  var C = root.SensCore;
  if (!C) throw new Error('SensCore must be loaded before engine.js');

  var COLORS = {
    track: { base: '#3ee6ff', label: '跟枪' },
    flick: { base: '#ffb84d', label: '甩枪' },
    micro: { base: '#ff6aa9', label: '微调' }
  };

  function rgba(hex, alpha) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function AimEngine(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 960;
    this.height = 540;
    this.dpr = 1;
    this.cm360 = 40;
    this.dpi = 800;
    this.fov = 103;
    this.camera = { yaw: 0, pitch: 0 };
    this.stage = null;
    this.battery = null;
    this.lastResult = null;
    this.hitFlash = 0;
    this.missFlash = 0;
    this.reducedMotion = false;
    this.onStageEnd = null;
    this.onEvent = null;
    this._resize = this.resize.bind(this);
    if (typeof window !== 'undefined') window.addEventListener('resize', this._resize);
    if (typeof ResizeObserver !== 'undefined') {
      try {
        this._observer = new ResizeObserver(this._resize);
        this._observer.observe(canvas);
      } catch (err) {
        this._observer = null;
      }
    }
    this.resize();
  }

  AimEngine.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : null;
    var w = Math.max(320, Math.round((rect && rect.width) || this.canvas.clientWidth || 960));
    var h = Math.max(240, Math.round((rect && rect.height) || this.canvas.clientHeight || 540));
    var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    if (this.ctx && this.ctx.setTransform) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.draw();
  };

  AimEngine.prototype.setSensitivity = function (opts) {
    opts = opts || {};
    if (opts.cm360 > 0) this.cm360 = opts.cm360;
    if (opts.dpi > 0) this.dpi = opts.dpi;
    if (opts.fov > 0) this.fov = opts.fov;
  };

  AimEngine.prototype.setGameFov = function (fov) {
    if (fov > 0) this.fov = fov;
  };

  AimEngine.prototype.degPerCount = function () {
    return C.degPerCount(this.cm360, this.dpi);
  };

  AimEngine.prototype.pxPerDeg = function () {
    return C.pxPerDeg(this.width, this.fov);
  };

  /** Feed raw mouse counts from a pointer-lock movement event. */
  AimEngine.prototype.look = function (dx, dy) {
    var k = this.degPerCount();
    if (!k) return;
    var world = C.WORLD;
    this.camera.yaw = clamp(this.camera.yaw + (Number(dx) || 0) * k, -world.yawLimit, world.yawLimit);
    this.camera.pitch = clamp(this.camera.pitch + (Number(dy) || 0) * k, -world.pitchLimit, world.pitchLimit);
  };

  AimEngine.prototype.resetCamera = function () {
    this.camera.yaw = 0;
    this.camera.pitch = 0;
  };

  AimEngine.prototype.startStage = function (mode, battery, config) {
    config = config || {};
    this.battery = battery || this.battery;
    this.resetCamera();
    this.hitFlash = 0;
    this.missFlash = 0;
    this.lastResult = null;
    var base = {
      mode: mode,
      elapsed: 0,
      duration: Number(config.seconds) || 7,
      ended: false,
      label: COLORS[mode] ? COLORS[mode].label : mode
    };
    var st;
    if (mode === 'track') {
      st = Object.assign(base, {
        track: this.battery.track,
        radius: this.battery.trackRadius || C.TRACK_TARGET_RADIUS,
        sumQuality: 0,
        sumTime: 0,
        hitTime: 0,
        samples: 0
      });
    } else if (mode === 'flick') {
      st = Object.assign(base, {
        list: this.battery.flick.slice(0, config.count || 5),
        index: -1,
        active: null,
        nextSpawnAt: 0.45,
        finishAt: null,
        shots: [],
        missClicks: 0
      });
    } else if (mode === 'micro') {
      st = Object.assign(base, {
        list: this.battery.micro.slice(0, config.count || 5),
        index: -1,
        active: null,
        nextSpawnAt: 0.5,
        finishAt: null,
        shots: [],
        missClicks: 0
      });
    } else {
      throw new Error('Unknown stage mode: ' + mode);
    }
    this.stage = st;
    this.draw();
  };

  AimEngine.prototype.currentTarget = function () {
    var st = this.stage;
    if (!st) return null;
    var ppd = this.pxPerDeg();
    if (st.mode === 'track') {
      var pos = C.trackPosition(st.track, st.elapsed);
      var prev = C.trackPosition(st.track, Math.max(0, st.elapsed - 0.055));
      return {
        yaw: pos.yaw,
        pitch: pos.pitch,
        prevYaw: prev.yaw,
        prevPitch: prev.pitch,
        radius: st.radius,
        pxRadius: st.radius * ppd,
        progress: clamp(st.elapsed / st.duration, 0, 1)
      };
    }
    if (st.mode === 'flick' && st.active) {
      var spec = st.active.spec;
      return {
        yaw: spec.yaw,
        pitch: spec.pitch,
        radius: spec.radius,
        pxRadius: spec.radius * ppd,
        progress: 0,
        lifeProgress: clamp((st.elapsed - st.active.spawnAt) / spec.lifetime, 0, 1)
      };
    }
    if (st.mode === 'micro' && st.active) {
      var m = C.microPosition(st.active.spec, st.elapsed - st.active.spawnAt);
      return {
        yaw: m.yaw,
        pitch: m.pitch,
        radius: st.active.spec.radius,
        pxRadius: st.active.spec.radius * ppd,
        dwellProgress: clamp(st.active.dwell / st.active.spec.dwell, 0, 1),
        lifeProgress: clamp((st.elapsed - st.active.spawnAt) / st.active.spec.timeout, 0, 1)
      };
    }
    return null;
  };

  AimEngine.prototype.update = function (dt) {
    var st = this.stage;
    if (!st) return;
    dt = Number(dt);
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(0.1, dt);
    st.elapsed += dt;
    if (st.mode === 'track') this._updateTrack(dt);
    else if (st.mode === 'flick') this._updateFlick(dt);
    else if (st.mode === 'micro') this._updateMicro(dt);
    if (this.stage === st) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.missFlash = Math.max(0, this.missFlash - dt);
    }
  };

  AimEngine.prototype._updateTrack = function (dt) {
    var st = this.stage;
    var pos = C.trackPosition(st.track, st.elapsed);
    var dist = C.angularDistance(pos, this.camera);
    var q = C.trackingQuality(dist, st.radius);
    st.sumQuality += q * dt;
    st.sumTime += dt;
    st.samples++;
    if (dist <= st.radius) st.hitTime += dt;
    if (st.elapsed >= st.duration) {
      var avgQ = st.sumTime > 0 ? st.sumQuality / st.sumTime : 0;
      var hitFraction = st.sumTime > 0 ? st.hitTime / st.sumTime : 0;
      this._finishStage({
        score: C.scoreTracking(avgQ, hitFraction),
        avgQuality: avgQ,
        hitFraction: hitFraction,
        samples: st.samples,
        duration: st.duration
      });
    }
  };

  AimEngine.prototype._updateFlick = function () {
    var st = this.stage;
    if (!st.active) {
      if (st.finishAt != null) {
        if (st.elapsed >= st.finishAt) this._finishFlick();
        return;
      }
      if (st.elapsed >= st.nextSpawnAt) this._spawnFlick();
      return;
    }
    var spec = st.active.spec;
    var life = st.elapsed - st.active.spawnAt;
    if (life > spec.lifetime) {
      st.shots.push({ hit: false, time: spec.lifetime, precision: 0, dist: Infinity });
      st.active = null;
      st.nextSpawnAt = st.elapsed + 0.22;
      this._flash('miss');
      this._emit('miss', { mode: 'flick', reason: 'timeout' });
      if (st.index >= st.list.length - 1) st.finishAt = st.elapsed + 0.3;
    }
  };

  AimEngine.prototype._spawnFlick = function () {
    var st = this.stage;
    st.index++;
    if (st.index >= st.list.length) {
      st.active = null;
      st.finishAt = st.elapsed + 0.25;
      return;
    }
    st.active = { spec: st.list[st.index], spawnAt: st.elapsed };
  };

  AimEngine.prototype.handleClick = function () {
    var st = this.stage;
    if (!st) return false;
    if (st.mode === 'flick') {
      if (!st.active) return false;
      var spec = st.active.spec;
      var dist = C.angularDistance(spec, this.camera);
      if (dist <= spec.radius) {
        var time = st.elapsed - st.active.spawnAt;
        var precision = 1 - 0.5 * Math.pow(dist / spec.radius, 2);
        st.shots.push({ hit: true, time: time, precision: precision, dist: dist });
        st.active = null;
        st.nextSpawnAt = st.elapsed + 0.2;
        this._flash('hit');
        this._emit('hit', { mode: 'flick', time: time });
        if (st.index >= st.list.length - 1) st.finishAt = st.elapsed + 0.3;
      } else {
        st.missClicks++;
        this._flash('miss');
        this._emit('miss', { mode: 'flick', reason: 'off-target' });
      }
      return true;
    }
    if (st.mode === 'micro' && st.active) {
      // Micro-adjust is scored by holding, but a click gives feedback.
      var target = this.currentTarget();
      var d = target ? C.angularDistance(target, this.camera) : Infinity;
      if (d <= (target ? target.radius : 0)) {
        this._flash('hit');
        this._emit('hit', { mode: 'micro' });
      } else {
        this._flash('miss');
        st.missClicks++;
      }
      return true;
    }
    return false;
  };

  AimEngine.prototype._updateMicro = function (dt) {
    var st = this.stage;
    if (!st.active) {
      if (st.finishAt != null) {
        if (st.elapsed >= st.finishAt) this._finishMicro();
        return;
      }
      if (st.elapsed >= st.nextSpawnAt) this._spawnMicro();
      return;
    }
    var spec = st.active.spec;
    var localT = st.elapsed - st.active.spawnAt;
    var pos = C.microPosition(spec, localT);
    var dist = C.angularDistance(pos, this.camera);
    if (dist <= spec.radius) st.active.dwell += dt;
    else st.active.dwell = Math.max(0, st.active.dwell - dt * 0.75);

    if (st.active.dwell >= spec.dwell) {
      var time = localT;
      st.shots.push({ hit: true, time: time, precision: 1, dist: dist });
      st.active = null;
      st.nextSpawnAt = st.elapsed + 0.18;
      this._flash('hit');
      this._emit('hit', { mode: 'micro', time: time });
      if (st.index >= st.list.length - 1) st.finishAt = st.elapsed + 0.25;
    } else if (localT > spec.timeout) {
      st.shots.push({ hit: false, time: spec.timeout, precision: 0, dist: dist });
      st.active = null;
      st.nextSpawnAt = st.elapsed + 0.22;
      this._flash('miss');
      this._emit('miss', { mode: 'micro', reason: 'timeout' });
      if (st.index >= st.list.length - 1) st.finishAt = st.elapsed + 0.3;
    }
  };

  AimEngine.prototype._spawnMicro = function () {
    var st = this.stage;
    st.index++;
    if (st.index >= st.list.length) {
      st.active = null;
      st.finishAt = st.elapsed + 0.25;
      return;
    }
    st.active = { spec: st.list[st.index], spawnAt: st.elapsed, dwell: 0 };
  };

  AimEngine.prototype._finishFlick = function () {
    var st = this.stage;
    var hits = st.shots.filter(function (s) { return s.hit; });
    var avgTime = hits.length ? hits.reduce(function (a, s) { return a + s.time; }, 0) / hits.length : 0;
    this._finishStage({
      score: C.scoreFlick(st.shots, st.missClicks),
      hits: hits.length,
      total: st.list.length,
      avgTime: avgTime,
      missClicks: st.missClicks,
      shots: st.shots.slice()
    });
  };

  AimEngine.prototype._finishMicro = function () {
    var st = this.stage;
    var hits = st.shots.filter(function (s) { return s.hit; });
    var avgTime = hits.length ? hits.reduce(function (a, s) { return a + s.time; }, 0) / hits.length : 0;
    this._finishStage({
      score: C.scoreMicro(st.shots, st.list[0] ? st.list[0].dwell : 0.5, st.list[0] ? st.list[0].timeout : 2.7),
      hits: hits.length,
      total: st.list.length,
      avgTime: avgTime,
      missClicks: st.missClicks,
      shots: st.shots.slice()
    });
  };

  AimEngine.prototype._finishStage = function (payload) {
    var st = this.stage;
    if (!st || st.ended) return;
    st.ended = true;
    var result = Object.assign({ mode: st.mode, modeLabel: st.label }, payload);
    this.stage = null;
    this.lastResult = result;
    this.hitFlash = 0;
    this.missFlash = 0;
    this.draw();
    if (typeof this.onStageEnd === 'function') this.onStageEnd(result);
  };

  AimEngine.prototype.abortStage = function () {
    this.stage = null;
    this.hitFlash = 0;
    this.missFlash = 0;
    this.draw();
  };

  AimEngine.prototype._flash = function (type) {
    if (type === 'hit') this.hitFlash = 0.26;
    else this.missFlash = 0.22;
  };

  AimEngine.prototype._emit = function (type, data) {
    if (typeof this.onEvent === 'function') {
      try {
        this.onEvent(type, data || {});
      } catch (err) {
        /* sound or UI callbacks must never break the test loop */
      }
    }
  };

  AimEngine.prototype.hud = function () {
    var st = this.stage;
    if (!st) return null;
    var target = this.currentTarget();
    var timeLeft = 0;
    var progress = 0;
    if (st.mode === 'track') {
      timeLeft = Math.max(0, st.duration - st.elapsed);
      progress = clamp(st.elapsed / st.duration, 0, 1);
    } else {
      var total = st.list.length;
      var done = Math.min(total, st.shots.length);
      timeLeft = 0;
      progress = total ? done / total : 0;
    }
    var onTarget = false;
    var dist = Infinity;
    if (target) {
      dist = C.angularDistance(target, this.camera);
      onTarget = dist <= target.radius;
    }
    return {
      mode: st.mode,
      label: st.label,
      timeLeft: timeLeft,
      progress: progress,
      onTarget: onTarget,
      dist: dist,
      shotsDone: st.shots ? st.shots.length : 0,
      shotsTotal: st.list ? st.list.length : 0
    };
  };

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */
  AimEngine.prototype._screen = function (point) {
    var ppd = this.pxPerDeg();
    return {
      x: this.width / 2 + (point.yaw - this.camera.yaw) * ppd,
      y: this.height / 2 + (point.pitch - this.camera.pitch) * ppd
    };
  };

  AimEngine.prototype.draw = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    var W = this.width;
    var H = this.height;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    this._drawBackground(ctx, W, H);
    var target = this.currentTarget();
    if (target) this._drawTarget(ctx, target);
    this._drawCrosshair(ctx, target);
    this._drawFlashes(ctx);
  };

  AimEngine.prototype._drawBackground = function (ctx, W, H) {
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#05080f');
    bg.addColorStop(0.55, '#070d18');
    bg.addColorStop(1, '#04060b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.62);
    glow.addColorStop(0, 'rgba(38, 92, 150, 0.18)');
    glow.addColorStop(0.45, 'rgba(20, 46, 82, 0.08)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    var ppd = this.pxPerDeg();
    if (!ppd) return;
    var halfX = W / 2 / ppd;
    var halfY = H / 2 / ppd;
    var step = 5;
    var startX = Math.floor((this.camera.yaw - halfX) / step) * step;
    var endX = this.camera.yaw + halfX;
    var startY = Math.floor((this.camera.pitch - halfY) / step) * step;
    var endY = this.camera.pitch + halfY;

    ctx.lineWidth = 1;
    for (var degX = startX; degX <= endX; degX += step) {
      var x = W / 2 + (degX - this.camera.yaw) * ppd;
      var majorX = degX % 15 === 0;
      ctx.strokeStyle = majorX ? 'rgba(86, 148, 214, 0.22)' : 'rgba(86, 148, 214, 0.1)';
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, H);
      ctx.stroke();
    }
    for (var degY = startY; degY <= endY; degY += step) {
      var y = H / 2 + (degY - this.camera.pitch) * ppd;
      var majorY = degY % 15 === 0;
      ctx.strokeStyle = majorY ? 'rgba(86, 148, 214, 0.22)' : 'rgba(86, 148, 214, 0.1)';
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(W, Math.round(y) + 0.5);
      ctx.stroke();
    }

    // Horizon marker.
    var hy = H / 2 - this.camera.pitch * ppd;
    if (hy > 0 && hy < H) {
      var grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, 'rgba(86, 148, 214, 0)');
      grad.addColorStop(0.5, 'rgba(86, 148, 214, 0.32)');
      grad.addColorStop(1, 'rgba(86, 148, 214, 0)');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, hy);
      ctx.lineTo(W, hy);
      ctx.stroke();
    }

    // Vignette + frame marks.
    var vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(120, 180, 240, 0.22)';
    ctx.lineWidth = 1.5;
    var m = 18;
    var len = 22;
    var corners = [
      [m, m, 1, 1],
      [W - m, m, -1, 1],
      [m, H - m, 1, -1],
      [W - m, H - m, -1, -1]
    ];
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      ctx.beginPath();
      ctx.moveTo(c[0] + c[2] * len, c[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(c[0], c[1] + c[3] * len);
      ctx.stroke();
    }
  };

  AimEngine.prototype._drawTarget = function (ctx, t) {
    var mode = this.stage ? this.stage.mode : 'track';
    var color = (COLORS[mode] || COLORS.track).base;
    var ppd = this.pxPerDeg();
    var pos = this._screen(t);
    var rp = Math.max(5, t.radius * ppd);
    if (pos.x < -rp * 4 || pos.x > this.width + rp * 4 || pos.y < -rp * 4 || pos.y > this.height + rp * 4) return;

    var pulse = 1 + 0.045 * Math.sin((this.stage ? this.stage.elapsed : 0) * 6.2);

    // Motion streak for tracking targets.
    if (mode === 'track' && Number.isFinite(t.prevYaw)) {
      var prev = this._screen({ yaw: t.prevYaw, pitch: t.prevPitch });
      ctx.strokeStyle = rgba(color, 0.18);
      ctx.lineWidth = rp * 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // Outer glow.
    var glow = ctx.createRadialGradient(pos.x, pos.y, rp * 0.15, pos.x, pos.y, rp * 2.7);
    glow.addColorStop(0, rgba(color, 0.4));
    glow.addColorStop(0.42, rgba(color, 0.13));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, rp * 2.7, 0, Math.PI * 2);
    ctx.fill();

    // Body.
    ctx.fillStyle = rgba(color, 0.13);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, rp * 0.86, 0, Math.PI * 2);
    ctx.fill();

    // Main ring.
    ctx.strokeStyle = rgba(color, 0.95);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, rp * 0.86 * pulse, 0, Math.PI * 2);
    ctx.stroke();

    // Core.
    ctx.fillStyle = rgba(color, 0.9);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, Math.max(1.4, rp * 0.12), 0, Math.PI * 2);
    ctx.fill();

    // Progress arcs.
    if (mode === 'flick' && this.stage && this.stage.active && t.lifeProgress != null) {
      var remain = 1 - t.lifeProgress;
      ctx.strokeStyle = rgba(color, 0.8);
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, rp * 1.14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remain);
      ctx.stroke();
    }
    if (mode === 'micro' && this.stage && this.stage.active) {
      ctx.strokeStyle = rgba(color, 0.9);
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, rp * 1.35, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (t.dwellProgress || 0));
      ctx.stroke();
    }

    // Tiny target index ticks.
    if (this.stage && this.stage.list && this.stage.index >= 0) {
      var total = this.stage.list.length;
      var idx = Math.min(this.stage.index, total - 1);
      ctx.fillStyle = rgba(color, 0.55);
      ctx.font = '600 10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText((idx + 1) + '/' + total, pos.x, pos.y - rp * 1.8);
    }
  };

  AimEngine.prototype._drawCrosshair = function (ctx, target) {
    var cx = this.width / 2;
    var cy = this.height / 2;
    var onTarget = false;
    if (target) {
      var dist = C.angularDistance(target, this.camera);
      onTarget = dist <= target.radius;
    }
    var color = onTarget ? '#8dffc0' : 'rgba(240, 248, 255, 0.94)';
    var gap = 7;
    var len = 11;

    ctx.save();
    ctx.translate(cx, cy);
    // Dark outline for readability on any background.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-gap - len, 0);
    ctx.lineTo(-gap, 0);
    ctx.moveTo(gap, 0);
    ctx.lineTo(gap + len, 0);
    ctx.moveTo(0, -gap - len);
    ctx.lineTo(0, -gap);
    ctx.moveTo(0, gap);
    ctx.lineTo(0, gap + len);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-gap - len, 0);
    ctx.lineTo(-gap, 0);
    ctx.moveTo(gap, 0);
    ctx.lineTo(gap + len, 0);
    ctx.moveTo(0, -gap - len);
    ctx.lineTo(0, -gap);
    ctx.moveTo(0, gap);
    ctx.lineTo(0, gap + len);
    ctx.stroke();

    ctx.fillStyle = onTarget ? '#8dffc0' : 'rgba(240, 248, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();

    if (onTarget) {
      var t = (this.stage ? this.stage.elapsed : 0) * 5;
      ctx.strokeStyle = 'rgba(141, 255, 192, ' + (0.25 + 0.15 * Math.sin(t)) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };

  AimEngine.prototype._drawFlashes = function (ctx) {
    var cx = this.width / 2;
    var cy = this.height / 2;
    if (this.hitFlash > 0) {
      var a = this.hitFlash / 0.26;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = 'rgba(150, 255, 190, ' + a + ')';
      ctx.lineWidth = 2.2;
      var o = 8;
      var l = 9;
      ctx.beginPath();
      ctx.moveTo(-o - l, -o - l);
      ctx.lineTo(-o, -o);
      ctx.moveTo(o, o);
      ctx.lineTo(o + l, o + l);
      ctx.moveTo(-o - l, o + l);
      ctx.lineTo(-o, o);
      ctx.moveTo(o, -o);
      ctx.lineTo(o + l, -o - l);
      ctx.stroke();
      ctx.restore();
    }
    if (this.missFlash > 0) {
      var m = this.missFlash / 0.22;
      ctx.strokeStyle = 'rgba(255, 96, 96, ' + m * 0.9 + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 24 + (1 - m) * 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  AimEngine.prototype.destroy = function () {
    if (typeof window !== 'undefined') window.removeEventListener('resize', this._resize);
    if (this._observer) this._observer.disconnect();
    this.stage = null;
    this.onStageEnd = null;
    this.onEvent = null;
  };

  root.AimEngine = AimEngine;
})(typeof window !== 'undefined' ? window : this);
