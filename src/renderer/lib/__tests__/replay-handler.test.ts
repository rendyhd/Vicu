import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { handleReplayed } from '../replay-handler'
import { useSelectionStore } from '@/stores/selection-store'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import type { OfflineReplayEvent } from '../../../shared/offline-queue-types'
import type { Task } from '../vikunja-types'

const event = (overrides: Partial<OfflineReplayEvent> = {}): OfflineReplayEvent => ({
  applied: 1,
  failed: 0,
  stopped: null,
  idMap: {},
  counts: { pending: 0, failed: 0 },
  ...overrides,
})

const task = (id: number) => ({ id, title: `Task ${id}`, project_id: 1, done: false, labels: [] }) as unknown as Task

function setup() {
  const qc = new QueryClient()
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const deps = { remapStores: vi.fn(), refreshReminders: vi.fn() }
  return { qc, invalidate, deps }
}

describe('handleReplayed', () => {
  it('swaps temp ids for the real ids in the cache and tells the stores', () => {
    const { qc, deps } = setup()
    qc.setQueryData(['tasks', {}], [task(-3), task(5)])

    handleReplayed(qc, event({ idMap: { '-3': 812 } }), deps)

    expect((qc.getQueryData(['tasks', {}]) as Task[]).map((t) => t.id)).toEqual([812, 5])
    expect(deps.remapStores).toHaveBeenCalledWith(new Map([[-3, 812]]))
  })

  it('refetches the task lists once the queue is empty', () => {
    const { qc, invalidate, deps } = setup()

    handleReplayed(qc, event(), deps)

    expect(invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey)).toEqual([
      ['tasks'],
      ['view-tasks'],
      ['section-tasks'],
      ['task-detail'],
      ['project-counts'],
    ])
  })

  it('leaves the lists alone while changes are still waiting, so queued edits do not vanish', () => {
    const { qc, invalidate, deps } = setup()

    handleReplayed(qc, event({ applied: 2, counts: { pending: 1, failed: 0 }, stopped: 'network' }), deps)

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('refetches when the queue emptied because the server refused the changes, so rolled-back state is shown', () => {
    const { qc, invalidate, deps } = setup()

    handleReplayed(qc, event({ applied: 0, failed: 2, counts: { pending: 0, failed: 2 } }), deps)

    expect(invalidate).toHaveBeenCalled()
  })

  it('refreshes reminders when something was applied, not when nothing was', () => {
    const { qc, deps } = setup()
    handleReplayed(qc, event({ applied: 0, failed: 0, stopped: 'auth', counts: { pending: 1, failed: 0 } }), deps)
    expect(deps.refreshReminders).not.toHaveBeenCalled()
    handleReplayed(qc, event(), deps)
    expect(deps.refreshReminders).toHaveBeenCalledTimes(1)
  })

  it('ignores ids that are not temp ids', () => {
    const { qc, deps } = setup()
    handleReplayed(qc, event({ idMap: { '5': 6, '-2': 0 } }), deps)
    expect(deps.remapStores).not.toHaveBeenCalled()
  })
})

describe('id remap in the UI stores', () => {
  it('keeps an expanded, focused or selected pending task selected under its real id', () => {
    useSelectionStore.setState({
      expandedTaskId: -3,
      focusedTaskId: -3,
      selectedTaskIds: new Set([-3, 7]),
      selectionAnchorId: -3,
    })

    useSelectionStore.getState().remapTaskIds(new Map([[-3, 812]]))

    const state = useSelectionStore.getState()
    expect(state.expandedTaskId).toBe(812)
    expect(state.focusedTaskId).toBe(812)
    expect(state.selectionAnchorId).toBe(812)
    expect([...state.selectedTaskIds].sort((a, b) => a - b)).toEqual([7, 812])
  })

  it('leaves the selection untouched when no selected task was remapped', () => {
    useSelectionStore.setState({ expandedTaskId: 4, focusedTaskId: null, selectedTaskIds: new Set([4]), selectionAnchorId: 4 })
    const before = useSelectionStore.getState()

    before.remapTaskIds(new Map([[-3, 812]]))

    expect(useSelectionStore.getState().selectedTaskIds).toBe(before.selectedTaskIds)
  })

  it('moves a recently completed pending task to its real id', () => {
    useCompletedTasksStore.setState({ tasks: new Map([[-3, { task: task(-3), path: '/inbox' }]]) })

    useCompletedTasksStore.getState().remapTaskIds(new Map([[-3, 812]]))

    const tasks = useCompletedTasksStore.getState().tasks
    expect([...tasks.keys()]).toEqual([812])
    expect(tasks.get(812)?.task.id).toBe(812)
  })
})
