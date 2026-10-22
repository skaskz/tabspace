import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, CheckCircle2, ChevronRight, LayoutDashboard, MoreHorizontal, PanelRight, Pause, Play, Plus, Square } from 'lucide-react';
import { LogoMark } from '@/components/layout/Logo';
import { Checkbox, IconButton } from '@/components/ui';
import { useSettings } from '@/hooks/useStore';
import { openDashboard } from '@/app/router';
import { update } from '@/storage/store';
import { kindLabel } from '@/features/focus/timer';
import { cn } from '@/utils/cn';
import { hostname } from '@/utils/url';
import { useFocusTimer } from '@/pages/focus/useFocusTimer';
import { applySidebarEnabled, canCloseNatively, closeSidePanel, currentWindowId, hasSidePanel, onOpenPanelsChanged, openSidePanel, openSidePanelWindows } from '../shared/sidePanel';
import { POPUP_MODE_KEY } from '../background/quickNoteCommand';
import { QuickNoteDraft, mergeLocalBackups, type PageLink, type SaveState } from './quickNote';
import { UpdateNotice } from '@/components/UpdateNotice';

/**
 * Toolbar popup (~300px): focus timer, Quick Note, dashboard, compact sidebar
 * controls. Opens straight into the Quick Note editor for `popup.html#note`
 * (bookmark / fallback window) or when the "quick-note" command set the
 * session flag. Closing the popup never touches the timer.
 */
export function Popup() {
  const [mode, setMode] = useState<'main' | 'note'>(() => (location.hash === '#note' ? 'note' : 'main'));
  const asTab = useWideViewport();

  // A previous popup that closed within milliseconds of typing may have left a local backup.
  useEffect(() => {
    void mergeLocalBackups().catch(() => undefined);
  }, []);

  // Quick-note command: flag in session storage (set before/while the popup opens).
  useEffect(() => {
    const area = typeof chrome !== 'undefined' ? chrome.storage?.session : undefined;
    if (!area) return;
    const take = () => {
      setMode('note');
      void area.set({ [POPUP_MODE_KEY]: null });
    };
    void area.get(POPUP_MODE_KEY).then((r) => r[POPUP_MODE_KEY] === 'note' && take());
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, name: string) => {
      if (name === 'session' && changes[POPUP_MODE_KEY]?.newValue === 'note') take();
    };
    const events = chrome.storage.onChanged;
    events.addListener(onChange);
    return () => events.removeListener(onChange);
  }, []);

  return (
    <div className={cn('text-fg', asTab ? 'flex min-h-screen items-center justify-center p-6' : '')}>
      <div className={cn('w-[300px] bg-bg', asTab && 'w-[340px] rounded-2xl border border-line p-1')}>
        {mode === 'note' ? <QuickNoteEditor onDone={() => setMode('main')} /> : <MainView onNewNote={() => setMode('note')} />}
      </div>
    </div>
  );
}

/** popup.html opened as a tab (bookmark) or a popup window: centre the card. */
function useWideViewport(): boolean {
  const [wide, setWide] = useState(() => window.innerWidth > 480);
  useEffect(() => {
    const on = () => setWide(window.innerWidth > 480);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return wide;
}

const sectionLabel = 'text-[10.5px] font-semibold tracking-[0.16em] text-faint uppercase';

function Row({ children, onClick, icon, primary, disabled, label }: { children: ReactNode; onClick: () => void; icon?: ReactNode; primary?: boolean; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex h-10 w-full items-center gap-2.5 rounded-[10px] border px-3 text-left text-[13.5px] transition-colors disabled:pointer-events-none disabled:opacity-40',
        primary ? 'border-transparent bg-fg font-medium text-bg hover:opacity-90' : 'border-line text-fg hover:border-line-strong hover:bg-glow',
      )}
    >
      {icon && (
        <span className={primary ? undefined : 'text-muted'} aria-hidden>
          {icon}
        </span>
      )}
      <span className="flex-1">{children}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Main view                                                           */
/* ------------------------------------------------------------------ */

function MainView({ onNewNote }: { onNewNote: () => void }) {
  const t = useFocusTimer();
  const isBreak = t.completion?.kind === 'short' || t.completion?.kind === 'long';
  const status = t.completion ? (isBreak ? 'Ready to focus again?' : 'Nice work — take a breather.') : t.focus.status === 'running' ? 'Running' : t.focus.status === 'paused' ? 'Paused' : 'Ready';
  const go = (page: 'dashboard' | 'focus') => void openDashboard(page).then(() => window.close());

  return (
    <div className="p-4">
      <header className="mb-4 flex items-center gap-2.5">
        <LogoMark size={20} />
        <h1 className="text-[11px] font-semibold tracking-[0.32em]">TABSPACE</h1>
      </header>

      <section aria-labelledby="popup-focus" className="rounded-[14px] border border-line px-4 pt-3 pb-4">
        <div className="flex items-center justify-between">
          <h2 id="popup-focus" className={sectionLabel}>
            Focus Session
          </h2>
          <span className="text-[11px] text-muted">{kindLabel(t.completion?.kind ?? t.focus.kind)}</span>
        </div>
        {/* Fixed 44px row in every state so nothing shifts. */}
        {t.completion ? (
          <div role="status" className="mt-1 flex h-[44px] items-center gap-2 text-[22px] font-medium tracking-[-0.02em]">
            <CheckCircle2 size={24} strokeWidth={1.75} aria-hidden />
            {isBreak ? 'Break complete' : 'Session complete'}
          </div>
        ) : (
          <div role="timer" aria-label={`${t.clock} ${t.focus.status === 'idle' ? 'session length' : 'remaining'}`} className="mt-1 h-[44px] text-[44px] leading-none font-light tracking-[-0.03em] tabular-nums">
            {t.clock}
          </div>
        )}
        <p className="mt-1.5 text-xs text-muted">{status}</p>
        <div className="mt-3 flex gap-2">
          {t.completion ? (
            <>
              <SmallButton primary onClick={() => void t.startNext()}>
                {t.completion.nextLabel}
              </SmallButton>
              <SmallButton onClick={() => void t.startAgain()}>Start again</SmallButton>
            </>
          ) : t.focus.status === 'idle' ? (
            <SmallButton primary onClick={() => void t.toggle()} icon={<Play size={13} fill="currentColor" />}>
              Start
            </SmallButton>
          ) : (
            <>
              <SmallButton primary onClick={() => void t.toggle()} icon={t.running ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}>
                {t.running ? 'Pause' : 'Resume'}
              </SmallButton>
              <SmallButton onClick={() => void t.stop()} icon={<Square size={11} />}>
                Stop
              </SmallButton>
            </>
          )}
        </div>
        <button type="button" onClick={() => go('focus')} className="mt-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
          Open Focus Mode <ChevronRight size={13} aria-hidden />
        </button>
      </section>

      <section aria-labelledby="popup-notes" className="mt-4">
        <h2 id="popup-notes" className={cn(sectionLabel, 'mb-2')}>
          Quick Notes
        </h2>
        <Row icon={<Plus size={16} />} onClick={onNewNote}>
          New Note
        </Row>
      </section>

      <SidebarControls />

      <footer className="mt-3 flex flex-col gap-2">
        <UpdateNotice variant="compact" />
        <Row icon={<LayoutDashboard size={16} />} onClick={() => go('dashboard')}>
          Open Dashboard
        </Row>
      </footer>
    </div>
  );
}

function SmallButton({ children, onClick, primary, icon }: { children: ReactNode; onClick: () => void; primary?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors',
        primary ? 'border-transparent bg-fg text-bg hover:opacity-90' : 'border-line text-fg hover:border-line-strong hover:bg-glow',
      )}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar controls (compact row)                                      */
/* ------------------------------------------------------------------ */

function SidebarControls() {
  const [settings, , loaded] = useSettings();
  const [windowId, setWindowId] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [more, setMore] = useState(false);
  const available = hasSidePanel();
  const enabled = settings.sidebar.enabled;

  const refreshOpen = useCallback(async (wid: number | null) => {
    if (wid === null) return setPanelOpen(null);
    const wins = await openSidePanelWindows();
    setPanelOpen(wins ? wins.includes(wid) : null);
  }, []);

  useEffect(() => {
    let wid: number | null = null;
    void currentWindowId().then((id) => {
      wid = id;
      setWindowId(id);
      void refreshOpen(id);
    });
    return onOpenPanelsChanged(() => void refreshOpen(wid));
  }, [refreshOpen]);

  const open = () => {
    if (windowId === null) return;
    // Must run synchronously in the click (user gesture) — no await before this call.
    openSidePanel(windowId).then(
      () => window.close(),
      (e: unknown) => setMessage({ text: e instanceof Error ? e.message : 'Chrome could not open the sidebar.', error: true }),
    );
  };

  const close = async () => {
    if (windowId === null) return;
    try {
      const how = await closeSidePanel(windowId);
      setPanelOpen(false);
      setMessage({ text: how === 'closed' ? 'Sidebar closed.' : 'Sidebar closed in all windows.' });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Could not close the sidebar.', error: true });
    }
  };

  const setEnabled = async (value: boolean) => {
    // Only the flag changes — sidebar content (tasks, notes…) is never touched.
    await update('ts.settings', (s) => ({ ...s, sidebar: { ...s.sidebar, enabled: value } }));
    await applySidebarEnabled(value).catch(() => undefined);
    setPanelOpen(false);
    setMore(false);
    setMessage({ text: value ? 'Sidebar enabled.' : 'Sidebar disabled. Your data is kept — enable it again any time.' });
  };

  if (!available) return null;
  const statusText = !enabled ? 'Sidebar is disabled' : panelOpen ? 'Sidebar is open' : 'Sidebar is ready';
  const pill = 'h-7 whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-40';

  return (
    <div className="mt-4 border-t border-line pt-3">
      {/* Fixed-height row: rendered before async state resolves, so opening the popup never shifts layout. */}
      <div className="flex h-8 items-center gap-2">
        <PanelRight size={15} className="shrink-0 text-muted" aria-hidden />
        <span className={cn('mr-auto truncate text-xs', enabled ? 'text-muted' : 'text-fg')} role="status">
          {loaded ? statusText : 'Sidebar'}
        </span>
        {!enabled ? (
          <button type="button" className={cn(pill, 'border-transparent bg-fg text-bg hover:opacity-90')} onClick={() => void setEnabled(true)} aria-label="Enable Sidebar">
            Enable
          </button>
        ) : panelOpen ? (
          <button type="button" className={cn(pill, 'border-line text-fg hover:border-line-strong')} onClick={() => void close()} disabled={windowId === null} aria-label="Close Sidebar" title={!canCloseNatively() ? 'Closes in all windows' : undefined}>
            Close
          </button>
        ) : (
          <button type="button" className={cn(pill, 'border-line text-fg hover:border-line-strong')} onClick={open} disabled={windowId === null} aria-label="Open Sidebar">
            Open
          </button>
        )}
        {enabled && (
          <IconButton label="More sidebar options" size="sm" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            <MoreHorizontal size={15} />
          </IconButton>
        )}
      </div>
      {enabled && more && (
        <div className="mt-1 flex justify-end">
          <button type="button" className="rounded-md px-2 py-1 text-xs text-muted hover:bg-glow hover:text-fg" onClick={() => void setEnabled(false)}>
            Disable Sidebar
          </button>
        </div>
      )}
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={cn('mt-1.5 text-xs', message.error ? 'text-danger' : 'text-muted')}>
          {message.text}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Quick Note editor                                                   */
/* ------------------------------------------------------------------ */

/** Active http(s) page of the last focused normal browser window (works from the popup and the fallback window). */
async function activePageLink(): Promise<PageLink | null> {
  if (typeof chrome === 'undefined' || !chrome.windows?.getLastFocused) return null;
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win.id === undefined) return null;
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (!tab?.url || !/^https?:\/\//i.test(tab.url)) return null;
    return { url: tab.url, title: tab.title };
  } catch {
    return null;
  }
}

const STATUS: Record<SaveState, string> = { empty: '', pending: 'Saving…', saving: 'Saving…', saved: 'Saved', error: 'Couldn’t save' };

export function QuickNoteEditor({ onDone }: { onDone: () => void }) {
  const [settings, , loaded] = useSettings();
  const [state, setState] = useState<SaveState>('empty');
  const draftRef = useRef<QuickNoteDraft | null>(null);
  if (!draftRef.current) draftRef.current = new QuickNoteDraft(setState);
  const draft = draftRef.current;
  const [text, setText] = useState('');
  const [link, setLink] = useState<PageLink | null>(null);
  const [attach, setAttach] = useState<boolean | null>(null);

  useEffect(() => {
    void activePageLink().then(setLink);
  }, []);
  // Default from settings once loaded; the user's choice in this note then wins.
  useEffect(() => {
    if (loaded && attach === null) setAttach(settings.quickNote.attachUrl);
  }, [loaded, attach, settings.quickNote.attachUrl]);
  useEffect(() => {
    draft.setLink(attach && link ? link : null);
  }, [draft, attach, link]);

  // The popup can close at any moment: hand unsaved text to storage synchronously.
  useEffect(() => {
    const flush = () => draft.flushSync();
    const onVis = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
      flush();
      draft.dispose();
    };
  }, [draft]);

  const finish = async () => {
    await draft.save().catch(() => undefined);
    onDone();
  };

  const openInNotes = async () => {
    await draft.save().catch(() => undefined);
    if (draft.noteId) await openDashboard('notes', { id: draft.noteId });
    window.close();
  };

  return (
    <div className="flex flex-col p-3">
      <header className="mb-2 flex items-center gap-1">
        <IconButton label="Back" size="sm" onClick={() => void finish()}>
          <ArrowLeft size={16} />
        </IconButton>
        <h1 className="text-[13px] font-semibold">Quick Note</h1>
        <span className="ml-auto flex items-center gap-1 text-[11.5px] text-muted" role="status" aria-live="polite">
          {state === 'saved' && <Check size={12} aria-hidden />}
          {STATUS[state]}
        </span>
      </header>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          draft.setText(e.target.value);
        }}
        rows={9}
        placeholder={'Title on the first line…\nThen anything you want to remember.'}
        aria-label="Quick note (first line is the title)"
        className="w-full resize-none rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed text-fg placeholder:text-faint focus:border-line-strong"
        style={{ outline: 'none' }}
      />
      {link && (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          <Checkbox size="sm" checked={!!attach} onChange={(v) => setAttach(v)} label="Attach this page's link" />
          <span className="min-w-0 truncate">
            Attach this page’s link <span className="text-faint">· {hostname(link.url)}</span>
          </span>
        </label>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => void openInNotes()} disabled={!draft.noteId} className="mr-auto text-xs text-muted hover:text-fg disabled:opacity-40">
          Open in Notes
        </button>
        <button type="button" onClick={() => void finish()} className="h-8 rounded-lg bg-fg px-4 text-[12.5px] font-medium text-bg hover:opacity-90">
          Done
        </button>
      </div>
    </div>
  );
}
