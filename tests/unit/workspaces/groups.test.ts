import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, set, update } from '@/storage/store';
import type { SavedSession, Workspace } from '@/types/models';
import { chooseGroupForWorkspace, matchTabsToSaved, missingSavedTabs, pickGroupColor } from '@/features/workspaces/groups';
import { openWorkspace } from '@/services/sessions';
import { getLiveWorkspaceGroups, markGroupClosed, relinkWorkspaceGroups, resetTabMapForTests, setWorkspaceGroupColor, syncWorkspaceChanges } from '@/services/workspaceGroups';
import { recentSyncRemovals, restoreSyncRemoval, SYNC_REMOVED_KEEP_MS } from '@/services/workspaceGroupSync';
import { handleTabActivated, handleTabComplete, handleTabCreated, handleTabGroupChange, handleTabRemoved } from '@/services/workspaceGroupSync';
import { createFakeChrome } from '../sessions/fakeChrome';

const ws = (id: string, name: string): Workspace => ({ id, name, icon: 'code', order: 0, createdAt: 0, updatedAt: 0 });
const sess = (id: string, workspaceId: string, urls: string[]): SavedSession => ({
  id,
  name: id,
  workspaceId,
  createdAt: 1,
  updatedAt: 1,
  groups: [],
  tabs: urls.map((u, i) => ({ id: `${id}-${i}`, url: `https://${u}/`, title: u, pinned: false })),
});
const savedUrls = async (workspaceId: string) =>
  (await get('ts.sessions'))
    .filter((s) => s.workspaceId === workspaceId && !s.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    .tabs.map((t) => t.url);

let fake: ReturnType<typeof createFakeChrome>;

beforeEach(async () => {
  resetTabMapForTests();
  fake = createFakeChrome({ windowId: 1, tabs: [{ url: 'chrome-extension://x/dashboard.html', title: 'Tabspace', pinned: false, groupId: -1, active: true }] });
  fake.chrome.tabs.getCurrent.mockResolvedValue({ id: fake.tabs[0].id, windowId: 1 } as never);
  vi.stubGlobal('chrome', fake.chrome);
  await set('ts.workspaces', [ws('dev', 'Development'), ws('jobs', 'Job Search')]);
  await set('ts.sessions', [sess('sd', 'dev', ['github.com', 'vercel.com', 'npmjs.com']), sess('sj', 'jobs', ['linkedin.com', 'indeed.com'])]);
});
afterEach(() => vi.unstubAllGlobals());

const groupOf = (title: string) => fake.groups.find((g) => g.title === title)!;
const tabsIn = (groupId: number) => fake.tabs.filter((t) => t.groupId === groupId).sort((a, b) => a.index - b.index);

describe('pure helpers', () => {
  it('pickGroupColor is stable, prefers unused colours, never grey', () => {
    const a = pickGroupColor('dev', []);
    expect(a).not.toBe('grey');
    expect(pickGroupColor('dev', [])).toBe(a);
    expect(pickGroupColor('other', [{ workspaceId: 'dev', color: a, open: false, updatedAt: 0 }])).not.toBe(a);
    expect(pickGroupColor('dev', [{ workspaceId: 'dev', color: 'pink', open: false, updatedAt: 0 }])).toBe('pink');
  });
  it('missingSavedTabs respects counts and skips non-web URLs', () => {
    const saved = sess('s', 'w', ['a.com', 'b.com', 'a.com']).tabs;
    saved.push({ id: 'x', url: 'chrome://settings', title: 'x', pinned: false });
    expect(missingSavedTabs(saved, ['https://a.com/']).map((t) => t.id)).toEqual(['s-1', 's-2']);
  });
  it('chooseGroupForWorkspace needs a title match AND at least one saved URL, preferring the most overlap', () => {
    const saved = sess('s', 'w', ['a.com']).tabs;
    const groups = [
      { id: 1, windowId: 1, title: 'Other', urls: ['https://a.com/'] },
      { id: 2, windowId: 1, title: 'development', urls: [] },
      { id: 3, windowId: 1, title: 'Development', urls: ['https://a.com/'] },
    ];
    expect(chooseGroupForWorkspace('Development', saved, groups, new Set())?.id).toBe(3);
    expect(chooseGroupForWorkspace('Development', saved, groups, new Set([3]))).toBeUndefined(); // title alone is not enough
    expect(chooseGroupForWorkspace('Research', saved, groups, new Set())).toBeUndefined();
  });
  it('matchTabsToSaved maps each saved tab once', () => {
    const saved = sess('s', 'w', ['a.com', 'a.com']).tabs;
    const m = matchTabsToSaved([{ id: 1, url: 'https://a.com/' }, { id: 2, url: 'https://a.com/#x' }, { id: 3, url: 'https://a.com/' }], saved);
    expect([...m]).toEqual([
      [1, 's-0'],
      [2, 's-1'],
    ]);
  });
});

describe('opening workspaces as tab groups', () => {
  it('opens each workspace as its own named, coloured group in the Tabspace window, in saved order', async () => {
    const r1 = await openWorkspace('dev');
    const r2 = await openWorkspace('jobs');
    expect(r1).toMatchObject({ mode: 'group', opened: 3, focusedExisting: false, windowId: 1 });
    expect(r2).toMatchObject({ mode: 'group', opened: 2 });
    const dev = groupOf('Development');
    const jobs = groupOf('Job Search');
    expect(dev.color).not.toBe(jobs.color);
    expect(tabsIn(dev.id).map((t) => t.url)).toEqual(['https://github.com/', 'https://vercel.com/', 'https://npmjs.com/']);
    expect(tabsIn(jobs.id).map((t) => t.url)).toEqual(['https://linkedin.com/', 'https://indeed.com/']);
    expect(fake.chrome.windows.create).not.toHaveBeenCalled();
    const links = await get('ts.workspaceGroupLinks');
    expect(links.map((l) => [l.workspaceId, l.groupId, l.open])).toEqual([
      ['dev', dev.id, true],
      ['jobs', jobs.id, true],
    ]);
    const live = await getLiveWorkspaceGroups();
    expect(live.get('dev')).toMatchObject({ groupId: dev.id, tabCount: 3 });
  });

  it('reopening an open workspace focuses/expands it and only adds missing tabs (no duplicates)', async () => {
    await openWorkspace('dev');
    const dev = groupOf('Development');
    dev.collapsed = true;
    const again = await openWorkspace('dev');
    expect(again).toMatchObject({ focusedExisting: true, opened: 0, alreadyOpen: 3 });
    expect(tabsIn(dev.id)).toHaveLength(3);
    expect(dev.collapsed).toBe(false);
    expect(fake.chrome.tabs.update).toHaveBeenLastCalledWith(tabsIn(dev.id)[0].id, { active: true });
    // user closes one tab of the group -> reopening adds just that one back, into the same group
    await fake.chrome.tabs.remove(tabsIn(dev.id)[1].id);
    const third = await openWorkspace('dev');
    expect(third).toMatchObject({ focusedExisting: true, opened: 1, alreadyOpen: 2 });
    expect(tabsIn(dev.id).map((t) => t.url).sort()).toEqual(['https://github.com/', 'https://npmjs.com/', 'https://vercel.com/']);
    expect(fake.groups.filter((g) => g.title === 'Development')).toHaveLength(1);
  });

  it('falls back to a new window when tab groups are turned off', async () => {
    await update('ts.settings', (s) => ({ ...s, workspaceGroups: { ...s.workspaceGroups, enabled: false } }));
    await openWorkspace('dev');
    expect(fake.chrome.windows.create).toHaveBeenCalled();
    expect(fake.groups).toHaveLength(0);
  });

  it('collapseOthers: opening/switching collapses other workspace groups only', async () => {
    await update('ts.settings', (s) => ({ ...s, workspaceGroups: { ...s.workspaceGroups, collapseOthers: true } }));
    // a user's own (non-workspace) group
    const mine = fake.tabs[0];
    const own = await fake.chrome.tabs.group({ tabIds: [mine.id] });
    await fake.chrome.tabGroups.update(own, { title: 'Mine' });
    await openWorkspace('dev');
    await openWorkspace('jobs');
    expect(groupOf('Development').collapsed).toBe(true);
    expect(groupOf('Job Search').collapsed).toBe(false);
    expect(groupOf('Mine').collapsed).toBe(false);
    await handleTabActivated(tabsIn(groupOf('Development').id)[0].id);
    expect(groupOf('Job Search').collapsed).toBe(true);
    expect(groupOf('Mine').collapsed).toBe(false);
  });

  it('group colour can be changed and applies to the live group', async () => {
    await openWorkspace('dev');
    await setWorkspaceGroupColor('dev', 'orange');
    expect(groupOf('Development').color).toBe('orange');
    expect((await get('ts.workspaceGroupLinks'))[0].color).toBe('orange');
  });
});

describe('membership sync', () => {
  beforeEach(async () => {
    await openWorkspace('dev');
    await openWorkspace('jobs');
  });
  const tab = async (url: string) => fake.chrome.tabs.get(fake.tabs.find((t) => t.url === url)!.id) as Promise<chrome.tabs.Tab>;

  it('moving a tab between workspace groups moves it between the workspaces’ saved tabs', async () => {
    const t = await tab('https://vercel.com/');
    await fake.chrome.tabs.group({ groupId: groupOf('Job Search').id, tabIds: [t.id!] });
    await handleTabGroupChange(await tab('https://vercel.com/'), 0);
    expect(await savedUrls('dev')).toEqual(['https://github.com/', 'https://npmjs.com/']);
    expect(await savedUrls('jobs')).toEqual(['https://linkedin.com/', 'https://indeed.com/', 'https://vercel.com/']);
  });

  it('moving a tab out to no group removes it; closing tabs or the whole group never does', async () => {
    const t = await tab('https://npmjs.com/');
    await fake.chrome.tabs.ungroup([t.id!]);
    await handleTabGroupChange(await tab('https://npmjs.com/'), 0);
    expect(await savedUrls('dev')).toEqual(['https://github.com/', 'https://vercel.com/']);

    const gh = await tab('https://github.com/');
    await fake.chrome.tabs.remove(gh.id!);
    await handleTabRemoved(gh.id!);
    expect(await savedUrls('dev')).toEqual(['https://github.com/', 'https://vercel.com/']);

    const jobs = groupOf('Job Search');
    const ids = tabsIn(jobs.id).map((x) => x.id);
    await fake.chrome.tabs.remove(ids);
    await markGroupClosed(jobs.id);
    expect(await savedUrls('jobs')).toEqual(['https://linkedin.com/', 'https://indeed.com/']);
    expect((await get('ts.workspaceGroupLinks')).find((l) => l.workspaceId === 'jobs')).toMatchObject({ open: false, groupId: undefined });
    // reopening restores the same saved tabs as a fresh group
    const r = await openWorkspace('jobs');
    expect(r).toMatchObject({ focusedExisting: false, opened: 2 });
  });

  it('ungrouping a whole workspace group keeps its saved tabs', async () => {
    const dev = groupOf('Development');
    const ids = tabsIn(dev.id).map((x) => x.id);
    await fake.chrome.tabs.ungroup(ids);
    for (const id of ids) await handleTabGroupChange((await fake.chrome.tabs.get(id)) as chrome.tabs.Tab, 0);
    expect(await savedUrls('dev')).toEqual(['https://github.com/', 'https://vercel.com/', 'https://npmjs.com/']);
  });

  it('a tab created inside a workspace group is added once it loads a web page', async () => {
    const created = await fake.chrome.tabs.create({ windowId: 1, url: 'chrome://newtab/' });
    await fake.chrome.tabs.group({ groupId: groupOf('Development').id, tabIds: [created.id] });
    await handleTabCreated((await fake.chrome.tabs.get(created.id)) as chrome.tabs.Tab);
    await fake.chrome.tabs.update(created.id, { url: 'https://docs.github.com/', title: 'Docs' } as never);
    await handleTabComplete((await fake.chrome.tabs.get(created.id)) as chrome.tabs.Tab);
    expect(await savedUrls('dev')).toEqual(['https://github.com/', 'https://vercel.com/', 'https://npmjs.com/', 'https://docs.github.com/']);
  });

  it('a group event that arrives before Tabspace stored the link (its own open) is not treated as a move', async () => {
    // Simulate: the dev link momentarily missing while the worker sees the groupId change.
    const links = await get('ts.workspaceGroupLinks');
    await set('ts.workspaceGroupLinks', links.filter((l) => l.workspaceId !== 'dev'));
    const t = await tab('https://vercel.com/');
    const pending = handleTabGroupChange(t, 40);
    setTimeout(() => void set('ts.workspaceGroupLinks', links), 10);
    await pending;
    expect(await savedUrls('dev')).toEqual(['https://github.com/', 'https://vercel.com/', 'https://npmjs.com/']);
  });

  it('a tab closed while the change settles never touches saved tabs', async () => {
    const t = await tab('https://vercel.com/');
    await fake.chrome.tabs.remove(t.id!);
    await handleTabGroupChange(t, 0);
    expect(await savedUrls('dev')).toHaveLength(3);
  });

  it('does nothing when membership sync is off', async () => {
    await update('ts.settings', (s) => ({ ...s, workspaceGroups: { ...s.workspaceGroups, syncMembership: false } }));
    const t = await tab('https://vercel.com/');
    await fake.chrome.tabs.ungroup([t.id!]);
    await handleTabGroupChange(await tab('https://vercel.com/'), 0);
    expect(await savedUrls('dev')).toHaveLength(3);
  });
});

describe('restart and workspace sync', () => {
  it('re-links groups by title after a restart and reopening does not duplicate', async () => {
    await openWorkspace('dev');
    const before = groupOf('Development').id;
    fake.restart();
    resetTabMapForTests();
    expect(await relinkWorkspaceGroups({ allowTitleRelink: true })).toBe(1);
    const after = groupOf('Development').id;
    expect(after).not.toBe(before);
    expect((await get('ts.workspaceGroupLinks'))[0]).toMatchObject({ groupId: after, open: true });
    const r = await openWorkspace('dev');
    expect(r).toMatchObject({ focusedExisting: true, opened: 0 });
    expect(tabsIn(after)).toHaveLength(3);
  });

  it('never adopts a user group for a workspace that was never opened as a group', async () => {
    const t = await fake.chrome.tabs.create({ windowId: 1, url: 'https://github.com/' });
    const g = await fake.chrome.tabs.group({ tabIds: [t.id] });
    await fake.chrome.tabGroups.update(g, { title: 'Development' });
    expect(await relinkWorkspaceGroups()).toBe(0);
    expect(await get('ts.workspaceGroupLinks')).toEqual([]);
  });

  it('marks a link closed when the group is gone after a restart', async () => {
    await openWorkspace('dev');
    await fake.chrome.tabs.remove(tabsIn(groupOf('Development').id).map((t) => t.id));
    await relinkWorkspaceGroups();
    expect((await get('ts.workspaceGroupLinks'))[0]).toMatchObject({ open: false, groupId: undefined });
  });

  it('renaming a workspace renames its group; deleting it ungroups (never closes) its tabs', async () => {
    await openWorkspace('dev');
    const prev = await get('ts.workspaces');
    const renamed = prev.map((w) => (w.id === 'dev' ? { ...w, name: 'Dev & Tools' } : w));
    await syncWorkspaceChanges(prev, renamed);
    const g = fake.groups.find((x) => x.title === 'Dev & Tools')!;
    expect(g).toBeDefined();
    const ids = tabsIn(g.id).map((t) => t.id);
    await syncWorkspaceChanges(renamed, renamed.filter((w) => w.id !== 'dev'));
    expect(fake.groups.find((x) => x.title === 'Dev & Tools')).toBeUndefined();
    expect(ids.every((id) => fake.tabs.some((t) => t.id === id && t.groupId === -1))).toBe(true);
    expect(fake.chrome.tabs.remove).not.toHaveBeenCalled();
    expect(await get('ts.workspaceGroupLinks')).toEqual([]);
  });
});

describe('QA V2.2 fixes', () => {
  /** Minimal Web Locks (one holder per name), like the real navigator.locks. */
  function stubLocks() {
    const tails = new Map<string, Promise<unknown>>();
    const locks = {
      request: (name: string, ...rest: unknown[]) => {
        const fn = rest[rest.length - 1] as () => Promise<unknown>;
        const prev = tails.get(name) ?? Promise.resolve();
        const run = prev.then(() => fn());
        tails.set(name, run.catch(() => undefined));
        return run;
      },
    };
    vi.stubGlobal('navigator', { ...navigator, locks });
  }

  it('BUG-WG1: a user group titled like a CLOSED workspace group is never adopted (even right after a start)', async () => {
    await openWorkspace('dev');
    const dev = groupOf('Development');
    await fake.chrome.tabs.remove(tabsIn(dev.id).map((t) => t.id));
    await markGroupClosed(dev.id); // user closed the group; its window is still there
    expect((await get('ts.workspaceGroupLinks'))[0]).toMatchObject({ open: false, awaitingRestore: false });
    // the user's own group, same title, even containing one of the saved URLs
    const t = await fake.chrome.tabs.create({ windowId: 1, url: 'https://github.com/' });
    const mine = await fake.chrome.tabs.group({ tabIds: [t.id] });
    await fake.chrome.tabGroups.update(mine, { title: 'Development' });
    expect(await relinkWorkspaceGroups({ allowTitleRelink: false })).toBe(0);
    expect(await relinkWorkspaceGroups({ allowTitleRelink: true })).toBe(0);
    expect((await get('ts.workspaceGroupLinks'))[0].groupId).toBeUndefined();
    // and reopening creates its own group instead of using the user's
    await openWorkspace('dev');
    expect(fake.groups.filter((g) => g.title === 'Development')).toHaveLength(2);
    expect(tabsIn(mine).map((x) => x.url)).toEqual(['https://github.com/']);
  });

  it('a group that went away with its window is marked awaitingRestore; outside the boot window it is not re-linked', async () => {
    await openWorkspace('dev');
    const dev = groupOf('Development');
    const ids = tabsIn(dev.id).map((t) => t.id);
    fake.tabs.splice(0, fake.tabs.length, ...fake.tabs.filter((t) => !ids.includes(t.id))); // its window closed
    fake.groups.splice(fake.groups.indexOf(dev), 1);
    fake.chrome.windows.get.mockRejectedValueOnce(new Error('No window'));
    await markGroupClosed(dev.id);
    expect((await get('ts.workspaceGroupLinks'))[0]).toMatchObject({ open: false, awaitingRestore: true });
    expect(await relinkWorkspaceGroups({ allowTitleRelink: false })).toBe(0);
    expect((await get('ts.workspaceGroupLinks'))[0].awaitingRestore).toBe(false);
  });

  it('a group dragged to another window (new group id, same tabs) keeps its link by tab identity', async () => {
    await openWorkspace('dev');
    const dev = groupOf('Development');
    const oldId = dev.id;
    dev.id = 9999; // Chrome recreates the group in the other window
    for (const t of fake.tabs) if (t.groupId === oldId) t.groupId = 9999;
    await markGroupClosed(oldId);
    expect(await relinkWorkspaceGroups({ allowTitleRelink: false })).toBe(1);
    expect((await get('ts.workspaceGroupLinks'))[0]).toMatchObject({ groupId: 9999, open: true });
    expect(await openWorkspace('dev')).toMatchObject({ focusedExisting: true, opened: 0 });
  });

  it('title-only match after a restart is not enough (no overlapping URL)', async () => {
    await openWorkspace('dev');
    fake.restart();
    for (const t of fake.tabs.filter((x) => x.groupId !== -1)) t.url = 'https://unrelated.example/';
    expect(await relinkWorkspaceGroups({ allowTitleRelink: true })).toBe(0);
  });

  it('BUG-WG2: two concurrent opens of the same workspace create ONE group', async () => {
    stubLocks();
    const [a, b] = await Promise.all([openWorkspace('dev'), openWorkspace('dev')]);
    expect(fake.groups.filter((g) => g.title === 'Development')).toHaveLength(1);
    expect(tabsIn(groupOf('Development').id)).toHaveLength(3);
    expect([a.focusedExisting, b.focusedExisting].sort()).toEqual([false, true]);
  });

  it('OBS-1: reopening after the user ungrouped the group reuses the loose tabs instead of duplicating', async () => {
    await openWorkspace('dev');
    const dev = groupOf('Development');
    const ids = tabsIn(dev.id).map((t) => t.id);
    await fake.chrome.tabs.ungroup(ids);
    await markGroupClosed(dev.id);
    const created = fake.chrome.tabs.create.mock.calls.length;
    const r = await openWorkspace('dev');
    expect(r).toMatchObject({ opened: 0, alreadyOpen: 3, focusedExisting: false });
    expect(fake.chrome.tabs.create.mock.calls.length).toBe(created);
    const g = groupOf('Development');
    expect(tabsIn(g.id).map((t) => t.id).sort()).toEqual([...ids].sort());
    expect(fake.tabs.filter((t) => t.url === 'https://github.com/')).toHaveLength(1);
  });

  it('OBS-1: reuses only matching loose tabs, opens the rest, never takes pinned tabs', async () => {
    const loose = await fake.chrome.tabs.create({ windowId: 1, url: 'https://vercel.com/' });
    const pinned = await fake.chrome.tabs.create({ windowId: 1, url: 'https://github.com/', pinned: true });
    const r = await openWorkspace('dev');
    expect(r).toMatchObject({ opened: 2, alreadyOpen: 1 });
    const g = groupOf('Development');
    expect(tabsIn(g.id).map((t) => t.url).sort()).toEqual(['https://github.com/', 'https://npmjs.com/', 'https://vercel.com/']);
    expect(tabsIn(g.id).some((t) => t.id === loose.id)).toBe(true);
    expect(fake.tabs.find((t) => t.id === pinned.id)!.groupId).toBe(-1);
  });

  it('OBS-2: a tab dragged out is recorded and can be restored at its old position for 7 days', async () => {
    await openWorkspace('dev');
    await openWorkspace('jobs');
    const vercel = fake.tabs.find((t) => t.url === 'https://vercel.com/')!;
    await fake.chrome.tabs.ungroup([vercel.id]);
    await handleTabGroupChange((await fake.chrome.tabs.get(vercel.id)) as chrome.tabs.Tab, 0);
    expect(await savedUrls('dev')).toEqual(['https://github.com/', 'https://npmjs.com/']);
    const recs = recentSyncRemovals(await get('ts.syncRemovedTabs'), 'dev');
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ index: 1, tab: { url: 'https://vercel.com/' } });
    expect(recentSyncRemovals(await get('ts.syncRemovedTabs'), 'dev', recs[0].removedAt + SYNC_REMOVED_KEEP_MS + 1)).toHaveLength(0);
    // moving between workspaces is not a loss, so it is not recorded
    const npm = fake.tabs.find((t) => t.url === 'https://npmjs.com/')!;
    await fake.chrome.tabs.group({ groupId: groupOf('Job Search').id, tabIds: [npm.id] });
    await handleTabGroupChange((await fake.chrome.tabs.get(npm.id)) as chrome.tabs.Tab, 0);
    expect(await get('ts.syncRemovedTabs')).toHaveLength(1);
    expect(await restoreSyncRemoval(recs[0].id)).toBe('restored');
    expect(await savedUrls('dev')).toEqual(['https://github.com/', 'https://vercel.com/']);
    expect(await get('ts.syncRemovedTabs')).toHaveLength(0);
  });
});
