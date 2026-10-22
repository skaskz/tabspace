import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Card, CardHeader, Checkbox, Toggle, useToast } from '@/components/ui';
import { useSettings } from '@/hooks/useStore';
import { update } from '@/storage/store';
import { ENGINE_INFO, ENGINES, engineList, releaseSearchTheme, requestSearchTheme, type Engine } from '@/extension/search/register';
import type { Settings } from '@/types/models';

function patchTheme(fn: (t: Settings['searchTheme']) => Settings['searchTheme']) {
  return update('ts.settings', (s) => ({ ...s, searchTheme: fn(s.searchTheme) }));
}

/** Engines whose origin (plus `scripting`) is currently granted, or null outside the extension. */
async function grantedEngines(): Promise<Engine[] | null> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return null;
  try {
    if (!(await chrome.permissions.contains({ permissions: ['scripting'] } as chrome.permissions.Permissions))) return [];
    const out: Engine[] = [];
    for (const e of ENGINES) if (await chrome.permissions.contains({ origins: [ENGINE_INFO[e].origin] })) out.push(e);
    return out;
  } catch {
    return null;
  }
}

/** "Search results" section: opt-in Tabspace look for Google / DuckDuckGo / Bing result pages. */
export function SearchThemeSettings() {
  const [settings] = useSettings();
  const toast = useToast();
  const theme = settings.searchTheme;
  const engines = engineList(theme.engines);
  const [granted, setGranted] = useState<Engine[] | null>(null);

  useEffect(() => {
    void grantedEngines().then(setGranted);
    if (typeof chrome === 'undefined' || !chrome.permissions?.onAdded) return;
    const refresh = () => void grantedEngines().then(setGranted);
    type Evt = { addListener(cb: () => void): void; removeListener?(cb: () => void): void };
    const events = [chrome.permissions.onAdded as unknown as Evt, chrome.permissions.onRemoved as unknown as Evt];
    events.forEach((e) => e.addListener(refresh));
    return () => events.forEach((e) => e.removeListener?.(refresh));
  }, []);

  const denied = () => toast('Chrome permission is needed to restyle search results. Nothing was changed.', 'error');

  const setEnabled = (on: boolean) => {
    if (!on) {
      void patchTheme((t) => ({ ...t, enabled: false })).then(() => releaseSearchTheme());
      return;
    }
    if (!engines.length) return toast('Pick at least one search engine first.', 'error');
    // Requested synchronously inside the click; the setting is saved only if granted.
    void requestSearchTheme(engines, () => patchTheme((t) => ({ ...t, enabled: true }))).then((ok) => !ok && denied());
  };

  const setEngine = (e: Engine, on: boolean) => {
    const next = (list: Engine[]) => ENGINES.filter((x) => (x === e ? on : list.includes(x)));
    if (!theme.enabled) {
      void patchTheme((t) => ({ ...t, engines: next(engineList(t.engines)) }));
      return;
    }
    if (on) {
      void requestSearchTheme([e], () => patchTheme((t) => ({ ...t, engines: next(engineList(t.engines)) }))).then((ok) => !ok && denied());
    } else {
      void patchTheme((t) => ({ ...t, engines: next(engineList(t.engines)) })).then(() => releaseSearchTheme([e]));
    }
  };

  const missing = theme.enabled && granted ? engines.filter((e) => !granted.includes(e)) : [];

  return (
    <Card>
      <CardHeader title="Search results" icon={<Search size={17} />} action={<Toggle label="Tabspace look for search results" checked={theme.enabled && missing.length < engines.length} onChange={setEnabled} />} />
      <div className="px-5 pb-5">
        <p className="text-[13px] text-muted">
          Give search results pages the Tabspace deep-space background, with results kept on solid dark cards so they stay easy to read. Applies only when the search engine itself
          is in dark mode; Chrome asks for access to just the engines you pick.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {ENGINES.map((e) => (
            <label key={e} className="flex items-center gap-2 text-sm">
              <Checkbox size="sm" checked={engines.includes(e)} onChange={(v) => setEngine(e, v)} label={ENGINE_INFO[e].label} />
              {ENGINE_INFO[e].label}
            </label>
          ))}
        </div>
        {missing.length > 0 && (
          <p className="mt-3 text-xs text-faint">
            Chrome no longer allows Tabspace on {missing.map((e) => ENGINE_INFO[e].label).join(', ')} — untick and tick {missing.length === 1 ? 'it' : 'them'} to grant access again.
          </p>
        )}
        <p className="mt-3 text-xs text-faint">Google: www.google.com only (country domains such as google.co.uk aren’t restyled).</p>
      </div>
    </Card>
  );
}
