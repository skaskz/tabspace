import { secretKV } from './secretStore';

/**
 * OAuth secret storage. Secrets live ONLY under `secret.*` keys:
 *  - chrome.storage.session for short-lived access tokens (TRUSTED_CONTEXTS only: extension
 *    pages + worker, cleared when the browser closes),
 *  - the extension-origin IndexedDB secret store for long-lived refresh tokens (Spotify) —
 *    content scripts cannot read it, unlike chrome.storage.local,
 *  - chrome.storage.local only for token-free markers (Google "connected" flag).
 * A legacy `secret.spotify` found in chrome.storage.local is moved on first read and deleted there.
 * Secrets are never exported, never logged, and removed on Disconnect.
 * Outside the extension (dev server, tests) in-memory stores are used — never localStorage.
 */

/** Long-lived secrets whose 'local' area is the IndexedDB store, not chrome.storage.local. */
const IDB_SECRETS = new Set<string>(['secret.spotify']);

export type SecretKey = 'secret.google' | 'secret.spotify';
export type SecretArea = 'local' | 'session';

const memory: Record<SecretArea, Map<string, unknown>> = { local: new Map(), session: new Map() };

function area(name: SecretArea): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  const a = name === 'session' ? chrome.storage.session : chrome.storage.local;
  return a ?? null;
}

/** Move a legacy copy from chrome.storage.local into the IndexedDB store (once, under a lock). */
async function migrateLegacy<T>(key: SecretKey): Promise<T | undefined> {
  const legacyArea = area('local');
  if (!legacyArea) return undefined;
  const run = async (): Promise<T | undefined> => {
    const existing = await secretKV().get<T>(key);
    const legacy = (await legacyArea.get(key))[key] as T | undefined;
    if (legacy === undefined) return existing;
    // Never overwrite a newer value already in the store (e.g. a rotated refresh token).
    if (existing === undefined) await secretKV().set(key, legacy);
    await legacyArea.remove(key);
    return existing ?? legacy;
  };
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks?.request ? ((await locks.request('tabspace-secret-migrate', run)) as T | undefined) : run();
}

/** Worker start-up: migrate legacy long-lived secrets out of chrome.storage.local. */
export async function migrateLegacySecrets(): Promise<void> {
  for (const key of IDB_SECRETS) await migrateLegacy(key as SecretKey);
}

/** Keep session storage (Google access token, Spotify snapshot) away from content scripts. */
export async function restrictSessionStorage(): Promise<void> {
  const session = typeof chrome !== 'undefined' ? (chrome.storage?.session as (chrome.storage.StorageArea & { setAccessLevel?: (o: { accessLevel: string }) => Promise<void> }) | undefined) : undefined;
  await session?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
}

export async function getSecret<T>(key: SecretKey, where: SecretArea): Promise<T | undefined> {
  if (where === 'local' && IDB_SECRETS.has(key)) {
    const v = await secretKV().get<T>(key);
    return v !== undefined ? v : migrateLegacy<T>(key);
  }
  const a = area(where);
  if (!a) return memory[where].get(key) as T | undefined;
  const res = await a.get(key);
  return res[key] as T | undefined;
}

export async function setSecret<T>(key: SecretKey, value: T, where: SecretArea): Promise<void> {
  if (where === 'local' && IDB_SECRETS.has(key)) {
    await secretKV().set(key, value);
    await area('local')?.remove(key); // never leave a readable copy behind
    return;
  }
  const a = area(where);
  if (!a) {
    memory[where].set(key, value);
    return;
  }
  await a.set({ [key]: value });
}

export async function removeSecretIn(key: SecretKey, where: SecretArea): Promise<void> {
  if (where === 'local' && IDB_SECRETS.has(key)) await secretKV().delete(key);
  const a = area(where);
  if (a) await a.remove(key);
  else memory[where].delete(key);
}

/** Remove the secret from both areas. */
export async function removeSecret(key: SecretKey): Promise<void> {
  if (IDB_SECRETS.has(key)) await secretKV().delete(key);
  for (const where of ['local', 'session'] as const) {
    const a = area(where);
    if (a) await a.remove(key);
    else memory[where].delete(key);
  }
}

/** Test helper. */
export function __resetMemorySecrets(): void {
  memory.local.clear();
  memory.session.clear();
  void secretKV().clear();
}

export function identityAvailable(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.identity?.launchWebAuthFlow && !!chrome.identity?.getRedirectURL;
}

export interface AuthFlowDetails {
  url: string;
  interactive: boolean;
  /** Chrome 113+: keep a non-interactive flow alive until timeout (for JS redirects). */
  abortOnLoadForNonInteractive?: boolean;
  timeoutMsForNonInteractive?: number;
}

/** Typed wrapper around chrome.identity.launchWebAuthFlow (promise form, Chrome 106+). */
export function launchAuthFlow(details: AuthFlowDetails): Promise<string | undefined> {
  const fn = chrome.identity.launchWebAuthFlow as unknown as (d: AuthFlowDetails) => Promise<string | undefined>;
  return fn.call(chrome.identity, details);
}

/** The redirect URI users must register with Google / Spotify, or null outside the extension. */
export function redirectUri(): string | null {
  if (!identityAvailable()) return null;
  return chrome.identity.getRedirectURL();
}

/** Random URL-safe string (for OAuth `state` and PKCE verifiers). */
export function randomString(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

export function base64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
