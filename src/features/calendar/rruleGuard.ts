import type ICAL from 'ical.js';

/**
 * ical.js 2.1.0 can loop forever *inside a single* `iterator.next()` when an RRULE can never
 * produce an occurrence (e.g. FREQ=DAILY;BYMONTH=2;BYMONTHDAY=31). Iteration budgets cannot
 * interrupt that, so every rule is checked here before expansion. The check is conservative:
 * anything out of range, provably impossible, or a combination we cannot prove satisfiable
 * returns a reason and the caller emits only the DTSTART instance.
 */

const MONTH_MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const FREQS = new Set(['SECONDLY', 'MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

type Parts = Record<string, unknown[] | undefined>;

function ints(list: unknown[] | undefined): number[] | null {
  if (!list) return [];
  const out: number[] = [];
  for (const v of list) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isInteger(n)) return null;
    out.push(n);
  }
  return out;
}

const inRange = (xs: number[], min: number, max: number) => xs.every((x) => x >= min && x <= max);
const signedInRange = (xs: number[], maxAbs: number) => xs.every((x) => x !== 0 && Math.abs(x) <= maxAbs);

/** BYDAY entries like "MO", "2TU", "-1FR" -> ordinal (0 = none). Null when malformed. */
function byDayOrdinals(list: unknown[] | undefined): number[] | null {
  if (!list) return [];
  const out: number[] = [];
  for (const v of list) {
    const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(String(v).trim());
    if (!m) return null;
    const n = m[1] ? Number(m[1]) : 0;
    if (m[1] && n === 0) return null;
    out.push(n);
  }
  return out;
}

/** Returns null when the rule is safe to expand, else a short reason. */
export function unsatisfiableReason(rule: ICAL.Recur | null | undefined): string | null {
  if (!rule) return 'missing rule';
  const freq = String(rule.freq ?? '').toUpperCase();
  if (!FREQS.has(freq)) return 'unknown FREQ';
  const interval = rule.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1) return 'bad INTERVAL';
  const parts = ((rule as unknown as { parts?: Parts }).parts ?? {}) as Parts;

  const months = ints(parts.BYMONTH);
  const monthDays = ints(parts.BYMONTHDAY);
  const yearDays = ints(parts.BYYEARDAY);
  const weekNos = ints(parts.BYWEEKNO);
  const setPos = ints(parts.BYSETPOS);
  const hours = ints(parts.BYHOUR);
  const minutes = ints(parts.BYMINUTE);
  const seconds = ints(parts.BYSECOND);
  const days = byDayOrdinals(parts.BYDAY);
  if (!months || !monthDays || !yearDays || !weekNos || !setPos || !hours || !minutes || !seconds || !days) return 'malformed BY* value';

  if (!inRange(months, 1, 12)) return 'BYMONTH out of range';
  if (!signedInRange(monthDays, 31)) return 'BYMONTHDAY out of range';
  if (!signedInRange(yearDays, 366)) return 'BYYEARDAY out of range';
  if (!signedInRange(weekNos, 53)) return 'BYWEEKNO out of range';
  if (!signedInRange(setPos, 366)) return 'BYSETPOS out of range';
  if (!inRange(hours, 0, 23)) return 'BYHOUR out of range';
  if (!inRange(minutes, 0, 59)) return 'BYMINUTE out of range';
  if (!inRange(seconds, 0, 60)) return 'BYSECOND out of range';
  if (!days.every((n) => Math.abs(n) <= 53)) return 'BYDAY ordinal out of range';

  // Some BYMONTH month must be able to contain some BYMONTHDAY.
  if (months.length && monthDays.length) {
    const ok = months.some((m) => monthDays.some((d) => Math.abs(d) <= MONTH_MAX_DAYS[m - 1]));
    if (!ok) return 'BYMONTHDAY never occurs in BYMONTH';
  }
  // Ordinal weekdays within a month (MONTHLY, or YEARLY narrowed by BYMONTH) exist at most 5 times.
  const monthScoped = freq === 'MONTHLY' || (freq === 'YEARLY' && months.length > 0);
  if (monthScoped && days.some((n) => Math.abs(n) > 5)) return 'BYDAY ordinal never occurs in a month';
  if (freq !== 'MONTHLY' && freq !== 'YEARLY' && days.some((n) => n !== 0)) return 'BYDAY ordinal not allowed for this FREQ';

  // ical.js walks sub-daily rules unit by unit, so a date filter can cost tens of millions of steps in one
  // next() call (measured: SECONDLY;BYMONTH=2;BYMONTHDAY=29 ≈ 38 s). Refuse date filters below HOURLY.
  if ((freq === 'MINUTELY' || freq === 'SECONDLY') && (months.length || monthDays.length || yearDays.length || weekNos.length || days.length)) {
    return 'date filters on a sub-hourly rule';
  }
  // Combinations whose satisfiability we cannot prove cheaply: refuse rather than risk a hang.
  if (yearDays.length && (months.length || monthDays.length || weekNos.length)) return 'unsupported BYYEARDAY combination';
  if (weekNos.length && (freq !== 'YEARLY' || months.length || monthDays.length)) return 'unsupported BYWEEKNO combination';
  if (yearDays.length && (freq === 'DAILY' || freq === 'WEEKLY' || freq === 'MONTHLY')) return 'BYYEARDAY not allowed for this FREQ';
  return null;
}
