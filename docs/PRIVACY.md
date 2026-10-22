# Tabspace privacy & security notes

Tabspace is **local-first**. There is no Tabspace server, account, analytics SDK or telemetry.

## What is stored, and where

All data (workspaces, saved sessions, tasks, notes, bookmarks, calendar events, focus history, settings) is stored in
`chrome.storage.local` on your device. It is never transmitted anywhere by Tabspace.

| Data | When it is collected |
| --- | --- |
| Open tab titles/URLs | Read live from Chrome to show the Tab Manager; stored only when **you** save a session or bookmark |
| Website usage (domain + minutes) | **Only** if you turn on *Settings → Privacy → Track website time*. Full URLs and page titles are never recorded. You can delete it at any time. |
| Calendar events | Copied from calendars **you** connect (Google read-only, ICS feeds, imported .ics files) |
| OAuth tokens | Stored only inside the extension and never exported. Google's short-lived access token: `chrome.storage.session` (cleared when Chrome closes, readable only by Tabspace's own pages). Spotify's refresh token: Tabspace's private extension database (IndexedDB), which scripts on websites — including the optional website bar — can't access. *Disconnect* or *Clear all local data* deletes them (Google tokens are also revoked; Spotify has no revoke API — remove the app at spotify.com → Account → Manage apps). |
| Archived sessions | When you restore a workspace with *Replace current tabs*, the tabs you had open (URLs + titles) are first saved as an archived session so nothing is lost. You can delete archived sessions in the Tab Manager. |
| Quick Notes (toolbar popup) | While you type, the text is also kept in the extension's own `localStorage` and in short-lived pending/recovery records so closing the popup can't lose it; these copies are removed once the note is saved and by *Clear all data*. Websites can't read extension storage. |
| Spotify now-playing | A sanitised snapshot (track, artists, album-art URL, device name/id, progress) is kept in `chrome.storage.session` (memory only) so all Tabspace pages share one poller. |
| Backups | Tabspace keeps the last 3 automatic local snapshots of your data (same device, same storage). Exports and snapshots include website-usage data if tracking was on; *Delete usage data* also removes it from snapshots. |

## Network requests

Apart from the optional update check below, Tabspace only makes network requests that you initiate by connecting an integration:

* **Google Calendar** — sign-in at `accounts.google.com`, API calls to `www.googleapis.com`, token revocation at
  `oauth2.googleapis.com`, with the read-only `calendar.readonly` scope and an OAuth client ID **you** provide.
* **Spotify** — `accounts.spotify.com` / `api.spotify.com` (Authorization Code + PKCE, no client secret), using a client ID
  **you** provide. Scopes: `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`,
  `playlist-read-private`, `user-library-read` (read your Liked Songs). Album art loads from Spotify's CDNs
  (`*.scdn.co`, `*.spotifycdn.com`).
* **ICS feeds** — fetched over **HTTPS only**, directly from the feed's own host, after you grant Chrome's per-origin
  permission prompt; no cookies are sent and cross-origin redirects are refused. Private feed URLs are never sent to a
  proxy or any third party, and are excluded from exports unless you opt in.

* **Update checks** — `GET https://api.github.com/repos/skaskz/tabspace/releases/latest` twice a day, with no cookies and
  nothing about you or your data. Turn it off in *Settings → Account & About → Check for updates*. GitHub sees the request
  like any website visit (your IP address).

Favicons are loaded through Chrome's built-in `chrome-extension://…/_favicon/` service (no external favicon API).

## Permissions

| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Local data storage (large note/bookmark collections) |
| `tabs`, `tabGroups` | Tab Manager, saving and restoring workspaces with native tab groups |
| `sidePanel` | The Tabspace sidebar |
| `alarms`, `notifications` | Focus timer end, reminders — without a constantly running background script |
| `favicon` | Show site icons from Chrome's local favicon cache |
| `identity` | OAuth sign-in windows for Google Calendar / Spotify (only when you connect them) |
| `offscreen` | Plays the optional focus-completion chime (a hidden extension page; MV3 service workers can't play audio) |
| `declarativeNetRequest` | Optional focus-time site blocking (off by default, only during sessions) |
| `bookmarks` (optional) | Requested only when you click *Import Chrome bookmarks* or *Add "+ New Note" to bookmarks bar*; released again afterwards |
| Host access (optional, per origin) | Requested only for ICS feed hosts you subscribe to |
| `scripting` + search-engine site access (optional) | Requested only if you turn on **Search results** styling, and only for the engines you tick (www.google.com, duckduckgo.com, www.bing.com). A stylesheet and a tiny script restyle the result page's background; the script reads only the hostname, whether the URL has a query, and the page's text colour (to apply only in dark mode) — never page content. Unticking an engine or turning it off releases that access. |
| `scripting` + http/https site access (optional) | Requested only if you turn on **Tabspace Bar → Show on websites**. A small script adds an isolated Tabspace frame at the top of pages and pushes the page down 34px. Your bookmarks, folders and workspaces live inside that extension frame — websites can't read them — and Tabspace doesn't read, collect or send page content; the bar reads the current tab's address and title only when you click ☆ to bookmark it. Turning the website bar off removes the script and releases the permissions (unless you had granted them for something else). Websites can tell that a Tabspace bar is present (its element and the 34px offset), but not what's in it. While this access is granted, ICS feeds sync without a separate per-site prompt. |

## Content security

* Manifest V3 CSP: `script-src 'self'; object-src 'self'; base-uri 'self'` — no remote code, no `eval`. `frame-ancestors` allows http(s) pages only so the website Tabspace Bar can be embedded; the only web-accessible page is `bar.html` (dynamic URL), so websites still cannot frame the dashboard, popup or any other Tabspace page.
* Only `http(s)` URLs can be saved, opened or restored; `javascript:`, `data:` and similar schemes are rejected.
* Notes are rendered by an HTML-escaping Markdown renderer; raw HTML in notes is shown as text.
* Imported backups are schema-validated, size-capped and URL-sanitised before anything is written.
