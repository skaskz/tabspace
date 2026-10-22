import { describe, expect, it } from 'vitest';
import { chunk, planRestore, serializeTabs, type RuntimeGroup, type RuntimeTab } from '@/features/tabs/serialize';
import type { SavedSession } from '@/types/models';

function ids() {
  let n = 0;
  return () => `id${++n}`;
}

const groups: RuntimeGroup[] = [
  { id: 901, title: 'Dev', color: 'blue', collapsed: false },
  { id: 902, title: 'Video', color: 'red', collapsed: true },
];

const tabs: RuntimeTab[] = [
  { id: 3, index: 2, url: 'https://github.com/me/tabspace', title: 'tabspace', pinned: false, groupId: 901, favIconUrl: 'https://github.com/favicon.ico' },
  { id: 1, index: 0, url: 'https://mail.google.com/', title: 'Inbox', pinned: true, groupId: -1, favIconUrl: 'data:image/png;base64,xx' },
  { id: 2, index: 1, url: 'chrome://extensions/', title: 'Extensions', pinned: false, groupId: -1 },
  { id: 4, index: 3, url: 'https://vercel.com/dash', title: '', pinned: false, groupId: 901 },
  { id: 5, index: 4, url: 'https://studio.youtube.com/', title: 'Studio', pinned: false, groupId: 902 },
  { id: 6, index: 5, url: 'file:///C:/notes.txt', title: 'notes', pinned: false, groupId: 902 },
  { id: 7, index: 6, pendingUrl: 'https://example.com/loading', title: 'Loading', pinned: false },
];

describe('serializeTabs', () => {
  it('keeps order, pinned state, maps runtime groups to new stable ids and skips unrestorable URLs', () => {
    const out = serializeTabs(tabs, groups, ids());
    expect(out.skipped).toBe(2);
    expect(out.tabs.map((t) => t.url)).toEqual([
      'https://mail.google.com/',
      'https://github.com/me/tabspace',
      'https://vercel.com/dash',
      'https://studio.youtube.com/',
      'https://example.com/loading',
    ]);
    expect(out.tabs[0].pinned).toBe(true);
    expect(out.groups).toHaveLength(2);
    const [dev, video] = out.groups;
    expect(dev).toMatchObject({ title: 'Dev', color: 'blue', collapsed: false });
    expect(video).toMatchObject({ title: 'Video', color: 'red', collapsed: true });
    // runtime ids are never persisted
    expect(JSON.stringify(out)).not.toContain('901');
    expect(out.tabs[1].groupId).toBe(dev.id);
    expect(out.tabs[2].groupId).toBe(dev.id);
    expect(out.tabs[3].groupId).toBe(video.id);
    expect(out.tabs[4].groupId).toBeUndefined();
  });

  it('keeps favicons only when http(s) and falls back to the URL for empty titles', () => {
    const out = serializeTabs(tabs, groups, ids());
    expect(out.tabs[0].favIconUrl).toBeUndefined();
    expect(out.tabs[1].favIconUrl).toBe('https://github.com/favicon.ico');
    expect(out.tabs[2].title).toBe('https://vercel.com/dash');
  });

  it('drops groups whose tabs were all skipped', () => {
    const out = serializeTabs([{ id: 1, index: 0, url: 'chrome://newtab', pinned: false, groupId: 901 }], groups, ids());
    expect(out.groups).toEqual([]);
    expect(out.skipped).toBe(1);
  });

  it('round-trips through planRestore', () => {
    const saved = serializeTabs(tabs, groups, ids());
    const plan = planRestore(saved);
    expect(plan.skipped).toBe(0);
    expect(plan.tabs.map((t) => t.url)).toEqual(saved.tabs.map((t) => t.url));
    expect(plan.groups.map((g) => [g.title, g.tabIndexes])).toEqual([
      ['Dev', [1, 2]],
      ['Video', [3]],
    ]);
  });
});

describe('planRestore', () => {
  const session: Pick<SavedSession, 'tabs' | 'groups'> = {
    groups: [
      { id: 'g1', title: 'Research', color: 'green', collapsed: true },
      { id: 'g2', title: 'Unused', color: 'pink', collapsed: false },
    ],
    tabs: [
      { id: 't1', url: 'https://a.com', title: 'A', pinned: false, groupId: 'g1' },
      { id: 't2', url: 'chrome://settings', title: 'Settings', pinned: false },
      { id: 't3', url: 'https://b.com', title: 'B', pinned: true, groupId: 'g1' },
      { id: 't4', url: 'https://c.com', title: 'C', pinned: false, groupId: 'missing' },
      { id: 't5', url: 'javascript:alert(1)', title: 'x', pinned: false },
      { id: 't6', url: 'https://d.com', title: 'D', pinned: false, groupId: 'g1' },
    ],
  };

  it('puts pinned tabs first, ungroups pinned tabs, drops unknown groups and counts skipped', () => {
    const plan = planRestore(session);
    expect(plan.skipped).toBe(2);
    // pinned first, then g1's members kept together at g1's first position
    expect(plan.tabs.map((t) => t.savedTabId)).toEqual(['t3', 't1', 't6', 't4']);
    expect(plan.tabs[0].pinned).toBe(true);
    expect(plan.tabs[0].groupId).toBeUndefined();
    expect(plan.tabs[3].groupId).toBeUndefined();
    expect(plan.groups).toEqual([{ savedGroupId: 'g1', title: 'Research', color: 'green', collapsed: true, tabIndexes: [1, 2] }]);
  });

  it('returns an empty plan when nothing is restorable', () => {
    const plan = planRestore({ groups: [], tabs: [{ id: 'x', url: 'file:///a', title: '', pinned: false }] });
    expect(plan.tabs).toEqual([]);
    expect(plan.skipped).toBe(1);
  });
});

describe('chunk', () => {
  it('splits into batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
