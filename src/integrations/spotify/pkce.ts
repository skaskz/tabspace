import { base64Url, randomString } from '../secrets';

/** Authorization Code with PKCE helpers (RFC 7636; Spotify requires S256). */

export const SPOTIFY_AUTHORIZE = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN = 'https://accounts.spotify.com/api/token';
/** Minimal scopes for the Focus Playlist card. */
export const SPOTIFY_SCOPES = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'playlist-read-private', 'user-library-read'];

/** 64-char verifier from the unreserved alphabet (43–128 allowed). */
export function createCodeVerifier(): string {
  return randomString(48); // 48 bytes -> 64 base64url chars
}

export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function buildSpotifyAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string; codeChallenge: string; scopes?: string[] }): string {
  const u = new URL(SPOTIFY_AUTHORIZE);
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('state', opts.state);
  u.searchParams.set('scope', (opts.scopes ?? SPOTIFY_SCOPES).join(' '));
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('code_challenge', opts.codeChallenge);
  return u.toString();
}

/** Extract `code` from the redirect URL, validating `state`. */
export function parseSpotifyRedirect(redirectUrl: string, expectedState: string, expectedRedirect?: string): string {
  if (expectedRedirect && !redirectUrl.startsWith(expectedRedirect)) throw new Error('The Spotify sign-in response did not come back to Tabspace.');
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    throw new Error('Spotify did not return to Tabspace.');
  }
  const error = url.searchParams.get('error');
  if (error) throw new Error(error === 'access_denied' ? 'Spotify access was denied.' : `Spotify sign-in failed (${error}).`);
  if (url.searchParams.get('state') !== expectedState) throw new Error('The Spotify sign-in response did not match this request. Please try again.');
  const code = url.searchParams.get('code');
  if (!code) throw new Error('Spotify did not return an authorization code.');
  return code;
}

export function tokenRequestBody(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}
