import { makeDemo } from './demo.js';
import { windowMetrics } from './metrics.js';
import './gpu.js';
import { stripChart } from './strip.js';
import { DEFAULT_CHECKLIST, evaluate, verdict, explain } from './rules.js';

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
const clamp = (v, m) => Math.max(-m, Math.min(m, v));

// merge consecutive flagged windows per channel and rule into marks
const names = { flat: 'flatline', line50: '50 Hz hum', line60: '60 Hz hum', ptp: 'huge swings', kurtosis: 'spikes' };
const runs = [];
const grouped = new Map();
flags.forEach((f) => { const k = `${f.ch}:${f.rule.metric}`; (grouped.get(k) || grouped.set(k, []).get(k)).push(f.win); });
grouped.forEach((wins, k) => {
  const [ch, metric] = k.split(':'); wins.sort((a, b) => a - b);
  let s = wins[0], p = wins[0];
  const push = () => runs.push({ ch: +ch, metric, s, e: p });
  for (const w of wins.slice(1)) { if (w - p > 1) { push(); s = w; } p = w; }
  push();
});

// precompute trace paths once; every figure reuses them
const paths = edf.signals.map((sig, ch) => {
  const cy = Y0 + ch * ROW + ROW / 2, per = Math.floor(sig.length / BUCKETS);
  let d = '';
  for (let b = 0; b < BUCKETS; b++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = b * per; i < (b + 1) * per; i++) { if (sig[i] < lo) lo = sig[i]; if (sig[i] > hi) hi = sig[i]; }
    const x = X0 + (b / BUCKETS) * W, x2 = x + W / BUCKETS / 2;
    d += `${b ? 'L' : 'M'}${x.toFixed(1)} ${(cy - clamp(hi * 0.6, 40)).toFixed(1)}L${x2.toFixed(1)} ${(cy - clamp(lo * 0.6, 40)).toFixed(1)}`;
  }
  return d;
});

function build(svg) {
  edf.labels.forEach((label, ch) => {
    const cy = Y0 + ch * ROW + ROW / 2;
    svg.append(el('text', { class: 'lab', x: 14, y: cy + 5 }, label));
    const trace = el('path', { class: 'trace', d: paths[ch] });
    svg.append(trace);
    const q = el('text', { class: 'q', x: 970, y: cy + 11, 'text-anchor': 'middle' }, '?');
    q.style.setProperty('--r', ch);
    svg.append(q);
  });
  runs.forEach((r) => {
    const y = Y0 + r.ch * ROW;
    const band = el('rect', { class: 'band', x: xOf(r.s), y: y + 4, width: xOf(r.e + 1) - xOf(r.s), height: ROW - 8, rx: 3 });
    const tag = el('text', { class: 'btag', x: xOf(r.s) + 6, y: y + 18 }, names[r.metric]);
    const d = `${(((xOf(r.s) - X0) / W) * 2.4 + 0.5).toFixed(2)}s`; // lights up as the scan line passes
    band.style.setProperty('--d', d); tag.style.setProperty('--d', d);
    if (r.metric === 'flat' && r.ch === 2) band.classList.add('focus');
    svg.append(band, tag);
  });
  svg.append(el('rect', { class: 'scan', x: X0, y: Y0 - 6, width: 3, height: ROW * 6 + 12 }));
  svg.append(el('rect', { class: 'pick', x: xOf(40), y: Y0 + 4 * ROW + 2, width: xOf(47) - xOf(40), height: ROW - 4, rx: 3 }));
}
document.querySelectorAll('.chart').forEach(build);

// callout text comes from the real explain() for the C3 flatline
const focusRun = runs.find((r) => r.metric === 'flat' && r.ch === 2);
const hit = flags.find((f) => f.ch === 2 && f.rule.metric === 'flat' && f.win === focusRun.s + 3);
const callout = document.getElementById('callout');
const [h0, ...r0] = explain(hit, edf.labels, WIN).split(': ');
const calloutHead = h0 + ': ', calloutRest = r0.join(': ');
callout.replaceChildren(Object.assign(document.createElement('b'), { textContent: calloutHead }), document.createTextNode(calloutRest));
callout.style.top = `${((Y0 + 4 * ROW + 4) / 600) * 100}%`;

const v = verdict(flags, by);
const st = document.getElementById('stamp');
st.querySelector('strong').textContent = `Recording is ${v.label}`;
const pct = st.querySelector('span');
const pctText = () => `${(v.bad * 100).toFixed(0)}% of channel-windows flagged by ${DEFAULT_CHECKLIST.length} rules`;
pct.textContent = pctText();

// ---- scroll story
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const steps = [...document.querySelectorAll('.step')];
steps.forEach((s) => {
  const h = s.querySelector('h2');
  h.innerHTML = h.textContent.split(' ').map((w, i) => `<span class="w" style="--i:${i}">${w}&nbsp;</span>`).join('');
});
const typeInto = (node, text, ms = 22, delay = 0) => {
  node.textContent = '';
  if (still) return void (node.textContent = text);
  [...text].forEach((c, i) => setTimeout(() => (node.textContent += c), delay + i * ms));
};
const enter = {
  3: () => { callout.firstChild.textContent = ''; callout.lastChild.textContent = ''; setTimeout(() => (callout.firstChild.textContent = calloutHead), 600); typeInto(callout.lastChild, calloutRest, 14, 800); },
  4: () => typeInto(document.getElementById('sayText'), '“flag 60 Hz hum above 15%”', 38, 800),
  5: () => {
    if (still) return;
    const t0 = performance.now() + 800;
    const tick = (now) => {
      const k = Math.max(0, Math.min(1, (now - t0) / 900));
      pct.textContent = `${(v.bad * 100 * k).toFixed(0)}% of channel-windows flagged by ${DEFAULT_CHECKLIST.length} rules`;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => (pct.textContent = pctText()), 2000); // final number even if frames are throttled
  },
};
document.querySelectorAll('.trace').forEach((t) => t.style.setProperty('--len', t.getTotalLength()));

// text reveals as the step enters; each figure starts its own animation when it is on screen
const once = (nodes, opts, fn) => {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { fn(e.target); io.unobserve(e.target); } }), opts);
  nodes.forEach((n) => io.observe(n));
};
once(steps, { threshold: 0.25 }, (s) => s.classList.add('seen'));
once([...document.querySelectorAll('.stage')], { threshold: 0.5 }, (s) => {
  s.classList.add('in');
  enter[s.dataset.step]?.();
});

// progress bar
const bar = document.getElementById('progress');
const prog = () => { bar.style.transform = `scaleX(${scrollY / (document.documentElement.scrollHeight - innerHeight || 1)})`; };
addEventListener('scroll', prog, { passive: true }); prog();

stripChart(document.getElementById('heroChart'), { rows: 3, labels: ['F3', 'C3', 'O1'] });
stripChart(document.getElementById('endChart'), { rows: 2, labels: ['F4', 'O2'], speed: 70 });
