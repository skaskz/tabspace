import { expect, realErrors, relaunch, storageGet, storageSet, sw, test } from './helpers';

type Ctx = { contextType: string; windowId: number; documentUrl?: string };

async function sidePanelContexts(context: import('@playwright/test').BrowserContext): Promise<Ctx[]> {
  const w = await sw(context);
  return w.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.SIDE_PANEL] })) as unknown as Ctx[]);
}

test.describe('side panel & popup', () => {
  test('BUG-SP1 · popup reports "Sidebar is open" while the panel is open', async ({ context, open }) => {
    // Chromium 156 reports SIDE_PANEL contexts with windowId -1; the open state comes from ts.session.openPanels.
    const popup = await open('popup.html');
    await popup.getByRole('button', { name: 'Open Sidebar' }).click();
    await expect.poll(async () => (await sidePanelContexts(context)).length, { timeout: 8000 }).toBeGreaterThan(0);
    const p2 = await open('popup.html');
    await expect(p2.getByText('Sidebar is open')).toBeVisible();
  });

  test('4 · sidepanel.html works as a tab: sections switch, task added in panel shows on dashboard', async ({ open, dash, errors }) => {
    const side = await open('sidepanel.html');
    await side.setViewportSize({ width: 360, height: 900 });
    await side.getByRole('tab', { name: 'Tasks' }).click();
    const panel = side.getByRole('tabpanel');
    await panel.getByRole('button', { name: 'Add task' }).click();
    const input = panel.getByRole('textbox', { name: 'New task title' });
    await input.fill('Push Tabspace to GitHub');
    await input.press('Enter');
    await expect(panel.getByText('Push Tabspace to GitHub')).toBeVisible();
    const page = await dash('tasks');
    await expect(page.getByText('Push Tabspace to GitHub')).toBeVisible();
    // complete on the dashboard -> panel updates live
    await page.getByRole('checkbox', { name: 'Complete "Push Tabspace to GitHub"' }).click();
    await side.bringToFront();
    await expect(panel.getByRole('checkbox', { name: /Push Tabspace to GitHub/ })).toHaveAttribute('aria-checked', 'true').catch(async () => {
      await expect(panel.getByText('Push Tabspace to GitHub')).toBeHidden();
    });
    // complete in the panel -> dashboard updates live (reverse direction)
    if (!(await panel.getByRole('textbox', { name: 'New task title' }).isVisible())) await panel.getByRole('button', { name: 'Add task' }).click();
    await panel.getByRole('textbox', { name: 'New task title' }).fill('Go for a run');
    await panel.getByRole('textbox', { name: 'New task title' }).press('Enter');
    await panel.getByRole('checkbox', { name: 'Mark "Go for a run" done' }).click();
    await page.bringToFront();
    await page.getByRole('tab', { name: /Completed/ }).click();
    await expect(page.getByText('Go for a run')).toBeVisible();
    expect(realErrors(errors)).toEqual([]);
  });

  test('4 · popup "Open Sidebar" opens the real Chrome side panel (getContexts / onOpened)', async ({ context, open }) => {
    const w = await sw(context);
    await w.evaluate(() => {
      (globalThis as unknown as { __opened: number[] }).__opened = [];
      const sp = chrome.sidePanel as unknown as { onOpened?: { addListener(cb: (i: { windowId: number }) => void): void } };
      sp.onOpened?.addListener((i: { windowId: number }) => (globalThis as unknown as { __opened: number[] }).__opened.push(i.windowId));
    });
    const popup = await open('popup.html');
    await expect(popup.getByText('Sidebar is ready')).toBeVisible();
    const wid = await popup.evaluate(async () => (await chrome.windows.getCurrent()).id);
    await popup.getByRole('button', { name: 'Open Sidebar' }).click();
    await expect.poll(async () => (await sidePanelContexts(context)).length, { timeout: 8000 }).toBeGreaterThan(0);
    const ctxs = await sidePanelContexts(context);
    test.info().annotations.push({ type: 'getContexts', description: JSON.stringify(ctxs) + ' popupWindow=' + wid });
    expect(ctxs[0].documentUrl).toContain('sidepanel.html');
    const opened = await w.evaluate(() => (globalThis as unknown as { __opened: number[] }).__opened);
    test.info().annotations.push({ type: 'onOpened', description: JSON.stringify(opened) });
    // The real panel page is a Playwright page too — make sure it rendered.
    const panelPage = context.pages().find((p) => p.url().includes('sidepanel.html'));
    if (panelPage) await expect(panelPage.getByRole('navigation', { name: 'Sidebar sections' })).toBeVisible();
  });

  test('4 · popup "Close Sidebar" closes the open panel', async ({ context, open }) => {
    const popup = await open('popup.html');
    await popup.getByRole('button', { name: 'Open Sidebar' }).click();
    await expect.poll(async () => (await sidePanelContexts(context)).length, { timeout: 8000 }).toBeGreaterThan(0);
    // popup calls window.close() after opening; as a tab it may close itself — reopen
    const p2 = popup.isClosed() ? await open('popup.html') : popup;
    await expect(p2.getByRole('button', { name: 'Close Sidebar' })).toBeEnabled();
    await p2.getByRole('button', { name: 'Close Sidebar' }).click();
    await expect.poll(async () => (await sidePanelContexts(context)).length, { timeout: 8000 }).toBe(0);
  });

  test('5/6/7 · disable from popup -> getOptions enabled:false, data intact; re-enable from popup works', async ({ context, open }) => {
    await storageSet(context, {
      'ts.tasks': [{ id: 't1', title: 'Go for a run', done: false, priority: 'none', subtasks: [], order: 0, createdAt: 1, updatedAt: 1 }],
      'ts.notes': [{ id: 'n1', title: 'Ideas', content: 'Edit YouTube Short', tags: [], favorite: false, createdAt: 1, updatedAt: 1 }],
    });
    const popup = await open('popup.html');
    await popup.getByRole('button', { name: 'More sidebar options' }).click(); // Disable lives behind the overflow (UX V2 #7)
    await popup.getByRole('button', { name: 'Disable Sidebar' }).click();
    await expect(popup.getByText('Sidebar is disabled')).toBeVisible();
    const w = await sw(context);
    await expect.poll(async () => (await w.evaluate(() => chrome.sidePanel.getOptions({}))).enabled, { timeout: 5000 }).toBe(false);
    expect((await storageGet<{ sidebar: { enabled: boolean } }>(context, 'ts.settings')).sidebar.enabled).toBe(false);
    expect((await storageGet<unknown[]>(context, 'ts.tasks')).length).toBe(1);
    expect((await storageGet<unknown[]>(context, 'ts.notes')).length).toBe(1);
    // Open/Close buttons hidden while disabled
    await expect(popup.getByRole('button', { name: 'Open Sidebar' })).toHaveCount(0);
    // Opening a disabled panel must fail
    const openErr = await w.evaluate(async () => {
      const [win] = await chrome.windows.getAll();
      try {
        await chrome.sidePanel.open({ windowId: win.id! });
        return 'opened';
      } catch (e) {
        return String(e);
      }
    });
    expect(openErr).not.toBe('opened');
    // Re-enable
    await popup.getByRole('button', { name: 'Enable Sidebar' }).click();
    await expect.poll(async () => (await w.evaluate(() => chrome.sidePanel.getOptions({}))).enabled, { timeout: 5000 }).toBe(true);
    expect((await w.evaluate(() => chrome.sidePanel.getOptions({}))).path).toBe('sidepanel.html');
    await expect(popup.getByRole('button', { name: 'Open Sidebar' })).toBeVisible();
    await popup.getByRole('button', { name: 'Open Sidebar' }).click();
    await expect.poll(async () => (await sidePanelContexts(context)).length, { timeout: 8000 }).toBeGreaterThan(0);
  });

  test('5 · disabling while the panel is open closes it', async ({ context, open }) => {
    const popup = await open('popup.html');
    await popup.getByRole('button', { name: 'Open Sidebar' }).click();
    await expect.poll(async () => (await sidePanelContexts(context)).length, { timeout: 8000 }).toBeGreaterThan(0);
    const p2 = popup.isClosed() ? await open('popup.html') : popup;
    await p2.getByRole('button', { name: 'More sidebar options' }).click(); // Disable lives behind the overflow (UX V2 #7)
    await p2.getByRole('button', { name: 'Disable Sidebar' }).click();
    await expect.poll(async () => (await sidePanelContexts(context)).length, { timeout: 8000 }).toBe(0);
  });

  test('5 · disable from the Chrome Sidebar settings page; state survives a browser restart', async ({ context, dash, dir, errors }) => {
    const page = await dash('sidebar');
    const sw1 = page.getByRole('switch', { name: 'Enable sidebar' });
    await sw1.click();
    await expect(sw1).toHaveAttribute('aria-checked', 'false');
    const w = await sw(context);
    await expect.poll(async () => (await w.evaluate(() => chrome.sidePanel.getOptions({}))).enabled).toBe(false);
    await context.close();
    const r = await relaunch(dir, errors);
    try {
      const w2 = r.worker;
      await expect.poll(async () => (await w2.evaluate(() => chrome.sidePanel.getOptions({}))).enabled, { timeout: 8000 }).toBe(false);
    } finally {
      await r.context.close();
    }
  });

  test('4 · section visibility setting hides a section in the side panel', async ({ open, dash }) => {
    const page = await dash('sidebar');
    await page.getByRole('switch', { name: 'Show Notes in the sidebar' }).click();
    const side = await open('sidepanel.html');
    await expect(side.getByRole('tab', { name: 'Tasks' })).toBeVisible();
    await expect(side.getByRole('tab', { name: 'Notes' })).toHaveCount(0);
  });
});
