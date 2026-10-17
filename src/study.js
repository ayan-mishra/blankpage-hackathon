import './gpu.js';
import { parseEDF } from './edf.js';
import { windowMetrics } from './metrics.js';
import { DEFAULT_CHECKLIST } from './rules.js';
import { normalizeRules, readSaved, writeSaved, SAVED_KEY } from './checklists.js';
import { analyzeNight, participantOf, toCsv, STATUS, dur, message, byParticipant, needsFollowUp } from './wear.js';
import { makeStudy } from './demo.js';
import { mountAccount } from './account.js';
import { supabase } from './supabase.js';

const WIN = 10; // seconds per window
const $ = (id) => document.getElementById(id);
const ORDER = { error: -1, bad: 0, check: 1, ok: 2 };
let rows = [], last = null, lastLabel = '';
let runGeneration = 0;
let checklist = readSaved(); // null = built-in default; else the one built in app.html or imported here

function checkEdf(file, edf) {
  const by = edf.signals.map((x, i) => windowMetrics(x, edf.rates[i], WIN));
  if (!by.length || by.some((c) => !c.length)) throw new Error('This recording is shorter than one 10-second window.');
  return { participant: participantOf(file), file, ...analyzeNight(by, WIN, checklist ?? DEFAULT_CHECKLIST, edf.labels) };
}

const el = (tag, { dataset, role, ariaLabel, ...props } = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(e.dataset, dataset);
  if (role) e.setAttribute('role', role);
  if (ariaLabel) e.setAttribute('aria-label', ariaLabel);
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
  return el('div', { className: 'timeline', role: 'img', ariaLabel: `Whole night, left to right: clean ${Math.round(good.filter(Boolean).length / good.length * 100)}% of the time. Yellow marks problems.` }, Object.assign(el('div'), { style: `background:linear-gradient(90deg,${stops.join(',')})` }));
}

const KIND = { bad: 'no', check: 'fix', ok: 'usable', error: 'err' };
const kindOf = (r) => (r.error ? 'error' : r.status);
const LABEL = { ...STATUS, error: 'Could not read' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function copyButton(r) {
  const label = 'Copy full message';
  return el('button', { className: 'ghost small', textContent: label, onclick: async (e) => {
    try { await navigator.clipboard.writeText(message(r)); e.target.textContent = 'Copied'; }
    catch { // clipboard blocked: show the text selected so Ctrl+C still works
      const box = e.target.nextElementSibling?.tagName === 'TEXTAREA' ? e.target.nextElementSibling : e.target.after(el('textarea', { readOnly: true, rows: 4, className: 'msgbox', value: message(r) })) ?? e.target.nextElementSibling;
      box.focus(); box.select(); e.target.textContent = 'Press Ctrl+C to copy';
    }
    setTimeout(() => (e.target.textContent = label), 2500);
  } });
}

function jumpTo(participant) {
  if ($('onlyBad').checked && !rows.some((r) => r.participant === participant && needsFollowUp(r))) { $('onlyBad').checked = false; render(); }
  const tr = [...document.querySelectorAll('#table tbody tr[data-p]')].find((t) => t.dataset.p === participant);
  if (!tr) return;
  tr.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash');
  tr.focus({ preventScroll: true });
}

function summary(people) {
  const todo = people.filter((p) => p.flagged);
  const multi = people.some((p) => p.nights > 1);
  const nights = multi ? ` (${rows.filter(needsFollowUp).length} of ${plural(rows.length, 'night')})` : '';
  const count = (k) => rows.filter((r) => kindOf(r) === k).length;
  const parts = ['bad', 'check', 'ok', 'error'].map((k) => [k, count(k)]).filter(([, n]) => n);
  return [
    el('h2', { textContent: todo.length ? `Follow up with ${todo.length} of ${plural(people.length, 'participant')}${nights}` : `Everyone wore the headband properly (${plural(rows.length, 'night')})` }),
    el('div', { className: 'mix', role: 'img', ariaLabel: parts.map(([k, n]) => `${n} ${LABEL[k].toLowerCase()}`).join(', ') },
      ...parts.map(([k, n]) => el('span', { className: `seg ${KIND[k]}`, style: `flex:${n}` }))),
    el('p', { className: 'mixkey' }, ...parts.map(([k, n]) => el('span', {}, el('i', { className: KIND[k] }), `${n} ${LABEL[k].toLowerCase()}`))),
    ...(todo.length ? [
      el('h3', { textContent: 'Who to contact' }),
      el('ul', { className: 'who' }, ...todo.map((p) => el('li', {}, el('button', { type: 'button', className: 'chip', onclick: () => jumpTo(p.participant), ariaLabel: `${p.participant}: ${LABEL[kindOf(p.worst)]}. Show their row.` },
        el('i', { className: KIND[kindOf(p.worst)] }), el('b', { textContent: p.participant }),
        el('span', { textContent: p.nights > 1 ? `problem on ${p.flagged} of ${p.nights} nights` : p.worst.error ? 'Could not read' : `${Math.round(p.worst.goodPct * 100)}% clean` }))))),
    ] : []),
  ];
}

// The rail lists who needs a follow-up and jumps to their row, like the analyses list does for recordings.
function drawPeople(people) {
  const todo = people.filter((p) => p.flagged);
  $('people').hidden = !todo.length;
  $('peopleList').replaceChildren(...todo.map((p) => el('li', {}, el('button', {
    type: 'button',
    ariaLabel: `${p.participant}: show their row`,
    onclick: () => { setDrawer(false); jumpTo(p.participant); },
  }, el('b', { textContent: p.participant }),
    el('span', { className: 'hint', textContent: p.nights > 1 ? `problem on ${p.flagged} of ${p.nights} nights` : p.worst.error ? 'Could not read' : `${Math.round(p.worst.goodPct * 100)}% clean` })))));
}

function render() {
  $('results').hidden = !rows.length;
  $('load').hidden = !!rows.length;
  const people = rows.length ? byParticipant(rows) : [];
  drawPeople(people);
  if (!rows.length) {
    $('summary').replaceChildren();
    document.querySelector('#table tbody').replaceChildren();
    $('onlyBadCount').textContent = '';
    return;
  }
  $('summary').replaceChildren(...summary(people));
  $('onlyBadCount').textContent = `(${rows.filter(needsFollowUp).length})`;
  const shown = [...rows].sort((a, b) => ORDER[kindOf(a)] - ORDER[kindOf(b)] || a.participant.localeCompare(b.participant, undefined, { numeric: true }))
    .filter((r) => !$('onlyBad').checked || needsFollowUp(r));
  const seen = new Set();
  const out = [];
  shown.forEach((r, i) => {
    const k = kindOf(r);
    if (i === 0 || kindOf(shown[i - 1]) !== k) {
      const n = shown.filter((x) => kindOf(x) === k).length;
      out.push(el('tr', { className: 'group' }, el('th', { colSpan: 5, scope: 'colgroup' }, el('i', { className: KIND[k] }), `${LABEL[k]} · ${plural(n, 'night')}`)));
    }
    const td = (label, props, ...kids) => el('td', { ...props, dataset: { label } }, ...kids);
    const first = !seen.has(r.participant); seen.add(r.participant);
    const tr = (...cells) => el('tr', { tabIndex: -1, ...(first ? { dataset: { p: r.participant } } : {}) }, ...cells);
    if (r.error) return out.push(tr(td('Participant', {}, el('b', { textContent: r.participant }), el('div', { className: 'hint', textContent: r.file })), td('Status', {}, el('span', { className: 'pill err', textContent: 'Could not read' })), td('What happened', { textContent: r.error, colSpan: 2 }), td('What to do', { textContent: 'Re-export the file from the headband app and try again.' })));
    const tell = r.status !== 'ok' || r.ask.includes('both sensors');
    out.push(tr(
      td('Participant', {}, el('b', { textContent: r.participant }), el('div', { className: 'hint', textContent: `${r.file} · ${dur(r.duration).replace(' ', '\u00a0')}` })),
      td('Status', {}, el('span', { className: `pill ${KIND[r.status]}`, textContent: STATUS[r.status] })),
      td('Clean signal', {}, el('b', { textContent: `${Math.round(r.goodPct * 100)}%` }), timeline(r.good)),
      td('What happened', {}, el('div', { textContent: r.summary }), el('div', { className: 'simple', textContent: `In plain words: ${r.simple}` })),
      // the quote already says what to do when it exists, so the coordinator note would only repeat it
      td('What to do', {}, ...(tell && r.status !== 'ok' ? [] : [el('div', { textContent: r.action })]),
        ...(tell ? [el('div', { className: 'tell' }, el('span', { className: 'tell-label', textContent: 'Tell them' }), el('q', { textContent: r.ask }), copyButton(r))] : []))));
  });
  document.querySelector('#table tbody').replaceChildren(...out);
}

async function run(items, label = '') {
  const gen = ++runGeneration;
  rows = []; last = items; lastLabel = label;
  $('studyTitle').textContent = `${label ? `${label} · ` : ''}${plural(items.length, 'recording')}`;
  render();
  for (let i = 0; i < items.length; i++) {
    const { name, load } = items[i];
    $('bar').hidden = false; $('bar').value = i / items.length;
    $('progress').textContent = `Checking ${i + 1} of ${items.length}: ${name}`;
    await new Promise((r) => setTimeout(r, 0)); // let the progress text paint
    if (gen !== runGeneration) return;
    let row;
    try {
      const edf = await load();
      if (gen !== runGeneration) return;
      row = checkEdf(name, edf);
    }
    catch (e) { row = { participant: participantOf(name), file: name, error: `Couldn’t read this file: ${e.message}` }; }
    if (gen !== runGeneration) return;
    rows.push(row);
    render();
  }
  $('bar').hidden = true;
  $('progress').textContent = `Checked ${items.length} recording${items.length === 1 ? '' : 's'}.`;
}

const fromFiles = (files) => run([...files].map((f) => ({ name: f.name, load: async () => parseEDF(await f.arrayBuffer()) })));
$('files').onchange = (e) => e.target.files.length && fromFiles(e.target.files);
$('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); e.dataTransfer.files.length && fromFiles(e.dataTransfer.files); };
$('sample').onclick = () => run(makeStudy().map(({ name, edf }) => ({ name, load: async () => edf })), 'Sample study');
// ---- sidebar: the same drawer behaviour as app.html's analyses rail
const sidebar = $('sidebar'), toggle = $('sideToggle');
const setDrawer = (open) => { sidebar.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open)); };
toggle.onclick = () => setDrawer(!sidebar.classList.contains('open'));

// "+ New study": drop the results and go back to the drop zone.
function showUpload() {
  runGeneration++;
  rows = []; last = null; lastLabel = '';
  $('studyTitle').textContent = ''; $('progress').textContent = '';
  $('files').value = ''; $('bar').hidden = true; $('bar').value = 0;
  render(); scrollTo(0, 0);
}
$('newStudy').onclick = () => { setDrawer(false); showUpload(); };

$('onlyBad').onchange = render;
$('csv').onclick = () => {
  const a = Object.assign(document.createElement('a'), { download: 'somnium-wear-check.csv', href: URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' })) });
  a.click(); URL.revokeObjectURL(a.href);
};
function drawRules(note = '') {
  $('rulesUsed').replaceChildren(checklist
    ? el('span', {}, el('b', { textContent: `Using your checklist: ${plural(checklist.length, 'rule')}` }), ' · ',
      el('button', { type: 'button', className: 'linkish', textContent: 'Reset to default', onclick: () => setChecklist(null, 'Back to the default checklist.') }))
    : el('span', { textContent: `Using the default checklist (${plural(DEFAULT_CHECKLIST.length, 'rule')}). ` }, el('a', { href: 'app.html', textContent: 'Write your own' })));
  $('rulesNote').textContent = note;
}
function setChecklist(rules, note) {
  checklist = rules; writeSaved(rules); drawRules(note);
  if (last) run(last, lastLabel); // regrade what's on screen with the new rules
}
$('importRules').onchange = async (e) => {
  try { setChecklist(normalizeRules(JSON.parse(await e.target.files[0].text()).rules), 'Checklist imported.'); }
  catch { drawRules('That file isn’t a valid Somnium checklist.'); }
  e.target.value = '';
};
// another tab (app.html) changed the checklist
addEventListener('storage', (e) => { if (e.key === null || e.key === SAVED_KEY) { checklist = readSaved(); drawRules('Your checklist changed in another tab.'); if (last) run(last, lastLabel); } });
drawRules();
// Gated like app.html; ?sample (kept through sign-in) runs the sample study.
mountAccount(supabase, {
  onSignedIn: (intent) => { if (intent.has('sample')) $('sample').click(); },
  onSignedOut: () => {
    $('onlyBad').checked = false;
    setDrawer(false); showUpload();
  },
});
