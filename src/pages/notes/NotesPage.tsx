import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileText, Folder, FolderPlus, Hash, MoreHorizontal, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react';
import { PageHero } from '@/components/layout/PageHero';
import { Button, EmptyState, IconButton, Input, Menu, Modal, Select, Tag, useConfirm, useToast } from '@/components/ui';
import { navigate, useRoute } from '@/app/router';
import { useStore } from '@/hooks/useStore';
import { insert, patch, remove, update } from '@/storage/store';
import type { Note, NoteFolder } from '@/types/models';
import { LoadMore, useIncremental } from '@/features/search/useIncremental';
import { createNote } from '@/features/notes/actions';
import { recoverUnsavedNotes } from '@/features/notes/recovery';
import { cn } from '@/utils/cn';
import { formatRelative } from '@/utils/date';
import { deriveTags, displayTitle, filterNotes, snippet, sortNotes, type NoteFilter, type NoteSort } from '@/features/notes/notes';
import { NoteEditor } from './NoteEditor';

function sameFilter(a: NoteFilter, b: NoteFilter): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'folder' && b.kind === 'folder') return a.id === b.id;
  if (a.kind === 'tag' && b.kind === 'tag') return a.tag === b.tag;
  return true;
}

export default function NotesPage() {
  const [notes, , loaded] = useStore('ts.notes');
  const [folders] = useStore('ts.noteFolders');
  const [workspaces] = useStore('ts.workspaces');
  const { params } = useRoute();
  const toast = useToast();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<NoteFilter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<NoteSort>('edited');
  const [folderDialog, setFolderDialog] = useState<null | { mode: 'create' } | { mode: 'rename'; folder: NoteFolder }>(null);
  const [folderName, setFolderName] = useState('');
  const creating = useRef(false);

  const selectedId = params.get('id');
  const selected = selectedId ? notes.find((n) => n.id === selectedId) : undefined;

  // Apply edits saved during an unload (tab closed/reloaded mid-debounce), if still current.
  useEffect(() => {
    void recoverUnsavedNotes().catch(() => undefined);
  }, []);

  // `#/notes?new=1` creates a note (once) and swaps the URL to its id.
  const wantsNew = params.get('new') === '1';
  useEffect(() => {
    if (!wantsNew || creating.current) return;
    creating.current = true;
    void createNote()
      .then((n) => window.location.replace(`#/notes?id=${encodeURIComponent(n.id)}`))
      .catch(() => toast('Could not create a note.', 'error'))
      .finally(() => {
        creating.current = false;
      });
  }, [wantsNew, toast]);

  const sortedFolders = useMemo(() => [...folders].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)), [folders]);
  const tags = useMemo(() => deriveTags(notes), [notes]);
  const live = notes.filter((n) => !n.trashedAt);
  const counts = { all: live.length, favorites: live.filter((n) => n.favorite).length, trash: notes.length - live.length };
  const deferredQuery = useDeferredValue(query);
  const list = useMemo(() => sortNotes(filterNotes(notes, filter, deferredQuery), sort), [notes, filter, deferredQuery, sort]);
  const filterKey = filter.kind === 'folder' ? `f:${filter.id}` : filter.kind === 'tag' ? `t:${filter.tag}` : filter.kind;
  const shown = useIncremental(list, `${filterKey}|${deferredQuery}|${sort}`);

  const newNote = async () => {
    try {
      const n = await createNote({
        folderId: filter.kind === 'folder' ? filter.id : undefined,
        tags: filter.kind === 'tag' ? [filter.tag] : [],
        favorite: filter.kind === 'favorites',
      });
      if (filter.kind === 'trash') setFilter({ kind: 'all' });
      navigate('notes', { id: n.id });
    } catch {
      toast('Could not create a note.', 'error');
    }
  };

  const submitFolder = async () => {
    const name = folderName.trim();
    if (!name || !folderDialog) return;
    try {
      if (folderDialog.mode === 'create') {
        const f = await insert('ts.noteFolders', { name, order: folders.reduce((m, x) => Math.max(m, x.order), 0) + 1 });
        setFilter({ kind: 'folder', id: f.id });
      } else {
        await patch('ts.noteFolders', folderDialog.folder.id, { name });
      }
      setFolderDialog(null);
    } catch {
      toast('Could not save the folder.', 'error');
    }
  };

  const deleteFolder = async (f: NoteFolder) => {
    const n = notes.filter((x) => x.folderId === f.id).length;
    const ok = await confirm({
      title: `Delete folder “${f.name}”?`,
      message: n ? `${n} note${n === 1 ? '' : 's'} will be kept and moved out of the folder.` : 'The folder is empty.',
      confirmLabel: 'Delete folder',
      danger: true,
    });
    if (!ok) return;
    try {
      await update('ts.notes', (list) => list.map((x) => (x.folderId === f.id ? { ...x, folderId: undefined, updatedAt: Date.now() } : x)));
      await remove('ts.noteFolders', f.id);
      if (filter.kind === 'folder' && filter.id === f.id) setFilter({ kind: 'all' });
    } catch {
      toast('Could not delete the folder.', 'error');
    }
  };

  const nav = (f: NoteFilter, label: string, icon: ReactNode, count?: number, extra?: ReactNode) => (
    <li key={f.kind === 'folder' ? `folder:${f.id}` : f.kind === 'tag' ? `tag:${f.tag}` : f.kind} className="group flex items-center">
      <button
        type="button"
        onClick={() => setFilter(f)}
        aria-current={sameFilter(filter, f) ? 'true' : undefined}
        className={cn(
          'flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-ctl)] border px-3 text-left text-[13.5px] transition-colors',
          sameFilter(filter, f) ? 'ts-active text-fg' : 'border-transparent text-muted hover:bg-glow hover:text-fg',
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && <span className="text-xs tabular-nums text-faint">{count}</span>}
      </button>
      {extra}
    </li>
  );

  const listTitle =
    filter.kind === 'all' ? 'All Notes' : filter.kind === 'favorites' ? 'Favorites' : filter.kind === 'trash' ? 'Trash' : filter.kind === 'folder' ? (folders.find((f) => f.id === filter.id)?.name ?? 'Folder') : `#${filter.tag}`;

  return (
    <div>
      <PageHero
        title="Notes"
        subtitle="Write it down. Find it later."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => void newNote()}>
            New Note
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[210px_300px_minmax(0,1fr)]">
        {/* Left navigation */}
        <nav aria-label="Note collections" className="flex flex-col gap-5">
          <ul className="flex flex-col gap-0.5">
            {nav({ kind: 'all' }, 'All Notes', <FileText size={16} />, counts.all)}
            {nav({ kind: 'favorites' }, 'Favorites', <Star size={16} />, counts.favorites)}
            {nav({ kind: 'trash' }, 'Trash', <Trash2 size={16} />, counts.trash)}
          </ul>
          <div>
            <div className="mb-1 flex items-center justify-between px-3">
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
            {sortedFolders.length === 0 ? (
              <p className="px-3 text-xs text-faint">No folders yet.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {sortedFolders.map((f) =>
                  nav(
                    { kind: 'folder', id: f.id },
                    f.name,
                    <Folder size={16} />,
                    live.filter((n) => n.folderId === f.id).length,
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
                          { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteFolder(f) },
                        ]}
                      />
                    </span>,
                  ),
                )}
              </ul>
            )}
          </div>
          {tags.length > 0 && (
            <div>
              <h2 className="mb-1 px-3 text-xs font-medium tracking-wide text-faint uppercase">Tags</h2>
              <ul className="flex flex-col gap-0.5">{tags.map(({ tag, count }) => nav({ kind: 'tag', tag }, tag, <Hash size={15} />, count))}</ul>
            </div>
          )}
        </nav>

        {/* Middle list */}
        <section aria-label={listTitle} className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-[15px] font-semibold">{listTitle}</h2>
            <Select aria-label="Sort notes" value={sort} onChange={(e) => setSort(e.target.value as NoteSort)} className="h-8 text-[13px]">
              <option value="edited">Last edited</option>
              <option value="title">Title</option>
            </Select>
          </div>
          <Input icon={<Search size={15} />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
          {!loaded ? (
            <p className="px-2 text-sm text-muted" role="status">
              Loading…
            </p>
          ) : list.length === 0 ? (
            <div className="ts-card">
              <EmptyState
                icon={filter.kind === 'trash' ? <Trash2 size={26} /> : <FileText size={26} />}
                title={query ? 'No matching notes' : filter.kind === 'trash' ? 'Trash is empty' : 'No notes here yet'}
                description={query ? `Nothing matches “${query}”.` : filter.kind === 'trash' ? 'Deleted notes stay here until you remove them.' : 'Capture an idea, a plan or a checklist.'}
                action={
                  !query && filter.kind !== 'trash' ? (
                    <Button size="sm" icon={<Plus size={14} />} onClick={() => void newNote()}>
                      New note
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {shown.visible.map((n) => (
                  <NoteCard key={n.id} note={n} selected={n.id === selectedId} />
                ))}
              </ul>
              <LoadMore hasMore={shown.hasMore} remaining={shown.remaining} onMore={shown.more} label="notes" />
            </>
          )}
        </section>

        {/* Editor */}
        <div className="min-w-0">
          {selected ? (
            <NoteEditor key={selected.id} note={selected} folders={sortedFolders} workspaces={workspaces} onClosed={() => navigate('notes')} />
          ) : (
            <div className="ts-card">
              <EmptyState
                className="py-8"
                icon={<FileText size={26} />}
                title={selectedId && loaded ? 'Note not found' : 'Select a note'}
                description={selectedId && loaded ? 'It may have been deleted.' : list.length ? 'Pick a note from the list, or start a new one.' : 'Start a new note — Markdown is supported.'}
                action={
                  <Button size="sm" icon={<Plus size={14} />} onClick={() => void newNote()}>
                    New note
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!folderDialog}
        onClose={() => setFolderDialog(null)}
        title={folderDialog?.mode === 'rename' ? 'Rename folder' : 'New folder'}
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

const NoteCard = memo(function NoteCard({ note: n, selected }: { note: Note; selected: boolean }) {
  const text = snippet(n.content, n.title);
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate('notes', { id: n.id })}
        aria-current={selected ? 'true' : undefined}
        className={cn('ts-card ts-hover block w-full p-3.5 text-left', selected && 'ts-active')}
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{displayTitle(n)}</span>
          {n.favorite && <Star size={13} className="shrink-0 fill-current text-muted" aria-label="Favorite" />}
        </div>
        <p className="mt-1 line-clamp-2 min-h-[1.2em] text-[13px] text-muted">{text || <span className="text-faint">No content</span>}</p>
        <div className="mt-2 flex items-center gap-2 text-xs text-faint">
          <span>{formatRelative(n.trashedAt ?? n.updatedAt)}</span>
          {n.tags[0] && <Tag className="h-5 px-1.5 text-[11px]">#{n.tags[0]}</Tag>}
          {n.tags.length > 1 && <span>+{n.tags.length - 1}</span>}
        </div>
      </button>
    </li>
  );
});
