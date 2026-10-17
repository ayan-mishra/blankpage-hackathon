// A page can't switch hardware acceleration on, so detect software rendering and tell the user how to fix it.
const SOFT = /swiftshader|llvmpipe|softpipe|software|basic render/i;

export function hardwareAccelerated() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) || c.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    const x = gl.getExtension('WEBGL_debug_renderer_info');
    return !(x && SOFT.test(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)));
  } catch { return false; }
}

export function showGate() {
  const css = document.createElement('style');
  css.textContent = `.gate{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:20px;background:rgba(25,26,51,.88)}
.gate div{max-width:34rem;background:#fbf1ef;color:#191a33;border:2px solid #191a33;border-radius:8px;padding:28px;box-shadow:8px 8px 0 #f2a900;font:17px/1.55 'Source Serif 4',Georgia,serif}
.gate h2{margin:0 0 .4em;font:800 28px/1.05 'Bricolage Grotesque',Arial,sans-serif;letter-spacing:-.03em}
.gate li{margin:.25em 0}.gate button{margin-top:1em;font:500 16px 'Bricolage Grotesque',Arial,sans-serif;background:#191a33;color:#fbf1ef;border:0;border-radius:99px;padding:12px 24px;cursor:pointer}`;
  const g = document.createElement('div');
  g.className = 'gate'; g.setAttribute('role', 'dialog'); g.setAttribute('aria-modal', 'true'); g.setAttribute('aria-labelledby', 'gate-h');
  g.innerHTML = `<div><h2 id="gate-h">Turn on hardware acceleration</h2>
<p>Somnium draws live charts and needs your graphics card to keep them smooth. Your browser is using software rendering right now.</p>
<ul><li><b>Chrome / Edge:</b> Settings, System, “Use graphics acceleration when available”, then restart.</li>
<li><b>Firefox:</b> Settings, General, Performance, untick “Use recommended performance settings”, tick “Use hardware acceleration when available”.</li>
<li><b>Safari:</b> it’s always on.</li></ul>
<button type="button">Continue anyway</button></div>`;
  const b = g.querySelector('button');
  b.onclick = () => { g.remove(); css.remove(); };
  document.head.append(css); document.body.append(g); b.focus();
}

if (!hardwareAccelerated()) showGate();
