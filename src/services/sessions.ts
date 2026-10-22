/**
 * CONTRACT (owned by Chrome Extension agent B — Workspaces/Tabs).
 * Session save/restore. Used by Dashboard quick actions, popup and sidebar.
 *
 * Exported contract: saveCurrentWindow, openWorkspace, restoreSession, RestoreMode.
 * All functions throw user-presentable Errors (toast `err.message`).
 */
import { get, insert, newId, patch, remove, update } from '@/storage/store';
import type { SavedSession, SavedTab } from '@/types/models';
import { toDateKey } from '@/utils/date';
import { hostname, isRestorableUrl, isSafeUrl, normalizeUrl } from '@/utils/url';
import { chunk, planRestore, serializeTabs, tabUrl, type RuntimeGroup, type RuntimeTab } from '@/features/tabs/serialize';
import { latestSession } from '@/features/workspaces/model';
import {
  addSavedTab as addSavedTabPure,
  describeRemoval,
  hasUrl,
  mergeSavedTabs,
  moveSavedTab as moveSavedTabPure,
  removeSavedTab as removeSavedTabPure,
  restoreRemovedTab,
  type RemovedTab,
} from '@/features/workspaces/savedTabs';
import { getCurrentWebTab, getOwnTabId, getTargetWindow, hasTabGroupsApi, requireTabs } from './tabs';
import { openWorkspaceAsGroup } from './workspaceGroups';

export type RestoreMode = 'new-window' | 'current-window' | 'replace';

/** Tabs created concurrently per batch when restoring large sessions. */
const CREATE_BATCH = 8;

function stamp(d = new Date()): string {
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function recordActivity(workspaceId: string | undefined): Promise<void> {
  if (!workspaceId) return;
  const day = toDateKey();
  await update('ts.workspaceActivity', (log) => ({ ...log, [day]: { ...log[day], [workspaceId]: (log[day]?.[workspaceId] ?? 0) + 1 } }));
}

export interface SaveResult {
  session: SavedSession | null;
  /** Tabs left out because they can't be reopened (chrome://, file://, extension pages…). */
  skipped: number;
}

/** Save the given runtime tabs as a session. Returns session: null when nothing restorable was found. */
export async function saveTabsAsSession(
  tabs: RuntimeTab[],
  groups: RuntimeGroup[],
  opts: { workspaceId?: string; name?: string; archived?: boolean } = {},
): Promise<SaveResult> {
  const { tabs: saved, groups: savedGroups, skipped } = serializeTabs(tabs, groups, newId);
  if (!saved.length) return { session: null, skipped };
  let name = opts.name?.trim();
  if (!name) {
    const ws = opts.workspaceId ? (await get('ts.workspaces')).find((w) => w.id === opts.workspaceId) : undefined;
    name = `${ws?.name ?? 'Session'} — ${stamp()}`;
  }
  const session = await insert('ts.sessions', {
    name,
    workspaceId: opts.workspaceId || undefined,
    tabs: saved,
    groups: savedGroups,
    ...(opts.archived ? { archived: true } : {}),
  });
  if (!opts.archived) await recordActivity(opts.workspaceId);
  return { session, skipped };
}

/** Save the current window (last focused normal window) and report skipped tabs. */
export async function saveCurrentWindowDetailed(opts: { workspaceId?: string; name?: string; onlySelected?: boolean; windowId?: number } = {}): Promise<SaveResult> {
  const win = await getTargetWindow(opts.windowId);
  const tabs = opts.onlySelected ? win.tabs.filter((t) => t.highlighted) : win.tabs;
  return saveTabsAsSession(tabs, win.groups, opts);
}

/** Save tabs of the current window (optionally only highlighted tabs) as a session in a workspace. */
export async function saveCurrentWindow(opts: { workspaceId?: string; name?: string; onlySelected?: boolean; windowId?: number }): Promise<SavedSession | null> {
  return (await saveCurrentWindowDetailed(opts)).session;
}

export interface RestoreResult {
  opened: number;
  skipped: number;
  groups: number;
  windowId: number;
  /** Session id of the archived "before" snapshot (replace mode). */
  archivedSessionId?: string;
  /** Tabs closed in replace mode. */
  closed: number;
  /** Replace mode: tabs left open because they can't be saved (chrome://, file://, extension pages…). */
  kept: number;
  /** 'group' when the workspace was opened as its native tab group (V2.2). */
  mode?: 'group';
  /** Group mode: the workspace's group was already open and was focused instead of duplicating tabs. */
  focusedExisting?: boolean;
  /** Group mode: saved tabs that were already open in the group. */
  alreadyOpen?: number;
  groupTitle?: string;
}

/** Restore any session object (no storage lookup). */
export async function restoreSessionData(session: Pick<SavedSession, 'tabs' | 'groups'>, mode: RestoreMode = 'new-window', opts: { windowId?: number } = {}): Promise<RestoreResult> {
  const c = requireTabs();
  const plan = planRestore(session);
  if (!plan.tabs.length) {
    throw new Error(plan.skipped ? `Nothing to restore — ${plan.skipped} saved tab${plan.skipped === 1 ? '' : 's'} can’t be reopened (only web pages can).` : 'This session has no tabs.');
  }

  const created: (number | undefined)[] = new Array(plan.tabs.length);
  let windowId: number;
  let baseIndex = 0;
  let start = 0;
  let archivedSessionId: string | undefined;
  let toClose: number[] = [];
  let kept = 0;

  if (mode === 'new-window') {
    const first = plan.tabs[0];
    const win = await c.windows.create({ url: first.url, focused: true });
    if (!win || win.id === undefined) throw new Error('Couldn’t open a new window.');
    windowId = win.id;
    const firstTab = win.tabs?.[0];
    created[0] = firstTab?.id;
    if (first.pinned && firstTab?.id !== undefined) await c.tabs.update(firstTab.id, { pinned: true });
    baseIndex = 0;
    start = 1;
  } else {
    const target = await getTargetWindow(opts.windowId);
    windowId = target.id;
    baseIndex = target.tabs.length;
    if (mode === 'replace') {
      // Archive first: nothing the user had open is lost.
      const archived = await saveTabsAsSession(target.tabs, target.groups, { name: `Archived ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`, archived: true });
      archivedSessionId = archived.session?.id;
      const own = await getOwnTabId();
      // Only close tabs that were actually archived (restorable web pages). Anything that can't be
      // saved stays open, so nothing disappears without a record.
      const others = target.tabs.filter((t) => t.id !== undefined && t.id !== own);
      const archivable = archivedSessionId ? others.filter((t) => isRestorableUrl(tabUrl(t))) : [];
      toClose = archivable.map((t) => t.id!);
      kept = others.length - archivable.length;
    }
  }

  const rest = plan.tabs.map((t, i) => ({ t, i })).slice(start);
  for (const batch of chunk(rest, CREATE_BATCH)) {
    const tabs = await Promise.all(
      batch.map(({ t, i }) =>
        c.tabs
          .create({ windowId, url: t.url, pinned: t.pinned, active: mode !== 'new-window' && i === 0, index: baseIndex + i })
          .catch(() => undefined),
      ),
    );
    batch.forEach(({ i }, k) => (created[i] = tabs[k]?.id));
  }

  let groupCount = 0;
  if (plan.groups.length && hasTabGroupsApi()) {
    for (const g of plan.groups) {
      const ids = g.tabIndexes.map((i) => created[i]).filter((id): id is number => id !== undefined);
      if (!ids.length) continue;
      try {
        const gid = await c.tabs.group({ tabIds: ids as [number, ...number[]], createProperties: { windowId } });
        await c.tabGroups.update(gid, { title: g.title, color: g.color, collapsed: g.collapsed });
        groupCount++;
      } catch {
        // Tabs stay open ungrouped if grouping fails.
      }
    }
  }

  let closed = 0;
  if (mode === 'replace' && toClose.length) {
    await c.tabs.remove(toClose);
    closed = toClose.length;
  }

  return { opened: created.filter((x) => x !== undefined).length, skipped: plan.skipped, groups: groupCount, windowId, archivedSessionId, closed, kept };
}

/**
 * Restore a saved session. 'replace' closes the current window's tabs, so the
 * CALLER must confirm with the user first; the current tabs are archived as a
 * session before anything is closed.
 */
export async function restoreSession(sessionId: string, mode: RestoreMode = 'new-window'): Promise<RestoreResult> {
  const session = (await get('ts.sessions')).find((s) => s.id === sessionId);
  if (!session) throw new Error('That session no longer exists.');
  const res = await restoreSessionData(session, mode);
  await recordActivity(session.workspaceId);
  return res;
}

/** How to open a workspace: one of the restore modes, or 'group' = as its own native tab group (V2.2). */
export type OpenMode = RestoreMode | 'group';

/**
 * Open a workspace's saved tabs (its latest non-archived session).
 * Default mode: 'group' when settings.workspaceGroups.enabled (and tab groups exist), else 'new-window'.
 */
export async function openWorkspace(workspaceId: string, mode?: OpenMode): Promise<RestoreResult> {
  const [workspaces, sessions, settings] = await Promise.all([get('ts.workspaces'), get('ts.sessions'), get('ts.settings')]);
  const ws = workspaces.find((w) => w.id === workspaceId);
  if (!ws) throw new Error('That workspace no longer exists.');
  const latest = latestSession(sessions, workspaceId);
  if (!latest || !latest.tabs.length) throw new Error(`“${ws.name}” has no saved tabs yet. Save tabs from a window or add a URL first.`);
  const chosen: OpenMode = mode ?? (settings.workspaceGroups.enabled && hasTabGroupsApi() ? 'group' : 'new-window');
  if (chosen === 'group') {
    const res = await openWorkspaceAsGroup(ws, latest, { collapseOthers: settings.workspaceGroups.collapseOthers });
    await recordActivity(ws.id);
    return res;
  }
  return restoreSession(latest.id, chosen);
}

/* ------------------------------------------------------------------ */
/* Session record helpers                                              */
/* ------------------------------------------------------------------ */

export async function renameSession(id: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n) throw new Error('Session name can’t be empty.');
  await patch('ts.sessions', id, { name: n });
}

export async function deleteSession(id: string): Promise<void> {
  await remove('ts.sessions', id);
}

export async function assignSession(id: string, workspaceId: string | undefined): Promise<void> {
  await update('ts.sessions', (list) =>
    list.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, updatedAt: Date.now() };
      if (workspaceId) next.workspaceId = workspaceId;
      else delete next.workspaceId;
      return next;
    }),
  );
}

/**
 * Add open tabs to a workspace's latest session (creating one if it has none).
 * Tabs stay open. Duplicate URLs are not added twice. Returns tabs added.
 */
export async function addTabsToWorkspace(tabs: RuntimeTab[], workspaceId: string): Promise<{ added: number; skipped: number }> {
  const sessions = await get('ts.sessions');
  const latest = latestSession(sessions, workspaceId);
  if (!latest) {
    const res = await saveTabsAsSession(tabs, [], { workspaceId });
    return { added: res.session?.tabs.length ?? 0, skipped: res.skipped };
  }
  const existing = new Set(latest.tabs.map((t) => t.url));
  let skipped = 0;
  const additions: SavedTab[] = [];
  for (const t of [...tabs].sort((a, b) => a.index - b.index)) {
    const url = t.url || t.pendingUrl || '';
    if (!isRestorableUrl(url)) {
      skipped++;
      continue;
    }
    if (existing.has(url)) continue;
    existing.add(url);
    const st: SavedTab = { id: newId(), url, title: t.title?.trim() || url, pinned: !!t.pinned };
    if (isSafeUrl(t.favIconUrl)) st.favIconUrl = t.favIconUrl;
    additions.push(st);
  }
  if (additions.length) {
    await update('ts.sessions', (list) => list.map((s) => (s.id === latest.id ? { ...s, tabs: [...s.tabs, ...additions], updatedAt: Date.now() } : s)));
    await recordActivity(workspaceId);
  }
  return { added: additions.length, skipped };
}

/* ------------------------------------------------------------------ */
/* Editing a workspace's saved tabs                                    */
/* ------------------------------------------------------------------ */
/*
 * A workspace's "saved tabs" are its latest non-archived session. Every edit is
 * a single read-modify-write of `ts.sessions` (store.update), only touches that
 * one session, never deletes the workspace and never touches live Chrome tabs.
 * If the workspace has no session yet, the first edit that adds something
 * creates exactly one.
 */

async function requireWorkspaceName(workspaceId: string): Promise<string> {
  const ws = (await get('ts.workspaces')).find((w) => w.id === workspaceId);
  if (!ws) throw new Error('That workspace no longer exists.');
  return ws.name;
}

function blankSession(workspaceId: string, name: string, now: number): SavedSession {
  return { id: newId(), name: `${name} — saved tabs`, workspaceId, tabs: [], groups: [], createdAt: now, updatedAt: now };
}

/** Apply `edit` to the workspace's saved-tabs session atomically. Returning the same session object = no change. */
export async function editSavedTabs<R>(workspaceId: string, edit: (s: SavedSession) => { session: SavedSession; result: R }): Promise<R> {
  const name = await requireWorkspaceName(workspaceId);
  let result!: R;
  await update('ts.sessions', (list) => {
    const latest = latestSession(list, workspaceId);
    const now = Date.now();
    const base = latest ?? blankSession(workspaceId, name, now);
    const out = edit(base);
    result = out.result;
    if (out.session === base) return list;
    // Keep it the latest even if the clock has not moved since the last write.
    const next: SavedSession = { ...out.session, id: base.id, workspaceId, updatedAt: Math.max(now, base.updatedAt + 1) };
    return latest ? list.map((s) => (s.id === latest.id ? next : s)) : [...list, next];
  });
  return result;
}

/** Remove a saved tab; returns what's needed to undo it (undefined if it was already gone). */
export async function removeWorkspaceTab(workspaceId: string, savedTabId: string): Promise<RemovedTab | undefined> {
  return editSavedTabs(workspaceId, (s) => ({ session: removeSavedTabPure(s, savedTabId), result: describeRemoval(s, savedTabId) }));
}

/** Undo removeWorkspaceTab: the tab goes back to its original position in the saved list. */
export async function undoRemoveWorkspaceTab(workspaceId: string, removed: RemovedTab): Promise<void> {
  await editSavedTabs(workspaceId, (s) => ({ session: restoreRemovedTab(s, removed), result: undefined }));
}

export async function moveWorkspaceTab(workspaceId: string, savedTabId: string, toIndex: number): Promise<void> {
  await editSavedTabs(workspaceId, (s) => ({ session: moveSavedTabPure(s, savedTabId, toIndex), result: undefined }));
}

export type AddTabResult = { status: 'added' | 'duplicate'; url: string; title: string };

async function addToWorkspace(workspaceId: string, tab: { url: string; title: string; favIconUrl?: string }, allowDuplicate: boolean): Promise<AddTabResult> {
  const res = await editSavedTabs<AddTabResult>(workspaceId, (s) => {
    if (!allowDuplicate && hasUrl(s, tab.url)) return { session: s, result: { status: 'duplicate', url: tab.url, title: tab.title } };
    return { session: addSavedTabPure(s, { id: newId(), ...tab }), result: { status: 'added', url: tab.url, title: tab.title } };
  });
  if (res.status === 'added') await recordActivity(workspaceId);
  return res;
}

/** Add a pasted/typed URL. Throws on invalid input; returns status 'duplicate' (nothing saved) unless allowDuplicate. */
export async function addWorkspaceUrl(workspaceId: string, input: string, opts: { allowDuplicate?: boolean; title?: string } = {}): Promise<AddTabResult> {
  const url = normalizeUrl(input);
  if (!url) throw new Error('Enter a valid web address (http or https).');
  return addToWorkspace(workspaceId, { url, title: opts.title?.trim() || hostname(url) || url }, !!opts.allowDuplicate);
}

/** Add the current web tab of the window holding this Tabspace page (see getCurrentWebTab). */
export async function addCurrentTabToWorkspace(workspaceId: string, opts: { allowDuplicate?: boolean } = {}): Promise<AddTabResult> {
  const tab = await getCurrentWebTab();
  if (!tab) throw new Error('No web page is open in this window to add.');
  const url = tabUrl(tab);
  return addToWorkspace(workspaceId, { url, title: tab.title?.trim() || url, favIconUrl: tab.favIconUrl }, !!opts.allowDuplicate);
}

export type SaveSelectionMode = 'replace' | 'merge';

export interface SaveSelectionResult {
  saved: number;
  skipped: number;
  duplicates: number;
  /** Replace mode: id of the history copy holding the previous saved tabs (if there were any). */
  historyId?: string;
}

/**
 * Save the user's selection of window tabs into the workspace (native group info kept for selected tabs).
 * - 'replace': the saved tabs become exactly the selection; the previous list is kept as a history session.
 * - 'merge': selected tabs not already saved are appended.
 */
export async function saveSelectionToWorkspace(workspaceId: string, tabs: RuntimeTab[], groups: RuntimeGroup[], mode: SaveSelectionMode): Promise<SaveSelectionResult> {
  const name = await requireWorkspaceName(workspaceId);
  const serialized = serializeTabs(tabs, groups, newId);
  if (!serialized.tabs.length) throw new Error(serialized.skipped ? 'None of the selected tabs are web pages, so nothing was saved.' : 'Select at least one tab.');
  let out: SaveSelectionResult = { saved: 0, skipped: serialized.skipped, duplicates: 0 };
  if (mode === 'merge') {
    out = await editSavedTabs(workspaceId, (s) => {
      const m = mergeSavedTabs(s, serialized);
      return { session: m.added ? m.session : s, result: { saved: m.added, skipped: serialized.skipped, duplicates: m.duplicates } };
    });
  } else {
    await update('ts.sessions', (list) => {
      const latest = latestSession(list, workspaceId);
      const now = Date.now();
      if (!latest) {
        out = { saved: serialized.tabs.length, skipped: serialized.skipped, duplicates: 0 };
        return [...list, { ...blankSession(workspaceId, name, now), tabs: serialized.tabs, groups: serialized.groups }];
      }
      const next: SavedSession = { ...latest, tabs: serialized.tabs, groups: serialized.groups, updatedAt: Math.max(now, latest.updatedAt + 1) };
      const result: SaveSelectionResult = { saved: serialized.tabs.length, skipped: serialized.skipped, duplicates: 0 };
      const replaced = list.map((s) => (s.id === latest.id ? next : s));
      if (latest.tabs.length) {
        const history: SavedSession = { ...latest, id: newId(), name: `${latest.name} (before update)` };
        result.historyId = history.id;
        replaced.push(history);
      }
      out = result;
      return replaced;
    });
  }
  if (out.saved) await recordActivity(workspaceId);
  return out;
}
