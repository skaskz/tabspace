import { get, insert, patch, remove, set, update } from '@/storage/store';
import type { Workspace } from '@/types/models';
import { nextOrder, unassign } from './model';
import { DEFAULT_WORKSPACE_ICON, isWorkspaceIcon, normalizeIconKey } from './icons';

/** Store-backed workspace actions. */

export async function createWorkspace(input: { name: string; icon?: string; description?: string }): Promise<Workspace> {
  const name = input.name.trim();
  if (!name) throw new Error('Give the workspace a name.');
  const list = await get('ts.workspaces');
  return insert('ts.workspaces', {
    name,
    icon: input.icon && isWorkspaceIcon(input.icon) ? normalizeIconKey(input.icon) : DEFAULT_WORKSPACE_ICON,
    description: input.description?.trim() || undefined,
    order: nextOrder(list),
  });
}

export async function updateWorkspace(id: string, changes: Partial<Pick<Workspace, 'name' | 'icon' | 'description'>>): Promise<void> {
  const next = { ...changes };
  if (next.name !== undefined) {
    next.name = next.name.trim();
    if (!next.name) throw new Error('Workspace name can’t be empty.');
  }
  if (next.icon !== undefined) {
    if (isWorkspaceIcon(next.icon)) next.icon = normalizeIconKey(next.icon);
    else delete next.icon;
  }
  await patch('ts.workspaces', id, next);
}

/**
 * Delete a workspace. Its tasks, notes, bookmarks, events and saved sessions
 * are kept but unassigned (workspaceId removed).
 */
export async function deleteWorkspace(id: string): Promise<void> {
  const now = Date.now();
  await update('ts.tasks', (l) => unassign(l, id, now));
  await update('ts.notes', (l) => unassign(l, id, now));
  await update('ts.bookmarks', (l) => unassign(l, id, now));
  await update('ts.events', (l) => unassign(l, id, now));
  await update('ts.sessions', (l) => unassign(l, id, now));
  if ((await get('ts.activeWorkspace')) === id) await set('ts.activeWorkspace', null);
  await remove('ts.workspaces', id);
}
