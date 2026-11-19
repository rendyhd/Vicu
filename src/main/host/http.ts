import { net } from 'electron'
import { answerCutOffMessage } from '../../shared/error-classify'
import type { ApiResult } from '../api-result'
import { readErrorAnswer, readSuccessBody, validateHttpUrl } from '../api-answers'
import { decodeUtf8Chunks } from '../response-body'
import { MAX_BINARY_DOWNLOAD_BYTES, describeDownloadLimit, parseContentLength } from '../attachment-safety'
import { buildMultipartBody } from '../multipart'
import { vikunjaUserAgent } from '../user-agent'
import { createIdleTimeout } from '../idle-timeout'
import { uploadTimeoutMs } from '../upload-limits'

// The Electron transport of the Vikunja client (`@host/http`): Chromium's network stack through
// `net.request`, so the system proxy and certificates apply. The web build swaps this module for
// src/web/host/http.ts, which does the same three jobs with `fetch`. Both answer an `ApiResult`
// read by api-answers.ts.

// A request fails after this long WITHOUT data (connecting, waiting for the answer, or between two
// chunks of it), not after this long in total (C-11).
const REQUEST_IDLE_TIMEOUT = 10_000
// A download is cut off after this long WITHOUT data, not after this long in total, so a large file
// on a slow link still arrives as long as it keeps moving (D-API-3).
const DOWNLOAD_IDLE_TIMEOUT = 60_000

export function request<T>(
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
    // A limit on time without data (connecting included), not on the whole answer: a page of 1,000
    // tasks from a slow server keeps arriving as long as it moves (C-11). "timed out" is what
    // `isRetriableError` looks for.
    const idle = createIdleTimeout(REQUEST_IDLE_TIMEOUT, () => {
      try { req?.abort() } catch { /* ignore */ }
      resolve({ success: false, error: `Request timed out (no answer for ${REQUEST_IDLE_TIMEOUT / 1000}s)` })
    })

    try {
      req = net.request({ method, url })

      req.setHeader('Authorization', `Bearer ${token}`)
      req.setHeader('Content-Type', contentType)
      req.setHeader('User-Agent', vikunjaUserAgent())

      const bodyChunks: Buffer[] = []
      let statusCode = 0
      let answered = false

      // A network error after the answer began reaches both the request and the response (Electron
      // destroys the response with it); either way the request settles once. After the headers it
      // says the server got the request, so it is not a connection error (`answerCutOffMessage`).
      const fail = (err: Error): void => {
        idle.clear()
        const message = err.message || 'Network error'
        resolve({ success: false, error: answered ? answerCutOffMessage(message) : message })
      }

      req.on('response', (response) => {
        idle.touch()
        answered = true
        statusCode = response.statusCode

        // Without a listener the response's error is an uncaught exception in main (the
        // "JavaScript error occurred in the main process" dialog on ERR_NETWORK_CHANGED).
        response.on('error', fail)

        response.on('data', (chunk) => {
          idle.touch()
          bodyChunks.push(Buffer.from(chunk))
        })

        response.on('end', () => {
          idle.clear()
          const responseBody = decodeUtf8Chunks(bodyChunks)

          if (statusCode >= 200 && statusCode < 300) {
            resolve(readSuccessBody<T>(responseBody))
          } else {
            resolve(readErrorAnswer(statusCode, responseBody))
          }
        })
      })

      req.on('error', fail)

      if (body !== undefined) {
        req.write(JSON.stringify(body))
      }
      req.end()
    } catch (err: unknown) {
      idle.clear()
      const message = err instanceof Error ? err.message : 'Request failed'
      resolve({ success: false, error: message })
    }
  })
}

export function requestMultipart<T>(
  method: string,
  url: string,
  token: string,
  fileBuffer: Uint8Array,
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
      const body = buildMultipartBody({ boundary, fieldName: 'files', fileName, mimeType, file: Buffer.from(fileBuffer) })

      req = net.request({ method, url })
      req.setHeader('Authorization', `Bearer ${token}`)
      req.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)
      req.setHeader('User-Agent', vikunjaUserAgent())
      // Content-Length is a forbidden header in Chromium's network stack —
      // Electron's net.request rejects it with ERR_INVALID_ARGUMENT.
      // Chromium calculates it automatically from the body.

      const bodyChunks: Buffer[] = []
      let statusCode = 0
      let answered = false

      // Settles once, from the request or the response (see `request`).
      const fail = (err: Error): void => {
        clearTimeout(timeout)
        console.error(`[upload] Network error for ${method} ${url}:`, err.message)
        const message = err.message || 'Upload failed'
        resolve({ success: false, error: answered ? answerCutOffMessage(message) : message })
      }

      req.on('response', (response) => {
        answered = true
        statusCode = response.statusCode
        response.on('error', fail)

        response.on('data', (chunk) => {
          bodyChunks.push(Buffer.from(chunk))
        })

        response.on('end', () => {
          clearTimeout(timeout)
          const responseBody = decodeUtf8Chunks(bodyChunks)
          if (statusCode >= 200 && statusCode < 300) {
            resolve(readSuccessBody<T>(responseBody))
          } else {
            console.error(`[upload] HTTP ${statusCode} for ${method} ${url}:`, responseBody)
            resolve(readErrorAnswer(statusCode, responseBody))
          }
        })
      })

      req.on('error', fail)

      // Send complete body in one call to avoid chunked transfer issues
      req.end(body)
    } catch (err: unknown) {
      clearTimeout(timeout)
      const message = err instanceof Error ? err.message : 'Upload failed'
      resolve({ success: false, error: message })
    }
  })
}

export function requestBinary(
  url: string,
  token: string
): Promise<ApiResult<Uint8Array>> {
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

      // Settles once, from the request or the response (see `request`). A read, so a cut-off answer
      // needs no message of its own.
      const fail = (err: Error): void => {
        idle.clear()
        resolve({ success: false, error: err.message || 'Download failed' })
      }

      req.on('response', (response) => {
        idle.touch()
        statusCode = response.statusCode
        response.on('error', fail)

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
            resolve(readErrorAnswer(statusCode, decodeUtf8Chunks(chunks)))
          }
        })
      })

      req.on('error', fail)

      req.end()
    } catch (err: unknown) {
      idle.clear()
      const message = err instanceof Error ? err.message : 'Download failed'
      resolve({ success: false, error: message })
    }
  })
}
