import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { get } from '@/storage/store';
import { toDateKey } from '@/utils/date';
import { createTask } from '@/features/tasks/actions';
import DashboardPage from '@/pages/dashboard/DashboardPage';

function renderPage() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <DashboardPage />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

const todayCard = () => screen.getByRole('heading', { name: 'Today’s Tasks' }).closest('section')!;

describe('DashboardPage', () => {
  it('Today’s Tasks reflects a task added via the store', async () => {
    renderPage();
    expect(await screen.findByText('Nothing due today. Add something below.')).toBeInTheDocument();
    await act(async () => {
      await createTask({ title: 'Edit YouTube Short', dueDate: toDateKey() });
      await createTask({ title: 'Someday thing', someday: true });
    });
    expect(await within(todayCard()).findByText('Edit YouTube Short')).toBeInTheDocument();
    expect(within(todayCard()).queryByText('Someday thing')).toBeNull();
    expect(within(todayCard()).getByText('1 left')).toBeInTheDocument();
  });

  it('inline add creates a task due today, and completing it updates storage', async () => {
    renderPage();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Add a new task for today' }), 'Go for a run{Enter}');
    const box = await within(todayCard()).findByRole('checkbox', { name: 'Complete "Go for a run"' });
    expect((await get('ts.tasks'))[0].dueDate).toBe(toDateKey());
    await userEvent.click(box);
    await waitFor(async () => expect((await get('ts.tasks'))[0].done).toBe(true));
    expect(within(todayCard()).getByText('0 left')).toBeInTheDocument();
  });

  it('shows the welcome card for an empty account and an honest Recent Tabs state outside Chrome', async () => {
    renderPage();
    expect(await screen.findByRole('region', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getByText('Tabs aren’t available here')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    await waitFor(async () => expect((await get('ts.settings')).welcomeDismissed).toBe(true));
    expect(screen.queryByRole('region', { name: 'Welcome' })).toBeNull();
  });
});
