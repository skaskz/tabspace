import type { Bookmark, BookmarkFolder, Settings } from '@/types/models';
import { isSafeUrl } from '@/utils/url';

/**
 * Pure Tabspace Bar logic: which chips fit, what goes in the bar, message
 * validation, and which sites the website bar may appear on.
 */

export const BAR_HEIGHT = 34;
/** Height the website iframe grows to while a dropdown/popover is open. */
export const BAR_EXPANDED_HEIGHT = 440;

export type BarMode = 'bar' | 'expanded' | 'collapsed';

/**
 * How many leading items fit in `available` px. If not all fit, room for the
 * overflow button (`reserve`) is kept. `gap` is the space between items.
 */
export function fitCount(widths: number[], available: number, reserve: number, gap = 4): number {
  let used = 0;
  for (let i = 0; i < widths.length; i++) {
    const next = used + (i ? gap : 0) + widths[i];
    if (next > available) {
      // Doesn't all fit: make room for "»" by dropping items until it fits too.
      let n = i;
      let w = used;
      while (n > 0 && w + gap + reserve > available) {
        n--;
        w = widths.slice(0, n).reduce((a, b, k) => a + b + (k ? gap : 0), 0);
      }
      return n;
    }
    used = next;
  }
  return widths.length;
}

export type BarItem = { kind: 'link'; bookmark: Bookmark } | { kind: 'folder'; folder: BookmarkFolder };

/** Favourites (http(s) only, by order of last update) then top-level folders when enabled. */
export function barItems(bookmarks: Bookmark[], folders: BookmarkFolder[], showFolders: boolean): BarItem[] {
  const favs = bookmarks
    .filter((b) => b.favorite && isSafeUrl(b.url))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((bookmark) => ({ kind: 'link' as const, bookmark }));
  const top = showFolders
    ? folders
        .filter((f) => !f.parentId)
        .sort((a, b) => a.order - b.order)
        .map((folder) => ({ kind: 'folder' as const, folder }))
    : [];
  return [...favs, ...top];
}

/** Contents of a folder for its dropdown: sub-folders first, then http(s) links. */
export function folderContents(folderId: string, bookmarks: Bookmark[], folders: BookmarkFolder[]): { folders: BookmarkFolder[]; links: Bookmark[] } {
  return {
    folders: folders.filter((f) => f.parentId === folderId).sort((a, b) => a.order - b.order),
    links: bookmarks.filter((b) => b.folderId === folderId && isSafeUrl(b.url)).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export function shortTitle(b: Pick<Bookmark, 'title' | 'url'>, max = 22): string {
  let t = b.title?.trim();
  if (!t) {
    try {
      t = new URL(b.url).hostname.replace(/^www\./, '');
    } catch {
      t = b.url;
    }
  }
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Normalised site key for disabledSites ("www." stripped, lower-case). */
export function siteKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function siteDisabled(host: string, disabled: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return disabled.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Should the website bar be shown on this URL? (Same rule the content script applies.) */
export function websiteBarAllowed(bar: Settings['tabspaceBar'] | undefined, url: string): boolean {
  if (bar?.onWebsites !== true) return false;
  const host = siteKey(url);
  return !!host && !siteDisabled(host, bar.disabledSites ?? []);
}

/** Message the bar iframe sends to its page's content script (via chrome.tabs.sendMessage, frameId 0). */
export interface BarModeMessage {
  type: 'tsbar:mode';
  mode: BarMode;
}

export function isBarModeMessage(msg: unknown): msg is BarModeMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'tsbar:mode' && (m.mode === 'bar' || m.mode === 'expanded' || m.mode === 'collapsed') && Object.keys(m).length === 2;
}
