import { mountAccount } from './account.js';
import { supabase } from './supabase.js';
import { normalizeRules, readSaved, writeSaved } from './checklists.js';
import { parseEDF } from './edf.js';
import { windowMetrics } from './metrics.js';
import { METRICS, DEFAULT_CHECKLIST, evaluate, verdict, fmt, parseRule, proposeRule } from './rules.js';
import { makeDemo, demoFile } from './demo.js';
import { mapLayout, GUT, TOP, ROW, MAP_W } from './map.js';
import { mountHistory } from './history.js';
import { TEMPLATES, FIELDS, buildRules, unitText } from './templates.js';
import { createTour } from './tour.js';

const WIN = 5; // seconds per window
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const S = { edf: null, name: '', file: null, demo: false, by: [], checklist: readSaved() ?? [...DEFAULT_CHECKLIST], flags: [], preview: new Set(), sel: null, cell: null, rule: null, step: 1, cols: 0, last: null, change: null, starter: false };
let loadGeneration = 0;

// Result boxes fold away. They open themselves when there is something to show: an
// explicit action (teaching a rule) always unfolds, a passive one (clicking a square)
// respects a box the visitor folded by hand.
const BOXES = ['evidenceBox', 'ruleBox'];
const autoOpen = (id, force = false) => {
  const box = $(id);
  if (force) delete box.dataset.folded;
  else if (box.dataset.folded === '1') return;
  box.open = true;
};
BOXES.forEach((id) => {
  const box = $(id);
  box.querySelector('summary').addEventListener('click', () => { box.dataset.folded = box.open ? '1' : '0'; });
});
function resetBoxes() { // a fresh report: Evidence folded, your rules unfolded
  const ev = $('evidenceBox'), rules = $('ruleBox');
  delete ev.dataset.folded; delete rules.dataset.folded;
  ev.open = false; rules.open = true;
}

// The demo starts from a 50 Hz lab's checklist (no 60 Hz rule) so the visitor can teach the
// missing rule from C4's hum and watch the verdict change. Real files get the saved or full default.
// The starter is not saved for study.html until the visitor edits it (S.starter tracks that).
// ponytail: demo-only starter, keyed off the metric so it tracks DEFAULT_CHECKLIST edits.
const DEMO_START = DEFAULT_CHECKLIST.filter((r) => r.metric !== 'line60');
const HUM = { ch: 3, from: 30 }; // C4, from 2:30 (window 30): where the demo's 60 Hz hum lives

// The hum stretch on the map, in viewport px. The canvas may be CSS-scaled, so measure it.
function humRect() {
  const c = $('map'), r = c.getBoundingClientRect(), kx = r.width / (c._w || 1), ky = r.height / (c._h || 1);
  const x0 = GUT + colOf(HUM.from) * c._cw, x1 = GUT + S.cols * c._cw, y0 = TOP + HUM.ch * ROW;
  return { left: r.left + x0 * kx, right: r.left + x1 * kx, top: r.top + y0 * ky, bottom: r.top + (y0 + ROW) * ky, width: (x1 - x0) * kx, height: ROW * ky };
}
// The demo's guided tour. Each step moves on when the visitor does it (tour.reach calls below).
const tour = createTour([
  { id: 'map', text: 'Click here — this looks clean, but it isn’t.', sub: 'C4 from 2:30 has 60 Hz electrical hum the starter rules miss.', target: humRect, around: () => $('map') },
  { id: 'teach', text: 'Press this to teach Somnium what you saw.', sub: 'It suggests a rule from the stretch you picked.', target: () => $('teach'), focus: () => $('teach') },
  { id: 'add', text: 'Add it to your rules.', sub: 'The preview shows what it would catch.', target: () => $('pAdd'), around: () => $('proposal'), focus: () => $('pAdd'), enter: () => autoOpen('ruleBox', true) },
  { id: 'done', text: () => (S.change && S.change.from.label !== S.change.to.label ? 'Your rule changed the verdict.' : 'Your rule is in. Check the verdict.'),
    sub: 'The starter checklist missed that hum. Now it’s caught.', target: () => $('verdictPill'), around: () => $('verdict'), focus: () => $('tourDone'), last: true },
], { onEnd: () => { $('tourAgain').hidden = !S.demo; if (S.demo) $('tourAgain').focus(); } });

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

// Metadata for the history sidebar. The recording itself is stored separately,
// and only when the user asks to keep it.
const RECORDING_NAME = 200;
const cleanName = (name) => {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed ? [...trimmed].slice(0, RECORDING_NAME).join('') : 'untitled.edf';
};
const recordingMeta = () => (S.edf ? {
  filename: cleanName(S.name),
  durationSec: S.edf.duration,
  channels: S.edf.labels.length,
  sampleRate: S.edf.rates[0],
} : null);

function load(edf, { demo = false, name = '', checklist = null } = {}) {
  S.edf = edf; S.demo = demo;
  if (demo) S.file = null; // encoded on demand when the demo is saved
  S.name = cleanName(demo ? 'demo-recording.edf' : name);
  S.by = edf.signals.map((x, i) => windowMetrics(x, edf.rates[i], WIN));
  const n = Math.min(...S.by.map((w) => w.length));
  S.by = S.by.map((w) => w.slice(0, n));
  S.sel = S.cell = S.rule = S.last = S.change = null; S.preview = new Set();
  if (demo) { S.checklist = DEMO_START.map((r) => ({ ...r })); S.starter = true; }
  else if (S.starter) { S.checklist = readSaved() ?? [...DEFAULT_CHECKLIST]; S.starter = false; } // don't carry the demo's partial checklist to a real file
  // Reopening an analysis restores the exact rules it was saved with.
  if (!demo && Array.isArray(checklist)) S.checklist = checklist.map((r) => ({ ...r }));
  $('proposal').hidden = true; $('ruleError').textContent = '';
  tour.stop(true); $('tourAgain').hidden = !demo; // openDemo starts the tour once the page is in place
  $('teach').disabled = true;
  $('loaded').textContent = `${demo ? 'Demo recording' : name} · ${edf.labels.length} channels, ${hhmm(n * WIN)}`;
  $('load').hidden = true;
  $('report').hidden = false;
  resetBoxes();
  refresh();
  history.refresh();
}

// Every checklist edit goes through here so the verdict card can say what the edit did.
function editChecklist(fn, what) {
  const before = verdict(S.flags, S.by);
  fn(); S.starter = false; writeSaved(S.checklist);
  refresh();
  const after = S.last;
  S.change = { what, from: before, to: after };
  drawVerdict(true);
  history.refresh(); // offers "Save rules to this analysis" when the rules now differ
}

function refresh() {
  S.flags = evaluate(S.checklist, S.by);
  S.last = verdict(S.flags, S.by);
  drawVerdict(); drawMap(); drawEvidence(); drawChecklist();
  if (S.rule) updatePreview();
  if ($('tplBox').open) previewTemplate();
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

// Plain names for standard 10-20 sites (odd = left, even = right, z = middle). A label referenced to an
// ear or common reference ("C3-A2", "EEG O1") keeps its site; anything else (e.g. bipolar "F7-Fpz") is shown as recorded.
const SITES = { // standard 10-20 regions in plain words
  FP1: 'Left forehead', FPZ: 'Mid-forehead', FP2: 'Right forehead',
  F7: 'Left front-temple', F3: 'Left frontal', FZ: 'Midline frontal', F4: 'Right frontal', F8: 'Right front-temple',
  T3: 'Left temple', T7: 'Left temple', T4: 'Right temple', T8: 'Right temple',
  C3: 'Left central', CZ: 'Top-of-head', C4: 'Right central',
  T5: 'Left back-temple', P7: 'Left back-temple', T6: 'Right back-temple', P8: 'Right back-temple',
  P3: 'Left parietal', PZ: 'Midline parietal', P4: 'Right parietal',
  O1: 'Left back-of-head', OZ: 'Back-of-head', O2: 'Right back-of-head',
  A1: 'Left ear', M1: 'Left mastoid', A2: 'Right ear', M2: 'Right mastoid',
};
function place(label) {
  const site = SITES[label.trim().match(/^(?:EEG\s+)?([a-z]+\d*)(?:-(?:a1|a2|m1|m2|ref|le|avg))?$/i)?.[1].toUpperCase()];
  return site ? `${site} sensor (${label.trim()})` : `Sensor ${label.trim()}`;
}

function drawEvidence() {
  const box = $('evidence'), t = $('trace').getContext('2d');
  t.clearRect(0, 0, 9999, 9999);
  $('trace').hidden = $('numbers').hidden = !S.cell; // no empty box before something is selected
  if (S.sel) {
    const chs = S.sel.ch1 - S.sel.ch0 + 1, secs = (endWinOf(S.sel.col1) - firstWinOf(S.sel.col0)) * WIN;
    $('evidenceMeta').textContent = `${chs} channel${chs > 1 ? 's' : ''} · ${mmss(secs)} selected`;
    autoOpen('evidenceBox');
    return box.replaceChildren(el('p', { className: 'hint', textContent: `Selected ${chs} channel${chs > 1 ? 's' : ''} over ${mmss(secs)} (${S.edf.labels[S.sel.ch0]}${chs > 1 ? `–${S.edf.labels[S.sel.ch1]}` : ''}, from ${mmss(firstWinOf(S.sel.col0) * WIN)}). Press “Teach a rule from selection” to get a suggested rule.` }));
  }
  if (!S.cell) $('evidenceMeta').textContent = 'Click a square on the map';
  if (!S.cell) return box.replaceChildren(el('p', { className: 'hint', textContent: 'Click a square on the map to see why it was flagged, or why not.' }));
  const { ch, win } = S.cell, hits = S.flags.filter((f) => f.ch === ch && f.win === win);
  const end = S.step > 1 ? win + S.step : win + 1;
  $('evidenceMeta').textContent = `${S.edf.labels[ch]} · ${mmss(win * WIN)}–${mmss(end * WIN)} · ${hits.length ? 'flagged' : 'clean'}`;
  autoOpen('evidenceBox');
  // Simplified view first: status, where/when, what happened, what to do. Rule text and values sit behind "Show the numbers".
  const title = el('h3', { className: 'ev-title' },
    el('span', { className: `badge ${hits.length ? 'bad' : 'ok'}`, textContent: hits.length ? 'Flagged' : 'Clean' }),
    `${place(S.edf.labels[ch])}, ${mmss(win * WIN)}–${mmss(end * WIN)}`);
  // One line per cause: flat + faint are both "lost contact", so the same advice isn't repeated.
  const causes = [...new Map(hits.map((f) => [METRICS[f.rule.metric].cause, METRICS[f.rule.metric]])).values()];
  const list = (items, cls) => (items.length === 1 ? el('p', { className: cls, textContent: items[0] }) : el('ul', { className: cls }, ...items.map((t) => el('li', { textContent: t }))));
  const body = causes.length
    ? [list(causes.map((m) => m.simple), 'ev-lead'), el('p', { className: 'ev-do-head', textContent: 'What to do' }), list(causes.map((m) => `${m.fix}.`), 'ev-do')]
    : [el('p', { className: 'ev-lead', textContent: 'Looks fine. None of your rules found a problem here.' }),
      el('p', { className: 'hint', textContent: 'If the trace below still looks wrong to you, drag across this stretch on the map and press “Teach a rule from selection”.' })];
  if (S.step > 1) body.push(el('p', { className: 'hint', textContent: `This square covers ${S.step} windows; the trace shows the first.` }));
  box.replaceChildren(title, ...body);
  const m = S.by[ch][win];
  const dl = el('dl', { className: 'metrics' }, ...Object.keys(METRICS).flatMap((k) => [el('dt', { textContent: METRICS[k].label }), el('dd', { textContent: fmt(k, m[k]) })]));
  $('numbersBody').replaceChildren(...hits.map((f) => {
    const mm = METRICS[f.rule.metric];
    return el('p', { className: 'tech', textContent: `${mm.label} is ${fmt(f.rule.metric, f.value)}, ${f.rule.op === '<' ? 'under' : 'over'} your rule “${f.rule.name}” (${f.rule.op} ${fmt(f.rule.metric, f.rule.value)}). ${mm.why}.` });
  }), dl);
  const fs = S.edf.rates[ch], x = S.edf.signals[ch].subarray(win * WIN * fs, (win + 1) * WIN * fs);
  const c = $('trace'); c.width = c.clientWidth * (devicePixelRatio || 1);
  // Centre on the window mean, and never zoom past ±50 µV: flat stays flat and faint stays faint.
  let mean = 0; for (const v of x) mean += v; mean /= x.length || 1;
  let mx = 50; for (const v of x) mx = Math.max(mx, Math.abs(v - mean));
  const g = c.getContext('2d');
  g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent'); g.lineWidth = 1.5; g.beginPath();
  x.forEach((v, i) => { const px = (i / (x.length - 1)) * c.width, py = c.height / 2 - ((v - mean) / mx) * (c.height / 2 - 6); i ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.stroke();
}

function drawChecklist() {
  const counts = new Map();
  S.flags.forEach((f) => counts.set(f.rule, (counts.get(f.rule) || 0) + 1));
  $('rulesMeta').textContent = `${S.checklist.length} rule${S.checklist.length === 1 ? '' : 's'} · flags ${pct(S.last.bad)} of the recording`;
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
  if (S.sel.ch0 <= HUM.ch && S.sel.ch1 >= HUM.ch && S.sel.col1 >= colOf(HUM.from)) tour.reach('teach'); // dragged over the hum
}
function inspect(h) {
  S.sel = null; S.cell = h; $('teach').disabled = true;
  $('teachHint').textContent = 'Click a square to see why. Drag across several squares to teach a rule.';
  drawMap(); drawEvidence();
  // Tour: clicking any hum square is enough. Pre-select the whole hum stretch so step 2 needs no precise drag.
  if (!tour.at('map') && !tour.at('teach')) return;
  if (h.ch === HUM.ch && h.win >= HUM.from) {
    S.sel = { ch0: HUM.ch, ch1: HUM.ch, col0: colOf(HUM.from), col1: S.cols - 1 };
    $('teach').disabled = false; drawMap();
    tour.reach('teach');
  } else if (tour.at('teach')) tour.go('map'); // the selection is gone, so point back at the hum
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
  autoOpen('ruleBox', true);
  $('pMetric').value = rule.metric; $('pOp').value = rule.op; $('pValue').value = +(rule.value * unit(rule.metric)).toFixed(2);
  updatePreview();
  $('proposal').scrollIntoView({ block: 'nearest' });
  tour.reach('add');
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
function clearProposal() {
  S.rule = null; S.preview = new Set(); $('proposal').hidden = true; $('ruleError').textContent = ''; drawMap();
  if (tour.at('add')) tour.go(S.sel ? 'teach' : 'map'); // no Add rule button to point at any more
}

$('pMetric').replaceChildren(...Object.entries(METRICS).map(([k, m]) => el('option', { value: k, textContent: m.label })));
['pMetric', 'pOp', 'pValue'].forEach((id) => ($(id).oninput = updatePreview));
$('ruleForm').onsubmit = (e) => {
  e.preventDefault();
  const r = parseRule($('ruleText').value);
  if (!r) { $('ruleError').textContent = 'I couldn’t read that. Try “flag 60 Hz hum above 15%” or “flatline over 30%”.'; return; }
  $('ruleError').textContent = ''; showProposal(r);
};
$('teach').onclick = () => {
  autoOpen('ruleBox', true); // the proposal lives in this box
  const cells = [];
  for (let c = S.sel.ch0; c <= S.sel.ch1; c++) for (let col = S.sel.col0; col <= S.sel.col1; col++) {
    for (let w = firstWinOf(col); w < endWinOf(col); w++) cells.push({ ch: c, win: w });
  }
  const r = proposeRule(S.by, cells);
  if (!r) { $('ruleError').textContent = 'No single measure sets that region apart from the rest. Try selecting a tighter region.'; $('ruleError').scrollIntoView({ block: 'nearest' }); return; }
  $('ruleError').textContent = 'Suggested from your selection. Check the preview and adjust the threshold if you need to.';
  showProposal(r);
};
$('pAdd').onclick = () => {
  const r = S.rule;
  editChecklist(() => S.checklist.push(r), `Your rule “${r.name}”`);
  tour.reach('done'); // before clearProposal, which would send an open tour back a step
  $('ruleText').value = ''; clearProposal();
  S.sel = null; $('teach').disabled = true; drawMap(); drawEvidence();
  $('teachHint').textContent = 'Click a square to see why. Drag across several squares to teach a rule.';
  $('verdict').scrollIntoView({ block: 'nearest' });
};
$('pCancel').onclick = clearProposal;

// ---- templates: preset checklists with the user's own numbers (data and validation in templates.js)
const tpl = () => TEMPLATES[$('tplPick').value];
const tplInputs = () => [...$('tplRules').querySelectorAll('input')];
const readTemplate = () => buildRules(tpl(), Object.fromEntries(tplInputs().map((i) => [i.name, i.value])));
function drawTemplate() {
  const t = tpl();
  $('tplAbout').textContent = t.about;
  $('tplRules').replaceChildren(...Object.entries(t.values).map(([metric, v]) => {
    const f = FIELDS[metric];
    const input = el('input', { type: 'number', name: metric, value: v, min: f.min, max: f.max, step: f.step, inputMode: 'decimal', id: `tpl-${metric}` });
    input.setAttribute('aria-describedby', `tpl-${metric}-err`);
    return el('li', {}, el('label', {}, `${f.before} `, el('span', { className: 'tpl-num' }, input, unitText(f.unit))), el('span', { className: 'tpl-err', id: `tpl-${metric}-err` }));
  }));
  previewTemplate();
}
function previewTemplate() {
  if (!S.edf) return;
  const { rules, errors = {} } = readTemplate();
  tplInputs().forEach((i) => { i.setAttribute('aria-invalid', String(Boolean(errors[i.name]))); $(`${i.id}-err`).textContent = errors[i.name] || ''; });
  if (!rules) return $('tplCount').replaceChildren('Fix the numbers marked above to see what this would flag.');
  const v = verdict(evaluate(rules, S.by), S.by);
  $('tplCount').replaceChildren(`Would flag ${pct(v.bad)} of this recording (your rules now: ${pct(S.last.bad)}), so it would be `,
    el('strong', { textContent: v.label }), v.label === S.last.label ? ', same as now.' : ` instead of ${S.last.label}.`);
}
$('tplPick').replaceChildren(...TEMPLATES.map((t, i) => el('option', { value: i, textContent: t.name })));
$('tplPick').onchange = drawTemplate;
$('tplRules').oninput = previewTemplate;
$('tplBox').ontoggle = () => $('tplBox').open && previewTemplate();
$('tplForm').onsubmit = (e) => {
  e.preventDefault();
  previewTemplate();
  const { rules } = readTemplate();
  if (!rules) return tplInputs().find((i) => i.getAttribute('aria-invalid') === 'true')?.focus();
  clearProposal();
  editChecklist(() => { S.checklist = rules; }, `The “${tpl().name}” template`);
  $('verdict').scrollIntoView({ block: 'nearest' });
};
drawTemplate();

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
  const gen = ++loadGeneration;
  $('error').textContent = '';
  try {
    const buffer = await f.arrayBuffer();
    if (gen !== loadGeneration) return;
    const edf = parseEDF(buffer);
    S.file = f; // kept so a saved analysis can store (and reopen) it
    load(edf, { name: f.name });
  } catch (err) { if (gen === loadGeneration) $('error').textContent = `Couldn’t read that file: ${err.message}`; return; }
  history.autoSave(); // every real recording joins the sidebar list; the demo never does on its own
}
// "+ New analysis": back to the upload view.
function showUpload() {
  loadGeneration++;
  S.edf = null; S.file = null; S.demo = false; tour.stop(true);
  $('report').hidden = true; $('load').hidden = false;
  $('error').textContent = ''; $('file').value = '';
  scrollTo(0, 0);
}
function openDemo() { loadGeneration++; history.setActive(null); load(makeDemo(), { demo: true }); scrollTo(0, 0); tour.start(); $('tourAgain').hidden = true; }
$('tourAgain').onclick = openDemo; // a fresh demo: the tour needs the starter rules back
$('file').onchange = (e) => e.target.files[0] && openFile(e.target.files[0]);
$('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); e.dataTransfer.files[0] && openFile(e.dataTransfer.files[0]); };
$('demo').onclick = openDemo;
// Mount the history sidebar before the demo auto-load so load() can refresh it.
const history = mountHistory(supabase, {
  getRecording: recordingMeta,
  getFile: () => S.file ?? (S.demo ? demoFile() : null),
  getChecklist: () => S.checklist,
  onOpen: (record, buffer) => {
    loadGeneration++;
    const edf = parseEDF(buffer);
    S.file = new File([buffer], record.filename, { type: 'application/edf' });
    load(edf, { name: record.filename, checklist: record.checklist });
    scrollTo(0, 0);
  },
  onNew: showUpload,
});

// The app is gated: nothing runs until sign-in, then ?demo (kept through sign-in) opens the demo.
mountAccount(supabase, {
  onSignedIn: (intent) => { if (intent.has('demo')) openDemo(); },
  onSignedOut: () => { history.setActive(null); showUpload(); },
  getRules: () => S.checklist,
  setRules: rules => {
    if (!S.edf) { S.checklist = rules; S.starter = false; writeSaved(rules); return; }
    clearProposal();
    editChecklist(() => { S.checklist = rules; }, 'The loaded checklist');
  },
});
