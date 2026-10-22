import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTE_BOOKMARK_TITLE, addNoteBookmark, findBookmarksBar } from '@/extension/shared/noteBookmark';

function install(opts: { grant: boolean; existing?: boolean }) {
  const created: chrome.bookmarks.BookmarkCreateArg[] = [];
  const fake = {
    runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` },
    permissions: { request: vi.fn(async () => opts.grant), remove: vi.fn(async () => true), contains: vi.fn(async () => false) },
    bookmarks: {
      search: vi.fn(async () => (opts.existing ? [{ id: '9' }] : [])),
      getTree: vi.fn(async () => [{ id: '0', children: [{ id: '1', title: 'Bookmarks bar' }, { id: '2', title: 'Other' }] }]),
      create: vi.fn(async (d: chrome.bookmarks.BookmarkCreateArg) => void created.push(d)),
    },
  };
  vi.stubGlobal('chrome', fake);
  return { fake, created };
}

afterEach(() => vi.unstubAllGlobals());

describe('"+ New Note" bookmark', () => {
  it('requests the permission synchronously, creates the bookmark on the bar, then releases the permission', async () => {
    const { fake, created } = install({ grant: true });
    const p = addNoteBookmark(false);
    expect(fake.permissions.request).toHaveBeenCalledWith({ permissions: ['bookmarks'] }); // inside the gesture
    expect(await p).toBe('added');
    expect(created).toEqual([{ parentId: '1', title: NOTE_BOOKMARK_TITLE, url: 'chrome-extension://abc/popup.html#note' }]);
    expect(fake.permissions.remove).toHaveBeenCalledWith({ permissions: ['bookmarks'] });
  });

  it('keeps a permission the user had already granted for other features', async () => {
    const { fake } = install({ grant: true });
    await addNoteBookmark(true);
    expect(fake.permissions.remove).not.toHaveBeenCalled();
  });

  it('does nothing without consent, and does not duplicate', async () => {
    let env = install({ grant: false });
    expect(await addNoteBookmark(false)).toBe('denied');
    expect(env.fake.bookmarks.create).not.toHaveBeenCalled();
    env = install({ grant: true, existing: true });
    expect(await addNoteBookmark(false)).toBe('exists');
    expect(env.fake.bookmarks.create).not.toHaveBeenCalled();
    expect(env.fake.permissions.remove).toHaveBeenCalled();
  });

  it('finds the bookmarks bar by folderType when Chrome provides it', () => {
    const tree = [{ id: '0', title: '', children: [{ id: '5', title: 'Other', folderType: 'other' }, { id: '6', title: 'Bar', folderType: 'bookmarks-bar' }] }] as unknown as chrome.bookmarks.BookmarkTreeNode[];
    expect(findBookmarksBar(tree)?.id).toBe('6');
  });
});
