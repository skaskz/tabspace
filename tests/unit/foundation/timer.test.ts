import { describe, expect, it } from 'vitest';
import * as t from '@/features/focus/timer';
import { DEFAULT_SETTINGS } from '@/storage/schema';

const MIN = 60_000;

describe('focus timer', () => {
  it('derives remaining time from endAt, not ticks', () => {
    const s = t.start('focus', 25 * MIN, 1_000_000);
    expect(t.remainingMs(s, 1_000_000)).toBe(25 * MIN);
    expect(t.remainingMs(s, 1_000_000 + 10 * MIN)).toBe(15 * MIN);
    expect(t.remainingMs(s, 1_000_000 + 99 * MIN)).toBe(0);
  });

  it('pause freezes remaining time and resume shifts endAt', () => {
    const s = t.start('focus', 25 * MIN, 0);
    const p = t.pause(s, 5 * MIN);
    expect(p.status).toBe('paused');
    expect(t.remainingMs(p, 50 * MIN)).toBe(20 * MIN);
    const r = t.resume(p, 60 * MIN);
    expect(r.endAt).toBe(80 * MIN);
    expect(t.remainingMs(r, 70 * MIN)).toBe(10 * MIN);
  });

  it('pause/resume are no-ops in the wrong state', () => {
    const idle = t.select('focus', 25 * MIN);
    expect(t.pause(idle)).toBe(idle);
    expect(t.resume(idle)).toBe(idle);
  });

  it('detects finished sessions', () => {
    const s = t.start('focus', MIN, 0);
    expect(t.isFinished(s, MIN - 1)).toBe(false);
    expect(t.isFinished(s, MIN)).toBe(true);
  });

  it('clamps custom durations', () => {
    expect(t.clampMinutes(0)).toBe(1);
    expect(t.clampMinutes(999)).toBe(240);
    expect(t.clampMinutes(Number.NaN)).toBe(25);
    expect(t.durationFor('short', DEFAULT_SETTINGS.focus)).toBe(5 * MIN);
  });

  it('builds history records, ignoring sub-minute abandoned sessions', () => {
    const s = t.start('focus', 25 * MIN, 0);
    expect(t.toRecord(s, 30_000, false, 'a')).toBeNull();
    const partial = t.toRecord(s, 10 * MIN, false, 'b');
    expect(partial?.actualMs).toBe(10 * MIN);
    expect(partial?.completed).toBe(false);
    expect(t.toRecord(s, 25 * MIN, true, 'c')?.actualMs).toBe(25 * MIN);
    expect(t.toRecord(t.select('focus', MIN), 0, true, 'd')).toBeNull();
  });

  it('formats a compact badge and progress', () => {
    const s = t.start('focus', 25 * MIN, 0);
    expect(t.badgeText(s, 0)).toBe('25m');
    expect(t.badgeText(s, MIN + 1)).toBe('24m');
    expect(t.badgeText(t.select('focus', MIN))).toBe('');
    expect(t.progress(s, 12.5 * MIN)).toBeCloseTo(0.5);
  });
});
