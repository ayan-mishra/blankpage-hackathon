import { mountAccount } from './account.js';
import { supabase } from './supabase.js';
import { normalizeRules } from './checklists.js';
import { parseEDF } from './edf.js';
import { windowMetrics } from './metrics.js';
import { METRICS, DEFAULT_CHECKLIST, evaluate, verdict, explain, fmt, parseRule, proposeRule } from './rules.js';
import { demoFile } from './demo.js';
import { mapLayout, GUT, TOP, ROW } from './map.js';
import { mountHistory } from './history.js';

const WIN = 5; // seconds per window
const $ = (id) => document.getElementById(id);
const S = { edf: null, name: '', file: null, by: [], checklist: [...DEFAULT_CHECKLIST], flags: [], preview: new Set(), sel: null, cell: null, rule: null, step: 1, cols: 0 };

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

// A drawn column may cover S.step windows (long recordings aggregate; see map.js).
const colOf = (win) => Math.floor(win / S.step);
const firstWinOf = (col) => col * S.step;
const endWinOf = (col) => Math.min(S.by[0].length, (col + 1) * S.step);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hhmm = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`; };

// Which window a clicked cell stands for: the earliest flagged one, so clicking a
// red cell lands on the evidence that made it red.
function repWin(ch, col) {
  const w0 = firstWinOf(col), w1 = endWinOf(col);
  const flagged = S.flags.find((f) => f.ch === ch && f.win >= w0 && f.win < w1);
  return flagged ? flagged.win : w0;
}

function load(edf, name = '', checklist = null) {
  S.edf = edf;
  S.name = cleanName(name);
  // Reopening an analysis restores the exact rules it was saved with.
  if (Array.isArray(checklist)) S.checklist = checklist.map((r) => ({ ...r }));
  S.by = edf.signals.map((x, i) => windowMetrics(x, edf.rates[i], WIN));
  const n = Math.min(...S.by.map((w) => w.length));
  S.by = S.by.map((w) => w.slice(0, n));
  S.sel = S.cell = S.rule = null; S.preview = new Set();
  $('report').hidden = false;
  refresh();
  history.refresh();
}

function refresh() {
  S.flags = evaluate(S.checklist, S.by);
  const v = verdict(S.flags, S.by);
  const cls = v.label === 'usable' ? 'usable' : v.label === 'not usable' ? 'no' : 'fix';
  $('verdict').replaceChildren(
    Object.assign(document.createElement('b'), { textContent: 'Recording is' }),
    Object.assign(document.createElement('span'), { className: `pill ${cls}`, textContent: v.label }),
    Object.assign(document.createElement('span'), { className: 'hint', textContent: `${(v.bad * 100).toFixed(0)}% of channel-windows flagged by ${S.checklist.length} rules` }));
  drawMap(); drawEvidence(); drawChecklist();
}

function drawMap() {
  const c = $('map');
  const L = mapLayout(S.by[0].length, S.by.length, devicePixelRatio || 1);
  S.step = L.step; S.cols = L.cols;
  c.width = L.pxW; c.height = L.pxH; c.style.width = L.cssW + 'px'; c.style.height = L.cssH + 'px';
  const g = c.getContext('2d'); g.scale(L.scale, L.scale);
  const cw = L.cw;
  const css = (v) => getComputedStyle(document.body).getPropertyValue(v);
  const count = new Map();
  S.flags.forEach((f) => { const k = `${f.ch}:${colOf(f.win)}`; count.set(k, (count.get(k) || 0) + 1); });
  g.font = '12px system-ui'; g.fillStyle = css('--mute'); g.textBaseline = 'middle';
  S.edf.labels.forEach((l, i) => g.fillText(l.slice(0, 6), 2, TOP + i * ROW + ROW / 2));
  const every = Math.max(1, Math.ceil(40 / cw)); // keep time labels apart
  for (let col = 0; col < S.cols; col += every) g.fillText(hhmm(col * S.step * WIN), GUT + col * cw, 8);
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
  if (!S.cell) return box.replaceChildren(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Select a cell on the map.' }));
  const { ch, win } = S.cell, hits = S.flags.filter((f) => f.ch === ch && f.win === win);
  const lines = hits.length ? hits.map((f) => explain(f, S.edf.labels, WIN)) : [`${S.edf.labels[ch]}: no rule flagged this cell.`];
  if (S.step > 1) {
    lines.push(`This cell covers ${S.step} windows (${mmss(win * WIN)}–${mmss((win + S.step) * WIN)}); the trace shows one window.`);
  }
  const m = S.by[ch][win];
  lines.push('Metrics: ' + Object.keys(METRICS).map((k) => `${METRICS[k].label} ${fmt(k, m[k])}`).join(' · '));
  box.replaceChildren(...lines.map((l) => Object.assign(document.createElement('p'), { textContent: l })));
  const fs = S.edf.rates[ch], x = S.edf.signals[ch].subarray(win * WIN * fs, (win + 1) * WIN * fs);
  const c = $('trace'); c.width = c.clientWidth * (devicePixelRatio || 1);
  const g = c.getContext('2d'), mx = Math.max(...x.map(Math.abs), 1);
  g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent'); g.lineWidth = 1.5; g.beginPath();
  x.forEach((v, i) => { const px = (i / (x.length - 1)) * c.width, py = c.height / 2 - (v / mx) * (c.height / 2 - 6); i ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.stroke();
}

function drawChecklist() {
  $('checklist').replaceChildren(...S.checklist.map((r, i) => {
    const li = document.createElement('li');
    const txt = document.createElement('span');
    txt.textContent = `${r.name} — ${METRICS[r.metric].label} ${r.op} ${fmt(r.metric, r.value)}`;
    const rm = Object.assign(document.createElement('button'), { className: 'ghost', textContent: 'Remove' });
    rm.onclick = () => { S.checklist.splice(i, 1); refresh(); };
    li.append(txt, rm);
    return li;
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
let anchor = null;
$('map').onpointerdown = (e) => { anchor = hit(e); if (anchor) $('map').setPointerCapture(e.pointerId); };
$('map').onpointermove = (e) => {
  const h = anchor && hit(e); if (!h) return;
  S.sel = { ch0: Math.min(anchor.ch, h.ch), ch1: Math.max(anchor.ch, h.ch), col0: Math.min(anchor.col, h.col), col1: Math.max(anchor.col, h.col) };
  S.cell = null; $('teach').disabled = false; $('teachHint').textContent = 'Region selected. Click “Teach from selection”.';
  drawMap(); drawEvidence();
};
$('map').onpointerup = (e) => {
  const h = hit(e);
  if (anchor && h && h.ch === anchor.ch && h.col === anchor.col) { S.sel = null; S.cell = h; $('teach').disabled = true; $('teachHint').textContent = 'Drag across the map first.'; drawMap(); drawEvidence(); }
  anchor = null;
};

// ---- rule authoring
const unit = (m) => (METRICS[m].pct ? 100 : 1);
function showProposal(rule) {
  S.rule = rule;
  $('proposal').hidden = false;
  $('pMetric').value = rule.metric; $('pOp').value = rule.op; $('pValue').value = +(rule.value * unit(rule.metric)).toFixed(2);
  updatePreview();
}
function readProposal() {
  const metric = $('pMetric').value;
  return { ...S.rule, metric, op: $('pOp').value, value: Number($('pValue').value) / unit(metric) };
}
function updatePreview() {
  S.rule = readProposal();
  const f = evaluate([S.rule], S.by);
  S.preview = new Set(f.map((x) => `${x.ch}:${colOf(x.win)}`));
  $('pCount').textContent = `Would flag ${f.length} channel-windows (${new Set(f.map((x) => x.ch)).size} channels).`;
  drawMap();
}
function clearProposal() { S.rule = null; S.preview = new Set(); $('proposal').hidden = true; $('ruleError').textContent = ''; drawMap(); }

$('pMetric').replaceChildren(...Object.entries(METRICS).map(([k, m]) => Object.assign(document.createElement('option'), { value: k, textContent: m.label })));
['pMetric', 'pOp', 'pValue'].forEach((id) => ($(id).oninput = updatePreview));
$('ruleGo').onclick = () => {
  const r = parseRule($('ruleText').value);
  if (!r) { $('ruleError').textContent = 'I couldn’t read that. Try “flag 60 Hz hum above 15%” or “flatline over 30%”.'; return; }
  $('ruleError').textContent = ''; showProposal(r);
};
$('teach').onclick = () => {
  const cells = [];
  for (let c = S.sel.ch0; c <= S.sel.ch1; c++) for (let col = S.sel.col0; col <= S.sel.col1; col++) {
    for (let w = firstWinOf(col); w < endWinOf(col); w++) cells.push({ ch: c, win: w });
  }
  const r = proposeRule(S.by, cells);
  if (!r) { $('ruleError').textContent = 'No single metric separates that region from the rest. Try selecting a tighter region.'; return; }
  $('ruleError').textContent = 'Proposed from your example. Check the preview and adjust the threshold.'; showProposal(r);
};
$('pAdd').onclick = () => { S.checklist.push(S.rule); $('ruleText').value = ''; clearProposal(); refresh(); };
$('pCancel').onclick = clearProposal;

// ---- checklist import/export (imported JSON is untrusted: validate every field)
$('export').onclick = () => {
  const a = Object.assign(document.createElement('a'), { download: 'somnium-checklist.json', href: URL.createObjectURL(new Blob([JSON.stringify({ rules: S.checklist }, null, 2)], { type: 'application/json' })) });
  a.click(); URL.revokeObjectURL(a.href);
};
$('import').onchange = async (e) => {
  try {
    const rules = JSON.parse(await e.target.files[0].text()).rules;
    S.checklist = normalizeRules(rules);
    refresh();
  } catch { $('ruleError').textContent = 'That file isn’t a valid Somnium checklist.'; }
  e.target.value = '';
};

// ---- loading
// Every recording keeps its File so a saved analysis can store (and reopen) it.
async function openFile(f) {
  $('error').textContent = '';
  try {
    const edf = parseEDF(await f.arrayBuffer());
    S.file = f;
    load(edf, f.name);
  } catch (err) { $('error').textContent = `Couldn’t read that file: ${err.message}`; }
}
$('file').onchange = (e) => e.target.files[0] && openFile(e.target.files[0]);
$('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); e.dataTransfer.files[0] && openFile(e.dataTransfer.files[0]); };
$('demo').onclick = () => openFile(demoFile());

// Mount the history sidebar before the demo auto-load so load() can refresh it.
const history = mountHistory(supabase, {
  getRecording: recordingMeta,
  getFile: () => S.file,
  getChecklist: () => S.checklist,
  onOpen: (record, buffer) => {
    const edf = parseEDF(buffer);
    S.file = new File([buffer], record.filename, { type: 'application/edf' });
    load(edf, record.filename, record.checklist);
    $('report').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
});
if (new URLSearchParams(location.search).has('demo')) openFile(demoFile());

mountAccount(supabase, {
  getRules: () => S.checklist,
  setRules: rules => {
    S.checklist = rules;
    if (S.edf) { clearProposal(); refresh(); }
  },
});
