import { useEffect, useState } from 'react';
import { ArrowUpCircle, Download, RefreshCw, X } from 'lucide-react';
import { Button, IconButton, useToast } from '@/components/ui';
import { RELEASES_URL } from '@/config';
import { isNewer } from '@/features/updates/version';
import { useStore } from '@/hooks/useStore';
import { checkForUpdates, currentVersion, dismissUpdate, installChannel, reloadExtension } from '@/services/updates';
import { cn } from '@/utils/cn';

function openUrl(url: string) {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) void chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener');
}

function useUpdate() {
  const [state] = useStore('ts.update');
  const [channel, setChannel] = useState<'store' | 'manual' | 'unknown'>('unknown');
  useEffect(() => {
    void installChannel().then(setChannel);
  }, []);
  const latest = state.latest;
  const available = !!latest && isNewer(latest.version, currentVersion());
  return { state, latest, available, channel };
}

/**
 * "Update available" UI.
 * - `banner`: dismissible strip for the dashboard (hidden once dismissed for that version).
 * - `card`: full block for Settings → About, with Check now.
 * - `compact`: one line for the toolbar popup.
 */
export function UpdateNotice({ variant, className }: { variant: 'banner' | 'card' | 'compact'; className?: string }) {
  const { state, latest, available, channel } = useUpdate();
  const [downloaded, setDownloaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const toast = useToast();

  const download = () => {
    if (!latest) return;
    openUrl(latest.downloadUrl ?? latest.url);
    setDownloaded(true);
  };

  if (variant === 'compact') {
    if (!available) return null;
    return (
      <button type="button" onClick={download} className={cn('flex w-full items-center gap-2 rounded-[10px] border border-line-strong px-3 py-2 text-left text-[13px] hover:bg-glow', className)}>
        <ArrowUpCircle size={15} aria-hidden />
        <span className="flex-1">Update available · v{latest!.version}</span>
        <span className="text-muted">Get it</span>
      </button>
    );
  }

  if (variant === 'banner') {
    if (!available || state.dismissed === latest!.version) return null;
    return (
      <div role="status" className={cn('ts-card ts-fade-in mb-5 flex flex-wrap items-center gap-3 px-4 py-3', className)}>
        <ArrowUpCircle size={20} className="text-fg" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <b>Tabspace {latest!.version}</b> is available <span className="text-muted">— you have {currentVersion()}.</span>
          {channel === 'store' && <span className="text-muted"> Chrome will install it automatically.</span>}
        </div>
        {channel !== 'store' && (
          <>
            {downloaded ? (
              <Button size="sm" variant="primary" icon={<RefreshCw size={14} />} onClick={reloadExtension}>
                Reload Tabspace
              </Button>
            ) : (
              <Button size="sm" variant="primary" icon={<Download size={14} />} onClick={download}>
                Download update
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => openUrl(latest!.url)}>
              What&apos;s new
            </Button>
          </>
        )}
        <IconButton label="Dismiss update notice" size="sm" onClick={() => void dismissUpdate(latest!.version)}>
          <X size={14} />
        </IconButton>
        {downloaded && <p className="w-full text-[12.5px] text-muted">Unzip the download and replace the files in your Tabspace folder, then click <b>Reload Tabspace</b>. Your data stays as it is.</p>}
      </div>
    );
  }

  // card
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">
          {available ? (
            <>
              <b>Version {latest!.version}</b> is available <span className="text-muted">(you have {currentVersion()})</span>
            </>
          ) : (
            <span className="text-muted">
              You're up to date{latest ? ` (latest release ${latest.version})` : ''}.
              {state.checkedAt ? ` Checked ${new Date(state.checkedAt).toLocaleString()}.` : ''}
            </span>
          )}
        </span>
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={14} className={checking ? 'animate-spin' : undefined} />}
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            const r = await checkForUpdates({ force: true });
            setChecking(false);
            if (r.error) toast(r.error, 'error');
            else toast(r.available ? `Tabspace ${r.version} is available.` : "You're on the latest version.");
          }}
        >
          Check now
        </Button>
      </div>
      {state.error && <p role="alert" className="text-[12.5px] text-danger">{state.error}</p>}
      {available && channel !== 'store' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon={<Download size={14} />} onClick={download}>
            Download update
          </Button>
          <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={reloadExtension}>
            Reload Tabspace
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openUrl(latest!.url)}>
            Release notes
          </Button>
        </div>
      )}
      <p className="text-[12.5px] text-faint">
        {channel === 'store'
          ? 'Installed from the Chrome Web Store — Chrome updates Tabspace automatically.'
          : 'Loaded as an unpacked extension: download the new build, replace the files in your Tabspace folder, then click Reload Tabspace. '}
        <button type="button" className="underline underline-offset-2 hover:text-fg" onClick={() => openUrl(RELEASES_URL)}>
          All releases
        </button>
      </p>
    </div>
  );
}
