import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { get, set } from '@/storage/store';
import { FocusCard } from '@/pages/dashboard/SidebarWidgets';
import { hubLimits } from '@/pages/dashboard/LazySpotify';

const renderCard = () =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <FocusCard />
      </ConfirmProvider>
    </ToastProvider>,
  );

describe('FocusCard completion state', () => {
  it('shows "Session complete" with Start break / Start again for a minute after a focus session', async () => {
    await set('ts.focus', { status: 'idle', kind: 'focus', durationMs: 25 * 60_000, completed: { kind: 'focus', at: Date.now() - 5_000 } });
    renderCard();
    expect(await screen.findByRole('status')).toHaveTextContent('Session complete');
    expect(screen.getByRole('timer')).toHaveTextContent('00:00');
    expect(screen.getByRole('button', { name: 'Start short break' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start focus session' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Start short break' }));
    await waitFor(async () => expect(await get('ts.focus')).toMatchObject({ status: 'running', kind: 'short' }));
  });

  it('"Start again" repeats the finished kind; breaks show "Break complete"', async () => {
    await set('ts.focus', { status: 'idle', kind: 'short', durationMs: 5 * 60_000, completed: { kind: 'short', at: Date.now() } });
    renderCard();
    expect(await screen.findByRole('status')).toHaveTextContent('Break complete');
    await userEvent.click(screen.getByRole('button', { name: 'Start again' }));
    await waitFor(async () => expect(await get('ts.focus')).toMatchObject({ status: 'running', kind: 'short' }));
  });

  it('an old completion (over a minute) shows the normal idle card', async () => {
    await set('ts.focus', { status: 'idle', kind: 'focus', durationMs: 25 * 60_000, completed: { kind: 'focus', at: Date.now() - 120_000 } });
    renderCard();
    expect(await screen.findByRole('button', { name: 'Start focus session' })).toBeInTheDocument();
    expect(screen.queryByText('Session complete')).toBeNull();
  });
});

describe('hubLimits', () => {
  it('shrinks list lengths on short windows and grows them on tall ones', () => {
    expect(hubLimits(1080)).toEqual({ workspaces: 6, tasks: 7, recentTabs: 6, upcoming: 5, quickLinks: 8 });
    expect(hubLimits(900).upcoming).toBe(4);
    expect(hubLimits(768)).toEqual({ workspaces: 4, tasks: 4, recentTabs: 4, upcoming: 3, quickLinks: 5 });
    expect(hubLimits(650).workspaces).toBe(2);
  });
});
