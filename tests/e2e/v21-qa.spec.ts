/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect, launch, patchSettings, realErrors, shot, test, type Ext } from './qa21';
import { collectErrors } from './qa21';

/** Agent 5 — V2.1 adversarial QA: portalled menus, Save current tab, customizable New Tab, New Tab bar. */

type Layout = { main: string[]; side: string[]; hidden: string[] };

/** The menu is fully on-screen and is the topmost element at its centre and inner corners. */
async function assertMenuOnTop(_page: Page, menu: Locator) {
  await expect(menu).toBeVisible();
  const r = await menu.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const pts = [
      [b.left + b.width / 2, b.top + b.height / 2],
      [b.left + 6, b.top + 6],
      [b.right - 6, b.bottom - 6],
      [b.left + 6, b.bottom - 6],
    ];
    return { box: { top: b.top, left: b.left, bottom: b.bottom, right: b.right }, vw: innerWidth, vh: innerHeight, onTop: pts.map(([x, y]) => el.contains(document.elementFromPoint(x, y))) };
  });
  expect(r.box.top, JSON.stringify(r)).toBeGreaterThanOrEqual(0);
  expect(r.box.left).toBeGreaterThanOrEqual(0);
  expect(r.box.bottom).toBeLessThanOrEqual(r.vh);
  expect(r.box.right).toBeLessThanOrEqual(r.vw);
  expect(r.onTop, JSON.stringify(r)).toEqual([true, true, true, true]);
  return r;
}

async function mockSpotify(x: Ext, playlists = 6) {
  await x.context.route('https://api.spotify.com/**', async (route) => {
    const u = new URL(route.request().url());
    const json = (status: number, body?: unknown) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
    if (u.pathname === '/v1/me') return json(200, { id: 'qa', display_name: 'QA' });
    if (u.pathname === '/v1/me/player' && route.request().method() === 'GET')
      return json(200, { is_playing: true, item: { name: 'Lo-fi Beats', uri: 'spotify:track:1', duration_ms: 200000, artists: [{ name: 'Night Owl' }], album: { images: [] } }, device: { id: 'd1', name: 'QA Laptop', volume_percent: 40, supports_volume: true } });
    if (u.pathname === '/v1/me/player/devices') return json(200, { devices: [{ id: 'd1', name: 'QA Laptop', type: 'Computer', is_active: true, is_restricted: false, volume_percent: 40 }] });
    if (u.pathname.startsWith('/v1/me/playlists')) return json(200, { items: Array.from({ length: playlists }, (_, i) => ({ id: `p${i}`, name: `Deep Focus ${i}`, uri: `spotify:playlist:p${i}`, images: [] })), next: null });
    if (u.pathname.startsWith('/v1/me/tracks')) return json(200, { total: 2, items: [], next: null });
    return route.fulfill({ status: 204, body: '' });
  });
  await patchSettings(x, (s) => ({ ...s, integrations: { spotifyClientId: 'testclient123' } }));
  await x.set({ 'secret.spotify': { accessToken: 'fake', refreshToken: 'r', expiresAt: Date.now() + 3600_000, clientId: 'testclient123', scope: 'user-read-playback-state user-modify-playback-state playlist-read-private user-library-read' } });
}

const wsSeed = (n = 3) => ({
  'ts.workspaces': Array.from({ length: n }, (_, i) => ({ id: `w${i}`, name: `Workspace ${i}`, icon: 'code', order: i, createdAt: 1, updatedAt: 1 })),
  'ts.tasks': Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `Task number ${i}`, done: false, priority: 'none', subtasks: [], order: i, createdAt: 1, updatedAt: 1 })),
});

/* ------------------------------------------------------------------ */
test.describe('V2.1 · portalled menus', () => {
  test('Spotify "…" menu on the New Tab paints above Quick Links and fits on screen (1366×768 and 1440×900)', async ({ x }) => {
    await mockSpotify(x, 8);
    for (const vp of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
      const nt = await x.open('newtab.html');
      await nt.setViewportSize(vp);
      const region = nt.getByRole('region', { name: 'Spotify' });
      await expect(region).toContainText('Lo-fi Beats', { timeout: 10_000 });
      await region.getByRole('button', { name: 'Spotify options' }).click();
      const r = await assertMenuOnTop(nt, nt.getByRole('menu', { name: 'Spotify options' }));
      test.info().annotations.push({ type: `spotify-menu-${vp.width}`, description: JSON.stringify(r.box) });
      await shot(nt, `v21qa-spotify-menu-${vp.width}`);
      await nt.keyboard.press('Escape');
      await expect(nt.getByRole('menu')).toHaveCount(0);
      await expect(region.getByRole('button', { name: 'Spotify options' })).toBeFocused();
      await nt.close();
    }
  });

  test('Spotify menu on the dashboard sidebar; flips up near the bottom; follows scroll/resize', async ({ x }) => {
    await mockSpotify(x, 8);
    const d = await x.open('dashboard.html#/dashboard');
    await d.setViewportSize({ width: 1440, height: 700 });
    const trig = d.getByRole('button', { name: 'Spotify options' });
    await expect(trig).toBeVisible({ timeout: 10_000 });
    await trig.scrollIntoViewIfNeeded();
    await trig.click();
    const menu = d.getByRole('menu', { name: 'Spotify options' });
    await assertMenuOnTop(d, menu);
    // resize while open → the menu re-anchors to the trigger (wherever the trigger now is)
    await d.setViewportSize({ width: 1100, height: 560 });
    await d.waitForTimeout(300);
    {
      const t = (await trig.boundingBox())!;
      const m = (await menu.boundingBox())!;
      test.info().annotations.push({ type: 'after-resize', description: JSON.stringify({ t, m }) });
      expect(Math.abs(m.y - (t.y + t.height + 4)) < 6 || Math.abs(m.y + m.height - (t.y - 4)) < 6).toBe(true);
    }
    // scroll while open → menu stays attached to the trigger (or closes) — never floats detached on top of other content
    await d.mouse.wheel(0, 200);
    await d.waitForTimeout(300);
    if (await menu.count()) {
      const t = (await trig.boundingBox())!;
      const m = (await menu.boundingBox())!;
      const attached = Math.abs(m.y - (t.y + t.height + 4)) < 6 || Math.abs(m.y + m.height - (t.y - 4)) < 6;
      test.info().annotations.push({ type: 'after-scroll', description: JSON.stringify({ t, m, attached }) });
      expect(attached).toBe(true);
    }
  });

  test('workspace card menu, task row menu and saved-session menu render on top near the bottom edge', async ({ x }) => {
    await x.set({
      ...wsSeed(9),
      'ts.sessions': [{ id: 's1', name: 'Morning tabs', tabs: [{ id: 'a', url: 'https://example.com/', title: 'e', pinned: false }], groups: [], createdAt: 1, updatedAt: 1 }],
    });
    const d = await x.open('dashboard.html#/workspaces');
    await d.setViewportSize({ width: 1280, height: 640 });
    const last = d.getByRole('button', { name: 'Actions for Workspace 8' });
    await last.scrollIntoViewIfNeeded();
    await d.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await last.click();
    await assertMenuOnTop(d, d.getByRole('menu', { name: 'Actions for Workspace 8' }));
    await d.getByRole('menuitem', { name: 'Rename / change icon' }).click();
    await expect(d.getByRole('dialog', { name: 'Edit workspace' })).toBeVisible();
    await d.keyboard.press('Escape');

    await d.evaluate(() => (location.hash = '#/tasks'));
    const lastTask = d.getByRole('button', { name: 'Actions for Task number 11' });
    await lastTask.scrollIntoViewIfNeeded();
    await lastTask.click();
    await assertMenuOnTop(d, d.getByRole('menu', { name: 'Actions for Task number 11' }));
    await d.keyboard.press('Escape');

    await d.evaluate(() => (location.hash = '#/tabs'));
    await d.getByRole('tab', { name: /Saved sessions/ }).click();
    await d.getByRole('button', { name: 'Actions for Morning tabs' }).click();
    await assertMenuOnTop(d, d.getByRole('menu', { name: 'Actions for Morning tabs' }));
  });

  test('menus in the 300 px popup-width and side panel stay inside the viewport', async ({ x }) => {
    await x.set(wsSeed(3));
    const side = await x.open('sidepanel.html');
    await side.setViewportSize({ width: 300, height: 560 });
    // any Menu trigger on the side panel (task rows etc.)
    const triggers = side.locator('[aria-haspopup="menu"]');
    const n = await triggers.count();
    test.info().annotations.push({ type: 'sidepanel-menu-triggers', description: String(n) });
    for (let i = 0; i < Math.min(n, 3); i++) {
      await triggers.nth(i).click();
      await assertMenuOnTop(side, side.getByRole('menu').first());
      await side.keyboard.press('Escape');
    }
    // dashboard at 320 px: task row menu
    const d = await x.open('dashboard.html#/tasks');
    await d.setViewportSize({ width: 320, height: 600 });
    await d.getByRole('button', { name: 'Actions for Task number 0' }).click();
    await assertMenuOnTop(d, d.getByRole('menu', { name: 'Actions for Task number 0' }));
  });

  test('menu keyboard: ArrowDown/Up/Home/End/Escape; Tab closes; rapid toggle leaves no orphan menu', async ({ x }) => {
    await x.set(wsSeed(1));
    const d = await x.open('dashboard.html#/workspaces');
    const trig = d.getByRole('button', { name: 'Actions for Workspace 0' });
    await trig.focus();
    await d.keyboard.press('Enter');
    const menu = d.getByRole('menu', { name: 'Actions for Workspace 0' });
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await d.keyboard.press('End');
    await expect(menu.getByRole('menuitem').last()).toBeFocused();
    await d.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await d.keyboard.press('Escape');
    await expect(trig).toBeFocused();
    for (let i = 0; i < 9; i++) await trig.click({ delay: 0 });
    await d.waitForTimeout(400);
    expect(await d.locator('[role="menu"]').count()).toBe(1); // odd number of clicks → open
    await d.keyboard.press('Tab');
    await d.waitForTimeout(400);
    expect(await d.locator('[role="menu"]:not([aria-hidden="true"])').count()).toBe(0);
    expect(await d.locator('body > [role="menu"]').count()).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
test.describe('V2.1 · Bookmarks "Save current tab"', () => {
  async function startWeb(context: BrowserContext) {
    await context.route('https://qa.example/**', (r) => r.fulfill({ contentType: 'text/html', body: `<title>QA ${new URL(r.request().url()).pathname}</title><h1>x</h1>` }));
  }

  test('same window: saves the web tab (not the dashboard) into the open folder; result visible', async ({ x }) => {
    await startWeb(x.context);
    await x.set({ 'ts.bookmarkFolders': [{ id: 'f1', name: 'Reading', order: 0, createdAt: 1, updatedAt: 1 }] });
    const web = await x.context.newPage();
    await web.goto('https://qa.example/article');
    const d = await x.open('dashboard.html#/bookmarks?folder=f1');
    await d.getByRole('button', { name: 'Save current tab' }).click();
    const dlg = d.getByRole('dialog', { name: 'Save page' });
    await expect(dlg).toContainText('https://qa.example/article');
    await expect(dlg.getByRole('combobox', { name: 'Folder' })).toHaveValue('f1');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await x.get<{ url: string; folderId?: string }[]>('ts.bookmarks'))?.[0]).toMatchObject({ url: 'https://qa.example/article', folderId: 'f1' });
    await expect(d.getByText('QA /article').first()).toBeVisible();
    await shot(d, 'v21qa-bookmarks-saved-current-tab');
  });

  test('dashboard alone in its own window: picks the web tab from the other window', async ({ x }) => {
    await startWeb(x.context);
    const web = await x.context.newPage();
    await web.goto('https://qa.example/other-window');
    const w = await x.worker();
    await w.evaluate(async (u) => chrome.windows.create({ url: u, focused: true }), `chrome-extension://${x.id}/dashboard.html#/bookmarks`);
    const d = await x.context.waitForEvent('page', (p) => p.url().includes('#/bookmarks'));
    await d.waitForLoadState();
    await d.getByRole('button', { name: 'Save current tab' }).click();
    const dlg = d.getByRole('dialog', { name: 'Save page' });
    await expect(dlg).toContainText('https://qa.example/other-window');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => ((await x.get<{ url: string }[]>('ts.bookmarks')) ?? []).map((b) => b.url)).toEqual(['https://qa.example/other-window']);
  });

  test('dashboard opened from the New Tab: the most recently used web page is offered; page switcher lists alternatives', async ({ x }) => {
    await startWeb(x.context);
    const a = await x.context.newPage();
    await a.goto('https://qa.example/first');
    const b = await x.context.newPage();
    await b.goto('https://qa.example/second');
    await b.bringToFront();
    const nt = await x.open('newtab.html');
    await nt.getByRole('button', { name: 'Open dashboard' }).click();
    await expect.poll(() => x.context.pages().some((p) => p.url().includes('dashboard.html'))).toBe(true);
    const d = x.context.pages().find((p) => p.url().includes('dashboard.html'))!;
    await d.evaluate(() => (location.hash = '#/bookmarks'));
    await d.getByRole('button', { name: 'Save current tab' }).click();
    const dlg = d.getByRole('dialog', { name: 'Save page' });
    await expect(dlg).toContainText('https://qa.example/second');
    const pageSel = dlg.getByRole('combobox', { name: 'Page' });
    await expect(pageSel).toBeVisible();
    await pageSel.selectOption({ label: 'QA /first' });
    await expect(dlg).toContainText('https://qa.example/first');
    await expect(dlg.getByRole('textbox', { name: 'Title' })).toHaveValue('QA /first');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => ((await x.get<{ url: string }[]>('ts.bookmarks')) ?? []).map((b) => b.url)).toEqual(['https://qa.example/first']);
  });

  test('duplicate: "Update" moves the existing bookmark; "Add a copy" creates a second; no web tab → honest message', async ({ x }) => {
    await startWeb(x.context);
    await x.set({
      'ts.bookmarkFolders': [{ id: 'f1', name: 'Reading', order: 0, createdAt: 1, updatedAt: 1 }, { id: 'f2', name: 'Work', order: 1, createdAt: 1, updatedAt: 1 }],
      'ts.bookmarks': [{ id: 'b1', url: 'https://qa.example/dup', title: 'Old title', tags: ['x'], favorite: true, folderId: 'f1', createdAt: 1, updatedAt: 1 }],
    });
    const d0 = await x.open('dashboard.html#/bookmarks');
    await d0.getByRole('button', { name: 'Save current tab' }).click();
    await expect(d0.getByRole('alert').filter({ hasText: /No open web page/ })).toBeVisible();
    const web = await x.context.newPage();
    await web.goto('https://qa.example/dup');
    const d = await x.open('dashboard.html#/bookmarks');
    await d.getByRole('button', { name: 'Save current tab' }).click();
    let dlg = d.getByRole('dialog', { name: 'Save page' });
    await expect(dlg.getByRole('status')).toContainText('Already saved in Reading');
    await dlg.getByRole('combobox', { name: 'Folder' }).selectOption({ label: 'Work' });
    await dlg.getByRole('button', { name: 'Update' }).click();
    await expect.poll(async () => (await x.get<any[]>('ts.bookmarks')).map((b) => [b.id, b.folderId, b.favorite])).toEqual([['b1', 'f2', true]]);
    await d.getByRole('button', { name: 'Save current tab' }).click();
    dlg = d.getByRole('dialog', { name: 'Save page' });
    await dlg.getByRole('button', { name: 'Add a copy' }).click();
    await expect.poll(async () => (await x.get<any[]>('ts.bookmarks')).length).toBe(2);
  });

  test('rapid double-click on Save in the dialog creates one bookmark', async ({ x }) => {
    await startWeb(x.context);
    const web = await x.context.newPage();
    await web.goto('https://qa.example/once');
    const d = await x.open('dashboard.html#/bookmarks');
    await d.getByRole('button', { name: 'Save current tab' }).click();
    await d.getByRole('dialog', { name: 'Save page' }).getByRole('button', { name: 'Save' }).dblclick();
    await d.waitForTimeout(800);
    expect((await x.get<any[]>('ts.bookmarks')).length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
test.describe('V2.1 · customizable New Tab', () => {
  const layoutOf = async (x: Ext) => ((await x.get<any>('ts.settings'))?.newTab?.layout ?? null) as Layout | null;
  test('hide / show / move / reorder via buttons persist across reload and restart; reset restores defaults', async ({ errors }) => {
    test.setTimeout(120_000);
    const x = await launch();
    collectErrors(x.context, errors);
    let nt = await x.open('newtab.html');
    await nt.getByRole('button', { name: 'Customize' }).click();
    await nt.getByRole('button', { name: 'Hide Recent Tabs' }).click();
    await nt.getByRole('button', { name: 'Move Focus Mode up' }).click();
    await nt.getByRole('button', { name: 'Move Calendar to the main column' }).click();
    await expect(nt.getByRole('button', { name: 'Show Recent Tabs' })).toBeVisible();
    await shot(nt, 'v21qa-newtab-customize');
    const saved = await layoutOf(x);
    test.info().annotations.push({ type: 'layout', description: JSON.stringify(saved) });
    expect(saved!.hidden).toContain('recentTabs');
    expect(saved!.main).toContain('calendar');
    expect(saved!.side.indexOf('focus')).toBeLessThan(saved!.side.indexOf('upcoming'));
    await nt.getByRole('button', { name: 'Done' }).click();
    await expect(nt.getByRole('heading', { name: 'Recent Tabs' })).toHaveCount(0);
    await nt.reload();
    await expect(nt.getByRole('heading', { name: 'Recent Tabs' })).toHaveCount(0);
    await x.context.close();
    const y = await launch({ dir: x.dir });
    collectErrors(y.context, errors);
    try {
      expect(await layoutOf(y)).toEqual(saved);
      nt = await y.open('newtab.html');
      await expect(nt.getByRole('heading', { name: 'Recent Tabs' })).toHaveCount(0);
      await nt.getByRole('button', { name: 'Customize' }).click();
      await nt.getByRole('button', { name: 'Reset to default' }).click();
      await nt.getByRole('button', { name: 'Done' }).click();
      await expect(nt.getByRole('heading', { name: 'Recent Tabs' })).toBeVisible();
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await y.context.close();
    }
  });

  test('drag a widget from the side column to the top of the main column; drag from the tray', async ({ x }) => {
    const nt = await x.open('newtab.html');
    await nt.getByRole('button', { name: 'Customize' }).click();
    const quick = nt.getByRole('group', { name: 'Quick Links widget' });
    const ws = nt.getByRole('group', { name: 'Workspaces widget' });
    await quick.locator('[draggable="true"]').first().dragTo(ws, { targetPosition: { x: 40, y: 4 } });
    await nt.waitForTimeout(400);
    let l = (await layoutOf(x))!;
    test.info().annotations.push({ type: 'after-drag', description: JSON.stringify(l) });
    expect(l.main).toContain('quickLinks');
    expect(l.side).not.toContain('quickLinks');
    await nt.getByRole('button', { name: 'Hide Spotify' }).click();
    await nt.getByRole('button', { name: 'Show Spotify' }).dragTo(nt.getByRole('group', { name: 'Calendar widget' }), { targetPosition: { x: 40, y: 4 } });
    await nt.waitForTimeout(400);
    l = (await layoutOf(x))!;
    expect(l.hidden).not.toContain('spotify');
  });

  test('odd layouts render without breaking: all hidden / only the bar / everything in one column / everything in the side column', async ({ x }) => {
    const ALL = ['clock', 'search', 'quote', 'workspaces', 'tasks', 'recentTabs', 'calendar', 'upcoming', 'focus', 'spotify', 'quickLinks'];
    const cases: [string, Layout][] = [
      ['all-hidden', { main: [], side: [], hidden: ['bar', ...ALL] }],
      ['only-bar', { main: ['bar'], side: [], hidden: ALL }],
      ['one-main-column', { main: ['bar', ...ALL], side: [], hidden: [] }],
      ['all-side', { main: [], side: ['bar', ...ALL], hidden: [] }],
      ['search-only', { main: ['search'], side: [], hidden: ['bar', ...ALL.filter((i) => i !== 'search')] }],
    ];
    for (const [name, layout] of cases) {
      await patchSettings(x, (s) => ({ ...s, newTab: { ...(s.newTab ?? {}), layout, showQuote: !layout.hidden.includes('quote'), showFocus: !layout.hidden.includes('focus') } }));
      const nt = await x.open('newtab.html');
      await nt.setViewportSize({ width: 1366, height: 768 });
      await nt.waitForTimeout(500);
      const m = await nt.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
      await shot(nt, `v21qa-newtab-${name}`);
      expect(m.sw, name).toBeLessThanOrEqual(m.iw);
      await expect(nt.getByRole('button', { name: 'Customize' }), name).toBeVisible();
      if (name === 'all-hidden') {
        await nt.getByRole('button', { name: 'Customize' }).click();
        await expect(nt.getByRole('button', { name: 'Show Clock' })).toBeVisible();
      }
      await nt.close();
    }
  });

  test('corrupt stored layout (unknown ids, duplicates, wrong types) is normalised, not a crash', async ({ x, errors }) => {
    await patchSettings(x, (s) => ({ ...s, newTab: { ...(s.newTab ?? {}), layout: { main: ['clock', 'clock', 'evil<script>', 42, null], side: 'nope', hidden: ['search', 'search'] } } }));
    const nt = await x.open('newtab.html');
    await expect(nt.getByRole('button', { name: 'Customize' })).toBeVisible();
    await expect(nt.locator('time').first()).toBeVisible();
    await expect(nt.getByRole('search')).toHaveCount(0);
    expect(realErrors(errors)).toEqual([]);
  });

  test('keyboard-only customization: Tab to Customize, move with buttons, focus stays on the moved control', async ({ x }) => {
    const nt = await x.open('newtab.html');
    await nt.getByRole('button', { name: 'Customize' }).focus();
    await nt.keyboard.press('Enter');
    const up = nt.getByRole('button', { name: 'Move Spotify up' });
    await up.focus();
    await nt.keyboard.press('Enter');
    await expect.poll(async () => (await layoutOf(x))?.side.indexOf('spotify')).toBe(2);
    await nt.keyboard.press('Enter');
    // calendar, upcoming, focus, spotify → up×2 → index 1
    await expect.poll(async () => (await layoutOf(x))?.side.indexOf('spotify')).toBe(1);
    const focused = await nt.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    test.info().annotations.push({ type: 'focus-after-move', description: String(focused) });
    expect(focused).toMatch(/Spotify/);
  });

  test('BUG-NT21 · Settings "New Tab: daily quote" ON brings back a quote hidden via Customize', async ({ x }) => {
    const nt = await x.open('newtab.html');
    await nt.getByRole('button', { name: 'Customize' }).click();
    await nt.getByRole('button', { name: 'Hide Daily quote' }).click();
    await nt.getByRole('button', { name: 'Done' }).click();
    const s = await x.open('dashboard.html#/settings?section=layout');
    const toggle = s.getByRole('switch', { name: 'New Tab: daily quote' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await nt.bringToFront();
    await nt.reload();
    await expect(nt.locator('figure blockquote').first()).toBeVisible({ timeout: 3000 });
  });

  test('1366×768 default layout with lots of data: no horizontal scroll', async ({ x }) => {
    await x.set(wsSeed(8));
    const nt = await x.open('newtab.html');
    await nt.setViewportSize({ width: 1366, height: 768 });
    await nt.waitForTimeout(600);
    const m = await nt.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    test.info().annotations.push({ type: 'metrics', description: JSON.stringify(m) });
    expect(m.sw).toBeLessThanOrEqual(m.iw);
  });
});

/* ------------------------------------------------------------------ */
test.describe('V2.1 · Tabspace Bar on the New Tab', () => {
  const barSeed = (favs: number) => ({
    'ts.bookmarkFolders': [
      { id: 'dev', name: 'Dev tools', order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'sub', name: 'Nested docs', parentId: 'dev', order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'empty', name: 'Empty folder', order: 1, createdAt: 1, updatedAt: 1 },
    ],
    'ts.bookmarks': [
      ...Array.from({ length: favs }, (_, i) => ({ id: `f${i}`, url: `https://site${i}.example/`, title: `Favourite site number ${i}`, tags: [], favorite: true, createdAt: 1, updatedAt: 1 })),
      { id: 'm', url: 'https://developer.mozilla.org/', title: 'MDN', tags: [], favorite: false, folderId: 'dev', createdAt: 1, updatedAt: 1 },
      { id: 'n', url: 'https://nested.example/', title: 'Deep link', tags: [], favorite: false, folderId: 'sub', createdAt: 1, updatedAt: 1 },
      { id: 'js', url: 'javascript:alert(1)', title: 'Injected JS', tags: [], favorite: true, createdAt: 1, updatedAt: 1 },
    ],
    'ts.workspaces': [{ id: 'w', name: 'Job hunt', icon: 'briefcase', order: 0, createdAt: 1, updatedAt: 1 }],
    'ts.sessions': [{ id: 's', name: 'S', workspaceId: 'w', tabs: [{ id: 'a', url: 'https://qa.example/ws1', title: 'ws1', pinned: false }, { id: 'b', url: 'https://qa.example/ws2', title: 'ws2', pinned: false }], groups: [], createdAt: 1, updatedAt: 1 }],
  });

  test('favourites, nested folder dropdown, empty folder, overflow », no javascript: link', async ({ x }) => {
    await x.set(barSeed(20));
    await x.set(barSeed(3));
    const nt = await x.open('newtab.html');
    await nt.setViewportSize({ width: 1600, height: 760 });
    const bar = nt.getByRole('toolbar', { name: 'Tabspace Bar' });
    await expect(bar).toBeVisible();
    expect(await nt.locator('a[href^="javascript:"]').count()).toBe(0);
    await expect(bar.getByText('Injected JS')).toHaveCount(0);
    await bar.getByRole('button', { name: 'Dev tools' }).click();
    const menu = nt.getByRole('menu', { name: 'Dev tools' });
    await expect(menu.getByRole('menuitem', { name: /MDN/ })).toBeVisible();
    const nested = menu.getByRole('menuitem', { name: /Nested docs/ });
    await expect(nested).toBeVisible();
    await nested.click();
    await expect(nt.getByRole('menuitem', { name: /Deep link/ })).toBeVisible();
    await shot(nt, 'v21qa-newtab-bar-nested');
    await nt.keyboard.press('Escape');
    await x.set(barSeed(20));
    await nt.setViewportSize({ width: 1100, height: 760 });
    await nt.waitForTimeout(500);
    const overflow = bar.getByRole('button', { name: /more bookmarks?/ });
    await expect(overflow).toBeVisible();
    const label = await overflow.getAttribute('aria-label');
    await overflow.click();
    const om = nt.getByRole('menu', { name: label! });
    const count = await om.getByRole('menuitem').count();
    test.info().annotations.push({ type: 'overflow', description: `${label} → ${count} items` });
    expect(count).toBeGreaterThan(0);
    await nt.keyboard.press('Escape');
    // resize wider → fewer in overflow
    await nt.setViewportSize({ width: 1900, height: 760 });
    await nt.waitForTimeout(400);
    const label2 = await bar.getByRole('button', { name: /more bookmarks?/ }).getAttribute('aria-label').catch(() => 'none');
    test.info().annotations.push({ type: 'overflow-at-1600', description: String(label2) });
    const empty = bar.getByRole('button', { name: 'Empty folder' });
    if (await empty.count()) {
      await empty.click();
      await expect(nt.getByRole('menu', { name: 'Empty folder' })).toBeVisible();
      test.info().annotations.push({ type: 'empty-folder-menu', description: await nt.getByRole('menu', { name: 'Empty folder' }).innerText() });
    }
  });

  test('Workspaces menu opens the workspace (as a tab group with its tabs — V2.2)', async ({ x }) => {
    await x.context.route('https://qa.example/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>ws</title>' }));
    await x.set(barSeed(2));
    const nt = await x.open('newtab.html');
    const bar = nt.getByRole('toolbar', { name: 'Tabspace Bar' });
    await bar.getByRole('button', { name: 'Workspaces' }).click();
    const w = await x.worker();
    const before = await w.evaluate(async () => (await chrome.windows.getAll()).length);
    await nt.getByRole('menuitem', { name: /Job hunt/ }).click();
    await expect
      .poll(async () => w.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url || t.pendingUrl)), { timeout: 8000 })
      .toEqual(expect.arrayContaining(['https://qa.example/ws1', 'https://qa.example/ws2']));
    await expect.poll(async () => w.evaluate(async () => (await chrome.tabGroups.query({})).map((g) => g.title))).toContain('Job hunt');
    expect(await w.evaluate(async () => (await chrome.windows.getAll()).length)).toBe(before);
  });

  test('keyboard: roving focus with arrows across the bar, Enter opens a folder, Escape returns focus', async ({ x }) => {
    await x.set(barSeed(3));
    const nt = await x.open('newtab.html');
    const bar = nt.getByRole('toolbar', { name: 'Tabspace Bar' });
    await bar.getByRole('button', { name: 'Open Tabspace dashboard' }).focus();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await nt.keyboard.press('ArrowRight');
      seen.push((await nt.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim() || '')) ?? '');
    }
    test.info().annotations.push({ type: 'arrow-sequence', description: JSON.stringify(seen) });
    expect(new Set(seen).size).toBeGreaterThan(3);
    await bar.getByRole('button', { name: 'Dev tools' }).focus();
    await nt.keyboard.press('Enter');
    await expect(nt.getByRole('menu', { name: 'Dev tools' })).toBeVisible();
    await nt.keyboard.press('Escape');
    await expect(bar.getByRole('button', { name: 'Dev tools' })).toBeFocused();
  });

  test('bar hidden via Customize stays hidden after reload; Settings onNewTab off hides it too', async ({ x }) => {
    await x.set(barSeed(2));
    const nt = await x.open('newtab.html');
    await nt.getByRole('button', { name: 'Customize' }).click();
    await nt.getByRole('button', { name: 'Hide Tabspace Bar' }).click();
    await nt.getByRole('button', { name: 'Done' }).click();
    await nt.reload();
    await expect(nt.getByRole('toolbar', { name: 'Tabspace Bar' })).toHaveCount(0);
    await nt.getByRole('button', { name: 'Customize' }).click();
    await nt.getByRole('button', { name: 'Show Tabspace Bar' }).click();
    await nt.getByRole('button', { name: 'Done' }).click();
    await expect(nt.getByRole('toolbar', { name: 'Tabspace Bar' })).toBeVisible();
    await patchSettings(x, (s) => ({ ...s, tabspaceBar: { ...(s.tabspaceBar ?? {}), onNewTab: false } }));
    await expect(nt.getByRole('toolbar', { name: 'Tabspace Bar' })).toHaveCount(0);
  });
});
