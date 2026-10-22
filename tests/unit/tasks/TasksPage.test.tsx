import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { get } from '@/storage/store';
import { createTask } from '@/features/tasks/actions';
import TasksPage from '@/pages/tasks/TasksPage';

function renderPage() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <TasksPage />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('TasksPage', () => {
  it('completing a task persists to the store', async () => {
    window.location.hash = '#/tasks';
    await createTask({ title: 'Push Tabspace to GitHub' });
    renderPage();
    const box = await screen.findByRole('checkbox', { name: 'Complete "Push Tabspace to GitHub"' });
    await userEvent.click(box);
    await waitFor(async () => {
      const [t] = await get('ts.tasks');
      expect(t.done).toBe(true);
      expect(t.completedAt).toBeTypeOf('number');
    });
    // It leaves the Inbox once completed.
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Complete "Push Tabspace to GitHub"' })).toBeNull());
  });

  it('quick add parses shortcuts and stores the task', async () => {
    window.location.hash = '#/tasks';
    renderPage();
    await userEvent.type(screen.getByRole('textbox', { name: 'Quick add task' }), 'Go for a run today !high{Enter}');
    await waitFor(async () => {
      const tasks = await get('ts.tasks');
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ title: 'Go for a run', priority: 'high', done: false });
      expect(tasks[0].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    expect(await screen.findByText('Go for a run')).toBeInTheDocument();
  });

  it('opens the details panel from #/tasks?id=', async () => {
    const t = await createTask({ title: 'Review job applications' });
    window.location.hash = `#/tasks?id=${t.id}`;
    renderPage();
    expect(await screen.findByRole('complementary', { name: 'Task details' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue('Review job applications');
    window.location.hash = '#/tasks';
  });
});

describe('TasksPage double actions (BUG-TK1 / BUG-TK2)', () => {
  it('two submits in one tick create exactly one task', async () => {
    window.location.hash = '#/tasks';
    renderPage();
    const input = screen.getByRole('textbox', { name: 'Quick add task' });
    await userEvent.type(input, 'Edit YouTube Short');
    const form = input.closest('form')!;
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await waitFor(async () => expect(await get('ts.tasks')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(await get('ts.tasks')).toHaveLength(1);
    expect(input).toHaveValue('');
  });

  it('double-clicking a checkbox toggles twice (ends not done)', async () => {
    window.location.hash = '#/tasks';
    await createTask({ title: 'Go for a run' });
    renderPage();
    const box = await screen.findByRole('checkbox', { name: 'Complete "Go for a run"' });
    act(() => {
      box.click();
      box.click();
    });
    await new Promise((r) => setTimeout(r, 50));
    await waitFor(async () => expect((await get('ts.tasks'))[0].done).toBe(false));
  });
});
