import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { get, set } from '@/storage/store';
import { useStore } from '@/hooks/useStore';
import { latestSession } from '@/features/workspaces/model';
import { SavedTabsPanel } from '@/pages/workspaces/SavedTabsPanel';
import type { SavedSession } from '@/types/models';

function Harness() {
  const [sessions] = useStore('ts.sessions');
  return <SavedTabsPanel workspaceId="w1" session={latestSession(sessions, 'w1')} />;
}

const session: SavedSession = {
  id: 's',
  name: 's',
  workspaceId: 'w1',
  createdAt: 1,
  updatedAt: 1,
  groups: [],
  tabs: ['one', 'two', 'three'].map((n) => ({ id: n, url: `https://${n}.example.com/`, title: n, pinned: false })),
};

describe('SavedTabsPanel remove: focus + undo', () => {
  it('moves focus to the next row, offers Undo, and Undo restores the original position', async () => {
    await set('ts.workspaces', [{ id: 'w1', name: 'Dev', icon: 'code', order: 0, createdAt: 0, updatedAt: 0 }]);
    await set('ts.sessions', [session]);
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ConfirmProvider>
          <Harness />
        </ConfirmProvider>
      </ToastProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Remove two from saved tabs' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove three from saved tabs' })).toHaveFocus());
    expect(screen.getByText('Removed “two”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await get('ts.sessions'))[0].tabs.map((t) => t.id)).toEqual(['one', 'two', 'three']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove two from saved tabs' })).toHaveFocus());
  });

  it('focuses the previous row when the last tab is removed, and the URL input when the list empties', async () => {
    await set('ts.workspaces', [{ id: 'w1', name: 'Dev', icon: 'code', order: 0, createdAt: 0, updatedAt: 0 }]);
    await set('ts.sessions', [{ ...session, tabs: session.tabs.slice(0, 2) }]);
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ConfirmProvider>
          <Harness />
        </ConfirmProvider>
      </ToastProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Remove two from saved tabs' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove one from saved tabs' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Remove one from saved tabs' }));
    await waitFor(() => expect(screen.getByLabelText('URL to add')).toHaveFocus());
  });
});
