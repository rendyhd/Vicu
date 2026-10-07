import { describe, expect, it } from 'vitest'
import {
  buildStandaloneTaskPayload,
  uploadStandaloneTasks,
  type UploadableTask,
  type UploadResult,
} from '../standalone-upload'

const NULL_DATE = '0001-01-01T00:00:00Z'

function task(id: string, overrides: Partial<UploadableTask> = {}): UploadableTask {
  return { id, title: `Task ${id}`, description: '', due_date: NULL_DATE, ...overrides }
}

const neverAuthError = () => false

/**
 * A fake local store and server: `upload` records what the server received and can
 * be told to fail for given titles; `remove` deletes from the local store.
 */
function fakeWorld(initial: UploadableTask[], failTitles: Record<string, string> = {}) {
  const local = [...initial]
  const serverReceived: string[] = []
  const events: string[] = []
  return {
    local,
    serverReceived,
    events,
    failTitles,
    deps: {
      upload: async (payload: Record<string, unknown>): Promise<UploadResult> => {
        const title = String(payload.title)
        events.push(`upload ${title}`)
        if (failTitles[title]) return { success: false, error: failTitles[title] }
        serverReceived.push(title)
        return { success: true }
      },
      remove: (id: string) => {
        events.push(`remove ${id}`)
        const i = local.findIndex((t) => t.id === id)
        if (i >= 0) local.splice(i, 1)
      },
      isAuthError: neverAuthError,
    },
  }
}

describe('buildStandaloneTaskPayload', () => {
  it('sends the title, and the description and due date only when set', () => {
    expect(buildStandaloneTaskPayload(task('1'))).toEqual({ title: 'Task 1' })
    expect(
      buildStandaloneTaskPayload(task('2', { description: 'notes', due_date: '2026-10-07T21:59:59.000Z' }))
    ).toEqual({ title: 'Task 2', description: 'notes', due_date: '2026-10-07T21:59:59.000Z' })
  })
})

describe('uploadStandaloneTasks (D-IPC-1)', () => {
  it('removes every task locally once it was uploaded', async () => {
    const world = fakeWorld([task('a'), task('b'), task('c')])

    const result = await uploadStandaloneTasks([...world.local], world.deps)

    expect(result).toEqual({ uploaded: 3, errors: [] })
    expect(world.serverReceived).toEqual(['Task a', 'Task b', 'Task c'])
    expect(world.local).toEqual([])
  })

  it('removes each task as soon as its own upload succeeded, before the next upload starts', async () => {
    const world = fakeWorld([task('a'), task('b')])

    await uploadStandaloneTasks([...world.local], world.deps)

    expect(world.events).toEqual(['upload Task a', 'remove a', 'upload Task b', 'remove b'])
  })

  it('a failure part-way keeps only the tasks that were not uploaded', async () => {
    const world = fakeWorld([task('a'), task('b'), task('c'), task('d')], { 'Task c': 'Server error' })

    const result = await uploadStandaloneTasks([...world.local], world.deps)

    expect(result.uploaded).toBe(3)
    expect(result.errors).toEqual(['"Task c": Server error'])
    expect(world.serverReceived).toEqual(['Task a', 'Task b', 'Task d'])
    expect(world.local.map((t) => t.id)).toEqual(['c'])
  })

  it('a retry does not upload the tasks that already went through', async () => {
    const world = fakeWorld([task('a'), task('b'), task('c')], { 'Task b': 'Server error' })

    await uploadStandaloneTasks([...world.local], world.deps)
    expect(world.serverReceived).toEqual(['Task a', 'Task c'])

    // The server recovers; the user retries.
    delete world.failTitles['Task b']
    const retry = await uploadStandaloneTasks([...world.local], world.deps)

    expect(retry).toEqual({ uploaded: 1, errors: [] })
    expect(world.serverReceived).toEqual(['Task a', 'Task c', 'Task b']) // each task exactly once
    expect(world.local).toEqual([])
  })

  it('stops at an auth error and keeps the untouched tasks', async () => {
    const world = fakeWorld([task('a'), task('b'), task('c')], { 'Task b': 'Session expired' })

    const result = await uploadStandaloneTasks([...world.local], {
      ...world.deps,
      isAuthError: (e) => e.includes('Session expired'),
    })

    expect(result).toEqual({ uploaded: 1, errors: ['"Task b": Session expired'] })
    expect(world.events).not.toContain('upload Task c')
    expect(world.local.map((t) => t.id)).toEqual(['b', 'c'])
  })

  it('reports every failure of a non-auth error run', async () => {
    const world = fakeWorld([task('a'), task('b'), task('c')], { 'Task a': 'boom', 'Task c': 'bang' })

    const result = await uploadStandaloneTasks([...world.local], world.deps)

    expect(result.uploaded).toBe(1)
    expect(result.errors).toEqual(['"Task a": boom', '"Task c": bang'])
    expect(world.local.map((t) => t.id)).toEqual(['a', 'c'])
  })

  it('stops and reports when a task cannot be removed locally after its upload', async () => {
    const world = fakeWorld([task('a'), task('b')])

    const result = await uploadStandaloneTasks([...world.local], {
      ...world.deps,
      remove: () => {
        throw new Error('disk full')
      },
    })

    expect(result.uploaded).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Task a')
    expect(result.errors[0]).toContain('disk full')
    expect(world.serverReceived).toEqual(['Task a']) // did not go on to upload more it cannot track
  })

  it('does nothing for an empty list', async () => {
    const world = fakeWorld([])

    expect(await uploadStandaloneTasks([], world.deps)).toEqual({ uploaded: 0, errors: [] })
    expect(world.events).toEqual([])
  })
})
