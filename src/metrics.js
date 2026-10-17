// Windowed signal metrics; runs in browser and Node. Pure float64 math.
export function windowMetrics(signal, fs, winSec) {
  const N = Math.round(fs * winSec);
  const out = [];
  if (N < 1) return out;
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
    let m2 = 0, m4 = 0;
    for (let i = 0; i < N; i++) {
      const d = signal[off + i] - mean, d2 = d * d;
      m2 += d2;
      m4 += d2 * d2;
    }
    m2 /= N;
    m4 /= N;
    const line = (f) => {
      if (m2 === 0 || f >= fs / 2) return 0;
      let re = 0, im = 0;
      const step = (2 * Math.PI * f) / fs;
      for (let i = 0; i < N; i++) {
        const d = signal[off + i] - mean;
        re += d * Math.cos(step * i);
        im += d * Math.sin(step * i);
      }
      return (2 * (re * re + im * im)) / (N * N * m2);
    };
    out.push({
      start: w * winSec,
      flat: best / N,
      ptp: mx - mn,
      kurtosis: m2 === 0 ? 0 : m4 / (m2 * m2) - 3,
      line50: line(50),
      line60: line(60),
    });
  }
  return out;
}
