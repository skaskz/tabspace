import { isSafeUrl } from '@/utils/url';

/** Guarded Chrome tab helpers. Every function is a safe no-op outside the extension. */

export interface OpenTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  lastAccessed?: number;
  active: boolean;
}

export function hasTabsApi(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.tabs?.query;
}

/** All open tabs (empty list when not running as an extension). */
export async function queryOpenTabs(): Promise<OpenTab[]> {
  if (!hasTabsApi()) return [];
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((t) => t.id !== undefined && t.id !== chrome.tabs.TAB_ID_NONE)
    .map((t) => ({
      id: t.id!,
      windowId: t.windowId,
      title: t.title || t.url || 'Untitled tab',
      url: t.url ?? t.pendingUrl ?? '',
      favIconUrl: t.favIconUrl,
      // `lastAccessed` exists on Chrome 121+ (older @types may not declare it).
      lastAccessed: (t as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed,
      active: t.active,
    }));
}

export function recentTabs(tabs: OpenTab[], limit = 5, excludeUrlPrefix?: string): OpenTab[] {
  return tabs
    // Only real web pages: skip about:blank, chrome:// pages and Tabspace's own pages.
    .filter((t) => isSafeUrl(t.url) && (!excludeUrlPrefix || !t.url.startsWith(excludeUrlPrefix)))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .slice(0, limit);
}

/** Focus a tab and its window. */
export async function activateTab(tab: Pick<OpenTab, 'id' | 'windowId'>): Promise<void> {
  if (!hasTabsApi()) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (chrome.windows?.update) await chrome.windows.update(tab.windowId, { focused: true });
}

/** Open an http(s) link in a new tab. Unsafe URLs are refused. Returns false if refused. */
export async function openLink(url: string): Promise<boolean> {
  if (!isSafeUrl(url)) return false;
  if (hasTabsApi() && chrome.tabs.create) {
    await chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return true;
}

/** Prefix of this extension's own pages, so they can be hidden from "recent tabs". */
export function ownExtensionPrefix(): string | undefined {
  return typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.getURL('') : undefined;
}
