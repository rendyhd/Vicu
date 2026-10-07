import { describe, expect, it, vi } from 'vitest'
import {
  POSITION_STEP,
  createNewTaskPlacer,
  placeNewTaskInBackground,
  readPositionHints,
  type PositionApi,
} from '../new-task-position'
import type { ApiResult, ProjectView, Task } from '../vikunja-types'

const ok = <T,>(data: T): ApiResult<T> => ({ success: true, data })
const fail = (error = 'boom'): ApiResult<never> => ({ success: false, error })

const listView = (id: number): ProjectView => ({ id, project_id: 1, title: 'List', view_kind: 'list', position: 1, created: '', updated: '' })
const otherView = (id: number): ProjectView => ({ id, project_id: 1, title: 'Board', view_kind: 'kanban', position: 2, created: '', updated: '' })
const taskAt = (id: number, position: number): Task => ({ id, position } as Task)

function fakeApi(options: { views?: ProjectView[]; top?: Task[]; failPut?: boolean } = {}) {
  const calls = { views: 0, top: 0, put: [] as Array<{ taskId: number; viewId: number; position: number }> }
  const state = { views: options.views ?? [otherView(9), listView(7)], top: options.top ?? [taskAt(1, 100)], failPut: options.failPut ?? false, failViews: false }
  const api: PositionApi = {
    fetchProjectViews: async () => {
      calls.views += 1
      return state.failViews ? fail('views down') : ok(state.views)
    },
    fetchViewTasks: async () => {
      calls.top += 1
      return ok(state.top)
    },
    updateTaskPosition: async (taskId, viewId, position) => {
      calls.put.push({ taskId, viewId, position })
      return state.failPut ? fail('Not found') : ok({})
    },
  }
  return { api, calls, state }
}

describe('placing a new task at the end of its list (D-REN-7)', () => {
  it('is one request when the query cache already knows the list view and its positions', async () => {
    const { api, calls } = fakeApi()
    const placer = createNewTaskPlacer(api)

    expect(await placer.placeAtEnd(1, 50, { viewId: 7, maxPosition: 400 })).toBe(true)
    expect(calls.views).toBe(0)
    expect(calls.top).toBe(0)
    expect(calls.put).toEqual([{ taskId: 50, viewId: 7, position: 400 + POSITION_STEP }])
  })

  it('looks the view and the end of the list up once per project, then each create is one request', async () => {
    const { api, calls } = fakeApi({ top: [taskAt(1, 1000)] })
    const placer = createNewTaskPlacer(api)

    await placer.placeAtEnd(1, 50)
    expect(calls.views).toBe(1)
    expect(calls.top).toBe(1)
    expect(calls.put).toEqual([{ taskId: 50, viewId: 7, position: 1000 + POSITION_STEP }])

    await placer.placeAtEnd(1, 51)
    await placer.placeAtEnd(1, 52)
    // Nothing was read again; each task takes the next position.
    expect(calls.views).toBe(1)
    expect(calls.top).toBe(1)
    expect(calls.put.map((put) => put.position)).toEqual([
      1000 + POSITION_STEP,
      1000 + 2 * POSITION_STEP,
      1000 + 3 * POSITION_STEP,
    ])
  })

  it('reads only one row to find the end of the list, newest position first', async () => {
    const asked: unknown[] = []
    const { api } = fakeApi()
    const placer = createNewTaskPlacer({
      ...api,
      fetchViewTasks: async (projectId, viewId, params) => {
        asked.push({ projectId, viewId, params })
        return ok([])
      },
    })
    await placer.placeAtEnd(3, 50)
    expect(asked).toEqual([{
      projectId: 3,
      viewId: 7,
      params: { filter: 'done = false', sort_by: 'position', order_by: 'desc', page: 1, per_page: 1, keep_nested_subtasks: true },
    }])
  })

  it('starts an empty project at one step', async () => {
    const { api, calls } = fakeApi({ top: [] })
    const placer = createNewTaskPlacer(api)
    await placer.placeAtEnd(1, 50)
    expect(calls.put[0].position).toBe(POSITION_STEP)
  })

  it('creates that overlap share one look-up and get distinct, increasing positions', async () => {
    const { api, calls } = fakeApi({ top: [taskAt(1, 0)] })
    const placer = createNewTaskPlacer(api)

    const results = await Promise.all([placer.placeAtEnd(1, 50), placer.placeAtEnd(1, 51), placer.placeAtEnd(1, 52)])

    expect(results).toEqual([true, true, true])
    expect(calls.views).toBe(1)
    expect(calls.top).toBe(1)
    expect(calls.put.map((put) => put.position)).toEqual([POSITION_STEP, 2 * POSITION_STEP, 3 * POSITION_STEP])
  })

  it('keeps projects apart', async () => {
    const { api, calls } = fakeApi({ top: [taskAt(1, 0)] })
    const placer = createNewTaskPlacer(api)
    await placer.placeAtEnd(1, 50)
    await placer.placeAtEnd(2, 60)
    expect(calls.views).toBe(2)
    expect(calls.put.map((put) => put.position)).toEqual([POSITION_STEP, POSITION_STEP])
  })

  it('takes a later position from the cached list than the one it handed out (a drag moved a task to the end)', async () => {
    const { api, calls } = fakeApi({ top: [taskAt(1, 0)] })
    const placer = createNewTaskPlacer(api)
    await placer.placeAtEnd(1, 50) // position 65536
    await placer.placeAtEnd(1, 51, { viewId: 7, maxPosition: 500_000 })
    expect(calls.put[1].position).toBe(500_000 + POSITION_STEP)
    // A lower cached value never moves the end backwards.
    await placer.placeAtEnd(1, 52, { viewId: 7, maxPosition: 10 })
    expect(calls.put[2].position).toBe(500_000 + 2 * POSITION_STEP)
  })

  it('notes a drag to a later position without a cached list', async () => {
    const { api, calls } = fakeApi({ top: [taskAt(1, 0)] })
    const placer = createNewTaskPlacer(api)
    await placer.placeAtEnd(1, 50)
    placer.noteViewPosition(7, 900_000)
    placer.noteViewPosition(8, 5_000_000) // another view: not ours
    await placer.placeAtEnd(1, 51)
    expect(calls.put[1].position).toBe(900_000 + POSITION_STEP)
  })

  it('looks again after the cache reports a different list view', async () => {
    const { api, calls, state } = fakeApi({ top: [taskAt(1, 0)] })
    const placer = createNewTaskPlacer(api)
    await placer.placeAtEnd(1, 50)
    state.views = [listView(12)]

    await placer.placeAtEnd(1, 51, { viewId: 12 })
    expect(calls.put[1].viewId).toBe(12)
    expect(calls.top).toBe(2) // the new view's end was read; nothing is assumed about it
  })

  it('forgets a project when the update fails, so the next create looks again, and never throws', async () => {
    const { api, calls, state } = fakeApi({ top: [taskAt(1, 0)] })
    const placer = createNewTaskPlacer(api)
    await placer.placeAtEnd(1, 50)

    state.failPut = true
    expect(await placer.placeAtEnd(1, 51)).toBe(false)

    state.failPut = false
    state.views = [listView(8)]
    expect(await placer.placeAtEnd(1, 52)).toBe(true)
    expect(calls.views).toBe(2)
    expect(calls.put[2].viewId).toBe(8)
  })

  it('turns a thrown error into false and forgets the project', async () => {
    const { api, calls } = fakeApi()
    const throwing: PositionApi = { ...api, updateTaskPosition: async () => { throw new Error('IPC closed') } }
    const placer = createNewTaskPlacer(throwing)
    expect(await placer.placeAtEnd(1, 50)).toBe(false)
    expect(await placer.placeAtEnd(1, 51)).toBe(false)
    expect(calls.views).toBe(2)
  })

  it('invalidates one project or all of them', async () => {
    const { api, calls } = fakeApi({ top: [taskAt(1, 0)] })
    const placer = createNewTaskPlacer(api)
    await placer.placeAtEnd(1, 50)
    await placer.placeAtEnd(2, 60)
    expect(calls.views).toBe(2)

    placer.invalidate(1)
    await placer.placeAtEnd(1, 51)
    await placer.placeAtEnd(2, 61)
    expect(calls.views).toBe(3)

    placer.invalidate()
    await placer.placeAtEnd(1, 52)
    await placer.placeAtEnd(2, 62)
    expect(calls.views).toBe(5)
  })

  it('skips quietly when the project has no list view or the views cannot be read, and tries again later', async () => {
    const { api, calls, state } = fakeApi({ views: [otherView(9)] })
    const placer = createNewTaskPlacer(api)
    expect(await placer.placeAtEnd(1, 50)).toBe(false)
    state.views = [listView(7)]
    state.failViews = true
    expect(await placer.placeAtEnd(1, 51)).toBe(false)
    state.failViews = false
    expect(await placer.placeAtEnd(1, 52)).toBe(true)
    expect(calls.put).toHaveLength(1)
  })
})

describe('reading hints from the query cache', () => {
  const cache = (data: Record<string, unknown>) => ({
    getQueryData: <T,>(key: readonly unknown[]) => data[JSON.stringify(key)] as T | undefined,
  })

  it('finds the list view and the highest cached position', () => {
    const hints = readPositionHints(
      cache({
        '["project-views",4]': [otherView(9), listView(7)],
        '["view-tasks",4,7]': [taskAt(1, 100), taskAt(2, 900), { id: 3 } as Task],
      }),
      4
    )
    expect(hints).toEqual({ viewId: 7, maxPosition: 900 })
  })

  it('gives the view alone when the list is not cached, and nothing when the views are not', () => {
    expect(readPositionHints(cache({ '["project-views",4]': [listView(7)] }), 4)).toEqual({ viewId: 7 })
    expect(readPositionHints(cache({ '["project-views",4]': [listView(7)], '["view-tasks",4,7]': [] }), 4)).toEqual({ viewId: 7 })
    expect(readPositionHints(cache({}), 4)).toEqual({})
    expect(readPositionHints(cache({ '["project-views",4]': [otherView(9)] }), 4)).toEqual({})
  })
})

describe('placing in the background', () => {
  it('returns before the position update finishes and tells when it is done', async () => {
    let release: (value: ApiResult<unknown>) => void = () => {}
    let sent = false
    const api: PositionApi = {
      fetchProjectViews: async () => ok([listView(7)]),
      fetchViewTasks: async () => ok([]),
      updateTaskPosition: () => new Promise((resolve) => { sent = true; release = resolve }),
    }
    const placer = createNewTaskPlacer(api)
    const done = vi.fn()

    placeNewTaskInBackground(placer, 1, 50, { viewId: 7, maxPosition: 0 }, done)
    // The caller is already back; the update goes out and is still in flight.
    expect(done).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(sent).toBe(true))
    expect(done).not.toHaveBeenCalled()

    release(ok({}))
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith(true))
  })

  it('reports a position that could not be set', async () => {
    const { api } = fakeApi({ failPut: true })
    const done = vi.fn()
    placeNewTaskInBackground(createNewTaskPlacer(api), 1, 50, { viewId: 7, maxPosition: 0 }, done)
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith(false))
  })
})
