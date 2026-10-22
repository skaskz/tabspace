import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Card, IconButton, Toggle } from '@/components/ui';
import { update } from '@/storage/store';
import type { Settings } from '@/types/models';

/** Serialised settings write (re-reads storage so concurrent edits from other pages are kept). */
export function patchSettings(fn: (s: Settings) => Settings): Promise<Settings> {
  return update('ts.settings', fn);
}

export function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <Card as="section" id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} className="scroll-mt-6 px-6 py-5">
      <h2 id={`settings-${id}-title`} className="text-[17px] font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
      <div className="mt-4 flex flex-col divide-y divide-line">{children}</div>
    </Card>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5 max-md:flex-col max-md:items-start">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <div className="mt-0.5 text-[12.5px] text-muted">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Row label={label} hint={hint}>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </Row>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1 rounded-[var(--radius-ctl)] border border-line bg-surface-2 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate text-[12.5px]" title={value}>
        {value}
      </code>
      <IconButton
        label={copied ? 'Copied' : label}
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </IconButton>
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'off' | 'pending'; children: ReactNode }) {
  const dot = { ok: 'bg-success', warn: 'bg-warn', off: 'bg-faint', pending: 'bg-muted animate-pulse' }[tone];
  return (
    <span role="status" className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-[12px] text-muted">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}
