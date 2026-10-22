import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pause, Pencil, Play, Plus, Settings2, Trash2, X } from 'lucide-react';
import { Button, Card, CardHeader, Favicon, Field, IconButton, Input, Modal, useConfirm, useToast } from '@/components/ui';
import { useHubNav } from './hubNav';
import { useStore } from '@/hooks/useStore';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/utils/cn';
import { addDays, fromDateKey, isSameDay, monthGrid, toDateKey } from '@/utils/date';
import { getOccurrences, occurrencesOnDay, type Occurrence } from '@/features/calendar/occurrences';
import { kindLabel } from '@/features/focus/timer';
import { useFocusTimer } from '@/pages/focus/useFocusTimer';
import { openLink } from '@/features/search/chromeTabs';
import { addQuickLink, editQuickLink, removeQuickLink, reorderQuickLink, sortLinks, validateLink } from '@/features/quicklinks/quickLinks';
import type { QuickLink } from '@/types/models';
import { daysWithEvents, friendlyWhen, upcoming } from './dashboardLogic';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CalendarState {
  today: Date;
  cursor: { y: number; m: number };
  setCursor: (fn: (c: { y: number; m: number }) => { y: number; m: number }) => void;
  selected: Date | null;
  setSelected: (d: Date | null) => void;
  now: number;
}

const CalendarStateContext = createContext<CalendarState | null>(null);

/** Shares the month cursor and selected date between the month calendar and the events list. */
export function CalendarStateProvider({ children }: { children: ReactNode }) {
  const now = useNow(60_000);
  const todayKey = toDateKey(now);
  const today = useMemo(() => fromDateKey(todayKey), [todayKey]);
  const [cursor, setCursor] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() }));
  const [selected, setSelected] = useState<Date | null>(null);
  const value = useMemo(() => ({ today, cursor, setCursor, selected, setSelected, now }), [today, cursor, selected, now]);
  return <CalendarStateContext.Provider value={value}>{children}</CalendarStateContext.Provider>;
}

function useCalendarState(): CalendarState {
  const ctx = useContext(CalendarStateContext);
  if (!ctx) throw new Error('Calendar widgets need a CalendarStateProvider');
  return ctx;
}

/** Monthly calendar grid with event dots; clicking a date selects it for the events list. */
export function MonthCalendar() {
  const [events] = useStore('ts.events');
  const [sources] = useStore('ts.calendarSources');
  const { today, cursor, setCursor, selected, setSelected } = useCalendarState();
  const grid = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);
  const gridOcc = useMemo(() => getOccurrences(events, sources, grid[0], addDays(grid[41], 1)), [events, sources, grid]);
  const marked = useMemo(() => daysWithEvents(gridOcc), [gridOcc]);
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shift = (d: number) => setCursor((c) => ({ y: c.m + d < 0 ? c.y - 1 : c.m + d > 11 ? c.y + 1 : c.y, m: (c.m + d + 12) % 12 }));
  return (
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold" aria-live="polite">
            {monthLabel}
          </h2>
          <div className="flex">
            <IconButton label="Previous month" size="sm" onClick={() => shift(-1)}>
              <ChevronLeft size={16} />
            </IconButton>
            <IconButton label="Next month" size="sm" onClick={() => shift(1)}>
              <ChevronRight size={16} />
            </IconButton>
          </div>
        </div>
        <div role="grid" aria-label={monthLabel} className="grid grid-cols-7 gap-y-1 text-center">
          {WEEKDAYS.map((d) => (
            <div key={d} role="columnheader" className="pb-1 text-[11px] text-faint">
              {d}
            </div>
          ))}
          {grid.map((d) => {
            const key = toDateKey(d);
            const inMonth = d.getMonth() === cursor.m;
            const isToday = isSameDay(d, today);
            const isSel = !!selected && isSameDay(d, selected);
            const has = marked.has(key);
            return (
              <button
                key={key}
                type="button"
                role="gridcell"
                aria-selected={isSel}
                aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${has ? ', has events' : ''}${isToday ? ', today' : ''}`}
                onClick={() => setSelected(isSel ? null : d)}
                className={cn(
                  'relative mx-auto flex h-8 w-8 flex-col items-center justify-center rounded-full text-[12.5px] tabular-nums transition-colors',
                  inMonth ? 'text-fg' : 'text-faint/60',
                  isSel ? 'bg-fg text-bg' : 'hover:bg-glow',
                  isToday && !isSel && 'ring-1 ring-line-strong',
                )}
              >
                {d.getDate()}
                {has && <span className={cn('absolute bottom-0.5 h-1 w-1 rounded-full', isSel ? 'bg-bg' : 'bg-muted')} aria-hidden />}
              </button>
            );
          })}
        </div>
      </Card>
  );
}

/** Next events, or the selected date's events. */
export function UpcomingEvents({ limit = 4 }: { limit?: number }) {
  const go = useHubNav();
  const [events] = useStore('ts.events');
  const [sources] = useStore('ts.calendarSources');
  const { today, selected, setSelected, now } = useCalendarState();
  const nextOcc = useMemo(() => upcoming(getOccurrences(events, sources, today, addDays(today, 90)), new Date(now), limit), [events, sources, now, today, limit]);
  const dayOcc = useMemo(() => (selected ? occurrencesOnDay(getOccurrences(events, sources, selected, addDays(selected, 1)), selected) : []), [events, sources, selected]);
  const list: Occurrence[] = selected ? dayOcc : nextOcc;
  return (
      <Card aria-label="Upcoming events">
        <CardHeader
          title={selected ? selected.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Upcoming Events'}
          action={
            selected ? (
              <IconButton label="Back to upcoming events" size="sm" onClick={() => setSelected(null)}>
                <X size={15} />
              </IconButton>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => go('calendar')}>
                See All
              </Button>
            )
          }
        />
        <div className="px-5 pb-4">
          {list.length === 0 ? (
            <p className="text-sm text-muted">{selected ? 'No events on this day.' : sources.length || events.length ? 'Nothing coming up.' : 'No calendars yet. Add one on the Calendar page.'}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.map((o) => (
                <li key={o.key} className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: o.source?.color ?? 'var(--ts-muted)' }} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{o.event.title || 'Untitled event'}</span>
                    <span className="block text-xs text-muted">
                      {selected ? (o.allDay ? 'All day' : o.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) : friendlyWhen(o, new Date(now))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
  );
}

/** Monthly calendar + Upcoming Events, sharing the selected date. */
export function CalendarAndEvents({ upcomingLimit = 4 }: { upcomingLimit?: number }) {
  return (
    <CalendarStateProvider>
      <MonthCalendar />
      <UpcomingEvents limit={upcomingLimit} />
    </CalendarStateProvider>
  );
}

/* ------------------------------------------------------------------ */

export function FocusCard() {
  const go = useHubNav();
  const toast = useToast();
  const t = useFocusTimer();
  const run = (p: Promise<unknown>) => void p.catch(() => toast('Could not update the focus timer.', 'error'));
  const done = t.completion;
  const breakDone = done && (done.kind === 'short' || done.kind === 'long');
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Focus Mode</h2>
        <IconButton label="Open Focus Mode" size="sm" onClick={() => go('focus')}>
          <ChevronRight size={16} />
        </IconButton>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[2.4rem] leading-none font-semibold tracking-[-0.03em] tabular-nums" role="timer" aria-label={`${t.clock} ${t.focus.status === 'idle' ? 'session length' : 'remaining'}`}>
            {t.clock}
          </div>
          {done ? (
            <p className="mt-2 text-xs font-medium text-fg" role="status">
              {breakDone ? 'Break complete' : 'Session complete'}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted">{t.focus.status === 'paused' ? 'Paused.' : t.running ? `${kindLabel(t.focus.kind)} · running` : 'Focus on what matters.'}</p>
          )}
        </div>
        {!done && (
          <button
            type="button"
            onClick={() => run(t.toggle())}
            aria-label={t.running ? 'Pause focus session' : t.focus.status === 'paused' ? 'Resume focus session' : 'Start focus session'}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-3 text-fg transition-colors hover:bg-fg hover:text-bg"
          >
            {t.running ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}
          </button>
        )}
      </div>
      {done && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => run(t.startNext())}>
            {done.nextLabel}
          </Button>
          <Button size="sm" onClick={() => run(t.startAgain())}>
            Start again
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export function QuickLinksCard() {
  const [links] = useStore('ts.quickLinks');
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<null | { editing?: QuickLink }>(null);
  const [manage, setManage] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();
  const sorted = sortLinks(links);

  const openForm = (editing?: QuickLink) => {
    setTitle(editing?.title ?? '');
    setUrl(editing?.url ?? '');
    setError(undefined);
    setForm({ editing });
  };

  const submit = async () => {
    const v = validateLink(title, url);
    if ('error' in v) return setError(v.error);
    try {
      if (form?.editing) await editQuickLink(form.editing.id, v.title, v.url);
      else await addQuickLink(v.title, v.url);
      setForm(null);
    } catch {
      toast('Could not save the link.', 'error');
    }
  };

  const run = (p: Promise<unknown>) => p.catch(() => toast('Could not update quick links.', 'error'));

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Quick Links</h2>
        {sorted.length > 0 && (
          <IconButton label="Manage quick links" size="sm" onClick={() => setManage(true)}>
            <Settings2 size={15} />
          </IconButton>
        )}
      </div>
      <ul className="grid grid-cols-3 gap-2">
        {sorted.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => void openLink(l.url).then((ok) => !ok && toast('Only http(s) links can be opened.', 'error'))}
              className="ts-hover ts-lift flex w-full flex-col items-center gap-1.5 rounded-[var(--radius-ctl)] border border-line bg-surface-2/60 px-1 py-2.5"
              title={l.url}
            >
              <Favicon url={l.url} size={20} />
              <span className="w-full truncate text-center text-[11px] text-muted">{l.title}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" onClick={() => openForm()} className="ts-hover flex w-full flex-col items-center gap-1.5 rounded-[var(--radius-ctl)] border border-dashed border-line px-1 py-2.5 text-muted" aria-label="Add quick link">
            <Plus size={20} />
            <span className="text-[11px]">Add</span>
          </button>
        </li>
      </ul>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.editing ? 'Edit quick link' : 'Add quick link'}
        width={400}
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submit()}>
              Save
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="URL" error={error}>
            {(id) => (
              <Input
                id={id}
                data-autofocus
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(undefined);
                }}
                placeholder="github.com"
                inputMode="url"
              />
            )}
          </Field>
          <Field label="Title" hint="Optional — defaults to the site name.">
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="GitHub" maxLength={30} />}
          </Field>
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </Modal>

      <Modal open={manage} onClose={() => setManage(false)} title="Manage quick links" width={440}>
        <ul className="flex flex-col gap-1">
          {sorted.map((l, i) => (
            <li key={l.id} className="flex items-center gap-2 rounded-[var(--radius-ctl)] px-2 py-1.5 hover:bg-glow">
              <Favicon url={l.url} size={16} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{l.title}</span>
                <span className="block truncate text-xs text-faint">{l.url}</span>
              </span>
              <IconButton label={`Move ${l.title} up`} size="sm" disabled={i === 0} onClick={() => void run(reorderQuickLink(l.id, -1))}>
                <ArrowUp size={14} />
              </IconButton>
              <IconButton label={`Move ${l.title} down`} size="sm" disabled={i === sorted.length - 1} onClick={() => void run(reorderQuickLink(l.id, 1))}>
                <ArrowDown size={14} />
              </IconButton>
              <IconButton
                label={`Edit ${l.title}`}
                size="sm"
                onClick={() => {
                  setManage(false);
                  openForm(l);
                }}
              >
                <Pencil size={14} />
              </IconButton>
              <IconButton
                label={`Remove ${l.title}`}
                size="sm"
                onClick={async () => {
                  if (await confirm({ title: 'Remove quick link?', message: `“${l.title}” will be removed from Quick Links.`, confirmLabel: 'Remove', danger: true })) void run(removeQuickLink(l.id));
                }}
              >
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
        {sorted.length === 0 && <p className="text-sm text-muted">No quick links yet.</p>}
      </Modal>
    </Card>
  );
}
