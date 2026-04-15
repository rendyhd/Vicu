# Task Info Popover

## Overview

Add a read-only "info" button to the task row action bar that opens a small popover displaying task metadata not otherwise visible in the UI: identifier, created/updated timestamps, creator, and completion timestamp (when applicable).

The button is placed as the **first** (leftmost) button in the action bar, directly left of the Calendar button.

## Fields Shown

| Label | Source field | Shown when |
|-------|-------------|-----------|
| Identifier | `task.identifier` | Always (shows `—` if empty) |
| Created | `task.created` | Always |
| Updated | `task.updated` | Always |
| Created by | `task.created_by.name` with fallback `task.created_by.username` | `created_by` present |
| Completed | `task.done_at` | `task.done === true` and `done_at` is not the null date |

All timestamps are rendered in **absolute** format: `MMM d, yyyy 'at' h:mm a` (e.g., `Apr 13, 2026 at 3:42 PM`), using the user's local timezone.

Layout: plain label/value rows (Option A from brainstorm). Labels are muted text, values are primary text. No icons, no actions.

## Type Changes

### `src/renderer/lib/vikunja-types.ts`

The `Task.created_by` field is currently typed as `{ id: number; username: string }`. Extend to include optional `name`:

```ts
created_by: { id: number; username: string; name?: string }
```

This matches the Vikunja API's `user.User` schema — the API always returns `name` but it may be empty string for users who haven't set a full name.

## Date Utility

### `src/renderer/lib/date-utils.ts`

Add a new helper for absolute datetime formatting (distinct from the existing `formatRelativeDate`):

```ts
export function formatAbsoluteDateTime(date: string): string {
  if (isNullDate(date)) return ''
  const d = new Date(date)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
```

This uses `toLocaleString` with explicit options for consistency across locales while still honoring the user's local timezone.

## Component: `InfoPopover`

**File:** `src/renderer/components/task-list/InfoPopover.tsx`

Matches the existing popover pattern (see `DatePickerPopover.tsx` as reference):
- Wrapped in a `div ref={ref}` for click-outside detection
- `useEffect` adds `mousedown` listener, calls `onClose` when clicking outside
- Positioning: `absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-lg`
- Slightly wider than `DatePickerPopover` (`w-64` vs `w-56`) to fit timestamp values comfortably on one line

Props:
```ts
interface InfoPopoverProps {
  task: Task
  onClose: () => void
}
```

Internal rendering:
- Two-column rows via flex, label on left (`text-xs text-[var(--text-secondary)]`), value on right (`text-xs text-[var(--text-primary)]`)
- `gap-3` between rows
- Creator row falls back to `username` if `name` is empty/missing
- Completed row conditional on `task.done && !isNullDate(task.done_at)`
- Identifier row shows `task.identifier` or `—` if empty string

No interactive elements inside the popover. No close button (click outside or click the info button again to dismiss, consistent with other popovers).

## TaskRow Changes

**File:** `src/renderer/components/task-list/TaskRow.tsx`

### Import changes (line 2)

Add `Info` to the lucide-react import:

```ts
import { Calendar, Tag, ListChecks, FolderOpen, Trash2, Bell, Repeat, Paperclip, Info } from 'lucide-react'
```

### Import new component (after line 23)

```ts
import { InfoPopover } from './InfoPopover'
```

### Popover type union (line 28)

Add `'info'`:

```ts
type PopoverType = 'date' | 'label' | 'project' | 'subtasks' | 'reminder' | 'attachment' | 'info' | null
```

### Button insertion (before line 468)

Insert a new action button as the **first** child of the action buttons div at line 467, before the existing Calendar button. Same styling pattern as siblings:

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

### Popover render (inside the popovers block around line 562-597)

Add:

```tsx
{activePopover === 'info' && (
  <InfoPopover
    task={task}
    onClose={() => setActivePopover(null)}
  />
)}
```

Placement within the popovers block doesn't matter visually (only one shows at a time), but for consistency place it first to match the button order.

## Edge Cases

- **Missing `created_by`**: Older tasks or tasks from imports may have no `created_by`. Omit the row entirely rather than show "Unknown".
- **Empty `identifier`**: Vikunja returns an empty string when the parent project has no identifier configured. Show `—` to make the empty state explicit.
- **Null timestamps**: `isNullDate` guards against Vikunja's `0001-01-01T00:00:00Z` zero-time value. If `created` or `updated` is null (shouldn't happen in practice, but defensive), show `—`.
- **`done_at` when not done**: Hide the Completed row entirely; don't show "Completed: —" for incomplete tasks.

## Scope Exclusions

- No avatar for `created_by` — plain text name only (collaborative features will get their own UI later)
- No assignees row — separate collaborative UI
- No comments, reactions, or subscription info
- No editing of any field from this popover — purely read-only
- Not added to Quick Entry or Quick View rows (they have a different, minimal UI and don't show the full action bar)
- No keyboard shortcut — button click only
