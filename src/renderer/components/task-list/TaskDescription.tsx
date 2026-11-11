import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { cn } from '@/lib/cn'
import { splitDescriptionImages, joinDescriptionImages, type DescriptionImage } from '@/lib/image-tokens'
import { getClipboardImages, fileToUint8Array } from '@/lib/clipboard-images'
import {
  useTaskAttachments,
  useAttachPastedImage,
  useDeleteAttachment,
} from '@/hooks/use-task-mutations'
import { useAttachmentBlobUrl } from '@/hooks/use-attachment-bytes'
import { viewableImageType, type ViewerImage } from '@/lib/attachment-preview'
import { LazyRichTextEditor } from '@/components/rich-text/LazyRichTextEditor'
import { AttachmentViewer } from './AttachmentViewer'

export interface PendingImage {
  uuid: string
  /** Object URL for rendering before the task exists. Caller owns lifecycle; must revoke on cancel/unmount/post-upload. */
  blobUrl: string
  /** Raw bytes retained for re-upload once a task ID is available. */
  bytes: Uint8Array
  name: string
  mime: string
}

type ImageRef = DescriptionImage

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
  /** Fired once with the initial value as the editor writes it: its normalized HTML, then the image tokens. */
  onReady?: (normalizedValue: string) => void
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
  const uploadMutation = useAttachPastedImage()
  const deleteMutation = useDeleteAttachment()
  // Refs to latest text/images — paste is async and closes over stale deps otherwise.
  const textRef = useRef('')
  const imagesRef = useRef<ImageRef[]>([])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const { text, images } = useMemo(() => splitDescriptionImages(value), [value])
  textRef.current = text
  imagesRef.current = images

  // A click on an uploaded image shows it in the viewer, with the note's other images.
  const [viewingId, setViewingId] = useState<number | null>(null)
  const { data: attachments } = useTaskAttachments(taskId ?? -1, taskId != null)
  const viewerImages = useMemo<ViewerImage[]>(
    () =>
      images.flatMap((img) => {
        if (img.kind !== 'image') return []
        const file = attachments?.find((a) => a.id === img.attachmentId)?.file
        return [{
          id: img.attachmentId,
          name: file?.name || `Image ${img.attachmentId}`,
          mime: (file && viewableImageType(file)) || 'image/png',
        }]
      }),
    [images, attachments]
  )

  // Clear stale upload errors after 4s
  useEffect(() => {
    if (!uploadError) return
    const t = setTimeout(() => setUploadError(null), 4000)
    return () => clearTimeout(t)
  }, [uploadError])

  // The editor only holds the text: put the image tokens back, or the card would take the text
  // alone as the description and the pictures would drop out of the notes.
  const handleReady = useCallback(
    (normalizedText: string) => {
      onReady?.(joinDescriptionImages(normalizedText, imagesRef.current))
    },
    [onReady]
  )

  const handleTextChange = useCallback(
    (html: string) => {
      onChange(joinDescriptionImages(html, imagesRef.current))
    },
    [onChange]
  )

  const removeImage = useCallback(
    (toRemove: ImageRef) => {
      const next = imagesRef.current.filter((img) => imageRefKey(img) !== imageRefKey(toRemove))
      onChange(joinDescriptionImages(textRef.current, next))
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
              // Offline the image waits in the queue and joins the notes once uploaded (issue 104).
              if ('attachmentId' in result) next.push({ kind: 'image', attachmentId: result.attachmentId })
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
        onChangeRef.current(joinDescriptionImages(textRef.current, next))
      })()
      return true
    },
    [taskId, onStagePending, uploadMutation]
  )

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <LazyRichTextEditor
        value={text}
        onChange={handleTextChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onPaste={handlePaste}
        onReady={handleReady}
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
              onView={img.kind === 'image' && taskId != null ? () => setViewingId(img.attachmentId) : undefined}
            />
          ))}
        </div>
      )}

      {viewingId != null && taskId != null && (
        <AttachmentViewer taskId={taskId} images={viewerImages} startId={viewingId} onClose={() => setViewingId(null)} />
      )}

      {uploadMutation.isPending && (
        <div className="text-caption italic text-[var(--text-secondary)]">
          Uploading image…
        </div>
      )}
      {uploadError && <div className="text-caption text-danger">{uploadError}</div>}
    </div>
  )
}

function ImageThumb({
  img,
  taskId,
  pendingImages,
  onRemove,
  onView,
}: {
  img: ImageRef
  taskId?: number
  pendingImages?: Record<string, PendingImage>
  onRemove: () => void
  onView?: () => void
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
  return <AttachmentThumb taskId={taskId} attachmentId={img.attachmentId} onRemove={onRemove} onView={onView} />
}

function AttachmentThumb({
  taskId,
  attachmentId,
  onRemove,
  onView,
}: {
  taskId?: number
  attachmentId: number
  onRemove: () => void
  onView?: () => void
}) {
  const [decodeError, setDecodeError] = useState(false)
  const { data: attachments } = useTaskAttachments(taskId ?? -1, taskId != null)
  const file = attachments?.find((a) => a.id === attachmentId)?.file
  const mime = file?.mime || 'image/png'
  const { url, isLoading, error, retry } = useAttachmentBlobUrl(taskId, attachmentId, mime)

  if (isLoading) {
    return <div className="h-20 w-32 animate-pulse rounded-control bg-[var(--bg-hover)]" />
  }
  if (error || decodeError) {
    return (
      <button
        type="button"
        onClick={() => {
          setDecodeError(false)
          void retry()
        }}
        className="rounded-control border border-danger/30 bg-danger/10 px-2 py-1 text-caption text-danger hover:bg-danger/15"
      >
        Retry image
      </button>
    )
  }
  if (!url) {
    return <div className="h-20 w-32 animate-pulse rounded-control bg-[var(--bg-hover)]" />
  }
  return (
    <Thumb
      src={url}
      alt={file?.name || `Attachment ${attachmentId}`}
      onRemove={onRemove}
      onError={() => setDecodeError(true)}
      onView={onView}
    />
  )
}

function Thumb({
  src,
  alt,
  onRemove,
  onError,
  onView,
}: {
  src: string
  alt: string
  onRemove: () => void
  onError?: () => void
  /** Shows the image in the viewer; without it the thumbnail is only a picture. */
  onView?: () => void
}) {
  const image = (
    <img
      src={src}
      alt={alt}
      draggable={false}
      onError={onError}
      className="block h-auto max-h-40 w-auto max-w-md rounded-control border border-[var(--border-color)] object-contain"
    />
  )
  return (
    <div className="group relative inline-block">
      {onView ? (
        <button type="button" onClick={onView} aria-label={`View ${alt}`} title="View image" className="block cursor-zoom-in rounded-control">
          {image}
        </button>
      ) : (
        image
      )}
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
