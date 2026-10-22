import { describe, expect, it } from 'vitest';
import { hostname, isSafeUrl, normalizeDomain, normalizeUrl } from '@/utils/url';
import { addDays, formatClock, formatDuration, formatRelative, fromDateKey, greeting, monthGrid, toDateKey } from '@/utils/date';
import { buildHash, parseHash } from '@/app/router';

describe('url utils', () => {
  it('normalises user input to safe http(s) URLs', () => {
    expect(normalizeUrl('github.com')).toBe('https://github.com/');
    expect(normalizeUrl('  https://claude.ai/new ')).toBe('https://claude.ai/new');
    expect(normalizeUrl('http://localhost:5173')).toBe('http://localhost:5173/');
  });

  it('rejects dangerous or malformed URLs', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///C:/x', 'chrome://settings', 'not a url', '', 'vbscript:x', 'foo']) {
      expect(normalizeUrl(bad)).toBeNull();
    }
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('https://x.com')).toBe(true);
    expect(isSafeUrl(undefined)).toBe(false);
  });

  it('normalises blocklist domains', () => {
    expect(normalizeDomain('https://www.YouTube.com/feed')).toBe('youtube.com');
    expect(normalizeDomain('reddit.com')).toBe('reddit.com');
    expect(normalizeDomain('nope')).toBeNull();
    expect(hostname('https://www.github.com/x')).toBe('github.com');
  });
});

describe('date utils', () => {
  it('round-trips local date keys', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(fromDateKey('2026-03-08').getDate()).toBe(8);
  });

  it('adds calendar days across DST boundaries', () => {
    expect(toDateKey(addDays(new Date(2026, 2, 7), 1))).toBe('2026-03-08');
    expect(toDateKey(addDays(new Date(2026, 2, 8), 1))).toBe('2026-03-09');
    expect(toDateKey(addDays(new Date(2026, 10, 1), 1))).toBe('2026-11-02');
  });

  it('builds a 42-cell month grid starting on Sunday', () => {
    const g = monthGrid(2026, 9);
    expect(g).toHaveLength(42);
    expect(g[0].getDay()).toBe(0);
    expect(g.some((d) => d.getMonth() === 9 && d.getDate() === 1)).toBe(true);
  });

  it('formats clocks, durations and greetings', () => {
    expect(formatClock(25 * 60_000)).toBe('25:00');
    expect(formatClock(1)).toBe('00:01');
    expect(formatClock(-5)).toBe('00:00');
    expect(formatDuration(72 * 60_000)).toBe('1h 12m');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatRelative(Date.now() - 2 * 60_000)).toBe('2 min ago');
    expect(greeting(new Date(2026, 0, 1, 20))).toBe('Good evening');
    expect(greeting(new Date(2026, 0, 1, 9))).toBe('Good morning');
  });
});

describe('router', () => {
  it('parses pages and params with a fallback', () => {
    expect(parseHash('#/tasks?id=abc').page).toBe('tasks');
    expect(parseHash('#/tasks?id=abc').params.get('id')).toBe('abc');
    expect(parseHash('#/unknown').page).toBe('dashboard');
    expect(parseHash('', 'notes').page).toBe('notes');
    expect(buildHash('notes', { id: 'x', empty: undefined })).toBe('#/notes?id=x');
  });
});
