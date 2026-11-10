/**
 * Ask's read tools (docs/ai-assistant-v1.md section 5.3): `get_overview`, `find_tasks`,
 * `list_view` and `get_task`, run on the device against the server through the window's API. Every
 * result leaves hidden tasks out (semantics 10.1) and gives tasks in the summary shape of 5.2;
 * `find_tasks` is decided by the custom-list evaluator, so "this week" means what a custom list
 * means. Errors are `{"error": "<code>", "detail": "..."}` (codes `invalid_arguments`, `not_found`).
 */
import { AI_LIMITS } from '../../../shared/ai/contract'
import { compareLowercased, isRealDate, localDateTimeOf } from '../../../shared/ai/dictation'
import { filterCustomList, buildCustomListServerFilter, customListRuleParams, type CustomListFilterInput } from '../../../shared/custom-list-filter'
import { sortCustomListTasks } from '../../../shared/custom-list-sort'
import { addLocalDays, localDateOf, toLocalDate } from '../../../shared/due-dates'
import { blockStartsOn } from '../../../shared/time-blocks'
import { resolveTaskOrder, sortTasksByOrder } from '../../../shared/task-order'
import { parseReviewFooter, computeStatus } from '../review-metadata'
import type { Task, TaskQueryParams } from '../vikunja-types'
import { isVisibleTask, notesPlainText, summariseTask, type TaskSummary } from './task-summary'
import { isWritable, pathOf, type AiWorkspace } from './workspace'

export interface ToolContext {
  ws: AiWorkspace
  now: () => Date
  /** Every page (main walks them) unless `page` is given. Throws when the server cannot answer. */
  fetchTasks: (params: TaskQueryParams) => Promise<Task[]>
  fetchTask: (id: number) => Promise<Task | null>
  /** The synced preferences (task orders). */
  syncedValues: Readonly<Record<string, unknown>>
  review: { enabled: boolean; defaultCadenceDays: number; excludeInbox: boolean }
}

export class ToolError extends Error {
  constructor(readonly code: 'invalid_arguments' | 'not_found', readonly detail: string) {
    super(detail)
  }
}

export function toolErrorResult(code: string, detail: string): { error: string; detail: string } {
  return { error: code, detail }
}

type Args = Record<string, unknown>

function projectOf(ws: AiWorkspace, id: number) {
  return ws.projects.find((project) => project.id === id)
}

function activeProjectIds(ws: AiWorkspace): Set<number> {
  return new Set(ws.projects.filter((project) => !project.is_archived).map((project) => project.id))
}

function visible(tasks: readonly Task[]): Task[] {
  return tasks.filter(isVisibleTask)
}

function customListContext(ws: AiWorkspace) {
  return { me: ws.me?.id ?? null, isShared: (projectId: number) => ws.access(projectId).shared }
}

function orderOf(ws: AiWorkspace, values: ToolContext['syncedValues'], projectId: number) {
  const parents = new Map(ws.projects.map((project) => [project.id, project.parent_project_id ?? 0]))
  return resolveTaskOrder(projectId, (id) => parents.get(id), values)
}

// --- get_overview ---------------------------------------------------------------------------

export async function getOverview(ctx: ToolContext): Promise<unknown> {
  const { ws } = ctx
  const now = ctx.now()
  const today = toLocalDate(now)
  const active = activeProjectIds(ws)
  const open = visible(await ctx.fetchTasks({ filter: 'done = false' })).filter((task) => active.has(task.project_id) && !task.done)
  const counts = { inbox: 0, today: 0, overdue: 0, upcoming: 0, anytime: 0 }
  for (const task of open) {
    if (task.project_id === ws.inboxProjectId) counts.inbox++
    else counts.anytime++
    const due = localDateOf(task.due_date)
    if (due === '') continue
    if (due < today) counts.overdue++
    else if (due === today) counts.today++
    else counts.upcoming++
  }
  const reviewDue = !ctx.review.enabled ? [] : ws.projects
    .filter((project) => !project.is_archived && !(ctx.review.excludeInbox && project.id === ws.inboxProjectId))
    .filter((project) => {
      const status = computeStatus(parseReviewFooter(project.description), ctx.review.defaultCadenceDays, now)
      return status.metadata.state !== 'excluded' && (status.isOverdue || status.daysUntilDue === 0)
    })
    .map((project) => ({ id: project.id, path: pathOf(ws, project.id) }))
    .sort((a, b) => compareLowercased(a.path, b.path) || a.id - b.id)
  const projects = ws.projects
    .filter((project) => !project.is_archived)
    .map((project) => ({
      id: project.id,
      path: pathOf(ws, project.id),
      inbox: project.id === ws.inboxProjectId,
      writable: isWritable(ws, project),
      shared: ws.access(project.id).shared,
    }))
    .sort((a, b) => compareLowercased(a.path, b.path) || a.id - b.id)
  const labels = [...ws.labels]
    .map((label) => ({ id: label.id, title: label.title }))
    .sort((a, b) => compareLowercased(a.title, b.title) || a.id - b.id)
  const customLists = ws.customLists.map((list) => ({ id: list.id, name: list.name }))
  return { counts, review_due: reviewDue, projects, labels, custom_lists: customLists }
}

// --- find_tasks -----------------------------------------------------------------------------

function nullableArray(value: unknown): number[] | null {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : null
}

export async function findTasks(args: Args, ctx: ToolContext): Promise<{ tasks: TaskSummary[]; more: number }> {
  const { ws } = ctx
  const limitArg = typeof args.limit === 'number' ? args.limit : null
  if (limitArg !== null && (!Number.isInteger(limitArg) || limitArg < 1)) throw new ToolError('invalid_arguments', 'limit must be 1 or more')
  const limit = Math.min(limitArg ?? AI_LIMITS.find_tasks_default_limit, AI_LIMITS.find_tasks_max_limit)
  const dueFrom = typeof args.due_from === 'string' ? args.due_from : null
  const dueTo = typeof args.due_to === 'string' ? args.due_to : null
  if (dueFrom !== null && !isRealDate(dueFrom)) throw new ToolError('invalid_arguments', 'due_from must be a date YYYY-MM-DD')
  if (dueTo !== null && !isRealDate(dueTo)) throw new ToolError('invalid_arguments', 'due_to must be a date YYYY-MM-DD')
  const priorityMin = typeof args.priority_min === 'number' ? args.priority_min : null
  if (priorityMin !== null && (!Number.isInteger(priorityMin) || priorityMin < 1 || priorityMin > 5)) {
    throw new ToolError('invalid_arguments', 'priority_min must be 1 to 5')
  }
  const status = typeof args.status === 'string' ? args.status : 'open'
  const projectIds = nullableArray(args.project_ids)
  const labelIds = nullableArray(args.label_ids)

  const filter: CustomListFilterInput = {
    due_date_filter: typeof args.due === 'string' ? args.due : undefined,
    include_overdue: typeof args.include_overdue === 'boolean' ? args.include_overdue : undefined,
    include_done: status !== 'open',
    project_ids: projectIds && projectIds.length > 0 ? projectIds : null,
    project_filter_mode: 'include',
    priority_filter: priorityMin !== null ? [1, 2, 3, 4, 5].filter((p) => p >= priorityMin) : null,
    label_ids: labelIds && labelIds.length > 0 ? labelIds : null,
    assigned: typeof args.assigned === 'string' ? args.assigned : undefined,
  }
  const now = ctx.now()
  let server = buildCustomListServerFilter(filter, now)
  if (status === 'done') server = server ? `${server} && done = true` : 'done = true'
  const tasks = visible(await ctx.fetchTasks({ ...(server ? { filter: server } : {}), keep_nested_subtasks: true }))

  // Archived projects' tasks only when the model asked for that project (5.2).
  const active = activeProjectIds(ws)
  const known = new Set(ws.projects.map((project) => project.id))
  const words = typeof args.text === 'string' ? args.text.toLowerCase().split(/\s+/).filter(Boolean) : []
  const matches = filterCustomList(tasks, filter, toLocalDate(now), customListContext(ws)).filter((task) => {
    if (!known.has(task.project_id)) return false
    if (!active.has(task.project_id) && !(projectIds ?? []).includes(task.project_id)) return false
    if (status === 'done' && !task.done) return false
    if (dueFrom !== null || dueTo !== null) {
      const due = localDateOf(task.due_date)
      if (due === '' || (dueFrom !== null && due < dueFrom) || (dueTo !== null && due > dueTo)) return false
    }
    if (words.length > 0) {
      const haystack = `${task.title}\n${notesPlainText(task.description)}`.toLowerCase()
      if (!words.every((word) => haystack.includes(word))) return false
    }
    return true
  })
  const sorted = sortTasksByOrder(matches, 'due_date_first')
  return { tasks: sorted.slice(0, limit).map((task) => summariseTask(task, ws)), more: Math.max(0, sorted.length - limit) }
}

// --- list_view ------------------------------------------------------------------------------

export async function listView(args: Args, ctx: ToolContext): Promise<{ tasks: TaskSummary[]; page: number; has_more: boolean }> {
  const { ws } = ctx
  const view = String(args.view)
  const pageArg = typeof args.page === 'number' ? args.page : 1
  if (!Number.isInteger(pageArg) || pageArg < 1) throw new ToolError('invalid_arguments', 'page must be 1 or more')
  const size = AI_LIMITS.list_view_page_size
  const now = ctx.now()
  const today = toLocalDate(now)
  const active = activeProjectIds(ws)
  let ordered: Task[]

  switch (view) {
    case 'logbook': {
      // The Logbook loads newest first, a page at a time, like the view.
      const page = visible(await ctx.fetchTasks({ filter: 'done = true', sort_by: 'done_at', order_by: 'desc', page: pageArg, per_page: size }))
      return { tasks: page.map((task) => summariseTask(task, ws)), page: pageArg, has_more: page.length >= size }
    }
    case 'inbox':
    case 'project': {
      const projectId = view === 'inbox' ? ws.inboxProjectId : typeof args.project_id === 'number' ? args.project_id : null
      if (projectId === null) throw new ToolError('invalid_arguments', 'project_id is needed with view project')
      if (!projectOf(ws, projectId)) throw new ToolError('not_found', `No project ${projectId}`)
      const tasks = visible(await ctx.fetchTasks({ filter: `done = false && project_id = ${projectId}` }))
        .filter((task) => task.project_id === projectId && !task.done)
      ordered = sortTasksByOrder(tasks, orderOf(ws, ctx.syncedValues, projectId))
      break
    }
    case 'today':
    case 'upcoming': {
      const tasks = visible(await ctx.fetchTasks(view === 'today'
        ? { filter: 'done = false', due_window: view }
        : { filter: "done = false && due_date != '0001-01-01T00:00:00Z'", due_window: view }))
      const inWindow = tasks.filter((task) => {
        const due = localDateOf(task.due_date)
        if (!active.has(task.project_id)) return false
        if (view === 'today' && blockStartsOn(task, today)) return true
        return due !== '' && (view === 'today' ? due <= today : due >= addLocalDays(today, 1))
      })
      ordered = sortTasksByOrder(inWindow, 'due_date_first')
      break
    }
    case 'anytime': {
      const tasks = visible(await ctx.fetchTasks({ filter: 'done = false' }))
      ordered = sortTasksByOrder(tasks.filter((task) => active.has(task.project_id) && task.project_id !== ws.inboxProjectId), 'due_date_first')
      break
    }
    case 'custom_list': {
      const id = typeof args.custom_list_id === 'string' ? args.custom_list_id : null
      if (id === null) throw new ToolError('invalid_arguments', 'custom_list_id is needed with view custom_list')
      const list = ws.customLists.find((l) => l.id === id)
      if (!list) throw new ToolError('not_found', `No custom list ${id}`)
      const server = buildCustomListServerFilter(list.filter, now)
      const tasks = visible(await ctx.fetchTasks({
        ...(server ? { filter: server } : {}),
        ...customListRuleParams(list.filter),
        keep_nested_subtasks: true,
      }))
      const matching = filterCustomList(tasks, list.filter, today, customListContext(ws), now).filter((task) => active.has(task.project_id))
      ordered = sortCustomListTasks(matching, list.filter.sort_by, list.filter.order_by, list.filter.then_by ?? [])
      break
    }
    default:
      throw new ToolError('invalid_arguments', `Unknown view ${view}`)
  }
  const start = (pageArg - 1) * size
  return {
    tasks: ordered.slice(start, start + size).map((task) => summariseTask(task, ws)),
    page: pageArg,
    has_more: ordered.length > start + size,
  }
}

// --- get_task -------------------------------------------------------------------------------

const DAY = 86400
const WEEK = 7 * DAY

export function repeatText(task: Pick<Task, 'repeat_after' | 'repeat_mode'>): string | null {
  if (task.repeat_mode === 1) return 'every month'
  const after = task.repeat_after ?? 0
  if (after <= 0) return null
  const fromDone = task.repeat_mode === 2 ? ', counted from when it is done' : ''
  const unit = (n: number, name: string) => (n === 1 ? `every ${name}` : `every ${n} ${name}s`)
  if (after % (365 * DAY) === 0) return unit(after / (365 * DAY), 'year') + fromDone
  if (after % WEEK === 0) return unit(after / WEEK, 'week') + fromDone
  if (after % DAY === 0) return unit(after / DAY, 'day') + fromDone
  if (after % 3600 === 0) return unit(after / 3600, 'hour') + fromDone
  return `every ${Math.round(after / 60)} minutes${fromDone}`
}

export async function getTask(args: Args, ctx: ToolContext): Promise<unknown> {
  const id = typeof args.task_id === 'number' ? args.task_id : NaN
  const task = Number.isInteger(id) ? await ctx.fetchTask(id) : null
  if (!task || !isVisibleTask(task) || !projectOf(ctx.ws, task.project_id)) throw new ToolError('not_found', `No task ${args.task_id}`)
  const notes = notesPlainText(task.description)
  const subtasks = visible((task.related_tasks?.subtask ?? []) as Task[])
  return {
    task: summariseTask(task, ctx.ws),
    notes: notes.length > AI_LIMITS.get_task_notes_max_chars ? notes.slice(0, AI_LIMITS.get_task_notes_max_chars) : notes,
    subtasks: subtasks.map((subtask) => summariseTask({ ...subtask, project_id: subtask.project_id ?? task.project_id }, ctx.ws)),
    reminders: (task.reminders ?? [])
      .map((reminder) => reminder.reminder)
      .filter((value) => value && !Number.isNaN(Date.parse(value)))
      .map((value) => localDateTimeOf(new Date(value)).slice(0, 16)),
    repeat: repeatText(task),
  }
}

/** Runs a read tool. Throws a ToolError for an answer the model gets as an error result. */
export async function runReadTool(name: string, args: Args, ctx: ToolContext): Promise<unknown> {
  switch (name) {
    case 'get_overview': return getOverview(ctx)
    case 'find_tasks': return findTasks(args, ctx)
    case 'list_view': return listView(args, ctx)
    case 'get_task': return getTask(args, ctx)
    default: throw new ToolError('invalid_arguments', `Unknown tool ${name}`)
  }
}

/** The ids of every task in a tool result (only these render as rows, 5.1). */
export function taskIdsIn(result: unknown): number[] {
  const ids: number[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const object = value as Record<string, unknown>
    if (typeof object.id === 'number' && typeof object.title === 'string' && 'done' in object) ids.push(object.id)
    for (const child of Object.values(object)) if (typeof child === 'object') visit(child)
  }
  visit(result)
  return [...new Set(ids)]
}
