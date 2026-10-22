import { describe, expect, it } from 'vitest';
import type { Task } from '@/types/models';
import { completedTasks, dueLabel, filterTasks, inboxTasks, isOverdue, somedayTasks, todayTasks, upcomingGroups, viewCounts } from '@/features/tasks/buckets';

const TODAY = '2026-10-21';
let n = 0;
function task(p: Partial<Task>): Task {
  n++;
  return { id: `t${n}`, title: `Task ${n}`, done: false, priority: 'none', subtasks: [], order: n, createdAt: n, updatedAt: n, ...p };
}

describe('task bucketing', () => {
  const overdue = task({ title: 'Review job applications', dueDate: '2026-10-19' });
  const today = task({ title: 'Go for a run', dueDate: TODAY });
  const tomorrow = task({ title: 'Edit YouTube Short', dueDate: '2026-10-22' });
  const later = task({ title: 'Research Roblox mechanics', dueDate: '2026-11-02' });
  const later2 = task({ title: 'Push Tabspace to GitHub', dueDate: '2026-11-02' });
  const undated = task({ title: 'Finish AI automation script' });
  const someday = task({ title: 'Learn Rust', someday: true });
  const doneOld = task({ title: 'Old', done: true, completedAt: 100, dueDate: '2026-10-01' });
  const doneNew = task({ title: 'New', done: true, completedAt: 200 });
  const all = [undated, later, someday, doneOld, tomorrow, today, later2, overdue, doneNew];

  it('Inbox lists all open tasks: overdue, today, dated asc, undated', () => {
    const ids = inboxTasks(all, TODAY).map((t) => t.id);
    expect(ids.slice(0, 5)).toEqual([overdue.id, today.id, tomorrow.id, later.id, later2.id]);
    expect(ids.slice(5).sort()).toEqual([undated.id, someday.id].sort());
    expect(ids).not.toContain(doneOld.id);
  });

  it('Today = open tasks due today or overdue; done tasks excluded', () => {
    expect(todayTasks(all, TODAY).map((t) => t.id)).toEqual([overdue.id, today.id]);
  });

  it('Upcoming groups future-dated open tasks by date', () => {
    const groups = upcomingGroups(all, TODAY);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-22', '2026-11-02']);
    expect(groups[1].tasks.map((t) => t.id)).toEqual([later.id, later2.id]);
  });

  it('Someday and Completed (newest first)', () => {
    expect(somedayTasks(all).map((t) => t.id)).toEqual([someday.id]);
    expect(completedTasks(all).map((t) => t.id)).toEqual([doneNew.id, doneOld.id]);
  });

  it('counts match bucket sizes', () => {
    expect(viewCounts(all, TODAY)).toEqual({ inbox: 7, today: 2, upcoming: 3, someday: 1, completed: 2 });
  });

  it('overdue is false for done tasks', () => {
    expect(isOverdue(overdue, TODAY)).toBe(true);
    expect(isOverdue(doneOld, TODAY)).toBe(false);
  });

  it('filters by title and notes, case-insensitively', () => {
    const withNotes = task({ title: 'Plan', notes: 'Remember the GITHUB release' });
    expect(filterTasks([withNotes, today], 'github').map((t) => t.id)).toEqual([withNotes.id]);
    expect(filterTasks([withNotes, today], '  ')).toHaveLength(2);
  });

  it('dueLabel uses friendly names', () => {
    expect(dueLabel(TODAY, TODAY)).toBe('Today');
    expect(dueLabel('2026-10-22', TODAY)).toBe('Tomorrow');
    expect(dueLabel('2026-10-20', TODAY)).toBe('Yesterday');
  });

  it('orders same-day tasks by due time, then priority', () => {
    const a = task({ dueDate: TODAY, dueTime: '15:00' });
    const b = task({ dueDate: TODAY, dueTime: '09:00' });
    const c = task({ dueDate: TODAY, priority: 'high' });
    const d = task({ dueDate: TODAY, priority: 'low' });
    expect(todayTasks([d, a, c, b], TODAY).map((t) => t.id)).toEqual([b.id, a.id, c.id, d.id]);
  });
});
