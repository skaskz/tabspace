import { lazy, Suspense, useEffect, useState } from 'react';

/** The Spotify player is loaded on demand so its code isn't part of the up-front New Tab / dashboard bundle. */
const SpotifyMiniPlayer = lazy(() => import('@/integrations/spotify/SpotifyMiniPlayer').then((m) => ({ default: m.SpotifyMiniPlayer })));

/** Compact, fixed-height placeholder matching the player's collapsed card, so nothing shifts while it loads. */
function SpotifyPlaceholder() {
  return <div aria-hidden className="ts-card h-[84px]" />;
}

export function LazySpotifyMiniPlayer() {
  return (
    <Suspense fallback={<SpotifyPlaceholder />}>
      <SpotifyMiniPlayer />
    </Suspense>
  );
}

/** Live `window.innerHeight` (updates on resize). */
export function useViewportHeight(): number {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

export interface HubLimits {
  workspaces: number;
  tasks: number;
  recentTabs: number;
  upcoming: number;
  quickLinks: number;
}

/** How many list items fit without scrolling at a given viewport height (New Tab). */
export function hubLimits(height: number): HubLimits {
  if (height >= 1000) return { workspaces: 6, tasks: 7, recentTabs: 6, upcoming: 5, quickLinks: 8 };
  if (height >= 820) return { workspaces: 4, tasks: 5, recentTabs: 5, upcoming: 4, quickLinks: 8 };
  if (height >= 720) return { workspaces: 4, tasks: 4, recentTabs: 4, upcoming: 3, quickLinks: 5 };
  return { workspaces: 2, tasks: 3, recentTabs: 3, upcoming: 2, quickLinks: 5 };
}
