import { useEffect, useRef, useState } from 'react';
import { CalendarPlus, FileUp, Link2, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import { Button, Checkbox, Field, Input, Menu, Modal, useConfirm, useToast } from '@/components/ui';
import { insert, patch } from '@/storage/store';
import { useSettings } from '@/hooks/useStore';
import type { CalendarSource } from '@/types/models';
import { formatRelative } from '@/utils/date';
import { cn } from '@/utils/cn';
import { feedUrlProblem, ICS_MAX_BYTES, IcsError, normalizeFeedUrl, parseIcs } from '@/features/calendar/ics';
import { fetchFeedText, requestFeedPermission } from '@/integrations/ics/feed';
import { removeSource, replaceSourceEvents, SYNC_DAYS_AHEAD, SYNC_DAYS_BACK, syncSource } from '@/integrations/calendarSync';
import { connectGoogle, hasGoogleMarker, listGoogleCalendars, type GoogleCalendarInfo } from '@/integrations/google/client';
import { identityAvailable } from '@/integrations/secrets';
import { SOURCE_COLORS } from './calendarUi';

type NewSource = Omit<CalendarSource, 'id' | 'createdAt' | 'updatedAt'>;

function nextColor(sources: CalendarSource[]): string {
  return SOURCE_COLORS.find((c) => !sources.some((s) => s.color === c)) ?? SOURCE_COLORS[sources.length % SOURCE_COLORS.length];
}

const KIND_LABEL: Record<CalendarSource['kind'], string> = { local: 'Local', 'ics-url': 'ICS feed', 'ics-file': 'Imported file', google: 'Google' };

export function CalendarsPanel({ sources }: { sources: CalendarSource[] }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CalendarSource | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const sync = (s: CalendarSource) => {
    // Request (or re-confirm) host access synchronously inside the click for ICS feeds.
    const perm = s.kind === 'ics-url' && s.url ? requestFeedPermission(s.url) : Promise.resolve(true);
    setSyncing(s.id);
    void perm
      .then(async (granted) => {
        if (!granted) {
          toast('Access to the feed’s website was not allowed.', 'error');
          return;
        }
        const r = await syncSource(s, { interactive: true });
        if (r.ok) toast(`Synced “${s.name}” · ${r.count ?? 0} events`);
        else toast(r.error ?? 'Sync failed.', 'error');
      })
      .finally(() => setSyncing(null));
  };

  const removeIt = async (s: CalendarSource) => {
    const ok = await confirm({ title: `Remove “${s.name}”?`, message: 'This calendar and all of its events will be removed from Tabspace.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await removeSource(s.id);
    toast(`Removed “${s.name}”`);
  };

  return (
    <aside id="calendars-panel" aria-label="Calendars" className="ts-card w-60 shrink-0 self-start p-4 max-xl:w-full">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Calendars</h2>
      </div>
      {sources.length === 0 && <p className="mb-3 text-[13px] text-muted">No calendars yet. Events you add go to a local “Personal” calendar.</p>}
      <ul className="flex flex-col gap-1">
        {sources.map((s) => (
          <li key={s.id} className="group rounded-lg px-1.5 py-1.5 hover:bg-glow">
            <div className="flex items-center gap-2.5">
              <Checkbox size="sm" checked={s.enabled} onChange={(v) => void patch('ts.calendarSources', s.id, { enabled: v })} label={`Show ${s.name}`} className="shrink-0" />
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{s.name}</span>
                <span className="block truncate text-[11.5px] text-faint">
                  {KIND_LABEL[s.kind]}
                  {syncing === s.id ? ' · Syncing…' : s.lastSyncedAt ? ` · Synced ${formatRelative(s.lastSyncedAt)}` : ''}
                </span>
              </span>
              <Menu
                label={`Options for ${s.name}`}
                trigger={<MoreHorizontal size={16} />}
                items={[
                  { label: 'Rename', onSelect: () => setEditing(s) },
                  { label: 'Change colour', onSelect: () => setEditing(s) },
                  ...(s.kind === 'ics-url' || s.kind === 'google' ? [{ label: 'Sync now', icon: <RefreshCw size={14} />, onSelect: () => sync(s) }] : []),
                  { label: 'Remove', danger: true, onSelect: () => void removeIt(s) },
                ]}
              />
            </div>
            {s.lastError && (
              <p role="status" className="mt-1 pl-7 text-[11.5px] text-danger">
                {s.lastError}
              </p>
            )}
          </li>
        ))}
      </ul>
      <Button className="mt-3 w-full" icon={<Plus size={16} />} onClick={() => setAdding(true)}>
        Add calendar
      </Button>
      {adding && <AddCalendarModal sources={sources} onClose={() => setAdding(false)} />}
      {editing && <EditSourceModal source={editing} onClose={() => setEditing(null)} />}
    </aside>
  );
}

function EditSourceModal({ source, onClose }: { source: CalendarSource; onClose: () => void }) {
  const [name, setName] = useState(source.name);
  const [color, setColor] = useState(source.color);
  const save = async () => {
    if (!name.trim()) return;
    await patch('ts.calendarSources', source.id, { name: name.trim().slice(0, 100), color });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit calendar"
      width={400}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">{(id) => <Input id={id} data-autofocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />}</Field>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-muted">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {SOURCE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={cn('h-8 w-8 rounded-lg border-2', color === c ? 'border-fg' : 'border-transparent')}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

type AddMode = 'choose' | 'local' | 'url' | 'file' | 'google';

function AddCalendarModal({ sources, onClose }: { sources: CalendarSource[]; onClose: () => void }) {
  const [mode, setMode] = useState<AddMode>('choose');
  const titles: Record<AddMode, string> = { choose: 'Add calendar', local: 'New local calendar', url: 'Subscribe via ICS URL', file: 'Import .ics file', google: 'Connect Google Calendar' };
  return (
    <Modal open onClose={onClose} title={titles[mode]} width={480}>
      {mode === 'choose' && (
        <div className="grid gap-2">
          {[
            { m: 'local' as const, icon: <CalendarPlus size={18} />, t: 'Local calendar', d: 'Stored only in this browser.' },
            { m: 'url' as const, icon: <Link2 size={18} />, t: 'Subscribe via ICS URL', d: 'Any calendar’s secret iCal / webcal link. Syncs hourly.' },
            { m: 'file' as const, icon: <FileUp size={18} />, t: 'Import .ics file', d: 'A one-time copy of a calendar file (max 5 MB).' },
            { m: 'google' as const, icon: <CalendarPlus size={18} />, t: 'Connect Google Calendar', d: 'Read-only, using your own Google OAuth client.' },
          ].map((o) => (
            <button key={o.m} type="button" onClick={() => setMode(o.m)} className="ts-hover flex items-start gap-3 rounded-[var(--radius-ctl)] border border-line p-3 text-left">
              <span className="mt-0.5 text-muted">{o.icon}</span>
              <span>
                <span className="block text-sm font-medium">{o.t}</span>
                <span className="block text-[13px] text-muted">{o.d}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {mode === 'local' && <AddLocal sources={sources} onDone={onClose} />}
      {mode === 'url' && <AddUrl sources={sources} onDone={onClose} />}
      {mode === 'file' && <AddFile sources={sources} onDone={onClose} />}
      {mode === 'google' && <AddGoogle sources={sources} onDone={onClose} />}
      {mode !== 'choose' && (
        <button type="button" className="mt-4 text-[13px] text-muted hover:text-fg" onClick={() => setMode('choose')}>
          ← Other options
        </button>
      )}
    </Modal>
  );
}

function AddLocal({ sources, onDone }: { sources: CalendarSource[]; onDone: () => void }) {
  const [name, setName] = useState('');
  const create = async () => {
    if (!name.trim()) return;
    await insert('ts.calendarSources', { name: name.trim().slice(0, 100), kind: 'local', color: nextColor(sources), enabled: true } satisfies NewSource);
    onDone();
  };
  return (
    <div className="flex flex-col gap-4">
      <Field label="Name">{(id) => <Input id={id} data-autofocus placeholder="e.g. Training" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />}</Field>
      <Button variant="primary" onClick={() => void create()} disabled={!name.trim()}>
        Create calendar
      </Button>
    </div>
  );
}

function AddUrl({ sources, onDone }: { sources: CalendarSource[]; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const subscribe = () => {
    const normalized = normalizeFeedUrl(url);
    if (!normalized) {
      setError(feedUrlProblem(url) ?? 'Enter a valid https:// or webcal:// calendar URL.');
      return;
    }
    if (sources.some((s) => s.url === normalized)) {
      setError('You are already subscribed to this feed.');
      return;
    }
    setError(null);
    // Permission request must happen synchronously in the click handler.
    const perm = requestFeedPermission(normalized);
    setBusy(true);
    void perm
      .then(async (granted) => {
        if (!granted) throw new IcsError('Tabspace needs permission to read this site to fetch the feed.');
        const text = await fetchFeedText(normalized);
        const parsed = parseIcs(text, 'preview', { daysBack: SYNC_DAYS_BACK, daysAhead: SYNC_DAYS_AHEAD });
        const src = await insert('ts.calendarSources', {
          name: (name.trim() || parsed.calendarName || new URL(normalized).hostname).slice(0, 100),
          kind: 'ics-url',
          color: nextColor(sources),
          enabled: true,
          url: normalized,
          lastSyncedAt: Date.now(),
        } satisfies NewSource);
        await replaceSourceEvents(
          src.id,
          parsed.events.map((e) => ({ ...e, sourceId: src.id, id: e.id.replace(/^preview:/, `${src.id}:`) })),
        );
        toast(`Subscribed · ${parsed.events.length} events`);
        onDone();
      })
      .catch((e) => setError(e instanceof IcsError ? e.message : 'Could not subscribe to this feed.'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Calendar URL" hint="Paste the private iCal / .ics / webcal:// address. It is stored only on this device and fetched directly — never sent to anyone else." error={error ?? undefined}>
        {(id) => <Input id={id} data-autofocus type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="webcal://… or https://…/calendar.ics" value={url} onChange={(e) => setUrl(e.target.value)} />}
      </Field>
      <Field label="Name (optional)">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Button variant="primary" onClick={subscribe} disabled={busy || !url.trim()}>
        {busy ? 'Subscribing…' : 'Subscribe'}
      </Button>
    </div>
  );
}

function AddFile({ sources, onDone }: { sources: CalendarSource[]; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > ICS_MAX_BYTES) {
      setError('This file is larger than 5 MB.');
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseIcs(text, 'preview');
      const src = await insert('ts.calendarSources', {
        name: (parsed.calendarName || file.name.replace(/\.ics$/i, '') || 'Imported calendar').slice(0, 100),
        kind: 'ics-file',
        color: nextColor(sources),
        enabled: true,
        lastSyncedAt: Date.now(),
      } satisfies NewSource);
      await replaceSourceEvents(
        src.id,
        parsed.events.map((e) => ({ ...e, sourceId: src.id, id: e.id.replace(/^preview:/, `${src.id}:`) })),
      );
      toast(`Imported ${parsed.events.length} events${parsed.truncated ? ' (limited)' : ''}`);
      onDone();
    } catch (e) {
      setError(e instanceof IcsError ? e.message : 'Could not read this file.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">Events are copied into Tabspace. Recurring events are expanded from 90 days ago to about a year ahead.</p>
      <label className="ts-hover flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-ctl)] border border-dashed border-line-strong px-4 py-8 text-center text-sm">
        <FileUp size={20} className="text-muted" aria-hidden />
        {busy ? 'Importing…' : 'Choose an .ics file'}
        <input type="file" accept=".ics,text/calendar" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} disabled={busy} />
      </label>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function AddGoogle({ sources, onDone }: { sources: CalendarSource[]; onDone: () => void }) {
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, , settingsLoaded] = useSettings();
  const hasClientId = settingsLoaded ? !!settings.integrations.googleClientId?.trim() : null;
  const [marker, setMarker] = useState(false);
  const toast = useToast();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void hasGoogleMarker().then((m) => mounted.current && setMarker(m));
    return () => {
      mounted.current = false;
    };
  }, []);

  const existing = new Set(sources.filter((s) => s.kind === 'google').map((s) => s.googleCalendarId));

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const list = marker ? await listGoogleCalendars({ interactive: true }) : await connectGoogle();
      setMarker(true);
      setCalendars(list);
      setPicked(new Set(list.filter((c) => c.primary && !existing.has(c.id)).map((c) => c.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect to Google.');
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!calendars) return;
    setBusy(true);
    let total = 0;
    const failures: string[] = [];
    let all = [...sources];
    for (const c of calendars.filter((x) => picked.has(x.id))) {
      const color = c.backgroundColor && /^#[0-9a-f]{6}$/i.test(c.backgroundColor) ? c.backgroundColor : nextColor(all);
      const src = await insert('ts.calendarSources', { name: c.summary.slice(0, 100), kind: 'google', color, enabled: true, googleCalendarId: c.id } satisfies NewSource);
      all = [...all, src];
      const r = await syncSource(src, { interactive: true });
      if (r.ok) total += r.count ?? 0;
      else failures.push(`${c.summary}: ${r.error}`);
    }
    setBusy(false);
    if (failures.length) setError(failures.join(' '));
    else {
      toast(`Added Google calendars · ${total} events`);
      onDone();
    }
  };

  if (!identityAvailable()) return <p className="text-sm text-muted">Google sign-in works only inside the installed Chrome extension.</p>;
  if (hasClientId === false) {
    return (
      <div className="space-y-3 text-sm text-muted">
        <p>Google Calendar needs your own OAuth client ID (free). Follow the setup steps in Settings, then come back.</p>
        <a href="#/settings?section=integrations" className="font-medium text-fg underline underline-offset-4">
          Open Settings → Integrations
        </a>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {!calendars && (
        <>
          <p className="text-[13px] text-muted">Tabspace asks for read-only access and shows the calendars you choose. Your sign-in token stays in this browser session.</p>
          <Button variant="primary" onClick={() => void load()} disabled={busy || hasClientId === null}>
            {busy ? 'Waiting for Google…' : marker ? 'Choose calendars' : 'Sign in with Google'}
          </Button>
        </>
      )}
      {calendars && (
        <>
          {calendars.length === 0 && <p className="text-sm text-muted">No calendars were found on this Google account.</p>}
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {calendars.map((c) => {
              const already = existing.has(c.id);
              return (
                <li key={c.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <Checkbox
                    size="sm"
                    checked={already || picked.has(c.id)}
                    onChange={(v) =>
                      !already &&
                      setPicked((p) => {
                        const n = new Set(p);
                        if (v) n.add(c.id);
                        else n.delete(c.id);
                        return n;
                      })
                    }
                    label={c.summary}
                  />
                  <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c.backgroundColor && /^#[0-9a-f]{6}$/i.test(c.backgroundColor) ? c.backgroundColor : 'var(--ts-muted)' }} />
                  <span className="truncate text-sm">{c.summary}</span>
                  {already && <span className="ml-auto text-[12px] text-faint">Added</span>}
                </li>
              );
            })}
          </ul>
          <Button variant="primary" onClick={() => void add()} disabled={busy || picked.size === 0}>
            {busy ? 'Syncing…' : `Add ${picked.size || ''} calendar${picked.size === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
