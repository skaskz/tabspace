import { describe, expect, it } from 'vitest';
import { mergeData, parseImport, validateImport, IMPORT_MAX_BYTES } from '@/features/data/validate';
import { applyImport } from '@/services/backup';
import { get } from '@/storage/store';

/** Hostile backup files: everything must be rejected or neutralised before it is written. */

const wrap = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ app: 'tabspace', schemaVersion: 1, exportedAt: '2026-01-01T00:00:00Z', data, ...extra });
const rec = (o: Record<string, unknown>) => ({ id: 'r1', createdAt: 1, updatedAt: 1, ...o });

function ok(json: unknown) {
  const r = validateImport(json);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r;
}

describe('import: file-level rejection', () => {
  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['not json', '{nope'],
    ['json null', 'null'],
    ['json array', '[]'],
    ['json string', '"tabspace"'],
    ['wrong app', JSON.stringify({ app: 'other', schemaVersion: 1, data: {} })],
    ['data not object', JSON.stringify({ app: 'tabspace', schemaVersion: 1, data: [] })],
    ['newer schema', JSON.stringify(wrap({}, { schemaVersion: 999 }))],
    ['schema 0', JSON.stringify(wrap({}, { schemaVersion: 0 }))],
    ['schema NaN-ish', JSON.stringify(wrap({}, { schemaVersion: '1' }))],
    ['unknown key', JSON.stringify(wrap({ 'ts.evil': [] }))],
    ['runtime-only key ts.backups', JSON.stringify(wrap({ 'ts.backups': [] }))],
    ['runtime-only key ts.focus', JSON.stringify(wrap({ 'ts.focus': { status: 'running' } }))],
    ['__proto__ as data key', '{"app":"tabspace","schemaVersion":1,"data":{"__proto__":{"polluted":true}}}'],
    ['constructor as data key', JSON.stringify(wrap({ constructor: { prototype: { polluted: true } } }))],
  ])('rejects %s', (_label, text) => {
    const r = parseImport(text);
    expect(r.ok).toBe(false);
  });

  it('rejects files larger than the cap before parsing', () => {
    const r = parseImport(' '.repeat(11) + '{}', 10);
    expect(r.ok).toBe(false);
    expect(IMPORT_MAX_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024);
  });

  it('rejects a list with more than 100k records', () => {
    const r = validateImport(wrap({ 'ts.tasks': new Array(100_001).fill(0).map((_, i) => rec({ id: `t${i}`, title: 'x', done: false })) }));
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate ids (record shadowing)', () => {
    const r = validateImport(wrap({ 'ts.tasks': [rec({ title: 'a', done: false }), rec({ title: 'b', done: false })] }));
    expect(r.ok).toBe(false);
  });
});

describe('import: type confusion is rejected', () => {
  it.each([
    ['title as object', { 'ts.tasks': [rec({ title: { toString: 'x' }, done: false })] }],
    ['title as array', { 'ts.tasks': [rec({ title: ['x'], done: false })] }],
    ['done as string', { 'ts.tasks': [rec({ title: 'x', done: 'true' })] }],
    ['createdAt as string', { 'ts.tasks': [{ id: 'a', createdAt: '1', updatedAt: 1, title: 'x', done: false }] }],
    ['createdAt Infinity-ish', { 'ts.tasks': [{ id: 'a', createdAt: Number('1e400'), updatedAt: 1, title: 'x', done: false }] }],
    ['id as number', { 'ts.tasks': [{ id: 1, createdAt: 1, updatedAt: 1, title: 'x', done: false }] }],
    ['empty id', { 'ts.tasks': [{ id: '', createdAt: 1, updatedAt: 1, title: 'x', done: false }] }],
    ['record is a string', { 'ts.tasks': ['x'] }],
    ['list is an object', { 'ts.tasks': { 0: rec({ title: 'x', done: false }) } }],
    ['bad priority enum', { 'ts.tasks': [rec({ title: 'x', done: false, priority: 'urgent' })] }],
    ['bad due date', { 'ts.tasks': [rec({ title: 'x', done: false, dueDate: '2026-01-01T00:00:00Z' })] }],
    ['oversize note', { 'ts.notes': [rec({ title: 'x', content: 'a'.repeat(2_000_001) })] }],
    ['session tabs not list', { 'ts.sessions': [rec({ name: 's', tabs: 'https://ok.example' })] }],
    ['group colour injection', { 'ts.sessions': [rec({ name: 's', tabs: [], groups: [{ id: 'g', title: 't', color: 'red;background:url(x)' }] })] }],
    ['settings theme enum', { 'ts.settings': { theme: '"><script>' } }],
    ['settings nested type', { 'ts.settings': { focus: 'everything' } }],
    ['settings bool as string', { 'ts.settings': { starfield: 'yes' } }],
    ['usage bad day key', { 'ts.usage': { 'not-a-date': { 'a.example': 1 } } }],
    ['usage non-number', { 'ts.usage': { '2026-01-01': { 'a.example': '1' } } }],
    ['events bad date', { 'ts.events': [rec({ sourceId: 's', title: 't', start: 'tomorrow', allDay: false })] }],
  ])('rejects %s', (_label, data) => {
    expect(validateImport(wrap(data as Record<string, unknown>)).ok).toBe(false);
  });
});

describe('import: unsafe URLs are stripped', () => {
  const BAD = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'chrome://settings', 'chrome-extension://x/y.html', 'vbscript:x'];
  it.each(BAD)('drops bookmark / quick link / session tab / feed with %j', (url) => {
    const r = ok(
      wrap({
        'ts.bookmarks': [rec({ id: 'b', url, title: 'b' })],
        'ts.quickLinks': [{ id: 'q', url, title: 'q', order: 0 }],
        'ts.sessions': [rec({ id: 's', name: 's', tabs: [{ id: 't', url, title: 't' }, { id: 't2', url: 'https://ok.example', title: 'ok', favIconUrl: url }] })],
        'ts.calendarSources': [rec({ id: 'c', name: 'c', kind: 'ics-url', url })],
      }),
    );
    expect(r.data['ts.bookmarks']).toEqual([]);
    expect(r.data['ts.quickLinks']).toEqual([]);
    const tabs = (r.data['ts.sessions'] as { tabs: { url: string; favIconUrl?: string }[] }[])[0].tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].url).toBe('https://ok.example');
    expect(tabs[0].favIconUrl).toBeUndefined();
    expect((r.data['ts.calendarSources'] as { url?: string }[])[0].url).toBeUndefined();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('sanitises calendar colours (used in style attributes)', () => {
    const r = ok(wrap({ 'ts.calendarSources': [rec({ name: 'c', kind: 'local', color: 'red;background-image:url(https://evil.example/t.gif)' })] }));
    expect((r.data['ts.calendarSources'] as { color: string }[])[0].color).toBe('#a1a1a6');
  });

  it('only accepts spotify:playlist URIs for the playlist setting', () => {
    const r = ok(wrap({ 'ts.settings': { integrations: { spotifyPlaylistUri: 'javascript:alert(1)' } } }));
    expect((r.data['ts.settings'] as { integrations: Record<string, unknown> }).integrations.spotifyPlaylistUri).toBeUndefined();
  });
});

describe('import: secrets are never imported', () => {
  it('ignores secret.* keys and does not write them', async () => {
    const r = ok(wrap({ 'secret.google': { accessToken: 'ya29.attacker' }, 'secret.spotify': { refreshToken: 'attacker' }, 'ts.tasks': [] }));
    expect(Object.keys(r.data)).toEqual(['ts.tasks']);
    expect(r.warnings.join(' ')).toMatch(/never imported/);
    await applyImport(r, 'replace');
    expect(JSON.stringify(await get('ts.settings'))).not.toContain('attacker');
  });
  it('drops unknown fields inside integrations (no token smuggling via settings)', () => {
    const r = ok(wrap({ 'ts.settings': { integrations: { googleClientId: 'abc.apps.googleusercontent.com', accessToken: 'ya29.x', refreshToken: 'r' } } }));
    expect((r.data['ts.settings'] as { integrations: Record<string, unknown> }).integrations).toEqual({ googleClientId: 'abc.apps.googleusercontent.com' });
  });
  it('drops unknown string fields at the settings top level', () => {
    const r = ok(wrap({ 'ts.settings': { evilHtml: '<img src=x onerror=alert(1)>', welcomeDismissed: true } }));
    const s = r.data['ts.settings'] as Record<string, unknown>;
    expect(s.evilHtml).toBeUndefined();
    expect(s.welcomeDismissed).toBe(true);
  });
});

describe('import: background image', () => {
  it.each([
    ['SVG (can carry script)', 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+'],
    ['SVG utf8', 'data:image/svg+xml,<svg onload=alert(1)>'],
    ['html data URL', 'data:text/html;base64,PHNjcmlwdD4='],
    ['remote URL (tracking pixel)', 'https://evil.example/pixel.png'],
    ['CSS breakout', 'data:image/png;base64,AAAA) , url(https://evil.example/x'],
    ['javascript', 'javascript:alert(1)'],
    ['non-string', { src: 'x' }],
  ])('rejects %s', (_l, bg) => {
    const r = ok(wrap({ 'ts.settings': { backgroundImage: bg } }));
    expect((r.data['ts.settings'] as { backgroundImage?: string }).backgroundImage).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/background image/i);
  });
  it('accepts a small base64 PNG', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const r = ok(wrap({ 'ts.settings': { backgroundImage: png } }));
    expect((r.data['ts.settings'] as { backgroundImage?: string }).backgroundImage).toBe(png);
  });
});

describe('import: prototype pollution', () => {
  const POLLUTERS = [
    '{"app":"tabspace","schemaVersion":1,"data":{"ts.usage":{"2026-01-01":{"__proto__":{"polluted":1}}}}}',
    '{"app":"tabspace","schemaVersion":1,"data":{"ts.usage":{"2026-01-01":{"__proto__":5,"constructor":3}}}}',
    '{"app":"tabspace","schemaVersion":1,"data":{"ts.settings":{"__proto__":{"polluted":true},"focus":{"__proto__":{"polluted":true}}}}}',
    '{"app":"tabspace","schemaVersion":1,"data":{"ts.sampleIds":{"__proto__":["x"],"constructor":["y"]}}}',
    '{"app":"tabspace","schemaVersion":1,"data":{"ts.tasks":[{"id":"a","createdAt":1,"updatedAt":1,"title":"x","done":false,"__proto__":{"polluted":true}}]}}',
    '{"app":"tabspace","schemaVersion":1,"data":{"ts.quotes":{"favorites":[],"__proto__":{"polluted":true}}}}',
    '{"app":"tabspace","schemaVersion":1,"data":{"ts.workspaceActivity":{"2026-01-01":{"__proto__":{"polluted":true}}}}}',
  ];
  it.each(POLLUTERS.map((p, i) => [i, p]))('payload #%i does not pollute Object.prototype (validate + merge + apply)', async (_i, text) => {
    const r = parseImport(text as string);
    if (r.ok) {
      // Merge may throw on some of these (see the sampleIds finding below); pollution is what we check here.
      try {
        mergeData({ 'ts.usage': {}, 'ts.sampleIds': {} }, r.data);
        await applyImport(r, 'merge');
      } catch {
        /* covered by the dedicated finding test */
      }
      await applyImport(r, 'replace');
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.toString).toBe(Object.prototype.toString);
  });

  // FINDING (Info): mergeData() assigns `merged[key]` with key "__proto__" for ts.sampleIds, which re-parents
  // that local object (not a global pollution, and lost on serialisation). Flip to `it` once keys are filtered.
  it('mergeData keeps plain prototypes for ts.sampleIds with a "__proto__" key', () => {
    const r = parseImport('{"app":"tabspace","schemaVersion":1,"data":{"ts.sampleIds":{"__proto__":["x"]}}}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const merged = mergeData({ 'ts.sampleIds': {} }, r.data) as Record<string, object>;
    expect(Object.getPrototypeOf(merged['ts.sampleIds'])).toBe(Object.prototype);
  });
});

describe('import: ts.sampleIds keys', () => {
  // FINDING (Low): ts.sampleIds accepts arbitrary keys. A key such as "constructor" or "toString" makes
  // mergeData() read Object.prototype members (`merged[key] ?? []` is a function) and throw a TypeError, so a
  // crafted backup aborts Merge import with an unhelpful error. Flip to `it` once keys are restricted to store keys.
  it('a "constructor" key is rejected or merged safely', () => {
    const r = parseImport('{"app":"tabspace","schemaVersion":1,"data":{"ts.sampleIds":{"constructor":["y"]}}}');
    if (!r.ok) return; // rejecting is an acceptable fix
    expect(() => mergeData({ 'ts.sampleIds': {} }, r.data)).not.toThrow();
  });
});

describe('import: deep / huge structures', () => {
  it('a deeply nested settings object does not crash the validator', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 5000; i++) {
      const next = {};
      deep.x = next;
      deep = next;
    }
    const r = validateImport(wrap({ 'ts.settings': { focus: root } }));
    expect(r.ok).toBe(true); // unknown nested keys are ignored, not recursed
  });
  it('very long strings in fields are rejected', () => {
    expect(validateImport(wrap({ 'ts.tasks': [rec({ title: 'x'.repeat(1001), done: false })] })).ok).toBe(false);
    expect(validateImport(wrap({ 'ts.settings': { userName: 'x'.repeat(501) } })).ok).toBe(false);
    expect(validateImport(wrap({ 'ts.settings': { focus: { blocklist: ['x'.repeat(301)] } } })).ok).toBe(false);
  });
});
