// Sidebar: the signed-in user's analyses, newest first, ChatGPT-style.
// Real recordings are saved as soon as they open (app.js calls autoSave); the demo
// is only saved when the user asks. Rows are immutable in Supabase, so "Save rules
// to this analysis" inserts a fresh copy and then deletes the old one.
import { createAnalysisService } from './analysisStore.js';
import { normalizeRules } from './checklists.js';
import { formatDuration, formatRate, formatSaved, formatBytes, UPLOAD_LIMIT_BYTES } from './analyses.js';

const sameRules = (a, b) => {
  try { return JSON.stringify(normalizeRules(a)) === JSON.stringify(normalizeRules(b)); } catch { return false; }
};

export function mountHistory(client, { getRecording, getFile, getChecklist, onOpen, onNew }) {
  const $ = (id) => document.getElementById(id);
  const listEl = $('historyList');
  const listStatus = $('historyStatus');
  const emptyEl = $('historyEmpty');
  const saveBtn = $('saveAnalysis');
  const rulesBtn = $('saveRules');
  const keepBox = $('keepRecording');
  const sidebar = $('sidebar');
  const toggle = $('sideToggle');
  const service = createAnalysisService({ client });

  let session = null;
  let busy = 0;
  let active = null; // the saved analysis shown in the main pane, if any
  let view = 0;      // bumps whenever the main pane changes, so a late save can't mark the wrong pane

  $('recordingLimit').textContent = `Recordings up to ${formatBytes(UPLOAD_LIMIT_BYTES)} are kept; larger files keep their details only.`;

  const setListStatus = (message, error = false) => {
    listStatus.textContent = message;
    listStatus.classList.toggle('error', error);
  };
  const setStatus = (message, error = false) => {
    $('analysisStatus').textContent = message;
    $('analysisStatus').classList.toggle('error', error);
  };
  function sync() {
    const open = !!getRecording();
    saveBtn.hidden = !!busy || !open || !!active;
    rulesBtn.hidden = !!busy || !open || !active || sameRules(active.checklist, getChecklist());
    $('syncAnalyses').disabled = !!busy || !session;
    keepBox.disabled = !!busy;
    listEl.querySelectorAll('button').forEach((b) => { b.disabled = !!busy; });
    listEl.querySelectorAll('li').forEach((li) => {
      const on = li.dataset.id === active?.id;
      li.classList.toggle('active', on);
      li.querySelector('.history-open').toggleAttribute('aria-current', on);
    });
  }
  const work = async (fn) => { busy++; sync(); try { return await fn(); } finally { busy--; sync(); } };

  // Phone layout: the sidebar is a drawer under the top bar.
  const setDrawer = (open) => { sidebar.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', () => setDrawer(!sidebar.classList.contains('open')));

  function renderItem(rec) {
    const li = document.createElement('li');
    li.dataset.id = rec.id;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'history-open';
    const name = Object.assign(document.createElement('b'), { className: 'history-name', textContent: rec.filename, title: rec.filename });
    const kept = rec.storagePath || rec.sizeBytes ? '' : ' · details only';
    const meta = Object.assign(document.createElement('span'), {
      className: 'hint',
      textContent: `${formatDuration(rec.durationSec)} · ${rec.channels} ch · ${formatSaved(rec.createdAt)}${kept}`,
    });
    meta.title = `${rec.channels} channels · ${formatRate(rec.sampleRate)}`;
    open.append(name, meta);
    open.addEventListener('click', () => openAnalysis(rec));

    const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost history-remove', textContent: '×' });
    remove.setAttribute('aria-label', `Remove analysis ${rec.filename}`);
    remove.title = 'Remove';
    remove.addEventListener('click', () => removeAnalysis(rec));
    li.append(open, remove);
    return li;
  }

  async function render() {
    let items = [];
    try { items = await service.list(); }
    catch { setListStatus('Could not read your saved analyses.', true); return; }
    listEl.replaceChildren(...items.map(renderItem));
    listEl.hidden = !items.length;
    emptyEl.hidden = !!items.length;
    sync();
  }

  function setActive(rec) { active = rec; view++; setStatus(''); sync(); }

  async function openAnalysis(rec) {
    if (busy) return;
    setDrawer(false);
    await work(async () => {
      setStatus(`Opening “${rec.filename}”…`);
      try {
        const { blob } = await service.open(rec.id);
        if (!blob) { setStatus('This analysis was saved without its recording, so it can’t be reopened.', true); return; }
        onOpen(rec, await blob.arrayBuffer());
        setActive(rec);
      } catch (err) {
        setStatus(err?.message || 'Could not open this analysis.', true);
      }
    });
  }

  async function removeAnalysis(rec) {
    if (busy) return;
    if (!confirm(`Delete the saved analysis of “${rec.filename}” and its stored recording?`)) return;
    await work(async () => {
      const { error } = await service.remove(rec.id);
      if (active?.id === rec.id) active = null;
      await render();
      if (error) setListStatus('Removed here, but the account copy could not be deleted. Try Sync.', true);
    });
  }

  // Save what's in the main pane. With `replace`, the new copy supersedes that entry.
  async function save(replace = null) {
    const meta = getRecording();
    if (!meta) return;
    const mine = view;
    await work(async () => {
      setStatus(replace ? 'Saving rules…' : 'Saving…');
      try {
        const res = await service.save({ meta, file: getFile?.() ?? null, checklist: getChecklist?.() ?? [], keep: keepBox.checked });
        if (replace) {
          const { error } = await service.remove(replace.id);
          if (error) setListStatus('The old copy could not be removed from your account. Try Sync.', true);
        }
        if (mine === view) active = res.record;
        await render();
        if (mine !== view) return;
        if (res.tooBig) setStatus(`Saved without the recording: it’s larger than ${formatBytes(UPLOAD_LIMIT_BYTES)}.`, true);
        else if (res.error) setStatus('Saved in this browser. It will sync to your account next time.', true);
        else if (res.storageError) setStatus('Saved, but the recording could not be stored.', true);
        else setStatus(replace ? 'Rules saved to this analysis.' : 'Saved to your analyses.');
      } catch (err) {
        if (mine === view) setStatus(err?.message || 'Could not save this analysis.', true);
      }
    });
  }

  saveBtn.addEventListener('click', () => save());
  rulesBtn.addEventListener('click', () => active && save(active));
  $('newAnalysis').addEventListener('click', () => { setDrawer(false); setActive(null); onNew(); });

  async function runSync() {
    if (!session) return;
    await work(async () => {
      try {
        const result = await service.sync();
        await render();
        setListStatus(result.error ? 'Could not sync. Your analyses stay in this browser.' : '', !!result.error);
      } catch {
        setListStatus('Could not sync. Your analyses stay in this browser.', true);
      }
    });
  }
  $('syncAnalyses').addEventListener('click', runSync);

  if (client) {
    client.auth.onAuthStateChange((event, next) => {
      const changed = session?.user?.id !== next?.user?.id;
      session = next;
      service.setSession(next);
      if (changed) active = null;
      if (changed || event === 'INITIAL_SESSION') {
        // Database work runs outside the auth callback so token refresh can finish.
        setTimeout(() => { if (changed && next) runSync(); else render(); }, 0);
      }
      sync();
    });
  }

  render();
  return {
    refresh: sync,
    setActive,
    // A real recording was just opened: it becomes a new entry in the list.
    autoSave() { setActive(null); return save(); },
  };
}
