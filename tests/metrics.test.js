import test from 'node:test';
import assert from 'node:assert/strict';
import { windowMetrics } from '../src/metrics.js';
import { rng, gauss } from './makeEdf.js';

const sine = (f, fs, n, amp = 50) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / fs));

test('window count and start times', () => {
  const m = windowMetrics(new Float32Array(1000), 100, 2);
  assert.equal(m.length, 5);
  assert.deepEqual(m.map((w) => w.start), [0, 2, 4, 6, 8]);
});

test('flatline window: flat=1, ptp=0, lines=0', () => {
  const [w] = windowMetrics(new Float32Array(500).fill(3.5), 250, 2);
  assert.equal(w.flat, 1);
  assert.equal(w.ptp, 0);
  assert.equal(w.line50, 0);
  assert.equal(w.kurtosis, 0);
});

test('50 Hz sine is detected, 60 Hz is not', () => {
  const [w] = windowMetrics(sine(50, 250, 500), 250, 2);
  assert.ok(Math.abs(w.line50 - 1) < 0.05, `line50=${w.line50}`);
  assert.ok(w.line60 < 0.05);
  assert.ok(w.ptp > 90 && w.ptp <= 100); // 250 Hz sampling of a 50 Hz sine misses the peaks
  assert.equal(w.flat < 0.05, true);
});

test('line frequency at/above Nyquist returns 0', () => {
  const [w] = windowMetrics(sine(10, 100, 200), 100, 2);
  assert.equal(w.line50, 0);
  assert.equal(w.line60, 0);
});

test('gaussian noise: low line power, kurtosis near 0', () => {
  const r = rng(7);
  const x = Float32Array.from({ length: 5000 }, () => gauss(r) * 10);
  const [w] = windowMetrics(x, 250, 20);
  assert.ok(w.line50 < 0.1 && w.line60 < 0.1);
  assert.ok(Math.abs(w.kurtosis) < 0.5, `k=${w.kurtosis}`);
});

test('spike raises kurtosis; flat run detected', () => {
  const r = rng(3);
  const x = Float32Array.from({ length: 1000 }, () => gauss(r) * 5);
  x[500] = 800;
  assert.ok(windowMetrics(x, 100, 10)[0].kurtosis > 10);
  const y = Float32Array.from({ length: 1000 }, () => gauss(r) * 5);
  y.fill(1, 100, 600);
  assert.ok(Math.abs(windowMetrics(y, 100, 10)[0].flat - 0.5) < 0.02);
});
