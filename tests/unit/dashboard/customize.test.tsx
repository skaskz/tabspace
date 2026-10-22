import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { get } from '@/storage/store';

vi.mock('@/services/sessions', () => ({ openWorkspace: vi.fn(), saveCurrentWindow: vi.fn() }));
vi.mock('@/components/layout/Starfield', () => ({ Starfield: () => null }));

const { NewTab } = await import('@/extension/newtab/NewTab');

describe('New Tab customize mode', () => {
  it('hides, moves, restores and resets widgets, persisting to settings.newTab.layout', async () => {
    render(
      <ToastProvider>
        <ConfirmProvider>
          <NewTab />
        </ConfirmProvider>
      </ToastProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Customize' }));
    expect(screen.getByRole('region', { name: 'Main column' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Side column' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Hide Recent Tabs' }));
    await waitFor(async () => expect((await get('ts.settings')).newTab.layout?.hidden).toContain('recentTabs'));
    const tray = screen.getByRole('region', { name: 'Hidden widgets' });
    expect(within(tray).getByRole('button', { name: 'Show Recent Tabs' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Move Calendar to the main column' }));
    await waitFor(async () => expect((await get('ts.settings')).newTab.layout?.main.at(-1)).toBe('calendar'));
    await userEvent.click(screen.getByRole('button', { name: 'Move Calendar up' }));
    await waitFor(async () => expect((await get('ts.settings')).newTab.layout?.main.at(-2)).toBe('calendar'));

    // Hiding Focus also turns off the legacy showFocus toggle (Settings stays in sync).
    await userEvent.click(screen.getByRole('button', { name: 'Hide Focus Mode' }));
    await waitFor(async () => expect((await get('ts.settings')).newTab.showFocus).toBe(false));

    await userEvent.click(within(tray).getByRole('button', { name: 'Show Recent Tabs' }));
    await waitFor(async () => expect((await get('ts.settings')).newTab.layout?.hidden).not.toContain('recentTabs'));

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('region', { name: 'Main column' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Recent Tabs' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Focus Mode' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Customize' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    await waitFor(async () => {
      const s = await get('ts.settings');
      expect(s.newTab.layout?.hidden).toEqual([]);
      expect(s.newTab.showFocus).toBe(true);
    });
  });

  it('when every widget is hidden, shows a hint with a Customize button', async () => {
    const { set } = await import('@/storage/store');
    const { DEFAULT_SETTINGS } = await import('@/storage/schema');
    const { WIDGET_IDS } = await import('@/extension/newtab/layout');
    await set('ts.settings', { ...DEFAULT_SETTINGS, newTab: { ...DEFAULT_SETTINGS.newTab, layout: { main: [], side: [], hidden: [...WIDGET_IDS] } } });
    render(
      <ToastProvider>
        <ConfirmProvider>
          <NewTab />
        </ConfirmProvider>
      </ToastProvider>,
    );
    expect(await screen.findByText('Your New Tab is empty — Customize to add sections.')).toBeInTheDocument();
    expect(screen.queryByRole('search')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add sections' }));
    expect(screen.getByRole('region', { name: 'Hidden widgets' })).toBeInTheDocument();
  });
});
