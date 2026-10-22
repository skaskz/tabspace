import { feedUrlProblem, HTML_NOT_ICS, ICS_MAX_BYTES, IcsError, normalizeFeedUrl, stripBom } from '@/features/calendar/ics';

/**
 * ICS feeds are fetched DIRECTLY from the extension (never via a proxy or third party).
 * Feed URLs are secrets (they often embed a private token) — never log them.
 * Cross-origin fetches need an optional host permission for the feed's origin,
 * requested from a user click via chrome.permissions.request.
 */

export function feedOriginPattern(url: string): string | null {
  const normalized = normalizeFeedUrl(url);
  if (!normalized) return null;
  return `${new URL(normalized).origin}/*`;
}

function permissionsApi(): typeof chrome.permissions | null {
  return typeof chrome !== 'undefined' && chrome.permissions ? chrome.permissions : null;
}

/**
 * Must be called synchronously from a click handler (before any other await),
 * otherwise Chrome rejects the request for lacking a user gesture.
 */
export function requestFeedPermission(url: string): Promise<boolean> {
  const pattern = feedOriginPattern(url);
  const api = permissionsApi();
  if (!pattern) return Promise.resolve(false);
  if (!api) return Promise.resolve(true); // dev server: no permission model, fetch may still fail on CORS
  return api.request({ origins: [pattern] });
}

export async function hasFeedPermission(url: string): Promise<boolean> {
  const pattern = feedOriginPattern(url);
  if (!pattern) return false;
  const api = permissionsApi();
  if (!api) return true;
  try {
    return await api.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/** Remove the host permission when the last feed on that origin is removed. */
export async function releaseFeedPermission(url: string, otherUrls: string[]): Promise<void> {
  const pattern = feedOriginPattern(url);
  const api = permissionsApi();
  if (!pattern || !api) return;
  if (otherUrls.some((u) => feedOriginPattern(u) === pattern)) return;
  try {
    await api.remove({ origins: [pattern] });
  } catch {
    /* ignore */
  }
}

/** Fetch an ICS feed's text with size/content checks. Throws IcsError with friendly messages. */
export async function fetchFeedText(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const normalized = normalizeFeedUrl(url);
  if (!normalized) throw new IcsError(feedUrlProblem(url) ?? 'Enter a valid https:// or webcal:// calendar URL.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new IcsError('You are offline. The feed will sync when you are back online.');
  let res: Response;
  try {
    res = await fetchImpl(normalized, { credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer' });
  } catch {
    throw new IcsError('Could not reach this calendar feed. Check the URL, your connection, and that access to the site was allowed.');
  }
  // Redirects: only follow within the same https origin (the one we hold permission for).
  if (res.url) {
    let final: URL | null = null;
    try {
      final = new URL(res.url);
    } catch {
      /* ignore */
    }
    if (!final || final.protocol !== 'https:' || final.origin !== new URL(normalized).origin) {
      throw new IcsError('This feed redirected to a different website. Subscribe to the final calendar address instead.');
    }
  }
  if (res.status === 401 || res.status === 403) throw new IcsError('The calendar server refused access. The link may be private or expired.');
  if (res.status === 404) throw new IcsError('Calendar feed not found (404). Check the URL.');
  if (!res.ok) throw new IcsError(`The calendar server returned an error (${res.status}).`);
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > ICS_MAX_BYTES) throw new IcsError('This calendar feed is too large (max 5 MB).');
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  const body = await readCapped(res, ICS_MAX_BYTES);
  if (type.includes('text/html') && !/^\s*BEGIN:VCALENDAR/i.test(stripBom(body))) throw new IcsError(HTML_NOT_ICS);
  return body;
}

const TOO_LARGE = 'This calendar feed is too large (max 5 MB).';

/** Read a response body as text, aborting as soon as it exceeds `max` bytes (works without Content-Length). */
export async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) {
    const t = await res.text();
    if (t.length > max) throw new IcsError(TOO_LARGE);
    return t;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new IcsError(TOO_LARGE);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
