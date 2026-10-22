import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '@/features/tasks/quickAdd';

const NOW = new Date(2026, 9, 21, 10, 0);

describe('parseQuickAdd', () => {
  it('returns null for empty input', () => {
    expect(parseQuickAdd('   ', NOW)).toBeNull();
  });
  it('plain title is trimmed', () => {
    expect(parseQuickAdd('  Go for a run ', NOW)).toEqual({ title: 'Go for a run' });
  });
  it('trailing today / tomorrow', () => {
    expect(parseQuickAdd('Go for a run today', NOW)).toEqual({ title: 'Go for a run', dueDate: '2026-10-21' });
    expect(parseQuickAdd('Edit YouTube Short Tomorrow', NOW)).toEqual({ title: 'Edit YouTube Short', dueDate: '2026-10-22' });
  });
  it('priority tokens in any order with a date', () => {
    expect(parseQuickAdd('Push Tabspace to GitHub tomorrow !high', NOW)).toEqual({ title: 'Push Tabspace to GitHub', dueDate: '2026-10-22', priority: 'high' });
    expect(parseQuickAdd('Push Tabspace to GitHub !med today', NOW)).toEqual({ title: 'Push Tabspace to GitHub', dueDate: '2026-10-21', priority: 'medium' });
    expect(parseQuickAdd('Review job applications !low', NOW)).toEqual({ title: 'Review job applications', priority: 'low' });
  });
  it('someday', () => {
    expect(parseQuickAdd('Learn Rust someday', NOW)).toEqual({ title: 'Learn Rust', someday: true });
  });
  it('only strips tokens from the end', () => {
    expect(parseQuickAdd('today is leg day', NOW)).toEqual({ title: 'today is leg day' });
  });
  it('never produces an empty title', () => {
    expect(parseQuickAdd('today', NOW)).toEqual({ title: 'today' });
    expect(parseQuickAdd('!high', NOW)).toEqual({ title: '!high' });
  });
  it('stops at a second conflicting date token', () => {
    expect(parseQuickAdd('Plan trip today tomorrow', NOW)).toEqual({ title: 'Plan trip today', dueDate: '2026-10-22' });
  });
  it('rolls over month boundaries', () => {
    expect(parseQuickAdd('Run tomorrow', new Date(2026, 9, 31))?.dueDate).toBe('2026-11-01');
  });
});
