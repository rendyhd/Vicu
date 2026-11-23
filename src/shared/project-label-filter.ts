/**
 * The label filter of a project page (docs/cross-app-semantics-v1.md, section 17.2). It lasts while
 * the page is open: nothing here is saved or synced. Android implements the same rules and both apps
 * run `projectLabelFilter` from test-fixtures/cross-app-semantics-v1.json against them.
 */

export interface LabelFilterLabel {
  id: number
  title: string
  hex_color?: string
}

export interface LabelFilterTask {
  id: number
  labels?: ReadonlyArray<LabelFilterLabel> | null
}

export interface LabelChoice<L extends LabelFilterLabel = LabelFilterLabel> {
  label: L
  /** How many of the page's tasks carry it. */
  count: number
}

/** By title in lowercase, compared by UTF-16 code units (not the locale), then by id. */
function compareLabels(a: LabelFilterLabel, b: LabelFilterLabel): number {
  const ta = a.title.toLowerCase()
  const tb = b.title.toLowerCase()
  if (ta !== tb) return ta < tb ? -1 : 1
  return a.id - b.id
}

/**
 * The labels the bar offers: those of `tasks` (the page's own and its sections', as listed), each
 * with how many tasks carry it, plus every `picked` label no task carries any more, with 0. A picked
 * label is looked up in `known` (every label of the account); one not found there is left out.
 */
export function labelFilterChoices<L extends LabelFilterLabel>(
  tasks: ReadonlyArray<{ id: number; labels?: ReadonlyArray<L> | null }>,
  picked: readonly number[],
  known: readonly L[] = [],
): LabelChoice<L>[] {
  const counts = new Map<number, { label: L; count: number }>()
  for (const task of tasks) {
    const seen = new Set<number>()
    for (const label of task.labels ?? []) {
      if (seen.has(label.id)) continue
      seen.add(label.id)
      const entry = counts.get(label.id)
      if (entry) entry.count += 1
      else counts.set(label.id, { label, count: 1 })
    }
  }
  for (const id of picked) {
    if (counts.has(id)) continue
    const label = known.find((candidate) => candidate.id === id)
    if (label) counts.set(id, { label, count: 0 })
  }
  return [...counts.values()].sort((a, b) => compareLabels(a.label, b.label))
}

/**
 * The tasks of a page the picked labels show, in the page's order. `parentOf` names the task a row
 * is nested under on the page: a row under a shown row is shown with it, whatever it carries. With
 * nothing picked every task shows.
 */
export function shownWithLabels<T extends LabelFilterTask>(
  tasks: readonly T[],
  picked: readonly number[],
  parentOf?: (task: T) => number | null | undefined,
): T[] {
  if (picked.length === 0) return [...tasks]
  const wanted = new Set(picked)
  const byId = new Map<number, T>()
  for (const task of tasks) byId.set(task.id, task)
  const decided = new Map<number, boolean>()
  const shown = (task: T, trail: Set<number>): boolean => {
    const known = decided.get(task.id)
    if (known !== undefined) return known
    let result = (task.labels ?? []).some((label) => wanted.has(label.id))
    if (!result && parentOf && !trail.has(task.id)) {
      trail.add(task.id)
      const parentId = parentOf(task)
      const parent = typeof parentId === 'number' ? byId.get(parentId) : undefined
      result = parent !== undefined && shown(parent, trail)
    }
    decided.set(task.id, result)
    return result
  }
  return tasks.filter((task) => shown(task, new Set()))
}
