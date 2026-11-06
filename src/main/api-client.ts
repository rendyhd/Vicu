import { net, BrowserWindow } from 'electron'
import { loadConfig } from './config'
import { authManager } from './auth/auth-manager'
import { getAPIToken } from './auth/token-store'
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
import type { ApiError, ApiResult } from './api-result'
import { collectAllPages } from './paginate'
import { decodeUtf8Chunks } from './response-body'
import { MAX_BINARY_DOWNLOAD_BYTES, describeDownloadLimit, parseContentLength } from './attachment-safety'
import { buildMultipartBody } from './multipart'
import { vikunjaUserAgent } from './user-agent'
import { createIdleTimeout } from './idle-timeout'
import { DEFAULT_MAX_UPLOAD_BYTES, parseMaxFileSize, uploadSizeError, uploadTimeoutMs } from './upload-limits'

/**
 * Send 'auth-required' IPC event to all renderer windows.
 */
function notifyAuthRequired(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send('auth-required')
      }
    } catch { /* ignore */ }
  }
}

const REQUEST_TIMEOUT = 10_000
// A download is cut off after this long WITHOUT data, not after this long in total, so a large file
// on a slow link still arrives as long as it keeps moving (D-API-3).
const DOWNLOAD_IDLE_TIMEOUT = 60_000
const API_BASE_PATH = '/api/v2'
const JSON_MERGE_PATCH = 'application/merge-patch+json'
const JSON_PATCH = 'application/json-patch+json'

// Friendly error overrides for known unhelpful server messages
const FRIENDLY_ERROR_OVERRIDES: { pattern: RegExp; message: string }[] = [
  {
    pattern: /missing,?\s*malformed,?\s*expired\s*or\s*otherwise\s*invalid\s*token/i,
    message:
      'API token is invalid or expired. Generate a new token in Vikunja (Settings > API Tokens).',
  },
  {
    pattern: /token.*(?:lacks?|insufficient|no)\s*permission/i,
    message:
      'API token has insufficient permissions. Create a new token with read/write access to tasks and projects.',
  },
]

function getFriendlyError(serverMessage: string): string | null {
  for (const { pattern, message } of FRIENDLY_ERROR_OVERRIDES) {
    if (pattern.test(serverMessage)) return message
  }
  return null
}

function describeHttpError(statusCode: number, responseBody: string): string {
  let serverMessage: string | null = null
  try {
    const parsed = JSON.parse(responseBody)
    if (parsed.detail) {
      serverMessage = parsed.detail
    } else if (parsed.message) {
      serverMessage = parsed.message
    } else if (parsed.title) {
      serverMessage = parsed.title
    }
  } catch {
    // fall through
  }

  if (serverMessage) {
    const friendly = getFriendlyError(serverMessage)
    if (friendly) return friendly
  }

  switch (statusCode) {
    case 401:
      return 'API token is invalid or expired. Check Settings or generate a new token in Vikunja.'
    case 403:
      return 'API token lacks permission. Ensure your token has read/write access to tasks and projects.'
    case 404:
      return 'Not found — the task or project may have been deleted.'
    default:
      if (serverMessage) return serverMessage
      if (statusCode >= 500) return 'Server error — Vikunja may be experiencing issues.'
      return `HTTP ${statusCode}`
  }
}

function validateHttpUrl(url: string): { valid: true; parsed: URL } | { valid: false; error: string } {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Only HTTP(S) URLs are supported' }
    }
    return { valid: true, parsed }
  } catch {
    return { valid: false, error: 'Invalid URL' }
  }
}

function request<T>(
  method: string,
  url: string,
  token: string,
  body?: unknown,
  contentType = 'application/json'
): Promise<ApiResult<T>> {
  const validation = validateHttpUrl(url)
  if (!validation.valid) {
    return Promise.resolve({ success: false, error: validation.error })
  }

  return new Promise((resolve) => {
    let req: Electron.ClientRequest | null = null
    const timeout = setTimeout(() => {
      try { req?.abort() } catch { /* ignore */ }
      resolve({ success: false, error: `Request timed out (${REQUEST_TIMEOUT / 1000}s)` })
    }, REQUEST_TIMEOUT)

    try {
      req = net.request({ method, url })

      req.setHeader('Authorization', `Bearer ${token}`)
      req.setHeader('Content-Type', contentType)
      req.setHeader('User-Agent', vikunjaUserAgent())

      const bodyChunks: Buffer[] = []
      let statusCode = 0

      req.on('response', (response) => {
        statusCode = response.statusCode

        response.on('data', (chunk) => {
          bodyChunks.push(Buffer.from(chunk))
        })

        response.on('end', () => {
          clearTimeout(timeout)
          const responseBody = decodeUtf8Chunks(bodyChunks)

          if (statusCode >= 200 && statusCode < 300) {
            try {
              const data = JSON.parse(responseBody) as T
              resolve({ success: true, data })
            } catch {
              resolve({ success: true, data: null as T })
            }
          } else {
            let errorCode: number | undefined
            try {
              const parsed = JSON.parse(responseBody)
              if (typeof parsed.code === 'number') errorCode = parsed.code
            } catch { /* ignore */ }
            resolve({
              success: false,
              error: describeHttpError(statusCode, responseBody),
              statusCode,
              errorCode,
            })
          }
        })
      })

      req.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, error: err.message || 'Network error' })
      })

      if (body !== undefined) {
        req.write(JSON.stringify(body))
      }
      req.end()
    } catch (err: unknown) {
      clearTimeout(timeout)
      const message = err instanceof Error ? err.message : 'Request failed'
      resolve({ success: false, error: message })
    }
  })
}

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
      const newToken = await authManager.getToken()
      return await request<T>(method, url, newToken, body, contentType)
    } catch {
      return result
    }
  }

  return result
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
  return { success: true, data: result.data.items ?? [] }
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
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<ApiResult<T>> {
  const result = await requestMultipart<T>(method, url, token, fileBuffer, fileName, mimeType)

  if (!result.success && isExpiredTokenError(result)) {
    try {
      const newToken = await authManager.getToken()
      return await requestMultipart<T>(method, url, newToken, fileBuffer, fileName, mimeType)
    } catch {
      return result
    }
  }

  return result
}

async function requestBinaryWithRetry(
  url: string,
  token: string
): Promise<ApiResult<Buffer>> {
  const result = await requestBinary(url, token)

  if (!result.success && isExpiredTokenError(result)) {
    try {
      const newToken = await authManager.getToken()
      return await requestBinary(url, newToken)
    } catch {
      return result
    }
  }

  return result
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
    const syncToken = authManager.getTokenSync()
    if (syncToken) return { url: config.vikunja_url, token: syncToken, apiToken: false }

    // Slow path: async recovery (refresh token / silent reauth)
    try {
      const asyncToken = await authManager.getToken()
      return { url: config.vikunja_url, token: asyncToken, apiToken: false }
    } catch {
      notifyAuthRequired()
      return { success: false, error: 'Session expired. Please sign in again.' }
    }
  }

  // API token path — prefer encrypted store, fall back to config (pre-migration)
  const token = getAPIToken() || config.api_token
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

export async function fetchProjects(includeArchived = false): Promise<ApiResult<unknown[]>> {
  const c = await getConfigOrFail()
  if ('success' in c) return c

  return requestAllPagesWithRetry<unknown>(
    buildProjectCollectionUrl(c.url, includeArchived),
    c.token,
  )
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
    return { success: true, data: result.data.items ?? [] }
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
      return { success: true, data: result.data.items ?? [] }
    })
}

// --- Attachments ---

function requestMultipart<T>(
  method: string,
  url: string,
  token: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<ApiResult<T>> {
  const validation = validateHttpUrl(url)
  if (!validation.valid) {
    return Promise.resolve({ success: false, error: validation.error })
  }

  return new Promise((resolve) => {
    let req: Electron.ClientRequest | null = null
    // The time allowed grows with the file, so a file the server accepts is not cut off on a slow link.
    const uploadTimeout = uploadTimeoutMs(fileBuffer.length)
    const timeout = setTimeout(() => {
      try { req?.abort() } catch { /* ignore */ }
      resolve({ success: false, error: `Upload timed out (${Math.round(uploadTimeout / 1000)}s)` })
    }, uploadTimeout)

    try {
      const boundary = `----ViCU${Date.now()}${Math.random().toString(36).slice(2)}`
      // The file name and type are escaped inside buildMultipartBody (D-API-3).
      const body = buildMultipartBody({ boundary, fieldName: 'files', fileName, mimeType, file: fileBuffer })

      req = net.request({ method, url })
      req.setHeader('Authorization', `Bearer ${token}`)
      req.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)
      req.setHeader('User-Agent', vikunjaUserAgent())
      // Content-Length is a forbidden header in Chromium's network stack —
      // Electron's net.request rejects it with ERR_INVALID_ARGUMENT.
      // Chromium calculates it automatically from the body.

      const bodyChunks: Buffer[] = []
      let statusCode = 0

      req.on('response', (response) => {
        statusCode = response.statusCode

        response.on('data', (chunk) => {
          bodyChunks.push(Buffer.from(chunk))
        })

        response.on('end', () => {
          clearTimeout(timeout)
          const responseBody = decodeUtf8Chunks(bodyChunks)
          if (statusCode >= 200 && statusCode < 300) {
            try {
              const data = JSON.parse(responseBody) as T
              resolve({ success: true, data })
            } catch {
              resolve({ success: true, data: null as T })
            }
          } else {
            console.error(`[upload] HTTP ${statusCode} for ${method} ${url}:`, responseBody)
            let errorCode: number | undefined
            try {
              const parsed = JSON.parse(responseBody)
              if (typeof parsed.code === 'number') errorCode = parsed.code
            } catch { /* ignore */ }
            resolve({
              success: false,
              error: describeHttpError(statusCode, responseBody),
              statusCode,
              errorCode,
            })
          }
        })
      })

      req.on('error', (err) => {
        clearTimeout(timeout)
        console.error(`[upload] Network error for ${method} ${url}:`, err.message)
        resolve({ success: false, error: err.message || 'Upload failed' })
      })

      // Send complete body in one call to avoid chunked transfer issues
      req.end(body)
    } catch (err: unknown) {
      clearTimeout(timeout)
      const message = err instanceof Error ? err.message : 'Upload failed'
      resolve({ success: false, error: message })
    }
  })
}

function requestBinary(
  url: string,
  token: string
): Promise<ApiResult<Buffer>> {
  const validation = validateHttpUrl(url)
  if (!validation.valid) {
    return Promise.resolve({ success: false, error: validation.error })
  }

  return new Promise((resolve) => {
    let req: Electron.ClientRequest | null = null
    // Restarted by every sign of life (response headers, each chunk), so only a stalled transfer times out.
    const idle = createIdleTimeout(DOWNLOAD_IDLE_TIMEOUT, () => {
      try { req?.abort() } catch { /* ignore */ }
      resolve({ success: false, error: `Download timed out (no data for ${DOWNLOAD_IDLE_TIMEOUT / 1000}s)` })
    })

    try {
      req = net.request({ method: 'GET', url })
      req.setHeader('Authorization', `Bearer ${token}`)
      req.setHeader('User-Agent', vikunjaUserAgent())

      const chunks: Buffer[] = []
      let statusCode = 0
      let receivedBytes = 0
      let tooLarge = false

      const rejectTooLarge = (): void => {
        if (tooLarge) return
        tooLarge = true
        chunks.length = 0
        idle.clear()
        try { req?.abort() } catch { /* ignore */ }
        resolve({ success: false, error: describeDownloadLimit(MAX_BINARY_DOWNLOAD_BYTES) })
      }

      req.on('response', (response) => {
        idle.touch()
        statusCode = response.statusCode

        // Refuse oversized downloads up front when the server declares a length,
        // and again while streaming in case it did not (D-IPC-2).
        const declaredLength = parseContentLength(response.headers['content-length'])
        if (declaredLength !== null && declaredLength > MAX_BINARY_DOWNLOAD_BYTES) {
          rejectTooLarge()
          return
        }

        response.on('data', (chunk) => {
          if (tooLarge) return
          idle.touch()
          receivedBytes += chunk.length
          if (receivedBytes > MAX_BINARY_DOWNLOAD_BYTES) {
            rejectTooLarge()
            return
          }
          chunks.push(Buffer.from(chunk))
        })

        response.on('end', () => {
          if (tooLarge) return
          idle.clear()
          if (statusCode >= 200 && statusCode < 300) {
            resolve({ success: true, data: Buffer.concat(chunks) })
          } else {
            const body = decodeUtf8Chunks(chunks)
            let errorCode: number | undefined
            try {
              const parsed = JSON.parse(body)
              if (typeof parsed.code === 'number') errorCode = parsed.code
            } catch { /* ignore */ }
            resolve({
              success: false,
              error: describeHttpError(statusCode, body),
              statusCode,
              errorCode,
            })
          }
        })
      })

      req.on('error', (err) => {
        idle.clear()
        resolve({ success: false, error: err.message || 'Download failed' })
      })

      req.end()
    } catch (err: unknown) {
      idle.clear()
      const message = err instanceof Error ? err.message : 'Download failed'
      resolve({ success: false, error: message })
    }
  })
}

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
  fileBuffer: Buffer,
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
): Promise<ApiResult<Buffer>> {
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
  return { success: true, data: `data:${type};base64,${result.data.toString('base64')}` }
}
