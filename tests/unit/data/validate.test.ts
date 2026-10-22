import { describe, expect, it } from 'vitest';
import { buildExport, mergeData, parseImport, validateImport } from '@/features/data/validate';
import { SCHEMA_VERSION } from '@/storage/schema';

const base = { createdAt: 1, updatedAt: 1 };
const file = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ app: 'tabspace', schemaVersion: SCHEMA_VERSION, appVersion: '1.0.0', exportedAt: '2026-10-21T00:00:00Z', data, ...extra });

describe('buildExport', () => {
  it('includes versions/timestamp, excludes runtime keys, backups and feed URLs by default', () => {
    const all = {
      'ts.tasks': [{ id: 't' }],
      'ts.backups': [{ id: 'b' }],
      'ts.activeWorkspace': 'w',
      'secret.google': { accessToken: 'x' },
      'ts.calendarSources': [{ id: 's', url: 'https://private.example.com/feed?token=abc', name: 'Feed' }],
    };
    const out = buildExport(all, { appVersion: '1.2.3', now: new Date('2026-10-21T10:00:00Z') });
    expect(out).toMatchObject({ app: 'tabspace', schemaVersion: SCHEMA_VERSION, appVersion: '1.2.3', exportedAt: '2026-10-21T10:00:00.000Z' });
    expect(Object.keys(out.data).sort()).toEqual(['ts.calendarSources', 'ts.tasks']);
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(JSON.stringify(out)).not.toContain('token=abc');
    expect(buildExport(all, { appVersion: 'x', includeFeedUrls: true }).data['ts.calendarSources']).toEqual(all['ts.calendarSources']);
  });
});

describe('validateImport', () => {
  it('accepts a valid file and strips unknown record fields', () => {
    const r = validateImport(file({ 'ts.tasks': [{ ...base, id: 't1', title: 'Push Tabspace to GitHub', done: false, priority: 'high', subtasks: [], order: 0, evil: 'x' }] }));
    if (!r.ok) throw new Error(r.error);
    expect(r.counts['ts.tasks']).toBe(1);
    expect((r.data['ts.tasks'] as object[])[0]).not.toHaveProperty('evil');
  });

  it('rejects files that are not Tabspace backups or are corrupt', () => {
    expect(parseImport('not json')).toMatchObject({ ok: false, error: expect.stringMatching(/not valid JSON/) });
    expect(parseImport('')).toMatchObject({ ok: false });
    expect(validateImport({ hello: 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/not a Tabspace backup/) });
    expect(validateImport(file({}, { schemaVersion: SCHEMA_VERSION + 5 }))).toMatchObject({ ok: false, error: expect.stringMatching(/newer Tabspace/) });
    expect(validateImport(file({ 'ts.unknown': [] }))).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown data/) });
    expect(parseImport('x'.repeat(100), 50)).toMatchObject({ ok: false, error: expect.stringMatching(/too large/) });
  });

  it('rejects wrong types with a path in the message', () => {
    const r = validateImport(file({ 'ts.tasks': [{ ...base, id: 't', title: 42, done: false, subtasks: [], order: 0 }] }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('ts.tasks[0].title') });
    expect(validateImport(file({ 'ts.tasks': { not: 'a list' } }))).toMatchObject({ ok: false });
    expect(validateImport(file({ 'ts.tasks': [{ ...base, id: 't', title: 'x', done: false, dueDate: 'tomorrow', order: 0 }] }))).toMatchObject({ ok: false });
    expect(validateImport(file({ 'ts.tasks': [{ ...base, id: 'a', title: 'x', done: false, order: 0 }, { ...base, id: 'a', title: 'y', done: false, order: 1 }] }))).toMatchObject({ ok: false, error: expect.stringMatching(/duplicate id/) });
    expect(validateImport(file({ 'ts.settings': { theme: 'neon' } }))).toMatchObject({ ok: false, error: expect.stringContaining('theme') });
  });

  it('strips javascript: URLs and keeps XSS-looking strings as inert text', () => {
    const xss = '<img src=x onerror=alert(1)>';
    const r = validateImport(
      file({
        'ts.bookmarks': [
          { ...base, id: 'b1', url: 'javascript:alert(1)', title: 'bad', tags: [], favorite: false },
          { ...base, id: 'b2', url: 'https://github.com/', title: xss, tags: [], favorite: false },
        ],
        'ts.quickLinks': [{ id: 'q', title: 'x', url: 'data:text/html,<script>alert(1)</script>', order: 0 }],
        'ts.sessions': [{ ...base, id: 's', name: 'S', tabs: [{ id: 't', url: 'JAVASCRIPT:alert(1)', title: 'x', pinned: false }, { id: 't2', url: 'https://claude.ai/', title: 'Claude', pinned: false, favIconUrl: 'javascript:x' }], groups: [] }],
        'ts.calendarSources': [{ ...base, id: 'c', name: 'Feed', kind: 'ics-url', color: 'red;background:url(x)', enabled: true, url: 'javascript:alert(1)' }],
      }),
    );
    if (!r.ok) throw new Error(r.error);
    expect((r.data['ts.bookmarks'] as { id: string; title: string }[]).map((b) => b.id)).toEqual(['b2']);
    expect((r.data['ts.bookmarks'] as { title: string }[])[0].title).toBe(xss);
    expect(r.data['ts.quickLinks']).toEqual([]);
    const tabs = (r.data['ts.sessions'] as { tabs: { id: string; favIconUrl?: string }[] }[])[0].tabs;
    expect(tabs.map((t) => t.id)).toEqual(['t2']);
    expect(tabs[0].favIconUrl).toBeUndefined();
    const src = (r.data['ts.calendarSources'] as { url?: string; color: string }[])[0];
    expect(src.url).toBeUndefined();
    expect(src.color).toBe('#a1a1a6');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('never imports secrets and validates settings field types', () => {
    const r = validateImport(
      file({
        'secret.spotify': { refreshToken: 'x' },
        'ts.settings': { theme: 'light', userName: 'Joe', focus: { focusMin: 30 }, backgroundImage: 'javascript:alert(1)', integrations: { spotifyPlaylistUri: 'https://evil' } },
      }),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.data).not.toHaveProperty('secret.spotify');
    expect(r.data['ts.settings']).toMatchObject({ theme: 'light', userName: 'Joe', focus: { focusMin: 30 }, integrations: {} });
    expect(r.data['ts.settings']).not.toHaveProperty('backgroundImage');
    expect(validateImport(file({ 'ts.settings': { focus: { focusMin: '30' } } }))).toMatchObject({ ok: false });
  });

  it('validates day maps', () => {
    expect(validateImport(file({ 'ts.usage': { '2026-10-21': { 'github.com': 1000 } } })).ok).toBe(true);
    expect(validateImport(file({ 'ts.usage': { yesterday: {} } })).ok).toBe(false);
    expect(validateImport(file({ 'ts.usage': { '2026-10-21': { 'github.com': 'lots' } } })).ok).toBe(false);
  });
});

describe('ts.sampleIds hardening', () => {
  it('keeps only collection keys and merges safely', () => {
    const r = parseImport('{"app":"tabspace","schemaVersion":1,"data":{"ts.sampleIds":{"__proto__":["x"],"constructor":["y"],"ts.tasks":["t1"]}}}');
    if (!r.ok) throw new Error(r.error);
    expect(Object.keys(r.data['ts.sampleIds'] as object)).toEqual(['ts.tasks']);
    const merged = mergeData({ 'ts.sampleIds': { 'ts.tasks': ['t0'] } }, r.data) as Record<string, Record<string, string[]>>;
    expect(merged['ts.sampleIds']).toEqual({ 'ts.tasks': ['t0', 't1'] });
    expect(Object.getPrototypeOf(merged['ts.sampleIds'])).toBe(Object.prototype);
  });
});

describe('V2 settings fields', () => {
  it('accepts parallax, focus.sound, quickNote.attachUrl and the liked-songs selection', () => {
    const r = validateImport(file({ 'ts.settings': { parallax: false, focus: { sound: false }, quickNote: { attachUrl: true }, integrations: { spotifyPlaylistUri: 'liked' } } }));
    if (!r.ok) throw new Error(r.error);
    expect(r.data['ts.settings']).toMatchObject({ parallax: false, focus: { sound: false }, quickNote: { attachUrl: true }, integrations: { spotifyPlaylistUri: 'liked' } });
  });

  it('rejects wrong types for the new fields', () => {
    expect(validateImport(file({ 'ts.settings': { parallax: 'yes' } }))).toMatchObject({ ok: false, error: expect.stringContaining('parallax') });
    expect(validateImport(file({ 'ts.settings': { quickNote: { attachUrl: 1 } } }))).toMatchObject({ ok: false });
  });

  it('tolerates older exports without them (defaults fill in on restore)', async () => {
    const r = validateImport(file({ 'ts.settings': { theme: 'light', focus: { focusMin: 30 } } }));
    if (!r.ok) throw new Error(r.error);
    const { mergeSettings } = await import('@/storage/store');
    const merged = mergeSettings(r.data['ts.settings'] as object);
    expect(merged).toMatchObject({ theme: 'light', parallax: true, focus: { focusMin: 30, sound: true }, quickNote: { attachUrl: false } });
  });
});

describe('mergeData', () => {
  it('unions lists by id with newer updatedAt winning, max for day maps, keeps settings', () => {
    const merged = mergeData(
      { 'ts.tasks': [{ id: 'a', updatedAt: 5, title: 'cur' }, { id: 'b', updatedAt: 5 }], 'ts.usage': { '2026-10-21': { 'x.com': 10 } }, 'ts.settings': { theme: 'dark' } },
      { 'ts.tasks': [{ id: 'a', updatedAt: 9, title: 'new' }, { id: 'c', updatedAt: 1 }], 'ts.usage': { '2026-10-21': { 'x.com': 7, 'y.com': 3 } }, 'ts.settings': { theme: 'light' } },
    );
    expect((merged['ts.tasks'] as { id: string; title?: string }[]).map((t) => [t.id, t.title])).toEqual([
      ['a', 'new'],
      ['b', undefined],
      ['c', undefined],
    ]);
    expect(merged['ts.usage']).toEqual({ '2026-10-21': { 'x.com': 10, 'y.com': 3 } });
    expect(merged).not.toHaveProperty('ts.settings');
  });
});
