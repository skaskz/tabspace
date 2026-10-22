import { AppWindow, BarChart3, Bookmark, CalendarDays, CheckSquare, FileText, Home, LayoutGrid, PanelRight, Settings, Timer, type LucideIcon } from 'lucide-react';
import type { PageId } from '@/types/models';

export interface NavEntry {
  id: PageId;
  label: string;
  icon: LucideIcon;
}

export const NAV: NavEntry[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'workspaces', label: 'Workspaces', icon: LayoutGrid },
  { id: 'tabs', label: 'Tabs', icon: AppWindow },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'notes', label: 'Notes', icon: FileText },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'focus', label: 'Focus Mode', icon: Timer },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
];

export const NAV_FOOTER: NavEntry[] = [
  { id: 'sidebar', label: 'Chrome Sidebar', icon: PanelRight },
  { id: 'settings', label: 'Settings', icon: Settings },
];
