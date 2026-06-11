import { describe, it, expect } from 'vitest'
import { isRetriableError, isConnectionError, isAuthError } from '../error-classify'

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
