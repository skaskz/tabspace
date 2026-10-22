import { memo } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, FolderInput, Layers, MoreHorizontal, Pin, PinOff, SquareArrowOutUpRight, Trash2, Volume2 } from 'lucide-react';
import { Checkbox, Favicon, IconButton, Menu, type MenuItem } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatRelative } from '@/utils/date';
import { GROUP_COLOR_HEX, isGroupColor } from '@/features/tabs/serialize';

/** Title column is capped so the Group column sits close to it on wide screens; actions column is fixed so header and rows align. */
export const ROW_GRID = 'grid grid-cols-[28px_minmax(0,1fr)_96px] md:grid-cols-[28px_minmax(0,34rem)_minmax(140px,1fr)_110px_96px] items-center gap-x-3';

export interface RowHandlers {
  toggle: (tabId: number) => void;
  activate: (tabId: number, windowId: number) => void;
  setPinned: (tabId: number, pinned: boolean) => void;
  moveToGroup: (tabId: number) => void;
  addToWorkspace: (tabId: number) => void;
  moveToWindow: (tabId: number, target: number | 'new') => void;
  close: (tabId: number, title: string) => void;
}

export interface OtherWindow {
  id: number;
  label: string;
}

export function GroupDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)} style={{ background: isGroupColor(color) ? GROUP_COLOR_HEX[color] : GROUP_COLOR_HEX.grey }} />;
}

interface TabRowProps {
  tab: chrome.tabs.Tab;
  selected: boolean;
  groupTitle?: string;
  groupColor?: string;
  workspaceName?: string;
  otherWindows: OtherWindow[];
  handlers: RowHandlers;
  now: number;
  /** The Tabspace tab this page runs in: shown as "This tab", never selectable or closable here. */
  isOwn?: boolean;
}

function TabRowImpl({ tab, selected, groupTitle, groupColor, workspaceName, otherWindows, handlers, now, isOwn }: TabRowProps) {
  const id = tab.id!;
  const url = tab.url || tab.pendingUrl || '';
  const title = tab.title || url || 'Untitled tab';
  const items: MenuItem[] = [
    { label: 'Move to group…', icon: <Layers size={14} />, onSelect: () => handlers.moveToGroup(id), disabled: tab.pinned },
    { label: 'Add to workspace…', icon: <FolderInput size={14} />, onSelect: () => handlers.addToWorkspace(id) },
    { label: 'Move to new window', icon: <SquareArrowOutUpRight size={14} />, onSelect: () => handlers.moveToWindow(id, 'new') },
    ...otherWindows.map((w) => ({ label: `Move to ${w.label}`, icon: <ArrowUpRight size={14} />, onSelect: () => handlers.moveToWindow(id, w.id) })),
    { label: 'Close tab', icon: <Trash2 size={14} />, danger: true, onSelect: () => handlers.close(id, title), disabled: isOwn },
  ];
  return (
    <div
      role="row"
      aria-selected={selected}
      className={cn(ROW_GRID, 'border-t border-line px-4 py-2.5 transition-colors hover:bg-glow', selected && 'bg-glow')}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}
    >
      <div role="cell">
        {isOwn ? (
          <button
            type="button"
            role="checkbox"
            aria-checked="false"
            aria-disabled="true"
            disabled
            aria-label={`Select ${title} (this Tabspace tab can’t be selected)`}
            title="This is the Tabspace tab you’re using"
            className="inline-flex h-4 w-4 shrink-0 cursor-not-allowed rounded-md border border-dashed border-line"
          />
        ) : (
          <Checkbox checked={selected} onChange={() => handlers.toggle(id)} label={`Select ${title}`} size="sm" />
        )}
      </div>
      <div role="cell" className="flex min-w-0 items-center gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2">
          <Favicon url={url} size={16} />
        </span>
        <button type="button" onClick={() => handlers.activate(id, tab.windowId)} className="min-w-0 text-left" title={`Go to ${title}`}>
          <span className="flex items-center gap-1.5">
            <span className={cn('truncate text-[13.5px]', tab.active ? 'font-semibold' : 'font-medium')}>{title}</span>
            {isOwn && <span className="shrink-0 rounded-md border border-line px-1.5 text-[11px] leading-5 text-muted">This tab</span>}
            {tab.pinned && <Pin size={12} className="shrink-0 text-muted" aria-label="Pinned" />}
            {tab.audible && <Volume2 size={12} className="shrink-0 text-muted" aria-label="Playing audio" />}
          </span>
          <span className="block truncate text-xs text-faint">{url}</span>
        </button>
      </div>
      <div role="cell" className="hidden min-w-0 md:block">
        {groupTitle !== undefined ? (
          <span className="flex items-center gap-1.5 truncate text-[13px] text-muted">
            <GroupDot color={groupColor ?? 'grey'} />
            <span className="truncate">{groupTitle || 'Untitled group'}</span>
          </span>
        ) : (
          <span className="text-[13px] text-faint">—</span>
        )}
        {workspaceName && <span className="block truncate text-[11.5px] text-faint">in {workspaceName}</span>}
      </div>
      <div role="cell" className="hidden text-[13px] text-muted md:block">
        {tab.active ? 'Active' : tab.lastAccessed ? formatRelative(tab.lastAccessed, now) : '—'}
      </div>
      <div role="cell" className="flex items-center justify-end gap-0.5">
        <IconButton size="sm" label={tab.pinned ? `Unpin ${title}` : `Pin ${title}`} onClick={() => handlers.setPinned(id, !tab.pinned)} aria-pressed={tab.pinned}>
          {tab.pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </IconButton>
        <IconButton size="sm" label={`Go to ${title}`} onClick={() => handlers.activate(id, tab.windowId)}>
          <ArrowUpRight size={15} />
        </IconButton>
        <Menu label={`More actions for ${title}`} trigger={<MoreHorizontal size={16} />} items={items} />
      </div>
    </div>
  );
}

/** Re-renders only when something visible about this tab (or its selection) changes. */
export const TabRow = memo(TabRowImpl, (a, b) => {
  const x = a.tab;
  const y = b.tab;
  return (
    a.selected === b.selected &&
    a.isOwn === b.isOwn &&
    a.groupTitle === b.groupTitle &&
    a.groupColor === b.groupColor &&
    a.workspaceName === b.workspaceName &&
    a.otherWindows === b.otherWindows &&
    a.handlers === b.handlers &&
    Math.floor(a.now / 60_000) === Math.floor(b.now / 60_000) &&
    x.id === y.id &&
    x.url === y.url &&
    x.pendingUrl === y.pendingUrl &&
    x.title === y.title &&
    x.pinned === y.pinned &&
    x.active === y.active &&
    x.audible === y.audible &&
    x.lastAccessed === y.lastAccessed &&
    x.windowId === y.windowId
  );
});

export function SectionHeader({
  title,
  color,
  count,
  shown,
  collapsed,
  onToggleCollapsed,
  allSelected,
  onSelectAll,
  menu,
}: {
  title: string;
  color?: string;
  count: number;
  shown: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  allSelected: boolean;
  onSelectAll: (v: boolean) => void;
  menu?: MenuItem[];
}) {
  return (
    <div role="row" className="flex items-center gap-3 border-t border-line bg-surface-2/50 px-4 py-2">
      <Checkbox checked={allSelected} onChange={onSelectAll} label={`Select all tabs in ${title}`} size="sm" />
      <button type="button" onClick={onToggleCollapsed} aria-expanded={!collapsed} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-semibold">
        {collapsed ? <ChevronRight size={15} className="text-muted" /> : <ChevronDown size={15} className="text-muted" />}
        {color && <GroupDot color={color} />}
        <span className="truncate">{title}</span>
        <span className="font-normal text-muted">
          ({shown !== count ? `${shown} of ${count}` : count} tab{count === 1 ? '' : 's'})
        </span>
      </button>
      {menu && <Menu label={`Actions for group ${title}`} trigger={<MoreHorizontal size={16} />} items={menu} />}
    </div>
  );
}
