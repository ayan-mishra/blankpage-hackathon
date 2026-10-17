// The analysis store: one service that owns previous analyses.
//
// Two tiers, deliberately:
//   local  - IndexedDB, always written, works signed out and offline.
//   cloud  - the account's private `analyses` table, written when signed in.
// The browser copy is the display source; the cloud copy follows the user across
// devices. Only metadata is stored; recordings never leave the tab.
import { buildAnalysis, mergeAnalyses, normalizeAnalysis, toRow, fromRow, MAX_ANALYSES } from './analyses.js';

export const LOCAL_DB = 'somnium';
export const LOCAL_STORE = 'analyses';

// Used in Node tests and as a last resort when IndexedDB is unavailable.
export function memoryBackend(seed = []) {
  let rows = seed.map((r) => ({ ...r }));
  return {
    persistent: false,
    async all() { return rows.map((r) => ({ ...r })); },
    async put(rec) { rows = [...rows.filter((r) => r.id !== rec.id), { ...rec }]; },
    async remove(id) { rows = rows.filter((r) => r.id !== id); },
    async clear() { rows = []; },
  };
}

// IndexedDB backend. One object store keyed by the analysis id.
export function idbBackend(factory = globalThis.indexedDB) {
  if (!factory) return null;
  let db = null;
  let opening = null;
  const open = () => {
    opening ??= new Promise((resolve, reject) => {
      const req = factory.open(LOCAL_DB, 1);
      req.onupgradeneeded = () => {
        const handle = req.result;
        if (!handle.objectStoreNames.contains(LOCAL_STORE)) {
          handle.createObjectStore(LOCAL_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => { opening = null; reject(req.error ?? new Error('Could not open local storage.')); };
      req.onblocked = () => { opening = null; reject(new Error('Local storage is blocked by another tab.')); };
    });
    return opening;
  };
  const run = async (mode, action) => {
    const handle = await open();
    return new Promise((resolve, reject) => {
      const tx = handle.transaction(LOCAL_STORE, mode);
      const store = tx.objectStore(LOCAL_STORE);
      let result;
      try { result = action(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('Local storage request failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local storage request was aborted.'));
    });
  };
  return {
    persistent: true,
    all: () => run('readonly', (store) => {
      const req = store.getAll();
      const out = [];
      req.onsuccess = () => out.push(...(req.result ?? []));
      // Resolve on transaction complete, by which point onserssult has fired.
      return out;
    }),
    put: (rec) => run('readwrite', (store) => { store.put(rec); }),
    remove: (id) => run('readwrite', (store) => { store.delete(id); }),
    clear: () => run('readwrite', (store) => { store.clear(); }),
  };
}

const safe = (fn) => { try { return fn(); } catch { return null; } };

export function createAnalysisService({
  client = null,
  backend = idbBackend() ?? memoryBackend(),
  now = () => new Date(),
} = {}) {
  let session = null;
  let generation = 0;
  let syncing = null;

  const signedIn = () => Boolean(client && session?.user?.id);
  const readLocal = async () => (await backend.all()).map((r) => safe(() => normalizeAnalysis(r))).filter(Boolean);

  async function push(rec) {
    const { error } = await client.from('analyses').insert(toRow(rec));
    // 23505 = this analysis is already in the account (another tab or device).
    // Analyses are immutable, so a duplicate is success, not a failure.
    if (error && error.code !== '23505') throw error;
  }

  // Write the merged list without emptying the store first: a tab closing
  // mid-sync must not lose the browser's only copy of an analysis.
  async function replaceAll(records) {
    const capped = records.slice(0, MAX_ANALYSES);
    const keep = new Set(capped.map((r) => r.id));
    for (const rec of await backend.all()) if (!keep.has(rec.id)) await backend.remove(rec.id);
    for (const rec of capped) await backend.put(rec);
  }

  return {
    get persistent() { return Boolean(backend.persistent); },

    // history.js calls this from the auth listener; bumping the generation makes
    // any in-flight sync from the previous account unable to write.
    setSession(next) { session = next ?? null; generation++; },

    async list() {
      return mergeAnalyses(await readLocal());
    },

    // Explicit save. Local first so the sidebar updates even if the network fails.
    async save(meta) {
      const rec = buildAnalysis(meta, { createdAt: now().toISOString() });
      await backend.put(rec);
      if (!signedIn()) return { record: rec, synced: false, error: null };
      try {
        await push(rec);
        rec.synced = true;
        await backend.put(rec);
        return { record: rec, synced: true, error: null };
      } catch (error) {
        return { record: rec, synced: false, error };
      }
    },

    // Removes locally immediately, then from the account. A cloud failure leaves
    // the local delete in place and reports it.
    async remove(id) {
      await backend.remove(id);
      if (!signedIn()) return { error: null };
      const { error } = await client.from('analyses').delete().eq('local_id', id).select('id');
      return { error: error ?? null };
    },

    // Two-way: pull the account copy, push anything saved while signed out,
    // merge into one newest-first list.
    async sync() {
      if (!signedIn()) return { pushed: 0, pulled: 0, total: (await this.list()).length, error: null };
      if (syncing) return syncing;
      const gen = generation;
      syncing = (async () => {
        try {
          const { data, error } = await client
            .from('analyses')
            .select('local_id,filename,duration_sec,channels,sample_rate,created_at')
            .order('created_at', { ascending: false })
            .limit(MAX_ANALYSES);
          if (error) throw error;
          if (gen !== generation) return { pushed: 0, pulled: 0, total: 0, error: null };

          const remote = (Array.isArray(data) ? data : []).map((r) => safe(() => fromRow(r))).filter(Boolean);
          const remoteIds = new Set(remote.map((r) => r.id));
          const local = await readLocal();
          let pushed = 0;
          for (const rec of local) {
            if (rec.synced || remoteIds.has(rec.id)) continue;
            try { await push(rec); pushed++; remoteIds.add(rec.id); }
            catch { /* keep it local and retry next sync */ }
          }
          if (gen !== generation) return { pushed: 0, pulled: 0, total: 0, error: null };

          const merged = mergeAnalyses(local, remote).map((r) => (remoteIds.has(r.id) ? { ...r, synced: true } : r));
          await replaceAll(merged);
          return { pushed, pulled: remote.length, total: merged.length, error: null };
        } finally {
          syncing = null;
        }
      })();
      return syncing;
    },
  };
}
