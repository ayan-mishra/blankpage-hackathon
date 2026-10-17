// Preset checklists the user fills with their own numbers. Pure data + helpers, no DOM.
// Numbers are entered in display units (% or µV) and stored in rule units (fractions for % metrics).
import { METRICS, DEFAULT_CHECKLIST } from './rules.js';

// One editable sentence per metric: before [number] unit. op follows the metric's bad direction.
// flat/line max is 99, not 100: these metrics are shares of the window, so "> 100%" could never fire.
export const FIELDS = {
  flat: { before: 'Flag a window when the signal is flat for more than', unit: '%', min: 1, max: 99, step: 1 },
  quiet: { before: 'Flag signal fainter than', unit: 'µV', min: 0.1, max: 20, step: 0.1 },
  ptp: { before: 'Flag swings bigger than', unit: 'µV', min: 20, max: 2000, step: 10 },
  kurtosis: { before: 'Flag spikiness above', unit: '', min: 1, max: 50, step: 0.5 },
  line50: { before: 'Flag 50 Hz hum above', unit: '%', min: 1, max: 99, step: 1 },
  line60: { before: 'Flag 60 Hz hum above', unit: '%', min: 1, max: 99, step: 1 },
};

// Sources: docs/research/evidence.md. Windows are 5 s, so flat 50% = 2.5 s of dead-flat signal.
// "Own choice" marks numbers that are Somnium's judgement, not a published default.
export const TEMPLATES = [
  {
    id: 'home', name: 'Home sleep headband',
    about: 'Forehead headbands worn overnight at home, on either mains frequency.',
    values: {
      flat: 50, // Somnium default; EEGLAB clean_rawdata's 5 s flatline criterion would need a whole window, too late for brief lift-offs (own choice)
      quiet: 2, // seated electrodes read ~9 µV std or more, unseated ~1 µV (Parry & Briganti 2026)
      ptp: 400, // evidence R2: forehead montages pick up eye movements of hundreds of µV, so 400 rather than 300
      kurtosis: 8, // Somnium default; absolute heuristic, only catches sharp transients (own choice)
      line50: 20, line60: 20, // 20% of variance in one bin is gross hum (evidence: lenient but defensible); both, since homes vary
    },
  },
  {
    id: 'psg', name: 'Sleep lab (PSG)',
    about: 'Wet electrodes in a sleep lab: tighter hum, sleep-sized swings.',
    values: {
      flat: 50, quiet: 2, // as above
      ptp: 300, // evidence: defensible for sleep; MNE's 100 µV would flag healthy slow-wave sleep (N3 can exceed 200 µV)
      kurtosis: 8, // Somnium default (own choice)
      line50: 10, line60: 10, // evidence R4 suggests 10%; lab amplifiers should show less hum (own choice to apply it here)
    },
  },
  {
    id: 'cap50', name: 'Research EEG cap, 50 Hz lab',
    about: 'Awake recordings with a gel cap, on 50 Hz power (Europe, Asia, Africa, Australia).',
    values: {
      flat: 50, quiet: 2,
      ptp: 150, // between MNE's 100 µV reject example and the 300 µV sleep limit, so blinks don't flag everything (own choice)
      kurtosis: 5, // stricter than the sleep default: awake data has no spindles or K-complexes to raise it (own choice)
      line50: 10, // evidence R4: lower hum to 10% and only check the local mains frequency
    },
  },
  {
    id: 'cap60', name: 'Research EEG cap, 60 Hz lab',
    about: 'Awake recordings with a gel cap, on 60 Hz power (Americas, parts of Japan).',
    values: { flat: 50, quiet: 2, ptp: 150, kurtosis: 5, line60: 10 }, // same reasoning as the 50 Hz cap
  },
  {
    id: 'strict', name: 'Strict',
    about: 'Flags anything doubtful. Expect more flags, including some healthy signal.',
    values: {
      flat: 20, // 1 s of a 5 s window (own choice)
      quiet: 5, // under Parry & Briganti's 10 µV std "flat" line, above the ~1 µV of an unseated sensor
      ptp: 100, // MNE tutorial reject example (awake, ERP-style)
      kurtosis: 5, // own choice
      line50: 5, line60: 5, // own choice
    },
  },
];

// '50%' but '2 µV'
export const unitText = (unit) => (unit === '%' ? '%' : unit ? ` ${unit}` : '');

const NAMES = Object.fromEntries(DEFAULT_CHECKLIST.map((r) => [r.metric, r.name]));
const scale = (metric) => (METRICS[metric].pct ? 100 : 1);

// raw: what the user typed (string or number). Returns { value } in display units, or { error }.
export function checkValue(metric, raw) {
  const f = FIELDS[metric];
  const text = String(raw ?? '').trim();
  const n = text === '' ? NaN : Number(text);
  if (!Number.isFinite(n)) return { error: 'Enter a number.' };
  if (n < f.min || n > f.max) return { error: `Enter a number from ${f.min} to ${f.max}${unitText(f.unit)}.` };
  return { value: n };
}

// values: { metric: raw input } for the template's metrics. Returns { rules } or { errors: { metric: message } }.
export function buildRules(template, values) {
  const errors = {}, rules = [];
  for (const metric of Object.keys(template.values)) {
    const r = checkValue(metric, values[metric]);
    if (r.error) { errors[metric] = r.error; continue; }
    rules.push({ id: `${template.id}-${metric}`, name: NAMES[metric], metric, op: METRICS[metric].low ? '<' : '>', value: r.value / scale(metric) });
  }
  return Object.keys(errors).length ? { errors } : { rules };
}
