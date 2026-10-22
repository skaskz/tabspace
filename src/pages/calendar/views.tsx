import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { occurrencesOnDay, type Occurrence } from '@/features/calendar/occurrences';
import { addDays, isSameDay, monthGrid, startOfDay, toDateKey } from '@/utils/date';
import { cn } from '@/utils/cn';
import { AGENDA_DAYS, layoutLanes, shortTime, startOfWeek, timeLabel } from './calendarUi';

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2026, 1, 1 + i).toLocaleDateString(undefined, { weekday: 'short' })); // Feb 1 2026 is a Sunday

function Dot({ color }: { color?: string }) {
  return <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-[3px]" style={{ background: color ?? 'var(--ts-muted)' }} />;
}

function Chip({ o, onOpen }: { o: Occurrence; onOpen: (o: Occurrence) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(o);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="flex w-full min-w-0 items-start gap-1 rounded-md px-1 py-[3px] text-left text-[12px] leading-tight text-fg hover:bg-glow"
      title={`${o.event.title}${o.allDay ? '' : ` · ${timeLabel(o.start)}`}`}
    >
      <span className="mt-[3px]">
        <Dot color={o.source?.color} />
      </span>
      <span className="line-clamp-2 min-w-0 flex-1 break-words">
        {!o.allDay && <span className="mr-1 text-faint tabular-nums">{shortTime(o.start)}</span>}
        {o.event.title}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Month                                                               */
/* ------------------------------------------------------------------ */

export function MonthView({ cursor, selected, today, occurrences, onSelect, onCreate, onOpen, onShowDay }: {
  cursor: Date;
  selected: Date;
  today: Date;
  occurrences: Occurrence[];
  onSelect: (d: Date) => void;
  onCreate: (d: Date) => void;
  onOpen: (o: Occurrence) => void;
  onShowDay: (d: Date) => void;
}) {
  const days = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${toDateKey(selected)}"]`)?.focus();
  }, [selected]);

  const onKey = (e: KeyboardEvent) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (delta === undefined) return;
    if (!(e.target as HTMLElement).dataset.day) return;
    e.preventDefault();
    focusPending.current = true;
    onSelect(addDays(selected, delta));
  };

  return (
    <div className="ts-card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line" aria-hidden>
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-3 py-2.5 text-[12px] font-medium text-muted">
            {w}
          </div>
        ))}
      </div>
      <div ref={gridRef} role="grid" aria-label="Month" className="grid grid-cols-7 grid-rows-6" onKeyDown={onKey}>
        {days.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = isSameDay(d, today);
          const isSel = isSameDay(d, selected);
          const list = occurrencesOnDay(occurrences, d);
          const shown = list.slice(0, 3);
          const more = list.length - shown.length;
          const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
          return (
            <div
              key={i}
              role="gridcell"
              aria-selected={isSel}
              className={cn(
                'group relative min-h-[112px] border-line p-1.5 max-md:min-h-[72px]',
                i % 7 !== 6 && 'border-r',
                i < 35 && 'border-b',
                !inMonth && 'bg-black/10',
                isSel && 'outline outline-1 -outline-offset-1 outline-line-strong',
              )}
              onClick={() => onSelect(d)}
              onDoubleClick={() => onCreate(d)}
            >
              <div className="mb-1 flex items-center justify-between">
                <button
                  type="button"
                  data-day={toDateKey(d)}
                  tabIndex={isSel ? 0 : -1}
                  aria-label={`${label}${list.length ? `, ${list.length} event${list.length === 1 ? '' : 's'}` : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(d);
                  }}
                  className={cn(
                    'flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-[13px]',
                    isToday ? 'bg-fg font-semibold text-bg ring-2 ring-line-strong ring-offset-2 ring-offset-transparent' : inMonth ? 'text-fg' : 'text-faint',
                  )}
                >
                  {d.getDate()}
                </button>
                <button
                  type="button"
                  aria-label={`Add event on ${label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreate(d);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-faint opacity-0 hover:bg-glow hover:text-fg focus:opacity-100 group-hover:opacity-100"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="flex flex-col gap-0.5">
                {shown.map((o) => (
                  <Chip key={o.key} o={o} onOpen={onOpen} />
                ))}
                {more > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onShowDay(d);
                    }}
                    className="px-1.5 text-left text-[12px] text-muted hover:text-fg"
                  >
                    +{more} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Week / Day                                                          */
/* ------------------------------------------------------------------ */

const HOUR_PX = 44;

export function TimeGridView({ days, today, occurrences, onCreate, onOpen }: { days: Date[]; today: Date; occurrences: Occurrence[]; onCreate: (d: Date, hour?: number) => void; onOpen: (o: Occurrence) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX;
  }, []);
  const now = new Date();
  const cols = days.map((d) => {
    const dayStart = startOfDay(d).getTime();
    const dayEnd = addDays(startOfDay(d), 1).getTime();
    const onDay = occurrencesOnDay(occurrences, d);
    const allDay = onDay.filter((o) => o.allDay);
    const timed = layoutLanes(
      onDay
        .filter((o) => !o.allDay)
        .map((o) => ({ o, start: Math.max(o.start.getTime(), dayStart), end: Math.max(Math.min(o.end.getTime(), dayEnd), Math.max(o.start.getTime(), dayStart) + 20 * 60_000) })),
    );
    return { d, dayStart, allDay, timed };
  });
  const hasAllDay = cols.some((c) => c.allDay.length);
  const template = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className="ts-card overflow-hidden">
      <div className="grid border-b border-line" style={template}>
        <div />
        {cols.map(({ d }) => (
          <div key={d.toISOString()} className="border-l border-line px-2 py-2 text-center">
            <div className="text-[12px] text-muted">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
            <div className={cn('mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-[15px]', isSameDay(d, today) && 'bg-fg font-semibold text-bg')}>{d.getDate()}</div>
          </div>
        ))}
      </div>
      <div className="grid border-b border-line" style={template}>
        <div className="px-2 py-1.5 text-right text-[11px] text-faint">All day</div>
        {cols.map(({ d, allDay }) => (
          <div key={d.toISOString()} className="flex min-h-8 flex-col gap-0.5 border-l border-line p-1">
            {allDay.map((o) => (
              <Chip key={o.key} o={o} onOpen={onOpen} />
            ))}
            {!hasAllDay && <span className="sr-only">No all-day events</span>}
          </div>
        ))}
      </div>
      <div ref={scrollRef} className="max-h-[620px] overflow-y-auto">
        <div className="relative grid" style={{ ...template, height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-faint" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}
              </div>
            ))}
          </div>
          {cols.map(({ d, dayStart, timed }) => (
            <div key={d.toISOString()} className="relative border-l border-line">
              {Array.from({ length: 24 }, (_, h) => (
                <button
                  key={h}
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  onDoubleClick={() => onCreate(d, h)}
                  className="absolute inset-x-0 border-t border-line/60 hover:bg-glow"
                  style={{ top: h * HOUR_PX, height: HOUR_PX }}
                />
              ))}
              {isSameDay(d, now) && <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 h-px bg-fg/70" style={{ top: ((now.getTime() - dayStart) / 3600_000) * HOUR_PX }} />}
              {timed.map(({ o, start, end, lane, lanes }) => {
                const top = ((start - dayStart) / 3600_000) * HOUR_PX;
                const height = Math.max(18, ((end - start) / 3600_000) * HOUR_PX - 2);
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => onOpen(o)}
                    className="absolute z-[5] overflow-hidden rounded-md border border-line-strong bg-surface-3 px-1.5 py-1 text-left text-[12px] leading-tight hover:border-fg/50"
                    style={{ top, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, borderLeft: `3px solid ${o.source?.color ?? 'var(--ts-muted)'}` }}
                    title={`${o.event.title} · ${timeLabel(o.start)}`}
                  >
                    <div className="truncate font-medium">{o.event.title}</div>
                    {height > 30 && <div className="truncate text-faint">{timeLabel(o.start)} – {timeLabel(o.end)}</div>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function weekDays(cursor: Date): Date[] {
  const s = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/* ------------------------------------------------------------------ */
/* Agenda                                                              */
/* ------------------------------------------------------------------ */

export function AgendaView({ start, today, occurrences, onOpen, onCreate }: { start: Date; today: Date; occurrences: Occurrence[]; onOpen: (o: Occurrence) => void; onCreate: (d: Date) => void }) {
  const days = Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(start, i))
    .map((d) => ({ d, list: occurrencesOnDay(occurrences, d) }))
    .filter((x) => x.list.length);
  if (!days.length) {
    return (
      <div className="ts-card">
        <EmptyState title="Nothing scheduled" description={`No events in the next ${AGENDA_DAYS} days.`} action={<button type="button" className="text-[13px] underline underline-offset-4" onClick={() => onCreate(start)}>Add an event</button>} />
      </div>
    );
  }
  return (
    <div className="ts-card divide-y divide-line">
      {days.map(({ d, list }) => (
        <section key={toDateKey(d)} className="flex gap-6 px-5 py-4 max-md:flex-col max-md:gap-2">
          <h3 className="w-40 shrink-0 text-[13px]">
            <span className={cn('font-semibold', isSameDay(d, today) && 'underline underline-offset-4')}>{isSameDay(d, today) ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long' })}</span>
            <span className="block text-muted">{d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</span>
          </h3>
          <ul className="flex min-w-0 flex-1 flex-col gap-1">
            {list.map((o) => (
              <li key={o.key}>
                <button type="button" onClick={() => onOpen(o)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-glow">
                  <Dot color={o.source?.color} />
                  <span className="w-36 shrink-0 text-[13px] text-muted">{o.allDay ? 'All day' : `${timeLabel(o.start)} – ${timeLabel(o.end)}`}</span>
                  <span className="truncate">{o.event.title}</span>
                  {o.event.location && <span className="ml-auto truncate text-[12px] text-faint max-md:hidden">{o.event.location}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
