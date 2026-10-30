import type { ParseResult, ParserConfig, ParsedToken } from './types'
import { DEFAULT_PARSER_CONFIG, getPrefixes } from './types'
import { extractLabels } from './extract-labels'
import { extractProject } from './extract-projects'
import { extractPriority } from './extract-priority'
import { extractDuration } from './extract-duration'
import { extractRecurrence } from './extract-recurrence'
import type { WeekdayAnchor } from './extract-recurrence'
import { extractDate, extractBangToday } from './extract-dates'
import { matchPlacePhrase, type PlaceRef } from './place-phrases'

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
 * Extraction order: Place → Labels → Projects → Priority → Duration → Recurrence → Dates → Title
 *
 * The `!` → today shortcut (standalone, leading or trailing `!`) is controlled by
 * `config.bangToday` and has one rule, `extractBangToday`: `parse()` applies it whether the
 * parser is enabled or not, so callers never look for `!` themselves.
 *
 * @param rawInput - The raw user input string
 * @param config - Parser configuration (enabled, syntax mode, suppress types, locale)
 * @param reference - "Now" for relative dates; the current time unless a test passes one
 * @param places - The saved places "when I get home" may name (section 5.3); none means no place is read
 */
export function parse(
  rawInput: string,
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
  reference: Date = new Date(),
  places: readonly PlaceRef[] = [],
): ParseResult {
  const result: ParseResult = {
    title: rawInput,
    dueDate: null,
    dueHasTime: false,
    durationMinutes: null,
    priority: null,
    labels: [],
    project: null,
    recurrence: null,
    place: null,
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

  // 4. Duration
  if (!suppress.has('duration')) {
    const extracted = extractDuration(rawInput, consumed)
    result.durationMinutes = extracted.durationMinutes
    result.tokens.push(...extracted.tokens)
  }

  // 5. Recurrence
  let weekday: WeekdayAnchor | undefined
  let recurrenceToken: ParsedToken | undefined
  if (!suppress.has('recurrence')) {
    const extracted = extractRecurrence(rawInput, consumed)
    result.recurrence = extracted.recurrence
    result.tokens.push(...extracted.tokens)
    weekday = extracted.weekday
    recurrenceToken = extracted.tokens[0]
  }

  // 6. Dates
  const dateOptions = { reference, locale: config.locale }
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
