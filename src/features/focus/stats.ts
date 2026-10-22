import type { FocusSessionRecord } from '@/types/models';
import { addDays, fromDateKey, toDateKey } from '@/utils/date';
import { countsAsFocus } from './timer';

/**
 * Pure focus statistics derived from real `ts.focusSessions` history.
 * Days are local calendar days (keys `YYYY-MM-DD`), attributed by the
 * session's end time, so DST changes never split or merge a day.
 */

function focusRecords(records: FocusSessionRecord[]): FocusSessionRecord[] {
  return records.filter((r) => countsAsFocus(r.kind));
}

/** Completed focus/custom sessions that ended on the given local day. */
export function sessionsOn(records: FocusSessionRecord[], dateKey: string): number {
  return focusRecords(records).filter((r) => r.completed && toDateKey(r.endedAt) === dateKey).length;
}

/** Focus time (ms) spent on the given local day, including sessions stopped early. */
export function focusTimeOn(records: FocusSessionRecord[], dateKey: string): number {
  return focusRecords(records)
    .filter((r) => toDateKey(r.endedAt) === dateKey)
    .reduce((sum, r) => sum + Math.max(0, r.actualMs), 0);
}

/**
 * Consecutive local days with at least one completed focus session, ending today.
 * If today has none *yet*, the streak still counts up to yesterday (it is not
 * broken until a whole day passes without a session).
 */
export function focusStreak(records: FocusSessionRecord[], now: Date | number = new Date()): number {
  const days = new Set(focusRecords(records).filter((r) => r.completed).map((r) => toDateKey(r.endedAt)));
  const today = toDateKey(now);
  // Walk calendar days via Date#setDate (DST-safe), never by subtracting 24h.
  let cursor = fromDateKey(today);
  if (!days.has(today)) cursor = addDays(cursor, -1);
  let streak = 0;
  while (days.has(toDateKey(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
