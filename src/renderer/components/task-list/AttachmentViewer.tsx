import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Download, ExternalLink, ImageOff, Loader2, Maximize2, Minimize2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { stepImage, type ViewerImage } from '@/lib/attachment-preview'
import { useAttachmentBlobUrl } from '@/hooks/use-attachment-bytes'
import { useAttachmentActions } from '@/hooks/use-attachment-actions'
import { Dialog } from '../overlay/Dialog'

interface AttachmentViewerProps {
  taskId: number
  /** The task's images, in the order the arrows go through them. */
  images: ViewerImage[]
  /** The image to show first. */
  startId: number
  onClose: () => void
}

const ICON_BUTTON =
  'shrink-0 rounded-control p-1.5 text-text-secondary transition-colors duration-fade-fast hover:bg-bg-hover hover:text-text disabled:opacity-40'

/**
 * A task's image attachments in a modal over the app: the image fitted to the window (a click shows
 * it at its own size when it is larger), Left and Right between the task's images, Open in the
 * default app and Save. Render it where it was opened from (inside the attachment list's popover,
 * which then stays open behind it); Escape and Close return there.
 */
export function AttachmentViewer({ taskId, images, startId, onClose }: AttachmentViewerProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex((image) => image.id === startId)))
  const { notice, clearNotice, savingId, open, save } = useAttachmentActions(taskId)
  const image = images[Math.min(index, images.length - 1)]
  const many = images.length > 1

  // The image was removed while the viewer was open (another window, another device).
  useEffect(() => {
    if (!image) onClose()
  }, [image, onClose])

  // A step replaces the stage, and with it a focused zoom or retry button: keep focus in the
  // viewer, or the next arrow key would go to the page.
  useEffect(() => {
    const root = rootRef.current
    if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true })
  }, [index])

  if (!image) return null

  const go = (step: 1 | -1) => {
    clearNotice()
    setIndex((current) => stepImage(current, images.length, step))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!many || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    go(event.key === 'ArrowLeft' ? -1 : 1)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy={titleId}
      className="h-[calc(100vh-4rem)] w-[calc(100vw-4rem)] overflow-hidden"
    >
      {/* Focusable so a click on the image keeps focus (and the arrow keys) in the viewer. */}
      <div ref={rootRef} tabIndex={-1} className="flex h-full flex-col focus:outline-none" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-1 border-b border-border py-1.5 pl-4 pr-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-card-title text-text" title={image.name}>
            {image.name}
          </h2>
          {notice && (
            <p role="status" className={cn('mx-2 min-w-0 truncate text-caption', notice.error ? 'text-danger' : 'text-text-secondary')}>
              {notice.text}
            </p>
          )}
          {many && (
            <span className="mx-2 shrink-0 text-meta tabular-nums text-text-secondary" aria-live="polite">
              {index + 1} of {images.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => void open(image.id, image.name)}
            aria-label="Open in default app"
            title="Open in default app"
            className={ICON_BUTTON}
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void save(image.id, image.name)}
            disabled={savingId === image.id}
            aria-label={`Save ${image.name}`}
            title="Save to…"
            className={ICON_BUTTON}
          >
            {savingId === image.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </button>
          <button data-autofocus type="button" onClick={onClose} aria-label="Close" title="Close" className={ICON_BUTTON}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative min-h-0 flex-1 bg-bg-hover">
          <ImageStage key={image.id} taskId={taskId} image={image} onOpen={() => void open(image.id, image.name)} />
          {many && (
            <>
              <StepButton side="left" label="Previous image" onClick={() => go(-1)}>
                <ChevronLeft className="h-5 w-5" />
              </StepButton>
              <StepButton side="right" label="Next image" onClick={() => go(1)}>
                <ChevronRight className="h-5 w-5" />
              </StepButton>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}

function StepButton({ side, label, onClick, children }: { side: 'left' | 'right'; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg-page/90 text-text shadow-sm transition-colors duration-fade-fast hover:bg-bg-page',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      {children}
    </button>
  )
}

/**
 * One image: the server's small preview stretched to the stage while the original loads, then the
 * original at its own size, shrunk to fit. Keyed by the image, so its state starts over on a step.
 */
function ImageStage({ taskId, image, onOpen }: { taskId: number; image: ViewerImage; onOpen: () => void }) {
  const original = useAttachmentBlobUrl(taskId, image.id, image.mime, 'original')
  const preview = useAttachmentBlobUrl(taskId, image.id, image.mime)
  const [broken, setBroken] = useState(false)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)
  // Where the image was clicked, as a fraction of it, so that point stays under the pointer.
  const zoomPoint = useRef<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const canZoom = !!natural && !!stage && (natural.width > stage.width || natural.height > stage.height)
  const isZoomed = zoomed && canZoom

  useLayoutEffect(() => {
    const el = scrollerRef.current
    const point = zoomPoint.current
    if (!el || !isZoomed) return
    zoomPoint.current = null
    const x = point?.x ?? 0.5
    const y = point?.y ?? 0.5
    el.scrollLeft = x * el.scrollWidth - el.clientWidth / 2
    el.scrollTop = y * el.scrollHeight - el.clientHeight / 2
  }, [isZoomed])

  const toggleZoom = (event?: MouseEvent<HTMLImageElement>) => {
    if (!canZoom) return
    if (!isZoomed && event) {
      const rect = event.currentTarget.getBoundingClientRect()
      zoomPoint.current = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
    }
    setZoomed(!isZoomed)
  }

  const failed = broken || (!original.url && !!original.error && !original.isLoading)
  const shown = failed ? null : original.url ?? preview.url
  const isPreview = !failed && !original.url && !!preview.url

  return (
    <>
      <div ref={scrollerRef} className={cn('absolute inset-0 flex', isZoomed ? 'overflow-auto' : 'overflow-hidden')}>
        {failed ? (
          <div className="m-auto flex max-w-sm flex-col items-center gap-3 px-6 text-center">
            <ImageOff className="h-8 w-8 text-text-secondary" />
            <p className="text-meta text-text-secondary">
              {broken ? 'This image cannot be shown here.' : 'The image could not be loaded.'}
            </p>
            <div className="flex gap-2">
              {!broken && (
                <button
                  type="button"
                  onClick={() => void original.retry()}
                  className="rounded-control border border-border px-3 py-1.5 text-meta text-text transition-colors duration-fade-fast hover:bg-bg-page"
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={onOpen}
                className="rounded-control bg-accent-fill px-3 py-1.5 text-meta text-on-accent transition-colors duration-fade-fast hover:bg-accent-fill/90"
              >
                Open in default app
              </button>
            </div>
          </div>
        ) : shown ? (
          <img
            src={shown}
            alt={image.name}
            draggable={false}
            onLoad={(event) => {
              if (isPreview) return
              const img = event.currentTarget
              setNatural({ width: img.naturalWidth, height: img.naturalHeight })
            }}
            onError={() => {
              if (!isPreview) setBroken(true)
            }}
            onClick={toggleZoom}
            className={cn(
              'm-auto block select-none',
              isPreview
                ? 'h-full w-full object-contain'
                : isZoomed
                  ? 'max-h-none max-w-none cursor-zoom-out'
                  : cn('max-h-full max-w-full object-contain', canZoom && 'cursor-zoom-in'),
            )}
          />
        ) : (
          <span role="status" className="m-auto">
            <Loader2 className="h-6 w-6 animate-spin text-text-secondary" aria-hidden />
            <span className="sr-only">Loading image</span>
          </span>
        )}
      </div>

      {isPreview && (
        <span role="status" className="absolute bottom-3 left-3">
          <Loader2 className="h-4 w-4 animate-spin text-text-secondary" aria-hidden />
          <span className="sr-only">Loading the full image</span>
        </span>
      )}
      {canZoom && !failed && (
        <button
          type="button"
          onClick={() => toggleZoom()}
          aria-label={isZoomed ? 'Fit to window' : 'Actual size'}
          title={isZoomed ? 'Fit to window' : 'Actual size'}
          className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-bg-page/90 text-text shadow-sm transition-colors duration-fade-fast hover:bg-bg-page"
        >
          {isZoomed ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      )}
    </>
  )
}
