import { describe, expect, it, vi } from 'vitest';
import { POPUP_MODE_KEY, openQuickNote, type QuickNoteDeps } from '@/extension/background/quickNoteCommand';

function deps(over: Partial<QuickNoteDeps> = {}) {
  const session: Record<string, unknown> = {};
  const d: QuickNoteDeps & { session: Record<string, unknown> } = {
    session,
    openPopup: vi.fn(async () => undefined),
    setSession: vi.fn(async (o: Record<string, unknown>) => void Object.assign(session, o)),
    createWindow: vi.fn(async () => ({})),
    popupUrl: 'chrome-extension://id/popup.html#note',
    ...over,
  };
  return d;
}

describe('quick-note command', () => {
  it('sets the popup mode flag and opens the toolbar popup in the command window', async () => {
    const d = deps();
    expect(await openQuickNote(d, 7)).toBe('popup');
    expect(d.openPopup).toHaveBeenCalledWith({ windowId: 7 });
    expect(d.session[POPUP_MODE_KEY]).toBe('note');
    expect(d.createWindow).not.toHaveBeenCalled();
  });

  it('calls openPopup synchronously (before awaiting the flag write)', () => {
    let resolveFlag!: () => void;
    const d = deps({ setSession: vi.fn(() => new Promise<void>((r) => (resolveFlag = r))) });
    void openQuickNote(d, 1);
    expect(d.openPopup).toHaveBeenCalledTimes(1);
    resolveFlag();
  });

  it('falls back to a small popup window when openPopup rejects (e.g. no focused window)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const d = deps({ openPopup: vi.fn(async () => Promise.reject(new Error('no active window'))) });
    expect(await openQuickNote(d)).toBe('window');
    expect(d.createWindow).toHaveBeenCalledWith({ url: 'chrome-extension://id/popup.html#note', type: 'popup', width: 360, height: 460, focused: true });
    expect(d.session[POPUP_MODE_KEY]).toBeNull(); // next toolbar click opens normally
    warn.mockRestore();
  });

  it('falls back when action.openPopup does not exist (Chrome < 127)', async () => {
    const d = deps({ openPopup: undefined });
    expect(await openQuickNote(d)).toBe('window');
  });
});
