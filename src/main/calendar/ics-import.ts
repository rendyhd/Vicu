// Importing a calendar file into Events, once (contract 20.10): the ical.js half. It reads the file
// into the neutral shapes of src/shared/ics-import.ts, in this device's local time, and expands the
// series that do not fit the repeat rule (RRULE, RDATE, EXDATE and RECURRENCE-ID overrides, done by
// ical.js) into occurrences for the import window. The rules are all in the shared module. Free of
// Electron so it can be tested.

import ICAL from 'ical.js'
import { addLocalDays, startOfLocalDay, toLocalDate, type LocalDate } from '../../shared/due-dates'
import {
  MAX_IMPORT_EVENTS,
  importOccurrence,
  importSeries,
  importWindow,
  sortImported,
  type IcsImportPreview,
  type IcsOccurrence,
  type IcsRule,
  type IcsSeries,
  type ImportOptions,
} from '../../shared/ics-import'
import { daysBetween, type PlanEvent } from '../../shared/plan-events'
import { parseIcs } from './ics'

/** Occurrences looked at per series at most, so a broken rule cannot hang the main process. */
const MAX_OCCURRENCES = 20_000
const RULE_PARTS = new Set(['BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS'])

const pad = (n: number) => String(n).padStart(2, '0')

function localDay(time: ICAL.Time): LocalDate {
  if (time.isDate) return `${time.year}-${pad(time.month)}-${pad(time.day)}`
  return toLocalDate(time.toJSDate())
}

function localClock(date: Date, seconds = false): string {
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return seconds ? `${clock}:${pad(date.getSeconds())}` : clock
}

function upper(component: ICAL.Component, name: string): string {
  return String(component.getFirstPropertyValue(name) ?? '').toUpperCase()
}

function occurrenceOf(component: ICAL.Component, summary: string | undefined, start: ICAL.Time, end: ICAL.Time | null): IcsOccurrence {
  const common = {
    title: summary ?? '',
    busy: upper(component, 'transp') !== 'TRANSPARENT',
    cancelled: upper(component, 'status') === 'CANCELLED',
  }
  if (start.isDate) {
    const day = localDay(start)
    const days = end ? daysBetween(day, localDay(end)) : 1
    return { ...common, start: day, time: null, minutes: 0, days: Math.max(1, days) }
  }
  const from = start.toJSDate()
  const to = end ? end.toJSDate() : from
  return { ...common, start: toLocalDate(from), time: localClock(from), minutes: (to.getTime() - from.getTime()) / 60_000, days: 1 }
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n)) : []
}

function ruleOf(recur: ICAL.Recur): IcsRule {
  const parts = (recur.parts ?? {}) as Record<string, unknown>
  let until: string | null = null
  if (recur.until) {
    until = recur.until.isDate ? localDay(recur.until) : `${toLocalDate(recur.until.toJSDate())}T${localClock(recur.until.toJSDate(), true)}`
  }
  return {
    freq: String(recur.freq ?? ''),
    interval: recur.interval || 1,
    byDay: Array.isArray(parts.BYDAY) ? parts.BYDAY.map(String) : [],
    byMonthDay: numbers(parts.BYMONTHDAY),
    byMonth: numbers(parts.BYMONTH),
    bySetPos: numbers(parts.BYSETPOS),
    otherParts: Object.keys(parts).filter((name) => !RULE_PARTS.has(name) && Array.isArray(parts[name]) && (parts[name] as unknown[]).length > 0),
    wkst: /(?:^|;)WKST=([A-Z]{2})/i.exec(recur.toString())?.[1]?.toUpperCase() ?? null,
    count: typeof recur.count === 'number' ? recur.count : null,
    until,
  }
}

function seriesOf(event: ICAL.Event): IcsSeries {
  const component = event.component
  const rules = component.getAllProperties('rrule')
  const exdates: LocalDate[] = []
  for (const property of component.getAllProperties('exdate')) {
    for (const value of property.getValues()) {
      if (value instanceof ICAL.Time) exdates.push(localDay(value))
    }
  }
  const overrides = Object.keys((event.exceptions ?? {}) as object).length > 0
  return {
    ...occurrenceOf(component, event.summary, event.startDate, event.endDate),
    rule: rules.length === 1 ? ruleOf(rules[0].getFirstValue() as ICAL.Recur) : null,
    exdates,
    irregular: rules.length > 1 || component.getAllProperties('rdate').length > 0 || overrides,
  }
}

/** The occurrences of a series that may fall in the import window, each as a single Event. */
function expanded(event: ICAL.Event, options: ImportOptions): PlanEvent[] {
  const { to } = importWindow(options.importDay)
  // A moved occurrence can land a while after its own date: read a month past the window.
  const stop = startOfLocalDay(addLocalDays(to, 32)).getTime()
  const out: PlanEvent[] = []
  const take = (next: ICAL.Time) => {
    const details = event.getOccurrenceDetails(next)
    const single = importOccurrence(occurrenceOf(details.item.component, details.item.summary, details.startDate, details.endDate), options)
    if (single) out.push(single)
  }
  let sawStart = false
  const iterator = event.iterator()
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const next = iterator.next()
    if (!next || next.toJSDate().getTime() >= stop) break
    if (next.compare(event.startDate) === 0) sawStart = true
    take(next)
  }
  // DTSTART is the first instance (RFC 5545 3.8.5.2); ical.js leaves it out of an RDATE-only set.
  const component = event.component
  if (!sawStart && component.getAllProperties('rrule').length === 0) {
    const excluded = component
      .getAllProperties('exdate')
      .some((property) => property.getValues().some((value) => value instanceof ICAL.Time && value.compare(event.startDate) === 0))
    if (!excluded) take(event.startDate)
  }
  return out
}

/** The Events a calendar file becomes when imported on `options.importDay`, in a stable order. */
export function importIcsText(text: string, options: ImportOptions): PlanEvent[] {
  const out: PlanEvent[] = []
  for (const event of parseIcs(text).events) {
    if (event.isRecurrenceException()) {
      // An override whose series is not in the file: one occurrence.
      const single = importOccurrence(occurrenceOf(event.component, event.summary, event.startDate, event.endDate), options)
      if (single) out.push(single)
      continue
    }
    const series = importSeries(seriesOf(event), options)
    out.push(...(series ?? expanded(event, options)))
  }
  return sortImported(out)
}

/** Read a calendar file into its preview; a sentence when it cannot be imported. */
export function importPreview(text: string, fileName: string, importDay: LocalDate): { success: true; data: IcsImportPreview } | { success: false; error: string } {
  if (!/BEGIN:VCALENDAR/i.test(text)) return { success: false, error: 'That file is not a calendar file (no BEGIN:VCALENDAR).' }
  let events
  let busyOnly
  try {
    events = importIcsText(text, { importDay, busyOnly: false })
    busyOnly = importIcsText(text, { importDay, busyOnly: true })
  } catch {
    return { success: false, error: 'The file could not be read as a calendar.' }
  }
  if (events.length > MAX_IMPORT_EVENTS) {
    return {
      success: false,
      error: `This file makes ${events.length} Events, more than the ${MAX_IMPORT_EVENTS} Vicu imports at once. Export a shorter range and try again.`,
    }
  }
  return { success: true, data: { fileName, importDay, events, busyOnly } }
}
