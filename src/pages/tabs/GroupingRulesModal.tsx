import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Input, Modal, Select, Toggle, useToast } from '@/components/ui';
import { newId, update } from '@/storage/store';
import type { GroupColor, Settings, SmartGroupRule } from '@/types/models';
import { GROUP_COLORS } from '@/features/tabs/serialize';
import { RULE_MAX_LENGTH, nextSmartGrouping, validateRules } from '@/features/tabs/rules';
import { errorMessage } from '@/pages/workspaces/sessionActions';
import { GroupDot } from './TabRow';

/** Configure settings.smartGrouping: enabled, autoApply and user rules. */
export function GroupingRulesModal({ open, current, onClose }: { open: boolean; current: Settings['smartGrouping']; onClose: () => void }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(current.enabled);
  const [autoApply, setAutoApply] = useState(current.autoApply);
  const [rules, setRules] = useState<SmartGroupRule[]>(current.rules);
  const [showErrors, setShowErrors] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEnabled(current.enabled);
      setAutoApply(current.autoApply);
      setRules(current.rules);
      setShowErrors(false);
    }
  }
  const errors = useMemo(() => validateRules(rules), [rules]);
  const hasErrors = Object.keys(errors).length > 0;
  const canAuto = enabled && rules.length > 0;

  const edit = (id: string, changes: Partial<SmartGroupRule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const add = () => setRules((rs) => [...rs, { id: newId(), pattern: '', groupTitle: '', color: 'grey' }]);
  const removeRule = (id: string) => setRules((rs) => rs.filter((r) => r.id !== id));

  const save = async () => {
    if (hasErrors) {
      setShowErrors(true);
      return;
    }
    try {
      const smartGrouping = nextSmartGrouping({ enabled, autoApply, rules });
      await update('ts.settings', (s) => ({ ...s, smartGrouping }));
      toast('Grouping rules saved');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Grouping rules"
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Smart grouping suggestions</span>
              <span className="block text-xs text-muted">Lets “Suggest groups” propose groups from your rules and common sites.</span>
            </span>
            <Toggle checked={enabled} onChange={setEnabled} label="Smart grouping suggestions" />
          </label>
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Automatically group new tabs using my rules</span>
              <span className="block text-xs text-muted">
                {canAuto ? 'Runs on your device when a page finishes loading. Nothing leaves the device.' : 'Turn on suggestions and add at least one rule to enable this.'}
              </span>
            </span>
            <Toggle checked={canAuto && autoApply} onChange={setAutoApply} label="Automatically group new tabs using my rules" disabled={!canAuto} />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-medium text-muted">Rules</h3>
            <span className="text-xs text-faint">Matches the site address or tab title (not case-sensitive). First match wins.</span>
          </div>
          {rules.length === 0 && <p className="rounded-[var(--radius-ctl)] border border-dashed border-line px-4 py-5 text-center text-[13px] text-muted">No rules yet. Example: “github.com” → Development.</p>}
          <ul className="flex flex-col gap-2">
            {rules.map((r, i) => {
              const err = showErrors ? errors[r.id] : undefined;
              return (
                <li key={r.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={`Rule ${i + 1} pattern`}
                      aria-invalid={!!err?.pattern}
                      placeholder="Text to match, e.g. roblox"
                      value={r.pattern}
                      maxLength={RULE_MAX_LENGTH + 20}
                      onChange={(e) => edit(r.id, { pattern: e.target.value })}
                      className="min-w-0 flex-1"
                    />
                    <span className="text-faint" aria-hidden>
                      →
                    </span>
                    <Input
                      aria-label={`Rule ${i + 1} group name`}
                      aria-invalid={!!err?.groupTitle}
                      placeholder="Group name"
                      value={r.groupTitle}
                      maxLength={RULE_MAX_LENGTH + 20}
                      onChange={(e) => edit(r.id, { groupTitle: e.target.value })}
                      className="min-w-0 flex-1"
                    />
                    <GroupDot color={r.color} />
                    <Select aria-label={`Rule ${i + 1} colour`} value={r.color} onChange={(e) => edit(r.id, { color: e.target.value as GroupColor })} className="h-10">
                      {GROUP_COLORS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                    <IconButton label={`Remove rule ${i + 1}`} onClick={() => removeRule(r.id)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                  {err && (
                    <p role="alert" className="text-xs text-danger">
                      {[err.pattern, err.groupTitle].filter(Boolean).join(' ')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <div>
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={add}>
              Add rule
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
