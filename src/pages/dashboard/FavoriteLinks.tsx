import { useMemo, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Card, Favicon, Field, Input, Modal, useConfirm, useToast } from '@/components/ui';
import { useStore } from '@/hooks/useStore';
import { insert, patch } from '@/storage/store';
import type { Bookmark, QuickLink } from '@/types/models';
import { isSafeUrl } from '@/utils/url';
import { findDuplicate, lastTouched, urlKey } from '@/features/bookmarks/bookmarks';
import { removeQuickLink, sortLinks, validateLink } from '@/features/quicklinks/quickLinks';
import { useHubNav } from './hubNav';

export interface LinkTile {
  key: string;
  title: string;
  url: string;
  source: 'favorite' | 'quicklink';
  id: string;
}

/**
 * Quick links pulled from the bookmark system: favourite bookmarks first, then any
 * legacy Quick Links (ts.quickLinks) whose URL isn't already a favourite.
 * Only http(s) URLs are ever shown.
 */
export function buildLinkTiles(bookmarks: Bookmark[], quickLinks: QuickLink[], max = 12): LinkTile[] {
  const out: LinkTile[] = [];
  const seen = new Set<string>();
  const favs = bookmarks.filter((b) => b.favorite && isSafeUrl(b.url)).sort((a, b) => lastTouched(b) - lastTouched(a));
  for (const b of favs) {
    const k = urlKey(b.url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `b:${b.id}`, id: b.id, title: b.title || b.url, url: b.url, source: 'favorite' });
  }
  for (const l of sortLinks(quickLinks)) {
    if (!isSafeUrl(l.url)) continue;
    const k = urlKey(l.url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `q:${l.id}`, id: l.id, title: l.title, url: l.url, source: 'quicklink' });
  }
  return out.slice(0, max);
}

/** Add a link as a favourite bookmark (or star an existing bookmark with the same URL). */
export async function addFavoriteLink(title: string, url: string, bookmarks: Bookmark[]): Promise<void> {
  const dup = findDuplicate(bookmarks, url);
  if (dup) {
    if (!dup.favorite) await patch('ts.bookmarks', dup.id, { favorite: true });
    return;
  }
  await insert('ts.bookmarks', { url, title, tags: [], favorite: true });
}

/** New Tab "Quick Links": favourite bookmarks as tiles that open in this tab. */
export function FavoriteLinksCard({ max = 12, columns = 3 }: { max?: number; columns?: 3 | 4 }) {
  const [bookmarks] = useStore('ts.bookmarks');
  const [quickLinks] = useStore('ts.quickLinks');
  const go = useHubNav();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const tiles = useMemo(() => buildLinkTiles(bookmarks, quickLinks, max), [bookmarks, quickLinks, max]);

  const removeTile = async (t: LinkTile) => {
    const fav = t.source === 'favorite';
    const ok = await confirm({
      title: fav ? 'Remove from favorites?' : 'Remove shortcut?',
      message: fav ? `“${t.title}” stays in your bookmarks, it just won't show here.` : `“${t.title}” will be removed from your shortcuts.`,
      confirmLabel: 'Remove',
      danger: !fav,
    });
    if (!ok) return;
    try {
      if (fav) await patch('ts.bookmarks', t.id, { favorite: false });
      else await removeQuickLink(t.id);
    } catch {
      toast('Could not remove the link.', 'error');
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Quick Links</h2>
        <Button variant="ghost" size="sm" onClick={() => go('bookmarks')}>
          Bookmarks
        </Button>
      </div>
      <ul className={columns === 4 ? 'grid grid-cols-4 gap-2' : 'grid grid-cols-3 gap-2'} aria-label="Quick links">
        {tiles.map((t) => (
          <li key={t.key} className="group relative">
            <a href={t.url} title={`${t.title} — ${t.url}`} aria-label={t.title} className="ts-hover ts-lift flex w-full flex-col items-center gap-1.5 rounded-[var(--radius-ctl)] border border-line bg-surface-2/60 px-1 py-2.5">
              <Favicon url={t.url} size={20} />
              <span className="w-full truncate text-center text-[11px] text-muted group-hover:text-fg">{t.title}</span>
            </a>
            <button
              type="button"
              aria-label={`Remove ${t.title} from quick links`}
              onClick={() => void removeTile(t)}
              className="absolute -top-1.5 -right-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-line bg-bg text-faint group-focus-within:flex group-hover:flex hover:text-fg"
            >
              <X size={11} />
            </button>
          </li>
        ))}
        {/* Always available: more favourites than fit are still on the Bookmarks page. */}
        <li>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="ts-hover flex w-full flex-col items-center gap-1.5 rounded-[var(--radius-ctl)] border border-dashed border-line px-1 py-2.5 text-muted"
          >
            <Plus size={20} aria-hidden />
            <span className="text-[11px]">Add link</span>
          </button>
        </li>
      </ul>
      {tiles.length === 0 && <p className="mt-3 text-xs text-muted">Star bookmarks to pin them here, or add a link.</p>}
      <AddFavoriteModal open={adding} onClose={() => setAdding(false)} bookmarks={bookmarks} />
    </Card>
  );
}

function AddFavoriteModal({ open, onClose, bookmarks }: { open: boolean; onClose: () => void; bookmarks: Bookmark[] }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | undefined>();
  const close = () => {
    setTitle('');
    setUrl('');
    setError(undefined);
    onClose();
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    const res = validateLink(title, url);
    if ('error' in res) return setError(res.error);
    try {
      await addFavoriteLink(res.title, res.url, bookmarks);
      close();
    } catch {
      toast('Could not save the link.', 'error');
    }
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Add quick link"
      width={400}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Add
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <p className="text-xs text-muted">Saved as a favorite bookmark, so it also appears on the Bookmarks page.</p>
        <Field label="URL" error={error}>
          {(id) => (
            <Input
              id={id}
              data-autofocus
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(undefined);
              }}
              placeholder="github.com"
              inputMode="url"
            />
          )}
        </Field>
        <Field label="Name" hint="Optional — defaults to the site name.">
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="GitHub" maxLength={40} />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
