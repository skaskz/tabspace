// Screenshots of every surface for docs/reviews/UX_REVIEW.md.
// node tests/visual/ux-shots.mjs   (TS_DIST env = unpacked build dir; default ./dist)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, loadExampleData, patchSettings, PAGES, SHOTS, collectErrors } from './harness.mjs';

mkdirSync(SHOTS, { recursive: true });
const { ctx, worker, url } = await launch();
await patchSettings(worker, { userName: 'Alex' });
await loadExampleData(ctx, url);

// Open a few real tabs so the Tabs page / recent tabs have content.
await worker.evaluate(async () => {
  for (const u of ['https://example.com/', 'https://example.org/', 'https://www.iana.org/domains/reserved']) await chrome.tabs.create({ url: u, active: false });
});

const report = {};
async function shot(file, name, size, { full = false, wait = 1200, before } = {}) {
  const page = await ctx.newPage();
  const errs = collectErrors(page);
  await page.setViewportSize(size);
  await page.goto(url(file));
  await page.waitForTimeout(wait);
  if (before) await before(page);
  await page.screenshot({ path: join(SHOTS, name), fullPage: full });
  // Overflow detection: elements wider than viewport / horizontally scrolling body.
  const layout = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const over = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') over.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
    }
    // Truncated text (ellipsis actually clipping)
    const trunc = [];
    for (const el of document.querySelectorAll('.truncate, [class*="line-clamp"]')) {
      if (el.scrollWidth > el.clientWidth + 1) trunc.push((el.textContent || '').trim().slice(0, 50));
    }
    return { scrollW: document.documentElement.scrollWidth, vw, overflow: over.slice(0, 12), truncated: trunc.slice(0, 15), h1: [...document.querySelectorAll('h1')].map((h) => h.textContent) };
  });
  report[name] = { errs, ...layout };
  console.log(name, errs.length ? 'ERR ' + errs.join(' | ').slice(0, 300) : 'ok', layout.scrollW > layout.vw ? `HSCROLL ${layout.scrollW}>${layout.vw}` : '');
  await page.close();
}

const L = { width: 1536, height: 1024 };
const M = { width: 1280, height: 800 };
for (const p of PAGES) {
  await shot(`dashboard.html#/${p}`, `${p}-1536.png`, L);
  await shot(`dashboard.html#/${p}`, `${p}-1280.png`, M);
}
await shot('dashboard.html#/dashboard', 'dashboard-1536-full.png', L, { full: true });
await shot('dashboard.html#/tasks', 'tasks-1536-full.png', L, { full: true });
await shot('dashboard.html#/settings', 'settings-1536-full.png', L, { full: true });
await shot('newtab.html', 'newtab-1536.png', L);
await shot('newtab.html', 'newtab-1280.png', M);
await shot('sidepanel.html', 'sidepanel-360.png', { width: 360, height: 900 });
await shot('sidepanel.html', 'sidepanel-320.png', { width: 320, height: 700 });
await shot('popup.html', 'popup-320.png', { width: 320, height: 520 });

// Search palette + a modal
await shot('dashboard.html#/dashboard', 'search-palette-1536.png', L, { before: async (pg) => { await pg.keyboard.press('Control+k'); await pg.keyboard.type('git'); await pg.waitForTimeout(500); } });
await shot('dashboard.html#/notes', 'notes-open-1536.png', L, { before: async (pg) => { const n = pg.getByText('Roblox game ideas').first(); if (await n.count()) await n.click(); await pg.waitForTimeout(500); } });
await shot('dashboard.html#/tasks', 'tasks-open-1536.png', L, { before: async (pg) => { const n = pg.getByText('Push Tabspace to GitHub').first(); if (await n.count()) await n.click(); await pg.waitForTimeout(500); } });

// Focus session active: compact pill in top bar
await worker.evaluate(async () => {
  const now = Date.now();
  await chrome.storage.local.set({ 'ts.focus': { status: 'running', kind: 'focus', durationMs: 25 * 60000, startedAt: now, endAt: now + 25 * 60000 } });
});
await shot('dashboard.html#/tasks', 'focus-pill-active-1536.png', L);
await shot('dashboard.html#/focus', 'focus-running-1536.png', L);
await shot('sidepanel.html', 'sidepanel-360-focus-running.png', { width: 360, height: 900 });
await shot('newtab.html', 'newtab-focus-running-1536.png', L);
await worker.evaluate(async () => chrome.storage.local.set({ 'ts.focus': { status: 'idle', kind: 'focus', durationMs: 25 * 60000 } }));

// Light theme once
await patchSettings(worker, { theme: 'light' });
await shot('dashboard.html#/dashboard', 'dashboard-light-1536.png', L);
await shot('dashboard.html#/tasks', 'tasks-light-1536.png', L);
await patchSettings(worker, { theme: 'dark' });

writeFileSync(join(SHOTS, '_layout-report.json'), JSON.stringify(report, null, 2));
await ctx.close();
