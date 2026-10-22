import type {
  UpdateState,
  BackupSnapshot,
  SampleIds,
  Bookmark,
  BookmarkFolder,
  CalendarEvent,
  CalendarSource,
  FocusSessionRecord,
  FocusState,
  Note,
  NoteFolder,
  QuickLink,
  QuoteState,
  SavedSession,
  Settings,
  Task,
  UsageLog,
  Workspace,
  WorkspaceActivityLog,
  WorkspaceGroupLink,
  SyncRemovedTab,
} from '@/types/models';

export const SCHEMA_VERSION = 1;

/** Every persisted key and its value type. Keys are prefixed to avoid collisions. */
export interface StoreShape {
  'ts.settings': Settings;
  'ts.workspaces': Workspace[];
  'ts.sessions': SavedSession[];
  'ts.tasks': Task[];
  'ts.notes': Note[];
  'ts.noteFolders': NoteFolder[];
  'ts.bookmarks': Bookmark[];
  'ts.bookmarkFolders': BookmarkFolder[];
  'ts.quickLinks': QuickLink[];
  'ts.calendarSources': CalendarSource[];
  'ts.events': CalendarEvent[];
  'ts.focus': FocusState;
  'ts.focusSessions': FocusSessionRecord[];
  'ts.usage': UsageLog;
  'ts.workspaceActivity': WorkspaceActivityLog;
  'ts.quotes': QuoteState;
  /** Which workspace each Chrome window is currently "in" (windowId -> workspaceId). Runtime-only hint. */
  'ts.activeWorkspace': string | null;
  /** Workspace ↔ native tab group links (V2.2, Workspaces agent). */
  'ts.workspaceGroupLinks': WorkspaceGroupLink[];
  /** Saved tabs removed by tab-group membership sync, kept 7 days for one-click restore (V2.2, Workspaces agent). */
  'ts.syncRemovedTabs': SyncRemovedTab[];
  /** Cached GitHub release check (V2.3). */
  'ts.update': UpdateState;
  /** Last few automatic local backups (newest first). */
  'ts.backups': BackupSnapshot[];
  /** IDs of example records loaded via "Load example data". */
  'ts.sampleIds': SampleIds;
}

export type StoreKey = keyof StoreShape;

/**
 * Keys holding OAuth tokens. They live in their own namespace, are never
 * included in exports, and are wiped on "disconnect".
 */
export const SECRET_KEYS = ['secret.google', 'secret.spotify'] as const;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SCHEMA_VERSION,
  userName: '',
  theme: 'dark',
  starfield: true,
  parallax: true,
  animations: true,
  reducedMotion: false,
  showFigure: true,
  density: 'comfortable',
  textScale: 'md',
  defaultPage: 'dashboard',
  dashboardWidgets: { quickActions: true, workspaces: true, tasks: true, recentTabs: true, savedLinks: true },
  sidebar: {
    enabled: true,
    sections: { focus: true, tasks: true, notes: true, bookmarks: true, workspaces: true },
    defaultView: 'last',
  },
  newTab: { enabled: true, showQuote: true, showFocus: true, searchEngine: 'google' },
  focus: {
    focusMin: 25,
    shortMin: 5,
    longMin: 15,
    customMin: 50,
    blockSites: false,
    blocklist: ['youtube.com', 'reddit.com', 'x.com', 'instagram.com', 'tiktok.com'],
    showBadge: true,
    sessionsGoal: 8,
    sound: true,
  },
  quickNote: { attachUrl: false },
  updates: { check: true },
  workspaceGroups: { enabled: true, collapseOthers: false, syncMembership: true },
  searchTheme: { enabled: false, engines: ['google', 'duckduckgo', 'bing'] },
  tabspaceBar: { onNewTab: true, onWebsites: false, showWorkspaces: true, showFolders: true, disabledSites: [] },
  notifications: { tasks: true, events: true, focus: true },
  analytics: { trackWebsites: false },
  smartGrouping: { enabled: false, autoApply: false, rules: [] },
  integrations: {},
};

export const DEFAULT_FOCUS: FocusState = { status: 'idle', kind: 'focus', durationMs: 25 * 60_000 };

export const DEFAULTS: StoreShape = {
  'ts.settings': DEFAULT_SETTINGS,
  'ts.workspaces': [],
  'ts.sessions': [],
  'ts.tasks': [],
  'ts.notes': [],
  'ts.noteFolders': [],
  'ts.bookmarks': [],
  'ts.bookmarkFolders': [],
  'ts.quickLinks': [],
  'ts.calendarSources': [],
  'ts.events': [],
  'ts.focus': DEFAULT_FOCUS,
  'ts.focusSessions': [],
  'ts.usage': {},
  'ts.workspaceActivity': {},
  'ts.quotes': { favorites: [] },
  'ts.activeWorkspace': null,
  'ts.workspaceGroupLinks': [],
  'ts.syncRemovedTabs': [],
  'ts.update': {},
  'ts.backups': [],
  'ts.sampleIds': {},
};

export const STORE_KEYS = Object.keys(DEFAULTS) as StoreKey[];
