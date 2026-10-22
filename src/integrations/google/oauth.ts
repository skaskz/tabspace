/** Pure Google OAuth (implicit token flow via chrome.identity.launchWebAuthFlow) helpers. */

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export function buildGoogleAuthUrl(opts: { clientId: string; redirectUri: string; state: string; silent?: boolean }): string {
  const u = new URL(GOOGLE_AUTH_ENDPOINT);
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('response_type', 'token');
  u.searchParams.set('scope', GOOGLE_CALENDAR_SCOPE);
  u.searchParams.set('state', opts.state);
  if (opts.silent) u.searchParams.set('prompt', 'none');
  return u.toString();
}

export class GoogleAuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

const AUTH_MESSAGES: Record<string, string> = {
  access_denied: 'Google access was denied.',
  interaction_required: 'Google needs you to sign in again.',
  login_required: 'Google needs you to sign in again.',
  consent_required: 'Google needs you to approve access again.',
  redirect_uri_mismatch: 'The redirect URI is not registered for this OAuth client. Add the exact URI shown in Settings.',
  invalid_client: 'Google did not recognise this client ID.',
  state_mismatch: 'The sign-in response did not match this request. Please try again.',
  no_token: 'Google did not return an access token.',
  scope_missing: 'Calendar read access was not granted. Connect again and allow “See your calendars”.',
  bad_redirect: 'The sign-in response did not come back to Tabspace.',
};

/** Parse the redirect URL (`#access_token=…&expires_in=…&state=…`). */
export function parseGoogleRedirect(redirectUrl: string, expectedState: string, now = Date.now(), expectedRedirect?: string): { accessToken: string; expiresAt: number; scope: string } {
  if (expectedRedirect && !redirectUrl.startsWith(expectedRedirect)) throw new GoogleAuthError('bad_redirect', AUTH_MESSAGES.bad_redirect);
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    throw new GoogleAuthError('no_token', AUTH_MESSAGES.no_token);
  }
  const params = new URLSearchParams(url.hash.replace(/^#/, '') || url.search.replace(/^\?/, ''));
  const error = params.get('error');
  if (error) throw new GoogleAuthError(error, AUTH_MESSAGES[error] ?? `Google sign-in failed (${error}).`);
  if (params.get('state') !== expectedState) throw new GoogleAuthError('state_mismatch', AUTH_MESSAGES.state_mismatch);
  const token = params.get('access_token');
  if (!token) throw new GoogleAuthError('no_token', AUTH_MESSAGES.no_token);
  // The user can untick scopes on the consent screen; make sure read access was actually granted.
  // Google returns `scope` in the fragment; if present it must contain read access.
  const scopeParam = params.get('scope');
  const granted = scopeParam === null ? null : scopeParam.split(' ').filter(Boolean);
  if (granted && !granted.includes(GOOGLE_CALENDAR_SCOPE)) throw new GoogleAuthError('scope_missing', AUTH_MESSAGES.scope_missing);
  const expiresIn = Number(params.get('expires_in') ?? '3600');
  return { accessToken: token, expiresAt: now + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000, scope: params.get('scope') ?? '' };
}

export type GoogleErrorKind = 'auth' | 'quota' | 'notFound' | 'offline' | 'other';

export class GoogleApiError extends Error {
  constructor(
    public kind: GoogleErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

/** Map a Google API error response to a friendly error. */
export function mapGoogleError(status: number, body: unknown): GoogleApiError {
  const err = (body as { error?: { message?: string; errors?: { reason?: string }[] } } | null)?.error;
  const reason = err?.errors?.[0]?.reason ?? '';
  if (status === 401) return new GoogleApiError('auth', 'Reconnect needed — your Google sign-in expired.', status);
  if (status === 429 || /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded/.test(reason)) {
    return new GoogleApiError('quota', 'Google Calendar rate limit reached. Try again in a few minutes.', status);
  }
  if (status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED/.test(reason) || /has not been used|is disabled/i.test(err?.message ?? '')) {
      return new GoogleApiError('other', 'The Google Calendar API is not enabled for your Cloud project. Enable it in the Google Cloud console.', status);
    }
    return new GoogleApiError('auth', 'Google denied access to this calendar. Reconnect needed.', status);
  }
  if (status === 404) return new GoogleApiError('notFound', 'This Google calendar no longer exists or is not shared with you.', status);
  return new GoogleApiError('other', `Google Calendar error (${status}).`, status);
}

export interface GoogleEventItem {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
}

/** Map a Google event (singleEvents=true) to Tabspace fields; null for cancelled/invalid items. */
export function mapGoogleEvent(item: GoogleEventItem, sourceId: string) {
  if (!item || !item.id || item.status === 'cancelled' || !item.start) return null;
  const clip = (s?: string) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 5000) : undefined);
  let start: string;
  let end: string;
  let allDay: boolean;
  if (item.start.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.start.date)) return null;
    allDay = true;
    start = item.start.date;
    end = item.end?.date && item.end.date > start ? item.end.date : start;
  } else if (item.start.dateTime) {
    const s = Date.parse(item.start.dateTime);
    if (!Number.isFinite(s)) return null;
    const e = item.end?.dateTime ? Date.parse(item.end.dateTime) : s;
    allDay = false;
    start = new Date(s).toISOString();
    end = new Date(Number.isFinite(e) && e >= s ? e : s).toISOString();
  } else return null;
  return {
    id: `${sourceId}:${item.id}`,
    sourceId,
    externalId: item.id,
    title: clip(item.summary)?.slice(0, 300) ?? '(No title)',
    description: clip(item.description),
    location: clip(item.location),
    start,
    end,
    allDay,
  };
}
