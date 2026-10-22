import type { FocusState, Settings } from '@/types/models';
import { normalizeDomain } from '@/utils/url';
import { countsAsFocus } from '@/features/focus/timer';

/**
 * Focus Mode website blocking (opt-in). Pure helpers used by the service
 * worker to build chrome.declarativeNetRequest dynamic rules.
 *
 * Rules use the `block` action, which the `declarativeNetRequest` permission
 * grants without host permissions (redirect rules would need host access and a
 * web-accessible page). Tabspace owns the dynamic-rule ID range
 * [RULE_ID_BASE, RULE_ID_BASE + MAX_BLOCK_RULES) and never touches other IDs.
 */

export const RULE_ID_BASE = 7_000;
export const MAX_BLOCK_RULES = 500;

export function isTabspaceRuleId(id: number): boolean {
  return id >= RULE_ID_BASE && id < RULE_ID_BASE + MAX_BLOCK_RULES;
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Strict DNS hostname check (rejects "..com", "a..b.com", "-foo.com", "foo-.com", over-long names). */
export function isValidHostname(host: string): boolean {
  if (!host || host.length > 253) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  return labels.every((l) => LABEL.test(l)) && /^[a-z]{2,63}$/.test(labels[labels.length - 1]);
}

/** Normalise one blocklist entry; null if it is not a valid domain. */
export function normalizeBlockDomain(input: string): string | null {
  const d = normalizeDomain(input);
  return d && isValidHostname(d) ? d : null;
}

/** Normalised, de-duplicated, sorted domain list (sorting keeps rule IDs stable for the same list). */
export function cleanBlocklist(list: string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const d = normalizeBlockDomain(raw);
    if (d) out.add(d);
  }
  return [...out].sort().slice(0, MAX_BLOCK_RULES);
}

/** Should site blocking be active right now? Only while a focus/custom session is *running*. */
export function shouldBlock(settings: Pick<Settings, 'focus'>, focus: FocusState, now = Date.now()): boolean {
  if (!settings.focus.blockSites) return false;
  if (focus.status !== 'running' || !countsAsFocus(focus.kind)) return false;
  return !focus.endAt || focus.endAt > now;
}

export interface BlockRule {
  id: number;
  priority: number;
  action: { type: 'block' };
  condition: { requestDomains: string[]; resourceTypes: ['main_frame'] };
}

/** One main-frame block rule per domain. `requestDomains` also matches subdomains. */
export function buildBlockRules(domains: string[]): BlockRule[] {
  return cleanBlocklist(domains).map((domain, i) => ({
    id: RULE_ID_BASE + i,
    priority: 1,
    action: { type: 'block' },
    condition: { requestDomains: [domain], resourceTypes: ['main_frame'] },
  }));
}

/** Rules that should exist given settings + timer state (empty = remove all Tabspace rules). */
export function desiredRules(settings: Pick<Settings, 'focus'>, focus: FocusState, now = Date.now()): BlockRule[] {
  return shouldBlock(settings, focus, now) ? buildBlockRules(settings.focus.blocklist) : [];
}

/** Does the URL's host equal, or sit under, one of the blocked domains? */
export function matchBlockedDomain(url: string | undefined, domains: string[]): string | null {
  if (!url) return null;
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const d of cleanBlocklist(domains)) if (host === d || host.endsWith(`.${d}`)) return d;
  return null;
}

/** Compare two rule sets by content (used to skip redundant updateDynamicRules calls). */
export function sameRules(a: { id: number; condition: { requestDomains?: string[] } }[], b: BlockRule[]): boolean {
  if (a.length !== b.length) return false;
  const key = (r: { id: number; condition: { requestDomains?: string[] } }) => `${r.id}:${(r.condition.requestDomains ?? []).join(',')}`;
  const as = a.map(key).sort();
  const bs = b.map(key).sort();
  return as.every((k, i) => k === bs[i]);
}
