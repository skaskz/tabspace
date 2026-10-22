import { expect, realErrors, storageGet, storageSet, sw, test } from './helpers';
import type { BrowserContext } from '@playwright/test';

async function settings(context: BrowserContext) {
  return storageGet<Record<string, unknown> & { newTab: Record<string, unknown> }>(context, 'ts.settings');
}

test.describe('New Tab override', () => {
  test('8 · chrome://newtab/ serves the Tabspace New Tab hub: clock, search, workspaces, tasks, calendar, quick links', async ({ context, extensionId, errors }) => {
    const page = await context.newPage();
    await page.goto('chrome://newtab/');
    await expect(page).toHaveURL(new RegExp(`chrome-extension://${extensionId}/newtab.html`));
    await expect(page.getByRole('search')).toBeVisible();
    await expect(page.locator('time').first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Quick links' })).toBeVisible();
    for (const h of ['Workspaces', 'Today’s Tasks', 'Recent Tabs', 'Upcoming Events', 'Focus Mode', 'Quick Links']) await expect(page.getByRole('heading', { name: h })).toBeVisible();
    // Nothing of ours is pinned to the bottom of the viewport (the "Customize Chrome" bar is Chrome's own UI).
    const fixedBottom = await page.evaluate(() =>
      [...document.querySelectorAll('body *')].filter((el) => {
        const cs = getComputedStyle(el);
        return (cs.position === 'fixed' || cs.position === 'sticky') && el.getBoundingClientRect().bottom >= window.innerHeight - 2 && el.getBoundingClientRect().height < window.innerHeight / 2;
      }).length,
    );
    expect(fixedBottom).toBe(0);
    expect(realErrors(errors)).toEqual([]);
  });

  test('8 · disabled New Tab: what actually happens (redirect to chrome://new-tab-page)', async ({ context, extensionId, errors }) => {
    const s = await settings(context);
    await storageSet(context, { 'ts.settings': { ...(s ?? {}), newTab: { ...(s?.newTab ?? {}), enabled: false, showQuote: true, showFocus: true, searchEngine: 'google' } } });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/newtab.html`);
    await page.waitForTimeout(2000);
    const url = page.url();
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 300);
    test.info().annotations.push({ type: 'disabled-newtab-url', description: `${url} | body: ${body}` });
    // Expected: the tab is handed to Chrome's own NTP, OR an honest fallback message is shown — never a blank page.
    const handedOff = /^chrome:\/\/(new-tab-page|newtab)/.test(url);
    const fallback = /turned off/i.test(body);
    expect(handedOff || fallback).toBe(true);
    expect(realErrors(errors)).toEqual([]);
  });

  test('security · javascript: in New Tab search is never executed or navigated', async ({ open, context }) => {
    await context.route('https://www.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>stub</title>stub' }));
    const page = await open('newtab.html');
    let dialog = false;
    page.on('dialog', (d) => {
      dialog = true;
      void d.dismiss();
    });
    const box = page.getByRole('textbox', { name: /Search .* or type a URL/ });
    await box.fill('javascript:alert(1)');
    const nav = page.waitForURL(/google\.com\/search/, { timeout: 8000 }).catch(() => null);
    await box.press('Enter');
    await nav;
    expect(dialog).toBe(false);
    // treated as a search query, not a URL
    expect(page.url()).toMatch(/^https:\/\/www\.google\.com\/search\?q=javascript/);
  });

  test('security · data:/file:/chrome: in New Tab search are searched, not opened', async ({ open, context }) => {
    await context.route('https://www.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>stub</title>stub' }));
    for (const q of ['data:text/html,<script>alert(1)</script>', 'file:///C:/Windows/win.ini', 'chrome://settings']) {
      const page = await open('newtab.html');
      const box = page.getByRole('textbox', { name: /Search .* or type a URL/ });
      await box.fill(q);
      const nav = page.waitForURL((u) => !u.href.includes('newtab.html'), { timeout: 8000 }).catch(() => null);
      await box.press('Enter');
      await nav;
      expect(page.url(), q).toMatch(/^https:\/\/www\.google\.com\/search/);
      await page.close();
    }
  });

  test('security · Add quick link rejects javascript: and stores only http(s) (as a favorite bookmark)', async ({ open, context }) => {
    const page = await open('newtab.html');
    await page.getByRole('list', { name: 'Quick links' }).getByRole('button', { name: 'Add link' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add quick link' });
    await dlg.getByLabel('Name').fill('Evil');
    await dlg.getByLabel('URL').fill('javascript:alert(1)');
    await dlg.getByRole('button', { name: 'Add' }).click();
    await expect(dlg.getByRole('alert')).toBeVisible();
    expect((await storageGet<unknown[]>(context, 'ts.bookmarks')) ?? []).toEqual([]);
    await dlg.getByLabel('URL').fill('github.com');
    await dlg.getByRole('button', { name: 'Add' }).click();
    await expect(dlg).toBeHidden();
    const links = await storageGet<{ url: string; favorite: boolean }[]>(context, 'ts.bookmarks');
    expect(links.map((l) => [l.url, l.favorite])).toEqual([['https://github.com/', true]]);
    await expect(page.getByRole('list', { name: 'Quick links' }).getByRole('link', { name: 'Evil' })).toBeVisible();
  });

  test('security · a javascript: quick link injected into storage is not rendered as a link', async ({ open, context }) => {
    await storageSet(context, { 'ts.quickLinks': [{ id: 'q1', title: 'Injected', url: 'javascript:alert(1)', order: 0 }] });
    const nt = await open('newtab.html');
    await expect(nt.getByRole('list', { name: 'Quick links' })).toBeVisible();
    await expect(nt.getByRole('link', { name: 'Injected' })).toHaveCount(0);
    const dash = await open('dashboard.html#/dashboard');
    await expect(dash.getByRole('heading', { name: 'Quick Links' })).toBeVisible();
    const hrefs = await dash.locator('a[href^="javascript:"]').count();
    expect(hrefs).toBe(0);
    let dialog = false;
    dash.on('dialog', (d) => ((dialog = true), void d.dismiss()));
    const tile = dash.getByText('Injected');
    if (await tile.count()) await tile.first().click();
    await dash.waitForTimeout(500);
    expect(dialog).toBe(false);
    const w = await sw(context);
    const urls = await w.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url || t.pendingUrl));
    expect(urls.some((u) => u?.startsWith('javascript:'))).toBe(false);
  });
  test('customize: hide a widget, move one to the other column (buttons + drag-and-drop), reload → persisted', async ({ open, context }) => {
    const page = await open('newtab.html');
    await page.getByRole('button', { name: 'Customize' }).click();
    await page.getByRole('button', { name: 'Hide Recent Tabs' }).click();
    await page.getByRole('button', { name: 'Move Calendar to the main column' }).click();
    // Drag Focus Mode by its handle into the main column.
    await page.getByRole('group', { name: 'Focus Mode widget' }).getByTitle('Drag to move').dragTo(page.getByRole('region', { name: 'Main column' }), { targetPosition: { x: 40, y: 30 } });
    await expect
      .poll(async () => ((await storageGet<{ newTab: { layout?: { main: string[]; hidden: string[] } } }>(context, 'ts.settings')).newTab.layout?.main ?? []).includes('focus'))
      .toBe(true);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Tabs' })).toHaveCount(0);
    const main = page.locator('main');
    await expect(main.getByRole('grid')).toBeVisible(); // the month calendar now lives in the main column
    await expect(main.getByRole('heading', { name: 'Focus Mode' })).toBeVisible();
    const s = await storageGet<{ newTab: { layout: { main: string[]; side: string[]; hidden: string[] } } }>(context, 'ts.settings');
    expect(s.newTab.layout.hidden).toEqual(['recentTabs']);
    expect(s.newTab.layout.main).toEqual(expect.arrayContaining(['calendar', 'focus']));
    expect(s.newTab.layout.side).not.toContain('calendar');
  });
});
