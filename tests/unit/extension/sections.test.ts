import { describe, expect, it } from 'vitest';
import { enabledSections, resolveSection } from '@/extension/sidebar/sections';
import { DEFAULT_SETTINGS } from '@/storage/schema';
import type { Settings } from '@/types/models';

const sb = (p: Partial<Settings['sidebar']>, sections?: Partial<Settings['sidebar']['sections']>): Pick<Settings, 'sidebar'> => ({
  sidebar: { ...DEFAULT_SETTINGS.sidebar, ...p, sections: { ...DEFAULT_SETTINGS.sidebar.sections, ...sections } },
});

describe('sidebar section resolution', () => {
  it('uses the configured default view when visible', () => {
    expect(resolveSection(sb({ defaultView: 'notes' }), 'tasks')).toBe('notes');
  });
  it('remembers the last section when default is "last"', () => {
    expect(resolveSection(sb({ defaultView: 'last' }), 'bookmarks')).toBe('bookmarks');
    expect(resolveSection(sb({}), null)).toBe('focus');
  });
  it('never shows a hidden section', () => {
    expect(resolveSection(sb({ defaultView: 'notes' }, { notes: false, focus: false }), 'focus')).toBe('tasks');
    expect(resolveSection(sb({}, { focus: false }), 'garbage')).toBe('tasks');
  });
  it('returns null when everything is hidden', () => {
    const off = { focus: false, tasks: false, notes: false, bookmarks: false, workspaces: false };
    expect(enabledSections(sb({}, off))).toEqual([]);
    expect(resolveSection(sb({}, off), 'tasks')).toBeNull();
  });
});
