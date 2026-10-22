import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, ChevronsDownUp, FolderPlus, Layers, MoreHorizontal, Pencil, Pin, PinOff, Save, Search, SlidersHorizontal, SquareArrowOutUpRight, Trash2, Ungroup, Wand2, X } from 'lucide-react';
import { PageHero } from '@/components/layout/PageHero';
import { Button, Card, Checkbox, EmptyState, Favicon, IconButton, Input, Menu, Segmented, Select, useConfirm, useToast, type MenuItem } from '@/components/ui';
import { useSettings, useStore } from '@/hooks/useStore';
import { useNow } from '@/hooks/useNow';
import { useRoute } from '@/app/router';
import type { GroupColor } from '@/types/models';
import { filterTabs, groupCounts, normalizeForMatch, sectionTabs, sortTabs, urlWorkspaceIndex, workspaceUrls, type TabSort } from '@/features/tabs/manager';
import { suggestGroups, type GroupSuggestion } from '@/features/tabs/smartGrouping';
import { isGroupColor, tabUrl } from '@/features/tabs/serialize';
import {
  activateTab,
  applySuggestions,
  closeGroup,
  closeTabs,
  createGroup,
  hasTabGroupsApi,
  moveTabsToGroup,
  moveTabsToWindow,
  NOT_IN_EXTENSION,
  setPinned,
  ungroupGroup,
  ungroupTabs,
  updateGroup,
  type WindowInfo,
} from '@/services/tabs';
import { addTabsToWorkspace, saveCurrentWindowDetailed, saveTabsAsSession } from '@/services/sessions';
import { SessionList } from '@/pages/workspaces/SessionList';
import { errorMessage } from '@/pages/workspaces/sessionActions';
import { useWindows } from './useWindows';
import { GroupDot, ROW_GRID, SectionHeader, TabRow, type OtherWindow, type RowHandlers } from './TabRow';
import { GroupModal, MoveToGroupModal, SaveToWorkspaceModal, type SaveMode } from './TabModals';
import { GroupingRulesModal } from './GroupingRulesModal';

type View = 'open' | 'sessions';

export default function TabsPage() {
  const { params } = useRoute();
  const [view, setView] = useState<View>(params.get('view') === 'sessions' ? 'sessions' : 'open');
  const [sessions] = useStore('ts.sessions');
  const live = useWindows();
  const totalTabs = live.windows?.reduce((n, w) => n + w.tabs.length, 0);

  return (
    <div>
      <PageHero
        title="Tab Manager"
        subtitle="Organize, manage, and take control of your browsing tabs."
        actions={
          <Segmented
            label="Tab manager view"
            value={view}
            onChange={setView}
            options={[
              { value: 'open', label: 'Open tabs', count: totalTabs },
              { value: 'sessions', label: 'Saved sessions', count: sessions.length },
            ]}
          />
        }
      />
      {view === 'open' ? (
        !live.available ? (
          <Card>
            <EmptyState icon={<AppWindow size={30} />} title={NOT_IN_EXTENSION} description="The tab manager reads your open windows through Chrome’s tabs API, which isn’t available on this page. Saved sessions still work." />
          </Card>
        ) : live.error && !live.windows ? (
          <Card>
            <EmptyState icon={<AppWindow size={30} />} title="Couldn’t read your tabs" description={live.error} action={<Button onClick={() => void live.refresh()}>Try again</Button>} />
          </Card>
        ) : !live.windows ? (
          <p className="text-sm text-muted" role="status">
            Loading tabs…
          </p>
        ) : (
          <OpenTabs windows={live.windows} refresh={live.refresh} ownTabId={live.ownTab?.id} ownWindowId={live.ownTab?.windowId} />
        )
      ) : (
        <SavedSessions />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Saved sessions view                                                 */
/* ------------------------------------------------------------------ */

function SavedSessions() {
  const [sessions] = useStore('ts.sessions');
  const [workspaces] = useStore('ts.workspaces');
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'archived'>('all');
  const sorted = useMemo(() => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt), [sessions]);
  const known = useMemo(() => new Set(workspaces.map((w) => w.id)), [workspaces]);
  const unassigned = sorted.filter((s) => !s.archived && (!s.workspaceId || !known.has(s.workspaceId)));
  const archived = sorted.filter((s) => s.archived);
  const shown = filter === 'unassigned' ? unassigned : filter === 'archived' ? archived : sorted;
  const saveNow = async () => {
    try {
      const { session, skipped } = await saveCurrentWindowDetailed({});
      if (!session) toast('Nothing to save — no web pages in this window.', 'error');
      else toast(`Saved ${session.tabs.length} tabs${skipped ? ` · ${skipped} skipped (not web pages)` : ''}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <Segmented
          label="Filter sessions"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: sorted.length },
            { value: 'unassigned', label: 'Unassigned', count: unassigned.length },
            { value: 'archived', label: 'Archived', count: archived.length },
          ]}
        />
        <Button icon={<Save size={15} />} onClick={() => void saveNow()}>
          Save current window
        </Button>
      </div>
      <SessionList sessions={shown} workspaces={workspaces} showWorkspace emptyText={filter === 'archived' ? 'Sessions archived by “Replace current tabs” appear here.' : undefined} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Open tabs view                                                      */
/* ------------------------------------------------------------------ */

type GroupModalState = { kind: 'create'; tabIds: number[] } | { kind: 'edit'; group: chrome.tabGroups.TabGroup } | null;

function OpenTabs({ windows, refresh, ownTabId, ownWindowId }: { windows: WindowInfo[]; refresh: () => Promise<void>; ownTabId?: number; ownWindowId?: number }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [settings] = useSettings();
  const [sessions] = useStore('ts.sessions');
  const [workspaces] = useStore('ts.workspaces');
  const now = useNow(60_000);

  const [windowId, setWindowId] = useState<number | null>(null);
  // Default to the window this Tabspace tab lives in, then the focused one.
  const win = windows.find((w) => w.id === windowId) ?? windows.find((w) => w.id === ownWindowId) ?? windows.find((w) => w.focused) ?? windows[0];
  const [group, setGroup] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TabSort>('position');
  const [wsFilter, setWsFilter] = useState('');
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [suggestions, setSuggestions] = useState<GroupSuggestion[] | null>(null);
  const [groupModal, setGroupModal] = useState<GroupModalState>(null);
  const [saveModal, setSaveModal] = useState<{ tabIds: number[]; mode: SaveMode } | null>(null);
  const [moveModal, setMoveModal] = useState<number[] | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const tabs = useMemo(() => win?.tabs ?? [], [win]);
  const groups = useMemo(() => win?.groups ?? [], [win]);
  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const counts = useMemo(() => groupCounts(tabs), [tabs]);

  // Drop selections / filters that no longer exist after a live update.
  useEffect(() => {
    const ids = new Set(tabs.map((t) => t.id));
    setSelected((s) => {
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [tabs]);
  useEffect(() => {
    if (group !== 'all' && !groupsById.has(Number(group))) setGroup('all');
  }, [group, groupsById]);

  const wsIndex = useMemo(() => urlWorkspaceIndex(sessions, workspaces), [sessions, workspaces]);
  const wsUrls = useMemo(() => (wsFilter ? workspaceUrls(sessions, wsFilter) : undefined), [sessions, wsFilter]);
  const visible = useMemo(() => sortTabs(filterTabs(tabs, { query, group: group === 'all' ? 'all' : Number(group), urls: wsUrls }), sort), [tabs, query, group, wsUrls, sort]);
  const sections = useMemo(() => sectionTabs(tabs, visible, groups), [tabs, visible, groups]);

  const otherWindows = useMemo<OtherWindow[]>(
    () => windows.map((w, i) => ({ id: w.id, label: `window ${i + 1} (${w.tabs.length} tabs)` })).filter((w) => w.id !== win?.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [windows.map((w) => `${w.id}:${w.tabs.length}`).join(','), win?.id],
  );

  const selectedIds = useMemo(() => tabs.filter((t) => t.id !== undefined && selected.has(t.id)).map((t) => t.id!), [tabs, selected]);

  /* ---------- actions ---------- */

  const run = useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
      try {
        await fn();
        if (ok) toast(ok);
      } catch (e) {
        toast(errorMessage(e), 'error');
      } finally {
        void refresh();
      }
    },
    [refresh, toast],
  );

  const confirmClose = useCallback(
    async (ids: number[], what: string) => {
      // Never close the Tabspace tab the user is working in.
      ids = ids.filter((id) => id !== ownTabId);
      if (!ids.length) return;
      const ok = await confirm({
        title: ids.length === 1 ? 'Close this tab?' : `Close ${ids.length} tabs?`,
        message: `${what} will be closed in Chrome. Save them to a workspace first if you’ll need them later.`,
        confirmLabel: ids.length === 1 ? 'Close tab' : `Close ${ids.length} tabs`,
        danger: true,
      });
      if (ok) await run(() => closeTabs(ids), ids.length === 1 ? 'Tab closed' : `${ids.length} tabs closed`);
    },
    [confirm, run, ownTabId],
  );

  // Stable row handlers that always see the latest state.
  const latest = useRef({ run, confirmClose, tabs });
  latest.current = { run, confirmClose, tabs };
  const handlers = useMemo<RowHandlers>(
    () => ({
      toggle: (id) =>
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      activate: (id, wid) => void latest.current.run(() => activateTab(id, wid)),
      setPinned: (id, pinned) => void latest.current.run(() => setPinned([id], pinned)),
      moveToGroup: (id) => setMoveModal([id]),
      addToWorkspace: (id) => setSaveModal({ tabIds: [id], mode: 'append' }),
      moveToWindow: (id, target) => void latest.current.run(() => moveTabsToWindow([id], target), 'Tab moved'),
      close: (id, title) => void latest.current.confirmClose([id], `“${title}”`),
    }),
    [],
  );

  const toggleMany = (ids: number[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const visibleIds = visible.map((t) => t.id).filter((id): id is number => id !== undefined && id !== ownTabId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const canGroup = hasTabGroupsApi();

  const openSuggestions = () => {
    if (!settings.smartGrouping.enabled) {
      toast('Turn on smart grouping suggestions first.');
      setRulesOpen(true);
      return;
    }
    const s = suggestGroups(tabs, groups, { rules: settings.smartGrouping.rules, includeBuiltIns: true });
    setSuggestions(s);
    if (!s.length) toast('No grouping suggestions — ungrouped tabs don’t match your rules or common sites.');
  };

  const applyOne = async (s: GroupSuggestion) => {
    if (!win) return;
    await run(async () => {
      const n = await applySuggestions(win.id, [s]);
      toast(`Grouped ${n} tab${n === 1 ? '' : 's'} into “${s.title}”`);
    });
    setSuggestions((cur) => cur?.filter((x) => x.key !== s.key) ?? null);
  };

  const applyAll = async () => {
    if (!win || !suggestions?.length) return;
    await run(async () => {
      const n = await applySuggestions(win.id, suggestions);
      toast(`Grouped ${n} tab${n === 1 ? '' : 's'} into ${suggestions.length} group${suggestions.length === 1 ? '' : 's'}`);
    });
    setSuggestions(null);
  };

  const allTabIds = tabs.map((t) => t.id).filter((id): id is number => id !== undefined);
  const pageItems: MenuItem[] = [
    { label: `Save all ${allTabIds.length} tabs to a workspace…`, icon: <FolderPlus size={14} />, onSelect: () => setSaveModal({ tabIds: allTabIds, mode: 'new' }), disabled: !allTabIds.length },
    { label: 'Suggest groups', icon: <Wand2 size={14} />, onSelect: openSuggestions, disabled: !canGroup },
    { label: 'Grouping rules…', icon: <SlidersHorizontal size={14} />, onSelect: () => setRulesOpen(true) },
  ];
  const selectionItems: MenuItem[] = [
    { label: 'Ungroup', icon: <Ungroup size={14} />, onSelect: () => void run(() => ungroupTabs(selectedIds), 'Ungrouped'), disabled: !canGroup },
    { label: 'Pin', icon: <Pin size={14} />, onSelect: () => void run(() => setPinned(selectedIds, true)) },
    { label: 'Unpin', icon: <PinOff size={14} />, onSelect: () => void run(() => setPinned(selectedIds, false)) },
    { label: 'Move to new window', icon: <SquareArrowOutUpRight size={14} />, onSelect: () => void run(() => moveTabsToWindow(selectedIds, 'new'), 'Moved to a new window') },
  ];

  const groupMenu = (g: chrome.tabGroups.TabGroup): MenuItem[] => [
    { label: 'Rename / colour', icon: <Pencil size={14} />, onSelect: () => setGroupModal({ kind: 'edit', group: g }) },
    { label: g.collapsed ? 'Expand in Chrome' : 'Collapse in Chrome', icon: <ChevronsDownUp size={14} />, onSelect: () => void run(() => updateGroup(g.id, { collapsed: !g.collapsed })) },
    { label: 'Ungroup', icon: <Ungroup size={14} />, onSelect: () => void run(() => ungroupGroup(g.id), 'Group removed — tabs kept open') },
    {
      label: 'Close group',
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: async () => {
        const n = counts.get(g.id) ?? 0;
        const ok = await confirm({ title: `Close “${g.title || 'Untitled group'}”?`, message: `All ${n} tab${n === 1 ? '' : 's'} in this group will be closed in Chrome.`, confirmLabel: 'Close group', danger: true });
        if (ok) await run(() => closeGroup(g.id), 'Group closed');
      },
    },
  ];

  const filterOptions = [
    { value: 'all', label: 'All Tabs', count: tabs.length },
    ...groups
      .slice()
      .sort((a, b) => (tabs.find((t) => t.groupId === a.id)?.index ?? 0) - (tabs.find((t) => t.groupId === b.id)?.index ?? 0))
      .map((g) => ({
        value: String(g.id),
        label: (
          <span className="inline-flex items-center gap-2">
            <GroupDot color={g.color} />
            {g.title || 'Untitled'}
          </span>
        ),
        count: counts.get(g.id) ?? 0,
      })),
  ];

  const saveTabIds = saveModal?.tabIds ?? [];
  const saveTabs = tabs.filter((t) => t.id !== undefined && saveTabIds.includes(t.id));

  return (
    <>
      {/* Smart suggestions */}
      {suggestions && suggestions.length > 0 && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-2">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <Wand2 size={16} className="text-muted" /> Suggested groups
              </h2>
              <p className="text-[13px] text-muted">For ungrouped tabs, from your smart-grouping rules and common sites. Nothing changes until you apply.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" icon={<SlidersHorizontal size={14} />} onClick={() => setRulesOpen(true)}>
                Rules
              </Button>
              <Button size="sm" variant="primary" onClick={() => void applyAll()}>
                Apply all
              </Button>
              <IconButton label="Dismiss suggestions" size="sm" onClick={() => setSuggestions(null)}>
                <X size={15} />
              </IconButton>
            </div>
          </div>
          <ul className="px-3 pb-3">
            {suggestions.map((s) => (
              <li key={s.key} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-glow">
                <GroupDot color={s.color} />
                <span className="text-sm font-medium">{s.title}</span>
                <span className="text-xs text-muted">
                  {s.tabIds.length} tab{s.tabIds.length === 1 ? '' : 's'}
                  {s.existingGroupId !== undefined ? ' · joins existing group' : ''}
                  {s.source === 'rule' ? ' · your rule' : ''}
                </span>
                <span className="flex flex-1 items-center gap-1" aria-hidden>
                  {s.tabIds.slice(0, 6).map((id) => {
                    const t = tabs.find((x) => x.id === id);
                    return t ? <Favicon key={id} url={tabUrl(t)} size={14} /> : null;
                  })}
                </span>
                <Button size="sm" onClick={() => void applyOne(s)}>
                  Apply
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Toolbar: filters on the left (scroll horizontally), search / sort / window + page actions on the right */}
      <div className="mb-3 flex flex-wrap items-center gap-3 lg:flex-nowrap">
        <div className="min-w-0 flex-1 overflow-x-auto pb-1">
          <Segmented label="Filter by group" value={group} onChange={setGroup} options={filterOptions} className="flex-nowrap! whitespace-nowrap" />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Input icon={<Search size={15} />} placeholder="Search tabs" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search tabs" className="w-52" />
          <Select aria-label="Sort tabs" value={sort} onChange={(e) => setSort(e.target.value as TabSort)}>
            <option value="position">Tab order</option>
            <option value="lastActive">Last active</option>
            <option value="title">Title</option>
            <option value="domain">Domain</option>
          </Select>
          {workspaces.length > 0 && (
            <Select aria-label="Filter by workspace" value={wsFilter} onChange={(e) => setWsFilter(e.target.value)}>
              <option value="">Any workspace</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  Saved in {w.name}
                </option>
              ))}
            </Select>
          )}
          {windows.length > 1 && (
            <Select
              aria-label="Window"
              value={win?.id ?? ''}
              onChange={(e) => {
                setWindowId(Number(e.target.value));
                setSelected(new Set());
                setGroup('all');
                setSuggestions(null);
              }}
            >
              {windows.map((w, i) => (
                <option key={w.id} value={w.id}>
                  Window {i + 1} · {w.tabs.length} tabs{w.focused ? ' (current)' : ''}
                  {w.incognito ? ' · incognito' : ''}
                </option>
              ))}
            </Select>
          )}
          <Menu label="Tab manager actions" trigger={<MoreHorizontal size={16} />} items={pageItems} />
        </div>
      </div>

      {/* Contextual selection bar: only while tabs are selected */}
      {selectedIds.length > 0 && (
        <div role="toolbar" aria-label="Actions for selected tabs" className="ts-card ts-fade-in sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 px-3 py-2" style={{ background: 'var(--ts-bg)' }}>
          <span className="flex items-center gap-1 pr-2 text-[13px] font-medium" aria-live="polite">
            {selectedIds.length} selected
            <IconButton size="sm" label="Clear selection" onClick={() => setSelected(new Set())}>
              <X size={14} />
            </IconButton>
          </span>
          {canGroup && (
            <Button size="sm" icon={<Layers size={14} />} onClick={() => setGroupModal({ kind: 'create', tabIds: selectedIds })}>
              Group
            </Button>
          )}
          <Button size="sm" icon={<FolderPlus size={14} />} onClick={() => setSaveModal({ tabIds: selectedIds, mode: 'new' })}>
            Save {selectedIds.length} selected
          </Button>
          <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => void confirmClose(selectedIds, selectedIds.length === 1 ? 'The selected tab' : `The ${selectedIds.length} selected tabs`)}>
            Close
          </Button>
          <Menu label="More actions for selected tabs" trigger={<MoreHorizontal size={16} />} items={selectionItems} align="left" />
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <div role="table" aria-label="Open tabs" aria-rowcount={visible.length}>
          <div role="row" className={`${ROW_GRID} px-4 py-3 text-xs font-medium tracking-wide text-faint uppercase`}>
            <div role="columnheader">
              <Checkbox checked={allVisibleSelected} onChange={(v) => toggleMany(visibleIds, v)} label="Select all visible tabs" size="sm" />
            </div>
            <div role="columnheader">Tab / Site</div>
            <div role="columnheader" className="hidden md:block">
              Group / Workspace
            </div>
            <div role="columnheader" className="hidden md:block">
              Last active
            </div>
            <div role="columnheader" className="pr-2 text-right">
              Actions
            </div>
          </div>
          {sections.length === 0 ? (
            <div className="border-t border-line">
              <EmptyState icon={<Search size={24} />} title={tabs.length ? 'No tabs match' : 'No tabs in this window'} description={tabs.length ? 'Try a different search or filter.' : undefined} />
            </div>
          ) : (
            sections.map((sec) => {
              const key = sec.group ? `g${sec.group.id}` : 'ungrouped';
              const isCollapsed = collapsed.has(key);
              const ids = sec.tabs.map((t) => t.id).filter((id): id is number => id !== undefined && id !== ownTabId);
              const title = sec.group ? sec.group.title || 'Untitled group' : 'Ungrouped';
              return (
                <div key={key} role="rowgroup">
                  <SectionHeader
                    title={title}
                    color={sec.group?.color}
                    count={sec.total}
                    shown={sec.tabs.length}
                    collapsed={isCollapsed}
                    onToggleCollapsed={() =>
                      setCollapsed((c) => {
                        const n = new Set(c);
                        if (n.has(key)) n.delete(key);
                        else n.add(key);
                        return n;
                      })
                    }
                    allSelected={ids.length > 0 && ids.every((id) => selected.has(id))}
                    onSelectAll={(v) => toggleMany(ids, v)}
                    menu={sec.group && canGroup ? groupMenu(sec.group) : undefined}
                  />
                  {!isCollapsed &&
                    sec.tabs.map((t) => {
                      const g = t.groupId !== undefined ? groupsById.get(t.groupId) : undefined;
                      return (
                        <TabRow
                          key={t.id}
                          tab={t}
                          selected={selected.has(t.id!)}
                          groupTitle={g ? (g.title ?? '') : undefined}
                          groupColor={g?.color}
                          workspaceName={wsIndex.get(normalizeForMatch(tabUrl(t)))}
                          otherWindows={otherWindows}
                          handlers={handlers}
                          isOwn={t.id === ownTabId}
                          now={now}
                        />
                      );
                    })}
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Modals */}
      <GroupModal
        open={!!groupModal}
        title={groupModal?.kind === 'edit' ? 'Edit group' : `Group ${groupModal?.kind === 'create' ? groupModal.tabIds.length : 0} tabs`}
        initial={groupModal?.kind === 'edit' ? { title: groupModal.group.title ?? '', color: isGroupColor(groupModal.group.color) ? groupModal.group.color : 'grey' } : { title: '', color: 'grey' }}
        submitLabel={groupModal?.kind === 'edit' ? 'Save' : 'Create group'}
        note={groupModal?.kind === 'create' ? 'Pinned tabs can’t be in a group and will be left out.' : undefined}
        onClose={() => setGroupModal(null)}
        onSubmit={async ({ title, color }: { title: string; color: GroupColor }) => {
          if (!groupModal) return;
          if (groupModal.kind === 'edit') {
            await updateGroup(groupModal.group.id, { title, color });
          } else {
            const res = await createGroup(groupModal.tabIds, { title, color, windowId: win?.id });
            setSelected(new Set());
            toast(`Group created${res.skippedPinned ? ` · ${res.skippedPinned} pinned tab${res.skippedPinned === 1 ? '' : 's'} left out` : ''}`);
          }
          void refresh();
        }}
      />
      <SaveToWorkspaceModal
        open={!!saveModal}
        count={saveTabs.length}
        workspaces={workspaces}
        defaultMode={saveModal?.mode}
        onClose={() => setSaveModal(null)}
        onSubmit={async ({ workspaceId, name, mode }) => {
          if (mode === 'append' && workspaceId) {
            const r = await addTabsToWorkspace(saveTabs, workspaceId);
            toast(r.added ? `Added ${r.added} tab${r.added === 1 ? '' : 's'} to the workspace${r.skipped ? ` · ${r.skipped} skipped` : ''}` : 'Already saved in that workspace');
          } else {
            const r = await saveTabsAsSession(saveTabs, groups, { workspaceId, name });
            if (!r.session) throw new Error('Nothing to save — none of those tabs are web pages.');
            toast(`Saved ${r.session.tabs.length} tab${r.session.tabs.length === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} skipped (not web pages)` : ''}`);
          }
        }}
      />
      <GroupingRulesModal open={rulesOpen} current={settings.smartGrouping} onClose={() => setRulesOpen(false)} />
      <MoveToGroupModal
        open={!!moveModal}
        groups={groups}
        onClose={() => setMoveModal(null)}
        onPick={(gid) => {
          const ids = moveModal ?? [];
          setMoveModal(null);
          void run(() => moveTabsToGroup(ids, gid), 'Moved to group');
        }}
        onNewGroup={() => {
          const ids = moveModal ?? [];
          setMoveModal(null);
          setGroupModal({ kind: 'create', tabIds: ids });
        }}
      />
    </>
  );
}

