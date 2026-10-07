import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiError, describeMutationError, toastForMutationError } from '../mutation-errors'
import { createAppQueryClient } from '../query-client'

describe('describeMutationError', () => {
  it('explains a network failure instead of echoing the Electron error code', () => {
    const failure = describeMutationError(new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(failure.kind).toBe('offline')
    expect(failure.message).toBe("Can't reach the server. Check your connection and try again.")
  })

  it('names the server problem for a 5xx', () => {
    expect(describeMutationError(new ApiError('Internal Server Error', 503))).toEqual({
      kind: 'server',
      message: 'The server had a problem (HTTP 503). Try again in a moment.',
    })
  })

  it('shows a create that may already exist as it is worded, not as "try again" (F7)', () => {
    const warning = "The server didn't answer in time. The task may already have been created; check before retrying."
    expect(describeMutationError(new ApiError(warning, undefined, true))).toEqual({ kind: 'unknown', message: warning })
    // Even with a 500 behind it: "try again in a moment" would add the task a second time.
    const serverWarning = 'The server reported an error. The task may already have been created; check before retrying.'
    expect(describeMutationError(apiError({ error: serverWarning, statusCode: 500, mayExist: true }))).toEqual({
      kind: 'unknown',
      message: serverWarning,
    })
  })

  it('tells the user to sign in again for an auth failure, by status or by message', () => {
    expect(describeMutationError(new ApiError('Unauthorized', 401)).kind).toBe('auth')
    expect(describeMutationError(new Error('Session expired. Please log in again.')).kind).toBe('auth')
    expect(describeMutationError(new Error('API token is invalid')).kind).toBe('auth')
  })

  it('keeps the server wording for a rejection, because it names the field', () => {
    expect(describeMutationError(new ApiError('The task title must not be empty', 422))).toEqual({
      kind: 'rejected',
      message: 'The task title must not be empty',
    })
  })

  it('has fixed wording for permission, missing item and rate limit', () => {
    expect(describeMutationError(new ApiError('x', 403)).kind).toBe('forbidden')
    expect(describeMutationError(new ApiError('x', 404)).kind).toBe('not-found')
    expect(describeMutationError(new ApiError('x', 429)).kind).toBe('rate-limit')
  })

  it('strips the Electron wrapper around an IPC error and caps its length', () => {
    const wrapped = describeMutationError(new Error("Error invoking remote method 'update-task': Error: Boom"))
    expect(wrapped.message).toBe('Boom')
    expect(describeMutationError(new Error('x'.repeat(500))).message.length).toBeLessThanOrEqual(200)
  })

  it('falls back to a generic sentence for an empty error', () => {
    expect(describeMutationError(new Error('')).message).toBe('Something went wrong. Try again.')
    expect(describeMutationError(undefined).kind).toBe('unknown')
  })

  it('apiError keeps the status', () => {
    const error = apiError({ error: 'nope', statusCode: 409 })
    expect(error).toBeInstanceOf(ApiError)
    expect(error.statusCode).toBe(409)
  })
})

describe('toastForMutationError (the decision behind MutationCache.onError)', () => {
  it('toasts a failed mutation, prefixed with what it was doing', () => {
    expect(toastForMutationError(new ApiError('Bad', 500), { action: 'complete the task' })).toEqual({
      kind: 'server',
      message: 'Could not complete the task: The server had a problem (HTTP 500). Try again in a moment.',
    })
  })

  it('toasts without a prefix when the mutation did not say what it was doing', () => {
    expect(toastForMutationError(new Error('net::ERR_CONNECTION_REFUSED'), undefined)?.message)
      .toBe("Can't reach the server. Check your connection and try again.")
  })

  it('stays silent for a mutation that shows its own error', () => {
    expect(toastForMutationError(new Error('boom'), { silent: true })).toBeNull()
  })
})

describe('createAppQueryClient', () => {
  const fail = (client: QueryClient, meta?: Record<string, unknown>) =>
    client
      .getMutationCache()
      .build(client, {
        mutationFn: async () => {
          throw new ApiError('nope', 422)
        },
        meta,
      })
      .execute(undefined)
      .catch(() => {})

  it('reports a failed mutation once, through the handler', async () => {
    const report = vi.fn()
    const client = createAppQueryClient(report)

    await fail(client, { action: 'save the change' })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith({ kind: 'rejected', message: 'Could not save the change: nope' })
  })

  it('does not report a mutation that opted out', async () => {
    const report = vi.fn()
    const client = createAppQueryClient(report)

    await fail(client, { silent: true })

    expect(report).not.toHaveBeenCalled()
  })

  it('does not report a mutation that succeeded', async () => {
    const report = vi.fn()
    const client = createAppQueryClient(report)

    await client.getMutationCache().build(client, { mutationFn: async () => 'ok' }).execute(undefined)

    expect(report).not.toHaveBeenCalled()
  })
})
