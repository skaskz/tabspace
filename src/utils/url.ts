/** URL validation helpers. Only http(s) URLs are ever opened or stored as links. */

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

/** Normalise user input into a safe http(s) URL, or return null. Adds https:// when missing. */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProto);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    if (!url.hostname || (!url.hostname.includes('.') && url.hostname !== 'localhost')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isSafeUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** URLs Chrome lets extensions re-open via chrome.tabs.create (excludes chrome://, file:// etc.). */
export function isRestorableUrl(url: string | undefined | null): url is string {
  return isSafeUrl(url);
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Normalise a blocklist entry like "https://www.YouTube.com/feed" -> "youtube.com". */
export function normalizeDomain(input: string): string | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  const host = hostname(/^[a-z]+:\/\//.test(t) ? t : `https://${t}`);
  if (!host || host.length > 253) return null;
  const labels = host.split('.');
  if (labels.length < 2) return null;
  // RFC 1123 labels: 1–63 chars, alphanumerics and inner hyphens. TLD must be alphabetic (or punycode).
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!labels.every((l) => label.test(l))) return null;
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return null;
  return host;
}

/** Favicon via Chrome's built-in favicon service (MV3 `favicon` permission) with a safe fallback. */
export function faviconUrl(pageUrl: string, size = 32): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    const u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', String(size));
    return u.toString();
  }
  return '';
}
