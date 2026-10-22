// Renders README / social images from the SVG logo: docs/media/banner.png (README header),
// docs/media/social-preview.png (GitHub social preview, 1280x640) and docs/media/logo.png.
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'docs/media');
await mkdir(out, { recursive: true });
const mark = await readFile(resolve(root, 'public/assets/branding/tabspace-mark.svg'), 'utf8');
const markImg = `data:image/svg+xml;base64,${Buffer.from(mark).toString('base64')}`;

const stars = (w, h, n, seed = 7) => {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => `<circle cx="${(r() * w).toFixed(1)}" cy="${(r() * h).toFixed(1)}" r="${(r() < 0.92 ? r() * 0.9 + 0.3 : 1.6).toFixed(2)}" fill="#fff" opacity="${(r() * 0.55 + 0.15).toFixed(2)}"/>`).join('');
};

const page = (w, h, body) => `<!doctype html><html><head><meta charset="utf-8">
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&display=block');
html,body{margin:0;background:transparent}*{box-sizing:border-box}
.c{position:relative;width:${w}px;height:${h}px;overflow:hidden;border-radius:28px;background:radial-gradient(ellipse at 70% 15%,#1a1a1d 0%,#050505 60%);font-family:Inter,system-ui,sans-serif;color:#f5f5f5}
.s{position:absolute;inset:0}</style></head><body><div class="c" id="c"><svg class="s" width="${w}" height="${h}">${stars(w, h, Math.round((w * h) / 2600))}</svg>${body}</div></body></html>`;

const browser = await chromium.launch();
const p = await browser.newPage({ deviceScaleFactor: 2 });

async function render(file, w, h, body) {
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(page(w, h, body), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.locator('#c').screenshot({ path: resolve(out, file), omitBackground: true });
  console.log(file);
}

await render(
  'banner.png',
  1280,
  360,
  `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:34px">
     <img src="${markImg}" width="132" height="132"/>
     <div><div style="font-size:96px;font-weight:700;letter-spacing:-0.045em;line-height:1">Tabspace</div>
     <div style="margin-top:14px;font-size:28px;font-weight:500;color:#a1a1a6">Your browser, organized.</div></div></div>`,
);
await render(
  'social-preview.png',
  1280,
  640,
  `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
     <div style="display:flex;align-items:center;gap:32px"><img src="${markImg}" width="150" height="150"/>
     <div style="font-size:120px;font-weight:700;letter-spacing:-0.045em">Tabspace</div></div>
     <div style="margin-top:26px;font-size:34px;font-weight:500;color:#c9c9cc">Workspaces · Tab groups · Tasks · Notes · Focus</div>
     <div style="margin-top:14px;font-size:22px;letter-spacing:0.3em;text-transform:uppercase;color:#8e8e93">A Chrome extension</div></div>`,
);
await p.setViewportSize({ width: 512, height: 512 });
await p.setContent(`<html><body style="margin:0;background:transparent"><div id="c" style="width:512px;height:512px;border-radius:112px;background:#0a0a0b;display:flex;align-items:center;justify-content:center"><img src="${markImg}" width="400" height="400"/></div></body></html>`);
await p.locator('#c').screenshot({ path: resolve(out, 'logo.png'), omitBackground: true });
console.log('logo.png');
await browser.close();
