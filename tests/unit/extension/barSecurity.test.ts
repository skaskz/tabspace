import { afterEach, describe, expect, it, vi } from 'vitest';
import { BAR_ORIGINS, releaseBarGrant, requestWebsiteBar } from '@/extension/bar/register';
import { GRANTS_KEY, readGrants } from '@/extension/shared/grants';
import { createVisibilityGate, FRESH_MS } from '@/extension/bar/visibility';
import { frameNonce, verifyEmbedding } from '@/extension/bar/BarFrame';

afterEach(() => vi.unstubAllGlobals());

function stub(held: { scripting: boolean; origins: string[] }, grant = true) {
  const local = new Map<string, unknown>();
  const state = { ...held, origins: [...held.origins] };
  const contains = vi.fn(async (p: { permissions?: string[]; origins?: string[] }) => (p.permissions ?? []).every(() => state.scripting) && (p.origins ?? []).every((o) => state.origins.includes(o)));
  const request = vi.fn(async () => {
    if (grant) {
      state.scripting = true;
      state.origins = [...new Set([...state.origins, ...BAR_ORIGINS])];
    }
    return grant;
  });
  const remove = vi.fn(async () => true);
  vi.stubGlobal('chrome', {
    permissions: { contains, request, remove },
    storage: {
      local: {
        get: async (k: string) => (local.has(k) ? { [k]: local.get(k) } : {}),
        set: async (o: Record<string, unknown>) => void Object.entries(o).forEach(([k, v]) => local.set(k, v)),
        remove: async (k: string) => void local.delete(k),
      },
    },
  });
  return { local, contains, request, remove };
}

describe('website bar grants (V21-1, shared record)', () => {
  it('request → setting saved first, then the record; disable releases exactly that and forgets it', async () => {
    const env = stub({ scripting: false, origins: [] });
    const order: string[] = [];
    const ok = await requestWebsiteBar(async () => void order.push('setting'));
    expect(ok).toBe(true);
    expect(env.request).toHaveBeenCalledTimes(1);
    order.push(env.local.has(GRANTS_KEY) ? 'record' : 'no-record');
    expect(order).toEqual(['setting', 'record']);
    expect(await readGrants()).toEqual({ scripting: ['bar'], origins: { 'https://*/*': ['bar'], 'http://*/*': ['bar'] } });
    expect(await releaseBarGrant()).toEqual({ permissions: ['scripting'], origins: BAR_ORIGINS });
    expect(env.remove).toHaveBeenCalledWith({ permissions: ['scripting'], origins: BAR_ORIGINS });
    expect(env.local.has(GRANTS_KEY)).toBe(false);
    expect(await releaseBarGrant()).toBeNull(); // idempotent
    expect(env.remove).toHaveBeenCalledTimes(1);
  });

  it('a user who already held everything gets no record and nothing is ever released', async () => {
    const env = stub({ scripting: true, origins: BAR_ORIGINS });
    await requestWebsiteBar();
    expect(env.local.has(GRANTS_KEY)).toBe(false);
    expect(await releaseBarGrant()).toBeNull();
    expect(env.remove).not.toHaveBeenCalled();
  });

  it('a denial saves nothing', async () => {
    const env = stub({ scripting: false, origins: [] }, false);
    const onGranted = vi.fn();
    expect(await requestWebsiteBar(onGranted)).toBe(false);
    expect(onGranted).not.toHaveBeenCalled();
    expect(env.local.has(GRANTS_KEY)).toBe(false);
  });

  it('migrates a V2.1 ts.barGrant record and ignores foreign origins in it', async () => {
    const env = stub({ scripting: true, origins: [] });
    env.local.set('ts.barGrant', { scripting: true, origins: ['<all_urls>', 'https://*/*'] });
    expect(await releaseBarGrant()).toEqual({ permissions: ['scripting'], origins: ['https://*/*'] });
    expect(env.local.has('ts.barGrant')).toBe(false);
  });
});

describe('visibility gate (V21-2)', () => {
  function fakeIO() {
    let cb: IntersectionObserverCallback = () => undefined;
    const make = (c: IntersectionObserverCallback) => {
      cb = c;
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() } as unknown as IntersectionObserver;
    };
    const report = (target: Element, isVisible: boolean) => cb([{ target, isVisible } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    return { make, report };
  }

  it('allows everything when IntersectionObserver v2 is unsupported', () => {
    const g = createVisibilityGate(() => null, false);
    expect(g.allows(document.body)).toBe(true);
  });

  it('blocks clicks while the bar is hidden/occluded and allows them once visible', () => {
    const io = fakeIO();
    const bar = document.createElement('div');
    const btn = document.createElement('button');
    bar.appendChild(btn);
    const g = createVisibilityGate(() => bar, true, io.make);
    g.observe(bar);
    const t0 = performance.now();
    expect(g.allows(btn, t0 + 100)).toBe(false); // no grace period: blocked until Chrome confirms the bar is visible
    expect(g.allows(btn, t0 + 900)).toBe(false); // never confirmed visible
    io.report(bar, true);
    expect(g.allows(btn)).toBe(true);
    io.report(bar, false);
    expect(g.allows(btn)).toBe(false);
  });

  it('a freshly opened panel uses the bar state; after that it must itself be visible', () => {
    const io = fakeIO();
    const bar = document.createElement('div');
    const panel = document.createElement('div');
    const item = document.createElement('div');
    bar.appendChild(panel);
    panel.appendChild(item);
    const g = createVisibilityGate(() => bar, true, io.make);
    g.observe(bar);
    io.report(bar, true);
    const t0 = performance.now();
    g.observe(panel);
    expect(g.allows(item, t0 + 50)).toBe(true); // young panel, bar visible
    expect(g.allows(item, t0 + FRESH_MS + 50)).toBe(false); // never confirmed visible (e.g. covered by a decoy)
    io.report(panel, true);
    expect(g.allows(item, t0 + FRESH_MS + 60)).toBe(true);
  });
});

describe('frame embedding handshake (V21-5)', () => {
  it('parses only a well-formed nonce', () => {
    expect(frameNonce('#n=2a3b4e9a-2536-408a-9882-8ef5e2373729')).toBe('2a3b4e9a-2536-408a-9882-8ef5e2373729');
    expect(frameNonce('#n=abc')).toBeNull();
    expect(frameNonce('')).toBeNull();
  });

  it('requires a single ancestor equal to the tab origin and the content script confirming the nonce', async () => {
    const sendMessage = vi.fn(async (_tab: number, m: { nonce: string }) => ({ ok: m.nonce === 'good' }));
    vi.stubGlobal('chrome', { tabs: { sendMessage } });
    const tab = { id: 4, url: 'https://news.example/a' } as chrome.tabs.Tab;
    expect(await verifyEmbedding(tab, 'good', ['https://news.example'])).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(4, { type: 'tsbar:verify', nonce: 'good' }, { frameId: 0 });
    expect(await verifyEmbedding(tab, 'bad', ['https://news.example'])).toBe(false);
    expect(await verifyEmbedding(tab, 'good', ['https://evil.example'])).toBe(false); // framed by another site
    expect(await verifyEmbedding(tab, 'good', ['https://news.example', 'https://news.example'])).toBe(false); // nested
    expect(await verifyEmbedding(tab, null, ['https://news.example'])).toBe(false);
    expect(await verifyEmbedding(null, 'good', ['https://news.example'])).toBe(false);
  });
});
