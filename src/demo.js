// Synthetic 5-minute, 6-channel recording with three known faults, so the demo never depends on a file.
import { makeEdf } from './edfWrite.js';
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

export function makeDemo(fs = 128, seconds = 300) {
  const r = rng(42);
  const g = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
  const labels = ['F3', 'F4', 'C3', 'C4', 'O1', 'O2'];
  const signals = labels.map((_, ch) => {
    const x = new Float32Array(fs * seconds);
    for (let i = 0; i < x.length; i++) {
      const t = i / fs;
      x[i] = 20 * Math.sin(2 * Math.PI * (9 + ch * 0.4) * t + ch) + 8 * g();
    }
    return x;
  });
  const span = (a, b) => [a * fs, b * fs];
  let [a, b] = span(60, 125); // C3: electrode lost contact
  signals[2].fill(signals[2][a], a, b);
  [a, b] = span(150, 300); // C4: mains hum
  for (let i = a; i < b; i++) signals[3][i] += 90 * Math.sin((2 * Math.PI * 60 * i) / fs);
  [a, b] = span(200, 235); // O1: movement spikes
  for (let i = a; i < b; i += Math.round(fs * 0.7)) signals[4][i] += (r() < 0.5 ? -1 : 1) * 700;
  return { labels, rates: labels.map(() => fs), duration: seconds, signals };
}

// The same recording encoded as a real EDF file, so "Save analysis" stores
// something that can actually be reopened later.
export function demoEdf(fs = 128, seconds = 300) {
  const demo = makeDemo(fs, seconds);
  return makeEdf(
    demo.labels.map((label, i) => ({ label, fs: demo.rates[i], data: demo.signals[i] })),
    seconds,
  );
}

export function demoFile(fs = 128, seconds = 300) {
  return new File([demoEdf(fs, seconds)], 'demo-recording.edf', { type: 'application/edf' });
}
