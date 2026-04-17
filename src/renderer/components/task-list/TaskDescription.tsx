import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { cn } from '@/lib/cn'
import { segmentDescription, imageToken, pendingToken } from '@/lib/image-tokens'
import { getClipboardImages, fileToUint8Array } from '@/lib/clipboard-images'
import {
  useTaskAttachments,
  useUploadAttachmentFromPaste,
  useDeleteAttachment,
} from '@/hooks/use-task-mutations'
import { useAttachmentBlobUrl } from '@/hooks/use-attachment-bytes'
import { RichTextEditor } from '@/components/rich-text/RichTextEditor'

export interface PendingImage {
  uuid: string
  /** Object URL for rendering before the task exists. Caller owns lifecycle; must revoke on cancel/unmount/post-upload. */
  blobUrl: string
  /** Raw bytes retained for re-upload once a task ID is available. */
  bytes: Uint8Array
  name: string
  mime: string
}

type ImageRef =
  | { kind: 'image'; attachmentId: number }
  | { kind: 'pending'; uuid: string }

type Props = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  onKeyDown?: (e: KeyboardEvent) => boolean | void
  placeholder?: string
  className?: string
  /** When provided, paste will upload to this task and append the image token. */
  taskId?: number
  /**
   * When no taskId, pasted images are reported here. The component appends the
   * pending token; the caller stages the image and OWNS the `blobUrl` lifecycle.
   */
  onStagePending?: (image: PendingImage) => void
  /** Called when the user removes a pending image (clicks the X). Caller revokes blobUrl. */
  onRemovePending?: (uuid: string) => void
  /** Map of pending uuid → image record, used to render staged previews. */
  pendingImages?: Record<string, PendingImage>
  /** Focus the editor on mount. */
  autoFocus?: boolean
  /** Expose the underlying TipTap editor for programmatic focus. */
  editorRef?: React.MutableRefObject<Editor | null>
  /** Fired once with the editor's normalized HTML of the initial content. */
  onReady?: (normalizedHtml: string) => void
}

function parseValue(value: string): { text: string; images: ImageRef[] } {
  const segments = segmentDescription(value)
  let text = ''
  const images: ImageRef[] = []
  for (const seg of segments) {
    if (seg.kind === 'text') text += seg.text
    else if (seg.kind === 'image') images.push({ kind: 'image', attachmentId: seg.attachmentId })
    else if (seg.kind === 'pending') images.push({ kind: 'pending', uuid: seg.uuid })
  }
  return { text: text.replace(/^\n+|\n+$/g, ''), images }
}

function buildValue(text: string, images: ImageRef[]): string {
  const tokens = images
    .map((img) => (img.kind === 'image' ? imageToken(img.attachmentId) : pendingToken(img.uuid)))
    .join('\n')
  if (!tokens) return text
  if (!text) return tokens
  return `${text}\n${tokens}`
}

function imageRefKey(img: ImageRef): string {
  return img.kind === 'image' ? `a:${img.attachmentId}` : `p:${img.uuid}`
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
  onRemovePending,
  pendingImages,
  autoFocus = false,
  editorRef,
  onReady,
}: Props) {
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadMutation = useUploadAttachmentFromPaste()
  const deleteMutation = useDeleteAttachment()
  // Refs to latest text/images — paste is async and closes over stale deps otherwise.
  const textRef = useRef('')
  const imagesRef = useRef<ImageRef[]>([])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const { text, images } = useMemo(() => parseValue(value), [value])
  textRef.current = text
  imagesRef.current = images

  // Clear stale upload errors after 4s
  useEffect(() => {
    if (!uploadError) return
    const t = setTimeout(() => setUploadError(null), 4000)
    return () => clearTimeout(t)
  }, [uploadError])

  const handleTextChange = useCallback(
    (html: string) => {
      onChange(buildValue(html, imagesRef.current))
    },
    [onChange]
  )

  const removeImage = useCallback(
    (toRemove: ImageRef) => {
      const next = imagesRef.current.filter((img) => imageRefKey(img) !== imageRefKey(toRemove))
      onChange(buildValue(textRef.current, next))
      if (toRemove.kind === 'image' && taskId != null) {
        deleteMutation.mutate({ taskId, attachmentId: toRemove.attachmentId })
      } else if (toRemove.kind === 'pending') {
        onRemovePending?.(toRemove.uuid)
      }
    },
    [onChange, taskId, deleteMutation, onRemovePending]
  )

  const handlePaste = useCallback(
    (e: ClipboardEvent): boolean => {
      const clipboardImages = getClipboardImages(e)
      if (clipboardImages.length === 0) return false // allow native text/HTML paste
      e.preventDefault()
      void (async () => {
        const next = imagesRef.current.slice()
        for (const img of clipboardImages) {
          try {
            const bytes = await fileToUint8Array(img.file)
            if (taskId != null) {
              const result = await uploadMutation.mutateAsync({
                taskId,
                fileData: bytes,
                fileName: img.name,
                mimeType: img.mime,
              })
              next.push({ kind: 'image', attachmentId: result.attachmentId })
            } else if (onStagePending) {
              const uuid = crypto.randomUUID().slice(0, 8)
              const blobUrl = URL.createObjectURL(
                new Blob([bytes as BlobPart], { type: img.mime })
              )
              onStagePending({ uuid, blobUrl, bytes, name: img.name, mime: img.mime })
              next.push({ kind: 'pending', uuid })
            }
          } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'Upload failed')
          }
        }
        onChangeRef.current(buildValue(textRef.current, next))
      })()
      return true
    },
    [taskId, onStagePending, uploadMutation]
  )

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <RichTextEditor
        value={text}
        onChange={handleTextChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onPaste={handlePaste}
        onReady={onReady}
        editorRef={editorRef}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="text-xs leading-[18px]"
      />

      {images.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          {images.map((img) => (
            <ImageThumb
              key={imageRefKey(img)}
              img={img}
              taskId={taskId}
              pendingImages={pendingImages}
              onRemove={() => removeImage(img)}
            />
          ))}
        </div>
      )}

      {uploadMutation.isPending && (
        <div className="text-2xs italic text-[var(--text-secondary)]">
          Uploading image…
        </div>
      )}
      {uploadError && <div className="text-2xs text-red-500">{uploadError}</div>}
    </div>
  )
}

function ImageThumb({
  img,
  taskId,
  pendingImages,
  onRemove,
}: {
  img: ImageRef
  taskId?: number
  pendingImages?: Record<string, PendingImage>
  onRemove: () => void
}) {
  if (img.kind === 'pending') {
    const pending = pendingImages?.[img.uuid]
    if (!pending) return null
    return (
      <Thumb
        src={pending.blobUrl}
        alt={pending.name}
        onRemove={onRemove}
      />
    )
  }
  return <AttachmentThumb taskId={taskId} attachmentId={img.attachmentId} onRemove={onRemove} />
}

function AttachmentThumb({
  taskId,
  attachmentId,
  onRemove,
}: {
  taskId?: number
  attachmentId: number
  onRemove: () => void
}) {
  const { data: attachments } = useTaskAttachments(taskId ?? -1, taskId != null)
  const mime = attachments?.find((a) => a.id === attachmentId)?.file.mime || 'image/png'
  const { url, isLoading, error } = useAttachmentBlobUrl(taskId, attachmentId, mime)
  if (isLoading || !url) {
    if (error) {
      return (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-2xs text-red-500">
          Failed to load image
        </div>
      )
    }
    return <div className="h-20 w-32 animate-pulse rounded bg-[var(--bg-hover)]" />
  }
  return <Thumb src={url} alt={`Attachment ${attachmentId}`} onRemove={onRemove} />
}

function Thumb({
  src,
  alt,
  onRemove,
}: {
  src: string
  alt: string
  onRemove: () => void
}) {
  return (
    <div className="group relative inline-block">
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="block h-auto max-h-40 w-auto max-w-md rounded border border-[var(--border-color)] object-contain"
      />
      <button
        type="button"
        tabIndex={-1}
        title="Remove image"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="absolute right-1 top-1 hidden h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/70 text-white shadow-sm transition-colors hover:bg-black/90 group-hover:flex"
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </div>
  )
}
