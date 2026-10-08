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
npm run tokens         # Regenerate src/renderer/assets/tokens.css from test-fixtures/design-tokens-v1.json (--check to only verify)
npm run ui:verify      # UI verification harness (built app + seeded local Vikunja; see Styling, scripts/ui-verify/README.md)
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

1. **Main window** — full app with sidebar + content area. Chrome per platform (`src/main/window-chrome.ts`, see Platform Notes): native traffic lights on macOS, native caption buttons (`titleBarOverlay`, Snap Layouts) and Mica behind the sidebar on Windows 11, frameless with the custom `WindowControls` on Linux only
2. **Quick Entry** (`src/renderer/quick-entry/`) — global hotkey popup for fast task creation, always-on-top, transparent
3. **Quick View** (`src/renderer/quick-view/`) — global hotkey popup showing filtered task list, always-on-top, transparent

Quick Entry/View windows have their own preload scripts, HTML entry points, and renderers configured in `electron.vite.config.ts`.

### Shared code (`src/shared/`)

Pure modules used by both main and renderer (the renderer re-exports several through `src/renderer/lib/`, e.g. `export * from '../../shared/due-dates'`). Most are import-free or only import siblings so every tsconfig can include them; keep them free of Electron and DOM code. Rules live here once, never in two copies:

- `due-dates.ts` — due-date rules: a date without a time is stored as local 23:59:59 (`dateOnlyDue(localDate)`, used by every place that sets a due date), legacy local 00:00 reads as date-only, local-day boundaries, the Overdue/Today/Upcoming buckets, and the `due_window` server clause.
- `custom-list-filter.ts` — the one custom-list evaluator (date windows, `include_overdue`, server-filter superset) used by the main window and Quick View; `custom-list-sort.ts` — custom-list ordering, the same as Android.
- `routines.ts` — routine carrier and archive envelopes, merge, 400-day pruning and archive-write planning, CSV. History older than the window lives in hidden done "archive part" tasks (`vicu-routine:archive:v1`) and is read on demand.
- `date-display.ts` — how a due date or completion time is phrased (pure: locale and clock are passed in; en-US and en-GB built from parts so ICU and java.time agree; pinned by the `dateDisplay` vectors of `cross-app-semantics-v1.json`); `completion-hold.ts` — the completion hold state machine (see Styling); `priority-mark-svg.ts` — the priority mark shapes, shared by `PriorityMark.tsx` and Quick View.
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
- **State**: Zustand stores in `src/renderer/stores/` — sidebar, selection, reorder, UI, offline queue counts, toasts, the current day, completed tasks and the completion hold, the screen-reader announcer.
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

Tailwind CSS 3 (staying on 3.x; Tailwind 4 is a separate later step) with `darkMode: 'class'` (`src/renderer/lib/theme.ts` toggles `<html class="dark">` for light/dark/system; components read it through `useIsDark()`, never the document class: `theme-reads.test.ts`). Path alias: `@` → `src/renderer/` (`electron.vite.config.ts`). `docs/design-system-v1.md` is the prose contract; the values live in `test-fixtures/design-tokens-v1.json`.

**Token pipeline.** `test-fixtures/design-tokens-v1.json` (colour roles light and dark, contrast rules, type, radius, motion; byte-identical with Android) → `scripts/gen-tokens.mjs` → `src/renderer/assets/tokens.css`. Never edit `tokens.css` or define a token variable again in `index.css`; change the fixture in both repos, run `npm run tokens` (`node scripts/gen-tokens.mjs`; with `--check` it exits 1 when `tokens.css` is stale) and commit the result. `tokens.css` holds `:root` (light colours, `--type-<role>-size/weight/line`, `--radius-<role>`, the motion variables) and `.dark` (dark colours). `index.css` imports it first; Quick Entry (`quick-entry/styles.css`) and Quick View (`quick-view/viewer.css`) import it too. The same module feeds `tailwind.config.ts` (`tailwindTheme(loadTokens())`: colours, `fontSize`, `borderRadius`, tint opacity steps) and the tests, so the CSS variables, the classes and the assertions cannot drift. A colour role's variable is `--` plus the role with dots as dashes, except the legacy names kept in the fixture's `css.aliases` (`bg.page` → `--bg-primary`, `text` → `--text-primary`, `accent` → `--accent-blue`, `border` → `--border-color`, `palette.*` → `--accent-red` ...). `--bg-secondary` and `--bg-tertiary` are older surface names still defined in `index.css`; they are not roles.

**Colour classes use channel variables.** Every role has a hex variable and an `-rgb` channel variable (`--accent-blue-rgb: 10 102 209`), and Tailwind colours are `rgb(var(--x-rgb) / <alpha-value>)`. That is what makes opacity modifiers work: `bg-accent-blue/15`, `bg-status-overdue/8`. An arbitrary `bg-[var(--accent-blue)]/15` generates no CSS at all in Tailwind 3 (it cannot parse the colour), so it silently does nothing; write the named class. Class names are the role with dots as dashes: `bg-bg-page`, `bg-bg-hover`, `bg-bg-selected`, `text-text`, `text-text-secondary`, `border-border`, `text-status-overdue`, `bg-accent-fill`, `text-on-accent`, `bg-danger`, `text-priority-high`, plus the legacy palette names (`accent-blue` ... `accent-teal`). `bg-sidebar` is the one raw `var(--bg-sidebar)` (`css.rawVar`): the macOS vibrancy and Windows Mica overrides in `index.css` replace it with a translucent value, so it has no channel variable and takes no opacity. Opacity steps beyond Tailwind's scale are the tint alphas of the fixture (`8`, `12`; `theme.extend.opacity`). Type roles are `text-page-title`, `text-section`, `text-group`, `text-task-title`, `text-card-title`, `text-meta`, `text-chip`, `text-caption` (nothing under 11 px; size, weight and line height come from the role). Radius roles are `rounded-control`, `rounded-popover`, `rounded-card`, `rounded-chip` (`rounded-full` stays for circles, `rounded-none` for resets; the fixture's `sheet` is Android only). `cn()` (`lib/cn.ts`) is `clsx` plus `tailwind-merge` extended with those role names (`FONT_SIZE_ROLES`, `RADIUS_ROLES`); without the extension it reads `text-caption` as a colour and drops it next to `text-status-overdue`. Use `cn`, and add a role to both lists when the fixture gains one.

**Guard tests** (vitest; the scans cover `src/renderer` without `__tests__`, and each failure message says what to write instead; a test that builds its probe classes from parts does so to keep a literal class out of the Tailwind content scan, do the same in new tests):
- `assets/__tests__/tokens.test.ts`: `tokens.css` equals a fresh generation, every role has hex and channel variables, `index.css` redefines no token, the Tailwind theme generates opacity classes. `assets/__tests__/contrast.test.ts`: every `contrast.rules` pair of the fixture in both themes (WCAG ratios, tints composited at their alpha).
- `lib/__tests__/tailwind-classes.test.ts`: no opacity on an arbitrary `var()`, on a colour without a channel variable (`bg-sidebar/50`) or on an unconfigured step.
- `lib/__tests__/type-sizes.test.ts`: no font size under 11 px (class, stylesheet or inline), and an arbitrary `text-[Npx]` of 11 px or more only in files listed in `ARBITRARY_SIZE_ALLOWLIST` (the list should shrink as files move to role classes; a new entry needs a reason, prefer a role class).
- `lib/__tests__/radius-roles.test.ts`: no arbitrary `rounded-[...]` and no stock `rounded`, `rounded-md`, `rounded-lg` ... (side forms included); only the radius roles, `full` and `none`.
- `lib/__tests__/text-tertiary.test.ts`: `text.tertiary` is for disabled controls and decoration, never readable text (a `text-text-tertiary` class or `color: var(--text-tertiary)` fails); the one decorative exception sits in `DECORATIVE_ALLOWLIST` with its reason.
- `lib/__tests__/motion-roles.test.ts`: no raw `duration-200` or `duration-[300ms]`; only duration roles the theme defines, each backed by a variable in `tokens.css`.
- `lib/__tests__/cn.test.ts`: `cn` merges role classes correctly and its role lists equal the token contract.
- Related: `lib/__tests__/code-splitting.test.ts`, and `src/shared/__tests__/sibling-contract-identity.test.ts` (fixtures and docs identical with `vicu-android`).

**Overlay primitives** (`src/renderer/components/overlay/`). Popovers, menus, dialogs and tooltips are built on the platform instead of an absolutely positioned panel inside a clipped card. `Popover.tsx` is a native `popover` element in the top layer (no card, list or content area clips it; light dismiss and Escape come from the browser) positioned by `@floating-ui/dom` in `use-floating-popover.ts` (`flip`, `shift`, `size`: it stays inside the window and scrolls inside when the room is short, constants in `popover-logic.ts`). Props: `anchorRef`, `label`, `role` (`dialog`, `listbox`, `menu`), `placement`, `initialFocus`; focus returns to the anchor on close, mounting opens it and unmounting closes it. Arrow keys, Home/End and typeahead (`typeahead.ts`) are shared by every picker. `Menu.tsx` is a Popover with `menuitem`, `menuitemradio` and separators, and an `anchorPoint` form for context menus. `Dialog.tsx` wraps `<dialog>` and `showModal()` (modal, inert page, Escape, focus return, `returnFocusTo` for a dialog opened from a menu, `role="alertdialog"` for confirmations). `Tooltip.tsx` shows after `TOOLTIP_DELAY_MS` of rest or keyboard focus as a manual popover linked by `aria-describedby`. The primitives unmount on close, so their leaving animation is an inert fading copy (`leave-ghost.ts`, `.vicu-popover-leaving`). New pickers, menus and confirmations use these; do not hand-position a floating panel. Tests: `overlay/__tests__/` (`popover-logic`, `typeahead`, `picker-popovers`, `menu-dialog`).

**Motion.** The motion roles are in the fixture: `fade.fast` 150 ms and `fade.base` 240 ms with the `standard`/`enter`/`exit` easings, springs `move` 320 ms, `moveExpressive` and `pop` 360 ms (overshoots), `page` out 90 ms and in 210 ms with a 6 px rise, `stagger`, `checkDrawMs`, `strikeDrawMs`. `gen-tokens.mjs` turns each spring (damping ratio and stiffness) into a CSS `linear()` curve (`--spring-move`, `--spring-move-expressive`, `--spring-pop`) next to `--dur-*` and `--ease-*`. Components use the Tailwind classes `duration-fade-fast|fade-base|move|move-expressive|pop` and `ease-standard|enter|exit`; JS reads the variables through `lib/motion.ts` (`motionMs`), never a literal. Moments: popover, tooltip and dialog entrances (`.vicu-popover`, `.vicu-dialog` in `index.css`); opening and closing a task is a view transition that morphs the row into the card and back (`lib/task-transition.ts`: the two elements carry `view-transition-name: task-<id>` only while it runs; `html[data-task-transition]` is `morph` or `fade`); changing view by pointer cross-fades the content region with a rise (`lib/navigation-motion.ts` decides, a keyboard navigation is instant; `html:active-view-transition-type(page) main` names the region only while it runs); list inserts, removals and reorders are FLIP (`lib/list-motion.ts`, `hooks/use-list-motion.ts`), drops settle in `lib/drop-animation.ts`; rolling counts (`lib/roll.ts`, `RollingCount.tsx`), the check and strike draw, the skeleton shimmer, the sidebar `SelectionPill`.

**Completion hold** (`docs/cross-app-semantics-v1.md` section 7; identical on Android). `src/shared/completion-hold.ts` is the pure state machine (`CompletionHold`: no timers, every method takes the time; `COMPLETION_HOLD_MS` 5000, `COMPLETION_TOAST_MS` 6000, `completionToastText`). A completed row stays in its list, shown as done, until 5 s after the completion or after the pointer or keyboard focus last left it, then it collapses; collapsed rows share one "Completed" / "3 completed" toast with Undo (6 s, same engagement rule); leaving the view collapses everything at once. Renderer side: `stores/completion-hold-store.ts` (one real timer for `nextDeadline()`, held rows are `completed-tasks-store` entries), `hooks/use-completion-hold.ts` (row engagement, undo, announcements, focus moving to the next checkbox), `hooks/use-completion-collapse.ts` with `lib/row-close.ts` (the close: fade and height with the move spring, a fade only under reduced motion; the row is `inert` while it closes) and `ToastHost.tsx` (one always-mounted polite live region, fed by `announcer-store.ts`). Change the rule in the doc and the fixture first, like any cross-app rule.

**Reduced motion.** Every animation has a reduced variant: cross-fades only, no transform, no height animation, no overshoot. CSS: the base layer in `index.css` under `prefers-reduced-motion: reduce` (transitions limited to colour and opacity and at most `--dur-fade-fast`, spinners fade, pulses stop, smooth scroll off) plus per-moment overrides (the view transitions become plain fades; `data-task-transition='fade'`). JS: `useReducedMotion()` / `readReducedMotion()` (`hooks/use-reduced-motion.ts`, follows the setting live); `animateFLIP` and `animateDrop` in `lib/motion.ts` do nothing when it is on. The completion hold keeps its timing. This PC reports `reduce` (Windows animation effects are off), which is why the harness forces full motion by default; to see motion in the real app here, turn on Windows Settings, Accessibility, Visual effects, Animation effects.

**Forced colours.** `@media (forced-colors: active)` blocks in `index.css` (and in the Quick Entry and Quick View stylesheets) keep meaning visible when the system replaces colours: svg icons follow the text colour, the focus ring uses `Highlight`, ring utilities and shadows become outlines, solid fills use `Highlight`/`HighlightText`, chips get an outline (`.vicu-chip`), hairlines become borders (`.vicu-hairline`), a dragged row gets an edge (`.vicu-lift`), the strike goes back to `text-decoration`. Anything that carries meaning by colour alone also needs a shape, border or text (priority marks are bars and a square with "!", toast kinds have an icon and a name). Check with `--forced-colors` in the harness (E12).

**Focus.** One ring for everything a keyboard reaches (`:focus-visible`: 2 px `--focus-ring`, offset 2 px; rows, options and menu items sit in clipped lists and use an inside offset). A control that draws its own focus state says so with `focus:outline-none`.

**UI verification harness** (`scripts/ui-verify/`, README there; a developer tool: not packaged, not part of `npm run verify`). `npm run ui:verify` runs `scripts/ui-verify/desktop.mjs`: it launches the built app (`npm run build` first, or `--build`) through `playwright-core` with a throwaway profile and real mouse and keyboard input against a seeded local Vikunja, and writes PNG captures and one JSON line per assertion (and `axe-core` violations) to `scripts/ui-verify/out/<run>/` (`results.jsonl`, `<scenario>--<name>.png`; exit code 1 when a scenario threw, the page threw or an assertion failed). Options: `--theme light|dark`, `--size WxH` (default 1280x820), `--motion full|reduce` (default `full` forces `no-preference`), `--forced-colors`, `--scenario a,b` (file name or id: `baseline`, `e4`), `--wave N` (every scenario whose first wave is N or earlier; re-seeds first), `--reseed` / `--no-reseed`, `--run NAME`, `--build`, `--list`. Scenarios are `scripts/ui-verify/scenarios/*.mjs` (`meta = { id, wave, title }` and a default function over the helper object `h`: `goto`, `click`, `key`, `drag`, `capture`, `assert`, `axe`, `requests`, `api` ...); some mutate the shared server (`moments`, `e10-drag-reorder`), so run one harness at a time. The test server is a Docker Vikunja 2.4.0 (`vicu-test-vikunja` on `127.0.0.1:3456`; the `docker run` line is in the README, `docker start vicu-test-vikunja` afterwards; `VICU_TEST_SERVER` and `VICU_TEST_CONTAINER` override). `node scripts/ui-verify/seed.mjs` (idempotent) makes a test user, an API token and a dataset with dates relative to today (overdue, today, timed, upcoming, repeating, checklists, subtasks, priorities, logbook, review footers); `node scripts/ui-verify/profile.mjs` rebuilds the light and dark app profiles, and `desktop.mjs` does that on every launch. Everything under `scripts/ui-verify/.local/` (credentials, API token, seed ids, `profile-light`, `profile-dark`; `VICU_UI_LOCAL` moves it) and `scripts/ui-verify/out/` is git-ignored, and no script prints a credential. To look at a profile by hand: `VICU_USER_DATA_DIR=scripts/ui-verify/.local/profile-light npx electron .`. `scripts/ui-verify/tools/` has `contrast.mjs` and `springs.mjs`.

### Auth

Two auth methods supported:
- **API Token**: stored in config, sent as `Bearer` token
- **OIDC**: full OAuth2 flow in `src/main/auth/` (discovery, login, token store, silent reauth)

OIDC and password logins also create a 365-day full-access backup API token titled `Vicu — <host> [<install id>]` (`backup-token.ts`; the random per-install id lives in `userData/install-id`). Its server id is stored in `auth.json` and logout revokes it best-effort (`DELETE /tokens/{id}`). Stale-token cleanup only deletes tokens carrying this install's id, the previously stored id, or the old-format token whose title and expiry match the locally stored one.

### Offline support

Three separate files in `userData`, all held in memory and written by `JsonFileStore` (`src/main/json-file-store.ts`: async, atomic, compact, one write at a time):
- **Offline queue** (`offline-queue.json` + `.bak`, code in `src/main/offline/`): changes that could not reach the server. Actions store merge patches, never task snapshots. A task created offline has a negative temp id (Quick View rows use `pending_<actionId>`); edits, completions and deletes of a pending create fold into it (`queue-merge.ts`, a port of Android's `QueueMerge`), and the replay rewrites temp ids in later actions. Labels and pasted images are follow-up actions of the create; images are stored under `offline-attachments/` and deleted after the upload. `replay.ts` sends from the live queue front to back and `classify.ts` decides each failure: only 400/404/409/413/422 move an action to the visible failed log; auth, 5xx, 429 and network errors keep the queue and stop the replay. The main window reaches the queue through `window.api.offlineQueue` (`src/main/offline/ipc.ts`, types in `src/shared/offline-queue-types.ts`).
- **Task write gate** (`src/main/offline/task-writes.ts`): every change to an existing task (`update-task`, `delete-task`, `add-label-to-task`, `remove-label-from-task` and Quick View's patch/complete/reopen) goes through `writeTask`. While the queue holds anything for that task a new change joins the queue instead of being sent (otherwise the replay would later send the older change on top of it), changes to one task run one at a time (`runInOrder`, a chain per task), and with `{ queue: true }` a change the server cannot take is queued in main. Callers that need the server's answer (routines, Quick Entry follow-ups) pass no options and are refused while changes for the task wait. **Writes are also serial across tasks**: every request that changes a task leaves through `sendSerially` (same file), one at a time, because Vikunja's default SQLite database answers parallel writes with "database is locked" (a 500); a bulk change from the selection bar used to lose some of them to the queue that way. `writeTask` sends through it, and so do `create-task`, `create-task-relation`/`delete-task-relation`, `update-task-position` (all in `ipc-handlers.ts`), Quick Entry's `createFromQuickEntry` (`offline/quick-actions.ts`) and every write of the replay (`api` in `sync.ts`), so the replay and the app wait for each other. Creates and position updates use `sendSerially` directly (a create has no existing task to gate on). When the request in front fails on the network, the requests waiting behind it are not sent and answer `NOT_SENT_AFTER_NETWORK_FAILURE`, which classifies as queueable, so a bulk change does not wait a network timeout per task before it reaches the queue. A replay that stopped on a network, 5xx or 429 problem is retried by `createReplayRetry` (`offline/replay-retry.ts`, wired in `sync.ts`) after 5 s, 15 s, then every 60 s (`REPLAY_RETRY_DELAYS_MS`), instead of waiting for the five minute timer; any other replay resets the schedule, and auth or setup problems wait for the user. The replay talks to the API client directly (through `sendSerially`); nothing else should call it for an existing task.
- **Task cache** (`offline-cache.json`): last successful Quick View task fetch, served with the queue overlaid when offline. Disposable.
- **Standalone mode** (`standalone-tasks.json` + `.bak`): fully local task storage without a Vikunja server (`src/main/cache.ts`)

An older combined `offline-cache.json` is split once at startup (`offline/legacy-migration.ts`), keeping the original as `offline-cache.json.bak`.

### Fetching conventions (performance)

- **No full-history scans.** Routine and custom-list carriers are hidden done tasks. `src/main/carrier-discovery.ts` remembers their ids per server in `carrier-ids.json` and fetches them by id; new ones are found with a `q` marker search (`ROUTINE_CARRIER_SEARCH`, `CUSTOM_LIST_CARRIER_SEARCH`) plus `done = true`. A full scan runs at most daily, or once when a known id answers 404/403. Use `loadRoutineCarriers()` / `loadCustomListCarriers()` in `src/main/carrier-service.ts`, never an unfiltered `done = true` listing.
- **Server-side list filters.** Today and Upcoming send `due_window` (`'today' | 'upcoming'`, a Vicu-only param that `createTaskCollectionSearchParams` turns into a due-date clause on local-day boundaries from `src/shared/due-dates.ts`); Tag sends `labels = N`; Logbook loads newest-first pages on demand (`use-logbook-tasks.ts`). Anytime still loads all open tasks. Filters live in `src/renderer/hooks/use-filters.ts`.
- **Project progress counts.** The sidebar progress ring needs a done count per project without listing history: `count-project-tasks` (`handleTrusted` in `ipc-handlers.ts`, `window.api.countProjectTasks`) asks `fetchProjectTaskTotal` for a one-task page of `done = true` and reads the `total` of the API v2 envelope, then subtracts the known hidden carrier tasks of that project (routines and synced custom lists, from `loadRoutineCarriers()` / `loadCustomListCarriers()`). The rules are in `src/main/project-task-counts.ts` (no Electron imports; cached 10 minutes per server, project and done flag, overlapping questions share one request, `invalidateProjectCounts(projectId?)` drops entries when a task is created, completed, reopened, moved or deleted, and after a replay applied changes); `project-counts-service.ts` wires it up. The renderer side is `hooks/use-project-progress.ts` (`useProjectDoneCount` per visible row only, open counts from one shared `done = false` task listing) and `components/shared/ProgressRing.tsx`.
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
- **Main window chrome**: chosen per platform by the pure `windowChromeOptions()` in `src/main/window-chrome.ts` (`window-chrome.test.ts`). macOS: `titleBarStyle: 'hiddenInset'` (native traffic lights) with `vibrancy: 'sidebar'`. Windows: `titleBarStyle: 'hidden'` plus `titleBarOverlay` (native caption buttons, which is what gives Snap Layouts; band height `TITLE_BAND_HEIGHT` = 32 px, colours `TITLE_BAND_COLORS` from the token contract, recoloured when the theme changes), and on build >= 22621 (`MICA_MIN_BUILD`, Windows 11 22H2) `backgroundMaterial: 'mica'` with a transparent window: the preload exposes `window.api.windowMaterial`, `main.tsx` sets `<html data-material="mica">`, and `index.css` then makes `--bg-sidebar` near-transparent so Mica shows through the sidebar while the content region stays opaque. Windows 10 and 11 21H2 keep the opaque `bg.sidebar`. Linux: `frame: false`; `WindowControls.tsx` draws the controls on Linux only and renders nothing elsewhere. Windows type uses Segoe UI Variable (`--font-text`, `--font-display` in `index.css`).
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
