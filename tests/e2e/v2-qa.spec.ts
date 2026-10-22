import type { BrowserContext, Page } from '@playwright/test';
import { expect, realErrors, relaunch, shot, storageGet, storageSet, sw, test, windowsSummary } from './helpers';

/**
 * Agent 5 — independent adversarial QA of Tabspace V2.
 * New Tab hub, popup timer + Quick Note, focus sync, XSS, data preservation.
 */

type Note = { id: string; title: string; content: string; trashedAt?: number };
type Focus = { status: string; kind: string; endAt?: number; remainingMs?: number; durationMs: number; completed?: { kind: string; at: number } };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const at = (h: number, dayOffset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

async function seedHub(context: BrowserContext, url: (n: string) => string) {
  const now = Date.now();
  await storageSet(context, {
    'ts.workspaces': [
      { id: 'w1', name: 'Development', icon: 'code', order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'w2', name: 'Empty space', icon: 'code', order: 1, createdAt: 1, updatedAt: 1 },
    ],
    'ts.sessions': [
      {
        id: 's1', name: 'Dev tabs', workspaceId: 'w1', createdAt: now, updatedAt: now,
        tabs: [
          { id: 'a', url: url('one'), title: 'one', pinned: false, groupId: 'g1' },
          { id: 'b', url: url('two'), title: 'two', pinned: false, groupId: 'g1' },
          { id: 'c', url: url('three'), title: 'three', pinned: false },
        ],
        groups: [{ id: 'g1', title: 'Docs', color: 'green', collapsed: false }],
      },
    ],
    'ts.tasks': [
      { id: 't1', title: 'Finish AI automation script', done: false, priority: 'high', subtasks: [], order: 0, dueDate: today(), createdAt: 1, updatedAt: 1 },
      { id: 't2', title: 'Someday thing', done: false, priority: 'none', subtasks: [], order: 1, someday: true, createdAt: 1, updatedAt: 1 },
    ],
    'ts.calendarSources': [{ id: 'cal1', name: 'Personal', kind: 'local', color: '#9aa0a6', enabled: true, createdAt: 1, updatedAt: 1 }],
    'ts.events': [
      { id: 'e1', sourceId: 'cal1', title: 'Content shoot', start: at(23, 0) > new Date().toISOString() ? at(23, 0) : at(10, 1), end: at(23, 0) > new Date().toISOString() ? new Date(new Date(at(23, 0)).getTime() + 30 * 60_000).toISOString() : at(11, 1), allDay: false, createdAt: 1, updatedAt: 1 },
    ],
    'ts.bookmarks': [
      { id: 'b1', url: 'https://github.com/', title: 'GitHub', tags: [], favorite: true, createdAt: 1, updatedAt: 1 },
      { id: 'b2', url: 'https://example.org/', title: 'Not a favourite', tags: [], favorite: false, createdAt: 1, updatedAt: 1 },
    ],
  });
}

function secs(clock: string) {
  const [m, s] = clock.trim().split(':').map(Number);
  return m * 60 + s;
}

async function timerLeft(page: Page): Promise<number> {
  const label = await page.getByRole('timer', { name: /^\d\d:\d\d remaining$/ }).first().getAttribute('aria-label');
  return secs(label!.replace(' remaining', ''));
}

test.describe('V2 · New Tab hub', () => {
  test('shows real data: workspaces (+counts), today tasks, upcoming event + calendar dot, favourite bookmarks only', async ({ context, open, web, errors }) => {
    await seedHub(context, web.url);
    const nt = await open('newtab.html');
    const main = nt.getByRole('main');
    await expect(main.getByRole('button', { name: 'Show workspace Development' })).toContainText('3 saved tabs');
    await expect(main.getByRole('button', { name: 'Open Empty space' })).toBeDisabled();
    await expect(main.getByRole('button', { name: 'Finish AI automation script' })).toBeVisible();
    await expect(main.getByText('Someday thing')).toHaveCount(0);
    await expect(nt.getByRole('region', { name: 'Upcoming events' }).getByText('Content shoot')).toBeVisible();
    const links = nt.getByRole('list', { name: 'Quick links' });
    await expect(links.getByRole('link', { name: 'GitHub' })).toBeVisible();
    await expect(links.getByRole('link', { name: 'Not a favourite' })).toHaveCount(0);
    const evDay = new Date((await storageGet<{ start: string }[]>(context, 'ts.events'))[0].start);
    const cell = nt.getByRole('gridcell', { name: new RegExp(`${evDay.toLocaleDateString('en-US', { month: 'long' })} ${evDay.getDate()}\\b`) }).first();
    await expect(cell).toHaveAttribute('aria-label', /has events/);
    expect(realErrors(errors)).toEqual([]);
  });

  test('1366×768: no vertical or horizontal scroll (seeded + example data); screenshots', async ({ context, open, dash, web }) => {
    await seedHub(context, web.url);
    const nt = await open('newtab.html');
    await nt.setViewportSize({ width: 1366, height: 768 });
    await nt.waitForTimeout(600);
    const m = await nt.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    await shot(nt, 'v2qa-newtab-1366x768', false);
    test.info().annotations.push({ type: 'metrics-seeded', description: JSON.stringify(m) });
    expect(m.sw).toBeLessThanOrEqual(m.iw);
    expect(m.sh).toBeLessThanOrEqual(m.ih);
    // Example data (more workspaces/tasks/links) must still fit
    const d = await dash('settings?section=data');
    await d.getByRole('button', { name: /Load example data/i }).click();
    await nt.bringToFront();
    await nt.reload();
    await nt.waitForTimeout(800);
    const m2 = await nt.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    await shot(nt, 'v2qa-newtab-1366x768-example', false);
    test.info().annotations.push({ type: 'metrics-example', description: JSON.stringify(m2) });
    expect(m2.sw).toBeLessThanOrEqual(m2.iw);
    expect(m2.sh).toBeLessThanOrEqual(m2.ih);
  });

  test('open a workspace from the New Tab → its tabs in order, as a native group named after the workspace (V2.2)', async ({ context, open, web }) => {
    await seedHub(context, web.url);
    const nt = await open('newtab.html');
    const before = await windowsSummary(context);
    await nt.getByRole('button', { name: 'Open Development' }).click();
    // V2.2 default: one tab group in the current window (no new window).
    await expect.poll(async () => (await windowsSummary(context)).flatMap((w) => w.groups).some((g) => g.title === 'Development'), { timeout: 8000 }).toBe(true);
    const after = await windowsSummary(context);
    expect(after.length).toBe(before.length);
    const win = after.find((w) => w.groups.some((g) => g.title === 'Development'))!;
    const urls = win.tabs.map((t) => t.url);
    const opened = [web.url('one'), web.url('two'), web.url('three')];
    expect(urls.filter((u) => opened.includes(u))).toEqual(opened);
  });

  test('task completed on the New Tab updates dashboard, side panel and popup-independent storage', async ({ context, open, dash, web }) => {
    await seedHub(context, web.url);
    const side = await open('sidepanel.html');
    await side.getByRole('tab', { name: 'Tasks' }).click();
    await expect(side.getByText('Finish AI automation script')).toBeVisible();
    const d = await dash('tasks?view=today');
    const nt = await open('newtab.html');
    await nt.getByRole('checkbox', { name: 'Complete "Finish AI automation script"' }).click();
    await expect.poll(async () => (await storageGet<{ id: string; done: boolean }[]>(context, 'ts.tasks')).find((t) => t.id === 't1')!.done).toBe(true);
    await d.bringToFront();
    await d.getByRole('tab', { name: /Completed/ }).click();
    await expect(d.getByRole('button', { name: 'Open task Finish AI automation script' })).toBeVisible();
    await side.bringToFront();
    await expect(side.getByRole('checkbox', { name: /Finish AI automation script/ })).toHaveCount(0, { timeout: 5000 }).catch(async () => {
      await expect(side.getByRole('checkbox', { name: /Finish AI automation script/ })).toHaveAttribute('aria-checked', 'true');
    });
    // Add from the New Tab → appears on dashboard
    await nt.bringToFront();
    await nt.getByRole('textbox', { name: 'Add a new task for today' }).fill('Go for a run');
    await nt.getByRole('textbox', { name: 'Add a new task for today' }).press('Enter');
    await d.bringToFront();
    await d.getByRole('tab', { name: /Today/ }).click();
    await expect(d.getByRole('button', { name: 'Open task Go for a run' })).toBeVisible();
  });

  test('focus started from the New Tab: popup, dashboard, side panel and badge agree within ±1 s', async ({ context, open, dash }) => {
    const nt = await open('newtab.html');
    await nt.getByRole('button', { name: 'Start focus session' }).click();
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus'))?.status).toBe('running');
    const d = await dash('focus');
    const side = await open('sidepanel.html');
    await side.getByRole('tab', { name: 'Focus' }).click();
    const popup = await open('popup.html');
    await popup.waitForTimeout(1300);
    const f = await storageGet<Focus>(context, 'ts.focus');
    for (let i = 0; i < 3; i++) {
      const [a, b, c, e] = await Promise.all([timerLeft(nt), timerLeft(d), timerLeft(side), timerLeft(popup)]);
      const truth = Math.ceil((f.endAt! - Date.now()) / 1000);
      const vals = { newtab: a, dashboard: b, side: c, popup: e, truth };
      test.info().annotations.push({ type: `sample-${i}`, description: JSON.stringify(vals) });
      for (const v of [a, b, c, e]) expect(Math.abs(v - truth), JSON.stringify(vals)).toBeLessThanOrEqual(1);
      await popup.waitForTimeout(1100);
    }
    const w = await sw(context);
    await expect.poll(() => w.evaluate(() => chrome.action.getBadgeText({}))).toMatch(/^2[45]m$/);
    // Pause from the popup → every surface shows the same frozen value
    await popup.getByRole('button', { name: 'Pause' }).click();
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status).toBe('paused');
    await popup.waitForTimeout(1500);
    const frozen = Math.ceil((await storageGet<Focus>(context, 'ts.focus')).remainingMs! / 1000);
    const pv = secs(await popup.getByRole('timer').innerText());
    expect(Math.abs(pv - frozen)).toBeLessThanOrEqual(1);
    for (const p of [nt, d, side]) {
      const lbl = await p.getByRole('timer', { name: /^\d\d:\d\d/ }).first().getAttribute('aria-label');
      expect(Math.abs(secs(lbl!.slice(0, 5)) - frozen), `${p.url()} ${lbl}`).toBeLessThanOrEqual(1);
    }
    await popup.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status).toBe('running');
    await popup.getByRole('button', { name: 'Stop' }).click();
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status).toBe('idle');
    await expect.poll(() => w.evaluate(() => chrome.action.getBadgeText({}))).toBe('');
  });

  test('popup countdown tracks the dashboard Focus page within ±1 s over 6 s', async ({ context, open, dash }) => {
    const d = await dash('focus');
    await d.getByRole('button', { name: 'Start Focus session' }).click();
    const popup = await open('popup.html');
    await popup.waitForTimeout(500);
    const drift: number[] = [];
    for (let i = 0; i < 6; i++) {
      const [p, q] = await Promise.all([secs(await popup.getByRole('timer').innerText()), timerLeft(d)]);
      drift.push(p - q);
      await popup.waitForTimeout(1000);
    }
    test.info().annotations.push({ type: 'popup-minus-dashboard', description: JSON.stringify(drift) });
    for (const x of drift) expect(Math.abs(x)).toBeLessThanOrEqual(1);
    expect((await storageGet<Focus>(context, 'ts.focus')).status).toBe('running');
  });

  test('"Session complete" state expires after a minute and does not resurrect', async ({ context, open, dash }) => {
    await storageSet(context, { 'ts.focus': { status: 'idle', kind: 'focus', durationMs: 25 * 60_000, completed: { kind: 'focus', at: Date.now() - 61_000 } } });
    const d = await dash('focus');
    const popup = await open('popup.html');
    await expect(d.getByText('Session complete')).toHaveCount(0);
    await expect(popup.getByText('Session complete')).toHaveCount(0);
    await storageSet(context, { 'ts.focus': { status: 'idle', kind: 'focus', durationMs: 25 * 60_000, completed: { kind: 'focus', at: Date.now() - 55_000 } } });
    await expect(popup.getByText('Session complete')).toBeVisible();
    await expect(popup.getByText('Session complete')).toHaveCount(0, { timeout: 12_000 });
  });
});

test.describe('V2 · Quick Note (popup)', () => {
  async function newNote(popup: Page) {
    await popup.getByRole('button', { name: 'New Note' }).click();
    const box = popup.getByRole('textbox', { name: /Quick note/ });
    await expect(box).toBeFocused();
    return box;
  }

  test('three notes in a row (third closed mid-typing): 3 distinct notes, exact text, no duplicates, no leftovers', async ({ context, open }) => {
    let popup = await open('popup.html');
    let box = await newNote(popup);
    await box.pressSequentially('First idea\nbody one', { delay: 5 });
    await expect(popup.getByText('Saved')).toBeVisible();
    await popup.getByRole('button', { name: 'Back' }).click();
    box = await newNote(popup);
    await box.pressSequentially('Second idea\nbody two', { delay: 5 });
    await popup.getByRole('button', { name: 'Back' }).click(); // immediately, inside the debounce
    await popup.close();
    popup = await open('popup.html');
    box = await newNote(popup);
    await box.pressSequentially('Third idea\nbody th', { delay: 5 });
    await expect(popup.getByText('Saved')).toBeVisible();
    await box.pressSequentially('ree and more', { delay: 0 });
    await popup.close();
    await open('popup.html');
    await expect
      .poll(async () => ((await storageGet<Note[]>(context, 'ts.notes')) ?? []).map((n) => `${n.title}|${n.content}`).sort(), { timeout: 8000 })
      .toEqual(['First idea|body one', 'Second idea|body two', 'Third idea|body three and more']);
    const w = await sw(context);
    await expect
      .poll(async () => w.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => /^ts\.(quicknote|notes\.unsaved)/.test(k))), { timeout: 8000 })
      .toEqual([]);
  });

  test('closing the popup within ~50 ms of the first keystroke still creates exactly one note (×3)', async ({ context, open }) => {
    for (const title of ['Alpha', 'Bravo', 'Charlie']) {
      const popup = await open('popup.html#note');
      await popup.getByRole('textbox', { name: /Quick note/ }).pressSequentially(title, { delay: 0 });
      await popup.close();
    }
    await open('popup.html');
    await expect.poll(async () => ((await storageGet<Note[]>(context, 'ts.notes')) ?? []).map((n) => n.title).sort(), { timeout: 10_000 }).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  test('Escape in the editor while typing saves (Esc closes the real popup)', async ({ context, open }) => {
    const popup = await open('popup.html');
    const box = await newNote(popup);
    await box.pressSequentially('Esc test\nline', { delay: 0 });
    await box.press('Escape');
    await popup.close();
    await open('popup.html');
    await expect.poll(async () => ((await storageGet<Note[]>(context, 'ts.notes')) ?? []).map((n) => `${n.title}|${n.content}`), { timeout: 8000 }).toEqual(['Esc test|line']);
  });

  test('XSS: hostile quick note renders inertly in Notes, dashboard, New Tab and side panel', async ({ context, open, dash }) => {
    const popup = await open('popup.html');
    const box = await newNote(popup);
    await box.fill('<img src=x onerror="window.__pwned=1;alert(1)">\n[click](javascript:alert(2)) <script>alert(3)</script> <svg onload=alert(4)>');
    await expect(popup.getByText('Saved')).toBeVisible();
    const [n] = await storageGet<Note[]>(context, 'ts.notes');
    const pages: Page[] = [];
    const dialogs: string[] = [];
    const track = (p: Page) => (pages.push(p), p.on('dialog', (dl) => (dialogs.push(dl.message()), void dl.dismiss())), p);
    const notes = track(await dash(`notes?id=${n.id}`));
    await notes.waitForTimeout(600);
    const dashboard = track(await dash('dashboard'));
    const nt = track(await open('newtab.html'));
    const side = track(await open('sidepanel.html'));
    await side.getByRole('tab', { name: 'Notes' }).click();
    await side.waitForTimeout(500);
    for (const p of [notes, dashboard, nt, side, popup]) {
      expect(await p.locator('[onerror],[onload],a[href^="javascript:"],script:not([src])').count(), p.url()).toBe(0);
      expect(await p.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    }
    const link = notes.getByRole('link', { name: 'click' });
    if (await link.count()) await link.click();
    await notes.waitForTimeout(400);
    expect(dialogs).toEqual([]);
  });

  test('attach page link: hostile page title cannot inject a javascript: link; non-http pages are never attached', async ({ context, web }) => {
    const w = await sw(context);
    const hostile = `${web.origin}/p/${encodeURIComponent('Evil](javascript:alert(1)) [x')}`;
    const target = await context.newPage();
    await target.goto(hostile);
    await target.bringToFront();
    const extId = new URL(w.url()).host;
    // Quick-note fallback window (what the Alt+Shift+N fallback opens), so the "last focused normal window" is the hostile page.
    const [qn] = await Promise.all([
      context.waitForEvent('page', (p) => p.url().includes('popup.html')),
      w.evaluate((u) => chrome.windows.create({ url: u, type: 'popup', width: 380, height: 560 }), `chrome-extension://${extId}/popup.html#note`),
    ]);
    const cb = qn.getByRole('checkbox', { name: "Attach this page's link" });
    await expect(cb).toBeVisible();
    if ((await cb.getAttribute('aria-checked')) !== 'true') await cb.click();
    await qn.getByRole('textbox', { name: /Quick note/ }).fill('Linked note\nsee page');
    await expect(qn.getByText('Saved')).toBeVisible();
    const [n] = await storageGet<Note[]>(context, 'ts.notes');
    test.info().annotations.push({ type: 'stored-content', description: n.content });
    const notes = await context.newPage();
    await notes.goto(`chrome-extension://${extId}/dashboard.html#/notes?id=${n.id}`);
    await notes.waitForTimeout(600);
    expect(await notes.locator('a[href^="javascript:"]').count()).toBe(0);
    const hrefs = await notes.locator('[aria-label="Note editor"] a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    test.info().annotations.push({ type: 'rendered-hrefs', description: JSON.stringify(hrefs) });
    for (const h of hrefs) expect(h.startsWith(web.origin) || h.startsWith('chrome-extension://')).toBe(true);
  });
});

test('BUG-QN1 · Quick Note "attach page link" keeps URLs with parentheses intact (e.g. Wikipedia)', async ({ context, web }) => {
  // Regression for BUG-QN1 (fixed: parentheses are percent-encoded).
  const w = await sw(context);
  const pageUrl = `${web.origin}/p/Mercury_(planet)`;
  const target = await context.newPage();
  await target.goto(pageUrl);
  const extId = new URL(w.url()).host;
  const [qn] = await Promise.all([
    context.waitForEvent('page', (p) => p.url().includes('popup.html')),
    w.evaluate((u) => chrome.windows.create({ url: u, type: 'popup', width: 380, height: 560 }), `chrome-extension://${extId}/popup.html#note`),
  ]);
  const cb = qn.getByRole('checkbox', { name: "Attach this page's link" });
  if ((await cb.getAttribute('aria-checked')) !== 'true') await cb.click();
  await qn.getByRole('textbox', { name: /Quick note/ }).fill('Planet facts\nread later');
  await expect(qn.getByText('Saved')).toBeVisible();
  const [n] = await storageGet<Note[]>(context, 'ts.notes');
  const notes = await context.newPage();
  await notes.goto(`chrome-extension://${extId}/dashboard.html#/notes?id=${n.id}`);
  const href = await notes.locator('[aria-label="Note editor"] a[href^="http"]').first().getAttribute('href');
  test.info().annotations.push({ type: 'stored', description: n.content + ' → href ' + href });
  expect(decodeURIComponent(href!)).toBe(pageUrl);
  await expect(notes.locator('[aria-label="Note editor"]')).not.toContainText(')(');
});

test.describe('V2 · data preservation (v1-shaped storage)', () => {
  test('BUG-MG1 · settings written in the first ~300 ms after install survive the install migration', async ({ context }) => {
    // Timing-dependent (reproduced 4/4 with no delay, 0/4 with ≥400 ms), so kept as fixme rather than test.fail.
    // runMigrations() (onInstalled) snapshots storage, then writes ts.settings = {...snapshot.settings, schemaVersion}
    // without the store's Web Lock, clobbering any settings written in between.
    await storageSet(context, { 'ts.settings': { schemaVersion: 1, userName: 'Alex' } }, { raw: true });
    await new Promise((r) => setTimeout(r, 1500));
    expect((await storageGet<{ userName?: string }>(context, 'ts.settings')).userName).toBe('Alex');
  });

  const V1_SETTINGS = {
    schemaVersion: 1, userName: 'Alex', theme: 'dark', starfield: true, animations: true, reducedMotion: false, showFigure: true, density: 'comfortable', textScale: 'md', defaultPage: 'tasks',
    dashboardWidgets: { quickActions: true, workspaces: true, tasks: true, recentTabs: true, savedLinks: true },
    sidebar: { enabled: true, sections: { focus: true, tasks: true, notes: true, bookmarks: true, workspaces: true }, defaultView: 'last' },
    newTab: { enabled: true, showQuote: false, showFocus: true, searchEngine: 'duckduckgo' },
    focus: { focusMin: 30, shortMin: 5, longMin: 15, customMin: 50, blockSites: false, blocklist: ['youtube.com'], showBadge: true, sessionsGoal: 6 },
    notifications: { tasks: true, events: true, focus: true }, analytics: { trackWebsites: false }, smartGrouping: { enabled: false, autoApply: false, rules: [] }, integrations: {},
  };
  const V1_DATA = {
    'ts.settings': V1_SETTINGS,
    'ts.workspaces': [{ id: 'w1', name: 'Job Search', icon: 'briefcase', order: 0, createdAt: 1, updatedAt: 1 }],
    'ts.sessions': [{ id: 's1', name: 'Old', workspaceId: 'w1', tabs: [{ id: 'x', url: 'https://example.com/', title: 'Example', pinned: false }], groups: [], createdAt: 1, updatedAt: 1 }],
    'ts.tasks': [{ id: 't1', title: 'Review job applications', done: false, priority: 'medium', subtasks: [{ id: 'st', title: 'CV', done: true }], order: 0, workspaceId: 'w1', createdAt: 1, updatedAt: 1 }],
    'ts.notes': [{ id: 'n1', title: 'Interview prep', content: '- STAR stories', tags: ['jobs'], favorite: true, workspaceId: 'w1', createdAt: 1, updatedAt: 1 }],
    'ts.bookmarks': [{ id: 'b1', url: 'https://linkedin.com/', title: 'LinkedIn', tags: [], favorite: false, createdAt: 1, updatedAt: 1 }],
    'ts.quickLinks': [{ id: 'q1', title: 'Gmail', url: 'https://mail.google.com/', order: 0 }],
    'ts.focusSessions': [{ id: 'f1', kind: 'focus', startedAt: 1, endedAt: 2, plannedMs: 1500000, actualMs: 1500000, completed: true, createdAt: 2, updatedAt: 2 }],
    'ts.focus': { status: 'idle', kind: 'focus', durationMs: 1800000 },
  };

  test('v1-shaped storage → restart → every surface works, records untouched, new settings defaulted', async ({ context, dir, errors }) => {
    test.setTimeout(120_000);
    // Let the install-time migration finish first (see BUG-MG1).
    await new Promise((r) => setTimeout(r, 1500));
    await storageSet(context, V1_DATA);
    // (chrome.runtime.reload() disables a --load-extension build in Playwright, so onInstalled:update can't be
    // simulated here; a full browser restart with v1 data is the closest automatable upgrade path.)
    await context.close();
    const r = await relaunch(dir, errors);
    const ctx = r.context;
    const open = async (path: string) => {
      const p = await ctx.newPage();
      await p.goto(`chrome-extension://${r.extensionId}/${path}`);
      return p;
    };
    const dash = async (route: string) => {
      const p = await open(`dashboard.html#/${route}`);
      await expect(p.getByRole('heading', { level: 1 }).first()).toBeVisible();
      return p;
    };
    try {
    for (const r of ['dashboard', 'workspaces', 'tasks', 'notes', 'bookmarks', 'focus', 'analytics', 'settings', 'calendar', 'tabs', 'sidebar']) {
      const p = await dash(r);
      await p.waitForTimeout(300);
      await p.close();
    }
    for (const p of ['newtab.html', 'popup.html', 'sidepanel.html', 'popup.html#note']) {
      const pg = await open(p);
      await pg.waitForTimeout(600);
      if (p !== 'popup.html#note') await pg.close();
    }
    const probe = await open('popup.html');
    const after = await probe.evaluate(async () => chrome.storage.local.get(null));
    for (const k of ['ts.workspaces', 'ts.sessions', 'ts.tasks', 'ts.notes', 'ts.bookmarks', 'ts.quickLinks', 'ts.focusSessions'] as const) {
      expect(after[k], k).toEqual((V1_DATA as Record<string, unknown>)[k]);
    }
    const s = after['ts.settings'] as typeof V1_SETTINGS & Record<string, unknown>;
    test.info().annotations.push({ type: 'settings-after', description: JSON.stringify(s) });
    for (const [k, v] of Object.entries(V1_SETTINGS)) {
      if (typeof v !== 'object') expect(s[k], k).toEqual(v);
    }
    expect(s.focus).toMatchObject(V1_SETTINGS.focus);
    expect(s.newTab).toMatchObject(V1_SETTINGS.newTab);
    // New V2 settings take defaults in the UI
    const settings = await dash('settings');
    await expect(settings.getByRole('switch', { name: 'Background movement (parallax)' })).toHaveAttribute('aria-checked', 'true');
    await expect(settings.getByRole('switch', { name: 'Completion sound' })).toHaveAttribute('aria-checked', 'true');
    await expect(settings.getByRole('switch', { name: /Quick Note: attach/ })).toHaveAttribute('aria-checked', 'false');
    await expect(settings.getByRole('spinbutton', { name: 'Focus session minutes' })).toHaveValue('30');
    // The user's v1 values still drive behaviour
    const popup = await open('popup.html');
    await expect(popup.getByRole('timer')).toHaveText('30:00');
    expect(realErrors(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('V2 · completion side effects', () => {
  test('sound off → completion records + notifies but plays no chime (no offscreen document)', async ({ context, open }) => {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await storageGet<Record<string, unknown> & { focus?: Record<string, unknown> }>(context, 'ts.settings');
    await storageSet(context, { 'ts.settings': { ...(s ?? {}), focus: { ...(s?.focus ?? {}), sound: false } } });
    await open('popup.html');
    const now = Date.now();
    await storageSet(context, { 'ts.focus': { status: 'running', kind: 'focus', durationMs: 60_000, startedAt: now - 61_000, endAt: now - 1000 } });
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status, { timeout: 10_000 }).toBe('idle');
    const w = await sw(context);
    await new Promise((r) => setTimeout(r, 1000));
    const r = await w.evaluate(async () => ({
      chime: (await chrome.storage.session.get('ts.session.lastChime'))['ts.session.lastChime'],
      offscreen: (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] })).length,
      notes: Object.keys(await new Promise<object>((res) => chrome.notifications.getAll(res))),
    }));
    expect(r.chime).toBeUndefined();
    expect(r.offscreen).toBe(0);
    expect(r.notes.some((id) => id.startsWith('ts-focus-'))).toBe(true);
    expect((await storageGet<unknown[]>(context, 'ts.focusSessions')).length).toBe(1);
  });

  test('two completions back-to-back reuse/close the offscreen document without errors', async ({ context, open, errors }) => {
    await open('popup.html');
    for (let i = 0; i < 2; i++) {
      const now = Date.now();
      await storageSet(context, { 'ts.focus': { status: 'running', kind: 'focus', durationMs: 60_000, startedAt: now - 61_000, endAt: now - 1000 } });
      await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status, { timeout: 10_000 }).toBe('idle');
      await new Promise((r) => setTimeout(r, 500));
    }
    expect((await storageGet<unknown[]>(context, 'ts.focusSessions')).length).toBe(2);
    const w = await sw(context);
    expect((await w.evaluate(async () => (await chrome.storage.session.get('ts.session.lastChime'))['ts.session.lastChime'])) as { ok: boolean }).toMatchObject({ ok: true });
    expect(realErrors(errors)).toEqual([]);
  });
});
