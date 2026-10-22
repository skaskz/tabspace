import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, PanelRight, Plus } from 'lucide-react';
import { PageHero } from '@/components/layout/PageHero';
import { Button, IconButton, Segmented, useConfirm, useToast } from '@/components/ui';
import { useStore } from '@/hooks/useStore';
import { useNow } from '@/hooks/useNow';
import { insert, patch, remove } from '@/storage/store';
import { getOccurrences, type Occurrence } from '@/features/calendar/occurrences';
import { eventToForm, formToEvent, newEventForm, type EventForm } from '@/features/calendar/editor';
import { addDays, monthGrid, startOfDay } from '@/utils/date';
import { AGENDA_DAYS, rangeTitle, startOfWeek, type CalendarView } from './calendarUi';
import { AgendaView, MonthView, TimeGridView, weekDays } from './views';
import { EventDetails, EventEditor } from './EventModals';
import { CalendarsPanel } from './CalendarsPanel';

const PANEL_KEY = 'tabspace:calendar-panel';

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' },
];

function rangeFor(view: CalendarView, cursor: Date): [Date, Date] {
  if (view === 'month') {
    const g = monthGrid(cursor.getFullYear(), cursor.getMonth());
    return [g[0], addDays(g[41], 1)];
  }
  if (view === 'week') {
    const s = startOfWeek(cursor);
    return [s, addDays(s, 7)];
  }
  const s = startOfDay(cursor);
  return [s, addDays(s, view === 'day' ? 1 : AGENDA_DAYS)];
}

function shift(view: CalendarView, cursor: Date, dir: 1 | -1): Date {
  if (view === 'month') return new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
  return addDays(cursor, dir * (view === 'week' ? 7 : view === 'day' ? 1 : AGENDA_DAYS));
}

export default function CalendarPage() {
  const [events] = useStore('ts.events');
  const [sources] = useStore('ts.calendarSources');
  const [workspaces] = useStore('ts.workspaces');
  const confirm = useConfirm();
  const toast = useToast();
  const nowMs = useNow(60_000);
  const now = new Date(nowMs);
  const today = startOfDay(now);

  const [view, setView] = useState<CalendarView>('month');
  const [cursor, setCursor] = useState<Date>(today);
  const [selected, setSelected] = useState<Date>(today);
  const [details, setDetails] = useState<Occurrence | null>(null);
  const [editor, setEditor] = useState<{ form: EventForm; eventId?: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(PANEL_KEY);
      if (saved !== null) return saved === '1';
    } catch {
      /* storage unavailable */
    }
    return typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1536px)').matches;
  });
  const togglePanel = () =>
    setPanelOpen((open) => {
      try {
        localStorage.setItem(PANEL_KEY, open ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !open;
    });

  const [rangeStart, rangeEnd] = rangeFor(view, cursor);
  const occurrences = useMemo(() => getOccurrences(events, sources, rangeStart, rangeEnd), [events, sources, rangeStart.getTime(), rangeEnd.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const defaultSourceId = sources.find((s) => s.kind === 'local' && s.enabled)?.id ?? sources.find((s) => s.kind === 'local')?.id ?? '';

  const select = (d: Date) => {
    setSelected(d);
    if (view === 'month' && d.getMonth() !== cursor.getMonth()) setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  };
  const create = (d: Date, hour?: number) => {
    const form = newEventForm(d, defaultSourceId, now);
    if (hour !== undefined) {
      const hh = String(hour).padStart(2, '0');
      const endH = Math.min(hour + 1, 23);
      Object.assign(form, { startTime: `${hh}:00`, endTime: endH === hour ? '23:59' : `${String(endH).padStart(2, '0')}:00` });
    }
    setSelected(d);
    setEditor({ form });
  };

  const save = async (f: EventForm): Promise<string | null> => {
    let sourceId = f.sourceId;
    if (!sourceId) {
      // First local event: create a default local calendar.
      const src = await insert('ts.calendarSources', { name: 'Personal', kind: 'local', color: '#a78bfa', enabled: true });
      sourceId = src.id;
    }
    const r = formToEvent({ ...f, sourceId });
    if (!r.ok) return r.error;
    if (editor?.eventId) {
      // formToEvent sets removed optional fields to undefined, which clears them.
      await patch('ts.events', editor.eventId, r.value);
      toast('Event updated');
    } else {
      await insert('ts.events', r.value);
      toast('Event added');
    }
    setEditor(null);
    return null;
  };

  const del = async (o: Occurrence) => {
    const repeating = o.event.recurrence && o.event.recurrence !== 'none';
    const ok = await confirm({ title: `Delete “${o.event.title}”?`, message: repeating ? 'This deletes every occurrence of this repeating event.' : 'This event will be permanently deleted.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await remove('ts.events', o.event.id);
    setDetails(null);
    toast('Event deleted');
  };

  const goToday = () => {
    setCursor(view === 'month' ? new Date(today.getFullYear(), today.getMonth(), 1) : today);
    setSelected(today);
  };

  return (
    <div>
      <PageHero title={rangeTitle(view, cursor)} subtitle="Stay organized. Keep track of your schedule, deadlines, and goals." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="Calendar view"
          value={view}
          onChange={(v) => {
            setView(v);
            setCursor(v === 'month' ? new Date(selected.getFullYear(), selected.getMonth(), 1) : selected);
          }}
          options={VIEWS}
        />
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={goToday}>
            Today
          </Button>
          <IconButton label="Previous" onClick={() => setCursor((c) => shift(view, c, -1))}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Next" onClick={() => setCursor((c) => shift(view, c, 1))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" icon={<PanelRight size={15} />} aria-expanded={panelOpen} aria-controls="calendars-panel" onClick={togglePanel}>
          Calendars{sources.length ? ` (${sources.length})` : ''}
        </Button>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => create(selected)}>
          Add Event
        </Button>
      </div>

      <div className="flex items-start gap-5 max-xl:flex-col">
        <div className="min-w-0 flex-1 max-xl:w-full">
          {view === 'month' && <MonthView cursor={cursor} selected={selected} today={today} occurrences={occurrences} onSelect={select} onCreate={create} onOpen={setDetails} onShowDay={(d) => { setSelected(d); setCursor(d); setView('day'); }} />}
          {view === 'week' && <TimeGridView days={weekDays(cursor)} today={today} occurrences={occurrences} onCreate={create} onOpen={setDetails} />}
          {view === 'day' && <TimeGridView days={[startOfDay(cursor)]} today={today} occurrences={occurrences} onCreate={create} onOpen={setDetails} />}
          {view === 'agenda' && <AgendaView start={startOfDay(cursor)} today={today} occurrences={occurrences} onOpen={setDetails} onCreate={create} />}
          {events.length === 0 && view === 'month' && <p className="mt-3 text-[13px] text-muted">No events yet — double-click a day or use “Add Event”. You can also subscribe to an ICS feed or connect Google Calendar from the Calendars panel.</p>}
        </div>
        {panelOpen && <CalendarsPanel sources={sources} />}
      </div>

      <EventDetails
        occ={details}
        workspaces={workspaces}
        onClose={() => setDetails(null)}
        onEdit={() => {
          if (!details) return;
          setEditor({ form: eventToForm(details.event), eventId: details.event.id });
          setDetails(null);
        }}
        onDelete={() => details && void del(details)}
      />
      {editor && <EventEditor initial={editor.form} editing={!!editor.eventId} sources={sources} workspaces={workspaces} onClose={() => setEditor(null)} onSave={save} />}
    </div>
  );
}
