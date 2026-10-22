import { describe, expect, it } from 'vitest';
import { migrateData, runMigrations, type Migration } from '@/storage/migrations';
import { getAdapter, setAdapter } from '@/storage/store';
import { createMemoryAdapter } from '@/storage/adapter';
import { SCHEMA_VERSION } from '@/storage/schema';

describe('migrations', () => {
  it('stamps schemaVersion on a fresh install', async () => {
    await runMigrations();
    const all = await getAdapter().getAll();
    expect((all['ts.settings'] as { schemaVersion: number }).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('v1 baseline repairs wrong-kind values and drops non-object list items', async () => {
    setAdapter(createMemoryAdapter({ 'ts.tasks': { broken: true }, 'ts.notes': [{ id: 'n' }, 'junk', null], 'ts.usage': [], 'ts.activeWorkspace': 'w1', 'other.key': 1 }));
    await runMigrations();
    const all = await getAdapter().getAll();
    expect(all).not.toHaveProperty('ts.tasks');
    expect(all).not.toHaveProperty('ts.usage');
    expect(all['ts.notes']).toEqual([{ id: 'n' }]);
    expect(all['ts.activeWorkspace']).toBe('w1');
    expect(all['other.key']).toBe(1); // never touches foreign keys (e.g. secret.*)
  });

  it('is idempotent and never downgrades newer data', async () => {
    setAdapter(createMemoryAdapter({ 'ts.notes': [{ id: 'n' }] }));
    await runMigrations();
    const once = await getAdapter().getAll();
    await runMigrations();
    expect(await getAdapter().getAll()).toEqual(once);

    setAdapter(createMemoryAdapter({ 'ts.settings': { schemaVersion: SCHEMA_VERSION + 1 }, 'ts.tasks': { future: 'shape' } }));
    await runMigrations();
    expect((await getAdapter().getAll())['ts.tasks']).toEqual({ future: 'shape' });
  });

  it('applies only migrations newer than the stored version, in order', () => {
    const log: number[] = [];
    const ms: Migration[] = [3, 1, 2].map((to) => ({ to, run: (d) => (log.push(to), { ...d, [`v${to}`]: true }) }));
    expect(migrateData({}, 1, ms)).toEqual({ data: { v2: true, v3: true }, version: 3 });
    expect(log).toEqual([2, 3]);
  });
});
