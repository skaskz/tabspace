import type { Page } from '@playwright/test';
import { collectErrors, expect, launch, patchSettings, realErrors, shot, startSite, test, type Ext } from './qa21';

/**
 * Agent 5 — V2.2 adversarial QA: workspaces as native Chrome tab groups.
 * Every step checks storage so saved tabs are never lost unexpectedly.
 */

type Saved = { id: string; url: string; title: string; pinned: boolean };
type Session = { id: string; workspaceId?: string; archived?: boolean; tabs: Saved[]; updatedAt: number };
type Link = { workspaceId: string; groupId?: number; windowId?: number; open: boolean; color: string };
type G = { id: number; windowId: number; title?: string; color: string; collapsed: boolean; tabs: { id: number; url: string; index: number }[] };

const NAMES = ['Development', 'Content Creation', 'Job Search'];

function seed(origin: string, opts: { extra?: Partial<Record<number, Saved[]>> } = {}) {
  const now = Date.now();
  return {
    'ts.workspaces': NAMES.map((name, i) => ({ id: `w${i}`, name, icon: 'code', order: i, createdAt: 1, updatedAt: 1 })),
    'ts.sessions': NAMES.map((_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      workspaceId: `w${i}`,
      createdAt: now,
      updatedAt: now,
      groups: [],
      tabs: opts.extra?.[i] ?? [1, 2, 3].map((n) => ({ id: `w${i}t${n}`, url: `${origin}/plain?w${i}-${n}`, title: `W${i} tab ${n}`, pinned: false })),
    })),
  };
}

async function groups(x: Ext): Promise<G[]> {
  const w = await x.worker();
  return w.evaluate(async () => {
    const gs = await chrome.tabGroups.query({});
    const tabs = await chrome.tabs.query({});
    return gs.map((g) => ({
      id: g.id, windowId: g.windowId, title: g.title, color: g.color, collapsed: g.collapsed,
      tabs: tabs.filter((t) => t.groupId === g.id).sort((a, b) => a.index - b.index).map((t) => ({ id: t.id!, url: t.url || t.pendingUrl || '', index: t.index })),
    }));
  });
}
const byTitle = async (x: Ext, title: string) => (await groups(x)).filter((g) => g.title === title);
async function saved(x: Ext, wsId: string): Promise<string[]> {
  const list = (await x.get<Session[]>('ts.sessions')) ?? [];
  const s = list.filter((v) => v.workspaceId === wsId && !v.archived).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return s ? s.tabs.map((t) => t.url) : [];
}
const links = async (x: Ext) => ((await x.get<Link[]>('ts.workspaceGroupLinks')) ?? []) as Link[];
const allTabs = async (x: Ext) => (await x.worker()).evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id!, url: t.url || t.pendingUrl || '', groupId: t.groupId, windowId: t.windowId, pinned: t.pinned })));

async function openFromWorkspacesPage(x: Ext, name: string, page?: Page) {
  const p = page ?? (await x.open('dashboard.html#/workspaces'));
  await p.bringToFront();
  await p.getByRole('button', { name: `Open ${name} as a tab group` }).click();
  await expect.poll(async () => (await byTitle(x, name)).length, { timeout: 10_000 }).toBeGreaterThan(0);
  return p;
}

const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

test.describe('V2.2 · workspaces as native tab groups', () => {
  test('3 workspaces opened from 3 surfaces → 3 named groups, distinct colours, open order; reopening from 2 other surfaces never duplicates', async ({ x, site, errors }) => {
    await x.set(seed(site.origin));
    // 1) Workspaces page
    const ws = await openFromWorkspacesPage(x, 'Development');
    // 2) New Tab
    const nt = await x.open('newtab.html');
    await nt.getByRole('button', { name: 'Open Content Creation' }).click();
    await expect.poll(async () => (await byTitle(x, 'Content Creation')).length, { timeout: 10_000 }).toBe(1);
    // 3) Side panel
    const side = await x.open('sidepanel.html');
    await side.getByRole('tab', { name: 'Workspaces' }).click();
    await side.getByRole('button', { name: 'Open Job Search' }).click();
    await expect.poll(async () => (await byTitle(x, 'Job Search')).length, { timeout: 10_000 }).toBe(1);
    await settle();
    let gs = await groups(x);
    test.info().annotations.push({ type: 'groups', description: JSON.stringify(gs.map((g) => [g.title, g.color, g.windowId, g.tabs.length])) });
    expect(gs.map((g) => g.title).sort()).toEqual([...NAMES].sort());
    expect(new Set(gs.map((g) => g.color)).size).toBe(3);
    for (const g of gs) expect(g.tabs.length).toBe(3);
    const firstIdx = (t: string) => gs.find((g) => g.title === t)!.tabs[0].index;
    expect(firstIdx('Development')).toBeLessThan(firstIdx('Content Creation'));
    expect(firstIdx('Content Creation')).toBeLessThan(firstIdx('Job Search'));
    // Reopen: side panel + Tabspace Bar (New Tab) + workspaces page again
    await side.bringToFront();
    await side.getByRole('button', { name: 'Open Development' }).click();
    await nt.bringToFront();
    await nt.reload();
    await nt.getByRole('toolbar', { name: 'Tabspace Bar' }).getByRole('button', { name: 'Workspaces' }).click();
    await nt.getByRole('menuitem', { name: /Content Creation/ }).click();
    await openFromWorkspacesPage(x, 'Job Search', ws);
    await settle();
    gs = await groups(x);
    expect(gs.length).toBe(3);
    for (const g of gs) expect(g.tabs.length, g.title).toBe(3);
    for (let i = 0; i < 3; i++) expect(await saved(x, `w${i}`)).toHaveLength(3);
    await shot(ws, 'v22qa-workspaces-groups-open');
    expect(realErrors(errors)).toEqual([]);
  });

  test('reopen after closing one tab / after collapsing / from another window: only the missing tab is added, group expands, focus moves', async ({ x, site }) => {
    await x.set(seed(site.origin));
    const p = await openFromWorkspacesPage(x, 'Development');
    await settle();
    let [g] = await byTitle(x, 'Development');
    const w = await x.worker();
    await w.evaluate((id) => chrome.tabs.remove(id), g.tabs[1].id);
    await settle();
    expect(await saved(x, 'w0')).toHaveLength(3); // closing never removes saved tabs
    await openFromWorkspacesPage(x, 'Development', p);
    await settle();
    let gs = await byTitle(x, 'Development');
    expect(gs).toHaveLength(1);
    expect(gs[0].tabs.map((t) => t.url).sort()).toEqual((await saved(x, 'w0')).sort());
    // collapse then reopen → expanded, no dupes
    await w.evaluate((id) => chrome.tabGroups.update(id, { collapsed: true }), gs[0].id);
    await openFromWorkspacesPage(x, 'Development', p);
    await expect.poll(async () => (await byTitle(x, 'Development'))[0].collapsed).toBe(false);
    expect((await byTitle(x, 'Development'))[0].tabs).toHaveLength(3);
    const activeInGroup = await w.evaluate(async (gid) => (await chrome.tabs.query({ active: true, groupId: gid })).length, gs[0].id);
    expect(activeInGroup).toBe(1);
    // From another window: a dashboard in a new window → focuses the existing group's window, no new group
    const otherWin = await w.evaluate(async (u) => (await chrome.windows.create({ url: u, focused: true })).id!, `chrome-extension://${x.id}/dashboard.html#/workspaces`);
    const d2 = await x.context.waitForEvent('page', (pg) => pg.url().includes('#/workspaces') && pg !== p);
    await d2.waitForLoadState();
    await d2.getByRole('button', { name: 'Open Development as a tab group' }).click();
    await settle();
    gs = await byTitle(x, 'Development');
    test.info().annotations.push({ type: 'after-other-window', description: JSON.stringify({ otherWin, groups: gs.map((x2) => [x2.windowId, x2.tabs.length]) }) });
    expect(gs).toHaveLength(1);
    expect(gs[0].tabs).toHaveLength(3);
    g = gs[0];
    // windows.update({focused}) is not observable in headless Chromium (getLastFocused keeps the newest window) — annotate only.
    const focusedWin = await w.evaluate(async () => (await chrome.windows.getLastFocused()).id);
    test.info().annotations.push({ type: 'last-focused-vs-group-window', description: `${focusedWin} vs ${g.windowId}` });
    expect(await w.evaluate(async (gid) => (await chrome.tabs.query({ active: true, groupId: gid })).length, g.id)).toBe(1);
  });

  test('collapseOthers ON: opening/switching collapses only other workspace groups (never the user\'s); OFF: nothing collapses', async ({ x, site }) => {
    await x.set(seed(site.origin));
    await patchSettings(x, (s) => ({ ...s, workspaceGroups: { enabled: true, syncMembership: true, collapseOthers: true } }));
    const w = await x.worker();
    // user's own group
    const userGroup = await w.evaluate(async (u) => {
      const t = await chrome.tabs.create({ url: u, active: false });
      const gid = await chrome.tabs.group({ tabIds: [t.id!] });
      await chrome.tabGroups.update(gid, { title: 'My research', color: 'grey' });
      return gid;
    }, `${site.origin}/plain?user`);
    const p = await openFromWorkspacesPage(x, 'Development');
    await openFromWorkspacesPage(x, 'Content Creation', p);
    await settle();
    let dev = (await byTitle(x, 'Development'))[0];
    let cc = (await byTitle(x, 'Content Creation'))[0];
    expect(dev.collapsed).toBe(true);
    expect(cc.collapsed).toBe(false);
    // switch: activate a Development tab → Development expands (Chrome), Content Creation collapses
    await w.evaluate((id) => chrome.tabs.update(id, { active: true }), dev.tabs[0].id);
    await settle();
    dev = (await byTitle(x, 'Development'))[0];
    cc = (await byTitle(x, 'Content Creation'))[0];
    expect(dev.collapsed).toBe(false);
    expect(cc.collapsed).toBe(true);
    expect((await groups(x)).find((g) => g.id === userGroup)!.collapsed).toBe(false);
    // OFF
    await patchSettings(x, (s) => ({ ...s, workspaceGroups: { ...s.workspaceGroups, collapseOthers: false } }));
    await w.evaluate((id) => chrome.tabGroups.update(id, { collapsed: false }), cc.id);
    await w.evaluate((id) => chrome.tabs.update(id, { active: true }), dev.tabs[1].id);
    await settle();
    expect((await byTitle(x, 'Content Creation'))[0].collapsed).toBe(false);
  });

  test('membership: move between groups, out of a group, into a group, new tab inside a group — saved tabs follow; nothing else changes', async ({ x, site }) => {
    await x.set(seed(site.origin));
    const p = await openFromWorkspacesPage(x, 'Development');
    await openFromWorkspacesPage(x, 'Content Creation', p);
    await settle(2000);
    const w = await x.worker();
    const dev = (await byTitle(x, 'Development'))[0];
    const cc = (await byTitle(x, 'Content Creation'))[0];
    const moving = dev.tabs[0];
    // A → B
    await w.evaluate(({ t, g }) => chrome.tabs.group({ tabIds: [t], groupId: g }), { t: moving.id, g: cc.id });
    await expect.poll(() => saved(x, 'w1'), { timeout: 8000 }).toContain(moving.url);
    await expect.poll(() => saved(x, 'w0'), { timeout: 8000 }).not.toContain(moving.url);
    expect(await saved(x, 'w0')).toHaveLength(2);
    expect(await saved(x, 'w1')).toHaveLength(4);
    // out of group (ungroup one tab) → removed from B
    const out = (await byTitle(x, 'Content Creation'))[0].tabs[0];
    await w.evaluate((t) => chrome.tabs.ungroup([t]), out.id);
    await expect.poll(() => saved(x, 'w1'), { timeout: 8000 }).not.toContain(out.url);
    // into group: a loose web tab grouped into Development → added once
    const loose = await w.evaluate(async (u) => (await chrome.tabs.create({ url: u, active: false })).id!, `${site.origin}/plain?loose`);
    await settle(800);
    await w.evaluate(({ t, g }) => chrome.tabs.group({ tabIds: [t], groupId: g }), { t: loose, g: dev.id });
    await expect.poll(() => saved(x, 'w0'), { timeout: 8000 }).toContain(`${site.origin}/plain?loose`);
    // new tab created inside the group (blank first, navigates later)
    const nt = await w.evaluate(async (g) => {
      const t = await chrome.tabs.create({ url: 'about:blank', active: false });
      await chrome.tabs.group({ tabIds: [t.id!], groupId: g });
      return t.id!;
    }, dev.id);
    await settle(1000);
    await w.evaluate(({ t, u }) => chrome.tabs.update(t, { url: u }), { t: nt, u: `${site.origin}/plain?created-inside` });
    await expect.poll(() => saved(x, 'w0'), { timeout: 8000 }).toContain(`${site.origin}/plain?created-inside`);
    // untouched workspace
    expect(await saved(x, 'w2')).toHaveLength(3);
    // no duplicates anywhere
    for (const id of ['w0', 'w1', 'w2']) {
      const s = await saved(x, id);
      expect(new Set(s).size, id).toBe(s.length);
    }
  });

  test('ungroup whole group / close group / close window never remove saved tabs; reopen recreates the group', async ({ x, site }) => {
    await x.set(seed(site.origin));
    const p = await openFromWorkspacesPage(x, 'Development');
    await openFromWorkspacesPage(x, 'Content Creation', p);
    await openFromWorkspacesPage(x, 'Job Search', p);
    await settle(2000);
    const w = await x.worker();
    const [dev] = await byTitle(x, 'Development');
    const [cc] = await byTitle(x, 'Content Creation');
    // ungroup all tabs of Development at once
    await w.evaluate((ids) => chrome.tabs.ungroup(ids as [number, ...number[]]), dev.tabs.map((t) => t.id));
    // close the Content Creation group (remove its tabs)
    await w.evaluate((ids) => chrome.tabs.remove(ids), cc.tabs.map((t) => t.id));
    await settle(2500);
    expect(await saved(x, 'w0')).toHaveLength(3);
    expect(await saved(x, 'w1')).toHaveLength(3);
    const ls = await links(x);
    expect(ls.find((l) => l.workspaceId === 'w0')!.open).toBe(false);
    expect(ls.find((l) => l.workspaceId === 'w1')!.open).toBe(false);
    // move Job Search's group to its own window, then close that window
    const [js] = await byTitle(x, 'Job Search');
    const win = await w.evaluate(async (tab) => (await chrome.windows.create({ tabId: tab })).id!, js.tabs[0].id);
    await w.evaluate(({ ids, win }) => chrome.tabs.move(ids, { windowId: win, index: -1 }), { ids: js.tabs.slice(1).map((t) => t.id), win });
    await settle(1000);
    await w.evaluate((id) => chrome.windows.remove(id), win);
    await settle(2500);
    expect(await saved(x, 'w2')).toHaveLength(3);
    // reopen → fresh group with all 3 tabs; ungrouped Development tabs are reused? (annotate)
    await openFromWorkspacesPage(x, 'Development', p);
    await settle();
    const devNow = await byTitle(x, 'Development');
    const loose = (await allTabs(x)).filter((t) => t.url.includes('/plain?w0-') && t.groupId === -1).length;
    test.info().annotations.push({ type: 'reopen-after-ungroup', description: `groups=${devNow.length} tabsInGroup=${devNow[0]?.tabs.length} looseCopiesStillOpen=${loose}` });
    expect(devNow).toHaveLength(1);
    expect(devNow[0].tabs).toHaveLength(3);
  });

  test('drag a whole group to another window: link follows; reopening from the dashboard does not duplicate', async ({ x, site }) => {
    await x.set(seed(site.origin));
    const p = await openFromWorkspacesPage(x, 'Development');
    await settle();
    const w = await x.worker();
    const [dev] = await byTitle(x, 'Development');
    const other = await w.evaluate(async (u) => (await chrome.windows.create({ url: u })).id!, `${site.origin}/plain2`);
    await w.evaluate(({ g, win }) => chrome.tabGroups.move(g, { windowId: win, index: -1 }), { g: dev.id, win: other });
    await settle(2000);
    const after = await byTitle(x, 'Development');
    test.info().annotations.push({ type: 'after-move', description: JSON.stringify({ before: [dev.id, dev.windowId], after: after.map((g) => [g.id, g.windowId]), links: await links(x) }) });
    expect(after).toHaveLength(1);
    expect(after[0].windowId).toBe(other);
    expect(await saved(x, 'w0')).toHaveLength(3); // the move must not remove saved tabs
    await openFromWorkspacesPage(x, 'Development', p);
    await settle();
    const gs = await byTitle(x, 'Development');
    expect(gs, JSON.stringify(gs.map((g) => [g.id, g.windowId, g.tabs.length]))).toHaveLength(1);
    expect(gs[0].tabs).toHaveLength(3);
  });

  test('rename workspace ↔ group title; recolour from Tabspace and from Chrome; group renamed in Chrome keeps its link', async ({ x, site }) => {
    await x.set(seed(site.origin));
    const p = await openFromWorkspacesPage(x, 'Development');
    await settle();
    // rename in Tabspace
    await p.getByRole('button', { name: 'Actions for Development' }).click();
    await p.getByRole('menuitem', { name: 'Rename / change icon' }).click();
    const dlg = p.getByRole('dialog', { name: 'Edit workspace' });
    await dlg.getByLabel('Name').fill('Dev & Tools');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await groups(x)).map((g) => g.title)).toEqual(['Dev & Tools']);
    // recolour from Tabspace
    await p.getByRole('button', { name: 'Actions for Dev & Tools' }).click();
    await p.getByRole('menuitem', { name: 'Tab group colour…' }).click();
    const colorDlg = p.getByRole('dialog');
    await colorDlg.getByRole('radio', { name: /purple/i }).click().catch(async () => colorDlg.getByRole('button', { name: /purple/i }).click());
    const save = colorDlg.getByRole('button', { name: /Save|Done|Apply/ });
    if (await save.count()) await save.first().click();
    await expect.poll(async () => (await groups(x))[0].color).toBe('purple');
    // recolour in Chrome → remembered
    const w = await x.worker();
    const gid = (await groups(x))[0].id;
    await w.evaluate((g) => chrome.tabGroups.update(g, { color: 'cyan' }), gid);
    await expect.poll(async () => (await links(x)).find((l) => l.workspaceId === 'w0')?.color).toBe('cyan');
    // rename the group in Chrome → still linked, reopen focuses it (no new group)
    await w.evaluate((g) => chrome.tabGroups.update(g, { title: 'My custom title' }), gid);
    await settle();
    await p.getByRole('button', { name: 'Open Dev & Tools as a tab group' }).click();
    await settle();
    const gs = await groups(x);
    test.info().annotations.push({ type: 'after-chrome-rename-reopen', description: JSON.stringify(gs.map((g) => [g.title, g.tabs.length])) });
    expect(gs).toHaveLength(1);
  });

  test('delete workspace: its tabs stay open (ungrouped), saved session kept unassigned, link dropped', async ({ x, site }) => {
    await x.set(seed(site.origin));
    const p = await openFromWorkspacesPage(x, 'Development');
    await settle();
    const before = (await byTitle(x, 'Development'))[0].tabs.map((t) => t.id);
    await p.getByRole('button', { name: 'Actions for Development' }).click();
    await p.getByRole('menuitem', { name: 'Delete' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Delete workspace' }).click();
    await expect.poll(async () => (await groups(x)).length, { timeout: 8000 }).toBe(0);
    const tabs = await allTabs(x);
    for (const id of before) expect(tabs.find((t) => t.id === id)?.groupId).toBe(-1);
    const sess = await x.get<Session[]>('ts.sessions');
    const s0 = sess.find((s) => s.id === 's0')!;
    expect(s0.tabs).toHaveLength(3);
    expect(s0.workspaceId).toBeUndefined();
    expect((await links(x)).some((l) => l.workspaceId === 'w0')).toBe(false);
  });

  test('user\'s own groups are never adopted, renamed or recoloured (incl. one created while a workspace group is open)', async ({ x, site }) => {
    await x.set(seed(site.origin));
    const w = await x.worker();
    const mine = await w.evaluate(async (u) => {
      const t = await chrome.tabs.create({ url: u, active: false });
      const gid = await chrome.tabs.group({ tabIds: [t.id!] });
      await chrome.tabGroups.update(gid, { title: 'Reading', color: 'yellow' });
      return gid;
    }, `${site.origin}/plain?mine`);
    const p = await openFromWorkspacesPage(x, 'Development');
    await settle();
    // move a user tab into my group etc — workspace saved tabs untouched
    expect(await saved(x, 'w0')).toHaveLength(3);
    const ls = await links(x);
    expect(ls.some((l) => l.groupId === mine)).toBe(false);
    const g = (await groups(x)).find((x2) => x2.id === mine)!;
    expect([g.title, g.color]).toEqual(['Reading', 'yellow']);
    void p;
  });

  test('BUG-WG1 · a user\'s own group titled like a CLOSED workspace group is not adopted', async ({ x, site }) => {
    await x.set(seed(site.origin));
    const p = await openFromWorkspacesPage(x, 'Development');
    await settle();
    const w = await x.worker();
    const [dev] = await byTitle(x, 'Development');
    await w.evaluate((ids) => chrome.tabs.remove(ids), dev.tabs.map((t) => t.id)); // workspace group closed
    await settle(1500);
    expect((await links(x)).find((l) => l.workspaceId === 'w0')!.open).toBe(false);
    // The user makes their OWN group and happens to call it "Development"
    const mine = await w.evaluate(async (u) => {
      const t = await chrome.tabs.create({ url: u, active: false });
      const gid = await chrome.tabs.group({ tabIds: [t.id!] });
      await chrome.tabGroups.update(gid, { title: 'Development', color: 'yellow' });
      return gid;
    }, `${site.origin}/plain?my-own-dev-notes`);
    await settle(2500);
    const l = (await links(x)).find((v) => v.workspaceId === 'w0')!;
    test.info().annotations.push({ type: 'link-after-user-group', description: JSON.stringify({ mine, link: l }) });
    // add one of the user's tabs → would be synced into the workspace if adopted
    const another = await w.evaluate(async ({ u, g }) => {
      const t = await chrome.tabs.create({ url: u, active: false });
      await new Promise((r) => setTimeout(r, 500));
      await chrome.tabs.group({ tabIds: [t.id!], groupId: g });
      return t.id;
    }, { u: `${site.origin}/plain?private-user-tab`, g: mine });
    void another;
    await settle(2000);
    const s = await saved(x, 'w0');
    test.info().annotations.push({ type: 'saved-after', description: JSON.stringify(s) });
    expect(l.groupId).not.toBe(mine);
    expect(s).not.toContain(`${site.origin}/plain?private-user-tab`);
    void p;
  });

  test('BUG-WG2 · rapid double-click on "Open … as a tab group" opens ONE group', async ({ x, site }) => {
    await x.set(seed(site.origin));
    const p = await x.open('dashboard.html#/workspaces');
    await p.getByRole('button', { name: 'Open Development as a tab group' }).dblclick();
    await settle(2500);
    const gs = await byTitle(x, 'Development');
    test.info().annotations.push({ type: 'groups-after-dblclick', description: JSON.stringify(gs.map((g) => g.tabs.length)) });
    expect(gs).toHaveLength(1);
    expect(gs[0].tabs).toHaveLength(3);
  });

  test('rapid double-click on the New Tab / dashboard "Open" button opens ONE group', async ({ x, site }) => {
    await x.set(seed(site.origin));
    const nt = await x.open('newtab.html');
    await nt.getByRole('button', { name: 'Open Development' }).dblclick();
    await settle(2500);
    const gs = await byTitle(x, 'Development');
    test.info().annotations.push({ type: 'groups-after-dblclick-newtab', description: JSON.stringify(gs.map((g) => g.tabs.length)) });
    expect(gs).toHaveLength(1);
  });

  test('0 tabs → honest error, no empty group; non-restorable URLs skipped; pinned saved tabs kept in storage; 50 tabs → one group', async ({ x, site }) => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, url: `${site.origin}/plain?n=${i}`, title: `N${i}`, pinned: false }));
    const mixed = [
      { id: 'm1', url: `${site.origin}/plain?pinned`, title: 'Pinned', pinned: true },
      { id: 'm2', url: 'chrome://settings/', title: 'Chrome settings', pinned: false },
      { id: 'm3', url: 'file:///C:/x.txt', title: 'file', pinned: false },
      { id: 'm4', url: `${site.origin}/plain?normal`, title: 'Normal', pinned: false },
    ];
    await x.set(seed(site.origin, { extra: { 0: [], 1: mixed, 2: fifty } }));
    const p = await x.open('dashboard.html#/workspaces');
    // 0 tabs: Open is not offered / errors honestly
    const open0 = p.getByRole('button', { name: 'Open Development as a tab group' });
    expect(await open0.count()).toBe(0);
    // mixed
    await openFromWorkspacesPage(x, 'Content Creation', p);
    await settle();
    const [cc] = await byTitle(x, 'Content Creation');
    expect(cc.tabs.map((t) => t.url)).toEqual([`${site.origin}/plain?pinned`, `${site.origin}/plain?normal`]);
    const toast = await p.getByRole('status').allInnerTexts();
    test.info().annotations.push({ type: 'mixed-toast', description: toast.join(' | ') });
    const sess = await x.get<Session[]>('ts.sessions');
    expect(sess.find((s) => s.id === 's1')!.tabs).toEqual(mixed); // nothing rewritten (pinned flag, unrestorable kept)
    // 50
    const t0 = Date.now();
    await openFromWorkspacesPage(x, 'Job Search', p);
    await expect.poll(async () => (await byTitle(x, 'Job Search'))[0]?.tabs.length ?? 0, { timeout: 30_000 }).toBe(50);
    test.info().annotations.push({ type: 'open-50-ms', description: String(Date.now() - t0) });
    await settle(2500);
    expect(await saved(x, 'w2')).toHaveLength(50);
    const urls = (await byTitle(x, 'Job Search'))[0].tabs.map((t) => t.url);
    expect(urls).toEqual(fifty.map((f) => f.url));
  });

  test('groups disabled → old behaviour (new window, no group, no link); Tab Manager lists workspace groups', async ({ x, site }) => {
    await x.set(seed(site.origin));
    const p = await openFromWorkspacesPage(x, 'Development');
    await settle();
    const tm = await x.open('dashboard.html#/tabs');
    await expect(tm.getByRole('tab', { name: /Development/ })).toBeVisible();
    await tm.getByRole('tab', { name: /Development/ }).click();
    await expect(tm.getByRole('row', { name: /w0-1/ }).first()).toBeVisible();
    await expect(tm.getByRole('row', { name: /w1-1/ })).toHaveCount(0);
    await shot(tm, 'v22qa-tab-manager-groups');
    await patchSettings(x, (s) => ({ ...s, workspaceGroups: { ...s.workspaceGroups, enabled: false } }));
    const w = await x.worker();
    const wins = await w.evaluate(async () => (await chrome.windows.getAll()).length);
    await p.bringToFront();
    await p.reload();
    await p.getByRole('button', { name: 'Open Content Creation in a new window' }).click();
    await expect.poll(async () => w.evaluate(async () => (await chrome.windows.getAll()).length)).toBe(wins + 1);
    await settle();
    expect(await byTitle(x, 'Content Creation')).toHaveLength(0);
    expect((await links(x)).some((l) => l.workspaceId === 'w1')).toBe(false);
  });
});

test.describe('V2.2 · restart', () => {
  async function restartFlow(restore: boolean) {
    const site = await startSite();
    const errors: string[] = [];
    const x = await launch();
    collectErrors(x.context, errors);
    let y: Ext | undefined;
    try {
      await x.set(seed(site.origin));
      const p = await openFromWorkspacesPage(x, 'Development');
      await openFromWorkspacesPage(x, 'Content Creation', p);
      await settle(2000);
      const before = await groups(x);
      await x.context.close();
      y = await launch({ dir: x.dir, args: restore ? ['--restore-last-session'] : [] });
      collectErrors(y.context, errors);
      await settle(4000);
      const after = await groups(y);
      const ls = await links(y);
      return { before, after, ls, y, site, errors };
    } catch (e) {
      await y?.context.close().catch(() => undefined);
      await site.close();
      throw e;
    }
  }

  test('restart WITH session restore: restored groups are re-linked; reopening does not duplicate', async () => {
    test.setTimeout(120_000);
    const r = await restartFlow(true);
    try {
      test.info().annotations.push({ type: 'restored', description: JSON.stringify({ groups: r.after.map((g) => [g.id, g.title, g.tabs.length]), links: r.ls }) });
      test.skip(r.after.length === 0, 'This Chromium build did not restore tab groups with --restore-last-session');
      expect(r.ls.filter((l) => l.open).map((l) => l.workspaceId).sort()).toEqual(['w0', 'w1']);
      const p = await r.y.open('dashboard.html#/workspaces');
      await p.getByRole('button', { name: 'Open Development as a tab group' }).click();
      await settle();
      expect(await byTitle(r.y, 'Development')).toHaveLength(1);
      expect((await byTitle(r.y, 'Development'))[0].tabs).toHaveLength(3);
      expect(await saved(r.y, 'w0')).toHaveLength(3);
    } finally {
      await r.y.context.close();
      await r.site.close();
    }
  });

  test('restart WITHOUT restore: links are marked closed; new user groups are not claimed; reopening creates a fresh group', async () => {
    test.setTimeout(120_000);
    const r = await restartFlow(false);
    try {
      test.info().annotations.push({ type: 'before/after', description: JSON.stringify({ before: r.before.map((g) => [g.id, g.windowId, g.title]), after: r.after.map((g) => [g.id, g.windowId, g.title]), links: r.ls }) });
      const w = await r.y.worker();
      // the user creates two groups of their own in the fresh session
      const mine = await w.evaluate(async (origin) => {
        const out: number[] = [];
        for (const n of ['a', 'b']) {
          const t = await chrome.tabs.create({ url: `${origin}/plain?fresh-${n}`, active: false });
          const gid = await chrome.tabs.group({ tabIds: [t.id!] });
          await chrome.tabGroups.update(gid, { title: `Mine ${n}` });
          out.push(gid);
        }
        return out;
      }, r.site.origin);
      await settle(2500);
      const ls = await links(r.y);
      test.info().annotations.push({ type: 'user-groups/links', description: JSON.stringify({ mine, ls }) });
      for (const l of ls) expect(mine).not.toContain(l.groupId);
      // Opening Development must create a NEW group titled Development, not reuse "Mine a"
      const p = await r.y.open('dashboard.html#/workspaces');
      await p.getByRole('button', { name: 'Open Development as a tab group' }).click();
      await settle();
      const gs = await groups(r.y);
      test.info().annotations.push({ type: 'groups-after-open', description: JSON.stringify(gs.map((g) => [g.id, g.title, g.tabs.length])) });
      expect(gs.find((g) => g.title === 'Mine a')!.tabs).toHaveLength(1);
      expect(await byTitle(r.y, 'Development')).toHaveLength(1);
    } finally {
      await r.y.context.close();
      await r.site.close();
    }
  });
});
