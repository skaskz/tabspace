import { describe, expect, it } from 'vitest';
import * as t from '@/features/focus/timer';

const MIN = 60_000;

describe('badge text', () => {
  it('is empty when idle, minutes (rounded up) when running, a pause glyph when paused', () => {
    expect(t.badgeText(t.select('focus', 25 * MIN))).toBe('');
    const s = t.start('focus', 25 * MIN, 0);
    expect(t.badgeText(s, 0)).toBe('25m');
    expect(t.badgeText(s, 30_000)).toBe('25m');
    expect(t.badgeText(s, MIN + 1)).toBe('24m');
    expect(t.badgeText(s, 25 * MIN - 1)).toBe('1m');
    expect(t.badgeText(t.pause(s, 5 * MIN), 99 * MIN)).toBe('❚❚');
  });

  it('fits in a toolbar badge (<= 4 chars) even for 240-minute sessions', () => {
    expect(t.badgeText(t.start('custom', 240 * MIN, 0), 0).length).toBeLessThanOrEqual(4);
  });
});

describe('badge title', () => {
  it('describes the session and time left', () => {
    expect(t.badgeTitle(t.select('focus', 25 * MIN))).toBe('Tabspace');
    expect(t.badgeTitle(t.start('focus', 24 * MIN, 0), 0)).toBe('Tabspace — Focus 24:00 left');
    expect(t.badgeTitle(t.pause(t.start('short', 5 * MIN, 0), MIN), 0)).toBe('Tabspace — Short Break paused (04:00 left)');
  });
});

describe('nextBadgeChangeAt', () => {
  it('aligns to the moment the ceil-minute count drops', () => {
    const s = t.start('focus', 25 * MIN, 0);
    expect(t.nextBadgeChangeAt(s, 0)).toBe(MIN);
    expect(t.nextBadgeChangeAt(s, 90_000)).toBe(2 * MIN);
    expect(t.nextBadgeChangeAt(s, 25 * MIN)).toBeNull();
    expect(t.nextBadgeChangeAt(t.pause(s, MIN), MIN)).toBeNull();
  });
});

describe('completeIfFinished', () => {
  it('is a no-op until the session has finished, and for idle/paused states', () => {
    const s = t.start('focus', 25 * MIN, 0);
    expect(t.completeIfFinished(s, 25 * MIN - 1, 'x')).toBeNull();
    expect(t.completeIfFinished(t.pause(s, MIN), 99 * MIN, 'x')).toBeNull();
    expect(t.completeIfFinished(t.reset(s), 99 * MIN, 'x')).toBeNull();
  });

  it('resets to idle and records a completed session ending at endAt (even if the worker woke late)', () => {
    const s = t.start('custom', 50 * MIN, 1000);
    const r = t.completeIfFinished(s, 1000 + 80 * MIN, 'id1');
    expect(r?.next.status).toBe('idle');
    expect(r?.next.kind).toBe('custom');
    expect(r?.record).toMatchObject({ id: 'id1', kind: 'custom', completed: true, actualMs: 50 * MIN, startedAt: 1000, endedAt: 1000 + 50 * MIN });
  });

  it('does not record breaks', () => {
    const r = t.completeIfFinished(t.start('short', 5 * MIN, 0), 5 * MIN, 'b');
    expect(r?.next.status).toBe('idle');
    expect(r?.record).toBeNull();
  });

  it('applied twice records only once (idempotent)', () => {
    const s = t.start('focus', MIN, 0);
    const first = t.completeIfFinished(s, MIN, 'a');
    expect(first?.record).not.toBeNull();
    expect(t.completeIfFinished(first!.next, MIN + 5, 'b')).toBeNull();
  });
});

describe('completion state (V2)', () => {
  it('marks the idle state after natural completion and expires after a minute', () => {
    const r = t.completeIfFinished(t.start('focus', 25 * MIN, 0), 25 * MIN, 'id');
    expect(r?.next.completed).toEqual({ kind: 'focus', at: 25 * MIN });
    expect(t.recentCompletion(r!.next, 25 * MIN + 59_000)).toEqual({ kind: 'focus', at: 25 * MIN });
    expect(t.recentCompletion(r!.next, 25 * MIN + t.COMPLETION_VISIBLE_MS)).toBeNull();
  });

  it('is cleared by start/select/reset and never set by stopping early', () => {
    const done = t.completeIfFinished(t.start('focus', MIN, 0), MIN, 'id')!.next;
    expect(t.start('short', 5 * MIN, MIN).completed).toBeUndefined();
    expect(t.select('long', 15 * MIN).completed).toBeUndefined();
    expect(t.reset(done).completed).toBeUndefined();
    expect(t.recentCompletion(t.reset(t.start('focus', MIN, 0)), 10)).toBeNull();
  });

  it('suggests a break after focus (long every 4th) and focus after a break', () => {
    expect(t.nextKindAfter('focus', 1)).toBe('short');
    expect(t.nextKindAfter('custom', 4)).toBe('long');
    expect(t.nextKindAfter('short', 3)).toBe('focus');
    expect(t.nextKindAfter('long', 8)).toBe('focus');
  });
});
