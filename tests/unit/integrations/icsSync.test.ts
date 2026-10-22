import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFeedText, feedOriginPattern } from '@/integrations/ics/feed';
import { removeSource, syncSource } from '@/integrations/calendarSync';
import { get, insert, set } from '@/storage/store';
import type { CalendarSource } from '@/types/models';

const ICS = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:e1\r\nDTSTART:20261022T150000Z\r\nDTEND:20261022T160000Z\r\nSUMMARY:Synced\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

afterEach(() => vi.unstubAllGlobals());

describe('ICS feed fetching', () => {
  it('derives the origin permission pattern (webcal -> https)', () => {
    expect(feedOriginPattern('webcal://cal.example.com/u/abc.ics')).toBe('https://cal.example.com/*');
    expect(feedOriginPattern('ftp://x')).toBeNull();
  });

  it('fetches directly without credentials and rejects HTML pages', async () => {
    const f = vi.fn(async () => new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }));
    await expect(fetchFeedText('webcal://cal.example.com/feed.ics', f as unknown as typeof fetch)).rejects.toThrow('This looks like a web page, not an ICS feed.');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://cal.example.com/feed.ics');
    expect(init.credentials).toBe('omit');
  });

  it('rejects plain http feeds before fetching', async () => {
    const f = vi.fn();
    await expect(fetchFeedText('http://cal.example.com/feed.ics', f as unknown as typeof fetch)).rejects.toThrow(/unencrypted/);
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects redirects to another origin or to http', async () => {
    const redirected = (url: string) => {
      const r = new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
      Object.defineProperty(r, 'url', { value: url });
      return r;
    };
    await expect(fetchFeedText('https://cal.example.com/a.ics', (async () => redirected('https://other.example/a.ics')) as unknown as typeof fetch)).rejects.toThrow(/redirected/);
    await expect(fetchFeedText('https://cal.example.com/a.ics', (async () => redirected('http://cal.example.com/a.ics')) as unknown as typeof fetch)).rejects.toThrow(/redirected/);
    await expect(fetchFeedText('https://cal.example.com/a.ics', (async () => redirected('https://cal.example.com/b.ics')) as unknown as typeof fetch)).resolves.toContain('VCALENDAR');
  });

  it('enforces the 5 MB cap while streaming (no Content-Length)', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(65);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 50) return c.close();
        c.enqueue(chunk);
      },
    });
    await expect(fetchFeedText('https://a.com/x.ics', (async () => new Response(stream)) as unknown as typeof fetch)).rejects.toThrow(/too large/);
    expect(pulled).toBeLessThan(10); // aborted early, not read to the end
  });

  it('maps HTTP errors and size limits', async () => {
    await expect(fetchFeedText('https://a.com/x.ics', (async () => new Response('', { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/404/);
    await expect(fetchFeedText('https://a.com/x.ics', (async () => new Response('', { status: 403 })) as unknown as typeof fetch)).rejects.toThrow(/refused/);
    await expect(fetchFeedText('https://a.com/x.ics', (async () => new Response('x', { headers: { 'content-length': String(6 * 1024 * 1024) } })) as unknown as typeof fetch)).rejects.toThrow(/too large/);
  });
});

describe('syncSource', () => {
  const mkSource = () =>
    insert('ts.calendarSources', { name: 'Team', kind: 'ics-url', color: '#93c5fd', enabled: true, url: 'https://cal.example.com/feed.ics' } as Omit<CalendarSource, 'id' | 'createdAt' | 'updatedAt'>);

  it('replaces only that source’s events and records sync time', async () => {
    const src = await mkSource();
    await set('ts.events', [{ id: 'other', sourceId: 'local', title: 'Mine', start: '2026-10-22', end: '2026-10-23', allDay: true, createdAt: 0, updatedAt: 0 }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ICS, { headers: { 'content-type': 'text/calendar' } })));
    const r = await syncSource(src, { now: new Date('2026-10-21T00:00:00Z') });
    expect(r).toMatchObject({ ok: true, count: 1 });
    const events = await get('ts.events');
    expect(events.map((e) => e.title).sort()).toEqual(['Mine', 'Synced']);
    // Second sync is stable (same ids, no duplicates).
    await syncSource(src, { now: new Date('2026-10-21T00:00:00Z') });
    expect((await get('ts.events')).length).toBe(2);
    expect((await get('ts.calendarSources'))[0].lastSyncedAt).toBeTypeOf('number');
  });

  it('records a friendly error on failure and keeps old events', async () => {
    const src = await mkSource();
    await set('ts.events', [{ id: 'old', sourceId: src.id, title: 'Old', start: '2026-10-22', end: '2026-10-23', allDay: true, createdAt: 0, updatedAt: 0 }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><body>login</body></html>', { headers: { 'content-type': 'text/html' } })));
    const r = await syncSource(src);
    expect(r.ok).toBe(false);
    expect((await get('ts.calendarSources'))[0].lastError).toBe('This looks like a web page, not an ICS feed.');
    expect((await get('ts.events')).map((e) => e.id)).toEqual(['old']);
  });

  it('removeSource deletes the source and its events', async () => {
    const src = await mkSource();
    await set('ts.events', [
      { id: 'a', sourceId: src.id, title: 'A', start: '2026-10-22', end: '2026-10-23', allDay: true, createdAt: 0, updatedAt: 0 },
      { id: 'b', sourceId: 'keep', title: 'B', start: '2026-10-22', end: '2026-10-23', allDay: true, createdAt: 0, updatedAt: 0 },
    ]);
    await removeSource(src.id);
    expect(await get('ts.calendarSources')).toEqual([]);
    expect((await get('ts.events')).map((e) => e.id)).toEqual(['b']);
  });
});
