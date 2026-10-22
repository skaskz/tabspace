import { describe, expect, it } from 'vitest';
import { applyImport, clearAllData, deleteUsageData, exportJson, maybeDailySnapshot, resetPreferences, restoreSnapshot, takeSnapshot } from '@/services/backup';
import { get, getAdapter, insert, set } from '@/storage/store';
import { DEFAULT_SETTINGS } from '@/storage/schema';
import { parseImport } from '@/features/data/validate';
import { buildSampleData, hasSampleData, loadSampleData, removeSampleData } from '@/services/sampleData';

const task = (title: string) => ({ title, done: false, priority: 'none' as const, subtasks: [], order: 0 });

describe('backup service', () => {
  it('exports JSON that round-trips through strict import (replace)', async () => {
    await insert('ts.tasks', task('Review job applications'));
    await set('ts.settings', { ...DEFAULT_SETTINGS, userName: 'Alex' });
    await getAdapter().set({ 'secret.spotify': { refreshToken: 'nope' } });
    const { json, filename } = await exportJson();
    expect(filename).toMatch(/^tabspace-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(json).not.toContain('nope');
    const parsed = parseImport(json);
    if (!parsed.ok) throw new Error(parsed.error);
    await set('ts.tasks', []);
    await applyImport(parsed, 'replace');
    expect((await get('ts.tasks')).map((t) => t.title)).toEqual(['Review job applications']);
    expect((await get('ts.settings')).userName).toBe('Alex');
    expect((await get('ts.backups'))[0].reason).toBe('import');
  });

  it('keeps only the last 3 snapshots and restores one', async () => {
    await insert('ts.tasks', task('one'));
    const first = await takeSnapshot('manual', 1);
    await insert('ts.tasks', task('two'));
    await takeSnapshot('manual', 2);
    await takeSnapshot('manual', 3);
    await takeSnapshot('manual', 4);
    const list = await get('ts.backups');
    expect(list).toHaveLength(3);
    expect(list.map((s) => s.takenAt)).toEqual([4, 3, 2]);
    expect(list.every((s) => !('ts.backups' in s.data))).toBe(true);
    expect(list.find((s) => s.id === first.id)).toBeUndefined();
    const target = list[2];
    await insert('ts.tasks', task('three'));
    await restoreSnapshot(target.id);
    expect((await get('ts.tasks')).map((t) => t.title)).toEqual(['one', 'two']);
  });

  it('delete usage data also strips it from backup snapshots', async () => {
    await set('ts.usage', { '2026-10-21': { 'github.com': 60_000 } });
    await insert('ts.tasks', task('keep'));
    await takeSnapshot('manual');
    await deleteUsageData();
    expect(await get('ts.usage')).toEqual({});
    const [snap] = await get('ts.backups');
    expect(snap.data).not.toHaveProperty('ts.usage');
    expect(snap.data['ts.tasks']).toHaveLength(1);
  });

  it('takes at most one daily snapshot per ~day and skips empty stores', async () => {
    expect(await maybeDailySnapshot(1_000_000)).toBe(false);
    await insert('ts.tasks', task('x'));
    expect(await maybeDailySnapshot(1_000_000)).toBe(true);
    expect(await maybeDailySnapshot(1_000_000 + 3600_000)).toBe(false);
    expect(await maybeDailySnapshot(1_000_000 + 21 * 3600_000)).toBe(true);
  });

  it('concurrent daily snapshot calls write only one snapshot', async () => {
    await insert('ts.tasks', task('x'));
    const results = await Promise.all([maybeDailySnapshot(5_000_000), maybeDailySnapshot(5_000_000), maybeDailySnapshot(5_000_000)]);
    expect(new Set(results).size).toBe(1); // callers share one in-flight run
    expect((await get('ts.backups')).filter((b) => b.reason === 'daily')).toHaveLength(1);
  });

  it('reset preferences keeps name and client ids; clear removes everything', async () => {
    await set('ts.settings', { ...DEFAULT_SETTINGS, theme: 'light', userName: 'J', integrations: { googleClientId: 'g' } });
    await resetPreferences();
    expect(await get('ts.settings')).toMatchObject({ theme: 'dark', userName: 'J', integrations: { googleClientId: 'g' } });
    await insert('ts.tasks', task('x'));
    await clearAllData();
    expect(await getAdapter().getAll()).toEqual({});
    expect(await get('ts.tasks')).toEqual([]);
  });
});

describe('sample data', () => {
  it('has no school content and only http(s) links', () => {
    const d = buildSampleData(new Date(2026, 9, 21));
    const text = JSON.stringify(d).toLowerCase();
    for (const banned of ['school', 'class', 'canvas', 'homework', 'exam', 'lecture']) expect(text).not.toContain(banned);
    for (const l of [...d.bookmarks, ...d.quickLinks]) expect(l.url).toMatch(/^https:\/\//);
    expect(d.workspaces.map((w) => w.name)).toEqual(['Development', 'Content Creation', 'Job Search', 'Personal']);
    // Events are in the current month.
    for (const e of d.events) expect(new Date(e.allDay ? `${e.start}T12:00` : e.start).getMonth()).toBe(9);
  });

  it('loads once and removes exactly the sample records', async () => {
    const mine = await insert('ts.tasks', task('My own task'));
    await loadSampleData();
    await loadSampleData(); // idempotent
    expect(await hasSampleData()).toBe(true);
    const tasks = await get('ts.tasks');
    expect(tasks.filter((t) => t.title === 'Push Tabspace to GitHub')).toHaveLength(1);
    expect((await get('ts.calendarSources')).map((s) => s.name)).toEqual(['Personal']);
    await removeSampleData();
    expect((await get('ts.tasks')).map((t) => t.id)).toEqual([mine.id]);
    expect(await get('ts.events')).toEqual([]);
    expect(await get('ts.quickLinks')).toEqual([]);
    expect(await hasSampleData()).toBe(false);
  });
});
