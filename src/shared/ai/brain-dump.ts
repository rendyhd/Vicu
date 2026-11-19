/**
 * Brain dump (docs/ai-assistant-v1.md section 4.8): smart dictation that sends nothing until the
 * person taps Organize, and whose answer can add new projects and subprojects besides tasks. Here:
 * the dump's limit (4.8), the request's user message with the `<plan>` block of an Update (4.8.1,
 * 4.8.4), the checks (4.8.3: the projects first, then the task checks of 4.3 from dictation.ts),
 * and the plan's rules for review (4.8.5: the order of the groups, removing a new project). Pinned
 * by `brainDump.checks` in test-fixtures/ai-tools-v1.json; Vicu mobile implements the same rules.
 */
import { AI_LIMITS } from './contract'
import {
  checkTasks,
  draftsAsAnswer,
  transcriptForRequest,
  unclearNotes,
  type CheckContext,
  type CheckedDraft,
  type DraftAnswer,
  type DroppedField,
  type ProjectRefTarget,
} from './dictation'

// --- The model's answer (4.8.2) ----------------------------------------------------------

export interface ProjectAnswer {
  ref: string
  title: string
  parent_id: number | null
  parent_ref: string | null
}

/** A task of the answer: the dictation task with `project_ref` after `project_id`. */
export type BrainDumpTaskAnswer = Omit<DraftAnswer, 'project_id'> & { project_id: number | null; project_ref: string | null }

export interface BrainDumpAnswer {
  projects: ProjectAnswer[]
  tasks: BrainDumpTaskAnswer[]
  unclear: string[]
}

/** The `<plan>` block of an Update (4.8.4): the plan in the answer's own shape. */
export interface PlanBlock {
  projects: ProjectAnswer[]
  tasks: BrainDumpTaskAnswer[]
}

// --- Checked (4.8.3) -----------------------------------------------------------------------

/** A new project of the plan: under a context project (`parent_id`), an earlier new one (`parent_ref`), or at the top. */
export interface CheckedProject {
  ref: string
  title: string
  parent_id: number | null
  parent_ref: string | null
}

/** A checked brain dump draft: the dictation shape with `project_ref` after `project_id`. */
export interface BrainDumpDraft extends Omit<CheckedDraft, 'project_id'> {
  /** Null when the task goes in a new project of the plan. */
  project_id: number | null
  /** The `ref` of the plan's new project the task goes in, or null. */
  project_ref: string | null
}

export interface BrainDumpResult {
  projects: CheckedProject[]
  drafts: BrainDumpDraft[]
  /** The projects' entries first, then the tasks'. */
  dropped: DroppedField[]
  unclear: string[]
}

const lineBreaks = /[\r\n]+/g

/** Cuts a title over the limit at the last space at or before the limit (without one, at the limit). */
function cutTitle(title: string, max: number): string {
  if (title.length <= max) return title
  const space = title.lastIndexOf(' ', max)
  return space >= 0 ? title.slice(0, space) : title.slice(0, max)
}

/** A ref as given: an empty string counts as none. */
function refOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** A new project an earlier batch of notes made (4.9): named by its ref in `<projects_so_far>`. */
export interface KnownProject {
  ref: string
  title: string
  /** Its path: its parent's path, ` / `, its title. */
  path: string
}

/** How notes (4.9) run the checks of 4.8.3 on one batch. */
export interface BrainDumpCheckOptions {
  /** The new projects of earlier batches: a `parent_ref` or `project_ref` may name one, and a same path merges into it. */
  known?: readonly KnownProject[]
  /** Every kept project is numbered `p<n>`, `p<n+1>`, ... (after the known ones), whatever its ref was. */
  firstProjectNumber?: number
  /** Fields of the answer's task added to each kept draft (see `TaskCheckOptions.extendDraft`). */
  extendDraft?: (task: Record<string, unknown>) => Record<string, unknown>
}

/**
 * The checks of 4.8.3 on a brain dump's answer: the projects (limit, refs, title, parent, the same
 * project twice), then the tasks by 4.3 with `brain_dump_tasks_max`, without the list's default due
 * date, and with `project_ref` resolved before step 5. `ctx.defaultDue` is not used. Notes (4.9)
 * pass the projects of earlier batches and the first free project number.
 */
export function checkBrainDumpAnswer(answer: BrainDumpAnswer, ctx: CheckContext, options: BrainDumpCheckOptions = {}): BrainDumpResult {
  const dropped: DroppedField[] = []
  const known = options.known ?? []
  const knownByRef = new Map(known.map((project) => [project.ref, project]))
  const all = Array.isArray(answer.projects) ? answer.projects : []

  // 1. Projects: at most 12; refs renumbered by position when any is empty or repeated. A ref
  // names the first project that was given it, whatever that one is renumbered to.
  const max = AI_LIMITS.brain_dump_projects_max
  const given = all.slice(0, max)
  for (const extra of all.slice(max)) dropped.push({ ref: extra.ref, field: 'project', value: extra.title })
  const seen = new Set<string>()
  const firstWithRef = new Map<string, number>()
  let renumber = false
  given.forEach((project, index) => {
    const ref = typeof project.ref === 'string' ? project.ref : ''
    if (ref === '' || seen.has(ref)) renumber = true
    seen.add(ref)
    if (ref !== '' && !firstWithRef.has(ref)) firstWithRef.set(ref, index)
  })

  /** Where each given project went: kept (or merged into a kept one), merged into the context, or dropped (undefined). */
  const outcomes: Array<{ target: ProjectRefTarget; path: string } | undefined> = []
  const kept: CheckedProject[] = []
  const keptPaths = new Map<string, string>()

  given.forEach((project, index) => {
    const numbered = options.firstProjectNumber !== undefined
    const ref = numbered ? `p${options.firstProjectNumber! + kept.length}` : renumber ? `p${index + 1}` : project.ref

    // 2. Title.
    const flat = (typeof project.title === 'string' ? project.title : '').replace(lineBreaks, ' ').trim()
    if (flat === '') {
      dropped.push({ ref, field: 'project_title', value: project.title })
      outcomes.push(undefined)
      return
    }
    const title = cutTitle(flat, AI_LIMITS.title_max_chars)

    // 3. Parent: a project before this one that was kept or merged, else one of the context.
    let parent: { target: NonNullable<ProjectRefTarget>; path: string } | null = null
    const parentRef = refOf(project.parent_ref)
    if (parentRef !== null) {
      const at = firstWithRef.get(parentRef)
      const outcome = at !== undefined && at < index ? outcomes[at] : undefined
      const earlier = at === undefined ? knownByRef.get(parentRef) : undefined
      if (outcome?.target) parent = { target: outcome.target, path: outcome.path }
      else if (earlier) parent = { target: { ref: earlier.ref }, path: earlier.path }
      else dropped.push({ ref, field: 'parent', value: project.parent_ref })
    } else if (project.parent_id !== null && project.parent_id !== undefined) {
      const context = ctx.projects.find((p) => p.id === project.parent_id)
      if (context) parent = { target: { id: context.id }, path: context.path }
      else dropped.push({ ref, field: 'parent', value: project.parent_id })
    }

    // 4. The same project: a context project with this path, else an earlier kept new one.
    const path = parent ? `${parent.path} / ${title}` : title
    const key = path.toLowerCase()
    const existing = ctx.projects.find((p) => p.path.toLowerCase() === key)
    if (existing) {
      outcomes.push({ target: { id: existing.id }, path: existing.path })
      return
    }
    const sameKnown = known.find((p) => p.path.toLowerCase() === key)
    if (sameKnown) {
      outcomes.push({ target: { ref: sameKnown.ref }, path: sameKnown.path })
      return
    }
    for (const [keptRef, keptPath] of keptPaths) {
      if (keptPath.toLowerCase() === key) {
        outcomes.push({ target: { ref: keptRef }, path: keptPath })
        return
      }
    }
    keptPaths.set(ref, path)
    kept.push({
      ref,
      title,
      parent_id: parent && 'id' in parent.target ? parent.target.id : null,
      parent_ref: parent && 'ref' in parent.target ? parent.target.ref : null,
    })
    outcomes.push({ target: { ref }, path })
  })

  // 5. Tasks.
  const tasks = checkTasks(answer.tasks, ctx, {
    draftsMax: AI_LIMITS.brain_dump_tasks_max,
    noDefaultDue: true,
    projectRef: (ref) => {
      const at = firstWithRef.get(ref)
      if (at !== undefined) return outcomes[at]?.target ?? null
      const earlier = knownByRef.get(ref)
      return earlier ? { ref: earlier.ref } : null
    },
    extendDraft: options.extendDraft,
  })
  return { projects: kept, drafts: tasks.drafts, dropped: [...dropped, ...tasks.dropped], unclear: unclearNotes(answer.unclear) }
}

// --- The request (4.8.1, 4.8.4) ------------------------------------------------------------

/**
 * The plan in the model's own answer shape for an Update (4.8.4): after the checks and the
 * person's own changes, labels as names, the due date back as `when` with `said` null, `unsure`
 * empty, each object's keys in the schema's order.
 */
export function planAsAnswer(
  projects: readonly CheckedProject[],
  drafts: readonly BrainDumpDraft[],
  placeName: (placeId: string) => string | null,
): PlanBlock {
  const tasks = draftsAsAnswer(drafts, placeName).tasks.map((task, i): BrainDumpTaskAnswer => {
    const { ref, title, notes, when, project_id, ...rest } = task
    return { ref, title, notes, when, project_id, project_ref: drafts[i].project_ref, ...rest }
  })
  return {
    projects: projects.map((project) => ({ ref: project.ref, title: project.title, parent_id: project.parent_id, parent_ref: project.parent_ref })),
    tasks,
  }
}

/** The one user message of a brain dump (4.8.1), or of an Update with its plan block (4.8.4). */
export function brainDumpUserMessage(contextJson: string, transcript: string, plan?: PlanBlock): string {
  const parts = [`<context>\n${contextJson}\n</context>`]
  if (plan) parts.push(`<plan>\n${JSON.stringify(plan)}\n</plan>`)
  parts.push(`<transcript>\n${transcriptForRequest(transcript)}\n</transcript>`)
  return parts.join('\n')
}

/**
 * A turn's words added to the end of the dump (4.8), one space between them unless the dump ends
 * in a space or a line break. The dump is at most `transcript_max_chars`: a longer one is cut at
 * the last space at or before the limit, and `full` says the microphone must turn off.
 */
export function appendToDump(dump: string, words: string): { text: string; full: boolean } {
  const add = words.trim()
  const text = add === '' ? dump : dump === '' || /\s$/.test(dump) ? `${dump}${add}` : `${dump} ${add}`
  const max = AI_LIMITS.transcript_max_chars
  if (text.length < max) return { text, full: false }
  if (text.length === max) return { text, full: true }
  const space = text.lastIndexOf(' ', max)
  return { text: space > 0 ? text.slice(0, space) : text.slice(0, max), full: true }
}

// --- Review (4.8.5) ------------------------------------------------------------------------

export type PlanGroupProject = { kind: 'new'; project: CheckedProject } | { kind: 'existing'; id: number }

export interface PlanGroup {
  /** `new:<ref>` or `id:<project id>`. */
  key: string
  project: PlanGroupProject
  drafts: BrainDumpDraft[]
}

/**
 * The plan as the review shows it (4.8.5): the tasks under the project they go in, the projects in
 * the order of their first task, then the new projects without tasks in the plan's order.
 */
export function planGroups(projects: readonly CheckedProject[], drafts: readonly BrainDumpDraft[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>()
  for (const draft of drafts) {
    const newProject = draft.project_ref !== null ? projects.find((p) => p.ref === draft.project_ref) : undefined
    const key = newProject ? `new:${newProject.ref}` : `id:${draft.project_id}`
    let group = groups.get(key)
    if (!group) {
      group = { key, project: newProject ? { kind: 'new', project: newProject } : { kind: 'existing', id: draft.project_id ?? 0 }, drafts: [] }
      groups.set(key, group)
    }
    group.drafts.push(draft)
  }
  for (const project of projects) {
    const key = `new:${project.ref}`
    if (!groups.has(key)) groups.set(key, { key, project: { kind: 'new', project }, drafts: [] })
  }
  return [...groups.values()]
}

/**
 * Removes a new project from the plan (4.8.5): its tasks and its new subprojects move to its
 * parent; at the top level its tasks go to `defaultProjectId` and its subprojects to the top level.
 */
export function removePlanProject(
  ref: string,
  projects: readonly CheckedProject[],
  drafts: readonly BrainDumpDraft[],
  defaultProjectId: number,
): { projects: CheckedProject[]; drafts: BrainDumpDraft[] } {
  const removed = projects.find((project) => project.ref === ref)
  if (!removed) return { projects: [...projects], drafts: [...drafts] }
  return {
    projects: projects
      .filter((project) => project.ref !== ref)
      .map((project) => (project.parent_ref === ref ? { ...project, parent_id: removed.parent_id, parent_ref: removed.parent_ref } : project)),
    drafts: drafts.map((draft) => {
      if (draft.project_ref !== ref) return draft
      if (removed.parent_ref !== null) return { ...draft, project_ref: removed.parent_ref }
      return { ...draft, project_id: removed.parent_id ?? defaultProjectId, project_ref: null }
    }),
  }
}

/** A new project's path: its parent's path (`contextPath` for a context project), ` / `, its title. */
export function planProjectPath(
  ref: string,
  projects: readonly CheckedProject[],
  contextPath: (id: number) => string,
): string {
  const titles: string[] = []
  const seen = new Set<string>()
  let current = projects.find((project) => project.ref === ref)
  while (current && !seen.has(current.ref)) {
    seen.add(current.ref)
    titles.unshift(current.title)
    if (current.parent_id !== null) {
      const top = contextPath(current.parent_id)
      if (top) titles.unshift(top)
      break
    }
    const parentRef = current.parent_ref
    current = parentRef !== null ? projects.find((project) => project.ref === parentRef) : undefined
  }
  return titles.join(' / ')
}

/** The new projects of an Update whose title or parent changed, or that are new (highlighted). */
export function changedProjects(before: readonly CheckedProject[], after: readonly CheckedProject[]): string[] {
  const previous = new Map(before.map((project) => [project.ref, project]))
  return after
    .filter((project) => {
      const was = previous.get(project.ref)
      return !was || was.title !== project.title || was.parent_id !== project.parent_id || was.parent_ref !== project.parent_ref
    })
    .map((project) => project.ref)
}
