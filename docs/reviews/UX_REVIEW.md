# Tabspace — UX, Accessibility & Performance Review

Reviewer: Agent 7 (UX / a11y / perf). Build reviewed: a fresh `vite build` of the current `src/` into a private temp dir, loaded unpacked into Playwright Chromium (headless, `channel: 'chromium'`). Example data loaded through the dashboard welcome card; user name set to "Alex".

Viewports: 1536×1024 and 1280×800 (all 11 dashboard routes), side panel 360 px and 320 px, popup 320 px, New Tab at both desktop sizes, plus the dashboard and Tasks in light theme.

Scripts (re-runnable, `TS_DIST=<unpacked build dir> node tests/visual/<script>`):

- `tests/visual/ux-shots.mjs` takes the screenshots and writes a layout/overflow/truncation report (`screenshots/_layout-report.json`).
- `tests/visual/ux-a11y.mjs` runs a manual audit: accessible names, labels, heading order, contrast scan, keyboard, reduced motion (`_a11y-report.json`).
- `tests/visual/ux-perf.mjs` and `ux-perf-followup.mjs` measure load, memory, starfield CPU, 200 tabs and large data (`_perf-report.json`, `_perf-followup.json`).
- `tests/visual/ux-figure-overlap.mjs` checks the decorative figure's bounding box against hero controls.

axe-core is not installed, so every accessibility check here was done by hand with Playwright.

---

## Top 15 fixes (prioritised)

| # | Sev | Fix | Where | Evidence |
|---|-----|-----|-------|----------|
| 1 | **P1** | **Virtualise or paginate the Bookmarks list.** It renders every row. With 2,000 bookmarks: **42,896 DOM nodes**, **811 ms** to render, a **275 ms** long task, and up to **288 ms** per keystroke in "Search links" (9 events over 50 ms). Render a window of about 60 rows (or "Show more" in pages of 100), wrap the filter in `useDeferredValue`, and `memo` the row. Do the same for Tasks (9.8k nodes; one completion click costs **143 ms**) and the Notes list (8.5k nodes). | `src/pages/bookmarks/BookmarksPage.tsx` (row list), `src/pages/tasks/TasksPage.tsx`, `src/pages/notes/NotesPage.tsx` | `perf-bookmarks-2000.png`, `perf-tasks-1000.png`, `_perf-report.json` |
| 2 | **P1** | **The decorative figure overlaps controls.** On Bookmarks it covers "Import from Chrome" (**183×38 px** overlap at 1536, 106×38 at 1920). On Workspaces it covers "Search workspaces" (98×38). The figure is `absolute right-[22%]` whatever is in the actions slot. Render it as an in-flow flex item placed before `actions` (`order` / `ml-auto`, `self-start`), or skip it when the hero has more than one action. The spec says the figure must never obstruct content. | `src/components/layout/PageHero.tsx` | `bookmarks-1536.png`, `workspaces-1536.png` |
| 3 | **P1** | **Form controls have no visible keyboard focus.** `Input`, `Textarea` and `Select` use `outline-none focus:border-line-strong`, so focus only moves the border from 1.19:1 to 1.85:1 against the background. Measured on Notes search: `outline: none`, no box-shadow. This fails WCAG 2.4.7 and 1.4.11. Add `focus-visible:ring-2 focus-visible:ring-[var(--ts-fg)]/70 focus-visible:ring-offset-0`, or drop `outline-none` so the global `:focus-visible` outline applies. The same applies to the SearchPalette input, the NoteEditor tag input (`outline-none focus:bg-surface-2`) and the dashboard "Add a new task" input. | `src/components/ui/index.tsx` L173/L187/L199, `src/pages/notes/NoteEditor.tsx` L183, `SearchPalette.tsx` | `a11y-input-focus-notes.png` |
| 4 | **P1** | **`--ts-faint` fails AA for body text.** `#6e6e73` measures **4.02:1** on `#050505`, **3.85** on `ts-card`, **3.57** on surface-2 and **3.08** on surface-3. It is used at 10.5–13 px for URLs, calendar weekday headers, table headers, timestamps, stat captions, the top-bar search label and every placeholder (**3.54–3.85:1**). Between 1 and 16 failing text nodes per page. Change it to **`#8e8e93`** (6.25 bg / 5.98 card / 4.79 surface-3) and keep a separate token for disabled states. | `src/styles/global.css` `--ts-faint` | `_a11y-report.json` → `lowContrast` |
| 5 | **P2** | **Menu keyboard behaviour.** Escape closes the menu but focus drops to `<body>` instead of returning to the "…" trigger. `End`/`Home` do nothing. Keep a trigger ref, call `.focus()` on Escape and after an item is chosen, and add Home/End. The "Move to Someday" item wraps to two lines, so set a `min-w-[200px]` menu. | `src/components/ui/index.tsx` `Menu` (L436–L500) | `a11y-menu-keyboard.png` |
| 6 | **P2** | **Dashboard at 1280 px truncates almost everything.** Quick actions wrap "Open Workspace" onto two lines, and the subtitles become "Restore sav…", "Save this wi…", "Capture a t…". Workspace meta and "Content Crea…" truncate. Saved Links folder names truncate **even at 1536** ("Develop…", "Content …", "Job Sear…") while half the row is empty. Hide quick-action subtitles below 1440 px, show 2 workspace cards per row below 1440, and lay Saved Links out as `grid-cols-[repeat(auto-fill,minmax(180px,1fr))]` with no fixed chip width. | `src/pages/dashboard/QuickActions.tsx`, `MainWidgets.tsx` | `dashboard-1280.png`, `dashboard-1536.png` |
| 7 | **P2** | **Flares from the starfield show through cards, in the same seeded positions on every page.** They sit at about (578,375), (720,572), (1428,314) and (1490,518), so they cross task rows, the New Tab clock's "6", calendar cells and the Add-task bar. This reads as a rendering glitch. Place flares only in the outer gutters (x < 240 or x > w−120, plus the area outside the New Tab clock), and raise `--ts-surface` alpha from 0.82 to about 0.92. | `src/components/layout/Starfield.tsx` (`flares`), `global.css` | `tasks-1536.png`, `newtab-1536.png`, `calendar-1280.png` |
| 8 | **P2** | **The focus pill shifts the layout.** When a session starts or stops, the header grows from about 60 px to 76 px and every page jumps 16 px (H1 moves from y=147 to y=163), because the pill is about 56 px tall and the search bar is 44 px. Make `FocusIndicator` `h-11` with a single line ("◷ 24:59 ‖ ■"). Its "Focus Mode" label is redundant. | `src/components/layout/FocusIndicator.tsx` | `focus-pill-active-1536.png` vs `tasks-1536.png` |
| 9 | **P2** | **Every site shows the same globe icon.** All Quick Links, New Tab shortcuts, bookmarks, blocklist rows and most open tabs show one identical globe, which looks like placeholder UI. `_favicon` only knows sites this profile has visited. Fall back to a monogram tile (the first letter of the hostname on surface-3), and cache `favIconUrl` from `chrome.tabs` when a tab has one. | `src/components/ui/index.tsx` `Favicon` | `dashboard-1536.png`, `newtab-1536.png`, `bookmarks-1536.png` |
| 10 | **P2** | **The Focus page is cluttered.** It has nine cards (timer, Spotify instructions, blocker, four stat cards, goals, Focus Settings, Daily Motivation) and runs to more than two screens. Focus Settings duplicates Settings → Focus. When Spotify isn't configured, its card spends prime space on setup text. Remove Focus Settings (link to Settings instead), merge the four stats into one strip inside the timer card, and collapse Playlist into a one-line "Connect Spotify →" row until it is configured. | `src/pages/focus/FocusPage.tsx` | `focus-1536.png` |
| 11 | **P2** | **Notes list repeats titles.** Every snippet repeats the title ("Roblox game ideas / Roblox game ideas") because the excerpt takes the first line, including `# H1`. Strip a leading heading that equals the title (and markdown syntax). Also, the editor pane is a 700 px empty card until a note is chosen, so select the most recent note by default. | `src/features/notes/notes.ts` (excerpt), `NotesPage.tsx` | `notes-1536.png` |
| 12 | **P2** | **Calendar at 1280 px.** Month chips truncate to "Co…" and "Jo…", so events can't be identified. The Calendars panel takes 270 px for one checkbox. Below 1440 px, drop the time prefix on chips (keep it in the tooltip), allow `line-clamp-2`, and move CalendarsPanel into a "Calendars" popover button in the toolbar. | `src/pages/calendar/views.tsx`, `CalendarsPanel.tsx` | `calendar-1280.png` |
| 13 | **P2** | **Tab Manager toolbar density.** Three stacked control rows sit above the table: the Open/Saved toggle; Group/Save/Close plus a hint; then the All Tabs chip, search and two selects. "Save to Workspace" is enabled while Group and Close are disabled under the hint "Select tabs to…", which is inconsistent. The title and Group columns are separated by about 700 px of empty space. Use one toolbar row (segmented control, search, filters), show bulk actions in a selection bar only when the selection is non-empty, and make the group column `auto` next to the title. | `src/pages/tabs/TabsPage.tsx`, `TabRow.tsx` | `tabs-1536.png`, `perf-tabs-200.png` |
| 14 | **P2** | **Light theme.** The white chrome figure almost disappears on `#f4f4f5`. Starfield flares render as grey smudges. Card borders are 1.22:1. In light mode, hide the figure or use a darker gradient, render the starfield at `density≈0.4` with no flares or streaks, and set `--ts-line` to `rgba(0,0,0,.14)`. | `ChromeRider.tsx`, `Starfield.tsx`, `global.css [data-theme=light]` | `dashboard-light-1536.png` |
| 15 | **P2** | **Analytics "Workspace activity" is misleading.** The bars are full-width for "0 opens · 0 tasks · 2 notes", the copy has plural bugs ("1 notes", "1 tasks"), and its task counts disagree with the dashboard (Development shows 0 tasks here, 3 on the dashboard, because Analytics counts tasks completed in the period without saying so). Label the metric ("tasks completed this week"), pluralise properly, and scale bars on a stated metric. "Weekly trend" has two unlabeled y-axes (4h and 4), so add axis titles or drop the right axis. | `src/pages/analytics/AnalyticsPage.tsx`, `src/features/analytics/aggregate.ts` | `analytics-1536.png` |

---

## Key metrics

All numbers are medians of 5 runs on a cold page, headless Chromium on this Windows 11 laptop. Times are from navigation start.

| Surface | DCL | FCP | First H1 / first card | Wall (goto → H1) |
|---|---|---|---|---|
| Dashboard | 27 ms | 52 ms | 61 ms | 93 ms |
| Tasks | 29 ms | 56 ms | 54 ms | 82 ms |
| Analytics (recharts chunk) | 32 ms | 60 ms | 77 ms | 117 ms |
| New Tab | 37 ms | 76 ms | 46 ms | 81 ms |
| Side panel | 36 ms | 56 ms | 51 ms | 71 ms |

No long tasks occurred during load with example data.

**Bundles** (`dist/assets`, 1.06 MB JS+CSS total):

| Chunk | Raw | Gzip | Loaded by |
|---|---|---|---|
| `AnalyticsPage-*.js` (recharts) | **397 KB** | 110 KB | Analytics route only (lazy) |
| `useNow-*.js` (React, ReactDOM and shared vendor) | 156 KB | 51 KB | every surface |
| `calendarSync-*.js` (ical.js) | 83 KB | 26 KB | Calendar route, **and statically by `background.js`** |
| `useNow-*.css` | 47 KB | 9.6 KB | every surface |
| `CalendarPage` / `SettingsPage` / `TabsPage` | 34 / 33 / 32 KB | about 11 KB each | lazy |

Up-front JS+CSS per entry HTML: dashboard 240 KB, New Tab 232 KB, side panel 261 KB (20 preloaded files), popup 236 KB.

**Memory and idle CPU** (CDP `Performance.getMetrics`, 5 s idle):

| Page | JS heap | DOM nodes | Idle CPU |
|---|---|---|---|
| Dashboard, starfield on | 7.2 MB | 660 | **2.0 %** |
| Dashboard, starfield off | 5.4 MB | 665 | 0.1 % |
| Dashboard, reduced motion | 6.9 MB | — | 0.1 % |
| Tasks / New Tab / side panel, starfield on | 11.0 / 6.8 / 6.5 MB | — | 1.7 / 2.1 / 1.5 % |

**Starfield.** The rAF loop fires every frame (headless measured **167 callbacks/s**; expect about 60/s on a real display) but redraws only every 120 ms (about 8 fps). That costs about 5 ms of script per second, all of it from the starfield. With reduced motion (OS media query or the in-app toggle) the animation stops: rAF calls 0, canvas unchanged over 2 s. The hidden-tab test was inconclusive because headless kept `visibilityState: "visible"`. The code does cancel rAF on `visibilitychange`.

**200 open tabs (Tab Manager):**

- Render: 180 ms, 204 rows, 5,921 DOM nodes.
- Typing 6 characters in Search: 106 ms total.
- Select-all: 47 ms.
- One 61 ms long task. Acceptable.

**Large data** (2,000 bookmarks + 1,000 notes + 1,000 tasks; `chrome.storage.local` 3.35 MB):

| Page | Render | DOM nodes | Long tasks | Typing (median / max key → frame) | Heap |
|---|---|---|---|---|---|
| Dashboard | 79 ms | 532 | — | palette search 30 / 45 ms | 22 MB |
| **Bookmarks** | **811 ms** | **42,896** | 275, 72 ms | search 36 / **283 ms** (event max 288 ms) | **72 MB** |
| Notes | 170 ms | 8,562 | 83 ms | list search 19 / 42 ms; editor 12 / 17 ms (6 / 21 ms with small data) | 51 MB |
| Tasks | 229 ms | 9,836 | 59 ms | search 12 / 40 ms; complete click 143 ms | 63 MB |
| Analytics | 133 ms | 448 | — | — | 61 MB |
| Calendar | 89 ms | 608 | — | — | 70 MB |
| Side panel | 60 ms | 94–142 per section | — | section switch 27–49 ms (lists capped, "+1000 more") | — |

---

## Accessibility summary

**What passes:**

- **0** buttons, links or tabs without an accessible name and **0** unlabeled form fields on all 11 routes, the side panel (every section), the popup and New Tab. Icon buttons all have `aria-label`.
- Exactly one H1 per route and no heading-level skips, except the two cases listed below.
- The skip link is the first Tab stop and the nav order is logical. Nav links and buttons show a 2 px outline ring.
- Search palette: Ctrl+K opens it with focus in the input. Tab stays in the dialog. It uses `combobox`/`listbox`/`option` roles with `aria-activedescendant`. Escape closes it and focus returns to the element focused before.
- Modal ("New workspace"): focus moves to the first field, Tab and Shift+Tab are trapped (0 escapes in 20 presses), Escape closes it and focus returns to the trigger.
- Tasks: Space on the round "Complete …" button completes the task. Its accessible name is `Complete "Finish AI automation script"`.
- Reduced motion: the global CSS kills animations, and the starfield stops for both `prefers-reduced-motion` and the in-app toggle.

**What fails:**

- **Input focus visibility** (Top 15 #3).
- **`--ts-faint` contrast** (Top 15 #4).
- **Menu focus return** (Top 15 #5).
- **P3: route changes don't move focus.** After pressing Enter on a nav link, focus stays on the nav link and `document.title` updates. Screen-reader users get no "page changed" cue. Fix: in `App.tsx`, on route change focus `#main`, or the H1 with `tabIndex=-1`. A polite live region announcing the page title also works.
- **P3: the Chrome Sidebar settings page has two H1s.** The live preview embeds the side panel's `<h1>Focus</h1>`. Give `SidePanel` a `headingLevel` prop, or render the preview with `inert` and `aria-hidden`, since it is a visual preview.
- **P3: the popup has no heading.** Make "Tabspace" an `h1` (it can stay visually unchanged).
- **P3: side panel rail arrow keys.** Arrow navigation starts from the *selected* tab, not the *focused* one. Focusing "Tasks" while "Workspaces" was selected and pressing ArrowDown moved focus to "Focus". The `onRailKey` index should come from `document.activeElement`.
- **P3: the side panel rail tooltip stays visible after a click** and covers list content ("Tasks" over "Push Tabspace to GitHub"). Hide tooltips on `:focus-visible` only, not after a pointer click. See `sidepanel-360-tasks-large.png`.
- **P3: task priority dots** (filled = high/medium, hollow = low) have no text alternative. Add `aria-label`/`title` "High priority".

---

## Per-page findings

### Dashboard (`dashboard-1536.png`, `dashboard-1280.png`, `dashboard-1536-full.png`)

The overall fit with the spec is good: big greeting, muted subtitle, date eyebrow, right utility sidebar present (only here, correct), restrained colour (calendar dots).

- **P2** Truncation at 1280 and Saved Links truncation at 1536. See Top 15 #6.
- **P2** The right sidebar is taller than the viewport at 1024 px: the Quick Links "+" tile is cut off while the main column ends at about 850 px. Consider making the right column `sticky top-4 max-h-[calc(100vh-…)] overflow-auto`, or limiting Quick Links to 6 tiles with "+" in the card header. (`SidebarWidgets.tsx`)
- **P3** Today's Tasks has an empty band of about 60 px between the last task and the input. Use `mt-auto` only when the list has 3 or more items, or let the card shrink.
- **P3** The "1 left" badge is 11 px faint text. Use the `Tag` primitive for consistency with the tab counts elsewhere.
- **P3** Workspace cards show "0 tabs" for every workspace (no saved sessions in the sample). Consider hiding zero counts, which repeat four times.
- **P3** The decorative figure's SVG box (728–978 × 45–215) reaches into the header row. It is not visually colliding today, but it will once the search bar is wider.

### Workspaces (`workspaces-1536.png`, `workspaces-1280.png`)

- **P1** The figure overlaps "Search workspaces" (Top 15 #2).
- **P3** "No saved tabs yet" plus "0 tabs" says the same thing twice per card. Keep one.
- **P3** The card "…" menu and "Save window" are the only actions. "Open" (restore) isn't visible until there is a session, so add a disabled-with-tooltip "Open" for discoverability, or an empty-state line explaining that you save a window first.

### Tabs (`tabs-1536.png`, `tabs-1280.png`, `perf-tabs-200.png`)

- **P2** Toolbar density and inconsistent enabled states (Top 15 #13).
- **P3** `about:blank` and the Tabspace dashboard tab itself are listed. Filter out `about:blank`, or mark the current tab as "This tab" and exclude it from bulk close by default.
- **P3** The full `chrome-extension://…/dashboard.html#/tabs` URL is shown in faint text. Show the host only, or "Tabspace", for extension pages.
- **P3** The "Last active" column reads "just now" for every row after a restart, which is noise. Hide it when all values are equal.

### Calendar (`calendar-1536.png`, `calendar-1280.png`)

- **P2** Chip truncation and panel width at 1280 (Top 15 #12).
- **P3** The H1 is the month ("October 2026") rather than "Calendar". That's acceptable, but the subtitle "Stay organized. Keep track of your schedule, deadlines, and goals." is filler. Use the selected range or the next event instead.
- **P3** The view switcher (Month/Week/Day/Agenda) is four separate pills. Use the `Segmented` primitive so it reads as one control, as on Focus and Analytics.
- **P3** Out-of-month day numbers are faint (3.85:1). This is fixed by Top 15 #4.

### Notes (`notes-1536.png`, `notes-open-1536.png`, `notes-1280.png`, `perf-notes-1000.png`)

- **P2** Snippets repeat titles, and the editor is empty by default (Top 15 #11).
- **P3** There are two "New note" buttons (header and empty state) and a third in the folder header. Keep the header button.
- **P3** The editor meta row starts with an orphan "· Development". Drop the leading separator when it is the first item.
- **P3** Edit/Preview sits in its own row with a divider, which wastes about 50 px. Move it into the title row next to the star and "…".
- **P3** The rendered markdown H1 duplicates the note title directly above it. Hide a leading H1 equal to the title in preview.

### Tasks (`tasks-1536.png`, `tasks-open-1536.png`, `tasks-light-1536.png`, `perf-tasks-1000.png`)

The spec's "especially simple" requirement is met: one list, one input, five filter tabs, and a details panel only on selection. Good.

- **P2** With 1,000 tasks there is no virtualisation, and completing a task costs 143 ms (Top 15 #1).
- **P3** The "New Task" header button duplicates the always-visible "Add a task…" input. Remove it, or make it focus the input.
- **P3** The placeholder 'Add a task… (try "tomorrow", "someday" or "!high" at the end)' is long and faint (3.85:1). Shorten it to "Add a task…" and move the syntax hint to a `title` or a one-time helper below.
- **P3** "Inbox" contains dated tasks as well (5 = everything open). Either rename it "All" or exclude dated items.
- **P3** Priority dots have no text alternative (see Accessibility).

### Bookmarks (`bookmarks-1536.png`, `bookmarks-1280.png`, `perf-bookmarks-2000.png`)

- **P1** The figure overlaps "Import from Chrome" (Top 15 #2).
- **P1** No virtualisation at 2,000 items (Top 15 #1).
- **P2** There are three overlapping filters: folder sidebar, All/Favorites/Recent chips, and a "Recent" sort select. "Recent" appears twice with different meanings. Remove the "Recent" chip (the sort covers it), or move Favorites into the folder sidebar.
- **P2** Every row shows the identical globe (Top 15 #9).
- **P3** "Save current tab", clicked from the dashboard, saves the dashboard tab itself. Have it save the most recent non-extension tab in the window, or label it "Save a tab…" and show a picker.

### Focus Mode (`focus-1536.png`, `focus-1280.png`, `focus-running-1536.png`)

- **P2** Clutter (Top 15 #10).
- **P3** The blocker input placeholder is clipped ("news.ycombinato"). Use the shorter "e.g. news.site.com".
- **P3** Stat captions "Completed and stopped sessions" and "Complete a session to start one" are awkward. Use "Today" and "Start a session to begin a streak".
- **P3** Reset and Stop are rendered disabled at very low contrast when idle. Hide them until a session exists.

### Analytics (`analytics-1536.png`, `analytics-1280.png`)

- **P2** Workspace activity and dual axes (Top 15 #15).
- **P3** Recharts is 397 KB raw / 110 KB gzip for 3 simple charts (bar, line, progress bars). It is lazy-loaded, but a 60-line SVG bar/line component would remove the dependency and halve install size.

### Settings (`settings-1536.png`, `settings-1536-full.png`, `settings-1280.png`)

- **P3** The page is 4,367 px long and the section index ("Appearance … Account & About") has no active-section highlight. Add scroll-spy (`IntersectionObserver`), and make the index `sticky top-4`.
- **P3** "Animations" and "Reduced motion" are two toggles for nearly the same thing (both feed `data-motion='reduced'`). Merge them into one "Motion: Full / Reduced / Follow system" segmented control.
- **P3** At 1536 the content column is about 860 px wide, leaving 300 px of empty space on the right. That's acceptable, but the index column could be wider and sticky.

### Chrome Sidebar settings (`sidebar-1536.png`, `sidebar-1280.png`)

- **P2** The page gutter is inconsistent: content starts at x=278 where every other page starts at x=250 (an extra horizontal padding wrapper). The figure also sits 16 px further left as a result. Remove the extra `px-*` on the page root in `SidebarSettingsPage.tsx`.
- **P3** Two H1s through the embedded preview (see Accessibility).
- **P3** The note "Chrome controls the side panel's width…" is good and honest. Consider moving it under the preview.

### Chrome side panel (`sidepanel-360.png`, `sidepanel-320.png`, `sidepanel-360-focus-running.png`, `sidepanel-360-*-large.png`)

Very close to the spec: a 48 px icon rail, one section at a time, clean and small.

- **P3** Two large flares at about (70,497) and (233,503) dominate the empty lower half of a 360 px panel. Use starfield `density` of about 0.5 and no flares in the side panel.
- **P3** Task dates use the format "10-22", while the dashboard and Tasks page use "Tomorrow"/"Friday". Reuse the shared date formatter.
- **P3** The rail tooltip lingers after a click and overlaps content (see Accessibility).

### Toolbar popup (`popup-320.png`)

- **P3** Both "Open Sidebar" and a disabled "Close Sidebar" are shown. Show one context-dependent toggle ("Open Sidebar" / "Close Sidebar") to cut a row.
- **P3** The "Sidebar is ready" status line is 12 px muted text floating between the cards. Fold it into the toggle's subtitle.
- **P3** No heading (see Accessibility).

### New Tab (`newtab-1536.png`, `newtab-1280.png`, `newtab-focus-running-1536.png`)

Matches the spec well: starfield, huge thin clock, letter-spaced date, rounded search, six tiles, small quote.

- **P2** All shortcut tiles show the same globe (Top 15 #9).
- **P3** A flare crosses the "6" of the clock (Top 15 #7).
- **P3** When a focus session starts, the whole stack shifts up about 35 px (the vertical centring includes the pill). Reserve the pill's height, or position it absolutely under the tiles.
- **P3** The quote attribution ("— TERENCE") is 10.5 px faint uppercase text at 4.02:1. Bump it to 11.5 px muted.

### Light theme (`dashboard-light-1536.png`, `tasks-light-1536.png`)

- **P2** Figure, flares and borders (Top 15 #14). Text tokens pass: fg 18:1, muted 7.0:1, faint 4.4:1 on the background. Faint placeholders are 4.4:1, so darken them slightly to `#6b6b73`.

---

## Performance notes (secondary)

- **P3** The starfield runs `requestAnimationFrame` at the display rate but draws at about 8 fps. Drive it with `setTimeout(loop, 125)`, or rAF scheduled from a timeout, to avoid about 60 wakeups per second. Also pre-render the static layer (streaks, flares and about 92 % of stars) once to an offscreen canvas, and only re-draw the twinkling subset. That would bring idle CPU from about 2 % to well under 1 % on every Tabspace tab, and users keep several open.
- **P3** `background.js` statically imports `calendarSync` (ical.js, 83 KB) and `backup`, so every service-worker wake parses them. MV3 workers can't use `import()`. Consider a separate tiny `reminders` code path that only pulls ical when an ICS sync alarm fires (e.g. a dedicated `importScripts`-free bundle split, or doing ICS sync from the dashboard/offscreen document).
- **P3** The side panel preloads 20 files (261 KB) for an icon rail with one visible section. Lazy-load the non-default sections (`React.lazy` per section).
- The 200-tab Tab Manager is fine as is: 180 ms render, 47 ms select-all.

## Screenshots index

All are in `docs/reviews/screenshots/`:

- `{dashboard,workspaces,tabs,calendar,notes,tasks,bookmarks,focus,analytics,settings,sidebar}-{1536,1280}.png`
- Full-page: `dashboard-1536-full.png`, `tasks-1536-full.png`, `settings-1536-full.png`
- `newtab-{1536,1280}.png`, `sidepanel-{360,320}.png`, `popup-320.png`
- Interactions: `search-palette-1536.png`, `notes-open-1536.png`, `tasks-open-1536.png`
- Focus session running: `focus-pill-active-1536.png`, `focus-running-1536.png`, `sidepanel-360-focus-running.png`, `newtab-focus-running-1536.png`
- Light theme: `dashboard-light-1536.png`, `tasks-light-1536.png`
- Accessibility: `a11y-focus-ring-dashboard.png`, `a11y-skip-link.png`, `a11y-modal-new-workspace.png`, `a11y-input-focus-notes.png`, `a11y-menu-keyboard.png`
- Performance: `perf-tabs-200.png`, `perf-bookmarks-2000.png`, `perf-tasks-1000.png`, `perf-notes-1000.png`, `perf-sidepanel-large.png`, `sidepanel-360-{tasks,notes,bookmarks,workspaces}-large.png`
- Raw data: `_layout-report.json`, `_a11y-report.json`, `_perf-report.json`, `_perf-followup.json`
