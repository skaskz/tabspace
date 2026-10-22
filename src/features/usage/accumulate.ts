import type { UsageLog } from '@/types/models';
import { addDays, startOfDay, toDateKey } from '@/utils/date';

/**
 * Opt-in website usage tracking (settings.analytics.trackWebsites).
 *
 * Privacy: only the hostname of http(s) pages is ever recorded — never full
 * URLs, paths, queries or titles. The service worker keeps the current
 * "segment" (domain + start time) in chrome.storage.session, because the MV3
 * worker can be suspended at any time; elapsed time is computed from the stored
 * start when the next event arrives.
 */

/** A single segment can never count more than this (no idle permission, so this bounds AFK time). */
export const MAX_SEGMENT_MS = 30 * 60_000;
export const USAGE_RETENTION_DAYS = 120;

export interface UsageSegment {
  domain: string;
  start: number;
}

/** Hostname to record for a URL, or null for anything that is not an http(s) page. */
export function usageDomain(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Add the time between `start` and `end` for `domain` to the log (immutably).
 * The segment is capped at `capMs` and split across local midnights so each
 * day gets the time actually spent on it.
 */
export function addSegment(log: UsageLog, domain: string, start: number, end: number, capMs = MAX_SEGMENT_MS): UsageLog {
  if (!domain || !(end > start)) return log;
  const stop = Math.min(end, start + capMs);
  const next: UsageLog = { ...log };
  let cursor = start;
  while (cursor < stop) {
    const dayEnd = startOfDay(addDays(new Date(cursor), 1)).getTime();
    const segEnd = Math.min(stop, dayEnd);
    const key = toDateKey(cursor);
    const day = { ...(next[key] ?? {}) };
    day[domain] = (day[domain] ?? 0) + (segEnd - cursor);
    next[key] = day;
    cursor = segEnd;
  }
  return next;
}

/** Close the current segment (if any) at `now`. Returns the updated log. */
export function closeSegment(log: UsageLog, seg: UsageSegment | null | undefined, now: number, capMs = MAX_SEGMENT_MS): UsageLog {
  if (!seg) return log;
  return addSegment(log, seg.domain, seg.start, now, capMs);
}

/** Drop days older than `keepDays` (relative to `now`). */
export function pruneUsage(log: UsageLog, now: number = Date.now(), keepDays = USAGE_RETENTION_DAYS): UsageLog {
  const cutoff = toDateKey(addDays(new Date(now), -keepDays));
  const out: UsageLog = {};
  for (const [k, v] of Object.entries(log)) if (k >= cutoff) out[k] = v;
  return out;
}
