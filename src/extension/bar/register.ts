/**
 * Website Tabspace Bar registration (opt-in: settings.tabspaceBar.onWebsites).
 *
 * Needs two optional grants, requested only when the user turns the website
 * bar on: the `scripting` permission and http(s) site access. The content
 * script (public/bar-content.js) only inserts a closed-shadow-root host with
 * an <iframe> of bar.html; all bookmark data stays inside that cross-origin
 * extension frame, so page scripts can't read it.
 */

import { releaseFeature, requestFeature, type Needed } from '../shared/grants';

export const BAR_SCRIPT_ID = 'tabspace-bar';
export const BAR_SCRIPT_FILE = 'bar-content.js';
export const BAR_ORIGINS = ['https://*/*', 'http://*/*'];
export const BAR_PERMISSIONS = { permissions: ['scripting'], origins: BAR_ORIGINS } as chrome.permissions.Permissions;

export interface BarRegistrationDeps {
  contains: (p: chrome.permissions.Permissions) => Promise<boolean>;
  scripting: Pick<typeof chrome.scripting, 'registerContentScripts' | 'unregisterContentScripts' | 'getRegisteredContentScripts'> | undefined;
}

export function chromeBarDeps(): BarRegistrationDeps {
  return {
    contains: (p) => (chrome.permissions?.contains ? chrome.permissions.contains(p) : Promise.resolve(false)),
    // chrome.scripting only exists once the optional permission is granted.
    scripting: typeof chrome !== 'undefined' ? chrome.scripting : undefined,
  };
}

/** Register or unregister the content script so it matches the setting + grants. Idempotent. Returns the resulting state. */
export async function syncBarRegistration(enabled: boolean, deps: BarRegistrationDeps = chromeBarDeps()): Promise<'registered' | 'unregistered' | 'no-permission'> {
  const s = deps.scripting;
  const granted = enabled && !!s && (await deps.contains(BAR_PERMISSIONS).catch(() => false));
  const existing = s ? await s.getRegisteredContentScripts({ ids: [BAR_SCRIPT_ID] }).catch(() => []) : [];
  if (!granted) {
    if (existing.length) await s!.unregisterContentScripts({ ids: [BAR_SCRIPT_ID] }).catch(() => undefined);
    return enabled ? 'no-permission' : 'unregistered';
  }
  if (!existing.length) {
    await s!.registerContentScripts([{ id: BAR_SCRIPT_ID, js: [BAR_SCRIPT_FILE], matches: BAR_ORIGINS, runAt: 'document_idle', allFrames: false, persistAcrossSessions: true }]);
  }
  return 'registered';
}

/* ------------------------------------------------------------------ */
/* Grants (security review V21-1) — shared, reference-counted record   */
/* ------------------------------------------------------------------ */

// See src/extension/shared/grants.ts: Tabspace releases only what it obtained, and only once
// no other feature (the search results look) still relies on it.

/**
 * Turn the website bar on from a click. The permission request is dispatched
 * synchronously (user gesture). `onGranted` runs before the grant record is
 * written (save the setting there).
 */
export function requestWebsiteBar(onGranted?: () => Promise<unknown>): Promise<boolean> {
  return requestFeature('bar', { permissions: ['scripting'], origins: BAR_ORIGINS }, onGranted, BAR_ORIGINS);
}

/** Release what Tabspace obtained for the website bar and nothing else still needs. Idempotent. */
export function releaseBarGrant(): Promise<Needed | null> {
  return releaseFeature('bar', undefined, BAR_ORIGINS);
}

/** @deprecated use releaseBarGrant (kept for callers of the V2.1 API). */
export const releaseWebsiteBar = releaseBarGrant;
