import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Plus, Search } from 'lucide-react';
import { PageHero } from '@/components/layout/PageHero';
import { Button, EmptyState, Input, Segmented, useToast } from '@/components/ui';
import { navigate, useRoute } from '@/app/router';
import { useStore } from '@/hooks/useStore';
import { useNow } from '@/hooks/useNow';
import { addDays, fromDateKey, toDateKey } from '@/utils/date';
import { dueLabel, filterTasks, tasksForView, upcomingGroups, viewCounts, type TaskView } from '@/features/tasks/buckets';
import { parseQuickAdd } from '@/features/tasks/quickAdd';
import { createTask } from '@/features/tasks/actions';
import { LoadMore, useIncremental } from '@/features/search/useIncremental';
import { TaskRow } from './TaskRow';
import { TaskDetails } from './TaskDetails';

const VIEWS: { value: TaskView; label: string }[] = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'someday', label: 'Someday' },
  { value: 'completed', label: 'Completed' },
];

const EMPTY: Record<TaskView, { title: string; description: string }> = {
  inbox: { title: 'Your inbox is clear', description: 'Add a task above — try “Push Tabspace to GitHub tomorrow !high”.' },
  today: { title: 'Nothing due today', description: 'Tasks due today or overdue show up here.' },
  upcoming: { title: 'Nothing scheduled', description: 'Tasks with a future due date show up here, grouped by day.' },
  someday: { title: 'No someday tasks', description: 'Park ideas here with “someday” at the end of a quick add.' },
  completed: { title: 'No completed tasks yet', description: 'Finished tasks are kept here.' },
};

export default function TasksPage() {
  const [tasks] = useStore('ts.tasks');
  const [workspaces] = useStore('ts.workspaces');
  const { params } = useRoute();
  const toast = useToast();
  const now = useNow(60_000);
  const today = toDateKey(now);
  const [view, setView] = useState<TaskView>('inbox');
  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState('');
  const [justCreated, setJustCreated] = useState<string | null>(null);

  const selectedId = params.get('id');
  const selected = selectedId ? tasks.find((t) => t.id === selectedId) : undefined;
  const counts = useMemo(() => viewCounts(tasks, today), [tasks, today]);
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(() => filterTasks(tasksForView(view, tasks, today), deferredQuery), [view, tasks, today, deferredQuery]);
  const shown = useIncremental(visible, `${view}|${deferredQuery}`);
  const groups = useMemo(() => (view === 'upcoming' ? upcomingGroups(shown.visible, today) : null), [view, shown.visible, today]);

  const select = useCallback((id: string) => navigate('tasks', { id }), []);
  const close = useCallback(() => navigate('tasks'), []);

  const viewDefaults = () => {
    if (view === 'today') return { dueDate: today };
    if (view === 'upcoming') return { dueDate: toDateKey(addDays(fromDateKey(today), 1)) };
    if (view === 'someday') return { someday: true };
    return {};
  };

  /** Mirrors the input synchronously so a double submit in one tick can't send the same draft twice. */
  const draftRef = useRef('');
  const setDraftText = (v: string) => {
    draftRef.current = v;
    setQuick(v);
  };
  const submitDraft = async () => {
    const text = draftRef.current;
    const parsed = parseQuickAdd(text);
    if (!parsed) return;
    // Read + clear synchronously: a second submit of the same draft sees an empty box.
    setDraftText('');
    const defaults = parsed.dueDate || parsed.someday ? {} : viewDefaults();
    try {
      await createTask({ ...defaults, ...parsed });
      if (view === 'completed') setView('inbox');
    } catch {
      if (!draftRef.current) setDraftText(text);
      toast('Could not add the task.', 'error');
    }
  };

  const newTask = async () => {
    try {
      const t = await createTask({ title: 'New task', ...viewDefaults() });
      if (view === 'completed') setView('inbox');
      setJustCreated(t.id);
      select(t.id);
    } catch {
      toast('Could not create a task.', 'error');
    }
  };

  return (
    <div>
      <PageHero
        title="Tasks"
        subtitle="Capture it. Then get it done."
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => void newTask()}>
            New Task
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Task lists" value={view} onChange={setView} options={VIEWS.map((v) => ({ ...v, count: counts[v.value] }))} />
        <Input icon={<Search size={16} />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" className="w-64 max-sm:w-full" />
      </div>

      <div className={selected ? 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]' : ''}>
        <section className="ts-card p-3" aria-label={`${VIEWS.find((v) => v.value === view)!.label} tasks`}>
          {view !== 'completed' && (
            <form
              className="mb-2 flex items-center gap-2 border-b border-line px-1 pb-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitDraft();
              }}
            >
              <Plus size={18} className="ml-2 shrink-0 text-faint" aria-hidden />
              <input
                value={quick}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder="Add a task… (try “tomorrow”, “someday” or “!high” at the end)"
                aria-label="Quick add task"
                className="h-10 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-faint rounded-md focus-visible:ring-2 focus-visible:ring-fg/40"
              />
              {quick.trim() && (
                <Button type="submit" size="sm" variant="secondary">
                  Add
                </Button>
              )}
            </form>
          )}

          {visible.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={28} />}
              title={query ? 'No matching tasks' : EMPTY[view].title}
              description={query ? `Nothing matches “${query}”.` : EMPTY[view].description}
            />
          ) : groups ? (
            <div className="flex flex-col gap-4">
              {groups.map((g) => (
                <div key={g.date}>
                  <h3 className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-muted uppercase">{dueLabel(g.date, today)}</h3>
                  <ul className="flex flex-col">
                    {g.tasks.map((t) => (
                      <TaskRow key={t.id} task={t} today={today} selected={t.id === selectedId} onSelect={select} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <ul className="flex flex-col">
              {shown.visible.map((t) => (
                <TaskRow key={t.id} task={t} today={today} selected={t.id === selectedId} onSelect={select} />
              ))}
            </ul>
          )}
          <LoadMore hasMore={shown.hasMore} remaining={shown.remaining} onMore={shown.more} label="tasks" />
        </section>

        {selected && <TaskDetails key={selected.id} task={selected} workspaces={workspaces} onClose={close} autoFocusTitle={justCreated === selected.id} />}
      </div>
    </div>
  );
}
