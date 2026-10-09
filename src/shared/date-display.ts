import { diffLocalDays, toLocalDate } from './due-dates'

// How a due date or a completion time is phrased (docs/cross-app-semantics-v1.md section 8,
// pinned by the `dateDisplay` vectors of test-fixtures/cross-app-semantics-v1.json).
//
// Pure: the locale and the clock are passed in, nothing reads the system. For en-US and en-GB the
// text is built from the names and patterns below (never from platform locale data), so ICU here
// and java.time on Android give the same strings. Other locales keep the same phrase structure
// but take their order, names and separators from Intl.
//
// Dates are read in the process time zone; `now` and `value` are instants.

/** What the UI needs to phrase a date: the region locale and the clock. */
export interface DateFormat {
  /** A BCP 47 tag such as `en-US` or `en-GB`. */
  locale: string
  /** True for the 12-hour clock ("3:00 PM"), false for the 24-hour clock ("15:00"). */
  hour12: boolean
}

/** Where a date is shown; each context has its own rule in section 8.3 of the contract. */
export type DateContext =
  | 'row'
  | 'row.inToday'
  | 'row.inDayGroup'
  | 'chip'
  | 'header.day'
  | 'header.full'
  | 'logbook.group'
  | 'logbook.time'

interface Pattern {
  dayMonth: string
  dayMonthYear: string
  weekdayDayMonth: string
  weekdayDayMonthYear: string
  weekdayDay: string
  fullDate: string
  fullDateYear: string
  monthYear: string
  time12: string
  time24: string
  am: string
  pm: string
}

const NAMES = {
  weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  weekdaysLong: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  monthsLong: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
}

const WORDS = {
  today: 'Today',
  yesterday: 'Yesterday',
  tomorrow: 'Tomorrow',
  daysAgo: (n: number) => `${n} days ago`,
}

const PATTERNS: Record<'en-US' | 'en-GB', Pattern> = {
  'en-US': {
    dayMonth: '{MMM} {d}',
    dayMonthYear: '{MMM} {d}, {yyyy}',
    weekdayDayMonth: '{EEE}, {MMM} {d}',
    weekdayDayMonthYear: '{EEE}, {MMM} {d}, {yyyy}',
    weekdayDay: '{EEE} {d}',
    fullDate: '{EEEE}, {MMMM} {d}',
    fullDateYear: '{EEEE}, {MMMM} {d}, {yyyy}',
    monthYear: '{MMMM} {yyyy}',
    time12: '{h}:{mm} {AMPM}',
    time24: '{HH}:{mm}',
    am: 'AM',
    pm: 'PM',
  },
  'en-GB': {
    dayMonth: '{d} {MMM}',
    dayMonthYear: '{d} {MMM} {yyyy}',
    weekdayDayMonth: '{EEE} {d} {MMM}',
    weekdayDayMonthYear: '{EEE} {d} {MMM} {yyyy}',
    weekdayDay: '{EEE} {d}',
    fullDate: '{EEEE} {d} {MMMM}',
    fullDateYear: '{EEEE} {d} {MMMM} {yyyy}',
    monthYear: '{MMMM} {yyyy}',
    time12: '{h}:{mm} {AMPM}',
    time24: '{HH}:{mm}',
    am: 'am',
    pm: 'pm',
  },
}

/** English regions that write the month first; every other English locale follows en-GB. */
const MONTH_FIRST_REGIONS = new Set(['US', 'CA', 'PH'])

/** The pinned pattern set for an English locale, or null when the locale is not English. */
function englishPattern(locale: string): Pattern | null {
  const [language, ...rest] = locale.split(/[-_]/)
  if (language.toLowerCase() !== 'en') return null
  const region = rest.find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase()
  return !region || MONTH_FIRST_REGIONS.has(region) ? PATTERNS['en-US'] : PATTERNS['en-GB']
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function fill(template: string, date: Date, pattern: Pattern): string {
  // Monday-first index of the weekday (Date#getDay has Sunday = 0).
  const weekday = (date.getDay() + 6) % 7
  const hour = date.getHours()
  return template
    .replace('{EEEE}', NAMES.weekdaysLong[weekday])
    .replace('{EEE}', NAMES.weekdaysShort[weekday])
    .replace('{MMMM}', NAMES.monthsLong[date.getMonth()])
    .replace('{MMM}', NAMES.monthsShort[date.getMonth()])
    .replace('{yyyy}', String(date.getFullYear()))
    .replace('{d}', String(date.getDate()))
    .replace('{HH}', pad2(hour))
    .replace('{h}', String(hour % 12 === 0 ? 12 : hour % 12))
    .replace('{mm}', pad2(date.getMinutes()))
    .replace('{AMPM}', hour < 12 ? pattern.am : pattern.pm)
}

function safeIntl(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, options)
  } catch {
    return new Intl.DateTimeFormat('en-US', options)
  }
}

/** Phrase builders for one locale. */
interface Phrases {
  dayMonth(date: Date, withYear: boolean): string
  weekdayDayMonth(date: Date, withYear: boolean): string
  weekdayDay(date: Date): string
  weekdayShort(date: Date): string
  fullDate(date: Date, withYear: boolean): string
  monthYear(date: Date): string
  time(date: Date, hour12: boolean): string
}

function englishPhrases(pattern: Pattern): Phrases {
  return {
    dayMonth: (d, y) => fill(y ? pattern.dayMonthYear : pattern.dayMonth, d, pattern),
    weekdayDayMonth: (d, y) => fill(y ? pattern.weekdayDayMonthYear : pattern.weekdayDayMonth, d, pattern),
    weekdayDay: (d) => fill(pattern.weekdayDay, d, pattern),
    weekdayShort: (d) => fill('{EEE}', d, pattern),
    fullDate: (d, y) => fill(y ? pattern.fullDateYear : pattern.fullDate, d, pattern),
    monthYear: (d) => fill(pattern.monthYear, d, pattern),
    time: (d, hour12) => fill(hour12 ? pattern.time12 : pattern.time24, d, pattern),
  }
}

function intlPhrases(locale: string): Phrases {
  const fmt = (options: Intl.DateTimeFormatOptions) => (d: Date) => safeIntl(locale, options).format(d)
  const dayMonth = fmt({ day: 'numeric', month: 'short' })
  const dayMonthYear = fmt({ day: 'numeric', month: 'short', year: 'numeric' })
  const weekdayDayMonth = fmt({ weekday: 'short', day: 'numeric', month: 'short' })
  const weekdayDayMonthYear = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const weekdayShort = fmt({ weekday: 'short' })
  const dayNumber = fmt({ day: 'numeric' })
  const fullDate = fmt({ weekday: 'long', day: 'numeric', month: 'long' })
  const fullDateYear = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const monthYear = fmt({ month: 'long', year: 'numeric' })
  return {
    dayMonth: (d, y) => (y ? dayMonthYear(d) : dayMonth(d)),
    weekdayDayMonth: (d, y) => (y ? weekdayDayMonthYear(d) : weekdayDayMonth(d)),
    weekdayDay: (d) => `${weekdayShort(d)} ${dayNumber(d)}`,
    weekdayShort,
    fullDate: (d, y) => (y ? fullDateYear(d) : fullDate(d)),
    monthYear,
    time: (d, hour12) => safeIntl(locale, { hour: 'numeric', minute: '2-digit', hour12 }).format(d),
  }
}

function phrasesFor(locale: string): Phrases {
  const pattern = englishPattern(locale)
  return pattern ? englishPhrases(pattern) : intlPhrases(locale)
}

/**
 * Whether the locale writes its clock in 12 hours by default (en-US "3:00 PM": true, en-GB and
 * de-DE: false). An unknown locale counts as 24-hour.
 */
export function localeUsesHour12(locale: string): boolean {
  try {
    const resolved = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions()
    if (typeof resolved.hour12 === 'boolean') return resolved.hour12
    return resolved.hourCycle === 'h11' || resolved.hourCycle === 'h12'
  } catch {
    return false
  }
}

/** Settings choice for the clock: follow the locale, or force one of the two. */
export type ClockFormat = 'system' | '12h' | '24h'

export function isClockFormat(value: unknown): value is ClockFormat {
  return value === 'system' || value === '12h' || value === '24h'
}

/** The effective 12/24-hour choice for a locale and the Settings value. */
export function resolveHour12(locale: string, clock: ClockFormat): boolean {
  if (clock === '12h') return true
  if (clock === '24h') return false
  return localeUsesHour12(locale)
}

/** The locale and clock the UI phrases dates with, from the system locale and the Settings choice. */
export function dateFormatFor(locale: string, clock: ClockFormat): DateFormat {
  return { locale, hour12: resolveHour12(locale, clock) }
}

function calendarDiff(now: Date, value: Date): number {
  return diffLocalDays(toLocalDate(now), toLocalDate(value))
}

/** A day phrase: the short date, with the year only when it differs from the current year. */
function shortDate(value: Date, now: Date, p: Phrases): string {
  return p.dayMonth(value, value.getFullYear() !== now.getFullYear())
}

function weekdayDate(value: Date, now: Date, p: Phrases): string {
  return p.weekdayDayMonth(value, value.getFullYear() !== now.getFullYear())
}

function withTime(day: string, value: Date, dateOnly: boolean, fmt: DateFormat, p: Phrases): string {
  return dateOnly ? day : `${day}, ${p.time(value, fmt.hour12)}`
}

function rowDay(diff: number, value: Date, now: Date, p: Phrases): string {
  if (diff <= -7) return shortDate(value, now, p)
  if (diff <= -2) return WORDS.daysAgo(-diff)
  if (diff === -1) return WORDS.yesterday
  if (diff === 0) return WORDS.today
  if (diff === 1) return WORDS.tomorrow
  if (diff <= 6) return p.weekdayShort(value)
  return shortDate(value, now, p)
}

/**
 * The text of a date for one context (section 8.3 of the contract). `dateOnly` says the value has
 * no time of day (section 1.2); it is ignored by the logbook contexts, whose value is always a
 * completion time. An empty string means there is nothing to show.
 */
export function formatDateDisplay(
  context: DateContext,
  value: Date,
  now: Date,
  dateOnly: boolean,
  fmt: DateFormat,
): string {
  const p = phrasesFor(fmt.locale)
  const diff = calendarDiff(now, value)

  switch (context) {
    case 'row':
      return withTime(rowDay(diff, value, now, p), value, dateOnly, fmt, p)
    case 'row.inToday':
      if (diff === 0) return dateOnly ? '' : p.time(value, fmt.hour12)
      return withTime(rowDay(diff, value, now, p), value, dateOnly, fmt, p)
    case 'row.inDayGroup':
      return dateOnly ? '' : p.time(value, fmt.hour12)
    case 'chip':
      return withTime(weekdayDate(value, now, p), value, dateOnly, fmt, p)
    case 'header.day':
      if (diff === 0) return WORDS.today
      if (diff === 1) return WORDS.tomorrow
      if (diff >= 2 && diff <= 6) return p.weekdayDay(value)
      return weekdayDate(value, now, p)
    case 'header.full':
      return p.fullDate(value, value.getFullYear() !== now.getFullYear())
    case 'logbook.group':
      // A completion a little in the future (a clock that is ahead) counts as today.
      if (diff >= 0) return WORDS.today
      if (diff === -1) return WORDS.yesterday
      if (diff >= -6) return weekdayDate(value, now, p)
      return p.monthYear(value)
    case 'logbook.time':
      return p.time(value, fmt.hour12)
  }
}

/**
 * A full timestamp for details such as created and updated: the short date with its year, a comma
 * and the time ("Apr 13, 2026, 3:42 PM", "13 Apr 2026, 15:42"). Not a contract context: nothing
 * relative, and the year is always shown.
 */
export function formatAbsoluteDateTime(value: Date, fmt: DateFormat): string {
  const p = phrasesFor(fmt.locale)
  return `${p.dayMonth(value, true)}, ${p.time(value, fmt.hour12)}`
}

/** The short date with its year ("Jun 12, 2026", "12 Jun 2026"), for documents such as printouts. */
export function formatDayMonthYear(value: Date, fmt: DateFormat): string {
  return phrasesFor(fmt.locale).dayMonth(value, true)
}

/** The long date with its year ("Wednesday, June 10, 2026", "Wednesday 10 June 2026"). */
export function formatFullDateWithYear(value: Date, fmt: DateFormat): string {
  return phrasesFor(fmt.locale).fullDate(value, true)
}

// Small labels for a month grid and its quick choices (the When panel). Not contract contexts;
// built from the same patterns so the names match the rest of the app.

/** The short weekday name ("Wed"). */
export function formatWeekdayShort(value: Date, fmt: DateFormat): string {
  return phrasesFor(fmt.locale).weekdayShort(value)
}

/** The short weekday with the day of the month ("Mon 12"). */
export function formatWeekdayDay(value: Date, fmt: DateFormat): string {
  return phrasesFor(fmt.locale).weekdayDay(value)
}

/** The month with its year ("October 2026"). */
export function formatMonthYear(value: Date, fmt: DateFormat): string {
  return phrasesFor(fmt.locale).monthYear(value)
}
