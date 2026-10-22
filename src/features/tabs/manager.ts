import type { SavedSession, Workspace } from '@/types/models';
import { hostname } from '@/utils/url';
import { TAB_GROUP_ID_NONE, tabUrl, type RuntimeGroup, type RuntimeTab } from './serialize';

/** Filter / search / sort helpers for the tab manager. All pure. */

export type TabSort = 'position' | 'lastActive' | 'title' | 'domain';
/** 'all', 'ungrouped' or a native group id. */
export type GroupFilter = 'all' | 'ungrouped' | number;

export function isGrouped(t: RuntimeTab): boolean {
  return t.groupId !== undefined && t.groupId !== TAB_GROUP_ID_NONE;
}

export function matchesQuery(t: RuntimeTab, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const url = tabUrl(t).toLowerCase();
  return (t.title ?? '').toLowerCase().includes(q) || url.includes(q);
}

export interface TabFilter {
  query?: string;
  group?: GroupFilter;
  /** Only tabs whose URL appears in this set (e.g. URLs saved in a workspace). */
  urls?: Set<string>;
}

export function filterTabs<T extends RuntimeTab>(tabs: T[], f: TabFilter): T[] {
  return tabs.filter((t) => {
    if (f.group === 'ungrouped' && isGrouped(t)) return false;
    if (typeof f.group === 'number' && t.groupId !== f.group) return false;
    if (f.urls && !f.urls.has(normalizeForMatch(tabUrl(t)))) return false;
    return matchesQuery(t, f.query ?? '');
  });
}

export function sortTabs<T extends RuntimeTab>(tabs: T[], sort: TabSort): T[] {
  const out = [...tabs];
  switch (sort) {
    case 'lastActive':
      // Active tab first, then most recently accessed. Tabs without lastAccessed (Chrome < 121) keep tab order.
      return out.sort((a, b) => Number(!!b.active) - Number(!!a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || a.index - b.index);
    case 'title':
      return out.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' }) || a.index - b.index);
    case 'domain':
      return out.sort((a, b) => hostname(tabUrl(a)).localeCompare(hostname(tabUrl(b))) || a.index - b.index);
    default:
      return out.sort((a, b) => a.index - b.index);
  }
}

export interface TabSection<T extends RuntimeTab, G extends RuntimeGroup = RuntimeGroup> {
  /** Native group, or null for ungrouped tabs. */
  group: G | null;
  tabs: T[];
  /** Total tabs in this group before filtering. */
  total: number;
}

/**
 * Split (already filtered + sorted) tabs into sections: one per native group
 * in window order, followed by ungrouped tabs. Empty sections are dropped.
 */
export function sectionTabs<T extends RuntimeTab, G extends RuntimeGroup>(allTabs: RuntimeTab[], visible: T[], groups: G[]): TabSection<T, G>[] {
  const firstIndex = new Map<number, number>();
  const totals = new Map<number, number>();
  let ungroupedTotal = 0;
  for (const t of allTabs) {
    if (!isGrouped(t)) {
      ungroupedTotal++;
      continue;
    }
    totals.set(t.groupId!, (totals.get(t.groupId!) ?? 0) + 1);
    const cur = firstIndex.get(t.groupId!);
    if (cur === undefined || t.index < cur) firstIndex.set(t.groupId!, t.index);
  }
  const orderedGroups = [...groups].sort((a, b) => (firstIndex.get(a.id) ?? Infinity) - (firstIndex.get(b.id) ?? Infinity));
  const buckets = new Map<number, T[]>();
  const ungrouped: T[] = [];
  for (const t of visible) {
    if (isGrouped(t)) {
      const list = buckets.get(t.groupId!) ?? [];
      list.push(t);
      buckets.set(t.groupId!, list);
    } else ungrouped.push(t);
  }
  const out: TabSection<T, G>[] = [];
  for (const g of orderedGroups) {
    const list = buckets.get(g.id);
    if (list?.length) out.push({ group: g, tabs: list, total: totals.get(g.id) ?? list.length });
  }
  if (ungrouped.length) out.push({ group: null, tabs: ungrouped, total: ungroupedTotal });
  return out;
}

export function groupCounts(tabs: RuntimeTab[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of tabs) if (isGrouped(t)) m.set(t.groupId!, (m.get(t.groupId!) ?? 0) + 1);
  return m;
}

/** Compare URLs ignoring the fragment and a trailing slash. */
export function normalizeForMatch(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** URLs saved in a workspace's (non-archived) sessions. */
export function workspaceUrls(sessions: SavedSession[], workspaceId: string): Set<string> {
  const set = new Set<string>();
  for (const s of sessions) if (s.workspaceId === workspaceId && !s.archived) for (const t of s.tabs) set.add(normalizeForMatch(t.url));
  return set;
}

/** url -> workspace name, using the most recently updated session that contains the URL. */
export function urlWorkspaceIndex(sessions: SavedSession[], workspaces: Workspace[]): Map<string, string> {
  const names = new Map(workspaces.map((w) => [w.id, w.name]));
  const out = new Map<string, string>();
  const ordered = [...sessions].filter((s) => s.workspaceId && !s.archived && names.has(s.workspaceId)).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const s of ordered) for (const t of s.tabs) {
    const k = normalizeForMatch(t.url);
    if (!out.has(k)) out.set(k, names.get(s.workspaceId!)!);
  }
  return out;
}
