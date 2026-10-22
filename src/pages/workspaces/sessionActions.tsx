import { useCallback } from 'react';
import { ChevronDown, ExternalLink, Layers, PanelTop, Replace } from 'lucide-react';
import { Button, Menu, useConfirm, useToast } from '@/components/ui';
import { openWorkspace, restoreSession, type OpenMode, type RestoreMode, type RestoreResult } from '@/services/sessions';

export function describeRestore(r: RestoreResult): string {
  if (r.mode === 'group') {
    const t = `“${r.groupTitle ?? 'workspace'}”`;
    const head = r.focusedExisting
      ? r.opened
        ? `Focused ${t} · added ${r.opened} missing tab${r.opened === 1 ? '' : 's'}`
        : `${t} is already open — switched to it`
      : `Opened ${r.opened} tab${r.opened === 1 ? '' : 's'} as the ${t} tab group${r.alreadyOpen ? ` (reused ${r.alreadyOpen} open tab${r.alreadyOpen === 1 ? '' : 's'})` : ''}`;
    return [head, ...(r.skipped ? [`${r.skipped} skipped (not web pages)`] : [])].join(' · ');
  }
  const parts = [`Opened ${r.opened} tab${r.opened === 1 ? '' : 's'}`];
  if (r.groups) parts[0] += ` in ${r.groups} group${r.groups === 1 ? '' : 's'}`;
  if (r.skipped) parts.push(`${r.skipped} skipped (not web pages)`);
  if (r.archivedSessionId) parts.push('previous tabs archived in Saved sessions');
  if (r.kept) parts.push(`Kept ${r.kept} tab${r.kept === 1 ? '' : 's'} that can’t be saved`);
  return parts.join(' · ');
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

/** Opens/restores currently running on this page (shared by every card and button). */
const inFlight = new Set<string>();

/** Restore helpers with the "replace" confirmation and toasts built in. */
export function useRestore() {
  const confirm = useConfirm();
  const toast = useToast();

  const confirmReplace = useCallback(
    () =>
      confirm({
        title: 'Replace current tabs?',
        message: (
          <>
            Your current window’s tabs will first be saved as an <strong className="text-fg">archived session</strong> (“Archived &lt;date&gt;”), then closed and
            replaced. Nothing is lost — you can restore them any time from Saved sessions. Tabs that can’t be saved (like chrome:// pages) and the Tabspace tab stay open.
          </>
        ),
        confirmLabel: 'Archive & replace',
      }),
    [confirm],
  );

  const run = useCallback(
    async (key: string, fn: () => Promise<RestoreResult>, mode: OpenMode) => {
      // Ignore repeat clicks (double-click) while the same open/restore is still running.
      if (inFlight.has(key)) return;
      inFlight.add(key);
      try {
        if (mode === 'replace' && !(await confirmReplace())) return;
        toast(describeRestore(await fn()));
      } catch (e) {
        toast(errorMessage(e), 'error');
      } finally {
        inFlight.delete(key);
      }
    },
    [confirmReplace, toast],
  );

  return {
    restore: (sessionId: string, mode: RestoreMode) => run(`s:${sessionId}`, () => restoreSession(sessionId, mode), mode),
    open: (workspaceId: string, mode: OpenMode) => run(`w:${workspaceId}`, () => openWorkspace(workspaceId, mode), mode),
  };
}

/** "Open" button plus a small dropdown choosing the restore mode. */
export function OpenSplitButton<M extends OpenMode = RestoreMode>({
  label = 'Open',
  onOpen,
  disabled,
  size = 'sm',
  name,
  groupDefault,
}: {
  label?: string;
  onOpen: (mode: M) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  name: string;
  /** Workspaces with tab groups on: the main action opens the workspace as its own native tab group. */
  groupDefault?: boolean;
}) {
  const open = (m: OpenMode) => onOpen(m as M);
  return (
    <div className="inline-flex items-center gap-0.5">
      <Button
        size={size}
        variant="secondary"
        icon={groupDefault ? <Layers size={14} /> : <ExternalLink size={14} />}
        onClick={() => open(groupDefault ? 'group' : 'new-window')}
        disabled={disabled}
        aria-label={groupDefault ? `${label} ${name} as a tab group` : `${label} ${name} in a new window`}
      >
        {label}
      </Button>
      {!disabled && (
        <Menu
          label={`More ways to open ${name}`}
          trigger={<ChevronDown size={15} />}
          items={[
            ...(groupDefault ? [{ label: 'Open as tab group', icon: <Layers size={14} />, onSelect: () => open('group') }] : []),
            { label: 'New window', icon: <ExternalLink size={14} />, onSelect: () => open('new-window') },
            { label: 'Add to this window', icon: <PanelTop size={14} />, onSelect: () => open('current-window') },
            { label: 'Replace current tabs…', icon: <Replace size={14} />, onSelect: () => open('replace') },
          ]}
        />
      )}
    </div>
  );
}
