// Live strip-chart: a pen draws EEG at the right edge while the paper scrolls left.
// Every ~9s it "records" a flatline and mains hum and marks them, the same story the app tells.
const SINES = [[1.3, 14], [4.1, 11], [9.3, 16], [17, 6], [23, 5], [37.7, 3.5], [51, 2.5]];
const eeg = (t, seed) => SINES.reduce((a, [f, m], i) => a + m * Math.sin(2 * Math.PI * f * t + seed * (i + 1.7)), 0);
const CYCLE = 9;

export function stripChart(canvas, { rows = 3, speed = 90, labels = ['F3', 'C3', 'O1'], ink = '#191a33', flag = '#f2a900', paper = '#fbf1ef', amp = 0.9 } = {}) {
  const g = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, raf = 0, visible = true;
  const size = () => {
    const d = devicePixelRatio || 1;
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * d; canvas.height = h * d; g.setTransform(d, 0, 0, d, 0, 0);
  };
  const phase = (t) => t - Math.floor(t / CYCLE) * CYCLE;
  const fault = (t, row) => {
    const p = phase(t);
    if (row === 1 && p > 2 && p < 5) return 'flat';
    if (row === rows - 1 && p > 5.6 && p < 8.4) return 'hum';
    return null;
  };
  function draw(now) {
    g.clearRect(0, 0, w, h);
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const cy = r * rh + rh / 2;
      let run = null;
      const marks = [];
      g.beginPath();
      for (let x = 56; x <= w; x += 0.7) {
        const t = now - (w - x) / speed, f = fault(t, r);
        let v = eeg(t, r + 1);
        if (f === 'flat') v = eeg(Math.floor(t / CYCLE) * CYCLE + 2, r + 1);
        if (f === 'hum') v += 55 * Math.sin(2 * Math.PI * 60 * t);
        const y = cy - Math.max(-rh * 0.46, Math.min(rh * 0.46, v * amp * (rh / 100)));
        x === 56 ? g.moveTo(x, y) : g.lineTo(x, y);
        if (f && !run) run = { f, x0: x };
        if (run && (!f || x + 0.7 > w)) { marks.push({ ...run, x1: x }); run = null; }
      }
      // bands under the trace, trace, then labels on top so no line ever crosses the text
      marks.forEach((m) => { g.save(); g.globalAlpha = 0.45; g.fillStyle = flag; g.fillRect(m.x0, r * rh + 6, m.x1 - m.x0, rh - 12); g.restore(); });
      g.strokeStyle = ink; g.lineWidth = 1.4; g.lineJoin = 'round'; g.stroke();
      marks.forEach((m) => label(m, r, rh));
      g.fillStyle = ink; g.font = '500 14px "Bricolage Grotesque", sans-serif'; g.textBaseline = 'middle';
      g.fillText(labels[r] || '', 12, cy);
      // the pen
      const py = cy - Math.max(-rh * 0.46, Math.min(rh * 0.46, eeg(now, r + 1) * amp * (rh / 100)));
      g.beginPath(); g.arc(w - 3, py, 4, 0, 7); g.fillStyle = flag; g.fill(); g.lineWidth = 2; g.strokeStyle = ink; g.stroke();
    }
  }
  function label(m, r, rh) {
    const text = m.f === 'flat' ? 'flatline' : '60 Hz hum', x = Math.max(m.x0 + 6, 60), y = r * rh + 10;
    g.font = '800 14px "Bricolage Grotesque", sans-serif'; g.textBaseline = 'middle';
    const tw = g.measureText(text).width;
    g.fillStyle = paper; g.fillRect(x - 5, y - 4, tw + 10, 20);
    g.strokeStyle = ink; g.lineWidth = 1.5; g.strokeRect(x - 5, y - 4, tw + 10, 20);
    g.fillStyle = ink; g.fillText(text, x, y + 6);
  }
  const loop = (ms) => { if (visible) draw(ms / 1000); raf = requestAnimationFrame(loop); };
  size(); addEventListener('resize', () => { size(); if (still) draw(CYCLE * 3 + 4); });
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);
  still ? draw(CYCLE * 3 + 4) : (raf = requestAnimationFrame(loop));
  return () => cancelAnimationFrame(raf);
}
