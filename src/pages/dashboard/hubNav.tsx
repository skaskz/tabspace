import { createContext, useContext } from 'react';
import { navigate } from '@/app/router';
import type { PageId } from '@/types/models';

/**
 * How shared hub widgets go to a dashboard page. On the dashboard it is the
 * hash router; the New Tab provides one that loads the dashboard in the tab.
 */
export type HubGo = (page: PageId, params?: Record<string, string | undefined>) => void;

const HubNavContext = createContext<HubGo>(navigate);

export const HubNavProvider = HubNavContext.Provider;

export function useHubNav(): HubGo {
  return useContext(HubNavContext);
}
