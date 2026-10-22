import { update } from '@/storage/store';
import type { Note } from '@/types/models';
import type { DraftField } from './autosave';

/**
 * Unsaved-note recovery (BUG-NT1 / review F2).
 *
 * On a real unload the editor can't finish an async, locked write. Instead it
 * synchronously writes a small per-note recovery record — never the whole
 * `ts.notes` array. The next time a Tabspace page loads, `recoverUnsavedNotes()`
 * applies each record under the store lock, but only if the note still exists
 * and nobody saved it after the edit started (`updatedAt <= baseUpdatedAt`).
 * Otherwise the newer save wins and the record is dropped.
 */

export const RECOVERY_PREFIX = 'ts.notes.unsaved.';
const LOCAL_PREFIX = 'tabspace-recovery:';

export interface RecoveryRecord {
  id: string;
  fields: Partial<Pick<Note, DraftField>>;
  /** The note's `updatedAt` the editor's edits are based on (including this page's own saves). */
  baseUpdatedAt: number;
  savedAt: number;
}

const hasChromeStorage = () => typeof chrome !== 'undefined' && !!chrome.storage?.local?.set;

/** Synchronously dispatch the recovery write (safe to call from pagehide/beforeunload). */
export function writeRecoverySync(rec: RecoveryRecord): void {
  const key = RECOVERY_PREFIX + rec.id;
  try {
    if (hasChromeStorage()) void chrome.storage.local.set({ [key]: rec }).catch(() => undefined);
    else localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(rec));
  } catch {
    /* best effort */
  }
}

export async function removeRecovery(id: string): Promise<void> {
  const key = RECOVERY_PREFIX + id;
  try {
    if (hasChromeStorage()) await chrome.storage.local.remove(key);
    else localStorage.removeItem(LOCAL_PREFIX + key);
  } catch {
    /* ignore */
  }
}

function isRecord(v: unknown): v is RecoveryRecord {
  const r = v as RecoveryRecord;
  return !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.baseUpdatedAt === 'number' && !!r.fields && typeof r.fields === 'object';
}

export async function listRecovery(): Promise<RecoveryRecord[]> {
  const out: RecoveryRecord[] = [];
  try {
    if (hasChromeStorage()) {
      const all = await chrome.storage.local.get(null);
      for (const [k, v] of Object.entries(all)) if (k.startsWith(RECOVERY_PREFIX) && isRecord(v)) out.push(v);
    } else if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(LOCAL_PREFIX + RECOVERY_PREFIX)) continue;
        try {
          const v: unknown = JSON.parse(localStorage.getItem(k) ?? 'null');
          if (isRecord(v)) out.push(v);
        } catch {
          /* corrupt record: ignored, removed below by id if parseable */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Only string title/content fields are ever applied. */
function cleanFields(fields: RecoveryRecord['fields']): Partial<Pick<Note, DraftField>> {
  const out: Partial<Pick<Note, DraftField>> = {};
  if (typeof fields.title === 'string') out.title = fields.title;
  if (typeof fields.content === 'string') out.content = fields.content;
  return out;
}

/** Pure: apply a record to the list if (and only if) the note exists and hasn't been saved since. */
export function applyRecovery(list: Note[], rec: RecoveryRecord, now = Date.now()): { list: Note[]; applied: boolean } {
  const fields = cleanFields(rec.fields);
  const target = list.find((n) => n.id === rec.id);
  if (!target || target.updatedAt > rec.baseUpdatedAt || !Object.keys(fields).length) return { list, applied: false };
  return { list: list.map((n) => (n.id === rec.id ? { ...n, ...fields, updatedAt: Math.max(now, n.updatedAt + 1) } : n)), applied: true };
}

let running: Promise<number> | null = null;

/** Apply pending recovery records under the store lock, then delete them. Returns how many were applied. */
export function recoverUnsavedNotes(): Promise<number> {
  if (running) return running;
  running = (async () => {
    let applied = 0;
    for (const rec of await listRecovery()) {
      try {
        await update('ts.notes', (list) => {
          const r = applyRecovery(list, rec);
          if (r.applied) applied++;
          return r.list;
        });
      } finally {
        await removeRecovery(rec.id);
      }
    }
    return applied;
  })().finally(() => {
    running = null;
  });
  return running;
}
