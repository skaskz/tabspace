import type { CalendarEvent, CalendarSource, Settings, Task } from '@/types/models';
import { getOccurrences } from './occurrences';

/** Pure reminder planning used by the service worker (`extension/background/reminders.ts`). */

export const REMINDER_PREFIX = 'ts-rem|';

export interface PlannedReminder {
  /** chrome.alarms name, encodes everything needed when it fires. */
  name: string;
  /** When to notify (ms). */
  when: number;
  kind: 'event' | 'task';
  refId: string;
  /** Event start / task due instant (ms). */
  at: number;
  allDay: boolean;
}

export function reminderName(kind: 'event' | 'task', refId: string, at: number, allDay = false): string {
  return `${REMINDER_PREFIX}${kind}|${encodeURIComponent(refId)}|${at}|${allDay ? 1 : 0}`;
}

export function parseReminderName(name: string): { kind: 'event' | 'task'; refId: string; at: number; allDay: boolean } | null {
  if (!name.startsWith(REMINDER_PREFIX)) return null;
  const [kind, id, at, allDay] = name.slice(REMINDER_PREFIX.length).split('|');
  if ((kind !== 'event' && kind !== 'task') || !id || !at || !Number.isFinite(Number(at))) return null;
  try {
    return { kind, refId: decodeURIComponent(id), at: Number(at), allDay: allDay === '1' };
  } catch {
    return null;
  }
}

export interface PlanInput {
  events: CalendarEvent[];
  sources: CalendarSource[];
  tasks: Task[];
  settings: Pick<Settings, 'notifications'>;
  now: number;
  limit?: number;
  horizonDays?: number;
}

/** Local due instant for a task with both a date and a time, else null. */
export function taskDueAt(t: Pick<Task, 'dueDate' | 'dueTime'>): number | null {
  if (!t.dueDate || !t.dueTime) return null;
  const [y, m, d] = t.dueDate.split('-').map(Number);
  const [h, min] = t.dueTime.split(':').map(Number);
  if (![y, m, d, h, min].every(Number.isFinite)) return null;
  return new Date(y, m - 1, d, h, min).getTime();
}

/** The next `limit` reminders strictly after `now`, soonest first. */
export function planReminders({ events, sources, tasks, settings, now, limit = 20, horizonDays = 35 }: PlanInput): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  if (settings.notifications.events) {
    const withReminders = events.filter((e) => typeof e.reminderMinutes === 'number' && e.reminderMinutes >= 0);
    // Look a little further ahead so "1 day before" reminders for events just past the horizon are not lost.
    const occ = getOccurrences(withReminders, sources, new Date(now), new Date(now + (horizonDays + 2) * 86_400_000));
    for (const o of occ) {
      const at = o.start.getTime();
      const when = at - (o.event.reminderMinutes ?? 0) * 60_000;
      if (when <= now || when > now + horizonDays * 86_400_000) continue;
      out.push({ name: reminderName('event', o.event.id, at, o.allDay), when, kind: 'event', refId: o.event.id, at, allDay: o.allDay });
    }
  }
  if (settings.notifications.tasks) {
    for (const t of tasks) {
      if (t.done) continue;
      const at = taskDueAt(t);
      if (at === null || at <= now || at > now + horizonDays * 86_400_000) continue;
      out.push({ name: reminderName('task', t.id, at), when: at, kind: 'task', refId: t.id, at, allDay: false });
    }
  }
  out.sort((a, b) => a.when - b.when);
  return out.slice(0, limit);
}

/** "Today, 3:00 PM" / "Tomorrow, 9:30 AM" / "Fri, Oct 23, 9:30 AM" (+ "All day"). */
export function formatWhen(at: number, allDay: boolean, now: number = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(d) - startOf(today)) / 86_400_000);
  const day = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (allDay) return `${day} · All day`;
  return `${day}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
