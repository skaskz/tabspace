import type { Bookmark, CalendarEvent, Note, SavedSession, Task, Workspace } from '@/types/models';

/** Pure workspace helpers (counts, latest session, search, delete-unassignment). */

export interface WorkspaceTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  { id: 'development', name: 'Development', icon: 'code', description: 'Repos, docs, local servers and deployments.' },
  { id: 'personal', name: 'Personal', icon: 'home', description: 'Everyday browsing, errands and plans.' },
  { id: 'content', name: 'Content Creation', icon: 'video', description: 'Scripts, edits, uploads and analytics.' },
  { id: 'research', name: 'Research', icon: 'search', description: 'Articles, references and notes in progress.' },
  { id: 'jobs', name: 'Job Search', icon: 'briefcase', description: 'Listings, applications and follow-ups.' },
];

/** Most recent non-archived session saved in a workspace. */
export function latestSession(sessions: SavedSession[], workspaceId: string): SavedSession | undefined {
  let best: SavedSession | undefined;
  for (const s of sessions) {
    if (s.workspaceId !== workspaceId || s.archived) continue;
    if (!best || s.updatedAt > best.updatedAt || (s.updatedAt === best.updatedAt && s.createdAt > best.createdAt)) best = s;
  }
  return best;
}

export function sessionsFor(sessions: SavedSession[], workspaceId: string): SavedSession[] {
  return sessions.filter((s) => s.workspaceId === workspaceId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface WorkspaceCounts {
  tabs: number;
  tasks: number;
  notes: number;
  bookmarks: number;
}

export interface WorkspaceData {
  sessions: SavedSession[];
  tasks: Task[];
  notes: Note[];
  bookmarks: Bookmark[];
}

/** Counts for a workspace card: tabs in the latest session, open tasks, notes not in trash, bookmarks. */
export function workspaceCounts(workspaceId: string, d: WorkspaceData): WorkspaceCounts {
  return {
    tabs: latestSession(d.sessions, workspaceId)?.tabs.length ?? 0,
    tasks: d.tasks.filter((t) => t.workspaceId === workspaceId && !t.done).length,
    notes: d.notes.filter((n) => n.workspaceId === workspaceId && !n.trashedAt).length,
    bookmarks: d.bookmarks.filter((b) => b.workspaceId === workspaceId).length,
  };
}

/** Up to `n` URLs (for favicons) from the latest session, distinct by host. */
export function previewUrls(sessions: SavedSession[], workspaceId: string, n = 5): string[] {
  const s = latestSession(sessions, workspaceId);
  if (!s) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of s.tabs) {
    let host = t.url;
    try {
      host = new URL(t.url).hostname;
    } catch {
      /* keep raw */
    }
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(t.url);
    if (out.length >= n) break;
  }
  return out;
}

export function searchWorkspaces(list: Workspace[], query: string): Workspace[] {
  const q = query.trim().toLowerCase();
  const sorted = [...list].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  if (!q) return sorted;
  return sorted.filter((w) => w.name.toLowerCase().includes(q) || (w.description ?? '').toLowerCase().includes(q));
}

export function nextOrder(list: Workspace[]): number {
  return list.reduce((m, w) => Math.max(m, w.order), -1) + 1;
}

/** Remove a workspace reference from records (kept, but unassigned). Returns the same array if nothing changed. */
export function unassign<T extends { workspaceId?: string; updatedAt?: number }>(items: T[], workspaceId: string, now = Date.now()): T[] {
  if (!items.some((i) => i.workspaceId === workspaceId)) return items;
  return items.map((i) => {
    if (i.workspaceId !== workspaceId) return i;
    const copy = { ...i };
    delete copy.workspaceId;
    if ('updatedAt' in copy) copy.updatedAt = now;
    return copy;
  });
}

/** How many records reference a workspace (shown in the delete confirmation). */
export function referenceCounts(workspaceId: string, d: WorkspaceData & { events: CalendarEvent[] }) {
  const has = (x: { workspaceId?: string }) => x.workspaceId === workspaceId;
  return {
    tasks: d.tasks.filter(has).length,
    notes: d.notes.filter(has).length,
    bookmarks: d.bookmarks.filter(has).length,
    sessions: d.sessions.filter(has).length,
    events: d.events.filter(has).length,
  };
}
