import { makeDemo } from './demo.js';
import { windowMetrics } from './metrics.js';
import { stripChart } from './strip.js';
import { DEFAULT_CHECKLIST, evaluate, verdict, explain, proposeRule } from './rules.js';
import { supabase } from './supabase.js';
import { submitAuth } from './auth.js';

// ---- hero account: the app pages need an account, so signed-out links into them stop here
// at the sign-in form and remember where the visitor was going.
{
  const $ = (id) => document.getElementById(id);
  const form = $('heroForm'), email = $('heroEmail'), password = $('heroPassword'), status = $('heroStatus');
  // Same-origin path only; a leading "//" would make location.assign leave the site.
  const appPath = (href) => {
    const u = new URL(href, location.href);
    return u.origin === location.origin ? u.pathname.replace(/^\/+/, '/') + u.search : '/app.html';
  };
  let session = null, busy = false, next = appPath('app.html');
  const say = (message, error = false) => { status.textContent = message; status.classList.toggle('error', error); };
  const render = () => {
    form.hidden = !supabase || !!session;
    $('heroSignedIn').hidden = !session;
    $('heroWho').textContent = session?.user.email ?? '';
    $('demoNote').textContent = session ? 'You’re signed in, so both open straight away.' : 'Both open after you sign in.';
    form.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
    $('heroSignOut').disabled = busy;
  };
  const what = { '?demo': 'the demo recording', '?sample': 'the sample study' };
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (session || !link || !/^(app|study)\.html/.test(link.getAttribute('href'))) return;
    event.preventDefault();
    next = appPath(link.href);
    if (!supabase) { status.focus(); return; }
    say(`Sign in or create an account to open ${what[new URL(link.href).search] ?? 'Somnium'}.`);
    email.focus();
  });
  if (!supabase) say('Accounts aren’t configured on this copy of Somnium, so the app can’t open.', true);
  else {
    supabase.auth.onAuthStateChange((_event, s) => { session = s; render(); });
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      const action = event.submitter?.value ?? 'login';
      for (const input of [email, password]) input.removeAttribute('aria-invalid');
      const bad = !email.value.trim() || !email.checkValidity() ? [email, 'Enter your email address.']
        : action !== 'reset' && !password.value ? [password, 'Enter your password.'] : null;
      if (bad) { bad[0].setAttribute('aria-invalid', 'true'); say(bad[1], true); bad[0].focus(); return; }
      busy = true; render(); say('Working…');
      try {
        const outcome = await submitAuth(supabase, action, email.value.trim(), password.value, next);
        password.value = '';
        if (outcome === 'signedIn') { say('Signed in. Opening Somnium…'); location.assign(next); return; }
        say(outcome === 'reset' ? 'If that address has an account, a password reset email is on its way.'
          : 'Check your email and click the link to confirm your account. It opens Somnium, signed in.');
      } catch (error) {
        say(error.message || 'Request failed. Please try again.', true);
        if (/password/i.test(error.message ?? '')) { password.setAttribute('aria-invalid', 'true'); password.focus(); }
      } finally { busy = false; render(); }
    };
    $('heroSignOut').onclick = async () => {
      busy = true; render();
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      busy = false; render();
      say(error ? error.message : 'Signed out.', !!error);
    };
  }
  render();
}

// The landing page is drawn from the real demo recording and the real rule engine.
// No hardware-acceleration gate here (study.js has one): a modal must not be the first thing a visitor sees.
const WIN = 5, Y0 = 30, ROW = 90, VH = 600, BUCKETS = 360;
// Phones get a narrower drawing space (same height), so the chart is taller on screen and labels stay readable.
const narrowQ = matchMedia('(max-width: 600px)');
let VW, X0, W;
const setGeometry = () => { VW = narrowQ.matches ? 520 : 1000; X0 = narrowQ.matches ? 62 : 90; W = VW - X0 - (narrowQ.matches ? 14 : 20); };
setGeometry();
const edf = makeDemo();
const by = edf.signals.map((x, i) => windowMetrics(x, edf.rates[i], WIN));
// Same story as the app's demo: it starts without a 60 Hz rule (a lab on 50 Hz power), and the visitor adds one in step 4.
const START = DEFAULT_CHECKLIST.filter((r) => r.metric !== 'line60');
const TYPED = { id: 'typed', name: '60 Hz hum', metric: 'line60', op: '>', value: 0.15 };
const flags = evaluate(START, by);
const added = evaluate([TYPED], by);
const nWin = by[0].length;
const xOf = (win) => X0 + (win / nWin) * W;
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, text) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text) e.textContent = text;
  return e;
};
const clamp = (v, m) => Math.max(-m, Math.min(m, v));

// merge consecutive flagged windows per channel and rule into marks
const names = { flat: 'flatline', quiet: 'too faint', line50: '50 Hz hum', line60: '60 Hz hum', ptp: 'huge swings', kurtosis: 'spikes' };
const runs = [];
const grouped = new Map();
[...flags, ...added].forEach((f) => { const k = `${f.ch}:${f.rule.metric}`; (grouped.get(k) || grouped.set(k, []).get(k)).push(f.win); });
grouped.forEach((wins, k) => {
  const [ch, metric] = k.split(':'); wins.sort((a, b) => a - b);
  let s = wins[0], p = wins[0];
  const push = () => runs.push({ ch: +ch, metric, s, e: p, added: metric === TYPED.metric });
  for (const w of wins.slice(1)) { if (w - p > 1) { push(); s = w; } p = w; }
  push();
});

// trace paths depend only on the geometry; every figure reuses them
const tracePaths = () => edf.signals.map((sig, ch) => {
  const cy = Y0 + ch * ROW + ROW / 2, per = Math.floor(sig.length / BUCKETS);
  let d = '';
  for (let b = 0; b < BUCKETS; b++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = b * per; i < (b + 1) * per; i++) { if (sig[i] < lo) lo = sig[i]; if (sig[i] > hi) hi = sig[i]; }
    const x = X0 + (b / BUCKETS) * W, x2 = x + W / BUCKETS / 2;
    d += `${b ? 'L' : 'M'}${x.toFixed(1)} ${(cy - clamp(hi * 0.6, 40)).toFixed(1)}L${x2.toFixed(1)} ${(cy - clamp(lo * 0.6, 40)).toFixed(1)}`;
  }
  return d;
});

function build(svg, paths) {
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
  svg.style.setProperty('--scan', `${W - 4}px`);
  edf.labels.forEach((label, ch) => {
    const cy = Y0 + ch * ROW + ROW / 2;
    svg.append(el('text', { class: 'lab', x: 14, y: cy + 5 }, label));
    const trace = el('path', { class: 'trace', d: paths[ch] });
    svg.append(trace);
    const q = el('text', { class: 'q', x: VW - 30, y: cy + 11, 'text-anchor': 'middle' }, '?');
    q.style.setProperty('--r', ch);
    svg.append(q);
  });
  // One tag per stretch: when marks on a channel overlap (a flatline also trips "spikes"), the longer mark keeps the label.
  const charW = narrowQ.matches ? 12 : 9.6, placed = [];
  [...runs].sort((a, b) => (b.e - b.s) - (a.e - a.s)).forEach((r) => {
    const y = Y0 + r.ch * ROW, x0 = xOf(r.s), x1 = x0 + 12 + names[r.metric].length * charW;
    const band = el('rect', { class: 'band', x: x0, y: y + 4, width: xOf(r.e + 1) - x0, height: ROW - 8, rx: 3 });
    const d = `${(((x0 - X0) / W) * 2.4 + 0.5).toFixed(2)}s`; // lights up as the scan line passes
    band.style.setProperty('--d', d);
    if (r.added) band.classList.add('added');
    if (r.metric === 'flat' && r.ch === 2) band.classList.add('focus');
    svg.prepend(band);
    if (placed.some((p) => p.ch === r.ch && x0 < p.x1 && p.x0 < x1)) return;
    placed.push({ ch: r.ch, x0, x1 });
    const tag = el('text', { class: 'btag', x: x0 + 6, y: y + (narrowQ.matches ? 24 : 18) }, names[r.metric]);
    tag.style.setProperty('--d', d);
    if (r.added) tag.classList.add('added');
    svg.append(tag);
  });
  svg.append(el('rect', { class: 'scan', x: X0, y: Y0 - 6, width: 3, height: ROW * 6 + 12 }));
  svg.append(el('rect', { class: 'pick', x: xOf(PICK.s), y: Y0 + PICK.ch * ROW + 2, width: xOf(PICK.e + 1) - xOf(PICK.s), height: ROW - 4, rx: 3 }));
}
// The "Show it" drag: O1 3:20-3:55. The suggestion text is whatever the real proposeRule returns for that drag.
const PICK = { ch: 4, s: 40, e: 46 };
const drawAll = () => {
  const paths = tracePaths();
  document.querySelectorAll('.chart').forEach((svg) => build(svg, paths));
  document.querySelectorAll('.trace').forEach((t) => t.style.setProperty('--len', t.getTotalLength()));
};
drawAll();
narrowQ.addEventListener('change', () => { setGeometry(); drawAll(); });

const cells = [];
for (let win = PICK.s; win <= PICK.e; win++) cells.push({ ch: PICK.ch, win });
const learned = proposeRule(by, cells);
const shortName = { flat: 'flatline', quiet: 'too faint', ptp: 'big swings', kurtosis: 'spikiness', line50: '50 Hz hum', line60: '60 Hz hum' };
const showIt = document.getElementById('showIt');
if (learned) {
  const num = learned.metric === 'ptp' ? `${Math.round(learned.value)} µV` : learned.metric === 'kurtosis' ? Math.round(learned.value) : `${Math.round(learned.value * 100)}%`;
  showIt.lastElementChild.textContent = `${shortName[learned.metric]} above about ${num}`;
}

// callout text comes from the real explain() for the C3 flatline
const focusRun = runs.find((r) => r.metric === 'flat' && r.ch === 2);
const hit = flags.find((f) => f.ch === 2 && f.rule.metric === 'flat' && f.win === focusRun.s + 3);
const callout = document.getElementById('callout');
const [h0, ...r0] = explain(hit, edf.labels, WIN).split(': ');
const calloutHead = h0 + ': ', calloutRest = r0.join(': ');
callout.replaceChildren(Object.assign(document.createElement('b'), { textContent: calloutHead }), document.createTextNode(calloutRest));
callout.style.top = `${((Y0 + 4 * ROW + 4) / 600) * 100}%`;

const v = verdict([...flags, ...added], by);
const st = document.getElementById('stamp');
st.querySelector('strong').textContent = `Recording is ${v.label}`;
const pct = st.querySelector('span');
const pctText = () => `${(v.bad * 100).toFixed(0)}% of channel-windows flagged by ${START.length + 1} rules`;
pct.textContent = pctText();

// ---- scroll story
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const steps = [...document.querySelectorAll('.step')];
steps.forEach((s) => {
  const h = s.querySelector('h2');
  h.innerHTML = h.textContent.split(' ').map((w, i) => `<span class="w" style="--i:${i}">${w}&nbsp;</span>`).join('');
});
const typeInto = (node, text, ms = 22, delay = 0) => {
  node.textContent = '';
  if (still) return void (node.textContent = text);
  [...text].forEach((c, i) => setTimeout(() => (node.textContent += c), delay + i * ms));
};
const enter = {
  3: () => { callout.firstChild.textContent = ''; callout.lastChild.textContent = ''; setTimeout(() => (callout.firstChild.textContent = calloutHead), 600); typeInto(callout.lastChild, calloutRest, 14, 800); },
  4: () => typeInto(document.getElementById('sayText'), '“flag 60 Hz hum above 15%”', 38, 800),
  5: () => {
    if (still) return;
    const t0 = performance.now() + 800;
    const tick = (now) => {
      const k = Math.max(0, Math.min(1, (now - t0) / 900));
      pct.textContent = `${(v.bad * 100 * k).toFixed(0)}% of channel-windows flagged by ${START.length + 1} rules`;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => (pct.textContent = pctText()), 2000); // final number even if frames are throttled
  },
};

// text reveals as the step enters; each figure starts its own animation when it is on screen
const once = (nodes, opts, fn) => {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { fn(e.target); io.unobserve(e.target); } }), opts);
  nodes.forEach((n) => io.observe(n));
};
once(steps, { threshold: 0.25 }, (s) => s.classList.add('seen'));
once([...document.querySelectorAll('.stage')], { threshold: 0.5 }, (s) => {
  s.classList.add('in');
  enter[s.dataset.step]?.();
});

// progress bar
const bar = document.getElementById('progress');
const prog = () => { bar.style.transform = `scaleX(${scrollY / (document.documentElement.scrollHeight - innerHeight || 1)})`; };
addEventListener('scroll', prog, { passive: true }); prog();

stripChart(document.getElementById('heroChart'), { rows: 3, labels: ['F3', 'C3', 'O1'] });
stripChart(document.getElementById('endChart'), { rows: 2, labels: ['F4', 'O2'], speed: 70 });
