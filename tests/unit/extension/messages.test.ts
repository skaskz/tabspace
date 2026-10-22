import { describe, expect, it } from 'vitest';
import { isSidebarMessage } from '@/extension/shared/messages';

describe('isSidebarMessage', () => {
  it('accepts only the two sidebar messages with an optional non-negative integer windowId', () => {
    expect(isSidebarMessage({ type: 'sidebar:open' })).toBe(true);
    expect(isSidebarMessage({ type: 'sidebar:close', windowId: 3 })).toBe(true);
    expect(isSidebarMessage({ type: 'sidebar:open', windowId: -1 })).toBe(false);
    expect(isSidebarMessage({ type: 'sidebar:open', windowId: 1.5 })).toBe(false);
    expect(isSidebarMessage({ type: 'sidebar:open', windowId: '3' })).toBe(false);
    expect(isSidebarMessage({ type: 'focus:start' })).toBe(false);
    expect(isSidebarMessage('sidebar:open')).toBe(false);
    expect(isSidebarMessage(null)).toBe(false);
    expect(isSidebarMessage(undefined)).toBe(false);
  });
});
