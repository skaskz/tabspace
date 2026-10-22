import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Loads the built, unpacked extension (dist/) into Playwright's Chromium.
 * Branded Google Chrome no longer honours --load-extension, so we use the
 * bundled Chromium build, which runs the same extension platform.
 */

export const DIST = resolve(process.cwd(), 'dist');

export async function launchWithExtension(userDataDir?: string): Promise<{ context: BrowserContext; extensionId: string; worker: Worker; dir: string }> {
  const dir = userDataDir ?? mkdtempSync(join(tmpdir(), 'tabspace-e2e-'));
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1536, height: 1000 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  return { context, extensionId, worker, dir };
}

type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
  extPage: (path: string) => Promise<Page>;
  consoleErrors: string[];
};

export const test = base.extend<Fixtures>({
   
  context: async ({}, use) => {
    const { context, dir } = await launchWithExtension();
    await use(context);
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  },
  worker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
  consoleErrors: async ({}, use) => {
    await use([]);
  },
  extPage: async ({ context, extensionId, consoleErrors }, use) => {
    await use(async (path: string) => {
      const page = await context.newPage();
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(`${path}: ${msg.text()}`);
      });
      page.on('pageerror', (err) => consoleErrors.push(`${path}: ${err.message}`));
      await page.goto(`chrome-extension://${extensionId}/${path}`);
      return page;
    });
  },
});

export const expect = test.expect;
