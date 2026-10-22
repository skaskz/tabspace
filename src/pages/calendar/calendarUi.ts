import type { Occurrence } from '@/features/calendar/occurrences';
import { addDays, isSameDay } from '@/utils/date';

export type CalendarView = 'month' | 'week' | 'day' | 'agenda';

export const SOURCE_COLORS = ['#a78bfa', '#93c5fd', '#86efac', '#fca5a5', '#fcd34d', '#f9a8d4', '#67e8f9', '#a1a1a6'];

export const AGENDA_DAYS = 30;

export function startOfWeek(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(s, -s.getDay());
}

export function timeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Compact time for month chips: "9a", "2:30p". */
export function shortTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`;
}

export function formatOccurrence(o: Occurrence): string {
  const dateOpts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
  if (o.allDay) {
    const last = addDays(o.end, -1);
    if (isSameDay(o.start, last) || last < o.start) return `${o.start.toLocaleDateString(undefined, dateOpts)} · All day`;
    return `${o.start.toLocaleDateString(undefined, dateOpts)} – ${last.toLocaleDateString(undefined, dateOpts)} · All day`;
  }
  if (isSameDay(o.start, o.end)) return `${o.start.toLocaleDateString(undefined, dateOpts)} · ${timeLabel(o.start)} – ${timeLabel(o.end)}`;
  return `${o.start.toLocaleDateString(undefined, dateOpts)} ${timeLabel(o.start)} – ${o.end.toLocaleDateString(undefined, dateOpts)} ${timeLabel(o.end)}`;
}

export function rangeTitle(view: CalendarView, cursor: Date): string {
  if (view === 'month') return cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  if (view === 'day') return cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const start = view === 'week' ? startOfWeek(cursor) : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
  const end = addDays(start, view === 'week' ? 6 : AGENDA_DAYS - 1);
  const mon = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  if (start.getFullYear() !== end.getFullYear()) return `${mon(start)} ${start.getDate()}, ${start.getFullYear()} – ${mon(end)} ${end.getDate()}, ${end.getFullYear()}`;
  if (start.getMonth() === end.getMonth()) return `${mon(start)} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  return `${mon(start)} ${start.getDate()} – ${mon(end)} ${end.getDate()}, ${end.getFullYear()}`;
}

/** Assign side-by-side lanes to overlapping timed segments (per day column). */
export function layoutLanes<T extends { start: number; end: number }>(items: T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: (T & { lane: number; lanes: number })[] = [];
  let cluster: (T & { lane: number; lanes: number })[] = [];
  let clusterEnd = -Infinity;
  const laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) c.lanes = lanes;
    out.push(...cluster);
    cluster = [];
    laneEnds.length = 0;
  };
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((e) => e <= it.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = it.end;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}
