# Tabspace: final independent review

Reviewer: independent final gate (did not author the code). Date: 2026-10-21. Scope: the last ~15 commits
(`9e8220a..8d084a3`), with extra attention to the BUG-ST2/NT1/NT2/TK1/TK2/SS1/TB1/SP1 fixes and `src/extension/background/**`.
No files in `src/` were changed. The build was made in a scratch outDir, not `dist/`.

## Verdict: **Ready for local testing** (not yet Ready for release)

All automated gates pass, no fake or placeholder features turned up, and the store fixes for the QA P1s hold up under review.
One new **P1** blocks a public release: a single malformed recurring event in a subscribed ICS feed can hang the service worker
or the Calendar page in an endless loop inside `ical.js` (reproduced below). Two P2 issues are also worth fixing first: the
lock-free notes save on unload/hide, and the keyboard shortcut not closing the panel after the worker wakes. Both are small
fixes. Once the P1 is fixed I would call this release-ready.

## Release-gate checklist

| Gate | Result | Evidence |
|---|---|---|
| `npx tsc --noEmit` | PASS | exit 0, no output |
| `npx eslint .` | PASS | exit 0, 0 problems |
| `npx vitest run` | PASS | 50 files, **656 / 656 tests passed** (6.6 s) |
| Production build | PASS | `npx vite build --outDir <scratchpad>/dist-review` built in 2.8 s. `background.js` uses only static ESM imports (0 `import(`), with no `document`/`window` references |
| E2E (Playwright) | not re-run | Lead reported 74/74 in Chromium 156. Not repeated here, as instructed |
| `console.log` in `src/` and build | PASS | 0 hits (only `console.warn` on error paths) |
| Placeholder / fake features | PASS | No "coming soon", TODO, FIXME, lorem or fake stats. `'Not implemented'` in `QuickActions.tsx:16` only filters a jsdom error message. `SpotifyPanel` explicitly never fakes a connected state |
| School / academic demo content | PASS | No coursework terms. Hits were only `<canvas>`, `className` and a quote containing "of course". Example data (opt-in) is Development / Content / Job Search / Personal |
| Hardcoded secrets / client IDs | PASS | None. The Google/Spotify client IDs are user-supplied. The only `apps.googleusercontent.com` string is an input placeholder plus a validator |
| Permissions | PASS (with note) | storage, tabs, tabGroups, sidePanel, alarms, notifications, favicon (`_favicon`), identity and declarativeNetRequest are all used. `unlimitedStorage` backs snapshots and background images. `bookmarks` and host permissions are optional and requested at runtime. DNR has to be a required permission (documented in KNOWN_LIMITATIONS) |

## Findings

### P1

**F1. A malformed RRULE in an ICS feed hangs the worker or page (no budget can stop it).**
`src/features/calendar/ics.ts:304-307` (`master.iterator(...)` / `it.next()`), called from `src/integrations/calendarSync.ts:62`
(service worker, hourly `SYNC_ALARM` in `reminders.ts:98-99`) and `src/pages/calendar/CalendarsPanel.tsx:230,277` (UI thread).
The per-series `maxIterations` and total `budget` only count *calls* to `it.next()`. When a rule can never produce an
occurrence, ical.js 2.1.0 loops forever *inside a single* `next()` call. I reproduced this with plain `ical.js` under Node. Each of
these hung past an 8 s timeout on the first `next()`:
`FREQ=DAILY;BYMONTH=2;BYMONTHDAY=31`, `FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=30`, `FREQ=MINUTELY;…`, `FREQ=SECONDLY;…`.
(`FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30` does return, so ical.js only guards some paths.)
Impact: a hung worker stalls focus timer reconciliation, blocking-rule sync, reminders and the side panel shortcut until Chrome
kills it, and the hourly alarm triggers the hang again. A preview from the Calendars panel freezes the tab. This is reachable from a
real-world buggy generator, or from anyone who controls a feed the user subscribed to.
**Fix:** before iterating, run a pure `rruleCanOccur(rule)` check that rejects impossible BYMONTH×BYMONTHDAY combinations
(day > max days in every listed month, using 29 for February), BYYEARDAY values that cannot occur within the listed BYMONTH/BYWEEKNO,
and |BYSETPOS| larger than the candidate set. If the check fails, emit only the first instance, as the existing `catch` already does.
Add regression tests with the four rules above. Defence in depth: for page-side previews, run `parseIcs` in a dedicated
`Worker` with a timeout. A service worker can't spawn one, so the pre-check is the real fix there.

### P2

**F2. The notes save on unload/hide writes the whole `ts.notes` array from the page cache, outside the lock.**
`src/pages/notes/NoteEditor.tsx:61-70` (`flushNow`), wired at `:92-97`.
`flushNow` runs not only on `pagehide`/`beforeunload` but also on **every `visibilitychange → hidden`**, which happens on every tab
switch. Each time it does `chrome.storage.local.set({'ts.notes': patchNoteList(peek('ts.notes'), …)})`, bypassing `update()`
and the Web Lock. Two ways to lose data:
1. Another context (a second dashboard tab or the side panel) writes `ts.notes` and its `onChanged` hasn't reached this page yet.
   That other write, which may touch a *different* note, gets overwritten with the stale cached copy. A deleted note can come back
   the same way.
2. This page's own debounced `patch()` is still queued or in flight (for example behind a large `ts.calendarEvents` write on the
   per-page global queue). It then lands *after* the synchronous write, and because it sets the full `content` string it restores
   older text. `adoptExternal` then shows that older text, since the field is no longer dirty.
Realistic severity: the race windows are milliseconds (IPC latency) and need concurrent writes, so this is rare, not routine.
It is still silent data loss, and the `visibilitychange` trigger makes it run far more often than it needs to.
**Fix (safest, small):**
- On `visibilitychange → hidden`, call the normal locked `flush()`. The page is still alive, so async is fine.
- Keep the lock-free path for `pagehide`/`beforeunload` only, and do not write the shared array there. Write the dirty fields
  to a per-note recovery key, e.g. `ts.notes.unsaved.<id> = { changes, baseUpdatedAt, at }`. On the next store load
  (page or worker start), merge it with `patch()` under the lock, and only if the stored note's `updatedAt <= baseUpdatedAt`
  (otherwise keep the newer edit and offer the recovered text). This removes any chance of clobbering other notes.
- Minimum fallback if time is short: just drop the `visibilitychange` listener. That leaves only true unloads on the lock-free path.

**F3. The keyboard shortcut does not close the panel on the first press after the worker has gone idle.**
`src/extension/background/index.ts:142-166`. `openPanels` is in-memory and only refilled asynchronously from session storage
(`readOpenPanels().then(...)`, line 154). A command that wakes the worker (any press after about 30 s idle) reaches
`onCommand` before that promise resolves, so `openPanels.has(windowId)` is false. The worker then calls `open()` (a no-op on an
already open panel) instead of `close()`. The user sees "shortcut doesn't close". Not verified in a browser, but it follows from
MV3 event ordering. No data impact.
**Fix:** keep calling `openSidePanel()` synchronously (gesture). If the set is not yet hydrated, await the hydration promise after
the open resolves, and if the window was already in the stored set *before* the command, call `closeSidePanel(windowId)`. Also merge
the hydration into the set instead of letting it re-add an id that `onClosed` removed in the meantime.

### P3

- **F4. Head-of-line blocking and no lock timeout.** `src/storage/store.ts:99-119`. Review result: **no deadlock**. Updaters
  are synchronous, each `update()` holds exactly one lock, and the per-page queue never waits on a second lock while holding one.
  Web Locks are available in service workers (`WorkerNavigator.locks`) and are released when a context is terminated. The lock
  only spans one `get` and one `set` IPC. Two weaknesses remain: (a) the page-wide `queue` serialises *all keys*, so a slow
  `ts.calendarEvents` write delays an unrelated `ts.tasks` toggle; (b) `locks.request` has no `signal`, so a storage call that
  never settles holds the key forever in every context. Fix: use one queue per key, and pass
  `signal: AbortSignal.timeout(10_000)` on acquisition.
- **F5. `set()` updates cache and listeners before the write succeeds.** `store.ts:86-90`. If `adapter.set` rejects (for example
  quota), the UI shows data that was never persisted until the next change event. Fix: roll back the cache on rejection.
- **F6. Unlocked whole-object writes remain.** `src/hooks/useStore.ts:22` (setter = raw `set`) is used for read-modify-write of
  `ts.settings` from the render snapshot at `AppShell.tsx:86`, `SpotifyPanel.tsx:133`, `AnalyticsPage.tsx:234` and
  `DashboardPage.tsx:30`. Also `services/backup.ts:52-53` (`takeSnapshot`: get then set of `ts.backups`) and `deleteUsageData`.
  These are low risk but are the same class as BUG-ST2. Fix: route them through `update('ts.settings', s => …)` and
  `update('ts.backups', …)`.
- **F7. Duplicate daily snapshot on worker start.** `reminders.ts:100` (alarm) and `:118` (every start) can both call
  `maybeDailySnapshot()` at the same time. Both pass the "none in 20 h" check and write two snapshots (or lose one, see F6).
  The check also loads the whole `ts.backups` blob on every worker wake. Fix: run the check and the write inside one `update()`,
  and drop the start-up call or debounce it with a session flag.
- **F8. `markPanelOpen` only serialises within one context.** `src/extension/shared/sidePanel.ts:100-114`. The worker
  (`onOpened`/`onClosed`) and the panel page both do a read-modify-write on `ts.session.openPanels`, so they can drop each other's
  update. `resolveOpenWindows` covers most cases via `getContexts`. Fix: wrap it in `navigator.locks.request('tabspace-openPanels', …)`.
- **F9. Spotify refresh is single-flight per page only.** `src/integrations/spotify/auth.ts:80-125`. The invalid_grant re-read
  handles the common race, but two contexts can still both refresh, and with rotation the last writer wins. Fix: hold a Web Lock
  (`tabspace-spotify-refresh`) around `obtainToken`; the store's lock infrastructure already exists.
- **F10. "Replace current tabs" closes tabs even when the archive saved nothing.** `src/services/sessions.ts` (replace branch,
  around `:111-117`). `archived.session` can be null when every tab is non-saveable (for example `chrome://` pages), and those tabs
  are then closed with no archive. Fix: when the archive is null, skip closing those tabs or ask for confirmation.
- **F11. Unhandled rejections on task toggles.** `FocusPage.tsx:404` and `TaskDetails.tsx:55` call `void toggleTaskDone(id)` with
  no `.catch`/toast, unlike the other call sites. (`toggleTaskDone` itself, in `features/tasks/actions.ts`, is correct: it
  toggles from the stored value inside `update()`.)
- **F12. Quadratic `indexOf` in the ICS parser.** `ics.ts:221` (`vevents.indexOf(comp)` for UID-less events) is O(n²) for up to 20 000
  VEVENTs. Use the loop index instead.
- **F13. Stale comment.** `background/index.ts:190` says "declarativeNetRequest is optional", but it is a required manifest permission
  (the listeners are harmless).

## Reviewed and found correct

- **Tasks quick-add draft ref** (`MainWidgets.tsx`, `QuickActions.tsx`, `TasksPage.tsx`): the ref and state are always set
  together through one setter, with no stray `setDraft`/`setQuick`/`setTaskTitle` calls. Clearing synchronously before `await`
  stops duplicate submits, and the failure path restores the text only if the box is still empty.
- **`toggleTaskDone`**: toggles inside the locked updater with one `now`, and returns `undefined` for a missing task.
  The sidebar uses that return value correctly.
- **`getTargetWindow`** (`services/tabs.ts:66-92`): the order is explicit id → own tab's window (`tabs.getCurrent`) →
  `windows.getCurrent` (popup and side panel resolve to their host window) → last-focused normal → any normal. Non-normal windows
  are rejected. Replace mode excludes the Tabspace tab from closing.
- **Tab Manager own-tab exclusion** (TB1): it is filtered out of select-all, section select, and close, and the menu entry is disabled.
- **Side panel state** (`ts.session.openPanels`): `resolveOpenWindows` correctly prefers live `getContexts`, ignores a stale set when
  there are no contexts, and falls back to the stored set only for windowId -1.
- **DNR resilient update** (`background/blocking.ts`): tries an atomic batch first, then falls back to remove-all plus per-rule adds, so
  one bad domain can't disable all blocking. It only touches Tabspace rule ids and checks permission before use.
- **ICS fetch**: omits credentials, uses a 5 MB streaming cap, rejects cross-origin and non-https redirects, and never logs feed URLs.
  The VEVENT, event and iteration budgets plus fast-forward behave as intended, apart from F1.
- **MV3 worker**: every listener is registered synchronously at top level (including `registerReminders()`, which is idempotent).
  State is read fresh from storage (`state.ts`), the usage segment lives in `storage.session`, timers are only short debounces, and
  messages are checked against `sender.id`.
