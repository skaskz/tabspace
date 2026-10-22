import { useCallback, useEffect, useRef, useState } from 'react';
import { getOwnTab, hasTabsApi, listWindows, subscribeTabChanges, type WindowInfo } from '@/services/tabs';

/** Live list of browser windows (tabs + groups), refreshed on Chrome tab/group events (debounced). */
export function useWindows() {
  const available = hasTabsApi();
  const [windows, setWindows] = useState<WindowInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The tab this Tabspace page runs in (never selectable / closable from the manager). */
  const [ownTab, setOwnTab] = useState<{ id?: number; windowId?: number } | undefined>();
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const n = ++seq.current;
    try {
      const next = await listWindows();
      if (n === seq.current) {
        setWindows(next);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : 'Couldn’t read your tabs.');
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    void getOwnTab().then(setOwnTab);
    void refresh();
    return subscribeTabChanges(() => void refresh(), 200);
  }, [available, refresh]);

  return { available, windows, error, refresh, ownTab };
}
