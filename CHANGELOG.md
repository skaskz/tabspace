# Changelog

All notable changes to Tabspace. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [2.3.0] — 2026-10-22

### Added
- Update notifications: Tabspace checks GitHub Releases twice a day and offers a one-click download plus
  *Reload Tabspace* (Chrome Web Store installs update automatically). Toggle in Settings → Account & About.
- Automated releases: pushing a `v*` tag builds, tests and publishes the extension and theme zips.

## [2.2.0] — 2026-10-22

### Added
- Workspaces open as native Chrome tab groups named after the workspace (multiple at once, stable colours, no duplicate
  tabs on reopen, optional collapse-others, tab moves sync saved tabs, rename/delete sync, re-link after restart,
  7-day restore for tabs dragged out of a group).
- Opt-in Tabspace look for Google/DuckDuckGo/Bing results (dark mode only; readable result cards; site access only for the
  engines you pick).
- Settings: the left section menu highlights the section you're reading (smooth sliding highlight, click to jump).

### Changed
- Companion theme: darker frame/tabs/toolbar/address bar with a dimmed starfield toolbar for a tinted-glass look.
- Permission grants for optional features are tracked per feature and released only when no feature needs them.

## [2.1.0] — 2026-10-22

### Added
- Customizable New Tab: show/hide, move between columns and reorder every section (drag-and-drop + keyboard), reset.
- Tabspace Bar: favourite bookmarks, folder dropdowns, Workspaces menu and ☆ Bookmark this page (shared folder picker) —
  on the New Tab, and opt-in on every website (isolated extension frame, optional permissions, hide per site).
- Reusable bookmark dialog (title, nested folders, new folder, tags, duplicate update/copy).

### Fixed
- Dropdown menus (e.g. Spotify "…") were painted under neighbouring cards; menus now render in a top-level layer and flip up.
- "Save current tab" failed when the dashboard was in its own window; it now picks your most recent web page and shows
  where it was saved.
- New Tab quote/focus toggles and Customize disagreed; the layout is now the single source of truth.

### Security
- Website bar hardened: exact permission release, anti-clickjacking (pinned styles + visibility-gated clicks), nonce +
  ancestor checks, no Tabspace page can be framed by websites, content script never reads extension storage.
- Spotify refresh token moved to extension-private IndexedDB; session storage restricted to trusted contexts.

## [2.0.0-rc.1] — 2026-10-21

### Added
- New Tab productivity hub: workspaces with one-click open, today's tasks, monthly calendar with event dots, upcoming
  events, focus widget, Spotify mini player, recent tabs, quick links from favourite bookmarks.
- Workspaces: view every saved tab; remove, add URL, add current tab, reorder (drag-and-drop + keyboard); choose tabs when
  saving a window; update from window (merge or replace, previous list kept in History).
- Toolbar popup: live focus countdown with start/pause/resume/stop and Quick Note (autosave, close-safe, optional page link).
- Shortcuts: Quick Note (Alt+Shift+N), open popup (Alt+Shift+O); optional "+ New Note" bookmark.
- Focus completion chime (offscreen document), "Session complete" state, sound toggle.
- Spotify: mini player on Dashboard + New Tab, Liked Songs, device picker, single shared poller, default collection setting.
- Shared motion system (hover lift, animated dialogs/menus/toasts, page transitions); 3-layer mouse-parallax starfield.

### Changed
- Removed the decorative chrome figure.
- Companion theme updated with current Chrome theme colour keys (tabs, incognito, bookmarks bar, NTP header).

### Fixed
- Spotify Next/Previous showed "Spotify request failed" after successful commands (non-JSON 2xx parsed as JSON); errors are
  now specific (expired session, Premium, no device, rate limit, offline).

## [1.0.0-rc.1] — 2026-10-21

First release candidate.

### Added
- Home Dashboard with greeting, quick actions, workspaces, today's tasks, recent tabs, saved-link folders, and a right
  utility sidebar (month calendar with event dots, upcoming events, focus mini-timer, quick links).
- Workspaces: create/rename/delete/search, icons, templates, saved sessions, restore into a new window / this window /
  replace current tabs (archives first), native Chrome tab groups recreated with titles and colours.
- Tab Manager: live view of all windows, search/sort/filter, group/rename/recolour/collapse/ungroup, pin, move between
  groups and windows, close with confirmation, save to workspace, saved sessions, rule-based smart grouping (opt-in, local).
- Calendar: month/week/day/agenda, local events with simple recurrence and reminders, ICS feed subscriptions (HTTPS,
  per-origin permission), `.ics` import, read-only Google Calendar via OAuth.
- Notes: folders, tags, favourites, trash, Markdown with a safe renderer, autosave.
- Tasks: Inbox/Today/Upcoming/Someday/Completed, quick-add shortcuts, subtasks, notes, priorities, workspaces.
- Bookmarks: nested folders, tags, favourites, sorting, duplicate detection, save current tab, Chrome bookmarks import.
- Focus Mode: persistent timer (end-timestamp + `chrome.alarms`), toolbar badge, sidebar/top-bar indicators, breaks,
  custom durations, stats and streaks, opt-in site blocking, daily quotes with favourites, Spotify panel.
- Analytics from recorded data only: focus time, tasks completed, workspace activity, opt-in website usage.
- Settings: appearance (dark/light/auto, starfield, custom background, figure, motion, density, text size), layout,
  New Tab, focus, notifications, integrations, privacy, export/import (validated), automatic local backups, reset, clear.
- Minimal icon-rail Chrome side panel, toolbar popup (open/close/disable/enable sidebar), calm New Tab page.
- Companion monochrome Chrome theme package (`theme/dist`).
- Global search palette (Ctrl/⌘+K).
- Test suites: Vitest unit/integration/security, Playwright end-to-end tests against the unpacked extension in Chromium.
- GitHub Actions CI: type-check, lint, tests with coverage, build, E2E, production dependency audit.

### Security
- Strict MV3 CSP, http(s)-only URL handling, HTML-escaping Markdown renderer, schema-validated imports, PKCE for Spotify,
  read-only Google scope, tokens excluded from exports, HTTPS-only ICS feeds with streaming size cap and redirect checks.
