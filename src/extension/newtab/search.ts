import type { Settings } from '@/types/models';

/** New Tab search: URLs are opened directly (http/https only), everything else goes to the search engine. */

export const SEARCH_ENGINES: Record<Settings['newTab']['searchEngine'], { name: string; url: (q: string) => string }> = {
  google: { name: 'Google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  duckduckgo: { name: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  bing: { name: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
};

const HOST_LIKE = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d{1,5})?([/?#]\S*)?$/i;

/** Return a safe http(s) URL if the input looks like an address, otherwise null. */
export function asUrl(input: string): string | null {
  const t = input.trim();
  if (!t || /\s/.test(t)) return null;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      return u.hostname ? u.toString() : null;
    } catch {
      return null;
    }
  }
  // Any other explicit scheme (javascript:, data:, file:, chrome:…) is never navigated to.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(t)) return null;
  if (!HOST_LIKE.test(t)) return null;
  try {
    const u = new URL(`${/^localhost|^(\d{1,3}\.){3}\d{1,3}/i.test(t) ? 'http' : 'https'}://${t}`);
    return u.toString();
  } catch {
    return null;
  }
}

/** Where submitting the search box should navigate, or null for empty input. */
export function resolveSearch(input: string, engine: Settings['newTab']['searchEngine']): string | null {
  const q = input.trim();
  if (!q) return null;
  return asUrl(q) ?? (SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.google).url(q);
}
