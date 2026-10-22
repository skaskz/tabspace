import { useEffect, useRef, useState } from 'react';

/**
 * Incremental list rendering without dependencies: render the first `step`
 * items, then grow by `step` whenever the sentinel scrolls near the viewport
 * (IntersectionObserver), with a "Show more" button as a keyboard/no-IO fallback.
 * The window resets to `step` whenever `resetKey` changes (new filter/folder).
 */
export function useIncremental<T>(items: T[], resetKey: string, step = 60) {
  const [state, setState] = useState({ key: resetKey, limit: step });
  // Reset during render (no extra commit) when the filter changes.
  const limit = state.key === resetKey ? state.limit : step;
  if (state.key !== resetKey) setState({ key: resetKey, limit: step });
  const visible = items.length > limit ? items.slice(0, limit) : items;
  const more = () => setState((s) => ({ key: resetKey, limit: (s.key === resetKey ? s.limit : step) + step }));
  return { visible, hasMore: items.length > limit, remaining: Math.max(0, items.length - limit), more };
}

/** Sentinel + "Show more" button placed after an incremental list. */
export function LoadMore({ hasMore, remaining, onMore, label = 'items' }: { hasMore: boolean; remaining: number; onMore: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onMore);
  cb.current = onMore;
  useEffect(() => {
    const el = ref.current;
    if (!hasMore || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && cb.current(), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, remaining]);
  if (!hasMore) return null;
  return (
    <div ref={ref} className="flex justify-center py-3">
      <button type="button" onClick={onMore} className="rounded-[var(--radius-ctl)] border border-line px-3 py-1.5 text-xs text-muted hover:border-line-strong hover:text-fg">
        Show more ({remaining} more {label})
      </button>
    </div>
  );
}
