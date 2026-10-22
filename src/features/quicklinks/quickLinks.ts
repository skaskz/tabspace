import { newId, update } from '@/storage/store';
import type { QuickLink } from '@/types/models';
import { hostname, normalizeUrl } from '@/utils/url';

/** Quick Links (dashboard sidebar tiles). Pure list helpers + store actions. */

export function sortLinks(links: QuickLink[]): QuickLink[] {
  return [...links].sort((a, b) => a.order - b.order);
}

/** Validate a title/URL pair. Returns the normalised link fields or an error message. */
export function validateLink(title: string, url: string): { title: string; url: string } | { error: string } {
  const normalized = normalizeUrl(url);
  if (!normalized) return { error: 'Enter a valid http(s) web address.' };
  return { title: title.trim() || hostname(normalized) || normalized, url: normalized };
}

/** Move a link one step up/down and renumber orders 0..n-1. */
export function moveLink(links: QuickLink[], id: string, dir: -1 | 1): QuickLink[] {
  const sorted = sortLinks(links);
  const i = sorted.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return sorted.map((l, k) => ({ ...l, order: k }));
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  return sorted.map((l, k) => ({ ...l, order: k }));
}

export function addQuickLink(title: string, url: string): Promise<QuickLink[]> {
  return update('ts.quickLinks', (list) => [...list, { id: newId(), title, url, order: list.reduce((m, l) => Math.max(m, l.order), -1) + 1 }]);
}

export function editQuickLink(id: string, title: string, url: string): Promise<QuickLink[]> {
  return update('ts.quickLinks', (list) => list.map((l) => (l.id === id ? { ...l, title, url } : l)));
}

export function removeQuickLink(id: string): Promise<QuickLink[]> {
  return update('ts.quickLinks', (list) => list.filter((l) => l.id !== id));
}

export function reorderQuickLink(id: string, dir: -1 | 1): Promise<QuickLink[]> {
  return update('ts.quickLinks', (list) => moveLink(list, id, dir));
}
