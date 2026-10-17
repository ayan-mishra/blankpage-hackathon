import { makeDemo } from './demo.js';
import { windowMetrics } from './metrics.js';
import { DEFAULT_CHECKLIST, evaluate, verdict, explain, METRICS } from './rules.js';

// The landing page is drawn from the real demo recording and the real rule engine.
const WIN = 5, X0 = 90, W = 890, Y0 = 30, ROW = 90, BUCKETS = 360;
const edf = makeDemo();
const by = edf.signals.map((x, i) => windowMetrics(x, edf.rates[i], WIN));
const flags = evaluate(DEFAULT_CHECKLIST, by);
const nWin = by[0].length;
const xOf = (win) => X0 + (win / nWin) * W;
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, text) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text) e.textContent = text;
  return e;
};

const svg = document.getElementById('chart');
const clamp = (v, m) => Math.max(-m, Math.min(m, v));
edf.signals.forEach((sig, ch) => {
  const cy = Y0 + ch * ROW + ROW / 2, per = Math.floor(sig.length / BUCKETS);
  let d = '';
  for (let b = 0; b < BUCKETS; b++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = b * per; i < (b + 1) * per; i++) { if (sig[i] < lo) lo = sig[i]; if (sig[i] > hi) hi = sig[i]; }
    const x = (X0 + (b / BUCKETS) * W).toFixed(1);
    const x2 = (+x + W / BUCKETS / 2).toFixed(1);
    d += `${b ? 'L' : 'M'}${x} ${(cy - clamp(hi * 0.6, 40)).toFixed(1)}L${x2} ${(cy - clamp(lo * 0.6, 40)).toFixed(1)}`;
  }
  svg.append(el('text', { class: 'lab', x: 14, y: cy + 5 }, edf.labels[ch]));
  svg.append(el('path', { class: 'trace', d }));
  svg.append(el('text', { class: 'q', x: 986, y: cy + 10, 'text-anchor': 'end' }, '?'));
});

// merge consecutive flagged windows per channel and rule into marks
const names = { flat: 'flatline', line50: '50 Hz hum', line60: '60 Hz hum', ptp: 'huge swings', kurtosis: 'spikes' };
const runs = [];
const by2 = new Map();
flags.forEach((f) => { const k = `${f.ch}:${f.rule.metric}`; (by2.get(k) || by2.set(k, []).get(k)).push(f.win); });
by2.forEach((wins, k) => {
  const [ch, metric] = k.split(':'); wins.sort((a, b) => a - b);
  let s = wins[0], p = wins[0];
  const push = () => runs.push({ ch: +ch, metric, s, e: p });
  for (const w of wins.slice(1)) { if (w - p > 1) { push(); s = w; } p = w; }
  push();
});
let focus = null;
runs.forEach((r) => {
  const y = Y0 + r.ch * ROW;
  const band = el('rect', { class: 'band', x: xOf(r.s), y: y + 4, width: xOf(r.e + 1) - xOf(r.s), height: ROW - 8, rx: 3 });
  svg.append(band);
  svg.append(el('text', { class: 'btag', x: xOf(r.s) + 6, y: y + 18 }, names[r.metric]));
  if (r.metric === 'flat' && r.ch === 2) { band.classList.add('focus'); focus = r; }
});
// "show it" region over the O1 spikes
svg.append(el('rect', { class: 'pick', x: xOf(40), y: Y0 + 4 * ROW + 2, width: xOf(47) - xOf(40), height: ROW - 4, rx: 3 }));

// callout text comes from the real explain() for the C3 flatline
const hit = flags.find((f) => f.ch === 2 && f.rule.metric === 'flat' && f.win === focus.s + 3);
const callout = document.getElementById('callout');
const [head, ...rest] = explain(hit, edf.labels, WIN).split(': ');
callout.replaceChildren(Object.assign(document.createElement('b'), { textContent: head + ': ' }), rest.join(': '));
callout.style.top = `${((Y0 + 4 * ROW + 4) / 600) * 100}%`;

const v = verdict(flags, by);
document.getElementById('stamp').innerHTML =
  `<strong></strong><span></span><code>somnium-checklist.json</code>`;
const st = document.getElementById('stamp');
st.querySelector('strong').textContent = `Recording is ${v.label}`;
st.querySelector('span').textContent = `${(v.bad * 100).toFixed(0)}% of channel-windows flagged by ${DEFAULT_CHECKLIST.length} rules`;

// scroll story: activate the step nearest the middle of the screen
const stage = document.getElementById('stage');
const steps = [...document.querySelectorAll('.step')];
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  steps.forEach((s) => s.classList.toggle('on', s === e.target));
  stage.dataset.step = e.target.dataset.step;
}), { rootMargin: '-45% 0px -45% 0px' });
steps.forEach((s) => io.observe(s));
steps[0].classList.add('on');
document.querySelectorAll('.trace').forEach((t) => t.style.setProperty('--len', t.getTotalLength()));
requestAnimationFrame(() => stage.classList.add('drawn'));
