import { METRICS } from './rules.js';

export function normalizeRules(rules) {
  if (!Array.isArray(rules) || rules.length > 100) throw new Error('A checklist must contain at most 100 valid rules.');
  return rules.map((r, i) => {
    if (!r || typeof r !== 'object' || typeof r.metric !== 'string' || !Object.hasOwn(METRICS, r.metric) ||
        !['>', '<'].includes(r.op) || !Number.isFinite(r.value) ||
        (r.name != null && (typeof r.name !== 'string' || [...r.name].length > 60)) ||
        (r.id != null && (typeof r.id !== 'string' || [...r.id].length > 100))) {
      throw new Error('That is not a valid Somnium checklist.');
    }
    return { id: r.id ?? `i${i}`, name: r.name ?? r.metric, metric: r.metric, op: r.op, value: r.value };
  });
}

export function checklistName(name) {
  if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 80) {
    throw new Error('Enter a checklist name of 1–80 characters.');
  }
  return name.trim();
}
