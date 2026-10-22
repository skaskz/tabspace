import { GITHUB_REPO } from '@/config';
import { isNewer, readRelease } from '@/features/updates/version';
import { get, update } from '@/storage/store';

/**
 * Update checker.
 *
 * - Chrome Web Store installs update themselves; there we only nudge Chrome (`requestUpdateCheck`).
 * - Unpacked / GitHub installs can't replace their own files, so we check GitHub Releases and offer a
 *   one-click download of the new build plus a "Reload Tabspace" button once the files are replaced.
 *
 * The only network request is `GET https://api.github.com/repos/<repo>/releases/latest` (no data sent,
 * no cookies), and it can be turned off in Settings.
 */

export const UPDATE_ALARM = 'ts-update-check';
export const CHECK_EVERY_MIN = 12 * 60;

export function currentVersion(): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '0.0.0';
}

/** 'store' when Chrome manages updates (Web Store / policy), 'manual' for unpacked installs. */
export async function installChannel(): Promise<'store' | 'manual' | 'unknown'> {
  try {
    if (typeof chrome === 'undefined' || !chrome.management?.getSelf) return 'unknown';
    const self = await chrome.management.getSelf();
    return self.installType === 'development' ? 'manual' : 'store';
  } catch {
    return 'unknown';
  }
}

/** Check for a newer release. `force` ignores the "checked recently" throttle. Never throws. */
export async function checkForUpdates({ force = false, fetchImpl = fetch } = {}): Promise<{ available: boolean; version?: string; error?: string }> {
  const settings = await get('ts.settings');
  if (!settings.updates.check && !force) return { available: false };
  const state = await get('ts.update');
  if (!force && state.checkedAt && Date.now() - state.checkedAt < 60 * 60_000) {
    const v = state.latest?.version;
    return { available: !!v && isNewer(v, currentVersion()), version: v };
  }

  if ((await installChannel()) === 'store') {
    try {
      await chrome.runtime.requestUpdateCheck();
    } catch {
      /* Chrome throttles this; its own schedule still applies */
    }
  }

  try {
    const res = await fetchImpl(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (res.status === 404) {
      await update('ts.update', (s) => ({ ...s, checkedAt: Date.now(), latest: undefined, error: undefined }));
      return { available: false };
    }
    if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? 'GitHub is rate-limiting update checks — try again later.' : `GitHub returned ${res.status}.`);
    const latest = readRelease(await res.json());
    await update('ts.update', (s) => ({ ...s, checkedAt: Date.now(), latest: latest ?? undefined, error: undefined }));
    return { available: !!latest && isNewer(latest.version, currentVersion()), version: latest?.version };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Couldn't reach GitHub.";
    await update('ts.update', (s) => ({ ...s, checkedAt: Date.now(), error }));
    return { available: false, error };
  }
}

export async function dismissUpdate(version: string): Promise<void> {
  await update('ts.update', (s) => ({ ...s, dismissed: version }));
}

/** Reload the extension after the user replaced its files with the new build. */
export function reloadExtension(): void {
  if (typeof chrome !== 'undefined' && chrome.runtime?.reload) chrome.runtime.reload();
}
