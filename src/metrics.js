// Windowed signal metrics; runs in browser and Node. Pure float64 math.
// Every window has the same length N, so the 50/60 Hz cos/sin terms are tabulated once per call
// (same Math.cos(step * i) values as computing them inline, so results are bit-identical).
const table = (f, fs, N) => {
  if (f >= fs / 2) return null;
  const step = (2 * Math.PI * f) / fs, c = new Float64Array(N), s = new Float64Array(N);
  for (let i = 0; i < N; i++) { c[i] = Math.cos(step * i); s[i] = Math.sin(step * i); }
  return { c, s };
};

export function windowMetrics(signal, fs, winSec) {
  const N = Math.round(fs * winSec);
  const out = [];
  if (N < 1) return out;
  const t50 = table(50, fs, N), t60 = table(60, fs, N);
  const line = (t, re, im, m2) => (m2 === 0 || !t ? 0 : (2 * (re * re + im * im)) / (N * N * m2));
  for (let w = 0; w < Math.floor(signal.length / N); w++) {
    const off = w * N;
    let mean = 0, mn = Infinity, mx = -Infinity, run = 1, best = 1;
    for (let i = 0; i < N; i++) {
      const v = signal[off + i];
      mean += v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      if (i > 0) {
        run = Math.abs(v - signal[off + i - 1]) < 1e-9 ? run + 1 : 1;
        if (run > best) best = run;
      }
    }
    mean /= N;
    // One pass for the central moments and both line-frequency projections.
    let m2 = 0, m4 = 0, r50 = 0, i50 = 0, r60 = 0, i60 = 0;
    for (let i = 0; i < N; i++) {
      const d = signal[off + i] - mean, d2 = d * d;
      m2 += d2;
      m4 += d2 * d2;
      if (t50) { r50 += d * t50.c[i]; i50 += d * t50.s[i]; }
      if (t60) { r60 += d * t60.c[i]; i60 += d * t60.s[i]; }
    }
    m2 /= N;
    m4 /= N;
    out.push({
      start: w * winSec,
      flat: best / N,
      ptp: mx - mn,
      quiet: Math.sqrt(m2), // std (µV): a lone pop barely moves it, unlike ptp, so a dead lead with static still reads dead
      kurtosis: m2 === 0 ? 0 : m4 / (m2 * m2) - 3,
      line50: line(t50, r50, i50, m2),
      line60: line(t60, r60, i60, m2),
    });
  }
  return out;
}
