import { useCallback, useEffect, useMemo } from 'react'
import type { FocusEvent } from 'react'
import { useUncompleteTask } from '@/hooks/use-task-mutations'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { completionHold } from '@/stores/completion-hold-store'

/**
 * Pointer and keyboard-focus engagement of one task row, for the completion hold. A completed row is
 * held while either is on it; tracked from before the completion, so a row completed under the
 * pointer stays until the pointer leaves. Only keyboard (`:focus-visible`) focus counts: a mouse
 * click leaves focus on the checkbox, and that must not hold the row once the pointer is gone.
 * Spread the result on the row element; `onFocus` can be called from an existing focus handler.
 */
export function useCompletionHoldEngagement(taskId: number) {
  useEffect(
    () => () => {
      // The row element is gone, so it can no longer report the pointer or focus leaving.
      completionHold.hoverRow(taskId, false)
      completionHold.focusRow(taskId, false)
    },
    [taskId]
  )

  return useMemo(
    () => ({
      onPointerEnter: () => completionHold.hoverRow(taskId, true),
      onPointerLeave: () => completionHold.hoverRow(taskId, false),
      onFocus: (e: FocusEvent<HTMLElement>) => {
        if (e.target.matches(':focus-visible')) completionHold.focusRow(taskId, true)
      },
      onBlur: (e: FocusEvent<HTMLElement>) => {
        // Focus moving between the row's own controls is not leaving the row.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) completionHold.focusRow(taskId, false)
      },
    }),
    [taskId]
  )
}

/**
 * Undo on the completion toast: every task it covers goes back into the completed-tasks store as an
 * entry (so the reopen finds its auto-completed subtasks and the row returns in place) and gets
 * `{ done: false }`, one request each.
 */
export function useUndoCompletedTasks() {
  const uncomplete = useUncompleteTask()
  const mutate = uncomplete.mutate
  return useCallback(() => {
    for (const entry of completionHold.takeUndo()) {
      useCompletedTasksStore
        .getState()
        .add(entry.task, entry.path, entry.autoCompletedSubtasks, entry.suppressTopLevelUndo)
      mutate(entry.task)
    }
  }, [mutate])
}
