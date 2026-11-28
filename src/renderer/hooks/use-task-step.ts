import { useCallback } from 'react'
import { useReorderTask } from './use-task-mutations'
import { reorderContextOf, useReorderStore } from '@/stores/reorder-store'
import { useSelectionStore } from '@/stores/selection-store'
import { announce } from '@/stores/announcer-store'
import { toast } from '@/stores/toast-store'
import { planTaskStep, taskStepRefusal, type TaskStep } from '@/lib/reorder-positions'
import { t } from '../../shared/i18n'

/** Whether the task can take a step in the list that holds it now (the row menu shows only those that can). */
export function canStepTask(taskId: number, step: TaskStep): boolean {
  const ctx = reorderContextOf(useReorderStore.getState(), taskId)
  return !!ctx && planTaskStep(ctx.tasks, taskId, step, ctx.order).ok
}

/**
 * Move up and Move down for a task row (Alt+Shift+Up/Down, the row menu): one place in its list
 * when the list's order allows it (cross-app semantics 12.4), else it says why. The keyboard focus
 * stays on the moved row. Returns false when no list on screen holds the task.
 */
export function useTaskStep() {
  const reorderTask = useReorderTask()

  return useCallback(
    (taskId: number, step: TaskStep): boolean => {
      const ctx = reorderContextOf(useReorderStore.getState(), taskId)
      if (!ctx) return false
      const index = ctx.tasks.findIndex((t) => t.id === taskId)
      const task = ctx.tasks[index]
      const result = planTaskStep(ctx.tasks, taskId, step, ctx.order)
      if (!result.ok) {
        const datedEdge = !!ctx.tasks[step === 'up' ? index - 1 : index + 1]
        const refusal = task ? taskStepRefusal(result, task.title, step, ctx.order, datedEdge) : null
        if (!refusal) return false
        if (refusal.toast) toast.info(refusal.message)
        else announce(refusal.message)
        return true
      }

      // A row the keyboard is on keeps the focus after the list draws it in its new place.
      const active = document.activeElement
      const keepFocus = !active || active === document.body || !!active.closest(`[data-task-id="${taskId}"]`)
      useSelectionStore.getState().setFocusedTask(taskId)
      reorderTask.mutate(
        { taskId, viewId: ctx.viewId, position: result.plan.position, renumbered: result.plan.renumbered },
        { onSuccess: () => announce(t(step === 'up' ? 'taskActions.movedUp' : 'taskActions.movedDown', { title: task.title })) },
      )
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`)
        if (!row) return
        row.scrollIntoView({ block: 'nearest' })
        if (keepFocus && !row.contains(document.activeElement)) row.focus({ preventScroll: true })
      })
      return true
    },
    [reorderTask],
  )
}
