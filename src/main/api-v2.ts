export interface PaginatedResponse<T> {
  items: T[] | null
  total: number
  page: number
  per_page: number
  total_pages: number
}

/**
 * Build the query shared by flat task collection endpoints. Vikunja still
 * returns a flat array for this expansion, but guarantees every child rides
 * on the same page as its parent and populates their reciprocal relations.
 */
export function createTaskCollectionSearchParams(
  params: Record<string, unknown>
): URLSearchParams {
  const qs = new URLSearchParams()
  qs.append('expand', 'subtasks')
  if (params.q ?? params.s) qs.set('q', String(params.q ?? params.s))
  if (params.filter) qs.set('filter', String(params.filter))
  if (params.sort_by) qs.set('sort_by', String(params.sort_by))
  if (params.order_by) qs.set('order_by', String(params.order_by))
  if (params.per_page) qs.set('per_page', String(params.per_page))
  if (params.page) qs.set('page', String(params.page))
  if (params.filter_include_nulls) {
    qs.set('filter_include_nulls', String(params.filter_include_nulls))
  }
  if (params.filter_timezone) qs.set('filter_timezone', String(params.filter_timezone))
  return qs
}

function taskId(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'number' ? id : null
}

/**
 * Remove a task from the top-level list only when one of its parents is also
 * present. A matching child remains visible for searches/filters which omit
 * its parent.
 */
export function withoutNestedSubtasks<T>(tasks: T[]): T[] {
  const visibleIds = new Set(tasks.map(taskId).filter((id): id is number => id !== null))

  return tasks.filter((task) => {
    if (!task || typeof task !== 'object') return true
    const related = (task as { related_tasks?: unknown }).related_tasks
    if (!related || typeof related !== 'object') return true
    const parents = (related as { parenttask?: unknown }).parenttask
    if (!Array.isArray(parents)) return true
    return !parents.some((parent) => {
      const parentId = taskId(parent)
      return parentId !== null && visibleIds.has(parentId)
    })
  })
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
