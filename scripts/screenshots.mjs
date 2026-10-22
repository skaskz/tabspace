import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const dist = resolve(process.argv[2]);
const out = process.argv[3];
const pages = process.argv.slice(4);
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ts-shot-')), { channel: 'chromium', headless: true, viewport: { width: 1536, height: 1024 }, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
let [w] = ctx.serviceWorkers(); if (!w) w = await ctx.waitForEvent('serviceworker');
const id = new URL(w.url()).host;
for (const p of pages) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const [file, hash = ''] = p.split('#');
  const size = file === 'sidepanel.html' ? { width: 360, height: 900 } : file === 'popup.html' ? { width: 320, height: 520 } : { width: 1536, height: 1024 };
  await page.setViewportSize(size);
  await page.goto(`chrome-extension://${id}/${file}${hash ? '#' + hash : ''}`);
  await page.waitForTimeout(1200);
  const name = (file.replace('.html', '') + (hash ? '-' + hash.replace(/[^a-z]/gi, '') : '')) + '.png';
  await page.screenshot({ path: join(out, name) });
  console.log(name, errs.length ? 'ERRORS: ' + errs.join(' | ') : 'ok');
  await page.close();
}
await ctx.close();
