import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error -- jsdom ships no type declarations in this project
import { JSDOM } from 'jsdom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BAR_PERMISSIONS, syncBarRegistration } from '@/extension/bar/register';
import { barItems, folderContents, isBarModeMessage, siteKey, websiteBarAllowed } from '@/extension/bar/logic';
import { openBarLink } from '@/extension/bar/TabspaceBar';
import { TabspaceBarSettings } from '@/pages/sidebar/TabspaceBarSettings';
import { set } from '@/storage/store';
import { DEFAULT_SETTINGS } from '@/storage/schema';
import type { Bookmark } from '@/types/models';

const ROOT = resolve(__dirname, '../..');
const DANGEROUS = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'chrome://settings', 'chrome-extension://abc/dashboard.html', 'vbscript:x'];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Manifest guard rails                                                */
/* ------------------------------------------------------------------ */

describe('manifest: web-accessible surface and CSP', () => {
  const m = JSON.parse(readFileSync(resolve(ROOT, 'public/manifest.json'), 'utf8'));
  it('only bar.html is web-accessible, only to http(s) pages, only via the dynamic URL', () => {
    const war = m.web_accessible_resources as { resources: string[]; matches: string[]; use_dynamic_url?: boolean }[];
    expect(war.flatMap((w) => w.resources)).toEqual(['bar.html']);
    for (const w of war) {
      expect(w.use_dynamic_url).toBe(true);
      for (const p of w.matches) expect(p).toMatch(/^https?:\/\/\*\/\*$/);
    }
  });
  it('CSP keeps script/object restrictions; frame-ancestors never allows other extensions or "*"', () => {
    const csp: string = m.content_security_policy.extension_pages;
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).toMatch(/object-src 'self'/);
    expect(csp).toMatch(/base-uri 'self'/);
    const fa = /frame-ancestors ([^;]+)/.exec(csp)?.[1] ?? '';
    expect(fa).not.toMatch(/\*|chrome-extension:/);
  });
  it('scripting and site access stay optional; no static content scripts', () => {
    expect(m.permissions).not.toContain('scripting');
    expect(m.host_permissions ?? []).toEqual([]);
    expect(m.content_scripts).toBeUndefined();
    expect(m.optional_permissions).toContain('scripting');
    expect(m.externally_connectable).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Content script                                                      */
/* ------------------------------------------------------------------ */

type Listener = (msg: unknown, sender: { id?: string }, sendResponse?: (r: unknown) => void) => void;
function loadContentScript(settings: unknown, opts: { url?: string; inFrame?: boolean } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><p>page</p></body></html>', { url: opts.url ?? 'https://news.example/a', runScripts: 'outside-only' });
  const w = dom.window as unknown as { chrome: unknown; eval: (s: string) => unknown; document: Document };
  let onMessage: Listener = () => undefined;
  const url = opts.url ?? 'https://news.example/a';
  // The worker answers 'tsbar:query' from the settings + the sender's URL (V21-3: the content script never reads storage).
  const decide = (s: unknown) => websiteBarAllowed((s as { tabspaceBar?: typeof DEFAULT_SETTINGS.tabspaceBar } | undefined)?.tabspaceBar, url);
  const storageGet = vi.fn(async () => ({}));
  w.chrome = {
    runtime: {
      id: 'me',
      getURL: (p: string) => `chrome-extension://dyn-guid/${p}`,
      onMessage: { addListener: (l: Listener) => (onMessage = l) },
      sendMessage: async (m: { type?: string }) => (m?.type === 'tsbar:query' ? { show: decide(settings) } : undefined),
    },
    storage: { local: { get: storageGet }, onChanged: { addListener: () => undefined } },
  };
  let target = w;
  if (opts.inFrame) {
    // Run inside a child frame of the page: window.top !== window.
    const f = dom.window.document.createElement('iframe');
    dom.window.document.body.appendChild(f);
    target = f.contentWindow as unknown as typeof w;
    target.chrome = w.chrome;
  }
  target.eval(readFileSync(resolve(ROOT, 'public/bar-content.js'), 'utf8'));
  return {
    dom,
    storageGet,
    doc: (target as unknown as { document: Document }).document,
    send: (m: unknown, s = { id: 'me' }, sendResponse?: (r: unknown) => void) => onMessage(m, s, sendResponse),
    // Worker push after a settings change.
    change: (s: unknown) => onMessage({ type: 'tsbar:state', show: decide(s) }, { id: 'me' }),
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const ON = { tabspaceBar: { onWebsites: true, disabledSites: ['bank.example'] } };

describe('bar content script (public/bar-content.js)', () => {
  it('source has no eval/innerHTML/postMessage channel and never reads page data', () => {
    const src = readFileSync(resolve(ROOT, 'public/bar-content.js'), 'utf8');
    expect(src).not.toMatch(/\beval\(|new Function|innerHTML|insertAdjacentHTML|postMessage|addEventListener\(['"]message|document\.cookie|localStorage|sessionStorage/);
    // BUG-BAR1 header offsetting inspects layout only (computed position/top, bounding boxes) — never page content.
    expect(src).not.toMatch(/innerText|textContent|outerHTML|getSelection|\.href\b/);
    expect(src).toMatch(/attachShadow\(\{ mode: 'closed' \}\)/);
  });

  it('mounts one closed-shadow host whose only child is an extension iframe', async () => {
    const { doc } = loadContentScript(ON);
    await flush();
    const hosts = doc.querySelectorAll('tabspace-bar');
    expect(hosts).toHaveLength(1);
    expect((hosts[0] as HTMLElement).shadowRoot).toBeNull(); // closed: page scripts can't reach the frame
    expect(doc.querySelectorAll('iframe')).toHaveLength(0); // not in the light DOM
  });

  it.each([
    ['off by default', DEFAULT_SETTINGS],
    ['missing settings', undefined],
    ['onWebsites truthy but not true', { tabspaceBar: { onWebsites: 'yes', disabledSites: [] } }],
  ])('does nothing when %s', async (_l, s) => {
    const { doc } = loadContentScript(s);
    await flush();
    expect(doc.querySelector('tabspace-bar')).toBeNull();
  });

  it('respects hidden sites (incl. subdomains) and never runs in sub-frames', async () => {
    let r = loadContentScript(ON, { url: 'https://login.bank.example/' });
    await flush();
    expect(r.doc.querySelector('tabspace-bar')).toBeNull();
    r = loadContentScript(ON, { inFrame: true });
    await flush();
    expect(r.doc.querySelector('tabspace-bar')).toBeNull();
  });

  it('ignores forged or malformed size messages; restores the page margin on unmount', async () => {
    const { doc, send, change } = loadContentScript(ON);
    await flush();
    const html = doc.documentElement;
    expect(html.style.getPropertyValue('margin-top')).toBe('34px');
    for (const [m, s] of [
      [{ type: 'tsbar:mode', mode: 'expanded' }, { id: 'other-extension' }],
      [{ type: 'tsbar:mode', mode: 'fullscreen' }, { id: 'me' }],
      [{ type: 'tsbar:mode', mode: 'expanded', height: 99999 }, { id: 'me' }],
      [{ type: 'tsbar:mode', mode: ['expanded'] }, { id: 'me' }],
      ['tsbar:mode', { id: 'me' }],
      [null, { id: 'me' }],
    ] as const) {
      send(m, s as { id: string });
    }
    expect(html.style.getPropertyValue('margin-top')).toBe('34px');
    send({ type: 'tsbar:mode', mode: 'collapsed' });
    expect(html.style.getPropertyValue('margin-top')).toBe('');
    send({ type: 'tsbar:mode', mode: 'bar' });
    change({ tabspaceBar: { onWebsites: false, disabledSites: [] } });
    expect(doc.querySelector('tabspace-bar')).toBeNull();
    expect(html.style.getPropertyValue('margin-top')).toBe('');
  });

  // FINDING V21-2 (Low): the host's inline styles are not !important for opacity/visibility/filter etc., so the
  // page's own CSS (`tabspace-bar{opacity:0!important}`) makes the real bar invisible but still clickable —
  // clickjacking the bar's actions. Confirmed in real Chromium. Flip once the frame checks visibility
  // (IntersectionObserver v2 trackVisibility) before acting, or the host pins these properties.
  it('host pins opacity/visibility with !important', async () => {
    const { doc } = loadContentScript(ON);
    await flush();
    const host = doc.querySelector('tabspace-bar') as HTMLElement;
    expect(host.style.getPropertyPriority('opacity')).toBe('important');
    expect(host.style.getPropertyPriority('visibility')).toBe('important');
    for (const k of ['filter', 'clip-path', 'transform', 'pointer-events', 'display']) expect(host.style.getPropertyPriority(k)).toBe('important');
    // The page rewriting the host's inline style is undone (MutationObserver re-pins).
    host.setAttribute('style', 'opacity: 0 !important; visibility: hidden !important');
    await flush();
    expect(host.style.getPropertyValue('opacity')).toBe('1');
    expect(host.style.getPropertyValue('visibility')).toBe('visible');
  });

  it('never touches extension storage; answers the frame nonce check only for its own nonce (V21-3/V21-5)', async () => {
    const { doc, send, storageGet } = loadContentScript(ON);
    await flush();
    expect(storageGet).not.toHaveBeenCalled();
    const src = readFileSync(resolve(ROOT, 'public/bar-content.js'), 'utf8');
    expect(src).not.toMatch(/chrome\.storage/);
    const replies: unknown[] = [];
    send({ type: 'tsbar:verify', nonce: 'wrong' }, { id: 'me' }, (r) => replies.push(r));
    send({ type: 'tsbar:verify', nonce: 'x' }, { id: 'other-extension' }, (r) => replies.push(r));
    expect(replies).toEqual([{ ok: false }]);
    expect(doc.querySelector('tabspace-bar')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Registration + permission flow                                      */
/* ------------------------------------------------------------------ */

describe('website bar registration', () => {
  const deps = (granted: boolean, existing: unknown[] = []) => {
    const scripting = {
      registerContentScripts: vi.fn(async () => undefined),
      unregisterContentScripts: vi.fn(async () => undefined),
      getRegisteredContentScripts: vi.fn(async () => existing),
    };
    return { scripting, d: { contains: vi.fn(async () => granted), scripting: scripting as never } };
  };
  it('registers only when enabled AND granted, top frame only, http(s) only, our file only', async () => {
    let x = deps(true);
    expect(await syncBarRegistration(true, x.d)).toBe('registered');
    const [[scripts]] = x.scripting.registerContentScripts.mock.calls as unknown as [[chrome.scripting.RegisteredContentScript[]]];
    expect(scripts).toHaveLength(1);
    expect(scripts[0].js).toEqual(['bar-content.js']);
    expect(scripts[0].allFrames).toBe(false);
    expect(scripts[0].matches).toEqual(['https://*/*', 'http://*/*']);
    expect(scripts[0].css).toBeUndefined();
    expect((scripts[0] as { world?: string }).world).toBeUndefined(); // isolated world, never MAIN
    x = deps(false);
    expect(await syncBarRegistration(true, x.d)).toBe('no-permission');
    expect(x.scripting.registerContentScripts).not.toHaveBeenCalled();
  });
  it('unregisters when disabled or when the grant disappears', async () => {
    for (const [enabled, granted] of [
      [false, true],
      [true, false],
    ] as const) {
      const x = deps(granted, [{ id: 'tabspace-bar' }]);
      await syncBarRegistration(enabled, x.d);
      expect(x.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['tabspace-bar'] });
    }
  });
});

describe('website bar settings: permission request / release', () => {
  function stubPerms(heldInitially: boolean, grant = true) {
    let held = heldInitially;
    const listeners: (() => void)[] = [];
    const fire = () => setTimeout(() => listeners.forEach((l) => l()), 0);
    const request = vi.fn(async () => {
      if (grant) held = true;
      fire();
      return grant;
    });
    const remove = vi.fn(async () => {
      held = false;
      fire();
      return true;
    });
    const evt = { addListener: (l: () => void) => listeners.push(l), removeListener: () => undefined };
    const local = new Map<string, unknown>();
    vi.stubGlobal('chrome', {
      permissions: { request, remove, contains: vi.fn(async () => held), onAdded: evt, onRemoved: evt },
      storage: {
        local: {
          get: async (k: string) => (local.has(k) ? { [k]: local.get(k) } : {}),
          set: async (o: Record<string, unknown>) => void Object.entries(o).forEach(([k, v]) => local.set(k, v)),
          remove: async (k: string) => void local.delete(k),
        },
      },
    });
    return { request, remove, local };
  }
  const toggle = () => screen.getByRole('switch', { name: 'Show on websites' });

  it('requests scripting + http(s) access synchronously in the click; a denial saves nothing', async () => {
    const p = stubPerms(false, false);
    render(<TabspaceBarSettings />);
    await act(flush);
    fireEvent.click(toggle());
    expect(p.request).toHaveBeenCalledTimes(1); // same tick as the click (user gesture)
    expect(p.request).toHaveBeenCalledWith(BAR_PERMISSIONS);
    await act(flush);
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
  });

  it('enable then disable in one visit releases the grant', async () => {
    const p = stubPerms(false);
    render(<TabspaceBarSettings />);
    await act(flush);
    fireEvent.click(toggle());
    await act(flush);
    await act(flush);
    fireEvent.click(toggle());
    await act(flush);
    await act(flush);
    expect(p.remove).toHaveBeenCalledWith(BAR_PERMISSIONS);
  });

  // FINDING V21-1 (Low–Medium): "held before" is computed when the settings page mounts. If the bar was enabled in
  // an earlier visit, its own grant is seen as pre-existing, so turning the bar off later NEVER releases
  // "read and change all your data on all websites". Flip once the release decision is persisted at grant time.
  it('disabling a bar that was enabled in an earlier visit releases the grant', async () => {
    await set('ts.settings', { ...DEFAULT_SETTINGS, tabspaceBar: { ...DEFAULT_SETTINGS.tabspaceBar, onWebsites: true } });
    const p = stubPerms(true);
    // What the earlier visit persisted when Tabspace obtained the grant.
    p.local.set('ts.barGrant', { scripting: true, origins: ['https://*/*', 'http://*/*'] });
    render(<TabspaceBarSettings />);
    await act(flush);
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle());
    await act(flush);
    await act(flush);
    expect(p.remove).toHaveBeenCalledWith({ permissions: ['scripting'], origins: ['https://*/*', 'http://*/*'] });
    expect(p.local.has('ts.barGrant')).toBe(false);
  });

  it('never releases grants the user already held before enabling (no record)', async () => {
    await set('ts.settings', { ...DEFAULT_SETTINGS, tabspaceBar: { ...DEFAULT_SETTINGS.tabspaceBar, onWebsites: true } });
    const p = stubPerms(true);
    render(<TabspaceBarSettings />);
    await act(flush);
    fireEvent.click(toggle());
    await act(flush);
    await act(flush);
    expect(p.remove).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Bar links / logic                                                   */
/* ------------------------------------------------------------------ */

describe('bar links', () => {
  it.each(DANGEROUS)('openBarLink refuses %j in every mode', async (url) => {
    const create = vi.fn();
    const update = vi.fn();
    vi.stubGlobal('chrome', { tabs: { create, update } });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await openBarLink(url, true, 1);
    await openBarLink(url, false, 1);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it('bar items and folder contents never include non-http(s) bookmarks', () => {
    const bm = (id: string, url: string): Bookmark => ({ id, url, title: id, createdAt: 1, updatedAt: 1, tags: [], favorite: true, folderId: 'f' });
    const list = [bm('ok', 'https://a.example'), ...DANGEROUS.map((u, i) => bm(`bad${i}`, u))];
    expect(barItems(list, [], false).map((i) => (i.kind === 'link' ? i.bookmark.id : ''))).toEqual(['ok']);
    expect(folderContents('f', list, []).links.map((b) => b.id)).toEqual(['ok']);
  });
  it('siteKey / websiteBarAllowed ignore non-web URLs', () => {
    for (const u of DANGEROUS) {
      expect(siteKey(u)).toBeNull();
      expect(websiteBarAllowed({ ...DEFAULT_SETTINGS.tabspaceBar, onWebsites: true }, u)).toBe(false);
    }
  });
  it('isBarModeMessage is strict', () => {
    expect(isBarModeMessage({ type: 'tsbar:mode', mode: 'bar' })).toBe(true);
    for (const m of [null, 'x', {}, { type: 'tsbar:mode' }, { type: 'tsbar:mode', mode: 'huge' }, { type: 'tsbar:mode', mode: 'bar', h: 1 }, { type: 'x', mode: 'bar' }]) expect(isBarModeMessage(m)).toBe(false);
  });
});
