/**
 * Clickjacking guard for the website bar (security review V21-2).
 *
 * IntersectionObserver v2 (`trackVisibility`) reports `isVisible === true` only
 * when the target is unoccluded and not made transparent / filtered /
 * transformed by any ancestor — including the embedding page. While the bar
 * (or the open menu / bookmark panel) isn't verifiably visible, clicks inside it
 * are swallowed. Browsers without v2 support: allowed (feature-detected).
 */

type VisEntry = IntersectionObserverEntry & { isVisible?: boolean };
type V2Init = IntersectionObserverInit & { trackVisibility: boolean; delay: number };

export function visibilityV2Supported(): boolean {
  return typeof IntersectionObserver !== 'undefined' && typeof IntersectionObserverEntry !== 'undefined' && 'isVisible' in IntersectionObserverEntry.prototype;
}

/** Panels opened less than this long ago fall back to the bar strip's state (the observer reports after ≥100 ms). */
export const FRESH_MS = 400;

export interface VisibilityGate {
  observe(el: Element): () => void;
  /** Should a click on `target` be allowed? */
  allows(target: Element | null, now?: number): boolean;
  disconnect(): void;
}

export function createVisibilityGate(root: () => Element | null, supported = visibilityV2Supported(), make?: (cb: IntersectionObserverCallback, init: V2Init) => IntersectionObserver): VisibilityGate {
  const state = new Map<Element, { visible: boolean | null; since: number }>();
  let io: IntersectionObserver | null = null;
  if (supported) {
    const cb: IntersectionObserverCallback = (entries) => {
      for (const e of entries as VisEntry[]) {
        const s = state.get(e.target);
        if (s) s.visible = e.isVisible === true;
      }
    };
    const init: V2Init = { trackVisibility: true, delay: 100, threshold: [0, 1] };
    io = make ? make(cb, init) : new IntersectionObserver(cb, init);
  }
  return {
    observe(el) {
      if (!io) return () => undefined;
      state.set(el, { visible: null, since: performance.now() });
      io.observe(el);
      return () => {
        io?.unobserve(el);
        state.delete(el);
      };
    },
    allows(target, now = performance.now()) {
      if (!io) return true;
      const r = root();
      // Innermost observed container (menu / popover panel), else the bar strip.
      let el: Element | null = target;
      while (el && !state.has(el)) el = el.parentElement;
      const own = el ? state.get(el) : undefined;
      const young = !!own && now - own.since <= FRESH_MS;
      if (own && own.visible === true) return true;
      if (own && !young) return own.visible === true; // a panel that has been open a while must itself be visible
      // Panel just opened (the observer reports after ≥100 ms): fall back to the bar strip's state.
      const bar = r ? state.get(r) : undefined;
      // No grace period before the first report: a page could otherwise remove the bar (it re-inserts once) to get a
      // fresh unprotected window. Chrome's first report arrives ~100 ms after load, so real clicks are unaffected.
      return bar?.visible === true;
    },
    disconnect() {
      io?.disconnect();
      state.clear();
    },
  };
}
