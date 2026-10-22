import type { FocusSessionRecord, Note, Task, UsageLog, Workspace, WorkspaceActivityLog } from '@/types/models';
import { addDays, fromDateKey, startOfDay, toDateKey } from '@/utils/date';

/**
 * Pure analytics aggregation over real stored data. All buckets are LOCAL calendar
 * days (built with date arithmetic, never fixed 24h steps) so DST days are handled.
 */

export type RangeKind = 'today' | 'week' | 'month' | 'custom';

export interface Period {
  kind: RangeKind;
  /** Inclusive local start (midnight). */
  start: Date;
  /** Exclusive local end (midnight). */
  end: Date;
}

const MAX_CUSTOM_DAYS = 366;

export function periodFor(kind: RangeKind, anchor: Date = new Date(), custom?: { from: string; to: string }): Period {
  const a = startOfDay(anchor);
  if (kind === 'today') return { kind, start: a, end: addDays(a, 1) };
  if (kind === 'week') {
    const s = addDays(a, -a.getDay()); // Sunday-start, matching the calendar
    return { kind, start: s, end: addDays(s, 7) };
  }
  if (kind === 'month') return { kind, start: new Date(a.getFullYear(), a.getMonth(), 1), end: new Date(a.getFullYear(), a.getMonth() + 1, 1) };
  let from = custom?.from && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) ? fromDateKey(custom.from) : a;
  let to = custom?.to && /^\d{4}-\d{2}-\d{2}$/.test(custom.to) ? fromDateKey(custom.to) : a;
  if (to < from) [from, to] = [to, from];
  let end = addDays(to, 1);
  if (dayCount({ kind, start: from, end }) > MAX_CUSTOM_DAYS) end = addDays(from, MAX_CUSTOM_DAYS);
  return { kind, start: from, end };
}

export function dayCount(p: Period): number {
  // Round handles the 23/25-hour DST days.
  return Math.round((p.end.getTime() - p.start.getTime()) / 86_400_000);
}

export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  if (p.kind === 'month') {
    const s = new Date(p.start.getFullYear(), p.start.getMonth() + dir, 1);
    return { kind: p.kind, start: s, end: new Date(s.getFullYear(), s.getMonth() + 1, 1) };
  }
  const n = p.kind === 'today' ? 1 : p.kind === 'week' ? 7 : dayCount(p);
  return { kind: p.kind, start: addDays(p.start, n * dir), end: addDays(p.end, n * dir) };
}

export function daysIn(p: Period): Date[] {
  const out: Date[] = [];
  for (let d = p.start; d < p.end && out.length <= MAX_CUSTOM_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

const inPeriod = (ts: number | undefined, p: Period) => ts !== undefined && ts >= p.start.getTime() && ts < p.end.getTime();
const isFocusKind = (s: FocusSessionRecord) => s.kind === 'focus' || s.kind === 'custom';

export interface Totals {
  focusMs: number;
  focusSessions: number;
  completedTasks: number;
  websiteMs: number;
}

export function totals(p: Period, data: { sessions: FocusSessionRecord[]; tasks: Task[]; usage: UsageLog }): Totals {
  const focus = data.sessions.filter((s) => isFocusKind(s) && s.actualMs > 0 && inPeriod(s.startedAt, p));
  const keys = new Set(daysIn(p).map((d) => toDateKey(d)));
  let websiteMs = 0;
  for (const [day, domains] of Object.entries(data.usage)) if (keys.has(day)) for (const ms of Object.values(domains)) websiteMs += ms;
  return {
    focusMs: focus.reduce((n, s) => n + s.actualMs, 0),
    focusSessions: focus.length,
    completedTasks: data.tasks.filter((t) => t.done && inPeriod(t.completedAt, p)).length,
    websiteMs,
  };
}

/** Percentage change vs previous, or null when there is nothing to compare to. */
export function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export interface DayPoint {
  date: string;
  label: string;
  value: number;
}

function dayLabel(d: Date, p: Period): string {
  return dayCount(p) <= 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function focusByDay(sessions: FocusSessionRecord[], p: Period): DayPoint[] {
  const by = new Map<string, number>();
  for (const s of sessions) if (isFocusKind(s) && inPeriod(s.startedAt, p)) by.set(toDateKey(s.startedAt), (by.get(toDateKey(s.startedAt)) ?? 0) + s.actualMs);
  return daysIn(p).map((d) => ({ date: toDateKey(d), label: dayLabel(d, p), value: by.get(toDateKey(d)) ?? 0 }));
}

export function completionsByDay(tasks: Task[], p: Period): DayPoint[] {
  const by = new Map<string, number>();
  for (const t of tasks) if (t.done && inPeriod(t.completedAt, p)) by.set(toDateKey(t.completedAt!), (by.get(toDateKey(t.completedAt!)) ?? 0) + 1);
  return daysIn(p).map((d) => ({ date: toDateKey(d), label: dayLabel(d, p), value: by.get(toDateKey(d)) ?? 0 }));
}

/** Focus minutes for a single day split by hour (used for the "Today" view). */
export function focusByHour(sessions: FocusSessionRecord[], p: Period): DayPoint[] {
  const hours = Array.from({ length: 24 }, (_, h) => ({ date: String(h), label: `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`, value: 0 }));
  for (const s of sessions) if (isFocusKind(s) && inPeriod(s.startedAt, p)) hours[new Date(s.startedAt).getHours()].value += s.actualMs;
  return hours;
}

export function topDomains(usage: UsageLog, p: Period, n = 8): { domain: string; ms: number }[] {
  const keys = new Set(daysIn(p).map((d) => toDateKey(d)));
  const by = new Map<string, number>();
  for (const [day, domains] of Object.entries(usage)) if (keys.has(day)) for (const [dom, ms] of Object.entries(domains)) by.set(dom, (by.get(dom) ?? 0) + ms);
  return Array.from(by, ([domain, ms]) => ({ domain, ms }))
    .filter((x) => x.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, n);
}

export interface WorkspaceRow {
  id: string;
  name: string;
  /** Workspace opens/saves logged in the period. */
  opens: number;
  /** Tasks in this workspace completed in the period. */
  tasksDone: number;
  /** Notes in this workspace edited in the period. */
  notesEdited: number;
  /** Open (not done) tasks right now — same definition as the dashboard's workspace cards. */
  openTasks: number;
  /** opens + tasksDone + notesEdited (period activity). */
  total: number;
}

/** "1 note", "3 notes", "0 tasks". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function workspaceActivity(p: Period, data: { activity: WorkspaceActivityLog; workspaces: Workspace[]; tasks: Task[]; notes: Note[] }): WorkspaceRow[] {
  const keys = new Set(daysIn(p).map((d) => toDateKey(d)));
  const rows = new Map<string, WorkspaceRow>(data.workspaces.map((w) => [w.id, { id: w.id, name: w.name, opens: 0, tasksDone: 0, notesEdited: 0, openTasks: 0, total: 0 }]));
  for (const [day, by] of Object.entries(data.activity)) {
    if (!keys.has(day)) continue;
    for (const [wid, n] of Object.entries(by)) {
      const r = rows.get(wid);
      if (r) r.opens += n;
    }
  }
  for (const t of data.tasks) {
    const r = t.workspaceId ? rows.get(t.workspaceId) : undefined;
    if (r && t.done && inPeriod(t.completedAt, p)) r.tasksDone++;
    if (r && !t.done) r.openTasks++;
  }
  for (const n of data.notes) {
    const r = n.workspaceId ? rows.get(n.workspaceId) : undefined;
    if (r && !n.trashedAt && inPeriod(n.updatedAt, p)) r.notesEdited++;
  }
  return Array.from(rows.values())
    .map((r) => ({ ...r, total: r.opens + r.tasksDone + r.notesEdited }))
    .filter((r) => r.total > 0 || r.openTasks > 0)
    .sort((a, b) => b.total - a.total || b.openTasks - a.openTasks);
}

export interface WeekPoint {
  weekStart: string;
  label: string;
  focusMs: number;
  completed: number;
}

/** Last `weeks` Sunday-start weeks ending with the week containing `anchor`. */
export function weeklyTrend(sessions: FocusSessionRecord[], tasks: Task[], anchor: Date, weeks = 8): WeekPoint[] {
  const current = periodFor('week', anchor);
  const out: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const p: Period = { kind: 'week', start: addDays(current.start, -7 * i), end: addDays(current.end, -7 * i) };
    const t = totals(p, { sessions, tasks, usage: {} });
    out.push({ weekStart: toDateKey(p.start), label: p.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), focusMs: t.focusMs, completed: t.completedTasks });
  }
  return out;
}

export function periodLabel(p: Period): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (p.kind === 'today') return p.start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  if (p.kind === 'month') return p.start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const last = addDays(p.end, -1);
  const sameYear = p.start.getFullYear() === last.getFullYear();
  return `${p.start.toLocaleDateString(undefined, sameYear ? opts : { ...opts, year: 'numeric' })} – ${last.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
}
