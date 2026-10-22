/**
 * "quick-note" keyboard command: open the toolbar popup straight into the
 * Quick Note editor.
 *
 * - `chrome.action.openPopup()` is available to all extensions from Chrome 127
 *   (118–126: policy-installed extensions only). It is called first,
 *   synchronously inside the command event, so nothing delays it.
 * - The popup can't receive a URL hash from openPopup(), so a session flag
 *   (`ts.session.popupMode = 'note'`) tells it which mode to open in; the popup
 *   reads and clears it, and also reacts if the flag is set while it is open.
 * - Fallback (older Chrome, no focused normal window, or openPopup rejects):
 *   open `popup.html#note` in a small popup window.
 */

export const POPUP_MODE_KEY = 'ts.session.popupMode';

export interface QuickNoteDeps {
  openPopup?: (opts: { windowId?: number }) => Promise<void>;
  setSession: (items: Record<string, unknown>) => Promise<void>;
  createWindow: (opts: chrome.windows.CreateData) => Promise<unknown>;
  popupUrl: string;
}

export function chromeQuickNoteDeps(): QuickNoteDeps {
  const action = chrome.action as typeof chrome.action & { openPopup?: (o?: { windowId?: number }) => Promise<void> };
  return {
    openPopup: typeof action?.openPopup === 'function' ? (o) => action.openPopup!(o) : undefined,
    setSession: (items) => (chrome.storage.session ? chrome.storage.session.set(items) : Promise.resolve()),
    createWindow: (o) => chrome.windows.create(o),
    popupUrl: chrome.runtime.getURL('popup.html#note'),
  };
}

/** Returns how the editor was opened (for tests/diagnostics). */
export async function openQuickNote(deps: QuickNoteDeps, windowId?: number): Promise<'popup' | 'window'> {
  const flag = deps.setSession({ [POPUP_MODE_KEY]: 'note' }).catch(() => undefined);
  if (deps.openPopup) {
    try {
      await deps.openPopup(windowId !== undefined ? { windowId } : {});
      await flag;
      return 'popup';
    } catch (e) {
      console.warn('[Tabspace] action.openPopup failed, opening a popup window instead', e);
    }
  }
  await flag;
  // The window opens with #note, so the flag isn't needed; clear it so the next toolbar click opens normally.
  await deps.setSession({ [POPUP_MODE_KEY]: null }).catch(() => undefined);
  await deps.createWindow({ url: deps.popupUrl, type: 'popup', width: 360, height: 460, focused: true });
  return 'window';
}
