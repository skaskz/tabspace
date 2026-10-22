import { useEffect, useState } from 'react';
import { Button, Field, Input, Modal, Select } from '@/components/ui';
import type { Bookmark, BookmarkFolder } from '@/types/models';
import { normalizeUrl } from '@/utils/url';
import { findDuplicate, folderTree, parseTags } from '@/features/bookmarks/bookmarks';

export interface LinkDraft {
  url: string;
  title: string;
  folderId?: string;
  tags: string[];
}

/** Add / edit a bookmark. Validates the URL and warns (once) about duplicates in the chosen folder. */
export function LinkModal({
  open,
  onClose,
  onSubmit,
  initial,
  editing,
  folders,
  bookmarks,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: LinkDraft) => Promise<void>;
  initial?: Partial<LinkDraft>;
  editing?: Bookmark;
  folders: BookmarkFolder[];
  bookmarks: Bookmark[];
}) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string>();
  const [dupAck, setDupAck] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl(editing?.url ?? initial?.url ?? '');
    setTitle(editing?.title ?? initial?.title ?? '');
    setFolderId(editing?.folderId ?? initial?.folderId ?? '');
    setTags((editing?.tags ?? initial?.tags ?? []).join(', '));
    setError(undefined);
    setDupAck(false);
    setBusy(false);
  }, [open, editing, initial]);

  const normalized = normalizeUrl(url);
  const dup = normalized ? findDuplicate(bookmarks, normalized, { folderId: folderId || null, excludeId: editing?.id }) : undefined;
  const dupElsewhere = !dup && normalized ? findDuplicate(bookmarks, normalized, { excludeId: editing?.id }) : undefined;
  const folderName = (id?: string) => folders.find((f) => f.id === id)?.name ?? 'Unfiled';

  const submit = async () => {
    if (!normalized) return setError('Enter a valid http(s) web address.');
    if (dup && !dupAck) return setDupAck(true);
    setBusy(true);
    try {
      await onSubmit({ url: normalized, title: title.trim(), folderId: folderId || undefined, tags: parseTags(tags) });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit link' : 'Add link'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {dup && dupAck ? 'Save anyway' : editing ? 'Save' : 'Add link'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="URL" error={error}>
          {(id) => (
            <Input
              id={id}
              data-autofocus
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(undefined);
                setDupAck(false);
              }}
              placeholder="https://example.com"
              inputMode="url"
              autoComplete="off"
            />
          )}
        </Field>
        {(dup || dupElsewhere) && (
          <p role="status" className="-mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
            {dup
              ? `Already saved in ${folderName(dup.folderId)} as “${dup.title || dup.url}”.${dupAck ? ' Press Save anyway to keep both.' : ''}`
              : `Also saved in ${folderName(dupElsewhere!.folderId)}.`}
          </p>
        )}
        <Field label="Title" hint="Leave empty to use the site name.">
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />}
        </Field>
        <Field label="Folder">
          {(id) => (
            <Select id={id} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">Unfiled</option>
              {folderTree(folders).map(({ folder, depth }) => (
                <option key={folder.id} value={folder.id}>
                  {depth ? '   ' : ''}
                  {folder.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tags" hint="Comma separated, e.g. tools, reading">
          {(id) => <Input id={id} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tools, reading" />}
        </Field>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
