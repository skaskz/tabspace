import { describe, expect, it } from 'vitest';
import { eventToForm, formToEvent, newEventForm } from '@/features/calendar/editor';
import { eventBounds, getOccurrences } from '@/features/calendar/occurrences';
import type { CalendarEvent } from '@/types/models';

describe('event editor conversion', () => {
  it('stores timed events as UTC ISO and round-trips to local form values', () => {
    const form = { ...newEventForm(new Date(2026, 9, 22), 'src', new Date(2026, 9, 1)), title: 'Content shoot', startTime: '14:00', endTime: '16:00' };
    const r = formToEvent(form);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.start).toBe(new Date(2026, 9, 22, 14, 0).toISOString());
    expect(r.value.start.endsWith('Z')).toBe(true);
    const back = eventToForm({ ...r.value, id: 'e', createdAt: 0, updatedAt: 0 });
    expect(back).toMatchObject({ startDate: '2026-10-22', startTime: '14:00', endTime: '16:00', title: 'Content shoot' });
  });

  it('stores all-day events with an exclusive end date and shows it inclusive', () => {
    const r = formToEvent({ ...newEventForm(new Date(2026, 9, 30), 'src'), title: 'Offsite', allDay: true, endDate: '2026-10-31' });
    if (!r.ok) throw new Error(r.error);
    expect(r.value).toMatchObject({ allDay: true, start: '2026-10-30', end: '2026-11-01' });
    const ev: CalendarEvent = { ...r.value, id: 'e', createdAt: 0, updatedAt: 0 };
    expect(eventToForm(ev).endDate).toBe('2026-10-31');
    const { start, end } = eventBounds(ev);
    expect(end.getTime() - start.getTime()).toBeGreaterThanOrEqual(2 * 86_400_000 - 3600_000);
  });

  it('validates input', () => {
    const f = newEventForm(new Date(2026, 9, 22), 'src');
    expect(formToEvent({ ...f, title: '  ' })).toEqual({ ok: false, error: 'Give the event a title.' });
    expect(formToEvent({ ...f, title: 'x', endTime: '00:00', endDate: f.startDate, startTime: '10:00' }).ok).toBe(false);
    expect(formToEvent({ ...f, title: 'x', sourceId: '' }).ok).toBe(false);
  });

  it('keeps local wall time for weekly events across DST', () => {
    const r = formToEvent({ ...newEventForm(new Date(2026, 9, 26), 'src'), title: 'Gym', startTime: '07:00', endTime: '08:00', recurrence: 'weekly' });
    if (!r.ok) throw new Error(r.error);
    const occ = getOccurrences([{ ...r.value, id: 'g', createdAt: 0, updatedAt: 0 }], [], new Date(2026, 9, 25), new Date(2026, 10, 20));
    expect(occ.map((o) => o.start.getHours())).toEqual([7, 7, 7, 7]);
  });
});
