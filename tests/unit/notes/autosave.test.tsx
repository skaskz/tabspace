import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { get, patch, set } from '@/storage/store';
import type { Note } from '@/types/models';
import { adoptExternal, dirtyChanges, patchNoteList } from '@/features/notes/autosave';
import NotesPage from '@/pages/notes/NotesPage';

const note = (p: Partial<Note> = {}): Note => ({ id: 'n1', title: 'Shared', content: 'v1', tags: [], favorite: false, createdAt: 1, updatedAt: 1, ...p });

describe('autosave helpers', () => {
  it('dirtyChanges only includes edited fields', () => {
    expect(dirtyChanges({ title: 'T', content: 'C' }, new Set(['title']))).toEqual({ title: 'T' });
    expect(dirtyChanges({ title: 'T', content: 'C' }, new Set())).toEqual({});
  });
  it('patchNoteList patches one note without a read and returns null for unknown ids', () => {
    const list = [note(), note({ id: 'n2', title: 'Other' })];
    const next = patchNoteList(list, 'n1', { content: 'v2' }, 99)!;
    expect(next[0]).toMatchObject({ content: 'v2', title: 'Shared', updatedAt: 99 });
    expect(next[1]).toBe(list[1]);
    expect(patchNoteList(list, 'nope', { content: 'x' })).toBeNull();
  });
  it('adoptExternal adopts external changes for clean fields only', () => {
    const prev = { title: 'Shared', content: 'v1' };
    expect(adoptExternal({ title: 'Shared', content: 'v1' }, { title: 'Shared', content: 'v2' }, prev, new Set())).toEqual({ title: 'Shared', content: 'v2' });
    // Local unsaved title edit is kept; external content is adopted.
    expect(adoptExternal({ title: 'Mine', content: 'v1' }, { title: 'Theirs', content: 'v2' }, prev, new Set(['title']))).toEqual({ title: 'Mine', content: 'v2' });
    // Stored value unchanged since last snapshot (our own save still in flight): never revert the draft.
    expect(adoptExternal({ title: 'Shared', content: 'typed' }, { title: 'Shared', content: 'v1' }, prev, new Set())).toBeNull();
  });
});

describe('NoteEditor sync (BUG-NT2)', () => {
  it('adopts content saved elsewhere and a title-only edit does not clobber it', async () => {
    await set('ts.notes', [note()]);
    window.location.hash = '#/notes?id=n1';
    render(
      <ToastProvider>
        <ConfirmProvider>
          <NotesPage />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const title = await screen.findByRole('textbox', { name: 'Note title' });
    // Another tab saves new content.
    await act(async () => {
      await patch('ts.notes', 'n1', { content: 'edited in A' });
    });
    expect(await screen.findByRole('region', { name: 'Note editor' })).toHaveTextContent('edited in A');
    // This tab edits only the title.
    fireEvent.change(title, { target: { value: 'Shared (renamed in B)' } });
    fireEvent.blur(title);
    await waitFor(async () => {
      const [n] = await get('ts.notes');
      expect(n.title).toBe('Shared (renamed in B)');
      expect(n.content).toBe('edited in A');
    });
    window.location.hash = '#/notes';
  });

  it('pagehide writes only a per-note recovery record synchronously, then saves (BUG-NT1)', async () => {
    localStorage.clear();
    await set('ts.notes', [note({ content: '' })]);
    window.location.hash = '#/notes?id=n1';
    render(
      <ToastProvider>
        <ConfirmProvider>
          <NotesPage />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const area = await screen.findByRole('textbox', { name: 'Note content' });
    fireEvent.change(area, { target: { value: 'typed right before reload' } });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    // Synchronously, inside the handler: a recovery record with just the edited field.
    const raw = localStorage.getItem('tabspace-recovery:ts.notes.unsaved.n1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({ id: 'n1', fields: { content: 'typed right before reload' } });
    expect(JSON.parse(raw!).fields).not.toHaveProperty('title');
    // The normal locked save also runs and then clears the record.
    await waitFor(async () => expect((await get('ts.notes'))[0].content).toBe('typed right before reload'));
    await waitFor(() => expect(localStorage.getItem('tabspace-recovery:ts.notes.unsaved.n1')).toBeNull());
    window.location.hash = '#/notes';
  });
});
