import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Link2, Pin, Plus, Undo2, X } from 'lucide-react';
import { Button, Card, CardHeader, EmptyState, Favicon, IconButton, Input, useConfirm, useToast } from '@/components/ui';
import type { SavedSession, SavedTab } from '@/types/models';
import { cn } from '@/utils/cn';
import { GROUP_COLOR_HEX } from '@/features/tabs/serialize';
import { addCurrentTabToWorkspace, addWorkspaceUrl, moveWorkspaceTab, removeWorkspaceTab, undoRemoveWorkspaceTab, type AddTabResult } from '@/services/sessions';
import type { RemovedTab } from '@/features/workspaces/savedTabs';

const UNDO_MS = 6000;
import { errorMessage } from './sessionActions';

/**
 * The editable list of a workspace's saved tabs (= its latest non-archived
 * session). Edits only change Tabspace's saved list — live Chrome tabs are
 * never touched.
 */
export function SavedTabsPanel({ workspaceId, session }: { workspaceId: string; session: SavedSession | undefined }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [undo, setUndo] = useState<RemovedTab | null>(null);
  /** Where keyboard focus goes after the list re-renders: a saved tab's Remove button, or the URL input. */
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const tabs = useMemo(() => session?.tabs ?? [], [session]);
  const groups = new Map((session?.groups ?? []).map((g) => [g.id, g]));

  const withDuplicateCheck = async (add: (allowDuplicate: boolean) => Promise<AddTabResult>) => {
    let r = await add(false);
    if (r.status === 'duplicate') {
      const ok = await confirm({ title: 'Already saved', message: `“${r.title}” is already in this workspace’s saved tabs. Add it again?`, confirmLabel: 'Add again' });
      if (!ok) return null;
      r = await add(true);
    }
    return r;
  };

  const addUrl = async () => {
    if (!url.trim() || adding) return;
    setAdding(true);
    try {
      const r = await withDuplicateCheck((allowDuplicate) => addWorkspaceUrl(workspaceId, url, { allowDuplicate }));
      if (r) {
        toast(`Added ${r.url}`);
        setUrl('');
      }
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setAdding(false);
    }
  };

  const addCurrent = async () => {
    try {
      const r = await withDuplicateCheck((allowDuplicate) => addCurrentTabToWorkspace(workspaceId, { allowDuplicate }));
      if (r) toast(`Added “${r.title}”`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const latest = useRef({ tabs, workspaceId });
  latest.current = { tabs, workspaceId };

  const move = useCallback(
    async (id: string, to: number) => {
      const { tabs: list, workspaceId: wid } = latest.current;
      const t = list.find((x) => x.id === id);
      if (!t) return;
      try {
        await moveWorkspaceTab(wid, id, to);
        const pos = Math.max(0, Math.min(list.length - 1, to)) + 1;
        setAnnounce(`Moved ${t.title} to position ${pos} of ${list.length}`);
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
    [toast],
  );

  const removeTab = useCallback(
    async (id: string) => {
      const list = latest.current.tabs;
      const i = list.findIndex((x) => x.id === id);
      // Keep keyboard focus in the list: next row, else previous row, else the URL input.
      const neighbour = list[i + 1] ?? list[i - 1];
      try {
        const removed = await removeWorkspaceTab(latest.current.workspaceId, id);
        if (!removed) return;
        setFocusTarget(neighbour ? neighbour.id : '__url');
        setUndo(removed);
        setAnnounce(`Removed ${removed.tab.title} from saved tabs. Undo is available.`);
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
    [toast],
  );

  const undoRemove = async () => {
    if (!undo) return;
    const r = undo;
    setUndo(null);
    try {
      await undoRemoveWorkspaceTab(latest.current.workspaceId, r);
      setFocusTarget(r.tab.id);
      setAnnounce(`Restored ${r.tab.title} to position ${r.index + 1}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  // The undo bar disappears after a few seconds.
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(t);
  }, [undo]);

  // Apply the pending focus once the list reflects the change.
  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget === '__url') {
      urlRef.current?.focus();
      setFocusTarget(null);
      return;
    }
    const el = panelRef.current?.querySelector<HTMLElement>(`[data-remove-for="${CSS.escape(focusTarget)}"]`);
    if (el) {
      el.focus();
      setFocusTarget(null);
    }
  }, [focusTarget, tabs]);

  /** Insertion point p (0..n) in the current list -> final index for moveSavedTab. */
  const dropTo = (p: number) => {
    if (!dragId) return;
    const from = tabs.findIndex((t) => t.id === dragId);
    if (from < 0) return;
    const to = p > from ? p - 1 : p;
    setDragId(null);
    setDropAt(null);
    if (to !== from) void move(dragId, to);
  };

  return (
    <div ref={panelRef}>
    <Card>
      <CardHeader
        title={`Saved tabs (${tabs.length})`}
        action={
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => void addCurrent()}>
            Add current tab
          </Button>
        }
      />
      <form
        className="flex items-center gap-2 px-5 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          void addUrl();
        }}
      >
        <Input ref={urlRef} icon={<Link2 size={15} />} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a URL to add, e.g. github.com/me/project" aria-label="URL to add" className="flex-1" />
        <Button type="submit" size="md" disabled={!url.trim() || adding}>
          Add URL
        </Button>
      </form>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
      {undo && (
        <div className="ts-fade-in mx-5 mb-3 flex items-center justify-between gap-3 rounded-[var(--radius-ctl)] border border-line bg-surface-2 px-3 py-2 text-[13px]">
          <span className="min-w-0 truncate">
            Removed “{undo.tab.title}”
          </span>
          <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} onClick={() => void undoRemove()}>
            Undo
          </Button>
        </div>
      )}
      {tabs.length === 0 ? (
        <EmptyState title="No saved tabs yet" description="Use “Save current window…” above, add the tab you’re on, or paste a URL. Opening the workspace reopens these tabs in this order." />
      ) : (
        <ol
          className="pb-2"
          aria-label="Saved tabs, in the order they open"
          onDragOver={(e) => dragId && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dropAt !== null) dropTo(dropAt);
          }}
        >
          {tabs.map((t, i) => (
            <SavedTabRow
              key={t.id}
              tab={t}
              index={i}
              count={tabs.length}
              groupTitle={t.groupId ? (groups.get(t.groupId)?.title ?? '') : undefined}
              groupColor={t.groupId ? groups.get(t.groupId)?.color : undefined}
              dragging={dragId === t.id}
              dropBefore={dropAt === i}
              dropAfter={dropAt === tabs.length && i === tabs.length - 1}
              onMove={move}
              onRemove={removeTab}
              onDragStart={(id) => setDragId(id)}
              onDragEnd={() => {
                setDragId(null);
                setDropAt(null);
              }}
              onDragOverRow={(idx, after) => setDropAt(after ? idx + 1 : idx)}
            />
          ))}
        </ol>
      )}
    </Card>
    </div>
  );
}

const SavedTabRow = memo(function SavedTabRow({
  tab,
  index,
  count,
  groupTitle,
  groupColor,
  dragging,
  dropBefore,
  dropAfter,
  onMove,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOverRow,
}: {
  tab: SavedTab;
  index: number;
  count: number;
  groupTitle?: string;
  groupColor?: string;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onMove: (id: string, to: number) => void;
  onRemove: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverRow: (index: number, after: boolean) => void;
}) {
  const title = tab.title || tab.url;
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tab.id);
        onDragStart(tab.id);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOverRow(index, e.clientY > r.top + r.height / 2);
      }}
      className={cn(
        'group/row relative flex items-center gap-3 border-t border-line px-3 py-2 transition-colors hover:bg-glow',
        dragging && 'opacity-40',
        dropBefore && 'shadow-[inset_0_2px_0_var(--ts-fg)]',
        dropAfter && 'shadow-[inset_0_-2px_0_var(--ts-fg)]',
      )}
    >
      <span className="cursor-grab text-faint active:cursor-grabbing" title="Drag to reorder" aria-hidden>
        <GripVertical size={15} />
      </span>
      <span className="w-5 shrink-0 text-right text-xs text-faint tabular-nums" aria-hidden>
        {index + 1}
      </span>
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2">
        <Favicon url={tab.url} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium">{title}</span>
          {tab.pinned && <Pin size={12} className="shrink-0 text-muted" aria-label="Pinned" />}
        </span>
        <span className="block truncate text-xs text-faint">{tab.url}</span>
      </span>
      {groupTitle !== undefined && (
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted sm:inline-flex">
          <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR_HEX[(groupColor as keyof typeof GROUP_COLOR_HEX) ?? 'grey'] ?? GROUP_COLOR_HEX.grey }} aria-hidden />
          {groupTitle || 'Untitled group'}
        </span>
      )}
      <span className="flex shrink-0 items-center">
        <IconButton size="sm" label={`Move ${title} up`} disabled={index === 0} onClick={() => onMove(tab.id, index - 1)}>
          <ArrowUp size={15} />
        </IconButton>
        <IconButton size="sm" label={`Move ${title} down`} disabled={index === count - 1} onClick={() => onMove(tab.id, index + 1)}>
          <ArrowDown size={15} />
        </IconButton>
        <IconButton size="sm" label={`Remove ${title} from saved tabs`} onClick={() => onRemove(tab.id)} data-remove-for={tab.id}>
          <X size={15} />
        </IconButton>
      </span>
    </li>
  );
});
