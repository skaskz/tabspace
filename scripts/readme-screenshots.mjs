// Captures the README screenshots from the real built extension (dist/) with example data loaded.
// Usage: npm run build && node scripts/readme-screenshots.mjs
import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const out = resolve(root, 'docs/screenshots');
mkdirSync(out, { recursive: true });

const dir = mkdtempSync(join(tmpdir(), 'ts-readme-'));
const ctx = await chromium.launchPersistentContext(dir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1536, height: 1024 },
  deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let [worker] = ctx.serviceWorkers();
if (!worker) worker = await ctx.waitForEvent('serviceworker');
const id = new URL(worker.url()).host;
const base = `chrome-extension://${id}`;

// A few real web tabs so the Tab Manager and Recent Tabs have content.
for (const url of ['https://example.com/', 'https://example.org/', 'https://www.iana.org/help/example-domains']) {
  const p = await ctx.newPage();
  await p.goto(url).catch(() => undefined);
}

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/dashboard.html#/dashboard`);
await page.getByRole('button', { name: 'Load example data' }).click();
await page.waitForTimeout(1200);

// Group the example tabs natively so the Tab Manager shows a coloured group.
await worker.evaluate(async () => {
  const tabs = await chrome.tabs.query({ url: ['https://example.com/*', 'https://example.org/*'] });
  if (tabs.length) {
    const groupId = await chrome.tabs.group({ tabIds: tabs.map((t) => t.id) });
    await chrome.tabGroups.update(groupId, { title: 'Research', color: 'blue' });
  }
});

const shots = [
  ['dashboard', '#/dashboard'],
  ['workspaces', '#/workspaces'],
  ['tabs', '#/tabs'],
  ['calendar', '#/calendar'],
  ['notes', '#/notes'],
  ['tasks', '#/tasks'],
  ['bookmarks', '#/bookmarks'],
  ['focus', '#/focus'],
  ['analytics', '#/analytics'],
  ['settings', '#/settings'],
  ['sidebar', '#/sidebar'],
];
for (const [name, hash] of shots) {
  await page.goto(`${base}/dashboard.html${hash}`);
  await page.reload();
  await page.waitForTimeout(1200);
  if (name === 'notes') {
    await page.getByRole('button').filter({ hasText: /Roblox|ideas/i }).first().click().catch(() => undefined);
    await page.waitForTimeout(400);
  }
  if (name === 'tasks') {
    await page.getByRole('button', { name: /^Open task/ }).first().click().catch(() => undefined);
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(name);
}

await page.setViewportSize({ width: 380, height: 860 });
await page.goto(`${base}/sidepanel.html`);
await page.waitForTimeout(900);
await page.screenshot({ path: join(out, 'sidepanel.png') });
console.log('sidepanel');

await page.setViewportSize({ width: 320, height: 480 });
await page.goto(`${base}/popup.html`);
await page.waitForTimeout(700);
await page.screenshot({ path: join(out, 'popup.png'), fullPage: true });
console.log('popup');

await page.setViewportSize({ width: 1536, height: 1024 });
await page.goto(`${base}/newtab.html`);
await page.waitForTimeout(900);
await page.screenshot({ path: join(out, 'newtab.png') });
console.log('newtab');

await ctx.close();
rmSync(dir, { recursive: true, force: true });
if (errors.length) {
  console.error('Page errors:', errors);
  process.exitCode = 1;
}
