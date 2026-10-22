import { describe, expect, it } from 'vitest';
import { parseReminderName, planReminders, reminderName, taskDueAt } from '@/features/calendar/reminders';
import type { CalendarEvent, CalendarSource, Task } from '@/types/models';

const NOW = new Date(2026, 9, 21, 12, 0).getTime();
const base = { createdAt: 0, updatedAt: 0 };
const source: CalendarSource = { ...base, id: 'src', name: 'Personal', kind: 'local', color: '#fff', enabled: true };
const ev = (id: string, start: Date, reminderMinutes?: number, o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  ...base,
  id,
  sourceId: 'src',
  title: id,
  start: start.toISOString(),
  end: new Date(start.getTime() + 3600_000).toISOString(),
  allDay: false,
  reminderMinutes,
  ...o,
});
const task = (id: string, o: Partial<Task>): Task => ({ ...base, id, title: id, done: false, priority: 'none', subtasks: [], order: 0, ...o });
const on = { notifications: { tasks: true, events: true, focus: true } };

describe('planReminders', () => {
  it('schedules event reminders before start and skips past ones', () => {
    const plan = planReminders({
      events: [ev('soon', new Date(2026, 9, 21, 14, 0), 30), ev('past', new Date(2026, 9, 21, 12, 10), 30), ev('none', new Date(2026, 9, 21, 15, 0))],
      sources: [source],
      tasks: [],
      settings: on,
      now: NOW,
    });
    expect(plan.map((p) => p.refId)).toEqual(['soon']);
    expect(plan[0].when).toBe(new Date(2026, 9, 21, 13, 30).getTime());
  });

  it('expands recurring events and respects the limit and ordering', () => {
    const plan = planReminders({ events: [ev('daily', new Date(2026, 9, 20, 9, 0), 0, { recurrence: 'daily' })], sources: [source], tasks: [], settings: on, now: NOW, limit: 5 });
    expect(plan).toHaveLength(5);
    expect(plan[0].at).toBe(new Date(2026, 9, 22, 9, 0).getTime());
    expect(plan.every((p, i) => i === 0 || p.when >= plan[i - 1].when)).toBe(true);
    expect(new Set(plan.map((p) => p.name)).size).toBe(5);
  });

  it('excludes disabled sources and honours notification settings', () => {
    const e = ev('x', new Date(2026, 9, 22, 9), 10);
    expect(planReminders({ events: [e], sources: [{ ...source, enabled: false }], tasks: [], settings: on, now: NOW })).toHaveLength(0);
    expect(planReminders({ events: [e], sources: [source], tasks: [], settings: { notifications: { ...on.notifications, events: false } }, now: NOW })).toHaveLength(0);
  });

  it('schedules tasks with a due date and time only when not done', () => {
    const tasks = [task('due', { dueDate: '2026-10-21', dueTime: '18:00' }), task('dateOnly', { dueDate: '2026-10-21' }), task('done', { dueDate: '2026-10-21', dueTime: '18:00', done: true })];
    const plan = planReminders({ events: [], sources: [], tasks, settings: on, now: NOW });
    expect(plan.map((p) => p.refId)).toEqual(['due']);
    expect(planReminders({ events: [], sources: [], tasks, settings: { notifications: { ...on.notifications, tasks: false } }, now: NOW })).toHaveLength(0);
  });

  it('round-trips alarm names, including ids with separators', () => {
    const name = reminderName('event', 'src:uid|weird@x', 123, true);
    expect(parseReminderName(name)).toEqual({ kind: 'event', refId: 'src:uid|weird@x', at: 123, allDay: true });
    expect(parseReminderName('other-alarm')).toBeNull();
    expect(parseReminderName('ts-rem|bogus|a|1|0')).toBeNull();
  });

  it('computes local task due instants', () => {
    expect(taskDueAt({ dueDate: '2026-11-01', dueTime: '01:30' })).toBe(new Date(2026, 10, 1, 1, 30).getTime());
    expect(taskDueAt({ dueDate: '2026-11-01' })).toBeNull();
  });
});
