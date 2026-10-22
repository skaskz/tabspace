import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { get, set, setAdapter } from '@/storage/store';
import { createMemoryAdapter, type StorageAdapter } from '@/storage/adapter';
import { RECOVERY_PREFIX } from '@/features/notes/recovery';
import { Popup } from '@/extension/popup/Popup';
import { PENDING_PREFIX } from '@/extension/popup/quickNote';

let adapter: StorageAdapter;
let session: Record<string, unknown>;
let sessionListeners: ((c: Record<string, chrome.storage.StorageChange>, area: string) => void)[];

beforeEach(() => {
  adapter = createMemoryAdapter();
  setAdapter(adapter);
  session = {};
  sessionListeners = [];
  // Minimal chrome: local storage shares the store's adapter; session storage for the quick-note flag.
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (k: string | string[] | null) => (k === null ? adapter.getAll() : adapter.get(Array.isArray(k) ? k : [k])),
        set: async (o: Record<string, unknown>) => adapter.set(o),
        remove: async (k: string | string[]) => adapter.remove(Array.isArray(k) ? k : [k]),
      },
      session: {
        get: async (k: string) => (k in session ? { [k]: session[k] } : {}),
        set: async (o: Record<string, unknown>) => {
          Object.assign(session, o);
          const changes = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { newValue: v }]));
          sessionListeners.forEach((l) => l(changes, 'session'));
        },
      },
      onChanged: {
        addListener: (l: (typeof sessionListeners)[number]) => sessionListeners.push(l),
        removeListener: (l: (typeof sessionListeners)[number]) => (sessionListeners = sessionListeners.filter((x) => x !== l)),
      },
    },
  });
  location.hash = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('toolbar popup', () => {
  it('shows the focus session, Quick Notes and dashboard actions', async () => {
    render(<Popup />);
    expect(screen.getByRole('heading', { level: 1, name: 'TABSPACE' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('25:00');
    expect(screen.getByRole('button', { name: /Start/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Dashboard' })).toBeInTheDocument();
  });

  it('complete state shows a check + "Session complete" instead of 00:00, with next actions', async () => {
    await set('ts.focus', { status: 'idle', kind: 'focus', durationMs: 25 * 60_000, completed: { kind: 'focus', at: Date.now() - 5000 } });
    render(<Popup />);
    expect(await screen.findByText('Session complete')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByText('00:00')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start short break' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument();
  });

  it('+ New Note opens an autofocused editor that saves into ts.notes (Unfiled)', async () => {
    render(<Popup />);
    fireEvent.click(screen.getByRole('button', { name: 'New Note' }));
    const box = screen.getByRole('textbox', { name: /Quick note/ });
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: 'Research Roblox mechanics' } });
    await vi.waitFor(async () => expect((await get('ts.notes')).map((n) => n.title)).toEqual(['Research Roblox mechanics']));
    expect((await get('ts.notes'))[0].folderId).toBeUndefined();
    await screen.findByText('Saved');
  });

  it('pagehide mid-typing hands unsaved text to storage (recovery record)', async () => {
    render(<Popup />);
    fireEvent.click(screen.getByRole('button', { name: 'New Note' }));
    const box = screen.getByRole('textbox', { name: /Quick note/ });
    fireEvent.change(box, { target: { value: 'Push Tabspace' } });
    await screen.findByText('Saved');
    fireEvent.change(box, { target: { value: 'Push Tabspace\nto GitHub tonight' } });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    const id = (await get('ts.notes'))[0].id;
    await vi.waitFor(async () => {
      const all = await adapter.getAll();
      expect(all[RECOVERY_PREFIX + id] ?? all[PENDING_PREFIX + id]).toMatchObject({ fields: { content: 'to GitHub tonight' } });
    });
  });

  it('opens straight into the editor for #note and for the quick-note session flag', async () => {
    location.hash = '#note';
    const { unmount } = render(<Popup />);
    expect(screen.getByRole('textbox', { name: /Quick note/ })).toBeInTheDocument();
    unmount();
    location.hash = '';
    session['ts.session.popupMode'] = 'note';
    render(<Popup />);
    expect(await screen.findByRole('textbox', { name: /Quick note/ })).toBeInTheDocument();
    await vi.waitFor(() => expect(session['ts.session.popupMode']).toBeNull()); // consumed
  });
});
