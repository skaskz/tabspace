import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Bookmark, CheckSquare, FileText, Home, LayoutGrid, Settings2, Timer, type LucideIcon } from 'lucide-react';
import { LogoMark } from '@/components/layout/Logo';
import { Starfield } from '@/components/layout/Starfield';
import { useBackground } from '@/app/ThemeController';
import { useSettings } from '@/hooks/useStore';
import { openDashboard } from '@/app/router';
import { cn } from '@/utils/cn';
import type { SidebarSection } from '@/types/models';
import { SECTION_LABELS, enabledSections, loadLastSection, resolveSection, saveLastSection } from './sections';
import { currentWindowId, markPanelOpen } from '../shared/sidePanel';
import { mergeLocalBackups } from '../popup/quickNote';
import { BookmarksSection, FocusSection, NotesSection, SidebarHeadingLevel, TasksSection, WorkspacesSection } from './SidebarSections';

const ICONS: Record<SidebarSection, LucideIcon> = {
  focus: Timer,
  tasks: CheckSquare,
  notes: FileText,
  bookmarks: Bookmark,
  workspaces: LayoutGrid,
};

/**
 * Tabspace Chrome side panel: a narrow icon rail plus a compact content area
 * with only the essentials for the selected section. Chrome controls the
 * panel's width (roughly 320–400px+) and side.
 *
 * `preview` renders it contained (no fixed starfield) for the settings page.
 */
export function SidePanel({ preview = false, headingLevel = 1 }: { preview?: boolean; headingLevel?: 1 | 2 | 3 | 4 }) {
  const [settings, , loaded] = useSettings();
  const bg = useBackground();
  const [last, setLast] = useState<string | null | undefined>(undefined);
  const [current, setCurrent] = useState<SidebarSection | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadLastSection().then(setLast);
  }, []);

  // Quick notes from a popup that closed instantly (same extension origin, so same localStorage).
  useEffect(() => {
    if (!preview) void mergeLocalBackups().catch(() => undefined);
  }, [preview]);

  // Tell the popup which window shows the panel (getContexts may report windowId -1).
  useEffect(() => {
    if (preview || typeof chrome === 'undefined' || !chrome.runtime?.id) return;
    let wid: number | null = null;
    const onHide = () => wid !== null && void markPanelOpen(wid, false);
    void currentWindowId().then((id) => {
      wid = id;
      if (id !== null) void markPanelOpen(id, true);
    });
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, [preview]);

  const visible = enabledSections(settings);
  const resolved = current && visible.includes(current) ? current : resolveSection(settings, last);

  const choose = (s: SidebarSection) => {
    setCurrent(s);
    if (!preview) void saveLastSection(s);
  };

  const onRailKey = (e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || !visible.length) return;
    e.preventDefault();
    // Start from the *focused* tab (roving focus), falling back to the selected one.
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.section as SidebarSection | undefined;
    const from = focused && visible.includes(focused) ? focused : resolved;
    const i = from ? visible.indexOf(from) : -1;
    const next =
      e.key === 'Home' ? visible[0] : e.key === 'End' ? visible[visible.length - 1] : visible[(i + (e.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length];
    if (next) {
      choose(next);
      railRef.current?.querySelector<HTMLElement>(`[data-section="${next}"]`)?.focus();
    }
  };

  const ready = loaded && last !== undefined;
  const Main = preview ? 'div' : 'main';

  return (
    <div className={cn('relative flex overflow-hidden text-fg', preview ? 'h-full w-full bg-bg' : 'h-screen w-full')}>
      {!preview && bg.starfield && <Starfield animate={bg.animate} density={0.55} />}
      {preview && <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(1px 1px at 20% 30%, var(--ts-star) 50%, transparent 51%), radial-gradient(1px 1px at 70% 60%, var(--ts-star) 50%, transparent 51%), radial-gradient(1px 1px at 40% 85%, var(--ts-star) 50%, transparent 51%), radial-gradient(1px 1px at 85% 15%, var(--ts-star) 50%, transparent 51%)' }} />}

      <nav aria-label="Sidebar sections" className="relative z-20 flex w-12 shrink-0 flex-col items-center border-r border-line bg-bg/60 py-3 backdrop-blur-md">
        <div className="mb-4 flex h-8 items-center justify-center" title="Tabspace">
          <LogoMark size={22} />
          <span className="sr-only">Tabspace</span>
        </div>
        <div ref={railRef} role="tablist" aria-orientation="vertical" aria-label="Sections" onKeyDown={onRailKey} className="flex flex-col items-center gap-1">
          {visible.map((s) => (
            <RailButton key={s} section={s} active={s === resolved} onClick={() => choose(s)} />
          ))}
        </div>
        <div className="mt-auto flex flex-col items-center gap-1">
          <RailAction label="Sidebar settings" icon={Settings2} onClick={() => void openDashboard('sidebar')} />
          <RailAction label="Open full dashboard" icon={Home} onClick={() => void openDashboard('dashboard')} />
        </div>
      </nav>

      <Main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-y-auto">
        {!ready ? null : resolved ? (
          <div role="tabpanel" aria-label={SECTION_LABELS[resolved]} className="ts-fade-in flex min-h-full flex-col px-4 pt-4 pb-5" key={resolved}>
            <SidebarHeadingLevel.Provider value={headingLevel}>
              {resolved === 'focus' && <FocusSection />}
              {resolved === 'tasks' && <TasksSection />}
              {resolved === 'notes' && <NotesSection />}
              {resolved === 'bookmarks' && <BookmarksSection />}
              {resolved === 'workspaces' && <WorkspacesSection />}
            </SidebarHeadingLevel.Provider>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-muted">All sidebar sections are hidden.</p>
            <button type="button" className="text-[13px] underline underline-offset-2 hover:text-fg text-muted" onClick={() => void openDashboard('sidebar')}>
              Choose sections
            </button>
          </div>
        )}
      </Main>
    </div>
  );
}

/**
 * Rail tooltip: shown on hover and keyboard focus, hidden again as soon as the
 * button is clicked (until the pointer leaves) or loses focus, so it never sits
 * on top of the content the click just revealed. The button already has an
 * aria-label, so the tooltip is decorative for assistive tech.
 */
function Tip({ label, hidden }: { label: string; hidden: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-1/2 left-full z-50 ml-2 -translate-y-1/2 rounded-md border border-line bg-bg px-2 py-1 text-xs whitespace-nowrap text-fg opacity-0 shadow-lg transition-opacity',
        !hidden && 'group-hover:opacity-100 group-focus-visible:opacity-100',
      )}
    >
      {label}
    </span>
  );
}

function useTipSuppression() {
  const [suppressed, setSuppressed] = useState(false);
  return {
    suppressed,
    handlers: {
      onPointerDown: () => setSuppressed(true),
      onPointerLeave: () => setSuppressed(false),
      onBlur: () => setSuppressed(false),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') setSuppressed(true);
      },
    },
  };
}

function RailButton({ section, active, onClick }: { section: SidebarSection; active: boolean; onClick: () => void }) {
  const Icon = ICONS[section];
  const label = SECTION_LABELS[section];
  const tip = useTipSuppression();
  return (
    <button
      {...tip.handlers}
      type="button"
      role="tab"
      data-section={section}
      aria-selected={active}
      aria-label={label}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={cn(
        'group relative inline-flex h-9 w-9 items-center justify-center rounded-[10px] border transition-colors',
        active ? 'ts-active text-fg' : 'border-transparent text-muted hover:bg-glow hover:text-fg',
      )}
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden />
      <Tip label={label} hidden={tip.suppressed} />
    </button>
  );
}

function RailAction({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  const tip = useTipSuppression();
  return (
    <button {...tip.handlers} type="button" aria-label={label} onClick={onClick} className="group relative inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-muted transition-colors hover:bg-glow hover:text-fg">
      <Icon size={18} strokeWidth={1.75} aria-hidden />
      <Tip label={label} hidden={tip.suppressed} />
    </button>
  );
}
