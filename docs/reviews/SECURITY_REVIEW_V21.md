# Tabspace V2.1 (Tabspace Bar) security review

Reviewer: Agent 6. Date: 2026-10-21. Scope: commits `a63767e..a3aca03`. The lead's base `5c2a1e7` does not exist
in this repo, so I reviewed the last 4 feature commits.

Files covered:
- `public/bar-content.js`, `bar.html`, `src/extension/bar/**`, `entries/bar.tsx`
- worker registration and `tsbar:whoami`, `shared/messages.ts`, `TabspaceBarSettings.tsx`
- manifest, `features/bookmarks/{BookmarkPageDialog,BookmarkPagePopover,currentTab}`

I did not edit `src/` or the manifest and did not commit. For live checks I built into my own scratch outDir (not
`dist/`) and probed it in Playwright's Chromium (details under "Live probe").

**Summary:** no Critical or High findings. The page cannot read Tabspace data, cannot forge messages, and cannot
frame any page except `bar.html`. Two real issues: the permission release on disable is often skipped (V21-1), and
the bar can be clickjacked by the page it sits on (V21-2). The main residual risk is structural: with the website
bar on, a content script runs on every site (V21-3).

## Live probe (Chromium + this build)

I used a test copy whose manifest made `scripting` and host access required, so the content script could register
without a permission prompt. A local `http://127.0.0.1` "attacker" page then tried the following:

| Probe | Result |
|---|---|
| Website frames `dashboard.html`, `popup.html`, `newtab.html`, `sidepanel.html`, `offscreen.html` | **Blocked** ("blocked by Chromium") despite `frame-ancestors 'self' https: http:`. Non-WAR pages stay unframeable. |
| Website frames `chrome-extension://<static-id>/bar.html` | **Blocked** (`use_dynamic_url` works) |
| Website frames `chrome-extension://<dynamic-guid>/bar.html` | **Loads and is fully functional**: bookmarks shown, *Bookmark this page*, *Workspaces*. This holds with the website bar **off**, and even in the normal build with no optional grants. The attacker cannot read it (cross-origin). |
| Page learns the dynamic GUID | **Not found by any vector tried.** `performance` resource entries: none. `window.frames.length`: 0. `host.shadowRoot`: null (closed). `frames[0].location`: TypeError. The GUID changes every browser session. |
| Page navigates the bar frame (spoofing) | Not possible (no WindowProxy exposed) |
| Page CSS `tabspace-bar{opacity:0!important}` | **Works.** The bar becomes invisible but stays clickable at z-index 2147483647 (V21-2) |
| Page detects Tabspace | **Yes, trivially**: a `<tabspace-bar>` element plus `html{margin-top:34px}` (V21-4) |

## Findings

| # | Sev | Location | Issue / impact | Fix |
|---|-----|----------|----------------|-----|
| V21-1 | **Low–Medium** | `src/pages/sidebar/TabspaceBarSettings.tsx:28-35,47` | `heldBefore` is computed when the settings page mounts. If the bar was enabled during an earlier visit to that page, its own `scripting` + `https://*/*` + `http://*/*` grant counts as "held before", so turning the bar off **never releases it**. The extension keeps "Read and change all your data on all websites" with no feature using it. The content script is unregistered correctly. A secondary effect: while that grant is held, `hasFeedPermission()` is true for every ICS host, so any `ics-url` source (including one from an imported backup) syncs without the per-origin prompt. Reproduced in a test. | Persist the decision when granting, e.g. `settings.tabspaceBar.grantedByTabspace = !alreadyHeld` (or a `ts.session`/local flag), and release when it is true. Also release from the worker if `onWebsites` is false and that flag is set. **Unverified:** whether `permissions.remove({origins:['https://*/*']})` also drops narrower ICS grants such as `https://cal.example/*` in Chrome. Check it, and re-request ICS origins on the next "Sync now" if it does. |
| V21-2 | Low | `public/bar-content.js:68,74` with `src/extension/bar/*` | **Clickjacking by the host page.** The page can make the real bar invisible (`opacity:0`, `filter`, `clip-path`, or covering it with its own element) while it keeps receiving clicks, then place decoy content under the 34 px strip, or under the 440 px expanded menu. A user can be tricked into: *Bookmark this page* (adds the attacker page to their bookmarks), *Open workspace* (opens many tabs), *Hide on this site*, or opening a bookmark. No data is exposed. The same tricks work on a directly framed `bar.html` if the dynamic URL ever leaks. | In `bar.html`, gate state-changing actions (bookmark save, workspace open, hide site) on **IntersectionObserver v2** (`trackVisibility:true, delay:100`, require `isVisible`). Chrome computes that from ancestor opacity, filters, transforms and occlusion. Cheap extra hardening: pin the host's `opacity:1;visibility:visible;filter:none;clip-path:none;transform:none` with `!important` inline, and re-apply on `MutationObserver` changes to the host's attributes. |
| V21-3 | Low (defence in depth; highest residual risk) | `bar-content.js:90-93`, `src/integrations/spotify/auth.ts` (`secret.spotify` in `storage.local`) | With the website bar on, a Tabspace content script runs in **every** http(s) renderer. Chrome exposes `chrome.storage.local` to content-script contexts, and only `storage.session` can be restricted with `setAccessLevel`. A site that achieves a renderer compromise could therefore read *all* Tabspace data, including the **Spotify refresh token**, notes and bookmarks. Today's page JS cannot do this (isolated world). This is new in V2.1: before it, no Tabspace code ran in web renderers. | (a) Keep long-lived secrets out of `storage.local`: store the Spotify refresh token in the extension's IndexedDB, which content scripts cannot reach, or encrypt it with a non-extractable key kept there. (b) Let the content script ask the worker "show on this host?" instead of reading `ts.settings`. That keeps settings (including the up-to-7 MB background image) out of every page's process and avoids broadcasting each settings change to every tab. |
| V21-4 | Low / Info | `bar-content.js:67`, CSP | **Fingerprinting.** Any site can detect "Tabspace with website bar on" (a `<tabspace-bar>` element, a 34 px `margin-top` on `<html>`) and can infer per-site hiding. `use_dynamic_url` correctly stops probing through a static URL. With the bar off, nothing is exposed. Detection is inherent to an injected UI. | Optionally use a random custom-element name per page and apply the page shift on `body` with a less distinctive method. Disclose it in PRIVACY.md (below). |
| V21-5 | Low | `public/manifest.json` CSP `frame-ancestors 'self' https: http:` | The relaxed directive applies to **all** extension pages. Chrome's WAR enforcement still blocks websites from loading the other pages (verified), so the only exposure is `bar.html`. Defence in depth is lost: any future WAR entry, or a WAR bypass bug, would make dashboard, popup and similar pages framable. As noted, a `<meta>` CSP cannot set `frame-ancestors`, and MV3 has only one `extension_pages` policy, so no per-page header is possible. | Keep WAR limited to `bar.html` (guard test added). In `bar.html`, refuse to render unless embedded by our own content script: the content script puts a random nonce in the iframe URL hash and answers `tsbar:verify(nonce)` over `tabs.sendMessage(frameId 0)`. The bar also requires `location.ancestorOrigins.length === 1` and that `ancestorOrigins[0]` equals the origin of `tab.url`. A site framing the dynamic URL itself then sees an empty frame. In the other pages, add a cheap `if (window.top !== window) document.body.replaceChildren()` guard (dashboard, popup, sidepanel, newtab). |
| V21-6 | Info | `bar.html` is web-accessible even when the bar is off | Combined with V21-2 and V21-5, an attacker who learns the GUID can use the bar UI while the feature is disabled. | The V21-5 handshake covers this. Alternatively, render nothing unless `settings.tabspaceBar.onWebsites` is true, or when loaded from the New Tab surface. |

## Verified OK

- **Content script:** runs in the isolated world, top frame only (`window.top !== window` guard plus `allFrames:false`), and loads once. It inserts one host with a **closed** shadow root holding only an extension iframe. It has no `innerHTML`, `eval`, `postMessage` or `message` listener and reads no page data. The page cannot reach the frame (no `frames[]` entry, cross-origin). `all:initial` and z-index max are applied, but see V21-2.
- **Size messages:** accepted only from `sender.id === chrome.runtime.id`, with `type` and `mode` from an allow-list and exactly 2 keys. The bar sends them with `chrome.tabs.sendMessage(tabId, …, {frameId:0})`. Web pages cannot use `chrome.runtime` messaging toward an extension without `externally_connectable` (absent), so they cannot spoof size or resize messages. Tested with forged sender, extra keys, wrong mode, non-object.
- **Worker `tsbar:whoami`:** requires our extension ID, `sender.url` matching `chrome-extension://…/bar.html`, and `sender.tab`. It returns only that tab's id, url and title to the bar frame itself. Content scripts have the page URL as `sender.url`, so they cannot pass.
- **Registration:** `registerContentScripts` happens only when `onWebsites === true` **and** `permissions.contains(scripting + http(s))`. It registers our own file only, `matches` limited to http(s), no MAIN world, no CSS, and unregisters on disable or revoke. The request is made synchronously in the click, and a denial saves nothing (tested). No host access is held by default (manifest guard test).
- **Bar links:** `openBarLink` and `barItems`/`folderContents` are http(s)-only (tested). Same-tab navigation uses `tabs.update(tabId)` on the bar's own tab. *Bookmark this page* goes through `saveBookmarkPage`, which calls `isSafeUrl`, and titles render as React text. Workspace open uses the existing `openWorkspace`, which validates every URL at restore. `currentTab.ts` ranks only http(s) tabs and excludes Tabspace's own tab.
- `npm audit --omit=dev`: 0 vulnerabilities. `npm audit`: 0 vulnerabilities.

## PRIVACY.md text for the lead (accurate to current behaviour)

> **Tabspace Bar on websites (optional, off by default).** When you turn it on, Chrome asks for the `scripting`
> permission and access to all http(s) sites. Tabspace then adds a small script to web pages that inserts a
> 34 px bar. The bar is an isolated Tabspace frame: websites cannot read your bookmarks or workspaces, and nothing
> about the page is recorded or sent anywhere. The script reads only the site's hostname, to honour *Hide on this
> site*, and your bar settings. The bar does make it possible for a website to tell that a Tabspace bar is present.
> Turning the website bar off removes the script [and returns the site-access permission — after V21-1 is fixed].
> The bar's page (`bar.html`) is the only Tabspace page websites can load, and only through a per-session random
> address.

Add `scripting` (optional) and the broad host access to the Permissions table, with the reason "Tabspace Bar on
websites". Note that while it is granted, ICS feeds no longer need a per-host prompt.

## Tests

New file `tests/security/v21-bar.test.tsx` (25 tests) covers:
- **Manifest guard rails:** WAR is `bar.html` only, `use_dynamic_url`, http(s) matches; CSP keeps script/object/base-uri; `frame-ancestors` never allows `*` or other extensions; `scripting` and hosts stay optional; no static content scripts or `externally_connectable`.
- **`bar-content.js` run in jsdom:** closed shadow root, no light-DOM iframe, off-by-default, hidden-site and subdomain handling, no run in sub-frames, forged or malformed messages ignored, margin restored on unmount.
- **Registration rules.**
- **Settings permission request/release,** rendering the real `TabspaceBarSettings`.
- **Link and URL logic:** `openBarLink`, bar items, `siteKey`, `isBarModeMessage`.

Two `it.fails` tests encode V21-1 and V21-2 (host style pinning). Change them to `it` once fixed.

`npx vitest run tests/security`: **8 files, 410 passed, 2 expected-fail.** The V2 expected-fails now pass, so those
fixes have landed. `npx eslint tests/security` is clean, and `tsc` reports no errors in `tests/security`.

The probe scripts (Playwright, not part of the suite) are in the reviewer scratchpad (`probe/probe.mjs`,
`probe/probe2.mjs`).

## Not verified

- Real Chrome (rather than Playwright's Chromium) and the optional-permission prompts. My probe made the
  permissions required.
- How `permissions.remove` of `https://*/*` interacts with narrower ICS grants.
- Whether `setAccessLevel` might be extended to `storage.local` in future Chrome versions.
- GUID leak vectors beyond those listed: extensions with `tabs`/`webNavigation` can see it, which is out of scope.
