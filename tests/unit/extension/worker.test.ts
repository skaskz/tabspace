import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAdapter, get, set } from '@/storage/store';
import { createMemoryAdapter, type StorageAdapter } from '@/storage/adapter';
import { DEFAULT_SETTINGS } from '@/storage/schema';
import * as timer from '@/features/focus/timer';
import { RULE_ID_BASE } from '@/features/blocking/rules';

/**
 * Minimal fake of the chrome APIs the worker modules touch. chrome.storage.local
 * delegates to the same memory adapter the store uses, so worker reads and
 * store writes see one dataset.
 */
function installChrome(adapter: StorageAdapter) {
  const session = new Map<string, unknown>();
  const alarms = new Map<string, chrome.alarms.AlarmCreateInfo>();
  let rules: { id: number; condition: { requestDomains?: string[] } }[] = [{ id: 1, condition: { requestDomains: ['other-extension-rule.com'] } }];
  const perms = { dnr: true };
  const offscreenDocs: string[] = [];
  /** Domains Chrome "rejects" (simulates an invalid requestDomains value). */
  const rejected = new Set<string>();
  const fake = {
    permissions: { contains: vi.fn(async () => perms.dnr) },
    runtime: {
      getURL: (p: string) => `chrome-extension://test/${p}`,
      id: 'test',
      getContexts: vi.fn(async (f: { contextTypes?: string[] }) => (f.contextTypes?.includes('OFFSCREEN_DOCUMENT') && offscreenDocs.length ? [{ documentUrl: offscreenDocs[0] }] : [])),
      sendMessage: vi.fn(async (msg: { target?: string; type?: string }) => (msg.target === 'offscreen' && offscreenDocs.length ? { ok: true, state: 'running' } : undefined)),
    },
    offscreen: {
      createDocument: vi.fn(async (p: { url: string; reasons: string[] }) => {
        if (offscreenDocs.length) throw new Error('Only a single offscreen document may be created.');
        offscreenDocs.push(`chrome-extension://test/${p.url}`);
      }),
    },
    storage: {
      local: { get: async (k: string | string[]) => adapter.get(Array.isArray(k) ? k : [k]) },
      session: {
        get: async (k: string) => (session.has(k) ? { [k]: session.get(k) } : {}),
        set: async (o: Record<string, unknown>) => Object.entries(o).forEach(([k, v]) => session.set(k, v)),
        remove: async (k: string) => void session.delete(k),
      },
    },
    alarms: {
      create: vi.fn(async (name: string, info: chrome.alarms.AlarmCreateInfo) => void alarms.set(name, info)),
      clear: vi.fn(async (name: string) => alarms.delete(name)),
      get: async (name: string) => (alarms.has(name) ? { name } : undefined),
    },
    action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined), setBadgeTextColor: vi.fn(async () => undefined), setTitle: vi.fn(async () => undefined) },
    notifications: { create: vi.fn(async () => 'id') },
    declarativeNetRequest: {
      getDynamicRules: async () => rules,
      updateDynamicRules: vi.fn(async ({ removeRuleIds = [], addRules = [] }: { removeRuleIds?: number[]; addRules?: typeof rules }) => {
        if (addRules.some((r) => (r.condition.requestDomains ?? []).some((d) => rejected.has(d)))) throw new Error('Invalid rule');
        rules = [...rules.filter((r) => !removeRuleIds.includes(r.id)), ...addRules];
      }),
    },
    windows: { getLastFocused: vi.fn(async () => ({ id: 1, focused: true })) },
    tabs: { query: vi.fn(async () => [{ url: 'https://www.github.com/org/repo?q=secret' }]), update: vi.fn(async () => undefined) },
  };
  vi.stubGlobal('chrome', fake);
  return { fake, alarms, session, perms, rejected, offscreenDocs, rules: () => rules };
}

let adapter: StorageAdapter;
let env: ReturnType<typeof installChrome>;
beforeEach(() => {
  adapter = createMemoryAdapter();
  setAdapter(adapter);
  env = installChrome(adapter);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const MIN = 60_000;

describe('focus completion (worker)', () => {
  it('records a finished session exactly once and resets to idle', async () => {
    const { completeIfDue } = await import('@/extension/background/focus');
    await set('ts.focus', timer.start('focus', 25 * MIN, 0));
    const now = 26 * MIN;
    const [a, b] = await Promise.all([completeIfDue(now), completeIfDue(now)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await completeIfDue(now + 1)).toBe(false);
    const sessions = await get('ts.focusSessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ kind: 'focus', completed: true, actualMs: 25 * MIN, endedAt: 25 * MIN });
    expect((await get('ts.focus')).status).toBe('idle');
    expect(env.fake.notifications.create).toHaveBeenCalledTimes(1);
  });

  it('does not notify when focus notifications are off, and never records breaks', async () => {
    const { completeIfDue } = await import('@/extension/background/focus');
    await set('ts.settings', { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications, focus: false } });
    await set('ts.focus', timer.start('short', 5 * MIN, 0));
    expect(await completeIfDue(6 * MIN)).toBe(true);
    expect(await get('ts.focusSessions')).toEqual([]);
    expect(env.fake.notifications.create).not.toHaveBeenCalled();
  });

  it('schedules end + aligned tick alarms while running and clears them when idle', async () => {
    const { syncFocus, FOCUS_END_ALARM, FOCUS_TICK_ALARM } = await import('@/extension/background/focus');
    const now = Date.now();
    await set('ts.focus', timer.start('focus', 25 * MIN, now));
    await syncFocus(now);
    expect(env.alarms.get(FOCUS_END_ALARM)).toEqual({ when: now + 25 * MIN });
    expect(env.alarms.get(FOCUS_TICK_ALARM)).toEqual({ when: now + MIN, periodInMinutes: 1 });
    expect(env.fake.action.setBadgeText).toHaveBeenLastCalledWith({ text: '25m' });
    await set('ts.focus', timer.reset(await get('ts.focus')));
    await syncFocus(now);
    expect(env.alarms.size).toBe(0);
    expect(env.fake.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('respects showBadge', async () => {
    const { syncFocus } = await import('@/extension/background/focus');
    await set('ts.settings', { ...DEFAULT_SETTINGS, focus: { ...DEFAULT_SETTINGS.focus, showBadge: false } });
    await set('ts.focus', timer.start('focus', 25 * MIN, Date.now()));
    await syncFocus();
    expect(env.fake.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });
});

describe('completion chime (worker)', () => {
  it('plays the chime through one offscreen document when settings.focus.sound is on', async () => {
    const { completeIfDue } = await import('@/extension/background/focus');
    await set('ts.focus', timer.start('custom', MIN, 0));
    expect(await completeIfDue(2 * MIN)).toBe(true);
    expect(env.fake.offscreen.createDocument).toHaveBeenCalledWith({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: expect.any(String) });
    expect(env.fake.runtime.sendMessage).toHaveBeenCalledWith({ target: 'offscreen', type: 'chime' });
    expect(env.session.get('ts.session.lastChime')).toMatchObject({ ok: true, state: 'running' });
    expect(env.fake.notifications.create).toHaveBeenCalledTimes(1);
    expect((await get('ts.focus')).completed).toEqual({ kind: 'custom', at: MIN });
    // A second completion reuses the existing document.
    await set('ts.focus', timer.start('focus', MIN, 0));
    await completeIfDue(2 * MIN);
    expect(env.fake.offscreen.createDocument).toHaveBeenCalledTimes(1);
    expect(env.fake.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('stays silent when sound is off, and a chime failure does not block the notification', async () => {
    const { completeIfDue } = await import('@/extension/background/focus');
    await set('ts.settings', { ...DEFAULT_SETTINGS, focus: { ...DEFAULT_SETTINGS.focus, sound: false } });
    await set('ts.focus', timer.start('focus', MIN, 0));
    await completeIfDue(2 * MIN);
    expect(env.fake.offscreen.createDocument).not.toHaveBeenCalled();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await set('ts.settings', DEFAULT_SETTINGS);
    env.fake.offscreen.createDocument.mockRejectedValueOnce(new Error('boom'));
    await set('ts.focus', timer.start('focus', MIN, 0));
    expect(await completeIfDue(2 * MIN)).toBe(true);
    expect(env.fake.notifications.create).toHaveBeenCalledTimes(2);
    expect(env.session.get('ts.session.lastChime')).toMatchObject({ ok: false });
    warn.mockRestore();
  });
});

describe('site blocking (worker)', () => {
  it('adds rules only while a focus session runs with blocking on, then removes only its own rules', async () => {
    const { syncBlocking } = await import('@/extension/background/blocking');
    await set('ts.settings', { ...DEFAULT_SETTINGS, focus: { ...DEFAULT_SETTINGS.focus, blockSites: true, blocklist: ['youtube.com', 'reddit.com'] } });
    await set('ts.focus', timer.start('focus', 25 * MIN, Date.now()));
    await syncBlocking();
    expect(env.rules().map((r) => r.id).sort()).toEqual([1, RULE_ID_BASE, RULE_ID_BASE + 1]);
    // Re-sync with identical state does not call the API again.
    await syncBlocking();
    expect(env.fake.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledTimes(1);
    // Pause => all Tabspace rules removed, foreign rule untouched.
    await set('ts.focus', timer.pause(await get('ts.focus')));
    await syncBlocking();
    expect(env.rules().map((r) => r.id)).toEqual([1]);
  });
});

describe('site blocking: permission + resilience (worker)', () => {
  const blockingOn = async (blocklist: string[]) => {
    await set('ts.settings', { ...DEFAULT_SETTINGS, focus: { ...DEFAULT_SETTINGS.focus, blockSites: true, blocklist } });
    await set('ts.focus', timer.start('focus', 25 * MIN, Date.now()));
  };

  it('treats a missing declarativeNetRequest permission as blocking off', async () => {
    const { syncBlocking, explainBlockedTab } = await import('@/extension/background/blocking');
    env.perms.dnr = false;
    await blockingOn(['youtube.com']);
    await syncBlocking();
    expect(env.fake.declarativeNetRequest.updateDynamicRules).not.toHaveBeenCalled();
    await explainBlockedTab(5, 'https://www.youtube.com/');
    expect(env.fake.tabs.update).not.toHaveBeenCalled();
  });

  it('does nothing when the DNR API is absent', async () => {
    const { syncBlocking } = await import('@/extension/background/blocking');
    (env.fake as { declarativeNetRequest?: unknown }).declarativeNetRequest = undefined;
    await blockingOn(['youtube.com']);
    await expect(syncBlocking()).resolves.toBeUndefined();
  });

  it('falls back to one rule at a time so one rejected domain does not disable the rest', async () => {
    const { syncBlocking } = await import('@/extension/background/blocking');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    env.rejected.add('reddit.com');
    await blockingOn(['youtube.com', 'reddit.com', 'x.com']);
    await syncBlocking();
    const domains = env.rules().flatMap((r) => r.condition.requestDomains ?? []);
    expect(domains.sort()).toEqual(['other-extension-rule.com', 'x.com', 'youtube.com']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reddit.com'), expect.anything());
    warn.mockRestore();
  });

  it('redirects a tab to the explanation page only while blocking is effective', async () => {
    const { explainBlockedTab } = await import('@/extension/background/blocking');
    await blockingOn(['youtube.com']);
    await explainBlockedTab(7, 'https://m.youtube.com/watch');
    expect(env.fake.tabs.update).toHaveBeenCalledWith(7, { url: 'chrome-extension://test/dashboard.html#/focus?blocked=youtube.com' });
    await explainBlockedTab(8, 'https://github.com/');
    expect(env.fake.tabs.update).toHaveBeenCalledTimes(1);
  });
});

describe('usage tracking (worker)', () => {
  it('does nothing while tracking is off', async () => {
    const { refreshUsage } = await import('@/extension/background/usage');
    await refreshUsage(1000);
    expect(env.session.size).toBe(0);
    expect(env.fake.tabs.query).not.toHaveBeenCalled();
    expect(await get('ts.usage')).toEqual({});
  });

  it('accumulates hostname time from the stored segment when the next event arrives', async () => {
    const { refreshUsage } = await import('@/extension/background/usage');
    await set('ts.settings', { ...DEFAULT_SETTINGS, analytics: { trackWebsites: true } });
    const t0 = new Date(2026, 9, 21, 10, 0).getTime();
    await refreshUsage(t0);
    expect(env.session.get('ts.usageSegment')).toEqual({ domain: 'github.com', start: t0 });
    await refreshUsage(t0 + 3 * MIN);
    expect(await get('ts.usage')).toEqual({ '2026-10-21': { 'github.com': 3 * MIN } });
    // Chrome loses focus => segment closed, nothing open.
    env.fake.windows.getLastFocused.mockResolvedValueOnce({ id: 1, focused: false });
    await refreshUsage(t0 + 4 * MIN);
    expect(env.session.has('ts.usageSegment')).toBe(false);
    expect((await get('ts.usage'))['2026-10-21']['github.com']).toBe(4 * MIN);
    expect(JSON.stringify(await get('ts.usage'))).not.toContain('secret');
  });
});
