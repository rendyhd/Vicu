import { loadConfig } from './config'
import { sessionToken, sessionTokenSync, storedApiToken } from '@host/auth'
import {
  buildTaskAttachmentDownloadUrl,
  buildProjectCollectionUrl,
  buildProjectTaskCountUrl,
  readEnvelopeTotal,
  createTaskCollectionSearchParams,
  type AttachmentPreviewSize,
  MAX_PAGE_SIZE,
  clampPageSize,
  type PaginatedResponse,
  finishTaskCollection,
  buildTaskCommentsUrl,
  envelopeItems,
  readCommentPage,
  sniffImageType,
  MAX_AVATAR_BYTES,
  VIKUNJA_ERROR_ALREADY_ASSIGNED,
  VIKUNJA_ERROR_ALREADY_SUBSCRIBED,
  type TaskCommentPage,
} from './api-v2'
import { sanitizeProjectPatch, sanitizeTaskPatch } from '../shared/merge-patches'
import { SESSION_ENDED_MESSAGE } from '../shared/error-classify'
import type { ApiError, ApiResult } from './api-result'
import { collectAllPages } from './paginate'
import { bytesToBase64 } from '../shared/bytes'
import { DEFAULT_MAX_UPLOAD_BYTES, parseMaxFileSize, uploadSizeError } from './upload-limits'
import { request, requestBinary, requestMultipart } from '@host/http'
import { sendToAllWindows } from '@host/windows'

// The answer readers moved to api-answers.ts; these names stay importable from here.
export { readErrorAnswer, readSuccessBody } from './api-answers'


/**
 * Send 'auth-required' IPC event to all renderer windows.
 */
function notifyAuthRequired(): void {
  sendToAllWindows('auth-required')
}

const API_BASE_PATH = '/api/v2'
const JSON_MERGE_PATCH = 'application/merge-patch+json'
const JSON_PATCH = 'application/json-patch+json'

/**
 * Check if a failed result is a 401 with Vikunja error code 11 (expired token).
 */
function isExpiredTokenError(result: ApiError): boolean {
  return result.statusCode === 401 && result.errorCode === 11
}

/**
 * Wrapper that retries a request once on expired-token 401.
 * Refreshes the token via authManager.getToken() and retries with the new token.
 */
async function requestWithRetry<T>(
  method: string,
  url: string,
  token: string,
  body?: unknown,
  contentType = 'application/json'
): Promise<ApiResult<T>> {
  const result = await request<T>(method, url, token, body, contentType)

  if (!result.success && isExpiredTokenError(result)) {
    try {
      const newToken = await sessionToken()
      return sessionAware(await request<T>(method, url, newToken, body, contentType))
    } catch {
      return sessionAware(result)
    }
  }

  return sessionAware(result)
}

/** How long one sign-in prompt covers further 401s, so a burst of refused requests asks once. */
const AUTH_PROMPT_QUIET_MS = 60_000
let authPromptAt: number | null = null

/** Whether the saved connection signs in with a password or OIDC (a session), not an API token. */
function usesSession(): boolean {
  const method = loadConfig()?.auth_method
  return method === 'oidc' || method === 'password'
}

/**
 * The final answer of a request made with the saved connection (after the one refresh and retry).
 * For a password or OIDC sign-in a 401 means the session ended: say so instead of "API token is
 * invalid", and raise the sign-in prompt, at most once a minute however many requests are refused
 * (C-12). API tokens keep their own message: there is nothing to sign in to.
 */
export function sessionAware<T>(result: ApiResult<T>): ApiResult<T> {
  if (result.success || result.statusCode !== 401 || result.tokenPermission || !usesSession()) return result
  const now = Date.now()
  if (authPromptAt === null || now - authPromptAt >= AUTH_PROMPT_QUIET_MS) {
    authPromptAt = now
    notifyAuthRequired()
  }
  return { ...result, error: SESSION_ENDED_MESSAGE }
}

/**
 * A merge patch (PATCH). Vikunja 2.4 answers a patch that changes nothing (the server already has
 * those values) with 304 Not Modified and no body. The change is in effect, so that is a success,
 * not an error: the current state is read back for callers that use the answer. Without this a
 * replayed change that had already landed (a request that timed out after reaching the server)
 * would stop the offline queue for good.
 */
async function patchWithRetry<T>(url: string, token: string, body: unknown): Promise<ApiResult<T>> {
  const result = await requestWithRetry<T>('PATCH', url, token, body, JSON_MERGE_PATCH)
  if (result.success || result.statusCode !== 304) return result
  return requestWithRetry<T>('GET', url, token)
}

async function requestPaginatedWithRetry<T>(
  url: string,
  token: string
): Promise<ApiResult<T[]>> {
  const result = await requestWithRetry<PaginatedResponse<T>>('GET', url, token)
  if (!result.success) return result
  return { success: true, data: result.data?.items ?? [] }
}

/**
 * Fetch every page of a collection. The caller's `per_page` (if any) is only the
 * batch size; the default is the server maximum so large lists need few requests.
 * The real stop conditions live in `collectAllPages`.
 */
async function requestAllPagesWithRetry<T>(
  url: string,
  token: string
): Promise<ApiResult<T[]>> {
  const pageUrl = new URL(url)
  const pageSize = clampPageSize(pageUrl.searchParams.get('per_page')) ?? MAX_PAGE_SIZE
  pageUrl.searchParams.set('per_page', String(pageSize))

  return collectAllPages<T>(
    (page) => {
      pageUrl.searchParams.set('page', String(page))
      return requestWithRetry<PaginatedResponse<T>>('GET', pageUrl.toString(), token)
    },
    { pageSize }
  )
}

async function requestMultipartWithRetry<T>(
  method: string,
  url: string,
  token: string,
  fileBuffer: Uint8Array,
  fileName: string,
  mimeType: string
): Promise<ApiResult<T>> {
  const result = await requestMultipart<T>(method, url, token, fileBuffer, fileName, mimeType)

  if (!result.success && isExpiredTokenError(result)) {
    try {
      const newToken = await sessionToken()
      return sessionAware(await requestMultipart<T>(method, url, newToken, fileBuffer, fileName, mimeType))
    } catch {
      return sessionAware(result)
    }
  }

  return sessionAware(result)
}

async function requestBinaryWithRetry(
  url: string,
  token: string
): Promise<ApiResult<Uint8Array>> {
  const result = await requestBinary(url, token)

  if (!result.success && isExpiredTokenError(result)) {
    try {
      const newToken = await sessionToken()
      return sessionAware(await requestBinary(url, newToken))
    } catch {
      return sessionAware(result)
    }
  }

  return sessionAware(result)
}

/** Where requests go and with which token; `apiToken` when that is an API token, not a session. */
interface Connection {
  url: string
  token: string
  apiToken: boolean
}

async function getConfigOrFail(): Promise<Connection | ApiError> {
  const config = loadConfig()
  if (!config || !config.vikunja_url) {
    return { success: false, error: 'Vikunja is not configured. Open Settings to connect.' }
  }

  if (config.auth_method === 'oidc' || config.auth_method === 'password') {
    // Fast path: sync token check
    const syncToken = sessionTokenSync()
    if (syncToken) return { url: config.vikunja_url, token: syncToken, apiToken: false }

    // Slow path: async recovery (refresh token / silent reauth)
    try {
      const asyncToken = await sessionToken()
      return { url: config.vikunja_url, token: asyncToken, apiToken: false }
    } catch {
      notifyAuthRequired()
      return { success: false, error: 'Session expired. Please sign in again.' }
    }
  }

  // API token path — prefer encrypted store, fall back to config (pre-migration)
  const token = storedApiToken() || config.api_token
  if (!token) {
    return { success: false, error: 'Vikunja is not configured. Open Settings to connect.' }
  }
  return { url: config.vikunja_url, token, apiToken: true }
}

// --- Tasks ---

export async function fetchTasks(params: Record<string, unknown>): Promise<ApiResult<unknown[]>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const qs = createTaskCollectionSearchParams(params)

  const queryString = qs.toString()
  const fullUrl = queryString
    ? `${c.url}${API_BASE_PATH}/tasks?${queryString}`
    : `${c.url}${API_BASE_PATH}/tasks`

  const result = params.page
    ? requestPaginatedWithRetry<unknown>(fullUrl, c.token)
    : requestAllPagesWithRetry<unknown>(fullUrl, c.token)
  const tasks = await result
  if (!tasks.success) return tasks
  return { success: true, data: finishTaskCollection(tasks.data, params) }
}

/**
 * How many tasks a project holds that are (not) done: the `total` of the API v2 envelope of a page
 * of one task, never a listing (sidebar progress rings, decision 11). Hidden carrier tasks are
 * included; the caller subtracts the ones it knows. A response without a usable `total` is an
 * error, not zero.
 */
export async function fetchProjectTaskTotal(projectId: number, done: boolean): Promise<ApiResult<number>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<unknown>('GET', buildProjectTaskCountUrl(c.url, projectId, done), c.token)
  if (!result.success) return result
  const total = readEnvelopeTotal(result.data)
  return total === null
    ? { success: false, error: 'The server did not report a task total' }
    : { success: true, data: total }
}

export async function createTask(
  projectId: number,
  task: Record<string, unknown>
): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<unknown>(
    'POST',
    `${c.url}${API_BASE_PATH}/projects/${projectId}/tasks`,
    c.token,
    task
  )
}

// API v2 supports JSON Merge Patch, so partial updates no longer zero fields omitted
// from the request. Filter out read-only response fields before sending the patch.
export async function updateTask(
  id: number,
  task: Record<string, unknown>
): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return patchWithRetry<unknown>(`${c.url}${API_BASE_PATH}/tasks/${id}`, c.token, sanitizeTaskPatch(task))
}

/**
 * A JSON Patch (RFC 6902) of a task: the routine carrier and archive part writes (cross-app
 * semantics 6.8) start with a `test` of the description they read, so Vikunja applies nothing and
 * answers 422 when another device wrote the task since. A 304 (nothing changed) reads the task back,
 * as for a merge patch. A JSON Patch body may be larger than the 1 MiB a merge patch is limited to.
 */
export async function patchTaskJson(
  id: number,
  operations: readonly Record<string, unknown>[]
): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const url = `${c.url}${API_BASE_PATH}/tasks/${id}`
  const result = await requestWithRetry<unknown>('PATCH', url, c.token, operations, JSON_PATCH)
  if (result.success || result.statusCode !== 304) return result
  return requestWithRetry<unknown>('GET', url, c.token)
}

export async function deleteTask(id: number): Promise<ApiResult<void>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<void>('DELETE', `${c.url}${API_BASE_PATH}/tasks/${id}`, c.token)
}

// --- Projects ---

/**
 * The account's projects. Vikunja also lists its pseudo-projects with negative ids (saved filters
 * and Favorites, cross-app semantics 3.7); they are left out, so nothing treats them as projects.
 * `fetchProjectsAndSavedFilters` has both.
 */
export async function fetchProjects(includeArchived = false): Promise<ApiResult<unknown[]>> {
  const result = await fetchProjectsAndSavedFilters(includeArchived)
  return result.success ? { success: true, data: result.data.projects } : result
}

/** The real projects, and the pseudo-projects (negative ids) Vikunja lists among them. */
export async function fetchProjectsAndSavedFilters(
  includeArchived = false,
): Promise<ApiResult<{ projects: unknown[]; pseudo: Array<{ id: number; title?: string; updated?: string }> }>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestAllPagesWithRetry<unknown>(buildProjectCollectionUrl(c.url, includeArchived), c.token)
  if (!result.success) return result
  const idOf = (project: unknown) => (project as { id?: unknown })?.id
  const projects = result.data.filter((project) => typeof idOf(project) !== 'number' || (idOf(project) as number) > 0)
  const pseudo = result.data.filter((project) => typeof idOf(project) === 'number' && (idOf(project) as number) < 0) as Array<{ id: number; title?: string; updated?: string }>
  return { success: true, data: { projects, pseudo } }
}

/** A saved filter (cross-app semantics 3.7). */
export async function fetchSavedFilter(id: number): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<unknown>('GET', `${c.url}${API_BASE_PATH}/filters/${id}`, c.token)
}

/** One project as the server has it right now (GET /projects/{id}); bypasses every cache. */
export async function fetchProjectById(id: number): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<unknown>('GET', `${c.url}${API_BASE_PATH}/projects/${id}`, c.token)
}

export async function createProject(project: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<unknown>('POST', `${c.url}${API_BASE_PATH}/projects`, c.token, project)
}

export async function updateProject(
  id: number,
  project: Record<string, unknown>
): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return patchWithRetry<unknown>(`${c.url}${API_BASE_PATH}/projects/${id}`, c.token, sanitizeProjectPatch(project))
}

export async function deleteProject(id: number): Promise<ApiResult<void>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<void>('DELETE', `${c.url}${API_BASE_PATH}/projects/${id}`, c.token)
}

// --- Labels ---

export async function fetchLabels(): Promise<ApiResult<unknown[]>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestAllPagesWithRetry<unknown>(`${c.url}${API_BASE_PATH}/labels`, c.token)
}

export async function addLabelToTask(taskId: number, labelId: number): Promise<ApiResult<void>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<void>(
    'POST',
    `${c.url}${API_BASE_PATH}/tasks/${taskId}/labels`,
    c.token,
    { label_id: labelId }
  )
}

export async function removeLabelFromTask(taskId: number, labelId: number): Promise<ApiResult<void>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<void>(
    'DELETE',
    `${c.url}${API_BASE_PATH}/tasks/${taskId}/labels/${labelId}`,
    c.token
  )
}

export async function createLabel(label: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<unknown>('POST', `${c.url}${API_BASE_PATH}/labels`, c.token, label)
}

export async function updateLabel(
  id: number,
  label: Record<string, unknown>
): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return patchWithRetry<unknown>(`${c.url}${API_BASE_PATH}/labels/${id}`, c.token, label)
}

export async function deleteLabel(id: number): Promise<ApiResult<void>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<void>('DELETE', `${c.url}${API_BASE_PATH}/labels/${id}`, c.token)
}

// --- Single Task ---

export async function fetchTaskById(id: number): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<unknown>(
    'GET',
    `${c.url}${API_BASE_PATH}/tasks/${id}?expand=subtasks`,
    c.token
  )
}

// --- Task Relations ---

export async function createTaskRelation(
  taskId: number,
  otherTaskId: number,
  relationKind: string
): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<unknown>('POST', `${c.url}${API_BASE_PATH}/tasks/${taskId}/relations`, c.token, {
    other_task_id: otherTaskId,
    relation_kind: relationKind,
  })
}

export async function deleteTaskRelation(
  taskId: number,
  relationKind: string,
  otherTaskId: number
): Promise<ApiResult<void>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<void>(
    'DELETE',
    `${c.url}${API_BASE_PATH}/tasks/${taskId}/relations/${relationKind}/${otherTaskId}`,
    c.token
  )
}

// --- Project Views ---

export async function fetchProjectViews(projectId: number): Promise<ApiResult<unknown[]>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestAllPagesWithRetry<unknown>(
    `${c.url}${API_BASE_PATH}/projects/${projectId}/views`,
    c.token
  )
}

export async function fetchViewTasks(
  projectId: number,
  viewId: number,
  params: Record<string, unknown>
): Promise<ApiResult<unknown[]>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const qs = createTaskCollectionSearchParams(params)

  const queryString = qs.toString()
  const fullUrl = queryString
    ? `${c.url}${API_BASE_PATH}/projects/${projectId}/views/${viewId}/tasks?${queryString}`
    : `${c.url}${API_BASE_PATH}/projects/${projectId}/views/${viewId}/tasks`

  const result = params.page
    ? requestPaginatedWithRetry<unknown>(fullUrl, c.token)
    : requestAllPagesWithRetry<unknown>(fullUrl, c.token)
  const tasks = await result
  if (!tasks.success) return tasks
  return { success: true, data: finishTaskCollection(tasks.data, params) }
}

export async function updateTaskPosition(
  taskId: number,
  viewId: number,
  position: number
): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<unknown>('PUT', `${c.url}${API_BASE_PATH}/tasks/${taskId}/position`, c.token, {
    project_view_id: viewId,
    position,
  })
}

// --- Connection Test (takes explicit url/token, not from config) ---

export function testConnection(
  url: string,
  token: string
): Promise<ApiResult<unknown[]>> {
  const cleanUrl = url.replace(/\/+$/, '')
  return request<PaginatedResponse<unknown>>(
    'GET',
    `${cleanUrl}${API_BASE_PATH}/projects`,
    token
  ).then((result): ApiResult<unknown[]> => {
    if (!result.success) return result
    return { success: true, data: result.data?.items ?? [] }
  })
}

/**
 * A task search with an explicit server and token (setup reads the synced preferences before the
 * connection is saved). One page of the server maximum; the marker searches it serves are small.
 */
export function searchTasksAt(url: string, token: string, q: string): Promise<ApiResult<unknown[]>> {
  const cleanUrl = url.replace(/\/+$/, '')
  const qs = new URLSearchParams({ q, per_page: String(MAX_PAGE_SIZE) })
  return request<PaginatedResponse<unknown>>('GET', `${cleanUrl}${API_BASE_PATH}/tasks?${qs.toString()}`, token)
    .then((result): ApiResult<unknown[]> => {
      if (!result.success) return result
      return { success: true, data: result.data?.items ?? [] }
    })
}


// --- Attachments ---

export async function fetchTaskAttachments(taskId: number): Promise<ApiResult<unknown[]>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestAllPagesWithRetry<unknown>(
    `${c.url}${API_BASE_PATH}/tasks/${taskId}/attachments`,
    c.token
  )
}

// The server's upload limit comes from the public /info endpoint. A found value is kept for ten
// minutes; when /info cannot be read the default is used and the lookup is retried after a minute.
const UPLOAD_LIMIT_TTL = 10 * 60_000
const UPLOAD_LIMIT_RETRY = 60_000
let uploadLimitCache: { baseUrl: string; bytes: number; fetchedAt: number; fromServer: boolean } | null = null

async function resolveMaxUploadBytes(baseUrl: string, token: string): Promise<number> {
  const cached = uploadLimitCache
  if (cached && cached.baseUrl === baseUrl) {
    const ttl = cached.fromServer ? UPLOAD_LIMIT_TTL : UPLOAD_LIMIT_RETRY
    if (Date.now() - cached.fetchedAt < ttl) return cached.bytes
  }
  const info = await request<{ max_file_size?: unknown }>('GET', `${baseUrl}${API_BASE_PATH}/info`, token)
  const fromServer = info.success ? parseMaxFileSize(info.data?.max_file_size) : null
  const bytes = fromServer ?? DEFAULT_MAX_UPLOAD_BYTES
  uploadLimitCache = { baseUrl, bytes, fetchedAt: Date.now(), fromServer: fromServer !== null }
  return bytes
}

/** The largest file the connected server accepts, in bytes (20 MB when it does not say). */
export async function getMaxUploadBytes(): Promise<number> {
  const c = await getConfigOrFail()
  if ('success' in c) return DEFAULT_MAX_UPLOAD_BYTES
  return resolveMaxUploadBytes(c.url, c.token)
}

/** The error for a file over the server's limit, or null; used before reading it from disk. */
export async function checkUploadSize(size: number): Promise<string | null> {
  return uploadSizeError(size, await getMaxUploadBytes())
}

export async function uploadTaskAttachment(
  taskId: number,
  fileBuffer: Uint8Array,
  fileName: string,
  mimeType: string
): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  // Over the limit: say so now instead of sending megabytes the server will refuse. Reported as
  // 422 so the offline replay drops such an upload into the failed log instead of retrying it for ever.
  const tooLarge = uploadSizeError(fileBuffer.length, await resolveMaxUploadBytes(c.url, c.token))
  if (tooLarge) return { success: false, error: tooLarge, statusCode: 422 }

  return requestMultipartWithRetry<unknown>(
    'POST',
    `${c.url}${API_BASE_PATH}/tasks/${taskId}/attachments`,
    c.token,
    fileBuffer,
    fileName,
    mimeType
  )
}

export async function deleteTaskAttachment(
  taskId: number,
  attachmentId: number
): Promise<ApiResult<void>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestWithRetry<void>(
    'DELETE',
    `${c.url}${API_BASE_PATH}/tasks/${taskId}/attachments/${attachmentId}`,
    c.token
  )
}

export async function downloadTaskAttachment(
  taskId: number,
  attachmentId: number,
  previewSize?: AttachmentPreviewSize
): Promise<ApiResult<Uint8Array>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestBinaryWithRetry(
    buildTaskAttachmentDownloadUrl(c.url, taskId, attachmentId, previewSize),
    c.token
  )
}

// --- Collaboration (docs/cross-app-semantics-v1.md section 9) ---

const TOKEN_LACKS_PERMISSION =
  'Your API token does not have this permission. In Vikunja, give the token the permissions for task comments, task assignees and project sharing, or sign in with your password instead.'
const TOKEN_CANNOT_FOLLOW = 'Vikunja does not let API tokens follow tasks. Sign in with your password to use Notify me.'

/** How long a token that read the project list counts as working without asking again. */
const TOKEN_CHECK_FRESH_MS = 60_000
let workingToken: { token: string; at: number } | null = null

/**
 * Whether an API token still reads the project list (one project). Every token the app works with
 * does, so one that passes was refused only the request that answered 401. No answer counts as
 * working: a network problem says nothing about the token. One check answers for a minute, because
 * a members refresh can be refused once per project.
 */
async function tokenReadsProjects(url: string, token: string): Promise<boolean> {
  const now = Date.now()
  if (workingToken && workingToken.token === token && now - workingToken.at < TOKEN_CHECK_FRESH_MS) return true
  const result = await request<unknown>('GET', `${url}${API_BASE_PATH}/projects?per_page=1&page=1`, token)
  const refused = !result.success && (result.statusCode === 401 || result.statusCode === 403)
  if (result.success) workingToken = { token, at: now }
  else if (refused) workingToken = null
  return !refused
}

/**
 * Whether the saved connection still works, for a change the server refused with 403 (C-2): the
 * same check `collabResult` makes, one project from the project list. `works` means only that
 * change was refused (the user lost write access to its project); `refused` means the session or
 * token itself is gone; `unknown` means the check got no answer (offline, server trouble).
 */
export async function connectionState(): Promise<'works' | 'refused' | 'unknown'> {
  const c = await getConfigOrFail()
  if ('success' in c) return 'refused'
  const now = Date.now()
  if (workingToken && workingToken.token === c.token && now - workingToken.at < TOKEN_CHECK_FRESH_MS) return 'works'
  const result = await request<unknown>('GET', `${c.url}${API_BASE_PATH}/projects?per_page=1&page=1`, c.token)
  if (result.success) {
    workingToken = { token: c.token, at: now }
    return 'works'
  }
  if (result.statusCode === 401 || result.statusCode === 403) {
    workingToken = null
    return 'refused'
  }
  return 'unknown'
}

/**
 * The answer of a collaboration endpoint, in words for the user. A 403 is about the project, not
 * the token: `forbidden` says why. An API token can lack a route group these endpoints use
 * (comments, assignees, sharing; no token may follow tasks), and Vikunja answers that with 401 like
 * an ended session. When the same token still reads the project list, only this request was refused
 * (cross-app semantics 9.7): it becomes a 403 marked `tokenPermission`, which the replay moves to
 * the failed log and the app shows with `tokenMessage` instead of "session expired".
 */
async function collabResult<T>(
  result: ApiResult<T>,
  c: Connection,
  forbidden?: string,
  tokenMessage = TOKEN_LACKS_PERMISSION,
): Promise<ApiResult<T>> {
  if (result.success) return result
  if (result.statusCode === 403 && forbidden) return { ...result, error: forbidden }
  if (result.statusCode === 401 && c.apiToken && (await tokenReadsProjects(c.url, c.token))) {
    return { success: false, error: tokenMessage, statusCode: 403, errorCode: result.errorCode, tokenPermission: true }
  }
  return result
}

/** Everyone who can see a project: the owner, direct shares, team members and parent shares. */
export async function searchProjectUsers(projectId: number): Promise<ApiResult<unknown[]>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<PaginatedResponse<unknown> | unknown[]>(
    'GET',
    `${c.url}${API_BASE_PATH}/projects/${projectId}/users/search?q=`,
    c.token,
  )
  if (!result.success) return collabResult(result, c)
  return { success: true, data: envelopeItems(result.data) }
}

/** The users a project is shared with directly, each with its permission. */
export async function fetchProjectUserShares(projectId: number): Promise<ApiResult<unknown[]>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return collabResult(await requestAllPagesWithRetry<unknown>(`${c.url}${API_BASE_PATH}/projects/${projectId}/users`, c.token), c)
}

/** The teams a project is shared with, each with its permission and members. */
export async function fetchProjectTeamShares(projectId: number): Promise<ApiResult<unknown[]>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return collabResult(await requestAllPagesWithRetry<unknown>(`${c.url}${API_BASE_PATH}/projects/${projectId}/teams`, c.token), c)
}

const NOT_ADMIN = 'Only an admin of this project can change who it is shared with.'

export async function shareProjectWithUser(projectId: number, username: string, permission: number): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<unknown>('POST', `${c.url}${API_BASE_PATH}/projects/${projectId}/users`, c.token, {
    username,
    permission,
  })
  return collabResult(result, c, NOT_ADMIN)
}

export async function updateProjectUserShare(projectId: number, username: string, permission: number): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<unknown>(
    'PUT',
    `${c.url}${API_BASE_PATH}/projects/${projectId}/users/${encodeURIComponent(username)}`,
    c.token,
    { permission },
  )
  return collabResult(result, c, NOT_ADMIN)
}

export async function removeProjectUserShare(projectId: number, username: string): Promise<ApiResult<void>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<void>(
    'DELETE',
    `${c.url}${API_BASE_PATH}/projects/${projectId}/users/${encodeURIComponent(username)}`,
    c.token,
  )
  return collabResult(result, c, NOT_ADMIN)
}

/** Users matching a search: an exact username, or a name or email of someone who made themselves findable. */
export async function searchUsers(query: string): Promise<ApiResult<unknown[]>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<PaginatedResponse<unknown> | unknown[]>(
    'GET',
    `${c.url}${API_BASE_PATH}/users?q=${encodeURIComponent(query)}`,
    c.token,
  )
  if (!result.success) return collabResult(result, c)
  return { success: true, data: envelopeItems(result.data) }
}

const NO_WRITE_ACCESS = 'You can only read this project, so this was not changed.'

/** Assign a user. An already assigned user (400, code 4021) counts as done. */
export async function addTaskAssignee(taskId: number, userId: number): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<unknown>('POST', `${c.url}${API_BASE_PATH}/tasks/${taskId}/assignees`, c.token, {
    user_id: userId,
  })
  if (!result.success && result.errorCode === VIKUNJA_ERROR_ALREADY_ASSIGNED) return { success: true, data: null }
  return collabResult(result, c, NO_WRITE_ACCESS)
}

/** Unassign a user (idempotent on the server). */
export async function removeTaskAssignee(taskId: number, userId: number): Promise<ApiResult<void>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<void>('DELETE', `${c.url}${API_BASE_PATH}/tasks/${taskId}/assignees/${userId}`, c.token)
  return collabResult(result, c, NO_WRITE_ACCESS)
}

/** One page of a task's comments, newest first (the thread shows them oldest first). */
export async function fetchTaskComments(taskId: number, page: number): Promise<ApiResult<TaskCommentPage>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<PaginatedResponse<unknown> | unknown[]>(
    'GET',
    buildTaskCommentsUrl(c.url, taskId, page),
    c.token,
  )
  if (!result.success) return collabResult(result, c)
  return { success: true, data: readCommentPage(result.data, page) }
}

export async function createTaskComment(taskId: number, html: string): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<unknown>('POST', `${c.url}${API_BASE_PATH}/tasks/${taskId}/comments`, c.token, {
    comment: html,
  })
  return collabResult(result, c, NO_WRITE_ACCESS)
}

const ONLY_THE_AUTHOR = 'Only the person who wrote a comment can change or delete it.'

export async function updateTaskComment(taskId: number, commentId: number, html: string): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await patchWithRetry<unknown>(`${c.url}${API_BASE_PATH}/tasks/${taskId}/comments/${commentId}`, c.token, {
    comment: html,
  })
  return collabResult(result, c, ONLY_THE_AUTHOR)
}

export async function deleteTaskComment(taskId: number, commentId: number): Promise<ApiResult<void>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<void>('DELETE', `${c.url}${API_BASE_PATH}/tasks/${taskId}/comments/${commentId}`, c.token)
  return collabResult(result, c, ONLY_THE_AUTHOR)
}

/** Clear your unread flag on a task (idempotent). */
export async function markTaskRead(taskId: number): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return collabResult(await requestWithRetry<unknown>('PUT', `${c.url}${API_BASE_PATH}/tasks/${taskId}/read`, c.token), c)
}

/** Follow a task. Already following (412, code 12002) counts as done. */
export async function subscribeToTask(taskId: number): Promise<ApiResult<unknown>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<unknown>('POST', `${c.url}${API_BASE_PATH}/subscriptions/task/${taskId}`, c.token)
  if (!result.success && result.errorCode === VIKUNJA_ERROR_ALREADY_SUBSCRIBED) return { success: true, data: null }
  return collabResult(result, c, undefined, TOKEN_CANNOT_FOLLOW)
}

export async function unsubscribeFromTask(taskId: number): Promise<ApiResult<void>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestWithRetry<void>('DELETE', `${c.url}${API_BASE_PATH}/subscriptions/task/${taskId}`, c.token)
  return collabResult(result, c, undefined, TOKEN_CANNOT_FOLLOW)
}

/** A user's avatar as a data URL (the server answers SVG for its initials provider, else an image). */
export async function fetchAvatar(username: string, size: number): Promise<ApiResult<string>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  const result = await requestBinaryWithRetry(
    `${c.url}${API_BASE_PATH}/avatar/${encodeURIComponent(username)}?size=${Math.max(1, Math.round(size))}`,
    c.token,
  )
  if (!result.success) return result
  if (result.data.length > MAX_AVATAR_BYTES) return { success: false, error: 'The avatar is too large' }
  const type = sniffImageType(result.data)
  if (!type) return { success: false, error: 'The avatar is not an image' }
  return { success: true, data: `data:${type};base64,${bytesToBase64(result.data)}` }
}
