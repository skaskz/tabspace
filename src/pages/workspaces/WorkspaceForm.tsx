import { useState } from 'react';
import { Button, Field, Input, Modal, Textarea, useToast } from '@/components/ui';
import type { Workspace } from '@/types/models';
import { cn } from '@/utils/cn';
import { DEFAULT_WORKSPACE_ICON, WORKSPACE_ICONS, WORKSPACE_ICON_KEYS, WorkspaceIcon, normalizeIconKey } from '@/features/workspaces/icons';
import { WORKSPACE_TEMPLATES } from '@/features/workspaces/model';
import { createWorkspace, updateWorkspace } from '@/features/workspaces/actions';
import { errorMessage } from './sessionActions';

/** Create / edit workspace modal. `workspace` undefined = create. */
export function WorkspaceFormModal({ open, workspace, onClose, onCreated }: { open: boolean; workspace?: Workspace; onClose: () => void; onCreated?: (w: Workspace) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(DEFAULT_WORKSPACE_ICON);
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = open ? (workspace?.id ?? 'new') : null;
  if (key !== lastKey) {
    setLastKey(key);
    setName(workspace?.name ?? '');
    setIcon(normalizeIconKey(workspace?.icon) || DEFAULT_WORKSPACE_ICON);
    setDescription(workspace?.description ?? '');
    setTemplate(null);
  }

  const pickTemplate = (id: string) => {
    const t = WORKSPACE_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setTemplate(id);
    setName(t.name);
    setIcon(t.icon);
    setDescription(t.description);
  };

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (workspace) await updateWorkspace(workspace.id, { name, icon, description: description.trim() || undefined });
      else {
        // Note: `onCreated?.(await …)` would skip the create entirely when onCreated is undefined.
        const created = await createWorkspace({ name, icon, description });
        onCreated?.(created);
      }
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
      title={workspace ? 'Edit workspace' : 'New workspace'}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!name.trim() || busy}>
            {workspace ? 'Save' : 'Create workspace'}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => (e.preventDefault(), void save())}>
        {!workspace && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted" id="ws-template-label">
              Start from a template (optional)
            </span>
            <div role="group" aria-labelledby="ws-template-label" className="flex flex-wrap gap-1.5">
              {WORKSPACE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={template === t.id}
                  onClick={() => pickTemplate(t.id)}
                  className={cn('inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-ctl)] border px-3 text-[13px] transition-colors', template === t.id ? 'ts-active text-fg' : 'border-line text-muted hover:border-line-strong hover:text-fg')}
                >
                  <WorkspaceIcon icon={t.icon} size={14} />
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Development" maxLength={60} data-autofocus />}</Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-muted" id="ws-icon-label">
            Icon
          </span>
          <div role="radiogroup" aria-labelledby="ws-icon-label" className="grid grid-cols-9 gap-1.5">
            {WORKSPACE_ICON_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={icon === k}
                aria-label={WORKSPACE_ICONS[k].label}
                title={WORKSPACE_ICONS[k].label}
                onClick={() => setIcon(k)}
                className={cn('inline-flex h-10 items-center justify-center rounded-[var(--radius-ctl)] border transition-colors', icon === k ? 'ts-active text-fg' : 'border-line text-muted hover:border-line-strong hover:text-fg')}
              >
                <WorkspaceIcon icon={k} size={17} />
              </button>
            ))}
          </div>
        </div>
        <Field label="Description (optional)">{(id) => <Textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />}</Field>
      </form>
    </Modal>
  );
}
