import type { Priority, Task } from '@/types/models';
import { addDays, fromDateKey, toDateKey } from '@/utils/date';

/**
 * Pure task bucketing for the Tasks page and the dashboard.
 * All "today" comparisons use local `YYYY-MM-DD` keys, which sort lexically.
 */

export type TaskView = 'inbox' | 'today' | 'upcoming' | 'someday' | 'completed';

export function isOverdue(t: Task, today: string): boolean {
  return !t.done && !!t.dueDate && t.dueDate < today;
}

export function isDueTodayOrOverdue(t: Task, today: string): boolean {
  return !t.done && !!t.dueDate && t.dueDate <= today;
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };

/** Secondary order inside a bucket: due time, then priority, then manual order, then creation. */
function tieBreak(a: Task, b: Task): number {
  return (
    (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    a.order - b.order ||
    a.createdAt - b.createdAt
  );
}

/** 0 = overdue, 1 = today, 2 = future dated, 3 = undated. */
function inboxRank(t: Task, today: string): number {
  if (!t.dueDate) return 3;
  if (t.dueDate < today) return 0;
  if (t.dueDate === today) return 1;
  return 2;
}

export function sortInbox(tasks: Task[], today: string): Task[] {
  return [...tasks].sort(
    (a, b) => inboxRank(a, today) - inboxRank(b, today) || (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || tieBreak(a, b),
  );
}

/** Inbox = every open task: overdue, today, dated ascending, then undated. */
export function inboxTasks(tasks: Task[], today: string): Task[] {
  return sortInbox(
    tasks.filter((t) => !t.done),
    today,
  );
}

/** Today = open tasks due today or overdue (overdue first). */
export function todayTasks(tasks: Task[], today: string): Task[] {
  return sortInbox(
    tasks.filter((t) => isDueTodayOrOverdue(t, today)),
    today,
  );
}

/** Upcoming = open tasks with a due date after today. */
export function upcomingTasks(tasks: Task[], today: string): Task[] {
  return sortInbox(
    tasks.filter((t) => !t.done && !!t.dueDate && t.dueDate > today),
    today,
  );
}

export interface DateGroup {
  date: string;
  tasks: Task[];
}

/** Upcoming tasks grouped by due date (ascending). */
export function upcomingGroups(tasks: Task[], today: string): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const t of upcomingTasks(tasks, today)) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.dueDate) last.tasks.push(t);
    else groups.push({ date: t.dueDate!, tasks: [t] });
  }
  return groups;
}

/** Someday = open tasks explicitly parked for later. */
export function somedayTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.done && t.someday).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/** Completed = done tasks, most recently completed first. */
export function completedTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.done).sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt));
}

export function tasksForView(view: TaskView, tasks: Task[], today: string): Task[] {
  switch (view) {
    case 'inbox':
      return inboxTasks(tasks, today);
    case 'today':
      return todayTasks(tasks, today);
    case 'upcoming':
      return upcomingTasks(tasks, today);
    case 'someday':
      return somedayTasks(tasks);
    case 'completed':
      return completedTasks(tasks);
  }
}

export function viewCounts(tasks: Task[], today: string): Record<TaskView, number> {
  return {
    inbox: inboxTasks(tasks, today).length,
    today: todayTasks(tasks, today).length,
    upcoming: upcomingTasks(tasks, today).length,
    someday: somedayTasks(tasks).length,
    completed: completedTasks(tasks).length,
  };
}

/** Case-insensitive title/notes filter. */
export function filterTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  return tasks.filter((t) => t.title.toLowerCase().includes(q) || (t.notes ?? '').toLowerCase().includes(q));
}

/** Friendly label for a due date chip: "Today", "Tomorrow", "Yesterday", "Mon", or "Oct 24". */
export function dueLabel(dueDate: string, today: string): string {
  if (dueDate === today) return 'Today';
  const t = fromDateKey(today);
  if (dueDate === toDateKey(addDays(t, 1))) return 'Tomorrow';
  if (dueDate === toDateKey(addDays(t, -1))) return 'Yesterday';
  const d = fromDateKey(dueDate);
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = d.getFullYear() === t.getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function subtaskProgress(t: Task): { done: number; total: number } {
  return { done: t.subtasks.filter((s) => s.done).length, total: t.subtasks.length };
}

export function nextOrder(tasks: Task[]): number {
  return tasks.reduce((m, t) => Math.max(m, t.order), 0) + 1;
}

/** Changes applied when a task's completion is toggled. */
export function completionChanges(done: boolean, now = Date.now()): Partial<Task> {
  return done ? { done: true, completedAt: now } : { done: false, completedAt: undefined };
}
