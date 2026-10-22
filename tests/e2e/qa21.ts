/* eslint-disable @typescript-eslint/no-explicit-any */
import { chromium, expect, test as base, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Agent 5 — V2.1 QA harness. Loads the build from $TABSPACE_DIST (default dist/),
 * optionally as a "granted" copy whose manifest makes `scripting` + http(s) site
 * access required (Chrome's optional-permission prompt can't be accepted from
 * automation). Collects console/page errors from extension pages AND host pages.
 */

export const DIST = resolve(process.cwd(), process.env.TABSPACE_DIST ?? 'dist');
export const SHOTS = resolve(process.cwd(), 'docs/qa/screenshots');
mkdirSync(SHOTS, { recursive: true });

export async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
}

function grantedCopy(dir: string): string {
  const ext = join(dir, 'ext');
  cpSync(DIST, ext, { recursive: true });
  const m = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
  m.permissions = [...m.permissions, 'scripting'];
  m.host_permissions = ['https://*/*', 'http://*/*'];
  m.optional_permissions = (m.optional_permissions ?? []).filter((p: string) => p !== 'scripting');
  writeFileSync(join(ext, 'manifest.json'), JSON.stringify(m, null, 2));
  return ext;
}

export interface Ext {
  context: BrowserContext;
  id: string;
  dir: string;
  ext: string;
  worker: () => Promise<Worker>;
  open: (path: string) => Promise<Page>;
  get: <T>(key: string) => Promise<T>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

export async function launch(opts: { granted?: boolean; dir?: string; viewport?: { width: number; height: number }; args?: string[] } = {}): Promise<Ext> {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'tabspace-qa21-'));
  const ext = opts.granted ? (opts.dir ? join(dir, 'ext') : grantedCopy(dir)) : DIST;
  const context = await chromium.launchPersistentContext(join(dir, 'profile'), {
    channel: 'chromium',
    headless: !process.env.HEADED,
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...(opts.args ?? [])],
  });
  const first = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(first.url()).host;
  const worker = async () => context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker');
  const e: Ext = {
    context,
    id,
    dir,
    ext,
    worker,
    open: async (path) => {
      const p = await context.newPage();
      await p.goto(`chrome-extension://${id}/${path}`);
      return p;
    },
    get: async <T,>(key: string) => (await worker()).evaluate(async (k) => (await chrome.storage.local.get(k))[k], key) as Promise<T>,
    set: async (items) => (await worker()).evaluate(async (i) => chrome.storage.local.set(i), items),
  };
  // Let the install-time migration finish before tests seed storage (BUG-MG1).
  await new Promise((r) => setTimeout(r, 900));
  return e;
}

export function collectErrors(context: BrowserContext, sink: string[]) {
  const watch = (page: Page) => {
    page.on('console', (m) => m.type() === 'error' && sink.push(`[console] ${page.url()}: ${m.text()}`));
    page.on('pageerror', (err) => sink.push(`[pageerror] ${page.url()}: ${err.message}`));
  };
  context.pages().forEach(watch);
  context.on('page', watch);
}
export const realErrors = (e: string[]) => e.filter((x) => !/net::ERR_|Failed to load resource/.test(x));

/** Test web server with a few adversarial pages. */
export async function startSite() {
  const pages: Record<string, { html: string; headers?: Record<string, string> }> = {
    '/plain': { html: '<!doctype html><title>Plain page</title><h1 style="margin:0">Plain</h1><p>Hello</p>' },
    '/plain2': { html: '<!doctype html><title>Second page</title><h1>Second</h1>' },
    '/fixed': { html: '<!doctype html><title>Fixed header page</title><body style="margin:0"><header id="hdr" style="position:fixed;top:0;left:0;right:0;height:56px;background:#eee"><button id="hdrbtn" style="margin-top:6px">Site menu</button></header><main style="padding-top:70px"><h1>Fixed</h1></main></body>' },
    '/csp': { html: '<!doctype html><title>Strict CSP</title><h1>CSP</h1>', headers: { 'content-security-policy': "default-src 'none'; frame-src 'none'; child-src 'none'; style-src 'none'; script-src 'none'; img-src 'none'" } },
    '/remover': { html: '<!doctype html><title>Remover</title><h1>Remover</h1><script>new MutationObserver(()=>{document.querySelectorAll("tabspace-bar").forEach(e=>e.remove())}).observe(document.documentElement,{childList:true})</script>' },
    '/spa': { html: '<!doctype html><title>SPA home</title><h1 id="h">Home</h1><a id="go" href="/spa/next" onclick="event.preventDefault();history.pushState({},\'\',\'/spa/next\');document.title=\'SPA next\';document.getElementById(\'h\').textContent=\'Next\'">Next</a>' },
    '/margin': { html: '<!doctype html><title>Own margin</title><style>html{margin-top:20px}</style><h1>Own margin</h1>' },
    '/fullscreen': { html: '<!doctype html><title>Fullscreen</title><button id="fs" onclick="document.documentElement.requestFullscreen()">FS</button><button id="exit" onclick="document.exitFullscreen()">Exit</button>' },
    '/errors': { html: '<!doctype html><title>Long page</title>' + '<p>row</p>'.repeat(300) },
    '/evil': { html: '<!doctype html><title>&lt;img src=x onerror=alert(1)&gt;</title><h1>Evil title</h1>' },
  };
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const key = Object.keys(pages).find((k) => path === k || path.startsWith(k + '/')) ?? '/plain';
    const p = pages[key];
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...(p.headers ?? {}) });
    res.end(p.html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, origin, close: () => (server.closeAllConnections(), new Promise((r) => server.close(r))) };
}

export const test = base.extend<{ x: Ext; gx: Ext; site: { origin: string }; errors: string[] }>({
  errors: async ({}, use) => use([]),
  x: async ({ errors }, use) => {
    const e = await launch();
    collectErrors(e.context, errors);
    await use(e);
    await e.context.close().catch(() => undefined);
    rmSync(e.dir, { recursive: true, force: true, maxRetries: 5 });
  },
  gx: async ({ errors }, use) => {
    const e = await launch({ granted: true });
    collectErrors(e.context, errors);
    await use(e);
    await e.context.close().catch(() => undefined);
    rmSync(e.dir, { recursive: true, force: true, maxRetries: 5 });
  },
  site: async ({}, use) => {
    const s = await startSite();
    await use({ origin: s.origin });
    await s.close();
  },
});
export { expect };

export async function patchSettings(e: Ext, fn: (s: Record<string, any>) => Record<string, any>) {
  const cur = ((await e.get<Record<string, any>>('ts.settings')) ?? {}) as Record<string, any>;
  await e.set({ 'ts.settings': fn(cur) });
}

export async function enableWebsiteBar(e: Ext, on: boolean) {
  await patchSettings(e, (cur) => ({ ...cur, tabspaceBar: { onNewTab: true, showWorkspaces: true, showFolders: true, disabledSites: [], ...(cur.tabspaceBar ?? {}), onWebsites: on } }));
}

export async function registered(e: Ext): Promise<string[]> {
  return (await e.worker()).evaluate(async () => (chrome.scripting ? (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id) : []));
}

export async function barFrame(page: Page, timeout = 10_000): Promise<Frame> {
  await expect.poll(() => page.frames().some((f) => /^chrome-extension:\/\/.+\/bar\.html/.test(f.url())), { timeout }).toBe(true);
  const f = page.frames().find((fr) => /bar\.html/.test(fr.url()))!;
  await expect(f.getByRole('toolbar', { name: 'Tabspace Bar' })).toBeVisible();
  // The bar ignores clicks until Chrome's first visibility report (IntersectionObserver v2, ~100 ms) — anti-clickjacking.
  await f.page().waitForTimeout(300);
  return f;
}

export const marginTop = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).marginTop);
