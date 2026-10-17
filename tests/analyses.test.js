import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalysis, normalizeAnalysis, mergeAnalyses, toRow, fromRow,
  formatDuration, formatRate, formatSaved, formatBytes, analysisFilename,
  UPLOAD_LIMIT_BYTES, MAX_RECORDING_BYTES,
} from '../src/analyses.js';
import { createAnalysisService, memoryBackend } from '../src/analysisStore.js';
import { DEFAULT_CHECKLIST } from '../src/rules.js';

const meta = { filename: 'night-1.edf', durationSec: 300, channels: 6, sampleRate: 128 };
const uid = '00000000-0000-4000-8000-000000000001';

function fakeStorage(initial = new Map()) {
  const objects = new Map(initial);
  const calls = [];
  return {
    objects, calls,
    from(bucket) {
      return {
        async upload(path, file) {
          calls.push(['upload', bucket, path, file.size]);
          if (objects.has(path)) return { data: null, error: { message: 'already exists' } };
          objects.set(path, file);
          return { data: { path }, error: null };
        },
        async download(path) {
          calls.push(['download', bucket, path]);
          const f = objects.get(path);
          return f ? { data: f, error: null } : { data: null, error: { message: 'not found' } };
        },
        async remove(paths) {
          calls.push(['remove', bucket, paths]);
          for (const p of paths) objects.delete(p);
          return { data: [], error: null };
        },
      };
    },
  };
}

// Minimal stand-in for the Supabase query builder the service uses.
function fakeClient(initial = []) {
  const rows = initial.map((r) => ({ ...r }));
  const storage = fakeStorage();
  let mode = 'select', payload = null, filters = [];
  const finish = () => {
    if (mode === 'insert') {
      if (rows.some((r) => r.local_id === payload.local_id)) return Promise.resolve({ error: { code: '23505' } });
      rows.push({ ...payload });
      return Promise.resolve({ error: null });
    }
    if (mode === 'delete') {
      for (const [col, val] of filters) {
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i][col] === val) rows.splice(i, 1);
      }
      return Promise.resolve({ data: [{ id: 'gone' }], error: null });
    }
    return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
  };
  const api = {
    insert(p) { mode = 'insert'; payload = p; return api; },
    delete() { mode = 'delete'; return api; },
    select() { return api; },
    order() { return api; },
    limit() { return finish(); },
    eq(col, val) { filters.push([col, val]); return api; },
    then(res, rej) { return finish().then(res, rej); },
  };
  return {
    rows, storage,
    from() { mode = 'select'; payload = null; filters = []; return api; },
  };
}

const blob = (bytes = 32) => new Blob([new Uint8Array(bytes)]);

test('buildAnalysis keeps metadata, checklist and storage fields', () => {
  const rec = buildAnalysis(
    { ...meta, labels: ['F3'], signals: [1, 2, 3] },
    { id: 'a1', createdAt: '2026-10-17T10:00:00.000Z', checklist: DEFAULT_CHECKLIST, owner: uid },
  );
  assert.deepEqual(Object.keys(rec).sort(), [
    'channels', 'checklist', 'createdAt', 'durationSec', 'filename', 'id',
    'owner', 'sampleRate', 'sizeBytes', 'storagePath', 'synced',
  ]);
  assert.equal(rec.checklist.length, DEFAULT_CHECKLIST.length);
  assert.equal(rec.sizeBytes, null);
  assert.equal(rec.storagePath, null);
  assert.equal(rec.owner, uid);
});

test('normalizeAnalysis rejects impossible recordings and bad storage data', () => {
  const good = { id: 'a1', filename: 'x.edf', durationSec: 10, channels: 2, sampleRate: 256, createdAt: '2026-10-17T10:00:00Z' };
  for (const bad of [
    null, 'nope', {},
    { ...good, id: '' }, { ...good, filename: '   ' }, { ...good, filename: 'x'.repeat(201) },
    { ...good, durationSec: 0 }, { ...good, durationSec: 86401 },
    { ...good, channels: 0 }, { ...good, channels: 1.5 },
    { ...good, sampleRate: 0 },
    { ...good, createdAt: 'not a date' },
    { ...good, sizeBytes: 0 }, { ...good, sizeBytes: 1.5 }, { ...good, sizeBytes: MAX_RECORDING_BYTES + 1 },
    { ...good, storagePath: '' }, { ...good, storagePath: '/abs/path' }, { ...good, storagePath: 'a/../b' },
    { ...good, storagePath: 'x'.repeat(401) },
    { ...good, checklist: [{ metric: 'nope', op: '>', value: 1 }] },
  ]) {
    assert.throws(() => normalizeAnalysis(bad), /valid Somnium analysis|valid Somnium checklist|invalid|Enter a recording name/);
  }
});

test('analysisFilename trims and enforces the length cap', () => {
  assert.equal(analysisFilename('  night 1.edf  '), 'night 1.edf');
  assert.throws(() => analysisFilename(''), /1–200/);
  assert.throws(() => analysisFilename('a'.repeat(201)), /1–200/);
});

test('mergeAnalyses dedupes by id, newest first, and trusts the cloud copy', () => {
  const local = [
    buildAnalysis(meta, { id: 'a', createdAt: '2026-10-15T10:00:00.000Z' }),
    buildAnalysis(meta, { id: 'b', createdAt: '2026-10-17T10:00:00.000Z' }),
    { id: 'broken', filename: '' },
  ];
  const cloud = [fromRow({
    local_id: 'a', filename: 'night-1.edf', duration_sec: '300', channels: '6',
    sample_rate: '128', created_at: '2026-10-16T10:00:00.000Z',
    checklist: DEFAULT_CHECKLIST, size_bytes: 4096, storage_path: `${uid}/a.edf`,
  })];
  const merged = mergeAnalyses(local, cloud);
  assert.deepEqual(merged.map((r) => r.id), ['b', 'a']);
  const a = merged.find((r) => r.id === 'a');
  assert.equal(a.createdAt, '2026-10-16T10:00:00.000Z');
  assert.equal(a.synced, true);
  assert.equal(a.sizeBytes, 4096);
  assert.equal(a.storagePath, `${uid}/a.edf`);
  assert.equal(a.checklist.length, DEFAULT_CHECKLIST.length);
  assert.equal(merged.find((r) => r.id === 'b').synced, false);
});

test('toRow and fromRow round-trip the database column names', () => {
  const rec = buildAnalysis(meta, {
    id: 'a1', createdAt: '2026-10-17T10:00:00.000Z', synced: true,
    checklist: DEFAULT_CHECKLIST, sizeBytes: 2048, storagePath: `${uid}/a1.edf`,
  });
  const row = toRow(rec);
  assert.deepEqual(Object.keys(row).sort(), [
    'channels', 'checklist', 'created_at', 'duration_sec', 'filename',
    'local_id', 'sample_rate', 'size_bytes', 'storage_path',
  ]);
  assert.deepEqual(fromRow(row), rec);
});

test('formatting helpers stay readable', () => {
  assert.equal(formatDuration(300), '5m 00s');
  assert.equal(formatDuration(3725), '1h 02m');
  assert.equal(formatRate(256.5), '256.5 Hz');
  assert.equal(formatBytes(UPLOAD_LIMIT_BYTES), '50 MB');
  assert.equal(formatBytes(462592), '452 KB');
  assert.equal(formatBytes(1536), '2 KB');
  assert.equal(formatBytes(0), '0 KB');
  const now = Date.parse('2026-10-17T12:00:00Z');
  assert.equal(formatSaved('2026-10-17T11:59:40Z', now), 'just now');
  assert.equal(formatSaved('2026-10-15T12:00:00Z', now), '2 d ago');
});

test('saving stores the recording locally so it can be reopened offline', async () => {
  const service = createAnalysisService({ client: null, backend: memoryBackend() });
  const file = blob(64);
  const saved = await service.save({ meta, file, checklist: DEFAULT_CHECKLIST, keep: true });
  assert.equal(saved.error, null);
  assert.equal(saved.record.sizeBytes, file.size);
  assert.equal(saved.record.owner, null);
  assert.equal((await service.list()).length, 1);

  const { record, blob: stored } = await service.open(saved.record.id);
  assert.equal(record.filename, 'night-1.edf');
  assert.equal(stored.size, 64);
  assert.equal(record.checklist.length, DEFAULT_CHECKLIST.length);
});

test('signed-in save uploads the recording and records its path', async () => {
  const client = fakeClient();
  const service = createAnalysisService({ client, backend: memoryBackend() });
  service.setSession({ user: { id: uid } });
  const saved = await service.save({ meta, file: blob(128), checklist: DEFAULT_CHECKLIST });
  assert.equal(saved.synced, true);
  assert.equal(saved.record.owner, uid);
  assert.equal(saved.record.storagePath, `${uid}/${saved.record.id}.edf`);
  assert.equal(client.storage.objects.size, 1);
  assert.equal(client.rows.length, 1);
  assert.equal(client.rows[0].storage_path, `${uid}/${saved.record.id}.edf`);
  assert.equal(client.rows[0].size_bytes, 128);
  assert.equal(client.rows[0].checklist.length, DEFAULT_CHECKLIST.length);
});

test('a recording over the plan limit is skipped but the details are saved', async () => {
  const client = fakeClient();
  const service = createAnalysisService({ client, backend: memoryBackend() });
  service.setSession({ user: { id: uid } });
  const tooBig = { size: UPLOAD_LIMIT_BYTES + 1 };
  const saved = await service.save({ meta, file: tooBig, checklist: [] });
  assert.equal(saved.tooBig, true);
  assert.equal(saved.record.storagePath, null);
  assert.equal(saved.record.sizeBytes, null);
  assert.equal(client.storage.objects.size, 0);
  assert.equal(client.rows.length, 1, 'the row still syncs');
  assert.equal((await service.list()).length, 1);
});

test('opening falls back to the account when this browser has no cached file', async () => {
  const client = fakeClient();
  const service = createAnalysisService({ client, backend: memoryBackend() });
  service.setSession({ user: { id: uid } });
  const saved = await service.save({ meta, file: blob(16) });
  // Simulate a second device: same row, no local blob.
  const fresh = createAnalysisService({ client, backend: memoryBackend([saved.record]) });
  fresh.setSession({ user: { id: uid } });
  const { blob: downloaded } = await fresh.open(saved.record.id);
  assert.equal(downloaded.size, 16);
  assert.ok(client.storage.calls.some(([op, , path]) => op === 'download' && path === saved.record.storagePath));
});

test('another account in the same browser never sees or uploads these analyses', async () => {
  const client = fakeClient();
  const backend = memoryBackend([
    buildAnalysis(meta, { id: 'mine', owner: uid, createdAt: '2026-10-17T10:00:00.000Z' }),
  ]);
  const service = createAnalysisService({ client, backend });
  service.setSession({ user: { id: '00000000-0000-4000-8000-000000000002' } });
  assert.equal((await service.list()).length, 0);
  await service.sync();
  assert.equal(client.rows.length, 0, 'the other account\'s row is not pushed');
});

test('delete removes the analysis locally and from the account', async () => {
  const client = fakeClient();
  const service = createAnalysisService({ client, backend: memoryBackend() });
  service.setSession({ user: { id: uid } });
  const saved = await service.save({ meta, file: blob(16) });
  assert.equal((await service.remove(saved.record.id)).error, null);
  assert.equal((await service.list()).length, 0);
  assert.equal(client.rows.length, 0);
  assert.equal(client.storage.objects.size, 0);
});

test('switching accounts cannot write a stale sync result', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const rows = [{ local_id: 'old', filename: 'old.edf', duration_sec: 10, channels: 1, sample_rate: 100, created_at: '2026-10-01T00:00:00.000Z' }];
  const client = {
    from: () => ({
      select: () => ({ order: () => ({ limit: () => gate.then(() => ({ data: rows, error: null })) }) }),
      insert: () => ({ then: (ok) => ok({ error: null }) }),
      delete: () => ({ eq: () => ({ select: () => ({ then: (ok) => ok({ data: [], error: null }) }) }) }),
    }),
    storage: fakeStorage(),
  };
  const backend = memoryBackend();
  const service = createAnalysisService({ client, backend });
  service.setSession({ user: { id: 'u1' } });
  const pending = service.sync();
  service.setSession({ user: { id: 'u2' } });
  release();
  const result = await pending;
  assert.equal(result.total, 0);
  assert.equal((await backend.all()).length, 0, 'the previous account\'s rows are not written');
});
