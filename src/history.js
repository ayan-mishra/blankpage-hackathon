// Sidebar: previous analyses saved by this browser (and, when signed in, this account).
// Saving is explicit; loading a recording never writes history on its own.
import { createAnalysisService } from './analysisStore.js';
import { formatDuration, formatRate, formatSaved } from './analyses.js';

export function mountHistory(client, { getRecording }) {
  const $ = (id) => document.getElementById(id);
  const root = $('history');
  if (!root) return { refresh() {} };

  const listEl = $('historyList');
  const statusEl = $('historyStatus');
  const saveBtn = $('saveAnalysis');
  const syncBtn = $('syncAnalyses');
  const service = createAnalysisService({ client });

  let session = null;
  let busy = false;

  const setStatus = (message, error = false) => {
    statusEl.textContent = message;
    statusEl.classList.toggle('error', error);
  };
  const setBusy = (next) => {
    busy = next;
    saveBtn.disabled = busy || !getRecording();
    if (syncBtn) syncBtn.disabled = busy || !session;
  };

  function renderItem(rec) {
    const li = document.createElement('li');
    li.className = 'history-item';

    const main = document.createElement('div');
    main.className = 'history-main';
    const name = document.createElement('b');
    name.className = 'history-name';
    name.textContent = rec.filename;
    name.title = rec.filename;
    const meta = document.createElement('span');
    meta.className = 'history-meta';
    meta.textContent = `${rec.channels} ch · ${formatRate(rec.sampleRate)} · ${formatDuration(rec.durationSec)}`;
    const when = document.createElement('span');
    when.className = 'history-when';
    when.textContent = `${formatSaved(rec.createdAt)}${rec.synced ? '' : ' · on this device'}`;
    main.append(name, meta, when);

    const del = Object.assign(document.createElement('button'), {
      className: 'ghost history-del',
      type: 'button',
      textContent: '×',
      title: 'Delete this analysis',
    });
    del.setAttribute('aria-label', `Delete analysis ${rec.filename}`);
    del.onclick = () => removeAnalysis(rec);

    li.append(main, del);
    return li;
  }

  async function render() {
    let items = [];
    try { items = await service.list(); }
    catch { setStatus('Could not read saved analyses in this browser.', true); return; }
    listEl.replaceChildren(...items.map(renderItem));
    listEl.hidden = !items.length;
    $('historyEmpty').hidden = !!items.length;
    if (!items.length && !busy) setStatus(session ? 'No analyses saved yet.' : 'No analyses saved yet. They stay on this device until you sign in.');
    else if (items.length && !busy) setStatus(session ? `${items.length} saved · synced to your account` : `${items.length} saved on this device`);
    setBusy(busy);
  }

  async function removeAnalysis(rec) {
    if (!confirm(`Delete the saved analysis of “${rec.filename}”?`)) return;
    setBusy(true);
    try {
      const { error } = await service.remove(rec.id);
      await render();
      if (error) setStatus('Deleted on this device, but the account copy could not be removed. Try Sync.', true);
    } finally { setBusy(false); }
  }

  saveBtn.onclick = async () => {
    const meta = getRecording();
    if (!meta || busy) return;
    setBusy(true);
    try {
      const { synced, error } = await service.save(meta);
      await render();
      if (error) setStatus('Saved on this device. It will sync next time you sign in.', true);
      else setStatus(synced ? 'Analysis saved to your account.' : 'Analysis saved on this device.');
    } catch (err) {
      setStatus(err?.message || 'Could not save this analysis.', true);
    } finally { setBusy(false); }
  };

  async function runSync() {
    if (!session || busy) return;
    setBusy(true);
    setStatus('Syncing previous analyses…');
    try {
      const result = await service.sync();
      await render();
      if (result.error) setStatus('Could not sync. Saved analyses stay on this device.', true);
      else {
        const moved = result.pushed ? ` · ${result.pushed} uploaded` : '';
        setStatus(`${result.total} saved · synced to your account${moved}`);
      }
    } catch {
      setStatus('Could not sync. Saved analyses stay on this device.', true);
    } finally { setBusy(false); }
  }

  if (syncBtn) syncBtn.onclick = runSync;

  if (client) {
    client.auth.onAuthStateChange((event, next) => {
      const changed = session?.user?.id !== next?.user?.id;
      session = next;
      service.setSession(next);
      if (changed || event === 'INITIAL_SESSION') {
        // Database work runs outside the auth callback so token refresh can finish.
        setTimeout(() => {
          if (changed && next) runSync();
          else { render(); }
        }, 0);
      }
      setBusy(busy);
    });
  }

  render();
  return { refresh: () => setBusy(busy) };
}
