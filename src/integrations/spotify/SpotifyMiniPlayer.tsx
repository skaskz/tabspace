import { useState, type ReactNode } from 'react';
import { MoreHorizontal, Music } from 'lucide-react';
import { Button, Menu, type MenuItem } from '@/components/ui';
import { cn } from '@/utils/cn';
import { LIKED, openInSpotifyUrl, SpotifyError } from './api';
import { collectionName, Transport, useSpotifyController, type SpotifyController } from './SpotifyParts';

/** Fixed height for every state, so the dashboard / New Tab layout never shifts. */
export const MINI_PLAYER_HEIGHT = 'h-[68px]';
const MENU_PLAYLISTS = 12;

function Art({ src }: { src?: string }) {
  return src ? (
    <img src={src} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-md border border-line object-cover" />
  ) : (
    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line text-faint">
      <Music size={17} />
    </span>
  );
}

function Shell({ className, children, art }: { className?: string; children: ReactNode; art?: string }) {
  return (
    <section aria-label="Spotify" className={cn('ts-card relative flex items-center gap-3 px-3', MINI_PLAYER_HEIGHT, className)} data-testid="spotify-mini">
      <Art src={art} />
      {children}
    </section>
  );
}

/** One-line state with at most one action. */
function StateRow({ className, text, action }: { className?: string; text: string; action?: ReactNode }) {
  return (
    <Shell className={className}>
      <p className="min-w-0 flex-1 truncate text-[13px] text-muted" title={text}>
        {text}
      </p>
      {action}
    </Shell>
  );
}

function menuItems(c: SpotifyController): MenuItem[] {
  const items: MenuItem[] = [];
  const seen = new Set<string>();
  const add = (item: MenuItem) => {
    let label = item.label;
    for (let i = 2; seen.has(label); i++) label = `${item.label} (${i})`;
    seen.add(label);
    items.push({ ...item, label });
  };
  if (c.error?.kind === 'noDevice' && c.devices?.length) {
    for (const d of c.devices) add({ label: `Play on ${d.name}`, disabled: d.isRestricted, onSelect: () => void c.actions.transfer(d.id) });
  }
  if (c.lib.liked.kind === 'needsScope') add({ label: 'Liked Songs — reconnect in Settings', onSelect: () => (window.location.hash = '#/settings?section=integrations') });
  else add({ label: `Play Liked Songs${c.lib.liked.kind === 'ok' ? ` (${c.lib.liked.total})` : ''}`, onSelect: () => (c.actions.select(LIKED), void c.actions.playSelection(LIKED)) });
  for (const p of c.lib.playlists.slice(0, MENU_PLAYLISTS)) add({ label: `Play ${p.name}`, onSelect: () => (c.actions.select(p.uri), void c.actions.playSelection(p.uri)) });
  if (c.lib.playlists.length > MENU_PLAYLISTS) add({ label: 'All playlists (Focus page)…', onSelect: () => (window.location.hash = '#/focus') });
  const url = openInSpotifyUrl(c.selection) ?? 'https://open.spotify.com/';
  add({ label: 'Open in Spotify', onSelect: () => void window.open(url, '_blank', 'noopener,noreferrer') });
  return items;
}

/**
 * Compact player for the Home Dashboard sidebar and the New Tab page: one 68 px row in every
 * state. Collection and device choices live in a menu so the card never grows. Never autoplays.
 */
export function SpotifyMiniPlayer({ className }: { className?: string }) {
  const c = useSpotifyController();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const { conn } = c;

  if (conn.status === 'loading') return <StateRow className={className} text="Checking Spotify…" />;
  if (conn.status === 'unconfigured')
    return (
      <StateRow
        className={className}
        text="Spotify isn’t set up"
        action={
          <a href="#/settings?section=integrations" className="shrink-0 text-[12.5px] font-medium text-fg underline underline-offset-4">
            Set up
          </a>
        }
      />
    );
  if (conn.status === 'unavailable') return <StateRow className={className} text="Spotify works in the installed extension" />;
  if (conn.status === 'disconnected')
    return (
      <StateRow
        className={className}
        text={connectError ?? conn.error?.message ?? 'Spotify isn’t connected'}
        action={
          <Button
            size="sm"
            variant="secondary"
            disabled={connecting}
            onClick={() => {
              setConnecting(true);
              setConnectError(null);
              conn
                .connect()
                .catch((e) => setConnectError(e instanceof Error ? e.message : 'Could not connect Spotify.'))
                .finally(() => setConnecting(false));
            }}
          >
            Connect
          </Button>
        }
      />
    );

  const snap = c.snap;
  const name = collectionName(c.selection, c.lib);
  const err = c.error ?? (snap?.error && snap.error.kind !== 'auth' ? new SpotifyError(snap.error.kind, snap.error.message) : null);
  const title = snap?.track?.name ?? (name ? name : 'Nothing playing');
  const sub = err ? err.message : snap?.track ? snap.track.artists : snap?.device ? snap.device.name : name ? 'Press play to start' : 'Choose a playlist in the menu';

  return (
    <Shell className={className} art={snap?.track?.image}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium" title={title}>
          {title}
        </p>
        <p role={err ? 'alert' : undefined} className={cn('truncate text-[12px]', err ? 'text-fg/80' : 'text-muted')} title={sub}>
          {sub}
        </p>
      </div>
      <Transport c={c} size="sm" />
      <Menu label="Spotify options" trigger={<MoreHorizontal size={16} />} items={menuItems(c)} />
    </Shell>
  );
}
