import type { CalendarEvent, Recurrence } from '@/types/models';
import { addDays, fromDateKey, toDateKey } from '@/utils/date';

/** Form model for the local event editor (all values in the viewer's local time). */
export interface EventForm {
  title: string;
  allDay: boolean;
  startDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endDate: string; // YYYY-MM-DD (inclusive for all-day)
  endTime: string; // HH:mm
  recurrence: Recurrence;
  reminderMinutes: number | null;
  location: string;
  description: string;
  workspaceId: string;
  sourceId: string;
}

export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'No reminder' },
  { value: 0, label: 'At start' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Default form for a new event on `day` (next whole hour if today, else 09:00). */
export function newEventForm(day: Date, sourceId: string, now = new Date()): EventForm {
  const key = toDateKey(day);
  let start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
  if (toDateKey(now) === key && now.getHours() < 23) start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), now.getHours() + 1, 0);
  const end = new Date(start.getTime() + 3600_000);
  return {
    title: '',
    allDay: false,
    startDate: key,
    startTime: hhmm(start),
    endDate: toDateKey(end),
    endTime: hhmm(end),
    recurrence: 'none',
    reminderMinutes: null,
    location: '',
    description: '',
    workspaceId: '',
    sourceId,
  };
}

export function eventToForm(e: CalendarEvent): EventForm {
  if (e.allDay) {
    const start = fromDateKey(e.start.slice(0, 10));
    const endExcl = e.end ? fromDateKey(e.end.slice(0, 10)) : addDays(start, 1);
    const endIncl = endExcl > start ? addDays(endExcl, -1) : start;
    return {
      title: e.title,
      allDay: true,
      startDate: toDateKey(start),
      startTime: '09:00',
      endDate: toDateKey(endIncl),
      endTime: '10:00',
      recurrence: e.recurrence ?? 'none',
      reminderMinutes: e.reminderMinutes ?? null,
      location: e.location ?? '',
      description: e.description ?? '',
      workspaceId: e.workspaceId ?? '',
      sourceId: e.sourceId,
    };
  }
  const s = new Date(e.start);
  const en = new Date(e.end || e.start);
  return {
    title: e.title,
    allDay: false,
    startDate: toDateKey(s),
    startTime: hhmm(s),
    endDate: toDateKey(en),
    endTime: hhmm(en),
    recurrence: e.recurrence ?? 'none',
    reminderMinutes: e.reminderMinutes ?? null,
    location: e.location ?? '',
    description: e.description ?? '',
    workspaceId: e.workspaceId ?? '',
    sourceId: e.sourceId,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type FormResult =
  | { ok: true; value: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'> }
  | { ok: false; error: string };

/** Validate the form and convert to stored values (UTC ISO instants / exclusive all-day end). */
export function formToEvent(f: EventForm): FormResult {
  const title = f.title.trim();
  if (!title) return { ok: false, error: 'Give the event a title.' };
  if (!f.sourceId) return { ok: false, error: 'Choose a calendar.' };
  if (!DATE_RE.test(f.startDate) || !DATE_RE.test(f.endDate)) return { ok: false, error: 'Enter valid dates.' };
  let start: string;
  let end: string;
  if (f.allDay) {
    if (f.endDate < f.startDate) return { ok: false, error: 'End date must be on or after the start date.' };
    start = f.startDate;
    end = toDateKey(addDays(fromDateKey(f.endDate), 1));
  } else {
    if (!TIME_RE.test(f.startTime) || !TIME_RE.test(f.endTime)) return { ok: false, error: 'Enter valid times.' };
    const [sy, sm, sd] = f.startDate.split('-').map(Number);
    const [ey, em, ed] = f.endDate.split('-').map(Number);
    const [sh, smin] = f.startTime.split(':').map(Number);
    const [eh, emin] = f.endTime.split(':').map(Number);
    const s = new Date(sy, sm - 1, sd, sh, smin);
    const e = new Date(ey, em - 1, ed, eh, emin);
    if (e.getTime() < s.getTime()) return { ok: false, error: 'End must be after the start.' };
    start = s.toISOString();
    end = e.toISOString();
  }
  return {
    ok: true,
    value: {
      sourceId: f.sourceId,
      title: title.slice(0, 300),
      allDay: f.allDay,
      start,
      end,
      recurrence: f.recurrence === 'none' ? undefined : f.recurrence,
      reminderMinutes: f.reminderMinutes ?? undefined,
      location: f.location.trim() || undefined,
      description: f.description.trim() || undefined,
      workspaceId: f.workspaceId || undefined,
    },
  };
}
