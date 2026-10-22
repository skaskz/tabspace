// Rasterise the SVG brand marks into the PNG sizes Chrome needs, using
// Playwright's Chromium (already a dev dependency) instead of a native image lib.
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const large = await readFile(resolve(root, 'public/assets/branding/tabspace-mark.svg'), 'utf8');
const small = await readFile(resolve(root, 'public/assets/branding/tabspace-mark-small.svg'), 'utf8');
await mkdir(resolve(root, 'public/icons'), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  const svg = size <= 32 ? small : large;
  // Toolbar icons sit on a dark rounded tile so the silver mark stays visible on light browser themes too.
  const pad = size <= 16 ? 0 : Math.round(size * 0.08);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.22)}px;background:#0a0a0b;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:${pad}px">
      ${svg.replace('<svg ', '<svg width="100%" height="100%" ')}
    </div></body></html>`);
  await page.screenshot({ path: resolve(root, `public/icons/icon-${size}.png`), omitBackground: true });
  console.log(`icon-${size}.png`);
}
await browser.close();
