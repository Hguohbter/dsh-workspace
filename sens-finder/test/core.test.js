'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

test('sensitivity conversions match known values', () => {
  // Valorant 0.4 @ 800 DPI is ~40.8 cm/360.
  const cm = C.cm360FromSens(0.4, 800, C.GAMES.valorant.yaw);
  assert.ok(Math.abs(cm - 40.8) < 0.15, `expected ~40.8, got ${cm}`);
  // CS2 1.0 @ 800 DPI is ~51.95 cm/360.
  const cs = C.cm360FromSens(1.0, 800, C.GAMES.cs2.yaw);
  assert.ok(Math.abs(cs - 51.95) < 0.1, `expected ~51.95, got ${cs}`);
  // Round trip.
  const sens = C.sensFromCm360(cm, 800, C.GAMES.valorant.yaw);
  assert.ok(Math.abs(sens - 0.4) < 1e-9);
});

test('sensTable converts one cm/360 into every game', () => {
  const table = C.sensTable(40, 800);
  assert.equal(table.length, 4);
  const valorant = table.find((t) => t.game.key === 'valorant');
  assert.ok(Math.abs(valorant.sens - 0.40821) < 1e-3);
  const cs2 = table.find((t) => t.game.key === 'cs2');
  assert.ok(Math.abs(cs2.sens - 1.2989) < 1e-3);
});

test('degPerCount and pxPerDeg are consistent', () => {
  // 40 cm/360 at 800 DPI => 800/2.54*40 = 12598.4 counts per 360.
  const d = C.degPerCount(40, 800);
  assert.ok(Math.abs(360 / d - 12598.4) < 1, `counts/360 = ${360 / d}`);
  assert.equal(C.pxPerDeg(1200, 100), 12);
});

test('resolveRange auto centres on the current sensitivity', () => {
  const r = C.resolveRange({ preset: 'auto', currentCm360: 40, points: 7 });
  assert.equal(r.values.length, 7);
  assert.ok(r.min < 40 && r.max > 40);
  assert.ok(r.values.every((v) => v >= r.min - 0.1 && v <= r.max + 0.1));
  // Values are log-spaced.
  const ratio = r.values[1] / r.values[0];
  for (let i = 2; i < r.values.length; i++) {
    assert.ok(Math.abs(r.values[i] / r.values[i - 1] - ratio) < 1e-2);
  }
});

test('resolveRange clamps absurd input', () => {
  const r = C.resolveRange({ preset: 'balanced', min: 1, max: 500, points: 5 });
  assert.equal(r.min, 6);
  assert.equal(r.max, 140);
});

test('balancedOrder visits every step exactly once and starts centrally', () => {
  for (const n of [5, 7, 9]) {
    const order = C.balancedOrder(n);
    assert.equal(order.length, n);
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i));
    assert.ok(Math.abs(order[0] - (n - 1) / 2) < 1);
  }
});

test('planSession builds warmup plus one round per sensitivity', () => {
  const plan = C.planSession({ mode: 'standard', preset: 'balanced', currentCm360: 40 });
  assert.equal(plan.testCount, 7);
  assert.equal(plan.plan.length, 8);
  assert.equal(plan.plan[0].type, 'warmup');
  const rounds = plan.plan.filter((p) => p.type === 'round');
  assert.equal(new Set(rounds.map((r) => r.cm360)).size, 7);
});

test('battery is deterministic per seed and differs across seeds', () => {
  const a = C.makeBattery('abc');
  const b = C.makeBattery('abc');
  const c = C.makeBattery('xyz');
  assert.deepEqual(a.flick, b.flick);
  assert.notDeepEqual(a.flick, c.flick);
  assert.equal(a.flick.length, 8);
  assert.equal(a.micro.length, 8);
  // Flick targets are inside the arena.
  for (const t of a.flick) {
    assert.ok(Math.abs(t.yaw) <= C.WORLD.flickYaw + 1e-9);
    assert.ok(Math.abs(t.pitch) <= C.WORLD.flickPitch + 1e-9);
  }
});

test('trackPosition stays inside the tracking arena', () => {
  const battery = C.makeBattery('track-test');
  for (let t = 0; t < 30; t += 0.1) {
    const p = C.trackPosition(battery.track, t);
    assert.ok(Math.abs(p.yaw) <= C.WORLD.trackYaw + 1e-9);
    assert.ok(Math.abs(p.pitch) <= C.WORLD.trackPitch + 1e-9);
  }
});

test('recommend recovers a known peak', () => {
  const peak = 38;
  const points = [16, 22, 28, 34, 38, 46, 56, 72].map((cm) => {
    const v = Math.log(cm / peak);
    return { cm360: cm, score: 82 - 120 * v * v };
  });
  const rec = C.recommend(points);
  assert.equal(rec.ok, true);
  assert.equal(rec.method, 'fit');
  assert.ok(Math.abs(rec.peakCm360 - peak) < 1.2, `peak=${rec.peakCm360}`);
  assert.ok(rec.r2 > 0.98, `r2=${rec.r2}`);
  assert.ok(rec.band.min < peak && rec.band.max > peak);
  assert.ok(['high', 'medium'].includes(rec.confidence));
});

test('recommend falls back to the best observed point for monotonic data', () => {
  const points = [20, 30, 40, 50, 60].map((cm, i) => ({ cm360: cm, score: 50 + i * 6 }));
  const rec = C.recommend(points);
  assert.equal(rec.ok, true);
  assert.equal(rec.method, 'observed');
  assert.ok(Math.abs(rec.peakCm360 - 60) < 1e-9);
  assert.equal(rec.confidence, 'low');
});

test('recommend reports insufficient data instead of guessing', () => {
  const rec = C.recommend([{ cm360: 40, score: 70 }]);
  assert.equal(rec.ok, false);
  assert.equal(rec.reason, 'need-3-points');
});

test('recommend flags flat data as low discrimination', () => {
  const points = [20, 30, 40, 50, 60].map((cm) => ({ cm360: cm, score: 1 }));
  const rec = C.recommend(points);
  assert.equal(rec.ok, true);
  assert.equal(rec.flat, true);
  assert.equal(rec.confidence, 'low');
  assert.equal(rec.scoreStd, 0);
});

test('tracking quality peaks at zero distance and hits zero at the edge', () => {
  const r = 2.2;
  assert.equal(C.trackingQuality(0, r), 1);
  assert.ok(C.trackingQuality(r, r) > 0.6);
  assert.equal(C.trackingQuality(r * 1.8, r), 0);
  assert.equal(C.trackingQuality(r * 4, r), 0);
});

test('combineModes respects weights and ignores missing modes', () => {
  const modes = { track: { score: 80 }, flick: { score: 60 }, micro: { score: 40 } };
  const w = C.STYLE_WEIGHTS.balanced;
  assert.ok(Math.abs(C.combineModes(modes, w) - (80 * 0.4 + 60 * 0.35 + 40 * 0.25)) < 1e-9);
  assert.equal(C.combineModes({ track: { score: 50 } }, w), 50);
});

test('estimateSeconds returns a positive, growing duration', () => {
  const p7 = C.planSession({ mode: 'standard', preset: 'balanced' });
  const p5 = C.planSession({ mode: 'quick', preset: 'balanced' });
  assert.ok(C.estimateSeconds(p7.plan, p7.mode) > C.estimateSeconds(p5.plan, p5.mode));
  assert.ok(C.estimateSeconds(p5.plan, p5.mode) > 0);
});

test('grades and durations format sensibly', () => {
  assert.equal(C.grade(95), 'S');
  assert.equal(C.grade(70), 'B');
  assert.equal(C.grade(20), 'E');
  assert.match(C.formatDuration(130), /2 分 10 秒/);
});
