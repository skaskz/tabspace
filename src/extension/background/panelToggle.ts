/**
 * toggle-sidebar command logic.
 *
 * `chrome.sidePanel.open()` must be called synchronously inside the command's
 * user gesture, but after the worker wakes from idle the in-memory set of open
 * panels is empty until it has been rehydrated from chrome.storage.session.
 * So: if the set is already hydrated, decide immediately. If not, open
 * synchronously (keeps the gesture), then — once the stored set has loaded —
 * close again if that window was already open *before* the command (needs
 * `sidePanel.close`, Chrome 141+). The stored snapshot is used for that check,
 * not the live set, because our own open() may already have added the window.
 */
export interface PanelToggleDeps {
  openPanels: Set<number>;
  /** Resolves with the window ids stored before this worker instance started. */
  hydration: Promise<number[]>;
  open: (windowId: number) => Promise<void>;
  close: (windowId: number) => Promise<unknown>;
  canClose: () => boolean;
}

export function createPanelToggle(deps: PanelToggleDeps) {
  let hydrated = false;
  const ready = deps.hydration.then(
    (ids) => {
      ids.forEach((id) => deps.openPanels.add(id));
      hydrated = true;
      return ids;
    },
    () => {
      hydrated = true;
      return [] as number[];
    },
  );

  /** Returns a promise for tests; the command listener ignores it. */
  return function toggle(windowId: number): Promise<void> {
    if (hydrated) {
      if (deps.openPanels.has(windowId) && deps.canClose()) return deps.close(windowId).then(() => undefined, () => undefined);
      return deps.open(windowId).catch((e) => console.warn('[Tabspace] side panel open failed', e));
    }
    // Not hydrated yet: open synchronously inside the gesture, then reconcile.
    const opening = deps.open(windowId).catch((e) => console.warn('[Tabspace] side panel open failed', e));
    return ready.then(async (storedBefore) => {
      await opening;
      if (storedBefore.includes(windowId) && deps.canClose()) await deps.close(windowId).catch(() => undefined);
    });
  };
}
