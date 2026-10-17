import './gpu.js';
import { parseEDF } from './edf.js';
import { windowMetrics } from './metrics.js';
import { METRICS, DEFAULT_CHECKLIST, evaluate, verdict, explain, fmt, parseRule, proposeRule } from './rules.js';
import { makeDemo } from './demo.js';

const WIN = 5; // seconds per window
const $ = (id) => document.getElementById(id);
const S = { edf: null, by: [], checklist: [...DEFAULT_CHECKLIST], flags: [], preview: new Set(), sel: null, cell: null, rule: null };
const GUT = 44, TOP = 20, ROW = 30;

function load(edf) {
  S.edf = edf;
  S.by = edf.signals.map((x, i) => windowMetrics(x, edf.rates[i], WIN));
  const n = Math.min(...S.by.map((w) => w.length));
  S.by = S.by.map((w) => w.slice(0, n));
  S.sel = S.cell = S.rule = null; S.preview = new Set();
  $('report').hidden = false;
  refresh();
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
  const c = $('map'), n = S.by[0].length;
  const cw = Math.max(6, Math.min(16, Math.floor(($('mapwrap').clientWidth - GUT) / n))); // fit the container; scroll if tighter than 6px
  const w = GUT + n * cw, h = TOP + S.by.length * ROW, d = devicePixelRatio || 1;
  c.width = w * d; c.height = h * d; c.style.width = w + 'px'; c.style.height = h + 'px';
  const g = c.getContext('2d'); g.scale(d, d);
  const css = (v) => getComputedStyle(document.body).getPropertyValue(v);
  const count = new Map();
  S.flags.forEach((f) => count.set(`${f.ch}:${f.win}`, (count.get(`${f.ch}:${f.win}`) || 0) + 1));
  g.font = '12px system-ui'; g.fillStyle = css('--mute'); g.textBaseline = 'middle';
  S.edf.labels.forEach((l, i) => g.fillText(l.slice(0, 6), 2, TOP + i * ROW + ROW / 2));
  for (let k = 0; k < n; k += Math.ceil(60 / WIN)) g.fillText(`${(k * WIN) / 60}m`, GUT + k * cw, 8);
  for (let ch = 0; ch < S.by.length; ch++) for (let wi = 0; wi < n; wi++) {
    const key = `${ch}:${wi}`, x = GUT + wi * cw, y = TOP + ch * ROW;
    g.fillStyle = count.has(key) ? css('--bad') : css('--ok');
    g.fillRect(x + 1, y + 1, cw - 2, ROW - 2);
    if (S.preview.has(key)) { g.fillStyle = css('--pre'); g.fillRect(x + 1, y + ROW / 2, cw - 2, ROW / 2 - 1); }
  }
  g.lineWidth = 2; g.strokeStyle = css('--text');
  if (S.sel) g.strokeRect(GUT + S.sel.w0 * cw, TOP + S.sel.c0 * ROW, (S.sel.w1 - S.sel.w0 + 1) * cw, (S.sel.c1 - S.sel.c0 + 1) * ROW);
  else if (S.cell) g.strokeRect(GUT + S.cell.win * cw, TOP + S.cell.ch * ROW, cw, ROW);
  c._cw = cw;
}

function drawEvidence() {
  const box = $('evidence'), t = $('trace').getContext('2d');
  t.clearRect(0, 0, 9999, 9999);
  if (!S.cell) return box.replaceChildren(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Select a cell on the map.' }));
  const { ch, win } = S.cell, hits = S.flags.filter((f) => f.ch === ch && f.win === win);
  const lines = hits.length ? hits.map((f) => explain(f, S.edf.labels, WIN)) : [`${S.edf.labels[ch]}: no rule flagged this window.`];
  const m = S.by[ch][win];
  lines.push('Metrics: ' + Object.keys(METRICS).map((k) => `${METRICS[k].label} ${fmt(k, m[k])}`).join(' · '));
  box.replaceChildren(...lines.map((l) => Object.assign(document.createElement('p'), { textContent: l })));
  const fs = S.edf.rates[ch], x = S.edf.signals[ch].subarray(win * WIN * fs, (win + 1) * WIN * fs);
  const c = $('trace'); c.width = c.clientWidth * (devicePixelRatio || 1);
  const g = c.getContext('2d'), mean = x.reduce((a, b) => a + b, 0) / x.length, mx = Math.max(...x.map((v) => Math.abs(v - mean)), 1);
  g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent'); g.lineWidth = 1.5; g.beginPath();
  x.forEach((v, i) => { const px = (i / (x.length - 1)) * c.width, py = c.height / 2 - ((v - mean) / mx) * (c.height / 2 - 6); i ? g.lineTo(px, py) : g.moveTo(px, py); });
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
const hit = (e) => {
  const c = $('map'), r = c.getBoundingClientRect();
  const win = Math.floor((e.clientX - r.left - GUT) / c._cw), ch = Math.floor((e.clientY - r.top - TOP) / ROW);
  return win >= 0 && ch >= 0 && win < S.by[0].length && ch < S.by.length ? { ch, win } : null;
};
let anchor = null;
$('map').onpointerdown = (e) => { anchor = hit(e); if (anchor) $('map').setPointerCapture(e.pointerId); };
$('map').onpointermove = (e) => {
  const h = anchor && hit(e); if (!h) return;
  S.sel = { c0: Math.min(anchor.ch, h.ch), c1: Math.max(anchor.ch, h.ch), w0: Math.min(anchor.win, h.win), w1: Math.max(anchor.win, h.win) };
  S.cell = null; $('teach').disabled = false; $('teachHint').textContent = 'Region selected. Click “Teach from selection”.';
  drawMap(); drawEvidence();
};
$('map').onpointerup = (e) => {
  const h = hit(e);
  if (anchor && h && h.ch === anchor.ch && h.win === anchor.win) { S.sel = null; S.cell = h; $('teach').disabled = true; $('teachHint').textContent = 'Drag across the map first.'; drawMap(); drawEvidence(); }
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
  S.preview = new Set(f.map((x) => `${x.ch}:${x.win}`));
  $('pCount').textContent = `Would flag ${f.length} channel-windows (${new Set(f.map((x) => x.ch)).size === 1 ? '1 channel' : new Set(f.map((x) => x.ch)).size + ' channels'}).`;
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
  for (let c = S.sel.c0; c <= S.sel.c1; c++) for (let w = S.sel.w0; w <= S.sel.w1; w++) cells.push({ ch: c, win: w });
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
    if (!Array.isArray(rules) || !rules.every((r) => METRICS[r.metric] && ['>', '<'].includes(r.op) && Number.isFinite(r.value))) throw 0;
    S.checklist = rules.map((r, i) => ({ id: `i${i}`, name: String(r.name ?? r.metric).slice(0, 60), metric: r.metric, op: r.op, value: r.value }));
    refresh();
  } catch { $('ruleError').textContent = 'That file isn’t a valid Somnium checklist.'; }
  e.target.value = '';
};

// ---- loading
async function openFile(f) {
  $('error').textContent = '';
  try { load(parseEDF(await f.arrayBuffer())); } catch (err) { $('error').textContent = `Couldn’t read that file: ${err.message}`; }
}
$('file').onchange = (e) => e.target.files[0] && openFile(e.target.files[0]);
$('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); e.dataTransfer.files[0] && openFile(e.dataTransfer.files[0]); };
$('demo').onclick = () => load(makeDemo());
if (new URLSearchParams(location.search).has('demo')) load(makeDemo());
addEventListener('resize', () => S.edf && drawMap());
