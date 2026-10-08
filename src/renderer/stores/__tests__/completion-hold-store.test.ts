import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPLETION_HOLD_MS, COMPLETION_TOAST_MS } from '../../../shared/completion-hold'
import { useCompletedTasksStore } from '../completed-tasks-store'
import { COLLAPSE_LIMIT_MS, completionHold, resetCompletionHold, setCompletionUndoHandler, useCompletionHoldStore } from '../completion-hold-store'
import { useToastStore } from '../toast-store'
import type { Task } from '@/lib/vikunja-types'

const task = (id: number) => ({ id, done: true, title: `Task ${id}` }) as Task

function complete(id: number, path = '/today') {
  useCompletedTasksStore.getState().add(task(id), path)
  completionHold.complete(id)
}
const held = () => [...useCompletionHoldStore.getState().held].sort((a, b) => a - b)
const inList = () => [...useCompletedTasksStore.getState().tasks.keys()].sort((a, b) => a - b)

describe('completion hold store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    resetCompletionHold()
    useToastStore.setState({ toasts: [] })
    useCompletedTasksStore.getState().clear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the row 5 s, then removes it from the list and shows the toast for 6 s', () => {
    complete(1)
    expect(held()).toEqual([1])
    vi.advanceTimersByTime(COMPLETION_HOLD_MS - 1)
    expect(inList()).toEqual([1])
    expect(useCompletionHoldStore.getState().toast).toBeNull()
    vi.advanceTimersByTime(1)
    expect(held()).toEqual([])
    // The row closes first (a fade and the height), the entry goes when it is done.
    expect([...useCompletionHoldStore.getState().collapsing]).toEqual([1])
    expect(inList()).toEqual([1])
    expect(useCompletionHoldStore.getState().toast).toEqual({ text: 'Completed', ids: [1] })
    vi.advanceTimersByTime(COLLAPSE_LIMIT_MS)
    expect(inList()).toEqual([])
    expect(useCompletionHoldStore.getState().collapsing.size).toBe(0)
    vi.advanceTimersByTime(COMPLETION_TOAST_MS - COLLAPSE_LIMIT_MS)
    expect(useCompletionHoldStore.getState().toast).toBeNull()
  })

  it('holds a row while the pointer is on it and counts 5 s from the moment it leaves', () => {
    completionHold.hoverRow(1, true)
    complete(1)
    vi.advanceTimersByTime(60_000)
    expect(held()).toEqual([1])
    completionHold.hoverRow(1, false)
    vi.advanceTimersByTime(COMPLETION_HOLD_MS - 1)
    expect(held()).toEqual([1])
    vi.advanceTimersByTime(1)
    expect(held()).toEqual([])
  })

  it('leaving the view collapses every held row at once and merges them into one toast', () => {
    complete(1)
    complete(2)
    completionHold.hoverRow(2, true)
    completionHold.navigate()
    expect(held()).toEqual([])
    expect(inList()).toEqual([])
    expect(useCompletionHoldStore.getState().toast).toEqual({ text: '2 completed', ids: [1, 2] })
  })

  it('unchecking a held row cancels the hold without a toast', () => {
    complete(1)
    completionHold.reopened(1)
    vi.advanceTimersByTime(60_000)
    expect(held()).toEqual([])
    expect(useCompletionHoldStore.getState().toast).toBeNull()
  })

  it('the row reports that it has closed and its entry goes at once', () => {
    complete(1)
    vi.advanceTimersByTime(COMPLETION_HOLD_MS)
    completionHold.finishCollapse(1)
    expect(inList()).toEqual([])
    expect(useCompletionHoldStore.getState().collapsing.size).toBe(0)
    vi.advanceTimersByTime(COLLAPSE_LIMIT_MS)
    expect(inList()).toEqual([])
  })

  it('Undo while the row is closing cancels the close and keeps the entry', () => {
    complete(1)
    vi.advanceTimersByTime(COMPLETION_HOLD_MS)
    expect(completionHold.takeUndo().map((e) => e.task.id)).toEqual([1])
    expect(useCompletionHoldStore.getState().collapsing.size).toBe(0)
    vi.advanceTimersByTime(COLLAPSE_LIMIT_MS)
    expect(inList()).toEqual([1])
  })

  it('leaving the view takes a closing row out at once', () => {
    complete(1)
    vi.advanceTimersByTime(COMPLETION_HOLD_MS)
    completionHold.navigate()
    expect(inList()).toEqual([])
    expect(useCompletionHoldStore.getState().collapsing.size).toBe(0)
  })

  it('hands the toast Undo the entries of the collapsed rows and removes the toast', () => {
    complete(1, '/project/3')
    complete(2, '/project/3')
    completionHold.navigate()
    const entries = completionHold.takeUndo()
    expect(entries.map((e) => [e.task.id, e.path])).toEqual([
      [1, '/project/3'],
      [2, '/project/3'],
    ])
    expect(useCompletionHoldStore.getState().toast).toBeNull()
    expect(completionHold.takeUndo()).toEqual([])
  })

  it('a task completed again after it collapsed (reopened elsewhere) is held again', () => {
    complete(1)
    vi.advanceTimersByTime(COMPLETION_HOLD_MS)
    expect(held()).toEqual([])
    complete(1)
    expect(held()).toEqual([1])
  })

  it('a stale pointer on a removed row does not hold it after it is completed again', () => {
    completionHold.hoverRow(1, true)
    complete(1)
    completionHold.navigate()
    completionHold.reopened(1)
    complete(1)
    vi.advanceTimersByTime(COMPLETION_HOLD_MS)
    expect(held()).toEqual([])
  })

  describe('the toast', () => {
    const toasts = () => useToastStore.getState().toasts

    it('shows "Completed" with Undo when a row collapses, then "2 completed", and leaves 6 s after the last change', () => {
      complete(1)
      vi.advanceTimersByTime(COMPLETION_HOLD_MS)
      expect(toasts().map((t) => [t.kind, t.message, t.action?.label])).toEqual([['success', 'Completed', 'Undo']])
      vi.advanceTimersByTime(500)
      complete(2)
      vi.advanceTimersByTime(COMPLETION_HOLD_MS)
      expect(toasts().map((t) => t.message)).toEqual(['2 completed'])
      vi.advanceTimersByTime(COMPLETION_TOAST_MS - 1)
      expect(toasts()).toHaveLength(1)
      vi.advanceTimersByTime(1)
      expect(toasts()).toHaveLength(0)
    })

    it('stays while the pointer is on it', () => {
      complete(1)
      vi.advanceTimersByTime(COMPLETION_HOLD_MS)
      const id = toasts()[0].id
      useToastStore.getState().engage(id, true)
      vi.advanceTimersByTime(60_000)
      expect(toasts()).toHaveLength(1)
      useToastStore.getState().engage(id, false)
      vi.advanceTimersByTime(COMPLETION_TOAST_MS)
      expect(toasts()).toHaveLength(0)
    })

    it('Undo runs the registered handler and the toast goes', () => {
      complete(1)
      completionHold.navigate()
      const handler = vi.fn(() => {
        expect(completionHold.takeUndo().map((e) => e.task.id)).toEqual([1])
      })
      setCompletionUndoHandler(handler)
      toasts()[0].action?.onAction()
      expect(handler).toHaveBeenCalledTimes(1)
      expect(toasts()).toHaveLength(0)
    })

    it('Dismiss closes the toast but keeps the rows collapsed', () => {
      complete(1)
      completionHold.navigate()
      useToastStore.getState().dismiss(toasts()[0].id)
      expect(toasts()).toHaveLength(0)
      expect(useCompletionHoldStore.getState().toast).toBeNull()
      expect(completionHold.takeUndo()).toEqual([])
    })

    it('survives a burst of other toasts while the pointer is on it, and still expires afterwards', () => {
      complete(1)
      vi.advanceTimersByTime(COMPLETION_HOLD_MS)
      const id = toasts()[0].id
      useToastStore.getState().engage(id, true)
      for (let i = 0; i < 6; i++) useToastStore.getState().push('error', `Failure ${i}`)
      expect(toasts().map((t) => t.message)).toContain('Completed')
      useToastStore.getState().engage(id, false)
      vi.advanceTimersByTime(COMPLETION_TOAST_MS)
      expect(toasts().map((t) => t.message)).not.toContain('Completed')
    })

    it('an evicted completion toast releases the machine, so the next collapse starts a fresh toast', () => {
      complete(1)
      vi.advanceTimersByTime(COMPLETION_HOLD_MS)
      const id = toasts()[0].id
      useToastStore.getState().engage(id, true)
      // Four toasts of the same kind of owner leave nothing else to drop: the oldest goes.
      for (let i = 0; i < 4; i++) useToastStore.getState().push('info', `Owned ${i}`, { key: `owned-${i}`, durationMs: null })
      expect(toasts().map((t) => t.message)).not.toContain('Completed')
      vi.advanceTimersByTime(COMPLETION_TOAST_MS)
      expect(useCompletionHoldStore.getState().toast).toBeNull()
      complete(2)
      vi.advanceTimersByTime(COMPLETION_HOLD_MS)
      expect(toasts().map((t) => t.message)).toContain('Completed')
    })

    it('a row reopened elsewhere takes the toast away when it was the only one', () => {
      complete(1)
      completionHold.navigate()
      completionHold.reopened(1)
      expect(toasts()).toHaveLength(0)
    })
  })
})
