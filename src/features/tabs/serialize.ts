import type { GroupColor, SavedSession, SavedTab, SavedTabGroup } from '@/types/models';
import { isRestorableUrl, isSafeUrl } from '@/utils/url';

/**
 * Pure (de)serialisation between Chrome's runtime tab/group objects and
 * Tabspace's stable SavedSession records. Chrome runtime IDs are never
 * persisted: they change across browser restarts.
 */

export const GROUP_COLORS: GroupColor[] = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

/** Hex swatches matching Chrome's tab group palette (dark UI). Group colours are a native Chrome affordance. */
export const GROUP_COLOR_HEX: Record<GroupColor, string> = {
  grey: '#9aa0a6',
  blue: '#8ab4f8',
  red: '#f28b82',
  yellow: '#fdd663',
  green: '#81c995',
  pink: '#ff8bcb',
  purple: '#c58af9',
  cyan: '#78d9ec',
  orange: '#fcad70',
};

export function isGroupColor(c: unknown): c is GroupColor {
  return typeof c === 'string' && (GROUP_COLORS as string[]).includes(c);
}

/** Minimal shape of chrome.tabs.Tab we rely on (keeps tests free of the full type). */
export interface RuntimeTab {
  id?: number;
  index: number;
  windowId?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  favIconUrl?: string;
  pinned: boolean;
  groupId?: number;
  highlighted?: boolean;
  active?: boolean;
  lastAccessed?: number;
}

export interface RuntimeGroup {
  id: number;
  title?: string;
  color: string;
  collapsed: boolean;
  windowId?: number;
}

export const TAB_GROUP_ID_NONE = -1;

export function tabUrl(t: RuntimeTab): string {
  return t.url || t.pendingUrl || '';
}

export interface SerializedWindow {
  tabs: SavedTab[];
  groups: SavedTabGroup[];
  /** Tabs that were not saved because their URL can't be reopened (chrome://, file://, extension pages…). */
  skipped: number;
}

/**
 * Serialise a window's tabs + groups. Keeps tab order (by index), pinned state,
 * maps runtime group ids to fresh stable ids, keeps favicons only if http(s).
 */
export function serializeTabs(tabs: RuntimeTab[], groups: RuntimeGroup[], makeId: () => string): SerializedWindow {
  const ordered = [...tabs].sort((a, b) => a.index - b.index);
  const runtimeGroups = new Map(groups.map((g) => [g.id, g]));
  const idMap = new Map<number, string>();
  const outGroups: SavedTabGroup[] = [];
  const outTabs: SavedTab[] = [];
  let skipped = 0;

  for (const t of ordered) {
    const url = tabUrl(t);
    if (!isRestorableUrl(url)) {
      skipped++;
      continue;
    }
    let groupId: string | undefined;
    const rg = !t.pinned && t.groupId !== undefined && t.groupId !== TAB_GROUP_ID_NONE ? runtimeGroups.get(t.groupId) : undefined;
    if (rg) {
      groupId = idMap.get(rg.id);
      if (!groupId) {
        groupId = makeId();
        idMap.set(rg.id, groupId);
        outGroups.push({ id: groupId, title: rg.title ?? '', color: isGroupColor(rg.color) ? rg.color : 'grey', collapsed: !!rg.collapsed });
      }
    }
    const tab: SavedTab = { id: makeId(), url, title: t.title?.trim() || url, pinned: !!t.pinned };
    if (isSafeUrl(t.favIconUrl)) tab.favIconUrl = t.favIconUrl;
    if (groupId) tab.groupId = groupId;
    outTabs.push(tab);
  }
  return { tabs: outTabs, groups: outGroups, skipped };
}

/* ------------------------------------------------------------------ */
/* Restore planning                                                    */
/* ------------------------------------------------------------------ */

export interface PlannedTab {
  savedTabId: string;
  url: string;
  pinned: boolean;
  /** SavedTabGroup.id this tab joins after creation. */
  groupId?: string;
}

export interface PlannedGroup {
  savedGroupId: string;
  title: string;
  color: GroupColor;
  collapsed: boolean;
  /** Indexes into `RestorePlan.tabs`. */
  tabIndexes: number[];
}

export interface RestorePlan {
  /** Ordered list of tabs to create. Pinned tabs come first (Chrome forces them left). */
  tabs: PlannedTab[];
  groups: PlannedGroup[];
  skipped: number;
}

/** Plan a restore: which tabs to create in which order, which join which group, which are skipped. */
export function planRestore(session: Pick<SavedSession, 'tabs' | 'groups'>): RestorePlan {
  const groupsById = new Map(session.groups.map((g) => [g.id, g]));
  let skipped = 0;
  const valid: PlannedTab[] = [];
  for (const t of session.tabs) {
    if (!isRestorableUrl(t.url)) {
      skipped++;
      continue;
    }
    const p: PlannedTab = { savedTabId: t.id, url: t.url, pinned: !!t.pinned };
    // Pinned tabs can't be grouped; unknown group references are dropped.
    if (!t.pinned && t.groupId && groupsById.has(t.groupId)) p.groupId = t.groupId;
    valid.push(p);
  }
  // Pinned tabs first (Chrome forces them left). Then make every group contiguous: all members of a
  // group are emitted, in their saved relative order, at the position of the group's first member.
  // (chrome.tabs.group would otherwise move non-contiguous members itself, scrambling the order.)
  const unpinned = valid.filter((t) => !t.pinned);
  const members = new Map<string, PlannedTab[]>();
  for (const t of unpinned) if (t.groupId) members.set(t.groupId, [...(members.get(t.groupId) ?? []), t]);
  const clustered: PlannedTab[] = [];
  const emitted = new Set<string>();
  for (const t of unpinned) {
    if (!t.groupId) clustered.push(t);
    else if (!emitted.has(t.groupId)) {
      emitted.add(t.groupId);
      clustered.push(...members.get(t.groupId)!);
    }
  }
  const tabs = [...valid.filter((t) => t.pinned), ...clustered];
  const groups: PlannedGroup[] = [];
  const byId = new Map<string, PlannedGroup>();
  tabs.forEach((t, i) => {
    if (!t.groupId) return;
    let g = byId.get(t.groupId);
    if (!g) {
      const saved = groupsById.get(t.groupId)!;
      g = { savedGroupId: saved.id, title: saved.title, color: isGroupColor(saved.color) ? saved.color : 'grey', collapsed: !!saved.collapsed, tabIndexes: [] };
      byId.set(t.groupId, g);
      groups.push(g);
    }
    g.tabIndexes.push(i);
  });
  return { tabs, groups, skipped };
}

/** Split an array into chunks (used to batch hundreds of tab creations). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
