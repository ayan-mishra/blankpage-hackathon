import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalysis, normalizeAnalysis, mergeAnalyses, toRow, fromRow,
  formatDuration, formatRate, formatSaved, analysisFilename,
} from '../src/analyses.js';
import { createAnalysisService, memoryBackend } from '../src/analysisStore.js';

const meta = { filename: 'night-1.edf', durationSec: 300, channels: 6, sampleRate: 128 };

// Minimal stand-in for the Supabase query builder the service uses.
function fakeClient(initial = []) {
  const rows = initial.map((r) => ({ ...r }));
  const calls = [];
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
    insert(p) { mode = 'insert'; payload = p; calls.push(['insert', p]); return api; },
    delete() { mode = 'delete'; calls.push(['delete']); return api; },
    select() { return api; },
    order() { return api; },
    limit() { return finish(); },
    eq(col, val) { filters.push([col, val]); return api; },
    then(res, rej) { return finish().then(res, rej); },
  };
  return {
    rows, calls,
    from() { mode = 'select'; payload = null; filters = []; return api; },
  };
}

test('buildAnalysis keeps only the metadata fields', () => {
  const rec = buildAnalysis({ ...meta, labels: ['F3'], signals: [1, 2, 3] }, { id: 'a1', createdAt: '2026-10-17T10:00:00.000Z' });
  assert.deepEqual(Object.keys(rec).sort(), ['channels', 'createdAt', 'durationSec', 'filename', 'id', 'sampleRate', 'synced']);
  assert.equal(rec.id, 'a1');
  assert.equal(rec.filename, 'night-1.edf');
  assert.equal(rec.synced, false);
  assert.equal(rec.createdAt, '2026-10-17T10:00:00.000Z');
});

test('normalizeAnalysis rejects impossible recordings', () => {
  const good = { id: 'a1', filename: 'x.edf', durationSec: 10, channels: 2, sampleRate: 256, createdAt: '2026-10-17T10:00:00Z' };
  for (const bad of [
    null, 'nope', {},
    { ...good, id: '' }, { ...good, id: 'i'.repeat(101) },
    { ...good, filename: '   ' }, { ...good, filename: 'x'.repeat(201) },
    { ...good, durationSec: 0 }, { ...good, durationSec: -5 }, { ...good, durationSec: 86401 }, { ...good, durationSec: NaN },
    { ...good, channels: 0 }, { ...good, channels: 1.5 }, { ...good, channels: 1025 },
    { ...good, sampleRate: 0 }, { ...good, sampleRate: 2e6 },
    { ...good, createdAt: 'not a date' },
  ]) {
    assert.throws(() => normalizeAnalysis(bad), /valid Somnium analysis|invalid recording length|invalid channel count|invalid sample rate|invalid date|Enter a recording name/);
  }
});

test('analysisFilename trims and enforces the length cap', () => {
  assert.equal(analysisFilename('  night 1.edf  '), 'night 1.edf');
  assert.throws(() => analysisFilename(''), /1–200/);
  assert.throws(() => analysisFilename('a'.repeat(201)), /1–200/);
  assert.equal(analysisFilename('😀'.repeat(200)).length > 0, true);
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
  })];
  const merged = mergeAnalyses(local, cloud);
  assert.deepEqual(merged.map((r) => r.id), ['b', 'a']);
  assert.equal(merged.find((r) => r.id === 'a').createdAt, '2026-10-16T10:00:00.000Z');
  assert.equal(merged.find((r) => r.id === 'a').synced, true);
  assert.equal(merged.find((r) => r.id === 'b').synced, false);
});

test('toRow and fromRow round-trip the database column names', () => {
  const rec = buildAnalysis(meta, { id: 'a1', createdAt: '2026-10-17T10:00:00.000Z', synced: true });
  const row = toRow(rec);
  assert.deepEqual(Object.keys(row).sort(), ['channels', 'created_at', 'duration_sec', 'filename', 'local_id', 'sample_rate']);
  assert.deepEqual(fromRow(row), rec);
});

test('formatting helpers stay readable', () => {
  assert.equal(formatDuration(300), '5m 00s');
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(3725), '1h 02m');
  assert.equal(formatRate(128), '128 Hz');
  assert.equal(formatRate(256.5), '256.5 Hz');
  const now = Date.parse('2026-10-17T12:00:00Z');
  assert.equal(formatSaved('2026-10-17T11:59:40Z', now), 'just now');
  assert.equal(formatSaved('2026-10-17T11:30:00Z', now), '30 min ago');
  assert.equal(formatSaved('2026-10-17T08:00:00Z', now), '4 h ago');
  assert.equal(formatSaved('2026-10-15T12:00:00Z', now), '2 d ago');
});

test('service saves locally while signed out and syncs on sign-in', async () => {
  const client = fakeClient();
  const service = createAnalysisService({ client, backend: memoryBackend(), now: () => new Date('2026-10-17T12:00:00.000Z') });

  const saved = await service.save(meta);
  assert.equal(saved.synced, false);
  assert.equal(saved.error, null);
  assert.equal((await service.list()).length, 1);
  assert.equal(client.rows.length, 0, 'nothing is pushed while signed out');

  service.setSession({ user: { id: 'u1' } });
  const result = await service.sync();
  assert.equal(result.pushed, 1);
  assert.equal(client.rows.length, 1);
  assert.equal(client.rows[0].local_id, saved.record.id);
  assert.equal(client.rows[0].duration_sec, 300);
  assert.equal((await service.list())[0].synced, true);

  // A second sync must not duplicate the row.
  const again = await service.sync();
  assert.equal(again.pushed, 0);
  assert.equal(client.rows.length, 1);
});

test('service pulls account analyses into the sidebar', async () => {
  const client = fakeClient([
    { local_id: 'cloud-1', filename: 'from-laptop.edf', duration_sec: 600, channels: 4, sample_rate: 200, created_at: '2026-10-16T09:00:00.000Z' },
  ]);
  const backend = memoryBackend();
  const service = createAnalysisService({ client, backend });
  service.setSession({ user: { id: 'u1' } });
  const result = await service.sync();
  assert.equal(result.pulled, 1);
  const list = await service.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].filename, 'from-laptop.edf');
  assert.equal(list[0].channels, 4);
  assert.equal(list[0].synced, true);
  assert.equal((await backend.all()).length, 1, 'the pull is written to the local store');
});

test('a failed push keeps the local analysis and reports the error', async () => {
  const failing = {
    from: () => ({
      insert: () => ({ then: (ok) => ok({ error: { code: '500', message: 'nope' } }) }),
    }),
  };
  const service = createAnalysisService({ client: failing, backend: memoryBackend() });
  service.setSession({ user: { id: 'u1' } });
  const saved = await service.save(meta);
  assert.equal(saved.synced, false);
  assert.equal(saved.error.message, 'nope');
  assert.equal((await service.list()).length, 1);
});

test('delete removes the analysis locally and from the account', async () => {
  const client = fakeClient([
    { local_id: 'a1', filename: 'x.edf', duration_sec: 10, channels: 2, sample_rate: 128, created_at: '2026-10-17T09:00:00.000Z' },
  ]);
  const backend = memoryBackend([
    { id: 'a1', filename: 'x.edf', durationSec: 10, channels: 2, sampleRate: 128, createdAt: '2026-10-17T09:00:00.000Z', synced: true },
  ]);
  const service = createAnalysisService({ client, backend });
  service.setSession({ user: { id: 'u1' } });
  assert.equal((await service.remove('a1')).error, null);
  assert.equal((await service.list()).length, 0);
  assert.equal((await backend.all()).length, 0);
  assert.equal(client.rows.length, 0);
});

test('switching accounts cannot write a stale sync result', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let rows = [{ local_id: 'old', filename: 'old.edf', duration_sec: 10, channels: 1, sample_rate: 100, created_at: '2026-10-01T00:00:00.000Z' }];
  const client = {
    from: () => ({
      select: () => ({ order: () => ({ limit: () => gate.then(() => ({ data: rows, error: null })) }) }),
      insert: () => ({ then: (ok) => ok({ error: null }) }),
      delete: () => ({ eq: () => ({ select: () => ({ then: (ok) => ok({ data: [], error: null }) }) }) }),
    }),
  };
  const backend = memoryBackend();
  const service = createAnalysisService({ client, backend });
  service.setSession({ user: { id: 'u1' } });
  const pending = service.sync();
  service.setSession({ user: { id: 'u2' } }); // account switch mid-flight
  release();
  const result = await pending;
  assert.equal(result.total, 0);
  assert.equal((await backend.all()).length, 0, 'the previous account\'s rows are not written');
});
