import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type FormEvent } from 'react';
import { Star } from 'lucide-react';
import { useStore } from '@/hooks/useStore';
import { insert, patch, remove } from '@/storage/store';
import { urlKey } from '@/features/bookmarks/bookmarks';
import { useToast } from '@/components/ui';
import { isSafeUrl } from '@/utils/url';
import { cn } from '@/utils/cn';
import type { BookmarkFolder } from '@/types/models';
import { useGateTarget, VisibilityGateContext } from './gateContext';
import { CLOSE_ALL_EVENT } from './BarMenu';

/**
 * "Bookmark this page" (☆ / ★ when saved).
 *
 * Uses the Frontend agent's shared `BookmarkPagePopover` (title, nested folder
 * picker, new folder, tags, duplicate detection) when that module exists —
 * resolved at build time via import.meta.glob so the bar builds either way —
 * and otherwise a minimal built-in panel with the same essentials.
 * Contract passed to the shared popover: { url, title, onClose }.
 */
type PopoverProps = { url: string; title: string; onClose: () => void };
const shared = import.meta.glob<{ BookmarkPagePopover?: ComponentType<PopoverProps> }>(['/src/features/bookmarks/BookmarkPagePopover.tsx', '/src/pages/bookmarks/BookmarkPagePopover.tsx'], { eager: true });
const SharedPopover = Object.values(shared).find((m) => m.BookmarkPagePopover)?.BookmarkPagePopover;

export interface PageInfo {
  url: string;
  title: string;
}

export function BookmarkButton({ page, onOpenChange }: { page: PageInfo | null; onOpenChange?: (open: boolean) => void }) {
  const [bookmarks] = useStore('ts.bookmarks');
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: 8, top: 38 });
  const valid = !!page && isSafeUrl(page.url);
  const saved = useMemo(() => (valid ? bookmarks.some((b) => urlKey(b.url) === urlKey(page!.url)) : false), [bookmarks, page, valid]);

  const set = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  };

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 340)), top: r.bottom + 4 });
  }, [open]);

  if (!valid) return null;
  const close = () => {
    set(false);
    btn.current?.focus();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        data-bar-item
        tabIndex={-1}
        aria-label={saved ? 'Edit bookmark for this page' : 'Bookmark this page'}
        aria-pressed={saved}
        aria-expanded={open}
        title={saved ? 'Edit bookmark' : 'Bookmark this page'}
        onClick={() => set(!open)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-glow hover:text-fg"
      >
        <Star size={15} fill={saved ? 'currentColor' : 'none'} className={saved ? 'text-fg' : undefined} />
      </button>
      {open && (
        <Popover onClose={close} style={{ left: pos.left, top: pos.top }}>
          {SharedPopover ? <SharedPopover url={page!.url} title={page!.title} onClose={close} /> : <QuickBookmark page={page!} onClose={close} />}
        </Popover>
      )}
    </>
  );
}

function Popover({ children, onClose, style }: { children: React.ReactNode; onClose: () => void; style: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useGateTarget(ref);
  const gated = !!useContext(VisibilityGateContext);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[aria-label*="ookmark"]') && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener(CLOSE_ALL_EVENT, onClose);
    return () => {
      window.removeEventListener(CLOSE_ALL_EVENT, onClose);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="dialog" aria-label="Bookmark this page" className={cn('ts-card fixed z-50 w-[320px] p-4 shadow-2xl', !gated && 'ts-fade-in')} style={{ ...style, background: 'var(--ts-bg)', ...(gated ? { backdropFilter: 'none' } : null) }}>
      {children}
    </div>
  );
}

/** Folders in tree order with depth, for an indented picker. */
export function folderOptions(folders: BookmarkFolder[]): { folder: BookmarkFolder; depth: number }[] {
  const out: { folder: BookmarkFolder; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const f of folders.filter((x) => (x.parentId ?? undefined) === parent).sort((a, b) => a.order - b.order)) {
      out.push({ folder: f, depth });
      if (depth < 6) walk(f.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

/** Built-in fallback: title + nested folder picker (+ new folder) + save / remove, with duplicate detection. */
function QuickBookmark({ page, onClose }: { page: PageInfo; onClose: () => void }) {
  const [bookmarks] = useStore('ts.bookmarks');
  const [folders] = useStore('ts.bookmarkFolders');
  const toast = useToast();
  const existing = bookmarks.find((b) => urlKey(b.url) === urlKey(page.url));
  const [title, setTitle] = useState(existing?.title ?? page.title ?? '');
  const [folderId, setFolderId] = useState<string>(existing?.folderId ?? '');
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const opts = folderOptions(folders);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    let target = folderId || undefined;
    if (newFolder?.trim()) {
      const f = await insert('ts.bookmarkFolders', { name: newFolder.trim(), parentId: folderId || undefined, order: folders.length });
      target = f.id;
    }
    const t = title.trim() || page.url;
    if (existing) await patch('ts.bookmarks', existing.id, { title: t, folderId: target });
    else await insert('ts.bookmarks', { url: page.url, title: t, folderId: target, tags: [], favorite: false });
    toast(existing ? 'Bookmark updated' : 'Bookmarked');
    onClose();
  };

  const del = async () => {
    if (!existing) return;
    await remove('ts.bookmarks', existing.id);
    toast('Bookmark removed');
    onClose();
  };

  const field = 'h-9 w-full rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-fg focus:border-line-strong';
  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <h2 className="text-[14px] font-semibold">{existing ? 'Edit bookmark' : 'Bookmark this page'}</h2>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Name
        <input autoFocus className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Folder
        <select className={field} value={folderId} onChange={(e) => setFolderId(e.target.value)} aria-label="Folder">
          <option value="">No folder</option>
          {opts.map(({ folder, depth }) => (
            <option key={folder.id} value={folder.id}>
              {`${'  '.repeat(depth)}${folder.name}`}
            </option>
          ))}
        </select>
      </label>
      {newFolder === null ? (
        <button type="button" className="self-start text-xs text-muted hover:text-fg" onClick={() => setNewFolder('')}>
          + New folder{folderId ? ' inside' : ''}
        </button>
      ) : (
        <input className={field} placeholder="New folder name" aria-label="New folder name" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} />
      )}
      {existing && <p className="text-xs text-faint">Already saved — changes update the existing bookmark.</p>}
      <div className="flex items-center gap-2">
        {existing && (
          <button type="button" onClick={() => void del()} className="mr-auto text-xs text-danger hover:underline">
            Remove
          </button>
        )}
        <button type="button" onClick={onClose} className={cn('h-8 rounded-lg px-3 text-[12.5px] text-muted hover:text-fg', !existing && 'ml-auto')}>
          Cancel
        </button>
        <button type="submit" className="h-8 rounded-lg bg-fg px-3.5 text-[12.5px] font-medium text-bg hover:opacity-90">
          {existing ? 'Save' : 'Done'}
        </button>
      </div>
    </form>
  );
}
