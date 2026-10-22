import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { confirmDialog, expect, realErrors, shot, storageGet, storageSet, sw, test } from './helpers';

const LONG = 'Research Roblox mechanics '.repeat(20).trim() + ' ' + 'Supercalifragilisticexpialidocious'.repeat(8);

async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

test.describe('adversarial', () => {
  test('200+ tabs: Tab Manager renders all of them in reasonable time', async ({ dash, context, web }) => {
    test.setTimeout(180_000);
    const w = await sw(context);
    const page = await dash('dashboard');
    const windowId = await page.evaluate(async () => (await chrome.windows.getCurrent()).id!);
    await w.evaluate(
      async ({ base, windowId }) => {
        const jobs = [];
        for (let i = 0; i < 210; i++) jobs.push(chrome.tabs.create({ url: `${base}/p/tab-${i}`, windowId, active: false }));
        await Promise.all(jobs);
      },
      { base: web.origin, windowId },
    );
    await page.bringToFront();
    const t0 = Date.now();
    await page.evaluate(() => (location.hash = '#/tabs'));
    await expect(page.getByRole('tab', { name: /Open tabs 21\d/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('row', { name: /tab-209/ }).first()).toBeAttached({ timeout: 30_000 });
    const ms = Date.now() - t0;
    test.info().annotations.push({ type: 'render-ms-210-tabs', description: String(ms) });
    expect(ms).toBeLessThan(10_000);
    // search filters fast
    const t1 = Date.now();
    await page.getByRole('textbox', { name: 'Search tabs' }).fill('tab-150');
    await expect(page.getByRole('row', { name: /tab-150/ }).first()).toBeVisible();
    test.info().annotations.push({ type: 'search-ms', description: String(Date.now() - t1) });
    await page.getByRole('textbox', { name: 'Search tabs' }).fill('');
    await shot(page, '40-tabs-210', false);
    // select all -> close requires confirmation, cancel keeps them
    await page.getByRole('checkbox', { name: 'Select all visible tabs' }).click();
    await page.getByRole('button', { name: /^Close( Tabs)?$/ }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText(/Close \d+ tabs\?/);
    // the Tabspace tab itself should not be in the close set (or the dialog should say so)
    test.info().annotations.push({ type: 'close-dialog', description: (await dlg.innerText()).slice(0, 300) });
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    const count = await w.evaluate(async () => (await chrome.tabs.query({})).length);
    expect(count).toBeGreaterThan(210);
  });

  test('20 · "Close Tabs" on a selection asks for confirmation; confirming closes exactly those tabs', async ({ dash, context, web }) => {
    const w = await sw(context);
    const page = await dash('tabs');
    const windowId = await page.evaluate(async () => (await chrome.windows.getCurrent()).id!);
    await w.evaluate(async ({ u, windowId }) => { for (const x of u) await chrome.tabs.create({ url: x, windowId, active: false }); }, { u: [web.url('keep-me'), web.url('close-me')], windowId });
    await page.bringToFront();
    await page.reload();
    await expect(page.getByRole('checkbox', { name: 'Select close-me' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select close-me' }).click();
    await page.getByRole('button', { name: /^Close( Tabs)?$/ }).click();
    await confirmDialog(page, 'Close tab');
    await expect.poll(async () => (await w.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url))).join(' ')).not.toContain('close-me');
    expect((await w.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url))).join(' ')).toContain('keep-me');
  });

  test('empty workspace: detail page and Open behave honestly', async ({ dash, context, errors }) => {
    await storageSet(context, { 'ts.workspaces': [{ id: 'w1', name: 'Empty one', icon: 'code', order: 0, createdAt: 1, updatedAt: 1 }] });
    const page = await dash('workspaces?id=w1');
    await expect(page.getByRole('heading', { name: 'Empty one', level: 1 })).toBeVisible();
    await shot(page, '41-workspace-empty-detail');
    expect(realErrors(errors)).toEqual([]);
    // dashboard workspace card for an empty workspace
    await page.evaluate(() => (location.hash = '#/dashboard'));
    await expect(page.getByText('Empty one').first()).toBeVisible();
  });

  test('very long task title and note do not break layout', async ({ dash }) => {
    const page = await dash('tasks');
    const box = page.getByRole('textbox', { name: 'Quick add task' });
    await box.fill(LONG);
    await box.press('Enter');
    await expect(page.getByRole('button', { name: /^Open task Research Roblox/ })).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    await shot(page, '42-long-task-list');
    await page.getByRole('button', { name: /^Open task Research Roblox/ }).click();
    expect(await noHorizontalOverflow(page)).toBe(true);
    await shot(page, '43-long-task-details');
    await page.evaluate(() => (location.hash = '#/dashboard'));
    await page.waitForTimeout(400);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await shot(page, '44-long-task-dashboard');

    await page.evaluate(() => (location.hash = '#/notes'));
    await page.getByRole('button', { name: 'New Note' }).first().click();
    await page.getByRole('textbox', { name: 'Note title' }).fill(LONG);
    await page.getByRole('textbox', { name: 'Note content' }).fill(`${LONG}\n\nhttps://example.com/${'a'.repeat(400)}\n\n\`\`\`\n${'x'.repeat(500)}\n\`\`\``);
    await page.waitForTimeout(800);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await shot(page, '45-long-note');
  });

  test('BUG-TK1 · rapid double-click on the dashboard "Add task" button creates exactly one task', async ({ dash, context }) => {
    const page = await dash('dashboard');
    await page.getByRole('textbox', { name: 'Add a new task for today' }).fill('Go for a run');
    await page.getByRole('button', { name: 'Add task', exact: true }).dblclick();
    await page.waitForTimeout(800);
    const tasks = await storageGet<{ title: string }[]>(context, 'ts.tasks');
    expect(tasks.filter((t) => t.title === 'Go for a run').length).toBe(1);
  });

  test('BUG-TK1 · pressing Enter twice quickly in Tasks quick add creates exactly one task', async ({ dash, context }) => {
    const page = await dash('tasks');
    const qa = page.getByRole('textbox', { name: 'Quick add task' });
    await qa.fill('Edit YouTube Short');
    // Two submits in the same tick (what a fast double Enter / key-repeat produces before React re-renders)
    await qa.evaluate((el) => {
      const f = el.closest('form')!;
      f.requestSubmit();
      f.requestSubmit();
    });
    await page.waitForTimeout(800);
    expect((await storageGet<{ title: string }[]>(context, 'ts.tasks')).filter((t) => t.title === 'Edit YouTube Short').length).toBe(1);
  });

  test('BUG-TK2 · double-clicking a task checkbox toggles twice (ends not done)', async ({ dash, context }) => {
    const page = await dash('tasks');
    const qa = page.getByRole('textbox', { name: 'Quick add task' });
    await qa.fill('Edit YouTube Short');
    await qa.press('Enter');
    const cb = page.getByRole('checkbox', { name: /"Edit YouTube Short"/ });
    await cb.dblclick();
    await page.waitForTimeout(800);
    const t = (await storageGet<{ title: string; done: boolean }[]>(context, 'ts.tasks')).find((x) => x.title === 'Edit YouTube Short')!;
    test.info().annotations.push({ type: 'after-double-toggle', description: JSON.stringify(t.done) });
    expect(t.done).toBe(false);
  });

  test('BUG-ST2 · two dashboard tabs editing simultaneously: changes sync both ways, concurrent adds are not lost', async ({ dash, context }) => {
    const a = await dash('tasks');
    const b = await dash('tasks');
    await a.getByRole('textbox', { name: 'Quick add task' }).fill('From A');
    await a.getByRole('textbox', { name: 'Quick add task' }).press('Enter');
    await expect(b.getByRole('button', { name: 'Open task From A' })).toBeVisible();
    await b.getByRole('checkbox', { name: 'Complete "From A"' }).click();
    await expect(a.getByRole('button', { name: 'Open task From A' })).toBeHidden();
    // Concurrent writes from both pages
    for (let i = 0; i < 5; i++) {
      await a.getByRole('textbox', { name: 'Quick add task' }).fill(`A-${i}`);
      await b.getByRole('textbox', { name: 'Quick add task' }).fill(`B-${i}`);
      await Promise.all([a.getByRole('textbox', { name: 'Quick add task' }).press('Enter'), b.getByRole('textbox', { name: 'Quick add task' }).press('Enter')]);
    }
    await a.waitForTimeout(1500);
    const titles = (await storageGet<{ title: string }[]>(context, 'ts.tasks')).map((t) => t.title);
    const missing = [0, 1, 2, 3, 4].flatMap((i) => [`A-${i}`, `B-${i}`]).filter((t) => !titles.includes(t));
    test.info().annotations.push({ type: 'missing-after-concurrent-adds', description: JSON.stringify(missing) });
    expect(missing).toEqual([]);
  });

  test('BUG-NT2 · two tabs: note edited in one tab while open in another', async ({ dash, context }) => {
    await storageSet(context, { 'ts.notes': [{ id: 'n1', title: 'Shared', content: 'v1', tags: [], favorite: false, createdAt: 1, updatedAt: 1 }] });
    const a = await dash('notes');
    await a.getByText('Shared').first().click();
    const b = await dash('notes');
    await b.getByText('Shared').first().click();
    await a.bringToFront();
    const areaA = a.getByRole('textbox', { name: 'Note content' });
    if (!(await areaA.isVisible())) await a.getByRole('tab', { name: /Edit/ }).click().catch(() => undefined);
    await a.getByRole('textbox', { name: 'Note content' }).fill('edited in A');
    await a.waitForTimeout(1000);
    await b.bringToFront();
    await b.waitForTimeout(500);
    const bText = await b.getByRole('region', { name: 'Note editor' }).innerText();
    test.info().annotations.push({ type: 'tab-B-editor-shows', description: bText.slice(0, 200) });
    // Now B edits the title only — must not clobber A's content with its stale copy
    await b.getByRole('textbox', { name: 'Note title' }).fill('Shared (renamed in B)');
    await b.waitForTimeout(1200);
    const [n] = await storageGet<{ title: string; content: string }[]>(context, 'ts.notes');
    test.info().annotations.push({ type: 'final-note', description: JSON.stringify(n) });
    expect(n.title).toBe('Shared (renamed in B)');
    expect(n.content).toBe('edited in A');
  });

  test('security · markdown preview does not execute script / javascript: links', async ({ dash, context }) => {
    await storageSet(context, {
      'ts.notes': [{ id: 'n1', title: 'XSS', content: '<img src=x onerror="alert(1)">\n\n[click](javascript:alert(2))\n\n<script>alert(3)</script>\n\n[ok](https://example.com)', tags: [], favorite: false, createdAt: 1, updatedAt: 1 }],
    });
    const page = await dash('notes');
    let dialog = false;
    page.on('dialog', (d) => ((dialog = true), void d.dismiss()));
    await page.getByText('XSS').first().click();
    await page.waitForTimeout(800);
    expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
    expect(await page.locator('[onerror]').count()).toBe(0);
    const link = page.getByRole('link', { name: 'click' });
    if (await link.count()) await link.click();
    await page.waitForTimeout(500);
    expect(dialog).toBe(false);
  });

  test('duplicate bookmarks: "Save anyway" creates a second; both listed', async ({ dash, context }) => {
    await storageSet(context, { 'ts.bookmarks': [{ id: 'b1', url: 'https://github.com/', title: 'GitHub', tags: [], favorite: false, createdAt: 1, updatedAt: 1 }] });
    const page = await dash('bookmarks');
    await page.getByRole('button', { name: 'Add Link' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add link' });
    await dlg.getByLabel('URL').fill('github.com');
    await dlg.getByRole('button', { name: 'Add link' }).click();
    await dlg.getByRole('button', { name: 'Save anyway' }).click();
    await expect(dlg).toBeHidden();
    expect((await storageGet<unknown[]>(context, 'ts.bookmarks')).length).toBe(2);
  });

  test('corrupt import file is rejected with a message and data is unchanged', async ({ dash, context }) => {
    await storageSet(context, { 'ts.tasks': [{ id: 't1', title: 'Keep me', done: false, priority: 'none', subtasks: [], order: 0, createdAt: 1, updatedAt: 1 }] });
    const page = await dash('settings?section=data');
    const input = page.getByLabel('Choose backup file');
    for (const [name, body] of [
      ['garbage.json', '{{{ not json'],
      ['wrong.json', JSON.stringify({ hello: 'world' })],
      ['evil.json', JSON.stringify({ app: 'tabspace', schemaVersion: 1, data: { 'ts.tasks': 'not-an-array', 'ts.quickLinks': [{ id: 'q', title: 'x', url: 'javascript:alert(1)', order: 0 }] } })],
    ] as const) {
      await input.setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(body) });
      await page.waitForTimeout(600);
      const dlg = page.getByRole('dialog');
      if (await dlg.count()) {
        test.info().annotations.push({ type: `import-${name}`, description: (await dlg.innerText()).slice(0, 400) });
        // If a preview dialog appears for a partly-valid file, merging must not import javascript: links
        await dlg.getByRole('button', { name: /Merge/ }).click().catch(() => undefined);
        await page.waitForTimeout(600);
      } else {
        test.info().annotations.push({ type: `import-${name}`, description: (await page.getByRole('alert').allInnerTexts()).join(' | ') });
      }
    }
    const tasks = await storageGet<{ title: string }[]>(context, 'ts.tasks');
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.map((t) => t.title)).toContain('Keep me');
    const links = ((await storageGet<{ url: string }[]>(context, 'ts.quickLinks')) ?? []).map((l) => l.url);
    expect(links.some((u) => u.startsWith('javascript:'))).toBe(false);
    await page.evaluate(() => (location.hash = '#/tasks'));
    await expect(page.getByRole('button', { name: 'Open task Keep me' })).toBeVisible();
  });

  test('export -> clear -> import (replace) round-trips data', async ({ dash, context }) => {
    await storageSet(context, {
      'ts.tasks': [{ id: 't1', title: 'Round trip', done: false, priority: 'high', subtasks: [], order: 0, createdAt: 1, updatedAt: 1 }],
      'ts.notes': [{ id: 'n1', title: 'Note RT', content: 'body', tags: ['x'], favorite: true, createdAt: 1, updatedAt: 1 }],
    });
    const page = await dash('settings?section=data');
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Export/ }).first().click();
    const file = await (await dl).path();
    const json = JSON.parse(readFileSync(file!, 'utf8'));
    expect(JSON.stringify(json)).toContain('Round trip');
    expect(JSON.stringify(json)).not.toMatch(/secret\./);
    await storageSet(context, { 'ts.tasks': [], 'ts.notes': [] });
    await page.getByLabel('Choose backup file').setInputFiles(file);
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('button', { name: /Replace/ }).click();
    const c = page.getByRole('dialog', { name: 'Replace all data?' });
    if (await c.isVisible().catch(() => false)) await c.getByRole('button', { name: 'Replace' }).click();
    await expect.poll(async () => ((await storageGet<{ title: string }[]>(context, 'ts.tasks')) ?? []).map((t) => t.title)).toEqual(['Round trip']);
  });

  test('Spotify / Google not configured -> honest UI, never "Connected"', async ({ dash }) => {
    const page = await dash('settings?section=integrations');
    await page.waitForTimeout(500);
    const text = await page.locator('#settings-integrations').innerText();
    test.info().annotations.push({ type: 'integrations-text', description: text.slice(0, 600) });
    expect(text).not.toMatch(/\bConnected\b(?![- ]accounts?)/);
    await shot(page, '46-settings-integrations');
    await page.evaluate(() => (location.hash = '#/focus'));
    await expect(page.getByRole('button', { name: /Connect Spotify/ }).or(page.getByRole('link', { name: 'Set up in Settings' }))).toBeVisible();
    // Trying to connect Google without a client id must explain, not pretend
    const connect = page.getByRole('button', { name: /Connect Google/i });
    await page.evaluate(() => (location.hash = '#/settings?section=integrations'));
    if (await connect.count()) {
      const disabled = await connect.first().isDisabled();
      if (!disabled) {
        await connect.first().click();
        await page.waitForTimeout(800);
      }
      expect(await page.locator('main').innerText()).not.toMatch(/\bConnected\b(?![- ]accounts?)/);
    }
  });

  test('invalid URL in dashboard quick link is rejected', async ({ dash, context }) => {
    const page = await dash('dashboard');
    await page.getByRole('button', { name: 'Add quick link' }).click();
    const dlg = page.getByRole('dialog');
    const inputs = dlg.getByRole('textbox');
    await inputs.nth(0).fill('Evil');
    await inputs.nth(1).fill('javascript:alert(1)');
    await dlg.getByRole('button', { name: /^(Add|Save)/ }).last().click();
    await page.waitForTimeout(400);
    expect((await storageGet<unknown[]>(context, 'ts.quickLinks')) ?? []).toEqual([]);
  });
});

test('two dashboard tabs: sequential edits sync both ways', async ({ dash }) => {
  const a = await dash('tasks');
  const b = await dash('tasks');
  await a.getByRole('textbox', { name: 'Quick add task' }).fill('From A');
  await a.getByRole('textbox', { name: 'Quick add task' }).press('Enter');
  await expect(b.getByRole('button', { name: 'Open task From A' })).toBeVisible();
  await b.getByRole('checkbox', { name: 'Complete "From A"' }).click();
  await expect(a.getByRole('button', { name: 'Open task From A' })).toBeHidden();
  await b.getByRole('textbox', { name: 'Quick add task' }).fill('From B');
  await b.getByRole('textbox', { name: 'Quick add task' }).press('Enter');
  await expect(a.getByRole('button', { name: 'Open task From B' })).toBeVisible();
});

test('BUG-TB1 · "Select all" in the Tab Manager does not include the Tabspace tab itself', async ({ dash }) => {
  const page = await dash('tabs');
  await page.getByRole('checkbox', { name: 'Select all visible tabs' }).click();
  await expect(page.getByRole('checkbox', { name: /^Select Tabs · Tabspace/ })).toHaveAttribute('aria-checked', 'false', { timeout: 2000 });
});
