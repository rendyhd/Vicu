import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OPEN_REQUEST_TTL_MS, openTaskInApp, routeForTask, type OpenTaskDeps } from '../open-task'
import { useSelectionStore } from '@/stores/selection-store'

const task = (overrides: Record<string, unknown> = {}) => ({ id: 42, project_id: 9, done: false, ...overrides })

describe('routeForTask (F5)', () => {
  it('opens a task of the inbox project in the inbox', () => {
    expect(routeForTask(task({ project_id: 5 }), 5)).toEqual({ to: '/inbox' })
  })

  it('opens a task of another project in that project', () => {
    expect(routeForTask(task({ project_id: 9 }), 5)).toEqual({ to: '/project/$projectId', params: { projectId: '9' } })
  })

  it('opens a completed task in the logbook, where completed tasks are listed', () => {
    expect(routeForTask(task({ done: true }), 5)).toEqual({ to: '/logbook' })
  })

  it('does not take every task for an inbox task when no inbox project is configured', () => {
    expect(routeForTask(task({ project_id: 0 }), 0)).toEqual({ to: '/project/$projectId', params: { projectId: '0' } })
  })
})

describe('openTaskInApp (F5): a clicked reminder or Quick View "open in app" shows the task in the main window', () => {
  let fetchTask: ReturnType<typeof vi.fn>
  let navigate: ReturnType<typeof vi.fn>
  let notify: ReturnType<typeof vi.fn>
  const deps = (): OpenTaskDeps => ({
    fetchTask: fetchTask as unknown as OpenTaskDeps['fetchTask'],
    inboxProjectId: async () => 5,
    navigate: navigate as unknown as OpenTaskDeps['navigate'],
    notify: notify as unknown as OpenTaskDeps['notify'],
  })

  beforeEach(() => {
    useSelectionStore.setState({ expandedTaskId: null, focusedTaskId: null, pendingOpenTaskId: null })
    fetchTask = vi.fn(async () => ({ success: true as const, data: task() }))
    navigate = vi.fn()
    notify = vi.fn()
  })

  it('looks the task up, goes to its list and asks that list to expand it', async () => {
    await openTaskInApp(deps(), 42)

    expect(fetchTask).toHaveBeenCalledWith(42)
    expect(navigate).toHaveBeenCalledWith({ to: '/project/$projectId', params: { projectId: '9' } })
    expect(useSelectionStore.getState().pendingOpenTaskId).toBe(42)
  })

  it('goes to the inbox for an inbox task', async () => {
    fetchTask.mockResolvedValue({ success: true, data: task({ project_id: 5 }) })
    await openTaskInApp(deps(), 42)
    expect(navigate).toHaveBeenCalledWith({ to: '/inbox' })
  })

  it('says so, and goes nowhere, when the task cannot be fetched', async () => {
    fetchTask.mockResolvedValue({ success: false, error: 'Not found', statusCode: 404 })

    await openTaskInApp(deps(), 42)

    expect(navigate).not.toHaveBeenCalled()
    expect(useSelectionStore.getState().pendingOpenTaskId).toBeNull()
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Could not open the task'))
  })

  it.each([0, -3, 1.5, Number.NaN, '12', null, undefined])('ignores an id that is not a task id: %s', async (bad) => {
    await openTaskInApp(deps(), bad as unknown as number)
    expect(fetchTask).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('a second request replaces the first', async () => {
    await openTaskInApp(deps(), 42)
    fetchTask.mockResolvedValue({ success: true, data: task({ id: 43 }) })
    await openTaskInApp(deps(), 43)
    expect(useSelectionStore.getState().pendingOpenTaskId).toBe(43)
  })

  it('drops a request nobody took after a while, so it cannot expand a task much later', async () => {
    vi.useFakeTimers()
    try {
      await openTaskInApp(deps(), 42)
      expect(useSelectionStore.getState().pendingOpenTaskId).toBe(42)
      vi.advanceTimersByTime(OPEN_REQUEST_TTL_MS + 1)
      expect(useSelectionStore.getState().pendingOpenTaskId).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('selection store: the requested task is expanded by its row once it is on screen (F5)', () => {
  beforeEach(() => {
    useSelectionStore.setState({ expandedTaskId: 7, focusedTaskId: 7, pendingOpenTaskId: null })
  })

  it('openRequestedTask expands and focuses the requested task and clears the request', () => {
    useSelectionStore.getState().requestOpenTask(42)
    expect(useSelectionStore.getState().pendingOpenTaskId).toBe(42)

    useSelectionStore.getState().openRequestedTask(42)

    expect(useSelectionStore.getState()).toMatchObject({ expandedTaskId: 42, focusedTaskId: 42, pendingOpenTaskId: null })
  })

  it('does nothing for a task nobody asked for, so another row cannot take the request', () => {
    useSelectionStore.getState().requestOpenTask(42)
    useSelectionStore.getState().openRequestedTask(43)
    expect(useSelectionStore.getState()).toMatchObject({ expandedTaskId: 7, focusedTaskId: 7, pendingOpenTaskId: 42 })
  })

  it('clearOpenRequest drops a request that is still waiting, and only that one', () => {
    useSelectionStore.getState().requestOpenTask(42)
    useSelectionStore.getState().clearOpenRequest(41)
    expect(useSelectionStore.getState().pendingOpenTaskId).toBe(42)
    useSelectionStore.getState().clearOpenRequest(42)
    expect(useSelectionStore.getState().pendingOpenTaskId).toBeNull()
  })
})
