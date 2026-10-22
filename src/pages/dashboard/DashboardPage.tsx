import { useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button, IconButton, useToast } from '@/components/ui';
import { PageHero } from '@/components/layout/PageHero';
import { useSettings, useStore } from '@/hooks/useStore';
import { update } from '@/storage/store';
import { useNow } from '@/hooks/useNow';
import { greeting } from '@/utils/date';
import { loadSampleData } from '@/services/sampleData';
import { LazySpotifyMiniPlayer } from './LazySpotify';
import { QuickActions } from './QuickActions';
import { RecentTabsCard, SavedLinksCard, TodayTasksCard, WorkspacesCard } from './MainWidgets';
import { CalendarAndEvents, FocusCard, QuickLinksCard } from './SidebarWidgets';
import { formatDateLine, isEmptyAccount } from './dashboardLogic';
import { UpdateNotice } from '@/components/UpdateNotice';

/** Home Dashboard: overview + the right utility sidebar (the only page that has one). */
export default function DashboardPage() {
  const [settings, , settingsLoaded] = useSettings();
  const [workspaces, , wl] = useStore('ts.workspaces');
  const [tasks, , tl] = useStore('ts.tasks');
  const [notes, , nl] = useStore('ts.notes');
  const [bookmarks, , bl] = useStore('ts.bookmarks');
  const toast = useToast();
  const now = new Date(useNow(60_000));
  const taskInput = useRef<HTMLInputElement>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const w = settings.dashboardWidgets;
  const name = settings.userName.trim();
  const loaded = settingsLoaded && wl && tl && nl && bl;
  const showWelcome = loaded && !settings.welcomeDismissed && isEmptyAccount({ workspaces, tasks, notes, bookmarks });

  const dismissWelcome = () => void update('ts.settings', (s) => ({ ...s, welcomeDismissed: true })).catch(() => toast('Could not save the setting.', 'error'));
  const loadExamples = async () => {
    setLoadingSample(true);
    try {
      await loadSampleData();
      toast('Example data loaded. Everything is editable and removable.');
    } catch {
      toast('Could not load example data.', 'error');
    } finally {
      setLoadingSample(false);
    }
  };

  const focusAddTask = () => {
    const el = taskInput.current;
    if (!w.tasks || !el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus();
    return true;
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-5 [&>div:first-child]:mb-1">
        <PageHero eyebrow={formatDateLine(now)} title={`${greeting(now)}${name ? `, ${name}` : ''}.`} subtitle="Stay focused. Make progress." />
        <UpdateNotice variant="banner" />

        {showWelcome && (
          <section className="ts-card flex flex-wrap items-center gap-4 p-5" aria-label="Welcome">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-3" aria-hidden>
              <Sparkles size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold">Welcome to Tabspace</h2>
              <p className="text-sm text-muted">Explore with a few example workspaces, tasks and notes, or start with a clean slate.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" disabled={loadingSample} onClick={() => void loadExamples()}>
                {loadingSample ? 'Loading…' : 'Load example data'}
              </Button>
              <Button size="sm" onClick={dismissWelcome}>
                Start fresh
              </Button>
            </div>
            <IconButton label="Dismiss welcome" size="sm" onClick={dismissWelcome}>
              <X size={15} />
            </IconButton>
          </section>
        )}

        {w.quickActions && <QuickActions onAddTask={focusAddTask} />}
        {w.workspaces && <WorkspacesCard />}
        {(w.tasks || w.recentTabs) && (
          <div className={w.tasks && w.recentTabs ? 'grid gap-5 lg:grid-cols-2' : ''}>
            {w.tasks && <TodayTasksCard ref={taskInput} />}
            {w.recentTabs && <RecentTabsCard />}
          </div>
        )}
        {w.savedLinks && <SavedLinksCard />}
      </div>

      <aside className="flex flex-col gap-4 xl:pt-2" aria-label="Utilities">
        <CalendarAndEvents />
        <FocusCard />
        <LazySpotifyMiniPlayer />
        <QuickLinksCard />
      </aside>
    </div>
  );
}
