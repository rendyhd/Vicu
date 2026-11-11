// Events: times you are not available, typed by hand (proof of concept, branch feat/calendar-poc).
// A weekly manager call, a monthly review, a month-end close. Not tasks (nothing to tick) and not
// routines (nothing to track): they have a time and a length, can repeat, show on the Plan screen
// only and count as busy time there. All-day events sit in the row above the timeline and are not busy.
//
// Each is one synced preference, `event.<id>` (contract section 11), so every device has them.
// Times are wall-clock ("10:00 every Tuesday" stays 10:00 through a clock change), and the repeat
// rule is Vicu's own small one, not iCalendar's RRULE, so both apps can read it exactly the same.
// Pure: no Electron, no DOM.

import { addLocalDays, type LocalDate } from './due-dates'
import type { CalendarEvent } from './calendar-events'

export const EVENT_KEY_PREFIX = 'event.'
/** The calendar id of these events among the calendar events of the Plan screen. */
export const MY_EVENTS_CALENDAR_ID = 'vicu:events'
export const MY_EVENTS_COLOR = '#12a594'

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
  /** "HH:MM", or null for an all-day event. */
  time: string | null
  /** Length in minutes (a timed event). */
  minutes: number
  repeat: EventRepeat
  /** The last day it may happen on. */
  until?: LocalDate | null
  /** Days left out ("skip this one"). */
  skips?: LocalDate[]
  /** Counts as busy time. Default: timed yes, all-day no. */
  busy?: boolean
}

export interface ListedEvent extends PlanEvent {
  id: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_MINUTES = 24 * 60

export function eventKey(id: string): string {
  return `${EVENT_KEY_PREFIX}${id}`
}

function readRepeat(value: unknown): EventRepeat | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  const every = r.every === undefined ? 1 : r.every
  const okEvery = typeof every === 'number' && Number.isInteger(every) && every >= 1 && every <= 99
  const isWeekday = (d: unknown): d is Weekday => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6
  switch (r.kind) {
    case 'none':
      return { kind: 'none' }
    case 'daily':
      return okEvery ? { kind: 'daily', every: every as number } : null
    case 'weekly': {
      const days = Array.isArray(r.days) ? r.days : []
      if (!okEvery || days.length === 0 || !days.every(isWeekday)) return null
      return { kind: 'weekly', every: every as number, days: [...new Set(days)].sort() as Weekday[] }
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

/** The event `value` holds, or null when it is not one (it is then ignored and kept). */
export function readPlanEvent(value: unknown): PlanEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.title !== 'string' || !v.title.trim()) return null
  if (typeof v.start !== 'string' || !DAY.test(v.start)) return null
  const time = v.time === null || v.time === undefined ? null : v.time
  if (time !== null && (typeof time !== 'string' || !CLOCK.test(time))) return null
  const minutes = typeof v.minutes === 'number' && Number.isInteger(v.minutes) && v.minutes > 0 && v.minutes <= MAX_MINUTES ? v.minutes : time ? null : 0
  if (minutes === null) return null
  const repeat = readRepeat(v.repeat ?? { kind: 'none' })
  if (!repeat) return null
  const until = typeof v.until === 'string' && DAY.test(v.until) ? v.until : null
  const skips = Array.isArray(v.skips) ? v.skips.filter((d): d is string => typeof d === 'string' && DAY.test(d)) : []
  return {
    title: v.title.trim(),
    start: v.start,
    time,
    minutes,
    repeat,
    until,
    skips,
    busy: typeof v.busy === 'boolean' ? v.busy : undefined,
  }
}

/** What is written: defaults left out. */
export function encodePlanEvent(event: PlanEvent): Record<string, unknown> {
  const written: Record<string, unknown> = { title: event.title.trim(), start: event.start, time: event.time, minutes: event.minutes, repeat: event.repeat }
  if (event.until) written.until = event.until
  if (event.skips && event.skips.length > 0) written.skips = [...new Set(event.skips)].sort()
  if (event.busy !== undefined && event.busy !== isBusyByDefault(event)) written.busy = event.busy
  return written
}

/** The account's events, by title. */
export function readPlanEvents(values: Readonly<Record<string, unknown>>): ListedEvent[] {
  const listed: ListedEvent[] = []
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(EVENT_KEY_PREFIX) || key.length === EVENT_KEY_PREFIX.length) continue
    const event = readPlanEvent(value)
    if (event) listed.push({ ...event, id: key.slice(EVENT_KEY_PREFIX.length) })
  }
  return listed.sort((a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1))
}

function isBusyByDefault(event: Pick<PlanEvent, 'time'>): boolean {
  return event.time !== null
}

export function isBusy(event: Pick<PlanEvent, 'time' | 'busy'>): boolean {
  return event.busy ?? isBusyByDefault(event)
}

// --- Days -----------------------------------------------------------------------------------------

/** Day number since 1970-01-01 of a local date: calendar arithmetic, free of time zones. */
function dayNumber(day: LocalDate): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
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

/** Whether the event happens on `day` (its start, its rule, its end and its skips). */
export function occursOn(event: PlanEvent, day: LocalDate): boolean {
  if (day < event.start) return false
  if (event.until && day > event.until) return false
  if (event.skips?.includes(day)) return false
  const r = event.repeat
  const p = parts(day)
  const s = parts(event.start)
  switch (r.kind) {
    case 'none':
      return day === event.start
    case 'daily':
      return (dayNumber(day) - dayNumber(event.start)) % r.every === 0
    case 'weekly':
      return r.days.includes(p.weekday) && (weekNumber(day) - weekNumber(event.start)) % r.every === 0
    case 'monthly-date':
      return p.date === r.date && monthsBetween(event.start, day) % r.every === 0
    case 'monthly-weekday': {
      if (p.weekday !== r.weekday || monthsBetween(event.start, day) % r.every !== 0) return false
      return r.week === -1 ? p.date + 7 > daysInMonth(p.year, p.month) : Math.ceil(p.date / 7) === r.week
    }
    case 'yearly':
      return p.month === s.month && p.date === s.date && (p.year - s.year) % r.every === 0
  }
}

/** The event's occurrences on `days` as calendar events of the Plan screen. */
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

// --- Choices and words ----------------------------------------------------------------------------

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
      const names = repeat.days.map((d) => WEEKDAYS[d]).join(', ')
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

/** The repeat choices offered for an event starting on `day`, as a calendar app offers them. */
export function repeatChoices(day: LocalDate): { label: string; repeat: EventRepeat }[] {
  const p = parts(day)
  const week = Math.ceil(p.date / 7)
  const isLast = p.date + 7 > daysInMonth(p.year, p.month)
  const choices: { label: string; repeat: EventRepeat }[] = [
    { label: 'Does not repeat', repeat: { kind: 'none' } },
    { label: 'Every day', repeat: { kind: 'daily', every: 1 } },
    { label: 'Every weekday', repeat: { kind: 'weekly', every: 1, days: WEEKDAY_SET } },
    { label: `Every ${WEEKDAYS[p.weekday]}`, repeat: { kind: 'weekly', every: 1, days: [p.weekday] } },
    { label: `Every 2 weeks on ${WEEKDAYS[p.weekday]}`, repeat: { kind: 'weekly', every: 2, days: [p.weekday] } },
    { label: `Monthly on the ${ordinal(p.date)}`, repeat: { kind: 'monthly-date', every: 1, date: p.date } },
  ]
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
  const key = JSON.stringify(repeat)
  return choices.findIndex((choice) => JSON.stringify(choice.repeat) === key)
}

/** The next day after `day` it happens on, within a year, or null. */
export function nextOccurrence(event: PlanEvent, day: LocalDate): LocalDate | null {
  for (let i = 1; i <= 366 * 2; i++) {
    const next = addLocalDays(day, i)
    if (event.until && next > event.until) return null
    if (occursOn(event, next)) return next
  }
  return null
}
