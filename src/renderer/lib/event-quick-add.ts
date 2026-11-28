import { parse, type ParsedRecurrence, type ParserConfig } from './task-parser'
import { findForPhrases } from './task-parser/extract-length'
import { toLocalDate, type LocalDate } from '../../shared/due-dates'
import { MAX_EVENT_MINUTES, type EventRepeat, type Weekday } from '../../shared/plan-events'
import { minutesOfDay } from '../../shared/time-blocks'

// Quick-add text for a new Event (calendar plan, phase 1): "Manager call every Tue 10:00 for 30m"
// gives the title, the day and time, the length and the repeat. The task parser reads the dates,
// times, `for 30m` and `every ...` (shared-parser-spec.md); this maps its answer onto an Event.
// Labels, projects, priorities and places mean nothing to an Event and stay in the title.

export interface EventText {
  /** The title without the words that were read; the text as typed when nothing else is left. */
  title: string
  /** The day the text names, or null (the day the box was opened on). */
  day: LocalDate | null
  /** Start in minutes from midnight, or null when the text names no time. */
  startMinute: number | null
  /** Length in minutes from `for 30m`, or null. */
  minutes: number | null
  /** The repeat the text names when it fits an Event's rule (20.4), else null. */
  repeat: EventRepeat | null
}

const EVENT_PARSER: ParserConfig = {
  enabled: true,
  syntaxMode: 'todoist',
  suppressTypes: ['label', 'project', 'priority', 'place'],
  bangToday: false,
}

const SHORT_WEEKDAYS: Record<string, string> = {
  mon: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
}

const MONDAY_TO_FRIDAY: Weekday[] = [1, 2, 3, 4, 5]

/** Day of the week of a local date, 0 Sunday to 6 Saturday. */
function weekdayOf(day: LocalDate): Weekday {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday
}

/**
 * The parser's repeat as an Event's rule on its first day `day`: every n days, weeks (on the day's
 * weekday), months (on the day's date) or years. Null when the interval is outside 1 to 99.
 */
export function repeatFromParsed(recurrence: ParsedRecurrence, day: LocalDate): EventRepeat | null {
  const every = recurrence.interval
  if (!Number.isInteger(every) || every < 1 || every > 99) return null
  switch (recurrence.unit) {
    case 'day':
      return { kind: 'daily', every }
    case 'week':
      return { kind: 'weekly', every, days: [weekdayOf(day)] }
    case 'month':
      return { kind: 'monthly-date', every, date: Number(day.slice(8, 10)) }
    case 'year':
      return { kind: 'yearly', every }
  }
}

/**
 * Reads quick-add text for an Event. `reference` is "now" for relative dates: the moment the box was
 * opened for, so a time alone stays on that day. `day` is that day, for the repeat when the text
 * names no date.
 */
export function readEventText(text: string, options: { day: LocalDate; reference: Date; locale?: string }): EventText {
  // "every Tue" reads as "every tuesday"; "every weekday" is Monday to Friday, which the task parser
  // does not have (a task repeats by an interval only).
  let input = text.replace(/\bevery\s+(mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\b\.?/gi, (_match, short: string) => `every ${SHORT_WEEKDAYS[short.toLowerCase()]}`)
  let weekdays = false
  input = input.replace(/(^|\s)every\s+weekdays?(?=\s|$)/i, (_match, before: string) => {
    weekdays = true
    return before
  })

  const result = parse(input, { ...EVENT_PARSER, locale: options.locale }, options.reference)
  let title = result.title
  const start = result.block?.start ?? (result.dueHasTime ? result.dueDate : null)
  const day = result.block ? toLocalDate(result.block.start) : result.dueDate ? toLocalDate(result.dueDate) : null
  let minutes: number | null = null
  if (result.block) {
    minutes = Math.round((result.block.end.getTime() - result.block.start.getTime()) / 60_000)
  } else {
    // Without a time `for 30m` is not a block for a task, but an Event still has a length.
    const length = findForPhrases(title, []).length
    if (length) {
      minutes = Math.min(MAX_EVENT_MINUTES, length.minutes)
      title = `${title.slice(0, length.start)} ${title.slice(length.end)}`.replace(/\s+/g, ' ').trim()
    }
  }

  let repeat: EventRepeat | null = null
  if (weekdays) repeat = { kind: 'weekly', every: 1, days: MONDAY_TO_FRIDAY }
  else if (result.recurrence) repeat = repeatFromParsed(result.recurrence, day ?? options.day)

  return {
    title: title || text.trim(),
    day,
    startMinute: start ? minutesOfDay(start) : null,
    minutes,
    repeat,
  }
}
