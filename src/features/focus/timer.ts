import type { FocusKind, FocusSessionRecord, FocusState, Settings } from '@/types/models';

/**
 * Pure focus-timer state machine. Remaining time is always derived from a
 * persisted absolute `endAt` timestamp, so the timer stays correct across
 * page reloads, view changes and MV3 service-worker suspension.
 */

export function durationFor(kind: FocusKind, s: Settings['focus']): number {
  const min = kind === 'focus' ? s.focusMin : kind === 'short' ? s.shortMin : kind === 'long' ? s.longMin : s.customMin;
  return clampMinutes(min) * 60_000;
}

export function clampMinutes(min: number): number {
  if (!Number.isFinite(min)) return 25;
  return Math.min(240, Math.max(1, Math.round(min)));
}

export function remainingMs(state: FocusState, now = Date.now()): number {
  if (state.status === 'running' && state.endAt) return Math.max(0, state.endAt - now);
  if (state.status === 'paused') return Math.max(0, state.remainingMs ?? state.durationMs);
  return state.durationMs;
}

export function progress(state: FocusState, now = Date.now()): number {
  if (state.durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remainingMs(state, now) / state.durationMs));
}

export function start(kind: FocusKind, durationMs: number, now = Date.now()): FocusState {
  return { status: 'running', kind, durationMs, startedAt: now, endAt: now + durationMs };
}

export function pause(state: FocusState, now = Date.now()): FocusState {
  if (state.status !== 'running') return state;
  return { ...state, status: 'paused', remainingMs: remainingMs(state, now), endAt: undefined };
}

export function resume(state: FocusState, now = Date.now()): FocusState {
  if (state.status !== 'paused') return state;
  const rem = state.remainingMs ?? state.durationMs;
  return { ...state, status: 'running', endAt: now + rem, remainingMs: undefined };
}

export function reset(state: FocusState): FocusState {
  return { status: 'idle', kind: state.kind, durationMs: state.durationMs };
}

export function select(kind: FocusKind, durationMs: number): FocusState {
  return { status: 'idle', kind, durationMs };
}

export function isFinished(state: FocusState, now = Date.now()): boolean {
  return state.status === 'running' && !!state.endAt && state.endAt <= now;
}

/** Build the history record for a session that ended (completed or stopped early). */
export function toRecord(state: FocusState, now: number, completed: boolean, id: string): FocusSessionRecord | null {
  if (state.status === 'idle' || state.startedAt === undefined) return null;
  const actualMs = completed ? state.durationMs : state.durationMs - remainingMs(state, now);
  if (actualMs < 60_000 && !completed) return null; // ignore accidental starts under a minute
  return {
    id,
    createdAt: now,
    updatedAt: now,
    kind: state.kind,
    startedAt: state.startedAt,
    endedAt: now,
    plannedMs: state.durationMs,
    actualMs: Math.max(0, actualMs),
    completed,
  };
}

/** Compact toolbar-badge text. Badges fit ~4 characters, so show minutes ("24m") rather than MM:SS. */
export function badgeText(state: FocusState, now = Date.now()): string {
  if (state.status === 'idle') return '';
  const min = Math.ceil(remainingMs(state, now) / 60_000);
  if (state.status === 'paused') return '❚❚';
  return `${min}m`;
}

/* ------------------------------------------------------------------ */
/* Extensions (Chrome Extension agent A)                               */
/* ------------------------------------------------------------------ */

/** Only focus and custom sessions count towards focus history/stats; breaks do not. */
export function countsAsFocus(kind: FocusKind): boolean {
  return kind === 'focus' || kind === 'custom';
}

export function kindLabel(kind: FocusKind): string {
  return kind === 'short' ? 'Short Break' : kind === 'long' ? 'Long Break' : kind === 'custom' ? 'Custom' : 'Focus';
}

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Toolbar tooltip, e.g. "Tabspace — Focus 24:00 left". */
export function badgeTitle(state: FocusState, now = Date.now()): string {
  if (state.status === 'idle') return 'Tabspace';
  const label = kindLabel(state.kind);
  const left = clock(remainingMs(state, now));
  return state.status === 'paused' ? `Tabspace — ${label} paused (${left} left)` : `Tabspace — ${label} ${left} left`;
}

/**
 * Next moment the minute-badge text changes (when the ceil'd minute count drops),
 * so the badge tick alarm can be aligned instead of drifting.
 */
export function nextBadgeChangeAt(state: FocusState, now = Date.now()): number | null {
  if (state.status !== 'running' || !state.endAt) return null;
  const rem = state.endAt - now;
  if (rem <= 0) return null;
  const mins = Math.ceil(rem / 60_000);
  return state.endAt - (mins - 1) * 60_000;
}

/**
 * Completion step used by the service worker. Returns null (no-op) unless the
 * session is still running and has actually finished — so repeated alarm
 * deliveries or a worker restart can never double-record a session.
 */
export function completeIfFinished(state: FocusState, now: number, id: string): { next: FocusState; record: FocusSessionRecord | null } | null {
  if (!isFinished(state, now) || !state.endAt) return null;
  const rec = toRecord(state, state.endAt, true, id);
  return { next: { ...reset(state), completed: { kind: state.kind, at: state.endAt } }, record: rec && countsAsFocus(state.kind) ? rec : null };
}

/* ------------------------------------------------------------------ */
/* V2: completion state                                                 */
/* ------------------------------------------------------------------ */

/** How long surfaces show "Session complete" after a session ends. */
export const COMPLETION_VISIBLE_MS = 60_000;

/** The just-finished session, while its completion state should still be shown. */
export function recentCompletion(state: FocusState, now = Date.now()): { kind: FocusKind; at: number } | null {
  if (state.status !== 'idle' || !state.completed) return null;
  const age = now - state.completed.at;
  return age >= 0 && age < COMPLETION_VISIBLE_MS ? state.completed : null;
}

/** Suggested next session: a break after focus (a long one every 4th completed session today), focus after a break. */
export function nextKindAfter(kind: FocusKind, completedToday: number): FocusKind {
  if (kind === 'short' || kind === 'long') return 'focus';
  return completedToday > 0 && completedToday % 4 === 0 ? 'long' : 'short';
}
