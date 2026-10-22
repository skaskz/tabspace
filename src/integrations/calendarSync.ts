import { get, patch, update } from '@/storage/store';
import type { CalendarEvent, CalendarSource } from '@/types/models';
import { IcsError, parseIcs, type ParsedEvent } from '@/features/calendar/ics';
import { fetchFeedText, hasFeedPermission, releaseFeedPermission } from './ics/feed';
import { fetchGoogleEvents } from './google/client';
import { GoogleApiError } from './google/oauth';

/** Sync window shared by ICS and Google sources. */
export const SYNC_DAYS_BACK = 90;
export const SYNC_DAYS_AHEAD = 400;

/** Replace every event of `sourceId` with `events` (single serialised write). */
export async function replaceSourceEvents(sourceId: string, events: ParsedEvent[]): Promise<void> {
  const now = Date.now();
  await update('ts.events', (list) => {
    const prev = new Map(list.filter((e) => e.sourceId === sourceId).map((e) => [e.id, e]));
    const next: CalendarEvent[] = events.map((e) => ({ ...e, createdAt: prev.get(e.id)?.createdAt ?? now, updatedAt: now }));
    return [...list.filter((e) => e.sourceId !== sourceId), ...next];
  });
}

/** Remove a calendar source and all its events (and its host permission when unused). */
export async function removeSource(sourceId: string): Promise<void> {
  const sources = await get('ts.calendarSources');
  const source = sources.find((s) => s.id === sourceId);
  await update('ts.events', (list) => list.filter((e) => e.sourceId !== sourceId));
  await update('ts.calendarSources', (list) => list.filter((s) => s.id !== sourceId));
  if (source?.kind === 'ics-url' && source.url) {
    await releaseFeedPermission(
      source.url,
      sources.filter((s) => s.id !== sourceId && s.url).map((s) => s.url!),
    );
  }
}

export interface SyncOptions {
  /** Allow interactive prompts (Google sign-in). False in the service worker. */
  interactive?: boolean;
  now?: Date;
}

export interface SyncResult {
  ok: boolean;
  skipped?: boolean;
  count?: number;
  error?: string;
}

/** Sync one source. Errors are recorded on the source (`lastError`) and returned, never thrown. */
export async function syncSource(source: CalendarSource, opts: SyncOptions = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  try {
    let events: ParsedEvent[];
    if (source.kind === 'ics-url') {
      if (!source.url) return { ok: false, skipped: true };
      if (!(await hasFeedPermission(source.url))) {
        const error = 'Access to this feed’s website is not allowed. Use “Sync now” to grant it.';
        await patch('ts.calendarSources', source.id, { lastError: error });
        return { ok: false, skipped: true, error };
      }
      const text = await fetchFeedText(source.url);
      events = parseIcs(text, source.id, { now, daysBack: SYNC_DAYS_BACK, daysAhead: SYNC_DAYS_AHEAD }).events;
    } else if (source.kind === 'google') {
      if (!source.googleCalendarId) return { ok: false, skipped: true };
      const min = new Date(now.getTime() - SYNC_DAYS_BACK * 86_400_000);
      const max = new Date(now.getTime() + SYNC_DAYS_AHEAD * 86_400_000);
      events = await fetchGoogleEvents(source.googleCalendarId, source.id, min, max, { interactive: opts.interactive });
    } else {
      return { ok: true, skipped: true };
    }
    await replaceSourceEvents(source.id, events);
    await patch('ts.calendarSources', source.id, { lastSyncedAt: Date.now(), lastError: undefined });
    return { ok: true, count: events.length };
  } catch (e) {
    const offline = e instanceof GoogleApiError && e.kind === 'offline';
    const error = e instanceof IcsError || e instanceof GoogleApiError ? e.message : 'Sync failed.';
    // Being offline is transient: keep the previous error state rather than alarming the user.
    if (!offline) await patch('ts.calendarSources', source.id, { lastError: error });
    return { ok: false, error };
  }
}

/** Sync every enabled external source (used by the periodic alarm). Never prompts. */
export async function syncAllSources(opts: SyncOptions = {}): Promise<SyncResult[]> {
  const sources = await get('ts.calendarSources');
  const results: SyncResult[] = [];
  for (const s of sources) {
    if (!s.enabled || (s.kind !== 'ics-url' && s.kind !== 'google')) continue;
    results.push(await syncSource(s, { ...opts, interactive: false }));
  }
  return results;
}
