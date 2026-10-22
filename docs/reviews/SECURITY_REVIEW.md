# Tabspace security & privacy review

Reviewer: Agent 6 (Security & Privacy). Date: 2026-10-21. Scope: the whole `src/` tree, `public/manifest.json`,
`docs/PRIVACY.md`. The Integrations code (`src/integrations/**`, calendar/settings/analytics pages,
`features/{calendar,data,analytics}`, `services/{backup,sampleData}.ts`, `storage/migrations.ts`,
`background/reminders.ts`) was reviewed again after it landed in commit `e595c10`. The working tree matched that
commit, so nothing was incomplete when it was reviewed.

**Summary:** I found no Critical or High issues. The XSS, URL-scheme, secret-storage and import paths are well
built and held up against hostile test input. The most serious issue is a CPU denial of service in ICS
recurrence expansion (Medium). The rest are hardening items, permission trimming and gaps in the privacy
disclosure.

## Findings

| # | Sev | Location | Issue / impact | Recommended fix |
|---|-----|----------|----------------|-----------------|
| 1 | **Medium** | `src/features/calendar/ics.ts:125,215` | `maxIterations` (20 000) is a per-series limit, and there is no overall budget. A series that starts years before the sync window (for example `DTSTART:1950… RRULE:FREQ=DAILY`) uses up all 20 000 iterations and emits nothing. **Measured: about 377 ms per series**, so a 5 MB hostile or compromised feed would take hours to parse. The hourly sync in the service worker (`reminders.ts:99`) would also stall the alarms, badge and blocking work queued behind it. Imported `.ics` files block the page the same way. | Add a single iteration budget for the whole parse (e.g. 200k) that sets `truncated`. Cap the number of VEVENTs (e.g. 20k). Skip ahead for stale series: when the RRULE has a fixed FREQ/INTERVAL, start the iterator near `windowStart` (or reject series whose first in-window instance is more than N iterations away). |
| 2 | Low | `src/integrations/ics/feed.ts:74` | `res.text()` reads the whole body before the 5 MB check. When there is no `Content-Length` (chunked response), a malicious host can stream an unbounded body into memory. | Read with `res.body.getReader()` and abort once the byte count passes `ICS_MAX_BYTES`. |
| 3 | Low | `src/features/calendar/ics.ts:55` (`normalizeFeedUrl`) | `http://` feeds are accepted, so the private feed token travels in clear text. `redirect: 'follow'` (`feed.ts:64`) can also follow https→http. | Accept only `https:`, or show a clear warning for `http:`. Use `redirect: 'follow'` and then check that `res.url` is https (or use `redirect: 'error'` when the origin changes). |
| 4 | Low / Info | `feed.ts`, `manifest.json:52` | SSRF-style access. The user can subscribe to `http://localhost`, `192.168.x.x` and similar, and the extension fetches them with a host grant. Risk is low: each origin needs an explicit Chrome permission prompt, no cookies are sent (`credentials:'omit'`), and the response is only parsed as ICS. Still, a backup that someone else gives you could carry a `ics-url` source pointing at an intranet host. It only syncs if that origin's permission was already granted. | Reject loopback and private ranges in `normalizeFeedUrl` unless the user confirms. On import, clear `lastSyncedAt` and require "Sync now" (a user gesture plus a permission prompt) for imported `ics-url` sources. |
| 5 | Low | `src/utils/url.ts:47` (`normalizeDomain`) | Malformed hosts pass: `..com`, `a..b.com`, `-foo.com`, `foo-.com`. `updateDynamicRules` is atomic (`background/blocking.ts:203`), so if Chrome rejects one `requestDomains` value, **no** site is blocked and the error is swallowed. I could not confirm in a real browser whether Chrome rejects these. | Validate each label with `/^(?!-)[a-z0-9-]{1,63}(?<!-)$/` and the total length (≤253). Catch the `updateDynamicRules` failure and surface it in Focus settings. |
| 6 | Low | `src/features/data/validate.ts:414` and `:466` | `ts.sampleIds` accepts any keys. With a key named `constructor` or `toString`, `merged[key] ?? []` resolves to an `Object.prototype` member, and Merge import throws a `TypeError`. With `__proto__`, the local object is re-parented. This is **not** global pollution (tested), but a crafted backup can break Merge. | Allow only `STORE_KEYS` as `sampleIds` keys. Build maps with `Object.create(null)` or `Map`. |
| 7 | Low | `src/integrations/spotify/auth.ts:81-100` | Concurrent `getSpotifyToken()` calls both refresh with the same refresh token. If Spotify rotates refresh tokens, the second call gets `invalid_grant`, and line 98 deletes the stored secret even though it is now valid. The user is silently disconnected (reproduced in a test). | Keep one in-flight refresh promise per page. Before deleting on `invalid_grant`, re-read the secret and only delete if the refresh token is unchanged. |
| 8 | Low | `public/manifest.json:48-49` | `identity` and `declarativeNetRequest` are required permissions, yet both serve opt-in features. `declarativeNetRequest` adds the install warning "Block content on any page". Both may be optional permissions. | Move both to `optional_permissions`. Request `identity` on Connect, and `declarativeNetRequest` when Focus → Block sites is turned on (rules can only be set after the grant). |
| 9 | Low | `src/pages/bookmarks/BookmarksPage.tsx:112` | The optional `bookmarks` permission is never released after a one-time import. | Call `chrome.permissions.remove({permissions:['bookmarks']})` after the import, or offer a "revoke" option. |
| 10 | Info | `src/integrations/google/oauth.ts:10,12` | Google uses the implicit token flow (`response_type=token`). With `chrome.identity` and a user-owned Web client this is acceptable, and `state` is generated, verified and tested. `include_granted_scopes=true` can return a token with extra scopes the user granted earlier to the same client. The returned `scope` is not checked. | Drop `include_granted_scopes`, or check that the returned scope is exactly `calendar.readonly`. |
| 11 | Info | `oauth.ts:40`, `pkce.ts:146` | The redirect parsers do not check that the URL starts with `chrome.identity.getRedirectURL()`. `launchWebAuthFlow` only resolves on that URL, so this is defence in depth only. | `if (!redirect.startsWith(chrome.identity.getRedirectURL())) throw`. |
| 12 | Info | `src/extension/background/index.ts:161` | The `onMessage` handler does not check the sender. There are no content scripts and no `externally_connectable`, so only Tabspace's own pages can message the worker. The handler only opens or closes the side panel. No live sender exists either (no `sendMessage` call in `src/`). | Add `if (sender.id !== chrome.runtime.id) return;`, or remove the dead handler. |
| 13 | Info | `NewTab.tsx:80`, `AppShell.tsx:37` | `url(${bg.image})` is unquoted. It is safe today because every path that can set it produces base64 `data:image/(png\|jpeg\|webp)` (upload: `PreferenceSections.tsx:12-23`; import regex: `validate.ts`). | Quote it (`url("${…}")`) and re-check the prefix at render time. |
| 14 | Info | `src/storage/schema.ts` / settings | The background image (up to about 7 MB as base64) is stored inside `ts.settings`. Every settings write, every `storage.onChanged` broadcast to all pages, and each of the 3 snapshots carries it. This is a performance and storage concern, not a vulnerability. | Store it under its own key (e.g. `ts.backgroundImage`). |
| 15 | Info | `CalendarsPanel.tsx:415` | Google `backgroundColor` goes into `style` without validation in the picker preview. React sets a single property, so it cannot break out. Stored colours are validated (line 357). | Use the same `/^#[0-9a-f]{6}$/i` check. |
| 16 | Info | `src/integrations/spotify/auth.ts:107` | Spotify disconnect deletes tokens locally only. Spotify has no revocation API, so the user has to revoke under spotify.com → Apps. | Say this in the Disconnect confirmation. |

### Verified OK (no action)

- **CSP**: `script-src 'self'; object-src 'self'; base-uri 'self'; frame-ancestors 'none'`. There is no `eval` or `new Function` in `src/`. No HTML page loads a remote script. Fonts are bundled (`@fontsource`). There are no `web_accessible_resources`.
- **XSS**: the only `dangerouslySetInnerHTML` uses are the notes preview (`NoteEditor.tsx:118,221`), which goes through `renderMarkdown` (escapes first, emits a fixed set of tags, http(s)-only `href` with `rel=noopener noreferrer`). There is no `innerHTML` anywhere else. A corpus of 50+ payloads plus 400 fuzz cases all stayed inert.
- **URL handling**: every `tabs.create`, `tabs.update`, `window.open`, `location` and `href={…}` sink either uses a constant or extension URL, or is guarded by `isSafeUrl`, `isRestorableUrl` or `normalizeUrl`. This covers sessions, bookmarks, quick links, search, the New Tab search, Spotify `openInSpotifyUrl`, and Chrome bookmark import. `javascript:`, `data:`, `file:`, `chrome:` and others are rejected in tests.
- **Tokens**: they live only under `secret.*` (Google access token in `storage.session`; the local marker holds no token; the Spotify refresh token is in `storage.local`). They are never logged (the only `console.*` calls are 3 generic warnings in the worker and `state.ts`). They are excluded from export and snapshots, ignored on import, and wiped on Disconnect and on Clear all data. Google is revoked by POST body, not URL. Tokens are sent only in `Authorization` headers.
- **"Connected"** appears only after a real authenticated call: Google `listGoogleCalendars` / `verifyGoogle`, Spotify `/me` (on failure the secret is removed).
- **ICS**: fetched directly with no proxy, `credentials:'omit'`, `no-referrer`, a per-origin optional host permission requested in the click handler, HTML rejected, size caps, and error messages that never contain the feed URL. Feed URLs are left out of exports by default.
- **Import**: strict validation (unknown keys rejected, type confusion rejected, string length caps, 100k record cap, 30 MB file cap checked before reading, duplicate IDs rejected). Unsafe URLs are stripped. Colours and the Spotify URI are sanitised. SVG and remote background images are rejected. There is no global prototype pollution (tested with 7 `__proto__`/`constructor` payloads).
- **DNR**: only `block` + `main_frame` rules, IDs limited to [7000, 7500). Rules are removed whenever blocking is off or no focus session is running. Off by default.
- **Usage tracking**: off by default. It records the hostname only (no path, query, credentials or port). Nothing is transmitted. It can be deleted in Settings, and it is pruned after 120 days.
- **No browsing data leaves the device**: the only `fetch` calls in `src/` are in `src/integrations/**` (Google, Spotify, ICS feed host). Favicons come from `chrome-extension://…/_favicon/`.

## Permission audit

| Permission | Used at | Verdict |
|---|---|---|
| storage, unlimitedStorage | store/adapter | Needed |
| tabs | Tab manager, sessions, usage (`tab.url`), blocking explanation | Needed (warning: "Read your browsing history") |
| tabGroups, sidePanel, alarms, notifications, favicon | services/tabs, sidePanel.ts, background/*, ui Favicon | Needed |
| identity | google/client.ts, spotify/auth.ts | **Could be optional** (#8) |
| declarativeNetRequest | background/blocking.ts | **Could be optional** (#8) |
| bookmarks (optional) | BookmarksPage import | OK, but never released (#9) |
| optional_host_permissions `https://*/*`, `http://*/*` | ics/feed.ts (one origin per request, released when the last feed on that origin is removed) | OK. The broad pattern is only a ceiling. Consider dropping `http://*/*` (#3) |

## Privacy doc (docs/PRIVACY.md) vs behaviour: mismatches

1. **Network hosts are incomplete.** The doc lists `www.googleapis.com` for Google. The code also calls `accounts.google.com` (sign-in) and `oauth2.googleapis.com` (token revocation on Disconnect). Spotify album and playlist images load from Spotify's CDN (`i.scdn.co` / `mosaic.scdn.co`) through `<img src>` in `SpotifyPanel.tsx:146`, which is not the listed `api/accounts.spotify.com`.
2. **Website usage is part of exports.** `ts.usage` (domain + minutes per day) and workspace activity are included in JSON exports and in the 3 automatic local snapshots. The doc only says the data stays local and can be deleted. It should say that exports contain it, and that "Delete usage data" does not purge it from existing snapshots (`deleteUsageData` only resets `ts.usage`).
3. **"Stored only when you save a session"**: a *Replace* restore automatically archives the current window's tabs (URLs and titles) as an archived session (`services/sessions.ts`). This is user-initiated but not disclosed.
4. **Token storage detail**: the Spotify refresh token is long-lived in `chrome.storage.local`. The Google access token is session-only. The doc does not say this. Also, "deleted on Disconnect" for Spotify is local deletion only (#16).
5. **ICS**: the doc implies secure direct fetches, but `http://` feeds are allowed (#3). Redirects to other hosts are followed.
6. **CSP line**: the doc quotes `script-src 'self'; object-src 'self'`. The manifest also has `base-uri 'self'; frame-ancestors 'none'`. That is stricter, so it is fine, but the doc is out of date.
7. Otherwise accurate: no telemetry, no server, tracking is opt-in and records domains only, favicons are local, and secrets are never exported.

For Chrome Web Store user-data policy, fix items 1–4 in the privacy policy and in the Store "Privacy practices" form. Declare "Web history" (tabs, opt-in usage) and "Authentication information" (OAuth tokens, stored locally), and state that this data is not transferred.

## Tests written (`tests/security/`)

| File | What it covers |
|---|---|
| `markdown-xss.test.ts` | 50+ XSS payloads, combined documents, 400-case fuzz. Output is parsed with DOMParser: only allowed tags/attrs, http(s) hrefs only, noopener. Also a ReDoS timing check. |
| `url-validation.test.ts` | 23 dangerous schemes against `isSafeUrl`, `normalizeUrl`, `validateLink`, New Tab `asUrl`/`resolveSearch`, `normalizeFeedUrl`, `openUrl`/`openLink` (asserts `chrome.tabs.create` is never called), `usageDomain`, `normalizeDomain`. |
| `import-validation.test.ts` | Malformed and hostile files, type confusion, size and record caps, duplicate IDs, unsafe URL stripping, colour/CSS injection, secrets ignored, settings token smuggling, SVG/remote/CSS-breakout background images, 7 prototype-pollution payloads through validate, merge and apply, deep nesting. |
| `secrets-oauth.test.ts` | Export, snapshots and `buildExport` exclude `secret.*`. Feed URLs are excluded by default. Clear all data wipes both areas. Google: readonly scope, state mismatch stores nothing, never "connected" without a successful API call, token only in the header to googleapis, Disconnect wipes and revokes by POST body. Spotify: S256, verifier matches the challenge, no client secret, a failed `/me` leaves nothing stored, Disconnect. |
| `ics-feed.test.ts` | No proxy, `credentials:'omit'`, no-referrer, webcal→https, dangerous schemes refused before fetch, HTML rejected, Content-Length and body caps, feed URL never in error messages, per-origin permission pattern, inert or capped event text, event cap. Also an informational DoS measurement for #1. |
| `blocking-rules.test.ts` | Rule shape and ID range, a 2000-domain list is capped, wildcard/scheme/garbage entries dropped, reversibility, blocking and tracking off by default, suffix-safe matching. |

**Result (`npx vitest run tests/security`): 6 files, 333 passed, 8 expected-fail.** The expected-fail tests use
`it.fails`. They encode the desired behaviour for findings #3, #5 (4 hosts), #6 (×2) and #7, so the suite stays
green now. When a fix lands, the matching test starts to "unexpectedly pass" and should be changed to `it`.
`npx eslint tests/security` is clean.

## npm audit

- `npm audit --omit=dev`: **0 vulnerabilities**
- `npm audit` (including dev): **0 vulnerabilities**

## Not verified

- I did not run anything in real Chrome. Not checked live: `launchWebAuthFlow` behaviour, whether DNR accepts the malformed `requestDomains` from #5, the permission prompts, and the CSP of the built `dist/` (no build, per the rules). I did not inspect the built bundle for `eval` introduced by dependencies (recharts and ical.js source show none).
- Actual Google and Spotify server behaviour (scope narrowing, refresh-token rotation for #7).
- The e2e suites and the `docs/qa/` work of other agents.
