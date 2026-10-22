import { describe, expect, it } from 'vitest';
import { domainMatches, matchBuiltIn, matchRule, suggestGroups } from '@/features/tabs/smartGrouping';
import type { RuntimeTab } from '@/features/tabs/serialize';
import type { SmartGroupRule } from '@/types/models';

const rules: SmartGroupRule[] = [
  { id: 'r1', pattern: 'Roblox', groupTitle: 'Roblox research', color: 'orange' },
  { id: 'r2', pattern: 'github.com/me/tabspace', groupTitle: 'Tabspace', color: 'purple' },
  { id: 'r3', pattern: '   ', groupTitle: 'Empty pattern', color: 'grey' },
];

describe('matchRule', () => {
  it('matches case-insensitively on host+path', () => {
    expect(matchRule({ url: 'https://www.GitHub.com/me/Tabspace/pulls' }, rules)?.id).toBe('r2');
  });
  it('matches on title', () => {
    expect(matchRule({ url: 'https://devforum.example.com/t/1', title: 'Best ROBLOX mechanics' }, rules)?.id).toBe('r1');
  });
  it('ignores the query string and blank patterns', () => {
    expect(matchRule({ url: 'https://example.com/?q=roblox' }, rules)).toBeUndefined();
    expect(matchRule({ url: 'https://example.com/', title: '   ' }, rules)).toBeUndefined();
  });
  it('first rule wins', () => {
    expect(matchRule({ url: 'https://github.com/me/tabspace', title: 'roblox' }, rules)?.id).toBe('r1');
  });
});

describe('built-ins', () => {
  it('matches subdomains but not lookalikes', () => {
    expect(domainMatches('gist.github.com', 'github.com')).toBe(true);
    expect(domainMatches('notgithub.com', 'github.com')).toBe(false);
  });
  it('prefers the most specific domain', () => {
    expect(matchBuiltIn('https://studio.youtube.com/channel')?.title).toBe('Media');
    expect(matchBuiltIn('https://docs.google.com/document/d/1')?.title).toBe('Docs');
    expect(matchBuiltIn('https://github.com/')?.title).toBe('Development');
    expect(matchBuiltIn('chrome://newtab')).toBeUndefined();
  });
});

describe('suggestGroups', () => {
  const tabs: RuntimeTab[] = [
    { id: 1, index: 0, url: 'https://github.com/a', title: 'a', pinned: false, groupId: -1 },
    { id: 2, index: 1, url: 'https://stackoverflow.com/q/1', title: 'q', pinned: false, groupId: -1 },
    { id: 3, index: 2, url: 'https://github.com/me/tabspace', title: 'tabspace', pinned: false, groupId: -1 },
    { id: 4, index: 3, url: 'https://github.com/pinned', title: 'p', pinned: true, groupId: -1 },
    { id: 5, index: 4, url: 'https://github.com/grouped', title: 'g', pinned: false, groupId: 77 },
    { id: 6, index: 5, url: 'https://youtube.com/watch?v=1', title: 'v', pinned: false, groupId: -1 },
    { id: 7, index: 6, url: 'https://create.roblox.com/docs', title: 'docs', pinned: false, groupId: -1 },
  ];

  it('only proposes rules when built-ins are off', () => {
    const s = suggestGroups(tabs, [], { rules, includeBuiltIns: false });
    expect(s.map((x) => [x.title, x.tabIds])).toEqual([
      ['Tabspace', [3]],
      ['Roblox research', [7]],
    ]);
  });

  it('adds built-ins (min 2 tabs), skipping pinned and already-grouped tabs', () => {
    const s = suggestGroups(tabs, [], { rules, includeBuiltIns: true });
    const dev = s.find((x) => x.title === 'Development');
    expect(dev?.tabIds).toEqual([1, 2]);
    expect(dev?.source).toBe('builtin');
    expect(s.find((x) => x.title === 'Media')).toBeUndefined();
  });

  it('merges into an existing group with the same title', () => {
    const s = suggestGroups(tabs, [{ id: 55, title: 'media', color: 'red', collapsed: false }], { rules: [], includeBuiltIns: true });
    expect(s.find((x) => x.title === 'Media')).toMatchObject({ existingGroupId: 55, tabIds: [6] });
  });
});
