// Minimal 16-bit EDF parser. ES module, no dependencies.
// Signal-header field widths, in stored order: label, transducer, physDim,
// physMin, physMax, digMin, digMax, prefilter, samplesPerRecord, reserved.
const FIELDS = [16, 80, 8, 8, 8, 8, 8, 80, 8, 32];
const STARTS = FIELDS.map((_, i) => FIELDS.slice(0, i).reduce((a, b) => a + b, 0));

export function parseEDF(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 256) {
    throw new Error('EDF: buffer is shorter than the 256-byte fixed header');
  }
  const bytes = new Uint8Array(arrayBuffer);
  const text = (start, len) => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[start + i]);
    return s.trimEnd();
  };
  const sigStart = 256;
  // fields are stored field-by-field across all signals
  const at = (i, f) => text(sigStart + ns * STARTS[f] + i * FIELDS[f], FIELDS[f]);
  const ns = Number(text(252, 4));
  if (!Number.isInteger(ns) || ns <= 0) {
    throw new Error('EDF: signal count (ns) is not a positive integer');
  }
  if (arrayBuffer.byteLength < sigStart + ns * 256) {
    throw new Error('EDF: buffer is too short for the signal headers');
  }
  const numRecords = Number(text(236, 8));
  const recordDuration = Number(text(244, 8));
  const headerBytes = Number(text(184, 8)) || sigStart + ns * 256;
  if (!Number.isInteger(numRecords) || numRecords < 1) throw new Error('EDF: invalid record count');
  if (!(recordDuration > 0) || !Number.isFinite(recordDuration)) throw new Error('EDF: invalid record duration');
  if (!Number.isInteger(headerBytes) || headerBytes < sigStart + ns * 256) throw new Error('EDF: invalid header size');
  // Validate every size before allocating anything, so a hostile header can't exhaust memory.
  const sprs = Array.from({ length: ns }, (_, i) => Number(at(i, 8)));
  if (!sprs.every((n) => Number.isInteger(n) && n > 0)) throw new Error('EDF: invalid samples per record');
  const recordLen = sprs.reduce((a, b) => a + b, 0) * 2;
  if (arrayBuffer.byteLength < headerBytes + numRecords * recordLen) {
    throw new Error('EDF: buffer is too short for the declared data records');
  }
  const labels = [];
  const rates = [];
  const signals = [];
  const plan = []; // per signal (incl. annotations): samples/record + decode state
  for (let i = 0; i < ns; i++) {
    const spr = sprs[i];
    const label = at(i, 0);
    if (label.startsWith('EDF Annotations')) {
      plan.push({ spr }); // parsed for length, omitted from output
      continue;
    }
    const unit = at(i, 2).trim();
    const factor = { uV: 1, 'µV': 1, mV: 1000, V: 1000000, nV: 0.001 }[unit];
    if (!Number.isFinite(factor)) throw new Error(`EDF: unsupported physical unit "${unit}" for ${label}; expected a voltage unit`);
    const out = new Float32Array(numRecords * spr);
    // All amplitude rules and traces use microvolts, regardless of the EDF's units.
    const pmin = Number(at(i, 3)) * factor;
    const dmin = Number(at(i, 5));
    plan.push({
      spr, out, pmin, dmin,
      scale: (Number(at(i, 4)) * factor - pmin) / (Number(at(i, 6)) - dmin),
    });
    labels.push(label);
    rates.push(spr / recordDuration);
    signals.push(out);
  }
  // Int16Array reads are much faster than DataView.getInt16 but use platform byte order;
  // EDF is little-endian, so fall back to DataView on a big-endian host or unaligned data.
  const le = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const i16 = le && headerBytes % 2 === 0 ? new Int16Array(arrayBuffer, headerBytes, (numRecords * recordLen) / 2) : null;
  const view = new DataView(arrayBuffer);
  let off = 0; // in samples from headerBytes
  for (let r = 0; r < numRecords; r++) {
    for (const s of plan) {
      if (s.out) {
        const { out, dmin, scale, pmin, spr } = s, base = r * spr;
        if (i16) for (let k = 0; k < spr; k++) out[base + k] = (i16[off + k] - dmin) * scale + pmin;
        else for (let k = 0; k < spr; k++) out[base + k] = (view.getInt16(headerBytes + 2 * (off + k), true) - dmin) * scale + pmin;
      }
      off += s.spr;
    }
  }
  return { labels, rates, duration: numRecords * recordDuration, signals };
}
