import { useMemo, useState } from 'react';
import { ArrowLeft, Bookmark as BookmarkIcon, CalendarDays, CheckSquare, FileText, LayoutGrid, MoreHorizontal, Palette, Pencil, Plus, Save, Search, Settings2, Trash2 } from 'lucide-react';
import { PageHero } from '@/components/layout/PageHero';
import { Button, Card, CardHeader, EmptyState, Favicon, IconButton, Input, Menu, useConfirm, useToast } from '@/components/ui';
import { useSettings, useStore } from '@/hooks/useStore';
import { navigate, useRoute } from '@/app/router';
import type { Workspace } from '@/types/models';
import { WorkspaceIconTile } from '@/features/workspaces/icons';
import { latestSession, previewUrls, referenceCounts, searchWorkspaces, sessionsFor, workspaceCounts } from '@/features/workspaces/model';
import { deleteWorkspace } from '@/features/workspaces/actions';
import { eventBounds } from '@/features/calendar/occurrences';
import { dueLabel } from '@/features/tasks/buckets';
import { toDateKey } from '@/utils/date';
import { WorkspaceFormModal } from './WorkspaceForm';
import { SessionList } from './SessionList';
import { SaveWindowPicker } from './SaveWindowPicker';
import { SavedTabsPanel } from './SavedTabsPanel';
import { SyncRemovedPanel } from './SyncRemovedPanel';
import { OpenSplitButton, errorMessage, useRestore } from './sessionActions';
import { GroupColorModal, GroupSettingsModal, LiveGroupChip, useLiveWorkspaceGroups, useWorkspaceGroupColor } from './WorkspaceGroupControls';
import type { LiveWorkspaceGroup } from '@/services/workspaceGroups';

export default function WorkspacesPage() {
  const { params } = useRoute();
  const id = params.get('id');
  const [workspaces, , loaded] = useStore('ts.workspaces');
  const selected = id ? workspaces.find((w) => w.id === id) : undefined;
  if (id && loaded && !selected) {
    return (
      <div>
        <PageHero title="Workspaces" subtitle="Separate environments for everything you do." />
        <Card>
          <EmptyState title="Workspace not found" description="It may have been deleted." action={<Button onClick={() => navigate('workspaces')}>Back to workspaces</Button>} />
        </Card>
      </div>
    );
  }
  return selected ? <WorkspaceDetail workspace={selected} /> : <WorkspaceGrid workspaces={workspaces} loaded={loaded} />;
}

/* ------------------------------------------------------------------ */
/* Shared hooks                                                        */
/* ------------------------------------------------------------------ */

function useDeleteWorkspace() {
  const confirm = useConfirm();
  const toast = useToast();
  const [tasks] = useStore('ts.tasks');
  const [notes] = useStore('ts.notes');
  const [bookmarks] = useStore('ts.bookmarks');
  const [sessions] = useStore('ts.sessions');
  const [events] = useStore('ts.events');
  return async (w: Workspace) => {
    const c = referenceCounts(w.id, { tasks, notes, bookmarks, sessions, events });
    const parts = [
      [c.tasks, 'task'],
      [c.notes, 'note'],
      [c.bookmarks, 'bookmark'],
      [c.sessions, 'saved session'],
      [c.events, 'event'],
    ]
      .filter(([n]) => (n as number) > 0)
      .map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`);
    const ok = await confirm({
      title: `Delete “${w.name}”?`,
      message: parts.length ? `Its ${parts.join(', ')} will be kept but no longer assigned to a workspace. Open browser tabs are not affected.` : 'This workspace has nothing assigned to it. Open browser tabs are not affected.',
      confirmLabel: 'Delete workspace',
      danger: true,
    });
    if (!ok) return false;
    try {
      await deleteWorkspace(w.id);
      toast('Workspace deleted');
      return true;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return false;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

function WorkspaceGrid({ workspaces, loaded }: { workspaces: Workspace[]; loaded: boolean }) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Workspace | undefined>();
  const [picking, setPicking] = useState<string | null>(null);
  const [colorFor, setColorFor] = useState<Workspace | null>(null);
  const [groupSettings, setGroupSettings] = useState(false);
  const [settings] = useSettings();
  const live = useLiveWorkspaceGroups();
  const [sessions] = useStore('ts.sessions');
  const [tasks] = useStore('ts.tasks');
  const [notes] = useStore('ts.notes');
  const [bookmarks] = useStore('ts.bookmarks');
  const list = useMemo(() => searchWorkspaces(workspaces, query), [workspaces, query]);
  const data = useMemo(() => ({ sessions, tasks, notes, bookmarks }), [sessions, tasks, notes, bookmarks]);

  return (
    <div>
      <PageHero
        title="Workspaces"
        subtitle="Separate environments for everything you do."
        actions={
          <>
            {workspaces.length > 0 && (
              <Input icon={<Search size={15} />} placeholder="Search workspaces" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search workspaces" className="w-56" />
            )}
            <IconButton label="Workspace tab group settings" onClick={() => setGroupSettings(true)}>
              <Settings2 size={17} />
            </IconButton>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              New workspace
            </Button>
          </>
        }
      />
      {!loaded ? (
        <p className="text-sm text-muted" role="status">
          Loading…
        </p>
      ) : workspaces.length === 0 ? (
        <Card>
          <EmptyState
            icon={<LayoutGrid size={30} />}
            title="No workspaces yet"
            description="Create one for each area of your life — Development, Content Creation, Job Search — and save windows of tabs into it."
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                Create your first workspace
              </Button>
            }
          />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Search size={26} />} title="No matching workspaces" description={`Nothing matches “${query}”.`} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((w) => (
            <WorkspaceCard key={w.id} workspace={w} data={data} onEdit={() => setEditing(w)} onSaveWindow={() => setPicking(w.id)} onColor={() => setColorFor(w)} live={live.get(w.id)} groupDefault={settings.workspaceGroups.enabled} />
          ))}
        </div>
      )}
      <WorkspaceFormModal open={creating} onClose={() => setCreating(false)} />
      <WorkspaceFormModal open={!!editing} workspace={editing} onClose={() => setEditing(undefined)} />
      <SaveWindowPicker workspaceId={picking} onClose={() => setPicking(null)} />
      <GroupColorModal workspaceId={colorFor?.id ?? null} name={colorFor?.name ?? ''} onClose={() => setColorFor(null)} />
      <GroupSettingsModal open={groupSettings} onClose={() => setGroupSettings(false)} />
    </div>
  );
}

function WorkspaceCard({
  workspace: w,
  data,
  onEdit,
  onSaveWindow,
  onColor,
  live,
  groupDefault,
}: {
  workspace: Workspace;
  data: Parameters<typeof workspaceCounts>[1];
  onEdit: () => void;
  onSaveWindow: () => void;
  onColor: () => void;
  live?: LiveWorkspaceGroup;
  groupDefault: boolean;
}) {
  const color = useWorkspaceGroupColor(w.id);
  const { open } = useRestore();
  const del = useDeleteWorkspace();
  const counts = workspaceCounts(w.id, data);
  const favicons = previewUrls(data.sessions, w.id, 5);
  const hasSession = !!latestSession(data.sessions, w.id)?.tabs.length;
  return (
    <Card as="article" interactive className="ts-hover group relative flex flex-col gap-4 p-5 focus-within:z-30">
      <div className="flex items-start gap-3.5">
        <WorkspaceIconTile icon={w.icon} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold tracking-[-0.01em]">
            <a
              href={`#/workspaces?id=${encodeURIComponent(w.id)}`}
              className="outline-none after:absolute after:inset-0 after:rounded-[var(--radius-card)] after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-fg"
            >
              {w.name}
            </a>
          </h2>
          {w.description && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{w.description}</p>}
        </div>
        {/* z-20 (above the footer buttons' z-10) so the open menu isn't covered by them. */}
        <div className="relative z-20">
          <Menu
            label={`Actions for ${w.name}`}
            trigger={<MoreHorizontal size={16} />}
            items={[
              { label: 'Save current window here…', icon: <Save size={14} />, onSelect: onSaveWindow },
              { label: 'Rename / change icon', icon: <Pencil size={14} />, onSelect: onEdit },
              { label: 'Tab group colour…', icon: <Palette size={14} />, onSelect: onColor },
              { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: () => void del(w) },
            ]}
          />
        </div>
      </div>
      {live && (
        <div className="relative z-10 -mt-1">
          <LiveGroupChip workspaceId={w.id} name={w.name} live={live} color={color} />
        </div>
      )}
      <p className="text-[13px] text-muted">
        {counts.tabs} tab{counts.tabs === 1 ? '' : 's'} · {counts.tasks} task{counts.tasks === 1 ? '' : 's'} · {counts.notes} note{counts.notes === 1 ? '' : 's'} · {counts.bookmarks} bookmark{counts.bookmarks === 1 ? '' : 's'}
      </p>
      <div className="mt-auto flex items-center justify-between gap-3">
        <div className="flex min-h-7 items-center gap-1.5" aria-label={favicons.length ? `Sites in ${w.name}` : undefined}>
          {favicons.length ? (
            favicons.map((u) => (
              <span key={u} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface-2">
                <Favicon url={u} size={15} />
              </span>
            ))
          ) : (
            <span className="text-xs text-faint">No saved tabs yet</span>
          )}
        </div>
        <div className="relative z-10">
          {hasSession ? (
            <OpenSplitButton name={w.name} groupDefault={groupDefault} onOpen={(mode) => void open(w.id, mode)} />
          ) : (
            <Button size="sm" icon={<Save size={14} />} onClick={onSaveWindow}>
              Save window
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

function WorkspaceDetail({ workspace: w }: { workspace: Workspace }) {
  const [editing, setEditing] = useState(false);
  const [workspaces] = useStore('ts.workspaces');
  const [sessions] = useStore('ts.sessions');
  const [tasks] = useStore('ts.tasks');
  const [notes] = useStore('ts.notes');
  const [bookmarks] = useStore('ts.bookmarks');
  const [events] = useStore('ts.events');
  const { open } = useRestore();
  const del = useDeleteWorkspace();
  const [picking, setPicking] = useState(false);
  const [coloring, setColoring] = useState(false);
  const [settings] = useSettings();
  const liveGroup = useLiveWorkspaceGroups().get(w.id);
  const groupColor = useWorkspaceGroupColor(w.id);

  const wsSessions = useMemo(() => sessionsFor(sessions, w.id), [sessions, w.id]);
  const current = latestSession(sessions, w.id);
  const hasSession = !!current?.tabs.length;
  const history = useMemo(() => wsSessions.filter((s) => s.id !== current?.id), [wsSessions, current?.id]);
  const openTasks = useMemo(() => tasks.filter((t) => t.workspaceId === w.id && !t.done).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.order - b.order), [tasks, w.id]);
  const wsNotes = useMemo(() => notes.filter((n) => n.workspaceId === w.id && !n.trashedAt).sort((a, b) => b.updatedAt - a.updatedAt), [notes, w.id]);
  const wsBookmarks = useMemo(() => bookmarks.filter((b) => b.workspaceId === w.id).sort((a, b) => b.updatedAt - a.updatedAt), [bookmarks, w.id]);
  const upcoming = useMemo(() => {
    const now = Date.now();
    return events
      .filter((e) => e.workspaceId === w.id)
      .map((e) => ({ e, start: eventBounds(e).start }))
      .filter((x) => x.start.getTime() >= now - 3600_000)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(0, 5);
  }, [events, w.id]);

  return (
    <div>
      <button type="button" onClick={() => navigate('workspaces')} className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft size={15} /> All workspaces
      </button>
      <PageHero
        title={
          <span className="flex items-center gap-4">
            <WorkspaceIconTile icon={w.icon} size={52} />
            {w.name}
          </span>
        }
        subtitle={w.description || 'Saved tabs, tasks, notes and links for this workspace.'}
        actions={
          <>
            <Button icon={<Save size={15} />} onClick={() => setPicking(true)}>
              {hasSession ? 'Update from window…' : 'Save current window…'}
            </Button>
            {liveGroup && <LiveGroupChip workspaceId={w.id} name={w.name} live={liveGroup} color={groupColor} />}
            {hasSession && <OpenSplitButton size="md" name={w.name} groupDefault={settings.workspaceGroups.enabled} onOpen={(mode) => void open(w.id, mode)} />}
            <Menu
              label={`Actions for ${w.name}`}
              trigger={<MoreHorizontal size={16} />}
              items={[
                { label: 'Rename / change icon', icon: <Pencil size={14} />, onSelect: () => setEditing(true) },
                { label: 'Tab group colour…', icon: <Palette size={14} />, onSelect: () => setColoring(true) },
                {
                  label: 'Delete workspace',
                  icon: <Trash2 size={14} />,
                  danger: true,
                  onSelect: async () => {
                    if (await del(w)) navigate('workspaces');
                  },
                },
              ]}
            />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <SavedTabsPanel workspaceId={w.id} session={current} />
          <SyncRemovedPanel workspaceId={w.id} />
          {history.length > 0 && (
            <Card>
              <CardHeader title={`History (${history.length})`} />
              <p className="-mt-1 px-5 pb-2 text-xs text-muted">Earlier saved lists of this workspace. Restoring one doesn’t change the saved tabs above.</p>
              <SessionList sessions={history} workspaces={workspaces} />
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-5">
          <PreviewCard
            title="Tasks"
            icon={<CheckSquare size={16} />}
            count={openTasks.length}
            empty="No open tasks in this workspace."
            onAll={() => navigate('tasks')}
            items={openTasks.slice(0, 5).map((t) => ({ id: t.id, label: t.title, meta: t.dueDate ? dueLabel(t.dueDate, toDateKey()) : undefined, onOpen: () => navigate('tasks', { id: t.id }) }))}
          />
          <PreviewCard
            title="Notes"
            icon={<FileText size={16} />}
            count={wsNotes.length}
            empty="No notes in this workspace."
            onAll={() => navigate('notes')}
            items={wsNotes.slice(0, 5).map((n) => ({ id: n.id, label: n.title || 'Untitled note', onOpen: () => navigate('notes', { id: n.id }) }))}
          />
          <PreviewCard
            title="Bookmarks"
            icon={<BookmarkIcon size={16} />}
            count={wsBookmarks.length}
            empty="No bookmarks in this workspace."
            onAll={() => navigate('bookmarks')}
            items={wsBookmarks.slice(0, 5).map((b) => ({ id: b.id, label: b.title || b.url, favicon: b.url, onOpen: () => navigate('bookmarks', { id: b.id }) }))}
          />
          <PreviewCard
            title="Upcoming events"
            icon={<CalendarDays size={16} />}
            count={upcoming.length}
            empty="No upcoming events in this workspace."
            onAll={() => navigate('calendar')}
            items={upcoming.map(({ e, start }) => ({
              id: e.id,
              label: e.title,
              meta: e.allDay ? start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : start.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
              onOpen: () => navigate('calendar', { id: e.id }),
            }))}
          />
        </div>
      </div>
      <WorkspaceFormModal open={editing} workspace={w} onClose={() => setEditing(false)} />
      <SaveWindowPicker workspaceId={picking ? w.id : null} onClose={() => setPicking(false)} />
      <GroupColorModal workspaceId={coloring ? w.id : null} name={w.name} onClose={() => setColoring(false)} />
    </div>
  );
}

function PreviewCard({ title, icon, count, items, empty, onAll }: { title: string; icon: React.ReactNode; count: number; empty: string; onAll: () => void; items: { id: string; label: string; meta?: string; favicon?: string; onOpen: () => void }[] }) {
  return (
    <Card>
      <CardHeader
        title={`${title}${count ? ` (${count})` : ''}`}
        icon={icon}
        action={
          <Button size="sm" variant="ghost" onClick={onAll}>
            View all
          </Button>
        }
      />
      {items.length ? (
        <ul className="px-2 pb-3">
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={i.onOpen} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-glow">
                {i.favicon && <Favicon url={i.favicon} size={14} />}
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                {i.meta && <span className="shrink-0 text-xs text-faint">{i.meta}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-4 text-[13px] text-faint">{empty}</p>
      )}
    </Card>
  );
}
