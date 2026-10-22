import { expect, realErrors, shot, storageGet, sw, test } from './helpers';

type Note = { id: string; title: string; content: string; folderId?: string };
type Focus = { status: string; kind: string; completed?: { kind: string; at: number } };

/**
 * V2 (Agent 3A): toolbar popup redesign, Quick Note autosave + close-safety,
 * quick-note command plumbing, and the real 1-minute focus completion path
 * (alarm → record → notification → offscreen chime → completion state).
 */
test.describe('V2 popup & focus completion', () => {
  test('popup shows Focus Session, Quick Notes and dashboard; no console errors', async ({ open, errors }) => {
    const popup = await open('popup.html');
    await popup.setViewportSize({ width: 300, height: 520 });
    await expect(popup.getByRole('heading', { level: 1, name: 'TABSPACE' })).toBeVisible();
    await expect(popup.getByRole('timer')).toHaveText('25:00');
    await expect(popup.getByRole('button', { name: 'Start' })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'New Note' })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Open Dashboard' })).toBeVisible();
    await shot(popup, 'v2-popup', false);
    // Start from the popup, close it, reopen: still running (closing never resets the timer)
    await popup.getByRole('button', { name: 'Start' }).click();
    await expect(popup.getByRole('button', { name: 'Pause' })).toBeVisible();
    await popup.close();
    const p2 = await open('popup.html');
    await expect(p2.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(p2.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
    expect(realErrors(errors)).toEqual([]);
  });

  test('Quick Note autosaves into Notes (Unfiled) and "Open in Notes" works', async ({ open, context }) => {
    const popup = await open('popup.html');
    await popup.getByRole('button', { name: 'New Note' }).click();
    const box = popup.getByRole('textbox', { name: /Quick note/ });
    await expect(box).toBeFocused();
    await box.pressSequentially('Push Tabspace to GitHub\nTag v2', { delay: 15 });
    await expect(popup.getByText('Saved')).toBeVisible();
    const notes = await storageGet<Note[]>(context, 'ts.notes');
    expect(notes).toEqual([expect.objectContaining({ title: 'Push Tabspace to GitHub', content: 'Tag v2' })]);
    expect(notes[0].folderId).toBeUndefined();
    await shot(popup, 'v2-popup-quicknote', false);
    const [dashPage] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Open in Notes' }).click()]);
    await expect(dashPage).toHaveURL(new RegExp(`#/notes\\?id=${notes[0].id}`));
  });

  test('closing the popup mid-typing loses nothing', async ({ open, context }) => {
    const popup = await open('popup.html');
    await popup.getByRole('button', { name: 'New Note' }).click();
    const box = popup.getByRole('textbox', { name: /Quick note/ });
    await box.pressSequentially('Review job applications', { delay: 10 });
    await expect(popup.getByText('Saved')).toBeVisible();
    // Type and close immediately — well inside the 400 ms debounce.
    await box.pressSequentially('\nCall back the two shortlisted', { delay: 0 });
    await popup.close();
    await expect
      .poll(async () => (await storageGet<Note[]>(context, 'ts.notes'))[0]?.content, { timeout: 8000 })
      .toBe('Call back the two shortlisted');
    // Recovery / pending records are cleaned up after the merge.
    const w = await sw(context);
    await expect
      .poll(async () => w.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('ts.notes.unsaved.') || k.startsWith('ts.quicknote.pending.'))), { timeout: 8000 })
      .toEqual([]);
  });

  test('closing right after the very first keystrokes still creates the note', async ({ open, context }) => {
    const popup = await open('popup.html#note');
    const box = popup.getByRole('textbox', { name: /Quick note/ });
    await box.pressSequentially('Go for a run', { delay: 0 });
    await popup.close();
    // Whichever layer lands (create, pending record via the worker, or the localStorage backup merged by the
    // next surface that opens), the note must exist once the popup is opened again.
    await open('popup.html');
    await expect.poll(async () => (await storageGet<Note[] | undefined>(context, 'ts.notes'))?.map((n) => n.title), { timeout: 8000 }).toEqual(['Go for a run']);
  });

  test('popup.html#note opened as a tab (bookmark target) shows a centred editor', async ({ open }) => {
    const page = await open('popup.html#note');
    const box = page.getByRole('textbox', { name: /Quick note/ });
    await expect(box).toBeVisible();
    const b = (await box.boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(Math.abs(b.x + b.width / 2 - vw / 2)).toBeLessThan(40);
    await shot(page, 'v2-quicknote-tab', false);
  });

  test('commands are registered and openPopup is available (Chrome 127+)', async ({ context }) => {
    const w = await sw(context);
    const info = await w.evaluate(async () => ({
      commands: (await chrome.commands.getAll()).map((c) => c.name),
      openPopup: typeof (chrome.action as unknown as { openPopup?: unknown }).openPopup,
      offscreen: typeof (chrome as unknown as { offscreen?: { createDocument?: unknown } }).offscreen?.createDocument,
    }));
    expect(info.commands).toEqual(expect.arrayContaining(['_execute_action', 'quick-note', 'toggle-sidebar']));
    expect(info.openPopup).toBe('function');
    expect(info.offscreen).toBe('function');
  });

  test('real 1-minute custom session: alarm → record → notification → offscreen chime → "Session complete"', async ({ dash, context, errors }) => {
    test.setTimeout(150_000);
    const page = await dash('focus');
    await page.getByRole('radio', { name: 'Custom' }).click();
    const minutes = page.getByRole('spinbutton', { name: /Custom session minutes/ });
    await minutes.fill('1');
    await minutes.press('Enter');
    await expect.poll(async () => (await storageGet<{ focus: { customMin: number } }>(context, 'ts.settings'))?.focus?.customMin).toBe(1);
    await page.getByRole('button', { name: 'Start Custom session' }).click();
    const w = await sw(context);
    await expect.poll(() => w.evaluate(() => chrome.action.getBadgeText({}))).toBe('1m');
    // Close the page: completion must not depend on any open surface.
    await page.close();
    await expect
      .poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status === 'idle' && !!(await storageGet<Focus>(context, 'ts.focus')).completed, { timeout: 100_000, intervals: [1000] })
      .toBe(true);
    const recs = await storageGet<{ kind: string; completed: boolean; actualMs: number }[]>(context, 'ts.focusSessions');
    expect(recs).toEqual([expect.objectContaining({ kind: 'custom', completed: true, actualMs: 60_000 })]);
    const w2 = await sw(context);
    const result = await w2.evaluate(async () => ({
      notifications: Object.keys(await new Promise<object>((r) => chrome.notifications.getAll(r))),
      offscreen: (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] })).map((c) => c.documentUrl),
      chime: (await chrome.storage.session.get('ts.session.lastChime'))['ts.session.lastChime'],
      badge: await chrome.action.getBadgeText({} as chrome.action.TabDetails),
    }));
    expect(result.notifications.some((id) => id.startsWith('ts-focus-'))).toBe(true);
    expect(result.chime).toMatchObject({ ok: true });
    // AUDIO_PLAYBACK documents close themselves ~30 s after the audio ends; right after completion it exists.
    expect(result.offscreen.some((u) => u?.endsWith('/offscreen.html'))).toBe(true);
    expect(result.badge).toBe('');
    // Completion state on the Focus page and the popup
    const again = await dash('focus');
    await expect(again.getByText('Session complete')).toBeVisible();
    await expect(again.getByRole('button', { name: 'Start short break' })).toBeVisible();
    await shot(again, 'v2-focus-complete', false);
    const popup = await (async () => {
      const p = await context.newPage();
      await p.goto(again.url().replace(/dashboard\.html.*/, 'popup.html'));
      return p;
    })();
    await expect(popup.getByText('Session complete')).toBeVisible();
    await expect(popup.getByRole('timer')).toHaveCount(0); // no big 00:00 in the complete state (UX V2 #15)
    await popup.getByRole('button', { name: 'Start again' }).click();
    await expect.poll(async () => (await storageGet<Focus>(context, 'ts.focus')).status).toBe('running');
    expect((await storageGet<Focus>(context, 'ts.focus')).kind).toBe('custom');
    expect(realErrors(errors)).toEqual([]);
  });
});
