import { useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { useGateTarget, VisibilityGateContext } from './gateContext';

/** Window event that closes every open bar menu/popover (page click, frame blur — BUG-BAR3). */
export const CLOSE_ALL_EVENT = 'tsbar:closeall';

/**
 * Dropdown used by the Tabspace Bar (folders, workspaces, overflow, options).
 * Rendered as a fixed panel under its trigger inside the bar's own document
 * (in the website iframe the frame grows while a menu is open). Keyboard:
 * Enter/Space/ArrowDown opens, Up/Down/Home/End move, Escape closes and
 * returns focus to the trigger.
 */
export function BarMenu({
  label,
  trigger,
  triggerClass,
  children,
  onOpenChange,
  align = 'left',
  width = 260,
}: {
  label: string;
  trigger: ReactNode;
  triggerClass?: string;
  children: (close: () => void) => ReactNode;
  onOpenChange?: (open: boolean) => void;
  align?: 'left' | 'right';
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useGateTarget(panel, open);
  // Inside the website frame: no fade-in and no backdrop blur — IntersectionObserver v2 treats animating or
  // filtered panels as not visible, and the clickjacking gate would then (correctly) refuse their clicks.
  const gated = !!useContext(VisibilityGateContext);

  const set = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  };
  const close = (refocus = true) => {
    set(false);
    if (refocus) btn.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const left = align === 'right' ? Math.max(8, r.right - width) : Math.min(r.left, vw - width - 8);
    setPos({ left: Math.max(8, left), top: r.bottom + 4 });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    const onCloseAll = () => close(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener(CLOSE_ALL_EVENT, onCloseAll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener(CLOSE_ALL_EVENT, onCloseAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onPanelKey = (e: KeyboardEvent) => {
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => items[(n + items.length) % items.length]?.focus();
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      go(i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      go(i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      go(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      go(items.length - 1);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        data-bar-item
        tabIndex={-1}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={triggerClass}
        onClick={() => set(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            set(true);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panel}
          role="menu"
          aria-label={label}
          onKeyDown={onPanelKey}
          className={cn('ts-card fixed z-50 overflow-y-auto p-1 shadow-2xl', !gated && 'ts-fade-in')}
          style={{ left: pos.left, top: pos.top, width, maxHeight: `calc(100vh - ${pos.top + 8}px)`, background: 'var(--ts-bg)', ...(gated ? { backdropFilter: 'none' } : null) }}
        >
          {children(() => close())}
        </div>
      )}
    </>
  );
}

/** A row inside a BarMenu. */
export function BarMenuItem({ children, onSelect, icon, trailing, className, title }: { children: ReactNode; onSelect: (e: React.MouseEvent | React.KeyboardEvent) => void; icon?: ReactNode; trailing?: ReactNode; className?: string; title?: string }) {
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      title={title}
      onClick={onSelect}
      onAuxClick={(e) => e.button === 1 && onSelect(e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(e);
        }
      }}
      className={cn('flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-fg outline-none select-none hover:bg-glow focus:bg-glow', className)}
    >
      {icon && <span className="flex w-4 shrink-0 justify-center text-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </div>
  );
}
