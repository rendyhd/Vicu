# Browser Link Integration Spec

## Overview

Add browser-link-awareness to Quick Entry: when the user presses the Quick Entry hotkey while Chrome or Firefox is focused, detect the active tab URL and let the user optionally link it to the task. Works alongside the existing Obsidian integration — both use Ctrl+L, with Obsidian taking priority when both are available.

## Architecture

```
┌─ Browser Extension ─────────────────────────────────────────┐
│  background.js (service worker / background script)          │
│  Monitors: tabs.onActivated, tabs.onUpdated,                 │
│            windows.onFocusChanged                            │
│  Sends: { url, title } via runtime.connectNative()           │
└──────────────────────┬───────────────────────────────────────┘
                       │ Native Messaging (stdin/stdout)
                       ▼
┌─ Bridge Process ────────────────────────────────────────────┐
│  vicu-bridge.js (Node.js script, shipped with Vicu)          │
│  Reads native messaging protocol from stdin                  │
│  Writes { url, title, timestamp } to:                        │
│    {userData}/browser-context.json                            │
└──────────────────────────────────────────────────────────────┘
                       │ File on disk
                       ▼
┌─ Electron Main Process ────────────────────────────────────┐
│  showQuickEntry():                                           │
│  1. Read browser-context.json                                │
│  2. If timestamp < 3s old → valid browser context            │
│  3. Send 'browser-context' to Quick Entry renderer           │
│  (Only if no Obsidian context was found — Obsidian wins)     │
└──────────────────────────────────────────────────────────────┘
```

### Why file-based IPC (not sockets)?

The bridge process is spawned by the browser, not by Electron. It may start before Electron, or Electron may not be running. A file is the simplest coordination mechanism — no server to maintain, no connection errors, no port conflicts. The bridge writes atomically; Electron reads on-demand. Staleness is checked via timestamp.

---

## Component 1: Browser Extension (`extensions/browser/`)

Single codebase targeting Chrome (MV3) and Firefox (MV3). Lives in the Vicu repo under `extensions/browser/`.

### File structure

```
extensions/browser/
├── manifest.json          # Chrome MV3
├── manifest.firefox.json  # Firefox MV3 overrides
├── background.js          # Service worker (Chrome) / background script (Firefox)
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

### `manifest.json` (Chrome MV3)

```json
{
  "manifest_version": 3,
  "name": "Vicu Browser Link",
  "version": "1.0.0",
  "description": "Links browser tabs to Vicu tasks via Quick Entry",
  "permissions": ["tabs", "nativeMessaging"],
  "background": {
    "service_worker": "background.js"
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "key": "DEVELOPMENT_KEY_HERE"
}
```

The `"key"` field gives a stable extension ID during development. Remove it for Chrome Web Store submission (the store assigns the ID). Document the resulting extension ID — it goes into the native messaging host manifest.

### `manifest.firefox.json` (Firefox overrides)

For Firefox, merge these fields on top of manifest.json during build:

```json
{
  "background": {
    "scripts": ["background.js"]
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "browser-link@vicu.app",
      "strict_min_version": "109.0"
    }
  }
}
```

Firefox 109+ supports MV3. The `scripts` key replaces `service_worker`. Firefox ignores `service_worker` if `scripts` is present, and Chrome ignores `scripts` if `service_worker` is present — so for simplicity during development, you can include BOTH keys in a single manifest and both browsers will work.

### `background.js`

```javascript
const NATIVE_HOST = 'com.vicu.browser'
const INTERNAL_URL_PREFIXES = [
  'chrome://', 'chrome-extension://', 'about:', 'edge://',
  'moz-extension://', 'firefox:', 'devtools://', 'data:',
  'file://', 'view-source:', 'blob:'
]

let port = null

function connectToHost() {
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST)

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError
      console.warn('Vicu bridge disconnected:', err?.message || 'unknown')
      port = null
      // Retry after delay — bridge may not be installed yet
      setTimeout(connectToHost, 5000)
    })

    // We don't expect messages FROM the host, but listen anyway
    port.onMessage.addListener((msg) => {
      // Reserved for future: host could send config, ack, etc.
    })
  } catch (e) {
    console.warn('Vicu: cannot connect to native host:', e)
    setTimeout(connectToHost, 10000)
  }
}

function isInternalUrl(url) {
  if (!url) return true
  return INTERNAL_URL_PREFIXES.some(prefix => url.startsWith(prefix))
}

function sendTabContext(tab) {
  if (!port) return
  if (!tab?.url || isInternalUrl(tab.url)) {
    // Send null to clear context when on internal pages
    try { port.postMessage({ type: 'clear' }) } catch {}
    return
  }
  try {
    port.postMessage({
      type: 'tab',
      url: tab.url,
      title: tab.title || '',
    })
  } catch (e) {
    console.warn('Vicu: failed to send tab context:', e)
  }
}

async function sendActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (tab) sendTabContext(tab)
  } catch {}
}

// Tab switched
chrome.tabs.onActivated.addListener(() => sendActiveTab())

// URL changed in current tab
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    sendTabContext(tab)
  }
})

// Window focus changed
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  sendActiveTab()
})

// Connect on startup
connectToHost()
```

Key behaviors:
- Uses `runtime.connectNative()` for a persistent connection (bridge stays alive)
- Reconnects automatically on disconnect (5s/10s delay)
- Filters out internal URLs (chrome://, about:, etc.)
- Sends `{ type: 'clear' }` when on internal pages to avoid stale context
- `chrome.*` namespace works in both Chrome and Firefox MV3

### Extension icons

Generate simple 16/48/128px PNG icons for the extension. Use the Vicu logo or a simple link icon. These are for the Chrome Web Store listing and Firefox Add-ons page, not shown in browser UI during normal use (no popup, no browser action).

---

## Component 2: Native Messaging Bridge (`resources/native-messaging-host/`)

### File structure

```
resources/native-messaging-host/
├── vicu-bridge.js                 # The bridge script
├── com.vicu.browser.json          # Chrome host manifest template
└── com.vicu.browser.firefox.json  # Firefox host manifest template
```

### `vicu-bridge.js`

```javascript
#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

// Determine context file path (matches Electron's userData)
function getContextFilePath() {
  const appName = 'vicu'
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName, 'browser-context.json')
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', appName, 'browser-context.json')
    default: // linux
      return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName, 'browser-context.json')
  }
}

const CONTEXT_FILE = getContextFilePath()

// Ensure directory exists
const dir = path.dirname(CONTEXT_FILE)
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true })
}

// Read a native messaging message from stdin
// Protocol: 4-byte LE uint32 length prefix + JSON body
function readMessage(callback) {
  let buffer = Buffer.alloc(0)
  let messageLength = null

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])

    while (true) {
      if (messageLength === null) {
        if (buffer.length < 4) return
        messageLength = buffer.readUInt32LE(0)
        buffer = buffer.slice(4)
      }

      if (buffer.length < messageLength) return

      const messageBytes = buffer.slice(0, messageLength)
      buffer = buffer.slice(messageLength)
      messageLength = null

      try {
        const message = JSON.parse(messageBytes.toString('utf8'))
        callback(message)
      } catch (e) {
        // Malformed JSON, skip
      }
    }
  })
}

// Write context to file atomically
function writeContext(data) {
  const context = {
    url: data.url,
    title: data.title,
    timestamp: Date.now(),
  }
  const tmp = CONTEXT_FILE + '.tmp'
  try {
    fs.writeFileSync(tmp, JSON.stringify(context), 'utf8')
    fs.renameSync(tmp, CONTEXT_FILE)
  } catch (e) {
    // If rename fails (cross-device on Windows), fall back to direct write
    try { fs.writeFileSync(CONTEXT_FILE, JSON.stringify(context), 'utf8') } catch {}
  }
}

// Clear context
function clearContext() {
  try { fs.unlinkSync(CONTEXT_FILE) } catch {}
}

// Handle stdin close (browser closed the connection)
process.stdin.on('end', () => {
  clearContext()
  process.exit(0)
})

// Process messages
readMessage((msg) => {
  if (msg.type === 'tab') {
    writeContext(msg)
  } else if (msg.type === 'clear') {
    clearContext()
  }
})
```

Key behaviors:
- Reads native messaging protocol from stdin (4-byte LE prefix + JSON)
- Writes `{ url, title, timestamp }` to `{userData}/browser-context.json`
- Atomic write via tmp+rename
- Clears context file on stdin close (browser disconnected)
- Finds the correct userData path per platform (matches Electron's `app.getPath('userData')`)
- No dependencies — pure Node.js stdlib

### Host manifests

**`com.vicu.browser.json` (Chrome template):**

```json
{
  "name": "com.vicu.browser",
  "description": "Vicu browser link bridge",
  "path": "BRIDGE_PATH_PLACEHOLDER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://EXTENSION_ID_PLACEHOLDER/"
  ]
}
```

**`com.vicu.browser.firefox.json` (Firefox template):**

```json
{
  "name": "com.vicu.browser",
  "description": "Vicu browser link bridge",
  "path": "BRIDGE_PATH_PLACEHOLDER",
  "type": "stdio",
  "allowed_extensions": [
    "browser-link@vicu.app"
  ]
}
```

The `BRIDGE_PATH_PLACEHOLDER` and `EXTENSION_ID_PLACEHOLDER` are replaced at registration time by the Electron app.

---

## Component 3: Host Registration (`src/main/browser-host-registration.ts` — NEW)

Native messaging requires host manifests to be registered in OS-specific locations. Vicu handles this automatically on first run or when browser integration is enabled in settings.

### Registration paths

**Chrome:**
- Windows: Registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.vicu.browser` → value = path to manifest JSON
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.vicu.browser.json`
- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.vicu.browser.json`

**Firefox:**
- Windows: Registry key `HKCU\Software\Mozilla\NativeMessagingHosts\com.vicu.browser` → value = path to manifest JSON
- macOS: `~/Library/Application Support/Mozilla/NativeMessagingHosts/com.vicu.browser.json`
- Linux: `~/.mozilla/native-messaging-hosts/com.vicu.browser.json`

### Module: `src/main/browser-host-registration.ts`

```typescript
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

const HOST_NAME = 'com.vicu.browser'

interface RegistrationOptions {
  chromeExtensionId: string     // From settings or hardcoded after publishing
  firefoxExtensionId: string    // 'browser-link@vicu.app'
}
```

**Functions:**

**`getBridgePath(): string`**
- In packaged app: `path.join(process.resourcesPath, 'native-messaging-host', 'vicu-bridge.js')`
- In dev: `path.join(app.getAppPath(), 'resources', 'native-messaging-host', 'vicu-bridge.js')`
- On Windows, the manifest `path` must point to a `.bat` wrapper (Chrome doesn't execute `.js` directly):
  ```bat
  @echo off
  "PATH_TO_NODE" "PATH_TO_BRIDGE_JS"
  ```
  Or use the packaged app's bundled Node.js executable. Alternatively, use `pkg` to compile the bridge to a standalone binary.

**`registerChromeHost(extensionId: string): void`**
- Generates manifest JSON with correct `path` and `allowed_origins`
- Writes manifest to appropriate location
- On Windows: also creates registry key

**`registerFirefoxHost(): void`**
- Generates manifest JSON with correct `path` and `allowed_extensions`
- Writes manifest to appropriate location
- On Windows: also creates registry key

**`unregisterHosts(): void`**
- Removes all manifest files and registry keys (called on uninstall or when feature disabled)

**`isRegistered(): { chrome: boolean; firefox: boolean }`**
- Checks if host manifests exist in the expected locations

### Windows .bat wrapper

On Windows, Chrome native messaging requires the `path` to be an executable (`.exe`, `.bat`, `.cmd`). Since we ship a `.js` bridge script, we need a `.bat` wrapper:

```bat
@echo off
"%~dp0\..\..\node.exe" "%~dp0\vicu-bridge.js"
```

This assumes Electron's bundled Node.js is available at a known relative path. During development, use the system `node` executable. The registration function should generate this wrapper file alongside the bridge script.

**Alternative (simpler):** Compile `vicu-bridge.js` into a standalone executable using `pkg` or `nexe` at build time. This eliminates the Node.js dependency entirely. The compiled binary goes into `resources/native-messaging-host/vicu-bridge.exe` (Windows), `vicu-bridge` (macOS/Linux).

**Recommended approach:** Use the .bat wrapper in development, compile with `pkg` for production builds. The registration module should detect which is available.

### Windows Registry

On Windows, use Electron's built-in `regedit` or `child_process.execSync` with `reg add`:

```typescript
import { execSync } from 'child_process'

function registerWindowsRegistry(browser: 'chrome' | 'firefox', manifestPath: string): void {
  const regPath = browser === 'chrome'
    ? `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`
    : `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`

  execSync(`reg add "${regPath}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'ignore' })
}
```

---

## Component 4: Electron Integration — `src/main/browser-client.ts` (NEW)

Reads the context file written by the bridge.

```typescript
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const CONTEXT_FILE = path.join(app.getPath('userData'), 'browser-context.json')
const MAX_AGE_MS = 3000 // Context older than 3s is stale

export interface BrowserContext {
  url: string
  title: string
  displayTitle: string  // Truncated for badge
}

export function getBrowserContext(): BrowserContext | null {
  try {
    const raw = fs.readFileSync(CONTEXT_FILE, 'utf8')
    const data = JSON.parse(raw)

    if (!data.url || !data.timestamp) return null
    if (Date.now() - data.timestamp > MAX_AGE_MS) return null

    // Sanitize: strip query params and fragments for display
    let displayUrl: string
    try {
      const parsed = new URL(data.url)
      displayUrl = parsed.hostname + parsed.pathname
    } catch {
      displayUrl = data.url
    }

    const displayTitle = data.title
      ? (data.title.length > 40 ? data.title.substring(0, 37) + '...' : data.title)
      : displayUrl

    return {
      url: data.url,
      title: data.title || displayUrl,
      displayTitle,
    }
  } catch {
    return null // File doesn't exist, unreadable, or stale
  }
}
```

This is deliberately simple — a synchronous file read. The file is tiny (<1KB) and on local disk, so read time is <1ms. No async needed.

---

## Component 5: Config Changes — `src/main/config.ts`

### Add to `AppConfig` interface

```typescript
browser_link_mode?: 'off' | 'ask' | 'always'  // default: 'ask'
browser_extension_id?: string                   // Chrome extension ID (set after install)
```

### Add to `normalizeConfig()`

```typescript
browser_link_mode: raw.browser_link_mode === 'off' || raw.browser_link_mode === 'always'
  ? raw.browser_link_mode : 'ask',
browser_extension_id: typeof raw.browser_extension_id === 'string' ? raw.browser_extension_id : '',
```

---

## Component 6: Main Process — `src/main/index.ts`

### Modify `showQuickEntry()`

Add browser context detection AFTER Obsidian detection. Obsidian takes priority.

```typescript
import { getBrowserContext, type BrowserContext } from './browser-client'

// In showQuickEntry(), after the existing Obsidian detection block:

let browserContext: BrowserContext | null = null
if (!obsidianContext && config?.browser_link_mode && config.browser_link_mode !== 'off') {
  browserContext = getBrowserContext()  // Synchronous, <1ms
}

// After .show() and the obsidian-context send:
if (!obsidianContext && browserContext && config?.browser_link_mode) {
  quickEntryWindow.webContents.send('browser-context', {
    ...browserContext,
    mode: config.browser_link_mode,
  })
}
```

**Priority rule:** If Obsidian context is found, browser context is never sent. This ensures the user links the note they're working on, not the browser tab behind it. If the user has Obsidian open but wants the browser link instead, they can dismiss the Obsidian badge and... well, the browser context isn't available in that flow. This is intentional — Obsidian integration implies intent.

### Register hosts on startup

In the `app.whenReady()` block:

```typescript
import { registerHosts, isRegistered } from './browser-host-registration'

// After app is ready, register native messaging hosts if needed
const config = loadConfig()
if (config?.browser_link_mode !== 'off') {
  const status = isRegistered()
  if (!status.chrome || !status.firefox) {
    registerHosts({
      chromeExtensionId: config.browser_extension_id || 'PUBLISHED_EXTENSION_ID',
      firefoxExtensionId: 'browser-link@vicu.app',
    })
  }
}
```

---

## Component 7: Quick Entry Renderer — `src/renderer/quick-entry/`

### Context coexistence with Obsidian

The existing Obsidian integration uses:
- State: `obsidianContext`, `obsidianLinked`
- UI: `#obsidian-hint`, `#obsidian-badge`
- Colors: Purple (#7C3AED)
- Comment marker: `<!-- notelink:... -->`
- Ctrl+L to toggle

Browser link integration adds:
- State: `browserContext`, `browserLinked`
- UI: `#browser-hint`, `#browser-badge`
- Colors: Blue (#2563EB)
- Comment marker: `<!-- pagelink:... -->`
- Ctrl+L to toggle (SAME shortcut — they're mutually exclusive since Obsidian has priority)

### HTML — add to `index.html` (below the obsidian elements)

```html
<!-- Browser link hint (shown in "ask" mode) -->
<div id="browser-hint" class="browser-hint hidden">
  <span class="browser-hint-key">Ctrl+L</span> to link <span id="browser-hint-name"></span>
</div>

<!-- Browser link badge (shown after Ctrl+L or in "always" mode) -->
<div id="browser-badge" class="browser-badge hidden">
  <svg class="browser-badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>
  <span id="browser-badge-name"></span>
  <button id="browser-badge-remove" class="browser-badge-remove" title="Remove link">&times;</button>
</div>
```

### CSS — add to `styles.css`

```css
.browser-hint {
  padding: 2px 16px;
  font-size: 11px;
  color: #2563EB;
  opacity: 0.6;
}
.browser-hint.hidden { display: none; }
.browser-hint-key {
  font-family: monospace;
  background: rgba(37, 99, 235, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
}

.browser-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin: 4px 16px 0;
  border-radius: 10px;
  background: rgba(37, 99, 235, 0.12);
  color: #2563EB;
  font-size: 11px;
  line-height: 1;
  max-width: fit-content;
}
.browser-badge.hidden { display: none; }
.browser-badge-icon { flex-shrink: 0; }
.browser-badge-remove {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  opacity: 0.6;
}
.browser-badge-remove:hover { opacity: 1; }

@media (prefers-color-scheme: dark) {
  .browser-hint { color: #60a5fa; }
  .browser-hint-key { background: rgba(37, 99, 235, 0.2); }
  .browser-badge { background: rgba(37, 99, 235, 0.2); color: #60a5fa; }
}
```

### Preload — `src/preload/quick-entry.ts`

Add alongside `onObsidianContext`:

```typescript
onBrowserContext: (callback: (context: {
  url: string; title: string; displayTitle: string; mode: 'ask' | 'always'
} | null) => void) => {
  ipcRenderer.on('browser-context', (_event, context) => callback(context))
},
```

### Renderer — `renderer.ts`

**New state (alongside existing Obsidian state):**

```typescript
let browserContext: { url: string; title: string; displayTitle: string } | null = null
let browserLinked = false
```

**Context listener:**

```typescript
window.quickEntryApi.onBrowserContext((ctx) => {
  if (!ctx) {
    browserContext = null
    browserLinked = false
    updateBrowserUI()
    return
  }
  browserContext = { url: ctx.url, title: ctx.title, displayTitle: ctx.displayTitle }
  browserLinked = ctx.mode === 'always'
  updateBrowserUI()
})
```

**UI update:**

```typescript
function updateBrowserUI(): void {
  if (!browserContext) {
    browserHint.classList.add('hidden')
    browserBadge.classList.add('hidden')
    return
  }
  if (browserLinked) {
    browserBadgeName.textContent = browserContext.displayTitle
    browserBadge.classList.remove('hidden')
    browserHint.classList.add('hidden')
  } else {
    browserHintName.textContent = `"${browserContext.displayTitle}"`
    browserHint.classList.remove('hidden')
    browserBadge.classList.add('hidden')
  }
}
```

**Modify existing Ctrl+L handler to handle both contexts:**

```typescript
if (e.ctrlKey && e.key === 'l') {
  e.preventDefault()
  // Obsidian has priority
  if (obsidianContext) {
    obsidianLinked = !obsidianLinked
    updateObsidianUI()
  } else if (browserContext) {
    browserLinked = !browserLinked
    updateBrowserUI()
  }
  return
}
```

**Browser badge remove button:**

```typescript
browserBadgeRemove.addEventListener('click', () => {
  browserLinked = false
  updateBrowserUI()
})
```

**Modify `saveTask()` — add browser link handling AFTER the existing Obsidian block:**

```typescript
// Existing Obsidian block:
if (obsidianLinked && obsidianContext) {
  const linkHtml = buildNoteLinkHtml(obsidianContext.deepLink, obsidianContext.noteName)
  description = description ? `<p>${escapeHtml(description)}</p>${linkHtml}` : linkHtml
}

// NEW: Browser link (only if Obsidian link wasn't added)
if (!obsidianLinked && browserLinked && browserContext) {
  const linkHtml = buildPageLinkHtml(browserContext.url, browserContext.title)
  description = description ? `<p>${escapeHtml(description)}</p>${linkHtml}` : linkHtml
}
```

**New helper:**

```typescript
function buildPageLinkHtml(url: string, title: string): string {
  const safeUrl = escapeHtml(url)
  const safeTitle = escapeHtml(title)
  return `<!-- pagelink:${safeUrl} --><p><a href="${safeUrl}">🔗 ${safeTitle}</a></p>`
}
```

**Clear on hide — add to existing `onHideWindow` callback:**

```typescript
browserContext = null
browserLinked = false
updateBrowserUI()
```

---

## Component 8: Page Link Utility — `src/renderer/lib/note-link.ts`

Extend the existing `note-link.ts` to also extract page links.

### Add to existing file:

```typescript
export interface PageLink {
  url: string
  title: string
  app: 'browser'
}

export function extractPageLink(description: string | undefined | null): PageLink | null {
  if (!description) return null
  const match = description.match(/<!-- pagelink:(https?:\/\/[^">\s]+) -->/)
  if (!match) return null
  const titleMatch = description.match(/🔗\s*([^<]+)<\/a>/)
  const title = titleMatch ? titleMatch[1].trim() : match[1]
  return { url: match[1], title, app: 'browser' }
}
```

### Add a combined extractor:

```typescript
export type TaskLink = (NoteLink & { kind: 'note' }) | (PageLink & { kind: 'page' })

export function extractTaskLink(description: string | undefined | null): TaskLink | null {
  const noteLink = extractNoteLink(description)
  if (noteLink) return { ...noteLink, kind: 'note' }
  const pageLink = extractPageLink(description)
  if (pageLink) return { ...pageLink, kind: 'page' }
  return null
}
```

---

## Component 9: Main Window — Task Link Icon (React)

### Create `src/renderer/components/TaskLinkIcon.tsx` (NEW)

Replaces or wraps `ObsidianLinkIcon.tsx` to handle both link types.

```tsx
import { extractTaskLink } from '@/lib/note-link'

interface Props {
  description: string | undefined | null
}

export function TaskLinkIcon({ description }: Props) {
  const link = extractTaskLink(description)
  if (!link) return null

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    window.api.openDeepLink(link.url)
  }

  if (link.kind === 'note') {
    return (
      <button
        onClick={handleClick}
        title={`Open "${link.name}" in Obsidian`}
        className="ml-1 inline-flex items-center rounded p-0.5 text-purple-500 opacity-50 transition-opacity hover:bg-purple-500/10 hover:opacity-100 dark:text-purple-400"
      >
        {/* Obsidian SVG icon */}
        <svg width="12" height="12" viewBox="0 0 100 100" className="flex-shrink-0">
          <path d="M68.6 2.2 32.8 19.8a4 4 0 0 0-2.2 2.7L18.2 80.1a4 4 0 0 0 1 3.7l16.7 16a4 4 0 0 0 3.6 1.1l42-9.6a4 4 0 0 0 2.8-2.3L97.7 46a4 4 0 0 0-.5-3.8L72.3 3a4 4 0 0 0-3.7-1.8z" fill="currentColor"/>
        </svg>
      </button>
    )
  }

  // Browser link
  return (
    <button
      onClick={handleClick}
      title={`Open "${link.title}"`}
      className="ml-1 inline-flex items-center rounded p-0.5 text-blue-500 opacity-50 transition-opacity hover:bg-blue-500/10 hover:opacity-100 dark:text-blue-400"
    >
      {/* Link chain icon */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    </button>
  )
}
```

**Replace `<ObsidianLinkIcon>` usage** in task list components with `<TaskLinkIcon>`. Same prop interface (`description`), handles both types.

---

## Component 10: Quick View (Vanilla TS)

In `src/renderer/quick-view/renderer.ts`, extend the existing notelink icon code:

```typescript
import { extractTaskLink } from '../lib/note-link'

const taskLink = extractTaskLink(task.description)
if (taskLink) {
  const btn = document.createElement('button')
  btn.className = taskLink.kind === 'note' ? 'obsidian-link-btn' : 'browser-link-btn'
  btn.title = taskLink.kind === 'note'
    ? `Open "${taskLink.name}" in Obsidian`
    : `Open "${taskLink.title}"`
  btn.innerHTML = taskLink.kind === 'note'
    ? `<svg width="12" height="12" viewBox="0 0 100 100"><path d="M68.6 2.2 32.8 19.8a4 4 0 0 0-2.2 2.7L18.2 80.1a4 4 0 0 0 1 3.7l16.7 16a4 4 0 0 0 3.6 1.1l42-9.6a4 4 0 0 0 2.8-2.3L97.7 46a4 4 0 0 0-.5-3.8L72.3 3a4 4 0 0 0-3.7-1.8z" fill="currentColor"/></svg>`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    window.quickViewApi.openDeepLink(taskLink.url)
  })
  titleRow.appendChild(btn)
}
```

**CSS** (`styles.css`) — add alongside existing `.obsidian-link-btn`:

```css
.browser-link-btn {
  -webkit-app-region: no-drag;
  background: none;
  border: none;
  color: #2563EB;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  opacity: 0.5;
  transition: opacity 150ms, background 150ms;
  flex-shrink: 0;
}
.browser-link-btn:hover { opacity: 1; background: rgba(37, 99, 235, 0.12); }
```

---

## Component 11: Settings UI

Add a "Browser Integration" section in the Quick Entry settings, similar to the Obsidian section.

### Fields

- **Browser linking** — `<select>`: Off / Ask (Ctrl+L) / Always auto-link. Maps to `browser_link_mode`.
- **Extension status** — read-only indicator showing whether the native messaging host is registered
- **Register/Unregister button** — triggers host registration or removal

### Collapsible setup info ("How to set up")

Content when expanded:

**Step 1:** Install the Vicu Browser Link extension
- Chrome: [link to Chrome Web Store] (or "Load unpacked" during development)
- Firefox: [link to Firefox Add-ons] (or "Load temporary add-on" during development)

**Step 2:** The native messaging bridge is registered automatically by Vicu. If the extension can't connect, click "Re-register Bridge" below.

**That's it.** When you press the Quick Entry hotkey while a browser tab is focused, the tab URL will be available to link.

### State

```tsx
const [hostStatus, setHostStatus] = useState<{ chrome: boolean; firefox: boolean } | null>(null)

useEffect(() => {
  window.api.checkBrowserHostRegistration().then(setHostStatus)
}, [])
```

### IPC handlers needed

Add to `src/main/ipc-handlers.ts`:

```typescript
ipcMain.handle('check-browser-host-registration', () => {
  return isRegistered() // { chrome: boolean, firefox: boolean }
})

ipcMain.handle('register-browser-hosts', () => {
  const config = loadConfig()
  registerHosts({
    chromeExtensionId: config?.browser_extension_id || 'PUBLISHED_ID',
    firefoxExtensionId: 'browser-link@vicu.app',
  })
  return isRegistered()
})
```

Add to preload and type definitions accordingly.

---

## Implementation Order

### Phase 1: Extension + Bridge (can be tested standalone)

1. `extensions/browser/manifest.json` — Chrome MV3 manifest
2. `extensions/browser/background.js` — Tab monitoring + native messaging
3. `resources/native-messaging-host/vicu-bridge.js` — Bridge script
4. `resources/native-messaging-host/com.vicu.browser.json` — Chrome host manifest
5. Manually register host manifest for testing
6. **Test:** Load extension unpacked in Chrome, open tabs, verify `browser-context.json` appears in userData with correct content

### Phase 2: Host Registration

7. `src/main/browser-host-registration.ts` — Registration module
8. Add startup registration in `src/main/index.ts`
9. **Test:** Delete manifests, restart app, verify they're recreated

### Phase 3: Electron Integration

10. `src/main/browser-client.ts` — Context file reader
11. `src/main/config.ts` — Add `browser_link_mode`, `browser_extension_id`
12. `src/main/index.ts` — Add browser context to `showQuickEntry()`
13. `src/preload/quick-entry.ts` — Add `onBrowserContext`
14. `src/preload/index.d.ts` — Type updates

### Phase 4: Quick Entry UI

15. `src/renderer/quick-entry/index.html` — Browser hint + badge HTML
16. `src/renderer/quick-entry/styles.css` — Blue-themed styles
17. `src/renderer/quick-entry/renderer.ts` — Browser context state, UI, Ctrl+L coexistence, saveTask

### Phase 5: Task Display

18. `src/renderer/lib/note-link.ts` — Add `extractPageLink`, `extractTaskLink`
19. `src/renderer/components/TaskLinkIcon.tsx` — Combined icon component
20. Replace `ObsidianLinkIcon` usage with `TaskLinkIcon` in task list
21. `src/renderer/quick-view/renderer.ts` + `styles.css` — Browser link icon

### Phase 6: Settings

22. `src/main/ipc-handlers.ts` — Registration check + register handlers
23. `src/preload/index.ts` + `index.d.ts` — Expose new handlers
24. `src/renderer/components/settings/QuickEntrySettings.tsx` — Browser integration section

---

## File Changes Summary

| File | Change |
|---|---|
| `extensions/browser/manifest.json` | **NEW** — Chrome MV3 manifest |
| `extensions/browser/background.js` | **NEW** — Tab monitor + native messaging |
| `extensions/browser/icons/*.png` | **NEW** — Extension icons |
| `resources/native-messaging-host/vicu-bridge.js` | **NEW** — Bridge script |
| `resources/native-messaging-host/com.vicu.browser.json` | **NEW** — Chrome host manifest template |
| `resources/native-messaging-host/com.vicu.browser.firefox.json` | **NEW** — Firefox host manifest template |
| `src/main/browser-host-registration.ts` | **NEW** — Host manifest registration |
| `src/main/browser-client.ts` | **NEW** — Context file reader |
| `src/main/config.ts` | Add `browser_link_mode`, `browser_extension_id` |
| `src/main/index.ts` | Add browser context to `showQuickEntry()`, startup registration |
| `src/main/ipc-handlers.ts` | Add registration check/register handlers |
| `src/preload/quick-entry.ts` | Add `onBrowserContext` |
| `src/preload/index.ts` | Add registration handlers |
| `src/preload/index.d.ts` | Type updates |
| `src/renderer/quick-entry/index.html` | Browser hint + badge HTML |
| `src/renderer/quick-entry/styles.css` | Blue-themed browser styles |
| `src/renderer/quick-entry/renderer.ts` | Browser context state, Ctrl+L coexistence |
| `src/renderer/lib/note-link.ts` | Add `extractPageLink`, `extractTaskLink` |
| `src/renderer/components/TaskLinkIcon.tsx` | **NEW** — Combined link icon |
| `src/renderer/components/ObsidianLinkIcon.tsx` | **DEPRECATED** — replaced by TaskLinkIcon |
| `src/renderer/quick-view/renderer.ts` | Use `extractTaskLink`, render both icons |
| `src/renderer/quick-view/styles.css` | Browser link icon styles |
| `src/renderer/components/settings/QuickEntrySettings.tsx` | Browser integration section |

---

## Error Handling

| Scenario | Behavior | User Sees |
|---|---|---|
| Extension not installed | No context file written | No hint, no badge |
| Bridge not registered | Extension shows disconnect warning in console | No hint, no badge |
| Browser closed | Bridge clears context file on stdin close | No hint (file deleted) |
| Context file stale (>3s) | getBrowserContext returns null | No hint, no badge |
| Internal URL (chrome://, about:) | Extension sends 'clear', bridge deletes file | No hint, no badge |
| Electron not running | Bridge writes file, nobody reads — harmless | N/A |
| Both Obsidian + browser available | Obsidian context sent, browser skipped | Obsidian hint only |
| browser_link_mode is 'off' | No file read, no context check | Nothing |

---

## Testing Checklist

### Extension + Bridge
- [ ] Load extension in Chrome (unpacked), open tabs → context file appears
- [ ] Switch tabs → file updates with new URL
- [ ] Close browser → file deleted
- [ ] chrome:// tab → file deleted (clear message)
- [ ] Firefox: same tests with temporary add-on

### Integration
- [ ] Mode "ask": hint appears, Ctrl+L toggles, saves with/without link
- [ ] Mode "always": badge auto-appears, Ctrl+L toggles off
- [ ] Mode "off": no hint, no file read
- [ ] Obsidian + browser both available → Obsidian wins
- [ ] Browser only → browser hint shown
- [ ] Click blue link icon in main window → opens URL in default browser
- [ ] Click blue link icon in Quick View → same
- [ ] Hover icon → shows page title

### Host Registration
- [ ] Fresh install → hosts registered on startup
- [ ] Settings "Re-register" button → manifests recreated
- [ ] Windows: registry keys created
- [ ] macOS/Linux: manifest files in correct locations
