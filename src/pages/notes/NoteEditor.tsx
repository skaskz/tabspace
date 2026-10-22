import { useCallback, useEffect, useRef, useState } from 'react';
import { Bold, Code, Eye, FolderInput, Heading2, Italic, LayoutGrid, Link2, List, ListChecks, MoreHorizontal, PenLine, RotateCcw, Star, Trash2 } from 'lucide-react';
import { Button, IconButton, Menu, Modal, Select, Segmented, Tag, useConfirm, useToast } from '@/components/ui';
import { patch, remove, update } from '@/storage/store';
import { removeRecovery, writeRecoverySync } from '@/features/notes/recovery';
import { adoptExternal, dirtyChanges, type Draft, type DraftField } from '@/features/notes/autosave';
import type { Note, NoteFolder, Workspace } from '@/types/models';
import { cn } from '@/utils/cn';
import { applyFormat, normalizeTag, type FormatKind } from '@/features/notes/notes';
import { renderMarkdown } from '@/features/notes/markdown';

const TOOLBAR: { kind: FormatKind; label: string; icon: typeof Bold }[] = [
  { kind: 'bold', label: 'Bold', icon: Bold },
  { kind: 'italic', label: 'Italic', icon: Italic },
  { kind: 'heading', label: 'Heading', icon: Heading2 },
  { kind: 'bullet', label: 'Bulleted list', icon: List },
  { kind: 'checkbox', label: 'Checklist item', icon: ListChecks },
  { kind: 'link', label: 'Link', icon: Link2 },
  { kind: 'code', label: 'Inline code', icon: Code },
];

export const AUTOSAVE_MS = 500;

/** Preview styles for the safe Markdown renderer (task lists, code blocks). */
export const PREVIEW_CLASS =
  'ts-prose text-[15px] [&_.ts-tasklist]:list-none! [&_.ts-tasklist]:pl-0.5! [&_.ts-task_input]:mr-1.5 [&_.ts-task_input]:align-middle [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-3 [&_pre]:p-3 [&_pre_code]:bg-transparent! [&_pre_code]:p-0! [&_hr]:my-4 [&_hr]:border-line';

function savedLabel(ts: number): string {
  return `Saved · ${new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** Markdown note editor with debounced autosave. Mount with `key={note.id}`. */
export function NoteEditor({ note, folders, workspaces, onClosed }: { note: Note; folders: NoteFolder[]; workspaces: Workspace[]; onClosed: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [mode, setMode] = useState<'edit' | 'preview'>(note.content.trim() ? 'preview' : 'edit');
  const [pending, setPending] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [dialog, setDialog] = useState<null | 'folder' | 'workspace'>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<Draft>({ title, content });
  /** Fields edited locally since the last save — only these are written. */
  const dirty = useRef(new Set<DraftField>());
  const timer = useRef<number | undefined>(undefined);
  const trashed = !!note.trashedAt;

  /** Newest `updatedAt` this editor's edits are based on: the stored note's, or our own last write's. */
  const baseUpdatedAt = useRef(note.updatedAt);
  baseUpdatedAt.current = Math.max(baseUpdatedAt.current, note.updatedAt);

  /** Normal save: only the edited fields, under the store's lock. */
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!dirty.current.size) return;
    const changes = dirtyChanges(latest.current, dirty.current);
    dirty.current = new Set();
    setPending(false);
    const at = Date.now();
    baseUpdatedAt.current = Math.max(baseUpdatedAt.current, at);
    void update('ts.notes', (list) =>
      list.map((n) => {
        if (n.id !== note.id) return n;
        const updatedAt = Math.max(at, n.updatedAt + 1);
        baseUpdatedAt.current = Math.max(baseUpdatedAt.current, updatedAt);
        return { ...n, ...changes, updatedAt };
      }),
    )
      .then(() => removeRecovery(note.id))
      .catch(() => toast('Could not save the note.', 'error'));
  }, [note.id, toast]);

  /**
   * True unload: an async locked write may never finish, so synchronously store a
   * small per-note recovery record (applied on next load if still current), then
   * also start the normal save in case the page lives long enough.
   */
  const flushOnUnload = useCallback(() => {
    if (!dirty.current.size) return;
    writeRecoverySync({ id: note.id, fields: dirtyChanges(latest.current, dirty.current), baseUpdatedAt: baseUpdatedAt.current, savedAt: Date.now() });
    flush();
  }, [note.id, flush]);

  const schedule = (field: DraftField, value: string) => {
    latest.current = { ...latest.current, [field]: value };
    dirty.current.add(field);
    setPending(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, AUTOSAVE_MS);
  };

  // Another tab/surface saved this note: adopt fields we haven't edited locally.
  const prevStored = useRef<Draft>({ title: note.title, content: note.content });
  useEffect(() => {
    const previous = prevStored.current;
    prevStored.current = { title: note.title, content: note.content };
    const next = adoptExternal(latest.current, note, previous, dirty.current);
    if (!next) return;
    latest.current = next;
    setTitle(next.title);
    setContent(next.content);
  }, [note.title, note.content, note]);

  useEffect(() => {
    const onHide = () => flushOnUnload();
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [flush, flushOnUnload]);

  const save = (changes: Partial<Note>) => patch('ts.notes', note.id, changes).catch(() => toast('Could not save the note.', 'error'));

  const format = (kind: FormatKind) => {
    const el = area.current;
    if (!el) return;
    const r = applyFormat(kind, content, el.selectionStart, el.selectionEnd);
    setContent(r.value);
    schedule('content', r.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.selStart, r.selEnd);
    });
  };

  const addTag = () => {
    const t = normalizeTag(tagDraft);
    setTagDraft('');
    if (t && !note.tags.includes(t)) void save({ tags: [...note.tags, t] });
  };

  if (trashed) {
    return (
      <section className="ts-card flex min-h-[520px] flex-col p-6" aria-label="Trashed note">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-ctl)] border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
          <span>This note is in the Trash.</span>
          <div className="flex gap-2">
            <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => void save({ trashedAt: undefined })}>
              Restore
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={14} />}
              onClick={async () => {
                if (await confirm({ title: 'Delete permanently?', message: `“${note.title || 'Untitled note'}” can’t be recovered.`, confirmLabel: 'Delete forever', danger: true })) {
                  onClosed();
                  await remove('ts.notes', note.id).catch(() => toast('Could not delete the note.', 'error'));
                }
              }}
            >
              Delete permanently
            </Button>
          </div>
        </div>
        <h2 className="mb-3 text-2xl font-bold">{note.title || 'Untitled note'}</h2>
        <div className={PREVIEW_CLASS} dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }} />
      </section>
    );
  }

  const folder = folders.find((f) => f.id === note.folderId);
  const workspace = workspaces.find((w) => w.id === note.workspaceId);

  return (
    <section className="ts-card flex min-h-[520px] flex-col p-6" aria-label="Note editor" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && flush()}>
      <div className="flex items-start gap-2">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            schedule('title', e.target.value);
          }}
          onBlur={flush}
          placeholder="Untitled note"
          aria-label="Note title"
          className="min-w-0 flex-1 bg-transparent text-2xl font-bold tracking-[-0.02em] outline-none placeholder:text-faint rounded-md focus-visible:ring-2 focus-visible:ring-fg/40"
        />
        <IconButton label={note.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={note.favorite} onClick={() => void save({ favorite: !note.favorite })}>
          <Star size={18} className={note.favorite ? 'fill-current text-fg' : ''} />
        </IconButton>
        <Menu
          label="Note actions"
          trigger={<MoreHorizontal size={18} />}
          items={[
            { label: 'Move to folder…', icon: <FolderInput size={14} />, onSelect: () => setDialog('folder') },
            { label: 'Set workspace…', icon: <LayoutGrid size={14} />, onSelect: () => setDialog('workspace') },
            {
              label: 'Move to Trash',
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => {
                flush();
                void save({ trashedAt: Date.now() }).then(() => toast('Note moved to Trash.'));
                onClosed();
              },
            },
          ]}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {folder && <span className="mr-1">in {folder.name}</span>}
        {workspace && <span className="mr-1">· {workspace.name}</span>}
        {note.tags.map((t) => (
          <Tag key={t} onRemove={() => void save({ tags: note.tags.filter((x) => x !== t) })}>
            #{t}
          </Tag>
        ))}
        <input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag();
            }
          }}
          onBlur={() => tagDraft.trim() && addTag()}
          placeholder="+ Add tag"
          aria-label="Add tag"
          className="h-6 w-24 rounded-md bg-transparent px-1 text-xs outline-none placeholder:text-faint focus:bg-surface-2 focus-visible:ring-2 focus-visible:ring-fg/40"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-y border-line py-2">
        <div className={cn('flex flex-wrap items-center gap-0.5', mode === 'preview' && 'invisible')} role="toolbar" aria-label="Formatting">
          {TOOLBAR.map(({ kind, label, icon: Icon }) => (
            <IconButton key={kind} label={label} size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => format(kind)} disabled={mode === 'preview'}>
              <Icon size={15} />
            </IconButton>
          ))}
        </div>
        <Segmented
          label="Editor mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'edit', label: <><PenLine size={13} /> Edit</> },
            { value: 'preview', label: <><Eye size={13} /> Preview</> },
          ]}
        />
      </div>

      {mode === 'edit' ? (
        <textarea
          ref={area}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            schedule('content', e.target.value);
          }}
          onBlur={flush}
          placeholder="Start writing… Markdown supported."
          aria-label="Note content"
          className="mt-4 min-h-[360px] w-full flex-1 resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-faint"
        />
      ) : (
        <div className={cn(PREVIEW_CLASS, 'mt-4 min-h-[360px] flex-1')} onDoubleClick={() => setMode('edit')}>
          {content.trim() ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} /> : <p className="text-faint">Nothing to preview yet.</p>}
        </div>
      )}

      <div className="mt-3 text-right text-xs text-faint" role="status" aria-live="polite">
        {pending ? 'Saving…' : savedLabel(note.updatedAt)}
      </div>

      <Modal open={dialog === 'folder'} onClose={() => setDialog(null)} title="Move to folder" width={380}>
        <Select
          aria-label="Folder"
          className="w-full"
          value={note.folderId ?? ''}
          onChange={(e) => {
            void save({ folderId: e.target.value || undefined });
            setDialog(null);
          }}
        >
          <option value="">No folder</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      </Modal>
      <Modal open={dialog === 'workspace'} onClose={() => setDialog(null)} title="Set workspace" width={380}>
        <Select
          aria-label="Workspace"
          className="w-full"
          value={note.workspaceId ?? ''}
          onChange={(e) => {
            void save({ workspaceId: e.target.value || undefined });
            setDialog(null);
          }}
        >
          <option value="">No workspace</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        {!workspaces.length && <p className="mt-2 text-xs text-faint">Create a workspace on the Workspaces page first.</p>}
      </Modal>
    </section>
  );
}
