/**
 * Workspace ↔ native Chrome tab group (V2.2, owned by the Workspaces agent).
 *
 * - Opening a workspace (when settings.workspaceGroups.enabled) puts all its saved tabs into ONE native group
 *   titled with the workspace name, in the window holding the Tabspace page. Several workspaces can be open
 *   side by side, each its own collapsible group.
 * - Reopening an open workspace never duplicates: it focuses/expands the existing group and only adds saved
 *   tabs whose URL isn't open in it.
 * - Links (`ts.workspaceGroupLinks`) persist; Chrome's runtime group IDs change on restart, so groups are
 *   re-linked by title (= workspace name), only for workspaces that were opened as a group before. A user's
 *   own groups are never adopted or changed.
 * - A tabId → saved-tab map lives in chrome.storage.session (memory fallback outside the extension); it is
 *   what lets membership sync know which saved tab a live tab came from (see workspaceGroupSync.ts).
 */
import { get, update } from '@/storage/store';
import type { GroupColor, SavedSession, Workspace, WorkspaceGroupLink } from '@/types/models';
import { chunk } from '@/features/tabs/serialize';
import { latestSession } from '@/features/workspaces/model';
import { chooseGroupForWorkspace, matchTabsToSaved, missingSavedTabs, pickGroupColor, sameTitle, upsertLink, type LiveGroup } from '@/features/workspaces/groups';
import { getTargetWindow, hasTabGroupsApi, requireTabs } from './tabs';

const CREATE_BATCH = 8;

/* ------------------------------------------------------------------ */
/* tabId -> { workspaceId, savedTabId } (session-scoped)               */
/* ------------------------------------------------------------------ */

export const TAB_MAP_KEY = 'ts.wsgTabs';
export interface TabLink {
  /** workspaceId */
  w: string;
  /** savedTabId, or undefined while waiting for the tab to load a web page. */
  s?: string;
}
type TabMap = Record<string, TabLink>;

const memoryMap: TabMap = {};
function sessionArea(): chrome.storage.StorageArea | undefined {
  return typeof chrome !== 'undefined' ? chrome.storage?.session : undefined;
}
async function withMapLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks?.request ? (locks.request('tabspace-wsg-tabs', fn) as Promise<T>) : fn();
}

export async function readTabMap(): Promise<TabMap> {
  const area = sessionArea();
  if (!area) return { ...memoryMap };
  return ((await area.get(TAB_MAP_KEY))[TAB_MAP_KEY] as TabMap | undefined) ?? {};
}

/** Merge entries into the map (null deletes). */
export async function writeTabMap(patch: Record<number | string, TabLink | null>): Promise<void> {
  await withMapLock(async () => {
    const area = sessionArea();
    const cur = area ? await readTabMap() : memoryMap;
    const next: TabMap = area ? { ...cur } : cur;
    for (const [k, v] of Object.entries(patch)) {
      if (v) next[k] = v;
      else delete next[k];
    }
    if (area) await area.set({ [TAB_MAP_KEY]: next });
  });
}

/** Test helper: forget everything in the in-memory fallback map. */
export function resetTabMapForTests(): void {
  for (const k of Object.keys(memoryMap)) delete memoryMap[k];
}

/* ------------------------------------------------------------------ */
/* Browser-start window                                                */
/* ------------------------------------------------------------------ */

const BOOT_KEY = 'ts.wsgBoot';
/** How long after a browser start Chrome-restored groups may be re-linked by title. */
export const BOOT_RELINK_MS = 90_000;

/**
 * True only shortly after the browser started. chrome.storage.session is empty after a browser restart but
 * survives service-worker restarts, so the first call after a start records the start time.
 */
export async function inBootRelinkWindow(now = Date.now()): Promise<boolean> {
  const area = sessionArea();
  if (!area) return false;
  const started = (await area.get(BOOT_KEY))[BOOT_KEY] as number | undefined;
  if (started === undefined) {
    await area.set({ [BOOT_KEY]: now });
    return true;
  }
  return now - started < BOOT_RELINK_MS;
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

export async function getLinks(): Promise<WorkspaceGroupLink[]> {
  return get('ts.workspaceGroupLinks');
}

async function saveLink(link: WorkspaceGroupLink): Promise<void> {
  await update('ts.workspaceGroupLinks', (l) => upsertLink(l, link));
}

async function groupExists(groupId: number | undefined): Promise<chrome.tabGroups.TabGroup | undefined> {
  if (groupId === undefined || !hasTabGroupsApi()) return undefined;
  return chrome.tabGroups.get(groupId).catch(() => undefined);
}

/** The live group linked to a workspace, if it still exists. Keeps the link even if the user renamed the group in Chrome. */
export async function liveGroupFor(workspaceId: string): Promise<chrome.tabGroups.TabGroup | undefined> {
  const link = (await getLinks()).find((l) => l.workspaceId === workspaceId);
  if (!link?.groupId) return undefined;
  const g = await groupExists(link.groupId);
  return g && (g.windowId === link.windowId || link.windowId === undefined) ? g : undefined;
}

/* ------------------------------------------------------------------ */
/* Open as a group                                                     */
/* ------------------------------------------------------------------ */

export interface GroupOpenResult {
  mode: 'group';
  opened: number;
  skipped: number;
  groups: number;
  windowId: number;
  closed: number;
  kept: number;
  /** The workspace's group was already open: it was focused/expanded instead of opening duplicates. */
  focusedExisting: boolean;
  /** Saved tabs that were already open in the group. */
  alreadyOpen: number;
  groupTitle: string;
}

/**
 * Open a workspace as one native tab group (title = workspace name). Saved sub-groups are flattened (Chrome has
 * no nested groups) in saved order; pinned saved tabs open unpinned inside the group (pinned tabs can't be grouped).
 */
export async function openWorkspaceAsGroup(workspace: Workspace, session: SavedSession, settings: { collapseOthers: boolean }): Promise<GroupOpenResult> {
  // One open per workspace at a time, across every Tabspace page and the worker: a double-click (or two
  // surfaces at once) must find the group the first call created instead of creating a second one.
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  const run = () => openWorkspaceAsGroupUnlocked(workspace, session, settings);
  return locks?.request ? (locks.request(`tabspace-open-ws:${workspace.id}`, run) as Promise<GroupOpenResult>) : run();
}

async function openWorkspaceAsGroupUnlocked(workspace: Workspace, session: SavedSession, settings: { collapseOthers: boolean }): Promise<GroupOpenResult> {
  const c = requireTabs();
  if (!hasTabGroupsApi()) throw new Error('Tab groups aren’t available in this browser.');
  const links = await getLinks();
  const link = links.find((l) => l.workspaceId === workspace.id);
  const color: GroupColor = link?.color ?? pickGroupColor(workspace.id, links);
  const restorable = missingSavedTabs(session.tabs, []);
  const skipped = session.tabs.length - restorable.length;
  if (!restorable.length) throw new Error(`Nothing to open — “${workspace.name}” has no saved web pages.`);

  let group = await liveGroupFor(workspace.id);
  let windowId: number;
  let created: { tabId: number; savedTabId: string }[] = [];
  let alreadyOpen = 0;
  let focusedExisting = false;

  const createTabs = async (tabs: typeof restorable, wid: number, baseIndex: number, activateFirst: boolean) => {
    const out: { tabId: number; savedTabId: string }[] = [];
    const indexed = tabs.map((t, i) => ({ t, i }));
    for (const batch of chunk(indexed, CREATE_BATCH)) {
      const res = await Promise.all(batch.map(({ t, i }) => c.tabs.create({ windowId: wid, url: t.url, active: activateFirst && i === 0, index: baseIndex + i }).catch(() => undefined)));
      batch.forEach(({ t }, k) => {
        const id = res[k]?.id;
        if (id !== undefined) out.push({ tabId: id, savedTabId: t.id });
      });
    }
    // Map before grouping so the worker's membership sync recognises these as the workspace's own tabs.
    await writeTabMap(Object.fromEntries(out.map((x) => [x.tabId, { w: workspace.id, s: x.savedTabId }])));
    return out;
  };

  if (group) {
    focusedExisting = true;
    windowId = group.windowId;
    const inGroup = (await c.tabs.query({ groupId: group.id })).sort((a, b) => a.index - b.index);
    const missing = missingSavedTabs(session.tabs, inGroup.map((t) => t.url || t.pendingUrl || ''));
    alreadyOpen = restorable.length - missing.length;
    const matched = matchTabsToSaved(inGroup, session.tabs);
    await writeTabMap(Object.fromEntries([...matched].map(([tabId, s]) => [tabId, { w: workspace.id, s }])));
    if (missing.length) {
      const after = inGroup.length ? inGroup[inGroup.length - 1].index + 1 : 0;
      created = await createTabs(missing, windowId, after, false);
      if (created.length) await c.tabs.group({ groupId: group.id, tabIds: created.map((x) => x.tabId) as [number, ...number[]] });
    }
    await c.tabGroups.update(group.id, { collapsed: false });
    const first = inGroup[0]?.id ?? created[0]?.tabId;
    if (first !== undefined) await c.tabs.update(first, { active: true });
  } else {
    const win = await getTargetWindow();
    windowId = win.id;
    // Reuse matching tabs that are already open loose in this window (e.g. after the user ungrouped the
    // workspace's group) instead of opening duplicates next to them.
    const loose = win.tabs.filter((t) => !t.pinned && (t.groupId ?? -1) === -1);
    const reuse = matchTabsToSaved(loose, restorable); // tabId -> savedTabId
    const reusedSaved = new Set(reuse.values());
    alreadyOpen = reuse.size;
    created = await createTabs(
      restorable.filter((t) => !reusedSaved.has(t.id)),
      windowId,
      win.tabs.length,
      reuse.size === 0,
    );
    await writeTabMap(Object.fromEntries([...reuse].map(([tabId, s]) => [tabId, { w: workspace.id, s }])));
    const bySaved = new Map<string, number>([...[...reuse].map(([tabId, s]) => [s, tabId] as [string, number]), ...created.map((x) => [x.savedTabId, x.tabId] as [string, number])]);
    const ordered = restorable.map((t) => bySaved.get(t.id)).filter((id): id is number => id !== undefined);
    if (!ordered.length) throw new Error('Chrome couldn’t open the workspace’s tabs.');
    // Put them in saved order at the end of the window, then group.
    if (reuse.size) await c.tabs.move(ordered, { windowId, index: -1 }).catch(() => undefined);
    const gid = await c.tabs.group({ tabIds: ordered as [number, ...number[]], createProperties: { windowId } });
    await c.tabGroups.update(gid, { title: workspace.name, color, collapsed: false });
    if (reuse.size) await c.tabs.update(ordered[0], { active: true }).catch(() => undefined);
    group = { id: gid, windowId, title: workspace.name, color, collapsed: false } as chrome.tabGroups.TabGroup;
  }
  await c.windows.update(windowId, { focused: true }).catch(() => undefined);
  await saveLink({ workspaceId: workspace.id, color, groupId: group.id, windowId, open: true, awaitingRestore: false, updatedAt: Date.now() });
  if (settings.collapseOthers) await collapseOtherWorkspaceGroups(windowId, group.id);
  return { mode: 'group', opened: created.length, skipped, groups: 1, windowId, closed: 0, kept: 0, focusedExisting, alreadyOpen, groupTitle: group.title || workspace.name };
}

/** Collapse every other Tabspace workspace group in the window (never the user's own groups). */
export async function collapseOtherWorkspaceGroups(windowId: number, keepGroupId: number): Promise<void> {
  if (!hasTabGroupsApi()) return;
  const links = await getLinks();
  const linked = new Set(links.filter((l) => l.open && l.groupId !== undefined).map((l) => l.groupId!));
  const groups = await chrome.tabGroups.query({ windowId });
  for (const g of groups) {
    if (g.id !== keepGroupId && linked.has(g.id) && !g.collapsed) await chrome.tabGroups.update(g.id, { collapsed: true }).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* Controls used by the Workspaces page                                */
/* ------------------------------------------------------------------ */

export interface LiveWorkspaceGroup {
  groupId: number;
  windowId: number;
  tabCount: number;
  collapsed: boolean;
}

/** workspaceId -> its open group (only workspaces whose linked group currently exists). */
export async function getLiveWorkspaceGroups(): Promise<Map<string, LiveWorkspaceGroup>> {
  const out = new Map<string, LiveWorkspaceGroup>();
  if (!hasTabGroupsApi()) return out;
  const links = (await getLinks()).filter((l) => l.groupId !== undefined);
  if (!links.length) return out;
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})]);
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const l of links) {
    const g = byId.get(l.groupId!);
    if (!g || (l.windowId !== undefined && g.windowId !== l.windowId)) continue;
    out.set(l.workspaceId, { groupId: g.id, windowId: g.windowId, collapsed: g.collapsed, tabCount: tabs.filter((t) => t.groupId === g.id).length });
  }
  return out;
}

export async function focusWorkspaceGroup(workspaceId: string): Promise<void> {
  const c = requireTabs();
  const g = await liveGroupFor(workspaceId);
  if (!g) throw new Error('That workspace isn’t open as a tab group right now.');
  await c.tabGroups.update(g.id, { collapsed: false });
  const [first] = (await c.tabs.query({ groupId: g.id })).sort((a, b) => a.index - b.index);
  if (first?.id !== undefined) await c.tabs.update(first.id, { active: true });
  await c.windows.update(g.windowId, { focused: true }).catch(() => undefined);
  const s = await get('ts.settings');
  if (s.workspaceGroups.collapseOthers) await collapseOtherWorkspaceGroups(g.windowId, g.id);
}

export async function setWorkspaceGroupCollapsed(workspaceId: string, collapsed: boolean): Promise<void> {
  const g = await liveGroupFor(workspaceId);
  if (!g) throw new Error('That workspace isn’t open as a tab group right now.');
  await chrome.tabGroups.update(g.id, { collapsed });
}

export async function setWorkspaceGroupColor(workspaceId: string, color: GroupColor): Promise<void> {
  const links = await getLinks();
  const link = links.find((l) => l.workspaceId === workspaceId);
  await saveLink({ ...(link ?? { workspaceId, open: false }), color, updatedAt: Date.now() });
  const g = await liveGroupFor(workspaceId);
  if (g) await chrome.tabGroups.update(g.id, { color });
}

export async function workspaceGroupColor(workspaceId: string): Promise<GroupColor> {
  return pickGroupColor(workspaceId, await getLinks());
}

/* ------------------------------------------------------------------ */
/* Worker-side reconciliation                                          */
/* ------------------------------------------------------------------ */

/**
 * Re-link workspace groups after a Chrome restart (or whenever groups appear): for each workspace that has a
 * link, keep it if its group still exists; otherwise adopt a live group titled like the workspace (best URL
 * overlap wins). Rebuilds the tab map for linked groups by URL. Returns how many links are open.
 */
export async function relinkWorkspaceGroups(opts: { allowTitleRelink?: boolean } = {}): Promise<number> {
  if (!hasTabGroupsApi()) return 0;
  const [links, workspaces, sessions] = await Promise.all([getLinks(), get('ts.workspaces'), get('ts.sessions')]);
  if (!links.length) return 0;
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})]);
  const live: LiveGroup[] = groups.map((g) => ({
    id: g.id,
    windowId: g.windowId,
    title: g.title,
    urls: tabs.filter((t) => t.groupId === g.id).map((t) => t.url || t.pendingUrl || ''),
  }));
  const byId = new Map(live.map((g) => [g.id, g]));
  const claimed = new Set<number>();
  const next: WorkspaceGroupLink[] = [];
  const mapPatch: Record<number, TabLink> = {};
  const now = Date.now();
  // Pass 1: links whose group still exists (same runtime session).
  const pending: WorkspaceGroupLink[] = [];
  for (const l of links) {
    const ws = workspaces.find((w) => w.id === l.workspaceId);
    if (!ws) continue; // workspace deleted: drop link
    const g = l.groupId !== undefined ? byId.get(l.groupId) : undefined;
    if (g && (g.windowId === l.windowId || sameTitle(g.title, ws.name))) {
      claimed.add(g.id);
      next.push({ ...l, windowId: g.windowId, open: true, awaitingRestore: false });
    } else pending.push(l);
  }
  // Pass 1b — identity, allowed any time: a live group made of this workspace's own tabs (tab IDs from the
  // tab map). This is how a group dragged to another window (Chrome recreates it with a new ID) keeps its
  // link. A user's own group never matches: its tabs aren't in the map.
  const tabMap = await readTabMap();
  const stillPending: WorkspaceGroupLink[] = [];
  for (const l of pending) {
    const g = live.find((x) => {
      if (claimed.has(x.id)) return false;
      const owners = tabs.filter((t) => t.groupId === x.id && t.id !== undefined).map((t) => tabMap[t.id!]?.w).filter(Boolean);
      return owners.length > 0 && owners.every((w) => w === l.workspaceId);
    });
    if (g) {
      claimed.add(g.id);
      next.push({ ...l, groupId: g.id, windowId: g.windowId, open: true, awaitingRestore: false, updatedAt: now });
    } else stillPending.push(l);
  }
  // Pass 2 — ONLY right after a browser start (Chrome restored groups with new IDs), ONLY for links that were
  // open or went away with their window, and ONLY to a group with the same title that contains at least one
  // of the workspace's saved URLs. Never otherwise: a user's own group may share a closed workspace's name.
  for (const l of stillPending) {
    const ws = workspaces.find((w) => w.id === l.workspaceId)!;
    const eligible = opts.allowTitleRelink && (l.open || l.awaitingRestore);
    const saved = latestSession(sessions, ws.id)?.tabs ?? [];
    const g = eligible ? chooseGroupForWorkspace(ws.name, saved, live, claimed, 1) : undefined;
    if (g) {
      claimed.add(g.id);
      next.push({ ...l, groupId: g.id, windowId: g.windowId, open: true, awaitingRestore: false, updatedAt: now });
    } else {
      // Still waiting for Chrome to restore it? Keep the marker only while the boot window lasts.
      next.push({ ...l, groupId: undefined, windowId: undefined, open: false, awaitingRestore: !!(opts.allowTitleRelink && (l.open || l.awaitingRestore)) });
    }
  }
  for (const l of next) {
    if (!l.open || l.groupId === undefined) continue;
    const saved = latestSession(sessions, l.workspaceId)?.tabs ?? [];
    const inGroup = tabs.filter((t) => t.groupId === l.groupId);
    for (const [tabId, s] of matchTabsToSaved(inGroup, saved)) mapPatch[tabId] = { w: l.workspaceId, s };
  }
  if (JSON.stringify(next) !== JSON.stringify(links)) await update('ts.workspaceGroupLinks', () => next);
  if (Object.keys(mapPatch).length) await writeTabMap(mapPatch);
  return next.filter((l) => l.open).length;
}

/**
 * A linked group was removed: keep the link (colour, association) but mark it closed. If its window went away
 * too (window closed / Chrome quitting), Chrome may restore the group after a restart → `awaitingRestore`.
 * If the user closed or ungrouped just the group, it must never be re-linked by title later.
 */
export async function markGroupClosed(groupId: number): Promise<void> {
  const links = await getLinks();
  const link = links.find((l) => l.groupId === groupId);
  if (!link) return;
  const windowGone = link.windowId === undefined ? false : !(await chrome.windows.get(link.windowId).catch(() => undefined));
  await update('ts.workspaceGroupLinks', (l) =>
    l.map((x) => (x.groupId === groupId ? { ...x, groupId: undefined, windowId: undefined, open: false, awaitingRestore: windowGone, updatedAt: Date.now() } : x)),
  );
}

/** A linked group's colour changed in Chrome: remember it. (Title changes are kept as-is; the link stays.) */
export async function rememberGroupColor(group: { id: number; color: string }): Promise<void> {
  const links = await getLinks();
  const l = links.find((x) => x.groupId === group.id);
  if (l && l.color !== group.color) await saveLink({ ...l, color: group.color as GroupColor, updatedAt: Date.now() });
}

/**
 * Workspaces changed (anywhere): rename the live group of a renamed workspace; for a deleted workspace, ungroup
 * (never close) its tabs and drop the link.
 */
export async function syncWorkspaceChanges(prev: Workspace[] | undefined, next: Workspace[] | undefined): Promise<void> {
  if (!hasTabGroupsApi()) return;
  const links = await getLinks();
  if (!links.length) return;
  const before = new Map((prev ?? []).map((w) => [w.id, w]));
  const after = new Map((next ?? []).map((w) => [w.id, w]));
  for (const l of links) {
    const old = before.get(l.workspaceId);
    const cur = after.get(l.workspaceId);
    if (!cur) {
      if (!old) continue;
      // Drop the link first so membership sync doesn't treat the ungrouping as "moved out".
      await update('ts.workspaceGroupLinks', (ls) => ls.filter((x) => x.workspaceId !== l.workspaceId));
      const g = await groupExists(l.groupId);
      if (g) {
        const ids = (await chrome.tabs.query({ groupId: g.id })).map((t) => t.id).filter((id): id is number => id !== undefined);
        if (ids.length) await chrome.tabs.ungroup(ids as [number, ...number[]]).catch(() => undefined);
      }
      const map = await readTabMap();
      const drop = Object.entries(map).filter(([, v]) => v.w === l.workspaceId).map(([k]) => [k, null] as const);
      if (drop.length) await writeTabMap(Object.fromEntries(drop));
    } else if (old && old.name !== cur.name) {
      const g = await groupExists(l.groupId);
      if (g) await chrome.tabGroups.update(g.id, { title: cur.name }).catch(() => undefined);
    }
  }
}
