import { beforeEach, describe, expect, it } from 'vitest';
import { get, set } from '@/storage/store';
import type { Note } from '@/types/models';
import { applyRecovery, listRecovery, recoverUnsavedNotes, writeRecoverySync, type RecoveryRecord } from '@/features/notes/recovery';

const note = (p: Partial<Note> = {}): Note => ({ id: 'n1', title: 'Quick thought', content: 'old', tags: [], favorite: false, createdAt: 1, updatedAt: 100, ...p });
const rec = (p: Partial<RecoveryRecord> = {}): RecoveryRecord => ({ id: 'n1', fields: { content: 'typed before reload' }, baseUpdatedAt: 100, savedAt: 150, ...p });

beforeEach(() => localStorage.clear());

describe('applyRecovery (pure)', () => {
  it('applies when the stored note is not newer than the base', () => {
    const r = applyRecovery([note(), note({ id: 'n2', content: 'other' })], rec(), 200);
    expect(r.applied).toBe(true);
    expect(r.list[0]).toMatchObject({ content: 'typed before reload', title: 'Quick thought', updatedAt: 200 });
    expect(r.list[1].content).toBe('other');
  });
  it('is dropped when the stored note was saved after the base (newer edit wins)', () => {
    const list = [note({ updatedAt: 120, content: 'newer from another tab' })];
    const r = applyRecovery(list, rec());
    expect(r.applied).toBe(false);
    expect(r.list).toBe(list);
  });
  it('never resurrects a deleted note', () => {
    const list = [note({ id: 'n2' })];
    const r = applyRecovery(list, rec());
    expect(r.applied).toBe(false);
    expect(r.list).toEqual(list);
  });
  it('only applies string title/content fields', () => {
    const bad = rec({ fields: { content: 'ok', ...({ trashedAt: 5, title: 7 } as object) } as RecoveryRecord['fields'] });
    const r = applyRecovery([note()], bad, 200);
    expect(r.list[0]).toMatchObject({ content: 'ok', title: 'Quick thought' });
    expect(r.list[0].trashedAt).toBeUndefined();
  });
});

describe('recoverUnsavedNotes (store + recovery records)', () => {
  it('applies a current record and removes it', async () => {
    await set('ts.notes', [note()]);
    writeRecoverySync(rec());
    expect(await listRecovery()).toHaveLength(1);
    expect(await recoverUnsavedNotes()).toBe(1);
    expect((await get('ts.notes'))[0].content).toBe('typed before reload');
    expect(await listRecovery()).toHaveLength(0);
  });
  it('drops a stale record when the note is newer, and removes it', async () => {
    await set('ts.notes', [note({ updatedAt: 500, content: 'newer' })]);
    writeRecoverySync(rec());
    expect(await recoverUnsavedNotes()).toBe(0);
    expect((await get('ts.notes'))[0].content).toBe('newer');
    expect(await listRecovery()).toHaveLength(0);
  });
  it('does not resurrect a deleted note', async () => {
    await set('ts.notes', []);
    writeRecoverySync(rec());
    expect(await recoverUnsavedNotes()).toBe(0);
    expect(await get('ts.notes')).toEqual([]);
    expect(await listRecovery()).toHaveLength(0);
  });
});
