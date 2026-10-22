import { useRef, useState } from 'react';
import { ImagePlus, Monitor, Moon, Sun, Trash2 } from 'lucide-react';
import { Button, Input, Segmented, Select, useToast } from '@/components/ui';
import type { PageId, Settings } from '@/types/models';
import { cn } from '@/utils/cn';
import { patchSettings, Row, Section, ToggleRow } from './shared';
import { isWidgetVisible, setWidgetVisible } from '@/extension/newtab/layout';

export const MAX_BG_BYTES = 5 * 1024 * 1024;
const BG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Read an image file as a data URL after type/size checks (pure-ish helper, exported for tests). */
export function readBackgroundImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!BG_TYPES.includes(file.type)) return reject(new Error('Choose a JPG, PNG or WEBP image.'));
    if (file.size > MAX_BG_BYTES) return reject(new Error('The image must be 5 MB or smaller.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.onload = () => {
      const url = String(reader.result ?? '');
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(url)) return reject(new Error('Choose a JPG, PNG or WEBP image.'));
      resolve(url);
    };
    reader.readAsDataURL(file);
  });
}

export function AppearanceSection({ settings }: { settings: Settings }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const themes = [
    { value: 'dark' as const, label: 'Dark', icon: <Moon size={18} />, hint: 'Default' },
    { value: 'light' as const, label: 'Light', icon: <Sun size={18} /> },
    { value: 'auto' as const, label: 'Auto', icon: <Monitor size={18} />, hint: 'Match system' },
  ];
  return (
    <Section id="appearance" title="Appearance" description="Theme, background and motion.">
      <div className="py-3.5">
        <p className="mb-2.5 text-sm font-medium" id="theme-label">
          Theme
        </p>
        <div role="radiogroup" aria-labelledby="theme-label" className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          {themes.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={settings.theme === t.value}
              onClick={() => void patchSettings((s) => ({ ...s, theme: t.value }))}
              className={cn('flex items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3.5 text-left transition-colors', settings.theme === t.value ? 'ts-active' : 'border-line hover:border-line-strong')}
            >
              <span className="text-muted">{t.icon}</span>
              <span>
                <span className="block text-sm font-medium">{t.label}</span>
                {t.hint && <span className="block text-[12px] text-faint">{t.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
      <ToggleRow label="Starfield background" hint={settings.backgroundImage ? 'Hidden while a custom image is set.' : 'Subtle animated stars.'} checked={settings.starfield} onChange={(v) => void patchSettings((s) => ({ ...s, starfield: v }))} />
      <Row label="Custom background image" hint={bgError ? <span className="text-danger">{bgError}</span> : 'JPG, PNG or WEBP up to 5 MB. Stored only in this browser.'}>
        {settings.backgroundImage && <img src={settings.backgroundImage} alt="Current background" className="h-9 w-14 rounded-md border border-line object-cover" />}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Upload background image"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setBgError(null);
            readBackgroundImage(file)
              .then((url) => patchSettings((s) => ({ ...s, backgroundImage: url })))
              .then(() => toast('Background updated'))
              .catch((err: Error) => setBgError(err.message));
          }}
        />
        <Button size="sm" icon={<ImagePlus size={15} />} onClick={() => fileRef.current?.click()}>
          {settings.backgroundImage ? 'Replace' : 'Upload'}
        </Button>
        {settings.backgroundImage && (
          <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} onClick={() => void patchSettings((s) => ({ ...s, backgroundImage: undefined }))}>
            Remove
          </Button>
        )}
      </Row>
      <ToggleRow
        label="Background movement (parallax)"
        hint={
          !settings.starfield || settings.backgroundImage
            ? 'Needs the starfield background.'
            : !settings.animations || settings.reducedMotion
              ? 'Paused while animations are off or reduced motion is on.'
              : 'Stars drift gently in depth as you move the mouse.'
        }
        checked={settings.parallax}
        disabled={!settings.starfield || !!settings.backgroundImage}
        onChange={(v) => void patchSettings((s) => ({ ...s, parallax: v }))}
      />
      <ToggleRow label="Animations" checked={settings.animations} onChange={(v) => void patchSettings((s) => ({ ...s, animations: v }))} />
      <ToggleRow label="Reduced motion" hint="Minimise movement everywhere (also follows your system setting)." checked={settings.reducedMotion} onChange={(v) => void patchSettings((s) => ({ ...s, reducedMotion: v }))} />
      <Row label="Density">
        <Segmented
          label="Density"
          value={settings.density}
          onChange={(v) => void patchSettings((s) => ({ ...s, density: v }))}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
      </Row>
      <Row label="Text size">
        <Segmented
          label="Text size"
          value={settings.textScale}
          onChange={(v) => void patchSettings((s) => ({ ...s, textScale: v }))}
          options={[
            { value: 'sm', label: 'Small' },
            { value: 'md', label: 'Default' },
            { value: 'lg', label: 'Large' },
          ]}
        />
      </Row>
    </Section>
  );
}

const PAGE_OPTIONS: { value: PageId; label: string }[] = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'workspaces', label: 'Workspaces' },
  { value: 'tabs', label: 'Tabs' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'notes', label: 'Notes' },
  { value: 'bookmarks', label: 'Bookmarks' },
  { value: 'focus', label: 'Focus Mode' },
];

const WIDGETS: { key: keyof Settings['dashboardWidgets']; label: string }[] = [
  { key: 'quickActions', label: 'Quick actions' },
  { key: 'workspaces', label: 'Workspaces' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'recentTabs', label: 'Recent tabs' },
  { key: 'savedLinks', label: 'Saved links' },
];

export function LayoutSection({ settings }: { settings: Settings }) {
  return (
    <Section id="layout" title="Layout & Navigation" description="What opens first and what the dashboard, New Tab and toolbar popup show.">
      <Row label="Default page" hint="Opened when the dashboard starts without a specific page.">
        <Select aria-label="Default page" value={settings.defaultPage} onChange={(e) => {
            // Read synchronously: the updater runs later, after React has reset the controlled select.
            const defaultPage = e.target.value as PageId;
            void patchSettings((s) => ({ ...s, defaultPage }));
          }}>
          {PAGE_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Row>
      <div className="py-3.5">
        <p className="text-sm font-medium">Dashboard widgets</p>
        <div className="mt-2 grid grid-cols-2 gap-x-8 max-md:grid-cols-1">
          {WIDGETS.map((w) => (
            <ToggleRow key={w.key} label={w.label} checked={settings.dashboardWidgets[w.key]} onChange={(v) => void patchSettings((s) => ({ ...s, dashboardWidgets: { ...s.dashboardWidgets, [w.key]: v } }))} />
          ))}
        </div>
      </div>
      <ToggleRow label="Replace New Tab page" hint="When off, new tabs hand over to Chrome’s own New Tab page." checked={settings.newTab.enabled} onChange={(v) => void patchSettings((s) => ({ ...s, newTab: { ...s.newTab, enabled: v } }))} />
      {/* Same source of truth as New Tab → Customize: these show/hide the widget in the layout. */}
      <ToggleRow label="New Tab: daily quote" checked={isWidgetVisible(settings.newTab, 'quote')} disabled={!settings.newTab.enabled} onChange={(v) => void patchSettings((s) => ({ ...s, newTab: setWidgetVisible(s.newTab, 'quote', v) }))} />
      <ToggleRow label="New Tab: focus timer" checked={isWidgetVisible(settings.newTab, 'focus')} disabled={!settings.newTab.enabled} onChange={(v) => void patchSettings((s) => ({ ...s, newTab: setWidgetVisible(s.newTab, 'focus', v) }))} />
      <Row label="New Tab search engine">
        <Select aria-label="New Tab search engine" disabled={!settings.newTab.enabled} value={settings.newTab.searchEngine} onChange={(e) => {
            const searchEngine = e.target.value as Settings['newTab']['searchEngine'];
            void patchSettings((s) => ({ ...s, newTab: { ...s.newTab, searchEngine } }));
          }}>
          <option value="google">Google</option>
          <option value="duckduckgo">DuckDuckGo</option>
          <option value="bing">Bing</option>
        </Select>
      </Row>
      <ToggleRow
        label="Quick Note: attach current page link by default"
        hint="New notes from the toolbar popup start with the page you’re on attached."
        checked={settings.quickNote.attachUrl}
        onChange={(v) => void patchSettings((s) => ({ ...s, quickNote: { ...s.quickNote, attachUrl: v } }))}
      />
    </Section>
  );
}

function MinutesInput({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(String(value));
  }
  const commit = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n < min || n > max) return setDraft(String(value));
    if (n !== value) onCommit(n);
  };
  return <Input type="number" aria-label={label} min={min} max={max} className="w-24" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

export function FocusSection({ settings }: { settings: Settings }) {
  const f = settings.focus;
  const set = (k: keyof Settings['focus'], v: number) => void patchSettings((s) => ({ ...s, focus: { ...s.focus, [k]: v } }));
  return (
    <Section id="focus" title="Focus preferences" description="Default lengths in minutes, and the end-of-session chime.">
      <Row label="Focus session">
        <MinutesInput label="Focus session minutes" value={f.focusMin} min={1} max={180} onCommit={(v) => set('focusMin', v)} />
      </Row>
      <Row label="Short break">
        <MinutesInput label="Short break minutes" value={f.shortMin} min={1} max={60} onCommit={(v) => set('shortMin', v)} />
      </Row>
      <Row label="Long break">
        <MinutesInput label="Long break minutes" value={f.longMin} min={1} max={90} onCommit={(v) => set('longMin', v)} />
      </Row>
      <Row label="Custom session">
        <MinutesInput label="Custom session minutes" value={f.customMin} min={1} max={240} onCommit={(v) => set('customMin', v)} />
      </Row>
      <Row label="Daily sessions goal">
        <MinutesInput label="Daily sessions goal" value={f.sessionsGoal} min={1} max={24} onCommit={(v) => set('sessionsGoal', v)} />
      </Row>
      <ToggleRow label="Completion sound" hint="A soft chime when a focus session or break ends." checked={f.sound} onChange={(v) => void patchSettings((s) => ({ ...s, focus: { ...s.focus, sound: v } }))} />
    </Section>
  );
}

export function NotificationsSection({ settings }: { settings: Settings }) {
  const n = settings.notifications;
  const set = (k: keyof Settings['notifications'], v: boolean) => void patchSettings((s) => ({ ...s, notifications: { ...s.notifications, [k]: v } }));
  return (
    <Section id="notifications" title="Notifications" description="Shown as Chrome notifications. Your operating system may also need to allow notifications from Chrome.">
      <ToggleRow label="Task reminders" hint="At the due time, for tasks with a due date and time." checked={n.tasks} onChange={(v) => set('tasks', v)} />
      <ToggleRow label="Event reminders" hint="For events with a reminder set." checked={n.events} onChange={(v) => set('events', v)} />
      <ToggleRow label="Focus timer" hint="When a focus session or break ends." checked={n.focus} onChange={(v) => set('focus', v)} />
    </Section>
  );
}
