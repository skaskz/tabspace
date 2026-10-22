import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useSettings } from '@/hooks/useStore';
import { identityAvailable } from '../secrets';
import { SpotifyError, type SpotifyPlaylist } from './api';
import { connectSpotify, grantedSpotifyScopes, hasSpotifySecret, spotifyClient } from './auth';
import { createPoller, getSnapshotCache, subscribeSnapshot, type SpotifySnapshot } from './service';

/** One poller per page; pages elect a single leader between them (see service.ts). */
const poller = createPoller({ client: () => spotifyClient() });

export function useSpotifySnapshot(): SpotifySnapshot | null {
  return useSyncExternalStore(subscribeSnapshot, getSnapshotCache, () => null);
}

/** Keep the shared poller running while this widget is mounted and connected. */
export function useSpotifyPolling(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const stop = poller.start();
    const onVis = () => document.visibilityState === 'visible' && poller.nudge();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [enabled]);
}

export type ConnectionStatus = 'loading' | 'unconfigured' | 'unavailable' | 'disconnected' | 'connected';

export interface Connection {
  status: ConnectionStatus;
  displayName?: string;
  scopes: string[];
  error?: SpotifyError;
  connect: () => Promise<void>;
  recheck: () => void;
}

/* A verified profile is shared by all widgets on the page (one /me call per page). */
let libCache: { at: number; data: Promise<{ playlists: SpotifyPlaylist[]; liked: LikedState }> } | null = null;
let verified: Promise<{ displayName: string; scopes: string[] }> | null = null;
let verifiedFor: string | undefined;
const connListeners = new Set<() => void>();
function invalidate() {
  verified = null;
  libCache = null;
  connListeners.forEach((l) => l());
}

/** "Connected" only after an authenticated call (GET /me) succeeds. */
export function useSpotifyConnection(): Connection {
  const [settings] = useSettings();
  const clientId = settings.integrations.spotifyClientId?.trim();
  const snap = useSpotifySnapshot();
  const [state, setState] = useState<{ status: ConnectionStatus; displayName?: string; scopes: string[]; error?: SpotifyError }>({ status: 'loading', scopes: [] });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    connListeners.add(l);
    return () => {
      connListeners.delete(l);
    };
  }, []);

  // A poll that failed with an auth error means the session is gone.
  const authLost = snap?.error?.kind === 'auth';
  useEffect(() => {
    if (authLost) invalidate();
  }, [authLost]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!clientId) return alive && setState({ status: 'unconfigured', scopes: [] });
      if (!identityAvailable()) return alive && setState({ status: 'unavailable', scopes: [] });
      if (!(await hasSpotifySecret())) return alive && setState({ status: 'disconnected', scopes: [] });
      if (!verified || verifiedFor !== clientId) {
        verifiedFor = clientId;
        verified = (async () => ({ displayName: (await spotifyClient().me()).displayName, scopes: await grantedSpotifyScopes() }))();
        verified.catch(() => {
          verified = null;
        });
      }
      try {
        const v = await verified;
        if (alive) setState({ status: 'connected', displayName: v.displayName, scopes: v.scopes });
      } catch (e) {
        if (alive) setState({ status: 'disconnected', scopes: [], error: e instanceof SpotifyError && e.kind !== 'auth' ? e : undefined });
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, tick]);

  const connect = useCallback(async () => {
    await connectSpotify();
    invalidate();
  }, []);
  return { ...state, connect, recheck: invalidate };
}

export type LikedState = { kind: 'loading' } | { kind: 'ok'; total: number } | { kind: 'needsScope' } | { kind: 'error'; message: string };

const LIB_TTL = 5 * 60_000;
async function loadLibrary(scopes: string[]): Promise<{ playlists: SpotifyPlaylist[]; liked: LikedState }> {
  const client = spotifyClient();
  const playlistsP = client.playlists();
  let liked: LikedState;
  if (!scopes.includes('user-library-read')) liked = { kind: 'needsScope' };
  else {
    try {
      liked = { kind: 'ok', total: (await client.likedTracks(1)).total };
    } catch (e) {
      liked = e instanceof SpotifyError && (e.kind === 'scope' || e.status === 403) ? { kind: 'needsScope' } : { kind: 'error', message: e instanceof Error ? e.message : 'Could not load Liked Songs.' };
    }
  }
  return { playlists: await playlistsP, liked };
}

/** Playlists + Liked Songs availability, cached per page for 5 minutes. */
export function useSpotifyLibrary(conn: Connection): { playlists: SpotifyPlaylist[]; liked: LikedState; error?: string } {
  const [state, setState] = useState<{ playlists: SpotifyPlaylist[]; liked: LikedState; error?: string }>({ playlists: [], liked: { kind: 'loading' } });
  const connected = conn.status === 'connected';
  const scopeKey = conn.scopes.join(' ');
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    if (!libCache || Date.now() - libCache.at > LIB_TTL) {
      libCache = { at: Date.now(), data: loadLibrary(scopeKey.split(' ')) };
      libCache.data.catch(() => {
        libCache = null;
      });
    }
    libCache.data.then(
      (d) => alive && setState(d),
      (e) => alive && setState({ playlists: [], liked: { kind: 'error', message: '' }, error: e instanceof Error ? e.message : 'Could not load playlists.' }),
    );
    return () => {
      alive = false;
    };
  }, [connected, scopeKey]);
  return state;
}

/** Live progress estimate between polls. */
export function estimateProgress(snap: SpotifySnapshot | null, now: number): number | undefined {
  if (!snap?.track?.durationMs || snap.progressMs === undefined) return undefined;
  const p = snap.progressMs + (snap.isPlaying ? now - snap.fetchedAt : 0);
  return Math.max(0, Math.min(snap.track.durationMs, p));
}

export { poller as spotifyPoller };

/** Test helper: forget the per-page profile and library caches. */
export function __resetSpotifyHooks(): void {
  verified = null;
  verifiedFor = undefined;
  libCache = null;
}
