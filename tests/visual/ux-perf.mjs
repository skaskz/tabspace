// Performance measurements for UX_REVIEW.md: load time, memory, starfield CPU, 200 tabs, large data sets.
// node tests/visual/ux-perf.mjs  (TS_DIST env)
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { launch, loadExampleData, patchSettings, SHOTS, DIST } from './harness.mjs';

const out = {};
const med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)] * 10) / 10; };

// ---- bundle sizes ----
const assets = join(DIST, 'assets');
out.bundles = readdirSync(assets).filter((f) => f.endsWith('.js') || f.endsWith('.css')).map((f) => {
  const b = readFileSync(join(assets, f));
  return { f, kb: Math.round(statSync(join(assets, f)).size / 102.4) / 10, gzKb: Math.round(gzipSync(b).length / 102.4) / 10 };
}).sort((a, b) => b.kb - a.kb);
out.bundleTotalKb = Math.round(out.bundles.reduce((s, x) => s + x.kb, 0));
// What each surface loads up front (modulepreload + script in the HTML)
out.entryPreloads = {};
for (const h of ['dashboard.html', 'newtab.html', 'sidepanel.html', 'popup.html']) {
  const html = readFileSync(join(DIST, h), 'utf8');
  const files = [...html.matchAll(/assets\/([^"']+\.(?:js|css))/g)].map((m) => m[1]);
  out.entryPreloads[h] = { files, kb: Math.round(files.reduce((s, f) => s + statSync(join(assets, f)).size, 0) / 1024) };
}

const { ctx, worker, url } = await launch();
await patchSettings(worker, { userName: 'Alex' });
await loadExampleData(ctx, url);

const initTiming = () => {
  window.__t = { longtasks: [], events: [] };
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__t.longtasks.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch { /* entry type unsupported */ }
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__t.lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* entry type unsupported */ }
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__t.events.push({ n: e.name, d: e.duration }))).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch { /* entry type unsupported */ }
  const mo = new MutationObserver(() => {
    if (!window.__t.h1 && document.querySelector('main h1')) window.__t.h1 = performance.now();
    if (!window.__t.content && document.querySelector('main .ts-card')) window.__t.content = performance.now();
  });
  document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true, subtree: true }));
};

async function measureLoad(path, readySel, n = 5) {
  const runs = [];
  for (let i = 0; i < n; i++) {
    const page = await ctx.newPage();
    await page.addInitScript(initTiming);
    const t0 = Date.now();
    await page.goto(url(path));
    await page.waitForSelector(readySel, { timeout: 20000 });
    const wall = Date.now() - t0;
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return { dcl: Math.round(nav.domContentLoadedEventEnd), fcp: fcp && Math.round(fcp.startTime), lcp: Math.round(window.__t.lcp || 0), h1: Math.round(window.__t.h1 || 0), content: Math.round(window.__t.content || 0), longtasks: window.__t.longtasks };
    });
    runs.push({ wall, ...t });
    await page.close();
  }
  return { median: { wall: med(runs.map((r) => r.wall)), dcl: med(runs.map((r) => r.dcl)), fcp: med(runs.map((r) => r.fcp || 0)), lcp: med(runs.map((r) => r.lcp)), h1: med(runs.map((r) => r.h1)), firstCard: med(runs.map((r) => r.content)) }, longtasks: runs.flatMap((r) => r.longtasks), runs: runs.length };
}

out.load = {
  dashboard: await measureLoad('dashboard.html#/dashboard', 'main h1'),
  tasks: await measureLoad('dashboard.html#/tasks', 'main h1'),
  analytics: await measureLoad('dashboard.html#/analytics', 'main h1'),
  newtab: await measureLoad('newtab.html', 'h1, input', 5),
  sidepanel: await measureLoad('sidepanel.html', 'h1', 5),
};
console.log('load', JSON.stringify(out.load, null, 0));

// ---- memory + starfield CPU ----
async function metrics(path, seconds = 5) {
  const page = await ctx.newPage();
  await page.goto(url(path));
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const get = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const a = await get();
  await page.waitForTimeout(seconds * 1000);
  const b = await get();
  const mem = await page.evaluate(() => performance.memory ? { used: Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10, total: Math.round(performance.memory.totalJSHeapSize / 1048576 * 10) / 10 } : null);
  await page.close();
  return {
    heapUsedMB: Math.round(b.JSHeapUsedSize / 1048576 * 10) / 10,
    nodes: b.Nodes,
    cpuPctIdle: Math.round(((b.TaskDuration - a.TaskDuration) / seconds) * 1000) / 10,
    scriptMsPerSec: Math.round(((b.ScriptDuration - a.ScriptDuration) / seconds) * 10000) / 10,
    paintsPerSec: Math.round((b.LayoutCount - a.LayoutCount) / seconds),
    performanceMemory: mem,
  };
}
out.idle = {
  dashboardStarfieldOn: await metrics('dashboard.html#/dashboard'),
  tasksStarfieldOn: await metrics('dashboard.html#/tasks'),
  newtabStarfieldOn: await metrics('newtab.html'),
  sidepanelStarfieldOn: await metrics('sidepanel.html'),
};
await patchSettings(worker, { starfield: false });
out.idle.dashboardStarfieldOff = await metrics('dashboard.html#/dashboard');
await patchSettings(worker, { starfield: true, reducedMotion: true });
out.idle.dashboardReducedMotion = await metrics('dashboard.html#/dashboard');
await patchSettings(worker, { reducedMotion: false });
console.log('idle', JSON.stringify(out.idle));

// ---- route-change focus handling ----
{
  const page = await ctx.newPage();
  await page.goto(url('dashboard.html#/dashboard'));
  await page.waitForTimeout(800);
  await page.locator('nav a[href="#/notes"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  out.routeFocus = await page.evaluate(() => ({ active: document.activeElement?.tagName + ' ' + (document.activeElement?.textContent || '').trim().slice(0, 30), title: document.title }));
  // input focus style
  const inp = page.locator('main input').first();
  await inp.focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  out.inputFocusStyle = await inp.evaluate((el) => { const s = getComputedStyle(el); return { outline: s.outlineStyle + ' ' + s.outlineWidth, border: s.borderColor, shadow: s.boxShadow }; });
  await page.screenshot({ path: join(SHOTS, 'a11y-input-focus-notes.png'), clip: { x: 460, y: 220, width: 360, height: 110 } });
  // menu item focus visual
  await page.goto(url('dashboard.html#/tasks'));
  await page.waitForTimeout(800);
  const mb = page.locator('main button[aria-haspopup="menu"]').first();
  await mb.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS, 'a11y-menu-keyboard.png'), clip: { x: 900, y: 280, width: 636, height: 360 } });
  await page.close();
}

// ---- 200 tabs ----
{
  const t0 = Date.now();
  await worker.evaluate(async () => {
    const ps = [];
    for (let i = 0; i < 200; i++) ps.push(chrome.tabs.create({ url: `about:blank#tab-${i}`, active: false }));
    await Promise.all(ps);
  });
  out.tabsCreateMs = Date.now() - t0;
  const count = await worker.evaluate(async () => (await chrome.tabs.query({})).length);
  const page = await ctx.newPage();
  await page.addInitScript(initTiming);
  const s = Date.now();
  await page.goto(url('dashboard.html#/tabs'));
  await page.waitForFunction(() => document.querySelectorAll('main input[type="checkbox"], main [role="checkbox"]').length > 150, null, { timeout: 30000 }).catch(() => {});
  const renderMs = Date.now() - s;
  await page.waitForTimeout(800);
  const rows = await page.evaluate(() => document.querySelectorAll('main input[type="checkbox"], main [role="checkbox"]').length);
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
  // Search latency
  const search = page.getByPlaceholder('Search tabs');
  await search.click();
  const k0 = Date.now();
  await search.pressSequentially('tab-19', { delay: 0 });
  await page.waitForTimeout(50);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
  const searchMs = Date.now() - k0;
  const filtered = await page.evaluate(() => document.querySelectorAll('main input[type="checkbox"], main [role="checkbox"]').length);
  await search.fill('');
  await page.waitForTimeout(500);
  // Select all latency
  const sel = page.locator('main thead input[type="checkbox"], main [aria-label*="Select all" i]').first();
  let selectAllMs = null;
  if (await sel.count()) { const a = Date.now(); await sel.click(); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r)))); selectAllMs = Date.now() - a; }
  await page.screenshot({ path: join(SHOTS, 'perf-tabs-200.png') });
  const ev = await page.evaluate(() => ({ longtasks: window.__t.longtasks, slowEvents: window.__t.events.filter((e) => e.d > 50).map((e) => `${e.n}:${Math.round(e.d)}`) }));
  out.tabs200 = { totalTabs: count, renderMs, rowsRendered: rows, domNodes: nodes, type6CharsMs: searchMs, filteredRows: filtered, selectAllMs, ...ev };
  console.log('tabs200', JSON.stringify(out.tabs200));
  await page.close();
  await worker.evaluate(async () => { const t = await chrome.tabs.query({}); await chrome.tabs.remove(t.filter((x) => (x.url || '').startsWith('about:blank#tab-')).map((x) => x.id)); });
}

// ---- large data ----
async function measureTyping(page, locator, text) {
  await locator.click();
  await page.evaluate(() => { window.__t.events = []; window.__t.longtasks = []; });
  const per = [];
  for (const ch of text) {
    const a = Date.now();
    await page.keyboard.type(ch);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
    per.push(Date.now() - a);
  }
  const ev = await page.evaluate(() => ({ maxEvent: Math.round(Math.max(0, ...window.__t.events.map((e) => e.d))), slowEvents: window.__t.events.filter((e) => e.d > 50).length, longtasks: window.__t.longtasks }));
  return { medianKeyToFrameMs: med(per), maxKeyToFrameMs: Math.max(...per), ...ev };
}
async function pageRender(path, readyFn) {
  const page = await ctx.newPage();
  await page.addInitScript(initTiming);
  const a = Date.now();
  await page.goto(url(path));
  await page.waitForFunction(readyFn, null, { timeout: 30000 }).catch(() => {});
  const ms = Date.now() - a;
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => ({ nodes: document.querySelectorAll('*').length, longtasks: window.__t.longtasks }));
  return { page, ms, ...info };
}

// Baseline typing on small data first
{
  const r = await pageRender('dashboard.html#/notes', () => document.querySelectorAll('main button').length > 5);
  const card = r.page.locator('main').getByText('YouTube content ideas').first();
  await card.click();
  await r.page.waitForTimeout(400);
  const edit = r.page.getByRole('button', { name: /^Edit$/ });
  if (await edit.count()) await edit.click();
  const ta = r.page.locator('main textarea').first();
  out.baselineNotesTyping = (await ta.count()) ? await measureTyping(r.page, ta, 'hello world typing') : 'no textarea';
  out.baselineNotesSearch = await measureTyping(r.page, r.page.getByPlaceholder('Search notes'), 'roblox');
  await r.page.close();
}

await worker.evaluate(async () => {
  const now = Date.now();
  const id = () => crypto.randomUUID();
  const words = 'alpha beta gamma delta roblox youtube github focus tabspace deploy review script research automation design notes link chrome'.split(' ');
  const w = (n) => Array.from({ length: n }, () => words[Math.floor(Math.random() * words.length)]).join(' ');
  const cur = await chrome.storage.local.get(['ts.bookmarks', 'ts.notes', 'ts.tasks', 'ts.bookmarkFolders']);
  const folders = cur['ts.bookmarkFolders'] || [];
  const bookmarks = Array.from({ length: 2000 }, (_, i) => ({ id: id(), createdAt: now - i * 60000, updatedAt: now - i * 60000, url: `https://site${i}.example.com/path/${i}`, title: `Bookmark ${i} ${w(3)}`, tags: i % 5 ? [] : ['bulk'], favorite: i % 50 === 0, folderId: folders.length ? folders[i % folders.length].id : undefined }));
  const notes = Array.from({ length: 1000 }, (_, i) => ({ id: id(), createdAt: now - i * 60000, updatedAt: now - i * 60000, title: `Note ${i} ${w(2)}`, content: `# Note ${i}\n\n${w(120)}\n\n- ${w(8)}\n- ${w(8)}\n\n${w(200)}`, tags: [words[i % words.length]], favorite: i % 40 === 0 }));
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const tasks = Array.from({ length: 1000 }, (_, i) => ({ id: id(), createdAt: now - i * 60000, updatedAt: now - i * 60000, title: `Task ${i} ${w(4)}`, done: i % 4 === 0, completedAt: i % 4 === 0 ? now - i * 1000 : undefined, priority: ['none', 'low', 'medium', 'high'][i % 4], dueDate: i % 3 ? day((i % 30) - 5) : undefined, subtasks: [], order: i }));
  await chrome.storage.local.set({ 'ts.bookmarks': [...(cur['ts.bookmarks'] || []), ...bookmarks], 'ts.notes': [...(cur['ts.notes'] || []), ...notes], 'ts.tasks': [...(cur['ts.tasks'] || []), ...tasks] });
});
out.storageBytes = await worker.evaluate(async () => chrome.storage.local.getBytesInUse(null));

out.large = {};
for (const [name, path, fn] of [
  ['dashboard', 'dashboard.html#/dashboard', () => !!document.querySelector('main h1') && document.querySelectorAll('main .ts-card').length > 3],
  ['bookmarks', 'dashboard.html#/bookmarks', () => document.body.innerText.includes('Bookmark 1999') || document.querySelectorAll('main li').length > 50],
  ['notes', 'dashboard.html#/notes', () => document.body.innerText.includes('Note 999') || document.querySelectorAll('main button').length > 100],
  ['tasks', 'dashboard.html#/tasks', () => document.querySelectorAll('main li').length > 50],
  ['analytics', 'dashboard.html#/analytics', () => !!document.querySelector('main svg')],
  ['calendar', 'dashboard.html#/calendar', () => !!document.querySelector('main h1')],
]) {
  const r = await pageRender(path, fn);
  out.large[name] = { renderMs: r.ms, domNodes: r.nodes, longtasks: r.longtasks };
  if (name === 'bookmarks') {
    out.large.bookmarks.search = await measureTyping(r.page, r.page.getByPlaceholder('Search links'), 'roblox');
    await r.page.screenshot({ path: join(SHOTS, 'perf-bookmarks-2000.png') });
  }
  if (name === 'tasks') {
    out.large.tasks.search = await measureTyping(r.page, r.page.getByPlaceholder('Search tasks'), 'github');
    const toggle = r.page.locator('main button[aria-label^="Complete"]').first();
    await r.page.getByPlaceholder('Search tasks').fill('');
    await r.page.waitForTimeout(400);
    const a = Date.now(); await toggle.click(); await r.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => setTimeout(res)))); out.large.tasks.completeClickMs = Date.now() - a;
    await r.page.screenshot({ path: join(SHOTS, 'perf-tasks-1000.png') });
  }
  if (name === 'notes') {
    out.large.notes.search = await measureTyping(r.page, r.page.getByPlaceholder('Search notes'), 'roblox');
    await r.page.getByPlaceholder('Search notes').fill('');
    await r.page.waitForTimeout(400);
    const first = r.page.locator('main').getByText(/^Note \d+/).first();
    await first.click().catch(() => {});
    await r.page.waitForTimeout(400);
    const edit = r.page.getByRole('button', { name: /^Edit$/ });
    if (await edit.count()) await edit.click();
    const ta = r.page.locator('main textarea').first();
    out.large.notes.editorTyping = (await ta.count()) ? await measureTyping(r.page, ta, 'hello world typing') : 'no textarea';
    await r.page.screenshot({ path: join(SHOTS, 'perf-notes-1000.png') });
  }
  if (name === 'dashboard') {
    const p = r.page;
    await p.keyboard.press('Control+k');
    out.large.dashboard.paletteSearch = await measureTyping(p, p.locator('[role="dialog"] input').first(), 'roblox');
  }
  const cdp = await ctx.newCDPSession(r.page);
  await cdp.send('Performance.enable');
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  out.large[name].heapMB = Math.round(m.JSHeapUsedSize / 1048576 * 10) / 10;
  console.log('large', name, JSON.stringify(out.large[name]));
  await r.page.close();
}
// Side panel with large data
{
  const r = await pageRender('sidepanel.html', () => !!document.querySelector('h1'));
  out.large.sidepanel = { renderMs: r.ms, domNodes: r.nodes };
  for (const label of ['Tasks', 'Notes', 'Bookmarks']) {
    const b = r.page.getByRole('button', { name: label, exact: true }).first();
    const a = Date.now();
    await b.click().catch(() => {});
    await r.page.evaluate(() => new Promise((res) => requestAnimationFrame(() => setTimeout(res))));
    out.large.sidepanel[label + 'SwitchMs'] = Date.now() - a;
    out.large.sidepanel[label + 'Nodes'] = await r.page.evaluate(() => document.querySelectorAll('*').length);
  }
  await r.page.screenshot({ path: join(SHOTS, 'perf-sidepanel-large.png') });
  await r.page.close();
}

writeFileSync(join(SHOTS, '_perf-report.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ bundles: out.bundles.slice(0, 8), entry: out.entryPreloads, routeFocus: out.routeFocus, inputFocus: out.inputFocusStyle, storage: out.storageBytes, baseline: out.baselineNotesTyping, baselineSearch: out.baselineNotesSearch, sp: out.large.sidepanel }, null, 1));
await ctx.close();
