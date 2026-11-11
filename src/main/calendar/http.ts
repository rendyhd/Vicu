// The one way a calendar source talks to a server (contract 20.9, 20.11). Free of Electron: the
// service passes Electron's net.fetch (which follows the system proxy), tests a fake.
//
// - Read-only by construction: only GET, HEAD, OPTIONS, PROPFIND and REPORT leave; anything else
//   (PUT, DELETE, MKCALENDAR ...) is refused before it is sent.
// - A time limit per request and a byte budget per read (a calendar too large to read says so).
// - A CalDAV sign-in is added here and only to the account's own site over the account's scheme,
//   so a server cannot send the password to another host or over plain http.
// - No cookies: the app's session is never sent to a calendar host.
// - Failures become plain sentences (`CalendarReadError`); a URL, user name or password is never in
//   one, so the message can be shown and logged.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type CalendarErrorCode = 'auth' | 'forbidden' | 'not-found' | 'network' | 'timeout' | 'too-large' | 'server' | 'format' | 'other'

export class CalendarReadError extends Error {
  constructor(message: string, readonly code: CalendarErrorCode = 'other', readonly status?: number) {
    super(message)
    this.name = 'CalendarReadError'
  }
}

export interface BasicAuth {
  username: string
  password: string
  /** The address the user gave; the sign-in goes to its site only. */
  origin: string
}

export interface CalendarHttpOptions {
  base: FetchLike
  timeoutMs?: number
  /** Bytes a whole read may take, over all its requests. */
  maxBytes?: number
  auth?: BasicAuth
}

export interface CalendarHttp {
  /** fetch for the source's own requests and for tsdav. */
  fetch: FetchLike
  /** The HTTP statuses answered so far, in order. */
  readonly statuses: number[]
}

export const DEFAULT_TIMEOUT_MS = 20_000
export const DEFAULT_MAX_BYTES = 15 * 1024 * 1024
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PROPFIND', 'REPORT'])

/** The registrable part of a host, roughly: "p52-caldav.icloud.com" and "caldav.icloud.com" share "icloud.com". */
export function siteOf(host: string): string {
  const name = host.toLowerCase().replace(/\.$/, '')
  if (/^\d+(?:\.\d+){3}$/.test(name) || name.includes(':') || !name.includes('.')) return name
  const labels = name.split('.')
  // "example.co.uk": a short second-level label under a country code.
  const take = labels.length >= 3 && labels[labels.length - 2].length <= 3 && labels[labels.length - 1].length === 2 ? 3 : 2
  return labels.slice(-take).join('.')
}

/** Whether a request to `target` may carry the sign-in given for `origin`. */
export function mayCarrySignIn(target: string, origin: string): boolean {
  try {
    const to = new URL(target)
    const from = new URL(origin)
    if (from.protocol === 'https:' && to.protocol !== 'https:') return false
    if (to.protocol !== 'https:' && to.protocol !== 'http:') return false
    return siteOf(to.hostname) === siteOf(from.hostname)
  } catch {
    return false
  }
}

function basicHeader(auth: BasicAuth): string {
  return `Basic ${Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')}`
}

/** A plain sentence for a network failure (Chromium's net::ERR_ codes, Node's errno codes). */
export function networkMessage(error: unknown): CalendarReadError {
  const text = error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ''}` : String(error)
  if (/INTERNET_DISCONNECTED|ENETUNREACH|NETWORK_CHANGED/i.test(text)) return new CalendarReadError('No internet connection.', 'network')
  if (/NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(text)) return new CalendarReadError('Could not find the server. Check the address.', 'network')
  if (/CERT|SSL|TLS/i.test(text)) return new CalendarReadError('The server\'s certificate is not valid, so Vicu did not connect.', 'network')
  if (/TIMED_OUT|ETIMEDOUT/i.test(text)) return new CalendarReadError('The server took too long to answer.', 'timeout')
  return new CalendarReadError('Could not reach the server. Check your connection.', 'network')
}

export function calendarHttp(options: CalendarHttpOptions): CalendarHttp {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let budget = options.maxBytes ?? DEFAULT_MAX_BYTES
  const statuses: number[] = []

  const run: FetchLike = async (url, init = {}) => {
    const method = String(init.method ?? 'GET').toUpperCase()
    if (!READ_METHODS.has(method)) throw new CalendarReadError('Vicu only reads calendars.', 'other')
    const headers = new Headers(init.headers ?? {})
    headers.delete('authorization')
    if (options.auth && mayCarrySignIn(url, options.auth.origin)) headers.set('Authorization', basicHeader(options.auth))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const outer = init.signal
    const onAbort = () => controller.abort()
    outer?.addEventListener('abort', onAbort)
    try {
      let response: Response
      try {
        response = await options.base(url, { ...init, method, headers, signal: controller.signal, credentials: 'omit' })
      } catch (error) {
        if (controller.signal.aborted) throw new CalendarReadError('The server took too long to answer.', 'timeout')
        throw networkMessage(error)
      }
      statuses.push(response.status)
      // A redirect handed back (redirect: 'manual') has no body to read.
      if (response.type === 'opaqueredirect' || response.status === 0) return response
      const length = Number(response.headers.get('content-length') ?? '')
      if (Number.isFinite(length) && length > budget) {
        throw new CalendarReadError('The calendar is too large to read.', 'too-large')
      }
      let body: ArrayBuffer
      try {
        body = await response.arrayBuffer()
      } catch (error) {
        if (controller.signal.aborted) throw new CalendarReadError('The server took too long to answer.', 'timeout')
        throw networkMessage(error)
      }
      budget -= body.byteLength
      if (budget < 0) throw new CalendarReadError('The calendar is too large to read.', 'too-large')
      const nullBody = response.status === 204 || response.status === 304 || method === 'HEAD'
      const copy = new Response(nullBody ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers })
      Object.defineProperty(copy, 'url', { value: response.url || url })
      return copy
    } finally {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onAbort)
    }
  }
  return { fetch: run, statuses }
}

export type CalendarSubject = 'link' | 'account'

/** A plain sentence for an HTTP status. */
export function statusMessage(status: number, subject: CalendarSubject): CalendarReadError {
  if (status === 401) {
    return subject === 'account'
      ? new CalendarReadError('Wrong user name or app password.', 'auth', status)
      : new CalendarReadError('The calendar asks for a sign-in. Use the secret address, which needs none.', 'auth', status)
  }
  if (status === 403) {
    return subject === 'account'
      ? new CalendarReadError('The server refused access (403). Check that the app password may read calendars.', 'forbidden', status)
      : new CalendarReadError('The calendar refused the link (403). It may have been reset: make a new link and add it again.', 'forbidden', status)
  }
  if (status === 404 || status === 410) {
    return subject === 'account'
      ? new CalendarReadError('The calendar is no longer on the server (404).', 'not-found', status)
      : new CalendarReadError('The calendar link no longer works (404). Make a new link and add it again.', 'not-found', status)
  }
  if (status === 429) return new CalendarReadError('The server asks Vicu to wait (429). It tries again later.', 'server', status)
  if (status >= 500) return new CalendarReadError(`The server had a problem (${status}). Vicu tries again later.`, 'server', status)
  return new CalendarReadError(`The calendar answered ${status}.`, 'other', status)
}

/**
 * Any failure of a read as a CalendarReadError. Errors thrown by a library (tsdav) carry addresses
 * in their text, so they are never passed on: the statuses seen decide, else a generic sentence.
 */
export function asCalendarError(error: unknown, http: Pick<CalendarHttp, 'statuses'>, subject: CalendarSubject): CalendarReadError {
  if (error instanceof CalendarReadError) return error
  for (const status of [401, 403]) if (http.statuses.includes(status)) return statusMessage(status, subject)
  const failed = [...http.statuses].reverse().find((status) => status >= 400)
  if (failed) return statusMessage(failed, subject)
  return new CalendarReadError(
    subject === 'account' ? 'The server did not answer like a CalDAV server.' : 'The calendar could not be read.',
    'format',
  )
}
