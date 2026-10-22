import { getAdapter, mergeSettings, update } from './store';
import type { Settings } from '@/types/models';
import { DEFAULTS, SCHEMA_VERSION, STORE_KEYS, type StoreKey } from './schema';

/**
 * Schema migrations, run by the service worker on install/update.
 * Version lives in `ts.settings.schemaVersion`. Every step is idempotent.
 *
 * v1 (baseline): repair obviously corrupt values — a key whose stored value has the
 * wrong JSON kind (e.g. an object where a list is expected) is removed so it falls
 * back to its default — and stamp schemaVersion.
 */

type Data = Record<string, unknown>;

export interface Migration {
  to: number;
  run(data: Data): Data;
}

const kindOf = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

export const MIGRATIONS: Migration[] = [
  {
    to: 1,
    run(data) {
      const out: Data = {};
      for (const k of STORE_KEYS) {
        if (!(k in data)) continue;
        const def = DEFAULTS[k as StoreKey];
        const v = data[k];
        // ts.activeWorkspace is string | null.
        if (k === 'ts.activeWorkspace' ? v === null || typeof v === 'string' : kindOf(v) === kindOf(def)) {
          out[k] = Array.isArray(v) ? v.filter((r) => r && typeof r === 'object') : v;
        }
      }
      return out;
    },
  },
];

/** Pure: apply migrations newer than `from` to a snapshot of stored data. */
export function migrateData(data: Data, from: number, migrations: Migration[] = MIGRATIONS): { data: Data; version: number } {
  let current = { ...data };
  let version = from;
  for (const m of [...migrations].sort((a, b) => a.to - b.to)) {
    if (m.to <= version) continue;
    current = m.run(current);
    version = m.to;
  }
  return { data: current, version };
}

export async function runMigrations(): Promise<void> {
  const adapter = getAdapter();
  const raw = await adapter.get(STORE_KEYS);
  const settings = raw['ts.settings'] as { schemaVersion?: unknown } | undefined;
  const from = typeof settings?.schemaVersion === 'number' ? settings.schemaVersion : 0;
  if (from >= SCHEMA_VERSION) return; // up to date (or a newer build's data — never downgrade)
  const { data, version } = migrateData(raw, from);
  const removed = Object.keys(raw).filter((k) => !(k in data));
  if (removed.length) await adapter.remove(removed);
  // Only rewrite keys that were actually stored and repaired: on a fresh install nothing exists yet, and
  // writing defaults here could clobber data a page saved while the migration was running (BUG-MG1).
  const changed: Data = {};
  for (const [k, v] of Object.entries(data)) if (k !== 'ts.settings' && k in raw && raw[k] !== v) changed[k] = v;
  if (Object.keys(changed).length) await adapter.set(changed);
  // Stamp the version under the store lock. If settings changed since our snapshot, keep the newer values.
  const migrated = (data['ts.settings'] as Partial<Settings> | undefined) ?? {};
  await update('ts.settings', (current) => {
    const untouched = 'ts.settings' in raw && JSON.stringify(current) === JSON.stringify(mergeSettings(raw['ts.settings'] as Partial<Settings>));
    // Fresh install (nothing stored): just stamp the version on whatever pages have written meanwhile.
    // Existing settings: apply the repaired copy only if nobody changed settings since our snapshot.
    const base = untouched ? mergeSettings({ ...current, ...migrated }) : current;
    return { ...base, schemaVersion: version };
  });
}
