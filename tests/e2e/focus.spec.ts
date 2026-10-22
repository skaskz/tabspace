import type { BrowserContext, Page } from '@playwright/test';
import { expect, realErrors, shot, storageGet, storageSet, sw, test } from './helpers';

type Focus = { status: string; kind: string; durationMs: number; endAt?: number; remainingMs?: number; startedAt?: number };

const secs = (clock: string) => {
  const [m, s] = clock.trim().split(':').map(Number);
  return m * 60 + s;
};

async function timerSeconds(page: Page): Promise<number> {
  const label = await page.getByRole('timer', { name: /^\d\d:\d\d remaining$/ }).first().getAttribute('aria-label');
  return secs(label!.replace(' remaining', ''));
}

async function badge(context: BrowserContext) {
  const w = await sw(context);
  return w.evaluate(() => chrome.action.getBadgeText({}));
}

test.describe('focus timer', () => {
  test('16 · start on Focus page; remaining time consistent on dashboard, side panel, popup, new tab; badge', async ({ dash, open, context, errors }) => {
    const page = await dash('focus');
    await page.getByRole('button', { name: 'Start Focus session' }).click();
    await expect(page.getByRole('button', { name: 'Pause session' })).toBeVisible();
    const f = await storageGet<Focus>(context, 'ts.focus');
    expect(f.status).toBe('running');
    expect(f.endAt! - f.startedAt!).toBe(25 * 60_000);
    await page.waitForTimeout(2100);
    const focusSecs = await timerSeconds(page);
    expect(focusSecs).toBeLessThanOrEqual(25 * 60 - 2);
    await shot(page, '20-focus-running');

    // Navigate to other pages inside the dashboard and come back
    await page.evaluate(() => (location.hash = '#/tasks'));
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
    await page.evaluate(() => (location.hash = '#/dashboard'));
    const dashSecs = await timerSeconds(page);

    const side = await open('sidepanel.html');
    await side.getByRole('tab', { name: 'Focus' }).click();
    const sideSecs = await timerSeconds(side);
    const popup = await open('popup.html');
    const popupSecs = await timerSeconds(popup);
    const expected = Math.ceil((f.endAt! - Date.now()) / 1000);
    for (const [name, v] of [['dashboard', dashSecs], ['side', sideSecs], ['popup', popupSecs]] as const) {
      expect(Math.abs(v - expected), `${name}=${v} expected≈${expected}`).toBeLessThanOrEqual(3);
    }
    // New Tab focus widget
    const nt = await open('newtab.html');
    await expect(nt.getByRole('button', { name: 'Pause focus session' })).toBeVisible();
    await expect(nt.getByRole('timer')).toHaveText(/\d\d:\d\d/);
    // Badge
    await expect.poll(() => badge(context)).toMatch(/^2[45]m$/);
    const w = await sw(context);
    const alarms = await w.evaluate(async () => (await chrome.alarms.getAll()).map((a) => a.name));
    expect(alarms).toEqual(expect.arrayContaining(['ts-focus-end', 'ts-focus-tick']));
    expect(realErrors(errors)).toEqual([]);
  });

  test('16 · pause / resume / stop from the side panel; all surfaces and badge follow', async ({ dash, open, context }) => {
    const page = await dash('focus');
    await page.getByRole('button', { name: 'Start Focus session' }).click();
    const side = await open('sidepanel.html');
    await side.getByRole('button', { name: 'Pause session' }).click();
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status).toBe('paused');
    await expect.poll(() => badge(context)).toBe('❚❚');
    const paused = await timerSeconds(side);
    await side.waitForTimeout(2200);
    expect(await timerSeconds(side)).toBe(paused);
    await page.bringToFront();
    await expect(page.getByRole('button', { name: 'Resume session' })).toBeVisible();
    expect(Math.abs((await timerSeconds(page)) - paused)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Resume session' }).click();
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status).toBe('running');
    await expect.poll(() => badge(context)).toMatch(/m$/);
    await page.getByRole('button', { name: 'Stop session' }).click();
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status).toBe('idle');
    await expect.poll(() => badge(context)).toBe('');
    const w = await sw(context);
    expect(await w.evaluate(async () => (await chrome.alarms.getAll()).map((a) => a.name).filter((n) => n.startsWith('ts-focus')))).toEqual([]);
    // stopped under a minute -> not recorded
    expect((await storageGet<unknown[]>(context, 'ts.focusSessions')) ?? []).toEqual([]);
  });

  test('16 · a session whose endAt passes is completed by the worker and recorded exactly once', async ({ dash, context }) => {
    const page = await dash('focus');
    const now = Date.now();
    await storageSet(context, { 'ts.focus': { status: 'running', kind: 'focus', durationMs: 25 * 60_000, startedAt: now - 25 * 60_000 - 1000, endAt: now - 1000 } });
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status, { timeout: 10_000 }).toBe('idle');
    const recs = await storageGet<{ completed: boolean; actualMs: number; kind: string }[]>(context, 'ts.focusSessions');
    expect(recs.length).toBe(1);
    expect(recs[0]).toMatchObject({ completed: true, actualMs: 25 * 60_000, kind: 'focus' });
    await expect(page.getByText('1/8')).toBeVisible();
    await expect.poll(() => badge(context)).toBe('');
    // Trigger the alarm path again — must not double-record
    const w = await sw(context);
    await w.evaluate(async () => chrome.storage.local.set({ 'ts.focus': (await chrome.storage.local.get('ts.focus'))['ts.focus'] }));
    await page.waitForTimeout(1000);
    expect((await storageGet<unknown[]>(context, 'ts.focusSessions')).length).toBe(1);
    // Shows in Analytics
    await page.evaluate(() => (location.hash = '#/analytics'));
    await expect(page.getByText('25m').first()).toBeVisible();
  });

  test('16 · real alarm path: session ending a few seconds from now completes without any page open', async ({ open, context }) => {
    const p = await open('popup.html');
    const now = Date.now();
    await storageSet(context, { 'ts.focus': { status: 'running', kind: 'custom', durationMs: 65_000, startedAt: now - 60_000, endAt: now + 5000 } });
    await p.close();
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status, { timeout: 45_000, intervals: [1000] }).toBe('idle');
    const recs = await storageGet<{ completed: boolean; kind: string }[]>(context, 'ts.focusSessions');
    expect(recs).toEqual([expect.objectContaining({ completed: true, kind: 'custom' })]);
  });

  test('blocking · enable + start -> DNR rules added, blocked domain navigation is stopped; stop -> rules removed', async ({ dash, context }) => {
    test.setTimeout(90_000);
    const page = await dash('focus');
    await page.getByRole('textbox', { name: 'Domain to block' }).fill('https://www.example.com/some/path');
    await page.getByRole('button', { name: 'Add domain' }).click();
    await expect(page.getByText('example.com', { exact: true })).toBeVisible();
    await page.getByRole('switch', { name: 'Block distracting sites during focus' }).click();
    const w = await sw(context);
    // Not running yet -> no rules
    await page.waitForTimeout(500);
    expect(await w.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).toEqual([]);
    await page.getByRole('button', { name: 'Start Focus session' }).click();
    await expect
      .poll(async () => (await w.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).flatMap((r) => r.condition.requestDomains ?? []))
      .toEqual(expect.arrayContaining(['example.com', 'youtube.com']));
    await shot(page, '21-focus-blocking-on');
    const tab = await context.newPage();
    await tab.goto('https://example.com/').catch(() => undefined);
    await tab.waitForTimeout(1500);
    const url = tab.url();
    const content = await tab.content().catch(() => '');
    test.info().annotations.push({ type: 'blocked-url', description: url });
    expect(content).not.toContain('Example Domain');
    expect(url.startsWith('https://example.com') ? 'chrome-error' : url).toMatch(/chrome-error|dashboard\.html#\/focus\?blocked=example\.com/);
    // Subdomain blocked too
    const sub = await context.newPage();
    await sub.goto('https://www.example.com/').catch(() => undefined);
    await sub.waitForTimeout(1000);
    expect(await sub.content().catch(() => '')).not.toContain('Example Domain');
    // Stop -> unblocked
    await page.bringToFront();
    await page.getByRole('button', { name: 'Stop session' }).click();
    await expect.poll(async () => (await w.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length).toBe(0);
    const again = await context.newPage();
    await again.goto('https://example.com/?after-stop').catch((e) => test.info().annotations.push({ type: 'goto-error', description: String(e) }));
    await again.waitForTimeout(1500);
    test.info().annotations.push({ type: 'after-stop-url', description: again.url() });
    expect(await again.content()).toContain('Example Domain');
  });

  test('blocking · pausing a session lifts the block; breaks never block', async ({ dash, context }) => {
    const page = await dash('focus');
    await page.getByRole('switch', { name: 'Block distracting sites during focus' }).click();
    await page.getByRole('button', { name: 'Start Focus session' }).click();
    const w = await sw(context);
    await expect.poll(async () => (await w.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Pause session' }).click();
    await expect.poll(async () => (await w.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length).toBe(0);
    await page.getByRole('button', { name: 'Stop session' }).click();
    await page.getByRole('radio', { name: 'Short Break' }).click();
    await page.getByRole('button', { name: 'Start Short Break session' }).click();
    await page.waitForTimeout(800);
    expect((await w.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length).toBe(0);
  });

  test('16 · custom duration input clamps to 1–240 and is used for the session', async ({ dash, context }) => {
    const page = await dash('focus');
    await page.getByRole('radio', { name: 'Custom' }).click();
    const box = page.getByRole('spinbutton', { name: /Custom session minutes/ }).or(page.getByRole('textbox', { name: /Custom session minutes/ }));
    await box.fill('1');
    await box.press('Enter');
    await page.getByRole('button', { name: 'Start Custom session' }).click();
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).durationMs).toBe(60_000);
    await page.getByRole('button', { name: 'Stop session' }).click();
    await box.fill('100000');
    await box.press('Enter');
    await page.getByRole('button', { name: 'Start Custom session' }).click();
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).durationMs).toBe(240 * 60_000);
  });
});
