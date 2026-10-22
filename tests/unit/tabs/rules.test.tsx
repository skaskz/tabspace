import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui';
import { get } from '@/storage/store';
import { DEFAULT_SETTINGS } from '@/storage/schema';
import { nextSmartGrouping, validateRules } from '@/features/tabs/rules';
import { GroupingRulesModal } from '@/pages/tabs/GroupingRulesModal';
import type { SmartGroupRule } from '@/types/models';

const rule = (id: string, pattern: string, groupTitle = 'Group'): SmartGroupRule => ({ id, pattern, groupTitle, color: 'blue' });

describe('validateRules', () => {
  it('requires non-empty pattern and title', () => {
    expect(validateRules([rule('a', '  ', ' ')])).toEqual({ a: { pattern: expect.any(String), groupTitle: expect.any(String) } });
  });
  it('rejects too-long values and duplicate patterns (trimmed, case-insensitive)', () => {
    const errs = validateRules([rule('a', 'GitHub.com'), rule('b', ' github.com '), rule('c', 'x'.repeat(101)), rule('d', 'ok', 'y'.repeat(101))]);
    expect(Object.keys(errs).sort()).toEqual(['b', 'c', 'd']);
    expect(errs.b.pattern).toMatch(/already/);
    expect(errs.d.groupTitle).toMatch(/100/);
  });
  it('accepts valid rules', () => {
    expect(validateRules([rule('a', 'roblox', 'Roblox research')])).toEqual({});
  });
});

describe('nextSmartGrouping', () => {
  it('trims rules and only keeps autoApply when enabled with rules', () => {
    expect(nextSmartGrouping({ enabled: true, autoApply: true, rules: [rule('a', ' x ', ' Y ')] })).toEqual({ enabled: true, autoApply: true, rules: [{ id: 'a', pattern: 'x', groupTitle: 'Y', color: 'blue' }] });
    expect(nextSmartGrouping({ enabled: true, autoApply: true, rules: [] }).autoApply).toBe(false);
    expect(nextSmartGrouping({ enabled: false, autoApply: true, rules: [rule('a', 'x')] }).autoApply).toBe(false);
  });
});

describe('GroupingRulesModal', () => {
  it('adds, validates, removes and saves rules to settings', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <GroupingRulesModal open current={DEFAULT_SETTINGS.smartGrouping} onClose={onClose} />
      </ToastProvider>,
    );
    const auto = screen.getByRole('switch', { name: /automatically group/i });
    expect(auto).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'Smart grouping suggestions' }));

    await user.click(screen.getByRole('button', { name: /add rule/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Enter text to match/);
    expect(onClose).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Rule 1 pattern'), 'github.com');
    await user.type(screen.getByLabelText('Rule 1 group name'), 'Development');
    await user.click(screen.getByRole('button', { name: /add rule/i }));
    await user.type(screen.getByLabelText('Rule 2 pattern'), 'GITHUB.COM');
    await user.type(screen.getByLabelText('Rule 2 group name'), 'Dup');
    expect(screen.getByRole('alert')).toHaveTextContent(/already uses this pattern/);
    await user.click(screen.getByRole('button', { name: 'Remove rule 2' }));
    expect(screen.queryByRole('alert')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Rule 1 colour'), 'purple');
    expect(auto).not.toBeDisabled();
    await user.click(auto);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const s = await get('ts.settings');
    expect(s.smartGrouping).toEqual({ enabled: true, autoApply: true, rules: [expect.objectContaining({ pattern: 'github.com', groupTitle: 'Development', color: 'purple' })] });
  });
});
