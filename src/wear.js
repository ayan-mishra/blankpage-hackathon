// "Is this participant wearing the headband properly?" Pure logic, no DOM.
import { evaluate, METRICS } from './rules.js';

export const STATUS = { ok: 'Worn properly', check: 'Check this one', bad: 'Not worn properly' };
const CAUSE = {
  contact: 'The headband lost contact with the skin',
  hum: 'There was electrical interference',
  loose: 'The headband was moving or loose',
};
// Same cut-offs as the 2026 home-sleep study cited on the site: 75% clean = OK, 50-74% = warning, under 50% = fail.
const CLEAN = 'Clean signal all night.';
const OK_AT = 0.75, CHECK_AT = 0.5;

export const dur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : `${Math.max(1, Math.round(s / 60))}m`);

// by: per-channel arrays of window metrics. A window is good when at least half the channels are clean in it.
export function analyzeNight(by, winSec, checklist, labels = []) {
  const n = Math.min(...by.map((c) => c.length));
  const flagged = by.map(() => new Array(n).fill(false));
  const causes = {};
  for (const f of evaluate(checklist, by)) {
    if (f.win >= n) continue;
    flagged[f.ch][f.win] = true;
    const c = METRICS[f.rule.metric].cause;
    causes[c] = (causes[c] || 0) + 1;
  }
  const good = Array.from({ length: n }, (_, w) => flagged.filter((ch) => !ch[w]).length * 2 >= by.length);
  const goodPct = good.filter(Boolean).length / (n || 1);
  const status = goodPct >= OK_AT ? 'ok' : goodPct >= CHECK_AT ? 'check' : 'bad';

  let longest = null, run = null;
  good.forEach((g, i) => {
    if (!g) { run = run ? { ...run, end: i + 1 } : { start: i, end: i + 1 }; if (!longest || run.end - run.start > longest.end - longest.start) longest = run; } else run = null;
  });
  const lostToEnd = run && run.end === n && run.end - run.start >= 3 ? run : null;
  const cause = Object.keys(causes).sort((a, b) => causes[b] - causes[a])[0] || null;

  let summary = CLEAN;
  if (cause && longest) {
    summary = `${CAUSE[cause]}. Longest problem: ${dur((longest.end - longest.start) * winSec)}, starting ${dur(longest.start * winSec)} into the night.`;
    if (lostToEnd) summary = `${CAUSE[cause]}. Signal was lost from ${dur(lostToEnd.start * winSec)} into the night until the end.`;
  }
  // one sensor failing while the other works still hides a fault the coordinator should know about
  const share = flagged.map((c) => c.filter(Boolean).length / (n || 1));
  const weak = share.map((v, i) => (v >= 0.25 && v < 1 ? i : -1)).filter((i) => i >= 0 && share.some((o) => o < 0.25));
  if (status === 'ok' && cause && longest) summary = `Mostly clean. ${summary}`;
  if (weak.length) {
    const note = `${weak.map((i) => labels[i] || `Channel ${i + 1}`).join(' and ')} had problems for ${Math.round(Math.max(...weak.map((i) => share[i])) * 100)}% of the night, though the other sensor was fine.`;
    summary = summary === CLEAN ? note : `${summary} ${note}`;
  }
  const action = status === 'ok' && weak.length ? 'Fine for now. Check that sensor’s contact at the next visit.' : status === 'ok' ? 'Nothing to do.' : (cause ? METRICS[Object.keys(METRICS).find((k) => METRICS[k].cause === cause)].fix : 'Check the headband fit.');
  return { good, goodPct, status, cause, summary, action, duration: n * winSec };
}

export const participantOf = (filename) => {
  const stem = filename.replace(/\.[^.]+$/, '');
  return stem.split(/[_\-\s]/)[0] || stem;
};

const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
export function toCsv(rows) {
  const head = ['Participant', 'File', 'Status', 'Clean signal %', 'Recording length', 'What happened', 'What to do'];
  const body = rows.map((r) => [r.participant, r.file, r.error ? 'Could not read' : STATUS[r.status], r.error ? '' : Math.round(r.goodPct * 100), r.error ? '' : dur(r.duration), r.error || r.summary, r.error ? 'Re-export the file and try again' : r.action]);
  return [head, ...body].map((l) => l.map(q).join(',')).join('\n');
}
