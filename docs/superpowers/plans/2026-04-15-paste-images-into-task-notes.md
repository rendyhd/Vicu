# Paste Images into Task Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to paste images (from clipboard) directly into the task description field. Images upload as Vikunja task attachments and render inline as thumbnails when the description is displayed in preview mode.

**Architecture:** Description text gets inline tokens — `[[image:<attachmentId>]]` for uploaded images, `[[image-pending:<uuid>]]` for images staged during new-task creation. Tokens persist in the Vikunja description string alongside the note-link HTML already stored there. A new `TaskDescription` component replaces the raw textarea inside the expanded row and the new-task form: it renders tokens as `<img>` thumbnails in "preview" mode and as literal text in "edit" mode (auto-switches on focus/blur). Image bytes are fetched through a new main-process IPC handler and served to `<img>` elements via blob URLs.

**Tech Stack:** React, TanStack Query, Electron IPC, existing Vikunja attachment API (`PUT /api/v1/tasks/{id}/attachments` already wired).

**Note:** No test runner or linter is configured in this project. Steps that would normally be TDD are implementation-only with manual verification in the running dev app.

**Out of scope:** Quick Entry window paste (vanilla JS in a separate renderer — follow-up). Drag-dropping an image onto the description area already works via the existing `useUploadAttachmentFromDrop` flow; this plan does not touch it.

---

## File Structure

**Create:**
- `src/renderer/lib/image-tokens.ts` — pure helpers to parse, insert, and rewrite image/pending tokens in description text.
- `src/renderer/hooks/use-attachment-bytes.ts` — TanStack Query hook that fetches attachment bytes and exposes a blob URL with cleanup.
- `src/renderer/components/task-list/TaskDescription.tsx` — edit/preview description component with paste handling.

**Modify:**
- `src/main/api-client.ts` — export attachments list fetcher (already exists as `fetchTaskAttachments`, check).
- `src/main/ipc-handlers.ts` — add `fetch-task-attachment-bytes` handler returning `Uint8Array`.
- `src/preload/index.ts` — expose `fetchTaskAttachmentBytes`.
- `src/renderer/lib/api.ts` — add typed wrapper.
- `src/renderer/hooks/use-task-mutations.ts` — add `useUploadAttachmentFromPaste` that uploads bytes and resolves the new attachment ID by diffing the attachments list.
- `src/renderer/components/task-list/TaskRow.tsx` — replace the `<textarea>` at lines 409–432 with `<TaskDescription mode="existing" taskId={task.id} …>`.
- `src/renderer/components/task-list/TaskList.tsx` — replace the `<textarea>` for `newDescription` with `<TaskDescription mode="pending" …>`; on `createTask.onSuccess`, upload staged blobs and patch description.

---

### Task 1: Image token utilities

**Files:**
- Create: `src/renderer/lib/image-tokens.ts`

- [ ] **Step 1: Create the token helpers file**

Write `src/renderer/lib/image-tokens.ts`:

```ts
export type ImageToken =
  | { kind: 'image'; attachmentId: number; raw: string }
  | { kind: 'pending'; uuid: string; raw: string }

const IMAGE_RE = /\[\[image:(\d+)\]\]/g
const PENDING_RE = /\[\[image-pending:([a-z0-9-]+)\]\]/g

/** Find all image/pending tokens in a description string, in order of appearance. */
export function findImageTokens(text: string): ImageToken[] {
  const tokens: ImageToken[] = []
  for (const m of text.matchAll(IMAGE_RE)) {
    tokens.push({ kind: 'image', attachmentId: Number(m[1]), raw: m[0] })
  }
  for (const m of text.matchAll(PENDING_RE)) {
    tokens.push({ kind: 'pending', uuid: m[1], raw: m[0] })
  }
  return tokens
}

/** Split text into a sequence of plain-text and token segments for rendering. */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'image'; attachmentId: number }
  | { kind: 'pending'; uuid: string }

export function segmentDescription(text: string): Segment[] {
  const segments: Segment[] = []
  const combined = /\[\[image:(\d+)\]\]|\[\[image-pending:([a-z0-9-]+)\]\]/g
  let lastIndex = 0
  for (const m of text.matchAll(combined)) {
    const start = m.index ?? 0
    if (start > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, start) })
    }
    if (m[1] !== undefined) {
      segments.push({ kind: 'image', attachmentId: Number(m[1]) })
    } else if (m[2] !== undefined) {
      segments.push({ kind: 'pending', uuid: m[2] })
    }
    lastIndex = start + m[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ kind: 'text', text: text.slice(lastIndex) })
  }
  return segments
}

/** Insert a token at a cursor position in text. */
export function insertTokenAt(text: string, cursor: number, token: string): string {
  const before = text.slice(0, cursor)
  const after = text.slice(cursor)
  const needsLeadingNewline = before.length > 0 && !before.endsWith('\n')
  const needsTrailingNewline = after.length > 0 && !after.startsWith('\n')
  return (
    before +
    (needsLeadingNewline ? '\n' : '') +
    token +
    (needsTrailingNewline ? '\n' : '') +
    after
  )
}

/** Replace pending tokens with real image tokens based on a mapping. */
export function replacePendingTokens(text: string, mapping: Record<string, number>): string {
  return text.replace(PENDING_RE, (full, uuid) => {
    const id = mapping[uuid]
    return id == null ? full : `[[image:${id}]]`
  })
}

export function imageToken(attachmentId: number): string {
  return `[[image:${attachmentId}]]`
}

export function pendingToken(uuid: string): string {
  return `[[image-pending:${uuid}]]`
}
```

- [ ] **Step 2: Sanity-check the helpers manually**

Open a REPL-style check in a scratch editor or dev console. In `src/renderer/views/SettingsView.tsx` (temporarily) or a scratch page, import and log:

```ts
import { segmentDescription, insertTokenAt, replacePendingTokens } from '@/lib/image-tokens'
console.log(segmentDescription('a [[image:1]] b [[image-pending:abc]] c'))
console.log(insertTokenAt('hello world', 5, '[[image:9]]'))
console.log(replacePendingTokens('x [[image-pending:abc]] y', { abc: 42 }))
```

Expected output:
- First call yields 5 segments: text "a ", image 1, text " b ", pending "abc", text " c".
- Second call yields `"hello\n[[image:9]]\n world"`.
- Third call yields `"x [[image:42]] y"`.

Remove the temporary import once verified.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/lib/image-tokens.ts
git commit -m "feat: add image token helpers for task descriptions"
```

---

### Task 2: Main-process IPC for fetching attachment bytes

**Files:**
- Modify: `src/main/ipc-handlers.ts` (add handler near the existing attachment handlers at lines 552–562)

- [ ] **Step 1: Add IPC handler**

In `src/main/ipc-handlers.ts`, locate the block that registers `delete-task-attachment` (around line 560) and add a new handler immediately after it:

```ts
  ipcMain.handle('fetch-task-attachment-bytes', async (_event, taskId: number, attachmentId: number) => {
    const result = await downloadTaskAttachment(taskId, attachmentId)
    if (!result.success) return result
    return { success: true, data: new Uint8Array(result.data) }
  })
```

`downloadTaskAttachment` is already imported at line 29. `Uint8Array` serializes across the Electron context bridge correctly; `Buffer` does not.

- [ ] **Step 2: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat: add IPC handler for fetching attachment bytes"
```

---

### Task 3: Preload bridge + renderer API wrapper

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/lib/api.ts`

- [ ] **Step 1: Expose in preload**

In `src/preload/index.ts`, locate the existing `openTaskAttachment` exposed method (around line 97) and add below it:

```ts
  fetchTaskAttachmentBytes: (taskId: number, attachmentId: number) =>
    ipcRenderer.invoke('fetch-task-attachment-bytes', taskId, attachmentId),
```

Find the exact insertion point by locating the `pickAndUploadAttachment` line — add the new method in the same group.

- [ ] **Step 2: Add typed wrapper to renderer api**

In `src/renderer/lib/api.ts`, locate the `// Attachments` section (lines 151–162) and add after `openTaskAttachment`:

```ts
  fetchTaskAttachmentBytes: (taskId: number, attachmentId: number) =>
    window.api.fetchTaskAttachmentBytes(taskId, attachmentId) as Promise<ApiResult<Uint8Array>>,
```

- [ ] **Step 3: Verify the preload `window.api` type includes the new method**

The preload uses `contextBridge.exposeInMainWorld('api', { … })` — if there is a declared `window.api` type somewhere in `src/renderer/env.d.ts` or similar, add `fetchTaskAttachmentBytes` to it. Search for `fetchTaskAttachments` in `.d.ts` files:

Run: `rg "fetchTaskAttachments" --type ts` (no type file expected; this project relies on `as Promise<…>` casts).

If no declaration file adds these methods, no further change is needed — the `as Promise<…>` cast in `api.ts` is the type surface.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/lib/api.ts
git commit -m "feat: expose fetchTaskAttachmentBytes in preload and api"
```

---

### Task 4: `useAttachmentBytes` hook

**Files:**
- Create: `src/renderer/hooks/use-attachment-bytes.ts`

- [ ] **Step 1: Create the hook**

Write `src/renderer/hooks/use-attachment-bytes.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { api } from '@/lib/api'

/**
 * Fetches the bytes for a task attachment and returns an object URL suitable for
 * <img src>. The URL is revoked when the component unmounts or the attachment
 * changes. Bytes are cached across remounts via TanStack Query.
 */
export function useAttachmentBlobUrl(
  taskId: number | undefined,
  attachmentId: number | undefined,
  mime: string = 'application/octet-stream'
): { url: string | null; isLoading: boolean; error: unknown } {
  const enabled = taskId != null && attachmentId != null
  const query = useQuery<Uint8Array>({
    queryKey: ['attachment-bytes', taskId, attachmentId],
    queryFn: async () => {
      const result = await api.fetchTaskAttachmentBytes(taskId as number, attachmentId as number)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    enabled,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10,
  })

  const url = useMemo(() => {
    if (!query.data) return null
    const blob = new Blob([query.data], { type: mime })
    return URL.createObjectURL(blob)
  }, [query.data, mime])

  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  return { url, isLoading: query.isLoading, error: query.error }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/hooks/use-attachment-bytes.ts
git commit -m "feat: add useAttachmentBlobUrl hook"
```

---

### Task 5: Upload-from-paste mutation hook (resolves new attachment ID)

**Files:**
- Modify: `src/renderer/hooks/use-task-mutations.ts` (insert after `useUploadAttachmentFromDrop` at line 647)

- [ ] **Step 1: Add the new hook**

In `src/renderer/hooks/use-task-mutations.ts`, after the closing brace of `useUploadAttachmentFromDrop` (around line 647), add:

```ts
export function useUploadAttachmentFromPaste() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      taskId,
      fileData,
      fileName,
      mimeType,
    }: {
      taskId: number
      fileData: Uint8Array
      fileName: string
      mimeType: string
    }): Promise<{ attachmentId: number }> => {
      // Snapshot current attachment IDs so we can identify the new one after upload.
      const beforeResult = await api.fetchTaskAttachments(taskId)
      const beforeIds = new Set<number>(
        beforeResult.success ? beforeResult.data.map((a) => a.id) : []
      )

      const uploadResult = await api.uploadTaskAttachment(taskId, fileData, fileName, mimeType)
      if (!uploadResult.success) throw new Error(uploadResult.error)

      // Refetch and find the new attachment. If multiple new entries appear, prefer
      // the one matching fileName; otherwise take the highest ID.
      const afterResult = await api.fetchTaskAttachments(taskId)
      if (!afterResult.success) throw new Error(afterResult.error)

      const newAttachments = afterResult.data.filter((a) => !beforeIds.has(a.id))
      const byName = newAttachments.find((a) => a.file.name === fileName)
      const picked = byName ?? newAttachments.sort((a, b) => b.id - a.id)[0]
      if (!picked) throw new Error('Upload succeeded but new attachment not found')

      return { attachmentId: picked.id }
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['task-attachments', vars.taskId] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['view-tasks'] })
    },
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/hooks/use-task-mutations.ts
git commit -m "feat: add useUploadAttachmentFromPaste mutation resolving attachment id"
```

---

### Task 6: Clipboard image extraction helper

**Files:**
- Create: `src/renderer/lib/clipboard-images.ts`

- [ ] **Step 1: Create the helper**

Write `src/renderer/lib/clipboard-images.ts`:

```ts
/**
 * Extract image files from a ClipboardEvent. Returns an array of { file, name, mime }
 * for every image in the clipboard. The caller is responsible for reading bytes
 * (e.g. via FileReader) and for calling preventDefault if any images were found.
 */
export interface ClipboardImage {
  file: File
  name: string
  mime: string
}

export function getClipboardImages(event: ClipboardEvent | React.ClipboardEvent): ClipboardImage[] {
  const data = 'clipboardData' in event ? event.clipboardData : null
  if (!data) return []
  const out: ClipboardImage[] = []
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]
    if (item.kind !== 'file') continue
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    const ext = item.type.split('/')[1] || 'png'
    const name = file.name && file.name !== 'image.png'
      ? file.name
      : `pasted-${Date.now()}.${ext}`
    out.push({ file, name, mime: item.type })
  }
  return out
}

export async function fileToUint8Array(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer()
  return new Uint8Array(buffer)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/lib/clipboard-images.ts
git commit -m "feat: add clipboard image extraction helper"
```

---

### Task 7: `TaskDescription` component — preview/edit rendering

**Files:**
- Create: `src/renderer/components/task-list/TaskDescription.tsx`

- [ ] **Step 1: Create the component skeleton with mode switching**

Write `src/renderer/components/task-list/TaskDescription.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { segmentDescription, insertTokenAt, imageToken, pendingToken } from '@/lib/image-tokens'
import { getClipboardImages, fileToUint8Array } from '@/lib/clipboard-images'
import { useUploadAttachmentFromPaste } from '@/hooks/use-task-mutations'
import { useAttachmentBlobUrl } from '@/hooks/use-attachment-bytes'

export interface PendingImage {
  uuid: string
  blobUrl: string
  bytes: Uint8Array
  name: string
  mime: string
}

type Props = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  placeholder?: string
  className?: string
  /** When provided, paste will upload to this task and insert `[[image:<id>]]`. */
  taskId?: number
  /** When no taskId, pasted images are reported here; caller stages and inserts `[[image-pending:<uuid>]]`. */
  onStagePending?: (image: PendingImage) => void
  /** Map of pending uuid → blob URL for rendering staged previews. */
  pendingImages?: Record<string, PendingImage>
  /** Start in preview mode (default true). Edit mode activates on click. */
  startInPreview?: boolean
}

export function TaskDescription({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder = 'Notes',
  className,
  taskId,
  onStagePending,
  pendingImages,
  startInPreview = true,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasContent = value.trim().length > 0
  const [isEditing, setIsEditing] = useState(!startInPreview || !hasContent)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadMutation = useUploadAttachmentFromPaste()

  // Auto-resize textarea while editing
  useEffect(() => {
    if (!isEditing) return
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = 10 * 18
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [isEditing, value])

  // Clear stale upload errors after 4s
  useEffect(() => {
    if (!uploadError) return
    const t = setTimeout(() => setUploadError(null), 4000)
    return () => clearTimeout(t)
  }, [uploadError])

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const images = getClipboardImages(e)
      if (images.length === 0) return
      e.preventDefault()

      const target = e.currentTarget
      const cursor = target.selectionStart ?? target.value.length
      let currentText = value
      let currentCursor = cursor

      for (const img of images) {
        if (taskId != null) {
          try {
            const bytes = await fileToUint8Array(img.file)
            const result = await uploadMutation.mutateAsync({
              taskId,
              fileData: bytes,
              fileName: img.name,
              mimeType: img.mime,
            })
            const token = imageToken(result.attachmentId)
            currentText = insertTokenAt(currentText, currentCursor, token)
            currentCursor = currentText.indexOf(token, currentCursor) + token.length
            onChange(currentText)
          } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'Upload failed')
          }
        } else if (onStagePending) {
          const bytes = await fileToUint8Array(img.file)
          const uuid = (crypto as Crypto).randomUUID().slice(0, 8)
          const blobUrl = URL.createObjectURL(new Blob([bytes], { type: img.mime }))
          const token = pendingToken(uuid)
          currentText = insertTokenAt(currentText, currentCursor, token)
          currentCursor = currentText.indexOf(token, currentCursor) + token.length
          onChange(currentText)
          onStagePending({ uuid, blobUrl, bytes, name: img.name, mime: img.mime })
        }
      }
    },
    [value, taskId, onChange, onStagePending, uploadMutation]
  )

  if (!isEditing) {
    return (
      <div
        className={cn('cursor-text', className)}
        onClick={() => setIsEditing(true)}
      >
        <PreviewContent value={value} taskId={taskId} pendingImages={pendingImages} />
      </div>
    )
  }

  return (
    <div className={cn('relative', className)}>
      <textarea
        ref={textareaRef}
        value={value}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        onBlur={() => {
          setIsEditing(false)
          onBlur?.()
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={1}
        className="custom-scrollbar w-full resize-none bg-transparent text-xs leading-[18px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
        style={{ overflowY: 'hidden' }}
      />
      {uploadMutation.isPending && (
        <div className="text-2xs text-[var(--text-secondary)] italic">Uploading image…</div>
      )}
      {uploadError && (
        <div className="text-2xs text-red-500">{uploadError}</div>
      )}
    </div>
  )
}

function PreviewContent({
  value,
  taskId,
  pendingImages,
}: {
  value: string
  taskId?: number
  pendingImages?: Record<string, PendingImage>
}) {
  const segments = segmentDescription(value)
  if (segments.length === 0) {
    return (
      <p className="text-xs text-[var(--text-secondary)]">Notes</p>
    )
  }
  return (
    <div className="flex flex-col gap-1 text-xs leading-[18px] text-[var(--text-primary)]">
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return (
            <p key={i} className="whitespace-pre-wrap">
              {seg.text}
            </p>
          )
        }
        if (seg.kind === 'image' && taskId != null) {
          return <AttachmentImage key={i} taskId={taskId} attachmentId={seg.attachmentId} />
        }
        if (seg.kind === 'pending' && pendingImages?.[seg.uuid]) {
          const img = pendingImages[seg.uuid]
          return (
            <img
              key={i}
              src={img.blobUrl}
              alt={img.name}
              className="max-h-40 max-w-full rounded border border-[var(--border-color)]"
            />
          )
        }
        return null
      })}
    </div>
  )
}

function AttachmentImage({ taskId, attachmentId }: { taskId: number; attachmentId: number }) {
  const { url, isLoading, error } = useAttachmentBlobUrl(taskId, attachmentId, 'image/*')
  if (isLoading) {
    return (
      <div className="h-20 w-40 animate-pulse rounded bg-[var(--bg-hover)]" />
    )
  }
  if (error || !url) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-2xs text-red-500">
        Failed to load image
      </div>
    )
  }
  return (
    <img
      src={url}
      alt={`Attachment ${attachmentId}`}
      className="max-h-40 max-w-full rounded border border-[var(--border-color)]"
    />
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/task-list/TaskDescription.tsx
git commit -m "feat: add TaskDescription component with edit/preview mode and paste-to-upload"
```

---

### Task 8: Integrate `TaskDescription` into expanded `TaskRow`

**Files:**
- Modify: `src/renderer/components/task-list/TaskRow.tsx` (lines 115, 121, 140–153, 407–433)

- [ ] **Step 1: Remove the local `descRef` and textarea sizing effect**

In `src/renderer/components/task-list/TaskRow.tsx`, delete the line:

```ts
  const descRef = useRef<HTMLTextAreaElement>(null)
```

(currently at line 121).

Then in the focus/sizing `useEffect` around lines 142–154, remove the textarea auto-sizing branch; leave only the title focus:

Replace:

```ts
  useEffect(() => {
    if (isExpanded) {
      titleRef.current?.focus()
      // Auto-size description textarea for existing content
      if (descRef.current) {
        const el = descRef.current
        el.style.height = 'auto'
        const maxH = 10 * 18
        el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
        el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
      }
    }
  }, [isExpanded])
```

With:

```ts
  useEffect(() => {
    if (isExpanded) {
      titleRef.current?.focus()
    }
  }, [isExpanded])
```

- [ ] **Step 2: Update the Enter-to-focus-description keydown**

The title input's keydown (around line 384) calls `descRef.current?.focus()`. Since the description now owns its own focus via click-to-edit, replace that branch with a no-op comment:

Find:

```ts
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              descRef.current?.focus()
            }
```

Replace with:

```ts
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              // Description focus is now managed by TaskDescription on click.
            }
```

- [ ] **Step 3: Import `TaskDescription`**

At the top of `TaskRow.tsx`, add:

```ts
import { TaskDescription } from './TaskDescription'
```

- [ ] **Step 4: Replace the description block**

Locate the description block (around lines 407–433):

```tsx
      {/* Description */}
      <div className="px-4 pt-2 pl-[43px]">
        <textarea
          ref={descRef}
          value={editDescription}
          onChange={(e) => {
            setEditDescription(e.target.value)
            // Auto-resize textarea
            const el = e.target
            el.style.height = 'auto'
            const maxH = 10 * 18
            el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
            el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
          }}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              handleSave()
              collapseAll()
            }
          }}
          placeholder="Notes"
          rows={1}
          className="custom-scrollbar w-full resize-none bg-transparent text-xs leading-[18px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
          style={{ overflowY: 'hidden' }}
        />
      </div>
```

Replace with:

```tsx
      {/* Description */}
      <div className="px-4 pt-2 pl-[43px]">
        <TaskDescription
          taskId={task.id}
          value={editDescription}
          onChange={setEditDescription}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              handleSave()
              collapseAll()
            }
          }}
          startInPreview={editDescription.trim().length > 0}
        />
      </div>
```

- [ ] **Step 5: Manual verify — existing task paste flow**

Run: `npm run dev`

Steps:
1. Open any existing task (click to expand).
2. Copy an image to clipboard (e.g. a screenshot).
3. Click into the description (enters edit mode).
4. Paste (Ctrl+V / ⌘V).

Expected:
- "Uploading image…" indicator appears briefly.
- A `[[image:<n>]]` token is inserted at the cursor (surrounded by newlines).
- On blur, the task saves; the textarea switches to preview mode and renders the image thumbnail inline (max-height 160px).
- Reopening the task shows the same inline thumbnail.
- The image also appears in the attachments popover (the paperclip icon).

If blob URL doesn't load, check DevTools → Network for the IPC call or console for thrown errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/task-list/TaskRow.tsx
git commit -m "feat: use TaskDescription in expanded task row for paste-to-image support"
```

---

### Task 9: Integrate `TaskDescription` into new-task form (`TaskList.tsx`) with pending-image staging

**Files:**
- Modify: `src/renderer/components/task-list/TaskList.tsx`

- [ ] **Step 1: Add pending-image state**

Near the existing `const [newDescription, setNewDescription] = useState('')` (around line 53), add:

```ts
  const [pendingImages, setPendingImages] = useState<Record<string, PendingImage>>({})
```

Import the types at the top of the file:

```ts
import { TaskDescription, type PendingImage } from './TaskDescription'
import { replacePendingTokens, pendingToken } from '@/lib/image-tokens'
import { useUploadAttachmentFromPaste } from '@/hooks/use-task-mutations'
```

Add:

```ts
  const uploadFromPaste = useUploadAttachmentFromPaste()
```

near the other mutation hooks (around line 63).

- [ ] **Step 2: Add a reset helper for the new-task form**

Find existing reset logic (the block around lines 152–158 or wherever `setIsAdding(false)` / `setNewDescription('')` is called). Add immediately after any place that resets these:

```ts
      // Revoke any staged blob URLs
      Object.values(pendingImages).forEach((p) => URL.revokeObjectURL(p.blobUrl))
      setPendingImages({})
```

Do this at every early-return site and on cancel. There are typically 2–3 such places in `TaskList.tsx` — grep for `setNewDescription('')` and add the revoke/clear immediately after each.

- [ ] **Step 3: Replace the new-task description textarea**

Locate the description input for new tasks. Search for `newDescription` as the `value` on a textarea. Replace that textarea with:

```tsx
        <TaskDescription
          value={newDescription}
          onChange={setNewDescription}
          onStagePending={(img) => setPendingImages((prev) => ({ ...prev, [img.uuid]: img }))}
          pendingImages={pendingImages}
          placeholder="Notes"
          startInPreview={false}
        />
```

The `startInPreview={false}` ensures the textarea stays in edit mode during composition (users expect to type continuously without click-to-edit friction).

- [ ] **Step 4: Upload pending images after task creation**

Find the `createTask.mutate(…, { onSuccess: (data) => { … } })` block starting around line 178. Inside `onSuccess`, after the existing post-creation logic (label attachment), add:

```ts
          // Upload any images that were pasted before the task had an ID.
          const stagedEntries = Object.entries(pendingImages)
          if (stagedEntries.length > 0 && data && typeof data === 'object' && 'id' in data) {
            const newTaskId = (data as Task).id
            ;(async () => {
              const mapping: Record<string, number> = {}
              for (const [uuid, img] of stagedEntries) {
                try {
                  const result = await uploadFromPaste.mutateAsync({
                    taskId: newTaskId,
                    fileData: img.bytes,
                    fileName: img.name,
                    mimeType: img.mime,
                  })
                  mapping[uuid] = result.attachmentId
                } catch {
                  // Leave pending token in place; user can retry by editing.
                }
                URL.revokeObjectURL(img.blobUrl)
              }
              if (Object.keys(mapping).length > 0) {
                const patched = replacePendingTokens(desc, mapping)
                if (patched !== desc) {
                  updateTask.mutate({
                    id: newTaskId,
                    task: { id: newTaskId, description: patched } as Task,
                  })
                }
              }
              setPendingImages({})
            })()
          }
```

Note: `desc` is already computed earlier in the same function (line 173) as the trimmed description. If its scope doesn't reach `onSuccess`, capture it locally:

```ts
    const desc = newDescription.trim()
    if (desc) {
      payload.description = desc
    }
    const snapshotDesc = desc  // used inside onSuccess
    const snapshotPending = pendingImages
```

Then use `snapshotDesc` and `snapshotPending` inside `onSuccess`. Adjust accordingly — the goal is that `onSuccess` has stable references to the description text and the pending images at submit time, independent of further state changes.

- [ ] **Step 5: Clear pending state after success**

Inside `onSuccess`, after the label attachment block, ensure `setNewDescription('')` and `setPendingImages({})` are called (alongside the existing reset logic).

- [ ] **Step 6: Manual verify — new task paste flow**

Run: `npm run dev`

Steps:
1. On any view with a new-task input (e.g. Inbox), expand the description area.
2. Paste an image (Ctrl+V / ⌘V).

Expected:
- A `[[image-pending:<uuid>]]` token appears at the cursor, and a thumbnail appears in the preview.
- The task input is still composable — type a title and submit.

3. Submit the new task.

Expected:
- Task is created with the pending token in its description.
- A moment later, the staged image uploads as an attachment.
- The description is patched so the pending token becomes `[[image:<realId>]]`.
- Reopening the task shows the image inline.
- `createTask` mutation does not duplicate the task.

4. Paste an image, then cancel the new-task form (click outside).

Expected:
- Blob URL is revoked.
- No orphaned upload occurs.

5. Paste two images in sequence into one new task.

Expected:
- Both tokens end up as real `[[image:id]]` references post-save.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/task-list/TaskList.tsx
git commit -m "feat: stage pasted images during new-task creation and upload on save"
```

---

### Task 10: Error-path + offline manual QA

**Files:** (verification only)

- [ ] **Step 1: Verify behavior with the backend offline**

Run: `npm run dev`, then stop your Vikunja server or block its hostname.

Test:
1. Open an existing task and paste an image.

Expected:
- `uploadMutation` rejects; the "Upload failed" error banner appears under the textarea for ~4 seconds.
- No token is inserted.
- The image is not persisted in the description (paste handler only inserts the token after successful upload for existing tasks).

2. Create a new task with an image, then try to save while offline.

Expected:
- Task creation either enqueues in the pending-actions queue or fails visibly.
- If queued, the staged blob URL is revoked and the pending token remains unresolved; on later sync, no attachment uploads (this is acceptable — orphan pending tokens are a known tradeoff documented below).

- [ ] **Step 2: Verify behavior with a very large image**

Paste a 20 MB image (or the largest you can produce). Expected: either a clean upload (watch the `Uploading image…` indicator for a few seconds) or a clean failure with an error banner. No UI hangs, no uncaught promise rejections in DevTools console.

- [ ] **Step 3: Verify non-image paste is unaffected**

Copy plain text into the clipboard. Paste into the description.

Expected: text is inserted as normal; no upload attempt is made; `getClipboardImages` returns `[]`, so `preventDefault` is never called.

- [ ] **Step 4: Verify token deletion**

Edit a description that contains `[[image:42]]`. Delete the token text in edit mode. Save.

Expected:
- The image stops rendering in preview mode.
- The attachment itself is **not** deleted from Vikunja (this is by design — deleting the attachment is a separate action via the attachments popover).

- [ ] **Step 5: Document the orphan-token tradeoff in the README or task description**

In `docs/superpowers/plans/2026-04-15-paste-images-into-task-notes.md`, append at the bottom of this plan file:

```markdown
## Known tradeoffs

1. If a user deletes the `[[image:id]]` token from the description but doesn't remove the underlying attachment, the attachment remains on the task. This matches existing behavior for non-image attachments.
2. If a pending-image upload fails during new-task creation, the `[[image-pending:uuid]]` token stays in the saved description and will render as literal text. The user must reopen the task and delete/retry manually. A follow-up improvement could auto-cleanup pending tokens after N minutes.
3. Quick Entry window does not support paste-to-image in this iteration — it is a separate vanilla-JS renderer. Follow-up work required.
```

- [ ] **Step 6: Commit QA notes**

```bash
git add docs/superpowers/plans/2026-04-15-paste-images-into-task-notes.md
git commit -m "docs: document known tradeoffs for paste-image feature"
```

---

## Self-Review Results

**Spec coverage:**
- Existing-task flow → Tasks 5, 7, 8.
- New-task flow → Task 9.
- Inline thumbnails (option B) → Task 7 (`PreviewContent`) + Task 4 (blob URL hook).
- Edit/preview auto-switch → Task 7 (`isEditing` state + `startInPreview` prop).
- Blob URL lifecycle → Task 4 (cleanup on unmount) + Task 9 (revoke on cancel/success).

**Types consistency:**
- `PendingImage` defined in Task 7, imported in Task 9 — names match.
- `imageToken(id)` and `pendingToken(uuid)` names are consistent across Tasks 1, 7, 9.
- `useUploadAttachmentFromPaste` shape consistent: `{ taskId, fileData, fileName, mimeType }` in/`{ attachmentId }` out — used identically in Tasks 7 and 9.

**Placeholder scan:** No "TBD", "similar to Task N", or handwavy error-handling remain. All steps have concrete code.

---

## Known tradeoffs

1. **Dangling tokens on attachment deletion.** If a user deletes the `[[image:id]]` token from the description but leaves the underlying attachment in place, the attachment remains on the task (accessible via the paperclip popover). Conversely, if a user deletes the attachment from the popover, the `[[image:id]]` token in the description is left as-is and renders a "Failed to load image" placeholder. This matches existing behavior for non-image attachments and is the simplest model to reason about.
2. **Pending token stranding on upload failure.** If a new-task creation succeeds but one or more image uploads fail during the post-creation upload loop, the `[[image-pending:uuid]]` token stays in the saved description. It will render as literal text in preview mode (no matching `pendingImages` entry exists after form reset). The user must edit the task and manually clean up. Follow-up: schedule a cleanup sweep that removes stale pending tokens, or surface a retry affordance.
3. **Quick Entry window does not support paste-to-image.** Quick Entry is a separate vanilla-JS renderer (`src/renderer/quick-entry/`) that does not share components with the main React app. Porting paste-to-image would require either duplicating the helpers or refactoring quick-entry to use React. Deferred.
4. **Notes area no longer auto-submits on blur.** The old textarea in `TaskList` submitted the new-task form on blur unless focus moved inside the creation container. `TaskDescription`'s `onBlur` prop carries no argument so `relatedTarget` cannot be inspected. Blur now just switches back to preview mode. Ctrl+Enter and Enter-in-title-input still submit. Arguably safer (no accidental submits) but a behavior change worth calling out.
5. **Multi-image paste ordering race.** While a multi-image paste is in progress, user keystrokes update `value` via the parent state. The paste handler reads from a `valueRef` to pick up the latest text at the start of each token insertion, but there is still a microscopic window where a keystroke can land inside an inserted token. For single-image paste (the common case), this isn't reachable.
