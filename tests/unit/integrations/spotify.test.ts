import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { buildSpotifyAuthorizeUrl, codeChallengeS256, createCodeVerifier, parseSpotifyRedirect } from '@/integrations/spotify/pkce';
import { createSpotifyClient, mapSpotifyError, openInSpotifyUrl, playlistIdFromUri, SpotifyError } from '@/integrations/spotify/api';
import { disconnectSpotify, getSpotifyToken, hasSpotifySecret } from '@/integrations/spotify/auth';
import { __resetMemorySecrets, getSecret, setSecret } from '@/integrations/secrets';

beforeEach(() => __resetMemorySecrets());

describe('PKCE', () => {
  it('creates RFC 7636 verifiers and S256 challenges', async () => {
    const v = createCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(createCodeVerifier()).not.toBe(v);
    // Known vector from RFC 7636 Appendix B.
    expect(await codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const expected = createHash('sha256').update(v).digest('base64url');
    expect(await codeChallengeS256(v)).toBe(expected);
  });

  it('builds the authorize URL with minimal scopes', () => {
    const u = new URL(buildSpotifyAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://x.chromiumapp.org/', state: 'st', codeChallenge: 'ch' }));
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual(['playlist-read-private', 'user-library-read', 'user-modify-playback-state', 'user-read-currently-playing', 'user-read-playback-state']);
  });

  it('parses the redirect and checks state', () => {
    expect(parseSpotifyRedirect('https://x.chromiumapp.org/?code=abc&state=st', 'st')).toBe('abc');
    expect(() => parseSpotifyRedirect('https://x.chromiumapp.org/?code=abc&state=bad', 'st')).toThrow(/did not match/);
    expect(() => parseSpotifyRedirect('https://x.chromiumapp.org/?error=access_denied&state=st', 'st')).toThrow(/denied/);
  });
});

describe('Spotify error mapping', () => {
  it('maps premium, device, auth and rate limit errors', () => {
    expect(mapSpotifyError(403, { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } }).kind).toBe('premium');
    expect(mapSpotifyError(404, { error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } }).kind).toBe('noDevice');
    expect(mapSpotifyError(401, null).kind).toBe('auth');
    const rl = mapSpotifyError(429, null, '12');
    expect(rl.kind).toBe('rateLimit');
    expect(rl.message).toMatch(/12s/);
    expect(mapSpotifyError(403, { error: { message: 'User may not be registered.' } }).kind).toBe('forbidden');
  });

  it('client surfaces mapped errors and handles 204', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/me/player?additional_types=episode')) return new Response(null, { status: 204 });
      if (url.endsWith('/me/player/play')) return new Response(JSON.stringify({ error: { status: 403, message: 'Premium required', reason: 'PREMIUM_REQUIRED' } }), { status: 403 });
      return new Response('{}', { status: 500 });
    });
    const client = createSpotifyClient(async () => 'tok', fetchMock as unknown as typeof fetch);
    expect(await client.playback()).toBeNull();
    await expect(client.play({ contextUri: 'spotify:playlist:abc' })).rejects.toMatchObject({ kind: 'premium' });
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ context_uri: 'spotify:playlist:abc' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('network failures become offline errors', async () => {
    const client = createSpotifyClient(async () => 'tok', (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    await expect(client.me()).rejects.toBeInstanceOf(SpotifyError);
    await expect(client.me()).rejects.toMatchObject({ kind: 'offline' });
  });

  it('builds the Open in Spotify fallback URL', () => {
    expect(playlistIdFromUri('spotify:playlist:37i9dQZF1DX8NTLI2TtZa6')).toBe('37i9dQZF1DX8NTLI2TtZa6');
    expect(openInSpotifyUrl('spotify:playlist:abc123')).toBe('https://open.spotify.com/playlist/abc123');
    expect(openInSpotifyUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('Spotify token refresh', () => {
  it('refreshes an expired token with client_id (no secret) and keeps the old refresh token when none returned', async () => {
    await setSecret('secret.spotify', { accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() - 1000, clientId: 'cid', scope: '' }, 'local');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }), { status: 200 }));
    expect(await getSpotifyToken(fetchMock as unknown as typeof fetch)).toBe('new');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('refresh_token')).toBe('r1');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(await getSecret<{ refreshToken: string }>('secret.spotify', 'local')).toMatchObject({ refreshToken: 'r1', accessToken: 'new' });
  });

  it('concurrent refreshes share one request (rotation-safe)', async () => {
    await setSecret('secret.spotify', { accessToken: 'old', refreshToken: 'r1', expiresAt: 0, clientId: 'cid', scope: '' }, 'local');
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }), { status: 200 });
    });
    const f = fetchMock as unknown as typeof fetch;
    expect(await Promise.all([getSpotifyToken(f), getSpotifyToken(f), getSpotifyToken(f)])).toEqual(['new', 'new', 'new']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not disconnect when another page already rotated the token', async () => {
    await setSecret('secret.spotify', { accessToken: 'old', refreshToken: 'r1', expiresAt: 0, clientId: 'cid', scope: '' }, 'local');
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => {
      const rt = new URLSearchParams(String(init?.body)).get('refresh_token');
      if (rt === 'r1') {
        // Simulate the worker rotating the token while our request was in flight.
        await setSecret('secret.spotify', { accessToken: 'w', refreshToken: 'r2', expiresAt: Date.now() + 3600_000, clientId: 'cid', scope: '' }, 'local');
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      }
      return new Response('{}', { status: 500 });
    });
    expect(await getSpotifyToken(fetchMock as unknown as typeof fetch)).toBe('w');
    expect(await hasSpotifySecret()).toBe(true);
  });

  it('drops the secret when the refresh token is revoked', async () => {
    await setSecret('secret.spotify', { accessToken: 'old', refreshToken: 'r1', expiresAt: 0, clientId: 'cid', scope: '' }, 'local');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    await expect(getSpotifyToken(fetchMock as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'auth' });
    expect(await hasSpotifySecret()).toBe(false);
  });

  it('disconnect removes tokens', async () => {
    await setSecret('secret.spotify', { accessToken: 'a', refreshToken: 'r', expiresAt: 0, clientId: 'c', scope: '' }, 'local');
    await disconnectSpotify();
    expect(await hasSpotifySecret()).toBe(false);
  });
});
