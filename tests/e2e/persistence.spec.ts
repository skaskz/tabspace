/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BrowserContext, Page } from '@playwright/test';
import { confirmDialog, expect, realErrors, relaunch, shot, storageGet, test } from './helpers';

async function openDash(context: BrowserContext, extensionId: string, route: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dashboard.html#/${route}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  return page;
}

async function addTask(page: Page, title: string) {
  const box = page.getByRole('textbox', { name: 'Quick add task' });
  await box.fill(title);
  await box.press('Enter');
  await expect(page.getByRole('button', { name: `Open task ${title}` })).toBeVisible();
}

test.describe('persistence', () => {
  test('12/17 · tasks persist across reload AND full browser restart', async ({ context, extensionId, dir, errors }) => {
    const page = await openDash(context, extensionId, 'tasks');
    await addTask(page, 'Review job applications');
    await addTask(page, 'Edit YouTube Short');
    await page.getByRole('checkbox', { name: 'Complete "Edit YouTube Short"' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open task Review job applications' })).toBeVisible();
    await context.close();

    const r = await relaunch(dir, errors);
    try {
      const p2 = await openDash(r.context, r.extensionId, 'tasks');
      await expect(p2.getByRole('button', { name: 'Open task Review job applications' })).toBeVisible();
      await p2.getByRole('tab', { name: /Completed/ }).click();
      await expect(p2.getByRole('button', { name: 'Open task Edit YouTube Short' })).toBeVisible();
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await r.context.close();
    }
  });

  test('13 · notes autosave: type, wait, reload', async ({ context, extensionId }) => {
    const page = await openDash(context, extensionId, 'notes');
    await page.getByRole('button', { name: 'New Note' }).first().click();
    await page.getByRole('textbox', { name: 'Note title' }).fill('Roblox mechanics');
    await page.getByRole('textbox', { name: 'Note content' }).fill('# Ideas\n- double jump\n- grapple hook');
    await page.waitForTimeout(1200);
    const notes = await storageGet<{ title: string; content: string }[]>(context, 'ts.notes');
    expect(notes[0].title).toBe('Roblox mechanics');
    expect(notes[0].content).toContain('grapple hook');
    await page.reload();
    await expect(page.getByText('Roblox mechanics').first()).toBeVisible();
    await shot(page, '12-notes-editor');
  });

  test('BUG-NT1 · notes: typing then reloading immediately (<500ms debounce) does not lose text', async ({ context, extensionId }) => {
    const page = await openDash(context, extensionId, 'notes');
    await page.getByRole('button', { name: 'New Note' }).first().click();
    await page.getByRole('textbox', { name: 'Note title' }).fill('Quick thought');
    await page.waitForTimeout(1000);
    await page.getByRole('textbox', { name: 'Note content' }).fill('typed right before reload');
    await page.reload(); // well inside the 500 ms autosave debounce
    await expect.poll(async () => ((await storageGet<{ content: string }[]>(context, 'ts.notes')) ?? [])[0]?.content, { timeout: 3000 }).toBe('typed right before reload');
  });

  test('BUG-NT1 · notes: closing the tab immediately after typing does not lose text', async ({ context, extensionId }) => {
    const page = await openDash(context, extensionId, 'notes');
    await page.getByRole('button', { name: 'New Note' }).first().click();
    await page.getByRole('textbox', { name: 'Note title' }).fill('Close test');
    await page.waitForTimeout(1000);
    await page.getByRole('textbox', { name: 'Note content' }).fill('typed right before closing');
    await page.close({ runBeforeUnload: true });
    await expect.poll(async () => ((await storageGet<{ content: string }[]>(context, 'ts.notes')) ?? [])[0]?.content, { timeout: 3000 }).toBe('typed right before closing');
  });

  test('14/17 · bookmarks persist across restart; duplicate warning; javascript: rejected', async ({ context, extensionId, dir, errors }) => {
    const page = await openDash(context, extensionId, 'bookmarks');
    const add = async (url: string) => {
      await page.getByRole('button', { name: 'Add Link' }).click();
      const dlg = page.getByRole('dialog', { name: 'Add link' });
      await dlg.getByLabel('URL').fill(url);
      return dlg;
    };
    let dlg = await add('javascript:alert(1)');
    await dlg.getByRole('button', { name: 'Add link' }).click();
    await expect(dlg.getByRole('alert')).toContainText('valid http(s)');
    await dlg.getByLabel('URL').fill('github.com/tabspace');
    await dlg.getByLabel('Title').fill('Tabspace repo');
    await dlg.getByRole('button', { name: 'Add link' }).click();
    await expect(dlg).toBeHidden();
    // Duplicate
    dlg = await add('https://github.com/tabspace');
    await dlg.getByRole('button', { name: 'Add link' }).click();
    await expect(dlg.getByRole('button', { name: 'Save anyway' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    expect((await storageGet<unknown[]>(context, 'ts.bookmarks')).length).toBe(1);
    await shot(page, '13-bookmarks');
    await context.close();
    const r = await relaunch(dir, errors);
    try {
      const p2 = await openDash(r.context, r.extensionId, 'bookmarks');
      await expect(p2.getByText('Tabspace repo').first()).toBeVisible();
    } finally {
      await r.context.close();
    }
  });

  test('18 · settings persist across restart (name, theme toggle, starfield)', async ({ context, extensionId, dir, errors }) => {
    const page = await openDash(context, extensionId, 'settings');
    await page.getByRole('textbox', { name: 'Your name' }).fill('Alex');
    await page.getByRole('textbox', { name: 'Your name' }).press('Enter');
    await page.getByRole('switch', { name: 'Starfield background' }).click();
    await expect.poll(async () => (await storageGet<{ starfield: boolean }>(context, 'ts.settings'))?.starfield).toBe(false);
    await expect.poll(async () => (await storageGet<{ userName: string }>(context, 'ts.settings'))?.userName).toBe('Alex');
    await shot(page, '14-settings');
    await context.close();
    const r = await relaunch(dir, errors);
    try {
      const s = await r.worker.evaluate(async () => (await chrome.storage.local.get('ts.settings'))['ts.settings']);
      expect(s.userName).toBe('Alex');
      expect(s.starfield).toBe(false);
      const p2 = await openDash(r.context, r.extensionId, 'dashboard');
      await expect(p2.getByRole('heading', { level: 1 }).first()).toContainText('Alex');
      await expect(p2.getByRole('switch', { name: 'Starfield background' })).toHaveCount(0);
      await p2.evaluate(() => (location.hash = '#/settings'));
      await expect(p2.getByRole('switch', { name: 'Starfield background' })).toHaveAttribute('aria-checked', 'false');
    } finally {
      await r.context.close();
    }
  });

  for (const [label, value, route, read] of [
    ['Default page', 'tasks', 'settings', (s: any) => s.defaultPage],
    ['New Tab search engine', 'duckduckgo', 'settings', (s: any) => s.newTab.searchEngine],
    ['Section shown when the sidebar opens', 'notes', 'sidebar', (s: any) => s.sidebar.defaultView],
  ] as const) {
    test(`BUG-ST1 · "${label}" select saves the chosen value`, async ({ context, extensionId }) => {
      const page = await openDash(context, extensionId, route);
      await page.getByRole('combobox', { name: label }).selectOption(value);
      await expect.poll(async () => read(await storageGet<any>(context, 'ts.settings')), { timeout: 3000 }).toBe(value);
    });
  }

  test('20 · delete task requires confirmation (cancel keeps it)', async ({ context, extensionId }) => {
    const page = await openDash(context, extensionId, 'tasks');
    await addTask(page, 'Go for a run');
    await page.getByRole('button', { name: 'Actions for Go for a run' }).click();
    await page.getByRole('menuitem', { name: /Delete/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    expect((await storageGet<unknown[]>(context, 'ts.tasks')).length).toBe(1);
    await page.getByRole('button', { name: 'Actions for Go for a run' }).click();
    await page.getByRole('menuitem', { name: /Delete/ }).click();
    await confirmDialog(page, 'Delete');
    await expect.poll(async () => (await storageGet<unknown[]>(context, 'ts.tasks')).length).toBe(0);
  });

  test('20 · clear all data requires typing DELETE, then wipes storage', async ({ context, extensionId }) => {
    const page = await openDash(context, extensionId, 'tasks');
    await addTask(page, 'Go for a run');
    await page.evaluate(() => (location.hash = '#/settings?section=data'));
    await page.getByRole('button', { name: /Clear all local data|Clear all data|Delete all/i }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Clear all local data?' });
    await expect(dlg.getByRole('button', { name: 'Delete everything' })).toBeDisabled();
    await dlg.getByRole('textbox').fill('delete');
    await expect(dlg.getByRole('button', { name: 'Delete everything' })).toBeDisabled();
    await dlg.getByRole('textbox').fill('DELETE');
    await dlg.getByRole('button', { name: 'Delete everything' }).click();
    await expect.poll(async () => ((await storageGet<unknown[]>(context, 'ts.tasks')) ?? []).length).toBe(0);
    // App still usable afterwards
    await page.evaluate(() => (location.hash = '#/tasks'));
    await addTask(page, 'After clear');
  });
});
