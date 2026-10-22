import ICAL from 'ical.js';
import type { CalendarEvent } from '@/types/models';
import { isValidTimeZone, zonedTimeToUtc } from './tz';
import { unsatisfiableReason } from './rruleGuard';

/**
 * ICS (RFC 5545) parsing with ical.js.
 *
 * - Timed events are stored as ISO UTC instants; all-day events as `YYYY-MM-DD`
 *   (end exclusive, as in DTEND;VALUE=DATE).
 * - TZIDs resolve through in-file VTIMEZONE definitions; when a feed references
 *   an IANA zone without a VTIMEZONE we fall back to Intl; unknown zones and
 *   floating times are treated as the viewer's local time.
 * - Recurrences (RRULE/RDATE/EXDATE + RECURRENCE-ID overrides) are expanded
 *   within a window with hard caps so a hostile feed cannot exhaust memory.
 */

export class IcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcsError';
  }
}

export const ICS_MAX_BYTES = 5 * 1024 * 1024;
export const HTML_NOT_ICS = 'This looks like a web page, not an ICS feed.';

export type ParsedEvent = Omit<CalendarEvent, 'createdAt' | 'updatedAt'>;

export interface ParseOptions {
  now?: Date;
  /** Days before `now` to include (default 90). */
  daysBack?: number;
  /** Days after `now` to include (default 400). */
  daysAhead?: number;
  /** Hard cap on total produced events (default 5000). */
  maxEvents?: number;
  /** Hard cap on iterations per recurring series (default 3000). */
  maxIterations?: number;
  /** Hard cap on recurrence iterations across the whole file (default 30000). */
  maxTotalIterations?: number;
  /** Hard cap on VEVENT components read (default 20000). */
  maxVevents?: number;
}

export interface ParseResult {
  calendarName?: string;
  events: ParsedEvent[];
  /** True when caps cut the expansion short. */
  truncated: boolean;
}

export const INSECURE_FEED = 'Plain http:// feeds are not supported — the private link would travel unencrypted. Use the https:// (or webcal://) address.';

/** A friendly reason why a feed URL is unusable, or null when it is fine. */
export function feedUrlProblem(input: string): string | null {
  if (input.trim().toLowerCase().startsWith('http://')) return INSECURE_FEED;
  return normalizeFeedUrl(input) ? null : 'Enter a valid https:// or webcal:// calendar URL.';
}

/** Convert `webcal://` to `https://` and validate the feed URL (https only). Returns null if unusable. */
export function normalizeFeedUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const converted = trimmed.replace(/^webcals?:\/\//i, 'https://');
  try {
    const url = new URL(converted);
    if (url.protocol !== 'https:') return null; // never send a private feed link over plain http
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Remove a leading UTF-8 byte-order mark. */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Quick sniff: throws a friendly IcsError when the text is clearly not a calendar. */
export function assertLooksLikeIcs(text: string): void {
  const head = stripBom(text).trimStart().slice(0, 512).toLowerCase();
  if (head.startsWith('begin:vcalendar')) return;
  if (head.startsWith('<') || /<(html|head|body|script)[\s>]/.test(head)) {
    throw new IcsError(HTML_NOT_ICS);
  }
  {
    throw new IcsError('This file is not a valid calendar (missing BEGIN:VCALENDAR).');
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKey(t: ICAL.Time): string {
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}

/** Convert an ical.js Time to a UTC ISO string, honouring zones (see module doc). */
export function timeToIso(t: ICAL.Time, tzid?: string | null): string {
  const zone = t.zone;
  if (zone && zone.tzid !== 'floating') {
    // UTC or a VTIMEZONE-backed zone: ical.js computes the instant itself.
    return new Date(t.toUnixTime() * 1000).toISOString();
  }
  if (tzid && isValidTimeZone(tzid)) {
    return new Date(zonedTimeToUtc(t.year, t.month, t.day, t.hour, t.minute, t.second, tzid)).toISOString();
  }
  return new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second).toISOString();
}

const DAY_MS = 86_400_000;
const FIXED_UNIT_MS: Record<string, number> = { SECONDLY: 1000, MINUTELY: 60_000, HOURLY: 3_600_000, DAILY: DAY_MS, WEEKLY: 7 * DAY_MS };

function approxMs(t: ICAL.Time, tzid?: string | null): number {
  return t.isDate ? new Date(t.year, t.month - 1, t.day).getTime() : Date.parse(timeToIso(t, tzid));
}

/**
 * For a series that starts long before the window, return a new DTSTART that keeps the
 * rule's phase (a whole number of FREQ×INTERVAL steps later) and lies safely before
 * `windowStart`, so iteration does not burn through years of past instances.
 * Returns null when skipping is not provably safe (COUNT, several RRULEs, RDATE, or
 * month/year steps from a day that cannot be shifted without clamping).
 */
export function fastForwardStart(ev: ICAL.Event, windowStart: Date, tzid?: string | null): ICAL.Time | null {
  const comp = ev.component;
  const rules = comp.getAllProperties('rrule');
  if (rules.length !== 1 || comp.hasProperty('rdate')) return null;
  const rule = rules[0].getFirstValue() as ICAL.Recur | null;
  if (!rule || !rule.freq || rule.count) return null;
  const start = ev.startDate;
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  const startMs = approxMs(start, tzid);
  let durMs = 0;
  try {
    durMs = Math.max(0, ev.duration.toSeconds() * 1000);
  } catch {
    /* ignore */
  }
  const fixed = FIXED_UNIT_MS[rule.freq];
  const stepMs = (fixed ?? (rule.freq === 'MONTHLY' ? 31 * DAY_MS : 366 * DAY_MS)) * interval;
  // Land at least two steps (and the event length) before the window, plus a day of DST/zone slack.
  const target = windowStart.getTime() - durMs - 2 * stepMs - DAY_MS;
  if (startMs >= target) return null;
  const t = start.clone();
  if (fixed) {
    const steps = Math.floor((target - startMs) / stepMs);
    if (steps <= 0) return null;
    const units = steps * interval;
    if (rule.freq === 'WEEKLY') t.day += units * 7;
    else if (rule.freq === 'DAILY') t.day += units;
    else if (rule.freq === 'HOURLY') t.hour += units;
    else if (rule.freq === 'MINUTELY') t.minute += units;
    else t.second += units;
  } else if (rule.freq === 'MONTHLY') {
    if (start.day > 28) return null;
    const tgt = new Date(target);
    const months = tgt.getFullYear() * 12 + tgt.getMonth() - (start.year * 12 + start.month - 1) - 1;
    const k = Math.floor(months / interval);
    if (k <= 0) return null;
    t.month += k * interval;
  } else if (rule.freq === 'YEARLY') {
    if (start.month === 2 && start.day === 29) return null;
    const years = new Date(target).getFullYear() - start.year - 1;
    const k = Math.floor(years / interval);
    if (k <= 0) return null;
    t.year += k * interval;
  } else return null;
  return approxMs(t, tzid) < windowStart.getTime() ? t : null;
}

/** Remove RRULE/EXRULE lines ical.js cannot parse. Unfolds continuation lines first. */
export function dropInvalidRules(input: string): { text: string; dropped: boolean } {
  let dropped = false;
  const lines = input.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const kept = lines.filter((line) => {
    const m = /^(?:RRULE|EXRULE)(?:;[^:]*)?:(.*)$/i.exec(line);
    if (!m) return true;
    try {
      ICAL.Recur.fromString(m[1]);
      return true;
    } catch {
      dropped = true;
      return false;
    }
  });
  return { text: kept.join('\r\n'), dropped };
}

function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, 5000) : undefined;
}

export function parseIcs(input: string, sourceId: string, opts: ParseOptions = {}): ParseResult {
  if (typeof input !== 'string' || !input.trim()) throw new IcsError('The calendar file is empty.');
  if (input.length > ICS_MAX_BYTES * 2) throw new IcsError('The calendar file is too large (max 5 MB).');
  assertLooksLikeIcs(input);

  let root: ICAL.Component;
  let droppedRules = false;
  try {
    root = new ICAL.Component(ICAL.parse(stripBom(input)));
  } catch {
    // ical.js rejects the whole document for one invalid RRULE value (e.g. BYHOUR=24).
    // Retry with such rules removed, so those events keep only their first instance.
    const cleaned = dropInvalidRules(stripBom(input));
    try {
      if (!cleaned.dropped) throw new Error('not a rule problem');
      root = new ICAL.Component(ICAL.parse(cleaned.text));
      droppedRules = true;
    } catch {
      throw new IcsError('This calendar file could not be read — it appears to be corrupted or not in iCalendar format.');
    }
  }
  const vcal = root.name === 'vcalendar' ? root : root.getFirstSubcomponent('vcalendar');
  if (!vcal) throw new IcsError('This file is not a valid calendar (no VCALENDAR found).');

  const now = opts.now ?? new Date();
  const windowStart = new Date(now.getTime() - (opts.daysBack ?? 90) * 86_400_000);
  const windowEnd = new Date(now.getTime() + (opts.daysAhead ?? 400) * 86_400_000);
  const maxEvents = opts.maxEvents ?? 5000;
  const maxIterations = opts.maxIterations ?? 3_000;
  let budget = opts.maxTotalIterations ?? 30_000;
  const maxVevents = opts.maxVevents ?? 20_000;

  const out: ParsedEvent[] = [];
  const seen = new Set<string>();
  let truncated = droppedRules;

  const allVevents = vcal.getAllSubcomponents('vevent');
  const vevents = allVevents.length > maxVevents ? allVevents.slice(0, maxVevents) : allVevents;
  if (vevents.length < allVevents.length) truncated = true;
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  const exceptionsByUid = new Map<string, ICAL.Event[]>();
  const orphans: ICAL.Event[] = [];

  for (let idx = 0; idx < vevents.length; idx++) {
    const comp = vevents[idx];
    let ev: ICAL.Event;
    try {
      ev = new ICAL.Event(comp);
      if (!ev.startDate) continue;
    } catch {
      continue; // skip individual malformed events
    }
    if (!ev.uid) ev.uid = `nouid-${idx}`;
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else if (masters.has(ev.uid)) orphans.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) {
      try {
        master.relateException(ex);
        exceptionsByUid.set(ex.uid, [...(exceptionsByUid.get(ex.uid) ?? []), ex]);
      } catch {
        orphans.push(ex);
      }
    } else orphans.push(ex);
  }

  const tzOf = (ev: ICAL.Event, prop: 'dtstart' | 'dtend') => ev.component.getFirstProperty(prop)?.getParameter('tzid') as string | null | undefined;

  const emit = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null, occurrenceKey: string) => {
    const status = String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase();
    if (status === 'CANCELLED') return;
    const allDay = start.isDate;
    let s: string;
    let e: string;
    if (allDay) {
      s = dateKey(start);
      if (end && end.isDate && end.compare(start) > 0) e = dateKey(end);
      else {
        const next = start.clone();
        next.day += 1;
        e = dateKey(next);
      }
    } else {
      s = timeToIso(start, tzOf(item, 'dtstart'));
      e = end ? timeToIso(end, tzOf(item, 'dtend') ?? tzOf(item, 'dtstart')) : s;
      if (e < s) e = s;
    }
    const startMs = allDay ? new Date(`${s}T00:00:00`).getTime() : Date.parse(s);
    const endMs = allDay ? new Date(`${e}T00:00:00`).getTime() : Date.parse(e);
    if (endMs < windowStart.getTime() || startMs > windowEnd.getTime()) return;
    const externalId = `${item.uid}::${occurrenceKey}`;
    if (seen.has(externalId)) return;
    seen.add(externalId);
    if (out.length >= maxEvents) {
      truncated = true;
      return;
    }
    out.push({
      id: `${sourceId}:${externalId}`,
      sourceId,
      externalId,
      title: text(item.summary) ?? '(No title)',
      description: text(item.description),
      location: text(item.location),
      start: s,
      end: e,
      allDay,
    });
  };

  for (const master of masters.values()) {
    if (out.length >= maxEvents) {
      truncated = true;
      break;
    }
    try {
      if (!master.isRecurring()) {
        emit(master, master.startDate, master.endDate, master.startDate.toString());
        continue;
      }
      if (budget <= 0) {
        truncated = true;
        break;
      }
      // Guard against rules ical.js would loop on forever inside a single next() call.
      const unsafe = master.component
        .getAllProperties('rrule')
        .map((p) => unsatisfiableReason(p.getFirstValue() as ICAL.Recur))
        .find(Boolean);
      if (unsafe) {
        emit(master, master.startDate, master.endDate, master.startDate.toString());
        truncated = true;
        continue;
      }
      const ff = fastForwardStart(master, windowStart, tzOf(master, 'dtstart'));
      if (ff) {
        // Overrides of skipped (past) slots may have been moved into the window.
        for (const ex of exceptionsByUid.get(master.uid) ?? []) {
          if (ex.recurrenceId && ex.recurrenceId.compare(ff) < 0) emit(ex, ex.startDate, ex.endDate, ex.recurrenceId.toString());
        }
      }
      const it = master.iterator(ff ?? undefined);
      for (let i = 0; i < maxIterations; i++) {
        if (budget-- <= 0) {
          truncated = true;
          break;
        }
        const next = it.next();
        if (!next) break;
        const details = master.getOccurrenceDetails(next);
        const startJs = details.startDate.isDate ? new Date(details.startDate.year, details.startDate.month - 1, details.startDate.day) : new Date(timeToIso(details.startDate, tzOf(details.item, 'dtstart')));
        // Overrides may move an instance; compare using the original slot too.
        const origJs = details.recurrenceId.isDate ? new Date(details.recurrenceId.year, details.recurrenceId.month - 1, details.recurrenceId.day) : new Date(timeToIso(details.recurrenceId, tzOf(master, 'dtstart')));
        if (startJs > windowEnd && origJs > windowEnd) break;
        emit(details.item, details.startDate, details.endDate, details.recurrenceId.toString());
        if (i === maxIterations - 1) truncated = true;
      }
    } catch {
      // A broken RRULE: fall back to the first instance only.
      emit(master, master.startDate, master.endDate, master.startDate.toString());
    }
  }
  for (const ev of orphans) {
    try {
      emit(ev, ev.startDate, ev.endDate, (ev.recurrenceId ?? ev.startDate).toString());
    } catch {
      /* skip */
    }
  }

  if (vevents.length > 0 && out.length === 0 && masters.size === 0 && orphans.length === 0) {
    throw new IcsError('No readable events were found in this calendar.');
  }

  const calendarName = text(vcal.getFirstPropertyValue('x-wr-calname'));
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { calendarName, events: out, truncated };
}
