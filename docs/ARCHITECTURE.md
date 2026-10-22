# Tabspace architecture

Tabspace is a Manifest V3 Chrome extension built with React 18, TypeScript, Vite 7 and Tailwind CSS v4.

## Surfaces

| Surface | Entry | Notes |
| --- | --- | --- |
| Full dashboard (12 pages) | `dashboard.html` → `src/app/App.tsx` | Hash router (`#/tasks?id=…`), lazy-loaded pages |
| Chrome side panel | `sidepanel.html` → `src/extension/sidebar/SidePanel.tsx` | Chrome controls the panel's width/position |
| Toolbar popup | `popup.html` → `src/extension/popup/Popup.tsx` | Open/close/disable/enable sidebar, open dashboard |
| New Tab override | `newtab.html` → `src/extension/newtab/NewTab.tsx` | Calm clock + search + shortcuts |
| Service worker | `src/extension/background/index.ts` → `dist/background.js` | Alarms, badge, notifications, blocking, side panel state |

## Data

* **Models**: `src/types/models.ts` (stable app IDs, `createdAt`/`updatedAt`).
* **Store**: `src/storage/store.ts` — one `chrome.storage.local` key per collection (`src/storage/schema.ts`).
  Per-page cache kept fresh via `chrome.storage.onChanged`, so the sidebar, popup, New Tab and dashboard stay in sync.
  Writes go through a serialised read-modify-write queue (`update`, `insert`, `patch`, `remove`).
* **React**: `useStore(key)` / `useSettings()` from `src/hooks/useStore.ts`.
* **Outside the extension** (Vite dev server, tests) the store falls back to localStorage / memory adapters.
* **Secrets** (OAuth tokens) live under `secret.*` keys, are never exported, and are deleted on disconnect.
* `unlimitedStorage` is requested so large note/bookmark collections are not capped at 10 MB; IndexedDB was not needed.

## Focus timer

The timer state (`ts.focus`) stores an absolute `endAt` timestamp. Every view derives remaining time from it.
The service worker observes `ts.focus` changes and schedules a `chrome.alarms` alarm for the end time plus a
one-minute badge-refresh alarm — there is no long-running interval, so MV3 worker suspension is harmless.
Pure logic lives in `src/features/focus/timer.ts`; actions in `src/services/focus.ts`.

## Design system

* Tokens: `src/styles/global.css` (CSS variables, dark default + light theme, density, text scale, reduced motion).
* Primitives: `src/components/ui/index.tsx` — Button, IconButton, Card, CardHeader, Input, Textarea, Select, Field,
  Toggle, Checkbox, Segmented, Tag, Kbd, Favicon, Modal, `useConfirm()`, Menu, `useToast()`, EmptyState, PageHeader.
* Layout: `src/components/layout/` — AppShell (left nav + top bar + search + focus indicator), PageHero (title block), parallax Starfield, Logo/LogoMark.
* Motion: shared tokens/easing in `global.css` + `components/ui/motion.ts` (`usePresence` for exit animations); `<Card interactive>` / `.ts-lift` hover; reduced motion honoured.
* Rule: the right utility sidebar (calendar, upcoming events, focus, quick links) appears **only** on the Home Dashboard.
  Other pages may show a contextual details/editor panel for their own content.

## Module ownership (multi-agent build)

| Area | Owner | Files |
| --- | --- | --- |
| Foundation, shell, design system, storage, router | Lead | `src/app`, `src/components`, `src/storage`, `src/hooks`, `src/utils`, `src/types` |
| Dashboard, Tasks, Notes, Bookmarks, global search | Frontend agent | `src/pages/{dashboard,tasks,notes,bookmarks}`, `src/features/{tasks,notes,bookmarks,search,quicklinks}`, `src/components/layout/SearchPalette.tsx` |
| Service worker, side panel, popup, New Tab, Focus page, sidebar settings | Extension agent A | `src/extension/**` (except `background/reminders.ts`), `src/pages/{focus,sidebar}`, `src/features/{focus,quotes,blocking,usage}` |
| Workspaces, Tab manager, sessions, smart grouping | Extension agent B | `src/pages/{workspaces,tabs}`, `src/services/{sessions,tabs}.ts`, `src/features/{tabs,workspaces}` |
| Calendar, Google/ICS, Spotify, Analytics, Settings, import/export, migrations, sample data | Integrations agent | `src/pages/{calendar,analytics,settings}`, `src/features/{calendar,analytics,data}`, `src/integrations/**`, `src/services/{backup,sampleData}.ts`, `src/storage/migrations.ts`, `src/extension/background/reminders.ts` |

Shared files (`models.ts`, `schema.ts`, `ui/index.tsx`) accept **additive** edits only.
