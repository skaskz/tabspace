import { DEFAULTS, DEFAULT_SETTINGS, SCHEMA_VERSION, STORE_KEYS, type StoreKey } from '@/storage/schema';
import type { PageId, Settings } from '@/types/models';
import { isSafeUrl } from '@/utils/url';

/**
 * Pure export/import validation. Import is strict: unknown keys or corrupt shapes
 * reject the whole file with a clear message. Unsafe URLs (javascript:, data:, file: …)
 * are stripped (the link record is dropped) and reported as warnings.
 * Strings are kept as inert text — nothing here evaluates or renders them.
 */

export const EXPORT_APP = 'tabspace';
export const IMPORT_MAX_BYTES = 30 * 1024 * 1024;

/** Keys never exported: runtime-only state and the backups themselves. secret.* keys are not store keys at all. */
const NON_EXPORTED = new Set<string>(['ts.backups', 'ts.activeWorkspace', 'ts.focus']);
export const EXPORTABLE_KEYS: StoreKey[] = STORE_KEYS.filter((k) => !NON_EXPORTED.has(k));
/** Keys allowed inside ts.sampleIds: list collections only. */
const SAMPLE_ID_KEYS = new Set<string>(STORE_KEYS.filter((k) => Array.isArray(DEFAULTS[k])));

export interface ExportFile {
  app: typeof EXPORT_APP;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  data: Record<string, unknown>;
}

export function buildExport(all: Record<string, unknown>, opts: { appVersion: string; includeFeedUrls?: boolean; now?: Date }): ExportFile {
  const data: Record<string, unknown> = {};
  for (const key of EXPORTABLE_KEYS) {
    if (!(key in all)) continue;
    let value = structuredClone(all[key]);
    if (key === 'ts.calendarSources' && !opts.includeFeedUrls && Array.isArray(value)) {
      value = value.map((s: Record<string, unknown>) => {
        const { url: _url, ...rest } = s;
        return rest;
      });
    }
    data[key] = value;
  }
  return { app: EXPORT_APP, schemaVersion: SCHEMA_VERSION, appVersion: opts.appVersion, exportedAt: (opts.now ?? new Date()).toISOString(), data };
}

/* ------------------------------------------------------------------ */
/* Validation primitives                                               */
/* ------------------------------------------------------------------ */

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(path: string, what: string): never {
  throw new ImportError(`Invalid data at ${path}: ${what}.`);
}

function str(v: unknown, path: string, max = 2000): string {
  if (typeof v !== 'string') fail(path, 'expected text');
  if (v.length > max) fail(path, `text longer than ${max} characters`);
  return v;
}
function optStr(v: unknown, path: string, max = 2000): string | undefined {
  return v === undefined || v === null ? undefined : str(v, path, max);
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a number');
  return v;
}
function optNum(v: unknown, path: string): number | undefined {
  return v === undefined || v === null ? undefined : num(v, path);
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'expected true/false');
  return v;
}
function optBool(v: unknown, path: string): boolean | undefined {
  return v === undefined || v === null ? undefined : bool(v, path);
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail(path, `expected one of ${allowed.join(', ')}`);
  return v as T;
}
function id(v: unknown, path: string): string {
  const s = str(v, path, 300);
  if (!s) fail(path, 'empty id');
  return s;
}
function strArr(v: unknown, path: string, max = 200): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(path, 'expected a list');
  return v.map((x, i) => str(x, `${path}[${i}]`, max));
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function optDate(v: unknown, path: string): string | undefined {
  const s = optStr(v, path, 10);
  if (s !== undefined && !DATE_RE.test(s)) fail(path, 'expected YYYY-MM-DD');
  return s;
}
function optTime(v: unknown, path: string): string | undefined {
  const s = optStr(v, path, 5);
  if (s !== undefined && !TIME_RE.test(s)) fail(path, 'expected HH:mm');
  return s;
}
function base(r: Obj, path: string) {
  return { id: id(r.id, `${path}.id`), createdAt: num(r.createdAt, `${path}.createdAt`), updatedAt: num(r.updatedAt, `${path}.updatedAt`) };
}

const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
const PAGES: PageId[] = ['dashboard', 'workspaces', 'tabs', 'calendar', 'notes', 'tasks', 'bookmarks', 'focus', 'analytics', 'settings', 'sidebar'];

interface Ctx {
  warnings: string[];
}

type RecordValidator = (r: Obj, path: string, ctx: Ctx) => Obj | null;

const validators: Partial<Record<StoreKey, RecordValidator>> = {
  'ts.workspaces': (r, p) => ({ ...base(r, p), name: str(r.name, `${p}.name`, 200), icon: str(r.icon ?? 'folder', `${p}.icon`, 60), description: optStr(r.description, `${p}.description`), order: num(r.order ?? 0, `${p}.order`) }),
  'ts.sessions': (r, p, ctx) => {
    if (!Array.isArray(r.tabs)) fail(`${p}.tabs`, 'expected a list');
    if (r.groups !== undefined && !Array.isArray(r.groups)) fail(`${p}.groups`, 'expected a list');
    const tabs = (r.tabs as unknown[]).flatMap((t, i) => {
      const tp = `${p}.tabs[${i}]`;
      if (!isObj(t)) fail(tp, 'expected an object');
      const url = str(t.url, `${tp}.url`, 8000);
      if (!isSafeUrl(url)) {
        ctx.warnings.push(`Removed an unsafe tab link in a saved session.`);
        return [];
      }
      const fav = optStr(t.favIconUrl, `${tp}.favIconUrl`, 8000);
      return [{ id: id(t.id, `${tp}.id`), url, title: str(t.title ?? '', `${tp}.title`, 1000), favIconUrl: fav && /^https:\/\//.test(fav) ? fav : undefined, pinned: !!optBool(t.pinned, `${tp}.pinned`), groupId: optStr(t.groupId, `${tp}.groupId`, 300) }];
    });
    const groups = ((r.groups as unknown[]) ?? []).map((g, i) => {
      const gp = `${p}.groups[${i}]`;
      if (!isObj(g)) fail(gp, 'expected an object');
      return { id: id(g.id, `${gp}.id`), title: str(g.title ?? '', `${gp}.title`, 200), color: oneOf(g.color, GROUP_COLORS, `${gp}.color`), collapsed: !!optBool(g.collapsed, `${gp}.collapsed`) };
    });
    return { ...base(r, p), name: str(r.name, `${p}.name`, 300), workspaceId: optStr(r.workspaceId, `${p}.workspaceId`, 300), tabs, groups, archived: optBool(r.archived, `${p}.archived`) };
  },
  'ts.tasks': (r, p) => {
    if (r.subtasks !== undefined && !Array.isArray(r.subtasks)) fail(`${p}.subtasks`, 'expected a list');
    return {
      ...base(r, p),
      title: str(r.title, `${p}.title`, 1000),
      notes: optStr(r.notes, `${p}.notes`, 100_000),
      done: bool(r.done, `${p}.done`),
      completedAt: optNum(r.completedAt, `${p}.completedAt`),
      dueDate: optDate(r.dueDate, `${p}.dueDate`),
      dueTime: optTime(r.dueTime, `${p}.dueTime`),
      priority: oneOf(r.priority ?? 'none', ['none', 'low', 'medium', 'high'] as const, `${p}.priority`),
      someday: optBool(r.someday, `${p}.someday`),
      workspaceId: optStr(r.workspaceId, `${p}.workspaceId`, 300),
      subtasks: ((r.subtasks as unknown[]) ?? []).map((s, i) => {
        const sp = `${p}.subtasks[${i}]`;
        if (!isObj(s)) fail(sp, 'expected an object');
        return { id: id(s.id, `${sp}.id`), title: str(s.title, `${sp}.title`, 1000), done: bool(s.done, `${sp}.done`) };
      }),
      order: num(r.order ?? 0, `${p}.order`),
    };
  },
  'ts.notes': (r, p) => ({
    ...base(r, p),
    title: str(r.title, `${p}.title`, 1000),
    content: str(r.content ?? '', `${p}.content`, 2_000_000),
    folderId: optStr(r.folderId, `${p}.folderId`, 300),
    tags: strArr(r.tags, `${p}.tags`),
    favorite: !!optBool(r.favorite, `${p}.favorite`),
    workspaceId: optStr(r.workspaceId, `${p}.workspaceId`, 300),
    trashedAt: optNum(r.trashedAt, `${p}.trashedAt`),
  }),
  'ts.noteFolders': (r, p) => ({ ...base(r, p), name: str(r.name, `${p}.name`, 200), order: num(r.order ?? 0, `${p}.order`) }),
  'ts.bookmarkFolders': (r, p) => ({ ...base(r, p), name: str(r.name, `${p}.name`, 200), parentId: optStr(r.parentId, `${p}.parentId`, 300), order: num(r.order ?? 0, `${p}.order`) }),
  'ts.bookmarks': (r, p, ctx) => {
    const url = str(r.url, `${p}.url`, 8000);
    if (!isSafeUrl(url)) {
      ctx.warnings.push(`Removed bookmark "${String(r.title ?? '').slice(0, 60)}" with an unsafe link.`);
      return null;
    }
    return {
      ...base(r, p),
      url,
      title: str(r.title ?? '', `${p}.title`, 1000),
      description: optStr(r.description, `${p}.description`, 5000),
      folderId: optStr(r.folderId, `${p}.folderId`, 300),
      tags: strArr(r.tags, `${p}.tags`),
      favorite: !!optBool(r.favorite, `${p}.favorite`),
      workspaceId: optStr(r.workspaceId, `${p}.workspaceId`, 300),
      lastOpenedAt: optNum(r.lastOpenedAt, `${p}.lastOpenedAt`),
      notes: optStr(r.notes, `${p}.notes`, 100_000),
    };
  },
  'ts.quickLinks': (r, p, ctx) => {
    const url = str(r.url, `${p}.url`, 8000);
    if (!isSafeUrl(url)) {
      ctx.warnings.push(`Removed quick link "${String(r.title ?? '').slice(0, 60)}" with an unsafe link.`);
      return null;
    }
    return { id: id(r.id, `${p}.id`), title: str(r.title ?? '', `${p}.title`, 200), url, order: num(r.order ?? 0, `${p}.order`) };
  },
  'ts.calendarSources': (r, p, ctx) => {
    const url = optStr(r.url, `${p}.url`, 8000);
    const kind = oneOf(r.kind, ['local', 'ics-url', 'ics-file', 'google'] as const, `${p}.kind`);
    let safeUrl = url;
    if (url && !isSafeUrl(url)) {
      ctx.warnings.push('Removed an unsafe calendar feed link.');
      safeUrl = undefined;
    }
    const color = str(r.color ?? '#a1a1a6', `${p}.color`, 200);
    return {
      ...base(r, p),
      name: str(r.name, `${p}.name`, 200),
      kind,
      color: /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#a1a1a6',
      enabled: bool(r.enabled ?? true, `${p}.enabled`),
      url: safeUrl,
      googleCalendarId: optStr(r.googleCalendarId, `${p}.googleCalendarId`, 500),
      lastSyncedAt: optNum(r.lastSyncedAt, `${p}.lastSyncedAt`),
      lastError: optStr(r.lastError, `${p}.lastError`, 500),
    };
  },
  'ts.events': (r, p) => {
    const allDay = bool(r.allDay, `${p}.allDay`);
    const start = str(r.start, `${p}.start`, 40);
    const end = str(r.end ?? start, `${p}.end`, 40);
    for (const [k, v] of [
      ['start', start],
      ['end', end],
    ] as const) {
      if (allDay ? !DATE_RE.test(v.slice(0, 10)) : !Number.isFinite(Date.parse(v))) fail(`${p}.${k}`, 'expected a date');
    }
    const rec = r.recurrence === undefined || r.recurrence === null ? undefined : oneOf(r.recurrence, ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const, `${p}.recurrence`);
    return {
      ...base(r, p),
      sourceId: id(r.sourceId, `${p}.sourceId`),
      externalId: optStr(r.externalId, `${p}.externalId`, 1000),
      title: str(r.title, `${p}.title`, 1000),
      description: optStr(r.description, `${p}.description`, 20_000),
      location: optStr(r.location, `${p}.location`, 2000),
      start,
      end,
      allDay,
      recurrence: rec,
      reminderMinutes: optNum(r.reminderMinutes, `${p}.reminderMinutes`),
      workspaceId: optStr(r.workspaceId, `${p}.workspaceId`, 300),
    };
  },
  'ts.focusSessions': (r, p) => ({
    ...base(r, p),
    kind: oneOf(r.kind, ['focus', 'short', 'long', 'custom'] as const, `${p}.kind`),
    startedAt: num(r.startedAt, `${p}.startedAt`),
    endedAt: num(r.endedAt, `${p}.endedAt`),
    plannedMs: num(r.plannedMs, `${p}.plannedMs`),
    actualMs: num(r.actualMs, `${p}.actualMs`),
    completed: bool(r.completed, `${p}.completed`),
  }),
};

function validateList(key: StoreKey, value: unknown, ctx: Ctx): unknown[] {
  if (!Array.isArray(value)) fail(key, 'expected a list');
  if (value.length > 100_000) fail(key, 'too many records');
  const v = validators[key];
  const seen = new Set<string>();
  const out: unknown[] = [];
  value.forEach((item, i) => {
    const path = `${key}[${i}]`;
    if (!isObj(item)) fail(path, 'expected an object');
    const cleaned = v ? v(item, path, ctx) : { ...item, id: id(item.id, `${path}.id`) };
    if (!cleaned) return;
    if (seen.has(cleaned.id as string)) fail(`${path}.id`, 'duplicate id');
    seen.add(cleaned.id as string);
    // Drop undefined fields for clean storage.
    out.push(Object.fromEntries(Object.entries(cleaned).filter(([, x]) => x !== undefined)));
  });
  return out;
}

function validateNumberMap(key: string, value: unknown): Record<string, Record<string, number>> {
  if (!isObj(value)) fail(key, 'expected an object');
  const out: Record<string, Record<string, number>> = {};
  for (const [day, inner] of Object.entries(value)) {
    if (!DATE_RE.test(day)) fail(`${key}.${day.slice(0, 20)}`, 'expected YYYY-MM-DD keys');
    if (!isObj(inner)) fail(`${key}.${day}`, 'expected an object');
    out[day] = {};
    for (const [k, n] of Object.entries(inner)) {
      if (k.length > 300) fail(`${key}.${day}`, 'key too long');
      out[day][k] = Math.max(0, num(n, `${key}.${day}.${k.slice(0, 40)}`));
    }
  }
  return out;
}

const SETTINGS_ENUMS: Record<string, readonly string[]> = {
  theme: ['dark', 'light', 'auto'],
  density: ['comfortable', 'compact'],
  textScale: ['sm', 'md', 'lg'],
  defaultPage: PAGES,
  'newTab.searchEngine': ['google', 'duckduckgo', 'bing'],
};

/** Take only fields whose type matches the defaults (recursively). Wrong types are rejected. */
function pickLike(template: Obj, value: Obj, path: string): Obj {
  const out: Obj = {};
  for (const [k, def] of Object.entries(template)) {
    if (!(k in value) || value[k] === undefined) continue;
    const v = value[k];
    const p = path ? `${path}.${k}` : k;
    const enums = SETTINGS_ENUMS[p];
    if (enums) out[k] = oneOf(v, enums, `ts.settings.${p}`);
    else if (Array.isArray(def)) {
      if (!Array.isArray(v)) fail(`ts.settings.${p}`, 'expected a list');
      out[k] = v;
    } else if (isObj(def)) {
      if (!isObj(v)) fail(`ts.settings.${p}`, 'expected an object');
      out[k] = pickLike(def, v, p);
    } else if (typeof def !== typeof v) fail(`ts.settings.${p}`, `expected ${typeof def}`);
    else out[k] = typeof v === 'string' ? str(v, `ts.settings.${p}`, 500) : v;
  }
  return out;
}

export function validateSettings(value: unknown, ctx: Ctx): Partial<Settings> {
  if (!isObj(value)) fail('ts.settings', 'expected an object');
  const out = pickLike(DEFAULT_SETTINGS as unknown as Obj, value, '') as Partial<Settings>;
  // Forward-compatible: optional top-level flags added later (e.g. welcomeDismissed) — booleans/numbers only.
  for (const [k, v] of Object.entries(value)) {
    if (k in DEFAULT_SETTINGS || k === 'backgroundImage' || k === 'integrations') continue;
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) (out as Obj)[k] = v;
  }
  if (out.focus?.blocklist) out.focus.blocklist = strArr(out.focus.blocklist, 'ts.settings.focus.blocklist', 300);
  if (out.smartGrouping?.rules) {
    out.smartGrouping.rules = (out.smartGrouping.rules as unknown[]).map((r, i) => {
      const p = `ts.settings.smartGrouping.rules[${i}]`;
      if (!isObj(r)) fail(p, 'expected an object');
      return { id: id(r.id, `${p}.id`), pattern: str(r.pattern, `${p}.pattern`, 300), groupTitle: str(r.groupTitle, `${p}.groupTitle`, 200), color: oneOf(r.color, GROUP_COLORS, `${p}.color`) };
    });
  }
  const integrations = isObj(value.integrations) ? value.integrations : {};
  const ints: Settings['integrations'] = {};
  const g = optStr(integrations.googleClientId, 'ts.settings.integrations.googleClientId', 300);
  const s = optStr(integrations.spotifyClientId, 'ts.settings.integrations.spotifyClientId', 300);
  const pl = optStr(integrations.spotifyPlaylistUri, 'ts.settings.integrations.spotifyPlaylistUri', 300);
  if (g) ints.googleClientId = g;
  if (s) ints.spotifyClientId = s;
  if (pl && (pl === 'liked' || /^spotify:playlist:[A-Za-z0-9]+$/.test(pl))) ints.spotifyPlaylistUri = pl;
  out.integrations = ints;
  const bg = value.backgroundImage;
  if (bg !== undefined && bg !== null) {
    if (typeof bg === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(bg) && bg.length <= 7_500_000) out.backgroundImage = bg;
    else ctx.warnings.push('Skipped the background image (not a supported image).');
  }
  return out;
}

export interface ImportOk {
  ok: true;
  data: Partial<Record<StoreKey, unknown>>;
  counts: Partial<Record<StoreKey, number>>;
  warnings: string[];
  exportedAt?: string;
  schemaVersion: number;
}
export interface ImportFail {
  ok: false;
  error: string;
}

/** Parse + strictly validate an export file. */
export function parseImport(text: string, maxBytes = IMPORT_MAX_BYTES): ImportOk | ImportFail {
  try {
    if (typeof text !== 'string' || !text.trim()) throw new ImportError('The file is empty.');
    if (text.length > maxBytes) throw new ImportError(`The file is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ImportError('This file is not valid JSON. Choose a Tabspace backup (.json).');
    }
    return validateImport(json);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Import failed.' };
  }
}

export function validateImport(json: unknown): ImportOk | ImportFail {
  try {
    if (!isObj(json) || json.app !== EXPORT_APP || !isObj(json.data)) throw new ImportError('This is not a Tabspace backup file.');
    const version = num(json.schemaVersion, 'schemaVersion');
    if (version > SCHEMA_VERSION) throw new ImportError(`This backup was made by a newer Tabspace (schema ${version}). Update Tabspace first.`);
    if (version < 1) throw new ImportError('Unsupported backup version.');
    const ctx: Ctx = { warnings: [] };
    const data: Partial<Record<StoreKey, unknown>> = {};
    const counts: Partial<Record<StoreKey, number>> = {};
    for (const [rawKey, value] of Object.entries(json.data)) {
      if (rawKey.startsWith('secret.')) {
        ctx.warnings.push('Ignored credentials in the file (secrets are never imported).');
        continue;
      }
      if (!(EXPORTABLE_KEYS as string[]).includes(rawKey)) throw new ImportError(`Unknown data "${rawKey.slice(0, 60)}" in this file.`);
      const key = rawKey as StoreKey;
      if (key === 'ts.settings') data[key] = validateSettings(value, ctx);
      else if (key === 'ts.usage' || key === 'ts.workspaceActivity') {
        data[key] = validateNumberMap(key, value);
        counts[key] = Object.keys(data[key] as object).length;
      } else if (key === 'ts.quotes') {
        if (!isObj(value)) fail(key, 'expected an object');
        const favorites = Array.isArray(value.favorites) ? value.favorites.map((n, i) => num(n, `${key}.favorites[${i}]`)) : [];
        const shift = isObj(value.shift) ? { date: str(value.shift.date, `${key}.shift.date`, 10), n: num(value.shift.n, `${key}.shift.n`) } : undefined;
        data[key] = shift ? { favorites, shift } : { favorites };
      } else if (key === 'ts.sampleIds') {
        if (!isObj(value)) fail(key, 'expected an object');
        // Only real collection keys are allowed (blocks "__proto__", "constructor" and other junk).
        const ids: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(value)) {
          if (!SAMPLE_ID_KEYS.has(k)) {
            ctx.warnings.push('Ignored unknown example-data entries.');
            continue;
          }
          ids[k] = strArr(v, `${key}.${k}`, 300);
        }
        data[key] = ids;
      } else if (Array.isArray(DEFAULTS[key])) {
        data[key] = validateList(key, value, ctx);
        counts[key] = (data[key] as unknown[]).length;
      } else {
        // A key added by another module with a non-list shape: accept only the same JSON kind as its default.
        const def = DEFAULTS[key];
        if (typeof def !== typeof value || Array.isArray(value) !== Array.isArray(def)) fail(key, 'unexpected shape');
        data[key] = value;
      }
    }
    // Calendar events must reference an imported or existing source; orphan checks happen on merge.
    return { ok: true, data, counts, warnings: Array.from(new Set(ctx.warnings)), exportedAt: typeof json.exportedAt === 'string' ? json.exportedAt : undefined, schemaVersion: version };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Import failed.' };
  }
}

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

/**
 * Merge imported data into current data.
 * - Lists: union by id; on conflict the record with the newer `updatedAt` wins.
 * - Day maps (usage/activity): per-entry max (avoids double counting a re-import).
 * - Settings: current settings are kept (Replace mode restores imported settings).
 */
export function mergeData(current: Partial<Record<StoreKey, unknown>>, incoming: Partial<Record<StoreKey, unknown>>): Partial<Record<StoreKey, unknown>> {
  const out: Partial<Record<StoreKey, unknown>> = {};
  for (const [k, inc] of Object.entries(incoming) as [StoreKey, unknown][]) {
    const cur = current[k];
    if (k === 'ts.settings') continue;
    if (Array.isArray(inc)) {
      const map = new Map<string, Obj>();
      for (const r of (Array.isArray(cur) ? cur : []) as Obj[]) map.set(r.id as string, r);
      for (const r of inc as Obj[]) {
        const existing = map.get(r.id as string);
        if (!existing || Number(r.updatedAt ?? 0) > Number(existing.updatedAt ?? 0)) map.set(r.id as string, r);
      }
      out[k] = Array.from(map.values());
    } else if (k === 'ts.usage' || k === 'ts.workspaceActivity') {
      const merged: Record<string, Record<string, number>> = structuredClone((cur as Record<string, Record<string, number>>) ?? {});
      for (const [day, inner] of Object.entries(inc as Record<string, Record<string, number>>)) {
        merged[day] = merged[day] ?? {};
        for (const [d, n] of Object.entries(inner)) merged[day][d] = Math.max(merged[day][d] ?? 0, n);
      }
      out[k] = merged;
    } else if (k === 'ts.sampleIds') {
      const merged: Record<string, string[]> = {};
      for (const src of [cur, inc] as unknown[]) {
        if (!isObj(src)) continue;
        for (const [key, ids] of Object.entries(src)) {
          if (!SAMPLE_ID_KEYS.has(key) || !Array.isArray(ids)) continue;
          const prev = Object.prototype.hasOwnProperty.call(merged, key) ? merged[key] : [];
          merged[key] = Array.from(new Set([...prev, ...ids.filter((x): x is string => typeof x === 'string')]));
        }
      }
      out[k] = merged;
    } else if (k === 'ts.quotes') {
      const c = (cur as { favorites?: number[] }) ?? {};
      const i = inc as { favorites: number[] };
      out[k] = { ...c, favorites: Array.from(new Set([...(c.favorites ?? []), ...i.favorites])) };
    } else out[k] = inc;
  }
  return out;
}
