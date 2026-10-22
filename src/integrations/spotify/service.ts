import { update } from '@/storage/store';
import { LIKED, SpotifyError, type PlaybackState, type SpotifyClient, type SpotifyErrorKind } from './api';

/**
 * Shared Spotify state for every Tabspace page (Focus panel, dashboard + New Tab mini player).
 *
 * - One poller across all pages: a Web Lock elects a leader among *visible* pages; only the
 *   leader polls GET /me/player (every ~5 s) and writes a sanitised snapshot to
 *   chrome.storage.session `ts.session.spotify`. Every widget renders from that key.
 * - Commands update the snapshot optimistically, then re-fetch after ~500 ms (Spotify lags).
 * - Duplicate rapid clicks on the same control share one in-flight request.
 * The snapshot never contains tokens — only what the UI shows.
 */

export const SNAPSHOT_KEY = 'ts.session.spotify';
export const POLL_MS = 5000;
const ELECTION_MS = 3000;
export const LOCK_NAME = 'tabspace-spotify-poller';

export interface SpotifySnapshot {
  fetchedAt: number;
  /** False when Spotify reports no current playback (204). */
  active: boolean;
  isPlaying: boolean;
  track?: { name: string; artists: string; image?: string; uri?: string; durationMs?: number };
  device?: { id?: string; name: string; volumePercent: number | null; supportsVolume: boolean };
  contextUri?: string;
  progressMs?: number;
  error?: { kind: SpotifyErrorKind; message: string };
}

const clip = (s: unknown, n = 300) => (typeof s === 'string' ? s.slice(0, n) : undefined);

/** Only Spotify's image CDNs, https. */
export function safeImage(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (/(^|\.)scdn\.co$/.test(u.hostname) || /(^|\.)spotifycdn\.com$/.test(u.hostname)) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function toSnapshot(p: PlaybackState | null, now = Date.now()): SpotifySnapshot {
  if (!p) return { fetchedAt: now, active: false, isPlaying: false };
  return {
    fetchedAt: now,
    active: true,
    isPlaying: p.isPlaying,
    track: p.track ? { name: clip(p.track.name) ?? '', artists: clip(p.track.artists) ?? '', image: safeImage(p.track.image), uri: clip(p.track.uri, 100), durationMs: p.track.durationMs } : undefined,
    device: p.device ? { id: clip(p.device.id, 100), name: clip(p.device.name, 100) ?? 'Device', volumePercent: p.device.volumePercent, supportsVolume: p.device.supportsVolume } : undefined,
    contextUri: clip(p.contextUri, 200),
    progressMs: p.progressMs,
  };
}

/* ------------------------------------------------------------------ */
/* Snapshot storage (chrome.storage.session, memory fallback)          */
/* ------------------------------------------------------------------ */

let memory: SpotifySnapshot | null = null;
const memoryListeners = new Set<() => void>();

function sessionArea(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.session ? chrome.storage.session : null;
}

export async function readSnapshot(): Promise<SpotifySnapshot | null> {
  const area = sessionArea();
  if (!area) return memory;
  const r = await area.get(SNAPSHOT_KEY);
  return (r[SNAPSHOT_KEY] as SpotifySnapshot | undefined) ?? null;
}

export async function writeSnapshot(s: SpotifySnapshot | null): Promise<void> {
  cache = s;
  emit();
  const area = sessionArea();
  if (!area) {
    memory = s;
    memoryListeners.forEach((l) => l());
    return;
  }
  if (s) await area.set({ [SNAPSHOT_KEY]: s });
  else await area.remove(SNAPSHOT_KEY);
}

let cache: SpotifySnapshot | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let unsub: (() => void) | null = null;

/** Subscribe to snapshot changes from any page (for useSyncExternalStore). */
export function subscribeSnapshot(cb: () => void): () => void {
  listeners.add(cb);
  if (!unsub) {
    const area = sessionArea();
    if (area && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      const h = (changes: Record<string, chrome.storage.StorageChange>, name: string) => {
        if (name !== 'session' || !(SNAPSHOT_KEY in changes)) return;
        cache = (changes[SNAPSHOT_KEY].newValue as SpotifySnapshot | undefined) ?? null;
        emit();
      };
      chrome.storage.onChanged.addListener(h);
      unsub = () => chrome.storage.onChanged.removeListener(h);
    } else {
      const h = () => {
        cache = memory;
        emit();
      };
      memoryListeners.add(h);
      unsub = () => memoryListeners.delete(h);
    }
    if (!loaded) {
      loaded = true;
      void readSnapshot().then((s) => {
        cache = s;
        emit();
      });
    }
  }
  return () => {
    listeners.delete(cb);
  };
}

export const getSnapshotCache = () => cache;

/** Test helper. */
export function __resetSpotifyService(): void {
  memory = null;
  cache = null;
  loaded = false;
  unsub?.();
  unsub = null;
  listeners.clear();
  inflightCommands.clear();
}

/* ------------------------------------------------------------------ */
/* Polling                                                             */
/* ------------------------------------------------------------------ */

/** Fetch playback once and publish it. Errors are published too (never thrown). */
export async function pollOnce(client: SpotifyClient, now: () => number = Date.now): Promise<SpotifySnapshot> {
  let snap: SpotifySnapshot;
  try {
    snap = toSnapshot(await client.playback(), now());
  } catch (e) {
    const prev = cache ?? (await readSnapshot());
    const err = e instanceof SpotifyError ? { kind: e.kind, message: e.message } : { kind: 'other' as const, message: 'Could not read Spotify playback.' };
    snap = { ...(prev ?? { active: false, isPlaying: false }), fetchedAt: now(), error: err };
  }
  await writeSnapshot(snap);
  return snap;
}

type Locks = Pick<LockManager, 'request'>;

export interface PollerDeps {
  client: () => SpotifyClient;
  locks?: Locks | null;
  isVisible?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

/**
 * Leader-elected poller. Pages call start() while a Spotify widget is mounted.
 * Only a visible page tries to lead; the leader gives up the lock when hidden or stopped.
 */
export function createPoller(deps: PollerDeps) {
  const locks = deps.locks === undefined ? ((typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined) ?? null) : deps.locks;
  const visible = deps.isVisible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const setT = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let refs = 0;
  let leading = false;
  let electionTimer: unknown = null;
  let wake: (() => void) | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const id = setT(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        clearT(id);
        wake = null;
        resolve();
      };
    });

  async function lead() {
    leading = true;
    try {
      while (refs > 0 && visible()) {
        await pollOnce(deps.client());
        if (refs > 0 && visible()) await sleep(POLL_MS);
      }
    } finally {
      leading = false;
    }
  }

  function tryElect() {
    electionTimer = null;
    if (refs <= 0) return;
    if (!leading && visible()) {
      if (locks) {
        void locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
          if (lock) await lead();
        });
      } else void lead();
    }
    electionTimer = setT(tryElect, ELECTION_MS);
  }

  return {
    start(): () => void {
      refs++;
      if (refs === 1) tryElect();
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        refs--;
        if (refs <= 0) {
          refs = 0;
          if (electionTimer !== null) clearT(electionTimer);
          electionTimer = null;
          wake?.();
        }
      };
    },
    /** Visible again / command done: poll soon (leader wakes; others poll once directly). */
    nudge() {
      if (wake) wake();
      else if (refs > 0 && visible()) void pollOnce(deps.client());
    },
    get isLeader() {
      return leading;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

const inflightCommands = new Map<string, Promise<void>>();

export type Control = 'play' | 'pause' | 'next' | 'previous' | 'volume' | 'transfer' | 'playSelection';

/**
 * Run a playback command once per control at a time (rapid double-clicks share one request),
 * apply an optimistic change, then re-fetch after ~500 ms because Spotify's state lags.
 */
export function runCommand(control: Control, fn: () => Promise<void>, opts: { client: () => SpotifyClient; optimistic?: (s: SpotifySnapshot) => SpotifySnapshot; refetchMs?: number }): Promise<void> {
  const existing = inflightCommands.get(control);
  if (existing) return existing;
  const p = (async () => {
    const before = cache;
    if (opts.optimistic && before) await writeSnapshot({ ...opts.optimistic(before), error: undefined });
    try {
      await fn();
    } catch (e) {
      if (before) await writeSnapshot(before); // undo optimistic change
      throw e;
    }
    await new Promise((r) => setTimeout(r, opts.refetchMs ?? 500));
    await pollOnce(opts.client());
  })().finally(() => inflightCommands.delete(control));
  inflightCommands.set(control, p);
  return p;
}

/** Start the chosen collection: a playlist context, or Liked Songs as an explicit track list. */
export async function playSelection(client: SpotifyClient, selection: string | undefined, deviceId?: string): Promise<void> {
  if (selection === LIKED) {
    // Spotify's play endpoint documents album/artist/playlist contexts only, so Liked Songs is
    // played as its first 100 saved tracks (newest first).
    const liked = await client.likedTracks(100);
    if (!liked.uris.length) throw new SpotifyError('notFound', 'Your Liked Songs list is empty.');
    await client.play({ uris: liked.uris, deviceId });
    return;
  }
  if (selection && /^spotify:playlist:[A-Za-z0-9]+$/.test(selection)) {
    await client.play({ contextUri: selection, deviceId });
    return;
  }
  await client.play({ deviceId });
}

/** Persist the default collection ('liked' or a playlist URI) under the store lock. */
export async function setDefaultCollection(value: string | undefined): Promise<void> {
  const v = value === LIKED || (value && /^spotify:playlist:[A-Za-z0-9]+$/.test(value)) ? value : undefined;
  await update('ts.settings', (s) => ({ ...s, integrations: { ...s.integrations, spotifyPlaylistUri: v } }));
}
