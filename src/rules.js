// Rules are plain data over a fixed set of documented metrics, never generated code.
export const METRICS = {
  flat: { label: 'flatline fraction', pct: true, why: 'a long run of identical samples usually means the electrode lost contact' },
  ptp: { label: 'peak-to-peak amplitude (µV)', why: 'very large swings usually come from movement or a loose electrode' },
  kurtosis: { label: 'spikiness (kurtosis)', why: 'isolated spikes usually come from movement, blinks or electrode pops' },
  line50: { label: '50 Hz mains share of power', pct: true, why: 'mains hum means poor shielding or high electrode impedance' },
  line60: { label: '60 Hz mains share of power', pct: true, why: 'mains hum means poor shielding or high electrode impedance' },
};
const OPS = { '>': (a, b) => a > b, '<': (a, b) => a < b };

export const DEFAULT_CHECKLIST = [
  { id: 'flat', name: 'Flatline', metric: 'flat', op: '>', value: 0.5 },
  { id: 'line50', name: '50 Hz hum', metric: 'line50', op: '>', value: 0.2 },
  { id: 'line60', name: '60 Hz hum', metric: 'line60', op: '>', value: 0.2 },
  { id: 'ptp', name: 'Huge swings', metric: 'ptp', op: '>', value: 300 },
  { id: 'kurt', name: 'Spikes', metric: 'kurtosis', op: '>', value: 8 },
];

export const fmt = (metric, v) => (METRICS[metric].pct ? `${(v * 100).toFixed(0)}%` : v.toFixed(1));

// byChannel: metrics arrays per channel (output of windowMetrics). Returns flat list of flags.
export function evaluate(checklist, byChannel) {
  const flags = [];
  for (const rule of checklist) {
    byChannel.forEach((wins, ch) =>
      wins.forEach((w, win) => {
        if (OPS[rule.op](w[rule.metric], rule.value)) flags.push({ rule, ch, win, value: w[rule.metric] });
      }));
  }
  return flags;
}

export function verdict(flags, byChannel) {
  const total = byChannel.reduce((n, c) => n + c.length, 0) || 1;
  const bad = new Set(flags.map((f) => `${f.ch}:${f.win}`)).size / total;
  const label = bad < 0.1 ? 'usable' : bad < 0.3 ? 'usable after fixes' : 'not usable';
  return { bad, label };
}

export function explain(flag, labels, winSec) {
  const m = METRICS[flag.rule.metric];
  const t = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const s = flag.win * winSec;
  return `${labels[flag.ch]} at ${t(s)}–${t(s + winSec)}: ${m.label} is ${fmt(flag.rule.metric, flag.value)} ` +
    `(rule "${flag.rule.name}": ${flag.rule.op} ${fmt(flag.rule.metric, flag.rule.value)}). ${m.why}.`;
}

// Plain-language -> rule. Deliberately a small template parser; returns null if unsure.
export function parseRule(text) {
  const t = text.toLowerCase();
  const num = t.match(/(\d+(?:\.\d+)?)\s*(%)?/g)?.map((x) => ({ n: parseFloat(x), pct: x.includes('%') }));
  const hz = t.match(/\b(50|60)\s*hz/)?.[1];
  let metric;
  if (/flat/.test(t)) metric = 'flat';
  else if (hz || /line|mains|hum/.test(t)) metric = hz === '50' ? 'line50' : 'line60';
  else if (/spik|kurt|pop/.test(t)) metric = 'kurtosis';
  else if (/amplitude|swing|peak|ptp|µv|uv/.test(t)) metric = 'ptp';
  if (!metric) return null;
  const cands = (num || []).filter((x) => !(hz && x.n === +hz && !x.pct));
  if (!cands.length) return null;
  const c = cands[cands.length - 1];
  const value = METRICS[metric].pct ? (c.pct || c.n > 1 ? c.n / 100 : c.n) : c.n;
  const op = /below|under|less|<|fewer/.test(t) ? '<' : '>';
  return { id: `r${Date.now()}`, name: text.trim().slice(0, 40), metric, op, value };
}

const quantile = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// "Show it": the user marks windows as bad; pick the metric that best separates them from the rest.
// selection: [{ch, win}]. Returns a proposed rule (user previews and edits it) or null.
export function proposeRule(byChannel, selection) {
  const sel = new Set(selection.map((s) => `${s.ch}:${s.win}`));
  let best = null;
  for (const metric of Object.keys(METRICS)) {
    const inside = [], outside = [];
    byChannel.forEach((wins, ch) => wins.forEach((w, win) => (sel.has(`${ch}:${win}`) ? inside : outside).push(w[metric])));
    if (!inside.length || !outside.length) continue;
    const hi = quantile(outside, 0.95), lo = quantile(inside, 0.25);
    if (lo <= hi) continue; // not separable on this metric
    const score = (lo - hi) / (quantile(outside, 0.99) - quantile(outside, 0.5) + 1e-9);
    if (!best || score > best.score) best = { metric, value: (hi + lo) / 2, score };
  }
  return best && { id: `r${Date.now()}`, name: `Learned: ${METRICS[best.metric].label}`, metric: best.metric, op: '>', value: best.value };
}
