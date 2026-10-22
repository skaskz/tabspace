/**
 * Optional-permission bookkeeping shared by Tabspace features that need
 * `scripting` + site access: the website Tabspace Bar ('bar') and the search
 * results look ('search').
 *
 * One record in chrome.storage.local (outside the store schema, so it is never
 * exported/imported) lists every grant *Tabspace itself obtained*, with the
 * features that rely on it (reference counting):
 *   { scripting: ['bar','search'], origins: { <all https>: ['bar'], <google.com>: ['search'] } }
 *
 * - Enabling a feature: for each permission it needs —
 *     not held before        → granted now, recorded with this feature;
 *     held via a recorded grant (Tabspace-obtained, possibly a broader pattern
 *     such as the bar's all-https access covering google.com) → this feature is
 *     added to that grant's references;
 *     held but not recorded  → the user's own grant; never tracked, never removed.
 * - Disabling a feature: its references are dropped; grants left with no
 *   references are released, the rest stay.
 *
 * Chrome caveat (Chromium extensions/browser/api/permissions): permissions.remove()
 * revokes the intersection with kPatternsContainedByBoth, so releasing a broad
 * pattern (all-https) also revokes narrower patterns it contains (e.g. an ICS
 * feed's origin, or google.com granted separately for the search look).
 * Privacy wins: we still release it. A feature that loses access that way is
 * detected by its registration sync (permissions.contains → false) and the
 * settings page asks the user to turn it on again.
 */

export type GrantFeature = 'bar' | 'search';
export const GRANTS_KEY = 'ts.grants';
/** V2.1 record (bar only), migrated on first read. */
export const LEGACY_BAR_KEY = 'ts.barGrant';

export interface GrantRecord {
  scripting: GrantFeature[];
  origins: Record<string, GrantFeature[]>;
}

export interface Needed {
  permissions: string[];
  origins: string[];
}

const FEATURES: GrantFeature[] = ['bar', 'search'];
const empty = (): GrantRecord => ({ scripting: [], origins: {} });

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

function parse(p: string): { scheme: string; host: string; path: string } | null {
  const m = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(p);
  return m ? { scheme: m[1], host: m[2], path: m[3] } : null;
}

/** Does match pattern `a` cover pattern `b`? (Subset of Chrome's rules, enough for our patterns.) */
export function covers(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  if (pa.scheme !== '*' && pa.scheme !== pb.scheme) return false;
  if (pa.scheme === '*' && pb.scheme !== 'http' && pb.scheme !== 'https' && pb.scheme !== '*') return false;
  const hostOk = pa.host === '*' || pa.host === pb.host || (pa.host.startsWith('*.') && (pb.host === pa.host.slice(2) || pb.host.endsWith(pa.host.slice(1))));
  if (!hostOk) return false;
  const pathOk = pa.path === '/*' || pa.path === pb.path || (pa.path.endsWith('*') && pb.path.startsWith(pa.path.slice(0, -1)));
  return pathOk;
}

export function sanitize(v: unknown): GrantRecord {
  const out = empty();
  if (!v || typeof v !== 'object') return out;
  const r = v as { scripting?: unknown; origins?: unknown };
  if (Array.isArray(r.scripting)) out.scripting = FEATURES.filter((f) => (r.scripting as unknown[]).includes(f));
  if (r.origins && typeof r.origins === 'object') {
    for (const [o, refs] of Object.entries(r.origins as Record<string, unknown>)) {
      if (!parse(o) || !Array.isArray(refs)) continue;
      const fs = FEATURES.filter((f) => refs.includes(f));
      if (fs.length) out.origins[o] = fs;
    }
  }
  return out;
}

/** V2.1 `ts.barGrant` ({ scripting: bool, origins: string[] }) → shared record. */
export function migrateLegacy(v: unknown, allowed: string[]): GrantRecord {
  const out = empty();
  if (!v || typeof v !== 'object') return out;
  const r = v as { scripting?: unknown; origins?: unknown };
  if (r.scripting === true) out.scripting = ['bar'];
  if (Array.isArray(r.origins)) for (const o of r.origins) if (typeof o === 'string' && allowed.includes(o)) out.origins[o] = ['bar'];
  return out;
}

const addRef = (list: GrantFeature[] | undefined, f: GrantFeature): GrantFeature[] => [...new Set([...(list ?? []), f])];

/**
 * Pure: update the record after `feature` was granted `needed`.
 * `heldBefore` says what was already held when the request was made.
 */
export function addGrant(rec: GrantRecord, feature: GrantFeature, needed: Needed, heldBefore: { scripting: boolean; origins: Record<string, boolean> }): GrantRecord {
  const next: GrantRecord = { scripting: [...rec.scripting], origins: { ...rec.origins } };
  if (needed.permissions.includes('scripting')) {
    if (!heldBefore.scripting || next.scripting.length) next.scripting = addRef(next.scripting, feature);
  }
  for (const o of needed.origins) {
    if (!heldBefore.origins[o]) {
      next.origins[o] = addRef(next.origins[o], feature);
      continue;
    }
    // Already held: reference the Tabspace-obtained grant(s) providing it; otherwise it's the user's own grant.
    for (const p of Object.keys(next.origins)) if (covers(p, o)) next.origins[p] = addRef(next.origins[p], feature);
  }
  return next;
}

/**
 * Pure: drop `feature`'s references (optionally only for some origins).
 * Returns the new record and what must be released from Chrome.
 */
export function dropGrant(rec: GrantRecord, feature: GrantFeature, onlyOrigins?: string[]): { record: GrantRecord; release: Needed } {
  const next: GrantRecord = { scripting: [...rec.scripting], origins: {} };
  const release: Needed = { permissions: [], origins: [] };
  if (!onlyOrigins && next.scripting.includes(feature)) {
    next.scripting = next.scripting.filter((f) => f !== feature);
    if (!next.scripting.length) release.permissions.push('scripting');
  }
  for (const [o, refs] of Object.entries(rec.origins)) {
    const touch = !onlyOrigins || onlyOrigins.some((x) => covers(o, x) || covers(x, o));
    const left = touch ? refs.filter((f) => f !== feature) : refs;
    if (left.length) next.origins[o] = left;
    else release.origins.push(o);
  }
  return { record: next, release };
}

export function isEmpty(r: GrantRecord): boolean {
  return !r.scripting.length && !Object.keys(r.origins).length;
}

/* ------------------------------------------------------------------ */
/* Storage + chrome.permissions                                        */
/* ------------------------------------------------------------------ */

function local(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
}

let queue: Promise<unknown> = Promise.resolve();
/** Serialise record read-modify-writes within this context. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

export async function readGrants(legacyAllowed: string[] = []): Promise<GrantRecord> {
  const area = local();
  if (!area) return empty();
  try {
    const r = { ...(await area.get(GRANTS_KEY)), ...(await area.get(LEGACY_BAR_KEY)) };
    let rec = sanitize(r[GRANTS_KEY]);
    if (r[LEGACY_BAR_KEY] !== undefined) {
      const legacy = migrateLegacy(r[LEGACY_BAR_KEY], legacyAllowed);
      rec = { scripting: [...new Set([...rec.scripting, ...legacy.scripting])], origins: { ...legacy.origins, ...rec.origins } };
      await area.set({ [GRANTS_KEY]: rec });
      await area.remove(LEGACY_BAR_KEY);
    }
    return rec;
  } catch {
    return empty();
  }
}

async function writeGrants(rec: GrantRecord): Promise<void> {
  const area = local();
  if (!area) return;
  try {
    if (isEmpty(rec)) await area.remove(GRANTS_KEY);
    else await area.set({ [GRANTS_KEY]: rec });
  } catch {
    /* best effort */
  }
}

/**
 * Request `needed` for `feature` from a click. The "already held?" checks are
 * dispatched just before request() in the same tick (Chrome answers them in
 * order, against the pre-grant state); request() itself is synchronous within
 * the user gesture. `onGranted` runs (e.g. saving the setting) before the record
 * is written.
 */
export function requestFeature(feature: GrantFeature, needed: Needed, onGranted?: () => Promise<unknown>, legacyAllowed: string[] = []): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) return Promise.resolve(false);
  const p = chrome.permissions;
  const has = (perm: chrome.permissions.Permissions) => p.contains(perm).catch(() => false);
  const heldScripting = needed.permissions.includes('scripting') ? has({ permissions: ['scripting'] } as chrome.permissions.Permissions) : Promise.resolve(true);
  const heldOrigins = needed.origins.map((o) => has({ origins: [o] }));
  const request = p.request({ permissions: needed.permissions, origins: needed.origins } as chrome.permissions.Permissions).catch(() => false);
  return request.then(async (ok) => {
    if (!ok) return false;
    const held = { scripting: await heldScripting, origins: Object.fromEntries(await Promise.all(needed.origins.map(async (o, i) => [o, await heldOrigins[i]] as const))) };
    await onGranted?.();
    await serial(async () => writeGrants(addGrant(await readGrants(legacyAllowed), feature, needed, held)));
    return true;
  });
}

/** Drop `feature`'s references and release grants nothing else uses. Idempotent. Returns what was released. */
export function releaseFeature(feature: GrantFeature, onlyOrigins?: string[], legacyAllowed: string[] = []): Promise<Needed | null> {
  return serial(async () => {
    const rec = await readGrants(legacyAllowed);
    const { record, release } = dropGrant(rec, feature, onlyOrigins);
    if (!release.permissions.length && !release.origins.length) {
      await writeGrants(record);
      return null;
    }
    if (typeof chrome !== 'undefined' && chrome.permissions?.remove) {
      await chrome.permissions.remove(release as chrome.permissions.Permissions).catch(() => undefined);
    }
    await writeGrants(record);
    return release;
  });
}
