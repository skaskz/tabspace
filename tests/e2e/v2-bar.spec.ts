import { chromium, expect, test as base, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * V2.1 Tabspace Bar (Agent 3A).
 *
 * Chrome's optional-permission prompt can't be accepted from automation, so the
 * website-bar tests load a copy of dist/ whose manifest makes `scripting` + http(s)
 * site access *required* (granted at unpacked install). Everything after the grant
 * — registration on setting change, injection, frame sizing, bookmarking, removal —
 * runs exactly as shipped.
 */

const DIST = resolve(process.cwd(), 'dist');
const SHOTS = resolve(process.cwd(), 'docs/qa/screenshots');

type Fx = { ctx: { context: BrowserContext; worker: Worker; id: string }; site: { origin: string } };

function granted(dir: string): string {
  const ext = join(dir, 'ext');
  cpSync(DIST, ext, { recursive: true });
  const m = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
  m.permissions = [...m.permissions, 'scripting'];
  m.host_permissions = ['https://*/*', 'http://*/*'];
  m.optional_permissions = m.optional_permissions.filter((p: string) => p !== 'scripting');
  writeFileSync(join(ext, 'manifest.json'), JSON.stringify(m, null, 2));
  return ext;
}

const test = base.extend<Fx>({
  ctx: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabspace-bar-'));
    const ext = granted(dir);
    const context = await chromium.launchPersistentContext(join(dir, 'profile'), {
      channel: 'chromium',
      headless: !process.env.HEADED,
      viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    // Let the install migration stamp ts.settings first, or it can overwrite settings a test writes (slow CI).
    await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('ts.settings'))['ts.settings'] as { schemaVersion?: number } | undefined)?.schemaVersion), { timeout: 15_000 }).toBeTruthy();
    await use({ context, worker, id: new URL(worker.url()).host });
    await context.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  },
  site: async ({}, use) => {
    const server: Server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (req.url?.startsWith('/fixed'))
        return res.end('<!doctype html><title>Fixed header page</title><header style="position:fixed;top:0;left:0;right:0;height:56px;background:#eee">Site header</header><main style="padding-top:70px"><h1>Fixed</h1></main>');
      res.end('<!doctype html><title>Plain page</title><h1 style="margin:0">Plain</h1><p>Hello</p>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    await use({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    server.close();
  },
});

const seed = {
  'ts.bookmarks': [
    { id: 'g', url: 'https://github.com/', title: 'GitHub', tags: [], favorite: true, createdAt: 1, updatedAt: 1 },
    { id: 'm', url: 'https://developer.mozilla.org/', title: 'MDN', tags: [], favorite: false, folderId: 'dev', createdAt: 1, updatedAt: 1 },
  ],
  'ts.bookmarkFolders': [
    { id: 'dev', name: 'Dev tools', order: 0, createdAt: 1, updatedAt: 1 },
    { id: 'read', name: 'Read later', order: 1, createdAt: 1, updatedAt: 1 },
  ],
  'ts.workspaces': [{ id: 'w', name: 'Job hunt', icon: 'briefcase', order: 0, createdAt: 1, updatedAt: 1 }],
};

async function setStorage(w: Worker, items: Record<string, unknown>) {
  await w.evaluate(async (i) => chrome.storage.local.set(i), items);
}
async function getStorage<T>(w: Worker, key: string): Promise<T> {
  return w.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key) as Promise<T>;
}
async function enableWebsiteBar(w: Worker, on: boolean) {
  await w.evaluate(async (v) => {
    const cur = (await chrome.storage.local.get('ts.settings'))['ts.settings'] ?? {};
    await chrome.storage.local.set({ 'ts.settings': { ...cur, tabspaceBar: { onNewTab: true, showWorkspaces: true, showFolders: true, disabledSites: [], ...(cur.tabspaceBar ?? {}), onWebsites: v } } });
  }, on);
}
async function registered(w: Worker): Promise<string[]> {
  return w.evaluate(async () => (chrome.scripting ? (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id) : []));
}
async function barFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((f) => /^chrome-extension:\/\/.+\/bar\.html/.test(f.url())), { timeout: 10_000 }).toBe(true);
  const f = page.frames().find((fr) => /bar\.html/.test(fr.url()))!;
  await expect(f.getByRole('toolbar', { name: 'Tabspace Bar' })).toBeVisible();
  // The bar ignores clicks until Chrome's first visibility report (IntersectionObserver v2, ~100 ms) — anti-clickjacking.
  await f.page().waitForTimeout(300);
  return f;
}

test.describe('Tabspace Bar', () => {
  test('New Tab shows the bar with favourites, folders and workspaces', async ({ ctx }) => {
    await setStorage(ctx.worker, seed);
    const page = await ctx.context.newPage();
    await page.goto(`chrome-extension://${ctx.id}/newtab.html`);
    const bar = page.getByRole('toolbar', { name: 'Tabspace Bar' });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('link', { name: /GitHub/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Open Tabspace dashboard' })).toBeVisible();
    // No page to bookmark on the New Tab.
    await expect(bar.getByRole('button', { name: /Bookmark this page/ })).toHaveCount(0);
    await bar.getByRole('button', { name: 'Dev tools' }).click();
    await expect(page.getByRole('menuitem', { name: /MDN/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'Workspaces' }).click();
    await expect(page.getByRole('menuitem', { name: /Job hunt/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: join(SHOTS, 'v21-bar-newtab.png') });
    // Clicking a favourite navigates the current tab.
    await page.route('https://github.com/**', (r) => r.fulfill({ body: '<title>GitHub stub</title>ok', contentType: 'text/html' }));
    await bar.getByRole('link', { name: /GitHub/ }).click();
    await expect(page).toHaveURL('https://github.com/');
  });

  test('website bar: off by default; enabling injects an isolated iframe; bookmark to a folder fills the star; disabling removes it', async ({ ctx, site }) => {
    await setStorage(ctx.worker, seed);
    // Off by default: nothing registered, nothing injected.
    expect(await registered(ctx.worker)).toEqual([]);
    const page = await ctx.context.newPage();
    await page.goto(`${site.origin}/plain`);
    await page.waitForTimeout(800);
    expect(await page.locator('tabspace-bar').count()).toBe(0);

    await enableWebsiteBar(ctx.worker, true);
    await expect.poll(() => registered(ctx.worker)).toEqual(['tabspace-bar']);
    await page.goto(`${site.origin}/plain`);
    const frame = await barFrame(page);
    // Page pushed down by the bar height; the bar's contents are not reachable from the page (closed shadow root).
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).marginTop)).toBe('34px');
    expect(await page.evaluate(() => (document.querySelector('tabspace-bar') as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot)).toBeNull();
    expect(await page.evaluate(() => document.body.innerText.includes('GitHub'))).toBe(false);
    await page.screenshot({ path: join(SHOTS, 'v21-bar-website.png') });

    // Bookmark this page into "Read later".
    const star = frame.getByRole('button', { name: 'Bookmark this page' });
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect.poll(async () => (await page.locator('tabspace-bar').boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(0);
    await expect(frame.getByRole('dialog', { name: 'Bookmark this page' })).toBeVisible();
    await frame.getByRole('combobox', { name: 'Folder' }).selectOption({ label: 'Read later' });
    await page.waitForTimeout(400); // let the fade-in finish
    await page.screenshot({ path: join(SHOTS, 'v21-bar-bookmark.png') });
    await frame.getByRole('button', { name: 'Save' }).click();
    await expect
      .poll(async () => (await getStorage<{ url: string; folderId?: string; title: string }[]>(ctx.worker, 'ts.bookmarks')).find((b) => b.url.startsWith(site.origin)))
      .toMatchObject({ url: `${site.origin}/plain`, folderId: 'read', title: 'Plain page' });
    await expect(frame.getByRole('button', { name: 'Edit bookmark for this page' })).toHaveAttribute('aria-pressed', 'true');

    // Fixed-header site: bar still on top, page shifted, and the site's own fixed header moved below the bar (BUG-BAR1).
    await page.goto(`${site.origin}/fixed`);
    await barFrame(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).marginTop)).toBe('34px');
    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('header')!.getBoundingClientRect().top))).toBe(34);

    // Disable: unregistered, and the injected bar removes itself live.
    await enableWebsiteBar(ctx.worker, false);
    await expect.poll(() => page.locator('tabspace-bar').count()).toBe(0);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).marginTop)).toBe('0px');
    await expect.poll(() => registered(ctx.worker)).toEqual([]);
  });

  test('other pages cannot frame bar.html (use_dynamic_url), even with the extension id', async ({ ctx, site }) => {
    const page = await ctx.context.newPage();
    await page.goto(`${site.origin}/plain`);
    await page.evaluate((id) => {
      const f = document.createElement('iframe');
      f.src = `chrome-extension://${id}/bar.html`;
      document.body.appendChild(f);
    }, ctx.id);
    await page.waitForTimeout(1500);
    expect(page.frames().some((f) => /bar\.html/.test(f.url()))).toBe(false);
  });

  test('a site framing the leaked dynamic bar.html URL gets an empty frame (nonce handshake, V21-5)', async ({ ctx, site }) => {
    await setStorage(ctx.worker, seed);
    await enableWebsiteBar(ctx.worker, true); // even with our content script present in that tab
    await expect.poll(() => registered(ctx.worker)).toEqual(['tabspace-bar']);
    const dyn = await ctx.worker.evaluate(() => (chrome.runtime as unknown as { dynamicId?: string }).dynamicId ?? '');
    test.skip(!dyn, 'chrome.runtime.dynamicId not exposed by this Chromium');
    const page = await ctx.context.newPage();
    await page.goto(`${site.origin}/plain`);
    await barFrame(page); // the real bar works
    await page.evaluate((id) => {
      const f = document.createElement('iframe');
      f.id = 'evil';
      f.src = `chrome-extension://${id}/bar.html#n=00000000-0000-4000-8000-000000000000`;
      document.body.appendChild(f);
    }, dyn);
    // (Chromium reports the frame under the static extension id; find it by the forged nonce.)
    const FAKE = '#n=00000000-0000-4000-8000-000000000000';
    await expect.poll(() => page.frames().filter((f) => f.url().endsWith(FAKE)).length).toBe(1);
    const evil = page.frames().find((f) => f.url().endsWith(FAKE))!;
    await page.waitForTimeout(1200);
    expect(await evil.getByRole('toolbar').count()).toBe(0);
    expect(await evil.evaluate(() => document.body.innerText.trim())).toBe('');
  });

  test('clickjacking: page CSS cannot hide the host; an invisible decoy over the bar blocks its clicks (V21-2)', async ({ ctx, site }) => {
    await setStorage(ctx.worker, seed);
    await enableWebsiteBar(ctx.worker, true);
    await expect.poll(() => registered(ctx.worker)).toEqual(['tabspace-bar']);
    const page = await ctx.context.newPage();
    await page.goto(`${site.origin}/plain`);
    const frame = await barFrame(page);
    await page.addStyleTag({ content: 'tabspace-bar{opacity:0!important;visibility:hidden!important;filter:blur(9px)!important}' });
    await page.evaluate(() => document.querySelector('tabspace-bar')!.setAttribute('style', 'opacity:0 !important'));
    await expect.poll(() => page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('tabspace-bar')!);
      return `${cs.opacity}|${cs.visibility}|${cs.filter}`;
    })).toBe('1|visible|none');
    // A decoy that lets clicks through to the bar while hiding it (IntersectionObserver v2 sees the occlusion).
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'decoy';
      d.textContent = 'Win a prize!';
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;height:60px;background:#fff;z-index:2147483647;pointer-events:none';
      document.documentElement.appendChild(d);
    });
    await page.waitForTimeout(400);
    const supported = await frame.evaluate(() => 'isVisible' in IntersectionObserverEntry.prototype);
    test.skip(!supported, 'IntersectionObserver v2 not supported');
    const star = frame.getByRole('button', { name: 'Bookmark this page' });
    const box = (await star.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    expect(await frame.getByRole('dialog').count()).toBe(0);
    // Remove the decoy: the same click works.
    await page.evaluate(() => document.getElementById('decoy')!.remove());
    await page.waitForTimeout(400);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(frame.getByRole('dialog')).toBeVisible();
  });

  test('"Hide on this site" and the collapse tab', async ({ ctx, site }) => {
    await setStorage(ctx.worker, seed);
    await enableWebsiteBar(ctx.worker, true);
    await expect.poll(() => registered(ctx.worker)).toEqual(['tabspace-bar']);
    const page = await ctx.context.newPage();
    await page.goto(`${site.origin}/plain`);
    let frame = await barFrame(page);
    await frame.getByRole('button', { name: 'Tabspace Bar options' }).click();
    await frame.getByRole('menuitem', { name: 'Hide bar' }).click();
    await expect(frame.getByRole('button', { name: 'Show Tabspace Bar' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).marginTop)).toBe('0px');
    await frame.getByRole('button', { name: 'Show Tabspace Bar' }).click();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).marginTop)).toBe('34px');

    frame = await barFrame(page);
    await frame.getByRole('button', { name: 'Tabspace Bar options' }).click();
    await frame.getByRole('menuitem', { name: 'Hide on this site' }).click();
    await expect.poll(() => page.locator('tabspace-bar').count()).toBe(0);
    const s = await getStorage<{ tabspaceBar: { disabledSites: string[] } }>(ctx.worker, 'ts.settings');
    expect(s.tabspaceBar.disabledSites).toEqual(['127.0.0.1']);
    await page.reload();
    await page.waitForTimeout(800);
    expect(await page.locator('tabspace-bar').count()).toBe(0);
  });
});
