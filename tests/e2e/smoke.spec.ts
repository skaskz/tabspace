import { expect, test } from './fixtures';

test('extension loads with a running service worker', async ({ worker, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.name).toBe('Tabspace');
  expect(manifest.manifest_version).toBe(3);
});

test('dashboard opens and primary navigation works', async ({ extPage, consoleErrors }) => {
  const page = await extPage('dashboard.html');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  for (const label of ['Workspaces', 'Tabs', 'Calendar', 'Notes', 'Tasks', 'Bookmarks', 'Focus Mode', 'Analytics', 'Settings', 'Chrome Sidebar', 'Dashboard']) {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  expect(consoleErrors).toEqual([]);
});

test('new tab override serves the Tabspace new tab page', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto('chrome://newtab/');
  await expect(page).toHaveURL(new RegExp(`chrome-extension://${extensionId}/newtab.html|chrome://newtab`));
  await expect(page.locator('#root')).not.toBeEmpty();
});

test('side panel and popup pages render', async ({ extPage, consoleErrors }) => {
  const side = await extPage('sidepanel.html');
  await expect(side.locator('#root')).not.toBeEmpty();
  const popup = await extPage('popup.html');
  await expect(popup.locator('#root')).not.toBeEmpty();
  expect(consoleErrors).toEqual([]);
});
