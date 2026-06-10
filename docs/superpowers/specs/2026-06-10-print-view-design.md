# Print Current View — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

Let the user print whatever list view they are looking at (Today, Upcoming, Inbox, Anytime, Logbook, Project, Tag, Custom List) as a nicely laid-out paper document or PDF. The printout clearly shows the date, Vicu branding, and full task details — notes, dates, labels, priority.

## Decisions

- **Scope:** all list views. Settings/Setup are not printable (Ctrl+P no-ops there).
- **Output:** system print dialog via Electron `webContents.print()` — covers physical printers and OS-level Print-to-PDF. No separate "Export PDF" path.
- **Detail level:** full details always — notes, due/start dates, labels, priority. No per-print options dialog. Tasks without extras render as a single compact line.
- **Trigger:** `File → Print` menu item with `CmdOrCtrl+P` accelerator. No in-view print button.
- **Approach:** dedicated hidden print window loading a generated, self-contained HTML document (chosen over `@media print` CSS on the main window, which would be clipped by the app's fixed-height scroll containers and dark theme; and over an in-app preview modal, which duplicates the system dialog's preview).

## Architecture

### Data flow

1. **Registration.** A new Zustand store `src/renderer/stores/print-store.ts` holds the current view's printable payload:

   ```ts
   interface PrintablePayload {
     viewTitle: string
     sections: { heading?: string; tasks: Task[] }[]
   }
   ```

   Each list view calls a `usePrintable(payload)` hook that writes its payload to the store on render and clears it on unmount. Grouped views (Upcoming date groups, Project buckets) pass their groups as `sections` so the printout mirrors on-screen grouping.

2. **Trigger.** `src/main/app-menu.ts` gains a `File → Print` item (`CmdOrCtrl+P`) that sends `print-view` to the focused main window's webContents, following the existing `new-task` pattern. The preload exposes an `onPrintView(cb)` subscription; `AppShell` subscribes.

3. **Document generation.** On the event, AppShell reads the store. If empty (Settings/Setup), it no-ops. Otherwise it calls `buildPrintHtml(payload)` — a pure function in `src/renderer/lib/print-template.ts` returning a complete HTML string with inline CSS and an embedded (base64) logo. Task notes pass through the existing `sanitizeTaskHtml` before embedding.

4. **Printing.** Renderer calls `window.api.printHtml(html)`. A new `src/main/print.ts` module:
   - creates a hidden `BrowserWindow` (`show: false`, sandboxed, no node integration),
   - loads the HTML via `data:` URL,
   - on `did-finish-load`, calls `webContents.print({ printBackground: true })` — opens the system print dialog,
   - destroys the window in the print callback (and on failure),
   - returns the standard `{ success: true } | { success: false, error }` union.

### Error handling

- Print failure or dialog-open failure → `{ success: false, error }` → toast in the renderer.
- Ctrl+P with no printable payload → silent no-op.
- A second Ctrl+P while a print window is already open is ignored (single in-flight print).

## Print document layout

Always light, ink-friendly, system font stack, `@page` margins suitable for A4/Letter.

- **Header:** Vicu logo glyph + "Vicu" wordmark; below it the view title in large type, the full printed date (e.g. "Wednesday, June 10, 2026", locale-formatted via `Intl.DateTimeFormat`), and the open-task count. Hairline rule below. The logo asset lives in `src/renderer/assets/` so Vite inlines it as base64 — required because a `data:` URL document cannot resolve external file paths.
- **Sections:** group headings rendered as small-caps subheaders.
- **Task entry:**
  - printed checkbox — empty square for open tasks; checked square + strikethrough title for done tasks (Logbook),
  - title,
  - priority flag with text label (High / Urgent / etc.) when priority > 0,
  - labels as outlined pills,
  - muted dates line: due date, start date when set (skipping Vikunja's `NULL_DATE`),
  - notes rendered as formatted HTML in smaller type beneath the title,
  - `break-inside: avoid` so a task never splits across pages.
- **Footer:** "Printed from Vicu · <date>" in small muted type.

## Files

| File | Change |
|---|---|
| `src/renderer/lib/print-template.ts` | new — `buildPrintHtml(payload): string` |
| `src/renderer/stores/print-store.ts` | new — payload store + `usePrintable` hook |
| `src/main/print.ts` | new — hidden window, system print dialog |
| `src/main/app-menu.ts` | add File → Print (`CmdOrCtrl+P`) |
| `src/main/ipc-handlers.ts` | register `print-html` handler |
| `src/preload/index.ts` | expose `printHtml()` invoke + `onPrintView()` event |
| `src/renderer/views/*` (8 views) | one `usePrintable(...)` call each |

## Testing

No test runner is configured in this repo. Verification is manual:

- `npm run dev`, press Ctrl+P in each view, confirm the system dialog opens and the preview shows correct content/grouping.
- During development, render the generated HTML through `printToPDF` to inspect layout (pagination, `break-inside`, long notes) without printing.
- Check edge cases: empty view, task with no notes/dates, very long note, Logbook (done styling), Settings (no-op).
