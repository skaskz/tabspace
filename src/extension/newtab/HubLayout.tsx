import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, EyeOff, GripVertical, Plus } from 'lucide-react';
import { Button, IconButton } from '@/components/ui';
import type { NewTabLayout, NewTabWidgetId } from '@/types/models';
import { cn } from '@/utils/cn';
import { hideWidget, moveWidget, nudgeWidget, rowsFor, showWidget, splitSide, switchColumn, widgetLabel, type Column } from './layout';

/** Leading clock/search widgets of the wide column render as a full-width hero row. */
const HERO: NewTabWidgetId[] = ['clock', 'search'];

export interface HubLayoutProps {
  layout: NewTabLayout;
  editing: boolean;
  onChange: (next: NewTabLayout) => void;
  render: (id: NewTabWidgetId) => ReactNode;
  /** Shown in the empty-state hint when every widget is hidden. */
  onCustomize?: () => void;
}

/** Renders the New Tab widgets from a layout; in edit mode adds drag-and-drop and per-widget controls. */
export function HubLayout({ layout, editing, onChange, render, onCustomize }: HubLayoutProps) {
  // The Tabspace Bar is pinned full-width at the top; it can only be shown or hidden.
  const main = layout.main.filter((id) => id !== 'bar');
  const side = layout.side.filter((id) => id !== 'bar');
  if (editing) return <EditLayout layout={layout} main={main} side={side} onChange={onChange} render={render} />;

  let heroCount = 0;
  while (heroCount < Math.min(2, main.length) && HERO.includes(main[heroCount])) heroCount++;
  const hero = main.slice(0, heroCount);
  const rows = rowsFor(main.slice(heroCount), true);
  const [sideA, sideB] = splitSide(side);

  if (!main.length && !side.length)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-sm text-muted">Your New Tab is empty — Customize to add sections.</p>
        {onCustomize && (
          <Button size="sm" icon={<Plus size={14} />} onClick={onCustomize}>
            Add sections
          </Button>
        )}
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      {hero.length > 0 && (
        <section aria-label="Clock and search" className="flex flex-wrap items-center gap-x-12 gap-y-4 pb-1">
          {hero.map((id) => (
            <Fragment key={id}>{render(id)}</Fragment>
          ))}
        </section>
      )}
      {(rows.length > 0 || side.length > 0) && (
        <div className={cn('grid items-start gap-3', rows.length > 0 && side.length > 0 && 'lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_auto]')}>
          {rows.length > 0 && (
            <main className="flex min-w-0 flex-col gap-3">
              {rows.map((row) => (
                <MainRow key={row.join('+')} row={row} render={render} />
              ))}
            </main>
          )}
          {side.length > 0 && rows.length === 0 && (
            // No wide column: the side widgets share the full width.
            <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
              {side.map((id) => (
                <div key={id} className="flex min-w-0 flex-col">
                  {render(id)}
                </div>
              ))}
            </div>
          )}
          {side.length > 0 && rows.length > 0 && (
            <div className={cn('grid content-start gap-3 md:grid-cols-2 lg:grid-cols-1', sideB.length > 0 && 'xl:grid-cols-[290px_270px] 2xl:grid-cols-[300px_300px]')}>
              <aside aria-label="Side column" className="flex min-w-0 flex-col gap-3">
                {sideA.map((id) => (
                  <Fragment key={id}>{render(id)}</Fragment>
                ))}
              </aside>
              {sideB.length > 0 && (
                <aside aria-label="Side column (continued)" className="flex min-w-0 flex-col gap-3">
                  {sideB.map((id) => (
                    <Fragment key={id}>{render(id)}</Fragment>
                  ))}
                </aside>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MainRow({ row, render }: { row: NewTabWidgetId[]; render: (id: NewTabWidgetId) => ReactNode }) {
  if (row.length === 1) return <>{render(row[0])}</>;
  if (row.includes('clock'))
    return (
      <div className="flex flex-wrap items-center gap-x-12 gap-y-4">
        {row.map((id) => (
          <Fragment key={id}>{render(id)}</Fragment>
        ))}
      </div>
    );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {row.map((id) => (
        <Fragment key={id}>{render(id)}</Fragment>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Edit mode                                                            */
/* ------------------------------------------------------------------ */

type Drop = { column: Column; index: number } | null;

function EditLayout({ layout, main, side, onChange, render }: { layout: NewTabLayout; main: NewTabWidgetId[]; side: NewTabWidgetId[]; onChange: (l: NewTabLayout) => void; render: (id: NewTabWidgetId) => ReactNode }) {
  const [dragId, setDragId] = useState<NewTabWidgetId | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const hidden = layout.hidden;

  const columnIndex = (column: Column, visibleIndex: number) => {
    // Visible lists exclude the pinned bar; map back to an index in the stored column.
    const stored = layout[column];
    const visible = column === 'main' ? main : side;
    if (visibleIndex >= visible.length) return stored.length;
    return stored.indexOf(visible[visibleIndex]);
  };

  const onDragOver = (column: Column, e: DragEvent<HTMLElement>) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(':scope > [data-widget]'));
    let index = items.length;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    if (drop?.column !== column || drop.index !== index) setDrop({ column, index });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragId && drop) onChange(moveWidget(layout, dragId, drop.column, columnIndex(drop.column, drop.index)));
    setDragId(null);
    setDrop(null);
  };

  const startDrag = (id: NewTabWidgetId) => (e: DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDragId(id);
  };
  const endDrag = () => {
    setDragId(null);
    setDrop(null);
  };

  const column = (col: Column, ids: NewTabWidgetId[], label: string) => (
    <section
      aria-label={label}
      onDragOver={(e) => onDragOver(col, e)}
      onDrop={onDrop}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
      }}
      className={cn('flex min-h-[160px] min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-dashed p-3 transition-colors', dragId ? 'border-line-strong bg-glow' : 'border-line')}
    >
      <h2 className="px-1 text-[11px] font-medium tracking-[0.18em] text-faint uppercase">{label}</h2>
      {ids.map((id, i) => (
        <Fragment key={id}>
          {drop?.column === col && drop.index === i && <DropLine />}
          <EditableWidget
            id={id}
            column={col}
            first={i === 0}
            last={i === ids.length - 1}
            dragging={dragId === id}
            onDragStart={startDrag(id)}
            onDragEnd={endDrag}
            onUp={() => onChange(nudgeWidget(layout, id, -1))}
            onDown={() => onChange(nudgeWidget(layout, id, 1))}
            onSwitch={() => onChange(switchColumn(layout, id))}
            onHide={() => onChange(hideWidget(layout, id))}
          >
            {render(id)}
          </EditableWidget>
        </Fragment>
      ))}
      {drop?.column === col && drop.index === ids.length && <DropLine />}
      {ids.length === 0 && !drop && <p className="px-1 py-6 text-center text-xs text-faint">Drag widgets here</p>}
    </section>
  );

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Hidden widgets" className="ts-card flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="mr-1 text-xs text-muted">Hidden widgets</span>
        {hidden.length === 0 ? (
          <span className="text-xs text-faint">None — hide a widget with its hide button.</span>
        ) : (
          hidden.map((id) => (
            <button
              key={id}
              type="button"
              draggable
              onDragStart={startDrag(id)}
              onDragEnd={endDrag}
              onClick={() => onChange(showWidget(layout, id))}
              aria-label={`Show ${widgetLabel(id)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 text-xs text-fg hover:border-line-strong"
            >
              <Plus size={13} aria-hidden /> {widgetLabel(id)}
            </button>
          ))
        )}
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {column('main', main, 'Main column')}
        {column('side', side, 'Side column')}
      </div>
    </div>
  );
}

function DropLine() {
  return <div aria-hidden className="h-1 rounded-full bg-fg/70 shadow-[0_0_12px_rgba(255,255,255,0.35)]" />;
}

function EditableWidget({
  id,
  column,
  first,
  last,
  dragging,
  children,
  onDragStart,
  onDragEnd,
  onUp,
  onDown,
  onSwitch,
  onHide,
}: {
  id: NewTabWidgetId;
  column: Column;
  first: boolean;
  last: boolean;
  dragging: boolean;
  children: ReactNode;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onUp: () => void;
  onDown: () => void;
  onSwitch: () => void;
  onHide: () => void;
}) {
  const label = widgetLabel(id);
  const content = useRef<HTMLDivElement>(null);
  // Widget content is a preview while customising: not focusable or clickable.
  useEffect(() => {
    content.current?.setAttribute('inert', '');
  }, []);
  return (
    <div data-widget={id} className={cn('rounded-[var(--radius-card)] border border-line-strong bg-surface/60 transition-opacity', dragging && 'opacity-40')} aria-label={`${label} widget`} role="group">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <span draggable onDragStart={onDragStart} onDragEnd={onDragEnd} className="flex cursor-grab items-center gap-1.5 rounded-md px-1 py-1 text-faint hover:text-fg active:cursor-grabbing" title="Drag to move">
          <GripVertical size={15} aria-hidden />
          <span className="text-xs font-medium text-fg">{label}</span>
        </span>
        <span className="ml-auto flex items-center">
          <IconButton size="sm" label={`Move ${label} up`} disabled={first} onClick={onUp}>
            <ArrowUp size={14} />
          </IconButton>
          <IconButton size="sm" label={`Move ${label} down`} disabled={last} onClick={onDown}>
            <ArrowDown size={14} />
          </IconButton>
          <IconButton size="sm" label={column === 'main' ? `Move ${label} to the side column` : `Move ${label} to the main column`} onClick={onSwitch}>
            {column === 'main' ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}
          </IconButton>
          <IconButton size="sm" label={`Hide ${label}`} onClick={onHide}>
            <EyeOff size={14} />
          </IconButton>
        </span>
      </div>
      <div ref={content} className="pointer-events-none max-h-[260px] overflow-hidden p-2 opacity-90 select-none">
        {children}
      </div>
    </div>
  );
}
