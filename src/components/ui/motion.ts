/**
 * Tabspace motion helpers (CSS does the animating; these only coordinate mount/unmount).
 *
 * Tokens + keyframes live in `src/styles/global.css` (`--ts-dur-*`, `--ts-ease`, `.ts-*-in` / `.ts-*-out`).
 * Exit animations are named `ts-…-out` so `waitForExit` can find them with `getAnimations()`.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Motion durations in ms — mirror the CSS tokens. */
export const MOTION = { hover: 180, dropdown: 150, dialog: 240, page: 200, toast: 200 } as const;

/** True when the OS asks for reduced motion or the in-app setting is on (`<html data-motion="reduced">`). */
export function motionReduced(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.dataset.motion === 'reduced') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isExitAnimation(a: Animation): boolean {
  const name = (a as CSSAnimation).animationName;
  return typeof name === 'string' && name.startsWith('ts-') && name.endsWith('-out');
}

/**
 * Resolve when the `ts-*-out` CSS animations running on `node` (or its subtree) finish.
 * Resolves immediately under reduced motion, when the browser has no Web Animations API (jsdom),
 * or when no exit animation is running. A safety timeout guarantees it never hangs.
 * Returns a cancel function.
 */
export function waitForExit(node: Element | null, done: () => void, timeoutMs = 600): () => void {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    done();
  };
  let timer = 0;
  const anims = node && !motionReduced() && typeof node.getAnimations === 'function' ? node.getAnimations({ subtree: true }).filter(isExitAnimation) : [];
  if (!anims.length) {
    finish();
    return () => undefined;
  }
  timer = window.setTimeout(finish, timeoutMs);
  void Promise.all(anims.map((a) => a.finished)).then(finish, finish);
  return () => {
    settled = true;
    window.clearTimeout(timer);
  };
}

export type PresenceState = 'open' | 'closing' | 'unmounted';

/**
 * Mount/unmount state machine for overlays: open → closing → unmounted.
 * While `closing`, the caller renders its exit class (`ts-…-out`); once the exit animation ends
 * the element unmounts. Reopening mid-exit jumps straight back to `open`.
 * Under reduced motion (or without exit animations) `closing` lasts zero frames.
 */
export function usePresence(open: boolean, ref: RefObject<Element | null>): PresenceState {
  const [state, setState] = useState<PresenceState>(open ? 'open' : 'unmounted');
  // Derived-state updates during render (React's recommended pattern; no extra effect pass).
  if (open && state !== 'open') setState('open');
  if (!open && state === 'open') setState('closing');
  const stateRef = useRef(state);
  stateRef.current = state;
  useLayoutEffect(() => {
    if (state !== 'closing') return;
    return waitForExit(ref.current, () => {
      if (stateRef.current === 'closing') setState('unmounted');
    });
  }, [state, ref]);
  return state;
}
