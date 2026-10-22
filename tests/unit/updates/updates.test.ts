import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareVersions, isNewer, parseVersion, readRelease } from '@/features/updates/version';
import { checkForUpdates, dismissUpdate } from '@/services/updates';
import { get, update } from '@/storage/store';

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v2.4.0',
  html_url: 'https://github.com/skaskz/tabspace/releases/tag/v2.4.0',
  body: '## What changed\n- Faster New Tab',
  published_at: '2026-10-23T10:00:00Z',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'tabspace-theme-v2.4.0.zip', browser_download_url: 'https://github.com/skaskz/tabspace/releases/download/v2.4.0/tabspace-theme-v2.4.0.zip' },
    { name: 'tabspace-extension-v2.4.0.zip', browser_download_url: 'https://github.com/skaskz/tabspace/releases/download/v2.4.0/tabspace-extension-v2.4.0.zip' },
  ],
  ...over,
});

const ok = (json: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(json), { status }));

afterEach(() => vi.unstubAllGlobals());

describe('version helpers', () => {
  it('parses and compares versions', () => {
    expect(parseVersion('v2.3.0')).toEqual([2, 3, 0]);
    expect(parseVersion('2.3')).toEqual([2, 3, 0]);
    expect(parseVersion('2.3.1-rc.1')).toEqual([2, 3, 1]);
    expect(parseVersion('banana')).toBeNull();
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.3.0', 'v2.3')).toBe(0);
    expect(isNewer('2.3.1', '2.3.0')).toBe(true);
    expect(isNewer('2.3.0', '2.3.0')).toBe(false);
    expect(isNewer('nope', '2.3.0')).toBe(false);
  });

  it('reads a release and picks the extension zip', () => {
    const r = readRelease(release())!;
    expect(r.version).toBe('2.4.0');
    expect(r.downloadUrl).toMatch(/tabspace-extension-v2\.4\.0\.zip$/);
    expect(r.url).toBe('https://github.com/skaskz/tabspace/releases/tag/v2.4.0');
  });

  it('rejects drafts, pre-releases, bad tags and non-GitHub links', () => {
    expect(readRelease(release({ draft: true }))).toBeNull();
    expect(readRelease(release({ prerelease: true }))).toBeNull();
    expect(readRelease(release({ tag_name: 'latest' }))).toBeNull();
    expect(readRelease(release({ html_url: 'https://evil.example/release' }))).toBeNull();
    expect(readRelease(release({ html_url: 'javascript:alert(1)' }))).toBeNull();
    const evilAsset = readRelease(release({ assets: [{ name: 'tabspace-extension.zip', browser_download_url: 'http://github.com/x.zip' }] }))!;
    expect(evilAsset.downloadUrl).toBeUndefined();
    expect(readRelease(null)).toBeNull();
  });
});

describe('checkForUpdates', () => {
  it('stores the latest release and reports a newer version', async () => {
    const fetchImpl = ok(release());
    const r = await checkForUpdates({ force: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.github.com/repos/skaskz/tabspace/releases/latest', expect.objectContaining({ credentials: 'omit' }));
    expect(r).toMatchObject({ available: true, version: '2.4.0' });
    expect((await get('ts.update')).latest?.version).toBe('2.4.0');
  });

  it('treats "no releases yet" (404) as up to date, not an error', async () => {
    const r = await checkForUpdates({ force: true, fetchImpl: ok({ message: 'Not Found' }, 404) as unknown as typeof fetch });
    expect(r).toEqual({ available: false });
    expect((await get('ts.update')).error).toBeUndefined();
  });

  it('records a friendly error on rate limits and network failures', async () => {
    const r1 = await checkForUpdates({ force: true, fetchImpl: ok({}, 403) as unknown as typeof fetch });
    expect(r1.error).toMatch(/rate-limiting/);
    const r2 = await checkForUpdates({ force: true, fetchImpl: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch });
    expect(r2.error).toBe('Failed to fetch');
    expect((await get('ts.update')).error).toBe('Failed to fetch');
  });

  it('does nothing when checks are turned off (unless forced)', async () => {
    await update('ts.settings', (s) => ({ ...s, updates: { check: false } }));
    const fetchImpl = ok(release());
    expect(await checkForUpdates({ fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ available: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throttles repeat checks within an hour', async () => {
    const fetchImpl = ok(release());
    await checkForUpdates({ force: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    await checkForUpdates({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('remembers a dismissed version', async () => {
    await dismissUpdate('2.4.0');
    expect((await get('ts.update')).dismissed).toBe('2.4.0');
  });
});
