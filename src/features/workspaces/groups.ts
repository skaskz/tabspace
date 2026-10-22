import type { GroupColor, SavedTab, WorkspaceGroupLink } from '@/types/models';
import { GROUP_COLORS } from '@/features/tabs/serialize';
import { normalizeForMatch } from '@/features/tabs/manager';
import { isRestorableUrl } from '@/utils/url';

/**
 * Pure logic for "each workspace is its own native Chrome tab group" (V2.2).
 * Chrome runtime IDs only live until a restart, so links are re-established by
 * group title (= workspace name), never by guessing from URLs alone — that way a
 * user's own, non-workspace groups are never adopted or modified.
 */

const PALETTE: GroupColor[] = GROUP_COLORS.filter((c) => c !== 'grey');

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A stable colour for a workspace, preferring one no other workspace group uses yet. */
export function pickGroupColor(workspaceId: string, links: WorkspaceGroupLink[]): GroupColor {
  const existing = links.find((l) => l.workspaceId === workspaceId);
  if (existing) return existing.color;
  const used = new Set(links.map((l) => l.color));
  const start = hash(workspaceId) % PALETTE.length;
  for (let i = 0; i < PALETTE.length; i++) {
    const c = PALETTE[(start + i) % PALETTE.length];
    if (!used.has(c)) return c;
  }
  return PALETTE[start];
}

export function sameTitle(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase() && !!(a ?? '').trim();
}

export interface LiveGroup {
  id: number;
  windowId: number;
  title?: string;
  /** URLs of the group's tabs. */
  urls: string[];
}

/**
 * Choose which live group belongs to a workspace after a restart: groups titled
 * like the workspace AND containing at least `minOverlap` of its saved URLs,
 * preferring the largest overlap. Groups already claimed are skipped. A title
 * alone is never enough — a user's own group may share the name.
 */
export function chooseGroupForWorkspace(name: string, saved: SavedTab[], groups: LiveGroup[], claimed: Set<number>, minOverlap = 1): LiveGroup | undefined {
  const savedUrls = new Set(saved.map((t) => normalizeForMatch(t.url)));
  let best: { g: LiveGroup; score: number } | undefined;
  for (const g of groups) {
    if (claimed.has(g.id) || !sameTitle(g.title, name)) continue;
    const score = g.urls.filter((u) => savedUrls.has(normalizeForMatch(u))).length;
    if (score < minOverlap) continue;
    if (!best || score > best.score) best = { g, score };
  }
  return best?.g;
}

/** Saved tabs (in order) whose URL isn't already open in the group — so reopening never duplicates. */
export function missingSavedTabs(saved: SavedTab[], openUrls: string[]): SavedTab[] {
  const open = new Map<string, number>();
  for (const u of openUrls) open.set(normalizeForMatch(u), (open.get(normalizeForMatch(u)) ?? 0) + 1);
  const out: SavedTab[] = [];
  for (const t of saved) {
    if (!isRestorableUrl(t.url)) continue;
    const k = normalizeForMatch(t.url);
    const n = open.get(k) ?? 0;
    if (n > 0) open.set(k, n - 1);
    else out.push(t);
  }
  return out;
}

/** Map open tabs to saved tabs by URL (each saved tab used once). Returns tabId -> savedTabId. */
export function matchTabsToSaved(tabs: { id?: number; url?: string; pendingUrl?: string }[], saved: SavedTab[]): Map<number, string> {
  const pool = new Map<string, string[]>();
  for (const s of saved) {
    const k = normalizeForMatch(s.url);
    pool.set(k, [...(pool.get(k) ?? []), s.id]);
  }
  const out = new Map<number, string>();
  for (const t of tabs) {
    if (t.id === undefined) continue;
    const list = pool.get(normalizeForMatch(t.url || t.pendingUrl || ''));
    const sid = list?.shift();
    if (sid) out.set(t.id, sid);
  }
  return out;
}

export function upsertLink(links: WorkspaceGroupLink[], next: WorkspaceGroupLink): WorkspaceGroupLink[] {
  return links.some((l) => l.workspaceId === next.workspaceId) ? links.map((l) => (l.workspaceId === next.workspaceId ? next : l)) : [...links, next];
}
