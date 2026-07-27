export interface PaginatedResponse<T> {
  items: T[] | null
  total: number
  page: number
  per_page: number
  total_pages: number
}

export type AttachmentPreviewSize = 'sm' | 'md' | 'lg' | 'xl'

export function buildTaskAttachmentDownloadUrl(
  baseUrl: string,
  taskId: number,
  attachmentId: number,
  previewSize?: AttachmentPreviewSize
): string {
  const url = new URL(
    `${baseUrl.replace(/\/+$/, '')}/api/v2/tasks/${taskId}/attachments/${attachmentId}`
  )
  if (previewSize) {
    url.searchParams.set('preview_size', previewSize)
  }
  return url.toString()
}

const WRITABLE_TASK_FIELDS = new Set([
  'bucket_id',
  'cover_image_attachment_id',
  'description',
  'done',
  'due_date',
  'end_date',
  'hex_color',
  'is_favorite',
  'percent_done',
  'priority',
  'project_id',
  'reminders',
  'repeat_after',
  'repeat_mode',
  'start_date',
  'title',
])

/**
 * Turn task state or a partial update into a v2-safe merge patch.
 * Undefined and server-owned response fields are never written back.
 */
export function createTaskPatch(task: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(task).filter(([key, value]) => WRITABLE_TASK_FIELDS.has(key) && value !== undefined)
  )
}
