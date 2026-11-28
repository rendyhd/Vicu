/**
 * Making an existing task a subtask of another, and taking it out again (docs/cross-app-semantics-v1.md
 * section 24). Android has the same rules (`SubtaskAttach`); both run the `subtaskAttach` vectors of
 * the contract fixture.
 *
 * This file stays free of imports so any tsconfig can include it.
 */

/** What the rules need to know about the tasks: each task's parents and its project. */
export interface SubtaskWorld {
  /** The ids of the task's parents (its `parenttask` relations); empty when it has none. */
  parentsOf(id: number): readonly number[]
  /** The task's project, or undefined when the task is not known. */
  projectOf(id: number): number | undefined
}

export type AttachRefusal = 'self' | 'already' | 'cycle'

/** What attaching one task to a parent sends, in this order: add, then remove, then move. */
export interface AttachPlan {
  task: number
  /** The parent to add (`PUT tasks/{parent}/relations`), or null when it is a parent already. */
  add: number | null
  /** The other parents the task leaves (`DELETE tasks/{parent}/relations/subtask/{task}`). */
  remove: number[]
  /** The project the task moves to, or null when it stays where it is. */
  project: number | null
}

/** Whether `ancestor` is `id` or above it, walking the parents; a loop in the data ends the walk. */
export function isAtOrAbove(world: SubtaskWorld, ancestor: number, id: number): boolean {
  const seen = new Set<number>()
  const queue = [id]
  while (queue.length > 0) {
    const next = queue.shift()!
    if (next === ancestor) return true
    if (seen.has(next)) continue
    seen.add(next)
    queue.push(...world.parentsOf(next))
  }
  return false
}

/** Why `task` cannot go under `parent`, or null when it can (24.1). */
export function attachRefusal(world: SubtaskWorld, task: number, parent: number): AttachRefusal | null {
  if (task === parent) return 'self'
  const parents = world.parentsOf(task)
  if (parents.length === 1 && parents[0] === parent) return 'already'
  // The parent is below the task: putting the task under it would make a loop.
  if (isAtOrAbove(world, task, parent)) return 'cycle'
  return null
}

/** What attaching `task` to `parent` sends, or the refusal (24.1). */
export function planAttach(world: SubtaskWorld, task: number, parent: number): AttachPlan | { refusal: AttachRefusal } {
  const refusal = attachRefusal(world, task, parent)
  if (refusal) return { refusal }
  const parents = world.parentsOf(task)
  const from = world.projectOf(task)
  const to = world.projectOf(parent)
  return {
    task,
    add: parents.includes(parent) ? null : parent,
    remove: [...new Set(parents.filter((id) => id !== parent))],
    project: to !== undefined && from !== undefined && to !== from ? to : null,
  }
}

export interface AttachManyPlan {
  plans: AttachPlan[]
  /** Selected tasks that go along with a selected task above them, and keep their parent. */
  kept: number[]
  refused: Array<{ task: number; refusal: AttachRefusal }>
}

/** Several selected tasks under one parent (24.2), in the order given. */
export function planAttachMany(world: SubtaskWorld, tasks: readonly number[], parent: number): AttachManyPlan {
  const selected = [...new Set(tasks)]
  const result: AttachManyPlan = { plans: [], kept: [], refused: [] }
  for (const task of selected) {
    // A task below another selected task goes along with it.
    if (selected.some((other) => other !== task && isAtOrAbove(world, other, task))) {
      result.kept.push(task)
      continue
    }
    const plan = planAttach(world, task, parent)
    if ('refusal' in plan) result.refused.push({ task, refusal: plan.refusal })
    else result.plans.push(plan)
  }
  return result
}

/** What Undo sends after a plan went through: the plan the other way round (24.1). */
export interface UndoAttachPlan {
  task: number
  /** The relation to delete again, or null when the parent was there already. */
  remove: number | null
  /** The parents to add back. */
  add: number[]
  /** The project to move back to, or null. */
  project: number | null
}

export function undoAttach(plan: AttachPlan, fromProject: number | undefined): UndoAttachPlan {
  return {
    task: plan.task,
    remove: plan.add,
    add: [...plan.remove],
    project: plan.project !== null && fromProject !== undefined ? fromProject : null,
  }
}

/** A task the picker may offer as the parent (24.3). */
export interface ParentCandidate {
  id: number
  title: string
  project: number
  done?: boolean
  /** A hidden task (section 10), worked out by the caller. */
  hidden?: boolean
}

export interface CandidateOptions {
  /** The tasks being attached; the first one's project comes first. */
  attaching: readonly number[]
  /** Projects the person can write to. */
  writable: ReadonlySet<number>
  /** What the person typed; blank offers only tasks of the first task's project. */
  search: string
  limit?: number
}

/** The tasks offered as a parent, in order: the first task's project first, then the rest as listed. */
export function parentCandidates<T extends ParentCandidate>(world: SubtaskWorld, tasks: readonly T[], options: CandidateOptions): T[] {
  const words = options.search.trim().toLocaleLowerCase()
  const home = options.attaching.length > 0 ? world.projectOf(options.attaching[0]) : undefined
  const offered = tasks.filter((task) => {
    if (task.done || task.hidden || !options.writable.has(task.project)) return false
    // Not one of the tasks being attached, and not below one of them.
    if (options.attaching.some((id) => isAtOrAbove(world, id, task.id))) return false
    // Already the only parent of every task being attached: nothing would change.
    if (options.attaching.every((id) => attachRefusal(world, id, task.id) === 'already')) return false
    if (!words) return task.project === home
    return task.title.toLocaleLowerCase().includes(words)
  })
  const ordered = [...offered.filter((task) => task.project === home), ...offered.filter((task) => task.project !== home)]
  return options.limit === undefined ? ordered : ordered.slice(0, options.limit)
}

export interface ChildCandidateOptions {
  parent: number
  writable: ReadonlySet<number>
  /** What the person typed; blank offers only tasks of the parent's project. */
  search: string
  limit?: number
}

/**
 * The tasks offered by "Add existing task" under `parent` (24.3): open, not hidden, in a writable
 * project, and able to go under the parent by 24.1; the parent's project first.
 */
export function childCandidates<T extends ParentCandidate>(world: SubtaskWorld, tasks: readonly T[], options: ChildCandidateOptions): T[] {
  const words = options.search.trim().toLocaleLowerCase()
  const home = world.projectOf(options.parent)
  const offered = tasks.filter((task) => {
    if (task.done || task.hidden || !options.writable.has(task.project)) return false
    if (attachRefusal(world, task.id, options.parent) !== null) return false
    if (!words) return task.project === home
    return task.title.toLocaleLowerCase().includes(words)
  })
  const ordered = [...offered.filter((task) => task.project === home), ...offered.filter((task) => task.project !== home)]
  return options.limit === undefined ? ordered : ordered.slice(0, options.limit)
}

/** A world over plain maps, for the vectors and for callers that build one from a task list. */
export function subtaskWorld(parents: ReadonlyMap<number, readonly number[]>, projects: ReadonlyMap<number, number>): SubtaskWorld {
  return {
    parentsOf: (id) => parents.get(id) ?? [],
    projectOf: (id) => projects.get(id),
  }
}

type ListedTask = {
  id: number
  project_id: number
  related_tasks?: { parenttask?: ReadonlyArray<{ id: number }>; subtask?: ReadonlyArray<{ id: number }> } | null
}

/**
 * A world from tasks as the API lists them (`project_id`, and the relations from both sides:
 * a task's `parenttask` and a parent's `subtask`, so a relation listed on one side only counts).
 */
export function subtaskWorldOf(tasks: ReadonlyArray<ListedTask>): SubtaskWorld {
  const parents = new Map<number, Set<number>>()
  const projects = new Map<number, number>()
  const link = (child: number, parent: number) => {
    if (typeof child !== 'number' || typeof parent !== 'number') return
    const set = parents.get(child) ?? new Set<number>()
    set.add(parent)
    parents.set(child, set)
  }
  for (const task of tasks) {
    projects.set(task.id, task.project_id)
    for (const parent of task.related_tasks?.parenttask ?? []) link(task.id, parent.id)
    for (const child of task.related_tasks?.subtask ?? []) link(child.id, task.id)
  }
  return subtaskWorld(new Map([...parents].map(([id, set]) => [id, [...set]])), projects)
}
