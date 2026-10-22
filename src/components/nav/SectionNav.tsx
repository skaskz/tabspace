import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';

export interface SectionNavItem {
  id: string;
  label: string;
}

/**
 * Vertical in-page section index. The active item gets the silver `ts-active` treatment via a
 * single highlight pill that slides between items (motion tokens; instant under reduced motion,
 * which global.css enforces for every transition).
 */
export function SectionNav({ items, active, onSelect, label, hrefFor, className }: { items: SectionNavItem[]; active: string | null; onSelect: (id: string) => void; label: string; hrefFor: (id: string) => string; className?: string }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const el = active ? Array.from(list?.querySelectorAll<HTMLElement>('[data-section]') ?? []).find((n) => n.dataset.section === active) : null;
    if (!el) return setPill(null);
    setPill({ top: el.offsetTop, height: el.offsetHeight });
  }, [active, items]);

  return (
    <nav aria-label={label} className={className}>
      <ul ref={listRef} className="relative flex flex-col gap-0.5">
        {pill && (
          <li
            aria-hidden
            data-testid="section-nav-pill"
            className="ts-active pointer-events-none absolute inset-x-0 top-0 rounded-lg border"
            style={{
              height: pill.height,
              transform: `translateY(${pill.top}px)`,
              transition: 'transform var(--ts-dur-page, 200ms) var(--ts-ease, ease), height var(--ts-dur-page, 200ms) var(--ts-ease, ease)',
            }}
          />
        )}
        {items.map((s) => {
          const isActive = s.id === active;
          return (
            <li key={s.id} data-section={s.id} className="relative">
              <a
                href={hrefFor(s.id)}
                aria-current={isActive ? 'true' : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onSelect(s.id);
                }}
                className={cn(
                  'block rounded-lg border border-transparent px-3 py-2 text-[13.5px] transition-colors',
                  isActive ? 'font-medium text-fg' : 'text-muted hover:bg-glow hover:text-fg',
                )}
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
