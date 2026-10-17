// Synthetic EEG for the demo recording and the sample study, so neither depends on a file.
// Background is 1/f-shaped noise; rhythms come from narrowband resonators driven by white noise, which gives
// the natural waxing and waning of real alpha/spindles. Events (blinks, spindles, K-complexes) and faults are
// added on top. Everything is seeded, so the same call always returns the same signals.
import { makeEdf } from './edfWrite.js';
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const TAU = 2 * Math.PI;

// Band centre and bandwidth (Hz) for each rhythm.
const BANDS = { delta: [1.2, 1.4], theta: [6, 2.5], alpha: [10, 1], beta: [20, 8] };

// n samples of noise filtered from ONE white stream: 1/f background + rhythms. gains are µV RMS, each a number
// or a per-second array (sleep staging). Unit-variance gains are analytic, so the µV values mean what they say.
function eeg(n, fs, r, gains, alphaHz = 10) {
  const sec = Math.ceil(n / fs);
  const per = (g) => (typeof g === 'number' ? new Float32Array(sec).fill(g) : g);
  // 1/f: equal-power one-pole low-passes with corners spaced x3, normalised for their mutual correlation
  const p = [0.3, 0.9, 2.7, 8.1].map((fc) => Math.exp((-TAU * fc) / fs));
  const pg = p.map((q) => Math.sqrt(1 - q * q));
  let v = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) v += (pg[i] * pg[j]) / (1 - p[i] * p[j]);
  const [p0, p1, p2, p3] = p, [g0, g1, g2, g3] = pg.map((g) => g / Math.sqrt(v));
  const pink = per(gains.pink || 0);
  // AR(2) resonators, each scaled to unit variance
  const names = Object.keys(BANDS).filter((k) => gains[k]);
  const a1 = [], a2 = [], ag = [], G = names.map((k) => per(gains[k]));
  for (const k of names) {
    const [f, bw] = k === 'alpha' ? [alphaHz, BANDS.alpha[1]] : BANDS[k];
    const q = Math.exp((-Math.PI * bw) / fs), b1 = 2 * q * Math.cos((TAU * f) / fs), b2 = -q * q;
    a1.push(b1); a2.push(b2); ag.push(Math.sqrt(((1 + b2) * ((1 - b2) ** 2 - b1 * b1)) / (1 - b2)));
  }
  const m = names.length, y1 = new Float64Array(m), y2 = new Float64Array(m), out = new Float32Array(n);
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, lp = 0;
  const q = Math.exp((-TAU * 30) / fs); // amplifier low-pass: real recordings roll off above ~30 Hz
  for (let i = 0; i < n; i++) {
    const x = (r() * 2 - 1) * 1.7320508, t = (i / fs) | 0; // uniform, unit variance; filtering makes it Gaussian
    s0 = p0 * s0 + g0 * x; s1 = p1 * s1 + g1 * x; s2 = p2 * s2 + g2 * x; s3 = p3 * s3 + g3 * x;
    let y = pink[t] * (s0 + s1 + s2 + s3);
    for (let k = 0; k < m; k++) {
      const z = a1[k] * y1[k] + a2[k] * y2[k] + ag[k] * x;
      y2[k] = y1[k]; y1[k] = z;
      y += G[k][t] * z;
    }
    out[i] = lp = q * lp + (1 - q) * y;
  }
  return out;
}

const add = (x, a, len, f) => { for (let i = 0; i < len && a + i < x.length; i++) x[a + i] += f(i); };
const blink = (fs, A) => (i) => A * (i / (0.1 * fs)) ** 2 * Math.exp(2 * (1 - i / (0.1 * fs))); // peaks at 100 ms

// Lost contact: a pop and short drift to the amplifier rail, a dead-flat line, then (if b is inside) re-contact.
function lostContact(x, a, b, fs, rail) {
  const d = Math.min(b - a, Math.round(1.2 * fs)), v0 = x[a];
  for (let i = 0; i < d; i++) x[a + i] = v0 + (rail - v0) * (1 - Math.exp((-6 * i) / d));
  x.fill(rail, a + d, b);
  add(x, b, 2 * fs, (i) => (rail - x[b + i]) * Math.exp(-i / (0.15 * fs)));
}

// Mains hum through a high-impedance contact: ramps in, level wanders slowly with the contact.
function hum(x, a, b, fs, hz, A, r) {
  const ph = r() * TAU;
  add(x, a, b - a, (i) => A * Math.min(1, i / (0.5 * fs)) * (1 + 0.15 * Math.sin((TAU * 0.04 * i) / fs + ph)) * Math.sin((TAU * hz * (a + i)) / fs));
}

// Movement: bursts of large slow swings with an electrode pop in each, every few seconds through [a, b).
// xs: the channels it hits; each gets its own coupling and a burst of muscle noise.
function movement(xs, a, b, fs, r) {
  for (let t = a + Math.round(r() * fs); ; ) {
    const len = Math.round((0.8 + r() * 1.7) * fs), tail = Math.round(0.4 * fs);
    if (t + len + tail > b) break;
    const f = 0.4 + r() * 1.2, A = 120 + r() * 160, ph = r() * TAU;
    const pop = t + Math.floor(r() * len), P = (r() < 0.5 ? -1 : 1) * (220 + r() * 250);
    for (const x of xs) {
      const c = 0.75 + 0.5 * r();
      add(x, t, len, (i) => c * A * Math.sin((Math.PI * i) / len) ** 2 * Math.sin((TAU * f * i) / fs + ph));
      add(x, pop, tail, (i) => c * P * Math.exp(-i / (0.05 * fs)));
      add(x, t, len, () => 25 * (r() * 2 - 1)); // muscle burst with the movement
    }
    t += len + Math.round((0.5 + r() * 3) * fs);
  }
}

// 5-minute, 6-channel resting recording (referential, µV) with three known faults.
export function makeDemo(fs = 128, seconds = 300) {
  const r = rng(42), n = fs * seconds;
  const labels = ['F3', 'F4', 'C3', 'C4', 'O1', 'O2'];
  // eyes closed except these stretches: alpha blocks on opening, blinks show frontally
  const open = [[30, 48], [140, 156], [262, 280]];
  const isOpen = (s) => open.some(([a, b]) => s >= a && s < b);
  const eyes = new Float32Array(seconds);
  for (let s = 0, g = 1; s < seconds; s++) eyes[s] = g += ((isOpen(s) ? 0.2 : 1) - g) * 0.6;
  const field = eeg(n, fs, r, { pink: 7, theta: 2.5, beta: 1.2 }); // shared by every channel
  const alpha = eeg(n, fs, r, { alpha: eyes }); // posterior-dominant, coherent across hemispheres
  const AL = [4, 4, 8, 8, 20, 18], BETA = [2, 2, 1.5, 1.5, 0.8, 0.8];
  const signals = labels.map((_, ch) => {
    const x = eeg(n, fs, r, { pink: 6, beta: BETA[ch] });
    for (let i = 0; i < n; i++) x[i] += field[i] + AL[ch] * alpha[i] + 0.6 * (r() * 2 - 1);
    return x;
  });
  for (const [a, b] of open) {
    for (let t = a + 1 + r() * 2; t < b - 1; t += 2 + r() * 3) {
      const A = 30 + r() * 15;
      [1, 1, 0.25, 0.25, 0.05, 0.05].forEach((k, ch) => add(signals[ch], Math.round(t * fs), Math.round(0.6 * fs), blink(fs, k * A)));
    }
  }
  const at = (s) => s * fs;
  lostContact(signals[2], at(60), at(124), fs, signals[2][at(60)] - 260); // C3: electrode lost contact
  hum(signals[3], at(150), at(300), fs, 60, 45, r); // C4: 60 Hz mains hum
  movement([signals[4]], at(200), at(235), fs, r); // O1: head moving on the pillow
  return { labels, rates: labels.map(() => fs), duration: seconds, signals };
}

// Per-stage gains for a forehead headband (F7/F8 against Fpz: short distance, so lower voltages than scalp).
// Rates are events per minute.
const STAGE = {
  W: { pink: 6, theta: 2, alpha: 4, beta: 3, delta: 0, emg: 4, blink: 14, sacc: 18, spin: 0, kc: 0 },
  N1: { pink: 7, theta: 7, alpha: 1.5, beta: 1.5, delta: 2, emg: 2, blink: 0, sacc: 0, spin: 0, kc: 0 },
  N2: { pink: 8, theta: 5, alpha: 1, beta: 1, delta: 8, emg: 1.5, blink: 0, sacc: 0, spin: 5, kc: 1.2 },
  N3: { pink: 8, theta: 5, alpha: 0.5, beta: 0.5, delta: 26, emg: 1, blink: 0, sacc: 0, spin: 1, kc: 0 },
  R: { pink: 6, theta: 6, alpha: 1.5, beta: 1.5, delta: 2, emg: 0.5, blink: 0, sacc: 24, spin: 0, kc: 0 },
};
// Two compressed sleep cycles; each participant's durations are jittered.
const CYCLE = [['W', 6], ['N1', 4], ['N2', 12], ['N3', 16], ['N2', 8], ['R', 10], ['N2', 12], ['N3', 8], ['N2', 10], ['R', 10], ['N1', 2], ['W', 2]];

// One night of a 2-channel forehead headband. faults: [{ kind: 'flat'|'hum'|'move'|'unseated', from, to, ch? }],
// from/to as fractions of the night.
export function makeNight(seed, faults = [], fs = 128, seconds = 3600) {
  const labels = ['F7-Fpz', 'F8-Fpz'];
  const n = fs * seconds;
  const r = rng(seed);
  // hypnogram -> per-second stage, then per-second gains smoothed over ~10 s so stages blend
  const parts = CYCLE.map(([s, w]) => [s, w * (0.8 + 0.4 * r())]);
  const total = parts.reduce((t, [, w]) => t + w, 0);
  const stage = [];
  for (const [s, w] of parts) for (let k = Math.round((w / total) * seconds); k > 0; k--) stage.push(s);
  while (stage.length < seconds) stage.push('W');
  const gain = (key) => {
    const g = new Float32Array(seconds);
    for (let s = 0, v = STAGE.W[key]; s < seconds; s++) g[s] = v += (STAGE[stage[s]][key] - v) * 0.1;
    return g;
  };
  const [pink, theta, alpha, beta, delta, emg] = ['pink', 'theta', 'alpha', 'beta', 'delta', 'emg'].map(gain);
  const k = (g, c) => g.map((v) => c * v);
  // most activity is common (shared Fpz reference, diffuse frontal delta); the rest is each side's own
  const shared = eeg(n, fs, r, { pink, theta, alpha, beta, delta: k(delta, 0.9) }, 9.2 + r() * 1.3);
  const signals = labels.map(() => {
    const x = eeg(n, fs, r, { pink: k(pink, 0.7), theta: k(theta, 0.4), delta: k(delta, 0.45) });
    let w0 = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1; // first difference of white noise: high-frequency muscle tone
      x[i] += shared[i] + emg[(i / fs) | 0] * 1.22 * (w - w0);
      w0 = w;
    }
    return x;
  });
  const [L, R] = signals;
  const both = (t, len, f, kl = 1, kr = 1) => { add(L, t, len, (i) => kl * f(i)); add(R, t, len, (i) => kr * f(i)); };
  for (let s = 0; s < seconds - 3; s++) {
    const st = STAGE[stage[s]], t = Math.round((s + r()) * fs);
    // blinks: Fpz goes positive, so both channels dip together
    if (r() < st.blink / 60) both(t, Math.round(0.6 * fs), blink(fs, -(35 + r() * 20)));
    // horizontal saccades: opposite polarity at F7 and F8, decaying through the amplifier's high-pass
    if (r() < st.sacc / 60) {
      const A = (r() < 0.5 ? -1 : 1) * (25 + r() * 25);
      both(t, 2 * fs, (i) => A * Math.min(1, i / (0.04 * fs)) * Math.exp(-i / fs), 1, -1);
    }
    // spindles: 11-14 Hz, 0.5-1.5 s, frontal so on the slow side
    if (r() < st.spin / 60) {
      const len = Math.round((0.5 + r()) * fs), f = 11.5 + r() * 2, A = 10 + r() * 8;
      both(t, len, (i) => A * Math.sin((Math.PI * i) / len) ** 2 * Math.sin((TAU * f * i) / fs), 1, 0.9);
    }
    // K-complexes: sharp negative wave then a slower positive one
    if (r() < st.kc / 60) {
      const A = 55 + r() * 25;
      both(t, Math.round(1.2 * fs), (i) => A * (-Math.exp(-(((i / fs - 0.25) / 0.1) ** 2)) + 0.55 * Math.exp(-(((i / fs - 0.65) / 0.18) ** 2))), 1, 0.95);
    }
  }
  for (const f of faults) {
    const [a, b] = [Math.floor(f.from * n), Math.floor(f.to * n)];
    const chs = f.ch ?? [0, 1];
    if (f.kind === 'flat') for (const ch of chs) lostContact(signals[ch], a, b, fs, signals[ch][a] + (r() < 0.5 ? -1 : 1) * (180 + r() * 140));
    if (f.kind === 'hum') for (const ch of chs) hum(signals[ch], a, b, fs, 50, 40 + r() * 10, r);
    if (f.kind === 'move') movement(chs.map((ch) => signals[ch]), a, b, fs, r);
    // never seated: no EEG, only ~0.8 µV of amplifier noise. Samples still jitter, so `flat` can't see it.
    if (f.kind === 'unseated') for (const ch of chs) for (let i = a; i < b; i++) signals[ch][i] = 0.8 * 1.7320508 * (r() * 2 - 1);
  }
  return { labels, rates: labels.map(() => fs), duration: seconds, signals };
}

// A made-up 8-participant home study (one night each, 2 headband channels) with realistic wear problems.
export function makeStudy(fs = 128, seconds = 3600) {
  const night = (seed, faults) => makeNight(seed, faults, fs, seconds);
  return [
    ['P01_night1.edf', night(1)],
    ['P02_night1.edf', night(2, [{ kind: 'flat', from: 0.9, to: 1 }])],
    ['P03_night1.edf', night(3, [{ kind: 'flat', from: 0.35, to: 1 }])],
    ['P04_night1.edf', night(4, [{ kind: 'hum', from: 0.15, to: 1 }])],
    ['P05_night1.edf', night(5, [{ kind: 'flat', from: 0.2, to: 0.7, ch: [0] }])],
    ['P06_night1.edf', night(6, [{ kind: 'move', from: 0.25, to: 0.65 }])],
    ['P07_night1.edf', night(7)],
    ['P08_night1.edf', night(8, [{ kind: 'flat', from: 0.1, to: 1 }])],
  ].map(([name, edf]) => ({ name, edf }));
}

// The demo recording encoded as a real EDF file, so "Save analysis" stores
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
