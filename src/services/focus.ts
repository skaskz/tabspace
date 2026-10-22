import { get, insert, newId, update } from '@/storage/store';
import * as timer from '@/features/focus/timer';
import type { FocusKind } from '@/types/models';

/**
 * Focus actions used by every surface. They only write `ts.focus`; the
 * service worker observes that key to schedule chrome.alarms, update the
 * toolbar badge and toggle site blocking.
 */

export async function startFocus(kind?: FocusKind, minutes?: number) {
  const settings = await get('ts.settings');
  const current = await get('ts.focus');
  const k = kind ?? current.kind ?? 'focus';
  const ms = minutes ? timer.clampMinutes(minutes) * 60_000 : timer.durationFor(k, settings.focus);
  await update('ts.focus', () => timer.start(k, ms));
}

export async function pauseFocus() {
  await update('ts.focus', (s) => timer.pause(s));
}

export async function resumeFocus() {
  await update('ts.focus', (s) => timer.resume(s));
}

export async function toggleFocus() {
  const s = await get('ts.focus');
  if (s.status === 'running') return pauseFocus();
  if (s.status === 'paused') return resumeFocus();
  return startFocus(s.kind);
}

/** Stop early. Records partial focus time (if over a minute) and returns to idle. */
export async function stopFocus() {
  const s = await get('ts.focus');
  const rec = timer.toRecord(s, Date.now(), false, newId());
  if (rec && s.kind !== 'short' && s.kind !== 'long') await insert('ts.focusSessions', rec);
  await update('ts.focus', (cur) => timer.reset(cur));
}

export async function resetFocus() {
  await update('ts.focus', (cur) => timer.reset(cur));
}

export async function selectFocusKind(kind: FocusKind, minutes?: number) {
  const settings = await get('ts.settings');
  const ms = minutes ? timer.clampMinutes(minutes) * 60_000 : timer.durationFor(kind, settings.focus);
  await update('ts.focus', (cur) => (cur.status === 'idle' ? timer.select(kind, ms) : cur));
}
