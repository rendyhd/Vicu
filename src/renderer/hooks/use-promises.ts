import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCompleteTask, useUncompleteTask, useUpdateTask } from './use-task-mutations'
import { currentLedger, newLedgerId, setRecord, useProLedger, writeLedger } from './use-pro-ledger'
import { usePro, useSaveProConfig } from './use-pro'
import { useProPrefs } from './use-pro-prefs'
import { useProjects } from './use-projects'
import { toast } from '@/stores/toast-store'
import { NULL_DATE } from '@/lib/constants'
import type { Task } from '@/lib/vikunja-types'
import { toLocalDate, type LocalDate } from '../../shared/due-dates'
import { finalVerdictOf, type PromiseValue, type VerdictKind } from '../../shared/pro/ledger'
import {
  buildVerdict,
  canSnooze,
  completedElsewhere,
  needsVerdict,
  promiseOf,
  readVerdictSnoozes,
  snoozeFor,
  withVerdict,
  withVerdictUndone,
} from '../../shared/pro/promises'
import { inProArea, readProArea, type AreaProject } from '../../shared/pro/settings'

export const VERDICT_LABELS: Record<VerdictKind, string> = {
  delivered: 'Delivered',
  late: 'Late',
  not_yet: 'Not yet',
  renegotiated: 'New date',
  dropped: 'Dropped',
  taken_over: 'I did it',
}

/** The verdict buttons in their order (keys 1 to 5, then 6 for Ask me tomorrow; design system 9). */
export const VERDICT_ORDER: VerdictKind[] = ['delivered', 'late', 'not_yet', 'renegotiated', 'dropped']

/**
 * Promises (cross-app semantics 21.6): the record of a task, while the promises layer is on and the
 * task's project is in the area. Off, every task reads as no promise.
 */
export function usePromiseOf(): (task: Pick<Task, 'id' | 'project_id'>) => PromiseValue | null {
  const pro = usePro()
  const on = pro.layer('promises')
  const { ledger } = useProLedger()
  const { values } = useProPrefs()
  const { data: projects } = useProjects()
  return useMemo(() => {
    if (!on) return () => null
    const area = readProArea(values['pro.area'])
    const map = new Map<number, AreaProject>((projects?.all ?? []).map((project) => [project.id, project]))
    const categoryOf = (id: number) => {
      const value = values[`category.project.${id}`]
      return typeof value === 'string' ? value : null
    }
    return (task) => {
      const promise = promiseOf(ledger, task.id)
      if (!promise) return null
      return inProArea(task.project_id, area, map, categoryOf) ? promise : null
    }
  }, [on, ledger, values, projects?.all])
}

/** Verdicts, snoozes and making a task a promise; each with Undo where it changes the task. */
export function usePromiseActions() {
  const queryClient = useQueryClient()
  const complete = useCompleteTask()
  const uncomplete = useUncompleteTask()
  const update = useUpdateTask()
  const { config } = usePro()
  const save = useSaveProConfig()

  const verdict = useCallback(
    (task: Task, kind: VerdictKind, options: { newDue?: LocalDate | null; blocker?: string | null } = {}) => {
      const before = promiseOf(currentLedger(queryClient), task.id)
      if (!before) return
      const change = buildVerdict(task, kind, { id: newLedgerId(), at: new Date().toISOString(), ...options })
      void writeLedger(queryClient, [setRecord('promises', task.id, withVerdict(before, change.verdict))])
      const oldDue = task.due_date
      if (change.taskPatch?.done) complete.mutate(task)
      else if (typeof change.taskPatch?.due_date === 'string') update.mutate({ id: task.id, changes: { due_date: change.taskPatch.due_date }, original: task })
      toast.success(`${VERDICT_LABELS[kind]}: ${task.title}`, {
        action: {
          label: 'Undo',
          onAction: () => {
            const now = promiseOf(currentLedger(queryClient), task.id)
            if (now) void writeLedger(queryClient, [setRecord('promises', task.id, withVerdictUndone(now, change.verdict.id))])
            if (change.taskPatch?.done) uncomplete.mutate({ ...task, done: true })
            else if (change.taskPatch?.due_date) update.mutate({ id: task.id, changes: { due_date: oldDue || NULL_DATE }, original: { ...task, due_date: change.taskPatch.due_date as string } })
          },
        },
      })
    },
    [queryClient, complete, uncomplete, update],
  )

  /** "Ask me tomorrow", once per due day (decision 10). */
  const snooze = useCallback(
    (task: Task) => {
      const promise = promiseOf(currentLedger(queryClient), task.id)
      const entry = snoozeFor(task, promise, toLocalDate(new Date()))
      if (!entry) return
      void save({ pro_verdict_snooze: { ...readVerdictSnoozes(config?.pro_verdict_snooze), [String(task.id)]: entry } })
    },
    [queryClient, save, config?.pro_verdict_snooze],
  )

  /** Makes a task someone's promise (or yours to them); `null` removes the promise. */
  const setPromise = useCallback(
    (task: Pick<Task, 'id'>, value: PromiseValue | null) => void writeLedger(queryClient, [setRecord('promises', task.id, value)]),
    [queryClient],
  )

  return { verdict, snooze, setPromise }
}

/** What Today asks (decision 10, 11): promises of theirs due for a verdict, and ones completed elsewhere. */
export function usePromisesDue(tasks: readonly Task[]): { due: Task[]; askedDone: Task[]; canSnooze: (task: Task) => boolean } {
  const promiseFor = usePromiseOf()
  const { config } = usePro()
  return useMemo(() => {
    const today = toLocalDate(new Date())
    const snoozes = readVerdictSnoozes(config?.pro_verdict_snooze)
    const due: Task[] = []
    const askedDone: Task[] = []
    for (const task of tasks) {
      const promise = promiseFor(task)
      if (!promise) continue
      if (needsVerdict(task, promise, today, snoozes[String(task.id)])) due.push(task)
      else if (completedElsewhere(task, promise)) askedDone.push(task)
    }
    return {
      due,
      askedDone,
      canSnooze: (task) => canSnooze(task, promiseFor(task), snoozes[String(task.id)]),
    }
  }, [tasks, promiseFor, config?.pro_verdict_snooze])
}

export { finalVerdictOf }
