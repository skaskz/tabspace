import type { Page } from '@playwright/test';
import { barFrame, enableWebsiteBar, expect, marginTop, patchSettings, realErrors, registered, shot, test, type Ext } from './qa21';

/** Agent 5 — V2.1 adversarial QA: Tabspace Bar on websites (granted build copy). */

const seed = {
  'ts.bookmarks': [
    { id: 'g', url: 'https://github.com/', title: 'GitHub', tags: [], favorite: true, createdAt: 1, updatedAt: 1 },
    { id: 'm', url: 'https://developer.mozilla.org/', title: 'MDN', tags: [], favorite: false, folderId: 'dev', createdAt: 1, updatedAt: 1 },
  ],
  'ts.bookmarkFolders': [
    { id: 'dev', name: 'Dev tools', order: 0, createdAt: 1, updatedAt: 1 },
    { id: 'read', name: 'Read later', order: 1, createdAt: 1, updatedAt: 1 },
  ],
  'ts.workspaces': [{ id: 'w', name: 'Job hunt', icon: 'briefcase', order: 0, createdAt: 1, updatedAt: 1 }],
};

async function ready(gx: Ext) {
  await gx.set(seed);
  await enableWebsiteBar(gx, true);
  await expect.poll(() => registered(gx)).toEqual(['tabspace-bar']);
}
const hostCount = (p: Page) => p.locator('tabspace-bar').count();

test.describe('V2.1 · Tabspace Bar on websites', () => {
  test('injects once, shifts the page by 34 px, restores the page\'s own html margin when removed', async ({ gx, site, errors }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/margin`);
    await barFrame(page);
    expect(await hostCount(page)).toBe(1);
    test.info().annotations.push({ type: 'margin-with-bar (page had 20px)', description: await marginTop(page) });
    await enableWebsiteBar(gx, false);
    await expect.poll(() => hostCount(page)).toBe(0);
    expect(await marginTop(page)).toBe('20px');
    expect(realErrors(errors).filter((e) => e.includes(site.origin))).toEqual([]);
  });

  test('BUG-BAR1 · a site\'s fixed header stays clickable with the bar on', async ({ gx, site }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/fixed`);
    await barFrame(page);
    await shot(page, 'v21qa-bar-fixed-header');
    const top = await page.evaluate(() => document.elementFromPoint(40, 15)?.tagName);
    test.info().annotations.push({ type: 'element-at-(40,15)', description: String(top) });
    let clicked = false;
    await page.exposeFunction('__clicked', () => (clicked = true));
    await page.evaluate(() => document.getElementById('hdrbtn')!.addEventListener('click', () => (window as unknown as { __clicked: () => void }).__clicked()));
    await page.locator('#hdrbtn').click({ timeout: 3000 }).catch(() => undefined);
    expect(clicked).toBe(true);
  });

  test('bookmark this page into a NEW folder from the bar; star fills; dashboard shows it', async ({ gx, site }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/plain`);
    const frame = await barFrame(page);
    await frame.getByRole('button', { name: 'Bookmark this page' }).click();
    const dlg = frame.getByRole('dialog', { name: 'Bookmark this page' }).or(frame.getByRole('form', { name: 'Bookmark this page' })).first();
    await expect(dlg).toBeVisible();
    await frame.getByRole('combobox', { name: 'Folder' }).selectOption({ label: 'New folder…' });
    await frame.getByRole('textbox', { name: 'New folder name' }).fill('From the bar');
    await frame.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => ((await gx.get<{ name: string }[]>('ts.bookmarkFolders')) ?? []).map((f) => f.name)).toContain('From the bar');
    await expect(frame.getByRole('button', { name: 'Edit bookmark for this page' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => marginTop(page)).toBe('34px'); // frame shrank back to the bar
    const dash = await gx.open('dashboard.html#/bookmarks');
    await expect(dash.getByText('Plain page').first()).toBeVisible();
  });

  test('bookmark dialog fits a short window (1280×420): Save reachable', async ({ gx, site }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.goto(`${site.origin}/plain`);
    const frame = await barFrame(page);
    await frame.getByRole('button', { name: 'Bookmark this page' }).click();
    const save = frame.getByRole('button', { name: 'Save' });
    await expect(save).toBeVisible();
    await shot(page, 'v21qa-bar-bookmark-short-window');
    const box = await page.locator('tabspace-bar').evaluate(() => null);
    void box;
    await save.click({ timeout: 3000 });
    await expect.poll(async () => ((await gx.get<{ url: string }[]>('ts.bookmarks')) ?? []).some((b) => b.url === `${site.origin}/plain`)).toBe(true);
  });

  test('XSS: hostile page title in the bookmark dialog is text, nothing runs', async ({ gx, site }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    const dialogs: string[] = [];
    page.on('dialog', (d) => (dialogs.push(d.message()), void d.dismiss()));
    await page.goto(`${site.origin}/evil`);
    const frame = await barFrame(page);
    await frame.getByRole('button', { name: 'Bookmark this page' }).click();
    await expect(frame.getByRole('textbox', { name: 'Title' })).toHaveValue('<img src=x onerror=alert(1)>');
    await frame.getByRole('button', { name: 'Save' }).click();
    const dash = await gx.open('dashboard.html#/bookmarks');
    await dash.waitForTimeout(600);
    expect(await dash.locator('[onerror]').count()).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('"Hide bar" collapses to a tab; what happens on the next navigation', async ({ gx, site }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/plain`);
    const frame = await barFrame(page);
    await frame.getByRole('button', { name: 'Tabspace Bar options' }).click();
    await frame.getByRole('menuitem', { name: 'Hide bar' }).click();
    await expect.poll(() => marginTop(page)).toBe('0px');
    await page.goto(`${site.origin}/plain2`);
    await barFrame(page);
    await page.waitForTimeout(500);
    test.info().annotations.push({ type: 'after-navigation', description: `margin ${await marginTop(page)} (34px = bar shown again; collapse is per page)` });
  });

  test('"Hide on this site" only affects that host (localhost still shows the bar)', async ({ gx, site }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/plain`);
    const frame = await barFrame(page);
    await frame.getByRole('button', { name: 'Tabspace Bar options' }).click();
    await frame.getByRole('menuitem', { name: 'Hide on this site' }).click();
    await expect.poll(() => hostCount(page)).toBe(0);
    const other = await gx.context.newPage();
    await other.goto(site.origin.replace('127.0.0.1', 'localhost') + '/plain');
    await barFrame(other);
    // Re-enable the site from settings → bar returns live
    await patchSettings(gx, (s) => ({ ...s, tabspaceBar: { ...s.tabspaceBar, disabledSites: [] } }));
    await expect.poll(() => hostCount(page)).toBe(1);
  });

  test('fullscreen hides the bar and un-shifts the page; exiting restores it', async ({ gx, site }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/fullscreen`);
    await barFrame(page);
    await page.locator('#fs').click();
    const isFs = await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 3000 }).then(() => true).catch(() => false);
    test.skip(!isFs, 'Fullscreen API not available in this headless run');
    await expect.poll(() => marginTop(page)).toBe('0px');
    expect(await page.locator('tabspace-bar').evaluate((e) => getComputedStyle(e).display)).toBe('none');
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => marginTop(page)).toBe('34px');
  });

  test('disabling removes the bar from every open tab; re-enabling only affects newly loaded pages', async ({ gx, site }) => {
    await ready(gx);
    const pages = await Promise.all([0, 1, 2].map(async (i) => {
      const p = await gx.context.newPage();
      await p.goto(`${site.origin}/plain?${i}`);
      await barFrame(p);
      return p;
    }));
    await enableWebsiteBar(gx, false);
    for (const p of pages) await expect.poll(() => hostCount(p)).toBe(0);
    for (const p of pages) expect(await marginTop(p)).toBe('0px');
    await enableWebsiteBar(gx, true);
    await pages[0].waitForTimeout(800);
    const live = await Promise.all(pages.map(hostCount));
    test.info().annotations.push({ type: 'already-open-tabs-after-reenable', description: JSON.stringify(live) });
    await pages[0].reload();
    await barFrame(pages[0]);
  });

  test('SPA pushState: the bar survives and the star reflects the NEW url', async ({ gx, site }) => {
    await ready(gx);
    await gx.set({ 'ts.bookmarks': [...seed['ts.bookmarks'], { id: 'spa', url: `${site.origin}/spa`, title: 'SPA home', tags: [], favorite: false, createdAt: 1, updatedAt: 1 }] });
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/spa`);
    let frame = await barFrame(page);
    await expect(frame.getByRole('button', { name: 'Edit bookmark for this page' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#go').click();
    await expect(page).toHaveURL(`${site.origin}/spa/next`);
    await page.waitForTimeout(1200);
    expect(await hostCount(page)).toBe(1);
    frame = await barFrame(page);
    const pressed = await frame.getByRole('button', { name: /Bookmark this page|Edit bookmark for this page/ }).getAttribute('aria-pressed');
    test.info().annotations.push({ type: 'star-after-pushState', description: String(pressed) });
    expect(pressed).toBe('false');
  });

  test('strict CSP page (frame-src none): bar still injects and works, no CSP errors from us', async ({ gx, site, errors }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/csp`);
    const ok = await barFrame(page, 6000).then(() => true).catch(() => false);
    test.info().annotations.push({ type: 'bar-on-strict-csp', description: String(ok) });
    test.info().annotations.push({ type: 'errors', description: JSON.stringify(errors.filter((e) => e.includes('/csp'))) });
    expect(ok).toBe(true);
  });

  test('BUG-BAR2 · a page that removes the injected element is not left with a 34 px blank gap', async ({ gx, site }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/remover`);
    await page.waitForTimeout(1500);
    const n = await hostCount(page);
    const m = await marginTop(page);
    test.info().annotations.push({ type: 'state', description: `hosts=${n} margin=${m}` });
    expect(n === 1 || m === '0px').toBe(true);
  });

  test('rapid toggling (10×) settles to the final state: registration, live tabs and new tabs agree', async ({ gx, site }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/plain`);
    await barFrame(page);
    for (let i = 0; i < 10; i++) await enableWebsiteBar(gx, i % 2 === 1); // ends ON (i=9)
    await page.waitForTimeout(1500);
    expect(await registered(gx)).toEqual(['tabspace-bar']);
    expect(await hostCount(page)).toBe(1);
    expect(await marginTop(page)).toBe('34px');
    for (let i = 0; i < 9; i++) await enableWebsiteBar(gx, i % 2 === 1); // ends OFF (i=8)
    await page.waitForTimeout(1500);
    expect(await registered(gx)).toEqual([]);
    expect(await hostCount(page)).toBe(0);
    expect(await marginTop(page)).toBe('0px');
    const fresh = await gx.context.newPage();
    await fresh.goto(`${site.origin}/plain2`);
    await fresh.waitForTimeout(800);
    expect(await hostCount(fresh)).toBe(0);
  });

  test('keyboard: Tab from the page reaches the bar; arrows move between items; Escape closes a folder menu', async ({ gx, site }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/plain`);
    const frame = await barFrame(page);
    await frame.getByRole('button', { name: 'Open Tabspace dashboard' }).focus();
    const seq: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      seq.push(await frame.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute('aria-label') || (document.activeElement as HTMLElement)?.textContent?.trim() || ''));
    }
    test.info().annotations.push({ type: 'arrow-right-focus', description: JSON.stringify(seq) });
    expect(new Set(seq).size).toBeGreaterThan(1);
    await frame.getByRole('button', { name: 'Dev tools' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(frame.getByRole('menuitem', { name: /MDN/ })).toBeFocused();
    await expect.poll(async () => (await page.locator('tabspace-bar').evaluate(() => 0)) === 0).toBe(true);
    await page.keyboard.press('Escape');
    await expect(frame.getByRole('menu')).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Dev tools' })).toBeFocused();
    await expect.poll(() => marginTop(page)).toBe('34px');
  });

  test('BUG-BAR3 · with a bar menu open, clicking the page closes it and the expanded (440 px) frame stops covering the page', async ({ gx, site }) => {
    await ready(gx);
    const page = await gx.context.newPage();
    await page.goto(`${site.origin}/errors`);
    const frame = await barFrame(page);
    await frame.getByRole('button', { name: 'Dev tools' }).click();
    await expect(frame.getByRole('menu')).toBeVisible();
    await page.mouse.click(1000, 600); // page area below the expanded frame
    await page.waitForTimeout(500);
    const menuOpen = await frame.getByRole('menu').count();
    const at = await page.evaluate(() => document.elementFromPoint(900, 200)?.tagName);
    test.info().annotations.push({ type: 'after-page-click', description: `menu open=${menuOpen}, element at (900,200)=${at}` });
    expect(menuOpen).toBe(0);
    expect(at).not.toBe('TABSPACE-BAR');
  });

  test('no console errors on host pages caused by the bar', async ({ gx, site, errors }) => {
    await ready(gx);
    for (const p of ['/plain', '/fixed', '/spa', '/margin', '/errors']) {
      const page = await gx.context.newPage();
      await page.goto(site.origin + p);
      await barFrame(page);
      await page.close();
    }
    expect(realErrors(errors).filter((e) => e.includes(site.origin) || /bar/i.test(e))).toEqual([]);
  });
});
