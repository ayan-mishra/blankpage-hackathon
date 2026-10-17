import { mountAccount } from './account.js';
import { supabase } from './supabase.js';
import { normalizeRules, readSaved, writeSaved } from './checklists.js';
import { parseEDF } from './edf.js';
import { windowMetrics } from './metrics.js';
import { METRICS, DEFAULT_CHECKLIST, evaluate, verdict, fmt, parseRule, proposeRule } from './rules.js';
import { makeDemo } from './demo.js';
import { mapLayout, GUT, TOP, ROW, MAP_W } from './map.js';

const WIN = 5; // seconds per window
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const S = { edf: null, by: [], checklist: readSaved() ?? [...DEFAULT_CHECKLIST], flags: [], preview: new Set(), sel: null, cell: null, rule: null, step: 1, cols: 0, last: null, change: null, starter: false };

// The demo starts from a 50 Hz lab's checklist (no 60 Hz rule) so the visitor can teach the
// missing rule from C4's hum and watch the verdict change. Real files get the saved or full default.
// The starter is not saved for study.html until the visitor edits it (S.starter tracks that).
// ponytail: demo-only starter, keyed off the metric so it tracks DEFAULT_CHECKLIST edits.
const DEMO_START = DEFAULT_CHECKLIST.filter((r) => r.metric !== 'line60');
const HUM = { ch: 3, from: 30 }; // C4, from 2:30 (window 30): where the demo's 60 Hz hum lives

// A drawn column may cover S.step windows (long recordings aggregate; see map.js).
const colOf = (win) => Math.floor(win / S.step);
const firstWinOf = (col) => col * S.step;
const endWinOf = (col) => Math.min(S.by[0].length, (col + 1) * S.step);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hhmm = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`; };
const pillClass = (label) => (label === 'usable' ? 'usable' : label === 'not usable' ? 'no' : 'fix');
const pct = (x) => `${Math.round(x * 100)}%`;
const span = (nWin) => mmss(nWin * WIN); // flagged windows as signal time, e.g. 2:30
const ruleText = (r) => `${METRICS[r.metric].label} ${r.op === '<' ? 'below' : 'above'} ${fmt(r.metric, r.value)}`;

// Which window a clicked cell stands for: the earliest flagged one, so clicking a
// red cell lands on the evidence that made it red.
function repWin(ch, col) {
  const w0 = firstWinOf(col), w1 = endWinOf(col);
  const flagged = S.flags.find((f) => f.ch === ch && f.win >= w0 && f.win < w1);
  return flagged ? flagged.win : w0;
}

function load(edf, { demo = false, name = '' } = {}) {
  S.edf = edf;
  S.by = edf.signals.map((x, i) => windowMetrics(x, edf.rates[i], WIN));
  const n = Math.min(...S.by.map((w) => w.length));
  S.by = S.by.map((w) => w.slice(0, n));
  S.sel = S.cell = S.rule = S.last = S.change = null; S.preview = new Set();
  if (demo) { S.checklist = DEMO_START.map((r) => ({ ...r })); S.starter = true; }
  else if (S.starter) { S.checklist = readSaved() ?? [...DEFAULT_CHECKLIST]; S.starter = false; } // don't carry the demo's partial checklist to a real file
  $('proposal').hidden = true; $('ruleError').textContent = '';
  $('tryIt').hidden = !demo; $('tryDone').hidden = true;
  ['step1', 'step2', 'step3'].forEach((id) => $(id).classList.remove('done'));
  $('teach').disabled = true;
  $('loaded').hidden = false;
  $('loaded').textContent = `Showing ${demo ? 'the demo recording' : name}: ${edf.labels.length} channels, ${hhmm(n * WIN)}.`;
  $('load').classList.add('loaded');
  $('report').hidden = false;
  refresh();
}

// Every checklist edit goes through here so the verdict card can say what the edit did.
function editChecklist(fn, what) {
  const before = verdict(S.flags, S.by);
  fn(); S.starter = false; writeSaved(S.checklist);
  refresh();
  const after = S.last;
  S.change = { what, from: before, to: after };
  drawVerdict(true);
}

function refresh() {
  S.flags = evaluate(S.checklist, S.by);
  S.last = verdict(S.flags, S.by);
  drawVerdict(); drawMap(); drawEvidence(); drawChecklist();
  if (S.rule) updatePreview();
}

function drawVerdict(flash = false) {
  const v = S.last, box = $('verdict'), cls = pillClass(v.label);
  box.dataset.state = cls;
  $('verdictPill').className = `pill ${cls}`; $('verdictPill').textContent = v.label;
  $('verdictWhy').textContent = `Your ${S.checklist.length} rules flag ${pct(v.bad)} of the recording, counting each channel separately. Under 10% is usable, 10–30% usable after fixes, over 30% not usable.`;
  const c = S.change, line = $('change');
  line.hidden = !c;
  if (c) {
    const changed = c.from.label !== c.to.label;
    line.className = changed ? 'changed' : '';
    line.replaceChildren(c.what, changed
      ? el('span', {}, ' changed the verdict: ', el('s', { textContent: c.from.label }), ' → ', el('strong', { textContent: c.to.label }), ` (${pct(c.from.bad)} → ${pct(c.to.bad)} flagged).`)
      : ` didn’t change the verdict (${pct(c.from.bad)} → ${pct(c.to.bad)} flagged).`);
  }
  if (flash) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
}

function drawMap() {
  const c = $('map');
  const budget = Math.min(MAP_W, ($('mapwrap').clientWidth || MAP_W + GUT) - GUT);
  const L = mapLayout(S.by[0].length, S.by.length, devicePixelRatio || 1, budget);
  S.step = L.step; S.cols = L.cols;
  c.width = L.pxW; c.height = L.pxH; c.style.width = L.cssW + 'px'; c.style.height = L.cssH + 'px';
  const g = c.getContext('2d'); g.scale(L.scale, L.scale);
  const cw = L.cw;
  const css = (v) => getComputedStyle(document.body).getPropertyValue(v);
  const count = new Map();
  S.flags.forEach((f) => { const k = `${f.ch}:${colOf(f.win)}`; count.set(k, (count.get(k) || 0) + 1); });
  g.font = '12px system-ui'; g.fillStyle = css('--mute'); g.textBaseline = 'middle';
  S.edf.labels.forEach((l, i) => g.fillText(l.slice(0, 6), 2, TOP + i * ROW + ROW / 2));
  // time labels at whole-minute intervals, at least 56px apart, so they never repeat
  const secPerCol = S.step * WIN;
  const gap = [60, 120, 300, 600, 900, 1800, 3600, 7200].find((t) => (t / secPerCol) * cw >= 56) || 7200;
  for (let col = 0; col < S.cols; col++) {
    const t = col * secPerCol;
    if (col === 0 || Math.floor(t / gap) !== Math.floor((t - secPerCol) / gap)) g.fillText(hhmm(Math.floor(t / gap) * gap), GUT + col * cw, 8);
  }
  for (let ch = 0; ch < S.by.length; ch++) for (let col = 0; col < S.cols; col++) {
    const key = `${ch}:${col}`, x = GUT + col * cw, y = TOP + ch * ROW;
    g.fillStyle = count.has(key) ? css('--bad') : css('--ok');
    g.fillRect(x + 1, y + 1, cw - 2, ROW - 2);
    if (S.preview.has(key)) { g.fillStyle = css('--pre'); g.fillRect(x + 1, y + ROW / 2, cw - 2, ROW / 2 - 1); }
  }
  g.lineWidth = 2; g.strokeStyle = css('--text');
  if (S.sel) g.strokeRect(GUT + S.sel.col0 * cw, TOP + S.sel.ch0 * ROW, (S.sel.col1 - S.sel.col0 + 1) * cw, (S.sel.ch1 - S.sel.ch0 + 1) * ROW);
  else if (S.cell) g.strokeRect(GUT + colOf(S.cell.win) * cw, TOP + S.cell.ch * ROW, cw, ROW);
  c._cw = cw; c._w = L.cssW; c._h = L.cssH;
}

function drawEvidence() {
  const box = $('evidence'), t = $('trace').getContext('2d');
  t.clearRect(0, 0, 9999, 9999);
  $('trace').hidden = !S.cell; // no empty box before something is selected
  if (S.sel) {
    const chs = S.sel.ch1 - S.sel.ch0 + 1, secs = (endWinOf(S.sel.col1) - firstWinOf(S.sel.col0)) * WIN;
    return box.replaceChildren(el('p', { className: 'hint', textContent: `Selected ${chs} channel${chs > 1 ? 's' : ''} over ${mmss(secs)} (${S.edf.labels[S.sel.ch0]}${chs > 1 ? `–${S.edf.labels[S.sel.ch1]}` : ''}, from ${mmss(firstWinOf(S.sel.col0) * WIN)}). Press “Teach a rule from selection” to get a suggested rule.` }));
  }
  if (!S.cell) return box.replaceChildren(el('p', { className: 'hint', textContent: 'Click a square on the map to see why it was flagged, or why not.' }));
  const { ch, win } = S.cell, hits = S.flags.filter((f) => f.ch === ch && f.win === win);
  const end = S.step > 1 ? win + S.step : win + 1;
  const title = el('h3', { className: 'ev-title' }, `${S.edf.labels[ch]} · ${mmss(win * WIN)}–${mmss(end * WIN)} `,
    el('span', { className: `badge ${hits.length ? 'bad' : 'ok'}`, textContent: hits.length ? 'Flagged' : 'Clean' }));
  const body = hits.length
    ? hits.flatMap((f) => {
      const m = METRICS[f.rule.metric];
      return [el('p', { className: 'simple', textContent: m.simple }),
        el('p', { className: 'tech', textContent: `${m.label} is ${fmt(f.rule.metric, f.value)}, ${f.rule.op === '<' ? 'under' : 'over'} your rule “${f.rule.name}” (${f.rule.op} ${fmt(f.rule.metric, f.rule.value)}). ${m.why}.` })];
    })
    : [el('p', { textContent: 'No rule flagged this square. If the trace still looks wrong to you, drag across it and teach a rule.' })];
  if (S.step > 1) body.push(el('p', { className: 'hint', textContent: `This square covers ${S.step} windows; the trace shows the first.` }));
  const m = S.by[ch][win];
  const dl = el('dl', { className: 'metrics' }, ...Object.keys(METRICS).flatMap((k) => [el('dt', { textContent: METRICS[k].label }), el('dd', { textContent: fmt(k, m[k]) })]));
  box.replaceChildren(title, ...body, dl);
  const fs = S.edf.rates[ch], x = S.edf.signals[ch].subarray(win * WIN * fs, (win + 1) * WIN * fs);
  const c = $('trace'); c.width = c.clientWidth * (devicePixelRatio || 1);
  const g = c.getContext('2d'), mx = Math.max(...x.map(Math.abs), 1);
  g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent'); g.lineWidth = 1.5; g.beginPath();
  x.forEach((v, i) => { const px = (i / (x.length - 1)) * c.width, py = c.height / 2 - (v / mx) * (c.height / 2 - 6); i ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.stroke();
}

function drawChecklist() {
  const counts = new Map();
  S.flags.forEach((f) => counts.set(f.rule, (counts.get(f.rule) || 0) + 1));
  $('checklist').replaceChildren(...S.checklist.map((r, i) => {
    const mine = !DEFAULT_CHECKLIST.some((d) => d.id === r.id);
    const n = counts.get(r) || 0;
    const txt = el('span', { className: 'rule-txt' },
      el('strong', { textContent: r.name }), mine ? el('span', { className: 'badge mine', textContent: 'yours' }) : '',
      el('span', { className: 'hint', textContent: `${ruleText(r)} · flags ${span(n)} of signal` }));
    const rm = el('button', { className: 'ghost small', textContent: 'Remove' });
    rm.setAttribute('aria-label', `Remove rule ${r.name}`);
    rm.onclick = () => editChecklist(() => S.checklist.splice(i, 1), `Removing “${r.name}”`);
    return el('li', {}, txt, rm);
  }));
}

// ---- map interaction: click = inspect, drag = select region to teach from
// Canvas pixels are CSS-scaled by `max-width:100%`, so convert client coords back
// to canvas coords before hit-testing (otherwise clicks land in the wrong cell).
const hit = (e) => {
  const c = $('map'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const x = (e.clientX - r.left) * ((c._w || r.width) / r.width);
  const y = (e.clientY - r.top) * ((c._h || r.height) / r.height);
  const col = Math.floor((x - GUT) / (c._cw || 10)), ch = Math.floor((y - TOP) / ROW);
  return col >= 0 && ch >= 0 && col < S.cols && ch < S.by.length ? { ch, col, win: repWin(ch, col) } : null;
};
function select(a, h) {
  S.sel = { ch0: Math.min(a.ch, h.ch), ch1: Math.max(a.ch, h.ch), col0: Math.min(a.col, h.col), col1: Math.max(a.col, h.col) };
  S.cell = null; $('teach').disabled = false;
  $('teachHint').textContent = 'Region selected. Press “Teach a rule from selection”.';
  drawMap(); drawEvidence();
}
function inspect(h) {
  S.sel = null; S.cell = h; $('teach').disabled = true;
  $('teachHint').textContent = 'Click a square to see why. Drag across several squares to teach a rule.';
  if (h.ch === HUM.ch && h.win >= HUM.from) $('step1').classList.add('done');
  drawMap(); drawEvidence();
}
let anchor = null;
$('map').onpointerdown = (e) => { anchor = hit(e); if (anchor) $('map').setPointerCapture(e.pointerId); };
$('map').onpointermove = (e) => { const h = anchor && hit(e); if (h && (h.ch !== anchor.ch || h.col !== anchor.col || S.sel)) select(anchor, h); };
$('map').onpointerup = (e) => {
  const h = hit(e);
  if (anchor && h && h.ch === anchor.ch && h.col === anchor.col) inspect(h);
  anchor = null;
};
// Keyboard: arrows move the inspected square; Shift+arrows grow a selection from it.
let kAnchor = null;
$('map').onkeydown = (e) => {
  const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
  if (!d || !S.edf) return;
  e.preventDefault();
  const cur = S.sel && kAnchor ? kAnchor.end : S.cell ? { ch: S.cell.ch, col: colOf(S.cell.win) } : { ch: 0, col: 0 };
  const next = { ch: Math.max(0, Math.min(S.by.length - 1, cur.ch + d[0])), col: Math.max(0, Math.min(S.cols - 1, cur.col + d[1])) };
  if (!S.cell && !S.sel) return inspect({ ...cur, win: repWin(cur.ch, cur.col) });
  if (e.shiftKey) {
    kAnchor = kAnchor && S.sel ? { ...kAnchor, end: next } : { start: cur, end: next };
    select(kAnchor.start, next);
  } else { kAnchor = null; inspect({ ...next, win: repWin(next.ch, next.col) }); }
};
addEventListener('resize', () => { if (S.edf && !$('report').hidden) drawMap(); });

// ---- rule authoring
const unit = (m) => (METRICS[m].pct ? 100 : 1);
function showProposal(rule) {
  S.rule = rule;
  $('proposal').hidden = false;
  $('pMetric').value = rule.metric; $('pOp').value = rule.op; $('pValue').value = +(rule.value * unit(rule.metric)).toFixed(2);
  updatePreview();
  $('proposal').scrollIntoView({ block: 'nearest' });
}
function readProposal() {
  const metric = $('pMetric').value;
  return { ...S.rule, metric, op: $('pOp').value, value: Number($('pValue').value) / unit(metric) };
}
function updatePreview() {
  S.rule = readProposal();
  $('pUnit').textContent = METRICS[S.rule.metric].pct ? '%' : S.rule.metric === 'ptp' ? 'µV' : '';
  const f = evaluate([S.rule], S.by);
  S.preview = new Set(f.map((x) => `${x.ch}:${colOf(x.win)}`));
  const next = verdict(evaluate([...S.checklist, S.rule], S.by), S.by), now = S.last;
  const chs = new Set(f.map((x) => x.ch)).size;
  const catches = `Catches ${span(f.length)} of signal on ${chs} channel${chs === 1 ? '' : 's'} (dark bars on the map). `;
  $('pCount').replaceChildren(catches, next.label === now.label
    ? `The verdict stays ${now.label}.`
    : el('strong', { className: 'will-change', textContent: `Adding it changes the verdict: ${now.label} → ${next.label}.` }));
  drawMap();
}
function clearProposal() { S.rule = null; S.preview = new Set(); $('proposal').hidden = true; $('ruleError').textContent = ''; drawMap(); }

$('pMetric').replaceChildren(...Object.entries(METRICS).map(([k, m]) => el('option', { value: k, textContent: m.label })));
['pMetric', 'pOp', 'pValue'].forEach((id) => ($(id).oninput = updatePreview));
$('ruleForm').onsubmit = (e) => {
  e.preventDefault();
  const r = parseRule($('ruleText').value);
  if (!r) { $('ruleError').textContent = 'I couldn’t read that. Try “flag 60 Hz hum above 15%” or “flatline over 30%”.'; return; }
  $('ruleError').textContent = ''; showProposal(r);
  if (r.metric === 'line60') $('step2').classList.add('done');
};
$('teach').onclick = () => {
  const cells = [];
  for (let c = S.sel.ch0; c <= S.sel.ch1; c++) for (let col = S.sel.col0; col <= S.sel.col1; col++) {
    for (let w = firstWinOf(col); w < endWinOf(col); w++) cells.push({ ch: c, win: w });
  }
  const r = proposeRule(S.by, cells);
  if (!r) { $('ruleError').textContent = 'No single measure sets that region apart from the rest. Try selecting a tighter region.'; $('ruleError').scrollIntoView({ block: 'nearest' }); return; }
  $('ruleError').textContent = 'Suggested from your selection. Check the preview and adjust the threshold if you need to.';
  showProposal(r);
  $('step2').classList.add('done');
};
$('pAdd').onclick = () => {
  const r = S.rule;
  editChecklist(() => S.checklist.push(r), `Your rule “${r.name}”`);
  $('ruleText').value = ''; clearProposal();
  S.sel = null; $('teach').disabled = true; drawMap(); drawEvidence();
  $('teachHint').textContent = 'Click a square to see why. Drag across several squares to teach a rule.';
  if (!$('tryIt').hidden) { $('step3').classList.add('done'); $('tryDone').hidden = S.change.from.label === S.change.to.label; }
  $('verdict').scrollIntoView({ block: 'nearest' });
};
$('pCancel').onclick = clearProposal;

// ---- checklist import/export (imported JSON is untrusted: validate every field)
$('export').onclick = () => {
  const a = el('a', { download: 'somnium-checklist.json', href: URL.createObjectURL(new Blob([JSON.stringify({ rules: S.checklist }, null, 2)], { type: 'application/json' })) });
  a.click(); URL.revokeObjectURL(a.href);
};
$('import').onchange = async (e) => {
  try {
    const rules = normalizeRules(JSON.parse(await e.target.files[0].text()).rules);
    editChecklist(() => { S.checklist = rules; }, 'The imported checklist');
  } catch { $('ruleError').textContent = 'That file isn’t a valid Somnium checklist.'; }
  e.target.value = '';
};

// ---- loading
async function openFile(f) {
  $('error').textContent = '';
  try { load(parseEDF(await f.arrayBuffer()), { name: f.name }); } catch (err) { $('error').textContent = `Couldn’t read that file: ${err.message}`; }
}
$('file').onchange = (e) => e.target.files[0] && openFile(e.target.files[0]);
$('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); e.dataTransfer.files[0] && openFile(e.dataTransfer.files[0]); };
$('demo').onclick = () => { load(makeDemo(), { demo: true }); $('report').scrollIntoView({ block: 'start' }); };
if (new URLSearchParams(location.search).has('demo')) load(makeDemo(), { demo: true });

mountAccount(supabase, {
  getRules: () => S.checklist,
  setRules: rules => {
    if (!S.edf) { S.checklist = rules; S.starter = false; writeSaved(rules); return; }
    clearProposal();
    editChecklist(() => { S.checklist = rules; }, 'The loaded checklist');
  },
});
