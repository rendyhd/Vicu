# Delete Confirmation Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a confirmation dialog before deleting tasks, projects, and labels, with a setting to disable it.

**Architecture:** A single `ConfirmDialog` component + a `useConfirmDelete` hook that reads config. Each delete call site awaits the hook before firing its mutation. Config field `confirm_before_delete` (default `true`) added to both main and renderer `AppConfig` interfaces.

**Tech Stack:** React, TypeScript, Tailwind CSS, existing IPC config bridge

**Note:** No test runner or linter is configured in this project. Steps that would normally be TDD are implementation-only.

---

### Task 1: Add `confirm_before_delete` to AppConfig

**Files:**
- Modify: `src/main/config.ts:21-91` (main process AppConfig interface)
- Modify: `src/renderer/lib/vikunja-types.ts:168-218` (renderer AppConfig interface)

- [ ] **Step 1: Add field to main process AppConfig**

In `src/main/config.ts`, add after the `nlp_syntax_mode` line (line 88):

```ts
  // Delete confirmation
  confirm_before_delete?: boolean
```

- [ ] **Step 2: Add field to renderer AppConfig**

In `src/renderer/lib/vikunja-types.ts`, add after the `nlp_syntax_mode` line (line 217):

```ts
  // Delete confirmation
  confirm_before_delete?: boolean
```

- [ ] **Step 3: Commit**

```bash
git add src/main/config.ts src/renderer/lib/vikunja-types.ts
git commit -m "feat: add confirm_before_delete config field"
```

---

### Task 2: Create `ConfirmDialog` component

**Files:**
- Create: `src/renderer/components/shared/ConfirmDialog.tsx`

- [ ] **Step 1: Create the component**

Create `src/renderer/components/shared/ConfirmDialog.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

interface ConfirmDialogProps {
  open: boolean
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, message, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-4 text-sm text-[var(--text-primary)]">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={cn(
              'rounded-md border border-[var(--border-color)] px-4 py-1.5 text-sm font-medium',
              'text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]'
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium',
              'bg-accent-red text-white transition-colors hover:bg-accent-red/90'
            )}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/shared/ConfirmDialog.tsx
git commit -m "feat: add ConfirmDialog component"
```

---

### Task 3: Create `useConfirmDelete` hook

**Files:**
- Create: `src/renderer/hooks/use-confirm-delete.ts`

- [ ] **Step 1: Create the hook**

Create `src/renderer/hooks/use-confirm-delete.ts`:

```ts
import { useState, useCallback, useEffect, useRef } from 'react'
import { api } from '@/lib/api'

export function useConfirmDelete() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const resolveRef = useRef<((value: boolean) => void) | null>(null)
  const confirmEnabled = useRef(true)

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config) {
        confirmEnabled.current = config.confirm_before_delete !== false
      }
    })
  }, [])

  const confirmDelete = useCallback((msg: string): Promise<boolean> => {
    if (!confirmEnabled.current) return Promise.resolve(true)
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setMessage(msg)
      setOpen(true)
    })
  }, [])

  const onConfirm = useCallback(() => {
    setOpen(false)
    resolveRef.current?.(true)
    resolveRef.current = null
  }, [])

  const onCancel = useCallback(() => {
    setOpen(false)
    resolveRef.current?.(false)
    resolveRef.current = null
  }, [])

  return {
    confirmDelete,
    dialogProps: { open, message, onConfirm, onCancel },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/hooks/use-confirm-delete.ts
git commit -m "feat: add useConfirmDelete hook"
```

---

### Task 4: Wire up confirmation in TaskRow

**Files:**
- Modify: `src/renderer/components/task-list/TaskRow.tsx:542-552` (delete button)

- [ ] **Step 1: Add imports**

In `src/renderer/components/task-list/TaskRow.tsx`, add to the imports at the top:

```ts
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
```

- [ ] **Step 2: Add hook call inside TaskRow component**

Inside the `TaskRow` component function (after line 102 where `deleteTask` is declared), add:

```ts
  const { confirmDelete, dialogProps } = useConfirmDelete()
```

- [ ] **Step 3: Wrap the delete button onClick**

Replace the delete button onClick (lines 544-547):

```ts
            onClick={() => {
              deleteTask.mutate(task.id)
              collapseAll()
            }}
```

With:

```ts
            onClick={async () => {
              const ok = await confirmDelete('Delete this task? This cannot be undone.')
              if (ok) {
                deleteTask.mutate(task.id)
                collapseAll()
              }
            }}
```

- [ ] **Step 4: Add ConfirmDialog to JSX**

Add `<ConfirmDialog {...dialogProps} />` at the end of the component's return, just before the closing fragment or wrapper div. Find the last closing tag of the component's JSX and add it right before. It renders via a portal-like fixed position, so exact placement in the tree doesn't matter as long as it's inside the component's return.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/task-list/TaskRow.tsx
git commit -m "feat: add delete confirmation to TaskRow"
```

---

### Task 5: Wire up confirmation in ProjectTree

**Files:**
- Modify: `src/renderer/components/sidebar/ProjectTree.tsx:237-247` (context menu delete button)

- [ ] **Step 1: Add imports**

In `src/renderer/components/sidebar/ProjectTree.tsx`, add to the imports:

```ts
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
```

- [ ] **Step 2: Find the component that renders the context menu**

The context menu with the delete button is rendered in the main `ProjectTree` export (not the `ProjectDialog` inner component). Add the hook call inside that component:

```ts
  const { confirmDelete, dialogProps: deleteDialogProps } = useConfirmDelete()
```

- [ ] **Step 3: Wrap the delete button onClick**

Replace the context menu delete onClick (line 239-241):

```ts
            onClick={() => {
              deleteProject.mutate(contextMenu.project.id)
              setContextMenu(null)
            }}
```

With:

```ts
            onClick={async () => {
              const project = contextMenu.project
              setContextMenu(null)
              const ok = await confirmDelete('Delete this project? All tasks in it will be deleted. This cannot be undone.')
              if (ok) {
                deleteProject.mutate(project.id)
              }
            }}
```

Note: We capture `contextMenu.project` before calling `setContextMenu(null)` because the context menu closes immediately but we need the project reference for the mutation.

- [ ] **Step 4: Add ConfirmDialog to JSX**

Add `<ConfirmDialog {...deleteDialogProps} />` at the end of the component's return JSX.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/sidebar/ProjectTree.tsx
git commit -m "feat: add delete confirmation to ProjectTree"
```

---

### Task 6: Wire up confirmation in SectionHeader

**Files:**
- Modify: `src/renderer/components/task-list/SectionHeader.tsx:99-102` (handleDelete function)

- [ ] **Step 1: Add imports**

In `src/renderer/components/task-list/SectionHeader.tsx`, add to the imports:

```ts
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
```

- [ ] **Step 2: Add hook call inside component**

Inside the `SectionHeader` component, add:

```ts
  const { confirmDelete, dialogProps: deleteDialogProps } = useConfirmDelete()
```

- [ ] **Step 3: Replace handleDelete function**

Replace the `handleDelete` function (lines 99-102):

```ts
  const handleDelete = () => {
    setShowMenu(false)
    deleteProject.mutate(project.id)
  }
```

With:

```ts
  const handleDelete = async () => {
    setShowMenu(false)
    const ok = await confirmDelete('Delete this project? All tasks in it will be deleted. This cannot be undone.')
    if (ok) {
      deleteProject.mutate(project.id)
    }
  }
```

- [ ] **Step 4: Add ConfirmDialog to JSX**

Add `<ConfirmDialog {...deleteDialogProps} />` at the end of the component's return JSX.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/task-list/SectionHeader.tsx
git commit -m "feat: add delete confirmation to SectionHeader"
```

---

### Task 7: Wire up confirmation in TagList

**Files:**
- Modify: `src/renderer/components/sidebar/TagList.tsx:241-246` (context menu delete button)

- [ ] **Step 1: Add imports**

In `src/renderer/components/sidebar/TagList.tsx`, add to the imports:

```ts
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
```

- [ ] **Step 2: Find the component that renders the context menu and add hook**

Add inside the component that renders the tag context menu:

```ts
  const { confirmDelete, dialogProps: deleteDialogProps } = useConfirmDelete()
```

- [ ] **Step 3: Wrap the delete button onClick**

Replace the context menu delete onClick (lines 243-245):

```ts
            onClick={() => {
              deleteLabel.mutate(contextMenu.label.id)
              setContextMenu(null)
            }}
```

With:

```ts
            onClick={async () => {
              const label = contextMenu.label
              setContextMenu(null)
              const ok = await confirmDelete('Delete this label? It will be removed from all tasks. This cannot be undone.')
              if (ok) {
                deleteLabel.mutate(label.id)
              }
            }}
```

- [ ] **Step 4: Add ConfirmDialog to JSX**

Add `<ConfirmDialog {...deleteDialogProps} />` at the end of the component's return JSX.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/sidebar/TagList.tsx
git commit -m "feat: add delete confirmation to TagList"
```

---

### Task 8: Add settings toggle

**Files:**
- Modify: `src/renderer/views/SettingsView.tsx:277-332` (Preferences section in General tab)

- [ ] **Step 1: Add the checkbox**

In `src/renderer/views/SettingsView.tsx`, inside the Preferences section's `<div className="space-y-3">` block, after the "Launch on startup" checkbox (after line 289), add:

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

This follows the exact same pattern as the "Launch on startup" checkbox above it. The `!== false` check means `undefined` (fresh installs) and `true` both show as checked — matching the default-on behavior.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/views/SettingsView.tsx
git commit -m "feat: add confirm-before-delete toggle in settings"
```

---

### Task 9: Manual verification

- [ ] **Step 1: Run dev mode**

```bash
npm run dev
```

- [ ] **Step 2: Test task deletion**

1. Expand a task and click the trash icon — confirmation dialog should appear
2. Click Cancel — task should remain
3. Click Delete — task should be deleted
4. Press Escape on the dialog — should dismiss

- [ ] **Step 3: Test project deletion**

1. Right-click a project in the sidebar — click Delete — confirmation dialog should appear
2. Cancel and confirm both work correctly

- [ ] **Step 4: Test label deletion**

1. Right-click a label in the sidebar — click Delete — confirmation dialog should appear

- [ ] **Step 5: Test the setting**

1. Go to Settings > General > Preferences
2. Uncheck "Confirm before deleting"
3. Delete a task — should delete immediately with no dialog
4. Re-check the setting — dialog should reappear

- [ ] **Step 6: Final commit (squash or leave as-is)**

All task commits are already made. If desired, squash into a single feature commit.
