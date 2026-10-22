import { get, getAdapter, mergeSettings, newId, set, update } from '@/storage/store';
import { DEFAULTS, DEFAULT_SETTINGS, SCHEMA_VERSION, SECRET_KEYS, STORE_KEYS, type StoreKey, type StoreShape } from '@/storage/schema';
import type { BackupSnapshot, Settings } from '@/types/models';
import { secretKV } from '@/integrations/secretStore';
import { buildExport, EXPORTABLE_KEYS, mergeData, type ImportOk } from '@/features/data/validate';
import { RECOVERY_PREFIX } from '@/features/notes/recovery';
import { LOCAL_BACKUP_PREFIX, PENDING_PREFIX } from '@/extension/popup/quickNote';

/** Export, import, automatic local snapshots and reset/clear actions. */

export const MAX_SNAPSHOTS = 3;

function appVersion(): string {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : 'dev';
  } catch {
    return 'dev';
  }
}

/** Every ts.* value currently stored (secret.* keys are excluded by construction). */
export async function readAllData(): Promise<Partial<Record<StoreKey, unknown>>> {
  const raw = await getAdapter().get(STORE_KEYS);
  const out: Partial<Record<StoreKey, unknown>> = {};
  for (const k of STORE_KEYS) if (k in raw) out[k] = raw[k];
  return out;
}

export async function exportJson(opts: { includeFeedUrls?: boolean } = {}): Promise<{ filename: string; json: string }> {
  const file = buildExport(await readAllData(), { appVersion: appVersion(), includeFeedUrls: opts.includeFeedUrls });
  const stamp = file.exportedAt.slice(0, 10);
  return { filename: `tabspace-backup-${stamp}.json`, json: JSON.stringify(file, null, 2) };
}

/** Trigger a browser download of a text file (extension page / dev server). */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

export async function takeSnapshot(reason: BackupSnapshot['reason'], now = Date.now()): Promise<BackupSnapshot> {
  const all = await readAllData();
  delete all['ts.backups'];
  const snap: BackupSnapshot = { id: newId(), takenAt: now, reason, schemaVersion: SCHEMA_VERSION, data: all };
  await update('ts.backups', (list) => [snap, ...list].slice(0, MAX_SNAPSHOTS));
  return snap;
}

/** Run `fn` under a cross-context Web Lock when available (pages + service worker share it). */
function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks?.request ? (locks.request(name, fn) as Promise<T>) : fn();
}

let dailyInflight: Promise<boolean> | null = null;

/** Take a daily snapshot if none was taken in the last 20 hours and there is something worth saving. */
export function maybeDailySnapshot(now = Date.now()): Promise<boolean> {
  // Single-flight within this context, plus a Web Lock across contexts (alarm + page at once).
  if (!dailyInflight) {
    dailyInflight = withLock('tabspace-snapshot', () => dailySnapshot(now)).finally(() => {
      dailyInflight = null;
    });
  }
  return dailyInflight;
}

async function dailySnapshot(now: number): Promise<boolean> {
  const recent = (list: BackupSnapshot[]) => list.some((s) => s.reason === 'daily' && now - s.takenAt < 20 * 3600_000);
  if (recent(await get('ts.backups'))) return false;
  const all = await readAllData();
  delete all['ts.backups'];
  const hasContent = Object.entries(all).some(([k, v]) => k !== 'ts.settings' && (Array.isArray(v) ? v.length > 0 : false));
  if (!hasContent) return false;
  const snap: BackupSnapshot = { id: newId(), takenAt: now, reason: 'daily', schemaVersion: SCHEMA_VERSION, data: all };
  let added = false;
  // Check and write inside one serialised update so two callers can never both add a daily snapshot.
  await update('ts.backups', (list) => {
    if (recent(list)) return list;
    added = true;
    return [snap, ...list].slice(0, MAX_SNAPSHOTS);
  });
  return added;
}

async function writeAll(data: Partial<Record<StoreKey, unknown>>): Promise<void> {
  for (const [k, v] of Object.entries(data) as [StoreKey, unknown][]) {
    await set(k, (k === 'ts.settings' ? mergeSettings(v as Partial<Settings>) : v) as StoreShape[typeof k]);
  }
}

export async function restoreSnapshot(id: string): Promise<void> {
  const list = await get('ts.backups');
  const snap = list.find((s) => s.id === id);
  if (!snap) throw new Error('That backup no longer exists.');
  const restore: Partial<Record<StoreKey, unknown>> = {};
  for (const k of EXPORTABLE_KEYS) restore[k] = k in snap.data ? snap.data[k] : structuredClone(DEFAULTS[k]);
  // Keep a snapshot of what we are about to overwrite (the restored snapshot itself stays in the list).
  await takeSnapshot('restore');
  await writeAll(restore);
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export async function applyImport(result: ImportOk, mode: 'merge' | 'replace'): Promise<void> {
  await takeSnapshot('import');
  if (mode === 'replace') {
    const next: Partial<Record<StoreKey, unknown>> = {};
    for (const k of EXPORTABLE_KEYS) next[k] = k in result.data ? result.data[k] : structuredClone(DEFAULTS[k]);
    if (result.data['ts.settings']) {
      // Keep this device's integration client IDs unless the file has its own.
      const cur = await get('ts.settings');
      const inc = result.data['ts.settings'] as Partial<Settings>;
      next['ts.settings'] = { ...inc, integrations: { ...cur.integrations, ...inc.integrations } };
    }
    await writeAll(next);
    return;
  }
  const current = await readAllData();
  await writeAll(mergeData(current, result.data));
}

/* ------------------------------------------------------------------ */
/* Reset / clear                                                       */
/* ------------------------------------------------------------------ */

/** Reset appearance & behaviour preferences. Keeps name and integration client IDs. */
export async function resetPreferences(): Promise<void> {
  const cur = await get('ts.settings');
  await set('ts.settings', { ...structuredClone(DEFAULT_SETTINGS), userName: cur.userName, integrations: cur.integrations });
}

/** Delete every Tabspace key, including tokens and backups. */
/** Transient note-safety records that live outside the store schema (chrome.storage / localStorage prefixes). */
const TRANSIENT_STORAGE_PREFIXES = [RECOVERY_PREFIX, PENDING_PREFIX];
const TRANSIENT_LOCAL_PREFIXES = [LOCAL_BACKUP_PREFIX, 'tabspace-recovery:'];

export async function clearAllData(): Promise<void> {
  await getAdapter().remove([...STORE_KEYS]);
  // Long-lived tokens (Spotify refresh token) live in the extension's IndexedDB secret store.
  await secretKV().clear();
  if (typeof chrome !== 'undefined' && chrome.storage) {
    await chrome.storage.local?.remove([...SECRET_KEYS]);
    await chrome.storage.session?.remove([...SECRET_KEYS]);
    // Quick Note / note-recovery leftovers would otherwise be merged back into notes on the next start.
    const all = (typeof chrome.storage.local?.get === 'function' ? await chrome.storage.local.get(null) : {}) as Record<string, unknown>;
    const transient = Object.keys(all).filter((k) => TRANSIENT_STORAGE_PREFIXES.some((p) => k.startsWith(p)));
    if (transient.length) await chrome.storage.local.remove(transient);
  }
  if (typeof localStorage !== 'undefined') {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && TRANSIENT_LOCAL_PREFIXES.some((p) => k.startsWith(p))) localStorage.removeItem(k);
    }
  }
}

/** Delete website usage everywhere it is kept: the live log and every local backup snapshot. */
export async function deleteUsageData(): Promise<void> {
  await update('ts.usage', () => ({}));
  await update('ts.backups', (snaps) =>
    snaps.some((s) => 'ts.usage' in s.data)
      ? snaps.map((s) => {
          const { 'ts.usage': _usage, ...rest } = s.data;
          return { ...s, data: rest };
        })
      : snaps,
  );
}
