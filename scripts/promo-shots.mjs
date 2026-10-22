// Captures 2x screenshots of the built extension (dist/) for the promo video.
// Fresh temporary profile + built-in example data only — no personal information.
// Usage: node scripts/promo-shots.mjs <outDir>
import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const out = resolve(process.argv[2] ?? join(root, 'promo', 'public', 'shots'));
mkdirSync(out, { recursive: true });

const dir = mkdtempSync(join(tmpdir(), 'ts-promo-'));
const ctx = await chromium.launchPersistentContext(dir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1600, height: 960 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let [worker] = ctx.serviceWorkers();
if (!worker) worker = await ctx.waitForEvent('serviceworker');
const base = `chrome-extension://${new URL(worker.url()).host}`;

// Neutral public pages for "recent tabs".
for (const url of ['https://example.com/', 'https://example.org/']) {
  const p = await ctx.newPage();
  await p.goto(url).catch(() => undefined);
}

const page = await ctx.newPage();
await page.goto(`${base}/dashboard.html#/settings?section=data`);
await page.getByRole('button', { name: /Load example data/i }).click();
await page.waitForTimeout(1200);
// Mark a couple of favourites so the Tabspace Bar / quick links have content.
await worker.evaluate(async () => {
  const { 'ts.bookmarks': bms = [] } = await chrome.storage.local.get('ts.bookmarks');
  const fav = ['GitHub', 'Claude', 'ChatGPT', 'Notion', 'YouTube Studio'];
  await chrome.storage.local.set({ 'ts.bookmarks': bms.map((b) => (fav.includes(b.title) ? { ...b, favorite: true } : b)) });
});

async function shot(name, hash, prep) {
  await page.goto(`${base}/dashboard.html${hash}`);
  await page.reload();
  await page.waitForTimeout(1300);
  if (prep) await prep();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(name);
}

await shot('dashboard', '#/dashboard');
await shot('workspaces', '#/workspaces');
await shot('tasks', '#/tasks', async () => {
  await page.getByRole('button', { name: /^Open task/ }).first().click().catch(() => undefined);
  await page.waitForTimeout(500);
});
await shot('notes', '#/notes', async () => {
  await page.getByRole('button').filter({ hasText: /Tabspace launch checklist/ }).first().click().catch(() => undefined);
  await page.waitForTimeout(500);
});
await shot('bookmarks', '#/bookmarks');
await shot('calendar', '#/calendar');
await shot('analytics', '#/analytics');
await shot('settings', '#/settings');

// Focus: start a session so the ring and countdown are live.
await page.goto(`${base}/dashboard.html#/focus`);
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /^Start/ }).first().click().catch(() => undefined);
await page.waitForTimeout(3200);
await page.mouse.move(5, 5);
await page.screenshot({ path: join(out, 'focus.png') });
console.log('focus');

// New Tab (with the Tabspace Bar) and its Customize mode.
await page.goto(`${base}/newtab.html`);
await page.waitForTimeout(1500);
await page.mouse.move(5, 5);
await page.screenshot({ path: join(out, 'newtab.png') });
console.log('newtab');
await page.getByRole('button', { name: /^Customize/ }).first().click().catch(() => undefined);
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, 'newtab-customize.png') });
console.log('newtab-customize');

// Popup (focus running) and side panel.
await page.setViewportSize({ width: 320, height: 520 });
await page.goto(`${base}/popup.html`);
await page.waitForTimeout(900);
await page.screenshot({ path: join(out, 'popup.png'), fullPage: true });
console.log('popup');
await page.setViewportSize({ width: 380, height: 880 });
await page.goto(`${base}/sidepanel.html`);
await page.waitForTimeout(900);
await page.screenshot({ path: join(out, 'sidepanel.png') });
console.log('sidepanel');

await ctx.close();
rmSync(dir, { recursive: true, force: true });
