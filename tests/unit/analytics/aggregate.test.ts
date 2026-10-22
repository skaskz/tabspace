import { describe, expect, it } from 'vitest';
import { change, plural, completionsByDay, dayCount, daysIn, focusByDay, periodFor, shiftPeriod, topDomains, totals, weeklyTrend, workspaceActivity } from '@/features/analytics/aggregate';
import type { FocusSessionRecord, Task } from '@/types/models';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const session = (startedAt: number, min: number, kind: FocusSessionRecord['kind'] = 'focus'): FocusSessionRecord => ({
  id: String(startedAt) + kind,
  createdAt: 0,
  updatedAt: 0,
  kind,
  startedAt,
  endedAt: startedAt + min * 60_000,
  plannedMs: min * 60_000,
  actualMs: min * 60_000,
  completed: true,
});
const done = (id: string, completedAt: number, workspaceId?: string): Task => ({ id, createdAt: 0, updatedAt: 0, title: id, done: true, completedAt, priority: 'none', subtasks: [], order: 0, workspaceId });

describe('periods', () => {
  it('builds Sunday-start weeks, months and today', () => {
    const anchor = new Date(2026, 9, 21, 15); // Wed
    const w = periodFor('week', anchor);
    expect(w.start).toEqual(new Date(2026, 9, 18));
    expect(w.end).toEqual(new Date(2026, 9, 25));
    expect(dayCount(periodFor('month', anchor))).toBe(31);
    expect(dayCount(periodFor('today', anchor))).toBe(1);
  });

  it('handles DST weeks as 7 local days', () => {
    // US DST ends Nov 1 2026; EU Oct 25 2026 — either way the week stays 7 calendar days.
    const w = periodFor('week', new Date(2026, 10, 2));
    expect(daysIn(w)).toHaveLength(7);
    expect(daysIn(w).every((d) => d.getHours() === 0)).toBe(true);
  });

  it('shifts periods and normalises custom ranges', () => {
    const m = shiftPeriod(periodFor('month', new Date(2026, 0, 31)), -1);
    expect(m.start).toEqual(new Date(2025, 11, 1));
    const c = periodFor('custom', new Date(), { from: '2026-10-10', to: '2026-10-01' });
    expect(c.start).toEqual(new Date(2026, 9, 1));
    expect(dayCount(c)).toBe(10);
    expect(shiftPeriod(c, 1).start).toEqual(new Date(2026, 9, 11));
    expect(dayCount(periodFor('custom', new Date(), { from: '2020-01-01', to: '2026-01-01' }))).toBe(366);
  });
});

describe('aggregation', () => {
  const sessions = [session(at(2026, 10, 19), 25), session(at(2026, 10, 19, 15), 50, 'custom'), session(at(2026, 10, 20), 5, 'short'), session(at(2026, 10, 12), 25)];
  const tasks = [done('a', at(2026, 10, 19), 'w1'), done('b', at(2026, 10, 21), 'w1'), done('c', at(2026, 10, 13))];
  const week = periodFor('week', new Date(2026, 9, 21));

  it('totals focus (excluding breaks), completions and website time', () => {
    const t = totals(week, { sessions, tasks, usage: { '2026-10-19': { 'github.com': 60_000 }, '2026-10-01': { 'x.com': 999 } } });
    expect(t).toEqual({ focusMs: 75 * 60_000, focusSessions: 2, completedTasks: 2, websiteMs: 60_000 });
  });

  it('change is null without previous data', () => {
    expect(change(10, 0)).toBeNull();
    expect(change(15, 10)).toBe(50);
    expect(change(5, 10)).toBe(-50);
  });

  it('buckets by local day', () => {
    const f = focusByDay(sessions, week);
    expect(f).toHaveLength(7);
    expect(f.find((d) => d.date === '2026-10-19')!.value).toBe(75 * 60_000);
    expect(completionsByDay(tasks, week).reduce((n, d) => n + d.value, 0)).toBe(2);
  });

  it('empty data yields zeros, not errors', () => {
    expect(totals(week, { sessions: [], tasks: [], usage: {} })).toEqual({ focusMs: 0, focusSessions: 0, completedTasks: 0, websiteMs: 0 });
    expect(topDomains({}, week)).toEqual([]);
    expect(workspaceActivity(week, { activity: {}, workspaces: [], tasks: [], notes: [] })).toEqual([]);
  });

  it('top domains sorted and capped', () => {
    const usage = { '2026-10-19': Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`d${i}.com`, (i + 1) * 1000])) };
    const top = topDomains(usage, week);
    expect(top).toHaveLength(8);
    expect(top[0]).toEqual({ domain: 'd11.com', ms: 12000 });
  });

  it('workspace activity combines opens, tasks and notes', () => {
    const rows = workspaceActivity(week, {
      activity: { '2026-10-20': { w1: 3, w2: 1 } },
      workspaces: [
        { id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'w2', name: 'Personal', icon: 'user', order: 1, createdAt: 0, updatedAt: 0 },
      ],
      tasks,
      notes: [{ id: 'n', title: 'n', content: '', tags: [], favorite: false, workspaceId: 'w2', createdAt: 0, updatedAt: at(2026, 10, 20) }],
    });
    expect(rows.map((r) => [r.name, r.opens, r.tasksDone, r.notesEdited])).toEqual([
      ['Development', 3, 2, 0],
      ['Personal', 1, 0, 1],
    ]);
  });

  it('open tasks match the dashboard definition and pluralisation is correct', () => {
    const rows = workspaceActivity(periodFor('week', new Date(2026, 9, 21)), {
      activity: {},
      workspaces: [{ id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 0, updatedAt: 0 }],
      tasks: [
        { id: 'o1', createdAt: 0, updatedAt: 0, title: 'o1', done: false, priority: 'none', subtasks: [], order: 0, workspaceId: 'w1' },
        { id: 'o2', createdAt: 0, updatedAt: 0, title: 'o2', done: false, priority: 'none', subtasks: [], order: 0, workspaceId: 'w1' },
      ],
      notes: [],
    });
    expect(rows).toEqual([{ id: 'w1', name: 'Development', opens: 0, tasksDone: 0, notesEdited: 0, openTasks: 2, total: 0 }]);
    expect([plural(1, 'note'), plural(0, 'task'), plural(3, 'note')]).toEqual(['1 note', '0 tasks', '3 notes']);
  });

  it('weekly trend covers N weeks ending this week', () => {
    const trend = weeklyTrend(sessions, tasks, new Date(2026, 9, 21), 3);
    expect(trend.map((w) => w.weekStart)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18']);
    expect(trend[1]).toMatchObject({ focusMs: 25 * 60_000, completed: 1 });
  });
});
