# Vicu macOS Porting Plan — Claude Code Edition (v3)

A phased, copy-paste-ready plan for making Vicu fully macOS compatible. Each phase has a **prompt** to paste into Claude Code, a **scope** of what it touches, and a **test checkpoint** describing exactly what to verify before moving on.

> **Pre-requisites**: You need a Mac (Apple Silicon or Intel) with Node.js 20+, Xcode Command Line Tools (`xcode-select --install`), and the Vicu repo cloned. Run `npm install` first.
>
> **Reference codebase**: The companion app `vikunja-quick-entry` (already macOS-compatible) is available in this project's knowledge. Phases 5, 7, 8, 9 port proven code from it.

---

## Phase 0 — Platform constant + icon assets + CLAUDE.md update

**Why first**: Every subsequent phase branches on `isMac`. Establishing the constant and updating CLAUDE.md means Claude Code will have the right context for all future prompts. The icon assets are also needed early since Phase 4 (tray) and Phase 10 (forge/DMG) depend on them.

### Prompt

```
Add a platform helper and prepare macOS icon assets:

1. Create `src/main/platform.ts` that exports:
   - `const isMac = process.platform === 'darwin'`
   - `const isWindows = process.platform === 'win32'`
   - `const isLinux = process.platform === 'linux'`

2. Create macOS icon assets. We need two things:
   a. A `.icns` app icon for the macOS .app bundle. Generate `resources/icon.icns` from the existing `resources/icon.png` (or `build/icon.png` — check which exists):
      - Create a temporary iconset directory, resize to all required sizes (16, 32, 64, 128, 256, 512, 1024), then use `iconutil --convert icns` to produce the .icns file.
      - If the source PNG is too small for 1024x1024, skip sizes above the source resolution — iconutil tolerates missing sizes.
      - Use `sips` for resizing and `iconutil` for conversion (macOS tools).
   b. Tray template images for macOS menu bar:
      - Create `resources/iconTemplate.png` (16x16, monochrome black + alpha, 72 DPI)
      - Create `resources/iconTemplate@2x.png` (32x32, monochrome black + alpha, 144 DPI)
      - These should be the same "V" checkmark shape as the existing programmatic tray icon in src/main/tray.ts, but as actual PNG files. Use black (#000000) pixels with alpha channel only — macOS will auto-invert for dark menu bars.
      - The filename MUST contain "Template" (case-sensitive) for macOS to recognize them.

3. Update CLAUDE.md:
   - Change the project description from "for Windows" to "for Windows and macOS"
   - Add a "Platform Notes" section explaining:
     - `src/main/platform.ts` exports platform constants
     - koffi FFI is Windows-only; macOS uses osascript-based alternatives added inline to obsidian-client.ts and window-url-reader.ts
     - Main window uses `titleBarStyle: 'hiddenInset'` on macOS, `frame: false` on Windows
     - Quick Entry/View popup windows work identically on both platforms (no macOS-specific window options needed — proven by vikunja-quick-entry)
     - The `isMac` constant should be used for all platform branching
     - macOS icon assets: `resources/icon.icns` (app bundle), `resources/iconTemplate.png` + `@2x.png` (menu bar tray — "Template" suffix is case-sensitive for auto-inversion)
     - Forge config: `forge.config.ts` at project root, referenced from package.json

Do NOT change any other source files yet.
```

### Test checkpoint

- [ ] `npm run build` succeeds
- [ ] `src/main/platform.ts` exists with the three exports
- [ ] `resources/icon.icns` exists (or a TODO is documented if not on macOS)
- [ ] `resources/iconTemplate.png` and `resources/iconTemplate@2x.png` exist
- [ ] CLAUDE.md mentions macOS and the platform notes section

---

## Phase 1 — macOS app lifecycle (window-all-closed, activate, quit)

**Why next**: Without this, the app quits when you close the window on macOS, which breaks every other feature. This is the #1 macOS Electron footgun.

### Prompt

```
Make Vicu's app lifecycle macOS-compatible. Edit `src/main/index.ts`:

1. Import `isMac` from `./platform`.

2. Change the `window-all-closed` handler:
   - Current: only stays alive if tray is active (`if (!hasTray()) app.quit()`)
   - New: on macOS, NEVER quit on window-all-closed (regardless of tray state). On Windows, keep current behavior.
   ```typescript
   app.on('window-all-closed', () => {
     if (!isMac && !hasTray()) {
       app.quit()
     }
   })
   ```

3. Add an `activate` handler:
   - This fires when the dock icon is clicked or the app is switched to via Cmd+Tab.
   - IMPORTANT: Do NOT recreate the window. The close handler (step 4) hides instead of destroying, so mainWindow should always exist. Just show and focus it.
   ```typescript
   app.on('activate', () => {
     if (mainWindow && !mainWindow.isDestroyed()) {
       mainWindow.show()
       if (mainWindow.isMinimized()) mainWindow.restore()
       mainWindow.focus()
     }
   })
   ```

4. Modify the main window `close` event:
   - On macOS, ALWAYS hide on close instead of destroying, regardless of QE/QV state. Use `app.isQuitting` flag to allow actual quit via ⌘Q or tray Quit.
   - On Windows, keep current behavior (only hide if tray is active).
   ```typescript
   if (isMac) {
     mainWindow.on('close', (e) => {
       if (!app.isQuitting) {
         e.preventDefault()
         mainWindow?.hide()
       }
     })
   }
   ```

5. Ensure `app.isQuitting` is set to `true` in `before-quit`:
   ```typescript
   app.on('before-quit', () => {
     app.isQuitting = true
   })
   ```

Keep all existing Windows behavior unchanged. Only add macOS-specific branches using `isMac`.
```

### Test checkpoint

- [ ] `npm run dev` on macOS → close the window (red traffic light or ⌘W) → app stays in dock
- [ ] Click dock icon → window reappears and is focused
- [ ] ⌘Q quits the app fully (all processes exit)
- [ ] Tray "Quit" also quits fully
- [ ] On Windows: closing window still quits (when tray is off), still hides (when tray is on) — no regression

---

## Phase 2 — Application menu (Edit menu critical for ⌘C/⌘V)

**Why now**: Without this, clipboard shortcuts are broken on macOS. This is a hard blocker for usability.

### Prompt

```
Add a proper macOS application menu to Vicu. Create `src/main/app-menu.ts`:

1. Build a cross-platform menu template:
   - On macOS, include the app-name submenu as the FIRST item with: About, separator, Preferences (⌘,) that shows/focuses the main window and navigates to settings, separator, Services submenu, separator, Hide (role: 'hide'), Hide Others (role: 'hideOthers'), Show All (role: 'unhide'), separator, Quit (role: 'quit')
   - File menu: "New Task" with CmdOrCtrl+N accelerator, separator, Close (role: 'close' on mac, role: 'quit' on windows)
   - Edit menu with roles: undo, redo, separator, cut, copy, paste, pasteAndMatchStyle, selectAll. On macOS also add: separator, Speech submenu with startSpeaking and stopSpeaking roles
   - View menu: reload, forceReload, toggleDevTools, separator, resetZoom, zoomIn, zoomOut, separator, togglefullscreen
   - Window menu: minimize, zoom. On macOS add: separator, front role, separator, window role. On Windows: close role.
   - Help menu with role 'help': a "Documentation" item that opens https://vikunja.io/docs via `shell.openExternal()`.

2. Export a `setupApplicationMenu(getMainWindow: () => BrowserWindow | null)` function. Call `Menu.setApplicationMenu()` inside it.

3. In `src/main/index.ts`, import and call `setupApplicationMenu()` in the `app.whenReady()` block, after creating the main window. Pass a getter: `() => mainWindow`.

Use `isMac` from `./platform` for all branching.
```

### Test checkpoint

- [ ] `npm run dev` on macOS → menu bar shows "Vicu" app menu with About, Preferences, Quit
- [ ] ⌘C, ⌘V, ⌘X work in text inputs throughout the app
- [ ] ⌘Q quits the app
- [ ] ⌘H hides the app
- [ ] Edit → Undo/Redo works in text fields
- [ ] On Windows: no visible menu bar (frameless), but keyboard shortcuts still work

---

## Phase 3 — Main window: titleBarStyle + traffic lights + drag region

**Why now**: The main window is currently `frame: false` which shows no window chrome on macOS. We need native traffic lights.

### Prompt

```
Make the main window macOS-native. 

1. Edit `src/main/window-manager.ts` — `createMainWindow()`:
   Import `isMac` from `./platform`.
   
   Change the BrowserWindow options:
   - On macOS: remove `frame: false`, instead use `titleBarStyle: 'hiddenInset'` and set `trafficLightPosition: { x: 16, y: 14 }`. Also add `vibrancy: 'sidebar'`, `visualEffectState: 'followWindow'`, `backgroundColor: '#00000000'`, and `acceptFirstMouse: true`.
   - On Windows: keep `frame: false` exactly as-is.
   - Both platforms: keep all existing webPreferences (including `sandbox: true`), minWidth, minHeight, show: false, etc.
   
   ```typescript
   const win = new BrowserWindow({
     ...(isMac
       ? {
           titleBarStyle: 'hiddenInset',
           trafficLightPosition: { x: 16, y: 14 },
           vibrancy: 'sidebar',
           visualEffectState: 'followWindow',
           backgroundColor: '#00000000',
           acceptFirstMouse: true,
         }
       : {
           frame: false,
         }),
     // ... keep all other existing options
   })
   ```

   Verify that `sandbox: true` + `vibrancy` + `titleBarStyle: 'hiddenInset'` work together without rendering artifacts.

2. Expose the platform to the renderer. In `src/preload/index.ts`, add to the `api` object:
   ```typescript
   platform: process.platform as 'darwin' | 'win32' | 'linux',
   ```
   Also update the ElectronAPI type in `src/preload/index.d.ts`.
   NOTE: Since `sandbox: true` is set, `process` may not be available in the preload. If so, use `ipcRenderer.sendSync` or expose it via contextBridge from the main process.

3. Edit `src/renderer/components/layout/WindowControls.tsx`:
   - If platform is `'darwin'`, return `null` — macOS uses native traffic lights
   - On Windows, keep the existing minimize/maximize/close buttons unchanged

4. Edit `src/renderer/components/layout/AppShell.tsx`:
   - On macOS, add left padding to the drag region to avoid overlapping traffic lights: `paddingLeft: '80px'`
   - Store platform in a variable: `const isMacRenderer = window.api.platform === 'darwin'`

Keep all Windows rendering exactly the same. 
```

### Test checkpoint

- [ ] Traffic lights (red/yellow/green) visible in top-left
- [ ] Traffic lights vertically centered, not overlapping sidebar content
- [ ] Close hides (Phase 1), minimize to dock, green → fullscreen
- [ ] Window draggable by title bar
- [ ] Custom Windows buttons NOT visible on macOS
- [ ] Vibrancy visible on sidebar (or solid — ok for now, Phase 11 polishes)
- [ ] `sandbox: true` still works — no preload errors
- [ ] On Windows: custom WindowControls still render, no traffic lights

---

## Phase 4 — System tray macOS adaptation

**Why now**: The tray icon and click behavior need macOS-specific handling.

### Prompt

```
Adapt the system tray for macOS. Edit `src/main/tray.ts`:

1. Import `isMac` from `./platform`.

2. In `createTrayIcon()`:
   - On macOS: load the template image files created in Phase 0:
     ```typescript
     if (isMac) {
       const templatePath = join(__dirname, '../../resources/iconTemplate.png')
       try {
         const icon = nativeImage.createFromPath(templatePath)
         if (!icon.isEmpty()) {
           icon.setTemplateImage(true) // CRITICAL for auto-inversion on dark menu bars
           return icon
         }
       } catch { /* fall through to programmatic */ }
     }
     ```
   - If template files don't exist, fall back to programmatic but call `setTemplateImage(true)` on the result.
   - On Windows: keep existing behavior.

3. In `createTray()`:
   - On macOS: call `tray.setIgnoreDoubleClickEvents(true)` for snappier single-click response.
   - On macOS: the `click` event does NOT fire if `setContextMenu()` has been called (macOS convention). Remove the click handler for macOS.
   - On Windows: keep the existing `tray.on('click')` handler.
   
   ```typescript
   if (isMac) {
     tray.setIgnoreDoubleClickEvents(true)
   } else {
     tray.on('click', () => {
       callbacks?.onShowMainWindow()
     })
   }
   tray.setContextMenu(contextMenu) // both platforms
   ```

Keep all Windows tray behavior identical.
```

### Test checkpoint

- [ ] Tray icon in menu bar, visible in light and dark menus (auto-inverts)
- [ ] Clicking tray shows context menu (not toggling window)
- [ ] All menu items work
- [ ] On Windows: left-click toggles window, right-click shows menu (unchanged)

---

## Phase 5 — Quick Entry + Quick View windows on macOS

**Why now**: Verify popup windows work and add minor macOS safety measures.

> **Key finding**: vikunja-quick-entry already runs on macOS with the EXACT same BrowserWindow options Vicu uses (`frame: false, transparent: true, hasShadow: false, alwaysOnTop: true, SHADOW_PADDING = 20`). No window option changes are needed.

### Prompt

```
Verify and minimally adjust Quick Entry and Quick View windows for macOS.

IMPORTANT: The companion app vikunja-quick-entry already works on macOS with the 
exact same BrowserWindow options that Vicu uses for Quick Entry and Quick View 
(frame: false, transparent: true, hasShadow: false, alwaysOnTop: true, 
SHADOW_PADDING = 20). No changes to window creation options are needed.

Do these minimal changes only:

1. Edit `src/main/window-manager.ts` — after creating Quick Entry and Quick View 
   windows, add on macOS only:
   ```typescript
   import { isMac } from './platform'
   
   // In createQuickEntryWindow, after new BrowserWindow():
   if (isMac) {
     win.setWindowButtonVisibility(false)
   }
   
   // In createQuickViewWindow, after new BrowserWindow():
   if (isMac) {
     win.setWindowButtonVisibility(false)
   }
   ```
   This ensures no traffic lights accidentally appear on these frameless popups.

2. Edit `src/main/focus.ts` — add a comment explaining macOS behavior:
   ```typescript
   // macOS: focus returns automatically to the previously active app when our
   // window hides. No dummy-window trick needed (that's a Windows workaround).
   if (process.platform !== 'win32') return
   ```

3. Do NOT change SHADOW_PADDING, do NOT use type: 'panel', do NOT change 
   alwaysOnTop level, do NOT change hasShadow. The current options work on macOS.

4. In `src/main/index.ts`, the showQuickEntry() and showQuickView() functions:
   - The centering logic using screen.getCursorScreenPoint() works on macOS, no changes.
   - The blur-to-hide behavior works the same.
   - Skip prewarmUrlReader() on macOS: guard with `if (isWindows)`.
```

### Test checkpoint

- [ ] Quick Entry hotkey → popup appears floating above all windows
- [ ] No traffic lights on the popup
- [ ] Clicking outside dismisses it
- [ ] Focus returns to previously active app (e.g., Chrome)
- [ ] Quick Entry appears above fullscreen apps
- [ ] Quick View works the same way
- [ ] Position saving/restoring works
- [ ] On Windows: no changes to shadow, transparency, or behavior

---

## Phase 6 — Global shortcuts: CommandOrControl + macOS defaults + modifier labels

**Why now**: Shortcuts need ⌘ on macOS, the defaults need to change, and the settings UI shows "Ctrl"/"Alt" hardcoded.

### Prompt

```
Fix global shortcuts and their UI labels for macOS. Three parts:

PART 1 — macOS-specific default hotkeys.

Current defaults "Alt+Shift+A" and "Alt+Shift+B" are broken on macOS (Option+letter produces special characters).

Edit `src/main/config.ts` (or wherever defaults are applied):
- macOS Quick Entry default: "Command+Shift+Space" 
- macOS Quick View default: "Command+Shift+B"
- Windows defaults: keep unchanged
- Auto-migrate: if platform is macOS AND stored hotkey is exactly "Alt+Shift+A" or "Alt+Shift+B", migrate to macOS default ONCE. Add `hotkeys_migrated_macos?: boolean` flag to track this.

PART 2 — Shortcut registration.

Electron's globalShortcut handles cross-platform mapping. No changes likely needed. Test thoroughly.

PART 3 — UI labels.

1. Edit `src/renderer/components/settings/QuickEntrySettings.tsx`:
   - "Project Cycle Modifier" radio buttons: on macOS show "⌘ Cmd", "⌥ Option", "⌘⌥ Cmd+Option" instead of "Ctrl", "Alt", "Ctrl+Alt".
   - Config VALUES stay the same — only display labels change.

2. Edit the HotkeyRecorder component:
   - Display: translate to macOS symbols (⌘, ⌥, ⇧, ⌃)
   - Recording: map `e.metaKey` → "Command" on macOS
   - Store Electron-standard names. Symbols are display-only.

3. Edit `src/renderer/components/settings/BrowserSettings.tsx`:
   - "Ctrl+L" → "⌘L" on macOS

4. Edit `src/main/index.ts` — `app.setLoginItemSettings()`:
   - On macOS with QE/QV enabled, add `openAsHidden: true, name: 'Vicu'`

Use `window.api.platform` in all renderer files.
```

### Test checkpoint

- [ ] macOS: default hotkeys auto-migrated to Cmd+Shift+Space / Cmd+Shift+B
- [ ] Quick Entry and Quick View hotkeys work
- [ ] Settings: modifier options show ⌘/⌥ symbols
- [ ] HotkeyRecorder displays macOS symbols, stores Electron names
- [ ] Browser settings shows "⌘L"
- [ ] On Windows: labels show Ctrl/Alt, defaults unchanged

---

## Phase 7 — macOS foreground app detection (port from vikunja-quick-entry)

**Why now**: Enables Obsidian integration and browser URL detection on macOS.

> **Key finding**: vikunja-quick-entry's `src/obsidian-client.js` already has working dual-platform foreground detection. Port it directly — no new `platform-window/` abstraction needed.

### Prompt

```
Add macOS foreground app detection by porting from vikunja-quick-entry.

The companion app vikunja-quick-entry (in this project's knowledge) already has 
working macOS foreground detection in src/obsidian-client.js. Port that approach 
directly into Vicu's src/main/obsidian-client.ts.

1. Add macOS JXA foreground detection to src/main/obsidian-client.ts:
   - Add `import { execFile } from 'child_process'`
   - Copy the JXA_FOREGROUND_SCRIPT constant from vikunja-quick-entry's 
     obsidian-client.js — the JXA code that gets the frontmost process name 
     and bundle ID via System Events:
     ```typescript
     const JXA_FOREGROUND_SCRIPT = `(() => {
       const se = Application("System Events");
       const procs = se.processes.whose({frontmost: true});
       if (procs.length === 0) return "null";
       const proc = procs[0];
       const name = proc.displayedName();
       let bid = ""; try { bid = proc.bundleIdentifier(); } catch(e) {}
       return JSON.stringify({ processName: name, bundleId: bid });
     })()`;
     ```
   - Add async helper using execFile (NOT execFileSync — would block 30-100ms):
     ```typescript
     function getForegroundAppMacOS(): Promise<{processName: string, bundleId: string} | null> {
       return new Promise((resolve) => {
         execFile('osascript', ['-l', 'JavaScript', '-e', JXA_FOREGROUND_SCRIPT],
           { timeout: 2000 }, (err, stdout) => {
             if (err) { resolve(null); return; }
             try {
               const result = JSON.parse(stdout.trim());
               resolve(result);
             } catch { resolve(null); }
           });
       });
     }
     ```

2. Make getForegroundProcessName() async, matching vikunja-quick-entry's pattern:
   ```typescript
   export async function getForegroundProcessName(): Promise<string> {
     if (process.platform === 'win32') {
       return getForegroundProcessNameSync()
     }
     if (process.platform === 'darwin') {
       const app = await getForegroundAppMacOS()
       return app ? app.processName : ''
     }
     return ''
   }
   ```
   Keep the existing sync helper (getForegroundProcessNameSync or equivalent) 
   for the Windows path. It's just wrapped now.

3. Make isObsidianForeground() async:
   ```typescript
   export async function isObsidianForeground(): Promise<boolean> {
     if (process.platform === 'win32') {
       return getForegroundProcessNameSync() === 'obsidian'
     }
     if (process.platform === 'darwin') {
       const app = await getForegroundAppMacOS()
       if (!app) return false
       return app.processName === 'Obsidian' || app.bundleId === 'md.obsidian'
     }
     return false
   }
   ```

4. Keep ALL existing koffi/Win32 code exactly as-is. Don't move it.

5. Update callers in src/main/index.ts — showQuickEntry() is already async, 
   so add `await` before isObsidianForeground() and getForegroundProcessName().

Do NOT create a separate platform-window/ directory. Keep everything in 
obsidian-client.ts — this matches vikunja-quick-entry's proven single-file approach.
```

### Test checkpoint

- [ ] `npm run build` succeeds (watch for TypeScript errors from sync→async)
- [ ] On macOS with Chrome focused: `getForegroundProcessName()` returns "Google Chrome"
- [ ] On macOS with Obsidian focused: `isObsidianForeground()` returns true
- [ ] Quick Entry hotkey → detects foreground app within ~200ms (no lag)
- [ ] On Windows: koffi detection still works unchanged
- [ ] If osascript fails: functions return null/empty gracefully

---

## Phase 8 — macOS browser URL reading (port from vikunja-quick-entry)

**Why now**: With foreground detection working, we can now get browser URLs on macOS.

> **Key finding**: vikunja-quick-entry's `src/window-url-reader.js` has complete, working AppleScript browser URL detection. Port it directly.

### Prompt

```
Add macOS browser URL detection by porting from vikunja-quick-entry.

Port the macOS code from vikunja-quick-entry's src/window-url-reader.js into 
Vicu's src/main/window-url-reader.ts. Convert JS to TS.

1. Add getBrowserUrlMacOS() — copy the exact function from vikunja-quick-entry:
   - Chromium browsers: `using terms from application "Google Chrome"` → URL + title
   - Safari: `tell application "Safari"` → URL of front document + name
   - Firefox: System Events accessibility fallback (unreliable, try/catch)
   - Tab-separated stdout parsing
   - URL validation (must start with http:// or https://)
   - Title truncation (40 chars with "...")

2. Make BROWSER_PROCESSES platform-aware — copy vikunja-quick-entry's exact sets:
   ```typescript
   export const BROWSER_PROCESSES: Set<string> = new Set(
     process.platform === 'darwin'
       ? ['Google Chrome', 'Firefox', 'Microsoft Edge', 'Brave Browser', 'Safari', 'Opera', 'Vivaldi', 'Arc']
       : ['chrome', 'firefox', 'msedge', 'brave', 'opera', 'vivaldi']
   )
   ```

3. In getBrowserUrlFromWindow():
   - On macOS: call getBrowserUrlMacOS(processName)
   - On Windows: keep existing PowerShell approach unchanged

4. In prewarmUrlReader() and shutdownUrlReader():
   - Add `if (process.platform !== 'win32') return` at the top (no prewarm on macOS)

Keep all Windows code unchanged.
```

### Test checkpoint

- [ ] Chrome → Quick Entry → URL and title captured
- [ ] Safari → URL and title captured
- [ ] Edge, Brave (if installed) → URL captured
- [ ] Firefox → returns null gracefully
- [ ] First time: macOS shows "Vicu wants to control Chrome" → allow → works
- [ ] On Windows: PowerShell URL detection unchanged
- [ ] Browser extension still takes priority when installed

---

## Phase 9 — Browser native messaging host registration on macOS

**Why now**: The browser extension companion needs macOS-specific manifest locations.

> **Key finding**: vikunja-quick-entry's `src/browser-host-registration.js` has a critical detail — the shell wrapper must embed the full absolute path to `node` (resolved via `which node`) because macOS GUI apps have a minimal PATH.

### Prompt

```
Add macOS native messaging host registration by porting from vikunja-quick-entry.

Port the macOS code from vikunja-quick-entry's src/browser-host-registration.js 
into Vicu's src/main/browser-host-registration.ts. Convert JS to TS.

1. Add macOS manifest path helpers:
   - Chrome: ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
   - Firefox: ~/Library/Application Support/Mozilla/NativeMessagingHosts/
   - Edge: ~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/

2. Add ensureShellWrapper() with the `which node` trick from vikunja-quick-entry.
   CRITICAL: macOS GUI apps have PATH = /usr/bin:/bin:/usr/sbin:/sbin which 
   won't find node from Homebrew/nvm/fnm. Must resolve the full path:
   ```typescript
   function ensureShellWrapper(): string {
     const shPath = join(app.getPath('userData'), 'vicu-bridge.sh')
     const bridgeJs = getBridgePath()
     let nodePath = '/usr/bin/env node'
     try {
       const resolved = execSync('which node', { timeout: 3000 }).toString().trim()
       if (resolved) nodePath = resolved
     } catch { /* fallback to env node */ }
     const content = `#!/bin/bash\nexec "${nodePath}" "${bridgeJs}"\n`
     writeFileSync(shPath, content, { mode: 0o755 })
     return shPath
   }
   ```
   The wrapper is in app.getPath('userData') — NOT inside the .app bundle 
   (that would invalidate the code signature).

3. Port registerChromeHost() macOS branch: write manifest to Chrome + Edge dirs.

4. Port registerFirefoxHost() macOS branch: write manifest to Mozilla dir.
   Firefox doesn't auto-create the dir — use mkdirSync({ recursive: true }).

5. Port unregisterHosts() and isRegistered() macOS branches.

6. Remove the `if (process.platform !== 'win32') return` early exits and 
   replace with platform-aware logic.

Keep all Windows registry code unchanged.
```

### Test checkpoint

- [ ] Settings → Browser → "Re-register Bridge" succeeds
- [ ] Chrome manifest at `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
- [ ] Shell wrapper at `~/Library/Application Support/Vicu/vicu-bridge.sh`
- [ ] Wrapper is executable and embeds full node path (not just `/usr/bin/env node`)
- [ ] `isRegistered()` returns true after registration
- [ ] Unregister removes all manifests + wrapper
- [ ] On Windows: registry-based registration unchanged

---

## Phase 10 — Forge config: DMG maker + code signing + entitlements

**Why now**: You can't distribute on macOS without signing and a DMG.

> **Key finding from vikunja-quick-entry**: Do NOT unconditionally add `osxSign`. Without a Developer certificate, FusesPlugin handles ad-hoc re-signing via `resetAdHocDarwinSignature: true`. Adding `osxSign` breaks this — the timestamp server rejects ad-hoc signatures, causing `SIGKILL (Code Signature Invalid)` on Apple Silicon.

### Prompt

```
Set up Electron Forge for macOS distribution.

1. First, determine where the forge config lives:
   - Check package.json for config.forge key
   - Check for forge.config.ts, forge.config.js at the project root
   - If none exist, create forge.config.ts and add to package.json:
     `"config": { "forge": "./forge.config.ts" }`

2. Write the forge config:
   ```typescript
   import type { ForgeConfig } from '@electron-forge/shared-types'
   import path from 'path'

   const config: ForgeConfig = {
     packagerConfig: {
       name: 'Vicu',
       executableName: 'vicu',
       appBundleId: 'com.vicu.app',
       appCategoryType: 'public.app-category.productivity',
       icon: path.resolve(__dirname, 'resources/icon'),
       asar: true,
       asarUnpack: ['node_modules/koffi/**'],
       extraResource: [
         'resources/native-messaging-host',
         'resources/get-browser-url.ps1',
       ],
       // macOS code signing — ONLY when a real certificate is available.
       // Without osxSign, FusesPlugin sets resetAdHocDarwinSignature: true 
       // and handles ad-hoc codesigning automatically. Adding osxSign without
       // a certificate breaks signing on Apple Silicon (SIGKILL).
       ...(process.platform === 'darwin' && process.env.APPLE_ID ? {
         osxSign: {
           optionsForFile: () => ({
             entitlements: path.resolve(__dirname, 'build/entitlements.mac.plist'),
           }),
         },
         osxNotarize: {
           appleId: process.env.APPLE_ID,
           appleIdPassword: process.env.APPLE_ID_PASSWORD!,
           teamId: process.env.APPLE_TEAM_ID!,
         },
       } : {}),
     },
     makers: [
       {
         name: '@electron-forge/maker-dmg',
         config: { name: 'Vicu', format: 'ULFO' },
         platforms: ['darwin'],
       },
       {
         name: '@electron-forge/maker-zip',
         platforms: ['darwin'],
       },
       {
         name: '@electron-forge/maker-wix',
         config: {},
         platforms: ['win32'],
       },
       {
         name: '@electron-forge/maker-deb',
         config: {},
         platforms: ['linux'],
       },
     ],
   }

   export default config
   ```

3. Install maker-zip: `npm install --save-dev @electron-forge/maker-zip`

4. Create `build/entitlements.mac.plist`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>com.apple.security.cs.allow-jit</key>
       <true/>
       <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
       <true/>
       <key>com.apple.security.cs.disable-library-validation</key>
       <true/>
       <key>com.apple.security.network.client</key>
       <true/>
       <key>com.apple.security.network.server</key>
       <true/>
       <key>com.apple.security.automation.apple-events</key>
       <true/>
   </dict>
   </plist>
   ```

5. Verify resources/icon.icns exists (Phase 0).
```

### Test checkpoint

- [ ] `npm run build` succeeds
- [ ] forge.config.ts exists, referenced from package.json
- [ ] `npm run package` creates Vicu.app that runs when double-clicked
- [ ] `npm run make` creates .dmg
- [ ] App icon is correct (not generic Electron)
- [ ] Without APPLE_ID: builds succeed with ad-hoc signing
- [ ] On Windows: `npm run make` still produces .msi

---

## Phase 11 — Dark mode, vibrancy, and macOS visual polish

**Why now**: The app works functionally; now make it feel native.

### Prompt

```
Add macOS visual polish to Vicu.

1. Dark mode — edit `src/main/index.ts`:
   ```typescript
   import { nativeTheme } from 'electron'
   const theme = config?.theme ?? 'system'
   nativeTheme.themeSource = theme === 'system' ? 'system' : theme
   ```
   Also set this when theme config changes.

2. Sidebar transparency on macOS:
   Set a platform data attribute for CSS targeting. In preload or renderer entry:
   ```typescript
   document.documentElement.dataset.platform = process.platform
   ```
   (If sandbox prevents this, use IPC to get platform first.)
   
   Then in the CSS where --bg-sidebar is defined:
   ```css
   [data-platform="darwin"] {
     --bg-sidebar: rgba(0, 0, 0, 0.02);
   }
   @media (prefers-color-scheme: dark) {
     [data-platform="darwin"] {
       --bg-sidebar: rgba(255, 255, 255, 0.02);
     }
   }
   ```

3. Verify font stack includes `-apple-system, BlinkMacSystemFont` at the start.

4. Verify no CSS border-radius on root conflicts with macOS rounded corners.

Keep changes minimal.
```

### Test checkpoint

- [ ] Sidebar has subtle vibrancy translucency
- [ ] System appearance toggle (light/dark) updates the app
- [ ] Dark/light override in Vicu settings works
- [ ] No visual glitches at window corners
- [ ] On Windows: no visual changes

---

## Phase 12 — CI/CD: GitHub Actions for macOS builds

**Why now**: Everything works locally; time to automate.

### Prompt

```
Add GitHub Actions workflow for macOS builds. Create `.github/workflows/build-macos.yml`:

1. Trigger: push to main, PRs targeting main, workflow_dispatch.

2. Matrix: 
   - `{ arch: 'arm64', runner: 'macos-15' }` (Apple Silicon)
   - `{ arch: 'x64', runner: 'macos-13' }` (Intel)

3. Steps:
   a. actions/checkout@v4
   b. actions/setup-node@v4 (node 20, cache npm)
   c. Cache ~/.cache/electron
   d. Conditional signing certificate import (only if BUILD_CERTIFICATE_BASE64 secret exists)
   e. npm ci
   f. npm run build
   g. npm run make -- --arch=${{ matrix.arch }} (timeout 30min)
   h. Upload .dmg and .zip artifacts
   i. Cleanup keychain (always)

4. Comment block documenting required secrets.

5. Must work WITHOUT secrets (unsigned builds).

Do NOT modify existing Windows CI.
```

### Test checkpoint

- [ ] Valid YAML
- [ ] Push to branch → both jobs run and produce artifacts
- [ ] Artifacts downloadable
- [ ] Existing Windows CI unaffected

---

## Phase 13 — Settings UI: macOS-specific copy and descriptions

**Why now**: Polish pass on settings text.

### Prompt

```
Update settings UI text for cross-platform accuracy. Text-only pass.

1. BrowserSettings.tsx:
   - macOS: "Vicu reads the URL from the active browser tab using AppleScript. Works with Chrome, Safari, Edge, Brave, Opera, Vivaldi, and Arc. Firefox has limited support."
   - macOS: "On first use, macOS will ask you to allow Vicu to control the browser."
   - Windows: keep current text unchanged.

2. QuickEntrySettings.tsx:
   - Verify all modifier labels use ⌘/⌥ on macOS (Phase 6 should have done this).
   - Verify "Launch on startup" text is platform-neutral.

3. NotificationSettings.tsx (if it exists):
   - Add macOS note: "On macOS, the first notification will prompt you to allow notifications from Vicu."

4. General scan of all renderer .tsx/.ts files for:
   - "Windows" (the OS), "PowerShell", "registry", ".bat", ".exe"
   - "Ctrl+" without platform branching
   Replace with platform-aware alternatives.

Keep changes minimal — only fix text that's wrong on macOS.
```

### Test checkpoint

- [ ] No "Windows", "PowerShell", "registry", ".bat" in settings on macOS
- [ ] Browser text mentions AppleScript/Safari/Arc
- [ ] All shortcuts show ⌘/⌥ symbols on macOS
- [ ] On Windows: all text unchanged

---

## Phase 14 — Final integration test + cleanup

**Why now**: Everything is implemented. Final verification.

### Prompt

```
Do a final review pass of the entire macOS integration. Fix any issues found.

1. Search src/main/ for:
   - process.platform checks without macOS counterpart
   - Hardcoded Windows paths, registry refs, PowerShell refs
   - koffi imports outside of Windows-guarded code
   - execSync calls that could block

2. Search src/renderer/ for:
   - Hardcoded "Ctrl+" without platform branching
   - CSS assuming Windows window dimensions

3. Verify package.json, electron.vite.config.ts, forge.config.ts.

4. Test OIDC login flow on macOS.

5. Test notifications on macOS (permission prompt, clicks, persistence).

6. Update CLAUDE.md with final architecture notes:
   - Platform-specific code locations
   - Known macOS limitations
   - Default hotkeys and migration logic
   - Entitlements

Fix all issues found.
```

### Test checkpoint — FULL REGRESSION

**macOS:**
- [ ] `npm run dev` starts without errors
- [ ] Traffic lights, dragging, vibrancy
- [ ] Close → hides, dock click → reappears, ⌘Q quits
- [ ] ⌘C/⌘V/⌘X work, ⌘, opens Preferences
- [ ] App menu fully functional
- [ ] Quick Entry: Cmd+Shift+Space works, URL detection, Obsidian detection
- [ ] Quick View: hotkey works, tasks display
- [ ] Tray: icon visible, context menu works
- [ ] Settings: ⌘/⌥ symbols, AppleScript text, notification note
- [ ] Dark mode follows system + overrides work
- [ ] Notifications work
- [ ] OIDC login (if SSO configured)
- [ ] Launch on startup toggle
- [ ] Browser host registration at correct paths
- [ ] `npm run make` produces working .dmg with correct icon

**Windows (regression):**
- [ ] Custom WindowControls, frame: false
- [ ] koffi detection, PowerShell URL reader
- [ ] Tray: left-click toggles, right-click menu
- [ ] Default hotkeys Alt+Shift+A/B, labels show Ctrl/Alt
- [ ] `npm run make` produces .msi

---

## Appendix A: Phase dependency graph

```
Phase 0 (platform constant + icons)
  └→ Phase 1 (lifecycle) ← CRITICAL — app quits on close without this
       └→ Phase 2 (app menu) ← CRITICAL — ⌘C/⌘V broken without this
            └→ Phase 3 (window chrome + traffic lights)
                 ├→ Phase 4 (tray icon + behavior)
                 ├→ Phase 5 (quick entry/view — verify only)
                 └→ Phase 6 (shortcuts + defaults + UI labels)
                      └→ Phase 7 (foreground detection — port from vikunja-quick-entry)
                           └→ Phase 8 (browser URL — port from vikunja-quick-entry)
                                └→ Phase 9 (native messaging — port from vikunja-quick-entry)
Phase 10 (forge + signing + entitlements) ← can start after Phase 3
Phase 11 (visual polish — vibrancy, dark mode) ← after Phase 3
Phase 12 (CI/CD) ← after Phase 10
Phase 13 (settings text) ← after Phase 6
Phase 14 (final review + regression) ← after ALL phases
```

## Appendix B: Key files touched per phase

| Phase | Files modified | Files created |
|-------|---------------|---------------|
| 0 | CLAUDE.md | `src/main/platform.ts`, `resources/icon.icns`, `resources/iconTemplate.png`, `resources/iconTemplate@2x.png` |
| 1 | `src/main/index.ts` | — |
| 2 | `src/main/index.ts` | `src/main/app-menu.ts` |
| 3 | `src/main/window-manager.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `WindowControls.tsx`, `AppShell.tsx` | — |
| 4 | `src/main/tray.ts` | — |
| 5 | `src/main/window-manager.ts`, `src/main/focus.ts` | — |
| 6 | `src/main/index.ts`, `src/main/config.ts`, `QuickEntrySettings.tsx`, `BrowserSettings.tsx`, HotkeyRecorder | — |
| 7 | `src/main/obsidian-client.ts`, `src/main/index.ts` | — |
| 8 | `src/main/window-url-reader.ts` | — |
| 9 | `src/main/browser-host-registration.ts` | — |
| 10 | `package.json` | `forge.config.ts`, `build/entitlements.mac.plist` |
| 11 | `src/main/index.ts`, theme CSS, `src/preload/index.ts` | — |
| 12 | — | `.github/workflows/build-macos.yml` |
| 13 | renderer `.tsx` files | — |
| 14 | `CLAUDE.md`, various cleanup | — |

## Appendix C: Known macOS limitations

1. **Firefox URL detection unreliable** — no AppleScript dictionary
2. **Automation permission prompt** — first browser URL detection triggers system dialog
3. **Foreground detection latency** — osascript ~50ms vs koffi ~1μs (not perceptible)
4. **Option key hotkey conflicts** — defaults use Cmd+Shift instead
5. **Code signing for distribution** — unsigned apps trigger Gatekeeper warnings
6. **Apple Silicon vs Intel** — ship separate builds, koffi has prebuilt binaries for both

## Appendix D: Changes from v2 → v3

| Phase | What changed | Why |
|-------|-------------|-----|
| 0 | CLAUDE.md text updated: "no platform-window/ dir", "popups work identically" | Reflects actual architecture |
| 5 | **Dramatically simplified** — no shadow padding change, no panel type, no window level. Just `setWindowButtonVisibility(false)` | vikunja-quick-entry proves identical options work |
| 7 | **Simplified** — port into obsidian-client.ts directly, no platform-window/ abstraction | Matches vikunja-quick-entry's single-file approach |
| 8 | **Simplified** — copy exact AppleScript templates from vikunja-quick-entry | Proven code, less guesswork |
| 9 | **Bug fix** — added `which node` trick for shell wrapper | macOS GUI apps can't find Homebrew/nvm node |
| 10 | **Bug fix** — osxSign is now fully conditional on APPLE_ID | Without certificate, FusesPlugin handles ad-hoc signing |
