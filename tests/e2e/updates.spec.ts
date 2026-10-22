import { expect, test } from './fixtures';

const newer = {
  checkedAt: Date.now(),
  latest: {
    version: '9.9.9',
    url: 'https://github.com/skaskz/tabspace/releases/tag/v9.9.9',
    downloadUrl: 'https://github.com/skaskz/tabspace/releases/download/v9.9.9/tabspace-extension-v9.9.9.zip',
    notes: 'Test release',
  },
};

test('update alarm is registered in the service worker', async ({ worker }) => {
  await expect.poll(async () => worker.evaluate(async () => !!(await chrome.alarms.get('ts-update-check')))).toBe(true);
});

test('a newer GitHub release shows the dashboard banner, Settings card and popup notice', async ({ worker, extPage, context }) => {
  await worker.evaluate(async (state) => chrome.storage.local.set({ 'ts.update': state }), newer);

  const dash = await extPage('dashboard.html#/dashboard');
  const banner = dash.getByRole('status').filter({ hasText: 'Tabspace 9.9.9' });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Download update' })).toBeVisible();

  // Download opens the release asset in a new tab (Chrome downloads it), then offers Reload.
  const tabOpened = context.waitForEvent('page');
  await banner.getByRole('button', { name: 'Download update' }).click();
  const tab = await tabOpened;
  expect(tab.url() || (await tab.evaluate(() => location.href).catch(() => ''))).toContain('github.com/skaskz/tabspace');
  await expect(banner.getByRole('button', { name: 'Reload Tabspace' })).toBeVisible();

  // Dismiss hides it for this version.
  await banner.getByRole('button', { name: 'Dismiss update notice' }).click();
  await expect(dash.getByText('Tabspace 9.9.9', { exact: false })).toHaveCount(0);
  expect(await worker.evaluate(async () => ((await chrome.storage.local.get('ts.update'))['ts.update'] as { dismissed?: string }).dismissed)).toBe('9.9.9');

  const settings = await extPage('dashboard.html#/settings?section=account');
  await expect(settings.getByText('Version 9.9.9')).toBeVisible();
  await expect(settings.getByRole('switch', { name: 'Check for updates' })).toBeVisible();

  const popup = await extPage('popup.html');
  await expect(popup.getByRole('button', { name: /Update available · v9\.9\.9/ })).toBeVisible();
});

test('no notice when already on the latest version', async ({ worker, extPage }) => {
  const current = await worker.evaluate(() => chrome.runtime.getManifest().version);
  await worker.evaluate(async (v) => chrome.storage.local.set({ 'ts.update': { checkedAt: Date.now(), latest: { version: v, url: 'https://github.com/skaskz/tabspace/releases' } } }), current);
  const dash = await extPage('dashboard.html#/dashboard');
  await expect(dash.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(dash.getByRole('button', { name: 'Download update' })).toHaveCount(0);
});
