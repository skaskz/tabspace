import { chromium, expect, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * V2.2 "Tabspace look for search results" (Agent 3A).
 *
 * Real engines can't be hit from CI, so each engine's result URL is intercepted with page.route() and served a
 * local fixture that mimics that engine's top-level structure (ids / data-testids the stylesheet targets). The
 * registered content script matches the real URL patterns. As with the bar spec, a dist/ copy makes `scripting`
 * + site access required (Chrome's permission prompt can't be accepted from automation).
 */

const DIST = resolve(process.cwd(), 'dist');
const SHOTS = resolve(process.cwd(), 'docs/qa/screenshots');
type Ctx = { context: BrowserContext; worker: Worker; id: string };

const test = base.extend<{ ctx: Ctx }>({
  ctx: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabspace-search-'));
    const ext = join(dir, 'ext');
    cpSync(DIST, ext, { recursive: true });
    const m = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
    m.permissions = [...m.permissions, 'scripting'];
    m.host_permissions = ['https://*/*', 'http://*/*'];
    m.optional_permissions = m.optional_permissions.filter((p: string) => p !== 'scripting');
    writeFileSync(join(ext, 'manifest.json'), JSON.stringify(m, null, 2));
    const context = await chromium.launchPersistentContext(join(dir, 'profile'), {
      channel: 'chromium',
      headless: !process.env.HEADED,
      viewport: { width: 1280, height: 860 },
      colorScheme: 'dark',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use({ context, worker, id: new URL(worker.url()).host });
    await context.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  },
});

const result = (i: number) => `<div class="r"><a href="https://example.com/${i}" style="color:#8ab4f8;font-size:20px">Result ${i} — Push Tabspace to GitHub</a><div style="color:#bdc1c6">A short snippet of text for result ${i}, long enough to wrap onto another line in the column.</div></div>`;
const results = Array.from({ length: 6 }, (_, i) => result(i + 1)).join('<br>');
const page = (title: string, bodyStyle: string, inner: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;font-family:arial,sans-serif;${bodyStyle}}</style></head><body>${inner}</body></html>`;

const FIXTURES: Record<string, string> = {
  // Google dark mode: flat #202124 everywhere.
  google: page(
    'q - Google Search',
    'background:#202124;color:#e8eaed',
    `<div id="searchform" style="background:#202124;height:64px;padding:12px">search box</div><div id="main" style="background:#202124"><div id="cnt" style="background:#202124"><div id="rcnt" style="display:flex;gap:80px;padding:20px 0 0 150px"><div id="center_col" style="width:652px;background:#202124"><div id="rso">${results}</div></div><div id="rhs" style="width:370px;background:#202124;color:#e8eaed">Knowledge panel</div></div></div></div>`,
  ),
  googleLight: page('q - Google Search', 'background:#fff;color:#202124', `<div id="main"><div id="center_col" style="width:652px"><div id="rso">${results}</div></div></div>`),
  duckduckgo: page(
    'q at DuckDuckGo',
    'background:#1c1c1c;color:#eeeeee',
    `<div id="header_wrapper" style="height:70px;background:#1c1c1c">header</div><div id="react-layout" style="background:#1c1c1c"><div style="display:flex;gap:40px;padding:20px 0 0 150px"><section data-testid="mainline" style="width:620px">${results}</section><section data-testid="sidebar" style="width:300px">About</section></div></div>`,
  ),
  bing: page(
    'q - Search',
    'background:#2b2b2b;color:#e6e6e6',
    `<header id="b_header" style="height:90px;background:#2b2b2b">header</header><div id="b_content" style="background:#2b2b2b;display:flex;gap:40px;padding:20px 0 0 150px"><ol id="b_results" style="width:600px;margin:0;list-style:none">${results}</ol><aside id="b_context" style="width:400px">Context</aside></div>`,
  ),
};

async function routeEngines(p: Page, light = false) {
  await p.route('https://www.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: light ? FIXTURES.googleLight : FIXTURES.google }));
  await p.route('https://duckduckgo.com/**', (r) => r.fulfill({ contentType: 'text/html', body: FIXTURES.duckduckgo }));
  await p.route('https://www.bing.com/**', (r) => r.fulfill({ contentType: 'text/html', body: FIXTURES.bing }));
  await p.route(/^https:\/\/example\.com\//, (r) => r.fulfill({ contentType: 'text/html', body: 'ok' }));
}

async function setSettings(w: Worker, patch: Record<string, unknown>) {
  await w.evaluate(async (pt) => {
    const cur = (await chrome.storage.local.get('ts.settings'))['ts.settings'] ?? {};
    await chrome.storage.local.set({ 'ts.settings': { ...cur, ...pt } });
  }, patch);
}
const registered = (w: Worker) => w.evaluate(async () => (chrome.scripting ? (await chrome.scripting.getRegisteredContentScripts()).map((s) => `${s.id}:${(s.matches ?? []).join(',')}`) : []));
const themed = (p: Page) => p.evaluate(() => document.documentElement.getAttribute('data-tabspace-search'));
const bg = (p: Page, sel: string) => p.evaluate((s) => getComputedStyle(document.querySelector(s)!).backgroundColor, sel);

test.describe('Search results look', () => {
  test('off by default: nothing registered, pages untouched', async ({ ctx }) => {
    expect(await registered(ctx.worker)).toEqual([]);
    const p = await ctx.context.newPage();
    await routeEngines(p);
    await p.goto('https://www.google.com/search?q=tabspace');
    await p.waitForTimeout(600);
    expect(await themed(p)).toBeNull();
    expect(await p.locator('tabspace-stars').count()).toBe(0);
  });

  for (const [engine, url, column] of [
    ['google', 'https://www.google.com/search?q=tabspace', '#center_col'],
    ['duckduckgo', 'https://duckduckgo.com/?q=tabspace&ia=web', '[data-testid="mainline"]'],
    ['bing', 'https://www.bing.com/search?q=tabspace', '#b_results'],
  ] as const) {
    test(`${engine}: starfield behind the page, results on opaque Tabspace cards, links keep their colour`, async ({ ctx }) => {
      await setSettings(ctx.worker, { searchTheme: { enabled: true, engines: ['google', 'duckduckgo', 'bing'] } });
      await expect.poll(() => registered(ctx.worker)).toEqual([expect.stringMatching(/^tabspace-search-theme:/)]);
      const p = await ctx.context.newPage();
      await routeEngines(p);
      await p.goto(url);
      await expect.poll(() => themed(p)).toBe(engine);
      await expect(p.locator('tabspace-stars')).toHaveCount(1);
      expect(await bg(p, 'html')).toBe('rgb(5, 5, 5)');
      expect(await bg(p, 'body')).toBe('rgba(0, 0, 0, 0)');
      // Readability: the results column is ~92% opaque near-black; text and links keep the engine's colours.
      expect(await bg(p, column)).toBe('rgba(14, 14, 15, 0.92)');
      expect(await p.evaluate((s) => getComputedStyle(document.querySelector(`${s} a`)!).color, column)).toBe('rgb(138, 180, 248)');
      // The star layer is non-interactive and behind content: a result link still receives clicks.
      const at = await p.evaluate((s) => {
        const a = document.querySelector(`${s} a`)!.getBoundingClientRect();
        return document.elementFromPoint(a.left + 5, a.top + a.height / 2)?.tagName;
      }, column);
      expect(at).toBe('A');
      await p.screenshot({ path: join(SHOTS, `v22-search-${engine}.png`) });
    });
  }

  test('light-mode pages are left alone; DuckDuckGo home (no ?q=) is not themed', async ({ ctx }) => {
    await setSettings(ctx.worker, { searchTheme: { enabled: true, engines: ['google', 'duckduckgo'] } });
    await expect.poll(() => registered(ctx.worker)).toHaveLength(1);
    const p = await ctx.context.newPage();
    await routeEngines(p, true);
    await p.goto('https://www.google.com/search?q=tabspace');
    await p.waitForLoadState('load');
    await expect.poll(() => themed(p)).toBeNull();
    expect(await p.locator('tabspace-stars').count()).toBe(0);
    await routeEngines(p);
    await p.goto('https://duckduckgo.com/');
    await p.waitForTimeout(600);
    expect(await themed(p)).toBeNull();
  });

  test('turning it off removes the look live from open tabs and unregisters; engines not selected are never touched', async ({ ctx }) => {
    await setSettings(ctx.worker, { searchTheme: { enabled: true, engines: ['google'] } });
    await expect.poll(() => registered(ctx.worker)).toEqual(['tabspace-search-theme:https://www.google.com/search*']);
    const p = await ctx.context.newPage();
    await routeEngines(p);
    await p.goto('https://www.google.com/search?q=tabspace');
    await expect.poll(() => themed(p)).toBe('google');
    const bingTab = await ctx.context.newPage();
    await routeEngines(bingTab);
    await bingTab.goto('https://www.bing.com/search?q=tabspace');
    await bingTab.waitForTimeout(600);
    expect(await themed(bingTab)).toBeNull();

    await setSettings(ctx.worker, { searchTheme: { enabled: false, engines: ['google'] } });
    await expect.poll(() => themed(p)).toBeNull();
    await expect(p.locator('tabspace-stars')).toHaveCount(0);
    expect(await bg(p, 'html')).toBe('rgba(0, 0, 0, 0)');
    expect(await bg(p, '#center_col')).toBe('rgb(32, 33, 36)');
    await expect.poll(() => registered(ctx.worker)).toEqual([]);
  });

  test('the Tabspace Bar still works on a themed results page', async ({ ctx }) => {
    await setSettings(ctx.worker, {
      searchTheme: { enabled: true, engines: ['google'] },
      tabspaceBar: { onNewTab: true, onWebsites: true, showWorkspaces: true, showFolders: true, disabledSites: [] },
    });
    await expect.poll(async () => (await registered(ctx.worker)).length).toBe(2);
    const p = await ctx.context.newPage();
    await routeEngines(p);
    await p.goto('https://www.google.com/search?q=tabspace');
    await expect.poll(() => themed(p)).toBe('google');
    await expect.poll(() => p.frames().some((f) => /bar\.html/.test(f.url()))).toBe(true);
    const frame = p.frames().find((f) => /bar\.html/.test(f.url()))!;
    await expect(frame.getByRole('toolbar', { name: 'Tabspace Bar' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Bookmark this page' })).toBeVisible();
    await p.screenshot({ path: join(SHOTS, 'v22-search-google-with-bar.png') });
  });
});
