import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronRight, ExternalLink, FolderOpen, Pause, Play, Plus, RotateCcw, Save, Square, Star } from 'lucide-react';
import { Checkbox, Favicon, IconButton, Textarea, useToast } from '@/components/ui';
import { FocusRing } from '@/pages/focus/FocusRing';
import { useFocusTimer } from '@/pages/focus/useFocusTimer';
import { useStore } from '@/hooks/useStore';
import { useNow } from '@/hooks/useNow';
import { openDashboard } from '@/app/router';
import { insert, patch } from '@/storage/store';
import { kindLabel } from '@/features/focus/timer';
import { sessionsOn } from '@/features/focus/stats';
import { createTask, toggleTaskDone } from '@/features/tasks/actions';
import { inboxTasks } from '@/features/tasks/buckets';
import { WorkspaceIcon } from '@/features/workspaces/icons';
import { selectFocusKind } from '@/services/focus';
import { openWorkspace, saveCurrentWindow } from '@/services/sessions';
import { formatRelative, toDateKey } from '@/utils/date';
import { cn } from '@/utils/cn';
import type { Bookmark, FocusKind } from '@/types/models';
import { openUrl } from '../shared/openUrl';

/**
 * Heading level of section titles: 1 in the real side panel (its own document),
 * lower when embedded (e.g. the settings-page preview) so a page keeps one H1.
 */
export const SidebarHeadingLevel = createContext<1 | 2 | 3 | 4>(1);

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5';
function useHeadingTags(): { title: HeadingTag; sub: HeadingTag } {
  const level = useContext(SidebarHeadingLevel);
  return { title: `h${level}` as HeadingTag, sub: `h${level + 1}` as HeadingTag };
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const { title: H } = useHeadingTags();
  return (
    <div className="mb-3 flex h-8 items-center justify-between gap-2">
      <H className="text-[15px] font-semibold tracking-[-0.01em]">{title}</H>
      {action}
    </div>
  );
}

function FooterLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mt-3 inline-flex items-center gap-1 self-start text-[12.5px] text-muted hover:text-fg">
      {children}
      <ChevronRight size={13} aria-hidden />
    </button>
  );
}

const rowClass = 'group flex min-h-9 items-center gap-2.5 rounded-lg px-2 -mx-2 hover:bg-glow';

/* ------------------------------------------------------------------ */
/* Focus                                                               */
/* ------------------------------------------------------------------ */

const QUICK_KINDS: { value: FocusKind; label: string }[] = [
  { value: 'focus', label: 'Focus' },
  { value: 'short', label: 'Short' },
  { value: 'long', label: 'Long' },
];

export function FocusSection() {
  const t = useFocusTimer();
  const [records] = useStore('ts.focusSessions');
  const now = useNow(60_000);
  const count = sessionsOn(records, toDateKey(now));
  return (
    <>
      <SectionHeader title="Focus" />
      <div className="flex flex-col items-center">
        <FocusRing progress={t.progress} size={188} stroke={2} label={`${Math.round(t.progress * 100)}% complete`}>
          <span className="text-[11px] tracking-wide text-muted">{kindLabel(t.focus.kind)}</span>
          <span role="timer" aria-label={`${t.clock} remaining`} className="text-[2.6rem] leading-none font-light tracking-[-0.04em] tabular-nums">
            {t.clock}
          </span>
          <span className={cn('mt-1.5 text-[11px]', t.completion ? 'font-medium text-fg' : 'text-faint')} role={t.completion ? 'status' : undefined}>
            {t.completion ? (t.completion.kind === 'short' || t.completion.kind === 'long' ? 'Break complete' : 'Session complete') : t.focus.status === 'paused' ? 'Paused' : t.running ? 'Stay in the zone' : 'Ready'}
          </span>
        </FocusRing>
        {t.completion ? (
          <div className="mt-4 flex h-12 items-center gap-2">
            <button type="button" onClick={() => void t.startNext()} className="h-8 rounded-lg bg-fg px-3 text-xs font-medium text-bg hover:opacity-90">
              {t.completion.nextLabel}
            </button>
            <button type="button" onClick={() => void t.startAgain()} className="h-8 rounded-lg border border-line px-3 text-xs text-muted hover:border-line-strong hover:text-fg">
              Start again
            </button>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-4">
            <IconButton label="Reset timer" onClick={() => void t.reset()} disabled={!t.active} className="rounded-full border border-line">
              <RotateCcw size={15} />
            </IconButton>
            <button
              type="button"
              onClick={() => void t.toggle()}
              aria-label={t.running ? 'Pause session' : t.focus.status === 'paused' ? 'Resume session' : 'Start session'}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-fg text-bg hover:opacity-90"
            >
              {t.running ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" className="translate-x-px" />}
            </button>
            <IconButton label="Stop session" onClick={() => void t.stop()} disabled={!t.active} className="rounded-full border border-line">
              <Square size={13} />
            </IconButton>
          </div>
        )}
        <div role="radiogroup" aria-label="Session type" className="mt-5 flex gap-1">
          {QUICK_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={t.focus.kind === k.value}
              disabled={t.active && t.focus.kind !== k.value}
              onClick={() => void selectFocusKind(k.value)}
              className={cn('h-7 rounded-lg border px-3 text-xs transition-colors disabled:opacity-40', t.focus.kind === k.value ? 'ts-active text-fg' : 'border-line text-muted hover:text-fg')}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs text-faint">
          {count}/{t.settings.focus.sessionsGoal} sessions today
        </p>
      </div>
      <FooterLink onClick={() => void openDashboard('focus')}>Open Focus Mode</FooterLink>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export function TasksSection() {
  const [tasks] = useStore('ts.tasks');
  const now = useNow(60_000);
  const today = toDateKey(now);
  const [justDone, setJustDone] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const open = inboxTasks(tasks, today);
  const recent = tasks.filter((t) => t.done && justDone.includes(t.id));
  const shown = [...open.slice(0, 5), ...recent].slice(0, 6);

  // Toggle from the stored value so rapid double-clicks always cancel out (BUG-TK2).
  const toggle = (id: string) => {
    void toggleTaskDone(id).then((done) => {
      if (done !== undefined) setJustDone((j) => (done ? [...j, id] : j.filter((x) => x !== id)));
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    await createTask({ title });
  };

  return (
    <>
      <SectionHeader
        title="Tasks"
        action={
          <IconButton label="Add task" size="sm" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <Plus size={16} />
          </IconButton>
        }
      />
      {adding && (
        <form onSubmit={submit} className="mb-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            placeholder="New task, press Enter"
            aria-label="New task title"
            className="h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none placeholder:text-faint focus:border-line-strong"
          />
        </form>
      )}
      {shown.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-faint">Nothing open. Enjoy the calm.</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((t) => (
            <li key={t.id} className={rowClass}>
              <Checkbox size="sm" checked={t.done} onChange={() => toggle(t.id)} label={`Mark "${t.title}" ${t.done ? 'not done' : 'done'}`} />
              <button type="button" onClick={() => void openDashboard('tasks', { id: t.id })} className={cn('min-w-0 flex-1 truncate text-left text-[13.5px]', t.done && 'text-faint line-through')}>
                {t.title}
              </button>
              {t.dueDate && !t.done && (
                <span className={cn('shrink-0 text-[11px]', t.dueDate < today ? 'text-danger' : 'text-faint')}>{t.dueDate < today ? 'Overdue' : t.dueDate === today ? 'Today' : t.dueDate.slice(5)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {open.length > 5 && <p className="mt-1 text-xs text-faint">+{open.length - 5} more</p>}
      <FooterLink onClick={() => void openDashboard('tasks')}>Open all tasks</FooterLink>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

export function NotesSection() {
  const [notes] = useStore('ts.notes');
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
  const recent = notes
    .filter((n) => !n.trashedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);

  const save = async () => {
    const content = draft.trim();
    if (!content) return setWriting(false);
    const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').trim();
    await insert('ts.notes', { title: firstLine.slice(0, 80) || 'Quick note', content, tags: [], favorite: false });
    setDraft('');
    setWriting(false);
    toast('Note saved');
  };

  return (
    <>
      <SectionHeader
        title="Notes"
        action={
          <IconButton label="New quick note" size="sm" onClick={() => setWriting((w) => !w)} aria-expanded={writing}>
            <Plus size={16} />
          </IconButton>
        }
      />
      {writing && (
        <div className="mb-3">
          <Textarea
            autoFocus
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setWriting(false);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
            }}
            placeholder="Jot something down… (Ctrl+Enter to save)"
            aria-label="Quick note"
            className="text-[13px]"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button type="button" className="h-7 rounded-lg px-2.5 text-xs text-muted hover:text-fg" onClick={() => setWriting(false)}>
              Cancel
            </button>
            <button type="button" className="h-7 rounded-lg bg-fg px-3 text-xs font-medium text-bg disabled:opacity-40" disabled={!draft.trim()} onClick={() => void save()}>
              Save note
            </button>
          </div>
        </div>
      )}
      {recent.length === 0 && !writing ? (
        <p className="py-6 text-center text-[13px] text-faint">No notes yet.</p>
      ) : (
        <ul className="flex flex-col">
          {recent.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => void openDashboard('notes', { id: n.id })} className={cn(rowClass, 'w-full flex-col items-start gap-0 py-1.5 text-left')}>
                <span className="w-full truncate text-[13.5px]">{n.title || 'Untitled'}</span>
                <span className="text-[11px] text-faint">{formatRelative(n.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <FooterLink onClick={() => void openDashboard('notes')}>Open notes</FooterLink>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Bookmarks                                                           */
/* ------------------------------------------------------------------ */

function BookmarkRow({ b }: { b: Bookmark }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          void openUrl(b.url);
          void patch('ts.bookmarks', b.id, { lastOpenedAt: Date.now() });
        }}
        className={cn(rowClass, 'w-full text-left')}
        title={b.url}
      >
        <Favicon url={b.url} size={15} />
        <span className="min-w-0 flex-1 truncate text-[13.5px]">{b.title || b.url}</span>
        <ExternalLink size={12} className="shrink-0 text-faint opacity-0 group-hover:opacity-100" aria-hidden />
      </button>
    </li>
  );
}

export function BookmarksSection() {
  const [bookmarks] = useStore('ts.bookmarks');
  const [folders] = useStore('ts.bookmarkFolders');
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const { sub: Sub } = useHeadingTags();
  const favorites = bookmarks.filter((b) => b.favorite).slice(0, 6);
  const topFolders = folders
    .filter((f) => !f.parentId)
    .sort((a, b) => a.order - b.order)
    .slice(0, 4);

  const openAll = (folderId: string) => {
    for (const b of bookmarks.filter((x) => x.folderId === folderId).slice(0, 10)) void openUrl(b.url, false);
  };

  return (
    <>
      <SectionHeader title="Bookmarks" />
      {favorites.length === 0 && topFolders.length === 0 && <p className="py-6 text-center text-[13px] text-faint">Star bookmarks in the dashboard to see them here.</p>}
      {favorites.length > 0 && (
        <>
          <Sub className="mb-1 flex items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
            <Star size={11} aria-hidden /> Favourites
          </Sub>
          <ul className="mb-4 flex flex-col">
            {favorites.map((b) => (
              <BookmarkRow key={b.id} b={b} />
            ))}
          </ul>
        </>
      )}
      {topFolders.length > 0 && (
        <>
          <Sub className="mb-1 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">Folders</Sub>
          <ul className="flex flex-col">
            {topFolders.map((f) => {
              const items = bookmarks.filter((b) => b.folderId === f.id);
              const expanded = openFolder === f.id;
              return (
                <li key={f.id}>
                  <div className={rowClass}>
                    <button type="button" aria-expanded={expanded} onClick={() => setOpenFolder(expanded ? null : f.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                      <ChevronRight size={13} className={cn('shrink-0 text-faint transition-transform', expanded && 'rotate-90')} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">{f.name}</span>
                      <span className="text-[11px] text-faint">{items.length}</span>
                    </button>
                    {items.length > 0 && (
                      <IconButton label={`Open all in ${f.name}${items.length > 10 ? ' (first 10)' : ''}`} size="sm" onClick={() => openAll(f.id)} className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100">
                        <FolderOpen size={14} />
                      </IconButton>
                    )}
                  </div>
                  {expanded && (
                    <ul className="mb-1 ml-5 flex flex-col">
                      {items.slice(0, 5).map((b) => (
                        <BookmarkRow key={b.id} b={b} />
                      ))}
                      {items.length === 0 && <li className="py-1 text-xs text-faint">Empty folder</li>}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <FooterLink onClick={() => void openDashboard('bookmarks')}>All bookmarks</FooterLink>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Workspaces                                                          */
/* ------------------------------------------------------------------ */

export function WorkspacesSection() {
  const [workspaces] = useStore('ts.workspaces');
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const list = [...workspaces].sort((a, b) => a.order - b.order).slice(0, 8);
  const hasChrome = typeof chrome !== 'undefined' && !!chrome.tabs;

  const run = async (key: string, job: () => Promise<unknown>, ok: string) => {
    if (!hasChrome) return toast('Workspaces open tabs, so this only works inside the Chrome extension.', 'error');
    setBusy(key);
    try {
      const result = await job();
      toast(result === null ? 'No tabs that can be saved in this window' : ok);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionHeader title="Workspaces" />
      {list.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-faint">No workspaces yet.</p>
      ) : (
        <ul className="flex flex-col">
          {list.map((w) => (
            <li key={w.id} className={rowClass}>
              <WorkspaceIcon icon={w.icon} size={15} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{w.name}</span>
              <IconButton label={`Save current window to ${w.name}`} size="sm" disabled={busy !== null} onClick={() => void run(`s${w.id}`, () => saveCurrentWindow({ workspaceId: w.id }), `Saved to ${w.name}`)} className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100">
                <Save size={13} />
              </IconButton>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run(`o${w.id}`, () => openWorkspace(w.id), `Opened ${w.name}`)}
                className="h-7 shrink-0 rounded-lg border border-line px-2.5 text-xs text-muted hover:border-line-strong hover:text-fg disabled:opacity-40"
                aria-label={`Open ${w.name}`}
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void run('save2', () => saveCurrentWindow({}), 'Current window saved')}
        className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line text-[13px] text-muted hover:border-line-strong hover:text-fg disabled:opacity-40"
      >
        <Save size={14} aria-hidden /> Save current window
      </button>
      <FooterLink onClick={() => void openDashboard('workspaces')}>Manage workspaces</FooterLink>
    </>
  );
}
