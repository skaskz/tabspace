# Tabspace V2 — Completion Report

**Date:** 2026-10-21 · **Version:** 2.0.0 · **Branch:** `main` (local, not pushed)

## Release readiness: **Ready for user testing**

Every V2 requirement is implemented and the automated gates pass: 865/865 Vitest tests, 126/126 real-Chromium
end-to-end tests (two consecutive full runs), 0 type errors, 0 lint errors, 0 known dependency vulnerabilities.
Independent QA, security and UX reviews found no P0/P1 issues; every P2 and P3 finding they reported is fixed and covered by regression tests.

It is not "Ready for daily use" until you confirm the items that need a real Chrome profile or account: hearing the
completion chime, the OS notification, real keyboard shortcuts, the real toolbar popup, and **Spotify on your account**
(skip fix + Liked Songs are verified only against mocked Spotify responses).

## Implemented features

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | New Tab productivity hub | ✅ | Workspaces (open), today's tasks, calendar + dots, upcoming, focus, Spotify, recent tabs, favourite quick links; no scroll 1280×720 → 1920×1080 (E2E + measured) |
| 2 | Smooth animations | ✅ | Shared motion tokens; hover lift; dialog/menu/toast enter + exit; page transitions; reduced motion honoured (unit + E2E) |
| 3 | Interactive 3D parallax starfield | ✅ | 3 depth layers, GPU transforms, 0 frames when the mouse is still, toggle in Settings (E2E measured) |
| 4 | Remove chrome humanoid | ✅ | Component, CSS and setting removed |
| 5 | Unwanted bottom bar | ✅ documented | It is **Chrome's own footer** (Chrome 138+) for extension New Tab pages, not Tabspace; extensions can't hide it. Right-click → *Hide footer on New Tab page*. E2E asserts nothing of ours is pinned to the bottom. |
| 6 | Edit saved workspace tabs | ✅ | View all, remove (no live tabs touched, with Undo), add URL, add current tab, select tabs before saving, update from window, reorder (drag-and-drop + keyboard), groups preserved. Your 5→4 acceptance test passes in Chromium (8/8 repeats). |
| 7 | Spotify mini player | ✅ code / ⚠ live | Dashboard + New Tab + Focus share one poller; default collection persists. Verified with mocked Spotify API only. |
| 8 | Persistent focus timer | ✅ | End-timestamp + alarms; popup ↔ dashboard drift ≤ 1 s; survives worker restart and browser restart (E2E) |
| 9 | Timer near the top of Chrome | ✅ (closest supported) | Pinned toolbar icon badge (`24m`) + tooltip; popup shows the full countdown with pause/resume/stop. Live widgets in the bookmarks bar are not possible for extensions. |
| 10 | Quick Note from the toolbar | ✅ | Popup **+ New Note**, autosave, close-safe (×3 E2E incl. closing mid-typing), optional page link, Alt+Shift+N shortcut, optional "+ New Note" bookmark |
| 11 | Matching Chrome theme | ✅ | `theme/dist` uses current Chromium theme keys (toolbar/bookmarks bar, tabs, incognito, NTP) |
| 12 | Focus alarm & notifications | ✅ | 1-minute session verified end-to-end: alarm → record → notification → offscreen chime → "Session complete" → badge cleared; sound + notification toggles |
| 13 | Preserve working features | ✅ | All v1 tests still pass; v1-shaped data loads unchanged after upgrade (E2E) |
| 14 | Multi-agent testing & reviews | ✅ | See below |
| S1 | Spotify skip error | ✅ code / ⚠ live | Root cause: successful player commands returning a non-JSON 2xx body were parsed as JSON and reported as "Spotify request failed". Commands now treat any 2xx as success; errors are specific (expired, Premium, no device, rate-limit with Retry-After, offline). |
| S2 | Liked Songs | ✅ code / ⚠ live | ♥ Liked Songs first in all selectors; `/me/tracks` pagination; plays via `uris` (100 most recent — no documented collection context); *Open in Spotify* fallback. Requires reconnecting once for `user-library-read`. |

## Bugs found and fixed during V2

| ID | Sev | Found by | Bug | Fix |
| --- | --- | --- | --- | --- |
| Spotify skip | High | User | "Spotify request failed" after successful skips | 2xx = success; meaningful errors |
| V2-1 | Low | Security | *Clear all data* left Quick Note backups that could resurrect text | Removed too |
| V2-2 | Low | Security | Hostile page title could redirect an attached Quick Note link | Brackets stripped from labels |
| V2-4 | Info | Security | `mergeSavedTabs` trusted incoming URLs | http(s) filter |
| BUG-QN1 | P2 | QA | URLs with parentheses broke attached links | `%28`/`%29` encoding |
| BUG-MO1 | P3 | QA | Escape closed every stacked dialog | Modal stack: only the top dialog handles keys |
| BUG-MG1 | P3 | QA / Lead | Install migration could overwrite settings written at startup | Locked, merge-aware version stamp; never writes absent keys |
| UX #1–15 | P2/P3 | UX | Completion state missing on New Tab; heavier New Tab bundle; tight fit at 1366×768; truncated quick links; focus loss + no undo on remove; popup grouping; Spotify card jumping; timing inconsistencies; hover shimmer; idle twinkle CPU; picker focus; weak rings; popup layout shift; misc | All addressed |
| Popup close | — | Extension agent | Chrome may drop async storage writes when a popup closes within milliseconds | Synchronous localStorage backup merged on next open |

## Tests executed (final state)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npx eslint .` | 0 errors |
| `npx vitest run` | 865 passed / 865 (67 files) |
| `npm run build` | success |
| `npx playwright test` | 126 passed / 126, Chromium 156.0.8078.4 headless, two consecutive full runs |
| `npm audit` | 0 vulnerabilities |

## Multi-agent work (native Claude Code subagents)

| Agent | V2 role |
| --- | --- |
| Lead | Shared settings contracts, integration, store/migration fixes, bundle chunking, motion polish, security fixes, docs |
| Motion & visuals (new) | Motion system, modal/menu exit animations, page transitions, parallax starfield, figure removal, settings toggles |
| Frontend | New Tab hub, shared dashboard widgets, Spotify widget placement, favourite quick links |
| Extension A | Toolbar popup, Quick Note, commands/openPopup, "+ New Note" bookmark, offscreen chime, completion state, theme, footer research |
| Extension B | Saved-tab editing, save-window picker, update from window, undo, group clustering |
| Integrations | Spotify skip fix, error mapping, Liked Songs, shared poller, compact mini player, import validation |
| Independent QA | 45 new real-Chromium tests; 4 findings (all fixed) |
| Security reviewer | V2 review + tests; 0 Critical/High/Medium; 3 Low/Info (all fixed); privacy doc corrected |
| UX/a11y/perf reviewer | 15 prioritised findings with measurements (all addressed) |

Reports: [qa/QA_REPORT_V2.md](qa/QA_REPORT_V2.md), [reviews/SECURITY_REVIEW_V2.md](reviews/SECURITY_REVIEW_V2.md),
[reviews/UX_REVIEW_V2.md](reviews/UX_REVIEW_V2.md).

## External limitations

* Extensions can't put live widgets in Chrome's bookmarks bar or toolbar → pinned icon badge + tooltip + popup.
* Chrome's New Tab footer can't be hidden by extensions (users can hide it).
* `chrome.action.openPopup()` needs Chrome 127+ (older: Quick Note opens in a small window).
* Toolbar badges fit ~4 characters (minutes shown; exact time in the tooltip and popup).
* Spotify: Development Mode (owner Premium, few allow-listed users), Premium for playback control, active device needed;
  Liked Songs plays the 100 most recent saved tracks.

## User setup required

1. Reload Tabspace (`chrome://extensions` → ↻) or re-load the updated build folder.
2. **Pin Tabspace** (puzzle-piece → pin) to see the timer badge.
3. **Reconnect Spotify once** (Settings → Integrations) to grant Liked Songs access; try Skip on your account.
4. Optional: hide Chrome's New Tab footer (right-click it); install the updated `theme/dist`; adjust shortcuts at
   `chrome://extensions/shortcuts`; add the "+ New Note" bookmark from Chrome Sidebar settings.

## Remaining problems

* Not verifiable here: audible chime, OS notification display, real shortcuts, real Spotify playback, real v1→v2
  extension update (simulated with v1 data + browser restart).
* Loading example data into a profile that already has data creates same-named duplicates (P3, by design of the button).
* At 1024×768 and smaller the New Tab stacks into two columns and scrolls (expected for small windows).
