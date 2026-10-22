import { describe, expect, it } from 'vitest';
import { buildBlockRules, cleanBlocklist, desiredRules, isTabspaceRuleId, matchBlockedDomain, MAX_BLOCK_RULES, RULE_ID_BASE } from '@/features/blocking/rules';
import { DEFAULT_SETTINGS } from '@/storage/schema';
import type { FocusState, Settings } from '@/types/models';

const settings = (blocklist: string[], blockSites = true): Pick<Settings, 'focus'> => ({ focus: { ...DEFAULT_SETTINGS.focus, blockSites, blocklist } });
const running: FocusState = { status: 'running', kind: 'focus', durationMs: 25 * 60_000, endAt: Date.now() + 60_000 } as FocusState;

describe('declarativeNetRequest rule builder', () => {
  it('only emits block rules for main frames, inside Tabspace’s own ID range', () => {
    const rules = buildBlockRules(['youtube.com', 'https://www.reddit.com/r/x', 'X.COM']);
    for (const r of rules) {
      expect(isTabspaceRuleId(r.id)).toBe(true);
      expect(r.action).toEqual({ type: 'block' });
      expect(r.condition.resourceTypes).toEqual(['main_frame']);
      expect(r.condition.requestDomains).toHaveLength(1);
    }
    expect(rules.map((r) => r.condition.requestDomains[0])).toEqual(['reddit.com', 'x.com', 'youtube.com']);
  });

  it('never claims IDs outside its range, even with a huge list', () => {
    const many = Array.from({ length: 2000 }, (_, i) => `site${i}.example`);
    const rules = buildBlockRules(many);
    expect(rules.length).toBe(MAX_BLOCK_RULES);
    expect(Math.min(...rules.map((r) => r.id))).toBe(RULE_ID_BASE);
    expect(Math.max(...rules.map((r) => r.id))).toBe(RULE_ID_BASE + MAX_BLOCK_RULES - 1);
    expect(isTabspaceRuleId(RULE_ID_BASE - 1)).toBe(false);
    expect(isTabspaceRuleId(RULE_ID_BASE + MAX_BLOCK_RULES)).toBe(false);
  });

  it.each(['*', '*.com', '<all_urls>', 'http://*/*', '', '   ', 'com', 'javascript:alert(1)', 'chrome://extensions', '127.0.0.1', 'localhost', 'a b.com', '\u0000evil.com', 'evil.com/../../', '"; DROP'])(
    'drops wildcard / scheme / garbage entry %j (cannot widen into "block everything")',
    (d) => {
      for (const host of cleanBlocklist([d])) expect(host).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      for (const r of buildBlockRules([d])) expect(r.condition.requestDomains[0]).not.toMatch(/[*<>/:\s]/);
    },
  );

  it('is fully reversible: no rules unless blocking is enabled and a focus session is running', () => {
    expect(desiredRules(settings(['youtube.com'], false), running)).toEqual([]);
    expect(desiredRules(settings(['youtube.com']), { ...running, status: 'idle' } as FocusState)).toEqual([]);
    expect(desiredRules(settings(['youtube.com']), { ...running, kind: 'short' } as FocusState)).toEqual([]);
    expect(desiredRules(settings(['youtube.com']), { ...running, endAt: Date.now() - 1 } as FocusState)).toEqual([]);
    expect(desiredRules(settings(['youtube.com']), running)).toHaveLength(1);
  });

  it('off by default', () => {
    expect(DEFAULT_SETTINGS.focus.blockSites).toBe(false);
    expect(DEFAULT_SETTINGS.analytics.trackWebsites).toBe(false);
  });

  it('matchBlockedDomain is suffix-safe (no "notyoutube.com" false positive) and ignores non-web URLs', () => {
    expect(matchBlockedDomain('https://m.youtube.com/watch', ['youtube.com'])).toBe('youtube.com');
    expect(matchBlockedDomain('https://notyoutube.com/', ['youtube.com'])).toBeNull();
    expect(matchBlockedDomain('https://youtube.com.evil.example/', ['youtube.com'])).toBeNull();
    expect(matchBlockedDomain('chrome-extension://abc/dashboard.html#youtube.com', ['youtube.com'])).toBeNull();
    expect(matchBlockedDomain('javascript:youtube.com', ['youtube.com'])).toBeNull();
  });
});
