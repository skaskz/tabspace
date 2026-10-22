import { useMemo } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { Button, Card, CardHeader, Favicon, IconButton, useToast } from '@/components/ui';
import { useStore } from '@/hooks/useStore';
import { formatRelative } from '@/utils/date';
import { dismissSyncRemoval, recentSyncRemovals, restoreSyncRemoval } from '@/services/workspaceGroupSync';
import { errorMessage } from './sessionActions';

/** "Recently removed by tab moves": saved tabs dropped because a tab was dragged out of the workspace's group (7 days). */
export function SyncRemovedPanel({ workspaceId }: { workspaceId: string }) {
  const [all] = useStore('ts.syncRemovedTabs');
  const toast = useToast();
  const items = useMemo(() => recentSyncRemovals(all, workspaceId), [all, workspaceId]);
  if (!items.length) return null;
  const restore = async (id: string, title: string) => {
    try {
      const r = await restoreSyncRemoval(id);
      toast(r === 'restored' ? `Restored “${title}” to saved tabs` : r === 'already-saved' ? `“${title}” is already saved` : 'Nothing to restore');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Card>
      <CardHeader title={`Recently removed by tab moves (${items.length})`} />
      <p className="-mt-1 px-5 pb-2 text-xs text-muted">These tabs were dragged out of this workspace’s tab group in Chrome, which removes them from its saved tabs. Kept here for 7 days.</p>
      <ul className="pb-2">
        {items.map((x) => (
          <li key={x.id} className="flex items-center gap-3 border-t border-line px-5 py-2">
            <Favicon url={x.tab.url} size={15} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{x.tab.title || x.tab.url}</span>
              <span className="block truncate text-xs text-faint">
                {x.tab.url} · {formatRelative(x.removedAt)}
              </span>
            </span>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => void restore(x.id, x.tab.title || x.tab.url)} aria-label={`Restore ${x.tab.title || x.tab.url} to saved tabs`}>
              Restore
            </Button>
            <IconButton size="sm" label={`Dismiss ${x.tab.title || x.tab.url}`} onClick={() => void dismissSyncRemoval(x.id)}>
              <X size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
    </Card>
  );
}
