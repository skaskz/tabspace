import { memo, useState } from 'react';
import { Archive, FolderInput, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button, EmptyState, Favicon, Field, Input, Menu, Modal, Select, Tag, useConfirm, useToast, type MenuItem } from '@/components/ui';
import type { SavedSession, Workspace } from '@/types/models';
import { formatRelative } from '@/utils/date';
import { GROUP_COLOR_HEX } from '@/features/tabs/serialize';
import { assignSession, deleteSession, renameSession } from '@/services/sessions';
import { OpenSplitButton, errorMessage, useRestore } from './sessionActions';

/** Saved sessions list (workspace detail + tab manager). */
export function SessionList({ sessions, workspaces, showWorkspace, emptyText }: { sessions: SavedSession[]; workspaces: Workspace[]; showWorkspace?: boolean; emptyText?: string }) {
  const [renaming, setRenaming] = useState<SavedSession | null>(null);
  const [moving, setMoving] = useState<SavedSession | null>(null);
  if (!sessions.length) {
    return <EmptyState icon={<Archive size={26} />} title="No saved sessions" description={emptyText ?? 'Save a window to keep its tabs and groups for later.'} />;
  }
  const names = new Map(workspaces.map((w) => [w.id, w.name]));
  return (
    <>
      <ul className="divide-y divide-line">
        {sessions.map((s) => (
          <SessionRow key={s.id} session={s} workspaceName={showWorkspace ? (s.workspaceId ? names.get(s.workspaceId) ?? 'Unassigned' : 'Unassigned') : undefined} onRename={setRenaming} onMove={workspaces.length ? setMoving : undefined} />
        ))}
      </ul>
      <RenameSessionModal session={renaming} onClose={() => setRenaming(null)} />
      <AssignSessionModal session={moving} workspaces={workspaces} onClose={() => setMoving(null)} />
    </>
  );
}

const SessionRow = memo(function SessionRow({ session: s, workspaceName, onRename, onMove }: { session: SavedSession; workspaceName?: string; onRename: (s: SavedSession) => void; onMove?: (s: SavedSession) => void }) {
  const { restore } = useRestore();
  const confirm = useConfirm();
  const toast = useToast();
  const groupTabs = new Map<string, number>();
  for (const t of s.tabs) if (t.groupId) groupTabs.set(t.groupId, (groupTabs.get(t.groupId) ?? 0) + 1);
  const items: MenuItem[] = [{ label: 'Rename', icon: <Pencil size={14} />, onSelect: () => onRename(s) }];
  if (onMove) items.push({ label: 'Move to workspace…', icon: <FolderInput size={14} />, onSelect: () => onMove(s) });
  items.push({
    label: 'Delete',
    icon: <Trash2 size={14} />,
    danger: true,
    onSelect: async () => {
      const ok = await confirm({ title: 'Delete saved session?', message: `“${s.name}” and its ${s.tabs.length} saved tabs will be removed from Tabspace. Open browser tabs are not affected.`, confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      try {
        await deleteSession(s.id);
        toast('Session deleted');
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
  });
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{s.name}</span>
          {s.archived && <Tag>Archived</Tag>}
          {workspaceName && <Tag>{workspaceName}</Tag>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{formatRelative(s.updatedAt)}</span>
          <span aria-hidden>·</span>
          <span>
            {s.tabs.length} tab{s.tabs.length === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1" aria-hidden>
            {s.tabs.slice(0, 6).map((t) => (
              <Favicon key={t.id} url={t.url} size={14} />
            ))}
          </span>
          {s.groups.map((g) => (
            <span key={g.id} className="inline-flex h-5 items-center gap-1.5 rounded-full border border-line px-2 text-[11px] text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR_HEX[g.color] }} aria-hidden />
              {g.title || 'Untitled'} ({groupTabs.get(g.id) ?? 0})
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <OpenSplitButton label="Restore" name={s.name} onOpen={(mode) => void restore(s.id, mode)} />
        <Menu label={`Actions for ${s.name}`} trigger={<MoreHorizontal size={16} />} items={items} />
      </div>
    </li>
  );
});

function RenameSessionModal({ session, onClose }: { session: SavedSession | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [prev, setPrev] = useState<SavedSession | null>(null);
  if (session !== prev) {
    setPrev(session);
    setName(session?.name ?? '');
  }
  const save = async () => {
    if (!session) return;
    try {
      await renameSession(session.id, name);
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title="Rename session"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} data-autofocus maxLength={120} />}</Field>
      </form>
    </Modal>
  );
}

function AssignSessionModal({ session, workspaces, onClose }: { session: SavedSession | null; workspaces: Workspace[]; onClose: () => void }) {
  const toast = useToast();
  const [target, setTarget] = useState('');
  const [prev, setPrev] = useState<SavedSession | null>(null);
  if (session !== prev) {
    setPrev(session);
    setTarget(session?.workspaceId ?? '');
  }
  const save = async () => {
    if (!session) return;
    try {
      await assignSession(session.id, target || undefined);
      toast('Session moved');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title="Move session to workspace"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Move
          </Button>
        </>
      }
    >
      <Field label="Workspace">
        {(id) => (
          <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)} className="w-full" data-autofocus>
            <option value="">Unassigned</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Modal>
  );
}
