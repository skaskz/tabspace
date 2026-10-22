import type { Settings, SidebarSection } from '@/types/models';

export const SIDEBAR_SECTIONS: SidebarSection[] = ['focus', 'tasks', 'notes', 'bookmarks', 'workspaces'];

export const SECTION_LABELS: Record<SidebarSection, string> = {
  focus: 'Focus',
  tasks: 'Tasks',
  notes: 'Notes',
  bookmarks: 'Bookmarks',
  workspaces: 'Workspaces',
};

export function enabledSections(settings: Pick<Settings, 'sidebar'>): SidebarSection[] {
  return SIDEBAR_SECTIONS.filter((s) => settings.sidebar.sections[s]);
}

/**
 * Which section to show: the configured default view, else the last one used,
 * else the first visible one — always falling back to a section that is
 * actually enabled (or null if the user hid them all).
 */
export function resolveSection(settings: Pick<Settings, 'sidebar'>, last: string | null | undefined): SidebarSection | null {
  const enabled = enabledSections(settings);
  if (!enabled.length) return null;
  const pref = settings.sidebar.defaultView ?? 'last';
  if (pref !== 'last' && enabled.includes(pref)) return pref;
  if (last && (enabled as string[]).includes(last)) return last as SidebarSection;
  return enabled[0];
}

const LAST_KEY = 'ts.sidebarSection';

/** Last-used section lives in chrome.storage.session (cleared when the browser restarts). */
export async function loadLastSection(): Promise<string | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const r = await chrome.storage.session.get(LAST_KEY);
      return (r[LAST_KEY] as string | undefined) ?? null;
    }
    return sessionStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export async function saveLastSection(section: SidebarSection): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) await chrome.storage.session.set({ [LAST_KEY]: section });
    else sessionStorage.setItem(LAST_KEY, section);
  } catch {
    /* non-essential */
  }
}
