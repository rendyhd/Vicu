import { net } from 'electron'
import { loadConfig } from './config'
import { authManager } from './auth/auth-manager'

const REQUEST_TIMEOUT = 10_000
const UPLOAD_TIMEOUT = 60_000

interface ApiSuccess<T> {
  success: true
  data: T
}

interface ApiError {
  success: false
  error: string
}

type ApiResult<T> = ApiSuccess<T> | ApiError

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
    if (parsed.message) serverMessage = parsed.message
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
  body?: unknown
): Promise<ApiResult<T>> {
  const validation = validateHttpUrl(url)
  if (!validation.valid) {
    return Promise.resolve({ success: false, error: validation.error })
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, error: `Request timed out (${REQUEST_TIMEOUT / 1000}s)` })
    }, REQUEST_TIMEOUT)

    try {
      const req = net.request({ method, url })

      req.setHeader('Authorization', `Bearer ${token}`)
      req.setHeader('Content-Type', 'application/json')

      let responseBody = ''
      let statusCode = 0

      req.on('response', (response) => {
        statusCode = response.statusCode

        response.on('data', (chunk) => {
          responseBody += chunk.toString()
        })

        response.on('end', () => {
          clearTimeout(timeout)

          if (statusCode >= 200 && statusCode < 300) {
            try {
              const data = JSON.parse(responseBody) as T
              resolve({ success: true, data })
            } catch {
              resolve({ success: true, data: null as T })
            }
          } else {
            resolve({ success: false, error: describeHttpError(statusCode, responseBody) })
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

function getConfigOrFail(): { url: string; token: string } | ApiError {
  const config = loadConfig()
  if (!config || !config.vikunja_url) {
    return { success: false, error: 'Vikunja is not configured. Open Settings to connect.' }
  }

  if (config.auth_method === 'oidc' || config.auth_method === 'password') {
    const token = authManager.getTokenSync()
    if (!token) {
      return { success: false, error: 'Session expired. Please sign in again.' }
    }
    return { url: config.vikunja_url, token }
  }

  // API token path
  if (!config.api_token) {
    return { success: false, error: 'Vikunja is not configured. Open Settings to connect.' }
  }
  return { url: config.vikunja_url, token: config.api_token }
}

// --- Tasks ---

export function fetchTasks(params: Record<string, unknown>): Promise<ApiResult<unknown[]>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  const qs = new URLSearchParams()
  if (params.s) qs.set('s', String(params.s))
  if (params.filter) qs.set('filter', String(params.filter))
  if (params.sort_by) qs.set('sort_by', String(params.sort_by))
  if (params.order_by) qs.set('order_by', String(params.order_by))
  if (params.per_page) qs.set('per_page', String(params.per_page))
  if (params.page) qs.set('page', String(params.page))
  if (params.filter_include_nulls) qs.set('filter_include_nulls', String(params.filter_include_nulls))
  if (params.filter_timezone) qs.set('filter_timezone', String(params.filter_timezone))

  const queryString = qs.toString()
  const fullUrl = queryString
    ? `${c.url}/api/v1/tasks?${queryString}`
    : `${c.url}/api/v1/tasks`

  return request<unknown[]>('GET', fullUrl, c.token)
}

export function createTask(
  projectId: number,
  task: Record<string, unknown>
): Promise<ApiResult<unknown>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown>('PUT', `${c.url}/api/v1/projects/${projectId}/tasks`, c.token, task)
}

// CRITICAL: Go zero-value problem — always send the complete task object on update.
// Sending only changed fields (e.g. { done: true }) will zero out due_date, priority, etc.
export function updateTask(
  id: number,
  task: Record<string, unknown>
): Promise<ApiResult<unknown>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown>('POST', `${c.url}/api/v1/tasks/${id}`, c.token, task)
}

export function deleteTask(id: number): Promise<ApiResult<void>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<void>('DELETE', `${c.url}/api/v1/tasks/${id}`, c.token)
}

// --- Projects ---

export function fetchProjects(): Promise<ApiResult<unknown[]>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown[]>('GET', `${c.url}/api/v1/projects`, c.token)
}

export function createProject(project: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown>('PUT', `${c.url}/api/v1/projects`, c.token, project)
}

export function updateProject(
  id: number,
  project: Record<string, unknown>
): Promise<ApiResult<unknown>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown>('POST', `${c.url}/api/v1/projects/${id}`, c.token, project)
}

export function deleteProject(id: number): Promise<ApiResult<void>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<void>('DELETE', `${c.url}/api/v1/projects/${id}`, c.token)
}

// --- Labels ---

export function fetchLabels(): Promise<ApiResult<unknown[]>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown[]>('GET', `${c.url}/api/v1/labels`, c.token)
}

export function addLabelToTask(taskId: number, labelId: number): Promise<ApiResult<void>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<void>(
    'PUT',
    `${c.url}/api/v1/tasks/${taskId}/labels`,
    c.token,
    { label_id: labelId }
  )
}

export function removeLabelFromTask(taskId: number, labelId: number): Promise<ApiResult<void>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<void>('DELETE', `${c.url}/api/v1/tasks/${taskId}/labels/${labelId}`, c.token)
}

export function createLabel(label: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown>('PUT', `${c.url}/api/v1/labels`, c.token, label)
}

export function updateLabel(
  id: number,
  label: Record<string, unknown>
): Promise<ApiResult<unknown>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown>('PUT', `${c.url}/api/v1/labels/${id}`, c.token, label)
}

export function deleteLabel(id: number): Promise<ApiResult<void>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<void>('DELETE', `${c.url}/api/v1/labels/${id}`, c.token)
}

// --- Single Task ---

export function fetchTaskById(id: number): Promise<ApiResult<unknown>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown>('GET', `${c.url}/api/v1/tasks/${id}`, c.token)
}

// --- Task Relations ---

export function createTaskRelation(
  taskId: number,
  otherTaskId: number,
  relationKind: string
): Promise<ApiResult<unknown>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown>('PUT', `${c.url}/api/v1/tasks/${taskId}/relations`, c.token, {
    other_task_id: otherTaskId,
    relation_kind: relationKind,
  })
}

export function deleteTaskRelation(
  taskId: number,
  relationKind: string,
  otherTaskId: number
): Promise<ApiResult<void>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<void>(
    'DELETE',
    `${c.url}/api/v1/tasks/${taskId}/relations/${relationKind}/${otherTaskId}`,
    c.token
  )
}

// --- Project Views ---

export function fetchProjectViews(projectId: number): Promise<ApiResult<unknown[]>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown[]>('GET', `${c.url}/api/v1/projects/${projectId}/views`, c.token)
}

export function fetchViewTasks(
  projectId: number,
  viewId: number,
  params: Record<string, unknown>
): Promise<ApiResult<unknown[]>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  const qs = new URLSearchParams()
  if (params.filter) qs.set('filter', String(params.filter))
  if (params.sort_by) qs.set('sort_by', String(params.sort_by))
  if (params.order_by) qs.set('order_by', String(params.order_by))
  if (params.per_page) qs.set('per_page', String(params.per_page))
  if (params.page) qs.set('page', String(params.page))
  if (params.filter_include_nulls) qs.set('filter_include_nulls', String(params.filter_include_nulls))
  if (params.filter_timezone) qs.set('filter_timezone', String(params.filter_timezone))

  const queryString = qs.toString()
  const fullUrl = queryString
    ? `${c.url}/api/v1/projects/${projectId}/views/${viewId}/tasks?${queryString}`
    : `${c.url}/api/v1/projects/${projectId}/views/${viewId}/tasks`

  return request<unknown[]>('GET', fullUrl, c.token)
}

export function updateTaskPosition(
  taskId: number,
  viewId: number,
  position: number
): Promise<ApiResult<unknown>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown>('POST', `${c.url}/api/v1/tasks/${taskId}/position`, c.token, {
    task_id: taskId,
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
  return request<unknown[]>('GET', `${cleanUrl}/api/v1/projects`, token)
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
    const timeout = setTimeout(() => {
      resolve({ success: false, error: `Upload timed out (${UPLOAD_TIMEOUT / 1000}s)` })
    }, UPLOAD_TIMEOUT)

    try {
      const boundary = `----ViCU${Date.now()}${Math.random().toString(36).slice(2)}`
      const header = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
      )
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
      const body = Buffer.concat([header, fileBuffer, footer])

      const req = net.request({ method, url })
      req.setHeader('Authorization', `Bearer ${token}`)
      req.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)
      // Content-Length is a forbidden header in Chromium's network stack —
      // Electron's net.request rejects it with ERR_INVALID_ARGUMENT.
      // Chromium calculates it automatically from the body.

      let responseBody = ''
      let statusCode = 0

      req.on('response', (response) => {
        statusCode = response.statusCode

        response.on('data', (chunk) => {
          responseBody += chunk.toString()
        })

        response.on('end', () => {
          clearTimeout(timeout)
          if (statusCode >= 200 && statusCode < 300) {
            try {
              const data = JSON.parse(responseBody) as T
              resolve({ success: true, data })
            } catch {
              resolve({ success: true, data: null as T })
            }
          } else {
            console.error(`[upload] HTTP ${statusCode} for ${method} ${url}:`, responseBody)
            resolve({ success: false, error: describeHttpError(statusCode, responseBody) })
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
    const timeout = setTimeout(() => {
      resolve({ success: false, error: `Download timed out (${UPLOAD_TIMEOUT / 1000}s)` })
    }, UPLOAD_TIMEOUT)

    try {
      const req = net.request({ method: 'GET', url })
      req.setHeader('Authorization', `Bearer ${token}`)

      const chunks: Buffer[] = []
      let statusCode = 0

      req.on('response', (response) => {
        statusCode = response.statusCode

        response.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk))
        })

        response.on('end', () => {
          clearTimeout(timeout)
          if (statusCode >= 200 && statusCode < 300) {
            resolve({ success: true, data: Buffer.concat(chunks) })
          } else {
            const body = Buffer.concat(chunks).toString()
            resolve({ success: false, error: describeHttpError(statusCode, body) })
          }
        })
      })

      req.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, error: err.message || 'Download failed' })
      })

      req.end()
    } catch (err: unknown) {
      clearTimeout(timeout)
      const message = err instanceof Error ? err.message : 'Download failed'
      resolve({ success: false, error: message })
    }
  })
}

export function fetchTaskAttachments(taskId: number): Promise<ApiResult<unknown[]>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<unknown[]>('GET', `${c.url}/api/v1/tasks/${taskId}/attachments`, c.token)
}

export function uploadTaskAttachment(
  taskId: number,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<ApiResult<unknown>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return requestMultipart<unknown>(
    'PUT',
    `${c.url}/api/v1/tasks/${taskId}/attachments`,
    c.token,
    fileBuffer,
    fileName,
    mimeType
  )
}

export function deleteTaskAttachment(
  taskId: number,
  attachmentId: number
): Promise<ApiResult<void>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return request<void>(
    'DELETE',
    `${c.url}/api/v1/tasks/${taskId}/attachments/${attachmentId}`,
    c.token
  )
}

export function downloadTaskAttachment(
  taskId: number,
  attachmentId: number
): Promise<ApiResult<Buffer>> {
  const c = getConfigOrFail()
  if ('success' in c) return Promise.resolve(c)

  return requestBinary(
    `${c.url}/api/v1/tasks/${taskId}/attachments/${attachmentId}`,
    c.token
  )
}
