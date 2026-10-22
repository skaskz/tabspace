import type { Bookmark, Note, Task, Workspace } from '@/types/models';
import { hostname } from '@/utils/url';
import { toDateKey } from '@/utils/date';
import { dueLabel } from '@/features/tasks/buckets';
import type { OpenTab } from './chromeTabs';

/**
 * Global search ranking. Case-insensitive; title matches always rank above
 * body/url matches. Results are grouped by kind in a fixed order.
 */

export type ResultKind = 'tab' | 'workspace' | 'task' | 'note' | 'bookmark';

export interface SearchResult {
  kind: ResultKind;
  id: string;
  title: string;
  subtitle?: string;
  score: number;
  /** For tab/bookmark results. */
  url?: string;
  tab?: OpenTab;
}

export interface SearchSources {
  tasks: Task[];
  notes: Note[];
  bookmarks: Bookmark[];
  workspaces: Workspace[];
  tabs: OpenTab[];
}

/** Score a title against the query: exact 100, prefix 90, word-prefix 75, substring 60, 0 = none. */
export function scoreTitle(title: string, q: string): number {
  const t = title.toLowerCase();
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (new RegExp(`(^|[\\s\\-_/.:(])${escapeRegex(q)}`).test(t)) return 75;
  if (t.includes(q)) return 60;
  return 0;
}

/** Body / secondary-field match: always below any title match. */
export function scoreBody(texts: (string | undefined)[], q: string): number {
  return texts.some((s) => s && s.toLowerCase().includes(q)) ? 20 : 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function score(title: string, body: (string | undefined)[], q: string): number {
  const ts = scoreTitle(title, q);
  return ts > 0 ? ts : scoreBody(body, q);
}

export const GROUP_ORDER: ResultKind[] = ['tab', 'workspace', 'task', 'note', 'bookmark'];
export const GROUP_LABEL: Record<ResultKind, string> = {
  tab: 'Open tabs',
  workspace: 'Workspaces',
  task: 'Tasks',
  note: 'Notes',
  bookmark: 'Bookmarks',
};

export function search(query: string, src: SearchSources, perGroup = 5, today = toDateKey()): { kind: ResultKind; results: SearchResult[] }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all: SearchResult[] = [];
  const push = (r: SearchResult) => r.score > 0 && all.push(r);

  for (const t of src.tabs) push({ kind: 'tab', id: String(t.id), title: t.title, subtitle: hostname(t.url), url: t.url, tab: t, score: score(t.title, [t.url], q) });
  for (const w of src.workspaces) push({ kind: 'workspace', id: w.id, title: w.name, subtitle: w.description, score: score(w.name, [w.description], q) });
  for (const t of src.tasks)
    push({ kind: 'task', id: t.id, title: t.title, subtitle: t.done ? 'Completed' : t.dueDate ? `Due ${dueLabel(t.dueDate, today)}` : undefined, score: score(t.title, [t.notes, ...t.subtasks.map((s) => s.title)], q) - (t.done ? 5 : 0) });
  for (const n of src.notes) {
    if (n.trashedAt) continue;
    push({ kind: 'note', id: n.id, title: n.title || 'Untitled note', subtitle: n.tags.length ? n.tags.map((t) => `#${t}`).join(' ') : undefined, score: score(n.title, [n.content, ...n.tags], q) });
  }
  for (const b of src.bookmarks) push({ kind: 'bookmark', id: b.id, title: b.title || b.url, subtitle: hostname(b.url), url: b.url, score: score(b.title, [b.url, b.description, b.notes, ...b.tags], q) });

  return GROUP_ORDER.map((kind) => ({
    kind,
    results: all
      .filter((r) => r.kind === kind)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, perGroup),
  })).filter((g) => g.results.length > 0);
}
