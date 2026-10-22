# Tabspace V2 — UX, Accessibility & Performance Review

Reviewer: Agent 7. Build reviewed: `HEAD a9f0298`, built with `vite build` into a private temp `outDir` and loaded unpacked into Playwright Chromium (headless, Windows 11 laptop). Example data loaded, user name set to "Alex". Screenshots are in `docs/reviews/screenshots-v2/`.

Scripts (all in `tests/visual/`; run with `TS_DIST=<build> node tests/visual/<script>`):

- `v2-shots.mjs` captures every surface and state, plus scroll and truncation checks (`_layout-report.json`).
- `v2-motion-a11y-perf.mjs` covers motion, parallax, popup timing, New Tab load, keyboard paths and the accessibility scan (`_v2-report.json`).
- `v2-focus-check.mjs` checks focus visibility using keyboard only.

All times come from headless Chromium. Treat them as relative numbers; a real toolbar popup adds browser chrome overhead.

**Overall:** V2 is a clear step up.

- The motion system is consistent and never blocks interaction.
- Parallax costs nothing while the mouse is still.
- Contrast and accessible names are clean on every surface.
- The chrome figure is gone with no leftover gaps.

The remaining issues are mostly about consistency and polish, plus a load-time and bundle regression on New Tab and the dashboard.

---

## Prioritised fixes

No P1 issues were found. The v1 P1s (virtualisation, figure overlap, input focus, faint contrast) are resolved or no longer reproduce.

| # | Sev | Finding (with numbers) | Fix | Evidence |
|---|---|---|---|---|
| 1 | **P2** | **The New Tab doesn't show "Session complete".** After a session ends, the popup, Focus page and side panel all show "Session complete" with Start short break / Start again. The New Tab Focus widget still shows "25:00 · Focus on what matters." The dashboard widget is the same shared component. | Feed `completionState()` into the shared Focus widget (`SidebarWidgets` FocusMini): show "Session complete" with a "Start break" primary button for the same window the other surfaces use. | `newtab-complete-1366x768.png` vs `popup-complete.png`, `focus-complete-1536.png` |
| 2 | **P2** | **The New Tab bundle and request count grew.** The entry preloads **336 KB** (it was 232 KB in v1), including **55 KB of CSS** and Spotify `auth` + `SpotifyParts` (22 KB) even when Spotify isn't configured. A cold load fetches **32 JS files / 45 requests**, about 15 of them 0.1–0.3 KB lucide icon chunks. First content: **108 ms** (46 ms in v1); DOM settled at 101 ms; FCP 72 ms. | Lazy-load the Spotify widget (`React.lazy` when `spotifyClientId` is set; otherwise render the static "not set up" line). Add `build.rollupOptions.output.manualChunks` to put `lucide-react` icons in one chunk. Consider putting shared dashboard widgets in a dedicated `widgets` chunk. | `_v2-report.json` → `newtabBundle`, `newtabLoad` |
| 3 | **P2** | **The dashboard loads slower than v1.** Time to first `main h1` is **214 ms** (61 ms in v1, same machine and method), LCP **356 ms**, 40 JS files / 60 requests. Part of this is the `.ts-page-in` rise (200 ms from opacity 0) running on the *initial* load as well as on route changes, which pushes LCP back. | Skip `ts-page-in` on first mount (only animate when `page` changes after the first render). Apply the chunking from #2. | `_v2-report.json` → `dashboardLoad` |
| 4 | **P2** | **The New Tab only just fits at 1366×768.** It fits, but with 28 px to spare: the Upcoming Events column ends at y=740. A 5th upcoming event, a 5th workspace or a two-line event title will make it scroll. Column bottoms are ragged (632 / 741 / 636 px). At 1920×1080 everything sits in the top 70% with about 340 px of empty starfield below. | Hard-cap counts tied to height (`upcoming ≤ 3` when `innerHeight < 860`, workspaces ≤ 4), or make the middle column `grid-rows-[auto_1fr]` with Upcoming `overflow-hidden` + "See all". Centre the widget grid vertically with `min-h-[calc(100vh-…)] content-center` at ≥ 1000 px tall. | `newtab-1366x768.png`, `newtab-1920x1080.png`; 1280×720 already scrolls by 39 px and 1024×768 by 428 px |
| 5 | **P2** | **Quick Links tiles truncate on New Tab** at every size up to 1440: "ChatG…", "YouTu…", "Googl…" (and "Google …" at 1920). A 4-column grid of 54 px tiles is too narrow for the labels. | Use 3 columns (as on the dashboard), or drop the labels and put the name in a tooltip/`aria-label`. Monogram-only tiles at 40 px read cleaner. | `_layout-report.json` trunc lists |
| 6 | **P2** | **Removing a saved tab drops keyboard focus and has no undo.** After pressing "Remove MDN Web Docs from saved tabs", focus lands on `<body>`. There is no confirm and no undo toast (`undo` count 0). | After removal, focus the next row's remove button (or the previous one, or the list). Show a toast "Removed MDN Web Docs · Undo" (5 s), consistent with other destructive actions. | `_v2-report.json` → `keyboard.afterRemove` |
| 7 | **P2** | **Popup grouping.** "Open Dashboard" sits under the "QUICK NOTES" heading. The sidebar controls ("Sidebar is ready · Open Sidebar · Disable Sidebar") are three low-affordance text links. | Put the heading only above "New Note". Give "Open Dashboard" its own row, or an icon in the header next to the logo. Merge the sidebar controls into one toggle row ("Sidebar  [Open]"), with Disable behind it in Settings. | `popup-idle.png` |
| 8 | **P2** | **The Focus Playlist card moves between states.** Not configured: a one-line "Connect Spotify ›" row at the *top* of the right column. Client ID set: a full card at the *bottom* ("Spotify is not connected · Connect Spotify"). The dashboard shows a third variant ("Connect Spotify" pill button, about 100 px tall), which pushes Quick Links below the fold (the dashboard scrolls 1,222 px vs 1,202 px). | Use one compact row for every not-connected state, in one fixed position: the last card on Focus, and below Quick Links on the dashboard. | `focus-complete-1536.png`, `spotify-configured-focus-1536.png`, `spotify-configured-dashboard-1536.png` |
| 9 | **P3** | **Transition timings are mixed.** On the dashboard, 41 elements use the design system's `180ms cubic-bezier(0.2,0.8,0.2,1)` and **45 elements use Tailwind's default `150ms cubic-bezier(0.4,0,0.2,1)`** (`transition-colors` on nav, header and icon buttons). | Remap Tailwind's defaults in `@theme` (`--default-transition-duration: 180ms; --default-transition-timing-function: var(--ts-ease)`) so every hover uses the same curve. | `_v2-report.json` → `transitionInventory` |
| 10 | **P3** | **Hover lift scales cards** (`translateY(-2px) scale(1.005)`, 17 `.ts-lift` cards on the dashboard). Scaling text-bearing cards by 0.5% causes subpixel text shimmer during the 180 ms transition. | Drop the `scale(1.005)` and keep the 2 px rise and shadow. No layout shift was measured (CLS 0). | `lift` in report |
| 11 | **P3** | **Twinkle stars keep about 0.6% idle CPU.** Idle CPU is 0.85% on New Tab with parallax on *and* 0.86% with parallax off. 8 `ts-twinkle` CSS animations run forever, against 0.22% under reduced motion. | Pause twinkles while `document.hidden`, and consider 4 instead of 8, or `animation-play-state: paused` once the page has been idle for 30 s. | `parallax.*.idle` |
| 12 | **P3** | **Save-window picker opens focused on the × Close button.** Keyboard users must tab past the mode toggle, Select all and Select none to reach the tabs. | Put `data-autofocus` on the first enabled tab checkbox, or on the primary "Save N tabs" button. | `keyboard.pickerFocusOnOpen` |
| 13 | **P3** | **Weak focus indicators on two text fields.** The Quick Note textarea has `outline: none` and focus only switches the border to `--ts-line-strong` (about 1.85:1). Input rings are `ring-fg/35`, about 3:1, which only just passes 1.4.11. | Use `ring-fg/50` for inputs. The Quick Note textarea is auto-focused and the only field, so a 1 px `--ts-fg/40` border on focus is enough. | `focus-input-keyboard.png`, `v2-focus-check` output |
| 14 | **P3** | **Popup layout shifts on open:** CLS 0.004–**0.036** across 7 opens. The "Focus" kind chip and the sidebar row (`div.mt-1 -ml-2 flex flex-wrap`) appear after async state resolves. | Reserve the row heights (`min-h`) or render a skeleton with the final dimensions. | `popup.median.cls` |
| 15 | **P3** | **Smaller polish items:** | | |

Item 15, smaller polish items:

- The popup's completed state shows a big "00:00". A check icon with "Session complete" as the large text would read better.
- Workspace detail Tasks show ISO dates ("2026-10-21"). Use the shared relative formatter ("Today", "Tomorrow").
- Workspace detail offers both "Save current window…" (header) and "Update from window…" (panel), and both open the same picker. Keep one.
- The same header-band sparkle sits at about (962,78) on every dashboard route. Seed flare positions per route, or drop the header zone.
- In light theme, starfield sparkles are still grey smudges on New Tab (`newtab-light-1366x768.png`).
- The disabled "about:blank — can't be saved" row in the picker is 2.29:1. That's exempt as disabled text, but at 11 px it is hard to read. Use `--ts-faint` without extra opacity.

---

## What was verified as working

### Motion system

- **Modal enter:** 240 ms (opacity 0 → 0.69 at 46 ms → 1 at 234 ms), scale 0.96 → 1. Focus is in the first field from frame 0, and typing *during* the enter animation works ("Zz" landed).
- **Modal exit:** about 190 ms. The overlay is `inert` + `aria-hidden` while closing, and **focus returns to the trigger immediately** on Escape, not after the animation.
- **Click-through during exit:** clicking the trigger 40 ms into the exit reopens the dialog. Exit animations never block input.
- **Menus:** 150 ms in and out. `End` now jumps to "Delete", and Escape returns focus to "Actions for …" (fixed since v1). The menu stays in the DOM for about 150 ms during exit with `pointer-events: none`.
- **Page transitions:** one `ts-rise` of 200 ms per route change. No nested or double animations under `.ts-page-in`, and **CLS 0** on 4 route changes.
- **Hover lift:** CLS 0.
- **Reduced motion** (OS or in-app): parallax and twinkles are off, and there are no running animations.

### Parallax starfield

- **Still mouse:** 0 rAF per second, 0.85% CPU (twinkles only).
- **Moving mouse** (120 moves in 3.25 s): rAF at display rate, **0.06 ms script per frame**, 10 layouts in total, no long tasks. Layers move with `translate3d` (−1.3 / −3.8 / −8.9 px for far / mid / near).
- **After the pointer stops**, the loop settles back to 0 rAF within 1.5 s.
- **Off when expected:** the setting off, the in-app reduced-motion toggle and the OS reduced-motion setting all leave layer transforms empty and run no rAF.
- **Backing stores:** 3 canvases of 1398×800 at DPR 1. On a 2× display the near layer doubles, about 18 MB of GPU memory in total. Acceptable.

### Chrome figure removal

PageHero no longer has a reserved gap. Titles are top-aligned and action rows align with the subtitle on Workspaces, Notes, Tasks and Bookmarks. Nothing overlaps.

### Workspace saved-tab editor

- "Move GitHub down" via Enter reorders the list (1 G, 2 D, 3 D → 1 D, 2 G, 3 D). **Focus stays on the moved row's button.**
- A live region announces "Moved GitHub to position 2 of 3".
- Mouse drag and drop reorders correctly.
- The first row's ↑ and the last row's ↓ are disabled.
- The drag handle isn't keyboard-operable, which is fine because the move buttons cover it.

### Save-window picker

- It uses `role="checkbox"` with `aria-checked`. Space toggles, the count updates ("1 of 2 selected") and the primary button label follows ("Save 1 tab").
- Escape returns focus to "Save current window…".
- Non-web tabs are listed but disabled, with a reason.

### Popup

- **Open to interactive:** **49 ms** to an enabled Start button and 48 ms to FCP (median of 7). The `#note` mode is **51 ms** to a focused textarea (median of 5). 66 DOM nodes, about 11 JS files, 245 KB preload.
- **Keyboard:** the Tab order is logical (Start → Open Focus Mode → New Note → Open Dashboard → Open Sidebar → Disable Sidebar). Enter on New Note opens the editor with the textarea focused.
- **Quick Note:** autosaves (the status shows "Saved") and the note persists to `ts.notes`.

### Accessibility scan

- 0 unnamed controls and 0 unlabeled fields on all 11 routes, New Tab, side panel, popup (both modes), workspace detail and picker.
- One H1 each and no heading skips.
- **0 text nodes under 4.5:1** on every surface: `--ts-faint` is now `#8e8e93`. The only exception is the disabled picker row in #15.

### New Tab load

- No long tasks.
- CLS 0.002–0.020: `div.grid` and cards settle at about 108 ms.
- JS heap 7.5 MB, 380 DOM nodes.

## Key metrics

| Metric | V2 | V1 |
|---|---|---|
| New Tab first content / FCP / DOM settled | 108 / 72 / 101 ms | 46 / 76 / — ms |
| New Tab preload (entry HTML) | 336 KB | 232 KB |
| New Tab requests, cold | 45 (32 JS) | — |
| Dashboard first H1 / LCP | 214 / 356 ms | 61 / 52 ms |
| Dashboard / popup / side panel preload | 257 / 245 / 292 KB | 240 / 236 / 261 KB |
| Popup open → interactive | 49 ms | — |
| Quick Note open → focused | 51 ms | — |
| Parallax: idle rAF / script per frame while moving | 0 / 0.06 ms | n/a |
| Idle CPU, New Tab (parallax on / off / reduced motion) | 0.85 / 0.86 / 0.22 % | 2.1 % |
| Modal enter / exit | 240 / about 190 ms; focus restored at t=0 | — |
| CLS on route change / hover lift | 0 / 0 | — |
| Largest chunks | Analytics 408 KB (recharts, lazy), shared vendor `focus-*.js` 160 KB, calendarSync 90 KB | — |
| Text nodes under 4.5:1 | 0 | 1–16 per page |

## Screenshots

- Pages: `{page}-{1536,1280}.png` for all 11 routes.
- New Tab: `newtab-{1366x768,1280x800,1440x900,1536x1024,1920x1080,1280x720,1024x768}.png`, `newtab-running-1366x768.png`, `newtab-complete-1366x768.png`, `newtab-parallax-moved-1366x768.png`, `newtab-light-1366x768.png`.
- Popup: `popup-{idle,running,paused,complete,quicknote,light,after-note-keyboard}.png`.
- Workspaces: `workspace-detail-{1536,1280}.png`, `workspace-save-picker-1536.png`, `workspace-editor-after-keyboard.png`.
- Focus: `focus-{running,complete}-1536.png`, `focus-pill-tasks-1536.png`, `sidepanel-complete-360.png`.
- Spotify: `spotify-configured-{dashboard,focus,newtab}*.png`, `spotify-fake-token-*.png`.
  - A fake token still renders "not connected", so the real *connected* player could not be exercised without a Spotify account and is **not verified**.
- Focus visibility: `focus-input-keyboard.png`, `focus-picker-keyboard.png`.
