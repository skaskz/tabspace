import type { Note } from '@/types/models';

/** Pure note helpers: filtering, sorting, snippets, tags and editor formatting. */

export type NoteFilter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'trash' }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; tag: string };

export type NoteSort = 'edited' | 'title';

export function filterNotes(notes: Note[], filter: NoteFilter, query = ''): Note[] {
  const q = query.trim().toLowerCase();
  return notes.filter((n) => {
    if (filter.kind === 'trash') {
      if (!n.trashedAt) return false;
    } else {
      if (n.trashedAt) return false;
      if (filter.kind === 'favorites' && !n.favorite) return false;
      if (filter.kind === 'folder' && n.folderId !== filter.id) return false;
      if (filter.kind === 'tag' && !n.tags.includes(filter.tag)) return false;
    }
    if (!q) return true;
    return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q));
  });
}

export function sortNotes(notes: Note[], sort: NoteSort): Note[] {
  return [...notes].sort((a, b) =>
    sort === 'title' ? displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' }) : b.updatedAt - a.updatedAt,
  );
}

export function displayTitle(n: Pick<Note, 'title'>): string {
  return n.title.trim() || 'Untitled note';
}

function stripLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+\[[ xX]\]\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

/**
 * First meaningful line of the body with Markdown syntax stripped, for list cards.
 * Skips code fences and a line that just repeats the note title (e.g. a leading "# Title").
 */
export function snippet(content: string, title = '', max = 90): string {
  const t = title.trim().toLowerCase();
  let plain = '';
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || /^```/.test(line) || /^([-*_])(\s*\1){2,}$/.test(line)) continue;
    const text = stripLine(line);
    if (!text || (t && text.toLowerCase() === t)) continue;
    plain = text;
    break;
  }
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** Tags across non-trashed notes with counts, alphabetically. */
export function deriveTags(notes: Note[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of notes) if (!n.trashedAt) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Normalise a user-typed tag: lowercase, no leading '#', inner whitespace -> '-'. */
export function normalizeTag(input: string): string | null {
  const t = input.trim().replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32);
  return t || null;
}

/* ------------------------------------------------------------------ */
/* Editor toolbar                                                       */
/* ------------------------------------------------------------------ */

export type FormatKind = 'bold' | 'italic' | 'heading' | 'bullet' | 'checkbox' | 'link' | 'code';

export interface EditResult {
  value: string;
  selStart: number;
  selEnd: number;
}

function wrap(value: string, start: number, end: number, left: string, right: string, placeholder: string): EditResult {
  const selected = value.slice(start, end) || placeholder;
  const next = value.slice(0, start) + left + selected + right + value.slice(end);
  return { value: next, selStart: start + left.length, selEnd: start + left.length + selected.length };
}

function prefixLines(value: string, start: number, end: number, prefix: string): EditResult {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndIdx = value.indexOf('\n', end);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const allPrefixed = lines.every((l) => l.startsWith(prefix));
  const nextBlock = lines.map((l) => (allPrefixed ? l.slice(prefix.length) : prefix + l)).join('\n');
  const delta = nextBlock.length - block.length;
  return {
    value: value.slice(0, lineStart) + nextBlock + value.slice(lineEnd),
    selStart: Math.max(lineStart, start + (allPrefixed ? -prefix.length : prefix.length)),
    selEnd: end + delta,
  };
}

/** Apply a toolbar format to a textarea value and selection. */
export function applyFormat(kind: FormatKind, value: string, start: number, end: number): EditResult {
  switch (kind) {
    case 'bold':
      return wrap(value, start, end, '**', '**', 'bold text');
    case 'italic':
      return wrap(value, start, end, '_', '_', 'italic text');
    case 'code':
      return wrap(value, start, end, '`', '`', 'code');
    case 'heading':
      return prefixLines(value, start, end, '## ');
    case 'bullet':
      return prefixLines(value, start, end, '- ');
    case 'checkbox':
      return prefixLines(value, start, end, '- [ ] ');
    case 'link': {
      const text = value.slice(start, end) || 'link text';
      const insert = `[${text}](https://)`;
      const next = value.slice(0, start) + insert + value.slice(end);
      const urlStart = start + text.length + 3;
      return { value: next, selStart: urlStart, selEnd: urlStart + 'https://'.length };
    }
  }
}
