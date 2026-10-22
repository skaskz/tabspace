# Tabspace — Independent QA report (Agent 5)

Date: 2026-10-21 · Build under test: `dist/` from `npx vite build` at HEAD `9e8220a` (rebuilt right before the final run)
Browser: Playwright bundled **Chromium 156.0.8078.4** (headless; UA `HeadlessChrome/156.0.0.0`), loaded unpacked with `--load-extension`.

## How to run

```
npx vite build
npx playwright test            # 74 E2E tests (tests/e2e)
npx vitest run tests/integration
```

Every known bug has a test that is marked `test.fail()` / `it.fails()` (or `test.fixme`) and carries its bug ID, so the suite stays green.
**When a bug is fixed, its test will start "unexpectedly passing" and fail the run. That means: remove the `test.fail` line.**

## Results (final run)

| Suite | Result |
| --- | --- |
| Playwright E2E (`tests/e2e`, 9 spec files) | **73 passed, 1 skipped**. 13 of the passing tests are expected failures documenting bugs. The skipped one is `test.fixme` BUG-SP1 |
| Vitest integration (`tests/integration/crossPage.test.ts`) | **4 passed, 2 expected fail** (BUG-ST2) |
| `npx eslint tests/e2e tests/integration` | clean |
| `npx tsc --noEmit` (tests) | clean |

Measured: the Tab Manager rendered **210 open tabs in about 2.2–2.6 s**, and searching them took about 80–100 ms.

## Bug list

| ID | Sev | Summary |
| --- | --- | --- |
| BUG-NT1 | **P1** (data loss) | Note text typed in the last 500 ms is lost if the user reloads or closes the tab |
| BUG-NT2 | **P1** (data loss) | A note open in two tabs or surfaces: saving in one tab silently overwrites the other tab's edits |
| BUG-ST2 | **P1** (data loss) | Writes made at the same moment from two extension pages (or a page and the worker) lose one of the writes |
| BUG-ST1 | **P2** | The "Default page", "New Tab search engine" and sidebar "Default view" selects never save the new value |
| BUG-WS1 | **P2** | Workspace card ⋯ menu: "Rename / change icon" sits under the card's "Save window"/"Open" button and can't be clicked |
| BUG-TK1 | **P2** | Double-clicking dashboard "Add task", or submitting Tasks quick add twice quickly, creates duplicate tasks |
| BUG-SS1 | **P2** (may be partly a headless artifact) | "Replace current tabs" and "Save window" act on the *last-focused* window, not the window the Tabspace tab is in |
| BUG-TB1 | P3 | Tab Manager "Select all" includes the Tabspace tab itself, so "Close N tabs" closes the dashboard you are working in |
| BUG-TK2 | P3 | Double-clicking a task checkbox ends "done" (both clicks write `done:true`) instead of toggling twice |
| BUG-SP1 | P3 | The popup can never show "Sidebar is open" (and "Close Sidebar" is always enabled) |
| OBS-NT3 | P3 / info | With the New Tab turned off, the tab is redirected to `chrome://new-tab-page/` |

### BUG-NT1 — notes lose the last keystrokes on reload or close (P1)
- **Steps:** Notes → New Note → type a title and wait 1 s → type in the content → press Ctrl+R (or close the tab) within 500 ms.
- **Expected:** the content is saved.
- **Actual:** `ts.notes[0].content` is `""` after the reload or close.
- **Cause:** `src/pages/notes/NoteEditor.tsx` `flush()` runs on `pagehide`/`visibilitychange`/unmount. It calls `patch()`, which queues an async `chrome.storage.local.get` followed by a `set`. The page is gone before that finishes.
- **Fix idea:** write the note on every change with no debounce on hide. For example, on `pagehide` call `chrome.storage.local.set` directly with a list built from the cached `ts.notes` (one async call, no read first). Or show a `beforeunload` prompt while `pending`.
- **Tests:** `persistence.spec.ts` › `BUG-NT1 …` (2 tests).

### BUG-NT2 — a note edited in two places clobbers itself (P1)
- **Steps:** Tab A and tab B both open the same note. Edit the content in A and wait for "Saved". Then edit only the title in B.
- **Expected:** title = B's title, content = A's content.
- **Actual:** B's editor still shows the stale content (`v1`). B's save writes `{title, content: 'v1'}` and A's edit is lost.
- **Cause:** `NoteEditor` copies `note` into local state once, mounted with `key={note.id}`, and never reconciles it with storage updates. `flush()` patches both title and content.
- **Fix idea:** patch only the field that changed. When the stored note changes and the editor isn't dirty, adopt the new values. Ideally warn on conflict.
- **Test:** `adversarial.spec.ts` › `BUG-NT2 …`.

### BUG-ST2 — writes from two pages at once lose updates (P1)
- **Steps:** open two dashboard tabs on Tasks. Submit quick-add in both tabs at the same moment (5 rounds).
- **Expected:** all 10 tasks are stored.
- **Actual:** between 1 and 5 of tab A's tasks are missing in each run.
- **Cause:** `src/storage/store.ts` `update()` re-reads storage, but its promise queue exists separately in each page. Two pages read the same old array and the later `set()` wins. The same race exists between the service worker (`insert('ts.focusSessions')`, `update('ts.focus')`, `ts.usage`) and pages, and between the side panel and the dashboard.
- **Fix idea:** keep one record per key with a per-item map, or route all writes through the service worker (`runtime.sendMessage` → a single queue), or use `navigator.locks.request('ts-store', …)`. Web Locks are shared across same-origin extension pages and the worker.
- **Tests:** `adversarial.spec.ts` › `BUG-ST2 …` (E2E). `tests/integration/crossPage.test.ts` has two `it.fails` tests that reproduce it deterministically with two store instances.

### BUG-ST1 — some settings selects don't save (P2)
- **Steps:** Settings → Layout → Default page → choose "Tasks".
- **Expected:** `settings.defaultPage === 'tasks'`.
- **Actual:** the value stays `'dashboard'` and the select snaps back.
- **Also affected:** "New Tab search engine" (Settings), and Chrome Sidebar → "Section shown when the sidebar opens".
- **Cause:** `onChange={(e) => void patchSettings((s) => ({ ...s, x: e.target.value }))}`. The updater runs asynchronously. By then React has re-rendered the controlled `<select>` back to its old value, so `e.target.value` holds the old value.
- **Where:** `src/pages/settings/PreferenceSections.tsx:143,163`, `src/pages/sidebar/SidebarSettingsPage.tsx:95`.
- **Fix:** `const v = e.target.value;` before calling `patchSettings`.
- **Tests:** `persistence.spec.ts` › `BUG-ST1 …` (3 tests).

### BUG-WS1 — workspace card menu items covered by the card button (P2)
- **Steps:** Workspaces → card ⋯ (Actions for X) → click "Rename / change icon".
- **Expected:** the Edit dialog opens.
- **Actual:** the menu popover renders *under* the card's bottom-right "Save window"/"Open" button, so the click hits that button or never lands. See the visual in the test trace.
- **Cause:** in `WorkspacesPage.tsx` both the menu wrapper and the button wrapper are `relative z-10`. The later one in the DOM stacks on top. The menu items are also narrow (text wraps onto two lines).
- **Fix idea:** give the open menu a higher z-index or portal it.
- **Note:** keyboard selection works, so the rename test uses the keyboard.
- **Test:** `workspaces.spec.ts` › `BUG-WS1 …`.

### BUG-TK1 — duplicate tasks from a fast double submit (P2)
- **Steps:** Dashboard → type in "Add a new task…" → double-click the + button. Or on the Tasks page, submit quick add twice in one tick (fast double Enter or key repeat).
- **Expected:** one task.
- **Actual:** two identical tasks.
- **Cause:** `TasksPage.addQuick` (and the dashboard Today widget's `add`) clears the draft only *after* `await createTask()`. Both submits read the same draft.
- **Fix:** clear the input or set a busy flag synchronously before awaiting.
- **Tests:** `adversarial.spec.ts` › `BUG-TK1 …` (2 tests).

### BUG-SS1 — restore "replace" / "Save window" target the last-focused window (P2)
- **Steps:** the dashboard is in window A. Another window B was focused most recently (`chrome.windows.getLastFocused`). Workspaces → Open ▾ → Replace current tabs… → confirm.
- **Expected:** window A's tabs are archived and replaced, and B is untouched. The dialog says "Your current window's tabs…".
- **Actual:** window B's tabs are archived and closed, and the session opens in B.
- **Cause:** `getTargetWindow()` in `src/services/tabs.ts`, used by `restoreSessionData` and `saveCurrentWindowDetailed`.
- **Caveat:** in real Chrome, clicking inside the dashboard window normally makes it the last-focused window. Headless Chromium does not update window focus on `bringToFront`, so how often users hit this is uncertain. Even so, from a dashboard *tab* the window that holds that tab is the right target (`chrome.tabs.getCurrent()`).
- **Test:** `workspaces.spec.ts` › `BUG-SS1 …`.

### BUG-TB1 — "Select all" includes the Tabspace tab (P3)
- With 210 tabs open, "Select all visible tabs" → Close → the dialog says "Close 212 tabs?". That count includes the dashboard tab and Playwright's about:blank tab.
- Confirming closes the Tabspace page itself.
- **Suggestion:** exclude the page's own tab from select-all, or say "including this Tabspace tab" in the dialog.
- **Test:** `adversarial.spec.ts` › `BUG-TB1 …`.

### BUG-TK2 — double-clicking a task checkbox (P3)
- Two quick clicks on a task row checkbox leave the task done (`true`), not done-then-undone.
- **Cause:** the second click computes `!task.done` from the stale prop. Low impact.
- **Test:** `adversarial.spec.ts` › `BUG-TK2 …`.

### BUG-SP1 — the popup can't detect the open side panel (P3)
- In Chromium 156, `chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']})` returns the panel context with **`windowId: -1`**.
- `openSidePanelWindows()` (`src/extension/shared/sidePanel.ts`) therefore returns `null`. The popup always says "Sidebar is ready" and "Close Sidebar" is never disabled. Closing still works.
- **Fix idea:** the worker already tracks `sidePanel.onOpened`/`onClosed` (`openPanels` in the background). Expose that set to the popup through a message or `storage.session`.
- **Test:** `sidepanel.spec.ts` › `BUG-SP1` (`test.fixme`).

### OBS-NT3 — what the "New Tab off" setting actually does (P3 / info)
- With `newTab.enabled=false`, opening a new tab loads `newtab.html` first. `chrome.tabs.update` then sends it to **`chrome://new-tab-page/`**. That works in Chromium 156: the URL ends at `chrome://new-tab-page/` and no error is shown.
- Side effects that couldn't be verified headless:
  - a brief flash of the extension page
  - the address bar shows `chrome://new-tab-page/` instead of being empty
  - the omnibox probably loses its focus
- Chrome offers no way to turn off an NTP override at runtime, so this is a reasonable compromise. The Settings hint should say so.

## Verified working (no bugs found)

1. **Extension loads.** MV3 worker runs. Permissions match the manifest, and no host permissions are granted by default. The side panel defaults to enabled with `sidepanel.html`, and `openPanelOnActionClick:false`.
2. **Dashboard and navigation.**
   - All 11 routes render an H1 and the nav link's `aria-current` updates.
   - Unknown hash routes fall back to the dashboard.
   - Page titles update and Back/Forward work.
   - **No console errors or page errors** on any dashboard route, popup, side panel (all 5 sections) or New Tab. This is checked in every spec through a context-wide collector that also watches the service worker console.
3. **Side panel.**
   - `sidepanel.html` works as a tab, in both directions:
     - a task added in the panel shows on the dashboard
     - a task completed on the dashboard updates the panel
     - a task completed in the panel shows under the dashboard's Completed list
   - Popup "Open Sidebar" (`chrome.sidePanel.open` from a real click) opens the **real** Chrome side panel, confirmed by a SIDE_PANEL context in `runtime.getContexts`. Popup "Close Sidebar" closes it.
4. **Disabling the sidebar.**
   - Disable from the popup → `sidePanel.getOptions({}).enabled === false`. Tasks and notes are intact. `sidePanel.open` rejects, and the open panel closes.
   - Re-enable from the popup → `enabled:true` with path `sidepanel.html`, and the panel opens again.
   - Disabling from the Chrome Sidebar page persists across a full browser restart.
   - Section visibility toggles work.
5. **New Tab override.** It serves `newtab.html`. `javascript:`, `data:`, `file:` and `chrome:` input in the search box are sent to the search engine as queries and never opened (Google was stubbed with `page.route`). Add shortcut rejects `javascript:`. A `javascript:` quick link injected into storage is not rendered as a link on the New Tab or the dashboard.
6. **Workspaces.**
   - Create, persist, reload; the workspace shows in the side panel and on the dashboard. Whitespace names are rejected, and a double-click creates only one.
   - Rename shows everywhere (grid, side panel live, task details).
   - Delete asks for confirmation (showing counts of what's kept), and the tasks, notes, bookmarks and sessions are kept but unassigned.
7. **Native tab groups.**
   - Saving a window with 2 groups (Research/blue, Build/red) and an ungrouped tab stores the URLs in order, plus the groups and their membership.
   - **Restore in a new window** recreates both groups with the right titles, colours and membership.
   - **Add to this window** adds the 4 tabs and their groups.
   - **Replace:** a confirmation dialog appears and Cancel does nothing. Confirming archives the current tabs (`archived:true` session with the old URLs), then replaces them, and **the Tabspace tab stays open**.
8. **Persistence.** Tasks persist across reload and a full browser restart (same `userDataDir` relaunched), including Completed. Notes autosave after a pause. Bookmarks persist across a restart. Settings (name, starfield toggle) persist across a restart, and the greeting uses the name.
9. **Calendar.** A local event shows on the Month grid and in Week/Day/Agenda. On the dashboard it appears in the Upcoming list, and the mini-calendar cell's label reads "has events, today". An empty title is rejected. Deleting an event asks for confirmation.
10. **Focus timer.**
    - After starting on the Focus page, remaining time matches within ±3 s across the dashboard (after navigating between routes), side panel, popup and New Tab pill.
    - The badge shows `25m`/`24m`, and the `ts-focus-end` and `ts-focus-tick` alarms exist.
    - Pausing from the side panel freezes the time everywhere and the badge shows `❚❚`. Resume works. Stop returns to idle, clears the badge and alarms, and does not record a run under a minute.
    - A session whose `endAt` has passed is completed by the worker and recorded **exactly once**, even when re-triggered. It shows in Focus stats and Analytics.
    - The real alarm path works with no page open: a session ending 5 s in the future completes on its own.
    - Custom duration is clamped to 1–240 minutes.
11. **Blocking (declarativeNetRequest).**
    - With blocking on but the timer idle, there are no rules.
    - Starting a session adds rules for the blocklist plus a domain the user added (entered as a URL, normalised to `example.com`).
    - Navigating to `https://example.com/` or `www.example.com` redirects to `dashboard.html#/focus?blocked=example.com`.
    - Pausing lifts the block. Stopping removes all rules and the site loads again. Breaks never block.
12. **Destructive actions ask for confirmation:** delete workspace, delete saved session, delete task (Cancel keeps it), close tabs, delete calendar event, remove example data, and Clear all data. Clear all data requires typing `DELETE` exactly; lowercase `delete` keeps the button disabled. Afterwards the app is still usable.
13. **Adversarial cases that held up:**
    - 210 tabs (about 2.4 s render)
    - an empty workspace's detail page
    - very long task titles and notes: no horizontal overflow (screenshots 42–45)
    - duplicate bookmark → "Save anyway" flow
    - markdown preview XSS (`onerror`, `javascript:` links, `<script>`): nothing executes and no `javascript:` hrefs
    - corrupt imports are rejected with clear messages ("not valid JSON", "not a Tabspace backup", "Invalid data at ts.tasks"), and data is unchanged
    - export → import (replace) round-trips, and the export contains no `secret.*`
    - Spotify and Google not configured show "Not set up" and "Connect Spotify", never "Connected"
    - a `javascript:` dashboard quick link is rejected
14. **Sample data.** "Load example data" fills workspaces, tasks, notes, bookmarks and events. A scan of all of them found no school, class, Canvas or academic terms.

## Not automated — manual test steps

1. **The real side panel UI in branded Chrome.** Load `dist/` in Chrome 116+ (`chrome://extensions` → Developer mode → Load unpacked). Click the toolbar icon → Open Sidebar. Check that it docks, that its width is 320–400 px, and switch sections. Run Chrome Sidebar → Disable, then confirm the panel disappears from Chrome's side-panel menu.
2. **The Ctrl+Shift+S command.** Extension commands can't be fired from automation. Press Ctrl+Shift+S in a normal window and the panel should open. On Chrome 141+, press it again and the panel should close.
3. **The toolbar popup as a real popup.** Check that `window.close()` runs after Open Sidebar and Open Dashboard, and look at the popup sizing (tests opened `popup.html` as a tab).
4. **Notifications.** Finish a focus session with notifications on and confirm the OS notification appears. Clicking it should open `#/focus`. Do the same for a task or event reminder (`ts-rem-*` alarms).
5. **Google Calendar OAuth, Spotify PKCE and an ICS URL.** These need real client IDs and accounts, plus the optional host-permission prompt. Verify that "Connected" appears only after a successful sign-in, and that Disconnect removes `secret.*`.
6. **Chrome bookmarks import.** This requires the optional `bookmarks` permission prompt. Confirm the permission is released afterwards.
7. **New Tab off.** Toggle it off, open a new tab, and watch for a flash, what the address bar shows and whether the omnibox has focus (OBS-NT3).
8. **BUG-SS1 in real Chrome.** Use two windows. Focus the second window, then click the dashboard tab in the first window by mouse and run Replace. Note which window is replaced.
9. **Light theme, reduced-motion and text-size visuals.** Only the dark theme was screenshot.

## Screenshots

`docs/qa/screenshots/` holds:
- every page empty (`02-page-*`) and with example data (`07-page-*`)
- popup, side panel (each section), New Tab
- workspaces with a session, notes editor, bookmarks, settings
- focus running and with blocking on
- calendar Month/Week/Day/Agenda, and the dashboard with an event
- 210-tab manager
- long-content layouts
- the integrations section
