import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { DIST } from './fixtures';
import { attachErrorCollector, expect, realErrors, shot, storageGet, storageSet, sw, test, windowsSummary } from './helpers';

/**
 * V2.2 · Workspaces as native Chrome tab groups (real Chromium, local http server).
 */

type Link = { workspaceId: string; groupId?: number; windowId?: number; color: string; open: boolean };
type Session = { workspaceId?: string; archived?: boolean; updatedAt: number; tabs: { url: string }[] };

async function seed(context: BrowserContext, url: (n: string) => string) {
  const now = Date.now();
  const mk = (id: string, workspaceId: string, names: string[]) => ({
    id,
    name: id,
    workspaceId,
    createdAt: now,
    updatedAt: now,
    groups: [],
    tabs: names.map((n, i) => ({ id: `${id}-${i}`, url: url(n), title: n, pinned: false })),
  });
  await storageSet(context, {
    'ts.workspaces': [
      { id: 'dev', name: 'Development', icon: 'code', order: 0, createdAt: now, updatedAt: now },
      { id: 'jobs', name: 'Job Search', icon: 'briefcase', order: 1, createdAt: now, updatedAt: now },
    ],
    'ts.sessions': [mk('sd', 'dev', ['dev-a', 'dev-b', 'dev-c']), mk('sj', 'jobs', ['job-a', 'job-b'])],
  });
}

async function savedUrls(context: BrowserContext, workspaceId: string) {
  const sessions = await storageGet<Session[]>(context, 'ts.sessions');
  return sessions.filter((s) => s.workspaceId === workspaceId && !s.archived).sort((a, b) => b.updatedAt - a.updatedAt)[0].tabs.map((t) => t.url);
}

async function openAsGroup(page: Page, name: string) {
  await page.bringToFront();
  await page.getByRole('button', { name: `Open ${name} as a tab group` }).click();
}

async function groupsOf(context: BrowserContext) {
  const wins = await windowsSummary(context);
  return wins.flatMap((w) => w.groups.map((g) => ({ ...g, windowId: w.id, urls: w.tabs.filter((t) => t.groupId === g.id).map((t) => t.url) })));
}

test.describe('V2.2 · workspaces as native tab groups', () => {
  test('two workspaces open as two named, coloured groups in one window; reopening never duplicates', async ({ dash, context, web, errors }) => {
    await seed(context, web.url);
    const page = await dash('workspaces');
    const windowId = await page.evaluate(async () => (await chrome.windows.getCurrent()).id!);
    await openAsGroup(page, 'Development');
    await expect(page.getByRole('status').filter({ hasText: /Opened 3 tabs as the “Development” tab group/ })).toBeVisible();
    await openAsGroup(page, 'Job Search');
    await expect.poll(async () => (await groupsOf(context)).map((g) => g.title).sort()).toEqual(['Development', 'Job Search']);

    const groups = await groupsOf(context);
    const links = await storageGet<Link[]>(context, 'ts.workspaceGroupLinks');
    const dev = groups.find((g) => g.title === 'Development')!;
    const jobs = groups.find((g) => g.title === 'Job Search')!;
    expect(dev.windowId).toBe(windowId);
    expect(jobs.windowId).toBe(windowId);
    expect(dev.urls).toEqual(['dev-a', 'dev-b', 'dev-c'].map(web.url));
    expect(jobs.urls).toEqual(['job-a', 'job-b'].map(web.url));
    expect(dev.color).toBe(links.find((l) => l.workspaceId === 'dev')!.color);
    expect(jobs.color).toBe(links.find((l) => l.workspaceId === 'jobs')!.color);
    expect(dev.color).not.toBe(jobs.color);
    expect((await windowsSummary(context)).length).toBe(1);

    // Live indicator on the card
    await page.bringToFront();
    await expect(page.getByRole('group', { name: 'Development tab group is open' })).toContainText('Open · 3 tabs');
    await shot(page, 'v22-workspace-groups');

    // Reopen Development: no new tabs, focused instead
    const before = (await windowsSummary(context))[0].tabs.length;
    await openAsGroup(page, 'Development');
    await expect(page.getByRole('status').filter({ hasText: /“Development” is already open/ })).toBeVisible();
    expect((await windowsSummary(context))[0].tabs.length).toBe(before);
    expect((await groupsOf(context)).filter((g) => g.title === 'Development')).toHaveLength(1);
    expect(realErrors(errors)).toEqual([]);
  });

  test('collapse other workspace groups when switching (setting from the Workspaces page gear)', async ({ dash, context, web }) => {
    await seed(context, web.url);
    const page = await dash('workspaces');
    await page.getByRole('button', { name: 'Workspace tab group settings' }).click();
    const dlg = page.getByRole('dialog', { name: 'Workspace tab groups' });
    await dlg.getByRole('switch', { name: 'Collapse other workspace groups when switching' }).click();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await storageGet<{ workspaceGroups: { collapseOthers: boolean } }>(context, 'ts.settings')).workspaceGroups.collapseOthers).toBe(true);

    await openAsGroup(page, 'Development');
    await expect.poll(async () => (await groupsOf(context)).length).toBe(1);
    await openAsGroup(page, 'Job Search');
    await expect.poll(async () => Object.fromEntries((await groupsOf(context)).map((g) => [g.title, g.collapsed]))).toEqual({ Development: true, 'Job Search': false });

    // Switching to a Development tab (worker: tabs.onActivated) collapses Job Search
    const w = await sw(context);
    const devTab = (await windowsSummary(context))[0].tabs.find((t) => t.url === web.url('dev-b'))!;
    await w.evaluate(async (id) => chrome.tabs.update(id, { active: true }), devTab.id);
    await expect.poll(async () => Object.fromEntries((await groupsOf(context)).map((g) => [g.title, g.collapsed]))).toEqual({ Development: false, 'Job Search': true });
  });

  test('moving a tab between groups moves it between workspaces; closing a group keeps saved tabs and reopens them', async ({ dash, context, web }) => {
    await seed(context, web.url);
    const page = await dash('workspaces');
    await openAsGroup(page, 'Development');
    await openAsGroup(page, 'Job Search');
    await expect.poll(async () => (await groupsOf(context)).length).toBe(2);
    const w = await sw(context);
    const groups = await groupsOf(context);
    const jobs = groups.find((g) => g.title === 'Job Search')!;
    const devB = (await windowsSummary(context))[0].tabs.find((t) => t.url === web.url('dev-b'))!;
    // "Drag" dev-b into the Job Search group
    await w.evaluate(async ({ tabId, groupId }) => chrome.tabs.group({ tabIds: [tabId], groupId }), { tabId: devB.id, groupId: jobs.id });
    await expect.poll(() => savedUrls(context, 'dev')).toEqual(['dev-a', 'dev-c'].map(web.url));
    await expect.poll(() => savedUrls(context, 'jobs')).toEqual(['job-a', 'job-b', 'dev-b'].map(web.url));

    // Close the whole Job Search group: saved tabs stay
    const jobTabs = (await windowsSummary(context))[0].tabs.filter((t) => t.groupId === jobs.id).map((t) => t.id);
    await w.evaluate(async (ids) => chrome.tabs.remove(ids), jobTabs);
    await expect.poll(async () => (await storageGet<Link[]>(context, 'ts.workspaceGroupLinks')).find((l) => l.workspaceId === 'jobs')?.open).toBe(false);
    expect(await savedUrls(context, 'jobs')).toEqual(['job-a', 'job-b', 'dev-b'].map(web.url));

    // Reopen: the same saved tabs come back as a fresh group
    await openAsGroup(page, 'Job Search');
    await expect.poll(async () => (await groupsOf(context)).find((g) => g.title === 'Job Search')?.urls).toEqual(['job-a', 'job-b', 'dev-b'].map(web.url));
  });

  test('after a Chrome restart groups are re-linked and reopening does not duplicate', async ({ dash, context, web, dir, errors }) => {
    await seed(context, web.url);
    const page = await dash('workspaces');
    await openAsGroup(page, 'Development');
    await expect.poll(async () => (await groupsOf(context)).length).toBe(1);
    await expect.poll(async () => (await storageGet<Link[] | undefined>(context, 'ts.workspaceGroupLinks'))?.[0]?.open).toBe(true);
    const oldGroupId = (await storageGet<Link[]>(context, 'ts.workspaceGroupLinks'))[0].groupId;
    await page.waitForTimeout(1500); // let Chrome persist the session
    await context.close();

    // Same profile, plus --restore-last-session so Chromium restores the windows/tab groups it had.
    const relaunched = await chromium.launchPersistentContext(dir, {
      channel: 'chromium',
      headless: process.env.HEADED ? false : true,
      viewport: { width: 1536, height: 1000 },
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--restore-last-session'],
    });
    attachErrorCollector(relaunched, errors);
    const worker = relaunched.serviceWorkers()[0] ?? (await relaunched.waitForEvent('serviceworker'));
    const r = { context: relaunched, extensionId: new URL(worker.url()).host };
    try {
      const ctx = r.context;
      // Chromium restores the window with the "Development" group under a new runtime group id.
      await expect.poll(async () => (await groupsOf(ctx)).some((g) => g.title === 'Development'), { timeout: 10_000 }).toBe(true);
      const live = (await groupsOf(ctx)).find((g) => g.title === 'Development')!;
      expect(live.id).not.toBe(oldGroupId);
      // The worker re-links the workspace to it by title.
      await expect.poll(async () => (await storageGet<Link[]>(ctx, 'ts.workspaceGroupLinks'))[0], { timeout: 10_000 }).toMatchObject({ open: true, groupId: live.id });
      const page2 = await ctx.newPage();
      await page2.goto(`chrome-extension://${r.extensionId}/dashboard.html#/workspaces`);
      await expect(page2.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page2.getByRole('group', { name: 'Development tab group is open' })).toBeVisible();
      await openAsGroup(page2, 'Development');
      await expect.poll(async () => (await groupsOf(ctx)).filter((g) => g.title === 'Development').length).toBe(1);
      await page2.waitForTimeout(500);
      const devTabs = (await windowsSummary(ctx)).flatMap((w) => w.tabs).filter((t) => t.url.startsWith(web.url('dev-')));
      expect(devTabs.map((t) => t.url).sort()).toEqual(['dev-a', 'dev-b', 'dev-c'].map(web.url));
      expect(await savedUrls(ctx, 'dev')).toEqual(['dev-a', 'dev-b', 'dev-c'].map(web.url));
    } finally {
      await r.context.close();
    }
  });
});

test.describe('V2.2 · QA follow-ups', () => {
  test('OBS-1 · after ungrouping a workspace group, reopening regroups the loose tabs instead of duplicating', async ({ dash, context, web }) => {
    await seed(context, web.url);
    const page = await dash('workspaces');
    await openAsGroup(page, 'Development');
    await expect.poll(async () => (await groupsOf(context)).length).toBe(1);
    await expect.poll(async () => (await storageGet<Link[] | undefined>(context, 'ts.workspaceGroupLinks'))?.[0]?.open).toBe(true);
    const w = await sw(context);
    const dev = (await groupsOf(context))[0];
    const ids = (await windowsSummary(context))[0].tabs.filter((t) => t.groupId === dev.id).map((t) => t.id);
    await w.evaluate(async (tabIds) => chrome.tabs.ungroup(tabIds as [number, ...number[]]), ids);
    await expect.poll(async () => (await storageGet<Link[]>(context, 'ts.workspaceGroupLinks'))[0].open).toBe(false);
    await page.waitForTimeout(1000);
    expect(await savedUrls(context, 'dev')).toEqual(['dev-a', 'dev-b', 'dev-c'].map(web.url)); // ungroup-all keeps saved tabs
    await openAsGroup(page, 'Development');
    await expect(page.getByRole('status').filter({ hasText: /reused 3 open tabs/ })).toBeVisible();
    await expect.poll(async () => (await groupsOf(context)).find((g) => g.title === 'Development')?.urls).toEqual(['dev-a', 'dev-b', 'dev-c'].map(web.url));
    const all = (await windowsSummary(context)).flatMap((x) => x.tabs).filter((t) => t.url.startsWith(web.url('dev-')));
    expect(all).toHaveLength(3);
  });

  test('OBS-2 · a tab dragged out of a workspace group can be restored from "Recently removed by tab moves"', async ({ dash, context, web }) => {
    await seed(context, web.url);
    const page = await dash('workspaces');
    await openAsGroup(page, 'Development');
    await expect.poll(async () => (await groupsOf(context)).length).toBe(1);
    await expect.poll(async () => (await storageGet<Link[] | undefined>(context, 'ts.workspaceGroupLinks'))?.[0]?.open).toBe(true);
    await page.waitForTimeout(1500); // let the worker map the group's tabs
    const w = await sw(context);
    const devB = (await windowsSummary(context))[0].tabs.find((t) => t.url === web.url('dev-b'))!;
    await w.evaluate(async (id) => chrome.tabs.ungroup(id), devB.id);
    await expect.poll(() => savedUrls(context, 'dev')).toEqual(['dev-a', 'dev-c'].map(web.url));
    await page.bringToFront();
    await page.evaluate(() => (location.hash = '#/workspaces?id=dev'));
    await expect(page.getByRole('heading', { name: 'Recently removed by tab moves (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore dev-b to saved tabs' }).click();
    await expect.poll(() => savedUrls(context, 'dev')).toEqual(['dev-a', 'dev-b', 'dev-c'].map(web.url));
    await expect(page.getByRole('heading', { name: /Recently removed by tab moves/ })).toBeHidden();
  });
});
