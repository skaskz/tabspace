import { expect, storageGet, storageSet, sw, test } from './helpers';

type B = { url: string; title: string; folderId?: string };

test.describe('Bookmarks · Save current tab', () => {
  test('saves the most recent web tab of the dashboard window into the selected folder, and shows it', async ({ context, dash, web }) => {
    await storageSet(context, { 'ts.bookmarkFolders': [{ id: 'f1', name: 'Research', order: 1, createdAt: 1, updatedAt: 1 }] });
    const site = await context.newPage();
    await site.goto(web.url('Roblox mechanics wiki'));
    const page = await dash('bookmarks?folder=f1');
    await page.bringToFront();
    await page.getByRole('button', { name: 'Save current tab' }).click();
    const dlg = page.getByRole('dialog', { name: /Save (tab|page)|Bookmark/ });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel('Title')).toHaveValue('Roblox mechanics wiki');
    await expect(dlg.getByLabel('Folder')).toHaveValue('f1');
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved to Research' })).toBeVisible();
    const saved = await storageGet<B[]>(context, 'ts.bookmarks');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ url: web.url('Roblox mechanics wiki'), title: 'Roblox mechanics wiki', folderId: 'f1' });
    // Visible in the current folder view and selected.
    await expect(page.getByRole('complementary', { name: 'Link details' })).toContainText('Roblox mechanics wiki');
  });

  test('works when the dashboard was opened in its own window and the web page is in another window', async ({ context, extensionId, web }) => {
    const site = await context.newPage();
    await site.goto(web.url('Push Tabspace to GitHub'));
    // Open the dashboard in a separate window via the extension (like the popup's "Open Dashboard" would).
    const w = await sw(context);
    const pagePromise = context.waitForEvent('page');
    await w.evaluate(async (url) => {
      await chrome.windows.create({ url, focused: true });
    }, `chrome-extension://${extensionId}/dashboard.html#/bookmarks`);
    const page = await pagePromise;
    await page.waitForLoadState();
    await page.getByRole('button', { name: 'Save current tab' }).click();
    const dlg = page.getByRole('dialog', { name: /Save (tab|page)|Bookmark/ });
    await expect(dlg.getByLabel('Title')).toHaveValue('Push Tabspace to GitHub');
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => ((await storageGet<B[]>(context, 'ts.bookmarks')) ?? []).map((b) => b.title)).toEqual(['Push Tabspace to GitHub']);
  });

  test('a duplicate offers to update instead of adding a second copy', async ({ context, dash, web }) => {
    const url = web.url('Edit YouTube Short');
    await storageSet(context, { 'ts.bookmarks': [{ id: 'b1', url, title: 'Old title', tags: [], favorite: false, createdAt: 1, updatedAt: 1 }] });
    const site = await context.newPage();
    await site.goto(url);
    const page = await dash('bookmarks');
    await page.getByRole('button', { name: 'Save current tab' }).click();
    const dlg = page.getByRole('dialog', { name: /Save (tab|page)|Bookmark/ });
    await expect(dlg.getByText(/Already saved in Unfiled/)).toBeVisible();
    await dlg.getByRole('button', { name: /Update/ }).click();
    await expect.poll(async () => (await storageGet<B[]>(context, 'ts.bookmarks')).map((b) => b.title)).toEqual(['Edit YouTube Short']);
  });
});
