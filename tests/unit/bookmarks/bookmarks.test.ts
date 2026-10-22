import { describe, expect, it } from 'vitest';
import type { Bookmark, BookmarkFolder } from '@/types/models';
import { filterBookmarks, findDuplicate, folderCounts, folderTree, parseTags, planChromeImport, sortBookmarks, urlKey, type ChromeBookmarkNode } from '@/features/bookmarks/bookmarks';

let n = 0;
const bm = (p: Partial<Bookmark>): Bookmark => {
  n++;
  return { id: `b${n}`, url: `https://site${n}.com/`, title: `Site ${n}`, tags: [], favorite: false, createdAt: n * 1000, updatedAt: n * 1000, ...p };
};
const folder = (p: Partial<BookmarkFolder> & { id: string }): BookmarkFolder => ({ name: p.id, order: 0, createdAt: 0, updatedAt: 0, ...p });

describe('duplicates', () => {
  it('urlKey ignores www, trailing slash, hash and host case', () => {
    expect(urlKey('https://WWW.GitHub.com/user/repo/#readme')).toBe(urlKey('https://github.com/user/repo'));
    expect(urlKey('https://github.com/a?x=1')).not.toBe(urlKey('https://github.com/a?x=2'));
  });
  it('findDuplicate respects folder scope and excludeId', () => {
    const a = bm({ url: 'https://github.com/', folderId: 'dev' });
    expect(findDuplicate([a], 'https://www.github.com')?.id).toBe(a.id);
    expect(findDuplicate([a], 'https://github.com', { folderId: 'dev' })?.id).toBe(a.id);
    expect(findDuplicate([a], 'https://github.com', { folderId: 'other' })).toBeUndefined();
    expect(findDuplicate([a], 'https://github.com', { folderId: null })).toBeUndefined();
    expect(findDuplicate([a], 'https://github.com', { excludeId: a.id })).toBeUndefined();
  });
});

describe('sorting & filtering', () => {
  const x = bm({ title: 'beta', url: 'https://zeta.com', createdAt: 1, lastOpenedAt: 9_000 });
  const y = bm({ title: 'Alpha', url: 'https://aaa.com', createdAt: 5_000 });
  it('sorts by recent (opened or added), title and domain', () => {
    expect(sortBookmarks([y, x], 'recent').map((b) => b.id)).toEqual([x.id, y.id]);
    expect(sortBookmarks([x, y], 'title').map((b) => b.id)).toEqual([y.id, x.id]);
    expect(sortBookmarks([x, y], 'domain').map((b) => b.id)).toEqual([y.id, x.id]);
  });
  it('filters by folder scope (includes children), chip and search', () => {
    const folders = [folder({ id: 'p' }), folder({ id: 'c', parentId: 'p' })];
    const inP = bm({ folderId: 'p' });
    const inC = bm({ folderId: 'c', favorite: true, tags: ['tools'] });
    const loose = bm({ createdAt: 0 });
    const all = [inP, inC, loose];
    expect(filterBookmarks(all, folders, { folderId: 'p' })).toEqual([inP, inC]);
    expect(filterBookmarks(all, folders, { folderId: 'c' })).toEqual([inC]);
    expect(filterBookmarks(all, folders, { folderId: null })).toEqual([loose]);
    expect(filterBookmarks(all, folders, { chip: 'favorites' })).toEqual([inC]);
    expect(filterBookmarks(all, folders, { search: 'TOOLS' })).toEqual([inC]);
    expect(filterBookmarks(all, folders, { chip: 'recent', now: 8 * 86_400_000 })).toEqual([]);
  });
  it('folder counts include children; tree nests one level', () => {
    const folders = [folder({ id: 'p', order: 2 }), folder({ id: 'c', parentId: 'p' }), folder({ id: 'q', order: 1 })];
    const counts = folderCounts(folders, [bm({ folderId: 'p' }), bm({ folderId: 'c' }), bm({ folderId: 'c' })]);
    expect(counts.get('p')).toBe(3);
    expect(counts.get('c')).toBe(2);
    expect(counts.get('q')).toBe(0);
    expect(folderTree(folders).map((f) => [f.folder.id, f.depth])).toEqual([
      ['q', 0],
      ['p', 0],
      ['c', 1],
    ]);
  });
  it('parseTags dedupes and normalises', () => {
    expect(parseTags(' Tools, #reading,tools, ,')).toEqual(['tools', 'reading']);
  });
});

describe('planChromeImport', () => {
  let id = 0;
  const makeId = () => `new${++id}`;
  const tree: ChromeBookmarkNode[] = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          title: 'Bookmarks bar',
          children: [
            { id: '10', title: 'GitHub', url: 'https://github.com/' },
            { id: '11', title: 'Settings', url: 'chrome://settings' },
            { id: '12', title: 'GitHub again', url: 'https://www.github.com' },
            {
              id: '13',
              title: 'Dev',
              children: [
                { id: '130', title: 'MDN', url: 'https://developer.mozilla.org/' },
                { id: '131', title: 'Deep', children: [{ id: '1310', title: 'Vite', url: 'https://vite.dev/' }] },
                { id: '132', title: 'Empty', children: [] },
              ],
            },
          ],
        },
        { id: '2', title: 'Other bookmarks', children: [] },
        { id: '3', title: 'Mobile bookmarks', children: [{ id: '30', title: 'JS', url: 'javascript:alert(1)' }] },
      ],
    },
  ];

  it('maps containers to roots, nests sub-folders one level and skips unsafe / duplicate links', () => {
    const plan = planChromeImport(tree, [], [], makeId, 1);
    expect(plan.folders.map((f) => [f.name, f.parentId ? plan.folders.find((p) => p.id === f.parentId)?.name : null])).toEqual([
      ['Bookmarks bar', null],
      ['Dev', 'Bookmarks bar'],
      ['Dev / Deep', 'Bookmarks bar'],
    ]);
    expect(plan.bookmarks.map((b) => b.url)).toEqual(['https://github.com/', 'https://developer.mozilla.org/', 'https://vite.dev/']);
    expect(plan.skippedDuplicates).toBe(1);
    expect(plan.skippedUnsafe).toBe(2); // chrome://settings + javascript: (Mobile has no safe links so is not created)
    expect(plan.folders.some((f) => f.name === 'Other bookmarks' || f.name === 'Mobile bookmarks')).toBe(false);
  });

  it('re-importing reuses folders and skips links already present', () => {
    const first = planChromeImport(tree, [], [], makeId, 1);
    const again = planChromeImport(tree, first.folders, first.bookmarks, makeId, 2);
    expect(again.folders).toEqual([]);
    expect(again.bookmarks).toEqual([]);
    expect(again.skippedDuplicates).toBe(4);
  });
});
