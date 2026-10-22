import { describe, expect, it } from 'vitest';
import type { SavedSession, Task, Note, Workspace } from '@/types/models';
import { daysWithEvents, friendlyWhen, isEmptyAccount, upcoming, workspaceStats } from '@/pages/dashboard/dashboardLogic';
import { moveLink, validateLink } from '@/features/quicklinks/quickLinks';
import type { Occurrence } from '@/features/calendar/occurrences';

const base = { createdAt: 0, updatedAt: 0 };

describe('workspaceStats', () => {
  const w: Workspace = { ...base, id: 'w', name: 'Tabspace', icon: 'code', order: 0 };
  const tab = (url: string) => ({ id: url, url, title: url, pinned: false });
  const sessions: SavedSession[] = [
    { ...base, id: 's1', name: 'old', workspaceId: 'w', updatedAt: 1, tabs: [tab('https://a.com')], groups: [] },
    { ...base, id: 's2', name: 'new', workspaceId: 'w', updatedAt: 5, tabs: [tab('https://b.com'), tab('https://c.com'), tab('https://d.com'), tab('https://e.com')], groups: [] },
    { ...base, id: 's3', name: 'archived', workspaceId: 'w', updatedAt: 9, archived: true, tabs: [], groups: [] },
    { ...base, id: 's4', name: 'other', workspaceId: 'x', updatedAt: 10, tabs: [], groups: [] },
  ];
  const tasks = [
    { id: 't1', workspaceId: 'w', done: false },
    { id: 't2', workspaceId: 'w', done: true },
  ] as Task[];
  const notes = [
    { id: 'n1', workspaceId: 'w' },
    { id: 'n2', workspaceId: 'w', trashedAt: 1 },
  ] as Note[];

  it('counts tabs of the latest non-archived session, open tasks and live notes', () => {
    expect(workspaceStats(w, sessions, tasks, notes)).toEqual({ tabs: 4, tasks: 1, notes: 1, previewUrls: ['https://b.com', 'https://c.com', 'https://d.com'] });
  });
});

describe('calendar helpers', () => {
  const occ = (start: Date, end: Date, allDay = false) => ({ start, end, allDay, key: String(+start) }) as Occurrence;
  it('friendlyWhen', () => {
    const now = new Date(2026, 9, 21, 9);
    expect(friendlyWhen(occ(new Date(2026, 9, 22, 6), new Date(2026, 9, 22, 7)), now)).toMatch(/^Tomorrow, 6:00/);
    expect(friendlyWhen(occ(new Date(2026, 9, 21, 0), new Date(2026, 9, 22), true), now)).toBe('Today · All day');
  });
  it('daysWithEvents marks every day a multi-day event touches', () => {
    const days = daysWithEvents([occ(new Date(2026, 9, 21), new Date(2026, 9, 24), true)]);
    expect([...days]).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
  });
  it('upcoming skips ended events', () => {
    const now = new Date(2026, 9, 21, 12);
    const past = occ(new Date(2026, 9, 21, 8), new Date(2026, 9, 21, 9));
    const next = occ(new Date(2026, 9, 21, 15), new Date(2026, 9, 21, 16));
    expect(upcoming([past, next], now)).toEqual([next]);
  });
});

describe('welcome + quick links', () => {
  it('isEmptyAccount', () => {
    expect(isEmptyAccount({ workspaces: [], tasks: [], notes: [], bookmarks: [] })).toBe(true);
    expect(isEmptyAccount({ workspaces: [], tasks: [{} as Task], notes: [], bookmarks: [] })).toBe(false);
  });
  it('validateLink normalises URLs and refuses unsafe ones', () => {
    expect(validateLink('', 'github.com')).toEqual({ title: 'github.com', url: 'https://github.com/' });
    expect(validateLink('x', 'javascript:alert(1)')).toHaveProperty('error');
  });
  it('moveLink reorders and renumbers', () => {
    const links = [
      { id: 'a', title: 'a', url: 'https://a.com', order: 3 },
      { id: 'b', title: 'b', url: 'https://b.com', order: 7 },
    ];
    expect(moveLink(links, 'b', -1).map((l) => [l.id, l.order])).toEqual([
      ['b', 0],
      ['a', 1],
    ]);
    expect(moveLink(links, 'a', -1).map((l) => l.id)).toEqual(['a', 'b']);
  });
});
