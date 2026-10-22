import { isSafeUrl } from '@/utils/url';

/** Minimal tab shape used to pick "the current web page" for Save current tab. */
export interface TabLike {
  id?: number;
  windowId: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  favIconUrl?: string;
  active?: boolean;
  lastAccessed?: number;
}

export interface PageInfo {
  url: string;
  title: string;
  favIconUrl?: string;
}

const urlOf = (t: TabLike) => t.url || t.pendingUrl || '';

/**
 * Pick the web page the user most likely means by "current tab" when the
 * Tabspace page itself is the active tab:
 *   1. the most recently used http(s) tab (Chrome 121+ `lastAccessed`), anywhere,
 *   2. otherwise the active http(s) tab in the Tabspace page's own window,
 *   3. otherwise any active http(s) tab, then any http(s) tab.
 * The Tabspace tab itself and non-web pages (chrome://, extension pages…) are never picked.
 * Returns candidates in preference order (first = best).
 */
export function rankWebTabs(tabs: TabLike[], self: { tabId?: number; windowId?: number } = {}): TabLike[] {
  const web = tabs.filter((t) => t.id !== self.tabId && isSafeUrl(urlOf(t)));
  const score = (t: TabLike) => [t.lastAccessed ?? 0, t.windowId === self.windowId && t.active ? 1 : 0, t.active ? 1 : 0, t.windowId === self.windowId ? 1 : 0];
  return [...web].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return 0;
  });
}

export function toPageInfo(t: TabLike): PageInfo {
  const url = urlOf(t);
  return { url, title: t.title?.trim() || url, favIconUrl: isSafeUrl(t.favIconUrl) ? t.favIconUrl : undefined };
}

/** Query Chrome for the best candidate web pages (empty outside the extension). */
export async function findCurrentWebPages(limit = 8): Promise<PageInfo[]> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return [];
  const [all, self] = await Promise.all([chrome.tabs.query({}), chrome.tabs.getCurrent?.().catch(() => undefined)]);
  const ranked = rankWebTabs(all as TabLike[], { tabId: self?.id, windowId: self?.windowId });
  const seen = new Set<string>();
  const out: PageInfo[] = [];
  for (const t of ranked) {
    const p = toPageInfo(t);
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
