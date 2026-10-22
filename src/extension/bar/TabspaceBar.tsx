import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { ChevronLeft, ChevronRight, ChevronsRight, EyeOff, Folder, FolderOpen, LayoutGrid, MoreHorizontal, PanelTopClose, Settings2 } from 'lucide-react';
import { LogoMark } from '@/components/layout/Logo';
import { Favicon, useToast } from '@/components/ui';
import { useSettings, useStore } from '@/hooks/useStore';
import { openDashboard } from '@/app/router';
import { openWorkspace } from '@/services/sessions';
import { WorkspaceIcon } from '@/features/workspaces/icons';
import { isSafeUrl } from '@/utils/url';
import { cn } from '@/utils/cn';
import type { Bookmark, BookmarkFolder } from '@/types/models';
import { BarMenu, BarMenuItem } from './BarMenu';
import { BookmarkButton, type PageInfo } from './BookmarkButton';
import { BAR_HEIGHT, barItems, fitCount, folderContents, shortTitle, type BarItem } from './logic';
import { createVisibilityGate } from './visibility';
import { VisibilityGateContext } from './gateContext';

/**
 * Tabspace Bar — a slim, monochrome strip in the spirit of Chrome's bookmarks
 * bar: logo (dashboard), "bookmark this page", favourite bookmarks, folders
 * (nested dropdowns), a Workspaces menu, and "»" for whatever doesn't fit.
 *
 * Extensions cannot replace or modify Chrome's own bookmarks bar. This bar
 * renders on the Tabspace New Tab page and — only if the user opts in — at the
 * top of websites inside an isolated extension iframe. Users who want only
 * Tabspace's bar hide Chrome's with Ctrl+Shift+B (⌘+Shift+B).
 */
export interface TabspaceBarProps {
  /** 'newtab' renders inline on the New Tab page; 'frame' renders inside bar.html (website iframe). */
  surface?: 'newtab' | 'frame';
  className?: string;
  /** Page to bookmark (frame surface). Without one, the bookmark button is hidden. */
  page?: PageInfo | null;
  /** Tab that link clicks navigate (frame surface). */
  tabId?: number;
  /** Called when any dropdown/popover opens or closes (the website iframe grows while one is open). */
  onMenuOpenChange?: (open: boolean) => void;
  /** Frame-only options. */
  onCollapse?: () => void;
  onHideSite?: () => void;
}

/** Navigate: same tab by default; Ctrl/⌘/Shift/middle-click opens a background tab like Chrome's bar. */
export async function openBarLink(url: string, newTab: boolean, tabId?: number): Promise<void> {
  if (!isSafeUrl(url)) return;
  const hasTabs = typeof chrome !== 'undefined' && !!chrome.tabs?.update;
  if (newTab) {
    if (hasTabs) await chrome.tabs.create({ url, active: false });
    else window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (hasTabs && tabId !== undefined) {
    await chrome.tabs.update(tabId, { url });
    return;
  }
  window.location.assign(url);
}

const wantsNewTab = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; button?: number }) => e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1;

const chip = 'inline-flex h-7 max-w-[180px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-fg/90 hover:bg-glow hover:text-fg';

export function TabspaceBar({ surface = 'newtab', className, page = null, tabId, onMenuOpenChange, onCollapse, onHideSite }: TabspaceBarProps) {
  const [settings] = useSettings();
  const [bookmarks] = useStore('ts.bookmarks');
  const [folders] = useStore('ts.bookmarkFolders');
  const [workspaces] = useStore('ts.workspaces');
  const bar = settings.tabspaceBar;
  const items = barItems(bookmarks, folders, bar.showFolders);

  // ---- open-menu bookkeeping (iframe expansion)
  const openCount = useRef(0);
  const onOpenChange = useCallback(
    (open: boolean) => {
      openCount.current = Math.max(0, openCount.current + (open ? 1 : -1));
      onMenuOpenChange?.(openCount.current > 0);
    },
    [onMenuOpenChange],
  );

  // ---- overflow measurement
  const area = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(items.length);
  const key = items.map((i) => (i.kind === 'link' ? `l${i.bookmark.id}:${i.bookmark.title}` : `f${i.folder.id}:${i.folder.name}`)).join('|');
  useLayoutEffect(() => {
    const recompute = () => {
      const widths = Array.from(measure.current?.children ?? []).map((c) => (c as HTMLElement).offsetWidth);
      const available = area.current?.clientWidth ?? 0;
      setVisible(available > 0 ? fitCount(widths, available, 32) : widths.length);
    };
    recompute();
    if (typeof ResizeObserver === 'undefined' || !area.current) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(area.current);
    return () => ro.disconnect();
  }, [key]);
  const shown = items.slice(0, visible);
  const hidden = items.slice(visible);

  // ---- roving focus across the toolbar
  const toolbar = useRef<HTMLDivElement>(null);

  // ---- clickjacking gate (website frame only): swallow clicks while the bar isn't verifiably visible
  const gate = useMemo(() => (surface === 'frame' ? createVisibilityGate(() => toolbar.current) : null), [surface]);
  useEffect(() => {
    if (!gate || !toolbar.current) return;
    const stop = gate.observe(toolbar.current);
    return () => {
      stop();
      gate.disconnect();
    };
  }, [gate]);
  const guard = (e: React.SyntheticEvent) => {
    if (gate && !gate.allows(e.target as Element)) {
      e.preventDefault();
      e.stopPropagation();
      console.warn('[Tabspace] Bar click ignored: the bar is hidden or covered by the page.');
    }
  };
  const [active, setActive] = useState(0);
  const barButtons = () => Array.from(toolbar.current?.querySelectorAll<HTMLElement>('[data-bar-item]') ?? []).filter((el) => !el.closest('[role="menu"],[role="dialog"]'));
  useEffect(() => {
    const els = barButtons();
    els.forEach((el, i) => (el.tabIndex = i === Math.min(active, els.length - 1) ? 0 : -1));
  });
  const onToolbarKey = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const els = barButtons();
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + els.length) % els.length;
    setActive(n);
    els[n]?.focus();
  };

  const link = (b: Bookmark) => (
    <a
      key={b.id}
      href={b.url}
      data-bar-item
      tabIndex={-1}
      title={`${b.title || b.url}\n${b.url}`}
      className={chip}
      onClick={(e) => {
        e.preventDefault();
        void openBarLink(b.url, wantsNewTab(e), tabId);
      }}
      onAuxClick={(e: ReactMouseEvent) => {
        if (e.button !== 1) return;
        e.preventDefault();
        void openBarLink(b.url, true, tabId);
      }}
    >
      <Favicon url={b.url} size={14} />
      <span className="truncate">{shortTitle(b)}</span>
    </a>
  );

  const folderMenu = (f: BookmarkFolder) => (
    <BarMenu
      key={f.id}
      label={f.name}
      onOpenChange={onOpenChange}
      triggerClass={chip}
      trigger={
        <>
          <Folder size={14} className="shrink-0 text-muted" aria-hidden />
          <span className="truncate">{f.name}</span>
        </>
      }
    >
      {(close) => <FolderMenuContent rootId={f.id} bookmarks={bookmarks} folders={folders} tabId={tabId} close={close} />}
    </BarMenu>
  );

  const render = (i: BarItem) => (i.kind === 'link' ? link(i.bookmark) : folderMenu(i.folder));

  return (
    <VisibilityGateContext.Provider value={gate}>
      <div
        ref={toolbar}
        role="toolbar"
        aria-label="Tabspace Bar"
        onKeyDown={onToolbarKey}
        onClickCapture={guard}
        onAuxClickCapture={guard}
        className={cn('relative flex w-full items-center gap-1 px-2 text-fg', surface === 'frame' && 'border-b border-line bg-bg', className)}
        style={{ height: BAR_HEIGHT }}
      >
        <button
          type="button"
          data-bar-item
          tabIndex={-1}
          aria-label="Open Tabspace dashboard"
          title="Tabspace"
          onClick={() => void openDashboard('dashboard')}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-glow"
        >
          <LogoMark size={16} />
        </button>
        <BookmarkButton page={page} onOpenChange={onOpenChange} />
        {(page || surface === 'frame') && <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line" />}

        <div ref={area} className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {items.length === 0 ? (
            <button type="button" data-bar-item tabIndex={-1} onClick={() => void openDashboard('bookmarks')} className="truncate px-2 text-[12px] text-muted hover:text-fg">
              Star bookmarks in Tabspace to pin them here
            </button>
          ) : (
            shown.map(render)
          )}
          {/* Off-screen copy of every chip, used only to measure widths for the overflow menu. */}
          <div ref={measure} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex gap-1" style={{ width: 'max-content' }}>
            {items.map((i) => (
              <span key={i.kind === 'link' ? i.bookmark.id : i.folder.id} className={chip}>
                <span className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{i.kind === 'link' ? shortTitle(i.bookmark) : i.folder.name}</span>
              </span>
            ))}
          </div>
        </div>

        {hidden.length > 0 && (
          <BarMenu
            label={`${hidden.length} more bookmark${hidden.length === 1 ? '' : 's'}`}
            align="right"
            onOpenChange={onOpenChange}
            triggerClass="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-glow hover:text-fg"
            trigger={<ChevronsRight size={15} />}
          >
            {(close) => <OverflowContent items={hidden} bookmarks={bookmarks} folders={folders} tabId={tabId} close={close} />}
          </BarMenu>
        )}

        {bar.showWorkspaces && (
          <BarMenu
            label="Workspaces"
            align="right"
            width={240}
            onOpenChange={onOpenChange}
            triggerClass="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted hover:bg-glow hover:text-fg"
            trigger={
              <>
                <LayoutGrid size={14} aria-hidden />
                <span className="max-sm:sr-only">Workspaces</span>
              </>
            }
          >
            {(close) => <WorkspacesContent workspaces={workspaces} close={close} />}
          </BarMenu>
        )}

        {surface === 'frame' && (
          <BarMenu
            label="Tabspace Bar options"
            align="right"
            width={220}
            onOpenChange={onOpenChange}
            triggerClass="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-glow hover:text-fg"
            trigger={<MoreHorizontal size={15} />}
          >
            {(close) => (
              <>
                <BarMenuItem icon={<PanelTopClose size={14} />} onSelect={() => (close(), onCollapse?.())}>
                  Hide bar
                </BarMenuItem>
                <BarMenuItem icon={<EyeOff size={14} />} onSelect={() => (close(), onHideSite?.())}>
                  Hide on this site
                </BarMenuItem>
                <BarMenuItem icon={<Settings2 size={14} />} onSelect={() => (close(), void openDashboard('sidebar'))}>
                  Bar settings
                </BarMenuItem>
              </>
            )}
          </BarMenu>
        )}
      </div>
    </VisibilityGateContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Menu contents                                                       */
/* ------------------------------------------------------------------ */

function LinkItem({ b, tabId, close }: { b: Bookmark; tabId?: number; close: () => void }) {
  return (
    <BarMenuItem
      icon={<Favicon url={b.url} size={14} />}
      title={b.url}
      onSelect={(e) => {
        const newTab = 'button' in e ? wantsNewTab(e as ReactMouseEvent) : wantsNewTab({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey });
        if (!newTab) close();
        void openBarLink(b.url, newTab, tabId);
      }}
    >
      {b.title || b.url}
    </BarMenuItem>
  );
}

/** Drill-down folder browser: sub-folders open in place with a Back row. */
function FolderMenuContent({
  rootId,
  bookmarks,
  folders,
  tabId,
  close,
  onBack,
}: {
  rootId: string;
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
  tabId?: number;
  close: () => void;
  onBack?: () => void;
}) {
  const [path, setPath] = useState<string[]>([rootId]);
  const current = path[path.length - 1];
  const { folders: subs, links } = folderContents(current, bookmarks, folders);
  const name = folders.find((f) => f.id === current)?.name ?? '';
  const back = path.length > 1 ? () => setPath((p) => p.slice(0, -1)) : onBack;
  const openAll = links.slice(0, 15);
  return (
    <>
      {back && (
        <BarMenuItem icon={<ChevronLeft size={14} />} onSelect={back} className="text-muted">
          {path.length > 1 ? 'Back' : 'All items'}
        </BarMenuItem>
      )}
      {(back || path.length > 1) && <div className="px-2.5 pt-1 pb-1 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">{name}</div>}
      {subs.map((f) => (
        <BarMenuItem key={f.id} icon={<Folder size={14} />} trailing={<ChevronRight size={13} className="text-faint" />} onSelect={() => setPath((p) => [...p, f.id])}>
          {f.name}
        </BarMenuItem>
      ))}
      {links.map((b) => (
        <LinkItem key={b.id} b={b} tabId={tabId} close={close} />
      ))}
      {subs.length === 0 && links.length === 0 && <p className="px-2.5 py-2 text-xs text-faint">Empty folder</p>}
      {openAll.length > 1 && (
        <>
          <div className="my-1 h-px bg-line" />
          <BarMenuItem
            icon={<FolderOpen size={14} />}
            onSelect={() => {
              close();
              for (const b of openAll) void openBarLink(b.url, true);
            }}
          >
            Open all ({openAll.length}){links.length > 15 ? ' — first 15' : ''}
          </BarMenuItem>
        </>
      )}
    </>
  );
}

function OverflowContent({ items, bookmarks, folders, tabId, close }: { items: BarItem[]; bookmarks: Bookmark[]; folders: BookmarkFolder[]; tabId?: number; close: () => void }) {
  const [folder, setFolder] = useState<string | null>(null);
  if (folder) return <FolderMenuContent rootId={folder} bookmarks={bookmarks} folders={folders} tabId={tabId} close={close} onBack={() => setFolder(null)} />;
  return (
    <>
      {items.map((i) =>
        i.kind === 'link' ? (
          <LinkItem key={i.bookmark.id} b={i.bookmark} tabId={tabId} close={close} />
        ) : (
          <BarMenuItem key={i.folder.id} icon={<Folder size={14} />} trailing={<ChevronRight size={13} className="text-faint" />} onSelect={() => setFolder(i.folder.id)}>
            {i.folder.name}
          </BarMenuItem>
        ),
      )}
    </>
  );
}

function WorkspacesContent({ workspaces, close }: { workspaces: { id: string; name: string; icon: string; order: number }[]; close: () => void }) {
  const toast = useToast();
  const list = [...workspaces].sort((a, b) => a.order - b.order);
  if (!list.length)
    return (
      <BarMenuItem onSelect={() => (close(), void openDashboard('workspaces'))} className="text-muted">
        No workspaces yet — create one
      </BarMenuItem>
    );
  return (
    <>
      {list.map((w) => (
        <BarMenuItem
          key={w.id}
          icon={<WorkspaceIcon icon={w.icon} size={14} />}
          trailing={<span className="text-[11px] text-faint">Open</span>}
          onSelect={() => {
            close();
            openWorkspace(w.id).catch((e: unknown) => toast(e instanceof Error ? e.message : 'Could not open the workspace', 'error'));
          }}
        >
          {w.name}
        </BarMenuItem>
      ))}
      <div className="my-1 h-px bg-line" />
      <BarMenuItem icon={<LayoutGrid size={14} />} onSelect={() => (close(), void openDashboard('workspaces'))} className="text-muted">
        Manage workspaces
      </BarMenuItem>
    </>
  );
}

export type { PageInfo };
