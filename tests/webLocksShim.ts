/**
 * Minimal exclusive-mode Web Locks shim for jsdom. Mirrors browser semantics:
 * requests for the same name run one at a time in request order, and the lock
 * is released when the callback's promise settles. Shared across module
 * instances (it lives on the global navigator), like the real per-origin API.
 */
export function installWebLocksShim(): void {
  const nav = globalThis.navigator as Navigator & { locks?: unknown };
  if (nav.locks) return;
  const tails = new Map<string, Promise<unknown>>();
  const locks = {
    request(name: string, ...args: unknown[]): Promise<unknown> {
      const cb = args[args.length - 1] as (lock: { name: string; mode: string }) => unknown;
      const prev = tails.get(name) ?? Promise.resolve();
      const run = prev.catch(() => undefined).then(() => cb({ name, mode: 'exclusive' }));
      tails.set(name, run.catch(() => undefined));
      return run;
    },
    query: async () => ({ held: [], pending: [] }),
  };
  Object.defineProperty(nav, 'locks', { value: locks, configurable: true });
}
