// Paste-to-create (Ctrl+V on a task list): the clipboard text becomes tasks, one per non-empty
// line, each run through the natural-language parser like the new-task composer does (D-TL-1). A
// single line is created at once; several lines are confirmed first. Pure planning plus a runner
// with injected calls, so the rules are unit tested; the hook that wires it to the app is
// src/renderer/hooks/use-paste-tasks.ts.

import { NULL_DATE } from './constants'
import { parsedDue } from './due-dates'
import { parse, recurrenceToVikunja } from './task-parser'
import type { ParserConfig } from './task-parser'
import type { CreateTaskPayload } from './vikunja-types'

/** The non-empty lines of the pasted text, trimmed. */
export function splitPastedLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export interface PasteContext {
  /** The project of the list the paste happened in. */
  projectId: number
  projects: ReadonlyArray<{ id: number; title: string }>
  parserConfig: ParserConfig
  /** Due date for a line that names none: a date-only value, e.g. today in the Today view. */
  defaultDueDate?: string
  /** "Now" for relative dates; the current time unless a test passes one. */
  now?: Date
}

export interface PastedTaskPlan {
  /** The line as pasted, for reporting a failure. */
  line: string
  projectId: number
  payload: CreateTaskPayload
  /** Label names found in the line; resolved (or created) once the task exists. */
  labelNames: string[]
}

/**
 * What one pasted line becomes, with the same rules as the new-task composer: the parser takes
 * the date, priority, recurrence, labels and project out of the line, a project that does not
 * exist is ignored, a bare date is date-only, and a line without a date gets the view's default.
 * With the parser off nothing is taken out of the line except the `!` shortcut (`parse` handles
 * both). Null for an empty line.
 */
export function planPastedTask(line: string, context: PasteContext): PastedTaskPlan | null {
  const raw = line.trim()
  if (!raw) return null

  const parsed = parse(raw, context.parserConfig, context.now)
  const title = parsed.title.trim() || raw

  let projectId = context.projectId
  if (parsed.project) {
    const wanted = parsed.project.toLowerCase()
    projectId = context.projects.find((project) => project.title.toLowerCase() === wanted)?.id ?? projectId
  }

  const payload: CreateTaskPayload = { title }
  const parsedDate = parsed.dueDate ? parsedDue(parsed.dueDate, parsed.dueHasTime) : undefined
  const dueDate = parsedDate ?? context.defaultDueDate
  if (dueDate && dueDate !== NULL_DATE) payload.due_date = dueDate
  if (parsed.priority && parsed.priority > 0) payload.priority = parsed.priority
  if (parsed.recurrence) Object.assign(payload, recurrenceToVikunja(parsed.recurrence))

  return { line: raw, projectId, payload, labelNames: [...new Set(parsed.labels)] }
}

export function pasteConfirmMessage(count: number): string {
  return `Create ${count} tasks from the clipboard, one per line?`
}

export interface PasteDeps {
  /** Create the task (or queue the create when the server cannot be reached). */
  create(plan: PastedTaskPlan): Promise<{ id: number }>
  /** The create was queued and has no server id yet; the queue applies the labels itself. */
  isQueued(task: { id: number }): boolean
  applyLabels(taskId: number, labelNames: string[]): Promise<void>
}

export interface PasteResult {
  created: number
  failed: Array<{ line: string; message: string; error: unknown }>
  /** Tasks that were created but lost some of their labels. */
  labelsFailed: number
}

/**
 * Creates the planned tasks one after the other (so they keep the order of the lines and the
 * server is not hit all at once). A task that fails is reported and the rest still go on.
 */
export async function createPastedTasks(plans: readonly PastedTaskPlan[], deps: PasteDeps): Promise<PasteResult> {
  const result: PasteResult = { created: 0, failed: [], labelsFailed: 0 }
  for (const plan of plans) {
    let task: { id: number }
    try {
      task = await deps.create(plan)
    } catch (error) {
      result.failed.push({ line: plan.line, message: error instanceof Error ? error.message : String(error), error })
      continue
    }
    result.created += 1
    if (plan.labelNames.length > 0 && !deps.isQueued(task)) {
      try {
        await deps.applyLabels(task.id, plan.labelNames)
      } catch {
        result.labelsFailed += 1
      }
    }
  }
  return result
}
