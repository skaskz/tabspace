/**
 * Key/value store for long-lived secrets (the Spotify refresh token).
 *
 * It lives in the extension origin's IndexedDB. Extension pages and the service worker can
 * open it, but content scripts cannot: they run in the website's origin, so `indexedDB`
 * there is the site's database. chrome.storage.local, by contrast, is readable by content
 * scripts and cannot be restricted (only storage.session has setAccessLevel).
 * Outside the extension (dev server, unit tests) an in-memory store is used.
 */

export interface SecretKV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function createMemoryKV(): SecretKV {
  const m = new Map<string, unknown>();
  return {
    get: async <T,>(k: string) => (m.has(k) ? (structuredClone(m.get(k)) as T) : undefined),
    set: async (k, v) => void m.set(k, structuredClone(v)),
    delete: async (k) => void m.delete(k),
    clear: async () => m.clear(),
  };
}

export const SECRET_DB = 'tabspace-secrets';
const STORE = 'kv';

/** Minimal IndexedDB wrapper (one object store, out-of-line keys). */
export function createIdbKV(factory: IDBFactory = indexedDB, dbName = SECRET_DB): SecretKV {
  let dbP: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!dbP) {
      dbP = new Promise<IDBDatabase>((resolve, reject) => {
        const req = factory.open(dbName, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            db.close();
            dbP = null;
          };
          resolve(db);
        };
        req.onerror = () => reject(req.error ?? new Error('Could not open secret store.'));
        req.onblocked = () => reject(new Error('Secret store is blocked by another Tabspace page.'));
      });
      dbP.catch(() => {
        dbP = null;
      });
    }
    return dbP;
  };
  const run = async <R,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> => {
    const db = await open();
    return new Promise<R>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      let result: R;
      req.onsuccess = () => {
        result = req.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? req.error ?? new Error('Secret store error.'));
      tx.onabort = () => reject(tx.error ?? new Error('Secret store transaction aborted.'));
    });
  };
  return {
    get: <T,>(k: string) => run<T | undefined>('readonly', (s) => s.get(k) as IDBRequest<T | undefined>),
    set: async (k, v) => void (await run('readwrite', (s) => s.put(v, k))),
    delete: async (k) => void (await run('readwrite', (s) => s.delete(k))),
    clear: async () => void (await run('readwrite', (s) => s.clear())),
  };
}

let kv: SecretKV | null = null;

function inExtension(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

export function secretKV(): SecretKV {
  if (!kv) kv = inExtension() && typeof indexedDB !== 'undefined' ? createIdbKV() : createMemoryKV();
  return kv;
}

/** Tests: swap the backing store (pass null to fall back to a fresh default). */
export function __setSecretKV(next: SecretKV | null): void {
  kv = next;
}
