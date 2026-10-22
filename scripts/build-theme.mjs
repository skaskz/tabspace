// Builds the optional companion Chrome theme (a separate, theme-only package)
// into theme/dist. Chrome themes can only recolour/skin the browser frame,
// tabs, toolbar and NTP — they cannot contain code, and an extension cannot
// restyle Chrome's native toolbar. Load theme/dist via chrome://extensions →
// "Load unpacked" to apply it.
import { chromium } from '@playwright/test';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'theme/dist');
await mkdir(resolve(out, 'images'), { recursive: true });

// Starfield images rendered with the same visual language as the app. The toolbar image reuses the frame's
// star pattern at lower brightness, so the tab strip, toolbar and bookmarks bar read as dark tinted glass over
// space (Chrome themes can't be truly transparent, so the "translucency" is painted in).
const browser = await chromium.launch();
async function starfield(file, { width, height, bg, starAlpha, streak }) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<html><body style="margin:0;background:${bg}">
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>
  const c = document.getElementById('c'); const x = c.getContext('2d');
  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  x.fillStyle = '${bg}'; x.fillRect(0, 0, ${width}, ${height});
  const n = Math.round(${width} * ${height} / 740);
  for (let i = 0; i < n; i++) { x.globalAlpha = (r() * 0.5 + 0.1) * ${starAlpha}; x.fillStyle = '#fff'; x.beginPath(); x.arc(r() * ${width}, r() * ${height}, r() < 0.94 ? r() * 0.65 + 0.2 : 1.1, 0, 7); x.fill(); }
  if (${streak}) { x.globalAlpha = 0.08 * ${starAlpha}; x.strokeStyle = '#fff'; x.beginPath(); x.moveTo(${width} * 0.62, ${height}); x.lineTo(${width} * 0.62 + ${height} * 1.6, 0); x.stroke(); }
</script></body></html>`);
  await page.locator('#c').screenshot({ path: resolve(out, 'images', file) });
  await page.close();
}
// Window frame (behind the tabs): near-black with soft stars.
await starfield('theme_frame.png', { width: 2400, height: 160, bg: '#020203', starAlpha: 0.8, streak: true });
// Active tab + toolbar + bookmarks bar: same sky, dimmer, on a hair-lighter black — reads as tinted glass.
await starfield('theme_toolbar.png', { width: 2400, height: 160, bg: '#060607', starAlpha: 0.38, streak: false });
await browser.close();

for (const size of [16, 48, 128]) {
  await copyFile(resolve(root, `public/icons/icon-${size}.png`), resolve(out, `images/icon-${size}.png`));
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const manifest = {
  manifest_version: 3,
  name: 'Tabspace Theme',
  version: '1.0.0',
  description: 'Companion monochrome deep-space theme for the Tabspace extension.',
  icons: { 16: 'images/icon-16.png', 48: 'images/icon-48.png', 128: 'images/icon-128.png' },
  theme: {
    images: { theme_frame: 'images/theme_frame.png', theme_toolbar: 'images/theme_toolbar.png' },
    // Keys verified against Chromium's kOverwritableColorTable (chrome/browser/themes/browser_theme_pack.cc).
    // Since the 2023 Chrome Refresh these remain the manifest colour keys; Chrome derives the rest of its
    // palette (side panel, menus, omnibox popups) from them. The bookmarks bar uses `toolbar` as its background.
    colors: {
      frame: rgb('#020203'),
      frame_inactive: rgb('#050506'),
      frame_incognito: rgb('#020203'),
      frame_incognito_inactive: rgb('#050506'),
      background_tab: rgb('#040405'),
      background_tab_inactive: rgb('#060607'),
      background_tab_incognito: rgb('#040405'),
      background_tab_incognito_inactive: rgb('#060607'),
      toolbar: rgb('#070708'),
      toolbar_text: rgb('#e8e8e8'),
      toolbar_button_icon: rgb('#c8c8ca'),
      tab_text: rgb('#f2f2f2'),
      tab_background_text: rgb('#8e8e93'),
      tab_background_text_inactive: rgb('#7a7a7e'),
      tab_background_text_incognito: rgb('#9a9a9e'),
      tab_background_text_incognito_inactive: rgb('#7a7a7e'),
      bookmark_text: rgb('#d6d6d9'),
      omnibox_background: rgb('#101012'),
      omnibox_text: rgb('#ededed'),
      ntp_background: rgb('#050505'),
      ntp_header: rgb('#070708'),
      ntp_text: rgb('#ededed'),
      ntp_link: rgb('#c8c8ca'),
      button_background: [255, 255, 255, 0],
    },
    tints: { buttons: [0, 0, 0.85] },
    properties: { ntp_background_alignment: 'center' },
  },
};
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Theme written to theme/dist');
