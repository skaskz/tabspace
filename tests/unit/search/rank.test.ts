import { describe, expect, it } from 'vitest';
import type { Bookmark, Note, Task, Workspace } from '@/types/models';
import { scoreTitle, search, type SearchSources } from '@/features/search/rank';
import { recentTabs, type OpenTab } from '@/features/search/chromeTabs';

const base = { createdAt: 0, updatedAt: 0 };
const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({ ...base, id, title, done: false, priority: 'none', subtasks: [], order: 0, ...extra });
const note = (id: string, title: string, content = '', extra: Partial<Note> = {}): Note => ({ ...base, id, title, content, tags: [], favorite: false, ...extra });
const bm = (id: string, title: string, url: string): Bookmark => ({ ...base, id, title, url, tags: [], favorite: false });
const ws = (id: string, name: string): Workspace => ({ ...base, id, name, icon: 'code', order: 0 });
const tab = (id: number, title: string, url: string, lastAccessed?: number): OpenTab => ({ id, windowId: 1, title, url, active: false, lastAccessed });

const src = (p: Partial<SearchSources>): SearchSources => ({ tasks: [], notes: [], bookmarks: [], workspaces: [], tabs: [], ...p });

describe('search ranking', () => {
  it('scores exact > prefix > word-prefix > substring', () => {
    const q = 'git';
    expect(scoreTitle('git', q)).toBeGreaterThan(scoreTitle('github', q));
    expect(scoreTitle('github', q)).toBeGreaterThan(scoreTitle('push to github', q));
    expect(scoreTitle('push to github', q)).toBeGreaterThan(scoreTitle('legit', q));
    expect(scoreTitle('nothing', q)).toBe(0);
  });

  it('title matches rank above body matches, case-insensitively', () => {
    const groups = search('GITHUB', src({ notes: [note('body', 'Release plan', 'push to github'), note('title', 'GitHub checklist')] }));
    expect(groups[0].results.map((r) => r.id)).toEqual(['title', 'body']);
  });

  it('excludes trashed notes and returns empty for blank query', () => {
    expect(search('plan', src({ notes: [note('t', 'Plan', '', { trashedAt: 1 })] }))).toEqual([]);
    expect(search('  ', src({ tasks: [task('a', 'Plan')] }))).toEqual([]);
  });

  it('groups results by kind in a fixed order', () => {
    const groups = search(
      'tab',
      src({
        tasks: [task('t', 'Push Tabspace')],
        bookmarks: [bm('b', 'Tabspace repo', 'https://github.com/x/tabspace')],
        workspaces: [ws('w', 'Tabspace launch')],
        tabs: [tab(1, 'Tabspace docs', 'https://docs.example.com')],
        notes: [note('n', 'Tab ideas')],
      }),
    );
    expect(groups.map((g) => g.kind)).toEqual(['tab', 'workspace', 'task', 'note', 'bookmark']);
  });

  it('matches bookmark URLs and task subtasks as body text', () => {
    const g = search('mozilla', src({ bookmarks: [bm('b', 'MDN', 'https://developer.mozilla.org')] }));
    expect(g[0].results[0].id).toBe('b');
    const t = search('dumbbells', src({ tasks: [task('t', 'Workout', { subtasks: [{ id: 's', title: 'Buy dumbbells', done: false }] })] }));
    expect(t[0].results[0].id).toBe('t');
  });

  it('limits results per group', () => {
    const tasks = Array.from({ length: 9 }, (_, i) => task(`t${i}`, `Run ${i}`));
    expect(search('run', src({ tasks }), 5)[0].results).toHaveLength(5);
  });
});

describe('recentTabs', () => {
  it('sorts by lastAccessed desc, excludes own pages and limits', () => {
    const tabs = [tab(1, 'a', 'https://a.com', 10), tab(2, 'b', 'chrome-extension://me/dashboard.html', 99), tab(3, 'c', 'https://c.com', 50), tab(4, 'd', 'https://d.com')];
    expect(recentTabs(tabs, 2, 'chrome-extension://me/').map((t) => t.id)).toEqual([3, 1]);
  });
});
