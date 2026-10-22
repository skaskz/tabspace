import type { Bookmark, BookmarkFolder } from '@/types/models';
import { hostname, isSafeUrl } from '@/utils/url';

/** Pure bookmark helpers: duplicates, sorting, filtering, counts and Chrome import mapping. */

/** Comparison key: lowercase host without www, no hash, no trailing slash, default ports dropped. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${u.port ? `:${u.port}` : ''}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Find an existing bookmark with the same URL (optionally limited to one folder). */
export function findDuplicate(bookmarks: Bookmark[], url: string, opts: { folderId?: string | null; excludeId?: string } = {}): Bookmark | undefined {
  const key = urlKey(url);
  return bookmarks.find(
    (b) =>
      b.id !== opts.excludeId &&
      urlKey(b.url) === key &&
      (opts.folderId === undefined || (b.folderId ?? null) === (opts.folderId ?? null)),
  );
}

export type BookmarkSort = 'recent' | 'title' | 'domain';
export type BookmarkChip = 'all' | 'favorites' | 'recent';

export function lastTouched(b: Bookmark): number {
  return Math.max(b.lastOpenedAt ?? 0, b.createdAt);
}

export function sortBookmarks(list: Bookmark[], sort: BookmarkSort): Bookmark[] {
  return [...list].sort((a, b) => {
    if (sort === 'title') return (a.title || a.url).localeCompare(b.title || b.url, undefined, { sensitivity: 'base' });
    if (sort === 'domain') return hostname(a.url).localeCompare(hostname(b.url)) || (a.title || '').localeCompare(b.title || '');
    return lastTouched(b) - lastTouched(a);
  });
}

export const RECENT_WINDOW_MS = 7 * 86_400_000;

/** Folder ids that belong to a folder (itself plus its children). */
export function folderScope(folders: BookmarkFolder[], folderId: string): Set<string> {
  const ids = new Set([folderId]);
  for (const f of folders) if (f.parentId === folderId) ids.add(f.id);
  return ids;
}

export interface BookmarkQuery {
  /** undefined = all folders; null = unfiled only. */
  folderId?: string | null;
  chip?: BookmarkChip;
  search?: string;
  now?: number;
}

export function filterBookmarks(list: Bookmark[], folders: BookmarkFolder[], q: BookmarkQuery): Bookmark[] {
  const scope = q.folderId ? folderScope(folders, q.folderId) : null;
  const s = (q.search ?? '').trim().toLowerCase();
  const now = q.now ?? Date.now();
  return list.filter((b) => {
    if (q.folderId === null && b.folderId) return false;
    if (scope && !(b.folderId && scope.has(b.folderId))) return false;
    if (q.chip === 'favorites' && !b.favorite) return false;
    if (q.chip === 'recent' && now - lastTouched(b) > RECENT_WINDOW_MS) return false;
    if (!s) return true;
    return (
      b.title.toLowerCase().includes(s) ||
      b.url.toLowerCase().includes(s) ||
      b.tags.some((t) => t.toLowerCase().includes(s)) ||
      (b.notes ?? '').toLowerCase().includes(s)
    );
  });
}

/** Bookmark count per folder; a parent's count includes its children. */
export function folderCounts(folders: BookmarkFolder[], bookmarks: Bookmark[]): Map<string, number> {
  const direct = new Map<string, number>();
  for (const b of bookmarks) if (b.folderId) direct.set(b.folderId, (direct.get(b.folderId) ?? 0) + 1);
  const out = new Map<string, number>();
  for (const f of folders) {
    let n = direct.get(f.id) ?? 0;
    for (const c of folders) if (c.parentId === f.id) n += direct.get(c.id) ?? 0;
    out.set(f.id, n);
  }
  return out;
}

/** Root folders sorted, each followed by its children — for trees and <select>s. */
export function folderTree(folders: BookmarkFolder[]): { folder: BookmarkFolder; depth: 0 | 1 }[] {
  const ids = new Set(folders.map((f) => f.id));
  const byOrder = (a: BookmarkFolder, b: BookmarkFolder) => a.order - b.order || a.name.localeCompare(b.name);
  const roots = folders.filter((f) => !f.parentId || !ids.has(f.parentId)).sort(byOrder);
  const out: { folder: BookmarkFolder; depth: 0 | 1 }[] = [];
  for (const r of roots) {
    out.push({ folder: r, depth: 0 });
    for (const c of folders.filter((f) => f.parentId === r.id).sort(byOrder)) out.push({ folder: c, depth: 1 });
  }
  return out;
}

export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of input.split(',')) {
    const t = raw.trim().replace(/^#+/, '').toLowerCase();
    if (t) seen.add(t.slice(0, 32));
  }
  return [...seen];
}

/* ------------------------------------------------------------------ */
/* Chrome bookmarks import                                              */
/* ------------------------------------------------------------------ */

/** Subset of chrome.bookmarks.BookmarkTreeNode we rely on. */
export interface ChromeBookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: ChromeBookmarkNode[];
}

export interface ImportPlan {
  folders: BookmarkFolder[];
  bookmarks: Bookmark[];
  skippedDuplicates: number;
  skippedUnsafe: number;
}

/**
 * Map a Chrome bookmark tree onto Tabspace's (max one level nested) folders.
 * - Each top-level Chrome container (Bookmarks bar, Other bookmarks…) becomes a root folder.
 * - Sub-folders at any depth become children of that root, deeper ones named "A / B".
 * - Folders are matched to existing ones by name + parent, so re-importing does not duplicate.
 * - Links are skipped if non-http(s) or already present (same URL) in the target folder.
 * Returns only the NEW records to append.
 */
export function planChromeImport(
  tree: ChromeBookmarkNode[],
  existingFolders: BookmarkFolder[],
  existingBookmarks: Bookmark[],
  makeId: () => string,
  now = Date.now(),
): ImportPlan {
  const folders = [...existingFolders];
  const plan: ImportPlan = { folders: [], bookmarks: [], skippedDuplicates: 0, skippedUnsafe: 0 };
  const seen = new Map<string, Set<string>>();
  for (const b of existingBookmarks) {
    const k = b.folderId ?? '';
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)!.add(urlKey(b.url));
  }
  let order = folders.reduce((m, f) => Math.max(m, f.order), 0);

  const ensureFolder = (name: string, parentId?: string): string => {
    const found = folders.find((f) => f.name === name && (f.parentId ?? undefined) === parentId);
    if (found) return found.id;
    const f: BookmarkFolder = { id: makeId(), name, parentId, order: ++order, createdAt: now, updatedAt: now };
    folders.push(f);
    plan.folders.push(f);
    return f.id;
  };

  const addLink = (node: ChromeBookmarkNode, folderId: string) => {
    if (!isSafeUrl(node.url)) {
      plan.skippedUnsafe++;
      return;
    }
    const key = urlKey(node.url);
    if (!seen.has(folderId)) seen.set(folderId, new Set());
    const set = seen.get(folderId)!;
    if (set.has(key)) {
      plan.skippedDuplicates++;
      return;
    }
    set.add(key);
    plan.bookmarks.push({
      id: makeId(),
      url: node.url,
      title: node.title || hostname(node.url),
      folderId,
      tags: [],
      favorite: false,
      createdAt: now,
      updatedAt: now,
    });
  };

  const countLinks = (n: ChromeBookmarkNode): number => (n.children ?? []).reduce((sum, c) => sum + (c.url ? 1 : countLinks(c)), 0);
  const hasLinks = (n: ChromeBookmarkNode): boolean => !!n.children?.some((c) => (c.url ? isSafeUrl(c.url) : hasLinks(c)));

  const walkSub = (node: ChromeBookmarkNode, rootId: string, path: string[]) => {
    const links = node.children?.filter((c) => c.url) ?? [];
    if (links.some((l) => isSafeUrl(l.url))) {
      const targetId = ensureFolder(path.join(' / '), rootId);
      for (const l of links) addLink(l, targetId);
    } else plan.skippedUnsafe += links.length;
    for (const c of node.children ?? []) if (!c.url && hasLinks(c)) walkSub(c, rootId, [...path, c.title || 'Untitled']);
  };

  // Chrome's tree has a nameless root whose children are the containers.
  const containers = tree.length === 1 && !tree[0].url && !tree[0].title ? (tree[0].children ?? []) : tree;
  for (const container of containers) {
    if (container.url) continue;
    if (!hasLinks(container)) {
      plan.skippedUnsafe += countLinks(container);
      continue;
    }
    const rootId = ensureFolder(container.title || 'Imported');
    for (const c of container.children ?? []) {
      if (c.url) addLink(c, rootId);
      else if (hasLinks(c)) walkSub(c, rootId, [c.title || 'Untitled']);
    }
  }
  return plan;
}
