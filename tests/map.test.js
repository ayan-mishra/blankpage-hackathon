import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLayout, MAX_PX, CELL_MIN, MAP_W, GUT } from '../src/map.js';

// Real numbers from the reported file: 27010 x 1 s records at 256 Hz, 5 s windows.
const EEG_L_WINDOWS = 5402;

test('short recording draws one column per window (no aggregation)', () => {
  const L = mapLayout(60, 6, 2); // demo: 300 s, 6 channels
  assert.equal(L.step, 1);
  assert.equal(L.cols, 60);
  assert.ok(L.cw >= 10 && L.cw <= 15);
  assert.ok(L.cssW <= MAP_W + GUT + 1);
});

test('7.5 h recording stays inside the canvas budget', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    const L = mapLayout(EEG_L_WINDOWS, 1, dpr);
    // the old code produced a 54,064 px wide bitmap (108,128 at dpr 2) -> sad face
    assert.ok(L.pxW <= MAX_PX, `dpr ${dpr}: pxW=${L.pxW}`);
    assert.ok(L.pxH <= MAX_PX, `dpr ${dpr}: pxH=${L.pxH}`);
    assert.ok(L.cw >= CELL_MIN, `dpr ${dpr}: cells must stay clickable, cw=${L.cw}`);
    // aggregation must not lose coverage: cols * step covers every window
    assert.ok(L.cols * L.step >= EEG_L_WINDOWS);
  }
});

test('fully loaded grid still fits a single card width', () => {
  const L = mapLayout(EEG_L_WINDOWS, 1, 2);
  assert.ok(L.cssW <= MAP_W + GUT + 1, `cssW=${L.cssW}`);
});

test('never exceeds the safe canvas side, for any input', () => {
  const cases = [
    [0, 1], [1, 1], [100, 1], [5402, 1], [100000, 64], [1e6, 256], [5e6, 512],
  ];
  for (const [n, ch] of cases) {
    for (const dpr of [1, 2, 4]) {
      const L = mapLayout(n, ch, dpr);
      assert.ok(L.pxW <= MAX_PX, `n=${n} ch=${ch} dpr=${dpr}: pxW=${L.pxW}`);
      assert.ok(L.pxH <= MAX_PX, `n=${n} ch=${ch} dpr=${dpr}: pxH=${L.pxH}`);
      assert.ok(L.step >= 1 && L.cols >= 0 && L.cssW > 0 && L.cssH > 0);
    }
  }
});

test('high channel counts stay under the limit too', () => {
  const L = mapLayout(5402, 256, 2); // 256-channel montage
  assert.ok(L.pxH <= MAX_PX, `pxH=${L.pxH}`);
  assert.ok(L.cssH === 20 + 256 * 30);
});
