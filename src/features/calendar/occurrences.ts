import type { CalendarEvent, CalendarSource } from '@/types/models';
import { addDays, fromDateKey, startOfDay } from '@/utils/date';

/**
 * CONTRACT (owned by Integrations agent; signature is shared with Dashboard):
 * Expand stored events into concrete occurrences within [rangeStart, rangeEnd).
 * Disabled sources are excluded. Local simple recurrences are expanded here;
 * external (ICS/Google) recurrences are already expanded at sync time.
 */
export interface Occurrence {
  event: CalendarEvent;
  source?: CalendarSource;
  start: Date;
  end: Date;
  allDay: boolean;
  /** Stable key for React lists. */
  key: string;
}

export function eventBounds(e: CalendarEvent): { start: Date; end: Date } {
  if (e.allDay) {
    const start = fromDateKey(e.start.slice(0, 10));
    const end = e.end ? fromDateKey(e.end.slice(0, 10)) : addDays(start, 1);
    return { start, end: end <= start ? addDays(start, 1) : end };
  }
  const start = new Date(e.start);
  const end = e.end ? new Date(e.end) : new Date(start.getTime() + 3600_000);
  return { start, end: end < start ? start : end };
}

function step(d: Date, rec: CalendarEvent['recurrence'], n: number): Date {
  const out = new Date(d);
  if (rec === 'daily') out.setDate(out.getDate() + n);
  else if (rec === 'weekly') out.setDate(out.getDate() + 7 * n);
  else if (rec === 'monthly') out.setMonth(out.getMonth() + n);
  else if (rec === 'yearly') out.setFullYear(out.getFullYear() + n);
  return out;
}

export function getOccurrences(events: CalendarEvent[], sources: CalendarSource[], rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out: Occurrence[] = [];
  for (const event of events) {
    const source = byId.get(event.sourceId);
    if (source && !source.enabled) continue;
    const { start, end } = eventBounds(event);
    const length = end.getTime() - start.getTime();
    if (!event.recurrence || event.recurrence === 'none') {
      if (start < rangeEnd && end > rangeStart) out.push({ event, source, start, end, allDay: event.allDay, key: event.id });
      continue;
    }
    // Recurring local event: walk forward from the first occurrence (bounded).
    for (let i = 0; i < 2000; i++) {
      const s = step(start, event.recurrence, i);
      if (s >= rangeEnd) break;
      const e = new Date(s.getTime() + length);
      if (e > rangeStart) out.push({ event, source, start: s, end: e, allDay: event.allDay, key: `${event.id}:${i}` });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
}

/** Occurrences touching a given local day. */
export function occurrencesOnDay(all: Occurrence[], day: Date): Occurrence[] {
  const s = startOfDay(day);
  const e = addDays(s, 1);
  return all.filter((o) => o.start < e && o.end > s);
}
