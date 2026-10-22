import { createChromeAdapter, createLocalStorageAdapter, createMemoryAdapter, hasChromeStorage, type StorageAdapter } from './adapter';
import { DEFAULTS, DEFAULT_SETTINGS, type StoreKey, type StoreShape } from './schema';
import type { BaseRecord, Settings } from '@/types/models';

/**
 * Tabspace's local-first store.
 *
 * - One chrome.storage.local key per collection (see schema.ts).
 * - An in-memory cache per page, kept fresh by storage change events so that
 *   edits in the sidebar instantly show up in the dashboard and vice versa.
 * - Writes are serialised per page through a promise queue so rapid repeated
 *   clicks cannot interleave read-modify-write cycles.
 */

let adapter: StorageAdapter | null = null;
const cache = new Map<StoreKey, unknown>();
const listeners = new Map<StoreKey, Set<() => void>>();
let unsubscribe: (() => void) | null = null;
/** One in-page write queue per key, so a slow write to one collection never delays another. */
const queues = new Map<StoreKey, Promise<unknown>>();

/** Give up waiting for another context's lock after this long (the lock itself is never held across user code). */
const LOCK_WAIT_MS = 10_000;

function pickAdapter(): StorageAdapter {
  if (hasChromeStorage()) return createChromeAdapter();
  if (typeof localStorage !== 'undefined' && typeof window !== 'undefined') return createLocalStorageAdapter();
  return createMemoryAdapter();
}

export function getAdapter(): StorageAdapter {
  if (!adapter) setAdapter(pickAdapter());
  return adapter!;
}

/** Swap the storage backend (used by tests). Clears the cache. */
export function setAdapter(next: StorageAdapter): void {
  unsubscribe?.();
  adapter = next;
  cache.clear();
  unsubscribe = next.subscribe((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (!(key in DEFAULTS)) continue;
      const k = key as StoreKey;
      cache.set(k, change.newValue === undefined ? DEFAULTS[k] : normalize(k, change.newValue));
      listeners.get(k)?.forEach((l) => l());
    }
  });
}

function normalize<K extends StoreKey>(key: K, value: unknown): StoreShape[K] {
  if (key === 'ts.settings') return mergeSettings(value as Partial<Settings>) as StoreShape[K];
  return value as StoreShape[K];
}

/** Deep-merge stored settings over defaults so newly added settings always have a value. */
export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    dashboardWidgets: { ...DEFAULT_SETTINGS.dashboardWidgets, ...s.dashboardWidgets },
    sidebar: {
      ...DEFAULT_SETTINGS.sidebar,
      ...s.sidebar,
      sections: { ...DEFAULT_SETTINGS.sidebar.sections, ...s.sidebar?.sections },
    },
    newTab: { ...DEFAULT_SETTINGS.newTab, ...s.newTab },
    focus: { ...DEFAULT_SETTINGS.focus, ...s.focus },
    quickNote: { ...DEFAULT_SETTINGS.quickNote, ...s.quickNote },
    tabspaceBar: { ...DEFAULT_SETTINGS.tabspaceBar, ...s.tabspaceBar },
    workspaceGroups: { ...DEFAULT_SETTINGS.workspaceGroups, ...s.workspaceGroups },
    updates: { ...DEFAULT_SETTINGS.updates, ...s.updates },
    searchTheme: { ...DEFAULT_SETTINGS.searchTheme, ...s.searchTheme },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...s.notifications },
    analytics: { ...DEFAULT_SETTINGS.analytics, ...s.analytics },
    smartGrouping: { ...DEFAULT_SETTINGS.smartGrouping, ...s.smartGrouping },
    integrations: { ...DEFAULT_SETTINGS.integrations, ...s.integrations },
  };
}

export async function get<K extends StoreKey>(key: K): Promise<StoreShape[K]> {
  if (cache.has(key)) return cache.get(key) as StoreShape[K];
  const res = await getAdapter().get([key]);
  const value = key in res ? normalize(key, res[key]) : structuredClone(DEFAULTS[key]);
  cache.set(key, value);
  return value;
}

/** Synchronous cached read (undefined until first loaded). */
export function peek<K extends StoreKey>(key: K): StoreShape[K] | undefined {
  return cache.get(key) as StoreShape[K] | undefined;
}

export async function set<K extends StoreKey>(key: K, value: StoreShape[K]): Promise<void> {
  // Optimistic: update the cache first so the UI responds instantly, but roll back if the write fails
  // (e.g. quota or a closed context) so the UI never shows data that isn't actually stored.
  const had = cache.has(key);
  const previous = cache.get(key);
  cache.set(key, value);
  listeners.get(key)?.forEach((l) => l());
  try {
    await getAdapter().set({ [key]: value });
  } catch (err) {
    if (cache.get(key) === value) {
      if (had) cache.set(key, previous);
      else cache.delete(key);
      listeners.get(key)?.forEach((l) => l());
    }
    throw err;
  }
}

/**
 * Run `fn` while holding a cross-context lock for `key`. Web Locks are shared by
 * every page *and* the service worker of the extension origin, so two
 * dashboard tabs (or a tab and the worker) can never interleave a
 * read-modify-write on the same collection. Falls back to the per-page queue
 * where Web Locks are unavailable.
 */
function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return fn();
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(LOCK_WAIT_MS) : undefined;
  return (signal ? locks.request(`tabspace-store:${key}`, { signal }, fn) : locks.request(`tabspace-store:${key}`, fn)) as Promise<T>;
}

/** Serialised read-modify-write (within this page and across extension contexts). The updater must be pure. */
export function update<K extends StoreKey>(key: K, updater: (current: StoreShape[K]) => StoreShape[K]): Promise<StoreShape[K]> {
  const run = (queues.get(key) ?? Promise.resolve()).then(() =>
    withKeyLock(key, async () => {
      // Always re-read from storage inside the lock so writes from other pages are not clobbered.
      const res = await getAdapter().get([key]);
      const current = key in res ? normalize(key, res[key]) : structuredClone(DEFAULTS[key]);
      const next = updater(current);
      await set(key, next);
      return next;
    }),
  );
  queues.set(key, run.catch(() => undefined));
  return run;
}

export function subscribe(key: StoreKey, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  return () => set!.delete(listener);
}

/* ------------------------------------------------------------------ */
/* Collection helpers                                                  */
/* ------------------------------------------------------------------ */

type CollectionKey = {
  [K in StoreKey]: StoreShape[K] extends BaseRecord[] ? K : never;
}[StoreKey];

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type Item<K extends CollectionKey> = StoreShape[K][number];
type NewItem<K extends CollectionKey> = Omit<Item<K>, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export async function insert<K extends CollectionKey>(key: K, item: NewItem<K>): Promise<Item<K>> {
  const now = Date.now();
  const record = { ...item, id: item.id ?? newId(), createdAt: now, updatedAt: now } as Item<K>;
  await update(key, (list) => [...(list as Item<K>[]), record] as StoreShape[K]);
  return record;
}

export async function patch<K extends CollectionKey>(key: K, id: string, changes: Partial<Item<K>>): Promise<void> {
  await update(key, (list) =>
    (list as Item<K>[]).map((r) => (r.id === id ? { ...r, ...changes, id, updatedAt: Date.now() } : r)) as StoreShape[K],
  );
}

export async function remove<K extends CollectionKey>(key: K, id: string): Promise<void> {
  await update(key, (list) => (list as Item<K>[]).filter((r) => r.id !== id) as StoreShape[K]);
}

export async function removeMany<K extends CollectionKey>(key: K, ids: string[]): Promise<void> {
  const drop = new Set(ids);
  await update(key, (list) => (list as Item<K>[]).filter((r) => !drop.has(r.id)) as StoreShape[K]);
}
