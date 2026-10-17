// Minimal 16-bit EDF encoder. Used to turn the synthetic demo into a real file,
// so a saved demo analysis can be reopened exactly like a dropped recording.
// signals: [{ label, fs, data, raw? }]
export function makeEdf(signals, seconds, { extraAnnotations = false } = {}) {
  const sigs = extraAnnotations
    ? [...signals, { label: 'EDF Annotations', fs: 1, data: new Float32Array(seconds), raw: true }]
    : signals;
  const ns = sigs.length;
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  const headerBytes = 256 + ns * 256;
  const perRecord = sigs.map((s) => s.fs);
  const recordLen = perRecord.reduce((a, b) => a + b, 0) * 2;
  const buf = new ArrayBuffer(headerBytes + recordLen * seconds);
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  let off = 0;
  const put = (s) => { for (const c of s) bytes[off++] = c.charCodeAt(0); };
  put(pad('0', 8)); put(pad('X X X X', 80)); put(pad('Startdate X', 80));
  put(pad('01.01.26', 8)); put(pad('00.00.00', 8)); put(pad(headerBytes, 8));
  put(pad('', 44)); put(pad(seconds, 8)); put(pad(1, 8)); put(pad(ns, 4));
  for (const s of sigs) put(pad(s.label, 16));
  for (let i = 0; i < ns; i++) put(pad('', 80));
  for (let i = 0; i < ns; i++) put(pad('uV', 8));
  for (let i = 0; i < ns; i++) put(pad(-500, 8));
  for (let i = 0; i < ns; i++) put(pad(500, 8));
  for (let i = 0; i < ns; i++) put(pad(-32768, 8));
  for (let i = 0; i < ns; i++) put(pad(32767, 8));
  for (let i = 0; i < ns; i++) put(pad('', 80));
  for (const s of sigs) put(pad(s.fs, 8));
  for (let i = 0; i < ns; i++) put(pad('', 32));
  off = headerBytes;
  for (let r = 0; r < seconds; r++) {
    for (const s of sigs) {
      for (let k = 0; k < s.fs; k++) {
        const v = s.raw ? 0 : Math.max(-500, Math.min(500, s.data[r * s.fs + k]));
        view.setInt16(off, s.raw ? 0 : Math.round(((v + 500) / 1000) * 65535 - 32768), true);
        off += 2;
      }
    }
  }
  return buf;
}

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
}
