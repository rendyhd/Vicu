# Task Info Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "info" button to the task row action bar that opens a popover showing task metadata (identifier, created/updated timestamps, creator, completion time).

**Architecture:** New `InfoPopover.tsx` component following the existing popover pattern (click-outside close, absolute positioning, no external popover library). Button becomes the leftmost item in the existing action bar in `TaskRow.tsx`. A new `formatAbsoluteDateTime` helper is added to `date-utils.ts` for consistent timestamp formatting.

**Tech Stack:** React 18, TypeScript 5, Tailwind CSS 3, lucide-react icons, vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-04-15-task-info-popover-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/renderer/lib/__tests__/date-utils.test.ts` | Create | Unit tests for `formatAbsoluteDateTime` |
| `src/renderer/lib/date-utils.ts` | Modify | Add `formatAbsoluteDateTime` helper |
| `src/renderer/lib/vikunja-types.ts` | Modify | Extend `Task.created_by` with optional `name` |
| `src/renderer/components/task-list/InfoPopover.tsx` | Create | Read-only popover rendering task metadata |
| `src/renderer/components/task-list/TaskRow.tsx` | Modify | Wire up Info button + popover render + type union |

---

## Task 1: Add `formatAbsoluteDateTime` helper with tests

**Files:**
- Create: `src/renderer/lib/__tests__/date-utils.test.ts`
- Modify: `src/renderer/lib/date-utils.ts`

### Step 1: Write the failing test

- [ ] Create `src/renderer/lib/__tests__/date-utils.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { formatAbsoluteDateTime } from '../date-utils'

describe('formatAbsoluteDateTime', () => {
  it('returns empty string for the Vikunja null date', () => {
    expect(formatAbsoluteDateTime('0001-01-01T00:00:00Z')).toBe('')
  })

  it('returns empty string for an empty string', () => {
    expect(formatAbsoluteDateTime('')).toBe('')
  })

  it('formats a local-time ISO string as "MMM d, yyyy at h:mm a"', () => {
    expect(formatAbsoluteDateTime('2026-04-13T15:42:00')).toBe('Apr 13, 2026 at 3:42 PM')
  })

  it('pads minutes with a leading zero', () => {
    expect(formatAbsoluteDateTime('2026-04-13T15:05:00')).toBe('Apr 13, 2026 at 3:05 PM')
  })

  it('renders midnight as 12:00 AM', () => {
    expect(formatAbsoluteDateTime('2026-04-13T00:00:00')).toBe('Apr 13, 2026 at 12:00 AM')
  })

  it('renders noon as 12:00 PM', () => {
    expect(formatAbsoluteDateTime('2026-04-13T12:00:00')).toBe('Apr 13, 2026 at 12:00 PM')
  })
})
```

### Step 2: Run tests to verify they fail

- [ ] Run: `npm test -- date-utils`
- [ ] Expected: All 6 tests fail. Error message includes "formatAbsoluteDateTime is not a function" or similar import error.

### Step 3: Implement `formatAbsoluteDateTime`

- [ ] Add to `src/renderer/lib/date-utils.ts` (append at the end of the file, after `parseNaturalDate`):

```ts
export function formatAbsoluteDateTime(date: string): string {
  if (isNullDate(date)) return ''
  const d = new Date(date)
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `${datePart} at ${timePart}`
}
```

### Step 4: Run tests to verify they pass

- [ ] Run: `npm test -- date-utils`
- [ ] Expected: All 6 tests pass.

### Step 5: Commit

- [ ] Run:

```bash
git add src/renderer/lib/date-utils.ts src/renderer/lib/__tests__/date-utils.test.ts
git commit -m "feat: add formatAbsoluteDateTime helper"
```

---

## Task 2: Extend `Task.created_by` type with optional `name`

**Files:**
- Modify: `src/renderer/lib/vikunja-types.ts:40`

### Step 1: Edit the type

- [ ] In `src/renderer/lib/vikunja-types.ts`, change line 40 from:

```ts
  created_by: { id: number; username: string }
```

to:

```ts
  created_by: { id: number; username: string; name?: string }
```

### Step 2: Typecheck

- [ ] Run: `npx tsc --noEmit -p tsconfig.web.json`
- [ ] Expected: Exits with code 0 (no errors). The `name?` field is optional, so no existing call sites need updating.

### Step 3: Commit

- [ ] Run:

```bash
git add src/renderer/lib/vikunja-types.ts
git commit -m "feat: add optional name to Task.created_by type"
```

---

## Task 3: Create `InfoPopover` component

**Files:**
- Create: `src/renderer/components/task-list/InfoPopover.tsx`

### Step 1: Write the component

- [ ] Create `src/renderer/components/task-list/InfoPopover.tsx` with:

```tsx
import { useRef, useEffect } from 'react'
import type { Task } from '@/lib/vikunja-types'
import { formatAbsoluteDateTime, isNullDate } from '@/lib/date-utils'

interface InfoPopoverProps {
  task: Task
  onClose: () => void
}

export function InfoPopover({ task, onClose }: InfoPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const identifier = task.identifier && task.identifier.length > 0 ? task.identifier : '—'
  const created = formatAbsoluteDateTime(task.created) || '—'
  const updated = formatAbsoluteDateTime(task.updated) || '—'

  const creatorName =
    task.created_by && (task.created_by.name?.trim() || task.created_by.username)
  const showCreator = !!creatorName

  const showCompleted = task.done && !isNullDate(task.done_at)
  const completed = showCompleted ? formatAbsoluteDateTime(task.done_at) : ''

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-lg"
    >
      <div className="flex flex-col gap-2">
        <Row label="Identifier" value={identifier} />
        <Row label="Created" value={created} />
        <Row label="Updated" value={updated} />
        {showCreator && <Row label="Created by" value={creatorName!} />}
        {showCompleted && <Row label="Completed" value={completed} />}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span className="text-right text-xs text-[var(--text-primary)]">{value}</span>
    </div>
  )
}
```

### Step 2: Typecheck

- [ ] Run: `npx tsc --noEmit -p tsconfig.web.json`
- [ ] Expected: Exits with code 0 (no errors).

### Step 3: Commit

- [ ] Run:

```bash
git add src/renderer/components/task-list/InfoPopover.tsx
git commit -m "feat: add InfoPopover component"
```

---

## Task 4: Wire up Info button in `TaskRow`

**Files:**
- Modify: `src/renderer/components/task-list/TaskRow.tsx`

### Step 1: Add `Info` to lucide-react imports

- [ ] In `src/renderer/components/task-list/TaskRow.tsx`, change line 2 from:

```ts
import { Calendar, Tag, ListChecks, FolderOpen, Trash2, Bell, Repeat, Paperclip } from 'lucide-react'
```

to:

```ts
import { Calendar, Tag, ListChecks, FolderOpen, Trash2, Bell, Repeat, Paperclip, Info } from 'lucide-react'
```

### Step 2: Add `InfoPopover` import

- [ ] After the existing `AttachmentPickerPopover` import (line 23), add:

```ts
import { InfoPopover } from './InfoPopover'
```

### Step 3: Extend `PopoverType` union

- [ ] Change line 28 from:

```ts
type PopoverType = 'date' | 'label' | 'project' | 'subtasks' | 'reminder' | 'attachment' | null
```

to:

```ts
type PopoverType = 'date' | 'label' | 'project' | 'subtasks' | 'reminder' | 'attachment' | 'info' | null
```

### Step 4: Insert Info button as the first child of the action buttons div

- [ ] In `TaskRow.tsx`, find the action buttons container at line 467: `<div className="relative flex items-center gap-1">`.
- [ ] Immediately after that opening `<div>` tag (before the existing Calendar `<button>` at line 468), insert:

```tsx
          <button
            type="button"
            onClick={() => togglePopover('info')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors',
              activePopover === 'info'
                ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            )}
            title="Task info"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
```

### Step 5: Render the popover

- [ ] Find the popover block that begins `{/* Popovers */}` (around line 561) and currently contains conditional renders for `'date'`, `'label'`, `'project'`, `'reminder'`, and `'attachment'`.
- [ ] Immediately after the `{/* Popovers */}` comment line (before the `{activePopover === 'date' && ...}` block), insert:

```tsx
          {activePopover === 'info' && (
            <InfoPopover
              task={task}
              onClose={() => setActivePopover(null)}
            />
          )}
```

### Step 6: Typecheck

- [ ] Run: `npx tsc --noEmit -p tsconfig.web.json`
- [ ] Expected: Exits with code 0 (no errors).

### Step 7: Manual verification in dev mode

- [ ] Run: `npm run dev`
- [ ] Expected: The Vicu app window opens.
- [ ] In the app, expand any task row by clicking on it.
- [ ] Verify: An Info icon (circled "i") appears as the leftmost button in the action bar (left of the Calendar icon).
- [ ] Click the Info button.
- [ ] Verify: A popover opens to the right-hand side of the action bar showing:
  - `Identifier` row (a task ID like `#123`, or `—` if empty)
  - `Created` row (a formatted timestamp like `Apr 13, 2026 at 3:42 PM`)
  - `Updated` row (a formatted timestamp)
  - `Created by` row (if the task has a creator)
  - NO `Completed` row (since this is an open task)
- [ ] Click outside the popover.
- [ ] Verify: The popover closes.
- [ ] Click the Info button again.
- [ ] Verify: The popover re-opens.
- [ ] Click the Info button while the popover is open.
- [ ] Verify: The popover closes (toggle behavior).
- [ ] Mark a task as done via the checkbox, then expand it and open the Info popover.
- [ ] Verify: A `Completed` row now appears with a timestamp.
- [ ] Close the dev server (Ctrl+C in the terminal).

### Step 8: Commit

- [ ] Run:

```bash
git add src/renderer/components/task-list/TaskRow.tsx
git commit -m "feat: add task info button and popover to task row"
```

---

## Self-Review

**Spec coverage check** (mapping spec sections to tasks):

| Spec section | Task |
|---|---|
| Fields Shown (5 rows, conditional logic) | Task 3 |
| Absolute timestamp format | Task 1 |
| `Task.created_by.name` optional | Task 2 |
| `formatAbsoluteDateTime` in `date-utils.ts` | Task 1 |
| `InfoPopover` component file + behavior | Task 3 |
| TaskRow: import `Info`, import `InfoPopover` | Task 4 steps 1-2 |
| TaskRow: extend `PopoverType` | Task 4 step 3 |
| TaskRow: insert button as first child | Task 4 step 4 |
| TaskRow: render popover | Task 4 step 5 |
| Edge case: empty identifier → `—` | Task 3 (in component logic) |
| Edge case: missing `created_by` → row omitted | Task 3 (in component logic) |
| Edge case: `done_at` only when done | Task 3 (in component logic) |
| Scope exclusions: no avatar, no assignees, no comments | Not implemented (by design) |

No gaps identified. All code steps contain the actual code to write. Type names and method signatures are consistent across tasks (`formatAbsoluteDateTime`, `InfoPopover`, `PopoverType`).
