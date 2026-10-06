import type { ParseResult, ParserConfig, ParsedToken } from './types'
import { DEFAULT_PARSER_CONFIG, getPrefixes } from './types'
import { extractLabels } from './extract-labels'
import { extractProject } from './extract-projects'
import { extractPriority } from './extract-priority'
import { extractRecurrence } from './extract-recurrence'
import type { WeekdayAnchor } from './extract-recurrence'
import { extractDate, extractBangToday } from './extract-dates'

export type { ParseResult, ParserConfig, ParsedToken, ParsedRecurrence, SyntaxMode, TokenType, SyntaxPrefixes } from './types'
export { DEFAULT_PARSER_CONFIG, getPrefixes } from './types'
export { recurrenceToVikunja } from './recurrence-map'
export { getParserConfig } from './config-bridge'
export { extractBangToday } from './extract-dates'

/**
 * Parse free-form task input into structured fields. Implements shared-parser-spec.md and
 * section 5 of docs/cross-app-semantics-v1.md; test-fixtures/nlp-corpus-v1.json is the test.
 *
 * Extraction order: Labels → Projects → Priority → Recurrence → Dates → Title
 *
 * The `!` → today shortcut (standalone, leading or trailing `!`) is controlled by
 * `config.bangToday` and has one rule, `extractBangToday`: `parse()` applies it whether the
 * parser is enabled or not, so callers never look for `!` themselves.
 *
 * @param rawInput - The raw user input string
 * @param config - Parser configuration (enabled, syntax mode, suppress types, locale)
 * @param reference - "Now" for relative dates; the current time unless a test passes one
 */
export function parse(
  rawInput: string,
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
  reference: Date = new Date(),
): ParseResult {
  const result: ParseResult = {
    title: rawInput,
    dueDate: null,
    dueHasTime: false,
    priority: null,
    labels: [],
    project: null,
    recurrence: null,
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

  // 5. Dates
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

  // 6. Build title from non-consumed regions
  result.title = buildTitle(rawInput, consumed)

  // 7. Standalone/leading/trailing ! → today (only when no date was found by chrono)
  if (config.bangToday && !result.dueDate) {
    const bang = extractBangToday(result.title, reference)
    if (bang.dueDate) {
      result.title = bang.title
      result.dueDate = bang.dueDate
      result.dueHasTime = false
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
