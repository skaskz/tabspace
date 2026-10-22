import { describe, expect, it } from 'vitest';
import { focusStreak, focusTimeOn, sessionsOn } from '@/features/focus/stats';
import type { FocusKind, FocusSessionRecord } from '@/types/models';

const MIN = 60_000;
let n = 0;
/** Record ending at local y-m-d h:mm. */
function rec(y: number, m: number, d: number, opts: { h?: number; min?: number; kind?: FocusKind; completed?: boolean; actualMin?: number } = {}): FocusSessionRecord {
  const end = new Date(y, m - 1, d, opts.h ?? 12, opts.min ?? 0).getTime();
  const actual = (opts.actualMin ?? 25) * MIN;
  return { id: `r${n++}`, createdAt: end, updatedAt: end, kind: opts.kind ?? 'focus', startedAt: end - actual, endedAt: end, plannedMs: 25 * MIN, actualMs: actual, completed: opts.completed ?? true };
}

describe('sessionsOn / focusTimeOn', () => {
  const records = [
    rec(2026, 10, 21, { h: 9 }),
    rec(2026, 10, 21, { h: 11, kind: 'custom', actualMin: 50 }),
    rec(2026, 10, 21, { h: 13, completed: false, actualMin: 10 }),
    rec(2026, 10, 21, { h: 14, kind: 'short', actualMin: 5 }),
    rec(2026, 10, 20, { h: 23, min: 59 }),
  ];
  it('counts only completed focus/custom sessions of that local day', () => {
    expect(sessionsOn(records, '2026-10-21')).toBe(2);
    expect(sessionsOn(records, '2026-10-20')).toBe(1);
    expect(sessionsOn(records, '2026-10-19')).toBe(0);
  });
  it('sums focus time including stopped sessions, excluding breaks', () => {
    expect(focusTimeOn(records, '2026-10-21')).toBe(85 * MIN);
  });
});

describe('focusStreak', () => {
  const today = new Date(2026, 9, 21, 15, 0);

  it('is 0 with no history', () => {
    expect(focusStreak([], today)).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    expect(focusStreak([rec(2026, 10, 21), rec(2026, 10, 20), rec(2026, 10, 19), rec(2026, 10, 17)], today)).toBe(3);
  });

  it('keeps the streak alive when today has no session yet', () => {
    expect(focusStreak([rec(2026, 10, 20), rec(2026, 10, 19)], today)).toBe(2);
  });

  it('is broken by a fully missed day', () => {
    expect(focusStreak([rec(2026, 10, 19), rec(2026, 10, 18)], today)).toBe(0);
  });

  it('ignores incomplete sessions and breaks', () => {
    expect(focusStreak([rec(2026, 10, 21, { completed: false }), rec(2026, 10, 20, { kind: 'long' })], today)).toBe(0);
  });

  it('counts multiple sessions on one day once', () => {
    expect(focusStreak([rec(2026, 10, 21, { h: 8 }), rec(2026, 10, 21, { h: 20 }), rec(2026, 10, 20)], today)).toBe(2);
  });

  it('walks across DST transitions by calendar day (spring forward and fall back)', () => {
    // US DST changes: 2026-03-08 (23h day) and 2026-11-01 (25h day). Sessions near midnight.
    const spring = [rec(2026, 3, 9, { h: 0, min: 30 }), rec(2026, 3, 8, { h: 23, min: 30 }), rec(2026, 3, 7, { h: 0, min: 10 })];
    expect(focusStreak(spring, new Date(2026, 2, 9, 10))).toBe(3);
    const fall = [rec(2026, 11, 2, { h: 0, min: 5 }), rec(2026, 11, 1, { h: 23, min: 55 }), rec(2026, 10, 31, { h: 0, min: 1 })];
    expect(focusStreak(fall, new Date(2026, 10, 2, 9))).toBe(3);
  });

  it('accepts a timestamp for now', () => {
    expect(focusStreak([rec(2026, 10, 21)], today.getTime())).toBe(1);
  });
});
