import { get } from '@/storage/store';
import { getSecret, identityAvailable, launchAuthFlow, randomString, removeSecret, removeSecretIn, setSecret } from '../secrets';
import { buildGoogleAuthUrl, GoogleApiError, mapGoogleError, mapGoogleEvent, parseGoogleRedirect, type GoogleEventItem } from './oauth';

/**
 * Google Calendar (read-only) via chrome.identity.launchWebAuthFlow + the user's own
 * "Web application" OAuth client id. Access tokens live in chrome.storage.session;
 * a token-free marker in chrome.storage.local remembers that the user connected so
 * background sync can attempt silent re-auth.
 */

interface SessionToken {
  accessToken: string;
  expiresAt: number;
}
interface LocalMarker {
  connected: true;
  connectedAt: number;
}

const API = 'https://www.googleapis.com/calendar/v3';

async function clientId(): Promise<string> {
  const id = (await get('ts.settings')).integrations.googleClientId?.trim();
  if (!id) throw new GoogleApiError('auth', 'Add your Google OAuth client ID in Settings → Integrations first.');
  return id;
}

async function authorize(interactive: boolean): Promise<SessionToken> {
  if (!identityAvailable()) throw new GoogleApiError('other', 'Google sign-in only works inside the installed Chrome extension.');
  const id = await clientId();
  const state = randomString(16);
  const url = buildGoogleAuthUrl({ clientId: id, redirectUri: chrome.identity.getRedirectURL(), state, silent: !interactive });
  let redirect: string | undefined;
  try {
    redirect = await launchAuthFlow(
      interactive ? { url, interactive: true } : { url, interactive: false, abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 10_000 },
    );
  } catch (e) {
    throw new GoogleApiError('auth', interactive ? `Google sign-in was cancelled or failed${e instanceof Error && e.message ? `: ${e.message}` : '.'}` : 'Reconnect needed — Google requires you to sign in again.');
  }
  if (!redirect) throw new GoogleApiError('auth', 'Google sign-in was cancelled.');
  let parsed;
  try {
    parsed = parseGoogleRedirect(redirect, state, Date.now(), chrome.identity.getRedirectURL());
  } catch (e) {
    throw new GoogleApiError('auth', e instanceof Error ? e.message : 'Google sign-in failed.');
  }
  const token = { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt };
  await setSecret<SessionToken>('secret.google', token, 'session');
  return token;
}

/** A valid access token: cached, else silent re-auth (if previously connected), else interactive when allowed. */
export async function getGoogleToken({ interactive = false }: { interactive?: boolean } = {}): Promise<string> {
  const cached = await getSecret<SessionToken>('secret.google', 'session');
  if (cached?.accessToken && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
  const marker = await getSecret<LocalMarker>('secret.google', 'local');
  if (marker?.connected) {
    try {
      return (await authorize(false)).accessToken;
    } catch (e) {
      if (!interactive) throw e;
    }
  }
  if (!interactive) throw new GoogleApiError('auth', 'Reconnect needed — connect Google Calendar in Settings.');
  return (await authorize(true)).accessToken;
}

async function googleFetch<T>(path: string, opts: { interactive?: boolean } = {}, retried = false): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new GoogleApiError('offline', 'You are offline. Calendar sync will retry later.');
  const token = await getGoogleToken(opts);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch {
    throw new GoogleApiError('offline', 'Could not reach Google Calendar. Check your connection.');
  }
  if (res.status === 401 && !retried) {
    // Expired/revoked token: drop it and retry once with silent re-auth.
    await removeSecretIn('secret.google', 'session');
    return googleFetch<T>(path, { interactive: false }, true);
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    throw mapGoogleError(res.status, body);
  }
  return (await res.json()) as T;
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
}

export async function listGoogleCalendars(opts: { interactive?: boolean } = {}): Promise<GoogleCalendarInfo[]> {
  const out: GoogleCalendarInfo[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ maxResults: '250', minAccessRole: 'reader' });
    if (pageToken) q.set('pageToken', pageToken);
    const res = await googleFetch<{ items?: GoogleCalendarInfo[]; nextPageToken?: string }>(`/users/me/calendarList?${q}`, opts);
    for (const c of res.items ?? []) if (c?.id) out.push({ id: c.id, summary: String(c.summary ?? c.id), backgroundColor: c.backgroundColor, primary: c.primary });
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** Interactive connect: sign in, then verify with a real API call before marking connected. */
export async function connectGoogle(): Promise<GoogleCalendarInfo[]> {
  await authorize(true);
  const calendars = await listGoogleCalendars();
  await setSecret<LocalMarker>('secret.google', { connected: true, connectedAt: Date.now() }, 'local');
  return calendars;
}

/** Live check used by Settings: true only if an authenticated call succeeds right now (no prompts). */
export async function verifyGoogle(): Promise<boolean> {
  const marker = await getSecret<LocalMarker>('secret.google', 'local');
  if (!marker?.connected) return false;
  try {
    await googleFetch('/users/me/calendarList?maxResults=1');
    return true;
  } catch {
    return false;
  }
}

export async function hasGoogleMarker(): Promise<boolean> {
  return !!(await getSecret<LocalMarker>('secret.google', 'local'))?.connected;
}

export async function disconnectGoogle(): Promise<void> {
  const cached = await getSecret<SessionToken>('secret.google', 'session');
  await removeSecret('secret.google');
  if (cached?.accessToken) {
    // Best-effort revocation (sent only to Google). Token passed in the body, not the URL.
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: cached.accessToken }),
      });
    } catch {
      /* offline: token expires on its own within an hour */
    }
  }
}

/** Fetch expanded events (singleEvents=true) for one calendar in [timeMin, timeMax). */
export async function fetchGoogleEvents(calendarId: string, sourceId: string, timeMin: Date, timeMax: Date, opts: { interactive?: boolean } = {}) {
  const out: NonNullable<ReturnType<typeof mapGoogleEvent>>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: '2500',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const res = await googleFetch<{ items?: GoogleEventItem[]; nextPageToken?: string }>(`/calendars/${encodeURIComponent(calendarId)}/events?${q}`, opts);
    for (const item of res.items ?? []) {
      const mapped = mapGoogleEvent(item, sourceId);
      if (mapped) out.push(mapped);
      if (out.length >= 5000) return out;
    }
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}
