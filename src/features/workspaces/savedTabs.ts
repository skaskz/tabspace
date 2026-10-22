import type { SavedSession, SavedTab, SavedTabGroup } from '@/types/models';
import { isSafeUrl } from '@/utils/url';
import { normalizeForMatch } from '@/features/tabs/manager';

/**
 * Pure editing operations on a workspace's "saved tabs".
 *
 * Model: a workspace's saved tabs ARE its latest non-archived session
 * (see `latestSession`). Older sessions are history. Every function here
 * returns a new session object and never mutates its input.
 *
 * Group integrity rules (kept in storage so restore and UI agree):
 *  - a group with no remaining tabs is dropped;
 *  - pinned tabs never carry a groupId;
 *  - moving a tab between two members of the same group puts it in that group;
 *  - moving a grouped tab away from every other member of its group ungroups it.
 */

type Editable = Pick<SavedSession, 'tabs' | 'groups'>;

/** Drop groups that no tab references, and group references to unknown groups / on pinned tabs. */
export function pruneGroups<T extends Editable>(s: T): T {
  const known = new Set(s.groups.map((g) => g.id));
  const tabs = s.tabs.map((t) => {
    if (t.groupId && (t.pinned || !known.has(t.groupId))) {
      const copy = { ...t };
      delete copy.groupId;
      return copy;
    }
    return t;
  });
  const used = new Set(tabs.map((t) => t.groupId).filter(Boolean));
  const groups = s.groups.filter((g) => used.has(g.id));
  return { ...s, tabs, groups };
}

export function removeSavedTab<T extends Editable>(s: T, tabId: string): T {
  if (!s.tabs.some((t) => t.id === tabId)) return s;
  return pruneGroups({ ...s, tabs: s.tabs.filter((t) => t.id !== tabId) });
}

export function hasUrl(s: Editable, url: string): boolean {
  const k = normalizeForMatch(url);
  return s.tabs.some((t) => normalizeForMatch(t.url) === k);
}

/** Append a tab (ungrouped, unpinned). Only http(s) URLs are accepted. */
export function addSavedTab<T extends Editable>(s: T, tab: Omit<SavedTab, 'pinned' | 'groupId'> & { pinned?: boolean }): T {
  if (!isSafeUrl(tab.url)) throw new Error('Only web pages (http or https) can be saved.');
  const t: SavedTab = { id: tab.id, url: tab.url, title: tab.title?.trim() || tab.url, pinned: !!tab.pinned };
  if (isSafeUrl(tab.favIconUrl)) t.favIconUrl = tab.favIconUrl;
  return { ...s, tabs: [...s.tabs, t] };
}

/** Move a tab to `toIndex` in the flat list, then fix its group membership (see rules above). */
export function moveSavedTab<T extends Editable>(s: T, tabId: string, toIndex: number): T {
  const from = s.tabs.findIndex((t) => t.id === tabId);
  if (from < 0) return s;
  const to = Math.max(0, Math.min(s.tabs.length - 1, toIndex));
  if (to === from) return s;
  const tabs = [...s.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  const prev = tabs[to - 1];
  const next = tabs[to + 1];
  let groupId = moved.groupId;
  if (!moved.pinned && prev?.groupId && prev.groupId === next?.groupId) {
    groupId = prev.groupId;
  } else if (groupId && prev?.groupId !== groupId && next?.groupId !== groupId) {
    groupId = undefined;
  }
  const fixed: SavedTab = { ...moved };
  if (groupId) fixed.groupId = groupId;
  else delete fixed.groupId;
  tabs[to] = fixed;
  return pruneGroups({ ...s, tabs });
}

/**
 * Merge new tabs/groups into a session. URLs already saved are skipped;
 * incoming groups reuse an existing group with the same title and colour.
 */
export function mergeSavedTabs<T extends Editable>(s: T, incoming: Editable): { session: T; added: number; duplicates: number } {
  const seen = new Set(s.tabs.map((t) => normalizeForMatch(t.url)));
  const groupMap = new Map<string, string>();
  const groups: SavedTabGroup[] = [...s.groups];
  for (const g of incoming.groups) {
    const same = s.groups.find((x) => x.title.trim().toLowerCase() === g.title.trim().toLowerCase() && x.color === g.color && g.title.trim());
    if (same) groupMap.set(g.id, same.id);
    else {
      groupMap.set(g.id, g.id);
      groups.push(g);
    }
  }
  const tabs = [...s.tabs];
  let added = 0;
  let duplicates = 0;
  for (const t of incoming.tabs) {
    if (!isSafeUrl(t.url)) continue; // defence in depth: only http(s) pages are ever saved
    const k = normalizeForMatch(t.url);
    if (seen.has(k)) {
      duplicates++;
      continue;
    }
    seen.add(k);
    const copy: SavedTab = { ...t };
    if (t.groupId) copy.groupId = groupMap.get(t.groupId);
    if (!copy.groupId) delete copy.groupId;
    tabs.push(copy);
    added++;
  }
  return { session: pruneGroups({ ...s, tabs, groups }), added, duplicates };
}

export interface RemovedTab {
  tab: SavedTab;
  /** Index the tab had before removal. */
  index: number;
  /** Its group, captured so undo can bring the group back if removal emptied it. */
  group?: SavedTabGroup;
}

/** Info needed to undo a removal (undefined if the tab isn't in the session). */
export function describeRemoval(s: Editable, tabId: string): RemovedTab | undefined {
  const index = s.tabs.findIndex((t) => t.id === tabId);
  if (index < 0) return undefined;
  const tab = s.tabs[index];
  const group = tab.groupId ? s.groups.find((g) => g.id === tab.groupId) : undefined;
  return { tab, index, group };
}

/** Undo a removal: put the tab back at its original index (clamped), restoring its group if needed. No-op if already present. */
export function restoreRemovedTab<T extends Editable>(s: T, r: RemovedTab): T {
  if (s.tabs.some((t) => t.id === r.tab.id)) return s;
  const tabs = [...s.tabs];
  tabs.splice(Math.max(0, Math.min(tabs.length, r.index)), 0, r.tab);
  const groups = r.group && !s.groups.some((g) => g.id === r.group!.id) ? [...s.groups, r.group] : s.groups;
  return pruneGroups({ ...s, tabs, groups });
}
