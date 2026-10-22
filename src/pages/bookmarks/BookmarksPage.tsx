import { memo, useDeferredValue, useMemo, useRef, useState } from 'react';
import { Bookmark as BookmarkIcon, Download, ExternalLink, Folder, FolderInput, FolderPlus, Inbox, Library, MoreHorizontal, Pencil, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { PageHero } from '@/components/layout/PageHero';
import { Button, EmptyState, Favicon, Field, IconButton, Input, Menu, Modal, Segmented, Select, Tag, Textarea, useConfirm, useToast } from '@/components/ui';
import { navigate, useRoute } from '@/app/router';
import { useStore } from '@/hooks/useStore';
import { insert, newId, patch, remove, update } from '@/storage/store';
import type { Bookmark, BookmarkFolder } from '@/types/models';
import { cn } from '@/utils/cn';
import { hostname } from '@/utils/url';
import {
  filterBookmarks,
  folderCounts,
  folderTree,
  parseTags,
  planChromeImport,
  sortBookmarks,
  type BookmarkChip,
  type BookmarkSort,
  type ChromeBookmarkNode,
} from '@/features/bookmarks/bookmarks';
import { hasTabsApi, openLink } from '@/features/search/chromeTabs';
import { findCurrentWebPages, type PageInfo } from '@/features/bookmarks/currentTab';
import { BookmarkPageDialog } from '@/features/bookmarks/BookmarkPageDialog';
import { LoadMore, useIncremental } from '@/features/search/useIncremental';
import { LinkModal, type LinkDraft } from './LinkModal';

const UNFILED = 'unfiled';

type FolderDialog = null | { mode: 'create'; parentId?: string } | { mode: 'rename'; folder: BookmarkFolder };

export default function BookmarksPage() {
  const [bookmarks] = useStore('ts.bookmarks');
  const [folders] = useStore('ts.bookmarkFolders');
  const { params } = useRoute();
  const toast = useToast();
  const confirm = useConfirm();
  const [chip, setChip] = useState<BookmarkChip>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<BookmarkSort>('recent');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkModal, setLinkModal] = useState<null | { editing?: Bookmark; initial?: Partial<LinkDraft> }>(null);
  const [pageDialog, setPageDialog] = useState<null | { page: PageInfo; alternatives: PageInfo[] }>(null);
  const [moveTarget, setMoveTarget] = useState<Bookmark | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialog>(null);
  const [folderName, setFolderName] = useState('');
  const [importing, setImporting] = useState(false);

  const folderParam = params.get('folder') ?? undefined;
  const activeFolder = folderParam && folderParam !== UNFILED ? folders.find((f) => f.id === folderParam) : undefined;
  const scope: string | null | undefined = folderParam === UNFILED ? null : activeFolder?.id;
  const tree = useMemo(() => folderTree(folders), [folders]);
  const counts = useMemo(() => folderCounts(folders, bookmarks), [folders, bookmarks]);
  const unfiledCount = bookmarks.filter((b) => !b.folderId).length;
  const scoped = useMemo(() => filterBookmarks(bookmarks, folders, { folderId: scope }), [bookmarks, folders, scope]);
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(() => sortBookmarks(filterBookmarks(scoped, folders, { chip, search: deferredQuery }), sort), [scoped, folders, chip, deferredQuery, sort]);
  const shown = useIncremental(visible, `${folderParam ?? ''}|${chip}|${deferredQuery}|${sort}`);
  const selected = selectedId ? bookmarks.find((b) => b.id === selectedId) : undefined;
  const folderName_ = (id?: string) => folders.find((f) => f.id === id)?.name ?? 'Unfiled';

  const selectFolder = (id?: string) => {
    setSelectedId(null);
    navigate('bookmarks', { folder: id });
  };

  const fail = (msg: string) => () => toast(msg, 'error');

  const open = async (b: Bookmark) => {
    if (!(await openLink(b.url))) return toast('Only http(s) links can be opened.', 'error');
    void patch('ts.bookmarks', b.id, { lastOpenedAt: Date.now() }).catch(() => undefined);
  };

  const saveLink = async (draft: LinkDraft, editing?: Bookmark) => {
    const title = draft.title || hostname(draft.url) || draft.url;
    try {
      if (editing) await patch('ts.bookmarks', editing.id, { url: draft.url, title, folderId: draft.folderId, tags: draft.tags });
      else {
        const b = await insert('ts.bookmarks', { url: draft.url, title, folderId: draft.folderId, tags: draft.tags, favorite: false });
        setSelectedId(b.id);
        toast('Link saved.');
      }
    } catch {
      toast('Could not save the link.', 'error');
    }
  };

  const deleteBookmark = async (b: Bookmark) => {
    if (!(await confirm({ title: 'Delete link?', message: `“${b.title || b.url}” will be removed from Tabspace.`, confirmLabel: 'Delete', danger: true }))) return;
    if (selectedId === b.id) setSelectedId(null);
    await remove('ts.bookmarks', b.id).catch(fail('Could not delete the link.'));
  };

  // Stable callbacks for memoised rows: the ref always points at the latest handlers.
  const handlers = useRef<RowHandlers>(null!);
  handlers.current = {
    select: (b) => setSelectedId(b.id),
    open: (b) => void open(b),
    toggleFavorite: (b) => void patch('ts.bookmarks', b.id, { favorite: !b.favorite }).catch(fail('Could not update.')),
    edit: (b) => setLinkModal({ editing: b }),
    move: (b) => setMoveTarget(b),
    remove: (b) => void deleteBookmark(b),
  };
  const rowApi = useMemo<RowHandlers>(
    () => ({
      select: (b) => handlers.current.select(b),
      open: (b) => handlers.current.open(b),
      toggleFavorite: (b) => handlers.current.toggleFavorite(b),
      edit: (b) => handlers.current.edit(b),
      move: (b) => handlers.current.move(b),
      remove: (b) => handlers.current.remove(b),
    }),
    [],
  );

  /**
   * Save current tab: the most recently used web page (the dashboard itself is
   * usually the active tab, possibly in its own window). Opens the shared
   * bookmark dialog pre-set to the open folder; the user can switch page.
   */
  const saveCurrentTab = async () => {
    if (!hasTabsApi()) return toast('Saving the current tab works when Tabspace runs as a Chrome extension.', 'error');
    try {
      const pages = await findCurrentWebPages();
      if (!pages.length) return toast('No open web page to save (only http/https pages can be bookmarked).', 'error');
      setPageDialog({ page: pages[0], alternatives: pages });
    } catch {
      toast('Could not read your open tabs.', 'error');
    }
  };

  /** After saving: make sure the new bookmark is visible (folder, filters) then select and scroll to it. */
  const revealSaved = (b: Bookmark) => {
    setChip('all');
    setQuery('');
    const inScope = folderParam === undefined || (folderParam === UNFILED ? !b.folderId : !!b.folderId && (b.folderId === folderParam || folders.find((f) => f.id === b.folderId)?.parentId === folderParam));
    if (!inScope) navigate('bookmarks', { folder: b.folderId ?? UNFILED });
    setSelectedId(b.id);
    window.setTimeout(() => document.querySelector(`[data-bookmark-id="${CSS.escape(b.id)}"]`)?.scrollIntoView({ block: 'nearest' }), 80);
  };

  const importChrome = async () => {
    if (typeof chrome === 'undefined' || !chrome.permissions?.request) return toast('Importing Chrome bookmarks works when Tabspace runs as a Chrome extension.', 'error');
    try {
      // Must be called directly from the click (user gesture).
      const granted = await chrome.permissions.request({ permissions: ['bookmarks'] });
      if (!granted) return toast('Bookmark access was not granted, nothing was imported.');
      if (!chrome.bookmarks?.getTree) return toast('Bookmarks API unavailable. Reload the extension and try again.', 'error');
      setImporting(true);
      const tree = (await chrome.bookmarks.getTree()) as ChromeBookmarkNode[];
      let summary = { folders: 0, links: 0, dups: 0, unsafe: 0 };
      // Plan inside the serialised update so concurrent edits are not clobbered.
      let plannedBookmarks: Bookmark[] = [];
      await update('ts.bookmarkFolders', (currentFolders) => {
        const plan = planChromeImport(tree, currentFolders, bookmarks, newId);
        plannedBookmarks = plan.bookmarks;
        summary = { folders: plan.folders.length, links: plan.bookmarks.length, dups: plan.skippedDuplicates, unsafe: plan.skippedUnsafe };
        return [...currentFolders, ...plan.folders];
      });
      if (plannedBookmarks.length) await update('ts.bookmarks', (list) => [...list, ...plannedBookmarks]);
      const skipped = summary.dups + summary.unsafe;
      toast(`Imported ${summary.links} link${summary.links === 1 ? '' : 's'} in ${summary.folders} new folder${summary.folders === 1 ? '' : 's'}${skipped ? ` · skipped ${skipped} (duplicates or non-web)` : ''}.`);
    } catch {
      toast('Import failed. Your existing bookmarks were not changed.', 'error');
    } finally {
      setImporting(false);
      // One-time use: drop the optional permission again (best effort) so it is not retained.
      try {
        await chrome.permissions.remove({ permissions: ['bookmarks'] });
      } catch {
        /* ignore */
      }
    }
  };

  const submitFolder = async () => {
    const name = folderName.trim();
    if (!name || !folderDialog) return;
    try {
      if (folderDialog.mode === 'create') {
        const f = await insert('ts.bookmarkFolders', { name, parentId: folderDialog.parentId, order: folders.reduce((m, x) => Math.max(m, x.order), 0) + 1 });
        selectFolder(f.id);
      } else await patch('ts.bookmarkFolders', folderDialog.folder.id, { name });
      setFolderDialog(null);
    } catch {
      toast('Could not save the folder.', 'error');
    }
  };

  const deleteFolder = async (f: BookmarkFolder) => {
    const ids = new Set([f.id, ...folders.filter((c) => c.parentId === f.id).map((c) => c.id)]);
    const n = bookmarks.filter((b) => b.folderId && ids.has(b.folderId)).length;
    const subs = ids.size - 1;
    const ok = await confirm({
      title: `Delete folder “${f.name}”?`,
      message: `${subs ? `Its ${subs} sub-folder${subs === 1 ? '' : 's'} will be deleted too. ` : ''}${n ? `${n} link${n === 1 ? '' : 's'} will be kept and moved to Unfiled.` : 'No links are inside.'}`,
      confirmLabel: 'Delete folder',
      danger: true,
    });
    if (!ok) return;
    try {
      await update('ts.bookmarks', (list) => list.map((b) => (b.folderId && ids.has(b.folderId) ? { ...b, folderId: undefined, updatedAt: Date.now() } : b)));
      await update('ts.bookmarkFolders', (list) => list.filter((x) => !ids.has(x.id)));
      if (folderParam && ids.has(folderParam)) selectFolder(undefined);
    } catch {
      toast('Could not delete the folder.', 'error');
    }
  };

  const folderBtn = (id: string | undefined, label: string, icon: React.ReactNode, count: number, depth = 0, extra?: React.ReactNode) => {
    const active = (folderParam ?? undefined) === id || (!folderParam && id === undefined);
    return (
      <li key={id ?? 'all'} className="group flex items-center" style={{ paddingLeft: depth * 16 }}>
        <button
          type="button"
          onClick={() => selectFolder(id)}
          aria-current={active ? 'true' : undefined}
          className={cn(
            'flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-ctl)] border px-3 text-left text-[13.5px] transition-colors',
            active ? 'ts-active text-fg' : 'border-transparent text-muted hover:bg-glow hover:text-fg',
          )}
        >
          <span className="shrink-0">{icon}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="text-xs tabular-nums text-faint">{count}</span>
        </button>
        {extra}
      </li>
    );
  };

  const headerTitle = folderParam === UNFILED ? 'Unfiled' : (activeFolder?.name ?? 'All Bookmarks');

  return (
    <div>
      <PageHero
        title="Bookmarks"
        subtitle="Links worth keeping, organised."
        actions={
          <>
            <Button icon={<Download size={16} />} onClick={() => void importChrome()} disabled={importing}>
              {importing ? 'Importing…' : 'Import from Chrome'}
            </Button>
            <Button icon={<BookmarkIcon size={16} />} onClick={() => void saveCurrentTab()}>
              Save current tab
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setLinkModal({ initial: { folderId: activeFolder?.id, tags: [], url: '', title: '' } })}>
              Add Link
            </Button>
          </>
        }
      />

      <div className={cn('grid gap-5', selected ? 'xl:grid-cols-[230px_minmax(0,1fr)_320px] lg:grid-cols-[230px_minmax(0,1fr)]' : 'lg:grid-cols-[230px_minmax(0,1fr)]')}>
        <nav aria-label="Bookmark folders" className="flex flex-col gap-1">
          <ul className="flex flex-col gap-0.5">
            {folderBtn(undefined, 'All Bookmarks', <Library size={16} />, bookmarks.length)}
            {unfiledCount > 0 && folderBtn(UNFILED, 'Unfiled', <Inbox size={16} />, unfiledCount)}
          </ul>
          <div className="mt-4 mb-1 flex items-center justify-between px-3">
            <h2 className="text-xs font-medium tracking-wide text-faint uppercase">Folders</h2>
            <IconButton
              label="New folder"
              size="sm"
              onClick={() => {
                setFolderName('');
                setFolderDialog({ mode: 'create' });
              }}
            >
              <FolderPlus size={15} />
            </IconButton>
          </div>
          {tree.length === 0 ? (
            <p className="px-3 text-xs text-faint">No folders yet.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {tree.map(({ folder: f, depth }) =>
                folderBtn(
                  f.id,
                  f.name,
                  <Folder size={16} />,
                  counts.get(f.id) ?? 0,
                  depth,
                  <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <Menu
                      label={`Folder actions for ${f.name}`}
                      trigger={<MoreHorizontal size={15} />}
                      items={[
                        {
                          label: 'Rename',
                          icon: <Pencil size={14} />,
                          onSelect: () => {
                            setFolderName(f.name);
                            setFolderDialog({ mode: 'rename', folder: f });
                          },
                        },
                        {
                          label: 'New sub-folder',
                          icon: <FolderPlus size={14} />,
                          disabled: depth > 0,
                          onSelect: () => {
                            setFolderName('');
                            setFolderDialog({ mode: 'create', parentId: f.id });
                          },
                        },
                        { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteFolder(f) },
                      ]}
                    />
                  </span>,
                ),
              )}
            </ul>
          )}
        </nav>

        <section className="min-w-0" aria-label={headerTitle}>
          <div className="ts-card p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold">{headerTitle}</h2>
                <span className="text-sm text-muted">{scoped.length} {scoped.length === 1 ? 'link' : 'links'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input icon={<Search size={15} />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search links" aria-label="Search bookmarks" className="w-56 max-sm:w-full" />
                <Select aria-label="Sort bookmarks" value={sort} onChange={(e) => setSort(e.target.value as BookmarkSort)}>
                  <option value="recent">Recent</option>
                  <option value="title">Title</option>
                  <option value="domain">Domain</option>
                </Select>
              </div>
            </div>
            <Segmented
              label="Bookmark filter"
              className="mb-3"
              value={chip}
              onChange={setChip}
              options={[
                { value: 'all', label: 'All' },
                { value: 'favorites', label: 'Favorites' },
                { value: 'recent', label: 'Recent' },
              ]}
            />

            {visible.length === 0 ? (
              <EmptyState
                icon={<BookmarkIcon size={28} />}
                title={query || chip !== 'all' ? 'No matching links' : bookmarks.length ? 'This folder is empty' : 'No bookmarks yet'}
                description={
                  query || chip !== 'all'
                    ? 'Try another search or filter.'
                    : bookmarks.length
                      ? 'Add a link or move one here.'
                      : 'Add a link, save the current tab, or import your Chrome bookmarks.'
                }
              />
            ) : (
              <>
              <ul className="flex flex-col">
                {shown.visible.map((b) => (
                  <BookmarkRow key={b.id} bookmark={b} selected={selectedId === b.id} api={rowApi} />
                ))}
              </ul>
              <LoadMore hasMore={shown.hasMore} remaining={shown.remaining} onMore={shown.more} label="links" />
            </>
            )}
          </div>
        </section>

        {selected && (
          <BookmarkDetails
            key={selected.id}
            bookmark={selected}
            folderLabel={folderName_(selected.folderId)}
            onClose={() => setSelectedId(null)}
            onOpen={() => void open(selected)}
            onMove={() => setMoveTarget(selected)}
            onEdit={() => setLinkModal({ editing: selected })}
            onDelete={() => void deleteBookmark(selected)}
          />
        )}
      </div>

      <BookmarkPageDialog
        open={!!pageDialog}
        page={pageDialog?.page ?? null}
        alternatives={pageDialog?.alternatives}
        defaultFolderId={activeFolder?.id}
        onClose={() => setPageDialog(null)}
        onSaved={(r) => revealSaved(r.bookmark)}
      />

      <LinkModal
        open={!!linkModal}
        onClose={() => setLinkModal(null)}
        editing={linkModal?.editing}
        initial={linkModal?.initial}
        folders={folders}
        bookmarks={bookmarks}
        onSubmit={(d) => saveLink(d, linkModal?.editing)}
      />

      <Modal open={!!moveTarget} onClose={() => setMoveTarget(null)} title="Move to folder" width={380}>
        {moveTarget && (
          <Select
            aria-label="Folder"
            className="w-full"
            value={moveTarget.folderId ?? ''}
            onChange={(e) => {
              void patch('ts.bookmarks', moveTarget.id, { folderId: e.target.value || undefined }).catch(fail('Could not move the link.'));
              setMoveTarget(null);
            }}
          >
            <option value="">Unfiled</option>
            {tree.map(({ folder, depth }) => (
              <option key={folder.id} value={folder.id}>
                {depth ? '   ' : ''}
                {folder.name}
              </option>
            ))}
          </Select>
        )}
      </Modal>

      <Modal
        open={!!folderDialog}
        onClose={() => setFolderDialog(null)}
        title={folderDialog?.mode === 'rename' ? 'Rename folder' : folderDialog?.parentId ? 'New sub-folder' : 'New folder'}
        width={380}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFolderDialog(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!folderName.trim()} onClick={() => void submitFolder()}>
              {folderDialog?.mode === 'rename' ? 'Rename' : 'Create'}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitFolder();
          }}
        >
          <Input data-autofocus value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Folder name" aria-label="Folder name" maxLength={60} />
        </form>
      </Modal>
    </div>
  );
}

type RowHandlers = Record<'select' | 'open' | 'toggleFavorite' | 'edit' | 'move' | 'remove', (b: Bookmark) => void>;

const BookmarkRow = memo(function BookmarkRow({ bookmark: b, selected, api }: { bookmark: Bookmark; selected: boolean; api: RowHandlers }) {
  const name = b.title || b.url;
  return (
    <li data-bookmark-id={b.id} className={cn('group flex items-center gap-3 rounded-[var(--radius-ctl)] border px-3 py-2.5 transition-colors', selected ? 'ts-active' : 'border-transparent hover:bg-glow')}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-2">
        <Favicon url={b.url} size={18} />
      </span>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => api.select(b)} aria-label={`Show details for ${name}`}>
        <span className="block truncate text-sm font-medium">{b.title || hostname(b.url)}</span>
        <span className="block truncate text-xs text-faint">{b.url}</span>
      </button>
      {b.tags.length > 0 && (
        <span className="hidden shrink-0 items-center gap-1 md:flex">
          {b.tags.slice(0, 3).map((t) => (
            <Tag key={t} className="h-5 px-1.5 text-[11px]">
              {t}
            </Tag>
          ))}
        </span>
      )}
      <IconButton size="sm" label={b.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={b.favorite} onClick={() => api.toggleFavorite(b)}>
        <Star size={15} className={b.favorite ? 'fill-current text-fg' : ''} />
      </IconButton>
      <IconButton size="sm" label={`Open ${name} in a new tab`} onClick={() => api.open(b)}>
        <ExternalLink size={15} />
      </IconButton>
      <Menu
        label={`Actions for ${name}`}
        trigger={<MoreHorizontal size={15} />}
        items={[
          { label: 'Edit', icon: <Pencil size={14} />, onSelect: () => api.edit(b) },
          { label: 'Move to folder…', icon: <FolderInput size={14} />, onSelect: () => api.move(b) },
          { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: () => api.remove(b) },
        ]}
      />
    </li>
  );
});

function BookmarkDetails({
  bookmark: b,
  folderLabel,
  onClose,
  onOpen,
  onMove,
  onEdit,
  onDelete,
}: {
  bookmark: Bookmark;
  folderLabel: string;
  onClose: () => void;
  onOpen: () => void;
  onMove: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState(b.notes ?? '');
  const [tags, setTags] = useState(b.tags.join(', '));
  const save = (changes: Partial<Bookmark>) => patch('ts.bookmarks', b.id, changes).catch(() => toast('Could not save.', 'error'));
  return (
    <aside className="ts-card flex flex-col gap-4 p-5 lg:col-start-2 xl:col-start-auto xl:sticky xl:top-4 xl:self-start" aria-label="Link details">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-2">
          <Favicon url={b.url} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">{b.title || hostname(b.url)}</h2>
          <p className="truncate text-xs text-faint">{b.url}</p>
        </div>
        <IconButton label="Close details" size="sm" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" icon={<ExternalLink size={14} />} onClick={onOpen}>
          Open
        </Button>
        <Button size="sm" icon={<Pencil size={14} />} onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" icon={<FolderInput size={14} />} onClick={onMove}>
          Move
        </Button>
      </div>
      <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 text-[13px]">
        <dt className="text-muted">Folder</dt>
        <dd>{folderLabel}</dd>
        <dt className="text-muted">Added</dt>
        <dd>{new Date(b.createdAt).toLocaleDateString()}</dd>
        {b.lastOpenedAt && (
          <>
            <dt className="text-muted">Opened</dt>
            <dd>{new Date(b.lastOpenedAt).toLocaleDateString()}</dd>
          </>
        )}
      </dl>
      <Field label="Tags" hint="Comma separated">
        {(id) => (
          <Input
            id={id}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onBlur={() => {
              const next = parseTags(tags);
              if (next.join(',') !== b.tags.join(',')) void save({ tags: next });
              setTags(next.join(', '));
            }}
          />
        )}
      </Field>
      <Field label="Notes">
        {(id) => <Textarea id={id} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (b.notes ?? '') && void save({ notes: notes || undefined })} placeholder="Why is this worth keeping?" />}
      </Field>
      <div className="flex justify-end border-t border-line pt-3">
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </aside>
  );
}
