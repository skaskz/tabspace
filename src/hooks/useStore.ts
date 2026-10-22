import { useEffect, useState, useSyncExternalStore } from 'react';
import { get, peek, set, subscribe } from '@/storage/store';
import { DEFAULTS, type StoreKey, type StoreShape } from '@/storage/schema';

/**
 * Subscribe a component to a store key. Returns `[value, setValue, loaded]`.
 * Updates made on any extension page (sidebar, popup, dashboard) propagate here.
 */
export function useStore<K extends StoreKey>(key: K): [StoreShape[K], (value: StoreShape[K]) => Promise<void>, boolean] {
  const [loaded, setLoaded] = useState(() => peek(key) !== undefined);
  useEffect(() => {
    let alive = true;
    void get(key).then(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [key]);
  const value = useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => (peek(key) ?? DEFAULTS[key]) as StoreShape[K],
  );
  return [value, (v) => set(key, v), loaded];
}

export function useSettings() {
  return useStore('ts.settings');
}
