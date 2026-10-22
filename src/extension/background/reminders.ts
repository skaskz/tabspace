import { get } from '@/storage/store';
import { formatWhen, parseReminderName, planReminders, REMINDER_PREFIX } from '@/features/calendar/reminders';
import { syncAllSources } from '@/integrations/calendarSync';
import { maybeDailySnapshot } from '@/services/backup';
import { migrateLegacySecrets, restrictSessionStorage } from '@/integrations/secrets';

/**
 * Event/task reminders, periodic calendar sync and daily local backups.
 * chrome.alarms only (no intervals). Safe to call more than once.
 */

const SYNC_ALARM = 'ts-calendar-sync';
const BACKUP_ALARM = 'ts-daily-backup';
const NOTIF_PREFIX = 'ts-rem-notif|';
const WATCHED = new Set(['ts.events', 'ts.tasks', 'ts.settings', 'ts.calendarSources']);
const MAX_SCHEDULED = 20;

let registered = false;
let rescheduleTimer: ReturnType<typeof setTimeout> | undefined;

async function ensureAlarm(name: string, periodInMinutes: number, delayInMinutes: number) {
  const existing = await chrome.alarms.get(name);
  if (!existing || existing.periodInMinutes !== periodInMinutes) await chrome.alarms.create(name, { periodInMinutes, delayInMinutes });
}

/** Clear and recreate the next N reminder alarms. */
export async function rescheduleReminders(now = Date.now()): Promise<number> {
  const [events, sources, tasks, settings] = await Promise.all([get('ts.events'), get('ts.calendarSources'), get('ts.tasks'), get('ts.settings')]);
  const plan = planReminders({ events, sources, tasks, settings, now, limit: MAX_SCHEDULED });
  const wanted = new Map(plan.map((p) => [p.name, p]));
  const all = await chrome.alarms.getAll();
  for (const a of all) if (a.name.startsWith(REMINDER_PREFIX) && !wanted.has(a.name)) await chrome.alarms.clear(a.name);
  const have = new Set(all.map((a) => a.name));
  for (const p of plan) if (!have.has(p.name)) await chrome.alarms.create(p.name, { when: p.when });
  return plan.length;
}

function queueReschedule() {
  if (rescheduleTimer) clearTimeout(rescheduleTimer);
  rescheduleTimer = setTimeout(() => void rescheduleReminders().catch(() => undefined), 1500);
}

async function alreadyFired(name: string): Promise<boolean> {
  const area = chrome.storage.session;
  if (!area) return false;
  const key = 'reminders.fired';
  const res = await area.get(key);
  const fired: string[] = Array.isArray(res[key]) ? res[key] : [];
  if (fired.includes(name)) return true;
  await area.set({ [key]: [...fired.slice(-99), name] });
  return false;
}

async function fireReminder(name: string) {
  const info = parseReminderName(name);
  if (!info || (await alreadyFired(name))) return;
  const settings = await get('ts.settings');
  let title: string | undefined;
  if (info.kind === 'event') {
    if (!settings.notifications.events) return;
    title = (await get('ts.events')).find((e) => e.id === info.refId)?.title;
  } else {
    if (!settings.notifications.tasks) return;
    const task = (await get('ts.tasks')).find((t) => t.id === info.refId);
    if (task?.done) return;
    title = task?.title;
  }
  if (!title) return; // deleted since scheduling
  await chrome.notifications.create(`${NOTIF_PREFIX}${info.kind}|${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: title.slice(0, 120),
    message: `${info.kind === 'task' ? 'Task due' : 'Event'} · ${formatWhen(info.at, info.allDay)}`,
    priority: 1,
  });
}

async function openDashboardPage(page: 'calendar' | 'tasks') {
  const base = chrome.runtime.getURL('dashboard.html');
  const url = `${base}#/${page}`;
  const [existing] = await chrome.tabs.query({ url: `${base}*` });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true, url });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
}

export function registerReminders(): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  if (registered) return;
  registered = true;

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith(REMINDER_PREFIX)) {
      void fireReminder(alarm.name)
        .catch(() => undefined)
        .finally(queueReschedule);
    } else if (alarm.name === SYNC_ALARM) {
      // Only feeds with granted host permission / Google with a usable token; others are skipped.
      void syncAllSources({ interactive: false }).catch(() => undefined);
    } else if (alarm.name === BACKUP_ALARM) {
      void maybeDailySnapshot().catch(() => undefined);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((k) => WATCHED.has(k))) queueReschedule();
  });

  chrome.notifications?.onClicked.addListener((id) => {
    if (!id.startsWith(NOTIF_PREFIX)) return;
    const kind = id.slice(NOTIF_PREFIX.length).split('|')[0];
    void openDashboardPage(kind === 'task' ? 'tasks' : 'calendar').catch(() => undefined);
    void chrome.notifications.clear(id);
  });

  // Secret hygiene at every worker start: session storage stays TRUSTED_CONTEXTS (Google access token,
  // Spotify snapshot) and any legacy refresh token leaves chrome.storage.local for the IndexedDB store.
  void restrictSessionStorage().catch(() => undefined);
  void migrateLegacySecrets().catch(() => undefined);
  void ensureAlarm(SYNC_ALARM, 60, 5).catch(() => undefined);
  void ensureAlarm(BACKUP_ALARM, 24 * 60, 10).catch(() => undefined);
  // No start-up snapshot: the daily alarm handles it (Chrome fires a missed alarm on the next start).
  void rescheduleReminders().catch(() => undefined);
}
