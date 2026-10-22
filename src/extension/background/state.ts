import type { FocusState, Settings } from '@/types/models';
import { DEFAULT_FOCUS } from '@/storage/schema';
import { mergeSettings } from '@/storage/store';

/**
 * Fresh reads straight from chrome.storage.local. The worker never trusts an
 * in-memory copy: it may have just been woken up, and other pages write too.
 */

export async function readFocus(): Promise<FocusState> {
  const r = await chrome.storage.local.get('ts.focus');
  return (r['ts.focus'] as FocusState | undefined) ?? DEFAULT_FOCUS;
}

export async function readSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get('ts.settings');
  return mergeSettings(r['ts.settings'] as Partial<Settings> | undefined);
}

/** Run async jobs one at a time (worker events can arrive concurrently). */
export function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job);
    tail = run.catch((e) => console.warn('[Tabspace]', e));
    return run;
  };
}
