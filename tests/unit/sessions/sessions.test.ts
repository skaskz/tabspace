import { afterEach, describe, expect, it, vi } from 'vitest';
import { get, set } from '@/storage/store';
import { addTabsToWorkspace, openWorkspace, restoreSession, saveCurrentWindow, saveCurrentWindowDetailed } from '@/services/sessions';
import { applySmartGroupingToWindow, createGroup, NOT_IN_EXTENSION } from '@/services/tabs';
import { toDateKey } from '@/utils/date';
import type { SavedSession } from '@/types/models';
import { createFakeChrome } from './fakeChrome';

afterEach(() => {
  vi.unstubAllGlobals();
});

const savedSession: SavedSession = {
  id: 's1',
  name: 'Development',
  workspaceId: 'w1',
  createdAt: 1,
  updatedAt: 1,
  groups: [{ id: 'g1', title: 'Repos', color: 'blue', collapsed: true }],
  tabs: [
    { id: 'a', url: 'https://github.com/me/tabspace', title: 'tabspace', pinned: false, groupId: 'g1' },
    { id: 'b', url: 'chrome://extensions', title: 'ext', pinned: false },
    { id: 'c', url: 'https://mail.google.com/', title: 'mail', pinned: true },
    { id: 'd', url: 'https://vercel.com/', title: 'vercel', pinned: false, groupId: 'g1' },
  ],
};

function stubWindow() {
  const fake = createFakeChrome({
    windowId: 1,
    groups: [{ id: 7, title: 'AI', color: 'cyan', collapsed: false }],
    tabs: [
      { url: 'https://claude.ai/new', title: 'Claude', pinned: false, groupId: 7, highlighted: true },
      { url: 'chrome://newtab/', title: 'New Tab', pinned: false, groupId: -1 },
      { url: 'https://youtube.com/', title: 'YouTube', pinned: true, groupId: -1, highlighted: true },
      { url: 'https://github.com/', title: 'GitHub', pinned: false, groupId: -1 },
    ],
  });
  vi.stubGlobal('chrome', fake.chrome);
  return fake;
}

describe('outside the extension', () => {
  it('throws a friendly error', async () => {
    await expect(saveCurrentWindow({})).rejects.toThrow(NOT_IN_EXTENSION);
    await expect(createGroup([1], { title: 'x', color: 'blue' })).rejects.toThrow();
  });
});

describe('saveCurrentWindow', () => {
  it('saves the last focused window, skips unrestorable tabs and records workspace activity', async () => {
    stubWindow();
    await set('ts.workspaces', [{ id: 'w1', name: 'Research', icon: 'search', order: 0, createdAt: 0, updatedAt: 0 }]);
    const res = await saveCurrentWindowDetailed({ workspaceId: 'w1' });
    expect(res.skipped).toBe(1);
    expect(res.session?.tabs.map((t) => t.url)).toEqual(['https://claude.ai/new', 'https://youtube.com/', 'https://github.com/']);
    expect(res.session?.groups).toEqual([expect.objectContaining({ title: 'AI', color: 'cyan' })]);
    expect(res.session?.name).toMatch(/^Research — /);
    expect((await get('ts.sessions'))[0].workspaceId).toBe('w1');
    expect((await get('ts.workspaceActivity'))[toDateKey()]).toEqual({ w1: 1 });
  });

  it('saves only highlighted tabs and works unassigned', async () => {
    stubWindow();
    const s = await saveCurrentWindow({ onlySelected: true, name: 'Picked' });
    expect(s?.workspaceId).toBeUndefined();
    expect(s?.name).toBe('Picked');
    expect(s?.tabs).toHaveLength(2);
    expect(await get('ts.workspaceActivity')).toEqual({});
  });
});

describe('restoreSession', () => {
  it('new-window: creates the window with the first URL, then the rest, then groups', async () => {
    const fake = stubWindow();
    await set('ts.sessions', [savedSession]);
    const res = await restoreSession('s1', 'new-window');
    expect(res).toMatchObject({ opened: 3, skipped: 1, groups: 1, closed: 0 });
    // pinned first
    expect(fake.chrome.windows.create).toHaveBeenCalledWith({ url: 'https://mail.google.com/', focused: true });
    const firstTabId = (await fake.chrome.windows.create.mock.results[0].value).tabs[0].id;
    expect(fake.chrome.tabs.update).toHaveBeenCalledWith(firstTabId, { pinned: true });
    const creates = fake.chrome.tabs.create.mock.calls.map((c) => c[0]);
    expect(creates.map((c) => c.url)).toEqual(['https://github.com/me/tabspace', 'https://vercel.com/']);
    expect(creates.every((c) => c.active === false && c.windowId === res.windowId)).toBe(true);
    expect(fake.chrome.tabs.group).toHaveBeenCalledTimes(1);
    const groupArg = fake.chrome.tabs.group.mock.calls[0][0];
    expect(groupArg.tabIds).toHaveLength(2);
    expect(groupArg.createProperties).toEqual({ windowId: res.windowId });
    expect(fake.chrome.tabGroups.update).toHaveBeenCalledWith(expect.any(Number), { title: 'Repos', color: 'blue', collapsed: true });
    expect(fake.chrome.tabs.remove).not.toHaveBeenCalled();
  });

  it('current-window: appends without closing anything', async () => {
    const fake = stubWindow();
    await set('ts.sessions', [savedSession]);
    const res = await restoreSession('s1', 'current-window');
    expect(res.windowId).toBe(1);
    expect(fake.chrome.windows.create).not.toHaveBeenCalled();
    const creates = fake.chrome.tabs.create.mock.calls.map((c) => c[0]);
    expect(creates).toHaveLength(3);
    expect(creates[0]).toMatchObject({ url: 'https://mail.google.com/', pinned: true, active: true, index: 4 });
    expect(creates.slice(1).every((c) => c.active === false)).toBe(true);
    expect(fake.chrome.tabs.remove).not.toHaveBeenCalled();
    expect(fake.tabs.filter((t) => t.windowId === 1)).toHaveLength(7);
  });

  it('replace: archives the current window before opening and closes old tabs last', async () => {
    const fake = stubWindow();
    const oldIds = fake.tabs.map((t) => t.id);
    await set('ts.sessions', [savedSession]);
    const res = await restoreSession('s1', 'replace');
    const sessions = await get('ts.sessions');
    const archived = sessions.find((s) => s.archived);
    expect(archived).toBeDefined();
    expect(archived!.name).toMatch(/^Archived /);
    expect(archived!.tabs.map((t) => t.url)).toEqual(['https://claude.ai/new', 'https://youtube.com/', 'https://github.com/']);
    expect(res.archivedSessionId).toBe(archived!.id);
    // chrome://newtab can't be archived, so it stays open
    expect(res.closed).toBe(3);
    expect(res.kept).toBe(1);
    expect(fake.chrome.tabs.remove).toHaveBeenCalledWith(oldIds.filter((_, i) => i !== 1));
    // order: creates/groups happen before the remove
    const removeAt = fake.log.findIndex((l) => l.startsWith('tabs.remove'));
    expect(removeAt).toBe(fake.log.length - 1);
    expect(fake.log.filter((l) => l.startsWith('tabs.create'))).toHaveLength(3);
    expect(fake.tabs.map((t) => t.url)).toEqual(['chrome://newtab/', 'https://mail.google.com/', 'https://github.com/me/tabspace', 'https://vercel.com/']);
  });

  it('replace keeps every tab open when nothing could be archived', async () => {
    const fake = createFakeChrome({
      windowId: 1,
      tabs: [
        { url: 'chrome://settings/', title: 'Settings', pinned: false, groupId: -1 },
        { url: 'file:///C:/notes.txt', title: 'notes', pinned: false, groupId: -1 },
      ],
    });
    vi.stubGlobal('chrome', fake.chrome);
    await set('ts.sessions', [savedSession]);
    const res = await restoreSession('s1', 'replace');
    expect(res.archivedSessionId).toBeUndefined();
    expect(res).toMatchObject({ closed: 0, kept: 2, opened: 3 });
    expect(fake.chrome.tabs.remove).not.toHaveBeenCalled();
    expect((await get('ts.sessions')).some((s) => s.archived)).toBe(false);
    expect(fake.tabs.map((t) => t.url)).toEqual(expect.arrayContaining(['chrome://settings/', 'file:///C:/notes.txt']));
  });

  it('replace never closes the Tabspace tab itself', async () => {
    const fake = stubWindow();
    const own = fake.tabs[1].id;
    fake.chrome.tabs.getCurrent.mockResolvedValue({ id: own } as never);
    await set('ts.sessions', [savedSession]);
    await restoreSession('s1', 'replace');
    expect(fake.chrome.tabs.remove.mock.calls[0][0]).not.toContain(own);
  });

  it('throws when nothing is restorable', async () => {
    stubWindow();
    await set('ts.sessions', [{ ...savedSession, tabs: [savedSession.tabs[1]] }]);
    await expect(restoreSession('s1')).rejects.toThrow(/can’t be reopened/);
    await expect(restoreSession('missing')).rejects.toThrow(/no longer exists/);
  });

  it('batches hundreds of tabs and keeps their order', async () => {
    const fake = stubWindow();
    const many = Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, url: `https://example.com/${i}`, title: `${i}`, pinned: false }));
    await set('ts.sessions', [{ ...savedSession, groups: [], tabs: many }]);
    const res = await restoreSession('s1', 'new-window');
    expect(res.opened).toBe(300);
    const win = fake.tabs.filter((t) => t.windowId === res.windowId).sort((a, b) => a.index - b.index);
    expect(win.map((t) => t.url)).toEqual(many.map((t) => t.url));
  });
});

describe('target window (BUG-SS1)', () => {
  it('save and replace act on the window containing the Tabspace tab, not the last focused one', async () => {
    const fake = stubWindow();
    const other = fake.addWindow(['https://example.com/other']);
    fake.state.lastFocused = other;
    const own = fake.tabs[1];
    fake.chrome.tabs.getCurrent.mockResolvedValue({ id: own.id, windowId: 1 } as never);
    const saved = await saveCurrentWindow({ name: 'mine' });
    expect(saved?.tabs.map((t) => t.url)).toContain('https://claude.ai/new');
    await set('ts.sessions', [savedSession]);
    const res = await restoreSession('s1', 'replace');
    expect(res.windowId).toBe(1);
    expect(fake.tabs.filter((t) => t.windowId === other).map((t) => t.url)).toEqual(['https://example.com/other']);
    expect(fake.chrome.tabs.remove.mock.calls[0][0]).not.toContain(own.id);
  });

  it('popup / side panel: uses windows.getCurrent before last focused', async () => {
    const fake = stubWindow();
    const other = fake.addWindow(['https://example.com/other']);
    fake.state.lastFocused = other;
    fake.chrome.windows.getCurrent.mockImplementation(async () => fake.chrome.windows.get(1));
    const saved = await saveCurrentWindow({});
    expect(saved?.tabs.map((t) => t.url)).toContain('https://github.com/');
  });

  it('falls back to the last focused normal window', async () => {
    const fake = stubWindow();
    const other = fake.addWindow(['https://example.com/other']);
    fake.state.lastFocused = other;
    const saved = await saveCurrentWindow({});
    expect(saved?.tabs.map((t) => t.url)).toEqual(['https://example.com/other']);
  });

  it('honours an explicit windowId', async () => {
    const fake = stubWindow();
    const other = fake.addWindow(['https://example.com/other']);
    const saved = await saveCurrentWindow({ windowId: other });
    expect(saved?.tabs.map((t) => t.url)).toEqual(['https://example.com/other']);
  });
});

describe('openWorkspace', () => {
  it('restores the most recent non-archived session', async () => {
    const fake = stubWindow();
    await set('ts.workspaces', [{ id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 0, updatedAt: 0 }]);
    await set('ts.sessions', [
      { ...savedSession, id: 'old', updatedAt: 1, tabs: [{ id: 'x', url: 'https://old.com', title: 'old', pinned: false }], groups: [] },
      { ...savedSession, id: 'arch', updatedAt: 50, archived: true, tabs: [{ id: 'y', url: 'https://archived.com', title: 'a', pinned: false }], groups: [] },
      { ...savedSession, id: 'new', updatedAt: 10, tabs: [{ id: 'z', url: 'https://new.com', title: 'new', pinned: false }], groups: [] },
    ]);
    await openWorkspace('w1', 'new-window');
    expect(fake.chrome.windows.create).toHaveBeenCalledWith({ url: 'https://new.com', focused: true });
  });

  it('gives a friendly error when the workspace has no sessions', async () => {
    stubWindow();
    await set('ts.workspaces', [{ id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 0, updatedAt: 0 }]);
    await expect(openWorkspace('w1')).rejects.toThrow(/has no saved tabs yet/);
  });
});

describe('addTabsToWorkspace', () => {
  it('appends new URLs to the latest session without duplicates', async () => {
    stubWindow();
    await set('ts.sessions', [savedSession]);
    const res = await addTabsToWorkspace(
      [
        { index: 0, url: 'https://github.com/me/tabspace', title: 'dup', pinned: false },
        { index: 1, url: 'https://notion.so/page', title: 'Notion', pinned: false },
        { index: 2, url: 'chrome://history', title: 'h', pinned: false },
      ],
      'w1',
    );
    expect(res).toEqual({ added: 1, skipped: 1 });
    expect((await get('ts.sessions'))[0].tabs.map((t) => t.url)).toContain('https://notion.so/page');
  });
});

describe('tabs service', () => {
  it('createGroup leaves pinned tabs out and sets title/colour', async () => {
    const fake = stubWindow();
    const [claude, , yt, gh] = fake.tabs;
    const res = await createGroup([yt.id, gh.id, claude.id], { title: ' Research ', color: 'green' });
    expect(res.skippedPinned).toBe(1);
    expect(fake.chrome.tabs.group).toHaveBeenCalledWith({ tabIds: [gh.id, claude.id], createProperties: { windowId: 1 } });
    expect(fake.chrome.tabGroups.update).toHaveBeenCalledWith(res.groupId, { title: 'Research', color: 'green', collapsed: false });
  });

  it('applySmartGroupingToWindow is a no-op unless smart grouping is enabled', async () => {
    const fake = stubWindow();
    expect(await applySmartGroupingToWindow(1)).toBe(0);
    const s = await get('ts.settings');
    await set('ts.settings', { ...s, smartGrouping: { enabled: true, autoApply: true, rules: [{ id: 'r', pattern: 'github', groupTitle: 'Code', color: 'blue' }] } });
    expect(await applySmartGroupingToWindow(1)).toBe(1);
    expect(fake.chrome.tabGroups.update).toHaveBeenCalledWith(expect.any(Number), { title: 'Code', color: 'blue' });
  });
});
