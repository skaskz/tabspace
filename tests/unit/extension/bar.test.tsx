import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { set } from '@/storage/store';
import { DEFAULT_SETTINGS } from '@/storage/schema';
import { barItems, fitCount, folderContents, isBarModeMessage, shortTitle, siteDisabled, siteKey, websiteBarAllowed } from '@/extension/bar/logic';
import { BAR_PERMISSIONS, BAR_SCRIPT_ID, syncBarRegistration, type BarRegistrationDeps } from '@/extension/bar/register';
import { TabspaceBar, openBarLink } from '@/extension/bar/TabspaceBar';
import { folderOptions } from '@/extension/bar/BookmarkButton';
import type { Bookmark, BookmarkFolder } from '@/types/models';

const bm = (o: Partial<Bookmark>): Bookmark => ({ id: o.id ?? Math.random().toString(36), createdAt: 1, updatedAt: 1, url: 'https://example.com/', title: 'Example', tags: [], favorite: false, ...o });
const folder = (o: Partial<BookmarkFolder>): BookmarkFolder => ({ id: o.id ?? Math.random().toString(36), createdAt: 1, updatedAt: 1, name: 'Folder', order: 0, ...o });

describe('fitCount (overflow measurement)', () => {
  it('fits everything when there is room', () => {
    expect(fitCount([50, 50, 50], 200, 30, 4)).toBe(3);
  });
  it('keeps room for the » button when items overflow', () => {
    // 50+4+50+4+50 = 158 fits 160 but the 4th doesn't; » (30) needs 158+4+30 > 160 → drop to 2 (104+4+30=138).
    expect(fitCount([50, 50, 50, 50], 160, 30, 4)).toBe(2);
  });
  it('handles tiny widths and empty lists', () => {
    expect(fitCount([80, 80], 20, 30)).toBe(0);
    expect(fitCount([], 100, 30)).toBe(0);
  });
});

describe('bar content', () => {
  it('lists http(s) favourites then top-level folders (when enabled)', () => {
    const items = barItems(
      [bm({ id: 'a', favorite: true, createdAt: 2 }), bm({ id: 'b', favorite: true, createdAt: 1 }), bm({ id: 'c' }), bm({ id: 'd', favorite: true, url: 'javascript:alert(1)' })],
      [folder({ id: 'f2', order: 2 }), folder({ id: 'f1', order: 1 }), folder({ id: 'sub', parentId: 'f1' })],
      true,
    );
    expect(items.map((i) => (i.kind === 'link' ? i.bookmark.id : i.folder.id))).toEqual(['b', 'a', 'f1', 'f2']);
    expect(barItems([], [folder({})], false)).toEqual([]);
  });
  it('folder contents: sub-folders then links (http(s) only)', () => {
    const c = folderContents('f', [bm({ id: 'x', folderId: 'f', title: 'b' }), bm({ id: 'y', folderId: 'f', title: 'a' }), bm({ id: 'z', folderId: 'f', url: 'file:///x' })], [folder({ id: 's', parentId: 'f' })]);
    expect(c.folders.map((f) => f.id)).toEqual(['s']);
    expect(c.links.map((b) => b.id)).toEqual(['y', 'x']);
  });
  it('folder picker options are in tree order with depth', () => {
    const opts = folderOptions([folder({ id: 'a', name: 'A', order: 1 }), folder({ id: 'b', name: 'B', parentId: 'a' }), folder({ id: 'c', name: 'C', order: 0 })]);
    expect(opts.map((o) => `${o.depth}${o.folder.name}`)).toEqual(['0C', '0A', '1B']);
  });
  it('short titles fall back to the hostname and truncate', () => {
    expect(shortTitle({ title: '', url: 'https://www.github.com/x' })).toBe('github.com');
    expect(shortTitle({ title: 'A very long bookmark title indeed', url: 'https://x.com' }, 10)).toBe('A very lo…');
  });
});

describe('website bar rules & messages', () => {
  const bar = { ...DEFAULT_SETTINGS.tabspaceBar, onWebsites: true, disabledSites: ['youtube.com'] };
  it('only on http(s), never when off, never on disabled sites (incl. subdomains)', () => {
    expect(websiteBarAllowed(bar, 'https://example.com/a')).toBe(true);
    expect(websiteBarAllowed(bar, 'https://m.youtube.com/watch')).toBe(false);
    expect(websiteBarAllowed({ ...bar, onWebsites: false }, 'https://example.com')).toBe(false);
    expect(websiteBarAllowed(bar, 'chrome://settings')).toBe(false);
    expect(siteKey('https://WWW.Example.com/x')).toBe('example.com');
    expect(siteDisabled('notyoutube.com', ['youtube.com'])).toBe(false);
  });
  it('accepts only exact mode messages', () => {
    expect(isBarModeMessage({ type: 'tsbar:mode', mode: 'expanded' })).toBe(true);
    expect(isBarModeMessage({ type: 'tsbar:mode', mode: 'huge' })).toBe(false);
    expect(isBarModeMessage({ type: 'tsbar:mode', mode: 'bar', height: 9999 })).toBe(false);
    expect(isBarModeMessage('tsbar:mode')).toBe(false);
    expect(isBarModeMessage(null)).toBe(false);
  });
});

describe('content script registration', () => {
  function deps(granted: boolean, registered: boolean) {
    const reg = new Set<string>(registered ? [BAR_SCRIPT_ID] : []);
    const d: BarRegistrationDeps & { reg: Set<string> } = {
      reg,
      contains: vi.fn(async () => granted),
      scripting: {
        registerContentScripts: vi.fn(async (s: chrome.scripting.RegisteredContentScript[]) => void s.forEach((x) => reg.add(x.id))),
        unregisterContentScripts: vi.fn(async (f?: { ids?: string[] }) => void f?.ids?.forEach((id) => reg.delete(id))),
        getRegisteredContentScripts: vi.fn(async (f?: { ids?: string[] }) => [...reg].filter((id) => !f?.ids || f.ids.includes(id)).map((id) => ({ id }) as chrome.scripting.RegisteredContentScript)),
      } as unknown as BarRegistrationDeps['scripting'],
    };
    return d;
  }

  it('registers the http(s) top-frame script once when enabled and granted', async () => {
    const d = deps(true, false);
    expect(await syncBarRegistration(true, d)).toBe('registered');
    expect(d.contains).toHaveBeenCalledWith(BAR_PERMISSIONS);
    expect(d.scripting!.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ id: BAR_SCRIPT_ID, js: ['bar-content.js'], matches: ['https://*/*', 'http://*/*'], allFrames: false, runAt: 'document_idle' }),
    ]);
    expect(await syncBarRegistration(true, d)).toBe('registered');
    expect(d.scripting!.registerContentScripts).toHaveBeenCalledTimes(1);
  });

  it('unregisters when turned off or when the permission is gone', async () => {
    let d = deps(true, true);
    expect(await syncBarRegistration(false, d)).toBe('unregistered');
    expect(d.reg.size).toBe(0);
    d = deps(false, true);
    expect(await syncBarRegistration(true, d)).toBe('no-permission');
    expect(d.reg.size).toBe(0);
  });

  it('never runs anything when scripting is unavailable (permission never granted)', async () => {
    expect(await syncBarRegistration(true, { contains: async () => true, scripting: undefined })).toBe('no-permission');
    expect(await syncBarRegistration(false, { contains: async () => false, scripting: undefined })).toBe('unregistered');
  });
});

describe('TabspaceBar component', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function seed() {
    await set('ts.bookmarks', [
      bm({ id: 'g', title: 'GitHub', url: 'https://github.com/', favorite: true }),
      bm({ id: 'm', title: 'MDN', url: 'https://developer.mozilla.org/', folderId: 'dev' }),
      bm({ id: 'r', title: 'Roblox docs', url: 'https://create.roblox.com/', folderId: 'games' }),
    ]);
    await set('ts.bookmarkFolders', [folder({ id: 'dev', name: 'Dev tools' }), folder({ id: 'games', name: 'Games', parentId: 'dev' })]);
    await set('ts.workspaces', [{ id: 'w', name: 'Job hunt', icon: 'briefcase', order: 0, createdAt: 1, updatedAt: 1 }]);
  }

  it('renders favourites, folders (nested drill-down) and the workspaces menu', async () => {
    await seed();
    render(<TabspaceBar />);
    const bar = screen.getByRole('toolbar', { name: 'Tabspace Bar' });
    expect(await within(bar).findByRole('link', { name: /GitHub/ })).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Dev tools' }));
    const menu = screen.getByRole('menu', { name: 'Dev tools' });
    expect(within(menu).getByRole('menuitem', { name: /MDN/ })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Games/ }));
    expect(within(menu).getByRole('menuitem', { name: /Roblox docs/ })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Back/ }));
    expect(within(menu).getByRole('menuitem', { name: /MDN/ })).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(within(bar).getByRole('button', { name: 'Workspaces' }));
    expect(within(screen.getByRole('menu', { name: 'Workspaces' })).getByRole('menuitem', { name: /Job hunt/ })).toBeInTheDocument();
  });

  it('hides the bookmark button without a page (New Tab) and shows it for a website page', async () => {
    await seed();
    const { rerender } = render(<TabspaceBar />);
    expect(screen.queryByRole('button', { name: /Bookmark this page/ })).toBeNull();
    rerender(<TabspaceBar surface="frame" page={{ url: 'https://github.com/', title: 'GitHub' }} />);
    expect(await screen.findByRole('button', { name: 'Edit bookmark for this page' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('arrow keys move focus along the bar (roving tabindex)', async () => {
    await seed();
    render(<TabspaceBar />);
    const logo = screen.getByRole('button', { name: 'Open Tabspace dashboard' });
    await screen.findByRole('link', { name: /GitHub/ });
    expect(logo.tabIndex).toBe(0);
    logo.focus();
    fireEvent.keyDown(logo, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /GitHub/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Workspaces' }));
  });

  it('notifies when a menu opens/closes (website frame expansion)', async () => {
    await seed();
    const onMenu = vi.fn();
    render(<TabspaceBar onMenuOpenChange={onMenu} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dev tools' }));
    expect(onMenu).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(onMenu).toHaveBeenLastCalledWith(false);
  });
});

describe('openBarLink', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('same tab by default; Ctrl/⌘/middle-click opens a background tab; never non-http(s)', async () => {
    const tabs = { update: vi.fn(async () => undefined), create: vi.fn(async () => undefined) };
    vi.stubGlobal('chrome', { tabs });
    await openBarLink('https://github.com/', false, 7);
    expect(tabs.update).toHaveBeenCalledWith(7, { url: 'https://github.com/' });
    await openBarLink('https://github.com/', true, 7);
    expect(tabs.create).toHaveBeenCalledWith({ url: 'https://github.com/', active: false });
    await openBarLink('javascript:alert(1)', false, 7);
    expect(tabs.update).toHaveBeenCalledTimes(1);
  });
});
