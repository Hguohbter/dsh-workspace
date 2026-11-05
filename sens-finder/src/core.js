/*
 * Sens Lab — core math, conversion, battery generation and scoring.
 * Loaded as a classic script in the browser (window.SensCore) and as a
 * CommonJS module in Node for unit tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SensCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Games
   * yaw = degrees of view rotation per mouse count at in-game sens 1.0.
   * Sources: Valorant 0.07, CS2 0.022, Apex 0.022, Overwatch 2 0.0066.
   * ------------------------------------------------------------------ */
  var GAMES = {
    valorant: {
      key: 'valorant',
      name: 'Valorant',
      zh: '无畏契约',
      short: 'VALORANT',
      yaw: 0.07,
      fov: 103,
      color: '#ff5c6c',
      sensDigits: 3
    },
    cs2: {
      key: 'cs2',
      name: 'CS2',
      zh: '反恐精英 2',
      short: 'CS2',
      yaw: 0.022,
      fov: 90,
      color: '#f0b45a',
      sensDigits: 3
    },
    apex: {
      key: 'apex',
      name: 'Apex Legends',
      zh: 'Apex 英雄',
      short: 'APEX',
      yaw: 0.022,
      fov: 110,
      color: '#e4574f',
      sensDigits: 3
    },
    ow2: {
      key: 'ow2',
      name: 'Overwatch 2',
      zh: '守望先锋 2',
      short: 'OW2',
      yaw: 0.0066,
      fov: 103,
      color: '#f5a623',
      sensDigits: 2
    }
  };

  var RANGE_PRESETS = {
    balanced: { key: 'balanced', label: '均衡', min: 18, max: 65, hint: '适合大多数玩家' },
    low: { key: 'low', label: '低敏 / 手臂流', min: 30, max: 80, hint: '大范围转视角' },
    high: { key: 'high', label: '高敏 / 手腕流', min: 12, max: 38, hint: '小范围微操' },
    broad: { key: 'broad', label: '大范围', min: 12, max: 90, hint: '不确定时选这个' }
  };

  var STYLE_WEIGHTS = {
    balanced: { key: 'balanced', label: '均衡', track: 0.4, flick: 0.35, micro: 0.25 },
    tracking: { key: 'tracking', label: '跟枪优先', track: 0.55, flick: 0.25, micro: 0.2 },
    flicking: { key: 'flicking', label: '甩枪优先', track: 0.25, flick: 0.55, micro: 0.2 },
    precision: { key: 'precision', label: '微调优先', track: 0.3, flick: 0.3, micro: 0.4 }
  };

  var MODES = {
    quick: { key: 'quick', label: '快速', points: 5, trackSeconds: 5, flickTargets: 4, microTargets: 4, warmup: false },
    standard: { key: 'standard', label: '标准', points: 7, trackSeconds: 7, flickTargets: 5, microTargets: 5, warmup: true },
    fine: { key: 'fine', label: '精细', points: 9, trackSeconds: 8, flickTargets: 6, microTargets: 6, warmup: true }
  };

  var WORLD = {
    fov: 103,
    yawLimit: 70,
    pitchLimit: 34,
    flickYaw: 36,
    flickPitch: 15,
    microYaw: 30,
    microPitch: 13,
    trackYaw: 33,
    trackPitch: 14
  };

  var TRACK_TARGET_RADIUS = 2.8;
  var FLICK_TARGET_RADIUS = 2.6;
  var MICRO_TARGET_RADIUS = 1.2;

  /* ------------------------------------------------------------------ *
   * Small utilities
   * ------------------------------------------------------------------ */
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function clamp01(v) {
    return clamp(v, 0, 1);
  }

  function round(v, digits) {
    var p = Math.pow(10, digits == null ? 1 : digits);
    return Math.round(v * p) / p;
  }

  function sum(arr) {
    var total = 0;
    for (var i = 0; i < arr.length; i++) total += arr[i];
    return total;
  }

  function mean(arr) {
    return arr.length ? sum(arr) / arr.length : 0;
  }

  function stddev(arr) {
    if (arr.length < 2) return 0;
    var m = mean(arr);
    var acc = 0;
    for (var i = 0; i < arr.length; i++) acc += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(acc / (arr.length - 1));
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function logspace(min, max, n) {
    if (n <= 1) return [min];
    var lo = Math.log(min);
    var hi = Math.log(max);
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push(Math.exp(lo + ((hi - lo) * i) / (n - 1)));
    }
    return out;
    }

  function angularDistance(a, b) {
    var dy = a.yaw - b.yaw;
    var dp = a.pitch - b.pitch;
    return Math.sqrt(dy * dy + dp * dp);
  }

  /* ------------------------------------------------------------------ *
   * Sensitivity conversion
   * ------------------------------------------------------------------ */
  function sensFromCm360(cm360, dpi, yaw) {
    if (!(cm360 > 0) || !(dpi > 0) || !(yaw > 0)) return 0;
    return 914.4 / (dpi * yaw * cm360);
  }

  function cm360FromSens(sens, dpi, yaw) {
    if (!(sens > 0) || !(dpi > 0) || !(yaw > 0)) return 0;
    return 914.4 / (dpi * yaw * sens);
  }

  function edpiFromSens(sens, dpi) {
    return sens * dpi;
  }

  /** Degrees of rotation per raw mouse count for a given cm/360 & DPI. */
  function degPerCount(cm360, dpi) {
    if (!(cm360 > 0) || !(dpi > 0)) return 0;
    return 360 / ((cm360 / 2.54) * dpi);
  }

  /** Pixels per degree for a canvas width and horizontal FOV. */
  function pxPerDeg(width, fov) {
    if (!(width > 0) || !(fov > 0)) return 0;
    return width / fov;
  }

  function sensTable(cm360, dpi) {
    var out = [];
    Object.keys(GAMES).forEach(function (key) {
      var game = GAMES[key];
      var sens = sensFromCm360(cm360, dpi, game.yaw);
      out.push({
        game: game,
        sens: sens,
        edpi: edpiFromSens(sens, dpi),
        sensText: sens.toFixed(game.sensDigits)
      });
    });
    return out;
  }

  function formatCm360(v) {
    return round(v, 1).toFixed(1);
  }

  /* ------------------------------------------------------------------ *
   * Test setup helpers
   * ------------------------------------------------------------------ */
  function resolveRange(opts) {
    opts = opts || {};
    var points = opts.points || MODES.standard.points;
    var current = Number(opts.currentCm360);
    var min;
    var max;
    var source;

    if (opts.preset === 'auto' && current > 0) {
      min = current * 0.7;
      max = current * 1.4;
      if (max / min < 1.55) {
        var mid = Math.sqrt(min * max);
        min = mid / Math.sqrt(1.55);
        max = mid * Math.sqrt(1.55);
      }
      source = 'auto';
    } else {
      var preset = RANGE_PRESETS[opts.preset] || RANGE_PRESETS.balanced;
      min = preset.min;
      max = preset.max;
      source = preset.key;
    }

    if (Number(opts.min) > 0 && Number(opts.max) > 0) {
      min = Number(opts.min);
      max = Number(opts.max);
      source = 'manual';
    }

    min = clamp(min, 6, 140);
    max = clamp(max, 6, 140);
    if (max < min) {
      var tmp = min;
      min = max;
      max = tmp;
    }
    if (max / min < 1.2) max = min * 1.2;
    if (max > 140) {
      max = 140;
      if (max / min < 1.2) min = max / 1.2;
    }

    return {
      min: round(min, 1),
      max: round(max, 1),
      points: points,
      values: logspace(min, max, points).map(function (v) {
        return round(v, 1);
      }),
      source: source
    };
  }

  /**
   * Balanced presentation order: start in the middle, then alternate
   * slower / faster so learning effects are spread across the range.
   */
  function balancedOrder(n) {
    var order = [];
    var mid = Math.floor((n - 1) / 2);
    order.push(mid);
    for (var step = 1; order.length < n; step++) {
      if (mid + step < n) order.push(mid + step);
      if (order.length < n && mid - step >= 0) order.push(mid - step);
    }
    return order;
  }

  function planSession(opts) {
    var mode = MODES[opts.mode] || MODES.standard;
    var range = resolveRange({
      preset: opts.preset,
      currentCm360: opts.currentCm360,
      points: mode.points,
      min: opts.min,
      max: opts.max
    });
    var order = balancedOrder(range.values.length);
    var rounds = order.map(function (idx, position) {
      return {
        index: position,
        cm360: range.values[idx],
        step: idx
      };
    });
    var plan = [];
    if (mode.warmup) {
      plan.push({
        type: 'warmup',
        cm360: range.values[Math.floor((range.values.length - 1) / 2)],
        stageSeconds: Math.max(3, mode.trackSeconds - 3),
        targets: Math.max(3, mode.flickTargets - 1),
        microTargets: Math.max(3, mode.microTargets - 1),
        label: '热身'
      });
    }
    rounds.forEach(function (r) {
      plan.push({
        type: 'round',
        cm360: r.cm360,
        step: r.step,
        index: r.index,
        stageSeconds: mode.trackSeconds,
        targets: mode.flickTargets,
        microTargets: mode.microTargets,
        label: '第 ' + (r.index + 1) + ' / ' + rounds.length + ' 档'
      });
    });
    return {
      mode: mode,
      range: range,
      plan: plan,
      testCount: rounds.length
    };
  }

  function estimateSeconds(plan, mode) {
    var seconds = 0;
    plan.forEach(function (entry) {
      var track = entry.stageSeconds || mode.trackSeconds;
      var flick = entry.targets || mode.flickTargets;
      var micro = entry.microTargets || mode.microTargets;
      // ~1.1 s per flick target, ~1.2 s per micro target, plus transitions.
      seconds += track + flick * 1.1 + micro * 1.2 + 3.4;
    });
    return seconds;
  }

  /* ------------------------------------------------------------------ *
   * Target battery — identical across sensitivities for a fair comparison
   * ------------------------------------------------------------------ */
  function makeBattery(seedKey) {
    var rng = mulberry32(hashString(String(seedKey || 'sens-lab')));
    function rand(lo, hi) {
      return lo + (hi - lo) * rng();
    }
    function pick() {
      return {
        yaw: rand(-WORLD.flickYaw, WORLD.flickYaw),
        pitch: rand(-WORLD.flickPitch, WORLD.flickPitch)
      };
    }

    var track = {
      ampYaw: rand(24, 31),
      ampPitch: rand(9, 12.5),
      w1: rand(0.75, 1.15),
      w2: rand(1.8, 2.6),
      w3: rand(0.9, 1.4),
      w4: rand(2.1, 2.9),
      p1: rand(0, Math.PI * 2),
      p2: rand(0, Math.PI * 2),
      p3: rand(0, Math.PI * 2),
      p4: rand(0, Math.PI * 2)
    };

    var flick = [];
    var prev = { yaw: 0, pitch: 0 };
    for (var i = 0; i < 8; i++) {
      var candidate = null;
      for (var attempt = 0; attempt < 40; attempt++) {
        var c = pick();
        if (angularDistance(c, prev) >= 13) {
          candidate = c;
          break;
        }
      }
      if (!candidate) candidate = pick();
      prev = candidate;
      flick.push({
        yaw: candidate.yaw,
        pitch: candidate.pitch,
        radius: FLICK_TARGET_RADIUS,
        lifetime: 1.8
      });
    }

    var micro = [];
    prev = { yaw: 0, pitch: 0 };
    for (var j = 0; j < 8; j++) {
      var mc = null;
      for (var a2 = 0; a2 < 40; a2++) {
        var cand = {
          yaw: rand(-WORLD.microYaw, WORLD.microYaw),
          pitch: rand(-WORLD.microPitch, WORLD.microPitch)
        };
        if (angularDistance(cand, prev) >= 8) {
          mc = cand;
          break;
        }
      }
      if (!mc) mc = { yaw: 0, pitch: 0 };
      prev = mc;
      micro.push({
        yaw: mc.yaw,
        pitch: mc.pitch,
        radius: MICRO_TARGET_RADIUS,
        dwell: 0.5,
        timeout: 2.7,
        driftAmp: rand(1.4, 3.0),
        driftW: rand(0.9, 1.9),
        driftPhase: rand(0, Math.PI * 2)
      });
    }

    return {
      seed: String(seedKey || 'sens-lab'),
      track: track,
      flick: flick,
      micro: micro,
      trackRadius: TRACK_TARGET_RADIUS
    };
  }

  function trackPosition(track, t) {
    var yaw =
      track.ampYaw *
      (0.62 * Math.sin(track.w1 * t + track.p1) + 0.38 * Math.sin(track.w2 * t + track.p2));
    var pitch =
      track.ampPitch *
      (0.6 * Math.sin(track.w3 * t + track.p3) + 0.4 * Math.cos(track.w4 * t + track.p4));
    return {
      yaw: clamp(yaw, -WORLD.trackYaw, WORLD.trackYaw),
      pitch: clamp(pitch, -WORLD.trackPitch, WORLD.trackPitch)
    };
  }

  function microPosition(spec, t) {
    var offset = spec.driftAmp * Math.sin(spec.driftW * t + spec.driftPhase);
    return {
      yaw: clamp(spec.yaw + offset, -WORLD.microYaw - 4, WORLD.microYaw + 4),
      pitch: spec.pitch + offset * 0.25
    };
  }

  /* ------------------------------------------------------------------ *
   * Scoring
   * ------------------------------------------------------------------ */
  function trackingQuality(distDeg, radiusDeg) {
    var r = Math.max(radiusDeg * 1.8, 0.0001);
    return clamp01(1 - (distDeg / r) * (distDeg / r));
  }

  function scoreTracking(avgQuality, hitFraction) {
    return 100 * clamp01(0.65 * clamp01(avgQuality || 0) + 0.35 * clamp01(hitFraction || 0));
  }

  /** Score one flick shot: 60% precision at the click, 40% speed. */
  function flickShotScore(shot) {
    if (!shot || !shot.hit) return 0;
    var precision = Number.isFinite(shot.precision) ? clamp01(shot.precision) : 0.5;
    var time = Math.max(0, Number(shot.time) || 0);
    var speed = clamp01(1 - Math.max(0, time - 0.25) / 1.3);
    return 100 * clamp01(0.6 * precision + 0.4 * speed);
  }

  function scoreFlick(shots, missClicks) {
    if (!shots || !shots.length) return 0;
    var total = 0;
    for (var i = 0; i < shots.length; i++) total += flickShotScore(shots[i]);
    var base = total / shots.length;
    var penalty = clamp01(1 - (missClicks || 0) * 0.035);
    return clamp(base * penalty, 0, 100);
  }

  /** Score one micro-adjust target: 72% success, 28% how quickly it was held. */
  function microShotScore(shot, dwell, timeout) {
    if (!shot || !shot.hit) return 0;
    var time = Math.max(0, Number(shot.time) || 0);
    var d = Math.max(0.1, Number(dwell) || 0.5);
    var limit = Math.max(d + 0.2, Number(timeout) || 2.7);
    var speed = clamp01(1 - Math.max(0, time - d) / (limit - d));
    return 100 * clamp01(0.72 + 0.28 * speed);
  }

  function scoreMicro(shots, dwell, timeout) {
    if (!shots || !shots.length) return 0;
    var total = 0;
    for (var i = 0; i < shots.length; i++) total += microShotScore(shots[i], dwell, timeout);
    return total / shots.length;
  }

  function combineModes(modes, weights) {
    var w = weights || STYLE_WEIGHTS.balanced;
    var total = 0;
    var weight = 0;
    ['track', 'flick', 'micro'].forEach(function (key) {
      var entry = modes[key];
      if (entry && Number.isFinite(entry.score)) {
        total += entry.score * w[key];
        weight += w[key];
      }
    });
    return weight > 0 ? total / weight : 0;
  }

  /**
   * Fit a smooth curve to score-vs-cm/360 and find the sweet spot.
   * points: [{cm360, score, track, flick, micro}]
   */
  function recommend(points) {
    var usable = (points || []).filter(function (p) {
      return Number.isFinite(p.cm360) && p.cm360 > 0 && Number.isFinite(p.score);
    }).sort(function (a, b) {
      return a.cm360 - b.cm360;
    });

    if (usable.length < 3) {
      return {
        ok: false,
        reason: 'need-3-points',
        points: usable,
        peakCm360: usable.length ? usable.reduce(function (a, b) { return b.score > a.score ? b : a; }).cm360 : 0
      };
    }

    var xs = usable.map(function (p) { return Math.log(p.cm360); });
    var ys = usable.map(function (p) { return p.score; });
    var mx = mean(xs);
    var us = xs.map(function (x) { return x - mx; });
    var n = xs.length;

    var S = [0, 0, 0, 0, 0];
    var T = [0, 0, 0];
    var i;
    for (i = 0; i < n; i++) {
      var u = us[i];
      var u2 = u * u;
      S[0] += 1;
      S[1] += u;
      S[2] += u2;
      S[3] += u2 * u;
      S[4] += u2 * u2;
      T[0] += ys[i];
      T[1] += u * ys[i];
      T[2] += u2 * ys[i];
    }

    var coef = solve3(
      [S[0], S[1], S[2], T[0]],
      [S[1], S[2], S[3], T[1]],
      [S[2], S[3], S[4], T[2]]
    );

    var ok = !!coef;
    var A = ok ? coef[2] : 0;
    var B = ok ? coef[1] : 0;
    var C = ok ? coef[0] : 0;

    var predict = function (cm) {
      var u = Math.log(cm) - mx;
      return A * u * u + B * u + C;
    };

    // R²
    var yMean = mean(ys);
    var ssRes = 0;
    var ssTot = 0;
    for (i = 0; i < n; i++) {
      var pred = A * us[i] * us[i] + B * us[i] + C;
      ssRes += (ys[i] - pred) * (ys[i] - pred);
      ssTot += (ys[i] - yMean) * (ys[i] - yMean);
    }
    var r2 = ssTot > 1e-9 ? clamp01(1 - ssRes / ssTot) : 0;

    var peakU = A < -1e-7 ? -B / (2 * A) : NaN;
    var minX = xs[0];
    var maxX = xs[n - 1];
    var method = 'fit';
    var peakX;

    var fittedPeakX = mx + peakU;
    if (!ok || !Number.isFinite(peakU) || fittedPeakX < minX || fittedPeakX > maxX) {
      method = 'observed';
      var bestIdx = 0;
      for (i = 1; i < n; i++) if (ys[i] > ys[bestIdx]) bestIdx = i;
      peakX = xs[bestIdx];
    } else {
      peakX = fittedPeakX;
    }

    var peakCm360 = Math.exp(peakX);
    var peakScore = Math.max(0, Math.min(100, method === 'fit' ? predict(peakCm360) : Math.max.apply(null, ys)));

    // 97% band around the peak, intersected with the tested range.
    var bandTarget = Math.max(peakScore * 0.97, peakScore - 2.5);
    var band = null;
    if (method === 'fit' && A < 0) {
      var disc = B * B - 4 * A * (C - bandTarget);
      if (disc >= 0) {
        var sq = Math.sqrt(disc);
        var u1 = (-B - sq) / (2 * A);
        var u2 = (-B + sq) / (2 * A);
        var lo = Math.exp(mx + Math.min(u1, u2));
        var hi = Math.exp(mx + Math.max(u1, u2));
        band = {
          min: Math.max(lo, Math.exp(minX)),
          max: Math.min(hi, Math.exp(maxX))
        };
      }
    }
    if (!band) {
      band = { min: peakCm360 * 0.95, max: peakCm360 * 1.05 };
    }

    // Confidence: fit quality + separation between the best points.
    var sortedScores = ys.slice().sort(function (a, b) { return b - a; });
    var gap = sortedScores[0] - (sortedScores[1] != null ? sortedScores[1] : sortedScores[0]);
    var spread = clamp01(gap / 10);
    var conf = clamp01(0.2 + r2 * 0.5 + spread * 0.3 + Math.min(0.1, (n - 3) * 0.03));
    if (method === 'observed') conf = Math.min(conf * 0.55, 0.39);
    var scoreStd = stddev(ys);
    var flat = scoreStd < 2 || peakScore < 5;
    if (flat) conf = Math.min(conf, 0.25);
    var confidence = conf > 0.66 ? 'high' : conf > 0.4 ? 'medium' : 'low';

    return {
      ok: true,
      flat: flat,
      scoreStd: scoreStd,
      points: usable,
      peakCm360: peakCm360,
      peakScore: peakScore,
      band: band,
      confidence: confidence,
      confidenceValue: conf,
      r2: r2,
      method: method,
      curve: {
        predict: predict,
        min: Math.exp(minX),
        max: Math.exp(maxX),
        a: A,
        b: B,
        c: C,
        meanLog: mx
      },
      bestObserved: usable.reduce(function (a, b) { return b.score > a.score ? b : a; }),
      meanScore: yMean
    };
  }

  function solve3(r1, r2, r3) {
    var m = [r1.slice(), r2.slice(), r3.slice()];
    for (var col = 0; col < 3; col++) {
      var pivot = col;
      for (var row = col + 1; row < 3; row++) {
        if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
      }
      if (Math.abs(m[pivot][col]) < 1e-12) return null;
      var tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
      var div = m[col][col];
      for (var k = col; k < 4; k++) m[col][k] /= div;
      for (var r = 0; r < 3; r++) {
        if (r === col) continue;
        var factor = m[r][col];
        if (!factor) continue;
        for (var c = col; c < 4; c++) m[r][c] -= factor * m[col][c];
      }
    }
    return [m[0][3], m[1][3], m[2][3]];
  }

  function confidenceLabel(key) {
    return key === 'high' ? '高' : key === 'medium' ? '中' : '低';
  }

  function grade(score) {
    if (score >= 90) return 'S';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C';
    if (score >= 45) return 'D';
    return 'E';
  }

  function formatDuration(seconds) {
    var s = Math.max(0, Math.round(seconds));
    var m = Math.floor(s / 60);
    var rest = s % 60;
    if (m <= 0) return rest + ' 秒';
    return m + ' 分 ' + (rest < 10 ? '0' : '') + rest + ' 秒';
  }

  return {
    GAMES: GAMES,
    RANGE_PRESETS: RANGE_PRESETS,
    STYLE_WEIGHTS: STYLE_WEIGHTS,
    MODES: MODES,
    WORLD: WORLD,
    TRACK_TARGET_RADIUS: TRACK_TARGET_RADIUS,
    FLICK_TARGET_RADIUS: FLICK_TARGET_RADIUS,
    MICRO_TARGET_RADIUS: MICRO_TARGET_RADIUS,
    clamp: clamp,
    clamp01: clamp01,
    mean: mean,
    stddev: stddev,
    hashString: hashString,
    mulberry32: mulberry32,
    logspace: logspace,
    angularDistance: angularDistance,
    sensFromCm360: sensFromCm360,
    cm360FromSens: cm360FromSens,
    edpiFromSens: edpiFromSens,
    degPerCount: degPerCount,
    pxPerDeg: pxPerDeg,
    sensTable: sensTable,
    formatCm360: formatCm360,
    resolveRange: resolveRange,
    balancedOrder: balancedOrder,
    planSession: planSession,
    estimateSeconds: estimateSeconds,
    makeBattery: makeBattery,
    trackPosition: trackPosition,
    microPosition: microPosition,
    trackingQuality: trackingQuality,
    scoreTracking: scoreTracking,
    flickShotScore: flickShotScore,
    scoreFlick: scoreFlick,
    microShotScore: microShotScore,
    scoreMicro: scoreMicro,
    combineModes: combineModes,
    recommend: recommend,
    confidenceLabel: confidenceLabel,
    grade: grade,
    formatDuration: formatDuration
  };
});
