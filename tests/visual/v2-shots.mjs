// V2 review screenshots + layout checks. TS_DIST=<build> node tests/visual/v2-shots.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, loadExampleData, patchSettings, PAGES, collectErrors } from './harness.mjs';

const OUT = resolve(import.meta.dirname, '../../docs/reviews/screenshots-v2');
mkdirSync(OUT, { recursive: true });
const { ctx, worker, url } = await launch();
await patchSettings(worker, { userName: 'Alex' });
await loadExampleData(ctx, url);
await worker.evaluate(async () => {
  for (const u of ['https://example.com/', 'https://example.org/', 'https://www.iana.org/domains/reserved']) await chrome.tabs.create({ url: u, active: false });
});
const report = {};

async function shot(file, name, size, { full = false, wait = 1300, before } = {}) {
  const page = await ctx.newPage();
  const errs = collectErrors(page);
  await page.setViewportSize(size);
  await page.goto(url(file));
  await page.waitForTimeout(wait);
  if (before) await before(page);
  await page.screenshot({ path: join(OUT, name), fullPage: full });
  const info = await page.evaluate(() => {
    const se = document.scrollingElement;
    const vw = document.documentElement.clientWidth;
    const trunc = [];
    for (const el of document.querySelectorAll('.truncate, [class*="line-clamp"]')) if (el.scrollWidth > el.clientWidth + 1 && el.getBoundingClientRect().width) trunc.push((el.textContent || '').trim().slice(0, 40));
    // inner scroll containers that overflow (hidden scroll)
    const innerScroll = [];
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 40) innerScroll.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} ${el.clientHeight}/${el.scrollHeight}`);
    }
    return { scrollH: se.scrollHeight, vh: window.innerHeight, vScroll: se.scrollHeight > window.innerHeight + 1, hScroll: se.scrollWidth > vw + 1, trunc: trunc.slice(0, 12), innerScroll: innerScroll.slice(0, 8), cards: document.querySelectorAll('.ts-card').length, h1: [...document.querySelectorAll('h1')].map((h) => h.textContent) };
  });
  report[name] = { errs, ...info };
  console.log(name, errs.length ? 'ERR ' + errs.join(' | ').slice(0, 250) : 'ok', info.vScroll ? `VSCROLL ${info.scrollH}>${info.vh}` : '', info.hScroll ? 'HSCROLL' : '');
  await page.close();
}

const L = { width: 1536, height: 1024 };
const M = { width: 1280, height: 800 };
for (const p of PAGES) {
  await shot(`dashboard.html#/${p}`, `${p}-1536.png`, L);
  await shot(`dashboard.html#/${p}`, `${p}-1280.png`, M);
}
// New Tab at many sizes (must not scroll at >= 1366x768)
for (const [w, h] of [[1366, 768], [1280, 800], [1440, 900], [1536, 1024], [1920, 1080], [1280, 720], [1024, 768]]) await shot('newtab.html', `newtab-${w}x${h}.png`, { width: w, height: h });

// Workspace detail + saved tab editor + picker
const wsId = await worker.evaluate(async () => (await chrome.storage.local.get('ts.workspaces'))['ts.workspaces'][0].id);
await shot(`dashboard.html#/workspaces?id=${wsId}`, 'workspace-detail-1536.png', L);
await shot(`dashboard.html#/workspaces?id=${wsId}`, 'workspace-detail-1280.png', M);
await shot(`dashboard.html#/workspaces?id=${wsId}`, 'workspace-save-picker-1536.png', L, { before: async (p) => { await p.getByRole('button', { name: /save window|save tabs|update from window/i }).first().click(); await p.waitForTimeout(600); } });

// Popup states
const P = { width: 300, height: 560 };
await shot('popup.html', 'popup-idle.png', P);
await shot('popup.html#note', 'popup-quicknote.png', P, { before: async (p) => { const ta = p.locator('textarea').first(); await ta.click(); await p.keyboard.type('Call back recruiter\nAsk about the Tabspace role and timeline'); await p.waitForTimeout(800); } });
const now = Date.now();
await worker.evaluate(async (now) => chrome.storage.local.set({ 'ts.focus': { status: 'running', kind: 'focus', durationMs: 25 * 60000, startedAt: now, endAt: now + 25 * 60000 } }), now);
await shot('popup.html', 'popup-running.png', P);
await shot('dashboard.html#/focus', 'focus-running-1536.png', L);
await shot('dashboard.html#/tasks', 'focus-pill-tasks-1536.png', L);
await shot('newtab.html', 'newtab-running-1366x768.png', { width: 1366, height: 768 });
await worker.evaluate(async () => chrome.storage.local.set({ 'ts.focus': { status: 'paused', kind: 'focus', durationMs: 25 * 60000, remainingMs: 12 * 60000 } }));
await shot('popup.html', 'popup-paused.png', P);
// Session complete
await worker.evaluate(async () => chrome.storage.local.set({ 'ts.focus': { status: 'idle', kind: 'focus', durationMs: 25 * 60000, completed: { kind: 'focus', at: Date.now() } } }));
await shot('popup.html', 'popup-complete.png', P);
await shot('dashboard.html#/focus', 'focus-complete-1536.png', L);
await shot('sidepanel.html', 'sidepanel-complete-360.png', { width: 360, height: 800 });
await shot('newtab.html', 'newtab-complete-1366x768.png', { width: 1366, height: 768 });
await worker.evaluate(async () => chrome.storage.local.set({ 'ts.focus': { status: 'idle', kind: 'focus', durationMs: 25 * 60000 } }));

// Spotify states: not configured (default) already above; configured (client id) not connected
await worker.evaluate(async () => { const s = (await chrome.storage.local.get('ts.settings'))['ts.settings']; s.integrations = { ...s.integrations, spotifyClientId: '0123456789abcdef0123456789abcdef' }; await chrome.storage.local.set({ 'ts.settings': s }); });
await shot('dashboard.html#/dashboard', 'spotify-configured-dashboard-1536.png', L);
await shot('dashboard.html#/focus', 'spotify-configured-focus-1536.png', L);
await shot('newtab.html', 'spotify-configured-newtab-1366x768.png', { width: 1366, height: 768 });
// Fake token -> "connected" (API calls will fail: shows how errors render)
await worker.evaluate(async () => chrome.storage.local.set({ 'secret.spotify': { accessToken: 'x', refreshToken: 'y', expiresAt: Date.now() + 3600e3 } }));
await shot('dashboard.html#/dashboard', 'spotify-fake-token-dashboard-1536.png', L, { wait: 2500 });
await shot('dashboard.html#/focus', 'spotify-fake-token-focus-1536.png', L, { wait: 2500 });
await worker.evaluate(async () => { await chrome.storage.local.remove('secret.spotify'); const s = (await chrome.storage.local.get('ts.settings'))['ts.settings']; s.integrations = { ...s.integrations, spotifyClientId: undefined }; await chrome.storage.local.set({ 'ts.settings': s }); });

await shot('sidepanel.html', 'sidepanel-360.png', { width: 360, height: 900 });
await patchSettings(worker, { theme: 'light' });
await shot('dashboard.html#/dashboard', 'dashboard-light-1536.png', L);
await shot('newtab.html', 'newtab-light-1366x768.png', { width: 1366, height: 768 });
await shot('popup.html', 'popup-light.png', P);
await patchSettings(worker, { theme: 'dark' });

writeFileSync(join(OUT, '_layout-report.json'), JSON.stringify(report, null, 2));
await ctx.close();
