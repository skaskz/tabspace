import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { get, set } from '@/storage/store';
import type { Bookmark, BookmarkFolder } from '@/types/models';
import { rankWebTabs, toPageInfo, type TabLike } from '@/features/bookmarks/currentTab';
import { BookmarkPageForm, saveBookmarkPage, type BookmarkPageFormProps } from '@/features/bookmarks/BookmarkPageDialog';

const folder = (id: string, name: string, parentId?: string): BookmarkFolder => ({ id, name, parentId, order: 1, createdAt: 1, updatedAt: 1 });

describe('rankWebTabs (Save current tab)', () => {
  const tab = (p: Partial<TabLike> & { id: number }): TabLike => ({ windowId: 1, url: `https://site${p.id}.com/`, ...p });
  it('skips the Tabspace tab itself and non-web pages; prefers the most recently used web tab', () => {
    const tabs = [
      tab({ id: 1, url: 'chrome-extension://abc/dashboard.html', active: true, lastAccessed: 999 }),
      tab({ id: 2, lastAccessed: 100 }),
      tab({ id: 3, windowId: 2, lastAccessed: 500, active: true }),
      tab({ id: 4, url: 'chrome://settings', lastAccessed: 800 }),
    ];
    expect(rankWebTabs(tabs, { tabId: 1, windowId: 1 }).map((t) => t.id)).toEqual([3, 2]);
  });
  it('without lastAccessed, prefers the active web tab in the Tabspace window, then other active tabs', () => {
    const tabs = [tab({ id: 2 }), tab({ id: 3, windowId: 2, active: true }), tab({ id: 5, active: true })];
    expect(rankWebTabs(tabs, { tabId: 1, windowId: 1 }).map((t) => t.id)).toEqual([5, 3, 2]);
  });
  it('toPageInfo falls back to the URL as title and drops unsafe favicons', () => {
    expect(toPageInfo({ windowId: 1, url: 'https://a.com/', favIconUrl: 'javascript:x' })).toEqual({ url: 'https://a.com/', title: 'https://a.com/', favIconUrl: undefined });
  });
});

describe('saveBookmarkPage', () => {
  it('refuses non-http(s) URLs', async () => {
    await expect(saveBookmarkPage({ url: 'javascript:alert(1)', title: 'x', tags: [] })).rejects.toThrow();
    expect(await get('ts.bookmarks')).toEqual([]);
  });
  it('updates (moves/renames) an existing bookmark instead of duplicating', async () => {
    const existing: Bookmark = { id: 'b1', url: 'https://a.com/', title: 'Old', tags: ['x'], favorite: true, createdAt: 1, updatedAt: 1 };
    await set('ts.bookmarks', [existing]);
    await saveBookmarkPage({ url: 'https://a.com/', title: 'New', folderId: 'f1', tags: [] }, existing);
    expect(await get('ts.bookmarks')).toEqual([expect.objectContaining({ id: 'b1', title: 'New', folderId: 'f1', tags: ['x'], favorite: true })]);
  });
});

describe('BookmarkPageForm', () => {
  const renderForm = (props: Partial<BookmarkPageFormProps> = {}) => {
    const onSaved = vi.fn();
    render(
      <ToastProvider>
        <ConfirmProvider>
          <div style={{ width: 320 }}>
            <BookmarkPageForm page={{ url: 'https://vite.dev/', title: 'Vite' }} onSaved={onSaved} {...props} />
          </div>
        </ConfirmProvider>
      </ToastProvider>,
    );
    return onSaved;
  };

  it('saves into the chosen (nested) folder with title and tags', async () => {
    await set('ts.bookmarkFolders', [folder('f1', 'Dev'), folder('f2', 'Docs', 'f1')]);
    const onSaved = renderForm({ defaultFolderId: 'f1' });
    const form = screen.getByRole('form', { name: 'Bookmark this page' });
    await waitFor(() => expect(within(form).getByRole('option', { name: /Docs/ })).toBeInTheDocument());
    await userEvent.selectOptions(within(form).getByLabelText('Folder'), 'f2');
    await userEvent.clear(within(form).getByLabelText('Title'));
    await userEvent.type(within(form).getByLabelText('Title'), 'Vite docs');
    await userEvent.type(within(form).getByLabelText(/Tags/), 'tools, build');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ folderName: 'Docs', updated: false })));
    expect(await get('ts.bookmarks')).toEqual([expect.objectContaining({ url: 'https://vite.dev/', title: 'Vite docs', folderId: 'f2', tags: ['tools', 'build'] })]);
  });

  it('creates a new folder inline', async () => {
    const onSaved = renderForm();
    const form = screen.getByRole('form', { name: 'Bookmark this page' });
    await userEvent.selectOptions(within(form).getByLabelText('Folder'), '__new__');
    await userEvent.type(within(form).getByLabelText('New folder name'), 'Build tools');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ folderName: 'Build tools' })));
    const [f] = await get('ts.bookmarkFolders');
    expect((await get('ts.bookmarks'))[0].folderId).toBe(f.id);
  });

  it('detects a duplicate and offers Update or Add a copy', async () => {
    await set('ts.bookmarkFolders', [folder('f1', 'Dev')]);
    await set('ts.bookmarks', [{ id: 'b1', url: 'https://www.vite.dev', title: 'Old', tags: [], favorite: false, folderId: 'f1', createdAt: 1, updatedAt: 1 }]);
    const onSaved = renderForm();
    expect(await screen.findByText(/Already saved in Dev/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a copy' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ updated: true, folderName: 'Dev' })));
    expect(await get('ts.bookmarks')).toHaveLength(1);
  });

  it('refuses non-web pages', () => {
    renderForm({ page: { url: 'chrome://settings', title: 'Settings' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Only http(s)');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
