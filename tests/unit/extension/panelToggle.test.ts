import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelToggle } from '@/extension/background/panelToggle';
import { markPanelOpen } from '@/extension/shared/sidePanel';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(canClose = true) {
  const openPanels = new Set<number>();
  const hydration = deferred<number[]>();
  const calls: string[] = [];
  const open = vi.fn(async (id: number) => {
    calls.push(`open:${id}`);
    openPanels.add(id); // what onOpened would do
  });
  const close = vi.fn(async (id: number) => {
    calls.push(`close:${id}`);
    openPanels.delete(id);
  });
  const toggle = createPanelToggle({ openPanels, hydration: hydration.promise, open, close, canClose: () => canClose });
  return { toggle, hydration, open, close, calls, openPanels };
}

describe('toggle-sidebar command (worker woke from idle)', () => {
  it('first press before rehydration: opens synchronously, then closes because the panel was already open', async () => {
    const t = setup();
    const done = t.toggle(4);
    // open() must have been called synchronously (inside the user gesture).
    expect(t.open).toHaveBeenCalledWith(4);
    t.hydration.resolve([4]);
    await done;
    expect(t.calls).toEqual(['open:4', 'close:4']);
    expect(t.openPanels.has(4)).toBe(false);
  });

  it('first press before rehydration: stays open when the panel was closed', async () => {
    const t = setup();
    const done = t.toggle(4);
    t.hydration.resolve([9]);
    await done;
    expect(t.calls).toEqual(['open:4']);
  });

  it('after rehydration: closes directly without calling open()', async () => {
    const t = setup();
    t.hydration.resolve([4]);
    await Promise.resolve();
    await Promise.resolve();
    await t.toggle(4);
    expect(t.calls).toEqual(['close:4']);
    await t.toggle(4);
    expect(t.calls).toEqual(['close:4', 'open:4']);
  });

  it('without sidePanel.close (Chrome < 141) it can only open', async () => {
    const t = setup(false);
    const done = t.toggle(4);
    t.hydration.resolve([4]);
    await done;
    expect(t.calls).toEqual(['open:4']);
  });

  it('a failed hydration read degrades to open-only', async () => {
    const openPanels = new Set<number>();
    const open = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const toggle = createPanelToggle({ openPanels, hydration: Promise.reject(new Error('x')), open, close, canClose: () => true });
    await toggle(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });
});

describe('markPanelOpen cross-context lock', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('runs the read-modify-write inside navigator.locks when available', async () => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
          set: async (o: Record<string, unknown>) => void Object.assign(store, o),
        },
      },
    });
    const request = vi.fn((_name: string, cb: () => Promise<void>) => cb());
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    await markPanelOpen(3, true);
    expect(request).toHaveBeenCalledWith('tabspace-open-panels', expect.any(Function));
    expect(store['ts.session.openPanels']).toEqual([3]);
  });
});
