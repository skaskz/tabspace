import { describe, expect, it } from 'vitest';
import { get, insert, set } from '@/storage/store';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '@/features/workspaces/actions';
import { latestSession, previewUrls, searchWorkspaces, unassign, workspaceCounts } from '@/features/workspaces/model';
import type { SavedSession } from '@/types/models';

const session = (id: string, workspaceId: string | undefined, updatedAt: number, urls: string[], archived = false): SavedSession => ({
  id,
  name: id,
  workspaceId,
  archived,
  createdAt: updatedAt,
  updatedAt,
  groups: [],
  tabs: urls.map((url, i) => ({ id: `${id}-${i}`, url, title: url, pinned: false })),
});

describe('workspace model', () => {
  it('latestSession ignores archived and other workspaces', () => {
    const list = [session('a', 'w', 1, ['https://a.com']), session('b', 'w', 9, ['https://b.com'], true), session('c', 'x', 20, []), session('d', 'w', 5, [])];
    expect(latestSession(list, 'w')?.id).toBe('d');
    expect(latestSession(list, 'none')).toBeUndefined();
  });

  it('counts tabs from the latest session, open tasks, untrashed notes, bookmarks', () => {
    const counts = workspaceCounts('w', {
      sessions: [session('a', 'w', 1, ['https://a.com', 'https://b.com', 'https://c.com'])],
      tasks: [
        { id: '1', title: 'Push Tabspace to GitHub', done: false, priority: 'none', subtasks: [], order: 0, workspaceId: 'w', createdAt: 0, updatedAt: 0 },
        { id: '2', title: 'Go for a run', done: true, priority: 'none', subtasks: [], order: 1, workspaceId: 'w', createdAt: 0, updatedAt: 0 },
      ],
      notes: [
        { id: 'n1', title: 'n', content: '', tags: [], favorite: false, workspaceId: 'w', createdAt: 0, updatedAt: 0 },
        { id: 'n2', title: 'n', content: '', tags: [], favorite: false, workspaceId: 'w', trashedAt: 5, createdAt: 0, updatedAt: 0 },
      ],
      bookmarks: [{ id: 'b', url: 'https://a.com', title: 'a', tags: [], favorite: false, workspaceId: 'w', createdAt: 0, updatedAt: 0 }],
    });
    expect(counts).toEqual({ tabs: 3, tasks: 1, notes: 1, bookmarks: 1 });
  });

  it('previewUrls dedupes by host and caps', () => {
    const s = [session('a', 'w', 1, ['https://a.com/1', 'https://a.com/2', 'https://b.com', 'https://c.com', 'https://d.com', 'https://e.com', 'https://f.com'])];
    expect(previewUrls(s, 'w', 5)).toEqual(['https://a.com/1', 'https://b.com', 'https://c.com', 'https://d.com', 'https://e.com']);
  });

  it('searchWorkspaces matches name/description and orders by order', () => {
    const ws = [
      { id: '2', name: 'Research', icon: 'search', order: 1, createdAt: 0, updatedAt: 0, description: 'Roblox mechanics' },
      { id: '1', name: 'Development', icon: 'code', order: 0, createdAt: 0, updatedAt: 0 },
    ];
    expect(searchWorkspaces(ws, '').map((w) => w.id)).toEqual(['1', '2']);
    expect(searchWorkspaces(ws, 'roblox').map((w) => w.id)).toEqual(['2']);
  });

  it('unassign removes the reference and returns the same array when untouched', () => {
    const items = [{ id: 'a', workspaceId: 'w', updatedAt: 1 }, { id: 'b', updatedAt: 1 }];
    const out = unassign(items, 'w', 99);
    expect(out[0]).toEqual({ id: 'a', updatedAt: 99 });
    expect('workspaceId' in out[0]).toBe(false);
    expect(out[1]).toBe(items[1]);
    expect(unassign(items, 'zzz')).toBe(items);
  });
});

describe('workspace actions', () => {
  it('creates with order and a valid icon, rejects empty names', async () => {
    const a = await createWorkspace({ name: '  Development ', icon: 'code' });
    const b = await createWorkspace({ name: 'Personal', icon: 'not-an-icon' });
    expect(a).toMatchObject({ name: 'Development', icon: 'code', order: 0 });
    expect(b).toMatchObject({ icon: 'layoutgrid', order: 1 });
    await expect(createWorkspace({ name: '  ' })).rejects.toThrow(/name/);
    await updateWorkspace(a.id, { name: 'Dev', icon: 'rocket' });
    expect((await get('ts.workspaces'))[0]).toMatchObject({ name: 'Dev', icon: 'rocket' });
  });

  it('delete keeps tasks/notes/bookmarks/sessions/events but unassigns them', async () => {
    const ws = await createWorkspace({ name: 'Job Search', icon: 'briefcase' });
    const other = await createWorkspace({ name: 'Personal' });
    await insert('ts.tasks', { title: 'Review job applications', done: false, priority: 'high', subtasks: [], order: 0, workspaceId: ws.id });
    await insert('ts.tasks', { title: 'Go for a run', done: false, priority: 'none', subtasks: [], order: 1, workspaceId: other.id });
    await insert('ts.notes', { title: 'Cover letter', content: '', tags: [], favorite: false, workspaceId: ws.id });
    await insert('ts.bookmarks', { url: 'https://linkedin.com/jobs', title: 'Jobs', tags: [], favorite: false, workspaceId: ws.id });
    await insert('ts.events', { sourceId: 'local', title: 'Interview', start: '2026-10-22T10:00:00Z', end: '2026-10-22T11:00:00Z', allDay: false, workspaceId: ws.id });
    await set('ts.sessions', [session('s1', ws.id, 1, ['https://linkedin.com/jobs'])]);
    await set('ts.activeWorkspace', ws.id);

    await deleteWorkspace(ws.id);

    expect((await get('ts.workspaces')).map((w) => w.id)).toEqual([other.id]);
    const tasks = await get('ts.tasks');
    expect(tasks).toHaveLength(2);
    expect(tasks[0].workspaceId).toBeUndefined();
    expect(tasks[1].workspaceId).toBe(other.id);
    expect((await get('ts.notes'))[0].workspaceId).toBeUndefined();
    expect((await get('ts.bookmarks'))[0].workspaceId).toBeUndefined();
    expect((await get('ts.events'))[0].workspaceId).toBeUndefined();
    const sessions = await get('ts.sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].workspaceId).toBeUndefined();
    expect(await get('ts.activeWorkspace')).toBeNull();
  });
});
