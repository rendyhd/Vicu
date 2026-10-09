# Vicu Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all confirmed findings from the 2026-06-11 codebase review: a write-only offline queue, a 50-task pagination cap, window-lifecycle bugs, Quick View filter parity gaps, and renderer/main-process performance issues.

**Architecture:** Vicu is an Electron app (main process in `src/main/`, preloads in `src/preload/`, React renderer in `src/renderer/`). All API calls flow renderer → preload (`window.api`) → `ipcMain.handle` in `src/main/ipc-handlers.ts` → `src/main/api-client.ts` (Vikunja HTTP via `net.request`). Results use the discriminated union `{ success: true, data } | { success: false, error }`. Fixes are grouped into independent tasks, each one commit; tasks within a phase are ordered, phases are independent.

**Tech Stack:** Electron 33, React 18, TypeScript 5.5, TanStack Query 5, Zustand 4, Tailwind 3, vitest 4 (`npm test`).

**Critical project rules (from CLAUDE.md):**
- **Go zero-value problem:** task/project updates must always send the *complete* object. Sending `{ done: true }` alone zeroes out `due_date`, `priority`, etc. on the server.
- Vikunja's null date is `0001-01-01T00:00:00Z` (`NULL_DATE` in `src/renderer/lib/constants.ts`).
- Platform branching in main uses `isMac`/`isWindows`/`isLinux` from `src/main/platform.ts`.
- Never manually create GitHub releases; CI handles releases on `v*` tags.

**Verification commands** (used throughout):
- `npm test` — vitest run (config: `vitest.config.ts`, alias `@` → `src/renderer`, tests live in `__tests__` folders anywhere under `src/`)
- `npx tsc --noEmit -p tsconfig.node.json` — typecheck main/preload
- `npx tsc --noEmit -p tsconfig.web.json` — typecheck renderer
- `npm run build` — full electron-vite build (final smoke check)

**Line numbers** in this plan were captured at commit `562d8a6` and will drift as tasks land — locate code by the quoted snippets/function names, not raw numbers.

---

## Phase A — Data integrity

### Task 1: Pure replay logic for the offline queue

The offline pending-action queue (`src/main/cache.ts`) is currently **write-only**: actions are queued by handlers in `src/main/ipc-handlers.ts` (search `addPendingAction`), the UI reports "pending sync", but nothing ever replays them. This task builds the pure, testable mapping from a queued action to an API request. Task 2 wires the executor.

**Files:**
- Create: `src/main/sync-logic.ts`
- Create: `src/main/__tests__/sync-logic.test.ts`
- Modify: `src/main/cache.ts` (export the `PendingAction` interface)

- [ ] **Step 1: Export `PendingAction` from cache.ts**

In `src/main/cache.ts`, change `interface PendingAction {` (near the top) to `export interface PendingAction {`. No other changes.

- [ ] **Step 2: Write the failing test**

Create `src/main/__tests__/sync-logic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { actionToRequest } from '../sync-logic'

const NULL_DATE = '0001-01-01T00:00:00Z'

describe('actionToRequest', () => {
  it('maps a create action to a create request with only set fields', () => {
    const req = actionToRequest({
      id: 'a1', type: 'create', createdAt: '2026-06-10T10:00:00Z',
      title: 'Buy milk', description: null, dueDate: null, projectId: 7,
    })
    expect(req).toEqual({ kind: 'create', projectId: 7, payload: { title: 'Buy milk' } })
  })

  it('includes description and due_date on create when present', () => {
    const req = actionToRequest({
      id: 'a2', type: 'create', createdAt: '2026-06-10T10:00:00Z',
      title: 'Call dentist', description: 'ask about Friday', dueDate: '2026-06-12T23:59:59Z', projectId: 7,
    })
    expect(req).toEqual({
      kind: 'create', projectId: 7,
      payload: { title: 'Call dentist', description: 'ask about Friday', due_date: '2026-06-12T23:59:59Z' },
    })
  })

  it('skips a create with no project id', () => {
    const req = actionToRequest({ id: 'a3', type: 'create', createdAt: '', title: 'x', projectId: null })
    expect(req).toEqual({ kind: 'skip' })
  })

  it('maps complete to a full-object update with done true (Go zero-value rule)', () => {
    const taskData = { id: 5, title: 'T', due_date: '2026-06-12T00:00:00Z', priority: 3 }
    const req = actionToRequest({ id: 'a4', type: 'complete', createdAt: '', taskId: 5, taskData })
    expect(req).toEqual({ kind: 'update', taskId: 5, payload: { ...taskData, done: true } })
  })

  it('maps uncomplete to done false', () => {
    const req = actionToRequest({ id: 'a5', type: 'uncomplete', createdAt: '', taskId: 5, taskData: { id: 5, title: 'T' } })
    expect(req).toEqual({ kind: 'update', taskId: 5, payload: { id: 5, title: 'T', done: false } })
  })

  it('maps schedule-today using the stored dueDate', () => {
    const req = actionToRequest({
      id: 'a6', type: 'schedule-today', createdAt: '', taskId: 5,
      taskData: { id: 5, title: 'T' }, dueDate: '2026-06-10T23:59:59Z',
    })
    expect(req).toEqual({ kind: 'update', taskId: 5, payload: { id: 5, title: 'T', due_date: '2026-06-10T23:59:59Z' } })
  })

  it('maps remove-due-date to the Vikunja null date', () => {
    const req = actionToRequest({
      id: 'a7', type: 'remove-due-date', createdAt: '', taskId: 5,
      taskData: { id: 5, title: 'T' }, dueDate: NULL_DATE,
    })
    expect(req).toEqual({ kind: 'update', taskId: 5, payload: { id: 5, title: 'T', due_date: NULL_DATE } })
  })

  it('maps update-task to the stored taskData verbatim', () => {
    const req = actionToRequest({ id: 'a8', type: 'update-task', createdAt: '', taskId: 5, taskData: { id: 5, title: 'New' } })
    expect(req).toEqual({ kind: 'update', taskId: 5, payload: { id: 5, title: 'New' } })
  })

  it('skips unknown action types and updates without a taskId', () => {
    expect(actionToRequest({ id: 'a9', type: 'mystery', createdAt: '' })).toEqual({ kind: 'skip' })
    expect(actionToRequest({ id: 'a10', type: 'complete', createdAt: '' })).toEqual({ kind: 'skip' })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- src/main/__tests__/sync-logic.test.ts`
Expected: FAIL — cannot resolve `../sync-logic`.

- [ ] **Step 4: Implement `src/main/sync-logic.ts`**

This module must stay **pure** — no electron imports — so it is unit-testable.

```typescript
import type { PendingAction } from './cache'

const NULL_DATE = '0001-01-01T00:00:00Z'

export type ReplayRequest =
  | { kind: 'create'; projectId: number; payload: Record<string, unknown> }
  | { kind: 'update'; taskId: number; payload: Record<string, unknown> }
  | { kind: 'skip' }

/**
 * Map a queued offline action to the API request that replays it.
 * Updates spread the stored full task object first (Go zero-value rule —
 * Vikunja zeroes any field missing from an update body).
 */
export function actionToRequest(action: PendingAction): ReplayRequest {
  switch (action.type) {
    case 'create': {
      if (typeof action.projectId !== 'number' || !action.title) return { kind: 'skip' }
      const payload: Record<string, unknown> = { title: action.title }
      if (action.description) payload.description = action.description
      if (action.dueDate) payload.due_date = action.dueDate
      return { kind: 'create', projectId: action.projectId, payload }
    }
    case 'complete':
      if (typeof action.taskId !== 'number') return { kind: 'skip' }
      return { kind: 'update', taskId: action.taskId, payload: { ...(action.taskData ?? {}), done: true } }
    case 'uncomplete':
      if (typeof action.taskId !== 'number') return { kind: 'skip' }
      return { kind: 'update', taskId: action.taskId, payload: { ...(action.taskData ?? {}), done: false } }
    case 'schedule-today':
      if (typeof action.taskId !== 'number' || typeof action.dueDate !== 'string') return { kind: 'skip' }
      return { kind: 'update', taskId: action.taskId, payload: { ...(action.taskData ?? {}), due_date: action.dueDate } }
    case 'remove-due-date':
      if (typeof action.taskId !== 'number') return { kind: 'skip' }
      return { kind: 'update', taskId: action.taskId, payload: { ...(action.taskData ?? {}), due_date: NULL_DATE } }
    case 'update-task':
      if (typeof action.taskId !== 'number' || !action.taskData) return { kind: 'skip' }
      return { kind: 'update', taskId: action.taskId, payload: action.taskData }
    default:
      return { kind: 'skip' }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/main/__tests__/sync-logic.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/sync-logic.ts src/main/__tests__/sync-logic.test.ts src/main/cache.ts
git commit -m "feat: add pure replay mapping for offline pending actions"
```

### Task 2: Replay executor + wiring (offline queue actually syncs)

**Files:**
- Create: `src/main/sync.ts`
- Modify: `src/main/index.ts` (startup, resume, interval triggers)

- [ ] **Step 1: Create `src/main/sync.ts`**

```typescript
import { loadConfig } from './config'
import { createTask, updateTask } from './api-client'
import { getPendingActions, removePendingAction, isRetriableError } from './cache'
import { actionToRequest } from './sync-logic'
import { getMainWindow, getQuickViewWindow } from './quick-entry-state'

let replaying = false

/**
 * Replay queued offline actions FIFO. Stops at the first retriable
 * (still-offline) failure to preserve ordering; drops actions that fail
 * permanently (404 task deleted, validation error) so the queue can't jam.
 * Safe to call from multiple triggers — concurrent calls no-op.
 */
export async function replayPendingActions(): Promise<void> {
  if (replaying) return
  const config = loadConfig()
  if (!config || config.standalone_mode || !config.vikunja_url) return

  replaying = true
  let applied = 0
  try {
    for (const action of getPendingActions()) {
      const req = actionToRequest(action)
      if (req.kind === 'skip') {
        removePendingAction(action.id)
        continue
      }
      const result = req.kind === 'create'
        ? await createTask(req.projectId, req.payload)
        : await updateTask(req.taskId, req.payload)

      if (result.success) {
        removePendingAction(action.id)
        applied++
      } else if (isRetriableError(result.error)) {
        break // still offline — keep the action and stop, order preserved
      } else {
        console.warn(`[sync] dropping pending action ${action.id} (${action.type}): ${result.error}`)
        removePendingAction(action.id)
      }
    }
  } finally {
    replaying = false
  }

  if (applied > 0) notifyWindowsAfterReplay()
}

function notifyWindowsAfterReplay(): void {
  try {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('tasks-changed')
  } catch { /* ignore */ }
  try {
    const viewer = getQuickViewWindow()
    if (viewer && !viewer.isDestroyed()) viewer.webContents.send('sync-completed')
  } catch { /* ignore */ }
}
```

- [ ] **Step 2: Wire triggers in `src/main/index.ts`**

Add the import near the other main-process imports:

```typescript
import { replayPendingActions } from './sync'
```

Inside `app.whenReady().then(async () => { ... })`, immediately after `initNotifications(mainWindow)` and the existing `powerMonitor.on('resume', ...)` block (search for `powerMonitor.on('resume'`), extend the resume handler and add the startup + interval triggers so the block reads:

```typescript
    // Initialize notification scheduler
    initNotifications(mainWindow)
    powerMonitor.on('resume', () => {
      rescheduleNotifications()
      authManager.onSystemResume()
      void replayPendingActions()
    })

    // Replay any offline-queued actions: once shortly after startup, then
    // every 5 minutes as a safety net while the app runs.
    setTimeout(() => { void replayPendingActions() }, 10_000)
    setInterval(() => { void replayPendingActions() }, 5 * 60_000)
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`. In the app: stop your Vikunja server (or disconnect network), create a task via Quick Entry (it should report saved/cached), restart the server, wait ≤5 minutes (or restart the app and wait 10s). The task must appear on the server and the pending count in Quick View must drop to 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/sync.ts src/main/index.ts
git commit -m "feat: replay offline pending actions on startup, resume, and interval"
```

### Task 3: Abort timed-out requests; queue creates only on connection-level errors

Two related bugs in `src/main/api-client.ts` / `src/main/cache.ts`:
1. The 10s timeout resolves an error but never aborts the request — the server may still apply the write, so a retry/queued-create duplicates the task.
2. `isRetriableError` matches `'Server error'` (any 5xx) and `'timed out'`, so `qe:save-task` queues a duplicate "create" for requests that may have been applied.

**Files:**
- Modify: `src/main/api-client.ts` (the `request` function's timeout)
- Modify: `src/main/cache.ts` (`isRetriableError` + new `isConnectionError`)
- Modify: `src/main/ipc-handlers.ts` (`qe:save-task` uses `isConnectionError`)
- Create: `src/main/error-classify.ts` (classifiers move here so they're testable without electron)
- Test: `src/main/__tests__/error-classify.test.ts` (new)

- [ ] **Step 1: Write the failing test**

`isRetriableError`/`isConnectionError` are pure string matchers, but `cache.ts` imports `electron`. Vitest can't import it. So first move the two classifiers into `src/main/error-classify.ts` (no electron imports), then test that module. Create the test `src/main/__tests__/error-classify.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isRetriableError, isConnectionError, isAuthError } from '../error-classify'

describe('error classification', () => {
  it('connection errors are both retriable and connection-level', () => {
    for (const e of ['net::ERR_CONNECTION_REFUSED', 'ECONNREFUSED 127.0.0.1', 'ERR_INTERNET_DISCONNECTED', 'ENOTFOUND host']) {
      expect(isConnectionError(e)).toBe(true)
      expect(isRetriableError(e)).toBe(true)
    }
  })

  it('timeouts are retriable but NOT connection-level (request may have reached the server)', () => {
    expect(isRetriableError('Request timed out (10s)')).toBe(true)
    expect(isConnectionError('Request timed out (10s)')).toBe(false)
  })

  it('server 5xx errors are neither retriable nor connection-level', () => {
    expect(isRetriableError('Server error — Vikunja may be experiencing issues.')).toBe(false)
    expect(isConnectionError('Server error — Vikunja may be experiencing issues.')).toBe(false)
  })

  it('auth errors are recognized', () => {
    expect(isAuthError('API token is invalid or expired. Check Settings.')).toBe(true)
    expect(isAuthError('Network error')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/main/__tests__/error-classify.test.ts`
Expected: FAIL — cannot resolve `../error-classify`.

- [ ] **Step 3: Create `src/main/error-classify.ts`**

Move the bodies of `isRetriableError` and `isAuthError` out of `src/main/cache.ts` (delete them there) into this new file, with `'Server error'` **removed** from the retriable patterns and the new `isConnectionError` added:

```typescript
/** Errors worth retrying later / serving cache for (network-ish failures). */
export function isRetriableError(error: string): boolean {
  if (!error) return false
  const patterns = [
    'timed out', 'Network error', 'network error', 'net::',
    'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
    'EHOSTUNREACH', 'ENETUNREACH', 'fetch failed', 'socket hang up',
    'ERR_INTERNET_DISCONNECTED', 'ERR_NETWORK_CHANGED',
    'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED',
    'ERR_CONNECTION_TIMED_OUT', 'ERR_ADDRESS_UNREACHABLE',
  ]
  return patterns.some((p) => error.includes(p))
}

/**
 * Errors where the request provably never reached the server (safe to queue
 * a non-idempotent create for replay without risking a duplicate).
 * Note: timeouts and resets are deliberately excluded — those requests may
 * have been received and applied server-side.
 */
export function isConnectionError(error: string): boolean {
  if (!error) return false
  const patterns = [
    'ECONNREFUSED', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH',
    'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED',
    'ERR_INTERNET_DISCONNECTED', 'ERR_ADDRESS_UNREACHABLE',
    'ERR_NETWORK_CHANGED', 'ERR_CONNECTION_TIMED_OUT',
  ]
  return patterns.some((p) => error.includes(p))
}

export function isAuthError(error: string): boolean {
  if (!error) return false
  return (
    error.includes('API token is invalid') ||
    error.includes('API token has insufficient') ||
    error.includes('API token lacks') ||
    error.includes('Session expired')
  )
}
```

In `src/main/cache.ts`, replace the deleted functions with re-exports so existing importers (`ipc-handlers.ts`, `sync.ts`) keep working:

```typescript
export { isRetriableError, isConnectionError, isAuthError } from './error-classify'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/main/__tests__/error-classify.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Abort the request on timeout**

In `src/main/api-client.ts`, in the `request<T>` function, the timeout currently reads:

```typescript
    const timeout = setTimeout(() => {
      resolve({ success: false, error: `Request timed out (${REQUEST_TIMEOUT / 1000}s)` })
    }, REQUEST_TIMEOUT)
```

The `req` variable is declared *after* this. Restructure so the timeout can abort it — replace the timeout block and the `const req = net.request(...)` line with:

```typescript
    let req: Electron.ClientRequest | null = null
    const timeout = setTimeout(() => {
      try { req?.abort() } catch { /* ignore */ }
      resolve({ success: false, error: `Request timed out (${REQUEST_TIMEOUT / 1000}s)` })
    }, REQUEST_TIMEOUT)

    try {
      req = net.request({ method, url })
```

(All subsequent `req.` usages inside the `try` are non-null; if tsc complains, use the local `const r = req` pattern or `req!.` — the assignment happens on the first line of the `try`.)

Apply the same change to `requestMultipart` and `requestBinary` in the same file (same pattern: declare `let req` before the timeout, abort inside it).

- [ ] **Step 6: Queue Quick Entry creates only on connection errors**

In `src/main/ipc-handlers.ts`, the `qe:save-task` handler has:

```typescript
    // If retriable error, cache for later sync
    if (isRetriableError(result.error)) {
```

Change to:

```typescript
    // Queue for later sync only when the request never reached the server —
    // a timeout/reset may have been applied server-side and would duplicate.
    if (isConnectionError(result.error)) {
```

Add `isConnectionError` to the existing `from './cache'` import list in that file. Leave the `qv:*` handlers on `isRetriableError` — their updates are idempotent (full-object writes), so replaying after a timeout is safe.

- [ ] **Step 7: Typecheck + full test run**

Run: `npx tsc --noEmit -p tsconfig.node.json` then `npm test`
Expected: no errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/error-classify.ts src/main/__tests__/error-classify.test.ts src/main/cache.ts src/main/api-client.ts src/main/ipc-handlers.ts
git commit -m "fix: abort timed-out requests and queue creates only on connection-level errors"
```

### Task 4: Paginate task fetches (remove the 50-task cap)

`useTasks` (`src/renderer/hooks/use-tasks.ts`) fetches exactly one page of `DEFAULT_PAGE_SIZE = 50`. Today/Upcoming/Tag/Anytime/Logbook/Inbox all filter client-side from that single page, silently dropping tasks past 50.

**Files:**
- Create: `src/renderer/lib/fetch-all-pages.ts`
- Create: `src/renderer/lib/__tests__/fetch-all-pages.test.ts`
- Modify: `src/renderer/hooks/use-tasks.ts`
- Check: `src/renderer/lib/vikunja-types.ts` — `TaskQueryParams` must have an optional `page?: number` field; add it if missing.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/lib/__tests__/fetch-all-pages.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { fetchAllPages } from '../fetch-all-pages'

interface Item { id: number }
const page = (ids: number[]): Item[] => ids.map((id) => ({ id }))

describe('fetchAllPages', () => {
  it('fetches pages until a short page is returned', async () => {
    const pages = [page([1, 2, 3]), page([4, 5, 6]), page([7])]
    const calls: number[] = []
    const result = await fetchAllPages(async (p) => {
      calls.push(p)
      return pages[p - 1] ?? []
    }, { pageSize: 3 })
    expect(calls).toEqual([1, 2, 3])
    expect(result.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('stops after a single short page', async () => {
    const calls: number[] = []
    const result = await fetchAllPages(async (p) => { calls.push(p); return page([1, 2]) }, { pageSize: 3 })
    expect(calls).toEqual([1])
    expect(result).toHaveLength(2)
  })

  it('dedupes items that shift across page boundaries', async () => {
    const pages = [page([1, 2, 3]), page([3, 4])]
    const result = await fetchAllPages(async (p) => pages[p - 1] ?? [], { pageSize: 3 })
    expect(result.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('respects maxPages as a hard stop', async () => {
    const calls: number[] = []
    await fetchAllPages(async (p) => { calls.push(p); return page([p * 10, p * 10 + 1, p * 10 + 2]) }, { pageSize: 3, maxPages: 2 })
    expect(calls).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/renderer/lib/__tests__/fetch-all-pages.test.ts`
Expected: FAIL — cannot resolve `../fetch-all-pages`.

- [ ] **Step 3: Implement `src/renderer/lib/fetch-all-pages.ts`**

```typescript
interface FetchAllPagesOptions {
  pageSize: number
  /** Hard stop — protects against runaway loops on servers that always fill pages. */
  maxPages?: number
}

/**
 * Fetch pages 1..N until a page comes back shorter than pageSize.
 * Dedupes by `id` because rows can shift between pages while iterating.
 */
export async function fetchAllPages<T extends { id: number }>(
  fetchPage: (page: number) => Promise<T[]>,
  { pageSize, maxPages = 20 }: FetchAllPagesOptions
): Promise<T[]> {
  const all: T[] = []
  const seen = new Set<number>()
  for (let page = 1; page <= maxPages; page++) {
    const batch = await fetchPage(page)
    for (const item of batch) {
      if (!seen.has(item.id)) {
        seen.add(item.id)
        all.push(item)
      }
    }
    if (batch.length < pageSize) break
  }
  return all
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/renderer/lib/__tests__/fetch-all-pages.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Use it in `useTasks`**

In `src/renderer/hooks/use-tasks.ts`, replace the `queryFn` (currently a single `api.fetchTasks({ per_page: DEFAULT_PAGE_SIZE, ...params })` call) with:

```typescript
    queryFn: async () => {
      return fetchAllPages(
        async (page) => {
          const result = await api.fetchTasks({ per_page: DEFAULT_PAGE_SIZE, ...params, page })
          if (!result.success) throw new Error(result.error)
          return result.data ?? []
        },
        { pageSize: DEFAULT_PAGE_SIZE }
      )
    },
```

Add the import: `import { fetchAllPages } from '@/lib/fetch-all-pages'`.

In `src/renderer/lib/vikunja-types.ts`, confirm `TaskQueryParams` includes `page?: number` — add it if absent (the main-process `fetchTasks` already forwards `params.page`, see `src/main/api-client.ts`).

- [ ] **Step 6: Typecheck + manual verification**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors.

Run `npm run dev` against a server with >50 open dated tasks (or temporarily set `DEFAULT_PAGE_SIZE = 5` in `src/renderer/lib/constants.ts` to simulate, then revert): Today/Upcoming/Tags must show tasks beyond the first page.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/fetch-all-pages.ts src/renderer/lib/__tests__/fetch-all-pages.test.ts src/renderer/hooks/use-tasks.ts src/renderer/lib/vikunja-types.ts
git commit -m "fix: paginate task fetches so smart lists see past 50 tasks"
```

---

## Phase B — Feature correctness

### Task 5: Quick View custom-list filter parity (exclude mode, priority, labels)

The `qv:fetch-tasks` handler (`src/main/ipc-handlers.ts`) resolves a custom list by copying only `project_ids`/`sort_by`/`order_by`/`due_date_filter`/`include_today_all_projects` — it drops `priority_filter`, `label_ids`, and `project_filter_mode`. Worst case: an exclude-mode list's `project_ids` get treated as **includes** by `buildViewerFilterParams`, showing exactly the wrong projects. The main window applies all these client-side (`src/renderer/views/CustomListView.tsx`, `filteredTasks` memo).

Decision (documented): `include_done` stays unsupported in Quick View — it is a popup for *open* tasks.

**Files:**
- Create: `src/main/quick-entry/custom-list-filter.ts`
- Create: `src/main/quick-entry/__tests__/custom-list-filter.test.ts`
- Modify: `src/main/config.ts` (`custom_lists` filter type gains `project_filter_mode?: 'include' | 'exclude'`)
- Modify: `src/main/ipc-handlers.ts` (`qv:fetch-tasks`)

- [ ] **Step 1: Write the failing test**

Create `src/main/quick-entry/__tests__/custom-list-filter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { applyCustomListTaskFilter } from '../custom-list-filter'

const tasks = [
  { id: 1, project_id: 10, priority: 0, labels: [{ id: 100 }] },
  { id: 2, project_id: 20, priority: 5, labels: [] },
  { id: 3, project_id: 10, priority: 3, labels: [{ id: 200 }] },
]

describe('applyCustomListTaskFilter', () => {
  it('passes everything through with an empty filter', () => {
    expect(applyCustomListTaskFilter(tasks, {})).toHaveLength(3)
  })

  it('removes excluded projects in exclude mode', () => {
    const out = applyCustomListTaskFilter(tasks, { project_filter_mode: 'exclude', project_ids: [10] })
    expect(out.map((t) => t.id)).toEqual([2])
  })

  it('keeps only matching priorities', () => {
    const out = applyCustomListTaskFilter(tasks, { priority_filter: [3, 5] })
    expect(out.map((t) => t.id)).toEqual([2, 3])
  })

  it('keeps only tasks bearing one of the label ids', () => {
    const out = applyCustomListTaskFilter(tasks, { label_ids: [100] })
    expect(out.map((t) => t.id)).toEqual([1])
  })

  it('treats include mode project_ids as a server-side concern (no client filtering)', () => {
    const out = applyCustomListTaskFilter(tasks, { project_filter_mode: 'include', project_ids: [10] })
    expect(out).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/main/quick-entry/__tests__/custom-list-filter.test.ts`
Expected: FAIL — cannot resolve `../custom-list-filter`.

- [ ] **Step 3: Implement `src/main/quick-entry/custom-list-filter.ts`** (pure, no electron imports)

```typescript
export interface CustomListClientFilter {
  project_ids?: number[]
  project_filter_mode?: 'include' | 'exclude'
  priority_filter?: number[]
  label_ids?: number[]
}

interface FilterableTask {
  project_id?: number
  priority?: number
  labels?: Array<{ id: number }>
}

/**
 * Client-side leg of custom-list filtering for the Quick View. Mirrors the
 * main window's CustomListView.filteredTasks: exclude-mode projects,
 * priorities, and labels can't be expressed in the Vikunja filter string the
 * viewer builds, so they're applied to the fetched set here.
 */
export function applyCustomListTaskFilter<T extends FilterableTask>(
  tasks: T[],
  filter: CustomListClientFilter
): T[] {
  return tasks.filter((t) => {
    if (filter.project_filter_mode === 'exclude' && filter.project_ids?.length) {
      if (filter.project_ids.includes(t.project_id as number)) return false
    }
    if (filter.priority_filter?.length && !filter.priority_filter.includes(t.priority ?? 0)) {
      return false
    }
    if (filter.label_ids?.length) {
      const taskLabelIds = (t.labels ?? []).map((l) => l.id)
      if (!filter.label_ids.some((id) => taskLabelIds.includes(id))) return false
    }
    return true
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/main/quick-entry/__tests__/custom-list-filter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Extend the config type**

In `src/main/config.ts`, inside the `custom_lists` array element's `filter` object type (it already has `project_ids`, `sort_by`, `order_by`, `due_date_filter`, `priority_filter`, `label_ids`, `include_done`, `include_today_all_projects`), add:

```typescript
      project_filter_mode?: 'include' | 'exclude'
```

- [ ] **Step 6: Wire into `qv:fetch-tasks`**

In `src/main/ipc-handlers.ts`, add the import:

```typescript
import { applyCustomListTaskFilter, type CustomListClientFilter } from './quick-entry/custom-list-filter'
```

In the `qv:fetch-tasks` handler, the custom-list resolution currently reads:

```typescript
    let effectiveFilter = config.viewer_filter
    if (config.viewer_filter.custom_list_id) {
      const list = config.custom_lists?.find(l => l.id === config.viewer_filter!.custom_list_id)
      if (list) {
        effectiveFilter = {
          project_ids: list.filter.project_ids,
          sort_by: list.filter.sort_by,
          order_by: list.filter.order_by,
          due_date_filter: list.filter.due_date_filter,
          include_today_all_projects: list.filter.include_today_all_projects,
        }
      }
    }
```

Replace with (exclude-mode lists must NOT pass their ids as includes; the client filter handles them):

```typescript
    let effectiveFilter = config.viewer_filter
    let clientFilter: CustomListClientFilter | null = null
    if (config.viewer_filter.custom_list_id) {
      const list = config.custom_lists?.find(l => l.id === config.viewer_filter!.custom_list_id)
      if (list) {
        const isExclude = list.filter.project_filter_mode === 'exclude'
        effectiveFilter = {
          project_ids: isExclude ? [] : list.filter.project_ids,
          sort_by: list.filter.sort_by,
          order_by: list.filter.order_by,
          due_date_filter: list.filter.due_date_filter,
          include_today_all_projects: list.filter.include_today_all_projects,
        }
        clientFilter = {
          project_ids: list.filter.project_ids,
          project_filter_mode: list.filter.project_filter_mode,
          priority_filter: list.filter.priority_filter,
          label_ids: list.filter.label_ids,
        }
      }
    }
```

Then apply `clientFilter` to **both** success paths of the handler. The position-sort path ends with:

```typescript
      setCachedTasks(allTasks)
      return { success: true, tasks: allTasks }
```

becomes:

```typescript
      const filteredAll = clientFilter
        ? applyCustomListTaskFilter(allTasks as Array<{ project_id?: number; priority?: number; labels?: Array<{ id: number }> }>, clientFilter)
        : allTasks
      setCachedTasks(filteredAll)
      return { success: true, tasks: filteredAll }
```

And the normal path:

```typescript
    const result = await fetchTasks(filterParams)
    if (result.success) {
      setCachedTasks(result.data)
      return { success: true, tasks: result.data }
    }
```

becomes:

```typescript
    const result = await fetchTasks(filterParams)
    if (result.success) {
      const tasks = clientFilter
        ? applyCustomListTaskFilter((result.data ?? []) as Array<{ project_id?: number; priority?: number; labels?: Array<{ id: number }> }>, clientFilter)
        : result.data
      setCachedTasks(tasks ?? [])
      return { success: true, tasks }
    }
```

- [ ] **Step 7: Typecheck + manual verification**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors.

Manual: create a custom list with an exclude-mode project filter and a label filter, point the Quick View at it (Settings → Quick View → custom list), open the Quick View, confirm the task set matches the main window's view of the same list.

- [ ] **Step 8: Commit**

```bash
git add src/main/quick-entry/custom-list-filter.ts src/main/quick-entry/__tests__/custom-list-filter.test.ts src/main/config.ts src/main/ipc-handlers.ts
git commit -m "fix: Quick View honors custom-list exclude/priority/label filters"
```

### Task 6: Anytime view excludes the inbox project

CLAUDE.md defines Anytime as "All open tasks (excl. inbox)", but `src/renderer/views/AnytimeView.tsx` groups every open task; `inboxProjectId` is only used as the new-task target.

**Files:**
- Modify: `src/renderer/views/AnytimeView.tsx`

- [ ] **Step 1: Filter inbox tasks out of the grouping**

In the `groups` memo, the task loop currently reads:

```typescript
    const byRoot = new Map<number, Map<number, Task[]>>()
    for (const task of tasks) {
      const rootId = getRootId(task.project_id)
```

Change to:

```typescript
    const byRoot = new Map<number, Map<number, Task[]>>()
    for (const task of tasks) {
      if (inboxProjectId && task.project_id === inboxProjectId) continue
      const rootId = getRootId(task.project_id)
```

And extend the memo dependency array from `[tasks, projectData]` to `[tasks, projectData, inboxProjectId]`.

- [ ] **Step 2: Typecheck + verify**

Run: `npx tsc --noEmit -p tsconfig.web.json` — no errors.
Manual: a task in the configured Inbox project must appear in Inbox but not in Anytime.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/views/AnytimeView.tsx
git commit -m "fix: exclude inbox tasks from the Anytime view per smart-list spec"
```

### Task 7: TodayView's default due date goes stale after midnight

`src/renderer/views/TodayView.tsx` has `const TODAY = new Date()` at module scope — captured once per app launch and passed as `defaultDueDate`, so tasks created from Today after midnight get *yesterday's* date.

**Files:**
- Modify: `src/renderer/views/TodayView.tsx`

- [ ] **Step 1: Move the date into component state**

Delete the module-level line `const TODAY = new Date()` (just above `export function TodayView()`). Inside the component, add near the other hooks:

```typescript
  // Captured per mount (views remount on navigation) — never per app launch,
  // which made tasks created after midnight land on yesterday.
  const [today] = useState(() => new Date())
```

Change the JSX prop `defaultDueDate={TODAY}` to `defaultDueDate={today}`. `useState` is already imported in this file.

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.web.json` — no errors.

```bash
git add src/renderer/views/TodayView.tsx
git commit -m "fix: compute Today view default due date per mount, not per launch"
```

### Task 8: Standalone-mode consistency (return shape + dropped fields)

Two small bugs:
1. `qe:save-task` in standalone mode returns `{ success: true, task }` while server mode returns `{ success: true, data }`; the Quick Entry renderer reads `result.data` (`src/renderer/quick-entry/renderer.ts`, `const createdTask = result.data ...`).
2. `updateStandaloneTask` (`src/main/cache.ts`) only honors `title`/`description`, silently dropping `due_date`/`priority` from `qv:update-task`.

**Files:**
- Modify: `src/main/ipc-handlers.ts` (`qe:save-task` standalone branch)
- Modify: `src/main/cache.ts` (`updateStandaloneTask`)

- [ ] **Step 1: Fix the return shape**

In `src/main/ipc-handlers.ts`, the standalone branch of `qe:save-task`:

```typescript
    if (config.standalone_mode) {
      const task = addStandaloneTask(title, description, dueDate)
      notifyViewerSync()
      return { success: true, task }
    }
```

becomes (keep `task` for the Quick View status path that reads it, add `data` for the renderer):

```typescript
    if (config.standalone_mode) {
      const task = addStandaloneTask(title, description, dueDate)
      notifyViewerSync()
      return { success: true, task, data: task }
    }
```

- [ ] **Step 2: Honor due_date and priority in standalone updates**

In `src/main/cache.ts`, `updateStandaloneTask` currently applies only title/description. Replace its field-application block:

```typescript
  if (updates.title !== undefined) task.title = updates.title as string
  if (updates.description !== undefined) task.description = updates.description as string
```

with:

```typescript
  if (updates.title !== undefined) task.title = updates.title as string
  if (updates.description !== undefined) task.description = updates.description as string
  if (updates.due_date !== undefined) task.due_date = updates.due_date as string
  if (typeof updates.priority === 'number') task.priority = updates.priority
  if (typeof updates.done === 'boolean') task.done = updates.done
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.node.json` — no errors.

```bash
git add src/main/ipc-handlers.ts src/main/cache.ts
git commit -m "fix: standalone save-task return shape and standalone update field coverage"
```

### Task 9: Offline cached task list reflects pending date/update actions

`getCachedTasks` (`src/main/cache.ts`) masks pending completes and appends pending creates, but ignores pending `schedule-today` / `remove-due-date` / `update-task` — the offline Quick View shows pre-action values.

**Files:**
- Create: `src/main/cache-overlay.ts` (pure)
- Create: `src/main/__tests__/cache-overlay.test.ts`
- Modify: `src/main/cache.ts` (`getCachedTasks` delegates)

- [ ] **Step 1: Write the failing test**

Create `src/main/__tests__/cache-overlay.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { overlayPendingActions } from '../cache-overlay'

const NULL_DATE = '0001-01-01T00:00:00Z'
const base = [
  { id: 1, title: 'A', due_date: '2026-06-15T00:00:00Z', done: false },
  { id: 2, title: 'B', due_date: NULL_DATE, done: false },
]

describe('overlayPendingActions', () => {
  it('hides tasks with a pending complete', () => {
    const out = overlayPendingActions(base, [
      { id: 'p1', type: 'complete', createdAt: '', taskId: 1 },
    ])
    expect(out.map((t: any) => t.id)).toEqual([2])
  })

  it('applies a pending schedule-today due date', () => {
    const out = overlayPendingActions(base, [
      { id: 'p2', type: 'schedule-today', createdAt: '', taskId: 2, dueDate: '2026-06-11T23:59:59Z' },
    ])
    expect((out.find((t: any) => t.id === 2) as any).due_date).toBe('2026-06-11T23:59:59Z')
  })

  it('applies a pending remove-due-date', () => {
    const out = overlayPendingActions(base, [
      { id: 'p3', type: 'remove-due-date', createdAt: '', taskId: 1, dueDate: NULL_DATE },
    ])
    expect((out.find((t: any) => t.id === 1) as any).due_date).toBe(NULL_DATE)
  })

  it('merges pending update-task data over the cached row', () => {
    const out = overlayPendingActions(base, [
      { id: 'p4', type: 'update-task', createdAt: '', taskId: 1, taskData: { title: 'A2' } },
    ])
    expect((out.find((t: any) => t.id === 1) as any).title).toBe('A2')
  })

  it('appends pending creates as placeholder rows', () => {
    const out = overlayPendingActions(base, [
      { id: 'p5', type: 'create', createdAt: '2026-06-11T08:00:00Z', title: 'New offline task', projectId: 7 },
    ])
    const created = out.find((t: any) => t.id === 'pending_p5') as any
    expect(created).toBeDefined()
    expect(created.title).toBe('New offline task')
    expect(created.done).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/main/__tests__/cache-overlay.test.ts`
Expected: FAIL — cannot resolve `../cache-overlay`.

- [ ] **Step 3: Implement `src/main/cache-overlay.ts`** (pure, no electron imports)

```typescript
import type { PendingAction } from './cache'

const NULL_DATE = '0001-01-01T00:00:00Z'

/**
 * Project queued offline actions onto a cached task snapshot so the offline
 * Quick View reflects what the user already did: completes hide rows, date
 * actions and updates rewrite rows, creates append placeholder rows.
 */
export function overlayPendingActions(
  cachedTasks: unknown[],
  actions: PendingAction[]
): unknown[] {
  const completedIds = new Set(
    actions.filter((a) => a.type === 'complete').map((a) => String(a.taskId))
  )

  let tasks = cachedTasks.filter((t) => !completedIds.has(String((t as { id?: unknown }).id)))

  for (const action of actions) {
    if (action.taskId === undefined) continue
    const idx = tasks.findIndex((t) => String((t as { id?: unknown }).id) === String(action.taskId))
    if (idx === -1) continue
    const row = tasks[idx] as Record<string, unknown>
    if (action.type === 'schedule-today' || action.type === 'remove-due-date') {
      tasks = tasks.slice()
      tasks[idx] = { ...row, due_date: action.dueDate ?? NULL_DATE }
    } else if (action.type === 'update-task' && action.taskData) {
      tasks = tasks.slice()
      tasks[idx] = { ...row, ...action.taskData }
    }
  }

  const creates = actions
    .filter((a) => a.type === 'create')
    .map((a) => ({
      id: `pending_${a.id}`,
      title: a.title,
      description: a.description || '',
      due_date: a.dueDate || NULL_DATE,
      priority: 0,
      done: false,
      created: a.createdAt,
      updated: a.createdAt,
    }))

  return [...tasks, ...creates]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/main/__tests__/cache-overlay.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Delegate from `getCachedTasks`**

In `src/main/cache.ts`, add `import { overlayPendingActions } from './cache-overlay'` and replace the body of `getCachedTasks` (everything between the early `if (!cache.cachedTasks) return ...` and the final return) so the function reads:

```typescript
export function getCachedTasks(): { tasks: unknown[] | null; timestamp: string | null } {
  const cache = loadCache()
  if (!cache.cachedTasks) return { tasks: null, timestamp: null }
  return {
    tasks: overlayPendingActions(cache.cachedTasks, cache.pendingActions),
    timestamp: cache.cachedTasksTimestamp,
  }
}
```

(Note: if Task 3 landed first, `cache.ts` no longer defines the classifiers — unrelated, just don't reintroduce them.)

- [ ] **Step 6: Typecheck + full tests + commit**

Run: `npx tsc --noEmit -p tsconfig.node.json` and `npm test` — all pass.

```bash
git add src/main/cache-overlay.ts src/main/__tests__/cache-overlay.test.ts src/main/cache.ts
git commit -m "fix: offline cached task list reflects pending date and update actions"
```

### Task 10: Hidden Quick View defers refetch until next show

`src/renderer/quick-view/viewer.ts` reloads tasks on every `sync-completed` broadcast even while hidden — one wasted HTTP fetch per main-window edit.

**Files:**
- Modify: `src/renderer/quick-view/viewer.ts`

- [ ] **Step 1: Track visibility and defer**

The viewer registers window-state listeners near the bottom of the file. Add a module-level flag next to the other state variables (`lastFetchTime`, `lastFetchResult` — search for `let lastFetchTime`):

```typescript
let isWindowVisible = false
```

In the `window.quickViewApi.onShowWindow(() => { ... })` handler, set `isWindowVisible = true` as the first line of the callback. In `onHideWindow`, set `isWindowVisible = false` alongside the existing `container.classList.remove('visible')`.

Replace the sync handler:

```typescript
window.quickViewApi.onSyncCompleted(async () => {
  await loadTasks(true)
})
```

with:

```typescript
window.quickViewApi.onSyncCompleted(async () => {
  if (!isWindowVisible) {
    // Don't fetch while hidden — just invalidate so the next show refetches.
    lastFetchTime = 0
    return
  }
  await loadTasks(true)
})
```

- [ ] **Step 2: Typecheck + verify + commit**

Run: `npx tsc --noEmit -p tsconfig.web.json` — no errors.
Manual: with the Quick View closed, edit a task in the main window (no fetch should fire — check the dev console network/IPC log), then open the Quick View: it must show fresh data.

```bash
git add src/renderer/quick-view/viewer.ts
git commit -m "perf: hidden Quick View defers refetch until next show"
```

---

## Phase C — Window lifecycle

### Task 11: Main window is recreatable; close policy follows tray state

Two related bugs in `src/main/index.ts`:
1. The hide-on-close handler is attached only when Quick Entry/View was enabled *at startup*. Enabling QE later in Settings creates a tray, but closing the main window then **destroys** it — tray "Show Vicu" and `second-instance` both no-op (they check `mainWindow && !isDestroyed()`), leaving a tray-only zombie.
2. `initNotifications(mainWindow)` stores a window ref that goes stale if the window is ever recreated.

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/notifications.ts` (add a ref setter)

- [ ] **Step 1: Add a window-ref setter to notifications**

In `src/main/notifications.ts`, after `initNotifications` (which sets `mainWindowRef` and schedules), add:

```typescript
/** Update the main-window ref after a recreation without rescheduling timers. */
export function setNotificationsMainWindow(mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow
}
```

- [ ] **Step 2: Extract window creation + wiring into a reusable function**

In `src/main/index.ts`, inside the `app.whenReady().then(...)` block, the main window is created and wired inline (search `mainWindow = createMainWindow(config)`). Extract everything window-instance-specific into a module-level function placed near the other helpers (above `setupTray`). Move these pieces into it, exactly as they exist today: the `maximize`/`unmaximize` senders, the `saveBounds` wiring, the dev-tools open, the `closed` handler, the `show` → `reapplyTaskBadge()` handler, and a **unified** close policy:

```typescript
function createAndWireMainWindow(config: AppConfig | null): BrowserWindow {
  const win = createMainWindow(config)

  win.on('maximize', () => win.webContents.send('window-maximized-change', true))
  win.on('unmaximize', () => win.webContents.send('window-maximized-change', false))

  const saveBounds = (): void => {
    if (win.isDestroyed()) return
    const bounds = win.getBounds()
    const current = loadConfig()
    if (current) {
      current.window_bounds = bounds
      saveConfig(current)
    }
  }
  win.on('moved', saveBounds)
  win.on('resized', saveBounds)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Windows drops the taskbar overlay icon when the window is hidden and
  // re-shown. Repaint the badge whenever the window reappears.
  win.on('show', () => {
    reapplyTaskBadge()
  })

  // Unified close policy, evaluated at close time (not startup time):
  // hide instead of closing whenever that leaves the user a way back —
  // always on macOS (dock), elsewhere when the tray is active.
  win.on('close', (e) => {
    if (app.isQuitting) return
    if (isMac || hasTray()) {
      e.preventDefault()
      win.hide()
    }
  })

  setNotificationsMainWindow(win)
  return win
}
```

Add `setNotificationsMainWindow` to the existing `from './notifications'` import.

In `whenReady`, replace the inline `mainWindow = createMainWindow(config)` and all the now-extracted wiring (the `maximize`/`unmaximize` listeners, `saveBounds` + its `moved`/`resized` registrations, the DevTools block, the `closed` handler, the `show` handler, the macOS close handler, and the conditional `!isMac` close handler inside the QE/QV block) with the single call:

```typescript
    mainWindow = createAndWireMainWindow(config)
```

Keep `initNotifications(mainWindow)` where it is (it does the initial scheduling; the setter inside `createAndWireMainWindow` is harmlessly redundant on first creation). Keep the window-control `ipcMain.handle` registrations where they are — they read the module-level `mainWindow` variable and survive recreation.

- [ ] **Step 3: Recreate on demand from the tray and second-instance**

In `setupTray`, change the `onShowMainWindow` callback to:

```typescript
    onShowMainWindow: () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = createAndWireMainWindow(loadConfig())
      }
      mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    },
```

In the `second-instance` handler, change the final block from `if (mainWindow) { ... }` to:

```typescript
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createAndWireMainWindow(loadConfig())
    }
    mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
```

- [ ] **Step 4: Typecheck + manual verification**

Run: `npx tsc --noEmit -p tsconfig.node.json` — no errors.

Manual (`npm run dev`): with Quick Entry initially disabled, enable it in Settings, close the main window (it should now *hide*, not be destroyed, because the tray is active), click tray → "Show Vicu" — the window must come back. Also verify normal quit via tray → Quit still works.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/main/notifications.ts
git commit -m "fix: recreatable main window and tray-aware close policy"
```

### Task 12: Persist window bounds/positions on Linux

`moved`/`resized` are macOS/Windows-only Electron events — on Linux they never fire, so `window_bounds`, `quick_entry_position`, and `quick_view_position` never persist. Use debounced `move`/`resize` (all platforms) instead.

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Main window — debounce inside `createAndWireMainWindow`**

(This builds on Task 11's extraction. If Task 11 was skipped, apply the same change to the inline wiring.) Replace:

```typescript
  win.on('moved', saveBounds)
  win.on('resized', saveBounds)
```

with:

```typescript
  // 'moved'/'resized' are macOS/Windows-only; 'move'/'resize' fire everywhere
  // (including Linux) but continuously — debounce the config write.
  let boundsSaveTimer: NodeJS.Timeout | null = null
  const scheduleSaveBounds = (): void => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    boundsSaveTimer = setTimeout(saveBounds, 500)
  }
  win.on('move', scheduleSaveBounds)
  win.on('resize', scheduleSaveBounds)
  win.on('closed', () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
  })
```

- [ ] **Step 2: Quick Entry / Quick View popups**

In `initQuickEntryWindows`, both popups save their position on `'moved'`. Replace the Quick Entry block:

```typescript
    quickEntryWindow.on('moved', () => {
      if (!quickEntryWindow) return
      const [x, y] = quickEntryWindow.getPosition()
      const current = loadConfig()
      if (current) {
        current.quick_entry_position = { x, y }
        saveConfig(current)
      }
    })
```

with:

```typescript
    let entryMoveTimer: NodeJS.Timeout | null = null
    quickEntryWindow.on('move', () => {
      if (entryMoveTimer) clearTimeout(entryMoveTimer)
      entryMoveTimer = setTimeout(() => {
        if (!quickEntryWindow || quickEntryWindow.isDestroyed()) return
        const [x, y] = quickEntryWindow.getPosition()
        const current = loadConfig()
        if (current) {
          current.quick_entry_position = { x, y }
          saveConfig(current)
        }
      }, 500)
    })
```

Apply the identical pattern to the Quick View block (`quick_view_position`, its own `viewerMoveTimer` variable).

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.node.json` — no errors.
Manual (any platform): move/resize the main window, wait a second, check `config.json` in the userData dir updated.

```bash
git add src/main/index.ts
git commit -m "fix: persist window bounds via debounced move/resize (works on Linux)"
```

### Task 13: Don't block startup on auth network recovery

`await authManager.initialize()` runs before `createMainWindow` in `src/main/index.ts`; with stale tokens it attempts network recovery with a 15s timeout (`STARTUP_RECOVERY_TIMEOUT`, `src/main/auth/auth-manager.ts`) — offline users stare at nothing for 15s. The auth manager has single-flight refresh (`_refreshInProgress`), so a renderer-initiated `auth:check` during recovery joins the same refresh rather than racing it.

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Fire-and-forget the initialize**

In `app.whenReady().then(async () => { ... })`, change:

```typescript
    await authManager.initialize()
```

to:

```typescript
    // Don't block window creation on auth recovery (up to 15s offline).
    // authManager has single-flight refresh, so the renderer's auth:check
    // joins any in-flight recovery instead of racing it; AppShell already
    // renders Loading → ReauthView from the auth:check result.
    void authManager.initialize()
```

No other ordering changes — the `auth-required` forwarding registration and token migration below it are independent of initialize completing.

- [ ] **Step 2: Typecheck + verify + commit**

Run: `npx tsc --noEmit -p tsconfig.node.json` — no errors.
Manual: with OIDC/password auth configured and the server unreachable, launch the app — the window must appear immediately (loading state → reauth screen), not after 15s.

```bash
git add src/main/index.ts
git commit -m "perf: show main window immediately instead of blocking on auth recovery"
```

---

## Phase D — Performance

### Task 14: Stop echoing `tasks-changed` back to the originating window

The `update-task` handler calls `notifyMainWindow()` on every success — including updates the main window itself issued, whose `useUpdateTask.onSettled` already invalidates. Result: two invalidation waves per edit (and it defeats `useCompleteTask`'s skip-invalidation design).

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Thread the sender through**

Change `notifyMainWindow` (bottom of the file) to accept an excluded sender:

```typescript
// Helper: notify main window to refresh its query cache. Pass the sender's
// webContents id to skip the echo when the main window initiated the change —
// its own mutation hooks already invalidate.
function notifyMainWindow(excludeWebContentsId?: number): void {
  try {
    const win = getMainWindow()
    if (win && !win.isDestroyed() && win.webContents.id !== excludeWebContentsId) {
      win.webContents.send('tasks-changed')
    }
  } catch { /* ignore */ }
}
```

In the `update-task` handler, use the event's sender (rename the ignored `_event` param):

```typescript
  ipcMain.handle('update-task', async (event, id: number, task: Record<string, unknown>) => {
    const result = await updateTask(id, task)
    if (result.success) {
      notifyViewerSync()
      notifyMainWindow(event.sender.id)
    }
    return result
  })
```

Leave every other `notifyMainWindow()` call (the `qe:*`/`qv:*` handlers) argument-less — those originate from the popups, where the echo to the main window is the point.

- [ ] **Step 2: Typecheck + verify + commit**

Run: `npx tsc --noEmit -p tsconfig.node.json` — no errors.
Manual: edit a task in the main window — it must update normally (one refetch wave); edit one in Quick View — the main window must still refresh.

```bash
git add src/main/ipc-handlers.ts
git commit -m "perf: don't echo tasks-changed back to the window that made the change"
```

### Task 15: In-memory config cache

`loadConfig()` does `existsSync` + `readFileSync` + `JSON.parse` + normalize on **every** call — and it's called on every API request (`getConfigOrFail` in `src/main/api-client.ts`), every badge update, every popup move.

**Files:**
- Modify: `src/main/config.ts`

- [ ] **Step 1: Wrap load/save with a cache**

In `src/main/config.ts`:

1. Rename the existing `export function loadConfig(): AppConfig | null {` to `function readConfigFromDisk(): AppConfig | null {` (keep its body unchanged, including the macOS hotkey migration that may call `saveConfig`).
2. Add above it:

```typescript
// In-memory cache: the config file is only ever written through saveConfig,
// so disk reads after the first are redundant. Callers receive clones —
// mutating a returned config object must not leak into the cache.
let cachedConfig: AppConfig | null | undefined

export function loadConfig(): AppConfig | null {
  if (cachedConfig === undefined) {
    cachedConfig = readConfigFromDisk()
  }
  return cachedConfig ? structuredClone(cachedConfig) : null
}
```

3. In `saveConfig`, set the cache before writing:

```typescript
export function saveConfig(config: AppConfig): void {
  cachedConfig = structuredClone(config)
  const configPath = getConfigPath()
  const dir = dirname(configPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}
```

(The migration inside `readConfigFromDisk` calling `saveConfig` is fine: it primes the cache, and the subsequent `cachedConfig = readConfigFromDisk()` assignment overwrites it with the same migrated object.)

- [ ] **Step 2: Typecheck + verify + commit**

Run: `npx tsc --noEmit -p tsconfig.node.json` — no errors.
Manual: change theme in Settings, restart the app — the theme must persist (proves save→cache→reload coherence). Note: manual edits to `config.json` while the app runs are no longer picked up until restart — acceptable and now documented by the comment.

```bash
git add src/main/config.ts
git commit -m "perf: cache parsed config in memory instead of re-reading per call"
```

### Task 16: Project sections reuse the cached project-views query

`useProjectSections` (`src/renderer/hooks/use-project-sections.ts`) fetches `fetchProjectViews` inline for every child project on every `['section-tasks']` invalidation — 2 HTTP requests per section per mutation. `useProjectTasks` already caches views under `['project-views', id]` with `staleTime: Infinity`.

**Files:**
- Modify: `src/renderer/hooks/use-project-sections.ts`

- [ ] **Step 1: Fetch views through the query cache**

Add imports: change `import { useQuery } from '@tanstack/react-query'` to `import { useQuery, useQueryClient } from '@tanstack/react-query'`.

Inside `useProjectSections`, add `const qc = useQueryClient()` next to the other hooks. In the `sectionTasksQuery`'s `queryFn`, replace the per-project views fetch:

```typescript
          const viewsResult = await api.fetchProjectViews(cp.id)
          if (!viewsResult.success) return { project: cp, tasks: [] as Task[], viewId: undefined }
          const listView = (viewsResult.data as ProjectView[]).find((v) => v.view_kind === 'list')
```

with a cache-first lookup that shares `useProjectTasks`' query key (so either hook primes the other, and views are fetched once per project per app session):

```typescript
          const views = await qc
            .fetchQuery({
              queryKey: ['project-views', cp.id],
              queryFn: async () => {
                const result = await api.fetchProjectViews(cp.id)
                if (!result.success) throw new Error(result.error)
                return result.data
              },
              staleTime: Infinity,
            })
            .catch(() => null)
          if (!views) return { project: cp, tasks: [] as Task[], viewId: undefined }
          const listView = (views as ProjectView[]).find((v) => v.view_kind === 'list')
```

- [ ] **Step 2: Typecheck + verify + commit**

Run: `npx tsc --noEmit -p tsconfig.web.json` — no errors.
Manual: open a project with subprojects, edit a task title — in dev tools, confirm no `fetch-project-views` IPC storm accompanies each edit (only `fetch-view-tasks` refetches).

```bash
git add src/renderer/hooks/use-project-sections.ts
git commit -m "perf: project sections reuse cached project-views instead of refetching"
```

### Task 17: Selection-store selectors + memoized TaskRow

`TaskRow` destructures 11 fields from `useSelectionStore()` with no selector and isn't memoized — every focus/selection/expand change re-renders every row; arrow-key navigation is a full-list re-render per keypress. `TaskList` (`src/renderer/components/task-list/TaskList.tsx`) has the same whole-store subscription.

**Files:**
- Modify: `src/renderer/components/task-list/TaskRow.tsx`
- Modify: `src/renderer/components/task-list/TaskList.tsx`

- [ ] **Step 1: Convert TaskRow to per-field selectors**

In `TaskRow.tsx`, replace the whole-store destructure at the top of the component:

```typescript
  const {
    expandedTaskId,
    focusedTaskId,
    toggleExpandedTask,
    setFocusedTask,
    setExpandedTask,
    collapseAll,
    selectedTaskIds,
    selectionAnchorId,
    toggleSelected,
    selectOnly,
    setSelectedRange,
    clearSelection,
  } = useSelectionStore()
```

with derived-boolean subscriptions (re-render only when *this row's* state flips) plus stable action references:

```typescript
  const isExpanded = useSelectionStore((s) => s.expandedTaskId === task.id)
  const isFocused = useSelectionStore((s) => s.focusedTaskId === task.id)
  const isSelected = useSelectionStore((s) => s.selectedTaskIds.has(task.id))
  const toggleExpandedTask = useSelectionStore((s) => s.toggleExpandedTask)
  const setFocusedTask = useSelectionStore((s) => s.setFocusedTask)
  const setExpandedTask = useSelectionStore((s) => s.setExpandedTask)
  const collapseAll = useSelectionStore((s) => s.collapseAll)
  const toggleSelected = useSelectionStore((s) => s.toggleSelected)
  const selectOnly = useSelectionStore((s) => s.selectOnly)
  const setSelectedRange = useSelectionStore((s) => s.setSelectedRange)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
```

Then delete the now-duplicate derived lines just below (`const isExpanded = expandedTaskId === task.id`, `const isFocused = ...`, `const isSelected = ...`).

Any **remaining** references in the component body to the raw state fields (`expandedTaskId`, `focusedTaskId`, `selectedTaskIds`, `selectionAnchorId` — the shift-click range logic in the row's click handler uses the anchor) must read fresh state imperatively instead of subscribing:

```typescript
  const { selectionAnchorId, selectedTaskIds } = useSelectionStore.getState()
```

placed at the top of whichever handler uses them (event handlers want current-at-click values anyway — this is behavior-preserving).

- [ ] **Step 2: Memoize TaskRow**

Add `memo` to the react import in `TaskRow.tsx`, rename the component function, and export a memoized wrapper with the same name so all import sites are untouched:

```typescript
function TaskRowInner({ task, sortable = false }: TaskRowProps) {
  // ...existing body...
}

export const TaskRow = memo(TaskRowInner)
```

- [ ] **Step 3: Convert TaskList's subscription**

In `TaskList.tsx`, the component destructures from `useSelectionStore()` (search `} = useSelectionStore()`). Apply the same pattern: each *action* becomes its own selector line (`const setFocusedTask = useSelectionStore((s) => s.setFocusedTask)` etc. for every destructured action), and each piece of *state* it renders from becomes a narrow selector; state used only inside keyboard/click handlers becomes a `useSelectionStore.getState()` read at the top of the handler.

- [ ] **Step 4: Typecheck + behavior check**

Run: `npx tsc --noEmit -p tsconfig.web.json` — no errors.
Manual: arrow-key through a long list (focus ring moves), shift-click range select, multi-drag, expand/collapse — all must behave exactly as before. With React DevTools highlight-updates on, only the affected rows should repaint on focus moves.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/task-list/TaskRow.tsx src/renderer/components/task-list/TaskList.tsx
git commit -m "perf: per-field selection-store selectors and memoized TaskRow"
```

### Task 18: Sidebar resize without app-wide re-renders; persist sidebar_width

Dragging the sidebar divider calls `setSidebarWidth` per mousemove (`AppShell.tsx`, `handleMouseDown`), re-rendering the whole tree per pixel. Separately, the `sidebar_width` config key is normalized in `src/main/config.ts` but never read or written — the store hardcodes 240 and the width resets every launch (CLAUDE.md says it's persisted).

**Files:**
- Modify: `src/renderer/components/layout/AppShell.tsx`

- [ ] **Step 1: Drag via direct style mutation, commit on mouseup**

In `AppShell`, add a ref near the other refs (`dragging`, `startX`, `startWidth` already exist):

```typescript
  const sidebarRef = useRef<HTMLDivElement>(null)
```

Attach it to the sidebar container div (the one with `style={{ width: sidebarWidth }}`):

```tsx
        <div
          ref={sidebarRef}
          className="flex shrink-0 flex-col overflow-hidden border-r border-[var(--border-color)] bg-[var(--bg-sidebar)]"
          style={{ width: sidebarWidth }}
        >
```

Replace `handleMouseDown` with a version that mutates the DOM during drag and writes the store + config once on mouseup:

```typescript
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startWidth.current = sidebarWidth
      let latestWidth = sidebarWidth

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return
        const delta = ev.clientX - startX.current
        latestWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta))
        // Mutate the element directly during the drag — committing to the
        // store per mousemove re-renders the entire app tree per pixel.
        if (sidebarRef.current) sidebarRef.current.style.width = `${latestWidth}px`
      }

      const handleMouseUp = () => {
        dragging.current = false
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setSidebarWidth(latestWidth)
        void api.getConfig().then((cfg) => {
          if (cfg) return api.saveConfig({ ...cfg, sidebar_width: latestWidth })
        })
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [sidebarWidth, setSidebarWidth]
  )
```

- [ ] **Step 2: Load the persisted width at startup**

`AppShell` already loads config in a mount effect (search `api.getConfig().then(async (config) => {` — the one that applies the theme and decides `appState`). Add, right after the theme lines inside that callback:

```typescript
      if (typeof config?.sidebar_width === 'number') {
        setSidebarWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, config.sidebar_width)))
      }
```

(If the effect's dependency array doesn't include `setSidebarWidth`, leave it — zustand actions are referentially stable.)

Also add `sidebar_width?: number` to the renderer's `AppConfig` type in `src/renderer/lib/vikunja-types.ts` if not already present (review found it at line ~182, so it should exist).

- [ ] **Step 3: Typecheck + verify + commit**

Run: `npx tsc --noEmit -p tsconfig.web.json` — no errors.
Manual: drag the divider (smooth, no lag on big lists), release, restart the app — width must be restored.

```bash
git add src/renderer/components/layout/AppShell.tsx src/renderer/lib/vikunja-types.ts
git commit -m "perf: commit sidebar width on mouseup and persist it across launches"
```

---

## Phase E — Polish

### Task 19: Define the missing `--bg-tertiary` CSS variable

`--bg-tertiary` is referenced six times (`src/renderer/views/SetupView.tsx:18`, `src/renderer/components/settings/QuickEntrySettings.tsx` ×5) but defined nowhere — those backgrounds render transparent in both themes.

**Files:**
- Modify: `src/renderer/assets/index.css`

- [ ] **Step 1: Add the variable to both theme blocks**

The palette is Apple-system-style. In the `:root` block (light), after `--bg-secondary: #F5F5F7;` add:

```css
  --bg-tertiary: #E8E8ED;
```

In the `.dark` block, after `--bg-secondary: #2C2C2E;` add:

```css
  --bg-tertiary: #3A3A3C;
```

- [ ] **Step 2: Verify + commit**

Manual: open Settings → Quick Entry (the hotkey `<code>` chips must have a visible grey background in light and dark), and the Setup view's segmented buttons.

```bash
git add src/renderer/assets/index.css
git commit -m "fix: define --bg-tertiary in light and dark themes"
```

### Task 20: Use platform.ts constants everywhere in main

Raw `process.platform` checks exist in `src/main/focus.ts:43` and `src/main/obsidian-client.ts:173, 272–291`; CLAUDE.md mandates `isMac`/`isWindows`/`isLinux` from `src/main/platform.ts`. (The three preload files also read `process.platform`, but preloads can't import main-process modules — leave them.)

**Files:**
- Modify: `src/main/focus.ts`
- Modify: `src/main/obsidian-client.ts`

- [ ] **Step 1: focus.ts**

Add `import { isWindows } from './platform'` and change `if (process.platform !== 'win32') return` to `if (!isWindows) return`.

- [ ] **Step 2: obsidian-client.ts**

Add `import { isWindows, isMac } from './platform'` and replace:
- `if (process.platform !== 'win32') return false` → `if (!isWindows) return false` (in `loadForegroundCheck`)
- In `getForegroundProcessName`: `if (process.platform === 'win32')` → `if (isWindows)` and `if (process.platform === 'darwin')` → `if (isMac)`
- In `isObsidianForeground`: same two replacements.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.node.json` — no errors.

```bash
git add src/main/focus.ts src/main/obsidian-client.ts
git commit -m "refactor: use platform.ts constants instead of raw process.platform in main"
```

### Task 21: Upload standalone tasks when connecting to a server

The handlers `qe:get-standalone-task-count` and `qe:upload-standalone-tasks` exist in `src/main/ipc-handlers.ts` but no preload exposes them — tasks created in standalone mode are stranded when the user connects to a server (SetupView clears `standalone_mode` on save).

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/lib/api.ts`
- Modify: `src/renderer/views/SetupView.tsx`

- [ ] **Step 1: Expose the channels in the main preload**

In `src/preload/index.ts`, after the "Quick Entry settings" group, add:

```typescript
  // Standalone mode
  getStandaloneTaskCount: () =>
    ipcRenderer.invoke('qe:get-standalone-task-count') as Promise<number>,
  uploadStandaloneTasks: (projectId: number) =>
    ipcRenderer.invoke('qe:upload-standalone-tasks', projectId) as Promise<
      { success: boolean; uploaded: number; error?: string; totalErrors?: number }
    >,
```

- [ ] **Step 2: Wrap in the renderer API layer**

In `src/renderer/lib/api.ts`, add to the `api` object (near `applyQuickEntrySettings`):

```typescript
  getStandaloneTaskCount: () =>
    window.api.getStandaloneTaskCount() as Promise<number>,

  uploadStandaloneTasks: (projectId: number) =>
    window.api.uploadStandaloneTasks(projectId) as Promise<
      { success: boolean; uploaded: number; error?: string; totalErrors?: number }
    >,
```

If the renderer has a `window.api` ambient type declaration (`src/preload/index.d.ts`), add the two method signatures there too:

```typescript
  getStandaloneTaskCount(): Promise<number>
  uploadStandaloneTasks(projectId: number): Promise<{ success: boolean; uploaded: number; error?: string; totalErrors?: number }>
```

- [ ] **Step 3: Upload on setup completion**

In `src/renderer/views/SetupView.tsx`, `handleSave` saves the merged config and calls `onComplete()`. Insert the upload between `await api.saveConfig({...})` and `setSaving(false)`:

```typescript
    // If the user is coming from standalone mode, push their local tasks to
    // the freshly chosen inbox so nothing is stranded in offline-cache.json.
    try {
      const standaloneCount = await api.getStandaloneTaskCount()
      if (standaloneCount > 0 && inboxProjectId) {
        await api.uploadStandaloneTasks(inboxProjectId)
      }
    } catch {
      // Best effort — tasks stay in the local store and upload can be retried
      // by re-running setup.
    }
```

- [ ] **Step 4: Typecheck + verify + commit**

Run: `npx tsc --noEmit -p tsconfig.web.json` and `npx tsc --noEmit -p tsconfig.node.json` — no errors.
Manual: enable standalone mode (Setup), create two tasks via Quick Entry, re-run setup against a real server, pick an inbox — both tasks must appear in that project and the local store must be empty (`qe:get-standalone-task-count` → 0; the handler clears the store only when *all* uploads succeed).

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts src/renderer/lib/api.ts src/renderer/views/SetupView.tsx
git commit -m "feat: upload standalone tasks to the chosen inbox when connecting a server"
```

---

## Final verification

- [ ] Run the full suite: `npm test` — all green.
- [ ] Typecheck both projects: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json` — no errors.
- [ ] Full build: `npm run build` — succeeds.
- [ ] Smoke test in `npm run dev`: create/edit/complete/drag tasks, open Quick Entry + Quick View via hotkeys, print a view (Ctrl+P), toggle theme.

## Explicitly out of scope (decided, not forgotten)

- **`quick_view_enabled !== false` vs `=== true` normalization mismatch** — after `normalizeConfig` the value is always a concrete boolean, so the four `!== false` checks in `src/main/index.ts` are behaviorally identical to `=== true`. Cosmetic only; changing the default would surprise existing users.
- **`include_done` in Quick View custom lists** — the viewer is an open-tasks popup by design (Task 5 documents this).
- **Drag-hover 50ms polling while a popup is visible** (`src/main/index.ts`, `startDragHoverPolling`) — measured as acceptable; an event-driven alternative isn't worth the platform-specific complexity.
- **Preload `process.platform` reads** — preloads cannot import `src/main/platform.ts`; the raw reads there are correct.
