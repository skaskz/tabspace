import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppWindow, Bookmark, CheckSquare, FileText, LayoutGrid, Plus, Search, Timer } from 'lucide-react';
import { navigate } from '@/app/router';
import { useStore } from '@/hooks/useStore';
import { patch } from '@/storage/store';
import { Favicon, Kbd, useToast } from '@/components/ui';
import { cn } from '@/utils/cn';
import { GROUP_LABEL, search, type ResultKind, type SearchResult } from '@/features/search/rank';
import { activateTab, openLink, ownExtensionPrefix, queryOpenTabs, type OpenTab } from '@/features/search/chromeTabs';
import { createTask } from '@/features/tasks/actions';
import { startFocus } from '@/services/focus';

const KIND_ICON: Record<ResultKind, ReactNode> = {
  tab: <AppWindow size={16} />,
  workspace: <LayoutGrid size={16} />,
  task: <CheckSquare size={16} />,
  note: <FileText size={16} />,
  bookmark: <Bookmark size={16} />,
};

interface Item {
  key: string;
  label: string;
  subtitle?: string;
  icon: ReactNode;
  run: () => void | Promise<void>;
}

/** Global search palette (Ctrl/⌘+K): tabs, workspaces, tasks, notes and bookmarks. */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [tasks] = useStore('ts.tasks');
  const [notes] = useStore('ts.notes');
  const [bookmarks] = useStore('ts.bookmarks');
  const [workspaces] = useStore('ts.workspaces');
  const [focus] = useStore('ts.focus');
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const prev = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => inputRef.current?.focus());
    const own = ownExtensionPrefix();
    queryOpenTabs()
      .then((t) => setTabs(own ? t.filter((x) => !x.url.startsWith(own)) : t))
      .catch(() => setTabs([]));
    return () => prev?.focus?.();
  }, [open]);

  const groups = useMemo(() => search(query, { tasks, notes, bookmarks, workspaces, tabs }), [query, tasks, notes, bookmarks, workspaces, tabs]);

  const safe = (fn: () => void | Promise<void>, err: string) => async () => {
    onClose();
    try {
      await fn();
    } catch {
      toast(err, 'error');
    }
  };

  const toItem = (r: SearchResult): Item => {
    const base = { key: `${r.kind}:${r.id}`, label: r.title, subtitle: r.subtitle };
    switch (r.kind) {
      case 'tab':
        return { ...base, icon: r.url ? <Favicon url={r.url} size={16} /> : KIND_ICON.tab, run: safe(() => activateTab(r.tab!), 'Could not switch to that tab.') };
      case 'workspace':
        return { ...base, icon: KIND_ICON.workspace, run: safe(() => navigate('workspaces', { id: r.id }), '') };
      case 'task':
        return { ...base, icon: KIND_ICON.task, run: safe(() => navigate('tasks', { id: r.id }), '') };
      case 'note':
        return { ...base, icon: KIND_ICON.note, run: safe(() => navigate('notes', { id: r.id }), '') };
      case 'bookmark':
        return {
          ...base,
          icon: r.url ? <Favicon url={r.url} size={16} /> : KIND_ICON.bookmark,
          run: safe(async () => {
            if (!(await openLink(r.url!))) throw new Error('unsafe');
            await patch('ts.bookmarks', r.id, { lastOpenedAt: Date.now() });
          }, 'Could not open that link.'),
        };
    }
  };

  const quickActions: Item[] = [
    {
      key: 'new-task',
      label: 'New task',
      icon: <Plus size={16} />,
      run: safe(async () => {
        const t = await createTask({ title: 'New task' });
        navigate('tasks', { id: t.id });
      }, 'Could not create a task.'),
    },
    { key: 'new-note', label: 'New note', icon: <FileText size={16} />, run: safe(() => navigate('notes', { new: '1' }), '') },
    {
      key: 'focus',
      label: focus.status === 'idle' ? 'Start focus session' : 'Open Focus Mode',
      icon: <Timer size={16} />,
      run: safe(async () => {
        if (focus.status === 'idle') await startFocus();
        navigate('focus');
      }, 'Could not start a focus session.'),
    },
  ];

  const sections: { label: string; items: Item[] }[] = query.trim()
    ? groups.map((g) => ({ label: GROUP_LABEL[g.kind], items: g.results.map(toItem) }))
    : [{ label: 'Quick actions', items: quickActions }];
  const flat = sections.flatMap((s) => s.items);
  const clamped = Math.min(active, Math.max(0, flat.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${clamped}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [clamped]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (flat.length ? (Math.min(a, flat.length - 1) + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (flat.length ? (Math.min(a, flat.length - 1) - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void flat[clamped]?.run();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // keep focus in the palette
    }
  };

  let index = -1;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="ts-card ts-fade-in w-full max-w-[640px] overflow-hidden shadow-2xl" style={{ background: 'var(--ts-bg)' }} onKeyDown={onKeyDown}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="text-faint" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search tabs, workspaces, tasks, notes, bookmarks…"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="ts-search-results"
            aria-activedescendant={flat[clamped] ? `ts-sr-${clamped}` : undefined}
            className="my-2 h-10 min-w-0 flex-1 rounded-md bg-transparent px-2 text-[15px] outline-none placeholder:text-faint focus-visible:outline-none! focus-visible:ring-2 focus-visible:ring-fg/40"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id="ts-search-results" role="listbox" aria-label="Results" className="max-h-[56vh] overflow-y-auto p-2">
          {flat.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">No results for “{query.trim()}”.</p>
          ) : (
            sections.map((s) => (
              <div key={s.label} role="group" aria-label={s.label} className="mb-1">
                <div className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">{s.label}</div>
                {s.items.map((item) => {
                  index++;
                  const i = index;
                  return (
                    <div
                      key={item.key}
                      id={`ts-sr-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={i === clamped}
                      onMouseMove={() => i !== clamped && setActive(i)}
                      onClick={() => void item.run()}
                      className={cn('flex cursor-pointer items-center gap-3 rounded-[var(--radius-ctl)] border px-3 py-2', i === clamped ? 'ts-active' : 'border-transparent')}
                    >
                      <span className="flex w-5 shrink-0 justify-center text-muted">{item.icon}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                      {item.subtitle && <span className="max-w-[40%] shrink-0 truncate text-xs text-faint">{item.subtitle}</span>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-faint">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd> open
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
