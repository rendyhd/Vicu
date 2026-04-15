import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { segmentDescription, insertTokenAt, imageToken, pendingToken } from '@/lib/image-tokens'
import { getClipboardImages, fileToUint8Array } from '@/lib/clipboard-images'
import { useUploadAttachmentFromPaste } from '@/hooks/use-task-mutations'
import { useAttachmentBlobUrl } from '@/hooks/use-attachment-bytes'

export interface PendingImage {
  uuid: string
  /** Object URL for rendering before the task exists. Caller owns lifecycle; must revoke on cancel/unmount/post-upload. */
  blobUrl: string
  /** Raw bytes retained for re-upload once a task ID is available. */
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
  /**
   * When no taskId, pasted images are reported here. The component inserts
   * `[[image-pending:<uuid>]]` into the text via `onChange` itself; the caller
   * stages the image and OWNS the `blobUrl` lifecycle — must revoke on
   * cancel/unmount/post-upload.
   */
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
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])
  const hasContent = value.trim().length > 0
  const [isEditing, setIsEditing] = useState(!startInPreview || !hasContent)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadMutation = useUploadAttachmentFromPaste()

  const MAX_TEXTAREA_HEIGHT_PX = 180 // 10 rows × 18px line-height

  // Auto-resize textarea while editing
  useEffect(() => {
    if (!isEditing) return
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT_PX ? 'auto' : 'hidden'
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
      let currentText = valueRef.current
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
          // 8-char UUID slice — only needs to be unique within this paste session.
          const uuid = crypto.randomUUID().slice(0, 8)
          const blobUrl = URL.createObjectURL(new Blob([bytes], { type: img.mime }))
          const token = pendingToken(uuid)
          currentText = insertTokenAt(currentText, currentCursor, token)
          currentCursor = currentText.indexOf(token, currentCursor) + token.length
          onStagePending({ uuid, blobUrl, bytes, name: img.name, mime: img.mime })
          onChange(currentText)
        }
      }
    },
    [taskId, onChange, onStagePending, uploadMutation]
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
