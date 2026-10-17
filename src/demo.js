// Synthetic 5-minute, 6-channel recording with three known faults, so the demo never depends on a file.
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

// A made-up 8-participant home study (one night each, 2 headband channels) with realistic wear problems.
export function makeStudy(fs = 128, seconds = 3600) {
  const labels = ['F7-Fpz', 'F8-Fpz'];
  const night = (seed, faults = []) => {
    const r = rng(seed);
    const g = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
    const signals = labels.map((_, ch) => {
      const x = new Float32Array(fs * seconds);
      for (let i = 0; i < x.length; i++) x[i] = 20 * Math.sin(2 * Math.PI * (9 + ch * 0.5) * (i / fs) + ch) + 8 * g();
      return x;
    });
    for (const f of faults) {
      const [a, b] = [Math.floor(f.from * fs * seconds), Math.floor(f.to * fs * seconds)];
      for (const ch of f.ch ?? [0, 1]) {
        const x = signals[ch];
        if (f.kind === 'flat') x.fill(x[a], a, b);
        if (f.kind === 'hum') for (let i = a; i < b; i++) x[i] += 90 * Math.sin((2 * Math.PI * 50 * i) / fs);
        if (f.kind === 'move') for (let i = a; i < b; i += Math.round(fs * 0.4)) x[i] += (r() < 0.5 ? -1 : 1) * 700;
      }
    }
    return { labels, rates: labels.map(() => fs), duration: seconds, signals };
  };
  return [
    ['P01_night1.edf', night(1)],
    ['P02_night1.edf', night(2, [{ kind: 'flat', from: 0.9, to: 1 }])],
    ['P03_night1.edf', night(3, [{ kind: 'flat', from: 0.35, to: 1 }])],
    ['P04_night1.edf', night(4, [{ kind: 'hum', from: 0.15, to: 1 }])],
    ['P05_night1.edf', night(5, [{ kind: 'flat', from: 0.2, to: 0.7, ch: [0] }])],
    ['P06_night1.edf', night(6, [{ kind: 'move', from: 0.3, to: 0.65 }])],
    ['P07_night1.edf', night(7)],
    ['P08_night1.edf', night(8, [{ kind: 'flat', from: 0.1, to: 1 }])],
  ].map(([name, edf]) => ({ name, edf }));
}
