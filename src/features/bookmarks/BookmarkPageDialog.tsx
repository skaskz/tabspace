import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Button, Favicon, Modal, useToast } from '@/components/ui';
import { useStore } from '@/hooks/useStore';
import { insert, patch } from '@/storage/store';
import type { Bookmark, BookmarkFolder } from '@/types/models';
import { cn } from '@/utils/cn';
import { hostname, isSafeUrl } from '@/utils/url';
import { findDuplicate, folderTree, parseTags } from './bookmarks';
import type { PageInfo } from './currentTab';

/**
 * Reusable "bookmark this page" UI (Bookmarks page "Save current tab", the
 * Tabspace Bar's bookmark button). Self-contained: no router, works at ~320 px.
 */

export interface SaveResult {
  bookmark: Bookmark;
  folderName: string;
  updated: boolean;
}

const NEW_FOLDER = '__new__';

export function folderLabel(folders: BookmarkFolder[], id?: string): string {
  return folders.find((f) => f.id === id)?.name ?? 'Unfiled';
}

/** Create or update the bookmark. `existing` = update that bookmark (move/rename) instead of adding a copy. */
export async function saveBookmarkPage(
  input: { url: string; title: string; folderId?: string; tags: string[] },
  existing?: Bookmark,
): Promise<Bookmark> {
  if (!isSafeUrl(input.url)) throw new Error('Only http(s) pages can be bookmarked.');
  const title = input.title.trim() || hostname(input.url) || input.url;
  if (existing) {
    const changes = { title, folderId: input.folderId, tags: input.tags.length ? input.tags : existing.tags };
    await patch('ts.bookmarks', existing.id, changes);
    return { ...existing, ...changes, updatedAt: Date.now() };
  }
  return insert('ts.bookmarks', { url: input.url, title, folderId: input.folderId, tags: input.tags, favorite: false });
}

export interface BookmarkPageFormProps {
  page: PageInfo;
  /** Folder pre-selected (e.g. the folder currently open). */
  defaultFolderId?: string;
  /** Other open pages the user can switch to (e.g. recent tabs). */
  alternatives?: PageInfo[];
  onSaved: (r: SaveResult) => void;
  onCancel?: () => void;
  className?: string;
}

/** The form itself (usable inline in a popover or iframe). */
export function BookmarkPageForm({ page: initialPage, defaultFolderId, alternatives = [], onSaved, onCancel, className }: BookmarkPageFormProps) {
  const [bookmarks] = useStore('ts.bookmarks');
  const [folders] = useStore('ts.bookmarkFolders');
  const [page, setPage] = useState(initialPage);
  const [title, setTitle] = useState(initialPage.title);
  const [folderId, setFolderId] = useState(defaultFolderId ?? '');
  const [newFolder, setNewFolder] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ids = { title: useId(), folder: useId(), newFolder: useId(), tags: useId(), page: useId() };

  const tree = useMemo(() => folderTree(folders), [folders]);
  const dup = useMemo(() => findDuplicate(bookmarks, page.url), [bookmarks, page.url]);
  const safe = isSafeUrl(page.url);

  // A duplicate pre-fills its folder and tags so "Update" is a deliberate move/rename.
  useEffect(() => {
    if (!dup) return;
    setFolderId((f) => (f || dup.folderId) ?? '');
    setTags((t) => t || dup.tags.join(', '));
  }, [dup]);

  const submit = async (mode: 'save' | 'copy', e?: FormEvent) => {
    e?.preventDefault();
    if (!safe) return setError('Only http(s) pages can be bookmarked.');
    if (folderId === NEW_FOLDER && !newFolder.trim()) return setError('Name the new folder.');
    setBusy(true);
    setError(undefined);
    try {
      let target = folderId || undefined;
      let name = folderLabel(folders, target);
      if (folderId === NEW_FOLDER) {
        const f = await insert('ts.bookmarkFolders', { name: newFolder.trim().slice(0, 60), order: folders.reduce((m, x) => Math.max(m, x.order), 0) + 1 });
        target = f.id;
        name = f.name;
      }
      const existing = mode === 'save' ? dup : undefined;
      const bookmark = await saveBookmarkPage({ url: page.url, title, folderId: target, tags: parseTags(tags) }, existing);
      onSaved({ bookmark, folderName: name, updated: !!existing });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the bookmark.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'h-9 w-full rounded-[var(--radius-ctl)] border border-line bg-surface-2 px-3 text-sm text-fg outline-none focus:border-line-strong focus-visible:ring-2 focus-visible:ring-fg/40';

  return (
    <form className={cn('flex min-w-0 flex-col gap-3', className)} onSubmit={(e) => void submit('save', e)} aria-label="Bookmark this page">
      <div className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-ctl)] border border-line bg-surface-2/60 px-3 py-2">
        <Favicon url={page.url} size={16} />
        <span className="min-w-0 flex-1 truncate text-xs text-muted" title={page.url}>
          {page.url}
        </span>
      </div>
      {alternatives.length > 1 && (
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.page} className="text-[12px] font-medium text-muted">
            Page
          </label>
          <select
            id={ids.page}
            className={field}
            value={page.url}
            onChange={(e) => {
              const next = alternatives.find((a) => a.url === e.target.value);
              if (!next) return;
              setPage(next);
              setTitle(next.title);
            }}
          >
            {alternatives.map((a) => (
              <option key={a.url} value={a.url}>
                {a.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.title} className="text-[12px] font-medium text-muted">
          Title
        </label>
        <input id={ids.title} data-autofocus className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.folder} className="text-[12px] font-medium text-muted">
          Folder
        </label>
        <select id={ids.folder} className={field} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
          <option value="">Unfiled</option>
          {tree.map(({ folder, depth }) => (
            <option key={folder.id} value={folder.id}>
              {depth ? '   ' : ''}
              {folder.name}
            </option>
          ))}
          <option value={NEW_FOLDER}>New folder…</option>
        </select>
        {folderId === NEW_FOLDER && (
          <input id={ids.newFolder} aria-label="New folder name" className={field} value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Folder name" maxLength={60} autoFocus />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.tags} className="text-[12px] font-medium text-muted">
          Tags <span className="font-normal text-faint">(optional, comma separated)</span>
        </label>
        <input id={ids.tags} className={field} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tools, reading" />
      </div>
      {dup && (
        <p role="status" className="rounded-[var(--radius-ctl)] border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          Already saved in {folderLabel(folders, dup.folderId)} as “{dup.title || dup.url}”. Update it (and move it to the chosen folder), or add a copy.
        </p>
      )}
      {(error || !safe) && (
        <p role="alert" className="text-xs text-danger">
          {error ?? 'Only http(s) pages can be bookmarked.'}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {dup && (
          <Button size="sm" disabled={busy || !safe} onClick={() => void submit('copy')}>
            Add a copy
          </Button>
        )}
        <Button type="submit" variant="primary" size="sm" disabled={busy || !safe}>
          {dup ? 'Update' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

/** Modal wrapper around BookmarkPageForm. Shows a "Saved to <folder>" toast on success. */
export function BookmarkPageDialog({ open, onClose, onSaved, ...props }: Omit<BookmarkPageFormProps, 'onSaved' | 'page'> & { page: PageInfo | null; open: boolean; onClose: () => void; onSaved?: (r: SaveResult) => void }) {
  const toast = useToast();
  return (
    <Modal open={open && !!props.page} onClose={onClose} title="Save page" width={420}>
      {props.page && (
        <BookmarkPageForm
          key={props.page.url}
          {...props}
          page={props.page}
          onCancel={onClose}
          onSaved={(r) => {
            toast(`${r.updated ? 'Updated in' : 'Saved to'} ${r.folderName}`);
            onSaved?.(r);
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
