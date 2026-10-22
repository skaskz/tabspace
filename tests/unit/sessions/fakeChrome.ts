import { vi } from 'vitest';

/** A tiny stateful fake of chrome.tabs / tabGroups / windows, enough for session tests. */
export interface FakeTab {
  id: number;
  index: number;
  windowId: number;
  url: string;
  title: string;
  pinned: boolean;
  groupId: number;
  highlighted?: boolean;
  active?: boolean;
  favIconUrl?: string;
}

export function createFakeChrome(initial: { windowId: number; tabs: Omit<FakeTab, 'id' | 'index' | 'windowId'>[]; groups?: { id: number; title: string; color: string; collapsed: boolean }[] }) {
  let nextTab = 100;
  let nextGroup = 500;
  let nextWindow = 50;
  const log: string[] = [];
  const tabs: FakeTab[] = initial.tabs.map((t, i) => ({ ...t, id: nextTab++, index: i, windowId: initial.windowId }));
  const groups = (initial.groups ?? []).map((g) => ({ ...g, windowId: initial.windowId }));
  const windows = new Set([initial.windowId]);
  const state = { lastFocused: initial.windowId };

  const reindex = (windowId: number) =>
    tabs
      .filter((t) => t.windowId === windowId)
      .sort((a, b) => a.index - b.index)
      .forEach((t, i) => (t.index = i));
  /** Chrome deletes a group as soon as it has no tabs. */
  const pruneGroups = () => {
    for (let i = groups.length - 1; i >= 0; i--) if (!tabs.some((t) => t.groupId === groups[i].id)) groups.splice(i, 1);
  };
  const windowTabs = (windowId: number) => tabs.filter((t) => t.windowId === windowId).sort((a, b) => a.index - b.index).map((t) => ({ ...t }));

  const chromeMock = {
    runtime: { id: undefined },
    windows: {
      getLastFocused: vi.fn(async () => ({ id: state.lastFocused, focused: true, type: 'normal', tabs: windowTabs(state.lastFocused) })),
      get: vi.fn(async (id: number) => {
        if (!windows.has(id)) throw new Error('No window');
        return { id, type: 'normal', focused: id === state.lastFocused, tabs: windowTabs(id) };
      }),
      getCurrent: vi.fn(async (): Promise<unknown> => undefined),
      getAll: vi.fn(async () => [...windows].map((id) => ({ id, focused: id === initial.windowId, tabs: windowTabs(id) }))),
      create: vi.fn(async ({ url }: { url: string }) => {
        const id = nextWindow++;
        windows.add(id);
        log.push(`windows.create ${url}`);
        const t: FakeTab = { id: nextTab++, index: 0, windowId: id, url, title: url, pinned: false, groupId: -1, active: true };
        tabs.push(t);
        return { id, tabs: [{ ...t }] };
      }),
      update: vi.fn(async () => ({})),
    },
    tabs: {
      query: vi.fn(async (q: { windowId?: number; groupId?: number }) =>
        tabs.filter((t) => (q.windowId === undefined || t.windowId === q.windowId) && (q.groupId === undefined || t.groupId === q.groupId)).map((t) => ({ ...t })),
      ),
      get: vi.fn(async (id: number) => {
        const t = tabs.find((x) => x.id === id);
        if (!t) throw new Error('No tab');
        return { ...t };
      }),
      getCurrent: vi.fn(async () => undefined),
      create: vi.fn(async (p: { windowId: number; url: string; pinned?: boolean; active?: boolean; index?: number }) => {
        log.push(`tabs.create ${p.url}`);
        const t: FakeTab = { id: nextTab++, index: p.index ?? 9999, windowId: p.windowId, url: p.url, title: p.url, pinned: !!p.pinned, groupId: -1, active: p.active };
        tabs.push(t);
        reindex(p.windowId);
        return { ...t };
      }),
      update: vi.fn(async (id: number, p: { pinned?: boolean }) => {
        const t = tabs.find((x) => x.id === id)!;
        Object.assign(t, p);
        return { ...t };
      }),
      remove: vi.fn(async (ids: number | number[]) => {
        const list = Array.isArray(ids) ? ids : [ids];
        log.push(`tabs.remove ${list.join(',')}`);
        for (const id of list) tabs.splice(tabs.findIndex((t) => t.id === id), 1);
        pruneGroups();
      }),
      group: vi.fn(async (o: { tabIds: number[]; groupId?: number; createProperties?: { windowId?: number } }) => {
        const gid = o.groupId ?? nextGroup++;
        log.push(`tabs.group ${o.tabIds.join(',')}`);
        if (o.groupId === undefined) groups.push({ id: gid, title: '', color: 'grey', collapsed: false, windowId: o.createProperties?.windowId ?? initial.windowId });
        for (const id of o.tabIds) tabs.find((t) => t.id === id)!.groupId = gid;
        pruneGroups();
        return gid;
      }),
      ungroup: vi.fn(async (ids: number | number[]) => {
        for (const id of Array.isArray(ids) ? ids : [ids]) {
          const t = tabs.find((x) => x.id === id);
          if (t) t.groupId = -1;
        }
        pruneGroups();
      }),
      move: vi.fn(async () => []),
    },
    tabGroups: {
      get: vi.fn(async (id: number) => {
        const g = groups.find((x) => x.id === id);
        if (!g) throw new Error('No group');
        return { ...g };
      }),
      query: vi.fn(async (q: { windowId?: number }) => groups.filter((g) => q.windowId === undefined || g.windowId === q.windowId).map((g) => ({ ...g }))),
      update: vi.fn(async (id: number, p: object) => {
        log.push(`tabGroups.update ${id}`);
        Object.assign(groups.find((g) => g.id === id)!, p);
        return {};
      }),
    },
  };
  /** Add another normal window with tabs (returns its id). */
  const addWindow = (urls: string[]) => {
    const id = nextWindow++;
    windows.add(id);
    urls.forEach((url, i) => tabs.push({ id: nextTab++, index: i, windowId: id, url, title: url, pinned: false, groupId: -1 }));
    return id;
  };
  /** Simulate a Chrome restart restoring the same tabs/groups with new runtime IDs. */
  const restart = () => {
    const idMap = new Map<number, number>();
    for (const g of groups) {
      const nid = nextGroup++ + 1000;
      idMap.set(g.id, nid);
      g.id = nid;
    }
    for (const t of tabs) {
      t.id = nextTab++ + 1000;
      if (t.groupId !== -1) t.groupId = idMap.get(t.groupId) ?? -1;
    }
  };
  return { chrome: chromeMock, tabs, groups, log, state, addWindow, restart };
}
