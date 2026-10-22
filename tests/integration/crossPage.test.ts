import { describe, expect, it, vi } from 'vitest';
import { createMemoryAdapter, type StorageAdapter } from '@/storage/adapter';

/**
 * Cross-surface integration (Agent 5 QA). Every extension page (dashboard tab,
 * side panel, popup, New Tab) loads its OWN copy of src/storage/store.ts, all
 * talking to the same chrome.storage.local. We simulate that by importing the
 * store (and actions) twice with vi.resetModules() and pointing both copies at
 * one shared adapter.
 */

type Store = typeof import('@/storage/store');
type TaskActions = typeof import('@/features/tasks/actions');
type WsActions = typeof import('@/features/workspaces/actions');

async function loadPage(shared: StorageAdapter): Promise<{ store: Store; tasks: TaskActions; ws: WsActions }> {
  vi.resetModules();
  const store = await import('@/storage/store');
  store.setAdapter(shared);
  const tasks = await import('@/features/tasks/actions');
  const ws = await import('@/features/workspaces/actions');
  return { store, tasks, ws };
}

describe('cross-page store behaviour', () => {
  it('a task completed in the side panel is seen by the dashboard (cache refreshed via change events)', async () => {
    const shared = createMemoryAdapter();
    const dashboard = await loadPage(shared);
    const sidebar = await loadPage(shared);
    const t = await dashboard.tasks.createTask({ title: 'Push Tabspace to GitHub' });
    // warm the dashboard cache
    expect((await dashboard.store.get('ts.tasks')).find((x) => x.id === t.id)?.done).toBe(false);
    const seen = vi.fn();
    dashboard.store.subscribe('ts.tasks', seen);
    await sidebar.tasks.setTaskDone(t.id, true);
    expect(seen).toHaveBeenCalled();
    expect((await dashboard.store.get('ts.tasks')).find((x) => x.id === t.id)?.done).toBe(true);
    expect(dashboard.store.peek('ts.tasks')?.find((x) => x.id === t.id)?.done).toBe(true);
  });

  it('workspace rename on one page is visible on another page', async () => {
    const shared = createMemoryAdapter();
    const a = await loadPage(shared);
    const b = await loadPage(shared);
    const w = await a.ws.createWorkspace({ name: 'Development' });
    expect((await b.store.get('ts.workspaces'))[0].name).toBe('Development');
    await b.ws.updateWorkspace(w.id, { name: 'Dev & Tools' });
    expect((await a.store.get('ts.workspaces'))[0].name).toBe('Dev & Tools');
  });

  it('deleting a workspace on one page keeps tasks created on another page (unassigned)', async () => {
    const shared = createMemoryAdapter();
    const a = await loadPage(shared);
    const b = await loadPage(shared);
    const w = await a.ws.createWorkspace({ name: 'Job Search' });
    await b.tasks.createTask({ title: 'Review job applications', workspaceId: w.id });
    await a.ws.deleteWorkspace(w.id);
    const tasks = await b.store.get('ts.tasks');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].workspaceId).toBeUndefined();
  });

  it('sequential writes from two pages are all kept', async () => {
    const shared = createMemoryAdapter();
    const a = await loadPage(shared);
    const b = await loadPage(shared);
    for (let i = 0; i < 5; i++) {
      await a.tasks.createTask({ title: `A-${i}` });
      await b.tasks.createTask({ title: `B-${i}` });
    }
    expect((await a.store.get('ts.tasks')).map((t) => t.title).sort()).toHaveLength(10);
  });

  // BUG-ST2: update() serialises only inside one page. Two pages doing a read-modify-write
  // at the same time both read the old list and the later set() wins — one insert is lost.
  it('BUG-ST2 · concurrent inserts from two pages are both kept', async () => {
    const shared = createMemoryAdapter();
    const a = await loadPage(shared);
    const b = await loadPage(shared);
    await Promise.all([a.tasks.createTask({ title: 'From dashboard' }), b.tasks.createTask({ title: 'From side panel' })]);
    const titles = (await shared.get(['ts.tasks']))['ts.tasks'] as { title: string }[];
    expect(titles.map((t) => t.title).sort()).toEqual(['From dashboard', 'From side panel']);
  });

  it('BUG-ST2 · worker-style focus record insert racing a page task insert loses nothing', async () => {
    const shared = createMemoryAdapter();
    const page = await loadPage(shared);
    const worker = await loadPage(shared);
    await Promise.all([
      page.tasks.createTask({ title: 'x' }),
      worker.tasks.createTask({ title: 'y' }),
      page.tasks.createTask({ title: 'z' }),
    ]);
    const list = (await shared.get(['ts.tasks']))['ts.tasks'] as unknown[];
    expect(list).toHaveLength(3);
  });
});
