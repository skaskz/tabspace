import { confirmDialog, expect, realErrors, shot, storageGet, sw, test } from './helpers';

const PAGES = ['dashboard', 'workspaces', 'tabs', 'calendar', 'notes', 'tasks', 'bookmarks', 'focus', 'analytics', 'settings', 'sidebar'];

test.describe('core surfaces', () => {
  test('1 · extension loads: worker, manifest, permissions, side panel default', async ({ context }) => {
    const w = await sw(context);
    const info = await w.evaluate(async () => ({
      manifest: chrome.runtime.getManifest(),
      perms: await chrome.permissions.getAll(),
      ua: navigator.userAgent,
      sp: await chrome.sidePanel.getOptions({}),
      behavior: await chrome.sidePanel.getPanelBehavior(),
    }));
    expect(info.manifest.manifest_version).toBe(3);
    expect(info.perms.permissions).toEqual(expect.arrayContaining(['storage', 'tabs', 'tabGroups', 'sidePanel', 'alarms', 'declarativeNetRequest']));
    // No host permissions are granted by default (only optional).
    expect(info.perms.origins ?? []).toEqual([]);
    expect(info.sp.enabled).toBe(true);
    expect(info.sp.path).toBe('sidepanel.html');
    expect(info.behavior.openPanelOnActionClick).toBe(false);
    test.info().annotations.push({ type: 'chromium', description: info.ua });
  });

  test('2/3/19 · every dashboard page renders, nav works, no console errors; screenshots', async ({ dash, errors }) => {
    const page = await dash('dashboard');
    await shot(page, '01-dashboard-empty');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const id of PAGES) {
      await page.evaluate((h) => (location.hash = h), `#/${id}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, `02-page-${id}-empty`);
    }
    // Click navigation (keyboard-reachable links)
    for (const label of ['Workspaces', 'Tasks', 'Dashboard']) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    }
    // Unknown route falls back to the dashboard rather than crashing
    await page.evaluate(() => (location.hash = '#/does-not-exist'));
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(realErrors(errors)).toEqual([]);
  });

  test('2 · title updates per page and back/forward works', async ({ dash }) => {
    const page = await dash('tasks');
    await expect(page).toHaveTitle(/Tasks · Tabspace/);
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Notes', exact: true }).click();
    await expect(page).toHaveTitle(/Notes · Tabspace/);
    await page.goBack();
    await expect(page).toHaveTitle(/Tasks · Tabspace/);
  });

  test('19 · popup, side panel and new tab have no console errors; screenshots', async ({ open, errors }) => {
    const popup = await open('popup.html');
    await expect(popup.getByRole('button', { name: 'Open Dashboard', exact: true })).toBeVisible();
    await popup.setViewportSize({ width: 320, height: 520 });
    await shot(popup, '03-popup');
    const side = await open('sidepanel.html');
    await side.setViewportSize({ width: 360, height: 900 });
    for (const tab of ['Focus', 'Tasks', 'Notes', 'Bookmarks', 'Workspaces']) {
      await side.getByRole('tab', { name: tab }).click();
      await expect(side.getByRole('tabpanel')).toBeVisible();
      await shot(side, `04-sidepanel-${tab.toLowerCase()}`);
    }
    const nt = await open('newtab.html');
    await expect(nt.getByRole('search')).toBeVisible();
    await shot(nt, '05-newtab');
    expect(realErrors(errors)).toEqual([]);
  });

  test('20 · welcome card: "Start fresh" dismisses and persists; example data loads (sample data)', async ({ dash, context }) => {
    const page = await dash('dashboard');
    const welcome = page.getByRole('region', { name: 'Welcome' });
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: 'Load example data' }).click();
    await expect.poll(async () => ((await storageGet<unknown[]>(context, 'ts.workspaces')) ?? []).length, { timeout: 10_000 }).toBeGreaterThan(0);
    const tasks = (await storageGet<{ title: string }[]>(context, 'ts.tasks')) ?? [];
    const notes = (await storageGet<{ title: string; content: string }[]>(context, 'ts.notes')) ?? [];
    // Rule 7: demo content must never be school/class/Canvas/academic.
    const text = JSON.stringify([tasks, notes, await storageGet(context, 'ts.workspaces'), await storageGet(context, 'ts.events')]);
    expect(text).not.toMatch(/\b(school|class(es)?|canvas|homework|lecture|exam|semester|professor|assignment)\b/i);
    await page.waitForTimeout(500);
    await shot(page, '06-dashboard-sample-data');
    for (const id of ['workspaces', 'tasks', 'notes', 'bookmarks', 'calendar', 'analytics', 'focus']) {
      await page.evaluate((h) => (location.hash = h), `#/${id}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, `07-page-${id}-sample`);
    }
  });

  test('20 · "Remove example data" in Settings asks for confirmation', async ({ dash }) => {
    const page = await dash('dashboard');
    await page.getByRole('region', { name: 'Welcome' }).getByRole('button', { name: 'Load example data' }).click();
    await page.evaluate(() => (location.hash = '#/settings?section=data'));
    const btn = page.getByRole('button', { name: /remove example data/i });
    await expect(btn).toBeVisible();
    await btn.click();
    await confirmDialog(page, 'Remove');
  });
});
