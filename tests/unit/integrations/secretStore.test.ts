import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setSecretKV, createIdbKV, createMemoryKV, type SecretKV } from '@/integrations/secretStore';
import { getSecret, migrateLegacySecrets, restrictSessionStorage, setSecret } from '@/integrations/secrets';
import { disconnectSpotify, getSpotifyToken, hasSpotifySecret } from '@/integrations/spotify/auth';
import { clearAllData } from '@/services/backup';

/** chrome.storage area fake (get/set/remove, promise form). */
function fakeArea(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return Object.fromEntries(data);
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (data.has(k)) out[k] = data.get(k);
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    }),
  };
}

/** Just enough of IndexedDB to exercise the wrapper: one DB, one store, async events. */
function fakeIndexedDB(): IDBFactory {
  const stores = new Map<string, Map<string, unknown>>();
  const later = (fn: () => void) => setTimeout(fn, 0);
  const db = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore: (n: string) => stores.set(n, new Map()),
    onversionchange: null as unknown,
    close: () => undefined,
    transaction: (name: string) => {
      const tx: Record<string, unknown> = {};
      const store = stores.get(name)!;
      const request = (op: () => unknown) => {
        const req: Record<string, unknown> = {};
        later(() => {
          req.result = op();
          (req.onsuccess as (() => void) | undefined)?.();
          later(() => (tx.oncomplete as (() => void) | undefined)?.());
        });
        return req;
      };
      tx.objectStore = () => ({
        get: (k: string) => request(() => structuredClone(store.get(k))),
        put: (v: unknown, k: string) => request(() => void store.set(k, structuredClone(v))),
        delete: (k: string) => request(() => void store.delete(k)),
        clear: () => request(() => store.clear()),
      });
      return tx;
    },
  };
  return {
    open: () => {
      const req: Record<string, unknown> = { result: db };
      later(() => {
        if (!stores.size) (req.onupgradeneeded as () => void)();
        (req.onsuccess as () => void)();
      });
      return req;
    },
  } as unknown as IDBFactory;
}

let kv: SecretKV;
beforeEach(() => {
  kv = createMemoryKV();
  __setSecretKV(kv);
});
afterEach(() => {
  __setSecretKV(null);
  vi.unstubAllGlobals();
});

describe('secret KV stores', () => {
  it.each([
    ['memory', () => createMemoryKV()],
    ['IndexedDB wrapper', () => createIdbKV(fakeIndexedDB(), 'test-db')],
  ])('%s: get / set / delete / clear', async (_n, make) => {
    const store = make();
    expect(await store.get('a')).toBeUndefined();
    await store.set('a', { refreshToken: 'r1' });
    await store.set('b', 2);
    expect(await store.get('a')).toEqual({ refreshToken: 'r1' });
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
    await store.clear();
    expect(await store.get('b')).toBeUndefined();
  });
});

describe('Spotify refresh token storage (V21-3)', () => {
  const legacy = { accessToken: 'a', refreshToken: 'legacy-r', expiresAt: Date.now() + 3600_000, clientId: 'c', scope: '' };

  it('moves a legacy secret.spotify out of chrome.storage.local on first read', async () => {
    const local = fakeArea({ 'secret.spotify': legacy, 'ts.tasks': [] });
    vi.stubGlobal('chrome', { storage: { local, session: fakeArea() } });
    expect(await getSecret('secret.spotify', 'local')).toEqual(legacy);
    expect(local.data.has('secret.spotify')).toBe(false); // no readable copy left for content scripts
    expect(await kv.get('secret.spotify')).toEqual(legacy);
    expect(local.data.has('ts.tasks')).toBe(true);
  });

  it('worker start-up migration never overwrites a newer token already in the store', async () => {
    await kv.set('secret.spotify', { ...legacy, refreshToken: 'rotated' });
    const local = fakeArea({ 'secret.spotify': legacy });
    vi.stubGlobal('chrome', { storage: { local, session: fakeArea() } });
    await migrateLegacySecrets();
    expect(await kv.get('secret.spotify')).toMatchObject({ refreshToken: 'rotated' });
    expect(local.data.has('secret.spotify')).toBe(false);
  });

  it('new and refreshed tokens are written only to the secret store', async () => {
    const local = fakeArea();
    vi.stubGlobal('chrome', { storage: { local, session: fakeArea() } });
    await setSecret('secret.spotify', { ...legacy, accessToken: 'old', expiresAt: 0 }, 'local');
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }), { status: 200 }));
    expect(await getSpotifyToken(f as unknown as typeof fetch)).toBe('new');
    expect(local.set).not.toHaveBeenCalled();
    expect(await kv.get('secret.spotify')).toMatchObject({ accessToken: 'new', refreshToken: 'r2' });
  });

  it('Disconnect wipes the secret store and any legacy copy', async () => {
    const local = fakeArea({ 'secret.spotify': legacy });
    vi.stubGlobal('chrome', { storage: { local, session: fakeArea() } });
    await kv.set('secret.spotify', legacy);
    await disconnectSpotify();
    expect(await kv.get('secret.spotify')).toBeUndefined();
    expect(local.data.has('secret.spotify')).toBe(false);
    expect(await hasSpotifySecret()).toBe(false);
  });

  it('Clear all data wipes the secret store too', async () => {
    await kv.set('secret.spotify', legacy);
    await clearAllData();
    expect(await kv.get('secret.spotify')).toBeUndefined();
  });

  it('session storage is pinned to TRUSTED_CONTEXTS (not reachable from content scripts)', async () => {
    const session = { ...fakeArea(), setAccessLevel: vi.fn(async () => undefined) };
    vi.stubGlobal('chrome', { storage: { local: fakeArea(), session } });
    await restrictSessionStorage();
    expect(session.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });
});
