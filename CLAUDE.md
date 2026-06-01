# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Vicu** — a task management desktop app for Windows, macOS, and Linux (AppImage), powered by [Vikunja](https://vikunja.io/) as the backend. Built with Electron + React + TypeScript + Tailwind CSS.

## Commands

```bash
npm install            # Install dependencies
npm run dev            # Start dev mode (electron-vite dev, opens app with HMR + DevTools)
npm run build          # Production build (electron-vite build)
npm run start          # Preview production build (electron-vite preview)
npm run dist           # Build + package Windows installer (electron-builder)
npm run dist:publish   # Build + package + upload to GitHub release (used by CI)
npm run dist:mac       # Build + package macOS DMG
npm run dist:linux     # Build + package Linux AppImage (x64 + arm64 per builder config)
```

No test runner or linter is configured.

## CI/CD

GitHub Actions workflow at `.github/workflows/release.yml` triggers on tag pushes matching `v*`. It builds:

- **Windows** NSIS x64 (`build-windows`, `windows-latest`, `npm run dist:publish`)
- **macOS** DMG arm64 (`build-macos`, `macos-latest`, `npm run dist:mac:publish`)
- **Linux** AppImage x64 + arm64 (`build-linux` matrix — `ubuntu-latest` for x64, `ubuntu-24.04-arm` for arm64, `npm run dist:linux:publish`)

All three publish to the same GitHub draft release via `electron-builder --publish always`.

**Do NOT manually create releases or attach build artifacts** — CI handles everything. `electron-builder --publish always` creates its own **draft** release, uploads the installer, then publishes it. If you manually create a release first via `gh release create`, electron-builder will create a separate draft and the manual release will have no assets.

**Release workflow**: Just push a `v*` tag. CI will create the release, build the installer, and publish it. After CI completes, edit the release notes with `gh release edit` if needed.

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

### Data flow: Renderer → Main → Vikunja

All API calls go through IPC: renderer calls `window.api.someMethod()` → preload forwards via `ipcRenderer.invoke()` → main process handler in `src/main/ipc-handlers.ts` → `src/main/api-client.ts` makes HTTP request using Electron's `net.request()`.

API responses use a discriminated union: `{ success: true, data: T } | { success: false, error: string }`.

### Vikunja API gotcha

**Go zero-value problem**: When updating tasks/projects, always send the *complete* object, not just changed fields. Sending `{ done: true }` alone will zero out `due_date`, `priority`, etc. See comment in `src/main/api-client.ts:198`.

### Renderer architecture

- **Router**: `src/renderer/router.tsx` — TanStack Router with hash history (required for `file://` in Electron). Root layout is `AppShell`.
- **Views**: `src/renderer/views/` — one per route: Inbox, Today, Upcoming, Anytime, Logbook, Project, Tag, CustomList, Settings, Setup.
- **State**: Zustand stores in `src/renderer/stores/` — sidebar state, selection state, reorder state, UI state.
- **Data fetching**: TanStack Query hooks in `src/renderer/hooks/` — `use-tasks`, `use-projects`, `use-labels`, `use-task-mutations`, etc. Mutations use optimistic updates with rollback.
- **API layer**: `src/renderer/lib/api.ts` wraps `window.api` calls with proper TypeScript types from `vikunja-types.ts`.
- **Drag & drop**: `@dnd-kit` for task reordering, moving tasks between projects, applying labels via drag-to-sidebar, project reordering, and custom list reordering. Collision detection in `AppShell.tsx`.

### Smart list → Vikunja mapping

| Smart list | Vikunja | Route |
|----------|---------|-------|
| Inbox | Configured project | `/inbox` |
| Today | `due_date <= today` | `/today` |
| Upcoming | Future due dates | `/upcoming` |
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

### Offline support

`src/main/cache.ts` provides:
- **Pending actions queue**: failed API calls cached for retry (create, complete, update tasks)
- **Task cache**: last successful task fetch served when offline
- **Standalone mode**: fully local task storage without a Vikunja server

### Config

`AppConfig` in `src/main/config.ts` — persisted as JSON in Electron's `userData` directory. Includes Vikunja connection settings, theme, window bounds, sidebar width, custom lists, quick entry settings, and viewer filter config.

### Platform Notes

- **Platform constants**: `src/main/platform.ts` exports `isMac`, `isWindows`, `isLinux` — use these for all platform branching (not raw `process.platform` checks)
- **Native integrations**: koffi FFI is Windows-only; macOS uses osascript-based alternatives in `obsidian-client.ts` and `window-url-reader.ts`; Linux has no equivalent and those features degrade gracefully
- **Main window chrome**: `titleBarStyle: 'hiddenInset'` on macOS (native traffic lights); `frame: false` on Windows and Linux (custom WindowControls)
- **Quick Entry/View popups**: on macOS, use `alwaysOnTop: true` (not `type: 'panel'` — panels auto-hide on app deactivation)
- **macOS icon assets**: `resources/icon.icns` (app bundle), `resources/iconTemplate.png` + `@2x.png` (menu bar tray — "Template" suffix is case-sensitive for auto-inversion)
- **Linux (AppImage)**:
  - Target defined in `electron-builder.yml` `linux:` section — AppImage, x64 + arm64. Uses `build/icon.png` (512×512). `desktop.StartupWMClass: Vicu` is load-bearing on GNOME/Wayland so the app groups under its own dock icon instead of generic "Electron".
  - Tray icon reuses `resources/icon.png` resized to 16×16 via the existing Windows fallback in `tray.ts`.
  - Global shortcuts: Electron's `globalShortcut.register()` is unreliable on Wayland. `registerQuickEntryShortcuts` in `src/main/index.ts` already reports `{entry, viewer}` booleans; the latest state is surfaced via the `get-global-shortcut-status` IPC and rendered as a warning banner in Settings → Quick Entry / View with Linux-specific copy.
  - Browser link mode: native-messaging host manifests are written to `~/.config/google-chrome|chromium|microsoft-edge|BraveSoftware/Brave-Browser|vivaldi/NativeMessagingHosts/` and `~/.mozilla/native-messaging-hosts/` (`browser-host-registration.ts`). The shell wrapper `vicu-bridge.sh` is generated in `app.getPath('userData')`, reusing the macOS `ensureShellWrapper()` code. PowerShell / AppleScript URL-from-window-title fallback does not run on Linux (Wayland blocks foreground introspection).
  - Obsidian integration is stubbed out on Linux — `getForegroundProcessName()` returns `''` and `getObsidianContext()` silently returns `null`. The setting remains visible but no foreground-app detection runs.
- **Forge config**: stale reference — Vicu uses electron-vite + electron-builder, not electron-forge. No `forge.config.ts` exists.

### Vikunja API docs

`api-docs.json` at the project root contains the full Vikunja API documentation (OpenAPI spec). Reference this when working with API endpoints, request/response shapes, or adding new API calls.

### Vikunja null date

The Vikunja API uses `0001-01-01T00:00:00Z` as its null/empty date value (Go zero time). This is defined as `NULL_DATE` in `src/renderer/lib/constants.ts`.
