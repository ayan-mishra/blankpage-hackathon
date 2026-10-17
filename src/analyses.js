// Previous analyses: plain data, validated once and shared by the local store,
// the Supabase sync layer and the sidebar UI. No generated code.
import { normalizeRules } from './checklists.js';

export const MAX_ANALYSES = 200;
export const MAX_FILENAME = 200;
export const MAX_STORAGE_PATH = 400;

// The app's ceiling for a stored recording (per the 1 GB requirement).
export const MAX_RECORDING_BYTES = 1024 * 1024 * 1024;
// This Supabase project's storage plan refuses single objects above 50 MiB
// ("upgrade to a paid plan to unlock higher file size limits"). Keep the two
// numbers separate so the UI can tell the truth instead of promising 1 GB.
export const UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

export function newAnalysisId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function analysisFilename(name) {
  if (typeof name !== 'string') throw new Error('Enter a recording name of 1–200 characters.');
  const trimmed = name.trim();
  if (!trimmed || [...trimmed].length > MAX_FILENAME) {
    throw new Error('Enter a recording name of 1–200 characters.');
  }
  return trimmed;
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// One saved analysis. Only metadata, the checklist used and (optionally) a
// pointer to the stored recording are kept here.
export function normalizeAnalysis(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('That is not a valid Somnium analysis.');
  const { id, filename, durationSec, channels, sampleRate, createdAt, synced, checklist, sizeBytes, storagePath, owner } = raw;
  if (typeof id !== 'string' || !id.trim() || [...id].length > 100) {
    throw new Error('That is not a valid Somnium analysis.');
  }
  if (!isFiniteNumber(durationSec) || durationSec <= 0 || durationSec > 86400) {
    throw new Error('That analysis has an invalid recording length.');
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > 1024) {
    throw new Error('That analysis has an invalid channel count.');
  }
  if (!isFiniteNumber(sampleRate) || sampleRate <= 0 || sampleRate > 1e6) {
    throw new Error('That analysis has an invalid sample rate.');
  }
  const when = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(when.getTime())) throw new Error('That analysis has an invalid date.');

  const rules = checklist == null ? [] : normalizeRules(checklist);

  let size = null;
  if (sizeBytes != null) {
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_RECORDING_BYTES) {
      throw new Error('That analysis has an invalid recording size.');
    }
    size = sizeBytes;
  }

  let path = null;
  if (storagePath != null) {
    if (typeof storagePath !== 'string') throw new Error('That analysis has an invalid storage path.');
    const trimmed = storagePath.trim();
    if (!trimmed || [...trimmed].length > MAX_STORAGE_PATH || trimmed.startsWith('/') || trimmed.includes('..')) {
      throw new Error('That analysis has an invalid storage path.');
    }
    path = trimmed;
  }

  if (owner != null && (typeof owner !== 'string' || !owner)) {
    throw new Error('That analysis has an invalid owner.');
  }

  return {
    id: id.trim(),
    filename: analysisFilename(filename),
    durationSec,
    channels,
    sampleRate,
    createdAt: when.toISOString(),
    synced: !!synced,
    checklist: rules,
    sizeBytes: size,
    storagePath: path,
    owner: owner ?? null,
  };
}

// Recording metadata from the EDF in memory -> a saveable record.
export function buildAnalysis(meta, overrides = {}) {
  return normalizeAnalysis({
    id: overrides.id ?? newAnalysisId(),
    filename: overrides.filename ?? meta.filename,
    durationSec: meta.durationSec,
    channels: meta.channels,
    sampleRate: meta.sampleRate,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    synced: overrides.synced ?? false,
    checklist: overrides.checklist ?? [],
    sizeBytes: overrides.sizeBytes ?? null,
    storagePath: overrides.storagePath ?? null,
    owner: overrides.owner ?? null,
  });
}

// Union of the browser copy and the account copy, newest first.
// The cloud row wins when both sides know the same analysis: it carries the
// server's own created_at and proves the row was accepted.
export function mergeAnalyses(local = [], cloud = []) {
  const byId = new Map();
  for (const raw of local) {
    let rec;
    try { rec = normalizeAnalysis(raw); } catch { continue; }
    byId.set(rec.id, rec);
  }
  for (const raw of cloud) {
    let rec;
    try { rec = normalizeAnalysis({ ...raw, synced: true }); } catch { continue; }
    byId.set(rec.id, rec);
  }
  return [...byId.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, MAX_ANALYSES);
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

export function formatRate(rate) {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)} Hz`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${+(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatSaved(iso, now = Date.now()) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const mins = Math.round((now - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const days = Math.floor(mins / 1440);
  if (days === 0) return `${Math.floor(mins / 60)} h ago`;
  if (days < 7) return `${days} d ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: then.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

// Supabase column names <-> record fields. Kept together so the two never drift.
export function toRow(rec) {
  return {
    local_id: rec.id,
    filename: rec.filename,
    duration_sec: rec.durationSec,
    channels: rec.channels,
    sample_rate: rec.sampleRate,
    created_at: rec.createdAt,
    checklist: rec.checklist,
    size_bytes: rec.sizeBytes,
    storage_path: rec.storagePath,
  };
}

export function fromRow(row) {
  return normalizeAnalysis({
    id: row.local_id,
    filename: row.filename,
    durationSec: Number(row.duration_sec),
    channels: Number(row.channels),
    sampleRate: Number(row.sample_rate),
    createdAt: row.created_at,
    synced: true,
    checklist: row.checklist ?? [],
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    storagePath: row.storage_path ?? null,
  });
}
