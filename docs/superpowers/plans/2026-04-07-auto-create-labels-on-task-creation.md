# Auto-Create Labels on Task Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user types a label shorthand (e.g. `@newlabel`) that doesn't match any existing label, automatically create the label on the server and attach it to the task — instead of silently dropping it.

**Architecture:** The fix adds an `else` branch in both task creation flows (main window + quick entry). When a parsed label name has no match in existing labels, we call `createLabel({ title })` first, then `addLabelToTask(taskId, newLabelId)`. Quick Entry needs the `createLabel` IPC method exposed in its preload bridge.

**Tech Stack:** Electron IPC (preload bridge), React + TanStack Query mutations, Vikunja REST API

---

## File Structure

| File | Change | Responsibility |
|------|--------|---------------|
| `src/preload/quick-entry.ts` | Modify | Add `createLabel` to the quick-entry preload bridge |
| `src/renderer/quick-entry/renderer.ts` | Modify (lines 1-23 type decl + lines 480-494 submit) | Update type declaration, add create-then-attach logic |
| `src/renderer/components/task-list/TaskList.tsx` | Modify (lines 59-64 hooks + lines 180-192 submit) | Add `useCreateLabel` hook, add create-then-attach logic |

---

### Task 1: Expose `createLabel` in Quick Entry Preload

The quick-entry window can call `addLabelToTask` but not `createLabel`. The IPC handler `create-label` already exists in `src/main/ipc-handlers.ts:136`. We just need to wire it through the preload.

**Files:**
- Modify: `src/preload/quick-entry.ts:12` (add new method after `addLabelToTask`)
- Modify: `src/renderer/quick-entry/renderer.ts:1-23` (update `Window.quickEntryApi` type declaration)

- [ ] **Step 1: Add `createLabel` to the quick-entry preload bridge**

In `src/preload/quick-entry.ts`, add after line 12 (`addLabelToTask`):

```typescript
  createLabel: (label: { title: string; hex_color?: string }) => ipcRenderer.invoke('create-label', label),
```

- [ ] **Step 2: Update the `quickEntryApi` type declaration in `renderer.ts`**

In `src/renderer/quick-entry/renderer.ts`, inside the `Window.quickEntryApi` interface (after `addLabelToTask` on line 11), add:

```typescript
      createLabel(label: { title: string; hex_color?: string }): Promise<{ success: boolean; data?: { id: number; title: string } }>
```

- [ ] **Step 3: Verify the app starts without errors**

Run: `npm run dev`
Expected: App launches, quick-entry window opens on hotkey without console errors.

- [ ] **Step 4: Commit**

```bash
git add src/preload/quick-entry.ts src/renderer/quick-entry/renderer.ts
git commit -m "feat: expose createLabel IPC in quick-entry preload"
```

---

### Task 2: Auto-create missing labels in TaskList (main window)

Currently `src/renderer/components/task-list/TaskList.tsx:184-191` only attaches labels that already exist. We add an `else` branch that creates the label first, then attaches it.

**Files:**
- Modify: `src/renderer/components/task-list/TaskList.tsx:59-64` (add hook import)
- Modify: `src/renderer/components/task-list/TaskList.tsx:180-192` (add create-then-attach logic)

- [ ] **Step 1: Add `useCreateLabel` hook**

In `src/renderer/components/task-list/TaskList.tsx`, after `const addLabel = useAddLabel()` (line 64), add:

```typescript
  const createLabel = useCreateLabel()
```

Also add `useCreateLabel` to the import from `@/hooks/use-task-mutations` (near top of file).

- [ ] **Step 2: Replace the label-attach loop with create-then-attach logic**

Replace the label loop in `onSuccess` (lines 184-191):

```typescript
              const match = allLabels?.find(
                (l) => l.title.toLowerCase() === labelName.toLowerCase()
              )
              if (match) {
                addLabel.mutate({ taskId, labelId: match.id })
              }
```

With:

```typescript
              const match = allLabels?.find(
                (l) => l.title.toLowerCase() === labelName.toLowerCase()
              )
              if (match) {
                addLabel.mutate({ taskId, labelId: match.id })
              } else {
                createLabel.mutate(
                  { title: labelName },
                  {
                    onSuccess: (newLabel) => {
                      if (newLabel?.id) {
                        addLabel.mutate({ taskId, labelId: newLabel.id })
                      }
                    },
                  }
                )
              }
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev`
1. In the main window task input, type `Buy groceries @shopping` where "shopping" does NOT exist as a label.
2. Press Enter.
3. Expected: Task is created. "shopping" label appears in the sidebar under Tags. The task has the "shopping" label attached.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/task-list/TaskList.tsx
git commit -m "feat: auto-create missing labels during task creation in main window"
```

---

### Task 3: Auto-create missing labels in Quick Entry

Same pattern as Task 2 but in the vanilla-JS quick-entry renderer. Since this file uses `async/await` (not React hooks), we call the preload API directly.

**Files:**
- Modify: `src/renderer/quick-entry/renderer.ts:480-494` (add create-then-attach logic)

- [ ] **Step 1: Replace the label-attach loop with create-then-attach logic**

Replace the label loop (lines 484-492):

```typescript
      for (const labelName of parsedLabels) {
        const match = cachedLabels.find((l) => l.title.toLowerCase() === labelName.toLowerCase())
        if (match) {
          try {
            await window.quickEntryApi.addLabelToTask(taskId, match.id)
          } catch {
            // Skip silently
          }
        }
      }
```

With:

```typescript
      for (const labelName of parsedLabels) {
        const match = cachedLabels.find((l) => l.title.toLowerCase() === labelName.toLowerCase())
        if (match) {
          try {
            await window.quickEntryApi.addLabelToTask(taskId, match.id)
          } catch {
            // Skip silently
          }
        } else {
          try {
            const created = await window.quickEntryApi.createLabel({ title: labelName })
            if (created.success && created.data?.id) {
              await window.quickEntryApi.addLabelToTask(taskId, created.data.id)
            }
          } catch {
            // Skip silently — label creation failed (e.g. offline)
          }
        }
      }
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`
1. Open Quick Entry (global hotkey).
2. Type `Buy milk @groceries` where "groceries" does NOT exist.
3. Press Enter.
4. Expected: Task is created. "groceries" label is created and attached. Verify in main window.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/quick-entry/renderer.ts
git commit -m "feat: auto-create missing labels during task creation in quick entry"
```

---

### Task 4: Test edge cases

No new code — just manual verification of edge cases to confirm nothing regresses.

- [ ] **Step 1: Existing label still matches (no duplicate created)**

Type `Buy milk @existinglabel` where "existinglabel" already exists.
Expected: Label is attached, no duplicate label is created.

- [ ] **Step 2: Case-insensitive matching still works**

If label "Shopping" exists, type `task @shopping` (lowercase).
Expected: Existing "Shopping" label is attached, not a new "shopping" created.

- [ ] **Step 3: Multiple labels, mix of existing and new**

Type `task @existing @brandnew`
Expected: "existing" is attached by ID, "brandnew" is created then attached.

- [ ] **Step 4: Label with spaces (quoted syntax)**

Type `task @"new multi word"` (Todoist mode).
Expected: Label "new multi word" is created and attached.
