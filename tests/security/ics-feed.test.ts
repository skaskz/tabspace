import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFeedText, feedOriginPattern } from '@/integrations/ics/feed';
import { HTML_NOT_ICS, ICS_MAX_BYTES, parseIcs } from '@/features/calendar/ics';

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261021T100000Z\r\nDTEND:20261021T110000Z\r\nSUMMARY:<img src=x onerror=alert(1)>\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

afterEach(() => vi.restoreAllMocks());

describe('ICS fetch', () => {
  it('fetches the feed URL itself (no proxy), without cookies or referrer; webcal -> https', async () => {
    const fetchMock = vi.fn(async () => new Response(ICS, { headers: { 'content-type': 'text/calendar' } }));
    await fetchFeedText('webcal://cal.example/private/TOKEN/basic.ics', fetchMock as unknown as typeof fetch);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://cal.example/private/TOKEN/basic.ics');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings', 'data:text/calendar,BEGIN:VCALENDAR', 'ftp://cal.example/a.ics'])('refuses %j without fetching', async (u) => {
    const fetchMock = vi.fn();
    await expect(fetchFeedText(u, fetchMock as unknown as typeof fetch)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects HTML login pages', async () => {
    const f = vi.fn(async () => new Response('<!doctype html><html><body>Sign in</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    await expect(fetchFeedText('https://cal.example/a.ics', f as unknown as typeof fetch)).rejects.toThrow(HTML_NOT_ICS);
    // HTML served with a wrong content type is still refused by the parser.
    expect(() => parseIcs('<html><script>alert(1)</script></html>', 's')).toThrow(HTML_NOT_ICS);
  });

  it('rejects oversized feeds by Content-Length and by body size', async () => {
    const big = vi.fn(async () => new Response('x', { headers: { 'content-length': String(ICS_MAX_BYTES + 1) } }));
    await expect(fetchFeedText('https://cal.example/a.ics', big as unknown as typeof fetch)).rejects.toThrow(/too large/);
    const body = vi.fn(async () => new Response('BEGIN:VCALENDAR\r\n' + 'X'.repeat(ICS_MAX_BYTES + 10)));
    await expect(fetchFeedText('https://cal.example/a.ics', body as unknown as typeof fetch)).rejects.toThrow(/too large/);
  });

  it('error messages never include the (secret) feed URL', async () => {
    for (const status of [401, 403, 404, 500]) {
      const f = vi.fn(async () => new Response('', { status }));
      await expect(fetchFeedText('https://cal.example/private/SECRETTOKEN/basic.ics', f as unknown as typeof fetch)).rejects.toSatisfy((e: Error) => !e.message.includes('SECRETTOKEN'));
    }
  });

  it('host permission is requested for exactly one origin', () => {
    expect(feedOriginPattern('webcal://cal.example:8443/a/b.ics?x=1')).toBe('https://cal.example:8443/*');
    expect(feedOriginPattern('javascript:alert(1)')).toBeNull();
  });

  // FINDING (Low): http:// feeds are accepted, so a private feed token travels in clear text.
  it('only https feeds are accepted', async () => {
    const f = vi.fn(async () => new Response(ICS));
    await expect(fetchFeedText('http://cal.example/private/TOKEN.ics', f as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe('ICS parsing of hostile content', () => {
  it('event text is kept as inert strings and length-capped', () => {
    const long = 'A'.repeat(20_000);
    const r = parseIcs(ICS.replace('SUMMARY:<img src=x onerror=alert(1)>', `SUMMARY:<img src=x onerror=alert(1)>\r\nDESCRIPTION:${long}`), 's', { now: new Date('2026-10-21T00:00:00Z') });
    expect(r.events[0].title).toBe('<img src=x onerror=alert(1)>');
    expect(r.events[0].description!.length).toBeLessThanOrEqual(5000);
  });

  it('caps the number of produced events', () => {
    const r = parseIcs(
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:r\r\nDTSTART:20261021T100000Z\r\nDTEND:20261021T101000Z\r\nRRULE:FREQ=MINUTELY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
      's',
      { now: new Date('2026-10-21T00:00:00Z') },
    );
    expect(r.events.length).toBeLessThanOrEqual(5000);
    expect(r.truncated).toBe(true);
  });

  /**
   * FINDING (Medium, DoS): maxIterations (20 000) applies per recurring series and there is no global budget.
   * Series that start long before the window iterate the full budget without emitting anything, so cost grows
   * linearly with the number of VEVENTs. We measure a small sample and extrapolate to a 5 MB feed.
   */
  it('reports the per-series expansion cost (informational)', () => {
    const series = 5;
    let body = 'BEGIN:VCALENDAR\r\n';
    for (let i = 0; i < series; i++) body += `BEGIN:VEVENT\r\nUID:s${i}\r\nDTSTART:19500101T100000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\n`;
    body += 'END:VCALENDAR\r\n';
    const t0 = performance.now();
    const r = parseIcs(body, 's', { now: new Date('2026-10-21T00:00:00Z') });
    const ms = performance.now() - t0;
    const perSeries = ms / series;
    const bytesPerSeries = body.length / series;
    const worstCaseMinutes = ((ICS_MAX_BYTES / bytesPerSeries) * perSeries) / 60_000;
    console.info(`[security] ICS: ${perSeries.toFixed(1)} ms per stale DAILY series; a 5 MB feed of such series ≈ ${worstCaseMinutes.toFixed(1)} min of parsing`);
    // Fixed (finding #1): stale series are fast-forwarded to the window, so their in-window instances appear
    // and parsing stays fast instead of burning the whole iteration budget.
    expect(r.events.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000 * Number(process.env.TS_PERF_SLACK ?? 1));
  }, 60_000);
});
