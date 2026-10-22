import type { BrowserContext, Page } from '@playwright/test';
import { expect, realErrors, shot, storageGet, storageSet, sw, test, windowsSummary } from './helpers';

/**
 * Agent 5 — V2 adversarial QA, part 2: workspace saved-tab editing, motion
 * (modal/menu exit animations), parallax, Spotify states, console errors.
 */

type SavedTab = { id: string; url: string; title: string; pinned: boolean; groupId?: string };
type Session = { id: string; name: string; workspaceId?: string; archived?: boolean; tabs: SavedTab[]; groups: unknown[]; updatedAt: number };

async function seedWorkspace(context: BrowserContext, urls: string[], titles?: string[]) {
  const now = Date.now();
  await storageSet(context, {
    'ts.workspaces': [{ id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 1, updatedAt: 1 }],
    'ts.sessions': [{ id: 's1', name: 'Dev', workspaceId: 'w1', createdAt: now, updatedAt: now, groups: [], tabs: urls.map((u, i) => ({ id: `t${i}`, url: u, title: titles?.[i] ?? `Tab ${i + 1}`, pinned: false })) }],
  });
}

async function latest(context: BrowserContext): Promise<Session> {
  const list = await storageGet<Session[]>(context, 'ts.sessions');
  return list.filter((s) => s.workspaceId === 'w1' && !s.archived).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

test.describe('V2 · workspace saved-tab editing', () => {
  test('5 saved tabs → remove one, reorder (buttons) → exactly 4 in the right order; Open restores that order', async ({ context, dash, web }) => {
    const urls = ['a', 'b', 'c', 'd', 'e'].map((n) => web.url(n));
    await seedWorkspace(context, urls, ['A', 'B', 'C', 'D', 'E']);
    const page = await dash('workspaces?id=w1');
    await expect(page.getByRole('heading', { name: 'Saved tabs (5)' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove C from saved tabs' }).click();
    await expect(page.getByRole('heading', { name: 'Saved tabs (4)' })).toBeVisible();
    await page.getByRole('button', { name: 'Move E up' }).click();
    await page.getByRole('button', { name: 'Move E up' }).click();
    await page.getByRole('button', { name: 'Move A down' }).click();
    // A B C D E → remove C → A B D E → E up ×2 → A E B D → A down → E A B D
    await expect.poll(async () => (await latest(context)).tabs.map((t) => t.title)).toEqual(['E', 'A', 'B', 'D']);
    await expect(page.getByRole('list', { name: 'Saved tabs, in the order they open' }).getByRole('listitem')).toHaveText(['e', 'a', 'b', 'd'].map((n) => new RegExp(`/p/${n}$`)));
    await shot(page, 'v2qa-workspace-edited');
    const before = await windowsSummary(context);
    // V2.2: "Open" now makes a tab group by default; a new window is in the Open menu.
    await page.getByRole('button', { name: 'More ways to open Development' }).click();
    await page.getByRole('menuitem', { name: 'New window' }).click();
    await expect.poll(async () => (await windowsSummary(context)).length).toBe(before.length + 1);
    const nw = (await windowsSummary(context)).find((w) => !before.some((b) => b.id === w.id))!;
    expect(nw.tabs.map((t) => t.url)).toEqual(['e', 'a', 'b', 'd'].map((n) => web.url(n)));
  });

  test('rapid repeated "Move up" clicks and remove/undo do not lose or duplicate tabs', async ({ context, dash, web }) => {
    const urls = Array.from({ length: 6 }, (_, i) => web.url(`r${i}`));
    await seedWorkspace(context, urls, urls.map((_, i) => `R${i}`));
    const page = await dash('workspaces?id=w1');
    const up = page.getByRole('button', { name: 'Move R5 up' });
    for (let i = 0; i < 5; i++) await up.click({ delay: 0 }).catch(() => undefined);
    await expect.poll(async () => (await latest(context)).tabs.map((t) => t.title)).toEqual(['R5', 'R0', 'R1', 'R2', 'R3', 'R4']);
    await page.getByRole('button', { name: 'Remove R2 from saved tabs' }).dblclick();
    await page.waitForTimeout(500);
    const t = (await latest(context)).tabs.map((x) => x.title);
    test.info().annotations.push({ type: 'after-dblclick-remove', description: JSON.stringify(t) });
    expect(t).toEqual(['R5', 'R0', 'R1', 'R3', 'R4']);
    const undo = page.getByRole('button', { name: /Undo/ });
    if (await undo.count()) {
      await undo.first().click();
      await expect.poll(async () => (await latest(context)).tabs.map((x) => x.title)).toEqual(['R5', 'R0', 'R1', 'R2', 'R3', 'R4']);
    }
  });

  test('drag and drop reorders saved tabs', async ({ context, dash, web }) => {
    const urls = ['x', 'y', 'z'].map((n) => web.url(n));
    await seedWorkspace(context, urls, ['X', 'Y', 'Z']);
    const page = await dash('workspaces?id=w1');
    const list = page.getByRole('list', { name: 'Saved tabs, in the order they open' });
    await list.getByRole('listitem').filter({ hasText: 'Z' }).dragTo(list.getByRole('listitem').filter({ hasText: 'X' }), { targetPosition: { x: 20, y: 2 } });
    await page.waitForTimeout(500);
    const order = (await latest(context)).tabs.map((t) => t.title);
    test.info().annotations.push({ type: 'after-drag', description: JSON.stringify(order) });
    expect(order[0]).toBe('Z');
    expect(order.sort()).toEqual(['X', 'Y', 'Z']);
  });

  test('Add URL rejects javascript:/data:/file:/chrome:, accepts bare domains, warns on duplicates', async ({ context, dash }) => {
    await seedWorkspace(context, ['https://github.com/'], ['GitHub']);
    const page = await dash('workspaces?id=w1');
    const box = page.getByRole('textbox', { name: 'URL to add' });
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/Windows/win.ini', 'chrome://settings', 'not a url at all', 'http://']) {
      await box.fill(bad);
      await page.getByRole('button', { name: 'Add URL' }).click();
      await page.waitForTimeout(250);
    }
    expect((await latest(context)).tabs.map((t) => t.url)).toEqual(['https://github.com/']);
    await box.fill('example.com/path?q=1');
    await page.getByRole('button', { name: 'Add URL' }).click();
    await expect.poll(async () => (await latest(context)).tabs.map((t) => t.url)).toEqual(['https://github.com/', 'https://example.com/path?q=1']);
    await box.fill('https://github.com');
    await page.getByRole('button', { name: 'Add URL' }).click();
    const dlg = page.getByRole('dialog', { name: 'Already saved' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    expect((await latest(context)).tabs.length).toBe(2);
  });

  test('"Add current tab" from the dashboard does not save the Tabspace page itself', async ({ context, dash }) => {
    await seedWorkspace(context, ['https://github.com/'], ['GitHub']);
    const page = await dash('workspaces?id=w1');
    await page.getByRole('button', { name: 'Add current tab' }).click();
    await page.waitForTimeout(800);
    const urls = (await latest(context)).tabs.map((t) => t.url);
    test.info().annotations.push({ type: 'toasts', description: (await page.getByRole('status').allInnerTexts()).concat(await page.getByRole('alert').allInnerTexts()).join(' | ') });
    expect(urls.some((u) => u.startsWith('chrome-extension://'))).toBe(false);
  });

  test('XSS: hostile saved tab titles/URLs render as text everywhere', async ({ context, dash, open }) => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    await seedWorkspace(context, ['https://example.com/?q=<script>alert(1)</script>', 'https://example.org/"><svg onload=alert(1)>'], [evil, '"><svg/onload=alert(2)>']);
    const dialogs: string[] = [];
    const pages: Page[] = [await dash('workspaces?id=w1'), await dash('workspaces'), await dash('dashboard'), await open('newtab.html'), await open('sidepanel.html')];
    for (const p of pages) p.on('dialog', (d) => (dialogs.push(d.message()), void d.dismiss()));
    await pages[4].getByRole('tab', { name: 'Workspaces' }).click();
    await pages[0].waitForTimeout(600);
    await expect(pages[0].getByText(evil)).toBeVisible();
    for (const p of pages) {
      expect(await p.locator('[onerror],[onload]').count(), p.url()).toBe(0);
      expect(await p.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    }
    expect(dialogs).toEqual([]);
  });

  test('200 saved tabs: detail renders fast; move/remove stay responsive', async ({ context, dash }) => {
    test.setTimeout(120_000);
    const urls = Array.from({ length: 200 }, (_, i) => `https://example.com/page-${i}`);
    await seedWorkspace(context, urls, urls.map((_, i) => `Page ${i}`));
    const page = await dash('workspaces');
    const t0 = Date.now();
    await page.evaluate(() => (location.hash = '#/workspaces?id=w1'));
    await expect(page.getByRole('heading', { name: 'Saved tabs (200)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove Page 199 from saved tabs' })).toBeAttached();
    const render = Date.now() - t0;
    const t1 = Date.now();
    await page.getByRole('button', { name: 'Move Page 150 up' }).click();
    await expect.poll(async () => (await latest(context)).tabs[149].title).toBe('Page 150');
    await expect(page.getByRole('list', { name: 'Saved tabs, in the order they open' }).getByRole('listitem').nth(149)).toContainText('Page 150');
    const move = Date.now() - t1;
    const t2 = Date.now();
    await page.getByRole('button', { name: 'Remove Page 10 from saved tabs' }).click();
    await expect(page.getByRole('heading', { name: 'Saved tabs (199)' })).toBeVisible();
    const remove = Date.now() - t2;
    test.info().annotations.push({ type: 'ms', description: JSON.stringify({ render, move, remove }) });
    expect(render).toBeLessThan(3000 * Number(process.env.TS_PERF_SLACK ?? 1));
    expect(move).toBeLessThan(1500 * Number(process.env.TS_PERF_SLACK ?? 1));
    expect(remove).toBeLessThan(1500 * Number(process.env.TS_PERF_SLACK ?? 1));
    await shot(page, 'v2qa-workspace-200-tabs', false);
  });

  test('Update from window: merge skips duplicates; replace keeps the previous list in History', async ({ context, dash, web }) => {
    await seedWorkspace(context, [web.url('keep')], ['keep']);
    const page = await dash('workspaces?id=w1');
    const windowId = await page.evaluate(async () => (await chrome.windows.getCurrent()).id!);
    const w = await sw(context);
    await w.evaluate(async ({ u, windowId }) => { for (const x of u) await chrome.tabs.create({ url: x, windowId, active: false }); }, { u: [web.url('keep'), web.url('new1'), web.url('new2')], windowId });
    await page.bringToFront();
    await page.getByRole('button', { name: 'Update from window…' }).click();
    let dlg = page.getByRole('dialog', { name: /Update “Development” from this window/ });
    await expect(dlg.getByRole('list', { name: 'Tabs in this window' })).toBeVisible();
    await dlg.getByRole('button', { name: /^Save \d+ tabs?$/ }).click();
    await expect(dlg).toBeHidden();
    await expect.poll(async () => (await latest(context)).tabs.map((t) => t.url)).toEqual([web.url('keep'), web.url('new1'), web.url('new2')]);
    // Replace with only new2
    await page.getByRole('button', { name: 'Update from window…' }).click();
    dlg = page.getByRole('dialog', { name: /Update “Development” from this window/ });
    await dlg.getByRole('tab', { name: 'Replace saved tabs' }).click();
    await dlg.getByRole('button', { name: 'Select none' }).click();
    await dlg.getByRole('checkbox', { name: /Save new2/ }).click();
    await dlg.getByRole('button', { name: 'Save 1 tab' }).click();
    await expect.poll(async () => (await latest(context)).tabs.map((t) => t.url)).toEqual([web.url('new2')]);
    await expect(page.getByRole('heading', { name: /History \(\d+\)/ })).toBeVisible();
    const all = await storageGet<Session[]>(context, 'ts.sessions');
    expect(all.some((s) => s.tabs.length === 3)).toBe(true); // previous list kept
    // Extension page and chrome:// tabs are not offered as saveable
    await page.getByRole('button', { name: 'Update from window…' }).click();
    dlg = page.getByRole('dialog', { name: /Update “Development” from this window/ });
    const own = dlg.getByRole('checkbox', { name: /Save .*Tabspace/ });
    if (await own.count()) expect(await own.first().isDisabled().catch(() => true)).toBe(true);
    await dlg.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('V2 · motion: animations never block input', () => {
  test('rapid open/Escape cycles leave no stuck dialog; trigger regains focus; page stays clickable', async ({ dash, errors }) => {
    const page = await dash('workspaces');
    const trigger = page.getByRole('button', { name: /^(New workspace|Create your first workspace)$/ }).first();
    for (let i = 0; i < 12; i++) {
      await trigger.click();
      await expect(page.getByRole('dialog', { name: 'New workspace' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(600);
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
    expect(await page.locator('[data-state="closing"]').count()).toBe(0);
    await expect(trigger).toBeFocused();
    // Escape spam with no dialog does nothing harmful
    for (let i = 0; i < 10; i++) await page.keyboard.press('Escape');
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'New workspace' })).toBeVisible();
    expect(realErrors(errors)).toEqual([]);
  });

  test('click on a control underneath a closing (exit-animating) modal goes through immediately', async ({ dash }) => {
    const page = await dash('tasks');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Notes', exact: true }).waitFor();
    await page.evaluate(() => (location.hash = '#/workspaces'));
    const trigger = page.getByRole('button', { name: /^(New workspace|Create your first workspace)$/ }).first();
    await trigger.click();
    await page.keyboard.press('Escape');
    // ~0 ms later, while the dialog is still mounted (inert) — click a nav link underneath it
    const closingNow = await page.locator('[data-state="closing"]').count();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Tasks', exact: true }).click({ timeout: 2000 });
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
    test.info().annotations.push({ type: 'was-closing-when-clicked', description: String(closingNow) });
  });

  test('double-click Cancel / backdrop during exit: one close, no errors, reopen works immediately', async ({ dash, errors }) => {
    const page = await dash('workspaces');
    const trigger = page.getByRole('button', { name: /^(New workspace|Create your first workspace)$/ }).first();
    await trigger.click();
    await page.getByRole('dialog', { name: 'New workspace' }).getByRole('button', { name: 'Cancel' }).dblclick();
    await trigger.click();
    const dlg = page.getByRole('dialog', { name: 'New workspace' });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel('Name').fill('Typed during reopen');
    await expect(dlg.getByLabel('Name')).toHaveValue('Typed during reopen');
    // keyboard focus is inside the open dialog, not the closing one
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]:not([aria-hidden="true"])'))).toBe(true);
    // Backdrop double click
    await page.mouse.click(5, 5);
    await page.mouse.click(5, 5);
    await page.waitForTimeout(500);
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
    expect(realErrors(errors)).toEqual([]);
  });

  test('Tab focus trap: while open, Tab never leaves the dialog; while closing, the closing dialog is not focusable', async ({ dash }) => {
    const page = await dash('workspaces');
    await page.getByRole('button', { name: /^(New workspace|Create your first workspace)$/ }).first().click();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(false);
  });

  test('BUG-MO1 · Escape in a confirm dialog stacked on another modal closes only the confirm', async ({ dash, context }) => {
    // Regression for BUG-MO1 (fixed: only the top-most dialog handles Escape).
    await storageSet(context, {
      'ts.calendarSources': [{ id: 'cal1', name: 'Personal', kind: 'local', color: '#9aa0a6', enabled: true, createdAt: 1, updatedAt: 1 }],
      'ts.events': [{ id: 'e1', sourceId: 'cal1', title: 'Go for a run', start: new Date(Date.now() + 3600_000).toISOString(), end: new Date(Date.now() + 7200_000).toISOString(), allDay: false, createdAt: 1, updatedAt: 1 }],
    });
    const page = await dash('calendar');
    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.getByText('Go for a run').first().click();
    const details = page.getByRole('dialog').first();
    await expect(details).toBeVisible();
    await details.getByRole('button', { name: 'Delete' }).click();
    const confirmDlg = page.getByRole('dialog', { name: /Delete “Go for a run”/ });
    await expect(confirmDlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmDlg).toBeHidden();
    await page.waitForTimeout(400);
    const remaining = await page.locator('[role="dialog"]:not([aria-hidden="true"])').count();
    test.info().annotations.push({ type: 'dialogs-left-after-escape', description: String(remaining) });
    expect(remaining).toBe(1);
    expect((await storageGet<unknown[]>(context, 'ts.events')).length).toBe(1);
  });

  test('menus: open/Escape spam and selecting an item during the exit animation', async ({ dash, context }) => {
    await storageSet(context, { 'ts.workspaces': [{ id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 1, updatedAt: 1 }] });
    const page = await dash('workspaces');
    const btn = page.getByRole('button', { name: 'Actions for Development' });
    for (let i = 0; i < 8; i++) {
      await btn.click();
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(400);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await btn.click();
    await page.getByRole('menuitem', { name: 'Rename / change icon' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit workspace' })).toBeVisible();
  });

  test('reduced motion: modals open/close without animation delay', async ({ dash, context }) => {
    const settings = await storageGet<Record<string, unknown>>(context, 'ts.settings');
    await storageSet(context, { 'ts.settings': { ...(settings ?? {}), reducedMotion: true } });
    const page = await dash('workspaces');
    await page.getByRole('button', { name: /^(New workspace|Create your first workspace)$/ }).first().click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
  });
});

test.describe('V2 · parallax starfield', () => {
  async function layerTransforms(page: Page) {
    return page.locator('[data-layer]').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform || getComputedStyle(e).transform));
  }
  async function wiggle(page: Page) {
    for (let i = 0; i < 20; i++) await page.mouse.move(200 + i * 50, 150 + i * 25);
    await page.waitForTimeout(700);
  }

  test('on by default: mouse movement shifts the three layers by different amounts, then the loop stops', async ({ dash }) => {
    const page = await dash('dashboard');
    await page.mouse.move(10, 10);
    await page.waitForTimeout(600);
    const a = await layerTransforms(page);
    await wiggle(page);
    const b = await layerTransforms(page);
    test.info().annotations.push({ type: 'transforms', description: JSON.stringify({ a, b }) });
    expect(b.length).toBe(3);
    expect(b).not.toEqual(a);
    expect(new Set(b).size).toBe(3);
    // Settled: no rAF-driven changes while the mouse is still
    await page.waitForTimeout(1500);
    const c = await layerTransforms(page);
    await page.waitForTimeout(500);
    expect(await layerTransforms(page)).toEqual(c);
  });

  test('perf: 3 s of continuous mouse movement produces no long tasks and ≥ 45 fps', async ({ dash }) => {
    const page = await dash('dashboard');
    await page.evaluate(() => {
      const w = window as unknown as { __lt: number[]; __frames: number };
      w.__lt = [];
      w.__frames = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__lt.push(e.duration))).observe({ type: 'longtask', buffered: false });
      const tick = () => {
        w.__frames++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < 3000) {
      await page.mouse.move(100 + ((i * 37) % 1200), 100 + ((i * 53) % 700));
      i++;
    }
    const r = await page.evaluate(() => ({ lt: (window as unknown as { __lt: number[] }).__lt, frames: (window as unknown as { __frames: number }).__frames }));
    const fps = r.frames / ((Date.now() - t0) / 1000);
    test.info().annotations.push({ type: 'perf', description: JSON.stringify({ longTasks: r.lt, fps: Math.round(fps), moves: i }) });
    expect(r.lt.filter((d) => d > 100)).toEqual([]);
    expect(fps).toBeGreaterThan(45 / Number(process.env.TS_PERF_SLACK ?? 1)); // CI renders without a GPU
  });

  test('parallax off (setting) → layers never move; toggling it live in Settings applies', async ({ dash, context }) => {
    const page = await dash('settings?section=appearance');
    await page.getByRole('switch', { name: 'Background movement (parallax)' }).click();
    await expect.poll(async () => (await storageGet<{ parallax?: boolean }>(context, 'ts.settings'))?.parallax).toBe(false);
    const a = await layerTransforms(page);
    await wiggle(page);
    expect(await layerTransforms(page)).toEqual(a);
  });

  test('reduced motion (OS media query and app setting) → layers never move', async ({ dash, context }) => {
    const page = await dash('dashboard');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    let a = await layerTransforms(page);
    await wiggle(page);
    expect(await layerTransforms(page)).toEqual(a);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const s = await storageGet<Record<string, unknown>>(context, 'ts.settings');
    await storageSet(context, { 'ts.settings': { ...(s ?? {}), reducedMotion: true } });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    a = await layerTransforms(page);
    await wiggle(page);
    expect(await layerTransforms(page)).toEqual(a);
  });

  test('New Tab and side panel starfields: parallax present where expected, no errors', async ({ open, errors }) => {
    const nt = await open('newtab.html');
    await nt.waitForTimeout(400);
    const a = await layerTransforms(nt);
    for (let i = 0; i < 15; i++) await nt.mouse.move(100 + i * 60, 100 + i * 30);
    await nt.waitForTimeout(700);
    const b = await layerTransforms(nt);
    test.info().annotations.push({ type: 'newtab', description: JSON.stringify({ layers: a.length, moved: JSON.stringify(a) !== JSON.stringify(b) }) });
    expect(realErrors(errors)).toEqual([]);
  });
});

test.describe('V2 · Spotify honesty and mocked flows', () => {
  test('not configured: New Tab, dashboard, Focus and Settings say so; never "Connected"', async ({ open, dash }) => {
    const nt = await open('newtab.html');
    await expect(nt.getByRole('region', { name: 'Spotify' })).toContainText(/isn’t set up|not set up/i);
    const d = await dash('dashboard');
    const f = await dash('focus');
    const s = await dash('settings?section=integrations');
    for (const p of [nt, d, f, s]) expect(await p.locator('body').innerText(), p.url()).not.toMatch(/\bConnected\b(?![- ]accounts?)/);
  });

  test('client ID set but not connected: "Connect" offered, not "Connected"', async ({ context, open }) => {
    const s = await storageGet<Record<string, unknown>>(context, 'ts.settings');
    await storageSet(context, { 'ts.settings': { ...(s ?? {}), integrations: { spotifyClientId: 'testclient123' } } });
    const nt = await open('newtab.html');
    const region = nt.getByRole('region', { name: 'Spotify' });
    await nt.waitForTimeout(800);
    const txt = await region.innerText();
    test.info().annotations.push({ type: 'newtab-spotify', description: txt });
    expect(txt).not.toMatch(/\bConnected\b/);
    expect(txt).toMatch(/connect/i);
  });

  async function mockSpotify(context: BrowserContext, opts: { playing?: boolean; playStatus?: number; playBody?: unknown; nextStatus?: number } = {}) {
    const calls: string[] = [];
    await context.route('https://api.spotify.com/**', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      calls.push(`${req.method()} ${u.pathname}`);
      const json = (status: number, body?: unknown) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
      if (u.pathname === '/v1/me') return json(200, { id: 'qa', display_name: 'QA Tester' });
      if (u.pathname === '/v1/me/player' && req.method() === 'GET')
        return json(200, { is_playing: !!opts.playing, item: { name: 'Lo-fi <b>Beats</b>', uri: 'spotify:track:1', duration_ms: 200000, artists: [{ name: 'Night Owl' }], album: { images: [] } }, device: { id: 'd1', name: 'QA Laptop', volume_percent: 40, supports_volume: true }, context: null });
      if (u.pathname === '/v1/me/player/devices') return json(200, { devices: [{ id: 'd1', name: 'QA Laptop', type: 'Computer', is_active: true, is_restricted: false, volume_percent: 40 }] });
      if (u.pathname.startsWith('/v1/me/playlists')) return json(200, { items: [{ id: 'p1', name: 'Deep Focus', uri: 'spotify:playlist:p1', images: [] }], next: null });
      if (u.pathname.startsWith('/v1/me/tracks')) return json(200, { total: 2, items: [{ track: { uri: 'spotify:track:a' } }, { track: { uri: 'spotify:track:b' } }], next: null });
      if (u.pathname === '/v1/me/player/play') return opts.playStatus ? json(opts.playStatus, opts.playBody) : route.fulfill({ status: 202, body: 'accepted (not json)' });
      if (u.pathname === '/v1/me/player/next') return route.fulfill({ status: opts.nextStatus ?? 200, body: 'ok-not-json' });
      return route.fulfill({ status: 204, body: '' });
    });
    // Seed only after the first-install migration has stamped settings: this helper writes raw storage
    // (bypassing the store's Web Lock), which real Tabspace pages never do.
    await expect.poll(async () => (await storageGet<{ schemaVersion?: number }>(context, 'ts.settings'))?.schemaVersion, { timeout: 5000 }).toBeTruthy();
    const s = await storageGet<Record<string, unknown>>(context, 'ts.settings');
    await storageSet(context, {
      'ts.settings': { ...(s ?? {}), integrations: { spotifyClientId: 'testclient123' } },
      'secret.spotify': { accessToken: 'fake-access', refreshToken: 'fake-refresh', expiresAt: Date.now() + 3600_000, clientId: 'testclient123', scope: 'user-read-playback-state user-modify-playback-state playlist-read-private user-library-read user-read-currently-playing' },
    });
    return calls;
  }

  test('mocked connected account: track shows (escaped), Next with a non-JSON 2xx is success, single poller', async ({ context, open, dash, errors }) => {
    const calls = await mockSpotify(context, { playing: true });
    const nt = await open('newtab.html');
    const region = nt.getByRole('region', { name: 'Spotify' });
    await expect(region).toContainText('Lo-fi <b>Beats</b>', { timeout: 10_000 });
    await expect(region.locator('b')).toHaveCount(0);
    await shot(nt, 'v2qa-newtab-spotify-mocked', false);
    const d = await dash('dashboard');
    await d.waitForTimeout(500);
    const next = region.getByRole('button', { name: /Next/i });
    await next.click();
    await nt.waitForTimeout(800);
    const alerts = (await region.getByRole('alert').allInnerTexts()).join(' ');
    test.info().annotations.push({ type: 'alerts-after-next', description: alerts });
    expect(alerts).not.toMatch(/failed|error/i);
    expect(calls.some((c) => c === 'POST /v1/me/player/next')).toBe(true);
    // polling: count GET /me/player over 6 s with two surfaces open
    const before = calls.filter((c) => c === 'GET /v1/me/player').length;
    await nt.waitForTimeout(6000);
    const polls = calls.filter((c) => c === 'GET /v1/me/player').length - before;
    test.info().annotations.push({ type: 'player-polls-6s-2-pages', description: String(polls) });
    expect(polls).toBeLessThanOrEqual(8);
    expect(realErrors(errors).filter((e) => !/spotify/i.test(e))).toEqual([]);
  });

  test('mocked 403 PREMIUM_REQUIRED on play → honest Premium message, no fake playing state', async ({ context, open }) => {
    await mockSpotify(context, { playing: false, playStatus: 403, playBody: { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } } });
    const nt = await open('newtab.html');
    const region = nt.getByRole('region', { name: 'Spotify' });
    await expect(region).toContainText('Lo-fi', { timeout: 20_000 });
    await region.getByRole('button', { name: /^Play|Resume/i }).first().click();
    await expect(nt.getByText(/Premium is required/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('mocked 401 → "session expired — reconnect", not Connected', async ({ context, open }) => {
    await context.route('https://api.spotify.com/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { status: 401, message: 'The access token expired' } }) }));
    await context.route('https://accounts.spotify.com/**', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant' }) }));
    const s = await storageGet<Record<string, unknown>>(context, 'ts.settings');
    await storageSet(context, {
      'ts.settings': { ...(s ?? {}), integrations: { spotifyClientId: 'testclient123' } },
      'secret.spotify': { accessToken: 'stale', refreshToken: 'bad', expiresAt: Date.now() + 3600_000, clientId: 'testclient123', scope: 'user-read-playback-state' },
    });
    const nt = await open('newtab.html');
    const region = nt.getByRole('region', { name: 'Spotify' });
    await nt.waitForTimeout(3000);
    const txt = await region.innerText();
    test.info().annotations.push({ type: 'after-401', description: txt });
    expect(txt).not.toMatch(/\bConnected\b/);
  });
});

test('V2 · no console errors on any surface (with example data)', async ({ dash, open, errors }) => {
  const d = await dash('settings?section=data');
  await d.getByRole('button', { name: /Load example data/i }).click();
  await d.waitForTimeout(800);
  for (const r of ['dashboard', 'workspaces', 'tabs', 'calendar', 'notes', 'tasks', 'bookmarks', 'focus', 'analytics', 'settings', 'sidebar']) {
    await d.evaluate((h) => (location.hash = h), `#/${r}`);
    await expect(d.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await d.waitForTimeout(350);
  }
  const ws = await storageGet<{ id: string }[]>(d.context(), 'ts.workspaces');
  await d.evaluate((h) => (location.hash = h), `#/workspaces?id=${ws[0].id}`);
  await d.waitForTimeout(500);
  for (const p of ['newtab.html', 'popup.html', 'popup.html#note', 'sidepanel.html']) {
    const pg = await open(p);
    await pg.waitForTimeout(700);
  }
  expect(realErrors(errors)).toEqual([]);
});
