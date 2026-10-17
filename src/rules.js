// Rules are plain data over a fixed set of documented metrics, never generated code.
export const METRICS = {
  flat: { label: 'Signal stopped (flat line)', pct: true, cause: 'contact', why: 'The headband probably lost contact with the skin',
    fix: 'Ask them to clean their forehead and put the headband back on snugly before bed',
    simple: 'The sensor stopped touching the skin, so it recorded nothing.' },
  // low: the bad direction is below the value (rules and learned rules use '<')
  quiet: { label: 'Signal too faint (µV)', low: true, cause: 'contact', why: 'The headband probably isn’t touching the skin',
    fix: 'Ask them to clean their forehead and put the headband back on snugly before bed',
    simple: 'The sensor wasn’t touching the skin, so it picked up almost nothing.' },
  ptp: { label: 'Big swings in the signal (µV)', cause: 'loose', why: 'Usually movement, or a loose headband',
    fix: 'Check the strap is snug and not shifting on the pillow',
    simple: 'The headband was moving around, so the signal went wild.' },
  kurtosis: { label: 'Sudden spikes', cause: 'loose', why: 'Usually a bump, or the headband shifting',
    fix: 'Check the strap is snug and not shifting on the pillow',
    simple: 'Something knocked the headband, which caused sharp jumps.' },
  line50: { label: '50 Hz electrical hum', pct: true, cause: 'hum', why: 'Interference from mains power, or a poor connection',
    fix: 'Move chargers and cables away from the bed and re-seat the headband',
    simple: 'Electricity nearby drowned out the signal, like static on a radio.' },
  line60: { label: '60 Hz electrical hum', pct: true, cause: 'hum', why: 'Interference from mains power, or a poor connection',
    fix: 'Move chargers and cables away from the bed and re-seat the headband',
    simple: 'Electricity nearby drowned out the signal, like static on a radio.' },
};
const OPS = { '>': (a, b) => a > b, '<': (a, b) => a < b };

export const DEFAULT_CHECKLIST = [
  { id: 'flat', name: 'Flatline', metric: 'flat', op: '>', value: 0.5 },
  // Std of a seated electrode never got below ~9 µV in the demo and study; an unseated one reads ~1 µV (Parry & Briganti 2026).
  { id: 'quiet', name: 'Too faint', metric: 'quiet', op: '<', value: 2 },
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
  const op = /below|under|less|<|fewer/.test(t) ? '<' : /above|over|more|>|bigger|greater/.test(t) ? '>' : null;
  let metric;
  if (/flat/.test(t)) metric = 'flat';
  // a low µV limit means a faint signal, not swings: ptp maps to 'loose' and would give the wrong advice
  else if (/faint|quiet|weak|dead|\bstd\b/.test(t) || (op === '<' && /µv|uv/.test(t) && !/swing|peak|ptp|amplitude/.test(t))) metric = 'quiet';
  else if (hz || /line|mains|hum/.test(t)) metric = hz === '50' ? 'line50' : 'line60';
  else if (/spik|kurt|pop/.test(t)) metric = 'kurtosis';
  else if (/amplitude|swing|peak|ptp|µv|uv/.test(t)) metric = 'ptp';
  if (!metric) return null;
  const cands = (num || []).filter((x) => !(hz && x.n === +hz && !x.pct));
  if (!cands.length) return null;
  const c = cands[cands.length - 1];
  const value = METRICS[metric].pct ? (c.pct || c.n > 1 ? c.n / 100 : c.n) : c.n;
  return { id: `r${Date.now()}`, name: text.trim().slice(0, 40), metric, op: op ?? (METRICS[metric].low ? '<' : '>'), value };
}

// s must be sorted ascending.
const quantile = (s, q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];

// "Show it": the user marks windows as bad; pick the metric that best separates them from the rest.
// selection: [{ch, win}]. Returns a proposed rule (user previews and edits it) or null.
export function proposeRule(byChannel, selection) {
  const sel = new Set(selection.map((s) => `${s.ch}:${s.win}`));
  // Split windows once, not once per metric.
  const inW = [], outW = [];
  byChannel.forEach((wins, ch) => wins.forEach((w, win) => (sel.has(`${ch}:${win}`) ? inW : outW).push(w)));
  let best = null;
  for (const metric of Object.keys(METRICS)) {
    const d = METRICS[metric].low ? -1 : 1; // flip low-is-bad metrics so "selected sits above the rest" still applies
    const inside = inW.map((w) => d * w[metric]), outside = outW.map((w) => d * w[metric]);
    if (!inside.length || !outside.length) continue;
    // Sort once per metric; typed-array sort is numeric and far faster than a comparator sort.
    const ins = Float64Array.from(inside).sort(), out = Float64Array.from(outside).sort();
    const hi = quantile(out, 0.95), lo = quantile(ins, 0.25);
    if (!(lo > hi)) continue; // not separable on this metric (or a window lacks it)
    const score = (lo - hi) / (quantile(out, 0.99) - quantile(out, 0.5) + 1e-9);
    if (!best || score > best.score) best = { metric, value: (d * (hi + lo)) / 2, score, op: d < 0 ? '<' : '>' };
  }
  return best && { id: `r${Date.now()}`, name: `Learned: ${METRICS[best.metric].label}`, metric: best.metric, op: best.op, value: best.value };
}
