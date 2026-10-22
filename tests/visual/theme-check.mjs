// Loads theme/dist into Chromium and confirms Chrome installed it as the active theme (reads the profile Preferences).
import { chromium } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const theme = resolve('theme/dist');
const dir = mkdtempSync(join(tmpdir(), 'ts-theme-'));
const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args: [`--load-extension=${theme}`, `--disable-extensions-except=${theme}`] });
const page = await ctx.newPage();
await page.goto('about:blank');
await page.waitForTimeout(2500);
await ctx.close();
const prefs = JSON.parse(readFileSync(join(dir, 'Default', 'Preferences'), 'utf8'));
const id = prefs?.extensions?.theme?.id;
const settings = prefs?.extensions?.settings ?? {};
const entry = id ? settings[id] : undefined;
console.log('active theme id:', id || '(none)');
console.log('theme name:', entry?.manifest?.name ?? '(unknown)');
console.log('toolbar image:', entry?.manifest?.theme?.images?.theme_toolbar ?? '(none)');
rmSync(dir, { recursive: true, force: true });
if (!id) process.exitCode = 1;
