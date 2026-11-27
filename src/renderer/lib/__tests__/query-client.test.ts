import { afterEach, describe, expect, it, vi } from 'vitest'
import { onlineManager } from '@tanstack/react-query'
import { createAppQueryClient } from '../query-client'

/**
 * rendyhd/Vicu#77. The window's `offline` event is what `onlineManager.setOnline(false)` stands
 * for here. After it the library's default network mode holds a mutation back without calling its
 * function, so a change made after the connection dropped never reached the host, which is the
 * one that puts it into the offline queue.
 */
describe('the query client after the window went offline', () => {
  const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))

  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it('still runs a mutation, so the host can queue the change', async () => {
    const client = createAppQueryClient(vi.fn())
    client.mount()
    const mutationFn = vi.fn(async () => 'queued')
    onlineManager.setOnline(false)

    const mutation = client.getMutationCache().build(client, { mutationFn })
    const done = mutation.execute(undefined)
    await Promise.race([done, settle()])

    expect(mutationFn).toHaveBeenCalledTimes(1)
    expect(mutation.state.isPaused).toBe(false)
    expect(mutation.state.status).toBe('success')
    client.unmount()
  })

  it('reports a mutation the host could not take instead of waiting for the connection', async () => {
    const report = vi.fn()
    const client = createAppQueryClient(report)
    client.mount()
    onlineManager.setOnline(false)

    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        throw new Error('nope')
      },
      meta: { action: 'create the task' },
    })
    await Promise.race([mutation.execute(undefined).catch(() => {}), settle()])

    expect(mutation.state.status).toBe('error')
    expect(report).toHaveBeenCalledTimes(1)
    client.unmount()
  })

  it('still runs a query, so a list answers from the host or fails, never waits', async () => {
    const client = createAppQueryClient(vi.fn())
    client.mount()
    const queryFn = vi.fn(async () => ['task'])
    onlineManager.setOnline(false)

    const done = client.fetchQuery({ queryKey: ['tasks', 'probe'], queryFn })
    await Promise.race([done, settle()])

    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(client.getQueryState(['tasks', 'probe'])?.fetchStatus).toBe('idle')
    client.unmount()
  })

  it('keeps refetching when the connection comes back', () => {
    const client = createAppQueryClient(vi.fn())

    expect(client.defaultQueryOptions({ queryKey: ['tasks'] }).refetchOnReconnect).toBe(true)
  })
})
