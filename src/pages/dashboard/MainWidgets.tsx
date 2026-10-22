import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, ChevronRight, Folder, LayoutGrid, Plus } from 'lucide-react';
import { Button, Card, CardHeader, Checkbox, EmptyState, Favicon, IconButton, useToast } from '@/components/ui';
import { openWorkspace } from '@/services/sessions';
import { useHubNav } from './hubNav';
import { useStore } from '@/hooks/useStore';
import { cn } from '@/utils/cn';
import { formatRelative, toDateKey } from '@/utils/date';
import { hostname, isSafeUrl } from '@/utils/url';
import { WorkspaceIconTile } from '@/features/workspaces/icons';
import { isOverdue, todayTasks } from '@/features/tasks/buckets';
import { createTask, toggleTaskDone } from '@/features/tasks/actions';
import { parseQuickAdd } from '@/features/tasks/quickAdd';
import { folderCounts, folderTree } from '@/features/bookmarks/bookmarks';
import { activateTab, hasTabsApi, ownExtensionPrefix, queryOpenTabs, recentTabs, type OpenTab } from '@/features/search/chromeTabs';
import { DueChip } from '@/pages/tasks/TaskRow';
import { plural, workspaceStats } from './dashboardLogic';

const viewAll = (label: string, onClick: () => void) => (
  <Button variant="ghost" size="sm" onClick={onClick} aria-label={label}>
    View All
  </Button>
);

/* ------------------------------------------------------------------ */

/**
 * Workspace overview. `launch` (New Tab) shows saved-tab counts and an "Open"
 * button that restores the workspace's latest session.
 */
export function WorkspacesCard({ launch = false, limit = 3 }: { launch?: boolean; limit?: number }) {
  const [workspaces] = useStore('ts.workspaces');
  const [sessions] = useStore('ts.sessions');
  const [tasks] = useStore('ts.tasks');
  const [notes] = useStore('ts.notes');
  const go = useHubNav();
  const toast = useToast();
  const [opening, setOpening] = useState<string | null>(null);
  const top = [...workspaces].sort((a, b) => a.order - b.order).slice(0, limit);
  const open = async (id: string) => {
    setOpening(id);
    try {
      const res = await openWorkspace(id);
      toast(`Opened ${plural(res.opened, 'tab')}${res.skipped ? ` · skipped ${res.skipped}` : ''}.`);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : 'Could not open the workspace.', 'error');
    } finally {
      setOpening(null);
    }
  };
  return (
    <Card>
      <CardHeader title="Workspaces" icon={<LayoutGrid size={16} />} action={viewAll('View all workspaces', () => go('workspaces'))} />
      {top.length === 0 ? (
        <EmptyState
          className="pt-2"
          title="No workspaces yet"
          description="Group the tabs, tasks and notes of one project together."
          action={
            <Button size="sm" icon={<Plus size={14} />} onClick={() => go('workspaces')}>
              Create a workspace
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 px-5 pb-5">
          {top.map((w) => {
            const s = workspaceStats(w, sessions, tasks, notes);
            if (launch)
              return (
                <li key={w.id} className="ts-lift flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface-2/60 p-3">
                  <button type="button" onClick={() => go('workspaces', { id: w.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Show workspace ${w.name}`}>
                    <WorkspaceIconTile icon={w.icon} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{w.name}</span>
                      <span className="block truncate text-xs text-muted">{s.tabs ? plural(s.tabs, 'saved tab') : 'No saved tabs yet'}</span>
                    </span>
                  </button>
                  <Button size="sm" disabled={!s.tabs || opening === w.id} onClick={() => void open(w.id)} aria-label={`Open ${w.name}`} title={s.tabs ? 'Restore its saved tabs' : 'Save tabs into this workspace first'}>
                    {opening === w.id ? 'Opening…' : 'Open'}
                  </Button>
                </li>
              );
            return (
              <li key={w.id}>
                <button type="button" onClick={() => go('workspaces', { id: w.id })} className="ts-hover ts-lift flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface-2/60 p-3.5 text-left" aria-label={`Open workspace ${w.name}`}>
                  <WorkspaceIconTile icon={w.icon} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{w.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {plural(s.tabs, 'tab')} · {plural(s.tasks, 'task')} · {plural(s.notes, 'note')}
                    </span>
                    {s.previewUrls.length > 0 && (
                      <span className="mt-1.5 flex gap-1.5" aria-hidden>
                        {s.previewUrls.map((u, i) => (
                          <Favicon key={`${u}-${i}`} url={u} size={14} />
                        ))}
                      </span>
                    )}
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-faint" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export const TodayTasksCard = forwardRef<HTMLInputElement, { limit?: number }>(function TodayTasksCard({ limit = 8 }, inputRef) {
  const [tasks] = useStore('ts.tasks');
  const go = useHubNav();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const today = toDateKey();
  const open = todayTasks(tasks, today);
  // Keep tasks completed today visible (struck through) so a mis-click can be undone.
  const doneToday = tasks.filter((t) => t.done && t.completedAt && toDateKey(t.completedAt) === today && t.dueDate && t.dueDate <= today);
  const rows = [...open, ...doneToday].slice(0, limit);

  /** Mirrors the input synchronously so a double submit in one tick can't send the same draft twice. */
  const draftRef = useRef('');
  const setDraftText = (v: string) => {
    draftRef.current = v;
    setDraft(v);
  };
  const submitDraft = async () => {
    const text = draftRef.current;
    const parsed = parseQuickAdd(text);
    if (!parsed) return;
    // Read + clear synchronously: a second submit of the same draft sees an empty box.
    setDraftText('');
    try {
      await createTask({ ...(parsed.dueDate || parsed.someday ? {} : { dueDate: today }), ...parsed });
    } catch {
      if (!draftRef.current) setDraftText(text);
      toast('Could not add the task.', 'error');
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Today’s Tasks"
        action={
          <span className="flex items-center gap-1">
            <span className="text-xs text-muted">{open.length} left</span>
            <Button variant="ghost" size="sm" onClick={() => go('tasks')} aria-label="Open all tasks">
              All tasks
            </Button>
          </span>
        }
      />
      <div className="flex-1 px-3">
        {rows.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted">Nothing due today. Add something below.</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-[var(--radius-ctl)] px-2 py-2 hover:bg-glow">
                <Checkbox checked={t.done} onChange={() => void toggleTaskDone(t.id).catch(() => toast('Could not update the task.', 'error'))} label={t.done ? `Mark "${t.title}" as not done` : `Complete "${t.title}"`} className="rounded-full!" />
                <button type="button" onClick={() => go('tasks', { id: t.id })} className={cn('min-w-0 flex-1 truncate text-left text-sm', t.done && 'text-faint line-through')}>
                  {t.title}
                </button>
                {!t.done && isOverdue(t, today) && <DueChip task={t} today={today} />}
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="m-3 mt-2 flex items-center gap-2 rounded-[var(--radius-ctl)] border border-line bg-surface-2 pr-1 pl-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submitDraft();
        }}
      >
        <input ref={inputRef} value={draft} onChange={(e) => setDraftText(e.target.value)} placeholder="Add a new task…" aria-label="Add a new task for today" className="h-10 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-faint rounded-md focus-visible:ring-2 focus-visible:ring-fg/40" />
        <IconButton type="submit" label="Add task" size="sm" disabled={!draft.trim()}>
          <Plus size={16} />
        </IconButton>
      </form>
    </Card>
  );
});

/* ------------------------------------------------------------------ */

export function RecentTabsCard({ limit = 5 }: { limit?: number }) {
  const toast = useToast();
  const go = useHubNav();
  const available = hasTabsApi();
  const [tabs, setTabs] = useState<OpenTab[] | null>(available ? null : []);

  useEffect(() => {
    if (!available) return;
    let alive = true;
    const own = ownExtensionPrefix();
    const load = () =>
      queryOpenTabs()
        // Web pages only: chrome://, extension and blank tabs are left out.
        .then((t) => alive && setTabs(recentTabs(t.filter((x) => isSafeUrl(x.url)), limit, own)))
        .catch(() => alive && setTabs([]));
    void load();
    const refresh = () => void load();
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => {
      if (info.title || info.status === 'complete') refresh();
    };
    chrome.tabs.onActivated?.addListener(refresh);
    chrome.tabs.onRemoved?.addListener(refresh);
    chrome.tabs.onCreated?.addListener(refresh);
    chrome.tabs.onUpdated?.addListener(onUpdated);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      chrome.tabs.onActivated?.removeListener(refresh);
      chrome.tabs.onRemoved?.removeListener(refresh);
      chrome.tabs.onCreated?.removeListener(refresh);
      chrome.tabs.onUpdated?.removeListener(onUpdated);
      window.removeEventListener('focus', refresh);
    };
  }, [available, limit]);

  return (
    <Card className="flex flex-col">
      <CardHeader title="Recent Tabs" action={available ? viewAll('View all tabs', () => go('tabs')) : undefined} />
      <div className="px-3 pb-3">
        {!available ? (
          <EmptyState className="py-6" icon={<AppWindow size={24} />} title="Tabs aren’t available here" description="Recent tabs appear when Tabspace runs as a Chrome extension." />
        ) : tabs === null ? (
          <p className="px-2 py-4 text-sm text-muted" role="status">
            Loading tabs…
          </p>
        ) : tabs.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted">No other open tabs.</p>
        ) : (
          <ul className="flex flex-col">
            {tabs.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => void activateTab(t).catch(() => toast('That tab is no longer open.', 'error'))}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-ctl)] px-2 py-2 text-left hover:bg-glow"
                  aria-label={`Switch to tab ${t.title}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2">
                    <Favicon url={t.url} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{t.title}</span>
                    <span className="block truncate text-xs text-faint">{hostname(t.url) || t.url}</span>
                  </span>
                  {t.lastAccessed && <span className="shrink-0 text-xs text-faint">{formatRelative(t.lastAccessed)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export function SavedLinksCard() {
  const go = useHubNav();
  const [folders] = useStore('ts.bookmarkFolders');
  const [bookmarks] = useStore('ts.bookmarks');
  const counts = useMemo(() => folderCounts(folders, bookmarks), [folders, bookmarks]);
  const roots = folderTree(folders)
    .filter((f) => f.depth === 0)
    .slice(0, 6);
  return (
    <Card>
      <CardHeader title="Saved Links" action={viewAll('View all bookmarks', () => go('bookmarks'))} />
      {roots.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">{bookmarks.length ? `${plural(bookmarks.length, 'link')} saved, not in folders yet.` : 'No saved links yet. Bookmark folders show up here.'}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 px-5 pb-5">
          {roots.map(({ folder }) => (
            <li key={folder.id}>
              <button type="button" onClick={() => go('bookmarks', { folder: folder.id })} className="ts-hover ts-lift flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface-2/60 p-3 text-left">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-3" aria-hidden>
                  <Folder size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{folder.name}</span>
                  <span className="block text-xs text-muted">{plural(counts.get(folder.id) ?? 0, 'link')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
