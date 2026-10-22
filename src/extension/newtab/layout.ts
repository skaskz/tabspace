import type { NewTabLayout, NewTabWidgetId, Settings } from '@/types/models';

/**
 * Pure New Tab layout operations. A layout is two ordered columns (`main`, the
 * wide one, and `side`) plus a `hidden` list. Every known widget appears in
 * exactly one of the three lists after `normalizeLayout`.
 */

export type Column = 'main' | 'side';

export const WIDGETS: { id: NewTabWidgetId; label: string; column: Column }[] = [
  { id: 'bar', label: 'Tabspace Bar', column: 'main' },
  { id: 'clock', label: 'Clock', column: 'main' },
  { id: 'search', label: 'Search', column: 'main' },
  { id: 'workspaces', label: 'Workspaces', column: 'main' },
  { id: 'tasks', label: 'Today’s Tasks', column: 'main' },
  { id: 'recentTabs', label: 'Recent Tabs', column: 'main' },
  { id: 'quote', label: 'Daily quote', column: 'side' },
  { id: 'calendar', label: 'Calendar', column: 'side' },
  { id: 'upcoming', label: 'Upcoming Events', column: 'side' },
  { id: 'focus', label: 'Focus Mode', column: 'side' },
  { id: 'spotify', label: 'Spotify', column: 'side' },
  { id: 'quickLinks', label: 'Quick Links', column: 'side' },
];

export const WIDGET_IDS = WIDGETS.map((w) => w.id);
const KNOWN = new Set<string>(WIDGET_IDS);
export const widgetLabel = (id: NewTabWidgetId) => WIDGETS.find((w) => w.id === id)?.label ?? id;
const defaultColumn = (id: NewTabWidgetId): Column => WIDGETS.find((w) => w.id === id)?.column ?? 'main';

/** The built-in arrangement (matches the pre-customisation New Tab). */
export const DEFAULT_LAYOUT: NewTabLayout = {
  main: ['bar', 'clock', 'search', 'workspaces', 'tasks', 'recentTabs'],
  side: ['calendar', 'upcoming', 'focus', 'spotify', 'quickLinks', 'quote'],
  hidden: [],
};

const clone = (l: NewTabLayout): NewTabLayout => ({ main: [...l.main], side: [...l.side], hidden: [...l.hidden] });

/** Drop unknown/duplicate ids (first occurrence wins: main, side, hidden) and place widgets that are missing in their default column. */
export function normalizeLayout(input: Partial<NewTabLayout> | undefined | null): NewTabLayout {
  const seen = new Set<string>();
  const take = (list: unknown): NewTabWidgetId[] =>
    (Array.isArray(list) ? list : []).filter((id): id is NewTabWidgetId => typeof id === 'string' && KNOWN.has(id) && !seen.has(id) && !!seen.add(id));
  const out: NewTabLayout = { main: take(input?.main), side: take(input?.side), hidden: take(input?.hidden) };
  for (const id of WIDGET_IDS) if (!seen.has(id)) out[defaultColumn(id)].push(id);
  return out;
}

/** The effective layout: the saved one, or the default derived from the older per-widget toggles. */
export function resolveLayout(newTab: Settings['newTab']): NewTabLayout {
  let l = newTab.layout ? normalizeLayout(newTab.layout) : clone(DEFAULT_LAYOUT);
  // The Settings page toggles still apply: "show quote/focus" off hides them wherever they are.
  if (newTab.showQuote === false) l = hideWidget(l, 'quote');
  if (newTab.showFocus === false) l = hideWidget(l, 'focus');
  return l;
}

/** Whether a widget is currently shown (single source of truth: the effective layout). */
export function isWidgetVisible(newTab: Settings['newTab'], id: NewTabWidgetId): boolean {
  return !resolveLayout(newTab).hidden.includes(id);
}

/**
 * Show or hide one widget from anywhere (Customize, Settings toggles). With a saved
 * layout the widget is moved in/out of `hidden` (shown widgets return to their
 * default column); without one, only the legacy toggle is needed.
 */
export function setWidgetVisible(newTab: Settings['newTab'], id: NewTabWidgetId, visible: boolean): Settings['newTab'] {
  if (!newTab.layout) {
    if (id === 'quote') return { ...newTab, showQuote: visible };
    if (id === 'focus') return { ...newTab, showFocus: visible };
    const l = visible ? showWidget(resolveLayout(newTab), id) : hideWidget(resolveLayout(newTab), id);
    return layoutSettingsPatch(newTab, l);
  }
  const base = normalizeLayout(newTab.layout);
  return layoutSettingsPatch(newTab, visible ? showWidget(base, id) : hideWidget(base, id));
}

/** Settings patch that stores a layout and keeps the legacy quote/focus toggles in step with it. */
export function layoutSettingsPatch(newTab: Settings['newTab'], layout: NewTabLayout): Settings['newTab'] {
  return { ...newTab, layout: normalizeLayout(layout), showQuote: !layout.hidden.includes('quote'), showFocus: !layout.hidden.includes('focus') };
}

export function columnOf(l: NewTabLayout, id: NewTabWidgetId): Column | 'hidden' {
  return l.main.includes(id) ? 'main' : l.side.includes(id) ? 'side' : 'hidden';
}

const without = (l: NewTabLayout, id: NewTabWidgetId): NewTabLayout => ({
  main: l.main.filter((x) => x !== id),
  side: l.side.filter((x) => x !== id),
  hidden: l.hidden.filter((x) => x !== id),
});

/** Move a widget to `column` at `index` (clamped). Works for hidden widgets too (shows them). */
export function moveWidget(l: NewTabLayout, id: NewTabWidgetId, column: Column, index: number): NewTabLayout {
  const from = columnOf(l, id);
  // Moving down within the same column: the removal shifts later indices by one.
  const adjusted = from === column && l[column].indexOf(id) < index ? index - 1 : index;
  const next = without(l, id);
  const list = next[column];
  list.splice(Math.max(0, Math.min(adjusted, list.length)), 0, id);
  return next;
}

/** Move one step up (-1) or down (+1) within its column. */
export function nudgeWidget(l: NewTabLayout, id: NewTabWidgetId, dir: -1 | 1): NewTabLayout {
  const col = columnOf(l, id);
  if (col === 'hidden') return l;
  const i = l[col].indexOf(id);
  const j = i + dir;
  if (j < 0 || j >= l[col].length) return l;
  const next = clone(l);
  [next[col][i], next[col][j]] = [next[col][j], next[col][i]];
  return next;
}

/** Move to the end of the other column. */
export function switchColumn(l: NewTabLayout, id: NewTabWidgetId): NewTabLayout {
  const col = columnOf(l, id);
  if (col === 'hidden') return l;
  const other: Column = col === 'main' ? 'side' : 'main';
  return moveWidget(l, id, other, l[other].length);
}

export function hideWidget(l: NewTabLayout, id: NewTabWidgetId): NewTabLayout {
  if (columnOf(l, id) === 'hidden') return l;
  const next = without(l, id);
  next.hidden.push(id);
  return next;
}

/** Show a hidden widget at the end of its default column. */
export function showWidget(l: NewTabLayout, id: NewTabWidgetId): NewTabLayout {
  if (columnOf(l, id) !== 'hidden') return l;
  const col = defaultColumn(id);
  return moveWidget(l, id, col, l[col].length);
}

export function resetLayout(): NewTabLayout {
  return clone(DEFAULT_LAYOUT);
}

/** Widgets that sit side by side when adjacent in the wide column. */
const PAIRS: NewTabWidgetId[][] = [
  ['clock', 'search'],
  ['tasks', 'recentTabs'],
];

/** Group a column's widgets into rows: adjacent pairs (clock+search, tasks+recentTabs) share a row. */
export function rowsFor(ids: NewTabWidgetId[], pairing: boolean): NewTabWidgetId[][] {
  const rows: NewTabWidgetId[][] = [];
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i];
    const b = ids[i + 1];
    if (pairing && b && PAIRS.some((p) => p.includes(a) && p.includes(b))) {
      rows.push([a, b]);
      i++;
    } else rows.push([a]);
  }
  return rows;
}

/** Rough rendered heights (px) used to balance the side column into two sub-columns. */
const EST: Partial<Record<NewTabWidgetId, number>> = { quote: 60, calendar: 300, upcoming: 200, focus: 130, spotify: 90, quickLinks: 220, workspaces: 200, tasks: 220, recentTabs: 220, clock: 120, search: 60, bar: 40 };

/** Split the side column into two balanced sub-columns, preserving order (wide screens). */
export function splitSide(ids: NewTabWidgetId[]): [NewTabWidgetId[], NewTabWidgetId[]] {
  const total = ids.reduce((s, id) => s + (EST[id] ?? 150), 0);
  const a: NewTabWidgetId[] = [];
  let sum = 0;
  let i = 0;
  while (i < ids.length && (a.length === 0 || sum < total / 2)) {
    sum += EST[ids[i]] ?? 150;
    a.push(ids[i++]);
  }
  return [a, ids.slice(i)];
}
