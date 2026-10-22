import { describe, expect, it } from 'vitest';
import { QUOTES } from '@/features/quotes/catalog';
import { dailyQuoteIndex, dayNumber, shiftFor, toggleFavorite, withRefresh } from '@/features/quotes/daily';
import { addDays, fromDateKey, toDateKey } from '@/utils/date';

describe('quote catalogue', () => {
  it('has ~60+ short, attributed, unique quotes', () => {
    expect(QUOTES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(QUOTES.map((q) => q.text)).size).toBe(QUOTES.length);
    for (const q of QUOTES) {
      expect(q.author.trim()).not.toBe('');
      expect(q.author).not.toMatch(/unknown/i);
      expect(q.text.length).toBeLessThan(140);
    }
  });
});

describe('dailyQuoteIndex', () => {
  it('is deterministic for a date (stable all day, on every surface)', () => {
    expect(dailyQuoteIndex('2026-10-21')).toBe(dailyQuoteIndex('2026-10-21'));
    expect(dailyQuoteIndex('2026-10-21', 0, 70)).toBe(dailyQuoteIndex('2026-10-21', 0, 70));
  });

  it('rotates daily and never repeats on consecutive days', () => {
    let d = fromDateKey('2026-01-01');
    let prev = dailyQuoteIndex(toDateKey(d));
    for (let i = 0; i < 400; i++) {
      d = addDays(d, 1);
      const cur = dailyQuoteIndex(toDateKey(d));
      expect(cur).not.toBe(prev);
      expect(cur).toBeGreaterThanOrEqual(0);
      expect(cur).toBeLessThan(QUOTES.length);
      prev = cur;
    }
  });

  it('visits every quote once per cycle (including across a DST change)', () => {
    const n = QUOTES.length;
    const seen = new Set<number>();
    let d = fromDateKey('2026-03-01');
    for (let i = 0; i < n; i++) {
      seen.add(dailyQuoteIndex(toDateKey(d)));
      d = addDays(d, 1);
    }
    expect(seen.size).toBe(n);
  });

  it('works for catalogue sizes that share factors with the step', () => {
    for (const n of [1, 2, 37, 74, 60]) {
      const seen = new Set(Array.from({ length: n }, (_, i) => dailyQuoteIndex(toDateKey(addDays(fromDateKey('2026-01-01'), i)), 0, n)));
      expect(seen.size).toBe(n);
    }
  });

  it('manual refresh shifts the quote for that day only', () => {
    const base = dailyQuoteIndex('2026-10-21');
    expect(dailyQuoteIndex('2026-10-21', 1)).toBe((base + 1) % QUOTES.length);
    let state = withRefresh({ favorites: [] }, '2026-10-21');
    state = withRefresh(state, '2026-10-21');
    expect(shiftFor(state, '2026-10-21')).toBe(2);
    expect(shiftFor(state, '2026-10-22')).toBe(0);
    expect(withRefresh(state, '2026-10-22').shift).toEqual({ date: '2026-10-22', n: 1 });
  });

  it('uses timezone-free calendar day numbers', () => {
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('2026-03-09') - dayNumber('2026-03-08')).toBe(1);
  });
});

describe('toggleFavorite', () => {
  it('adds and removes', () => {
    const a = toggleFavorite({ favorites: [] }, 3);
    expect(a.favorites).toEqual([3]);
    expect(toggleFavorite(a, 3).favorites).toEqual([]);
  });
});
