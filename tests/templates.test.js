import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, FIELDS, checkValue, buildRules } from '../src/templates.js';
import { normalizeRules } from '../src/checklists.js';
import { METRICS, evaluate } from '../src/rules.js';

const DB_METRICS = ['flat', 'quiet', 'ptp', 'kurtosis', 'line50', 'line60'];

test('every template default builds rules the app and the database accept', () => {
  for (const t of TEMPLATES) {
    const { rules, errors } = buildRules(t, t.values);
    assert.equal(errors, undefined, t.name);
    assert.equal(rules.length, Object.keys(t.values).length);
    assert.deepEqual(normalizeRules(rules), rules); // nothing added or dropped
    for (const r of rules) {
      // mirrors private.valid_checklist_rules: exactly these keys, known metric/op, numeric value, bounded strings
      assert.deepEqual(Object.keys(r).sort(), ['id', 'metric', 'name', 'op', 'value']);
      assert.ok(DB_METRICS.includes(r.metric) && ['>', '<'].includes(r.op) && Number.isFinite(r.value));
      assert.ok(r.id.length <= 100 && r.name.length <= 60);
      assert.equal(r.op, METRICS[r.metric].low ? '<' : '>');
    }
  }
});

test('display units convert to rule units', () => {
  const t = { id: 'x', values: { flat: 0, line60: 0, quiet: 0, ptp: 0 } };
  const { rules } = buildRules(t, { flat: '50', line60: 15, quiet: '2.5', ptp: ' 300 ' });
  const by = Object.fromEntries(rules.map((r) => [r.metric, r]));
  assert.equal(by.flat.value, 0.5);
  assert.equal(by.line60.value, 0.15);
  assert.deepEqual([by.quiet.op, by.quiet.value], ['<', 2.5]);
  assert.equal(by.ptp.value, 300);
  // the built rule behaves like the sentence says
  const win = { flat: 0, quiet: 12, ptp: 50, kurtosis: 0, line50: 0, line60: 0 };
  assert.equal(evaluate(rules, [[win, { ...win, quiet: 1 }, { ...win, ptp: 301 }]]).length, 2);
});

test('rejects empty, non-numeric and out-of-range numbers with a message', () => {
  for (const raw of ['', '   ', null, undefined, 'abc', 'NaN', 'Infinity', '1e999']) {
    assert.equal(checkValue('ptp', raw).error, 'Enter a number.', String(raw));
  }
  assert.match(checkValue('flat', 100).error, /from 1 to 99%\.$/);
  assert.match(checkValue('quiet', 0).error, /from 0.1 to 20 µV/);
  assert.match(checkValue('kurtosis', 51).error, /from 1 to 50\.$/);
  assert.deepEqual(checkValue('flat', FIELDS.flat.min), { value: 1 });
  assert.deepEqual(checkValue('ptp', '2000'), { value: 2000 });
  const t = TEMPLATES[0];
  const { rules, errors } = buildRules(t, { ...t.values, ptp: '', quiet: '-1' });
  assert.equal(rules, undefined);
  assert.deepEqual(Object.keys(errors).sort(), ['ptp', 'quiet']);
});

test('templates only use known metrics, with defaults inside their own limits', () => {
  for (const t of TEMPLATES) {
    for (const [m, v] of Object.entries(t.values)) {
      assert.ok(FIELDS[m], `${t.name}: ${m}`);
      assert.deepEqual(checkValue(m, v), { value: v });
    }
  }
  assert.deepEqual(Object.keys(FIELDS).sort(), Object.keys(METRICS).sort());
});
