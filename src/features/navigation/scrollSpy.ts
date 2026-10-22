import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Scroll-spy: which section of a long page is the reader in?
 *
 * IntersectionObserver callbacks (never a per-frame scroll handler) trigger a cheap recompute
 * from the sections' rects, and React state changes only when the active id changes.
 */

export interface SectionRect {
  id: string;
  top: number;
  bottom: number;
}

/**
 * Pure selection rule.
 * - Normal case: the last section whose top has passed the reading line (e.g. 30% down the viewport).
 * - Before the first section reaches the line: the first section.
 * - Scrolled to the very bottom: the last section that is visible, so short final sections
 *   (which can never reach the reading line) still become active.
 */
export function pickActiveSection(rects: SectionRect[], opts: { readingLine: number; viewportHeight: number; atBottom: boolean }): string | null {
  if (!rects.length) return null;
  if (opts.atBottom) {
    for (let i = rects.length - 1; i >= 0; i--) if (rects[i].top < opts.viewportHeight && rects[i].bottom > 0) return rects[i].id;
  }
  let active: string | null = null;
  for (const r of rects) {
    if (r.top <= opts.readingLine) active = r.id;
    else break;
  }
  return active ?? rects[0].id;
}

export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced') return true;
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export interface ScrollSpyOptions {
  /** Fraction of the viewport height used as the reading line (default 0.3). */
  readingLine?: number;
  /** Override the observer band; defaults to a 1px band at the reading line. */
  rootMargin?: string;
  /** Map a section id to its element (default: document.getElementById). */
  getElement?: (id: string) => HTMLElement | null;
  /** Observe only when true (e.g. after the sections have rendered). */
  enabled?: boolean;
}

export function useScrollSpy(sectionIds: string[], opts: ScrollSpyOptions = {}) {
  const { readingLine = 0.3, rootMargin, enabled = true } = opts;
  const getEl = useRef(opts.getElement ?? ((id: string) => document.getElementById(id)));
  getEl.current = opts.getElement ?? ((id: string) => document.getElementById(id));
  const [active, setActiveState] = useState<string | null>(sectionIds[0] ?? null);
  const lockUntil = useRef(0);
  const key = sectionIds.join('|');

  const recompute = useCallback(() => {
    if (Date.now() < lockUntil.current) return;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const rects: SectionRect[] = [];
    for (const id of key.split('|')) {
      const el = getEl.current(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      rects.push({ id, top: r.top, bottom: r.bottom });
    }
    const doc = document.scrollingElement ?? document.documentElement;
    const atBottom = window.scrollY + vh >= doc.scrollHeight - 2;
    const next = pickActiveSection(rects, { readingLine: vh * readingLine, viewportHeight: vh, atBottom });
    if (next) setActiveState((cur) => (cur === next ? cur : next));
  }, [key, readingLine]);

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return;
    const els = key
      .split('|')
      .map((id) => getEl.current(id))
      .filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const line = Math.round(readingLine * 100);
    // A thin band at the reading line fires whenever a section boundary crosses it…
    const band = new IntersectionObserver(recompute, { rootMargin: rootMargin ?? `-${line}% 0px -${99 - line}% 0px` });
    // …and plain visibility changes catch the bottom of the page (short last sections).
    const edges = new IntersectionObserver(recompute, { threshold: [0, 1] });
    els.forEach((e) => {
      band.observe(e);
      edges.observe(e);
    });
    recompute();
    return () => {
      band.disconnect();
      edges.disconnect();
    };
  }, [enabled, key, readingLine, rootMargin, recompute]);

  /** Mark a section active immediately (nav click) and ignore the spy while the smooth scroll runs. */
  const setActive = useCallback(
    (id: string, holdMs = 900) => {
      lockUntil.current = Date.now() + holdMs;
      setActiveState(id);
      const release = () => {
        lockUntil.current = 0;
        recompute();
      };
      if ('onscrollend' in window) window.addEventListener('scrollend', release, { once: true });
      window.setTimeout(release, holdMs + 50);
    },
    [recompute],
  );

  return { active, setActive };
}

/** Smooth-scroll to a section (instant under reduced motion) and move focus to its heading. */
export function goToSection(el: HTMLElement | null, focusTarget?: HTMLElement | null): void {
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  const target = focusTarget ?? el;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}
