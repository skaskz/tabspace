import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { get, insert, set } from '@/storage/store';
import WorkspacesPage from '@/pages/workspaces/WorkspacesPage';
import TabsPage from '@/pages/tabs/TabsPage';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </ToastProvider>,
  );
}

describe('WorkspacesPage', () => {
  it('creates a workspace from a template', async () => {
    window.location.hash = '#/workspaces';
    const user = userEvent.setup();
    renderWithProviders(<WorkspacesPage />);
    await user.click(await screen.findByRole('button', { name: /create your first workspace/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /job search/i }));
    await user.click(within(dialog).getByRole('button', { name: /create workspace/i }));
    await waitFor(async () => expect((await get('ts.workspaces'))[0]).toMatchObject({ name: 'Job Search', icon: 'briefcase' }));
    expect(await screen.findByRole('link', { name: 'Job Search' })).toBeInTheDocument();
  });

  it('shows real counts and deletes with confirmation, keeping tasks unassigned', async () => {
    window.location.hash = '#/workspaces';
    const ws = await insert('ts.workspaces', { name: 'Development', icon: 'code', order: 0 });
    await insert('ts.tasks', { title: 'Push Tabspace to GitHub', done: false, priority: 'none', subtasks: [], order: 0, workspaceId: ws.id });
    await set('ts.sessions', [
      { id: 's', name: 'Dev', workspaceId: ws.id, createdAt: 1, updatedAt: 1, groups: [], tabs: [{ id: 't', url: 'https://github.com', title: 'GitHub', pinned: false }] },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<WorkspacesPage />);
    expect(await screen.findByText(/1 tab · 1 task · 0 notes · 0 bookmarks/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Development' }));
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/1 task, 1 saved session will be kept/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete workspace' }));
    await waitFor(async () => expect(await get('ts.workspaces')).toHaveLength(0));
    expect((await get('ts.tasks'))[0].workspaceId).toBeUndefined();
  });
});

describe('TabsPage outside the extension', () => {
  it('shows an honest message instead of fake tabs', async () => {
    window.location.hash = '#/tabs';
    renderWithProviders(<TabsPage />);
    expect(await screen.findByText('Open Tabspace as a Chrome extension to manage tabs.')).toBeInTheDocument();
  });
});
