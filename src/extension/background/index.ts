/**
 * Tabspace MV3 service worker (module). No DOM, no long-lived timers: every
 * job is driven by chrome events + chrome.alarms and reconciles from storage,
 * so suspension/restart at any point is harmless.
 *
 * Responsibilities: migrations on install, side panel state + shortcut, focus
 * timer alarms/badge/notifications, opt-in site blocking, opt-in usage
 * tracking, and the Integrations agent's reminders (registerReminders()).
 */
import type { Settings } from '@/types/models';
import { registerReminders } from './reminders';
import { registerWorkspaceGroups } from './workspaceGroups'; // V2.2 workspace tab groups (Workspaces agent)
import { FOCUS_END_ALARM, FOCUS_NOTIFICATION_PREFIX, FOCUS_TICK_ALARM, syncFocus } from './focus';
import { explainBlockedTab, syncBlocking } from './blocking';
import { USAGE_FLUSH_ALARM, refreshUsage } from './usage';
import { readSettings, serial } from './state';
import { applySmartGroupingToWindow } from '@/services/tabs';
import { RECOVERY_PREFIX, recoverUnsavedNotes } from '@/features/notes/recovery';
import { isSidebarMessage } from '../shared/messages';
import { createPanelToggle } from './panelToggle';
import { chromeQuickNoteDeps, openQuickNote } from './quickNoteCommand';
import { mergePendingQuickNotes } from './quickNotes';
import { PENDING_PREFIX } from '../popup/quickNote';
import { releaseBarGrant, syncBarRegistration } from '../bar/register';
import { websiteBarAllowed } from '../bar/logic';
import { ENGINE_INFO, engineList, releaseSearchTheme, syncSearchRegistration } from '../search/register';
import { applyPanelBehavior, applySidebarEnabled, canCloseNatively, closeSidePanel, markPanelOpen, openSidePanel, readOpenPanels, sidePanelApi } from '../shared/sidePanel';
import { CHECK_EVERY_MIN, checkForUpdates, UPDATE_ALARM } from '@/services/updates';

// Optional contract: src/storage/migrations.ts (Integrations agent). import.meta.glob keeps this a
// *static* import (dynamic import() is not allowed in service workers) and resolves to {} if absent.
const migrationModules = import.meta.glob<{ runMigrations?: () => unknown }>('../../storage/migrations.ts', { eager: true });

const focusQueue = serial();
const usageQueue = serial();

function syncTimerAndBlocking() {
  return focusQueue(async () => {
    await syncFocus();
    await syncBlocking();
  });
}

const syncUsage = () => usageQueue(() => refreshUsage());

async function runMigrations() {
  for (const mod of Object.values(migrationModules)) {
    if (typeof mod.runMigrations === 'function') await mod.runMigrations();
  }
}

async function syncSidebar(settings?: Settings) {
  const s = settings ?? (await readSettings());
  await applySidebarEnabled(s.sidebar.enabled);
}

// Website Tabspace Bar: keep the dynamic content script in line with the setting + optional grants.
// `release` (setting turned off, or found off at startup) gives back exactly what Tabspace obtained (V21-1).
// It is deliberately NOT done on permissions.onAdded: during enabling the grant lands before the setting is saved.
// Serialised, and each run reads the settings when it executes: a stale run (e.g. the startup sync that read
// "off" just before the user enabled the bar) can never unregister the script after a newer run registered it.
const barQueue = serial();
const syncBar = (release = false) =>
  void barQueue(async () => {
    const s = await readSettings();
    await syncBarRegistration(s.tabspaceBar.onWebsites === true);
    if (release && s.tabspaceBar.onWebsites !== true) await releaseBarGrant();
  }).catch((e) => console.warn('[Tabspace] bar registration failed', e));

// Search results look: same pattern (serialised, fresh settings, release only when turned off).
const searchQueue = serial();
const syncSearch = (release = false) =>
  void searchQueue(async () => {
    const s = await readSettings();
    await syncSearchRegistration(s.searchTheme);
    if (release && s.searchTheme.enabled !== true) await releaseSearchTheme();
  }).catch((e) => console.warn('[Tabspace] search theme registration failed', e));

/** Live on/off for already-open result tabs (CSS injected by a registered script can't be removed otherwise). */
async function pushSearchState(theme: Settings['searchTheme']) {
  const engines = engineList(theme.engines);
  const urls = Object.values(ENGINE_INFO).flatMap((e) => e.matches);
  const tabs = await chrome.tabs.query({ url: urls }).catch(() => [] as chrome.tabs.Tab[]);
  for (const t of tabs) {
    if (t.id === undefined || !t.url) continue;
    const host = new URL(t.url).hostname;
    const engine = (Object.keys(ENGINE_INFO) as (keyof typeof ENGINE_INFO)[]).find((e) => new URL(ENGINE_INFO[e].origin.replace('/*', '/')).hostname === host);
    const on = theme.enabled === true && !!engine && engines.includes(engine);
    void chrome.tabs.sendMessage(t.id, { type: 'tssearch:state', on }, { frameId: 0 }).catch(() => undefined);
  }
}

/** Tell every open http(s) tab's bar content script whether to show (it never reads extension storage itself). */
async function pushBarState(bar: Settings['tabspaceBar']) {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => [] as chrome.tabs.Tab[]);
  for (const t of tabs) {
    if (t.id === undefined || !t.url) continue;
    void chrome.tabs.sendMessage(t.id, { type: 'tsbar:state', show: websiteBarAllowed(bar, t.url) }, { frameId: 0 }).catch(() => undefined);
  }
}

async function syncAll() {
  syncBar(true);
  syncSearch(true);
  await Promise.allSettled([syncSidebar(), syncTimerAndBlocking(), syncUsage()]);
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    try {
      await runMigrations();
    } catch (e) {
      console.warn('[Tabspace] migrations failed', e);
    }
    await applyPanelBehavior().catch(() => undefined);
    await syncAll();
  })();
});

chrome.runtime.onStartup.addListener(() => void syncAll());

/* ------------------------------------------------------------------ */
/* Storage → reconcile                                                 */
/* ------------------------------------------------------------------ */

// Notes typed right before a tab closed are parked in per-note recovery records (see features/notes/recovery);
// merge them under the store lock even when no Tabspace page is open any more.
const recoverNotes = () => void recoverUnsavedNotes().catch((e) => console.warn('[Tabspace] note recovery failed', e));
// Quick Notes the popup was still creating when it closed (see popup/quickNote.ts).
const mergeQuickNotes = () => void mergePendingQuickNotes().catch((e) => console.warn('[Tabspace] quick note merge failed', e));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.entries(changes).some(([k, c]) => k.startsWith(RECOVERY_PREFIX) && c.newValue !== undefined)) recoverNotes();
  if (Object.entries(changes).some(([k, c]) => k.startsWith(PENDING_PREFIX) && c.newValue !== undefined)) mergeQuickNotes();
  if ('ts.focus' in changes) void syncTimerAndBlocking();
  const sc = changes['ts.settings'];
  if (sc) {
    const prev = sc.oldValue as Partial<Settings> | undefined;
    const next = sc.newValue as Partial<Settings> | undefined;
    if (prev?.sidebar?.enabled !== next?.sidebar?.enabled) void syncSidebar();
    const pf = prev?.focus;
    const nf = next?.focus;
    if (pf?.showBadge !== nf?.showBadge || pf?.blockSites !== nf?.blockSites || JSON.stringify(pf?.blocklist) !== JSON.stringify(nf?.blocklist)) {
      void syncTimerAndBlocking();
    }
    if (prev?.analytics?.trackWebsites !== next?.analytics?.trackWebsites) void syncUsage();
    if (prev?.tabspaceBar?.onWebsites !== next?.tabspaceBar?.onWebsites) syncBar(next?.tabspaceBar?.onWebsites !== true);
    if (JSON.stringify(prev?.tabspaceBar) !== JSON.stringify(next?.tabspaceBar)) void readSettings().then((s) => pushBarState(s.tabspaceBar));
    if (JSON.stringify(prev?.searchTheme) !== JSON.stringify(next?.searchTheme)) {
      syncSearch(next?.searchTheme?.enabled !== true);
      void readSettings().then((s) => pushSearchState(s.searchTheme));
    }
  }
});

/* ------------------------------------------------------------------ */
/* Alarms                                                              */
/* ------------------------------------------------------------------ */

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) void checkForUpdates();
  if (alarm.name === FOCUS_END_ALARM || alarm.name === FOCUS_TICK_ALARM) void syncTimerAndBlocking();
  else if (alarm.name === USAGE_FLUSH_ALARM) void syncUsage();
  // Other alarm names belong to reminders.ts.
});

chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith(FOCUS_NOTIFICATION_PREFIX)) return;
  void chrome.tabs.create({ url: `${chrome.runtime.getURL('dashboard.html')}#/focus` });
  void chrome.notifications.clear(id);
});

/* ------------------------------------------------------------------ */
/* Tabs (blocking explanation + usage)                                 */
/* ------------------------------------------------------------------ */

// Opt-in automatic smart grouping: only the user's own rules are applied automatically
// (built-in suggestions always require a click in the Tab Manager). Debounced per window.
const groupingTimers = new Map<number, ReturnType<typeof setTimeout>>();
function scheduleSmartGrouping(windowId: number) {
  clearTimeout(groupingTimers.get(windowId));
  groupingTimers.set(
    windowId,
    setTimeout(() => {
      groupingTimers.delete(windowId);
      void readSettings().then((s) => {
        if (s.smartGrouping.enabled && s.smartGrouping.autoApply && s.smartGrouping.rules.length) {
          return applySmartGroupingToWindow(windowId).catch((e) => console.warn('[Tabspace] smart grouping failed', e));
        }
      });
    }, 1500),
  );
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url) void explainBlockedTab(tabId, info.url);
  if (info.url && tab.active) void syncUsage();
  if (info.status === 'complete' && tab.windowId !== undefined && !tab.pinned && (tab.groupId ?? -1) === -1) scheduleSmartGrouping(tab.windowId);
});
chrome.tabs.onActivated.addListener(() => void syncUsage());
chrome.windows.onFocusChanged.addListener(() => void syncUsage());

/* ------------------------------------------------------------------ */
/* Side panel: shortcut + messages                                     */
/* ------------------------------------------------------------------ */

// Chrome 141+/142+ report open/close; used so the shortcut can toggle. On older
// versions the set stays empty and the shortcut simply opens the panel.
const openPanels = new Set<number>();
type PanelEvent = { addListener(cb: (info: { windowId: number }) => void): void };
const sp = sidePanelApi() as (ReturnType<typeof sidePanelApi> & { onOpened?: PanelEvent; onClosed?: PanelEvent }) | null;
sp?.onOpened?.addListener((info) => {
  openPanels.add(info.windowId);
  void markPanelOpen(info.windowId, true);
});
sp?.onClosed?.addListener((info) => {
  openPanels.delete(info.windowId);
  void markPanelOpen(info.windowId, false);
});
// The worker may have been restarted while panels stayed open: restore from session storage.
// createPanelToggle handles a command that arrives before this has loaded (see panelToggle.ts).
const togglePanel = createPanelToggle({
  openPanels,
  hydration: readOpenPanels(),
  open: openSidePanel,
  close: closeSidePanel,
  canClose: canCloseNatively,
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'quick-note') {
    void openQuickNote(chromeQuickNoteDeps(), tab?.windowId);
    return;
  }
  if (command !== 'toggle-sidebar') return;
  const windowId = tab?.windowId;
  if (windowId === undefined) return;
  // open() (when needed) runs synchronously inside the command's user gesture.
  void togglePanel(windowId);
});

// Website bar content script asking whether to show on its page. Decided from the settings and sender.url
// (set by the browser, not by the page), top frame of an http(s) tab only.
chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg !== 'object' || (msg as { type?: unknown }).type !== 'tsbar:query' || Object.keys(msg).length !== 1) return;
  if (!sender.tab || sender.frameId !== 0 || !sender.url || !/^https?:/.test(sender.url)) return;
  const url = sender.url;
  void readSettings().then(
    (s) => sendResponse({ show: websiteBarAllowed(s.tabspaceBar, url) }),
    () => sendResponse({ show: false }),
  );
  return true;
});

// Website bar iframe asking which tab it is in (fallback when tabs.getCurrent() is unavailable in a frame).
chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg !== 'object' || (msg as { type?: unknown }).type !== 'tsbar:whoami') return;
  // (The frame may be loaded through a dynamic web-accessible-resource URL, so compare the path, not the origin.)
  if (!sender.url || !/^chrome-extension:\/\/[^/]+\/bar\.html(?:[?#]|$)/.test(sender.url) || !sender.tab) return;
  sendResponse({ tab: { id: sender.tab.id, url: sender.tab.url, title: sender.tab.title } });
});

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  // Only Tabspace's own pages may drive the side panel (no content scripts / externally_connectable exist).
  if (sender.id !== chrome.runtime.id || !isSidebarMessage(msg)) return;
  const windowId = msg.windowId ?? sender.tab?.windowId;
  if (windowId === undefined) {
    sendResponse({ ok: false, error: 'No window' });
    return;
  }
  // Prefer calling chrome.sidePanel.open() directly in the page's click handler: a user gesture
  // is not guaranteed to survive message passing, so 'sidebar:open' here is best-effort.
  const job = msg.type === 'sidebar:open' ? openSidePanel(windowId) : closeSidePanel(windowId);
  job.then(
    () => sendResponse({ ok: true }),
    (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
  return true;
});

/* ------------------------------------------------------------------ */
/* Permission changes                                                  */
/* ------------------------------------------------------------------ */

// declarativeNetRequest is a REQUIRED manifest permission (Chrome does not allow it to be optional).
// Blocking still re-syncs on permission changes and treats a missing permission as "blocking off",
// so it stays correct if the permission model changes.
chrome.permissions?.onAdded.addListener(() => {
  void syncTimerAndBlocking();
  syncBar();
  syncSearch();
});
chrome.permissions?.onRemoved.addListener(() => {
  void syncTimerAndBlocking();
  syncBar();
  syncSearch();
});

/* ------------------------------------------------------------------ */
/* Every worker start                                                  */
/* ------------------------------------------------------------------ */

// Listeners above are registered synchronously at top level (MV3 requirement).
// reminders.ts is idempotent by contract, and registering on every start keeps its listeners alive.
registerReminders();
registerWorkspaceGroups(); // V2.2 workspace tab groups (Workspaces agent)
void syncAll();
recoverNotes();
mergeQuickNotes();


// V2.3 update checks: a periodic alarm (survives worker suspension) plus one check shortly after start.
void chrome.alarms.get(UPDATE_ALARM).then((a) => {
  if (!a) void chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MIN });
});
