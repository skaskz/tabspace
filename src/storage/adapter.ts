/**
 * Storage adapters. In the extension we use chrome.storage.local (shared by
 * every extension page and the service worker, with change events across
 * pages). Outside the extension (Vite dev server, unit tests) we fall back to
 * localStorage or memory so the UI can still be developed and tested.
 */

export type ChangeListener = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void;

export interface StorageAdapter {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  getAll(): Promise<Record<string, unknown>>;
  subscribe(listener: ChangeListener): () => void;
}

export function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export function createChromeAdapter(area: chrome.storage.StorageArea = chrome.storage.local, areaName = 'local'): StorageAdapter {
  return {
    get: (keys) => area.get(keys),
    set: (items) => area.set(items),
    remove: (keys) => area.remove(keys),
    getAll: () => area.get(null),
    subscribe(listener) {
      const handler = (changes: Record<string, chrome.storage.StorageChange>, name: string) => {
        if (name === areaName) listener(changes);
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };
}

export function createMemoryAdapter(initial: Record<string, unknown> = {}): StorageAdapter {
  const data = new Map<string, unknown>(Object.entries(structuredClone(initial)));
  const listeners = new Set<ChangeListener>();
  const emit = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => {
    listeners.forEach((l) => l(changes));
  };
  return {
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (data.has(k)) out[k] = structuredClone(data.get(k));
      return out;
    },
    async set(items) {
      const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data.get(k), newValue: structuredClone(v) };
        data.set(k, structuredClone(v));
      }
      emit(changes);
    },
    async remove(keys) {
      const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
      for (const k of keys) {
        if (data.has(k)) changes[k] = { oldValue: data.get(k) };
        data.delete(k);
      }
      emit(changes);
    },
    async getAll() {
      return structuredClone(Object.fromEntries(data));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** localStorage-backed adapter for the Vite dev server (one JSON value per key). */
export function createLocalStorageAdapter(prefix = 'tabspace-dev:'): StorageAdapter {
  const read = (k: string) => {
    const raw = localStorage.getItem(prefix + k);
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const listeners = new Set<ChangeListener>();
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith(prefix)) return;
    const key = e.key.slice(prefix.length);
    const parse = (v: string | null) => (v == null ? undefined : JSON.parse(v));
    listeners.forEach((l) => l({ [key]: { oldValue: parse(e.oldValue), newValue: parse(e.newValue) } }));
  });
  return {
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        const v = read(k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    },
    async set(items) {
      const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: read(k), newValue: v };
        localStorage.setItem(prefix + k, JSON.stringify(v));
      }
      listeners.forEach((l) => l(changes));
    },
    async remove(keys) {
      const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
      for (const k of keys) {
        changes[k] = { oldValue: read(k) };
        localStorage.removeItem(prefix + k);
      }
      listeners.forEach((l) => l(changes));
    },
    async getAll() {
      const out: Record<string, unknown> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i)!;
        if (full.startsWith(prefix)) out[full.slice(prefix.length)] = read(full.slice(prefix.length));
      }
      return out;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
