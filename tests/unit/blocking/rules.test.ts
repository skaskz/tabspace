import { describe, expect, it } from 'vitest';
import { MAX_BLOCK_RULES, RULE_ID_BASE, buildBlockRules, cleanBlocklist, desiredRules, isTabspaceRuleId, matchBlockedDomain, sameRules, shouldBlock } from '@/features/blocking/rules';
import * as timer from '@/features/focus/timer';
import { DEFAULT_SETTINGS } from '@/storage/schema';
import type { Settings } from '@/types/models';

const MIN = 60_000;
const withFocus = (f: Partial<Settings['focus']>): Settings => ({ ...DEFAULT_SETTINGS, focus: { ...DEFAULT_SETTINGS.focus, ...f } });

describe('buildBlockRules', () => {
  it('builds one main_frame block rule per domain with stable ids', () => {
    const rules = buildBlockRules(['youtube.com', 'reddit.com']);
    expect(rules).toEqual([
      { id: RULE_ID_BASE, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['reddit.com'], resourceTypes: ['main_frame'] } },
      { id: RULE_ID_BASE + 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['youtube.com'], resourceTypes: ['main_frame'] } },
    ]);
    // Same list in any order / casing / as URLs / duplicated -> identical rules.
    expect(buildBlockRules(['https://www.YouTube.com/feed', 'reddit.com', 'reddit.com'])).toEqual(rules);
  });

  it('drops invalid entries and caps the count', () => {
    expect(cleanBlocklist(['', 'not a domain', 'localhost', 'x.com'])).toEqual(['x.com']);
    const many = Array.from({ length: MAX_BLOCK_RULES + 20 }, (_, i) => `site${i}.com`);
    const rules = buildBlockRules(many);
    expect(rules).toHaveLength(MAX_BLOCK_RULES);
    expect(rules.every((r) => isTabspaceRuleId(r.id))).toBe(true);
  });

  it('owns only its id range', () => {
    expect(isTabspaceRuleId(RULE_ID_BASE - 1)).toBe(false);
    expect(isTabspaceRuleId(RULE_ID_BASE + MAX_BLOCK_RULES)).toBe(false);
    expect(isTabspaceRuleId(1)).toBe(false);
  });
});

describe('shouldBlock / desiredRules', () => {
  const running = timer.start('focus', 25 * MIN, 0);
  it('blocks only while opted in and a focus/custom session is running', () => {
    expect(shouldBlock(withFocus({ blockSites: true }), running, MIN)).toBe(true);
    expect(shouldBlock(withFocus({ blockSites: true }), timer.start('custom', 5 * MIN, 0), MIN)).toBe(true);
    expect(shouldBlock(withFocus({ blockSites: false }), running, MIN)).toBe(false);
    expect(shouldBlock(withFocus({ blockSites: true }), timer.pause(running, MIN), MIN)).toBe(false);
    expect(shouldBlock(withFocus({ blockSites: true }), timer.reset(running), MIN)).toBe(false);
    expect(shouldBlock(withFocus({ blockSites: true }), timer.start('short', 5 * MIN, 0), MIN)).toBe(false);
    expect(shouldBlock(withFocus({ blockSites: true }), running, 26 * MIN)).toBe(false);
  });

  it('returns no rules (=> remove all Tabspace rules) when blocking is off', () => {
    expect(desiredRules(withFocus({ blockSites: true, blocklist: ['x.com'] }), running, MIN)).toHaveLength(1);
    expect(desiredRules(withFocus({ blockSites: false, blocklist: ['x.com'] }), running, MIN)).toEqual([]);
    expect(desiredRules(withFocus({ blockSites: true, blocklist: ['x.com'] }), timer.pause(running, MIN), MIN)).toEqual([]);
  });
});

describe('matchBlockedDomain', () => {
  it('matches the domain and its subdomains only, http(s) only', () => {
    const list = ['youtube.com'];
    expect(matchBlockedDomain('https://www.youtube.com/watch?v=1', list)).toBe('youtube.com');
    expect(matchBlockedDomain('https://m.youtube.com/', list)).toBe('youtube.com');
    expect(matchBlockedDomain('https://notyoutube.com/', list)).toBeNull();
    expect(matchBlockedDomain('chrome://newtab', list)).toBeNull();
    expect(matchBlockedDomain(undefined, list)).toBeNull();
  });
});

describe('sameRules', () => {
  it('detects whether an update is needed', () => {
    const want = buildBlockRules(['a.com', 'b.com']);
    expect(sameRules(want, want)).toBe(true);
    expect(sameRules([], buildBlockRules([]))).toBe(true);
    expect(sameRules(want.slice(0, 1), want)).toBe(false);
    expect(sameRules(buildBlockRules(['a.com', 'c.com']), want)).toBe(false);
  });
});

describe('strict hostname validation', () => {
  it('rejects malformed hosts Chrome could refuse (so one bad entry never reaches DNR)', async () => {
    const { isValidHostname, normalizeBlockDomain } = await import('@/features/blocking/rules');
    const bad = ['..com', 'a..b.com', '-foo.com', 'foo-.com', 'com', 'a'.repeat(64) + '.com', 'a.'.repeat(130) + 'com'];
    for (const b of bad) expect(isValidHostname(b)).toBe(false);
    for (const g of ['youtube.com', 'news.ycombinator.com', 'x.com', 'my-site.co.uk', 'xn--bcher-kva.example']) expect(isValidHostname(g)).toBe(true);
    expect(normalizeBlockDomain('https://www.YouTube.com/feed')).toBe('youtube.com');
    expect(normalizeBlockDomain('-foo.com')).toBeNull();
    expect(cleanBlocklist(['a..b.com', 'ok.com'])).toEqual(['ok.com']);
  });
});
