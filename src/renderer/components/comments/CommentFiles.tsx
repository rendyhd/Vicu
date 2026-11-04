import { useState } from 'react'
import { Download, FileText, ImageOff, Loader2, Paperclip, X } from 'lucide-react'
import { useAttachmentActions } from '@/hooks/use-attachment-actions'
import { useAttachmentBlobUrl } from '@/hooks/use-attachment-bytes'
import { formatFileSize } from '@/lib/attachment-preview'
import { cn } from '@/lib/cn'
import type { CommentAttachment } from '@/lib/collaboration'
import { fileDisplayName, isFileGone, type CommentFileList } from '@/lib/comment-files'
import type { StagedFile } from '@/stores/comments-pane-store'
import { Tooltip } from '@/components/overlay/Tooltip'

// Files in a comment (cross-app semantics 9.5): the image preview, the file row and the composer's chips.

/** The height of a preview, set before the image arrives so the thread does not move when it does. */
const PREVIEW_HEIGHT_PX = 200

const ROW_BUTTON =
  'inline-flex shrink-0 rounded-control p-1.5 text-text-secondary transition-colors duration-fade-fast hover:bg-bg-hover hover:text-text disabled:opacity-40'

interface FileProps {
  file: CommentAttachment
  taskId: number
  list: CommentFileList
}

/**
 * An image in a comment: the server's preview at a fixed height, as wide as the image needs; a click
 * opens the viewer. One that cannot be shown (offline, not really an image) is a file, and so is one
 * the task no longer has.
 */
export function CommentImage({ file, taskId, list, onView }: FileProps & { onView: () => void }) {
  const gone = isFileGone(file, list)
  const mime = list.known.get(file.attachment)?.file.mime || 'image/png'
  const { url, error } = useAttachmentBlobUrl(gone ? undefined : taskId, file.attachment, mime)
  const [broken, setBroken] = useState(false)
  const [ratio, setRatio] = useState<number | null>(null)

  if (gone || broken || error) return <CommentFile file={file} taskId={taskId} list={list} />

  const name = fileDisplayName(file, list)
  return (
    <button
      type="button"
      aria-label={`View ${name}`}
      title={name}
      onClick={onView}
      style={{ height: PREVIEW_HEIGHT_PX, ...(ratio ? { aspectRatio: ratio } : { width: '100%' }) }}
      className="mt-1.5 flex max-w-full items-center justify-center overflow-hidden rounded-control bg-bg-hover"
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget
            if (naturalHeight > 0) setRatio(naturalWidth / naturalHeight)
          }}
          onError={() => setBroken(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <Loader2 className="h-4 w-4 animate-spin text-text-secondary" aria-hidden="true" />
      )}
    </button>
  )
}

/** A file in a comment: its name and size. A click opens it in the default app; Save beside it. */
export function CommentFile({ file, taskId, list }: FileProps) {
  const { notice, savingId, open, save } = useAttachmentActions(taskId)
  const name = fileDisplayName(file, list)
  const gone = isFileGone(file, list)
  const size = list.known.get(file.attachment)?.file.size
  const Icon = file.image ? ImageOff : gone ? FileText : Paperclip
  const details = (
    <>
      <span className={cn('block truncate text-meta', gone ? 'text-text-secondary' : 'text-text')}>{name}</span>
      {gone ? (
        <span className="block text-caption text-text-secondary">No longer available</span>
      ) : (
        size !== undefined && <span className="block text-caption text-text-secondary">{formatFileSize(size)}</span>
      )}
    </>
  )
  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2 rounded-control border border-[var(--border-color)] bg-bg-card py-1 pl-2.5 pr-1">
        <Icon className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
        {gone ? (
          <div className="min-w-0 flex-1 py-0.5">{details}</div>
        ) : (
          <>
            <button type="button" title="Open" onClick={() => void open(file.attachment, name)} className="min-w-0 flex-1 py-0.5 text-left">
              <span className="sr-only">Open </span>
              {details}
            </button>
            <button
              type="button"
              aria-label={`Save ${name}`}
              title="Save to…"
              disabled={savingId === file.attachment}
              onClick={() => void save(file.attachment, name)}
              className={ROW_BUTTON}
            >
              {savingId === file.attachment ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          </>
        )}
      </div>
      {notice && (
        <p role="status" className={cn('mt-1 text-caption', notice.error ? 'text-danger' : 'text-text-secondary')}>
          {notice.text}
        </p>
      )}
    </div>
  )
}

/** The composer's paperclip: the system's file dialog. */
export function AttachButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Tooltip label="Attach files. You can also paste or drop them here.">
      <button type="button" aria-label="Attach files" disabled={busy} onClick={onClick} className={cn(ROW_BUTTON, 'mr-1.5')}>
        {busy ? <Loader2 className="h-[15px] w-[15px] animate-spin" aria-hidden="true" /> : <Paperclip className="h-[15px] w-[15px]" aria-hidden="true" />}
      </button>
    </Tooltip>
  )
}

/** The files added to the comment being written: a spinner while one uploads, a button to take it out. */
export function StagedFiles({ files, onRemove }: { files: readonly StagedFile[]; onRemove: (key: number) => void }) {
  return (
    <ul aria-label="Files in this comment" className="mb-2 flex list-none flex-wrap gap-1.5">
      {files.map((file) => (
        <li key={file.key} className="inline-flex max-w-full items-center gap-1 rounded-control border border-[var(--border-color)] bg-bg-card pl-2 text-meta text-text">
          {file.attachment ? (
            <Paperclip className="h-3 w-3 shrink-0 text-text-secondary" aria-hidden="true" />
          ) : (
            <Loader2 role="status" aria-label={`Uploading ${file.name}`} className="h-3 w-3 shrink-0 animate-spin text-text-secondary" />
          )}
          <span className="min-w-0 truncate" title={file.name}>
            {file.name}
          </span>
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            onClick={() => onRemove(file.key)}
            className="inline-flex shrink-0 rounded-control p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  )
}
