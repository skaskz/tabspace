import { afterEach, describe, expect, it, vi } from 'vitest';
import { get, set } from '@/storage/store';
import { addSavedTab, describeRemoval, mergeSavedTabs, moveSavedTab, pruneGroups, removeSavedTab, restoreRemovedTab } from '@/features/workspaces/savedTabs';
import { planRestore } from '@/features/tabs/serialize';
import { addCurrentTabToWorkspace, addWorkspaceUrl, moveWorkspaceTab, openWorkspace, removeWorkspaceTab, saveSelectionToWorkspace, undoRemoveWorkspaceTab } from '@/services/sessions';
import type { SavedSession, SavedTab } from '@/types/models';
import { createFakeChrome } from '../sessions/fakeChrome';

afterEach(() => vi.unstubAllGlobals());

const tab = (id: string, groupId?: string, pinned = false): SavedTab => ({ id, url: `https://${id}.example.com/`, title: id, pinned, ...(groupId ? { groupId } : {}) });
const base = (): Pick<SavedSession, 'tabs' | 'groups'> => ({
  groups: [
    { id: 'G', title: 'Research', color: 'blue', collapsed: false },
    { id: 'H', title: 'Build', color: 'red', collapsed: true },
  ],
  tabs: [tab('a', 'G'), tab('b', 'G'), tab('c'), tab('d', 'H'), tab('e')],
});
const ids = (s: Pick<SavedSession, 'tabs'>) => s.tabs.map((t) => t.id);

describe('saved-tab editing (pure)', () => {
  it('remove drops the tab and an emptied group, keeps other groups', () => {
    const s = removeSavedTab(base(), 'd');
    expect(ids(s)).toEqual(['a', 'b', 'c', 'e']);
    expect(s.groups.map((g) => g.id)).toEqual(['G']);
    const s2 = removeSavedTab(s, 'a');
    expect(s2.groups.map((g) => g.id)).toEqual(['G']);
    expect(s2.tabs[0]).toMatchObject({ id: 'b', groupId: 'G' });
  });

  it('undo puts a removed tab back at its original index, restoring an emptied group', () => {
    const s0 = base();
    const r = describeRemoval(s0, 'd')!;
    expect(r).toMatchObject({ index: 3, group: { id: 'H' } });
    const removed = removeSavedTab(s0, 'd');
    expect(removed.groups.map((g) => g.id)).toEqual(['G']);
    const back = restoreRemovedTab(removed, r);
    expect(ids(back)).toEqual(ids(s0));
    expect(back.tabs[3].groupId).toBe('H');
    expect(back.groups.map((g) => g.id).sort()).toEqual(['G', 'H']);
    // idempotent, and clamps when the list shrank meanwhile
    expect(restoreRemovedTab(back, r)).toBe(back);
    const shrunk = removeSavedTab(removeSavedTab(removed, 'e'), 'c');
    expect(ids(restoreRemovedTab(shrunk, r))).toEqual(['a', 'b', 'd']);
  });

  it('remove of an unknown id returns the same object (no write)', () => {
    const s = base();
    expect(removeSavedTab(s, 'zzz')).toBe(s);
  });

  it('add appends an ungrouped http(s) tab and rejects other schemes', () => {
    const s = addSavedTab(base(), { id: 'n', url: 'https://new.example.com/', title: ' New ' });
    expect(s.tabs.at(-1)).toEqual({ id: 'n', url: 'https://new.example.com/', title: 'New', pinned: false });
    expect(() => addSavedTab(base(), { id: 'x', url: 'javascript:alert(1)', title: 'x' })).toThrow(/web pages/);
  });

  it('move reorders the flat list', () => {
    expect(ids(moveSavedTab(base(), 'e', 0))).toEqual(['e', 'a', 'b', 'c', 'd']);
    expect(ids(moveSavedTab(base(), 'a', 99))).toEqual(['b', 'c', 'd', 'e', 'a']);
  });

  it('moving between two members of a group joins it; moving away from its group leaves it', () => {
    const joined = moveSavedTab(base(), 'c', 1); // a, c, b
    expect(joined.tabs[1]).toMatchObject({ id: 'c', groupId: 'G' });
    const left = moveSavedTab(base(), 'a', 4); // b c d e a
    expect(left.tabs.at(-1)!.groupId).toBeUndefined();
    expect(left.groups.map((g) => g.id).sort()).toEqual(['G', 'H']);
    const lastOfH = moveSavedTab(base(), 'd', 0); // d alone, away from H -> ungrouped, H removed
    expect(lastOfH.tabs[0].groupId).toBeUndefined();
    expect(lastOfH.groups.map((g) => g.id)).toEqual(['G']);
  });

  it('pruneGroups strips groups from pinned tabs and unknown ids', () => {
    const s = pruneGroups({ groups: [{ id: 'G', title: 'x', color: 'blue', collapsed: false }], tabs: [tab('a', 'G', true), tab('b', 'nope')] });
    expect(s.tabs.every((t) => !t.groupId)).toBe(true);
    expect(s.groups).toEqual([]);
  });

  it('merge skips duplicate URLs and reuses a same-named group', () => {
    const m = mergeSavedTabs(base(), {
      groups: [{ id: 'X', title: 'research', color: 'blue', collapsed: false }],
      tabs: [{ ...tab('a'), id: 'a2' }, { ...tab('f', 'X'), id: 'f' }],
    });
    expect(m.added).toBe(1);
    expect(m.duplicates).toBe(1);
    expect(m.session.tabs.at(-1)).toMatchObject({ id: 'f', groupId: 'G' });
    expect(m.session.groups).toHaveLength(2);
  });

  it('planRestore keeps non-contiguous group members together at the first member', () => {
    const plan = planRestore({ groups: base().groups, tabs: [tab('a', 'G'), tab('c'), tab('b', 'G'), tab('e')] });
    expect(plan.tabs.map((t) => t.savedTabId)).toEqual(['a', 'b', 'c', 'e']);
    expect(plan.groups[0].tabIndexes).toEqual([0, 1]);
  });
});

describe('saved-tab editing (store + chrome)', () => {
  const ws = { id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 0, updatedAt: 0 };
  const other: SavedSession = { id: 'other', name: 'Other', workspaceId: 'w2', createdAt: 1, updatedAt: 1, groups: [], tabs: [tab('z')] };

  it('creates exactly one session for a workspace, even with concurrent adds, and never touches other sessions', async () => {
    await set('ts.workspaces', [ws]);
    await set('ts.sessions', [other]);
    await Promise.all([addWorkspaceUrl('w1', 'github.com/me/tabspace'), addWorkspaceUrl('w1', 'https://vercel.com/')]);
    const sessions = await get('ts.sessions');
    const mine = sessions.filter((s) => s.workspaceId === 'w1');
    expect(mine).toHaveLength(1);
    expect(mine[0].tabs.map((t) => t.url).sort()).toEqual(['https://github.com/me/tabspace', 'https://vercel.com/']);
    expect(sessions.find((s) => s.id === 'other')).toEqual(other);
  });

  it('removeWorkspaceTab returns undo info and undoRemoveWorkspaceTab restores the original position', async () => {
    await set('ts.workspaces', [ws]);
    await set('ts.sessions', [{ id: 'cur', name: 'cur', workspaceId: 'w1', createdAt: 2, updatedAt: 2, ...base() }]);
    const removed = await removeWorkspaceTab('w1', 'b');
    expect(removed).toMatchObject({ index: 1, tab: { id: 'b' } });
    expect(ids((await get('ts.sessions'))[0])).toEqual(['a', 'c', 'd', 'e']);
    await undoRemoveWorkspaceTab('w1', removed!);
    const [s] = await get('ts.sessions');
    expect(ids(s)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(s.tabs[1].groupId).toBe('G');
    expect(await removeWorkspaceTab('w1', 'nope')).toBeUndefined();
  });

  it('warns on duplicates instead of adding, unless allowed; rejects invalid input', async () => {
    await set('ts.workspaces', [ws]);
    await addWorkspaceUrl('w1', 'https://github.com/');
    expect((await addWorkspaceUrl('w1', 'github.com')).status).toBe('duplicate');
    expect((await get('ts.sessions'))[0].tabs).toHaveLength(1);
    expect((await addWorkspaceUrl('w1', 'github.com', { allowDuplicate: true })).status).toBe('added');
    expect((await get('ts.sessions'))[0].tabs).toHaveLength(2);
    await expect(addWorkspaceUrl('w1', 'not a url')).rejects.toThrow(/valid web address/);
    await expect(addWorkspaceUrl('w1', 'file:///C:/x')).rejects.toThrow();
    await expect(addWorkspaceUrl('missing', 'github.com')).rejects.toThrow(/no longer exists/);
  });

  it('remove and move edit the latest session only and never call Chrome', async () => {
    const fake = createFakeChrome({ windowId: 1, tabs: [{ url: 'https://a.example.com/', title: 'a', pinned: false, groupId: -1 }] });
    vi.stubGlobal('chrome', fake.chrome);
    const old: SavedSession = { id: 'old', name: 'old', workspaceId: 'w1', createdAt: 1, updatedAt: 1, groups: [], tabs: [tab('q')] };
    const cur: SavedSession = { id: 'cur', name: 'cur', workspaceId: 'w1', createdAt: 2, updatedAt: 2, ...base() };
    await set('ts.workspaces', [ws]);
    await set('ts.sessions', [old, cur]);
    await removeWorkspaceTab('w1', 'd');
    await moveWorkspaceTab('w1', 'e', 0);
    const sessions = await get('ts.sessions');
    expect(sessions.find((s) => s.id === 'old')).toEqual(old);
    expect(ids(sessions.find((s) => s.id === 'cur')!)).toEqual(['e', 'a', 'b', 'c']);
    expect(await get('ts.workspaces')).toHaveLength(1);
    expect(fake.chrome.tabs.remove).not.toHaveBeenCalled();
    expect(fake.chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('saves only selected tabs with their group info; replace keeps the previous list as history; merge dedupes', async () => {
    const fake = createFakeChrome({
      windowId: 1,
      groups: [{ id: 7, title: 'AI', color: 'cyan', collapsed: false }],
      tabs: [
        { url: 'https://claude.ai/new', title: 'Claude', pinned: false, groupId: 7 },
        { url: 'https://gemini.google.com/', title: 'Gemini', pinned: false, groupId: 7 },
        { url: 'https://github.com/', title: 'GitHub', pinned: false, groupId: -1 },
      ],
    });
    vi.stubGlobal('chrome', fake.chrome);
    await set('ts.workspaces', [ws]);
    const [claude, , gh] = fake.tabs;
    const groups = [{ id: 7, title: 'AI', color: 'cyan', collapsed: false }];
    const r1 = await saveSelectionToWorkspace('w1', [claude, gh], groups, 'replace');
    expect(r1.saved).toBe(2);
    expect(r1.historyId).toBeUndefined();
    let [s] = await get('ts.sessions');
    expect(s.tabs.map((t) => t.url)).toEqual(['https://claude.ai/new', 'https://github.com/']);
    expect(s.groups).toEqual([expect.objectContaining({ title: 'AI', color: 'cyan' })]);
    expect(s.tabs[0].groupId).toBe(s.groups[0].id);

    const r2 = await saveSelectionToWorkspace('w1', fake.tabs, groups, 'merge');
    expect(r2).toMatchObject({ saved: 1, duplicates: 2 });
    [s] = await get('ts.sessions');
    expect(s.tabs.map((t) => t.url)).toEqual(['https://claude.ai/new', 'https://github.com/', 'https://gemini.google.com/']);
    expect(s.tabs[2].groupId).toBe(s.groups[0].id);

    const r3 = await saveSelectionToWorkspace('w1', [gh], groups, 'replace');
    expect(r3.historyId).toBeDefined();
    const all = await get('ts.sessions');
    expect(all).toHaveLength(2);
    const current = all.find((x) => x.id === s.id)!;
    expect(current.tabs.map((t) => t.url)).toEqual(['https://github.com/']);
    expect(all.find((x) => x.id === r3.historyId)!.tabs).toHaveLength(3);

    await openWorkspace('w1', 'new-window');
    expect(fake.chrome.windows.create).toHaveBeenCalledWith({ url: 'https://github.com/', focused: true });
  });

  it('add current tab picks the active web tab of the Tabspace window, never the Tabspace tab', async () => {
    const fake = createFakeChrome({
      windowId: 1,
      tabs: [
        { url: 'https://github.com/', title: 'GitHub', pinned: false, groupId: -1 },
        { url: 'chrome-extension://abc/dashboard.html', title: 'Tabspace', pinned: false, groupId: -1, active: true },
      ],
    });
    fake.chrome.tabs.getCurrent.mockResolvedValue({ id: fake.tabs[1].id, windowId: 1 } as never);
    vi.stubGlobal('chrome', fake.chrome);
    await set('ts.workspaces', [ws]);
    const r = await addCurrentTabToWorkspace('w1');
    expect(r).toMatchObject({ status: 'added', url: 'https://github.com/', title: 'GitHub' });
  });

  it('opening a workspace whose saved list is empty gives a friendly error', async () => {
    vi.stubGlobal('chrome', createFakeChrome({ windowId: 1, tabs: [] }).chrome);
    await set('ts.workspaces', [ws]);
    await set('ts.sessions', [{ id: 's', name: 's', workspaceId: 'w1', createdAt: 1, updatedAt: 1, groups: [], tabs: [] }]);
    await expect(openWorkspace('w1')).rejects.toThrow(/no saved tabs yet/);
  });
});
