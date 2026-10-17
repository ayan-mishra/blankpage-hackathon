import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEDF } from '../src/edf.js';
import { makeEdf } from './makeEdf.js';
import { windowMetrics } from '../src/metrics.js';
import { DEFAULT_CHECKLIST, evaluate, verdict } from '../src/rules.js';

test('equivalent voltage units produce the same samples and verdict', () => {
  const data = Float32Array.from({ length: 1000 }, (_, i) => 100 * Math.sin(2 * Math.PI * 10 * i / 100));
  const original = makeEdf([{ label: 'EEG', fs: 100, data }], 10);
  const reference = parseEDF(original).signals[0];
  for (const [unit, range] of [['uV', 500], ['µV', 500], ['mV', 0.5], ['V', 0.0005], ['nV', 500000]]) {
    const bytes = new Uint8Array(original.slice(0));
    const put = (off, value) => bytes.set(Array.from(String(value).padEnd(8), c => c.charCodeAt(0)), off);
    put(256 + 96, unit); put(256 + 104, -range); put(256 + 112, range);
    const signal = parseEDF(bytes.buffer).signals[0];
    for (let i = 0; i < signal.length; i++) assert.ok(Math.abs(signal[i] - reference[i]) < 0.001, unit);
    const by = [windowMetrics(signal, 100, 5)];
    assert.equal(verdict(evaluate(DEFAULT_CHECKLIST, by), by).label, 'usable', unit);
  }
});

test('rejects missing or unsupported physical units rather than guessing microvolts', () => {
  for (const unit of ['', 'Ohm', '%']) {
    const bytes = new Uint8Array(makeEdf([{ label: 'EEG', fs: 10, data: new Float32Array(20) }], 2));
    bytes.set(Array.from(unit.padEnd(8), c => c.charCodeAt(0)), 256 + 96);
    assert.throws(() => parseEDF(bytes.buffer), /unsupported physical unit/i);
  }
});

test('parses labels, rates, samples; skips EDF Annotations', () => {
  const a = Float32Array.from({ length: 400 }, (_, i) => 100 * Math.sin(i / 10));
  const b = Float32Array.from({ length: 200 }, (_, i) => (i % 50) - 25);
  const edf = parseEDF(makeEdf([
    { label: 'Fpz-Cz', fs: 100, data: a },
    { label: 'Pz-Oz', fs: 50, data: b },
  ], 4, { extraAnnotations: true }));
  assert.deepEqual(edf.labels, ['Fpz-Cz', 'Pz-Oz']);
  assert.deepEqual(edf.rates, [100, 50]);
  assert.equal(edf.duration, 4);
  assert.equal(edf.signals.length, 2);
  assert.equal(edf.signals[0].length, 400);
  assert.equal(edf.signals[1].length, 200);
  assert.ok(edf.signals[0] instanceof Float32Array);
  for (let i = 0; i < 400; i++) assert.ok(Math.abs(edf.signals[0][i] - a[i]) < 0.05);
  for (let i = 0; i < 200; i++) assert.ok(Math.abs(edf.signals[1][i] - b[i]) < 0.05);
});

test('rejects non-EDF input', () => {
  assert.throws(() => parseEDF(new ArrayBuffer(100)));
});

test('rejects hostile headers before allocating', () => {
  const good = new Uint8Array(makeEdf([{ label: 'A', fs: 10, data: new Float32Array(20) }], 2));
  const patch = (off, len, text) => { const b = good.slice(); b.set(Array.from(text.padEnd(len)).map((c) => c.charCodeAt(0)), off); return b.buffer; };
  assert.throws(() => parseEDF(patch(236, 8, '999999999')), /too short/); // huge record count
  assert.throws(() => parseEDF(patch(236, 8, '0')), /record count/);
  assert.throws(() => parseEDF(patch(244, 8, '0')), /duration/);
  const sprOff = 256 + 1 * (16 + 80 + 8 * 5 + 80); // samples-per-record field of signal 0
  assert.throws(() => parseEDF(patch(sprOff, 8, '0')), /samples per record/);
});

test('odd header size uses the DataView fallback and decodes the same samples', () => {
  const a = Float32Array.from({ length: 300 }, (_, i) => 200 * Math.sin(i / 7));
  const good = new Uint8Array(makeEdf([{ label: 'A', fs: 100, data: a }], 3));
  const hb = 512, odd = new Uint8Array(good.length + 1);
  odd.set(good.subarray(0, hb)); odd.set(good.subarray(hb), hb + 1);
  odd.set(Array.from(String(hb + 1).padEnd(8)).map((c) => c.charCodeAt(0)), 184);
  assert.deepEqual(parseEDF(odd.buffer).signals[0], parseEDF(good.buffer).signals[0]);
});
