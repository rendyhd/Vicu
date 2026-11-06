import { withDueWindow } from '../shared/due-dates'
import { withoutNestedSubtasks } from '../shared/nested-subtasks'

export interface PaginatedResponse<T> {
  items: T[] | null
  total: number
  page: number
  per_page: number
  total_pages: number
}

/** Largest `per_page` Vikunja 2.4 accepts; anything above it is a 422. */
export const MAX_PAGE_SIZE = 1000

/** Turn a caller supplied `per_page` into a value the server accepts, or null. */
export function clampPageSize(value: unknown): number | null {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 1) return null
  return Math.min(n, MAX_PAGE_SIZE)
}

/**
 * The request behind a project's task count: a page of one task whose envelope carries the
 * `total` of the whole filter (sidebar progress rings). Never a listing.
 */
export function buildProjectTaskCountUrl(baseUrl: string, projectId: number, done: boolean): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/api/v2/projects/${projectId}/tasks`)
  url.searchParams.set('filter', done ? 'done = true' : 'done = false')
  url.searchParams.set('per_page', '1')
  return url.toString()
}

/** The `total` of an API v2 list envelope, or null when the response carries no usable one. */
export function readEnvelopeTotal(body: unknown): number | null {
  const total = (body as { total?: unknown } | null)?.total
  return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? Math.floor(total) : null
}

export function buildProjectCollectionUrl(baseUrl: string, includeArchived = false): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/api/v2/projects`)
  if (includeArchived) url.searchParams.set('is_archived', 'true')
  // Each project then carries `max_permission`: what the signed-in user may do with it (read only,
  // write, admin), which decides the Assign, comment and Share controls (cross-app semantics 9.2).
  url.searchParams.set('expand', 'permissions')
  return url.toString()
}

/**
 * Vicu-only task query option (never sent to the server): add `comment_count` and `is_unread` to
 * every task. Set by the renderer only while at least one project is shared, so a user who shares
 * nothing pays nothing (cross-app semantics 9.4). The server wants `expand` repeated, not joined.
 */
export const COLLAB_SIGNALS_PARAM = 'collab_signals'

/** Vikunja error code: the user is already assigned to that task (answered with 400). */
export const VIKUNJA_ERROR_ALREADY_ASSIGNED = 4021
/** Vikunja error code: already subscribed (answered with 412). */
export const VIKUNJA_ERROR_ALREADY_SUBSCRIBED = 12002

/** Comments are read newest first, 50 at a time; the thread shows them oldest first. */
export const COMMENT_PAGE_SIZE = 50

export function buildTaskCommentsUrl(baseUrl: string, taskId: number, page: number): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/api/v2/tasks/${taskId}/comments`)
  url.searchParams.set('order_by', 'desc')
  url.searchParams.set('per_page', String(COMMENT_PAGE_SIZE))
  url.searchParams.set('page', String(Math.max(1, Math.floor(page))))
  return url.toString()
}

/** The items of an API v2 list envelope (or a bare array from an older server). */
export function envelopeItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  const items = (body as { items?: unknown } | null)?.items
  return Array.isArray(items) ? items : []
}

export interface TaskCommentPage {
  /** Newest first, as the server sent them. */
  items: unknown[]
  page: number
  totalPages: number
}

export function readCommentPage(body: unknown, page: number): TaskCommentPage {
  const items = envelopeItems(body)
  const reported = (body as { total_pages?: unknown } | null)?.total_pages
  const totalPages = typeof reported === 'number' && Number.isFinite(reported) ? Math.max(0, Math.floor(reported)) : page
  return { items, page, totalPages }
}

/** Avatars larger than this are refused; a user picture is resized by the server well below it. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/** The image type of an avatar from its first bytes; null when it is not an image we show. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const b = bytes
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp'
  }
  // SVG is text: skip a byte order mark and white space, then look for the XML or svg start.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, Math.min(b.length, 512))).replace(/^﻿/, '').trimStart()
  if (/^<\?xml[\s\S]*<svg[\s>]/i.test(head) || /^<svg[\s>]/i.test(head)) return 'image/svg+xml'
  return null
}

/**
 * Build the query shared by flat task collection endpoints. Vikunja still
 * returns a flat array for this expansion, but guarantees every child rides
 * on the same page as its parent and populates their reciprocal relations.
 */
export function createTaskCollectionSearchParams(
  params: Record<string, unknown>,
  now: Date = new Date()
): URLSearchParams {
  const qs = new URLSearchParams()
  qs.append('expand', 'subtasks')
  if (params[COLLAB_SIGNALS_PARAM] === true) {
    qs.append('expand', 'comment_count')
    qs.append('expand', 'is_unread')
  }
  if (params.q ?? params.s) qs.set('q', String(params.q ?? params.s))
  // `due_window` (Today, Upcoming) is a Vicu option: it becomes a clause on the local-day boundary
  // of this very request and is never sent as a parameter.
  const filter = withDueWindow(params.filter ? String(params.filter) : undefined, params.due_window, now)
  if (filter) qs.set('filter', filter)
  if (params.sort_by) qs.set('sort_by', String(params.sort_by))
  if (params.order_by) qs.set('order_by', String(params.order_by))
  const perPage = clampPageSize(params.per_page)
  if (perPage !== null) qs.set('per_page', String(perPage))
  if (params.page) qs.set('page', String(params.page))
  if (params.filter_include_nulls) {
    qs.set('filter_include_nulls', String(params.filter_include_nulls))
  }
  if (params.filter_timezone) qs.set('filter_timezone', String(params.filter_timezone))
  return qs
}

export { withoutNestedSubtasks } from '../shared/nested-subtasks'

/**
 * Vicu-only query option (never sent to the server): keep nested subtasks in the result so the
 * caller can filter first and hide them afterwards (Tag view, custom lists; cross-app
 * semantics v1 section 3.2).
 */
export const KEEP_NESTED_SUBTASKS_PARAM = 'keep_nested_subtasks'

/** The final step of every task fetch: hide nested subtasks unless the caller asked to keep them. */
export function finishTaskCollection<T>(tasks: T[], params: Record<string, unknown>): T[] {
  return params[KEEP_NESTED_SUBTASKS_PARAM] === true ? tasks : withoutNestedSubtasks(tasks)
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
