// Plan my day (docs/cross-app-semantics-v1.md section 14.10), one definition for main and renderer,
// the same as Android's PlanDay. The rules of a session: its queue and groups, the meter, the draft
// and what accepting it writes. Pure: the clock is passed in, and the views run the mutations.

import {
  addLocalDays,
  dateOnlyDue,
  isNoDueDate,
  isOverdue,
  localDateOf,
  toLocalDate,
  type LocalDate,
} from './due-dates'
import {
  atClock,
  blockOf,
  busyOfDay,
  fitOrder,
  fitTasks,
  freeMinutes,
  freeRanges,
  placeBlock,
  planForDay,
  removeTime,
  type BlockChanges,
  type BlockFields,
  type BlockReminder,
  type BusyRange,
  type FitTask,
  type PlannerHours,
} from './time-blocks'

export interface PlanSessionTask extends BlockFields, FitTask {
  done?: boolean
  project_id: number
  reminders?: readonly BlockReminder[] | null
}

// --- Leftovers ------------------------------------------------------------------------------------

export type LeftoverAction = 'today' | 'tomorrow' | 'no_date' | 'done'

export const LEFTOVER_ACTIONS: readonly LeftoverAction[] = ['today', 'tomorrow', 'no_date', 'done']

/** The moment that makes a task a leftover, or null when it is not one. */
function leftSince<T extends PlanSessionTask>(task: T, now: Date): number | null {
  if (task.done) return null
  const today = toLocalDate(now)
  const block = blockOf(task)
  const times: number[] = []
  if (block && block.day < today) times.push(block.start.getTime())
  if (isOverdue(task.due_date, now)) times.push(new Date(task.due_date as string).getTime())
  return times.length > 0 ? Math.min(...times) : null
}

/** Open tasks due before today or with a block on a day before today, oldest first. */
export function leftoversQueue<T extends PlanSessionTask>(tasks: readonly T[], now: Date): T[] {
  return tasks
    .flatMap((task) => {
      const since = leftSince(task, now)
      return since === null ? [] : [{ task, since }]
    })
    .sort((a, b) => a.since - b.since || a.task.id - b.task.id)
    .map(({ task }) => task)
}

export type PlanChanges = BlockChanges & { done?: boolean }

/** What an action on a leftover writes. Its old block does not follow the date: that time has passed. */
export function leftoverChanges(
  task: { reminders?: readonly BlockReminder[] | null },
  action: LeftoverAction,
  now: Date,
): PlanChanges {
  const today = toLocalDate(now)
  switch (action) {
    case 'today':
      return planForDay(task, today)
    case 'tomorrow':
      return planForDay(task, addLocalDays(today, 1))
    case 'no_date':
      return { ...removeTime(task), due_date: null }
    case 'done':
      return { done: true }
  }
}

// --- Choose ---------------------------------------------------------------------------------------

/** On the day: due on it or with a block on it, and on today the overdue tasks, in Fit order. */
export function onDayTasks<T extends PlanSessionTask>(tasks: readonly T[], day: LocalDate, now: Date): T[] {
  const today = toLocalDate(now)
  return fitOrder(
    tasks.filter((task) => {
      if (task.done) return false
      if (blockOf(task)?.day === day) return true
      if (isNoDueDate(task.due_date)) return false
      return localDateOf(task.due_date) === day || (day === today && isOverdue(task.due_date, now))
    }),
    now,
  )
}

/** The Inbox's tasks without a due date, in the order given (the Inbox's own). */
export function inboxCandidates<T extends PlanSessionTask>(tasks: readonly T[], inboxId: number): T[] {
  return tasks.filter((task) => !task.done && task.project_id === inboxId && isNoDueDate(task.due_date))
}

/** Due one to three days after the day, without a block on it, by due date, priority, id. */
export function comingUpTasks<T extends PlanSessionTask>(tasks: readonly T[], day: LocalDate): T[] {
  const last = addLocalDays(day, 3)
  return tasks
    .filter((task) => {
      if (task.done || isNoDueDate(task.due_date) || blockOf(task)?.day === day) return false
      const due = localDateOf(task.due_date)
      return due > day && due <= last
    })
    .sort((a, b) => {
      const byDue = new Date(a.due_date as string).getTime() - new Date(b.due_date as string).getTime()
      return byDue || (b.priority ?? 0) - (a.priority ?? 0) || a.id - b.id
    })
}

/** Groups hold no task twice: each leaves out what an earlier one took. */
export function withoutTasks<T extends { id: number }>(tasks: readonly T[], taken: readonly { id: number }[]): T[] {
  const ids = new Set(taken.map((task) => task.id))
  return tasks.filter((task) => !ids.has(task.id))
}

export const PROJECT_GROUP_MAX = 6

/** A draft block in minutes from the day's midnight. */
export type MinuteRange = readonly [number, number]

export interface DraftChoices {
  /** A length the person or the assistant gave, by task. */
  lengths?: ReadonlyMap<number, number>
  /** Placed by hand, by task. */
  pins?: ReadonlyMap<number, MinuteRange>
  /** Kept without a time. */
  keep?: ReadonlySet<number>
  /** The assistant's order: its starts, tried first. */
  starts?: readonly (readonly [number, number])[]
  /** Why a block sits there, by task. */
  reasons?: ReadonlyMap<number, string>
  /**
   * Busy time of the day's events (contract 20.2): your Events and the connected calendars that
   * count, as minutes from the day's midnight. Left out: none.
   */
  eventBusy?: readonly BusyRange[]
}

/** The day's busy time before the draft: its open blocks (16.6) and its events (20.2). */
export function dayBusy(
  dayTasks: readonly (BlockFields & { done?: boolean })[],
  day: LocalDate,
  eventBusy: readonly BusyRange[] = [],
): BusyRange[] {
  return [...busyOfDay(dayTasks, day), ...eventBusy]
}

/** The ticked tasks that need a time: no block on the day, not kept without one. */
export function tasksToPlace<T extends PlanSessionTask>(ticked: readonly T[], day: LocalDate, keep?: ReadonlySet<number>): T[] {
  return ticked.filter((task) => blockOf(task)?.day !== day && !keep?.has(task.id))
}

export interface PlanMeter {
  tasks: number
  toPlace: number
  free: number
  over: number
}

/** The meter of Choose: how much is ticked against the day's free time. */
export function planMeter<T extends PlanSessionTask>(
  ticked: readonly T[],
  dayTasks: readonly (BlockFields & { done?: boolean })[],
  options: { now: Date; day: LocalDate; hours: PlannerHours; defaultLength: number } & DraftChoices,
): PlanMeter {
  const free = freeMinutes(options.now, options.day, options.hours, dayBusy(dayTasks, options.day, options.eventBusy))
  const toPlace = tasksToPlace(ticked, options.day, options.keep).reduce((sum, task) => {
    const pin = options.pins?.get(task.id)
    return sum + (pin ? pin[1] - pin[0] : (options.lengths?.get(task.id) ?? options.defaultLength))
  }, 0)
  return { tasks: ticked.length, toPlace, free, over: Math.max(0, toPlace - free) }
}

// --- Arrange --------------------------------------------------------------------------------------

export interface DraftBlock {
  id: number
  start: number
  end: number
  pinned: boolean
  reason?: string
}

export interface PlanDraft {
  placed: DraftBlock[]
  /** No free slot left for these. */
  noSlot: number[]
}

/**
 * The draft: blocks placed by hand first, counted as busy (with the day's blocks and events); then
 * the assistant's starts that still fit, in its order; then the rest take the next free slot in Fit order. It is laid out again from
 * these inputs whenever one changes, with no new request.
 */
export function draftBlocks<T extends PlanSessionTask>(
  ticked: readonly T[],
  dayTasks: readonly (BlockFields & { done?: boolean })[],
  options: { now: Date; day: LocalDate; hours: PlannerHours; defaultLength: number } & DraftChoices,
): PlanDraft {
  const { now, day, hours, defaultLength, lengths, pins, keep, starts, reasons, eventBusy } = options
  const place = tasksToPlace(ticked, day, keep)
  const lengthOf = (task: T) => lengths?.get(task.id) ?? defaultLength
  const busy: BusyRange[] = dayBusy(dayTasks, day, eventBusy)
  const placed: DraftBlock[] = []
  const done = new Set<number>()

  for (const task of place) {
    const pin = pins?.get(task.id)
    if (!pin) continue
    placed.push({ id: task.id, start: pin[0], end: pin[1], pinned: true, reason: reasons?.get(task.id) })
    busy.push([pin[0], pin[1]])
    done.add(task.id)
  }

  for (const [id, start] of starts ?? []) {
    const task = place.find((candidate) => candidate.id === id)
    if (!task || done.has(id)) continue
    const end = start + lengthOf(task)
    if (!fitsFreeTime(now, day, hours, busy, start, end)) continue
    placed.push({ id, start, end, pinned: false, reason: reasons?.get(id) })
    busy.push([start, end])
    done.add(id)
  }

  const rest = place.filter((task) => !done.has(task.id))
  const fitted = fitTasks(rest, { now, day, hours, busy, lengthOf })
  for (const { task, start, end } of fitted) {
    placed.push({ id: task.id, start, end, pinned: false, reason: reasons?.get(task.id) })
  }
  const fittedIds = new Set(fitted.map(({ task }) => task.id))
  return { placed, noSlot: fitOrder(rest, now).filter((task) => !fittedIds.has(task.id)).map((task) => task.id) }
}

/** Inside one free range of the day, with `busy` taken. */
export function fitsFreeTime(
  now: Date,
  day: LocalDate,
  hours: PlannerHours,
  busy: readonly BusyRange[],
  start: number,
  end: number,
): boolean {
  return freeRanges(now, day, hours, busy).some(([a, b]) => start >= a && end <= b)
}

/** What accepting the plan writes for a task, or null for nothing. */
export function acceptChanges(
  task: PlanSessionTask,
  day: LocalDate,
  draft: Pick<DraftBlock, 'start' | 'end'> | null | undefined,
): BlockChanges | null {
  if (draft) return placeBlock(task.due_date, atClock(day, draft.start), draft.end - draft.start)
  if (blockOf(task)?.day === day) return null
  if (!isNoDueDate(task.due_date) && localDateOf(task.due_date) === day) return null
  return planForDay(task, day)
}

/** Moving a task that can wait: the next day, date-only, and no time. */
export function canWaitChanges(task: { reminders?: readonly BlockReminder[] | null }, day: LocalDate): BlockChanges {
  return planForDay(task, addLocalDays(day, 1))
}

/** The due date of the next day, for the line that names it. */
export function nextDayDue(day: LocalDate): string {
  return dateOnlyDue(addLocalDays(day, 1))
}

// --- Ready ----------------------------------------------------------------------------------------

const isStartReminder = (reminder: BlockReminder) => reminder.relative_to === 'start_date' && (reminder.relative_period ?? 0) === 0

/** Remind me when the block starts: added once, and the others stay. */
export function withStartReminder<R extends BlockReminder>(reminders: readonly R[] | null | undefined): (R | BlockReminder)[] {
  const list: (R | BlockReminder)[] = [...(reminders ?? [])]
  if (!list.some(isStartReminder)) list.push({ relative_to: 'start_date', relative_period: 0 })
  return list
}

export function withoutStartReminder<R extends BlockReminder>(reminders: readonly R[] | null | undefined): R[] {
  return (reminders ?? []).filter((reminder) => !isStartReminder(reminder))
}
