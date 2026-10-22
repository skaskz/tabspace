import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { Check, EyeOff, LayoutDashboard, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { LogoMark } from '@/components/layout/Logo';
import { Starfield } from '@/components/layout/Starfield';
import { useBackground } from '@/app/ThemeController';
import { Button, useToast } from '@/components/ui';
import { update } from '@/storage/store';
import type { NewTabLayout, NewTabWidgetId } from '@/types/models';
import { TabspaceBar } from '@/extension/bar/TabspaceBar';
import { useSettings } from '@/hooks/useStore';
import { useNow } from '@/hooks/useNow';
import { dashboardUrl, openDashboard } from '@/app/router';
import { useDailyQuote } from '@/features/quotes/useDailyQuote';
import { isSafeUrl } from '@/utils/url';
import { hubLimits, LazySpotifyMiniPlayer, useViewportHeight } from '@/pages/dashboard/LazySpotify';
import { HubNavProvider, type HubGo } from '@/pages/dashboard/hubNav';
import { RecentTabsCard, TodayTasksCard, WorkspacesCard } from '@/pages/dashboard/MainWidgets';
import { CalendarStateProvider, FocusCard, MonthCalendar, UpcomingEvents } from '@/pages/dashboard/SidebarWidgets';
import { FavoriteLinksCard } from '@/pages/dashboard/FavoriteLinks';
import { resolveSearch, SEARCH_ENGINES } from './search';
import { HubLayout } from './HubLayout';
import { hideWidget, layoutSettingsPatch, resetLayout, resolveLayout } from './layout';

const CHROME_NTP = 'chrome://new-tab-page';

/** Starfield with the V2 `parallax` prop (typed here so this page compiles before and after the prop lands). */
const ParallaxStarfield = Starfield as ComponentType<ComponentProps<typeof Starfield> & { parallax?: boolean }>;

/** Split "4:27 PM" into time + day period using the user's locale (24h locales get no period). */
export function clockParts(now: number): { time: string; period: string } {
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).formatToParts(new Date(now));
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  const time = parts
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim();
  return { time, period };
}

export function dateLine(now: number): string {
  const d = new Date(now);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
  const month = d.toLocaleDateString(undefined, { month: 'short' });
  return `${weekday}, ${month} ${d.getDate()}, ${d.getFullYear()}`.toUpperCase();
}

export function NewTab() {
  const [settings, , loaded] = useSettings();
  const [redirectFailed, setRedirectFailed] = useState(false);
  const disabled = loaded && !settings.newTab.enabled;

  useEffect(() => {
    document.title = 'New Tab';
  }, []);

  useEffect(() => {
    if (!disabled) return;
    // Hand the tab to Chrome's own New Tab page. chrome://newtab would loop back to this override.
    if (typeof chrome === 'undefined' || !chrome.tabs?.getCurrent) return setRedirectFailed(true);
    void chrome.tabs
      .getCurrent()
      .then((tab) => (tab?.id !== undefined ? chrome.tabs.update(tab.id, { url: CHROME_NTP }) : Promise.reject(new Error('no tab'))))
      .catch(() => setRedirectFailed(true));
  }, [disabled]);

  if (!loaded) return null;
  if (disabled) {
    return redirectFailed ? (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted">The Tabspace New Tab is turned off, but Chrome's default page couldn't be opened here.</p>
        <button type="button" className="text-[13px] text-muted underline underline-offset-2 hover:text-fg" onClick={() => void openDashboard('settings')}>
          Tabspace settings
        </button>
      </div>
    ) : null;
  }
  return <NewTabContent />;
}

/** The New Tab hub: header, then the user's widget layout (customisable). */
export function NewTabContent() {
  const [settings] = useSettings();
  const bg = useBackground();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  // In the New Tab, going to a dashboard page loads it in this same tab.
  const go = useCallback<HubGo>((page, params) => window.location.assign(dashboardUrl(page, params)), []);
  // List lengths follow the window height so the hub fits without scrolling.
  const viewportHeight = useViewportHeight();
  const layout = useMemo(() => resolveLayout(settings.newTab), [settings.newTab]);
  const showBar = !layout.hidden.includes('bar');
  // The Tabspace Bar strip (~40 px) takes height from the widgets.
  const limits = hubLimits(viewportHeight - (showBar && settings.tabspaceBar.onNewTab ? 40 : 0));

  const save = (next: NewTabLayout) =>
    void update('ts.settings', (s) => ({ ...s, newTab: layoutSettingsPatch(s.newTab, next) })).catch(() => toast('Could not save the layout.', 'error'));

  const render = (id: NewTabWidgetId): ReactNode => {
    switch (id) {
      case 'clock':
        return <Clock />;
      case 'search':
        return <SearchBox engine={settings.newTab.searchEngine} autoFocus={!editing} />;
      case 'quote':
        return <DailyQuote />;
      case 'workspaces':
        return <WorkspacesCard launch limit={limits.workspaces} />;
      case 'tasks':
        return <TodayTasksCard limit={limits.tasks} />;
      case 'recentTabs':
        return <RecentTabsCard limit={limits.recentTabs} />;
      case 'calendar':
        return <MonthCalendar />;
      case 'upcoming':
        return <UpcomingEvents limit={limits.upcoming} />;
      case 'focus':
        return <FocusCard />;
      case 'spotify':
        return <LazySpotifyMiniPlayer />;
      case 'quickLinks':
        return <FavoriteLinksCard max={limits.quickLinks} columns={3} />;
      case 'bar':
        return null;
    }
  };

  return (
    <HubNavProvider value={go}>
      <CalendarStateProvider>
        <div className="relative min-h-screen text-fg">
          {bg.image ? (
            <div aria-hidden className="fixed inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: `url(${bg.image})` }} />
          ) : (
            bg.starfield && <ParallaxStarfield animate={bg.animate} parallax={settings.parallax} />
          )}

          <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col gap-3 px-6 pt-3 pb-5 max-sm:px-4">
            <h1 className="sr-only">New Tab</h1>
            {showBar && !editing && settings.tabspaceBar.onNewTab && <TabspaceBar surface="newtab" />}
            <header className="flex items-center justify-between gap-4">
              <a
                href={dashboardUrl('dashboard')}
                onClick={(e) => {
                  e.preventDefault();
                  go('dashboard');
                }}
                className="flex items-center gap-2.5 rounded-lg text-muted opacity-85 hover:text-fg hover:opacity-100"
                aria-label="Tabspace dashboard"
              >
                <LogoMark size={24} />
                <span className="text-sm font-medium">Tabspace</span>
              </a>
              <div className="flex min-w-0 items-center gap-2">
                {editing ? (
                  <>
                    <span className="mr-2 text-xs text-muted max-md:hidden">Drag widgets, or use the arrow buttons. Changes save automatically.</span>
                    <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => save(resetLayout())}>
                      Reset to default
                    </Button>
                    <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => setEditing(false)}>
                      Done
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" icon={<SlidersHorizontal size={14} />} onClick={() => setEditing(true)}>
                      Customize
                    </Button>
                    <Button size="sm" icon={<LayoutDashboard size={15} />} onClick={() => go('dashboard')}>
                      Open dashboard
                    </Button>
                  </>
                )}
              </div>
            </header>

            {editing && showBar && (
              <div role="group" aria-label="Tabspace Bar widget" className="flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-2 text-xs text-muted">
                <span className="font-medium text-fg">Tabspace Bar</span>
                <span className="truncate">{settings.tabspaceBar.onNewTab ? 'Pinned across the top.' : 'Turned off in Settings › Tabspace Bar.'}</span>
                <Button size="sm" variant="ghost" className="ml-auto" icon={<EyeOff size={14} />} onClick={() => save(hideWidget(layout, 'bar'))} aria-label="Hide Tabspace Bar">
                  Hide
                </Button>
              </div>
            )}

            <div className={editing ? '' : 'flex flex-col gap-3 [@media(min-height:1000px)]:flex-1 [@media(min-height:1000px)]:justify-center [@media(min-height:1000px)]:pb-[6vh]'}>
              <HubLayout layout={layout} editing={editing} onChange={save} render={render} onCustomize={() => setEditing(true)} />
            </div>
          </div>
        </div>
      </CalendarStateProvider>
    </HubNavProvider>
  );
}

function Clock() {
  const now = useNow(1000);
  const { time, period } = clockParts(now);
  return (
    <div className="select-none">
      <time dateTime={new Date(now).toISOString()} className="flex items-start leading-none font-extralight tracking-[-0.05em] tabular-nums">
        <span className="text-[clamp(3.25rem,6vw,5.5rem)]">{time}</span>
        {period && <span className="mt-[0.7em] ml-2 text-[clamp(0.9rem,1.4vw,1.25rem)] font-light tracking-[0.04em] text-muted">{period}</span>}
      </time>
      <p className="mt-2 text-[12px] font-medium tracking-[0.32em] text-muted">{dateLine(now)}</p>
    </div>
  );
}

/** Web search with the selected engine. Addresses navigate directly, but only http(s). */
export function SearchBox({ engine, autoFocus = true, onNavigate = (url) => window.location.assign(url) }: { engine: 'google' | 'duckduckgo' | 'bing'; autoFocus?: boolean; onNavigate?: (url: string) => void }) {
  const [q, setQ] = useState('');
  const name = SEARCH_ENGINES[engine]?.name ?? 'the web';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const target = resolveSearch(q, engine);
    if (target && isSafeUrl(target)) onNavigate(target);
  };
  return (
    <form onSubmit={submit} role="search" className="min-w-[260px] flex-1 basis-[420px]">
      <label className="ts-card flex h-14 items-center gap-3 rounded-full px-5 transition-colors focus-within:border-fg/40">
        <Search size={19} className="shrink-0 text-faint" aria-hidden />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${name} or type a URL`}
          aria-label={`Search ${name} or type a URL`}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          style={{ outline: 'none' }}
        />
      </label>
    </form>
  );
}

function DailyQuote() {
  const { quote } = useDailyQuote();
  return (
    <figure className="min-w-0 px-1">
      <blockquote className="text-[11px] leading-relaxed font-medium tracking-[0.16em] text-muted uppercase" title={quote.source}>
        “{quote.text}”
      </blockquote>
      <figcaption className="mt-1 text-[10.5px] tracking-[0.2em] text-faint uppercase">— {quote.author}</figcaption>
    </figure>
  );
}
