import type { GroupColor, SmartGroupRule } from '@/types/models';
import { TAB_GROUP_ID_NONE, tabUrl, type RuntimeGroup, type RuntimeTab } from './serialize';

/**
 * Smart grouping: user rules (case-insensitive substring of host+path or title)
 * plus opt-in built-in suggestions by domain. Nothing here touches Chrome —
 * it only proposes groups; applying them is always a user action (or the
 * opt-in `autoApply` setting).
 */

export interface BuiltInCategory {
  title: string;
  color: GroupColor;
  domains: string[];
}

export const BUILT_IN_CATEGORIES: BuiltInCategory[] = [
  {
    title: 'Development',
    color: 'blue',
    domains: ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'npmjs.com', 'developer.mozilla.org', 'developer.chrome.com', 'vercel.com', 'netlify.com', 'localhost', '127.0.0.1', 'codepen.io', 'codesandbox.io', 'replit.com'],
  },
  { title: 'AI', color: 'cyan', domains: ['claude.ai', 'chatgpt.com', 'chat.openai.com', 'gemini.google.com', 'perplexity.ai', 'huggingface.co'] },
  { title: 'Docs', color: 'yellow', domains: ['docs.google.com', 'drive.google.com', 'sheets.google.com', 'notion.so', 'notion.site', 'figma.com', 'dropbox.com', 'onedrive.live.com'] },
  { title: 'Communication', color: 'green', domains: ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'calendar.google.com', 'slack.com', 'discord.com', 'web.whatsapp.com', 'teams.microsoft.com'] },
  { title: 'Media', color: 'red', domains: ['youtube.com', 'studio.youtube.com', 'twitch.tv', 'netflix.com', 'open.spotify.com', 'vimeo.com', 'soundcloud.com'] },
  { title: 'Social', color: 'pink', domains: ['x.com', 'twitter.com', 'reddit.com', 'instagram.com', 'tiktok.com', 'facebook.com', 'threads.net', 'bsky.app'] },
  { title: 'Job Search', color: 'purple', domains: ['linkedin.com', 'indeed.com', 'glassdoor.com', 'wellfound.com', 'ziprecruiter.com'] },
  { title: 'Shopping', color: 'orange', domains: ['amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'aliexpress.com'] },
  { title: 'Games', color: 'grey', domains: ['roblox.com', 'create.roblox.com', 'store.steampowered.com', 'itch.io', 'epicgames.com'] },
];

function parse(url: string): { host: string; hostPath: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return { host, hostPath: (host + u.pathname).toLowerCase() };
  } catch {
    return null;
  }
}

export function domainMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase();
  return host === d || host.endsWith(`.${d}`);
}

/** First user rule matching the tab (rules are evaluated in order). */
export function matchRule(tab: { url: string; title?: string }, rules: SmartGroupRule[]): SmartGroupRule | undefined {
  const p = parse(tab.url);
  const title = (tab.title ?? '').toLowerCase();
  for (const r of rules) {
    const needle = r.pattern.trim().toLowerCase();
    if (!needle || !r.groupTitle.trim()) continue;
    if ((p && p.hostPath.includes(needle)) || title.includes(needle)) return r;
  }
  return undefined;
}

/** Built-in category for a URL, by domain. Most specific (longest) domain wins. */
export function matchBuiltIn(url: string): BuiltInCategory | undefined {
  const p = parse(url);
  if (!p) return undefined;
  let best: { cat: BuiltInCategory; len: number } | undefined;
  for (const cat of BUILT_IN_CATEGORIES) {
    for (const d of cat.domains) {
      if (domainMatches(p.host, d) && (!best || d.length > best.len)) best = { cat, len: d.length };
    }
  }
  return best?.cat;
}

export interface GroupSuggestion {
  /** Stable key for UI lists: lower-cased title. */
  key: string;
  title: string;
  color: GroupColor;
  tabIds: number[];
  source: 'rule' | 'builtin';
  /** An existing group in the window with the same title; tabs join it instead of creating a new group. */
  existingGroupId?: number;
}

export interface SuggestOptions {
  rules: SmartGroupRule[];
  includeBuiltIns: boolean;
  /** Built-in suggestions need at least this many tabs (default 2). User rules apply to a single tab. */
  minBuiltInTabs?: number;
}

/**
 * Propose groups for ungrouped, unpinned tabs. User rules take priority over
 * built-ins. Suggestions whose title matches an existing group merge into it.
 */
export function suggestGroups(tabs: RuntimeTab[], existingGroups: RuntimeGroup[], opts: SuggestOptions): GroupSuggestion[] {
  const minBuiltIn = opts.minBuiltInTabs ?? 2;
  const byKey = new Map<string, GroupSuggestion>();
  const order: string[] = [];
  const existing = new Map(existingGroups.filter((g) => g.title).map((g) => [g.title!.trim().toLowerCase(), g.id]));

  for (const t of [...tabs].sort((a, b) => a.index - b.index)) {
    if (t.id === undefined || t.pinned) continue;
    if (t.groupId !== undefined && t.groupId !== TAB_GROUP_ID_NONE) continue;
    const url = tabUrl(t);
    const rule = matchRule({ url, title: t.title }, opts.rules);
    let title: string | undefined;
    let color: GroupColor = 'grey';
    let source: GroupSuggestion['source'] = 'rule';
    if (rule) {
      title = rule.groupTitle.trim();
      color = rule.color;
    } else if (opts.includeBuiltIns) {
      const cat = matchBuiltIn(url);
      if (cat) {
        title = cat.title;
        color = cat.color;
        source = 'builtin';
      }
    }
    if (!title) continue;
    const key = title.toLowerCase();
    let s = byKey.get(key);
    if (!s) {
      s = { key, title, color, tabIds: [], source, existingGroupId: existing.get(key) };
      byKey.set(key, s);
      order.push(key);
    } else if (source === 'rule') {
      s.source = 'rule';
    }
    s.tabIds.push(t.id);
  }
  return order
    .map((k) => byKey.get(k)!)
    .filter((s) => s.source === 'rule' || s.existingGroupId !== undefined || s.tabIds.length >= minBuiltIn);
}
