/**
 * Tabspace UI primitives. Every page builds from these so cards, buttons,
 * inputs, menus and dialogs look and behave the same everywhere.
 */
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Globe, X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { faviconUrl, hostname } from '@/utils/url';
import { usePresence } from './motion';

export { MOTION, motionReduced, usePresence, waitForExit, type PresenceState } from './motion';

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-fg text-bg hover:opacity-90 border border-transparent',
  secondary: 'bg-surface-2 text-fg border border-line hover:border-line-strong hover:bg-surface-3',
  ghost: 'text-muted hover:text-fg hover:bg-glow border border-transparent',
  danger: 'bg-transparent text-danger border border-danger/40 hover:bg-danger/10',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'ts-press inline-flex items-center justify-center gap-2 rounded-[var(--radius-ctl)] font-medium disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        variantClass[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md' | 'lg';
}

/** Icon-only button. `label` is required: it becomes the accessible name and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'ts-press inline-flex items-center justify-center rounded-[var(--radius-ctl)] text-muted hover:text-fg hover:bg-glow disabled:opacity-40 disabled:pointer-events-none shrink-0',
        size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

/**
 * Surface card. Pass `interactive` for cards that are clickable/hoverable as a whole (tiles, list cards):
 * it adds `.ts-lift` — a subtle 2px lift, ≤1.01 scale, deeper shadow and silver border on hover
 * (no transform under reduced motion). Plain className="ts-lift" works on any element too.
 */
export function Card({ className, children, as: As = 'section', interactive, ...rest }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' | 'aside'; interactive?: boolean } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cn('ts-card', interactive && 'ts-lift', className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, icon, action, className }: { title: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-5 pt-4 pb-3', className)}>
      <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
        {icon && <span className="text-muted">{icon}</span>}
        {title}
      </h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumb }: { title: string; subtitle?: string; actions?: ReactNode; breadcrumb?: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 text-sm text-muted">{breadcrumb}</div>}
        <h1 className="text-[2.4rem] leading-tight font-bold tracking-[-0.03em]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-xs text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Tag({ children, className, onRemove }: { children: ReactNode; className?: string; onRemove?: () => void }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-md border border-line bg-surface-2 px-2 text-xs text-muted', className)}>
      {children}
      {onRemove && (
        <button type="button" aria-label={`Remove ${String(children)}`} onClick={onRemove} className="hover:text-fg">
          <X size={12} />
        </button>
      )}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{children}</kbd>;
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(function Input(
  { className, icon, ...rest },
  ref,
) {
  return (
    <div className={cn('relative flex items-center', className)}>
      {icon && <span className="pointer-events-none absolute left-3 text-faint">{icon}</span>}
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-[var(--radius-ctl)] border border-line bg-surface-2 px-3 text-sm text-fg placeholder:text-faint outline-none transition-colors focus:border-line-strong focus-visible:ring-2 focus-visible:ring-fg/50',
          icon ? 'pl-9' : undefined,
        )}
        {...rest}
      />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-[var(--radius-ctl)] border border-line bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:border-line-strong resize-none focus-visible:ring-2 focus-visible:ring-fg/50',
        className,
      )}
      {...rest}
    />
  );
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 rounded-[var(--radius-ctl)] border border-line bg-surface-2 px-2.5 text-sm text-fg outline-none focus:border-line-strong focus-visible:ring-2 focus-visible:ring-fg/50',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-faint">{hint}</p>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40',
        checked ? 'border-transparent bg-fg/85' : 'border-line bg-surface-3',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0 h-[18px] w-[18px] rounded-full transition-transform',
          checked ? 'translate-x-[22px] bg-bg' : 'translate-x-0.5 bg-muted',
        )}
      />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, className, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label: string; className?: string; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md border transition-colors',
        size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
        checked ? 'border-fg bg-fg text-bg' : 'border-line-strong hover:border-fg',
        className,
      )}
    >
      {checked && <Check size={size === 'sm' ? 11 : 14} strokeWidth={3} />}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex flex-wrap gap-1.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-[var(--radius-ctl)] border px-4 text-[13px] transition-colors',
            value === o.value ? 'ts-active text-fg' : 'border-line bg-surface-2/60 text-muted hover:text-fg hover:border-line-strong',
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={cn('min-w-5 rounded-full px-1.5 text-[11px] leading-5', value === o.value ? 'bg-fg text-bg' : 'bg-surface-3 text-muted')}>
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Favicon                                                             */
/* ------------------------------------------------------------------ */

export function Favicon({ url, size = 18, className }: { url: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(url, size * 2);
  const host = hostname(url);
  if (!src || failed) {
    // Monogram tile instead of a generic globe, so different sites stay distinguishable.
    const letter = host.replace(/^www\./, '').charAt(0).toUpperCase();
    return (
      <span
        aria-hidden
        className={cn('inline-flex shrink-0 items-center justify-center rounded-[4px] bg-surface-3 font-semibold text-muted', className)}
        style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.58)) }}
      >
        {letter || <Globe size={size * 0.85} />}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn('shrink-0 rounded-sm', className)}
      title={host}
      onError={() => setFailed(true)}
      onLoad={(e) => {
        // Chrome's favicon service returns its generic globe when it has no icon cached; show a monogram instead.
        const img = e.currentTarget;
        void isDefaultFavicon(img, size * 2).then((isDefault) => isDefault && setFailed(true));
      }}
    />
  );
}

const defaultFaviconSignatures = new Map<number, Promise<string | null>>();

function pixelSignature(img: HTMLImageElement): string | null {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 16, 16);
    return Array.from(ctx.getImageData(0, 0, 16, 16).data, (v) => (v >> 4).toString(16)).join('');
  } catch {
    return null;
  }
}

/** Pixel signature of Chrome's default favicon, rendered once per size for a URL that cannot have an icon. */
function defaultFaviconSignature(size: number): Promise<string | null> {
  let sig = defaultFaviconSignatures.get(size);
  if (!sig) {
    sig = new Promise((resolve) => {
      const src = faviconUrl('https://tabspace-no-favicon.invalid/', size);
      if (!src) return resolve(null);
      const probe = new Image();
      probe.onload = () => resolve(pixelSignature(probe));
      probe.onerror = () => resolve(null);
      probe.src = src;
    });
    defaultFaviconSignatures.set(size, sig);
  }
  return sig;
}

async function isDefaultFavicon(img: HTMLImageElement, size: number): Promise<boolean> {
  const mine = pixelSignature(img);
  const generic = await defaultFaviconSignature(size);
  return !!mine && mine === generic;
}

/* ------------------------------------------------------------------ */
/* Modal & confirm                                                     */
/* ------------------------------------------------------------------ */

/**
 * Accessible dialog. Animates in (backdrop fade, panel scale .96→1 + 6px rise) and out (reverse):
 * the portal stays mounted while closing (inert + aria-hidden) and unmounts when the exit animation ends,
 * immediately under reduced motion. Focus is restored and Escape is released the moment `open` turns false.
 */
/** Open dialogs, bottom → top. */
const modalStack: symbol[] = [];

export function Modal({ open, onClose, title, children, footer, width = 460 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const presence = usePresence(open, backdrop);
  // Keep the last rendered content while the exit animation plays (callers often clear their state on close).
  const shown = useRef({ title, children, footer });
  if (open) shown.current = { title, children, footer };
  // Latest onClose without re-running the effect (callers often pass inline functions; re-running would
  // re-order the modal stack and steal focus).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const token = Symbol('modal');
    modalStack.push(token);
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute('disabled'));
    (node?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Only the top-most dialog handles keys, so Escape in a stacked confirm closes just the confirm.
      if (modalStack[modalStack.length - 1] !== token) return;
      // A menu open inside the dialog handles its own Escape.
      if (e.key === 'Escape' && (e.target as Element | null)?.closest?.('[role="menu"]')) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === 'Tab') {
        const els = focusables();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const i = modalStack.indexOf(token);
      if (i !== -1) modalStack.splice(i, 1);
      prev?.focus?.();
    };
  }, [open]);
  if (presence === 'unmounted') return null;
  const closing = presence === 'closing';
  const view = closing ? shown.current : { title, children, footer };
  return createPortal(
    <div
      ref={backdrop}
      data-state={closing ? 'closing' : 'open'}
      aria-hidden={closing || undefined}
      // `inert` keeps the closing dialog out of the tab order and away from clicks.
      {...(closing ? { inert: '' } : {})}
      className={cn('fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm', closing ? 'ts-backdrop-out' : 'ts-backdrop-in')}
      onMouseDown={(e) => !closing && e.target === e.currentTarget && onClose()}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn('ts-card w-full bg-surface-2 shadow-2xl', closing ? 'ts-dialog-out' : 'ts-dialog-in')} style={{ maxWidth: width, background: 'var(--ts-bg)' }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {view.title}
          </h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{view.children}</div>
        {view.footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{view.footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false);

/** Provides `useConfirm()` — every destructive action must go through it. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>
              {state?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-muted">{state?.message}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Viewport position for a menu anchored to `trigger`: below (or above when there's no room), clamped on screen. */
export function placeMenu(trigger: DOMRect, menu: { width: number; height: number }, viewport: { width: number; height: number }, align: 'left' | 'right') {
  const gap = 4;
  const margin = 8;
  const below = viewport.height - trigger.bottom - gap - margin;
  const above = trigger.top - gap - margin;
  const openUp = menu.height > below && above > below;
  const maxHeight = Math.max(120, openUp ? above : below);
  const height = Math.min(menu.height, maxHeight);
  const top = openUp ? trigger.top - gap - height : trigger.bottom + gap;
  const rawLeft = align === 'right' ? trigger.right - menu.width : trigger.left;
  const left = Math.min(Math.max(margin, rawLeft), Math.max(margin, viewport.width - menu.width - margin));
  return { top, left, maxHeight };
}

/**
 * Small accessible dropdown menu triggered by an icon button. The list is portalled to <body> and positioned
 * next to its trigger, so it always paints above neighbouring cards (each glass card is its own stacking context)
 * and flips upward near the bottom of the screen.
 */
export function Menu({ label, trigger, items, align = 'right' }: { label: string; trigger: ReactNode; items: MenuItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const presence = usePresence(open, list);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useLayoutEffect(() => {
    if (presence === 'unmounted') return;
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      const m = list.current;
      if (!t || !m) return;
      setPos(placeMenu(t, { width: m.offsetWidth, height: m.scrollHeight }, { width: window.innerWidth, height: window.innerHeight }, align));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [presence, align, items.length]);
  useEffect(() => {
    if (open) list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus();
  }, [open, active, pos]);
  const enabled = items.filter((i) => !i.disabled);
  return (
    <div ref={wrap} className="relative inline-flex">
      <IconButton
        ref={triggerRef}
        label={label}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setActive(0);
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </IconButton>
      {presence !== 'unmounted' &&
        createPortal(
          <div
            ref={list}
            role="menu"
            aria-label={label}
            data-state={open ? 'open' : 'closing'}
            aria-hidden={!open || undefined}
            {...(!open ? { inert: '' } : {})}
            className={cn('ts-card fixed z-[65] min-w-44 overflow-y-auto p-1 shadow-xl', open ? 'ts-menu-in' : 'ts-menu-out')}
            style={{ background: 'var(--ts-bg)', top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos?.maxHeight, visibility: pos ? undefined : 'hidden' }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
                triggerRef.current?.focus();
              }
              if (e.key === 'Tab') setOpen(false);
              if (e.key === 'Home') {
                e.preventDefault();
                setActive(0);
              }
              if (e.key === 'End') {
                e.preventDefault();
                setActive(enabled.length - 1);
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => (a + 1) % enabled.length);
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a - 1 + enabled.length) % enabled.length);
              }
            }}
          >
            {enabled.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] outline-none hover:bg-glow focus:bg-glow', item.danger ? 'text-danger' : 'text-fg')}
              >
                {item.icon && <span className="text-muted">{item.icon}</span>}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

const ToastContext = createContext<(message: string, kind?: 'info' | 'error') => void>(() => undefined);

interface ToastEntry {
  id: number;
  message: string;
  kind: 'info' | 'error';
  leaving?: boolean;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const remove = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    // Mark as leaving; the toast removes itself once its exit animation ends (immediately under reduced motion).
    window.setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x))), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onExited={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onExited }: { toast: ToastEntry; onExited: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const presence = usePresence(!toast.leaving, ref);
  useEffect(() => {
    if (presence === 'unmounted') onExited(toast.id);
  }, [presence, onExited, toast.id]);
  if (presence === 'unmounted') return null;
  return (
    <div
      ref={ref}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-hidden={toast.leaving || undefined}
      className={cn('ts-card px-4 py-2.5 text-sm shadow-xl', toast.leaving ? 'ts-toast-out' : 'ts-toast-in', toast.kind === 'error' && 'border-danger/50 text-danger')}
      style={{ background: 'var(--ts-bg)' }}
    >
      {toast.message}
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
