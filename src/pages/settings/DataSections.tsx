import { useEffect, useRef, useState } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { Button, Checkbox, Input, Kbd, Modal, useConfirm, useToast } from '@/components/ui';
import { useStore } from '@/hooks/useStore';
import type { Settings } from '@/types/models';
import { formatRelative } from '@/utils/date';
import { IMPORT_MAX_BYTES, parseImport, type ImportOk } from '@/features/data/validate';
import { applyImport, clearAllData, deleteUsageData, downloadText, exportJson, resetPreferences, restoreSnapshot, takeSnapshot } from '@/services/backup';
import { loadSampleData, removeSampleData } from '@/services/sampleData';
import { patchSettings, Row, Section, ToggleRow } from './shared';
import { UpdateNotice } from '@/components/UpdateNotice';

export function PrivacySection({ settings }: { settings: Settings }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [usage] = useStore('ts.usage');
  const days = Object.keys(usage).length;
  return (
    <Section id="privacy" title="Privacy" description="Everything Tabspace stores stays in this browser. There is no account, no analytics and no server.">
      <ToggleRow
        label="Track website usage"
        hint="Records only the website domain (e.g. github.com) and how long its tab was active. Never full addresses, titles or page content. Stored locally, never transmitted. Used only for Analytics."
        checked={settings.analytics.trackWebsites}
        onChange={(v) => void patchSettings((s) => ({ ...s, analytics: { ...s.analytics, trackWebsites: v } }))}
      />
      <Row label="Delete usage data" hint={days ? `${days} day${days === 1 ? '' : 's'} of website usage stored. Deleting also removes it from local backup snapshots.` : 'No website usage stored.'}>
        <Button
          size="sm"
          variant="danger"
          disabled={!days}
          onClick={() =>
            void confirm({ title: 'Delete website usage data?', message: 'All recorded website time is permanently deleted.', confirmLabel: 'Delete', danger: true }).then(async (ok) => {
              if (!ok) return;
              await deleteUsageData();
              toast('Usage data deleted');
            })
          }
        >
          Delete
        </Button>
      </Row>
      <div className="py-3.5 text-[12.5px] text-muted">
        <p className="font-medium text-fg">Privacy notes</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>Workspaces, tabs, tasks, notes, bookmarks, events and settings live in chrome.storage on this device.</li>
          <li>Google and Spotify connect directly from your browser using your own developer client IDs; tokens are stored under separate secret keys, never exported, and deleted on Disconnect.</li>
          <li>ICS feed links are private: they are fetched directly from the site you allow, never through a proxy, and left out of exports unless you choose to include them.</li>
          <li>Backups you export are plain JSON files — keep them somewhere safe.</li>
        </ul>
      </div>
    </Section>
  );
}

export function DataSection() {
  const confirm = useConfirm();
  const toast = useToast();
  const [backups] = useStore('ts.backups');
  const [sampleIds] = useStore('ts.sampleIds');
  const hasSample = Object.values(sampleIds).some((ids) => ids.length > 0);
  const [includeFeeds, setIncludeFeeds] = useState(false);
  const [pending, setPending] = useState<ImportOk | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    const { filename, json } = await exportJson({ includeFeedUrls: includeFeeds });
    downloadText(filename, json);
  };

  const onFile = async (file: File | undefined) => {
    setImportError(null);
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) return setImportError(`This file is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB.`);
    const r = parseImport(await file.text());
    if (!r.ok) return setImportError(r.error);
    setPending(r);
  };

  const runImport = async (mode: 'merge' | 'replace') => {
    if (!pending) return;
    if (mode === 'replace') {
      const ok = await confirm({ title: 'Replace all data?', message: 'Everything currently in Tabspace (except connected accounts) is replaced with the backup. A snapshot of your current data is saved first and can be restored below.', confirmLabel: 'Replace', danger: true });
      if (!ok) return;
    }
    await applyImport(pending, mode);
    setPending(null);
    toast(mode === 'merge' ? 'Backup merged' : 'Backup restored');
  };

  return (
    <Section id="data" title="Data & Backup" description="Export, import and automatic local snapshots. Cloud sync is not available — your data stays on this device.">
      <Row label="Export data" hint="A JSON file with all your Tabspace data and settings — includes website usage if tracking was on. Connected-account tokens are never included.">
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          <Checkbox size="sm" checked={includeFeeds} onChange={setIncludeFeeds} label="Include private calendar feed links" />
          Include feed links
        </label>
        <Button size="sm" icon={<Download size={15} />} onClick={() => void doExport()}>
          Export
        </Button>
      </Row>
      <Row label="Import data" hint={importError ? <span role="alert" className="text-danger">{importError}</span> : 'Choose a Tabspace backup (.json, max 30 MB). You can merge it or replace everything.'}>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Choose backup file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            void onFile(f);
          }}
        />
        <Button size="sm" icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
          Import…
        </Button>
      </Row>
      <div className="py-3.5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Automatic backups</p>
            <p className="mt-0.5 text-[12.5px] text-muted">The last 3 snapshots are kept in this browser (taken daily and before every import or restore).</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void takeSnapshot('manual').then(() => toast('Snapshot saved'))
            }
          >
            Back up now
          </Button>
        </div>
        {backups.length === 0 ? (
          <p className="mt-2 text-[13px] text-faint">No snapshots yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {backups.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-glow">
                <span>
                  {new Date(b.takenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  <span className="ml-2 text-faint">
                    {{ daily: 'Daily', import: 'Before import', manual: 'Manual', restore: 'Before restore' }[b.reason]} · {formatRelative(b.takenAt)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RotateCcw size={14} />}
                  onClick={() =>
                    void confirm({ title: 'Restore this snapshot?', message: 'Your current data is replaced with this snapshot. A snapshot of the current data is saved first.', confirmLabel: 'Restore', danger: true }).then(async (ok) => {
                      if (!ok) return;
                      await restoreSnapshot(b.id);
                      toast('Snapshot restored');
                    })
                  }
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Row label="Example data" hint={hasSample ? 'Example workspaces, tasks, notes, bookmarks and events are loaded.' : 'Add a few clearly-editable examples to explore Tabspace.'}>
        {hasSample ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void confirm({ title: 'Remove example data?', message: 'Only the example records are deleted (including events in the example “Personal” calendar). Your own data is kept.', confirmLabel: 'Remove', danger: true }).then(async (ok) => {
                if (!ok) return;
                await removeSampleData();
                toast('Example data removed');
              })
            }
          >
            Remove example data
          </Button>
        ) : (
          <Button size="sm" onClick={() => void loadSampleData().then(() => toast('Example data loaded'))}>
            Load example data
          </Button>
        )}
      </Row>
      <Row label="Reset preferences" hint="Appearance, layout, focus and notification settings go back to defaults. Your data, name and client IDs are kept.">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void confirm({ title: 'Reset preferences?', message: 'Settings return to their defaults. Your data is not affected.', confirmLabel: 'Reset', danger: true }).then(async (ok) => {
              if (!ok) return;
              await resetPreferences();
              toast('Preferences reset');
            })
          }
        >
          Reset
        </Button>
      </Row>
      <Row label="Clear all local data" hint="Permanently deletes everything Tabspace stores in this browser, including backups and connected accounts.">
        <Button size="sm" variant="danger" onClick={() => setClearOpen(true)}>
          Clear all data
        </Button>
      </Row>

      {pending && <ImportModal result={pending} onClose={() => setPending(null)} onImport={(m) => void runImport(m)} />}
      {clearOpen && <ClearModal onClose={() => setClearOpen(false)} />}
    </Section>
  );
}

const KEY_LABELS: Record<string, string> = {
  'ts.workspaces': 'Workspaces',
  'ts.sessions': 'Saved sessions',
  'ts.tasks': 'Tasks',
  'ts.notes': 'Notes',
  'ts.noteFolders': 'Note folders',
  'ts.bookmarks': 'Bookmarks',
  'ts.bookmarkFolders': 'Bookmark folders',
  'ts.quickLinks': 'Quick links',
  'ts.calendarSources': 'Calendars',
  'ts.events': 'Events',
  'ts.focusSessions': 'Focus sessions',
  'ts.usage': 'Days of website usage',
  'ts.workspaceActivity': 'Days of workspace activity',
};

function ImportModal({ result, onClose, onImport }: { result: ImportOk; onClose: () => void; onImport: (mode: 'merge' | 'replace') => void }) {
  const rows = Object.entries(result.counts).filter(([k]) => KEY_LABELS[k]);
  return (
    <Modal
      open
      onClose={onClose}
      title="Import backup"
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => onImport('replace')}>
            Replace all
          </Button>
          <Button variant="primary" onClick={() => onImport('merge')} data-autofocus>
            Merge
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">{result.exportedAt ? `Backup from ${new Date(result.exportedAt).toLocaleString()}.` : 'Tabspace backup.'} It contains:</p>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
          {rows.map(([k, n]) => (
            <li key={k} className="flex justify-between gap-2">
              <span className="text-muted">{KEY_LABELS[k]}</span>
              <span>{n}</span>
            </li>
          ))}
          {'ts.settings' in result.data && <li className="text-muted">Settings</li>}
        </ul>
        {result.warnings.length > 0 && (
          <ul className="space-y-1 rounded-[var(--radius-ctl)] border border-line bg-surface-2 p-3 text-[12.5px] text-muted">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <p className="text-[12.5px] text-faint"><b>Merge</b> adds new items and keeps the newer version of matching items (your current settings stay). <b>Replace all</b> swaps everything for the backup.</p>
      </div>
    </Modal>
  );
}

function ClearModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const toast = useToast();
  return (
    <Modal
      open
      onClose={onClose}
      title="Clear all local data?"
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={text !== 'DELETE'}
            onClick={() =>
              void clearAllData().then(() => {
                onClose();
                toast('All local data cleared');
              })
            }
          >
            Delete everything
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-muted">
        <p>This permanently deletes all workspaces, tasks, notes, bookmarks, events, settings, backups and connected accounts in this browser. Export a backup first if you might need it.</p>
        <label className="block">
          Type <b className="text-fg">DELETE</b> to confirm
          <Input className="mt-1.5" data-autofocus value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </label>
      </div>
    </Modal>
  );
}

export function AboutSection({ settings }: { settings: Settings }) {
  const [name, setName] = useState(settings.userName);
  useEffect(() => setName(settings.userName), [settings.userName]);
  const [commands, setCommands] = useState<{ description: string; shortcut: string }[] | null>(null);
  const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : null;
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.commands?.getAll) return;
    void chrome.commands.getAll().then((cmds) => setCommands(cmds.filter((c) => c.name !== '_execute_action').map((c) => ({ description: c.description || c.name || '', shortcut: c.shortcut || '' }))));
  }, []);

  const saveName = () => {
    const v = name.trim().slice(0, 60);
    if (v !== settings.userName) void patchSettings((s) => ({ ...s, userName: v }));
  };

  return (
    <Section id="account" title="Account & About">
      <Row label="Your name" hint="Used for the dashboard greeting. Stays on this device.">
        <Input aria-label="Your name" className="w-56" value={name} maxLength={60} placeholder="e.g. Alex" onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && saveName()} />
      </Row>
      <Row label="Version">
        <span className="text-sm text-muted">{version ? `Tabspace ${version}` : 'Development preview'}</span>
      </Row>
      <ToggleRow
        label="Check for updates"
        hint="Asks GitHub twice a day whether a newer Tabspace release exists. Nothing about you is sent."
        checked={settings.updates.check}
        onChange={(v) => void patchSettings((s) => ({ ...s, updates: { ...s.updates, check: v } }))}
      />
      <div className="py-3.5">
        <UpdateNotice variant="card" />
      </div>
      <div className="py-3.5">
        <p className="text-sm font-medium">Keyboard shortcuts</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
          <li className="flex items-center justify-between">
            <span className="text-muted">Search everything (dashboard)</span>
            <Kbd>{mac ? '⌘ K' : 'Ctrl K'}</Kbd>
          </li>
          {commands?.map((c) => (
            <li key={c.description} className="flex items-center justify-between">
              <span className="text-muted">{c.description}</span>
              {c.shortcut ? <Kbd>{c.shortcut}</Kbd> : <span className="text-faint">Not set</span>}
            </li>
          ))}
          {commands === null && <li className="text-faint">Extension shortcuts are listed inside the installed extension.</li>}
        </ul>
        <p className="mt-2 text-[12px] text-faint">Change extension shortcuts at chrome://extensions/shortcuts.</p>
      </div>
      <Row label="Privacy notes">
        <a href="#/settings?section=privacy" className="text-[13px] font-medium underline underline-offset-4">
          Read privacy notes
        </a>
      </Row>
    </Section>
  );
}
