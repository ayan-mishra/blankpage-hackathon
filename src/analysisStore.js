// The analysis store: one service that owns previous analyses and their recordings.
//
// Three tiers:
//   local metadata  - IndexedDB, always written, works signed out and offline.
//   local recording - IndexedDB blob, so a saved analysis can be reopened offline.
//   cloud           - the account's private `analyses` row + a private Storage object.
// The browser copy is the display source; the cloud copy follows the user across
// devices. A recording is only uploaded when it fits the project's plan limit.
import {
  buildAnalysis, mergeAnalyses, normalizeAnalysis, toRow, fromRow,
  MAX_ANALYSES, UPLOAD_LIMIT_BYTES,
} from './analyses.js';

export const LOCAL_DB = 'somnium';
export const ANALYSES_STORE = 'analyses';
export const RECORDINGS_STORE = 'recordings';
export const DB_VERSION = 2;
export const BUCKET = 'recordings';

// Used in Node tests and as a last resort when IndexedDB is unavailable.
export function memoryBackend(seed = [], files = new Map()) {
  let rows = seed.map((r) => ({ ...r }));
  const blobs = new Map(files);
  return {
    persistent: false,
    async all() { return rows.map((r) => ({ ...r })); },
    async put(rec) { rows = [...rows.filter((r) => r.id !== rec.id), { ...rec }]; },
    async remove(id) { rows = rows.filter((r) => r.id !== id); blobs.delete(id); },
    async clear() { rows = []; blobs.clear(); },
    async putRecording(id, blob) { blobs.set(id, blob); },
    async getRecording(id) { return blobs.get(id) ?? null; },
    async removeRecording(id) { blobs.delete(id); },
  };
}

// IndexedDB backend: `analyses` keyed by id, `recordings` keyed by the same id.
export function idbBackend(factory = globalThis.indexedDB) {
  if (!factory) return null;
  let db = null;
  let opening = null;
  const open = () => {
    opening ??= new Promise((resolve, reject) => {
      const req = factory.open(LOCAL_DB, DB_VERSION);
      req.onupgradeneeded = () => {
        const handle = req.result;
        if (!handle.objectStoreNames.contains(ANALYSES_STORE)) {
          handle.createObjectStore(ANALYSES_STORE, { keyPath: 'id' });
        }
        if (!handle.objectStoreNames.contains(RECORDINGS_STORE)) {
          handle.createObjectStore(RECORDINGS_STORE);
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => { opening = null; reject(req.error ?? new Error('Could not open local storage.')); };
      req.onblocked = () => { opening = null; reject(new Error('Local storage is blocked by another tab.')); };
    });
    return opening;
  };
  // Resolves with whatever `action` returned once the transaction commits.
  const run = async (storeName, mode, action) => {
    const handle = await open();
    return new Promise((resolve, reject) => {
      const tx = handle.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = action(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('Local storage request failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local storage request was aborted.'));
    });
  };
  const collect = (store) => {
    const out = [];
    const req = store.getAll();
    req.onsuccess = () => out.push(...(req.result ?? []));
    return out;
  };
  const boxed = (store, key, pick) => {
    const box = { value: null };
    const req = store.get(key);
    req.onsuccess = () => { box.value = pick(req.result); };
    return box;
  };
  return {
    persistent: true,
    all: () => run(ANALYSES_STORE, 'readonly', collect),
    put: (rec) => run(ANALYSES_STORE, 'readwrite', (store) => { store.put(rec); }),
    remove: (id) => run(ANALYSES_STORE, 'readwrite', (store) => { store.delete(id); }),
    clear: () => run(ANALYSES_STORE, 'readwrite', (store) => { store.clear(); }),
    putRecording: (id, blob) => run(RECORDINGS_STORE, 'readwrite', (store) => { store.put(blob, id); }),
    getRecording: (id) => run(RECORDINGS_STORE, 'readonly', (store) => boxed(store, id, (v) => v ?? null))
      .then((box) => box.value),
    removeRecording: (id) => run(RECORDINGS_STORE, 'readwrite', (store) => { store.delete(id); }),
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

  const userId = () => session?.user?.id ?? null;
  const signedIn = () => Boolean(client && userId());

  // A browser can be shared. Anonymous analyses belong to whoever claims them;
  // another account's rows are never shown and never uploaded.
  const visible = (rec, uid) => rec.owner == null || rec.owner === uid;

  async function readLocal() {
    return (await backend.all()).map((r) => safe(() => normalizeAnalysis(r))).filter(Boolean);
  }

  async function push(rec) {
    const { error } = await client.from('analyses').insert(toRow(rec));
    // 23505 = already in the account (another tab or device). Rows are immutable,
    // so a duplicate is success, not a failure.
    if (error && error.code !== '23505') throw error;
  }

  // Merge into the local store without emptying it first: a tab closing mid-sync
  // must not lose the browser's only copy. Only rows this account owns are pruned.
  async function writeScope(records, uid) {
    const keep = new Set(records.map((r) => r.id));
    for (const rec of await backend.all()) {
      if (!keep.has(rec.id) && (rec.owner == null || rec.owner === uid)) await backend.remove(rec.id);
    }
    for (const rec of records.slice(0, MAX_ANALYSES)) await backend.put(rec);
  }

  return {
    get persistent() { return Boolean(backend.persistent); },
    get uploadLimit() { return UPLOAD_LIMIT_BYTES; },

    // history.js calls this from the auth listener; bumping the generation makes
    // any in-flight sync from the previous account unable to write.
    setSession(next) { session = next ?? null; generation++; },

    async list() {
      const uid = userId();
      return mergeAnalyses((await readLocal()).filter((r) => visible(r, uid)), []);
    },

    // Explicit save. Metadata is written first so the sidebar updates even if the
    // network fails; the recording is stored only when it fits the plan limit.
    async save({ meta, file = null, checklist = [], keep = true }) {
      const uid = userId();
      const rec = buildAnalysis(meta, { checklist, owner: uid });
      await backend.put(rec);

      let storageError = null;
      let tooBig = false;
      if (keep && file) {
        if (file.size > UPLOAD_LIMIT_BYTES) {
          tooBig = true;
        } else {
          rec.sizeBytes = file.size;
          try { await backend.putRecording(rec.id, file); } catch { /* no local cache; cloud may still work */ }
          if (signedIn()) {
            const path = `${uid}/${rec.id}.edf`;
            try {
              const { error } = await client.storage.from(BUCKET).upload(path, file, {
                contentType: 'application/octet-stream',
                upsert: false,
              });
              if (error) throw error;
              rec.storagePath = path;
            } catch (error) {
              storageError = error;
            }
          }
          await backend.put(rec);
        }
      }

      if (!signedIn()) {
        return { record: rec, synced: false, storageError, tooBig, error: null };
      }
      try {
        await push(rec);
        rec.synced = true;
        await backend.put(rec);
        return { record: rec, synced: true, storageError, tooBig, error: null };
      } catch (error) {
        return { record: rec, synced: false, storageError, tooBig, error };
      }
    },

    // Returns the stored recording when there is one, from this browser first and
    // then from the account.
    async open(id) {
      const uid = userId();
      const rec = (await readLocal()).find((r) => r.id === id && visible(r, uid));
      if (!rec) throw new Error('That analysis is not available in this account.');
      let blob = null;
      try { blob = await backend.getRecording(id); } catch { blob = null; }
      if (!blob && rec.storagePath && signedIn()) {
        const { data, error } = await client.storage.from(BUCKET).download(rec.storagePath);
        if (error) throw error;
        blob = data;
        try { await backend.putRecording(id, blob); } catch { /* cache is best-effort */ }
      }
      return { record: rec, blob };
    },

    // Removes locally immediately, then the account row and stored object.
    async remove(id) {
      const uid = userId();
      const rec = (await readLocal()).find((r) => r.id === id);
      if (!rec || !visible(rec, uid)) return { error: null };
      await backend.remove(id);
      if (signedIn()) {
        if (rec.storagePath) {
          const { error } = await client.storage.from(BUCKET).remove([rec.storagePath]);
          if (error) return { error };
        }
        const { error } = await client.from('analyses').delete().eq('local_id', id).select('id');
        if (error) return { error };
      }
      return { error: null };
    },

    // Two-way: pull the account copy, claim anything saved while signed out,
    // merge into one newest-first list.
    async sync() {
      const uid = userId();
      if (!signedIn()) return { pushed: 0, pulled: 0, total: (await this.list()).length, error: null };
      if (syncing) return syncing;
      const gen = generation;
      syncing = (async () => {
        try {
          const { data, error } = await client
            .from('analyses')
            .select('local_id,filename,duration_sec,channels,sample_rate,created_at,checklist,size_bytes,storage_path')
            .order('created_at', { ascending: false })
            .limit(MAX_ANALYSES);
          if (error) throw error;
          if (gen !== generation) return { pushed: 0, pulled: 0, total: 0, error: null };

          const remote = (Array.isArray(data) ? data : [])
            .map((r) => safe(() => ({ ...fromRow(r), owner: uid })))
            .filter(Boolean);
          const remoteIds = new Set(remote.map((r) => r.id));

          const local = await readLocal();
          const mine = local.filter((r) => visible(r, uid));
          let pushed = 0;
          for (const rec of mine) {
            if (rec.synced || remoteIds.has(rec.id)) continue;
            const claimed = { ...rec, owner: uid };
            try {
              await push(claimed);
              pushed++;
              remoteIds.add(rec.id);
            } catch { /* keep it local and retry next sync */ }
          }
          if (gen !== generation) return { pushed: 0, pulled: 0, total: 0, error: null };

          const merged = mergeAnalyses(mine.map((r) => ({ ...r, owner: uid })), remote)
            .map((r) => (remoteIds.has(r.id) ? { ...r, synced: true, owner: uid } : { ...r, owner: uid }));
          await writeScope(merged, uid);
          return { pushed, pulled: remote.length, total: merged.length, error: null };
        } finally {
          syncing = null;
        }
      })();
      return syncing;
    },
  };
}
