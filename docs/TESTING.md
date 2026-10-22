# Testing

Tabspace is tested at four levels. All commands run from the project root.

| Level | Tool | Location | Command |
| --- | --- | --- | --- |
| Unit (pure business logic + components) | Vitest + Testing Library (jsdom) | `tests/unit/` | `npm test` |
| Integration (cross-page sync, store races) | Vitest | `tests/integration/` | `npm test` |
| Security regression (XSS, URLs, imports, OAuth, ICS) | Vitest | `tests/security/` | `npm test` |
| End-to-end in a real browser | Playwright + Chromium with the unpacked extension | `tests/e2e/` | `npx vite build && npm run test:e2e` |
| Visual / accessibility / performance measurements | Playwright scripts | `tests/visual/` | `TS_DIST=dist node tests/visual/ux-perf.mjs` |

Chrome APIs are mocked only in unit tests. Every end-to-end test runs against the real built extension: real service
worker, real `chrome.tabs` / `tabGroups` / `sidePanel` / `alarms` / `declarativeNetRequest` / `storage`.

## Latest results (v2.2, 2026-10-22, commit on `main`)

| Suite | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npx eslint .` | 0 errors |
| Vitest (unit + integration + security) | **996 passed / 996** in 78 files |
| Playwright E2E | **204 passed / 204** (Chromium 156.0.8078.4, headless, Windows 11) |
| `npm audit` (prod and dev) | 0 vulnerabilities |
| Coverage (business logic: features, storage, utils, integrations) | 85.2% lines · 74.5% branches · 81.3% functions |

Coverage by area (branches): focus 90%, tabs 90%, notes 85%, blocking 98%, usage 96%, workspaces 86%, tasks 80%,
data import/export 79%, calendar 79%, analytics 77%, store 69%, Google 63%, search 60%, Spotify 39%.
The 90% branch target is met for the timer, tab-session, blocking and usage logic; the Spotify client, storage
adapters and calendar sync are below target and are the next places to add tests.

### What the E2E suite covers

Extension load · dashboard and all 12 pages render with zero console errors · navigation · side panel opens/closes from
the popup (verified via `runtime.getContexts`) · sidebar disable/enable keeps data and survives restart · New Tab override and
"disabled" hand-off · workspace create/rename/delete (data kept, unassigned) · saving a window with native tab groups and
restoring into a new window / this window / replace (archives first, never closes the Tabspace tab) · tasks, notes,
bookmarks, settings persist across reload **and full browser restart** · notes autosave including the last keystrokes before
unload · calendar events in all views and on the dashboard · focus timer consistency (±3 s) across dashboard, focus page,
side panel, popup and New Tab, toolbar badge, pause/resume/stop, session recorded exactly once via the real alarm path ·
site blocking rules only during sessions (incl. subdomains), removed on pause/stop · every destructive action requires
confirmation · 200+ tabs · two dashboard tabs editing concurrently without lost writes · `javascript:`/`data:`/`file:`
inputs never execute · long titles/notes layout · corrupt imports rejected · honest "not set up" states for Google/Spotify.

## Bugs found by the independent QA and review agents (all fixed, with regression tests)

| ID | Severity | Bug | Fix |
| --- | --- | --- | --- |
| BUG-ST2 | P1 | Concurrent writes from two pages / page + worker lost data | Cross-context Web Lock around read-modify-write |
| BUG-NT1 | P1 | Notes lost keystrokes typed < 500 ms before closing | Synchronous flush on pagehide/visibilitychange |
| BUG-NT2 | P1 | Same note in two tabs overwrote itself | Field-level saves + adopt external edits |
| BUG-ST1 | P2 | Three settings selects saved the previous value | Read event value before async update |
| BUG-WS1 | P2 | Workspace card menu covered by buttons | Stacking fix |
| BUG-TK1 | P2 | Double submit created duplicate tasks | Draft ref cleared synchronously |
| BUG-SS1 | P2 | Replace/Save acted on the wrong window | Target the window containing the Tabspace tab |
| BUG-TB1 | P3 | Select-all could close the dashboard tab itself | Own tab excluded |
| BUG-TK2 | P3 | Double-click on a checkbox didn't toggle twice | Toggle from stored value |
| BUG-SP1 | P3 | Popup never showed "Sidebar is open" | Track open panels in session storage |
| SEC-1 | Medium | Hostile ICS feed could stall parsing for hours | Global iteration budget + fast-forward |
| SEC-2..7 | Low | Unbounded feed body, http feeds/redirects, malformed block domains, `constructor` import key, Spotify refresh race | Streaming cap, HTTPS-only + redirect check, RFC 1123 validation, key whitelist, single-flight refresh |
| UX-1 | P1 | 2,000 bookmarks: 811 ms render, 283 ms/keystroke | Incremental rendering → 103 ms, 41 ms max |
| UX-2..4 | P1 | Decorative figure overlapped buttons; no input focus ring; faint text below WCAG AA | In-flow figure; focus rings; `--ts-faint` 6.2:1 |
| FR-F1 | P1 | Impossible/pathological RRULEs looped forever inside ical.js (worker hourly sync could hang) | RRULE satisfiability guard before iteration; invalid rules dropped individually |
| FR-F2 | P2 | Notes unload flush wrote the whole notes array without the lock | Per-note recovery records merged under the lock by worker/app |
| FR-F3 | P2 | Sidebar shortcut couldn't close the panel right after worker wake | Deferred close once open-panel state rehydrates |
| FR-F4..F13 | P3 | Per-key queues, lock wait timeout, cache rollback, locked settings/backup writes, duplicate snapshot, Spotify refresh lock, replace only closes archived tabs, error toasts | Fixed |

V2 bugs and fixes: see [COMPLETION_REPORT_V2.md](COMPLETION_REPORT_V2.md).

Full reports: [`docs/qa/QA_REPORT_V22.md`](qa/QA_REPORT_V22.md), [`docs/qa/QA_REPORT_V21.md`](qa/QA_REPORT_V21.md), [`docs/reviews/SECURITY_REVIEW_V21.md`](reviews/SECURITY_REVIEW_V21.md), [`docs/qa/QA_REPORT_V2.md`](qa/QA_REPORT_V2.md), [`docs/reviews/SECURITY_REVIEW_V2.md`](reviews/SECURITY_REVIEW_V2.md), [`docs/reviews/UX_REVIEW_V2.md`](reviews/UX_REVIEW_V2.md), [`docs/qa/QA_REPORT.md`](qa/QA_REPORT.md), [`docs/reviews/SECURITY_REVIEW.md`](reviews/SECURITY_REVIEW.md),
[`docs/reviews/UX_REVIEW.md`](reviews/UX_REVIEW.md), [`docs/reviews/FINAL_REVIEW.md`](reviews/FINAL_REVIEW.md).

## Manual verification checklist (not automatable here)

Run these in **Google Chrome** with `dist/` loaded unpacked:

1. Toolbar popup opens from the pinned icon; countdown matches the dashboard; *+ New Note* → type → close popup → note is in Notes. *Open* opens the side panel.
1b. Alt+Shift+O opens the popup; Alt+Shift+N opens Quick Note.
1c. Spotify (after reconnecting): play, pause, **Next**, Previous work; Liked Songs appears and plays.
2. Ctrl/⌘+Shift+S opens the sidebar.
3. Start a 1-minute custom focus session, close all Tabspace pages, wait: you **hear the chime**, an OS notification appears and the badge clears.
4. Enable website blocking, start a session, visit `youtube.com` → redirected to the Focus page; stop → loads normally.
5. Bookmarks → *Import from Chrome*: Chrome prompts for bookmark access; import completes; the permission is released.
6. Settings → New Tab replacement off → a new tab shows Chrome's own New Tab page.
7. Google Calendar and Spotify with your own client IDs ([SETUP_INTEGRATIONS.md](SETUP_INTEGRATIONS.md)): connect,
   list calendars/playlists, sync, disconnect (tokens removed).
8. Subscribe to an HTTPS ICS feed: Chrome asks for that host only; events appear.
9. Light theme and reduced-motion visual pass.
10. Load `theme/dist` unpacked: dark frame/toolbar applied.
