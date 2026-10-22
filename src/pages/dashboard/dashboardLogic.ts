import type { Bookmark, Note, SavedSession, Task, Workspace } from '@/types/models';
import type { Occurrence } from '@/features/calendar/occurrences';
import { addDays, isSameDay, startOfDay, toDateKey } from '@/utils/date';

/** Pure helpers for the Home Dashboard. */

export function latestSession(sessions: SavedSession[], workspaceId: string): SavedSession | undefined {
  let best: SavedSession | undefined;
  for (const s of sessions) {
    if (s.workspaceId !== workspaceId || s.archived) continue;
    if (!best || s.updatedAt > best.updatedAt) best = s;
  }
  return best;
}

export interface WorkspaceStats {
  tabs: number;
  tasks: number;
  notes: number;
  /** Up to 3 saved tab URLs for favicon previews. */
  previewUrls: string[];
}

export function workspaceStats(ws: Workspace, sessions: SavedSession[], tasks: Task[], notes: Note[]): WorkspaceStats {
  const session = latestSession(sessions, ws.id);
  return {
    tabs: session?.tabs.length ?? 0,
    tasks: tasks.filter((t) => t.workspaceId === ws.id && !t.done).length,
    notes: notes.filter((n) => n.workspaceId === ws.id && !n.trashedAt).length,
    previewUrls: (session?.tabs ?? []).slice(0, 3).map((t) => t.url),
  };
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "Today, 6:00 AM" · "Tomorrow, 6:00 AM" · "Fri, Oct 24, 6:00 AM" · "Tomorrow · All day". */
export function friendlyWhen(o: Pick<Occurrence, 'start' | 'allDay'>, now = new Date()): string {
  const today = startOfDay(now);
  const day = isSameDay(o.start, today) ? 'Today' : isSameDay(o.start, addDays(today, 1)) ? 'Tomorrow' : o.start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (o.allDay) return `${day} · All day`;
  return `${day}, ${o.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** Set of `YYYY-MM-DD` keys (local) that have at least one occurrence. */
export function daysWithEvents(occ: Occurrence[]): Set<string> {
  const out = new Set<string>();
  for (const o of occ) {
    // Mark every day the occurrence touches (multi-day events), bounded to 62 days.
    let d = startOfDay(o.start);
    for (let i = 0; i < 62 && d < o.end; i++) {
      out.add(toDateKey(d));
      d = addDays(d, 1);
    }
  }
  return out;
}

/** Next N occurrences that haven't ended yet. */
export function upcoming(occ: Occurrence[], now: Date, n = 4): Occurrence[] {
  return occ.filter((o) => o.end > now).slice(0, n);
}

export function isEmptyAccount(d: { workspaces: Workspace[]; tasks: Task[]; notes: Note[]; bookmarks: Bookmark[] }): boolean {
  return !d.workspaces.length && !d.tasks.length && !d.notes.length && !d.bookmarks.length;
}

export function formatDateLine(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
