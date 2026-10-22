import { useState } from 'react';
import { CalendarDays, Clock, MapPin, Repeat } from 'lucide-react';
import { Button, Field, Input, Modal, Select, Textarea, Toggle } from '@/components/ui';
import type { Occurrence } from '@/features/calendar/occurrences';
import { REMINDER_OPTIONS, type EventForm } from '@/features/calendar/editor';
import type { CalendarSource, Recurrence, Workspace } from '@/types/models';
import { formatOccurrence } from './calendarUi';

const RECURRENCE: { value: Recurrence; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
];

export function EventDetails({ occ, workspaces, onClose, onEdit, onDelete }: { occ: Occurrence | null; workspaces: Workspace[]; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  if (!occ) return null;
  const e = occ.event;
  const local = occ.source?.kind === 'local' || !occ.source;
  const ws = workspaces.find((w) => w.id === e.workspaceId);
  const reminder = REMINDER_OPTIONS.find((r) => r.value === (e.reminderMinutes ?? null));
  return (
    <Modal
      open
      onClose={onClose}
      title={e.title}
      width={480}
      footer={
        local ? (
          <>
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
            <Button variant="primary" onClick={onEdit}>
              Edit
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <dl className="space-y-3 text-sm">
        <div className="flex gap-3">
          <dt className="sr-only">When</dt>
          <Clock size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <dd>{formatOccurrence(occ)}</dd>
        </div>
        {e.recurrence && e.recurrence !== 'none' && (
          <div className="flex gap-3">
            <dt className="sr-only">Repeats</dt>
            <Repeat size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <dd>{RECURRENCE.find((r) => r.value === e.recurrence)?.label}</dd>
          </div>
        )}
        {e.location && (
          <div className="flex gap-3">
            <dt className="sr-only">Location</dt>
            <MapPin size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <dd className="break-words">{e.location}</dd>
          </div>
        )}
        <div className="flex gap-3">
          <dt className="sr-only">Calendar</dt>
          <CalendarDays size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <dd className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: occ.source?.color ?? 'var(--ts-muted)' }} />
            {occ.source?.name ?? 'Calendar'}
            {ws && <span className="text-muted">· {ws.name}</span>}
          </dd>
        </div>
        {local && reminder && reminder.value !== null && <p className="text-[13px] text-muted">Reminder: {reminder.label.toLowerCase()}</p>}
        {e.description && <p className="whitespace-pre-wrap break-words border-t border-line pt-3 text-[13.5px] text-muted">{e.description}</p>}
        {!local && <p className="rounded-[var(--radius-ctl)] border border-line bg-surface-2 px-3 py-2 text-[13px] text-muted">This event comes from “{occ.source?.name}” and is read-only here. Change it in its original calendar.</p>}
      </dl>
    </Modal>
  );
}

export function EventEditor({ initial, editing, sources, workspaces, onClose, onSave }: {
  initial: EventForm;
  editing: boolean;
  sources: CalendarSource[];
  workspaces: Workspace[];
  onClose: () => void;
  onSave: (f: EventForm) => Promise<string | null>;
}) {
  const [f, setF] = useState<EventForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const localSources = sources.filter((s) => s.kind === 'local');

  const submit = async () => {
    setSaving(true);
    const err = await onSave(f);
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit event' : 'New event'}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            {editing ? 'Save' : 'Add event'}
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
        <Field label="Title" error={error ?? undefined}>
          {(id) => <Input id={id} data-autofocus value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Content shoot" maxLength={300} />}
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-muted">All day</span>
          <Toggle checked={f.allDay} onChange={(v) => set('allDay', v)} label="All day" />
        </div>
        <div className="grid grid-cols-1 gap-3">
          <Field label="Starts">
            {(id) => (
              <div className="flex gap-2">
                <Input
                  id={id}
                  type="date"
                  className="flex-1"
                  value={f.startDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    setF((cur) => ({ ...cur, startDate: v, endDate: cur.endDate < v ? v : cur.endDate }));
                  }}
                />
                {!f.allDay && <Input type="time" aria-label="Start time" className="w-36" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} />}
              </div>
            )}
          </Field>
          <Field label="Ends">
            {(id) => (
              <div className="flex gap-2">
                <Input id={id} type="date" className="flex-1" value={f.endDate} min={f.startDate} onChange={(e) => set('endDate', e.target.value)} />
                {!f.allDay && <Input type="time" aria-label="End time" className="w-36" value={f.endTime} onChange={(e) => set('endTime', e.target.value)} />}
              </div>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeat">
            {(id) => (
              <Select id={id} value={f.recurrence} onChange={(e) => set('recurrence', e.target.value as Recurrence)}>
                {RECURRENCE.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reminder">
            {(id) => (
              <Select id={id} value={f.reminderMinutes === null ? '' : String(f.reminderMinutes)} onChange={(e) => set('reminderMinutes', e.target.value === '' ? null : Number(e.target.value))}>
                {REMINDER_OPTIONS.map((r) => (
                  <option key={String(r.value)} value={r.value === null ? '' : String(r.value)}>
                    {r.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Calendar">
            {(id) => (
              <Select id={id} value={f.sourceId} onChange={(e) => set('sourceId', e.target.value)}>
                {localSources.length === 0 && <option value="">New “Personal” calendar</option>}
                {localSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Workspace">
            {(id) => (
              <Select id={id} value={f.workspaceId} onChange={(e) => set('workspaceId', e.target.value)}>
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
        <Field label="Location">{(id) => <Input id={id} value={f.location} onChange={(e) => set('location', e.target.value)} maxLength={500} />}</Field>
        <Field label="Description">{(id) => <Textarea id={id} rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />}</Field>
        {editing && f.recurrence !== 'none' && <p className="text-xs text-faint">Changes apply to every occurrence of this repeating event.</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
