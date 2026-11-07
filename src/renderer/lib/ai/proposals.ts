/**
 * Ask's proposals (docs/ai-assistant-v1.md section 5.4): a proposal tool call becomes a card that
 * lists each task and its new value; tasks the user cannot change are listed as skipped and never
 * sent (`not_found`: unknown or hidden; `read_only`: permission 0 or an archived project;
 * `invalid`: a change that both sets and clears the due date, or changes nothing). Applying goes
 * through the existing paths, injected here: merge patches with only the changed fields, labels
 * through the label endpoints, done through the completion path, notes only appended. The result
 * goes back to the model in the `proposalResult` shape.
 */
import { AI_LIMITS } from '../../../shared/ai/contract'
import {
  checkDictationAnswer,
  dueForApi,
  readWhen,
  type CheckContext,
  type CheckedDraft,
  type DictationAnswer,
  type DroppedField,
  type WhenAnswer,
} from '../../../shared/ai/dictation'
import { effectivePermission } from '../../../shared/collaboration'
import { isNoDueDate } from '../../../shared/due-dates'
import { plainTextToDescriptionHtml } from '../description-html'
import type { Label, Task } from '../vikunja-types'
import { ToolError } from './ask-tools'
import { isVisibleTask } from './task-summary'
import { contextProjects, isWritable, type AiWorkspace } from './workspace'

export type SkipReason = 'not_found' | 'read_only' | 'invalid'
export interface Skip {
  task_id: number
  reason: SkipReason
}

export interface UpdateItem {
  task: Task
  title?: string
  /** Local `YYYY-MM-DDTHH:mm:ss`, or null to clear. */
  due?: string | null
  dueGuessed: boolean
  /** The user changed the date on the card (section 5.4). */
  dueEdited?: boolean
  projectId?: number
  priority?: number
  appendNotes?: string
  labelsAdd: Array<{ id: number | null; title: string }>
  labelsRemove: Label[]
}

export type Proposal =
  | { tool: 'propose_create_tasks'; drafts: CheckedDraft[]; dropped: DroppedField[]; unclear: string[]; skipped: Skip[]; editedRefs?: string[] }
  | { tool: 'propose_update_tasks'; updates: UpdateItem[]; skipped: Skip[] }
  | { tool: 'propose_complete_tasks'; done: boolean; tasks: Task[]; skipped: Skip[] }

export interface ProposalResult {
  status: 'applied' | 'declined' | 'partly_applied' | 'failed'
  applied: number[]
  skipped: Skip[]
  /** Left out when no date was changed on the card. */
  edited?: EditedDue[]
}

/** A date the user changed on a card: `task_id` on an update, `ref` on a new task. */
export type EditedDue = ({ task_id: number } | { ref: string }) & { due: string | null }

/** The card with the date of one task changed by the user; null removes it. */
export function withEditedDue(proposal: Proposal, key: number | string, due: string | null): Proposal {
  if (proposal.tool === 'propose_update_tasks') {
    return {
      ...proposal,
      updates: proposal.updates.map((item) => (item.task.id === key ? { ...item, due, dueGuessed: false, dueEdited: true } : item)),
    }
  }
  if (proposal.tool === 'propose_create_tasks') {
    return {
      ...proposal,
      drafts: proposal.drafts.map((draft) => {
        if (draft.ref !== key) return draft
        // A reminder counted from the date goes with the date.
        const reminder = due === null && draft.reminder && 'before_due_minutes' in draft.reminder ? null : draft.reminder
        return { ...draft, due, reminder, guessed: draft.guessed.filter((field) => field !== 'when') }
      }),
      editedRefs: [...new Set([...(proposal.editedRefs ?? []), String(key)])],
    }
  }
  return proposal
}

export function proposalSize(proposal: Proposal): number {
  switch (proposal.tool) {
    case 'propose_create_tasks': return proposal.drafts.length
    case 'propose_update_tasks': return proposal.updates.length
    case 'propose_complete_tasks': return proposal.tasks.length
  }
}

export interface ProposalDeps {
  ws: AiWorkspace
  fetchTask: (id: number) => Promise<Task | null>
  /** Now, local `YYYY-MM-DDTHH:mm:ss`. */
  reference: string
  readSaid: CheckContext['readSaid']
  /** The project a new task goes to (the list the user is in, else the Inbox). */
  defaultProjectId: number
}

/** Why a task cannot be changed, or null when it can. */
function blocker(task: Task | null, ws: AiWorkspace): SkipReason | null {
  if (!task || !isVisibleTask(task)) return 'not_found'
  const project = ws.projects.find((p) => p.id === task.project_id)
  if (!project) return 'not_found'
  if (project.is_archived) return 'read_only'
  const permission = Math.min(ws.access(project.id).permission, effectivePermission(project.max_permission, project.is_archived))
  return permission < 1 ? 'read_only' : null
}

const lower = (text: string) => text.toLowerCase()

/** Reads a proposal tool call's (schema-valid) arguments into a card. */
export async function buildProposal(name: string, args: Record<string, unknown>, deps: ProposalDeps): Promise<Proposal> {
  const { ws } = deps
  const tooMany = (count: number) => {
    if (count > AI_LIMITS.proposal_max_tasks) throw new ToolError('invalid_arguments', `at most ${AI_LIMITS.proposal_max_tasks} tasks per proposal`)
  }

  if (name === 'propose_create_tasks') {
    const answer = { tasks: args.tasks, unclear: [] } as unknown as DictationAnswer
    tooMany(answer.tasks.length)
    const checked = checkDictationAnswer(answer, {
      reference: deps.reference,
      defaultDue: null,
      projects: contextProjects(ws),
      default_project_id: deps.defaultProjectId,
      labels: ws.labels,
      places: ws.places,
      readSaid: deps.readSaid,
    })
    return { tool: name, drafts: checked.drafts, dropped: checked.dropped, unclear: checked.unclear, skipped: [] }
  }

  if (name === 'propose_complete_tasks') {
    const ids = [...new Set((args.task_ids as number[]) ?? [])]
    tooMany(ids.length)
    const done = args.done === true
    const tasks: Task[] = []
    const skipped: Skip[] = []
    for (const id of ids) {
      const task = await deps.fetchTask(id)
      const reason = blocker(task, ws) ?? (task && task.done === done ? 'invalid' : null)
      if (reason) skipped.push({ task_id: id, reason })
      else tasks.push(task as Task)
    }
    return { tool: name, done, tasks, skipped }
  }

  if (name === 'propose_update_tasks') {
    const changes = (args.changes as Array<Record<string, unknown>>) ?? []
    tooMany(changes.length)
    const updates: UpdateItem[] = []
    const skipped: Skip[] = []
    const writable = new Set(contextProjects(ws).map((p) => p.id))
    for (const change of changes) {
      const id = change.task_id as number
      const task = await deps.fetchTask(id)
      const reason = blocker(task, ws)
      if (reason || !task) {
        skipped.push({ task_id: id, reason: reason ?? 'not_found' })
        continue
      }
      const when = change.when as WhenAnswer | null
      if (when && change.clear_due === true) {
        skipped.push({ task_id: id, reason: 'invalid' })
        continue
      }
      const item: UpdateItem = { task, dueGuessed: false, labelsAdd: [], labelsRemove: [] }
      let invalid = false
      if (typeof change.title === 'string') {
        const title = change.title.replace(/[\r\n]+/g, ' ').trim().slice(0, AI_LIMITS.title_max_chars)
        if (title && title !== task.title) item.title = title
      }
      if (typeof change.append_notes === 'string' && change.append_notes.trim()) {
        item.appendNotes = change.append_notes.trim().slice(0, AI_LIMITS.notes_max_chars)
      }
      if (change.clear_due === true) {
        if (!isNoDueDate(task.due_date)) item.due = null
      } else if (when) {
        const reading = readWhen(when, deps.reference, deps.readSaid)
        if (reading.due !== null) {
          if (Date.parse(dueForApi(reading.due)) !== Date.parse(task.due_date)) {
            item.due = reading.due
            item.dueGuessed = reading.guessed
          }
        } else {
          invalid = true
        }
      }
      if (typeof change.project_id === 'number' && change.project_id !== task.project_id) {
        if (writable.has(change.project_id)) item.projectId = change.project_id
        else invalid = true
      }
      if (typeof change.priority === 'number') {
        if (Number.isInteger(change.priority) && change.priority >= 0 && change.priority <= 4) {
          if (change.priority !== (task.priority ?? 0)) item.priority = change.priority
        } else {
          invalid = true
        }
      }
      const has = (title: string) => (task.labels ?? []).some((label) => lower(label.title) === lower(title))
      for (const raw of (change.labels_add as string[]) ?? []) {
        const title = raw.trim().replace(/^[#@*+]/, '').trim()
        if (!title || has(title) || item.labelsAdd.some((l) => lower(l.title) === lower(title))) continue
        const existing = ws.labels.find((label) => lower(label.title) === lower(title))
        item.labelsAdd.push(existing ? { id: existing.id, title: existing.title } : { id: null, title })
      }
      for (const raw of (change.labels_remove as string[]) ?? []) {
        const title = raw.trim().replace(/^[#@*+]/, '').trim()
        const label = (task.labels ?? []).find((l) => lower(l.title) === lower(title))
        if (label && !item.labelsRemove.includes(label)) item.labelsRemove.push(label)
      }
      const changesSomething = item.title !== undefined || item.appendNotes !== undefined || item.due !== undefined
        || item.projectId !== undefined || item.priority !== undefined || item.labelsAdd.length > 0 || item.labelsRemove.length > 0
      if (invalid || !changesSomething) skipped.push({ task_id: id, reason: 'invalid' })
      else updates.push(item)
    }
    return { tool: name, updates, skipped }
  }

  throw new ToolError('invalid_arguments', `Unknown tool ${name}`)
}

/** The task fields an update changes, with the new description (notes only appended, as a paragraph). */
export function updateChanges(item: UpdateItem): Partial<Task> {
  const changes: Partial<Task> = {}
  if (item.title !== undefined) changes.title = item.title
  if (item.due !== undefined) changes.due_date = (item.due === null ? null : dueForApi(item.due)) as unknown as string
  if (item.projectId !== undefined) changes.project_id = item.projectId
  if (item.priority !== undefined) changes.priority = item.priority
  if (item.appendNotes !== undefined) {
    const current = item.task.description ?? ''
    const added = plainTextToDescriptionHtml(item.appendNotes)
    changes.description = current.trim() ? `${current}${current.endsWith('\n') ? '' : '\n'}${added}` : added
  }
  return changes
}

export interface ApplyDeps {
  addDrafts: (drafts: CheckedDraft[]) => Promise<{ created: Task[]; tasks: Task[] }>
  deleteTask: (task: Task) => Promise<void>
  updateTask: (task: Task, changes: Partial<Task>) => Promise<void>
  createLabel: (title: string) => Promise<Label>
  addLabel: (task: Task, label: Label) => Promise<void>
  removeLabel: (task: Task, labelId: number) => Promise<void>
  complete: (task: Task) => Promise<void>
  reopen: (task: Task) => Promise<void>
}

export interface Applied {
  result: ProposalResult
  /** How many tasks changed (for "Changed 2 tasks"). */
  count: number
  /** Puts back the previous values. */
  undo: () => Promise<void>
}

function statusOf(applied: number, attempted: number, skipped: number): ProposalResult['status'] {
  if (applied === 0) return 'failed'
  return applied === attempted && skipped === 0 ? 'applied' : 'partly_applied'
}

export async function applyProposal(proposal: Proposal, deps: ApplyDeps): Promise<Applied> {
  const undos: Array<() => Promise<void>> = []
  const undo = async () => {
    for (const step of [...undos].reverse()) await step().catch(() => {})
  }

  if (proposal.tool === 'propose_create_tasks') {
    let created: Task[] = []
    let tasks: Task[] = []
    try {
      const result = await deps.addDrafts(proposal.drafts)
      created = result.created
      tasks = result.tasks
    } catch {
      // Nothing was made, or the error toast said what went wrong.
    }
    undos.push(async () => {
      for (const task of [...created].reverse()) await deps.deleteTask(task).catch(() => {})
    })
    return {
      result: {
        status: statusOf(tasks.length, proposal.drafts.length, proposal.dropped.filter((d) => d.field === 'title' || d.field === 'task').length),
        applied: tasks.map((t) => t.id),
        skipped: [],
        ...editedOf(tasks.length > 0 ? proposal.drafts.filter((d) => proposal.editedRefs?.includes(d.ref)).map((d) => ({ ref: d.ref, due: d.due })) : []),
      },
      count: tasks.length,
      undo,
    }
  }

  if (proposal.tool === 'propose_complete_tasks') {
    const applied: number[] = []
    for (const task of proposal.tasks) {
      try {
        if (proposal.done) await deps.complete(task)
        else await deps.reopen(task)
        applied.push(task.id)
        undos.push(() => (proposal.done ? deps.reopen({ ...task, done: true }) : deps.complete({ ...task, done: false })))
      } catch {
        // the app's error toast says why
      }
    }
    return { result: { status: statusOf(applied.length, proposal.tasks.length, proposal.skipped.length), applied, skipped: proposal.skipped }, count: applied.length, undo }
  }

  const applied: number[] = []
  const labelCache = new Map<string, Label>()
  for (const item of proposal.updates) {
    const changes = updateChanges(item)
    const previous: Partial<Task> = {}
    for (const key of Object.keys(changes) as Array<keyof Task>) {
      ;(previous as Record<string, unknown>)[key] = key === 'due_date' && isNoDueDate(item.task.due_date) ? null : item.task[key]
    }
    try {
      if (Object.keys(changes).length > 0) {
        await deps.updateTask(item.task, changes)
        undos.push(() => deps.updateTask({ ...item.task, ...changes } as Task, previous))
      }
      for (const wanted of item.labelsAdd) {
        let label: Label | undefined = wanted.id !== null ? { id: wanted.id, title: wanted.title } as Label : labelCache.get(lower(wanted.title))
        if (!label) {
          label = await deps.createLabel(wanted.title)
          labelCache.set(lower(wanted.title), label)
        }
        const added = label
        await deps.addLabel(item.task, added)
        undos.push(() => deps.removeLabel(item.task, added.id))
      }
      for (const label of item.labelsRemove) {
        await deps.removeLabel(item.task, label.id)
        undos.push(() => deps.addLabel(item.task, label))
      }
      applied.push(item.task.id)
    } catch {
      // the app's error toast says why
    }
  }
  return {
    result: {
      status: statusOf(applied.length, proposal.updates.length, proposal.skipped.length),
      applied,
      skipped: proposal.skipped,
      ...editedOf(proposal.updates.filter((item) => item.dueEdited && applied.includes(item.task.id)).map((item) => ({ task_id: item.task.id, due: item.due ?? null }))),
    },
    count: applied.length,
    undo,
  }
}

const editedOf = (edited: EditedDue[]) => (edited.length > 0 ? { edited } : {})

export const DECLINED = (proposal: Proposal): ProposalResult => ({ status: 'declined', applied: [], skipped: proposal.skipped })
