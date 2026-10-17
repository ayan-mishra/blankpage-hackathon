import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNight, participantOf, toCsv, dur } from '../src/wear.js';
import { DEFAULT_CHECKLIST } from '../src/rules.js';

const clean = () => ({ flat: 0, ptp: 50, kurtosis: 0, line50: 0, line60: 0 });
const flat = () => ({ ...clean(), flat: 1 });
const night = (n, bad, make = flat, chs = 2) => Array.from({ length: chs }, () => Array.from({ length: n }, (_, i) => (bad(i) ? make() : clean())));

test('clean night is worn properly', () => {
  const r = analyzeNight(night(60, () => false), 10, DEFAULT_CHECKLIST);
  assert.equal(r.status, 'ok'); assert.equal(r.goodPct, 1); assert.equal(r.cause, null);
});

test('signal lost halfway to the end is flagged with cause and time', () => {
  const r = analyzeNight(night(60, (i) => i >= 30), 10, DEFAULT_CHECKLIST);
  assert.equal(r.status, 'check'); // exactly 50% clean
  assert.equal(r.cause, 'contact');
  assert.match(r.summary, /lost contact/);
  assert.match(r.summary, /until the end/);
  assert.match(r.action, /snugly/);
});

test('mostly bad is "bad"', () => {
  assert.equal(analyzeNight(night(60, (i) => i >= 10), 10, DEFAULT_CHECKLIST).status, 'bad');
});

test('one bad channel out of two still counts as worn (half clean)', () => {
  const by = [night(60, () => true)[0], night(60, () => false)[0]];
  assert.equal(analyzeNight(by, 10, DEFAULT_CHECKLIST).status, 'ok');
});

test('a sensor failing all night is named and never described as clean', () => {
  const by = [night(60, () => true)[0], night(60, () => false)[0]];
  const r = analyzeNight(by, 10, DEFAULT_CHECKLIST, ['F7-Fpz', 'F8-Fpz']);
  assert.equal(r.status, 'ok'); // keep the existing half-clean grading policy
  assert.match(r.summary, /F7-Fpz had problems for 100% of the night/);
  assert.match(r.simple, /whole night/);
  assert.doesNotMatch(r.summary + r.simple + r.action, /Clean signal all night|Everything worked|Nothing to do/);
  assert.match(r.action, /sensor/);
});

test('hum is attributed to interference', () => {
  const r = analyzeNight(night(60, (i) => i >= 20, () => ({ ...clean(), line50: 0.9 })), 10, DEFAULT_CHECKLIST);
  assert.equal(r.cause, 'hum'); assert.match(r.action, /cables/);
});

test('participant ids and csv quoting', () => {
  assert.equal(participantOf('P012_night3.edf'), 'P012');
  assert.equal(participantOf('anna-2.EDF'), 'anna');
  assert.equal(participantOf('solo.edf'), 'solo');
  const csv = toCsv([{ participant: 'P1', file: 'a"b.edf', status: 'ok', goodPct: 0.9, duration: 7200, summary: 'x, y', action: 'z' }]);
  assert.match(csv, /"a""b.edf"/); assert.match(csv, /"x, y"/); assert.match(csv, /"Worn properly"/);
  assert.equal(dur(7500), '2h 05m');
});

test('one failing sensor is reported even when the night counts as worn', () => {
  const by = [night(60, (i) => i >= 20 && i < 50)[0], night(60, () => false)[0]];
  const r = analyzeNight(by, 10, DEFAULT_CHECKLIST, ['F7-Fpz', 'F8-Fpz']);
  assert.equal(r.status, 'ok');
  assert.match(r.summary, /F7-Fpz had problems for 50% of the night/);
  assert.match(r.action, /next visit/);
});

test('csv neutralizes spreadsheet formulas from file names and labels', () => {
  const csv = toCsv([{ participant: '=HYPERLINK("http://x")', file: '+a.edf', status: 'ok', goodPct: 1, duration: 60, summary: '@SUM(A1)', action: '-1' }]);
  assert.match(csv, /"'=HYPERLINK/); assert.match(csv, /"'\+a\.edf"/); assert.match(csv, /"'@SUM/); assert.match(csv, /"'-1"/);
  assert.doesNotMatch(csv, /(^|,)"[=+\-@]/m);
});

test('every result has a plain-words line', () => {
  assert.equal(analyzeNight(night(60, () => false), 10, DEFAULT_CHECKLIST).simple, 'Everything worked all night.');
  assert.match(analyzeNight(night(60, (i) => i >= 20), 10, DEFAULT_CHECKLIST).simple, /stopped touching the skin.*never came back/);
});

test('participant message is plain and actionable', async () => {
  const { message } = await import('../src/wear.js');
  const r = analyzeNight(night(60, (i) => i >= 20), 10, DEFAULT_CHECKLIST);
  const m = message(r);
  assert.match(m, /stopped touching the skin/); assert.match(m, /Please clean your forehead/); assert.doesNotMatch(m, /Ask them/);
});

test('participants roll up across nights, worst first', async () => {
  const { byParticipant, needsFollowUp } = await import('../src/wear.js');
  const rows = [
    { participant: 'P2', status: 'ok' },
    { participant: 'P10', status: 'ok' }, { participant: 'P10', status: 'check' }, { participant: 'P10', status: 'ok' },
    { participant: 'P1', status: 'bad' },
    { participant: 'P3', error: 'nope' },
    { participant: 'P4', status: 'ok' },
  ];
  const r = byParticipant(rows);
  assert.deepEqual(r.map((p) => p.participant), ['P3', 'P1', 'P10', 'P2', 'P4']);
  const p10 = r.find((p) => p.participant === 'P10');
  assert.equal(p10.nights, 3); assert.equal(p10.flagged, 1); assert.equal(p10.worst.status, 'check');
  assert.equal(needsFollowUp({ status: 'ok' }), false); assert.equal(needsFollowUp({ error: 'x' }), true);
});

test('grading uses the checklist it is given, not the default', () => {
  const swings = night(60, (i) => i >= 20, () => ({ ...clean(), ptp: 200 })); // under the default 300 µV
  assert.equal(analyzeNight(swings, 10, DEFAULT_CHECKLIST).status, 'ok');
  const strict = [...DEFAULT_CHECKLIST, { id: 'r1', name: 'Swings over 150', metric: 'ptp', op: '>', value: 150 }];
  const r = analyzeNight(swings, 10, strict);
  assert.equal(r.status, 'bad'); assert.equal(r.cause, 'loose');
  assert.equal(analyzeNight(night(60, (i) => i >= 20), 10, []).status, 'ok'); // no rules, nothing flagged
});
