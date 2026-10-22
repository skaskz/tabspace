import { describe, expect, it } from 'vitest';
import { buildGoogleAuthUrl, GoogleAuthError, mapGoogleError, mapGoogleEvent, parseGoogleRedirect } from '@/integrations/google/oauth';

describe('Google OAuth helpers', () => {
  it('builds an implicit-flow URL with the read-only scope and state', () => {
    const u = new URL(buildGoogleAuthUrl({ clientId: 'abc.apps.googleusercontent.com', redirectUri: 'https://id.chromiumapp.org/', state: 'S', silent: true }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('response_type')).toBe('token');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
    expect(u.searchParams.get('state')).toBe('S');
    expect(u.searchParams.get('prompt')).toBe('none');
    expect(u.searchParams.has('include_granted_scopes')).toBe(false);
  });

  it('parses the token fragment and validates state', () => {
    const r = parseGoogleRedirect('https://id.chromiumapp.org/#state=S&access_token=tok&expires_in=3599&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly', 'S', 1000);
    expect(r).toEqual({ accessToken: 'tok', expiresAt: 1000 + 3599_000, scope: 'https://www.googleapis.com/auth/calendar.readonly' });
    // Consent screen with the calendar scope unticked.
    expect(() => parseGoogleRedirect('https://id.chromiumapp.org/#state=S&access_token=tok&scope=email', 'S')).toThrow(/not granted/);
    // Must come back to our own redirect URI.
    expect(() => parseGoogleRedirect('https://evil.example/#state=S&access_token=tok&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly', 'S', 0, 'https://id.chromiumapp.org/')).toThrow(/did not come back/);
    expect(() => parseGoogleRedirect('https://id.chromiumapp.org/#state=OTHER&access_token=tok', 'S')).toThrow(GoogleAuthError);
    expect(() => parseGoogleRedirect('https://id.chromiumapp.org/#error=access_denied&state=S', 'S')).toThrow(/denied/);
    expect(() => parseGoogleRedirect('https://id.chromiumapp.org/#state=S', 'S')).toThrow(/access token/);
  });

  it('maps API errors', () => {
    expect(mapGoogleError(401, null).kind).toBe('auth');
    expect(mapGoogleError(401, null).message).toMatch(/Reconnect needed/);
    expect(mapGoogleError(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }).kind).toBe('quota');
    expect(mapGoogleError(429, null).kind).toBe('quota');
    expect(mapGoogleError(403, { error: { errors: [{ reason: 'accessNotConfigured' }], message: 'API has not been used' } }).message).toMatch(/not enabled/);
    expect(mapGoogleError(404, null).kind).toBe('notFound');
  });

  it('maps events: timed to UTC, all-day kept, cancelled dropped', () => {
    expect(mapGoogleEvent({ id: 'a', summary: 'Call', start: { dateTime: '2026-10-22T09:00:00-04:00' }, end: { dateTime: '2026-10-22T09:30:00-04:00' } }, 'g')).toMatchObject({
      id: 'g:a',
      start: '2026-10-22T13:00:00.000Z',
      end: '2026-10-22T13:30:00.000Z',
      allDay: false,
      title: 'Call',
    });
    expect(mapGoogleEvent({ id: 'b', start: { date: '2026-10-30' }, end: { date: '2026-10-31' } }, 'g')).toMatchObject({ allDay: true, start: '2026-10-30', end: '2026-10-31', title: '(No title)' });
    expect(mapGoogleEvent({ id: 'c', status: 'cancelled', start: { date: '2026-10-30' } }, 'g')).toBeNull();
    expect(mapGoogleEvent({ id: 'd', start: { dateTime: 'garbage' } }, 'g')).toBeNull();
  });
});
