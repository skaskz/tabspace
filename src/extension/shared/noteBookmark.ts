/**
 * Optional "+ New Note" bookmark on the bookmarks bar, pointing at
 * `chrome-extension://<id>/popup.html#note`.
 *
 * - Only on an explicit click: the optional `bookmarks` permission is
 *   requested synchronously inside the click (user gesture), the bookmark is
 *   created, and the permission is released again — unless the user had
 *   already granted it for other features (bookmark import), which we keep.
 * - Chrome opens extension-page bookmarks as a normal tab (they can't open the
 *   toolbar popup); popup.html#note renders as a centred card there.
 */

export const NOTE_BOOKMARK_TITLE = '+ New Note';
const PERM = { permissions: ['bookmarks'] } as chrome.permissions.Permissions;

export type BookmarkResult = 'added' | 'exists' | 'denied' | 'unavailable' | 'error';

export function noteBookmarkUrl(): string {
  return chrome.runtime.getURL('popup.html#note');
}

type Node = chrome.bookmarks.BookmarkTreeNode & { folderType?: string };

/** The bookmarks bar folder: `folderType` (newer Chrome) or the root's first child. */
export function findBookmarksBar(tree: Node[]): Node | undefined {
  const top = (tree[0]?.children ?? []) as Node[];
  return top.find((n) => n.folderType === 'bookmarks-bar') ?? top[0];
}

export async function hasBookmarksPermission(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return false;
  try {
    return await chrome.permissions.contains(PERM);
  } catch {
    return false;
  }
}

/**
 * MUST be called synchronously from a click handler. `hadPermission` must be
 * known beforehand (checking it here would need an await before request()).
 */
export function addNoteBookmark(hadPermission: boolean): Promise<BookmarkResult> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) return Promise.resolve('unavailable');
  const request = chrome.permissions.request(PERM);
  return request.then(
    async (granted): Promise<BookmarkResult> => {
      if (!granted) return 'denied';
      try {
        const url = noteBookmarkUrl();
        const existing = await chrome.bookmarks.search({ url });
        if (existing.length) return 'exists';
        const bar = findBookmarksBar(await chrome.bookmarks.getTree());
        await chrome.bookmarks.create({ parentId: bar?.id, title: NOTE_BOOKMARK_TITLE, url });
        return 'added';
      } catch (e) {
        console.warn('[Tabspace] could not create the bookmark', e);
        return 'error';
      } finally {
        if (!hadPermission) await chrome.permissions.remove(PERM).catch(() => undefined);
      }
    },
    () => 'denied' as const,
  );
}
