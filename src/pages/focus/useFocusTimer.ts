import { useSettings, useStore } from '@/hooks/useStore';
import { useNow } from '@/hooks/useNow';
import { durationFor, kindLabel, nextKindAfter, recentCompletion, remainingMs } from '@/features/focus/timer';
import { sessionsOn } from '@/features/focus/stats';
import { formatClock, toDateKey } from '@/utils/date';
import { pauseFocus, resetFocus, resumeFocus, startFocus, stopFocus } from '@/services/focus';
import { update } from '@/storage/store';
import type { FocusKind, Settings } from '@/types/models';

/**
 * Live view of the shared focus timer for any surface (Focus page, sidebar,
 * popup). Remaining time is always derived from the stored absolute endAt.
 * Closing a surface never affects the timer: state lives in storage and the
 * service worker's alarms drive completion.
 */
export function useFocusTimer() {
  const [focus] = useStore('ts.focus');
  const [settings] = useSettings();
  const [records] = useStore('ts.focusSessions');
  // Tick every second while running, and while a completion state may be showing (so it expires on time).
  const now = useNow(1000, focus.status === 'running' || (focus.status === 'idle' && !!focus.completed));
  // When idle, show the length the next session will actually have (settings may have changed).
  const total = focus.status === 'idle' ? durationFor(focus.kind, settings.focus) : focus.durationMs;
  const left = focus.status === 'idle' ? total : remainingMs(focus, now);
  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - left / total)) : 0;
  const done = recentCompletion(focus, now);
  const next: FocusKind | null = done ? nextKindAfter(done.kind, sessionsOn(records, toDateKey(now))) : null;
  return {
    focus,
    settings,
    total,
    left,
    progress: done ? 1 : focus.status === 'idle' ? 0 : progress,
    clock: done ? '00:00' : formatClock(left),
    active: focus.status !== 'idle',
    running: focus.status === 'running',
    /** The session that just ended (shown for a minute), with the suggested next session. */
    completion: done && next ? { kind: done.kind, next, nextLabel: next === 'focus' ? 'Start focus' : `Start ${kindLabel(next).toLowerCase()}` } : null,
    startNext: () => (next ? startFocus(next) : startFocus(focus.kind)),
    startAgain: () => startFocus(done?.kind ?? focus.kind),
    toggle: () => {
      if (focus.status === 'running') return pauseFocus();
      if (focus.status === 'paused') return resumeFocus();
      return startFocus(focus.kind);
    },
    stop: () => stopFocus(),
    reset: () => resetFocus(),
  };
}

/** Atomic settings edit (re-reads storage first so concurrent edits on other pages survive). */
export function patchSettings(fn: (s: Settings) => Settings): Promise<Settings> {
  return update('ts.settings', fn);
}
