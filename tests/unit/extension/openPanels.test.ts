import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_PANELS_KEY, markPanelOpen, onOpenPanelsChanged, openSidePanelWindows, readOpenPanels, resolveOpenWindows } from '@/extension/shared/sidePanel';

describe('resolveOpenWindows', () => {
  it('no side panel context => nothing open, even if a stale set is stored', () => {
    expect(resolveOpenWindows([], [3])).toEqual([]);
  });
  it('trusts contexts with valid window ids', () => {
    expect(resolveOpenWindows([{ windowId: 5 }], [])).toEqual([5]);
  });
  it('falls back to the stored set when contexts report windowId -1 (Chromium 156)', () => {
    expect(resolveOpenWindows([{ windowId: -1 }], [7])).toEqual([7]);
    expect(resolveOpenWindows([{ windowId: -1 }], [])).toBeNull();
  });
  it('uses the stored set when getContexts is unavailable', () => {
    expect(resolveOpenWindows(null, [2])).toEqual([2]);
  });
});

describe('stored open-panel set', () => {
  let store: Record<string, unknown>;
  let listeners: ((c: Record<string, unknown>, area: string) => void)[];
  let contexts: { windowId: number }[];
  beforeEach(() => {
    store = {};
    listeners = [];
    contexts = [];
    vi.stubGlobal('chrome', {
      runtime: { getContexts: async () => contexts, ContextType: { SIDE_PANEL: 'SIDE_PANEL' } },
      storage: {
        session: {
          get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
          set: async (o: Record<string, unknown>) => {
            Object.assign(store, o);
            listeners.forEach((l) => l(Object.fromEntries(Object.keys(o).map((k) => [k, { newValue: o[k] }])), 'session'));
          },
        },
        onChanged: { addListener: (l: (typeof listeners)[number]) => listeners.push(l), removeListener: (l: (typeof listeners)[number]) => (listeners = listeners.filter((x) => x !== l)) },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('adds/removes window ids with serialised writes and notifies subscribers', async () => {
    const cb = vi.fn();
    const off = onOpenPanelsChanged(cb);
    await Promise.all([markPanelOpen(1, true), markPanelOpen(2, true), markPanelOpen(1, false)]);
    expect(await readOpenPanels()).toEqual([2]);
    expect(store[OPEN_PANELS_KEY]).toEqual([2]);
    expect(cb).toHaveBeenCalledTimes(3);
    off();
    await markPanelOpen(4, true);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('ignores invalid ids and garbage stored values', async () => {
    await markPanelOpen(-1, true);
    expect(store[OPEN_PANELS_KEY]).toBeUndefined();
    store[OPEN_PANELS_KEY] = [3, 'x', -2, 1.5];
    expect(await readOpenPanels()).toEqual([3]);
  });

  it('openSidePanelWindows combines getContexts with the stored set', async () => {
    await markPanelOpen(9, true);
    contexts = [{ windowId: -1 }];
    expect(await openSidePanelWindows()).toEqual([9]);
    contexts = [];
    expect(await openSidePanelWindows()).toEqual([]);
  });
});
