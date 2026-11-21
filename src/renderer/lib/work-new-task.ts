import type { OfflineLabelRef } from '../../shared/offline-queue-types'

/**
 * What a task made now gets in Work mode (cross-app semantics 22.6): the work label when the task
 * would not be work without it, and a notice when no label is set and the task stays Personal.
 */
export interface NewTaskWorkPlan {
  /** The label to add on top of the task's own, or null. */
  labelId: number | null
  /** The task stays Personal because no work label is set: say so. */
  staysPersonal: boolean
}

export interface NewTaskWorkInput {
  projectId: number
  /** The labels the task names itself (picked or typed), as the create knows them. */
  named: ReadonlyArray<{ id: number }>
  /** A copy and anything the app makes for itself get nothing. */
  optOut?: boolean
  labelForNewTask: (task: { project_id: number; labels: ReadonlyArray<{ id: number }> }) => number | null
  staysPersonal: (task: { project_id: number; labels: ReadonlyArray<{ id: number }> }) => boolean
}

export const NO_WORK_PLAN: NewTaskWorkPlan = { labelId: null, staysPersonal: false }

export function planNewTaskWork(input: NewTaskWorkInput): NewTaskWorkPlan {
  if (input.optOut) return NO_WORK_PLAN
  const task = { project_id: input.projectId, labels: input.named }
  return { labelId: input.labelForNewTask(task), staysPersonal: input.staysPersonal(task) }
}

/**
 * The ids of the labels a create names: the ids it carries, and the titles it carries that match a
 * known label (a label not made yet is never the work label, which always exists).
 */
export function namedLabelIds(
  refs: ReadonlyArray<OfflineLabelRef> | undefined,
  known: ReadonlyArray<{ id: number; title: string }> | undefined,
): { id: number }[] {
  const ids = new Set<number>()
  for (const ref of refs ?? []) {
    if (typeof ref.id === 'number') ids.add(ref.id)
    else if (ref.title) {
      const wanted = ref.title.toLowerCase()
      const match = known?.find((label) => label.title.toLowerCase() === wanted)
      if (match) ids.add(match.id)
    }
  }
  return [...ids].map((id) => ({ id }))
}
