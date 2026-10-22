import { useEffect, useState } from 'react';
import { BookmarkPlus, Info, Keyboard, PanelRight, StickyNote } from 'lucide-react';
import { PageHero } from '@/components/layout/PageHero';
import { Button, Card, CardHeader, Kbd, Select, Toggle, useToast } from '@/components/ui';
import { useSettings } from '@/hooks/useStore';
import { update } from '@/storage/store';
import { SidePanel } from '@/extension/sidebar/SidePanel';
import { SECTION_LABELS, SIDEBAR_SECTIONS } from '@/extension/sidebar/sections';
import { applySidebarEnabled, currentWindowId, hasSidePanel, openSidePanel, sidebarShortcut } from '@/extension/shared/sidePanel';
import type { Settings, SidebarDefaultView } from '@/types/models';
import { addNoteBookmark, hasBookmarksPermission } from '@/extension/shared/noteBookmark';
import { TabspaceBarSettings } from './TabspaceBarSettings';
import { SearchThemeSettings } from './SearchThemeSettings';

function patchSidebar(fn: (s: Settings['sidebar']) => Settings['sidebar']) {
  return update('ts.settings', (s) => ({ ...s, sidebar: fn(s.sidebar) }));
}

export default function SidebarSettingsPage() {
  const [settings] = useSettings();
  const toast = useToast();
  const [noteShortcut, setNoteShortcut] = useState<string | null>(null);
  const [hadBookmarks, setHadBookmarks] = useState(false);
  const [windowId, setWindowId] = useState<number | null>(null);
  const [shortcut, setShortcut] = useState<string | null>(null);
  const available = hasSidePanel();
  const { enabled, sections } = settings.sidebar;
  const defaultView = settings.sidebar.defaultView ?? 'last';

  useEffect(() => {
    void hasBookmarksPermission().then(setHadBookmarks);
    if (typeof chrome !== 'undefined' && chrome.commands?.getAll)
      void chrome.commands
        .getAll()
        .then((c) => setNoteShortcut(c.find((x) => x.name === 'quick-note')?.shortcut ?? ''))
        .catch(() => undefined);
  }, []);

  const addBookmark = () => {
    // Requested synchronously inside the click; the permission is released again afterwards.
    void addNoteBookmark(hadBookmarks).then((r) => {
      const msg: Record<typeof r, [string, 'info' | 'error']> = {
        added: ['“+ New Note” added to your bookmarks bar', 'info'],
        exists: ['The “+ New Note” bookmark already exists', 'info'],
        denied: ['No bookmark added — permission was not granted', 'error'],
        unavailable: ['Bookmarks are only available inside the Chrome extension', 'error'],
        error: ['Chrome could not create the bookmark', 'error'],
      };
      toast(...msg[r]);
    });
  };

  useEffect(() => {
    void currentWindowId().then(setWindowId);
    void sidebarShortcut().then(setShortcut);
  }, []);

  const setEnabled = async (v: boolean) => {
    await patchSidebar((s) => ({ ...s, enabled: v }));
    await applySidebarEnabled(v).catch(() => undefined);
  };

  const open = () => {
    if (windowId === null) return;
    // Synchronous call inside the click: Chrome requires a user gesture for sidePanel.open().
    openSidePanel(windowId).catch((e: unknown) => toast(e instanceof Error ? e.message : 'Chrome could not open the sidebar', 'error'));
  };

  const openShortcuts = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  };

  return (
    <div className="max-w-[1400px]">
      <PageHero title="Chrome Sidebar" subtitle="Keep your workspace, tools, and focus right inside your browser." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Sidebar" icon={<PanelRight size={17} />} action={<Toggle label="Enable sidebar" checked={enabled} onChange={(v) => void setEnabled(v)} />} />
            <div className="px-5 pb-5">
              <p className="text-[13px] text-muted">
                {enabled ? 'The sidebar is enabled. Open it from the toolbar popup, the shortcut, or here.' : 'The sidebar is disabled. Your tasks, notes and settings are kept — turn it back on any time (also from the toolbar popup).'}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="primary" icon={<PanelRight size={16} />} onClick={open} disabled={!available || !enabled || windowId === null}>
                  Open Sidebar
                </Button>
                {shortcut ? (
                  <span className="flex items-center gap-2 text-[13px] text-muted">
                    <Keyboard size={15} aria-hidden /> Shortcut <Kbd>{shortcut}</Kbd>
                  </span>
                ) : shortcut === '' ? (
                  <span className="text-[13px] text-muted">No shortcut assigned.</span>
                ) : null}
                {shortcut !== null && (
                  <Button variant="ghost" size="sm" onClick={openShortcuts}>
                    Change shortcut
                  </Button>
                )}
              </div>
              {!available && <p className="mt-3 text-xs text-faint">The side panel API is only available when Tabspace runs as a Chrome extension.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Visible Sections" />
            <div className="divide-y divide-line px-5 pb-3">
              {SIDEBAR_SECTIONS.map((s) => (
                <div key={s} className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-sm">{SECTION_LABELS[s]}</span>
                  <Toggle label={`Show ${SECTION_LABELS[s]} in the sidebar`} checked={sections[s]} onChange={(v) => void patchSidebar((sb) => ({ ...sb, sections: { ...sb.sections, [s]: v } }))} />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Default View" />
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-5">
              <label htmlFor="sidebar-default" className="text-[13px] text-muted">
                Section shown when the sidebar opens
              </label>
              <Select id="sidebar-default" value={defaultView} onChange={(e) => {
                  // Read synchronously: the updater runs later, after React has reset the controlled select.
                  const value = e.target.value as SidebarDefaultView;
                  void patchSidebar((sb) => ({ ...sb, defaultView: value }));
                }}>
                <option value="last">Last used</option>
                {SIDEBAR_SECTIONS.map((s) => (
                  <option key={s} value={s} disabled={!sections[s]}>
                    {SECTION_LABELS[s]}
                    {!sections[s] ? ' (hidden)' : ''}
                  </option>
                ))}
              </Select>
            </div>
          </Card>

          <TabspaceBarSettings />

          <SearchThemeSettings />

          <Card>
            <CardHeader title="Quick Note" icon={<StickyNote size={17} />} />
            <div className="flex flex-col gap-3 px-5 pb-5 text-[13px] text-muted">
              <p>
                Jot a note from the toolbar popup (+ New Note), or press{' '}
                {noteShortcut ? <Kbd>{noteShortcut}</Kbd> : <span className="text-faint">the Quick Note shortcut (not assigned)</span>} anywhere in Chrome.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" icon={<BookmarkPlus size={15} />} onClick={addBookmark}>
                  Add “+ New Note” to bookmarks bar
                </Button>
                <span className="text-xs text-faint">Asks for bookmark access once, then gives it back. Opens the note editor in a tab.</span>
              </div>
            </div>
          </Card>

          <Card className="flex gap-3 px-5 py-4">
            <Info size={17} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <p className="text-[13px] text-muted">
              Chrome controls the side panel’s width and which side of the window it appears on (Chrome settings → Appearance → Side panel position). Tabspace is designed to look right from about 320px to 400px and wider.
            </p>
          </Card>
        </div>

        <Card className="flex flex-col self-start p-4">
          <h2 className="mb-3 px-1 text-[15px] font-semibold">Preview</h2>
          <div className="mx-auto h-[600px] w-full max-w-[360px] overflow-hidden rounded-xl border border-line-strong" aria-label="Live sidebar preview">
            {enabled ? (
              <SidePanel preview headingLevel={3} />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-faint">Sidebar is disabled</div>
            )}
          </div>
          <p className="mt-3 px-1 text-xs text-faint">Live — uses your real data. Actions here work just like in the sidebar.</p>
        </Card>
      </div>
    </div>
  );
}
