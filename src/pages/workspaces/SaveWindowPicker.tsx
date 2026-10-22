import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Favicon, Modal, Segmented, useToast } from '@/components/ui';
import { useStore } from '@/hooks/useStore';
import { isRestorableUrl } from '@/utils/url';
import { tabUrl } from '@/features/tabs/serialize';
import { latestSession } from '@/features/workspaces/model';
import { getOwnTabId, getTargetWindow, type WindowInfo } from '@/services/tabs';
import { saveSelectionToWorkspace, type SaveSelectionMode } from '@/services/sessions';
import { GroupDot } from '@/pages/tabs/TabRow';
import { errorMessage } from './sessionActions';

/**
 * "Save current window" picker: lists every tab of the window holding this
 * Tabspace page (grouped like Chrome), lets the user choose which to save, and
 * — when the workspace already has saved tabs — whether to replace or add.
 */
export function SaveWindowPicker({ workspaceId, onClose }: { workspaceId: string | null; onClose: () => void }) {
  const open = !!workspaceId;
  const toast = useToast();
  const [workspaces] = useStore('ts.workspaces');
  const [sessions] = useStore('ts.sessions');
  const ws = workspaces.find((w) => w.id === workspaceId);
  const existing = workspaceId ? latestSession(sessions, workspaceId) : undefined;
  const hasSaved = !!existing?.tabs.length;

  const [win, setWin] = useState<WindowInfo | null>(null);
  const [ownId, setOwnId] = useState<number | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [mode, setMode] = useState<SaveSelectionMode>('merge');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setWin(null);
    setLoadError(null);
    setMode('merge');
    void (async () => {
      try {
        const [w, own] = await Promise.all([getTargetWindow(), getOwnTabId()]);
        if (!alive) return;
        setWin(w);
        setOwnId(own);
        setSelected(new Set(w.tabs.filter((t) => t.id !== undefined && t.id !== own && isRestorableUrl(tabUrl(t))).map((t) => t.id!)));
      } catch (e) {
        if (alive) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  // The tabs load after the dialog opens, so move initial focus to the first enabled checkbox once they're in.
  useEffect(() => {
    if (win) listRef.current?.querySelector<HTMLElement>('[role="checkbox"]:not([disabled])')?.focus();
  }, [win]);

  const tabs = useMemo(() => (win?.tabs ?? []).filter((t) => t.id !== undefined && t.id !== ownId), [win, ownId]);
  const saveable = useMemo(() => tabs.filter((t) => isRestorableUrl(tabUrl(t))).map((t) => t.id!), [tabs]);
  const groups = useMemo(() => new Map((win?.groups ?? []).map((g) => [g.id, g])), [win]);
  const count = saveable.filter((id) => selected.has(id)).length;

  const toggle = (ids: number[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  const save = async () => {
    if (!workspaceId || !win || busy) return;
    setBusy(true);
    try {
      const chosen = tabs.filter((t) => selected.has(t.id!));
      const r = await saveSelectionToWorkspace(workspaceId, chosen, win.groups, hasSaved ? mode : 'replace');
      const parts = [hasSaved && mode === 'merge' ? `Added ${r.saved} tab${r.saved === 1 ? '' : 's'} to ${ws?.name ?? 'the workspace'}` : `Saved ${r.saved} tab${r.saved === 1 ? '' : 's'} to ${ws?.name ?? 'the workspace'}`];
      if (r.duplicates) parts.push(`${r.duplicates} already saved`);
      if (r.historyId) parts.push('previous list kept in History');
      toast(parts.join(' · '));
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  // Rows in window order with a header whenever a native group starts.
  const rows: ({ kind: 'group'; id: number } | { kind: 'tab'; tab: chrome.tabs.Tab })[] = [];
  let lastGroup = -1;
  for (const t of tabs) {
    const g = t.groupId ?? -1;
    if (g !== -1 && g !== lastGroup) rows.push({ kind: 'group', id: g });
    lastGroup = g;
    rows.push({ kind: 'tab', tab: t });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={hasSaved ? `Update “${ws?.name ?? ''}” from this window` : `Save tabs to “${ws?.name ?? ''}”`}
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!win || count === 0 || busy}>
            Save {count} tab{count === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {loadError ? (
        <p role="alert" className="text-sm text-danger">
          {loadError}
        </p>
      ) : !win ? (
        <p role="status" className="text-sm text-muted">
          Reading this window’s tabs…
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {hasSaved && (
            <div className="flex flex-col gap-1.5">
              <Segmented
                label="How to save"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'merge', label: 'Add to saved tabs' },
                  { value: 'replace', label: 'Replace saved tabs' },
                ]}
              />
              <p className="text-xs text-muted">
                {mode === 'merge'
                  ? `Selected tabs are added after the ${existing!.tabs.length} saved tab${existing!.tabs.length === 1 ? '' : 's'}; ones already saved are skipped.`
                  : 'The saved tabs become exactly your selection. The previous list is kept in History, so nothing is lost.'}
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-muted">
              {count} of {saveable.length} selected
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => toggle(saveable, true)}>
                Select all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => toggle(saveable, false)}>
                Select none
              </Button>
            </span>
          </div>
          <ul ref={listRef} className="flex flex-col" aria-label="Tabs in this window">
            {rows.map((r) => {
              if (r.kind === 'group') {
                const g = groups.get(r.id);
                const ids = tabs.filter((t) => t.groupId === r.id && saveable.includes(t.id!)).map((t) => t.id!);
                const all = ids.length > 0 && ids.every((id) => selected.has(id));
                return (
                  <li key={`g${r.id}`} className="mt-2 flex items-center gap-2.5 px-2 py-1.5 text-[13px] font-semibold">
                    <Checkbox checked={all} onChange={(v) => toggle(ids, v)} label={`Select group ${g?.title || 'Untitled group'}`} size="sm" />
                    <GroupDot color={g?.color ?? 'grey'} />
                    {g?.title || 'Untitled group'}
                  </li>
                );
              }
              const t = r.tab;
              const url = tabUrl(t);
              const ok = isRestorableUrl(url);
              const title = t.title || url;
              return (
                <li key={t.id} className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${t.groupId !== undefined && t.groupId !== -1 ? 'pl-7' : ''} ${ok ? 'hover:bg-glow' : 'text-faint'}`}>
                  {ok ? (
                    <Checkbox checked={selected.has(t.id!)} onChange={(v) => toggle([t.id!], v)} label={`Save ${title}`} size="sm" />
                  ) : (
                    <span className="inline-block h-4 w-4 shrink-0 rounded-md border border-dashed border-line" aria-hidden />
                  )}
                  <Favicon url={url} size={15} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{title}</span>
                    <span className="block truncate text-xs text-faint">{ok ? url : `${url} — can’t be saved (not a web page)`}</span>
                  </span>
                  {t.pinned && <span className="text-[11px] text-muted">Pinned</span>}
                </li>
              );
            })}
            {rows.length === 0 && <li className="px-2 py-4 text-sm text-muted">This window has no other tabs.</li>}
          </ul>
        </div>
      )}
    </Modal>
  );
}
