import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import TabsPage from '@/pages/tabs/TabsPage';
import { createFakeChrome } from '../sessions/fakeChrome';

afterEach(() => vi.unstubAllGlobals());

describe('TabsPage selection bar', () => {
  it('shows bulk actions only while tabs are selected', async () => {
    const fake = createFakeChrome({
      windowId: 1,
      groups: [{ id: 7, title: 'Development', color: 'blue', collapsed: false }],
      tabs: [
        { url: 'https://github.com/me/tabspace', title: 'Push Tabspace to GitHub', pinned: false, groupId: 7 },
        { url: 'https://www.linkedin.com/jobs/', title: 'Review job applications', pinned: false, groupId: -1 },
      ],
    });
    vi.stubGlobal('chrome', fake.chrome);
    window.location.hash = '#/tabs';
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ConfirmProvider>
          <TabsPage />
        </ConfirmProvider>
      </ToastProvider>,
    );
    await screen.findByText('Push Tabspace to GitHub');
    expect(screen.queryByRole('toolbar', { name: 'Actions for selected tabs' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Select Review job applications' }));
    const bar = screen.getByRole('toolbar', { name: 'Actions for selected tabs' });
    expect(within(bar).getByText(/^1 selected/)).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /save 1 selected/i })).toBeEnabled();
    expect(within(bar).getByRole('button', { name: /group/i })).toBeEnabled();
    await user.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('toolbar', { name: 'Actions for selected tabs' })).toBeNull();
  });

  it('select-all never includes the Tabspace tab itself (BUG-TB1)', async () => {
    const fake = createFakeChrome({
      windowId: 1,
      tabs: [
        { url: 'https://github.com/', title: 'GitHub', pinned: false, groupId: -1 },
        { url: 'chrome-extension://abc/dashboard.html#/tabs', title: 'Tabs · Tabspace', pinned: false, groupId: -1 },
        { url: 'https://x.com/', title: 'X', pinned: false, groupId: -1 },
      ],
    });
    const [gh, own, x] = fake.tabs.map((t) => t.id);
    fake.chrome.tabs.getCurrent.mockResolvedValue({ id: own, windowId: 1 } as never);
    vi.stubGlobal('chrome', fake.chrome);
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ConfirmProvider>
          <TabsPage />
        </ConfirmProvider>
      </ToastProvider>,
    );
    await screen.findByText('This tab');
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible tabs' }));
    expect(screen.getByRole('checkbox', { name: /^Select Tabs · Tabspace/ })).toHaveAttribute('aria-checked', 'false');
    const bar = screen.getByRole('toolbar', { name: 'Actions for selected tabs' });
    expect(within(bar).getByText(/^2 selected/)).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Close' }));
    await user.click(await screen.findByRole('button', { name: 'Close 2 tabs' }));
    expect(fake.chrome.tabs.remove).toHaveBeenCalledWith([gh, x]);
  });
});
