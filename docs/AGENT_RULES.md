# Rules for every Tabspace agent

Project: `<repo root>` — a Manifest V3 Chrome extension (React 18 + TS + Vite 7 + Tailwind v4 + lucide-react + Vitest 4 + Playwright).

Read first: `docs/ARCHITECTURE.md`, `src/types/models.ts`, `src/storage/{schema,store}.ts`, `src/hooks/useStore.ts`,
`src/components/ui/index.tsx`, `src/components/layout/*`, `src/utils/*`, `src/app/router.ts`, `src/styles/global.css`.

1. Edit ONLY the files you own (listed in your brief). Shared files (`src/types/models.ts`, `src/storage/schema.ts`,
   `src/components/ui/index.tsx`, `src/utils/*`) accept small ADDITIVE edits via the Edit tool only (never rewrite them) —
   list every such edit in your final report. Other agents are editing other files in this same folder right now.
2. Never fabricate: no fake data shown as real, no buttons that do nothing, never show "Connected" unless auth succeeded,
   never invent statistics. If something can't work (e.g. no Chrome API in the dev server), show an honest message.
3. Design: black & white deep-space theme. Use the UI primitives and tokens (bg-surface, border-line, text-muted,
   `ts-card`, `ts-active`…). Rounded cards, thin borders, silver hover, generous spacing. No bright accent colours except
   website favicons, calendar source colours and critical status. Minimal — fewer, more useful controls. Every icon-only
   control needs an accessible label (IconButton requires `label`). Keyboard accessible. Destructive actions use `useConfirm()`.
4. Use `PageHero` for page titles. The right utility sidebar exists ONLY
   on the Home Dashboard; other pages may have a contextual details panel for their own content.
5. Data goes through `src/storage/store.ts` (`insert/patch/remove/update/get`) and `useStore`. Stable IDs, timestamps.
   Validate URLs with `src/utils/url.ts`; only http(s) links are opened/stored.
6. Chrome APIs: guard with `typeof chrome !== 'undefined' && chrome.tabs` etc. so pages still render in the Vite dev server
   and in jsdom tests. Verify API behaviour against current Chrome docs (MV3, Chrome 116+). Minimal permissions — current
   manifest: storage, unlimitedStorage, tabs, tabGroups, sidePanel, alarms, notifications, favicon, identity,
   declarativeNetRequest; optional: bookmarks + optional host permissions https/http. Ask the lead (in your report) before
   needing more.
7. Demo/example content must never be school/class/Canvas/academic. Use examples like "Finish AI automation script",
   "Push Tabspace to GitHub", "Review job applications", "Edit YouTube Short", "Research Roblox mechanics", "Go for a run".
8. Write Vitest unit tests for your business logic in `tests/unit/<area>/*.test.ts(x)` (jsdom; `tests/setup.ts` gives each
   test a fresh in-memory store). Meaningful tests, not coverage padding. Put pure logic in `src/features/<area>/` so it is testable.
9. Before finishing run: `npx tsc --noEmit` (fix errors in YOUR files; ignore other agents' in-progress files),
   `npx eslint <your dirs>`, `npx vitest run tests/unit/<your area>`. Do NOT run `vite build` (the lead integrates builds)
   and do NOT git commit. Do not run `npm install` — ask in your report if you need a dependency.
10. Optional visual check: `npx vite --port <your port> --strictPort` serves `/dashboard.html`, `/sidepanel.html`, `/newtab.html`,
    `/popup.html` (store falls back to localStorage; Chrome APIs absent). You may screenshot with a small Playwright script
    in your own temp dir. Stop your server when done.
11. Final report (concise): files created/changed, features implemented, tests run + pass/fail counts, shared-file edits,
    known gaps/limitations, anything the lead must wire up. Be honest — do not claim untested things work.
