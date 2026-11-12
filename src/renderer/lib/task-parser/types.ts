import type { PlaceMatch } from './place-phrases'

export type SyntaxMode = 'todoist' | 'vikunja'

/**
 * `place` is "when I get home" for a saved place (section 5.3), read only when the caller passes
 * places. `length` is `for 30m` when it makes a time block (section 5.4).
 */
export type TokenType =
  | 'label'
  | 'project'
  | 'priority'
  | 'recurrence'
  | 'date'
  | 'length'
  | 'place'
  // Pro (section 5.5), only with `pro` on
  | 'person'
  | 'start'
  | 'estimate'
  | 'flag'
  | 'request'

export interface ParsedToken {
  type: TokenType
  start: number
  end: number
  value: unknown
  raw: string
}

export interface ParsedRecurrence {
  interval: number
  unit: 'day' | 'week' | 'month' | 'year'
}

export interface ParseResult {
  title: string
  dueDate: Date | null
  /**
   * True when the parsed text named a time of day ("3pm", "14:30", "in 2 hours"), i.e. chrono's
   * `start.isCertain('hour')`. The time of `dueDate` is only meaningful when this is true;
   * otherwise the due date is date-only (build it with `parsedDue`).
   */
  dueHasTime: boolean
  /**
   * The time block `for 30m` makes with the text's time of day (section 5.4). The due date is then
   * that day, date-only: `dueHasTime` is false and the block holds the time.
   */
  block: { start: Date; end: Date } | null
  priority: number | null
  labels: string[]
  project: string | null
  recurrence: ParsedRecurrence | null
  /** A saved place the text names with "when I get home", for a location reminder. */
  place: PlaceMatch | null
  // Pro (section 5.5): always present, set only while `config.pro` is on.
  /** `Jan:` at the start: that person's promise to you; `for Jan:`: yours to them. */
  person: { id: number; mine: boolean } | null
  /** `starts monday`: a start date (local midnight without a time). Null when a block holds the start. */
  start: Date | null
  /** `~1h30`: minutes. */
  estimate: number | null
  /** `!flag` */
  flag: boolean
  /** `req:` at the start: a request to triage. */
  request: boolean
  tokens: ParsedToken[]
}

export interface SyntaxPrefixes {
  label: string
  project: string
}

export interface ParserConfig {
  enabled: boolean
  syntaxMode: SyntaxMode
  suppressTypes?: TokenType[]
  bangToday?: boolean
  /**
   * BCP 47 locale deciding the order of slash dates ("5/11": month/day in en-US, day/month in
   * en-GB). Defaults to the system locale (`navigator.language`).
   */
  locale?: string
  /** Pro's phrases (section 5.5). Off unless true; with it off the text is read as before. */
  pro?: boolean
}

const SYNTAX_PREFIXES: Record<SyntaxMode, SyntaxPrefixes> = {
  todoist: { label: '@', project: '#' },
  vikunja: { label: '*', project: '+' },
}

export function getPrefixes(mode: SyntaxMode): SyntaxPrefixes {
  return SYNTAX_PREFIXES[mode]
}

export const DEFAULT_PARSER_CONFIG: ParserConfig = {
  enabled: true,
  syntaxMode: 'todoist',
}
