// Guided tour (coach marks): one short instruction at a time in a floating callout, an arrow
// from the callout to the exact thing to press, and a pulsing ring around it. The app moves the
// tour along when the visitor does each thing (see app.js). The callout lives in app.html (#tour).

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Pure geometry, unit-tested in tests/tour.test.js. All rects are viewport (client) coordinates.
// target: what the arrow points at. around: what the callout must not cover (the target, or a
// bigger box holding it, e.g. the whole map). box: callout size. view: viewport size.
// The callout goes below `around` if it fits, else above, else on the roomier side. The arrow is
// vertical at the middle of the target's on-screen part, from the callout's edge to a tip `inset`
// px inside the target, so the tip always lands on the target.
export function placeCallout(target, around, box, view, { gap = 40, margin = 12, inset = 6 } = {}) {
  const roomBelow = view.h - around.bottom - gap - margin, roomAbove = around.top - gap - margin;
  const side = box.h <= roomBelow ? 'below' : box.h <= roomAbove ? 'above' : roomBelow >= roomAbove ? 'below' : 'above';
  const top = side === 'below' ? around.bottom + gap : around.top - gap - box.h;
  const x = (Math.max(target.left, 0) + Math.min(target.right, view.w)) / 2;
  const left = clamp(x - box.w / 2, margin, Math.max(margin, view.w - margin - box.w));
  const tipIn = Math.min(inset, target.height / 2);
  const arrow = side === 'below'
    ? { x, from: top, to: target.bottom - tipIn }
    : { x, from: top + box.h, to: target.top + tipIn };
  return { side, left, top, arrow };
}

const $ = (id) => document.getElementById(id);
const rectOf = (t) => (t instanceof Element ? t.getBoundingClientRect() : t);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// steps: [{ id, text, sub, target: () => Element|rect, around?: () => Element, focus?: () => Element,
//           enter?: () => void, last?: true }]. text may be a function (read when the step shows).
export function createTour(steps, { onEnd } = {}) {
  const box = $('tour'), arrow = $('tourArrow'), ring = $('tourRing');
  let i = -1, raf = 0, last = '';

  function frame() {
    raf = requestAnimationFrame(frame);
    const s = steps[i], el = s.target();
    // A closed <details> keeps its children's boxes in Chrome, so ask whether the target is actually shown.
    const t = el instanceof Element && el.checkVisibility?.() === false ? null : rectOf(el);
    const view = { w: document.documentElement.clientWidth, h: innerHeight };
    const size = { w: box.offsetWidth, h: box.offsetHeight };
    let css;
    if (t && t.width > 0 && t.height > 0) {
      const p = placeCallout(t, s.around ? rectOf(s.around()) : t, size, view);
      css = { box: [p.left, p.top], arrow: [p.arrow.x - 9, Math.min(p.arrow.from, p.arrow.to), Math.abs(p.arrow.from - p.arrow.to), p.side === 'below' ? 'up' : 'down'],
        ring: [t.left - 5, t.top - 5, t.width + 10, t.height + 10] };
    } else css = { box: [(view.w - size.w) / 2, view.h - size.h - 12] }; // target folded away: dock at the bottom, no arrow
    const key = JSON.stringify(css);
    if (key === last) return;
    last = key;
    box.style.left = `${css.box[0]}px`; box.style.top = `${css.box[1]}px`;
    arrow.hidden = ring.hidden = !css.arrow;
    if (css.arrow) {
      const [x, y, h, dir] = css.arrow, [rx, ry, rw, rh] = css.ring;
      Object.assign(arrow.style, { left: `${x}px`, top: `${y}px`, height: `${h}px` }); arrow.dataset.dir = dir;
      Object.assign(ring.style, { left: `${rx}px`, top: `${ry}px`, width: `${rw}px`, height: `${rh}px` });
    }
  }

  function show(n) {
    i = n; last = '';
    const s = steps[i], text = typeof s.text === 'function' ? s.text() : s.text;
    s.enter?.();
    $('tourCount').textContent = `${i + 1} of ${steps.length}`;
    $('tourText').textContent = text; $('tourSub').textContent = s.sub || '';
    $('tourSkip').hidden = !!s.last; $('tourDone').hidden = !s.last;
    $('tourLive').textContent = `Tour, step ${i + 1} of ${steps.length}: ${text} ${s.sub || ''}`;
    box.hidden = false;
    const el = s.around?.() || s.target();
    if (el instanceof Element) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    }
    if (n > 0) s.focus?.()?.focus({ preventScroll: true });
    if (!raf) frame();
  }
  const index = (id) => steps.findIndex((s) => s.id === id);

  function stop(quiet = false) {
    if (i < 0) return;
    i = -1; cancelAnimationFrame(raf); raf = 0;
    box.hidden = arrow.hidden = ring.hidden = true;
    $('tourLive').textContent = quiet ? '' : 'Tour closed.';
    if (!quiet) onEnd?.();
  }

  $('tourSkip').onclick = $('tourDone').onclick = () => stop();
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && i >= 0) stop(); });

  return {
    start() { show(0); box.focus({ preventScroll: true }); },
    stop,
    at: (id) => i >= 0 && steps[i].id === id,
    go: (id) => { if (i >= 0) show(index(id)); },
    reach: (id) => { if (i >= 0 && index(id) > i) show(index(id)); }, // forward only: skipping ahead is fine, going back is not
    active: () => i >= 0,
  };
}
