import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button, Checkbox, Field, IconButton, Input, Select, Textarea, useConfirm, useToast } from '@/components/ui';
import type { Priority, Task, Workspace } from '@/types/models';
import { deleteTask, newSubtask, toggleTaskDone, updateTask } from '@/features/tasks/actions';
import { subtaskProgress } from '@/features/tasks/buckets';
import { PRIORITY_LABEL } from './TaskRow';

/** Contextual details panel for one task. Mount with `key={task.id}` so drafts reset per task. */
export function TaskDetails({ task, workspaces, onClose, autoFocusTitle }: { task: Task; workspaces: Workspace[]; onClose: () => void; autoFocusTitle?: boolean }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [newSub, setNewSub] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const draft = useRef({ title, notes });
  draft.current = { title, notes };

  const save = (changes: Partial<Task>) => updateTask(task.id, changes).catch(() => toast('Could not save the task.', 'error'));

  // Flush unsaved text when the panel closes or switches task.
  useEffect(() => {
    if (autoFocusTitle) titleRef.current?.select();
    return () => {
      const d = draft.current;
      const changes: Partial<Task> = {};
      if (d.title.trim() && d.title.trim() !== task.title) changes.title = d.title.trim();
      if (d.notes !== (task.notes ?? '')) changes.notes = d.notes || undefined;
      if (Object.keys(changes).length) void updateTask(task.id, changes).catch(() => undefined);
    };
    // Only on mount/unmount for this task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const commitTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(task.title);
    if (t !== task.title) void save({ title: t });
  };
  const commitNotes = () => {
    if (notes !== (task.notes ?? '')) void save({ notes: notes || undefined });
  };
  const progress = subtaskProgress(task);
  const addSub = () => {
    const t = newSub.trim();
    if (!t) return;
    void save({ subtasks: [...task.subtasks, newSubtask(t)] });
    setNewSub('');
  };

  return (
    <aside className="ts-card flex flex-col gap-5 p-5 lg:sticky lg:top-4" aria-label="Task details">
      <div className="flex items-start gap-3">
        <Checkbox checked={task.done} onChange={() => void toggleTaskDone(task.id).catch(() => toast('Could not update the task.', 'error'))} label={task.done ? 'Mark as not done' : 'Mark as done'} className="mt-2.5 rounded-full!" />
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          aria-label="Task title"
          className="min-w-0 flex-1 rounded-lg bg-transparent px-1 py-1.5 text-lg font-semibold outline-none focus:bg-surface-2 focus-visible:ring-2 focus-visible:ring-fg/40"
        />
        <IconButton label="Close details" size="sm" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <Field label="Notes">
        {(id) => <Textarea id={id} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={commitNotes} placeholder="Add details…" />}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Due date">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={task.dueDate ?? ''}
              onChange={(e) => void save(e.target.value ? { dueDate: e.target.value, someday: false } : { dueDate: undefined, dueTime: undefined })}
            />
          )}
        </Field>
        <Field label="Time">
          {(id) => <Input id={id} type="time" value={task.dueTime ?? ''} disabled={!task.dueDate} onChange={(e) => void save({ dueTime: e.target.value || undefined })} />}
        </Field>
        <Field label="Priority">
          {(id) => (
            <Select id={id} value={task.priority} onChange={(e) => void save({ priority: e.target.value as Priority })}>
              {(['none', 'low', 'medium', 'high'] as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {p === 'none' ? 'None' : PRIORITY_LABEL[p].replace(' priority', '')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Workspace">
          {(id) => (
            <Select id={id} value={task.workspaceId ?? ''} onChange={(e) => void save({ workspaceId: e.target.value || undefined })}>
              <option value="">None</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-muted">
        <Checkbox size="sm" checked={!!task.someday} onChange={(v) => void save(v ? { someday: true, dueDate: undefined, dueTime: undefined } : { someday: false })} label="Someday" />
        Someday — park it for later
      </label>

      <section aria-label="Subtasks">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-muted">Subtasks</h3>
          {progress.total > 0 && (
            <span className="text-xs text-muted tabular-nums" aria-label={`${progress.done} of ${progress.total} subtasks done`}>
              {progress.done}/{progress.total}
            </span>
          )}
        </div>
        {progress.total > 0 && (
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <div className="h-full bg-fg/70 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        )}
        <ul className="flex flex-col gap-1">
          {task.subtasks.map((s) => (
            <li key={s.id} className="group flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-glow">
              <Checkbox size="sm" checked={s.done} label={`Subtask ${s.title}`} onChange={(v) => void save({ subtasks: task.subtasks.map((x) => (x.id === s.id ? { ...x, done: v } : x)) })} />
              <span className={`flex-1 text-sm ${s.done ? 'text-faint line-through' : ''}`}>{s.title}</span>
              <IconButton label={`Remove subtask ${s.title}`} size="sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => void save({ subtasks: task.subtasks.filter((x) => x.id !== s.id) })}>
                <X size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addSub();
          }}
        >
          <Input className="flex-1" value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Add a subtask…" aria-label="New subtask" />
          <IconButton type="submit" label="Add subtask" className="border border-line" disabled={!newSub.trim()}>
            <Plus size={16} />
          </IconButton>
        </form>
      </section>

      <div className="mt-auto flex justify-end border-t border-line pt-4">
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 size={14} />}
          onClick={async () => {
            if (await confirm({ title: 'Delete task?', message: `"${task.title}" will be permanently deleted.`, confirmLabel: 'Delete', danger: true })) {
              onClose();
              await deleteTask(task.id).catch(() => toast('Could not delete the task.', 'error'));
            }
          }}
        >
          Delete
        </Button>
      </div>
    </aside>
  );
}
