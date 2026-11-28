/**
 * 1:1 topics (docs/cross-app-semantics-v1.md section 21.21): something to discuss with a person,
 * not something anyone delivers. A topic is an ordinary open task that carries the person's label
 * and is no promise, so it shows on every device, with or without Pro. Both apps run the
 * `pro.topics` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { addLocalDays, isNoDueDate, localDateOf, type LocalDate } from '../due-dates'
import { recordValue, type ProLedger } from './ledger'
import { readConfirmTitle, type PromiseTask } from './promises'

/** A topic with a date further away than this waits: a repeating topic that is not up yet. */
export const TOPIC_SOON_DAYS = 7

export interface TopicTask extends PromiseTask {
  /** When the task was created (UTC instant). */
  created?: string | null
}

export interface PersonTopics {
  /** Topics for the next 1:1: without a date, or dated up to seven days from today. */
  now: number[]
  /** Topics dated later. */
  later: number[]
  /** The topics of `now` and `later` that carry a private label: left out of copied text. */
  hidden: number[]
}

export interface PersonTopicsInput {
  person: number
  /** Open tasks (done ones are ignored). */
  tasks: readonly TopicTask[]
  ledger: ProLedger | null | undefined
  today: LocalDate
  /** The labels marked private (`label_kind` = `private`). */
  privateLabels?: ReadonlySet<number>
}

/**
 * A person's topics: open tasks with the person's label that have no promise record and are not a
 * "confirm with" task. Dated ones first by day, then undated ones oldest first, then id.
 */
export function personTopics(input: PersonTopicsInput): PersonTopics {
  const { person, ledger, today } = input
  const soon = addLocalDays(today, TOPIC_SOON_DAYS)
  const rows: Array<{ id: number; due: LocalDate | null; created: string; hidden: boolean }> = []
  for (const task of input.tasks) {
    if (task.done === true) continue
    const labels = (task.labels ?? []).map((label) => label.id)
    if (!labels.includes(person)) continue
    // With a promise record it is a promise's task, whatever its verdicts; a tombstone is no record.
    if (recordValue(ledger?.promises, task.id)) continue
    if (readConfirmTitle(task.title ?? '')) continue
    rows.push({
      id: task.id,
      due: isNoDueDate(task.due_date) ? null : localDateOf(task.due_date),
      created: task.created ?? '',
      hidden: labels.some((id) => input.privateLabels?.has(id) === true),
    })
  }
  rows.sort((a, b) => {
    if (a.due !== b.due) return a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1
    if (a.created !== b.created) return a.created < b.created ? -1 : 1
    return a.id - b.id
  })
  return {
    now: rows.filter((row) => row.due === null || row.due <= soon).map((row) => row.id),
    later: rows.filter((row) => row.due !== null && row.due > soon).map((row) => row.id),
    hidden: rows.filter((row) => row.hidden).map((row) => row.id),
  }
}
