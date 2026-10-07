import { describe, it, expect } from 'vitest'
import {
  CREATE_MAY_EXIST_TIMEOUT_MESSAGE,
  isRetriableError,
  isConnectionError,
  isAuthError,
  maybeCreatedMessage,
} from '../error-classify'

describe('error classification', () => {
  it('connection errors are both retriable and connection-level', () => {
    for (const e of ['net::ERR_CONNECTION_REFUSED', 'ECONNREFUSED 127.0.0.1', 'ERR_INTERNET_DISCONNECTED', 'ENOTFOUND host']) {
      expect(isConnectionError(e)).toBe(true)
      expect(isRetriableError(e)).toBe(true)
    }
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
