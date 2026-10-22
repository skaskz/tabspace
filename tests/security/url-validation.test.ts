import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRestorableUrl, isSafeUrl, normalizeDomain, normalizeUrl } from '@/utils/url';
import { asUrl, resolveSearch } from '@/extension/newtab/search';
import { normalizeFeedUrl } from '@/features/calendar/ics';
import { openUrl } from '@/extension/shared/openUrl';
import { openLink } from '@/features/search/chromeTabs';
import { validateLink } from '@/features/quicklinks/quickLinks';
import { usageDomain } from '@/features/usage/accumulate';

/** Every URL that gets opened, navigated to or stored must be http(s). */

const DANGEROUS = [
  'javascript:alert(1)',
  'JAVASCRIPT:alert(1)',
  ' javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'javascript://%0Aalert(1)',
  'javascript:/*https://ok.example*/alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'file:///C:/Windows/win.ini',
  'file://server/share',
  'chrome://settings',
  'chrome://extensions',
  'chrome-extension://abcdefghijklmnop/dashboard.html',
  'about:blank',
  'blob:https://ok.example/uuid',
  'filesystem:https://ok.example/temporary/x',
  'view-source:https://ok.example',
  'ftp://ok.example/file',
  'ws://ok.example',
  'mailto:a@b.example',
  'intent://scan/#Intent;scheme=zxing;end',
];

describe('isSafeUrl / isRestorableUrl', () => {
  it.each(DANGEROUS)('rejects %j', (u) => {
    expect(isSafeUrl(u)).toBe(false);
    expect(isRestorableUrl(u)).toBe(false);
  });
  it('accepts plain http(s)', () => {
    expect(isSafeUrl('https://ok.example/path?q=1#h')).toBe(true);
    expect(isSafeUrl('http://ok.example')).toBe(true);
  });
  it('rejects non-strings and garbage', () => {
    for (const v of [undefined, null, '', ' ', 'not a url', '//ok.example', 'https//x']) expect(isSafeUrl(v as string)).toBe(false);
  });
});

describe('normalizeUrl (bookmark / quick link input)', () => {
  it.each(DANGEROUS)('rejects %j', (u) => {
    expect(normalizeUrl(u)).toBeNull();
    expect('error' in validateLink('t', u)).toBe(true);
  });
  it('adds https:// to bare hosts and keeps the scheme otherwise', () => {
    expect(normalizeUrl('ok.example')).toBe('https://ok.example/');
    expect(normalizeUrl('http://ok.example/a')).toBe('http://ok.example/a');
  });
  it('rejects whitespace-smuggled and host-less inputs', () => {
    expect(normalizeUrl('https://ok.example/ javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('https://')).toBeNull();
    expect(normalizeUrl('intranet')).toBeNull();
  });
  it('does not turn "javascript:..." into a hostname by prefixing https://', () => {
    // A scheme-looking prefix must be treated as a scheme, not a host.
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('data:,x')).toBeNull();
  });
});

describe('New Tab search box (asUrl / resolveSearch)', () => {
  it.each(DANGEROUS)('never navigates to %j', (u) => {
    expect(asUrl(u)).toBeNull();
    const target = resolveSearch(u, 'google');
    if (target) expect(new URL(target).protocol).toBe('https:');
    if (target) expect(new URL(target).hostname).toBe('www.google.com');
  });
  it('scheme-with-digit tricks go to search, not navigation', () => {
    for (const s of ['javascript:1', 'javascript:0//ok.example', 'data:1,x', 'localhost:8080:javascript']) {
      const t = resolveSearch(s, 'duckduckgo');
      expect(t === null || new URL(t).protocol === 'https:').toBe(true);
      expect(t && new URL(t).hostname === 'duckduckgo.com').toBe(true);
    }
  });
  it('host-like input becomes an http(s) URL', () => {
    expect(asUrl('ok.example/x')).toBe('https://ok.example/x');
    expect(asUrl('localhost:3000')).toBe('http://localhost:3000/');
  });
  it('search query is URL-encoded (no parameter injection)', () => {
    const t = resolveSearch('a&q=evil #frag', 'bing')!;
    const u = new URL(t);
    expect(u.searchParams.getAll('q')).toEqual(['a&q=evil #frag']);
  });
});

describe('ICS feed URL', () => {
  it('converts webcal(s):// to https://', () => {
    expect(normalizeFeedUrl('webcal://cal.example/a.ics')).toBe('https://cal.example/a.ics');
    expect(normalizeFeedUrl('WEBCALS://cal.example/a.ics')).toBe('https://cal.example/a.ics');
  });
  it.each(DANGEROUS)('rejects %j', (u) => {
    expect(normalizeFeedUrl(u)).toBeNull();
  });
  it('rejects webcal tricks that are not followed by //', () => {
    expect(normalizeFeedUrl('webcal:javascript:alert(1)')).toBeNull();
  });
});

describe('openUrl / openLink refuse unsafe URLs before touching Chrome', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(DANGEROUS)('refuses %j', async (u) => {
    const create = vi.fn(async () => ({}));
    vi.stubGlobal('chrome', { tabs: { create, query: vi.fn() } });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    expect(await openUrl(u)).toBe(false);
    expect(await openLink(u)).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
  it('opens http(s) via chrome.tabs.create', async () => {
    const create = vi.fn(async () => ({}));
    vi.stubGlobal('chrome', { tabs: { create, query: vi.fn() } });
    expect(await openUrl('https://ok.example')).toBe(true);
    expect(create).toHaveBeenCalledWith({ url: 'https://ok.example', active: true });
  });
});

describe('usage tracking records hostnames only', () => {
  it('strips path, query, fragment, credentials and port', () => {
    expect(usageDomain('https://user:secret@www.Mail.example:8443/inbox/123?token=abc#x')).toBe('mail.example');
  });
  it.each(DANGEROUS)('records nothing for %j', (u) => {
    expect(usageDomain(u)).toBeNull();
  });
});

describe('normalizeDomain (blocklist input)', () => {
  it('extracts the host from URLs and strips www', () => {
    expect(normalizeDomain('https://www.YouTube.com/feed?x=1')).toBe('youtube.com');
    expect(normalizeDomain('bücher.example')).toBe('xn--bcher-kva.example');
  });
  it.each(['', ' ', 'com', 'localhost', '127.0.0.1', 'javascript:alert(1)', 'chrome://settings', 'a b.com', '*.example.com', 'example.com.'])('rejects %j', (d) => {
    expect(normalizeDomain(d)).toBeNull();
  });
  // Regression for security finding #5: malformed hosts would make updateDynamicRules() reject atomically.
  it.each(['..com', 'a..b.com', '-foo.com', 'foo-.com'])('rejects malformed hostname %j', (d) => {
    expect(normalizeDomain(d)).toBeNull();
  });
});
