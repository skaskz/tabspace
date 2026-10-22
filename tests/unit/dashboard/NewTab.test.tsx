import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { get, set } from '@/storage/store';
import { DEFAULT_SETTINGS } from '@/storage/schema';
import type { Bookmark, QuickLink, SavedSession, Workspace } from '@/types/models';
import { toDateKey } from '@/utils/date';
import { createTask } from '@/features/tasks/actions';
import { buildLinkTiles } from '@/pages/dashboard/FavoriteLinks';

const openWorkspace = vi.fn(async (_id: string) => ({ opened: 2, skipped: 0 }));
vi.mock('@/services/sessions', () => ({
  openWorkspace: (id: string) => openWorkspace(id),
  saveCurrentWindow: vi.fn(),
}));

// jsdom has no canvas; the starfield is decorative.
vi.mock('@/components/layout/Starfield', () => ({ Starfield: () => null }));

const { NewTab, SearchBox } = await import('@/extension/newtab/NewTab');

const base = { createdAt: 1, updatedAt: 1 };
const bm = (p: Partial<Bookmark> & { id: string; url: string }): Bookmark => ({ ...base, title: p.id, tags: [], favorite: false, ...p });

function renderNewTab() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <NewTab />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => openWorkspace.mockClear());

describe('New Tab hub', () => {
  it('renders the main sections from real data (no demo content)', async () => {
    renderNewTab();
    expect(await screen.findByRole('search')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByText('No workspaces yet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Today’s Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent Tabs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Upcoming Events' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Focus Mode' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Quick links' })).toBeInTheDocument();
  });

  it('hides the focus widget when settings.newTab.showFocus is off', async () => {
    await set('ts.settings', { ...DEFAULT_SETTINGS, newTab: { ...DEFAULT_SETTINGS.newTab, showFocus: false } });
    renderNewTab();
    expect(await screen.findByRole('search')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Focus Mode' })).toBeNull();
  });

  it('renders nothing of the hub when the New Tab is disabled', async () => {
    await set('ts.settings', { ...DEFAULT_SETTINGS, newTab: { ...DEFAULT_SETTINGS.newTab, enabled: false } });
    renderNewTab();
    // Outside Chrome the redirect can't happen, so the honest fallback is shown.
    expect(await screen.findByText(/New Tab is turned off/)).toBeInTheDocument();
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('workspace "Open" restores it via openWorkspace', async () => {
    const ws: Workspace = { ...base, id: 'w1', name: 'Tabspace launch', icon: 'rocket', order: 1 };
    const session: SavedSession = { ...base, id: 's1', name: 's', workspaceId: 'w1', groups: [], tabs: [{ id: 't1', url: 'https://github.com/', title: 'GitHub', pinned: false }] };
    await set('ts.workspaces', [ws]);
    await set('ts.sessions', [session]);
    renderNewTab();
    expect(await screen.findByText('1 saved tab')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Tabspace launch' }));
    expect(openWorkspace).toHaveBeenCalledWith('w1');
    expect(await screen.findByText('Opened 2 tabs.')).toBeInTheDocument();
  });

  it('shows an error toast when opening fails', async () => {
    openWorkspace.mockRejectedValueOnce(new Error('“Tabspace launch” has no saved tabs yet.'));
    await set('ts.workspaces', [{ ...base, id: 'w1', name: 'Tabspace launch', icon: 'rocket', order: 1 }]);
    await set('ts.sessions', [{ ...base, id: 's1', name: 's', workspaceId: 'w1', groups: [], tabs: [{ id: 't1', url: 'https://a.com/', title: 'A', pinned: false }] }]);
    renderNewTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Open Tabspace launch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('has no saved tabs yet');
  });

  it('completing a task in Today’s Tasks persists to the shared store', async () => {
    await createTask({ title: 'Go for a run', dueDate: toDateKey() });
    renderNewTab();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Complete "Go for a run"' }));
    await waitFor(async () => expect((await get('ts.tasks'))[0].done).toBe(true));
  });

  it('quick add from the New Tab creates a task due today', async () => {
    renderNewTab();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Add a new task for today' }), 'Edit YouTube Short{Enter}');
    await waitFor(async () => expect((await get('ts.tasks'))[0]).toMatchObject({ title: 'Edit YouTube Short', dueDate: toDateKey() }));
  });

  it('quick links come from favorite bookmarks; adding a link stores a favorite bookmark', async () => {
    await set('ts.bookmarks', [bm({ id: 'GitHub', url: 'https://github.com/', favorite: true }), bm({ id: 'Not starred', url: 'https://example.com/' })]);
    renderNewTab();
    const list = await screen.findByRole('list', { name: 'Quick links' });
    expect(within(list).getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/');
    expect(within(list).queryByRole('link', { name: 'Not starred' })).toBeNull();

    await userEvent.click(within(list).getByRole('button', { name: 'Add link' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add quick link' });
    await userEvent.type(within(dlg).getByLabelText('URL'), 'javascript:alert(1)');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add' }));
    expect(within(dlg).getByRole('alert')).toBeInTheDocument();
    await userEvent.clear(within(dlg).getByLabelText('URL'));
    await userEvent.type(within(dlg).getByLabelText('URL'), 'vite.dev');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect((await get('ts.bookmarks')).find((b) => b.url === 'https://vite.dev/')).toMatchObject({ favorite: true }));
    // Adding an existing bookmark's URL just stars it.
    await userEvent.click(within(list).getByRole('button', { name: 'Add link' }));
    const dlg2 = await screen.findByRole('dialog', { name: 'Add quick link' });
    await userEvent.type(within(dlg2).getByLabelText('URL'), 'https://example.com');
    await userEvent.click(within(dlg2).getByRole('button', { name: 'Add' }));
    await waitFor(async () => {
      const all = await get('ts.bookmarks');
      expect(all.filter((b) => b.url.startsWith('https://example.com'))).toHaveLength(1);
      expect(all.find((b) => b.id === 'Not starred')!.favorite).toBe(true);
    });
  });
});

describe('buildLinkTiles', () => {
  it('lists favorites first, then legacy quick links, deduped by URL, http(s) only', () => {
    const favs = [bm({ id: 'GH', url: 'https://github.com/', favorite: true, updatedAt: 5 }), bm({ id: 'Bad', url: 'javascript:alert(1)', favorite: true })];
    const legacy: QuickLink[] = [
      { id: 'q1', title: 'GitHub dup', url: 'https://www.github.com', order: 0 },
      { id: 'q2', title: 'YouTube', url: 'https://youtube.com/', order: 1 },
      { id: 'q3', title: 'Evil', url: 'javascript:alert(2)', order: 2 },
    ];
    expect(buildLinkTiles(favs, legacy).map((t) => [t.title, t.source])).toEqual([
      ['GH', 'favorite'],
      ['YouTube', 'quicklink'],
    ]);
  });
});

describe('New Tab search box', () => {
  const submit = (q: string, engine: 'google' | 'duckduckgo' | 'bing' = 'google') => {
    const onNavigate = vi.fn();
    const { unmount } = render(<SearchBox engine={engine} onNavigate={onNavigate} />);
    const box = screen.getByRole('textbox', { name: /or type a URL/ });
    fireEvent.change(box, { target: { value: q } });
    act(() => {
      box.closest('form')!.requestSubmit();
    });
    unmount();
    return onNavigate;
  };
  it('navigates to http(s) addresses directly', () => {
    expect(submit('github.com')).toHaveBeenCalledWith('https://github.com/');
  });
  it('searches dangerous schemes instead of opening them', () => {
    for (const q of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///C:/x', 'chrome://settings']) {
      const nav = submit(q);
      expect(nav).toHaveBeenCalledTimes(1);
      expect(nav.mock.calls[0][0]).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);
    }
  });
  it('uses the selected engine and ignores empty input', () => {
    expect(submit('roblox mechanics', 'duckduckgo')).toHaveBeenCalledWith('https://duckduckgo.com/?q=roblox%20mechanics');
    expect(submit('   ')).not.toHaveBeenCalled();
  });
});
