import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEDF } from '../src/edf.js';
import { makeEdf } from './makeEdf.js';

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
