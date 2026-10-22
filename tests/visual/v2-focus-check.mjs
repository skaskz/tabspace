// Keyboard-only focus visibility check for inputs, custom checkboxes (picker) and the quick-note textarea.
import { join, resolve } from 'node:path';
import { launch, loadExampleData } from './harness.mjs';
const OUT = resolve(import.meta.dirname, '../../docs/reviews/screenshots-v2');
const { ctx, worker, url } = await launch();
await loadExampleData(ctx, url);
await worker.evaluate(async () => chrome.tabs.create({ url: 'https://example.com/', active: false }));
const style = (p) => p.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return { el: `${e.tagName.toLowerCase()} ${(e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.textContent || '').trim().slice(0, 30)}`, outline: `${s.outlineStyle} ${s.outlineWidth}`, shadow: s.boxShadow.slice(0, 80), border: s.borderColor }; });
const res = {};
const page = await ctx.newPage();
await page.goto(url('dashboard.html#/notes'));
await page.waitForTimeout(1000);
await page.locator('nav a[href="#/notes"]').focus();
for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); const s = await style(page); if (s.el.startsWith('input')) { res.notesSearch = s; break; } }
await page.screenshot({ path: join(OUT, 'focus-input-keyboard.png'), clip: { x: 460, y: 200, width: 360, height: 120 } });
const wsId = await worker.evaluate(async () => (await chrome.storage.local.get('ts.workspaces'))['ts.workspaces'][0].id);
await page.goto(url(`dashboard.html#/workspaces?id=${wsId}`));
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /save current window/i }).focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
res.pickerOpen = await style(page);
const seq = [];
for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); seq.push(await style(page)); }
res.pickerTab = seq;
const cb = page.locator('[role="dialog"] [role="checkbox"], [role="dialog"] button[aria-pressed], [role="dialog"] button[aria-checked]').first();
if (await cb.count()) { await cb.focus(); res.pickerCheckbox = await style(page); res.pickerCheckboxRole = await cb.evaluate((e) => ({ role: e.getAttribute('role'), checked: e.getAttribute('aria-checked') ?? e.getAttribute('aria-pressed') })); }
await page.screenshot({ path: join(OUT, 'focus-picker-keyboard.png') });
await page.keyboard.press('Escape');
const p2 = await ctx.newPage();
await p2.setViewportSize({ width: 300, height: 560 });
await p2.goto(url('popup.html#note'));
await p2.waitForTimeout(600);
res.quickNoteTextarea = await style(p2);
await p2.keyboard.press('Tab');
res.quickNoteNext = await style(p2);
console.log(JSON.stringify(res, null, 1));
await ctx.close();
