import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRule, evaluate, verdict, proposeRule, DEFAULT_CHECKLIST } from '../src/rules.js';

const win = (o = {}) => ({ flat: 0, quiet: 12, ptp: 50, kurtosis: 0, line50: 0, line60: 0, ...o });

test('parseRule understands common phrasings', () => {
  assert.deepEqual(
    (({ metric, op, value }) => ({ metric, op, value }))(parseRule('flag windows with flatline over 30%')),
    { metric: 'flat', op: '>', value: 0.3 });
  assert.deepEqual(
    (({ metric, op, value }) => ({ metric, op, value }))(parseRule('60 Hz line noise above 15%')),
    { metric: 'line60', op: '>', value: 0.15 });
  const a = parseRule('amplitude bigger than 250 uV');
  assert.equal(a.metric, 'ptp'); assert.equal(a.value, 250);
  const pick = (t) => (({ metric, op, value }) => ({ metric, op, value }))(parseRule(t));
  assert.deepEqual(pick('flag signal below 2 µV'), { metric: 'quiet', op: '<', value: 2 });
  assert.deepEqual(pick('too faint, 3 uV'), { metric: 'quiet', op: '<', value: 3 }); // faint means low by default
  assert.deepEqual(pick('swings below 20 µV'), { metric: 'ptp', op: '<', value: 20 }); // explicit swing word keeps ptp
  assert.equal(parseRule('make it nicer'), null);
  assert.equal(parseRule('flatline'), null); // no threshold
});

test('evaluate and verdict', () => {
  const by = [[win(), win({ flat: 1 })], [win(), win()]];
  const flags = evaluate(DEFAULT_CHECKLIST, by);
  assert.equal(flags.length, 1);
  assert.deepEqual([flags[0].ch, flags[0].win], [0, 1]);
  assert.equal(verdict(flags, by).label, 'usable after fixes'); // 1 of 4 windows = 25%
});

test('verdict thresholds', () => {
  const by = [Array.from({ length: 20 }, () => win())];
  by[0][0] = win({ flat: 1 });
  assert.equal(verdict(evaluate(DEFAULT_CHECKLIST, by), by).label, 'usable');
});

test('proposeRule finds the separating metric', () => {
  const by = [Array.from({ length: 20 }, (_, i) => win({ kurtosis: i % 3, line60: i % 2 ? 0.01 : 0.02 })),
              Array.from({ length: 20 }, () => win())];
  by[0][5] = win({ kurtosis: 20 }); by[0][6] = win({ kurtosis: 25 });
  const r = proposeRule(by, [{ ch: 0, win: 5 }, { ch: 0, win: 6 }]);
  assert.equal(r.metric, 'kurtosis');
  assert.ok(r.value > 2 && r.value < 20);
  assert.equal(proposeRule(by, []), null);
});

test('proposeRule learns a low-is-bad metric as a below rule', () => {
  const by = [Array.from({ length: 20 }, (_, i) => win({ quiet: 10 + (i % 4), ptp: 60 + (i % 7) * 10 }))];
  by[0][3] = win({ quiet: 0.8, ptp: 50 }); by[0][4] = win({ quiet: 0.9, ptp: 55 });
  const r = proposeRule(by, [{ ch: 0, win: 3 }, { ch: 0, win: 4 }]);
  assert.equal(r.metric, 'quiet');
  assert.equal(r.op, '<');
  assert.ok(r.value > 0.9 && r.value < 10, `${r.value}`);
});
