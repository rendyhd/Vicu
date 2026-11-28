import { useMemo, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { X, FileText, Image, File, Loader2, Download, Clock, AlertCircle } from 'lucide-react'
import { useTaskAttachments, useUploadAttachment, useDeleteAttachment } from '@/hooks/use-task-mutations'
import { useAttachmentActions } from '@/hooks/use-attachment-actions'
import { useAttachmentBlobUrl } from '@/hooks/use-attachment-bytes'
import { formatFileSize, viewableImages, type ViewerImage } from '@/lib/attachment-preview'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'
import { AttachmentViewer } from './AttachmentViewer'
import { api } from '@/lib/api'
import { useOfflineStore } from '@/stores/offline-store'
import { waitingUploadStatus, waitingUploadsFor, type WaitingUpload } from '@/lib/waiting-uploads'
import { uploadingStatus, uploadsToShow, type UploadingFile } from '@/lib/uploading-files'
import { useUploadingStore } from '@/stores/uploading-store'

interface AttachmentPickerPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  /** A second button that toggles the same popover (the paperclip in the card header). */
  invokedBy?: RefObject<HTMLElement | null>[]
  taskId: number
  onClose: (reason?: PopoverCloseReason) => void
}

function getFileIcon(mime: string) {
  if (mime.startsWith('image/')) return Image
  if (mime.startsWith('text/') || mime === 'application/pdf') return FileText
  return File
}

/** An image row's picture: the server's preview, with the image icon until it arrives or if it cannot be drawn. */
function ImageThumbnail({ taskId, image }: { taskId: number; image: ViewerImage }) {
  const { url } = useAttachmentBlobUrl(taskId, image.id, image.mime)
  const [broken, setBroken] = useState(false)
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-control bg-bg-hover">
      {url && !broken ? (
        <img src={url} alt="" draggable={false} onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <Image className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
      )}
    </span>
  )
}

/**
 * A file attached while the server could not be reached (issue 104): waiting in the offline queue,
 * or refused by the server with the reason and, where it can help, Retry.
 */
function WaitingUploadRow({ upload }: { upload: WaitingUpload }) {
  const { t } = useTranslation()
  const remove = () => void (upload.failed ? api.offlineQueue.discardFailed([upload.id]) : api.offlineQueue.discardPending([upload.id]))
  return (
    <div className={`flex items-center gap-2 rounded-control px-2 py-1.5 ${upload.failed ? 'bg-danger/10' : ''}`}>
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-bg-hover opacity-80">
        <File className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
        {upload.failed ? (
          <AlertCircle className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-[var(--bg-primary)] text-danger" aria-hidden="true" />
        ) : (
          <Clock className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-[var(--bg-primary)] text-accent-blue" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-[var(--text-primary)]">{upload.name}</span>
        <span className={`block text-caption ${upload.failed ? 'text-danger' : 'text-[var(--text-secondary)]'}`}>
          {waitingUploadStatus(upload)}
        </span>
      </span>
      {upload.failed && upload.canRetry && (
        <button
          type="button"
          onClick={() => void api.offlineQueue.retryFailed([upload.id])}
          className="shrink-0 rounded-control px-1.5 py-0.5 text-caption font-medium text-accent-blue hover:bg-[var(--bg-hover)]"
        >
          {t('task.common.retry')}
        </button>
      )}
      <button
        type="button"
        onClick={remove}
        aria-label={t('task.attachments.removeNamed', { name: upload.name })}
        title={t('task.attachments.remove')}
        className="shrink-0 rounded-control p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-danger"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

/**
 * A file the attach dialog is sending now: the waiting row's shape with a spinner in the badge.
 * Its attachment's own row takes its place once the server names it.
 */
function UploadingRow({ upload }: { upload: UploadingFile }) {
  const { t } = useTranslation()
  return (
    <div role="status" aria-label={t('task.attachments.uploadingNamed', { name: upload.name })} className="flex items-center gap-2 rounded-control px-2 py-1.5">
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-bg-hover opacity-80">
        <File className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
        <Loader2
          className="absolute -bottom-1 -right-1 h-3.5 w-3.5 animate-spin rounded-full bg-[var(--bg-primary)] text-accent-blue motion-reduce:animate-none"
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1" aria-hidden="true">
        <span className="block truncate text-xs text-[var(--text-primary)]">{upload.name}</span>
        <span className="block text-caption text-[var(--text-secondary)]">{uploadingStatus(upload.size)}</span>
      </span>
    </div>
  )
}

export function AttachmentPickerPopover({ anchorRef, invokedBy, taskId, onClose }: AttachmentPickerPopoverProps) {
  const { t } = useTranslation()
  const { data: attachments, isLoading } = useTaskAttachments(taskId, true)
  const offlineSnapshot = useOfflineStore((state) => state.snapshot)
  const waiting = useMemo(() => waitingUploadsFor(offlineSnapshot, taskId), [offlineSnapshot, taskId])
  const uploadAttachment = useUploadAttachment()
  const allUploads = useUploadingStore((state) => state.uploads)
  const landedNotice = useUploadingStore((state) => (state.notice?.taskId === taskId ? state.notice.text : ''))
  const uploading = useMemo(() => uploadsToShow(allUploads, taskId, attachments ?? []), [allUploads, taskId, attachments])
  const deleteAttachment = useDeleteAttachment()
  // What the last Open or Save did, shown under the list; and the attachment being saved.
  const { notice, savingId, open: handleOpen, save: handleSave } = useAttachmentActions(taskId)
  // Images open in the viewer, which sits inside this popover so the list stays open behind it.
  const images = useMemo(() => viewableImages(attachments), [attachments])
  const [viewingId, setViewingId] = useState<number | null>(null)

  const handleDelete = (attachmentId: number) => {
    deleteAttachment.mutate({ taskId, attachmentId })
  }

  const handleBrowse = () => {
    uploadAttachment.mutate(taskId)
  }

  return (
    <Popover anchorRef={anchorRef} invokedBy={invokedBy} onClose={onClose} label={t('task.attachments.title')} className="w-72 p-3">
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" />
        </div>
      ) : (attachments && attachments.length > 0) || uploading.length > 0 || waiting.length > 0 ? (
        <div className="mb-2 flex max-h-48 flex-col gap-1 overflow-y-auto custom-scrollbar">
          {(attachments ?? []).map((att) => {
            const Icon = getFileIcon(att.file.mime)
            const image = images.find((candidate) => candidate.id === att.id)
            return (
              <div
                key={att.id}
                className="group/att flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-[var(--bg-hover)]"
              >
                <button
                  type="button"
                  onClick={() => (image ? setViewingId(att.id) : handleOpen(att.id, att.file.name))}
                  title={image ? t('task.attachments.view') : t('task.attachments.open')}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {image ? (
                    <ImageThumbnail taskId={taskId} image={image} />
                  ) : (
                    <Icon className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-[var(--text-primary)]">
                      {att.file.name}
                    </span>
                    <span className="block text-caption text-[var(--text-secondary)]">
                      {formatFileSize(att.file.size)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSave(att.id, att.file.name)
                  }}
                  disabled={savingId === att.id}
                  aria-label={t('task.viewer.saveNamed', { name: att.file.name })}
                  title={t('task.viewer.saveTo')}
                  className="shrink-0 rounded-control p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
                >
                  {savingId === att.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(att.id)
                  }}
                  aria-label={t('task.attachments.removeNamed', { name: att.file.name })}
                  title={t('task.attachments.removeAttachment')}
                  className="shrink-0 opacity-0 group-hover/att:opacity-100 focus-visible:opacity-100 text-[var(--text-secondary)] hover:text-danger"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
          {uploading.map((upload) => (
            <UploadingRow key={upload.key} upload={upload} />
          ))}
          {waiting.map((upload) => (
            <WaitingUploadRow key={upload.id} upload={upload} />
          ))}
        </div>
      ) : (
        <p className="mb-2 text-center text-xs text-[var(--text-secondary)]">{t('task.attachments.none')}</p>
      )}

      {/* Another file can be added while one uploads: each shows its own row above. */}
      <button
        type="button"
        onClick={handleBrowse}
        className="w-full rounded-control bg-accent-fill px-2 py-1.5 text-xs text-on-accent hover:opacity-90"
      >
        {t('task.attachments.browse')}
      </button>
      <p role="status" className="sr-only">{landedNotice}</p>

      {notice && (
        <p role="status" className={`mt-1.5 text-caption ${notice.error ? 'text-danger' : 'text-[var(--text-secondary)]'}`}>
          {notice.text}
        </p>
      )}
      {uploadAttachment.isError && (
        <p className="mt-1.5 text-caption text-danger">
          {uploadAttachment.error?.message || t('task.attachments.uploadFailed')}
        </p>
      )}
      {deleteAttachment.isError && (
        <p className="mt-1.5 text-caption text-danger">
          {deleteAttachment.error?.message || t('task.attachments.deleteFailed')}
        </p>
      )}

      {viewingId != null && (
        <AttachmentViewer taskId={taskId} images={images} startId={viewingId} onClose={() => setViewingId(null)} />
      )}
    </Popover>
  )
}
