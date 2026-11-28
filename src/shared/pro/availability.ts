/**
 * Availability (docs/cross-app-semantics-v1.md section 21.2): whether an open task can be done now,
 * and if not, why. Both apps run the `pro.availability` vectors. Pure and O(n): the context is built
 * once from every open task and answers each task from precomputed maps.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { isHiddenTask } from '../hidden-tasks'
import { resolveTaskOrder, sortTasksByOrder, type OrderableTask } from '../task-order'
import { finalVerdictOf, recordValue, type ProLedger } from './ledger'
import { labelOnHold, projectMode, projectOnHold } from './prefs'
import { startsLater, type StartFields } from './start-dates'

/** The reasons in the order rows show them; a row shows the first. */
export const AVAILABILITY_REASONS = ['starts', 'on_hold', 'waiting', 'after', 'sequence', 'theirs'] as const
export type AvailabilityReason = (typeof AVAILABILITY_REASONS)[number]

export type AvailabilityView = 'available' | 'remaining' | 'all'

export function readAvailabilityView(value: unknown): AvailabilityView | null {
  return value === 'available' || value === 'remaining' || value === 'all' ? value : null
}

export interface AvailabilityTask extends OrderableTask, StartFields {
  id: number
  project_id: number
  done?: boolean
  description?: string | null
  labels?: ReadonlyArray<{ id: number }> | null
  related_tasks?: {
    blocked?: ReadonlyArray<{ id: number; done?: boolean }> | null
    parenttask?: ReadonlyArray<{ id: number }> | null
    [kind: string]: unknown
  } | null
}

export interface AvailabilityProject {
  id: number
  parent_project_id?: number | null
}

export interface AvailabilityInput {
  now: Date
  /** Every open task the device knows (done ones may be given too; they never block). */
  tasks: readonly AvailabilityTask[]
  projects: readonly AvailabilityProject[]
  /** Synced preference values by key. */
  prefs: Readonly<Record<string, unknown>>
  ledger?: ProLedger | null
}

export interface Availability {
  available: boolean
  reasons: AvailabilityReason[]
  /** The first task of a sequential project (the "Next" pill). */
  next: boolean
  /** Open tasks it waits on ("after"), for the row text. */
  blockers: number[]
}

export interface AvailabilityContext {
  of(task: AvailabilityTask): Availability
  /** Tasks in a blocked-by loop; their loop is ignored. Sorted. */
  cycles: number[]
}

const OPEN: Availability = { available: true, reasons: [], next: false, blockers: [] }

function parentOf(task: AvailabilityTask): number | null {
  const parent = task.related_tasks?.parenttask?.[0]?.id
  return typeof parent === 'number' && parent > 0 ? parent : null
}

/** Strongly connected components of size > 1 (and self loops) in the blocked-by graph. */
function loops(edges: Map<number, number[]>): Set<string> {
  // Iterative Tarjan; an edge inside one component is a loop edge, kept as "from>to".
  let index = 0
  const indices = new Map<number, number>()
  const lowlinks = new Map<number, number>()
  const onStack = new Set<number>()
  const stack: number[] = []
  const component = new Map<number, number>()
  let componentId = 0
  for (const root of edges.keys()) {
    if (indices.has(root)) continue
    const work: Array<{ node: number; next: number }> = [{ node: root, next: 0 }]
    indices.set(root, index)
    lowlinks.set(root, index++)
    stack.push(root)
    onStack.add(root)
    while (work.length) {
      const frame = work[work.length - 1]
      const targets = edges.get(frame.node) ?? []
      if (frame.next < targets.length) {
        const target = targets[frame.next++]
        if (!edges.has(target)) continue
        if (!indices.has(target)) {
          indices.set(target, index)
          lowlinks.set(target, index++)
          stack.push(target)
          onStack.add(target)
          work.push({ node: target, next: 0 })
        } else if (onStack.has(target)) {
          lowlinks.set(frame.node, Math.min(lowlinks.get(frame.node)!, indices.get(target)!))
        }
        continue
      }
      work.pop()
      if (work.length) {
        const parent = work[work.length - 1].node
        lowlinks.set(parent, Math.min(lowlinks.get(parent)!, lowlinks.get(frame.node)!))
      }
      if (lowlinks.get(frame.node) === indices.get(frame.node)) {
        let member: number
        do {
          member = stack.pop()!
          onStack.delete(member)
          component.set(member, componentId)
        } while (member !== frame.node)
        componentId++
      }
    }
  }
  const loopEdges = new Set<string>()
  for (const [from, targets] of edges) {
    for (const to of targets) {
      if (edges.has(to) && component.get(from) === component.get(to)) loopEdges.add(`${from}>${to}`)
    }
  }
  return loopEdges
}

/** Builds the context once; `of(task)` then answers in constant time per task (plus its blockers). */
export function availabilityContext(input: AvailabilityInput): AvailabilityContext {
  const { now, prefs } = input
  const ledger = input.ledger ?? null
  const projects = new Map(input.projects.map((project) => [project.id, project]))
  const parentProject = (id: number) => projects.get(id)?.parent_project_id ?? null

  const open = new Map<number, AvailabilityTask>()
  const doneIds = new Set<number>()
  for (const task of input.tasks) {
    if (task.done) doneIds.add(task.id)
    else if (!isHiddenTask(task.description)) open.set(task.id, task)
  }

  // On hold: the project or an ancestor, by status or a parked initiative.
  const holdCache = new Map<number, boolean>()
  const projectHeld = (projectId: number): boolean => {
    const cached = holdCache.get(projectId)
    if (cached !== undefined) return cached
    holdCache.set(projectId, false)
    const initiative = recordValue(ledger?.initiatives, projectId)
    const parent = parentProject(projectId)
    const held = projectOnHold(prefs, projectId) ||
      initiative?.status === 'parked' ||
      (typeof parent === 'number' && parent > 0 && projects.has(parent) ? projectHeld(parent) : false)
    holdCache.set(projectId, held)
    return held
  }

  // After: open blockers, without loop edges.
  const isOpenBlocker = (entry: { id: number; done?: boolean }) =>
    open.has(entry.id) ? true : doneIds.has(entry.id) ? false : entry.done !== true
  const edges = new Map<number, number[]>()
  for (const task of open.values()) {
    const blockers = (task.related_tasks?.blocked ?? []).filter(isOpenBlocker).map((entry) => entry.id)
    edges.set(task.id, blockers)
  }
  const loopEdges = loops(edges)
  const cycles = new Set<number>()
  for (const edge of loopEdges) for (const id of edge.split('>')) cycles.add(Number(id))

  // Sequence: per sequential project, its first top-level open task.
  const topOf = (task: AvailabilityTask): AvailabilityTask => {
    let current = task
    const seen = new Set<number>([task.id])
    for (;;) {
      const parentId = parentOf(current)
      const parent = parentId !== null ? open.get(parentId) : undefined
      if (!parent || parent.project_id !== task.project_id || seen.has(parent.id)) return current
      seen.add(parent.id)
      current = parent
    }
  }
  const firstOf = new Map<number, number | null>()
  let topsByProject: Map<number, AvailabilityTask[]> | null = null
  const sequenceFirst = (projectId: number): number | null => {
    if (firstOf.has(projectId)) return firstOf.get(projectId)!
    if (!topsByProject) {
      topsByProject = new Map()
      for (const candidate of open.values()) {
        if (projectMode(prefs, candidate.project_id) !== 'sequential' || topOf(candidate) !== candidate) continue
        const list = topsByProject.get(candidate.project_id) ?? []
        list.push(candidate)
        topsByProject.set(candidate.project_id, list)
      }
    }
    const tops = topsByProject.get(projectId) ?? []
    const order = resolveTaskOrder(projectId, parentProject, prefs)
    const first = sortTasksByOrder(tops, order)[0]?.id ?? null
    firstOf.set(projectId, first)
    return first
  }

  return {
    cycles: [...cycles].sort((a, b) => a - b),
    of(task: AvailabilityTask): Availability {
      if (task.done) return OPEN
      const reasons: AvailabilityReason[] = []
      if (startsLater(task, now)) reasons.push('starts')
      if (projectHeld(task.project_id)) reasons.push('on_hold')
      if ((task.labels ?? []).some((label) => labelOnHold(prefs, label.id))) reasons.push('waiting')
      const blockers = (edges.get(task.id) ?? (task.related_tasks?.blocked ?? []).filter(isOpenBlocker).map((entry) => entry.id))
        .filter((id) => !loopEdges.has(`${task.id}>${id}`))
      if (blockers.length) reasons.push('after')
      let next = false
      if (projectMode(prefs, task.project_id) === 'sequential') {
        const first = sequenceFirst(task.project_id)
        const top = open.has(task.id) ? topOf(task).id : task.id
        if (top !== first) reasons.push('sequence')
        else next = top === task.id
      }
      const promise = recordValue(ledger?.promises, task.id)
      if (promise?.dir === 'theirs' && !finalVerdictOf(promise)) reasons.push('theirs')
      return { available: reasons.length === 0, reasons, next, blockers }
    },
  }
}

/** The tasks a view shows: Available (open, no reason), Remaining (open) or All (as given). */
export function filterByView<T extends AvailabilityTask>(
  tasks: readonly T[],
  view: AvailabilityView,
  context: AvailabilityContext,
): T[] {
  if (view === 'all') return [...tasks]
  if (view === 'remaining') return tasks.filter((task) => !task.done)
  return tasks.filter((task) => !task.done && context.of(task).available)
}
