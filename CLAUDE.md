# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Vicu** — a task management desktop app for Windows, macOS, and Linux (AppImage), powered by [Vikunja](https://vikunja.io/) as the backend. Built with Electron + React + TypeScript + Tailwind CSS.

## Commands

```bash
npm install            # Install dependencies
npm run dev            # Start dev mode (electron-vite dev, opens app with HMR + DevTools)
npm run build          # Production build (cleans out/, then electron-vite build)
npm run start          # Preview production build (electron-vite preview)
npm run typecheck      # tsc --noEmit for the node, web and vite tsconfigs (must exit 0)
npm test               # Run all tests once (vitest run)
npm run test:watch     # vitest in watch mode
npm run verify         # typecheck + tests + build; run before every commit
npm run dist           # Build + package Windows installer (electron-builder)
npm run dist:publish   # Build + package + upload to GitHub release (used by CI)
npm run dist:mac       # Build + package macOS DMG
npm run dist:linux     # Build + package Linux AppImage (x64 + arm64 per builder config)
```

Tests use vitest (`vitest.config.ts`) and live in `__tests__/` folders next to the code they cover (`src/main`, `src/shared`, `src/renderer`). No linter is configured. Typecheck is clean, so any `typecheck` failure is real.

Run the app against a throwaway profile with `VICU_USER_DATA_DIR=<dir>` (config, `auth.json`, queues and caches live in that folder; it also skips changing the real login items). Use it for manual and packaged-build tests instead of touching your own profile.

## CI/CD

GitHub Actions workflow at `.github/workflows/release.yml` triggers on tag pushes matching `v*`:

- **create-release**: decides stable or pre-release from the tag alone (a plain `vX.Y.Z` is stable; any suffix such as `v1.9.0-beta.1` is a pre-release, nothing is hardcoded per version) and creates the draft release up front, with notes taken from `docs/releases/<tag>.md` in the repository (generated notes when that file is missing).
- **Windows** NSIS x64 (`build-windows`, `windows-latest`, `npm run dist:publish`)
- **macOS** DMG arm64 (`build-macos`, `macos-latest`, `npm run dist:mac:publish`)
- **Linux** AppImage x64 + arm64 (`build-linux` matrix — `ubuntu-latest` for x64, `ubuntu-24.04-arm` for arm64, `npm run dist:linux:publish`)
- **publish-release**: once all builds succeeded, flips the draft to published (stable tags become "Latest", others are marked pre-release).

Each build job runs `npm run typecheck` and `npm test` before packaging, then uploads into the draft with `electron-builder --publish always`. Windows builds are unsigned. macOS signs and notarizes only when the `BUILD_CERTIFICATE_BASE64` and `APPLE_*` secrets exist; without them the DMG is unsigned.

**Do NOT manually create releases or attach build artifacts** — CI handles everything. `create-release` makes the draft first so the three build jobs do not race to create it; a release made by hand will have no assets.

**Release workflow**: bump the version in `package.json` and `package-lock.json`, write `docs/releases/vX.Y.Z.md` (plain, user-facing, grouped, no emojis), commit, then push a `v*` tag. CI creates the release, builds the installers, and publishes it. After CI completes, edit the release notes with `gh release edit` if needed.

**Packaging**: `resources/` and `extensions/` ship once, as `extraResources` next to `app.asar` (not also inside it). Main-process code reads them through `process.resourcesPath` when packaged (`resources/` ends up at `<resources>/resources/`: tray icons, `done.mp3`, `get-browser-url.ps1`, the browser bridge) and from `app.getAppPath()` in dev; add new runtime files the same way. Quick check of a packaged build: `npx electron-builder --dir --win -c.directories.output=<dir>` (no signing, no publish), then run it with `VICU_USER_DATA_DIR`.

## Architecture

### Three-process Electron model

| Process | Entry | Role |
|---------|-------|------|
| **Main** | `src/main/index.ts` | App lifecycle, system tray, global shortcuts, window management, Vikunja HTTP client via `net.request()`, config/cache I/O |
| **Preload** | `src/preload/index.ts` | Context bridge exposing `window.api` with typed IPC wrappers. Separate preloads for quick-entry and quick-view windows |
| **Renderer** | `src/renderer/` | React SPA (sandboxed, context-isolated). Uses TanStack Router (hash history) and TanStack Query |

### Three windows

1. **Main window** — full app with sidebar + content area, frameless with custom `WindowControls`
2. **Quick Entry** (`src/renderer/quick-entry/`) — global hotkey popup for fast task creation, always-on-top, transparent
3. **Quick View** (`src/renderer/quick-view/`) — global hotkey popup showing filtered task list, always-on-top, transparent

Quick Entry/View windows have their own preload scripts, HTML entry points, and renderers configured in `electron.vite.config.ts`.

### Shared code (`src/shared/`)

Pure modules used by both main and renderer (the renderer re-exports several through `src/renderer/lib/`, e.g. `export * from '../../shared/due-dates'`). Most are import-free or only import siblings so every tsconfig can include them; keep them free of Electron and DOM code. Rules live here once, never in two copies:

- `due-dates.ts` — due-date rules: a date without a time is stored as local 23:59:59 (`dateOnlyDue(localDate)`, used by every place that sets a due date), legacy local 00:00 reads as date-only, local-day boundaries, the Overdue/Today/Upcoming buckets, and the `due_window` server clause.
- `custom-list-filter.ts` — the one custom-list evaluator (date windows, `include_overdue`, server-filter superset) used by the main window and Quick View; `custom-list-sort.ts` — custom-list ordering, the same as Android.
- `routines.ts` — routine carrier and archive envelopes, merge, 400-day pruning and archive-write planning, CSV. History older than the window lives in hidden done "archive part" tasks (`vicu-routine:archive:v1`) and is read on demand.
- `merge-patches.ts` — the merge-patch builders (see Vikunja API below).
- `config-types.ts` (config shapes), `error-classify.ts` (retriable and queueable failures), `offline-queue-types.ts` (queue types that cross IPC), `nested-subtasks.ts`.

### Cross-app contract with Vicu Android

Desktop and Android must read synced data the same way. `docs/cross-app-semantics-v1.md` is the contract (due dates, days and weeks, custom lists including `include_overdue`, project review status, quick-add parsing, routine history and archive); `docs/description-format-v1.md` covers task descriptions and `shared-parser-spec.md` the parser syntax. The fixtures in `test-fixtures/` (`cross-app-semantics-v1.json`, `nlp-corpus-v1.json`, `routine-archive-v1.json`, `custom-list-sync-v1.json`, `description-format-v1.json`, `design-tokens-v1.json`) are byte-identical in the `vicu-android` repo and both test suites load them; the date suites run under `TZ` Pacific/Auckland and America/New_York to catch UTC assumptions. To change a rule, change the doc and the fixture first, in both repos, in the same release; the fixture wins over prose. Never edit a fixture in one repo only.

`docs/design-system-v1.md` is the design-system contract (colour roles and contrast, label chips, priority marks, motion, haptics) with its values in `test-fixtures/design-tokens-v1.json`; `docs/cross-app-semantics-v1.md` also pins the completion hold and the date display strings. `src/shared/__tests__/sibling-contract-identity.test.ts` compares all shared fixtures and docs with a `vicu-android` checkout next to this repo (skipped when absent).

### Data flow: Renderer → Main → Vikunja

All API calls go through IPC: renderer calls `window.api.someMethod()` → preload forwards via `ipcRenderer.invoke()` → main process handler in `src/main/ipc-handlers.ts` → `src/main/api-client.ts` makes HTTP request using Electron's `net.request()`.

API responses use a discriminated union: `{ success: true, data: T } | { success: false, error: string }`.

### Web security

- `src/main/web-security.ts` (registered in `index.ts` before any window exists) guards every WebContents: `will-navigate`/`will-redirect` only allow the app's own pages (dev server origin, or files under `out/renderer`), http/https/mailto/obsidian links open in the system handler, `setWindowOpenHandler` denies all new windows, `<webview>` is denied. The OIDC sign-in windows (`AUTH_WINDOW_PARTITION`) are exempt because they follow the identity provider. URL decisions are pure functions in `web-security-policy.ts`.
- Register IPC handlers with `handleTrusted()` from `src/main/secure-ipc.ts`, never `ipcMain.handle` directly (a test enforces this). It rejects calls whose sender frame is not a top-level app page (main window, Quick Entry, Quick View).
- Preload callbacks (`ipcRenderer.on`) must pass only the payload to page code, never the `IpcRendererEvent`.
- Attachments opened from the server go to `<temp>/vicu-attachments` (cleaned at startup and quit). Executable, script, shortcut and macro extensions are revealed with `shell.showItemInFolder` instead of opened (`attachment-safety.ts`). Binary downloads are capped at 100 MB.

### Vikunja API

Vicu uses Vikunja API v2. List responses are unwrapped from their pagination envelopes in `src/main/api-client.ts` (collections are paginated fully in main, `paginate.ts`), and task and project updates are JSON Merge Patch (`application/merge-patch+json`).

**Send only the fields that changed.** Build every task or project update body with `taskPatch(original, edited)` / `projectPatch(original, edited)` from `src/shared/merge-patches.ts` (the same builders feed queued offline actions). They keep only writable fields (`TASK_WRITABLE_FIELDS`, `PROJECT_WRITABLE_FIELDS`), drop read-only ones and unknown keys (a project tree node's `children` is a 422), and use `null` to clear a value (`due_date: null`). Do not send a whole cached task or project: it reverts what another device changed since the cache was filled. A completion is `{ done: true }` and nothing else. `position` is per view and not writable on a task; `PUT /tasks/{id}/position` sets it (`useReorderTask`, `lib/reorder-positions.ts`: `planMove` for tasks, `planSiblingMove` for projects; when neighbours share a position there is no midpoint, so the siblings are renumbered one step apart).

### Renderer architecture

- **Router**: `src/renderer/router.tsx` — TanStack Router with hash history (required for `file://` in Electron). Root layout is `AppShell`.
- **Views**: `src/renderer/views/` — one per route: Inbox, Today, Upcoming, Anytime, Logbook, Project, Tag, CustomList, Search, Review, Routines, Settings, Setup, Reauth.
- **State**: Zustand stores in `src/renderer/stores/` — sidebar, selection, reorder, UI, offline queue counts, toasts, the current day.
- **Data fetching**: TanStack Query hooks in `src/renderer/hooks/` — `use-tasks`, `use-projects`, `use-labels`, `use-task-mutations`, etc. Mutations use optimistic updates with rollback.
- **API layer**: `src/renderer/lib/api.ts` wraps `window.api` calls with proper TypeScript types from `vikunja-types.ts`.
- **Drag & drop**: `@dnd-kit` for task reordering, moving tasks between projects, applying labels via drag-to-sidebar, project reordering, and custom list reordering. Collision detection in `AppShell.tsx`; where a drop lands is decided by `lib/reorder-positions.ts`.
- **Quick-add parser**: `src/renderer/lib/task-parser/` is the one parser (new-task composer, title editor and Quick Entry all call it); syntax in `shared-parser-spec.md`, behavior pinned by `test-fixtures/nlp-corpus-v1.json`.

### Smart list → Vikunja mapping

| Smart list | Vikunja | Route |
|----------|---------|-------|
| Inbox | Configured project | `/inbox` |
| Today | `due_date` before the start of local tomorrow (overdue plus due today; `due_window = 'today'`) | `/today` |
| Upcoming | `due_date` from the start of local tomorrow on (`due_window = 'upcoming'`) | `/upcoming` |
| Anytime | All open tasks (excl. inbox) | `/anytime` |
| Logbook | Completed tasks | `/logbook` |
| Areas | Top-level projects | sidebar tree |
| Projects | Child projects | `/project/$projectId` |
| Tags | Labels | `/tag/$labelId` |

### Styling

- Tailwind CSS 3 with `darkMode: 'class'` (toggled via `<html class="dark">`)
- CSS variables for theme colors defined in the CSS (referenced as `var(--bg-primary)`, `var(--accent-blue)`, etc.)
- Theme applied by `src/renderer/lib/theme.ts` — supports light/dark/system
- Custom Tailwind colors alias CSS variables (see `tailwind.config.ts`)
- Path alias: `@` → `src/renderer/` (configured in `electron.vite.config.ts`)

### Auth

Two auth methods supported:
- **API Token**: stored in config, sent as `Bearer` token
- **OIDC**: full OAuth2 flow in `src/main/auth/` (discovery, login, token store, silent reauth)

OIDC and password logins also create a 365-day full-access backup API token titled `Vicu — <host> [<install id>]` (`backup-token.ts`; the random per-install id lives in `userData/install-id`). Its server id is stored in `auth.json` and logout revokes it best-effort (`DELETE /tokens/{id}`). Stale-token cleanup only deletes tokens carrying this install's id, the previously stored id, or the old-format token whose title and expiry match the locally stored one.

### Offline support

Three separate files in `userData`, all held in memory and written by `JsonFileStore` (`src/main/json-file-store.ts`: async, atomic, compact, one write at a time):
- **Offline queue** (`offline-queue.json` + `.bak`, code in `src/main/offline/`): changes that could not reach the server. Actions store merge patches, never task snapshots. A task created offline has a negative temp id (Quick View rows use `pending_<actionId>`); edits, completions and deletes of a pending create fold into it (`queue-merge.ts`, a port of Android's `QueueMerge`), and the replay rewrites temp ids in later actions. Labels and pasted images are follow-up actions of the create; images are stored under `offline-attachments/` and deleted after the upload. `replay.ts` sends from the live queue front to back and `classify.ts` decides each failure: only 400/404/409/413/422 move an action to the visible failed log; auth, 5xx, 429 and network errors keep the queue and stop the replay. The main window reaches the queue through `window.api.offlineQueue` (`src/main/offline/ipc.ts`, types in `src/shared/offline-queue-types.ts`).
- **Task write gate** (`src/main/offline/task-writes.ts`): every change to an existing task (`update-task`, `delete-task`, `add-label-to-task`, `remove-label-from-task` and Quick View's patch/complete/reopen) goes through `writeTask`. While the queue holds anything for that task a new change joins the queue instead of being sent (otherwise the replay would later send the older change on top of it), changes to one task run one at a time, and with `{ queue: true }` a change the server cannot take is queued in main. Callers that need the server's answer (routines, Quick Entry follow-ups) pass no options and are refused while changes for the task wait. The replay talks to the API client directly; nothing else should call it for an existing task.
- **Task cache** (`offline-cache.json`): last successful Quick View task fetch, served with the queue overlaid when offline. Disposable.
- **Standalone mode** (`standalone-tasks.json` + `.bak`): fully local task storage without a Vikunja server (`src/main/cache.ts`)

An older combined `offline-cache.json` is split once at startup (`offline/legacy-migration.ts`), keeping the original as `offline-cache.json.bak`.

### Fetching conventions (performance)

- **No full-history scans.** Routine and custom-list carriers are hidden done tasks. `src/main/carrier-discovery.ts` remembers their ids per server in `carrier-ids.json` and fetches them by id; new ones are found with a `q` marker search (`ROUTINE_CARRIER_SEARCH`, `CUSTOM_LIST_CARRIER_SEARCH`) plus `done = true`. A full scan runs at most daily, or once when a known id answers 404/403. Use `loadRoutineCarriers()` / `loadCustomListCarriers()` in `src/main/carrier-service.ts`, never an unfiltered `done = true` listing.
- **Server-side list filters.** Today and Upcoming send `due_window` (`'today' | 'upcoming'`, a Vicu-only param that `createTaskCollectionSearchParams` turns into a due-date clause on local-day boundaries from `src/shared/due-dates.ts`); Tag sends `labels = N`; Logbook loads newest-first pages on demand (`use-logbook-tasks.ts`). Anytime still loads all open tasks. Filters live in `src/renderer/hooks/use-filters.ts`.
- **Page size.** `per_page` is capped at 1000 by the server: use 1000 when a full set is needed and a small page where the UI pages.
- **New task placement** happens in the background after the create returns (`src/renderer/lib/new-task-position.ts`, remembers the list view id and last position per project).
- **Bundle.** The rich text editor, Settings, Review, Routines, Setup, Reauth and the logo are separate chunks (`LazyRichTextEditor.tsx`, `lazyRouteComponent` in `router.tsx`); `code-splitting.test.ts` fails if a static import pulls them back in.

Main window use of the queue (renderer): mutation helpers in `hooks/use-task-mutations.ts` call `lib/offline-mutations.ts`, which asks `isQueueableFailure` (`src/shared/error-classify.ts`) whether a failure should be queued. A queued change keeps its optimistic cache and a pending create lives in the cache under its temp id (`lib/pending-cache.ts`); `hooks/use-offline-queue.ts` feeds `stores/offline-store.ts` (counts, task ids for the row icon) and `lib/replay-handler.ts` remaps temp ids and refetches when a replay drains the queue. Task refetches are deferred while changes are queued (`lib/task-refresh.ts`). Non-queueable failures roll back and show a toast (`MutationCache.onError` in `lib/query-client.ts`; a mutation opts out with `meta: { silent: true }`). The sidebar `SyncStatusButton` opens `SyncPanel` (retry / discard of failed changes, sign-in on an auth problem). Queue entries carry the server URL and user id they were made for (`offline/owner.ts`); actions for another account are never replayed and stay in the failed log as `other-account`. The query cache of task lists, projects and labels is saved to IndexedDB (`lib/query-persistence.ts`) so the app starts with its last lists offline. Freshness: `lib/freshness.ts` refetches on window focus (30 s throttle), every 5 minutes while visible, on resume, and rolls date-dependent views over at midnight through `stores/day-store.ts`.

### Task reminders

`src/main/task-reminders.ts` (no Electron imports, fake-timer tests) schedules one timer per task reminder; `src/main/notifications.ts` wires it to the API client, config and notification windows. A refresh fetches only open tasks with a reminder in a window around now (server filter), at start-up, every 15 minutes, on window focus and resume, and after a task is completed, uncompleted or deleted. Timers beyond about 24.8 days are left to a later refresh, the task is re-read when a timer fires, and the master `notifications_enabled` switch is checked at refresh and at fire time.

### Config

`AppConfig` — persisted as JSON in Electron's `userData` directory (`VICU_USER_DATA_DIR` overrides the folder; the app name is pinned to `vicu` so the path is stable). Renderer settings are saved as partial patches that main merges (`save-config-patch`), never as a full snapshot. Includes Vikunja connection settings, theme, window bounds, sidebar width, custom lists, quick entry settings, and viewer filter config. The types (`AppConfig`, `ViewerFilter`, `ReviewConfig`, the custom-list shapes) have one definition, `src/shared/config-types.ts`, used by main and renderer; `src/main/config.ts` holds the defaults, normalizer and persistence. Quick Entry and Quick View are off until turned on (`isQuickEntryEnabled` / `isQuickViewEnabled`). Custom lists are ordered by `src/shared/custom-list-sort.ts` (same rules as Android: tasks without the date last in both directions, stable ties; `position` is never sent to the server as a sort).

### Platform Notes

- **Platform constants**: `src/main/platform.ts` exports `isMac`, `isWindows`, `isLinux` — use these for all platform branching (not raw `process.platform` checks)
- **Native integrations**: koffi FFI is Windows-only; macOS uses osascript-based alternatives in `obsidian-client.ts` and `window-url-reader.ts`; Linux has no equivalent and those features degrade gracefully
- **Main window chrome**: `titleBarStyle: 'hiddenInset'` on macOS (native traffic lights); `frame: false` on Windows and Linux (custom WindowControls)
- **Quick Entry/View popups**: on macOS, use `alwaysOnTop: true` (not `type: 'panel'` — panels auto-hide on app deactivation)
- **macOS icon assets**: `resources/icon.icns` (app bundle), `resources/iconTemplate.png` + `@2x.png` (menu bar tray — "Template" suffix is case-sensitive for auto-inversion)
- **Linux (AppImage)**:
  - Target defined in `electron-builder.yml` `linux:` section — AppImage, x64 + arm64. Uses `build/icon.png` (512×512). `desktop.StartupWMClass: com.rendyhd.vicu` (the appId, the same value as `APP_ID` in `src/main/app-id.ts` and `desktopName` in `package.json`; `app-id.test.ts` checks those against `electron-builder.yml`) is load-bearing on GNOME/Wayland so the app groups under its own dock icon instead of generic "Electron".
  - Tray icon reuses `resources/icon.png` resized to 16×16 via the existing Windows fallback in `tray.ts`.
  - Global shortcuts: Electron's `globalShortcut.register()` is unreliable on Wayland. `registerQuickEntryShortcuts` in `src/main/index.ts` already reports `{entry, viewer}` booleans; the latest state is surfaced via the `get-global-shortcut-status` IPC and rendered as a warning banner in Settings → Quick Entry / View with Linux-specific copy.
  - Browser link mode: native-messaging host manifests are written to `~/.config/google-chrome|chromium|microsoft-edge|BraveSoftware/Brave-Browser|vivaldi/NativeMessagingHosts/` and `~/.mozilla/native-messaging-hosts/` (`browser-host-registration.ts`). The shell wrapper `vicu-bridge.sh` is generated in `app.getPath('userData')` by `ensureWrapper()` (shared with macOS; Windows writes `vicu-bridge.bat` the same way). It runs the bridge with the app's own binary and `ELECTRON_RUN_AS_NODE=1`, so no system Node.js is needed; under an AppImage it runs the `$APPIMAGE` file and keeps a copy of the bridge script in userData because the mount path changes per launch. PowerShell / AppleScript URL-from-window-title fallback does not run on Linux (Wayland blocks foreground introspection).
  - Launch on startup: `setLoginItemSettings` is a no-op on Linux, so `launch-on-startup.ts` writes `~/.config/autostart/com.rendyhd.vicu.desktop` (`autostart-linux.ts`) with `Exec` set to `$APPIMAGE` (else the installed binary; hidden in Settings when neither is known, e.g. dev). "Start hidden" adds `--hidden` (Windows login item args, Linux Exec) or, on macOS, uses `wasOpenedAtLogin`; the window is only left hidden when a tray icon or the dock can bring it back (`shouldStartHidden`). Windows login items are named after the AUMID, so the old `com.vicu.app` entry is removed on packaged starts.
  - Obsidian integration is stubbed out on Linux — `getForegroundProcessName()` returns `''` and `getObsidianContext()` silently returns `null`. The setting remains visible but no foreground-app detection runs.

### Vikunja API docs

`api-docs.json` at the project root contains the full Vikunja API documentation (OpenAPI spec). Reference this when working with API endpoints, request/response shapes, or adding new API calls.

### Vikunja null date

The Vikunja API uses `0001-01-01T00:00:00Z` as its null/empty date value (Go zero time). This is defined as `NULL_DATE` in `src/renderer/lib/constants.ts` (the import-free shared modules carry their own copy). To clear a date, send `null` in a merge patch.
