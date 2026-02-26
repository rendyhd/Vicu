import type { ParseResult, ParserConfig, ParsedToken } from './types'
import { DEFAULT_PARSER_CONFIG, getPrefixes } from './types'
import { extractLabels } from './extract-labels'
import { extractProject } from './extract-projects'
import { extractPriority } from './extract-priority'
import { extractRecurrence } from './extract-recurrence'
import { extractDate, extractBangToday } from './extract-dates'

export type { ParseResult, ParserConfig, ParsedToken, ParsedRecurrence, SyntaxMode, TokenType, SyntaxPrefixes } from './types'
export { DEFAULT_PARSER_CONFIG, getPrefixes } from './types'
export { recurrenceToVikunja } from './recurrence-map'
export { getParserConfig } from './config-bridge'
export { extractBangToday } from './extract-dates'

/**
 * Parse free-form task input into structured fields.
 *
 * Extraction order: Labels → Projects → Priority → Recurrence → Dates → Title
 *
 * The trailing `!` → today shortcut is controlled by `config.bangToday`.
 * When the parser is disabled, the caller should handle it via `extractBangToday()` directly.
 *
 * @param rawInput - The raw user input string
 * @param config - Parser configuration (enabled, syntax mode, suppress types)
 */
export function parse(
  rawInput: string,
  config: ParserConfig = DEFAULT_PARSER_CONFIG,
): ParseResult {
  const result: ParseResult = {
    title: rawInput,
    dueDate: null,
    priority: null,
    labels: [],
    project: null,
    recurrence: null,
    tokens: [],
  }

  if (!rawInput.trim()) return result

  if (!config.enabled) {
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
  if (!suppress.has('recurrence')) {
    const { recurrence, tokens } = extractRecurrence(rawInput, consumed)
    result.recurrence = recurrence
    result.tokens.push(...tokens)
  }

  // 5. Dates
  if (!suppress.has('date')) {
    const { dueDate, tokens } = extractDate(rawInput, consumed)
    result.dueDate = dueDate
    result.tokens.push(...tokens)
  }

  // 6. Build title from non-consumed regions
  result.title = buildTitle(rawInput, consumed)

  // 7. Leading/trailing ! → today (only when enabled and no date was found by chrono)
  if (config.bangToday && !result.dueDate) {
    const bang = extractBangToday(result.title)
    if (bang.dueDate) {
      result.title = bang.title
      result.dueDate = bang.dueDate
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
