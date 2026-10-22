import type { Settings, SmartGroupRule } from '@/types/models';
import { isGroupColor } from './serialize';

/** Validation + normalisation for smart-grouping rules (pure). */

export const RULE_MAX_LENGTH = 100;

export interface RuleErrors {
  pattern?: string;
  groupTitle?: string;
}

/** Errors keyed by rule id; an empty object means every rule is valid. */
export function validateRules(rules: SmartGroupRule[]): Record<string, RuleErrors> {
  const out: Record<string, RuleErrors> = {};
  const seen = new Set<string>();
  for (const r of rules) {
    const e: RuleErrors = {};
    const pattern = r.pattern.trim();
    const title = r.groupTitle.trim();
    if (!pattern) e.pattern = 'Enter text to match.';
    else if (pattern.length > RULE_MAX_LENGTH) e.pattern = `Keep it under ${RULE_MAX_LENGTH} characters.`;
    else if (seen.has(pattern.toLowerCase())) e.pattern = 'Another rule already uses this pattern.';
    if (pattern) seen.add(pattern.toLowerCase());
    if (!title) e.groupTitle = 'Enter a group name.';
    else if (title.length > RULE_MAX_LENGTH) e.groupTitle = `Keep it under ${RULE_MAX_LENGTH} characters.`;
    if (e.pattern || e.groupTitle) out[r.id] = e;
  }
  return out;
}

export function normalizeRules(rules: SmartGroupRule[]): SmartGroupRule[] {
  return rules.map((r) => ({ id: r.id, pattern: r.pattern.trim(), groupTitle: r.groupTitle.trim(), color: isGroupColor(r.color) ? r.color : 'grey' }));
}

/** Next smartGrouping settings. autoApply is only kept when grouping is enabled and there are rules. */
export function nextSmartGrouping(draft: { enabled: boolean; autoApply: boolean; rules: SmartGroupRule[] }): Settings['smartGrouping'] {
  const rules = normalizeRules(draft.rules);
  return { enabled: draft.enabled, autoApply: draft.enabled && draft.autoApply && rules.length > 0, rules };
}
