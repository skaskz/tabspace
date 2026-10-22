/**
 * chrome.sidePanel helpers shared by the service worker, popup and the
 * Chrome Sidebar settings page. Every call is feature-detected so pages still
 * render in the Vite dev server / tests.
 *
 * Behaviour notes (developer.chrome.com/docs/extensions/reference/api/sidePanel):
 * - `open()` (Chrome 116+) must be called in response to a user gesture, so
 *   callers must invoke `openSidePanel()` synchronously from a click/command
 *   handler — never after an `await`. Keep the windowId pre-fetched.
 * - `close()` exists from Chrome 141. On older versions we fall back to
 *   disabling then re-enabling the global panel, which closes it in every
 *   window (Chrome has no per-window close before 141).
 * - `setOptions({ enabled: false })` hides the panel and removes it from
 *   Chrome's side panel menu; it never touches Tabspace data.
 */

export const SIDE_PANEL_PATH = 'sidepanel.html';

type SidePanelApi = typeof chrome.sidePanel & {
  close?: (options: { windowId?: number; tabId?: number }) => Promise<void>;
};

export function sidePanelApi(): SidePanelApi | null {
  return typeof chrome !== 'undefined' && chrome.sidePanel ? (chrome.sidePanel as SidePanelApi) : null;
}

export function hasSidePanel(): boolean {
  return !!sidePanelApi();
}

/** Enable or disable the global side panel. */
export async function applySidebarEnabled(enabled: boolean): Promise<void> {
  const sp = sidePanelApi();
  if (!sp) return;
  await sp.setOptions(enabled ? { enabled: true, path: SIDE_PANEL_PATH } : { enabled: false });
}

/** The action button opens the popup, not the panel. */
export async function applyPanelBehavior(): Promise<void> {
  const sp = sidePanelApi();
  if (!sp?.setPanelBehavior) return;
  await sp.setPanelBehavior({ openPanelOnActionClick: false });
}

/**
 * Open the panel for a window. MUST be called synchronously inside a user
 * gesture handler; the returned promise may be awaited afterwards.
 */
export function openSidePanel(windowId: number): Promise<void> {
  const sp = sidePanelApi();
  if (!sp) return Promise.reject(new Error('The side panel is only available inside the Chrome extension.'));
  return sp.open({ windowId });
}

export function canCloseNatively(): boolean {
  return typeof sidePanelApi()?.close === 'function';
}

/** Close the panel. Uses `chrome.sidePanel.close` (141+) or the disable→enable fallback. */
export async function closeSidePanel(windowId: number): Promise<'closed' | 'closed-all'> {
  const sp = sidePanelApi();
  if (!sp) throw new Error('The side panel is only available inside the Chrome extension.');
  if (typeof sp.close === 'function') {
    await sp.close({ windowId });
    return 'closed';
  }
  await sp.setOptions({ enabled: false });
  await sp.setOptions({ enabled: true, path: SIDE_PANEL_PATH });
  return 'closed-all';
}

/* ------------------------------------------------------------------ */
/* Which windows show the panel                                        */
/* ------------------------------------------------------------------ */

/**
 * Window IDs with an open panel, kept in chrome.storage.session. Written by the
 * worker (sidePanel.onOpened/onClosed, Chrome 141/142+) and by the panel page
 * itself (on load / pagehide, any version) — needed because some Chromium
 * builds report SIDE_PANEL contexts with windowId -1 in runtime.getContexts.
 */
export const OPEN_PANELS_KEY = 'ts.session.openPanels';

function sessionArea(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.session ? chrome.storage.session : null;
}

export async function readOpenPanels(): Promise<number[]> {
  const area = sessionArea();
  if (!area) return [];
  try {
    const r = await area.get(OPEN_PANELS_KEY);
    const v = r[OPEN_PANELS_KEY];
    return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n >= 0) : [];
  } catch {
    return [];
  }
}

let markQueue: Promise<unknown> = Promise.resolve();
const OPEN_PANELS_LOCK = 'tabspace-open-panels';

/**
 * Record that the panel opened/closed in a window. The read-modify-write is
 * serialised within this context by a promise queue and across extension
 * contexts (worker, panel page) by a Web Lock when available.
 */
export function markPanelOpen(windowId: number, open: boolean): Promise<void> {
  const area = sessionArea();
  if (!area || !Number.isInteger(windowId) || windowId < 0) return Promise.resolve();
  const write = async () => {
    const cur = new Set(await readOpenPanels());
    if (open) cur.add(windowId);
    else cur.delete(windowId);
    await area.set({ [OPEN_PANELS_KEY]: [...cur] });
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const run = markQueue.then(() => (locks?.request ? locks.request(OPEN_PANELS_LOCK, write) : write()));
  markQueue = run.catch(() => undefined);
  return run;
}

/** Subscribe to changes of the stored open-panel set. */
export function onOpenPanelsChanged(cb: () => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => undefined;
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'session' && OPEN_PANELS_KEY in changes) cb();
  };
  const events = chrome.storage.onChanged;
  events.addListener(handler);
  return () => events.removeListener(handler);
}

/**
 * Combine both sources: no SIDE_PANEL context at all => nothing is open (and a
 * stale stored set is ignored); contexts with valid window ids are trusted;
 * otherwise (windowId -1) fall back to the stored set. null = unknown.
 */
export function resolveOpenWindows(contexts: { windowId: number }[] | null, stored: number[]): number[] | null {
  if (contexts) {
    if (contexts.length === 0) return [];
    if (contexts.every((c) => Number.isInteger(c.windowId) && c.windowId >= 0)) return contexts.map((c) => c.windowId);
  }
  return stored.length ? stored : contexts ? null : stored;
}

/** Window IDs that currently show the Tabspace side panel; null when this can't be determined. */
export async function openSidePanelWindows(): Promise<number[] | null> {
  if (typeof chrome === 'undefined') return null;
  let contexts: { windowId: number }[] | null = null;
  if (chrome.runtime?.getContexts) {
    try {
      contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.SIDE_PANEL] });
    } catch {
      contexts = null;
    }
  }
  if (!contexts && !sessionArea()) return null;
  return resolveOpenWindows(contexts, await readOpenPanels());
}

/** The window this extension page lives in (popup/dashboard tab), or null outside Chrome. */
export async function currentWindowId(): Promise<number | null> {
  if (typeof chrome === 'undefined' || !chrome.windows?.getCurrent) return null;
  try {
    const w = await chrome.windows.getCurrent();
    return w.id ?? null;
  } catch {
    return null;
  }
}

/** Configured keyboard shortcut for the toggle-sidebar command ('' when unassigned). */
export async function sidebarShortcut(): Promise<string | null> {
  if (typeof chrome === 'undefined' || !chrome.commands?.getAll) return null;
  try {
    const cmds = await chrome.commands.getAll();
    return cmds.find((c) => c.name === 'toggle-sidebar')?.shortcut ?? '';
  } catch {
    return null;
  }
}
