import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { feedUrlProblem, HTML_NOT_ICS, IcsError, normalizeFeedUrl, parseIcs } from '@/features/calendar/ics';
import { zonedTimeToUtc } from '@/features/calendar/tz';

const fx = (name: string) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');
const NOW = new Date('2026-10-21T12:00:00Z');

describe('parseIcs', () => {
  it('parses a simple timed event as UTC instants', () => {
    const r = parseIcs(fx('simple.ics'), 'src1', { now: NOW });
    expect(r.calendarName).toBe('Team');
    expect(r.events).toHaveLength(1);
    const e = r.events[0];
    expect(e).toMatchObject({ sourceId: 'src1', title: 'Design review', location: 'Room 4', allDay: false });
    expect(e.start).toBe('2026-10-22T15:00:00.000Z');
    expect(e.end).toBe('2026-10-22T16:00:00.000Z');
    expect(e.externalId).toContain('simple-1@test');
    expect(e.id).toBe(`src1:${e.externalId}`);
    // Markup is preserved as inert text (React escapes it on render).
    expect(e.description).toBe('Bring <script>alert(1)</script> notes');
  });

  it('keeps all-day events as date keys with exclusive end', () => {
    const r = parseIcs(fx('allday.ics'), 's', { now: NOW });
    const offsite = r.events.find((e) => e.title === 'Offsite')!;
    expect(offsite).toMatchObject({ allDay: true, start: '2026-10-30', end: '2026-11-01' });
    const noEnd = r.events.find((e) => e.title === 'No end date')!;
    expect(noEnd).toMatchObject({ start: '2026-11-05', end: '2026-11-06' });
  });

  it('resolves TZID events across a DST change (VTIMEZONE and Intl fallback)', () => {
    const r = parseIcs(fx('tzid-dst.ics'), 's', { now: NOW });
    const standups = r.events.filter((e) => e.title === 'Standup across DST').map((e) => e.start);
    expect(standups).toEqual(['2026-10-26T13:00:00.000Z', '2026-11-02T14:00:00.000Z', '2026-11-09T14:00:00.000Z']);
    const berlin = r.events.find((e) => e.title === 'No VTIMEZONE Berlin')!;
    expect(berlin.start).toBe('2026-11-01T09:00:00.000Z');
    expect(berlin.end).toBe('2026-11-01T10:00:00.000Z');
  });

  it('expands weekly RRULE honouring EXDATE, moved overrides and cancelled instances', () => {
    const r = parseIcs(fx('weekly-exdate-override.ics'), 's', { now: NOW });
    const gym = r.events.filter((e) => e.title.startsWith('Gym'));
    expect(gym.map((e) => [e.title, e.start])).toEqual([
      ['Gym', '2026-10-05T17:00:00.000Z'],
      ['Gym (moved)', '2026-10-20T19:00:00.000Z'],
      ['Gym', '2026-11-02T17:00:00.000Z'],
    ]);
    // Stable, unique external ids per occurrence.
    expect(new Set(gym.map((e) => e.externalId)).size).toBe(3);
  });

  it('limits expansion to the window and applies the hard cap', () => {
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:daily\r\nDTSTART:20200101T080000Z\r\nDTEND:20200101T083000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Daily\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    const r = parseIcs(ics, 's', { now: NOW, daysBack: 10, daysAhead: 10 });
    expect(r.events.length).toBeGreaterThanOrEqual(20);
    expect(r.events.length).toBeLessThanOrEqual(22);
    const capped = parseIcs(ics, 's', { now: NOW, maxEvents: 5 });
    expect(capped.events).toHaveLength(5);
    expect(capped.truncated).toBe(true);
  });

  it('throws a friendly error for malformed files', () => {
    expect(() => parseIcs(fx('malformed.ics'), 's', { now: NOW })).toThrow(IcsError);
    expect(() => parseIcs('', 's')).toThrow(/empty/);
    expect(() => parseIcs('hello world', 's')).toThrow(/not a valid calendar/);
  });

  it('rejects HTML pages with a clear message', () => {
    expect(() => parseIcs(fx('page.html'), 's')).toThrow(HTML_NOT_ICS);
  });
});

describe('normalizeFeedUrl', () => {
  it('converts webcal to https and rejects unsafe schemes', () => {
    expect(normalizeFeedUrl('webcal://example.com/cal.ics')).toBe('https://example.com/cal.ics');
    expect(normalizeFeedUrl(' https://a.b/c.ics ')).toBe('https://a.b/c.ics');
    expect(normalizeFeedUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeFeedUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeFeedUrl('not a url')).toBeNull();
    expect(normalizeFeedUrl('http://example.com/cal.ics')).toBeNull();
    expect(feedUrlProblem('http://example.com/cal.ics')).toMatch(/unencrypted/);
    expect(feedUrlProblem('webcal://example.com/cal.ics')).toBeNull();
  });
});

describe('zonedTimeToUtc', () => {
  it('handles both sides of a DST transition', () => {
    expect(new Date(zonedTimeToUtc(2026, 7, 1, 12, 0, 0, 'America/Los_Angeles')).toISOString()).toBe('2026-07-01T19:00:00.000Z');
    expect(new Date(zonedTimeToUtc(2026, 12, 1, 12, 0, 0, 'America/Los_Angeles')).toISOString()).toBe('2026-12-01T20:00:00.000Z');
    // Ambiguous 01:30 on fall-back day resolves to the first (PDT) instance.
    expect(new Date(zonedTimeToUtc(2026, 11, 1, 1, 30, 0, 'America/Los_Angeles')).toISOString()).toBe('2026-11-01T08:30:00.000Z');
  });
});

describe('parseIcs resource limits', () => {
  const cal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
  const vevent = (uid: string, lines: string) => `BEGIN:VEVENT\r\nUID:${uid}\r\n${lines}END:VEVENT\r\n`;

  it('fast-forwards ancient series and still yields the correct in-window instances', () => {
    const ics = cal(
      vevent('daily', 'DTSTART:19500101T100000Z\r\nDTEND:19500101T103000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Daily\r\n') +
        vevent('weekly', 'DTSTART;TZID=Europe/Berlin:20000103T090000\r\nDTEND;TZID=Europe/Berlin:20000103T100000\r\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH\r\nSUMMARY:Weekly\r\n') +
        vevent('monthly', 'DTSTART;VALUE=DATE:19900115\r\nRRULE:FREQ=MONTHLY\r\nSUMMARY:Monthly\r\n') +
        vevent('yearly', 'DTSTART;VALUE=DATE:19601022\r\nRRULE:FREQ=YEARLY\r\nSUMMARY:Birthday\r\n'),
    );
    const t0 = performance.now();
    const r = parseIcs(ics, 's', { now: NOW, daysBack: 7, daysAhead: 30 });
    expect(performance.now() - t0).toBeLessThan(1000 * Number(process.env.TS_PERF_SLACK ?? 1));
    const by = (t: string) => r.events.filter((e) => e.title === t);
    expect(by('Daily')).toHaveLength(37); // Oct 15 – Nov 20 at 10:00Z
    expect(by('Daily').every((e) => e.start.endsWith('T10:00:00.000Z'))).toBe(true);
    expect(by('Monthly').map((e) => e.start)).toEqual(['2026-10-15', '2026-11-15']);
    expect(by('Birthday').map((e) => e.start)).toEqual(['2026-10-22']);
    // Biweekly Mon/Thu anchored on Mon 2000-01-03: 2026-10-19 is an "on" week (1398 weeks later = even).
    const weekly = by('Weekly').map((e) => e.start.slice(0, 10));
    expect(weekly.slice(0, 4)).toEqual(['2026-10-19', '2026-10-22', '2026-11-02', '2026-11-05']);
  });

  it('a hostile feed (thousands of ancient/huge series) parses in under 2 s', () => {
    let body = '';
    for (let i = 0; i < 1500; i++) body += vevent(`s${i}`, `DTSTART:19500101T100000Z\r\nRRULE:FREQ=MINUTELY;COUNT=99999999\r\nSUMMARY:x\r\n`);
    for (let i = 0; i < 1500; i++) body += vevent(`n${i}`, `DTSTART:19500101T100000Z\r\nRRULE:FREQ=SECONDLY;UNTIL=19500102T000000Z\r\nSUMMARY:y\r\n`);
    const t0 = performance.now();
    const r = parseIcs(cal(body), 's', { now: NOW });
    expect(performance.now() - t0).toBeLessThan(2000 * Number(process.env.TS_PERF_SLACK ?? 1));
    expect(r.truncated).toBe(true);
  });

  it('caps the number of VEVENTs read', () => {
    let body = '';
    for (let i = 0; i < 50; i++) body += vevent(`e${i}`, `DTSTART:20261022T100000Z\r\nSUMMARY:e\r\n`);
    const r = parseIcs(cal(body), 's', { now: NOW, maxVevents: 10 });
    expect(r.events).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });
});
