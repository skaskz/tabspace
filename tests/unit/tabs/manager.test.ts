import { describe, expect, it } from 'vitest';
import { filterTabs, normalizeForMatch, sectionTabs, sortTabs, urlWorkspaceIndex, workspaceUrls } from '@/features/tabs/manager';
import type { RuntimeGroup, RuntimeTab } from '@/features/tabs/serialize';
import type { SavedSession, Workspace } from '@/types/models';

const tabs: RuntimeTab[] = [
  { id: 1, index: 0, url: 'https://www.youtube.com/watch', title: 'Edit YouTube Short', pinned: false, groupId: 10, lastAccessed: 100 },
  { id: 2, index: 1, url: 'https://github.com/me/tabspace', title: 'Push Tabspace to GitHub', pinned: false, groupId: 10, lastAccessed: 500 },
  { id: 3, index: 2, url: 'https://linkedin.com/jobs', title: 'Review job applications', pinned: false, groupId: -1, lastAccessed: 300 },
  { id: 4, index: 3, url: 'https://anthropic.com/', title: 'anthropic', pinned: false, groupId: 20, active: true, lastAccessed: 50 },
];
const groups: RuntimeGroup[] = [
  { id: 20, title: 'AI', color: 'cyan', collapsed: false },
  { id: 10, title: 'Work', color: 'blue', collapsed: false },
];

describe('filterTabs', () => {
  it('filters by query across title and url', () => {
    expect(filterTabs(tabs, { query: 'GITHUB' }).map((t) => t.id)).toEqual([2]);
    expect(filterTabs(tabs, { query: 'review' }).map((t) => t.id)).toEqual([3]);
  });
  it('filters by group and ungrouped', () => {
    expect(filterTabs(tabs, { group: 10 }).map((t) => t.id)).toEqual([1, 2]);
    expect(filterTabs(tabs, { group: 'ungrouped' }).map((t) => t.id)).toEqual([3]);
    expect(filterTabs(tabs, { group: 'all' })).toHaveLength(4);
  });
  it('filters by workspace URLs', () => {
    const urls = new Set([normalizeForMatch('https://github.com/me/tabspace/#readme')]);
    expect(filterTabs(tabs, { urls }).map((t) => t.id)).toEqual([2]);
  });
});

describe('sortTabs', () => {
  it('sorts by last active with the active tab first', () => {
    expect(sortTabs(tabs, 'lastActive').map((t) => t.id)).toEqual([4, 2, 3, 1]);
  });
  it('sorts by title and domain', () => {
    expect(sortTabs(tabs, 'title').map((t) => t.id)).toEqual([4, 1, 2, 3]);
    expect(sortTabs(tabs, 'domain').map((t) => t.id)).toEqual([4, 2, 3, 1]);
  });
  it('position is tab order and does not mutate', () => {
    const rev = [...tabs].reverse();
    expect(sortTabs(rev, 'position').map((t) => t.id)).toEqual([1, 2, 3, 4]);
    expect(rev[0].id).toBe(4);
  });
});

describe('sectionTabs', () => {
  it('orders group sections by window position and puts ungrouped last', () => {
    const s = sectionTabs(tabs, tabs, groups);
    expect(s.map((x) => x.group?.title ?? 'ungrouped')).toEqual(['Work', 'AI', 'ungrouped']);
    expect(s[0].tabs.map((t) => t.id)).toEqual([1, 2]);
  });
  it('keeps totals from all tabs while showing filtered ones', () => {
    const visible = filterTabs(tabs, { query: 'push' });
    const s = sectionTabs(tabs, visible, groups);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ total: 2 });
    expect(s[0].tabs).toHaveLength(1);
  });
});

describe('workspace url index', () => {
  const ws: Workspace[] = [
    { id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 0, updatedAt: 0 },
    { id: 'w2', name: 'Job Search', icon: 'briefcase', order: 1, createdAt: 0, updatedAt: 0 },
  ];
  const mk = (id: string, workspaceId: string | undefined, url: string, updatedAt: number, archived = false): SavedSession => ({
    id, name: id, workspaceId, archived, createdAt: 0, updatedAt, groups: [],
    tabs: [{ id: `${id}t`, url, title: url, pinned: false }],
  });
  const sessions = [
    mk('s1', 'w1', 'https://github.com/me/tabspace', 1),
    mk('s2', 'w2', 'https://github.com/me/tabspace', 5),
    mk('s3', 'w1', 'https://linkedin.com/jobs', 9, true),
    mk('s4', undefined, 'https://a.com', 9),
  ];
  it('uses the most recent non-archived session', () => {
    const idx = urlWorkspaceIndex(sessions, ws);
    expect(idx.get(normalizeForMatch('https://github.com/me/tabspace'))).toBe('Job Search');
    expect(idx.has(normalizeForMatch('https://linkedin.com/jobs'))).toBe(false);
    expect(idx.size).toBe(1);
  });
  it('lists urls in a workspace', () => {
    expect([...workspaceUrls(sessions, 'w1')]).toEqual(['https://github.com/me/tabspace']);
  });
});
