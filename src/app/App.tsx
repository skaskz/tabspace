import { lazy, startTransition, Suspense, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { setFallbackPage, useRoute } from './router';
import { get } from '@/storage/store';
import { recoverUnsavedNotes } from '@/features/notes/recovery';
import type { PageId } from '@/types/models';

const pages: Record<PageId, LazyExoticComponent<ComponentType>> = {
  dashboard: lazy(() => import('@/pages/dashboard/DashboardPage')),
  workspaces: lazy(() => import('@/pages/workspaces/WorkspacesPage')),
  tabs: lazy(() => import('@/pages/tabs/TabsPage')),
  calendar: lazy(() => import('@/pages/calendar/CalendarPage')),
  notes: lazy(() => import('@/pages/notes/NotesPage')),
  tasks: lazy(() => import('@/pages/tasks/TasksPage')),
  bookmarks: lazy(() => import('@/pages/bookmarks/BookmarksPage')),
  focus: lazy(() => import('@/pages/focus/FocusPage')),
  analytics: lazy(() => import('@/pages/analytics/AnalyticsPage')),
  settings: lazy(() => import('@/pages/settings/SettingsPage')),
  sidebar: lazy(() => import('@/pages/sidebar/SidebarSettingsPage')),
};

const titles: Record<PageId, string> = {
  dashboard: 'Dashboard',
  workspaces: 'Workspaces',
  tabs: 'Tabs',
  calendar: 'Calendar',
  notes: 'Notes',
  tasks: 'Tasks',
  bookmarks: 'Bookmarks',
  focus: 'Focus Mode',
  analytics: 'Analytics',
  settings: 'Settings',
  sidebar: 'Chrome Sidebar',
};

export function App() {
  const { page: routePage } = useRoute();
  // The page actually rendered. Route changes are applied in a transition, so while a not-yet-loaded
  // page chunk is fetched React keeps showing the current page instead of flashing the Suspense
  // fallback. Navigation itself is never delayed: the nav highlights the new route immediately.
  const [page, setPage] = useState(routePage);
  // The initial page renders without the enter animation so the first load paints immediately;
  // every page shown after the first navigation animates in.
  const initialPage = useRef(page);
  const navigated = useRef(false);
  if (page !== initialPage.current) navigated.current = true;
  useEffect(() => {
    if (routePage !== page) startTransition(() => setPage(routePage));
  }, [routePage, page]);
  useEffect(() => {
    // Merge any note edits parked by a tab that closed mid-save (also done by the service worker).
    void recoverUnsavedNotes().catch(() => undefined);
  }, []);
  useEffect(() => {
    // Honour the user's default page when the dashboard opens without a hash.
    if (!window.location.hash) {
      void get('ts.settings').then((s) => {
        setFallbackPage(s.defaultPage);
        if (!window.location.hash) window.location.replace(`#/${s.defaultPage}`);
      });
    }
  }, []);
  const firstRender = useRef(true);
  useEffect(() => {
    document.title = `${titles[page]} · Tabspace`;
    // Move keyboard/screen-reader focus to the new page's content on navigation (not on first load).
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [page]);
  const Page = pages[page];
  return (
    <AppShell>
      <Suspense
        fallback={
          // Only appears if loading takes >300ms (first open), so fast loads don't flash "Loading…".
          <div className="ts-fallback p-8 text-sm text-muted" role="status">
            Loading…
          </div>
        }
      >
        {/* Enter-only page animation (fade + 4px rise): never delays navigation or steals focus. */}
        <div key={page} className={navigated.current ? 'ts-page-in' : undefined}>
          <Page />
        </div>
      </Suspense>
    </AppShell>
  );
}
