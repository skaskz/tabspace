import { insert } from '@/storage/store';
import type { Note } from '@/types/models';

/** Create an empty (or pre-filled) note. */
export function createNote(fields: Partial<Omit<Note, 'id' | 'createdAt' | 'updatedAt'>> = {}): Promise<Note> {
  return insert('ts.notes', { title: '', content: '', tags: [], favorite: false, ...fields });
}
