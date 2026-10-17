// Sidebar: previous analyses saved by this browser (and, when signed in, this account).
// Saving is explicit; loading a recording never writes history on its own.
import { createAnalysisService } from './analysisStore.js';
import { formatDuration, formatRate, formatSaved, formatBytes, UPLOAD_LIMIT_BYTES } from './analyses.js';

export function mountHistory(client, { getRecording, getFile, getChecklist, onOpen }) {
  const $ = (id) => document.getElementById(id);
  const root = $('history');
  if (!root) return { refresh() {} };

  const listEl = $('historyList');
  const statusEl = $('historyStatus');
  const emptyEl = $('historyEmpty');
  const saveBtn = $('saveAnalysis');
  const syncBtn = $('syncAnalyses');
  const keepBox = $('keepRecording');
  const limitEl = $('recordingLimit');
  const service = createAnalysisService({ client });

  let session = null;
  let busy = false;

  if (limitEl) limitEl.textContent = `Recordings up to ${formatBytes(UPLOAD_LIMIT_BYTES)} are stored on this project's plan; larger files keep their details only.`;

  const setStatus = (message, error = false) => {
    statusEl.textContent = message;
    statusEl.classList.toggle('error', error);
  };
  const setBusy = (next) => {
    busy = next;
    saveBtn.disabled = busy || !getRecording();
    if (syncBtn) syncBtn.disabled = busy || !session;
    if (keepBox) keepBox.disabled = busy;
    listEl.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
  };

  function renderItem(rec) {
    const li = document.createElement('li');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'history-open';
    const name = document.createElement('b');
    name.className = 'history-name';
    name.textContent = rec.filename;
    name.title = rec.filename;
    const meta = document.createElement('span');
    meta.className = 'hint';
    const kept = rec.storagePath || rec.sizeBytes ? ` · ${formatBytes(rec.sizeBytes ?? 0)} kept` : ' · details only';
    meta.textContent = `${rec.channels} ch · ${formatRate(rec.sampleRate)} · ${formatDuration(rec.durationSec)} · ${formatSaved(rec.createdAt)}${kept}`;
    open.append(name, meta);
    open.addEventListener('click', () => openAnalysis(rec));

    const remove = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'ghost history-remove',
      textContent: 'Remove',
    });
    remove.setAttribute('aria-label', `Remove analysis ${rec.filename}`);
    remove.addEventListener('click', () => removeAnalysis(rec));

    li.append(open, remove);
    return li;
  }

  async function render() {
    let items = [];
    try { items = await service.list(); }
    catch { setStatus('Could not read saved analyses in this browser.', true); return; }
    listEl.replaceChildren(...items.map(renderItem));
    listEl.hidden = !items.length;
    if (emptyEl) emptyEl.hidden = !!items.length;
    if (!items.length) {
      setStatus(session ? 'No analyses saved yet.' : 'No analyses saved yet. They stay on this device until you sign in.');
    } else {
      setStatus(session ? `${items.length} saved · synced to your account` : `${items.length} saved on this device`);
    }
    setBusy(busy);
  }

  async function openAnalysis(rec) {
    if (busy) return;
    setBusy(true);
    setStatus(`Opening “${rec.filename}”…`);
    try {
      const { blob } = await service.open(rec.id);
      if (!blob) {
        setStatus('This analysis was saved without its recording, so only its details remain.', true);
        return;
      }
      const buffer = await blob.arrayBuffer();
      onOpen(rec, buffer);
      setStatus(`Opened “${rec.filename}”.`);
    } catch (err) {
      setStatus(err?.message || 'Could not open this analysis.', true);
    } finally { setBusy(false); }
  }

  async function removeAnalysis(rec) {
    if (busy) return;
    if (!confirm(`Delete the saved analysis of “${rec.filename}” and its stored recording?`)) return;
    setBusy(true);
    try {
      const { error } = await service.remove(rec.id);
      await render();
      if (error) setStatus('Removed on this device, but the account copy could not be deleted. Try Sync.', true);
    } finally { setBusy(false); }
  }

  saveBtn.addEventListener('click', async () => {
    const meta = getRecording();
    if (!meta || busy) return;
    setBusy(true);
    try {
      const { synced, error, storageError, tooBig } = await service.save({
        meta,
        file: getFile?.() ?? null,
        checklist: getChecklist?.() ?? [],
        keep: keepBox ? keepBox.checked : true,
      });
      await render();
      if (tooBig) {
        setStatus(`Details saved. The recording is larger than ${formatBytes(UPLOAD_LIMIT_BYTES)}, so it was not stored.`, true);
      } else if (error) {
        setStatus('Saved on this device. It will sync next time you sign in.', true);
      } else if (storageError) {
        setStatus(synced ? 'Analysis saved. The recording could not be uploaded.' : 'Saved on this device. The recording could not be uploaded.', true);
      } else {
        setStatus(synced ? 'Analysis saved to your account.' : 'Analysis saved on this device.');
      }
    } catch (err) {
      setStatus(err?.message || 'Could not save this analysis.', true);
    } finally { setBusy(false); }
  });

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

  if (syncBtn) syncBtn.addEventListener('click', runSync);

  if (client) {
    client.auth.onAuthStateChange((event, next) => {
      const changed = session?.user?.id !== next?.user?.id;
      session = next;
      service.setSession(next);
      if (changed || event === 'INITIAL_SESSION') {
        // Database work runs outside the auth callback so token refresh can finish.
        setTimeout(() => {
          if (changed && next) runSync();
          else render();
        }, 0);
      }
      setBusy(busy);
    });
  }

  render();
  return { refresh: () => setBusy(busy) };
}
