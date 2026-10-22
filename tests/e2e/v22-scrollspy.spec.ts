import { expect, realErrors, shot, test } from './helpers';

test.describe('V2.2 · Settings section scroll-spy', () => {
  test('scrolling highlights the current section; clicking scrolls, highlights and focuses', async ({ dash, errors }) => {
    const page = await dash('settings');
    await page.setViewportSize({ width: 1440, height: 900 });
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    const link = (name: string) => nav.getByRole('link', { name, exact: true });
    await expect(page.locator('#settings-account')).toBeAttached();
    await expect(link('Appearance')).toHaveAttribute('aria-current', 'true');

    // Scroll so Integrations sits at the reading line.
    await page.evaluate(() => {
      const el = document.getElementById('settings-integrations')!;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120, behavior: 'instant' as ScrollBehavior });
    });
    await expect(link('Integrations')).toHaveAttribute('aria-current', 'true');
    await expect(link('Appearance')).not.toHaveAttribute('aria-current', 'true');
    await expect(nav.locator('[aria-current="true"]')).toHaveCount(1);

    // Bottom of the page: the last section wins even if it never reaches the reading line.
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' as ScrollBehavior }));
    await expect(link('Account & About')).toHaveAttribute('aria-current', 'true');
    await shot(page, 'v22-settings-scrollspy-bottom', false);

    // Click a nav item: highlights immediately, scrolls there, focuses the heading, updates ?section= without history spam.
    const historyBefore = await page.evaluate(() => history.length);
    await link('Privacy').click();
    await expect(link('Privacy')).toHaveAttribute('aria-current', 'true');
    await expect.poll(async () => Math.abs(((await page.locator('#settings-privacy').boundingBox())?.y ?? 9999) - 24), { timeout: 4000 }).toBeLessThan(12); // scroll-mt-6
    await expect(page.locator('#settings-privacy-title')).toBeFocused();
    expect(page.url()).toContain('#/settings?section=privacy');
    expect(await page.evaluate(() => history.length)).toBe(historyBefore);
    // The sliding pill sits on the active item.
    await expect
      .poll(async () => {
        const pill = await nav.getByTestId('section-nav-pill').boundingBox();
        const item = await link('Privacy').boundingBox();
        return Math.abs((pill?.y ?? 0) - (item?.y ?? 100));
      })
      .toBeLessThan(3);
    await shot(page, 'v22-settings-scrollspy-click', false);
    expect(realErrors(errors)).toEqual([]);
  });

  test('deep link #/settings?section=data scrolls to and highlights Data & Backup', async ({ dash }) => {
    const page = await dash('settings?section=data');
    await page.setViewportSize({ width: 1440, height: 900 });
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav.getByRole('link', { name: 'Data & Backup', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect.poll(async () => Math.abs(((await page.locator('#settings-data').boundingBox())?.y ?? 9999) - 24), { timeout: 4000 }).toBeLessThan(12);
  });
});
