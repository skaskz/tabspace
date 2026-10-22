import { useCallback, useEffect, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Crosshair } from 'lucide-react';
import { Button, IconButton, Modal, Toggle, useToast } from '@/components/ui';
import { useStore } from '@/hooks/useStore';
import { update } from '@/storage/store';
import type { GroupColor, Settings } from '@/types/models';
import { hasTabGroupsApi, subscribeTabChanges } from '@/services/tabs';
import { focusWorkspaceGroup, getLiveWorkspaceGroups, setWorkspaceGroupCollapsed, setWorkspaceGroupColor, type LiveWorkspaceGroup } from '@/services/workspaceGroups';
import { pickGroupColor } from '@/features/workspaces/groups';
import { ColorPicker } from '@/pages/tabs/TabModals';
import { GroupDot } from '@/pages/tabs/TabRow';
import { errorMessage } from './sessionActions';

/** workspaceId -> its open native group, kept live from Chrome tab/group events. */
export function useLiveWorkspaceGroups(): Map<string, LiveWorkspaceGroup> {
  const [links] = useStore('ts.workspaceGroupLinks');
  const [live, setLive] = useState<Map<string, LiveWorkspaceGroup>>(() => new Map());
  const refresh = useCallback(() => {
    if (!hasTabGroupsApi()) return;
    void getLiveWorkspaceGroups()
      .then(setLive)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh, links]);
  useEffect(() => subscribeTabChanges(refresh, 250), [refresh]);
  return live;
}

/** "Open · 5 tabs" indicator with Focus and Collapse/Expand for a workspace whose group is open. */
export function LiveGroupChip({ workspaceId, name, live, color }: { workspaceId: string; name: string; live: LiveWorkspaceGroup; color: GroupColor }) {
  const toast = useToast();
  const act = (fn: () => Promise<void>) => void fn().catch((e) => toast(errorMessage(e), 'error'));
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pr-1 pl-2.5 text-xs text-muted" role="group" aria-label={`${name} tab group is open`}>
      <GroupDot color={color} />
      <span className="ml-1">
        Open · {live.tabCount} tab{live.tabCount === 1 ? '' : 's'}
      </span>
      <IconButton size="sm" label={`Focus the ${name} tab group`} onClick={() => act(() => focusWorkspaceGroup(workspaceId))}>
        <Crosshair size={14} />
      </IconButton>
      <IconButton size="sm" label={live.collapsed ? `Expand the ${name} tab group` : `Collapse the ${name} tab group`} onClick={() => act(() => setWorkspaceGroupCollapsed(workspaceId, !live.collapsed))}>
        {live.collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
      </IconButton>
    </span>
  );
}

/** The workspace's tab-group colour (stored link colour, or the stable default). */
export function useWorkspaceGroupColor(workspaceId: string): GroupColor {
  const [links] = useStore('ts.workspaceGroupLinks');
  return pickGroupColor(workspaceId, links);
}

export function GroupColorModal({ workspaceId, name, onClose }: { workspaceId: string | null; name: string; onClose: () => void }) {
  const toast = useToast();
  const [links] = useStore('ts.workspaceGroupLinks');
  const [color, setColor] = useState<GroupColor>('blue');
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (workspaceId !== shownFor) {
    setShownFor(workspaceId);
    if (workspaceId) setColor(pickGroupColor(workspaceId, links));
  }
  const save = async () => {
    if (!workspaceId) return;
    try {
      await setWorkspaceGroupColor(workspaceId, color);
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Modal
      open={!!workspaceId}
      onClose={onClose}
      title={`Tab group colour — ${name}`}
      width={400}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-muted">Used for this workspace’s Chrome tab group. An open group changes colour right away.</p>
      <ColorPicker value={color} onChange={setColor} />
    </Modal>
  );
}

const ROWS: { key: keyof Settings['workspaceGroups']; label: string; hint: string }[] = [
  { key: 'enabled', label: 'Open workspaces as tab groups', hint: 'Each workspace opens as its own named, collapsible Chrome tab group in the current window. Reopening an open workspace switches to it instead of duplicating tabs.' },
  { key: 'collapseOthers', label: 'Collapse other workspace groups when switching', hint: 'Only Tabspace workspace groups are collapsed — never your own groups.' },
  { key: 'syncMembership', label: 'Keep groups and saved tabs in sync', hint: 'Moving a tab into or out of a workspace group adds or removes it from that workspace’s saved tabs. Closing tabs never removes saved tabs, and tabs removed by dragging them out can be restored for 7 days from the workspace’s page.' },
];

export function GroupSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settings] = useStore('ts.settings');
  const toast = useToast();
  const set = (key: keyof Settings['workspaceGroups'], value: boolean) =>
    void update('ts.settings', (s) => ({ ...s, workspaceGroups: { ...s.workspaceGroups, [key]: value } })).catch((e) => toast(errorMessage(e), 'error'));
  return (
    <Modal open={open} onClose={onClose} title="Workspace tab groups" width={480}>
      <ul className="flex flex-col gap-4">
        {ROWS.map((r) => {
          const disabled = r.key !== 'enabled' && !settings.workspaceGroups.enabled;
          return (
            <li key={r.key} className="flex items-start justify-between gap-4">
              <span className={disabled ? 'opacity-60' : undefined}>
                <span className="block text-sm font-medium">{r.label}</span>
                <span className="block text-xs text-muted">{r.hint}</span>
              </span>
              <Toggle checked={settings.workspaceGroups[r.key]} onChange={(v) => set(r.key, v)} label={r.label} disabled={disabled} />
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
