# Tabspace V2.1 — independent QA report (Agent 5)

- **Date:** 2026-10-22
- **Build under test:** HEAD `19f4d47`, built into a separate output folder (`npx vite build --outDir <scratchpad>/dist-qa`). `dist/` was not touched.
- **Browser:** Playwright-bundled **Chromium 156.0.8078.4**, headless.

## How to run

```
npx vite build --outDir <dir> --emptyOutDir
TABSPACE_DIST=<dir> npx playwright test v21-qa --output=<other-results-dir>
```

`TABSPACE_DIST` is optional and defaults to `dist/`.

The website-bar tests load a copy of the build whose manifest makes `scripting` and http(s) access *required*. Chrome's optional-permission prompt can't be accepted from automation; this is the same approach as `v2-bar.spec.ts`.

## Results

| Suite | Result |
| --- | --- |
| `tests/e2e/v21-qa.spec.ts` (menus, Save current tab, Customize, New Tab bar) | 21 tests: 20 passed, plus 1 expected failure (BUG-NT21) |
| `tests/e2e/v21-qa-bar.spec.ts` (bar on websites) | 16 tests: 13 passed, plus 3 expected failures (BUG-BAR1/2/3) |
| **Total** | **37 tests, all green.** The 4 bug tests are marked `test.fail`. |
| ESLint and `tsc` on the new files | Clean |

New helper: `tests/e2e/qa21.ts`. It supports both build variants (normal and granted-permissions copy), records errors from host pages, and serves a set of adversarial pages: fixed header, strict CSP, an element remover, SPA, own html margin, fullscreen, and a hostile page title.

## Bugs

| ID | Sev | Summary |
| --- | --- | --- |
| BUG-BAR3 | **P2** | With a bar menu open, clicking the website doesn't close it, and an invisible 440 px frame keeps covering the top of the page |
| BUG-BAR1 | **P2** | Fixed or sticky site headers sit under the bar; their top 34 px can't be clicked |
| BUG-NT21 | P2 | Turning "New Tab: daily quote" back on in Settings doesn't bring back a quote hidden via Customize |
| BUG-BAR2 | P3 | If a page removes the bar element, a 34 px blank gap stays and the bar never comes back |
| OBS-1 | P3 | "Everything in the side column" uses only two of three grid columns; the right third is empty |
| OBS-2 | P3 | "All widgets hidden" shows a blank starfield with no hint; only the Customize button remains |

### BUG-BAR3 — open bar menu leaves an invisible overlay on the page (P2)
**Steps**
1. Turn on the website bar and open any long page.
2. Click a folder chip, e.g. "Dev tools". The menu opens and the bar's iframe grows to 440 px.
3. Click the page anywhere below 440 px.

**Expected:** the menu closes and the frame shrinks back to 34 px.

**Actual:** the menu stays open. The transparent 440 px iframe keeps covering the top of the page, so `elementFromPoint(900, 200)` returns `TABSPACE-BAR`. The next click in that area is swallowed.

**Cause:** the menu's outside-click handler (`BarMenu` `mousedown` listener) only sees clicks inside the iframe. Clicks on the host page never reach it.

**Fix idea:** close on the iframe window's `blur` event, or have `bar-content.js` listen for page `mousedown` and tell the frame to collapse.

**Test:** `v21-qa-bar.spec.ts` › `BUG-BAR3`.

### BUG-BAR1 — site headers covered by the bar (P2)
**Steps**
1. Turn on the website bar.
2. Open a page with `header { position: fixed; top: 0 }`. This is the pattern most big sites use (GitHub, YouTube, Gmail).

**Expected:** the site header stays fully usable.

**Actual:** `margin-top: 34px` on `<html>` only moves normal page content. The fixed header stays at `top: 0`, underneath the bar (which has the maximum z-index). Its top 34 px — nav, search, menus — can't be clicked: `elementFromPoint(40, 15)` returns `TABSPACE-BAR`. Screenshot: `v21qa-bar-fixed-header.png`.

**Notes:** every injected toolbar has this problem. Possible mitigations:
- detect top-anchored fixed/sticky elements and offset them;
- make the bar overlay-only with auto-hide;
- default "collapsed" on such sites;
- at minimum, document it next to "Hide on this site".

**Test:** `BUG-BAR1`.

### BUG-NT21 — Settings quote toggle and Customize disagree (P2)
**Steps**
1. On the New Tab: Customize → Hide "Daily quote" → Done.
2. Open Settings → Layout. "New Tab: daily quote" is off.
3. Turn it on.
4. Reload the New Tab.

**Expected:** the quote is shown.

**Actual:** the switch shows on, but the quote stays hidden.

**Cause:** the Settings toggle only writes `newTab.showQuote`. `resolveLayout()` still treats `'quote'` as hidden because it remains in `layout.hidden`. The "New Tab: focus timer" toggle (`showFocus`) has the same code path.

**Fix:** when either toggle is turned on, call `showWidget()` on the layout too (or derive the toggles from the layout only).

**Test:** `BUG-NT21`.

### BUG-BAR2 — page removes the bar element (P3)
**Steps:** open a page that removes `<tabspace-bar>` when it is added (some sites clean up unknown elements, or a hostile page does it on purpose).

**Expected:** the page isn't shifted down, or the bar mounts again.

**Actual:** no bar is shown, but `margin-top` stays at `34px` — a permanent blank strip. The bar never mounts again, because `bar-content.js` still holds its old reference to the removed element.

**Fix idea:** if `!host.isConnected`, reset the state and re-mount (or un-shift) on the next sync or in a MutationObserver.

**Test:** `BUG-BAR2`.

## Verified working

### 1. Menus (now rendered into `<body>`)
- **Spotify "…" menu on the New Tab** (with a mocked connected account) appears fully above Quick Links and stays inside the viewport at 1366×768 (opens downward) and 1440×900 (flips upward). I checked that the menu is the topmost element at its centre and at three inner corners. Escape returns focus to the trigger.
- **Spotify menu on the dashboard** flips upward near the bottom edge, and stays attached to its trigger after a resize and after scrolling.
- **Other menus on screen:** the workspace card menu at the bottom of a scrolled grid (and its "Rename" item works), the last task-row menu, the saved-session menu, and a task menu on the dashboard at 320 px width.
- **Keyboard:** Enter opens a menu, End / ArrowDown wrap around, Escape returns focus, and Tab closes it. Nine rapid clicks leave exactly one menu open. No leftover menu elements in `<body>` after closing.
- **Not applicable:** the side panel and the 300 px popup contain no shared `Menu`, and there are currently no menus inside modals (checked in the source).

### 2. Bookmarks "Save current tab"
- **Same window:** it picks the web tab, never the dashboard. The folder currently open is preselected. After saving, the bookmark is shown and selected.
- **Dashboard alone in another window:** it picks the web page from the other window.
- **Dashboard opened from the New Tab:** it offers the most recently used web tab first. The Page selector lists the other candidates, and switching page updates both the URL and the title.
- **Duplicates:** the dialog says "Already saved in Reading". "Update" moves the existing bookmark (same id, favourite flag kept). "Add a copy" creates a second bookmark.
- **No web tab open:** it shows "No open web page to save…".
- **Double-clicking Save** creates only one bookmark.

### 3. Customizable New Tab
- **Button controls:** hide, move up, and move to the other column all save immediately. The layout survives a reload and a full browser restart, and "Reset to default" restores everything.
- **Drag and drop:** dragging a side widget to the top of the main column works, and so does dragging a widget out of the hidden-widgets tray.
- **Keyboard only:** Customize, then repeated Enter on "Move … up" works, and focus stays on the control.
- **Odd layouts** — all hidden, only the bar, everything in one main column, everything in the side column, search only: no horizontal scroll and Customize is always reachable. With everything hidden, the tray offers "Show Clock".
- **Corrupt stored layout** (unknown ids, duplicates, wrong types) is cleaned up on load with no errors.
- **1366×768 with lots of data:** no horizontal scroll.
- **Hiding the Tabspace Bar via Customize** persists, and turning `tabspaceBar.onNewTab` off hides it live.

### 4. Tabspace Bar on the New Tab
- Favourites are shown, and a `javascript:` favourite is never rendered.
- Folder dropdown, including a nested sub-folder, opens and lists its links. Empty folders open a menu.
- The overflow "»" button works: "18 more bookmarks" at 1100 px wide, fewer at wider sizes.
- The Workspaces menu opens the workspace in a new window with its saved tabs.
- Arrow keys move focus along the bar. Enter opens a folder and Escape returns focus to it.

### 5. Tabspace Bar on websites
- It's injected exactly once and shifts the page down 34 px. On a page with its own html margin (20 px), the original margin is restored when the bar goes away.
- **Bookmark this page:**
  - saving into a newly created folder from the bar works; the star fills, the frame shrinks back, and the bookmark appears on the dashboard
  - the dialog fits a 1280×420 window and Save can be clicked
  - a hostile page title shows up as plain text and nothing executes
- "Hide bar" collapses it for that page only; it shows again after navigating.
- "Hide on this site" affects only that host (localhost still shows it), and clearing `disabledSites` brings the bar back live.
- **Fullscreen** hides the bar and removes the shift; exiting fullscreen restores both.
- Disabling the bar removes it from all 3 open tabs live. Re-enabling it shows it again in tabs that are already open.
- **SPA navigation (`pushState`):** the bar stays, and the star updates for the new URL (shows not-bookmarked).
- **Strict CSP page** (`default-src 'none'; frame-src 'none'`): the bar still injects and works, with no CSP errors.
- **Rapid toggling** (10 times ending on, 9 times ending off): the registered script, open tabs and newly opened tabs all agree with the final setting.
- Arrow keys work inside the bar frame, and Escape closes a folder menu and returns focus.
- **No console errors** on host pages (plain, fixed header, SPA, own margin, long page).
- `bar.html` can't be embedded by other pages (covered by the lead's `v2-bar.spec.ts`).

## Not automated — manual test steps
1. **Real permission flow:** Settings → Tabspace Bar → turn on "Show on websites", accept Chrome's prompt, then turn it off. The permission should be released (`chrome://extensions` → Details → Site access).
2. **Real sites with sticky headers and complex layouts** (GitHub, YouTube, Gmail, Google Docs), to judge how much BUG-BAR1 affects real use, and pages with `html { overflow: hidden }` app shells.
3. **The bar in light theme / high-DPI screens,** and pages that set `color-scheme`.
4. **Dragging with a real mouse** on the Customize screen (HTML5 drag events in headless Chromium are synthetic).

## Screenshots

All in `docs/qa/screenshots/`:
- `v21qa-spotify-menu-1366.png`, `v21qa-spotify-menu-1440.png`
- `v21qa-newtab-customize.png`
- `v21qa-newtab-{all-hidden,only-bar,one-main-column,all-side,search-only}.png`
- `v21qa-newtab-bar-nested.png`
- `v21qa-bar-fixed-header.png`, `v21qa-bar-bookmark-short-window.png`
- `v21qa-bookmarks-saved-current-tab.png`
