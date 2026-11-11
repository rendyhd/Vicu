// Events (contract section 20): times you are not available, typed by hand. A weekly manager call, a
// monthly review, a month-end close. Not tasks (nothing to tick) and not routines (nothing to track):
// they have a time and a length, can repeat, show on the Plan screen only and count as busy time
// there. All-day events sit in the row above the timeline and are never busy.
//
// Each is one synced preference, `event.<id>` (contract 11.3 and 20.3), so every device has them.
// Times are wall-clock ("10:00 every Tuesday" stays 10:00 through a clock change), and the repeat
// rule is Vicu's own small one (20.4), not iCalendar's RRULE, so both apps read it exactly the same.
// Pinned by the `planEvents` and `eventChanges` vectors of cross-app-semantics-v1.json; Vicu mobile
// has a line-for-line port. Pure: no Electron, no DOM.

import { addLocalDays, type LocalDate } from './due-dates'
import { MY_EVENTS_CALENDAR_ID, type CalendarEvent } from './calendar-events'
import { DEFAULT_LENGTH_MINUTES } from './time-blocks'

export const EVENT_KEY_PREFIX = 'event.'
/** The calendar id of these events among the calendar events of the Plan screen. */
export { MY_EVENTS_CALENDAR_ID }
export const MY_EVENTS_COLOR = '#12a594'
/** The longest Event, in minutes. */
export const MAX_EVENT_MINUTES = 24 * 60

/** 0 is Sunday ... 6 is Saturday, as `Date.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type EventRepeat =
  | { kind: 'none' }
  | { kind: 'daily'; every: number }
  /** On these days of the week, every `every` weeks (weeks start on Monday). */
  | { kind: 'weekly'; every: number; days: Weekday[] }
  /** On this date of the month; a month without it (the 31st) has none. */
  | { kind: 'monthly-date'; every: number; date: number }
  /** On the nth weekday of the month (1 to 4), or the last one (-1). */
  | { kind: 'monthly-weekday'; every: number; week: 1 | 2 | 3 | 4 | -1; weekday: Weekday }
  /** On the first day's month and date; 29 February only in leap years. */
  | { kind: 'yearly'; every: number }

export interface PlanEvent {
  title: string
  /** The first day. */
  start: LocalDate
  /** "HH:mm", or null for an all-day event. */
  time: string | null
  /** Length in minutes, 1 to 1440 (a timed event); 0 for an all-day event. */
  minutes: number
  repeat: EventRepeat
  /** The last day it may happen on. */
  until?: LocalDate | null
  /** Days left out ("skip this one"). */
  skips?: LocalDate[]
  /** False: a timed event that does not count as busy. Default true; an all-day event is never busy. */
  busy?: boolean
  /** Fields this version does not know, kept as they were and written back (20.3). */
  kept?: Readonly<Record<string, unknown>>
}

export interface ListedEvent extends PlanEvent {
  id: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const KNOWN_FIELDS = new Set(['title', 'start', 'time', 'minutes', 'repeat', 'until', 'skips', 'busy'])
const NO_REPEAT: EventRepeat = { kind: 'none' }

export function eventKey(id: string): string {
  return `${EVENT_KEY_PREFIX}${id}`
}

function isWeekday(d: unknown): d is Weekday {
  return typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6
}

/** The repeat rule `value` holds, or null when it is not one this version reads. */
export function readRepeat(value: unknown): EventRepeat | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  const every = r.every === undefined ? 1 : r.every
  const okEvery = typeof every === 'number' && Number.isInteger(every) && every >= 1 && every <= 99
  switch (r.kind) {
    case 'none':
      return { kind: 'none' }
    case 'daily':
      return okEvery ? { kind: 'daily', every: every as number } : null
    case 'weekly': {
      const days = Array.isArray(r.days) ? r.days : []
      if (!okEvery || days.length === 0 || !days.every(isWeekday)) return null
      return { kind: 'weekly', every: every as number, days: sortedDays(days) }
    }
    case 'monthly-date':
      return okEvery && typeof r.date === 'number' && Number.isInteger(r.date) && r.date >= 1 && r.date <= 31
        ? { kind: 'monthly-date', every: every as number, date: r.date }
        : null
    case 'monthly-weekday':
      return okEvery && [1, 2, 3, 4, -1].includes(r.week as number) && isWeekday(r.weekday)
        ? { kind: 'monthly-weekday', every: every as number, week: r.week as 1 | 2 | 3 | 4 | -1, weekday: r.weekday }
        : null
    case 'yearly':
      return okEvery ? { kind: 'yearly', every: every as number } : null
    default:
      return null
  }
}

function sortedDays(days: readonly Weekday[]): Weekday[] {
  return [...new Set(days)].sort((a, b) => a - b)
}

/** The event `value` holds, or null when it is not one (it is then ignored and kept). */
export function readPlanEvent(value: unknown): PlanEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.title !== 'string' || !v.title.trim()) return null
  if (typeof v.start !== 'string' || !DAY.test(v.start)) return null
  const time = v.time === null || v.time === undefined ? null : v.time
  if (time !== null && (typeof time !== 'string' || !CLOCK.test(time))) return null
  let minutes = 0
  if (time !== null) {
    if (typeof v.minutes !== 'number' || !Number.isInteger(v.minutes) || v.minutes < 1 || v.minutes > MAX_EVENT_MINUTES) return null
    minutes = v.minutes
  }
  const repeat = v.repeat === undefined || v.repeat === null ? NO_REPEAT : readRepeat(v.repeat)
  if (!repeat) return null
  const until = typeof v.until === 'string' && DAY.test(v.until) ? v.until : null
  const skips = Array.isArray(v.skips) ? [...new Set(v.skips.filter((d): d is string => typeof d === 'string' && DAY.test(d)))].sort() : []
  const event: PlanEvent = { title: v.title.trim(), start: v.start, time, minutes, repeat, until, skips }
  if (typeof v.busy === 'boolean') event.busy = v.busy
  const kept = Object.fromEntries(Object.entries(v).filter(([key]) => !KNOWN_FIELDS.has(key)))
  if (Object.keys(kept).length > 0) event.kept = kept
  return event
}

function encodeRepeat(repeat: EventRepeat): Record<string, unknown> {
  switch (repeat.kind) {
    case 'none':
      return { kind: 'none' }
    case 'daily':
    case 'yearly':
      return { kind: repeat.kind, every: repeat.every }
    case 'weekly':
      return { kind: 'weekly', every: repeat.every, days: sortedDays(repeat.days) }
    case 'monthly-date':
      return { kind: 'monthly-date', every: repeat.every, date: repeat.date }
    case 'monthly-weekday':
      return { kind: 'monthly-weekday', every: repeat.every, week: repeat.week, weekday: repeat.weekday }
  }
}

/**
 * What is written (20.3): unknown fields as they were, then the known ones without their defaults.
 * An all-day event has no `time`, `minutes` or `busy`; `repeat` only when it repeats.
 */
export function encodePlanEvent(event: PlanEvent): Record<string, unknown> {
  const written: Record<string, unknown> = { ...(event.kept ?? {}) }
  written.title = event.title.trim()
  written.start = event.start
  if (event.time !== null) {
    written.time = event.time
    written.minutes = event.minutes
  }
  if (event.repeat.kind !== 'none') written.repeat = encodeRepeat(event.repeat)
  if (event.until) written.until = event.until
  if (event.skips && event.skips.length > 0) written.skips = [...new Set(event.skips)].sort()
  if (event.time !== null && event.busy === false) written.busy = false
  return written
}

/** The account's events, by title, then id. */
export function readPlanEvents(values: Readonly<Record<string, unknown>>): ListedEvent[] {
  const listed: ListedEvent[] = []
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(EVENT_KEY_PREFIX) || key.length === EVENT_KEY_PREFIX.length) continue
    const event = readPlanEvent(value)
    if (event) listed.push({ ...event, id: key.slice(EVENT_KEY_PREFIX.length) })
  }
  return listed.sort((a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Whether it counts as busy time (20.2): a timed event unless its `busy` is false. */
export function isBusy(event: Pick<PlanEvent, 'time' | 'busy'>): boolean {
  return event.time !== null && event.busy !== false
}

// --- Days -----------------------------------------------------------------------------------------

/** Day number since 1970-01-01 of a local date: calendar arithmetic, free of time zones. */
function dayNumber(day: LocalDate): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

/** Days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return dayNumber(to) - dayNumber(from)
}

function parts(day: LocalDate): { year: number; month: number; date: number; weekday: Weekday } {
  const [year, month, date] = day.split('-').map(Number)
  return { year, month, date, weekday: new Date(Date.UTC(year, month - 1, date)).getUTCDay() as Weekday }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Monday-based week number, for "every 2 weeks". */
function weekNumber(day: LocalDate): number {
  // 1970-01-05 was a Monday: day 4.
  return Math.floor((dayNumber(day) - 4) / 7)
}

function monthsBetween(a: LocalDate, b: LocalDate): number {
  const pa = parts(a)
  const pb = parts(b)
  return (pb.year - pa.year) * 12 + (pb.month - pa.month)
}

/** Whether the rule gives `day`, counted from `start` (no until, no skips). */
function ruleGives(repeat: EventRepeat, start: LocalDate, day: LocalDate): boolean {
  if (day < start) return false
  const p = parts(day)
  switch (repeat.kind) {
    case 'none':
      return day === start
    case 'daily':
      return daysBetween(start, day) % repeat.every === 0
    case 'weekly':
      return repeat.days.includes(p.weekday) && (weekNumber(day) - weekNumber(start)) % repeat.every === 0
    case 'monthly-date':
      return p.date === repeat.date && monthsBetween(start, day) % repeat.every === 0
    case 'monthly-weekday': {
      if (p.weekday !== repeat.weekday || monthsBetween(start, day) % repeat.every !== 0) return false
      return repeat.week === -1 ? p.date + 7 > daysInMonth(p.year, p.month) : Math.ceil(p.date / 7) === repeat.week
    }
    case 'yearly': {
      const s = parts(start)
      return p.month === s.month && p.date === s.date && (p.year - s.year) % repeat.every === 0
    }
  }
}

/** Whether the event happens on `day` (its start, its rule, its end and its skips). */
export function occursOn(event: PlanEvent, day: LocalDate): boolean {
  if (event.until && day > event.until) return false
  if (event.skips?.includes(day)) return false
  return ruleGives(event.repeat, event.start, day)
}

/** The days it happens on from `from` to `to`, both included. */
export function eventDaysBetween(event: PlanEvent, from: LocalDate, to: LocalDate): LocalDate[] {
  const days: LocalDate[] = []
  const first = from < event.start ? event.start : from
  const last = event.until && event.until < to ? event.until : to
  for (let day = first; day <= last; day = addLocalDays(day, 1)) {
    if (occursOn(event, day)) days.push(day)
  }
  return days
}

/** The day of the `count`th day the rule gives from `start` (skips not counted out), or null. */
export function nthRuleDay(repeat: EventRepeat, start: LocalDate, count: number): LocalDate | null {
  if (count < 1) return null
  if (repeat.kind === 'none') return count === 1 ? start : null
  let seen = 0
  // At most 400 years of days: a rule that gives nothing (31 February) stops.
  for (let i = 0; i < 146_100; i++) {
    const day = addLocalDays(start, i)
    if (ruleGives(repeat, start, day) && ++seen === count) return day
  }
  return null
}

/** The event's occurrences on `days` as calendar events of the Plan screen (20.1). */
export function planEventOccurrences(events: readonly ListedEvent[], days: readonly LocalDate[]): CalendarEvent[] {
  const out: CalendarEvent[] = []
  for (const event of events) {
    for (const day of days) {
      if (!occursOn(event, day)) continue
      const [y, m, d] = day.split('-').map(Number)
      let start: Date
      let end: Date
      if (event.time === null) {
        start = new Date(y, m - 1, d)
        end = new Date(y, m - 1, d + 1)
      } else {
        // Wall clock: the start's clock time on that day, the end `minutes` later on the clock.
        const [h, min] = event.time.split(':').map(Number)
        start = new Date(y, m - 1, d, h, min)
        end = new Date(y, m - 1, d, h, min + event.minutes)
      }
      out.push({
        id: `${MY_EVENTS_CALENDAR_ID}:${event.id}:${day}`,
        calendarId: MY_EVENTS_CALENDAR_ID,
        title: event.title,
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: event.time === null,
        busy: isBusy(event),
        tentative: false,
        planEventId: event.id,
        day,
      })
    }
  }
  return out
}

// --- Choices and words (20.5) ---------------------------------------------------------------------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ORDINAL_WEEK: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' }

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const WEEKDAY_SET: Weekday[] = [1, 2, 3, 4, 5]

/** How a rule reads, from the event's first day. */
export function repeatText(repeat: EventRepeat): string {
  switch (repeat.kind) {
    case 'none':
      return 'Does not repeat'
    case 'daily':
      return repeat.every === 1 ? 'Every day' : `Every ${repeat.every} days`
    case 'weekly': {
      if (repeat.every === 1 && repeat.days.join() === WEEKDAY_SET.join()) return 'Every weekday'
      // Named Monday first, the way the weeks count.
      const names = [...repeat.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS[d]).join(', ')
      return repeat.every === 1 ? `Every ${names}` : `Every ${repeat.every} weeks on ${names}`
    }
    case 'monthly-date':
      return repeat.every === 1 ? `Monthly on the ${ordinal(repeat.date)}` : `Every ${repeat.every} months on the ${ordinal(repeat.date)}`
    case 'monthly-weekday': {
      const what = `the ${ORDINAL_WEEK[repeat.week]} ${WEEKDAYS[repeat.weekday]}`
      return repeat.every === 1 ? `Monthly on ${what}` : `Every ${repeat.every} months on ${what}`
    }
    case 'yearly':
      return repeat.every === 1 ? 'Every year' : `Every ${repeat.every} years`
  }
}

/** The repeat choices offered for an event starting on `day`, in order. */
export function repeatChoices(day: LocalDate): { label: string; repeat: EventRepeat }[] {
  const p = parts(day)
  const week = Math.ceil(p.date / 7)
  const isLast = p.date + 7 > daysInMonth(p.year, p.month)
  const choices: { label: string; repeat: EventRepeat }[] = [
    { label: 'Does not repeat', repeat: { kind: 'none' } },
    { label: 'Every day', repeat: { kind: 'daily', every: 1 } },
  ]
  // Only on Monday to Friday: every choice happens on the day it is offered for.
  if (WEEKDAY_SET.includes(p.weekday)) choices.push({ label: 'Every weekday', repeat: { kind: 'weekly', every: 1, days: WEEKDAY_SET } })
  choices.push(
    { label: `Every ${WEEKDAYS[p.weekday]}`, repeat: { kind: 'weekly', every: 1, days: [p.weekday] } },
    { label: `Every 2 weeks on ${WEEKDAYS[p.weekday]}`, repeat: { kind: 'weekly', every: 2, days: [p.weekday] } },
    { label: `Monthly on the ${ordinal(p.date)}`, repeat: { kind: 'monthly-date', every: 1, date: p.date } },
  )
  if (week <= 4) {
    choices.push({ label: `Monthly on the ${ORDINAL_WEEK[week]} ${WEEKDAYS[p.weekday]}`, repeat: { kind: 'monthly-weekday', every: 1, week: week as 1 | 2 | 3 | 4, weekday: p.weekday } })
  }
  if (isLast) {
    choices.push({ label: `Monthly on the last ${WEEKDAYS[p.weekday]}`, repeat: { kind: 'monthly-weekday', every: 1, week: -1, weekday: p.weekday } })
  }
  choices.push({ label: `Every year on ${MONTHS[p.month - 1]} ${p.date}`, repeat: { kind: 'yearly', every: 1 } })
  return choices
}

/** The index of `repeat` among `choices`, or -1 when the rule is one the list does not offer. */
export function choiceIndex(choices: readonly { repeat: EventRepeat }[], repeat: EventRepeat): number {
  const key = JSON.stringify(encodeRepeat(repeat))
  return choices.findIndex((choice) => JSON.stringify(encodeRepeat(choice.repeat)) === key)
}

/** The next day after `day` it happens on, within two years, or null. */
export function nextOccurrence(event: PlanEvent, day: LocalDate): LocalDate | null {
  for (let i = 1; i <= 366 * 2; i++) {
    const next = addLocalDays(day, i)
    if (event.until && next > event.until) return null
    if (occursOn(event, next)) return next
  }
  return null
}

/** Whether it happens on any day before `day` (skips count as not happening). */
export function hasOccurrenceBefore(event: PlanEvent, day: LocalDate): boolean {
  for (let d = event.start; d < day; d = addLocalDays(d, 1)) {
    if (event.until && d > event.until) return false
    if (occursOn(event, d)) return true
  }
  return false
}

// --- Changes (20.6) -------------------------------------------------------------------------------

/** What a change sets. Left out: as it was. */
export interface EventEdit {
  title?: string
  /** null makes it all-day. */
  time?: string | null
  minutes?: number
  busy?: boolean
  repeat?: EventRepeat
  until?: LocalDate | null
  /** Moves the occurrence being changed to this day. */
  day?: LocalDate
}

/** All times, this time only, this and following. */
export type EventScope = 'all' | 'this' | 'following'

/** Synced preference entries to write: `event.<id>` to an encoded event, or null (deleted). */
export type EventWrites = Record<string, Record<string, unknown> | null>

/**
 * The rule moved with an occurrence from `from` to `to`: daily, yearly and none follow the first day;
 * weekly days move by the same number of days; monthly takes the date, or the week and weekday, of
 * `to` (the last week when `to` is in its month's last seven days and the rule said last, or `to` is
 * a fifth weekday).
 */
export function repeatMovedTo(repeat: EventRepeat, from: LocalDate, to: LocalDate): EventRepeat {
  const delta = daysBetween(from, to)
  if (delta === 0) return repeat
  const p = parts(to)
  switch (repeat.kind) {
    case 'none':
    case 'daily':
    case 'yearly':
      return repeat
    case 'weekly': {
      const shift = ((delta % 7) + 7) % 7
      return { kind: 'weekly', every: repeat.every, days: sortedDays(repeat.days.map((d) => ((d + shift) % 7) as Weekday)) }
    }
    case 'monthly-date':
      return { kind: 'monthly-date', every: repeat.every, date: p.date }
    case 'monthly-weekday': {
      const week = Math.ceil(p.date / 7)
      const isLast = p.date + 7 > daysInMonth(p.year, p.month)
      const next = week > 4 || (repeat.week === -1 && isLast) ? -1 : (week as 1 | 2 | 3 | 4)
      return { kind: 'monthly-weekday', every: repeat.every, week: next, weekday: p.weekday }
    }
  }
}

/** The event's title, time, length and busy with the edit applied. */
function withFields(event: PlanEvent, edit: EventEdit): PlanEvent {
  const time = edit.time !== undefined ? edit.time : event.time
  const minutes = time === null ? 0 : edit.minutes ?? (event.minutes > 0 ? event.minutes : DEFAULT_LENGTH_MINUTES)
  const changed: PlanEvent = { ...event, title: (edit.title ?? event.title).trim(), time, minutes }
  const busy = edit.busy !== undefined ? edit.busy : event.busy
  if (busy === undefined) delete changed.busy
  else changed.busy = busy
  return changed
}

const shiftDay = (day: LocalDate, delta: number) => addLocalDays(day, delta)

/**
 * A change to the occurrence of `event` on `day` (20.6). `newId` names the Event a split makes; it is
 * not used when the change stays in the one entry. A rule that does not repeat is always "all".
 * "This and following" on a day with no occurrence before it is "all".
 */
export function changeEvent(event: ListedEvent, day: LocalDate, edit: EventEdit, scope: EventScope, newId: string): EventWrites {
  const { id, ...series } = event
  const to = edit.day ?? day
  const delta = daysBetween(day, to)
  const skips = series.skips ?? []
  let effective: EventScope = series.repeat.kind === 'none' ? 'all' : scope
  if (effective === 'following' && !hasOccurrenceBefore(series, day)) effective = 'all'

  if (effective === 'all') {
    const changed: PlanEvent = {
      ...withFields(series, edit),
      start: shiftDay(series.start, delta),
      repeat: edit.repeat ?? repeatMovedTo(series.repeat, day, to),
      until: edit.until !== undefined ? edit.until : series.until ? shiftDay(series.until, delta) : null,
      skips: skips.map((d) => shiftDay(d, delta)),
    }
    return { [eventKey(id)]: encodePlanEvent(changed) }
  }

  if (effective === 'this') {
    const single: PlanEvent = { ...withFields(series, edit), start: to, repeat: NO_REPEAT, until: null, skips: [] }
    return {
      [eventKey(id)]: encodePlanEvent({ ...series, skips: [...skips, day] }),
      [eventKey(newId)]: encodePlanEvent(single),
    }
  }

  const end = addLocalDays(day, -1)
  const before: PlanEvent = { ...series, until: end, skips: skips.filter((d) => d <= end) }
  const after: PlanEvent = {
    ...withFields(series, edit),
    start: to,
    repeat: edit.repeat ?? repeatMovedTo(series.repeat, day, to),
    until: edit.until !== undefined ? edit.until : series.until ? shiftDay(series.until, delta) : null,
    skips: skips.filter((d) => d > end).map((d) => shiftDay(d, delta)),
  }
  return { [eventKey(id)]: encodePlanEvent(before), [eventKey(newId)]: encodePlanEvent(after) }
}

/** Skip this one: the day joins the skips. */
export function skipEventDay(event: ListedEvent, day: LocalDate): EventWrites {
  const { id, ...series } = event
  return { [eventKey(id)]: encodePlanEvent({ ...series, skips: [...(series.skips ?? []), day] }) }
}

/** Delete: the entry becomes null on every device. */
export function deleteEvent(event: Pick<ListedEvent, 'id'>): EventWrites {
  return { [eventKey(event.id)]: null }
}

/** Undo of `writes`: each entry as it was in `before` (the stored values), null when it was not there. */
export function undoEventWrites(writes: EventWrites, before: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const undo: Record<string, unknown> = {}
  for (const key of Object.keys(writes)) undo[key] = before[key] ?? null
  return undo
}
