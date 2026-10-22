/**
 * Membership sync between workspace tab groups and workspaces' saved tabs (V2.2).
 * Called by the service worker's tab events (src/extension/background/workspaceGroups.ts).
 *
 * Rules (only when settings.workspaceGroups.enabled && syncMembership):
 * - A tab moved INTO a workspace group, or created inside one, is added to that workspace's saved tabs (once
 *   it shows a web page; an already-saved URL is just linked, not duplicated).
 * - A tab moved OUT of a workspace group to another workspace group moves between the two workspaces; moved
 *   out to no group / a non-workspace group, it is removed from the saved tabs.
 * - Closing tabs, closing the whole group, or ungrouping the whole group NEVER removes saved tabs: "out" is
 *   processed after a short delay and only if the source group still exists.
 * - Navigating inside a grouped tab does not rewrite the saved URL (redirects and sign-in pages would
 *   otherwise silently replace saved links); use "Update from window…" to refresh saved URLs.
 */
import { get, update } from '@/storage/store';
import type { SyncRemovedTab } from '@/types/models';
import { isRestorableUrl } from '@/utils/url';
import { normalizeForMatch } from '@/features/tabs/manager';
import { addSavedTab, hasUrl, restoreRemovedTab, type RemovedTab } from '@/features/workspaces/savedTabs';
import { newId } from '@/storage/store';
import { editSavedTabs, removeWorkspaceTab } from './sessions';
import { collapseOtherWorkspaceGroups, getLinks, readTabMap, relinkWorkspaceGroups, writeTabMap } from './workspaceGroups';
import { hasTabGroupsApi } from './tabs';

async function syncEnabled(): Promise<boolean> {
  const s = await get('ts.settings');
  return s.workspaceGroups.enabled && s.workspaceGroups.syncMembership;
}

async function linkedWorkspaceOf(groupId: number | undefined): Promise<string | undefined> {
  if (groupId === undefined || groupId === -1) return undefined;
  return (await getLinks()).find((l) => l.open && l.groupId === groupId)?.workspaceId;
}

function urlOf(tab: { url?: string; pendingUrl?: string }): string {
  return tab.url || tab.pendingUrl || '';
}

/** Link a live tab to a workspace's saved tabs, adding it if its URL isn't saved yet. */
async function adoptTab(tab: chrome.tabs.Tab, workspaceId: string): Promise<void> {
  if (tab.id === undefined) return;
  const url = urlOf(tab);
  if (!isRestorableUrl(url)) {
    // Not a web page yet (new tab / still loading): remember the membership, finish on load.
    await writeTabMap({ [tab.id]: { w: workspaceId } });
    return;
  }
  const taken = new Set(Object.values(await readTabMap()).filter((v) => v.w === workspaceId && v.s).map((v) => v.s));
  const savedTabId = await editSavedTabs(workspaceId, (s) => {
    const existing = s.tabs.find((t) => normalizeForMatch(t.url) === normalizeForMatch(url) && !taken.has(t.id));
    if (existing) return { session: s, result: existing.id };
    if (hasUrl(s, url)) return { session: s, result: s.tabs.find((t) => normalizeForMatch(t.url) === normalizeForMatch(url))!.id };
    const id = newId();
    return { session: addSavedTab(s, { id, url, title: tab.title?.trim() || url, favIconUrl: tab.favIconUrl }), result: id };
  });
  await writeTabMap({ [tab.id]: { w: workspaceId, s: savedTabId } });
}

/**
 * A tab's group changed (chrome.tabs.onUpdated with changeInfo.groupId). Decisions are made after `settleMs`
 * on the tab's state at that time, so that (a) Tabspace's own "open as group" — which groups tabs a moment
 * before it stores the link — is never mistaken for a move, and (b) a whole-group ungroup/close is recognised
 * (the source group is gone) and nothing is removed.
 */
export async function handleTabGroupChange(tab: chrome.tabs.Tab, settleMs = 700): Promise<void> {
  if (tab.id === undefined || !(await syncEnabled())) return;
  if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
  const fresh = (await chrome.tabs.get(tab.id).catch(() => undefined)) as chrome.tabs.Tab | undefined;
  if (!fresh) {
    await writeTabMap({ [tab.id]: null }); // closed meanwhile: never touches saved tabs
    return;
  }
  const cur = (await readTabMap())[tab.id];
  let target = await linkedWorkspaceOf(fresh.groupId);
  if (cur && cur.w !== target && (fresh.groupId ?? -1) !== -1 && !target) {
    // The tab is now in an unlinked group: maybe its whole workspace group was dragged to another window
    // (Chrome recreates the group with a new ID). Re-link by tab identity before deciding it "moved out".
    await relinkWorkspaceGroups({ allowTitleRelink: false });
    target = await linkedWorkspaceOf(fresh.groupId);
  }
  if (cur && cur.w !== target) {
    const src = (await getLinks()).find((l) => l.workspaceId === cur.w);
    const srcAlive = src?.groupId !== undefined && hasTabGroupsApi() && !!(await chrome.tabGroups.get(src.groupId).catch(() => undefined));
    if (srcAlive && cur.s) {
      const removed = await removeWorkspaceTab(cur.w, cur.s).catch(() => undefined);
      // Dragged out to no workspace: keep a 7-day safety net (moves between workspaces aren't losses).
      if (removed && !target) await recordSyncRemoval(cur.w, removed);
    }
    await writeTabMap({ [tab.id]: null });
  }
  if (target && (!cur || cur.w !== target)) await adoptTab(fresh, target).catch(() => undefined);
}

/** A new tab was created; if Chrome put it straight into a workspace group, remember that (added once it loads). */
export async function handleTabCreated(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || !(await syncEnabled())) return;
  const target = await linkedWorkspaceOf(tab.groupId);
  if (!target) return;
  const map = await readTabMap();
  if (!map[tab.id]) await writeTabMap({ [tab.id]: { w: target } });
}

/** A tab finished loading: complete a pending adoption (tab created in / moved into a group before it had a URL). */
export async function handleTabComplete(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || !(await syncEnabled())) return;
  const cur = (await readTabMap())[tab.id];
  if (!cur || cur.s) return;
  const target = await linkedWorkspaceOf(tab.groupId);
  if (target !== cur.w) {
    await writeTabMap({ [tab.id]: null });
    return;
  }
  await adoptTab(tab, target).catch(() => undefined);
}

export async function handleTabRemoved(tabId: number): Promise<void> {
  const map = await readTabMap();
  if (map[tabId]) await writeTabMap({ [tabId]: null });
}

/** Switching to a tab of a workspace group collapses the other workspace groups in that window (opt-in). */
export async function handleTabActivated(tabId: number): Promise<void> {
  const s = await get('ts.settings');
  if (!s.workspaceGroups.enabled || !s.workspaceGroups.collapseOthers || !hasTabGroupsApi()) return;
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab || !(await linkedWorkspaceOf(tab.groupId))) return;
  await collapseOtherWorkspaceGroups(tab.windowId, tab.groupId);
}

/* ------------------------------------------------------------------ */
/* Safety net for tabs removed by membership sync                      */
/* ------------------------------------------------------------------ */

export const SYNC_REMOVED_KEEP_MS = 7 * 24 * 3600_000;

export async function recordSyncRemoval(workspaceId: string, r: RemovedTab, now = Date.now()): Promise<void> {
  const rec: SyncRemovedTab = { id: newId(), workspaceId, tab: r.tab, index: r.index, ...(r.group ? { group: r.group } : {}), removedAt: now };
  await update('ts.syncRemovedTabs', (list) => [...list.filter((x) => now - x.removedAt < SYNC_REMOVED_KEEP_MS), rec].slice(-300));
}

/** A workspace's sync-removed tabs from the last 7 days, newest first. */
export function recentSyncRemovals(list: SyncRemovedTab[], workspaceId: string, now = Date.now()): SyncRemovedTab[] {
  return list.filter((x) => x.workspaceId === workspaceId && now - x.removedAt < SYNC_REMOVED_KEEP_MS).sort((a, b) => b.removedAt - a.removedAt);
}

/** Put a sync-removed tab back at its old position (skipped if that URL is saved again meanwhile). */
export async function restoreSyncRemoval(id: string): Promise<'restored' | 'already-saved' | 'gone'> {
  const rec = (await get('ts.syncRemovedTabs')).find((x) => x.id === id);
  if (!rec) return 'gone';
  const status = await editSavedTabs(rec.workspaceId, (s) =>
    hasUrl(s, rec.tab.url) ? { session: s, result: 'already-saved' as const } : { session: restoreRemovedTab(s, { tab: rec.tab, index: rec.index, group: rec.group }), result: 'restored' as const },
  );
  await dismissSyncRemoval(id);
  return status;
}

export async function dismissSyncRemoval(id: string): Promise<void> {
  await update('ts.syncRemovedTabs', (list) => list.filter((x) => x.id !== id));
}
