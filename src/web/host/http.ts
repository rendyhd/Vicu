import { answerCutOffMessage } from '../../shared/error-classify'
import type { ApiResult } from '../../main/api-result'
import { readErrorAnswer, readSuccessBody, validateHttpUrl } from '../../main/api-answers'
import { MAX_BINARY_DOWNLOAD_BYTES, describeDownloadLimit, parseContentLength } from '../../main/attachment-safety'
import { createIdleTimeout } from '../../main/idle-timeout'
import { uploadTimeoutMs } from '../../main/upload-limits'

// `@host/http`, the web side: the three transports of the Vikunja client and `hostFetch`, over the
// browser's `fetch`. Answers are read by the same api-answers.ts as on the desktop, and a failure
// reads as the same sentences where the browser can tell what happened.
//
// It cannot always tell. A browser's `fetch` rejects with one error for a refused connection, a bad
// certificate and a request that was sent and then lost, so a failure before the answer began is
// only "the server could not be reached": retriable, and never proof that nothing was sent (a
// failed create then says the task may exist). The one exception is a browser that reports being
// offline: then nothing left the machine.

/** What `hostFetch` takes: the small part of `fetch` the app's own reads use. */
export interface HostFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

/** A plain fetch for the small reads made outside the client (who the signed-in user is). */
export function hostFetch(url: string, init: HostFetchInit = {}): Promise<Response> {
  return fetch(url, { ...init, cache: 'no-store', credentials: 'same-origin' })
}

// The same limits as the desktop transport (src/main/host/http.ts).
const REQUEST_IDLE_TIMEOUT = 10_000
const DOWNLOAD_IDLE_TIMEOUT = 60_000

/** Said when the browser itself reports no connection: `isConnectionError` reads it as "never sent". */
const OFFLINE_MESSAGE = 'Not connected (net::ERR_INTERNET_DISCONNECTED)'
/** Said when a request failed before any answer: `isRetriableError` reads it, `isConnectionError` does not. */
const UNREACHABLE_MESSAGE = 'Network error: the server could not be reached'

function beforeAnswerMessage(): string {
  return typeof navigator !== 'undefined' && navigator.onLine === false ? OFFLINE_MESSAGE : UNREACHABLE_MESSAGE
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** Read a body to the end, saying so at every chunk; `null` once it passes `maxBytes`. */
async function readBody(response: Response, onData: () => void, maxBytes?: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader()
  if (!reader) {
    const whole = new Uint8Array(await response.arrayBuffer())
    return maxBytes !== undefined && whole.length > maxBytes ? null : whole
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    onData()
    total += value.length
    if (maxBytes !== undefined && total > maxBytes) {
      void reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const whole = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    whole.set(chunk, at)
    at += chunk.length
  }
  return whole
}

const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes)

export async function request<T>(
  method: string,
  url: string,
  token: string,
  body?: unknown,
  contentType = 'application/json'
): Promise<ApiResult<T>> {
  const validation = validateHttpUrl(url)
  if (!validation.valid) return { success: false, error: validation.error }

  const controller = new AbortController()
  let timedOut = false
  // A limit on time without data (connecting included), not on the whole answer.
  const idle = createIdleTimeout(REQUEST_IDLE_TIMEOUT, () => {
    timedOut = true
    controller.abort()
  })
  let answered = false
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      // The API's answers are never served from the browser's cache.
      cache: 'no-store',
      credentials: 'same-origin',
    })
    answered = true
    idle.touch()
    const bytes = (await readBody(response, () => idle.touch())) ?? new Uint8Array()
    idle.clear()
    const text = decode(bytes)
    return response.status >= 200 && response.status < 300 ? readSuccessBody<T>(text) : readErrorAnswer(response.status, text)
  } catch (err) {
    idle.clear()
    if (timedOut) return { success: false, error: `Request timed out (no answer for ${REQUEST_IDLE_TIMEOUT / 1000}s)` }
    return { success: false, error: answered ? answerCutOffMessage(errorText(err, 'Network error')) : beforeAnswerMessage() }
  }
}

export async function requestMultipart<T>(
  method: string,
  url: string,
  token: string,
  fileBuffer: Uint8Array,
  fileName: string,
  mimeType: string
): Promise<ApiResult<T>> {
  const validation = validateHttpUrl(url)
  if (!validation.valid) return { success: false, error: validation.error }

  const controller = new AbortController()
  let timedOut = false
  // The time allowed grows with the file, so a file the server accepts is not cut off on a slow link.
  const uploadTimeout = uploadTimeoutMs(fileBuffer.length)
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, uploadTimeout)
  let answered = false
  try {
    const form = new FormData()
    // The browser writes the multipart body, the boundary and the escaped file name itself.
    form.append('files', new Blob([fileBuffer.slice()], { type: mimeType }), fileName)
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    })
    answered = true
    const text = decode((await readBody(response, () => {})) ?? new Uint8Array())
    clearTimeout(timer)
    return response.status >= 200 && response.status < 300 ? readSuccessBody<T>(text) : readErrorAnswer(response.status, text)
  } catch (err) {
    clearTimeout(timer)
    if (timedOut) return { success: false, error: `Upload timed out (${Math.round(uploadTimeout / 1000)}s)` }
    return { success: false, error: answered ? answerCutOffMessage(errorText(err, 'Upload failed')) : beforeAnswerMessage() }
  }
}

export async function requestBinary(url: string, token: string): Promise<ApiResult<Uint8Array>> {
  const validation = validateHttpUrl(url)
  if (!validation.valid) return { success: false, error: validation.error }

  const controller = new AbortController()
  let timedOut = false
  // Restarted by every sign of life (response headers, each chunk), so only a stalled transfer times out.
  const idle = createIdleTimeout(DOWNLOAD_IDLE_TIMEOUT, () => {
    timedOut = true
    controller.abort()
  })
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    })
    idle.touch()
    // Refuse oversized downloads up front when the server declares a length, and again while
    // reading in case it did not.
    const declared = parseContentLength(response.headers.get('content-length') ?? undefined)
    if (declared !== null && declared > MAX_BINARY_DOWNLOAD_BYTES) {
      idle.clear()
      controller.abort()
      return { success: false, error: describeDownloadLimit(MAX_BINARY_DOWNLOAD_BYTES) }
    }
    const bytes = await readBody(response, () => idle.touch(), MAX_BINARY_DOWNLOAD_BYTES)
    idle.clear()
    if (bytes === null) {
      controller.abort()
      return { success: false, error: describeDownloadLimit(MAX_BINARY_DOWNLOAD_BYTES) }
    }
    if (response.status >= 200 && response.status < 300) return { success: true, data: bytes }
    return readErrorAnswer(response.status, decode(bytes))
  } catch (err) {
    idle.clear()
    if (timedOut) return { success: false, error: `Download timed out (no data for ${DOWNLOAD_IDLE_TIMEOUT / 1000}s)` }
    // A read, so a cut-off answer needs no message of its own.
    return { success: false, error: errorText(err, 'Download failed') }
  }
}
