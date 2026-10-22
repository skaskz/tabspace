import { get, insert, newId, patch, remove, update } from '@/storage/store';
import type { Subtask, Task } from '@/types/models';
import { completionChanges, nextOrder } from './buckets';

/** Store-backed task actions shared by the Tasks page, dashboard and search palette. */

export type NewTaskInput = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>> & { title: string };

export async function createTask(input: NewTaskInput): Promise<Task> {
  const tasks = await get('ts.tasks');
  return insert('ts.tasks', {
    notes: undefined,
    done: false,
    priority: 'none',
    subtasks: [],
    ...input,
    title: input.title.trim(),
    order: input.order ?? nextOrder(tasks),
  });
}

export function setTaskDone(id: string, done: boolean): Promise<void> {
  return patch('ts.tasks', id, completionChanges(done));
}

/**
 * Toggle completion from the *stored* value (not a possibly stale prop), so two
 * quick clicks toggle twice. Returns the new done state (undefined if the task is gone).
 */
export async function toggleTaskDone(id: string): Promise<boolean | undefined> {
  let result: boolean | undefined;
  const now = Date.now();
  await update('ts.tasks', (list) =>
    list.map((t) => {
      if (t.id !== id) return t;
      result = !t.done;
      return { ...t, ...completionChanges(!t.done, now), updatedAt: now };
    }),
  );
  return result;
}

export function updateTask(id: string, changes: Partial<Task>): Promise<void> {
  return patch('ts.tasks', id, changes);
}

export function deleteTask(id: string): Promise<void> {
  return remove('ts.tasks', id);
}

/** Setting a date takes a task out of Someday; parking in Someday clears its date. */
export function setDue(id: string, dueDate: string | undefined): Promise<void> {
  return patch('ts.tasks', id, dueDate ? { dueDate, someday: false } : { dueDate: undefined, dueTime: undefined });
}

export function moveToSomeday(id: string): Promise<void> {
  return patch('ts.tasks', id, { someday: true, dueDate: undefined, dueTime: undefined });
}

export function newSubtask(title: string): Subtask {
  return { id: newId(), title: title.trim(), done: false };
}
