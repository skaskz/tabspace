import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SpotifyMiniPlayer } from '@/integrations/spotify/SpotifyMiniPlayer';
import { __resetSpotifyHooks } from '@/integrations/spotify/hooks';
import { __resetSpotifyService } from '@/integrations/spotify/service';
import { __resetMemorySecrets, setSecret } from '@/integrations/secrets';
import { SPOTIFY_SCOPES } from '@/integrations/spotify/pkce';
import { set } from '@/storage/store';
import { DEFAULT_SETTINGS } from '@/storage/schema';

const CLIENT = 'a'.repeat(32);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const playing = { is_playing: true, progress_ms: 10, item: { name: 'Weightless', duration_ms: 1000, artists: [{ name: 'Marconi Union' }], album: { images: [] } }, device: { id: 'd1', name: 'Laptop', volume_percent: 40 } };

function stubSpotify(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const key = `${init.method ?? 'GET'} ${String(url).replace('https://api.spotify.com/v1', '').split('?')[0]}`;
      const r = routes[key];
      if (!r) throw new Error(`unexpected ${key}`);
      return r();
    }),
  );
}

const root = () => screen.getByTestId('spotify-mini');

async function setup(opts: { clientId?: boolean; identity?: boolean; secret?: boolean }) {
  await set('ts.settings', { ...DEFAULT_SETTINGS, integrations: opts.clientId ? { spotifyClientId: CLIENT } : {} });
  if (opts.identity) vi.stubGlobal('chrome', { identity: { launchWebAuthFlow: vi.fn(), getRedirectURL: () => 'https://x.chromiumapp.org/' } });
  if (opts.secret) await setSecret('secret.spotify', { accessToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3600_000, clientId: CLIENT, scope: SPOTIFY_SCOPES.join(' ') }, 'local');
}

beforeEach(() => {
  __resetMemorySecrets();
  __resetSpotifyService();
  __resetSpotifyHooks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SpotifyMiniPlayer compact states', () => {
  it('not configured: one line with a Set up link, fixed height', async () => {
    await setup({});
    render(<SpotifyMiniPlayer />);
    expect(await screen.findByText('Spotify isn’t set up')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up' })).toHaveAttribute('href', '#/settings?section=integrations');
    expect(root()).toHaveClass('h-[68px]');
  });

  it('outside the extension: honest one-liner, no fake controls', async () => {
    await setup({ clientId: true });
    render(<SpotifyMiniPlayer />);
    expect(await screen.findByText('Spotify works in the installed extension')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next track/ })).toBeNull();
    expect(root()).toHaveClass('h-[68px]');
  });

  it('not connected: one line with a single Connect button', async () => {
    await setup({ clientId: true, identity: true });
    render(<SpotifyMiniPlayer />);
    expect(await screen.findByText('Spotify isn’t connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(root()).toHaveClass('h-[68px]');
  });

  it('playing: title, artist and controls in the same row; Premium error replaces the subtitle', async () => {
    await setup({ clientId: true, identity: true, secret: true });
    stubSpotify({
      'GET /me': () => json({ id: 'u', display_name: 'Joe' }),
      'GET /me/playlists': () => json({ items: [{ id: 'p1', name: 'Deep Focus', uri: 'spotify:playlist:p1' }], next: null }),
      'GET /me/tracks': () => json({ total: 42, next: null, items: [] }),
      'GET /me/player': () => json(playing),
      'POST /me/player/next': () => json({ error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } }, 403),
    });
    render(<SpotifyMiniPlayer />);
    expect(await screen.findByText('Weightless')).toBeInTheDocument();
    expect(screen.getByText('Marconi Union')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Spotify Premium is required for playback control.');
    expect(root()).toHaveClass('h-[68px]');
    // Collections live in the menu, not in the card.
    fireEvent.click(screen.getByRole('button', { name: 'Spotify options' }));
    expect(screen.getByRole('menuitem', { name: 'Play Liked Songs (42)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Play Deep Focus' })).toBeInTheDocument();
  });

  it('no active device: one-line message and a device picker in the menu', async () => {
    await setup({ clientId: true, identity: true, secret: true });
    stubSpotify({
      'GET /me': () => json({ id: 'u' }),
      'GET /me/playlists': () => json({ items: [], next: null }),
      'GET /me/tracks': () => json({ total: 0, next: null, items: [] }),
      'GET /me/player': () => new Response(null, { status: 204 }),
      'PUT /me/player/play': () => json({ error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } }, 404),
      'GET /me/player/devices': () => json({ devices: [{ id: 'k1', name: 'Kitchen speaker', type: 'Speaker', is_active: false, is_restricted: false, volume_percent: 30 }] }),
    });
    render(<SpotifyMiniPlayer />);
    expect(await screen.findByText('Nothing playing')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('No active Spotify device — open Spotify on a device first.');
    expect(root()).toHaveClass('h-[68px]');
    fireEvent.click(screen.getByRole('button', { name: 'Spotify options' }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Play on Kitchen speaker' })).toBeInTheDocument());
  });
});
