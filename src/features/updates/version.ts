/** Pure helpers for comparing Tabspace versions and reading GitHub release payloads. */

/** "v2.3.0" / "2.3" / "2.3.0-rc.1" → [2, 3, 0] (pre-release suffixes ignored). Invalid → null. */
export function parseVersion(input: string | undefined | null): [number, number, number] | null {
  if (!input) return null;
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(input.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Negative if a < b, 0 if equal, positive if a > b. Unparseable versions sort lowest. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

interface GitHubAsset {
  name?: unknown;
  browser_download_url?: unknown;
}
interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

const GITHUB_HOSTS = new Set(['github.com', 'objects.githubusercontent.com']);

function safeGitHubUrl(u: unknown): string | undefined {
  if (typeof u !== 'string') return undefined;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && GITHUB_HOSTS.has(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validate a `GET /repos/:repo/releases/latest` payload. Returns null for drafts, pre-releases or
 * anything malformed. Only https github.com links are accepted.
 */
export function readRelease(json: unknown): { version: string; url: string; downloadUrl?: string; notes?: string; publishedAt?: string } | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as GitHubRelease;
  if (r.draft === true || r.prerelease === true) return null;
  if (typeof r.tag_name !== 'string' || !parseVersion(r.tag_name)) return null;
  const url = safeGitHubUrl(r.html_url);
  if (!url) return null;
  const assets = Array.isArray(r.assets) ? (r.assets as GitHubAsset[]) : [];
  const ext = assets.find((a) => typeof a.name === 'string' && /^tabspace-extension.*\.zip$/i.test(a.name));
  const [maj, min, pat] = parseVersion(r.tag_name)!;
  return {
    version: `${maj}.${min}.${pat}`,
    url,
    downloadUrl: safeGitHubUrl(ext?.browser_download_url),
    notes: typeof r.body === 'string' ? r.body.slice(0, 1200) : undefined,
    publishedAt: typeof r.published_at === 'string' ? r.published_at : undefined,
  };
}
