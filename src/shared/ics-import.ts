// Importing a calendar file into Events, once (contract 20.10). This is the pure half: it takes
// events already read from the file (by ical.js on the desktop, by the phone's own reader on
// Android), in the importing device's local time, and says which Events they become. A series whose
// RRULE fits Vicu's repeat rule (20.4) becomes one repeating Event; anything else is expanded by the
// reader and becomes single Events for the import day and the 365 days after it.
//
// Pinned by the `icsImport` vectors of cross-app-semantics-v1.json (they give ICS text, so the
// desktop runs them through src/main/calendar/ics-import.ts). Pure: no Electron, no DOM, no parser.

import { addLocalDays, type LocalDate } from './due-dates'
import {
  MAX_EVENT_MINUTES,
  daysBetween,
  nthRuleDay,
  occursOn,
  type EventRepeat,
  type PlanEvent,
  type Weekday,
} from './plan-events'

/** Days after the import day that a series which does not fit the repeat rule is copied for. */
export const IMPORT_WINDOW_DAYS = 365
/** The title of an event without a SUMMARY. */
export const UNTITLED_EVENT = '(No title)'

/** An RRULE as written, parts by name. */
export interface IcsRule {
  /** FREQ: DAILY, WEEKLY, MONTHLY, YEARLY, or anything else (never fits). */
  freq: string
  /** INTERVAL, 1 when absent. */
  interval: number
  /** BYDAY values as written: `MO`, `2TU`, `-1FR`. */
  byDay: string[]
  byMonthDay: number[]
  byMonth: number[]
  bySetPos: number[]
  /** The names of any other BY parts present (BYHOUR, BYWEEKNO, BYYEARDAY ...). */
  otherParts: string[]
  /** WKST as written (`SU`), null when absent. */
  wkst: string | null
  count: number | null
  /** UNTIL in the importing device's local time: `YYYY-MM-DD` for a date, else `YYYY-MM-DDTHH:mm:ss`. */
  until: string | null
}

/** One event or occurrence, in the importing device's local time. */
export interface IcsOccurrence {
  /** SUMMARY as written, '' when there is none. */
  title: string
  /** The local day it starts on. */
  start: LocalDate
  /** The local start, `HH:mm`, or null for an all-day event. */
  time: string | null
  /** A timed event's length in minutes (end less start). */
  minutes: number
  /** The days an all-day event covers, at least 1. */
  days: number
  /** False for TRANSP:TRANSPARENT. */
  busy: boolean
  /** STATUS:CANCELLED. */
  cancelled: boolean
}

/** A VEVENT with its recurrence, as the file has it. */
export interface IcsSeries extends IcsOccurrence {
  rule: IcsRule | null
  /** EXDATE days, local. */
  exdates: LocalDate[]
  /** RDATE, more than one RRULE, or overrides (RECURRENCE-ID): it never becomes one Event. */
  irregular: boolean
}

export interface ImportOptions {
  /** The local day of the import. */
  importDay: LocalDate
  /** Busy only: every title becomes "Busy", or "Free" for a free event (20.8). */
  busyOnly: boolean
}

/** The days a series that does not fit is copied for: the import day and the 365 after it. */
export function importWindow(importDay: LocalDate): { from: LocalDate; to: LocalDate } {
  return { from: importDay, to: addLocalDays(importDay, IMPORT_WINDOW_DAYS) }
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function readByDay(value: string): { n: number | null; weekday: Weekday } | null {
  const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(value.trim().toUpperCase())
  if (!match) return null
  return { n: match[1] === undefined ? null : Number(match[1]), weekday: WEEKDAY_CODES.indexOf(match[2]) as Weekday }
}

function dayParts(day: LocalDate): { month: number; date: number; weekday: Weekday } {
  const [y, m, d] = day.split('-').map(Number)
  return { month: m, date: d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday }
}

/** The repeat rule an RRULE is, for a series starting on `start`, or null when it does not fit. */
export function repeatFromRule(rule: IcsRule, start: LocalDate): EventRepeat | null {
  if (rule.otherParts.length > 0) return null
  const every = rule.interval
  if (!Number.isInteger(every) || every < 1 || every > 99) return null
  const days = rule.byDay.map(readByDay)
  if (days.some((d) => d === null)) return null
  const byDay = days as { n: number | null; weekday: Weekday }[]
  const plain = byDay.every((d) => d.n === null)
  const weekdays = () => [...new Set(byDay.map((d) => d.weekday))].sort((a, b) => a - b)
  const s = dayParts(start)

  switch (rule.freq.toUpperCase()) {
    case 'DAILY':
      if (rule.byMonthDay.length || rule.byMonth.length || rule.bySetPos.length) return null
      if (byDay.length === 0) return { kind: 'daily', every }
      // Some apps write "every weekday" this way.
      return plain && every === 1 ? { kind: 'weekly', every: 1, days: weekdays() } : null
    case 'WEEKLY':
      if (rule.byMonthDay.length || rule.byMonth.length || rule.bySetPos.length || !plain) return null
      if (every > 1 && rule.wkst !== null && rule.wkst.toUpperCase() !== 'MO') return null
      return { kind: 'weekly', every, days: byDay.length ? weekdays() : [s.weekday] }
    case 'MONTHLY': {
      if (rule.byMonth.length) return null
      if (byDay.length === 0) {
        if (rule.bySetPos.length) return null
        if (rule.byMonthDay.length === 0) return { kind: 'monthly-date', every, date: s.date }
        const date = rule.byMonthDay[0]
        return rule.byMonthDay.length === 1 && Number.isInteger(date) && date >= 1 && date <= 31 ? { kind: 'monthly-date', every, date } : null
      }
      if (rule.byMonthDay.length || byDay.length !== 1) return null
      const [only] = byDay
      let week: number
      if (only.n !== null) {
        if (rule.bySetPos.length) return null
        week = only.n
      } else {
        if (rule.bySetPos.length !== 1) return null
        week = rule.bySetPos[0]
      }
      if (![1, 2, 3, 4, -1].includes(week)) return null
      return { kind: 'monthly-weekday', every, week: week as 1 | 2 | 3 | 4 | -1, weekday: only.weekday }
    }
    case 'YEARLY':
      if (byDay.length || rule.bySetPos.length) return null
      if (rule.byMonth.length > 1 || (rule.byMonth.length === 1 && rule.byMonth[0] !== s.month)) return null
      if (rule.byMonthDay.length > 1 || (rule.byMonthDay.length === 1 && rule.byMonthDay[0] !== s.date)) return null
      return { kind: 'yearly', every }
    default:
      return null
  }
}

/** The last day a series may happen on: the COUNTth day of its rule, or the local day of UNTIL. */
export function untilFromRule(rule: IcsRule, repeat: EventRepeat, start: LocalDate, time: string | null): LocalDate | null {
  if (rule.count !== null) return nthRuleDay(repeat, start, rule.count) ?? start
  if (rule.until === null) return null
  const [day, clock] = rule.until.split('T')
  // An occurrence starting after UNTIL on its last day is not in the series.
  return clock && time !== null && `${time}:00` > clock ? addLocalDays(day, -1) : day
}

function titleOf(event: IcsOccurrence, options: ImportOptions): string {
  if (options.busyOnly) return event.busy ? 'Busy' : 'Free'
  return event.title.trim() || UNTITLED_EVENT
}

function lengthOf(minutes: number): number {
  return Math.min(MAX_EVENT_MINUTES, Math.max(1, Math.round(minutes)))
}

/**
 * One event or occurrence as a single Event, or null when it is cancelled, ends before the import day
 * begins or starts after the window. An all-day event of several days repeats daily until its last day.
 */
export function importOccurrence(event: IcsOccurrence, options: ImportOptions): PlanEvent | null {
  if (event.cancelled) return null
  const { from, to } = importWindow(options.importDay)
  if (event.start > to) return null
  const offset = daysBetween(from, event.start)
  const title = titleOf(event, options)
  if (event.time === null) {
    const days = Math.max(1, Math.round(event.days))
    if (offset + days <= 0) return null
    return days === 1
      ? { title, start: event.start, time: null, minutes: 0, repeat: { kind: 'none' } }
      : { title, start: event.start, time: null, minutes: 0, repeat: { kind: 'daily', every: 1 }, until: addLocalDays(event.start, days - 1) }
  }
  const minutes = lengthOf(event.minutes)
  const [h, m] = event.time.split(':').map(Number)
  if (offset * 1440 + h * 60 + m + minutes <= 0) return null
  const single: PlanEvent = { title, start: event.start, time: event.time, minutes, repeat: { kind: 'none' } }
  if (!event.busy) single.busy = false
  return single
}

/**
 * A series as one repeating Event ([]: nothing to import, it is cancelled or ended before the import
 * day), or null when it does not fit the repeat rule and the reader must expand it into occurrences
 * for `importOccurrence`. An event without a rule is one occurrence.
 */
export function importSeries(series: IcsSeries, options: ImportOptions): PlanEvent[] | null {
  if (series.cancelled) return []
  if (series.irregular) return null
  if (!series.rule) {
    const single = importOccurrence(series, options)
    return single ? [single] : []
  }
  if (series.time === null && series.days > 1) return null
  const repeat = repeatFromRule(series.rule, series.start)
  if (!repeat) return null
  // The first day must be one the rule gives, or the series has an occurrence Vicu's rule cannot hold.
  if (!occursOn({ title: '', start: series.start, time: series.time, minutes: 0, repeat }, series.start)) return null
  const until = untilFromRule(series.rule, repeat, series.start, series.time)
  if (until !== null && until < options.importDay) return []
  const ruled: PlanEvent = { title: titleOf(series, options), start: series.start, time: series.time, minutes: 0, repeat, until }
  const skips = [...new Set(series.exdates.filter((day) => occursOn(ruled, day)))].sort()
  const event: PlanEvent = { ...ruled, minutes: series.time === null ? 0 : lengthOf(series.minutes), skips }
  if (series.time !== null && !series.busy) event.busy = false
  return [event]
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Imported Events in a stable order: by first day, all-day first, then time, then title (code points). */
export function sortImported(events: readonly PlanEvent[]): PlanEvent[] {
  return [...events].sort(
    (a, b) =>
      compare(a.start, b.start) ||
      compare(a.time ?? '', b.time ?? '') ||
      compare(a.title, b.title) ||
      compare(JSON.stringify(a), JSON.stringify(b)),
  )
}
