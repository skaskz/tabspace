import { useEffect, useState } from 'react';

/**
 * Permission gate for site blocking. Chrome's docs list declarativeNetRequest
 * among the permissions that CANNOT be optional, so the manifest keeps it
 * required; these helpers then resolve "granted" immediately. The flow is kept
 * (request inside the toggle's click, honour a denial, live state) so the UI
 * and worker stay correct if the permission model ever changes or the user
 * build makes it optional/host-scoped (declarativeNetRequestWithHostAccess).
 */

const DNR = { permissions: ['declarativeNetRequest'] } as chrome.permissions.Permissions;

function api(): typeof chrome.permissions | null {
  const p = typeof chrome !== 'undefined' ? (chrome.permissions as typeof chrome.permissions | undefined) : undefined;
  return p && typeof p.request === 'function' ? p : null;
}

export async function hasBlockingPermission(): Promise<boolean> {
  const p = api();
  if (!p) return false;
  try {
    return await p.contains(DNR);
  } catch {
    return false;
  }
}

/**
 * Ask for the permission. MUST be called synchronously from a click handler
 * (user gesture) — do not await anything before calling it.
 * Outside the extension (dev server/tests) resolves 'unavailable'.
 */
export function requestBlockingPermission(): Promise<'granted' | 'denied' | 'unavailable'> {
  const p = api();
  if (!p) return Promise.resolve('unavailable');
  return p.request(DNR).then(
    (ok) => (ok ? 'granted' : 'denied'),
    () => 'denied',
  );
}

/** Live permission state (null = unknown / not running as an extension). */
export function useBlockingPermission(): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    const p = api();
    if (!p) return;
    const refresh = () => void hasBlockingPermission().then(setGranted);
    refresh();
    // @types/chrome types these events without removeListener, but Chrome's Event objects have it.
    type Evt = { addListener(cb: () => void): void; removeListener?(cb: () => void): void } | undefined;
    const events = [p.onAdded as unknown as Evt, p.onRemoved as unknown as Evt];
    events.forEach((ev) => ev?.addListener(refresh));
    return () => events.forEach((ev) => ev?.removeListener?.(refresh));
  }, []);
  return granted;
}
