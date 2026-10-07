import { describe, expect, it } from 'vitest'
import { classifyReplayFailure } from '../offline/classify'
import { isQueueableFailure } from '../../shared/error-classify'

const http = (statusCode: number, error = `HTTP ${statusCode}`) => ({ error, statusCode })

describe('classifyReplayFailure (D-SYNC-1)', () => {
  describe('actions the server will never accept are dropped into the failed log', () => {
    it.each([
      [400, 'rejected'],
      [422, 'rejected'],
      [409, 'conflict'],
    ] as const)('%i on an update', (status, reason) => {
      expect(classifyReplayFailure(http(status), 'update')).toEqual({ kind: 'drop', reason })
    })

    it('404 on an update, an added label or an upload means the task is gone', () => {
      for (const type of ['update', 'add-label', 'upload-attachment'] as const) {
        expect(classifyReplayFailure(http(404), type)).toEqual({ kind: 'drop', reason: 'task-gone' })
      }
    })

    it('404 on a create means the project is gone, not a task', () => {
      expect(classifyReplayFailure(http(404), 'create')).toEqual({ kind: 'drop', reason: 'not-found' })
    })

    // A server that says the body is too large will say so every time: dropping the upload lets
    // the actions behind it go out instead of wedging the queue on the same 413 (D-SYNC-1).
    it('413 on an upload means the file is too large', () => {
      expect(classifyReplayFailure(http(413), 'upload-attachment')).toEqual({ kind: 'drop', reason: 'too-large' })
    })

    it('413 on any other action is a rejection of that data', () => {
      for (const type of ['create', 'update', 'add-label'] as const) {
        expect(classifyReplayFailure(http(413), type)).toEqual({ kind: 'drop', reason: 'rejected' })
      }
    })

    it('400 and 422 on a create are rejected, 409 is a conflict', () => {
      expect(classifyReplayFailure(http(422), 'create')).toEqual({ kind: 'drop', reason: 'rejected' })
      expect(classifyReplayFailure(http(409), 'create')).toEqual({ kind: 'drop', reason: 'conflict' })
    })
  })

  describe('already in effect counts as done', () => {
    it('404 on a delete: the task is already gone', () => {
      expect(classifyReplayFailure(http(404), 'delete')).toEqual({ kind: 'done' })
    })

    it('404 on removing a label: it is already off the task', () => {
      expect(classifyReplayFailure(http(404), 'remove-label')).toEqual({ kind: 'done' })
    })

    it('409 on adding a label that is already on the task', () => {
      expect(classifyReplayFailure(http(409), 'add-label')).toEqual({ kind: 'done' })
    })
  })

  describe('problems with the session keep the whole queue and ask for sign-in', () => {
    it.each([401, 403])('HTTP %i', (status) => {
      expect(classifyReplayFailure(http(status), 'update')).toEqual({ kind: 'stop', why: 'auth' })
    })

    it.each([
      'Session expired. Please sign in again.',
      'API token is invalid or expired. Check Settings or generate a new token in Vikunja.',
      'API token lacks permission. Ensure your token has read/write access to tasks and projects.',
      'API token has insufficient permissions. Create a new token with read/write access to tasks and projects.',
    ])('message without a status: %s', (error) => {
      expect(classifyReplayFailure({ error }, 'create')).toEqual({ kind: 'stop', why: 'auth' })
    })

    it('an auth failure on an action that would otherwise be dropped still keeps it', () => {
      // The message says auth even though a status of 404 would drop: auth wins.
      expect(classifyReplayFailure({ error: 'Session expired. Please sign in again.', statusCode: 404 }, 'update')).toEqual({
        kind: 'stop',
        why: 'auth',
      })
    })
  })

  describe('transient problems keep the queue and stop the replay', () => {
    it.each([500, 502, 503, 504])('HTTP %i is a server problem', (status) => {
      expect(classifyReplayFailure(http(status), 'update')).toEqual({ kind: 'stop', why: 'server' })
    })

    it('429 is rate limiting', () => {
      expect(classifyReplayFailure(http(429), 'create')).toEqual({ kind: 'stop', why: 'rate-limit' })
    })

    it('408 is a network problem', () => {
      expect(classifyReplayFailure(http(408), 'update')).toEqual({ kind: 'stop', why: 'network' })
    })

    it.each([
      'net::ERR_CONNECTION_REFUSED',
      'ECONNREFUSED 127.0.0.1:3456',
      'Request timed out (10s)',
      'Upload timed out (60s)',
      'Network error',
      'getaddrinfo ENOTFOUND vikunja.example',
    ])('network error: %s', (error) => {
      expect(classifyReplayFailure({ error }, 'update')).toEqual({ kind: 'stop', why: 'network' })
    })

    it('"not configured" keeps the queue until the user finishes setup', () => {
      expect(classifyReplayFailure({ error: 'Vikunja is not configured. Open Settings to connect.' }, 'update')).toEqual({
        kind: 'stop',
        why: 'config',
      })
    })
  })

  describe('everything else is kept, counted, and eventually surfaced', () => {
    it.each([405, 415, 418, 423])('unexpected status %i stops and counts an attempt', (status) => {
      expect(classifyReplayFailure(http(status), 'update')).toEqual({ kind: 'stop', why: 'unknown' })
    })

    it('an error with no status that is not a network error', () => {
      expect(classifyReplayFailure({ error: 'Invalid URL' }, 'update')).toEqual({ kind: 'stop', why: 'unknown' })
    })

    it('an empty error is unknown, never a drop', () => {
      expect(classifyReplayFailure({ error: '' }, 'update')).toEqual({ kind: 'stop', why: 'unknown' })
    })
  })
})

describe('isQueueableFailure', () => {
  it('queues changes on network errors, timeouts, 5xx, 429 and 408', () => {
    for (const f of [
      { error: 'net::ERR_INTERNET_DISCONNECTED' },
      { error: 'Request timed out (10s)' },
      http(500),
      http(503),
      http(429),
      http(408),
    ]) {
      expect(isQueueableFailure(f, 'change')).toBe(true)
    }
  })

  it('never queues a change the server rejected or an auth failure', () => {
    for (const f of [http(400), http(401), http(403), http(404), http(409), http(422), { error: 'Session expired. Please sign in again.' }]) {
      expect(isQueueableFailure(f, 'change')).toBe(false)
    }
  })

  it('queues a create only when it provably never reached the server', () => {
    expect(isQueueableFailure({ error: 'net::ERR_CONNECTION_REFUSED' }, 'create')).toBe(true)
    expect(isQueueableFailure({ error: 'ENOTFOUND host' }, 'create')).toBe(true)
    // gateway errors: the proxy answered, Vikunja did not
    expect(isQueueableFailure(http(502), 'create')).toBe(true)
    expect(isQueueableFailure(http(503), 'create')).toBe(true)
    expect(isQueueableFailure(http(504), 'create')).toBe(true)
    expect(isQueueableFailure(http(429), 'create')).toBe(true)
  })

  it('does not queue a create that may already have been applied', () => {
    expect(isQueueableFailure({ error: 'Request timed out (10s)' }, 'create')).toBe(false)
    expect(isQueueableFailure({ error: 'socket hang up' }, 'create')).toBe(false)
    expect(isQueueableFailure(http(500), 'create')).toBe(false)
  })
})
