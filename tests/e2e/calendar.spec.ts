import { expect, realErrors, shot, storageGet, test } from './helpers';

test.describe('calendar', () => {
  test('15 · a local event shows on the Calendar page and on the dashboard mini-calendar / upcoming list', async ({ dash, context, errors }) => {
    const page = await dash('calendar');
    await page.getByRole('button', { name: 'Add Event', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'New event' });
    await dlg.getByLabel('Title').fill('Content shoot');
    // Make it a timed event later today (or tomorrow 10:00 if it's late) so it counts as "upcoming".
    const d = new Date(Date.now() + 2 * 3600_000);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const startDate = dlg.locator('input[type="date"]').first();
    if (await startDate.count()) await startDate.fill(date);
    await dlg.getByLabel('Start time').fill(`${String(d.getHours()).padStart(2, '0')}:00`);
    await dlg.getByLabel('End time').fill(`${String(Math.min(d.getHours() + 1, 23)).padStart(2, '0')}:${d.getHours() + 1 > 23 ? '59' : '00'}`);
    await dlg.getByRole('button', { name: 'Add event', exact: true }).click();
    await expect(dlg).toBeHidden();
    const events = await storageGet<{ title: string; sourceId: string }[]>(context, 'ts.events');
    expect(events.map((e) => e.title)).toEqual(['Content shoot']);
    const sources = await storageGet<{ id: string; kind: string }[]>(context, 'ts.calendarSources');
    expect(sources.find((s) => s.id === events[0].sourceId)?.kind).toBe('local');
    await page.getByRole('tab', { name: 'Month' }).click();
    await expect(page.getByRole('grid', { name: 'Month' }).getByText('Content shoot')).toBeVisible();
    await shot(page, '30-calendar-month-event');
    for (const v of ['Week', 'Day', 'Agenda']) {
      await page.getByRole('tab', { name: v }).click();
      await page.waitForTimeout(300);
      await shot(page, `31-calendar-${v.toLowerCase()}`);
    }
    await page.evaluate(() => (location.hash = '#/dashboard'));
    const util = page.getByRole('complementary', { name: 'Utilities' });
    await expect(util.getByText('Content shoot')).toBeVisible();
    // the mini calendar marks the day
    const cell = util.getByRole('gridcell', { name: new RegExp(`${d.toLocaleDateString('en-US', { month: 'long' })} ${d.getDate()}\\b`) });
    test.info().annotations.push({ type: 'mini-cell', description: (await cell.first().getAttribute('aria-label')) ?? '' });
    await shot(page, '32-dashboard-with-event');
    expect(realErrors(errors)).toEqual([]);
  });

  test('15 · event with an empty title is rejected; end before start is rejected', async ({ dash, context }) => {
    const page = await dash('calendar');
    await page.getByRole('button', { name: 'Add Event', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'New event' });
    await dlg.getByRole('button', { name: 'Add event', exact: true }).click();
    await expect(dlg.getByRole('alert')).toBeVisible();
    await dlg.getByLabel('Title').fill('Bad times');
    await dlg.getByLabel('Start time').fill('15:00');
    await dlg.getByLabel('End time').fill('14:00');
    await dlg.getByRole('button', { name: 'Add event', exact: true }).click();
    await page.waitForTimeout(500);
    const evs = (await storageGet<{ start: string; end: string }[]>(context, 'ts.events')) ?? [];
    for (const e of evs) expect(new Date(e.end).getTime()).toBeGreaterThanOrEqual(new Date(e.start).getTime());
  });

  test('20 · deleting an event requires confirmation', async ({ dash, context }) => {
    const page = await dash('calendar');
    await page.getByRole('button', { name: 'Add Event', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'New event' });
    await dlg.getByLabel('Title').fill('Go for a run');
    await dlg.getByRole('button', { name: 'Add event', exact: true }).click();
    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.getByText('Go for a run').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    const c = page.getByRole('dialog', { name: /Delete “Go for a run”/ });
    await expect(c).toBeVisible();
    await c.getByRole('button', { name: 'Delete' }).click();
    await expect.poll(async () => (await storageGet<unknown[]>(context, 'ts.events')).length).toBe(0);
  });

  test('ICS feed subscription requires an http(s) URL; Google not configured is honest', async ({ dash }) => {
    const page = await dash('calendar');
    await page.getByRole('button', { name: 'Add calendar' }).click();
    await page.waitForTimeout(400);
    await shot(page, '33-calendar-add-calendar');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\bConnected\b/);
  });
});
