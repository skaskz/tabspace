/**
 * Tabspace shared data models.
 *
 * Every persisted record has a stable application ID (never a Chrome runtime
 * tab/group/window ID, which change across restarts) plus timestamps.
 * Dates without a time component are stored as local `YYYY-MM-DD` strings.
 */

export type ID = string;

export interface BaseRecord {
  id: ID;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Workspaces, tabs and sessions                                       */
/* ------------------------------------------------------------------ */

export interface Workspace extends BaseRecord {
  name: string;
  /** Lucide icon name (see components/ui/WorkspaceIcon). */
  icon: string;
  description?: string;
  order: number;
}

/** Chrome's tab group colours (chrome.tabGroups.ColorEnum). */
export type GroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export interface SavedTabGroup {
  id: ID;
  title: string;
  color: GroupColor;
  collapsed: boolean;
}

export interface SavedTab {
  id: ID;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  /** References SavedTabGroup.id within the same session. */
  groupId?: ID;
}

export interface SavedSession extends BaseRecord {
  name: string;
  workspaceId?: ID;
  tabs: SavedTab[];
  groups: SavedTabGroup[];
  /** Set when the session was archived by "replace current tabs". */
  archived?: boolean;
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export type Priority = 'none' | 'low' | 'medium' | 'high';

export interface Subtask {
  id: ID;
  title: string;
  done: boolean;
}

export interface Task extends BaseRecord {
  title: string;
  notes?: string;
  done: boolean;
  completedAt?: number;
  /** Local date `YYYY-MM-DD`. */
  dueDate?: string;
  /** Local time `HH:mm`. */
  dueTime?: string;
  priority: Priority;
  /** Explicitly parked for later; shown in the Someday list. */
  someday?: boolean;
  workspaceId?: ID;
  subtasks: Subtask[];
  order: number;
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

export interface NoteFolder extends BaseRecord {
  name: string;
  order: number;
}

export interface Note extends BaseRecord {
  title: string;
  /** Markdown source. */
  content: string;
  folderId?: ID;
  tags: string[];
  favorite: boolean;
  workspaceId?: ID;
  /** Soft-delete timestamp; notes in trash can be restored. */
  trashedAt?: number;
}

/* ------------------------------------------------------------------ */
/* Bookmarks                                                           */
/* ------------------------------------------------------------------ */

export interface BookmarkFolder extends BaseRecord {
  name: string;
  parentId?: ID;
  order: number;
}

export interface Bookmark extends BaseRecord {
  url: string;
  title: string;
  description?: string;
  folderId?: ID;
  tags: string[];
  favorite: boolean;
  workspaceId?: ID;
  lastOpenedAt?: number;
  notes?: string;
}

/** Customisable shortcut tiles (dashboard Quick Links, New Tab shortcuts). */
export interface QuickLink {
  id: ID;
  title: string;
  url: string;
  order: number;
}

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

export type CalendarSourceKind = 'local' | 'ics-url' | 'ics-file' | 'google';

export interface CalendarSource extends BaseRecord {
  name: string;
  kind: CalendarSourceKind;
  /** Display colour (hex). Calendar colours are one of the few allowed colour uses. */
  color: string;
  enabled: boolean;
  /** ICS feed URL (kind === 'ics-url'). Treated as a secret: never logged or exported in plain text to third parties. */
  url?: string;
  /** Google calendar id (kind === 'google'). */
  googleCalendarId?: string;
  lastSyncedAt?: number;
  lastError?: string;
}

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface CalendarEvent extends BaseRecord {
  sourceId: ID;
  /** UID (+ recurrence id) from the external provider. */
  externalId?: string;
  title: string;
  description?: string;
  location?: string;
  /** ISO 8601 instant for timed events; `YYYY-MM-DD` for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
  /** Simple recurrence for local events. External recurrences are expanded at sync time. */
  recurrence?: Recurrence;
  /** Minutes before start to notify; undefined = no reminder. */
  reminderMinutes?: number;
  workspaceId?: ID;
}

/* ------------------------------------------------------------------ */
/* Focus                                                               */
/* ------------------------------------------------------------------ */

export type FocusKind = 'focus' | 'short' | 'long' | 'custom';

export interface FocusState {
  status: 'idle' | 'running' | 'paused';
  kind: FocusKind;
  /** Planned length of the current session. */
  durationMs: number;
  /** Absolute end timestamp while running — the source of truth for remaining time. */
  endAt?: number;
  /** Remaining ms captured when paused. */
  remainingMs?: number;
  startedAt?: number;
  /** Accumulated paused time, for accurate actual-duration stats. */
  label?: string;
  /** Set on the idle state right after a session ends naturally (V2 completion state; cleared by start/select). */
  completed?: { kind: FocusKind; at: number };
}

export interface FocusSessionRecord extends BaseRecord {
  kind: FocusKind;
  startedAt: number;
  endedAt: number;
  plannedMs: number;
  /** Time actually spent focusing. */
  actualMs: number;
  completed: boolean;
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

/** date (YYYY-MM-DD) -> domain -> milliseconds. Only collected with explicit opt-in. */
export type UsageLog = Record<string, Record<string, number>>;

/** date (YYYY-MM-DD) -> workspaceId -> count of opens/saves. */
export type WorkspaceActivityLog = Record<string, Record<string, number>>;

/**
 * Link between a workspace and its native Chrome tab group (V2.2). `groupId`/`windowId` are Chrome runtime
 * IDs, valid only until Chrome restarts — they are re-linked on startup (title match). One link per workspace.
 */
export interface WorkspaceGroupLink {
  workspaceId: ID;
  /** Chrome tab group colour for this workspace (stable; user-changeable). */
  color: GroupColor;
  groupId?: number;
  windowId?: number;
  /** True while the group exists in a window. */
  open: boolean;
  /**
   * The group disappeared together with its window (window closed / Chrome quit), so Chrome may restore it
   * after a restart. Only such links (or links still open) may be re-linked by title, and only right after
   * a browser start.
   */
  awaitingRestore?: boolean;
  updatedAt: number;
}

/** A saved tab removed by membership sync (tab dragged out of a workspace group); restorable for 7 days. */
export interface SyncRemovedTab {
  id: ID;
  workspaceId: ID;
  tab: SavedTab;
  /** Index it had in the saved list. */
  index: number;
  group?: SavedTabGroup;
  removedAt: number;
}

/* ------------------------------------------------------------------ */
/* Backups & example data (Integrations & Data agent)                  */
/* ------------------------------------------------------------------ */

/** Local automatic backup snapshot (never contains secret.* keys). */
export interface BackupSnapshot {
  id: ID;
  takenAt: number;
  reason: 'daily' | 'import' | 'manual' | 'restore';
  schemaVersion: number;
  /** ts.* key -> value (excluding ts.backups itself). */
  data: Record<string, unknown>;
}

/** IDs of example records per store key, so "Remove example data" deletes exactly them. */
export type SampleIds = Record<string, string[]>;

/* ------------------------------------------------------------------ */
/* Quotes                                                              */
/* ------------------------------------------------------------------ */

export interface QuoteState {
  /** Indices into the quotes catalogue. */
  favorites: number[];
  /** Manual refreshes for a given date shift the daily quote. */
  shift?: { date: string; n: number };
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type PageId =
  | 'dashboard'
  | 'workspaces'
  | 'tabs'
  | 'calendar'
  | 'notes'
  | 'tasks'
  | 'bookmarks'
  | 'focus'
  | 'analytics'
  | 'settings'
  | 'sidebar';

export interface SmartGroupRule {
  id: ID;
  /** Case-insensitive substring matched against URL host+path and title. */
  pattern: string;
  groupTitle: string;
  color: GroupColor;
}

export type SidebarSection = 'focus' | 'tasks' | 'notes' | 'bookmarks' | 'workspaces';
export type SidebarDefaultView = 'last' | SidebarSection;

/** Widgets the user can place on the New Tab page (V2.1 customization). */
export type NewTabWidgetId = 'bar' | 'clock' | 'search' | 'quote' | 'workspaces' | 'tasks' | 'recentTabs' | 'calendar' | 'upcoming' | 'focus' | 'spotify' | 'quickLinks';

/** User-arranged New Tab layout: ordered widgets per column; anything not listed (or in `hidden`) is not shown. */
export interface NewTabLayout {
  main: NewTabWidgetId[];
  side: NewTabWidgetId[];
  hidden: NewTabWidgetId[];
}

export interface Settings {
  schemaVersion: number;
  userName: string;
  theme: 'dark' | 'light' | 'auto';
  starfield: boolean;
  /** Mouse-driven 3D parallax on the starfield (V2). Off automatically with reduced motion. */
  parallax: boolean;
  animations: boolean;
  reducedMotion: boolean;
  showFigure: boolean;
  density: 'comfortable' | 'compact';
  textScale: 'sm' | 'md' | 'lg';
  /** Data URL of a user-uploaded background (stored locally only). */
  backgroundImage?: string;
  defaultPage: PageId;
  /** Set when the user dismisses the dashboard welcome card ("Start fresh"). */
  welcomeDismissed?: boolean;
  dashboardWidgets: {
    quickActions: boolean;
    workspaces: boolean;
    tasks: boolean;
    recentTabs: boolean;
    savedLinks: boolean;
  };
  sidebar: {
    enabled: boolean;
    sections: { focus: boolean; tasks: boolean; notes: boolean; bookmarks: boolean; workspaces: boolean };
    /** Section shown when the side panel opens; 'last' = remember the last one used. */
    defaultView?: SidebarDefaultView;
  };
  newTab: {
    enabled: boolean;
    showQuote: boolean;
    showFocus: boolean;
    /** Search engine used by the New Tab search field. */
    searchEngine: 'google' | 'duckduckgo' | 'bing';
    /** Custom arrangement; undefined = the built-in default layout. */
    layout?: NewTabLayout;
  };
  /**
   * Tabspace Bar (V2.1): a bookmarks/workspaces strip. Chrome's native bookmarks bar can't be replaced by an
   * extension, so this bar is shown on the Tabspace New Tab and — only if the user opts in and grants site
   * access — at the top of websites (rendered in an isolated extension iframe).
   */
  /** Workspace ↔ native Chrome tab group behaviour (V2.2). */
  workspaceGroups: {
    /** Open each workspace as its own named, collapsible tab group in the current window. */
    enabled: boolean;
    /** Collapse other workspace groups when switching to / opening a workspace. */
    collapseOthers: boolean;
    /** Moving a tab into / out of a workspace group adds / removes it from that workspace's saved tabs. Closing tabs never removes saved tabs. */
    syncMembership: boolean;
  };
  /** Opt-in deep-space styling for search result pages (V2.2). Needs optional site access for the chosen engines. */
  searchTheme: {
    enabled: boolean;
    engines: ('google' | 'duckduckgo' | 'bing')[];
  };
  /** GitHub release update checks (V2.3). */
  updates: {
    /** Check GitHub Releases for a newer version (twice a day). */
    check: boolean;
  };
  tabspaceBar: {
    onNewTab: boolean;
    onWebsites: boolean;
    showWorkspaces: boolean;
    showFolders: boolean;
    /** Hostnames where the website bar is turned off. */
    disabledSites: string[];
  };
  focus: {
    focusMin: number;
    shortMin: number;
    longMin: number;
    customMin: number;
    blockSites: boolean;
    blocklist: string[];
    showBadge: boolean;
    sessionsGoal: number;
    /** Play a completion chime when a session ends (V2; via an offscreen document). */
    sound: boolean;
  };
  /** Toolbar-popup Quick Note preferences (V2). */
  quickNote: {
    /** Attach the current page's URL to new quick notes by default. Off unless the user enables it. */
    attachUrl: boolean;
  };
  notifications: { tasks: boolean; events: boolean; focus: boolean };
  analytics: { trackWebsites: boolean };
  smartGrouping: { enabled: boolean; autoApply: boolean; rules: SmartGroupRule[] };
  integrations: {
    /** OAuth client id for a Google "Web application" client — supplied by the user, never hardcoded. */
    googleClientId?: string;
    spotifyClientId?: string;
    /** Default music collection: a playlist URI (spotify:playlist:…) or the literal 'liked' for Liked Songs. */
    spotifyPlaylistUri?: string;
  };
}

/** Latest GitHub release info, cached by the update checker (V2.3). */
export interface UpdateState {
  checkedAt?: number;
  latest?: {
    version: string;
    /** Release page (https://github.com/<repo>/releases/tag/vX). */
    url: string;
    /** Direct download of the extension zip asset, when present. */
    downloadUrl?: string;
    notes?: string;
    publishedAt?: string;
  };
  /** Version the user dismissed the banner for. */
  dismissed?: string;
  error?: string;
}
