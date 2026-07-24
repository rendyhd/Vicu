export interface PaginatedResponse<T> {
  items: T[] | null
  total: number
  page: number
  per_page: number
  total_pages: number
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
