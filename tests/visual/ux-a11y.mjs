// Manual accessibility audit (axe-core is not installed): names, labels, headings, contrast, keyboard, reduced motion.
// node tests/visual/ux-a11y.mjs  (TS_DIST env)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, loadExampleData, patchSettings, PAGES, SHOTS } from './harness.mjs';

const { ctx, worker, url } = await launch();
await patchSettings(worker, { userName: 'Alex' });
await loadExampleData(ctx, url);
const out = { pages: {} };

// ---------- static checks run in page ----------
const audit = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 5, g: 5, b: 5, a: 1 };
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (c && c.a >= 1) break;
    }
    let bg = pageBg;
    for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg);
    return bg;
  };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const name = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent).join(' ').trim();
    const t = (el.innerText || el.textContent || '').trim();
    if (t) return t;
    const img = el.querySelector('img[alt]');
    if (img && img.alt) return img.alt;
    return (el.getAttribute('title') || '').trim();
  };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ').slice(0, 4).join('.')} @${Math.round(el.getBoundingClientRect().x)},${Math.round(el.getBoundingClientRect().y)} html=${el.outerHTML.slice(0, 140)}`;

  const unnamed = [...document.querySelectorAll('button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"]')].filter(vis).filter((el) => !name(el)).map(desc);
  const unlabeled = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter((el) => {
    if (el.type === 'file' && !vis(el)) return false;
    return !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !(el.labels && el.labels.length) && !el.getAttribute('title');
  }).map((el) => desc(el) + ` placeholder="${el.getAttribute('placeholder') || ''}"`);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(vis).map((h) => ({ l: Number(h.tagName[1] || h.getAttribute('aria-level')), t: h.textContent.trim().slice(0, 40) }));
  const skips = [];
  for (let i = 1; i < headings.length; i++) if (headings[i].l > headings[i - 1].l + 1) skips.push(`${headings[i - 1].l}:"${headings[i - 1].t}" -> ${headings[i].l}:"${headings[i].t}"`);
  const h1count = headings.filter((h) => h.l === 1).length;

  // Contrast scan over text nodes
  const low = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const tn = walker.currentNode;
    if (!tn.textContent.trim()) continue;
    const el = tn.parentElement;
    if (!el || !vis(el)) continue;
    if (el.closest('[aria-hidden="true"], svg')) continue;
    const s = getComputedStyle(el);
    let fg = parse(s.color);
    if (!fg) continue;
    let op = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
    const bg = bgOf(el);
    fg = blend({ ...fg, a: fg.a * op }, bg);
    const r = ratio(fg, bg);
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const disabled = el.closest('button:disabled, [aria-disabled="true"], input:disabled');
    if (r < need && !disabled) {
      const key = `${s.color}|${Math.round(r * 100)}|${size}`;
      const txt = tn.textContent.trim().slice(0, 40);
      if (seen.has(key + txt)) continue;
      seen.add(key + txt);
      low.push({ txt, ratio: Math.round(r * 100) / 100, size, color: s.color, cls: String(el.className).slice(0, 70) });
    }
  }
  // placeholders
  const ph = [...document.querySelectorAll('input[placeholder], textarea[placeholder]')].filter(vis).map((el) => {
    const c = parse(getComputedStyle(el, '::placeholder').color);
    const bg = bgOf(el);
    return c ? { ph: el.placeholder.slice(0, 40), ratio: Math.round(ratio(blend(c, bg), bg) * 100) / 100 } : null;
  }).filter((x) => x && x.ratio < 4.5);
  return { unnamed, unlabeled, headings: headings.map((h) => h.l + ' ' + h.t), skips, h1count, lowContrast: low.slice(0, 40), lowContrastCount: low.length, placeholderLow: ph };
};

for (const p of PAGES) {
  const page = await ctx.newPage();
  await page.goto(url(`dashboard.html#/${p}`));
  await page.waitForTimeout(1200);
  out.pages[p] = await page.evaluate(audit);
  console.log(p, 'unnamed', out.pages[p].unnamed.length, 'unlabeled', out.pages[p].unlabeled.length, 'lowContrast', out.pages[p].lowContrastCount, 'skips', out.pages[p].skips.length);
  await page.close();
}
for (const [f, sz] of [['sidepanel.html', { width: 360, height: 900 }], ['popup.html', { width: 320, height: 520 }], ['newtab.html', { width: 1536, height: 1024 }]]) {
  const page = await ctx.newPage();
  await page.setViewportSize(sz);
  await page.goto(url(f));
  await page.waitForTimeout(1200);
  out.pages[f] = await page.evaluate(audit);
  // side panel: audit each rail section
  if (f === 'sidepanel.html') {
    const rail = await page.locator('nav button, [role="tab"]').all();
    out.sidepanelSections = [];
    for (const b of rail) {
      try { await b.click({ timeout: 1000 }); } catch { continue; }
      await page.waitForTimeout(300);
      const r = await page.evaluate(audit);
      out.sidepanelSections.push({ section: await b.getAttribute('aria-label'), unnamed: r.unnamed, unlabeled: r.unlabeled, low: r.lowContrastCount });
    }
  }
  console.log(f, 'unnamed', out.pages[f].unnamed.length, 'unlabeled', out.pages[f].unlabeled.length, 'lowContrast', out.pages[f].lowContrastCount);
  await page.close();
}

// ---------- token contrast ----------
{
  const page = await ctx.newPage();
  await page.goto(url('dashboard.html#/tasks'));
  await page.waitForTimeout(800);
  out.tokens = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const hex = (h) => { h = h.trim(); if (h.startsWith('#')) { const n = parseInt(h.slice(1), 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 }; } const p = h.match(/[\d.]+/g).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const blend = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100; };
    const bg = hex(css.getPropertyValue('--ts-bg'));
    const surf = blend(hex(css.getPropertyValue('--ts-surface')), bg);
    const surf2 = blend(hex(css.getPropertyValue('--ts-surface-2')), bg);
    const surf3 = blend(hex(css.getPropertyValue('--ts-surface-3')), bg);
    const res = {};
    for (const t of ['--ts-fg', '--ts-muted', '--ts-faint', '--ts-danger']) {
      const c = hex(css.getPropertyValue(t));
      res[t] = { value: css.getPropertyValue(t).trim(), onBg: ratio(c, bg), onSurface: ratio(c, surf), onSurface2: ratio(c, surf2), onSurface3: ratio(c, surf3) };
    }
    const line = blend(hex(css.getPropertyValue('--ts-line')), surf);
    res['--ts-line (non-text 3:1)'] = { onSurface: ratio(line, surf), onBg: ratio(blend(hex(css.getPropertyValue('--ts-line')), bg), bg) };
    res['--ts-line-strong'] = { onBg: ratio(blend(hex(css.getPropertyValue('--ts-line-strong')), bg), bg) };
    return res;
  });
  await patchSettings(worker, { theme: 'light' });
  await page.waitForTimeout(600);
  out.tokensLight = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const hex = (h) => { h = h.trim(); if (h.startsWith('#')) { const n = parseInt(h.slice(1), 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 }; } const p = h.match(/[\d.]+/g).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const blend = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100; };
    const bg = hex(css.getPropertyValue('--ts-bg'));
    const surf = blend(hex(css.getPropertyValue('--ts-surface')), bg);
    const res = {};
    for (const t of ['--ts-fg', '--ts-muted', '--ts-faint']) { const c = hex(css.getPropertyValue(t)); res[t] = { onBg: ratio(c, bg), onSurface: ratio(c, surf) }; }
    res['--ts-line'] = { onBg: ratio(blend(hex(css.getPropertyValue('--ts-line')), bg), bg) };
    return res;
  });
  out.pages['tasks-light'] = await page.evaluate(audit);
  await patchSettings(worker, { theme: 'dark' });
  await page.close();
}

// ---------- keyboard ----------
const kb = {};
const focusInfo = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: 'body' };
  const s = getComputedStyle(el);
  const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
  return { tag: el.tagName.toLowerCase(), name: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').trim().slice(0, 40), ring: visible, outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, inDialog: !!el.closest('[role="dialog"]') };
});
{
  const page = await ctx.newPage();
  await page.goto(url('dashboard.html#/dashboard'));
  await page.waitForTimeout(1200);
  const seq = [];
  for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); seq.push(await focusInfo(page)); }
  kb.dashboardTabOrder = seq;
  kb.noRing = seq.filter((s) => s.tag !== 'body' && !s.ring);
  await page.screenshot({ path: join(SHOTS, 'a11y-focus-ring-dashboard.png') });

  // Skip link
  await page.goto(url('dashboard.html#/tasks'));
  await page.waitForTimeout(800);
  await page.keyboard.press('Tab');
  kb.firstTab = await focusInfo(page);
  await page.screenshot({ path: join(SHOTS, 'a11y-skip-link.png'), clip: { x: 0, y: 0, width: 600, height: 120 } });

  // Search palette
  await page.locator('nav a[href="#/tasks"]').focus();
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  kb.paletteFocusOnOpen = await focusInfo(page);
  await page.keyboard.type('push');
  await page.waitForTimeout(300);
  const trap = [];
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); trap.push(await focusInfo(page)); }
  kb.paletteTabTrap = trap;
  kb.paletteRoles = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? { dialog: true, combobox: !!d.querySelector('[role="combobox"]'), listbox: !!d.querySelector('[role="listbox"]'), options: d.querySelectorAll('[role="option"]').length, activedesc: d.querySelector('input')?.getAttribute('aria-activedescendant') || null, label: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby') } : { dialog: false };
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  kb.paletteClosedOnEsc = (await page.locator('[role="dialog"]').count()) === 0;
  kb.paletteFocusReturn = await focusInfo(page);

  // Task completion via keyboard
  const before = await worker.evaluate(async () => (await chrome.storage.local.get('ts.tasks'))['ts.tasks'].filter((t) => t.done).length);
  const firstToggle = page.locator('main [role="checkbox"], main button[aria-pressed], main button[aria-label*="omplete" i]').first();
  kb.taskToggleName = await firstToggle.getAttribute('aria-label').catch(() => null);
  await firstToggle.focus();
  kb.taskToggleFocus = await focusInfo(page);
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  const after = await worker.evaluate(async () => (await chrome.storage.local.get('ts.tasks'))['ts.tasks'].filter((t) => t.done).length);
  kb.taskCompletedViaSpace = after > before;
  if (after > before) { await page.keyboard.press('Space'); await page.waitForTimeout(400); }
  // Enter on a row opens details?
  const row = page.locator('main li').first();
  kb.taskRowFocusable = await row.evaluate((el) => el.tabIndex >= 0 || !!el.querySelector('button, [tabindex="0"]'));

  // Menu keyboard
  const menuBtn = page.locator('main button[aria-haspopup="menu"]').first();
  if (await menuBtn.count()) {
    await menuBtn.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const m1 = await focusInfo(page);
    await page.keyboard.press('ArrowDown');
    const m2 = await focusInfo(page);
    await page.keyboard.press('End').catch(() => {});
    const m3 = await focusInfo(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const m4 = await focusInfo(page);
    kb.menu = { onOpen: m1, afterArrowDown: m2, afterEnd: m3, afterEscape: m4, expanded: await menuBtn.getAttribute('aria-expanded') };
  } else kb.menu = 'no aria-haspopup=menu trigger found on tasks page';
  await page.close();
}
// Modal focus trap: Workspaces -> New workspace
{
  const page = await ctx.newPage();
  await page.goto(url('dashboard.html#/workspaces'));
  await page.waitForTimeout(1000);
  const trigger = page.getByRole('button', { name: /new workspace/i }).first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const m = { onOpen: await focusInfo(page) };
  const seq = [];
  for (let i = 0; i < 15; i++) { await page.keyboard.press('Tab'); seq.push(await focusInfo(page)); }
  m.escapedTrap = seq.filter((s) => !s.inDialog).length;
  const seqB = [];
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Shift+Tab'); seqB.push(await focusInfo(page)); }
  m.escapedTrapBack = seqB.filter((s) => !s.inDialog).length;
  await page.screenshot({ path: join(SHOTS, 'a11y-modal-new-workspace.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  m.closed = (await page.locator('[role="dialog"]').count()) === 0;
  m.focusReturn = await focusInfo(page);
  kb.modal = m;
  // background inert?
  await page.close();
}
// Confirm dialog (destructive) on tasks: delete via menu
{
  const page = await ctx.newPage();
  await page.goto(url('dashboard.html#/notes'));
  await page.waitForTimeout(1000);
  // keyboard: can we open a note with Enter?
  const card = page.locator('main').getByText('YouTube content ideas').first();
  const focusableCard = await card.evaluate((el) => { const b = el.closest('button, a, [tabindex]'); return b ? b.tagName : null; });
  kb.noteCardFocusable = focusableCard;
  await page.close();
}
out.keyboard = kb;

// ---------- reduced motion / starfield animation ----------
async function canvasChanges(opts, hiddenTest = false) {
  const page = await ctx.newPage();
  if (opts.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.__raf = 0;
    const o = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf++; return o(cb); };
  });
  await page.goto(url(opts.file || 'dashboard.html#/tasks'));
  await page.waitForTimeout(1000);
  const snap = () => page.evaluate(() => document.querySelector('canvas')?.toDataURL().length + ':' + document.querySelector('canvas')?.toDataURL().slice(-200));
  const a = await snap();
  const r0 = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(2000);
  const b = await snap();
  const r1 = await page.evaluate(() => window.__raf);
  let hidden = null;
  if (hiddenTest) {
    const other = await ctx.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await page.waitForTimeout(300);
    const vs = await page.evaluate(() => document.visibilityState);
    const h0 = await page.evaluate(() => window.__raf);
    await page.waitForTimeout(2000);
    const h1 = await page.evaluate(() => window.__raf);
    hidden = { visibilityState: vs, rafPerSecWhileHidden: (h1 - h0) / 2 };
    await other.close();
  }
  await page.close();
  return { changed: a !== b, rafPerSec: (r1 - r0) / 2, hidden };
}
out.motion = {
  normal: await canvasChanges({}, true),
  osReduced: await canvasChanges({ reducedMotion: true }),
};
await patchSettings(worker, { reducedMotion: true });
out.motion.appReduced = await canvasChanges({});
await patchSettings(worker, { reducedMotion: false });
out.motion.newtab = await canvasChanges({ file: 'newtab.html' });
out.motion.sidepanel = await canvasChanges({ file: 'sidepanel.html' });
console.log(JSON.stringify(out.motion));
console.log(JSON.stringify(out.keyboard, null, 1).slice(0, 4000));
console.log(JSON.stringify(out.tokens), JSON.stringify(out.tokensLight));

writeFileSync(join(SHOTS, '_a11y-report.json'), JSON.stringify(out, null, 2));
await ctx.close();
