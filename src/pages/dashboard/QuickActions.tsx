import { useRef, useState, type ReactNode } from 'react';
import { CheckSquare, FilePlus2, FolderOpen, Save } from 'lucide-react';
import { Button, EmptyState, Field, Input, Modal, Select, useToast } from '@/components/ui';
import { navigate } from '@/app/router';
import { useStore } from '@/hooks/useStore';
import { openWorkspace, saveCurrentWindow } from '@/services/sessions';
import { createWorkspace } from '@/features/workspaces/actions';
import { WorkspaceIconTile } from '@/features/workspaces/icons';
import { createNote } from '@/features/notes/actions';
import { createTask } from '@/features/tasks/actions';
import { parseQuickAdd } from '@/features/tasks/quickAdd';
import { toDateKey } from '@/utils/date';
import { latestSession, plural } from './dashboardLogic';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message && e.message !== 'Not implemented' ? e.message : fallback;
}

function ActionCard({ icon, title, hint, onClick }: { icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ts-card ts-hover ts-lift flex items-center gap-3.5 p-4 text-left">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-3 text-fg" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}

/** Row of four quick actions. `onAddTask` focuses the dashboard's inline task input when it is visible. */
export function QuickActions({ onAddTask }: { onAddTask: () => boolean }) {
  const toast = useToast();
  const [workspaces] = useStore('ts.workspaces');
  const [sessions] = useStore('ts.sessions');
  const [dialog, setDialog] = useState<null | 'open' | 'save' | 'task'>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const [newName, setNewName] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const sorted = [...workspaces].sort((a, b) => a.order - b.order);

  const doOpen = async (id: string) => {
    setBusy(true);
    try {
      const res = await openWorkspace(id);
      setDialog(null);
      toast(res && typeof res === 'object' && 'opened' in res ? `Opened ${plural(res.opened, 'tab')}.` : 'Workspace opened.');
    } catch (e) {
      toast(errorMessage(e, 'Could not open the workspace.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doSave = async () => {
    setBusy(true);
    try {
      let workspaceId = target;
      if (target === '__new') {
        if (!newName.trim()) {
          setBusy(false);
          return toast('Give the new workspace a name.', 'error');
        }
        workspaceId = (await createWorkspace({ name: newName })).id;
      }
      const session = await saveCurrentWindow({ workspaceId: workspaceId || undefined });
      if (!session) {
        toast('No web tabs to save in this window.', 'error');
      } else {
        toast(`Saved ${plural(session.tabs.length, 'tab')}.`);
        setDialog(null);
      }
    } catch (e) {
      toast(errorMessage(e, 'Could not save tabs. Saving works when Tabspace runs as a Chrome extension.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    try {
      const n = await createNote();
      navigate('notes', { id: n.id });
    } catch {
      toast('Could not create a note.', 'error');
    }
  };

  /** Mirrors the input synchronously so a double submit in one tick can't send the same draft twice. */
  const taskDraftRef = useRef('');
  const setTaskDraft = (v: string) => {
    taskDraftRef.current = v;
    setTaskTitle(v);
  };
  const submitTask = async () => {
    const text = taskDraftRef.current;
    const parsed = parseQuickAdd(text);
    if (!parsed) return;
    // Read + clear synchronously: a second submit of the same draft sees an empty box.
    setTaskDraft('');
    try {
      await createTask({ ...(parsed.dueDate || parsed.someday ? {} : { dueDate: toDateKey() }), ...parsed });
      setDialog(null);
      toast('Task added.');
    } catch {
      if (!taskDraftRef.current) setTaskDraft(text);
      toast('Could not add the task.', 'error');
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 min-[1440px]:grid-cols-4">
        <ActionCard icon={<FolderOpen size={20} />} title="Open Workspace" hint="Restore saved tabs" onClick={() => setDialog('open')} />
        <ActionCard
          icon={<Save size={20} />}
          title="Save Tabs"
          hint="Save this window"
          onClick={() => {
            setTarget(sorted[0]?.id ?? '__new');
            setNewName('');
            setDialog('save');
          }}
        />
        <ActionCard icon={<FilePlus2 size={20} />} title="Add Note" hint="Start writing" onClick={() => void addNote()} />
        <ActionCard
          icon={<CheckSquare size={20} />}
          title="Add Task"
          hint="Capture a to-do"
          onClick={() => {
            if (!onAddTask()) setDialog('task');
          }}
        />
      </div>

      <Modal open={dialog === 'open'} onClose={() => setDialog(null)} title="Open workspace">
        {sorted.length === 0 ? (
          <EmptyState
            title="No workspaces yet"
            description="Create a workspace and save tabs into it first."
            action={
              <Button size="sm" onClick={() => navigate('workspaces')}>
                Go to Workspaces
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {sorted.map((w) => {
              const n = latestSession(sessions, w.id)?.tabs.length ?? 0;
              return (
                <li key={w.id}>
                  <button type="button" disabled={busy} onClick={() => void doOpen(w.id)} className="ts-hover flex w-full items-center gap-3 rounded-[var(--radius-ctl)] border border-transparent p-2 text-left disabled:opacity-50">
                    <WorkspaceIconTile icon={w.icon} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{w.name}</span>
                      <span className="block text-xs text-muted">{n ? `${plural(n, 'saved tab')} · opens in a new window` : 'No saved tabs yet'}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

      <Modal
        open={dialog === 'save'}
        onClose={() => setDialog(null)}
        title="Save tabs"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void doSave()}>
              {busy ? 'Saving…' : 'Save window'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Saves every web tab in your current window (with tab groups) as a session.</p>
          <Field label="Workspace">
            {(id) => (
              <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)} className="w-full">
                {sorted.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
                <option value="__new">New workspace…</option>
                <option value="">No workspace</option>
              </Select>
            )}
          </Field>
          {target === '__new' && (
            <Field label="New workspace name">{(id) => <Input id={id} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Tabspace launch" maxLength={60} />}</Field>
          )}
        </div>
      </Modal>

      <Modal
        open={dialog === 'task'}
        onClose={() => setDialog(null)}
        title="Add task"
        width={420}
        footer={
          <Button variant="primary" disabled={!taskTitle.trim()} onClick={() => void submitTask()}>
            Add task
          </Button>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitTask();
          }}
        >
          <Input data-autofocus value={taskTitle} onChange={(e) => setTaskDraft(e.target.value)} placeholder="What needs doing? (due today)" aria-label="Task title" />
        </form>
      </Modal>
    </>
  );
}
