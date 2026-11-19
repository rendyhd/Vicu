import { NOT_API_RESPONSE_MESSAGE, isNotApiErrorAnswer, notApiErrorMessage } from '../shared/error-classify'
import type { ApiError, ApiResult } from './api-result'

// How an HTTP answer of the Vikunja server reads as an `ApiResult`. Pure, so the Electron
// transport (host/http.ts) and the browser one (src/web/host/http.ts) read answers the same way.

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

export function describeHttpError(statusCode: number, responseBody: string): string {
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

export function validateHttpUrl(url: string): { valid: true; parsed: URL } | { valid: false; error: string } {
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

/**
 * The answer of a 2xx response. An empty body (204, some PUT and DELETE answers) is a success with
 * `data: null`. A body that is not JSON is not the API at all: a sign-in proxy in front of Vikunja
 * answers its login page with 200. That is a failure marked `notApiResponse`, handled like an
 * unreachable server, never a success: a change "saved" that way would silently be lost (C-1).
 */
export function readSuccessBody<T>(responseBody: string): ApiResult<T> {
  if (responseBody.trim() === '') return { success: true, data: null as T }
  try {
    return { success: true, data: JSON.parse(responseBody) as T }
  } catch {
    return { success: false, error: NOT_API_RESPONSE_MESSAGE, notApiResponse: true }
  }
}

/**
 * The answer of a response that is not 2xx. A 4xx whose body is a page instead of JSON did not come
 * from Vikunja: the sign-in page of a plane's or hotel's network, a firewall's or a proxy's block
 * page (`isNotApiErrorAnswer`). It is marked `notApiResponse` and carries no status, so it is
 * handled like an unreachable server (the change is queued, the replay waits) and no rule about a
 * 401, 403 or 404 of the server applies to it: no sign-in prompt, no dropped change.
 */
export function readErrorAnswer(statusCode: number, responseBody: string): ApiError {
  if (isNotApiErrorAnswer(statusCode, responseBody)) {
    return { success: false, error: notApiErrorMessage(statusCode), notApiResponse: true }
  }
  let errorCode: number | undefined
  try {
    const parsed = JSON.parse(responseBody)
    if (typeof parsed.code === 'number') errorCode = parsed.code
  } catch { /* ignore */ }
  return {
    success: false,
    error: describeHttpError(statusCode, responseBody),
    statusCode,
    errorCode,
  }
}
