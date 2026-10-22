/**
 * Spotify Web API client with friendly error mapping. Token acquisition is injected.
 *
 * Player commands (play/pause/next/previous/volume/transfer) are documented to answer
 * 204, but Spotify also answers 200/202 — sometimes with a body that is NOT JSON. Any 2xx
 * is therefore success for a command and its body is never parsed. (Parsing it was the
 * cause of the V1 "Spotify request failed." on Next.)
 */

export type SpotifyErrorKind = 'auth' | 'scope' | 'premium' | 'noDevice' | 'restricted' | 'rateLimit' | 'forbidden' | 'notFound' | 'offline' | 'server' | 'other';

export class SpotifyError extends Error {
  constructor(
    public kind: SpotifyErrorKind,
    message: string,
    public status?: number,
    /** Seconds to wait (429 Retry-After). */
    public retryAfter?: number,
  ) {
    super(message);
    this.name = 'SpotifyError';
  }
}

export const MESSAGES = {
  auth: 'Spotify session expired — reconnect Spotify.',
  scope: 'Reconnect Spotify to grant playback permission.',
  premium: 'Spotify Premium is required for playback control.',
  noDevice: 'No active Spotify device — open Spotify on a device first.',
  offline: 'Can’t reach Spotify — check your connection.',
  notRegistered: 'Your Spotify account is not on this app’s user list. Add it under User Management in the Spotify Developer Dashboard.',
} as const;

export function mapSpotifyError(status: number, body: unknown, retryAfter?: string | null): SpotifyError {
  const err = (body as { error?: { message?: string; reason?: string } | string } | null)?.error;
  const reason = typeof err === 'object' && err ? String(err.reason ?? '') : '';
  const message = typeof err === 'object' && err ? String(err.message ?? '') : typeof err === 'string' ? err : '';
  if (status === 401) return new SpotifyError('auth', MESSAGES.auth, status);
  if (status === 429) {
    const secs = Number(retryAfter);
    const wait = Number.isFinite(secs) && secs > 0 ? Math.ceil(secs) : undefined;
    return new SpotifyError('rateLimit', `Spotify is rate-limiting — try again in ${wait ?? 'a few '}${wait ? 's' : 'seconds'}.`, status, wait);
  }
  if (reason === 'NO_ACTIVE_DEVICE' || (status === 404 && /device/i.test(message))) return new SpotifyError('noDevice', MESSAGES.noDevice, status);
  if (reason === 'PREMIUM_REQUIRED' || /premium/i.test(message)) return new SpotifyError('premium', MESSAGES.premium, status);
  if (status === 403) {
    if (/scope/i.test(message)) return new SpotifyError('scope', MESSAGES.scope, status);
    if (/not be registered|not registered|developer/i.test(message)) return new SpotifyError('forbidden', MESSAGES.notRegistered, status);
    if (reason || /restriction/i.test(message)) {
      // e.g. UNKNOWN "Restriction violated" when there is no next track, or the content disallows skipping.
      return new SpotifyError('restricted', `Spotify can’t do that right now${reason && reason !== 'UNKNOWN' ? ` (${reason.toLowerCase().replace(/_/g, ' ')})` : ''}.`, status);
    }
    return new SpotifyError('forbidden', 'Spotify refused this request for this account.', status);
  }
  if (status === 404) return new SpotifyError('notFound', 'Not found on Spotify.', status);
  if (status >= 500) return new SpotifyError('server', `Spotify had a problem (${status}) — try again.`, status);
  return new SpotifyError('other', `Spotify error (${status}).`, status);
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
  image?: string;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
  volumePercent: number | null;
}

export interface PlaybackState {
  isPlaying: boolean;
  track?: { name: string; artists: string; image?: string; uri?: string; durationMs?: number };
  device?: { id?: string; name: string; volumePercent: number | null; supportsVolume: boolean };
  contextUri?: string;
  progressMs?: number;
}

export interface LikedTracks {
  total: number;
  uris: string[];
}

type TokenFn = (opts?: { forceRefresh?: boolean; staleToken?: string }) => Promise<string>;

const API = 'https://api.spotify.com/v1';

export function createSpotifyClient(getToken: TokenFn, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function request(method: string, path: string, body: unknown, staleToken?: string): Promise<Response> {
    const retried = staleToken !== undefined;
    const token = await getToken(retried ? { forceRefresh: true, staleToken } : undefined);
    let res: Response;
    try {
      res = await fetchImpl(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        // POST/PUT without a payload still send an explicit empty body (Content-Length: 0).
        body: body !== undefined ? JSON.stringify(body) : method === 'GET' ? undefined : '',
        cache: 'no-store',
      });
    } catch {
      throw new SpotifyError('offline', MESSAGES.offline);
    }
    // One retry with a refreshed token: access tokens can be revoked/expire early.
    if (res.status === 401 && !retried) return request(method, path, body, token);
    if (res.ok) return res;
    let parsed: unknown = null;
    try {
      const text = await res.text();
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error body */
    }
    throw mapSpotifyError(res.status, parsed, res.headers.get('retry-after'));
  }

  /** GET returning JSON; 204 / empty body -> null. */
  async function getJson<T>(path: string): Promise<T | null> {
    const res = await request('GET', path, undefined);
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SpotifyError('other', 'Spotify sent an unexpected response.', res.status);
    }
  }

  /** Command: any 2xx is success; the body is ignored. */
  async function command(method: 'PUT' | 'POST', path: string, body?: unknown): Promise<void> {
    await request(method, path, body);
  }

  const withDevice = (path: string, deviceId?: string) => (deviceId ? `${path}${path.includes('?') ? '&' : '?'}device_id=${encodeURIComponent(deviceId)}` : path);

  return {
    async me(): Promise<{ id: string; displayName: string }> {
      const r = await getJson<{ id: string; display_name?: string }>('/me');
      if (!r?.id) throw new SpotifyError('other', 'Spotify returned no profile.');
      return { id: r.id, displayName: r.display_name || r.id };
    },
    async playlists(): Promise<SpotifyPlaylist[]> {
      const out: SpotifyPlaylist[] = [];
      for (let offset = 0; offset < 200; offset += 50) {
        const r = await getJson<{ items?: ({ id: string; name: string; uri: string; images?: { url: string }[] | null } | null)[]; next?: string | null }>(`/me/playlists?limit=50&offset=${offset}`);
        for (const p of r?.items ?? []) if (p?.id) out.push({ id: p.id, name: p.name || 'Untitled playlist', uri: p.uri, image: p.images?.[0]?.url });
        if (!r?.next) break;
      }
      return out;
    },
    /** Saved ("Liked Songs") tracks: total count plus up to `max` URIs, newest first (paginated, 50 per page). */
    async likedTracks(max = 100): Promise<LikedTracks> {
      const uris: string[] = [];
      let total = 0;
      for (let offset = 0; offset < max; offset += 50) {
        const r = await getJson<{ total?: number; next?: string | null; items?: ({ track?: { uri?: string; is_local?: boolean } | null } | null)[] }>(`/me/tracks?limit=50&offset=${offset}`);
        total = typeof r?.total === 'number' ? r.total : total;
        for (const it of r?.items ?? []) {
          const uri = it?.track?.uri;
          if (uri && !it?.track?.is_local && /^spotify:track:[A-Za-z0-9]+$/.test(uri) && uris.length < max) uris.push(uri);
        }
        if (!r?.next) break;
      }
      return { total, uris };
    },
    async playback(): Promise<PlaybackState | null> {
      const r = await getJson<{
        is_playing: boolean;
        progress_ms?: number | null;
        item?: { name: string; uri?: string; duration_ms?: number; artists?: { name: string }[]; album?: { images?: { url: string }[] }; show?: { name: string }; images?: { url: string }[] } | null;
        device?: { id?: string | null; name: string; volume_percent: number | null; supports_volume?: boolean };
        context?: { uri?: string } | null;
      }>('/me/player?additional_types=episode');
      if (!r) return null;
      const images = r.item?.album?.images ?? r.item?.images;
      return {
        isPlaying: !!r.is_playing,
        progressMs: typeof r.progress_ms === 'number' ? r.progress_ms : undefined,
        track: r.item
          ? {
              name: r.item.name,
              artists: r.item.artists?.map((a) => a.name).join(', ') ?? r.item.show?.name ?? '',
              // Smallest image that is still >= 64px (Spotify lists largest first).
              image: images?.[images.length - 1]?.url ?? images?.[0]?.url,
              uri: r.item.uri,
              durationMs: r.item.duration_ms,
            }
          : undefined,
        device: r.device ? { id: r.device.id ?? undefined, name: r.device.name, volumePercent: r.device.volume_percent, supportsVolume: r.device.supports_volume !== false && r.device.volume_percent !== null } : undefined,
        contextUri: r.context?.uri,
      };
    },
    async devices(): Promise<SpotifyDevice[]> {
      const r = await getJson<{ devices?: { id: string | null; name: string; type: string; is_active: boolean; is_restricted: boolean; volume_percent: number | null }[] }>('/me/player/devices');
      return (r?.devices ?? []).filter((d) => d.id).map((d) => ({ id: d.id!, name: d.name, type: d.type, isActive: d.is_active, isRestricted: d.is_restricted, volumePercent: d.volume_percent }));
    },
    transfer: (deviceId: string, play = true) => command('PUT', '/me/player', { device_ids: [deviceId], play }),
    /** Resume, or start a context (playlist) or explicit track list (Liked Songs). */
    play: (opts: { contextUri?: string; uris?: string[]; deviceId?: string } = {}) =>
      command('PUT', withDevice('/me/player/play', opts.deviceId), opts.contextUri ? { context_uri: opts.contextUri } : opts.uris?.length ? { uris: opts.uris.slice(0, 100) } : undefined),
    pause: (deviceId?: string) => command('PUT', withDevice('/me/player/pause', deviceId)),
    next: (deviceId?: string) => command('POST', withDevice('/me/player/next', deviceId)),
    previous: (deviceId?: string) => command('POST', withDevice('/me/player/previous', deviceId)),
    volume: (percent: number, deviceId?: string) => command('PUT', withDevice(`/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(percent)))}`, deviceId)),
  };
}

export type SpotifyClient = ReturnType<typeof createSpotifyClient>;

/** Selection value for Liked Songs in settings.integrations.spotifyPlaylistUri. */
export const LIKED = 'liked';

/** "spotify:playlist:ID" or an open.spotify.com URL -> playlist id. */
export function playlistIdFromUri(uri: string | undefined): string | null {
  if (!uri) return null;
  const m = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(uri) ?? /^https:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/.exec(uri);
  return m ? m[1] : null;
}

export function openInSpotifyUrl(uri: string | undefined): string | null {
  if (uri === LIKED) return 'https://open.spotify.com/collection/tracks';
  const id = playlistIdFromUri(uri);
  return id ? `https://open.spotify.com/playlist/${id}` : null;
}
