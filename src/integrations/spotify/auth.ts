import { get } from '@/storage/store';
import { getSecret, identityAvailable, launchAuthFlow, randomString, removeSecret, setSecret } from '../secrets';
import { createSpotifyClient, SpotifyError } from './api';
import { buildSpotifyAuthorizeUrl, codeChallengeS256, createCodeVerifier, parseSpotifyRedirect, SPOTIFY_TOKEN, tokenRequestBody } from './pkce';

/** Stored in chrome.storage.local under `secret.spotify` only. */
export interface SpotifySecret {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  clientId: string;
  scope: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
}

async function tokenRequest(params: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetchImpl(SPOTIFY_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenRequestBody(params) });
  } catch {
    throw new SpotifyError('offline', 'Could not reach Spotify. Check your connection.');
  }
  let body: TokenResponse | { error?: string; error_description?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || !body || !('access_token' in body)) {
    const code = (body as { error?: string } | null)?.error ?? '';
    if (code === 'invalid_grant') throw new SpotifyError('auth', 'Spotify sign-in expired. Reconnect Spotify.', res.status);
    if (code === 'invalid_client') throw new SpotifyError('auth', 'Spotify did not recognise this client ID.', res.status);
    throw new SpotifyError('auth', `Spotify sign-in failed${code ? ` (${code})` : ''}.`, res.status);
  }
  return body as TokenResponse;
}

export async function connectSpotify(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<{ displayName: string }> {
  if (!identityAvailable()) throw new SpotifyError('other', 'Spotify sign-in only works inside the installed Chrome extension.');
  const clientId = (await get('ts.settings')).integrations.spotifyClientId?.trim();
  if (!clientId) throw new SpotifyError('auth', 'Add your Spotify client ID in Settings → Integrations first.');
  const verifier = createCodeVerifier();
  const state = randomString(16);
  const redirectUri = chrome.identity.getRedirectURL();
  const url = buildSpotifyAuthorizeUrl({ clientId, redirectUri, state, codeChallenge: await codeChallengeS256(verifier) });
  let redirect: string | undefined;
  try {
    redirect = await launchAuthFlow({ url, interactive: true });
  } catch (e) {
    throw new SpotifyError('auth', `Spotify sign-in was cancelled or failed${e instanceof Error && e.message ? `: ${e.message}` : '.'}`);
  }
  if (!redirect) throw new SpotifyError('auth', 'Spotify sign-in was cancelled.');
  let code: string;
  try {
    code = parseSpotifyRedirect(redirect, state, redirectUri);
  } catch (e) {
    throw new SpotifyError('auth', e instanceof Error ? e.message : 'Spotify sign-in failed.');
  }
  const tok = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }, fetchImpl);
  if (!tok.refresh_token) throw new SpotifyError('auth', 'Spotify did not return a refresh token.');
  const secret: SpotifySecret = { accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresAt: Date.now() + tok.expires_in * 1000, clientId, scope: tok.scope ?? '' };
  await setSecret('secret.spotify', secret, 'local');
  // Verify with a real authenticated call before reporting success.
  try {
    const me = await createSpotifyClient(() => getSpotifyToken(fetchImpl), fetchImpl).me();
    return { displayName: me.displayName };
  } catch (e) {
    await removeSecret('secret.spotify');
    throw e;
  }
}

let inflight: Promise<string> | null = null;

/**
 * Valid access token, refreshing (PKCE refresh: no client secret) when near expiry.
 * Single-flight per page: concurrent callers share one refresh, so a rotated refresh
 * token is never replayed. Another extension page may still refresh at the same time,
 * so on invalid_grant we re-read storage and only disconnect if nothing newer was saved.
 */
export interface TokenOptions {
  /** Refresh even if the cached token looks valid (after a 401), unless it already changed from `staleToken`. */
  forceRefresh?: boolean;
  staleToken?: string;
}

export function getSpotifyToken(fetchImpl: typeof fetch = (...a) => fetch(...a), opts: TokenOptions = {}): Promise<string> {
  const start = (): Promise<string> => {
    // Web Lock: only one context (page or worker) refreshes at a time; the others then read the new token.
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    const run = () => obtainToken(fetchImpl, 0, opts);
    const p = (locks?.request ? (locks.request('tabspace-spotify-refresh', run) as Promise<string>) : run()).finally(() => {
      if (inflight === p) inflight = null;
    });
    inflight = p;
    return p;
  };
  if (!inflight) return start();
  if (!opts.forceRefresh) return inflight;
  // A forced refresh waits for the current one; it only refreshes again if the token is still the stale one.
  return inflight.catch(() => undefined).then((tok) => (tok && tok !== opts.staleToken ? tok : inflight ?? start()));
}

async function obtainToken(fetchImpl: typeof fetch, attempt = 0, opts: TokenOptions = {}): Promise<string> {
  const s = await getSecret<SpotifySecret>('secret.spotify', 'local');
  if (!s?.refreshToken) throw new SpotifyError('auth', 'Spotify is not connected.');
  const stale = opts.forceRefresh && (!opts.staleToken || opts.staleToken === s.accessToken);
  if (!stale && s.accessToken && s.expiresAt > Date.now() + 60_000) return s.accessToken;
  try {
    const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId }, fetchImpl);
    const next: SpotifySecret = {
      ...s,
      accessToken: tok.access_token,
      // Spotify may or may not rotate the refresh token.
      refreshToken: tok.refresh_token ?? s.refreshToken,
      expiresAt: Date.now() + tok.expires_in * 1000,
      scope: tok.scope ?? s.scope,
    };
    await setSecret('secret.spotify', next, 'local');
    return next.accessToken;
  } catch (e) {
    if (e instanceof SpotifyError && e.kind === 'auth') {
      const latest = await getSecret<SpotifySecret>('secret.spotify', 'local');
      if (latest?.refreshToken && latest.refreshToken !== s.refreshToken) {
        // Someone else (another page / the worker) refreshed meanwhile: use their result.
        if (attempt < 1) return obtainToken(fetchImpl, attempt + 1);
        throw e;
      }
      if (latest?.refreshToken === s.refreshToken) await removeSecret('secret.spotify');
    }
    throw e;
  }
}

export async function hasSpotifySecret(): Promise<boolean> {
  return !!(await getSecret<SpotifySecret>('secret.spotify', 'local'))?.refreshToken;
}

export async function disconnectSpotify(): Promise<void> {
  await removeSecret('secret.spotify');
}

export function spotifyClient(fetchImpl?: typeof fetch) {
  return createSpotifyClient((opts) => getSpotifyToken(fetchImpl, opts), fetchImpl);
}

/** Scopes granted at sign-in (from the token response). Never exposes tokens. */
export async function grantedSpotifyScopes(): Promise<string[]> {
  const s = await getSecret<SpotifySecret>('secret.spotify', 'local');
  return (s?.scope ?? '').split(/\s+/).filter(Boolean);
}
