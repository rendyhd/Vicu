import { useRef, useEffect } from 'react'
import { X, FileText, Image, File, Loader2 } from 'lucide-react'
import { useTaskAttachments, useUploadAttachment, useDeleteAttachment } from '@/hooks/use-task-mutations'
import { api } from '@/lib/api'

interface AttachmentPickerPopoverProps {
  taskId: number
  onClose: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(mime: string) {
  if (mime.startsWith('image/')) return Image
  if (mime.startsWith('text/') || mime === 'application/pdf') return FileText
  return File
}

export function AttachmentPickerPopover({ taskId, onClose }: AttachmentPickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: attachments, isLoading } = useTaskAttachments(taskId, true)
  const uploadAttachment = useUploadAttachment()
  const deleteAttachment = useDeleteAttachment()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const handleOpen = (attachmentId: number, fileName: string) => {
    api.openTaskAttachment(taskId, attachmentId, fileName)
  }

  const handleDelete = (attachmentId: number) => {
    deleteAttachment.mutate({ taskId, attachmentId })
  }

  const handleBrowse = () => {
    uploadAttachment.mutate(taskId)
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-lg"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" />
        </div>
      ) : attachments && attachments.length > 0 ? (
        <div className="mb-2 flex max-h-48 flex-col gap-1 overflow-y-auto custom-scrollbar">
          {attachments.map((att) => {
            const Icon = getFileIcon(att.file.mime)
            return (
              <div
                key={att.id}
                className="group/att flex items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--bg-hover)]"
              >
                <Icon className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                <button
                  type="button"
                  onClick={() => handleOpen(att.id, att.file.name)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-xs text-[var(--text-primary)]">
                    {att.file.name}
                  </div>
                  <div className="text-2xs text-[var(--text-secondary)]">
                    {formatFileSize(att.file.size)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(att.id)
                  }}
                  className="shrink-0 opacity-0 group-hover/att:opacity-100 text-[var(--text-secondary)] hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="mb-2 text-center text-xs text-[var(--text-secondary)]">No attachments</p>
      )}

      <button
        type="button"
        onClick={handleBrowse}
        disabled={uploadAttachment.isPending}
        className="w-full rounded bg-[var(--accent-blue)] px-2 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-40"
      >
        {uploadAttachment.isPending ? 'Uploading...' : 'Browse files'}
      </button>

      {uploadAttachment.isError && (
        <p className="mt-1.5 text-2xs text-red-500">
          {uploadAttachment.error?.message || 'Upload failed'}
        </p>
      )}
      {deleteAttachment.isError && (
        <p className="mt-1.5 text-2xs text-red-500">
          {deleteAttachment.error?.message || 'Delete failed'}
        </p>
      )}
    </div>
  )
}
