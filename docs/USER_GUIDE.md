# Tabspace user guide

Tips for getting the most out of Tabspace once it's installed. For installing and updating, see the
[README](../README.md#install).

- [Pin the toolbar icon](#pin-the-toolbar-icon)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Workspaces as tab groups](#workspaces-as-tab-groups)
- [Tabspace Bar](#tabspace-bar)
- [New Tab page](#new-tab-page)
- [Search results look](#search-results-look)
- [Matching Chrome theme](#matching-chrome-theme)
- [Integrations](#integrations)
- [Updates](#updates)

## Pin the toolbar icon

Click the puzzle-piece **Extensions** icon in Chrome's toolbar and pin **Tabspace**. While a focus session runs, the pinned
icon shows the minutes left (e.g. `24m`, full time in the tooltip). Click it for the live countdown, pause/resume/stop and
**+ New Note**. Extensions can't place live widgets inside Chrome's bookmarks bar, so the pinned icon is the always-visible
timer.

## Keyboard shortcuts

Change them at `chrome://extensions/shortcuts`. Chrome drops a default that clashes with another extension.

| Shortcut | Action |
| --- | --- |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> | Open the Tabspace popup (timer + Quick Note) |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> | New Quick Note |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> (<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>) | Toggle the Tabspace sidebar |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> | Search inside Tabspace pages |

Optional: *Chrome Sidebar settings → Add "+ New Note" to bookmarks bar* creates a one-click bookmark (asks first).

## Workspaces as tab groups

Opening a workspace puts its tabs in one Chrome tab group named after it. Open several side by side, collapse the others
automatically (Workspaces page → gear), and drag tabs between groups to move them between workspaces. Closing a group never
deletes saved tabs.

## Tabspace Bar

Chrome doesn't let extensions replace its bookmarks bar, so Tabspace adds its own: favourite bookmarks, folder dropdowns, a
Workspaces menu and a **☆ Bookmark this page** button with a folder picker. It's on the Tabspace New Tab by default. Turn on
*Chrome Sidebar settings → Tabspace Bar → Show on websites* to show it at the top of every site (Chrome asks for site access
once). Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> to hide Chrome's own bar if you only want Tabspace's.

## New Tab page

Click **Customize** on the New Tab to show or hide sections and drag them between columns.

Chrome 138+ adds its own footer ("Tabspace · Customize Chrome") to every extension New Tab page. It isn't part of Tabspace
and extensions can't remove it: right-click it → **Hide footer on New Tab page**, or use *Customize Chrome → Footer*.

## Search results look

*Chrome Sidebar settings → Search results* gives Google, DuckDuckGo and Bing result pages Tabspace's deep-space background
(when the engine is in dark mode), with result text kept on solid dark cards so it stays easy to read.

## Matching Chrome theme

Each release includes `tabspace-theme-<version>.zip`. Unzip it and load the folder with **Load unpacked**, the same way as the
extension. Themes can only recolour Chrome's frame and toolbar, which is why the theme is a separate package.

## Integrations

| Integration | Status | Setup |
| --- | --- | --- |
| Local calendar & `.ics` import | Works out of the box | — |
| ICS / iCal feed URLs | Works; Chrome asks for access to the feed's host | Paste the feed's secret iCal address |
| Google Calendar (read-only) | Needs **your** OAuth client ID | [SETUP_INTEGRATIONS.md](SETUP_INTEGRATIONS.md) |
| Spotify | Mini player, Liked Songs, playback controls; needs **your** Spotify client ID (playback control needs Premium) | [SETUP_INTEGRATIONS.md](SETUP_INTEGRATIONS.md) |

## Updates

Tabspace asks GitHub twice a day whether a newer release exists (no personal data is sent; turn it off in
*Settings → Account & About*). When one is out, the dashboard, Settings and the toolbar popup show **Download update**:

1. Click **Download update**. The new zip downloads.
2. Unzip it over your Tabspace folder, replacing the files.
3. Click **Reload Tabspace** (or ↻ on `chrome://extensions`). Your data stays as it is.
