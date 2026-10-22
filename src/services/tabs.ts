/**
 * Chrome tabs / tab groups / windows wrappers (owned by Extension agent B).
 *
 * Every function throws a clear, user-presentable Error outside the extension
 * (Vite dev server, tests without a chrome mock) so UIs can toast it.
 * Nothing here closes tabs on its own: callers must confirm with the user first.
 */
import { get } from '@/storage/store';
import type { GroupColor } from '@/types/models';
import { suggestGroups, type GroupSuggestion } from '@/features/tabs/smartGrouping';
import { TAB_GROUP_ID_NONE, tabUrl } from '@/features/tabs/serialize';
import { isRestorableUrl } from '@/utils/url';

export const NOT_IN_EXTENSION = 'Open Tabspace as a Chrome extension to manage tabs.';

export function hasTabsApi(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.tabs?.query && !!chrome.windows?.getAll;
}

export function hasTabGroupsApi(): boolean {
  return hasTabsApi() && !!chrome.tabGroups?.update && !!chrome.tabs.group;
}

export function requireTabs(): typeof chrome {
  if (!hasTabsApi()) throw new Error(NOT_IN_EXTENSION);
  return chrome;
}

function requireGroups(): typeof chrome {
  if (!hasTabGroupsApi()) throw new Error('Tab groups aren’t available in this browser.');
  return chrome;
}

export interface WindowInfo {
  id: number;
  focused: boolean;
  incognito: boolean;
  tabs: chrome.tabs.Tab[];
  groups: chrome.tabGroups.TabGroup[];
}

/** All normal windows with their tabs and native groups. */
export async function listWindows(): Promise<WindowInfo[]> {
  const c = requireTabs();
  const [wins, groups] = await Promise.all([
    c.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    hasTabGroupsApi() ? c.tabGroups.query({}) : Promise.resolve([] as chrome.tabGroups.TabGroup[]),
  ]);
  return wins
    .filter((w) => w.id !== undefined)
    .map((w) => ({
      id: w.id!,
      focused: !!w.focused,
      incognito: !!w.incognito,
      tabs: [...(w.tabs ?? [])].sort((a, b) => a.index - b.index),
      groups: groups.filter((g) => g.windowId === w.id),
    }));
}

/**
 * The window the user is working in:
 * 1. an explicit `windowId`, else
 * 2. the window containing this extension tab (dashboard page, via tabs.getCurrent), else
 * 3. the window this page belongs to (popup / side panel, via windows.getCurrent), else
 * 4. the last focused normal window.
 */
export async function getTargetWindow(windowId?: number): Promise<WindowInfo> {
  const c = requireTabs();
  let win: chrome.windows.Window | undefined;
  const isNormal = (w: chrome.windows.Window | undefined) => !!w && w.id !== undefined && (w.type === undefined || w.type === 'normal');
  if (windowId === undefined) windowId = (await getOwnTab())?.windowId;
  if (windowId !== undefined && c.windows.get) {
    win = await c.windows.get(windowId, { populate: true }).catch(() => undefined);
  }
  if (!isNormal(win) && c.windows.getCurrent) {
    const cur = await c.windows.getCurrent({ populate: true }).catch(() => undefined);
    win = isNormal(cur) ? cur : undefined;
  }
  if (!isNormal(win)) {
    try {
      win = await c.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    } catch {
      win = undefined;
    }
  }
  if (!win || win.id === undefined) {
    const all = await c.windows.getAll({ populate: true, windowTypes: ['normal'] });
    win = all.find((w) => w.focused) ?? all[0];
  }
  if (!win || win.id === undefined) throw new Error('No open browser window found.');
  const groups = hasTabGroupsApi() ? await c.tabGroups.query({ windowId: win.id }) : [];
  return { id: win.id, focused: !!win.focused, incognito: !!win.incognito, tabs: [...(win.tabs ?? [])].sort((a, b) => a.index - b.index), groups };
}

/** The tab this extension page runs in (undefined in popup / side panel / outside the extension). */
export async function getOwnTab(): Promise<{ id?: number; windowId?: number } | undefined> {
  if (!hasTabsApi() || !chrome.tabs.getCurrent) return undefined;
  try {
    const t = await chrome.tabs.getCurrent();
    return t ? { id: t.id, windowId: t.windowId } : undefined;
  } catch {
    return undefined;
  }
}

/** The tab this extension page runs in (undefined in popup/side panel). */
export async function getOwnTabId(): Promise<number | undefined> {
  if (!hasTabsApi() || !chrome.tabs.getCurrent) return undefined;
  try {
    return (await chrome.tabs.getCurrent())?.id;
  } catch {
    return undefined;
  }
}

/**
 * The web page the user is "on" in the window holding this Tabspace page: the active tab if it is
 * an http(s) page, otherwise the most recently used http(s) tab (the dashboard itself is skipped).
 */
export async function getCurrentWebTab(windowId?: number): Promise<chrome.tabs.Tab | undefined> {
  const win = await getTargetWindow(windowId);
  const own = await getOwnTabId();
  const candidates = win.tabs.filter((t) => t.id !== own && isRestorableUrl(tabUrl(t)));
  return candidates.find((t) => t.active) ?? [...candidates].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

export async function activateTab(tabId: number, windowId?: number): Promise<void> {
  const c = requireTabs();
  await c.tabs.update(tabId, { active: true });
  if (windowId !== undefined) await c.windows.update(windowId, { focused: true });
}

/** Close tabs. The caller MUST have confirmed with the user. */
export async function closeTabs(tabIds: number[]): Promise<void> {
  if (!tabIds.length) return;
  await requireTabs().tabs.remove(tabIds);
}

export async function setPinned(tabIds: number[], pinned: boolean): Promise<void> {
  const c = requireTabs();
  for (const id of tabIds) await c.tabs.update(id, { pinned });
}

async function getTabs(tabIds: number[]): Promise<chrome.tabs.Tab[]> {
  const c = requireTabs();
  const out = await Promise.all(tabIds.map((id) => c.tabs.get(id).catch(() => undefined)));
  return out.filter((t): t is chrome.tabs.Tab => !!t);
}

export interface GroupResult {
  groupId: number;
  /** Pinned tabs can't be grouped and were left out. */
  skippedPinned: number;
}

/** Create a native group from tabs (pinned tabs are left out) and set its title/colour. */
export async function createGroup(tabIds: number[], props: { title: string; color: GroupColor; collapsed?: boolean; windowId?: number }): Promise<GroupResult> {
  const c = requireGroups();
  const tabs = await getTabs(tabIds);
  const groupable = tabs.filter((t) => !t.pinned && t.id !== undefined);
  if (!groupable.length) throw new Error(tabs.length ? 'Pinned tabs can’t be grouped. Unpin them first.' : 'Those tabs are no longer open.');
  const windowId = props.windowId ?? groupable[0].windowId;
  const ids = groupable.map((t) => t.id!) as [number, ...number[]];
  const groupId = await c.tabs.group({ tabIds: ids, createProperties: { windowId } });
  await c.tabGroups.update(groupId, { title: props.title.trim(), color: props.color, collapsed: !!props.collapsed });
  return { groupId, skippedPinned: tabs.length - groupable.length };
}

export async function updateGroup(groupId: number, props: { title?: string; color?: GroupColor; collapsed?: boolean }): Promise<void> {
  await requireGroups().tabGroups.update(groupId, props);
}

async function tabsInGroup(groupId: number): Promise<number[]> {
  const tabs = await requireTabs().tabs.query({ groupId });
  return tabs.map((t) => t.id).filter((id): id is number => id !== undefined);
}

export async function ungroupTabs(tabIds: number[]): Promise<void> {
  if (!tabIds.length) return;
  await requireGroups().tabs.ungroup(tabIds as [number, ...number[]]);
}

export async function ungroupGroup(groupId: number): Promise<void> {
  await ungroupTabs(await tabsInGroup(groupId));
}

/** Close every tab in a group. The caller MUST have confirmed with the user. */
export async function closeGroup(groupId: number): Promise<void> {
  await closeTabs(await tabsInGroup(groupId));
}

/** Move tabs into an existing group (pinned tabs are left out). */
export async function moveTabsToGroup(tabIds: number[], groupId: number): Promise<number> {
  const c = requireGroups();
  const tabs = (await getTabs(tabIds)).filter((t) => !t.pinned);
  if (!tabs.length) throw new Error('Pinned tabs can’t be grouped. Unpin them first.');
  await c.tabs.group({ groupId, tabIds: tabs.map((t) => t.id!) as [number, ...number[]] });
  return tabs.length;
}

/** Move tabs to another window, or to a brand new one. Returns the target window id. */
export async function moveTabsToWindow(tabIds: number[], target: number | 'new'): Promise<number> {
  const c = requireTabs();
  if (!tabIds.length) throw new Error('Select at least one tab.');
  let windowId: number;
  let rest = tabIds;
  if (target === 'new') {
    const win = await c.windows.create({ tabId: tabIds[0], focused: true });
    if (win?.id === undefined) throw new Error('Couldn’t open a new window.');
    windowId = win.id;
    rest = tabIds.slice(1);
  } else windowId = target;
  if (rest.length) await c.tabs.move(rest, { windowId, index: -1 });
  return windowId;
}

/** Apply smart-grouping suggestions (user clicked "Apply"). Returns tabs grouped. */
export async function applySuggestions(windowId: number, suggestions: GroupSuggestion[]): Promise<number> {
  const c = requireGroups();
  let n = 0;
  for (const s of suggestions) {
    if (!s.tabIds.length) continue;
    const ids = s.tabIds as [number, ...number[]];
    try {
      if (s.existingGroupId !== undefined) {
        await c.tabs.group({ groupId: s.existingGroupId, tabIds: ids });
      } else {
        const gid = await c.tabs.group({ tabIds: ids, createProperties: { windowId } });
        await c.tabGroups.update(gid, { title: s.title, color: s.color });
      }
      n += ids.length;
    } catch {
      // A tab may have closed in the meantime; keep applying the others.
    }
  }
  return n;
}

/**
 * Group a window's ungrouped tabs using the user's smart-grouping rules
 * (and built-in suggestions when `includeBuiltIns`). Intended for the service
 * worker when `settings.smartGrouping.autoApply` is on — it does nothing when
 * smart grouping is disabled. Returns the number of tabs grouped.
 */
export async function applySmartGroupingToWindow(windowId: number, opts: { includeBuiltIns?: boolean } = {}): Promise<number> {
  const settings = await get('ts.settings');
  if (!settings.smartGrouping.enabled) return 0;
  const c = requireGroups();
  const [tabs, groups] = await Promise.all([c.tabs.query({ windowId }), c.tabGroups.query({ windowId })]);
  const suggestions = suggestGroups(tabs, groups, { rules: settings.smartGrouping.rules, includeBuiltIns: !!opts.includeBuiltIns });
  return applySuggestions(windowId, suggestions);
}

const RELEVANT_UPDATE_KEYS = ['url', 'title', 'favIconUrl', 'pinned', 'groupId', 'discarded', 'audible', 'mutedInfo'];

/**
 * Listen to tab / group / window changes and call `onChange` (debounced).
 * Noisy `onUpdated` events (loading status) are ignored. Returns an unsubscribe.
 */
export function subscribeTabChanges(onChange: () => void, debounceMs = 250): () => void {
  if (!hasTabsApi()) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };
  const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => {
    if (Object.keys(info).some((k) => RELEVANT_UPDATE_KEYS.includes(k)) || info.status === 'complete') fire();
  };
  const subs: (() => void)[] = [];
  const on = <T extends (...a: never[]) => void>(ev: chrome.events.Event<T> | undefined, cb: NoInfer<T>) => {
    if (!ev) return;
    ev.addListener(cb);
    subs.push(() => ev.removeListener(cb));
  };
  on(chrome.tabs.onCreated, fire);
  on(chrome.tabs.onRemoved, fire);
  on(chrome.tabs.onUpdated, onUpdated);
  on(chrome.tabs.onMoved, fire);
  on(chrome.tabs.onAttached, fire);
  on(chrome.tabs.onDetached, fire);
  on(chrome.tabs.onActivated, fire);
  on(chrome.tabs.onReplaced, fire);
  on(chrome.tabGroups?.onCreated, fire);
  on(chrome.tabGroups?.onUpdated, fire);
  on(chrome.tabGroups?.onRemoved, fire);
  on(chrome.tabGroups?.onMoved, fire);
  on(chrome.windows?.onCreated, fire);
  on(chrome.windows?.onRemoved, fire);
  return () => {
    if (timer) clearTimeout(timer);
    for (const off of subs) off();
  };
}

export { TAB_GROUP_ID_NONE };
