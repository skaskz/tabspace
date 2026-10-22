import type { BrowserContext, Page } from '@playwright/test';
import { confirmDialog, expect, realErrors, shot, storageGet, storageSet, sw, test, windowsSummary } from './helpers';

type Session = { id: string; name: string; archived?: boolean; workspaceId?: string; tabs: { url: string; groupId?: string; pinned: boolean }[]; groups: { id: string; title: string; color: string; collapsed: boolean }[] };

async function createWorkspace(page: Page, name: string) {
  await page.evaluate(() => (location.hash = '#/workspaces'));
  await page.getByRole('button', { name: /^(New workspace|Create your first workspace)$/ }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New workspace' });
  await dlg.getByLabel('Name').fill(name);
  await dlg.getByRole('button', { name: 'Create workspace' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

/** Open web tabs in the dashboard's window and put them into two native groups. */
async function setupGroupedWindow(context: BrowserContext, dashboard: Page, url: (n: string) => string) {
  const w = await sw(context);
  const windowId = await dashboard.evaluate(async () => (await chrome.windows.getCurrent()).id!);
  const urls = [url('alpha'), url('beta'), url('gamma'), url('delta')];
  const ids = await w.evaluate(
    async ({ urls, windowId }) => {
      const tabs = [];
      for (const u of urls) tabs.push(await chrome.tabs.create({ url: u, windowId, active: false }));
      // wait for loads
      await new Promise((r) => setTimeout(r, 800));
      const g1 = await chrome.tabs.group({ tabIds: [tabs[0].id!, tabs[1].id!], createProperties: { windowId } });
      await chrome.tabGroups.update(g1, { title: 'Research', color: 'blue' });
      const g2 = await chrome.tabs.group({ tabIds: [tabs[2].id!], createProperties: { windowId } });
      await chrome.tabGroups.update(g2, { title: 'Build', color: 'red', collapsed: false });
      return tabs.map((t) => t.id!);
    },
    { urls, windowId },
  );
  // Close the stray about:blank tab Playwright opens at launch so "replace" has a clean window.
  for (const p of context.pages()) if (p.url() === 'about:blank') await p.close();
  await dashboard.bringToFront();
  return { windowId, ids, urls };
}

/** "Save window" now opens a picker of the window's tabs (all web tabs preselected); confirm it. */
async function saveViaPicker(page: Page, opener: 'card' | 'detail' = 'card') {
  if (opener === 'card') await page.getByRole('button', { name: 'Save window' }).click();
  else await page.getByRole('button', { name: /^(Save current window…|Update from window…)$/ }).first().click();
  const dlg = page.getByRole('dialog', { name: /^(Save tabs to|Update)/ });
  await expect(dlg).toBeVisible();
  const save = dlg.getByRole('button', { name: /^Save \d+ tabs?$/ });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dlg).toBeHidden();
}

/** With workspace tab groups on (V2.2 default), "Open" makes a tab group; the new-window restore lives in the menu. */
async function openInNewWindow(page: Page, name: string) {
  await page.getByRole('button', { name: `More ways to open ${name}` }).click();
  await page.getByRole('menuitem', { name: 'New window' }).click();
}

test.describe('workspaces & sessions', () => {
  test('9 · create workspace (persisted, listed, appears in sidebar + dashboard)', async ({ dash, open, context, errors }) => {
    const page = await dash('workspaces');
    await shot(page, '10-workspaces-empty');
    await createWorkspace(page, 'Development');
    const ws = await storageGet<{ name: string; id: string }[]>(context, 'ts.workspaces');
    expect(ws.map((w) => w.name)).toEqual(['Development']);
    await page.reload();
    await expect(page.getByRole('link', { name: 'Development', exact: true })).toBeVisible();
    const side = await open('sidepanel.html');
    await side.getByRole('tab', { name: 'Workspaces' }).click();
    await expect(side.getByText('Development')).toBeVisible();
    await page.evaluate(() => (location.hash = '#/dashboard'));
    await expect(page.getByText('Development').first()).toBeVisible();
    expect(realErrors(errors)).toEqual([]);
  });

  test('9 · empty / whitespace workspace name is rejected', async ({ dash, context }) => {
    const page = await dash('workspaces');
    await page.getByRole('button', { name: 'Create your first workspace' }).click();
    const dlg = page.getByRole('dialog', { name: 'New workspace' });
    await dlg.getByLabel('Name').fill('    ');
    await expect(dlg.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
    await dlg.getByLabel('Name').press('Enter');
    expect((await storageGet<unknown[]>(context, 'ts.workspaces')) ?? []).toEqual([]);
  });

  test('9 · rapid double-click on "Create workspace" creates exactly one', async ({ dash, context }) => {
    const page = await dash('workspaces');
    await page.getByRole('button', { name: 'Create your first workspace' }).click();
    const dlg = page.getByRole('dialog', { name: 'New workspace' });
    await dlg.getByLabel('Name').fill('Content Creation');
    await dlg.getByRole('button', { name: 'Create workspace' }).dblclick();
    await page.waitForTimeout(800);
    expect((await storageGet<unknown[]>(context, 'ts.workspaces')).length).toBe(1);
  });

  test('10/11 · save window with native groups; restore in new window recreates titles/colours', async ({ dash, context, web, errors }) => {
    const page = await dash('workspaces');
    await createWorkspace(page, 'Job Search');
    const { urls } = await setupGroupedWindow(context, page, web.url);
    await saveViaPicker(page);
    await expect(page.getByRole('status').filter({ hasText: /Saved \d+ tab/ })).toBeVisible();
    const [s] = await storageGet<Session[]>(context, 'ts.sessions');
    expect(s.tabs.map((t) => t.url)).toEqual(urls);
    expect(s.groups.map((g) => [g.title, g.color]).sort()).toEqual([['Build', 'red'], ['Research', 'blue']]);
    const byId = Object.fromEntries(s.groups.map((g) => [g.id, g.title]));
    expect(s.tabs.map((t) => (t.groupId ? byId[t.groupId] : null))).toEqual(['Research', 'Research', 'Build', null]);
    await shot(page, '11-workspaces-with-session');

    const before = await windowsSummary(context);
    // Open (new window is the default action)
    await openInNewWindow(page, 'Job Search');
    await expect(page.getByRole('status').filter({ hasText: /Opened 4 tabs in 2 groups/ })).toBeVisible();
    const after = await windowsSummary(context);
    expect(after.length).toBe(before.length + 1);
    const nw = after.find((w) => !before.some((b) => b.id === w.id))!;
    expect(nw.tabs.map((t) => t.url)).toEqual(urls);
    expect(nw.groups.map((g) => [g.title, g.color]).sort()).toEqual([['Build', 'red'], ['Research', 'blue']]);
    const gTitle = Object.fromEntries(nw.groups.map((g) => [g.id, g.title]));
    expect(nw.tabs.map((t) => gTitle[t.groupId] ?? null)).toEqual(['Research', 'Research', 'Build', null]);
    expect(realErrors(errors)).toEqual([]);
  });

  test('11 · restore into current window adds tabs + groups, keeps existing tabs', async ({ dash, context, web }) => {
    const page = await dash('workspaces');
    await createWorkspace(page, 'Job Search');
    const { windowId } = await setupGroupedWindow(context, page, web.url);
    await saveViaPicker(page);
    await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible();
    const before = (await windowsSummary(context)).find((w) => w.id === windowId)!;
    await page.getByRole('button', { name: 'More ways to open Job Search' }).click();
    await page.getByRole('menuitem', { name: 'Add to this window' }).click();
    await expect(page.getByRole('status').filter({ hasText: /Opened 4 tabs/ })).toBeVisible();
    const after = await windowsSummary(context);
    const win = after.find((w) => w.id === windowId)!;
    expect(win.tabs.length).toBe(before.tabs.length + 4);
    expect(win.groups.filter((g) => g.title === 'Research').length).toBe(2);
    expect(after.length).toBe(1);
  });

  test('11 · replace: confirm required, archives first, keeps the Tabspace tab open', async ({ dash, context, web }) => {
    const page = await dash('workspaces');
    await createWorkspace(page, 'Job Search');
    const { windowId, urls } = await setupGroupedWindow(context, page, web.url);
    await saveViaPicker(page);
    await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible();
    // Change the window: close the saved tabs, open two others
    const w = await sw(context);
    await w.evaluate(
      async ({ windowId, extra }) => {
        const tabs = await chrome.tabs.query({ windowId });
        await chrome.tabs.remove(tabs.filter((t) => (t.url ?? '').startsWith('http')).map((t) => t.id!));
        for (const u of extra) await chrome.tabs.create({ url: u, windowId, active: false });
      },
      { windowId, extra: [web.url('other-1'), web.url('other-2')] },
    );
    await page.bringToFront();
    await page.getByRole('button', { name: 'More ways to open Job Search' }).click();
    await page.getByRole('menuitem', { name: 'Replace current tabs…' }).click();
    // Cancel first: nothing happens
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('archived session');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    expect((await windowsSummary(context)).find((x) => x.id === windowId)!.tabs.some((t) => t.url.includes('other-1'))).toBe(true);
    // Now confirm
    await page.getByRole('button', { name: 'More ways to open Job Search' }).click();
    await page.getByRole('menuitem', { name: 'Replace current tabs…' }).click();
    await confirmDialog(page, 'Archive & replace');
    await expect(page.getByRole('status').filter({ hasText: /archived/ })).toBeVisible();
    expect(page.isClosed()).toBe(false);
    const win = (await windowsSummary(context)).find((x) => x.id === windowId)!;
    const http = win.tabs.filter((t) => t.url.startsWith('http')).map((t) => t.url);
    expect(http).toEqual(urls);
    expect(win.tabs.some((t) => t.url.includes('dashboard.html'))).toBe(true);
    const sessions = await storageGet<Session[]>(context, 'ts.sessions');
    const archived = sessions.find((s) => s.archived)!;
    expect(archived).toBeTruthy();
    expect(archived.tabs.map((t) => t.url)).toEqual([web.url('other-1'), web.url('other-2')]);
  });

  test('BUG-SS1 · replace targets the window the Tabspace tab is in, even if another window was focused last', async ({ dash, context, web }) => {
    const page = await dash('workspaces');
    await createWorkspace(page, 'Job Search');
    const { windowId } = await setupGroupedWindow(context, page, web.url);
    await saveViaPicker(page);
    await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible();
    // A second window, focused last (e.g. user opened a new window, then clicked back in the dashboard window via the taskbar)
    const w = await sw(context);
    const other = await w.evaluate(async (u) => (await chrome.windows.create({ url: u, focused: true })).id!, web.url('second-window'));
    await page.bringToFront();
    await page.getByRole('button', { name: 'More ways to open Job Search' }).click();
    await page.getByRole('menuitem', { name: 'Replace current tabs…' }).click();
    await confirmDialog(page, 'Archive & replace');
    await page.waitForTimeout(1500);
    const wins = await windowsSummary(context);
    const second = wins.find((x) => x.id === other);
    const mine = wins.find((x) => x.id === windowId)!;
    test.info().annotations.push({ type: 'windows', description: JSON.stringify(wins.map((x) => ({ id: x.id, n: x.tabs.length, urls: x.tabs.map((t) => t.url.replace(/^.*\/p\//, '')) }))) });
    // Expectation from the UI copy ("Your current window's tabs ... The Tabspace tab stays open"):
    // the window holding the Tabspace tab is replaced, the other window is untouched.
    expect(second?.tabs.map((t) => t.url)).toEqual([web.url('second-window')]);
    expect(mine.tabs.filter((t) => t.url.startsWith('http')).length).toBe(4);
  });

  test('20 · delete workspace requires confirmation; its data is kept but unassigned', async ({ dash, context }) => {
    await storageSet(context, {
      'ts.workspaces': [{ id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 1, updatedAt: 1 }],
      'ts.tasks': [{ id: 't1', title: 'Finish AI automation script', done: false, priority: 'none', subtasks: [], order: 0, workspaceId: 'w1', createdAt: 1, updatedAt: 1 }],
      'ts.notes': [{ id: 'n1', title: 'Plan', content: 'x', tags: [], favorite: false, workspaceId: 'w1', createdAt: 1, updatedAt: 1 }],
      'ts.bookmarks': [{ id: 'b1', url: 'https://github.com/', title: 'GitHub', tags: [], favorite: false, workspaceId: 'w1', createdAt: 1, updatedAt: 1 }],
      'ts.sessions': [{ id: 's1', name: 'S', workspaceId: 'w1', tabs: [{ id: 'x', url: 'https://example.com/', title: 'e', pinned: false }], groups: [], createdAt: 1, updatedAt: 1 }],
    });
    const page = await dash('workspaces');
    await page.getByRole('button', { name: 'Actions for Development' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('1 task');
    await expect(dlg).toContainText('kept');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    expect((await storageGet<unknown[]>(context, 'ts.workspaces')).length).toBe(1);
    await page.getByRole('button', { name: 'Actions for Development' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await confirmDialog(page, 'Delete workspace');
    await expect.poll(async () => (await storageGet<unknown[]>(context, 'ts.workspaces')).length).toBe(0);
    for (const key of ['ts.tasks', 'ts.notes', 'ts.bookmarks', 'ts.sessions']) {
      const list = await storageGet<{ workspaceId?: string }[]>(context, key);
      expect(list.length, key).toBe(1);
      expect(list[0].workspaceId, key).toBeUndefined();
    }
  });

  test('20 · delete saved session requires confirmation', async ({ dash, context }) => {
    await storageSet(context, {
      'ts.sessions': [{ id: 's1', name: 'Morning tabs', tabs: [{ id: 'x', url: 'https://example.com/', title: 'e', pinned: false }], groups: [], createdAt: 1, updatedAt: 1 }],
    });
    const page = await dash('tabs');
    await page.getByRole('tab', { name: /Saved sessions/ }).click();
    await page.getByRole('button', { name: 'Actions for Morning tabs' }).click();
    await page.getByRole('menuitem', { name: /Delete/ }).click();
    await confirmDialog(page, 'Delete');
    await expect.poll(async () => (await storageGet<unknown[]>(context, 'ts.sessions')).length).toBe(0);
  });

  test('BUG-WS1 · workspace card "Actions" menu items are clickable (not covered by the card’s Save window button)', async ({ dash, context }) => {
    await storageSet(context, { 'ts.workspaces': [{ id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 1, updatedAt: 1 }] });
    const page = await dash('workspaces');
    await page.getByRole('button', { name: 'Actions for Development' }).click();
    await page.getByRole('menuitem', { name: 'Rename / change icon' }).click({ timeout: 4000 });
    await expect(page.getByRole('dialog', { name: 'Edit workspace' })).toBeVisible({ timeout: 2000 });
  });

  test('rename workspace shows everywhere (grid, detail, sidebar, task details)', async ({ dash, open, context }) => {
    await storageSet(context, {
      'ts.workspaces': [{ id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 1, updatedAt: 1 }],
      'ts.tasks': [{ id: 't1', title: 'Finish AI automation script', done: false, priority: 'none', subtasks: [], order: 0, workspaceId: 'w1', createdAt: 1, updatedAt: 1 }],
    });
    const side = await open('sidepanel.html');
    await side.getByRole('tab', { name: 'Workspaces' }).click();
    await expect(side.getByText('Development')).toBeVisible();
    const page = await dash('workspaces');
    await page.getByRole('button', { name: 'Actions for Development' }).click();
    // Regression for BUG-WS1: the menu item must be clickable with the mouse (not covered by the card's buttons).
    await page.getByRole('menuitem', { name: 'Rename / change icon' }).click();
    const dlg = page.getByRole('dialog', { name: 'Edit workspace' });
    await dlg.getByLabel('Name').fill('Dev & Tools');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('link', { name: 'Dev & Tools' })).toBeVisible();
    await expect(side.getByText('Dev & Tools')).toBeVisible();
    await page.evaluate(() => (location.hash = '#/tasks?id=t1'));
    await expect(page.getByRole('complementary', { name: 'Task details' }).getByRole('combobox', { name: 'Workspace' })).toContainText('Dev & Tools');
  });
});

test.describe('V2 · editing saved tabs', () => {
  test('acceptance · five tabs, remove two, add one URL, reorder → reopening opens exactly those four in order', async ({ dash, context, web, errors }) => {
    const page = await dash('workspaces');
    await createWorkspace(page, 'Acceptance');
    const w = await sw(context);
    const windowId = await page.evaluate(async () => (await chrome.windows.getCurrent()).id!);
    const names = ['one', 'two', 'three', 'four', 'five'];
    await w.evaluate(
      async ({ urls, windowId }) => {
        for (const u of urls) await chrome.tabs.create({ url: u, windowId, active: false });
        for (let i = 0; i < 100; i++) {
          const tabs = await chrome.tabs.query({ windowId });
          // wait until every page has loaded and shows its real <title> (one…five), not a URL placeholder
          const web = tabs.filter((t) => t.url?.startsWith('http'));
          if (web.length === urls.length && web.every((t) => t.status === 'complete' && t.title && urls.some((u) => u.endsWith(`/p/${t.title}`)))) break;
          await new Promise((r) => setTimeout(r, 100));
        }
      },
      { urls: names.map(web.url), windowId },
    );
    await page.bringToFront();

    // E: the picker lists the window's tabs; save all five web tabs
    await page.getByRole('button', { name: 'Save window' }).click();
    const picker = page.getByRole('dialog', { name: 'Save tabs to “Acceptance”' });
    for (const n of names) await expect(picker.getByRole('checkbox', { name: `Save ${n}` })).toHaveAttribute('aria-checked', 'true');
    await picker.getByRole('button', { name: 'Select none' }).click();
    await expect(picker.getByRole('button', { name: 'Save 0 tabs' })).toBeDisabled();
    await picker.getByRole('button', { name: 'Select all' }).click();
    await picker.getByRole('button', { name: 'Save 5 tabs' }).click();
    await expect(picker).toBeHidden();

    // A: the detail view lists every saved tab
    await page.getByRole('link', { name: 'Acceptance', exact: true }).click();
    const list = page.getByRole('list', { name: 'Saved tabs, in the order they open' });
    await expect(list.getByRole('listitem')).toHaveCount(5);

    // B: remove two (live tabs untouched)
    await page.getByRole('button', { name: 'Remove two from saved tabs' }).click();
    await page.getByRole('button', { name: 'Remove four from saved tabs' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(3);

    // C: add one URL (and the duplicate warning)
    await page.getByLabel('URL to add').fill(web.url('six'));
    await page.getByRole('button', { name: 'Add URL' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await page.getByLabel('URL to add').fill(web.url('one'));
    await page.getByRole('button', { name: 'Add URL' }).click();
    await confirmDialog(page, 'Cancel');
    await expect(list.getByRole('listitem')).toHaveCount(4);

    // G: reorder with the keyboard-accessible buttons: one, three, five, six -> one, six, three, five
    await page.getByRole('button', { name: 'Move 127.0.0.1 up' }).click();
    await page.getByRole('button', { name: 'Move 127.0.0.1 up' }).click();
    await expect.poll(async () => (await storageGet<Session[]>(context, 'ts.sessions'))[0].tabs.map((t) => t.url)).toEqual([web.url('one'), web.url('six'), web.url('three'), web.url('five')]);
    // ...and with drag and drop: drop "five" on the top half of "one" -> five, one, six, three
    await list.getByRole('listitem').filter({ hasText: '/p/five' }).dragTo(list.getByRole('listitem').filter({ hasText: '/p/one' }), { targetPosition: { x: 40, y: 4 } });
    const expected = [web.url('five'), web.url('one'), web.url('six'), web.url('three')];
    await expect.poll(async () => (await storageGet<Session[]>(context, 'ts.sessions'))[0].tabs.map((t) => t.url)).toEqual(expected);

    const sessions = await storageGet<Session[]>(context, 'ts.sessions');
    expect(sessions).toHaveLength(1);
    expect((await storageGet<unknown[]>(context, 'ts.workspaces')).length).toBe(1);
    const before = await windowsSummary(context);
    const mine = before.find((x) => x.id === windowId)!;
    expect(mine.tabs.filter((t) => t.url.startsWith('http')).map((t) => t.url)).toEqual(names.map(web.url));

    // Reopen the workspace in a new window -> exactly the four intended tabs, in order
    await openInNewWindow(page, 'Acceptance');
    await expect(page.getByRole('status').filter({ hasText: /Opened 4 tabs/ })).toBeVisible();
    const after = await windowsSummary(context);
    const nw = after.find((x) => !before.some((b) => b.id === x.id))!;
    expect(nw.tabs.map((t) => t.url)).toEqual(expected);
    await shot(page, 'v2-saved-tabs-editing');
    expect(realErrors(errors)).toEqual([]);
  });

  test('update from current window: replace keeps the previous list in History, merge adds only new tabs', async ({ dash, context, web }) => {
    const page = await dash('workspaces');
    await createWorkspace(page, 'Research');
    await setupGroupedWindow(context, page, web.url);
    await saveViaPicker(page);
    await page.getByRole('link', { name: 'Research', exact: true }).click();
    await page.getByRole('button', { name: 'Remove gamma from saved tabs' }).click();
    // merge: only gamma is new
    await page.getByRole('button', { name: 'Update from window…' }).click();
    let dlg = page.getByRole('dialog', { name: 'Update “Research” from this window' });
    await expect(dlg.getByRole('tab', { name: 'Add to saved tabs' })).toHaveAttribute('aria-selected', 'true');
    await dlg.getByRole('button', { name: /^Save \d+ tabs$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /Added 1 tab .*3 already saved/ })).toBeVisible();
    let [s] = await storageGet<Session[]>(context, 'ts.sessions');
    expect(s.tabs.map((t) => t.url)).toEqual([web.url('alpha'), web.url('beta'), web.url('delta'), web.url('gamma')]);
    // gamma keeps its native group (Build) info
    const build = s.groups.find((g) => g.title === 'Build')!;
    expect(s.tabs[3].groupId).toBe(build.id);
    // replace with only alpha selected
    await page.getByRole('button', { name: 'Update from window…' }).click();
    dlg = page.getByRole('dialog', { name: 'Update “Research” from this window' });
    await dlg.getByRole('tab', { name: 'Replace saved tabs' }).click();
    await dlg.getByRole('button', { name: 'Select none' }).click();
    await dlg.getByRole('checkbox', { name: 'Save alpha' }).click();
    await dlg.getByRole('button', { name: 'Save 1 tab' }).click();
    await expect(page.getByRole('status').filter({ hasText: /previous list kept in History/ })).toBeVisible();
    const all = await storageGet<Session[]>(context, 'ts.sessions');
    expect(all).toHaveLength(2);
    [s] = all;
    expect(s.tabs.map((t) => t.url)).toEqual([web.url('alpha')]);
    expect(s.groups.map((g) => g.title)).toEqual(['Research']);
    await expect(page.getByRole('heading', { name: 'History (1)' })).toBeVisible();
  });
});
