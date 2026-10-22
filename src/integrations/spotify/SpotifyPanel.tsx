import { useRef, useState } from 'react';
import { Music, Volume2 } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/utils/cn';
import { estimateProgress } from './hooks';
import { CollectionSelect, ConnectionState, LikedHint, NowPlaying, OpenInSpotify, SpotifyNotice, Transport, useSpotifyController } from './SpotifyParts';

/** "Focus Playlist" card on the Focus page. Shares state with the mini player. Never fakes a connected state. */
export function SpotifyPanel() {
  const c = useSpotifyController();
  const connected = c.conn.status === 'connected';
  const now = useNow(1000, connected && !!c.snap?.isPlaying);
  const progress = estimateProgress(c.snap, now);
  const duration = c.snap?.track?.durationMs;
  const [volDraft, setVolDraft] = useState<number | null>(null);
  const volTimer = useRef<number | undefined>(undefined);
  const volume = volDraft ?? c.snap?.device?.volumePercent ?? null;

  return (
    <Card>
      <CardHeader title="Focus Playlist" icon={<Music size={16} />} />
      {/* Fixed minimum height: the card keeps its size across not-set-up / not-connected / playing states. */}
      <div className={cn('min-h-[236px] space-y-4 px-5 pb-5 text-sm', !connected && 'flex flex-col justify-center')} data-testid="spotify-panel-body">
        <ConnectionState conn={c.conn} />
        {connected && (
          <>
            <div className="space-y-1.5">
              <CollectionSelect selection={c.selection} lib={c.lib} onChange={c.actions.select} />
              <LikedHint liked={c.lib.liked} />
              {c.lib.error && <p className="text-[12px] text-danger">{c.lib.error}</p>}
            </div>
            <NowPlaying snap={c.snap} fallback={c.snap?.active ? 'Nothing playing' : 'Nothing playing right now'} />
            {progress !== undefined && duration ? (
              <div className="h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Track progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress / duration) * 100)}>
                <div className="h-full bg-fg/70" style={{ width: `${(progress / duration) * 100}%` }} />
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Transport c={c} />
              {c.snap?.device?.supportsVolume && volume !== null && (
                <label className="ml-auto flex items-center gap-2 text-muted">
                  <Volume2 size={16} aria-hidden />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volume}
                    aria-label="Volume"
                    className="w-24 accent-current"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolDraft(v);
                      window.clearTimeout(volTimer.current);
                      volTimer.current = window.setTimeout(() => void c.actions.volume(v).finally(() => setVolDraft(null)), 350);
                    }}
                  />
                </label>
              )}
            </div>
            {c.snap?.device && <p className="text-[12px] text-faint">Playing on {c.snap.device.name}</p>}
            <SpotifyNotice c={c} />
            {!c.error && <OpenInSpotify selection={c.selection} />}
          </>
        )}
      </div>
    </Card>
  );
}
