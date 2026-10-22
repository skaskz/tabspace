import type { Settings } from '@/types/models';
import { releaseFeature, requestFeature, type Needed } from '../shared/grants';

/**
 * "Tabspace look for search results" (opt-in: settings.searchTheme).
 *
 * A registered content script (CSS at document_start + a small script) for the
 * selected engines' result pages only. It changes colours/backgrounds and adds
 * a static starfield layer behind the page; it reads no page content and makes
 * no network requests. It needs `scripting` + exactly those engines' origins,
 * requested in the user's click and released (reference-counted with the
 * website bar, see shared/grants.ts) when turned off.
 *
 * Google: only www.google.com (match patterns can't wildcard a TLD; country
 * domains like google.co.uk would each need their own origin).
 */

export type Engine = Settings['searchTheme']['engines'][number];
export const ENGINES: Engine[] = ['google', 'duckduckgo', 'bing'];

export const ENGINE_INFO: Record<Engine, { label: string; origin: string; matches: string[] }> = {
  google: { label: 'Google', origin: 'https://www.google.com/*', matches: ['https://www.google.com/search*'] },
  duckduckgo: { label: 'DuckDuckGo', origin: 'https://duckduckgo.com/*', matches: ['https://duckduckgo.com/*'] },
  bing: { label: 'Bing', origin: 'https://www.bing.com/*', matches: ['https://www.bing.com/search*'] },
};

export const SEARCH_SCRIPT_ID = 'tabspace-search-theme';
export const SEARCH_CSS = 'search-theme.css';
export const SEARCH_JS = 'search-theme.js';

export function engineList(engines: unknown): Engine[] {
  return Array.isArray(engines) ? ENGINES.filter((e) => engines.includes(e)) : [];
}

export function neededFor(engines: Engine[]): Needed {
  return { permissions: ['scripting'], origins: engines.map((e) => ENGINE_INFO[e].origin) };
}

export interface SearchRegistrationDeps {
  contains: (p: chrome.permissions.Permissions) => Promise<boolean>;
  scripting: Pick<typeof chrome.scripting, 'registerContentScripts' | 'unregisterContentScripts' | 'getRegisteredContentScripts'> | undefined;
}

export function chromeSearchDeps(): SearchRegistrationDeps {
  return {
    contains: (p) => (chrome.permissions?.contains ? chrome.permissions.contains(p) : Promise.resolve(false)),
    scripting: typeof chrome !== 'undefined' ? chrome.scripting : undefined,
  };
}

/** Pure: match patterns for the engines that are both selected and granted. */
export function matchesFor(engines: Engine[]): string[] {
  return engines.flatMap((e) => ENGINE_INFO[e].matches);
}

/**
 * Register (or re-register with new matches) / unregister the content script so it
 * matches the setting and the grants actually held. Idempotent. Returns the
 * engines it is active for.
 */
export async function syncSearchRegistration(theme: Settings['searchTheme'] | undefined, deps: SearchRegistrationDeps = chromeSearchDeps()): Promise<Engine[]> {
  const s = deps.scripting;
  const selected = theme?.enabled === true ? engineList(theme.engines) : [];
  const granted: Engine[] = [];
  if (s && selected.length && (await deps.contains({ permissions: ['scripting'] } as chrome.permissions.Permissions).catch(() => false))) {
    for (const e of selected) if (await deps.contains({ origins: [ENGINE_INFO[e].origin] }).catch(() => false)) granted.push(e);
  }
  const existing = s ? await s.getRegisteredContentScripts({ ids: [SEARCH_SCRIPT_ID] }).catch(() => []) : [];
  const want = matchesFor(granted);
  const have = existing[0]?.matches ?? [];
  const same = existing.length > 0 && want.length === have.length && want.every((m) => have.includes(m));
  if (same) return granted;
  if (existing.length) await s!.unregisterContentScripts({ ids: [SEARCH_SCRIPT_ID] }).catch(() => undefined);
  if (want.length) {
    await s!.registerContentScripts([{ id: SEARCH_SCRIPT_ID, matches: want, css: [SEARCH_CSS], js: [SEARCH_JS], runAt: 'document_start', allFrames: false, persistAcrossSessions: true }]);
  }
  return granted;
}

/** Turn the look on (or add engines) from a click; `onGranted` saves the setting before the grant record is written. */
export function requestSearchTheme(engines: Engine[], onGranted?: () => Promise<unknown>): Promise<boolean> {
  if (!engines.length) return Promise.resolve(false);
  return requestFeature('search', neededFor(engines), onGranted);
}

/** Turn the look off (all engines) or drop some engines; releases only what nothing else uses. */
export function releaseSearchTheme(engines?: Engine[]): Promise<Needed | null> {
  return releaseFeature('search', engines ? engines.map((e) => ENGINE_INFO[e].origin) : undefined);
}
