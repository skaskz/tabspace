# Known limitations

Honest list of what Tabspace does **not** do (yet), and platform constraints it works around.

## Chrome platform constraints

* **Side panel size and position are controlled by Chrome.** Tabspace's sidebar is a narrow icon rail designed for Chrome's
  native side panel; it cannot be shrunk below Chrome's minimum width or docked elsewhere. There is no injected on-page overlay.
* **Closing the side panel** uses `chrome.sidePanel.close()` on Chrome 141+. On older versions the fallback briefly disables and
  re-enables the panel, which closes it in every window (the popup says so).
* **Opening the side panel requires a user gesture.** The popup button and the keyboard shortcut (Ctrl/⌘+Shift+S) both qualify.
* **The toolbar badge holds ~4 characters**, so a running timer shows minutes (`24m`), with the exact time in the tooltip.
* **`chrome.alarms` has a 30-second minimum**, so a focus session's end notification can arrive up to ~30 s late; the timer itself
  always shows the exact remaining time (it is computed from a stored end timestamp).
* **`declarativeNetRequest` cannot be an optional permission** (Chrome's rule), so site blocking's permission appears at install even
  though blocking is off by default and only active during focus sessions you start.
* **Site blocking only stops new navigations.** Tabs already open on a blocked site when a session starts are left alone.
* **New Tab override is declared in the manifest.** Turning *New Tab replacement* off hands the tab to Chrome's own New Tab page
  (`chrome://new-tab-page`); Chrome may still briefly show the Tabspace page first.
* **No live widgets in the bookmarks bar.** Extensions can't add a countdown or buttons to Chrome's bookmarks bar or
  toolbar; Tabspace uses the pinned action icon (badge + tooltip), its popup, keyboard shortcuts and an optional static
  "+ New Note" bookmark (which opens Quick Note in a tab, not the popup).
* **Chrome's bookmarks bar can't be replaced.** The Tabspace Bar is a separate strip (New Tab, and opt-in on websites).
  On websites it pushes the page down 34px; sites with their own fixed header have their top 34px covered (use *Hide on this
  site*), a few sites that override the `<html>` margin may not shift, it can't appear on `chrome://` pages or the Chrome Web
  Store, and "Hide bar" lasts until the page reloads.
* **Chrome's New Tab footer** (Chrome 138+, "Tabspace · Customize Chrome") is drawn by Chrome on every extension New Tab page.
  Extensions can't hide it; users can (right-click → *Hide footer on New Tab page*, or *Customize Chrome → Footer*).
* **`chrome.action.openPopup()`** (used by the Quick Note shortcut) needs Chrome 127+; older versions open Quick Note in a
  small popup window instead.
* **Liked Songs playback** starts your 100 most recent saved tracks (Spotify has no documented "play my Liked Songs"
  context for third-party apps); *Open in Spotify* opens the full collection. Existing Spotify connections must reconnect
  once to grant `user-library-read`.
* **Extensions cannot restyle Chrome's toolbar.** The matching look is a separate, optional theme package (`theme/dist`).
* **Branded Google Chrome no longer supports `--load-extension`**, so automated end-to-end tests run in Playwright's bundled
  Chromium build. Manual verification in Google Chrome is listed in [TESTING.md](TESTING.md).
* **"Last active" in the Tab Manager** needs Chrome 121+ (`tab.lastAccessed`); older versions show "—".

## Feature scope

* **Cloud sync is not implemented.** Data lives in `chrome.storage.local` on one device; use Export/Import to move it.
* **Google Calendar is read-only.** Creating/editing Google events would need broader scopes and is planned for later.
* **Repeating local events** are edited/deleted as a whole series (no per-occurrence exceptions).
* **Google sign-in uses Google's token flow** via `chrome.identity.launchWebAuthFlow` (Google recommends auth-code + PKCE, which
  would require a client secret or backend). Silent renewal only works while you are signed in to Google in Chrome.
* **Spotify** requires your own developer app; under Spotify's 2026 Development Mode rules the owner needs Premium and only a
  handful of allow-listed users can sign in. Playback control requires Premium and an active device; otherwise Tabspace offers
  "Open in Spotify".
* **Smart grouping** is rule-based (URL/title substrings + built-in domain categories). There is no AI classification, and no
  browsing data is ever sent to an external service.
* **Website usage tracking** (opt-in) counts active-tab time per domain; it does not detect idle time (no `idle` permission).
* **Chrome bookmark import** flattens folders deeper than two levels into names like "Dev / Deep".
* **Uploaded background images** (≤ 5 MB) are stored inside settings, so they are included in exports and local snapshots.

## Not verified with real credentials

Google Calendar OAuth, Spotify OAuth/playback and live ICS feeds are covered by unit tests with mocked network responses and
by manual steps in [TESTING.md](TESTING.md). They have **not** been exercised against live Google/Spotify accounts by the
automated suite, because that requires the user's own client IDs.
