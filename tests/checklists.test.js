import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules, checklistName } from '../src/checklists.js';
import { DEFAULT_CHECKLIST } from '../src/rules.js';

test('normalizes a checklist without mutating it, discarding unknown fields', () => {
  const rules = DEFAULT_CHECKLIST.map(r => ({ ...r, secret: 'discard' }));
  assert.deepEqual(normalizeRules(rules), DEFAULT_CHECKLIST);
  assert.equal(rules[0].secret, 'discard');
  assert.deepEqual(normalizeRules([]), []);
  assert.equal(normalizeRules([{metric:'flat', op:'>', value:0.5}])[0].name, 'flat');
});
test('rejects malformed, hostile and oversized checklist input', () => {
  for (const input of [null, {}, [null], [4], [{metric:['flat'],op:'>',value:1}], [{metric:'toString',op:'>',value:1}],
    [{metric:'__proto__',op:'>',value:1}], [{metric:'flat',op:'=',value:1}],
    [{metric:'flat',op:'>',value:NaN}], [{metric:'flat',op:'>',value:Infinity}],
    [{metric:'flat',op:'>',value:'1'}], Array(101).fill(DEFAULT_CHECKLIST[0]),
    [{...DEFAULT_CHECKLIST[0],name:'a'.repeat(61)}]]) {
    assert.throws(() => normalizeRules(input), /checklist/i);
  }
});
test('names are trimmed and bounded', () => {
  assert.equal(checklistName('  My lab  '), 'My lab');
  for (const input of ['', '   ', null, 4, 'a'.repeat(81)]) assert.throws(() => checklistName(input), /name/i);
});
