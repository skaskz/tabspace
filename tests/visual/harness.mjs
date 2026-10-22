// Shared helpers for the UX review scripts (Agent 7). Loads an unpacked build into Playwright Chromium.
// Usage: import { launch } from './harness.mjs'; const { ctx, worker, id, url } = await launch(distDir);
import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const SHOTS = resolve(import.meta.dirname, '../../docs/reviews/screenshots');
export const DIST = resolve(process.env.TS_DIST || resolve(import.meta.dirname, '../../dist'));

export async function launch(dist = DIST, opts = {}) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ts-ux-')), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1536, height: 1024 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    ...opts,
  });
  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const url = (p) => `chrome-extension://${id}/${p}`;
  return { ctx, worker, id, url };
}

/** Merge into ts.settings via the worker. */
export async function patchSettings(worker, patch) {
  await worker.evaluate(async (patch) => {
    const cur = (await chrome.storage.local.get('ts.settings'))['ts.settings'] || {};
    const merged = { ...cur, ...patch };
    await chrome.storage.local.set({ 'ts.settings': merged });
  }, patch);
}

export async function loadExampleData(ctx, url) {
  const page = await ctx.newPage();
  await page.goto(url('dashboard.html#/dashboard'));
  const btn = page.getByRole('button', { name: 'Load example data' });
  await btn.waitFor({ timeout: 8000 });
  await btn.click();
  await page.waitForTimeout(1500);
  await page.close();
}

export const PAGES = ['dashboard', 'workspaces', 'tabs', 'calendar', 'notes', 'tasks', 'bookmarks', 'focus', 'analytics', 'settings', 'sidebar'];

export function collectErrors(page) {
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text()));
  return errs;
}
