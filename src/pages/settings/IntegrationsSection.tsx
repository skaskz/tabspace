import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, ExternalLink, Music, Rss } from 'lucide-react';
import { Button, Input, useConfirm, useToast } from '@/components/ui';
import type { Settings } from '@/types/models';
import { identityAvailable, redirectUri } from '@/integrations/secrets';
import { connectGoogle, disconnectGoogle, hasGoogleMarker, verifyGoogle } from '@/integrations/google/client';
import { connectSpotify, disconnectSpotify, grantedSpotifyScopes, hasSpotifySecret, spotifyClient } from '@/integrations/spotify/auth';
import { SPOTIFY_SCOPES } from '@/integrations/spotify/pkce';
import { CopyField, patchSettings, Section, StatusPill } from './shared';

type Status = { kind: 'checking' } | { kind: 'unavailable' } | { kind: 'unconfigured' } | { kind: 'disconnected' } | { kind: 'reconnect' } | { kind: 'connected'; detail?: string };

function StatusLine({ status }: { status: Status }) {
  switch (status.kind) {
    case 'checking':
      return <StatusPill tone="pending">Checking…</StatusPill>;
    case 'unavailable':
      return <StatusPill tone="off">Only in the installed extension</StatusPill>;
    case 'unconfigured':
      return <StatusPill tone="off">Not set up</StatusPill>;
    case 'disconnected':
      return <StatusPill tone="off">Not connected</StatusPill>;
    case 'reconnect':
      return <StatusPill tone="warn">Reconnect needed</StatusPill>;
    case 'connected':
      return <StatusPill tone="ok">Connected{status.detail ? ` · ${status.detail}` : ''}</StatusPill>;
  }
}

function ClientIdInput({ label, value, placeholder, validate, onSave }: { label: string; value: string; placeholder: string; validate: (v: string) => string | null; onSave: (v: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft.trim() !== value;
  const save = async () => {
    const v = draft.trim();
    const err = v ? validate(v) : null;
    setError(err);
    if (!err) await onSave(v);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-medium text-muted">
        {label}
        <div className="mt-1.5 flex gap-2">
          <Input className="flex-1" value={draft} placeholder={placeholder} spellCheck={false} autoComplete="off" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
          <Button onClick={() => void save()} disabled={!dirty}>
            Save
          </Button>
        </div>
      </label>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <details className="rounded-[var(--radius-ctl)] border border-line bg-surface-2/50 px-4 py-3 text-[13px] text-muted">
      <summary className="cursor-pointer font-medium text-fg">Setup steps</summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5">{children}</ol>
    </details>
  );
}

const ext = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-fg underline underline-offset-4">
    {text} <ExternalLink size={11} aria-hidden />
  </a>
);

export function IntegrationsSection({ settings }: { settings: Settings }) {
  const confirm = useConfirm();
  const toast = useToast();
  const uri = redirectUri();
  const googleId = settings.integrations.googleClientId?.trim() ?? '';
  const spotifyId = settings.integrations.spotifyClientId?.trim() ?? '';
  const [google, setGoogle] = useState<Status>({ kind: 'checking' });
  const [spotify, setSpotify] = useState<Status>({ kind: 'checking' });
  /** Scopes added since the user connected (e.g. user-library-read for Liked Songs). */
  const [missingScopes, setMissingScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState<'google' | 'spotify' | null>(null);

  const checkGoogle = useCallback(async () => {
    if (!identityAvailable()) return setGoogle({ kind: 'unavailable' });
    if (!googleId) return setGoogle({ kind: 'unconfigured' });
    if (!(await hasGoogleMarker())) return setGoogle({ kind: 'disconnected' });
    setGoogle({ kind: 'checking' });
    setGoogle((await verifyGoogle()) ? { kind: 'connected', detail: 'read-only' } : { kind: 'reconnect' });
  }, [googleId]);

  const checkSpotify = useCallback(async () => {
    if (!identityAvailable()) return setSpotify({ kind: 'unavailable' });
    if (!spotifyId) return setSpotify({ kind: 'unconfigured' });
    if (!(await hasSpotifySecret())) return setSpotify({ kind: 'disconnected' });
    setSpotify({ kind: 'checking' });
    try {
      const me = await spotifyClient().me();
      const granted = await grantedSpotifyScopes();
      setMissingScopes(SPOTIFY_SCOPES.filter((sc) => !granted.includes(sc)));
      setSpotify({ kind: 'connected', detail: me.displayName });
    } catch {
      setSpotify((await hasSpotifySecret()) ? { kind: 'reconnect' } : { kind: 'disconnected' });
    }
  }, [spotifyId]);

  useEffect(() => {
    void checkGoogle();
  }, [checkGoogle]);
  useEffect(() => {
    void checkSpotify();
  }, [checkSpotify]);

  const connectG = async () => {
    setBusy('google');
    try {
      await connectGoogle();
      toast('Google Calendar connected. Choose calendars in Calendar → Add calendar.');
      await checkGoogle();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not connect Google.', 'error');
      await checkGoogle();
    } finally {
      setBusy(null);
    }
  };
  const disconnectG = async () => {
    if (!(await confirm({ title: 'Disconnect Google Calendar?', message: 'Your sign-in token is removed from this browser. Google calendars stay in your Calendars list (with their last synced events) but stop syncing until you reconnect or remove them.', confirmLabel: 'Disconnect', danger: true }))) return;
    await disconnectGoogle();
    await checkGoogle();
  };
  const connectS = async () => {
    setBusy('spotify');
    try {
      const me = await connectSpotify();
      toast(`Spotify connected as ${me.displayName}`);
      await checkSpotify();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not connect Spotify.', 'error');
      await checkSpotify();
    } finally {
      setBusy(null);
    }
  };
  const disconnectS = async () => {
    if (!(await confirm({ title: 'Disconnect Spotify?', message: 'Your Spotify tokens are deleted from this browser. Spotify has no revoke API — to remove Tabspace’s access completely, also remove the app under spotify.com → Account → Manage apps.', confirmLabel: 'Disconnect', danger: true }))) return;
    await disconnectSpotify();
    await checkSpotify();
  };

  const canConnect = (s: Status) => s.kind === 'disconnected' || s.kind === 'reconnect';

  return (
    <Section id="integrations" title="Integrations" description="Optional connections. Each uses your own developer credentials — Tabspace has no servers and never sees your data.">
      {/* Google Calendar */}
      <div className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays size={16} className="text-muted" aria-hidden /> Google Calendar
          </h3>
          <div className="flex items-center gap-2">
            <StatusLine status={google} />
            {canConnect(google) && (
              <Button size="sm" variant="primary" disabled={busy === 'google'} onClick={() => void connectG()}>
                {google.kind === 'reconnect' ? 'Reconnect' : 'Connect'}
              </Button>
            )}
            {(google.kind === 'connected' || google.kind === 'reconnect') && (
              <Button size="sm" variant="ghost" onClick={() => void disconnectG()}>
                Disconnect
              </Button>
            )}
          </div>
        </div>
        <p className="text-[13px] text-muted">Read-only access to the calendars you choose. The access token lives only in this browser session and is never exported.</p>
        <ClientIdInput
          label="OAuth client ID (Web application)"
          value={googleId}
          placeholder="1234567890-abc….apps.googleusercontent.com"
          validate={(v) => (/^[\w-]+\.apps\.googleusercontent\.com$/.test(v) ? null : 'A Google client ID ends with .apps.googleusercontent.com')}
          onSave={async (v) => {
            if (v !== googleId && (await hasGoogleMarker())) await disconnectGoogle();
            await patchSettings((s) => ({ ...s, integrations: { ...s.integrations, googleClientId: v || undefined } }));
            toast(v ? 'Google client ID saved' : 'Google client ID removed');
          }}
        />
        <Steps>
          <li>Open the {ext('https://console.cloud.google.com/', 'Google Cloud console')} and create (or pick) a project.</li>
          <li>
            In <b>APIs &amp; Services → Library</b>, enable the <b>Google Calendar API</b>.
          </li>
          <li>
            Configure the <b>OAuth consent screen</b> (Google Auth Platform → Branding / Audience): user type <b>External</b>, your app name and email. While the app is in <b>Testing</b>, add your Google account under <b>Test users</b>.
          </li>
          <li>
            Under <b>Data access</b>, add the scope <code>…/auth/calendar.readonly</code>.
          </li>
          <li>
            Go to <b>Clients → Create client</b>, choose application type <b>Web application</b>, and add this exact <b>Authorized redirect URI</b>:
            <div className="mt-2">{uri ? <CopyField value={uri} label="Copy redirect URI" /> : <span className="text-faint">Shown here inside the installed extension (https://&lt;extension-id&gt;.chromiumapp.org/).</span>}</div>
          </li>
          <li>Copy the <b>Client ID</b> (no client secret is needed), paste it above, Save, then Connect.</li>
        </Steps>
      </div>

      {/* Spotify */}
      <div className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Music size={16} className="text-muted" aria-hidden /> Spotify (Focus Playlist)
          </h3>
          <div className="flex items-center gap-2">
            <StatusLine status={spotify} />
            {(canConnect(spotify) || (spotify.kind === 'connected' && missingScopes.length > 0)) && (
              <Button size="sm" variant="primary" disabled={busy === 'spotify'} onClick={() => void connectS()}>
                {spotify.kind === 'disconnected' ? 'Connect' : 'Reconnect'}
              </Button>
            )}
            {(spotify.kind === 'connected' || spotify.kind === 'reconnect') && (
              <Button size="sm" variant="ghost" onClick={() => void disconnectS()}>
                Disconnect
              </Button>
            )}
          </div>
        </div>
        <p className="text-[13px] text-muted">
          Pick a playlist or your Liked Songs and control playback from the Focus page, the dashboard and the New Tab page. Spotify only allows playback control for <b>Premium</b> accounts and needs an active Spotify device; otherwise use “Open in Spotify”.
        </p>
        {spotify.kind === 'connected' && missingScopes.length > 0 && (
          <p role="status" className="rounded-[var(--radius-ctl)] border border-line bg-surface-2 px-3 py-2 text-[13px] text-muted">
            Reconnect Spotify to grant new permissions{missingScopes.includes('user-library-read') ? ' (needed to show your Liked Songs)' : ''}.
          </p>
        )}
        <ClientIdInput
          label="Spotify app client ID"
          value={spotifyId}
          placeholder="32-character client ID"
          validate={(v) => (/^[0-9a-f]{32}$/i.test(v) ? null : 'A Spotify client ID is 32 letters and numbers.')}
          onSave={async (v) => {
            if (v !== spotifyId && (await hasSpotifySecret())) await disconnectSpotify();
            await patchSettings((s) => ({ ...s, integrations: { ...s.integrations, spotifyClientId: v || undefined } }));
            toast(v ? 'Spotify client ID saved' : 'Spotify client ID removed');
          }}
        />
        <Steps>
          <li>
            Sign in to the {ext('https://developer.spotify.com/dashboard', 'Spotify Developer Dashboard')}. Spotify currently requires the app owner to have <b>Spotify Premium</b> for Development Mode apps.
          </li>
          <li>
            <b>Create app</b>: any name and description; tick <b>Web API</b>; add this exact <b>Redirect URI</b>:
            <div className="mt-2">{uri ? <CopyField value={uri} label="Copy redirect URI" /> : <span className="text-faint">Shown here inside the installed extension (https://&lt;extension-id&gt;.chromiumapp.org/).</span>}</div>
          </li>
          <li>
            Open the app’s <b>Settings</b> and copy the <b>Client ID</b> (Tabspace uses PKCE — never paste the client secret).
          </li>
          <li>
            In <b>User Management</b>, add the Spotify account(s) that will use Tabspace — Development Mode allows only a few listed users.
          </li>
          <li>Paste the client ID above, Save, then Connect. Requested scopes: playback state, playback control, currently playing, private playlists, saved tracks (Liked Songs).</li>
        </Steps>
      </div>

      {/* ICS */}
      <div className="flex items-start justify-between gap-4 py-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Rss size={16} className="text-muted" aria-hidden /> ICS calendar feeds
          </h3>
          <p className="mt-1 text-[13px] text-muted">Subscribe to any iCal / webcal link (Outlook, Apple, Proton, Notion and more). Feeds are fetched directly from this browser and refreshed hourly.</p>
        </div>
        <a href="#/calendar" className="shrink-0 text-[13px] font-medium underline underline-offset-4">
          Open Calendar
        </a>
      </div>
    </Section>
  );
}
