// V2: motion system, parallax, popup, New Tab perf, keyboard paths for new pieces, a11y scan.
// TS_DIST=<build> node tests/visual/v2-motion-a11y-perf.mjs
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { launch, loadExampleData, patchSettings, PAGES, DIST } from './harness.mjs';
import { audit } from './a11y-audit.mjs';

const OUT = resolve(import.meta.dirname, '../../docs/reviews/screenshots-v2');
const out = {};
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : null; };

const { ctx, worker, url } = await launch();
await patchSettings(worker, { userName: 'Alex' });
await loadExampleData(ctx, url);
await worker.evaluate(async () => { for (const u of ['https://example.com/', 'https://example.org/']) await chrome.tabs.create({ url: u, active: false }); });

const init = () => {
  window.__t = { lt: [], cls: 0, shifts: [], raf: 0, lastMut: 0 };
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__t.lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported entry type */ }
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) { window.__t.cls += e.value; window.__t.shifts.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), src: (e.sources || []).map((s) => s.node && s.node.nodeType === 1 ? `${s.node.tagName.toLowerCase()}.${String(s.node.className).slice(0, 40)}` : '').join('|') }); } })).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported entry type */ }
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__t.lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* unsupported entry type */ }
  const o = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { window.__t.raf++; return o(cb); };
  document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => (window.__t.lastMut = performance.now())).observe(document.body, { childList: true, subtree: true, characterData: true }));
};

// ---------- New Tab load ----------
async function loadRuns(file, firstSel, size, n = 5, extra) {
  const runs = [];
  for (let i = 0; i < n; i++) {
    const page = await ctx.newPage();
    await page.setViewportSize(size);
    await page.addInitScript(init);
    const reqs = [];
    page.on('requestfinished', (r) => reqs.push(r.url().split('/').pop()));
    await page.goto(url(file));
    await page.waitForSelector(firstSel, { timeout: 15000 });
    const first = await page.evaluate(() => performance.now());
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return { fcp: fcp && Math.round(fcp.startTime), lcp: Math.round(window.__t.lcp || 0), settled: Math.round(window.__t.lastMut), cls: +window.__t.cls.toFixed(4), shifts: window.__t.shifts, lt: window.__t.lt, nodes: document.querySelectorAll('*').length, heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null };
    });
    if (extra) Object.assign(r, await extra(page));
    runs.push({ firstSel: Math.round(first), ...r, reqs: reqs.length, jsFiles: reqs.filter((x) => x.endsWith('.js')) });
    await page.close();
  }
  return { median: { firstContent: med(runs.map((r) => r.firstSel)), fcp: med(runs.map((r) => r.fcp)), lcp: med(runs.map((r) => r.lcp)), domSettled: med(runs.map((r) => r.settled)), cls: runs.map((r) => r.cls), heapMB: runs[0].heap, nodes: runs[0].nodes }, longtasks: runs.flatMap((r) => r.lt), shiftsRun0: runs[0].shifts.slice(0, 8), jsFilesRun0: runs[0].jsFiles, requestsRun0: runs[0].reqs };
}
out.newtabLoad = await loadRuns('newtab.html', 'h1, [data-clock], time', { width: 1366, height: 768 });
out.dashboardLoad = await loadRuns('dashboard.html#/dashboard', 'main h1', { width: 1536, height: 1024 }, 3);
console.log('newtab', JSON.stringify(out.newtabLoad.median), 'lt', out.newtabLoad.longtasks);

// Bundle: newtab entry
const assets = join(DIST, 'assets');
const html = readFileSync(join(DIST, 'newtab.html'), 'utf8');
const files = [...new Set([...html.matchAll(/assets\/([^"']+\.(?:js|css))/g)].map((m) => m[1]))];
const sz = (f) => { const b = readFileSync(join(assets, f)); return { f, kb: +(b.length / 1024).toFixed(1), gz: +(gzipSync(b).length / 1024).toFixed(1) }; };
out.newtabBundle = { preload: files.map(sz), preloadKb: +files.reduce((s, f) => s + statSync(join(assets, f)).size / 1024, 0).toFixed(0), runtimeJs: out.newtabLoad.jsFilesRun0 };
out.newtabBundle.runtimeKb = +out.newtabBundle.runtimeJs.filter((f) => { try { statSync(join(assets, f)); return true; } catch { return false; } }).reduce((s, f) => s + statSync(join(assets, f)).size / 1024, 0).toFixed(0);
for (const h of ['dashboard.html', 'popup.html', 'sidepanel.html']) {
  const t = readFileSync(join(DIST, h), 'utf8');
  const fs = [...new Set([...t.matchAll(/assets\/([^"']+\.(?:js|css))/g)].map((m) => m[1]))];
  out[h + 'PreloadKb'] = Math.round(fs.reduce((s, f) => s + statSync(join(assets, f)).size / 1024, 0));
}

// ---------- Popup open-to-interactive ----------
out.popup = await loadRuns('popup.html', 'button:has-text("Start"):not([disabled])', { width: 300, height: 560 }, 7);
out.popupNote = await loadRuns('popup.html#note', 'textarea', { width: 300, height: 560 }, 5, async (p) => ({ focused: await p.evaluate(() => document.activeElement?.tagName) }));
console.log('popup', JSON.stringify(out.popup.median), 'note', JSON.stringify(out.popupNote.median));

// ---------- Parallax ----------
async function parallax(label) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(init);
  if (label === 'osReduced') await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url('newtab.html'));
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  // idle
  let a = await m(); let r0 = await page.evaluate(() => window.__t.raf);
  await page.waitForTimeout(3000);
  let b = await m(); let r1 = await page.evaluate(() => window.__t.raf);
  const idle = { rafPerSec: (r1 - r0) / 3, cpuPct: +(((b.TaskDuration - a.TaskDuration) / 3) * 100).toFixed(2), scriptMsPerSec: +(((b.ScriptDuration - a.ScriptDuration) / 3) * 1000).toFixed(1) };
  // moving: 120 mouse moves over 2s
  a = await m(); r0 = await page.evaluate(() => window.__t.raf);
  const lt0 = await page.evaluate(() => window.__t.lt.length);
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) { await page.mouse.move(200 + i * 8, 150 + Math.sin(i / 8) * 200); await page.waitForTimeout(12); }
  const dur = (Date.now() - t0) / 1000;
  b = await m(); r1 = await page.evaluate(() => window.__t.raf);
  const transforms = await page.evaluate(() => [...document.querySelectorAll('[data-layer]')].map((l) => l.style.transform));
  const moving = { seconds: +dur.toFixed(2), rafPerSec: +((r1 - r0) / dur).toFixed(1), cpuPct: +(((b.TaskDuration - a.TaskDuration) / dur) * 100).toFixed(1), scriptMsPerFrame: +(((b.ScriptDuration - a.ScriptDuration) * 1000) / Math.max(1, r1 - r0)).toFixed(3), layoutsDuring: b.LayoutCount - a.LayoutCount, recalcStyles: b.RecalcStyleCount - a.RecalcStyleCount, longtasks: (await page.evaluate(() => window.__t.lt)).slice(lt0), transforms };
  // settle after stop
  await page.waitForTimeout(1500);
  a = await m(); r0 = await page.evaluate(() => window.__t.raf);
  await page.waitForTimeout(2000);
  b = await m(); r1 = await page.evaluate(() => window.__t.raf);
  const afterStop = { rafPerSec: (r1 - r0) / 2, cpuPct: +(((b.TaskDuration - a.TaskDuration) / 2) * 100).toFixed(2) };
  const twinkleAnims = await page.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running').map((x) => x.animationName || x.constructor.name).reduce((o, n) => ((o[n] = (o[n] || 0) + 1), o), {}));
  const canvasMem = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`));
  if (label === 'on') await page.screenshot({ path: join(OUT, 'newtab-parallax-moved-1366x768.png') });
  await page.close();
  return { idle, moving, afterStop, runningAnimations: twinkleAnims, canvases: canvasMem };
}
out.parallax = { on: await parallax('on') };
await patchSettings(worker, { parallax: false });
out.parallax.settingOff = await parallax('off');
await patchSettings(worker, { parallax: true, reducedMotion: true });
out.parallax.appReduced = await parallax('appReduced');
await patchSettings(worker, { reducedMotion: false });
out.parallax.osReduced = await parallax('osReduced');
console.log('parallax', JSON.stringify(out.parallax));

// ---------- Motion: modal enter/exit, focus, click-through ----------
{
  const page = await ctx.newPage();
  await page.addInitScript(init);
  await page.goto(url('dashboard.html#/workspaces'));
  await page.waitForTimeout(1200);
  const trig = page.getByRole('button', { name: /new workspace/i }).first();
  await trig.focus();
  await page.keyboard.press('Enter');
  const samples = [];
  for (let i = 0; i < 8; i++) {
    samples.push(await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); if (!d) return null; const s = getComputedStyle(d); return { t: Math.round(performance.now()), op: +(+s.opacity).toFixed(2), tf: s.transform.slice(0, 40), focusInDialog: d.contains(document.activeElement) }; }));
    await page.waitForTimeout(35);
  }
  const m = { openSamples: samples, focusAfterOpen: await page.evaluate(() => document.activeElement?.getAttribute('placeholder') || document.activeElement?.tagName) };
  // type during enter animation works?
  await page.keyboard.type('Zz');
  m.typedDuringEnter = await page.evaluate(() => document.querySelector('[role="dialog"] input')?.value);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  const ex = [];
  for (let i = 0; i < 10; i++) {
    ex.push(await page.evaluate(() => { const ov = document.querySelector('[data-state="closing"]'); const d = document.querySelector('[role="dialog"]'); return { t: Math.round(performance.now()), dialog: !!d, closing: !!ov, inert: ov ? ov.hasAttribute('inert') : null, active: document.activeElement?.textContent?.trim().slice(0, 20) || document.activeElement?.tagName }; }));
    await page.waitForTimeout(30);
  }
  m.exitSamples = ex;
  // click-through during exit: reopen, close, immediately click the trigger again
  await trig.click(); await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(40);
  const clickT = Date.now();
  await trig.click({ timeout: 2000 }).catch((e) => (m.clickDuringExitError = e.message.slice(0, 120)));
  await page.waitForTimeout(400);
  m.reopenedAfterClickDuringExit = (await page.locator('[role="dialog"]').count()) > 0;
  m.clickDuringExitMs = Date.now() - clickT;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  m.cls = await page.evaluate(() => window.__t.cls);
  out.modal = m;
  // Menu enter/exit + escape focus return
  await page.goto(url('dashboard.html#/tasks'));
  await page.waitForTimeout(1000);
  const mb = page.locator('main button[aria-haspopup="menu"]').first();
  await mb.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(60);
  const menuOpenFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.keyboard.press('End');
  const afterEnd = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(30);
  const during = await page.evaluate(() => ({ menuInDom: !!document.querySelector('[role="menu"]'), active: document.activeElement?.getAttribute('aria-label') }));
  await page.waitForTimeout(300);
  out.menu = { menuOpenFocus, afterEnd, during, after: await page.evaluate(() => ({ menuInDom: !!document.querySelector('[role="menu"]'), active: document.activeElement?.getAttribute('aria-label') })) };
  // Page transitions: animations running right after nav
  const navs = [];
  for (const target of ['notes', 'tasks', 'dashboard', 'bookmarks']) {
    await page.evaluate(() => { window.__t.cls = 0; window.__t.shifts = []; });
    await page.locator(`nav a[href="#/${target}"]`).click();
    await page.waitForTimeout(30);
    const anims = await page.evaluate(() => {
      const list = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.closest?.('main'));
      const byName = {};
      for (const a of list) { const n = a.animationName || a.transitionProperty || 'anim'; byName[n] = (byName[n] || 0) + 1; }
      const nested = list.filter((a) => a.effect.target.parentElement?.closest('.ts-page-in') && (a.animationName || '').startsWith('ts-')).length;
      return { byName, nestedUnderPageIn: nested, maxEnd: Math.round(Math.max(0, ...list.map((a) => { const t = a.effect.getComputedTiming(); return t.endTime; }))) };
    });
    await page.waitForTimeout(600);
    const cls = await page.evaluate(() => ({ cls: +window.__t.cls.toFixed(4), shifts: window.__t.shifts.slice(0, 4) }));
    navs.push({ target, ...anims, ...cls });
  }
  out.pageTransitions = navs;
  // Hover lift
  await page.goto(url('dashboard.html#/dashboard'));
  await page.waitForTimeout(1200);
  const lift = page.locator('.ts-lift').first();
  const before = await lift.evaluate((e) => ({ tf: getComputedStyle(e).transform, tr: getComputedStyle(e).transitionDuration, prop: getComputedStyle(e).transitionProperty.slice(0, 120) }));
  await page.evaluate(() => { window.__t.cls = 0; });
  await lift.hover();
  await page.waitForTimeout(300);
  const afterHover = await lift.evaluate((e) => ({ tf: getComputedStyle(e).transform, shadow: getComputedStyle(e).boxShadow.slice(0, 60) }));
  out.lift = { count: await page.locator('.ts-lift').count(), before, afterHover, clsOnHover: await page.evaluate(() => window.__t.cls) };
  // Inventory of transition durations on interactive elements
  out.transitionInventory = await page.evaluate(() => {
    const m = {};
    for (const el of document.querySelectorAll('button, a, .ts-card, input')) { const s = getComputedStyle(el); const k = `${s.transitionDuration.split(',')[0]} ${s.transitionTimingFunction.split(',')[0].slice(0, 40)}`; m[k] = (m[k] || 0) + 1; }
    return m;
  });
  await page.close();
}
console.log('modal', JSON.stringify(out.modal).slice(0, 1500));
console.log('menu', JSON.stringify(out.menu), 'nav', JSON.stringify(out.pageTransitions), 'lift', JSON.stringify(out.lift));

// ---------- Keyboard: popup, quick note, saved-tab reorder, picker ----------
const fi = (p) => p.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return { tag: e.tagName.toLowerCase(), name: (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || '').trim().slice(0, 40), ring: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none') }; });
const kb = {};
{
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 300, height: 560 });
  await page.goto(url('popup.html'));
  await page.waitForTimeout(800);
  kb.popupInitialFocus = await fi(page);
  const seq = [];
  for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); seq.push(await fi(page)); }
  kb.popupTabOrder = seq;
  // New note via keyboard
  await page.getByRole('button', { name: /new note/i }).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  kb.quickNoteFocusOnOpen = await fi(page);
  await page.keyboard.type('Keyboard note title\nbody');
  await page.waitForTimeout(900);
  kb.quickNoteStatus = await page.evaluate(() => document.querySelector('[role="status"]')?.textContent || [...document.querySelectorAll('span,div')].find((e) => /Saved|Saving/.test(e.textContent || '') && e.children.length === 0)?.textContent);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  kb.quickNoteEscape = { stillInNote: (await page.locator('textarea').count()) > 0, focus: await fi(page) };
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
  kb.quickNoteSaved = await worker.evaluate(async () => (await chrome.storage.local.get('ts.notes'))['ts.notes'].some((n) => /Keyboard note title/.test(n.title + n.content)));
  await page.screenshot({ path: join(OUT, 'popup-after-note-keyboard.png') });
  out.popupAudit = await page.evaluate(audit);
  await page.goto(url('popup.html#note'));
  await page.waitForTimeout(600);
  out.popupNoteAudit = await page.evaluate(audit);
  await page.close();
}
{
  const page = await ctx.newPage();
  const wsId = await worker.evaluate(async () => (await chrome.storage.local.get('ts.workspaces'))['ts.workspaces'][0].id);
  await page.goto(url(`dashboard.html#/workspaces?id=${wsId}`));
  await page.waitForTimeout(1200);
  const titles = () => page.evaluate(() => [...document.querySelectorAll('[aria-label="Saved tabs, in the order they open"] li')].map((li) => li.innerText.split('\n').filter(Boolean).slice(0, 2).join(' ')));
  kb.reorderBefore = await titles();
  const down = page.locator('[aria-label="Saved tabs, in the order they open"] li').first().getByRole('button', { name: /down/i });
  kb.moveDownName = await down.getAttribute('aria-label');
  await down.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  kb.reorderAfter = await titles();
  kb.focusAfterMove = await fi(page);
  kb.liveRegion = await page.evaluate(() => [...document.querySelectorAll('[aria-live], [role="status"]')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 3));
  // drag handle keyboard?
  kb.dragHandle = await page.evaluate(() => { const h = document.querySelector('[aria-label="Saved tabs, in the order they open"] li [draggable="true"], [aria-label="Saved tabs, in the order they open"] li[draggable="true"]'); return h ? { tag: h.tagName, tabbable: h.tabIndex >= 0, label: h.getAttribute('aria-label'), roledesc: h.getAttribute('aria-roledescription') } : null; });
  // Remove via keyboard + undo?
  const rm = page.locator('[aria-label="Saved tabs, in the order they open"] li').last().getByRole('button', { name: /remove/i });
  kb.removeName = await rm.getAttribute('aria-label').catch(() => null);
  if (kb.removeName) { await rm.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(400); kb.afterRemove = { list: await titles(), focus: await fi(page), undoToast: await page.getByText(/undo/i).count() }; }
  // DnD with mouse
  const items = page.locator('[aria-label="Saved tabs, in the order they open"] li');
  if ((await items.count()) >= 2) {
    const before = await titles();
    await items.nth(1).dragTo(items.nth(0)).catch((e) => (kb.dndError = e.message.slice(0, 100)));
    await page.waitForTimeout(400);
    kb.dnd = { before, after: await titles() };
  }
  await page.screenshot({ path: join(OUT, 'workspace-editor-after-keyboard.png') });
  out.workspaceDetailAudit = await page.evaluate(audit);
  // Picker keyboard
  await page.getByRole('button', { name: /save current window/i }).first().click();
  await page.waitForTimeout(500);
  kb.pickerFocusOnOpen = await fi(page);
  const cbs = page.locator('[role="dialog"] input[type="checkbox"], [role="dialog"] [role="checkbox"]');
  kb.pickerCheckboxes = await cbs.count();
  const firstEnabled = page.locator('[role="dialog"] input[type="checkbox"]:not([disabled]), [role="dialog"] [role="checkbox"]:not([aria-disabled="true"])').first();
  await firstEnabled.focus();
  kb.pickerCbFocus = await fi(page);
  const c0 = await page.locator('[role="dialog"]').innerText();
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  const c1 = await page.locator('[role="dialog"]').innerText();
  kb.pickerSpaceToggles = c0 !== c1;
  kb.pickerCountText = (c1.match(/\d+ of \d+ selected/) || [])[0];
  out.pickerAudit = await page.evaluate(audit);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  kb.pickerFocusReturn = await fi(page);
  await page.close();
}
out.keyboard = kb;
console.log('kb', JSON.stringify(kb).slice(0, 3000));

// ---------- a11y scan all surfaces ----------
out.audit = {};
for (const p of PAGES) {
  const page = await ctx.newPage();
  await page.goto(url(`dashboard.html#/${p}`));
  await page.waitForTimeout(1200);
  const r = await page.evaluate(audit);
  out.audit[p] = { unnamed: r.unnamed, unlabeled: r.unlabeled, low: r.lowContrastCount, lowSample: r.lowContrast.slice(0, 5), skips: r.skips, h1: r.h1count, ph: r.placeholderLow };
  await page.close();
}
for (const [f, s] of [['newtab.html', { width: 1366, height: 768 }], ['sidepanel.html', { width: 360, height: 900 }]]) {
  const page = await ctx.newPage();
  await page.setViewportSize(s);
  await page.goto(url(f));
  await page.waitForTimeout(1200);
  const r = await page.evaluate(audit);
  out.audit[f] = { unnamed: r.unnamed, unlabeled: r.unlabeled, low: r.lowContrastCount, lowSample: r.lowContrast.slice(0, 6), skips: r.skips, h1: r.h1count, ph: r.placeholderLow, headings: r.headings };
  await page.close();
}
out.audit.popup = { unnamed: out.popupAudit.unnamed, unlabeled: out.popupAudit.unlabeled, low: out.popupAudit.lowContrastCount, lowSample: out.popupAudit.lowContrast.slice(0, 6), h1: out.popupAudit.h1count };
out.audit.popupNote = { unnamed: out.popupNoteAudit.unnamed, unlabeled: out.popupNoteAudit.unlabeled, low: out.popupNoteAudit.lowContrastCount, lowSample: out.popupNoteAudit.lowContrast.slice(0, 6) };
out.audit.workspaceDetail = { unnamed: out.workspaceDetailAudit.unnamed, unlabeled: out.workspaceDetailAudit.unlabeled, low: out.workspaceDetailAudit.lowContrastCount, lowSample: out.workspaceDetailAudit.lowContrast.slice(0, 5) };
out.audit.picker = { unnamed: out.pickerAudit.unnamed, unlabeled: out.pickerAudit.unlabeled, low: out.pickerAudit.lowContrastCount };
for (const [k, v] of Object.entries(out.audit)) console.log('audit', k, 'unnamed', v.unnamed.length, 'unlabeled', v.unlabeled.length, 'low', v.low, 'h1', v.h1, (v.lowSample || []).map((x) => `${x.ratio}:${x.txt}`).join(' | ').slice(0, 300));
// token check
out.tokens = await (async () => { const page = await ctx.newPage(); await page.goto(url('newtab.html')); await page.waitForTimeout(500); const t = await page.evaluate(() => { const c = getComputedStyle(document.documentElement); return Object.fromEntries(['--ts-bg', '--ts-surface', '--ts-surface-2', '--ts-surface-3', '--ts-fg', '--ts-muted', '--ts-faint', '--ts-line', '--ts-line-strong'].map((k) => [k, c.getPropertyValue(k).trim()])); }); await page.close(); return t; })();
console.log('tokens', JSON.stringify(out.tokens));

writeFileSync(join(OUT, '_v2-report.json'), JSON.stringify(out, null, 2));
await ctx.close();
