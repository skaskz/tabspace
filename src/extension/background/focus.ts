import type { FocusState, Settings } from '@/types/models';
import { insert, newId, update } from '@/storage/store';
import { badgeText, badgeTitle, completeIfFinished, isFinished, kindLabel, nextBadgeChangeAt } from '@/features/focus/timer';
import { readFocus, readSettings } from './state';
import { playChime } from './chime';

/**
 * Focus timer side of the service worker. All timing is chrome.alarms based:
 *  - `ts-focus-end`  fires at the session's absolute endAt
 *  - `ts-focus-tick` refreshes the minute badge, aligned to minute boundaries
 * No setInterval; worker suspension is harmless because state lives in storage.
 */

export const FOCUS_END_ALARM = 'ts-focus-end';
export const FOCUS_TICK_ALARM = 'ts-focus-tick';
export const FOCUS_NOTIFICATION_PREFIX = 'ts-focus-';

const BADGE_BG = '#3a3a3c';
const BADGE_FG = '#ffffff';

export async function renderBadge(focus: FocusState, settings: Settings, now = Date.now()): Promise<void> {
  if (!chrome.action) return;
  const text = settings.focus.showBadge ? badgeText(focus, now) : '';
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_BG });
    await chrome.action.setBadgeTextColor?.({ color: BADGE_FG });
  }
  await chrome.action.setTitle({ title: badgeTitle(focus, now) });
}

async function notifyComplete(focus: FocusState, settings: Settings): Promise<void> {
  if (!settings.notifications.focus || !chrome.notifications) return;
  const isBreak = focus.kind === 'short' || focus.kind === 'long';
  await chrome.notifications.create(`${FOCUS_NOTIFICATION_PREFIX}${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: isBreak ? 'Break finished' : `${kindLabel(focus.kind)} session complete`,
    message: isBreak ? 'Ready to get back into the zone?' : `Nice work — ${Math.round(focus.durationMs / 60_000)} minutes of focus. Time for a break.`,
    priority: 1,
  });
}

/**
 * Complete the session if (and only if) it is still running and finished.
 * Safe to call repeatedly: the guard re-reads state inside the serialised update.
 */
export async function completeIfDue(now = Date.now()): Promise<boolean> {
  const before = await readFocus();
  if (!isFinished(before, now)) return false;
  let result: ReturnType<typeof completeIfFinished> = null;
  await update('ts.focus', (cur) => {
    result = completeIfFinished(cur, now, newId());
    return result ? result.next : cur;
  });
  const done = result as ReturnType<typeof completeIfFinished>;
  if (!done) return false;
  if (done.record) {
    const { id, kind, startedAt, endedAt, plannedMs, actualMs, completed } = done.record;
    await insert('ts.focusSessions', { id, kind, startedAt, endedAt, plannedMs, actualMs, completed });
  }
  const settings = await readSettings();
  // Chime and notification are independent: one failing must not stop the other.
  await Promise.allSettled([notifyComplete(before, settings), settings.focus.sound ? playChime() : Promise.resolve()]);
  return true;
}

/** Reconcile alarms + badge with the stored timer state. Idempotent. */
export async function syncFocus(now = Date.now()): Promise<void> {
  await completeIfDue(now);
  const [focus, settings] = await Promise.all([readFocus(), readSettings()]);
  if (focus.status === 'running' && focus.endAt) {
    await chrome.alarms.create(FOCUS_END_ALARM, { when: focus.endAt });
    const next = nextBadgeChangeAt(focus, now);
    if (next) await chrome.alarms.create(FOCUS_TICK_ALARM, { when: next, periodInMinutes: 1 });
  } else {
    await chrome.alarms.clear(FOCUS_END_ALARM);
    await chrome.alarms.clear(FOCUS_TICK_ALARM);
  }
  await renderBadge(focus, settings, now);
}
