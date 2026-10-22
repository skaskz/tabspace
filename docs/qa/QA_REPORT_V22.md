# Tabspace V2.2: workspaces as native tab groups (independent QA by Agent 5)

- **Build:** HEAD `04edfe9`, built into a separate folder (`npx vite build --outDir <scratchpad>/dist-qa`). `dist/` was not touched.
- **Browser:** Playwright's bundled Chromium 156.0.8078.4, running headless.
- **Run:**
  ```
  TABSPACE_DIST=<dir> npx playwright test v22-qa-groups --output=<separate-results-dir>
  ```
- **Spec:** `tests/e2e/v22-qa-groups.spec.ts`, which uses the `qa21.ts` harness. That harness now also accepts extra Chromium flags (`args`), used here for `--restore-last-session`.
- **Result:** 16 tests, all green. Two of them are expected failures marked `test.fail`: BUG-WG1 and BUG-WG2.
- **Data safety:** saved tabs are checked in storage after every step.
- **Lint / types:** ESLint and `tsc` report no problems in the new files.

## Bugs

| ID | Sev | Summary |
| --- | --- | --- |
| BUG-WG1 | **P1** | One of the user's own groups gets taken over by a workspace if it has the same name as that workspace's (closed) group. The user's private tabs are then added to the workspace's saved tabs. |
| BUG-WG2 | **P2** | Double-clicking "Open … as a tab group" on the Workspaces page creates two identical groups (6 tabs). |
| OBS-1 | P3 | After the user ungroups a workspace's whole group, reopening the workspace opens all of its tabs again next to the ungrouped copies. |
| OBS-2 | info | Dragging a single tab out of a workspace group, even just to read it on its own, removes that page from the workspace's saved tabs. This is how the feature is designed, but it is easy to do by accident. |

### BUG-WG1: a user's group named like a workspace is taken over (P1)

**Steps**
1. Open the workspace "Development" as a tab group.
2. Close the group's tabs. The link is now marked closed, which is correct.
3. Create your own group (or rename an existing one) called "Development", containing your own tab.
4. Add another of your own tabs, `…?private-user-tab`, to that group.

**Expected**
- Your own group is never linked to the workspace.
- Nothing is added to the workspace's saved tabs.

**Actual**
- The workspace link now points at your group: `groupId === mine, open:true`.
- The private tab is now in "Development"'s saved tabs.
- Reopening "Development" would add the saved tabs into your group, and "collapse others" would now collapse it.

**Cause**
- `relinkWorkspaceGroups()` runs on every `tabGroups.onCreated` and `tabGroups.onUpdated` event, not only after a restart.
- Its second pass re-links any link that isn't currently open (`pending`) to any live group with the same title, using `chooseGroupForWorkspace` (best match by title and URL overlap; zero overlap is still accepted).

**Fix idea**
- Only re-link by title right after a restart, and only for links that were open when Chrome closed.
- Require at least one tab URL in common with the saved tabs.
- Never re-link a link that was closed in the current session (record `closedAt`, or mark it closed by the user).

**Test:** `BUG-WG1`.

### BUG-WG2: double-click creates two groups (P2)

**Steps:** On the Workspaces page, double-click "Open Development as a tab group".

**Expected:** one group with 3 tabs.

**Actual:** two "Development" groups with 3 tabs each. The workspace link points at only one of them; the other is an orphan.

**Cause**
- In `sessionActions.tsx`, `useRestore().open` has no guard against a second click while the first is still running.
- `openWorkspaceAsGroup()` itself is not serialised either: both calls see "no live group" and both create one.
- The New Tab / dashboard compact widget already has an `opening` guard, and passed the same test.

**Fix:** serialise the open per workspace inside `openWorkspaceAsGroup` (for example with a Web Lock keyed by workspace ID), so every entry point is covered. Also disable the button while the open is in progress.

**Test:** `BUG-WG2`.

## Verified working (storage checked after each step)

### Opening workspaces
- 3 workspaces were opened from 3 different places: the Workspaces page, the New Tab, and the side panel. Result:
  - 3 groups with the right titles and 3 different colours (red, yellow, green);
  - each group has 3 tabs, and the groups appear in the order they were opened.
- Each workspace was then reopened from a different place: the side panel, the Tabspace Bar's Workspaces menu on the New Tab, and the Workspaces page. Still exactly 3 groups of 3 tabs, with no duplicates.

### Reopening an open workspace
- **After closing one of its tabs:** only that tab is added back. Closing the tab did not remove it from the saved tabs.
- **After collapsing the group:** the group expands again, a tab in the group becomes active, and nothing is duplicated.
- **From a dashboard in another window:** the existing group is reused, not duplicated. Headless Chromium can't show whether the browser window actually came to the front, so that part is noted rather than asserted.

### "Collapse other workspace groups"
- **On:** opening or switching to a workspace collapses only the other *workspace* groups. The user's own group stays expanded.
- **Off:** nothing collapses.

### Keeping groups and saved tabs in sync
- **Tab moved from workspace A's group to workspace B's:** removed from A's saved tabs and added to B's.
- **Tab ungrouped:** removed from that workspace's saved tabs.
- **Loose web tab grouped into a workspace group:** added to its saved tabs.
- **Blank tab added to a group, then navigated to a page:** added once the page loads.
- No duplicate saved tabs anywhere, and the third workspace was untouched.

### Actions that must not lose saved tabs
None of these removed any saved tabs. Each one marked the link closed, and reopening afterwards creates a fresh group of 3:
- ungrouping the whole group;
- closing the group;
- moving the group into its own window and closing that window.

### Dragging a whole group to another window
- The group keeps its ID, and the link records the new window.
- Reopening the workspace reuses that group instead of creating a second one.

### Renaming and colours
- **Rename in Tabspace:** the group title updates live.
- **Colour changed in Tabspace:** the group's colour changes.
- **Colour changed in Chrome:** remembered by Tabspace.
- **Group renamed in Chrome:** still linked, and reopening reuses it rather than creating a new group.

### Deleting a workspace
- Its tabs stay open, ungrouped.
- Its saved session is kept, just no longer assigned to a workspace.
- The link is removed.

### The user's own groups
- An unrelated user group created while a workspace group was open is never linked, renamed or recoloured.
- The exception is BUG-WG1, which only happens once the workspace's own group has been closed.

### Restarting Chrome
- **With `--restore-last-session`:** both restored groups (Chromium gives them new IDs) are re-linked by title. Reopening a workspace does not duplicate it, and saved tabs are intact.
- **Without restoring:** links are marked closed. Two new groups made by the user are not taken over. Opening the workspace creates a fresh group.
- I suspected Chrome might reuse old group or window IDs after a restart and cause stale links to grab new groups. It doesn't: the IDs are large and not reused.

### Edge cases
- **Workspace with no saved tabs:** no Open button is offered.
- **Mix of page types:** non-web pages (`chrome://`, `file://`) are skipped, and the message says "2 skipped (not web pages)". A pinned saved tab opens inside the group, and the stored saved tabs (including the pinned flag and the skipped URLs) are left exactly as they were.
- **50 saved tabs:** one group of 50 tabs in saved order, opened in about 1.35 s, with the saved list unchanged.

### Other features
- **Rapid double-click on the New Tab's Open button:** one group (it has a guard).
- **Tab groups turned off in settings:** workspaces open in a new window as before, with no group and no link.
- **Tab Manager:** lists the workspace group as a filter, and filtering shows only that group's tabs.

## Not automated (manual steps)

1. **Real mouse dragging in Chrome's tab strip:** drag a tab between workspace groups, drag a whole group to another window, and click a group header to collapse or expand it. I used the equivalent `chrome.tabs` / `chrome.tabGroups` API calls.
2. **Ctrl+T inside a group:** Chrome itself places the new tab in the group. Check it is added once it loads a web page.
3. **Real "Continue where you left off" in branded Chrome** with several windows.
4. **Whether the target window actually comes to the front** when reopening a group that lives in another window.

## Screenshots

In `docs/qa/screenshots/`:
- `v22qa-workspaces-groups-open.png`
- `v22qa-tab-manager-groups.png`
