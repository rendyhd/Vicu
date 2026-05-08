# Delete Confirmation Dialog

## Overview

Add a confirmation dialog before destructive delete actions (tasks, projects, labels). Controlled by a config setting `confirm_before_delete` (default: `true`), toggled in Settings > General > Preferences.

## Config

Add to `AppConfig` in `src/main/config.ts`:

```ts
confirm_before_delete?: boolean  // default true
```

No normalization needed — `undefined` and `true` both mean "confirm enabled."

## Component: `ConfirmDialog`

**File:** `src/renderer/components/shared/ConfirmDialog.tsx`

A small modal overlay with:
- Semi-transparent backdrop (click to cancel)
- Centered card with: message text, Cancel button (neutral), Delete button (red)
- Escape key dismisses
- Auto-focuses the Cancel button (safe default)

Props:
```ts
interface ConfirmDialogProps {
  open: boolean
  message: string
  onConfirm: () => void
  onCancel: () => void
}
```

Styling follows existing patterns: `var(--bg-primary)`, `var(--border-color)`, `var(--text-primary)`, `accent-red` for the delete button.

## Hook: `useConfirmDelete`

**File:** `src/renderer/hooks/use-confirm-delete.ts`

Returns `{ confirmDelete, dialogProps }`:
- `confirmDelete(message: string): Promise<boolean>` — if setting is off, resolves `true` immediately. If on, shows the dialog and resolves based on user choice.
- `dialogProps` — spread onto `<ConfirmDialog />` in the calling component's JSX.

Internally uses `useState` to track open/message/resolve callback.

## Call Sites (6 total)

Each call site wraps its `.mutate()` with `confirmDelete()`:

### Tasks (2 sites)
1. **`TaskRow.tsx:544`** — trash button onClick
2. **`TaskList.tsx`** — keyboard handler (passes `deleteTask` in deps, but grep shows no direct key binding for delete — verify this is actually used)

### Projects (2 sites)
3. **`ProjectTree.tsx:240`** — sidebar context menu "Delete"
4. **`SectionHeader.tsx:101`** — section header menu "Delete"

### Labels (1 site)
5. **`TagList.tsx:244`** — sidebar context menu "Delete"

### Pattern per call site

Before:
```ts
deleteTask.mutate(task.id)
```

After:
```ts
const { confirmDelete, dialogProps } = useConfirmDelete()

// In handler:
const ok = await confirmDelete('Delete this task? This cannot be undone.')
if (ok) {
  deleteTask.mutate(task.id)
  collapseAll()
}

// In JSX:
<ConfirmDialog {...dialogProps} />
```

## Dialog Messages

| Item | Message |
|------|---------|
| Task | "Delete this task? This cannot be undone." |
| Project | "Delete this project? All tasks in it will be deleted. This cannot be undone." |
| Label | "Delete this label? It will be removed from all tasks. This cannot be undone." |

## Settings UI

In `SettingsView.tsx`, inside the "Preferences" section (after the Theme picker, around line 330), add a checkbox:

```tsx
<label className="flex cursor-pointer items-center gap-2">
  <input
    type="checkbox"
    checked={fullConfig?.confirm_before_delete !== false}
    onChange={(e) => handleQuickEntryChange({ confirm_before_delete: e.target.checked })}
    className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue"
  />
  <span className="text-sm text-[var(--text-primary)]">
    Confirm before deleting
  </span>
</label>
```

## Exposing Config to Renderer

The setting needs to be readable from renderer components. The existing pattern is `api.getConfig()` (async IPC call). The hook will call this once and cache the value. Since config changes trigger a debounced save + re-read pattern already in settings, and users rarely toggle this mid-session, a one-time read on hook mount is sufficient.

## Scope Exclusions

- No undo/restore functionality
- No "Recently Deleted" list
- No animation on the dialog (keep it snappy)
- Quick Entry / Quick View windows are not affected (they don't have delete actions)
