import { describe, expect, it, vi } from 'vitest';
import { get, insert, mergeSettings, patch, remove, removeMany, set, setAdapter, subscribe, update } from '@/storage/store';
import { createMemoryAdapter } from '@/storage/adapter';
import { DEFAULT_SETTINGS } from '@/storage/schema';

const task = (title: string, order = 0) => ({ title, done: false, priority: 'none' as const, subtasks: [], order });

describe('store', () => {
  it('returns defaults for missing keys', async () => {
    expect(await get('ts.tasks')).toEqual([]);
    expect((await get('ts.settings')).theme).toBe('dark');
  });

  it('inserts records with stable id and timestamps', async () => {
    const t = await insert('ts.tasks', task('Push Tabspace to GitHub'));
    expect(t.id).toMatch(/.+/);
    expect(t.createdAt).toBeGreaterThan(0);
    expect(t.updatedAt).toBe(t.createdAt);
    expect(await get('ts.tasks')).toHaveLength(1);
  });

  it('patches only the targeted record and bumps updatedAt', async () => {
    const a = await insert('ts.tasks', task('A'));
    const b = await insert('ts.tasks', task('B', 1));
    const spy = vi.spyOn(Date, 'now').mockReturnValue(a.updatedAt + 5000);
    await patch('ts.tasks', a.id, { done: true });
    spy.mockRestore();
    const tasks = await get('ts.tasks');
    expect(tasks.find((t) => t.id === a.id)?.done).toBe(true);
    expect(tasks.find((t) => t.id === a.id)!.updatedAt).toBe(a.updatedAt + 5000);
    expect(tasks.find((t) => t.id === b.id)?.done).toBe(false);
  });

  it('patch cannot overwrite the id', async () => {
    const a = await insert('ts.notes', { title: 'n', content: '', tags: [], favorite: false });
    await patch('ts.notes', a.id, { id: 'hijack' } as never);
    expect((await get('ts.notes'))[0].id).toBe(a.id);
  });

  it('removes records', async () => {
    const a = await insert('ts.tasks', task('A'));
    const b = await insert('ts.tasks', task('B', 1));
    const c = await insert('ts.tasks', task('C', 2));
    await remove('ts.tasks', a.id);
    await removeMany('ts.tasks', [b.id]);
    expect((await get('ts.tasks')).map((t) => t.id)).toEqual([c.id]);
  });

  it('serialises concurrent updates without losing writes (rapid clicks)', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => insert('ts.tasks', task(`t${i}`, i))));
    expect(await get('ts.tasks')).toHaveLength(50);
  });

  it('a failed updater does not break the queue', async () => {
    await expect(
      update('ts.tasks', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await insert('ts.tasks', task('after'));
    expect(await get('ts.tasks')).toHaveLength(1);
  });

  it('propagates changes written by another page (shared adapter)', async () => {
    const shared = createMemoryAdapter();
    setAdapter(shared);
    await get('ts.tasks');
    const listener = vi.fn();
    subscribe('ts.tasks', listener);
    await shared.set({ 'ts.tasks': [{ id: 'x', ...task('from sidebar'), done: true, createdAt: 1, updatedAt: 1 }] });
    expect(listener).toHaveBeenCalled();
    expect((await get('ts.tasks'))[0].title).toBe('from sidebar');
  });

  it('update re-reads storage so it does not clobber writes from other pages', async () => {
    const shared = createMemoryAdapter();
    setAdapter(shared);
    await get('ts.tasks');
    await shared.set({ 'ts.tasks': [{ id: 'other', ...task('other page'), createdAt: 1, updatedAt: 1 }] });
    await insert('ts.tasks', task('mine', 1));
    expect((await get('ts.tasks')).map((t) => t.title)).toEqual(['other page', 'mine']);
  });

  it('merges partial stored settings over defaults', async () => {
    await set('ts.settings', mergeSettings({ userName: 'Alex', focus: { focusMin: 50 } } as never));
    const s = await get('ts.settings');
    expect(s.userName).toBe('Alex');
    expect(s.focus.focusMin).toBe(50);
    expect(s.focus.shortMin).toBe(DEFAULT_SETTINGS.focus.shortMin);
    expect(s.sidebar.sections.tasks).toBe(true);
  });

  it('rolls back the cache and notifies when the storage write fails', async () => {
    const failing = createMemoryAdapter();
    setAdapter(failing);
    await insert('ts.tasks', task('kept'));
    const listener = vi.fn();
    subscribe('ts.tasks', listener);
    const orig = failing.set;
    failing.set = async () => {
      throw new Error('QUOTA_BYTES quota exceeded');
    };
    await expect(insert('ts.tasks', task('lost'))).rejects.toThrow('quota');
    failing.set = orig;
    expect((await get('ts.tasks')).map((t) => t.title)).toEqual(['kept']);
    expect(listener).toHaveBeenCalled();
  });

  it('a stuck write to one key does not block writes to another key', async () => {
    const slow = createMemoryAdapter();
    setAdapter(slow);
    const origGet = slow.get;
    let release: () => void = () => undefined;
    slow.get = async (keys) => {
      if (keys.includes('ts.notes')) await new Promise<void>((r) => (release = r));
      return origGet(keys);
    };
    const notes = insert('ts.notes', { title: 'n', content: '', tags: [], favorite: false });
    await insert('ts.tasks', task('not blocked'));
    expect((await get('ts.tasks')).map((t) => t.title)).toEqual(['not blocked']);
    release();
    await notes;
  });
});
