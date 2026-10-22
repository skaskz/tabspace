import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, set, setAdapter } from '@/storage/store';
import { createMemoryAdapter, type StorageAdapter } from '@/storage/adapter';
import { RECOVERY_PREFIX, recoverUnsavedNotes } from '@/features/notes/recovery';
import { PENDING_PREFIX, QUICK_NOTE_DEBOUNCE_MS, QuickNoteDraft, applyPending, composeNote, markdownLink } from '@/extension/popup/quickNote';
import type { Note } from '@/types/models';

describe('composeNote / markdownLink', () => {
  it('uses the first non-blank line as the title and the rest as the body', () => {
    expect(composeNote('\n  Push Tabspace to GitHub \nTag the release\n\nWrite notes')).toEqual({ title: 'Push Tabspace to GitHub', content: 'Tag the release\n\nWrite notes' });
    expect(composeNote('# Heading as title\nbody')).toEqual({ title: 'Heading as title', content: 'body' });
    expect(composeNote('   ')).toEqual({ title: 'Quick note', content: '' });
  });

  it('appends an escaped markdown link for http(s) pages only', () => {
    expect(composeNote('Idea', { url: 'https://example.com/a b', title: 'Docs [beta]' })).toEqual({ title: 'Idea', content: '[Docs beta](https://example.com/a%20b)' });
    expect(composeNote('Idea\nbody', { url: 'https://x.com/' })).toEqual({ title: 'Idea', content: 'body\n\n[https://x.com/](https://x.com/)' });
    expect(markdownLink({ url: 'javascript:alert(1)', title: 'x' })).toBeNull();
    expect(composeNote('Idea', { url: 'chrome://settings' }).content).toBe('');
  });
});

/** chrome.storage.local backed by the same memory adapter as the store, so sync writes are visible to it. */
function installChrome(adapter: StorageAdapter) {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (k: string | string[] | null) => (k === null ? adapter.getAll() : adapter.get(Array.isArray(k) ? k : [k])),
        set: async (o: Record<string, unknown>) => adapter.set(o),
        remove: async (k: string | string[]) => adapter.remove(Array.isArray(k) ? k : [k]),
      },
    },
  });
}

describe('QuickNoteDraft autosave', () => {
  let adapter: StorageAdapter;
  beforeEach(() => {
    adapter = createMemoryAdapter();
    setAdapter(adapter);
    installChrome(adapter);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('creates the note on the first keystroke, then debounces later edits', async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const d = new QuickNoteDraft((s) => states.push(s));
    d.setText('G');
    await vi.waitFor(async () => expect((await get('ts.notes')).map((n) => n.title)).toEqual(['G']));
    expect(d.noteId).toBe(d.id);
    d.setText('Go for a run\nat 6pm');
    await vi.advanceTimersByTimeAsync(QUICK_NOTE_DEBOUNCE_MS - 50);
    expect((await get('ts.notes'))[0].title).toBe('G');
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(async () => expect((await get('ts.notes'))[0]).toMatchObject({ title: 'Go for a run', content: 'at 6pm', tags: [], favorite: false }));
    expect((await get('ts.notes'))[0].folderId).toBeUndefined(); // Unfiled
    expect(states.at(-1)).toBe('saved');
  });

  it('closing mid-typing (after the note exists) leaves a recovery record that restores the text', async () => {
    vi.useFakeTimers();
    const d = new QuickNoteDraft();
    d.setText('Review job applications');
    await vi.waitFor(async () => expect(await get('ts.notes')).toHaveLength(1));
    await d.save();
    d.setText('Review job applications\nCall back the two shortlisted');
    expect(d.flushSync()).toBe('recovery'); // pagehide before the debounce fired
    d.dispose(); // popup gone: the debounced save never runs
    vi.useRealTimers();
    await vi.waitFor(async () => expect(await adapter.get([RECOVERY_PREFIX + d.id])).toHaveProperty([RECOVERY_PREFIX + d.id]));
    expect(await recoverUnsavedNotes()).toBe(1);
    expect((await get('ts.notes'))[0].content).toBe('Call back the two shortlisted');
  });

  it('closing before the creating write finished leaves a pending record the worker turns into the note', async () => {
    const d = new QuickNoteDraft();
    // Simulate the popup dying right after the first keystroke: write the pending record without awaiting the create.
    d.setText('Edit YouTube Short\nhook in the first 2s');
    expect(d.flushSync()).toBe('pending');
    d.dispose();
    await vi.waitFor(async () => expect(Object.keys(await adapter.getAll()).some((k) => k.startsWith(PENDING_PREFIX))).toBe(true));
    // Worker merge (mocked chrome.storage.local delegates to the same adapter).
    const { mergePendingQuickNotes } = await import('@/extension/background/quickNotes');
    await mergePendingQuickNotes();
    const notes = await get('ts.notes');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: d.id, title: 'Edit YouTube Short', content: 'hook in the first 2s' });
    expect(Object.keys(await adapter.getAll()).some((k) => k.startsWith(PENDING_PREFIX))).toBe(false);
  });

  it('flushSync does nothing when everything is saved', async () => {
    const d = new QuickNoteDraft();
    d.setText('Saved already');
    await d.save();
    expect(d.flushSync()).toBe('none');
  });

  it('re-saves when the page link is attached after creation', async () => {
    vi.useFakeTimers();
    const d = new QuickNoteDraft();
    d.setText('Read later');
    await vi.waitFor(async () => expect(await get('ts.notes')).toHaveLength(1));
    d.setLink({ url: 'https://developer.chrome.com/docs', title: 'Chrome docs' });
    await vi.advanceTimersByTimeAsync(QUICK_NOTE_DEBOUNCE_MS + 10);
    await vi.waitFor(async () => expect((await get('ts.notes'))[0].content).toBe('[Chrome docs](https://developer.chrome.com/docs)'));
  });
});

describe('applyPending (worker merge rule)', () => {
  const note = (o: Partial<Note>): Note => ({ id: 'q', createdAt: 10, updatedAt: 10, title: 'a', content: '', tags: [], favorite: false, ...o });

  it('creates a missing note', () => {
    const r = applyPending([], { note: note({ title: 'New' }), baseUpdatedAt: 0 }, 50);
    expect(r.applied).toBe(true);
    expect(r.list[0]).toMatchObject({ id: 'q', title: 'New' });
  });

  it('applies to a note untouched since our own create (pending written while create was in flight)', () => {
    const r = applyPending([note({ title: 'G' })], { note: note({ title: 'Go for a run', updatedAt: 20 }), baseUpdatedAt: 0 }, 50);
    expect(r.applied).toBe(true);
    expect(r.list[0].title).toBe('Go for a run');
  });

  it('never overwrites a newer save', () => {
    const r = applyPending([note({ updatedAt: 99, title: 'edited in Notes' })], { note: note({ title: 'stale' }), baseUpdatedAt: 10 }, 120);
    expect(r.applied).toBe(false);
    expect(r.list[0].title).toBe('edited in Notes');
  });

  it('ignores malformed records', () => {
    expect(applyPending([], { note: { id: 1 } as unknown as Note, baseUpdatedAt: 0 }).applied).toBe(false);
  });
});

describe('store sanity', () => {
  it('quick notes land in ts.notes alongside existing notes', async () => {
    setAdapter(createMemoryAdapter());
    await set('ts.notes', [{ id: 'x', createdAt: 1, updatedAt: 1, title: 'Existing', content: '', tags: [], favorite: false }]);
    const d = new QuickNoteDraft();
    d.setText('Second');
    await d.save();
    expect((await get('ts.notes')).map((n) => n.title)).toEqual(['Existing', 'Second']);
  });
});

describe('localStorage backup layer', () => {
  beforeEach(() => {
    setAdapter(createMemoryAdapter());
    localStorage.clear();
  });

  it('every keystroke keeps a local backup until a save is confirmed', async () => {
    const { LOCAL_BACKUP_PREFIX } = await import('@/extension/popup/quickNote');
    const d = new QuickNoteDraft();
    d.setText('Finish AI automation script');
    expect(localStorage.getItem(LOCAL_BACKUP_PREFIX + d.id)).toContain('Finish AI automation script');
    await d.save();
    expect(localStorage.getItem(LOCAL_BACKUP_PREFIX + d.id)).toBeNull();
  });

  it('a backup left by an instantly-closed popup is merged by the next surface', async () => {
    const { LOCAL_BACKUP_PREFIX, mergeLocalBackups } = await import('@/extension/popup/quickNote');
    const d = new QuickNoteDraft();
    d.setText('Go for a run'); // create starts...
    d.dispose(); // ...but pretend the page died before any storage write landed
    const backup = localStorage.getItem(LOCAL_BACKUP_PREFIX + d.id)!;
    setAdapter(createMemoryAdapter()); // fresh storage: the create never arrived
    localStorage.setItem(LOCAL_BACKUP_PREFIX + d.id, backup);
    expect(await mergeLocalBackups()).toBe(1);
    expect((await get('ts.notes')).map((n) => n.title)).toEqual(['Go for a run']);
    expect(localStorage.getItem(LOCAL_BACKUP_PREFIX + d.id)).toBeNull();
    expect(await mergeLocalBackups()).toBe(0);
  });
});
