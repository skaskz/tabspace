/** Messages extension pages may send to the service worker. */
export type SidebarMessage = { type: 'sidebar:open' | 'sidebar:close'; windowId?: number };

/** Strict shape check: only our own two message types, with an optional non-negative integer windowId. */
export function isSidebarMessage(msg: unknown): msg is SidebarMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (m.type !== 'sidebar:open' && m.type !== 'sidebar:close') return false;
  return m.windowId === undefined || (typeof m.windowId === 'number' && Number.isInteger(m.windowId) && m.windowId >= 0);
}
