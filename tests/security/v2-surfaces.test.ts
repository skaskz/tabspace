import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { renderMarkdown } from '@/features/notes/markdown';
import { applyPending, composeNote, markdownLink, LOCAL_BACKUP_PREFIX, PENDING_PREFIX } from '@/extension/popup/quickNote';
import { openQuickNote, POPUP_MODE_KEY } from '@/extension/background/quickNoteCommand';
import { addNoteBookmark, noteBookmarkUrl } from '@/extension/shared/noteBookmark';
import { addSavedTab, mergeSavedTabs } from '@/features/workspaces/savedTabs';
import { safeImage, toSnapshot } from '@/integrations/spotify/service';
import { createSpotifyClient, mapSpotifyError } from '@/integrations/spotify/api';
import { clearAllData } from '@/services/backup';
import type { Note } from '@/types/models';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DANGEROUS = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'chrome://settings', 'chrome-extension://abc/popup.html#note', 'vbscript:x', 'blob:https://a.example/x'];

function links(html: string) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return Array.from(doc.querySelectorAll('a')).map((a) => a.getAttribute('href')!);
}

/* ------------------------------------------------------------------ */
/* Quick Note: attach-page-link                                        */
/* ------------------------------------------------------------------ */

describe('Quick Note attach-page-link', () => {
  it.each(DANGEROUS)('refuses to attach %j', (url) => {
    expect(markdownLink({ url, title: 't' })).toBeNull();
    expect(composeNote('hello', { url, title: 't' }).content).toBe('');
  });

  it.each([
    ['closing paren in URL', 'https://en.wikipedia.org/wiki/Foo_(bar)', 'Foo (bar)'],
    ['space in URL', 'https://a.example/a b', 'x'],
    ['bracket in title', 'https://a.example/', 'a]b[c'],
    ['markdown in title', 'https://a.example/', '**bold** _x_ `code`'],
    ['HTML in title', 'https://a.example/', '<img src=x onerror=alert(1)>'],
    ['backslash in title', 'https://a.example/', 'a\\'],
  ])('%s still renders as exactly one safe link to the page', (_l, url, title) => {
    const md = markdownLink({ url, title })!;
    const hrefs = links(renderMarkdown(md));
    expect(hrefs).toHaveLength(1);
    expect(new URL(hrefs[0]).hostname).toBe(new URL(url).hostname);
    expect(renderMarkdown(md)).not.toMatch(/<img/i);
  });

  // FINDING V2-2 (Low): markdownLink escapes "]" as "\]", but renderMarkdown has no backslash escapes, so a page
  // whose <title> contains "](https://evil.example)" produces a link to a URL the page chose (same-tab phishing link
  // inside the user's own note). Flip to `it` once titles are sanitised in a way the renderer understands.
  it('a hostile page title cannot redirect the attached link elsewhere', () => {
    const md = markdownLink({ url: 'https://bank.example/login', title: 'Bank](https://evil.example/phish) [x' })!;
    const hrefs = links(renderMarkdown(md));
    expect(hrefs.every((h) => new URL(h).hostname === 'bank.example')).toBe(true);
  });

  it('pending/local-backup records with the wrong shape are never applied', () => {
    const list: Note[] = [];
    // (null is filtered by both callers before applyPending is reached)
    for (const bad of [{}, { note: null }, { note: { id: 1, title: 't', content: 'c' } }, { note: { id: 'a', title: { x: 1 }, content: 'c' } }, { note: { id: 'a', title: 't', content: ['c'] } }]) {
      expect(applyPending(list, bad as never).applied).toBe(false);
    }
  });

  it('a stale pending record cannot overwrite a note edited after it', () => {
    const existing: Note = { id: 'n', createdAt: 1, updatedAt: 500, title: 'newer', content: 'newer', tags: [], favorite: false };
    const r = applyPending([existing], { note: { ...existing, title: 'old', content: 'old', updatedAt: 100 }, baseUpdatedAt: 100 });
    expect(r.applied).toBe(false);
    expect(r.list[0].title).toBe('newer');
  });

  // FINDING V2-1 (Low): "Clear all data" does not remove Quick Note pending records, note recovery records or the
  // localStorage backups. Leftovers are merged back on the next popup / worker start, resurrecting deleted text.
  it('Clear all data also removes Quick Note pending / recovery / local backups', async () => {
    const removed: string[] = [];
    vi.stubGlobal('chrome', { storage: { local: { remove: vi.fn(async (k: string[]) => void removed.push(...k)), get: vi.fn(async () => ({ [`${PENDING_PREFIX}x`]: {}, 'ts.notes.unsaved.y': {} })) }, session: { remove: vi.fn(async () => undefined) } } });
    localStorage.setItem(`${LOCAL_BACKUP_PREFIX}z`, '{"note":{"id":"z","title":"secret","content":"secret"}}');
    await clearAllData();
    expect(localStorage.getItem(`${LOCAL_BACKUP_PREFIX}z`)).toBeNull();
    expect(removed).toContain(`${PENDING_PREFIX}x`);
    expect(removed).toContain('ts.notes.unsaved.y');
  });
});

/* ------------------------------------------------------------------ */
/* Quick Note command / bookmark                                       */
/* ------------------------------------------------------------------ */

describe('quick-note command', () => {
  it('fallback window only ever opens the extension popup URL', async () => {
    const createWindow = vi.fn(async () => ({}));
    const setSession = vi.fn(async () => undefined);
    const url = 'chrome-extension://abc/popup.html#note';
    expect(await openQuickNote({ openPopup: async () => Promise.reject(new Error('no window')), setSession, createWindow, popupUrl: url }, 3)).toBe('window');
    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({ url, type: 'popup' }));
    // Flag is cleared so a later toolbar click is not hijacked into note mode.
    expect(setSession).toHaveBeenLastCalledWith({ [POPUP_MODE_KEY]: null });
  });
});

describe('"+ New Note" bookmark', () => {
  function stub(granted: boolean) {
    const remove = vi.fn(async () => true);
    const create = vi.fn(async () => ({}));
    vi.stubGlobal('chrome', {
      runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` },
      permissions: { request: vi.fn(async () => granted), remove, contains: vi.fn(async () => false) },
      bookmarks: { search: vi.fn(async () => []), getTree: vi.fn(async () => [{ id: '0', children: [{ id: '1', title: 'Bookmarks bar' }] }]), create },
    });
    return { remove, create };
  }
  it('points only at this extension’s popup and releases the permission afterwards', async () => {
    const { remove, create } = stub(true);
    expect(await addNoteBookmark(false)).toBe('added');
    expect(create).toHaveBeenCalledWith({ parentId: '1', title: '+ New Note', url: 'chrome-extension://abc/popup.html#note' });
    expect(noteBookmarkUrl()).toBe('chrome-extension://abc/popup.html#note');
    expect(remove).toHaveBeenCalledWith({ permissions: ['bookmarks'] });
  });
  it('keeps a permission the user had already granted, and does nothing when denied', async () => {
    let s = stub(true);
    await addNoteBookmark(true);
    expect(s.remove).not.toHaveBeenCalled();
    s = stub(false);
    expect(await addNoteBookmark(false)).toBe('denied');
    expect(s.create).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Offscreen document                                                  */
/* ------------------------------------------------------------------ */

describe('offscreen document', () => {
  const root = resolve(__dirname, '../../public');
  it('offscreen.html has no inline script and no remote resources (CSP script-src self)', () => {
    const html = readFileSync(resolve(root, 'offscreen.html'), 'utf8');
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) {
      expect(body.trim()).toBe('');
      expect(attrs).toMatch(/src="[^":/]+\.js"/);
    }
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('offscreen.js only obeys {target:"offscreen", type:"chime"} from this extension', () => {
    const src = readFileSync(resolve(root, 'offscreen.js'), 'utf8');
    expect(src).not.toMatch(/\beval\(|new Function|innerHTML|fetch\(|importScripts/);
    let listener: (m: unknown, s: { id?: string }, r: (x: unknown) => void) => unknown = () => undefined;
    const audio = vi.fn();
    class FakeCtx {
      currentTime = 0;
      state = 'running';
      destination = {};
      constructor() {
        audio();
      }
      createGain() {
        return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x ?? {} };
      }
      createOscillator() {
        return { type: '', frequency: { value: 0 }, connect: (x: { connect?: unknown }) => x, start() {}, stop() {} };
      }
      resume() {
        return Promise.resolve();
      }
    }
    vm.runInNewContext(src, { chrome: { runtime: { id: 'me', onMessage: { addListener: (l: typeof listener) => (listener = l) } } }, AudioContext: FakeCtx, Promise, String });
    const respond = vi.fn();
    expect(listener({ target: 'offscreen', type: 'chime' }, { id: 'other-extension' }, respond)).toBeUndefined();
    expect(listener({ target: 'offscreen', type: 'eval', code: '1' }, { id: 'me' }, respond)).toBeUndefined();
    expect(listener({ type: 'chime' }, { id: 'me' }, respond)).toBeUndefined();
    expect(listener(null, { id: 'me' }, respond)).toBeUndefined();
    expect(audio).not.toHaveBeenCalled();
    expect(listener({ target: 'offscreen', type: 'chime' }, { id: 'me' }, respond)).toBe(true);
    expect(audio).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* Workspace saved tabs                                                */
/* ------------------------------------------------------------------ */

describe('workspace saved-tab editing', () => {
  const empty: Parameters<typeof addSavedTab>[0] = { tabs: [], groups: [] };
  it.each(DANGEROUS)('addSavedTab refuses %j', (url) => {
    expect(() => addSavedTab(empty, { id: 'x', url, title: 't' })).toThrow();
  });
  it('drops a non-http favicon on added tabs', () => {
    expect(addSavedTab(empty, { id: 'x', url: 'https://a.example', title: 't', favIconUrl: 'javascript:alert(1)' }).tabs[0].favIconUrl).toBeUndefined();
  });
  // FINDING V2-4 (Info): mergeSavedTabs trusts its input (callers pass serializeWindow output, which filters).
  // Defence in depth: it should drop non-http(s) URLs itself. Flip to `it` when it does.
  it('mergeSavedTabs drops unsafe incoming URLs', () => {
    const m = mergeSavedTabs(empty, { tabs: [{ id: 'a', url: 'javascript:alert(1)', title: 'x', pinned: false }], groups: [] });
    expect(m.session.tabs).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Spotify V2                                                          */
/* ------------------------------------------------------------------ */

describe('Spotify V2', () => {
  it.each([
    'http://i.scdn.co/image/abc',
    'https://i.scdn.co.evil.example/image/abc',
    'https://evilscdn.co/x',
    'https://scdn.co@evil.example/x',
    'https://evil.example/?u=https://i.scdn.co/x',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '//i.scdn.co/x',
    42,
  ])('snapshot image rejects %j', (u) => {
    expect(safeImage(u)).toBeUndefined();
  });
  it('snapshot image keeps Spotify CDN https URLs', () => {
    expect(safeImage('https://i.scdn.co/image/ab67')).toBe('https://i.scdn.co/image/ab67');
    expect(safeImage('https://mosaic.scdn.co/640/x')).toBeDefined();
    expect(safeImage('https://image-cdn-ak.spotifycdn.com/image/x')).toBeDefined();
  });
  it('snapshot clips attacker-sized strings and strips unknown fields', () => {
    const snap = toSnapshot({ isPlaying: true, track: { name: 'n'.repeat(10_000), artists: 'a', image: 'https://evil.example/t.gif', uri: 'u'.repeat(1000) }, device: { id: 'd'.repeat(1000), name: 'x', volumePercent: 5, supportsVolume: true }, accessToken: 'TOKEN' } as never);
    expect(snap.track!.name.length).toBeLessThanOrEqual(300);
    expect(snap.track!.image).toBeUndefined();
    expect(snap.track!.uri!.length).toBeLessThanOrEqual(100);
    expect(snap.device!.id!.length).toBeLessThanOrEqual(100);
    expect(JSON.stringify(snap)).not.toContain('TOKEN');
  });
  it('error mapping never echoes Spotify’s free-text body into the UI message', () => {
    const body = { error: { status: 403, message: 'Bearer BQD-SECRET-TOKEN <img src=x onerror=alert(1)> restriction', reason: 'UNKNOWN' } };
    for (const status of [400, 401, 403, 404, 429, 500, 502]) {
      const e = mapSpotifyError(status, body, '3');
      expect(e.message).not.toMatch(/SECRET|Bearer|<img/);
    }
  });
  it('device ids are URL-encoded (no query-parameter injection) and the token stays in the header', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createSpotifyClient(async () => 'TOK', fetchMock as unknown as typeof fetch);
    await client.pause('dev&volume_percent=100#x');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin).toBe('https://api.spotify.com');
    expect(u.searchParams.get('device_id')).toBe('dev&volume_percent=100#x');
    expect(u.searchParams.has('volume_percent')).toBe(false);
    expect(url).not.toContain('TOK');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOK');
  });
});
