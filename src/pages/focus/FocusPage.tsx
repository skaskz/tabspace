import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarCheck, Check, ChevronRight, Clock, Copy, Flame, Heart, Music, Pause, Play, Plus, RefreshCw, RotateCcw, Settings2, ShieldBan, Square, Target, Timer, X } from 'lucide-react';
import { PageHero } from '@/components/layout/PageHero';
import { Button, Card, CardHeader, Checkbox, Favicon, IconButton, Input, Tag, Toggle, useConfirm, useToast } from '@/components/ui';
import { SpotifyPanel } from '@/integrations/spotify/SpotifyPanel';
import { navigate, useRoute } from '@/app/router';
import { useStore } from '@/hooks/useStore';
import { useNow } from '@/hooks/useNow';
import { clampMinutes, kindLabel } from '@/features/focus/timer';
import { focusStreak, focusTimeOn, sessionsOn } from '@/features/focus/stats';
import { normalizeBlockDomain, shouldBlock } from '@/features/blocking/rules';
import { useDailyQuote } from '@/features/quotes/useDailyQuote';
import { createTask, toggleTaskDone } from '@/features/tasks/actions';
import { selectFocusKind, stopFocus } from '@/services/focus';
import { requestBlockingPermission, useBlockingPermission } from '@/extension/shared/permissions';
import { formatDuration, toDateKey } from '@/utils/date';
import { cn } from '@/utils/cn';
import type { FocusKind } from '@/types/models';
import { FocusRing } from './FocusRing';
import { patchSettings, useFocusTimer } from './useFocusTimer';
import { isWidgetVisible, setWidgetVisible } from '@/extension/newtab/layout';

/**
 * Focus Mode. Layout keeps everything important above the fold at 1536×1024:
 * timer card (with stats strip + settings popover) on the left; Spotify
 * (always the top slot), blocker, goals and the daily quote on the right.
 */
export default function FocusPage() {
  const { params } = useRoute();
  const blocked = params.get('blocked');
  const { settings } = useFocusTimer();
  const spotifyConfigured = !!settings.integrations.spotifyClientId?.trim();
  return (
    <div className="max-w-[1400px]">
      <PageHero title="Focus Mode" subtitle="Eliminate distractions. Stay in the zone. Get more done." />
      {blocked && <BlockedBanner domain={blocked} />}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <TimerCard />
        <div className="flex min-w-0 flex-col gap-4">
          {/* One fixed slot (top of the right column) for every Spotify state; min height = the compact row. */}
          <div className="min-h-12">{spotifyConfigured ? <SpotifyPanel /> : <SpotifyRow />}</div>
          <BlockerCard />
          <GoalsCard />
          <QuoteCard />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BlockedBanner({ domain }: { domain: string }) {
  const { clock, running } = useFocusTimer();
  const safe = normalizeBlockDomain(domain) ?? 'This site';
  return (
    <Card className="mb-5 flex flex-wrap items-center gap-4 px-5 py-3.5" role="status">
      <ShieldBan size={20} className="text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{safe} is blocked by Focus Mode</p>
        <p className="text-[13px] text-muted">{running ? `It unblocks when this session ends — ${clock} left. Stay in the zone.` : 'The session has ended, so the site is available again.'}</p>
      </div>
      <IconButton label="Dismiss" size="sm" onClick={() => navigate('focus')}>
        <X size={16} />
      </IconButton>
    </Card>
  );
}

/** One-line placeholder while Spotify isn't set up (the full panel would be setup text). */
function SpotifyRow() {
  return (
    <button type="button" onClick={() => navigate('settings')} className="ts-card ts-hover flex h-12 w-full items-center gap-3 px-4 text-left">
      <Music size={16} className="shrink-0 text-muted" aria-hidden />
      <span className="text-sm font-medium">Focus Playlist</span>
      <span className="ml-auto flex items-center gap-1 text-[13px] text-muted">
        Connect Spotify <ChevronRight size={14} aria-hidden />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */

const KINDS: { value: FocusKind; label: string }[] = [
  { value: 'focus', label: 'Focus' },
  { value: 'short', label: 'Short Break' },
  { value: 'long', label: 'Long Break' },
  { value: 'custom', label: 'Custom' },
];

function TimerCard() {
  const t = useFocusTimer();
  const confirm = useConfirm();
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const kind = t.focus.kind;

  const choose = async (k: FocusKind) => {
    if (k === kind && !t.active) return;
    if (t.active) {
      const ok = await confirm({ title: `Switch to ${kindLabel(k)}?`, message: 'The current session will stop. Focus time over a minute is still saved.', confirmLabel: 'Switch' });
      if (!ok) return;
      await stopFocus();
    }
    await selectFocusKind(k);
  };

  const commitCustom = async (raw: string) => {
    setCustomDraft(null);
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n)) return;
    const min = clampMinutes(n);
    await patchSettings((s) => ({ ...s, focus: { ...s.focus, customMin: min } }));
    if (!t.active) await selectFocusKind('custom', min);
  };

  const done = t.completion;
  const isBreak = (done?.kind ?? kind) === 'short' || (done?.kind ?? kind) === 'long';
  const heading = isBreak ? 'Break' : 'Focus Session';
  const caption = done ? (isBreak ? 'Break complete' : 'Session complete') : t.focus.status === 'paused' ? 'Paused' : isBreak ? 'Breathe. Reset.' : 'Stay in the zone';

  return (
    <Card className="relative flex flex-col">
      <div className="absolute top-4 right-4">
        <SettingsPopover />
      </div>
      <div className="flex flex-col items-center px-6 pt-6 pb-6">
        <div role="radiogroup" aria-label="Session type" className="flex flex-wrap items-center justify-center gap-1.5 px-10">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => void choose(k.value)}
              className={cn(
                'inline-flex h-9 items-center rounded-[var(--radius-ctl)] border px-4 text-[13px] transition-colors',
                kind === k.value ? 'ts-active text-fg' : 'border-line bg-surface-2/60 text-muted hover:border-line-strong hover:text-fg',
              )}
            >
              {k.label}
            </button>
          ))}
          {kind === 'custom' && (
            <label className="ml-1 inline-flex h-9 items-center gap-2 rounded-[var(--radius-ctl)] border border-line bg-surface-2/60 pr-3 pl-1 text-[13px] text-muted">
              <input
                type="number"
                min={1}
                max={240}
                aria-label="Custom session minutes (1 to 240)"
                disabled={t.active}
                value={customDraft ?? String(t.settings.focus.customMin)}
                onChange={(e) => setCustomDraft(e.target.value)}
                onBlur={(e) => void commitCustom(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                className="h-7 w-14 rounded-md bg-transparent text-center text-fg tabular-nums outline-none focus:bg-surface-3 disabled:opacity-50"
              />
              min
            </label>
          )}
        </div>

        <FocusRing progress={t.progress} size={272} className="mt-6" label={`${Math.round(t.progress * 100)}% complete`}>
          <span className="text-[13px] tracking-wide text-muted">{heading}</span>
          <span role="timer" aria-live="off" aria-label={`${t.clock} remaining`} className="mt-1 text-[4rem] leading-none font-light tracking-[-0.04em] tabular-nums">
            {t.clock}
          </span>
          <span className={cn('mt-3 text-[13px]', done ? 'font-medium text-fg' : 'text-muted')} role={done ? 'status' : undefined}>
            {caption}
          </span>
        </FocusRing>

        {done ? (
          <div className="mt-6 flex h-16 items-center gap-3">
            <Button variant="primary" onClick={() => void t.startNext()}>
              {done.nextLabel}
            </Button>
            <Button onClick={() => void t.startAgain()}>Start again</Button>
          </div>
        ) : (
          <div className="mt-6 flex items-center gap-6">
            <IconButton label="Reset timer" onClick={() => void t.reset()} disabled={!t.active} className="h-11 w-11 rounded-full border border-line hover:border-line-strong">
              <RotateCcw size={17} />
            </IconButton>
            <button
              type="button"
              onClick={() => void t.toggle()}
              aria-label={t.running ? 'Pause session' : t.focus.status === 'paused' ? 'Resume session' : `Start ${kindLabel(kind)} session`}
              className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-fg text-bg shadow-[0_0_30px_rgba(255,255,255,0.12)] transition-opacity hover:opacity-90"
            >
              {t.running ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="translate-x-0.5" />}
            </button>
            <IconButton label="Stop session" onClick={() => void t.stop()} disabled={!t.active} className="h-11 w-11 rounded-full border border-line hover:border-line-strong">
              <Square size={15} />
            </IconButton>
          </div>
        )}
      </div>
      <StatsStrip />
    </Card>
  );
}

function SettingsPopover() {
  const { settings } = useFocusTimer();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const row = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-[13px]">{label}</span>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  );
  return (
    <div ref={wrap} className="relative">
      <IconButton ref={trigger} label="Focus settings" size="sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Settings2 size={16} />
      </IconButton>
      {open && (
        <div role="dialog" aria-label="Focus settings" className="ts-card ts-fade-in absolute top-full right-0 z-30 mt-1 w-64 px-4 py-2 shadow-xl" style={{ background: 'var(--ts-bg)' }}>
          {row('Timer badge on toolbar', settings.focus.showBadge, (v) => void patchSettings((s) => ({ ...s, focus: { ...s.focus, showBadge: v } })))}
          {row('Notify when sessions end', settings.notifications.focus, (v) => void patchSettings((s) => ({ ...s, notifications: { ...s.notifications, focus: v } })))}
          {row('Chime when sessions end', settings.focus.sound, (v) => void patchSettings((s) => ({ ...s, focus: { ...s.focus, sound: v } })))}
          {row('Quotes on New Tab', isWidgetVisible(settings.newTab, 'quote'), (v) => void patchSettings((s) => ({ ...s, newTab: setWidgetVisible(s.newTab, 'quote', v) })))}
          <button type="button" onClick={() => navigate('settings')} className="mt-1 mb-1 flex items-center gap-1 text-xs text-muted hover:text-fg">
            Durations and more in Settings <ChevronRight size={12} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Stat({ icon, label, value, children }: { icon: ReactNode; label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-5 py-3.5">
      <div className="flex items-center gap-1.5 truncate text-xs text-muted">
        <span aria-hidden>{icon}</span>
        {label}
      </div>
      <div className="truncate text-lg font-semibold tracking-[-0.02em] tabular-nums">{value}</div>
      {children}
    </div>
  );
}

function StatsStrip() {
  const t = useFocusTimer();
  const [records] = useStore('ts.focusSessions');
  const now = useNow(60_000);
  const today = toDateKey(now);
  const count = sessionsOn(records, today);
  const goal = Math.max(1, t.settings.focus.sessionsGoal);
  const time = focusTimeOn(records, today);
  const streak = focusStreak(records, now);
  return (
    <div className="grid grid-cols-2 border-t border-line sm:grid-cols-4 sm:divide-x sm:divide-line">
      <Stat icon={<Timer size={13} />} label="Current Session" value={`${kindLabel(t.focus.kind)} · ${Math.round(t.total / 60_000)}m`} />
      <Stat icon={<CalendarCheck size={13} />} label="Sessions Today" value={`${count}/${goal}`}>
        <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Daily session goal" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(count, goal)}>
          <div className="h-full rounded-full bg-fg/80 transition-[width]" style={{ width: `${Math.min(100, (count / goal) * 100)}%` }} />
        </div>
      </Stat>
      <Stat icon={<Clock size={13} />} label="Focus Time Today" value={time > 0 ? formatDuration(time) : '0m'} />
      <Stat icon={<Flame size={13} />} label="Streak" value={`${streak} day${streak === 1 ? '' : 's'}`} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BlockerCard() {
  const t = useFocusTimer();
  const toast = useToast();
  const permission = useBlockingPermission();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { blocklist } = t.settings.focus;
  // Without the permission blocking can't run, so the toggle honestly shows "off".
  const blockSites = t.settings.focus.blockSites && permission !== false;
  const active = blockSites && shouldBlock(t.settings, t.focus);

  const setBlocking = (v: boolean) => {
    if (!v) return void patchSettings((s) => ({ ...s, focus: { ...s.focus, blockSites: false } }));
    // Requested synchronously inside the click (Chrome requires a user gesture).
    void requestBlockingPermission().then((r) => {
      if (r === 'denied') {
        toast('Site blocking needs Chrome’s permission to block pages. It stays off.', 'error');
        return patchSettings((s) => ({ ...s, focus: { ...s.focus, blockSites: false } }));
      }
      return patchSettings((s) => ({ ...s, focus: { ...s.focus, blockSites: true } }));
    });
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const d = normalizeBlockDomain(draft);
    if (!d) return setError('Enter a domain like youtube.com');
    if (blocklist.includes(d)) return setError(`${d} is already on the list`);
    setError(null);
    setDraft('');
    await patchSettings((s) => ({ ...s, focus: { ...s.focus, blocklist: [...s.focus.blocklist.filter((x) => x !== d), d] } }));
  };

  const removeDomain = async (d: string) => {
    await patchSettings((s) => ({ ...s, focus: { ...s.focus, blocklist: s.focus.blocklist.filter((x) => x !== d) } }));
    toast(`${d} removed from the blocklist`);
  };

  return (
    <Card>
      <CardHeader title="Website Blocker" icon={<ShieldBan size={16} />} className="pb-2" action={<Toggle label="Block distracting sites during focus" checked={blockSites} onChange={setBlocking} />} />
      <div className="px-5 pb-4">
        <p className="mb-2.5 text-xs text-muted">
          Blocks these sites only while a focus session runs.
          {active && <Tag className="ml-2 h-5 align-middle">Active now</Tag>}
        </p>
        <form onSubmit={add} className="flex gap-2">
          <Input
            className="flex-1"
            placeholder="Add a domain, e.g. news.ycombinator.com"
            aria-label="Domain to block"
            aria-invalid={!!error}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
          />
          <IconButton type="submit" label="Add domain" disabled={!draft.trim()} className="h-10 w-10 border border-line">
            <Plus size={16} />
          </IconButton>
        </form>
        {error && (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {error}
          </p>
        )}
        {blocklist.length === 0 ? (
          <p className="mt-3 text-xs text-faint">No sites on the list yet.</p>
        ) : (
          <ul className={cn('mt-3 flex flex-wrap gap-1.5', !blockSites && 'opacity-60')} aria-label="Blocked sites">
            {blocklist.map((d) => (
              <li key={d} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2/60 pr-1 pl-2 text-[12.5px]">
                <Favicon url={`https://${d}`} size={13} />
                <span className="max-w-[160px] truncate">{d}</span>
                <button type="button" aria-label={`Remove ${d}`} onClick={() => void removeDomain(d)} className="inline-flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-glow hover:text-fg">
                  <X size={12} />
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

function GoalsCard() {
  const toast = useToast();
  const [tasks] = useStore('ts.tasks');
  const now = useNow(60_000);
  const today = toDateKey(now);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const goals = tasks
    .filter((x) => x.dueDate === today && (!x.done || (x.completedAt && toDateKey(x.completedAt) === today)))
    .sort((a, b) => Number(a.done) - Number(b.done) || a.order - b.order)
    .slice(0, 3);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    setAdding(false);
    await createTask({ title, dueDate: today });
  };

  return (
    <Card>
      <CardHeader
        title="Focus Goals"
        icon={<Target size={16} />}
        className="pb-1"
        action={
          !adding && (
            <IconButton label="Add goal for today" size="sm" onClick={() => setAdding(true)}>
              <Plus size={15} />
            </IconButton>
          )
        }
      />
      <div className="px-5 pb-4">
        {goals.length === 0 && !adding && <p className="text-xs text-faint">No tasks due today. Add one goal for this session.</p>}
        <ul className="flex flex-col">
          {goals.map((g) => (
            <li key={g.id} className="flex min-h-8 items-center gap-3">
              <Checkbox size="sm" checked={g.done} label={`Mark "${g.title}" ${g.done ? 'not done' : 'done'}`} onChange={() => void toggleTaskDone(g.id).catch(() => toast('Could not update the task', 'error'))} />
              <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', g.done && 'text-faint line-through')}>{g.title}</span>
            </li>
          ))}
        </ul>
        {adding && (
          <form onSubmit={submit} className="mt-2 flex gap-2">
            <Input autoFocus className="flex-1" placeholder="e.g. Push Tabspace to GitHub" aria-label="New goal" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
            <Button type="submit" disabled={!draft.trim()}>
              Add
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}

function QuoteCard() {
  const { quote, favorite, refresh, toggleFav } = useDailyQuote();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`“${quote.text}” — ${quote.author}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Could not copy to the clipboard', 'error');
    }
  };
  return (
    <Card className="px-5 pt-4 pb-4">
      <figure>
        <blockquote className="text-[15px] leading-relaxed font-medium tracking-[-0.01em]">“{quote.text}”</blockquote>
        <figcaption className="mt-2 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted" title={quote.source}>
            — {quote.author}
          </span>
          <span className="-mr-2 flex shrink-0 items-center">
            <IconButton label="Show another quote" size="sm" onClick={refresh}>
              <RefreshCw size={14} />
            </IconButton>
            <IconButton label={favorite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={favorite} size="sm" onClick={toggleFav}>
              <Heart size={14} fill={favorite ? 'currentColor' : 'none'} className={favorite ? 'text-fg' : undefined} />
            </IconButton>
            <IconButton label={copied ? 'Copied' : 'Copy quote'} size="sm" onClick={() => void copy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </span>
        </figcaption>
      </figure>
    </Card>
  );
}
