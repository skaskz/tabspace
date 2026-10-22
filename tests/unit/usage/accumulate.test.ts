import { describe, expect, it } from 'vitest';
import { MAX_SEGMENT_MS, addSegment, closeSegment, pruneUsage, usageDomain } from '@/features/usage/accumulate';

const MIN = 60_000;
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

describe('usageDomain', () => {
  it('records only http(s) hostnames, never paths, queries or other schemes', () => {
    expect(usageDomain('https://www.github.com/org/repo?token=secret#x')).toBe('github.com');
    expect(usageDomain('http://localhost:5173/dashboard')).toBe('localhost');
    expect(usageDomain('chrome://extensions')).toBeNull();
    expect(usageDomain('chrome-extension://abc/dashboard.html')).toBeNull();
    expect(usageDomain('file:///C:/secret.txt')).toBeNull();
    expect(usageDomain('not a url')).toBeNull();
    expect(usageDomain(undefined)).toBeNull();
  });
});

describe('addSegment', () => {
  it('adds elapsed ms to the local day and accumulates', () => {
    let log = addSegment({}, 'github.com', at(21, 10), at(21, 10, 5));
    log = addSegment(log, 'github.com', at(21, 11), at(21, 11, 2));
    log = addSegment(log, 'youtube.com', at(21, 12), at(21, 12, 1));
    expect(log).toEqual({ '2026-10-21': { 'github.com': 7 * MIN, 'youtube.com': MIN } });
  });

  it('caps a single segment (e.g. the user walked away)', () => {
    const log = addSegment({}, 'x.com', at(21, 8), at(21, 12));
    expect(log['2026-10-21']['x.com']).toBe(MAX_SEGMENT_MS);
  });

  it('splits a segment across local midnight', () => {
    const log = addSegment({}, 'x.com', at(21, 23, 50), at(22, 0, 10));
    expect(log['2026-10-21']['x.com']).toBe(10 * MIN);
    expect(log['2026-10-22']['x.com']).toBe(10 * MIN);
  });

  it('ignores empty or backwards segments and does not mutate input', () => {
    const base = { '2026-10-21': { 'a.com': 1 } };
    expect(addSegment(base, 'a.com', at(21, 10), at(21, 10))).toBe(base);
    expect(addSegment(base, 'a.com', at(21, 10), at(21, 9))).toBe(base);
    const next = addSegment(base, 'a.com', at(21, 10), at(21, 10, 1));
    expect(base['2026-10-21']['a.com']).toBe(1);
    expect(next['2026-10-21']['a.com']).toBe(1 + MIN);
  });
});

describe('closeSegment / pruneUsage', () => {
  it('closes an open segment, or does nothing without one', () => {
    expect(closeSegment({}, null, at(21, 10))).toEqual({});
    expect(closeSegment({}, { domain: 'a.com', start: at(21, 10) }, at(21, 10, 3))).toEqual({ '2026-10-21': { 'a.com': 3 * MIN } });
  });

  it('drops days beyond the retention window', () => {
    const log = { '2026-01-01': { 'a.com': 1 }, '2026-10-01': { 'a.com': 2 } };
    expect(pruneUsage(log, at(21, 12), 120)).toEqual({ '2026-10-01': { 'a.com': 2 } });
  });
});
