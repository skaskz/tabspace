import { newId, update } from '@/storage/store';
import type { Note } from '@/types/models';
import { writeRecoverySync } from '@/features/notes/recovery';
import { isSafeUrl } from '@/utils/url';

/**
 * Quick Note (toolbar popup) autosave.
 *
 * The popup can close at any instant (click outside, Esc, tab switch), so:
 *  - the note is created on the first non-blank keystroke and saved again
 *    ~400 ms after typing pauses (serialised, locked store writes);
 *  - on pagehide / visibilitychange(hidden) unsaved text is dispatched
 *    synchronously: a per-note recovery record (`writeRecoverySync`) when the
 *    note already exists, or a pending-create record when even the creating
 *    write may not have completed. The service worker merges both kinds.
 *  - Second layer: every keystroke also writes a tiny localStorage backup
 *    (synchronous, survives even an instant close in which Chrome drops the
 *    async extension-storage writes of a dying page). It is removed once a save
 *    is confirmed and merged by the next popup / side panel that opens.
 *
 * Text model: the first line is the title, the rest is the body. An optional
 * page link is appended as a markdown link line.
 */

export const QUICK_NOTE_DEBOUNCE_MS = 400;
export const PENDING_PREFIX = 'ts.quicknote.pending.';
export const LOCAL_BACKUP_PREFIX = 'tabspace-quicknote:';
const MAX_TITLE = 120;

export interface PageLink {
  url: string;
  title?: string;
}

export interface PendingQuickNote {
  note: Note;
  /** updatedAt the text is based on (0 = the note may not exist yet). */
  baseUpdatedAt: number;
}

/**
 * `[title](url)` for http(s) pages. Square brackets and backslashes are stripped from the label (the Markdown renderer
 * has no backslash escapes), so a hostile page title can't close the label early and point the link elsewhere.
 */
export function markdownLink(link: PageLink): string | null {
  if (!isSafeUrl(link.url)) return null;
  const label = (link.title?.trim() || link.url).replace(/[[\]\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || link.url;
  // encodeURIComponent leaves ( and ) alone, so map them explicitly — otherwise ')' would end the Markdown link.
  const url = link.url.replace(/[()\s]/g, (c) => (c === '(' ? '%28' : c === ')' ? '%29' : encodeURIComponent(c)));
  return `[${label}](${url})`;
}

/** Split popup text into note fields. */
export function composeNote(text: string, link?: PageLink | null): { title: string; content: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  const title = first < 0 ? '' : lines[first].replace(/^#+\s*/, '').trim().slice(0, MAX_TITLE);
  let content = first < 0 ? '' : lines.slice(first + 1).join('\n').replace(/^\n+/, '').trimEnd();
  const md = link ? markdownLink(link) : null;
  if (md) content = content ? `${content}\n\n${md}` : md;
  return { title: title || 'Quick note', content };
}

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local?.set;
}

/** Synchronously dispatch a pending-create record (safe in pagehide). */
export function writePendingSync(p: PendingQuickNote): void {
  if (!hasChromeStorage()) return;
  try {
    void chrome.storage.local.set({ [PENDING_PREFIX + p.note.id]: p }).catch(() => undefined);
  } catch {
    /* best effort */
  }
}

function writeLocalBackup(p: PendingQuickNote): void {
  try {
    localStorage.setItem(LOCAL_BACKUP_PREFIX + p.note.id, JSON.stringify(p));
  } catch {
    /* storage full / unavailable: the other layers still apply */
  }
}

function removeLocalBackup(id: string): void {
  try {
    localStorage.removeItem(LOCAL_BACKUP_PREFIX + id);
  } catch {
    /* ignore */
  }
}

/** Merge leftover localStorage backups (from a popup that closed instantly) into ts.notes. Returns how many applied. */
export async function mergeLocalBackups(): Promise<number> {
  if (typeof localStorage === 'undefined') return 0;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(LOCAL_BACKUP_PREFIX)) keys.push(k);
  }
  let applied = 0;
  for (const k of keys) {
    try {
      const rec = JSON.parse(localStorage.getItem(k) ?? 'null') as PendingQuickNote | null;
      if (rec?.note?.id === k.slice(LOCAL_BACKUP_PREFIX.length)) {
        await update('ts.notes', (list) => {
          const r = applyPending(list, rec);
          if (r.applied) applied++;
          return r.list;
        });
      }
    } catch {
      /* corrupt: dropped */
    } finally {
      localStorage.removeItem(k);
    }
  }
  return applied;
}

export type SaveState = 'empty' | 'pending' | 'saving' | 'saved' | 'error';

/** Framework-free autosave controller (unit-testable with fake timers + the memory store). */
export class QuickNoteDraft {
  readonly id = newId();
  private text = '';
  private link: PageLink | null = null;
  private created = false;
  private createdAt = 0;
  /** updatedAt of our last confirmed write. */
  private base = 0;
  /** Composed fields of the last confirmed write. */
  private savedKey = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  state: SaveState = 'empty';

  constructor(private readonly onState: (s: SaveState) => void = () => undefined) {}

  get noteId(): string | null {
    return this.created ? this.id : null;
  }

  private set(s: SaveState) {
    this.state = s;
    this.onState(s);
  }

  private fields() {
    return composeNote(this.text, this.link);
  }

  private dirty(): boolean {
    return this.text.trim() !== '' && JSON.stringify(this.fields()) !== this.savedKey;
  }

  private snapshot(now = Date.now()): PendingQuickNote {
    const f = this.fields();
    return { note: { id: this.id, createdAt: this.createdAt || now, updatedAt: now, title: f.title, content: f.content, tags: [], favorite: false }, baseUpdatedAt: this.base };
  }

  setText(text: string): void {
    this.text = text;
    if (!text.trim() && !this.created) return this.set('empty');
    if (this.dirty()) writeLocalBackup(this.snapshot());
    if (!this.created) {
      // First keystroke: create immediately (no debounce) so the note exists ASAP.
      void this.save();
      return;
    }
    this.schedule();
  }

  setLink(link: PageLink | null): void {
    this.link = link;
    if (this.created) this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    this.set('pending');
    this.timer = setTimeout(() => void this.save(), QUICK_NOTE_DEBOUNCE_MS);
  }

  /** Write now (serialised). Resolves when this write has been stored. */
  save(): Promise<void> {
    clearTimeout(this.timer);
    const run = this.chain.then(async () => {
      if (!this.dirty() && this.created) return this.set('saved');
      if (!this.text.trim() && !this.created) return;
      const fields = this.fields();
      const key = JSON.stringify(fields);
      this.set('saving');
      const now = Math.max(Date.now(), this.base + 1);
      if (!this.created) {
        this.createdAt = now;
        await update('ts.notes', (list) =>
          list.some((n) => n.id === this.id)
            ? list
            : [...list, { id: this.id, createdAt: now, updatedAt: now, title: fields.title, content: fields.content, tags: [], favorite: false }],
        );
        this.created = true;
      } else {
        await update('ts.notes', (list) => list.map((n) => (n.id === this.id ? { ...n, ...fields, updatedAt: now } : n)));
      }
      this.base = now;
      this.savedKey = key;
      if (this.dirty()) {
        writeLocalBackup(this.snapshot());
        this.set('pending');
      } else {
        removeLocalBackup(this.id);
        this.set('saved');
      }
    });
    this.chain = run.catch(() => this.set('error'));
    return run;
  }

  /**
   * Called on pagehide / visibilitychange(hidden): synchronously hand any
   * unsaved text to storage so the service worker can finish the job.
   */
  flushSync(now = Date.now()): 'none' | 'recovery' | 'pending' {
    if (!this.dirty()) return 'none';
    const fields = this.fields();
    if (this.created && this.base > 0) {
      writeLocalBackup(this.snapshot(now));
      writeRecoverySync({ id: this.id, fields, baseUpdatedAt: this.base, savedAt: now });
      return 'recovery';
    }
    const p = this.snapshot(now);
    writeLocalBackup(p);
    writePendingSync(p);
    return 'pending';
  }

  dispose() {
    clearTimeout(this.timer);
  }
}

/** Pure merge used by the worker: create the note if missing, or apply text if nobody saved it since. */
export function applyPending(list: Note[], p: PendingQuickNote, now = Date.now()): { list: Note[]; applied: boolean } {
  const n = p.note;
  if (!n || typeof n.id !== 'string' || typeof n.title !== 'string' || typeof n.content !== 'string') return { list, applied: false };
  const existing = list.find((x) => x.id === n.id);
  if (!existing) {
    const created: Note = { id: n.id, createdAt: n.createdAt || now, updatedAt: Math.max(now, n.updatedAt || 0), title: n.title, content: n.content, tags: [], favorite: false };
    return { list: [...list, created], applied: true };
  }
  // base 0 = written while our creating write was in flight: still ours if untouched since that create.
  const base = p.baseUpdatedAt || (existing.createdAt === n.createdAt ? n.createdAt : 0);
  if (existing.updatedAt > base) return { list, applied: false };
  return { list: list.map((x) => (x.id === n.id ? { ...x, title: n.title, content: n.content, updatedAt: Math.max(now, x.updatedAt + 1) } : x)), applied: true };
}
