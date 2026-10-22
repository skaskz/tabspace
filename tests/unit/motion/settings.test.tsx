import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { AppearanceSection, FocusSection, LayoutSection } from '@/pages/settings/PreferenceSections';
import { PageHero } from '@/components/layout/PageHero';
import { DEFAULT_SETTINGS } from '@/storage/schema';
import { get } from '@/storage/store';
import type { Settings } from '@/types/models';

const withSettings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

describe('Settings: motion & V2 toggles', () => {
  it('Appearance has a parallax toggle bound to settings.parallax and no chrome-figure toggle', async () => {
    render(
      <ToastProvider>
        <AppearanceSection settings={withSettings({ parallax: true })} />
      </ToastProvider>,
    );
    expect(screen.queryByRole('switch', { name: /chrome figure/i })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Starfield background' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Animations' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Reduced motion' })).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Background movement (parallax)' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    await waitFor(async () => expect((await get('ts.settings')).parallax).toBe(false));
  });

  it('parallax toggle is disabled without the starfield and explains why', () => {
    render(
      <ToastProvider>
        <AppearanceSection settings={withSettings({ starfield: false })} />
      </ToastProvider>,
    );
    expect(screen.getByRole('switch', { name: 'Background movement (parallax)' })).toBeDisabled();
    expect(screen.getByText('Needs the starfield background.')).toBeInTheDocument();
  });

  it('Focus has a Completion sound toggle bound to settings.focus.sound', async () => {
    render(<FocusSection settings={withSettings({ focus: { ...DEFAULT_SETTINGS.focus, sound: true } })} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Completion sound' }));
    await waitFor(async () => expect((await get('ts.settings')).focus.sound).toBe(false));
    // Other focus fields are preserved.
    expect((await get('ts.settings')).focus.focusMin).toBe(DEFAULT_SETTINGS.focus.focusMin);
  });

  it('Quick Note "attach current page link" toggle is bound to settings.quickNote.attachUrl', async () => {
    render(<LayoutSection settings={withSettings()} />);
    const toggle = screen.getByRole('switch', { name: 'Quick Note: attach current page link by default' });
    expect(toggle).toHaveAttribute('aria-checked', String(DEFAULT_SETTINGS.quickNote.attachUrl));
    fireEvent.click(toggle);
    await waitFor(async () => expect((await get('ts.settings')).quickNote.attachUrl).toBe(!DEFAULT_SETTINGS.quickNote.attachUrl));
  });
});

describe('PageHero', () => {
  it('renders title, subtitle and actions with no decorative figure', () => {
    const { container } = render(<PageHero eyebrow="Tuesday" title="Tasks" subtitle="3 due today" actions={<button type="button">New task</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByText('3 due today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.ts-rider')).toBeNull();
  });
});
