import * as chrono from 'chrono-node'
import { nextWeekStart, startOfLocalDay, toLocalDate } from '../due-dates'
import type { ParsedToken } from './types'

/**
 * Date extraction for the quick-add parser. Implements section 5.1 of
 * docs/cross-app-semantics-v1.md (the corpus in test-fixtures/nlp-corpus-v1.json is the test).
 * chrono-node does the parsing; this file adds the rules chrono does not have:
 *
 * - a date phrase is made of whole words: "Monday's", "(tomorrow)" and "Friday/Saturday" are not
 *   dates;
 * - three-letter weekday abbreviations only count after on/next/this/by/due or before a time;
 * - a weekday directly followed by another date is a word of the title ("call Ana about Saturday
 *   tomorrow"), where chrono would merge the two into one date;
 * - text another extractor took splits a date phrase: "call tomorrow @home 3pm" is due tomorrow
 *   and keeps "3pm" in the title, where chrono would read across the label;
 * - there are no ranges: "trip friday to sunday" is due Friday and keeps "to sunday", and a range
 *   written as one word ("3-5pm") is not a date;
 * - "weekend" and "weekday" are words, not dates (chrono reads them as Saturday and the next
 *   working day);
 * - phrases about the past ("yesterday", "last friday", "2 days ago") are not dates;
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
  const chronoOptions = { forwardDate: true }

  // Consumed regions become spaces, and words that are not dates (abbreviations without a
  // marker, "weekend", phrases about the past) become spaces too, so every index still points
  // into the input.
  const working = maskWeekdayAbbreviations(maskPastPhrases(maskWeekendWords(buildWorkingText(input, consumed))))
  // chrono reads a copy in which consumed text and range words are marks instead: a date phrase
  // never continues across text another extractor took ("tomorrow @home 3pm"), and "friday to
  // sunday" is two dates, not a range.
  const chronoText = markRangeWords(markRegions(working, consumed))
  const parser = chronoFor(isDayFirstLocale(options.locale ?? systemLocale()), working)

  const results = parser.parse(chronoText, reference, chronoOptions)

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
      .parse(chronoText, noon, chronoOptions)
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

  const span = phraseSpan(result)
  let start = span.start
  const end = span.end

  // Connector words directly before the date go with it: "report by friday", "taxes due tomorrow",
  // and `at` with a time ("call at 9am"). Only after a space, as on Android ("Meet (on friday)"
  // keeps "(on"), and never across text another extractor took ("pay rent by @money friday"
  // keeps "by").
  const startsWithTime = hasTime && /^(?:\d|noon\b|midnight\b)/i.test(working.slice(start, end))
  const connectors = startsWithTime ? 'on|by|due|at' : 'on|by|due'
  const connectorMatch = new RegExp(`(?:^|\\s)((?:(?:${connectors})\\s+)+)$`, 'i').exec(working.slice(0, start))
  if (connectorMatch) {
    const extended = start - connectorMatch[1].length
    if (!consumed.some((c) => extended < c.end && end > c.start)) start = extended
  }

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

/**
 * chrono's casual English parser (day/month order for day-first locales) with the contract's
 * rules in front of chrono's own refiners, so they apply before chrono merges anything.
 * `working` is the text with consumed regions as spaces, for the word-boundary checks.
 */
function chronoFor(dayFirst: boolean, working: string): chrono.Chrono {
  const parser = (dayFirst ? chrono.en.GB : chrono.en.casual).clone()
  parser.refiners.unshift({
    refine: (context, results) => {
      // A range chrono finds inside one match ("3-5pm", "oct 10-12") is glued into one word, so it
      // is not a phrase; ranges with spaces never reach chrono (markRangeWords). The overlaps go
      // first, as in chrono: when the longest match is not a phrase, the shorter ones inside it do
      // not count either ("3-5 pm" is not 3 May).
      const phrases = longestMatches(results).filter((result) => !result.end && isWholeWords(result, working))
      return phrases.filter((result) => !isWeekdayBeforeAnotherDate(result, phrases, context.text))
    },
  })
  return parser
}

/** chrono's own overlap rule (OverlapRemovalRefiner): of two overlapping matches the longer stays. */
function longestMatches(results: chrono.ParsingResult[]): chrono.ParsingResult[] {
  const kept: chrono.ParsingResult[] = []
  for (const result of results) {
    const last = kept[kept.length - 1]
    if (!last || result.index >= last.index + last.text.length) kept.push(result)
    else if (result.text.length > last.text.length) kept[kept.length - 1] = result
  }
  return kept
}

/**
 * A date phrase is made of whole words, as on Android: it starts at the start of the text or after
 * a space, and ends at a space, the end, or `. , ! ? ; )`. chrono also takes "Monday's",
 * "tomorrow-ish", "Friday/Saturday" and "(tomorrow)", which are not dates.
 */
function isWholeWords(result: chrono.ParsingResult, working: string): boolean {
  const { start, end } = phraseSpan(result)
  const before = start > 0 ? working[start - 1] : ' '
  const after = end < working.length ? working[end] : ' '
  return /\s/.test(before) && /[\s.,!?;)]/.test(after)
}

/**
 * The phrase in a chrono result, without what chrono takes around it: the "(" or "," it allows
 * around a weekday ("Ana, friday,") and the on/at/from it starts a match with. `extractDate` adds
 * a connector back when a space is before it, as Android does ("Meet (on friday)" keeps "(on");
 * "from" is not a connector and stays in the title.
 */
function phraseSpan(result: { index: number; text: string }): { start: number; end: number } {
  const lead = /^(?:[,(（]\s*)?(?:(?:on|at|from)\s+)?/i.exec(result.text)?.[0].length ?? 0
  const trail = /\s*[,)）]?\s*$/.exec(result.text.slice(lead))?.[0].length ?? 0
  return { start: result.index + lead, end: result.index + result.text.length - trail }
}

/**
 * chrono merges a weekday into the date right after it: "Saturday tomorrow" becomes tomorrow and
 * takes both words. In the contract that weekday is a word of the title ("Call Ana about Saturday
 * tomorrow at 3pm" is due tomorrow at 15:00, titled "Call Ana about Saturday"), so it is dropped
 * before chrono's refiners can merge it. Only spaces or a comma may be between the two (consumed
 * text is a mark in `text`, so it counts as a word, as on Android), and a time is not another date
 * ("wed 3pm" stays Wednesday at 15:00). "friday next week" is one phrase and is not affected.
 */
function isWeekdayBeforeAnotherDate(result: chrono.ParsingResult, results: chrono.ParsingResult[], text: string): boolean {
  if (!result.start.isOnlyWeekdayComponent()) return false
  const end = result.index + result.text.length
  // The results do not overlap and are in text order, so the next one is the one chrono would merge.
  const next = results.find((r) => r.index >= end)
  if (!next || !namesAnotherDate(next)) return false
  // chrono starts a weekday or "15 jan" with the connector when there is one ("Friday on
  // Monday"): that is a word between the two.
  if (/^on\b/i.test(next.text)) return false
  return /^[\s,]*$/.test(text.slice(end, next.index))
}

/**
 * A result that names a day or a moment: a date, a weekday, "next month", "in 2 hours". Not a
 * time of day on its own ("3pm") and not "now".
 */
function namesAnotherDate(result: chrono.ParsingResult): boolean {
  if (result.text.trim().toLowerCase() === 'now') return false
  const start = result.start
  return start.isCertain('day') || start.isOnlyWeekdayComponent() || start.tags().has('result/relativeDate')
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

// chrono reads "weekend" as Saturday and "weekday" as the next working day. Neither is a date in
// the contract: "Plan the weekend" has no date and keeps its title.
const WEEKEND_WORD_RE = /\bweek(?:end|day)\b/gi

function maskWeekendWords(text: string): string {
  return text.replace(WEEKEND_WORD_RE, (word) => ' '.repeat(word.length))
}

// Phrases about the past are not due dates and stay in the title: "Review notes from last
// friday", "Notes from yesterday", "Sent 2 days ago". These are the past forms chrono reads, with
// its own amounts and units (NUMBER_PATTERN and TIME_UNIT_DICTIONARY in its English constants).
const WEEKDAY_WORDS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun'
const AMOUNT =
  '(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half(?:\\s*an?)?|an?\\b(?:\\s*few)?|few|several|the|(?:a\\s*)?couple(?:\\s*of)?)'
const UNIT = '(?:s|sec|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?|mo|mon|mos|months?|qtr|quarters?|y|yr|years?)'
const AMOUNT_OF_TIME = `${AMOUNT}\\s*${UNIT}`
const PAST_PHRASE_RE = new RegExp(
  [
    '\\byesterday\\b',
    '\\blast\\s*night\\b',
    `\\b(?:last|past)\\s*(?:${WEEKDAY_WORDS})\\b`,
    `\\b(?:${WEEKDAY_WORDS})\\s+(?:last|past)\\s*week\\b`,
    `\\b(?:last|past)\\s*(?:${AMOUNT}\\s*)?${UNIT}\\b`,
    `(?<!\\S)-\\s*${AMOUNT_OF_TIME}\\b`,
    `\\b${AMOUNT_OF_TIME}(?:\\s*,?\\s*(?:and\\s+)?${AMOUNT_OF_TIME})*\\s*(?:ago|before|earlier)\\b`,
  ].join('|'),
  'gi',
)

function maskPastPhrases(text: string): string {
  return text.replace(PAST_PHRASE_RE, (phrase) => phrase.replace(/\S/g, ' '))
}

// What chrono sees in place of consumed text and range words: not a space, not part of a word, and
// not a character any chrono pattern joins two parts with.
const MARK = '\u0000'

function markRegions(text: string, regions: Array<{ start: number; end: number }>): string {
  const chars = text.split('')
  for (const r of regions) {
    for (let i = r.start; i < r.end && i < chars.length; i++) chars[i] = MARK
  }
  return chars.join('')
}

// chrono reads "friday to sunday", "oct 10 - oct 12" and "3pm until 5pm" as one range. The
// contract has no ranges: the first date counts and the rest stays in the title.
const RANGE_WORD_RE = /(?<=^|\s)(?:to|until|through|till|[-–~〜])(?=\s|$)/gi

function markRangeWords(text: string): string {
  return text.replace(RANGE_WORD_RE, (word) => MARK.repeat(word.length))
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
