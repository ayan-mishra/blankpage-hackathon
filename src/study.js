import './gpu.js';
import { parseEDF } from './edf.js';
import { windowMetrics } from './metrics.js';
import { DEFAULT_CHECKLIST } from './rules.js';
import { analyzeNight, participantOf, toCsv, STATUS, dur } from './wear.js';
import { makeStudy } from './demo.js';

const WIN = 10; // seconds per window
const $ = (id) => document.getElementById(id);
const ORDER = { bad: 0, check: 1, ok: 2 };
let rows = [];

function checkEdf(file, edf) {
  const by = edf.signals.map((x, i) => windowMetrics(x, edf.rates[i], WIN));
  if (!by.length || by.some((c) => !c.length)) throw new Error('This recording is shorter than one 10-second window.');
  return { participant: participantOf(file), file, ...analyzeNight(by, WIN, DEFAULT_CHECKLIST, edf.labels) };
}

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// the strip shows the whole night: dark = clean, marigold = problem
function timeline(good) {
  const stops = [];
  let i = 0;
  while (i < good.length) {
    let j = i; while (j < good.length && good[j] === good[i]) j++;
    const c = good[i] ? 'var(--ok)' : 'var(--bad)';
    stops.push(`${c} ${(i / good.length) * 100}% ${(j / good.length) * 100}%`);
    i = j;
  }
  return el('div', { className: 'timeline', title: 'Whole night, left to right. Yellow = problem.' }, Object.assign(el('div'), { style: `background:linear-gradient(90deg,${stops.join(',')})` }));
}

function render() {
  $('results').hidden = !rows.length;
  if (!rows.length) return;
  const need = rows.filter((r) => r.error || r.status !== 'ok');
  const sorted = [...rows].sort((a, b) => (a.error ? -1 : ORDER[a.status]) - (b.error ? -1 : ORDER[b.status]) || a.participant.localeCompare(b.participant, undefined, { numeric: true }));
  $('summary').replaceChildren(
    el('h2', { textContent: need.length ? `${need.length} of ${rows.length} recordings need a follow-up` : `All ${rows.length} recordings look good` }),
    el('p', { className: 'hint', textContent: `${rows.filter((r) => !r.error && r.status === 'ok').length} worn properly · ${rows.filter((r) => r.status === 'check').length} to check · ${rows.filter((r) => r.status === 'bad').length} not worn properly${rows.some((r) => r.error) ? ` · ${rows.filter((r) => r.error).length} unreadable` : ''}` }));
  const tb = document.querySelector('#table tbody');
  tb.replaceChildren(...sorted.filter((r) => !$('onlyBad').checked || r.error || r.status !== 'ok').map((r) => {
    if (r.error) return el('tr', {}, el('td', { textContent: r.participant }), el('td', {}, el('span', { className: 'pill no', textContent: 'Could not read' })), el('td', { textContent: '–' }), el('td', { textContent: r.error, colSpan: 2 }));
    const pill = el('span', { className: `pill ${r.status === 'ok' ? 'usable' : r.status === 'check' ? 'fix' : 'no'}`, textContent: STATUS[r.status] });
    return el('tr', {},
      el('td', {}, el('b', { textContent: r.participant }), el('div', { className: 'hint', textContent: `${r.file} · ${dur(r.duration)}` })),
      el('td', {}, pill),
      el('td', {}, el('b', { textContent: `${Math.round(r.goodPct * 100)}%` }), timeline(r.good)),
      el('td', { textContent: r.summary }),
      el('td', { textContent: r.action }));
  }));
}

async function run(items) {
  rows = [];
  for (let i = 0; i < items.length; i++) {
    const { name, load } = items[i];
    $('progress').textContent = `Checking ${i + 1} of ${items.length}: ${name}`;
    await new Promise((r) => setTimeout(r, 0)); // let the progress text paint
    try { rows.push(checkEdf(name, await load())); }
    catch (e) { rows.push({ participant: participantOf(name), file: name, error: `Couldn’t read this file: ${e.message}` }); }
    render();
  }
  $('progress').textContent = `Checked ${items.length} recording${items.length === 1 ? '' : 's'}.`;
}

const fromFiles = (files) => run([...files].map((f) => ({ name: f.name, load: async () => parseEDF(await f.arrayBuffer()) })));
$('files').onchange = (e) => e.target.files.length && fromFiles(e.target.files);
$('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); e.dataTransfer.files.length && fromFiles(e.dataTransfer.files); };
$('sample').onclick = () => run(makeStudy().map(({ name, edf }) => ({ name, load: async () => edf })));
$('onlyBad').onchange = render;
$('csv').onclick = () => {
  const a = Object.assign(document.createElement('a'), { download: 'somnium-wear-check.csv', href: URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' })) });
  a.click(); URL.revokeObjectURL(a.href);
};
if (new URLSearchParams(location.search).has('sample')) $('sample').click();
