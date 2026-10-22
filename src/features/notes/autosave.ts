import type { Note } from '@/types/models';

/** Editable text fields of a note that autosave tracks individually. */
export type DraftField = 'title' | 'content';
export type Draft = Record<DraftField, string>;

/** Only the fields the user actually edited, so an untouched field saved elsewhere is never overwritten. */
export function dirtyChanges(draft: Draft, dirty: ReadonlySet<DraftField>): Partial<Pick<Note, DraftField>> {
  const out: Partial<Pick<Note, DraftField>> = {};
  for (const f of dirty) out[f] = draft[f];
  return out;
}

/** Apply changes to one note in a list without a storage read (used for the synchronous unload save). */
export function patchNoteList(list: Note[], id: string, changes: Partial<Note>, now = Date.now()): Note[] | null {
  if (!list.some((n) => n.id === id)) return null;
  return list.map((n) => (n.id === id ? { ...n, ...changes, id, updatedAt: now } : n));
}

/**
 * Reconcile the editor with a stored note that changed elsewhere: adopt each
 * field whose *stored* value changed since the previous snapshot and that has
 * no unsaved local edit. Comparing against the previous snapshot (not just the
 * draft) means a re-render while our own save is still in flight never reverts
 * the draft. Returns null when nothing changes.
 */
export function adoptExternal(draft: Draft, stored: Pick<Note, DraftField>, previous: Pick<Note, DraftField>, dirty: ReadonlySet<DraftField>): Draft | null {
  let changed = false;
  const next = { ...draft };
  for (const f of ['title', 'content'] as const) {
    if (!dirty.has(f) && stored[f] !== previous[f] && draft[f] !== stored[f]) {
      next[f] = stored[f];
      changed = true;
    }
  }
  return changed ? next : null;
}
