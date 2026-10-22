/**
 * Service-worker wiring for workspace tab groups (V2.2, Workspaces agent). Listeners are registered
 * synchronously when index.ts calls registerWorkspaceGroups() at top level, so events that wake the worker
 * are delivered. All work is serialised; every handler re-reads state from storage.
 */
import type { Workspace } from '@/types/models';
import { inBootRelinkWindow, markGroupClosed, relinkWorkspaceGroups, rememberGroupColor, syncWorkspaceChanges } from '@/services/workspaceGroups';
import { handleTabActivated, handleTabComplete, handleTabCreated, handleTabGroupChange, handleTabRemoved } from '@/services/workspaceGroupSync';
import { serial } from './state';

export function registerWorkspaceGroups(): void {
  if (typeof chrome === 'undefined' || !chrome.tabGroups) return;
  const queue = serial();
  const run = (job: () => Promise<unknown>) => void queue(job).catch((e) => console.warn('[Tabspace] workspace groups', e));

  // Re-link after a restart. Chrome may restore groups ("Continue where you left off") after onStartup fires,
  // so group creation also triggers a (debounced) re-link.
  let relinkTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRelink = (ms = 800) => {
    clearTimeout(relinkTimer);
    relinkTimer = setTimeout(() => run(async () => relinkWorkspaceGroups({ allowTitleRelink: await inBootRelinkWindow() })), ms);
  };
  chrome.runtime.onStartup.addListener(() => scheduleRelink(300));
  chrome.runtime.onInstalled.addListener(() => scheduleRelink(300));
  scheduleRelink(1500); // worker (re)start

  chrome.tabGroups.onCreated.addListener(() => scheduleRelink());
  chrome.tabGroups.onUpdated.addListener((g) => {
    run(() => rememberGroupColor(g));
    scheduleRelink();
  });
  chrome.tabGroups.onRemoved.addListener((g) => run(() => markGroupClosed(g.id)));

  chrome.tabs.onCreated.addListener((tab) => run(() => handleTabCreated(tab)));
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    // Group membership changes are handled off-queue (they wait briefly before deciding "moved out").
    if ('groupId' in info) void handleTabGroupChange(tab).catch((e) => console.warn('[Tabspace] workspace groups', e));
    else if (info.status === 'complete') run(() => handleTabComplete(tab));
  });
  chrome.tabs.onRemoved.addListener((tabId) => run(() => handleTabRemoved(tabId)));
  chrome.tabs.onActivated.addListener(({ tabId }) => run(() => handleTabActivated(tabId)));

  // Workspace renamed / deleted anywhere → rename / ungroup its live group.
  chrome.storage.onChanged.addListener((changes, area) => {
    const c = area === 'local' ? changes['ts.workspaces'] : undefined;
    if (c) run(() => syncWorkspaceChanges(c.oldValue as Workspace[] | undefined, c.newValue as Workspace[] | undefined));
  });
}
