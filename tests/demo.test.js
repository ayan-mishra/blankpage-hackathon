import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo, makeStudy, makeNight } from '../src/demo.js';
import { windowMetrics } from '../src/metrics.js';
import { DEFAULT_CHECKLIST, evaluate } from '../src/rules.js';
import { analyzeNight } from '../src/wear.js';

const t0 = performance.now();
const study = makeStudy();
const studyMs = performance.now() - t0;
const demo = makeDemo();

test('generation is deterministic and keeps the EDF-like shape', () => {
  assert.deepEqual(makeDemo(), demo);
  const again = makeStudy();
  assert.deepEqual(again.map((f) => f.name), study.map((f) => f.name));
  again.forEach((f, i) => assert.deepEqual(f.edf, study[i].edf));
  assert.deepEqual(demo.labels, ['F3', 'F4', 'C3', 'C4', 'O1', 'O2']);
  assert.deepEqual(demo.rates, [128, 128, 128, 128, 128, 128]);
  assert.equal(demo.duration, 300);
  for (const x of demo.signals) { assert.ok(x instanceof Float32Array); assert.equal(x.length, 128 * 300); }
  assert.equal(study.length, 8);
  for (const { edf } of study) { assert.deepEqual(edf.labels, ['F7-Fpz', 'F8-Fpz']); assert.equal(edf.signals[0].length, 128 * 3600); }
});

test('makeStudy is fast enough for a button click', () => {
  assert.ok(studyMs < 1500, `makeStudy took ${studyMs.toFixed(0)} ms`);
});

test('the checklist flags exactly the three injected demo faults', () => {
  const WIN = 5, by = demo.signals.map((x) => windowMetrics(x, 128, WIN));
  const faults = { 2: ['flat', 60, 125], 3: ['line60', 150, 300], 4: ['ptp', 200, 235] }; // ch: [rule that must fire, from s, to s]
  const flags = evaluate(DEFAULT_CHECKLIST, by);
  for (const f of flags) {
    const [, a, b] = faults[f.ch] ?? [];
    const s = f.win * WIN;
    assert.ok(a !== undefined && s >= a && s < b, `unexpected ${f.rule.id} on ${demo.labels[f.ch]} at ${s}s`);
  }
  for (const [ch, [rule, a, b]] of Object.entries(faults)) {
    for (let s = a; s < b; s += WIN) assert.ok(flags.some((f) => f.ch === +ch && f.rule.id === rule && f.win * WIN === s), `${rule} missed on ${demo.labels[ch]} at ${s}s`);
  }
});

const power = (x, fs, f, a, b) => {
  let re = 0, im = 0;
  for (let i = a; i < b; i++) { re += x[i] * Math.cos((2 * Math.PI * f * i) / fs); im += x[i] * Math.sin((2 * Math.PI * f * i) / fs); }
  return re * re + im * im;
};

test('demo looks like resting EEG: µV-scale, occipital alpha that blocks when the eyes open', () => {
  const rms = (x, a, b) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
  for (const ch of [0, 1, 5]) { const v = rms(demo.signals[ch], 0, 128 * 30); assert.ok(v > 8 && v < 40, `${demo.labels[ch]} rms ${v}`); }
  const alpha = (ch, a, b) => [9.5, 10, 10.5].reduce((s, f) => s + power(demo.signals[ch], 128, f, a * 128, b * 128), 0);
  assert.ok(alpha(5, 50, 130) > 5 * alpha(0, 50, 130), 'O2 alpha should dominate F3');
  assert.ok(alpha(5, 50, 66) > 4 * alpha(5, 30, 46), 'alpha should block with eyes open (30-48 s)');
});

test('study participants land in the same status buckets as before the realism rewrite', () => {
  const want = { P01: 'ok', P02: 'ok', P03: 'bad', P04: 'bad', P05: 'ok', P06: 'check', P07: 'ok', P08: 'bad' };
  const cause = { P01: null, P02: 'contact', P03: 'contact', P04: 'hum', P05: 'contact', P06: 'loose', P07: null, P08: 'contact' };
  for (const { name, edf } of study) {
    const p = name.split('_')[0];
    const r = analyzeNight(edf.signals.map((x) => windowMetrics(x, 128, 10)), 10, DEFAULT_CHECKLIST, edf.labels);
    assert.equal(r.status, want[p], `${p}: ${(r.goodPct * 100).toFixed(0)}% clean`);
    assert.equal(r.cause, cause[p], p);
    if (!cause[p]) assert.equal(r.goodPct, 1, `${p} should be clean all night`);
    if (p === 'P05') assert.match(r.summary, /F7-Fpz had problems/);
  }
});

test('study nights contain slow-wave sleep (delta rises later in the night)', () => {
  const x = study[0].edf.signals[0];
  const delta = (s) => [0.75, 1, 1.25, 1.5].reduce((t, f) => t + power(x, 128, f, s * 128, (s + 60) * 128), 0);
  assert.ok(delta(1200) > 5 * delta(30), 'N3 delta should dwarf wake delta');
});

test('a headband that never touched the skin (jittering near-zero signal) is not worn properly', () => {
  const edf = makeNight(9, [{ kind: 'unseated', from: 0, to: 1 }]);
  const by = edf.signals.map((x) => windowMetrics(x, 128, 10));
  assert.ok(by[0].every((w) => w.flat < 0.01), 'samples jitter, so the flat-line rule cannot see it');
  const old = analyzeNight(by, 10, DEFAULT_CHECKLIST.filter((r) => r.metric !== 'quiet'), edf.labels);
  assert.equal(old.status, 'ok', 'without the faint-signal rule this night passed');
  const r = analyzeNight(by, 10, DEFAULT_CHECKLIST, edf.labels);
  assert.equal(r.status, 'bad');
  assert.equal(r.cause, 'contact');
  assert.equal(r.goodPct, 0);
});

test('the faint-signal rule has headroom on clean EEG, including quiet REM/N1 stretches', () => {
  const limit = DEFAULT_CHECKLIST.find((r) => r.metric === 'quiet').value;
  const clean = [...study[0].edf.signals, ...study[6].edf.signals, ...demo.signals.filter((_, ch) => ch !== 2)];
  for (const win of [5, 10]) {
    const min = Math.min(...clean.flatMap((x) => windowMetrics(x, 128, win).map((w) => w.quiet)));
    assert.ok(min > 3 * limit, `quietest clean ${win} s window has std ${min.toFixed(1)} µV`);
  }
});
