/**
 * Time-zone helpers built on Intl (no tz database bundled).
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** True when `tz` is an IANA zone name Intl understands. */
export function isValidTimeZone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function offsetAt(tz: string, utcMs: number): number {
  const parts = formatter(tz).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Convert a wall-clock time in an IANA zone to a UTC instant (ms).
 * Non-existent times (spring-forward gap) resolve forward; ambiguous times
 * (fall-back overlap) resolve to the earlier instant — matching RFC 5545.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, tz: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two-pass offset resolution.
  const o1 = offsetAt(tz, wall);
  let guess = wall - o1;
  const o2 = offsetAt(tz, guess);
  if (o2 !== o1) {
    const alt = wall - o2;
    // Prefer a candidate that maps back to the requested wall time.
    if (offsetAt(tz, alt) === o2) guess = alt;
  }
  // Ambiguous: check whether an earlier instant also maps to this wall time.
  const earlier = guess - 3600_000;
  if (offsetAt(tz, earlier) + earlier === wall) return earlier;
  return guess;
}
