import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpotifyClient, LIKED, MESSAGES, openInSpotifyUrl, SpotifyError } from '@/integrations/spotify/api';
import { spotifyClient } from '@/integrations/spotify/auth';
import { __resetMemorySecrets, setSecret } from '@/integrations/secrets';
import { __resetSpotifyService, createPoller, playSelection, pollOnce, readSnapshot, runCommand, safeImage, setDefaultCollection, writeSnapshot } from '@/integrations/spotify/service';
import { get } from '@/storage/store';
import { SPOTIFY_SCOPES } from '@/integrations/spotify/pkce';

type Call = { url: string; init: RequestInit };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

/** Fake fetch routing by "METHOD path" (path without the API prefix, query kept). */
function fakeFetch(routes: Record<string, (c: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const c = { url, init };
    calls.push(c);
    const path = url.replace('https://api.spotify.com/v1', '');
    const key = `${init.method ?? 'GET'} ${path}`;
    const handler = routes[key] ?? routes[`${init.method ?? 'GET'} ${path.split('?')[0]}`];
    if (!handler) throw new Error(`unexpected ${key}`);
    return handler(c);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const tokenClient = (f: typeof fetch) => createSpotifyClient(async () => 'tok', f);

beforeEach(() => {
  __resetMemorySecrets();
  __resetSpotifyService();
});
afterEach(() => vi.useRealTimers());

describe('player commands (the V1 "Spotify request failed." on Next)', () => {
  it('Next is POST /me/player/next and 204, 202 and a 200 with a non-JSON body all count as success', async () => {
    for (const res of [new Response(null, { status: 204 }), new Response(null, { status: 202 }), new Response('2f9a1c-req-id', { status: 200 })]) {
      const { fetch, calls } = fakeFetch({ 'POST /me/player/next': () => res });
      await expect(tokenClient(fetch).next()).resolves.toBeUndefined();
      expect(calls[0].init.method).toBe('POST');
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    }
  });

  it('uses the documented methods and passes device_id', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /me/player/previous?device_id=dev%201': () => new Response(null, { status: 204 }),
      'PUT /me/player/pause': () => new Response(null, { status: 204 }),
      'PUT /me/player/play': () => new Response(null, { status: 204 }),
    });
    const c = tokenClient(fetch);
    await c.previous('dev 1');
    await c.pause();
    await c.play({ uris: Array.from({ length: 150 }, (_, i) => `spotify:track:t${i}`) });
    expect(calls.map((x) => x.init.method)).toEqual(['POST', 'PUT', 'PUT']);
    expect(JSON.parse(String(calls[2].init.body)).uris).toHaveLength(100);
  });

  it.each([
    [json({ error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } }, 403), 'premium', MESSAGES.premium],
    [json({ error: { status: 403, message: 'Insufficient client scope' } }, 403), 'scope', MESSAGES.scope],
    [json({ error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } }, 404), 'noDevice', MESSAGES.noDevice],
    [json({ error: { status: 403, message: 'Player command failed: Restriction violated', reason: 'UNKNOWN' } }, 403), 'restricted', 'Spotify can’t do that right now.'],
    [new Response('<html>oops</html>', { status: 502 }), 'server', 'Spotify had a problem (502) — try again.'],
  ])('maps errors (%#)', async (res, kind, message) => {
    const { fetch } = fakeFetch({ 'POST /me/player/next': () => res });
    await expect(tokenClient(fetch).next()).rejects.toMatchObject({ kind, message });
  });

  it('honours Retry-After on 429', async () => {
    const { fetch } = fakeFetch({ 'POST /me/player/next': () => new Response('', { status: 429, headers: { 'Retry-After': '7' } }) });
    const err = await tokenClient(fetch).next().catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyError);
    expect(err).toMatchObject({ kind: 'rateLimit', retryAfter: 7, message: 'Spotify is rate-limiting — try again in 7s.' });
  });

  it('network errors become a clear offline message', async () => {
    const f = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(tokenClient(f).next()).rejects.toMatchObject({ kind: 'offline', message: MESSAGES.offline });
  });
});

describe('token expiry', () => {
  it('refreshes an expired token, and on a 401 forces one refresh and retries', async () => {
    await setSecret('secret.spotify', { accessToken: 'old', refreshToken: 'r1', expiresAt: 0, clientId: 'cid', scope: SPOTIFY_SCOPES.join(' ') }, 'local');
    let n = 0;
    let first = true;
    const { fetch, calls } = fakeFetch({});
    const routed = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === 'https://accounts.spotify.com/api/token') {
        n++;
        return json({ access_token: `at${n}`, refresh_token: `r${n + 1}`, expires_in: 3600 });
      }
      calls.push({ url, init });
      const auth = (init.headers as Record<string, string>).Authorization;
      if (first) {
        first = false;
        expect(auth).toBe('Bearer at1');
        return new Response('', { status: 401 });
      }
      expect(auth).toBe('Bearer at2');
      return new Response(null, { status: 204 });
    });
    void fetch;
    await spotifyClient(routed as unknown as typeof fetch).next();
    expect(n).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('a second 401 after refresh reports an expired session', async () => {
    await setSecret('secret.spotify', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000, clientId: 'cid', scope: '' }, 'local');
    const routed = vi.fn(async (url: string) => (url.includes('/api/token') ? json({ access_token: 'b', expires_in: 3600 }) : new Response('', { status: 401 })));
    await expect(spotifyClient(routed as unknown as typeof fetch).next()).rejects.toMatchObject({ kind: 'auth', message: MESSAGES.auth });
  });
});

describe('Liked Songs', () => {
  it('paginates /me/tracks (limit 50), skips local files and caps the list', async () => {
    const page = (offset: number, count: number, next: boolean) =>
      json({ total: 120, next: next ? 'https://api.spotify.com/v1/me/tracks?offset=x' : null, items: Array.from({ length: count }, (_, i) => ({ track: { uri: `spotify:track:t${offset + i}`, is_local: offset + i === 3 } })) });
    const { fetch, calls } = fakeFetch({
      'GET /me/tracks?limit=50&offset=0': () => page(0, 50, true),
      'GET /me/tracks?limit=50&offset=50': () => page(50, 50, true),
    });
    const liked = await tokenClient(fetch).likedTracks(100);
    expect(calls).toHaveLength(2);
    expect(liked.total).toBe(120);
    expect(liked.uris).toHaveLength(99);
    expect(liked.uris).not.toContain('spotify:track:t3');
  });

  it('plays Liked Songs as an explicit track list (not a playlist context)', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /me/tracks?limit=50&offset=0': () => json({ total: 2, next: null, items: [{ track: { uri: 'spotify:track:a' } }, { track: { uri: 'spotify:track:b' } }] }),
      'PUT /me/player/play?device_id=d': () => new Response(null, { status: 204 }),
      'PUT /me/player/play': () => new Response(null, { status: 204 }),
    });
    await playSelection(tokenClient(fetch), LIKED, 'd');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ uris: ['spotify:track:a', 'spotify:track:b'] });
    await playSelection(tokenClient(fetch), 'spotify:playlist:abc');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ context_uri: 'spotify:playlist:abc' });
    expect(openInSpotifyUrl(LIKED)).toBe('https://open.spotify.com/collection/tracks');
  });

  it('an empty Liked Songs list gives a clear message', async () => {
    const { fetch } = fakeFetch({ 'GET /me/tracks?limit=50&offset=0': () => json({ total: 0, next: null, items: [] }) });
    await expect(playSelection(tokenClient(fetch), LIKED)).rejects.toThrow(/Liked Songs list is empty/);
  });

  it('the default selection persists in settings (liked or playlist only)', async () => {
    await setDefaultCollection(LIKED);
    expect((await get('ts.settings')).integrations.spotifyPlaylistUri).toBe('liked');
    await setDefaultCollection('javascript:alert(1)');
    expect((await get('ts.settings')).integrations.spotifyPlaylistUri).toBeUndefined();
    await setDefaultCollection('spotify:playlist:37i9dQ');
    expect((await get('ts.settings')).integrations.spotifyPlaylistUri).toBe('spotify:playlist:37i9dQ');
  });
});

describe('shared snapshot, commands and the single poller', () => {
  const playing = { is_playing: true, progress_ms: 1000, item: { name: 'Track', uri: 'spotify:track:x', duration_ms: 200000, artists: [{ name: 'A' }, { name: 'B' }], album: { images: [{ url: 'https://i.scdn.co/image/big' }, { url: 'https://evil.example/x.png' }] } }, device: { id: 'd1', name: 'Laptop', volume_percent: 50 } };

  it('pollOnce writes a sanitised snapshot and keeps the last state on errors', async () => {
    const ok = fakeFetch({ 'GET /me/player?additional_types=episode': () => json(playing) });
    const snap = await pollOnce(tokenClient(ok.fetch), () => 1000);
    expect(snap).toMatchObject({ active: true, isPlaying: true, track: { name: 'Track', artists: 'A, B' }, device: { name: 'Laptop' }, fetchedAt: 1000 });
    expect(snap.track?.image).toBeUndefined(); // smallest image is on a non-Spotify host -> dropped
    expect(JSON.stringify(snap)).not.toContain('tok');
    const bad = fakeFetch({ 'GET /me/player?additional_types=episode': () => json({ error: { message: 'x' } }, 500) });
    const after = await pollOnce(tokenClient(bad.fetch), () => 2000);
    expect(after).toMatchObject({ isPlaying: true, track: { name: 'Track' }, error: { kind: 'server' } });
    expect(await readSnapshot()).toEqual(after);
    expect(safeImage('https://i.scdn.co/image/ab67')).toBe('https://i.scdn.co/image/ab67');
    expect(safeImage('http://i.scdn.co/x')).toBeUndefined();
  });

  it('nothing playing (204) is an inactive snapshot, not an error', async () => {
    const { fetch } = fakeFetch({ 'GET /me/player?additional_types=episode': () => new Response(null, { status: 204 }) });
    expect(await pollOnce(tokenClient(fetch), () => 5)).toEqual({ fetchedAt: 5, active: false, isPlaying: false });
  });

  it('duplicate rapid commands share one request; optimistic state is undone on failure', async () => {
    vi.useFakeTimers();
    const { fetch } = fakeFetch({ 'GET /me/player?additional_types=episode': () => json(playing) });
    await writeSnapshot({ fetchedAt: 0, active: true, isPlaying: false });
    let calls = 0;
    const fn = async () => {
      calls++;
    };
    const a = runCommand('next', fn, { client: () => tokenClient(fetch), refetchMs: 10 });
    const b = runCommand('next', fn, { client: () => tokenClient(fetch), refetchMs: 10 });
    expect(a).toBe(b);
    await vi.advanceTimersByTimeAsync(20);
    await a;
    expect(calls).toBe(1);

    const failing = runCommand('play', async () => Promise.reject(new SpotifyError('premium', MESSAGES.premium)), { client: () => tokenClient(fetch), optimistic: (s) => ({ ...s, isPlaying: true }) });
    await expect(failing).rejects.toMatchObject({ kind: 'premium' });
    expect((await readSnapshot())?.isPlaying).toBe(true); // re-fetched state from the first command, not the optimistic one
  });

  it('elects exactly one poller across pages and hands over when the leader is hidden', async () => {
    vi.useFakeTimers();
    // Minimal Web Locks fake with ifAvailable semantics.
    const held = new Set<string>();
    const locks = {
      request: async (name: string, opts: { ifAvailable?: boolean }, cb: (lock: unknown) => Promise<unknown>) => {
        if (held.has(name) && opts.ifAvailable) return cb(null);
        held.add(name);
        try {
          return await cb({ name });
        } finally {
          held.delete(name);
        }
      },
    } as unknown as Pick<LockManager, 'request'>;
    const polls = { a: 0, b: 0 };
    const mk = (who: 'a' | 'b') => createSpotifyClient(async () => 'tok', (async () => {
      polls[who]++;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch);
    let aVisible = true;
    const pageA = createPoller({ client: () => mk('a'), locks, isVisible: () => aVisible });
    const pageB = createPoller({ client: () => mk('b'), locks, isVisible: () => true });
    const stopA = pageA.start();
    await vi.advanceTimersByTimeAsync(10);
    const stopB = pageB.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(polls.a).toBeGreaterThanOrEqual(4);
    expect(polls.b).toBe(0); // only the leader polls
    aVisible = false; // leader tab hidden -> releases the lock after its current sleep
    await vi.advanceTimersByTimeAsync(15_000);
    const aBefore = polls.a;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(polls.a).toBe(aBefore);
    expect(polls.b).toBeGreaterThanOrEqual(3);
    stopA();
    stopB();
  });
});
