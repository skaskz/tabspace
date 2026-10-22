import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildExport } from '@/features/data/validate';
import { clearAllData, exportJson, takeSnapshot } from '@/services/backup';
import { getAdapter, set } from '@/storage/store';
import { DEFAULT_SETTINGS, SECRET_KEYS } from '@/storage/schema';
import { __resetMemorySecrets, getSecret, setSecret } from '@/integrations/secrets';
import { buildGoogleAuthUrl, GOOGLE_CALENDAR_SCOPE, parseGoogleRedirect } from '@/integrations/google/oauth';
import { connectGoogle, disconnectGoogle, hasGoogleMarker, verifyGoogle } from '@/integrations/google/client';
import { buildSpotifyAuthorizeUrl, parseSpotifyRedirect } from '@/integrations/spotify/pkce';
import { connectSpotify, disconnectSpotify, getSpotifyToken, hasSpotifySecret, type SpotifySecret } from '@/integrations/spotify/auth';

const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';

beforeEach(() => __resetMemorySecrets());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Fake chrome.identity whose auth flow answers with `answer(authUrl)`. Storage stays on the memory fallbacks. */
function stubIdentity(answer: (authUrl: URL) => string | undefined | Promise<string | undefined>) {
  const launchWebAuthFlow = vi.fn(async (d: { url: string }) => answer(new URL(d.url)));
  vi.stubGlobal('chrome', { identity: { getRedirectURL: () => REDIRECT, launchWebAuthFlow } });
  return launchWebAuthFlow;
}

async function withClientIds() {
  await set('ts.settings', { ...DEFAULT_SETTINGS, integrations: { googleClientId: 'cid.apps.googleusercontent.com', spotifyClientId: '0123456789abcdef0123456789abcdef' } });
}

describe('exports never contain secrets', () => {
  it('buildExport ignores secret.* even if they are in the input', () => {
    const file = buildExport({ 'secret.google': { accessToken: 'ya29.SECRET' }, 'secret.spotify': { refreshToken: 'SECRET' }, 'ts.tasks': [] } as Record<string, unknown>, { appVersion: 't' });
    expect(JSON.stringify(file)).not.toMatch(/SECRET|secret\./);
  });

  it('exportJson does not read secret.* keys that sit next to ts.* keys in storage', async () => {
    await getAdapter().set({ 'secret.google': { connected: true, token: 'ya29.SECRET' }, 'secret.spotify': { refreshToken: 'SPOTIFY_SECRET' } });
    await set('ts.settings', { ...DEFAULT_SETTINGS, userName: 'Joe' });
    const { json } = await exportJson();
    expect(json).not.toMatch(/SECRET|secret\./);
    expect(json).toContain('Joe');
  });

  it('private ICS feed URLs are excluded by default', async () => {
    await set('ts.calendarSources', [{ id: 's', createdAt: 1, updatedAt: 1, name: 'Work', kind: 'ics-url', color: '#ffffff', enabled: true, url: 'https://cal.example/private/TOKEN123/basic.ics' }]);
    expect((await exportJson()).json).not.toContain('TOKEN123');
    expect((await exportJson({ includeFeedUrls: true })).json).toContain('TOKEN123');
  });

  it('local snapshots do not contain secrets', async () => {
    await getAdapter().set({ 'secret.spotify': { refreshToken: 'SPOTIFY_SECRET' } });
    const snap = await takeSnapshot('manual' as never);
    expect(JSON.stringify(snap)).not.toContain('SPOTIFY_SECRET');
  });

  it('Clear all data removes secrets from local AND session storage', async () => {
    const local = { remove: vi.fn(async () => undefined) };
    const session = { remove: vi.fn(async () => undefined) };
    vi.stubGlobal('chrome', { storage: { local, session } });
    await clearAllData();
    expect(local.remove).toHaveBeenCalledWith([...SECRET_KEYS]);
    expect(session.remove).toHaveBeenCalledWith([...SECRET_KEYS]);
  });
});

describe('Google OAuth', () => {
  it('requests only the read-only calendar scope, no client secret, with state', () => {
    const u = new URL(buildGoogleAuthUrl({ clientId: 'cid', redirectUri: REDIRECT, state: 'st' }));
    expect(u.origin).toBe('https://accounts.google.com');
    expect(u.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_SCOPE);
    expect(GOOGLE_CALENDAR_SCOPE).toBe('https://www.googleapis.com/auth/calendar.readonly');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.has('client_secret')).toBe(false);
  });

  it('rejects redirects with a missing or wrong state (CSRF / token injection)', () => {
    expect(() => parseGoogleRedirect(`${REDIRECT}#access_token=EVIL&state=other`, 'st')).toThrow();
    expect(() => parseGoogleRedirect(`${REDIRECT}#access_token=EVIL`, 'st')).toThrow();
    expect(() => parseGoogleRedirect(`${REDIRECT}#access_token=EVIL&state=`, 'st')).toThrow();
    expect(parseGoogleRedirect(`${REDIRECT}#access_token=OK&state=st&expires_in=60`, 'st', 0).accessToken).toBe('OK');
  });

  it('a state mismatch stores no token and no "connected" marker', async () => {
    await withClientIds();
    stubIdentity(() => `${REDIRECT}#access_token=EVIL&state=attacker`);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(connectGoogle()).rejects.toThrow();
    expect(await getSecret('secret.google', 'session')).toBeUndefined();
    expect(await hasGoogleMarker()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is never marked connected unless an authenticated API call succeeds', async () => {
    await withClientIds();
    stubIdentity((u) => `${REDIRECT}#access_token=TOK&expires_in=3600&state=${u.searchParams.get('state')}`);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { errors: [{ reason: 'accessNotConfigured' }] } }), { status: 403 })));
    await expect(connectGoogle()).rejects.toThrow();
    expect(await hasGoogleMarker()).toBe(false);
    expect(await verifyGoogle()).toBe(false);
  });

  it('sends the token only to googleapis.com in an Authorization header, never in the URL', async () => {
    await withClientIds();
    stubIdentity((u) => `${REDIRECT}#access_token=TOK123&expires_in=3600&state=${u.searchParams.get('state')}`);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: 'primary', summary: 'Me' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await connectGoogle();
    expect(await hasGoogleMarker()).toBe(true);
    for (const [url, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(new URL(url).hostname).toBe('www.googleapis.com');
      expect(url).not.toContain('TOK123');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOK123');
    }
    // The long-lived marker in local storage holds no token.
    expect(JSON.stringify(await getSecret('secret.google', 'local'))).not.toContain('TOK123');
  });

  it('disconnect wipes both storage areas and revokes via POST body (not URL)', async () => {
    await setSecret('secret.google', { accessToken: 'TOK9', expiresAt: Date.now() + 3600_000 }, 'session');
    await setSecret('secret.google', { connected: true, connectedAt: 1 }, 'local');
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await disconnectGoogle();
    expect(await getSecret('secret.google', 'session')).toBeUndefined();
    expect(await getSecret('secret.google', 'local')).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).origin).toBe('https://oauth2.googleapis.com');
    expect(url).not.toContain('TOK9');
    expect(String(init.body)).toContain('TOK9');
  });
});

describe('Spotify OAuth (PKCE)', () => {
  it('authorize URL uses S256 and carries no secret', () => {
    const u = new URL(buildSpotifyAuthorizeUrl({ clientId: 'c', redirectUri: REDIRECT, state: 's', codeChallenge: 'ch' }));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.has('client_secret')).toBe(false);
    expect(u.searchParams.has('code_verifier')).toBe(false);
  });

  it('rejects a code returned with the wrong state', () => {
    expect(() => parseSpotifyRedirect(`${REDIRECT}?code=EVIL&state=x`, 'st')).toThrow();
    expect(() => parseSpotifyRedirect(`${REDIRECT}?code=EVIL`, 'st')).toThrow();
  });

  it('token exchange sends the verifier (matching the challenge) and no client secret; failed /me leaves nothing stored', async () => {
    await withClientIds();
    let challenge = '';
    stubIdentity((u) => {
      challenge = u.searchParams.get('code_challenge')!;
      return `${REDIRECT}?code=CODE&state=${u.searchParams.get('state')}`;
    });
    const bodies: URLSearchParams[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://accounts.spotify.com/api/token') {
        bodies.push(new URLSearchParams(String(init?.body)));
        return new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: 'User may not be registered.' } }), { status: 403 });
    });
    await expect(connectSpotify(fetchImpl as unknown as typeof fetch)).rejects.toThrow();
    expect(await hasSpotifySecret()).toBe(false);
    const b = bodies[0];
    expect(b.get('client_secret')).toBeNull();
    expect(b.get('redirect_uri')).toBe(REDIRECT);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(b.get('code_verifier')!));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });

  it('disconnect deletes tokens', async () => {
    await setSecret<SpotifySecret>('secret.spotify', { accessToken: 'a', refreshToken: 'r', expiresAt: 0, clientId: 'c', scope: '' }, 'local');
    await disconnectSpotify();
    expect(await hasSpotifySecret()).toBe(false);
  });

  // FINDING (Low): two concurrent refreshes both use the same refresh token. If Spotify rotates refresh tokens,
  // the second gets invalid_grant and getSpotifyToken() deletes the (freshly rotated, valid) secret -> silent
  // disconnect. Flip to `it` once refreshes are de-duplicated (single in-flight promise).
  it('concurrent token refreshes do not disconnect the user', async () => {
    await setSecret<SpotifySecret>('secret.spotify', { accessToken: 'old', refreshToken: 'r1', expiresAt: 0, clientId: 'c', scope: '' }, 'local');
    const used = new Set<string>();
    let n = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const rt = new URLSearchParams(String(init?.body)).get('refresh_token')!;
      await new Promise((r) => setTimeout(r, 5));
      if (used.has(rt)) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      used.add(rt);
      n++;
      return new Response(JSON.stringify({ access_token: `at${n}`, refresh_token: `r${n + 1}`, expires_in: 3600 }), { status: 200 });
    });
    await Promise.allSettled([getSpotifyToken(fetchImpl as unknown as typeof fetch), getSpotifyToken(fetchImpl as unknown as typeof fetch)]);
    expect(await hasSpotifySecret()).toBe(true);
  });
});
