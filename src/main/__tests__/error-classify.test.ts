import { describe, it, expect } from 'vitest'
import {
  CREATE_MAY_EXIST_TIMEOUT_MESSAGE,
  NOT_API_RESPONSE_MESSAGE,
  SESSION_ENDED_MESSAGE,
  answerCutOffMessage,
  isAnswerCutOff,
  isUnreachableFailure,
  isQueueableFailure as queueable,
  isAuthError as authError,
  isRetriableError,
  isConnectionError,
  isAuthError,
  isNotApiErrorAnswer,
  maybeCreatedMessage,
  notApiErrorMessage,
} from '../error-classify'

// The cases of the mobile app's `NotApiResponseTest`; keep them in step.
describe('isNotApiErrorAnswer: an error answer that did not come from Vikunja', () => {
  const page = '<!DOCTYPE html><html><body><h1>Sign in to the network</h1></body></html>'

  it('a 4xx whose body is a page is not the server answering', () => {
    for (const status of [401, 403, 404, 405, 407, 409, 451]) {
      expect(isNotApiErrorAnswer(status, page), `${status} with a page`).toBe(true)
      expect(isNotApiErrorAnswer(status, 'Forbidden'), `${status} with plain text`).toBe(true)
    }
  })

  it("Vikunja's own error answers stay what they are", () => {
    const middleware = '{"code":11,"message":"missing, malformed, expired or otherwise invalid token provided"}'
    const problem = '{"title":"Forbidden","status":403,"detail":"Forbidden"}'
    for (const status of [401, 403, 404, 409, 412, 422]) {
      expect(isNotApiErrorAnswer(status, middleware), `${status}`).toBe(false)
      expect(isNotApiErrorAnswer(status, problem), `${status}`).toBe(false)
      expect(isNotApiErrorAnswer(status, `  \n${problem}\n`), `${status} with whitespace`).toBe(false)
      expect(isNotApiErrorAnswer(status, '[]'), `${status} with an array`).toBe(false)
    }
  })

  it('an empty body shows nothing, so the status stands', () => {
    for (const status of [401, 403, 404]) {
      expect(isNotApiErrorAnswer(status, ''), `${status}`).toBe(false)
      expect(isNotApiErrorAnswer(status, '  \n'), `${status}`).toBe(false)
    }
  })

  it('a status about the request itself is a refusal whoever answered', () => {
    for (const status of [400, 413, 414, 431]) expect(isNotApiErrorAnswer(status, page), `${status}`).toBe(false)
  })

  it('statuses with a meaning of their own keep it', () => {
    for (const status of [200, 204, 301, 302, 304, 408, 429, 500, 502, 503, 504]) {
      expect(isNotApiErrorAnswer(status, page), `${status}`).toBe(false)
    }
  })

  it('a body that starts like JSON but is not is a page', () => {
    expect(isNotApiErrorAnswer(403, '{ not json')).toBe(true)
  })

  it('names the status that was answered', () => {
    expect(notApiErrorMessage(403)).toContain('HTTP 403')
    expect(authError(notApiErrorMessage(401))).toBe(false)
    expect(isRetriableError(notApiErrorMessage(403))).toBe(false) // classified by its marker, never by its text
  })
})

describe('error classification', () => {
  it('connection errors are both retriable and connection-level', () => {
    for (const e of ['net::ERR_CONNECTION_REFUSED', 'ECONNREFUSED 127.0.0.1', 'ERR_INTERNET_DISCONNECTED', 'ENOTFOUND host']) {
      expect(isConnectionError(e)).toBe(true)
      expect(isRetriableError(e)).toBe(true)
    }
  })

  it('a certificate that does not verify never sent the request: a create is queued, without a "may exist" warning', () => {
    // A network that puts its sign-in page in front of every HTTPS address (a plane, a hotel).
    for (const e of ['net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_CERT_COMMON_NAME_INVALID', 'net::ERR_CERT_DATE_INVALID', 'net::ERR_SSL_VERSION_OR_CIPHER_MISMATCH']) {
      expect(isConnectionError(e), e).toBe(true)
      expect(isRetriableError(e), e).toBe(true)
      expect(queueable({ error: e }, 'create'), e).toBe(true)
      expect(queueable({ error: e }, 'change'), e).toBe(true)
      expect(isUnreachableFailure({ error: e }), e).toBe(true)
      expect(maybeCreatedMessage({ error: e }), e).toBeNull()
    }
    // A TLS failure after the handshake may have followed the request: still not connection-level.
    expect(isConnectionError('net::ERR_SSL_PROTOCOL_ERROR')).toBe(false)
    expect(queueable({ error: 'net::ERR_SSL_PROTOCOL_ERROR' }, 'change')).toBe(true)
  })

  it('timeouts are retriable but NOT connection-level (request may have reached the server)', () => {
    expect(isRetriableError('Request timed out (10s)')).toBe(true)
    expect(isConnectionError('Request timed out (10s)')).toBe(false)
  })

  it('server 5xx errors are neither retriable nor connection-level', () => {
    expect(isRetriableError('Server error — Vikunja may be experiencing issues.')).toBe(false)
    expect(isConnectionError('Server error — Vikunja may be experiencing issues.')).toBe(false)
  })

  it('auth errors are recognized', () => {
    expect(isAuthError('API token is invalid or expired. Check Settings.')).toBe(true)
    expect(isAuthError('Network error')).toBe(false)
  })
})

// F7: a create that timed out may have been applied; the user is told to check before retrying.
describe('maybeCreatedMessage', () => {
  it('warns that a timed out create may exist, with the wording the user is shown', () => {
    expect(CREATE_MAY_EXIST_TIMEOUT_MESSAGE).toBe(
      "The server didn't answer in time. The task may already have been created; check before retrying."
    )
    expect(maybeCreatedMessage({ error: 'Request timed out (10s)' })).toBe(CREATE_MAY_EXIST_TIMEOUT_MESSAGE)
    expect(maybeCreatedMessage({ error: 'connect ETIMEDOUT 10.0.0.2:3456' })).toBe(CREATE_MAY_EXIST_TIMEOUT_MESSAGE)
  })

  it('warns about a connection that was lost after the request left', () => {
    for (const error of ['socket hang up', 'read ECONNRESET', 'net::ERR_CONNECTION_RESET', 'Network error']) {
      expect(maybeCreatedMessage({ error })).toMatch(/The connection was lost\. The task may already have been created; check before retrying\./)
    }
  })

  it('warns about a 500, where the server may have applied the create before failing', () => {
    expect(maybeCreatedMessage({ error: 'Server error — Vikunja may be experiencing issues.', statusCode: 500 })).toMatch(
      /The task may already have been created; check before retrying\./
    )
  })

  it('stays silent when the request provably created nothing (it can be queued) or was refused', () => {
    for (const failure of [
      { error: 'connect ECONNREFUSED 127.0.0.1:3456' },
      { error: 'net::ERR_INTERNET_DISCONNECTED' },
      { error: 'Bad Gateway', statusCode: 502 },
      { error: 'Service Unavailable', statusCode: 503 },
      { error: 'Too Many Requests', statusCode: 429 },
      { error: 'title too long', statusCode: 422 },
      { error: 'API token is invalid or expired.', statusCode: 401 },
      { error: 'Session expired. Please sign in again.' },
      { error: 'Invalid URL' },
    ]) {
      expect(maybeCreatedMessage(failure)).toBeNull()
    }
  })
})

describe('a web page instead of the API and an ended session', () => {
  it('reads a web page as unreachable by its marker, not its text', () => {
    expect(isUnreachableFailure({ error: NOT_API_RESPONSE_MESSAGE, notApiResponse: true })).toBe(true)
    expect(isUnreachableFailure({ error: NOT_API_RESPONSE_MESSAGE })).toBe(false)
    expect(isUnreachableFailure({ error: 'Request timed out (no answer for 10s)' })).toBe(true)
    expect(queueable({ error: 'x', notApiResponse: true }, 'create')).toBe(true)
  })

  it('reads the ended-session message as an auth problem, not queueable', () => {
    expect(authError(SESSION_ENDED_MESSAGE)).toBe(true)
    expect(queueable({ error: SESSION_ENDED_MESSAGE, statusCode: 401 }, 'change')).toBe(false)
  })
})

describe('an answer cut off after the server began it', () => {
  const cut = answerCutOffMessage('net::ERR_NETWORK_CHANGED')

  it('is a network failure, but never one where the request did not reach the server', () => {
    expect(isAnswerCutOff(cut)).toBe(true)
    expect(isRetriableError(cut)).toBe(true)
    expect(isConnectionError(cut)).toBe(false)
    expect(isUnreachableFailure({ error: cut })).toBe(true)
    // Whatever the network error says.
    expect(isConnectionError(answerCutOffMessage('net::ERR_INTERNET_DISCONNECTED'))).toBe(false)
    expect(isRetriableError(answerCutOffMessage(''))).toBe(true)
  })

  it('a change is queued, a create is not and says it may exist', () => {
    expect(queueable({ error: cut }, 'change')).toBe(true)
    expect(queueable({ error: cut }, 'create')).toBe(false)
    expect(maybeCreatedMessage({ error: cut })).toContain('may already have been created')
  })

  it('the same network error before any answer stays a connection error', () => {
    expect(isAnswerCutOff('net::ERR_NETWORK_CHANGED')).toBe(false)
    expect(isConnectionError('net::ERR_NETWORK_CHANGED')).toBe(true)
    expect(queueable({ error: 'net::ERR_NETWORK_CHANGED' }, 'create')).toBe(true)
  })
})
