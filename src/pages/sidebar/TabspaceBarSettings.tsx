import { useEffect, useState } from 'react';
import { Globe, PanelTop, X } from 'lucide-react';
import { Card, CardHeader, IconButton, Kbd, Toggle, useToast } from '@/components/ui';
import { useSettings } from '@/hooks/useStore';
import { update } from '@/storage/store';
import { BAR_PERMISSIONS, releaseBarGrant, requestWebsiteBar } from '@/extension/bar/register';
import type { Settings } from '@/types/models';

function patchBar(fn: (b: Settings['tabspaceBar']) => Settings['tabspaceBar']) {
  return update('ts.settings', (s) => ({ ...s, tabspaceBar: fn(s.tabspaceBar) }));
}

async function hasBarGrant(): Promise<boolean | null> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return null;
  try {
    return await chrome.permissions.contains(BAR_PERMISSIONS);
  } catch {
    return null;
  }
}

/** "Tabspace Bar" section of the Chrome Sidebar settings page. */
export function TabspaceBarSettings() {
  const [settings] = useSettings();
  const toast = useToast();
  const bar = settings.tabspaceBar;
  const [granted, setGranted] = useState<boolean | null>(null);
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  useEffect(() => {
    void hasBarGrant().then(setGranted);
    if (typeof chrome === 'undefined' || !chrome.permissions?.onAdded) return;
    const refresh = () => void hasBarGrant().then(setGranted);
    type Evt = { addListener(cb: () => void): void; removeListener?(cb: () => void): void };
    const events = [chrome.permissions.onAdded as unknown as Evt, chrome.permissions.onRemoved as unknown as Evt];
    events.forEach((e) => e.addListener(refresh));
    return () => events.forEach((e) => e.removeListener?.(refresh));
  }, []);

  const setWebsites = (on: boolean) => {
    if (!on) {
      // Releases exactly what Tabspace obtained when the bar was enabled (persisted record, any earlier visit).
      // The worker does the same on any onWebsites → false change (e.g. from another page or an import).
      void patchBar((b) => ({ ...b, onWebsites: false })).then(() => releaseBarGrant());
      return;
    }
    // Requested synchronously inside the click (user gesture); the setting is only saved if granted.
    void requestWebsiteBar(() => patchBar((b) => ({ ...b, onWebsites: true }))).then((ok) => {
      if (!ok) toast('The website bar needs permission to show on websites. It stays off.', 'error');
    });
  };

  const row = (label: string, hint: string | null, checked: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-faint">{hint}</div>}
      </div>
      <Toggle label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );

  return (
    <Card>
      <CardHeader title="Tabspace Bar" icon={<PanelTop size={17} />} />
      <div className="px-5 pb-5">
        <p className="text-[13px] text-muted">
          A slim bar with your favourite Tabspace bookmarks, folders and workspaces. Chrome doesn’t let extensions replace its own bookmarks bar — if you only want
          Tabspace’s, hide Chrome’s with <Kbd>{isMac ? '⌘ Shift B' : 'Ctrl Shift B'}</Kbd>.
        </p>
        <div className="mt-2 divide-y divide-line">
          {row('Show on New Tab', null, bar.onNewTab, (v) => void patchBar((b) => ({ ...b, onNewTab: v })))}
          {row(
            'Show on websites',
            bar.onWebsites && granted === false ? 'Permission was removed in Chrome — turn this off and on again to grant it.' : 'Off by default. Asks for permission to add the bar to websites.',
            bar.onWebsites && granted !== false,
            setWebsites,
          )}
          {row('Workspaces menu', null, bar.showWorkspaces, (v) => void patchBar((b) => ({ ...b, showWorkspaces: v })))}
          {row('Bookmark folders', null, bar.showFolders, (v) => void patchBar((b) => ({ ...b, showFolders: v })))}
        </div>
        {bar.onWebsites && (
          <p className="mt-3 flex gap-2 text-xs text-faint">
            <Globe size={13} className="mt-0.5 shrink-0" aria-hidden />
            The website bar sits in its own isolated frame (sites can’t read your bookmarks) and pushes the page down 34px. Sites with their own fixed header may have it
            partly covered — use “Hide on this site” from the bar’s ⋯ menu.
          </p>
        )}
        {bar.disabledSites.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1.5 text-xs font-medium text-muted">Hidden on</h3>
            <ul className="flex flex-wrap gap-1.5" aria-label="Sites where the bar is hidden">
              {bar.disabledSites.map((d) => (
                <li key={d} className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-surface-2/60 pr-1 pl-2 text-[12.5px]">
                  {d}
                  <IconButton label={`Show the bar on ${d} again`} size="sm" className="h-5 w-5" onClick={() => void patchBar((b) => ({ ...b, disabledSites: b.disabledSites.filter((x) => x !== d) }))}>
                    <X size={12} />
                  </IconButton>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
