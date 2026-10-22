import { describe, expect, it } from 'vitest';
import type { Note } from '@/types/models';
import { applyFormat, deriveTags, filterNotes, normalizeTag, snippet, sortNotes } from '@/features/notes/notes';

let n = 0;
const note = (p: Partial<Note>): Note => {
  n++;
  return { id: `n${n}`, title: `Note ${n}`, content: '', tags: [], favorite: false, createdAt: n, updatedAt: n, ...p };
};

describe('notes helpers', () => {
  const a = note({ title: 'Roblox ideas', tags: ['games'], favorite: true, folderId: 'f1', updatedAt: 50 });
  const b = note({ title: 'automation', content: 'Finish the AI script', tags: ['work', 'games'], updatedAt: 90 });
  const t = note({ title: 'Old', trashedAt: 5, tags: ['old'] });

  it('filters by collection and hides trash outside Trash', () => {
    expect(filterNotes([a, b, t], { kind: 'all' })).toEqual([a, b]);
    expect(filterNotes([a, b, t], { kind: 'favorites' })).toEqual([a]);
    expect(filterNotes([a, b, t], { kind: 'trash' })).toEqual([t]);
    expect(filterNotes([a, b, t], { kind: 'folder', id: 'f1' })).toEqual([a]);
    expect(filterNotes([a, b, t], { kind: 'tag', tag: 'work' })).toEqual([b]);
  });
  it('searches title and content case-insensitively', () => {
    expect(filterNotes([a, b], { kind: 'all' }, 'AI SCRIPT')).toEqual([b]);
  });
  it('sorts by last edited or title', () => {
    expect(sortNotes([a, b], 'edited')).toEqual([b, a]);
    expect(sortNotes([a, b], 'title')).toEqual([b, a]);
  });
  it('derives tag counts from non-trashed notes', () => {
    expect(deriveTags([a, b, t])).toEqual([
      { tag: 'games', count: 2 },
      { tag: 'work', count: 1 },
    ]);
  });
  it('snippet strips markdown', () => {
    expect(snippet('\n## Plan **bold** [link](https://x.com)\nmore')).toBe('Plan bold link');
    expect(snippet('- [ ] Go for a run')).toBe('Go for a run');
  });
  it('snippet skips a first line that repeats the title', () => {
    expect(snippet('# Roblox ideas\n\nBuild an obby', 'Roblox ideas')).toBe('Build an obby');
    expect(snippet('Roblox ideas\n---\nNext', 'roblox ideas')).toBe('Next');
    expect(snippet('# Other heading', 'Roblox ideas')).toBe('Other heading');
  });
  it('normalizeTag', () => {
    expect(normalizeTag('  #Deep Work ')).toBe('deep-work');
    expect(normalizeTag(' # ')).toBeNull();
  });
  it('applyFormat wraps, prefixes and toggles', () => {
    expect(applyFormat('bold', 'hello world', 6, 11)).toEqual({ value: 'hello **world**', selStart: 8, selEnd: 13 });
    expect(applyFormat('checkbox', 'a\nb', 0, 3).value).toBe('- [ ] a\n- [ ] b');
    expect(applyFormat('bullet', '- a', 0, 0).value).toBe('a');
    const link = applyFormat('link', 'see docs', 4, 8);
    expect(link.value).toBe('see [docs](https://)');
    expect(link.value.slice(link.selStart, link.selEnd)).toBe('https://');
  });
});
