import { test as base, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchWithExtension } from './fixtures';

/**
 * QA helpers (Agent 5). Every page opened in the context — extension pages and
 * web pages alike — has its console errors and uncaught page errors recorded,
 * as does the service worker, so tests can assert "no errors anywhere".
 */

export const SHOTS = resolve(process.cwd(), 'docs/qa/screenshots');
mkdirSync(SHOTS, { recursive: true });

export async function shot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
}

/** A tiny local web server: /p/<anything> returns an HTML page titled <anything>. */
export async function startServer(): Promise<{ server: Server; origin: string; url: (name: string) => string }> {
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').replace(/^\/p\//, '').replace(/[?#].*$/, '')) || 'root';
    if (req.url?.startsWith('/favicon')) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>${name.replace(/</g, '')}</title><h1>${name.replace(/</g, '')}</h1>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return { server, origin, url: (name: string) => `${origin}/p/${encodeURIComponent(name)}` };
}

/** The current service worker (MV3 workers can be restarted; never cache the handle for long). */
export async function sw(context: BrowserContext): Promise<Worker> {
  const [w] = context.serviceWorkers();
  if (w) return w;
  return context.waitForEvent('serviceworker', { timeout: 15_000 });
}

export async function storageGet<T = unknown>(context: BrowserContext, key: string): Promise<T> {
  const w = await sw(context);
  return w.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key) as Promise<T>;
}

/**
 * Seed raw storage from the service worker. This bypasses the store's Web Lock (real Tabspace pages never do), so
 * first wait for the first-install migration to stamp `schemaVersion` — otherwise its locked settings write can
 * race the seed. Tests that deliberately race the migration (BUG-MG1) pass `{ raw: true }`.
 */
export async function storageSet(context: BrowserContext, items: Record<string, unknown>, opts: { raw?: boolean } = {}): Promise<void> {
  const w = await sw(context);
  if (!opts.raw) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const v = await w.evaluate(async () => ((await chrome.storage.local.get('ts.settings'))['ts.settings'] as { schemaVersion?: number } | undefined)?.schemaVersion);
      if (v) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    // A caller that read settings before the stamp must not drop it.
    if (items['ts.settings'] && typeof items['ts.settings'] === 'object') {
      const cur = await w.evaluate(async () => (await chrome.storage.local.get('ts.settings'))['ts.settings'] as { schemaVersion?: number } | undefined);
      items = { ...items, 'ts.settings': { schemaVersion: cur?.schemaVersion, ...(items['ts.settings'] as object) } };
    }
  }
  await w.evaluate(async (i) => chrome.storage.local.set(i), items);
}

export function attachErrorCollector(context: BrowserContext, sink: string[]) {
  const watch = (page: Page) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') sink.push(`[console] ${page.url()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => sink.push(`[pageerror] ${page.url()}: ${err.message}`));
  };
  context.pages().forEach(watch);
  context.on('page', watch);
  const watchWorker = (w: Worker) => w.on('console', (msg) => msg.type() === 'error' && sink.push(`[worker] ${msg.text()}`));
  context.serviceWorkers().forEach(watchWorker);
  context.on('serviceworker', watchWorker);
}

/** Console noise that is not an app bug (network failures of external favicons in an offline-ish sandbox, etc.). */
export function realErrors(errors: string[]): string[] {
  return errors.filter((e) => !/net::ERR_|Failed to load resource/.test(e));
}

type QAFixtures = {
  dir: string;
  context: BrowserContext;
  extensionId: string;
  errors: string[];
  open: (path: string) => Promise<Page>;
  dash: (route?: string) => Promise<Page>;
  web: { origin: string; url: (name: string) => string };
};

export const test = base.extend<QAFixtures>({
   
  dir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabspace-qa-'));
    await use(dir);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  },
  errors: async ({}, use) => {
    await use([]);
  },
  context: async ({ dir, errors }, use) => {
    const { context } = await launchWithExtension(dir);
    attachErrorCollector(context, errors);
    await use(context);
    await context.close().catch(() => undefined);
  },
  extensionId: async ({ context }, use) => {
    const w = await sw(context);
    await use(new URL(w.url()).host);
  },
  open: async ({ context, extensionId }, use) => {
    await use(async (path: string) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${path}`);
      return page;
    });
  },
  dash: async ({ open }, use) => {
    await use(async (route = 'dashboard') => {
      const page = await open(`dashboard.html#/${route}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      return page;
    });
  },
   
  web: async ({}, use) => {
    const s = await startServer();
    await use({ origin: s.origin, url: s.url });
    s.server.closeAllConnections();
    await new Promise((r) => s.server.close(r));
  },
});

export { expect };

/** Relaunch a closed persistent profile (full browser restart). */
export async function relaunch(dir: string, errors: string[]) {
  const r = await launchWithExtension(dir);
  attachErrorCollector(r.context, errors);
  return r;
}

/** Click the confirm button of the useConfirm() dialog. */
export async function confirmDialog(page: Page, label: string | RegExp) {
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: label }).click();
  await expect(dlg).toBeHidden();
}

export async function windowsSummary(context: BrowserContext) {
  const w = await sw(context);
  return w.evaluate(async () => {
    const wins = await chrome.windows.getAll({ populate: true });
    const groups = await chrome.tabGroups.query({});
    return wins.map((win) => ({
      id: win.id!,
      tabs: (win.tabs ?? []).map((t) => ({ id: t.id!, url: t.url || t.pendingUrl || '', groupId: t.groupId, pinned: t.pinned })),
      groups: groups.filter((g) => g.windowId === win.id).map((g) => ({ id: g.id, title: g.title, color: g.color, collapsed: g.collapsed })),
    }));
  });
}
