import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Field, Input, Modal, Segmented, Select, useToast } from '@/components/ui';
import type { GroupColor, Workspace } from '@/types/models';
import { cn } from '@/utils/cn';
import { GROUP_COLORS, GROUP_COLOR_HEX } from '@/features/tabs/serialize';
import { errorMessage } from '@/pages/workspaces/sessionActions';
import { GroupDot } from './TabRow';

export function ColorPicker({ value, onChange }: { value: GroupColor; onChange: (c: GroupColor) => void }) {
  return (
    <div role="radiogroup" aria-label="Group colour" className="flex flex-wrap gap-2">
      {GROUP_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          title={c}
          onClick={() => onChange(c)}
          className={cn('inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors', value === c ? 'border-fg' : 'border-line hover:border-line-strong')}
        >
          <span className="h-4 w-4 rounded-full" style={{ background: GROUP_COLOR_HEX[c] }} />
        </button>
      ))}
    </div>
  );
}

/** Create a group from tabs, or rename / recolour an existing one. */
export function GroupModal({
  open,
  title: heading,
  initial,
  submitLabel,
  note,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial: { title: string; color: GroupColor };
  submitLabel: string;
  note?: string;
  onClose: () => void;
  onSubmit: (v: { title: string; color: GroupColor }) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial.title);
  const [color, setColor] = useState<GroupColor>(initial.color);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(initial.title);
      setColor(initial.color);
    }
  }
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit({ title: name.trim(), color });
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={heading}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <Field label="Group name" hint="Shown on the tab group in Chrome. Can be empty.">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Research" maxLength={60} data-autofocus />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-muted">Colour</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        {note && <p className="text-xs text-faint">{note}</p>}
      </form>
    </Modal>
  );
}

export type SaveMode = 'new' | 'append';

/** Save tabs to a workspace: as a new session, or appended to the workspace's latest session. */
export function SaveToWorkspaceModal({
  open,
  count,
  workspaces,
  defaultMode = 'new',
  onClose,
  onSubmit,
}: {
  open: boolean;
  count: number;
  workspaces: Workspace[];
  defaultMode?: SaveMode;
  onClose: () => void;
  onSubmit: (v: { workspaceId?: string; name: string; mode: SaveMode }) => Promise<void>;
}) {
  const toast = useToast();
  const [workspaceId, setWorkspaceId] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<SaveMode>(defaultMode);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName('');
      setMode(defaultMode);
      setWorkspaceId((cur) => (cur && workspaces.some((w) => w.id === cur) ? cur : (workspaces[0]?.id ?? '')));
    }
  }
  const append = mode === 'append' && !!workspaceId;
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit({ workspaceId: workspaceId || undefined, name, mode: append ? 'append' : 'new' });
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save to workspace"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || count === 0}>
            Save {count} tab{count === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <Field label="Workspace">
          {(id) => (
            <Select id={id} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className="w-full" data-autofocus>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
              <option value="">No workspace (unassigned session)</option>
            </Select>
          )}
        </Field>
        {workspaceId && (
          <Segmented
            label="How to save"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'new', label: 'New session' },
              { value: 'append', label: 'Add to latest session' },
            ]}
          />
        )}
        {!append && <Field label="Session name (optional)">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to workspace + date" maxLength={120} />}</Field>}
        <p className="text-xs text-faint">Only web pages are saved; chrome://, file:// and extension pages are skipped. Your tabs stay open.</p>
      </form>
    </Modal>
  );
}

/** Pick one of the window's groups (or start a new one). */
export function MoveToGroupModal({
  open,
  groups,
  onClose,
  onPick,
  onNewGroup,
}: {
  open: boolean;
  groups: chrome.tabGroups.TabGroup[];
  onClose: () => void;
  onPick: (groupId: number) => void;
  onNewGroup: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Move to group" width={400}>
      <ul className="flex flex-col gap-1">
        {groups.map((g) => (
          <li key={g.id}>
            <button type="button" onClick={() => onPick(g.id)} className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm hover:border-line hover:bg-glow">
              <GroupDot color={g.color} />
              {g.title || 'Untitled group'}
            </button>
          </li>
        ))}
        <li>
          <button type="button" onClick={onNewGroup} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-muted hover:bg-glow hover:text-fg">
            <Plus size={15} /> New group…
          </button>
        </li>
      </ul>
    </Modal>
  );
}
