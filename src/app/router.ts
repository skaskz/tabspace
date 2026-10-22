import { useSyncExternalStore } from 'react';
import type { PageId } from '@/types/models';

/**
 * Tiny hash router (`#/tasks?id=…`). Hash routing works on chrome-extension://
 * pages without server rewrites and keeps the dependency list short.
 */

export const PAGES: PageId[] = ['dashboard', 'workspaces', 'tabs', 'calendar', 'notes', 'tasks', 'bookmarks', 'focus', 'analytics', 'settings', 'sidebar'];

export interface Route {
  page: PageId;
  params: URLSearchParams;
}

export function parseHash(hash: string, fallback: PageId = 'dashboard'): Route {
  const clean = hash.replace(/^#\/?/, '');
  const [path, query = ''] = clean.split('?');
  const page = (PAGES as string[]).includes(path) ? (path as PageId) : fallback;
  return { page, params: new URLSearchParams(query) };
}

export function buildHash(page: PageId, params?: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) qs.set(k, v);
  const q = qs.toString();
  return `#/${page}${q ? `?${q}` : ''}`;
}

export function navigate(page: PageId, params?: Record<string, string | undefined>): void {
  window.location.hash = buildHash(page, params);
}

let cached: { hash: string; route: Route } | null = null;
let fallbackPage: PageId = 'dashboard';

export function setFallbackPage(page: PageId) {
  fallbackPage = page;
  cached = null;
}

function snapshot(): Route {
  const hash = window.location.hash;
  if (!cached || cached.hash !== hash) cached = { hash, route: parseHash(hash, fallbackPage) };
  return cached.route;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    snapshot,
  );
}

/** URL of the full dashboard page, for opening from the sidebar/popup/new tab. */
export function dashboardUrl(page: PageId = 'dashboard', params?: Record<string, string | undefined>): string {
  const base = typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.getURL('dashboard.html') : '/dashboard.html';
  return base + buildHash(page, params);
}

/** Open (or focus) the dashboard in a tab from any extension surface. */
export async function openDashboard(page: PageId = 'dashboard', params?: Record<string, string | undefined>): Promise<void> {
  const url = dashboardUrl(page, params);
  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    const base = chrome.runtime.getURL('dashboard.html');
    const [existing] = await chrome.tabs.query({ url: `${base}*` });
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { active: true, url });
      if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
    await chrome.tabs.create({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}
