import { desiredRules, isTabspaceRuleId, matchBlockedDomain, sameRules, shouldBlock, type BlockRule } from '@/features/blocking/rules';
import { readFocus, readSettings } from './state';

/**
 * Focus Mode site blocking. Rules exist only while a focus/custom session is
 * running AND settings.focus.blockSites is on AND the declarativeNetRequest
 * permission is present (treated as "blocking off" when missing). In every other state all
 * Tabspace rules are removed (or cannot exist), so blocking is fully reversible.
 */

type Dnr = typeof chrome.declarativeNetRequest;

/** The DNR API if the optional permission is granted; null means "blocking off". */
async function dnrApi(): Promise<Dnr | null> {
  const dnr = typeof chrome !== 'undefined' ? chrome.declarativeNetRequest : undefined;
  if (!dnr?.updateDynamicRules) return null;
  try {
    if (chrome.permissions?.contains && !(await chrome.permissions.contains({ permissions: ['declarativeNetRequest'] } as chrome.permissions.Permissions))) return null;
  } catch {
    return null;
  }
  return dnr;
}

const asRules = (r: BlockRule[]) => r as unknown as chrome.declarativeNetRequest.Rule[];

export async function syncBlocking(now = Date.now()): Promise<void> {
  const dnr = await dnrApi();
  if (!dnr) return;
  const [settings, focus] = await Promise.all([readSettings(), readFocus()]);
  const want = desiredRules(settings, focus, now);
  const existing = (await dnr.getDynamicRules()).filter((r) => isTabspaceRuleId(r.id));
  if (sameRules(existing, want)) return;
  const removeRuleIds = existing.map((r) => r.id);
  try {
    // Atomic: removals then additions, all-or-nothing.
    await dnr.updateDynamicRules({ removeRuleIds, addRules: asRules(want) });
    return;
  } catch (e) {
    console.warn('[Tabspace] blocking rules rejected as a batch; retrying one at a time', e);
  }
  // Fallback so one bad domain can't disable all blocking: clear ours, then add each rule separately.
  await dnr.updateDynamicRules({ removeRuleIds }).catch((e) => console.warn('[Tabspace] could not remove blocking rules', e));
  for (const rule of want) {
    try {
      await dnr.updateDynamicRules({ addRules: asRules([rule]) });
    } catch (e) {
      console.warn(`[Tabspace] could not block ${rule.condition.requestDomains.join(', ')}`, e);
    }
  }
}

/**
 * The block rule leaves Chrome's generic "blocked" error page. When a tab
 * navigates to a blocked site we replace it with the Focus page, which explains
 * why (no extra HTML entry or host permission needed). Without the permission
 * blocking is off, so nothing is redirected either.
 */
export async function explainBlockedTab(tabId: number, url: string | undefined): Promise<void> {
  if (!url) return;
  const [settings, focus] = await Promise.all([readSettings(), readFocus()]);
  if (!shouldBlock(settings, focus)) return;
  const domain = matchBlockedDomain(url, settings.focus.blocklist);
  if (!domain || !(await dnrApi())) return;
  try {
    await chrome.tabs.update(tabId, { url: `${chrome.runtime.getURL('dashboard.html')}#/focus?blocked=${encodeURIComponent(domain)}` });
  } catch {
    /* tab closed meanwhile */
  }
}
