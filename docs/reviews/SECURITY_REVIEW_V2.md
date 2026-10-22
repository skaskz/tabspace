# Tabspace V2 security review

Reviewer: Agent 6. Date: 2026-10-21. Scope: `git diff b5fdc57..HEAD` (7 commits, 117 files). I did not edit
`src/` or the manifest, and I did not build or commit.

**Summary:** no Critical, High or Medium findings. Two Low and two Info items. All v1 regression tests now pass;
the former `it.fails` tests were flipped by the fixes.

## Findings

| # | Sev | Location | Issue / impact | Fix |
|---|-----|----------|----------------|-----|
| V2-1 | Low | `src/services/backup.ts` `clearAllData()` | *Clear all data* does not remove the Quick Note pending records (`ts.quicknote.pending.*`), the note recovery records (`ts.notes.unsaved.*`) or the `localStorage` backups (`tabspace-quicknote:*`). Leftovers are merged back into `ts.notes` on the next worker start (`background/index.ts` `recoverNotes()`/`mergeQuickNotes()`) or the next popup / side panel open (`mergeLocalBackups`). Deleted note text can come back. The window is small: records normally exist only for moments. | In `clearAllData`, also remove every `chrome.storage.local` key starting with `PENDING_PREFIX` or `RECOVERY_PREFIX`, plus the `localStorage` keys starting with `LOCAL_BACKUP_PREFIX`. Optionally clear `chrome.storage.session` `ts.session.*` too. |
| V2-2 | Low | `src/extension/popup/quickNote.ts:42-47` together with `src/features/notes/markdown.ts` | `markdownLink` escapes `]` as `\]`, but `renderMarkdown` does not support backslash escapes. A page `<title>` such as `Bank](https://evil.example/phish) [x` becomes, once attached, a clickable link to `evil.example` inside the user's own note. That is attacker-chosen phishing link placement. It is **not XSS**: `safeHref` still allows only http(s), and `javascript:`/`data:` titles and URLs are refused (tested). | Strip or replace `[` `]` in the label (e.g. with `‹ ›`), or teach `renderInline` to honour `\[ \] \\` escapes. |
| V2-3 | Info | `quickNote.ts:74-88` | The `localStorage` backup holds note text in plaintext at rest. This is acceptable: it has the same trust level as `chrome.storage.local`, it is limited to the extension origin, there are no `web_accessible_resources`, and websites cannot read it. Each backup is removed after a confirmed save, or merged and removed on the next popup or side panel open. The gap is V2-1, plus the fact that only the popup and side panel merge (not the dashboard or New Tab), so an orphan can linger until one of them opens. | Fix V2-1. Optionally also call `mergeLocalBackups()` from the dashboard. |
| V2-4 | Info | `src/features/workspaces/savedTabs.ts:83` `mergeSavedTabs` | Incoming tab URLs are not validated. Current callers pass `serializeWindow` output, which already filters to http(s), so nothing can be exploited today. `addSavedTab` validates. | For defence in depth, drop entries where `!isSafeUrl(t.url)` (and unsafe `favIconUrl`). |
| — | Info (carried over) | `public/manifest.json` | `identity` and `declarativeNetRequest` are still required permissions (v1 #8). Fine if this is intentional. The new `offscreen` permission has no install warning and is justified. | — |

## Verified OK

- **Offscreen** (`public/offscreen.html`/`.js`, `background/chime.ts`): one external same-origin script, no inline
  code, no remote resources, so it complies with `script-src 'self'`. There is no `eval`, `fetch` or `innerHTML`.
  The listener requires `sender.id === chrome.runtime.id`, `target:'offscreen'` and `type:'chime'`. Its only effect
  is a WebAudio chime, so even any of Tabspace's own pages triggering it is harmless. Websites and other extensions
  cannot reach it (no content scripts, no `externally_connectable`). The document is created with reason
  `AUDIO_PLAYBACK` only and reused.
- **Commands / openPopup / fallback**: the fallback window always opens the constant
  `chrome.runtime.getURL('popup.html#note')`. The popup's mode is a strict `location.hash === '#note'` comparison
  plus a session flag of fixed value. Nothing from the hash or URL is rendered or parsed. The flag is cleared after
  fallback.
- **popup.html#note in a normal tab**: `frame-ancestors 'none'` is still in the CSP, and the page is not web
  accessible, so websites cannot frame it (clickjacking) or link to it. "Attach this page" uses the last-focused
  normal window's active tab, requires `^https?://`, and refuses the popup's own `chrome-extension:` tab.
- **Bookmark permission flow** (`shared/noteBookmark.ts`): the permission is requested synchronously in the click.
  It is released afterwards unless it was already granted (tested). The bookmark URL is the constant popup URL.
- **Workspace saved tabs**: "Add URL" goes through `normalizeUrl`, and `addSavedTab` rejects non-http(s) URLs and
  favicons. Titles render as React text. Drag and drop uses only internal state (`dragId`): `onDragOver` calls
  `preventDefault` only while one of our own rows is being dragged, so a drop from another site or app is refused
  and its `dataTransfer` is never read.
- **New Tab search and favourite tiles**: tiles are filtered with `isSafeUrl`, and the search box navigates only
  after `isSafeUrl(resolveSearch(...))` (v1 corpus still passes).
- **Spotify V2**: the new scope `user-library-read` is read-only, and it is listed in the Settings setup text.
  Token refresh runs under the Web Lock `tabspace-spotify-refresh` with a single in-flight promise per page; a 401
  forces exactly one refresh, keyed on the stale token. Error mapping never echoes Spotify's free-text `message`
  into the UI; only the `reason` enum is shown, as React text (tested with a token and HTML in the body). Tokens are
  sent only in the `Authorization` header, never in a URL. Device IDs are `encodeURIComponent`-ed (tested against
  parameter injection). The `ts.session.spotify` snapshot (in `chrome.storage.session`) clips every string and keeps
  only https `*.scdn.co`/`*.spotifycdn.com` images; lookalike, `http`, userinfo and `javascript:`/`data:` images are
  dropped (tested). Playlist images are not rendered.
- **Parallax / motion / theme**: no DOM-string sinks, no network, nothing persisted beyond boolean settings. The
  theme script only changes colour keys.
- No `dangerouslySetInnerHTML`, `innerHTML` or `eval` was added anywhere in V2. No new `console.*` call logs a
  token or URL; the chime and bookmark warnings log only error objects.

## PRIVACY.md vs V2 behaviour: mismatches

1. **`offscreen`** is missing from the permissions table. Suggested text: "Play the optional focus-completion
   chime (synthesised locally, no audio files or network)."
2. **`bookmarks` (optional)**: the doc says it is requested only for *Import Chrome bookmarks*. It is now also
   requested to create the **"+ New Note"** bookmark, and then released.
3. **Quick Note** is not disclosed: while typing, note text is also written to the extension's `localStorage` and
   to temporary pending/recovery records in `chrome.storage.local`, all removed once saved. Also state that
   *Clear all data* removes them (after V2-1 is fixed).
4. **Spotify**: the doc does not list the scopes. Add playback state/control, currently playing, private
   playlists, and **saved tracks (Liked Songs, read-only)**. The image CDN line names only `i.scdn.co`; images may
   also come from `mosaic.scdn.co` / `*.spotifycdn.com`. The now-playing snapshot (track and artist names, device
   name and ID) is kept in `chrome.storage.session` (memory, cleared when Chrome closes). It is undisclosed.
5. **Keyboard shortcuts** (`Alt+Shift+O`, `Alt+Shift+N`): there is no privacy impact and no change is needed.

## Tests

New file `tests/security/v2-surfaces.test.ts` (46 tests) covers:
- attach-link corpus (dangerous schemes refused; `)` `]` `\` HTML and markdown in titles/URLs)
- pending-record shape validation and stale-overwrite protection
- quick-note fallback URL and session-flag reset
- bookmark permission request and release
- offscreen HTML CSP check, and `offscreen.js` executed in a VM with forged sender, target and type
- saved-tab URL and favicon validation
- Spotify image allow-list, snapshot clipping, error-message leakage, device-ID encoding and token location

Three `it.fails` tests encode V2-1, V2-2 and V2-4. Each will start failing (unexpected pass) once its fix lands;
change it to `it` then.

`npx vitest run tests/security`: **7 files, 384 passed, 3 expected-fail.** `npx eslint tests/security` is clean.

## npm audit

`npm audit --omit=dev`: 0 vulnerabilities. `npm audit`: 0 vulnerabilities.

## Not verified

Nothing was run in real Chrome: `action.openPopup` behaviour, offscreen document lifetime and audio, and how Chrome
opens the `chrome-extension://` bookmark. I did not inspect the built bundle and did not check live Spotify
behaviour.
