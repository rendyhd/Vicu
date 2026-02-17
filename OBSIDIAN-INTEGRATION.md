# Obsidian Integration Spec

## Overview

Add note-linking to Quick Entry: when the user creates a task while Obsidian is running, they can link the active note to the task. Linked tasks show a clickable Obsidian icon in task lists.

## Three Modes (setting: `obsidian_mode`)

- **`ask`** (default) — Silently detects active Obsidian note. Shows hint: `Ctrl+L to link "note-name"`. User presses Ctrl+L to attach. If they don't, task saves without link.
- **`always`** — Auto-attaches the link (badge shown immediately). User can press Ctrl+L or ✕ to remove.
- **`off`** — No detection, no API calls, no UI changes. Zero overhead.

## Obsidian Plugins Required

1. **Local REST API** (coddingtonbear) — HTTPS server on `127.0.0.1:27124`, self-signed cert, Bearer token auth
2. **Advanced URI** (Vinzent03) — `obsidian://advanced-uri?vault=X&uid=Y` rename-proof links via frontmatter UID

---

## Module 1: Obsidian Client — `src/main/obsidian-client.ts` (NEW)

Main-process only. Follow the `api-client.ts` pattern exactly: `net.request()`, Promise wrapper, manual `setTimeout`, same error style. **300ms timeout** (not 10s).

### Types

```typescript
export interface ObsidianNoteContext {
  deepLink: string       // obsidian:// URI
  noteName: string       // Human-readable, e.g. "feature-spec"
  vaultName: string
  isUidBased: boolean    // true = Advanced URI, false = path fallback
}
```

### Functions

**`getActiveNote(apiKey: string, port?: number): Promise<ActiveNoteResponse | null>`**
- GET `https://127.0.0.1:{port}/active/`
- Headers: `Authorization: Bearer {apiKey}`, `Accept: application/vnd.olrapi.note+json`
- Returns parsed JSON with `{ path, content, frontmatter, stat }` on 200
- Returns `null` on: ECONNREFUSED, 401, 404, timeout, any error

**`injectUID(apiKey: string, uid: string, port?: number): Promise<boolean>`**
- PATCH `https://127.0.0.1:{port}/active/`
- Body: `{ "frontmatter": { "uid": uid } }`
- Content-Type: `application/vnd.olrapi.note+json`
- PATCH merges frontmatter — existing fields preserved
- Returns `true` on 2xx, `false` on anything else

**`getObsidianContext(): Promise<ObsidianNoteContext | null>`**
- Loads config, checks `obsidian_mode !== 'off'` and `obsidian_api_key` exists
- Calls `getActiveNote()`
- If `frontmatter.uid` exists → use it
- If missing → `crypto.randomUUID()` → `injectUID()` → use new uid if success
- If injection fails → fall back to path-based URI
- Deep link construction:
  - UID: `obsidian://advanced-uri?vault=${encodeURIComponent(vault)}&uid=${encodeURIComponent(uid)}`
  - Path fallback: `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(pathWithoutMd)}`
- Extract `noteName` from path: strip `.md`, take last segment after `/`

### Self-Signed Cert

Add in `src/main/index.ts` during app setup:

```typescript
app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  try {
    const parsed = new URL(url)
    const config = loadConfig()
    const port = config?.obsidian_port || 27124
    if (parsed.hostname === '127.0.0.1' && parsed.port === String(port)) {
      event.preventDefault()
      callback(true)
      return
    }
  } catch { /* fall through */ }
  callback(false)
})
```

If `net.request()` doesn't trigger this for programmatic requests, use Node.js `https` module with `{ rejectUnauthorized: false }` agent, scoped to the Obsidian client only.

---

## Module 2: Config — `src/main/config.ts`

### Add to `AppConfig` interface

```typescript
obsidian_mode?: 'off' | 'ask' | 'always'
obsidian_api_key?: string
obsidian_port?: number
obsidian_vault_name?: string
```

### Add to `normalizeConfig()`

```typescript
obsidian_mode: raw.obsidian_mode === 'off' || raw.obsidian_mode === 'always' ? raw.obsidian_mode : 'ask',
obsidian_api_key: typeof raw.obsidian_api_key === 'string' ? raw.obsidian_api_key : '',
obsidian_port: typeof raw.obsidian_port === 'number' ? raw.obsidian_port : 27124,
obsidian_vault_name: typeof raw.obsidian_vault_name === 'string' ? raw.obsidian_vault_name : '',
```

---

## Module 3: Main Process — `src/main/index.ts`

### Modify `showQuickEntry()`

Insert Obsidian detection before the existing positioning/show logic:

```typescript
// Before .show():
let obsidianContext: ObsidianNoteContext | null = null
if (config?.obsidian_mode && config.obsidian_mode !== 'off' && config.obsidian_api_key) {
  obsidianContext = await Promise.race([
    getObsidianContext(),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 350))
  ])
}

// After .show() and webContents.send('window-shown'):
if (obsidianContext && config?.obsidian_mode) {
  quickEntryWindow.webContents.send('obsidian-context', {
    ...obsidianContext,
    mode: config.obsidian_mode,
  })
}
```

`showQuickEntry()` must become `async`. The existing positioning, `.show()`, `.focus()`, `window-shown` send, and `startDragHoverPolling()` remain unchanged.

---

## Module 4: IPC Handlers — `src/main/ipc-handlers.ts`

### New handler: `open-deep-link`

```typescript
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'obsidian:'])

ipcMain.handle('open-deep-link', (_event, url: string) => {
  if (typeof url !== 'string') return
  try {
    const parsed = new URL(url)
    if (ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      shell.openExternal(url)
    }
  } catch { /* invalid URL */ }
})
```

Existing `qv:open-task-in-browser` stays untouched.

### New handler: `test-obsidian-connection`

```typescript
ipcMain.handle('test-obsidian-connection', async () => {
  const config = loadConfig()
  if (!config?.obsidian_api_key) return { success: false, error: 'No API key configured' }
  try {
    const note = await getActiveNote(config.obsidian_api_key, config.obsidian_port || 27124)
    return { success: true, data: note ? { noteName: note.path } : null }
  } catch {
    return { success: false, error: 'Cannot reach Obsidian. Is the Local REST API plugin enabled?' }
  }
})
```

Note: `getActiveNote` returns null on 404 (no note open) — that still means server is reachable. For the test handler, differentiate: return `{ success: true }` on null (reachable, no note) vs throw/error on ECONNREFUSED. This may require `getActiveNote` to throw on connection errors rather than returning null. Decide the cleanest approach — either a separate `testConnection()` method on the client, or make `getActiveNote` distinguish "not running" from "no note open".

---

## Module 5: Preload Updates

### `src/preload/quick-entry.ts` — add to exposed API:

```typescript
onObsidianContext: (callback: (context: {
  deepLink: string; noteName: string; vaultName: string; isUidBased: boolean; mode: 'ask' | 'always'
} | null) => void) => {
  ipcRenderer.on('obsidian-context', (_event, context) => callback(context))
},
```

### `src/preload/quick-view.ts` — add:

```typescript
openDeepLink: (url: string) => ipcRenderer.invoke('open-deep-link', url),
```

### `src/preload/index.ts` (main window) — add:

```typescript
openDeepLink: (url: string) => ipcRenderer.invoke('open-deep-link', url),
testObsidianConnection: () => ipcRenderer.invoke('test-obsidian-connection'),
```

### `src/preload/index.d.ts` — add to `ElectronAPI`:

```typescript
openDeepLink(url: string): Promise<void>
testObsidianConnection(): Promise<{ success: boolean; error?: string; data?: unknown }>
```

---

## Module 6: Quick Entry Renderer — `src/renderer/quick-entry/`

This is **vanilla TypeScript** with DOM manipulation, NOT React.

### HTML — `index.html`

Add below the existing hints/today-hint elements:

```html
<div id="obsidian-hint" class="obsidian-hint hidden">
  <span class="obsidian-hint-key">Ctrl+L</span> to link <span id="obsidian-hint-name"></span>
</div>
<div id="obsidian-badge" class="obsidian-badge hidden">
  <svg class="obsidian-badge-icon" width="12" height="12" viewBox="0 0 100 100">
    <path d="M68.6 2.2 32.8 19.8a4 4 0 0 0-2.2 2.7L18.2 80.1a4 4 0 0 0 1 3.7l16.7 16a4 4 0 0 0 3.6 1.1l42-9.6a4 4 0 0 0 2.8-2.3L97.7 46a4 4 0 0 0-.5-3.8L72.3 3a4 4 0 0 0-3.7-1.8z" fill="currentColor"/>
  </svg>
  <span id="obsidian-badge-name"></span>
  <button id="obsidian-badge-remove" class="obsidian-badge-remove" title="Remove link">&times;</button>
</div>
```

### CSS — `styles.css`

```css
.obsidian-hint {
  padding: 2px 16px;
  font-size: 11px;
  color: #7C3AED;
  opacity: 0.6;
}
.obsidian-hint.hidden { display: none; }
.obsidian-hint-key {
  font-family: monospace;
  background: rgba(124, 58, 237, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
}

.obsidian-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin: 4px 16px 0;
  border-radius: 10px;
  background: rgba(124, 58, 237, 0.12);
  color: #7C3AED;
  font-size: 11px;
  line-height: 1;
  max-width: fit-content;
}
.obsidian-badge.hidden { display: none; }
.obsidian-badge-icon { flex-shrink: 0; }
.obsidian-badge-remove {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  opacity: 0.6;
}
.obsidian-badge-remove:hover { opacity: 1; }

@media (prefers-color-scheme: dark) {
  .obsidian-hint { color: #a78bfa; }
  .obsidian-hint-key { background: rgba(124, 58, 237, 0.2); }
  .obsidian-badge { background: rgba(124, 58, 237, 0.2); color: #a78bfa; }
}
```

### Renderer — `renderer.ts`

**State:**

```typescript
let obsidianContext: { deepLink: string; noteName: string; isUidBased: boolean } | null = null
let obsidianLinked = false
```

**Context listener:**

```typescript
window.quickEntryApi.onObsidianContext((ctx) => {
  if (!ctx) {
    obsidianContext = null
    obsidianLinked = false
    updateObsidianUI()
    return
  }
  obsidianContext = { deepLink: ctx.deepLink, noteName: ctx.noteName, isUidBased: ctx.isUidBased }
  obsidianLinked = ctx.mode === 'always'
  updateObsidianUI()
})
```

**UI update:**

```typescript
function updateObsidianUI(): void {
  if (!obsidianContext) {
    obsidianHint.classList.add('hidden')
    obsidianBadge.classList.add('hidden')
    return
  }
  if (obsidianLinked) {
    obsidianBadgeName.textContent = obsidianContext.noteName
    obsidianBadge.classList.remove('hidden')
    obsidianHint.classList.add('hidden')
  } else {
    obsidianHintName.textContent = `"${obsidianContext.noteName}"`
    obsidianHint.classList.remove('hidden')
    obsidianBadge.classList.add('hidden')
  }
}
```

**Ctrl+L handler — add to BOTH `input` and `descriptionInput` keydown handlers:**

```typescript
if (e.ctrlKey && e.key === 'l') {
  e.preventDefault()
  if (obsidianContext) {
    obsidianLinked = !obsidianLinked
    updateObsidianUI()
  }
  return
}
```

**Badge remove button:**

```typescript
obsidianBadgeRemove.addEventListener('click', () => {
  obsidianLinked = false
  updateObsidianUI()
})
```

**Modify `saveTask()` — insert before the existing API call:**

```typescript
if (obsidianLinked && obsidianContext) {
  const linkHtml = buildNoteLinkHtml(obsidianContext.deepLink, obsidianContext.noteName)
  description = description ? `<p>${escapeHtml(description)}</p>${linkHtml}` : linkHtml
}
```

Helper functions:

```typescript
function buildNoteLinkHtml(deepLink: string, noteName: string): string {
  const safeLink = escapeHtml(deepLink)
  const safeName = escapeHtml(noteName)
  return `<!-- notelink:${safeLink} --><p><a href="${safeLink}">📎 ${safeName}</a></p>`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
```

**Clear on hide — add to existing `onHideWindow` callback:**

```typescript
obsidianContext = null
obsidianLinked = false
updateObsidianUI()
```

**CRITICAL:** Vikunja descriptions are HTML (Tiptap editor), NOT markdown. The `buildNoteLinkHtml` function produces HTML anchor tags. Never send markdown link syntax.

---

## Module 7: Note Link Utility — `src/renderer/lib/note-link.ts` (NEW)

Shared between main window (React) and Quick View (vanilla TS).

```typescript
export interface NoteLink {
  url: string
  name: string
  app: 'obsidian'
}

export function extractNoteLink(description: string | undefined | null): NoteLink | null {
  if (!description) return null
  const match = description.match(/<!-- notelink:(obsidian:\/\/[^">\s]+) -->/)
  if (!match) return null
  const nameMatch = description.match(/📎\s*([^<]+)<\/a>/)
  const name = nameMatch ? nameMatch[1].trim() : 'Obsidian note'
  return { url: match[1], name, app: 'obsidian' }
}
```

---

## Module 8: Main Window — `src/renderer/components/ObsidianLinkIcon.tsx` (NEW)

Small icon at end of task title. Icon only, tooltip on hover.

```tsx
import { extractNoteLink } from '@/lib/note-link'

interface Props {
  description: string | undefined | null
}

export function ObsidianLinkIcon({ description }: Props) {
  const link = extractNoteLink(description)
  if (!link) return null

  return (
    <button
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); window.api.openDeepLink(link.url) }}
      title={`Open "${link.name}" in Obsidian`}
      className="ml-1 inline-flex items-center rounded p-0.5 text-purple-500 opacity-50 transition-opacity hover:bg-purple-500/10 hover:opacity-100 dark:text-purple-400"
    >
      <svg width="12" height="12" viewBox="0 0 100 100" className="flex-shrink-0">
        <path d="M68.6 2.2 32.8 19.8a4 4 0 0 0-2.2 2.7L18.2 80.1a4 4 0 0 0 1 3.7l16.7 16a4 4 0 0 0 3.6 1.1l42-9.6a4 4 0 0 0 2.8-2.3L97.7 46a4 4 0 0 0-.5-3.8L72.3 3a4 4 0 0 0-3.7-1.8z" fill="currentColor"/>
      </svg>
    </button>
  )
}
```

**Place in task list items:** Find wherever task titles are rendered (e.g., `TaskItem.tsx`, `TaskRow.tsx`, or equivalent) and add `<ObsidianLinkIcon description={task.description} />` at the end of the title.

---

## Module 9: Quick View — `src/renderer/quick-view/`

In `renderer.ts`, inside the task item rendering function, after building the title row:

```typescript
const noteLink = extractNoteLink(task.description)
if (noteLink) {
  const btn = document.createElement('button')
  btn.className = 'obsidian-link-btn'
  btn.title = `Open "${noteLink.name}" in Obsidian`
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 100 100"><path d="M68.6 2.2 32.8 19.8a4 4 0 0 0-2.2 2.7L18.2 80.1a4 4 0 0 0 1 3.7l16.7 16a4 4 0 0 0 3.6 1.1l42-9.6a4 4 0 0 0 2.8-2.3L97.7 46a4 4 0 0 0-.5-3.8L72.3 3a4 4 0 0 0-3.7-1.8z" fill="currentColor"/></svg>`
  btn.addEventListener('click', (e) => { e.stopPropagation(); window.quickViewApi.openDeepLink(noteLink.url) })
  titleRow.appendChild(btn)
}
```

CSS in `styles.css`:

```css
.obsidian-link-btn {
  -webkit-app-region: no-drag;
  background: none;
  border: none;
  color: #7C3AED;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  opacity: 0.5;
  transition: opacity 150ms, background 150ms;
  flex-shrink: 0;
}
.obsidian-link-btn:hover { opacity: 1; background: rgba(124, 58, 237, 0.12); }
```

Import `extractNoteLink` — check build config for correct import path from quick-view to `lib/note-link`.

---

## Module 10: Settings — `src/renderer/components/settings/QuickEntrySettings.tsx`

Add an "Obsidian Integration" section inside the existing Quick Entry settings panel.

**Fields:**
- **Note linking** — `<select>` with options: Off / Ask (Ctrl+L) / Always auto-link. Maps to `obsidian_mode`.
- **API Key** — password input with show/hide toggle. Maps to `obsidian_api_key`. Hint: "Obsidian → Settings → Local REST API → Copy API Key"
- **Vault Name** — text input. Maps to `obsidian_vault_name`. Hint: "Shown in Obsidian's title bar"
- **Port** — number input, default 27124. Maps to `obsidian_port`.
- **Test Connection** — button that calls `window.api.testObsidianConnection()`, shows "Connected" or error.

Only show API Key / Vault / Port / Test when mode is not "off".

Add `const [showObsidianKey, setShowObsidianKey] = useState(false)` for the toggle.

Follow the exact styling patterns of the existing settings (Tailwind classes, CSS variables, same input/select/button styles).

---

## Implementation Order

1. `src/main/config.ts` — Add obsidian fields to AppConfig + normalizeConfig
2. `src/main/obsidian-client.ts` — New file
3. `src/main/index.ts` — certificate-error handler + modify showQuickEntry (make async)
4. `src/main/ipc-handlers.ts` — open-deep-link + test-obsidian-connection
5. `src/preload/quick-entry.ts` — onObsidianContext
6. `src/preload/quick-view.ts` + `src/preload/index.ts` — openDeepLink + testObsidianConnection
7. `src/preload/index.d.ts` — type updates
8. `src/renderer/quick-entry/` — HTML + CSS + renderer.ts (hint, badge, Ctrl+L, saveTask)
9. `src/renderer/lib/note-link.ts` — extraction utility
10. `src/renderer/components/ObsidianLinkIcon.tsx` — React icon component
11. Find and update task title components to include ObsidianLinkIcon
12. `src/renderer/quick-view/` — icon + click handler
13. `src/renderer/components/settings/QuickEntrySettings.tsx` — settings UI
14. Test through error matrix below

---

## Error Handling

| Scenario | Behavior | User Sees |
|---|---|---|
| Obsidian not running (ECONNREFUSED) | Skip context | No hint, no badge |
| Plugin not installed (ECONNREFUSED) | Skip context | No hint, no badge |
| No note open (404) | Skip context | No hint, no badge |
| Bad API key (401) | Skip context, console.warn | No hint, no badge |
| UID injection fails (PATCH error) | Fall back to path URI | Badge shows (path link works) |
| Timeout (>300ms) | Promise.race resolves null | No hint, no badge |
| Mode is 'off' | No API call | Nothing |

**Never block or delay Quick Entry for Obsidian failures.**

---

## Testing Checklist

- [ ] Mode "ask": hint appears when Obsidian has note open, Ctrl+L toggles badge, task saves with/without link
- [ ] Mode "always": badge auto-appears, Ctrl+L toggles off, ✕ removes
- [ ] Mode "off": no hint, no badge, no API calls, no delay
- [ ] Obsidian closed: no hint regardless of mode, no delay
- [ ] Bad API key: no hint, no visible error
- [ ] Note without UID: UID injected in frontmatter, Advanced URI link
- [ ] Note with existing UID: uses existing, no modification
- [ ] Read-only note: path-based fallback, badge still works
- [ ] Ctrl+L with no context: does nothing
- [ ] Click icon in main window task list: opens note in Obsidian
- [ ] Click icon in Quick View: opens note in Obsidian
- [ ] Hover icon: tooltip shows note name
- [ ] Rename note after task created with UID link: link still works
- [ ] Quick Entry opens in <500ms including handshake
- [ ] Settings: mode selector, API key, vault name, port, test button all work
- [ ] Standalone mode: context detected, stored in local task
