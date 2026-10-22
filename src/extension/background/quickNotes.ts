import { update } from '@/storage/store';
import { applyPending, PENDING_PREFIX, type PendingQuickNote } from '../popup/quickNote';

/**
 * Merge Quick Note pending-create records (written synchronously by the popup
 * as it closes) into ts.notes under the store lock, then delete them.
 */
let running: Promise<number> | null = null;

export function mergePendingQuickNotes(): Promise<number> {
  if (running) return running;
  running = (async () => {
    let applied = 0;
    const all = await chrome.storage.local.get(null);
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(PENDING_PREFIX)) continue;
      try {
        const rec = value as PendingQuickNote;
        if (rec && typeof rec === 'object' && rec.note && rec.note.id === key.slice(PENDING_PREFIX.length)) {
          await update('ts.notes', (list) => {
            const r = applyPending(list, rec);
            if (r.applied) applied++;
            return r.list;
          });
        }
      } finally {
        await chrome.storage.local.remove(key);
      }
    }
    return applied;
  })().finally(() => {
    running = null;
  });
  return running;
}
