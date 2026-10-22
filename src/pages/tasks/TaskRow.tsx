import { memo } from 'react';
import { CalendarClock, CalendarPlus, Clock, Edit3, Moon, MoreHorizontal, Trash2 } from 'lucide-react';
import { Checkbox, Menu, useConfirm, useToast } from '@/components/ui';
import type { Priority, Task } from '@/types/models';
import { cn } from '@/utils/cn';
import { addDays, fromDateKey, toDateKey } from '@/utils/date';
import { dueLabel, isOverdue } from '@/features/tasks/buckets';
import { deleteTask, moveToSomeday, setDue, toggleTaskDone } from '@/features/tasks/actions';

export const PRIORITY_LABEL: Record<Priority, string> = { none: 'No priority', low: 'Low priority', medium: 'Medium priority', high: 'High priority' };
const PRIORITY_DOT: Record<Exclude<Priority, 'none'>, string> = { high: 'bg-fg', medium: 'bg-muted', low: 'border border-muted' };

export function PriorityDot({ priority }: { priority: Priority }) {
  if (priority === 'none') return null;
  return (
    <span title={PRIORITY_LABEL[priority]} className="inline-flex shrink-0 items-center">
      <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', PRIORITY_DOT[priority])} />
      <span className="sr-only">{PRIORITY_LABEL[priority]}</span>
    </span>
  );
}

export function DueChip({ task, today }: { task: Task; today: string }) {
  if (!task.dueDate) return null;
  const overdue = isOverdue(task, today);
  const time = task.dueTime ? ` · ${formatTime(task.dueTime)}` : '';
  return (
    <span className={cn('shrink-0 text-xs tabular-nums', overdue ? 'text-danger' : 'text-muted')}>
      {overdue && <span className="sr-only">Overdue: </span>}
      {dueLabel(task.dueDate, today)}
      {time}
    </span>
  );
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export const TaskRow = memo(function TaskRow({ task, today, selected, onSelect }: { task: Task; today: string; selected?: boolean; onSelect: (id: string) => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const run = (p: Promise<unknown>) => p.catch(() => toast('Could not update the task.', 'error'));
  return (
    <li
      className={cn(
        'group flex items-center gap-3 rounded-[var(--radius-ctl)] border px-3 py-2.5 transition-colors',
        selected ? 'ts-active' : 'border-transparent hover:bg-glow',
      )}
    >
      <Checkbox
        checked={task.done}
        onChange={() => void run(toggleTaskDone(task.id))}
        label={task.done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        className="rounded-full!"
      />
      <button type="button" onClick={() => onSelect(task.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Open task ${task.title}`}>
        <span className={cn('min-w-0 flex-1 truncate text-sm', task.done && 'text-faint line-through')}>{task.title || 'Untitled task'}</span>
        {!task.done && <DueChip task={task} today={today} />}
        <PriorityDot priority={task.priority} />
      </button>
      <span className="opacity-60 group-hover:opacity-100 group-focus-within:opacity-100">
        <Menu
          label={`Actions for ${task.title}`}
          trigger={<MoreHorizontal size={16} />}
          items={[
            { label: 'Edit', icon: <Edit3 size={14} />, onSelect: () => onSelect(task.id) },
            { label: 'Due today', icon: <Clock size={14} />, onSelect: () => void run(setDue(task.id, today)), disabled: task.dueDate === today },
            { label: 'Due tomorrow', icon: <CalendarPlus size={14} />, onSelect: () => void run(setDue(task.id, toDateKey(addDays(fromDateKey(today), 1)))) },
            { label: 'Move to Someday', icon: <Moon size={14} />, onSelect: () => void run(moveToSomeday(task.id)), disabled: !!task.someday || task.done },
            { label: 'Clear due date', icon: <CalendarClock size={14} />, onSelect: () => void run(setDue(task.id, undefined)), disabled: !task.dueDate },
            {
              label: 'Delete',
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: async () => {
                if (await confirm({ title: 'Delete task?', message: `"${task.title}" will be permanently deleted.`, confirmLabel: 'Delete', danger: true })) void run(deleteTask(task.id));
              },
            },
          ]}
        />
      </span>
    </li>
  );
});
