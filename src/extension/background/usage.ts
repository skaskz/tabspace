import { update } from '@/storage/store';
import { closeSegment, pruneUsage, usageDomain, type UsageSegment } from '@/features/usage/accumulate';
import { readSettings } from './state';

/**
 * Opt-in active-tab time per hostname (settings.analytics.trackWebsites).
 * The open segment lives in chrome.storage.session so a suspended worker can
 * compute elapsed time when the next event arrives. Nothing runs or is stored
 * while tracking is off; turning it off never deletes already-collected data.
 */

export const USAGE_FLUSH_ALARM = 'ts-usage-flush';
const SEGMENT_KEY = 'ts.usageSegment';

async function getSegment(): Promise<UsageSegment | null> {
  if (!chrome.storage.session) return null;
  const r = await chrome.storage.session.get(SEGMENT_KEY);
  return (r[SEGMENT_KEY] as UsageSegment | undefined) ?? null;
}

async function setSegment(seg: UsageSegment | null): Promise<void> {
  if (!chrome.storage.session) return;
  if (seg) await chrome.storage.session.set({ [SEGMENT_KEY]: seg });
  else await chrome.storage.session.remove(SEGMENT_KEY);
}

/** URL of the active tab in the focused browser window, or null when Chrome isn't focused. */
async function activeUrl(): Promise<string | null> {
  try {
    const win = await chrome.windows.getLastFocused();
    if (!win?.focused || win.id === undefined) return null;
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    return tab?.url ?? null;
  } catch {
    return null;
  }
}

/** Close the current segment and open a new one for whatever is active now. */
export async function refreshUsage(now = Date.now()): Promise<void> {
  const settings = await readSettings();
  const seg = await getSegment();
  if (!settings.analytics.trackWebsites) {
    if (seg) await setSegment(null);
    await chrome.alarms.clear(USAGE_FLUSH_ALARM);
    return;
  }
  if (!(await chrome.alarms.get(USAGE_FLUSH_ALARM))) await chrome.alarms.create(USAGE_FLUSH_ALARM, { periodInMinutes: 5 });
  if (seg && now - seg.start >= 1000) {
    await update('ts.usage', (log) => pruneUsage(closeSegment(log, seg, now), now));
  }
  const domain = usageDomain(await activeUrl());
  await setSegment(domain ? { domain, start: now } : null);
}
