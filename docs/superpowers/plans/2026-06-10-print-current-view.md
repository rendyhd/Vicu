# Print Current View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File → Print / Ctrl+P prints the currently visible list view as a branded, dated, full-detail document via the system print dialog.

**Architecture:** Each list view registers its on-screen tasks (with grouping) in a small Zustand print store. On the menu's `print-view` event, AppShell builds a self-contained HTML document with a pure template function and sends it to the main process, which loads it into a hidden BrowserWindow and opens the system print dialog.

**Tech Stack:** Electron (BrowserWindow, webContents.print), React, Zustand, vitest (`npm test` runs `vitest run` — node environment, no jsdom).

**Spec:** `docs/superpowers/specs/2026-06-10-print-view-design.md`

**Two deliberate implementation choices** (testability in vitest's node environment — DOMPurify and Vite asset imports don't work there):
1. `buildPrintHtml` does NOT import `sanitizeTaskHtml` or the logo asset. Both are injected via an options argument. AppShell passes the real `sanitizeTaskHtml` and the Vite-inlined logo.
2. The main process loads the document from a temp file (not a `data:` URL) to avoid Chromium's data-URL size limits.

**One spec deviation:** the spec says print failures surface as a toast. There is no global toast system in the app (ReviewView's is local). Failures are rare (the dialog itself reports printer errors); log to console instead. User cancelling the dialog is NOT an error.

---

### Task 1: Print HTML template (pure function, TDD)

**Files:**
- Create: `src/renderer/lib/print-template.ts`
- Test: `src/renderer/lib/__tests__/print-template.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/lib/__tests__/print-template.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPrintHtml } from '../print-template'
import type { PrintablePayload } from '../print-template'
import type { Task } from '../vikunja-types'

const NULL_DATE = '0001-01-01T00:00:00Z'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Buy milk',
    description: '',
    done: false,
    done_at: NULL_DATE,
    due_date: NULL_DATE,
    start_date: NULL_DATE,
    end_date: NULL_DATE,
    priority: 0,
    project_id: 1,
    labels: null,
    reminders: null,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    created_by: { id: 1, username: 'u' },
    identifier: '#1',
    position: 0,
    bucket_id: 0,
    percent_done: 0,
    repeat_after: 0,
    repeat_mode: 0,
    hex_color: '',
    ...overrides,
  } as Task
}

const identity = (html: string) => html
const LOGO = 'data:image/png;base64,TESTLOGO'
const NOW = new Date(2026, 5, 10) // June 10, 2026 (local time)

function build(payload: PrintablePayload): string {
  return buildPrintHtml(payload, { sanitize: identity, logoDataUrl: LOGO, now: NOW })
}

describe('buildPrintHtml', () => {
  it('includes the view title, Vicu branding, and logo', () => {
    const html = build({ viewTitle: 'Today', sections: [{ groups: [{ tasks: [makeTask()] }] }] })
    expect(html).toContain('<h1>Today</h1>')
    expect(html).toContain('Vicu')
    expect(html).toContain(LOGO)
  })

  it('includes the full printed date and task count', () => {
    const html = build({
      viewTitle: 'Today',
      sections: [{ groups: [{ tasks: [makeTask({ id: 1 }), makeTask({ id: 2 })] }] }],
    })
    expect(html).toContain('Wednesday, June 10, 2026')
    expect(html).toContain('2 tasks')
  })

  it('uses singular "task" for a single task', () => {
    const html = build({ viewTitle: 'Inbox', sections: [{ groups: [{ tasks: [makeTask()] }] }] })
    expect(html).toContain('1 task')
    expect(html).not.toContain('1 tasks')
  })

  it('escapes HTML in titles and headings', () => {
    const html = build({
      viewTitle: '<script>x</script>',
      sections: [
        {
          heading: 'A & B',
          groups: [{ heading: '<b>g</b>', tasks: [makeTask({ title: '<img src=x>' })] }],
        },
      ],
    })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('A &amp; B')
    expect(html).toContain('&lt;b&gt;g&lt;/b&gt;')
    expect(html).toContain('&lt;img src=x&gt;')
  })

  it('renders section and group headings', () => {
    const html = build({
      viewTitle: 'Today',
      sections: [{ heading: 'Overdue', groups: [{ heading: 'Work', tasks: [makeTask()] }] }],
    })
    expect(html).toContain('Overdue')
    expect(html).toContain('Work')
  })

  it('renders due and start dates, skipping null dates', () => {
    const html = build({
      viewTitle: 'T',
      sections: [
        {
          groups: [
            { tasks: [makeTask({ due_date: '2026-06-12T00:00:00Z', start_date: NULL_DATE })] },
          ],
        },
      ],
    })
    expect(html).toContain('Due Jun 12, 2026')
    expect(html).not.toContain('Starts')
  })

  it('renders priority text for prioritized tasks only', () => {
    const html = build({
      viewTitle: 'T',
      sections: [{ groups: [{ tasks: [makeTask({ id: 1, priority: 3 }), makeTask({ id: 2, priority: 0 })] }] }],
    })
    expect(html).toContain('High')
    expect(html).not.toContain('Urgent')
  })

  it('renders label pills', () => {
    const html = build({
      viewTitle: 'T',
      sections: [
        {
          groups: [
            {
              tasks: [
                makeTask({
                  labels: [
                    { id: 1, title: 'errand', hex_color: 'e8a33d', created: '', updated: '' },
                  ],
                }),
              ],
            },
          ],
        },
      ],
    })
    expect(html).toContain('errand')
    expect(html).toContain('#e8a33d')
  })

  it('passes notes through the injected sanitizer and embeds the result', () => {
    const sanitize = (h: string) => h.replace('raw', 'SANITIZED')
    const html = buildPrintHtml(
      { viewTitle: 'T', sections: [{ groups: [{ tasks: [makeTask({ description: '<p>raw note</p>' })] }] }] },
      { sanitize, logoDataUrl: LOGO, now: NOW }
    )
    expect(html).toContain('<p>SANITIZED note</p>')
  })

  it('omits the notes block when the description has no text content', () => {
    const html = build({
      viewTitle: 'T',
      sections: [{ groups: [{ tasks: [makeTask({ description: '<p></p>' })] }] }],
    })
    expect(html).not.toContain('task-notes')
  })

  it('marks done tasks (checked box, done class, completion date)', () => {
    const html = build({
      viewTitle: 'Logbook',
      sections: [
        { groups: [{ tasks: [makeTask({ done: true, done_at: '2026-06-05T10:00:00Z' })] }] },
      ],
    })
    expect(html).toContain('class="task done"')
    expect(html).toContain('Completed Jun 5, 2026')
  })

  it('renders an empty state when there are no tasks', () => {
    const html = build({ viewTitle: 'Today', sections: [] })
    expect(html).toContain('No tasks in this view')
    expect(html).toContain('0 tasks')
  })

  it('skips groups and sections that have no tasks', () => {
    const html = build({
      viewTitle: 'T',
      sections: [
        { heading: 'EmptySection', groups: [{ heading: 'EmptyGroup', tasks: [] }] },
        { heading: 'Full', groups: [{ tasks: [makeTask()] }] },
      ],
    })
    expect(html).not.toContain('EmptySection')
    expect(html).not.toContain('EmptyGroup')
    expect(html).toContain('Full')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/renderer/lib/__tests__/print-template.test.ts`
Expected: FAIL — `Cannot find module '../print-template'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `src/renderer/lib/print-template.ts`:

```ts
import type { Task } from './vikunja-types'
import { isNullDate } from './date-utils'
import { normalizeHex } from './constants'

export interface PrintGroup {
  heading?: string
  tasks: Task[]
}

export interface PrintSection {
  heading?: string
  groups: PrintGroup[]
}

export interface PrintablePayload {
  viewTitle: string
  sections: PrintSection[]
}

export interface PrintOptions {
  // Injected (instead of importing sanitizeTaskHtml / the logo asset) so this
  // module stays a pure function testable in vitest's node environment.
  sanitize: (html: string) => string
  logoDataUrl: string
  now?: Date
}

const PRIORITY_LABELS = ['', 'Low', 'Medium', 'High', 'Urgent']

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatPrintDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function hasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}

function renderLabels(task: Task): string {
  const labels = task.labels ?? []
  if (labels.length === 0) return ''
  const pills = labels
    .map((l) => {
      const hex = normalizeHex(l.hex_color) ?? '#999999'
      return `<span class="label"><span class="label-dot" style="background:${hex}"></span>${escapeHtml(l.title)}</span>`
    })
    .join('')
  return `<span class="labels">${pills}</span>`
}

function renderTask(task: Task, sanitize: (html: string) => string): string {
  const meta: string[] = []
  if (task.priority > 0 && PRIORITY_LABELS[task.priority]) {
    meta.push(`<span class="meta-priority">⚑ ${PRIORITY_LABELS[task.priority]}</span>`)
  }
  if (!isNullDate(task.due_date)) meta.push(`Due ${formatPrintDate(task.due_date)}`)
  if (!isNullDate(task.start_date)) meta.push(`Starts ${formatPrintDate(task.start_date)}`)
  if (task.done && !isNullDate(task.done_at)) meta.push(`Completed ${formatPrintDate(task.done_at)}`)

  const notes = sanitize(task.description ?? '')
  return `
    <div class="task${task.done ? ' done' : ''}">
      <span class="checkbox">${task.done ? '✓' : ''}</span>
      <div class="task-body">
        <div class="task-line">
          <span class="task-title">${escapeHtml(task.title)}</span>
          ${renderLabels(task)}
        </div>
        ${meta.length > 0 ? `<div class="task-meta">${meta.join('<span class="sep">·</span>')}</div>` : ''}
        ${hasText(notes) ? `<div class="task-notes">${notes}</div>` : ''}
      </div>
    </div>`
}

export function buildPrintHtml(payload: PrintablePayload, options: PrintOptions): string {
  const now = options.now ?? new Date()
  const dateLine = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const allTasks = payload.sections.flatMap((s) => s.groups.flatMap((g) => g.tasks))
  const countLine = `${allTasks.length} ${allTasks.length === 1 ? 'task' : 'tasks'}`

  const body =
    allTasks.length === 0
      ? '<p class="empty">No tasks in this view.</p>'
      : payload.sections
          .map((section) => {
            const groups = section.groups
              .filter((g) => g.tasks.length > 0)
              .map(
                (g) =>
                  `${g.heading ? `<h3 class="group-heading">${escapeHtml(g.heading)}</h3>` : ''}${g.tasks
                    .map((t) => renderTask(t, options.sanitize))
                    .join('')}`
              )
              .join('')
            if (!groups) return ''
            return `<section>${
              section.heading ? `<h2 class="section-heading">${escapeHtml(section.heading)}</h2>` : ''
            }${groups}</section>`
          })
          .join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(payload.viewTitle)} — Vicu</title>
<style>
  @page { margin: 18mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, 'Segoe UI', system-ui, Roboto, sans-serif;
    color: #1a1a1a;
    font-size: 13px;
    line-height: 1.45;
  }
  .brand { display: flex; align-items: center; gap: 6px; margin-bottom: 14px; }
  .brand img { width: 18px; height: 18px; border-radius: 4px; }
  .brand span { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: #555; text-transform: uppercase; }
  h1 { font-size: 26px; margin: 0 0 2px; }
  .date-line { font-size: 12px; color: #666; margin: 0 0 16px; }
  .date-line .count { color: #999; }
  hr.rule { border: none; border-top: 1px solid #ddd; margin: 0 0 6px; }
  .section-heading {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
    color: #444; margin: 18px 0 4px; break-after: avoid;
  }
  .group-heading {
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
    color: #888; margin: 10px 0 2px; break-after: avoid;
  }
  .task {
    display: flex; gap: 8px; padding: 5px 0;
    border-bottom: 1px solid #eee;
    break-inside: avoid;
  }
  .checkbox {
    flex-shrink: 0; width: 13px; height: 13px; margin-top: 2px;
    border: 1.5px solid #555; border-radius: 3px;
    font-size: 10px; line-height: 11px; text-align: center; color: #555;
  }
  .task-body { min-width: 0; flex: 1; }
  .task-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .task-title { font-weight: 500; }
  .done .task-title { text-decoration: line-through; color: #888; }
  .labels { display: inline-flex; gap: 4px; flex-wrap: wrap; }
  .label {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; color: #555; border: 1px solid #ccc; border-radius: 9px;
    padding: 0 7px; line-height: 16px;
  }
  .label-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
  .task-meta { font-size: 11px; color: #777; margin-top: 1px; }
  .task-meta .sep { margin: 0 5px; color: #bbb; }
  .meta-priority { font-weight: 600; color: #444; }
  .task-notes { font-size: 11.5px; color: #444; margin-top: 3px; }
  .task-notes p { margin: 0 0 4px; }
  .task-notes ul, .task-notes ol { margin: 2px 0 4px; padding-left: 18px; }
  .task-notes a { color: #444; }
  .task-notes pre, .task-notes code { font-family: Consolas, monospace; font-size: 10.5px; }
  .task-notes blockquote { margin: 2px 0; padding-left: 8px; border-left: 2px solid #ccc; color: #666; }
  .empty { color: #777; font-size: 13px; }
  footer {
    margin-top: 28px; padding-top: 8px; border-top: 1px solid #ddd;
    font-size: 10px; color: #999;
  }
</style>
</head>
<body>
  <div class="brand"><img src="${options.logoDataUrl}" alt=""><span>Vicu</span></div>
  <h1>${escapeHtml(payload.viewTitle)}</h1>
  <p class="date-line">${dateLine} <span class="count">· ${countLine}</span></p>
  <hr class="rule">
  ${body}
  <footer>Printed from Vicu · ${dateLine}</footer>
</body>
</html>`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/renderer/lib/__tests__/print-template.test.ts`
Expected: PASS (13 tests). If the due-date test fails on a timezone boundary (`2026-06-12T00:00:00Z` rendering as Jun 11 in negative-UTC-offset zones — this machine is UTC+2 so it won't, but a subagent should know): change the test input to `2026-06-12T12:00:00Z`, not the implementation.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: all existing tests still pass.

```bash
git add src/renderer/lib/print-template.ts src/renderer/lib/__tests__/print-template.test.ts
git commit -m "feat: add print document template for printable views"
```

---

### Task 2: Print store + usePrintable hook

**Files:**
- Create: `src/renderer/stores/print-store.ts`
- Test: `src/renderer/stores/__tests__/print-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/stores/__tests__/print-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { usePrintStore } from '../print-store'

describe('print store', () => {
  it('starts with no payload', () => {
    expect(usePrintStore.getState().payload).toBeNull()
  })

  it('stores and clears a payload', () => {
    const payload = { viewTitle: 'Today', sections: [] }
    usePrintStore.getState().setPayload(payload)
    expect(usePrintStore.getState().payload).toBe(payload)
    usePrintStore.getState().clearPayload()
    expect(usePrintStore.getState().payload).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/renderer/stores/__tests__/print-store.test.ts`
Expected: FAIL — cannot resolve `../print-store`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/stores/print-store.ts`:

```ts
import { useEffect } from 'react'
import { create } from 'zustand'
import type { PrintablePayload } from '@/lib/print-template'

interface PrintState {
  payload: PrintablePayload | null
  setPayload: (payload: PrintablePayload) => void
  clearPayload: () => void
}

export const usePrintStore = create<PrintState>((set) => ({
  payload: null,
  setPayload: (payload) => set({ payload }),
  clearPayload: () => set({ payload: null }),
}))

// Keeps the store in sync with the tasks currently on screen so Ctrl+P always
// prints what the user is looking at. Views must call this before any
// early-return (hooks order). Pass a useMemo'd payload to avoid re-setting on
// every render.
export function usePrintable(payload: PrintablePayload): void {
  const setPayload = usePrintStore((s) => s.setPayload)
  const clearPayload = usePrintStore((s) => s.clearPayload)
  useEffect(() => {
    setPayload(payload)
  }, [payload, setPayload])
  useEffect(() => () => clearPayload(), [clearPayload])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/renderer/stores/__tests__/print-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/print-store.ts src/renderer/stores/__tests__/print-store.test.ts
git commit -m "feat: add print payload store and usePrintable hook"
```

---

### Task 3: Main-process print module, IPC, preload, and menu item

No unit tests — this is Electron plumbing; verified manually in Task 6.

**Files:**
- Create: `src/main/print.ts`
- Modify: `src/main/ipc-handlers.ts` (add one handler inside `registerIpcHandlers`)
- Modify: `src/main/app-menu.ts:54` (File submenu)
- Modify: `src/preload/index.ts` (two entries in the `api` object)
- Modify: `src/preload/index.d.ts` (two entries in `ElectronAPI`)
- Modify: `src/renderer/lib/api.ts` (two wrappers)

- [ ] **Step 1: Create `src/main/print.ts`**

```ts
import { BrowserWindow, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'

let printInFlight = false

// Loads the pre-built print document into a hidden window and opens the
// system print dialog. A temp file (not a data: URL) sidesteps Chromium's
// data-URL size limit for task lists with many embedded notes.
export async function printHtml(
  html: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (printInFlight) return { success: false, error: 'A print job is already in progress' }
  printInFlight = true

  const tempFile = path.join(app.getPath('temp'), `vicu-print-${Date.now()}.html`)
  let win: BrowserWindow | null = null
  try {
    await fs.promises.writeFile(tempFile, html, 'utf-8')
    win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    })
    await win.loadURL(pathToFileURL(tempFile).toString())

    const result = await new Promise<{ ok: boolean; reason: string }>((resolve) => {
      win!.webContents.print({ printBackground: true }, (ok, reason) =>
        resolve({ ok, reason })
      )
    })

    if (!result.ok && !/cancel/i.test(result.reason)) {
      return { success: false, error: result.reason || 'Print failed' }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    win?.destroy()
    fs.promises.unlink(tempFile).catch(() => {})
    printInFlight = false
  }
}
```

- [ ] **Step 2: Register the IPC handler**

In `src/main/ipc-handlers.ts`, add to the imports (after the `./sound` import block around line 58):

```ts
import { printHtml } from './print'
```

Inside `registerIpcHandlers()`, after the task handlers (after the `fetch-task-by-id` handler around line 108), add:

```ts
  // Print
  ipcMain.handle('print-html', (_event, html: string) => printHtml(html))
```

- [ ] **Step 3: Add the File → Print menu item**

In `src/main/app-menu.ts`, the File submenu currently ends (lines 53–56):

```ts
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
```

Replace with:

```ts
      },
      { type: 'separator' },
      {
        label: 'Print…',
        accelerator: 'CmdOrCtrl+P',
        click: () => {
          const win = getMainWindow()
          if (win) {
            win.webContents.send('print-view')
          }
        },
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
```

(`getMainWindow` is already the parameter of `setupApplicationMenu` — no import needed.)

- [ ] **Step 4: Expose in preload**

In `src/preload/index.ts`, add to the `api` object after the `onNavigate` entry (line 167):

```ts
  // Print
  printHtml: (html: string) =>
    ipcRenderer.invoke('print-html', html),
  onPrintView: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('print-view', handler)
    return () => { ipcRenderer.removeListener('print-view', handler) }
  },
```

In `src/preload/index.d.ts`, add to `ElectronAPI` after `onNavigate` (line 128):

```ts
  // Print
  printHtml(html: string): Promise<{ success: true } | { success: false; error: string }>
  onPrintView(cb: () => void): () => void
```

- [ ] **Step 5: Add renderer api wrappers**

In `src/renderer/lib/api.ts`, after the `onNavigate` wrapper (line 183), add:

```ts
  printHtml: (html: string) =>
    window.api.printHtml(html) as Promise<{ success: true } | { success: false; error: string }>,
  onPrintView: (cb: () => void) =>
    window.api.onPrintView?.(cb) ?? (() => {}),
```

- [ ] **Step 6: Verify it builds and commit**

Run: `npm run build`
Expected: completes without errors.

```bash
git add src/main/print.ts src/main/ipc-handlers.ts src/main/app-menu.ts src/preload/index.ts src/preload/index.d.ts src/renderer/lib/api.ts
git commit -m "feat: wire File > Print menu, IPC, and hidden-window print module"
```

---

### Task 4: Logo asset + AppShell print trigger

**Files:**
- Create: `src/renderer/assets/icon.png` (copy of `resources/icon.png`)
- Create: `src/renderer/env.d.ts`
- Modify: `src/renderer/components/layout/AppShell.tsx`

- [ ] **Step 1: Copy the logo into the renderer bundle**

```powershell
Copy-Item C:\Users\rendy\vscode\vicu\resources\icon.png C:\Users\rendy\vscode\vicu\src\renderer\assets\icon.png
```

(The print document is loaded from a temp file, so it cannot reference app paths — the logo must be a base64 data URL baked into the HTML. Vite's `?inline` import suffix forces that. `resources/icon.png` is 70 KB → ~94 KB inlined; fine for an ephemeral document.)

- [ ] **Step 2: Create `src/renderer/env.d.ts`** (no asset-module declarations exist yet; `tsconfig.web.json` includes `src/renderer/**/*` so this is picked up automatically)

```ts
declare module '*.png?inline' {
  const src: string
  export default src
}
```

- [ ] **Step 3: Wire the print trigger in AppShell**

In `src/renderer/components/layout/AppShell.tsx`, add imports (after the `NULL_DATE` import on line 45):

```ts
import { usePrintStore } from '@/stores/print-store'
import { buildPrintHtml } from '@/lib/print-template'
import { sanitizeTaskHtml } from '@/lib/sanitize-html'
import vicuLogo from '@/assets/icon.png?inline'
```

Inside the `AppShell` component, after the "Handle navigate events" effect (lines 524–529), add:

```ts
  // Print the current view when the File menu / Ctrl+P fires. Views register
  // their on-screen tasks via usePrintable; no payload (Settings, Setup)
  // means nothing to print.
  useEffect(() => {
    return api.onPrintView(async () => {
      const payload = usePrintStore.getState().payload
      if (!payload) return
      const html = buildPrintHtml(payload, {
        sanitize: sanitizeTaskHtml,
        logoDataUrl: vicuLogo,
      })
      const result = await api.printHtml(html)
      if (!result.success) {
        console.error('Print failed:', result.error)
      }
    })
  }, [])
```

- [ ] **Step 4: Verify it builds and commit**

Run: `npm run build`
Expected: completes without errors.

```bash
git add src/renderer/assets/icon.png src/renderer/env.d.ts src/renderer/components/layout/AppShell.tsx
git commit -m "feat: build and print the registered view payload from AppShell"
```

---

### Task 5: Register printable payloads in all eight list views

**Files (all Modify):**
- `src/renderer/views/InboxView.tsx`
- `src/renderer/views/TodayView.tsx`
- `src/renderer/views/UpcomingView.tsx`
- `src/renderer/views/AnytimeView.tsx`
- `src/renderer/views/LogbookView.tsx`
- `src/renderer/views/ProjectView.tsx`
- `src/renderer/views/TagView.tsx`
- `src/renderer/views/CustomListView.tsx`

Every view: add `import { usePrintable } from '@/stores/print-store'`, ensure `useMemo` is imported from `react`, and place the `usePrintable(...)` call **before the `if (isLoading)` early return** (hooks must run unconditionally). The payload mirrors exactly what the view renders.

- [ ] **Step 1: InboxView** — flat list. Add after the `setReorderContext` effect (line 23):

```ts
  usePrintable(
    useMemo(() => ({ viewTitle: 'Inbox', sections: [{ groups: [{ tasks }] }] }), [tasks])
  )
```

(Also add `useMemo` to the react import: `import { useEffect, useMemo, useState } from 'react'`.)

- [ ] **Step 2: TodayView** — Overdue/Today sections with project groups. Add after the `todayGroups` memo (line 62):

```ts
  usePrintable(
    useMemo(
      () => ({
        viewTitle: 'Today',
        sections: [
          ...(overdueGroups.length > 0
            ? [{ heading: 'Overdue', groups: overdueGroups.map((g) => ({ heading: g.name, tasks: g.tasks })) }]
            : []),
          ...(todayGroups.length > 0
            ? [{ heading: 'Today', groups: todayGroups.map((g) => ({ heading: g.name, tasks: g.tasks })) }]
            : []),
        ],
      }),
      [overdueGroups, todayGroups]
    )
  )
```

- [ ] **Step 3: UpcomingView** — date sections with project groups. Add after the `groups` memo (line 83):

```ts
  usePrintable(
    useMemo(
      () => ({
        viewTitle: 'Upcoming',
        sections: groups.map((g) => ({
          heading: g.label,
          groups: groupByProject(g.tasks, projects?.flat).map((pg) => ({
            heading: pg.name,
            tasks: pg.tasks,
          })),
        })),
      }),
      [groups, projects?.flat]
    )
  )
```

- [ ] **Step 4: AnytimeView** — root-project sections with subproject groups (no group heading when the subgroup IS the root project, matching on-screen rendering). Add after the `groups` memo (line 65):

```ts
  usePrintable(
    useMemo(
      () => ({
        viewTitle: 'Anytime',
        sections: groups.map((group) => ({
          heading: group.projectName,
          groups: group.subGroups.map((sub) => ({
            heading: sub.projectId === group.projectId ? undefined : sub.projectName,
            tasks: sub.tasks,
          })),
        })),
      }),
      [groups]
    )
  )
```

- [ ] **Step 5: LogbookView** — flat list of done tasks (template shows checked boxes + completion dates automatically). Add after the `useTasks` call (line 40):

```ts
  usePrintable(
    useMemo(() => ({ viewTitle: 'Logbook', sections: [{ groups: [{ tasks }] }] }), [tasks])
  )
```

- [ ] **Step 6: ProjectView** — parent tasks first, then one section per project section. Add after the `clearSectionContexts` effect (line 47); add `useMemo` to the react import:

```ts
  usePrintable(
    useMemo(
      () => ({
        viewTitle: projectName,
        sections: [
          ...(tasks.length > 0 ? [{ groups: [{ tasks }] }] : []),
          ...sections.map((s) => ({ heading: s.project.title, groups: [{ tasks: s.tasks }] })),
        ],
      }),
      [projectName, tasks, sections]
    )
  )
```

- [ ] **Step 7: TagView** — one section, project groups. Add after the `groups` memo (line 40):

```ts
  usePrintable(
    useMemo(
      () => ({
        viewTitle: labelName,
        sections: [{ groups: groups.map((g) => ({ heading: g.name, tasks: g.tasks })) }],
      }),
      [labelName, groups]
    )
  )
```

- [ ] **Step 8: CustomListView** — flat filtered list. Add after the `filteredTasks` memo (line 143):

```ts
  usePrintable(
    useMemo(
      () => ({
        viewTitle: customList?.name ?? 'List',
        sections: [{ groups: [{ tasks: filteredTasks }] }],
      }),
      [customList?.name, filteredTasks]
    )
  )
```

- [ ] **Step 9: Verify build + full test suite, then commit**

Run: `npm run build` then `npm test`
Expected: both pass.

```bash
git add src/renderer/views
git commit -m "feat: register printable payloads in all list views"
```

---

### Task 6: Manual verification

No automated coverage is possible for the Electron print dialog — verify in the running app.

- [ ] **Step 1: Start the app**

Run: `npm run dev` (leave running; the app window opens with DevTools)

- [ ] **Step 2: Walk the checklist**

1. **Today view + Ctrl+P** → system print dialog opens; preview shows Vicu logo + wordmark, "Today" title, today's full date, task count, Overdue/Today sections with project group headings.
2. **File → Print…** menu item does the same (on Windows the app is frameless — verify the **Ctrl+P accelerator** fires anyway; if it does not, that's a finding to report, not silently fix).
3. A task with **notes, due date, labels, and priority** shows all details formatted; a bare task is a single compact line.
4. **Upcoming** → date sections. **Project with sections** → section headings. **Logbook** → checked boxes, strikethrough, completion dates.
5. **Settings view + Ctrl+P** → nothing happens (no dialog, no console error).
6. **Cancel the print dialog** → no error logged in DevTools console.
7. Print one view **to PDF** (Microsoft Print to PDF) and open it: layout intact, no task split across a page boundary, notes render formatted (bold/lists/links).
8. Press **Ctrl+P twice quickly** → second invocation logs the "already in progress" error at worst; no crash.

- [ ] **Step 3: Confirm clean state and finish**

Run: `npm test` and `git status` (working tree should contain only intended changes — all already committed).

---

## Self-review notes

- **Spec coverage:** trigger (Task 3), all 8 views (Task 5), document layout/branding/date/details (Task 1), hidden-window printing + cancel handling + single-in-flight (Task 3), no-op on Settings (Task 4 guard), error union (Task 3). Toast → console.error deviation documented at top.
- **Type consistency:** `PrintablePayload`/`PrintSection`/`PrintGroup` defined once in `print-template.ts`, imported by the store; `usePrintable` used identically in all views; `printHtml` signature identical across main/preload/d.ts/api.ts.
- The spec's `sections: { heading?, tasks }` shape was refined to two-level `sections → groups` during planning because Today/Upcoming/Anytime render two heading levels on screen; the spec's intent (printout mirrors on-screen grouping) is preserved.
