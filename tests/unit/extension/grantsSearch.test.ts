import { describe, expect, it, vi } from 'vitest';
import { addGrant, covers, dropGrant, migrateLegacy, sanitize, type GrantRecord } from '@/extension/shared/grants';
import { ENGINE_INFO, SEARCH_SCRIPT_ID, matchesFor, neededFor, syncSearchRegistration, type SearchRegistrationDeps } from '@/extension/search/register';

const ALL = ['https://*/*', 'http://*/*'];
const G = 'https://www.google.com/*';
const D = 'https://duckduckgo.com/*';
const none = { scripting: false, origins: {} as Record<string, boolean> };
const empty = (): GrantRecord => ({ scripting: [], origins: {} });

describe('pattern coverage', () => {
  it('covers by scheme, host wildcard and path prefix', () => {
    expect(covers('https://*/*', G)).toBe(true);
    expect(covers('http://*/*', G)).toBe(false);
    expect(covers('*://*/*', 'http://a.example/*')).toBe(true);
    expect(covers('https://*.google.com/*', G)).toBe(true);
    expect(covers('https://*.google.com/*', 'https://google.com/*')).toBe(true);
    expect(covers(G, 'https://www.google.com/search*')).toBe(true);
    expect(covers(G, D)).toBe(false);
  });
});

describe('reference-counted grants (bar + search)', () => {
  it('search enabled while the bar holds all-https: references the bar grant instead of tracking google separately', () => {
    let r = addGrant(empty(), 'bar', { permissions: ['scripting'], origins: ALL }, none);
    expect(r).toEqual({ scripting: ['bar'], origins: { 'https://*/*': ['bar'], 'http://*/*': ['bar'] } });
    // Google is "already held" through the bar's broad grant.
    r = addGrant(r, 'search', neededFor(['google']), { scripting: true, origins: { [G]: true } });
    expect(r.scripting).toEqual(['bar', 'search']);
    expect(r.origins['https://*/*']).toEqual(['bar', 'search']);
    expect(r.origins[G]).toBeUndefined();
    // Bar off: nothing released (search still uses scripting + the broad grant).
    let d = dropGrant(r, 'bar');
    expect(d.release).toEqual({ permissions: [], origins: ['http://*/*'] });
    expect(d.record).toEqual({ scripting: ['search'], origins: { 'https://*/*': ['search'] } });
    // Search off: now everything Tabspace obtained goes.
    d = dropGrant(d.record, 'search');
    expect(d.release).toEqual({ permissions: ['scripting'], origins: ['https://*/*'] });
    expect(d.record).toEqual(empty());
  });

  it('search first (exact engine origins), bar later: each releases only its own', () => {
    let r = addGrant(empty(), 'search', neededFor(['google', 'duckduckgo']), none);
    expect(r).toEqual({ scripting: ['search'], origins: { [G]: ['search'], [D]: ['search'] } });
    r = addGrant(r, 'bar', { permissions: ['scripting'], origins: ALL }, { scripting: true, origins: {} });
    expect(r.scripting).toEqual(['search', 'bar']);
    const d = dropGrant(r, 'search');
    expect(d.release).toEqual({ permissions: [], origins: [G, D] });
    expect(d.record.scripting).toEqual(['bar']);
  });

  it('dropping one engine releases only that origin (and its reference on a covering grant)', () => {
    const r = addGrant(empty(), 'search', neededFor(['google', 'duckduckgo']), none);
    const d = dropGrant(r, 'search', [D]);
    expect(d.release).toEqual({ permissions: [], origins: [D] });
    expect(d.record).toEqual({ scripting: ['search'], origins: { [G]: ['search'] } });
  });

  it("never tracks the user's own grants", () => {
    const r = addGrant(empty(), 'search', neededFor(['google']), { scripting: true, origins: { [G]: true } });
    expect(r).toEqual(empty());
    expect(dropGrant(r, 'search').release).toEqual({ permissions: [], origins: [] });
  });

  it('sanitises tampered records and migrates the V2.1 bar record', () => {
    expect(sanitize({ scripting: ['bar', 'evil'], origins: { '<all_urls>': ['bar'], [G]: ['search', 1], bad: 'x' } })).toEqual({ scripting: ['bar'], origins: { [G]: ['search'] } });
    expect(migrateLegacy({ scripting: true, origins: ['https://*/*', '<all_urls>'] }, ALL)).toEqual({ scripting: ['bar'], origins: { 'https://*/*': ['bar'] } });
  });
});

describe('search theme registration', () => {
  function deps(granted: string[], registered: { matches: string[] } | null = null) {
    let reg = registered ? [{ id: SEARCH_SCRIPT_ID, ...registered }] : [];
    const d: SearchRegistrationDeps & { reg: () => typeof reg } = {
      reg: () => reg,
      contains: vi.fn(async (p: chrome.permissions.Permissions) => [...(p.permissions ?? []), ...(p.origins ?? [])].every((x) => granted.includes(x))),
      scripting: {
        registerContentScripts: vi.fn(async (s: chrome.scripting.RegisteredContentScript[]) => void (reg = s.map((x) => ({ id: x.id, matches: x.matches ?? [] })))),
        unregisterContentScripts: vi.fn(async () => void (reg = [])),
        getRegisteredContentScripts: vi.fn(async () => reg as unknown as chrome.scripting.RegisteredContentScript[]),
      } as unknown as SearchRegistrationDeps['scripting'],
    };
    return d;
  }

  it('registers CSS (document_start) + JS for the selected AND granted engines only', async () => {
    const d = deps(['scripting', G]);
    expect(await syncSearchRegistration({ enabled: true, engines: ['google', 'bing'] }, d)).toEqual(['google']);
    expect(d.scripting!.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ id: SEARCH_SCRIPT_ID, matches: ENGINE_INFO.google.matches, css: ['search-theme.css'], js: ['search-theme.js'], runAt: 'document_start', allFrames: false }),
    ]);
    // Same state again: no churn.
    await syncSearchRegistration({ enabled: true, engines: ['google', 'bing'] }, d);
    expect(d.scripting!.registerContentScripts).toHaveBeenCalledTimes(1);
  });

  it('re-registers when the engine set changes and unregisters when off or ungranted', async () => {
    const d = deps(['scripting', G, D], { matches: matchesFor(['google']) });
    await syncSearchRegistration({ enabled: true, engines: ['google', 'duckduckgo'] }, d);
    expect(d.reg()[0].matches).toEqual(matchesFor(['google', 'duckduckgo']));
    await syncSearchRegistration({ enabled: false, engines: ['google'] }, d);
    expect(d.reg()).toEqual([]);
    const d2 = deps([G], { matches: matchesFor(['google']) }); // scripting revoked
    expect(await syncSearchRegistration({ enabled: true, engines: ['google'] }, d2)).toEqual([]);
    expect(d2.reg()).toEqual([]);
  });

  it('result pages only: google /search, bing /search; DuckDuckGo results are filtered by the script (?q=)', () => {
    expect(matchesFor(['google', 'duckduckgo', 'bing'])).toEqual(['https://www.google.com/search*', 'https://duckduckgo.com/*', 'https://www.bing.com/search*']);
  });
});
