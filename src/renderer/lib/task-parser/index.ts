import type { ParseResult, ParserConfig, ParsedToken } from './types'
import { DEFAULT_PARSER_CONFIG, getPrefixes } from './types'
import { extractLabels } from './extract-labels'
import { extractProject } from './extract-projects'
import { extractPriority } from './extract-priority'
import { extractRecurrence } from './extract-recurrence'
import type { WeekdayAnchor } from './extract-recurrence'
import { extractDate, extractBangToday } from './extract-dates'
import { findForPhrases } from './extract-length'
import { matchPlacePhrase, type PlaceRef } from './place-phrases'
import { isTimeBlock } from '../../../shared/time-blocks'
import type { Person } from '../../../shared/pro/people'
import { extractEstimate, extractFlag, extractPersonPrefix, extractRequest, findStartsWords } from './extract-pro'

export type { ParseResult, ParserConfig, ParsedToken, ParsedRecurrence, SyntaxMode, TokenType, SyntaxPrefixes } from './types'
export { DEFAULT_PARSER_CONFIG, getPrefixes } from './types'
export { recurrenceToVikunja } from './recurrence-map'
export { getParserConfig } from './config-bridge'
export { extractBangToday } from './extract-dates'
export type { PlaceMatch, PlaceRef } from './place-phrases'

/**
 * Parse free-form task input into structured fields. Implements shared-parser-spec.md and
 * section 5 of docs/cross-app-semantics-v1.md; test-fixtures/nlp-corpus-v1.json is the test.
 *
 * Extraction order: Place → Labels → Projects → Priority → Recurrence → Dates → Length → Title
 * (`for` phrases are found before Recurrence, so Dates does not read them; see section 5.4)
 *
 * The `!` → today shortcut (standalone, leading or trailing `!`) is controlled by
 * `config.bangToday` and has one rule, `extractBangToday`: `parse()` applies it whether the
 * parser is enabled or not, so callers never look for `!` themselves.
 *
 * @param rawInput - The raw user input string
 * @param config - Parser configuration (enabled, syntax mode, suppress types, locale)
 * @param reference - "Now" for relative dates; the current time unless a test passes one
 * @param places - The saved places "when I get home" may name (section 5.3); none means no place is read
 * @param people - Pro's people `Jan:` may name (section 5.5); read only with `config.pro`
 */
export function parse(
  rawInput: string,
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
  reference: Date = new Date(),
  places: readonly PlaceRef[] = [],
  people: readonly Person[] = [],
): ParseResult {
  const result: ParseResult = {
    title: rawInput,
    dueDate: null,
    dueHasTime: false,
    block: null,
    priority: null,
    labels: [],
    project: null,
    recurrence: null,
    place: null,
    person: null,
    start: null,
    estimate: null,
    flag: false,
    request: false,
    tokens: [],
  }

  if (!rawInput.trim()) return result

  if (!config.enabled) {
    // Everything stays in the title; only the `!` shortcut still works.
    if (config.bangToday) {
      const bang = extractBangToday(rawInput, reference)
      if (bang.dueDate) {
        result.title = bang.title
        result.dueDate = bang.dueDate
      }
    }
    return result
  }

  const prefixes = getPrefixes(config.syntaxMode)
  const consumed: Array<{ start: number; end: number }> = []
  const suppress = new Set(config.suppressTypes ?? [])
  const pro = config.pro === true

  // Pro: `req:` and a person's name at the very start, `!flag` and `~1h30` (section 5.5), before
  // anything else reads those words.
  if (pro) {
    if (!suppress.has('request')) {
      const found = extractRequest(rawInput, consumed)
      result.request = found.request
      result.tokens.push(...found.tokens)
    }
    if (!suppress.has('person')) {
      const found = extractPersonPrefix(rawInput, people, consumed)
      if (found.person) result.person = { id: found.person.id, mine: found.person.mine }
      result.tokens.push(...found.tokens)
    }
    if (!suppress.has('flag')) {
      const found = extractFlag(rawInput, consumed)
      result.flag = found.flag
      result.tokens.push(...found.tokens)
    }
    if (!suppress.has('estimate')) {
      const found = extractEstimate(rawInput, consumed)
      result.estimate = found.estimate
      result.tokens.push(...found.tokens)
    }
  }

  // 0. A saved place ("when I get home"), first, so no word of the phrase is read as a date.
  if (!suppress.has('place')) {
    const match = matchPlacePhrase(rawInput, places)
    if (match) {
      consumed.push(match.consumed)
      result.place = match
      result.tokens.push({ type: 'place', start: match.start, end: match.end, value: match, raw: rawInput.slice(match.start, match.end) })
    }
  }

  // 1. Labels
  if (!suppress.has('label')) {
    const { labels, tokens } = extractLabels(rawInput, prefixes.label, consumed)
    result.labels = labels
    result.tokens.push(...tokens)
  }

  // 2. Project
  if (!suppress.has('project')) {
    const { project, tokens } = extractProject(rawInput, prefixes.project, consumed)
    result.project = project
    result.tokens.push(...tokens)
  }

  // 3. Priority
  if (!suppress.has('priority')) {
    const { priority, tokens } = extractPriority(rawInput, config.syntaxMode, consumed)
    result.priority = priority
    result.tokens.push(...tokens)
  }

  // `for 30m` and `for 3 months` are never dates, and do not split one. A suppressed length still
  // is not a date: its words simply stay in the title and the time stays the due time.
  const forPhrases = findForPhrases(rawInput, consumed)

  // 4. Recurrence
  let weekday: WeekdayAnchor | undefined
  let recurrenceToken: ParsedToken | undefined
  if (!suppress.has('recurrence')) {
    const extracted = extractRecurrence(rawInput, consumed)
    result.recurrence = extracted.recurrence
    result.tokens.push(...extracted.tokens)
    weekday = extracted.weekday
    recurrenceToken = extracted.tokens[0]
  }

  // Pro: `starts <date>` is a start date, read before the due date and never as one.
  const dateOptions = { reference, locale: config.locale, hidden: forPhrases.hidden, weekStart: config.weekStart }
  if (pro && !suppress.has('start')) {
    for (const words of findStartsWords(rawInput, consumed)) {
      const before = { start: 0, end: words.phrase }
      const found = extractDate(rawInput, [...consumed, before], dateOptions)
      const token = found.tokens[0]
      if (!found.dueDate || !token || rawInput.slice(words.phrase, token.start).trim() !== '') continue
      const start = new Date(found.dueDate.getTime())
      if (!found.hasTime) start.setHours(0, 0, 0, 0)
      else start.setSeconds(0, 0)
      result.start = start
      consumed.push({ start: words.start, end: token.end })
      result.tokens.push({ type: 'start', start: words.start, end: token.end, value: start, raw: rawInput.slice(words.start, token.end) })
      break
    }
  }

  // 5. Dates
  if (!suppress.has('date')) {
    let found: ReturnType<typeof extractDate> | null = null
    if (weekday) {
      // "every monday": the weekday is the due date unless the input has another date. A time
      // on its own ("every monday 10am") is not another date; it goes with the weekday.
      const trial = [...consumed, weekday]
      const other = extractDate(rawInput, trial, { ...dateOptions, skipTimeOnly: true })
      if (other.dueDate) {
        consumed.length = 0
        consumed.push(...trial)
        found = other
        if (recurrenceToken) {
          recurrenceToken.end = weekday.end
          recurrenceToken.raw = rawInput.slice(recurrenceToken.start, weekday.end)
        }
      }
    }
    if (!found) found = extractDate(rawInput, consumed, { ...dateOptions, prefer: weekday })
    result.dueDate = found.dueDate
    result.dueHasTime = found.hasTime
    result.tokens.push(...found.tokens)
  } else if (weekday) {
    // The date was dismissed: "every monday" is only the recurrence.
    consumed.push(weekday)
    if (recurrenceToken) {
      recurrenceToken.end = weekday.end
      recurrenceToken.raw = rawInput.slice(recurrenceToken.start, weekday.end)
    }
  }

  // 6. Length: with a time of day it is a block, and the block holds the time. Otherwise the words
  //    stay in the title.
  const length = forPhrases.length
  if (length && !suppress.has('length') && result.dueDate && result.dueHasTime) {
    const start = new Date(result.dueDate.getTime())
    start.setSeconds(0, 0)
    const end = new Date(start.getTime() + length.minutes * 60_000)
    if (isTimeBlock(start, end)) {
      result.block = { start, end }
      result.dueHasTime = false
      consumed.push({ start: length.start, end: length.end })
      result.tokens.push({ type: 'length', start: length.start, end: length.end, value: length.minutes, raw: rawInput.slice(length.start, length.end) })
      // A block holds the start: it replaces a start date (section 21.3).
      result.start = null
    }
  }

  // 7. Build title from non-consumed regions
  result.title = buildTitle(rawInput, consumed)

  // 8. Standalone/leading/trailing ! → today. An explicit date wins, but the
  //    "!" marker is still removed from the title ("Call mom tomorrow!").
  if (config.bangToday) {
    const bang = extractBangToday(result.title, reference)
    if (bang.dueDate) {
      result.title = bang.title
      if (!result.dueDate) {
        result.dueDate = bang.dueDate
        result.dueHasTime = false
      }
    }
  }

  return result
}

/** A parsed block as the fields of a task, or null when the text made none. */
export function blockFields(result: Pick<ParseResult, 'block'> | null | undefined): { start_date: string; end_date: string } | null {
  if (!result?.block) return null
  return { start_date: result.block.start.toISOString(), end_date: result.block.end.toISOString() }
}

/**
 * Build the final title by removing all consumed regions and collapsing whitespace.
 */
function buildTitle(
  input: string,
  consumed: Array<{ start: number; end: number }>,
): string {
  // Sort consumed regions by start position
  const sorted = [...consumed].sort((a, b) => a.start - b.start)

  let title = ''
  let pos = 0
  for (const region of sorted) {
    if (region.start > pos) {
      title += input.slice(pos, region.start)
    }
    pos = region.end
  }
  if (pos < input.length) {
    title += input.slice(pos)
  }

  // Collapse whitespace and trim
  return title.replace(/\s+/g, ' ').trim()
}
