import { useCallback, useRef, useState } from 'react';
import { ExternalLink, Heart, Laptop, Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Button, IconButton, Select } from '@/components/ui';
import { useSettings } from '@/hooks/useStore';
import { cn } from '@/utils/cn';
import { LIKED, openInSpotifyUrl, SpotifyError, type SpotifyDevice } from './api';
import { spotifyClient } from './auth';
import { playSelection, runCommand, setDefaultCollection, type Control } from './service';
import { useSpotifyConnection, useSpotifyLibrary, useSpotifyPolling, useSpotifySnapshot, type Connection, type LikedState } from './hooks';

const client = () => spotifyClient();

/** Everything a Spotify widget needs: connection, library, shared playback snapshot and guarded actions. */
export function useSpotifyController() {
  const conn = useSpotifyConnection();
  const connected = conn.status === 'connected';
  useSpotifyPolling(connected);
  const snap = useSpotifySnapshot();
  const lib = useSpotifyLibrary(conn);
  const [settings] = useSettings();
  const selection = settings.integrations.spotifyPlaylistUri;
  const [busy, setBusy] = useState<Partial<Record<Control, boolean>>>({});
  const [error, setError] = useState<SpotifyError | null>(null);
  const [devices, setDevices] = useState<SpotifyDevice[] | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      setDevices(await client().devices());
    } catch {
      setDevices([]);
    }
  }, []);

  const act = useCallback(
    async (control: Control, fn: () => Promise<void>, optimistic?: Parameters<typeof runCommand>[2]['optimistic']) => {
      setBusy((b) => ({ ...b, [control]: true }));
      setError(null);
      try {
        await runCommand(control, fn, { client, optimistic });
        setDevices(null);
      } catch (e) {
        const err = e instanceof SpotifyError ? e : new SpotifyError('other', e instanceof Error && e.message ? `Spotify request failed: ${e.message}` : 'Spotify request failed.');
        setError(err);
        if (err.kind === 'noDevice') void loadDevices();
        if (err.kind === 'auth') conn.recheck();
      } finally {
        setBusy((b) => ({ ...b, [control]: false }));
      }
    },
    [conn, loadDevices],
  );

  const deviceId = snap?.device?.id;
  const actions = {
    togglePlay: () =>
      snap?.isPlaying
        ? act('pause', () => client().pause(), (s) => ({ ...s, isPlaying: false }))
        : // Nothing active: start the chosen collection instead of a bare resume.
          !snap?.active && selection
          ? act('playSelection', () => playSelection(client(), selection))
          : act('play', () => client().play(), (s) => ({ ...s, isPlaying: true })),
    next: () => act('next', () => client().next(deviceId)),
    previous: () => act('previous', () => client().previous(deviceId)),
    volume: (v: number) => act('volume', () => client().volume(v, deviceId), (s) => (s.device ? { ...s, device: { ...s.device, volumePercent: v } } : s)),
    playSelection: (sel = selection) => act('playSelection', () => playSelection(client(), sel, deviceId)),
    transfer: (id: string) => act('transfer', () => client().transfer(id, true)),
    select: (v: string) => void setDefaultCollection(v || undefined),
  };
  return { conn, snap, lib, selection, busy, error, devices, actions, clearError: () => setError(null) };
}

export type SpotifyController = ReturnType<typeof useSpotifyController>;

export function collectionName(selection: string | undefined, lib: SpotifyController['lib']): string | undefined {
  if (selection === LIKED) return 'Liked Songs';
  return lib.playlists.find((p) => p.uri === selection)?.name;
}

export function CollectionSelect({ selection, lib, onChange, compact }: { selection?: string; lib: { playlists: { id: string; uri: string; name: string }[]; liked: LikedState }; onChange: (v: string) => void; compact?: boolean }) {
  return (
    <Select aria-label="Default playlist" className={cn('w-full', compact && 'h-8 text-[12.5px]')} value={selection ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a playlist…</option>
      <option value={LIKED} disabled={lib.liked.kind === 'needsScope'}>
        ♥ Liked Songs{lib.liked.kind === 'ok' ? ` (${lib.liked.total})` : lib.liked.kind === 'needsScope' ? ' — reconnect to show' : ''}
      </option>
      {lib.playlists.map((p) => (
        <option key={p.id} value={p.uri}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

export function NowPlaying({ snap, size = 44, fallback }: { snap: SpotifyController['snap']; size?: number; fallback: string }) {
  const t = snap?.track;
  return (
    <div className="flex min-w-0 items-center gap-3">
      {t?.image ? (
        <img src={t.image} alt="" width={size} height={size} className="shrink-0 rounded-md border border-line object-cover" style={{ width: size, height: size }} />
      ) : (
        <div className="flex shrink-0 items-center justify-center rounded-md border border-line text-faint" style={{ width: size, height: size }}>
          <Music size={size / 2.4} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={t?.name}>
          {t?.name ?? fallback}
        </p>
        <p className="truncate text-[12.5px] text-muted">{t ? t.artists : snap?.device ? snap.device.name : 'No active device'}</p>
      </div>
    </div>
  );
}

export function Transport({ c, size = 'md' }: { c: SpotifyController; size?: 'sm' | 'md' }) {
  const playing = !!c.snap?.isPlaying;
  const nothing = !c.snap?.active;
  const playLabel = playing ? 'Pause' : nothing && c.selection ? `Play ${collectionName(c.selection, c.lib) ?? 'default playlist'}` : 'Play';
  const iconSm = size === 'sm' ? 15 : 18;
  return (
    <div className="flex items-center gap-0.5">
      <IconButton label="Previous track" size={size === 'sm' ? 'sm' : 'md'} disabled={!!c.busy.previous || nothing} onClick={() => void c.actions.previous()}>
        <SkipBack size={iconSm} />
      </IconButton>
      <IconButton label={playLabel} size={size === 'sm' ? 'md' : 'lg'} disabled={!!(c.busy.play || c.busy.pause || c.busy.playSelection)} onClick={() => void c.actions.togglePlay()}>
        {playing ? <Pause size={iconSm + 4} /> : <Play size={iconSm + 4} />}
      </IconButton>
      <IconButton label="Next track" size={size === 'sm' ? 'sm' : 'md'} disabled={!!c.busy.next || nothing} onClick={() => void c.actions.next()}>
        <SkipForward size={iconSm} />
      </IconButton>
    </div>
  );
}

export function OpenInSpotify({ selection, className }: { selection?: string; className?: string }) {
  const url = openInSpotifyUrl(selection) ?? 'https://open.spotify.com/';
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-1.5 text-[12.5px] text-muted underline-offset-4 hover:text-fg hover:underline', className)}>
      <ExternalLink size={13} aria-hidden /> Open in Spotify
    </a>
  );
}

/** Error with a device picker when no device is active. */
export function SpotifyNotice({ c }: { c: SpotifyController }) {
  const err = c.error ?? (c.snap?.error && c.snap.error.kind !== 'auth' ? new SpotifyError(c.snap.error.kind, c.snap.error.message) : null);
  const transferRef = useRef(false);
  if (!err) return null;
  return (
    <div role="alert" className="space-y-2 rounded-[var(--radius-ctl)] border border-line bg-surface-2 p-3 text-[12.5px]">
      <p className="text-muted">{err.message}</p>
      {err.kind === 'noDevice' && c.devices && c.devices.length > 0 && (
        <div className="space-y-1">
          <p className="text-faint">Play on:</p>
          {c.devices.map((d) => (
            <Button
              key={d.id}
              size="sm"
              variant="ghost"
              icon={<Laptop size={14} />}
              disabled={d.isRestricted || transferRef.current}
              onClick={() => {
                transferRef.current = true;
                void c.actions.transfer(d.id).finally(() => (transferRef.current = false));
              }}
            >
              {d.name}
            </Button>
          ))}
        </div>
      )}
      {err.kind === 'scope' && <p className="text-faint">Use Disconnect / Connect in Settings → Integrations.</p>}
      <OpenInSpotify selection={c.selection} />
    </div>
  );
}

export function LikedHint({ liked }: { liked: LikedState }) {
  if (liked.kind !== 'needsScope') return null;
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-faint">
      <Heart size={12} aria-hidden /> <a href="#/settings?section=integrations" className="underline underline-offset-4 hover:text-fg">Reconnect to show Liked Songs</a>
    </p>
  );
}

export function ConnectionState({ conn, compact }: { conn: Connection; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (conn.status === 'loading') return <p className="text-[13px] text-muted">Checking Spotify…</p>;
  if (conn.status === 'unconfigured')
    return (
      <p className="text-[13px] text-muted">
        {compact ? 'Spotify isn’t set up. ' : 'Control a focus playlist from here. Spotify needs your own free developer app (client ID); playback control needs Spotify Premium. '}
        <a href="#/settings?section=integrations" className="font-medium text-fg underline underline-offset-4">
          Set up in Settings
        </a>
      </p>
    );
  if (conn.status === 'unavailable') return <p className="text-[13px] text-muted">Spotify connects inside the installed Chrome extension.</p>;
  if (conn.status === 'disconnected')
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted">{conn.error ? conn.error.message : 'Spotify is not connected.'}</p>
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setErr(null);
              conn
                .connect()
                .catch((e) => setErr(e instanceof Error ? e.message : 'Could not connect Spotify.'))
                .finally(() => setBusy(false));
            }}
          >
            Connect Spotify
          </Button>
        </div>
        {err && (
          <p role="alert" className="text-[12.5px] text-danger">
            {err}
          </p>
        )}
      </div>
    );
  return null;
}
