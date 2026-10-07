import * as chrono from 'chrono-node'
import { nextWeekStart, startOfLocalDay, toLocalDate } from '../due-dates'
import type { ParsedToken } from './types'

/**
 * Date extraction for the quick-add parser. Implements section 5.1 of
 * docs/cross-app-semantics-v1.md (the corpus in test-fixtures/nlp-corpus-v1.json is the test).
 * chrono-node does the parsing; this file adds the rules chrono does not have:
 *
 * - three-letter weekday abbreviations only count after on/next/this/by/due or before a time;
 * - "next week" is the Monday of next week;
 * - the connectors on/by/due (and `at` before a time) are removed together with the date;
 * - slash dates follow the locale's day/month order;
 * - "now" is never a date;
 * - a date-only phrase is judged against the start of the day, so "tuesday" typed on a Tuesday
 *   afternoon is today and not next week (chrono would compare it with the current time);
 * - a day and month that are today stay today when the time typed with them has passed ("oct 7 at
 *   9am" at 10:30 on 7 October), instead of moving to next year.
 */

export interface ExtractDateOptions {
  /** "Now" for relative phrases. Defaults to the current time. */
  reference?: Date
  /** BCP 47 locale deciding the order of slash dates ("5/11"). Defaults to the system locale. */
  locale?: string
  /** Ignore results that only name a time ("10am"): used to look for a date elsewhere. */
  skipTimeOnly?: boolean
  /** Take the result that overlaps this region (the weekday of "every monday") before any other. */
  prefer?: { start: number; end: number }
}

/** The locale of the running app: the renderer's, falling back to en-US (tests, main process). */
export function systemLocale(): string {
  try {
    if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
  } catch {
    // fall through
  }
  return 'en-US'
}

/**
 * True when slash dates in this locale are day/month ("15/10"), false when month/day.
 * Decided from the locale's own short date format, so year-first locales (ja, sv, hu) count as
 * month/day for the part after the year. An unknown locale tag falls back to month/day.
 */
export function isDayFirstLocale(locale: string = systemLocale()): boolean {
  const cached = dayFirstByLocale.get(locale)
  if (cached !== undefined) return cached
  let dayFirst = false
  try {
    const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date(2000, 10, 25))
    const types = parts.map((part) => part.type)
    dayFirst = types.indexOf('day') < types.indexOf('month')
  } catch {
    // unknown locale tag: month/day
  }
  dayFirstByLocale.set(locale, dayFirst)
  return dayFirst
}

const dayFirstByLocale = new Map<string, boolean>()

/**
 * Extract a date from input text using chrono-node.
 * Returns the parsed date, whether the text named a time of day (`hasTime`, chrono's
 * `start.isCertain('hour')`), and token position info. Without a time the time of `dueDate`
 * is whatever chrono implied and must not be used (see `parsedDue` in ../due-dates).
 */
export function extractDate(
  input: string,
  consumed: Array<{ start: number; end: number }>,
  options: ExtractDateOptions = {},
): { dueDate: Date | null; hasTime: boolean; tokens: ParsedToken[] } {
  const tokens: ParsedToken[] = []
  const none = { dueDate: null, hasTime: false, tokens }

  const reference = options.reference ?? new Date()
  const parser = isDayFirstLocale(options.locale ?? systemLocale()) ? chrono.en.GB : chrono.en.casual
  const chronoOptions = { forwardDate: true }

  // Consumed regions become spaces, and abbreviations that are not dates become spaces too, so
  // chrono never sees them and every index still points into the input.
  const working = maskWeekdayAbbreviations(buildWorkingText(input, consumed))

  const results = parser.parse(working, reference, chronoOptions)

  // Use the first result that isn't a standalone "now": chrono treats "now" as the current
  // time, but a casual "do this now" must not get a due date.
  const usable = (r: (typeof results)[number]): boolean =>
    r.text.trim().toLowerCase() !== 'now' && !(options.skipTimeOnly && namesNoDate(r.start))
  const prefer = options.prefer
  const result =
    (prefer && results.find((r) => usable(r) && r.index < prefer.end && r.index + r.text.length > prefer.start)) ||
    results.find(usable)
  if (!result) return none

  const hasTime = result.start.isCertain('hour')
  let dueDate = result.start.date()

  // A date-only phrase is judged against noon of today: chrono compares its implied time of day
  // (12:00) with the clock, which would move "tuesday" or "oct 6" typed after noon on that day
  // to next week / next year. Same match, different reference.
  if (!hasTime) {
    const noon = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 12, 0, 0, 0)
    const again = parser
      .parse(working, noon, chronoOptions)
      .find((r) => r.index === result.index && r.text === result.text)
    if (again) dueDate = again.start.date()
  }

  // "oct 7 at 9am" typed at 10:30 on 7 October: forwardDate sees 09:00 behind the clock and moves
  // the date to next year. The day and month are certain and the year is not, so a date that is
  // today stays today (its time is simply in the past); only an earlier day rolls to next year.
  if (
    result.start.isCertain('day') &&
    result.start.isCertain('month') &&
    !result.start.isCertain('year') &&
    result.start.get('day') === reference.getDate() &&
    result.start.get('month') === reference.getMonth() + 1 &&
    dueDate.getFullYear() !== reference.getFullYear()
  ) {
    dueDate = new Date(
      reference.getFullYear(), reference.getMonth(), reference.getDate(),
      dueDate.getHours(), dueDate.getMinutes(), dueDate.getSeconds(), 0,
    )
  }

  // "next week" is the Monday of the following week (chrono says "in 7 days").
  if (/^next\s+week\b/i.test(result.text) && !result.start.isCertain('weekday')) {
    const [y, m, d] = nextWeekStart(toLocalDate(reference)).split('-').map(Number)
    dueDate = new Date(y, m - 1, d, dueDate.getHours(), dueDate.getMinutes(), dueDate.getSeconds(), 0)
  }

  let start = result.index
  const end = start + result.text.length

  // Connector words directly before the date go with it: "report by friday", "taxes due tomorrow".
  // `at` goes with a time ("call at 9am"); chrono usually includes it already.
  const startsWithTime = hasTime && /^(?:\d|noon\b|midnight\b)/i.test(result.text)
  const connectors = startsWithTime ? 'on|by|due|at' : 'on|by|due'
  const connectorMatch = new RegExp(`(?:^|\\s)((?:(?:${connectors})\\s+)+)$`, 'i').exec(working.slice(0, start))
  if (connectorMatch) start -= connectorMatch[1].length

  // Verify the matched region doesn't overlap with already-consumed regions
  if (consumed.some((c) => start < c.end && end > c.start)) return none

  consumed.push({ start, end })
  tokens.push({
    type: 'date',
    start,
    end,
    value: dueDate,
    raw: input.slice(start, end),
  })

  return { dueDate, hasTime, tokens }
}

/** A parse result that only names a time of day ("10am"): no weekday, day, month or year. */
function namesNoDate(components: { isCertain(component: 'weekday' | 'day' | 'month' | 'year'): boolean }): boolean {
  return !(
    components.isCertain('weekday') ||
    components.isCertain('day') ||
    components.isCertain('month') ||
    components.isCertain('year')
  )
}

// Three-letter weekday abbreviations chrono knows.
const ABBREVIATION_RE = /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/gi
const BEFORE_ABBREVIATION_RE = /(?:^|\s)(?:on|next|this|by|due)\s+$/i
const TIME_AFTER_RE = /^\s*(?:at\s+)?(?:\d{1,2}:\d{2}|\d{1,2}(?::\d{2})?\s*[ap]\.?m\b|noon\b|midnight\b)/i

/**
 * "sun cream", "we sat on" and "wed anniversary" are not dates. An abbreviation only counts after
 * on/next/this/by/due or before a time ("mon 9am"); every other one is blanked out.
 * Full weekday names are never touched.
 */
function maskWeekdayAbbreviations(text: string): string {
  return text.replace(ABBREVIATION_RE, (word, offset: number) => {
    const before = text.slice(0, offset)
    const after = text.slice(offset + word.length)
    if (BEFORE_ABBREVIATION_RE.test(before) || TIME_AFTER_RE.test(after)) return word
    return ' '.repeat(word.length)
  })
}

/**
 * Extract the `!` → today shortcut. This is independent of the NLP parser
 * and always runs (even when parser is disabled).
 *
 * Matches:
 * - Trailing `!` (with optional preceding whitespace): "call dentist !" or "call dentist!"
 * - Leading `!` (with optional following whitespace): "! call dentist" or "!call dentist"
 *   BUT NOT when followed by a priority token like `!1`, `!urgent`, `!high`, `!medium`, `!low`
 * - Standalone `!`
 *
 * A `!` inside the text ("Hello! world") is not a date. This is the one `!` rule of every entry
 * point (composer, task title editor, Quick Entry); callers do not look for `!` themselves.
 */
export function extractBangToday(
  input: string,
  reference: Date = new Date(),
): {
  title: string
  dueDate: Date | null
} {
  const trimmed = input.trim()

  // The result is a date-only value: callers build the due date with `dueToday()` /
  // `parsedDue(date, false)`, so only the local calendar day of `dueDate` matters.
  const today = startOfLocalDay(reference)

  // Standalone `!`
  if (trimmed === '!') {
    return { title: '', dueDate: today }
  }

  // Match trailing `!` at end of string (not `!word` or `!digit`)
  const trailingRe = /^(.+?)\s*!$/
  const trailingMatch = trailingRe.exec(trimmed)
  if (trailingMatch) {
    return { title: trailingMatch[1].trim(), dueDate: today }
  }

  // Match leading `!` at start of string, but NOT if followed by a priority token
  // Priority tokens: !1-!4, !urgent, !high, !medium, !low
  const leadingRe = /^!\s*(.+)$/
  const leadingMatch = leadingRe.exec(trimmed)
  if (leadingMatch) {
    // Check that the text after `!` doesn't start with a priority token
    const rest = leadingMatch[1]
    if (!/^[1-4](?:\s|$)/.test(rest) && !/^(?:urgent|critical|high|medium|med|low)(?:\s|$)/i.test(rest)) {
      return { title: rest.trim(), dueDate: today }
    }
  }

  return { title: input, dueDate: null }
}

function buildWorkingText(
  input: string,
  consumed: Array<{ start: number; end: number }>,
): string {
  const chars = input.split('')
  for (const c of consumed) {
    for (let i = c.start; i < c.end; i++) {
      if (i < chars.length) chars[i] = ' '
    }
  }
  return chars.join('')
}
