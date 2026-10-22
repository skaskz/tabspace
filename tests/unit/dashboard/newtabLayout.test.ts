import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/storage/schema';
import type { NewTabLayout } from '@/types/models';
import {
  DEFAULT_LAYOUT,
  hideWidget,
  isWidgetVisible,
  setWidgetVisible,
  layoutSettingsPatch,
  moveWidget,
  normalizeLayout,
  nudgeWidget,
  resetLayout,
  resolveLayout,
  rowsFor,
  showWidget,
  splitSide,
  switchColumn,
  WIDGET_IDS,
} from '@/extension/newtab/layout';

const all = (l: NewTabLayout) => [...l.main, ...l.side, ...l.hidden].sort();

describe('New Tab layout ops', () => {
  it('default layout contains every widget exactly once', () => {
    expect(all(DEFAULT_LAYOUT)).toEqual([...WIDGET_IDS].sort());
    expect(normalizeLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
  });

  it('normalize drops unknown and duplicate ids and restores missing ones in their default column', () => {
    const l = normalizeLayout({ main: ['tasks', 'nope' as never, 'tasks'], side: ['tasks', 'calendar'], hidden: ['quote', 42 as never] });
    expect(l.main.slice(0, 1)).toEqual(['tasks']);
    expect(l.side[0]).toBe('calendar');
    expect(l.hidden).toEqual(['quote']);
    expect(all(l)).toEqual([...WIDGET_IDS].sort());
    expect(l.main).toContain('workspaces'); // missing → default column
    expect(l.side).toContain('focus');
    expect(normalizeLayout(undefined)).toEqual(normalizeLayout({}));
  });

  it('moves within and across columns (index semantics are "before item at index")', () => {
    const l = resetLayout();
    const down = moveWidget(l, 'workspaces', 'main', l.main.indexOf('recentTabs') + 1);
    expect(down.main.slice(-1)).toEqual(['workspaces']);
    const across = moveWidget(l, 'tasks', 'side', 0);
    expect(across.side[0]).toBe('tasks');
    expect(across.main).not.toContain('tasks');
    const fromHidden = moveWidget(hideWidget(l, 'focus'), 'focus', 'main', 1);
    expect(fromHidden.main[1]).toBe('focus');
    expect(fromHidden.hidden).not.toContain('focus');
  });

  it('nudge, switch column, hide, show, reset', () => {
    let l = resetLayout();
    const i = l.main.indexOf('tasks');
    expect(nudgeWidget(l, 'tasks', -1).main[i - 1]).toBe('tasks');
    expect(nudgeWidget(l, 'bar', -1)).toBe(l); // already first
    l = switchColumn(l, 'calendar');
    expect(l.main.at(-1)).toBe('calendar');
    l = hideWidget(l, 'calendar');
    expect(l.hidden).toEqual(['calendar']);
    expect(hideWidget(l, 'calendar')).toBe(l);
    l = showWidget(l, 'calendar');
    expect(l.side.at(-1)).toBe('calendar'); // back to its default column
    expect(resetLayout()).toEqual(DEFAULT_LAYOUT);
    expect(resetLayout()).not.toBe(DEFAULT_LAYOUT);
  });

  it('derives the default from the legacy showQuote/showFocus toggles, which keep applying', () => {
    expect(resolveLayout(DEFAULT_SETTINGS.newTab)).toEqual(DEFAULT_LAYOUT);
    const derived = resolveLayout({ ...DEFAULT_SETTINGS.newTab, showQuote: false, showFocus: false });
    expect(derived.hidden.sort()).toEqual(['focus', 'quote']);
    const saved = resolveLayout({ ...DEFAULT_SETTINGS.newTab, layout: { main: ['quote'], side: [], hidden: [] }, showQuote: false });
    expect(saved.hidden).toContain('quote');
  });

  it('layoutSettingsPatch keeps the legacy toggles in step', () => {
    const p = layoutSettingsPatch({ ...DEFAULT_SETTINGS.newTab, showQuote: false }, showWidget(hideWidget(resetLayout(), 'focus'), 'quote'));
    expect(p.showFocus).toBe(false);
    expect(p.showQuote).toBe(true);
    expect(p.layout!.hidden).toEqual(['focus']);
  });

  it('pairs clock+search and tasks+recentTabs only when adjacent', () => {
    expect(rowsFor(['clock', 'search', 'workspaces', 'tasks', 'recentTabs'], true)).toEqual([['clock', 'search'], ['workspaces'], ['tasks', 'recentTabs']]);
    expect(rowsFor(['tasks', 'workspaces', 'recentTabs'], true)).toEqual([['tasks'], ['workspaces'], ['recentTabs']]);
    expect(rowsFor(['tasks', 'recentTabs'], false)).toEqual([['tasks'], ['recentTabs']]);
  });

  it('splits the side column into two balanced, ordered sub-columns', () => {
    expect(splitSide(DEFAULT_LAYOUT.side)).toEqual([
      ['calendar', 'upcoming'],
      ['focus', 'spotify', 'quickLinks', 'quote'],
    ]);
    expect(splitSide(['focus'])).toEqual([['focus'], []]);
    expect(splitSide([])).toEqual([[], []]);
  });

  it('Settings toggles and Customize share one source of truth (BUG-NT21)', () => {
    const base = DEFAULT_SETTINGS.newTab;
    // Hidden via Customize…
    let nt = layoutSettingsPatch(base, hideWidget(resetLayout(), 'quote'));
    expect(isWidgetVisible(nt, 'quote')).toBe(false);
    // …turned back on from Settings: removed from hidden and placed in its default column.
    nt = setWidgetVisible(nt, 'quote', true);
    expect(isWidgetVisible(nt, 'quote')).toBe(true);
    expect(nt.showQuote).toBe(true);
    expect(nt.layout!.side.at(-1)).toBe('quote');
    // Off from Settings hides it in the layout too.
    nt = setWidgetVisible(nt, 'focus', false);
    expect(nt.layout!.hidden).toEqual(['focus']);
    expect(nt.showFocus).toBe(false);
    // Without a saved layout only the legacy toggle changes.
    const plain = setWidgetVisible(base, 'quote', false);
    expect(plain.layout).toBeUndefined();
    expect(isWidgetVisible(plain, 'quote')).toBe(false);
  });
});
