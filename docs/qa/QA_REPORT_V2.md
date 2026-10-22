# Tabspace V2: independent QA report (Agent 5)

- **Date:** 2026-10-22
- **Build:** HEAD `a9f0298`, built with `npx vite build` before every run.
- **Browser:** Playwright-bundled **Chromium 156.0.8078.4**, headless, with the unpacked extension loaded.

## How to run

```
npx vite build && npx playwright test && npx vitest run tests/integration
```

## Results

| Suite | Result |
| --- | --- |
| Playwright E2E (14 spec files) | **126 tests: 125 passed, 1 skipped (`fixme` BUG-MG1).** Two of the passes are expected failures (`test.fail`): BUG-MO1 and BUG-QN1. All v1 regression tests pass. |
| Vitest integration | 6 / 6 passed. |
| ESLint and `tsc --noEmit` (tests) | Clean. |

New spec files:
- `tests/e2e/v2-qa.spec.ts`: New Tab hub, timer sync, Quick Note, XSS, upgrade, completion. 19 tests.
- `tests/e2e/v2-qa-2.spec.ts`: saved-tab editing, motion, parallax, Spotify, console errors. 26 tests.

Test fix: in the lead's `v2-popup.spec.ts`, the 1-minute test sometimes failed with a TypeError. Its first poll read `ts.settings` before it existed, so I added optional chaining. It now passes the real 60 s path, which covers the alarm, the history record, the notification, the offscreen chime, the "Session complete" state and the badge being cleared.

## Bugs

| ID | Sev | Summary |
| --- | --- | --- |
| BUG-QN1 | P2 | Quick Note "Attach this page's link" breaks any URL that contains parentheses. |
| BUG-MO1 | P3 | Pressing Escape in a dialog that sits on top of another dialog closes both. |
| BUG-MG1 | P3 | The first-install migration can overwrite settings written in its first ~300 ms. |
| OBS-1 | P3 / info | Loading example data into a profile that already has data creates duplicates with the same names. |

### BUG-QN1: attached page links with "(" or ")" are cut short (P2)
**Steps:**
1. Open `…/p/Mercury_(planet)`. Wikipedia-style URLs like this are common.
2. Open a Quick Note window (`popup.html#note`, the same window the Alt+Shift+N fallback opens).
3. Tick "Attach this page's link", type a note, and wait for "Saved".
4. Open the note in Notes.

**Expected:** the link points to `…/p/Mercury_(planet)`.

**Actual:**
- The note is stored as `[Mercury_(planet)](http://…/p/Mercury_(planet))`.
- The rendered link points to `…/p/Mercury_(planet`. The URL is cut at the first `)`, and the rest shows up as stray text.

**Cause:**
- In `src/extension/popup/quickNote.ts`, `markdownLink()` escapes `(`, `)` and whitespace with `encodeURIComponent(c)`.
- `encodeURIComponent` leaves `(` and `)` unchanged, so the parentheses are never escaped.
- Fix: map `(` → `%28` and `)` → `%29` explicitly.

**Security:** checked and not a problem. A page title like `Evil](javascript:alert(1)) [x` still renders only http hrefs.

**Test:** `v2-qa.spec.ts` › `BUG-QN1`.

### BUG-MO1: Escape closes the whole stack of dialogs (P3)
**Steps:**
1. Calendar → Agenda → click an event. The details dialog opens.
2. Click Delete. The confirm dialog opens on top.
3. Press Escape.

**Expected:** only the confirm dialog closes, and the details dialog stays open.

**Actual:** both dialogs close. The event is not deleted.

**Cause:**
- In `Modal` (`src/components/ui/index.tsx`), every open dialog adds a capture-phase `keydown` listener on `document`.
- `e.stopPropagation()` does not stop other listeners on the same node.
- Fix: track a modal stack and let only the top dialog handle Escape, or use `stopImmediatePropagation` and register the newest dialog first.

**Test:** `v2-qa-2.spec.ts` › `BUG-MO1`.

### BUG-MG1: install-time migration can overwrite fresh settings (P3)
**Steps:**
1. Start with a fresh profile.
2. Write `ts.settings` (e.g. `{userName:'Alex', …}`) within ~300 ms of the first service worker start.
3. Wait one second.

**Expected:** the settings are kept.

**Actual:** `ts.settings` becomes `{schemaVersion:1}`. This happened 4 out of 4 times with no delay and 0 out of 4 times with a delay of 400 ms or more.

**Cause:**
- On `onInstalled`, `runMigrations()` (`src/storage/migrations.ts`) reads a snapshot of storage first.
- It then writes `ts.settings = {...snapshot settings, schemaVersion}`.
- It does this outside the store's Web Lock, so any settings written between the read and the write are lost.
- Fix: do the migration write inside `update('ts.settings', …)` or the same lock, and merge into the current value.

**Impact:** low in practice. Normal v1 → v2 updates exit early because `schemaVersion` is already 1.

**Test:** `v2-qa.spec.ts` › `BUG-MG1`, marked `test.fixme` because the race depends on timing.

### OBS-1: example data duplicates existing items
Loading example data into a profile that already has data adds items whose names match the user's, for example a second "Development" workspace or a duplicate task. It doesn't break anything. Consider showing a warning, or skipping items whose names already exist.

## Verified working

### New Tab hub
- **Data shown is real:**
  - each workspace's saved-tab count, and "Open" is disabled for empty ones
  - today's tasks, with "someday" tasks excluded
  - upcoming events, and the calendar cell is labelled "has events"
  - quick links come only from **favourite** bookmarks
- **Fits 1366×768 without scrolling**, both with my seeded data and with example data: scrollHeight 768 = innerHeight, and scrollWidth 1366.
- **Open a workspace from the New Tab** creates a new window with the tabs in order, and recreates the native group (title "Docs", colour green).
- **Task sync:** completing a task on the New Tab updates the dashboard (Completed list) and the side panel. Adding a task on the New Tab shows up on the dashboard.

### Timer sync
- Focus started from the New Tab shows the same remaining time on the New Tab, dashboard, side panel and popup.
- I sampled it 3 times. Every surface was within ±1 s of `endAt` (all four exactly equal in two of the samples).
- The badge showed `25m`.
- Pausing from the popup shows the same frozen time everywhere. Resume works. Stop returns to idle and clears the badge.
- Over 6 s, the popup minus the dashboard read `[-1, 0, 0, 0, 0, 0]` seconds.

### Focus completion
- The real 60 s session works with every page closed: history record, notification, offscreen chime (`lastChime.ok`), "Session complete" state, and the badge cleared.
- The "Session complete" state disappears after 1 minute.
- With sound off, completion still records and notifies, but plays no chime and creates no offscreen document.
- Two completions back to back work, with no errors.

### Quick Note
- **Three notes in a row work.** The second was closed by clicking Back inside the 400 ms debounce, and the third by closing the popup while typing. Result:
  - exactly 3 notes, each with the exact text
  - no duplicates
  - no `ts.quicknote.pending.*` or `ts.notes.unsaved.*` keys left behind
- **Closing the popup within ~0 ms of typing**, repeated 3 times, gave exactly the 3 expected notes.
- **Pressing Escape mid-typing** saves the note.

### XSS
I tried `onerror`, `onload`, `<script>`, `<svg>` and `javascript:` payloads. In every case below:
- nothing executed
- no `javascript:` hrefs were rendered
- no event-handler attributes ended up in the page

Places tested:
- Quick Note text, viewed in Notes, the dashboard, the New Tab, the side panel and the popup
- saved tab titles and URLs, viewed in the workspace detail page, the grid, the dashboard, the New Tab and the side panel
- a hostile page title attached to a Quick Note

### Workspace saved-tab editing
- **The user's acceptance case works:** 5 saved tabs → remove 1 and reorder → exactly 4 in the expected order, both in storage and in the list. Opening the workspace restores tabs in that order.
- **Drag and drop** reorders tabs.
- **Rapid clicks are safe:** 5 fast "Move up" clicks give the correct order. Double-clicking Remove removes exactly one tab, and Undo restores it.
- **Add URL** rejects `javascript:`, `data:`, `file:`, `chrome:`, plain text and `http://`. It accepts bare domains and asks before adding a duplicate.
- **"Add current tab"** from the dashboard says "No web page is open…" and never saves the extension page itself.
- **Update from window:**
  - "merge" skips URLs that are already saved
  - "replace" keeps the previous list as History
- **200 saved tabs:** the page renders in 436 ms, a move takes 177 ms and a remove takes 171 ms.

### Motion (animations)
- **12 rapid open/Escape cycles** leave no dialog behind and no `data-state=closing` element, and focus goes back to the button that opened the dialog.
- **Clicking a nav link under a dialog that is still closing** goes through immediately. The closing dialog is inert.
- **Double-clicking Cancel, or the backdrop, during the exit animation** closes it once. Reopening and typing straight away works, with focus inside the new dialog.
- **The Tab key stays trapped** in the open dialog, even after 30 presses. The closing dialog cannot take focus.
- **Menus:** 8 rapid open/Escape cycles leave nothing stuck, and clicking an item afterwards works.
- **Reduced motion:** dialogs unmount in under 60 ms.

### Parallax
- On by default. Moving the mouse shifts the three layers by different amounts: about 1×, 3× and 7×.
- The animation loop stops once the mouse is still, so the transforms stop changing.
- 3 s of continuous mouse movement produced **0 long tasks at about 157 fps** (headless numbers).
- Turning the setting off applies live, and the layers stop moving.
- The OS `prefers-reduced-motion` setting and the app's own Reduced motion switch both freeze the layers.
- Parallax also works on the New Tab.

### Spotify
I injected a fake token into `secret.spotify` and mocked `api.spotify.com` / `accounts.spotify.com` with `context.route`.
- **Not set up:** "Spotify isn't set up" appears everywhere.
- **Client ID set but no account:** "Spotify isn't connected" with a Connect button.
- **Mocked connected account:**
  - the track title shows as plain text (an HTML title stays escaped)
  - Next with a non-JSON 200 response is treated as success, with no error shown
  - just 1 `GET /me/player` in 6 s with two surfaces open, so a single shared poller
- **Mocked 403 PREMIUM_REQUIRED** shows "Premium is required".
- **Mocked 401 with a failed refresh** shows "isn't connected" and Connect.
- No surface ever shows "Connected" without an account.

### Data preservation
I loaded v1-shaped storage (settings without the `parallax`, `quickNote` and `focus.sound` fields, plus records) and fully restarted the browser. Then:
- every surface rendered
- all records were byte-identical to before
- the user's v1 settings were kept (focus 30 min, DuckDuckGo search, default page)
- the new switches showed their defaults: parallax on, completion sound on, attach link off
- the popup showed 30:00

### Console errors
- None on any dashboard route, the workspace detail page, the New Tab, the popup, the popup's `#note` mode or the side panel, with example data loaded.

## Not automated (manual steps)

1. **Keyboard shortcuts.** Alt+Shift+N (quick-note) and Alt+Shift+O (`_execute_action`) can't be pressed through automation. Press each in a normal window:
   - Alt+Shift+O should open the toolbar popup.
   - Alt+Shift+N should open the popup in note mode, or the fallback window if `openPopup` fails.
2. **The real toolbar popup closing on outside click or tab switch** while typing a Quick Note. Tests used `page.close()` and Escape. Check that the note is still there afterwards.
3. **Chime audio and the OS notification appearing.** Tests confirm the offscreen document exists and that `lastChime.ok` is set, not that sound actually plays.
4. **The '+ New Note' bookmark:** create a bookmark to `chrome-extension://<id>/popup.html#note` and click it.
5. **A real Spotify account:** Premium and Free, with and without an active device, plus the Liked Songs flow.
6. **Parallax smoothness on a real GPU / high-DPI screen**, and the side panel starfield at 320–400 px.
7. **A real v1 → v2 extension update** (`onInstalled` reason `update`). `chrome.runtime.reload()` disables an extension loaded with `--load-extension` in Playwright, so I tested a browser restart with v1 data instead.

## Screenshots

`docs/qa/screenshots/v2qa-*.png`:
- New Tab at 1366×768, seeded and with example data
- New Tab with mocked Spotify
- workspace after editing
- workspace with 200 saved tabs

The lead's `v2-*` popup, quick-note and focus-complete shots are refreshed on every run.
