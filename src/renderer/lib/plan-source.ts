// The left panel of the Plan screen: which list the tasks to plan come from. Pure.

import { addLocalDays, isNoDueDate, localDateOf, type LocalDate } from '../../shared/due-dates'

export type PlanSource = 'day' | 'inbox' | 'next7' | 'nodate' | `project:${number}`

/** A stored value this version cannot read goes back to the first list. */
export function readPlanSource(value: unknown): PlanSource {
  if (value === 'inbox' || value === 'next7' || value === 'nodate') return value
  if (typeof value === 'string' && /^project:[1-9]\d*$/.test(value)) return value as PlanSource
  return 'day'
}

/** The project a source lists: its own, or the Inbox's for the Inbox. Else null. */
export function sourceProjectId(source: PlanSource, inboxId: number): number | null {
  if (source === 'inbox') return inboxId || null
  return source.startsWith('project:') ? Number(source.slice('project:'.length)) : null
}

/** The lists the panel offers; the first is the selected day's tasks without a time, named by its day ("Today"). */
export function sourceLists(dayLabel: string): { source: PlanSource; label: string }[] {
  return [
    { source: 'day', label: dayLabel },
    { source: 'inbox', label: 'Inbox' },
    { source: 'next7', label: 'Next 7 days' },
    { source: 'nodate', label: 'No date' },
  ]
}

/** Due after today and at most seven days on. */
export function inNextSevenDays(due: string | null | undefined, today: LocalDate): boolean {
  if (isNoDueDate(due)) return false
  const day = localDateOf(due)
  return day > today && day <= addLocalDays(today, 7)
}

/** The filter box: words of the title, any case. */
export function matchesTitleFilter(title: string, filter: string): boolean {
  const needle = filter.trim().toLowerCase()
  return !needle || title.toLowerCase().includes(needle)
}

/**
 * A new task drawn on the timeline goes into the project being browsed, else the Inbox. A project
 * the user can only view is not a place to write, so that falls back to the Inbox too.
 */
export function drawTargetProject(source: PlanSource, inboxId: number, canWrite: (projectId: number) => boolean): number {
  const project = source.startsWith('project:') ? sourceProjectId(source, inboxId) : null
  return project !== null && canWrite(project) ? project : inboxId
}
