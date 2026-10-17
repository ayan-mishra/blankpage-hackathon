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
