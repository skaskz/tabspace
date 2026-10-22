import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { unsatisfiableReason } from '@/features/calendar/rruleGuard';
import { parseIcs } from '@/features/calendar/ics';

const NOW = new Date('2026-10-21T12:00:00Z');
const rule = (s: string) => ICAL.Recur.fromString(s);
const cal = (rrule: string, dtstart = 'DTSTART:20261001T100000Z') =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:r\r\n${dtstart}\r\nRRULE:${rrule}\r\nSUMMARY:R\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

describe('RRULE satisfiability guard', () => {
  it.each([
    'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=31',
    'FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=MINUTELY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=SECONDLY;BYMONTH=2;BYMONTHDAY=30',
  ])('the reviewer’s hanging rule %s parses quickly to just DTSTART', (r) => {
    const t0 = performance.now();
    const out = parseIcs(cal(r), 's', { now: NOW });
    expect(performance.now() - t0).toBeLessThan(200);
    expect(out.events).toHaveLength(1);
    expect(out.events[0].start).toBe('2026-10-01T10:00:00.000Z');
    expect(out.truncated).toBe(true);
  });

  it.each([
    ['FREQ=YEARLY;BYMONTH=4,6,9,11;BYMONTHDAY=31', /never occurs/],
    ['FREQ=MONTHLY;BYDAY=6MO', /never occurs in a month/],
    ['FREQ=SECONDLY;BYMONTH=12', /sub-hourly/],
    ['FREQ=YEARLY;BYYEARDAY=60;BYMONTH=1', /unsupported/],
  ])('rejects %s', (r, reason) => {
    expect(unsatisfiableReason(rule(r))).toMatch(reason);
  });

  it.each(['FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', 'FREQ=MONTHLY;BYMONTHDAY=-1', 'FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13', 'FREQ=MONTHLY;BYDAY=-1FR', 'FREQ=YEARLY;BYMONTH=2;BYDAY=5MO', 'FREQ=WEEKLY;BYDAY=MO,WE', 'FREQ=YEARLY;BYWEEKNO=53', 'FREQ=YEARLY;BYYEARDAY=366', 'FREQ=MINUTELY;INTERVAL=15;BYHOUR=9'])(
    'accepts satisfiable %s',
    (r) => {
      expect(unsatisfiableReason(rule(r))).toBeNull();
    },
  );

  it.each(['FREQ=MONTHLY;BYMONTHDAY=-32', 'FREQ=YEARLY;BYWEEKNO=54', 'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=400', 'FREQ=DAILY;BYHOUR=24', 'FREQ=DAILY;BYMINUTE=60'])(
    'an out-of-range rule (%s) only drops that rule, not the whole feed',
    (r) => {
      const ics = cal(r).replace('END:VCALENDAR', 'BEGIN:VEVENT\r\nUID:ok\r\nDTSTART:20261022T090000Z\r\nSUMMARY:Fine\r\nEND:VEVENT\r\nEND:VCALENDAR');
      const out = parseIcs(ics, 's', { now: NOW });
      expect(out.events.map((e) => e.title).sort()).toEqual(['Fine', 'R']);
      expect(out.truncated).toBe(true);
    },
  );

  it('satisfiable edge cases still expand', () => {
    const feb29 = parseIcs(cal('FREQ=YEARLY', 'DTSTART;VALUE=DATE:20240229'), 's', { now: new Date('2027-10-21T12:00:00Z') });
    expect(feb29.events.map((e) => e.start)).toContain('2028-02-29');
    const lastDay = parseIcs(cal('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=4', 'DTSTART;VALUE=DATE:20261031'), 's', { now: NOW });
    expect(lastDay.events.map((e) => e.start)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
  });
});
