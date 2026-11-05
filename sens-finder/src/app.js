/*
 * Sens Lab — application controller.
 * Wires the setup form, pointer-lock test session, results, chart and storage.
 */
(function (root) {
  'use strict';

  var C = root.SensCore;
  var AimEngine = root.AimEngine;
  var STORAGE_CONFIG = 'senslab.config.v1';
  var STORAGE_HISTORY = 'senslab.history.v1';
  var STAGES = ['track', 'flick', 'micro'];
  var STAGE_LABELS = { track: '跟枪', flick: '甩枪', micro: '微调' };
  var STAGE_HINTS = {
    track: '让准星保持在移动目标上，越贴近越好',
    flick: '把准星甩到目标上并点击，共 5 个目标',
    micro: '把准星停在移动的小目标中心，保持 0.5 秒'
  };
  var SERIES = [
    { key: 'track', label: '跟枪', color: '#3ee6ff' },
    { key: 'flick', label: '甩枪', color: '#ffb84d' },
    { key: 'micro', label: '微调', color: '#ff6aa9' }
  ];

  function bootError(message) {
    var box = document.getElementById('boot-error');
    if (box) {
      box.hidden = false;
      box.textContent = '脚本错误：' + message;
    }
    try {
      document.documentElement.dataset.bootError = String(message);
    } catch (err) {
      /* ignore */
    }
  }

  window.addEventListener('error', function (event) {
    bootError(event.message || 'unknown error');
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    bootError((reason && reason.message) || String(reason || 'unhandled rejection'));
  });

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function round(v, digits) {
    var p = Math.pow(10, digits == null ? 1 : digits);
    return Math.round(v * p) / p;
  }

  function loadJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* storage can be unavailable on file:// or in private mode */
    }
  }

  function copyText(text) {
    return new Promise(function (resolve, reject) {
      function fallback() {
        try {
          var area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', 'readonly');
          area.style.position = 'fixed';
          area.style.top = '-1000px';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          area.setSelectionRange(0, area.value.length);
          var ok = document.execCommand('copy');
          document.body.removeChild(area);
          if (ok) resolve();
          else reject(new Error('copy command failed'));
        } catch (err) {
          reject(err);
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(resolve, fallback);
      } else {
        fallback();
      }
    });
  }

  function formatDate(iso) {
    var date = iso ? new Date(iso) : new Date();
    if (isNaN(date.getTime())) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return (
      date.getFullYear() +
      '/' + pad(date.getMonth() + 1) +
      '/' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) +
      ':' + pad(date.getMinutes())
    );
  }

  /* ------------------------------------------------------------------ *
   * Sound
   * ------------------------------------------------------------------ */
  function Sound() {
    this.ctx = null;
    this.enabled = true;
  }

  Sound.prototype.ensure = function () {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch (err) {
      return null;
    }
  };

  Sound.prototype.tone = function (freq, duration, type, gain, endFreq, delay) {
    var ctx = this.ensure();
    if (!ctx) return;
    try {
      var start = ctx.currentTime + (delay || 0);
      var osc = ctx.createOscillator();
      var amp = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, start);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(gain || 0.04, start + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    } catch (err) {
      /* audio is cosmetic */
    }
  };

  Sound.prototype.tick = function () {
    if (!this.enabled) return;
    this.tone(520, 0.06, 'square', 0.018);
  };

  Sound.prototype.hit = function () {
    if (!this.enabled) return;
    this.tone(760, 0.07, 'sine', 0.035, 1180);
  };

  Sound.prototype.miss = function () {
    if (!this.enabled) return;
    this.tone(190, 0.09, 'triangle', 0.025, 130);
  };

  Sound.prototype.finish = function () {
    if (!this.enabled) return;
    var self = this;
    [523.25, 659.25, 783.99].forEach(function (f, i) {
      self.tone(f, 0.22, 'sine', 0.03, f * 1.01, i * 0.09);
    });
  };

  /* ------------------------------------------------------------------ *
   * App
   * ------------------------------------------------------------------ */
  function App() {
    this.ui = {
      gameSelect: $('game-select'),
      dpiInput: $('dpi-input'),
      sensInput: $('sens-input'),
      sensHint: $('sens-hint'),
      presetSelect: $('preset-select'),
      styleSelect: $('style-select'),
      minInput: $('min-input'),
      maxInput: $('max-input'),
      setupForm: $('setup-form'),
      setupError: $('setup-error'),
      startBtn: $('start-btn'),
      estimateLabel: $('estimate-label'),
      lastRun: $('last-run'),
      deviceWarning: $('device-warning'),
      previewTable: $('preview-table'),
      previewCm: $('preview-cm'),
      previewRange: $('preview-range'),
      heroCm: $('hero-cm'),
      heroReadout: document.querySelector('.hero-readout small'),
      soundToggle: $('sound-toggle'),
      soundLabel: $('sound-label'),
      arena: $('arena'),
      arenaWrap: $('arena-wrap'),
      overlay: $('arena-overlay'),
      overlayCard: $('overlay-card'),
      overlayKicker: $('overlay-kicker'),
      overlayTitle: $('overlay-title'),
      overlayText: $('overlay-text'),
      overlayActions: $('overlay-actions'),
      lockBadge: $('lock-badge'),
      testRoundLabel: $('test-round-label'),
      testSensLabel: $('test-sens-label'),
      testModeLabel: $('test-mode-label'),
      testTimer: $('test-timer'),
      testProgress: $('test-progress'),
      stagePips: $('stage-pips'),
      pauseBtn: $('pause-btn'),
      quitBtn: $('quit-btn'),
      hint: $('test-hint'),
      targetState: $('target-state'),
      footRound: $('foot-round'),
      footMode: $('foot-mode'),
      footSeed: $('foot-seed'),
      resultMeta: $('result-meta'),
      peakLabel: document.querySelector('.peak-label'),
      resultPeak: $('result-peak'),
      resultScore: $('result-score'),
      resultConfidence: $('result-confidence'),
      resultBand: $('result-band'),
      resultNote: $('result-note'),
      resultDpi: $('result-dpi'),
      resultTable: $('result-table'),
      resultModes: $('result-modes'),
      resultWeights: $('result-weights'),
      resultCount: $('result-count'),
      roundTableBody: $('round-table-body'),
      chart: $('result-chart'),
      chartTooltip: $('chart-tooltip'),
      chartLegend: $('chart-legend'),
      copyHint: document.querySelector('.copy-hint'),
      setupBtn: $('setup-btn'),
      copyBtn: $('copy-btn'),
      exportBtn: $('export-btn'),
      restartBtn: $('restart-btn'),
      screens: {
        setup: $('screen-setup'),
        test: $('screen-test'),
        results: $('screen-results')
      }
    };

    this.sound = new Sound();
    this.engine = new AimEngine(this.ui.arena);
    this.engine.onStageEnd = this.onStageEnd.bind(this);
    this.engine.onEvent = this.onEngineEvent.bind(this);

    this.state = 'setup';
    this.config = null;
    this.session = null;
    this.rounds = [];
    this.recommendation = null;
    this.locked = false;
    this.fallback = false;
    this.lockCallback = null;
    this.lockTimer = null;
    this.pausedState = null;
    this.countdown = 0;
    this.introTimer = 0;
    this.interstitialTimer = 0;
    this.lastCountdown = null;
    this.hudAccum = 0;
    this.chartSeries = { combined: true, track: true, flick: true, micro: true };
    this.chartGeom = null;
    this.chartDrawn = false;
    this.autotest = false;
    this._botRng = C.mulberry32(20261105);

    this.populateSelects();
    this.loadConfig();
    this.bindEvents();
    this.updateSoundButton();
    if (this.ui.deviceWarning && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      this.ui.deviceWarning.hidden = false;
    }
    this.updatePreview();
    this.updateEstimates();
    this.updateLastRun();
    this.showScreen('setup');

    var self = this;
    this.loop = function (ts) {
      var dt = 0;
      if (self._lastTs) dt = Math.min(0.1, Math.max(0, (ts - self._lastTs) / 1000));
      self._lastTs = ts;
      self.tick(dt);
      self._raf = window.requestAnimationFrame(self.loop);
    };
    this._raf = window.requestAnimationFrame(this.loop);

    this.handleQuery();
  }

  /* ------------------------------------------------------------------ *
   * Setup form
   * ------------------------------------------------------------------ */
  App.prototype.populateSelects = function () {
    var game = this.ui.gameSelect;
    game.innerHTML = '';
    Object.keys(C.GAMES).forEach(function (key) {
      var g = C.GAMES[key];
      var option = document.createElement('option');
      option.value = key;
      option.textContent = g.name + ' · ' + g.zh;
      game.appendChild(option);
    });
    var style = this.ui.styleSelect;
    style.innerHTML = '';
    Object.keys(C.STYLE_WEIGHTS).forEach(function (key) {
      var w = C.STYLE_WEIGHTS[key];
      var option = document.createElement('option');
      option.value = key;
      option.textContent = w.label + '（跟枪 ' + Math.round(w.track * 100) + '% / 甩枪 ' + Math.round(w.flick * 100) + '%）';
      style.appendChild(option);
    });
  };

  App.prototype.loadConfig = function () {
    var cfg = loadJSON(STORAGE_CONFIG, null);
    var self = this;
    if (cfg) {
      if (C.GAMES[cfg.game]) this.ui.gameSelect.value = cfg.game;
      if (cfg.dpi > 0) this.ui.dpiInput.value = cfg.dpi;
      if (cfg.sens > 0) this.ui.sensInput.value = cfg.sens;
      if (cfg.preset) this.ui.presetSelect.value = cfg.preset;
      if (cfg.style && C.STYLE_WEIGHTS[cfg.style]) this.ui.styleSelect.value = cfg.style;
      if (cfg.mode) {
        var radio = document.querySelector('input[name="mode"][value="' + cfg.mode + '"]');
        if (radio) radio.checked = true;
      }
      if (cfg.min) this.ui.minInput.value = cfg.min;
      if (cfg.max) this.ui.maxInput.value = cfg.max;
      this.sound.enabled = cfg.sound == null ? true : !!cfg.sound;
    }
    this.refreshDpiChips();
    this.ui.dpiInput.addEventListener('input', function () { self.refreshDpiChips(); });
  };

  App.prototype.refreshDpiChips = function () {
    var value = Number(this.ui.dpiInput.value);
    var chips = this.ui.dpiInput.parentElement.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('is-active', Number(chips[i].dataset.dpi) === value);
    }
  };

  App.prototype.readConfig = function () {
    var modeEl = document.querySelector('input[name="mode"]:checked');
    var sensRaw = this.ui.sensInput.value.trim();
    var minRaw = this.ui.minInput.value.trim();
    var maxRaw = this.ui.maxInput.value.trim();
    return {
      game: this.ui.gameSelect.value,
      dpi: Number(this.ui.dpiInput.value),
      sens: sensRaw === '' ? null : Number(sensRaw),
      preset: this.ui.presetSelect.value,
      mode: modeEl ? modeEl.value : 'standard',
      style: this.ui.styleSelect.value,
      min: minRaw === '' ? null : Number(minRaw),
      max: maxRaw === '' ? null : Number(maxRaw),
      sound: this.sound.enabled
    };
  };

  App.prototype.validateConfig = function (config) {
    if (!C.GAMES[config.game]) return '请选择游戏。';
    if (!Number.isFinite(config.dpi) || config.dpi < 100 || config.dpi > 32000) {
      return 'DPI 需要是 100 – 32000 之间的数字。';
    }
    if (config.sens != null && (!Number.isFinite(config.sens) || config.sens <= 0 || config.sens > 100)) {
      return '当前灵敏度需要是 0 – 100 之间的数字，或留空。';
    }
    if (config.min != null && config.max != null) {
      if (!Number.isFinite(config.min) || !Number.isFinite(config.max)) return 'cm/360 范围需要是数字。';
      if (config.min < 6 || config.max > 140) return 'cm/360 范围建议在 6 – 140 之间。';
      if (config.min >= config.max) return 'cm/360 的最小值需要小于最大值。';
    }
    return null;
  };

  App.prototype.currentCm360 = function () {
    var dpi = Number(this.ui.dpiInput.value);
    var sens = Number(this.ui.sensInput.value);
    var game = C.GAMES[this.ui.gameSelect.value];
    if (!game || !(dpi > 0) || !(sens > 0)) return null;
    return C.cm360FromSens(sens, dpi, game.yaw);
  };

  App.prototype.showSetupError = function (message) {
    this.ui.setupError.hidden = false;
    this.ui.setupError.textContent = message;
  };

  App.prototype.hideSetupError = function () {
    this.ui.setupError.hidden = true;
    this.ui.setupError.textContent = '';
  };

  App.prototype.updatePreview = function () {
    var game = C.GAMES[this.ui.gameSelect.value] || C.GAMES.valorant;
    var dpi = Number(this.ui.dpiInput.value) || 800;
    var sens = Number(this.ui.sensInput.value);
    var cm = this.currentCm360() || 40.8;
    var sample = !this.currentCm360();

    this.ui.previewCm.textContent = (sample ? '示例 ' : '') + cm.toFixed(1) + ' cm / 360°';
    this.ui.heroCm.textContent = cm.toFixed(1);
    if (this.ui.heroReadout) {
      this.ui.heroReadout.textContent = game.short.toUpperCase() + ' · ' + (sample ? '示例' : sens.toFixed(game.sensDigits));
    }
    if (this.ui.sensHint) {
      this.ui.sensHint.classList.toggle('is-active', !sample);
      this.ui.sensHint.textContent = sample
        ? '填写后会自动围绕当前灵敏度生成测试范围'
        : '当前约 ' + cm.toFixed(1) + ' cm/360 · eDPI ' + Math.round(dpi * sens);
    }

    var rows = [];
    Object.keys(C.GAMES).forEach(function (key) {
      var g = C.GAMES[key];
      var value = C.sensFromCm360(cm, dpi, g.yaw);
      rows.push(
        '<div class="preview-row">' +
          '<div class="preview-game"><span class="game-dot" style="background:' + g.color + '"></span>' +
          '<strong>' + g.name + '</strong><small>' + g.zh + '</small></div>' +
          '<div class="preview-val">' + value.toFixed(g.sensDigits) +
          '<small>eDPI ' + Math.round(value * dpi) + '</small></div>' +
        '</div>'
      );
    });
    this.ui.previewTable.innerHTML = rows.join('');
  };

  App.prototype.estimateFor = function (modeKey) {
    var config = this.readConfig();
    var current = this.currentCm360();
    var plan = C.planSession({
      mode: modeKey,
      preset: config.preset,
      currentCm360: current,
      min: config.min,
      max: config.max
    });
    return {
      seconds: C.estimateSeconds(plan.plan, plan.mode),
      count: plan.testCount,
      label: plan.mode.label
    };
  };

  App.prototype.updateEstimates = function () {
    var config = this.readConfig();
    var self = this;
    ['quick', 'standard', 'fine'].forEach(function (key) {
      var info = self.estimateFor(key);
      var el = $('est-' + key);
      if (el) el.textContent = '≈ ' + Math.max(2, Math.round(info.seconds / 60)) + ' 分钟 · ' + info.count + ' 档';
    });
    var selected = this.estimateFor(config.mode);
    this.ui.estimateLabel.textContent =
      C.MODES[config.mode].label + '模式 · ' + selected.count + ' 档 · 约 ' +
      Math.max(2, Math.round(selected.seconds / 60)) + ' 分钟';
    var selectedPlan = C.planSession({
      mode: config.mode,
      preset: config.preset,
      currentCm360: this.currentCm360(),
      min: config.min,
      max: config.max
    });
    var values = selectedPlan.range.values;
    if (this.ui.previewRange) {
      this.ui.previewRange.textContent = '本次测试 ' + values[0].toFixed(1) + ' – ' +
        values[values.length - 1].toFixed(1) + ' cm/360 · ' + selectedPlan.testCount + ' 档' +
        (selectedPlan.mode.warmup ? ' + 热身' : '');
    }
  };

  App.prototype.updateLastRun = function () {
    var history = loadJSON(STORAGE_HISTORY, []);
    if (!Array.isArray(history) || !history.length) {
      this.ui.lastRun.textContent = '还没有测试记录';
      return;
    }
    var last = history[0];
    this.ui.lastRun.textContent =
      '上次：' + (last.peakCm != null ? last.peakCm.toFixed(1) + ' cm/360' : '—') +
      (last.peakScore != null ? ' · ' + last.peakScore + ' 分' : '') +
      ' · ' + formatDate(last.date);
  };

  App.prototype.saveConfig = function (config) {
    saveJSON(STORAGE_CONFIG, {
      game: config.game,
      dpi: config.dpi,
      sens: config.sens,
      preset: config.preset,
      mode: config.mode,
      style: config.style,
      min: config.min,
      max: config.max,
      sound: this.sound.enabled
    });
  };

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */
  App.prototype.bindEvents = function () {
    var self = this;
    var ui = this.ui;

    ui.setupForm.addEventListener('submit', function (event) {
      event.preventDefault();
      self.sound.ensure();
      self.startSession();
    });

    ['input', 'change'].forEach(function (type) {
      ['gameSelect', 'dpiInput', 'sensInput', 'presetSelect', 'styleSelect', 'minInput', 'maxInput'].forEach(function (key) {
        ui[key].addEventListener(type, function () {
          if (type === 'input' && key === 'dpiInput') self.refreshDpiChips();
          self.hideSetupError();
          self.updatePreview();
          self.updateEstimates();
        });
      });
    });

    var chips = document.querySelectorAll('#dpi-chips .chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function (event) {
        var value = event.currentTarget.dataset.dpi;
        ui.dpiInput.value = value;
        self.refreshDpiChips();
        self.updatePreview();
        self.updateEstimates();
      });
    }

    ui.soundToggle.addEventListener('click', function () {
      self.sound.enabled = !self.sound.enabled;
      if (self.sound.enabled) {
        self.sound.ensure();
        self.sound.tick();
      }
      self.updateSoundButton();
      self.saveConfig(self.config || self.readConfig());
    });

    ui.pauseBtn.addEventListener('click', function () { self.pause(); });
    ui.quitBtn.addEventListener('click', function () { self.quitSession(); });

    ui.setupBtn.addEventListener('click', function () { self.returnToSetup(); });
    ui.restartBtn.addEventListener('click', function () { self.startSession(); });
    ui.copyBtn.addEventListener('click', function () { self.copySummary(ui.copyBtn); });
    ui.exportBtn.addEventListener('click', function () { self.exportResults(); });

    ui.chartLegend.addEventListener('click', function (event) {
      var btn = event.target.closest('.legend-item');
      if (!btn) return;
      var key = btn.dataset.series;
      self.chartSeries[key] = !self.chartSeries[key];
      btn.classList.toggle('is-active', self.chartSeries[key]);
      self.drawChart();
    });

    ui.chart.addEventListener('pointermove', function (event) { self.onChartHover(event); });
    ui.chart.addEventListener('pointerleave', function () {
      ui.chartTooltip.hidden = true;
    });

    ui.resultTable.addEventListener('click', function (event) {
      var row = event.target.closest('.sens-row');
      if (!row || !row.dataset.copy) return;
      copyText(row.dataset.copy).then(function () {
        if (ui.copyHint) {
          ui.copyHint.textContent = '已复制：' + row.dataset.copy;
          window.setTimeout(function () {
            ui.copyHint.textContent = '点击任意数值复制 · 区间为推荐范围';
          }, 1600);
        }
      }).catch(function () {
        if (ui.copyHint) ui.copyHint.textContent = '复制失败，请手动选择数值';
      });
    });

    document.getElementById('brand-link').addEventListener('click', function (event) {
      event.preventDefault();
      if (self.state === 'results') self.returnToSetup();
      else if (self.state === 'setup') window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.addEventListener('pointerlockchange', function () { self.onPointerLockChange(); });

    document.addEventListener('mousemove', function (event) {
      if (self.state !== 'running') return;
      if (!self.locked && !self.fallback) return;
      var dx = event.movementX || 0;
      var dy = event.movementY || 0;
      if (dx || dy) self.engine.look(dx, dy);
    });

    ui.arena.addEventListener('mousedown', function (event) {
      if (event.button !== 0) return;
      if (self.state !== 'running') return;
      if (!self.locked && !self.fallback) return;
      event.preventDefault();
      self.engine.handleClick();
    });

    ui.arena.addEventListener('contextmenu', function (event) { event.preventDefault(); });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (self.state === 'paused') {
          event.preventDefault();
          self.resume();
        } else if (self.isSessionActive()) {
          event.preventDefault();
          self.pause();
        }
      } else if (event.key === 'p' || event.key === 'P') {
        if (self.state === 'running' || self.state === 'paused') {
          event.preventDefault();
          if (self.state === 'paused') self.resume();
          else self.pause();
        }
      }
    });

    window.addEventListener('blur', function () {
      if (self.state === 'running' && !self.locked) self.pause();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && self.isSessionActive()) self.pause();
    });
    window.addEventListener('beforeunload', function (event) {
      if (self.isSessionActive() || self.state === 'paused') {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    window.addEventListener('resize', function () {
      if (self.state === 'results') self.drawChart();
    });
  };

  App.prototype.updateSoundButton = function () {
    this.ui.soundToggle.setAttribute('aria-pressed', String(this.sound.enabled));
    this.ui.soundLabel.textContent = this.sound.enabled ? '音效开' : '音效关';
    this.ui.soundToggle.classList.toggle('is-off', !this.sound.enabled);
  };

  App.prototype.onEngineEvent = function (type) {
    if (type === 'hit') this.sound.hit();
    else if (type === 'miss') this.sound.miss();
  };

  /* ------------------------------------------------------------------ *
   * Session lifecycle
   * ------------------------------------------------------------------ */
  App.prototype.startSession = function () {
    var config = this.readConfig();
    var error = this.validateConfig(config);
    if (error) {
      this.showSetupError(error);
      return;
    }
    this.hideSetupError();
    this.saveConfig(config);
    this.config = config;

    var game = C.GAMES[config.game];
    var currentCm = config.sens != null ? C.cm360FromSens(config.sens, config.dpi, game.yaw) : null;
    var planResult = C.planSession({
      mode: config.mode,
      preset: config.preset,
      currentCm360: currentCm,
      min: config.min,
      max: config.max
    });
    var seed = 'sens-lab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    var battery = C.makeBattery(seed);
    var warmupBattery = C.makeBattery(seed + '-warmup');

    this.session = {
      config: config,
      mode: planResult.mode,
      range: planResult.range,
      testCount: planResult.testCount,
      plan: planResult.plan,
      battery: battery,
      warmupBattery: warmupBattery,
      planIndex: -1,
      stageIndex: 0,
      stageResults: {},
      startedAt: Date.now(),
      endedAt: null,
      partial: false
    };
    this.rounds = [];
    this.recommendation = null;
    this.chartSeries = { combined: true, track: true, flick: true, micro: true };
    this.chartDrawn = false;
    this.state = 'starting';

    this.sound.ensure();
    this.showScreen('test');
    this.engine.resize();
    this.engine.setSensitivity({ cm360: planResult.plan[0].cm360, dpi: config.dpi, fov: game.fov });
    this.setRoundHud(planResult.plan[0]);
    this.ui.hint.textContent = '正在请求鼠标锁定…';
    this.ui.testTimer.textContent = '—';
    this.ui.testProgress.style.width = '0%';
    this.setPips(-1, false);
    this.hideOverlay();

    var self = this;
    this.requestLock(function (ok) {
      if (!ok) {
        self.showLockFallback();
      } else {
        self.advancePlan();
      }
    });
  };

  App.prototype.advancePlan = function () {
    this.hideOverlay();
    var session = this.session;
    if (!session) return;
    session.planIndex++;
    if (session.planIndex >= session.plan.length) {
      this.finishSession('complete');
      return;
    }
    session.current = session.plan[session.planIndex];
    session.stageIndex = 0;
    session.stageResults = {};
    this.setRoundHud(session.current);
    this.beginCountdown(session.current);
  };

  App.prototype.beginCountdown = function (entry) {
    var session = this.session;
    var config = session.config;
    var game = C.GAMES[config.game];
    var sens = C.sensFromCm360(entry.cm360, config.dpi, game.yaw);
    var warmup = entry.type === 'warmup';

    this.ui.testRoundLabel.textContent = warmup ? '热身 · 不计入结果' : '第 ' + (entry.index + 1) + ' / ' + session.testCount + ' 档';
    this.ui.testSensLabel.textContent =
      entry.cm360.toFixed(1) + ' cm/360 · ' + game.short.toUpperCase() + ' ' + sens.toFixed(game.sensDigits);
    this.ui.footRound.textContent = warmup ? '热身' : (entry.index + 1) + ' / ' + session.testCount;
    this.ui.testModeLabel.textContent = '准备';
    this.ui.testModeLabel.dataset.mode = '';
    this.ui.testTimer.textContent = '—';
    this.ui.hint.textContent = '坐姿放松，把鼠标放在舒服的位置';
    this.ui.targetState.classList.remove('is-on');
    this.ui.targetState.querySelector('span').textContent = '待机';
    this.setPips(-1, false);
    this.lastCountdown = null;
    this.countdown = warmup ? 2.4 : 3.2;
    this.state = 'countdown';

    this.showOverlay({
      countdown: true,
      kicker: warmup ? 'WARM UP · 不计入结果' : 'READY · ' + (entry.index + 1) + '/' + session.testCount,
      title: '3',
      text: warmup
        ? '热身：' + entry.cm360.toFixed(1) + ' cm/360 · 熟悉手感与目标'
        : entry.cm360.toFixed(1) + ' cm/360 · ' + game.short + ' ' + sens.toFixed(game.sensDigits),
      actions: []
    });
    this.sound.tick();
  };

  App.prototype.startStage = function (stageIndex) {
    var session = this.session;
    if (!session || !session.current) return;
    session.stageIndex = stageIndex;
    var mode = STAGES[stageIndex];
    var entry = session.current;
    var modeInfo = session.mode;
    var seconds = entry.stageSeconds || modeInfo.trackSeconds;
    var count = mode === 'flick' ? entry.targets : entry.microTargets;
    var game = C.GAMES[session.config.game];

    this.engine.setSensitivity({ cm360: entry.cm360, dpi: session.config.dpi, fov: game.fov });
    var stageBattery = entry.type === 'warmup' && session.warmupBattery ? session.warmupBattery : session.battery;
    this.engine.startStage(mode, stageBattery, { seconds: seconds, count: count });
    this.state = 'running';
    this.hideOverlay();

    this.ui.testModeLabel.textContent = STAGE_LABELS[mode];
    this.ui.testModeLabel.dataset.mode = mode;
    this.ui.testTimer.textContent = mode === 'track' ? seconds.toFixed(1) + 's' : '0/' + count;
    this.ui.hint.textContent =
      mode === 'flick'
        ? '快速点击目标 · 共 ' + count + ' 个 · 点空也能重试'
        : mode === 'micro'
          ? '把准星停在目标中心 · 保持 0.5 秒'
          : '准星压住移动目标 · 持续 ' + seconds + ' 秒';
    this.ui.targetState.querySelector('span').textContent = '偏离';
    this.ui.targetState.classList.remove('is-on');
    this.setPips(stageIndex, false);
    this.updateHud(1);
    this.sound.tick();
  };

  App.prototype.onStageEnd = function (result) {
    var session = this.session;
    if (!session || this.state !== 'running') return;
    session.stageResults[result.mode] = result;
    if (session.stageIndex < 2) {
      session.stageIndex++;
      var nextMode = STAGES[session.stageIndex];
      this.state = 'stage-intro';
      this.introTimer = 1.15;
      this.ui.testModeLabel.textContent = STAGE_LABELS[nextMode];
      this.ui.testModeLabel.dataset.mode = nextMode;
      this.ui.testTimer.textContent = '—';
      this.ui.hint.textContent = STAGE_HINTS[nextMode];
      this.ui.targetState.classList.remove('is-on');
      this.ui.targetState.querySelector('span').textContent = '待机';
      this.setPips(session.stageIndex, false);
      this.showOverlay({
        kicker: 'NEXT DRILL · ' + STAGE_LABELS[nextMode],
        title: STAGE_LABELS[nextMode],
        text: STAGE_HINTS[nextMode] + '。本轮灵敏度不变。',
        actions: []
      });
    } else {
      this.completeRound();
    }
  };

  App.prototype.completeRound = function () {
    var session = this.session;
    var entry = session.current;
    var weights = C.STYLE_WEIGHTS[session.config.style] || C.STYLE_WEIGHTS.balanced;
    var score = C.combineModes(session.stageResults, weights);
    var warmup = entry.type === 'warmup';

    if (!warmup) {
      this.rounds.push({
        order: this.rounds.length + 1,
        cm360: entry.cm360,
        step: entry.step,
        score: score,
        track: session.stageResults.track,
        flick: session.stageResults.flick,
        micro: session.stageResults.micro
      });
    }

    this.setPips(2, true);
    if (session.planIndex >= session.plan.length - 1) {
      this.finishSession('complete');
      return;
    }

    var nextEntry = session.plan[session.planIndex + 1];
    var nextSens = C.sensFromCm360(nextEntry.cm360, session.config.dpi, C.GAMES[session.config.game].yaw);
    this.state = 'interstitial';
    this.interstitialTimer = warmup ? 1.8 : 2.5;
    var stats = [
      { label: warmup ? '热身综合' : '综合', value: Math.round(score) },
      { label: '跟枪', value: Math.round(session.stageResults.track.score) },
      { label: '甩枪', value: Math.round(session.stageResults.flick.score) },
      { label: '微调', value: Math.round(session.stageResults.micro.score) }
    ];
    this.showOverlay({
      kicker: warmup ? 'WARM UP DONE' : 'DRILL COMPLETE · ' + (entry.index + 1) + '/' + session.testCount,
      title: warmup ? '热身完成' : Math.round(score) + ' 分',
      text: warmup
        ? '接下来是正式测试：' + nextEntry.cm360.toFixed(1) + ' cm/360。'
        : '下一档：' + nextEntry.cm360.toFixed(1) + ' cm/360 · ' + C.GAMES[session.config.game].short + ' ' + nextSens.toFixed(C.GAMES[session.config.game].sensDigits),
      stats: stats,
      actions: [{ label: '继续', primary: true, onClick: this.nextFromInterstitial.bind(this) }]
    });
    this.updateHud(1);
  };

  App.prototype.nextFromInterstitial = function () {
    if (this.state !== 'interstitial') return;
    this.hideOverlay();
    this.advancePlan();
  };

  App.prototype.finishSession = function (reason) {
    if (!this.session || this.state === 'results') return;
    if (this.rounds.length === 0) {
      this.returnToSetup();
      return;
    }
    this.state = 'results';
    this.engine.abortStage();
    this.exitPointerLock();
    this.hideOverlay();
    document.body.classList.remove('is-testing');

    var session = this.session;
    session.endedAt = Date.now();
    session.partial = this.rounds.length < session.testCount;
    session.endReason = reason;
    this.recommendation = C.recommend(this.buildPoints());
    this.showScreen('results');
    this.renderResults();
    this.drawChart();
    if (!this.autotest) this.saveHistory();
    this.sound.finish();
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  App.prototype.quitSession = function () {
    if (this.state === 'paused') this.hideOverlay();
    if (!this.session || this.rounds.length === 0) {
      this.returnToSetup();
      return;
    }
    this.finishSession('quit');
  };

  App.prototype.returnToSetup = function () {
    this.state = 'setup';
    this.session = null;
    this.rounds = [];
    this.recommendation = null;
    this.engine.abortStage();
    this.exitPointerLock();
    this.hideOverlay();
    this.showScreen('setup');
    this.updatePreview();
    this.updateEstimates();
    this.updateLastRun();
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  App.prototype.isSessionActive = function () {
    return (
      this.state === 'running' ||
      this.state === 'countdown' ||
      this.state === 'stage-intro' ||
      this.state === 'interstitial' ||
      this.state === 'starting'
    );
  };

  /* ------------------------------------------------------------------ *
   * Pause / pointer lock
   * ------------------------------------------------------------------ */
  App.prototype.pause = function () {
    if (!this.isSessionActive()) return;
    this.pausedState = this.state;
    this.state = 'paused';
    this.exitPointerLock();
    var session = this.session;
    var stats = session && session.stageResults && session.stageResults.track
      ? [
          { label: '已完成', value: this.rounds.length + ' 档' },
          { label: '计划', value: session.testCount + ' 档' }
        ]
      : [];
    this.showOverlay({
      kicker: 'PAUSED',
      title: '已暂停',
      text: '计时已停止。继续后会从当前进度接着测。',
      stats: stats,
      actions: [
        { label: '继续测试', primary: true, onClick: this.resume.bind(this) },
        { label: '结束测试', onClick: this.quitSession.bind(this) }
      ]
    });
    this.updateHud(1);
  };

  App.prototype.resume = function () {
    if (this.state !== 'paused') return;
    var self = this;
    this.requestLock(function (ok) {
      if (!ok) {
        self.fallback = true;
      } else {
        self.fallback = false;
      }
      self.state = self.pausedState || 'running';
      self.pausedState = null;
      self.hideOverlay();
      self.updateHud(1);
    });
  };

  App.prototype.requestLock = function (callback) {
    if (this.autotest) {
      callback(true);
      return;
    }
    if (document.pointerLockElement === this.ui.arena) {
      this.locked = true;
      callback(true);
      return;
    }
    this.lockCallback = callback;
    this.fallback = false;
    var self = this;
    var arena = this.ui.arena;
    try {
      var promise = arena.requestPointerLock({ unadjustedMovement: true });
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function () { self.retryLock(); });
      }
    } catch (err) {
      this.retryLock();
    }
    window.clearTimeout(this.lockTimer);
    this.lockTimer = window.setTimeout(function () {
      if (self.lockCallback) {
        self.fallback = true;
        self.resolveLock(false);
      }
    }, 1200);
  };

  App.prototype.retryLock = function () {
    if (!this.lockCallback) return;
    var self = this;
    try {
      var promise = this.ui.arena.requestPointerLock();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function () {
          self.fallback = true;
          self.resolveLock(false);
        });
      }
    } catch (err) {
      this.fallback = true;
      this.resolveLock(false);
    }
  };

  App.prototype.resolveLock = function (ok) {
    var callback = this.lockCallback;
    this.lockCallback = null;
    window.clearTimeout(this.lockTimer);
    if (callback) callback(ok);
  };

  App.prototype.onPointerLockChange = function () {
    var locked = document.pointerLockElement === this.ui.arena;
    this.locked = locked;
    this.ui.lockBadge.hidden = !locked;
    if (locked) {
      this.fallback = false;
      this.resolveLock(true);
      return;
    }
    if (this.isSessionActive()) this.pause();
  };

  App.prototype.exitPointerLock = function () {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch (err) {
        /* ignore */
      }
    }
    this.locked = false;
    this.ui.lockBadge.hidden = true;
  };

  App.prototype.showLockFallback = function () {
    var self = this;
    this.state = 'starting';
    this.showOverlay({
      kicker: 'MOUSE LOCK',
      title: '无法锁定鼠标',
      text: '浏览器拒绝了鼠标锁定（常见于无痕窗口、权限限制，或页面没有被用户激活）。可以重试，或使用页面内鼠标模式继续；后者在鼠标移动到屏幕边缘时转向会受限。',
      actions: [
        {
          label: '重试锁定',
          primary: true,
          onClick: function () {
            self.showOverlay({
              kicker: 'MOUSE LOCK',
              title: '正在锁定…',
              text: '如果浏览器弹出授权提示，请允许。',
              actions: []
            });
            self.requestLock(function (ok) {
              if (ok) self.advancePlan();
              else self.showLockFallback();
            });
          }
        },
        {
          label: '使用鼠标模式',
          onClick: function () {
            self.fallback = true;
            self.hideOverlay();
            self.advancePlan();
          }
        }
      ]
    });
  };

  /* ------------------------------------------------------------------ *
   * Tick / HUD
   * ------------------------------------------------------------------ */
  App.prototype.tick = function (dt) {
    var state = this.state;
    if (state === 'running') {
      this.engine.update(dt);
      this.engine.draw();
    } else if (state === 'countdown') {
      this.countdown -= dt;
      var n = Math.ceil(this.countdown);
      if (n !== this.lastCountdown) {
        this.lastCountdown = n;
        if (n > 0) {
          this.ui.overlayTitle.textContent = String(n);
          this.sound.tick();
        }
      }
      if (this.countdown <= 0) {
        this.hideOverlay();
        this.startStage(0);
      }
    } else if (state === 'stage-intro') {
      this.introTimer -= dt;
      if (this.introTimer <= 0) {
        this.hideOverlay();
        this.startStage(this.session.stageIndex);
      }
    } else if (state === 'interstitial') {
      this.interstitialTimer -= dt;
      if (this.interstitialTimer <= 0) this.nextFromInterstitial();
    }
    this.updateHud(dt);
  };

  App.prototype.setPips = function (activeIndex, allDone) {
    var pips = this.ui.stagePips.querySelectorAll('span');
    for (var i = 0; i < pips.length; i++) {
      pips[i].classList.toggle('is-done', allDone || i < activeIndex);
      pips[i].classList.toggle('is-active', !allDone && i === activeIndex);
    }
  };

  App.prototype.setRoundHud = function (entry) {
    var session = this.session;
    if (!session || !entry) return;
    var game = C.GAMES[session.config.game];
    var sens = C.sensFromCm360(entry.cm360, session.config.dpi, game.yaw);
    var warmup = entry.type === 'warmup';
    this.ui.testRoundLabel.textContent = warmup ? '热身 · 不计入结果' : '第 ' + (entry.index + 1) + ' / ' + session.testCount + ' 档';
    this.ui.testSensLabel.textContent =
      entry.cm360.toFixed(1) + ' cm/360 · ' + game.short.toUpperCase() + ' ' + sens.toFixed(game.sensDigits);
    this.ui.footRound.textContent = warmup ? '热身' : (entry.index + 1) + ' / ' + session.testCount;
    this.ui.footMode.textContent = session.mode.label;
    this.ui.footSeed.textContent = session.battery.seed.slice(-6).toUpperCase();
  };

  App.prototype.updateHud = function (dt) {
    this.hudAccum += dt;
    if (this.hudAccum < 0.07) return;
    this.hudAccum = 0;
    var session = this.session;
    if (!session) return;

    var stage = this.engine.stage;
    var hud = stage ? this.engine.hud() : null;
    var config = session.config;
    var progress = 0;
    var planLength = session.plan.length;
    var base = Math.max(0, session.planIndex);

    if (this.state === 'running' && hud) {
      if (hud.mode === 'track') {
        this.ui.testTimer.textContent = hud.timeLeft.toFixed(1) + 's';
      } else {
        var stageRef = this.engine.stage;
        var currentTarget = stageRef && stageRef.index >= 0 ? Math.min(stageRef.index + 1, hud.shotsTotal) : hud.shotsDone;
        this.ui.testTimer.textContent = currentTarget + '/' + hud.shotsTotal;
      }
      if (hud.mode === 'track') {
        progress = (base + (session.stageIndex + clamp(stage.elapsed / stage.duration, 0, 1)) / 3) / planLength;
      } else {
        progress = (base + (session.stageIndex + clamp(hud.shotsDone / Math.max(1, hud.shotsTotal), 0, 1)) / 3) / planLength;
      }
      var on = !!hud.onTarget;
      this.ui.targetState.classList.toggle('is-on', on);
      this.ui.targetState.querySelector('span').textContent = on ? '命中' : '偏离';
    } else if (this.state === 'countdown') {
      progress = base / planLength;
    } else if (this.state === 'stage-intro') {
      progress = (base + session.stageIndex / 3) / planLength;
    } else if (this.state === 'interstitial') {
      progress = (base + 1) / planLength;
    } else if (this.state === 'paused') {
      progress = (base + (session.stageIndex + 0) / 3) / planLength;
      this.ui.targetState.classList.remove('is-on');
      this.ui.targetState.querySelector('span').textContent = '暂停';
    }

    this.ui.testProgress.style.width = (clamp(progress, 0, 1) * 100).toFixed(1) + '%';
  };

  /* ------------------------------------------------------------------ *
   * Results
   * ------------------------------------------------------------------ */
  App.prototype.buildPoints = function () {
    return this.rounds.map(function (r) {
      return {
        cm360: r.cm360,
        score: r.score,
        track: r.track.score,
        flick: r.flick.score,
        micro: r.micro.score
      };
    });
  };

  App.prototype.renderResults = function () {
    var rec = this.recommendation;
    var session = this.session;
    if (!session) return;
    var config = session.config;
    var game = C.GAMES[config.game];
    var dpi = config.dpi;
    var counts = this.rounds.length;
    var style = C.STYLE_WEIGHTS[config.style] || C.STYLE_WEIGHTS.balanced;
    var bestRound = this.rounds.reduce(function (a, b) { return b.score > a.score ? b : a; }, this.rounds[0]);

    this.ui.resultMeta.textContent =
      game.name + ' · ' + dpi + ' DPI · ' + session.mode.label + '模式 · ' + counts + ' 档 · ' +
      style.label + '加权 · ' + formatDate(new Date(session.endedAt || Date.now()).toISOString());

    var peakCm = rec.ok ? rec.peakCm360 : bestRound.cm360;
    var peakScore = rec.ok ? rec.peakScore : bestRound.score;
    var band = rec.ok ? rec.band : null;
    this.ui.resultPeak.textContent = peakCm.toFixed(1);
    this.ui.resultScore.textContent = rec.ok ? '峰值评分 ' + peakScore.toFixed(1) : '本档综合 ' + peakScore.toFixed(1);
    if (this.ui.peakLabel) this.ui.peakLabel.textContent = !rec.ok ? '数据不足 · 实测最佳' : rec.flat ? '参考值 · 区分度低' : '推荐灵敏度';
    this.ui.resultBand.textContent = band
      ? band.min.toFixed(1) + ' – ' + band.max.toFixed(1) + ' cm/360'
      : '需要至少 3 档数据';
    this.ui.resultDpi.textContent = 'DPI ' + dpi;
    this.ui.resultCount.textContent = counts + ' 档 · 用时 ' + C.formatDuration(((session.endedAt || Date.now()) - session.startedAt) / 1000);

    var confidence = this.ui.resultConfidence;
    if (!rec.ok) {
      confidence.textContent = '数据不足';
      confidence.dataset.level = 'low';
    } else if (rec.flat) {
      confidence.textContent = '区分度低';
      confidence.dataset.level = 'low';
    } else if (rec.method === 'observed') {
      confidence.textContent = '置信度 ' + C.confidenceLabel(rec.confidence) + ' · 趋势外推';
      confidence.dataset.level = rec.confidence;
    } else {
      confidence.textContent = '置信度 ' + C.confidenceLabel(rec.confidence) + ' · R² ' + rec.r2.toFixed(2);
      confidence.dataset.level = rec.confidence;
    }

    var note = [];
    if (session.partial) {
      note.push('提前结束：计划 ' + session.testCount + ' 档，实际完成 ' + counts + ' 档，建议补测。');
    }
    if (!rec.ok) {
      note.push('至少完成 3 档才能拟合曲线，当前只显示实测最高分。');
    } else if (rec.method === 'observed') {
      note.push('各档得分更接近单调趋势，推荐取实测最高的一档；可在其附近补测两档确认。');
    } else {
      note.push('曲线为 ' + counts + ' 档数据的二次拟合（R² ' + rec.r2.toFixed(2) + '），区间是拟合得分 ≥ 峰值 97% 的范围。');
    }
    if (rec.ok && rec.flat) {
      note.push('各档得分过于接近（标准差 ' + rec.scoreStd.toFixed(1) + '），当前数值只能作为参考；请确认测试时正常移动鼠标后再测一次。');
    }
    if (rec.ok && rec.bestObserved && Math.abs(rec.bestObserved.cm360 - peakCm) / peakCm > 0.06) {
      note.push('实测最高为 ' + rec.bestObserved.cm360.toFixed(1) + ' cm/360（' + rec.bestObserved.score.toFixed(1) + ' 分），与拟合峰值不同时可两档都试。');
    }
    if (rec.ok && rec.band && rec.band.max / rec.band.min > 2.2) {
      note.push('各档差距较小，推荐区间较宽；优先从实测最高档开始微调。');
    }
    if (session.config.mode === 'quick') {
      note.push('快速模式样本较少，建议用标准模式复测一次。');
    }
    this.ui.resultNote.textContent = note.join(' ');

    // Conversion table
    var table = C.sensTable(peakCm, dpi);
    var rows = table.map(function (item) {
      var g = item.game;
      var bandLow = band ? C.sensFromCm360(band.max, dpi, g.yaw) : null;
      var bandHigh = band ? C.sensFromCm360(band.min, dpi, g.yaw) : null;
      var copyValue = g.name + ' ' + item.sens.toFixed(g.sensDigits);
      return (
        '<div class="sens-row" data-copy="' + copyValue + '" title="点击复制">' +
          '<div class="sens-game"><span class="game-dot" style="background:' + g.color + '"></span>' +
            '<div><strong>' + g.name + '</strong><small>' + g.zh + ' · eDPI</small></div></div>' +
          '<div class="sens-number">' + item.sens.toFixed(g.sensDigits) +
            '<small>' + (band ? bandLow.toFixed(g.sensDigits) + ' – ' + bandHigh.toFixed(g.sensDigits) : '—') + '</small></div>' +
          '<div class="sens-edpi">' + Math.round(item.sens * dpi) + '<small>eDPI</small></div>' +
        '</div>'
      );
    });
    this.ui.resultTable.innerHTML = rows.join('');

    // Best per mode
    var modeLabels = { track: '跟枪', flick: '甩枪', micro: '微调' };
    this.ui.resultModes.innerHTML = SERIES.map(function (series) {
      var best = this.rounds.reduce(function (a, b) {
        return b[series.key].score > a[series.key].score ? b : a;
      }, this.rounds[0]);
      return (
        '<div class="mode-best-card" data-mode="' + series.key + '">' +
          '<div class="mode-best-top"><span>' + modeLabels[series.key] + '</span><strong>最佳 ' + best.cm360.toFixed(1) + ' cm/360</strong></div>' +
          '<div class="mode-best-bottom"><b>' + best[series.key].score.toFixed(1) + '</b><span>得分</span></div>' +
        '</div>'
      );
    }.bind(this)).join('');

    // Weights
    this.ui.resultWeights.innerHTML = [
      { key: 'track', label: '跟枪' },
      { key: 'flick', label: '甩枪' },
      { key: 'micro', label: '微调' }
    ].map(function (row) {
      var pct = Math.round(style[row.key] * 100);
      return (
        '<div class="weight-row" data-mode="' + row.key + '"><span>' + row.label + '</span>' +
          '<div class="weight-bar"><span style="width:' + pct + '%"></span></div><b>' + pct + '%</b></div>'
      );
    }).join('');

    // Round table
    var tableRows = this.rounds.slice().sort(function (a, b) { return a.cm360 - b.cm360; });
    this.ui.roundTableBody.innerHTML = tableRows.map(function (r) {
      var grade = C.grade(r.score);
      return (
        '<tr>' +
          '<td>' + r.order + '</td>' +
          '<td class="cm">' + r.cm360.toFixed(1) + '</td>' +
          '<td><span class="score-cell"><span class="score-bar"><span style="width:' + clamp(r.score, 0, 100).toFixed(1) + '%"></span></span><b>' + r.score.toFixed(1) + '</b></span></td>' +
          '<td>' + r.track.score.toFixed(0) + '</td>' +
          '<td>' + r.flick.score.toFixed(0) + '</td>' +
          '<td>' + r.micro.score.toFixed(0) + '</td>' +
          '<td><span class="grade" data-grade="' + grade + '">' + grade + '</span></td>' +
        '</tr>'
      );
    }).join('');

    // Legend state
    var legend = this.ui.chartLegend.querySelectorAll('.legend-item');
    for (var i = 0; i < legend.length; i++) {
      legend[i].classList.toggle('is-active', !!this.chartSeries[legend[i].dataset.series]);
    }
  };

  App.prototype.drawChart = function () {
    var canvas = this.ui.chart;
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var w = Math.round(rect.width || 0);
    var h = Math.round(rect.height || 0);
    if (!w || !h) {
      this.chartDrawn = false;
      return;
    }
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var points = this.rounds.slice().sort(function (a, b) { return a.cm360 - b.cm360; });
    var pad = { l: 44, r: 22, t: 28, b: 36 };
    var plotW = w - pad.l - pad.r;
    var plotH = h - pad.t - pad.b;
    if (!points.length || plotW <= 0 || plotH <= 0) return;

    var cmMin = points[0].cm360;
    var cmMax = points[points.length - 1].cm360;
    var xMin = cmMin * 0.92;
    var xMax = cmMax * 1.08;
    var rec = this.recommendation;
    if (rec && rec.ok) {
      xMin = Math.min(xMin, rec.curve.min);
      xMax = Math.max(xMax, rec.curve.max);
    }
    xMin = Math.max(6, xMin);
    xMax = Math.min(140, xMax);
    if (xMax <= xMin) xMax = xMin * 1.2;

    var logMin = Math.log(xMin);
    var logMax = Math.log(xMax);
    var xOf = function (cm) {
      return pad.l + ((Math.log(cm) - logMin) / (logMax - logMin)) * plotW;
    };

    // Keep a 0-100 axis when scores are spread out, but zoom in when every
    // drill lands in a narrow band so the sweet spot is still readable.
    var scoreList = points.map(function (p) { return p.score; });
    if (rec && rec.ok) scoreList.push(rec.peakScore);
    var lowest = Math.min.apply(null, scoreList);
    var yMin = Math.max(0, Math.floor((lowest - 6) / 10) * 10);
    if (100 - yMin < 25) yMin = 75;
    if (yMin >= 100) yMin = 75;
    var yOf = function (score) {
      return pad.t + (1 - clamp((score - yMin) / (100 - yMin), 0, 1)) * plotH;
    };

    ctx.fillStyle = 'rgba(4, 9, 16, 0.55)';
    ctx.fillRect(pad.l, pad.t, plotW, plotH);

    if (rec && rec.ok && rec.band) {
      var bx1 = xOf(rec.band.min);
      var bx2 = xOf(rec.band.max);
      var gradient = ctx.createLinearGradient(bx1, 0, bx2, 0);
      gradient.addColorStop(0, 'rgba(62, 230, 255, 0.03)');
      gradient.addColorStop(0.5, 'rgba(62, 230, 255, 0.1)');
      gradient.addColorStop(1, 'rgba(62, 230, 255, 0.03)');
      ctx.fillStyle = gradient;
      ctx.fillRect(bx1, pad.t, bx2 - bx1, plotH);
      ctx.strokeStyle = 'rgba(62, 230, 255, 0.16)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(bx1, pad.t);
      ctx.lineTo(bx1, pad.t + plotH);
      ctx.moveTo(bx2, pad.t);
      ctx.lineTo(bx2, pad.t + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Grid + y labels
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var ti = 0; ti <= 4; ti++) {
      var tickScore = yMin + ((100 - yMin) * ti) / 4;
      var gy = yOf(tickScore);
      ctx.strokeStyle = ti === 0 ? 'rgba(126, 170, 226, 0.22)' : 'rgba(126, 170, 226, 0.08)';
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(pad.l + plotW, gy);
      ctx.stroke();
      ctx.fillStyle = '#5c6d85';
      ctx.fillText(String(Math.round(tickScore)), pad.l - 9, gy);
    }

    // X ticks
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var tickCount = 6;
    for (var i = 0; i < tickCount; i++) {
      var cm = Math.exp(logMin + ((logMax - logMin) * i) / (tickCount - 1));
      var tx = xOf(cm);
      ctx.strokeStyle = 'rgba(126, 170, 226, 0.06)';
      ctx.beginPath();
      ctx.moveTo(tx, pad.t);
      ctx.lineTo(tx, pad.t + plotH);
      ctx.stroke();
      ctx.fillStyle = '#5c6d85';
      ctx.fillText(cm.toFixed(cm < 20 ? 1 : 0), tx, pad.t + plotH + 9);
    }
    if (points.length < 3) {
      ctx.fillStyle = 'rgba(233, 241, 251, 0.5)';
      ctx.font = '600 12px "Microsoft YaHei UI", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('再完成 ' + (3 - points.length) + ' 档，即可生成拟合曲线', pad.l + plotW / 2, pad.t + plotH / 2);
    }
    ctx.fillStyle = '#4a5a70';
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('cm / 360°', pad.l + plotW, pad.t + plotH + 22);
    ctx.textAlign = 'left';
    ctx.fillText('得分', pad.l, pad.t - 16);

    var self = this;
    function drawSeries(key, color, width, dash) {
      if (!self.chartSeries[key]) return;
      // Only the three per-mode series use this helper; each round stores
      // { track: {...}, flick: {...}, micro: {...} }.
      var values = points.map(function (p) { return [p.cm360, p[key].score]; });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      values.forEach(function (pair, index) {
        var px = xOf(pair[0]);
        var py = yOf(pair[1]);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      values.forEach(function (pair) {
        ctx.beginPath();
        ctx.arc(xOf(pair[0]), yOf(pair[1]), 2.4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Mode series (dashed, thin)
    if (this.chartSeries.track) drawSeries('track', 'rgba(62, 230, 255, 0.5)', 1.2, [4, 4]);
    if (this.chartSeries.flick) drawSeries('flick', 'rgba(255, 184, 77, 0.5)', 1.2, [4, 4]);
    if (this.chartSeries.micro) drawSeries('micro', 'rgba(255, 106, 169, 0.5)', 1.2, [4, 4]);

    // Fitted curve
    if (rec && rec.ok && this.chartSeries.combined) {
      var curveGrad = ctx.createLinearGradient(pad.l, 0, pad.l + plotW, 0);
      curveGrad.addColorStop(0, 'rgba(62, 230, 255, 0.35)');
      curveGrad.addColorStop(0.5, 'rgba(141, 255, 192, 0.9)');
      curveGrad.addColorStop(1, 'rgba(62, 230, 255, 0.35)');
      ctx.strokeStyle = curveGrad;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      var steps = 120;
      for (var k = 0; k <= steps; k++) {
        var c = Math.exp(logMin + ((logMax - logMin) * k) / steps);
        var pred = rec.curve.predict(c);
        var px = pad.l + (k / steps) * plotW;
        var py = yOf(pred);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Combined points / line
    if (this.chartSeries.combined) {
      ctx.strokeStyle = 'rgba(233, 241, 251, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      points.forEach(function (p, index) {
        var px = xOf(p.cm360);
        var py = yOf(p.score);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      points.forEach(function (p) {
        var px = xOf(p.cm360);
        var py = yOf(p.score);
        ctx.fillStyle = '#e9f1fb';
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(233, 241, 251, 0.16)';
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Peak marker
    if (rec && rec.ok) {
      var peakX = xOf(rec.peakCm360);
      var peakY = yOf(rec.peakScore);
      ctx.strokeStyle = 'rgba(141, 255, 192, 0.55)';
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(peakX, pad.t);
      ctx.lineTo(peakX, pad.t + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#8dffc0';
      ctx.beginPath();
      ctx.arc(peakX, peakY, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(4, 12, 10, 0.9)';
      ctx.beginPath();
      ctx.arc(peakX, peakY, 2.4, 0, Math.PI * 2);
      ctx.fill();

      var label = '推荐 ' + rec.peakCm360.toFixed(1);
      ctx.font = '600 10px ui-monospace, Consolas, monospace';
      var labelWidth = ctx.measureText(label).width + 14;
      var labelX = clamp(peakX - labelWidth / 2, pad.l + 4, pad.l + plotW - labelWidth - 4);
      var labelY = pad.t + 4;
      ctx.fillStyle = 'rgba(8, 24, 24, 0.92)';
      ctx.strokeStyle = 'rgba(141, 255, 192, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(labelX, labelY, labelWidth, 20, 5) : ctx.rect(labelX, labelY, labelWidth, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#8dffc0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, labelX + labelWidth / 2, labelY + 10);
    }

    this.chartGeom = { xOf: xOf, yOf: yOf, points: points, pad: pad, plotW: plotW, plotH: plotH, w: w, h: h };
    this.chartDrawn = true;
    this.chartSize = { w: w, h: h };
  };

  App.prototype.onChartHover = function (event) {
    var geom = this.chartGeom;
    var tooltip = this.ui.chartTooltip;
    if (!geom || !this.rounds.length) {
      tooltip.hidden = true;
      return;
    }
    var rect = this.ui.chart.getBoundingClientRect();
    var mx = event.clientX - rect.left;
    var my = event.clientY - rect.top;
    var best = null;
    var bestDist = 26;
    geom.points.forEach(function (p) {
      var px = geom.xOf(p.cm360);
      var py = geom.yOf(p.score);
      var dist = Math.sqrt((px - mx) * (px - mx) + (py - my) * (py - my));
      if (dist < bestDist) {
        bestDist = dist;
        best = { p: p, x: px, y: py };
      }
    });
    if (!best) {
      tooltip.hidden = true;
      return;
    }
    var p = best.p;
    tooltip.innerHTML =
      '<div class="tooltip-row"><span>灵敏度</span><span><b>' + p.cm360.toFixed(1) + '</b> cm/360</span></div>' +
      '<div class="tooltip-row"><span>综合</span><span><b>' + p.score.toFixed(1) + '</b></span></div>' +
      '<div class="tooltip-row"><span>跟枪</span><span>' + p.track.score.toFixed(1) + '</span></div>' +
      '<div class="tooltip-row"><span>甩枪</span><span>' + p.flick.score.toFixed(1) + '</span></div>' +
      '<div class="tooltip-row"><span>微调</span><span>' + p.micro.score.toFixed(1) + '</span></div>';
    tooltip.hidden = false;
    tooltip.style.left = clamp(best.x, 90, geom.w - 90) + 'px';
    tooltip.style.top = Math.max(46, best.y - 12) + 'px';
  };

  /* ------------------------------------------------------------------ *
   * Copy / export / storage
   * ------------------------------------------------------------------ */
  App.prototype.summaryText = function () {
    var rec = this.recommendation;
    var session = this.session;
    if (!session) return '';
    var config = session.config;
    var game = C.GAMES[config.game];
    if (!rec || !rec.ok) {
      return 'SENS LAB 测试结论\n数据不足，至少完成 3 档才能给出推荐。';
    }
    var lines = [
      'SENS LAB · 灵敏度测试结论',
      '游戏：' + game.name + '｜DPI ' + config.dpi + '｜' + session.mode.label + '模式 ' + this.rounds.length + ' 档',
      '推荐：' + rec.peakCm360.toFixed(1) + ' cm/360（评分 ' + rec.peakScore.toFixed(1) + '，置信度 ' + C.confidenceLabel(rec.confidence) + (rec.flat ? '，区分度低仅供参考' : '') + '）',
      '建议区间：' + rec.band.min.toFixed(1) + ' – ' + rec.band.max.toFixed(1) + ' cm/360'
    ];
    C.sensTable(rec.peakCm360, config.dpi).forEach(function (item) {
      var low = C.sensFromCm360(rec.band.max, config.dpi, item.game.yaw);
      var high = C.sensFromCm360(rec.band.min, config.dpi, item.game.yaw);
      lines.push(
        item.game.name + '：' + item.sens.toFixed(item.game.sensDigits) +
        '（区间 ' + low.toFixed(item.game.sensDigits) + '–' + high.toFixed(item.game.sensDigits) + '）' +
        '｜eDPI ' + Math.round(item.sens * config.dpi)
      );
    });
    lines.push('测试时间：' + formatDate(new Date(session.endedAt || Date.now()).toISOString()));
    return lines.join('\n');
  };

  App.prototype.copySummary = function (button) {
    var text = this.summaryText();
    if (!text) return;
    var self = this;
    copyText(text).then(function () {
      var original = button.textContent;
      button.textContent = '已复制 ✓';
      window.setTimeout(function () { button.textContent = original; }, 1600);
    }).catch(function () {
      button.textContent = '复制失败';
      window.setTimeout(function () { button.textContent = '复制结论'; }, 1600);
    });
  };

  App.prototype.exportResults = function () {
    if (!this.session) return;
    var rec = this.recommendation;
    var session = this.session;
    var data = {
      app: 'SENS LAB',
      version: 1,
      exportedAt: new Date().toISOString(),
      config: session.config,
      mode: session.mode.key,
      range: session.range,
      recommendation: rec && rec.ok
        ? {
            peakCm360: round(rec.peakCm360, 2),
            peakScore: round(rec.peakScore, 2),
            band: { min: round(rec.band.min, 2), max: round(rec.band.max, 2) },
            confidence: rec.confidence,
            r2: round(rec.r2, 3),
            method: rec.method
          }
        : { ok: false },
      conversions: rec && rec.ok ? C.sensTable(rec.peakCm360, session.config.dpi) : [],
      rounds: this.rounds.map(function (r) {
        return {
          order: r.order,
          cm360: r.cm360,
          score: round(r.score, 2),
          track: round(r.track.score, 2),
          flick: round(r.flick.score, 2),
          micro: round(r.micro.score, 2)
        };
      })
    };
    try {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'senslab-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (err) {
      bootError('导出失败：' + err.message);
    }
  };

  App.prototype.saveHistory = function () {
    var rec = this.recommendation;
    var session = this.session;
    if (!session || !rec || !rec.ok || rec.flat) return;
    var history = loadJSON(STORAGE_HISTORY, []);
    if (!Array.isArray(history)) history = [];
    history.unshift({
      date: new Date().toISOString(),
      peakCm: round(rec.peakCm360, 1),
      peakScore: round(rec.peakScore, 1),
      confidence: rec.confidence,
      game: session.config.game,
      dpi: session.config.dpi,
      mode: session.mode.key,
      rounds: this.rounds.length
    });
    saveJSON(STORAGE_HISTORY, history.slice(0, 10));
    this.updateLastRun();
  };

  /* ------------------------------------------------------------------ *
   * Screens / overlays
   * ------------------------------------------------------------------ */
  App.prototype.showScreen = function (name) {
    var screens = this.ui.screens;
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle('is-active', key === name);
    });
    document.body.classList.toggle('is-testing', name === 'test');
    if (name === 'test') this.engine.resize();
  };

  App.prototype.showOverlay = function (opts) {
    var ui = this.ui;
    ui.overlay.classList.remove('is-hidden');
    ui.overlayCard.classList.toggle('is-countdown', !!opts.countdown);
    ui.overlayKicker.textContent = opts.kicker || '';
    ui.overlayTitle.textContent = opts.title || '';
    ui.overlayText.textContent = opts.text || '';
    ui.overlayActions.innerHTML = '';
    (opts.actions || []).forEach(function (action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (action.primary ? 'btn-primary' : 'btn-ghost');
      btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      ui.overlayActions.appendChild(btn);
    });
    var oldStats = ui.overlayCard.querySelector('.overlay-stats');
    if (oldStats) oldStats.remove();
    if (opts.stats && opts.stats.length) {
      var stats = document.createElement('div');
      stats.className = 'overlay-stats';
      opts.stats.forEach(function (item) {
        var span = document.createElement('span');
        var label = document.createElement('em');
        label.style.fontStyle = 'normal';
        label.textContent = item.label;
        var value = document.createElement('b');
        value.textContent = item.value;
        span.appendChild(label);
        span.appendChild(value);
        stats.appendChild(span);
      });
      ui.overlayCard.appendChild(stats);
    }
  };

  App.prototype.hideOverlay = function () {
    this.ui.overlay.classList.add('is-hidden');
    this.ui.overlayCard.classList.remove('is-countdown');
  };

  /* ------------------------------------------------------------------ *
   * Autotest / demo (headless verification)
   * ------------------------------------------------------------------ */
  App.prototype.handleQuery = function () {
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (err) {
      return;
    }
    if (params.get('autotest') === '1') {
      try {
        this.runAutotest();
      } catch (err) {
        document.documentElement.dataset.autotest = 'fail';
        bootError('autotest: ' + (err && err.stack ? err.stack : err));
      }
    } else if (params.get('demo')) {
      try {
        this.runDemo(params.get('demo'));
      } catch (err) {
        document.documentElement.dataset.demo = 'fail';
        bootError('demo: ' + (err && err.stack ? err.stack : err));
      }
    }
  };

  App.prototype.autotestSkill = function (cm) {
    return clamp(1 - 2.2 * Math.abs(Math.log(cm / 38)), 0.1, 1);
  };

  App.prototype.driveBot = function (dt, skill) {
    var engine = this.engine;
    var stage = engine.stage;
    if (!stage) return;
    var target = engine.currentTarget();
    if (!target) return;
    var rng = this._botRng;
    var k = engine.degPerCount() || 0.001;
    var errYaw = target.yaw - engine.camera.yaw;
    var errPitch = target.pitch - engine.camera.pitch;
    if (stage.mode === 'track' && Number.isFinite(target.prevYaw)) {
      errYaw += (target.yaw - target.prevYaw) * 1.3;
      errPitch += (target.pitch - target.prevPitch) * 1.3;
    }
    var gain = stage.mode === 'flick' ? 0.8 : 0.55;
    var noise = 3 + (1 - skill) * 55;
    var cap = 12 + 55 * skill;
    var dx = clamp((errYaw * gain) / k + (rng() - 0.5) * noise, -cap, cap);
    var dy = clamp((errPitch * gain) / k + (rng() - 0.5) * noise, -cap, cap);
    engine.look(dx, dy);

    if (stage.mode === 'flick' && stage.active) {
      var spec = stage.active.spec;
      var dist = Math.sqrt(
        (spec.yaw - engine.camera.yaw) * (spec.yaw - engine.camera.yaw) +
        (spec.pitch - engine.camera.pitch) * (spec.pitch - engine.camera.pitch)
      );
      if (dist <= spec.radius * 0.8) engine.handleClick();
    }
    void dt;
  };

  App.prototype.runAutotest = function () {
    this.autotest = true;
    this.state = 'autotest';
    this.sound.enabled = false;
    this.engine.onStageEnd = null;
    this.engine.onEvent = null;

    var config = {
      game: 'valorant',
      dpi: 800,
      sens: 0.4,
      preset: 'balanced',
      mode: 'quick',
      style: 'balanced',
      min: null,
      max: null,
      sound: false
    };
    this.config = config;
    var currentCm = C.cm360FromSens(config.sens, config.dpi, C.GAMES.valorant.yaw);
    var planResult = C.planSession({ mode: config.mode, preset: config.preset, currentCm360: currentCm });
    var battery = C.makeBattery('autotest-sens-lab');
    this.session = {
      config: config,
      mode: planResult.mode,
      range: planResult.range,
      testCount: planResult.testCount,
      plan: planResult.plan,
      battery: battery,
      planIndex: planResult.plan.length - 1,
      stageIndex: 2,
      stageResults: {},
      startedAt: Date.now() - 180000,
      endedAt: null,
      partial: false
    };
    this.rounds = [];

    this.showScreen('test');
    this.engine.resize();
    this.engine.setSensitivity({ cm360: planResult.plan[0].cm360, dpi: config.dpi, fov: C.GAMES.valorant.fov });
    this.setRoundHud(planResult.plan[0]);

    for (var p = 0; p < planResult.plan.length; p++) {
      var entry = planResult.plan[p];
      var results = {};
      for (var s = 0; s < STAGES.length; s++) {
        var mode = STAGES[s];
        var seconds = entry.stageSeconds || planResult.mode.trackSeconds;
        var count = mode === 'flick' ? entry.targets : entry.microTargets;
        this.engine.setSensitivity({ cm360: entry.cm360, dpi: config.dpi, fov: C.GAMES.valorant.fov });
        this.engine.startStage(mode, battery, { seconds: seconds, count: count });
        var skill = this.autotestSkill(entry.cm360);
        var guard = 0;
        while (this.engine.stage && guard < 12000) {
          this.driveBot(1 / 60, skill);
          this.engine.update(1 / 60);
          guard++;
        }
        if (!this.engine.lastResult) throw new Error('stage did not finish: ' + mode + ' @ ' + entry.cm360);
        results[mode] = this.engine.lastResult;
      }
      var score = C.combineModes(results, C.STYLE_WEIGHTS.balanced);
      this.rounds.push({
        order: this.rounds.length + 1,
        cm360: entry.cm360,
        step: entry.step,
        score: score,
        track: results.track,
        flick: results.flick,
        micro: results.micro
      });
    }

    this.recommendation = C.recommend(this.buildPoints());
    this.session.endedAt = Date.now();
    this.finishSession('autotest');

    var report = {
      rounds: this.rounds.length,
      peak: this.recommendation && this.recommendation.ok ? round(this.recommendation.peakCm360, 2) : null,
      peakScore: this.recommendation && this.recommendation.ok ? round(this.recommendation.peakScore, 2) : null,
      confidence: this.recommendation ? this.recommendation.confidence : null,
      chartDrawn: !!this.chartDrawn,
      chartSize: this.chartSize || null,
      scores: this.rounds.map(function (r) { return [round(r.cm360, 1), round(r.score, 1)]; })
    };
    var passed =
      this.rounds.length === planResult.testCount &&
      this.recommendation &&
      this.recommendation.ok &&
      Number.isFinite(this.recommendation.peakCm360) &&
      this.chartDrawn;
    document.documentElement.dataset.autotest = passed ? 'pass' : 'fail';
    var box = document.createElement('div');
    box.id = 'autotest-report';
    box.hidden = true;
    box.textContent = JSON.stringify(report);
    document.body.appendChild(box);
    if (!passed) bootError('autotest assertions failed: ' + JSON.stringify(report));
  };

  App.prototype.runDemo = function (mode) {
    this.state = 'demo';
    this.sound.enabled = false;
    this.config = {
      game: 'valorant',
      dpi: 800,
      sens: 0.4,
      preset: 'balanced',
      mode: 'standard',
      style: 'balanced',
      min: null,
      max: null
    };
    var cm = 38.5;
    this.showScreen('test');
    this.engine.resize();
    this.engine.setSensitivity({ cm360: cm, dpi: 800, fov: C.GAMES.valorant.fov });
    var stageMode = mode === 'track' || mode === 'micro' ? mode : 'flick';
    this.engine.startStage(stageMode, C.makeBattery('demo-seed'), { seconds: 7, count: 5 });
    for (var i = 0; i < 45; i++) this.engine.update(1 / 60);
    var target = this.engine.currentTarget();
    if (target) {
      this.engine.camera.yaw = target.yaw - 7.5;
      this.engine.camera.pitch = target.pitch - 2.2;
    }
    this.engine.draw();
    this.hideOverlay();
    this.ui.testRoundLabel.textContent = '第 3 / 7 档';
    this.ui.testSensLabel.textContent = '38.5 cm/360 · VALORANT 0.297';
    this.ui.testModeLabel.textContent = STAGE_LABELS[stageMode];
    this.ui.testModeLabel.dataset.mode = stageMode;
    this.ui.testTimer.textContent = stageMode === 'track' ? '4.2s' : '2/5';
    this.ui.testProgress.style.width = '38%';
    this.ui.hint.textContent = STAGE_HINTS[stageMode];
    this.ui.footRound.textContent = '3 / 7';
    this.ui.footMode.textContent = '标准';
    this.ui.footSeed.textContent = 'DEMO01';
    this.ui.targetState.querySelector('span').textContent = '偏离';
    this.ui.targetState.classList.remove('is-on');
    this.setPips(stageMode === 'track' ? 0 : stageMode === 'flick' ? 1 : 2, false);
    document.documentElement.dataset.demo = 'ready';
  };

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  var app;
  try {
    app = new App();
    root.SensLab = {
      app: app,
      core: C,
      engine: app.engine,
      version: 1
    };
  } catch (err) {
    bootError(err && err.stack ? err.stack : String(err));
  }
})(typeof window !== 'undefined' ? window : this);
